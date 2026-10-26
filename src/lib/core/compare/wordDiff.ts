// Word marks in the comparison (Phase 4 plan AD-52, §6.7 rule 17; X30). Written by the P4e
// prelude; implemented by P4.24, which draws the marks in `monaco/diff.ts`.
//
// Inside a changed line pair, mark the whole NC word that differs (`F1200` → `F1000` marks both
// words, not the two digits), as each side's tokenizer reads the line. The rules (binding):
//
//  1. The words of a line are its tokens other than `whitespace`, each a unit: a word with its
//     value, a block number, a keyword, a comment, a string, a variable. A token is never split.
//  2. Two words are equal when their text is equal; with `ignoreCase` when it is equal
//     ignoring case, except inside a `"…"` string, which keeps its case (the review option
//     `ignoreCase` does the same: Sinumerik tool names are case-sensitive).
//  3. The two word lists are aligned by a longest common subsequence; a word outside it is
//     changed and marked whole, **except** an address word that only moved: an unaligned
//     address word (a letter with a number, `X10`, `G1`) outside an expression whose text is
//     also an unaligned word on the other side is not marked on either side (`X10 Y20` against
//     `Y20 X10` marks nothing). Operators, variables, brackets and the words next to an
//     operator are never cancelled, so swapped operands are marked (`R1=R2-R3` against
//     `R1=R3-R2`; review NC-9).
//  4. More than `WORD_DIFF_MAX_WORDS` words on a side: no word marks for that pair (the line
//     stays marked as Monaco marks it).
//  5. In review mode the lines are the normalized ones the view shows (AD-52), tokenized with
//     the side's profile; in the raw view the lines as written.
//  6. **Parts of a long word** (review NC-8). A cycle call, an expression or a comment is one
//     word (`CYCLE800(1,"TABLE",0,57,…)`, `X[#1+#2]`, `X=AC(5)`, `(TOOL 1)`), so rule 3 marks
//     it whole however little changed. Where one changed word faces exactly one changed word
//     on the other side (a gap of the alignment with one marked word on each side), both are
//     split into parts (`wordParts`: a run of letters, digits, `.`, `_`, `#`, `$`; a quoted
//     string; any other character alone; blanks between), and when both have at least
//     `PART_MIN` parts and start with the same part (the same cycle, address or bracket), the
//     parts that differ are marked as well (`WordMarks.parts`), by the same longest common
//     subsequence over the parts that reach into the stretch where the two texts differ (the
//     characters both start and end with are cut first), neighbouring changed parts joined. The whole word stays marked: it is still
//     the unit a word copy copies. A word whose text is not its written text (a number the
//     review options rewrote, `X=AC(5.0)` read as `X=AC(5)`) gets no parts.
//
// The algorithm, in the order the code reads: take the words of each side; give each distinct
// text a number; cut the words both lines start and end with; align what is left by the
// textbook longest common subsequence (a table of suffix lengths, walked forward, so the
// earliest alignment wins a tie); the words outside it are changed; of those, cancel the
// ones that only moved (below). That is all: no heuristics, no similarity scores.
//
// A word that only moved is cancelled per text, not per word: `n` unaligned words with the
// same text on one side and `m` on the other cancel `min(n, m)` of each (the first ones), so
// `X1 X1 Y` against `X1` still marks the removed `X1`. Only a word that may move is counted
// (`movable`): an address word with a literal value, with no operator next to it.
//
// Where the pairs come from (P4.24, `monaco/diff.ts`): the lines of one change of the diff are
// paired in order, as far as the shorter side goes; the rest are whole added or removed lines
// and get no word marks. While word marks show, Monaco's own character marks inside a changed
// line are not drawn, so the two kinds never stack.

import { tokenizeLine } from '$lib/core/nc/tokenizer';
import type { LineState, NcToken } from '$lib/core/nc/types';
import type { CompiledProfile } from '$lib/core/profiles/types';

/** The most words per side of a pair that is marked word by word. */
export const WORD_DIFF_MAX_WORDS = 500;

/** A marked word: UTF-16 offsets into the line, `end` exclusive (the token's `start`/`end`). */
export interface WordSpan {
  start: number;
  end: number;
}

export interface WordMarks {
  original: WordSpan[];
  modified: WordSpan[];
  /**
   * Rule 6: inside a long marked word (a cycle call, an expression, a comment), the parts that
   * differ, as spans of the line like the words; absent when no word has any.
   */
  parts?: { original: WordSpan[]; modified: WordSpan[] };
}

/** Rule 6: a word is split into parts only when both words have at least this many. */
export const PART_MIN = 3;
/** Rule 6: a word of more parts than this is not split (the line stays marked by whole words). */
export const PART_MAX = 200;

/** Rule 6: a character of a run part: a letter, a digit, `.`, `_`, `#` or `$`. */
function runChar(c: number): boolean {
  return (
    (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 46 || c === 95 || c === 35 || c === 36
  );
}

/** A blank between parts (a space, a tab, any other ASCII control or space character). */
function blank(c: number): boolean {
  return c <= 32;
}

/**
 * The parts of `text` (rule 6) as two lists of offsets, `starts[k]`..`ends[k]`; null when it has
 * more than `PART_MAX`. A hand-written scan, not a regular expression: it runs for every pair of
 * long words, so it allocates no match per part.
 */
function scanParts(text: string): { starts: number[]; ends: number[] } | null {
  const starts: number[] = [];
  const ends: number[] = [];
  const length = text.length;
  let i = 0;
  while (i < length) {
    const c = text.charCodeAt(i);
    if (blank(c)) {
      i++;
      continue;
    }
    if (starts.length >= PART_MAX) return null;
    starts.push(i);
    if (c === 34 || c === 39) {
      // A quoted string up to its closing quote (or the end of the word) is one part.
      const close = text.indexOf(text[i], i + 1);
      i = close < 0 ? length : close + 1;
    } else if (runChar(c)) {
      i++;
      while (i < length && runChar(text.charCodeAt(i))) i++;
    } else {
      i++;
    }
    ends.push(i);
  }
  return { starts, ends };
}

/** The parts of `text` (rule 6), as offsets into it; empty for a text of more than `PART_MAX` parts. */
export function wordParts(text: string): WordSpan[] {
  const found = scanParts(text);
  return found === null ? [] : found.starts.map((start, k) => ({ start, end: found.ends[k] }));
}

/** Upper case outside `"…"` strings: how the review option `ignoreCase` folds a line. */
function foldCase(text: string): string {
  if (!text.includes('"')) return text.toUpperCase();
  return text
    .split('"')
    .map((part, i) => (i % 2 === 0 ? part.toUpperCase() : part))
    .join('"');
}

/** The words of a line: its tokens other than whitespace (rule 1). */
function wordsOf(tokens: readonly NcToken[]): NcToken[] {
  return tokens.filter((token) => token.kind !== 'whitespace' && token.end > token.start);
}

/**
 * An address word that may only have moved (rule 3): a `word` with an address and a literal
 * value, not next to an operator (so not an operand of an expression). `words` are the
 * line's words in order, `k` the word asked about.
 */
function movable(words: readonly NcToken[], k: number): boolean {
  const word = words[k];
  if (word.kind !== 'word' || !word.address || word.value == null) return false;
  return words[k - 1]?.kind !== 'operator' && words[k + 1]?.kind !== 'operator';
}

/**
 * Which words of `a` and `b` (as numbers, equal number = equal word) are outside a longest
 * common subsequence. Returns one flag per word: true = changed. Rule 3, first half.
 */
function unaligned(a: readonly number[], b: readonly number[]): [Uint8Array, Uint8Array] {
  const outA = new Uint8Array(a.length);
  const outB = new Uint8Array(b.length);
  // The words both lines start and end with are aligned without a table: most changed NC
  // lines differ in one or two words, so the table is usually a handful of cells.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const n = a.length - head - tail;
  const m = b.length - head - tail;
  if (n === 0 || m === 0) {
    outA.fill(1, head, head + n);
    outB.fill(1, head, head + m);
    return [outA, outB];
  }
  // lcs[i * (m + 1) + j] = length of the longest common subsequence of a[i..] and b[j..].
  const width = m + 1;
  const lcs = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    const row = i * width;
    const below = row + width;
    const wordA = a[head + i];
    // `right` is lcs[i][j + 1], carried along the row so each cell reads two others, not three.
    let right = 0;
    for (let j = m - 1; j >= 0; j--) {
      let here: number;
      if (wordA === b[head + j]) {
        here = lcs[below + j + 1] + 1;
      } else {
        const down = lcs[below + j];
        here = down >= right ? down : right;
      }
      lcs[row + j] = here;
      right = here;
    }
  }
  // Walk it forward: a pair of equal words is aligned; otherwise drop the word whose
  // removal keeps the longer subsequence (the word of `a` on a tie).
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[head + i] === b[head + j]) {
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      outA[head + i++] = 1;
    } else {
      outB[head + j++] = 1;
    }
  }
  while (i < n) outA[head + i++] = 1;
  while (j < m) outB[head + j++] = 1;
  return [outA, outB];
}

/** What rules 1–3 find in a pair of lines. */
interface Analysis {
  a: NcToken[];
  b: NcToken[];
  /** The words as numbers (equal number = equal word, rule 2). */
  wa: number[];
  wb: number[];
  /** Outside the longest common subsequence (before moved words are cancelled). */
  rawA: Uint8Array;
  rawB: Uint8Array;
  /** Marked: `raw` minus the words that only moved. */
  changedA: Uint8Array;
  changedB: Uint8Array;
}

/** Rules 1–4; null when a side has more than `WORD_DIFF_MAX_WORDS` words (rule 4). */
function analyse(original: readonly NcToken[], modified: readonly NcToken[], o: { ignoreCase?: boolean }): Analysis | null {
  const a = wordsOf(original);
  const b = wordsOf(modified);
  if (a.length > WORD_DIFF_MAX_WORDS || b.length > WORD_DIFF_MAX_WORDS) return null;

  // Rule 2: a word is the number of its text.
  const numbers = new Map<string, number>();
  const numberOf = (token: NcToken): number => {
    const text = o.ignoreCase ? foldCase(token.text) : token.text;
    let n = numbers.get(text);
    if (n === undefined) {
      n = numbers.size;
      numbers.set(text, n);
    }
    return n;
  };
  const wa = a.map(numberOf);
  const wb = b.map(numberOf);

  const [rawA, rawB] = unaligned(wa, wb);
  const changedA = rawA.slice();
  const changedB = rawB.slice();

  // Rule 3, second half: of the changed words, those that only moved are cancelled.
  // `waiting[n]` = the changed words of text `n` of `b` not yet used to cancel one of `a`.
  const waiting = new Map<number, number[]>();
  for (let k = 0; k < wb.length; k++) {
    if (!changedB[k] || !movable(b, k)) continue;
    const list = waiting.get(wb[k]);
    if (list) list.push(k);
    else waiting.set(wb[k], [k]);
  }
  for (let k = 0; k < wa.length; k++) {
    if (!changedA[k] || !movable(a, k)) continue;
    const partner = waiting.get(wa[k])?.shift();
    if (partner === undefined) continue;
    changedA[k] = 0;
    changedB[partner] = 0;
  }
  return { a, b, wa, wb, rawA, rawB, changedA, changedB };
}

/**
 * Rule 6: the parts that differ between two words that face each other, as spans of their
 * lines; null when the words are not split (too few parts, a different first part, a text that
 * is not the written one, or no part that differs).
 *
 * Only the parts in the stretch where the two texts differ are compared: the characters both
 * texts start and end with are cut first, and a part that reaches into what is left is in it.
 * So a cycle call of forty arguments with one changed compares one or two parts, not eighty.
 */
function partMarks(a: NcToken, b: NcToken, o: { ignoreCase?: boolean }): { original: WordSpan[]; modified: WordSpan[] } | null {
  const ta = a.text;
  const tb = b.text;
  if (ta.length !== a.end - a.start || tb.length !== b.end - b.start) return null;
  // What is compared: the texts, folded like the words where `ignoreCase` says so (and where
  // folding keeps every character in its place).
  let fa = ta;
  let fb = tb;
  if (o.ignoreCase) {
    const x = foldCase(ta);
    const y = foldCase(tb);
    if (x.length === ta.length && y.length === tb.length) {
      fa = x;
      fb = y;
    }
  }
  if (fa === fb) return null;
  const pa = scanParts(ta);
  const pb = scanParts(tb);
  if (pa === null || pb === null || pa.starts.length < PART_MIN || pb.starts.length < PART_MIN) return null;
  // The same first part: the same cycle, the same address, the same bracket.
  if (pa.starts[0] !== pb.starts[0] || pa.ends[0] !== pb.ends[0] || fa.slice(pa.starts[0], pa.ends[0]) !== fb.slice(pb.starts[0], pb.ends[0])) {
    return null;
  }
  // The stretch where the texts differ: `[head, length - tail)` of each.
  const shorter = Math.min(fa.length, fb.length);
  let head = 0;
  while (head < shorter && fa.charCodeAt(head) === fb.charCodeAt(head)) head++;
  let tail = 0;
  while (tail < shorter - head && fa.charCodeAt(fa.length - 1 - tail) === fb.charCodeAt(fb.length - 1 - tail)) tail++;
  // A part that runs across an end of the stretch on either side (`#2` against `#22`) is in it
  // on both sides: the stretch grows to that part's start, or to its end.
  for (const parts of [pa, pb]) {
    for (let k = 0; k < parts.starts.length; k++) if (parts.starts[k] < head && parts.ends[k] > head) head = parts.starts[k];
  }
  for (const [parts, length] of [
    [pa, fa.length],
    [pb, fb.length],
  ] as const) {
    const end = length - tail;
    for (let k = 0; k < parts.starts.length; k++) if (parts.starts[k] < end && parts.ends[k] > end) tail = Math.min(tail, length - parts.ends[k]);
  }
  /** The parts of a side that reach into its stretch, as indexes. */
  const inStretch = (parts: { starts: number[]; ends: number[] }, to: number): number[] => {
    const out: number[] = [];
    for (let k = 0; k < parts.starts.length; k++) if (parts.ends[k] > head && parts.starts[k] < to) out.push(k);
    return out;
  };
  const ka = inStretch(pa, fa.length - tail);
  const kb = inStretch(pb, fb.length - tail);
  const numbers = new Map<string, number>();
  const numberOf = (text: string): number => {
    let n = numbers.get(text);
    if (n === undefined) {
      n = numbers.size;
      numbers.set(text, n);
    }
    return n;
  };
  const na = ka.map((k) => numberOf(fa.slice(pa.starts[k], pa.ends[k])));
  const nb = kb.map((k) => numberOf(fb.slice(pb.starts[k], pb.ends[k])));
  const [changedA, changedB] = unaligned(na, nb);
  // Neighbouring changed parts make one span (with the blanks between them).
  const spans = (token: NcToken, parts: { starts: number[]; ends: number[] }, indexes: readonly number[], changed: Uint8Array): WordSpan[] => {
    const out: WordSpan[] = [];
    for (let i = 0; i < indexes.length; i++) {
      if (!changed[i]) continue;
      const k = indexes[i];
      const last = out[out.length - 1];
      if (last !== undefined && i > 0 && changed[i - 1] && indexes[i - 1] === k - 1) last.end = token.start + parts.ends[k];
      else out.push({ start: token.start + parts.starts[k], end: token.start + parts.ends[k] });
    }
    return out;
  };
  const marks = { original: spans(a, pa, ka, changedA), modified: spans(b, pb, kb, changedB) };
  return marks.original.length === 0 && marks.modified.length === 0 ? null : marks;
}

/** The words that differ between two lines (rules 1–4), as spans of each line, with the parts of rule 6. */
export function wordDiff(
  original: readonly NcToken[],
  modified: readonly NcToken[],
  o: { ignoreCase?: boolean } = {},
): WordMarks {
  const none: WordMarks = { original: [], modified: [] };
  const found = analyse(original, modified, o);
  if (found === null) return none;
  const { a, b, rawA, rawB, changedA, changedB } = found;

  const spans = (words: readonly NcToken[], changed: Uint8Array): WordSpan[] => {
    const out: WordSpan[] = [];
    for (let k = 0; k < words.length; k++) if (changed[k]) out.push({ start: words[k].start, end: words[k].end });
    return out;
  };
  const marks: WordMarks = { original: spans(a, changedA), modified: spans(b, changedB) };
  if (marks.original.length === 0 && marks.modified.length === 0) return none;

  // Rule 6: each gap of the alignment with exactly one marked word on each side.
  const parts: { original: WordSpan[]; modified: WordSpan[] } = { original: [], modified: [] };
  for (let i = 0, j = 0; ; i++, j++) {
    let onlyA = -1;
    let onlyB = -1;
    let countA = 0;
    let countB = 0;
    for (; i < a.length && rawA[i]; i++) {
      if (changedA[i]) {
        onlyA = i;
        countA++;
      }
    }
    for (; j < b.length && rawB[j]; j++) {
      if (changedB[j]) {
        onlyB = j;
        countB++;
      }
    }
    if (countA === 1 && countB === 1) {
      const inner = partMarks(a[onlyA], b[onlyB], o);
      if (inner) {
        parts.original.push(...inner.original);
        parts.modified.push(...inner.modified);
      }
    }
    if (i >= a.length || j >= b.length) break;
  }
  if (parts.original.length > 0 || parts.modified.length > 0) marks.parts = parts;
  return marks;
}

/**
 * One place where two lines differ (P4.25, the word merge of the aligned diff): the marked
 * words of each side that copy together. A side with no marked word there is `null`.
 */
export interface WordRun {
  /** The run's marked words on each side, from the start of the first to the end of the last. */
  original: WordSpan | null;
  modified: WordSpan | null;
  /**
   * Where words would go on a side that has none in this run: the end of the word before
   * the run, or (when the run is at the start of the line) the start of the word after it;
   * null when that side has no such word.
   */
  originalAfter: number | null;
  originalBefore: number | null;
  modifiedAfter: number | null;
  modifiedBefore: number | null;
}

/**
 * The address of an address word (`X`, `G`, `SB`), in upper case; null for every other token.
 * What the word merge pairs and counts (review NC-1).
 */
export function addressOf(token: NcToken): string | null {
  return token.kind === 'word' && token.address ? token.address.toUpperCase() : null;
}

/**
 * The runs of difference between two lines, from the same alignment as `wordDiff` (rules
 * 1–4; more than `WORD_DIFF_MAX_WORDS` words on a side: none). The rules (review NC-1 and the
 * owner's answer of 2026-10-17):
 *
 *  1. A marked address word whose address occurs exactly once on each line pairs with the
 *     word of that address on the other line, wherever it stands: copying it replaces that
 *     word in place (`F100` at the end against `F200` behind `G1`).
 *  2. The other marked words group by the gaps of the alignment: the words both lines share
 *     pair up in order, so gap `k` of one side faces gap `k` of the other.
 *  3. A run never spans a token that is not in it: a word that only moved, a paired word whose
 *     partner stands in another gap, or (with `text`) a token the options drop, such as an
 *     ignored comment, splits it. So copying a run never copies or wipes a word it does not show.
 *  4. A gap that is one piece on each side is one run: its words copy as a whole. A gap split
 *     on a side gives a run per pair of rule 1 and one per remaining piece, which faces nothing
 *     on the other side (an insertion or a removal there).
 *
 * `text` is the two lines as written, for the dropped tokens of rule 3; without it the words
 * are all the tokens of the lines but their blanks. A run is no proof that a copy is right:
 * the word merge checks the line it would write (`wordMergePlan` in `aligned.ts`).
 */
export function wordRuns(
  original: readonly NcToken[],
  modified: readonly NcToken[],
  o: { ignoreCase?: boolean } = {},
  text?: { original: string; modified: string },
): WordRun[] {
  const found = analyse(original, modified, o);
  if (found === null) return [];
  const { a, b, wa, wb, rawA, rawB, changedA, changedB } = found;

  // The gaps of the alignment: gap `g` lies in front of the g-th word both lines share.
  interface Gap {
    fromA: number;
    toA: number;
    fromB: number;
    toB: number;
  }
  const gaps: Gap[] = [];
  const gapA = new Int32Array(a.length).fill(-1);
  const gapB = new Int32Array(b.length).fill(-1);
  for (let i = 0, j = 0; ; i++, j++) {
    const fromA = i;
    const fromB = j;
    while (i < a.length && rawA[i]) gapA[i++] = gaps.length;
    while (j < b.length && rawB[j]) gapB[j++] = gaps.length;
    gaps.push({ fromA, toA: i, fromB, toB: j });
    if (i >= a.length || j >= b.length) break;
  }

  // Rule 1: the marked address words whose address occurs once on each line, as pairs.
  const partnerA = new Int32Array(a.length).fill(-1);
  const partnerB = new Int32Array(b.length).fill(-1);
  const once = (words: readonly NcToken[]): Map<string, number> => {
    const seen = new Map<string, number>();
    for (let k = 0; k < words.length; k++) {
      const address = addressOf(words[k]);
      if (address !== null) seen.set(address, seen.has(address) ? -1 : k);
    }
    return seen;
  };
  const onceB = once(b);
  for (const [address, i] of once(a)) {
    const j = onceB.get(address);
    if (i < 0 || j === undefined || j < 0 || !changedA[i] || !changedB[j] || wa[i] === wb[j]) continue;
    partnerA[i] = j;
    partnerB[j] = i;
  }

  const runs: WordRun[] = [];
  const afterOf = (words: readonly NcToken[], k: number): number | null => (k > 0 ? words[k - 1].end : null);
  const beforeOf = (words: readonly NcToken[], k: number): number | null => (k < words.length ? words[k].start : null);
  const spanOf = (words: readonly NcToken[], from: number, to: number): WordSpan => ({
    start: words[from].start,
    end: words[to - 1].end,
  });
  const pairRun = (i: number, j: number): WordRun => ({
    original: spanOf(a, i, i + 1),
    modified: spanOf(b, j, j + 1),
    originalAfter: afterOf(a, i),
    originalBefore: beforeOf(a, i + 1),
    modifiedAfter: afterOf(b, j),
    modifiedBefore: beforeOf(b, j + 1),
  });

  // Rule 1 across gaps: a pair whose words stand in different gaps is a run of its own.
  for (let i = 0; i < a.length; i++) if (partnerA[i] >= 0 && gapB[partnerA[i]] !== gapA[i]) runs.push(pairRun(i, partnerA[i]));

  /** Rule 3: the pieces of a side's gap, as `[from, to)` word ranges. */
  const piecesOf = (
    words: readonly NcToken[],
    changed: Uint8Array,
    partner: Int32Array,
    gapSelf: Int32Array,
    gapOther: Int32Array,
    line: string | undefined,
    from: number,
    to: number,
  ): [number, number][] => {
    const pieces: [number, number][] = [];
    let start = -1;
    for (let k = from; k <= to; k++) {
      const inRun = k < to && changed[k] === 1 && (partner[k] < 0 || gapOther[partner[k]] === gapSelf[k]);
      const joined =
        inRun && start >= 0 && (line === undefined || line.slice(words[k - 1].end, words[k].start).trim() === '');
      if (start >= 0 && !joined) {
        pieces.push([start, k]);
        start = -1;
      }
      if (inRun && start < 0) start = k;
    }
    return pieces;
  };

  for (const gap of gaps) {
    const piecesA = piecesOf(a, changedA, partnerA, gapA, gapB, text?.original, gap.fromA, gap.toA);
    const piecesB = piecesOf(b, changedB, partnerB, gapB, gapA, text?.modified, gap.fromB, gap.toB);
    if (piecesA.length === 0 && piecesB.length === 0) continue;
    if (piecesA.length <= 1 && piecesB.length <= 1) {
      // Rule 4: one piece facing one piece (or nothing) copies as a whole.
      runs.push({
        original: piecesA.length > 0 ? spanOf(a, piecesA[0][0], piecesA[0][1]) : null,
        modified: piecesB.length > 0 ? spanOf(b, piecesB[0][0], piecesB[0][1]) : null,
        originalAfter: afterOf(a, gap.fromA),
        originalBefore: beforeOf(a, gap.toA),
        modifiedAfter: afterOf(b, gap.fromB),
        modifiedBefore: beforeOf(b, gap.toB),
      });
      continue;
    }
    // Rule 4, a split gap: each pair alone, each remaining piece against nothing. The piece
    // goes in on the other side behind the partner of the last pair in front of it, or at
    // the start of the gap.
    const split = (side: 'original' | 'modified'): void => {
      const isA = side === 'original';
      const words = isA ? a : b;
      const other = isA ? b : a;
      const partner = isA ? partnerA : partnerB;
      const fromOther = isA ? gap.fromB : gap.fromA;
      let anchor = -1;
      for (const [from, to] of isA ? piecesA : piecesB) {
        let start = -1;
        for (let k = from; k <= to; k++) {
          const paired = k < to && partner[k] >= 0;
          if (start >= 0 && (k === to || paired)) {
            const after = anchor >= 0 ? other[anchor].end : afterOf(other, fromOther);
            const before = anchor >= 0 ? beforeOf(other, anchor + 1) : beforeOf(other, fromOther);
            const span = spanOf(words, start, k);
            runs.push(
              isA
                ? { original: span, modified: null, originalAfter: afterOf(a, start), originalBefore: beforeOf(a, k), modifiedAfter: after, modifiedBefore: before }
                : { original: null, modified: span, originalAfter: after, originalBefore: before, modifiedAfter: afterOf(b, start), modifiedBefore: beforeOf(b, k) },
            );
            start = -1;
          }
          if (k === to) break;
          if (paired) {
            if (isA) runs.push(pairRun(k, partner[k]));
            anchor = partner[k];
          } else if (start < 0) start = k;
        }
      }
    };
    split('original');
    split('modified');
  }

  // In line order (the original side first, then the modified side).
  const at = (run: WordRun): [number, number] => [
    run.original?.start ?? run.originalAfter ?? run.originalBefore ?? 0,
    run.modified?.start ?? run.modifiedAfter ?? run.modifiedBefore ?? 0,
  ];
  return runs.sort((x, y) => {
    const [x0, x1] = at(x);
    const [y0, y1] = at(y);
    return x0 - y0 || x1 - y1;
  });
}

// ---------------------------------------------------------------------------
// The lines of a diff
// ---------------------------------------------------------------------------

/** One block of Monaco's line diff (`DiffLineChange`): an empty side has `…EndLineNumber` 0. */
export interface LineBlock {
  originalStartLineNumber: number;
  originalEndLineNumber: number;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
}

/** One side of the lines being compared: the lines (1-based) and the profile that reads them. */
export interface PairSide {
  cp: CompiledProfile;
  line(n: number): string;
}

/** A pair of lines that has marks. */
export interface PairMarks {
  originalLine: number;
  modifiedLine: number;
  marks: WordMarks;
}

/** How many lines a side of a block has. */
function lineCount(start: number, end: number): number {
  return end === 0 ? 0 : Math.max(0, end - start + 1);
}

/**
 * The marks of every pair of a diff, lazily, so a caller can stop between pairs (a large
 * diff is marked in slices, not in one blocking loop). The lines of one block are paired in
 * order as far as the shorter side goes; the rest are whole added or removed lines and are
 * not looked at. Only pairs that have marks are yielded.
 *
 * A side's lines are tokenized in sequence, with the state of the line above, so a Klartext
 * line that continues the one before it (`~`) reads as a continuation, not as a new block.
 */
export function* wordMarkPairs(
  blocks: readonly LineBlock[],
  original: PairSide,
  modified: PairSide,
  o: { ignoreCase?: boolean } = {},
): Generator<PairMarks> {
  const stateAbove = (side: PairSide, first: number): LineState | undefined =>
    first > 1 ? tokenizeLine(side.line(first - 1), side.cp).state : undefined;
  for (const block of blocks) {
    const count = Math.min(
      lineCount(block.originalStartLineNumber, block.originalEndLineNumber),
      lineCount(block.modifiedStartLineNumber, block.modifiedEndLineNumber),
    );
    if (count === 0) continue;
    let stateO = stateAbove(original, block.originalStartLineNumber);
    let stateM = stateAbove(modified, block.modifiedStartLineNumber);
    for (let k = 0; k < count; k++) {
      const originalLine = block.originalStartLineNumber + k;
      const modifiedLine = block.modifiedStartLineNumber + k;
      const readO = tokenizeLine(original.line(originalLine), original.cp, stateO);
      const readM = tokenizeLine(modified.line(modifiedLine), modified.cp, stateM);
      stateO = readO.state;
      stateM = readM.state;
      const marks = wordDiff(readO.tokens, readM.tokens, o);
      if (marks.original.length > 0 || marks.modified.length > 0) yield { originalLine, modifiedLine, marks };
    }
  }
}
