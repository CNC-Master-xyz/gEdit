// The cost of the aligned diff on large programs (wall-clock budgets; the rules are in
// `alignedDiff.test.ts`, the same folder). The view recomputes the alignment a moment after the
// last keystroke. The normalization it runs on is review mode's own (about 1.5 s for two
// sides of 100,000 lines, not budgeted here); what is budgeted is this package's part: the
// diff and the fillers. The word marks are drawn in slices from the pairs (budgeted the way
// `wordDiff` is).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expectWithin } from '../../../../tests/unit/helpers/budget';
import { cpOf } from '../../../../tests/unit/helpers/compareProfiles';
import { normalizeLines, prepareNormalize } from './index';
import { alignSides, alignedMarkPairs, blockRows, fillers, makePairReader, matchLines, type AlignedDiff } from './aligned';
import type { CompareOptions } from './types';

const LINES = 100_000;
const cp = cpOf('fanuc');
const DEFAULTS: CompareOptions = {
  ignoreBlockNumbers: true,
  ignoreWhitespace: true,
  ignoreComments: false,
  ignoreCase: false,
  ignoreNumberFormat: true,
  ignoreCycleNames: false,
};

/** 100,000 distinct lines in the style of the fixture post. */
function program(): string[] {
  const source = readFileSync(
    fileURLToPath(new URL('../../../../tests/fixtures/compare/x5-repost/original.nc', import.meta.url)),
    'utf8',
  )
    .split('\n')
    .filter((line) => line !== '');
  return Array.from({ length: LINES }, (_, i) => `N${i * 10} ${source[i % source.length]} X${i}.`);
}

function side(lines: string[], o: CompareOptions) {
  const n = normalizeLines(lines, cp, o);
  return { lineCount: lines.length, normalized: n.lineMap.length === 0 ? [] : n.text.split('\n'), lineMap: n.lineMap };
}

/** The lines of every row are accounted for, and the panes are level: the cheap proof for a big diff. */
function level(diff: AlignedDiff, a: number, b: number): void {
  let rows = 0;
  for (const block of diff.blocks) for (const _ of blockRows(diff, block)) rows++;
  let fa = 0;
  let fb = 0;
  for (const f of fillers(diff)) {
    if (f.side === 'original') fa += f.lines;
    else fb += f.lines;
  }
  expect(a + fa).toBe(rows);
  expect(b + fb).toBe(rows);
}

describe('budget', () => {
  it('aligns 100,000 lines with a change, an insertion and a removal every few dozen lines in one second', () => {
    const a = program();
    const b: string[] = [];
    for (let i = 0; i < a.length; i++) {
      // The post renumbered by 5 and added a header line; the changes sit on top of that.
      const line = a[i].replace(/^N\d+/, `N${i * 10 + 5}`);
      if (i % 131 === 0) continue; // removed
      b.push(i % 53 === 0 ? line.replace(/F\d+/, 'F999') + ' M8' : line);
      if (i % 97 === 0) b.push('G4 P500'); // inserted
    }
    const t0 = performance.now();
    const sa = side(a, DEFAULTS);
    const sb = side(b, DEFAULTS);
    const normalizeMs = performance.now() - t0;
    const started = performance.now();
    const diff = alignSides(sa, sb);
    const rows = fillers(diff);
    const ms = performance.now() - started;
    void normalizeMs;
    expect(diff.changed.length).toBeGreaterThan(1500);
    expect(rows.length).toBeGreaterThan(1000);
    level(diff, a.length, b.length);
    expectWithin(ms, 1000, `align and fillers of 100,000 lines: ${ms.toFixed(0)} ms`);
  });

  it('finds the marks of the changed pairs of that diff in two seconds', () => {
    const a = program();
    const b = a.map((line, i) => (i % 7 === 0 ? `${line} F${i % 50}` : line));
    const diff = alignSides(side(a, DEFAULTS), side(b, DEFAULTS));
    const wordSide = (lines: string[]) => ({ cp, ctx: prepareNormalize(lines, cp), lines });
    const reader = makePairReader(wordSide(a), wordSide(b), DEFAULTS);
    const started = performance.now();
    let pairs = 0;
    for (const _ of alignedMarkPairs(diff, reader)) pairs++;
    const ms = performance.now() - started;
    expect(pairs).toBe(Math.ceil(LINES / 7));
    expectWithin(ms, 2000, `${pairs} pairs with marks: ${ms.toFixed(0)} ms`);
  });

  it('aligns two programs that share nothing (one giant changed block) in one second', () => {
    const a = program();
    const b = a.map((line) => line.replace(/X/g, 'Y'));
    const sa = side(a, DEFAULTS);
    const sb = side(b, DEFAULTS);
    const started = performance.now();
    const diff = alignSides(sa, sb);
    const rows = fillers(diff);
    const ms = performance.now() - started;
    expect(diff.changed).toHaveLength(1);
    expect(rows).toEqual([]);
    level(diff, a.length, b.length);
    expectWithin(ms, 1000, `one giant block of 100,000 lines: ${ms.toFixed(0)} ms`);
  });

  it('does not stall on 100,000 lines that are all the same (nothing is unique: Myers is capped)', () => {
    const a = Array.from({ length: LINES }, () => 'M5');
    const b = Array.from({ length: LINES - 1 }, () => 'M5');
    const started = performance.now();
    const m = matchLines(a, b);
    const ms = performance.now() - started;
    expect(m.a).toHaveLength(LINES - 1);
    expect(ms).toBeLessThan(2000);

    // The same two letters over and over, with 5,000 lines in the middle in another order:
    // more edits than Myers will search for, so the middle is one block and the ends match.
    const c = Array.from({ length: LINES }, (_, i) => (i % 2 === 0 ? 'P' : 'Q'));
    let seed = 1;
    const d = c.map((line, i) => {
      if (i < 40_000 || i >= 45_000) return line;
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % 2 === 0 ? 'P' : 'Q';
    });
    const t2 = performance.now();
    const m2 = matchLines(c, d);
    expect(performance.now() - t2).toBeLessThan(3000);
    expect(m2.a.length).toBeGreaterThanOrEqual(LINES - 5000);
    expect(m2.a.length).toBeLessThan(LINES);
  });
});
