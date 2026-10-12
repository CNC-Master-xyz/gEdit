// The cost of normalizing two 100,000-line sides for a compare (wall-clock budgets).
// The rules are in `compare.test.ts` (same folder).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expectWithin } from '../../../../tests/unit/helpers/budget';
import { PROFILES, cpOf } from '../../../../tests/unit/helpers/compareProfiles';
import { compareDefaults, normalizeLines } from './index';

describe('budget', () => {
  it('normalizes two 100k-line sides in a second', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../../../tests/fixtures/compare/x5-repost/original.nc', import.meta.url)),
      'utf8',
    )
      .split('\n')
      .filter((line) => line !== '');
    const a = Array.from({ length: 100_000 }, (_, i) => source[i % source.length]);
    // A jump in the middle makes the block-number walk read the whole file.
    a[50_000] = 'N99990 IF[#1LT5]GOTO100';
    const b = a.map((line) => line.replace(/\.(?=\s|$)/g, '.000'));
    const cp = cpOf('fanuc');
    const o = compareDefaults(PROFILES.fanuc);
    normalizeLines(a.slice(0, 1000), cp, o);
    const started = performance.now();
    const left = normalizeLines(a, cp, o);
    const right = normalizeLines(b, cp, o);
    const ms = performance.now() - started;
    expect(left.text).toBe(right.text);
    expectWithin(ms, 1000, `two 100k-line sides: ${ms.toFixed(0)} ms`);
  });

  it('normalizes two 100k-line Klartext sides with the cycle names ignored in a second (#148)', () => {
    const block = [
      'CYCL DEF 200 BOHREN ~',
      '    Q200=2 ;SICHERHEITS-ABST. ~',
      '    Q201=-20 ;TIEFE',
      'CYCL DEF 9.1 V.ZEIT 1.5',
      'CYCL DEF 7.1 X+10',
      'L X+10 Y-5,5 R0 FMAX M99',
      'TOOL CALL 3 Z S3000',
      '* - ROUGH',
    ];
    const a = Array.from({ length: 100_000 }, (_, i) => `${i} ${block[i % block.length].trimStart()}`.replace(/^\d+ (Q)/, '    $1'));
    const b = a.map((line) => line.replace('BOHREN', 'DRILLING').replace('V.ZEIT', 'DWELL'));
    const cp = cpOf('klartext');
    const o = { ...compareDefaults(PROFILES.klartext), ignoreCycleNames: true };
    normalizeLines(a.slice(0, 1000), cp, o);
    const started = performance.now();
    const left = normalizeLines(a, cp, o);
    const right = normalizeLines(b, cp, o);
    const ms = performance.now() - started;
    expect(left.text).toBe(right.text);
    expectWithin(ms, 1000, `two 100k-line Klartext sides, cycle names ignored: ${ms.toFixed(0)} ms`);
  });
});
