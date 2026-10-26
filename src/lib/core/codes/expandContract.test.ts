// The expansion schemas as a contract (Phase 4 plan §6.3, AD-45; the P4b prelude). What is
// pinned here is how the loader reads `CodeEntry.expand`, `CodeParam.expandRole`,
// `CodeSets.cycleReturn` and `CodeEntry.dwell` (`core/codes/expand.ts`), not which entry
// carries a schema: P4.6 writes the data and `src/lib/data/codes/expand.test.ts` lists it. The
// Python readers (`_nc_cycles.expand_of`, `expand_role_of`, …) read the loaded form and are
// held to the same lists in `tests/python/test_nc_cycles.py`.

import { describe, expect, it } from 'vitest';
import { schemaFor } from './expand';
import { loadCodeDb, type CodeDbProblem } from './load';
import type { CodeDb, ExpandSchema } from './types';

function load(codes: unknown[]): { db: CodeDb; problems: CodeDbProblem[] } {
  const problems: CodeDbProblem[] = [];
  const db = loadCodeDb({ dialect: 'x', version: 1, codes }, (p) => problems.push(p));
  return { db, problems };
}

/** A Fanuc-like G81 with roles; `extra` replaces members. */
function g81(extra: Record<string, unknown> = {}, expand: unknown = DRILL): Record<string, unknown> {
  return {
    code: 'G81',
    label: 'Drilling cycle',
    group: 'cycle',
    modal: true,
    sets: { cycle: 'start' },
    params: [
      { address: 'X', label: 'Hole X', expandRole: 'position' },
      { address: 'Y', label: 'Hole Y', expandRole: 'position' },
      { address: 'Z', label: 'Hole bottom', expandRole: 'depth' },
      { address: 'R', label: 'R point', position: 'tool-axis', expandRole: 'r-plane' },
      { address: 'F', label: 'Feed', expandRole: 'feed' },
      { address: 'K', label: 'Repeat', unit: 'count', expandRole: 'repeat' },
    ],
    expand,
    ...extra,
  };
}

const DRILL: ExpandSchema = {
  kind: 'drill',
  steps: [
    { step: 'rapid', to: 'r-plane' },
    { step: 'feed', to: 'depth' },
    { step: 'rapid', to: 'return' },
  ],
  returnBy: 'code',
  leaves: { motion: 'before', feed: 'cycle' },
};

describe('P4b: the expansion schema through the loader', () => {
  it('keeps a valid schema and the roles of its parameters', () => {
    const { db, problems } = load([g81()]);
    expect(problems).toEqual([]);
    const entry = db.codes[0];
    expect(entry.expand).toEqual(DRILL);
    expect(entry.params?.map((p) => [p.address, p.expandRole])).toEqual([
      ['X', 'position'],
      ['Y', 'position'],
      ['Z', 'depth'],
      ['R', 'r-plane'],
      ['F', 'feed'],
      ['K', 'repeat'],
    ]);
  });

  it('keeps a peck schema whose values come from the form (Q4-9)', () => {
    const params = (g81().params as Record<string, unknown>[]).concat([{ address: 'Q', label: 'Peck', expandRole: 'peck' }]);
    const g73: ExpandSchema = {
      kind: 'peck',
      steps: [
        { step: 'rapid', to: 'r-plane' },
        { step: 'pecks', mode: 'chip-break', retract: { form: 'peckRetract' } },
        { step: 'rapid', to: 'return' },
      ],
      returnBy: 'code',
      leaves: { motion: 'before', feed: 'cycle' },
    };
    const { db, problems } = load([g81({ code: 'G73', params }, g73)]);
    expect(problems).toEqual([]);
    expect(db.codes[0].expand).toEqual(g73);
  });

  it('keeps a relative depth only with its reading (T108)', () => {
    const klartext = {
      code: 'CYCL DEF 200',
      label: 'Drilling',
      group: 'cycle',
      sets: { cycle: 'define' },
      params: [
        { address: 'Q200', label: 'Clearance', expandRole: 'clearance' },
        { address: 'Q201', label: 'Depth', expandRole: 'depth-relative' },
        { address: 'Q203', label: 'Surface', position: 'tool-axis', expandRole: 'surface' },
        { address: 'Q204', label: '2nd clearance', expandRole: 'return-relative' },
        { address: 'Q206', label: 'Feed', expandRole: 'feed' },
      ],
    };
    const schema = {
      kind: 'drill',
      steps: [
        { step: 'rapid', to: 'clearance' },
        { step: 'feed', to: 'depth' },
        { step: 'rapid', to: 'clearance' },
        { step: 'rapid', to: 'return' },
      ],
      returnBy: 'role',
      leaves: { motion: 'cycle', feed: 'before' },
    };
    const without = load([{ ...klartext, expand: schema }]);
    expect(without.db.codes[0].expand).toBeUndefined();
    expect(without.problems.map((p) => p.path)).toContain('codes[0].expand.relativeDepth');
    // The roles go with the dropped schema: a role means nothing without one.
    expect(without.db.codes[0].params?.some((p) => p.expandRole !== undefined)).toBe(false);
    const withReading = load([{ ...klartext, expand: { ...schema, relativeDepth: 'signed' } }]);
    expect(withReading.problems).toEqual([]);
    expect((withReading.db.codes[0].expand as ExpandSchema).relativeDepth).toBe('signed');
  });

  it('picks a case by the value of the variant parameter', () => {
    const params = (g81().params as Record<string, unknown>[]).concat([{ address: 'VARI', label: 'Variant', unit: 'count', expandRole: 'variant' }]);
    const { db, problems } = load([g81({ code: 'CYCLE83', params }, { by: 'VARI', cases: { '0': DRILL } })]);
    expect(problems).toEqual([]);
    const expand = db.codes[0].expand!;
    expect(schemaFor(expand, '0')).toEqual(DRILL);
    expect(schemaFor(expand, '1')).toBeNull();
    expect(schemaFor(DRILL, null)).toEqual(DRILL);
  });

  it('drops a schema that breaks a rule, whole, and says where', () => {
    const cases: [string, Record<string, unknown>, unknown, string][] = [
      ['a tapping code', { tapping: true }, DRILL, 'codes[0].expand'],
      ['a code that starts no cycle', { sets: { motion: 'feed' } }, DRILL, 'codes[0].expand'],
      ['an unknown step', {}, { ...DRILL, steps: [{ step: 'jump' }] }, 'codes[0].expand.steps[0]'],
      ['a level no role gives', {}, { ...DRILL, steps: [{ step: 'rapid', to: 'clearance' }, { step: 'feed', to: 'depth' }] }, 'codes[0].expand.steps[0]'],
      ['no feed to the depth', {}, { ...DRILL, steps: [{ step: 'rapid', to: 'r-plane' }] }, 'codes[0].expand.steps'],
      ['a missing leaves', {}, { ...DRILL, leaves: undefined }, 'codes[0].expand.leaves'],
      ['an unknown member', {}, { ...DRILL, colour: 'red' }, 'codes[0].expand.colour'],
      ['a form field that is not one', {}, { ...DRILL, steps: [{ step: 'pecks', mode: 'chip-break', retract: { form: 'speed' } }] }, 'codes[0].expand.steps[0]'],
    ];
    for (const [name, extra, expand, path] of cases) {
      const { db, problems } = load([g81(extra, expand)]);
      expect(db.codes[0].expand, name).toBeUndefined();
      expect(problems.map((p) => p.path), name).toContain(path);
      expect(db.codes[0].label, name).toBe('Drilling cycle');
    }
  });

  it('drops a role given twice and an unknown role', () => {
    const twice = (g81().params as Record<string, unknown>[]).map((p) => (p.address === 'K' ? { ...p, expandRole: 'feed' } : p));
    expect(load([g81({ params: twice })]).db.codes[0].expand).toBeUndefined();
    const unknown = (g81().params as Record<string, unknown>[]).map((p) => (p.address === 'K' ? { ...p, expandRole: 'count' } : p));
    const { db, problems } = load([g81({ params: unknown })]);
    expect(problems.map((p) => p.path)).toContain('codes[0].params[5].expandRole');
    expect(db.codes[0].params?.[5].expandRole).toBeUndefined();
    expect(db.codes[0].expand).toEqual(DRILL);
  });

  it("holds a 'default' parameter to its value in defaults", () => {
    const params = (g81().params as Record<string, unknown>[]).concat([{ address: '_GMODE', label: 'Mode', unit: 'count', expandRole: 'default' }]);
    expect(load([g81({ params })]).db.codes[0].expand).toBeUndefined();
    const { db, problems } = load([g81({ params }, { ...DRILL, defaults: { _GMODE: '0' } })]);
    expect(problems).toEqual([]);
    expect((db.codes[0].expand as ExpandSchema).defaults).toEqual({ _GMODE: '0' });
  });

  it("takes a list of equivalent values for a 'default' parameter (the owner, 2026-10-20)", () => {
    const params = (g81().params as Record<string, unknown>[]).concat([{ address: '_AXN', label: 'Axis', unit: 'count', expandRole: 'default' }]);
    const ok = load([g81({ params }, { ...DRILL, defaults: { _AXN: [' 0', '3 '] } })]);
    expect(ok.problems).toEqual([]);
    expect((ok.db.codes[0].expand as ExpandSchema).defaults).toEqual({ _AXN: ['0', '3'] });
    // An empty list, a blank or non-text value, and a value named twice drop the schema whole.
    for (const bad of [[], ['0', ''], ['0', 3], ['0', '0'], { a: '0' }]) {
      const { db, problems } = load([g81({ params }, { ...DRILL, defaults: { _AXN: bad } })]);
      expect(db.codes[0].expand, JSON.stringify(bad)).toBeUndefined();
      expect(problems.map((p) => p.path), JSON.stringify(bad)).toContain('codes[0].expand.defaults._AXN');
    }
  });

  it('keeps feedOutZero "feed" only where the code has both feeds (the owner, 2026-10-20: Klartext 201 Q208=0)', () => {
    const params = (g81().params as Record<string, unknown>[]).concat([{ address: 'E', label: 'Feed out', expandRole: 'feed-out' }]);
    const bore: ExpandSchema = { ...DRILL, kind: 'bore', steps: [{ step: 'rapid', to: 'r-plane' }, { step: 'feed', to: 'depth' }, { step: 'feed', to: 'r-plane', feed: 'feed-out' }] };
    const ok = load([g81({ params }, { ...bore, feedOutZero: 'feed' })]);
    expect(ok.problems).toEqual([]);
    expect((ok.db.codes[0].expand as ExpandSchema).feedOutZero).toBe('feed');
    expect((load([g81({ params }, bore)]).db.codes[0].expand as ExpandSchema).feedOutZero).toBeUndefined();
    // Another value, or a code without a feed-out or without a feed, drops the schema whole.
    const noFeed = params.filter((p) => p.address !== 'F');
    const noFeedOut = (g81().params as Record<string, unknown>[]).slice();
    for (const [list, schema] of [
      [params, { ...bore, feedOutZero: 'rapid' }],
      [params, { ...bore, feedOutZero: true }],
      [noFeed, { ...bore, feedOutZero: 'feed' }],
      [noFeedOut, { ...DRILL, feedOutZero: 'feed' }],
    ] as const) {
      const { db, problems } = load([g81({ params: list }, schema)]);
      expect(db.codes[0].expand, JSON.stringify(schema.feedOutZero)).toBeUndefined();
      expect(problems.map((p) => p.path)).toContain('codes[0].expand.feedOutZero');
    }
  });
});

// ---------------------------------------------------------------------------
// One row per drop rule of §6.3 (CODE-4): each row breaks exactly one rule of the loader, and
// the schema has to be gone whole with the problem at its path. A rule that is deleted from
// `expand.ts` turns its row red.
// ---------------------------------------------------------------------------

/** A parameter with a role; the address is only a name for the row. */
const role = (address: string, expandRole: string): Record<string, unknown> => ({ address, label: `Role ${expandRole}`, unit: 'count', expandRole });
const BASE_PARAMS = g81().params as Record<string, unknown>[];
/** The G81 parameters plus these roles. */
const plus = (...extra: Record<string, unknown>[]): Record<string, unknown>[] => [...BASE_PARAMS, ...extra];
const minus = (...addresses: string[]): Record<string, unknown>[] => BASE_PARAMS.filter((p) => !addresses.includes(p.address as string));
const step = (...steps: Record<string, unknown>[]): Record<string, unknown>[] => steps;
const PECKS = (extra: Record<string, unknown>): Record<string, unknown> => ({ step: 'pecks', mode: 'chip-break', retract: { form: 'peckRetract' }, ...extra });
const ENTRY = [{ step: 'rapid', to: 'r-plane' }, { step: 'rapid', to: 'return' }];
const PECK_ROLE = role('Q', 'peck');
const STEP_AT = 'codes[0].expand.steps[1]';

type Row = [name: string, params: Record<string, unknown>[] | undefined, expand: unknown, path: string, extra?: Record<string, unknown>];

describe('P4b: every drop rule of the loader (CODE-4)', () => {
  const rows: Row[] = [
    // the entry
    ['a thread code (pitchFeed)', undefined, DRILL, 'codes[0].expand', { pitchFeed: true }],
    ['a thread code (pitchFeedAmbiguous)', undefined, DRILL, 'codes[0].expand', { pitchFeedAmbiguous: true }],
    ['sets.cycle that is neither start nor define', undefined, DRILL, 'codes[0].expand', { sets: { cycle: 'end' } }],
    ['expand that is not an object', undefined, 'drill', 'codes[0].expand'],
    // the schema as a whole
    ['returnBy that is neither code nor role', undefined, { ...DRILL, returnBy: 'both' }, 'codes[0].expand.returnBy'],
    ['returnBy role without a return role', undefined, { ...DRILL, returnBy: 'role' }, 'codes[0].expand.returnBy'],
    ['returnBy role with return-relative but no surface', plus(role('S', 'return-relative')), { ...DRILL, returnBy: 'role', relativeDepth: 'signed' }, 'codes[0].expand.returnBy'],
    ['a relativeDepth that is not a reading', undefined, { ...DRILL, relativeDepth: 'down' }, 'codes[0].expand.relativeDepth'],
    ['first-peck-relative without relativeDepth', plus(PECK_ROLE, role('I', 'first-peck-relative')), { ...DRILL, steps: step({ step: 'rapid', to: 'r-plane' }, PECKS({ retract: { role: 'peck' } })) }, 'codes[0].expand.relativeDepth'],
    ['leaves with a value that is not before or cycle', undefined, { ...DRILL, leaves: { motion: 'after', feed: 'cycle' } }, 'codes[0].expand.leaves'],
    ['leaves with a third member', undefined, { ...DRILL, leaves: { motion: 'before', feed: 'cycle', rapid: 'cycle' } }, 'codes[0].expand.leaves'],
    ['a kind outside the list', undefined, { ...DRILL, kind: 'tap' }, 'codes[0].expand.kind'],
    ['steps that are not a list', undefined, { ...DRILL, steps: 'drill' }, 'codes[0].expand.steps'],
    ['an empty steps list', undefined, { ...DRILL, steps: [] }, 'codes[0].expand.steps'],
    ['defaults that are not an object', undefined, { ...DRILL, defaults: ['0'] }, 'codes[0].expand.defaults'],
    ['a default for an address without the role', undefined, { ...DRILL, defaults: { X: '0' } }, 'codes[0].expand.defaults.X'],
    ['a default that is a number', plus(role('_G', 'default')), { ...DRILL, defaults: { _G: 0 } }, 'codes[0].expand.defaults._G'],
    ['feedOutZero on a code with no feed-out', undefined, { ...DRILL, feedOutZero: 'feed' }, 'codes[0].expand.feedOutZero'],
    // the steps
    ['a step that is not an object', undefined, { ...DRILL, steps: ['rapid'] }, 'codes[0].expand.steps[0]'],
    ['a member a rapid step does not have', undefined, { ...DRILL, steps: step({ step: 'rapid', to: 'r-plane', feed: 'feed' }, { step: 'feed', to: 'depth' }) }, 'codes[0].expand.steps[0]'],
    ['a rapid step without to', undefined, { ...DRILL, steps: step({ step: 'rapid' }, { step: 'feed', to: 'depth' }) }, 'codes[0].expand.steps[0]'],
    ['a level outside the list', undefined, { ...DRILL, steps: step({ step: 'rapid', to: 'top' }, { step: 'feed', to: 'depth' }) }, 'codes[0].expand.steps[0]'],
    ['the level r-plane without the role r-plane', minus('R'), DRILL, 'codes[0].expand.steps[0]'],
    ['the level depth without a depth role', minus('Z'), DRILL, 'codes[0].expand.steps[1]'],
    ['the level depth from depth-relative without surface', [...minus('Z'), role('Z', 'depth-relative')], { ...DRILL, relativeDepth: 'signed' }, 'codes[0].expand.steps[1]'],
    ['the level return by role without a return role', undefined, { ...DRILL, returnBy: 'role' }, 'codes[0].expand.steps[2]'],
    ['a feed step with a feed that is not feed or feed-out', undefined, { ...DRILL, steps: step({ step: 'rapid', to: 'r-plane' }, { step: 'feed', to: 'depth', feed: 'fast' }) }, STEP_AT],
    ['a feed-out feed without the role feed-out', undefined, { ...DRILL, steps: step({ step: 'rapid', to: 'r-plane' }, { step: 'feed', to: 'depth', feed: 'feed-out' }) }, STEP_AT],
    // the pecks
    ['a pecks mode outside the list', plus(PECK_ROLE), { ...DRILL, kind: 'peck', steps: step(...ENTRY.slice(0, 1), PECKS({ mode: 'fast' })) }, STEP_AT],
    ['pecks without a peck role', undefined, { ...DRILL, kind: 'peck', steps: step(...ENTRY.slice(0, 1), PECKS({})) }, STEP_AT],
    ['a chip-break step without retract', plus(PECK_ROLE), { ...DRILL, kind: 'peck', steps: step(...ENTRY.slice(0, 1), { step: 'pecks', mode: 'chip-break' }) }, STEP_AT],
    ['a full-retract step without back and reentry', plus(PECK_ROLE), { ...DRILL, kind: 'peck', steps: step(...ENTRY.slice(0, 1), { step: 'pecks', mode: 'full-retract' }) }, STEP_AT],
    ['a full-retract step with a chip break', plus(PECK_ROLE), { ...DRILL, kind: 'peck', steps: step(...ENTRY.slice(0, 1), { step: 'pecks', mode: 'full-retract', retract: { form: 'peckRetract' }, back: 'r-plane', reentry: { form: 'peckClearance' } }) }, STEP_AT],
    ['a chip-break step with back or reentry', plus(PECK_ROLE), { ...DRILL, kind: 'peck', steps: step(...ENTRY.slice(0, 1), PECKS({ back: 'r-plane' })) }, STEP_AT],
    ['a universal step without the role chip-breaks', plus(PECK_ROLE), { ...DRILL, kind: 'peck', steps: step(...ENTRY.slice(0, 1), PECKS({ mode: 'universal', back: 'r-plane', reentry: { form: 'peckClearance' } })) }, STEP_AT],
    ['a back level that no role gives', plus(PECK_ROLE), { ...DRILL, kind: 'peck', steps: step(...ENTRY.slice(0, 1), { step: 'pecks', mode: 'full-retract', back: 'clearance', reentry: { form: 'peckClearance' } }) }, STEP_AT],
    ['a retract value of a role the code has not', plus(PECK_ROLE), { ...DRILL, kind: 'peck', steps: step(...ENTRY.slice(0, 1), PECKS({ retract: { role: 'peck-decrement' } })) }, STEP_AT],
    ['a retract value with two members', plus(PECK_ROLE), { ...DRILL, kind: 'peck', steps: step(...ENTRY.slice(0, 1), PECKS({ retract: { role: 'peck', form: 'peckRetract' } })) }, STEP_AT],
    ['a retractAt outside the list', plus(PECK_ROLE), { ...DRILL, kind: 'peck', steps: step(...ENTRY.slice(0, 1), PECKS({ retractAt: 'slow' })) }, STEP_AT],
    ['a retractAt feed-out without the role feed-out', plus(PECK_ROLE), { ...DRILL, kind: 'peck', steps: step(...ENTRY.slice(0, 1), PECKS({ retractAt: 'feed-out' })) }, STEP_AT],
    // dwell, orient, lift-off
    ['a dwell at neither bottom nor top', plus(role('P', 'dwell')), { ...DRILL, steps: step({ step: 'rapid', to: 'r-plane' }, { step: 'dwell', at: 'middle' }, { step: 'feed', to: 'depth' }) }, STEP_AT],
    ['a dwell at the bottom without the role dwell', undefined, { ...DRILL, steps: step({ step: 'rapid', to: 'r-plane' }, { step: 'feed', to: 'depth' }, { step: 'dwell', at: 'bottom' }) }, 'codes[0].expand.steps[2]'],
    ['a dwell at the top without the role dwell-top', plus(role('P', 'dwell')), { ...DRILL, steps: step({ step: 'rapid', to: 'r-plane' }, { step: 'dwell', at: 'top' }, { step: 'feed', to: 'depth' }) }, STEP_AT],
    ['an orient step without the role orient-angle', undefined, { ...DRILL, steps: step({ step: 'rapid', to: 'r-plane' }, { step: 'feed', to: 'depth' }, { step: 'orient' }) }, 'codes[0].expand.steps[2]'],
    ['a lift-off step without a lift-off role', undefined, { ...DRILL, steps: step({ step: 'rapid', to: 'r-plane' }, { step: 'feed', to: 'depth' }, { step: 'lift-off' }) }, 'codes[0].expand.steps[2]'],
    ['a lift-off back that is not true or false', plus(role('J', 'lift-off-first')), { ...DRILL, steps: step({ step: 'rapid', to: 'r-plane' }, { step: 'feed', to: 'depth' }, { step: 'lift-off', back: 'yes' }) }, 'codes[0].expand.steps[2]'],
    // the variant form
    ['by that is not the address of the variant parameter', plus(role('VARI', 'variant')), { by: 'X', cases: { '0': DRILL } }, 'codes[0].expand.by'],
    ['a variant form with a third member', plus(role('VARI', 'variant')), { by: 'VARI', cases: { '0': DRILL }, kind: 'drill' }, 'codes[0].expand'],
    ['cases that are empty', plus(role('VARI', 'variant')), { by: 'VARI', cases: {} }, 'codes[0].expand.cases'],
    ['cases that are not an object', plus(role('VARI', 'variant')), { by: 'VARI', cases: [DRILL] }, 'codes[0].expand.cases'],
    ['one broken case among good ones', plus(role('VARI', 'variant')), { by: 'VARI', cases: { '0': DRILL, '1': { ...DRILL, steps: [] } } }, 'codes[0].expand.cases.1.steps'],
    ['the role variant without by and cases', plus(role('VARI', 'variant')), DRILL, 'codes[0].expand'],
  ];

  it.each(rows)('drops the schema whole for %s', (name, params, expand, path, extra = {}) => {
    const { db, problems } = load([g81({ ...(params === undefined ? {} : { params }), ...extra }, expand)]);
    expect(db.codes[0].expand, name).toBeUndefined();
    expect(problems.map((p) => p.path), name).toContain(path);
    expect(db.codes[0].label, name).toBe('Drilling cycle'); // the rest of the entry is untouched
  });

  it('keeps each step kind, level and value when the roles are there', () => {
    const params = plus(
      PECK_ROLE,
      role('I', 'chip-breaks'),
      role('E', 'feed-out'),
      role('P', 'dwell'),
      role('U', 'dwell-top'),
      role('A', 'orient-angle'),
      role('J', 'lift-off-first'),
      role('S', 'return'),
      role('V', 'surface'),
      role('W', 'clearance'),
    );
    const schema = {
      kind: 'bore',
      returnBy: 'role',
      leaves: { motion: 'cycle', feed: 'before' },
      feedOutZero: 'feed',
      steps: [
        { step: 'rapid', to: 'clearance' },
        { step: 'dwell', at: 'top' },
        { step: 'orient' },
        PECKS({ mode: 'universal', back: 'r-plane', reentry: { role: 'peck' }, retractAt: 'feed-out' }),
        { step: 'dwell', at: 'bottom' },
        { step: 'feed', to: 'r-plane', feed: 'feed-out' },
        { step: 'lift-off', back: true },
        { step: 'rapid', to: 'return' },
      ],
    };
    const { db, problems } = load([g81({ params }, schema)]);
    expect(problems).toEqual([]);
    expect(db.codes[0].expand).toEqual(schema);
  });

  it('reads every case of a good variant form, the address upper-cased', () => {
    const params = plus(role('VARI', 'variant'));
    const ok = load([g81({ params }, { by: 'vari', cases: { '0': DRILL, '1': DRILL } })]);
    expect(ok.problems).toEqual([]);
    expect(ok.db.codes[0].expand).toEqual({ by: 'VARI', cases: { '0': DRILL, '1': DRILL } });
  });
});

describe('P4b: the dwell form drops whole (CODE-4)', () => {
  const g4 = { code: 'G4', label: 'Dwell', params: [{ address: 'P', label: 'Time', unit: 'count' }] };
  it.each([
    ['an address that is no parameter', { seconds: 'X' }],
    ['a member of no kind', { minutes: 'P' }],
    ['lines without {s}', { lines: ['DWELL 1'] }],
    ['lines with a blank line', { lines: ['DWELL {s}', ' '] }],
    ['an empty dwell', {}],
    ['a dwell that is not an object', 'P'],
  ])('for %s', (_name, dwell) => {
    const { db, problems } = load([{ ...g4, dwell }]);
    expect(db.codes[0].dwell).toBeUndefined();
    expect(problems.map((p) => p.path)).toContain('codes[0].dwell');
  });
});

describe('P4b: schemaFor reads only the own cases (CODE-9)', () => {
  it('answers null for a variant that is a property name of Object.prototype', () => {
    const expand = { by: 'VARI', cases: { '0': DRILL } };
    for (const variant of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
      expect(schemaFor(expand, variant), variant).toBeNull();
    }
    expect(schemaFor(expand, '0')).toEqual(DRILL);
  });
});

describe('P4b: the cycle return and the dwell form', () => {
  it('reads cycleReturn as a sets member', () => {
    const { db, problems } = load([
      { code: 'G98', label: 'Initial level', group: 'cyclereturn', modal: true, sets: { cycleReturn: 'initial' } },
      { code: 'G99', label: 'R level', group: 'cyclereturn', modal: true, sets: { cycleReturn: 'r-plane' } },
      { code: 'G97', label: 'Wrong', sets: { cycleReturn: 'up' } },
    ]);
    expect(db.codes.map((e) => e.sets?.cycleReturn ?? null)).toEqual(['initial', 'r-plane', null]);
    expect(problems.map((p) => p.path)).toEqual(['codes[2].sets.cycleReturn']);
  });

  it('keeps a dwell form whose addresses are parameters of the code', () => {
    const g4 = { code: 'G4', label: 'Dwell', params: [{ address: 'P', label: 'Time', unit: 'count' }, { address: 'X', label: 'Seconds', unit: 'dwell' }] };
    const ok = load([{ ...g4, dwell: { increments: 'P', seconds: 'X' } }]);
    expect(ok.problems).toEqual([]);
    expect(ok.db.codes[0].dwell).toEqual({ increments: 'P', seconds: 'X' });
    const lines = load([{ code: 'CYCL DEF 9', label: 'Dwell', dwell: { lines: ['CYCL DEF 9.0 DWELL TIME', 'CYCL DEF 9.1 DWELL {s}'] } }]);
    expect(lines.problems).toEqual([]);
    const spos = load([{ code: 'SPOS', label: 'Oriented stop', orient: true }]);
    expect(spos.problems).toEqual([]);
    expect(spos.db.codes[0].orient).toBe(true);
    const broken = load([{ ...g4, dwell: { seconds: 'F' } }]);
    expect(broken.db.codes[0].dwell).toBeUndefined();
    expect(broken.problems.map((p) => p.path)).toEqual(['codes[0].dwell']);
  });
});
