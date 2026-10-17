// Test support for the editor groups (Phase 4 plan §6.7; P4e prelude, extended by P4.21).
//
// `oneGroup()`: the editor-group members of `EditorService` for a hand-written fake editor that has
// one editor and no groups. Spread it into the fake: `{ ...oneGroup(), attach: …, getText: … }`.
// Any group operation beyond the one group throws.
//
// `groupMonaco()`: a fake Monaco namespace with editors that can be focused, positioned and
// scrolled, and models that can be edited, for `createEditorService` (the editor service's group
// tests, and P4.22b's channel pane tests when they want fake editors). Nothing in it is Monaco's
// own logic: it records what the service asked of it.

import { readable } from 'svelte/store';
import type { EditorGroupsState, EditorService, PaneSource } from '$lib/app/types';
import type { Monaco } from '$lib/monaco/setup';

type GroupMembers = Pick<
  EditorService,
  | 'groups'
  | 'groupsState'
  | 'attachGroup'
  | 'detachGroup'
  | 'openGroups'
  | 'closeGroup'
  | 'closeGroups'
  | 'focusGroup'
  | 'focusNextGroup'
  | 'selectLines'
  | 'topLine'
  | 'scrollToTop'
  | 'registerPane'
  | 'groupViews'
  | 'onDidFocusGroup'
>;

const SINGLE: EditorGroupsState = { layout: 'single', groups: [{ id: 'g1', content: null }], focused: 'g1' };

export function oneGroup(): GroupMembers {
  const none = (): never => {
    throw new Error('editor groups are not used here');
  };
  return {
    groups: readable(SINGLE),
    groupsState: () => SINGLE,
    attachGroup: () => Promise.resolve(),
    detachGroup: () => {},
    openGroups: none,
    closeGroup: () => {},
    closeGroups: () => {},
    focusGroup: () => {},
    focusNextGroup: () => {},
    selectLines: () => {},
    topLine: () => null,
    scrollToTop: () => {},
    registerPane: none,
    groupViews: () => [],
    onDidFocusGroup: () => () => {},
  };
}

// ---------------------------------------------------------------------------
// A fake Monaco for the groups
// ---------------------------------------------------------------------------

export interface FakeRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface FakeSelection extends FakeRange {
  isEmpty(): boolean;
}

const EOL_SEQ = { CRLF: 1, LF: 0 };

export interface FakeModel {
  uri: string;
  lines: string[];
  languageId: string;
  disposed: boolean;
  calls: string[];
  version: number;
  getValue(): string;
  getAlternativeVersionId(): number;
  getLineCount(): number;
  getLineContent(line: number): string;
  getLineMaxColumn(line: number): number;
  getLinesContent(): string[];
  getFullModelRange(): FakeRange;
  getValueLengthInRange(): number;
  getValueInRange(): string;
  setEOL(sequence: number): void;
  pushEOL(sequence: number): void;
  pushStackElement(): void;
  pushEditOperations(before: unknown, edits: { text: string }[], after: unknown): null;
  onDidChangeContent(cb: (e: { changes: { range: { startLineNumber: number; endLineNumber: number } }[]; isFlush: boolean; versionId: number }) => void): { dispose(): void };
  dispose(): void;
  /** Replaces lines `from … to` (1-based, inclusive) with `text` lines, as a typed edit would, and tells the listeners. */
  edit(from: number, to: number, text: string[]): void;
  /** Decorations as the bookmarks use them: one id per decoration, at a line. */
  deltaDecorations(old: string[], added: { range: FakeRange; options: unknown }[]): string[];
  getDecorationRange(id: string): FakeRange | null;
  isDisposed(): boolean;
}

export interface FakeViewState {
  position: { lineNumber: number; column: number };
  scrollTop: number;
  of: string;
}

export interface FakeEditor {
  model: FakeModel | null;
  position: { lineNumber: number; column: number };
  selection: FakeSelection;
  scrollTop: number;
  visible: { first: number; last: number };
  /** The options `create()` was called with. */
  createdWith: Record<string, unknown>;
  /** One entry per `updateOptions()` call, in order. */
  optionUpdates: Record<string, unknown>[];
  /** The options as they stand: every update merged in order (what Monaco would compute). */
  effective(): Record<string, unknown>;
  calls: string[];
  restored: FakeViewState[];
  disposed: boolean;
  triggered: string[];
  focusListeners: (() => void)[];
  cursorListeners: (() => void)[];
  /** The element `create()` was given. */
  element: unknown;
  setModel(model: FakeModel | null): void;
  getModel(): FakeModel | null;
  saveViewState(): FakeViewState | null;
  restoreViewState(state: FakeViewState): void;
  getPosition(): { lineNumber: number; column: number } | null;
  setPosition(p: { lineNumber: number; column: number }): void;
  getSelections(): FakeSelection[];
  getSelection(): FakeSelection | null;
  setSelection(range: Omit<FakeRange, never>): void;
  getContribution(id: string): { insert(template: string): void } | null;
  snippets: string[];
  revealLineInCenter(line: number): void;
  revealLineInCenterIfOutsideViewport(line: number): void;
  revealLinesInCenterIfOutsideViewport(first: number, last: number): void;
  executeEdits(source: string, edits: unknown[]): void;
  focus(): void;
  hasTextFocus(): boolean;
  trigger(source: string, actionId: string, payload: unknown): void;
  updateOptions(o: Record<string, unknown>): void;
  getVisibleRanges(): { startLineNumber: number; endLineNumber: number }[];
  setScrollTop(top: number): void;
  getTopForLineNumber(line: number): number;
  onDidChangeCursorPosition(cb: () => void): { dispose(): void };
  onDidChangeCursorSelection(cb: () => void): { dispose(): void };
  onDidFocusEditorText(cb: () => void): { dispose(): void };
  onDidScrollChange(cb: () => void): { dispose(): void };
  onDidChangeModel(cb: () => void): { dispose(): void };
  onDidLayoutChange(cb: () => void): { dispose(): void };
  /** The decorations collection the motion colours use; `collectionSets` holds every `set`. */
  createDecorationsCollection(): { set(decorations: { range: FakeRange; options: unknown }[]): void; clear(): void };
  collectionSets: { range: FakeRange; options: unknown }[][];
  dispose(): void;
  /** The user clicked into the editor: it has the text focus and says so. */
  click(): void;
}

export interface FakeMonacoState {
  models: Map<string, FakeModel>;
  editors: FakeEditor[];
  created: FakeModel[];
  /** The one standalone theme service: the last `theme` any `create()` or `updateOptions()` handed it. */
  theme: string | null;
  /** Every theme the service was handed, in order. */
  themeHistory: string[];
  /** The editor that has the text focus. */
  focused: FakeEditor | null;
}

/** A fake model holding `text` (LF); `register` makes it findable by `editor.getModel(uri)`. */
export function makeFakeModel(text: string, languageId: string, uri: string, onDispose: () => void = () => {}): FakeModel {
  const listeners = new Set<(e: { changes: { range: { startLineNumber: number; endLineNumber: number } }[]; isFlush: boolean; versionId: number }) => void>();
  const decorations = new Map<string, FakeRange>();
  let decorationSeq = 0;
  const model: FakeModel = {
    uri,
    lines: text.split('\n'),
    languageId,
    disposed: false,
    calls: [],
    version: 1,
    getValue: () => model.lines.join('\n'),
    getAlternativeVersionId: () => model.version,
    getLineCount: () => model.lines.length,
    getLineContent: (line) => model.lines[line - 1] ?? '',
    getLineMaxColumn: (line) => (model.lines[line - 1] ?? '').length + 1,
    getLinesContent: () => [...model.lines],
    getFullModelRange: () => ({ startLineNumber: 1, startColumn: 1, endLineNumber: model.lines.length, endColumn: (model.lines.at(-1) ?? '').length + 1 }),
    getValueLengthInRange: () => 0,
    getValueInRange: () => '',
    setEOL() {},
    pushEOL() {
      model.calls.push('pushEOL');
    },
    pushStackElement() {
      model.calls.push('pushStackElement');
    },
    pushEditOperations(_before, edits) {
      model.calls.push('pushEditOperations');
      model.edit(1, model.lines.length, edits[0].text.split('\n'));
      return null;
    },
    onDidChangeContent(cb) {
      listeners.add(cb);
      return { dispose: () => void listeners.delete(cb) };
    },
    dispose() {
      model.disposed = true;
      onDispose();
    },
    edit(from, to, text) {
      if (text.length === to - from + 1) {
        for (let i = 0; i < text.length; i++) model.lines[from - 1 + i] = text[i]; // a typed edit: no shifting of the lines below
      } else {
        model.lines.splice(from - 1, to - from + 1, ...text);
      }
      model.version++;
      const event = { changes: [{ range: { startLineNumber: from, endLineNumber: to } }], isFlush: false, versionId: model.version };
      for (const cb of [...listeners]) cb(event);
    },
    deltaDecorations(old, added) {
      for (const id of old) decorations.delete(id);
      return added.map((decoration) => {
        const id = `dec${++decorationSeq}`;
        decorations.set(id, decoration.range);
        return id;
      });
    },
    getDecorationRange: (id) => decorations.get(id) ?? null,
    isDisposed: () => model.disposed,
  };
  return model;
}

export function groupMonaco(): { api: Monaco; state: FakeMonacoState } {
  const state: FakeMonacoState = { models: new Map(), editors: [], created: [], theme: null, themeHistory: [], focused: null };

  function handTheme(theme: unknown): void {
    if (typeof theme !== 'string') return;
    state.theme = theme;
    state.themeHistory.push(theme);
  }

  function makeEditor(element: unknown, createdWith: Record<string, unknown>): FakeEditor {
    let saved = 0;
    const selectionOf = (r: FakeRange): FakeSelection => ({
      ...r,
      isEmpty: () => r.startLineNumber === r.endLineNumber && r.startColumn === r.endColumn,
    });
    const ed: FakeEditor = {
      model: null,
      position: { lineNumber: 1, column: 1 },
      selection: selectionOf({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }),
      scrollTop: 0,
      visible: { first: 1, last: 40 },
      createdWith,
      optionUpdates: [],
      effective: () => Object.assign({}, createdWith, ...ed.optionUpdates),
      calls: [],
      restored: [],
      disposed: false,
      triggered: [],
      focusListeners: [],
      cursorListeners: [],
      element,
      snippets: [],
      setModel(model) {
        ed.calls.push(`setModel:${model?.uri ?? 'null'}`);
        ed.model = model;
        ed.position = { lineNumber: 1, column: 1 };
      },
      getModel: () => ed.model,
      saveViewState() {
        if (!ed.model) return null;
        saved++;
        return { position: { ...ed.position }, scrollTop: ed.scrollTop, of: `${ed.model.uri}#${saved}` };
      },
      restoreViewState(viewState) {
        ed.restored.push(viewState);
        ed.position = { ...viewState.position };
        ed.scrollTop = viewState.scrollTop;
      },
      getPosition: () => (ed.model ? ed.position : null),
      setPosition(p) {
        ed.position = p;
        ed.selection = selectionOf({ startLineNumber: p.lineNumber, startColumn: p.column, endLineNumber: p.lineNumber, endColumn: p.column });
      },
      getSelections: () => (ed.model ? [ed.selection] : []),
      getSelection: () => (ed.model ? ed.selection : null),
      setSelection(range) {
        ed.calls.push(`setSelection:${range.startLineNumber}:${range.startColumn}-${range.endLineNumber}:${range.endColumn}`);
        ed.selection = selectionOf(range);
        ed.position = { lineNumber: range.endLineNumber, column: range.endColumn };
      },
      getContribution: (id) => (id === 'snippetController2' ? { insert: (template) => void ed.snippets.push(template) } : null),
      revealLineInCenter(line) {
        ed.calls.push(`revealLineInCenter:${line}`);
      },
      revealLineInCenterIfOutsideViewport(line) {
        ed.calls.push(`revealLineInCenterIfOutsideViewport:${line}`);
      },
      revealLinesInCenterIfOutsideViewport(first, last) {
        ed.calls.push(`revealLinesInCenterIfOutsideViewport:${first}-${last}`);
      },
      executeEdits(source) {
        ed.calls.push(`executeEdits:${source}`);
      },
      focus() {
        ed.calls.push('focus');
        ed.click();
      },
      hasTextFocus: () => state.focused === ed,
      trigger(_source, actionId) {
        ed.triggered.push(actionId);
      },
      updateOptions(o) {
        ed.optionUpdates.push(o);
        handTheme(o.theme);
      },
      getVisibleRanges: () => (ed.model ? [{ startLineNumber: ed.visible.first, endLineNumber: ed.visible.last }] : []),
      setScrollTop(top) {
        ed.scrollTop = top;
      },
      getTopForLineNumber: (line) => (line - 1) * 20,
      onDidChangeCursorPosition(cb) {
        ed.cursorListeners.push(cb);
        return { dispose() {} };
      },
      onDidChangeCursorSelection(cb) {
        ed.cursorListeners.push(cb);
        return { dispose() {} };
      },
      onDidFocusEditorText(cb) {
        ed.focusListeners.push(cb);
        return { dispose: () => void ed.focusListeners.splice(ed.focusListeners.indexOf(cb), 1) };
      },
      onDidScrollChange: () => ({ dispose() {} }),
      onDidChangeModel: () => ({ dispose() {} }),
      onDidLayoutChange: () => ({ dispose() {} }),
      collectionSets: [],
      createDecorationsCollection: () => ({
        set: (decorations) => void ed.collectionSets.push(decorations),
        clear: () => {},
      }),
      dispose() {
        ed.disposed = true;
        ed.calls.push('dispose');
        if (state.focused === ed) state.focused = null;
      },
      click() {
        state.focused = ed;
        for (const cb of [...ed.focusListeners]) cb();
      },
    };
    return ed;
  }

  const api = {
    Uri: { parse: (value: string) => ({ toString: () => value, value }) },
    editor: {
      EndOfLineSequence: EOL_SEQ,
      EndOfLinePreference: { TextDefined: 0, LF: 1, CRLF: 2 },
      createModel(text: string, languageId: string, uri: { value: string }) {
        const model = makeFakeModel(text, languageId, uri.value, () => state.models.delete(uri.value));
        state.models.set(uri.value, model);
        state.created.push(model);
        return model;
      },
      getModel: (uri: { value: string }) => state.models.get(uri.value) ?? null,
      setModelLanguage(model: FakeModel, languageId: string) {
        model.languageId = languageId;
      },
      create(element: unknown, options: Record<string, unknown>) {
        handTheme(options.theme);
        const instance = makeEditor(element, options);
        state.editors.push(instance);
        return instance;
      },
    },
  };
  return { api: api as unknown as Monaco, state };
}

/**
 * A channel pane for the editor service: a model of its own and a mapping from its lines to the
 * document's. `docLines[i]` is the document line of pane line `i + 1`.
 */
export function fakePane(docId: string, channelId: string, docLines: number[], text?: string): PaneSource & { fake: FakeModel } {
  const model = makeFakeModel(text ?? docLines.map((n) => `L${n}`).join('\n'), 'fanuc-gcode', `inmemory://pane/${docId}/${channelId}`);
  return {
    docId,
    channelId,
    fake: model,
    model: () => model as never,
    docLine: (paneLine) => docLines[Math.min(Math.max(paneLine, 1), docLines.length) - 1],
    paneLine: (docLine) => {
      const at = docLines.indexOf(docLine);
      return at < 0 ? null : at + 1;
    },
  };
}
