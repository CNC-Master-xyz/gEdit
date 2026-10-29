// P3.2a: reading one word on the document's machine (Phase 3 plan §6.3, AD-35). Every state
// here is built by hand, the way the modal interpreter leaves it after the block (the Python
// goldens under `tests/fixtures/modal/**` show the same members); nothing depends on P3.1.

import { describe, expect, it } from 'vitest';
import { loadCodeDb } from '$lib/core/codes/load';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import { applyMachine, effectiveMachine } from '$lib/core/machines/effective';
import type { MachineConfig, MachineParams, NumberInput } from '$lib/core/machines/types';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import type { LineState, ModalState, ModalValue, NcToken } from '$lib/core/nc/types';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { profileOf } from '../../../../tests/unit/helpers/profiles';
import { arcCentreEntry, blockCycleOf, diameterReading, inForceEntries, readWord, type WordView } from './wordValue';
import type { CodeDb, CodeEntry } from './types';

const DBS = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, problem) => {
  throw new Error(`${dialect}: ${problem.path}: ${problem.message}`);
});

interface View extends WordView {
  cp: CompiledProfile;
}

function preset(profileId: string, id: string): NumberInput {
  const found = profileOf(profileId).machineParams?.numberInput?.presets.find((p) => p.id === id);
  if (!found) throw new Error(`${profileId}: no preset ${id}`);
  return found.value;
}

/** The document's effective view: the built-in profile, a machine or none, the variants as given. */
function viewOf(
  profileId: string,
  o: { name?: string; params?: Partial<MachineParams> } | null = null,
): View {
  const base = profileOf(profileId);
  const machine: MachineConfig | null = o ? { id: 'm', name: o.name ?? 'Machine', profile: profileId, params: o.params ?? {} } : null;
  const eff = effectiveMachine(base, machine, machine ? 'document' : 'none', {});
  const applied = applyMachine(base, eff);
  const checked = validateProfile(applied.profile, { applied: true });
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  const db: CodeDb = loadCodeDb(DBS[applied.codes]);
  return { profile: checked.profile, cp: compileProfile(checked.profile), db, machine: eff };
}

function mv(code: string, line = 0, from?: ModalValue['from']): ModalValue {
  return line === 0 ? { code, line, assumed: true, from: from ?? 'profile' } : { code, line, assumed: false };
}

/** A state after a block, with everything not given as the interpreter leaves an empty program. */
function state(o: Partial<Omit<ModalState, 'block'>> & { block?: Partial<ModalState['block']> } = {}): ModalState {
  const { block, ...rest } = o;
  return {
    groups: {},
    feedUnit: 'unknown',
    speedUnit: 'unknown',
    distance: 'unknown',
    units: { value: 'mm', line: 0, assumed: true, from: 'profile' },
    plane: 'unknown',
    diameter: null,
    tool: null,
    feed: null,
    speed: null,
    speedLimit: null,
    activeCycle: null,
    definedCycle: null,
    modalCall: null,
    frame: null,
    tcp: null,
    pitchFeedAmbiguous: null,
    ...rest,
    block: { cycle: null, pitchFeed: false, speedLimit: false, fNotFeed: false, toolChange: false, ...block },
  };
}

function tokensOf(cp: CompiledProfile, ...lines: string[]): NcToken[] {
  let prev: LineState | undefined;
  return lines.flatMap((line) => {
    const result = tokenizeLine(line, cp, prev);
    prev = result.state;
    return result.tokens;
  });
}

function word(tokens: readonly NcToken[], text: string): NcToken {
  const found = tokens.find((t) => t.text === text);
  if (!found) throw new Error(`no token ${text} in ${tokens.map((t) => t.text).join('|')}`);
  return found;
}

/** Reads `text` of the block `lines` in `after`. */
function read(view: View, after: ModalState, text: string, ...lines: string[]) {
  const tokens = tokensOf(view.cp, ...lines);
  return readWord(word(tokens, text), tokens, after, view);
}

// The power-on state of a Fanuc lathe in G-code system A (no distance codes: absolute is known).
const LATHE_A = {
  groups: { feedmode: mv('G99'), spindlemode: mv('G97'), plane: mv('G18'), motion: mv('G0', 2) },
  feedUnit: 'per-rev' as const,
  speedUnit: 'rpm' as const,
  distance: 'absolute' as const,
  plane: 'ZX' as const,
  diameter: { mode: 'on' as const, line: 0, assumed: true, from: 'profile' as const },
};

describe('diameterReading (AD-19 rule 11, the twin of Python diameter_reading)', () => {
  const profile = profileOf('sinumerik');
  const on = state({ diameter: { mode: 'on', line: 0, assumed: true, from: 'profile' }, distance: 'absolute' });

  it('answers per word: the diameter words, every other word a radius', () => {
    expect(diameterReading(on, profile, 'X')).toBe('diameter');
    expect(diameterReading(on, profile, 'x')).toBe('diameter');
    expect(diameterReading(on, profile, 'Z')).toBe('radius');
  });

  it('follows the mode, and the distance mode under DIAM90 (the cases of test_modal.py)', () => {
    const cases: [ModalState, string][] = [
      [state({ diameter: { mode: 'off', line: 1, assumed: false }, distance: 'absolute' }), 'radius'], // DIAMOF
      [state({ diameter: { mode: 'absolute-only', line: 2, assumed: false }, distance: 'absolute' }), 'diameter'], // DIAM90 G90
      [state({ diameter: { mode: 'absolute-only', line: 2, assumed: false }, distance: 'incremental' }), 'radius'], // G91
      [state({ diameter: { mode: 'absolute-only', line: 2, assumed: false }, distance: 'absolute' }), 'diameter'], // G90
      [state({ diameter: { mode: 'absolute-only', line: 2, assumed: false }, distance: 'unknown' }), 'unknown'],
    ];
    for (const [s, expected] of cases) expect(diameterReading(s, profile, 'X')).toBe(expected);
  });

  it('a profile without the parameter, or no word asked: the mode alone', () => {
    expect(diameterReading(state(), profileOf('fanuc-gcode'), 'X')).toBe('radius');
    expect(diameterReading(state({ diameter: null }), profile)).toBe('radius');
    expect(diameterReading(on, profile)).toBe('diameter');
  });
});

describe('readWord on a Fanuc lathe (G-code system A)', () => {
  const none = viewOf('fanuc-lathe');
  const after = state(LATHE_A);

  it('reads U as incremental X, a diameter, and W as incremental Z', () => {
    const u = read(none, after, 'U-2.', 'G0 U-2. W1.');
    expect(u).toMatchObject({ cls: 'length', value: '-2', unit: 'mm', incremental: true, diameter: 'diameter', lead: false });
    const w = read(none, after, 'W1.', 'G0 U-2. W1.');
    expect(w).toMatchObject({ cls: 'length', value: '1', incremental: true, diameter: null });
  });

  it('reads X with a point as a diameter, absolute, the same on every preset', () => {
    expect(read(none, after, 'X50.', 'G0 X50. Z2.')).toMatchObject({
      value: '50',
      unit: 'mm',
      source: 'profile',
      readings: [],
      diameter: 'diameter',
      incremental: false,
    });
  });

  it('reads a point-less X with no machine as every reading, the default first', () => {
    const x = read(none, after, 'X50', 'G0 X50 Z2.');
    expect(x?.value).toBeNull();
    expect(x?.unit).toBe('mm');
    expect(x?.readings.map((r) => [r.preset, r.value])).toEqual([
      ['calculator', '50'],
      ['is-a', '0.5'],
      ['is-b', '0.05'],
      ['is-c', '0.005'],
    ]);
  });

  it('reads it on the machine, with the machine as the source', () => {
    const isb = viewOf('fanuc-lathe', { name: 'Lathe IS-B', params: { numberInput: preset('fanuc-lathe', 'is-b') } });
    expect(read(isb, after, 'X50', 'G0 X50 Z2.')).toMatchObject({ value: '0.05', unit: 'mm', source: 'machine', readings: [] });
    const calc = viewOf('fanuc-lathe', { name: 'Lathe calc', params: { numberInput: preset('fanuc-lathe', 'calculator') } });
    expect(read(calc, after, 'X50', 'G0 X50 Z2.')).toMatchObject({ value: '50', source: 'machine', readings: [] });
  });

  it('reads F as a thread lead under G76, and P and Q of the second block as the database declares them', () => {
    const block = 'G76 X27.6 Z-30. R0 P1200 Q300 F1.5';
    const g76 = state({ ...LATHE_A, block: { cycle: 'G76', pitchFeed: true } });
    expect(read(none, g76, 'F1.5', block)).toMatchObject({ cls: 'feedPerRev', value: '1.5', unit: 'mm/rev', lead: true });
    // P: the thread height, read by its block (T118; the test below).
    // Q: micrometres on the source controls, a whole number of increments.
    const calc = viewOf('fanuc-lathe', { params: { numberInput: preset('fanuc-lathe', 'calculator') } });
    expect(read(calc, g76, 'Q300', block)).toMatchObject({ cls: 'increment', value: '0.3', unit: 'mm' });
    // X of the second block: a diameter.
    expect(read(none, g76, 'X27.6', block)?.diameter).toBe('diameter');
  });

  // P4h (plan §6.10 rules 10, 11; T118): the second-block `P` of `G76` is the thread height in
  // least increments, the first-block `P` packs three two-digit values. Before P4.43a the block
  // was not passed, the two declarations disagreed, and P had no class in either block. Read
  // from the shipped `fanuc-lathe.json`: with its second-block `P` a `count` again, this fails.
  it('reads the G76 P by its block: the thread height in increments in the second, a count in the first', () => {
    const isb = viewOf('fanuc-lathe', { name: 'Lathe IS-B', params: { numberInput: preset('fanuc-lathe', 'is-b') } });
    const calc = viewOf('fanuc-lathe', { params: { numberInput: preset('fanuc-lathe', 'calculator') } });
    const g76 = state({ ...LATHE_A, block: { cycle: 'G76', pitchFeed: true } });
    const second = 'G76 X27.6 Z-30. R0 P1500 Q300 F1.5';
    expect(read(isb, g76, 'P1500', second)).toMatchObject({ cls: 'increment', value: '1.5', unit: 'mm', source: 'machine' });
    // An increment parameter is a count of increments even where positions are read as written.
    expect(read(calc, g76, 'P1500', second)).toMatchObject({ cls: 'increment', value: '1.5', unit: 'mm' });
    const first = 'G76 P020060 Q50 R0.02';
    expect(read(isb, g76, 'P020060', first)).toMatchObject({ cls: 'count', value: null, readings: [], source: null });
    // Q is in increments in both blocks and stays so.
    expect(read(isb, g76, 'Q50', first)).toMatchObject({ cls: 'increment', value: '0.05' });
    // With no machine the lathe presets do not agree on a step, so the height has no value but its readings.
    const none118 = viewOf('fanuc-lathe', null);
    const free = read(none118, g76, 'P1500', second);
    expect(free?.cls).toBe('increment');
    expect(free?.value).toBeNull();
    expect(free?.readings.length).toBeGreaterThan(1);
  });

  it('reads F of a modal threading move in force as a lead, and a feed after G99 as a feed per revolution', () => {
    const g32 = state({ ...LATHE_A, groups: { ...LATHE_A.groups, motion: mv('G32', 5) } });
    expect(read(none, g32, 'F1.5', 'Z-40. F1.5')).toMatchObject({ lead: true, cls: 'feedPerRev' });
    const g1 = state({ ...LATHE_A, groups: { ...LATHE_A.groups, feedmode: mv('G99', 3), motion: mv('G1', 3) } });
    expect(read(none, g1, 'F.2', 'G99 G1 X20. F.2')).toMatchObject({ lead: false, cls: 'feedPerRev', value: '0.2', unit: 'mm/rev' });
  });

  it('gives S no class: never converted', () => {
    const css = state({ ...LATHE_A, speedUnit: 'surface', groups: { ...LATHE_A.groups, spindlemode: mv('G96', 4) } });
    expect(read(none, css, 'S220', 'G96 S220 M03')).toMatchObject({ cls: null, value: null, unit: null, source: null });
  });

  it('answers null for a token without a value', () => {
    const tokens = tokensOf(none.cp, 'G0 X10. (RETRACT)');
    expect(readWord(word(tokens, '(RETRACT)'), tokens, after, none)).toBeNull();
  });
});

describe('blockCycleOf (P4h, plan §6.10 rule 11; T118)', () => {
  const lathe = viewOf('fanuc-lathe');
  const cycle = (code: string, first: string[], second: string[]): CodeEntry => ({
    code,
    label: code,
    group: 'nonmodal',
    blocks: 2,
    params: [
      ...first.map((address) => ({ address, label: address, block: 1 as const })),
      ...second.map((address) => ({ address, label: address, block: 2 as const })),
    ],
  });

  it('answers the block of the one two-block cycle of the block, from the words it writes', () => {
    const g76 = cycle('G76', ['P', 'Q', 'R'], ['X', 'Z', 'P', 'Q', 'F']);
    expect(blockCycleOf([g76], tokensOf(lathe.cp, 'G76 X27.6 Z-30. P1500 Q300 F1.5'))).toBe(2);
    expect(blockCycleOf([g76], tokensOf(lathe.cp, 'G76 P020060 Q50 R0.02'))).toBe(1);
    // Nothing the entry declares: not known.
    expect(blockCycleOf([g76], tokensOf(lathe.cp, 'G76 S500'))).toBeNull();
  });

  it('answers null without a two-block cycle, and when two of them disagree', () => {
    expect(blockCycleOf([], tokensOf(lathe.cp, 'G0 X10. P5'))).toBeNull();
    expect(blockCycleOf([{ code: 'G4', label: 'Dwell', group: 'nonmodal', params: [{ address: 'P', label: 'p', block: 2 }] }], tokensOf(lathe.cp, 'G4 P5'))).toBeNull();
    const a = cycle('G900', ['P'], ['X']);
    const b = cycle('G901', ['X'], ['P']);
    expect(blockCycleOf([a, b], tokensOf(lathe.cp, 'G900 P5'))).toBeNull();
    expect(blockCycleOf([a, a], tokensOf(lathe.cp, 'G900 X5.'))).toBe(2);
  });
});

describe('readWord on a Fanuc mill', () => {
  const none = viewOf('fanuc-gcode');
  const g94 = state({ groups: { feedmode: mv('G94'), motion: mv('G0', 1), distance: mv('G90', 1) }, feedUnit: 'per-minute', distance: 'absolute' });
  const packed = 'N10G0G90X50Y-20.5Z+3.F200';

  it('reads the words of a packed block', () => {
    expect(read(none, g94, 'Y-20.5', packed)).toMatchObject({ value: '-20.5', unit: 'mm' });
    expect(read(none, g94, 'Z+3.', packed)).toMatchObject({ value: '3' });
    expect(read(none, g94, 'F200', packed)).toMatchObject({ cls: 'feedPerMin', value: '200', unit: 'mm/min', readings: [] });
    const x = read(none, g94, 'X50', packed);
    expect(x?.value).toBeNull();
    expect(x?.readings.map((r) => [r.preset, r.value])).toEqual([
      ['is-b', '0.05'],
      ['is-a', '0.5'],
      ['is-c', '0.005'],
      ['calculator', '50'],
    ]);
  });

  it('reads an axis word after G91 as incremental, an arc centre not', () => {
    const g91 = state({ ...g94, distance: 'incremental', groups: { ...g94.groups, distance: mv('G91', 1) } });
    expect(read(none, g91, 'X10.', 'G91 G1 X10. F100')?.incremental).toBe(true);
    expect(read(none, g91, 'I5.', 'G91 G2 X10. I5.')?.incremental).toBe(false);
  });

  it('gives a tap feed no lead: the tapping cycle declares none', () => {
    const g84 = state({ ...g94, activeCycle: { code: 'G84', line: 1, pitchFeed: true }, block: { cycle: 'G84', pitchFeed: true } });
    expect(read(none, g84, 'F150.', 'G84 X0 Y0 Z-10. R2. F150.')).toMatchObject({ cls: 'feedPerMin', lead: false, value: '150' });
  });

  it('gives a feed no class while a cycle in force is ambiguous', () => {
    const g76 = state({ ...g94, activeCycle: { code: 'G76', line: 1, pitchFeed: false }, pitchFeedAmbiguous: 'G76' });
    expect(read(none, g76, 'F80.', 'X10. F80.')).toMatchObject({ cls: null, value: null });
  });

  it('reads a word in the units after its block', () => {
    const inch = state({ ...g94, units: { value: 'inch', line: 1, assumed: false } });
    expect(read(none, inch, 'X1.', 'G20 G0 X1.')).toMatchObject({ value: '1', unit: 'inch' });
  });

  // B1: a pitch-feed mode in force (G63, the tapping mode, until G64) is a code in force as
  // the Python scripts read it (`FeedModeTracker.pitch_mode`), not only the cycle and the move.
  const g63 = state({ ...g94, groups: { ...g94.groups, motion: mv('G1', 2), pathmode: mv('G63', 1) } });

  it('counts the tapping mode G63 among the codes in force', () => {
    const tokens = tokensOf(none.cp, 'G1 Z-10. F150.');
    const inForce = inForceEntries(g63, [], none.db, none.profile).map((entry) => entry.code);
    expect(inForce).toContain('G63');
    expect(inForceEntries(g94, [], none.db, none.profile).map((entry) => entry.code)).not.toContain('G63');
    // Written in the block it is the block's code, not one in force.
    const written = inForceEntries(g63, [none.db.codes.find((e) => e.code === 'G63')!], none.db, none.profile);
    expect(written.map((entry) => entry.code)).not.toContain('G63');
    // The shipped G63 declares no feed of its own: a tap's feed stays a feed per minute.
    expect(readWord(word(tokens, 'F150.'), tokens, g63, none)).toMatchObject({ cls: 'feedPerMin', lead: false });
  });

  // T120 (SK-04): a mode that declares the arc-centre words as its own parameters (G43.5,
  // G41.6, G42.6) gives them its meaning in the blocks it is in force for.
  const tcp = state({ ...g94, groups: { ...g94.groups, motion: mv('G1', 3), lengthComp: mv('G43.5', 2) } });

  it('counts a mode that redefines I, J and K among the codes in force (T120)', () => {
    expect(inForceEntries(tcp, [], none.db, none.profile).map((entry) => entry.code)).toContain('G43.5');
    // Without the profile the rule is left out (the feed-unit search asks that way).
    expect(inForceEntries(tcp, [], none.db, null).map((entry) => entry.code)).not.toContain('G43.5');
    expect(read(none, tcp, 'I0.5', 'G1 X10. I0.5 J0 K0.866')).toMatchObject({ cls: 'count', value: null });
    // A mode that declares none of the arc-centre words stays out (G41 declares only D).
    const g41 = state({ ...g94, groups: { ...g94.groups, motion: mv('G2', 3), compensation: mv('G41', 2) } });
    expect(inForceEntries(g41, [], none.db, none.profile).map((entry) => entry.code)).not.toContain('G41');
    expect(read(none, g41, 'I5.', 'G2 X10. Y0 I5. J0')).toMatchObject({ cls: 'length', value: '5' });
  });

  // FB-2 (WX-NC-6): the mode lends I, J and K only, never its other parameters.
  it('lends the block only the arc-centre words of the mode (G43.5 under a modal G83)', () => {
    const lent = inForceEntries(tcp, [], none.db, none.profile).find((entry) => entry.code === 'G43.5');
    expect(lent?.params?.map((param) => param.address)).toEqual(['I', 'J', 'K']);
    // The same copy every block, so a cache by entry sees one entry.
    expect(inForceEntries(tcp, [], none.db, none.profile).find((entry) => entry.code === 'G43.5')).toBe(lent);
    const g43 = none.db.codes.find((entry) => entry.code === 'G43.5')!;
    expect(arcCentreEntry(g43, none.profile)).toBe(lent);
    expect(arcCentreEntry(none.db.codes.find((entry) => entry.code === 'G41')!, none.profile)).toBeNull();
    const g83 = state({
      ...tcp,
      groups: { ...tcp.groups, cycle: mv('G83', 3) },
      activeCycle: { code: 'G83', line: 3, pitchFeed: false },
    });
    expect(read(none, g83, 'Q3.', 'X20. Y10. Q3.')).toMatchObject({ cls: 'length', value: '3' });
    expect(read(none, g83, 'K1', 'X20. Y10. K1')).toMatchObject({ cls: 'count' });
    // After G49 the group names G49, which declares nothing: I is an arc centre again.
    const g49 = state({ ...g94, groups: { ...g94.groups, motion: mv('G2', 5), lengthComp: mv('G49', 4) } });
    expect(inForceEntries(g49, [], none.db, none.profile).map((entry) => entry.code)).not.toContain('G43.5');
    expect(read(none, g49, 'I5.', 'G2 X20. Y5. I5. J0')).toMatchObject({ cls: 'length', value: '5' });
  });

  it("reads what G63 declares for the feed word in the blocks it is in force for", () => {
    // A test-local database whose G63 declares its F as a lead (feed per revolution): what a
    // mode in force declares holds in the blocks under it, as for a cycle or a move.
    const db = loadCodeDb({
      ...DBS[none.profile.codes as string],
      codes: (DBS[none.profile.codes as string].codes as { code: string }[]).map((entry) =>
        entry.code === 'G63' ? { ...entry, params: [{ address: 'F', label: 'Lead', unit: 'feedPerRev' }] } : entry,
      ),
    });
    const view = { ...none, db };
    expect(read(view, g63, 'F1.5', 'G1 Z-10. F1.5')).toMatchObject({ cls: 'feedPerRev', lead: true, unit: 'mm/rev' });
  });
});

describe('readWord on the other controls', () => {
  it('Klartext: the I prefix is incremental, a decimal comma is read', () => {
    const view = viewOf('heidenhain-klartext');
    const after = state({ feedUnit: 'per-minute', distance: 'absolute' });
    const line = '7 L IX+10 Y+5,5 R0 FMAX';
    expect(read(view, after, 'IX+10', line)).toMatchObject({ value: '10', incremental: true, source: 'profile' });
    expect(read(view, after, 'Y+5,5', line)).toMatchObject({ value: '5.5', incremental: false });
  });

  it('Okuma 10 µm: every number scaled, with or without a point; SB= has no class', () => {
    const view = viewOf('okuma-osp', { name: 'Okuma 10um', params: { numberInput: preset('okuma-osp', 'okuma-10um') } });
    const after = state({
      groups: { feedmode: mv('G95'), distance: mv('G90') },
      feedUnit: 'per-rev',
      distance: 'absolute',
      diameter: { mode: 'on', line: 0, assumed: true, from: 'profile' },
    });
    expect(read(view, after, 'X50', 'G0 X50 Z2')).toMatchObject({ value: '0.5', diameter: 'diameter', source: 'machine' });
    expect(read(view, after, 'X50.', 'G0 X50. Z2')).toMatchObject({ value: '0.5' });
    expect(read(view, after, 'F25', 'G1 Z-5 F25')).toMatchObject({ cls: 'feedPerRev', value: '0.25', unit: 'mm/rev' });
    expect(read(view, after, 'SB=800', 'G96 SB=800 S200 M13')).toMatchObject({ cls: null, value: null });
  });

  it('Okuma: the lead of a thread cycle on its $ line', () => {
    const view = viewOf('okuma-osp');
    const after = state({ feedUnit: 'per-rev', distance: 'absolute', block: { cycle: 'G71', pitchFeed: true } });
    const r = read(view, after, 'F2', 'G71 X27.55 Z-30 B60 D0.7 U0.1', '$ H2.45 L2 F2 M23');
    expect(r).toMatchObject({ lead: true, cls: 'feedPerRev', value: null, unit: 'mm/rev' });
    // With no machine the unit systems disagree: every reading, the profile default first.
    expect(r?.readings.map((x) => [x.preset, x.value])).toEqual([
      ['okuma-1mm', '2'],
      ['okuma-1um', '0.002'],
      ['okuma-10um', '0.02'],
    ]);
  });

  it('Sinumerik: X is a radius under DIAMOF and under DIAM90 with G91, a diameter under DIAM90 with G90', () => {
    const view = viewOf('sinumerik');
    const off = state({ feedUnit: 'per-rev', distance: 'absolute', diameter: { mode: 'off', line: 3, assumed: false } });
    expect(read(view, off, 'X20', 'G1 X20 Z-3')).toMatchObject({ value: '20', diameter: 'radius', incremental: false });
    const d90g91 = state({ feedUnit: 'per-rev', distance: 'incremental', diameter: { mode: 'absolute-only', line: 1, assumed: false } });
    expect(read(view, d90g91, 'X5', 'DIAM90 G91 X5')).toMatchObject({ diameter: 'radius', incremental: true });
    const d90g90 = state({ ...d90g91, distance: 'absolute' });
    expect(read(view, d90g90, 'X5', 'DIAM90 G90 X5')).toMatchObject({ diameter: 'diameter', incremental: false });
  });

  it('Sinumerik: the F of G4 is a time; an expression has no value', () => {
    const view = viewOf('sinumerik');
    const after = state({ feedUnit: 'per-rev', distance: 'absolute', block: { fNotFeed: true } });
    expect(read(view, after, 'F2', 'G4 F2')).toMatchObject({ cls: 'dwell', value: '2', unit: 's' });
    const ic = read(view, state({ distance: 'absolute' }), 'X=IC(5)', 'G1 X=IC(5) Z-3');
    expect(ic).toMatchObject({ cls: 'length', value: null, readings: [] });
  });
});

describe('readWord reads nothing by dialect name', () => {
  it('a hand-made profile with the lathe addresses reads like the lathe', () => {
    const lathe = viewOf('fanuc-lathe');
    const profile: Profile = { ...lathe.profile, id: 'my-lathe', name: 'My lathe', shortName: 'Mine' };
    const view = { ...lathe, profile, cp: compileProfile(profile) };
    expect(read(view, state(LATHE_A), 'U-2.', 'G0 U-2.')).toMatchObject({ incremental: true, diameter: 'diameter' });
  });
});
