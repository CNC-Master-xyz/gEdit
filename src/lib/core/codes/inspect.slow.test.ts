// The cost of the inspector on a block deep in a 300,000-line program (wall-clock budgets).
// What it reads is in `inspect.test.ts` (same folder).

import { describe, expect, it } from 'vitest';
import { expectWithin, fastest } from '../../../../tests/unit/helpers/budget';
import { mv, state, viewOf } from '../../../../tests/unit/helpers/inspectView';
import { blockRange, inspectBlock, type InspectInput } from './inspect';

describe('the budget (X17: the inspector updates within 30 ms per cursor move)', () => {
  it('inspects a block deep in a 300k-line program in a few milliseconds', () => {
    const view = viewOf('fanuc-lathe');
    const lines = Array.from({ length: 300_000 }, (_, i) => `N${i + 1} G1 X${(i % 90) + 10}.5 Z-${i % 50}. F0.2`);
    const input: InspectInput = { line: 150_000, lineCount: lines.length, getLine: (n) => lines[n - 1] };
    const after = state({ feedUnit: 'per-rev', distance: 'absolute', groups: { motion: mv('G1', 150_000), feedmode: mv('G99') } });
    const ms = fastest(5, () => inspectBlock(input, view, after, after));
    expectWithin(ms, 10, 'inspectBlock at line 150,000 of 300,000');
  });

  it('stops a block that never ends after MAX_BLOCK_LINES each way', () => {
    const view = viewOf('heidenhain-klartext');
    const lines = Array.from({ length: 5_000 }, (_, i) => `  Q${200 + (i % 100)}=${i} ~`);
    const input: InspectInput = { line: 2_500, lineCount: lines.length, getLine: (n) => lines[n - 1] };
    expect(blockRange(input, view.cp)).toEqual({ first: 2_000, last: 3_000 });
    const ms = fastest(3, () => inspectBlock(input, view, null, state()));
    expectWithin(ms, 30, 'inspectBlock over 1,001 continued lines');
  });
});
