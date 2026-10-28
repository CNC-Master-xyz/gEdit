// P4.32 "The check follows jumps" (plan section 6.8.7, rules F1 to F5): `executedSequence`
// (flow.ts), `computeFlow` (app/outlineService.ts) and the goldens of
// `tests/fixtures/channels/flow/`, which run each program through the check twice: with the jump
// lines only (`before`, the reading up to v1.2.0) and with the flow (`after`, what the check does
// now that the store hands it the flow).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cpOf, profileOf } from '../../../../tests/unit/helpers/profiles';
import { computeFlow, computeJumpLines } from '$lib/app/outlineService';
import type { CompiledProfile } from '$lib/core/profiles/types';
import { checkSyncMarks } from './check';
import { executedSequence, FLOW_MAX_COUNT, FLOW_MAX_STEPS } from './flow';
import { findMarks } from './marks';
import { findSections } from './resolve';
import type { ChannelFlow, ChannelParams, SyncFinding, SyncHit } from './types';

const hit = (line: number, mark = String(line)): SyncHit => ({ ruleId: 'wait', mark, line, channel: '1', partners: ['1', '2'], blocking: true });
const NONE: ChannelFlow = { jumps: [], loops: [], opaque: [] };
const lines = (s: { steps: { hit: SyncHit }[] }) => s.steps.map((x) => x.hit.line);

describe('executedSequence (flow.ts)', () => {
  it('keeps the written order and position = line when there is nothing to follow', () => {
    const s = executedSequence([hit(9), hit(3), hit(5)], { ...NONE, opaque: [4, 4, 7] });
    expect(s.steps.map((x) => [x.hit.line, x.pos])).toEqual([
      [3, 3],
      [5, 5],
      [9, 9],
    ]);
    expect(s.opaque).toEqual([4, 7]);
    expect(s.followed).toBe(true);
  });

  it('F2: a forward jump skips the marks between its line and its target; the target line runs', () => {
    const s = executedSequence([hit(2), hit(4), hit(5), hit(6), hit(8)], { ...NONE, jumps: [{ line: 3, target: 6 }] });
    expect(lines(s)).toEqual([2, 6, 8]);
    const pos = s.steps.map((x) => x.pos);
    expect(pos).toEqual([...pos].sort((a, b) => a - b));
    // The run after the jump goes on right after the jump line: nothing can sit between them.
    expect(s.steps[1].pos).toBe(4);
  });

  it('F2: a jump on a skipped line never runs', () => {
    const s = executedSequence([hit(2), hit(6), hit(9), hit(12)], { ...NONE, jumps: [{ line: 3, target: 8 }, { line: 5, target: 11 }] });
    expect(lines(s)).toEqual([2, 9, 12]);
  });

  it('F3: a counted loop runs its lines count times, then goes on after its end', () => {
    const s = executedSequence([hit(1), hit(3), hit(4), hit(7)], { ...NONE, loops: [{ start: 2, end: 5, count: 3 }] });
    expect(lines(s)).toEqual([1, 3, 4, 3, 4, 3, 4, 7]);
    const pos = s.steps.map((x) => x.pos);
    expect(new Set(pos).size).toBe(pos.length);
    expect(pos).toEqual([...pos].sort((a, b) => a - b));
    // A break just before each repeated pass (2 and 3), none before the first.
    expect(s.repeats).toHaveLength(2);
    expect(s.repeats[0]).toBeGreaterThan(s.steps[2].pos);
    expect(s.repeats[0]).toBeLessThan(s.steps[3].pos);
  });

  it('maps an opaque line to a position in every run it is in', () => {
    const s = executedSequence([hit(2), hit(9)], { jumps: [{ line: 3, target: 6 }], loops: [], opaque: [4, 7] });
    // Line 4 is skipped; line 7 runs after the jump.
    expect(s.opaque).toHaveLength(1);
    expect(s.opaque[0]).toBeGreaterThan(s.steps[0].pos);
    expect(s.opaque[0]).toBeLessThan(s.steps[1].pos);
  });

  it('does not follow a flow that breaks its rules: written order, every flow line opaque', () => {
    const bad: ChannelFlow[] = [
      { ...NONE, jumps: [{ line: 5, target: 2 }] }, // backward
      { ...NONE, jumps: [{ line: 1, target: 3 }], loops: [{ start: 2, end: 4, count: 2 }] }, // into a loop
      { ...NONE, jumps: [{ line: 3, target: 6 }], loops: [{ start: 2, end: 4, count: 2 }] }, // out of a loop
      { ...NONE, jumps: [{ line: 1, target: 6 }], loops: [{ start: 2, end: 4, count: 2 }] }, // over a loop
      { ...NONE, loops: [{ start: 2, end: 6, count: 2 }, { start: 4, end: 8, count: 2 }] }, // overlapping
      { ...NONE, loops: [{ start: 2, end: 4, count: 0 }] },
      { ...NONE, loops: [{ start: 2, end: 4, count: 1.5 }] },
      { ...NONE, loops: [{ start: 2, end: 4, count: FLOW_MAX_COUNT + 1 }] },
    ];
    for (const flow of bad) {
      const s = executedSequence([hit(3), hit(1)], flow);
      expect(s.followed, JSON.stringify(flow)).toBe(false);
      expect(s.steps.map((x) => [x.hit.line, x.pos])).toEqual([
        [1, 1],
        [3, 3],
      ]);
      expect(s.repeats).toEqual([]);
    }
    expect(executedSequence([], { ...NONE, jumps: [{ line: 5, target: 2 }], loops: [{ start: 7, end: 9, count: 0 }] }).opaque).toEqual([2, 7, 9]);
  });

  it('reads a sequence longer than FLOW_MAX_STEPS in the written order', () => {
    const hits = Array.from({ length: 30 }, (_, i) => hit(i + 2));
    const s = executedSequence(hits, { ...NONE, loops: [{ start: 1, end: 40, count: Math.ceil(FLOW_MAX_STEPS / 30) + 1 }] });
    expect(s.followed).toBe(false);
    expect(s.steps).toHaveLength(30);
    expect(s.opaque).toEqual([1, 40]);
  });
});

// --- computeFlow (app/outlineService.ts) ---------------------------------------------------------

const one = (src: string[], profile: string): ChannelFlow => computeFlow(src, cpOf(profile), () => 'a').a ?? NONE;

describe('computeFlow: Fanuc (custom macro GOTO, M99 P, WHILE/DO)', () => {
  const F = 'fanuc-lathe';
  it('F1: follows GOTO n alone in its block, forward, to one block of the channel', () => {
    expect(one(['N10 M901', 'GOTO 30', 'M902', 'N30 M903'], F)).toEqual({ jumps: [{ line: 2, target: 4 }], loops: [], opaque: [] });
    expect(one(['N5 GOTO30', 'M902', 'N30 M903'], F)).toEqual({ jumps: [{ line: 1, target: 3 }], loops: [], opaque: [] });
  });
  it('F1: IF … GOTO, a computed target, a skippable block and a missing target are opaque', () => {
    expect(one(['M901', 'IF[#1EQ1]GOTO30', 'M902', 'N30 M903'], F)).toEqual({ jumps: [], loops: [], opaque: [4] });
    expect(one(['M901', 'GOTO#10', 'M902', 'N30 M903'], F)).toEqual({ jumps: [], loops: [], opaque: [2] });
    expect(one(['M901', '/GOTO30', 'M902', 'N30 M903'], F)).toEqual({ jumps: [], loops: [], opaque: [4] });
    expect(one(['M901', 'GOTO 40', 'M902', 'N30 M903'], F)).toEqual({ jumps: [], loops: [], opaque: [2] });
  });
  it('F1: a target written twice, a backward GOTO and a GOTO beside other words are opaque', () => {
    expect(one(['GOTO 30', 'N30 M902', 'N30 M903'], F)).toEqual({ jumps: [], loops: [], opaque: [2, 3] });
    expect(one(['N10 M901', 'M902', 'GOTO 10'], F)).toEqual({ jumps: [], loops: [], opaque: [1, 3] });
    expect(one(['M901', 'G0 X10. GOTO 30', 'M902', 'N30 M903'], F)).toEqual({ jumps: [], loops: [], opaque: [4] });
  });
  it('F1: a target in another channel is opaque', () => {
    const flow = computeFlow(['GOTO 30', 'M902', 'N30 M903'], cpOf(F), (line) => (line < 3 ? 'a' : 'b'));
    expect(flow.a).toEqual({ jumps: [], loops: [], opaque: [1] });
    expect(flow.b).toEqual(NONE);
  });
  it('F2: a skipped line that is the target of another jump makes the jump opaque', () => {
    expect(one(['GOTO 40', 'N20 M902', 'N40 M903', 'IF[#1EQ1]GOTO20'], F)).toEqual({ jumps: [], loops: [], opaque: [2, 3, 4] });
  });
  it('F2: a skipped loop makes the jump opaque', () => {
    expect(one(['GOTO 40', 'WHILE[#1LT2]DO1', 'END1', 'N40 M903'], F)).toEqual({ jumps: [], loops: [], opaque: [2, 3, 4] });
  });
  it('F3/F5: WHILE … DO and DO … END are opaque, never counted', () => {
    expect(one(['#1=0', 'WHILE[#1LT2]DO1', 'M901', '#1=#1+1', 'END1'], F)).toEqual({ jumps: [], loops: [], opaque: [2, 5] });
    expect(one(['DO1', 'M901', 'END1'], F)).toEqual({ jumps: [], loops: [], opaque: [1, 3] });
  });
  it('M99 P and M98 Q are read as the jump lines read them (opaque)', () => {
    expect(one(['N10 M901', 'M99 P10'], F)).toEqual({ jumps: [], loops: [], opaque: [1, 2] });
    expect(one(['M98 Q50', 'M901', 'N50 M902', 'M99'], F)).toEqual({ jumps: [], loops: [], opaque: [3] });
  });
});

describe('computeFlow: Sinumerik (GOTOF, GOTOB, GOTO, GOTOC, labels, FOR, REPEAT)', () => {
  const S = 'sinumerik';
  it('F1: follows GOTOF, GOTO and GOTOC to a label or a block number', () => {
    expect(one(['WAITM(1,1,2)', 'GOTOF SKIP1', 'WAITM(2,1,2)', 'SKIP1: G0 X1', 'WAITM(3,1,2)'], S)).toEqual({ jumps: [{ line: 2, target: 4 }], loops: [], opaque: [] });
    expect(one(['N10 GOTO SKIP1', 'X1', 'SKIP1: X2'], S).jumps).toEqual([{ line: 1, target: 3 }]);
    expect(one(['N10 GOTOC SKIP1', 'X1', 'SKIP1: X2'], S).jumps).toEqual([{ line: 1, target: 3 }]);
    expect(one(['GOTOF N100', 'X1', 'N100 X2'], S).jumps).toEqual([{ line: 1, target: 3 }]);
    // A label in front of the jump defines its own line.
    expect(one(['START: GOTOF SKIP1', 'X1', 'SKIP1: X2'], S).jumps).toEqual([{ line: 1, target: 3 }]);
  });
  it('F1: GOTOB, IF … GOTOF, CASE, a STRING target and a GOTOF whose label is behind it are opaque', () => {
    expect(one(['LAB1: WAITM(1,1,2)', 'R1=R1+1', 'IF R1<3 GOTOB LAB1'], S)).toEqual({ jumps: [], loops: [], opaque: [1, 3] });
    expect(one(['LAB1: WAITM(1,1,2)', 'GOTOB LAB1'], S)).toEqual({ jumps: [], loops: [], opaque: [1, 2] });
    expect(one(['IF R1==1 GOTOF L1', 'X1', 'L1: X2'], S)).toEqual({ jumps: [], loops: [], opaque: [3] });
    expect(one(['CASE(R1) OF 1 GOTOF L1 DEFAULT GOTOF L2', 'X0', 'L1: X1', 'L2: X2'], S)).toEqual({ jumps: [], loops: [], opaque: [3, 4] });
    expect(one(['DEF STRING[8] DEST', 'GOTOF DEST', 'X1', 'L1: X2'], S)).toEqual({ jumps: [], loops: [], opaque: [2] });
    expect(one(['L1: X1', 'GOTOF L1'], S)).toEqual({ jumps: [], loops: [], opaque: [1, 2] });
  });
  it('F3: FOR with whole-number bounds is a counted loop (count = end - start + 1)', () => {
    expect(one(['FOR R1=1 TO 3', 'WAITM(1,1,2)', 'ENDFOR'], S)).toEqual({ jumps: [], loops: [{ start: 1, end: 3, count: 3 }], opaque: [] });
    expect(one(['N10 FOR R1=0 TO 1', 'WAITM(1,1,2)', 'N20 ENDFOR'], S).loops).toEqual([{ start: 1, end: 3, count: 2 }]);
  });
  it('F3: FOR with a variable bound, a start not below the end, or another loop inside is opaque', () => {
    expect(one(['FOR R1=1 TO R2', 'WAITM(1,1,2)', 'ENDFOR'], S)).toEqual({ jumps: [], loops: [], opaque: [1, 3] });
    expect(one(['FOR R1=3 TO 3', 'WAITM(1,1,2)', 'ENDFOR'], S)).toEqual({ jumps: [], loops: [], opaque: [1, 3] });
    expect(one(['FOR R1=1 TO 2', 'FOR R2=1 TO 2', 'WAITM(1,1,2)', 'ENDFOR', 'ENDFOR'], S)).toEqual({ jumps: [], loops: [{ start: 2, end: 4, count: 2 }], opaque: [1, 5] });
    expect(one(['FOR R1=1 TO 2', 'IF R3==1 GOTOF L1', 'L1: WAITM(1,1,2)', 'ENDFOR'], S)).toEqual({ jumps: [], loops: [], opaque: [1, 3, 4] });
  });
  it('F3: REPEAT LABEL P=n runs the lines from the label n + 1 times (no P: twice)', () => {
    expect(one(['LAB1: WAITM(1,1,2)', 'X1', 'REPEAT LAB1 P=2', 'M30'], S)).toEqual({ jumps: [], loops: [{ start: 1, end: 3, count: 3 }], opaque: [] });
    expect(one(['LAB1: WAITM(1,1,2)', 'REPEAT LAB1'], S).loops).toEqual([{ start: 1, end: 2, count: 2 }]);
  });
  it('F3: the other repetitions, REPEAT … UNTIL, WHILE and LOOP are opaque', () => {
    expect(one(['A1: WAITM(1,1,2)', 'B1: X1', 'REPEAT A1 B1 P=2'], S)).toEqual({ jumps: [], loops: [], opaque: [1, 2, 3] });
    expect(one(['A1: WAITM(1,1,2)', 'REPEATB A1 P=2'], S)).toEqual({ jumps: [], loops: [], opaque: [1, 2] });
    expect(one(['A1: WAITM(1,1,2)', 'ENDLABEL: X1', 'X2', 'REPEAT A1 P=2'], S)).toEqual({ jumps: [], loops: [], opaque: [1, 4] });
    expect(one(['A1: WAITM(1,1,2)', 'REPEAT A1 P=R5'], S)).toEqual({ jumps: [], loops: [], opaque: [1, 2] });
    expect(one(['A1: WAITM(1,1,2)', 'REPEAT A1 P=0'], S)).toEqual({ jumps: [], loops: [], opaque: [1, 2] });
    expect(one(['REPEAT', 'WAITM(1,1,2)', 'UNTIL R1>3', 'WHILE R1<3', 'ENDWHILE', 'LOOP', 'ENDLOOP'], S)).toEqual({ jumps: [], loops: [], opaque: [1, 3, 4, 5, 6, 7] });
  });
});

describe('computeFlow: Okuma (GOTO, sequence names, IF)', () => {
  const O = 'okuma-osp';
  it('F1: follows GOTO to a sequence number or a sequence name', () => {
    expect(one(['N1 P10', 'GOTO N100', 'N2 P30', 'N100 G0 X10', 'N3 P20'], O)).toEqual({ jumps: [{ line: 2, target: 4 }], loops: [], opaque: [] });
    expect(one(['N1 P10', 'GOTO NLAB1', 'N2 P30', 'NLAB1 G0 X10', 'N3 P20'], O)).toEqual({ jumps: [{ line: 2, target: 4 }], loops: [], opaque: [] });
  });
  it('F1: sequence names compare as text (N0100 is not N100)', () => {
    expect(one(['GOTO N0100', 'N100 X1'], O)).toEqual({ jumps: [], loops: [], opaque: [1] });
  });
  it('F1: IF … N and IF … sequence name are opaque', () => {
    expect(one(['N1 P10', 'IF [V1 EQ 1] N100', 'N2 P30', 'N100 G0 X10'], O)).toEqual({ jumps: [], loops: [], opaque: [4] });
    expect(one(['N1 P10', 'IF [V1 EQ 1] NLAB1', 'N2 P30', 'NLAB1 G0 X10'], O)).toEqual({ jumps: [], loops: [], opaque: [4] });
  });
});

describe('computeFlow: structured IF blocks (NC-1)', () => {
  const S = 'sinumerik';
  const F = 'fanuc-lathe';
  it('does not follow a jump inside an IF block: Sinumerik IF … ENDIF, IF … ELSE … ENDIF, Fanuc IF[…]THEN … ENDIF', () => {
    expect(one(['IF R1==1', 'GOTOF L1', 'ENDIF', 'WAITM(2,1,2)', 'L1: X1'], S)).toEqual({ jumps: [], loops: [], opaque: [5] });
    expect(one(['IF R1==1', 'X1', 'ELSE', 'GOTOF L1', 'ENDIF', 'WAITM(2,1,2)', 'L1: X1'], S)).toEqual({ jumps: [], loops: [], opaque: [7] });
    expect(one(['N10 IF (R1==1) AND (R2>0) ; why', 'N20 GOTOF N50', 'N30 ENDIF', 'N40 WAITM(2,1,2)', 'N50 X1'], S).jumps).toEqual([]);
    expect(one(['IF[#1EQ1]THEN', 'GOTO 30', 'ENDIF', 'M902', 'N30 M903'], F)).toEqual({ jumps: [], loops: [], opaque: [5] });
    expect(one(['N5 IF [#1 EQ 1] THEN (OPEN)', 'GOTO 30', 'ELSE', 'M901', 'ENDIF', 'M902', 'N30 M903'], F).jumps).toEqual([]);
    // Nested: the inner ENDIF does not end the outer block.
    expect(one(['IF R1==1', 'IF R2==1', 'X1', 'ENDIF', 'GOTOF L1', 'ENDIF', 'X2', 'L1: X3'], S).jumps).toEqual([]);
  });
  it('does not follow a jump whose target is inside an IF block', () => {
    expect(one(['GOTOF L1', 'IF R1==1', 'L1: X1', 'ENDIF'], S)).toEqual({ jumps: [], loops: [], opaque: [3] });
    expect(one(['GOTO 30', 'IF[#1EQ1]THEN', 'N30 M903', 'ENDIF'], F)).toEqual({ jumps: [], loops: [], opaque: [3] });
  });
  it('follows no jump of a channel whose IF blocks do not balance', () => {
    expect(one(['IF R1==1', 'X1', 'GOTOF L1', 'X2', 'L1: X3'], S).jumps).toEqual([]);
    expect(one(['ENDIF', 'GOTOF L1', 'X1', 'L1: X2'], S).jumps).toEqual([]);
    expect(one(['ELSE', 'GOTO 30', 'M902', 'N30 M903'], F).jumps).toEqual([]);
    expect(one(['GOTOF L1', 'X1', 'L1: X2', 'IF R1==1', 'X3'], S).jumps).toEqual([]);
  });
  it('still follows a jump over a whole IF block, and one after the block', () => {
    expect(one(['GOTOF L1', 'IF R1==1', 'WAITM(2,1,2)', 'ENDIF', 'L1: X1'], S)).toEqual({ jumps: [{ line: 1, target: 5 }], loops: [], opaque: [] });
    expect(one(['GOTO 30', 'IF[#1EQ1]THEN', 'M902', 'ELSE', 'M904', 'ENDIF', 'N30 M903'], F)).toEqual({ jumps: [{ line: 1, target: 7 }], loops: [], opaque: [] });
    expect(one(['IF R1==1', 'X1', 'ENDIF', 'GOTOF L1', 'X2', 'L1: X3'], S).jumps).toEqual([{ line: 4, target: 6 }]);
  });
  it('reads a one-line IF as no block: IF … GOTO, IF … THEN with a statement, the Okuma IF … N', () => {
    expect(one(['IF R1==1 GOTOF L2', 'GOTOF L1', 'X1', 'L1: X2', 'L2: X3'], S).jumps).toEqual([{ line: 2, target: 4 }]);
    expect(one(['IF[#1EQ1]THEN #2=1', 'GOTO 30', 'M902', 'N30 M903'], F).jumps).toEqual([{ line: 2, target: 4 }]);
    expect(one(['IF[#1EQ1]GOTO40', 'GOTO 30', 'M902', 'N30 M903', 'N40 M904'], F).jumps).toEqual([{ line: 2, target: 4 }]);
    expect(one(['IF [V1 EQ 1] N200', 'GOTO N100', 'N2 P30', 'N100 G0 X10', 'N200 X1'], 'okuma-osp').jumps).toEqual([{ line: 2, target: 4 }]);
    // A comment that says IF or ENDIF is no block.
    expect(one(['; IF R1==1', 'GOTOF L1', 'X1', 'L1: X2', '; ENDIF'], S).jumps).toEqual([{ line: 2, target: 4 }]);
  });
  it('leaves SWITCH and CASE alone (a GOTO between SWITCH and the first CASE runs)', () => {
    expect(one(['SWITCH[#100]', 'GOTO 30', 'CASE[10] GOTO40', 'M902', 'N30 M903', 'N40 M904'], F).jumps).toEqual([{ line: 2, target: 5 }]);
  });
  it('keeps the IF depth per channel', () => {
    // Channel a opens an IF block that channel b never sees: b's jump is still followed.
    const flow = computeFlow(['IF R1==1', 'X0', 'GOTOF L1', 'X1', 'L1: X2', 'ENDIF'], cpOf(S), (line) => (line <= 2 || line === 6 ? 'a' : 'b'));
    expect(flow.b.jumps).toEqual([{ line: 3, target: 5 }]);
  });
});

describe('computeFlow: a jump into another program of the file (NC-5)', () => {
  it('does not follow a jump over a program end or the next program head', () => {
    expect(one(['N10 M901', 'GOTO 100', 'M902', 'M30', '%', 'O0002', 'N100 M903', 'M99'], 'fanuc-lathe')).toEqual({ jumps: [], loops: [], opaque: [7] });
    expect(one(['GOTO 100', 'M902', 'O0002 (SUB)', 'N100 M903'], 'fanuc-lathe').jumps).toEqual([]);
    expect(one(['GOTO 100', 'M902', 'M99', 'N100 M903'], 'fanuc-lathe').jumps).toEqual([]);
    expect(one(['GOTO 100', 'M902', '/M02', 'N100 M903'], 'fanuc-lathe').jumps).toEqual([]);
    expect(one(['GOTOF L1', 'X1', 'M17', 'L1: X2'], 'sinumerik').jumps).toEqual([]);
    expect(one(['GOTOF L1', 'X1', 'RET', 'L1: X2'], 'sinumerik').jumps).toEqual([]);
    expect(one(['GOTOF L1', 'X1', 'M2', '%_N_SUB_SPF', 'L1: X2'], 'sinumerik').jumps).toEqual([]);
    expect(one(['GOTO NLAB1', 'P30', 'RTS', 'OSUB1', 'NLAB1 X1'], 'okuma-osp').jumps).toEqual([]);
  });
  it('still follows a jump to the line that ends the program', () => {
    expect(one(['GOTO 30', 'M902', 'N30 M30'], 'fanuc-lathe').jumps).toEqual([{ line: 1, target: 3 }]);
    expect(one(['GOTOF ENDE', 'WAITM(2,1,2)', 'ENDE: M30'], 'sinumerik').jumps).toEqual([{ line: 1, target: 3 }]);
  });
});

describe('computeJumpLines: label targets (NC-3)', () => {
  const jl = (src: string[], profile: string) => computeJumpLines(src, cpOf(profile), () => 'a').a;
  it('names the target of a jump to a label, as computeFlow reads it', () => {
    expect(jl(['GOTOF L1', 'X1', 'L1: X2'], 'sinumerik')).toEqual([3]);
    expect(jl(['IF R1==1 GOTOF L1', 'X1', 'L1: X2'], 'sinumerik')).toEqual([3]);
    expect(jl(['L1: X1', 'GOTOB L1'], 'sinumerik')).toEqual([1, 2]);
    expect(jl(['GOTO NLAB1', 'X1', 'NLAB1 X2'], 'okuma-osp')).toEqual([3]);
    expect(jl(['IF [V1 EQ 1] NLAB1', 'X1', 'NLAB1 X2'], 'okuma-osp')).toEqual([3]);
    // The label that defines the line is no target.
    expect(jl(['NLAB2 IF [V1 EQ 1] NLAB1', 'X1', 'NLAB1 X2'], 'okuma-osp')).toEqual([3]);
  });
});

describe('computeFlow: channels', () => {
  it('reads a line of a shared section in each of its channels, and gives every channel an entry', () => {
    const flow = computeFlow(['GOTO 30', 'M902', 'N30 M903', 'M30'], cpOf('fanuc-lathe'), (line) => (line === 4 ? 'b' : ['a', 'b']));
    expect(flow.a).toEqual({ jumps: [{ line: 1, target: 3 }], loops: [], opaque: [] });
    expect(flow.b).toEqual({ jumps: [{ line: 1, target: 3 }], loops: [], opaque: [] });
    expect(computeFlow(['M901'], cpOf('fanuc-lathe'), () => [])).toEqual({ '': NONE });
  });
  it('holds every line computeJumpLines names, unless it follows it', () => {
    const progs: [string, string[]][] = [
      ['fanuc-lathe', ['N10 M901', 'IF[#1LT2]GOTO10', 'GOTO 40', 'M902', 'N40 M903', 'WHILE[#1LT2]DO1', 'M904', 'END1', 'M99 P10']],
      ['sinumerik', ['REPEAT', 'WAITM(1,1,2)', 'UNTIL R1>3', 'N10 WHILE R1<3', 'R1=R1+1', 'ENDWHILE', 'LOOP', 'ENDLOOP', 'FOR R1=1 TO 3', 'ENDFOR', 'GOTOF N10']],
      ['okuma-osp', ['N1 P10', 'IF [V1 EQ 1] N100', 'N2 P30', 'N100 G0 X10', 'GOTO N1']],
      ['sinumerik', ['GOTOF L1', 'X1', 'L1: X2', 'IF R1==1 GOTOF L2', 'X3', 'L2: X4', 'L3: X5', 'GOTOB L3']],
      ['okuma-osp', ['GOTO NLAB1', 'P30', 'NLAB1 X2', 'IF [V1 EQ 1] NLAB2', 'P40', 'NLAB2 X3']],
    ];
    for (const [profile, src] of progs) {
      const jl = computeJumpLines(src, cpOf(profile), () => 'a').a ?? [];
      const f = one(src, profile);
      const followed = new Set([...f.jumps.flatMap((j) => [j.line, j.target]), ...f.loops.flatMap((l) => [l.start, l.end])]);
      for (const line of jl) expect(f.opaque.includes(line) || followed.has(line), `${profile} line ${line}`).toBe(true);
      // The other way (NC-3): a jump target the flow knows, followed or not, is a jump line of the view too.
      for (const j of f.jumps) expect(jl, `${profile} target ${j.target}`).toContain(j.target);
      for (const line of f.opaque) expect(jl, `${profile} opaque ${line}`).toContain(line);
    }
  });
});

// --- the goldens ---------------------------------------------------------------------------------

interface Golden {
  description: string;
  rule: string;
  profile: string;
  preset: string;
  machine?: Partial<ChannelParams>;
  program: Record<string, string[]> | string[];
  expect: { flow: Record<string, ChannelFlow>; before: Partial<SyncFinding>[]; after: Partial<SyncFinding>[] };
}

function presetOf(profile: string, id: string): ChannelParams {
  const found = profileOf(profile).machineParams?.channels?.presets.find((p) => p.id === id);
  if (!found) throw new Error(`${profile}: no preset ${id}`);
  return found.value;
}

/** What `channels.check` hands the check: the marks, the jump lines and the flow of every channel. */
function inputsOf(program: Golden['program'], cp: CompiledProfile, p: ChannelParams) {
  const perChannel: Record<string, SyncHit[]> = {};
  const jumpLines: Record<string, number[]> = {};
  const flow: Record<string, ChannelFlow> = {};
  if (Array.isArray(program)) {
    const found = findSections(program, cp, p);
    expect(found.problems).toEqual([]);
    const owner = new Map<number, string>();
    for (const s of found.sections) {
      perChannel[s.channel.id] = [];
      for (const r of s.ranges) for (let l = r.startLine; l <= r.endLine; l++) owner.set(l, s.channel.id);
    }
    perChannel[''] = [];
    const channelOf = (l: number): string => owner.get(l) ?? '';
    for (const m of findMarks(program, cp, p, { channelOf }).marks) perChannel[m.channel].push(m);
    Object.assign(jumpLines, computeJumpLines(program, cp, channelOf));
    Object.assign(flow, computeFlow(program, cp, channelOf));
  } else {
    for (const [channel, src] of Object.entries(program)) {
      perChannel[channel] = findMarks(src, cp, p, { channelOf: () => channel }).marks;
      const jl = computeJumpLines(src, cp, () => channel)[channel];
      if (jl) jumpLines[channel] = jl;
      flow[channel] = computeFlow(src, cp, () => channel)[channel] ?? NONE;
    }
  }
  return { perChannel, jumpLines, flow };
}

function project(f: SyncFinding): Partial<SyncFinding> {
  const out: Partial<SyncFinding> = { kind: f.kind, channel: f.channel, line: f.line, mark: f.mark };
  if (f.other !== undefined) out.other = f.other;
  if (f.otherLine !== undefined) out.otherLine = f.otherLine;
  if (f.counts !== undefined) out.counts = f.counts;
  return out;
}

const FLOW_DIR = fileURLToPath(new URL('../../../../tests/fixtures/channels/flow', import.meta.url));
const flowGoldens = readdirSync(FLOW_DIR)
  .filter((n) => n.endsWith('.json'))
  .sort();

describe('the flow goldens (tests/fixtures/channels/flow)', () => {
  it('has a golden for every rule and every control', () => {
    const all = flowGoldens.map((n) => JSON.parse(readFileSync(join(FLOW_DIR, n), 'utf8')) as Golden);
    for (const rule of ['F1', 'F2', 'F3', 'F4', 'F5']) expect(all.some((g) => g.rule.split(/[ ,]+/).includes(rule)), rule).toBe(true);
    for (const profile of ['fanuc-lathe', 'sinumerik', 'okuma-osp']) expect(all.some((g) => g.profile === profile), profile).toBe(true);
  });

  it.each(flowGoldens)('%s', (name) => {
    const g = JSON.parse(readFileSync(join(FLOW_DIR, name), 'utf8')) as Golden;
    const cp = cpOf(g.profile);
    const p = { ...presetOf(g.profile, g.preset), ...(g.machine ?? {}) } as ChannelParams;
    const { perChannel, jumpLines, flow } = inputsOf(g.program, cp, p);
    for (const [ch, want] of Object.entries(g.expect.flow)) expect(flow[ch], `${g.description} (flow ${ch})`).toEqual(want);
    expect(checkSyncMarks(perChannel, p, { jumpLines }).map(project), `${g.description} (before)`).toEqual(g.expect.before);
    const after = checkSyncMarks(perChannel, p, { jumpLines, flow });
    expect(after.map(project), `${g.description} (after)`).toEqual(g.expect.after);
    // Determinism, as the check goldens have it.
    const reversed = Object.fromEntries(Object.entries(perChannel).reverse());
    expect(JSON.stringify(checkSyncMarks(reversed, p, { jumpLines, flow }))).toBe(JSON.stringify(after));
  });
});

// F4, the other half: a program the flow cannot change is judged exactly as before. Every golden
// of the check (tests/fixtures/channels/check) gives its own findings with the flow `computeFlow`
// reads from its program.
const CHECK_DIR = fileURLToPath(new URL('../../../../tests/fixtures/channels/check', import.meta.url));
const checkGoldens = readdirSync(CHECK_DIR)
  .filter((n) => n.endsWith('.json'))
  .sort();

describe('F4: the check goldens keep their findings with the flow', () => {
  it.each(checkGoldens)('%s', (name) => {
    const g = JSON.parse(readFileSync(join(CHECK_DIR, name), 'utf8')) as Omit<Golden, 'expect'> & { jumpLines?: Record<string, number[]>; expect: { findings: Partial<SyncFinding>[] } };
    const cp = cpOf(g.profile);
    const p = { ...presetOf(g.profile, g.preset), ...(g.machine ?? {}) } as ChannelParams;
    const { perChannel, flow } = inputsOf(g.program, cp, p);
    const want = checkSyncMarks(perChannel, p, { jumpLines: g.jumpLines });
    expect(checkSyncMarks(perChannel, p, { flow })).toEqual(want);
  });
});
