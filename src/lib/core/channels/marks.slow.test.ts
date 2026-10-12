// The cost of `resolveDocument` on a 300,000-line program (a wall-clock budget).
// The rules it applies are in `marks.test.ts` (same folder).

import { describe, expect, it } from 'vitest';
import { expectWithin, fastest } from '../../../../tests/unit/helpers/budget';
import { fanucWait, singleFile as single } from '../../../../tests/unit/helpers/channelRules';
import { cpOf } from '../../../../tests/unit/helpers/profiles';
import { resolveDocument } from './marks';
import type { ChannelParams } from './types';

const lathe = cpOf('fanuc-lathe');

describe('resolveDocument', () => {
  it('resolves 300,000 lines with two rules within the budget (G7: 150 ms; asserted below 500 ms)', () => {
    const p: ChannelParams = {
      ...single,
      syncMarks: [fanucWait('digits'), { id: 'm1', label: 'm', semantics: 'count', match: { kind: 'codes', codes: 'M100' }, partners: { kind: 'all' } }],
    };
    const body = ['G01 X52.4 Z-30.2 F0.25', 'G00 X56. Z2. (RETRACT)', 'M901 P12', 'G01 Z-12.5 F0.1', 'M100', 'T0303 (OD FINISH)'];
    const lines: string[] = [];
    for (let i = 0; lines.length < 300_000; i++) {
      if (i % 5000 === 0) lines.push(i % 10000 === 0 ? 'O1001' : 'O2001');
      lines.push(body[i % body.length]);
    }
    let marks = 0;
    const ms = fastest(2, () => {
      marks = resolveDocument('big.nc', lines, lathe, p).marks.length;
    });
    expect(marks).toBe(20_000);
    expectWithin(ms, 500, '300k-line resolution, two rules');
  });
});
