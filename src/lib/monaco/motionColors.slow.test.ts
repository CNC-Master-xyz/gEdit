// The cost of one update of the motion marks at 300,000 lines, with the states known (wall-clock budgets).
// What the marks are is in `motionColors.test.ts` (same folder).

import { describe, expect, it } from 'vitest';
import { MOTION_BUDGETS } from '$lib/core/nc/motion';
import { expectWithin, fastest } from '../../../tests/unit/helpers/budget';
import { fakeIndex, harness, marked, millProgram, started, MILL } from '../../../tests/unit/helpers/motionHarness';

describe('the budget at 300k lines', () => {
  it('one update with the states known costs at most 4 ms, and marks at most 1,000 lines', () => {
    const program = millProgram(MOTION_BUDGETS.lines);
    const index = fakeIndex(program, MILL);
    const h = harness(program, { index, visible: { first: 150_000, last: 150_060 } });
    const { colors } = started(h);
    colors.flush();
    expect(marked(h).size).toBeGreaterThan(100);
    expect(marked(h).size).toBeLessThanOrEqual(MOTION_BUDGETS.maxMarks);
    // The harness's modal answer is the real index (one reader walk), the lines are sliced from the array.
    const ms = fastest(15, () => {
      h.edit();
      colors.flush();
    });
    expectWithin(ms, MOTION_BUDGETS.updateMs, 'one update of the motion marks at 300k lines');
    // Near the end of the document, where the walk is the longest from a snapshot.
    h.scrollTo(299_900, 299_960);
    const end = fastest(15, () => {
      h.edit();
      colors.flush();
    });
    expectWithin(end, MOTION_BUDGETS.updateMs, 'one update at the end of a 300k-line program');
  });
});
