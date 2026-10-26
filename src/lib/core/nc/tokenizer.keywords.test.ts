// The keyword lookup of the tokenizer (T170): the table read and the second-character check that
// rule out most of a first character's group must give the answer the plain scan gives, at every
// position of every line. `reference` below is that plain scan, as `matchKeyword` was before T170.

import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import type { CompiledProfile } from '$lib/core/profiles/types';
import { listFixtures, openFixture } from '../../../../tests/unit/helpers/fixtures';
import type { LineState } from './types';
import { lexSpec, matchKeyword, tokenizeLine, type LexSpec } from './tokenizer';

const PROFILES: { id: string; cp: CompiledProfile }[] = BUILTIN_PROFILE_JSON.map((raw) => {
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  return { id: checked.profile.id, cp: compileProfile(checked.profile) };
});

const isSpace = (code: number): boolean => code === 0x20 || code === 0x09 || code === 0x0b || code === 0x0c || code === 0xa0;
const isLetter = (code: number): boolean => (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
const upper = (code: number): number => (code >= 0x61 && code <= 0x7a ? code - 32 : code);

function literalAt(line: string, p: number, literal: string, caseSensitive: boolean): boolean {
  if (p + literal.length > line.length) return false;
  for (let i = 0; i < literal.length; i++) {
    const a = line.charCodeAt(p + i);
    const b = literal.charCodeAt(i);
    if (a === b) continue;
    if (caseSensitive || upper(a) !== upper(b)) return false;
  }
  return true;
}

/** The scan as it was: the group of the first character from the map, every entry tried in full. */
function reference(line: string, p: number, limit: number, spec: LexSpec) {
  const group = spec.keywords.get(upper(line.charCodeAt(p)));
  if (!group) return null;
  for (const entry of group) {
    let q = p;
    let ok = true;
    for (let i = 0; i < entry.parts.length; i++) {
      if (i > 0) {
        let after = q;
        while (after < limit && isSpace(line.charCodeAt(after))) after++;
        if (after === q) {
          ok = false;
          break;
        }
        q = after;
      }
      const part = entry.parts[i];
      if (q + part.length > limit || !literalAt(line, q, part, spec.caseSensitive)) {
        ok = false;
        break;
      }
      q += part.length;
    }
    if (!ok) continue;
    if (q < limit) {
      const next = line.charCodeAt(q);
      const separated = !spec.packed && entry.single;
      if (separated ? !isSpace(next) : isLetter(next)) continue;
    }
    return { end: q, entry };
  }
  return null;
}

/** Every position of `line`, with the whole line as the limit and with limits that cut a keyword short. */
function compareAt(line: string, spec: LexSpec, where: string): number {
  let hits = 0;
  for (let p = 0; p < line.length; p++) {
    for (const limit of [line.length, p + 1, p + 2, p + 3, p + 5]) {
      if (limit > line.length) continue;
      const got = matchKeyword(line, p, limit, spec);
      const want = reference(line, p, limit, spec);
      if (got?.end !== want?.end || got?.entry !== want?.entry) {
        expect.fail(`${where}: ${JSON.stringify(line)} at ${p} (limit ${limit}): ${JSON.stringify(got?.entry.canonical)} to ${got?.end}, was ${JSON.stringify(want?.entry.canonical)} to ${want?.end}`);
      }
      if (got !== null) hits++;
    }
  }
  return hits;
}

/** The first `max` lines of a text, one per shape (digits all alike), so a long program adds what is different. */
function shapes(text: string, max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const shape = line.replace(/\d/g, '0');
    if (seen.has(shape)) continue;
    seen.add(shape);
    out.push(line.replace(/\r$/, ''));
    if (out.length >= max) break;
  }
  return out;
}

function klartextProgram(count: number): string[] {
  const lines = ['0 BEGIN PGM PERF MM', '1 BLK FORM 0.1 Z X+0 Y+0 Z-20', '2 TOOL CALL 1 Z S3000', '3 L Z+25 R0 FMAX M3', '4 CYCL DEF 200 DRILLING ~', '5 F TCP', '6 FUNCTION TCPM F TCP AXIS POS'];
  let n = lines.length;
  let x = 0;
  while (lines.length < count) {
    x = (x + 0.5) % 100;
    lines.push(`${n++} L X+${x.toFixed(3)} Y-${(x / 3).toFixed(3)} Z-${(x / 7).toFixed(3)} R0 F800`);
  }
  return lines;
}

const FIXTURE_LINES = (() => {
  const all: string[] = [];
  for (const rel of listFixtures('nc')) {
    const opened = openFixture(rel);
    if (opened.refused !== null) continue;
    all.push(...shapes(opened.text, 400));
  }
  return all;
})();

describe('matchKeyword', () => {
  it('has all six built-in profiles to check', () => {
    expect(PROFILES.map((p) => p.id).sort()).toEqual(['fanuc-gcode', 'fanuc-lathe', 'heidenhain-klartext', 'okuma-osp', 'sinumerik', 'sinumerik-mill']);
    expect(FIXTURE_LINES.length).toBeGreaterThan(1000);
  });

  it.each(PROFILES.map((p) => [p.id, p.cp] as const))('%s: gives the answer of the plain scan at every position of the fixtures', (id, cp) => {
    const spec = lexSpec(cp);
    let hits = 0;
    // Every dialect reads every program: a line of another dialect is the odd input a lookup meets too.
    for (const line of FIXTURE_LINES) hits += compareAt(line, spec, id);
    expect(hits).toBeGreaterThan(0);
  });

  it('heidenhain-klartext: gives the answer of the plain scan on a generated program, and the keywords it finds are the same tokens', () => {
    const cp = PROFILES.find((p) => p.id === 'heidenhain-klartext')?.cp as CompiledProfile;
    const spec = lexSpec(cp);
    const lines = klartextProgram(3000);
    for (const line of lines.slice(0, 40)) compareAt(line, spec, 'generated');
    // Past the first lines the generated ones only differ in their numbers; sample the rest.
    for (let i = 40; i < lines.length; i += 97) compareAt(lines[i], spec, 'generated');
    const found = new Set<string>();
    let state: LineState | undefined;
    for (const line of lines) {
      const result = tokenizeLine(line, cp, state);
      state = result.state;
      for (const token of result.tokens) if (token.kind === 'keyword') found.add(token.address ?? '');
    }
    expect([...found].sort()).toEqual(expect.arrayContaining(['BEGIN PGM', 'BLK FORM', 'CYCL DEF', 'F TCP', 'FMAX', 'FUNCTION TCPM', 'L', 'TOOL CALL']));
  });

  it('keeps the edge cases: a limit that cuts a keyword, blanks of every kind, lower case, a one-letter keyword at the line end', () => {
    const spec = lexSpec(PROFILES.find((p) => p.id === 'heidenhain-klartext')?.cp as CompiledProfile);
    const cases: [string, number, number, string | null][] = [
      ['L X+5', 0, 5, 'L'],
      ['L', 0, 1, 'L'],
      ['LBL 1', 0, 5, 'LBL'],
      ['LBL 1', 0, 2, null],
      ['L\tX+5', 0, 5, 'L'],
      ['lbl 1', 0, 5, 'LBL'],
      ['F TCP', 0, 5, 'F TCP'],
      ['F TCP', 0, 5, 'F TCP'],
      ['F  CONT', 0, 7, 'F CONT'],
      ['F TC', 0, 4, null],
      ['F800', 0, 4, null],
      ['FMAX', 0, 4, 'FMAX'],
      ['R0 F800', 0, 7, null],
      ['LX+5', 0, 4, null],
      ['TOOL CALL 1', 0, 11, 'TOOL CALL'],
      ['TOOL  CALL 1', 0, 12, 'TOOL CALL'],
      ['TOOLCALL 1', 0, 10, null],
    ];
    for (const [line, p, limit, want] of cases) {
      expect(matchKeyword(line, p, limit, spec)?.entry.canonical ?? null, `${JSON.stringify(line)} limit ${limit}`).toBe(want);
      expect(reference(line, p, limit, spec)?.entry.canonical ?? null, `reference: ${JSON.stringify(line)}`).toBe(want);
    }
  });
});
