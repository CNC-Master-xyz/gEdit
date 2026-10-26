// Bookmark names and Bookmark All Matches in the decoration service (Phase 4 plan §6.5 rules 4 and 6),
// against the REAL Monaco text model (`realModel.ts`): what an edit, an undo and a search do to a
// bookmark is stated by Monaco itself, not by a fake that is told the answer. The editor around the
// model is a fake (the find widget's state, the focused group); the fake-model cases of the older
// service are in `bookmarks.test.ts`.

import { readable } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import type * as MonacoApi from 'monaco-editor/esm/vs/editor/editor.api.js';
import { createBookmarks, type BookmarkMonaco } from './bookmarks';
import { realModel, type RealModel } from './realModel';
import type { Disposable, DocId, DocumentStore, EditorService, GroupView, PaneSource } from '$lib/app/types';

const MONACO = {
  editor: {
    TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 },
    OverviewRulerLane: { Left: 1 },
    EditorOption: { wordSeparators: 129 },
  },
} as unknown as BookmarkMonaco;

/** Monaco's default word separators, what the editor answers for `EditorOption.wordSeparators`. */
const SEPARATORS = '`~!@#$%^&*()-=+[{]}\\|;:\'",.<>/?';

interface FindState {
  searchString: string;
  isRegex: boolean;
  matchCase: boolean;
  wholeWord: boolean;
  searchScope: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }[] | null;
}

type Model = RealModel & {
  getLineCount(): number;
  getLineContent(line: number): string;
};

function numbered(count: number, text = (n: number) => `G1 X${n}`): string {
  return Array.from({ length: count }, (_, i) => text(i + 1)).join('\n');
}

/** The service over real models; `groupViews` is what the find widget's editor is. */
function setup(texts: Record<DocId, string> = { d1: numbered(40) }) {
  const models = new Map<DocId, Model>(Object.entries(texts).map(([id, text]) => [id, realModel(text) as Model]));
  const deltaCalls: string[] = [];
  for (const [id, model] of models) {
    const original = model.deltaDecorations.bind(model);
    model.deltaDecorations = (old, news) => {
      deltaCalls.push(id);
      return original(old, news);
    };
  }
  const state = {
    active: 'd1' as DocId | null,
    cursor: 1,
    reveals: [] as { id: DocId; line: number }[],
    find: { searchString: '', isRegex: false, matchCase: false, wholeWord: false, searchScope: null } as FindState,
    /** The editor's own model: the document's, unless a test shows a pane. */
    editorModel: undefined as Model | undefined,
    pane: null as PaneSource | null,
    views: 'one' as 'one' | 'none',
    hasFindController: true,
  };
  const contentListeners: ((id: DocId) => void)[] = [];

  const fakeEditor = () =>
    ({
      getModel: () => state.editorModel ?? models.get(state.active ?? 'd1'),
      getContribution: (id: string) =>
        id === 'editor.contrib.findController' && state.hasFindController ? { getState: () => state.find } : null,
      getOption: (option: number) => (option === 129 ? SEPARATORS : undefined),
    }) as unknown as MonacoApi.editor.IStandaloneCodeEditor;

  const editor = {
    model: (id: DocId) => models.get(id) as unknown as MonacoApi.editor.ITextModel | undefined,
    cursor: () => ({ line: state.cursor, column: 1, selectedChars: 0, selections: 1 }),
    reveal: (id: DocId, line: number) => state.reveals.push({ id, line }),
    updateOptions: () => {},
    groupViews: (): GroupView[] =>
      state.views === 'none'
        ? []
        : [
            { id: 'g2', editor: fakeEditor(), docId: 'other', pane: null, focused: false },
            { id: 'g1', editor: fakeEditor(), docId: state.active ?? 'd1', pane: state.pane, focused: true },
          ],
    editorInstance: () => (state.views === 'none' ? undefined : fakeEditor()),
    groups: readable({ layout: 'single', groups: [], focused: 'g1' }),
    onDidAttach: (): Disposable => () => {},
    onDidChangeContent: (cb: (id: DocId) => void): Disposable => {
      contentListeners.push(cb);
      return () => void contentListeners.splice(contentListeners.indexOf(cb), 1);
    },
    onDidCreateModel: (): Disposable => () => {},
  } as unknown as EditorService;
  const docs = {
    getActiveId: () => state.active,
    list: { subscribe: (cb: () => void) => (cb(), () => {}) },
  } as unknown as DocumentStore;

  const bookmarks = createBookmarks({ editor, docs });
  bookmarks.install(MONACO);
  return {
    bookmarks,
    state,
    models,
    deltaCalls,
    model: (id: DocId = 'd1') => models.get(id)!,
    find: (patch: Partial<FindState>) => Object.assign(state.find, patch),
    /** An edit of `id`, with the content event the editor service would send. */
    edit(id: DocId, range: [number, number, number, number], text: string): void {
      models.get(id)!.pushEditOperations(
        null,
        [{ range: { startLineNumber: range[0], startColumn: range[1], endLineNumber: range[2], endColumn: range[3] }, text }],
        () => null,
      );
      for (const cb of [...contentListeners]) cb(id);
    },
  };
}

describe('names', () => {
  it('names the bookmark on a line, and sets the bookmark when the line has none', () => {
    const h = setup();
    expect(h.bookmarks.setName('d1', 7, '  Tool  change ')).toBe('Tool change');
    expect(h.bookmarks.lines('d1')).toEqual([7]);
    expect(h.bookmarks.list('d1')).toEqual([{ docId: 'd1', line: 7, name: 'Tool change', text: 'G1 X7' }]);
  });

  it('renames a named bookmark and clears the name without removing the bookmark', () => {
    const h = setup();
    h.bookmarks.setName('d1', 7, 'one');
    expect(h.bookmarks.setName('d1', 7, 'two')).toBe('two');
    expect(h.bookmarks.list('d1')[0].name).toBe('two');

    expect(h.bookmarks.setName('d1', 7, null)).toBeNull();
    expect(h.bookmarks.lines('d1')).toEqual([7]);
    expect(h.bookmarks.list('d1')[0].name).toBeUndefined();
    expect('name' in h.bookmarks.list('d1')[0]).toBe(false);
  });

  it('clearing the name of a line that has no bookmark changes nothing', () => {
    const h = setup();
    expect(h.bookmarks.setName('d1', 7, null)).toBeNull();
    expect(h.bookmarks.lines('d1')).toEqual([]);
    expect(h.deltaCalls).toEqual([]);
  });

  it('refuses a name it cannot keep and a line outside the document, and changes nothing', () => {
    const h = setup();
    h.bookmarks.setName('d1', 3, 'keep');
    const calls = h.deltaCalls.length;
    for (const name of ['', '   ', 'x'.repeat(61), 'a\u0007b', 'a\nb']) {
      expect(h.bookmarks.setName('d1', 5, name), JSON.stringify(name)).toBeNull();
    }
    expect(h.bookmarks.setName('d1', 0, 'zero')).toBeNull();
    expect(h.bookmarks.setName('d1', 41, 'past the end')).toBeNull();
    expect(h.bookmarks.setName('d1', 2.5, 'fraction')).toBeNull();
    expect(h.bookmarks.setName('nobody', 1, 'x')).toBeNull();
    expect(h.bookmarks.lines('d1')).toEqual([3]);
    expect(h.deltaCalls.length).toBe(calls);
    expect(h.bookmarks.list('d1')[0].name).toBe('keep');
  });

  it('shows the line text trimmed and cut at 120 characters, and an empty line as empty text', () => {
    const h = setup({ d1: `   G1 X10.   \n${'x'.repeat(200)}\n` });
    for (const line of [1, 2, 3]) h.bookmarks.toggle('d1', line);
    expect(h.bookmarks.list('d1').map((info) => info.text)).toEqual(['G1 X10.', 'x'.repeat(120), '']);
  });

  it('lists nothing for a document without a model or without bookmarks', () => {
    const h = setup();
    expect(h.bookmarks.list('d1')).toEqual([]);
    expect(h.bookmarks.list('nobody')).toEqual([]);
    expect(h.bookmarks.marks('nobody')).toEqual([]);
  });

  it('removes the name with the bookmark: toggling off, Clear Bookmarks and remove', () => {
    const h = setup();
    h.bookmarks.setName('d1', 3, 'a');
    h.bookmarks.setName('d1', 5, 'b');
    h.bookmarks.setName('d1', 9, 'c');

    h.bookmarks.toggle('d1', 3);
    expect(h.bookmarks.list('d1').map((i) => [i.line, i.name])).toEqual([[5, 'b'], [9, 'c']]);
    // Toggled on again it is a new bookmark, without the old name.
    h.bookmarks.toggle('d1', 3);
    expect(h.bookmarks.list('d1').map((i) => [i.line, i.name])).toEqual([[3, undefined], [5, 'b'], [9, 'c']]);

    expect(h.bookmarks.remove('d1', 5)).toBe(true);
    expect(h.bookmarks.remove('d1', 5)).toBe(false);
    expect(h.bookmarks.marks('d1')).toEqual([{ line: 3 }, { line: 9, name: 'c' }]);

    h.bookmarks.clear('d1');
    expect(h.bookmarks.marks('d1')).toEqual([]);
    h.bookmarks.toggle('d1', 9);
    expect(h.bookmarks.marks('d1')).toEqual([{ line: 9 }]);
  });

  it('keeps the other names when one bookmark is toggled', () => {
    const h = setup();
    h.bookmarks.setName('d1', 3, 'a');
    h.bookmarks.toggle('d1', 6);
    expect(h.bookmarks.marks('d1')).toEqual([{ line: 3, name: 'a' }, { line: 6 }]);
  });
});

describe('a name follows its bookmark (real model)', () => {
  it('moves with the line when lines are inserted or removed above it, and comes back with undo', () => {
    const h = setup();
    h.bookmarks.setName('d1', 10, 'Finish');
    h.bookmarks.setName('d1', 20, 'Drill');

    h.edit('d1', [2, 1, 2, 1], 'N1\nN2\nN3\n'); // three lines in
    expect(h.bookmarks.marks('d1')).toEqual([{ line: 13, name: 'Finish' }, { line: 23, name: 'Drill' }]);

    h.model().undo();
    expect(h.bookmarks.marks('d1')).toEqual([{ line: 10, name: 'Finish' }, { line: 20, name: 'Drill' }]);

    h.edit('d1', [1, 1, 3, 1], ''); // two lines out
    expect(h.bookmarks.marks('d1')).toEqual([{ line: 8, name: 'Finish' }, { line: 18, name: 'Drill' }]);
    h.model().undo();
    expect(h.bookmarks.marks('d1')).toEqual([{ line: 10, name: 'Finish' }, { line: 20, name: 'Drill' }]);
  });

  it('stays on its line while text is typed at the start or the end of it', () => {
    const h = setup();
    h.bookmarks.setName('d1', 5, 'Here');
    h.edit('d1', [5, 1, 5, 1], 'N5 ');
    h.edit('d1', [5, 9, 5, 9], ' (note)');
    expect(h.bookmarks.marks('d1')).toEqual([{ line: 5, name: 'Here' }]);
    expect(h.model().getLineCount()).toBe(40);
  });

  it('is one bookmark with the name of the upper one when an edit joins two on one line', () => {
    const h = setup();
    h.bookmarks.setName('d1', 5, 'upper');
    h.bookmarks.setName('d1', 6, 'lower');
    h.edit('d1', [5, 6, 6, 1], ''); // the line break between 5 and 6 goes: 6 joins 5
    expect(h.bookmarks.lines('d1')).toEqual([5]);
    expect(h.bookmarks.list('d1')).toHaveLength(1);
    expect(h.bookmarks.list('d1')[0]).toMatchObject({ line: 5, name: 'upper' });
    // The write after it replaces the two decorations with one.
    h.bookmarks.setName('d1', 9, 'other');
    expect(h.bookmarks.marks('d1')).toEqual([{ line: 5, name: 'upper' }, { line: 9, name: 'other' }]);
  });

  it('takes the first name among them when the upper bookmark has none (owner Q3, 2026-10-20)', () => {
    const h = setup();
    h.bookmarks.toggle('d1', 5);
    h.bookmarks.setName('d1', 6, 'lower');
    h.edit('d1', [5, 6, 6, 1], '');
    expect(h.bookmarks.marks('d1')).toEqual([{ line: 5, name: 'lower' }]);
    // The write after it keeps that name.
    h.bookmarks.toggle('d1', 9);
    expect(h.bookmarks.marks('d1')).toEqual([{ line: 5, name: 'lower' }, { line: 9 }]);
  });

  it('keeps the upper name when both have one, and the first of several names when more than two meet', () => {
    const h = setup();
    h.bookmarks.setName('d1', 5, 'upper');
    h.bookmarks.setName('d1', 6, 'lower');
    h.edit('d1', [5, 6, 6, 1], '');
    expect(h.bookmarks.marks('d1')).toEqual([{ line: 5, name: 'upper' }]);
    h.bookmarks.setName('d1', 12, 'second');
    h.bookmarks.setName('d1', 14, 'third');
    h.bookmarks.toggle('d1', 13);
    h.edit('d1', [11, 1, 14, 1], ''); // lines 11-13 go; 12, 13 and 14 meet on line 11
    expect(h.bookmarks.marks('d1')).toEqual([{ line: 5, name: 'upper' }, { line: 11, name: 'second' }]);
  });

  it('keeps the name of a surviving bookmark when a range with unnamed ones is deleted onto it', () => {
    // Delete Block Range 10-20: unnamed bookmarks inside the range collapse onto line 10, where the
    // bookmark that was on line 21 now is; its name is not lost.
    const h = setup();
    h.bookmarks.toggle('d1', 15);
    h.bookmarks.setName('d1', 21, 'Finish');
    h.edit('d1', [10, 1, 21, 1], '');
    expect(h.bookmarks.marks('d1')).toEqual([{ line: 10, name: 'Finish' }]);
    expect(h.bookmarks.list('d1')).toHaveLength(1);
  });

  it('says what Monaco does with a bookmark whose line is deleted: it moves to the line that takes its place and keeps its name', () => {
    // Recorded, not wished for: an empty decoration does not die with its line (the owner keeps it so, 2026-10-19: the bookmark moves to the next line).
    const h = setup();
    h.bookmarks.setName('d1', 5, 'doomed');
    h.edit('d1', [5, 1, 6, 1], '');
    expect(h.bookmarks.marks('d1')).toEqual([{ line: 5, name: 'doomed' }]);
  });
});

describe('restore', () => {
  it('puts lines and names back, in one decoration update', () => {
    const h = setup();
    h.bookmarks.restore('d1', [
      { line: 9, name: 'Nine' },
      { line: 3 },
      { line: 20, name: ' Twenty ' },
    ]);
    expect(h.bookmarks.marks('d1')).toEqual([{ line: 3 }, { line: 9, name: 'Nine' }, { line: 20, name: 'Twenty' }]);
    expect(h.deltaCalls).toEqual(['d1']);
  });

  it('reads the memo as untrusted: lines outside the document, repeated lines and bad names', () => {
    const h = setup();
    h.bookmarks.restore('d1', [
      { line: 0, name: 'zero' },
      { line: 41, name: 'past the end' },
      { line: 2.5 },
      { line: 4, name: 'first' },
      { line: 4, name: 'second' },
      { line: 6, name: 'x'.repeat(61) },
      { line: 8, name: 'a\u0007' },
      { line: 10, name: 5 as unknown as string },
      null as unknown as { line: number },
    ]);
    expect(h.bookmarks.marks('d1')).toEqual([{ line: 4, name: 'first' }, { line: 6 }, { line: 8 }, { line: 10 }]);
  });

  it('keeps at most 200 bookmarks, the lowest lines', () => {
    const h = setup({ d1: numbered(500) });
    h.bookmarks.restore('d1', Array.from({ length: 300 }, (_, i) => ({ line: 300 - i })));
    expect(h.bookmarks.lines('d1')).toHaveLength(200);
    expect(h.bookmarks.lines('d1')[0]).toBe(1);
    expect(h.bookmarks.lines('d1').at(-1)).toBe(200);
  });

  it('replaces what was there, names included', () => {
    const h = setup();
    h.bookmarks.setName('d1', 3, 'old');
    h.bookmarks.restore('d1', [{ line: 3 }]);
    expect(h.bookmarks.marks('d1')).toEqual([{ line: 3 }]);
  });

  it('does nothing for a document without a model', () => {
    const h = setup();
    h.bookmarks.restore('nobody', [{ line: 1, name: 'x' }]);
    expect(h.bookmarks.marks('nobody')).toEqual([]);
  });

  it('set (the older call) keeps working and carries no names', () => {
    const h = setup();
    h.bookmarks.setName('d1', 3, 'old');
    h.bookmarks.set('d1', [3, 4]);
    expect(h.bookmarks.marks('d1')).toEqual([{ line: 3 }, { line: 4 }]);
  });
});

describe('onDidChange', () => {
  it('fires for a toggle, a name, a remove, a clear, a restore and an edit of a bookmarked document', () => {
    const h = setup({ d1: numbered(40), d2: numbered(10) });
    const seen: DocId[] = [];
    const stop = h.bookmarks.onDidChange((id) => seen.push(id));
    h.bookmarks.toggle('d1', 3);
    h.bookmarks.setName('d1', 3, 'a');
    h.bookmarks.setName('d2', 2, 'b');
    h.bookmarks.remove('d1', 3);
    h.bookmarks.restore('d1', [{ line: 1 }]);
    h.bookmarks.clear('d1');
    expect(seen).toEqual(['d1', 'd1', 'd2', 'd1', 'd1', 'd1']);

    seen.length = 0;
    h.edit('d2', [1, 1, 1, 1], 'N');
    expect(seen).toEqual(['d2']);
    // A document without bookmarks reports nothing for an edit: typing in it is free.
    h.edit('d1', [1, 1, 1, 1], 'N');
    expect(seen).toEqual(['d2']);

    stop();
    h.bookmarks.toggle('d1', 5);
    expect(seen).toEqual(['d2']);
  });

  it('survives a listener that throws', () => {
    const h = setup();
    const seen: DocId[] = [];
    const quiet = console.error;
    console.error = () => {};
    try {
      h.bookmarks.onDidChange(() => {
        throw new Error('boom');
      });
      h.bookmarks.onDidChange((id) => seen.push(id));
      h.bookmarks.toggle('d1', 3);
    } finally {
      console.error = quiet;
    }
    expect(seen).toEqual(['d1']);
    expect(h.bookmarks.lines('d1')).toEqual([3]);
  });
});

describe('addAllMatches', () => {
  const PROGRAM = [
    'O1000', //            1
    'G54 G90', //          2
    'G1 X10. F200', //     3
    'g1 x20.', //          4
    '(G1 in a comment)', // 5
    'G10 L2 P1', //        6
    'M30', //              7
  ].join('\n');

  it('says noDocument without an editor or before Monaco is installed', () => {
    const h = setup({ d1: PROGRAM });
    h.state.views = 'none';
    expect(h.bookmarks.addAllMatches()).toEqual({ ok: false, reason: 'noDocument' });

    const fresh = createBookmarks({
      editor: { groupViews: () => [], editorInstance: () => undefined, model: () => undefined } as unknown as EditorService,
      docs: { getActiveId: () => 'd1' } as unknown as DocumentStore,
    });
    expect(fresh.addAllMatches()).toEqual({ ok: false, reason: 'noDocument' });
  });

  it('says noSearch for an empty search string or an editor without a find controller, and marks nothing', () => {
    const h = setup({ d1: PROGRAM });
    expect(h.bookmarks.addAllMatches()).toEqual({ ok: false, reason: 'noSearch' });
    h.state.hasFindController = false;
    h.find({ searchString: 'G1' });
    expect(h.bookmarks.addAllMatches()).toEqual({ ok: false, reason: 'noSearch' });
    expect(h.bookmarks.lines('d1')).toEqual([]);
  });

  it('bookmarks every line the search finds, once per line, without moving the cursor', () => {
    const h = setup({ d1: PROGRAM });
    h.state.cursor = 7;
    h.find({ searchString: 'g1' });
    // Case does not matter by default; "G10" matches too (no whole word), and so does the comment.
    expect(h.bookmarks.addAllMatches()).toEqual({ ok: true, marked: 4, already: 0 });
    expect(h.bookmarks.lines('d1')).toEqual([3, 4, 5, 6]);
    expect(h.state.reveals).toEqual([]);
    expect(h.state.cursor).toBe(7);
    // One call, one decoration update.
    expect(h.deltaCalls).toEqual(['d1']);
  });

  it('counts several matches on one line once', () => {
    const h = setup({ d1: 'X1 X2 X3\nY1\nX4' });
    h.find({ searchString: 'X' });
    expect(h.bookmarks.addAllMatches()).toEqual({ ok: true, marked: 2, already: 0 });
    expect(h.bookmarks.lines('d1')).toEqual([1, 3]);
  });

  it('follows match case', () => {
    const h = setup({ d1: PROGRAM });
    h.find({ searchString: 'g1', matchCase: true });
    expect(h.bookmarks.addAllMatches()).toEqual({ ok: true, marked: 1, already: 0 });
    expect(h.bookmarks.lines('d1')).toEqual([4]);
  });

  it('follows whole word, with the editor word separators', () => {
    const h = setup({ d1: PROGRAM });
    h.find({ searchString: 'G1', wholeWord: true });
    // "G10" is not the word "G1"; the comment's "(G1 " is, between separators.
    expect(h.bookmarks.addAllMatches()).toEqual({ ok: true, marked: 3, already: 0 });
    expect(h.bookmarks.lines('d1')).toEqual([3, 4, 5]);
  });

  it('follows the regular expression', () => {
    const h = setup({ d1: PROGRAM });
    h.find({ searchString: '^G1 ', isRegex: true, matchCase: true });
    expect(h.bookmarks.addAllMatches()).toEqual({ ok: true, marked: 1, already: 0 });
    expect(h.bookmarks.lines('d1')).toEqual([3]);
  });

  it('says noMatch for a pattern that finds nothing and for one that does not compile', () => {
    const h = setup({ d1: PROGRAM });
    h.find({ searchString: 'G99' });
    expect(h.bookmarks.addAllMatches()).toEqual({ ok: false, reason: 'noMatch', matches: 0 });
    h.find({ searchString: '([unclosed', isRegex: true });
    expect(h.bookmarks.addAllMatches()).toEqual({ ok: false, reason: 'noMatch', matches: 0 });
    expect(h.bookmarks.lines('d1')).toEqual([]);
  });

  it('searches only the selection when "find in selection" is on', () => {
    const h = setup({ d1: PROGRAM });
    h.find({
      searchString: 'G1',
      searchScope: [{ startLineNumber: 4, startColumn: 1, endLineNumber: 5, endColumn: 10 }],
    });
    expect(h.bookmarks.addAllMatches()).toEqual({ ok: true, marked: 2, already: 0 });
    expect(h.bookmarks.lines('d1')).toEqual([4, 5]);
  });

  it('searches several selections, and an empty scope list is the whole document', () => {
    const h = setup({ d1: PROGRAM });
    h.find({
      searchString: 'G1',
      searchScope: [
        { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 13 },
        { startLineNumber: 6, startColumn: 1, endLineNumber: 6, endColumn: 10 },
      ],
    });
    expect(h.bookmarks.addAllMatches()).toEqual({ ok: true, marked: 2, already: 0 });
    expect(h.bookmarks.lines('d1')).toEqual([3, 6]);

    h.bookmarks.clear('d1');
    h.find({ searchScope: [] });
    expect(h.bookmarks.addAllMatches()).toEqual({ ok: true, marked: 4, already: 0 });
  });

  it('keeps the bookmarks that are there with their names, and counts them as already', () => {
    const h = setup({ d1: PROGRAM });
    h.bookmarks.setName('d1', 4, 'Keep me');
    h.bookmarks.toggle('d1', 7);
    h.find({ searchString: 'g1' });
    expect(h.bookmarks.addAllMatches()).toEqual({ ok: true, marked: 3, already: 1 });
    expect(h.bookmarks.marks('d1')).toEqual([{ line: 3 }, { line: 4, name: 'Keep me' }, { line: 5 }, { line: 6 }, { line: 7 }]);
  });

  it('is idempotent: a second call marks nothing and says all of them had one', () => {
    const h = setup({ d1: PROGRAM });
    h.find({ searchString: 'g1' });
    h.bookmarks.addAllMatches();
    expect(h.bookmarks.addAllMatches()).toEqual({ ok: true, marked: 0, already: 4 });
  });

  describe('the limit', () => {
    const many = numbered(500, (n) => `G1 X${n}`);

    it('marks 200 lines and refuses 201, all or nothing', () => {
      const h = setup({ d1: many });
      // 200 lines match: the lines 1..200 hold "G1 X1" .. "G1 X200" but so does everything below it, so search a window.
      h.find({ searchString: 'G1', searchScope: [{ startLineNumber: 1, startColumn: 1, endLineNumber: 200, endColumn: 99 }] });
      expect(h.bookmarks.addAllMatches()).toEqual({ ok: true, marked: 200, already: 0 });
      h.bookmarks.clear('d1');

      h.find({ searchScope: [{ startLineNumber: 1, startColumn: 1, endLineNumber: 201, endColumn: 99 }] });
      expect(h.bookmarks.addAllMatches()).toEqual({ ok: false, reason: 'tooMany', matches: 201 });
      expect(h.bookmarks.lines('d1')).toEqual([]);
    });

    it('counts the bookmarks that are there: 150 matches on top of 60 elsewhere is too many, nothing marked', () => {
      const h = setup({ d1: many });
      h.bookmarks.restore('d1', Array.from({ length: 60 }, (_, i) => ({ line: 400 + i, name: i === 0 ? 'kept' : undefined })));
      h.find({ searchString: 'G1', searchScope: [{ startLineNumber: 1, startColumn: 1, endLineNumber: 150, endColumn: 99 }] });
      const answer = h.bookmarks.addAllMatches();
      expect(answer).toEqual({ ok: false, reason: 'tooMany', matches: 150 });
      expect(h.bookmarks.lines('d1')).toHaveLength(60);
      expect(h.bookmarks.marks('d1')[0]).toEqual({ line: 400, name: 'kept' });
    });

    it('reports the number of lines, not of matches', () => {
      const h = setup({ d1: Array.from({ length: 300 }, () => 'X X X').join('\n') });
      h.find({ searchString: 'X' });
      expect(h.bookmarks.addAllMatches()).toEqual({ ok: false, reason: 'tooMany', matches: 300 });
    });
  });

  it('reads the focused group, not the first one', () => {
    const h = setup({ d1: PROGRAM });
    h.find({ searchString: 'M30' });
    expect(h.bookmarks.addAllMatches()).toEqual({ ok: true, marked: 1, already: 0 });
    expect(h.bookmarks.lines('d1')).toEqual([7]);
  });

  it('maps the lines of a channel pane to document lines, and marks the document', () => {
    // The pane shows document lines 11 to 14 as its lines 1 to 4.
    const doc = numbered(30, (n) => `D${n}`);
    const h = setup({ d1: doc });
    const paneModel = realModel('G1 X1\nG0\nG1 X2\nM5') as Model;
    h.state.editorModel = paneModel;
    h.state.pane = {
      docId: 'd1',
      channelId: 'S1',
      model: () => paneModel as unknown as MonacoApi.editor.ITextModel,
      docLine: (line: number) => line + 10,
      paneLine: (line: number) => (line >= 11 && line <= 14 ? line - 10 : null),
    };
    h.find({ searchString: 'G1' });
    expect(h.bookmarks.addAllMatches()).toEqual({ ok: true, marked: 2, already: 0 });
    expect(h.bookmarks.lines('d1')).toEqual([11, 13]);
    // The document's model got the bookmarks; the pane's did not get a second copy of them from here.
    expect(h.deltaCalls.filter((id) => id === 'd1')).toHaveLength(1);
  });
});

describe('the limit of 200 bookmarks per document (Toggle Bookmark refuses the 201st)', () => {
  function fill(h: ReturnType<typeof setup>): void {
    for (let line = 1; line <= 200; line += 1) expect(h.bookmarks.toggle('d1', line)).toBe('set');
  }

  it('refuses a 201st bookmark, keeps the 200, and still removes one', () => {
    const h = setup({ d1: numbered(300) });
    fill(h);
    const calls = h.deltaCalls.length;
    expect(h.bookmarks.toggle('d1', 201)).toBe('full');
    expect(h.bookmarks.lines('d1')).toHaveLength(200);
    expect(h.bookmarks.lines('d1')).not.toContain(201);
    expect(h.deltaCalls.length).toBe(calls);
    // Removing one is always allowed, and then the next one fits again.
    expect(h.bookmarks.toggle('d1', 7)).toBe('removed');
    expect(h.bookmarks.toggle('d1', 201)).toBe('set');
    expect(h.bookmarks.toggle('d1', 202)).toBe('full');
    expect(h.bookmarks.lines('d1')).toHaveLength(200);
  });

  it('uses the cursor line when no line is given, and says nothing was done without a document', () => {
    const h = setup({ d1: numbered(300) });
    fill(h);
    h.state.cursor = 250;
    expect(h.bookmarks.toggle()).toBe('full');
    h.state.active = null;
    expect(h.bookmarks.toggle()).toBe('none');
  });

  it('refuses to name a line that has no bookmark yet when the document is full', () => {
    const h = setup({ d1: numbered(300) });
    fill(h);
    expect(h.bookmarks.setName('d1', 250, 'one too many')).toBeNull();
    expect(h.bookmarks.lines('d1')).toHaveLength(200);
    // A bookmark that is there can still be named.
    expect(h.bookmarks.setName('d1', 5, 'kept')).toBe('kept');
  });
});
