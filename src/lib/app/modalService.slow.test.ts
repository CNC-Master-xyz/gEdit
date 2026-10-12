// The cost of one idle slice of the modal service on a 300,000-line document (a wall-clock budget).
// The service's behaviour is in `modalService.test.ts` (same folder).

import { describe, expect, it } from 'vitest';
import { expectWithin } from '../../../tests/unit/helpers/budget';
import { harness, program } from '../../../tests/unit/helpers/modalServiceHarness';

describe('the modal service', () => {
  it('P3.4: one idle slice of a 300k-line document returns within 8 ms plus the line it is on (wall clock, median of seven)', () => {
    const h = harness();
    h.add(program(300_000));
    h.idleOnce(); // warm up (regexes compile on first use)
    const runs: number[] = [];
    for (let i = 0; i < 7; i++) {
      const started = performance.now();
      h.idleOnce();
      runs.push(performance.now() - started);
    }
    expect(h.idlePending(), 'the build is far from done after eight slices').toBe(1);
    runs.sort((a, b) => a - b);
    expectWithin(runs[3], 8 + 4, 'one idle slice, median of seven');
  });
});
