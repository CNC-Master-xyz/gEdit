// The expansion schemas the shipped code databases carry (Phase 4 plan §6.3 rule 11, AD-45,
// Q4-8; P4.6). `src/lib/core/codes/expandContract.test.ts` pins how the loader reads a schema;
// this file pins the data: which entries have one, that each one survives the loader whole (a
// broken schema is dropped without a word in the app, and the expansion would then refuse the
// cycle as "no schema"), that every role a schema uses is a role of a parameter of its entry,
// and the readings the manuals gave (the sources are in the P4.6 hand-off and on the owner's
// code-data review page).
//
// Two cycles of Q4-8 have no schema, each with a §7 row: Klartext 203 (its full retract runs at
// the retract feed Q208, which the step vocabulary cannot say, and the NC software versions
// differ in its last retract), and Sinumerik CYCLE83 with VARI=0 (its chip-break retract runs at
// the feed of the calling program, and _VRT=0 means 1 mm). CYCLE83 has a schema for VARI=1 only.

import { describe, expect, it } from 'vitest';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { EXPAND_ROLES, schemaFor } from '$lib/core/codes/expand';
import type { CodeDbProblem } from '$lib/core/codes/load';
import { lookupCode, normalizeCode } from '$lib/core/codes/lookup';
import { resolveCodeDbFiles, resolveCodeDbs } from '$lib/core/codes/resolve';
import type { CodeDb, CodeEntry, CodeExpand, ExpandRole, ExpandSchema, ExpandStep } from '$lib/core/codes/types';

const problems: string[] = [];
const LOADED: Record<string, CodeDb> = resolveCodeDbs(BUILTIN_CODE_DB_JSON, (dialect: string, p: CodeDbProblem) =>
  problems.push(`${dialect}: ${p.path}: ${p.message}`),
);
/** The resolved files as written in JSON (parents merged in), before the loader. */
const FILES = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON) as Record<string, { codes: Record<string, unknown>[] }>;
/** Each file on its own. */
const OWN = BUILTIN_CODE_DB_JSON as Record<string, { codes: Record<string, unknown>[] }>;
const DIALECTS = Object.keys(OWN);

/** Q4-8's list as the data carries it (Klartext 203 has a §7 row instead of a schema). */
const WITH_SCHEMA: Record<string, string[]> = {
  fanuc: ['G73', 'G81', 'G82', 'G83', 'G85', 'G86', 'G89'],
  'fanuc-lathe': [],
  'fanuc-lathe-b': [],
  heidenhain: ['CYCL DEF 200', 'CYCL DEF 201'],
  okuma: [],
  sinumerik: ['CYCLE81', 'CYCLE82', 'CYCLE83', 'CYCLE85', 'CYCLE86', 'CYCLE89'],
};

const entry = (dialect: string, code: string): CodeEntry => {
  const found = lookupCode(LOADED[dialect], code);
  if (!found) throw new Error(`no entry ${code} in ${dialect}`);
  return found;
};
const rawEntry = (dialect: string, code: string): Record<string, unknown> => {
  const found = FILES[dialect].codes.find((e) => normalizeCode(String(e.code)) === normalizeCode(code));
  if (!found) throw new Error(`no raw entry ${code} in ${dialect}`);
  return found;
};
const schemasOf = (expand: CodeExpand): ExpandSchema[] => ('by' in expand ? Object.values(expand.cases) : [expand]);
const roleMap = (e: CodeEntry): Record<string, ExpandRole> =>
  Object.fromEntries((e.params ?? []).filter((p) => p.expandRole !== undefined).map((p) => [p.address, p.expandRole!]));
const schema = (dialect: string, code: string, variant: string | null = null): ExpandSchema => {
  const found = schemaFor(entry(dialect, code).expand!, variant);
  if (!found) throw new Error(`no schema ${code} ${variant}`);
  return found;
};

/** Every role a schema uses: the roles its levels and step values need (plan §6.3 rule 10). */
function rolesUsed(s: ExpandSchema): Set<ExpandRole> {
  const used = new Set<ExpandRole>();
  const level = (to: string | undefined, returnBy: string): void => {
    if (to === 'r-plane') used.add('r-plane');
    if (to === 'clearance') ['surface', 'clearance'].forEach((r) => used.add(r as ExpandRole));
    // `return` under returnBy 'role' is `return`, or `return-relative` from the surface: checked apart.
    void returnBy;
  };
  for (const step of s.steps as (ExpandStep & Record<string, unknown>)[]) {
    if (step.step === 'rapid' || step.step === 'feed') level(step.to as string, s.returnBy);
    if (step.step === 'feed' && step.feed === 'feed-out') used.add('feed-out');
    if (step.step === 'dwell') used.add(step.at === 'top' ? 'dwell-top' : 'dwell');
    if (step.step === 'orient') used.add('orient-angle');
    if (step.step === 'pecks') {
      level(step.back as string | undefined, s.returnBy);
      for (const member of ['retract', 'reentry']) {
        const value = step[member] as { role?: ExpandRole } | undefined;
        if (value?.role !== undefined) used.add(value.role);
      }
    }
  }
  return used;
}

describe('P4.6: the expansion schemas of the shipped databases', () => {
  it('loads every database without a single problem, so no schema and no role was dropped', () => {
    expect(problems).toEqual([]);
  });

  it.each(DIALECTS)('%s: the entries with a schema are exactly the list of Q4-8 the data carries', (dialect) => {
    const withSchema = LOADED[dialect].codes.filter((e) => e.expand !== undefined).map((e) => e.code);
    expect(withSchema).toEqual(WITH_SCHEMA[dialect]);
    // And the JSON says the same: the loader dropped no schema it was given.
    const written = FILES[dialect].codes.filter((e) => e.expand !== undefined).map((e) => String(e.code));
    expect(written).toEqual(WITH_SCHEMA[dialect]);
  });

  it.each(DIALECTS)('%s: every schema and every role survives the loader as written', (dialect) => {
    for (const code of WITH_SCHEMA[dialect]) {
      const raw = rawEntry(dialect, code);
      const loaded = entry(dialect, code);
      expect(loaded.expand, code).toEqual(raw.expand);
      const rawRoles = Object.fromEntries(
        (raw.params as Record<string, unknown>[]).filter((p) => p.expandRole !== undefined).map((p) => [p.address, p.expandRole]),
      );
      expect(roleMap(loaded), code).toEqual(rawRoles);
    }
    // A role only stands on an entry with a schema.
    for (const raw of FILES[dialect].codes) {
      if (raw.expand !== undefined) continue;
      const roles = ((raw.params ?? []) as Record<string, unknown>[]).filter((p) => p.expandRole !== undefined);
      expect(roles, String(raw.code)).toEqual([]);
    }
  });

  it.each(DIALECTS)('%s: every parameter of a cycle with a schema has a role, and every role a schema uses is one', (dialect) => {
    for (const code of WITH_SCHEMA[dialect]) {
      const e = entry(dialect, code);
      // A parameter without a role refuses the block that writes it (`param-unknown`); every
      // parameter of these cycles is understood, as its value or at its default.
      for (const p of e.params ?? []) expect(p.expandRole, `${code} ${p.address}`).toBeDefined();
      for (const p of e.params ?? []) expect(EXPAND_ROLES as readonly string[]).toContain(p.expandRole);
      const declared = new Set(Object.values(roleMap(e)));
      for (const s of schemasOf(e.expand!)) {
        for (const role of rolesUsed(s)) expect(declared.has(role), `${code} uses ${role}`).toBe(true);
        expect(declared.has('depth') || declared.has('depth-relative'), code).toBe(true);
        if (s.returnBy === 'role') expect(declared.has('return') || (declared.has('return-relative') && declared.has('surface')), code).toBe(true);
        for (const [address, value] of Object.entries(s.defaults ?? {})) {
          expect(roleMap(e)[address], `${code} ${address}`).toBe('default');
          const values = Array.isArray(value) ? value : [value];
          for (const v of values) expect(v, `${code} ${address}`).toMatch(/^-?\d+$/);
          // Empty and left out are understood too (§6.3 rule 1): an argument left out is 0 on
          // Sinumerik (cycles manual 01/2008, 1.2.3), so 0 has to be one of the values.
          expect(values, `${code} ${address}`).toContain('0');
        }
      }
    }
  });

  it.each(DIALECTS)('%s: no tapping or thread code carries a schema', (dialect) => {
    for (const e of LOADED[dialect].codes) {
      if (e.tapping === true || e.pitchFeed === true || e.pitchFeedAmbiguous === true) {
        expect(e.expand, e.code).toBeUndefined();
      }
    }
  });

  it.each(DIALECTS)('%s: every entry P4.6 wrote is marked for the owner\'s review', (dialect) => {
    for (const raw of OWN[dialect].codes) {
      const touched = raw.expand !== undefined || raw.dwell !== undefined || raw.orient !== undefined || (raw.sets as Record<string, unknown> | undefined)?.cycleReturn !== undefined;
      if (touched) expect(raw.review, String(raw.code)).toBe('pending');
    }
  });

  it('the lathe databases inherit none of it: the run refuses a turning program, not the data', () => {
    // The lathe of G-code system A replaces G73, G83, G85, G89, G98, G99 and G4 with entries of
    // its own and removes G81, G82 and G86, and system B builds on it; so no mill schema, cycle
    // return or dwell form reaches them. `expand_cycles.py` refuses a turning program as a whole
    // (`lathe`) in any case.
    for (const dialect of ['fanuc-lathe', 'fanuc-lathe-b']) {
      const db = LOADED[dialect];
      expect(db.codes.filter((e) => e.expand !== undefined).map((e) => e.code), dialect).toEqual([]);
      expect(db.codes.filter((e) => e.sets?.cycleReturn !== undefined).map((e) => e.code), dialect).toEqual([]);
      expect(db.codes.filter((e) => e.dwell !== undefined).map((e) => e.code), dialect).toEqual([]);
    }
  });
});

describe('P4.6: what the manuals give each cycle', () => {
  it('Fanuc mill: the R point, the depth and the return by G98/G99 on every cycle; positions and the repeat count', () => {
    for (const code of WITH_SCHEMA.fanuc) {
      const roles = roleMap(entry('fanuc', code));
      expect(roles, code).toMatchObject({ X: 'position', Y: 'position', Z: 'depth', R: 'r-plane', F: 'feed', K: 'repeat' });
      const s = schema('fanuc', code);
      expect(s.returnBy, code).toBe('code');
      // Positioning, then rapid to the R point; the hole ends with the return level of G98/G99.
      expect(s.steps[0], code).toEqual({ step: 'rapid', to: 'r-plane' });
      // G80 leaves the motion group as it was, and F of the cycle block is the program's feed.
      expect(s.leaves, code).toEqual({ motion: 'before', feed: 'cycle' });
    }
    expect(entry('fanuc', 'G98').sets?.cycleReturn).toBe('initial');
    expect(entry('fanuc', 'G99').sets?.cycleReturn).toBe('r-plane');
    expect(entry('fanuc', 'G4').dwell).toEqual({ increments: 'P', seconds: 'X' });
  });

  it('Fanuc mill: the two peck values the machine sets come from the form (Q4-9)', () => {
    expect(schema('fanuc', 'G73').steps[1]).toEqual({ step: 'pecks', mode: 'chip-break', retract: { form: 'peckRetract' } });
    expect(schema('fanuc', 'G83').steps[1]).toEqual({
      step: 'pecks',
      mode: 'full-retract',
      back: 'r-plane',
      reentry: { form: 'peckClearance' },
    });
    for (const code of ['G81', 'G82', 'G85', 'G86', 'G89']) {
      expect(JSON.stringify(schema('fanuc', code)), code).not.toMatch(/"form"/);
    }
  });

  it('Fanuc mill: the dwell, the feed out and the spindle stop of G82, G85, G86 and G89', () => {
    const kinds = (code: string): string[] => schema('fanuc', code).steps.map((s) => s.step + ('to' in s ? `:${s.to}` : ''));
    expect(kinds('G81')).toEqual(['rapid:r-plane', 'feed:depth', 'rapid:return']);
    expect(kinds('G82')).toEqual(['rapid:r-plane', 'feed:depth', 'dwell', 'rapid:return']);
    expect(kinds('G85')).toEqual(['rapid:r-plane', 'feed:depth', 'feed:r-plane', 'rapid:return']);
    expect(kinds('G86')).toEqual(['rapid:r-plane', 'feed:depth', 'spindle-stop', 'rapid:return', 'spindle-restore']);
    expect(kinds('G89')).toEqual(['rapid:r-plane', 'feed:depth', 'dwell', 'feed:r-plane', 'rapid:return']);
  });

  it('Klartext 200 and 201: the depth from the surface, signed (T108), and the second clearance as the return', () => {
    for (const code of WITH_SCHEMA.heidenhain) {
      const roles = roleMap(entry('heidenhain', code));
      expect(roles, code).toMatchObject({ Q200: 'clearance', Q201: 'depth-relative', Q203: 'surface', Q204: 'return-relative', Q206: 'feed' });
      const s = schema('heidenhain', code);
      expect(s.relativeDepth, code).toBe('signed');
      expect(s.returnBy, code).toBe('role');
      // Q206 is not the program's feed; Klartext has no modal motion code to restore.
      expect(s.leaves, code).toEqual({ motion: 'cycle', feed: 'before' });
    }
    // 200: full retracts to the set-up clearance, back down to Q200 above the last bottom. The
    // dwell at the bottom acts at every infeed from NC software 34059x-08 on, which the steps
    // cannot say: only Q211=0 is expanded.
    expect(schema('heidenhain', 'CYCL DEF 200').steps[1]).toEqual({
      step: 'pecks',
      mode: 'full-retract',
      back: 'clearance',
      reentry: { role: 'clearance' },
    });
    expect(schema('heidenhain', 'CYCL DEF 200').defaults).toEqual({ Q211: '0', Q395: '0' });
    expect(roleMap(entry('heidenhain', 'CYCL DEF 200')).Q210).toBe('dwell-top');
    // 201: feeds out at Q208.
    expect(schema('heidenhain', 'CYCL DEF 201').steps).toContainEqual({ step: 'feed', to: 'clearance', feed: 'feed-out' });
    expect(roleMap(entry('heidenhain', 'CYCL DEF 201')).Q208).toBe('feed-out');
    // 203: no schema and no roles (§7 row).
    expect(entry('heidenhain', 'CYCL DEF 203').expand).toBeUndefined();
    expect(entry('heidenhain', 'CYCL DEF 9').dwell).toEqual({ lines: ['CYCL DEF 9.0 DWELL TIME', 'CYCL DEF 9.1 DWELL {s}'] });
  });

  it('Sinumerik: the five shared parameters, the depth into the material (T108), the modes at their defaults', () => {
    for (const code of WITH_SCHEMA.sinumerik) {
      const roles = roleMap(entry('sinumerik', code));
      expect(roles, code).toMatchObject({ RTP: 'return', RFP: 'surface', SDIS: 'clearance', DP: 'depth', DPR: 'depth-relative' });
      for (const s of schemasOf(entry('sinumerik', code).expand!)) {
        expect(s.relativeDepth, code).toBe('into-material');
        expect(s.returnBy, code).toBe('role');
        // The standard cycles keep the G codes in force before the call (and, as subprograms
        // with SAVE, the feed): only CYCLE85 writes a feed of its own.
        expect(s.leaves, code).toEqual({ motion: 'before', feed: code === 'CYCLE85' ? 'before' : 'cycle' });
        for (const mode of ['_GMODE', '_AMODE']) {
          if (roles[mode] !== undefined) expect(s.defaults?.[mode], `${code} ${mode}`).toBe('0');
        }
        // _DMODE ones: 0 keeps the plane in force, 1 is G17 inside the cycle; the expansion runs
        // only under G17, so both read alike (job planning manual 03/2013, 18.1).
        if (roles._DMODE !== undefined) expect(s.defaults?._DMODE, `${code} _DMODE`).toEqual(['0', '1']);
      }
    }
    expect(entry('sinumerik', 'G4').dwell).toEqual({ seconds: 'F', revolutions: 'S' });
    // CYCLE81 to CYCLE86 take the feed in force: no F of their own except CYCLE85's two feeds.
    expect(roleMap(entry('sinumerik', 'CYCLE85'))).toMatchObject({ FFR: 'feed', RFF: 'feed-out' });
    for (const code of ['CYCLE81', 'CYCLE82', 'CYCLE83', 'CYCLE86', 'CYCLE89']) {
      expect(Object.values(roleMap(entry('sinumerik', code))), code).not.toContain('feed');
    }
  });

  it('Sinumerik CYCLE83: full retract only (VARI=1), no degression, the first peck absolute or from the surface', () => {
    const e = entry('sinumerik', 'CYCLE83');
    expect(e.expand && 'by' in e.expand ? e.expand.by : null).toBe('VARI');
    expect(schemaFor(e.expand!, '0')).toBeNull();
    const s = schema('sinumerik', 'CYCLE83', '1');
    expect(s.steps[1]).toEqual({ step: 'pecks', mode: 'full-retract', back: 'clearance', reentry: { role: 'advance' } });
    expect(roleMap(e)).toMatchObject({ FDEP: 'first-peck', FDPR: 'first-peck-relative', DTS: 'dwell-top', _DTD: 'dwell', _DIS1: 'advance' });
    // A degression amount splits the last two strokes evenly and a negative one is a factor;
    // the dwell at every depth (DTB) and a feed factor for the first peck have no step either.
    expect(s.defaults).toMatchObject({ _DAM: '0', DTB: '0', _MDEP: '0' });
    // The values the manuals prove equivalent (the owner, 2026-10-20; job planning manual
    // 03/2013, 18.1.5): FRF 0 means 100 %, _AXN 0 and above 2 both name the third axis.
    expect(s.defaults?.FRF).toEqual(['1', '0']);
    expect(s.defaults?._AXN).toEqual(['0', '3']);
  });

  it('Sinumerik CYCLE86: the oriented stop through SPOS, the lift-off out and back, the spindle in SDIR', () => {
    const roles = roleMap(entry('sinumerik', 'CYCLE86'));
    expect(roles).toMatchObject({ SDIR: 'spindle-direction', RPA: 'lift-off-first', RPO: 'lift-off-second', RPAP: 'lift-off-axis', POSS: 'orient-angle' });
    expect(schema('sinumerik', 'CYCLE86').steps.map((s) => s.step)).toEqual([
      'spindle-restore', 'rapid', 'feed', 'dwell', 'orient', 'lift-off', 'rapid', 'lift-off', 'rapid',
    ]);
    const orient = LOADED.sinumerik.codes.filter((e) => e.orient === true).map((e) => e.code);
    expect(orient).toEqual(['SPOS']);
    expect(entry('sinumerik', 'SPOS').params?.map((p) => p.address)).toEqual(['SPOS']);
    for (const dialect of DIALECTS.filter((d) => d !== 'sinumerik')) {
      expect(LOADED[dialect].codes.some((e) => e.orient === true), dialect).toBe(false);
    }
  });

  it('one dwell code per database that expands a dwell, one cycle return per return code', () => {
    const dwell = (dialect: string): string[] => LOADED[dialect].codes.filter((e) => e.dwell !== undefined).map((e) => e.code);
    expect(dwell('fanuc')).toEqual(['G4']);
    expect(dwell('heidenhain')).toEqual(['CYCL DEF 9']);
    expect(dwell('sinumerik')).toEqual(['G4']);
    expect(dwell('okuma')).toEqual([]);
    const returns = LOADED.fanuc.codes.filter((e) => e.sets?.cycleReturn !== undefined).map((e) => `${e.code} ${e.group}`);
    expect(returns).toEqual(['G98 cyclereturn', 'G99 cyclereturn']);
  });
});
