// The Monaco editors and the models behind the open documents (plan §7.2, AD-5; AD-50 for the groups).
//
// - One model per document, URI `inmemory://doc/<id>`; one `IStandaloneCodeEditor` per editor
//   group (P4e, §6.7): a single group (`g1`), split view (two groups on one or two documents) or
//   the channel view (two to four panes). The group with the keyboard focus is *the* editor:
//   `editorInstance()`, `cursor()`, `insertText()` and the rest act on it, and `docs.activeId`
//   follows its document.
// - The service subscribes to `docs.activeId` when it is created and the focused group follows
//   it synchronously (save the view state, `setModel`, restore the view state), so a `reveal()`
//   straight after `activate()` is safe.
// - Every line number the service takes or answers is a DOCUMENT line (the coordinate rule,
//   §6.7 rule 3); a channel pane is mapped through its `PaneSource`.
// - Text is LF-normalized before a model is created; the model EOL is CRLF for a `crlf`
//   document and LF otherwise, so `lf` and `cr` share one model shape and a CR-only file
//   survives a round trip (the file operations join `getText()` with the document EOL).
// - `textDirty` is `alternativeVersionId !== cleanVersionId` and is pushed into the
//   document store only when that value flips.
// - Every rewrite is one undo step: `pushStackElement`, `pushEditOperations`,
//   `pushStackElement`. `setValue` is used only while a model is being created.
// - `onDidChangeContent` reports ONE spanning `ContentChange` per Monaco event.
// - The cursor callback is throttled to one animation frame.
// - `readOnly` is an editor option, not a model one (M7, AD-23, F32), so the lock of a group's
//   document is applied on every activation and whenever that document is locked or unlocked.
//   `app/fileOps.ts` decides it; this module only puts it on the group's editor.
//
// IMPORTANT: Monaco is reached through `$lib/monaco/setup`, which imports
// `$lib/monaco/core` *dynamically*. Nothing in this module may import `core` for a
// value, or Monaco would land in the initial bundle and be evaluated during prerender
// (`app/context.test.ts` is the tripwire).

import type * as MonacoApi from 'monaco-editor/esm/vs/editor/editor.api.js';
import { writable } from 'svelte/store';
import { getMonaco, type Monaco } from '$lib/monaco/setup';
import { SHARED_EDITOR_OPTIONS } from '$lib/monaco/instanceOptions';
import { docs as appDocs } from '$lib/stores/documents';
import { t } from '$lib/i18n';
import type {
  ContentChange,
  CursorInfo,
  Disposable,
  DocId,
  DocumentStore,
  EditorGroupsState,
  EditorService,
  Eol,
  GroupContent,
  GroupId,
  GroupLayout,
  GroupView,
  PaneSource,
  SelectionLines,
} from '$lib/app/types';

/**
 * Editor construction options: what the editor looks like for the few statements between
 * `create()` and the replay of `updateOptions` below.
 *
 * They are **not** the app's settings. Every value here that a setting also drives
 * (`theme`, `fontSize`, `fontFamily`, `minimap`) is overwritten synchronously at the end
 * of `doAttach`, so these only decide the look of an editor that nobody ever configured —
 * a unit test, or a build without `contrib/theme.ts`. `theme: 'vs-dark'` matches the
 * `FALLBACK` of `app/theme.ts` and the dark palette on `:root` in `app.css`.
 */
const EDITOR_OPTIONS: MonacoApi.editor.IStandaloneEditorConstructionOptions = {
  model: null,
  theme: 'vs-dark',
  automaticLayout: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 14,
  fontFamily: "'Fira Code', 'Consolas', monospace",
  lineNumbersMinChars: 4,
  padding: { top: 16 },
  ...SHARED_EDITOR_OPTIONS,
};

/**
 * P4e (Phase 4 plan AD-50, §6.7 rule 1): the construction options of every group editor after
 * the first. `create()` hands its `theme` to the one standalone theme service (F118), so a second
 * editor built from `EDITOR_OPTIONS` would switch the whole app to `vs-dark` for as long as it
 * takes the replay to put the user's theme back; a group editor gets no `theme` at all and renders
 * in the theme in force. Everything else is the same as the first editor's.
 */
export const GROUP_EDITOR_OPTIONS: MonacoApi.editor.IStandaloneEditorConstructionOptions = (() => {
  const { theme: _theme, ...rest } = EDITOR_OPTIONS;
  void _theme;
  return rest;
})();

/** P4e (AD-50): the most groups at once: the channel view's cap; split view has exactly two. */
export const MAX_GROUPS = 4;

/** P4e: the first group; it always exists, and `attach(c)` is `attachGroup(FIRST_GROUP, c)`. */
export const FIRST_GROUP: GroupId = 'g1';

/** A document whose model exists. */
interface ModelEntry {
  model: MonacoApi.editor.ITextModel;
  /** The `alternativeVersionId` the buffer was last loaded or saved at. */
  cleanVersionId: number;
  /** Line count after the previous content event, for the spanning `ContentChange`. */
  lineCount: number;
  /** Removes the content listener. */
  unlisten: () => void;
}

/** A document created before `attach()` had Monaco; realized when the editor appears. */
interface PendingModel {
  textLF: string;
  languageId: string;
  eol: Eol;
}

/**
 * The URI of the Monaco model that holds a document (`inmemory://doc/<id>`).
 *
 * It is the whole of the model → document mapping, and it is a *function* rather than a
 * map because Monaco hands a language provider a model, not a document: hover and
 * completion have to find their way back to the document to ask for its effective profile
 * (AD-31), and they may be called for a model this service never created.
 */
export function modelUri(id: DocId): string {
  return `inmemory://doc/${encodeURIComponent(id)}`;
}

/**
 * The document a Monaco model belongs to, or null for a model that is not a document — a
 * diff side, a scratch model, anything Monaco made for itself. A caller that gets null
 * falls back to the profile's own defaults, which is what a document with no machine uses
 * anyway.
 */
export function docIdOf(model: { uri?: { scheme?: string; authority?: string; path?: string } } | null): DocId | null {
  const uri = model?.uri;
  if (!uri || uri.scheme !== 'inmemory' || uri.authority !== 'doc') return null;
  const path = typeof uri.path === 'string' ? uri.path.replace(/^\//, '') : '';
  if (path === '') return null;
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}

export interface EditorServiceDeps {
  docs: DocumentStore;
  /** Resolves the Monaco namespace. Injected so a test never has to load the real one. */
  loadMonaco: () => Promise<Monaco>;
  /** P4e (§6.7 rule 7): where the undo and redo of a channel pane go; absent, a pane undoes in its own model. */
  paneHistory?: () => PaneHistory | undefined;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for the unit tests)
// ---------------------------------------------------------------------------

/** Monaco's model EOL is irrelevant to the rest of the app: text always travels as LF. */
export function normalizeToLF(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/** The lines of `textLF`, 1-based inclusive and clamped to the text. */
export function linesOf(textLF: string, startLine: number, endLine: number): string[] {
  if (endLine < startLine) return [];
  return sliceLines(textLF.split('\n'), startLine, endLine);
}

/** `linesOf` over text that is split already. */
function sliceLines(lines: readonly string[], startLine: number, endLine: number): string[] {
  if (endLine < startLine) return [];
  const from = Math.max(1, startLine);
  const to = Math.min(lines.length, endLine);
  return from > to ? [] : lines.slice(from - 1, to);
}

/** The fields of `IModelContentChangedEvent` the spanning range is built from. */
export interface ContentEventLike {
  changes: readonly { range: { startLineNumber: number; endLineNumber: number } }[];
  isFlush: boolean;
  versionId: number;
}

/**
 * One spanning `ContentChange` per Monaco event: `[startLine, endLineOld]` in the old
 * document and `[startLine, endLineNew]` in the new one, 1-based and inclusive.
 * A flush (`setValue`) and an EOL-only change (no `changes`) span the whole document.
 *
 * `versionId` is Monaco's monotonic model version, not `alternativeVersionId`: it is a
 * cache marker, and unlike the alternative id it never goes backwards on undo.
 */
export function spanOfChange(
  event: ContentEventLike,
  oldLineCount: number,
  newLineCount: number,
): ContentChange {
  if (event.isFlush || event.changes.length === 0) {
    return {
      startLine: 1,
      endLineOld: Math.max(oldLineCount, 1),
      endLineNew: Math.max(newLineCount, 1),
      flush: event.isFlush,
      versionId: event.versionId,
    };
  }
  let startLine = Number.MAX_SAFE_INTEGER;
  let endLineOld = 1;
  for (const change of event.changes) {
    startLine = Math.min(startLine, change.range.startLineNumber);
    endLineOld = Math.max(endLineOld, change.range.endLineNumber);
  }
  return {
    startLine,
    endLineOld,
    endLineNew: endLineOld + (newLineCount - oldLineCount),
    flush: false,
    versionId: event.versionId,
  };
}

/**
 * The lines a selection covers. A selection that ends in column 1 of a later line does
 * not include that line, which is what the line-based transforms expect.
 */
export function selectionLinesOf(
  startLineNumber: number,
  endLineNumber: number,
  endColumn: number,
  empty: boolean,
): { startLine: number; endLine: number; empty: boolean } {
  const endLine = !empty && endColumn === 1 && endLineNumber > startLineNumber ? endLineNumber - 1 : endLineNumber;
  return { startLine: startLineNumber, endLine, empty };
}

let cancellationGuardInstalled = false;

/**
 * Monaco rejects the promise of its background tokenizer with a `Canceled` error when a
 * model is disposed while a delayed run is still queued (closing a tab right after it was
 * opened). Nothing awaits that promise, so it surfaces as an unhandled rejection and the
 * runtime harness counts it as a console error. VS Code drops canceled errors the same
 * way. Installed once, next to the only Monaco owner in the app.
 */
function installCancellationGuard(): void {
  if (cancellationGuardInstalled || typeof window === 'undefined') return;
  cancellationGuardInstalled = true;
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as { name?: unknown } | null | undefined;
    if (reason && typeof reason === 'object' && reason.name === 'Canceled') event.preventDefault();
  });
}

/** A minimal listener list; `fire` never lets one listener stop the others. */
function emitter<A extends unknown[]>(): {
  add(cb: (...a: A) => void): Disposable;
  fire(...a: A): void;
} {
  const listeners = new Set<(...a: A) => void>();
  return {
    add(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    fire(...a) {
      for (const cb of [...listeners]) {
        try {
          cb(...a);
        } catch (err) {
          console.error('editor listener failed', err);
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

type CodeEditor = MonacoApi.editor.IStandaloneCodeEditor;
type ViewState = MonacoApi.editor.ICodeEditorViewState;

/** The four group slots; `g1` always exists, the others come with split view and the channel view. */
const SLOT_IDS: readonly GroupId[] = ['g1', 'g2', 'g3', 'g4'];

/** The key a group's view state, and a pane in the registry, is kept under. */
function paneKey(docId: DocId, channelId: string): string {
  return `${docId}\u0000${channelId}`;
}

/** What a group shows, as a key for its view states: a document or one channel pane of it. */
function contentKey(content: GroupContent | null): string | null {
  if (content === null) return null;
  return content.kind === 'pane' ? `pane:${paneKey(content.docId, content.channelId)}` : `doc:${content.docId}`;
}

/** One group slot: its content, its editor (while its component is mounted) and its own view states. */
interface GroupRec {
  readonly id: GroupId;
  content: GroupContent | null;
  /** The element the last `attachGroup` was given. */
  element: HTMLElement | undefined;
  attaching: Promise<void> | undefined;
  editor: CodeEditor | undefined;
  disposables: MonacoApi.IDisposable[];
  /** Cursor, scroll and folds per content (§6.7 rule 4): saved when the group shows something else or is detached. */
  viewStates: Map<string, ViewState>;
  /** The key of the content the editor's model belongs to, null while it has none. */
  shownKey: string | null;
  /** The group's own `readOnly` as the editor was last given it (a fresh editor starts at `false`). */
  appliedReadOnly: boolean;
  /** The pane whose `lineNumbers` the editor was last given, null for the shared values. */
  appliedPane: PaneSource | null;
  /** The editor was last given `wordWrap: 'off'` because the channel view is open (a pane or a channel file, §6.7 rule 12). */
  appliedWrapOff: boolean;
  /** The group was given the focus before its editor existed (a new split): the editor takes it when it is built. */
  wantFocus: boolean;
}

/** P4e (§6.7 rule 7): where the undo and redo of a channel pane go; set by `monaco/channelPanes.ts`. */
export interface PaneHistory {
  undo(): void;
  redo(): void;
}

let registeredPaneHistory: PaneHistory | undefined;

/**
 * Only `src/lib/monaco/**` (the channel view, P4.22b): the undo and redo of a channel pane. The
 * editor service cannot import the channel view (it imports the service), so the view registers
 * itself here and `triggerAction('undo' | 'redo')` from a pane goes to it (§6.7 rule 7).
 */
export function registerPaneHistory(history: PaneHistory): Disposable {
  registeredPaneHistory = history;
  return () => {
    if (registeredPaneHistory === history) registeredPaneHistory = undefined;
  };
}

export function createEditorService(deps: EditorServiceDeps): EditorService {
  const { docs } = deps;

  let monaco: Monaco | undefined;

  const models = new Map<DocId, ModelEntry>();
  const pending = new Map<DocId, PendingModel>();
  /**
   * The normalized, split text of a queued model. Reading a queued document line by line
   * (the modal index, the inspector, the outline) would otherwise normalize and split the
   * whole text again for every line; the spec object is replaced whenever its text is, so the
   * entry is never stale.
   */
  const pendingSplit = new WeakMap<PendingModel, string[]>();
  const splitOf = (spec: PendingModel): string[] => {
    let lines = pendingSplit.get(spec);
    if (lines === undefined) {
      lines = normalizeToLF(spec.textLF).split('\n');
      pendingSplit.set(spec, lines);
    }
    return lines;
  };
  /** A queued model with another language or EOL: the text is the same, so is its split. */
  const respec = (id: DocId, spec: PendingModel, patch: Partial<PendingModel>): void => {
    const next = { ...spec, ...patch };
    const split = pendingSplit.get(spec);
    if (split !== undefined) pendingSplit.set(next, split);
    pending.set(id, next);
  };

  // -- the groups (P4e, §6.7) -----------------------------------------------

  const recs: GroupRec[] = SLOT_IDS.map((id) => ({
    id,
    content: null,
    element: undefined,
    attaching: undefined,
    editor: undefined,
    disposables: [],
    viewStates: new Map(),
    shownKey: null,
    appliedReadOnly: false,
    appliedPane: null,
    appliedWrapOff: false,
    wantFocus: false,
  }));
  /** The slots in use are `recs[0 … count - 1]`, in display order; the ids are always `g1 … g<count>`. */
  let count = 1;
  let layout: GroupLayout = 'single';
  let focusedIndex = 0;
  /** The registered channel panes, by `paneKey`. */
  const panes = new Map<string, PaneSource>();

  let currentId: DocId | null = docs.getActiveId();
  recs[0].content = currentId === null ? null : { kind: 'document', docId: currentId };
  let cursorScheduled = false;

  /**
   * Every option ever handed to `updateOptions`, shallow-merged, so that a new editor
   * instance can be brought back to the state the old one was in (G8 M2).
   *
   * `attach()` runs more than once: the compare overlay unmounts `EditorHost` and mounts
   * it again, and `doAttach` then builds a **second** `IStandaloneCodeEditor` from
   * `EDITOR_OPTIONS`. Without this replay the user's theme and every settings-driven
   * editor option silently fell back to the construction defaults until the next settings
   * change — and because `create()` feeds its `theme` to the *global* standalone theme
   * service, the whole app went back to `vs-dark`.
   *
   * The subscribers cannot do it themselves: `installEditorSettings` and `setMonacoTheme`
   * hang off `ready`, which resolves on the FIRST attach only. Keeping the payload here is
   * what makes the re-apply attach-scoped instead of first-attach-scoped.
   */
  let appliedOptions: Record<string, unknown> = {};

  const contentEvent = emitter<[DocId, ContentChange]>();
  const cursorEvent = emitter<[CursorInfo]>();
  const createEvent = emitter<[DocId]>();
  const activateEvent = emitter<[DocId | null]>();
  const attachEvent = emitter<[]>();
  const focusGroupEvent = emitter<[GroupId]>();

  const groupsStore = writable<EditorGroupsState>(stateNow());
  let groupsNow = stateNow();

  function stateNow(): EditorGroupsState {
    return {
      layout,
      groups: recs.slice(0, count).map((rec) => ({ id: rec.id, content: rec.content })),
      focused: recs[focusedIndex].id,
    };
  }

  function publishGroups(): void {
    groupsNow = stateNow();
    groupsStore.set(groupsNow);
  }

  let markReady: () => void = () => {};
  /**
   * Resolves on the FIRST successful attach of the first group and never rejects: a failed
   * attach is not the end of the story. A transient chunk-load failure, an HMR reload, or — from
   * M2 on — EditorHost being unmounted and remounted by the compare overlay all lead to another
   * `attach()`, and the one that works has to be able to settle this promise. Rejecting
   * it on the first failure made that impossible, so `installMonacoBridge` never ran and
   * `data-ready` stayed "0" behind a perfectly usable editor.
   *
   * The failure itself is not swallowed: `attach()` rejects to its caller and EditorHost
   * shows the load error.
   */
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });

  // -- models ---------------------------------------------------------------

  /** Monaco, or a hard failure: the callers below only run once it is loaded. */
  function api(): Monaco {
    if (!monaco) throw new Error('editor: Monaco is not loaded');
    return monaco;
  }

  function eolSequence(eol: Eol): MonacoApi.editor.EndOfLineSequence {
    const { editor: ed } = api();
    return eol === 'crlf' ? ed.EndOfLineSequence.CRLF : ed.EndOfLineSequence.LF;
  }

  function syncDirty(id: DocId, entry: ModelEntry): void {
    const textDirty = entry.model.getAlternativeVersionId() !== entry.cleanVersionId;
    if (docs.get(id)?.textDirty !== textDirty) docs.update(id, { textDirty });
  }

  function realize(id: DocId, spec: PendingModel): ModelEntry {
    const monacoApi = api();
    const uri = monacoApi.Uri.parse(modelUri(id));
    // A model for this URI can survive a hot reload; Monaco refuses a duplicate URI.
    monacoApi.editor.getModel(uri)?.dispose();
    const model = monacoApi.editor.createModel(normalizeToLF(spec.textLF), spec.languageId, uri);
    model.setEOL(eolSequence(spec.eol));
    const entry: ModelEntry = {
      model,
      cleanVersionId: model.getAlternativeVersionId(),
      lineCount: model.getLineCount(),
      unlisten: () => {},
    };
    const listener = model.onDidChangeContent((event) => {
      const newLineCount = model.getLineCount();
      const change = spanOfChange(event, entry.lineCount, newLineCount);
      entry.lineCount = newLineCount;
      syncDirty(id, entry);
      contentEvent.fire(id, change);
    });
    entry.unlisten = () => listener.dispose();
    models.set(id, entry);
    return entry;
  }

  function disposeModel(id: DocId): void {
    pending.delete(id);
    const entry = models.get(id);
    for (const rec of recs) {
      rec.viewStates.delete(`doc:${id}`);
      if (entry && rec.editor && rec.editor.getModel() === entry.model) {
        rec.editor.setModel(null);
        rec.shownKey = null;
      }
    }
    if (!entry) return;
    entry.unlisten();
    entry.model.dispose();
    models.delete(id);
  }

  // -- what a group shows ---------------------------------------------------

  function paneOf(rec: GroupRec): PaneSource | null {
    return rec.content?.kind === 'pane' ? (panes.get(paneKey(rec.content.docId, rec.content.channelId)) ?? null) : null;
  }

  function modelOf(content: GroupContent | null): MonacoApi.editor.ITextModel | null {
    if (content === null) return null;
    if (content.kind === 'pane') return panes.get(paneKey(content.docId, content.channelId))?.model() ?? null;
    return models.get(content.docId)?.model ?? null;
  }

  function saveShown(rec: GroupRec): void {
    const ed = rec.editor;
    if (!ed || rec.shownKey === null || ed.getModel() === null) return;
    const state = ed.saveViewState();
    if (state) rec.viewStates.set(rec.shownKey, state);
  }

  /** The group's own options (§6.7 rule 1): a closed list, applied on the instance and never through the service's `updateOptions`. */
  function paneOptions(pane: PaneSource | null, wrapOff: boolean): Record<string, unknown> {
    // Word wrap is off in every group of the channel view, so that one line is one row and the
    // filler zones line the panes up in rows (a pane of a program and a channel file alike); the
    // user's setting comes back with the next layout.
    const wordWrap = wrapOff ? 'off' : (appliedOptions.wordWrap ?? 'off');
    if (pane === null) return { lineNumbers: appliedOptions.lineNumbers ?? 'on', wordWrap };
    return { lineNumbers: appliedOptions.lineNumbers === 'off' ? 'off' : (line: number) => String(pane.docLine(line)), wordWrap };
  }

  /**
   * `readOnly` is an **editor** option, not a model one (M7, AD-23, F32), and now a group's: the
   * lock of the group's document is re-decided whenever the group shows another document and
   * whenever that document is locked or unlocked. It runs in the same synchronous block as
   * `setModel`, so there is never a paint in which a locked program sits in an editable editor.
   * `appliedReadOnly` starts as `false` because that is what the construction options leave
   * Monaco at; a fresh editor resets it.
   *
   * `updateOptions` is called on the instance and not through the service's own, which would put
   * the lock into the replayed `appliedOptions` and make a later editor start read-only for
   * whatever document it happens to show.
   */
  function applyOverrides(rec: GroupRec): void {
    const ed = rec.editor;
    if (!ed) return;
    const pane = paneOf(rec);
    const readOnly = (rec.content !== null && docs.get(rec.content.docId)?.readOnly === true) || pane?.readOnly === true;
    if (readOnly !== rec.appliedReadOnly) {
      rec.appliedReadOnly = readOnly;
      ed.updateOptions({ readOnly, readOnlyMessage: { value: t('readOnly.editorMessage') } });
    }
    const wrapOff = layout === 'channels';
    if (pane !== rec.appliedPane || wrapOff !== rec.appliedWrapOff) {
      rec.appliedPane = pane;
      rec.appliedWrapOff = wrapOff;
      ed.updateOptions(paneOptions(pane, wrapOff));
    }
  }

  /**
   * A standalone editor's `updateOptions` writes every option into the one shared configuration
   * service (`standaloneCodeEditor.js` → `updateConfigurationService`), so the group that wrote
   * last would decide another group's look. After each shared update every group's own
   * overrides are therefore put back (§6.7 rule 1, §7 #381). With one editor there is no other
   * group to disturb.
   */
  function reapplyOverrides(): void {
    const live = recs.slice(0, count).filter((rec) => rec.editor !== undefined);
    if (live.length < 2) return;
    for (const rec of live) {
      rec.editor?.updateOptions({
        readOnly: rec.appliedReadOnly,
        readOnlyMessage: { value: t('readOnly.editorMessage') },
        ...(rec.appliedPane === null && !rec.appliedWrapOff ? {} : paneOptions(rec.appliedPane, rec.appliedWrapOff)),
      });
    }
  }

  /**
   * Puts the group's content into its editor, synchronously: the view state of what it showed is
   * saved, the model is set, the state of the new content is restored and the group's own
   * options follow. A group without an editor (its component is not mounted) only keeps the
   * content; `attachGroup` does this when the editor is built.
   */
  function showContent(rec: GroupRec): void {
    const ed = rec.editor;
    if (!ed) return;
    const key = contentKey(rec.content);
    const model = modelOf(rec.content);
    const switching = rec.shownKey !== key;
    if (switching) saveShown(rec);
    if (ed.getModel() !== model) ed.setModel(model);
    rec.shownKey = model === null ? null : key;
    if (switching && model !== null && key !== null) {
      const state = rec.viewStates.get(key);
      if (state) ed.restoreViewState(state);
    }
    applyOverrides(rec);
  }

  function setContent(rec: GroupRec, content: GroupContent | null): void {
    rec.content = content;
    publishGroups();
    showContent(rec);
    scheduleCursor();
  }

  /** The document of the group's content (a pane's is its program). */
  const docOf = (rec: GroupRec): DocId | null => rec.content?.docId ?? null;

  // -- layouts --------------------------------------------------------------

  /**
   * The one place a layout changes: split view, the channel view, closing a group and back to
   * `single` all come through here. `contents[i]` goes to the slot `g<i + 1>`, so the ids stay
   * `g1 … g<n>` and a closed group's content moves up. A content that moves to another slot takes
   * its view state with it (a new split starts at the cursor and scroll of the group it came from).
   */
  function applyLayout(next: GroupLayout, contents: (GroupContent | null)[], focus: number): void {
    const moved = new Map<string, { slot: number; state: ViewState }>();
    // The focused group last, so that its state wins for a document that two groups show.
    const order = recs.slice(0, count).map((_, i) => i);
    order.sort((a, b) => Number(a === focusedIndex) - Number(b === focusedIndex));
    for (const i of order) {
      const rec = recs[i];
      saveShown(rec);
      const key = rec.shownKey ?? contentKey(rec.content);
      const state = key === null ? undefined : rec.viewStates.get(key);
      if (key !== null && state) moved.set(key, { slot: i, state });
    }
    for (let i = 0; i < recs.length; i++) {
      const rec = recs[i];
      if (i < contents.length) {
        rec.content = contents[i];
        const key = contentKey(rec.content);
        const from = key === null ? undefined : moved.get(key);
        if (key !== null && from && from.slot !== i) {
          rec.viewStates.set(key, from.state);
          // The slot may show this very document already (split view of one document): its editor
          // then keeps its own cursor unless `showContent` is made to restore the state that moved in.
          // Everything was saved above, so forgetting what is shown saves nothing over it.
          rec.shownKey = null;
        }
      } else {
        rec.content = null;
        rec.wantFocus = false;
        rec.viewStates.clear();
        if (rec.editor) {
          // The component is unmounted by the host, which then detaches the group; until
          // then the editor shows nothing.
          rec.editor.setModel(null);
          rec.shownKey = null;
        }
      }
    }
    count = Math.max(contents.length, 1);
    layout = next;
    focusedIndex = Math.min(Math.max(focus, 0), count - 1);
    publishGroups();
    for (let i = 0; i < count; i++) showContent(recs[i]);
    const focused = recs[focusedIndex];
    const docId = docOf(focused);
    if (docId !== null && docs.getActiveId() !== docId) docs.activate(docId);
    focusGroupEvent.fire(focused.id);
    scheduleCursor();
  }

  /** The cursor's line in document lines, or null without an editor. */
  function cursorDocLine(rec: GroupRec): number | null {
    const position = rec.editor?.getPosition();
    if (!position) return null;
    const pane = paneOf(rec);
    return pane === null ? position.lineNumber : pane.docLine(position.lineNumber);
  }

  /** Back to one editor showing the program of `survivor`; a pane's cursor goes to its document line. */
  function collapseTo(survivor: GroupRec): void {
    const content = survivor.content;
    if (content === null) {
      applyLayout('single', [null], 0);
      return;
    }
    const line = content.kind === 'pane' ? cursorDocLine(survivor) : null;
    applyLayout('single', [{ kind: 'document', docId: content.docId }], 0);
    const ed = recs[0].editor;
    const model = ed?.getModel();
    if (ed && model && line !== null) {
      const lineNumber = Math.min(Math.max(line, 1), model.getLineCount());
      ed.setPosition({ lineNumber, column: 1 });
      ed.revealLineInCenter(lineNumber);
    }
  }

  function setFocus(index: number, o: { focusEditor?: boolean } = {}): void {
    if (index < 0 || index >= count) return;
    const changed = index !== focusedIndex;
    focusedIndex = index;
    const rec = recs[index];
    if (changed) publishGroups();
    const docId = docOf(rec);
    if (docId !== null && docs.getActiveId() !== docId) docs.activate(docId);
    if (changed) {
      focusGroupEvent.fire(rec.id);
      scheduleCursor();
    }
    if (o.focusEditor) {
      if (rec.editor) rec.editor.focus();
      else rec.wantFocus = true;
    }
  }

  /** The group (index) and line that show document line `line` of `id`: the focused group first, then display order. */
  function locate(id: DocId, line: number): { index: number; line: number } | null {
    const order = [focusedIndex, ...recs.slice(0, count).map((_, i) => i).filter((i) => i !== focusedIndex)];
    for (const index of order) {
      const rec = recs[index];
      const content = rec.content;
      if (content === null || content.docId !== id || !rec.editor) continue;
      if (content.kind === 'pane') {
        const paneLine = panes.get(paneKey(content.docId, content.channelId))?.paneLine(line);
        if (paneLine === null || paneLine === undefined) continue;
        return { index, line: paneLine };
      }
      if (rec.editor.getModel() !== null) return { index, line };
    }
    return null;
  }

  /** Shows `id` where the user can see it if no group does (the active document is shown by the focused group), then finds `line`. */
  function locateOrActivate(id: DocId, line: number): { index: number; line: number } | null {
    let at = locate(id, line);
    if (at === null && docs.getActiveId() !== id) {
      docs.activate(id);
      at = locate(id, line);
    }
    return at;
  }

  /**
   * A document that was closed while a group showed it (§6.7 rule 8): in split view the group
   * shows the document the store made active, and split view with one document twice is `single`
   * again; in the channel view the pane of a closed channel document closes, and the view with
   * fewer than two panes is `single`. Idempotent; runs after every change of the document list
   * and of the active document, because the store publishes the list first.
   */
  function reconcile(): void {
    if (layout === 'single') return;
    const gone = (rec: GroupRec): boolean => rec.content !== null && docs.get(rec.content.docId) === undefined;
    const used = recs.slice(0, count);
    if (!used.some(gone)) return;
    if (layout === 'channels') {
      const keep = used.filter((rec) => !gone(rec));
      if (keep.length >= 2) {
        const focused = recs[focusedIndex];
        const at = keep.indexOf(focused);
        applyLayout('channels', keep.map((rec) => rec.content), at >= 0 ? at : 0);
        return;
      }
      const active = docs.getActiveId();
      const survivor = keep[0];
      if (survivor) collapseTo(survivor);
      else if (active !== null && docs.get(active) !== undefined) applyLayout('single', [{ kind: 'document', docId: active }], 0);
      return;
    }
    const active = docs.getActiveId();
    if (active === null || docs.get(active) === undefined) return; // the store has not made one active yet
    const contents = used.map((rec): GroupContent | null => (gone(rec) ? { kind: 'document', docId: active } : rec.content));
    if (contents.every((c) => c?.docId === active)) {
      applyLayout('single', [contents[focusedIndex]], 0);
      return;
    }
    applyLayout(layout, contents, focusedIndex);
  }

  /** The active document changed (a tab, the focused group, a close): the focused group follows it. */
  function onActive(id: DocId | null): void {
    if (id === currentId) return;
    currentId = id;
    const rec = recs[focusedIndex];
    if (layout === 'single') {
      setContent(rec, id === null ? null : { kind: 'document', docId: id });
    } else if (id === null) {
      applyLayout('single', [null], 0);
    } else if (docOf(rec) !== id) {
      const other = recs.slice(0, count).findIndex((r) => docOf(r) === id);
      if (other >= 0) setFocus(other);
      else if (layout === 'channels') applyLayout('single', [{ kind: 'document', docId: id }], 0);
      else setContent(rec, { kind: 'document', docId: id });
    }
    reconcile();
    activateEvent.fire(id);
  }

  // The subscription fires immediately with the current value; `currentId` was seeded
  // from the same store, so that first call is a no-op.
  docs.activeId.subscribe(onActive);

  // `fileOps.setReadOnly` changes the document without changing which one is active, and
  // the lock has to follow it at once — the tab already shows the padlock. `applyOverrides`
  // compares against what the editor was last given, so the rest of the traffic on this
  // store (every dirty flip) costs one comparison per group.
  docs.list.subscribe(() => {
    for (let i = 0; i < count; i++) applyOverrides(recs[i]);
    reconcile();
  });

  // -- cursor ---------------------------------------------------------------

  function cursor(): CursorInfo | null {
    const rec = recs[focusedIndex];
    const instance = rec.editor;
    if (!instance) return null;
    const model = instance.getModel();
    const position = instance.getPosition();
    if (!model || !position) return null;
    const selections = instance.getSelections() ?? [];
    const lf = monaco?.editor.EndOfLinePreference.LF;
    let selectedChars = 0;
    for (const selection of selections) {
      // Counted in LF, like `getText()`: a CRLF model must not inflate the count.
      if (!selection.isEmpty()) selectedChars += model.getValueLengthInRange(selection, lf);
    }
    const pane = paneOf(rec);
    return {
      line: pane === null ? position.lineNumber : pane.docLine(position.lineNumber),
      column: position.column,
      selectedChars,
      selections: Math.max(selections.length, 1),
    };
  }

  function scheduleCursor(): void {
    if (cursorScheduled) return;
    cursorScheduled = true;
    const emit = (): void => {
      cursorScheduled = false;
      const info = cursor();
      if (info) cursorEvent.fire(info);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(emit);
    else queueMicrotask(emit);
  }

  // -- attach ---------------------------------------------------------------

  function disposeEditor(rec: GroupRec): void {
    for (const disposable of rec.disposables.splice(0)) disposable.dispose();
    rec.editor?.dispose();
    rec.editor = undefined;
    rec.shownKey = null;
    rec.appliedReadOnly = false;
    rec.appliedPane = null;
    rec.appliedWrapOff = false;
  }

  async function doAttach(rec: GroupRec, element: HTMLElement): Promise<void> {
    const loaded = await deps.loadMonaco();
    if (rec.element !== element) return; // superseded while Monaco was loading
    monaco = loaded;
    installCancellationGuard();
    // A fresh editor starts from the construction options: the view state of what the old one
    // showed is kept, and comes back below.
    if (rec.editor) {
      saveShown(rec);
      disposeEditor(rec);
    }
    // §6.7 rule 1: the first editor of the window keeps `EDITOR_OPTIONS` (its `theme` is the
    // fallback of a build without `contrib/theme.ts`); every other one is built without a theme.
    const first = !recs.some((other) => other.editor !== undefined);
    const instance = loaded.editor.create(element, first ? EDITOR_OPTIONS : GROUP_EDITOR_OPTIONS);
    rec.editor = instance;
    // In the same synchronous block as `create`, so nothing is ever painted with the
    // construction defaults over the user's settings (see `appliedOptions`).
    const replay = first ? appliedOptions : withoutTheme(appliedOptions);
    if (Object.keys(replay).length > 0) {
      instance.updateOptions(replay as MonacoApi.editor.IEditorOptions & MonacoApi.editor.IGlobalEditorOptions);
    }
    rec.disposables.push(
      instance.onDidChangeCursorPosition(scheduleCursor),
      instance.onDidChangeCursorSelection(scheduleCursor),
      instance.onDidFocusEditorText(() => {
        const index = recs.indexOf(rec);
        if (index >= 0 && index < count) setFocus(index);
      }),
    );
    for (const [id, spec] of [...pending]) {
      pending.delete(id);
      realize(id, spec);
      // Same event as `createModel`: "there is now a real model for this id". A listener
      // that keys cached work on the model — the program map today, M3's OutlineIndex —
      // has to hear about the models that were queued before Monaco arrived too, because
      // a fresh model restarts `alternativeVersionId`.
      createEvent.fire(id);
    }
    rec.shownKey = null;
    rec.appliedReadOnly = false; // a fresh instance starts from the construction options
    rec.appliedPane = null;
    rec.appliedWrapOff = false;
    showContent(rec);
    scheduleCursor();
    if (rec.id === FIRST_GROUP) markReady();
    attachEvent.fire();
    if (rec.wantFocus) {
      rec.wantFocus = false;
      if (recs.indexOf(rec) === focusedIndex) instance.focus();
    }
  }

  function withoutTheme(options: Record<string, unknown>): Record<string, unknown> {
    const { theme: _theme, ...rest } = options;
    void _theme;
    return rest;
  }

  function attachGroup(id: GroupId, element: HTMLElement): Promise<void> {
    const rec = recs.find((r) => r.id === id);
    if (!rec) return Promise.reject(new RangeError(`editor groups: there is no group ${id}`));
    if (rec.element === element && rec.attaching) return rec.attaching;
    rec.element = element;
    rec.attaching = doAttach(rec, element).catch((err: unknown) => {
      // Forget the failed attempt, so a remount of the same element tries again.
      if (rec.element === element) {
        rec.element = undefined;
        rec.attaching = undefined;
      }
      throw err;
    });
    return rec.attaching;
  }

  function detachGroup(id: GroupId): void {
    const rec = recs.find((r) => r.id === id);
    if (!rec) return;
    rec.element = undefined;
    rec.attaching = undefined;
    if (rec.editor) {
      saveShown(rec);
      disposeEditor(rec);
    }
  }

  function closeGroup(id: GroupId): void {
    const index = recs.slice(0, count).findIndex((rec) => rec.id === id);
    if (index < 0 || count === 1) return;
    const remaining = recs.slice(0, count).filter((_, i) => i !== index);
    const focus = index === focusedIndex ? Math.max(0, index - 1) : focusedIndex > index ? focusedIndex - 1 : focusedIndex;
    if (remaining.length === 1) {
      collapseTo(remaining[0]);
      return;
    }
    applyLayout('channels', remaining.map((rec) => rec.content), focus);
  }

  function closeGroups(): void {
    if (count === 1) return;
    collapseTo(recs[focusedIndex]);
  }

  function focusedEditor(): CodeEditor | undefined {
    return recs[focusedIndex].editor;
  }

  return {
    attach(element: HTMLElement): Promise<void> {
      return attachGroup(FIRST_GROUP, element);
    },

    ready,

    createModel(id: DocId, textLF: string, languageId: string, eol: Eol): void {
      disposeModel(id);
      const spec: PendingModel = { textLF, languageId, eol };
      if (monaco) {
        const entry = realize(id, spec);
        // A fresh model of a shown document goes straight into the groups that show it; there
        // is no view state to save or restore, so this is not a `showContent` switch.
        for (const rec of recs) {
          if (rec.editor && rec.content?.kind === 'document' && rec.content.docId === id) {
            rec.editor.setModel(entry.model);
            rec.shownKey = contentKey(rec.content);
          }
        }
        if (id === currentId) scheduleCursor();
      } else {
        pending.set(id, spec);
      }
      createEvent.fire(id);
    },

    disposeModel,

    hasModel(id: DocId): boolean {
      return models.has(id) || pending.has(id);
    },

    getText(id: DocId): string {
      const entry = models.get(id);
      if (entry && monaco) return entry.model.getValue(monaco.editor.EndOfLinePreference.LF);
      return normalizeToLF(pending.get(id)?.textLF ?? '');
    },

    getLineCount(id: DocId): number {
      const entry = models.get(id);
      if (entry) return entry.model.getLineCount();
      const spec = pending.get(id);
      return spec ? splitOf(spec).length : 0;
    },

    getLines(id: DocId, startLine: number, endLine: number): string[] {
      const entry = models.get(id);
      if (!entry) {
        const spec = pending.get(id);
        return spec ? sliceLines(splitOf(spec), startLine, endLine) : [];
      }
      const last = entry.model.getLineCount();
      const from = Math.max(1, startLine);
      const to = Math.min(last, endLine);
      // The whole document (the channel resolution, a split, a check) in one pass over the
      // text instead of one tree walk per line.
      if (from === 1 && to === last) return entry.model.getLinesContent();
      const lines: string[] = [];
      for (let line = from; line <= to; line++) lines.push(entry.model.getLineContent(line));
      return lines;
    },

    versionId(id: DocId): number {
      return models.get(id)?.model.getAlternativeVersionId() ?? 0;
    },

    markClean(id: DocId): void {
      const entry = models.get(id);
      if (!entry) return; // a pending model is clean by construction
      entry.cleanVersionId = entry.model.getAlternativeVersionId();
      syncDirty(id, entry);
    },

    recheckDirty(id: DocId): void {
      const entry = models.get(id);
      if (entry) syncDirty(id, entry);
    },

    setLanguage(id: DocId, languageId: string): void {
      const spec = pending.get(id);
      if (spec) {
        respec(id, spec, { languageId });
        return;
      }
      const entry = models.get(id);
      if (entry && monaco) monaco.editor.setModelLanguage(entry.model, languageId);
    },

    setModelEol(id: DocId, eol: Eol): void {
      const spec = pending.get(id);
      if (spec) {
        respec(id, spec, { eol });
        return;
      }
      const entry = models.get(id);
      if (entry && monaco) entry.model.pushEOL(eolSequence(eol));
    },

    replaceAll(id: DocId, textLF: string, o?: { keepCursorLine?: boolean }): void {
      const spec = pending.get(id);
      if (spec) {
        pending.set(id, { ...spec, textLF });
        return;
      }
      const entry = models.get(id);
      if (!entry) return;
      const model = entry.model;
      // The cursor of the focused group, when it shows this document itself (a pane has its own lines).
      const focused = recs[focusedIndex];
      const keepLine =
        o?.keepCursorLine && focused.content?.kind === 'document' && focused.content.docId === id
          ? focused.editor?.getPosition()?.lineNumber
          : undefined;
      model.pushStackElement();
      model.pushEditOperations(
        null,
        [{ range: model.getFullModelRange(), text: normalizeToLF(textLF) }],
        () => null,
      );
      model.pushStackElement();
      const instance = focused.editor;
      if (keepLine !== undefined && instance) {
        const lineNumber = Math.min(Math.max(keepLine, 1), model.getLineCount());
        instance.setPosition({ lineNumber, column: 1 });
        instance.revealLineInCenterIfOutsideViewport(lineNumber);
      }
    },

    insertText(text: string): void {
      const instance = focusedEditor();
      if (!instance) return;
      const model = instance.getModel();
      if (!model) return;
      const position = instance.getPosition();
      const selections = instance.getSelections() ?? [];
      const ranges =
        selections.length > 0
          ? selections.map((selection) => ({ range: selection, text, forceMoveMarkers: true }))
          : position
            ? [
                {
                  range: {
                    startLineNumber: position.lineNumber,
                    startColumn: position.column,
                    endLineNumber: position.lineNumber,
                    endColumn: position.column,
                  },
                  text,
                  forceMoveMarkers: true,
                },
              ]
            : [];
      if (ranges.length === 0) return;
      model.pushStackElement();
      instance.executeEdits('gedit.insertText', ranges);
      model.pushStackElement();
    },

    insertSnippet(template: string, at?: { line: number; replace: boolean }): void {
      let index = focusedIndex;
      let atLine = at?.line;
      if (at) {
        // A document line, in the group that shows it (the coordinate rule).
        const docId = docOf(recs[focusedIndex]);
        const found = docId === null ? null : locate(docId, Math.trunc(at.line) || 1);
        if (found === null) return;
        index = found.index;
        atLine = found.line;
        if (index !== focusedIndex) setFocus(index);
      }
      const instance = recs[index].editor;
      if (!instance) return;
      const model = instance.getModel();
      if (!model) return;
      // The snippet controller is Monaco's own contribution (`snippetController2`); it is the
      // one place that knows tab stops, placeholders and the indentation of the lines it adds.
      const controller = instance.getContribution('snippetController2') as unknown as { insert(template: string): void } | null;
      if (!controller) return;
      let text = template;
      if (at && atLine !== undefined) {
        const line = Math.min(Math.max(Math.trunc(atLine) || 1, 1), model.getLineCount());
        const end = model.getLineMaxColumn(line);
        if (at.replace) {
          instance.setSelection({ startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: end });
        } else {
          instance.setPosition({ lineNumber: line, column: end });
          text = `\n${template}`;
        }
      }
      model.pushStackElement();
      controller.insert(text);
      model.pushStackElement();
      instance.focus();
    },

    focus(): void {
      focusedEditor()?.focus();
    },

    hasFocus(): boolean {
      return recs.some((rec) => rec.editor?.hasTextFocus() === true);
    },

    reveal(id: DocId, line: number, column?: number): void {
      const at = locateOrActivate(id, line);
      if (at === null) return;
      const rec = recs[at.index];
      const instance = rec.editor;
      const model = instance?.getModel();
      if (!instance || !model) return;
      if (at.index !== focusedIndex) setFocus(at.index);
      const lineNumber = Math.min(Math.max(at.line, 1), model.getLineCount());
      instance.setPosition({ lineNumber, column: column ?? 1 });
      instance.revealLineInCenter(lineNumber);
      instance.focus();
    },

    cursor,

    selectionLines(): SelectionLines | null {
      const rec = recs[focusedIndex];
      const selection = rec.editor?.getSelection();
      if (!selection) return null;
      const lines = selectionLinesOf(
        selection.startLineNumber,
        selection.endLineNumber,
        selection.endColumn,
        selection.isEmpty(),
      );
      const pane = paneOf(rec);
      if (pane === null) return lines;
      // The coordinate rule: the document lines of the first and the last selected pane line, and a
      // flag when those pane lines are not one run of document lines.
      const startLine = pane.docLine(lines.startLine);
      const endLine = pane.docLine(lines.endLine);
      const result: SelectionLines = { startLine, endLine, empty: lines.empty };
      if (endLine - startLine !== lines.endLine - lines.startLine) result.crossesJunction = true;
      return result;
    },

    selectedText(): string {
      const instance = focusedEditor();
      if (!instance || !monaco) return '';
      const model = instance.getModel();
      const selection = instance.getSelection();
      if (!model || !selection || selection.isEmpty()) return '';
      return model.getValueInRange(selection, monaco.editor.EndOfLinePreference.LF);
    },

    triggerAction(actionId: string, payload?: unknown): void {
      const rec = recs[focusedIndex];
      // §6.7 rule 7: a channel pane has no history of its own; its undo and redo are the view's.
      if ((actionId === 'undo' || actionId === 'redo') && paneOf(rec) !== null) {
        const history = deps.paneHistory?.();
        if (history) {
          history[actionId]();
          return;
        }
      }
      rec.editor?.trigger('gedit', actionId, payload);
    },

    /**
     * Puts `searchString` into the find widget's state without showing it. Monaco's
     * "find with arguments" seeds an *empty* search from the word at the cursor and lets
     * that win over its own `searchString` argument; with the state already filled it
     * seeds nothing, so the argument is what stays (M11 fix).
     */
    presetFind(searchString: string): void {
      const controller = focusedEditor()?.getContribution('editor.contrib.findController') as
        | { getState(): { change(changes: { searchString: string }, moveCursor: boolean): void } }
        | null
        | undefined;
      controller?.getState().change({ searchString }, false);
    },

    updateOptions(o: Record<string, unknown>): void {
      // Remembered before it is applied, so an option set while there is no editor (the
      // theme, during startup) still reaches the one that appears later.
      appliedOptions = { ...appliedOptions, ...o };
      let first = true;
      for (const rec of recs) {
        if (!rec.editor) continue;
        // The theme is global; one editor hands it over.
        const payload = first ? o : withoutTheme(o);
        first = false;
        if (Object.keys(payload).length === 0) continue;
        rec.editor.updateOptions(payload as MonacoApi.editor.IEditorOptions & MonacoApi.editor.IGlobalEditorOptions);
      }
      reapplyOverrides();
    },

    onDidChangeContent(cb: (id: DocId, c: ContentChange) => void): Disposable {
      return contentEvent.add(cb);
    },

    onDidChangeCursor(cb: (c: CursorInfo) => void): Disposable {
      return cursorEvent.add(cb);
    },

    onDidCreateModel(cb: (id: DocId) => void): Disposable {
      return createEvent.add(cb);
    },

    onDidActivate(cb: (id: DocId | null) => void): Disposable {
      return activateEvent.add(cb);
    },

    onDidAttach(cb: () => void): Disposable {
      return attachEvent.add(cb);
    },

    model(id: DocId): MonacoApi.editor.ITextModel | undefined {
      return models.get(id)?.model;
    },

    editorInstance(): MonacoApi.editor.IStandaloneCodeEditor | undefined {
      return focusedEditor();
    },

    // -- P4e: editor groups (§6.7) -----------------------------------------------------------

    groups: { subscribe: groupsStore.subscribe },

    groupsState(): EditorGroupsState {
      return groupsNow;
    },

    attachGroup,

    detachGroup,

    openGroups(o: { layout: Exclude<GroupLayout, 'single'>; contents: GroupContent[]; focus?: number }): GroupId[] {
      const { contents } = o;
      if (o.layout === 'channels') {
        if (contents.length < 2 || contents.length > MAX_GROUPS) {
          throw new RangeError(`editor groups: the channel view shows 2 to ${MAX_GROUPS} groups, not ${contents.length}`);
        }
      } else if (contents.length !== 2) {
        throw new RangeError(`editor groups: split view shows exactly 2 groups, not ${contents.length}`);
      }
      for (const content of contents) {
        if (content.kind === 'pane' && !panes.has(paneKey(content.docId, content.channelId))) {
          throw new RangeError(`editor groups: no pane is registered for channel ${content.channelId} of ${content.docId}`);
        }
        if (docs.get(content.docId) === undefined) throw new RangeError(`editor groups: there is no document ${content.docId}`);
      }
      const focus = o.focus ?? 0;
      if (!Number.isInteger(focus) || focus < 0 || focus >= contents.length) {
        throw new RangeError(`editor groups: there is no group ${focus} to focus`);
      }
      applyLayout(o.layout, contents.map((content) => ({ ...content })), focus);
      setFocus(focusedIndex, { focusEditor: true });
      return recs.slice(0, count).map((rec) => rec.id);
    },

    closeGroup,

    closeGroups,

    focusGroup(id: GroupId): void {
      const index = recs.slice(0, count).findIndex((rec) => rec.id === id);
      if (index < 0) return;
      setFocus(index, { focusEditor: true });
    },

    focusNextGroup(dir: 1 | -1): void {
      if (count < 2) {
        focusedEditor()?.focus();
        return;
      }
      setFocus((focusedIndex + dir + count) % count, { focusEditor: true });
    },

    selectLines(id: DocId, startLine: number, endLine: number): void {
      const at = locateOrActivate(id, startLine);
      if (at === null) return;
      const rec = recs[at.index];
      const instance = rec.editor;
      const model = instance?.getModel();
      if (!instance || !model) return;
      if (at.index !== focusedIndex) setFocus(at.index);
      const pane = paneOf(rec);
      let lastWanted = endLine;
      if (pane !== null) {
        // The last of the wanted document lines that the pane shows.
        let paneEnd = pane.paneLine(endLine);
        for (let line = endLine - 1; paneEnd === null && line > startLine; line--) paneEnd = pane.paneLine(line);
        lastWanted = paneEnd ?? at.line;
      }
      const last = model.getLineCount();
      const first = Math.min(Math.max(at.line, 1), last);
      const end = Math.min(Math.max(lastWanted, first), last);
      instance.setSelection({ startLineNumber: first, startColumn: 1, endLineNumber: end, endColumn: model.getLineMaxColumn(end) });
      instance.revealLinesInCenterIfOutsideViewport(first, end);
      instance.focus();
    },

    topLine(): number | null {
      const rec = recs[focusedIndex];
      const top = rec.editor?.getVisibleRanges()[0]?.startLineNumber;
      if (top === undefined) return null;
      const pane = paneOf(rec);
      return pane === null ? top : pane.docLine(top);
    },

    scrollToTop(line: number): void {
      const rec = recs[focusedIndex];
      const instance = rec.editor;
      if (!instance) return;
      const pane = paneOf(rec);
      const target = pane === null ? line : pane.paneLine(line);
      if (target === null) return;
      instance.setScrollTop(instance.getTopForLineNumber(target));
    },

    registerPane(source: PaneSource): Disposable {
      const key = paneKey(source.docId, source.channelId);
      panes.set(key, source);
      // A group that shows this pane again with another model (the pane was registered anew).
      for (let i = 0; i < count; i++) {
        const content = recs[i].content;
        if (content?.kind === 'pane' && paneKey(content.docId, content.channelId) === key) showContent(recs[i]);
      }
      return () => {
        if (panes.get(key) !== source) return;
        panes.delete(key);
        // A group cannot show a pane nobody registered.
        const shown = recs.slice(0, count).find((rec) => rec.content?.kind === 'pane' && paneKey(rec.content.docId, rec.content.channelId) === key);
        if (shown) closeGroup(shown.id);
      };
    },

    groupViews(): GroupView[] {
      const views: GroupView[] = [];
      for (let i = 0; i < count; i++) {
        const rec = recs[i];
        if (!rec.editor || rec.content === null) continue;
        views.push({ id: rec.id, editor: rec.editor, docId: rec.content.docId, pane: paneOf(rec), focused: i === focusedIndex });
      }
      return views;
    },

    onDidFocusGroup(cb: (id: GroupId) => void): Disposable {
      return focusGroupEvent.add(cb);
    },
  };
}

/** The application-wide editor service. */
export const editor: EditorService = createEditorService({
  docs: appDocs,
  loadMonaco: getMonaco,
  paneHistory: () => registeredPaneHistory,
});
