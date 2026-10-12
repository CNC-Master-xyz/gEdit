// Wall-clock cost of the tokenizer: 300,000 lines per profile, and the packed-word linearity checks.
// The rules it reads are in `tokenizer.test.ts` (same folder).

import { describe, expect, it } from 'vitest';
import fanucJson from '$lib/data/profiles/fanuc-gcode.json';
import heidenhainJson from '$lib/data/profiles/heidenhain-klartext.json';
import okumaJson from '$lib/data/profiles/okuma-osp.json';
import sinumerikJson from '$lib/data/profiles/sinumerik.json';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import { tokenizeLine } from './tokenizer';
import type { LineState } from './types';
import { expectWithin, fastest } from '../../../../tests/unit/helpers/budget';

const fanuc = compileProfile(fanucJson as unknown as Profile);
const klartext = compileProfile(heidenhainJson as unknown as Profile);
const okuma = compileProfile(okumaJson as unknown as Profile);
const sinumerik = compileProfile(sinumerikJson as unknown as Profile);
const sinumerikMill = compileProfile(
  (BUILTIN_PROFILE_JSON.find((raw) => (raw as Profile).id === 'sinumerik-mill') ?? {}) as Profile,
);

describe('performance', () => {
  function program(lines: number, source: string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < lines; i++) out.push(source[i % source.length].replace('%N%', String((i % 9999) * 10)));
    return out;
  }

  const FANUC_SOURCE = [
    'N%N% G0 G90 X0. Y0.',
    'N%N%T1M6',
    'N%N% G43 Z25. H1 M8 (TOOL 1 - D10 END MILL)',
    'N%N%G1Z-1.F200.',
    'N%N% X50.123 Y-40.5 F1200.',
    'N%N%G98G81X10.Y10.Z-5.R2.F200.',
    '/N%N% #101=[#1+2.]',
    'N%N% IF[#101GT10.]GOTO100',
    'N%N%G0Z25.M9',
    '/1 /3 N%N% #102=SQRT[#1*#1+#2*#2]+FIX[#3]',
    'DPRNT[X#1[53]]',
    '',
  ];
  const KLARTEXT_SOURCE = [
    '%N% L X+50.123 Y-40.5 Z+10 R0 FMAX M3',
    '%N% TOOL CALL 1 Z S3000 F800 ; D10 END MILL',
    '%N% CYCL DEF 200 DRILLING ~',
    '   Q200=2 ;CLEARANCE ~',
    '   Q201=-15 ;DEPTH',
    '%N% CC X+0 Y+0',
    '%N% C X+50 Y+0 DR-',
    '%N% L IX+10 IY-20 F500',
    '%N% * - ROUGHING',
    '%N% PLANE SPATIAL SPA+0 SPB+30 SPC+0 TURN MB MAX FMAX',
    '%N% FUNCTION TCPM F TCP AXIS POS PATHCTRL AXIS REFPNT TIP-TIP',
    '%N% BEGIN PGM 2.5D_MILLING MM',
    '',
  ];

  // The turning dialects run more rules per token than the two above (a label pattern per
  // line, a system-variable and an assignment probe per token), so they carry their own
  // 300k-line budget: the opt-in fields may not cost a second.
  const OKUMA_SOURCE = [
    'N%N% G00 X400 Z300',
    'NLAP1 G85 (BAR TURNING)',
    'N%N% G96 S180 M03',
    'N%N% T0202 (55 DEG INSERT)',
    'N%N% G01 X56.123 Z-40.5 F0.28',
    'N%N% SB=1200 M13',
    'N%N% X=V1+V2 Z=V3',
    '/N%N% IF [V1 EQ 5] GOTO NLAP1',
    'N%N% G04 F2',
    '',
  ];
  const SINUMERIK_SOURCE = [
    'N%N% G18 G95 G90',
    'N%N% T="DRILL_D8" D1',
    'N%N% MSG("ROUGH;FINISH")',
    'N%N% CYCLE83(50,0,2,-25,,-5)',
    'N%N% G1 X56.123 Z-40.5 F0.28 ;CUT',
    'N%N% G26 S3=2500 LIMS=3000',
    'N%N% R1=R2*2 X=AC(10)',
    'LOOP_A: G0 X200 Z200',
    '/1 N%N% $AA_IM[X]',
    ':%N% G1 X1.5EX3 Z-2EX-4',
    '/1 /3 N%N% LIMS[2]=1800 S[SPI]=300 M[2]=3',
    'N%N% T[1]="DRILL_8" FA[X]=200',
    '',
  ];

  it.each([
    ['fanuc-gcode', fanuc, FANUC_SOURCE],
    ['heidenhain-klartext', klartext, KLARTEXT_SOURCE],
    ['okuma-osp', okuma, OKUMA_SOURCE],
    ['sinumerik', sinumerik, SINUMERIK_SOURCE],
    ['sinumerik-mill', sinumerikMill, SINUMERIK_SOURCE],
  ])('tokenizes 300k lines of %s in well under a second', (_id, cp: CompiledProfile, source: string[]) => {
    const lines = program(300_000, source);
    let state: LineState | undefined;
    let tokens = 0;

    const started = performance.now();
    for (const line of lines) {
      const result = tokenizeLine(line, cp, state);
      state = result.state;
      tokens += result.tokens.length;
    }
    const ms = performance.now() - started;

    expect(tokens).toBeGreaterThan(300_000);
    // The budget is 1 s; the assertion leaves room for a loaded CI machine.
    expect(ms, `${Math.round(ms)} ms for 300k lines`).toBeLessThan(3000);
  });

  // A word-separated profile used to ask for the end of the chunk once per character, so
  // a long run of characters that never parses as a value was quadratic: 32k characters
  // of `+-` took 2.2 s, and hover tokenizes a line on every mouse move. The budget below
  // is three orders of magnitude above what the linear scan costs, so it says nothing
  // about the machine and everything about the algorithm.
  it('stays linear on a long line that parses as nothing', () => {
    const lengths = [4000, 8000, 16000, 32000];
    const ms: number[] = [];
    for (const length of lengths) {
      const line = '+-'.repeat(length / 2);
      ms.push(fastest(3, () => tokenizeLine(line, klartext)));
      expect(tokenizeLine(line, klartext).tokens.length, `${length} characters`).toBe(length);
    }
    const worst = Math.max(...ms);
    expectWithin(worst, 250, lengths.map((n, i) => `${n}: ${ms[i].toFixed(1)} ms`).join(', '));
  });

  // G8 M8 review: the same class of cost in a packed dialect. `p` stops at every letter of
  // `G1X1G1X1…`, and the call and the assignment rules each read to the end of the run from
  // there: 32k characters took over three seconds on Sinumerik. The budget is the one
  // above, and the shapes are the runs that no rule takes whole.
  it.each([
    ['G1X1', (n: number) => 'G1X1'.repeat(n / 4)],
    ['R1', (n: number) => 'R1'.repeat(n / 2)],
    ['A1', (n: number) => 'A1'.repeat(n / 2)],
    ['A_1', (n: number) => 'A_1'.repeat(Math.floor(n / 3))],
    ['G1X1 and a bracket behind blanks', (n: number) => `${'G1X1'.repeat(n / 4 - 2)}   (1)`],
    ['G1X1 and an `=` behind blanks', (n: number) => `${'G1X1'.repeat(n / 4 - 2)}   =1`],
    ['V1 in Okuma', (n: number) => 'V1'.repeat(n / 2)],
    // M9: the indexed assignment reads a bracket behind the run, and the run is not an
    // assignment word, so every stop of the scanner would have asked again.
    ['G1X1 and an index with its `=`', (n: number) => `${'G1X1'.repeat(n / 4 - 3)}[1]=5`],
    ['G1X1 and an unclosed index', (n: number) => `${'G1X1'.repeat(n / 4 - 2)}[1`],
    ['G1X1 and a number with an exponent', (n: number) => `${'G1X1'.repeat(n / 4 - 3)}1.5EX3`],
  ])('stays linear on a long run of packed words: %s', (_name, make) => {
    const lengths = [4000, 8000, 16000, 32000];
    for (const cp of [sinumerik, okuma]) {
      const ms: number[] = [];
      for (const length of lengths) {
        const line = make(length);
        ms.push(fastest(3, () => tokenizeLine(line, cp)));
        expect(tokenizeLine(line, cp).tokens.at(-1)?.end).toBe(line.length);
      }
      const worst = Math.max(...ms);
      const report = `${cp.profile.id}: ${lengths.map((n, i) => `${n}: ${ms[i].toFixed(1)} ms`).join(', ')}`;
      expectWithin(worst, 250, report);
    }
  });
});
