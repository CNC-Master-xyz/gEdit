// One undo history for the channel view of a program with one file per channel (Phase 4 plan
// AD-51, §6.7 rule 15; the owner, 2026-10-17: "one undo history for the side-by-side view, not
// one per channel"). Contract by the P4e prelude, implemented by P4.22a.
//
// For a program with channel sections the panes are views of one document and its own history
// is the view's (§6.7 rule 11). With one file per channel each pane is a document with a Monaco
// history of its own, so the view keeps an **order** over those histories while it is open:
//
//  - An entry is a run of edits in one document: `{ docId, from, to }`, the document's
//    `alternativeVersionId` before the run and after it. The stack never holds text; the
//    documents' own undo stacks do, and Undo asks the document to undo until it is back at
//    `from` (Monaco's alternative version id returns to the value before an undone element).
//  - An entry starts with the first edit after a boundary and ends at the next boundary:
//    `close()` pushes a stack element on **every** tracked document, so an entry's `from` is
//    always the end of a Monaco undo element and Undo can stop exactly there. The pane module
//    calls `close()` when the focus moves to another pane, before and after a paste, a command
//    and a script, and on a cursor move that is not typing (the boundaries of §6.7 rule 11).
//  - Undo (Ctrl+Z in any pane, Edit ▸ Undo) undoes the newest entry, wherever it was made, and
//    answers its document so the view focuses that pane; Redo the reverse. A new edit after an
//    Undo drops the redo entries, as Monaco does.
//  - A document whose version is not the entry's `to` when its turn comes (its model was
//    replaced by a reload, or it was edited while not tracked) is not undone through the view:
//    its entries are dropped (`forget`), and the call answers null for it with the reason, so the
//    status bar can say to close the view and undo in that file itself.
//  - When the view closes the stack is dropped. Each document keeps its whole Monaco history,
//    so Ctrl+Z in a document then undoes that document's own last edits, as before the view.
//    Saving is per file, as always (the active pane's file; Save All saves every pane's).

import type { DocId } from '$lib/app/types';

/** What the stack needs of a document's model; Monaco's `ITextModel` has all of it. */
export interface UndoableModel {
  getAlternativeVersionId(): number;
  undo(): void | Promise<void>;
  redo(): void | Promise<void>;
  canUndo(): boolean;
  canRedo(): boolean;
  pushStackElement(): void;
}

export interface ViewUndoEntry {
  docId: DocId;
  /** `alternativeVersionId` before the run of edits. */
  from: number;
  /** `alternativeVersionId` after it. */
  to: number;
}

export type ViewUndoAnswer = { docId: DocId } | { docId: DocId; refused: 'changedOutside' } | null;

/**
 * The order of the edits of the view's documents. Versions are Monaco's `alternativeVersionId`:
 * it grows with every edit and an undone element puts the id back to the one before it, so along
 * one document's undo chain the ids only grow, and "undo until the version is `from`" cannot be
 * overshot unnoticed (a version below `from` means `from` was never on the chain).
 */
export class ViewUndoStack {
  /** The live model of a document, or undefined once it is closed. */
  readonly modelOf: (id: DocId) => UndoableModel | undefined;

  private readonly versions = new Map<DocId, number>(); // the last version the stack knows, per tracked document
  private undoEntries: ViewUndoEntry[] = [];
  private redoEntries: ViewUndoEntry[] = [];
  private open: ViewUndoEntry | null = null;
  private busy = false; // the stack's own undo or redo is running: the events it causes are not edits

  constructor(modelOf: (id: DocId) => UndoableModel | undefined) {
    this.modelOf = modelOf;
  }

  /** Starts tracking `docId` (a pane of the view shows it): its current version is the base. */
  track(docId: DocId): void {
    const model = this.modelOf(docId);
    if (model) this.versions.set(docId, model.getAlternativeVersionId());
  }

  /** Stops tracking `docId` (its pane closed) and drops its entries. */
  untrack(docId: DocId): void {
    this.forget(docId);
    this.versions.delete(docId);
  }

  /** A content change of `docId` the stack did not cause itself: opens or extends the entry. */
  noteEdit(docId: DocId): void {
    if (this.busy) return;
    const model = this.modelOf(docId);
    const known = this.versions.get(docId);
    if (!model || known === undefined) return;
    const now = model.getAlternativeVersionId();
    if (this.open !== null && this.open.docId !== docId) this.close();
    if (this.open === null) {
      if (now === known) return;
      this.open = { docId, from: known, to: now };
      this.redoEntries = [];
    } else {
      this.open.to = now;
    }
    this.versions.set(docId, now);
  }

  /** A boundary: ends the open entry and pushes a stack element on every tracked document. */
  close(): void {
    if (this.open !== null) {
      this.undoEntries.push(this.open);
      this.open = null;
    }
    for (const id of this.versions.keys()) this.modelOf(id)?.pushStackElement();
  }

  /** Undoes the newest entry; answers its document, or null when there is none. */
  undo(): ViewUndoAnswer {
    if (this.open !== null) this.close();
    for (;;) {
      const entry = this.undoEntries[this.undoEntries.length - 1];
      if (!entry) return null;
      const model = this.modelOf(entry.docId);
      if (!model) {
        this.forget(entry.docId);
        continue;
      }
      if (model.getAlternativeVersionId() !== entry.to || !this.walk(model, entry.from, 'undo')) {
        this.forget(entry.docId);
        return { docId: entry.docId, refused: 'changedOutside' };
      }
      this.undoEntries.pop();
      this.redoEntries.push(entry);
      this.versions.set(entry.docId, entry.from);
      return { docId: entry.docId };
    }
  }

  /** Redoes the newest undone entry; answers its document, or null when there is none. */
  redo(): ViewUndoAnswer {
    for (;;) {
      const entry = this.redoEntries[this.redoEntries.length - 1];
      if (!entry) return null;
      const model = this.modelOf(entry.docId);
      if (!model) {
        this.forget(entry.docId);
        continue;
      }
      if (model.getAlternativeVersionId() !== entry.from || !this.walk(model, entry.to, 'redo')) {
        this.forget(entry.docId);
        return { docId: entry.docId, refused: 'changedOutside' };
      }
      this.redoEntries.pop();
      this.undoEntries.push(entry);
      this.versions.set(entry.docId, entry.to);
      return { docId: entry.docId };
    }
  }

  /**
   * Steps `model` back (or forward) until its version is `target`. If the target is passed
   * without being met, or the model has nothing more to step through, the steps taken are taken
   * back and the answer is false.
   */
  private walk(model: UndoableModel, target: number, way: 'undo' | 'redo'): boolean {
    const down = way === 'undo';
    let steps = 0;
    let ok = false;
    this.busy = true;
    try {
      for (;;) {
        const version = model.getAlternativeVersionId();
        if (version === target) {
          ok = true;
          break;
        }
        if (down ? version < target : version > target) break;
        if (!(down ? model.canUndo() : model.canRedo())) break;
        if (down) void model.undo();
        else void model.redo();
        steps++;
      }
      if (!ok) for (; steps > 0; steps--) void (down ? model.redo() : model.undo());
    } finally {
      this.busy = false;
    }
    return ok;
  }

  /** Drops every entry of `docId` (its model was replaced, or it was closed). */
  forget(docId: DocId): void {
    this.undoEntries = this.undoEntries.filter((e) => e.docId !== docId);
    this.redoEntries = this.redoEntries.filter((e) => e.docId !== docId);
    if (this.open?.docId === docId) this.open = null;
    if (this.versions.has(docId)) {
      const model = this.modelOf(docId);
      if (model) this.versions.set(docId, model.getAlternativeVersionId());
      else this.versions.delete(docId);
    }
  }

  /** The view closed: drops every entry and stops tracking. Each document keeps its own history. */
  dispose(): void {
    this.undoEntries = [];
    this.redoEntries = [];
    this.open = null;
    this.versions.clear();
  }

  /** The entries, oldest first (tests and the harness). */
  entries(): { undo: readonly ViewUndoEntry[]; redo: readonly ViewUndoEntry[] } {
    return { undo: [...this.undoEntries, ...(this.open ? [this.open] : [])], redo: [...this.redoEntries] };
  }
}
