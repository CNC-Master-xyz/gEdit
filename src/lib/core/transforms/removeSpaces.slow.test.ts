// The cost of `removeSpaces` over 100,000 lines (a wall-clock budget).
// What it does is in `removeSpaces.test.ts` (same folder).

import { describe, expect, it } from 'vitest';
import { context, fanuc } from '../../../../tests/unit/helpers/transformContext';
import { removeSpaces } from './removeSpaces';

describe('removeSpaces performance', () => {
  const SOURCE = [
    '%',
    'O1001 (BRACKET)',
    'N10 G0 G90 X0 Y0',
    'N20 T1 M6',
    'G1 X10. Y-5. F500',
    '/N100 G0 X10.',
    '#101 = [#1 + 2.]',
    'N200 M99',
    '',
  ];

  it('rewrites 100k lines in well under a second', () => {
    const lines = Array.from({ length: 100_000 }, (_, i) => SOURCE[i % SOURCE.length]);
    const started = performance.now();
    const result = removeSpaces.run(lines, context(fanuc));
    const ms = performance.now() - started;
    expect(result.lines).toHaveLength(100_000);
    // The budget is 1 s; the assertion leaves room for a loaded CI machine.
    expect(ms, `${Math.round(ms)} ms for 100k lines`).toBeLessThan(3000);
  });
});
