// The TypeScript modal interpreter and its index (Phase 3 plan P3.1, §6.1; AD-19, AD-33).
//
// The goldens (`modal.golden.test.ts`) and the per-line parity with Python
// (`tests/unit/modalParity.slow.test.ts`) are the oracle; this file names the rules one by one on
// small synthetic programs of the built-in profiles, pins what the interpreter costs (regex
// calls per line, the G7 budgets of X17), and holds the index to its contract: snapshots,
// `null` before the build reaches a line, `applyChange` dropping only later snapshots,
// `buildSome` within its budget, `statesAfter` equal to `stateAfter` line by line.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { PROFILES, ctx, indexOver, program, type Ctx } from '../../../../tests/unit/helpers/modalIndex';
import { maskComments } from './mask';
import { ModalIndex, ModalInterpreter, SNAPSHOT_EVERY, STATES_MAX } from './modal';
import { tokenizeLine } from './tokenizer';
import type { MachineConfig } from '$lib/core/machines/types';
import type { LineState, ModalState, NcToken } from './types';

/** The state after every line of `lines`, walked by one interpreter. */
function walk(c: Ctx, lines: readonly string[]): ModalState[] {
  const interp = new ModalInterpreter(c.cp, c.db);
  let state: LineState | undefined;
  return lines.map((line, i) => {
    const r = tokenizeLine(line, c.cp, state);
    state = r.state;
    interp.update(r.tokens, i + 1, maskComments(line, c.cp));
    return interp.state();
  });
}

/** The state after the last line. */
function last(profileId: string, lines: readonly string[], params?: MachineConfig['params']): ModalState {
  const states = walk(ctx(profileId, params), lines);
  return states[states.length - 1];
}

describe('the power-on state (rule 8)', () => {
  it('is the profile default, assumed, with its source', () => {
    const interp = new ModalInterpreter(ctx('fanuc-lathe').cp, ctx('fanuc-lathe').db);
    const s = interp.state();
    expect(s.groups.feedmode).toEqual({ code: 'G99', line: 0, assumed: true, from: 'profile' });
    expect(s.feedUnit).toBe('per-rev');
    expect(s.units).toEqual({ value: 'mm', line: 0, assumed: true, from: 'profile' });
    expect(s.diameter).toEqual({ mode: 'on', line: 0, assumed: true, from: 'profile' });
    expect(s.tool).toBeNull();
    // Fanuc lathe system A has no distance code at all: absolute is known, not assumed.
    expect(s.distance).toBe('absolute');
  });

  it('carries the machine as the source of what it set', () => {
    const s = new ModalInterpreter(ctx('fanuc-gcode', { modalInitial: { feedmode: 'G95' } }).cp, ctx('fanuc-gcode', { modalInitial: { feedmode: 'G95' } }).db).state();
    expect(s.groups.feedmode).toEqual({ code: 'G95', line: 0, assumed: true, from: 'machine' });
    expect(s.feedUnit).toBe('per-rev');
  });

  it('comes back with reset()', () => {
    const c = ctx('fanuc-gcode');
    const interp = new ModalInterpreter(c.cp, c.db);
    const fresh = interp.state();
    const r = tokenizeLine('G91 G95 G1 X10. F.2 S800', c.cp);
    interp.update(r.tokens, 1, maskComments('G91 G95 G1 X10. F.2 S800', c.cp));
    expect(interp.state()).not.toEqual(fresh);
    interp.reset();
    expect(interp.state()).toEqual(fresh);
  });

  it('assumes nothing a profile does not say: a mill has no diameter mode', () => {
    expect(last('fanuc-gcode', ['']).diameter).toBeNull();
    expect(last('fanuc-gcode', ['']).groups.motion).toBeUndefined();
  });
});

describe('codes and words (rules 1-7, 9)', () => {
  it('rule 1: a modal code becomes the code of its group, with its line', () => {
    const s = walk(ctx('fanuc-gcode'), ['G0 X0', 'G1 X10. F100.', 'X20.']);
    expect(s[2].groups.motion).toEqual({ code: 'G1', line: 2, assumed: false });
    expect(s[2].feed).toEqual({ valueText: '100.', line: 2, variable: false });
  });

  it('rule 2: a modal cycle runs until it is cancelled; rule 3: a plain move cancels it too', () => {
    const s = walk(ctx('fanuc-gcode'), ['G81 X10. Z-5. R2. F100.', 'X20.', 'G80', 'G81 X30. Z-5. R2.', 'G0 Z50.']);
    expect(s[1].activeCycle).toEqual({ code: 'G81', line: 1, pitchFeed: false });
    expect(s[1].block.cycle).toBeNull();
    expect(s[0].block.cycle).toBe('G81');
    expect(s[2].activeCycle).toBeNull();
    expect(s[4].activeCycle).toBeNull();
  });

  it('rule 2: a one-shot cycle is a flag of its own block (lathe G71)', () => {
    const s = walk(ctx('fanuc-lathe'), ['G71 U2. R.5', 'G71 P10 Q20 U.4 W.1 F.25', 'G0 X100.']);
    expect(s[1].block.cycle).toBe('G71');
    expect(s[1].activeCycle).toBeNull();
    expect(s[2].block.cycle).toBeNull();
  });

  it('rule 3: a threading move is the cycle, its feed a lead', () => {
    const s = last('fanuc-lathe', ['G32 Z-20. F1.5']);
    expect(s.activeCycle).toEqual({ code: 'G32', line: 1, pitchFeed: true });
    expect(s.block.pitchFeed).toBe(true);
  });

  it('rule 4: the S of a speed-limit block is the clamp, whatever the order of the words', () => {
    for (const line of ['G50 S2500', 'S2500 G50']) {
      const s = last('fanuc-lathe', ['G97 S800', line]);
      expect(s.speedLimit?.valueText, line).toBe('2500');
      expect(s.speed?.valueText, line).toBe('800');
      expect(s.block.speedLimit, line).toBe(true);
    }
  });

  it('rule 4: an address of speedLimitWords is the clamp wherever it stands', () => {
    const s = last('sinumerik', ['LIMS=3000 S500']);
    expect(s.speedLimit?.valueText).toBe('3000');
    expect(s.speed?.valueText).toBe('500');
  });

  it('rule 5: a feed word sets its own unit; a plain F returns to the group', () => {
    const s = walk(ctx('heidenhain-klartext'), ['L X+10 FU0.2', 'L X+20 FZ0.05', 'L X+30 F500']);
    // A plain F returns to the feed mode in force: per minute, the profile's power-on M137 (P4.9).
    expect(s.map((x) => x.feedUnit)).toEqual(['per-rev', 'per-tooth', 'per-minute']);
    expect(s[1].feed?.valueText).toBe('0.05');
  });

  it('rule 6: a dwell keeps the feed and the speed in force', () => {
    const s = last('sinumerik', ['G1 X10 F0.2 S900', 'G4 F2', 'G4 S3']);
    expect(s.feed?.valueText).toBe('0.2');
    expect(s.speed?.valueText).toBe('900');
    expect(s.block.fNotFeed).toBe(true);
  });

  it('rule 7: a tool line sets the tool; a mill tool comes from the line before M6', () => {
    const lathe = walk(ctx('fanuc-lathe'), ['T0101', 'G0 X50.', 'T0202']);
    expect(lathe.map((s) => s.tool?.station ?? null)).toEqual(['01', '01', '02']);
    expect(lathe[0].block.toolChange).toBe(true);
    expect(lathe[1].block.toolChange).toBe(false);
    const mill = walk(ctx('fanuc-gcode'), ['T5', 'M6']);
    expect(mill[0].tool).toBeNull();
    expect(mill[1].tool).toEqual({ station: '5', written: 'T5', line: 2 });
  });

  it('rule 7 (D3-4c): with "T on the M6 line is the next tool", M6 loads the T written before its line', () => {
    const lines = ['T1', 'M6 T2', 'G0 X1.', 'M6 T3', 'T4 M6'];
    const loaded = walk(ctx('fanuc-gcode'), lines);
    expect(loaded.map((s) => s.tool?.station ?? null)).toEqual([null, '2', '2', '3', '4']);
    const next = walk(ctx('fanuc-gcode', { variants: { toolOnChangeLine: 'next' } }), lines);
    expect(next.map((s) => s.tool?.station ?? null)).toEqual([null, '1', '1', '2', '3']);
    expect(next[1].tool).toEqual({ station: '1', written: 'T1', line: 2 });
    expect(next.map((s) => s.block.toolChange)).toEqual([false, true, false, true, true]);
    // Nothing selected before the first M6: the tool in the spindle is not known.
    expect(walk(ctx('fanuc-gcode', { variants: { toolOnChangeLine: 'next' } }), ['M6 T2'])[0].tool).toBeNull();
  });

  it('rule 7 (CODE-6): with last-before, an M6 after a selected T0 is an unload: no tool, no tool change', () => {
    const base = PROFILES.get('fanuc-gcode');
    if (!base) throw new Error('no profile fanuc-gcode');
    const variant = {
      ...base,
      toolCall: {
        trigger: '(?<![A-Z])M0*6(?!\\d)',
        tool: '(?<![A-Z])T(?<tool>\\d+)',
        ignore: '(?<![A-Z])T0+(?!\\d)',
        toolFrom: 'last-before' as const,
      },
    };
    const checked = validateProfile(variant);
    if (!checked.ok) throw new Error(checked.errors.join('; '));
    const c = { cp: compileProfile(checked.profile), db: ctx('fanuc-gcode').db };
    const states = walk(c, ['T1', 'M6 T0', 'M6', 'T2', 'M6']);
    expect(states.map((s) => s.tool?.station ?? null)).toEqual([null, '1', null, null, '2']);
    expect(states.map((s) => s.block.toolChange)).toEqual([false, true, false, false, true]);
  });

  it('rule 7: a tool group that took no part in the match names no tool (B1, no whole-match fallback)', () => {
    // A variant of the Klartext profile whose tool pattern makes the number optional, so
    // `TOOL CALL Z S2000` matches without it: the whole match is no station.
    const base = PROFILES.get('heidenhain-klartext');
    if (!base) throw new Error('no profile heidenhain-klartext');
    const variant = {
      ...base,
      toolCall: { trigger: '\\bTOOL\\s+CALL\\b', tool: 'TOOL\\s+CALL\\s+(?<tool>\\d+)?', toolFrom: 'same-line' as const },
    };
    const checked = validateProfile(variant);
    if (!checked.ok) throw new Error(checked.errors.join('; '));
    const c = { cp: compileProfile(checked.profile), db: ctx('heidenhain-klartext').db };
    const states = walk(c, ['1 TOOL CALL 5 Z S1000', '2 TOOL CALL Z S2000']);
    expect(states.map((s) => s.tool?.station ?? null)).toEqual(['5', '5']);
    expect(states[1].tool?.line).toBe(1);
    expect(states[1].block.toolChange).toBe(true);
  });

  it('rule 7 (T113): a Klartext TOOL CALL that names the loaded tool and no axis only changes the speed', () => {
    const lines = ['TOOL CALL 4 Z S3000', 'TOOL CALL 4 S4000', 'TOOL CALL 04 S4500', 'TOOL CALL 4 Z S5000', 'TOOL CALL "D8" Z S100', 'TOOL CALL "D8" S200', 'TOOL CALL 12.1 Z', 'TOOL CALL 12 S1'];
    const states = walk(ctx('heidenhain-klartext'), lines);
    expect(states.map((s) => s.block.toolChange)).toEqual([true, false, false, true, true, false, true, true]);
    expect(states.map((s) => s.tool?.station ?? null)).toEqual(['4', '4', '4', '4', '"D8"', '"D8"', '12.1', '12']);
    // The tool keeps the line it was loaded on, so a tool-change time is counted once.
    expect(states.map((s) => s.tool?.line ?? null)).toEqual([1, 1, 1, 4, 5, 5, 7, 8]);
    expect(states.map((s) => s.speed?.valueText ?? null)).toEqual(['3000', '4000', '4500', '5000', '100', '200', '200', '1']);
  });

  it('rule 7 (T113): on an axis-aware profile a tool line that names no tool is no tool change', () => {
    const base = PROFILES.get('heidenhain-klartext');
    if (!base) throw new Error('no profile heidenhain-klartext');
    const variant = {
      ...base,
      toolCall: { trigger: '\\bTOOL\\s+CALL\\b', tool: 'TOOL\\s+CALL\\s+(?<tool>\\d+)?\\s*(?:(?<axis>[XYZ])(?![A-Z0-9_]))?', toolFrom: 'same-line' as const },
    };
    const checked = validateProfile(variant);
    if (!checked.ok) throw new Error(checked.errors.join('; '));
    const c = { cp: compileProfile(checked.profile), db: ctx('heidenhain-klartext').db };
    const states = walk(c, ['1 TOOL CALL 5 Z S1000', '2 TOOL CALL Z S2000', '3 TOOL CALL S2500']);
    expect(states.map((s) => s.block.toolChange)).toEqual([true, false, false]);
    expect(states.map((s) => s.tool?.line ?? null)).toEqual([1, 1, 1]);
  });

  it('rule 9: an unknown code changes nothing', () => {
    expect(last('fanuc-gcode', ['G1 X1. F100.', 'G999'])).toEqual({ ...last('fanuc-gcode', ['G1 X1. F100.', '']) });
  });
});

describe('words that are values (P2 §7.16 #15, #94, #112)', () => {
  it('an = word is never a code: M3=3 is not M33, S3= is another spindle', () => {
    const s = last('sinumerik', ['S800 M3', 'M3=3 S3=1200']);
    expect(s.speed?.valueText).toBe('800');
    expect(s.groups.spindle?.code ?? null).not.toBe('M33');
  });

  it('an indexed word names its own spindle; the main spindle by number is the speed', () => {
    expect(last('sinumerik', ['S800', 'S[2]=500']).speed?.valueText).toBe('800');
    expect(last('sinumerik', ['S800', 'S1=900']).speed?.valueText).toBe('900');
    expect(last('sinumerik', ['S800', 'S[1]=950']).speed?.valueText).toBe('950');
  });

  it('a call is the code of its identifier (CYCLE83 runs in its block)', () => {
    expect(last('sinumerik', ['CYCLE83(50,0,2,-25,,-5)']).block.cycle).not.toBeNull();
  });

  it('does not follow SETMS: a plain S stays the speed in force (decision 7 of the prelude)', () => {
    const s = last('sinumerik', ['SETMS(2)', 'S600']);
    expect(s.speed?.valueText).toBe('600');
  });
});

describe('blocks over several lines (P2 §7.16 #27)', () => {
  it('a line starting with the continuation marker belongs to the block above (Okuma $)', () => {
    const s = walk(ctx('okuma-osp'), ['N1 G71 X27.55 Z-30. B60 D0.7 U0.1', '$ H2.45 L2 F2 M23', 'N2 G0 X100.']);
    expect(s[1].block.cycle).toBe(s[0].block.cycle);
    expect(s[0].block.cycle).not.toBeNull();
    expect(s[2].block.cycle).toBeNull();
  });

  it('a Klartext parameter list (~) is one block: the definition stands after its last line', () => {
    const s = walk(ctx('heidenhain-klartext'), ['CYCL DEF 200 DRILLING ~', '  Q200=2 ;CLEARANCE ~', '  Q201=-15 ;DEPTH', 'CYCL CALL']);
    expect(s[2].definedCycle?.code).toBe('CYCL DEF 200');
    expect(s[2].block.cycle).toBeNull();
    expect(s[3].block.cycle).toBe('CYCL DEF 200');
  });
});

describe('the defined cycle (rule 11)', () => {
  const lines = ['CYCL DEF 200 DRILLING', 'L X+10 Y+10 R0 FMAX M89', 'L X+20 Y+10 R0 FMAX', 'M8', 'CYCL CALL', 'L X+30 R0 FMAX', 'TOOL CALL 2 Z S900'];
  const s = walk(ctx('heidenhain-klartext'), lines);

  it('M89 runs the cycle in its own block and after every positioning block', () => {
    expect(s[1].modalCall?.code).toBe('M89');
    expect(s[1].block.cycle).toBe('CYCL DEF 200');
    expect(s[2].block.cycle).toBe('CYCL DEF 200');
    expect(s[2].activeCycle?.code).toBe('CYCL DEF 200');
    expect(s[3].block.cycle).toBeNull();
  });

  it('a call runs it once and ends the modal call; no tool change ends the definition', () => {
    expect(s[4].block.cycle).toBe('CYCL DEF 200');
    expect(s[4].modalCall).toBeNull();
    expect(s[5].block.cycle).toBeNull();
    expect(s[6].definedCycle?.code).toBe('CYCL DEF 200');
  });
});

describe('a cycle made modal by the word in front of it (rule 11b)', () => {
  const lines = [
    'MCALL CYCLE81(10,0,2,-5)',
    'X10 Y10',
    'G0 X20',
    'M8',
    'MCALL CYCLE840(10,0,2,-20,,0,1)',
    'X30',
    'MCALL MYHOLE(1)',
    'X40',
    'MCALL CYCLE81(10,0,2,-5)',
    'MCALL',
    'X50',
  ];
  const s = walk(ctx('sinumerik-mill'), lines);
  const summary = (state: ModalState): [string | null, string | null, boolean] => [
    state.activeCycle?.code ?? null,
    state.block.cycle,
    state.block.pitchFeed,
  ];

  it('runs the cycle after the word, not on its line, until the word stands alone', () => {
    expect(s.map(summary)).toEqual([
      ['CYCLE81', null, false],
      ['CYCLE81', 'CYCLE81', false],
      ['CYCLE81', 'CYCLE81', false],
      ['CYCLE81', null, false],
      ['CYCLE840', null, false],
      ['CYCLE840', 'CYCLE840', false],
      [null, null, false],
      [null, null, false],
      ['CYCLE81', null, false],
      [null, null, false],
      [null, null, false],
    ]);
    expect(s[0].activeCycle).toEqual({ code: 'CYCLE81', line: 1, pitchFeed: false });
    expect(s[5].activeCycle).toEqual({ code: 'CYCLE840', line: 5, pitchFeed: true });
  });

  it('leaves a cycle written without the word a flag of its own block', () => {
    expect(walk(ctx('sinumerik-mill'), ['CYCLE81(10,0,2,-5)', 'X10']).map(summary)).toEqual([
      [null, 'CYCLE81', false],
      [null, null, false],
    ]);
  });
});

describe('frames, tool centre point and the plane (rules 13-15)', () => {
  it('rule 13: a close ends the frames of its own group only', () => {
    const s = walk(ctx('fanuc-gcode'), ['G68 X0 Y0 R30.', 'G51 X0 Y0 P2.', 'G69', 'G50']);
    expect(s[1].frame?.code).toBe('G51');
    expect(s[2].frame?.code).toBe('G51');
    expect(s[3].frame).toBeNull();
  });

  it('rule 13: a Siemens frame code written without values closes its group', () => {
    const s = walk(ctx('sinumerik-mill'), ['CYCLE800(1,"TC1",200000,57,0,0,0,0,30,0,0,0,0,-1,100,1)', 'CYCLE800()']);
    expect(s[0].frame?.code).toBe('CYCLE800');
    expect(s[1].frame).toBeNull();
  });

  it('rule 13 (D6-5): a CYCLE800 that swivels to the home position closes the tilt, as _TC "0" does', () => {
    const lines = [
      'CYCLE800(1,"TC1",0,57,0,0,0,0,30,0,0,0,0,-1,100,1)',
      'CYCLE800(1,"",0,57,0,0,0,0,0,0,0,0,0,1,0,1)',
      'CYCLE800(2,"TC1",100000,57,0,0,0,0,30,0,0,0,0,-1,100,1)',
      'CYCLE800(1,"",1,57,0,0,0,0,0,0,0,0,0,1,0,1)',
      'CYCLE800(1,"0",0,57,0,0,0,0,30,0,0,0,0,1,0,1)',
      'CYCLE800(1,"",0,57,0,0,0,0,0,0,0,0,0,1,0,1)',
      'CYCLE800(1,"",0,57,0,0,0,0,R1,0,0,0,0,1,0,1)',
      'CYCLE800(1,"",0,57,0,0,0,0,,0,0,0,0,1,0,1)',
    ];
    const s = walk(ctx('sinumerik-mill'), lines);
    expect(s.map((x) => x.frame?.code ?? null)).toEqual(['CYCLE800', null, 'CYCLE800', 'CYCLE800', null, null, 'CYCLE800', 'CYCLE800']);
  });

  it('rule 13 (CODE-7): the zero-call closing does not depend on frameWithoutValues', () => {
    const base = ctx('sinumerik-mill');
    const codes = base.db.codes.map((e) => {
      const { frameWithoutValues: _dropped, ...rest } = e;
      return rest;
    });
    const c = { cp: base.cp, db: { ...base.db, codes } };
    expect(codes.some((e) => 'frameWithoutValues' in e)).toBe(false);
    const s = walk(c, [
      'CYCLE800(1,"TC1",0,57,0,0,0,0,30,0,0,0,0,-1,100,1)',
      'CYCLE800(1,"",0,57,0,0,0,0,0,0,0,0,0,1,0,1)',
      'CYCLE800(1,"TC1",0,57,0,0,0,0,30,0,0,0,0,-1,100,1)',
      'CYCLE800(1,"0",0,57,0,0,0,0,30,0,0,0,0,1,0,1)',
    ]);
    expect(s.map((x) => x.frame?.code ?? null)).toEqual(['CYCLE800', null, 'CYCLE800', null]);
  });

  it('rule 13: a tilt whose angles are all zero reads as none (cycle 19)', () => {
    const s = walk(ctx('heidenhain-klartext'), ['CYCL DEF 19.0 WORKING PLANE', 'CYCL DEF 19.1 B+30', 'CYCL DEF 19.1 B+0']);
    expect(s[1].frame).not.toBeNull();
    expect(s[2].frame).toBeNull();
  });

  it('rule 14: TCP is on from its code until an off code or a code of its group', () => {
    const s = walk(ctx('fanuc-gcode'), ['G43.4 H1', 'G1 X10. F100.', 'G43 H1']);
    expect(s[1].tcp).toEqual({ code: 'G43.4', line: 1 });
    expect(s[2].tcp).toBeNull();
  });

  it('rule 15: the bare tool axis of a tool call names the plane', () => {
    const s = walk(ctx('heidenhain-klartext'), ['TOOL CALL 1 Z S5000', 'TOOL CALL 2 Y S5000', 'TOOL CALL S800']);
    expect(s.map((x) => x.plane)).toEqual(['XY', 'ZX', 'ZX']);
  });

  it('rule 12: a lower speed limit is neither the speed nor the clamp', () => {
    const s = last('sinumerik', ['G26 S3000', 'S500', 'G25 S100']);
    expect(s.speedLimit?.valueText).toBe('3000');
    expect(s.speed?.valueText).toBe('500');
    expect(s.block.speedLimit).toBe(true);
  });
});

describe('state, snapshot and restore', () => {
  it('gives a frozen copy that later lines do not change', () => {
    const c = ctx('fanuc-gcode');
    const interp = new ModalInterpreter(c.cp, c.db);
    const r = tokenizeLine('G1 X1. F100.', c.cp);
    interp.update(r.tokens, 1, 'G1 X1. F100.');
    const before = interp.state();
    expect(Object.isFrozen(before)).toBe(true);
    expect(Object.isFrozen(before.groups)).toBe(true);
    expect(Object.isFrozen(before.feed)).toBe(true);
    const r2 = tokenizeLine('G0 F200.', c.cp);
    interp.update(r2.tokens, 2, 'G0 F200.');
    expect(before.groups.motion.code).toBe('G1');
    expect(before.feed?.valueText).toBe('100.');
  });

  it('restores everything, the open block and the frames included', () => {
    const c = ctx('heidenhain-klartext');
    const lines = ['CYCL DEF 19.0 WORKING PLANE', 'CYCL DEF 19.1 A+20 B+30', 'CYCL DEF 200 DRILLING ~', '  Q200=2 ~', '  Q201=-5', 'M89', 'L X+1 Y+1 FMAX'];
    const all = walk(c, lines);
    const interp = new ModalInterpreter(c.cp, c.db);
    let state: LineState | undefined;
    const step = (i: number): void => {
      const r = tokenizeLine(lines[i], c.cp, state);
      state = r.state;
      interp.update(r.tokens, i + 1, maskComments(lines[i], c.cp));
    };
    for (let i = 0; i < 3; i++) step(i);
    const snap = interp.snapshot();
    const lineState = state;
    for (let i = 3; i < lines.length; i++) step(i);
    const end = interp.state();
    // A different interpreter of the same context picks the walk up where the snapshot was.
    const other = new ModalInterpreter(c.cp, c.db);
    other.restore(snap);
    state = lineState;
    const replay: ModalState[] = [];
    for (let i = 3; i < lines.length; i++) {
      const r = tokenizeLine(lines[i], c.cp, state);
      state = r.state;
      other.update(r.tokens, i + 1, maskComments(lines[i], c.cp));
      replay.push(other.state());
    }
    expect(replay).toEqual(all.slice(3));
    expect(replay[replay.length - 1]).toEqual(end);
    // The snapshot was a copy: walking on did not change it.
    other.restore(snap);
    expect(other.state()).toEqual(all[2]);
  });

  it('carries the feed a CYCL CALL POS block puts back (rule 17, P4b fix batch 3 NC-6)', () => {
    const c = ctx('heidenhain-klartext');
    const lines = ['L X+10 Y+10 R0 F500', 'CYCL CALL POS X+40 Y+40 Z+0 F300', 'L X+90 Y+90'];
    const all = walk(c, lines);
    expect(all.map((s) => s.feed?.valueText)).toEqual(['500', '300', '500']);
    const interp = new ModalInterpreter(c.cp, c.db);
    for (let i = 0; i < 2; i++) interp.update(tokenizeLine(lines[i], c.cp).tokens, i + 1, maskComments(lines[i], c.cp));
    const snap = interp.snapshot();
    interp.update(tokenizeLine(lines[2], c.cp).tokens, 3, maskComments(lines[2], c.cp));
    const other = new ModalInterpreter(c.cp, c.db);
    other.restore(snap);
    other.update(tokenizeLine(lines[2], c.cp).tokens, 3, maskComments(lines[2], c.cp));
    expect(other.state()).toEqual(all[2]);
    expect(other.state().feed).toEqual({ valueText: '500', line: 1, variable: false });
  });

  it('refuses something that is not a snapshot', () => {
    const c = ctx('fanuc-gcode');
    expect(() => new ModalInterpreter(c.cp, c.db).restore({})).toThrow(TypeError);
  });
});

describe('what a line costs', () => {
  afterEach(() => vi.restoreAllMocks());

  /** Regex calls (`exec`, which `test`, `replace` and `match` go through) per `update`, after a warm-up. */
  function regexCallsPerLine(profileId: string, lines: readonly string[]): number {
    const c = ctx(profileId);
    const interp = new ModalInterpreter(c.cp, c.db);
    let state: LineState | undefined;
    const prepared: [NcToken[], string][] = lines.map((line) => {
      const r = tokenizeLine(line, c.cp, state);
      state = r.state;
      return [r.tokens, maskComments(line, c.cp)];
    });
    prepared.forEach(([tokens, masked], i) => interp.update(tokens, i + 1, masked)); // warm the memo
    const spy = vi.spyOn(RegExp.prototype, 'exec');
    prepared.forEach(([tokens, masked], i) => interp.update(tokens, i + 1, masked));
    const calls = spy.mock.calls.length;
    spy.mockRestore();
    return calls / lines.length;
  }

  it('pins the regex calls per line: only the tool rule and the continuation marker read the line', () => {
    // Fanuc mill: the trigger, and the tool pattern (`same-line-or-last` reads every line).
    expect(regexCallsPerLine('fanuc-gcode', ['G1 X10.123 Y-4.5 F1200.', 'X11.5 Y-5.', 'G0 Z50.'])).toBe(2);
    // Lathe: the trigger alone, on a line that is no tool line.
    expect(regexCallsPerLine('fanuc-lathe', ['G1 X50.123 Z-40.5 F.28', 'X52. W-3.'])).toBe(1);
    // Okuma: the continuation marker and the trigger.
    expect(regexCallsPerLine('okuma-osp', ['N1 G01 X56.123 Z-40.5 F0.28', 'X52 Z-45'])).toBe(2);
    // A tool line pays for the ignore and the tool pattern as well: at most four on any line.
    expect(regexCallsPerLine('okuma-osp', ['N2 T0202'])).toBeLessThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------

/** A fresh sequential walk of the whole document: the oracle for the index. */
function sequential(c: Ctx, lines: readonly string[]): ModalState[] {
  return [new ModalInterpreter(c.cp, c.db).state(), ...walk(c, lines)];
}

function buildAll(index: ModalIndex): void {
  for (let i = 0; i < 100_000 && !index.buildSome(1000); i++);
}

describe('ModalIndex', () => {
  it('snapshots every 1,000 lines by default', () => {
    expect(SNAPSHOT_EVERY).toBe(1000);
    expect(STATES_MAX).toBe(1000);
  });

  it('knows the power-on state and the first block of lines before it builds anything', () => {
    const lines = program(50);
    const index = indexOver(lines, 10);
    const oracle = sequential(ctx('fanuc-gcode'), lines);
    expect(index.ready()).toBe(false);
    expect(index.stateAfter(0)).toEqual(oracle[0]);
    expect(index.stateAfter(9)).toEqual(oracle[9]);
    // Line 10 is the line of snapshot 1, which the build has not made yet: it is read from
    // snapshot 0 (exactly `every` lines). Line 11 needs snapshot 1.
    expect(index.stateAfter(10)).toEqual(oracle[10]);
    expect(index.stateAfter(11)).toBeNull();
    expect(index.statesAfter(11, 12)).toBeNull();
    // A range only needs a snapshot before its first line: the rest is one replay (≤ 1,000 lines).
    expect(index.statesAfter(5, 12)).toEqual(oracle.slice(5, 13));
  });

  it('answers every line once built, as a sequential walk does', () => {
    const lines = program(237);
    const index = indexOver(lines, 10);
    buildAll(index);
    expect(index.ready()).toBe(true);
    const oracle = sequential(ctx('fanuc-gcode'), lines);
    for (let n = 0; n <= lines.length; n++) expect(index.stateAfter(n), `line ${n}`).toEqual(oracle[n]);
    // Backwards too: the reader's walk starts over from the nearest snapshot.
    for (let n = lines.length; n >= 0; n -= 7) expect(index.stateAfter(n), `line ${n}`).toEqual(oracle[n]);
  });

  it('answers null outside the document', () => {
    const index = indexOver(program(20), 10);
    buildAll(index);
    expect(index.stateAfter(-1)).toBeNull();
    expect(index.stateAfter(21)).toBeNull();
    expect(index.stateAfter(1.5)).toBeNull();
    expect(index.statesAfter(21, 25)).toBeNull();
  });

  it('gives statesAfter equal to stateAfter line by line, up to the end of the document', () => {
    const lines = program(95);
    const index = indexOver(lines, 10);
    buildAll(index);
    const states = index.statesAfter(0, 200);
    expect(states).toHaveLength(96);
    states?.forEach((s, n) => expect(s, `line ${n}`).toEqual(index.stateAfter(n)));
    expect(index.statesAfter(40, 39)).toEqual([]);
    expect(() => index.statesAfter(1, 1 + STATES_MAX)).toThrow(RangeError);
  });

  it('drops only the snapshots at and after the first changed line', () => {
    const lines = program(100);
    const index = indexOver(lines, 10);
    buildAll(index);
    lines[44] = 'G95 G1 X1. F.3';
    index.applyChange(45, lines.length, (n) => lines[n - 1]);
    expect(index.ready()).toBe(false);
    // Snapshots 0-4 (after lines 0, 10, …, 40) stand; line 49 replays from line 40.
    const oracle = sequential(ctx('fanuc-gcode'), lines);
    expect(index.stateAfter(44)).toEqual(oracle[44]);
    expect(index.stateAfter(49)).toEqual(oracle[49]);
    expect(index.stateAfter(51)).toBeNull();
    buildAll(index);
    for (let n = 0; n <= lines.length; n++) expect(index.stateAfter(n), `line ${n}`).toEqual(oracle[n]);
  });

  it('answers the line of a snapshot that an edit on that very line dropped', () => {
    // Typing on line k·every drops snapshot k (the state after that line); the line is read
    // from snapshot k-1 rather than waiting for the next idle slice.
    const lines = program(100);
    const index = indexOver(lines, 10);
    buildAll(index);
    lines[49] = 'G91 G1 X2. F.5';
    index.applyChange(50, lines.length, (n) => lines[n - 1]);
    const oracle = sequential(ctx('fanuc-gcode'), lines);
    expect(index.stateAfter(50)).toEqual(oracle[50]);
    expect(index.statesAfter(50, 52)).toEqual(oracle.slice(50, 53));
    expect(index.statesAfter(48, 50)).toEqual(oracle.slice(48, 51));
    expect(index.stateAfter(51)).toBeNull();
    expect(index.stateAfter(60)).toBeNull();
  });

  it('follows a document that grows and shrinks', () => {
    const lines = program(30);
    const index = indexOver(lines, 10);
    buildAll(index);
    lines.push(...program(25).slice(3));
    index.applyChange(31, lines.length, (n) => lines[n - 1]);
    buildAll(index);
    expect(index.stateAfter(lines.length)).toEqual(sequential(ctx('fanuc-gcode'), lines)[lines.length]);
    lines.length = 12;
    index.applyChange(12, 12, (n) => lines[n - 1]);
    expect(index.stateAfter(13)).toBeNull();
    buildAll(index);
    expect(index.ready()).toBe(true);
    expect(index.stateAfter(12)).toEqual(sequential(ctx('fanuc-gcode'), lines)[12]);
  });

  it('starts over with reset', () => {
    const lines = program(40);
    const index = indexOver(lines, 10);
    buildAll(index);
    const other = program(40).map((line) => line.replace('G90', 'G91'));
    index.reset(other.length, (n) => other[n - 1]);
    expect(index.stateAfter(25)).toBeNull();
    buildAll(index);
    expect(index.stateAfter(25)).toEqual(sequential(ctx('fanuc-gcode'), other)[25]);
  });

  it('keeps a Klartext block over its snapshot boundary', () => {
    // The tokenizer's `~` state is part of each snapshot: a parameter list that runs over a
    // snapshot line still belongs to its CYCL DEF.
    const c = ctx('heidenhain-klartext');
    const lines = ['TOOL CALL 1 Z S2000', 'L X+0 Y+0 R0 FMAX', 'CYCL DEF 200 DRILLING ~', '  Q200=2 ~', '  Q201=-5 ~', '  Q206=150', 'CYCL CALL', 'L X+5 FMAX M99', ''];
    const index = new ModalIndex(c.cp, c.db, { every: 4 });
    index.reset(lines.length, (n) => lines[n - 1]);
    buildAll(index);
    const oracle = sequential(c, lines);
    for (let n = 0; n <= lines.length; n++) expect(index.stateAfter(n), `line ${n}`).toEqual(oracle[n]);
  });



  it('reads the clock after every line and stops at its budget (a fake clock: 1 ms per line)', () => {
    const lines = program(5000);
    const index = indexOver(lines, SNAPSHOT_EVERY);
    let clock = 0;
    let reads = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => {
      reads++;
      return clock++;
    });
    try {
      expect(index.buildSome(8)).toBe(false);
    } finally {
      spy.mockRestore();
    }
    // One read for the deadline, one after each line: eight lines in an 8 ms budget.
    expect(reads).toBe(9);
    expect(index.stateAfter(8)).not.toBeNull();
  });

});
