// What a mirror swaps, in the shipped data (Phase 4 plan §6.2, AD-42; the P4a prelude; G10).
//
// `CodeSets.arcDirection` on the arc codes and `CodeSets.compSide` on the radius
// compensation codes, and the profile member `addresses.arcDirectionWords` (Klartext `DR+`,
// `DR-`). `mirror.py` swaps a code for the code of the same group with the other value, so
// no code list lives in the script; that only works while the data holds three rules, which
// this file pins:
//
//   - `tests/fixtures/codes/geometry-flags.json` lists every flagged entry of every database
//     file, as the file writes it; an entry that loses or gains a flag fails here.
//   - every flagged code of a resolved database has exactly **one** partner: the entry of its
//     group with the other value. A second `left` code in a group would leave a mirror
//     guessing which right one to write.
//   - every arc code (`path: 'arc'`) and every compensation code that is on carries its flag,
//     or the golden says why not; a new arc code nobody flagged fails here instead of being
//     refused by every mirror without a reason anyone wrote down.
//
// `tests/python/test_code_flags.py` holds the Python readers to the same golden.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { arcDirectionOf, compSideOf, lookupCode } from '$lib/core/codes/lookup';
import { resolveCodeDbs } from '$lib/core/codes/resolve';
import type { CodeDb, CodeEntry } from '$lib/core/codes/types';
import { FIXTURES_DIR } from '../../../../tests/unit/helpers/fixtures';

interface Row {
  code: string;
  arcDirection?: 'cw' | 'ccw';
  compSide?: 'left' | 'right';
}
interface Golden {
  databases: Record<string, Row[]>;
  unflagged: Record<string, { arc: Record<string, string>; comp: Record<string, string> }>;
  profiles: Record<string, Record<string, 'cw' | 'ccw'>>;
}

const GOLDEN = JSON.parse(readFileSync(join(FIXTURES_DIR, 'codes', 'geometry-flags.json'), 'utf8')) as Golden;
const LOADED: Record<string, CodeDb> = resolveCodeDbs(BUILTIN_CODE_DB_JSON);
const OWN = BUILTIN_CODE_DB_JSON as Record<string, { codes: CodeEntry[] }>;
const DIALECTS = Object.keys(OWN);

const OTHER = { cw: 'ccw', ccw: 'cw', left: 'right', right: 'left' } as const;

function rowOf(entry: CodeEntry): Row | null {
  const row: Row = { code: entry.code };
  if (entry.sets?.arcDirection !== undefined) row.arcDirection = entry.sets.arcDirection;
  if (entry.sets?.compSide !== undefined) row.compSide = entry.sets.compSide;
  return Object.keys(row).length > 1 ? row : null;
}

describe('the arc direction and the compensation side in the shipped databases', () => {
  it('has one list per database file', () => {
    expect(Object.keys(GOLDEN.databases).sort()).toEqual([...DIALECTS].sort());
    expect(Object.keys(GOLDEN.unflagged).sort()).toEqual([...DIALECTS].sort());
  });

  it.each(DIALECTS)('%s declares exactly the flags the golden lists, in file order', (dialect) => {
    const shipped = OWN[dialect].codes.map(rowOf).filter((row): row is Row => row !== null);
    expect(shipped).toEqual(GOLDEN.databases[dialect]);
  });

  it.each(DIALECTS)('%s: the readers give the golden values through the loader', (dialect) => {
    for (const row of GOLDEN.databases[dialect]) {
      const entry = lookupCode(LOADED[dialect], row.code);
      expect(entry, `${dialect} ${row.code}`).not.toBeNull();
      expect([arcDirectionOf(entry), compSideOf(entry)], `${dialect} ${row.code}`).toEqual([
        row.arcDirection ?? null,
        row.compSide ?? null,
      ]);
    }
  });

  it.each(DIALECTS)('%s: every flagged code has exactly one partner in its group', (dialect) => {
    const codes = LOADED[dialect].codes;
    for (const entry of codes) {
      for (const [read, member] of [
        [arcDirectionOf, 'arcDirection'],
        [compSideOf, 'compSide'],
      ] as const) {
        const value = read(entry);
        if (value === null) continue;
        const partners = codes.filter((other) => other.group === entry.group && read(other) === OTHER[value]);
        expect(partners.map((p) => p.code), `${dialect} ${entry.code} ${member}`).toHaveLength(1);
      }
    }
  });

  it.each(DIALECTS)('%s: every arc code and every compensation that is on is flagged or says why not', (dialect) => {
    const unflagged = GOLDEN.unflagged[dialect];
    const missing: string[] = [];
    for (const entry of LOADED[dialect].codes) {
      if (entry.sets?.path === 'arc' && arcDirectionOf(entry) === null && !(entry.code in unflagged.arc)) {
        missing.push(`arc ${entry.code}`);
      }
      if (entry.sets?.radiusComp === 'on' && compSideOf(entry) === null && !(entry.code in unflagged.comp)) {
        missing.push(`comp ${entry.code}`);
      }
    }
    expect(missing).toEqual([]);
    // And the other way: a code the golden calls unflagged really is, and really exists.
    for (const code of [...Object.keys(unflagged.arc), ...Object.keys(unflagged.comp)]) {
      const entry = lookupCode(LOADED[dialect], code);
      expect(entry, `${dialect} ${code}`).not.toBeNull();
      expect([arcDirectionOf(entry), compSideOf(entry)], `${dialect} ${code}`).toEqual([null, null]);
    }
  });

  it('keeps G2 clockwise and G3 counter-clockwise wherever they are arcs', () => {
    // The ISO meaning the extents' vocabulary table carried before P4a (`ARC_CODES`): the
    // flags must say the same, or the extents results would move when P4.1 reads the flags.
    for (const dialect of DIALECTS) {
      for (const [code, want] of [
        ['G2', 'cw'],
        ['G3', 'ccw'],
      ] as const) {
        const entry = lookupCode(LOADED[dialect], code);
        if (entry?.sets?.path === 'arc') expect(arcDirectionOf(entry), `${dialect} ${code}`).toBe(want);
      }
    }
  });
});

describe("the profiles' arc direction words", () => {
  const profiles = BUILTIN_PROFILE_JSON as { id: string; addresses: { arcDirectionWords?: Record<string, string> } }[];

  it('are the golden ones on every resolved built-in profile', () => {
    const shipped = Object.fromEntries(profiles.map((p) => [p.id, p.addresses.arcDirectionWords ?? {}]));
    expect(shipped).toEqual(GOLDEN.profiles);
  });

  it('give each direction one word, so a mirror can swap them', () => {
    for (const profile of profiles) {
      const values = Object.values(profile.addresses.arcDirectionWords ?? {});
      expect(new Set(values).size, profile.id).toBe(values.length);
    }
  });
});
