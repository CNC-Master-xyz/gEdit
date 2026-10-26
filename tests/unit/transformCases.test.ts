// The transform fixture folders and their one reader (T207): every `options.json` has the
// one shape, and the harness reads it the way the unit tests do.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { caseOptions, caseProfile } from '../runtime/scenarios/m4-common.js';
import { CASE_KEYS, parseCaseMeta, readTransformCases } from './helpers/transformCases';

const ROOT = fileURLToPath(new URL('../fixtures/transforms/', import.meta.url));
const TRANSFORMS = readdirSync(ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const PROFILE_IDS = BUILTIN_PROFILE_JSON.map((profile) => (profile as { id: string }).id);

describe('the transform fixture folders', () => {
  it('are the eight transforms that have goldens', () => {
    expect(TRANSFORMS).toEqual([
      'block-skip',
      'convert-case',
      'insert-spaces',
      'remove-block-numbers',
      'remove-comments',
      'remove-empty-lines',
      'remove-spaces',
      'renumber',
    ]);
  });

  describe.each(TRANSFORMS)('%s', (transform) => {
    const dir = `${ROOT}${transform}/`;
    const cases = readTransformCases(dir);

    it('has cases, and each case folder holds exactly input.nc, options.json and expected.nc', () => {
      expect(cases.length).toBeGreaterThanOrEqual(3);
      for (const entry of cases) {
        expect(readdirSync(join(dir, entry.name)).sort(), entry.name).toEqual(['expected.nc', 'input.nc', 'options.json']);
      }
    });

    it('names a profile that ships, in every case', () => {
      for (const entry of cases) expect(PROFILE_IDS, `${transform}/${entry.name}`).toContain(entry.profile);
    });

    it('keeps `mode` for block-skip, which runs one of two transforms', () => {
      for (const entry of cases) {
        expect(entry.meta.mode !== undefined, `${transform}/${entry.name}`).toBe(transform === 'block-skip');
      }
    });

    it('says what it expects in every block-skip case, which blockSkip.test.ts reads unconditionally', () => {
      if (transform !== 'block-skip') return;
      for (const entry of cases) expect(entry.meta.expect, `${transform}/${entry.name}`).toBeDefined();
    });

    it('keeps a scope inside the program', () => {
      for (const entry of cases.filter((candidate) => candidate.meta.scope)) {
        const { startLine, endLine } = entry.meta.scope!;
        expect(startLine, entry.name).toBeGreaterThanOrEqual(1);
        expect(endLine, entry.name).toBeGreaterThanOrEqual(startLine);
        expect(endLine, entry.name).toBeLessThanOrEqual(entry.document.length);
      }
    });

    it('is read by the harness (m4-common) as it is read here', () => {
      for (const entry of cases) {
        const sidecar = JSON.parse(readFileSync(join(dir, entry.name, 'options.json'), 'utf8'));
        expect(caseOptions(sidecar), `${transform}/${entry.name}`).toEqual(entry.options);
        expect(caseProfile(sidecar, entry.name), `${transform}/${entry.name}`).toBe(entry.profile);
      }
    });
  });
});

describe('parseCaseMeta', () => {
  const good = { note: 'why', profile: 'fanuc-gcode', options: {} };
  const parse = (value: unknown) => parseCaseMeta(JSON.stringify(value), 'case');

  it('takes the run, with every optional member', () => {
    expect(parse(good)).toEqual(good);
    const full = { ...good, mode: 'add', firstLine: 4, expect: { summary: 's' } };
    expect(parse(full)).toEqual(full);
    expect(parse({ ...good, scope: { startLine: 1, endLine: 2 } }).scope).toEqual({ startLine: 1, endLine: 2 });
  });

  it('refuses the bare options the cleanup cases used to hold, and says where they go', () => {
    expect(() => parse({ case: 'upper' })).toThrow(/unknown key "case".*under "options"/);
    expect(() => parse({ ...good, excludeComments: false })).toThrow(/unknown key "excludeComments"/);
  });

  it.each([
    ['a note', { profile: 'fanuc-gcode', options: {} }, /needs a note/],
    ['a blank note', { ...good, note: '  ' }, /needs a note/],
    ['a profile', { note: 'n', options: {} }, /needs the profile id/],
    ['options', { note: 'n', profile: 'fanuc-gcode' }, /needs "options"/],
    ['options that are an object', { ...good, options: [] }, /needs "options"/],
    ['a mode that is add or remove', { ...good, mode: 'both' }, /add or remove/],
    ['one of scope and firstLine', { ...good, scope: { startLine: 1, endLine: 2 }, firstLine: 3 }, /not both/],
  ])('refuses a case without %s', (_what, value, message) => {
    expect(() => parse(value)).toThrow(message);
  });

  it('refuses something that is not an object', () => {
    expect(() => parseCaseMeta('[]', 'case')).toThrow(/not an object/);
    expect(() => parseCaseMeta('3', 'case')).toThrow(/not an object/);
  });

  it('knows exactly the keys the README documents', () => {
    expect([...CASE_KEYS]).toEqual(['note', 'profile', 'options', 'mode', 'scope', 'firstLine', 'expect']);
  });
});
