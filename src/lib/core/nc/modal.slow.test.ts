// Wall-clock cost of the `ModalIndex` at 300,000 lines (the G7 budgets of X17). The index's contract
// is in `modal.test.ts` (same folder).

import { describe, expect, it } from 'vitest';
import { expectWithin, fastest } from '../../../../tests/unit/helpers/budget';
import { indexOver, program } from '../../../../tests/unit/helpers/modalIndex';
import { SNAPSHOT_EVERY } from './modal';

describe('ModalIndex', () => {
  it('builds a 300k-line program in well under the G7 budget (X17: < 1.5 s in node, asserted < 4 s)', () => {
    const lines = program(300_000);
    const index = indexOver(lines, SNAPSHOT_EVERY);
    const started = performance.now();
    while (!index.buildSome(1_000_000));
    const ms = performance.now() - started;
    expect(index.ready()).toBe(true);
    expect(ms, `${Math.round(ms)} ms for 300k lines`).toBeLessThan(4000);
  });

  it('answers within 1,000 lines of a snapshot in ≤ 15 ms, and applies a change in ≤ 1 ms (X17)', () => {
    const lines = program(300_000);
    const index = indexOver(lines, SNAPSHOT_EVERY);
    while (!index.buildSome(1_000_000));
    let n = 0;
    // The worst case: 999 lines past a snapshot, and a reader that cannot continue its walk.
    const ms = fastest(5, () => {
      n = (n + 7) % 290;
      expect(index.stateAfter(1000 * (n + 1) + 999)).not.toBeNull();
    });
    expectWithin(ms, 15, 'stateAfter 999 lines past a snapshot at 300k lines');
    const range = fastest(5, () => {
      expect(index.statesAfter(150_000, 150_999)).toHaveLength(1000);
    });
    expectWithin(range, 30, 'statesAfter of 1,000 lines at 300k lines');
    const change = fastest(5, () => index.applyChange(150_500, lines.length, (k) => lines[k - 1]));
    expectWithin(change, 1, 'applyChange at 300k lines');
  });

  it('returns from buildSome(8) within its budget plus one line (wall clock, median of seven)', () => {
    const lines = program(300_000);
    const index = indexOver(lines, SNAPSHOT_EVERY);
    index.buildSome(1); // warm up (regexes compile on first use)
    const runs: number[] = [];
    for (let i = 0; i < 7; i++) {
      const started = performance.now();
      index.buildSome(8);
      runs.push(performance.now() - started);
    }
    expect(index.ready()).toBe(false);
    runs.sort((a, b) => a - b);
    expectWithin(runs[3], 8 + 4, 'buildSome(8), median of seven');
  });
});
