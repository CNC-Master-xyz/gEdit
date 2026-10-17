// One undo history for the channel view of a program with one file per channel (Phase 4 plan
// §6.7 rule 15; the owner, 2026-10-17). Runs on Monaco's real text model and undo service
// (`monaco/realModel.ts`), so the version arithmetic is Monaco's own.

import { describe, expect, it } from 'vitest';
import { realModel, type RealModel } from '$lib/monaco/realModel';
import { ViewUndoStack, type UndoableModel } from './viewUndo';

function type(model: RealModel, line: number, text: string): void {
  const column = model.getLineMaxColumn(line);
  model.pushEditOperations(null, [{ range: { startLineNumber: line, startColumn: column, endLineNumber: line, endColumn: column }, text }], () => null);
}

function setup(): { a: RealModel; b: RealModel; stack: ViewUndoStack } {
  const a = realModel('A1\nA2');
  const b = realModel('B1\nB2');
  const models = new Map<string, RealModel>([
    ['a', a],
    ['b', b],
  ]);
  const stack = new ViewUndoStack((id) => models.get(id) as unknown as UndoableModel | undefined);
  stack.track('a');
  stack.track('b');
  return { a, b, stack };
}

describe('the view’s undo history (§6.7 rule 15)', () => {
  it('undoes the newest edit wherever it was made, and answers its document', () => {
    const { a, b, stack } = setup();
    type(a, 1, 'x');
    stack.noteEdit('a');
    stack.close();
    type(b, 2, 'y');
    stack.noteEdit('b');
    stack.close();
    type(a, 2, 'z');
    stack.noteEdit('a');
    stack.close();

    expect(stack.undo()).toEqual({ docId: 'a' });
    expect(a.getValue()).toBe('A1x\nA2');
    expect(stack.undo()).toEqual({ docId: 'b' });
    expect(b.getValue()).toBe('B1\nB2');
    expect(stack.undo()).toEqual({ docId: 'a' });
    expect(a.getValue()).toBe('A1\nA2');
    expect(stack.undo()).toBeNull();

    expect(stack.redo()).toEqual({ docId: 'a' });
    expect(a.getValue()).toBe('A1x\nA2');
  });

  it('takes back a run of edits as one step, even when Monaco split it into several elements', () => {
    const { a, stack } = setup();
    type(a, 1, 'x');
    stack.noteEdit('a');
    a.pushStackElement(); // Monaco's own boundary inside the run (a word typed, a cursor jump)
    type(a, 1, 'y');
    stack.noteEdit('a');
    stack.close();
    expect(stack.undo()).toEqual({ docId: 'a' });
    expect(a.getValue()).toBe('A1\nA2');
    expect(stack.entries().undo).toEqual([]);
  });

  it('drops the redo entries on a new edit', () => {
    const { a, b, stack } = setup();
    type(a, 1, 'x');
    stack.noteEdit('a');
    stack.close();
    stack.undo();
    type(b, 1, 'y');
    stack.noteEdit('b');
    stack.close();
    expect(stack.entries().redo).toEqual([]);
    expect(stack.redo()).toBeNull();
  });

  it('refuses to undo a document that changed behind its back, and forgets its entries', () => {
    const { a, stack } = setup();
    type(a, 1, 'x');
    stack.noteEdit('a');
    stack.close();
    type(a, 2, 'q'); // not noted: as if the model had been edited while not tracked
    expect(stack.undo()).toEqual({ docId: 'a', refused: 'changedOutside' });
    expect(a.getValue()).toBe('A1x\nA2q');
    expect(stack.entries().undo).toEqual([]);
  });
});

describe('extra cases (P4.22a)', () => {
  it('ends the open entry when another document is edited without a boundary', () => {
    const { a, b, stack } = setup();
    type(a, 1, 'x');
    stack.noteEdit('a');
    type(b, 1, 'y');
    stack.noteEdit('b');
    expect(stack.entries().undo.map((e) => e.docId)).toEqual(['a', 'b']);
    expect(stack.undo()).toEqual({ docId: 'b' });
    expect(b.getValue()).toBe('B1\nB2');
    expect(a.getValue()).toBe('A1x\nA2');
  });

  it('undoes the open run too, without a boundary being called first', () => {
    const { a, stack } = setup();
    type(a, 1, 'x');
    stack.noteEdit('a');
    expect(stack.undo()).toEqual({ docId: 'a' });
    expect(a.getValue()).toBe('A1\nA2');
  });

  it('redoes in the order undone, and answers null at the ends', () => {
    const { a, b, stack } = setup();
    type(a, 1, 'x');
    stack.noteEdit('a');
    stack.close();
    type(b, 1, 'y');
    stack.noteEdit('b');
    stack.close();
    stack.undo();
    stack.undo();
    expect(stack.redo()).toEqual({ docId: 'a' });
    expect(stack.redo()).toEqual({ docId: 'b' });
    expect(stack.redo()).toBeNull();
    expect(a.getValue()).toBe('A1x\nA2');
    expect(b.getValue()).toBe('B1y\nB2');
    expect(stack.entries().undo.map((e) => e.docId)).toEqual(['a', 'b']);
  });

  it('does not take its own undo for an edit', () => {
    const { a, stack } = setup();
    type(a, 1, 'x');
    stack.noteEdit('a');
    stack.close();
    stack.undo();
    stack.noteEdit('a'); // the event the undo caused arrives (the caller may not filter it)
    expect(stack.entries()).toEqual({ undo: [], redo: [expect.objectContaining({ docId: 'a' })] });
    expect(stack.redo()).toEqual({ docId: 'a' });
  });

  it('refuses a redo when the document changed since, and says so', () => {
    const { a, stack } = setup();
    type(a, 1, 'x');
    stack.noteEdit('a');
    stack.close();
    stack.undo();
    type(a, 2, 'q'); // not noted
    expect(stack.redo()).toEqual({ docId: 'a', refused: 'changedOutside' });
    expect(a.getValue()).toBe('A1\nA2q');
  });

  it('forgets the entries of a document whose model was replaced, and keeps the others', () => {
    const a = realModel('A1');
    const b = realModel('B1');
    const models = new Map<string, RealModel>([
      ['a', a],
      ['b', b],
    ]);
    const stack = new ViewUndoStack((id) => models.get(id) as unknown as UndoableModel | undefined);
    stack.track('a');
    stack.track('b');
    type(a, 1, 'x');
    stack.noteEdit('a');
    stack.close();
    type(b, 1, 'y');
    stack.noteEdit('b');
    stack.close();
    models.set('a', realModel('A1 reloaded')); // the model was replaced (a restored or new document; a reload from disk keeps the model)
    stack.forget('a');
    expect(stack.entries().undo.map((e) => e.docId)).toEqual(['b']);
    // An edit of the new model starts from its own version.
    const fresh = models.get('a')!;
    type(fresh, 1, '!');
    stack.noteEdit('a');
    stack.close();
    expect(stack.undo()).toEqual({ docId: 'a' });
    expect(fresh.getValue()).toBe('A1 reloaded');
    expect(stack.undo()).toEqual({ docId: 'b' });
    expect(b.getValue()).toBe('B1');
  });

  it('keeps a reload from disk on the stack: replaceAll is one edit of the same model and one entry (CODE-9)', () => {
    const { a, stack } = setup();
    const before = a.getValue();
    // What the editor service's `replaceAll` does: a boundary, one edit of the whole text, a boundary.
    a.pushStackElement();
    a.pushEditOperations(null, [{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 2, endColumn: 3 }, text: 'A1 reloaded\nA2 reloaded\nA3 reloaded' }], () => null);
    a.pushStackElement();
    stack.noteEdit('a');
    stack.close();
    expect(stack.entries().undo).toHaveLength(1);
    expect(stack.undo()).toEqual({ docId: 'a' });
    expect(a.getValue()).toBe(before);
    expect(stack.redo()).toEqual({ docId: 'a' });
    expect(a.getValue()).toBe('A1 reloaded\nA2 reloaded\nA3 reloaded');
  });

  it('skips the entries of a document that is closed', () => {
    const a = realModel('A1');
    const b = realModel('B1');
    const models = new Map<string, RealModel>([
      ['a', a],
      ['b', b],
    ]);
    const stack = new ViewUndoStack((id) => models.get(id) as unknown as UndoableModel | undefined);
    stack.track('a');
    stack.track('b');
    type(b, 1, 'y');
    stack.noteEdit('b');
    stack.close();
    type(a, 1, 'x');
    stack.noteEdit('a');
    stack.close();
    models.delete('a');
    expect(stack.undo()).toEqual({ docId: 'b' });
    expect(b.getValue()).toBe('B1');
  });

  it('ignores edits of a document it does not track, and stops after dispose', () => {
    const { a, b, stack } = setup();
    stack.untrack('b');
    type(b, 1, 'y');
    stack.noteEdit('b');
    expect(stack.entries().undo).toEqual([]);
    type(a, 1, 'x');
    stack.noteEdit('a');
    stack.dispose();
    expect(stack.entries()).toEqual({ undo: [], redo: [] });
    expect(stack.undo()).toBeNull();
    expect(a.getValue()).toBe('A1x\nA2'); // each document keeps its own history
    a.undo();
    expect(a.getValue()).toBe('A1\nA2');
  });

  it('puts a boundary on every tracked document at close()', () => {
    const { a, b, stack } = setup();
    type(a, 1, 'x');
    stack.noteEdit('a');
    stack.close();
    type(a, 1, 'y'); // a new Monaco element, because close() pushed a boundary
    stack.noteEdit('a');
    stack.close();
    a.undo();
    expect(a.getValue()).toBe('A1x\nA2');
    void b;
  });

  it('takes back the steps when the entry’s start version is not on the document’s chain', () => {
    // A fake history whose versions skip the entry's start: the walk passes it, so it goes back.
    let chain = [10, 20, 30];
    let at = 0;
    const model: UndoableModel = {
      getAlternativeVersionId: () => chain[at],
      undo: () => void at--,
      redo: () => void at++,
      canUndo: () => at > 0,
      canRedo: () => at < chain.length - 1,
      pushStackElement: () => undefined,
    };
    const stack = new ViewUndoStack(() => model);
    stack.track('a');
    at = 2;
    stack.noteEdit('a'); // from 10, to 30
    stack.close();
    chain = [5, 20, 30]; // 10 is not there any more
    expect(stack.undo()).toEqual({ docId: 'a', refused: 'changedOutside' });
    expect(at).toBe(2);
    expect(stack.entries().undo).toEqual([]);
  });
});
