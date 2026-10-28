// The profile form (plan AD-57, §6.10 rules 7 and 8; P4.40): the sections generated from the
// schema, the changes to the file, the text the document gets, the sample programs of the
// preview and the model that saves through the file's document. Everything here runs on fakes:
// no Monaco, no store, no Tauri.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PATTERN_GROUPS,
  PREVIEW_LANGUAGE_ID,
  blankRow,
  createProfileForm,
  describeValue,
  fileText,
  formSections,
  listText,
  mergeOver,
  parseList,
  parseWeights,
  patternAnswer,
  profileSchema,
  sampleProgram,
  setField,
  weightsText,
  type ProfileFormDeps,
  type ProfileFormField,
  type ProfileFormState,
} from './profileForm';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_JSON, BUILTIN_PROFILE_SOURCES } from '$lib/data/profiles';
import { DIALECTS } from '$lib/core/grammar/testCorpus';
import { emittedRoles, monarchTokens } from '$lib/core/grammar/monarchSim';
import { validateProfile } from '$lib/core/profiles/validate';
import { hasKey } from '$lib/i18n';
import type { Profile } from '$lib/core/profiles/types';
import { get } from 'svelte/store';

type Obj = Record<string, unknown>;

const SCHEMA_PATH = fileURLToPath(new URL('../../../schemas/profile.schema.json', import.meta.url));
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as Obj;

const resolvedOf = (id: string): Profile => (BUILTIN_PROFILE_JSON as unknown as Profile[]).find((p) => p.id === id) as Profile;
const rawOf = (id: string): Obj => BUILTIN_PROFILE_SOURCES.find((s) => (s.raw as Obj).id === id)!.raw as Obj;

/** A small file that extends fanuc-gcode, as "New Profile From…" writes it. */
const USER_FILE: Obj = {
  $schema: 'https://example.invalid/profile.schema.json',
  id: 'my-fanuc',
  name: 'My Fanuc',
  shortName: 'MYF',
  version: 1,
  extends: 'fanuc-gcode',
  detect: { content: [] },
};

const sections = (file: Obj = USER_FILE, builtin = false, resolved: Obj = resolvedOf('fanuc-gcode') as unknown as Obj) =>
  formSections({ schema, file, resolved: file.extends === undefined ? file : { ...resolved, ...file }, builtin });
const fieldsOf = (list: ReturnType<typeof sections>): ProfileFormField[] => list.flatMap((s) => s.fields);
const fieldAt = (list: ReturnType<typeof sections>, path: string): ProfileFormField => {
  const found = fieldsOf(list).find((f) => f.path === path);
  if (found === undefined) throw new Error(`no field ${path}`);
  return found;
};

describe('PREVIEW_LANGUAGE_ID', () => {
  it('stays out of reach of every profile id', () => {
    const result = validateProfile({ id: PREVIEW_LANGUAGE_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.startsWith('id:'))).toBe(true);
  });
});

describe('formSections', () => {
  it('builds one section per top-level member in the schema order, with title and help from the schema', () => {
    const list = sections();
    const order = (schema['x-gedit-order'] as string[]).filter((name) => !['id', 'extends'].includes(name));
    expect(list.map((s) => s.id)).toEqual(order);
    const props = schema.properties as Record<string, Obj>;
    for (const section of list) {
      expect(section.title, section.id).toBe(props[section.id].title);
      expect(section.help, section.id).toBe(props[section.id].description);
      expect(section.title.length, section.id).toBeGreaterThan(0);
    }
  });

  it('gives every field a title and help from the schema', () => {
    for (const field of fieldsOf(sections())) {
      expect(field.title, field.path).not.toBe('');
      expect(field.help, field.path).not.toBe('');
    }
  });

  it('lists the members of a group as fields of their own, by JSON path', () => {
    const list = sections();
    const files = list.find((s) => s.id === 'files')!;
    expect(files.fields.map((f) => f.path)).toEqual([
      'files.extensions',
      'files.defaultExtension',
      'files.filterName',
      'files.encoding',
      'files.lineEnding',
      'files.newFileLineEnding',
    ]);
    expect(fieldAt(list, 'syntax.blockNumber.prefix').kind).toBe('text');
    expect(fieldAt(list, 'toolCall.tool').kind).toBe('pattern');
  });

  it('chooses the kind from the schema: x-gedit-kind first, then the type', () => {
    const list = sections();
    expect(fieldAt(list, 'files.extensions').kind).toBe('text-list');
    expect(fieldAt(list, 'detect.extensions').kind).toBe('weights');
    expect(fieldAt(list, 'detect.content').kind).toBe('rows');
    expect(fieldAt(list, 'detect.vetoes').kind).toBe('pattern-list');
    expect(fieldAt(list, 'syntax.strings').kind).toBe('bool');
    expect(fieldAt(list, 'syntax.maxLineLength').kind).toBe('integer');
    expect(fieldAt(list, 'machineType').kind).toBe('choice');
    expect(fieldAt(list, 'grammar').choices).toEqual(['iso', 'klartext', 'okuma', 'sinumerik']);
    expect(fieldAt(list, 'colors').kind).toBe('colors');
    expect(fieldAt(list, 'editing.tabWidth')).toMatchObject({ kind: 'integer', min: 1, max: 16 });
  });

  it('reads the columns of a table and the whole numbers of a list from the schema', () => {
    const list = sections();
    const content = fieldAt(list, 'detect.content');
    expect(content.columns?.map((c) => [c.path, c.kind])).toEqual([
      ['pattern', 'pattern'],
      ['weight', 'number'],
    ]);
    const outline = fieldAt(list, 'outline');
    expect(outline.columns?.map((c) => c.path)).toEqual(['kind', 'pattern']);
    expect(outline.columns?.[0].choices).toContain('subprogram-call');
    expect(fieldAt(list, 'syntax.comments').columns?.find((c) => c.path === 'end')?.nullable).toBe(true);
    expect(fieldAt(list, 'editing.rulers')).toMatchObject({ kind: 'text-list', itemKind: 'integer', maxItems: 8 });
    expect(fieldAt(list, 'files.extensions').itemKind).toBe('text');
  });

  it('offers "keep or a number of decimals" as a choice whose numbers are numbers', () => {
    const decimals = fieldAt(sections(), 'numberFormat.decimals');
    expect(decimals).toMatchObject({ kind: 'choice', numericChoices: true });
    expect(decimals.choices).toEqual(['keep', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
  });

  it('never offers the identity, the parent, the schema line or the three members only a machine writes', () => {
    const paths = fieldsOf(sections()).map((f) => f.path);
    for (const never of ['id', 'extends', '$schema', 'modal.units', 'modal.diameter', 'modal.sources']) {
      expect(paths, never).not.toContain(never);
      expect(paths.some((p) => p.startsWith(`${never}.`)), never).toBe(false);
    }
    // Even when the schema were to describe one of them, the list is the form's own rule.
    const withUnits = JSON.parse(JSON.stringify(schema)) as Obj;
    ((withUnits.properties as Obj).modal as Obj & { properties: Obj }).properties.units = { title: 'Units', description: 'x', type: 'string' };
    const offered = formSections({ schema: withUnits, file: USER_FILE, resolved: USER_FILE, builtin: false }).flatMap((s) => s.fields.map((f) => f.path));
    expect(offered).not.toContain('modal.units');
  });

  it('shows the members that cannot be made plain as JSON, read-only', () => {
    const list = sections();
    for (const path of [
      'machineParams.variants',
      'machineParams.channels',
      'numbering.references',
      'numbering.calls',
      'compare.cycleNames',
      'machineParams.numberInput',
      'modal.initial',
    ]) {
      const field = fieldAt(list, path);
      expect(field.kind, path).toBe('json');
      expect(field.readOnly, path).toBe(true);
    }
  });

  it('shows what the file writes as its own, and what it inherits beside a field it does not write', () => {
    const file: Obj = { ...USER_FILE, editing: { tabWidth: 8 } };
    const list = sections(file);
    const own = fieldAt(list, 'editing.tabWidth');
    expect(own.own).toBe(8);
    expect(own.inherited).toBeUndefined();

    const parent = resolvedOf('fanuc-gcode') as unknown as Obj;
    const inheritedComments = fieldAt(list, 'syntax.comments');
    expect(inheritedComments.own).toBeUndefined();
    expect(inheritedComments.inherited).toEqual((parent.syntax as Obj).comments);
  });

  it('writes nothing for an inherited value: the file is the form’s input, not the resolved profile', () => {
    const list = sections();
    expect(fieldAt(list, 'syntax.comments').own).toBeUndefined();
    expect(setField(USER_FILE, 'name', 'My Fanuc')).toEqual(USER_FILE);
  });

  it('marks the schema’s advanced members', () => {
    const list = sections();
    expect(fieldAt(list, 'detect.priority').advanced).toBe(true);
    expect(fieldAt(list, 'detect.content').advanced).toBe(false);
  });

  it('makes a built-in profile read-only, every field', () => {
    const file = rawOf('fanuc-gcode');
    const list = formSections({ schema, file, resolved: resolvedOf('fanuc-gcode') as unknown as Obj, builtin: true });
    expect(list.length).toBeGreaterThan(5);
    for (const field of fieldsOf(list)) expect(field.readOnly, field.path).toBe(true);
    expect(fieldAt(list, 'syntax.comments').own).toEqual((file.syntax as Obj).comments);
  });

  it('describes every member the built-in profiles write (the form drops none of them)', () => {
    const offered = new Set(fieldsOf(sections()).map((f) => f.path));
    const topLevel = new Set(['id', 'extends', '$schema']);
    const walk = (value: unknown, path: string, out: string[]): void => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return out.push(path) as unknown as void;
      for (const [key, child] of Object.entries(value)) walk(child, path === '' ? key : `${path}.${key}`, out);
    };
    const missing: string[] = [];
    for (const source of BUILTIN_PROFILE_SOURCES) {
      const paths: string[] = [];
      walk(source.raw, '', paths);
      for (const path of paths) {
        if (topLevel.has(path)) continue;
        // A member below a field that the form shows whole (a table, a map, JSON, colours) is covered by that field.
        const covered = [...offered].some((field) => path === field || path.startsWith(`${field}.`));
        if (!covered) missing.push(path);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('setField', () => {
  it('writes one member and leaves the original object alone', () => {
    const before = JSON.stringify(USER_FILE);
    const next = setField(USER_FILE, 'editing.tabWidth', 4);
    expect(next.editing).toEqual({ tabWidth: 4 });
    expect(JSON.stringify(USER_FILE)).toBe(before);
    expect(next).not.toBe(USER_FILE);
  });

  it('removes a member with undefined, and an object it leaves empty with it', () => {
    const file = setField(USER_FILE, 'editing.tabWidth', 4);
    expect(setField(file, 'editing.tabWidth', undefined)).toEqual(USER_FILE);
    const two = setField(setField(USER_FILE, 'editing.tabWidth', 4), 'editing.rulers', [80]);
    expect(setField(two, 'editing.tabWidth', undefined).editing).toEqual({ rulers: [80] });
    // An object that was empty in the file before is not touched by removing something else.
    expect(setField({ ...USER_FILE, files: {} }, 'detect.priority', undefined)).toEqual({ ...USER_FILE, files: {} });
  });

  it('keeps every member it does not offer, in its place', () => {
    const file: Obj = { zzz: 1, ...USER_FILE, editing: { tabWidth: 4, futureMember: true }, more: [1, 2] };
    const next = setField(file, 'editing.tabWidth', 2);
    expect(next.zzz).toBe(1);
    expect(next.more).toEqual([1, 2]);
    expect(next.editing).toEqual({ tabWidth: 2, futureMember: true });
    expect(Object.keys(next)).toEqual(Object.keys(file));
  });

  it('puts a new member after the members that come before it in the schema', () => {
    const file: Obj = { id: 'a', name: 'A', shortName: 'A', version: 1, detect: {}, syntax: {}, numbering: {} };
    expect(Object.keys(setField(file, 'toolCall', { trigger: 'x' }))).toEqual(['id', 'name', 'shortName', 'version', 'detect', 'syntax', 'toolCall', 'numbering']);
    expect(Object.keys(setField(file, 'editing', { tabWidth: 4 })).slice(-1)).toEqual(['editing']);
    expect(Object.keys(setField({ ...file, files: undefined } as Obj, 'machineType', 'lathe'))).toContain('machineType');
    const nested = setField({ editing: { rulers: [80] } }, 'editing.forceUppercase', true);
    expect(Object.keys(nested.editing as Obj)).toEqual(['forceUppercase', 'rulers']);
  });

  it('writes below a member that is not an object by replacing it', () => {
    expect(setField({ editing: 5 }, 'editing.tabWidth', 4)).toEqual({ editing: { tabWidth: 4 } });
  });

  it('refuses a path that could reach the prototype', () => {
    expect(() => setField({}, '__proto__.polluted', true)).toThrow();
    expect(() => setField({}, 'editing.constructor', true)).toThrow();
    expect(({} as Obj).polluted).toBeUndefined();
  });
});

describe('fileText', () => {
  const file: Obj = { id: 'a', name: 'A', list: [1, 2], nested: { on: true } };

  it('gives the original text back byte for byte when nothing changed (indentation, line ending, final newline)', () => {
    for (const original of [
      JSON.stringify(file, null, 2),
      `${JSON.stringify(file, null, 2)}\n`,
      `${JSON.stringify(file, null, 4)}\n`,
      JSON.stringify(file, null, '\t'),
      JSON.stringify(file, null, 2).replace(/\n/g, '\r\n'),
      JSON.stringify(file),
      '{ "id": "a",\n   "name": "A", "list": [1,\n 2], "nested": { "on": true } }\n',
      `\uFEFF${JSON.stringify(file, null, 2)}\n`,
    ]) {
      expect(fileText(original, file)).toBe(original);
    }
  });

  it('ignores the order of the members when it decides that nothing changed', () => {
    const original = JSON.stringify({ name: 'A', id: 'a', nested: { on: true }, list: [1, 2] }, null, 2);
    expect(fileText(original, file)).toBe(original);
  });

  it('writes a change in the indentation, line ending and final break of the original', () => {
    const changed = { ...file, name: 'B' };
    expect(fileText(`${JSON.stringify(file, null, 2)}\n`, changed)).toBe(`${JSON.stringify(changed, null, 2)}\n`);
    expect(fileText(JSON.stringify(file, null, 2), changed)).toBe(JSON.stringify(changed, null, 2));
    expect(fileText(`${JSON.stringify(file, null, 4)}\n`, changed)).toBe(`${JSON.stringify(changed, null, 4)}\n`);
    expect(fileText(JSON.stringify(file, null, '\t'), changed)).toBe(JSON.stringify(changed, null, '\t'));
    expect(fileText(`${JSON.stringify(file, null, 2).replace(/\n/g, '\r\n')}\r\n`, changed)).toBe(`${JSON.stringify(changed, null, 2).replace(/\n/g, '\r\n')}\r\n`);
    expect(fileText(JSON.stringify(file), changed)).toBe(JSON.stringify(changed));
    expect(fileText(`\uFEFF${JSON.stringify(file, null, 2)}\n`, changed)).toBe(`\uFEFF${JSON.stringify(changed, null, 2)}\n`);
  });

  it('writes a file that is not JSON any more in the default layout', () => {
    expect(fileText('{\n  "id": \n', file)).toBe(`${JSON.stringify(file, null, 2)}\n`);
    // On one line, the layout stays one line.
    expect(fileText('{ "id": ', file)).toBe(JSON.stringify(file));
  });
});

describe('the list-like fields', () => {
  it('shows a list one entry per line and reads it back, leaving out blank lines', () => {
    expect(listText(['nc', 'tap'])).toBe('nc\ntap');
    expect(listText(undefined)).toBe('');
    expect(parseList('nc\n\n  tap  \r\n')).toEqual({ ok: true, value: ['nc', 'tap'] });
    expect(parseList('')).toEqual({ ok: true, value: [] });
  });

  it('reads a list of whole numbers and names the line that is not one', () => {
    expect(parseList('72\n80', 'integer')).toEqual({ ok: true, value: [72, 80] });
    expect(parseList('72\neighty', 'integer')).toEqual({ ok: false, line: 2 });
    expect(parseList('7.5', 'integer')).toEqual({ ok: false, line: 1 });
  });

  it('shows a weight map as name = weight lines and reads it back', () => {
    expect(weightsText({ nc: 1, mpf: 10 })).toBe('nc = 1\nmpf = 10');
    expect(parseWeights('nc = 1\nmpf=10\n\n')).toEqual({ ok: true, value: { nc: 1, mpf: 10 } });
    expect(parseWeights('nc = 1.5')).toEqual({ ok: true, value: { nc: 1.5 } });
  });

  it('refuses a weight line that is not name = number, or a name twice, or a name that reaches the prototype', () => {
    expect(parseWeights('nc')).toEqual({ ok: false, line: 1 });
    expect(parseWeights('nc = one')).toEqual({ ok: false, line: 1 });
    expect(parseWeights('nc = 1\nnc = 2')).toEqual({ ok: false, line: 2 });
    expect(parseWeights('__proto__ = 1')).toEqual({ ok: false, line: 1 });
  });

  it('starts a new table row with empty text, the first choice and a weight of 1', () => {
    const columns = fieldAt(sections(), 'detect.content').columns!;
    expect(blankRow(columns)).toEqual({ pattern: '', weight: 1 });
    const outline = fieldAt(sections(), 'outline').columns!;
    expect(blankRow(outline)).toEqual({ kind: 'tool', pattern: '' });
    const comments = fieldAt(sections(), 'syntax.comments').columns!;
    expect(blankRow(comments)).toEqual({ start: '', end: null });
  });

  it('shortens a value to one line', () => {
    expect(describeValue('G90')).toBe('G90');
    expect(describeValue(['X', 'Y', 'Z'])).toBe('X, Y, Z');
    expect(describeValue({ start: '(' })).toBe('{"start":"("}');
    expect(describeValue('x'.repeat(200)).length).toBe(80);
    expect(describeValue(undefined)).toBe('');
  });
});

describe('the pattern tester', () => {
  it('answers ok for a pattern that compiles and is in the subset both languages read', () => {
    expect(patternAnswer('^%')).toEqual({ ok: true });
    expect(patternAnswer('(?<![A-Z])T(?<tool>\\d+)', 'tool')).toEqual({ ok: true });
  });

  it('says why a pattern does not compile, uses a construct Python lacks, or misses its named group', () => {
    const broken = patternAnswer('(');
    expect(broken.ok).toBe(false);
    const unicode = patternAnswer('\\p{L}');
    expect(unicode).toMatchObject({ ok: false });
    expect(patternAnswer('T\\d+', 'tool')).toMatchObject({ ok: false, reason: expect.stringContaining('(?<tool>') as unknown as string });
  });

  it('names the group the three fields that need one are checked for', () => {
    expect(PATTERN_GROUPS).toEqual({ 'toolCall.tool': 'tool', 'syntax.labels': 'name', 'syntax.freeText': 'text' });
  });
});

describe('sampleProgram', () => {
  const combos = [
    ['iso', 'mill'],
    ['iso', 'lathe'],
    ['klartext', 'mill'],
    ['klartext', 'lathe'],
    ['okuma', 'mill'],
    ['okuma', 'lathe'],
    ['sinumerik', 'mill'],
    ['sinumerik', 'lathe'],
  ] as const;

  it('has a program for each grammar and machine type, each its own', () => {
    const seen = new Set<string>();
    for (const [grammar, machineType] of combos) {
      const text = sampleProgram({ ...resolvedOf('fanuc-gcode'), grammar, machineType } as Profile);
      expect(text.length, `${grammar}/${machineType}`).toBeGreaterThan(80);
      expect(text.endsWith('\n')).toBe(true);
      seen.add(text);
    }
    expect(seen.size).toBe(combos.length);
  });

  it('shows the kinds of word the colours are for, in every built-in profile', () => {
    for (const dialect of DIALECTS) {
      const roles = new Set<string>();
      for (const line of sampleProgram(dialect.profile).split('\n')) {
        for (const token of monarchTokens(dialect.grammar, line)) if (token.role !== '') roles.add(token.role);
      }
      // Every role the grammar can give, except the few a short sample cannot show for that dialect.
      const hidden = new Set(HIDDEN_BY_DIALECT[dialect.id] ?? []);
      const missing = emittedRoles(dialect.grammar).filter((role) => !roles.has(role) && !hidden.has(role));
      expect(missing, dialect.id).toEqual([]);
      for (const role of ['comment', 'blockNumber', 'gcode', 'axis', 'feed', 'variable', 'keyword']) {
        if (!emittedRoles(dialect.grammar).includes(role)) continue;
        expect(roles.has(role), `${dialect.id} ${role}`).toBe(true);
      }
    }
  });

  it('writes a comment the way the draft profile writes one', () => {
    const base = resolvedOf('fanuc-gcode');
    const semicolon = { ...base, syntax: { ...base.syntax, comments: [{ start: ';', end: null }] } } as Profile;
    expect(sampleProgram(semicolon)).toContain(';SAMPLE POCKET');
    expect(sampleProgram(semicolon)).not.toContain('(SAMPLE POCKET)');
    expect(sampleProgram(base)).toContain('(SAMPLE POCKET)');
  });

  it('numbers its blocks with the draft’s block number letter', () => {
    const base = resolvedOf('fanuc-gcode');
    const custom = { ...base, syntax: { ...base.syntax, blockNumber: { ...base.syntax.blockNumber, prefix: 'L' } } } as Profile;
    expect(sampleProgram(custom)).toMatch(/^L10 /m);
    expect(sampleProgram(custom)).not.toMatch(/^N10 /m);
  });
});

/** Roles that a grammar can give but the short sample of that dialect has no word for. */
const HIDDEN_BY_DIALECT: Record<string, string[]> = {
  'okuma-osp': ['section'],
  sinumerik: ['section'],
  'sinumerik-mill': ['section'],
};

// ---------------------------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------------------------

/** Fakes for everything the model reaches: a file on "disk", the document that holds it, the registry's check. */
function harness(options: { diskText?: string; parentExists?: boolean; saveFails?: boolean; lock?: boolean; openDirty?: boolean; confirm?: boolean } = {}) {
  const text = options.diskText ?? `${JSON.stringify(USER_FILE, null, 2)}\n`;
  const state = {
    doc: options.openDirty === true ? { id: 'd9', text, dirty: true } : (null as { id: string; text: string; dirty: boolean } | null),
    active: 'd1',
    activated: [] as string[],
    replaced: [] as string[],
    saves: 0,
    reloads: 0,
    confirmAsked: 0,
  };
  const parentProfile = resolvedOf('fanuc-gcode') as unknown as Obj;
  const deps: ProfileFormDeps = {
    schema: profileSchema,
    readUser: async () => ({ text, error: null }),
    userPath: async (name) => `/config/profiles/${name}`,
    builtin: (id) => {
      const source = BUILTIN_PROFILE_SOURCES.find((s) => (s.raw as Obj).id === id);
      return source === undefined ? undefined : { file: source.raw as Obj, resolved: resolvedOf(id) as unknown as Obj };
    },
    parent: (id) => (id === 'fanuc-gcode' && options.parentExists !== false ? parentProfile : undefined),
    check: (merged) => {
      const checked = validateProfile(merged, { codeDbs: Object.keys(BUILTIN_CODE_DB_JSON) });
      return checked.ok ? { profile: checked.profile } : { errors: checked.errors };
    },
    docs: {
      find: (path) => (state.doc === null ? undefined : { id: state.doc.id, dirty: state.doc.dirty, title: path }),
      open: async () => {
        state.doc = { id: 'd2', text, dirty: false };
        state.active = 'd2';
        return 'd2';
      },
      text: () => state.doc!.text,
      replace: (_id, next) => {
        state.doc!.text = options.lock === true ? state.doc!.text : next;
        state.doc!.dirty = true;
        state.replaced.push(next);
      },
      refusal: () => null,
      markClean: () => {
        state.doc!.dirty = false;
      },
      save: async () => {
        state.saves++;
        if (options.saveFails === true) return false;
        state.doc!.dirty = false;
        return true;
      },
      activeId: () => state.active,
      activate: (id) => {
        state.activated.push(id);
        state.active = id;
      },
    },
    reload: async () => {
      state.reloads++;
    },
    confirm: async () => {
      state.confirmAsked++;
      return options.confirm ?? true;
    },
  };
  const model = createProfileForm(deps);
  const snapshot = (): ProfileFormState => get(model.state);
  return { model, state, snapshot, text };
}

describe('the model: opening', () => {
  it('reads the file and shows what it writes and what it inherits', async () => {
    const { model, snapshot } = harness();
    expect(await model.load({ kind: 'user', name: 'my-fanuc.json' })).toBe(true);
    const s = snapshot();
    expect({ problems: s.problems, loose: s.loose }).toEqual({ problems: {}, loose: [] });
    expect(s).toMatchObject({ open: true, readOnly: false, id: 'my-fanuc', parent: 'fanuc-gcode', dirty: false, canSave: true, refusal: null });
    expect(fieldAt(s.sections, 'name').own).toBe('My Fanuc');
    expect(fieldAt(s.sections, 'syntax.comments').inherited).toEqual((resolvedOf('fanuc-gcode').syntax as unknown as Obj).comments);
    expect(s.preview?.id).toBe('my-fanuc');
  });

  it('opens a built-in profile read-only, and refuses every change and every save', async () => {
    const { model, snapshot, state } = harness();
    expect(await model.load({ kind: 'builtin', id: 'fanuc-gcode' })).toBe(true);
    expect(snapshot()).toMatchObject({ open: true, readOnly: true, canSave: false, dirty: false });
    model.set('name', 'Changed');
    expect(snapshot().dirty).toBe(false);
    expect(await model.save()).toBe(false);
    expect(state.saves).toBe(0);
    expect(fieldsOf(snapshot().sections).every((f) => f.readOnly)).toBe(true);
  });

  it('refuses an unknown built-in profile, a file that is not JSON, and one that is not an object', async () => {
    const unknown = harness();
    expect(await unknown.model.load({ kind: 'builtin', id: 'nope' })).toBe(false);
    expect(unknown.snapshot().refusal?.key).toBe('profileForm.unknownProfile');

    const broken = harness({ diskText: '{ "id": ' });
    expect(await broken.model.load({ kind: 'user', name: 'x.json' })).toBe(false);
    expect(broken.snapshot().refusal?.key).toBe('profileForm.notJson');

    const list = harness({ diskText: '[1, 2]' });
    expect(await list.model.load({ kind: 'user', name: 'x.json' })).toBe(false);
    expect(list.snapshot().refusal?.key).toBe('profileForm.notObject');
  });

  it('refuses a file whose document has unsaved changes', async () => {
    const { model, snapshot } = harness({ openDirty: true });
    expect(await model.load({ kind: 'user', name: 'my-fanuc.json' })).toBe(false);
    expect(snapshot().refusal).toEqual({ key: 'profileForm.saveFirst', params: { name: 'my-fanuc.json' } });
  });

  it('blocks Save when a profile that extends another loses its own name or short name (the registry would drop the file)', async () => {
    for (const own of ['name', 'shortName']) {
      const { model, snapshot } = harness();
      await model.load({ kind: 'user', name: 'my-fanuc.json' });
      expect(snapshot().canSave).toBe(true);
      model.set(own, undefined);
      expect(snapshot().canSave, own).toBe(false);
      expect(snapshot().problems[own]?.length, own).toBeGreaterThan(0);
      expect(await model.save()).toBe(false);
      model.set(own, 'Back again');
      expect(snapshot().canSave, own).toBe(true);
      expect(snapshot().problems[own]).toBeUndefined();
      model.set(own, '');
      expect(snapshot().canSave, own).toBe(false);
    }
  });

  it('says so when the profile it extends is not loaded', async () => {
    const { model, snapshot } = harness({ parentExists: false });
    await model.load({ kind: 'user', name: 'my-fanuc.json' });
    expect(snapshot().canSave).toBe(false);
    expect(snapshot().loose[0]).toContain('fanuc-gcode');
  });
});

describe('the model: editing', () => {
  it('changes the draft, never the file on disk, and takes a member out again with reset', async () => {
    const { model, snapshot, state } = harness();
    await model.load({ kind: 'user', name: 'my-fanuc.json' });
    model.set('editing.tabWidth', 4);
    expect(snapshot()).toMatchObject({ dirty: true, canSave: true });
    expect(fieldAt(snapshot().sections, 'editing.tabWidth').own).toBe(4);
    expect(state.replaced).toEqual([]);
    model.reset('editing.tabWidth');
    expect(snapshot()).toMatchObject({ dirty: false });
    expect(snapshot().file).toEqual(USER_FILE);
  });

  it('shows a problem at its field and blocks Save while it is open', async () => {
    const { model, snapshot } = harness();
    await model.load({ kind: 'user', name: 'my-fanuc.json' });
    model.set('editing.tabWidth', 99);
    const s = snapshot();
    expect(s.problems['editing.tabWidth']?.length).toBeGreaterThan(0);
    expect(s.canSave).toBe(false);
    expect(await model.save()).toBe(false);
    // The preview keeps the last good draft and says why it is not the current one.
    expect(s.preview?.id).toBe('my-fanuc');
    expect(s.previewProblem).toContain('editing.tabWidth');
    model.set('editing.tabWidth', 4);
    expect(snapshot().problems).toEqual({});
    expect(snapshot().canSave).toBe(true);
  });

  it('puts a problem inside a table at the table’s field', async () => {
    const { model, snapshot } = harness();
    await model.load({ kind: 'user', name: 'my-fanuc.json' });
    model.set('detect.content', [{ pattern: '(', weight: 1 }]);
    expect(Object.keys(snapshot().problems)).toContain('detect.content');
  });

  it('keeps a problem that belongs to no field in a list of its own', async () => {
    const { model, snapshot } = harness();
    await model.load({ kind: 'user', name: 'my-fanuc.json' });
    model.set('machineParams', { variants: 5 });
    const s = snapshot();
    expect(s.canSave).toBe(false);
    expect(Object.keys(s.problems).length + s.loose.length).toBeGreaterThan(0);
  });

  it('blocks Save while a colour is too pale to read, and allows it again', async () => {
    const { model, snapshot } = harness();
    await model.load({ kind: 'user', name: 'my-fanuc.json' });
    model.set('editing.tabWidth', 4);
    model.setColorsValid(false);
    expect(snapshot().canSave).toBe(false);
    expect(await model.save()).toBe(false);
    model.setColorsValid(true);
    expect(snapshot().canSave).toBe(true);
  });
});

describe('the model: saving through the file’s document', () => {
  it('replaces the document’s text as one edit, saves it, brings the user’s tab back and reads the folders again', async () => {
    const { model, snapshot, state, text } = harness();
    await model.load({ kind: 'user', name: 'my-fanuc.json' });
    model.set('editing.tabWidth', 4);
    expect(await model.save()).toBe(true);
    expect(state.replaced).toHaveLength(1);
    expect(state.replaced[0]).toBe(fileText(text, { ...USER_FILE, editing: { tabWidth: 4 } }));
    expect(JSON.parse(state.replaced[0])).toEqual({ ...USER_FILE, editing: { tabWidth: 4 } });
    expect(state.saves).toBe(1);
    expect(state.activated).toEqual(['d1']);
    expect(state.reloads).toBe(1);
    expect(snapshot()).toMatchObject({ dirty: false, busy: false });
    expect(snapshot().message?.error).toBe(false);
  });

  it('keeps the indentation and line ending of the file', async () => {
    const crlf = `${JSON.stringify(USER_FILE, null, 4).replace(/\n/g, '\r\n')}\r\n`;
    const { model, state } = harness({ diskText: crlf });
    await model.load({ kind: 'user', name: 'my-fanuc.json' });
    model.set('name', 'Other');
    await model.save();
    expect(state.replaced[0]).toBe(`${JSON.stringify({ ...USER_FILE, name: 'Other' }, null, 4).replace(/\n/g, '\r\n')}\r\n`);
  });

  it('does not touch the document when nothing changed', async () => {
    const { model, state } = harness();
    await model.load({ kind: 'user', name: 'my-fanuc.json' });
    expect(await model.save()).toBe(true);
    expect(state.saves).toBe(0);
    expect(state.replaced).toEqual([]);
  });

  it('writes nothing when the document has unsaved changes by the time of Save', async () => {
    const h = harness();
    await h.model.load({ kind: 'user', name: 'my-fanuc.json' });
    h.model.set('editing.tabWidth', 4);
    h.state.doc = { id: 'd7', text: h.text, dirty: true };
    expect(await h.model.save()).toBe(false);
    expect(h.state.replaced).toEqual([]);
    expect(h.snapshot().message).toEqual({ msg: { key: 'profileForm.saveFirst', params: { name: 'my-fanuc.json' } }, error: true });
  });

  it('writes nothing when the file changed since the form read it', async () => {
    const h = harness();
    await h.model.load({ kind: 'user', name: 'my-fanuc.json' });
    h.model.set('editing.tabWidth', 4);
    h.state.doc = { id: 'd7', text: JSON.stringify({ ...USER_FILE, name: 'Changed elsewhere' }), dirty: false };
    expect(await h.model.save()).toBe(false);
    expect(h.state.replaced).toEqual([]);
    expect(h.snapshot().message?.msg.key).toBe('profileForm.changed');
  });

  it('puts the tab back as it was when the save does not happen', async () => {
    const h = harness({ saveFails: true });
    await h.model.load({ kind: 'user', name: 'my-fanuc.json' });
    h.model.set('editing.tabWidth', 4);
    expect(await h.model.save()).toBe(false);
    expect(h.state.doc?.text).toBe(h.text);
    expect(h.state.doc?.dirty).toBe(false);
    expect(h.snapshot().message?.msg.key).toBe('profileForm.notSaved');
    expect(h.snapshot().dirty).toBe(true);
    expect(h.state.activated).toEqual(['d1']);
  });

  it('refuses a document that kept its old text (a locked tab)', async () => {
    const h = harness({ lock: true });
    await h.model.load({ kind: 'user', name: 'my-fanuc.json' });
    h.model.set('editing.tabWidth', 4);
    expect(await h.model.save()).toBe(false);
    expect(h.state.saves).toBe(0);
    expect(h.snapshot().message?.msg.key).toBe('profileForm.locked');
  });
});

describe('the model: leaving', () => {
  it('asks only when there are unsaved changes', async () => {
    const h = harness({ confirm: false });
    await h.model.load({ kind: 'user', name: 'my-fanuc.json' });
    expect(await h.model.leave()).toBe(true);
    expect(h.state.confirmAsked).toBe(0);
    h.model.set('editing.tabWidth', 4);
    expect(await h.model.leave()).toBe(false);
    expect(h.state.confirmAsked).toBe(1);
  });

  it('does not ask for a built-in profile', async () => {
    const h = harness({ confirm: false });
    await h.model.load({ kind: 'builtin', id: 'fanuc-gcode' });
    expect(await h.model.leave()).toBe(true);
    expect(h.state.confirmAsked).toBe(0);
  });
});

describe('mergeOver', () => {
  it('merges objects and replaces anything else, as the registry does, and drops the schema line', () => {
    const merged = mergeOver({ a: { b: 1, c: 2 }, list: [1], $schema: 'x' }, { a: { c: 3 }, list: [2], $schema: 'y', constructor: 1 });
    expect(merged).toEqual({ a: { b: 1, c: 3 }, list: [2] });
  });
});

describe('the words', () => {
  it('has a message for every text the form shows', () => {
    const keys = [
      'edit', 'category', 'editButton', 'title', 'titleReadOnly', 'loading', 'readOnlyNote', 'duplicate', 'save', 'cancel', 'more', 'less',
      'notSet', 'inherited', 'useParent', 'leaveOut', 'yes', 'no', 'listHint', 'weightsHint', 'badLine', 'addRow', 'removeRow', 'jsonNote',
      'openJson', 'pattern.ok', 'pattern.needsGroup', 'pattern.entry', 'preview.title', 'preview.stale', 'preview.failed', 'noDocument',
      'unknownProfile', 'cannotRead', 'notJson', 'notObject', 'saveFirst', 'changed', 'openFailed', 'lockAction', 'locked', 'notSaved',
      'saved', 'failed', 'problem.noParent', 'leave.title', 'leave.message', 'leave.ok',
    ];
    for (const key of keys) expect(hasKey(`profileForm.${key}`), key).toBe(true);
  });
});

