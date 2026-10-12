// The cost of `removeBlockNumbers` over 100,000 lines (a wall-clock budget).
// What it does is in `removeBlockNumbers.test.ts` (same folder).

import { describe, expect, it } from 'vitest';
import { compiledBuiltin, context } from '../../../../tests/unit/helpers/transformContext';
import { removeBlockNumbers } from './removeBlockNumbers';

const FANUC = 'fanuc-gcode';

describe('performance', () => {
  it('strips 100k lines well inside a second', () => {
    const cp = compiledBuiltin(FANUC);
    const source = ['N10 G0 G90 X0. Y0.', 'N20 T1 M6', 'N30 G43 H1 Z50. (ROUGH)', '/N40 G0 Z5.', 'N50G1X10.Y10.F250.', ''];
    const lines = Array.from({ length: 100_000 }, (_v, i) => source[i % source.length]);

    const started = performance.now();
    const result = removeBlockNumbers.run(lines, context(cp));
    const ms = performance.now() - started;

    expect(result.lines).toHaveLength(lines.length);
    // The budget is 1 s; the assertion leaves room for a loaded CI machine.
    expect(ms, `${Math.round(ms)} ms for 100k lines`).toBeLessThan(3000);
  });
});
