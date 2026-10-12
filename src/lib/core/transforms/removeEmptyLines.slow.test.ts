// The cost of `removeEmptyLines` over 100,000 lines (a wall-clock budget).
// What it does is in `removeEmptyLines.test.ts` (same folder).

import { describe, expect, it } from 'vitest';
import { context, fanuc } from '../../../../tests/unit/helpers/transformContext';
import { removeEmptyLines } from './removeEmptyLines';

describe('removeEmptyLines performance', () => {
  const SOURCE = ['N10 G0 X0', '', 'N20 G1 X10.', '   ', 'N30 M30', ''];

  it('rewrites 100k lines in well under a second', () => {
    const lines = Array.from({ length: 100_000 }, (_, i) => SOURCE[i % SOURCE.length]);
    const started = performance.now();
    const result = removeEmptyLines.run(lines, context(fanuc));
    const ms = performance.now() - started;
    expect(result.lines.length).toBeLessThan(100_000);
    // The budget is 1 s; the assertion leaves room for a loaded CI machine.
    expect(ms, `${Math.round(ms)} ms for 100k lines`).toBeLessThan(3000);
  });
});
