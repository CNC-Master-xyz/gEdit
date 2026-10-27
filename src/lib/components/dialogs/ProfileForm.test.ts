// The profile form's markup (Phase 4 plan §6.10 rule 7; P4.40). The component is rendered with
// `svelte/server` (no DOM), like the other dialogs: what the runtime scenarios of H4h read — the
// test ids and their attributes — is in the markup. Typing and clicking are those scenarios; the
// model they drive is tested in `app/profileForm.test.ts`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { render } from 'svelte/server';
import { readable } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { formSections, type ProfileFormModel, type ProfileFormState } from '$lib/app/profileForm';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { hasKey } from '$lib/i18n';
import type { Profile } from '$lib/core/profiles/types';
import ProfileForm, { cellFrom, choiceFrom, choiceValue, isScalarSection, splitAdvanced } from './ProfileForm.svelte';

type Obj = Record<string, unknown>;

const schema = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../schemas/profile.schema.json', import.meta.url)), 'utf8')) as Obj;
const parent = (BUILTIN_PROFILE_JSON as unknown as Profile[]).find((p) => p.id === 'fanuc-gcode') as unknown as Obj;

const FILE: Obj = {
  id: 'my-fanuc',
  name: 'My Fanuc',
  shortName: 'MYF',
  version: 1,
  extends: 'fanuc-gcode',
  detect: { content: [{ pattern: '^%', weight: 2 }] },
  editing: { tabWidth: 8, rulers: [72, 80] },
  colors: { dark: { feed: '#ffaa00' } },
};

function stateOf(over: Partial<ProfileFormState> = {}, file: Obj = FILE, builtin = false): ProfileFormState {
  return {
    busy: false,
    open: true,
    fileName: 'my-fanuc.json',
    id: 'my-fanuc',
    parent: 'fanuc-gcode',
    readOnly: builtin,
    sections: formSections({ schema, file, resolved: { ...parent, ...file }, builtin }),
    file,
    dirty: false,
    problems: {},
    loose: [],
    canSave: true,
    preview: parent as unknown as Profile,
    previewProblem: null,
    message: null,
    refusal: null,
    ...over,
  };
}

function modelOf(state: ProfileFormState): ProfileFormModel {
  return {
    state: readable(state),
    load: async () => true,
    set: () => {},
    reset: () => {},
    setColorsValid: () => {},
    save: async () => true,
    leave: async () => true,
  };
}

const markup = (state: ProfileFormState, props: Obj = {}): string => render(ProfileForm, { props: { model: modelOf(state), ...props } }).body;
const tag = (html: string, testid: string, match: string): string => {
  const tags = html.match(new RegExp(`<[a-z]+[^>]*data-testid="${testid}"[^>]*>`, 'g')) ?? [];
  const found = tags.find((entry) => entry.includes(match));
  if (found === undefined) throw new Error(`no ${testid} with ${match}`);
  return found;
};
/** The markup of one field: from its test id to the start of the next field. */
const fieldHtml = (html: string, path: string): string => {
  const start = html.indexOf(`data-path="${path}"`);
  if (start < 0) throw new Error(`no field ${path}`);
  const next = html.indexOf('data-testid="profile-form-field"', start);
  return html.slice(start, next < 0 ? undefined : next);
};
const attr = (element: string, name: string): string | undefined => new RegExp(` ${name}="([^"]*)"`).exec(element)?.[1];

describe('the form’s test ids', () => {
  it('marks the form with the profile, whether it is read-only and whether it has changes', () => {
    const open = markup(stateOf({ dirty: true }));
    const root = tag(open, 'profile-form', 'data-profile');
    expect(attr(root, 'data-profile')).toBe('my-fanuc');
    expect(attr(root, 'data-readonly')).toBe('false');
    expect(attr(root, 'data-dirty')).toBe('true');
    const readOnly = tag(markup(stateOf({ readOnly: true }, FILE, true)), 'profile-form', 'data-profile');
    expect(attr(readOnly, 'data-readonly')).toBe('true');
    expect(attr(readOnly, 'data-dirty')).toBe('false');
  });

  it('has one section per member of the schema order, and one field per setting with its path, kind and whether it is inherited', () => {
    const html = markup(stateOf());
    const sections = [...html.matchAll(/data-testid="profile-form-section" data-section="([^"]+)"/g)].map((m) => m[1]);
    expect(sections.slice(0, 4)).toEqual(['name', 'shortName', 'version', 'machineType']);
    expect(sections).toContain('syntax');
    expect(sections).not.toContain('id');
    const tabWidth = tag(html, 'profile-form-field', 'data-path="editing.tabWidth"');
    expect(attr(tabWidth, 'data-kind')).toBe('integer');
    expect(attr(tabWidth, 'data-inherited')).toBe('false');
    const comments = tag(html, 'profile-form-field', 'data-path="syntax.comments"');
    expect(attr(comments, 'data-kind')).toBe('rows');
    expect(attr(comments, 'data-inherited')).toBe('true');
    expect(attr(comments, 'data-problem')).toBe('');
  });

  it('shows what the profile inherits beside a field the file does not write', () => {
    const html = markup(stateOf());
    expect(html).toContain('data-testid="profile-form-inherited"');
    expect(html).toContain('From fanuc-gcode:');
  });

  it('offers "use the parent’s value" for a member the file writes, and not for one it does not', () => {
    const html = markup(stateOf());
    expect(fieldHtml(html, 'editing.tabWidth')).toContain('data-testid="profile-form-use-parent"');
    expect(fieldHtml(html, 'editing.autoSpace')).not.toContain('profile-form-use-parent');
  });

  it('shows a problem at its field with the message in data-problem', () => {
    const html = markup(stateOf({ problems: { 'editing.tabWidth': ['has to be at most 16'] } }));
    const field = tag(html, 'profile-form-field', 'data-path="editing.tabWidth"');
    expect(attr(field, 'data-problem')).toBe('has to be at most 16');
    expect(html).toContain('has to be at most 16');
  });

  it('mounts the colour editor for the profile’s own colours, with the profile’s feed colour', () => {
    const html = markup(stateOf());
    expect(html).toContain('data-testid="role-colors"');
    expect(html).toContain('data-layer="profile"');
    const row = tag(html, 'role-color-row', 'data-role="feed"');
    expect(attr(row, 'data-layer')).toBe('profile');
  });

  it('puts the live preview beside the fields', () => {
    const html = markup(stateOf());
    expect(html).toContain('data-testid="profile-preview"');
    expect(html).toContain('data-language="_profile-preview"');
    expect(html).not.toContain('data-testid="profile-preview-problem"');
    const stale = markup(stateOf({ previewProblem: 'editing.tabWidth: too big' }));
    expect(stale).toContain('data-testid="profile-preview-problem"');
  });
});

describe('the buttons', () => {
  it('shows Save and Cancel, and Save only when something changed and nothing is wrong', () => {
    const clean = markup(stateOf());
    expect(clean).toContain('data-testid="profile-form-cancel"');
    expect(tag(clean, 'profile-form-save', 'profile-form-save')).toContain('disabled');
    const changed = tag(markup(stateOf({ dirty: true })), 'profile-form-save', 'profile-form-save');
    expect(changed).not.toContain('disabled');
    const wrong = tag(markup(stateOf({ dirty: true, canSave: false })), 'profile-form-save', 'profile-form-save');
    expect(wrong).toContain('disabled');
  });

  it('leaves them out where the dialog has its own footer', () => {
    const html = markup(stateOf(), { buttons: false });
    expect(html).not.toContain('data-testid="profile-form-save"');
    expect(html).not.toContain('data-testid="profile-form-cancel"');
  });

  it('never enables Save for a built-in profile, and offers to duplicate it', () => {
    const state = stateOf({ readOnly: true, dirty: true, canSave: true }, FILE, true);
    const html = markup(state, { onduplicate: () => {} });
    expect(tag(html, 'profile-form-save', 'profile-form-save')).toContain('disabled');
    expect(html).toContain('data-testid="profile-form-readonly"');
    expect(html).toContain('data-testid="profile-form-duplicate"');
    expect(markup(state)).not.toContain('profile-form-duplicate');
  });
});

describe('when the form cannot open', () => {
  it('says why in place of the fields, and still lets the user leave', () => {
    const html = markup(stateOf({ open: false, refusal: { key: 'profileForm.saveFirst', params: { name: 'my-fanuc.json' } }, sections: [] }));
    expect(html).toContain('data-testid="profile-form-refusal"');
    expect(html).toContain('Save or close my-fanuc.json first');
    expect(html).not.toContain('data-testid="profile-form-section"');
    expect(html).toContain('data-testid="profile-form-cancel"');
    expect(tag(html, 'profile-form-save', 'profile-form-save')).toContain('disabled');
  });
});

describe('the json fields', () => {
  it('shows a member the form cannot make plain as written, with "Open as JSON" for a file of the user’s', () => {
    const file: Obj = { ...FILE, compare: { cycleNames: ['(?<name>CYCL)'] } };
    const html = markup(stateOf({}, file), { onopenjson: () => {} });
    const field = tag(html, 'profile-form-field', 'data-path="compare.cycleNames"');
    expect(attr(field, 'data-kind')).toBe('json');
    expect(html).toContain('data-testid="profile-form-json"');
    expect(html).toContain('data-testid="profile-form-open-json"');
    expect(markup(stateOf({}, file))).not.toContain('profile-form-open-json');
    expect(markup(stateOf({ readOnly: true }, file, true), { onopenjson: () => {} })).not.toContain('profile-form-open-json');
  });
});

describe('the helpers of the markup', () => {
  const sections = stateOf().sections;

  it('keeps the advanced settings of a section behind "More"', () => {
    const detect = sections.find((s) => s.id === 'detect')!;
    const { basic, more } = splitAdvanced(detect);
    expect(basic.map((f) => f.path)).toEqual(['detect.extensions', 'detect.content', 'detect.folders']);
    expect(more.map((f) => f.path)).toEqual(['detect.priority', 'detect.vetoes']);
  });

  it('shows a member that is its whole section without a heading', () => {
    expect(isScalarSection(sections.find((s) => s.id === 'name')!)).toBe(true);
    expect(isScalarSection(sections.find((s) => s.id === 'files')!)).toBe(false);
    expect(isScalarSection(sections.find((s) => s.id === 'colors')!)).toBe(true);
  });

  it('reads a choice: nothing selected is "not set", a number choice is a number', () => {
    const decimals = sections.flatMap((s) => s.fields).find((f) => f.path === 'numberFormat.decimals')!;
    expect(choiceValue(decimals)).toBe('');
    expect(choiceFrom(decimals, '')).toBeUndefined();
    expect(choiceFrom(decimals, '3')).toBe(3);
    expect(choiceFrom(decimals, 'keep')).toBe('keep');
    const grammar = sections.flatMap((s) => s.fields).find((f) => f.path === 'grammar')!;
    expect(choiceFrom(grammar, 'iso')).toBe('iso');
    expect(choiceValue({ ...grammar, own: 'iso' })).toBe('iso');
  });

  it('reads a table cell: a number as a number, an empty end as null, anything else as the text', () => {
    const [start, end] = sections.flatMap((s) => s.fields).find((f) => f.path === 'syntax.comments')!.columns!;
    expect(cellFrom(start, '(')).toBe('(');
    expect(cellFrom(end, '')).toBeNull();
    expect(cellFrom(end, ')')).toBe(')');
    const weight = sections.flatMap((s) => s.fields).find((f) => f.path === 'detect.content')!.columns![1];
    expect(cellFrom(weight, '2.5')).toBe(2.5);
    expect(cellFrom(weight, '')).toBe(0);
  });
});

describe('the words', () => {
  it('has a message for every text of the markup', () => {
    for (const key of ['editButton', 'loading', 'readOnlyNote', 'duplicate', 'save', 'cancel', 'more', 'less', 'notSet', 'inherited', 'useParent', 'leaveOut', 'yes', 'no', 'listHint', 'weightsHint', 'badLine', 'addRow', 'removeRow', 'jsonNote', 'openJson', 'pattern.ok', 'pattern.entry', 'preview.title', 'preview.stale', 'preview.failed']) {
      expect(hasKey(`profileForm.${key}`), key).toBe(true);
    }
  });
});
