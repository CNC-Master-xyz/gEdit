// Settings → Monaco options (plan WP2.6): the two mappings, and the subscription that
// keeps the editor and every model in step.

import { get, writable } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { editorOptionsFor, installEditorSettings, modelOptionsFor, type EditorProfilesView } from './editorOptions';
import { DEFAULTS, type Settings } from '$lib/core/settings/schema';
import type { Disposable, DocId, DocMeta, DocumentStore, EditorGroupsState, EditorService, GroupView } from '$lib/app/types';

function withSettings(patch: Partial<Settings>): Settings {
  return { ...DEFAULTS, ...patch };
}

describe('editorOptionsFor', () => {
  it('maps the defaults', () => {
    const options = editorOptionsFor(DEFAULTS);
    expect(options.fontSize).toBe(14);
    expect(options.fontFamily).toBe(DEFAULTS['appearance.editorFontFamily']);
    expect(options.minimap).toEqual({ enabled: false });
    expect(options.lineNumbers).toBe('on');
    expect(options.wordWrap).toBe('off');
    expect(options.renderLineHighlight).toBe('line');
    expect(options.renderWhitespace).toBe('none');
    expect(options.dragAndDrop).toBe(false);
    expect(options.emptySelectionClipboard).toBe(true);
    expect(options.rulers).toEqual([]);
    expect(options.hover).toEqual({ enabled: true });
  });

  it('asks for the outline model behind sticky scroll', () => {
    expect(editorOptionsFor(DEFAULTS).stickyScroll).toEqual({
      enabled: true,
      defaultModel: 'outlineModel',
    });
    expect(editorOptionsFor(withSettings({ 'editor.stickyScroll': false })).stickyScroll).toEqual({
      enabled: false,
      defaultModel: 'outlineModel',
    });
  });

  it('turns the booleans into the words Monaco expects', () => {
    const options = editorOptionsFor(
      withSettings({
        'editor.wordWrap': true,
        'editor.lineNumbers': false,
        'editor.highlightCurrentLine': false,
        'editor.minimap': true,
      }),
    );
    expect(options.wordWrap).toBe('on');
    expect(options.lineNumbers).toBe('off');
    expect(options.renderLineHighlight).toBe('none');
    expect(options.minimap).toEqual({ enabled: true });
  });

  it('maps assist.completion onto the three suggest options', () => {
    const auto = editorOptionsFor(withSettings({ 'assist.completion': 'auto' }));
    // Not `true`: Monaco would then also suggest inside `(…)` comments.
    expect(auto.quickSuggestions).toEqual({ other: 'on', comments: 'off', strings: 'off' });
    expect(auto.suggestOnTriggerCharacters).toBe(true);
    expect(auto.wordBasedSuggestions).toBe('currentDocument');

    const manual = editorOptionsFor(withSettings({ 'assist.completion': 'manual' }));
    expect(manual.quickSuggestions).toBe(false);
    expect(manual.suggestOnTriggerCharacters).toBe(false);
    expect(manual.wordBasedSuggestions).toBe('currentDocument');

    const off = editorOptionsFor(withSettings({ 'assist.completion': 'off' }));
    expect(off.quickSuggestions).toBe(false);
    expect(off.wordBasedSuggestions).toBe('off');
  });

  // T214: this was hard-coded in `contrib/assistant.ts`; it is the setting `assist.acceptOnEnter`.
  it('maps assist.acceptOnEnter onto acceptSuggestionOnEnter, off by default', () => {
    expect(DEFAULTS['assist.acceptOnEnter']).toBe(false);
    expect(editorOptionsFor(DEFAULTS).acceptSuggestionOnEnter).toBe('off');
    expect(editorOptionsFor(withSettings({ 'assist.acceptOnEnter': true })).acceptSuggestionOnEnter).toBe('on');
    expect(editorOptionsFor(withSettings({ 'assist.acceptOnEnter': false })).acceptSuggestionOnEnter).toBe('off');
  });

  it('copies the rulers instead of handing out the settings array', () => {
    const values = withSettings({ 'editor.rulers': [80] });
    const options = editorOptionsFor(values);
    (options.rulers as number[]).push(120);
    expect(values['editor.rulers']).toEqual([80]);
  });

  it('leaves the theme to app/theme.ts', () => {
    expect('theme' in editorOptionsFor(DEFAULTS)).toBe(false);
  });
});

describe('modelOptionsFor', () => {
  it('carries the indentation settings only', () => {
    expect(modelOptionsFor(withSettings({ 'editor.tabWidth': 2, 'editor.insertSpaces': false }))).toEqual({
      tabSize: 2,
      insertSpaces: false,
    });
  });
});

// ---------------------------------------------------------------------------
// installEditorSettings
// ---------------------------------------------------------------------------

interface FakeModel {
  updateOptions: (o: Record<string, unknown>) => void;
  options: Record<string, unknown>[];
}

function fakeModel(): FakeModel {
  const options: Record<string, unknown>[] = [];
  return { options, updateOptions: (o) => options.push(o) };
}

interface FakeEditor {
  updateOptions: (o: Record<string, unknown>) => void;
  options: Record<string, unknown>[];
}

function fakeWorld(o: { docIds?: DocId[]; ready?: Promise<void>; profileIds?: Record<DocId, string> } = {}) {
  const models = new Map<DocId, FakeModel>();
  for (const id of o.docIds ?? []) models.set(id, fakeModel());
  const profileIds = new Map<DocId, string>(Object.entries(o.profileIds ?? {}));
  const editorOptions: Record<string, unknown>[] = [];
  let onCreate: ((id: DocId) => void) | undefined;
  let onAttach: (() => void) | undefined;
  const groups = writable<EditorGroupsState>({ layout: 'single', groups: [], focused: 'g1' });
  const shown = new Map<string, { editor: FakeEditor; docId: DocId }>();
  const doc = (id: DocId): DocMeta => ({ id, profileId: profileIds.get(id) ?? 'plain' }) as DocMeta;
  const list = writable<DocMeta[]>([]);
  const publishDocs = () => list.set([...models.keys()].map(doc));

  const editor = {
    ready: o.ready ?? Promise.resolve(),
    updateOptions: (options: Record<string, unknown>) => editorOptions.push(options),
    model: (id: DocId) => models.get(id),
    onDidCreateModel: (cb: (id: DocId) => void): Disposable => {
      onCreate = cb;
      return () => {
        onCreate = undefined;
      };
    },
    onDidAttach: (cb: () => void): Disposable => {
      onAttach = cb;
      return () => {
        onAttach = undefined;
      };
    },
    groups: { subscribe: groups.subscribe },
    groupViews: (): GroupView[] => [...shown].map(([id, v]) => ({ id, editor: v.editor, docId: v.docId, pane: null, focused: false }) as unknown as GroupView),
  } as unknown as EditorService;

  const docs = {
    all: (): DocMeta[] => [...models.keys()].map(doc),
    get: (id: DocId) => (models.has(id) ? doc(id) : undefined),
    list: { subscribe: list.subscribe },
  } as unknown as DocumentStore;

  return {
    editor,
    docs,
    editorOptions,
    models,
    addModel(id: DocId): FakeModel {
      const model = fakeModel();
      models.set(id, model);
      onCreate?.(id);
      return model;
    },
    /** The profile switch: the document's `profileId` changes and the list store emits. */
    setProfile(id: DocId, profileId: string): void {
      profileIds.set(id, profileId);
      publishDocs();
    },
    /** A group editor that shows `docId`; the group state emits. */
    showInGroup(groupId: string, docId: DocId): FakeEditor {
      const existing = shown.get(groupId);
      const fake: FakeEditor = existing?.editor ?? {
        options: [],
        updateOptions(opts) {
          fake.options.push(opts);
        },
      };
      shown.set(groupId, { editor: fake, docId });
      groups.update((g) => ({ ...g }));
      return fake;
    },
    /** A re-attach builds a new editor instance for the group. */
    reattach(groupId: string): FakeEditor {
      const docId = shown.get(groupId)?.docId ?? '';
      shown.delete(groupId);
      const fake = this.showInGroup(groupId, docId);
      onAttach?.();
      return fake;
    },
  };
}

/** A profiles view for the tests: `editing` per profile id, `reload()` bumps the revision. */
function fakeProfiles(table: Record<string, { tabWidth?: number; rulers?: number[] }>) {
  const revision = writable(0);
  const view: EditorProfilesView = {
    revision,
    profile: (id) => (id in table ? { editing: table[id] } : undefined),
  };
  return {
    view,
    reload(next: Record<string, { tabWidth?: number; rulers?: number[] }>): void {
      for (const k of Object.keys(table)) delete table[k];
      Object.assign(table, next);
      revision.update((n) => n + 1);
    },
  };
}

describe('installEditorSettings', () => {
  it('applies the current settings at once, to the editor and to every model', () => {
    const values = writable<Settings>(withSettings({ 'editor.tabWidth': 2 }));
    const world = fakeWorld({ docIds: ['a', 'b'] });
    const stop = installEditorSettings({ values, editor: world.editor, docs: world.docs });

    expect(world.editorOptions).toHaveLength(1);
    expect(world.editorOptions[0]?.fontSize).toBe(14);
    expect(world.models.get('a')?.options).toEqual([{ tabSize: 2, insertSpaces: true }]);
    expect(world.models.get('b')?.options).toEqual([{ tabSize: 2, insertSpaces: true }]);
    stop();
  });

  it('follows a change while the app runs', () => {
    const values = writable<Settings>(DEFAULTS);
    const world = fakeWorld({ docIds: ['a'] });
    const stop = installEditorSettings({ values, editor: world.editor, docs: world.docs });

    values.set(withSettings({ 'appearance.editorFontSize': 18, 'editor.tabWidth': 8 }));
    expect(world.editorOptions.at(-1)?.fontSize).toBe(18);
    expect(world.models.get('a')?.options.at(-1)).toEqual({ tabSize: 8, insertSpaces: true });
    stop();
  });

  it('gives a model created later the same options', () => {
    const values = writable<Settings>(withSettings({ 'editor.insertSpaces': false }));
    const world = fakeWorld();
    const stop = installEditorSettings({ values, editor: world.editor, docs: world.docs });

    const model = world.addModel('late');
    expect(model.options).toEqual([{ tabSize: 4, insertSpaces: false }]);
    stop();
  });

  it('applies the settings again once the editor has attached', async () => {
    let attach: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      attach = resolve;
    });
    const values = writable<Settings>(DEFAULTS);
    const world = fakeWorld({ docIds: ['a'], ready });
    const stop = installEditorSettings({ values, editor: world.editor, docs: world.docs });

    expect(world.editorOptions).toHaveLength(1);
    attach();
    await ready;
    await Promise.resolve();
    expect(world.editorOptions).toHaveLength(2);
    stop();
  });

  it('stops listening when it is disposed, twice is harmless', () => {
    const values = writable<Settings>(DEFAULTS);
    const world = fakeWorld({ docIds: ['a'] });
    const stop = installEditorSettings({ values, editor: world.editor, docs: world.docs });
    stop();
    stop();

    values.set(withSettings({ 'appearance.editorFontSize': 20 }));
    expect(world.editorOptions).toHaveLength(1);
    expect(get(values)['appearance.editorFontSize']).toBe(20);
  });

  it('handles a rejected ready promise instead of leaving it unhandled', async () => {
    const values = writable<Settings>(DEFAULTS);
    // `editor.ready` is contracted never to reject; this is the guard that a change to
    // that contract cannot turn into the unhandled rejection the harness fails on.
    const ready = Promise.reject(new Error('monaco could not be loaded'));
    const world = fakeWorld({ docIds: ['a'], ready });
    const stop = installEditorSettings({ values, editor: world.editor, docs: world.docs });
    await ready.catch(() => {});
    await Promise.resolve();
    expect(world.editorOptions).toHaveLength(1);
    stop();
  });
});

// ---------------------------------------------------------------------------
// P4.42: a profile's own tab width and rulers win (plan §6.10 rule 9, Q4h-4)
// ---------------------------------------------------------------------------

describe('modelOptionsFor with a profile', () => {
  it('lets the profile tab width win over the setting', () => {
    const s = withSettings({ 'editor.tabWidth': 8 });
    expect(modelOptionsFor(s, { editing: { tabWidth: 2 } })).toEqual({ tabSize: 2, insertSpaces: true });
  });

  it('keeps the setting when the profile has no tab width, or no editing block', () => {
    const s = withSettings({ 'editor.tabWidth': 8 });
    expect(modelOptionsFor(s, { editing: {} }).tabSize).toBe(8);
    expect(modelOptionsFor(s, {}).tabSize).toBe(8);
    expect(modelOptionsFor(s, undefined).tabSize).toBe(8);
  });

  it('never takes insertSpaces from the profile', () => {
    expect(modelOptionsFor(withSettings({ 'editor.insertSpaces': false }), { editing: { tabWidth: 3 } })).toEqual({
      tabSize: 3,
      insertSpaces: false,
    });
  });
});

describe('editorOptionsFor with a profile', () => {
  const s = withSettings({ 'editor.rulers': [80] });

  it('replaces the setting rulers with the profile list', () => {
    expect(editorOptionsFor(s, { editing: { rulers: [60, 72] } }).rulers).toEqual([60, 72]);
  });

  it('an empty profile list is present and means no ruler', () => {
    expect(editorOptionsFor(s, { editing: { rulers: [] } }).rulers).toEqual([]);
  });

  it('keeps the setting rulers when the profile has none', () => {
    expect(editorOptionsFor(s, { editing: { tabWidth: 2 } }).rulers).toEqual([80]);
    expect(editorOptionsFor(s, undefined).rulers).toEqual([80]);
  });

  it('copies the profile list instead of handing it out', () => {
    const rulers = [60];
    (editorOptionsFor(s, { editing: { rulers } }).rulers as number[]).push(99);
    expect(rulers).toEqual([60]);
  });
});

describe('installEditorSettings with profiles', () => {
  it('gives each model the tab width of its own profile, now and for a model created later', () => {
    const values = writable<Settings>(withSettings({ 'editor.tabWidth': 8 }));
    const profiles = fakeProfiles({ narrow: { tabWidth: 2 } });
    const world = fakeWorld({ docIds: ['a', 'b'], profileIds: { a: 'narrow', b: 'plain' } });
    const stop = installEditorSettings({ values, editor: world.editor, docs: world.docs, profiles: profiles.view });

    expect(world.models.get('a')?.options.at(-1)).toEqual({ tabSize: 2, insertSpaces: true });
    expect(world.models.get('b')?.options.at(-1)).toEqual({ tabSize: 8, insertSpaces: true });
    const late = world.addModel('c');
    expect(late.options).toEqual([{ tabSize: 8, insertSpaces: true }]);
    stop();
  });

  it('applies again when the document is switched to another profile', () => {
    const values = writable<Settings>(withSettings({ 'editor.tabWidth': 8 }));
    const profiles = fakeProfiles({ narrow: { tabWidth: 2 } });
    const world = fakeWorld({ docIds: ['a'], profileIds: { a: 'plain' } });
    const stop = installEditorSettings({ values, editor: world.editor, docs: world.docs, profiles: profiles.view });
    const model = world.models.get('a');

    world.setProfile('a', 'narrow');
    expect(model?.options.at(-1)).toEqual({ tabSize: 2, insertSpaces: true });
    world.setProfile('a', 'plain');
    expect(model?.options.at(-1)).toEqual({ tabSize: 8, insertSpaces: true });
    stop();
  });

  it('writes a model again only when its options moved', () => {
    const values = writable<Settings>(DEFAULTS);
    const profiles = fakeProfiles({});
    const world = fakeWorld({ docIds: ['a'] });
    const stop = installEditorSettings({ values, editor: world.editor, docs: world.docs, profiles: profiles.view });
    const before = world.models.get('a')?.options.length;

    world.setProfile('a', 'plain');
    expect(world.models.get('a')?.options.length).toBe(before);
    stop();
  });

  it('applies again when the profiles are reloaded', () => {
    const values = writable<Settings>(withSettings({ 'editor.tabWidth': 8 }));
    const profiles = fakeProfiles({ narrow: { tabWidth: 2 } });
    const world = fakeWorld({ docIds: ['a'], profileIds: { a: 'narrow' } });
    const stop = installEditorSettings({ values, editor: world.editor, docs: world.docs, profiles: profiles.view });

    profiles.reload({ narrow: { tabWidth: 3 } });
    expect(world.models.get('a')?.options.at(-1)).toEqual({ tabSize: 3, insertSpaces: true });
    profiles.reload({ narrow: {} });
    expect(world.models.get('a')?.options.at(-1)).toEqual({ tabSize: 8, insertSpaces: true });
    stop();
  });

  it('a document whose profile is gone falls back to the settings', () => {
    const values = writable<Settings>(withSettings({ 'editor.tabWidth': 6 }));
    const world = fakeWorld({ docIds: ['a'], profileIds: { a: 'deleted' } });
    const stop = installEditorSettings({ values, editor: world.editor, docs: world.docs, profiles: fakeProfiles({}).view });
    expect(world.models.get('a')?.options.at(-1)).toEqual({ tabSize: 6, insertSpaces: true });
    stop();
  });

  it('puts the rulers of the shown document on the group editor, and follows the group', () => {
    const values = writable<Settings>(withSettings({ 'editor.rulers': [80] }));
    const profiles = fakeProfiles({ short: { rulers: [60, 72] }, none: { rulers: [] } });
    const world = fakeWorld({ docIds: ['a', 'b', 'c'], profileIds: { a: 'short', b: 'plain', c: 'none' } });
    const stop = installEditorSettings({ values, editor: world.editor, docs: world.docs, profiles: profiles.view });

    const g1 = world.showInGroup('g1', 'a');
    expect(g1.options.at(-1)).toEqual({ rulers: [60, 72] });
    world.showInGroup('g1', 'b');
    expect(g1.options.at(-1)).toEqual({ rulers: [80] });
    world.showInGroup('g1', 'c');
    expect(g1.options.at(-1)).toEqual({ rulers: [] });
    stop();
  });

  it('gives two groups the rulers of their own documents', () => {
    const values = writable<Settings>(withSettings({ 'editor.rulers': [80] }));
    const profiles = fakeProfiles({ short: { rulers: [60] } });
    const world = fakeWorld({ docIds: ['a', 'b'], profileIds: { a: 'short', b: 'plain' } });
    const stop = installEditorSettings({ values, editor: world.editor, docs: world.docs, profiles: profiles.view });

    const g1 = world.showInGroup('g1', 'a');
    const g2 = world.showInGroup('g2', 'b');
    expect(g1.options.at(-1)).toEqual({ rulers: [60] });
    expect(g2.options.at(-1)).toEqual({ rulers: [80] });
    // A settings change writes the shared update and then each group's own rulers again.
    values.set(withSettings({ 'editor.rulers': [100] }));
    expect(g1.options.at(-1)).toEqual({ rulers: [60] });
    expect(g2.options.at(-1)).toEqual({ rulers: [100] });
    stop();
  });

  it('follows a profile switch and a profile reload into the group, and a re-attached editor', () => {
    const values = writable<Settings>(withSettings({ 'editor.rulers': [80] }));
    const profiles = fakeProfiles({ short: { rulers: [60] } });
    const world = fakeWorld({ docIds: ['a'], profileIds: { a: 'plain' } });
    const stop = installEditorSettings({ values, editor: world.editor, docs: world.docs, profiles: profiles.view });

    const g1 = world.showInGroup('g1', 'a');
    expect(g1.options.at(-1)).toEqual({ rulers: [80] });
    world.setProfile('a', 'short');
    expect(g1.options.at(-1)).toEqual({ rulers: [60] });
    profiles.reload({ short: { rulers: [50] } });
    expect(g1.options.at(-1)).toEqual({ rulers: [50] });
    const again = world.reattach('g1');
    expect(again.options.at(-1)).toEqual({ rulers: [50] });
    stop();
  });

  it('stops following when disposed', () => {
    const values = writable<Settings>(DEFAULTS);
    const profiles = fakeProfiles({ short: { rulers: [60] } });
    const world = fakeWorld({ docIds: ['a'], profileIds: { a: 'plain' } });
    const stop = installEditorSettings({ values, editor: world.editor, docs: world.docs, profiles: profiles.view });
    const g1 = world.showInGroup('g1', 'a');
    stop();
    const count = g1.options.length;
    world.setProfile('a', 'short');
    profiles.reload({ short: { rulers: [10] } });
    expect(g1.options.length).toBe(count);
  });
});
