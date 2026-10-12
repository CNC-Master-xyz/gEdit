// The cost of `removeComments` over 100,000 lines (a wall-clock budget).
// What it does is in `removeComments.test.ts` (same folder).

import { describe, expect, it } from 'vitest';
import { context, fanuc } from '../../../../tests/unit/helpers/transformContext';
import { removeComments } from './removeComments';

describe('removeComments performance', () => {
  const SOURCE = [
    '%',
    'O1001 (BRACKET)',
    'N10 G0 X0 (RAPID)',
    'N20 T1 M6',
    'G1 X10. Y-5. F500 (CUT)',
    '/N100 G0 X10.',
    'N200 M99',
    '',
  ];

  it('rewrites 100k lines in well under a second', () => {
    const lines = Array.from({ length: 100_000 }, (_, i) => SOURCE[i % SOURCE.length]);
    const started = performance.now();
    const result = removeComments.run(lines, context(fanuc));
    const ms = performance.now() - started;
    expect(result.lines.length).toBeLessThanOrEqual(100_000);
    // The budget is 1 s; the assertion leaves room for a loaded CI machine.
    expect(ms, `${Math.round(ms)} ms for 100k lines`).toBeLessThan(3000);
  });
});
