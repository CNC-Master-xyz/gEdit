// The cost of patching a channel resolution after an edit in a 300,000-line program (wall-clock budgets).
// What the patch must equal is in `incremental.test.ts` (same folder).

import { describe, expect, it } from 'vitest';
import { expectWithin, fastest } from '../../../../tests/unit/helpers/budget';
import { resolution, single } from '../../../../tests/unit/helpers/channelIncremental';
import { cpOf } from '../../../../tests/unit/helpers/profiles';
import { patchResolution, type LineResolution } from './incremental';

const lathe = cpOf('fanuc-lathe');

describe('patchResolution', () => {
  it('patches one keystroke in a 300k-line program with 20,000 waits in a few milliseconds (G7, F2)', () => {
    const lines: string[] = ['%'];
    for (const channel of ['1', '2']) {
      lines.push(`O210${channel}`);
      for (let i = 1; i <= 150_000; i++) lines.push(i % 15 === 0 ? `M${900 + (i % 100)} P12` : `G01 X${i % 80}.25 Z-${i % 40}. F0.2`);
    }
    lines.push('M30', '%');
    const prev = resolution('big.nc', lines, single) as NonNullable<ReturnType<typeof resolution>>;
    expect(prev.marks.length).toBe(20_000);
    const at = 70_000;
    const typed = [...lines];
    typed[at - 1] += '1';
    let out: LineResolution | null = null;
    const ms = fastest(5, () => {
      out = patchResolution(prev, { startLine: at, endLineOld: at, endLineNew: at }, typed.length, (a, b) => typed.slice(a - 1, b), lathe, single);
    });
    expect(out).not.toBeNull();
    // A new line shifts every later wait: the worst case, still far below a frame.
    const inserted = [...lines.slice(0, at), 'G01 X1.', ...lines.slice(at)];
    const msShift = fastest(5, () => {
      out = patchResolution(prev, { startLine: at, endLineOld: at, endLineNew: at + 1 }, inserted.length, (a, b) => inserted.slice(a - 1, b), lathe, single);
    });
    expect((out as unknown as LineResolution).marks.length).toBe(20_000);
    expectWithin(ms, 5, 'patched resolution, one keystroke, 300k lines');
    expectWithin(msShift, 10, 'patched resolution, one inserted line, 300k lines, 10,000 waits shifted');
  });
});
