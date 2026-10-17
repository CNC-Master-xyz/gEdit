// The aligned NC-aware diff (Phase 4 plan X30, P4.25; design: docs/planning/file-compare.md).
//
// Pure: no Monaco, no store. The view (`monaco/alignedView.ts`) draws what this module works out;
// `app/compare.ts` feeds it and applies the merges.
//
// What it does, in the order the code reads:
//
//  1. **Alignment** (`alignSides`). The line diff runs on the **normalized** lines of review mode
//     (`normalizeLines`, the ignore options in force), so a renumbering or a comment the options
//     ignore moves no line out of line. The result is expressed in the lines **as written**, which
//     is what the view shows: a list of blocks, each a run of original-side lines facing a run of
//     modified-side lines. Three kinds: `same` (equal under the options, level one to one),
//     `changed` (at least one side has a line that differs) and `ignored` (a stretch of lines the
//     options drop on both sides, like a comment that differs; it keeps the two sides level but is
//     no difference and offers no merge). A line the options drop (`lineMap` has no entry for it)
//     belongs to the gap between the two matched lines around it.
//
//     The diff is a patience diff (lines that occur once on each side anchor the rest, found with
//     a longest increasing subsequence) with the capped Myers diff of `core/transforms/lineDiff`
//     between the anchors, and a prefix/suffix trim at every level. Where Myers gives up (more
//     than `DEFAULT_MAX_D` edits in a stretch with no anchor) the stretch is one changed block:
//     correct, not minimal. A 100,000-line program with a few hundred changes costs a few
//     passes over the lines.
//
//  2. **Rows** (`blockRows`). Inside a `changed` or `ignored` block, lines that face each other
//     share a row, and a line with no partner gets a row of its own, the other side filled
//     (`fillers`: a view zone as high as the missing lines). So the two panes have the same
//     number of rows and scroll as one. The kept lines of a changed block face each other by
//     their words (review NC-7, `facingRows`): two lines that share a word other than the
//     motion code face each other, in order, the most shared words winning; the lines between
//     two such pairs face each other in order, as far as the shorter side goes. A dropped line
//     faces the next dropped line of the other side.
//
//  3. **Words** (`makePairReader`, `alignedMarkPairs`). Two lines that share a row, both kept,
//     are compared word by word (`wordDiff`, P4.24) on the words the options leave: a block
//     number or a comment the options drop is not a word, `X5.0` and `X5` are one word under
//     the number format option. The spans are offsets in the line as written.
//
//  4. **Merging** (`lineChangeOf`, `rowMergePlan`, `wordMergePlan`). A block copies as a whole
//     (the original lines of one side replace the other's, `app/compare.ts` builds the edit from
//     a `DiffLineChange` as in the raw view); one row copies as a line; one run of words copies
//     as a replacement of the target's words (or an insertion or a removal where the target has
//     none). Every merge is an edit of the target's text; nothing here touches NC data. A word
//     copy is checked on the line it would write (review NC-1): the line must read as the words
//     it kept plus the words copied, and no address may stand on it more often than on either
//     line before, nor go missing when both lines have it; otherwise it is refused, and the
//     line copy is the way.
//
// Lines and columns are 1-based as in Monaco; spans are UTF-16 offsets as in `wordDiff`.

import { diffLines } from '$lib/core/transforms/lineDiff';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import type { LineState, NcToken } from '$lib/core/nc/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import { normalizedWords } from './index';
import type { CompareOptions, NormalizeContext } from './types';
import { addressOf, wordDiff, wordRuns, type WordMarks, type WordRun, type WordSpan } from './wordDiff';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The two panes. */
export type AlignedSide = 'original' | 'modified';

/** One side of the comparison, as `alignSides` needs it. */
export interface AlignInput {
  /** The number of lines of the side as written (what the editor shows). */
  lineCount: number;
  /** The side's normalized lines (the lines the options leave). */
  normalized: readonly string[];
  /** `lineMap[i]` = the 1-based line as written that `normalized[i]` came from; ascending. */
  lineMap: Int32Array;
}

export type AlignedBlockKind = 'same' | 'changed' | 'ignored';

/**
 * A run of original-side lines facing a run of modified-side lines. A count of 0 is a side
 * with no line here; its `Start` is then the line the run would begin at (the line after the
 * one before it), so `start + count - 1` is always the last line before the block's end.
 * A `same` block has the same count on both sides.
 */
export interface AlignedBlock {
  kind: AlignedBlockKind;
  originalStart: number;
  originalCount: number;
  modifiedStart: number;
  modifiedCount: number;
}

/** The alignment of two sides. */
export interface AlignedDiff {
  blocks: AlignedBlock[];
  /** The `changed` blocks, in order: what next/previous and the merge buttons work on. */
  changed: AlignedBlock[];
  originalLines: number;
  modifiedLines: number;
  /** `kept.original[line]` = 1 when the options keep that line (it is in the normalized text). Index 0 unused. */
  kept: Record<AlignedSide, Uint8Array>;
  /**
   * `partner.original[line]` = the modified line a kept original line of a `changed` block
   * faces (0: none, the line has a row of its own); `partner.modified` the other way round.
   * Index 0 unused.
   */
  partner: Record<AlignedSide, Int32Array>;
}

/** The shape of a Monaco line change (`DiffLineChange`, `LineBlock`): an empty side has end 0 and starts at the line before. */
export interface AlignedLineChange {
  originalStartLineNumber: number;
  originalEndLineNumber: number;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
}

/** A filler under `side`'s line `afterLine` (0 = above the first line), `lines` lines high. */
export interface Filler {
  side: AlignedSide;
  afterLine: number;
  lines: number;
  /** The block it belongs to (an index into `AlignedDiff.blocks`). */
  block: number;
}

// ---------------------------------------------------------------------------
// The line diff: patience with Myers between the anchors
// ---------------------------------------------------------------------------

/** The matched pairs of a diff: `a[k]` of the first side is `b[k]` of the second; both ascending. */
export interface Matches {
  a: number[];
  b: number[];
}

/** A task of the iterative walk: a region still to diff, or a run of matches to emit. */
type Task =
  | { run: false; aLo: number; aHi: number; bLo: number; bHi: number }
  | { run: true; aAt: number; bAt: number; count: number };

/** Indexes of a longest strictly increasing subsequence of `values`, in order. */
function increasing(values: readonly number[]): number[] {
  const tails: number[] = []; // index into values of the smallest tail of each length
  const previous = new Int32Array(values.length).fill(-1);
  for (let k = 0; k < values.length; k++) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (values[tails[mid]] < values[k]) low = mid + 1;
      else high = mid;
    }
    if (low > 0) previous[k] = tails[low - 1];
    tails[low] = k;
  }
  const out: number[] = [];
  for (let k = tails.length > 0 ? tails[tails.length - 1] : -1; k >= 0; k = previous[k]) out.push(k);
  return out.reverse();
}

/**
 * The lines both sides share, in order. Exact line equality; the caller passes normalized
 * lines. Deterministic, and never worse than one block for a region it cannot split.
 */
export function matchLines(a: readonly string[], b: readonly string[], o?: { maxD?: number }): Matches {
  const outA: number[] = [];
  const outB: number[] = [];
  const stack: Task[] = [{ run: false, aLo: 0, aHi: a.length, bLo: 0, bHi: b.length }];
  while (stack.length > 0) {
    const task = stack.pop()!;
    if (task.run) {
      for (let k = 0; k < task.count; k++) {
        outA.push(task.aAt + k);
        outB.push(task.bAt + k);
      }
      continue;
    }
    let { aLo, aHi, bLo, bHi } = task;
    // What both sides start with is matched at once; what they end with after the middle.
    const headStart = aLo;
    const headB = bLo;
    while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) {
      aLo++;
      bLo++;
    }
    const head = aLo - headStart;
    let tail = 0;
    while (aLo < aHi - tail && bLo < bHi - tail && a[aHi - 1 - tail] === b[bHi - 1 - tail]) tail++;
    aHi -= tail;
    bHi -= tail;

    // The plan, in the order it must come out; pushed in reverse.
    const plan: Task[] = [];
    if (head > 0) plan.push({ run: true, aAt: headStart, bAt: headB, count: head });
    if (aLo < aHi && bLo < bHi) {
      const anchors = patienceAnchors(a, b, aLo, aHi, bLo, bHi);
      if (anchors.length === 0) {
        // Nothing occurs once on both sides: the capped Myers diff; the lines between its
        // edits are the matches (past the cap it answers one edit, so nothing matches).
        const edits = diffLines(a.slice(aLo, aHi), b.slice(bLo, bHi), o);
        let ia = 0;
        let ib = 0;
        for (const edit of edits) {
          if (edit.oldStart > ia) plan.push({ run: true, aAt: aLo + ia, bAt: bLo + ib, count: edit.oldStart - ia });
          ib += edit.oldStart - ia + edit.newLines.length;
          ia = edit.oldEnd;
        }
        if (ia < aHi - aLo) plan.push({ run: true, aAt: aLo + ia, bAt: bLo + ib, count: aHi - aLo - ia });
      } else {
        let fromA = aLo;
        let fromB = bLo;
        for (const [ia, ib] of anchors) {
          if (ia > fromA || ib > fromB) plan.push({ run: false, aLo: fromA, aHi: ia, bLo: fromB, bHi: ib });
          plan.push({ run: true, aAt: ia, bAt: ib, count: 1 });
          fromA = ia + 1;
          fromB = ib + 1;
        }
        if (fromA < aHi || fromB < bHi) plan.push({ run: false, aLo: fromA, aHi, bLo: fromB, bHi });
      }
    }
    if (tail > 0) plan.push({ run: true, aAt: aHi, bAt: bHi, count: tail });
    for (let k = plan.length - 1; k >= 0; k--) stack.push(plan[k]);
  }
  return { a: outA, b: outB };
}

/** The lines that occur exactly once in each side's region, as the longest chain that keeps their order. */
function patienceAnchors(
  a: readonly string[],
  b: readonly string[],
  aLo: number,
  aHi: number,
  bLo: number,
  bHi: number,
): [number, number][] {
  const seen = new Map<string, { countA: number; countB: number; ia: number; ib: number }>();
  for (let i = aLo; i < aHi; i++) {
    const entry = seen.get(a[i]);
    if (entry) entry.countA++;
    else seen.set(a[i], { countA: 1, countB: 0, ia: i, ib: -1 });
  }
  for (let j = bLo; j < bHi; j++) {
    const entry = seen.get(b[j]);
    if (!entry) continue;
    entry.countB++;
    entry.ib = j;
  }
  const pairs: [number, number][] = [];
  for (const entry of seen.values()) if (entry.countA === 1 && entry.countB === 1) pairs.push([entry.ia, entry.ib]);
  if (pairs.length === 0) return [];
  pairs.sort((x, y) => x[0] - y[0]);
  return increasing(pairs.map((pair) => pair[1])).map((k) => pairs[k]);
}

// ---------------------------------------------------------------------------
// The alignment
// ---------------------------------------------------------------------------

function keptLines(side: AlignInput): Uint8Array {
  const kept = new Uint8Array(side.lineCount + 2);
  for (let i = 0; i < side.lineMap.length; i++) {
    const line = side.lineMap[i];
    if (line >= 1 && line <= side.lineCount) kept[line] = 1;
  }
  return kept;
}

// ---------------------------------------------------------------------------
// Which kept lines of a changed block face each other (review NC-7)
// ---------------------------------------------------------------------------

/** More kept lines than this (one side times the other) in a changed block: they face each other in order. */
export const ROW_PAIR_MAX_CELLS = 4096;
/** The words of a line compared for facing, at most. */
const ROW_WORDS_MAX = 32;
/** A motion code, which nearly every line of a block shares: G0 to G3 (`G01`), and Klartext's path functions. */
const MOTION_CODE = /^(G0*[0-3]|L|LP|C|CP|CR|CT)$/i;

/**
 * The words of a normalized line for facing: split at blanks and in front of a letter that
 * follows a digit or a point (packed words, `G1X10F100`), without the motion code.
 */
function rowWords(text: string): string[] {
  const out: string[] = [];
  for (const chunk of text.split(/\s+/)) {
    if (chunk === '') continue;
    for (const word of chunk.split(/(?<=[0-9.])(?=[A-Za-z])/)) {
      if (!MOTION_CODE.test(word)) out.push(word);
      if (out.length >= ROW_WORDS_MAX) return out;
    }
  }
  return out;
}

/** The length of a longest common subsequence of two word lists. */
function sharedWords(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let previous = new Uint16Array(b.length + 1);
  let current = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      current[j] = a[i - 1] === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length];
}

/**
 * Which line of `b` each line of `a` faces (-1: none), both the kept (normalized) lines of
 * one changed block, in order. Lines that share words face each other: of the pairings that
 * keep the order, the one with the most shared words (a longest common subsequence of the
 * words of each pair, the motion code left out) wins, the earliest on a tie. Between two such
 * pairs, and everywhere when no line shares a word or the block is larger than
 * `ROW_PAIR_MAX_CELLS`, the lines face each other in order as far as the shorter side goes.
 */
export function facingRows(a: readonly string[], b: readonly string[]): Int32Array {
  const n = a.length;
  const m = b.length;
  const out = new Int32Array(n).fill(-1);
  const pairs: [number, number][] = [];
  if (n > 0 && m > 0 && n * m <= ROW_PAIR_MAX_CELLS && (n > 1 || m > 1)) {
    const wordsA = a.map(rowWords);
    const wordsB = b.map(rowWords);
    const score = new Uint16Array(n * m);
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) score[i * m + j] = sharedWords(wordsA[i], wordsB[j]);
    // best[i][j]: the most shared words a pairing of a[i..] and b[j..] reaches.
    const width = m + 1;
    const best = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        const s = score[i * m + j];
        const take = s > 0 ? s + best[(i + 1) * width + j + 1] : 0;
        best[i * width + j] = Math.max(take, best[(i + 1) * width + j], best[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m && best[i * width + j] > 0) {
      const s = score[i * m + j];
      if (s > 0 && best[i * width + j] === s + best[(i + 1) * width + j + 1]) pairs.push([i++, j++]);
      else if (best[(i + 1) * width + j] >= best[i * width + j + 1]) i++;
      else j++;
    }
  }
  let i = 0;
  let j = 0;
  for (const [pi, pj] of [...pairs, [n, m] as [number, number]]) {
    while (i < pi && j < pj) out[i++] = j++;
    if (pi < n) out[pi] = pj;
    i = pi + 1;
    j = pj + 1;
  }
  return out;
}

/** Lines the diff may not have a partner for: the normalized text of a side whose lines are all dropped is empty. */
export function alignSides(original: AlignInput, modified: AlignInput, o?: { maxD?: number }): AlignedDiff {
  const found = matchLines(original.normalized, modified.normalized, o);
  const blocks: AlignedBlock[] = [];
  const partner = {
    original: new Int32Array(original.lineCount + 2),
    modified: new Int32Array(modified.lineCount + 2),
  };
  // The last line of each side already placed in a block, and the last normalized line.
  let lastA = 0;
  let lastB = 0;
  let normA = -1;
  let normB = -1;

  const gap = (toA: number, toB: number, nA: number, nB: number): void => {
    // Lines between the last placed one and `toA`/`toB` (exclusive), and how many of them are kept.
    const countA = toA - lastA - 1;
    const countB = toB - lastB - 1;
    if (countA <= 0 && countB <= 0) return;
    if (nA > 0 && nB > 0) {
      // The kept lines of the gap are the normalized lines behind the last matched ones.
      const facing = facingRows(original.normalized.slice(normA + 1, normA + 1 + nA), modified.normalized.slice(normB + 1, normB + 1 + nB));
      for (let k = 0; k < nA; k++) {
        if (facing[k] < 0) continue;
        const la = original.lineMap[normA + 1 + k];
        const lb = modified.lineMap[normB + 1 + facing[k]];
        partner.original[la] = lb;
        partner.modified[lb] = la;
      }
    }
    blocks.push({
      kind: nA > 0 || nB > 0 ? 'changed' : 'ignored',
      originalStart: lastA + 1,
      originalCount: Math.max(countA, 0),
      modifiedStart: lastB + 1,
      modifiedCount: Math.max(countB, 0),
    });
  };

  for (let k = 0; k < found.a.length; k++) {
    const ia = found.a[k];
    const ib = found.b[k];
    const la = original.lineMap[ia];
    const lb = modified.lineMap[ib];
    gap(la, lb, ia - normA - 1, ib - normB - 1);
    const last = blocks[blocks.length - 1];
    if (last && last.kind === 'same' && last.originalStart + last.originalCount === la && last.modifiedStart + last.modifiedCount === lb) {
      last.originalCount++;
      last.modifiedCount++;
    } else {
      blocks.push({ kind: 'same', originalStart: la, originalCount: 1, modifiedStart: lb, modifiedCount: 1 });
    }
    lastA = la;
    lastB = lb;
    normA = ia;
    normB = ib;
  }
  gap(original.lineCount + 1, modified.lineCount + 1, original.normalized.length - normA - 1, modified.normalized.length - normB - 1);

  return {
    blocks,
    changed: blocks.filter((block) => block.kind === 'changed'),
    originalLines: original.lineCount,
    modifiedLines: modified.lineCount,
    kept: { original: keptLines(original), modified: keptLines(modified) },
    partner,
  };
}

// ---------------------------------------------------------------------------
// Rows and fillers
// ---------------------------------------------------------------------------

/** One row of a block: the line of each side (0 = none; that side is filled). */
export type Row = [original: number, modified: number];

/** The rows of a block, in order. */
export function* blockRows(diff: AlignedDiff, block: AlignedBlock): Generator<Row> {
  let a = block.originalStart;
  let b = block.modifiedStart;
  const aEnd = a + block.originalCount;
  const bEnd = b + block.modifiedCount;
  if (block.kind === 'same') {
    for (; a < aEnd; a++, b++) yield [a, b];
    return;
  }
  const keptA = diff.kept.original;
  const keptB = diff.kept.modified;
  const partnerA = diff.partner.original;
  const partnerB = diff.partner.modified;
  while (a < aEnd || b < bEnd) {
    if (a >= aEnd) yield [0, b++];
    else if (b >= bEnd) yield [a++, 0];
    else if (keptA[a] === 0 && keptB[b] === 0) yield [a++, b++];
    else if (keptA[a] === 0) yield [a++, 0];
    else if (keptB[b] === 0) yield [0, b++];
    // Two kept lines (`facingRows`): a pair shares a row, a line with no partner has its own.
    else if (partnerA[a] === b) yield [a++, b++];
    else if (partnerA[a] === 0) yield [a++, 0];
    else if (partnerB[b] === 0 || partnerA[a] > b) yield [0, b++];
    else yield [a++, 0];
  }
}

/** The fillers that keep the panes level: one per run of rows where a side has no line. */
export function fillers(diff: AlignedDiff): Filler[] {
  const out: Filler[] = [];
  for (let index = 0; index < diff.blocks.length; index++) {
    const block = diff.blocks[index];
    if (block.kind === 'same') continue;
    // The side's last line placed so far in this block, and the run of missing lines under it.
    let lastA = block.originalStart - 1;
    let lastB = block.modifiedStart - 1;
    let missingA = 0;
    let missingB = 0;
    const flush = (): void => {
      if (missingA > 0) out.push({ side: 'original', afterLine: lastA, lines: missingA, block: index });
      if (missingB > 0) out.push({ side: 'modified', afterLine: lastB, lines: missingB, block: index });
      missingA = 0;
      missingB = 0;
    };
    for (const [a, b] of blockRows(diff, block)) {
      if (a === 0) {
        if (missingB > 0) flush();
        missingA++;
        lastB = b;
      } else if (b === 0) {
        if (missingA > 0) flush();
        missingB++;
        lastA = a;
      } else {
        flush();
        lastA = a;
        lastB = b;
      }
    }
    flush();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Finding things
// ---------------------------------------------------------------------------

const startOf = (block: AlignedBlock, side: AlignedSide): number =>
  side === 'original' ? block.originalStart : block.modifiedStart;
const countOf = (block: AlignedBlock, side: AlignedSide): number =>
  side === 'original' ? block.originalCount : block.modifiedCount;

/** The block of `blocks` that holds `line` of `side`, or null. Blocks ascend on both sides. */
export function blockAt(blocks: readonly AlignedBlock[], side: AlignedSide, line: number): AlignedBlock | null {
  let low = 0;
  let high = blocks.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (startOf(blocks[mid], side) <= line) low = mid + 1;
    else high = mid;
  }
  // `low` is the first block that starts after `line`; blocks with no line on this side may sit in between.
  for (let k = low - 1; k >= 0; k--) {
    const block = blocks[k];
    const count = countOf(block, side);
    if (count === 0) continue;
    return line < startOf(block, side) + count ? block : null;
  }
  return null;
}

/** A block as the line change the raw merge plans from (`mergePlan` of `app/compare.ts`). */
export function lineChangeOf(block: AlignedBlock): AlignedLineChange {
  return {
    originalStartLineNumber: block.originalCount > 0 ? block.originalStart : block.originalStart - 1,
    originalEndLineNumber: block.originalCount > 0 ? block.originalStart + block.originalCount - 1 : 0,
    modifiedStartLineNumber: block.modifiedCount > 0 ? block.modifiedStart : block.modifiedStart - 1,
    modifiedEndLineNumber: block.modifiedCount > 0 ? block.modifiedStart + block.modifiedCount - 1 : 0,
  };
}

/** The row `line` of `side` stands in, and the block it belongs to; null for a line outside every block. */
export function rowOf(diff: AlignedDiff, side: AlignedSide, line: number): { block: AlignedBlock; row: Row } | null {
  const block = blockAt(diff.blocks, side, line);
  if (!block) return null;
  if (block.kind === 'same') {
    const offset = line - startOf(block, side);
    return { block, row: [block.originalStart + offset, block.modifiedStart + offset] };
  }
  for (const row of blockRows(diff, block)) if (row[side === 'original' ? 0 : 1] === line) return { block, row };
  return null;
}

/**
 * The next or previous difference from `line` of `side`, wrapping round at the ends: the
 * first line of the `changed` block (a block without a line on this side: the line it would
 * start at). Null when there is no difference.
 */
export function neighbourBlock(
  diff: AlignedDiff,
  side: AlignedSide,
  line: number,
  direction: 'next' | 'previous',
): AlignedBlock | null {
  const list = diff.changed;
  if (list.length === 0) return null;
  if (direction === 'next') {
    for (const block of list) if (startOf(block, side) > line) return block;
    return list[0];
  }
  for (let k = list.length - 1; k >= 0; k--) if (startOf(list[k], side) < line) return list[k];
  return list[list.length - 1];
}

// ---------------------------------------------------------------------------
// Merge plans
// ---------------------------------------------------------------------------

/** The lines to read from the source pane and the lines to replace in the target pane (as `MergePlan` in `app/compare.ts`). */
export interface LineMergePlan {
  sourceFrom: number;
  sourceCount: number;
  /** The first target line replaced, or, with `targetRemove` 0, the line the text goes in front of. */
  targetAt: number;
  targetRemove: number;
}

/**
 * The plan for copying **one row** of `block` from `from` to the other pane: the source line
 * replaces the target line of the row, goes in front of the line after the row when the target
 * has none, or (a source with no line in the row) removes the target line. Null for a row
 * that has no line on either side, which cannot happen.
 */
export function rowMergePlan(
  diff: AlignedDiff,
  block: AlignedBlock,
  row: Row,
  from: AlignedSide,
): LineMergePlan | null {
  const source = from === 'original' ? row[0] : row[1];
  const target = from === 'original' ? row[1] : row[0];
  if (source !== 0 && target !== 0) return { sourceFrom: source, sourceCount: 1, targetAt: target, targetRemove: 1 };
  if (target !== 0) return { sourceFrom: 0, sourceCount: 0, targetAt: target, targetRemove: 1 };
  if (source === 0) return null;
  // The target has no line in this row: the source line goes in behind the target's last line
  // placed before the row, or at the start of the block's span.
  const targetSide: AlignedSide = from === 'original' ? 'modified' : 'original';
  let last = startOf(block, targetSide) - 1;
  for (const r of blockRows(diff, block)) {
    if (r[0] === row[0] && r[1] === row[1]) break;
    const line = targetSide === 'original' ? r[0] : r[1];
    if (line !== 0) last = line;
  }
  return { sourceFrom: source, sourceCount: 1, targetAt: last + 1, targetRemove: 0 };
}

/**
 * The plan for the one-line copy at `cursor` inside the block that `change` describes: the row
 * the cursor's line is in (the block's first row when the cursor is next to a side that has no
 * line in it), copied from the pane `from` to the other. Null when `change` is not a changed
 * block of `diff`.
 */
export function copyRowPlan(
  diff: AlignedDiff,
  change: AlignedLineChange,
  from: AlignedSide,
  cursor: { side: AlignedSide; line: number },
): LineMergePlan | null {
  const same = (a: AlignedLineChange, b: AlignedLineChange): boolean =>
    a.originalStartLineNumber === b.originalStartLineNumber &&
    a.originalEndLineNumber === b.originalEndLineNumber &&
    a.modifiedStartLineNumber === b.modifiedStartLineNumber &&
    a.modifiedEndLineNumber === b.modifiedEndLineNumber;
  const block = diff.changed.find((candidate) => same(lineChangeOf(candidate), change));
  if (!block) return null;
  const index = cursor.side === 'original' ? 0 : 1;
  let row: Row | undefined;
  for (const candidate of blockRows(diff, block)) {
    row ??= candidate;
    if (candidate[index] === cursor.line) {
      row = candidate;
      break;
    }
  }
  return row ? rowMergePlan(diff, block, row, from) : null;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** One side of the word comparison: how its lines are read. */
export interface WordSide {
  cp: CompiledProfile;
  ctx: NormalizeContext;
  /** The side's lines as written, 0-based. */
  lines: readonly string[];
}

/** Reads the words of lines and compares pairs of them under the options in force. */
export interface PairReader {
  /** The words that differ between line `original` and line `modified` (1-based), as spans of each line as written. */
  marks(original: number, modified: number): WordMarks;
  /** The places where they differ. */
  runs(original: number, modified: number): WordRun[];
  /** The tokens of `text` read as line `line` of `side` (after the line above it), to check an edit. */
  tokens(side: AlignedSide, line: number, text: string): NcToken[];
  /**
   * True when a word put into a line of `side` needs a blank in front of it even where the
   * line has none: names glue to the word in front of them (`syntax.removeSpaces` set:
   * Sinumerik, Okuma), or words must be separated (Klartext).
   */
  blankRequired(side: AlignedSide): boolean;
}

export function makePairReader(original: WordSide, modified: WordSide, options: CompareOptions): PairReader {
  // The state of the line above (a Klartext `~` continuation), as `wordMarkPairs` reads it.
  const stateAbove = (side: WordSide, line: number): LineState | undefined =>
    line > 1 ? tokenizeLine(side.lines[line - 2] ?? '', side.cp).state : undefined;
  const wordsOf = (side: WordSide, line: number): NcToken[] =>
    normalizedWords(side.lines[line - 1] ?? '', side.cp, options, side.ctx, stateAbove(side, line)).words;
  const sideOf = (side: AlignedSide): WordSide => (side === 'original' ? original : modified);
  return {
    marks(originalLine, modifiedLine) {
      return wordDiff(wordsOf(original, originalLine), wordsOf(modified, modifiedLine));
    },
    runs(originalLine, modifiedLine) {
      return wordRuns(wordsOf(original, originalLine), wordsOf(modified, modifiedLine), {}, {
        original: original.lines[originalLine - 1] ?? '',
        modified: modified.lines[modifiedLine - 1] ?? '',
      });
    },
    tokens(side, line, text) {
      return tokenizeLine(text, sideOf(side).cp, stateAbove(sideOf(side), line)).tokens;
    },
    blankRequired(side) {
      const syntax = sideOf(side).cp.profile.syntax;
      return syntax?.wordSeparatorRequired === true || syntax?.removeSpaces !== undefined;
    },
  };
}

/** A pair of lines in one row that has word marks. */
export interface AlignedPairMarks {
  originalLine: number;
  modifiedLine: number;
  marks: WordMarks;
}

/**
 * The marks of every row of every `changed` block where both lines are kept, lazily, so a
 * caller can stop between pairs (the view marks in slices). Only pairs that have marks are yielded.
 */
export function* alignedMarkPairs(diff: AlignedDiff, reader: PairReader): Generator<AlignedPairMarks> {
  for (const block of diff.changed) {
    if (block.originalCount === 0 || block.modifiedCount === 0) continue;
    for (const [a, b] of blockRows(diff, block)) {
      if (a === 0 || b === 0 || diff.kept.original[a] === 0 || diff.kept.modified[b] === 0) continue;
      const marks = reader.marks(a, b);
      if (marks.original.length > 0 || marks.modified.length > 0) yield { originalLine: a, modifiedLine: b, marks };
    }
  }
}

/**
 * What the word merge refuses, in words the caller turns into a message: no marked word at the
 * cursor (also on a line that is identical on both sides), no line facing it, a copy that would leave an address twice or drop one (the words
 * moved: copy the line instead), a copy whose words would not read as they do in the source
 * (they would run into the word next to them).
 */
export type WordMergeRefusal = 'noWord' | 'noPair' | 'moved' | 'joins';

/** One text edit in a pane: replace `[startColumn, endColumn)` of `line` with `text`. */
export interface WordEdit {
  line: number;
  startColumn: number;
  endColumn: number;
  text: string;
}

/**
 * The edit that copies the word run at `cursor` into the other pane. `cursor` is a position
 * in either pane; the run is the marked run of the row that holds its offset (or touches it:
 * the offset just behind a word counts). `direction` says which pane is the source:
 * `toModified` copies the original's words over the modified's (replace; insert where the
 * modified has none, remove where the original has none).
 *
 * `originalLine`/`modifiedLine` are the live lines of the two panes (1-based accessors) so
 * the edit is made against the text as it is. The caller refuses a stale alignment first.
 *
 * The line the edit would write is read again before the edit is offered (review NC-1):
 *
 *  - it must read as the target's words in front of the edit, the copied words and the
 *    target's words behind it, each as written (`joins` otherwise). An insertion into a line
 *    written without blanks gets a blank when the target's dialect needs one
 *    (`PairReader.blankRequired`) or when the words would run together without it;
 *  - no address (`X`, `F`, `G`) may stand on it more often than on the source line or on the
 *    target line before, and an address both lines have may not go missing (`moved`
 *    otherwise: the words moved, so the line copy is the way).
 */
export function wordMergePlan(
  diff: AlignedDiff,
  reader: PairReader,
  cursor: { side: AlignedSide; line: number; column: number },
  direction: 'toModified' | 'toOriginal',
  lines: { original(line: number): string; modified(line: number): string },
): { target: AlignedSide; edit: WordEdit } | WordMergeRefusal {
  const found = rowOf(diff, cursor.side, cursor.line);
  if (!found) return 'noPair';
  // An identical line has a partner but no changed word; only a line with no partner is `noPair`.
  if (found.block.kind !== 'changed') return found.block.kind === 'same' ? 'noWord' : 'noPair';
  const [a, b] = found.row;
  if (a === 0 || b === 0 || diff.kept.original[a] === 0 || diff.kept.modified[b] === 0) return 'noPair';
  const offset = cursor.column - 1;
  const here = (span: WordSpan | null): boolean => span !== null && offset >= span.start && offset <= span.end;
  const run = reader.runs(a, b).find((r) => here(cursor.side === 'original' ? r.original : r.modified));
  if (!run) return 'noWord';

  const toModified = direction === 'toModified';
  const source = toModified ? run.original : run.modified;
  const sourceSide: AlignedSide = toModified ? 'original' : 'modified';
  const sourceLine = toModified ? a : b;
  const sourceText = toModified ? lines.original(a) : lines.modified(b);
  const targetSide: AlignedSide = toModified ? 'modified' : 'original';
  const targetLine = toModified ? b : a;
  const targetText = toModified ? lines.modified(b) : lines.original(a);
  const target = toModified ? run.modified : run.original;
  const after = toModified ? run.modifiedAfter : run.originalAfter;
  const before = toModified ? run.modifiedBefore : run.originalBefore;
  const wanted = source === null ? '' : sourceText.slice(source.start, source.end);

  /** The edit, or why the line it would write is refused. */
  const checked = (start: number, end: number, text: string): { target: AlignedSide; edit: WordEdit } | WordMergeRefusal => {
    const verdict = checkWordEdit(reader, { side: sourceSide, line: sourceLine, text: sourceText, span: source }, { side: targetSide, line: targetLine, text: targetText }, start, end, text);
    return verdict ?? { target: targetSide, edit: { line: targetLine, startColumn: start + 1, endColumn: end + 1, text } };
  };

  if (target !== null && source !== null) return checked(target.start, target.end, wanted);
  if (target !== null) {
    // Remove the words with the blank in front of them, or behind them at the start of the line.
    let start = target.start;
    let end = target.end;
    while (start > 0 && /\s/.test(targetText[start - 1])) start--;
    if (start === 0) while (end < targetText.length && /\s/.test(targetText[end])) end++;
    return checked(start, end, '');
  }
  if (source === null) return 'noWord';
  if (targetText.trim() === '') return checked(targetText.length, targetText.length, wanted);
  // The target lacks the words: they go in behind the word before, or in front of the word
  // after; with a blank where the line has blanks or the dialect needs one, else packed, and
  // with a blank after all when packed words would read differently (review NC-13).
  const glues = /\s/.test(targetText) || reader.blankRequired(targetSide) ? [' '] : ['', ' '];
  for (const glue of glues) {
    const result = after !== null ? checked(after, after, glue + wanted) : checked(before ?? 0, before ?? 0, wanted + glue);
    if (result !== 'joins') return result;
  }
  return 'joins';
}

/**
 * Why the line `target.text` with `[start, end)` replaced by `text` must not be written, or
 * null when it may (the checks of `wordMergePlan`).
 */
function checkWordEdit(
  reader: PairReader,
  source: { side: AlignedSide; line: number; text: string; span: WordSpan | null },
  target: { side: AlignedSide; line: number; text: string },
  start: number,
  end: number,
  text: string,
): WordMergeRefusal | null {
  const words = (tokens: readonly NcToken[]): NcToken[] => tokens.filter((t) => t.kind !== 'whitespace' && t.end > t.start);
  const sourceWords = words(reader.tokens(source.side, source.line, source.text));
  const targetWords = words(reader.tokens(target.side, target.line, target.text));
  const resultWords = words(reader.tokens(target.side, target.line, target.text.slice(0, start) + text + target.text.slice(end)));

  // The line reads as what it kept around the edit plus the words copied, each as written.
  const span = source.span;
  const expected = [
    ...targetWords.filter((t) => t.end <= start),
    ...(span === null ? [] : sourceWords.filter((t) => t.start >= span.start && t.end <= span.end)),
    ...targetWords.filter((t) => t.start >= end),
  ];
  if (expected.length !== resultWords.length || expected.some((t, k) => t.text !== resultWords[k].text)) return 'joins';

  // No address more often than on either line before, none of the shared ones missing.
  const count = (list: readonly NcToken[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const token of list) {
      const address = addressOf(token);
      if (address !== null) counts.set(address, (counts.get(address) ?? 0) + 1);
    }
    return counts;
  };
  const inSource = count(sourceWords);
  const inTarget = count(targetWords);
  const inResult = count(resultWords);
  for (const [address, n] of inResult) if (n > Math.max(inSource.get(address) ?? 0, inTarget.get(address) ?? 0)) return 'moved';
  for (const address of inTarget.keys()) if (inSource.has(address) && !inResult.has(address)) return 'moved';
  return null;
}
