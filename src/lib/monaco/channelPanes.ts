// The channel view in the editor (Phase 4 plan AD-50, AD-51, §6.7 rules 9–15; X29). P4.22b, on the
// editor groups of P4.21 (`editorService.ts`) and the mapping of P4.22a (`core/channels/panes.ts`,
// `viewUndo.ts`). The commands are `contrib/channelPanes.ts`; the bar above the panes is
// `components/editor/ChannelViewBar.svelte`.
//
// Two layouts, one view:
//
//  - **One file with channel sections** (`single-file`). A pane is a Monaco model of its own
//    (`inmemory://pane/<docId>/<channelId>`, the document's language, LF) that holds the program's
//    header and the channel's ranges (`projectChannel`). A pane's edits are mapped back to the
//    document (`mapPaneEdits`) and applied with one `pushEditOperations` call that joins the
//    document's open undo element; every boundary Monaco sets on the pane model is set on the
//    document too, so the document's history is the view's (§6.7 rule 11). A change of the
//    document, from any source, is re-projected into every pane (`reprojectEdits`) with the
//    change as a hint, so a keystroke costs the changed lines and not the program.
//  - **One file per channel** (`multi-file`). The panes show the channel documents themselves.
//    Each document keeps its own Monaco history; a `ViewUndoStack` keeps the order of the edits
//    across them (rule 15), and the documents' `undo` and `redo` are the stack's while the view
//    is open.
//
// In both: the panes are lined up at their wait codes with filler view zones (`alignPanes`; never
// hidden areas, P2 F54), the wait lines carry `gedit-wait-matched` / `gedit-wait-unmatched`, and
// all panes share one vertical scroll position (rule 12).
//
// Undo is taken at the **model**: a pane model's `undo` and `redo` (and, with one file per channel,
// each channel document's) are replaced while the view is open, because every way to undo in
// Monaco ends in `editor.getModel().undo()` (`CoreEditingCommands.Undo`): the keys, Edit ▸ Undo,
// the context menu and the palette. A key handler in the editor would miss the last two.
//
// IMPORTANT: like every module here, Monaco is reached only through `$lib/monaco/setup` (dynamic
// import); a static import of `$lib/monaco/core` would put Monaco into the initial bundle
// (`app/context.test.ts` is the tripwire, because `app/context.ts` imports this file).

import './channelPanes.css';
import { writable } from 'svelte/store';
import {
  MAX_CHANNEL_PANES,
  alignPanes,
  changeHull,
  docLineOf,
  mapPaneEdits,
  marksInPane,
  paneEditMovesLines,
  paneLineOf,
  projectChannel,
  projectedLines,
  reprojectEdits,
  type Alignment,
  type ChannelProjection,
  type MarkReason,
  type PaneMarks,
  type TextEdit,
} from '$lib/core/channels/panes';
import { ViewUndoStack, type UndoableModel } from '$lib/core/channels/viewUndo';
import { sectionOwners } from '$lib/core/channels/marks';
import { channelAt } from '$lib/core/channels/resolve';
import { computeJumpLines } from '$lib/app/outlineService';
import { machines as appMachines } from '$lib/stores/machines';
import { t } from '$lib/i18n';
import { registerPaneHistory, editor as appEditor, type PaneHistory } from '$lib/monaco/editorService';
import { getMonaco, type Monaco } from '$lib/monaco/setup';
import { channels as appChannels, type ChannelServiceInternals } from '$lib/stores/channels';
import { docs as appDocs } from '$lib/stores/documents';
import { status as appStatus } from '$lib/app/status';
import type * as MonacoApi from 'monaco-editor/esm/vs/editor/editor.api.js';
import type { ChannelRef, ChannelSet, SyncHit } from '$lib/core/channels/types';
import type {
  ChannelPaneService,
  ChannelViewState,
  ContentChange,
  Disposable,
  DocId,
  DocumentStore,
  EditorGroupsState,
  EditorService,
  GroupContent,
  GroupId,
  Msg,
  PaneSource,
  StatusService,
} from '$lib/app/types';

/** The state of a closed channel view. */
export const CLOSED_VIEW: ChannelViewState = Object.freeze({
  open: false,
  layout: null,
  docId: null,
  panes: [],
  notShown: [],
  outsideLines: 0,
  marks: { matched: 0, unmatched: 0, none: 0 },
}) as ChannelViewState;

/**
 * The overview ruler's colours, literals because Monaco paints the ruler on a canvas from a
 * JavaScript value (a CSS variable would arrive as the string `var(--…)`). The ruler sits on the
 * scrollbar, so one value for both themes has to clear 3:1 against both editor backgrounds
 * (`channelPanes.test.ts`). The margin bar's own colours are the tokens of `channelPanes.css`.
 */
export const WAIT_RULER_COLORS = { matched: '#2ea043', unmatched: '#e5534b' } as const;

/** `OverviewRulerLane.Right`: the lane the bookmarks (left) do not use. The enum's value is part of Monaco's API. */
const RULER_LANE_RIGHT = 4;
/** `ScrollType.Immediate`: a smooth scroll would animate every pane through the others' events. */
const SCROLL_IMMEDIATE = 1;
/** The longest wait text quoted in a hover. */
const HOVER_TEXT_MAX = 40;

type TextModel = MonacoApi.editor.ITextModel;
type CodeEditor = MonacoApi.editor.IStandaloneCodeEditor;

/** The DOM node of a filler zone, as much of it as is used (a test hands over a plain object). */
export interface ZoneNode {
  setAttribute(name: string, value: string): void;
  className: string;
}

export interface ChannelPanesDeps {
  editor: EditorService;
  docs: Pick<DocumentStore, 'get' | 'getActiveId'>;
  channels: Pick<ChannelServiceInternals, 'fresh' | 'forDoc' | 'params' | 'revision'>;
  loadMonaco: () => Promise<Monaco>;
  /** Where the undo and redo of a pane go (`registerPaneHistory`). */
  registerHistory: (history: PaneHistory) => Disposable;
  status: Pick<StatusService, 'show'>;
  /** A filler zone's DOM node. */
  createNode: () => ZoneNode & object;
  /** Runs `fn` after the current task's synchronous work (a microtask). `flush()` runs it at once. */
  defer: (fn: () => void) => void;
  /**
   * The lines the written order of a channel may not be carried across (jump targets, backward
   * jumps, loop starts and ends), per channel id, in the document's own lines: what Check Wait
   * Codes reads (`computeJumpLines`, WP12.5). `channelOf` says which channels a line is in.
   * Absent: every count difference of a wait is judged (P4e review NC-10).
   */
  jumpLines?: (docId: DocId, channelOf: (line: number) => string | readonly string[]) => Record<string, number[]>;
}

/** One pane of the open view. */
interface PaneRec {
  channel: ChannelRef;
  /** The document the pane shows: the program (sections) or the channel's own document. */
  docId: DocId;
  groupId: GroupId;
  /** `single-file`: the pane's model, its projection and its registration. */
  model: TextModel | null;
  proj: ChannelProjection | null;
  registration: Disposable | null;
  modelListener: MonacoApi.IDisposable | null;
  restore: (() => void)[];
  /** The channel is no longer in the program: its pane is empty and read-only. */
  gone: boolean;
}

/** An editor of a pane group and what the view put on it. */
interface Hook {
  editor: CodeEditor;
  rec: PaneRec;
  zones: Map<string, { id: string; node: ZoneNode }>;
  collection: MonacoApi.editor.IEditorDecorationsCollection | null;
  subs: MonacoApi.IDisposable[];
}

interface View {
  layout: 'single-file' | 'multi-file';
  /** The document the view was opened from. */
  docId: DocId;
  recs: PaneRec[];
  notShown: string[];
  outsideLines: number;
  /** One file per channel: the order of the edits across the documents. */
  stack: ViewUndoStack | null;
  monaco: Monaco;
  disposables: Disposable[];
  hooks: Map<CodeEditor, Hook>;
  /** The last set the panes were made from; the revision of the channel service re-projects only for another one. */
  lastSet: ChannelSet | null;
  alignment: Alignment | null;
  paneMarks: PaneMarks[];
  alignKey: string;
  /** The pane (index) that gets the cursor at this document line when its editor appears. */
  place: { index: number; line: number } | null;
  /** The jump lines of a document (`deps.jumpLines`) at a version of it, read only when a count difference needs them. */
  jumpCache: Map<DocId, { version: number; lines: Record<string, number[]> }>;
  /** Sections: the program's version right after a refused pane edit was taken back off its undo stack. The redo
   *  stack then holds that edit with its inverse, a step that changes nothing: a Redo at this version skips it. */
  noopRedoAt: number | null;
}

/** The lines a document change replaced (`DocChangeHint`). */
type Hint = { from: number; oldTo: number; newTo: number };

/** A pane edit on its way to the document: the document's content events during the push are counted here. */
interface Forwarding {
  rec: PaneRec;
  changes: TextEdit[];
  mapped: TextEdit[];
  /** How many content events of the document the push made, and the last one's lines (null for a flush). */
  events: number;
  hint: Hint | null;
}

/** The pane lines `from … to` (1-based, inclusive) of `model`. */
function paneLines(model: TextModel, from: number, to: number): string[] {
  const out: string[] = [];
  for (let n = from; n <= to; n++) out.push(model.getLineContent(n));
  return out;
}

const fullRange = (model: TextModel) => ({ startLineNumber: 1, startColumn: 1, endLineNumber: model.getLineCount(), endColumn: model.getLineMaxColumn(model.getLineCount()) });

const emptyProjection = (channelId: string): ChannelProjection => ({ channelId, segments: [], lineCount: 1 });

/** The line count `model` had before `changes` (ranges in the old text) made it what it is. */
function lineCountBefore(model: TextModel, changes: readonly TextEdit[]): number {
  let delta = 0;
  for (const c of changes) {
    let added = 0;
    for (let i = c.text.indexOf('\n'); i >= 0; i = c.text.indexOf('\n', i + 1)) added++;
    delta += added - (c.range.endLineNumber - c.range.startLineNumber);
  }
  return model.getLineCount() - delta;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);

/** Whether the ranges `b` are the ranges `a` after `added` lines were inserted into line `at` (the range holding it grows). */
function shiftedRanges(a: readonly { startLine: number; endLine: number }[], b: readonly { startLine: number; endLine: number }[], at: number, added: number): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const start = a[i].startLine > at ? a[i].startLine + added : a[i].startLine;
    const end = a[i].endLine >= at ? a[i].endLine + added : a[i].endLine;
    if (b[i].startLine !== start || b[i].endLine !== end) return false;
  }
  return true;
}

/** A document model's own methods, as they were before the view replaced them. */
interface Original {
  push: () => void;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
}

/** The model methods this module replaces while the view is open. */
type Replaceable = { [K in 'pushStackElement' | 'undo' | 'redo']: (...args: never[]) => unknown };

/** Puts own properties on `model`; the returned function puts it back as it was. */
function replaceMethods(model: TextModel, replacements: Partial<Replaceable>): () => void {
  const target = model as unknown as Record<string, unknown>;
  const saved = new Map<string, { own: boolean; value: unknown }>();
  for (const [name, fn] of Object.entries(replacements)) {
    saved.set(name, { own: Object.prototype.hasOwnProperty.call(target, name), value: target[name] });
    target[name] = fn;
  }
  return () => {
    for (const [name, was] of saved) {
      if (was.own) target[name] = was.value;
      else delete target[name];
    }
  };
}

/** What `ViewUndoStack` needs of a model, bound to the model's own methods (the ones before they were replaced). */
function adapter(model: TextModel, originals: Map<TextModel, Original>): UndoableModel {
  const own = originals.get(model);
  return {
    getAlternativeVersionId: () => model.getAlternativeVersionId(),
    undo: () => (own?.undo ?? (() => model.undo()))(),
    redo: () => (own?.redo ?? (() => model.redo()))(),
    canUndo: () => model.canUndo(),
    canRedo: () => model.canRedo(),
    pushStackElement: () => (own?.push ?? (() => model.pushStackElement()))(),
  };
}

/** Whether two sets of mark lines are the same (the keystroke path asks this for every pane). */
function marksKey(marks: readonly SyncHit[]): string {
  let out = '';
  for (const h of marks) out += `${h.ruleId}|${h.mark}|${h.line}|${h.channel}|${h.partners.join('')}|${h.blocking ? 1 : 0};`;
  return out;
}

/** The text of the wait on a pane line, for the hover. */
function waitText(model: TextModel | null, line: number): string {
  if (model === null || line < 1 || line > model.getLineCount()) return '';
  const text = model.getLineContent(line).trim();
  return text.length > HOVER_TEXT_MAX ? `${text.slice(0, HOVER_TEXT_MAX)}…` : text;
}

const paneSources = new WeakMap<object, PaneSource>();

/** The pane a Monaco model belongs to, or undefined for any other model (the hover's pane context, §6.7 decision 11). */
export function paneSourceOfModel(model: object | null | undefined): PaneSource | undefined {
  return model === null || model === undefined ? undefined : paneSources.get(model);
}

export function createChannelPanes(deps: ChannelPanesDeps): ChannelPaneService {
  const state = writable<ChannelViewState>(CLOSED_VIEW);
  let view: View | null = null;
  /** A pane model is being changed by this module: its content event is not an edit of the user's. */
  let applying = 0;
  let forwarding: Forwarding | null = null;
  /** A refused pane edit is being taken back out of the document: its content events are not news for the panes. */
  let reverting = 0;
  let closing = false;
  let opening = false;
  /** Work that waits for the end of the current task: the alignment and the pane lines a junction left behind. */
  let scheduled = false;
  let alignDirty = false;
  const fixes = new Set<PaneRec>();
  /** `undo`/`redo` in progress: the first changed document line (and the document it was in). */
  let trace: { line: number; docId: DocId | null } | null = null;
  /** The originals of the documents' `pushStackElement` while their boundaries go to the stack. */
  const originals = new Map<TextModel, Original>();

  /**
   * The channel service's answer for `id`, with the change already applied. Its revision store ticks when
   * the answer differs from the last one, which for this module's own call is no news: the revision
   * subscriber ignores those ticks (a re-projection without the change as a hint scans the program).
   */
  let ownFresh = 0;
  function freshSet(id: DocId): ChannelSet {
    ownFresh++;
    try {
      return deps.channels.fresh(id);
    } finally {
      ownFresh--;
    }
  }

  const say = (msg: Msg, error = false): void => deps.status.show(t(msg.key, msg.params), error ? { error: true } : undefined);
  const nameOf = (rec: PaneRec): string => (rec.gone ? t('channelPanes.gone', { name: rec.channel.name }) : rec.channel.name);

  // -- the state --------------------------------------------------------------------------

  function publish(): void {
    const v = view;
    if (v === null) {
      state.set(CLOSED_VIEW);
      return;
    }
    const marks = { matched: 0, unmatched: 0, none: 0 };
    for (const row of v.alignment?.states ?? []) for (const s of row) marks[s]++;
    state.set({
      open: true,
      layout: v.layout,
      docId: v.docId,
      panes: v.recs.map((rec) => ({ channelId: rec.channel.id, name: nameOf(rec), groupId: rec.groupId, docId: rec.docId })),
      notShown: [...v.notShown],
      outsideLines: v.outsideLines,
      marks,
    });
  }

  function lineOutsideCount(set: ChannelSet): number {
    let n = 0;
    for (const r of set.outside) if (r.startLine !== 1) n += r.endLine - r.startLine + 1;
    return n;
  }

  // -- scheduled work ---------------------------------------------------------------------

  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    deps.defer(runScheduled);
  }

  function runScheduled(): void {
    if (!scheduled) return;
    scheduled = false;
    const v = view;
    if (v === null) {
      fixes.clear();
      return;
    }
    for (const rec of [...fixes]) {
      fixes.delete(rec);
      if (v.recs.includes(rec)) correct(v, rec);
    }
    if (alignDirty) {
      alignDirty = false;
      align(v);
    }
  }

  /** The pane's text brought to the projection by comparing the two (a junction or a moved section boundary left it different). */
  function correct(v: View, rec: PaneRec): void {
    if (rec.model === null || rec.proj === null || rec.gone) return;
    const model = rec.model;
    const proj = rec.proj;
    const edits = reprojectEdits({ channelId: proj.channelId, segments: [], lineCount: model.getLineCount() }, proj, {
      oldPaneLines: (a, b) => paneLines(model, a, b),
      docLines: (a, b) => deps.editor.getLines(v.docId, a, b),
    });
    applyToPane(rec, edits);
    alignDirty = true;
  }

  function applyToPane(rec: PaneRec, edits: readonly TextEdit[]): void {
    if (rec.model === null || edits.length === 0) return;
    applying++;
    try {
      rec.model.applyEdits(edits.map((e) => ({ range: e.range, text: e.text })));
    } finally {
      applying--;
    }
  }

  // -- the sources and the models of the panes (sections) -------------------------------------

  function sourceOf(rec: PaneRec, readOnly: boolean): PaneSource {
    return {
      docId: rec.docId,
      channelId: rec.channel.id,
      model: () => rec.model as TextModel,
      docLine: (paneLine) => {
        const proj = rec.proj;
        if (proj === null || rec.gone) return 1;
        return docLineOf(proj, clamp(paneLine, 1, proj.lineCount));
      },
      paneLine: (docLine) => (rec.proj === null || rec.gone ? null : paneLineOf(rec.proj, docLine)),
      readOnly,
    };
  }

  function register(rec: PaneRec): void {
    const source = sourceOf(rec, rec.gone);
    const next = deps.editor.registerPane(source);
    rec.registration?.();
    rec.registration = next;
    if (rec.model !== null) paneSources.set(rec.model, source);
  }

  /** The pane model of a channel of the program: filled from the document, LF, wrapped for the undo. */
  function makePaneModel(v: View, rec: PaneRec, lines: string[], languageId: string): TextModel {
    const { monaco } = v;
    const uri = monaco.Uri.parse(`inmemory://pane/${encodeURIComponent(rec.docId)}/${encodeURIComponent(rec.channel.id)}`);
    monaco.editor.getModel(uri)?.dispose();
    const model = monaco.editor.createModel(lines.join('\n'), languageId, uri);
    model.setEOL(monaco.editor.EndOfLineSequence.LF);
    return model;
  }

  // -- a pane edit goes to the document --------------------------------------------------------

  function onPaneChange(rec: PaneRec, event: MonacoApi.editor.IModelContentChangedEvent): void {
    const v = view;
    if (v === null || applying > 0 || rec.gone || rec.proj === null || rec.model === null) return;
    const doc = deps.editor.model(v.docId);
    if (!doc) return;
    const proj = rec.proj;
    const changes: TextEdit[] = event.changes.map((c) => ({ range: c.range, text: c.text }));
    // A correction of this pane is still waiting (an earlier edit crossed a junction or moved a
    // section boundary), so the pane no longer matches the projection the edit would be mapped
    // through. Map nothing: the correction brings the pane back to the program and takes this edit
    // with it, and the user is told.
    if (fixes.has(rec) || lineCountBefore(rec.model, changes) !== proj.lineCount) {
      fixes.add(rec);
      schedule();
      say({ key: 'channelPanes.status.editDropped' }, true);
      return;
    }
    const before = v.lastSet;
    const mapped = mapPaneEdits(proj, changes, (n) => doc.getLineMaxColumn(docLineOf(proj, n)), doc.getLineCount());
    if (mapped.length === 0) {
      fixes.add(rec);
      schedule();
      return;
    }
    // The edit goes to the document first; the panes follow below, once it is known whether the
    // edit may stay (the guard needs the document's own reading of the edited program).
    const fwd: Forwarding = { rec, changes, mapped, events: 0, hint: null };
    const versionBefore = doc.getAlternativeVersionId();
    let inverse: TextEdit[] = [];
    forwarding = fwd;
    try {
      doc.pushEditOperations(
        null,
        mapped.map((m) => ({ range: m.range, text: m.text })),
        (undo) => {
          inverse = undo.map((u) => ({ range: u.range, text: u.text ?? '' }));
          return null;
        },
      );
    } finally {
      forwarding = null;
    }
    if (view !== v) return;
    const set = freshSet(v.docId);
    const hint = fwd.events === 1 && fwd.hint !== null ? fwd.hint : undefined;
    // NC-2 (the owner, 2026-10-17): an edit in a pane never moves lines to another channel. One
    // that would (a section start typed over, deleted, or written into the pane) is taken back
    // and the user is told to change section starts in the program itself.
    if (before !== null && !tooSlow(set) && !keepsLines(before, set, mapped) && paneEditMovesLines(before, set, mapped).moves) {
      takeBack(v, rec, doc, inverse, versionBefore);
      return;
    }
    applySet(v, set, hint, fwd);
  }

  /**
   * Takes a refused pane edit back out of the document inside the undo element it went into: the
   * document ends as it was, its history gains no step (an Undo afterwards undoes what it undid
   * before), and the pane is brought back to the document by the scheduled correction.
   */
  function takeBack(v: View, rec: PaneRec, doc: TextModel, inverse: TextEdit[], versionBefore: number): void {
    reverting++;
    try {
      // The edit and its inverse in one element, which then holds no change...
      doc.pushEditOperations(null, inverse.map((u) => ({ range: u.range, text: u.text })), () => null);
      // ...and goes back off the stack when the edit had opened it (the version is the one before
      // the edit then; a Redo afterwards redoes nothing). When the edit had joined an element of
      // earlier typing, that element is undone and redone, which keeps the earlier typing as the
      // one step it was.
      void doc.undo();
      if (doc.getAlternativeVersionId() !== versionBefore) void doc.redo();
    } finally {
      reverting--;
    }
    // An undo that applies no edit fires no content event, which is what the dirty flag follows:
    // read it from the text again (the version is the one before the edit, or the earlier typing's).
    deps.editor.recheckDirty(v.docId);
    v.noopRedoAt = doc.getAlternativeVersionId() === versionBefore ? versionBefore : null;
    v.lastSet = freshSet(v.docId);
    fixes.add(rec);
    schedule();
    say({ key: 'channelPanes.status.movesLines' }, true);
  }

  /**
   * The guard's fast answer for a keystroke: one edit within one line (a character, or a line
   * break typed or pasted inside it), after which every section and every range of lines outside
   * the channels is where it was, only moved down past that line by the line breaks it added.
   * Then the lines it wrote are in the channels of the line it was made on and no other line
   * changed channel: it moves nothing. False means "ask `paneEditMovesLines`".
   */
  function keepsLines(before: ChannelSet, after: ChannelSet, edits: readonly TextEdit[]): boolean {
    if (edits.length !== 1 || edits[0].range.startLineNumber !== edits[0].range.endLineNumber) return false;
    if (before === after) return true;
    const at = edits[0].range.startLineNumber;
    let added = 0;
    for (let i = edits[0].text.indexOf('\n'); i >= 0; i = edits[0].text.indexOf('\n', i + 1)) added++;
    if (before.layout !== after.layout || before.members.length !== after.members.length || !shiftedRanges(before.outside, after.outside, at, added)) return false;
    for (let i = 0; i < before.members.length; i++) {
      const a = before.members[i];
      const b = after.members[i];
      if (a.kind !== 'section' || b.kind !== 'section' || a.channel.id !== b.channel.id || !shiftedRanges(a.ranges, b.ranges, at, added)) return false;
    }
    return true;
  }

  /** Whether the document edit is the pane edit moved by an offset, which leaves the source pane as the user made it. */
  function plainForward(fwd: Forwarding, after: ChannelProjection, model: TextModel): boolean {
    if (fwd.mapped.length !== fwd.changes.length || after.lineCount !== model.getLineCount()) return false;
    const byStart = [...fwd.changes].sort((a, b) => a.range.startLineNumber - b.range.startLineNumber || a.range.startColumn - b.range.startColumn);
    for (let i = 0; i < byStart.length; i++) {
      const a = byStart[i];
      const b = fwd.mapped[i];
      if (a.text !== b.text) return false;
      if (b.range.endLineNumber - b.range.startLineNumber !== a.range.endLineNumber - a.range.startLineNumber) return false;
      if (a.range.startColumn !== b.range.startColumn || a.range.endColumn !== b.range.endColumn) return false;
    }
    return true;
  }

  // -- a change of the document goes to the panes ---------------------------------------------------

  function tooSlow(set: ChannelSet): boolean {
    return set.layout === 'none' && set.problems.some((p) => p.message.key === 'channels.problems.tooSlow');
  }

  function onDocChange(id: DocId, change: ContentChange): void {
    const v = view;
    if (v === null) return;
    if (trace !== null && change.startLine < trace.line && (id === v.docId || v.recs.some((r) => r.docId === id))) {
      trace = { line: change.startLine, docId: id };
    }
    if (v.layout === 'multi-file') {
      if (v.recs.some((r) => r.docId === id)) {
        v.stack?.noteEdit(id);
        alignDirty = true;
        schedule();
      }
      return;
    }
    if (id !== v.docId || reverting > 0) return;
    // An edit (not an undo or redo) empties the redo stack: the step of a refused edit is gone with it.
    if (trace === null) v.noopRedoAt = null;
    const hint = change.flush ? null : { from: change.startLine, oldTo: change.endLineOld, newTo: change.endLineNew };
    if (forwarding !== null) {
      // A pane edit: `onPaneChange` brings the panes along once the guard has let it stay.
      forwarding.events++;
      forwarding.hint = hint;
      return;
    }
    applySet(v, freshSet(v.docId), hint ?? undefined, null);
  }

  /** Brings every pane to `set`; the program's own change as a hint when it is known; `fwd` the pane edit it came from. */
  function applySet(v: View, set: ChannelSet, hint: Hint | undefined, fwd: Forwarding | null): void {
    // The panes map through the projection they were made from; a program that cannot be read for its
    // channels any more (it took too long) leaves that projection behind the document, so an edit in a
    // pane could land on the wrong line. The view closes rather than guess.
    if (tooSlow(set)) {
      end(v, 'channelPanes.status.closedSlow');
      return;
    }
    if (set.layout !== 'single-file') {
      // No section is left in the program (the machine still has channels), or the machine has other ones now.
      end(v, set.layout === 'none' && deps.channels.params(v.docId) !== null ? 'channelPanes.status.closedGone' : 'channelPanes.status.closedMachine');
      return;
    }
    v.lastSet = set;
    v.outsideLines = lineOutsideCount(set);
    const docLines = (a: number, b: number): string[] => deps.editor.getLines(v.docId, a, b);
    let alive = 0;
    for (const rec of [...v.recs]) {
      const after = projectChannel(set, rec.channel.id);
      if (after === null) {
        goneRec(rec);
        continue;
      }
      alive++;
      if (rec.gone) {
        reviveRec(v, rec, after);
        continue;
      }
      const before = rec.proj as ChannelProjection;
      const model = rec.model as TextModel;
      rec.proj = after;
      if (fwd !== null && fwd.rec === rec) {
        // The pane the user typed in already shows its edit; it needs a correction only when the
        // edit crossed a junction or moved a section boundary.
        if (!plainForward(fwd, after, model)) {
          fixes.add(rec);
          schedule();
        }
        continue;
      }
      const edits = reprojectEdits(before, after, { oldPaneLines: (a, b) => paneLines(model, a, b), docLines, changed: hint });
      applyToPane(rec, edits);
    }
    if (alive === 0) {
      end(v, 'channelPanes.status.closedGone');
      return;
    }
    alignDirty = true;
    schedule();
    publish();
  }

  function goneRec(rec: PaneRec): void {
    if (rec.gone || rec.model === null) return;
    rec.gone = true;
    rec.proj = emptyProjection(rec.channel.id);
    applying++;
    try {
      rec.model.applyEdits([{ range: fullRange(rec.model), text: '' }]);
    } finally {
      applying--;
    }
    register(rec);
  }

  function reviveRec(v: View, rec: PaneRec, after: ChannelProjection): void {
    if (rec.model === null) return;
    rec.gone = false;
    rec.proj = after;
    const lines = projectedLines(after, (a, b) => deps.editor.getLines(v.docId, a, b));
    applying++;
    try {
      rec.model.applyEdits([{ range: fullRange(rec.model), text: lines.join('\n') }]);
    } finally {
      applying--;
    }
    register(rec);
  }

  // -- alignment, marks, scrolling -----------------------------------------------------------------

  function paneMarksOf(v: View): PaneMarks[] {
    return v.recs.map((rec): PaneMarks => {
      if (v.layout === 'single-file') {
        const set = v.lastSet ?? deps.channels.forDoc(v.docId);
        const lineCount = rec.model?.getLineCount() ?? 1;
        return { channel: rec.channel, lineCount, marks: rec.proj === null || rec.gone ? [] : marksInPane(rec.proj, set.marks) };
      }
      const own = freshSet(rec.docId);
      return {
        channel: rec.channel,
        lineCount: deps.editor.getLineCount(rec.docId),
        marks: own.marks.map((h) => (h.channel === rec.channel.id ? h : { ...h, channel: rec.channel.id })),
      };
    });
  }

  /** The alignment again, when a pane's line count or a mark changed; the zones and the marks of the editors follow. */
  function align(v: View, force = false): void {
    const panes = paneMarksOf(v);
    const key = panes.map((p) => `${p.lineCount}#${marksKey(p.marks)}`).join('/');
    if (!force && key === v.alignKey && v.alignment !== null) return;
    v.alignKey = key;
    const params = deps.channels.params(v.docId);
    const rules = params?.syncMarks ?? [];
    // NC-11: a wait that names a channel the machine does not have is never met.
    const declared = params?.list.map((c) => c.id);
    v.paneMarks = panes;
    let alignment = alignPanes(panes, rules, { declared });
    // NC-10: a count difference inside a loop or a jump is not judged, as Check Wait Codes. The
    // jump lines only change a count difference, so the program is read for them only then.
    if (alignment.reasons.some((row) => row.some((r) => r?.kind === 'missing'))) {
      const jumpLines = paneJumpLines(v);
      if (jumpLines !== null) alignment = alignPanes(panes, rules, { jumpLines, declared });
    }
    v.alignment = alignment;
    for (const hook of v.hooks.values()) paint(v, hook);
    publish();
  }

  /** The jump lines of a document by channel, in its own lines (cached per version of the document). */
  function docJumpLines(v: View, docId: DocId, channelOf: (line: number) => string | readonly string[]): Record<string, number[]> {
    const version = deps.editor.model(docId)?.getVersionId() ?? -1;
    const cached = v.jumpCache.get(docId);
    if (cached !== undefined && cached.version === version) return cached.lines;
    const lines = deps.jumpLines?.(docId, channelOf) ?? {};
    v.jumpCache.set(docId, { version, lines });
    return lines;
  }

  /** The jump lines of each pane's channel in the pane's **own** lines (`alignPanes` compares them with the marks' lines), or null without a source. */
  function paneJumpLines(v: View): Record<string, number[]> | null {
    if (deps.jumpLines === undefined) return null;
    const out: Record<string, number[]> = {};
    if (v.layout === 'multi-file') {
      for (const rec of v.recs) out[rec.channel.id] = docJumpLines(v, rec.docId, () => rec.channel.id)[rec.channel.id] ?? [];
      return out;
    }
    const set = v.lastSet;
    if (set === null || set.layout !== 'single-file') return null;
    // A line of a shared section is in each of its channels (as Check Wait Codes reads it).
    const sections = set.members.flatMap((m) => (m.kind === 'section' ? [m] : []));
    const byChannel = docJumpLines(v, v.docId, sectionOwners(sections));
    for (const rec of v.recs) {
      if (rec.proj === null || rec.gone) continue;
      const own: number[] = [];
      for (const docLine of byChannel[rec.channel.id] ?? []) {
        const paneLine = paneLineOf(rec.proj, docLine);
        if (paneLine !== null) own.push(paneLine);
      }
      out[rec.channel.id] = own;
    }
    return out;
  }

  function indexOf(v: View, rec: PaneRec): number {
    return v.recs.indexOf(rec);
  }

  /** A wait mark's decoration in pane `index`; a wait in neither state gets a hover only, when there is something to say. */
  function markDecorations(v: View, index: number): MonacoApi.editor.IModelDeltaDecoration[] {
    const alignment = v.alignment;
    if (alignment === null) return [];
    const own = v.paneMarks[index];
    const out: MonacoApi.editor.IModelDeltaDecoration[] = [];
    own.marks.forEach((hit, i) => {
      const state = alignment.states[index]?.[i] ?? 'none';
      const reason = alignment.reasons[index]?.[i] ?? null;
      const range = { startLineNumber: hit.line, startColumn: 1, endLineNumber: hit.line, endColumn: 1 };
      if (state === 'none') {
        if (reason !== null) out.push({ range, options: { isWholeLine: true, hoverMessage: { value: reasonMessage(v, index, hit, reason), isTrusted: false, supportHtml: false } } });
        return;
      }
      const message = state === 'matched' ? matchedMessage(v, index, hit) : reasonMessage(v, index, hit, reason ?? { kind: 'crossing' });
      out.push({
        range,
        options: {
          isWholeLine: true,
          linesDecorationsClassName: state === 'matched' ? 'gedit-wait-matched' : 'gedit-wait-unmatched',
          overviewRuler: { color: state === 'matched' ? WAIT_RULER_COLORS.matched : WAIT_RULER_COLORS.unmatched, position: RULER_LANE_RIGHT as MonacoApi.editor.OverviewRulerLane },
          hoverMessage: { value: message, isTrusted: false, supportHtml: false },
        },
      });
    });
    return out;
  }

  function matchedMessage(v: View, index: number, hit: SyncHit): string {
    const group = v.alignment?.groups.find((g) => g.marks.some((m) => m.pane === index && m.line === hit.line));
    const partners = (group?.marks ?? [])
      .filter((m) => m.pane !== index)
      .map((m) => {
        const other = v.recs[m.pane];
        const line = v.layout === 'single-file' && other.proj !== null ? docLineOf(other.proj, clamp(m.line, 1, other.proj.lineCount)) : m.line;
        return t('channelPanes.mark.partner', { channel: other.channel.name, line });
      });
    return t('channelPanes.mark.matched', { partners: partners.join('; ') });
  }

  /** The names of channel ids: a pane's, the machine's, or the id as written (a channel the machine does not have). */
  function channelNames(v: View, ids: readonly string[]): string {
    const list = deps.channels.params(v.docId)?.list ?? [];
    return ids.map((id) => v.recs.find((r) => r.channel.id === id)?.channel.name ?? list.find((c) => c.id === id)?.name ?? id).join(', ');
  }

  /** Why a wait is not lined up (or needs no partner), from the alignment's own reason (P4e review NC-4, NC-10–NC-12). */
  function reasonMessage(v: View, index: number, hit: SyncHit, reason: MarkReason): string {
    switch (reason.kind) {
      case 'alone':
        return t('channelPanes.mark.alone');
      case 'missing': {
        const shown = v.layout === 'single-file' ? v.recs[index].model : (deps.editor.model(v.recs[index].docId) ?? null);
        return t('channelPanes.mark.missing', { channels: channelNames(v, reason.channels), count: reason.channels.length, text: waitText(shown, hit.line) });
      }
      case 'unknown':
        return t('channelPanes.mark.unknown', { channels: reason.channels.join(', '), count: reason.channels.length });
      case 'crossing':
        return t('channelPanes.mark.crossing');
      case 'elsewhere':
        return t('channelPanes.mark.elsewhere');
      case 'loop':
        return t('channelPanes.mark.loop');
      case 'answered':
        return t('channelPanes.mark.answered', { channels: channelNames(v, reason.channels) });
    }
  }

  /** Puts the alignment's zones and the marks of pane `hook.rec` on its editor; only the zones that differ are replaced. */
  function paint(v: View, hook: Hook): void {
    const index = indexOf(v, hook.rec);
    const alignment = v.alignment;
    if (index < 0 || alignment === null) return;
    const wanted = alignment.zones.filter((z) => z.pane === index);
    const wantedKeys = new Set(wanted.map((z) => `${z.afterLine}:${z.lines}`));
    const stale = [...hook.zones.keys()].filter((k) => !wantedKeys.has(k));
    const fresh = wanted.filter((z) => !hook.zones.has(`${z.afterLine}:${z.lines}`));
    if (stale.length > 0 || fresh.length > 0) {
      hook.editor.changeViewZones((accessor) => {
        for (const key of stale) {
          const zone = hook.zones.get(key);
          if (zone) accessor.removeZone(zone.id);
          hook.zones.delete(key);
        }
        for (const z of fresh) {
          const node = deps.createNode();
          node.className = 'gedit-align-zone';
          node.setAttribute('data-testid', 'channel-align-zone');
          node.setAttribute('data-group', hook.rec.groupId);
          node.setAttribute('data-after-line', String(z.afterLine));
          node.setAttribute('data-lines', String(z.lines));
          const id = accessor.addZone({ afterLineNumber: z.afterLine, heightInLines: z.lines, domNode: node as unknown as HTMLElement, suppressMouseDown: true });
          hook.zones.set(`${z.afterLine}:${z.lines}`, { id, node });
        }
      });
    }
    hook.collection ??= hook.editor.createDecorationsCollection();
    hook.collection.set(markDecorations(v, index));
  }

  /** Takes everything the view put on one editor away: its listeners, its filler zones and its marks. */
  function unhook(v: View, hook: Hook): void {
    for (const sub of hook.subs) sub.dispose();
    hook.subs = [];
    try {
      if (hook.zones.size > 0) {
        hook.editor.changeViewZones((accessor) => {
          for (const zone of hook.zones.values()) accessor.removeZone(zone.id);
        });
      }
      hook.collection?.clear();
    } catch {
      // The editor is gone with its group.
    }
    hook.zones.clear();
    hook.collection = null;
    v.hooks.delete(hook.editor);
  }

  /** Every pane editor gets the scroll sharing and the alignment; called when an editor appears or the groups change. */
  function hookEditors(v: View, paintNow = true): void {
    const live = deps.editor.groupViews();
    for (const [editor, hook] of [...v.hooks]) {
      if (!live.some((g) => g.editor === editor)) unhook(v, hook);
    }
    for (const group of live) {
      if (v.hooks.has(group.editor)) continue;
      const rec = v.recs.find((r) => r.groupId === group.id && r.docId === group.docId);
      if (!rec) continue;
      const hook: Hook = { editor: group.editor, rec, zones: new Map(), collection: null, subs: [] };
      const reference = [...v.hooks.values()][0];
      v.hooks.set(group.editor, hook);
      hook.subs.push(group.editor.onDidScrollChange((e) => shareScroll(v, hook, e)));
      if (reference) group.editor.setScrollTop(reference.editor.getScrollTop(), SCROLL_IMMEDIATE);
      if (paintNow && v.alignment !== null) paint(v, hook);
      if (v.place !== null && v.recs[v.place.index] === rec) {
        const { line } = v.place;
        v.place = null;
        group.editor.setPosition({ lineNumber: line, column: 1 });
        group.editor.revealLineInCenterIfOutsideViewport(line);
      }
    }
  }

  let sharing = false;
  function shareScroll(v: View, from: Hook, e: { scrollTop: number; scrollTopChanged: boolean }): void {
    if (!e.scrollTopChanged || sharing) return;
    sharing = true;
    try {
      for (const other of v.hooks.values()) {
        if (other !== from && other.editor.getScrollTop() !== e.scrollTop) other.editor.setScrollTop(e.scrollTop, SCROLL_IMMEDIATE);
      }
    } finally {
      sharing = false;
    }
  }

  // -- undo and redo -----------------------------------------------------------------------------------

  function history(way: 'undo' | 'redo'): void {
    const v = view;
    if (v === null) return;
    trace = { line: Infinity, docId: null };
    let target: DocId = v.docId;
    try {
      if (v.stack !== null) {
        const answer = v.stack[way]();
        if (answer === null) return;
        if ('refused' in answer) {
          say({ key: 'channelPanes.status.undoInFile' }, true);
          return;
        }
        target = answer.docId;
      } else {
        const doc = deps.editor.model(v.docId);
        if (!doc) return;
        // The next redo is a refused pane edit with its inverse: there is nothing to redo.
        if (way === 'redo' && v.noopRedoAt !== null && doc.getAlternativeVersionId() === v.noopRedoAt) return;
        // The document's own methods (the view replaced those of the panes, not of the program).
        void (way === 'undo' ? doc.undo() : doc.redo());
      }
    } finally {
      const seen = trace;
      trace = null;
      runScheduled();
      if (seen !== null && Number.isFinite(seen.line)) showChange(v, target, seen.line);
    }
  }

  /** The pane whose lines changed takes the focus and its cursor goes to the first changed line (rule 11). */
  function showChange(v: View, docId: DocId, docLine: number): void {
    let rec: PaneRec | undefined;
    let line: number | null = null;
    if (v.layout === 'multi-file') {
      rec = v.recs.find((r) => r.docId === docId);
      line = clamp(docLine, 1, Math.max(deps.editor.getLineCount(docId), 1));
    } else {
      const focused = deps.editor.groupsState().focused;
      const candidates = [...v.recs.filter((r) => r.groupId === focused), ...v.recs.filter((r) => r.groupId !== focused)];
      for (const r of candidates) {
        const found = r.proj === null || r.gone ? null : paneLineOf(r.proj, docLine);
        if (found !== null) {
          rec = r;
          line = found;
          break;
        }
      }
    }
    if (!rec || line === null) return;
    deps.editor.focusGroup(rec.groupId);
    const hook = [...v.hooks.values()].find((h) => h.rec === rec);
    hook?.editor.setPosition({ lineNumber: line, column: 1 });
    hook?.editor.revealLineInCenterIfOutsideViewport(line);
  }

  // -- the models' boundaries and undo ---------------------------------------------------------------------

  /** One pane model (sections): its boundaries are the document's, its undo and redo the view's. */
  function wrapPaneModel(v: View, rec: PaneRec): void {
    const model = rec.model as TextModel;
    const own = model.pushStackElement.bind(model);
    rec.restore.push(
      replaceMethods(model, {
        pushStackElement: (() => {
          own();
          if (applying === 0) deps.editor.model(v.docId)?.pushStackElement();
        }) as never,
        undo: (() => {
          history('undo');
          return Promise.resolve();
        }) as never,
        redo: (() => {
          history('redo');
          return Promise.resolve();
        }) as never,
      }),
    );
  }

  /** A channel document (one file per channel): its boundaries close the stack's entry, its undo and redo are the view's. */
  function wrapDocument(v: View, rec: PaneRec): void {
    const model = deps.editor.model(rec.docId);
    if (!model || originals.has(model)) return;
    originals.set(model, { push: model.pushStackElement.bind(model), undo: model.undo.bind(model), redo: model.redo.bind(model) });
    const restoreMethods = replaceMethods(model, {
      pushStackElement: (() => v.stack?.close()) as never,
      undo: (() => {
        history('undo');
        return Promise.resolve();
      }) as never,
      redo: (() => {
        history('redo');
        return Promise.resolve();
      }) as never,
    });
    rec.restore.push(() => {
      restoreMethods();
      originals.delete(model);
    });
  }

  // -- open ---------------------------------------------------------------------------------------------------

  function focusIndexFor(set: ChannelSet, recs: PaneRec[], docId: DocId, line: number | null): number {
    if (recs.length === 0) return 0;
    if (set.layout === 'multi-file') return Math.max(0, recs.findIndex((r) => r.docId === docId));
    if (line === null) return 0;
    const here = channelAt(set, line);
    const found = here === null ? -1 : recs.findIndex((r) => r.channel.id === here.id);
    return Math.max(0, found);
  }

  async function open(id: DocId): Promise<{ ok: true } | { ok: false; reason: Msg }> {
    if (opening) return { ok: false, reason: { key: 'channelPanes.refusal.notLoaded' } };
    opening = true;
    try {
      if (deps.docs.get(id) === undefined) return { ok: false, reason: { key: 'channelPanes.refusal.noDocument' } };
      let monaco: Monaco;
      try {
        monaco = await deps.loadMonaco();
      } catch {
        return { ok: false, reason: { key: 'channelPanes.refusal.notLoaded' } };
      }
      // The world may have moved while Monaco loaded; the answers below are read after that.
      if (deps.docs.get(id) === undefined) return { ok: false, reason: { key: 'channelPanes.refusal.noDocument' } };
      if (view !== null) close();
      const set = deps.channels.fresh(id);
      if (tooSlow(set)) return { ok: false, reason: { key: 'channels.problems.tooSlow' } };
      if (set.layout === 'none') return { ok: false, reason: { key: 'channelPanes.refusal.noChannels' } };
      return set.layout === 'single-file' ? openSections(id, set, monaco) : openFiles(id, set, monaco);
    } finally {
      opening = false;
    }
  }

  function newView(layout: View['layout'], docId: DocId, monaco: Monaco): View {
    return {
      layout,
      docId,
      recs: [],
      notShown: [],
      outsideLines: 0,
      stack: null,
      monaco,
      disposables: [],
      hooks: new Map(),
      lastSet: null,
      alignment: null,
      paneMarks: [],
      alignKey: '',
      place: null,
      jumpCache: new Map(),
      noopRedoAt: null,
    };
  }

  function emptyRec(channel: ChannelRef, docId: DocId): PaneRec {
    return { channel, docId, groupId: '', model: null, proj: null, registration: null, modelListener: null, restore: [], gone: false };
  }

  function openSections(id: DocId, set: ChannelSet, monaco: Monaco): { ok: true } | { ok: false; reason: Msg } {
    const sections = set.members.filter((m) => m.kind === 'section').map((m) => m.channel);
    if (sections.length < 2) return { ok: false, reason: { key: 'channelPanes.refusal.onlyOne' } };
    const doc = deps.editor.model(id);
    if (!doc) return { ok: false, reason: { key: 'channelPanes.refusal.notLoaded' } };
    const cursorLine = deps.editor.cursor()?.line ?? null;
    const v = newView('single-file', id, monaco);
    const languageId = deps.docs.get(id)?.profileId ?? 'plaintext';
    const shown = sections.slice(0, MAX_CHANNEL_PANES);
    v.notShown = sections.slice(MAX_CHANNEL_PANES).map((c) => c.id);
    v.outsideLines = lineOutsideCount(set);
    v.lastSet = set;
    for (const channel of shown) {
      const proj = projectChannel(set, channel.id);
      if (proj === null) continue;
      const rec = emptyRec(channel, id);
      rec.proj = proj;
      rec.model = makePaneModel(v, rec, projectedLines(proj, (a, b) => deps.editor.getLines(id, a, b)), languageId);
      v.recs.push(rec);
    }
    if (v.recs.length < 2) {
      for (const rec of v.recs) rec.model?.dispose();
      return { ok: false, reason: { key: 'channelPanes.refusal.onlyOne' } };
    }
    // The same boundary on the program: Undo in the view goes back to the text at open and no further.
    doc.pushStackElement();
    return start(v, set, cursorLine);
  }

  function openFiles(id: DocId, set: ChannelSet, monaco: Monaco): { ok: true } | { ok: false; reason: Msg } {
    const members = set.members.flatMap((m) => (m.kind === 'file' && m.docId !== null && deps.docs.get(m.docId) !== undefined ? [{ channel: m.channel, docId: m.docId }] : []));
    if (members.length < 2) return { ok: false, reason: { key: 'channelPanes.refusal.needTwoFiles' } };
    const v = newView('multi-file', id, monaco);
    const shown = members.slice(0, MAX_CHANNEL_PANES);
    const declared = deps.channels.params(id)?.list.map((c) => c.id) ?? [];
    const shownIds = new Set(shown.map((m) => m.channel.id));
    v.notShown = declared.filter((cid) => !shownIds.has(cid));
    for (const m of shown) v.recs.push(emptyRec(m.channel, m.docId));
    v.stack = new ViewUndoStack((docId) => {
      const model = deps.editor.model(docId);
      return model ? adapter(model, originals) : undefined;
    });
    for (const rec of v.recs) v.stack.track(rec.docId);
    // A boundary on every document at open: a character typed just before the view opened must not
    // share its undo element with the first edit made in the view (Undo would walk past the open).
    v.stack.close();
    return start(v, set, deps.editor.cursor()?.line ?? null);
  }

  /** Everything the two layouts share once the panes (records, models) exist. */
  function start(v: View, set: ChannelSet, cursorLine: number | null): { ok: true } | { ok: false; reason: Msg } {
    // The wrappers first: nothing a pane does between here and the end of `start` may miss a boundary.
    for (const rec of v.recs) {
      if (v.layout === 'single-file') {
        wrapPaneModel(v, rec);
        const owner = rec;
        rec.modelListener = (rec.model as TextModel).onDidChangeContent((event) => onPaneChange(owner, event));
        register(rec);
      } else {
        wrapDocument(v, rec);
      }
    }
    v.disposables.push(deps.registerHistory({ undo: () => history('undo'), redo: () => history('redo') }));
    const focus = focusIndexFor(set, v.recs, v.docId, cursorLine);
    const contents: GroupContent[] = v.recs.map((rec) =>
      v.layout === 'single-file' ? { kind: 'pane', docId: rec.docId, channelId: rec.channel.id } : { kind: 'document', docId: rec.docId, channelId: rec.channel.id },
    );
    view = v;
    let groupIds: GroupId[];
    try {
      groupIds = deps.editor.openGroups({ layout: 'channels', contents, focus });
    } catch (err) {
      teardown(v);
      view = null;
      console.error('channel view: the groups could not be opened', err);
      return { ok: false, reason: { key: 'channelPanes.refusal.notLoaded' } };
    }
    v.recs.forEach((rec, i) => {
      rec.groupId = groupIds[i];
    });
    const focused = v.recs[focus];
    if (v.layout === 'single-file' && cursorLine !== null && focused.proj !== null) {
      const line = paneLineOf(focused.proj, cursorLine);
      if (line !== null) v.place = { index: focus, line };
    }

    // Listeners: the document's content, the groups, the channel service, the editors.
    v.disposables.push(
      deps.editor.onDidChangeContent((docId, change) => onDocChange(docId, change)),
      deps.editor.onDidCreateModel((docId) => onModelCreated(docId)),
      deps.editor.onDidAttach(() => {
        if (view !== null) hookEditors(view);
      }),
      deps.editor.onDidFocusGroup(() => onFocus()),
      subscribeGroups(),
      subscribeRevision(),
    );
    align(v, true);
    hookEditors(v);
    publish();
    deps.status.show(t('channelPanes.status.opened', { count: v.recs.length }));
    return { ok: true };
  }

  function subscribeGroups(): Disposable {
    return deps.editor.groups.subscribe((groups) => onGroups(groups));
  }

  function subscribeRevision(): Disposable {
    let first = true;
    return deps.channels.revision.subscribe(() => {
      if (first) {
        first = false;
        return;
      }
      const v = view;
      if (ownFresh > 0) return;
      if (v === null || closing || v.layout !== 'single-file') {
        if (v !== null && v.layout === 'multi-file') {
          alignDirty = true;
          schedule();
        }
        return;
      }
      const set = deps.channels.forDoc(v.docId);
      if (set === v.lastSet) return;
      applySet(v, set, undefined, null);
    });
  }

  function onFocus(): void {
    const v = view;
    if (v === null || closing) return;
    if (v.stack !== null) v.stack.close();
    else deps.editor.model(v.docId)?.pushStackElement();
  }

  /** A document got a new model (a reload from disk): one file per channel re-wraps it and forgets its entries. */
  function onModelCreated(docId: DocId): void {
    const v = view;
    if (v === null) return;
    if (v.layout === 'multi-file') {
      const rec = v.recs.find((r) => r.docId === docId);
      if (!rec) return;
      for (const restore of rec.restore.splice(0)) restore();
      wrapDocument(v, rec);
      v.stack?.forget(docId);
      alignDirty = true;
      schedule();
      return;
    }
    if (docId === v.docId) {
      const set = freshSet(docId);
      applySet(v, set, undefined, null);
    }
  }

  /** The groups changed: a pane closed by its close button leaves the view; fewer than two panes is no channel view. */
  function onGroups(groups: EditorGroupsState): void {
    const v = view;
    if (v === null || closing) return;
    if (groups.layout !== 'channels') {
      // The service went back to one editor (a tab of another document, Close Split, a closed pane...).
      teardown(v);
      view = null;
      publish();
      return;
    }
    const matching = (rec: PaneRec, content: GroupContent | null): boolean =>
      content !== null && content.docId === rec.docId && 'channelId' in content && content.channelId === rec.channel.id;
    const kept: PaneRec[] = [];
    for (const rec of v.recs) {
      const group = groups.groups.find((g) => matching(rec, g.content));
      if (group) {
        rec.groupId = group.id;
        kept.push(rec);
      } else {
        dropRec(v, rec);
      }
    }
    v.recs = kept;
    // Group ids are positions: when a pane closes, the editors of the later groups stay mounted and
    // are given the next pane's model. An editor whose group no longer shows its hook's pane is
    // unhooked (listener, zones, marks) and hooked again for the pane it shows now; the zones and
    // marks follow with the scheduled alignment, after the service has set the new models.
    let rehook = false;
    const live = deps.editor.groupViews();
    for (const hook of [...v.hooks.values()]) {
      const group = live.find((g) => g.editor === hook.editor);
      if (!group || !v.recs.includes(hook.rec) || hook.rec.groupId !== group.id) {
        unhook(v, hook);
        rehook = true;
      }
    }
    if (rehook) v.alignKey = '';
    hookEditors(v, false);
    alignDirty = true;
    schedule();
    publish();
  }

  /** A pane the user closed: its channel is not shown any more. */
  function dropRec(v: View, rec: PaneRec): void {
    for (const hook of [...v.hooks.values()]) {
      if (hook.rec === rec) unhook(v, hook);
    }
    releaseRec(v, rec);
    v.notShown = [...v.notShown, rec.channel.id];
    fixes.delete(rec);
  }

  function releaseRec(v: View, rec: PaneRec): void {
    for (const restore of rec.restore.splice(0)) restore();
    rec.modelListener?.dispose();
    rec.modelListener = null;
    if (rec.model !== null) paneSources.delete(rec.model);
    rec.registration?.();
    rec.registration = null;
    if (v.layout === 'multi-file') v.stack?.untrack(rec.docId);
    rec.model?.dispose();
    rec.model = null;
  }

  // -- close ------------------------------------------------------------------------------------------------------

  /** Closes the view because the program no longer has what it needs, and says why. */
  function end(v: View, messageKey: 'channelPanes.status.closedGone' | 'channelPanes.status.closedMachine' | 'channelPanes.status.closedSlow'): void {
    deps.status.show(t(messageKey), { error: true });
    closeView(v);
  }

  function closeView(v: View): void {
    closing = true;
    try {
      deps.editor.closeGroups();
    } finally {
      closing = false;
    }
    teardown(v);
    view = null;
    publish();
  }

  /** Everything the view put on the editors and the models, taken away; the panes' models are disposed. */
  function teardown(v: View): void {
    for (const hook of [...v.hooks.values()]) unhook(v, hook);
    for (const dispose of v.disposables.splice(0)) dispose();
    for (const rec of v.recs) releaseRec(v, rec);
    v.stack?.dispose();
    v.stack = null;
    fixes.clear();
    alignDirty = false;
    forwarding = null;
    trace = null;
  }

  function close(): void {
    const v = view;
    if (v === null) return;
    closeView(v);
  }

  return {
    state: { subscribe: state.subscribe },
    open,
    close,
    undo: () => history('undo'),
    redo: () => history('redo'),
    flush(): void {
      runScheduled();
      const v = view;
      if (v !== null) hookEditors(v);
    },
  };
}

/** The application-wide channel view (`ctx.channelPanes`). */
export const channelPanes: ChannelPaneService = createChannelPanes({
  editor: appEditor,
  docs: appDocs,
  channels: appChannels,
  loadMonaco: getMonaco,
  registerHistory: registerPaneHistory,
  status: appStatus,
  createNode: () => document.createElement('div'),
  defer: (fn) => queueMicrotask(fn),
  jumpLines: (id, channelOf) => computeJumpLines(appEditor.getLines(id, 1, appEditor.getLineCount(id)), appMachines.effective(id).cp, channelOf),
});
