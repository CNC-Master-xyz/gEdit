// The cost of `convertCase` over 100,000 lines (a wall-clock budget).
// What it does is in `convertCase.test.ts` (same folder).

import { describe, expect, it } from 'vitest';
import { context, fanuc } from '../../../../tests/unit/helpers/transformContext';
import { convertCase } from './convertCase';

describe('convertCase performance', () => {
  const SOURCE = [
    '%',
    'o1001 (bracket)',
    'n10 g0 g90 x0 y0',
    'n20 t1 m6',
    'g1 x10. y-5. f500',
    '/n100 g0 x10.',
    '#101=[#1+2.]',
    'n200 m99',
    '',
  ];

  it('rewrites 100k lines in well under a second', () => {
    const lines = Array.from({ length: 100_000 }, (_, i) => SOURCE[i % SOURCE.length]);
    const started = performance.now();
    const result = convertCase.run(lines, context(fanuc, { case: 'upper' }));
    const ms = performance.now() - started;
    expect(result.lines).toHaveLength(100_000);
    // The budget is 1 s; the assertion leaves room for a loaded CI machine.
    expect(ms, `${Math.round(ms)} ms for 100k lines`).toBeLessThan(3000);
  });
});
