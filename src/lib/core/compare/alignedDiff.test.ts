// The aligned NC-aware diff (Phase 4 plan X30, P4.25): the alignment on normalized lines, the
// rows and fillers that keep the panes level, the word marks under the review options, and the
// plans of the three merges. The drawing is `monaco/alignedView.test.ts`, the editing and its
// undo are `app/compareAligned.test.ts`.

import { describe, expect, it } from 'vitest';
import { cpOf, type ProfileKey } from '../../../../tests/unit/helpers/compareProfiles';
import { normalizeLines, normalizedWords, prepareNormalize } from './index';
import {
  alignSides,
  alignedMarkPairs,
  blockAt,
  blockRows,
  copyRowPlan,
  facingRows,
  fillers,
  lineChangeOf,
  makePairReader,
  matchLines,
  neighbourBlock,
  realignDelay,
  REALIGN_DELAY_MAX_MS,
  REALIGN_DELAY_MS,
  rowMergePlan,
  rowOf,
  wordMergePlan,
  type AlignedDiff,
  type AlignInput,
  type PairReader,
} from './aligned';
import type { CompareOptions } from './types';
import { copyModes, extendedOffsetP, modeChanges, modeDifferences, COPY_MODE_KINDS } from './aligned';
import { ModalIndex } from '$lib/core/nc/modal';
import { ctx as modalCtx } from '../../../../tests/unit/helpers/modalIndex';

const cp = cpOf('fanuc');

const NONE: CompareOptions = {
  ignoreBlockNumbers: false,
  ignoreWhitespace: false,
  ignoreComments: false,
  ignoreCase: false,
  ignoreNumberFormat: false,
  ignoreCycleNames: false,
};
const DEFAULTS: CompareOptions = { ...NONE, ignoreBlockNumbers: true, ignoreWhitespace: true, ignoreNumberFormat: true };

function side(lines: string[], o: CompareOptions): AlignInput {
  const normalized = normalizeLines(lines, cp, o);
  return {
    lineCount: lines.length,
    normalized: normalized.text === '' && normalized.lineMap.length === 0 ? [] : normalized.text.split('\n'),
    lineMap: normalized.lineMap,
  };
}

function align(a: string[], b: string[], o: CompareOptions = DEFAULTS): AlignedDiff {
  return alignSides(side(a, o), side(b, o));
}

/** A compact picture of the blocks: `kind original[start+count] modified[start+count]`. */
function picture(diff: AlignedDiff): string[] {
  return diff.blocks.map((b) => `${b.kind} ${b.originalStart}+${b.originalCount} ${b.modifiedStart}+${b.modifiedCount}`);
}

const PROGRAM = ['O1000 (TEST)', 'N10 G90 G54', 'N20 G0 X0 Y0', 'N30 G1 X10. F1200', 'N40 G1 X20.', 'N50 M30'];

/** What every alignment must satisfy, whatever the text (the invariants the view relies on). */
function checkInvariants(diff: AlignedDiff, a: string[], b: string[], o: CompareOptions): void {
  const seen = { original: [] as number[], modified: [] as number[] };
  let rows = 0;
  for (const block of diff.blocks) {
    let blockRowsCount = 0;
    for (const [x, y] of blockRows(diff, block)) {
      blockRowsCount++;
      if (x !== 0) seen.original.push(x);
      if (y !== 0) seen.modified.push(y);
    }
    rows += blockRowsCount;
    if (block.kind === 'same') expect(block.originalCount).toBe(block.modifiedCount);
    if (block.kind === 'ignored') {
      for (let k = 0; k < block.originalCount; k++) expect(diff.kept.original[block.originalStart + k]).toBe(0);
      for (let k = 0; k < block.modifiedCount; k++) expect(diff.kept.modified[block.modifiedStart + k]).toBe(0);
    }
    if (block.kind === 'changed') {
      let kept = 0;
      for (let k = 0; k < block.originalCount; k++) kept += diff.kept.original[block.originalStart + k];
      for (let k = 0; k < block.modifiedCount; k++) kept += diff.kept.modified[block.modifiedStart + k];
      expect(kept).toBeGreaterThan(0);
    }
  }
  // Every line of each side is in exactly one row, in order.
  expect(seen.original).toEqual(Array.from({ length: a.length }, (_, i) => i + 1));
  expect(seen.modified).toEqual(Array.from({ length: b.length }, (_, i) => i + 1));
  // The panes are level: lines plus filler is the number of rows on both sides.
  const filler = { original: 0, modified: 0 };
  for (const f of fillers(diff)) filler[f.side] += f.lines;
  expect(a.length + filler.original).toBe(rows);
  expect(b.length + filler.modified).toBe(rows);
  // Equal under the options means equal after normalization, line by line.
  const na = normalizeLines(a, cp, o);
  const nb = normalizeLines(b, cp, o);
  const textA = (line: number): string | undefined => {
    const i = na.lineMap.indexOf(line);
    return i < 0 ? undefined : na.text.split('\n')[i];
  };
  const textB = (line: number): string | undefined => {
    const i = nb.lineMap.indexOf(line);
    return i < 0 ? undefined : nb.text.split('\n')[i];
  };
  for (const block of diff.blocks) {
    if (block.kind !== 'same') continue;
    for (let k = 0; k < block.originalCount; k++) {
      expect(textA(block.originalStart + k)).toBeDefined();
      expect(textA(block.originalStart + k)).toBe(textB(block.modifiedStart + k));
    }
  }
}

describe('matchLines', () => {
  it('matches what the sides share, in order', () => {
    const m = matchLines(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd', 'e']);
    expect(m.a.map((i, k) => [i, m.b[k]])).toEqual([
      [0, 0],
      [2, 2],
      [3, 3],
    ]);
  });

  it('anchors on lines that occur once on each side, so a repeated line does not pull the diff off', () => {
    // The lines `G1` repeat; the unique lines decide where the insertion is.
    const a = ['A', 'G1', 'G1', 'B', 'G1', 'C'];
    const b = ['A', 'G1', 'G1', 'NEW', 'B', 'G1', 'C'];
    const m = matchLines(a, b);
    expect(m.a.length).toBe(6);
    expect(m.b).toEqual([0, 1, 2, 4, 5, 6]);
  });

  it('is empty for two sides with nothing in common, and for empty sides', () => {
    expect(matchLines(['a'], ['b'])).toEqual({ a: [], b: [] });
    expect(matchLines([], [])).toEqual({ a: [], b: [] });
    expect(matchLines([], ['a'])).toEqual({ a: [], b: [] });
  });

  it('falls back to Myers where nothing is unique, and to one block past its cap', () => {
    const a = ['M5', 'M5', 'M5', 'M8', 'M5', 'M5'];
    const b = ['M5', 'M5', 'M8', 'M5', 'M5', 'M5'];
    const m = matchLines(a, b);
    for (let k = 0; k < m.a.length; k++) expect(a[m.a[k]]).toBe(b[m.b[k]]);
    expect(m.a.length).toBeGreaterThanOrEqual(5);
    // Nothing occurs once, and maxD 1 cannot find the shift: the middle is one block (the ends still match).
    const capped = matchLines(['x', 'P', 'Q', 'P', 'Q', 'y'], ['x', 'Q', 'P', 'Q', 'P', 'y'], { maxD: 1 });
    expect(capped.a).toEqual([0, 5]);
    expect(matchLines(['x', 'P', 'Q', 'P', 'Q', 'y'], ['x', 'Q', 'P', 'Q', 'P', 'y']).a.length).toBeGreaterThan(2);
  });

  it('never matches out of order or unequal lines (random programs)', () => {
    let seed = 7;
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let round = 0; round < 200; round++) {
      const a = Array.from({ length: rand(40) }, () => `L${rand(8)}`);
      const b = Array.from({ length: rand(40) }, () => `L${rand(8)}`);
      const m = matchLines(a, b);
      for (let k = 0; k < m.a.length; k++) {
        expect(a[m.a[k]]).toBe(b[m.b[k]]);
        if (k > 0) {
          expect(m.a[k]).toBeGreaterThan(m.a[k - 1]);
          expect(m.b[k]).toBeGreaterThan(m.b[k - 1]);
        }
      }
    }
  });
});

describe('alignSides', () => {
  it('is one same block for equal programs', () => {
    const diff = align(PROGRAM, PROGRAM);
    expect(picture(diff)).toEqual(['same 1+6 1+6']);
    expect(diff.changed).toEqual([]);
  });

  it('lines up a changed line with the line it replaced', () => {
    const b = [...PROGRAM];
    b[3] = 'N30 G1 X10. F1000';
    const diff = align(PROGRAM, b);
    expect(picture(diff)).toEqual(['same 1+3 1+3', 'changed 4+1 4+1', 'same 5+2 5+2']);
    expect(fillers(diff)).toEqual([]);
  });

  it('puts an inserted line against a filler under the line before it', () => {
    const b = [...PROGRAM.slice(0, 4), 'N35 G1 Y5.', ...PROGRAM.slice(4)];
    const diff = align(PROGRAM, b, NONE);
    expect(picture(diff)).toContain('changed 5+0 5+1');
    expect(fillers(diff)).toEqual([{ side: 'original', afterLine: 4, lines: 1, block: 1 }]);
    checkInvariants(diff, PROGRAM, b, NONE);
  });

  it('puts a removed line against a filler on the other side', () => {
    const b = PROGRAM.filter((_, i) => i !== 2);
    const diff = align(PROGRAM, b, NONE);
    expect(picture(diff)).toEqual(['same 1+2 1+2', 'changed 3+1 3+0', 'same 4+3 3+3']);
    expect(fillers(diff)).toEqual([{ side: 'modified', afterLine: 2, lines: 1, block: 1 }]);
  });

  it('puts an insertion above line 1 and below the last line', () => {
    const top = align(PROGRAM, ['%', ...PROGRAM], NONE);
    expect(fillers(top)).toEqual([{ side: 'original', afterLine: 0, lines: 1, block: 0 }]);
    const bottom = align(PROGRAM, [...PROGRAM, '%'], NONE);
    expect(fillers(bottom)).toEqual([{ side: 'original', afterLine: 6, lines: 1, block: 1 }]);
  });

  it('keeps unequal runs level: a changed block of 3 lines against 1 gets a filler of 2', () => {
    const b = [PROGRAM[0], 'G1 X1.', PROGRAM[5]];
    const diff = align(PROGRAM.slice(0, 1).concat(['G1 X1.', 'G1 X2.', 'G1 X3.'], PROGRAM.slice(5)), b, NONE);
    const f = fillers(diff);
    expect(f.reduce((n, x) => n + x.lines, 0)).toBe(2);
    expect(f[0].side).toBe('modified');
  });

  describe('the review options decide what is a difference', () => {
    const renumbered = PROGRAM.map((line, i) => (i === 0 ? line : line.replace(/^N\d+/, `N${i * 100}`)));

    it('block numbers: a renumbered program is the same program', () => {
      expect(align(PROGRAM, renumbered, DEFAULTS).changed).toEqual([]);
      expect(picture(align(PROGRAM, renumbered, DEFAULTS))).toEqual(['same 1+6 1+6']);
    });

    it('block numbers kept: every renumbered line is a difference', () => {
      const diff = align(PROGRAM, renumbered, NONE);
      expect(diff.changed.length).toBeGreaterThan(0);
      checkInvariants(diff, PROGRAM, renumbered, NONE);
    });

    it('number format: X10.500 against X10.5 is a difference only when the option is off', () => {
      const a = ['G1 X10.500 F100'];
      const b = ['G1 X10.5 F100'];
      expect(align(a, b, { ...NONE, ignoreNumberFormat: true }).changed).toHaveLength(0);
      expect(align(a, b, NONE).changed).toHaveLength(1);
    });

    it('comments: a comment-only line the option drops is an ignored block, no difference', () => {
      const a = ['G1 X1.', '(CHECK THIS)', 'G1 X2.'];
      const b = ['G1 X1.', '(CHECKED)', 'G1 X2.'];
      const o = { ...NONE, ignoreComments: true };
      const diff = align(a, b, o);
      expect(picture(diff)).toEqual(['same 1+1 1+1', 'ignored 2+1 2+1', 'same 3+1 3+1']);
      expect(diff.changed).toEqual([]);
      expect(align(a, b, NONE).changed).toHaveLength(1);
    });

    it('comments: a dropped line next to a real change shares the block and does not shift the pairs', () => {
      const a = ['G1 X1.', '(NOTE)', 'G1 X2. F100', 'G1 X3.'];
      const b = ['G1 X1.', 'G1 X2. F200', 'G1 X3.'];
      const o = { ...NONE, ignoreComments: true };
      const diff = align(a, b, o);
      expect(picture(diff)).toEqual(['same 1+1 1+1', 'changed 2+2 2+1', 'same 4+1 3+1']);
      // The comment has a row of its own; the changed lines share the next one.
      expect([...blockRows(diff, diff.blocks[1])]).toEqual([
        [2, 0],
        [3, 2],
      ]);
      checkInvariants(diff, a, b, o);
    });

    it('case: G1 against g1 is equal when the option is on', () => {
      expect(align(['G1 X1.'], ['g1 x1.'], { ...NONE, ignoreCase: true }).changed).toEqual([]);
      expect(align(['G1 X1.'], ['g1 x1.'], NONE).changed).toHaveLength(1);
    });
  });

  it('holds its invariants for random programs under random options', () => {
    let seed = 99;
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const vocabulary = [
      'G1 X10. F100',
      'G1 X10.0 F100',
      'g1 x10. f100',
      'N10 G1 X10. F100',
      'N20 G1 X10. F100',
      'G0 Z5.',
      '(NOTE ONE)',
      '(NOTE TWO)',
      'G0 Z5. (UP)',
      'M5',
      'M5',
      '',
      'G1X10.F100',
    ];
    const toggles: (keyof CompareOptions)[] = ['ignoreBlockNumbers', 'ignoreWhitespace', 'ignoreComments', 'ignoreCase', 'ignoreNumberFormat'];
    for (let round = 0; round < 150; round++) {
      const a = Array.from({ length: rand(30) + 1 }, () => vocabulary[rand(vocabulary.length)]);
      const b = a.filter(() => rand(5) !== 0);
      for (let k = 0; k < rand(5); k++) b.splice(rand(b.length + 1), 0, vocabulary[rand(vocabulary.length)]);
      if (b.length === 0) b.push('M30');
      const o: CompareOptions = { ...NONE };
      for (const key of toggles) o[key] = rand(2) === 1;
      checkInvariants(align(a, b, o), a, b, o);
    }
  });
});

describe('finding things', () => {
  const a = ['A', 'B', 'C', 'D', 'E', 'F'];
  const b = ['A', 'X', 'C', 'D', 'Y', 'Z', 'F'];
  const diff = alignSides(
    { lineCount: a.length, normalized: a, lineMap: Int32Array.from(a.map((_, i) => i + 1)) },
    { lineCount: b.length, normalized: b, lineMap: Int32Array.from(b.map((_, i) => i + 1)) },
  );

  it('finds the block that holds a line of either side', () => {
    expect(picture(diff)).toEqual(['same 1+1 1+1', 'changed 2+1 2+1', 'same 3+2 3+2', 'changed 5+1 5+2', 'same 6+1 7+1']);
    expect(blockAt(diff.blocks, 'original', 2)?.kind).toBe('changed');
    expect(blockAt(diff.blocks, 'modified', 6)?.modifiedStart).toBe(5);
    expect(blockAt(diff.blocks, 'modified', 99)).toBeNull();
    expect(blockAt(diff.blocks, 'original', 0)).toBeNull();
  });

  it('finds the row a line stands in', () => {
    expect(rowOf(diff, 'modified', 6)).toMatchObject({ row: [0, 6] });
    expect(rowOf(diff, 'original', 3)).toMatchObject({ row: [3, 3] });
  });

  it('goes to the next and the previous difference, round the ends', () => {
    expect(neighbourBlock(diff, 'modified', 1, 'next')?.modifiedStart).toBe(2);
    expect(neighbourBlock(diff, 'modified', 2, 'next')?.modifiedStart).toBe(5);
    expect(neighbourBlock(diff, 'modified', 5, 'next')?.modifiedStart).toBe(2); // wraps
    expect(neighbourBlock(diff, 'modified', 6, 'previous')?.modifiedStart).toBe(5);
    expect(neighbourBlock(diff, 'modified', 2, 'previous')?.modifiedStart).toBe(5); // wraps
    expect(neighbourBlock(alignSides({ lineCount: 0, normalized: [], lineMap: new Int32Array() }, { lineCount: 0, normalized: [], lineMap: new Int32Array() }), 'original', 1, 'next')).toBeNull();
  });

  it('describes a block the way Monaco describes a change (an empty side ends at 0, starts in front)', () => {
    expect(lineChangeOf(diff.changed[0])).toEqual({
      originalStartLineNumber: 2,
      originalEndLineNumber: 2,
      modifiedStartLineNumber: 2,
      modifiedEndLineNumber: 2,
    });
    const insertion = align(['A', 'B'], ['A', 'N', 'B'], NONE).changed[0];
    expect(lineChangeOf(insertion)).toEqual({
      originalStartLineNumber: 1,
      originalEndLineNumber: 0,
      modifiedStartLineNumber: 2,
      modifiedEndLineNumber: 2,
    });
  });
});

describe('the one-row copy', () => {
  const a = ['G1 X1.', '(NOTE)', 'G1 X2. F100', 'G1 X3.'];
  const b = ['G1 X1.', 'G1 X2. F200', 'G1 X3.', 'M30'];
  const o = { ...NONE, ignoreComments: true };
  const diff = align(a, b, o);

  it('pairs by row: the line facing the cursor, not the line at the same position in the block', () => {
    const block = diff.changed[0];
    // Original line 3 faces modified line 2, because the comment line has a row of its own.
    expect(rowMergePlan(diff, block, [3, 2], 'original')).toEqual({ sourceFrom: 3, sourceCount: 1, targetAt: 2, targetRemove: 1 });
    expect(rowMergePlan(diff, block, [3, 2], 'modified')).toEqual({ sourceFrom: 2, sourceCount: 1, targetAt: 3, targetRemove: 1 });
  });

  it('copies a line the other side has no row for in behind the last target line placed, or removes the target line', () => {
    const block = diff.changed[0];
    // The comment (original 2) has no partner: copy to modified inserts it after modified line 1.
    expect(rowMergePlan(diff, block, [2, 0], 'original')).toEqual({ sourceFrom: 2, sourceCount: 1, targetAt: 2, targetRemove: 0 });
    // Copying the (absent) modified side over it removes the original line.
    expect(rowMergePlan(diff, block, [2, 0], 'modified')).toEqual({ sourceFrom: 0, sourceCount: 0, targetAt: 2, targetRemove: 1 });
  });

  it('is found from a Monaco-shaped change and the cursor', () => {
    const change = lineChangeOf(diff.changed[0]);
    expect(copyRowPlan(diff, change, 'original', { side: 'original', line: 3 })).toEqual({
      sourceFrom: 3,
      sourceCount: 1,
      targetAt: 2,
      targetRemove: 1,
    });
    // A cursor next to an empty side lands on the first row.
    expect(copyRowPlan(diff, change, 'original', { side: 'original', line: 99 })?.sourceFrom).toBe(2);
    expect(copyRowPlan(diff, { ...change, originalStartLineNumber: 77 }, 'original', { side: 'original', line: 3 })).toBeNull();
  });
});

describe('normalizedWords', () => {
  it('keeps the offsets of the line as written and drops what the options drop', () => {
    const line = 'N10 G1 X5.50 (CUT)';
    const o = { ...DEFAULTS, ignoreComments: true };
    const { words } = normalizedWords(line, cp, o, prepareNormalize([line], cp));
    expect(words.map((w) => [w.text, line.slice(w.start, w.end)])).toEqual([
      ['G1', 'G1'],
      ['X5.5', 'X5.50'],
    ]);
  });

  it('is every word of the line as written when nothing is ignored', () => {
    const line = 'N10 G1  X5.50 (CUT)';
    const { words } = normalizedWords(line, cp, NONE, prepareNormalize([line], cp));
    expect(words.map((w) => w.text)).toEqual(['N10', 'G1', 'X5.50', '(CUT)']);
  });
});

describe('word marks under the review options', () => {
  function reader(o: CompareOptions, lines: { a: string[]; b: string[] }): PairReader {
    const wordSide = (l: string[]) => ({ cp, ctx: prepareNormalize(l, cp), lines: l });
    return makePairReader(wordSide(lines.a), wordSide(lines.b), o);
  }
  const text = (line: string, spans: { start: number; end: number }[]) => spans.map((s) => line.slice(s.start, s.end));

  it('marks the words that differ on the lines as written', () => {
    const lines = { a: ['N10 G1 X5.50 F100'], b: ['N20 G1 X5.5 F200'] };
    const marks = reader(NONE, lines).marks(1, 1);
    expect(text(lines.a[0], marks.original)).toEqual(['N10', 'X5.50', 'F100']);
    expect(text(lines.b[0], marks.modified)).toEqual(['N20', 'X5.5', 'F200']);
  });

  it('does not mark a block number or a number format the options ignore', () => {
    const lines = { a: ['N10 G1 X5.50 F100'], b: ['N20 G1 X5.5 F200'] };
    const marks = reader(DEFAULTS, lines).marks(1, 1);
    expect(text(lines.a[0], marks.original)).toEqual(['F100']);
    expect(text(lines.b[0], marks.modified)).toEqual(['F200']);
  });

  it('does not mark a comment the option drops, and reads the rest of the line', () => {
    const lines = { a: ['G1 X1. (SLOW)'], b: ['G1 X2. (FAST)'] };
    const marks = reader({ ...NONE, ignoreComments: true }, lines).marks(1, 1);
    expect(text(lines.a[0], marks.original)).toEqual(['X1.']);
    expect(text(lines.b[0], marks.modified)).toEqual(['X2.']);
  });

  it('marks nothing for lines the options make equal', () => {
    const lines = { a: ['n10 g1 x5.50'], b: ['G1 X5.5'] };
    const o = { ...DEFAULTS, ignoreCase: true };
    expect(reader(o, lines).marks(1, 1)).toEqual({ original: [], modified: [] });
  });

  it('yields the pairs of the changed blocks that have marks, lazily', () => {
    const a = ['G1 X1.', 'G1 X2. F100', 'G1 X3.', '(OLD)', 'M30'];
    const b = ['G1 X1.', 'G1 X2. F200', 'G1 X3.', '(NEW)', 'M30'];
    const o = { ...NONE, ignoreComments: true };
    const diff = align(a, b, o);
    const pairs = [...alignedMarkPairs(diff, reader(o, { a, b }))];
    expect(pairs.map((p) => [p.originalLine, p.modifiedLine])).toEqual([[2, 2]]);
  });

  it('does not pair a line the options keep with one they drop', () => {
    const a = ['G1 X1.', 'G1 X2.'];
    const b = ['G1 X1.', '(NOTE)', 'G1 X3.'];
    const o = { ...NONE, ignoreComments: true };
    const diff = align(a, b, o);
    const pairs = [...alignedMarkPairs(diff, reader(o, { a, b }))];
    expect(pairs.map((p) => [p.originalLine, p.modifiedLine])).toEqual([[2, 3]]);
  });
});

describe('the word merge plan', () => {
  function plan(
    lines: { a: string[]; b: string[] },
    cursor: { side: 'original' | 'modified'; line: number; column: number },
    direction: 'toModified' | 'toOriginal',
    o: CompareOptions = DEFAULTS,
  ) {
    const diff = align(lines.a, lines.b, o);
    const wordSide = (l: string[]) => ({ cp, ctx: prepareNormalize(l, cp), lines: l });
    const reader = makePairReader(wordSide(lines.a), wordSide(lines.b), o);
    return wordMergePlan(diff, reader, cursor, direction, {
      original: (n) => lines.a[n - 1],
      modified: (n) => lines.b[n - 1],
    });
  }
  /** Applies a plan's edit to its target line. */
  function applied(lines: { a: string[]; b: string[] }, result: ReturnType<typeof plan>): string {
    if (typeof result === 'string') return result;
    const text = (result.target === 'original' ? lines.a : lines.b)[result.edit.line - 1];
    return text.slice(0, result.edit.startColumn - 1) + result.edit.text + text.slice(result.edit.endColumn - 1);
  }

  it('replaces the word in the target with the source word (to the document, from the original)', () => {
    const lines = { a: ['N10 G1 X10. F1200'], b: ['N10 G1 X10. F1000'] };
    // The cursor is in F1200 of the original (column of the F is 13).
    const result = plan(lines, { side: 'original', line: 1, column: 14 }, 'toModified');
    expect(applied(lines, result)).toBe('N10 G1 X10. F1200');
    expect(typeof result === 'string' ? '' : result.target).toBe('modified');
  });

  it('works the other way too, with the cursor in the other pane', () => {
    const lines = { a: ['N10 G1 X10. F1200'], b: ['N10 G1 X10. F1000'] };
    const result = plan(lines, { side: 'modified', line: 1, column: 14 }, 'toOriginal');
    expect(applied(lines, result)).toBe('N10 G1 X10. F1000');
    expect(typeof result === 'string' ? '' : result.target).toBe('original');
  });

  it('copies a run of words as a whole', () => {
    const lines = { a: ['G1 X1. Y2. Z3. F100'], b: ['G1 X1. Y9. F100'] };
    const result = plan(lines, { side: 'original', line: 1, column: 8 }, 'toModified');
    expect(applied(lines, result)).toBe('G1 X1. Y2. Z3. F100');
  });

  it('inserts words the target lacks behind the word in front of them', () => {
    const lines = { a: ['G1 X1. Y2. F100'], b: ['G1 X1. F100'] };
    const result = plan(lines, { side: 'original', line: 1, column: 8 }, 'toModified');
    expect(applied(lines, result)).toBe('G1 X1. Y2. F100');
  });

  it('inserts at the end of a line', () => {
    const lines = { a: ['G1 X1. F100'], b: ['G1 X1.'] };
    const result = plan(lines, { side: 'original', line: 1, column: 9 }, 'toModified');
    expect(applied(lines, result)).toBe('G1 X1. F100');
  });

  it('removes the words the source does not have, with the blank in front of them', () => {
    const lines = { a: ['G1 X1. F100'], b: ['G1 X1. Y2. F100'] };
    const result = plan(lines, { side: 'modified', line: 1, column: 9 }, 'toOriginal');
    // Copying the modified side's (nothing) over... the source here is the modified, which has Y2.
    expect(applied(lines, result)).toBe('G1 X1. Y2. F100');
    const removal = plan(lines, { side: 'modified', line: 1, column: 9 }, 'toModified');
    expect(applied(lines, removal)).toBe('G1 X1. F100');
  });

  it('removes a first word with the blank behind it', () => {
    const lines = { a: ['G1 X1.'], b: ['G0 G1 X1.'] };
    const removal = plan(lines, { side: 'modified', line: 1, column: 2 }, 'toModified');
    expect(applied(lines, removal)).toBe('G1 X1.');
  });

  it('ignores what the options ignore: a block number is not a run', () => {
    const lines = { a: ['N10 G1 X1.'], b: ['N20 G1 X1.'] };
    expect(plan(lines, { side: 'original', line: 1, column: 2 }, 'toModified')).toBe('noWord');
    const kept = plan(lines, { side: 'original', line: 1, column: 2 }, 'toModified', NONE);
    expect(applied(lines, kept)).toBe('N10 G1 X1.');
  });

  it('refuses with a reason: no marked word at the cursor, no matching line', () => {
    const lines = { a: ['G1 X1. F100', 'M5', 'M30'], b: ['G1 X1. F200', 'M5'] };
    expect(plan(lines, { side: 'original', line: 1, column: 2 }, 'toModified')).toBe('noWord');
    // An identical line has a partner but no changed word; only a line with no partner is `noPair`.
    expect(plan(lines, { side: 'original', line: 2, column: 2 }, 'toModified')).toBe('noWord');
    expect(plan(lines, { side: 'modified', line: 2, column: 2 }, 'toOriginal')).toBe('noWord');
    expect(plan(lines, { side: 'original', line: 3, column: 2 }, 'toModified')).toBe('noPair');
  });

  it('copies only the marked word next to a word that moved, never the moved word twice', () => {
    const lines = { a: ['G1 X1. Y2. F100'], b: ['G1 Y2. X1. F200'] };
    const result = plan(lines, { side: 'modified', line: 1, column: 14 }, 'toOriginal');
    expect(applied(lines, result)).toBe('G1 X1. Y2. F200');
  });

  it('does not offer a run of words that only moved', () => {
    const lines = { a: ['G1 X1. Y2.'], b: ['G1 Y2. X1.'] };
    expect(plan(lines, { side: 'original', line: 1, column: 5 }, 'toModified')).toBe('noWord');
  });
});

// ---------------------------------------------------------------------------
// Review NC-1, NC-7, NC-13: the word copy writes a line that reads right, or refuses
// ---------------------------------------------------------------------------

/**
 * Aligns two programs of dialect `key` and copies the word `word` of line `line` of `side` in
 * `direction`; the target line after the copy, or the refusal. `where.line` gets the target line.
 */
function copyWord(
  key: ProfileKey,
  a: string[],
  b: string[],
  at: { side: 'original' | 'modified'; line: number; word: string },
  direction: 'toModified' | 'toOriginal',
  o: CompareOptions = DEFAULTS,
  where: { line?: number } = {},
): string {
  const kcp = cpOf(key);
  const sideOf = (lines: string[]): AlignInput => {
    const n = normalizeLines(lines, kcp, o);
    return { lineCount: lines.length, normalized: n.text === '' && n.lineMap.length === 0 ? [] : n.text.split('\n'), lineMap: n.lineMap };
  };
  const diff = alignSides(sideOf(a), sideOf(b));
  const wordSide = (lines: string[]) => ({ cp: kcp, ctx: prepareNormalize(lines, kcp), lines });
  const reader = makePairReader(wordSide(a), wordSide(b), o);
  const text = (at.side === 'original' ? a : b)[at.line - 1];
  const column = text.indexOf(at.word) + 2;
  expect(column).toBeGreaterThan(1);
  const result = wordMergePlan(diff, reader, { side: at.side, line: at.line, column }, direction, {
    original: (n) => a[n - 1],
    modified: (n) => b[n - 1],
  });
  if (typeof result === 'string') return result;
  where.line = result.edit.line;
  const line = (result.target === 'original' ? a : b)[result.edit.line - 1];
  return line.slice(0, result.edit.startColumn - 1) + result.edit.text + line.slice(result.edit.endColumn - 1);
}

describe('the word copy keeps every address once (review NC-1)', () => {
  it('replaces a changed word in place when its letter stands once on each line, wherever it stands', () => {
    const a = ['N30 G1 X10. Y20. F100'];
    const b = ['N30 G1 F200 X10. Y20.'];
    expect(copyWord('fanuc', a, b, { side: 'original', line: 1, word: 'F100' }, 'toModified')).toBe('N30 G1 F100 X10. Y20.');
    expect(copyWord('fanuc', a, b, { side: 'modified', line: 1, word: 'F200' }, 'toOriginal')).toBe('N30 G1 X10. Y20. F200');
  });

  it('a changed word that also moved is one copy, not an insertion and a removal', () => {
    const a = ['G1 X10 Y20 Z5'];
    const b = ['G1 Y20 X11 Z5'];
    expect(copyWord('fanuc', a, b, { side: 'original', line: 1, word: 'X10' }, 'toModified')).toBe('G1 Y20 X10 Z5');
    expect(copyWord('fanuc', a, b, { side: 'modified', line: 1, word: 'X11' }, 'toOriginal')).toBe('G1 X11 Y20 Z5');
  });

  it('never copies over a word that only moved, nor drops it', () => {
    const a = ['G1 X10 Y20 Z5 F100'];
    const b = ['G1 Y20 Z6 X10 F200'];
    expect(copyWord('fanuc', a, b, { side: 'original', line: 1, word: 'Z5' }, 'toModified')).toBe('G1 Y20 Z5 X10 F200');
    expect(copyWord('fanuc', a, b, { side: 'modified', line: 1, word: 'Z6' }, 'toOriginal')).toBe('G1 X10 Y20 Z6 F100');
    expect(copyWord('fanuc', a, b, { side: 'original', line: 1, word: 'F100' }, 'toModified')).toBe('G1 Y20 Z6 X10 F100');
  });

  it('Sinumerik: a feed that moved to the front is replaced where it stands', () => {
    const a = ['N10 G1 X10 Z-5 F0.2'];
    const b = ['N10 G1 F0.3 X10 Z-5'];
    expect(copyWord('sinumerik', a, b, { side: 'original', line: 1, word: 'F0.2' }, 'toModified')).toBe('N10 G1 F0.2 X10 Z-5');
  });

  it('refuses a copy that would leave a letter twice or drop one: the line copy is the way', () => {
    // X stands twice on each line, so the changed X words are not paired.
    const a = ['G1 X10 Y20 X30'];
    const b = ['G1 Y20 X11 X30'];
    expect(copyWord('fanuc', a, b, { side: 'original', line: 1, word: 'X10' }, 'toModified')).toBe('moved');
    expect(copyWord('fanuc', a, b, { side: 'modified', line: 1, word: 'X11' }, 'toOriginal')).toBe('moved');
    // Removing a word the source does not have stays a copy.
    expect(copyWord('fanuc', a, b, { side: 'original', line: 1, word: 'X10' }, 'toOriginal')).toBe('G1 Y20 X30');
  });

  it('still copies a changed G word among several (G0 G90 X10 against G0 G91 X10)', () => {
    const a = ['G0 G90 X10'];
    const b = ['G0 G91 X10'];
    expect(copyWord('fanuc', a, b, { side: 'original', line: 1, word: 'G90' }, 'toModified')).toBe('G0 G90 X10');
    expect(copyWord('fanuc', a, b, { side: 'modified', line: 1, word: 'G91' }, 'toOriginal')).toBe('G0 G91 X10');
    // Two M words on a line stay legal.
    expect(copyWord('fanuc', ['M3 M8 S1000'], ['M3 M9 S1000'], { side: 'original', line: 1, word: 'M8' }, 'toModified')).toBe('M3 M8 S1000');
  });
});

describe('rows inside a changed block face by their words (review NC-7)', () => {
  const a = ['G1 X10 F100', 'G1 Y20'];
  const b = ['G0 Z5', 'G1 X10 F200', 'G1 Y21'];

  it('pairs the line that shares a word, not the line at the same place', () => {
    const diff = align(a, b, NONE);
    expect(picture(diff)).toEqual(['changed 1+2 1+3']);
    expect([...blockRows(diff, diff.blocks[0])]).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    // The filler follows the rows: above the first original line.
    expect(fillers(diff)).toEqual([{ side: 'original', afterLine: 0, lines: 1, block: 0 }]);
    checkInvariants(diff, a, b, NONE);
  });

  it('copies the word into the line it faces', () => {
    const where: { line?: number } = {};
    expect(copyWord('fanuc', a, b, { side: 'modified', line: 2, word: 'F200' }, 'toOriginal', NONE, where)).toBe('G1 X10 F200');
    expect(where.line).toBe(1);
  });

  it('facingRows: shared words win, the motion code does not count, the rest face in order', () => {
    expect([...facingRows(['G1 X10 F100', 'G1 Y20'], ['G0 Z5', 'G1 X10 F200', 'G1 Y21'])]).toEqual([1, 2]);
    // Only the motion code in common: in order.
    expect([...facingRows(['G1 X1', 'G1 Y1'], ['G1 X2', 'G1 Y2', 'G1 Z2'])]).toEqual([0, 1]);
    // Packed words are read too.
    expect([...facingRows(['G1X10F100'], ['G0Z5', 'G1X10F200'])]).toEqual([1]);
    // The most shared words win over the first line that shares one.
    expect([...facingRows(['X1 Y2 Z3'], ['X1 Y9 Z9', 'X1 Y2 Z9'])]).toEqual([1]);
    // A block past the cap faces in order.
    const many = Array.from({ length: 70 }, (_, i) => `G1 X${i}`);
    expect(facingRows(many, ['G1 X69', ...many]).slice(0, 2)).toEqual(Int32Array.from([0, 1]));
  });
});

describe('the word copy keeps what it does not copy (review NC-13)', () => {
  it('keeps a comment the options drop between two copied words', () => {
    const a = ['G1 X10 (KEEP) Y20'];
    const b = ['G1 X11 Y21'];
    const o = { ...DEFAULTS, ignoreComments: true };
    expect(copyWord('fanuc', a, b, { side: 'modified', line: 1, word: 'X11' }, 'toOriginal', o)).toBe('G1 X11 (KEEP) Y20');
    expect(copyWord('fanuc', a, b, { side: 'modified', line: 1, word: 'Y21' }, 'toOriginal', o)).toBe('G1 X10 (KEEP) Y21');
  });

  it('keeps a comment between two words of a letter that stands twice: the copy is refused instead', () => {
    const a = ['G1 X10 (KEEP) X20'];
    const b = ['G1 X11 X21'];
    const o = { ...DEFAULTS, ignoreComments: true };
    expect(copyWord('fanuc', a, b, { side: 'modified', line: 1, word: 'X11' }, 'toOriginal', o)).toBe('moved');
  });

  it('puts a blank in front of a word inserted into a line without blanks where names glue', () => {
    expect(copyWord('sinumerik', ['R1=R2+1'], ['R1=R2+1 X5'], { side: 'modified', line: 1, word: 'X5' }, 'toOriginal')).toBe('R1=R2+1 X5');
    expect(copyWord('okuma', ['VC1=VC2+1'], ['VC1=VC2+1 X5'], { side: 'modified', line: 1, word: 'X5' }, 'toOriginal')).toBe('VC1=VC2+1 X5');
    // Packed Fanuc words stay packed.
    expect(copyWord('fanuc', ['G1X10Y20'], ['G1X10Z5Y20'], { side: 'modified', line: 1, word: 'Z5' }, 'toOriginal')).toBe('G1X10Z5Y20');
  });
});

describe('the wait before the view aligns again (review CODE-4)', () => {
  it('stays at a sixth of a second while an alignment is quick', () => {
    expect(REALIGN_DELAY_MS).toBe(150);
    expect(realignDelay(0)).toBe(REALIGN_DELAY_MS);
    expect(realignDelay(5)).toBe(REALIGN_DELAY_MS);
    expect(realignDelay(75)).toBe(REALIGN_DELAY_MS);
    expect(realignDelay(Number.NaN)).toBe(REALIGN_DELAY_MS);
    expect(realignDelay(-1)).toBe(REALIGN_DELAY_MS);
  });

  it('grows to twice the last alignment on a long program, and no further than its limit', () => {
    // 100,000 lines align in about 1.3 s: the wait is 2.6 s, not 150 ms.
    expect(realignDelay(1300)).toBe(2600);
    expect(realignDelay(400)).toBe(800);
    expect(realignDelay(10_000)).toBe(REALIGN_DELAY_MAX_MS);
    expect(realignDelay(Number.POSITIVE_INFINITY)).toBe(REALIGN_DELAY_MS);
  });
});

describe('the modes at the place of a copy (review NC-6)', () => {
  /** The modal state after `line` of `lines`, read by the TS modal interpreter with a built-in profile. */
  function stateAfter(profileId: string, lines: string[], line: number) {
    const { cp, db } = modalCtx(profileId);
    const index = new ModalIndex(cp, db);
    index.reset(lines.length, (n) => lines[n - 1] ?? '');
    while (!index.buildSome(1000));
    return index.stateAfter(line);
  }

  it('reads absolute or incremental, inch or mm, the plane and the work offset, each by its code', () => {
    const modes = copyModes(stateAfter('fanuc-gcode', ['G20 G91 G18 G55', 'G1 X1.'], 1));
    expect(modes).toEqual({
      distance: { value: 'incremental', label: 'G91' },
      units: { value: 'inch', label: 'inch' },
      plane: { value: 'ZX', label: 'G18' },
      offset: { value: 'G55', label: 'G55' },
    });
    expect(COPY_MODE_KINDS).toEqual(['distance', 'units', 'plane', 'offset']);
  });

  it('compares a work offset G54.1 together with its P (WX-NC-7)', () => {
    const one = ['G54.1 P1', 'G1 X1.'];
    const two = ['G54.1 P2', 'G1 X1.'];
    const text = (lines: string[]) => (n: number) => lines[n - 1];
    const a = copyModes(stateAfter('fanuc-gcode', one, 1), text(one));
    const b = copyModes(stateAfter('fanuc-gcode', two, 1), text(two));
    expect(a.offset).toEqual({ value: 'G54.1 P1', label: 'G54.1 P1' });
    expect(modeDifferences(a, b)).toEqual([{ kind: 'offset', source: 'G54.1 P1', target: 'G54.1 P2' }]);
    // The same P, however it is written (P01, no space), is no difference; another offset code is.
    const padded = ['G54.1P01', 'G1 X1.'];
    expect(modeDifferences(a, copyModes(stateAfter('fanuc-gcode', padded, 1), text(padded)))).toEqual([]);
    const plain = ['G55', 'G1 X1.'];
    expect(modeDifferences(a, copyModes(stateAfter('fanuc-gcode', plain, 1), text(plain)))).toEqual([
      { kind: 'offset', source: 'G54.1 P1', target: 'G55' },
    ]);
    // Without the line text, or with a line that names no P, it is the code alone (as before).
    expect(copyModes(stateAfter('fanuc-gcode', one, 1)).offset).toEqual({ value: 'G54.1', label: 'G54.1' });
    expect(copyModes(stateAfter('fanuc-gcode', one, 1), () => 'G54.1').offset?.label).toBe('G54.1');
    expect(extendedOffsetP('G54.1 P12      ')).toBe('12');
    expect(extendedOffsetP('G54 P3')).toBeNull();
    expect(extendedOffsetP('G54.1 P#101')).toBe('#101');
  });

  it('leaves out what is not known, and knows nothing of an unknown state', () => {
    expect(copyModes(null)).toEqual({});
    // Before any line, with no machine: whatever the profile does not assume is left out.
    const start = copyModes(stateAfter('fanuc-gcode', ['G1 X1.'], 0));
    for (const kind of COPY_MODE_KINDS) if (start[kind] !== undefined) expect(start[kind]?.label).not.toBe('');
  });

  it('reads the Sinumerik codes the same way', () => {
    expect(copyModes(stateAfter('sinumerik-mill', ['G70 G91 G19 G56'], 1))).toMatchObject({
      distance: { label: 'G91' },
      units: { value: 'inch' },
      plane: { value: 'YZ', label: 'G19' },
      offset: { label: 'G56' },
    });
  });

  it('lists the modes both sides know and that differ, in order, with each side\'s label', () => {
    const a = copyModes(stateAfter('fanuc-gcode', ['G20 G91 G18 G55'], 1));
    const b = copyModes(stateAfter('fanuc-gcode', ['G21 G90 G18 G54'], 1));
    expect(modeDifferences(a, b)).toEqual([
      { kind: 'distance', source: 'G91', target: 'G90' },
      { kind: 'units', source: 'inch', target: 'mm' },
      { kind: 'offset', source: 'G55', target: 'G54' },
    ]);
    expect(modeDifferences(a, a)).toEqual([]);
    // A mode only one side knows is a difference too: `null` is the side that does not know it (the owner, 2026-10-22).
    expect(modeDifferences(a, { distance: b.distance })).toEqual([
      { kind: 'distance', source: 'G91', target: 'G90' },
      { kind: 'units', source: 'inch', target: null },
      { kind: 'plane', source: 'G18', target: null },
      { kind: 'offset', source: 'G55', target: null },
    ]);
    expect(modeDifferences({}, b)).toEqual([
      { kind: 'distance', source: null, target: 'G90' },
      { kind: 'units', source: null, target: 'mm' },
      { kind: 'plane', source: null, target: 'G18' },
      { kind: 'offset', source: null, target: 'G54' },
    ]);
    // A mode neither side knows is none.
    expect(modeDifferences({}, {})).toEqual([]);
    expect(modeDifferences({ units: a.units }, { units: a.units })).toEqual([]);
  });

  it('lists the modes a copy changed for the lines below it, before and after, in order (the owner, 2026-10-20)', () => {
    const before = copyModes(stateAfter('fanuc-gcode', ['G21 G90 G17 G54'], 1));
    const after = copyModes(stateAfter('fanuc-gcode', ['G21 G90 G17 G54', 'G20 G91'], 2));
    expect(modeChanges(before, after)).toEqual([
      { kind: 'distance', before: 'G90', after: 'G91' },
      { kind: 'units', before: 'mm', after: 'inch' },
    ]);
    expect(modeChanges(before, before)).toEqual([]);
    // A mode that was not known below the copy and is now, or the other way round, is a change (the owner, 2026-10-22).
    expect(modeChanges({ units: before.units }, { units: before.units, distance: after.distance })).toEqual([
      { kind: 'distance', before: null, after: 'G91' },
    ]);
    expect(modeChanges({ units: before.units, distance: before.distance }, { units: before.units })).toEqual([
      { kind: 'distance', before: 'G90', after: null },
    ]);
    expect(modeChanges({}, {})).toEqual([]);
  });
});
