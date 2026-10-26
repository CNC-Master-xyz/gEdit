// The motion and limits blocks (Phase 4 plan §6.4, AD-46; P4.8). The rule is the one of
// `channelBlock`: a broken block costs the block, never the record, and the numbers keep
// the bounds of `MOTION_BOUNDS` in the unit they were written in.

import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { validateProfile } from '$lib/core/profiles/validate';
import { effectiveMachine } from './effective';
import { parseMachinesFile, serializeMachinesFile } from './file';
import {
  MOTION_BOUNDS,
  MV,
  blockIssues,
  blocksFromValues,
  boundOf,
  boundText,
  limitsBlock,
  motionBlock,
  motionToValues,
  numberFault,
  parseSpindleOthers,
  prefillMember,
  prefillValue,
  validateLimits,
  validateMotion,
} from './motion';
import { validateMachine } from './validate';
import type { Profile } from '$lib/core/profiles/types';
import type { MachineConfig } from './types';

const MILL = { axes: ['X', 'Y', 'Z', 'A', 'B', 'C'], angular: ['A', 'B', 'C'] };
const PATH = 'machines[2]';

function machine(params: Record<string, unknown>): MachineConfig {
  return { id: 'm1', name: 'Mill 1', profile: 'fanuc-gcode', params: params as MachineConfig['params'] };
}

const messages = (problems: { message: string }[]): string[] => problems.map((p) => p.message);
const paths = (problems: { path: string }[]): string[] => problems.map((p) => p.path);

const PROFILES: Profile[] = BUILTIN_PROFILE_JSON.map((raw) => {
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  return checked.profile;
});

describe('the bounds of §6.4', () => {
  it('are the prelude numbers', () => {
    expect(MOTION_BOUNDS).toEqual({ rate: 200_000, rapidRotary: 1_000_000, toolChange: 600, peck: 100, spindle: 200_000, travel: 100_000 });
  });

  it('hold an inch value to the mm bound divided by 25.4, and a rotary rate and a speed to their own', () => {
    expect(boundOf('rate', 'inch')).toBeCloseTo(200_000 / 25.4, 6);
    expect(boundOf('peck', 'inch')).toBeCloseTo(100 / 25.4, 6);
    expect(boundOf('travel', 'inch')).toBeCloseTo(100_000 / 25.4, 6);
    expect(boundOf('travel', 'inch', true)).toBe(100_000); // degrees
    expect(boundOf('rapidRotary', 'inch')).toBe(1_000_000);
    expect(boundOf('spindle', 'inch')).toBe(200_000);
    expect(boundOf('toolChange', 'inch')).toBe(600);
  });

  it('show a bound cut, never rounded up, so a value typed as shown is accepted', () => {
    expect(boundText(200_000)).toBe('200,000');
    expect(boundText(200_000 / 25.4)).toBe('7,874.01');
    expect(numberFault('rate', 7874.01, 'inch')).toBeNull();
    expect(numberFault('rate', 7874.02, 'inch')).toBe('tooHigh');
  });
});

describe('P4.8: validation (plan §6.4 rule 2)', () => {
  it('a block without a member is absent; an empty object is valid and empty', () => {
    expect(motionBlock(machine({}), PATH, MILL)).toEqual({ state: 'absent' });
    expect(limitsBlock(machine({}), PATH, MILL)).toEqual({ state: 'absent' });
    expect(motionBlock(machine({ motion: {}, limits: {} }), PATH, MILL)).toEqual({ state: 'valid', motion: {} });
    expect(limitsBlock(machine({ motion: {}, limits: {} }), PATH, MILL)).toEqual({ state: 'valid', limits: {} });
    // a record without params at all is a machine without blocks
    expect(motionBlock({ id: 'm1', name: 'M', profile: 'fanuc-gcode' } as unknown as MachineConfig, PATH, MILL)).toEqual({ state: 'absent' });
  });

  it('accepts a complete block and hands the scripts a copy of it', () => {
    const motion = {
      units: 'mm',
      rapid: { X: 30_000, Y: 30_000, Z: 24_000, C: 12_000 },
      rapidKind: 'per-axis',
      maxFeed: 10_000,
      toolChange: 4.5,
      peckRetract: 0.5,
      peckClearance: 3,
    };
    const block = motionBlock(machine({ motion }), PATH, MILL);
    expect(block).toEqual({ state: 'valid', motion });
    if (block.state === 'valid') expect(block.motion).not.toBe(motion);
    const limits = { units: 'mm', spindle: { main: 8000, S2: 6000 }, travel: { X: { min: -300, max: 300 }, C: { min: 0, max: 360 } } };
    expect(limitsBlock(machine({ limits }), PATH, MILL)).toEqual({ state: 'valid', limits });
  });

  it('refuses a negative, zero or absurd rate, time, peck value, speed or travel with its JSON path', () => {
    const motion = validateMotion(
      { units: 'mm', rapid: { X: 0, Y: -5, Z: 200_001 }, maxFeed: -1, toolChange: -0.5, peckRetract: 0, peckClearance: 101 },
      `${PATH}.params.motion`,
      'm1',
      MILL,
    );
    expect(paths(motion)).toEqual([
      'machines[2].params.motion.rapid.X',
      'machines[2].params.motion.rapid.Y',
      'machines[2].params.motion.rapid.Z',
      'machines[2].params.motion.maxFeed',
      'machines[2].params.motion.toolChange',
      'machines[2].params.motion.peckRetract',
      'machines[2].params.motion.peckClearance',
    ]);
    expect(motion.every((p) => p.machineId === 'm1')).toBe(true);
    expect(messages(motion)[0]).toBe('a rapid rate is a number of mm/min above 0 and at most 200,000');
    expect(messages(motion)[4]).toBe('the tool-change time is a number of seconds, 0 or more and at most 600');
    expect(messages(motion)[5]).toBe('the peck retract is a number of mm above 0 and at most 100');

    const limits = validateLimits(
      { units: 'mm', spindle: { main: 0, S2: 200_001 }, travel: { X: { min: -100_001, max: 5 }, Y: { min: 0, max: 100_001 } } },
      `${PATH}.params.limits`,
      'm1',
      MILL,
    );
    expect(paths(limits)).toEqual([
      'machines[2].params.limits.spindle.main',
      'machines[2].params.limits.spindle.S2',
      'machines[2].params.limits.travel.X.min',
      'machines[2].params.limits.travel.Y.max',
    ]);
  });

  it('allows a tool-change time of 0, and refuses a value that is not a number', () => {
    expect(validateMotion({ toolChange: 0 }, 'm', null, MILL)).toEqual([]);
    for (const bad of ['5', null, true, [1], {}, Number.NaN]) {
      expect(validateMotion({ maxFeed: bad, units: 'mm' }, 'm', null, MILL)).toHaveLength(1);
    }
  });

  it('holds an inch value to the bound divided by 25.4', () => {
    expect(validateMotion({ units: 'inch', maxFeed: 7874 }, 'm', null, MILL)).toEqual([]);
    expect(messages(validateMotion({ units: 'inch', maxFeed: 7875 }, 'm', null, MILL))).toEqual([
      'the top feed is a number of inch/min above 0 and at most 7,874.01',
    ]);
    expect(validateMotion({ units: 'mm', maxFeed: 7875 }, 'm', null, MILL)).toEqual([]);
    expect(validateMotion({ units: 'inch', peckClearance: 3.93 }, 'm', null, MILL)).toEqual([]);
    expect(validateMotion({ units: 'inch', peckClearance: 3.94 }, 'm', null, MILL)).toHaveLength(1);
    // the tool-change time and the speeds are no lengths
    expect(validateMotion({ units: 'inch', toolChange: 600 }, 'm', null, MILL)).toEqual([]);
    expect(validateLimits({ units: 'inch', spindle: { main: 200_000 } }, 'l', null, MILL)).toEqual([]);
  });

  it('refuses a length or rate without units, and a rate for an axis the profile does not have', () => {
    expect(messages(validateMotion({ maxFeed: 5000 }, 'motion', null, MILL))).toEqual([
      'choose mm or inch: every length and rate in this block is read in it',
    ]);
    expect(paths(validateMotion({ rapid: { X: 1000 } }, 'motion', null, MILL))).toEqual(['motion.units']);
    expect(paths(validateMotion({ peckRetract: 1 }, 'motion', null, MILL))).toEqual(['motion.units']);
    // a tool-change time alone needs no units
    expect(validateMotion({ toolChange: 5 }, 'motion', null, MILL)).toEqual([]);
    // units that are neither mm nor inch are named once, not twice
    expect(paths(validateMotion({ units: 'cm', maxFeed: 5000 }, 'motion', null, MILL))).toEqual(['motion.units']);

    const wrong = validateMotion({ units: 'mm', rapid: { W: 1000 } }, 'motion', null, MILL);
    expect(paths(wrong)).toEqual(['motion.rapid.W']);
    expect(wrong[0].message).toBe('W is not an axis of this dialect; its axes are X, Y, Z, A, B, C');
    expect(paths(validateLimits({ units: 'mm', travel: { W: { min: 0, max: 1 } } }, 'limits', null, MILL))).toEqual(['limits.travel.W']);
    expect(paths(validateLimits({ travel: { X: { min: 0, max: 1 } } }, 'limits', null, MILL))).toEqual(['limits.units']);
    // a spindle needs no units
    expect(validateLimits({ spindle: { main: 4000 } }, 'limits', null, MILL)).toEqual([]);
  });

  it('reads a rotary rate in degrees per minute and holds it to MOTION_BOUNDS.rapidRotary', () => {
    expect(validateMotion({ units: 'inch', rapid: { C: 900_000 } }, 'motion', null, MILL)).toEqual([]);
    expect(validateMotion({ units: 'mm', rapid: { X: 900_000 } }, 'motion', null, MILL)).toHaveLength(1);
    const over = validateMotion({ units: 'mm', rapid: { A: 1_000_001 } }, 'motion', null, MILL);
    expect(messages(over)).toEqual(['the rapid rate of A is a number of degrees/min above 0 and at most 1,000,000']);
    // a rotary travel is in degrees and not scaled by the units
    expect(validateLimits({ units: 'inch', travel: { C: { min: -50_000, max: 50_000 } } }, 'limits', null, MILL)).toEqual([]);
    expect(validateLimits({ units: 'inch', travel: { X: { min: -50_000, max: 50_000 } } }, 'limits', null, MILL)).toHaveLength(2);
  });

  it('refuses a travel whose min is not below its max', () => {
    for (const entry of [{ min: 5, max: 5 }, { min: 10, max: -10 }]) {
      const problems = validateLimits({ units: 'mm', travel: { X: entry } }, 'limits', null, MILL);
      expect(paths(problems)).toEqual(['limits.travel.X']);
      expect(problems[0].message).toContain('lowest position (min) below its highest (max)');
    }
    expect(validateLimits({ units: 'mm', travel: { X: { min: -1, max: 0 } } }, 'limits', null, MILL)).toEqual([]);
    expect(paths(validateLimits({ units: 'mm', travel: { X: { min: 0 } } }, 'limits', null, MILL))).toEqual(['limits.travel.X.max']);
    expect(paths(validateLimits({ units: 'mm', travel: { X: { min: 0, max: 1, extra: 2 } } }, 'limits', null, MILL))).toEqual(['limits.travel.X.extra']);
  });

  it('refuses a spindle key that is neither main nor a speed address', () => {
    expect(validateLimits({ spindle: { main: 1, S2: 2, SB: 3, S12: 4 } }, 'limits', null, MILL)).toEqual([]);
    for (const key of ['s2', 'Main', '2S', 'SPINDLE', '', 'S-1']) {
      expect(paths(validateLimits({ spindle: { [key]: 1000 } }, 'limits', null, MILL))).toEqual([`limits.spindle.${key}`]);
    }
  });

  it('refuses an unknown rapidKind, an unknown member and a block that is no object', () => {
    expect(paths(validateMotion({ rapidKind: 'fast' }, 'motion', null, MILL))).toEqual(['motion.rapidKind']);
    expect(validateMotion({ rapidKind: 'straight' }, 'motion', null, MILL)).toEqual([]);
    expect(validateMotion({ rapidKind: 'per-axis' }, 'motion', null, MILL)).toEqual([]);
    expect(paths(validateMotion({ acceleration: 5 }, 'motion', null, MILL))).toEqual(['motion.acceleration']);
    expect(paths(validateLimits({ jerk: 5 }, 'limits', null, MILL))).toEqual(['limits.jerk']);
    for (const raw of [null, 5, 'x', [], true]) {
      expect(paths(validateMotion(raw, 'motion', null, MILL))).toEqual(['motion']);
      expect(paths(validateLimits(raw, 'limits', null, MILL))).toEqual(['limits']);
    }
    expect(paths(validateMotion({ rapid: [1, 2] }, 'motion', null, MILL))).toEqual(['motion.rapid']);
    expect(paths(validateLimits({ spindle: 4000 }, 'limits', null, MILL))).toEqual(['limits.spindle']);
    expect(paths(validateLimits({ travel: [] }, 'limits', null, MILL))).toEqual(['limits.travel']);
  });

  it('a broken block is invalid with its problems, and the record stays usable (validateMachine reports nothing)', () => {
    const broken = machine({ units: 'mm', motion: { maxFeed: -3, units: 'mm' }, limits: 'nonsense' });
    const motion = motionBlock(broken, 'machines[0]', MILL);
    expect(motion.state).toBe('invalid');
    if (motion.state === 'invalid') expect(paths(motion.problems)).toEqual(['machines[0].params.motion.maxFeed']);
    const limits = limitsBlock(broken, 'machines[0]', MILL);
    expect(limits.state).toBe('invalid');
    if (limits.state === 'invalid') expect(paths(limits.problems)).toEqual(['machines[0].params.limits']);
    // the record: no problem of either block, the other parameters in use
    const profile = PROFILES.find((p) => p.id === 'fanuc-gcode')!;
    expect(validateMachine(broken, { path: 'machines[0]', profile })).toEqual([]);
    expect(effectiveMachine(profile, broken, 'document', {}).params.units).toBe('mm');
  });
});

describe('P4.8: the record and the context', () => {
  const blocks = {
    motion: { units: 'mm', rapid: { X: 30_000 }, maxFeed: 9000, peckRetract: 0.5, futureMember: { kept: true } },
    limits: { units: 'mm', spindle: { main: 6000 }, travel: { X: { min: -200, max: 200 } }, another: 1 },
  };
  const FILE = {
    machines: [{ id: 'm1', name: 'Mill 1', profile: 'fanuc-gcode', params: { units: 'mm', ...blocks }, notes: 'n' }],
    defaults: {},
  };

  it('round trip: a machine with both blocks is written and read back member for member, unknown members kept', () => {
    const parsed = parseMachinesFile(structuredClone(FILE));
    expect(parsed.error).toBeNull();
    expect(parsed.invalid).toEqual([]);
    expect(parsed.machines).toHaveLength(1);
    expect(serializeMachinesFile(parsed)).toEqual(FILE);
    expect(parsed.machines[0].params).toMatchObject(blocks);
  });

  it('a record with a broken block is still a record of the file, and is written back as it was', () => {
    const file = structuredClone(FILE);
    (file.machines[0].params as Record<string, unknown>).motion = { maxFeed: 'fast' };
    const parsed = parseMachinesFile(structuredClone(file));
    expect(parsed.invalid).toEqual([]);
    expect(parsed.machines).toHaveLength(1);
    expect(serializeMachinesFile(parsed)).toEqual(file);
  });

  it('a rate change leaves effectiveKey and EffectiveMachine.params unchanged', () => {
    const profile = PROFILES.find((p) => p.id === 'fanuc-gcode')!;
    const a = effectiveMachine(profile, machine({ motion: { units: 'mm', maxFeed: 5000 }, limits: { spindle: { main: 4000 } } }), 'document', {});
    const b = effectiveMachine(profile, machine({ motion: { units: 'mm', maxFeed: 9000, rapid: { X: 1 } }, limits: { spindle: { main: 8000 } } }), 'document', {});
    const none = effectiveMachine(profile, machine({}), 'document', {});
    expect(a.key).toBe(b.key);
    expect(a.key).toBe(none.key);
    expect(a.params).toEqual(b.params);
    expect(a.params).not.toHaveProperty('motion');
    expect(a.params).not.toHaveProperty('limits');
    expect(a.key).not.toContain('maxFeed');
  });
});

describe('the page values', () => {
  const O = MILL;

  it('read a stored block leniently, with one units for both blocks', () => {
    const values = motionToValues(
      { units: 'inch', rapid: { X: 1200, Y: 'quick' }, rapidKind: 'per-axis', maxFeed: 300, toolChange: 3 },
      { units: 'inch', spindle: { main: 5000, S2: 3000, SB: 2500 }, travel: { X: { min: -10, max: 10 } } },
    );
    expect(values).toMatchObject({
      [MV.units]: 'inch',
      [MV.rapid('X')]: 1200,
      [MV.rapid('Y')]: 'quick',
      [MV.rapidKind]: 'per-axis',
      maxFeed: 300,
      toolChange: 3,
      [MV.spindleMain]: 5000,
      [MV.spindleOthers]: 'S2=3000, SB=2500',
      [MV.travelMin('X')]: -10,
      [MV.travelMax('X')]: 10,
    });
    // blocks that disagree on the units start with none chosen
    expect(motionToValues({ units: 'mm' }, { units: 'inch' })[MV.units]).toBe('');
    expect(motionToValues(undefined, undefined)[MV.units]).toBe('');
    expect(motionToValues('junk', 5)).toMatchObject({ [MV.units]: '', [MV.rapidKind]: '' });
  });

  it('make the blocks: an empty field removes the member, an empty block removes the block', () => {
    expect(blocksFromValues({}, O)).toEqual({});
    expect(blocksFromValues({ [MV.units]: 'mm', [MV.rapidKind]: '', maxFeed: undefined, [MV.spindleOthers]: ' ' }, O)).toEqual({});
    const made = blocksFromValues(
      {
        [MV.units]: 'mm',
        [MV.rapid('X')]: 30_000,
        [MV.rapid('Y')]: undefined,
        [MV.rapidKind]: 'straight',
        peckRetract: 0.5,
        [MV.spindleMain]: 6000,
        [MV.spindleOthers]: 's2 = 3000; SB=2500',
        [MV.travelMin('Z')]: -400,
        [MV.travelMax('Z')]: 0,
        [MV.travelMin('Q')]: 1, // not an axis of the profile: no field, so no member
      },
      O,
    );
    expect(made.motion).toEqual({ units: 'mm', rapid: { X: 30_000 }, rapidKind: 'straight', peckRetract: 0.5 });
    expect(made.limits).toEqual({ units: 'mm', spindle: { main: 6000, S2: 3000, SB: 2500 }, travel: { Z: { min: -400, max: 0 } } });
    // the made blocks are valid blocks
    expect(validateMotion(made.motion, 'm', null, O)).toEqual([]);
    expect(validateLimits(made.limits, 'l', null, O)).toEqual([]);
  });

  it('writes units only into a block that has something else, and a spindle needs none', () => {
    expect(blocksFromValues({ [MV.units]: 'inch', [MV.spindleMain]: 4000 }, O)).toEqual({ limits: { units: 'inch', spindle: { main: 4000 } } });
    expect(blocksFromValues({ [MV.spindleMain]: 4000 }, O)).toEqual({ limits: { spindle: { main: 4000 } } });
  });

  it('keeps a number that does not parse as text, so the validator names it', () => {
    const made = blocksFromValues({ [MV.units]: 'mm', maxFeed: '12x' }, O);
    expect(made.motion).toEqual({ units: 'mm', maxFeed: '12x' });
    expect(validateMotion(made.motion, 'motion', null, O)).toHaveLength(1);
  });

  it('say what is wrong next to the field, with the bound in the unit', () => {
    const issues = blockIssues(
      {
        [MV.units]: 'inch',
        maxFeed: 9000,
        [MV.rapid('X')]: -1,
        [MV.rapid('C')]: 2_000_000,
        toolChange: 700,
        [MV.travelMin('X')]: 5,
        [MV.travelMax('X')]: 5,
        [MV.travelMin('Y')]: 1,
        [MV.spindleOthers]: 'S2=3000, nonsense',
        peckClearance: 'abc',
      },
      O,
    );
    expect(issues.maxFeed).toEqual({ key: 'machines.motion.err.above0', params: { max: '7,874.01' } });
    expect(issues[MV.rapid('X')]?.key).toBe('machines.motion.err.above0');
    expect(issues[MV.rapid('C')]).toEqual({ key: 'machines.motion.err.above0', params: { max: '1,000,000' } });
    expect(issues.toolChange).toEqual({ key: 'machines.motion.err.from0', params: { max: '600' } });
    expect(issues[MV.travelMax('X')]).toEqual({ key: 'machines.motion.err.minMax' });
    expect(issues[MV.travelMax('Y')]).toEqual({ key: 'machines.motion.err.bothEnds' });
    expect(issues[MV.spindleOthers]?.key).toBe('machines.motion.err.spindles');
    expect(issues.peckClearance?.key).toBe('machines.motion.err.above0');
  });

  it('ask for the units once a length or rate is typed, and not for a time or a speed', () => {
    expect(blockIssues({ maxFeed: 3000 }, O)[MV.units]).toEqual({ key: 'machines.motion.err.units' });
    expect(blockIssues({ [MV.travelMin('X')]: -1, [MV.travelMax('X')]: 1 }, O)[MV.units]).toEqual({ key: 'machines.motion.err.units' });
    expect(blockIssues({ toolChange: 5, [MV.spindleMain]: 4000 }, O)).toEqual({});
    expect(blockIssues({ [MV.units]: 'mm', maxFeed: 3000 }, O)).toEqual({});
    expect(blockIssues({}, O)).toEqual({});
  });

  it('agree with the validators: values without issues make valid blocks', () => {
    const values = {
      [MV.units]: 'mm',
      [MV.rapid('A')]: 18_000,
      maxFeed: 100_000,
      toolChange: 0,
      [MV.spindleOthers]: 'SB=2500',
      [MV.travelMin('A')]: -120,
      [MV.travelMax('A')]: 120,
    };
    expect(blockIssues(values, O)).toEqual({});
    const made = blocksFromValues(values, O);
    expect(validateMotion(made.motion, 'm', null, O)).toEqual([]);
    expect(validateLimits(made.limits, 'l', null, O)).toEqual([]);
  });

  it('read the other spindles as address=speed and refuse the rest', () => {
    expect(parseSpindleOthers('S2=4000, sb = 3000.5\nS3=x')).toEqual({ entries: { S2: 4000, SB: 3000.5, S3: 'x' }, bad: [] });
    expect(parseSpindleOthers('S2 4000, =5, S2=, 2S=5, S2=1, S2=2').bad).toEqual(['S2 4000', '=5', 'S2=', '2S=5', 'S2=2']);
    expect(parseSpindleOthers('').entries).toEqual({});
  });

  it('refuse main= in the other spindles: it would be stored as the key MAIN (CODE-8 c)', () => {
    expect(parseSpindleOthers('main=6000')).toEqual({ entries: {}, bad: ['main=6000'] });
    expect(parseSpindleOthers('S2=4000, Main = 6000').bad).toEqual(['Main = 6000']);
    const values = { ...motionToValues(undefined, undefined), units: 'mm', [MV.spindleOthers]: 'main=6000' };
    expect(blockIssues(values, O)[MV.spindleOthers]).toEqual({ key: 'machines.motion.err.spindles', params: { part: 'main=6000' } });
    expect(blocksFromValues(values, O).limits?.spindle).toBeUndefined();
  });
});

describe('the prefill of a script parameter (§6.4 rule 5)', () => {
  it('knows exactly the members of the contract', () => {
    for (const member of ['peckRetract', 'peckClearance', 'maxFeed', 'toolChange', 'rapidKind', 'units', 'rapid.X', 'rapid.AR']) {
      expect(prefillMember(`machine.motion.${member}`)).toBe(member);
    }
  });

  it('ignores anything else, and never evaluates it', () => {
    for (const bad of [
      'machine.motion.',
      'machine.motion.rapid',
      'machine.motion.rapid.',
      'machine.motion.rapid.x',
      'machine.motion.rapid.X.Y',
      'machine.motion.rapid.TOOLONG',
      'machine.motion.constructor',
      'machine.motion.__proto__',
      'machine.motion.toString',
      'machine.limits.spindle',
      'machine.motion.maxFeed ',
      ' machine.motion.maxFeed',
      'machine.motion.maxFeed\n',
      'motion.maxFeed',
      'machine.motion.maxFeed; process.exit()',
      '${machine.motion.maxFeed}',
      '',
      5,
      null,
      undefined,
      { a: 1 },
    ]) {
      expect(prefillMember(bad)).toBeNull();
    }
  });

  it('reads the machine value, and nothing while the machine has none', () => {
    const motion = { units: 'inch' as const, rapid: { X: 1200 }, rapidKind: 'per-axis' as const, maxFeed: 300, peckRetract: 0.02 };
    expect(prefillValue('maxFeed', motion)).toBe(300);
    expect(prefillValue('peckRetract', motion)).toBe(0.02);
    expect(prefillValue('units', motion)).toBe('inch');
    expect(prefillValue('rapidKind', motion)).toBe('per-axis');
    expect(prefillValue('rapid.X', motion)).toBe(1200);
    expect(prefillValue('rapid.Z', motion)).toBeUndefined();
    expect(prefillValue('toolChange', motion)).toBeUndefined();
    expect(prefillValue('maxFeed', undefined)).toBeUndefined();
    expect(prefillValue('rapid.X', {})).toBeUndefined();
    // a member outside the closed list reads nothing, even when the block has it
    expect(prefillValue('constructor', motion)).toBeUndefined();
    expect(prefillValue('rapid.constructor', motion)).toBeUndefined();
  });
});
