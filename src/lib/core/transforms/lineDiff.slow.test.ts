// The cost of `computeLineEdits` over 100,000 lines (wall-clock budgets).
// What it answers is in `lineDiff.test.ts` (same folder).

import { describe, expect, it } from 'vitest';
import { expectWithin } from '../../../../tests/unit/helpers/budget';
import { computeLineEdits } from './lineDiff';

describe('computeLineEdits: performance', () => {
  it('walks 100k same-length lines in well under 200 ms', () => {
    const oldLines = Array.from({ length: 100_000 }, (_, i) => `N${i * 10} G1 X${i}.5`);
    const newLines = oldLines.map((line, i) => (i % 3 === 0 ? line.replace('G1', 'G01') : line));
    const started = performance.now();
    const edits = computeLineEdits(oldLines, newLines);
    const elapsed = performance.now() - started;
    expect(edits.length).toBe(33_334);
    expectWithin(elapsed, 200, '100k same-length lines');
  });

  it('answers a 100k-line deletion from a lineMap in well under 200 ms', () => {
    const oldLines = Array.from({ length: 100_000 }, (_, i) => (i % 5 === 0 ? '' : `N${i} G1`));
    const newLines: string[] = [];
    const map = new Int32Array(oldLines.length);
    oldLines.forEach((line, i) => {
      if (line === '') {
        map[i] = -1;
        return;
      }
      map[i] = newLines.length;
      newLines.push(line);
    });
    const started = performance.now();
    const edits = computeLineEdits(oldLines, newLines, map);
    const elapsed = performance.now() - started;
    expect(edits.length).toBe(20_000);
    expectWithin(elapsed, 200, '100k-line deletion from a lineMap');
  });
});
