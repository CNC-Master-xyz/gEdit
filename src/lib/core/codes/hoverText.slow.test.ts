// The cost of a hover at line 300,000 of a program (a wall-clock budget).
// What a hover says is in `hoverText.test.ts` (same folder).

import { describe, expect, it } from 'vitest';
import { expectWithin, fastest } from '../../../../tests/unit/helpers/budget';
import { IS_B, hoverIn, openDoc, plain } from '../../../../tests/unit/helpers/hoverDoc';

describe('hoverText in context: the budget', () => {
  it('answers a hover at line 300,000 within 50 ms, the two states included', () => {
    const block = ['G00 X40. Z2.', 'G01 Z-20. F0.2', 'X42.', 'G00 Z2.'];
    const lines: string[] = ['G21 G99', 'G50 S2500', 'G96 S200 M03'];
    while (lines.length < 299_998) lines.push(block[lines.length % block.length]);
    lines.push('G76 P020060 Q80 R0.03', 'G76 X18.16 Z-18. P920 Q250 F1.5');
    const doc = openDoc('fanuc-lathe', lines.join('\n'), IS_B);
    expect(doc.lines.length).toBe(300_000);
    let text = '';
    const ms = fastest(5, () => {
      text = hoverIn(doc, 300_000, 'F1.5');
    });
    expect(plain(text)).toContain('F — thread lead (G76)');
    expectWithin(ms, 50, 'hover with its modal context at line 300,000');
    const table = fastest(5, () => {
      text = hoverIn(doc, 300_000, 'G76');
    });
    expect(plain(text)).toContain('block 2 of 2');
    expectWithin(table, 50, 'hover with the cycle table at line 300,000');
  });
});
