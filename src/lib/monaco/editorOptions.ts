// Settings → Monaco options (plan WP2.6). Owner: WP2.6.
//
// Two kinds of option, which is why there are two functions:
//   - *editor* options (font, minimap, whitespace, sticky scroll, quick suggestions) go
//     to `editor.updateOptions()` and take effect at once for every model;
//   - *model* options (`tabSize`, `insertSpaces`) live on each `ITextModel`, so they have
//     to be applied to the models that already exist and again in `onDidCreateModel`.
// `installEditorSettings()` subscribes to the settings store and keeps both in step, and
// is the only thing `contrib/theme.ts` has to call.
//
// The theme is NOT set here: `app/theme.ts` owns it, because the choice also drives
// `data-theme` and the native window.
//
// Monaco is only reached through `EditorService`, so this module needs no value import
// of `$lib/monaco/core` and Monaco stays out of the initial bundle. The option object is
// built against Monaco's own types, so a typo is a compile error, and handed on as a
// plain record because that is what `EditorService.updateOptions` takes.

import type * as MonacoApi from 'monaco-editor/esm/vs/editor/editor.api.js';
import { editor as editorService } from '$lib/monaco/editorService';
import { docs as appDocs } from '$lib/stores/documents';
import { profiles as appProfiles } from '$lib/stores/profiles';
import { settings as appSettings } from '$lib/stores/settings';
import type { Settings } from '$lib/core/settings/schema';
import type { ProfileEditing } from '$lib/core/profiles/types';
import type { Disposable, DocId, DocumentStore, EditorService } from '$lib/app/types';
import type { Readable } from 'svelte/store';

/**
 * What `EditorService.updateOptions` takes. `wordBasedSuggestions` lives in
 * `IGlobalEditorOptions` rather than in `IEditorOptions`, so both halves are needed.
 */
type EditorOptions = MonacoApi.editor.IEditorOptions & MonacoApi.editor.IGlobalEditorOptions;

/**
 * `assist.completion`:
 *   - `auto`   suggestions pop up while typing, but not inside a comment or a string:
 *              `(TOOL: 10MM END MILL)` is prose, and `quickSuggestions: true` would make
 *              Monaco offer G-codes in the middle of it
 *   - `manual` only Ctrl+Space opens them
 *   - `off`    no suggestions at all, not even word-based ones
 */
function completionOptions(mode: Settings['assist.completion']): EditorOptions {
  return {
    quickSuggestions:
      mode === 'auto' ? { other: 'on', comments: 'off', strings: 'off' } : false,
    suggestOnTriggerCharacters: mode === 'auto',
    wordBasedSuggestions: mode === 'off' ? 'off' : 'currentDocument',
  };
}

/**
 * The part of a profile these options read (plan §6.10 rule 9, Q4h-4): its own `tabWidth` and
 * `rulers` win over the general settings for the documents of that profile. Absent, the
 * settings apply; an empty `rulers` list is present and means "no ruler".
 */
export type ProfileEditingSource = { editing?: Pick<ProfileEditing, 'tabWidth' | 'rulers'> } | undefined;

/** The rulers a document of `profile` gets: the profile's list when it has one, else the setting's. */
function rulersFor(s: Settings, profile?: ProfileEditingSource): number[] {
  return [...(profile?.editing?.rulers ?? s['editor.rulers'])];
}

/** Everything `updateOptions()` understands, typed so that a wrong name does not compile. */
function typedEditorOptions(s: Settings, profile?: ProfileEditingSource): EditorOptions {
  return {
    fontFamily: s['appearance.editorFontFamily'],
    fontSize: s['appearance.editorFontSize'],
    renderWhitespace: s['editor.renderWhitespace'],
    wordWrap: s['editor.wordWrap'] ? 'on' : 'off',
    minimap: { enabled: s['editor.minimap'] },
    lineNumbers: s['editor.lineNumbers'] ? 'on' : 'off',
    renderLineHighlight: s['editor.highlightCurrentLine'] ? 'line' : 'none',
    // `outlineModel` is what M3's symbol provider feeds; until then Monaco falls back to
    // the indentation model on its own.
    stickyScroll: { enabled: s['editor.stickyScroll'], defaultModel: 'outlineModel' },
    dragAndDrop: s['editor.dragAndDrop'],
    emptySelectionClipboard: s['editor.emptySelectionClipboard'],
    rulers: rulersFor(s, profile),
    hover: { enabled: s['assist.hover'] },
    ...completionOptions(s['assist.completion']),
    // T214: an NC block ends with Enter, so a suggestion is taken with Tab unless asked.
    acceptSuggestionOnEnter: s['assist.acceptOnEnter'] ? 'on' : 'off',
  };
}

/**
 * The `IEditorOptions` that `s` implies, including `stickyScroll` and `quickSuggestions`.
 * With `profile` (the effective profile of the document the editor shows) its `rulers` win.
 */
export function editorOptionsFor(s: Settings, profile?: ProfileEditingSource): Record<string, unknown> {
  return typedEditorOptions(s, profile) as Record<string, unknown>;
}

/**
 * The per-model options that `s` implies (`tabSize`, `insertSpaces`). With `profile` (the
 * document's effective profile) its `tabWidth` wins over `editor.tabWidth`.
 */
export function modelOptionsFor(s: Settings, profile?: ProfileEditingSource): Record<string, unknown> {
  const options: MonacoApi.editor.ITextModelUpdateOptions = {
    tabSize: profile?.editing?.tabWidth ?? s['editor.tabWidth'],
    insertSpaces: s['editor.insertSpaces'],
  };
  return options as Record<string, unknown>;
}

/** What the options need to know about profiles; `revision` changes whenever the profiles are reloaded. */
export interface EditorProfilesView {
  revision: Readable<number>;
  /** The profile with that id, or undefined (a file that was opened under a profile that is gone). */
  profile(id: string): ProfileEditingSource;
}

export interface EditorSettingsDeps {
  values: Readable<Settings>;
  editor: EditorService;
  docs: DocumentStore;
  /** Without it no profile has its own tab width or rulers (the unit tests that predate P4.42). */
  profiles?: EditorProfilesView;
}

const LIVE: EditorSettingsDeps = {
  values: appSettings.values,
  editor: editorService,
  docs: appDocs,
  profiles: {
    revision: appProfiles.revision,
    profile: (id) => (appProfiles.get(id) ? appProfiles.profile(id) : undefined),
  },
};

/**
 * Applies the settings to the editor and to every model, now and on every change.
 *
 * Called once from `contrib/theme.ts`. Three places need the same values:
 *   - the subscription, for a change while the app runs;
 *   - `onDidCreateModel`, for a document opened later;
 *   - `editor.ready`, because the very first subscriber call usually arrives before
 *     `EditorHost` has attached, when there is no editor and no model to update yet.
 *
 * A **re-attach** is not one of them, and must not be: `ready` resolves on the first
 * attach only, so nothing here would fire when the compare overlay unmounts `EditorHost`
 * and mounts it again. `EditorService` replays the last `updateOptions` payload onto the
 * new instance itself (G8 M2); the model options survive because they live on the models,
 * which a re-attach does not touch.
 */
export function installEditorSettings(deps: EditorSettingsDeps = LIVE): Disposable {
  let current: Settings | undefined;
  // What was last written, so that a profile or document change touches only what moved.
  const modelKeys = new Map<DocId, string>();
  const groupKeys = new WeakMap<object, string>();

  function profileOf(id: DocId): ProfileEditingSource {
    const doc = deps.docs.get(id);
    return doc ? deps.profiles?.profile(doc.profileId) : undefined;
  }

  /** One model; `force` writes it even when its options did not change (a settings change always did). */
  function applyModel(id: DocId, s: Settings, force: boolean): void {
    const options = modelOptionsFor(s, profileOf(id));
    const key = JSON.stringify(options);
    if (!force && modelKeys.get(id) === key) return;
    modelKeys.set(id, key);
    deps.editor.model(id)?.updateOptions(options);
  }

  function applyModels(s: Settings, force: boolean): void {
    const live = new Set<DocId>();
    for (const doc of deps.docs.all()) {
      live.add(doc.id);
      applyModel(doc.id, s, force);
    }
    for (const id of modelKeys.keys()) if (!live.has(id)) modelKeys.delete(id);
  }

  /**
   * `rulers` is an editor option, so it follows the group and not the document: each group's
   * editor gets the rulers of the profile of the document it shows now, and the settings'
   * rulers again when that profile has none. Written on the instance, after the shared update.
   */
  function applyGroupRulers(s: Settings, force: boolean): void {
    for (const view of deps.editor.groupViews()) {
      const rulers = editorOptionsFor(s, profileOf(view.docId)).rulers;
      const key = JSON.stringify(rulers);
      if (!force && groupKeys.get(view.editor) === key) continue;
      groupKeys.set(view.editor, key);
      view.editor.updateOptions({ rulers: rulers as number[] });
    }
  }

  function applyAll(s: Settings): void {
    deps.editor.updateOptions(editorOptionsFor(s));
    applyModels(s, true);
    applyGroupRulers(s, true);
  }

  /** A profile reloaded or switched, a document opened or moved to another group: only what differs. */
  function refresh(): void {
    if (!current) return;
    applyModels(current, false);
    applyGroupRulers(current, false);
  }

  const stopValues = deps.values.subscribe((s) => {
    current = s;
    applyAll(s);
  });

  const stopCreate = deps.editor.onDidCreateModel((id) => {
    if (current) applyModel(id, current, true);
  });

  const stops: Disposable[] = [];
  if (deps.profiles) stops.push(deps.profiles.revision.subscribe(refresh));
  // A profile switch changes `profileId` in the document list; a group showing another document
  // changes the group state; a new editor instance (a re-attach) starts from the shared rulers.
  stops.push(deps.docs.list.subscribe(refresh), deps.editor.groups.subscribe(refresh), deps.editor.onDidAttach(refresh));

  // `editor.ready` resolves on the first attach and never rejects; the catch is there so
  // that a future change cannot turn it into an unhandled rejection (the harness counts
  // those as console errors).
  void deps.editor.ready.then(
    () => {
      if (current) applyAll(current);
    },
    () => {},
  );

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    stopValues();
    stopCreate();
    for (const stop of stops) stop();
  };
}
