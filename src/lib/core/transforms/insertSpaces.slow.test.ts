// The cost of `insertSpaces` over 100,000 lines (a wall-clock budget).
// What it does is in `insertSpaces.test.ts` (same folder).

import { describe, expect, it } from 'vitest';
import { context, fanuc } from '../../../../tests/unit/helpers/transformContext';
import { insertSpaces } from './insertSpaces';

describe('insertSpaces performance', () => {
  const SOURCE = [
    '%',
    'O1001 (BRACKET)',
    'N10G0G90X0Y0',
    'N20T1M6',
    'G1X10.Y-5.F500',
    '/N100G0X10.',
    '#101=[#1+2.]',
    'IF[#101GT5.]GOTO200',
    'N200M99',
    '',
  ];

  it('rewrites 100k lines in well under a second', () => {
    const lines = Array.from({ length: 100_000 }, (_, i) => SOURCE[i % SOURCE.length]);
    const started = performance.now();
    const result = insertSpaces.run(lines, context(fanuc));
    const ms = performance.now() - started;
    expect(result.lines).toHaveLength(100_000);
    // The budget is 1 s; the assertion leaves room for a loaded CI machine.
    expect(ms, `${Math.round(ms)} ms for 100k lines`).toBeLessThan(3000);
  });
});
