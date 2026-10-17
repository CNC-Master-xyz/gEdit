// Motion colours in the editor (Phase 3 plan AD-34, §6.6; P3.7). Owner: P3.7.
//
// A thin coloured mark in the line-decorations margin beside every line that moves: rapid,
// straight, arc, thread or cycle. The kind of a line is `core/nc/motion.ts`; this file is
// the part that talks to the editor.
//
//  - **Only the visible lines** (plus `MOTION_BUDGETS.marginLines` above and below) carry
//    marks, never the whole program, and never more than `maxMarks` at once. One decorations
//    collection per editor instance, replaced in one `set()` call.
//  - **One collection per group editor** (P4e, Phase 4 plan §6.7 rule 6): every editor of
//    `groupViews()` is painted from its own visible range, and `onDidAttach` and `groups` tell
//    of new ones. A channel pane's visible lines are pane lines: they are mapped to document
//    lines, read with one `statesAfter` per run of consecutive document lines, and the marks
//    are set at the pane's own lines; the whole update stays within `MAX_LINES` lines per
//    group.
//  - **One update per animation frame.** A scroll, an edit, a state that became known
//    (`modal.changed`), a document or model switch, a machine or profile change and the
//    setting only *schedule* the update; the editor's keystroke path does nothing else.
//  - **One `statesAfter` call per update**, for the lines `first - 1 … last`: the state
//    after the line above is the `before` of the first line. A state the index has not
//    reached yet is `null`, and then nothing is marked: a guess is never painted. The
//    service bumps `changed` for every slice of every document, which is too often to ask
//    again each time: the update is asked for only when `modal.revisionOf` of the group's
//    document is not the number the last update saw (an edit, a rebuild, or a slice that
//    reached a line this update waited for), and a repaint that would set the marks that
//    are already there (and no edit moved them) sets nothing.
//  - A scroll inside the range that was marked last time, away from its edges, needs no
//    update (the margin is what makes a short scroll free). Everything else asks again.
//  - The colours are CSS custom properties `--gedit-motion-<kind>` on the document element,
//    set from `MOTION_COLORS` for the theme in force and again when it changes.
//
// The tokens of the lines come from the tokenizer with the profile and database the
// modal index was built from: the document's effective view. That view is asked for once
// per document and kept; it is asked again when a machine or a profile changes, when the
// document's profile id changes, and once after a pause in typing (the variant a lathe's
// program is detected as can change with the text; asking `machines.effective` on every
// keystroke would detect over the whole program each time).
//
// Nothing here imports Monaco: the editor is reached through the slice below, so a unit
// test hands over a fake. `contrib/motionColors.ts` wires the real services.

import './motionColors.css';
import { maskComments } from '$lib/core/nc/mask';
import { MOTION_BUDGETS, MOTION_CLASS_PREFIX, MOTION_COLORS, MOTION_KINDS, motionOfLine } from '$lib/core/nc/motion';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import type { CodeDb } from '$lib/core/codes/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { LineState, NcToken } from '$lib/core/nc/types';
import type { Disposable, DocId, DocumentStore, EditorService, ModalService } from '$lib/app/types';
import type { Readable } from 'svelte/store';

/** The class every mark carries; the colour class `gedit-motion-<kind>` follows it. */
export const MOTION_MARK_CLASS = 'gedit-motion-mark';

/**
 * Lines of the document read in front of the first marked line, so that a block continued
 * over several lines (a Klartext `~` list) is tokenized the way the index tokenized it.
 */
export const LOOKBACK_LINES = 8;

/** How long after the last edit the document's view is asked for again (the modal service's `KEY_CHECK_DELAY_MS`). */
export const VIEW_CHECK_DELAY_MS = 300;

/** The most lines one update looks at: `statesAfter` reads one state more than there are lines, and takes at most 1,000. */
export const MAX_LINES = Math.min(MOTION_BUDGETS.maxMarks, 999);

/** The slice of Monaco's decorations collection used here. */
export interface MotionCollection {
  set(decorations: MotionDecoration[]): unknown;
  clear(): void;
}

/** One mark: an empty range at the start of a line, with the margin class. */
export interface MotionDecoration {
  range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
  options: { linesDecorationsClassName: string };
}

/** The slice of an `IStandaloneCodeEditor` used here. */
export interface MotionEditor {
  getModel(): unknown;
  getVisibleRanges(): { startLineNumber: number; endLineNumber: number }[];
  onDidScrollChange(cb: () => void): { dispose(): void };
  onDidChangeModel(cb: () => void): { dispose(): void };
  onDidLayoutChange(cb: () => void): { dispose(): void };
  createDecorationsCollection(decorations?: MotionDecoration[]): MotionCollection;
}

/** A channel pane's mapping (`PaneSource`): its lines are not the document's. */
export interface MotionPane {
  docLine(paneLine: number): number;
  model(): { getLineCount(): number };
}

/** One group editor and what it shows (`GroupView`). */
export interface MotionGroupView {
  id: string;
  editor: MotionEditor;
  docId: DocId;
  /** Set for a channel pane; null for a group that shows the document itself. */
  pane: MotionPane | null;
}

/** One document's effective view: what the modal index was built from. */
export interface MotionView {
  cp: CompiledProfile;
  db: CodeDb;
}

export interface MotionColorsDeps {
  editor: Pick<EditorService, 'getLines' | 'getLineCount' | 'onDidAttach' | 'onDidActivate' | 'onDidChangeContent'> & {
    model(id: DocId): unknown;
    /** Every live group editor, in display order. */
    groupViews(): MotionGroupView[];
    /** The layout or the focus changed; a new group editor appears with `onDidAttach`. Optional for a test with one editor. */
    groups?: Readable<unknown>;
  };
  docs: Pick<DocumentStore, 'get' | 'list'>;
  modal: Pick<ModalService, 'statesAfter' | 'changed' | 'revisionOf'>;
  /** The document's effective view, or null while its profile is unknown. Called rarely (see the header). */
  effective(id: DocId): MotionView | null;
  /** Whether a document is an NC program (a `.json` or `.py` file is not). */
  isNc(id: DocId): boolean;
  /** `assist.motionColors`. */
  enabled: Readable<boolean>;
  /** The theme in force. */
  theme: Readable<'light' | 'dark'>;
  machineRevision?: Readable<number>;
  profileRevision?: Readable<number>;
  /** Runs `fn` on the next animation frame. */
  frame(fn: () => void): Disposable;
  /** Runs `fn` after `ms`. */
  schedule(fn: () => void, ms: number): Disposable;
  /** Sets a custom property on the document element. */
  setProperty(name: string, value: string): void;
  viewCheckDelayMs?: number;
}

export interface MotionColors {
  /** Installs the listeners. The disposer removes every mark and every listener. */
  start(): Disposable;
  /** Runs the update now instead of in the next frame (tests, the harness). */
  flush(): void;
}

/** The custom property of a kind. */
export function motionVariable(kind: string): string {
  return `--${MOTION_CLASS_PREFIX}${kind}`;
}

interface Painted {
  id: DocId;
  model: unknown;
  /** The lines the marks cover (the visible range plus the margin), in the editor's own lines. */
  from: number;
  to: number;
  /** The visible lines at the time. */
  visibleFirst: number;
  visibleLast: number;
  /** The states were all there (no null answer). */
  complete: boolean;
  /** The marks as set, as `line:class` text; null when none were set (an incomplete update). */
  key: string | null;
}

/** One mark before it is a decoration: the editor line and the class. */
interface Mark {
  line: number;
  className: string;
}

/** What one group editor carries: its collection, its listeners and what it was last painted with. */
interface Slot {
  editor: MotionEditor;
  collection: MotionCollection;
  hooks: { dispose(): void }[];
  painted: Painted | null;
  /** Something that can change a mark happened since the last update (an edit, the setting, a revision). */
  dirty: boolean;
  /** An edit happened since the marks were set: the editor has moved them, so they are set again. */
  edited: boolean;
  /** The document this editor showed at the last update, and `modal.revisionOf` of it as that update read it. */
  docId: DocId | null;
  seenRevision: number;
  /** The editor shows a channel pane: its lines are not the document's, so an edit anywhere may move them. */
  pane: boolean;
  /**
   * An edit since the last update was below the lines the marks cover, and none reached them: the
   * text and the states of those lines are the same as when they were painted, so the index moving
   * on after the edit (the revision) changes none of them. Another group of the split view, far
   * above the edit, repaints nothing.
   */
  explained: boolean;
}

export function createMotionColors(deps: MotionColorsDeps): MotionColors {
  const delay = deps.viewCheckDelayMs ?? VIEW_CHECK_DELAY_MS;
  let started = false;
  let frame: Disposable | null = null;
  let viewCheck: Disposable | null = null;
  let enabled = true;
  const slots = new Map<MotionEditor, Slot>();
  const views = new Map<DocId, { profileId: string; view: MotionView | null }>();
  let stops: Disposable[] = [];

  function schedule(): void {
    if (!started || frame !== null) return;
    frame = deps.frame(() => {
      frame = null;
      update();
    });
  }

  function markDirty(slot: Slot): void {
    slot.dirty = true;
    schedule();
  }

  function markAllDirty(): void {
    for (const slot of slots.values()) slot.dirty = true;
    schedule();
  }

  function viewOf(id: DocId): MotionView | null {
    const profileId = deps.docs.get(id)?.profileId ?? '';
    const known = views.get(id);
    if (known !== undefined && known.profileId === profileId) return known.view;
    const view = deps.effective(id);
    views.set(id, { profileId, view });
    return view;
  }

  function clearMarks(slot: Slot): void {
    slot.collection.clear();
    slot.painted = null;
    slot.edited = true;
  }

  /**
   * `modal.changed` fired: ask for an update only when a shown document's index changed in a way a
   * mark can show. Whether it did is decided in the update, per group: an edit below the lines a
   * group's marks cover (`explained`) accounts for the index moving on, and the listeners of the
   * service and the index may run in any order, so the edit is not known yet here.
   */
  function onModalChanged(): void {
    let any = slots.size === 0;
    for (const slot of slots.values()) {
      if (slot.docId === null || deps.modal.revisionOf(slot.docId) !== slot.seenRevision) any = true;
    }
    if (any) schedule();
  }

  /** One collection and its listeners per live group editor; the slot of an editor that is gone is let go of. */
  function sync(shown: MotionGroupView[]): void {
    const live = new Set<MotionEditor>(shown.map((view) => view.editor));
    for (const [editor, slot] of [...slots]) {
      if (live.has(editor)) continue;
      for (const hook of slot.hooks) hook.dispose();
      slots.delete(editor);
    }
    for (const view of shown) {
      if (slots.has(view.editor)) continue;
      const editor = view.editor;
      const slot: Slot = {
        editor,
        collection: editor.createDecorationsCollection(),
        hooks: [],
        painted: null,
        dirty: true,
        edited: true,
        docId: null,
        seenRevision: -1,
        pane: false,
        explained: false,
      };
      slot.hooks.push(
        editor.onDidScrollChange(() => schedule()),
        editor.onDidLayoutChange(() => schedule()),
        editor.onDidChangeModel(() => markDirty(slot)),
      );
      slots.set(editor, slot);
    }
  }

  /** The kinds of lines `from … to` of `id`, one `statesAfter` call. Null while a state is unknown. */
  function paint(id: DocId, view: MotionView, from: number, to: number): Mark[] | null {
    const states = deps.modal.statesAfter(id, from - 1, to);
    if (states === null) return null;
    const start = Math.max(1, from - LOOKBACK_LINES);
    const lines = deps.editor.getLines(id, start, to);
    let lineState: LineState | undefined;
    const marks: Mark[] = [];
    for (let n = start; n <= to; n++) {
      const text = lines[n - start] ?? '';
      const result = tokenizeLine(text, view.cp, lineState);
      lineState = result.state;
      if (n < from) continue;
      const before = states[n - from];
      const after = states[n - from + 1];
      if (before === undefined || after === undefined) break; // the document ended inside the range
      const kind = motionOfLine(result.tokens as NcToken[], before, after, view.cp, view.db);
      if (kind === null) continue;
      marks.push({ line: n, className: `${MOTION_MARK_CLASS} ${MOTION_CLASS_PREFIX}${kind}` });
    }
    return marks;
  }

  /**
   * The marks of the editor lines `from … to`: the document's own lines, or for a channel pane one
   * `paint` per run of consecutive document lines (the pane's lines are the document's with other
   * channels' lines left out), set at the pane's lines. Null while a state is unknown.
   */
  function paintRange(group: MotionGroupView, view: MotionView, from: number, to: number, memo: Map<string, Mark[] | null>): Mark[] | null {
    const pane = group.pane;
    if (pane === null) {
      // Two groups at the same place (a split just made) read the same lines once.
      const key = `${group.docId}:${from}:${to}`;
      if (memo.has(key)) return memo.get(key) ?? null;
      const marks = paint(group.docId, view, from, to);
      memo.set(key, marks);
      return marks;
    }
    const marks: Mark[] = [];
    let at = from;
    while (at <= to) {
      let end = at;
      while (end < to && pane.docLine(end + 1) === pane.docLine(end) + 1) end++;
      const first = pane.docLine(at);
      const run = paint(group.docId, view, first, pane.docLine(end));
      if (run === null) return null;
      for (const mark of run) marks.push({ line: at + (mark.line - first), className: mark.className });
      at = end + 1;
    }
    return marks;
  }

  function decorations(marks: Mark[]): MotionDecoration[] {
    return marks.map((mark) => ({
      range: { startLineNumber: mark.line, startColumn: 1, endLineNumber: mark.line, endColumn: 1 },
      options: { linesDecorationsClassName: mark.className },
    }));
  }

  function updateSlot(slot: Slot, group: MotionGroupView, memo: Map<string, Mark[] | null>): void {
    const { editor, collection } = slot;
    const id = group.docId;
    // Before the states are read, so an index that moves during the update asks again.
    const revision = deps.modal.revisionOf(id);
    // The index moved since this group was painted, and no edit below its lines explains it.
    if (slot.docId === id && revision !== slot.seenRevision && !slot.explained) slot.dirty = true;
    slot.docId = id;
    slot.pane = group.pane !== null;
    slot.seenRevision = revision;
    slot.explained = false;
    if (!enabled || !deps.isNc(id)) {
      if (slot.painted !== null || slot.dirty) clearMarks(slot);
      slot.dirty = false;
      return;
    }
    const model = group.pane === null ? deps.editor.model(id) : group.pane.model();
    if (model === undefined || editor.getModel() !== model) {
      clearMarks(slot);
      return;
    }
    const ranges = editor.getVisibleRanges();
    if (ranges.length === 0) return; // hidden, or not laid out yet
    let first = Infinity;
    let last = 0;
    for (const range of ranges) {
      first = Math.min(first, range.startLineNumber);
      last = Math.max(last, range.endLineNumber);
    }
    const count = group.pane === null ? deps.editor.getLineCount(id) : group.pane.model().getLineCount();
    last = Math.min(last, count);
    if (last < first) return;

    // A scroll that stays inside what is marked, away from its edges, needs no update. Near
    // an edge the marks are recentred before the lines run out.
    const was = slot.painted;
    if (!slot.dirty && was !== null && was.complete && was.id === id && was.model === model) {
      const slack = MOTION_BUDGETS.marginLines / 2;
      const topOk = was.from === 1 || first - was.from >= slack;
      const bottomOk = was.to >= count || was.to - last >= slack;
      if (first >= was.from && last <= was.to && topOk && bottomOk) return;
    }

    const view = viewOf(id);
    if (view === null) {
      clearMarks(slot);
      slot.dirty = false;
      return;
    }
    let from = Math.max(1, first - MOTION_BUDGETS.marginLines);
    let to = Math.min(count, last + MOTION_BUDGETS.marginLines);
    if (to - from + 1 > MAX_LINES) {
      // A very tall editor: the visible lines first, then as much margin as the budget leaves.
      const spare = Math.max(0, MAX_LINES - (last - first + 1));
      from = Math.max(1, first - Math.floor(spare / 2));
      to = Math.min(count, from + MAX_LINES - 1);
    }
    const marks = paintRange(group, view, from, to, memo);
    slot.dirty = false;
    if (marks === null) {
      // Not known yet: no mark, and ask again when the index moves (`modal.changed`).
      collection.clear();
      slot.edited = true;
      slot.painted = { id, model, from, to, visibleFirst: first, visibleLast: last, complete: false, key: null };
      return;
    }
    const key = marks.map((mark) => `${mark.line}:${mark.className}`).join('|');
    const same = !slot.edited && was !== null && was.complete && was.id === id && was.model === model && was.key === key;
    if (!same) collection.set(decorations(marks));
    slot.edited = false;
    slot.painted = { id, model, from, to, visibleFirst: first, visibleLast: last, complete: true, key };
  }

  function update(): void {
    const shown = deps.editor.groupViews();
    sync(shown);
    // What this update has read already, by document and lines.
    const memo = new Map<string, Mark[] | null>();
    for (const group of shown) {
      const slot = slots.get(group.editor);
      if (slot !== undefined) updateSlot(slot, group, memo);
    }
  }

  function applyTheme(mode: 'light' | 'dark'): void {
    const colors = MOTION_COLORS[mode];
    for (const kind of MOTION_KINDS) deps.setProperty(motionVariable(kind), colors[kind]);
  }

  /** After a pause in typing the document's view is read again (a detected variant can have changed). */
  function armViewCheck(): void {
    viewCheck?.();
    viewCheck = deps.schedule(() => {
      viewCheck = null;
      views.clear();
      markAllDirty();
    }, delay);
  }

  /** The profiles of the documents the groups show, as one text: a dialect switch changes it. */
  function profilesShown(): string {
    return deps.editor
      .groupViews()
      .map((group) => deps.docs.get(group.docId)?.profileId ?? '')
      .join('|');
  }

  return {
    start(): Disposable {
      if (started) return () => {};
      started = true;
      let firstEnabled = true;
      let firstChanged = true;
      let firstGroups = true;
      let shownProfiles: string | undefined;
      stops = [
        deps.theme.subscribe((mode) => applyTheme(mode)),
        deps.enabled.subscribe((value) => {
          enabled = value;
          if (firstEnabled) {
            firstEnabled = false;
            return;
          }
          markAllDirty();
        }),
        // The index moved (an edit, an idle slice, a rebuild after a machine switch): ask
        // again. Coalesced into one update per frame; nothing is cached across it, because
        // a state can change without any other sign.
        deps.modal.changed.subscribe(() => {
          if (firstChanged) {
            firstChanged = false;
            return;
          }
          onModalChanged();
        }),
        deps.editor.onDidChangeContent((id, change) => {
          let shown = false;
          let repaint = false;
          for (const slot of slots.values()) {
            if (slot.docId !== id) continue;
            shown = true;
            // An edit below the lines a group's marks cover cannot change them (a mark depends on
            // the lines above it); the other group of a split view is not repainted for it.
            const painted = slot.painted;
            if (!slot.pane && !slot.dirty && painted !== null && painted.complete && change.startLine > painted.to) {
              slot.explained = true;
              continue;
            }
            // The keystroke path: schedule and nothing else.
            slot.dirty = true;
            slot.edited = true;
            slot.explained = false;
            repaint = true;
          }
          if (!shown) return;
          if (repaint) schedule();
          armViewCheck();
        }),
        deps.editor.onDidActivate(() => markAllDirty()),
        // A new editor gets a slot of its own, dirty; the others have nothing to repaint.
        deps.editor.onDidAttach(() => schedule()),
        // A dialect switch changes the document's profile id; the list emits for many other reasons.
        deps.docs.list.subscribe(() => {
          const profiles = profilesShown();
          if (profiles === shownProfiles) return;
          shownProfiles = profiles;
          markAllDirty();
        }),
      ];
      // A new layout (split view opened, a pane closed) brings editors in and out.
      if (deps.editor.groups !== undefined) {
        stops.push(
          deps.editor.groups.subscribe(() => {
            if (firstGroups) {
              firstGroups = false;
              return;
            }
            schedule();
          }),
        );
      }
      for (const revision of [deps.machineRevision, deps.profileRevision]) {
        if (revision === undefined) continue;
        let first = true;
        stops.push(
          revision.subscribe(() => {
            if (first) {
              first = false;
              return;
            }
            views.clear();
            markAllDirty();
          }),
        );
      }
      schedule();
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        started = false;
        for (const stop of stops) stop();
        stops = [];
        frame?.();
        frame = null;
        viewCheck?.();
        viewCheck = null;
        for (const slot of slots.values()) {
          slot.collection.clear();
          for (const hook of slot.hooks) hook.dispose();
        }
        slots.clear();
        views.clear();
      };
    },

    flush(): void {
      frame?.();
      frame = null;
      update();
    },
  };
}
