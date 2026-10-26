// The comparison, the read-only lock (AD-23) and the scratch models
// (M11: reused, never disposed, which is what closes the compare race by ordering).
//
// The modified side of the diff editor is the document's own model, and the gutter's
// revert arrows write into it through that side. Monaco is a fake here: what is checked
// is which `readOnly` the diff editor is built with and given later, not Monaco itself.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { docs } from '$lib/stores/documents';
import type { DocId } from '$lib/app/types';
import type { DiffSides } from './diff';

interface FakeModel {
  text: string;
  language: string;
  disposed: boolean;
  isDisposed(): boolean;
  getLanguageId(): string;
  setValue(text: string): void;
  dispose(): void;
  getLineCount(): number;
  getLineContent(n: number): string;
  getLineMaxColumn(n: number): number;
}

/** One decoration a fake editor was given (P4.24 word marks). */
interface FakeDecoration {
  range: [number, number, number, number];
  className: string | undefined;
}

const fake = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  models: [] as FakeModel[],
  /** What each diff editor was last given. */
  shown: [] as unknown[],
  /** The listeners of the last diff editor: `content` (either pane's text), `model`, `diff` (updated). */
  listeners: { content: [] as (() => void)[], model: [] as (() => void)[], diff: [] as (() => void)[], cursor: [] as (() => void)[] },
  /** Document ids that have no model. */
  noModel: new Set<string>(),
  /** What the diff editor shows right now, and the models that were shown while `setValue` filled them. */
  current: null as { original: unknown; modified: unknown } | null,
  filledWhileShown: [] as FakeModel[],
  /**
   * Every diff view model, as Monaco 0.55 handles them: one it builds itself from a pair
   * given to `setModel` is disposed in a `setTimeout(0)` after it is replaced; one made
   * with `createViewModel` only when its owner disposes it. While a view model is not
   * disposed, a diff it asked for may still arrive and be laid over its models' text.
   */
  viewModels: [] as { model: { original: unknown; modified: unknown }; disposed: boolean; dispose(): void }[],
  /** Models whose text changed while a live view model held them. */
  filledWhileComputing: [] as FakeModel[],
  /** What `getLineChanges()` answers (the diff Monaco computed). */
  lineChanges: null as unknown[] | null,
  /** The decoration collections of the last diff editor, by pane; `cleared` when `clear()` ran. */
  collections: [] as { side: 'original' | 'modified'; items: unknown[]; cleared: boolean }[],
}));

interface FakeViewModel {
  model: { original: unknown; modified: unknown };
  disposed: boolean;
  dispose(): void;
}

/** The lines of a fake model, split once per text (a 40,000-line model is read line by line). */
const splitLines = new WeakMap<FakeModel, { text: string; lines: string[] }>();
function linesOf(model: FakeModel): string[] {
  const known = splitLines.get(model);
  if (known && known.text === model.text) return known.lines;
  const lines = model.text.split('\n');
  splitLines.set(model, { text: model.text, lines });
  return lines;
}

function viewModel(pair: { original: unknown; modified: unknown }): FakeViewModel {
  const vm: FakeViewModel = {
    model: pair,
    disposed: false,
    dispose: () => {
      vm.disposed = true;
    },
  };
  fake.viewModels.push(vm);
  return vm;
}

function listen(list: (() => void)[], fn: () => void): { dispose(): void } {
  list.push(fn);
  return { dispose: () => void list.splice(list.indexOf(fn), 1) };
}

vi.mock('$lib/monaco/setup', () => ({
  getMonaco: async () => ({
    Range: class {
      constructor(
        public startLineNumber: number,
        public startColumn: number,
        public endLineNumber: number,
        public endColumn: number,
      ) {}
    },
    editor: {
      createModel: (text: string, language: string) => {
        const model: FakeModel = {
          text,
          language,
          disposed: false,
          isDisposed: () => model.disposed,
          getLanguageId: () => model.language,
          getLineCount: () => linesOf(model).length,
          getLineContent: (n: number) => linesOf(model)[n - 1],
          getLineMaxColumn: (n: number) => linesOf(model)[n - 1].length + 1,
          setValue: (value: string) => {
            if (fake.current && (fake.current.original === model || fake.current.modified === model)) {
              fake.filledWhileShown.push(model);
            }
            if (fake.viewModels.some((vm) => !vm.disposed && (vm.model.original === model || vm.model.modified === model))) {
              fake.filledWhileComputing.push(model);
            }
            model.text = value;
          },
          dispose: () => {
            model.disposed = true;
          },
        };
        fake.models.push(model);
        return model;
      },
      setModelLanguage: (model: FakeModel, language: string) => {
        model.language = language;
      },
      createDiffEditor: (_container: unknown, options: Record<string, unknown>) => {
        fake.created.push(options);
        let current: FakeViewModel | null = null;
        let mine = false;
        fake.listeners.content.length = 0;
        fake.listeners.model.length = 0;
        fake.listeners.diff.length = 0;
        fake.listeners.cursor.length = 0;
        fake.collections.length = 0;
        const editorStub = (side: 'original' | 'modified') => ({
          onDidFocusEditorText: () => ({ dispose: () => {} }),
          onDidChangeCursorPosition: (fn: () => void) => listen(fake.listeners.cursor, fn),
          onDidChangeModelContent: (fn: () => void) => listen(fake.listeners.content, fn),
          onDidChangeModel: (fn: () => void) => listen(fake.listeners.model, fn),
          getModel: () => (current?.model as Record<string, unknown> | undefined)?.[side] ?? null,
          createDecorationsCollection: () => {
            const collection = { side, items: [] as unknown[], cleared: false };
            fake.collections.push(collection);
            return {
              append: (list: unknown[]) => void collection.items.push(...list),
              clear: () => {
                collection.cleared = true;
                collection.items.length = 0;
              },
            };
          },
        });
        const originalStub = editorStub('original');
        const modifiedStub = editorStub('modified');
        return {
          createViewModel: (pair: { original: unknown; modified: unknown }) => viewModel(pair),
          setModel: (given: FakeViewModel | { original: unknown; modified: unknown } | null) => {
            const previous = current;
            const previousMine = mine;
            mine = given !== null && !('model' in given);
            current = given === null ? null : 'model' in given ? (given as FakeViewModel) : viewModel(given);
            // Monaco's DiffEditorWidget.setDiffModel: the old reference is let go of a tick later.
            if (previous && previousMine) setTimeout(() => previous.dispose(), 0);
            fake.current = current?.model ?? null;
            fake.shown.push(fake.current);
          },
          getModel: () => current?.model ?? null,
          onDidUpdateDiff: (fn: () => void) => listen(fake.listeners.diff, fn),
          getLineChanges: () => fake.lineChanges,
          getOriginalEditor: () => originalStub,
          getModifiedEditor: () => modifiedStub,
          dispose: () => {},
          updateOptions: (o: Record<string, unknown>) => fake.updates.push(o),
        };
      },
    },
  }),
}));

vi.mock('$lib/monaco/editorService', () => ({
  editor: { model: (id: string) => (fake.noModel.has(id) ? undefined : {}) },
}));

const { createDiff, settleCreated } = await import('./diff');

const opened: DocId[] = [];

function open(readOnly: boolean): DocId {
  const id = docs.add({
    path: null,
    untitledIndex: 80 + opened.length,
    profileId: 'fanuc-gcode',
    encoding: { encoding: 'utf-8', hasBom: false },
    eol: 'lf',
    eolMixedOnLoad: false,
    nul: { leader: 0, trailer: 0, stripped: 0 },
    textDirty: false,
    metaDirty: false,
    disk: null,
    external: 'none',
    readOnly,
    readOnlyReason: readOnly ? 'user' : null,
  });
  opened.push(id);
  return id;
}

function compare(id: DocId) {
  return createDiff({
    container: {} as HTMLElement,
    modifiedDocId: id,
    sides: sides(id),
    inline: false,
    ignoreTrimWhitespace: false,
  });
}

function sides(id: DocId, text = 'N10'): DiffSides {
  return { original: { kind: 'text', text, languageId: 'nc' }, modified: { kind: 'document', docId: id } };
}

afterEach(() => {
  for (const id of opened.splice(0)) docs.remove(id);
  fake.created.length = 0;
  fake.updates.length = 0;
  fake.shown.length = 0;
  fake.noModel.clear();
  fake.filledWhileShown.length = 0;
  fake.filledWhileComputing.length = 0;
  fake.viewModels.length = 0;
  fake.current = null;
  fake.lineChanges = null;
  fake.collections.length = 0;
});

describe('createDiff and the read-only lock', () => {
  it('leaves an editable document editable', async () => {
    (await compare(open(false))).dispose();
    expect(fake.created[0]).toMatchObject({ readOnly: false, originalEditable: false });
  });

  it('creates the diff editor with the same colour and overflow options as the main editor (B1 A9)', async () => {
    // Both creation sites feed the one shared configuration service, so they must agree.
    (await compare(open(false))).dispose();
    expect(fake.created[0]).toMatchObject({
      colorDecorators: false,
      defaultColorDecorators: 'never',
      fixedOverflowWidgets: true,
    });
    expect(fake.created[0]).not.toHaveProperty('hover');
  });

  it('locks the modified side of a locked document, revert arrows included', async () => {
    (await compare(open(true))).dispose();
    expect(fake.created[0]).toMatchObject({ readOnly: true });
  });

  it('follows the lock while the comparison is open, and stops when it closes', async () => {
    const id = open(false);
    const handle = await compare(id);
    docs.update(id, { readOnly: true, readOnlyReason: 'user' });
    docs.update(id, { readOnly: false, readOnlyReason: null });
    expect(fake.updates).toEqual([{ readOnly: true }, { readOnly: false }]);
    handle.dispose();
    docs.update(id, { readOnly: true, readOnlyReason: 'user' });
    expect(fake.updates).toHaveLength(2);
  });
});

describe('the scratch models', () => {
  it('creates one model for a text side and never disposes it', async () => {
    const id = open(false);
    const first = await compare(id);
    expect(fake.models).toHaveLength(1);
    expect(fake.models[0].text).toBe('N10');
    first.dispose();
    // Blanked, so a 50 MB file does not outlive its comparison; not disposed, so the
    // editor worker is never asked about a model that has gone.
    expect(fake.models[0]).toMatchObject({ text: '', disposed: false });
    (await compare(id)).dispose();
    expect(fake.models).toHaveLength(1);
    expect(fake.models.every((model) => !model.disposed)).toBe(true);
  });

  it('keeps one model per pane however many comparisons come and go', async () => {
    const id = open(false);
    for (let i = 0; i < 5; i++) {
      const handle = await createDiff({
        container: {} as HTMLElement,
        modifiedDocId: id,
        sides: { original: { kind: 'text', text: `A${i}`, languageId: 'nc' }, modified: { kind: 'text', text: `B${i}`, languageId: 'nc' } },
        inline: false,
        ignoreTrimWhitespace: false,
      });
      handle.dispose();
    }
    expect(fake.models).toHaveLength(2);
  });

  it('does not blank what a newer comparison shows when an older handle is disposed late', async () => {
    const id = open(false);
    const older = await compare(id);
    const newer = await createDiff({
      container: {} as HTMLElement,
      modifiedDocId: id,
      sides: sides(id, 'NEWER'),
      inline: false,
      ignoreTrimWhitespace: false,
    });
    older.dispose();
    expect(fake.models[0].text).toBe('NEWER');
    newer.dispose();
    expect(fake.models[0].text).toBe('');
  });

  it('puts new text into the same model with show() and locks a normalized modified side', async () => {
    const id = open(false);
    const handle = await compare(id);
    expect(fake.created[0]).toMatchObject({ readOnly: false });
    handle.show({
      original: { kind: 'text', text: 'G1', languageId: 'nc' },
      modified: { kind: 'text', text: 'G2', languageId: 'nc' },
    });
    expect(fake.models).toHaveLength(2);
    expect(fake.models.map((model) => model.text).sort()).toEqual(['G1', 'G2']);
    expect(fake.updates).toEqual([{ readOnly: true }]);
    handle.show(sides(id, 'RAW'));
    expect(fake.updates).toEqual([{ readOnly: true }, { readOnly: false }]);
    handle.dispose();
  });

  it('never fills a scratch model while the diff editor shows it (Illegal value for lineNumber)', async () => {
    const id = open(false);
    const handle = await compare(id);
    handle.show({
      original: { kind: 'text', text: 'G1', languageId: 'nc' },
      modified: { kind: 'text', text: 'G2', languageId: 'nc' },
    });
    handle.show({
      original: { kind: 'text', text: 'G1 X1', languageId: 'nc' },
      modified: { kind: 'text', text: 'G2 X1', languageId: 'nc' },
    });
    handle.show(sides(id, 'RAW'));
    expect(fake.filledWhileShown).toEqual([]);
    expect(fake.models).toHaveLength(2);
    expect(fake.models.every((model) => !model.disposed)).toBe(true);
    handle.dispose();
  });

  it('never changes a scratch model while a diff view model that holds it lives (the compare race)', async () => {
    // Monaco's worker diffs the text as it is when the request is posted, after a `$ping`,
    // and the view model then applies the edits it saw on top: a text change while its
    // view model lives lays an old diff over new text ("startLineNumber 5 cannot be after
    // endLineNumberExclusive 2"). Monaco disposes a view model it built itself a tick too
    // late, so the module builds and disposes them.
    const id = open(false);
    const handle = await compare(id);
    handle.show({
      original: { kind: 'text', text: 'G1', languageId: 'nc' },
      modified: { kind: 'text', text: 'G2', languageId: 'nc' },
    });
    handle.show(sides(id, 'RAW'));
    handle.dispose(); // closed before its first diff: the blank-on-close
    expect(fake.filledWhileComputing).toEqual([]);
    expect(fake.viewModels.length).toBeGreaterThan(0);
    expect(fake.viewModels.every((vm) => vm.disposed)).toBe(true);
    expect(fake.models).toHaveLength(2);
  });

  it('detaches an older comparison before a newer one refills the model it still shows', async () => {
    const id = open(false);
    const older = await compare(id);
    const newer = await createDiff({
      container: {} as HTMLElement,
      modifiedDocId: id,
      sides: sides(id, 'NEWER'),
      inline: false,
      ignoreTrimWhitespace: false,
    });
    expect(fake.filledWhileComputing).toEqual([]);
    older.dispose();
    newer.dispose();
    expect(fake.filledWhileComputing).toEqual([]);
    expect(fake.viewModels.every((vm) => vm.disposed)).toBe(true);
  });

  it('ignores a show() of the sides it already shows', async () => {
    const id = open(false);
    const given = sides(id);
    const handle = await createDiff({ container: {} as HTMLElement, modifiedDocId: id, sides: given, inline: false, ignoreTrimWhitespace: false });
    const before = fake.shown.length;
    handle.show(given);
    expect(fake.shown).toHaveLength(before);
    handle.dispose();
  });
});

describe('isCurrent (CODE-1)', () => {
  it('is false until the first diff, true after an update, false again after an edit of either pane', async () => {
    const handle = await compare(open(false));
    expect(handle.isCurrent()).toBe(false);
    fake.listeners.diff.forEach((fn) => fn());
    expect(handle.isCurrent()).toBe(true);
    // The merge's own edit: the old blocks are stale from this moment, not 200 ms later.
    fake.listeners.content.forEach((fn) => fn());
    expect(handle.isCurrent()).toBe(false);
    fake.listeners.diff.forEach((fn) => fn());
    expect(handle.isCurrent()).toBe(true);
    fake.listeners.model.forEach((fn) => fn());
    expect(handle.isCurrent()).toBe(false);
    handle.dispose();
    expect(handle.isCurrent()).toBe(false);
  });

  it('lets go of its listeners when it is disposed', async () => {
    const handle = await compare(open(false));
    handle.dispose();
    expect(fake.listeners.content).toHaveLength(0);
    expect(fake.listeners.diff).toHaveLength(0);
  });
});

describe('show() that cannot work (CODE-12)', () => {
  it('changes nothing when a document has no model, so the same call can be retried', async () => {
    const id = open(false);
    const other = open(false);
    const handle = await compare(id);
    const before = fake.models.map((m) => m.text);
    fake.noModel.add(other);
    const next: DiffSides = {
      original: { kind: 'text', text: 'SCRATCH', languageId: 'nc' },
      modified: { kind: 'document', docId: other },
    };
    expect(() => handle.show(next)).toThrow(/no model/);
    expect(fake.models.map((m) => m.text)).toEqual(before);
    fake.noModel.clear();
    handle.show(next); // not swallowed as "already shown"
    expect(fake.models.find((m) => m.text === 'SCRATCH')).toBeDefined();
    handle.dispose();
  });

  it('blanks the scratch text of a side that is a document again', async () => {
    const id = open(false);
    const handle = await compare(id);
    handle.show({
      original: { kind: 'text', text: 'REVIEW-A', languageId: 'nc' },
      modified: { kind: 'text', text: 'REVIEW-B', languageId: 'nc' },
    });
    expect(fake.models.map((m) => m.text).sort()).toEqual(['REVIEW-A', 'REVIEW-B']);
    handle.show({ original: { kind: 'text', text: 'RAW', languageId: 'nc' }, modified: { kind: 'document', docId: id } });
    expect(fake.models.map((m) => m.text).sort()).toEqual(['', 'RAW']);
    handle.dispose();
  });
});

describe('settleCreated (CODE-11)', () => {
  it('applies the toggles that were pressed while the editor was being built', () => {
    const calls: string[] = [];
    settleCreated(
      {
        show: () => calls.push('show'),
        setInline: (v) => calls.push(`inline:${v}`),
        setIgnoreTrimWhitespace: (v) => calls.push(`trim:${v}`),
      },
      { sides: null, inline: true, ignoreTrimWhitespace: true },
    );
    expect(calls).toEqual(['inline:true', 'trim:true']);
  });
});

// ---------------------------------------------------------------------------
// Word marks (P4.24, AD-52, plan §6.7 rule 17)
// ---------------------------------------------------------------------------

describe('word marks', () => {
  interface Drawn {
    line: number;
    from: number;
    to: number;
    className: string;
  }

  /** What a pane was given, as plain rows. */
  function drawn(side: 'original' | 'modified'): Drawn[] {
    return fake.collections
      .filter((c) => c.side === side)
      .flatMap((c) => c.items as { range: { startLineNumber: number; startColumn: number; endColumn: number }; options: { inlineClassName: string } }[])
      .map((d) => ({ line: d.range.startLineNumber, from: d.range.startColumn, to: d.range.endColumn, className: d.options.inlineClassName }));
  }
  const words = (rows: Drawn[]) => rows.filter((d) => d.className === 'gedit-word-changed');
  const whole = (rows: Drawn[]) => rows.filter((d) => d.className === 'gedit-word-line');
  const change = (o: [number, number], m: [number, number]) => ({
    originalStartLineNumber: o[0],
    originalEndLineNumber: o[1],
    modifiedStartLineNumber: m[0],
    modifiedEndLineNumber: m[1],
  });
  const diffUpdated = () => [...fake.listeners.diff].forEach((fn) => fn());

  async function shown(original: string, modified: string, languageId = 'fanuc-gcode') {
    const handle = await createDiff({
      container: {} as HTMLElement,
      modifiedDocId: open(false),
      sides: {
        original: { kind: 'text', text: original, languageId },
        modified: { kind: 'text', text: modified, languageId },
      },
      inline: false,
      ignoreTrimWhitespace: false,
    });
    return handle;
  }

  it('marks the whole word that differs on each side once Monaco has computed the diff (X30)', async () => {
    const handle = await shown('G0 X0.\nN10 G1 X10. F1200\nM30', 'G0 X0.\nN10 G1 X10. F1000\nM30');
    fake.lineChanges = [change([2, 2], [2, 2])];
    diffUpdated();
    // Columns are 1-based and `to` is exclusive: `F1200` is offsets 12..17 of line 2.
    expect(words(drawn('original'))).toEqual([{ line: 2, from: 13, to: 18, className: 'gedit-word-changed' }]);
    expect(words(drawn('modified'))).toEqual([{ line: 2, from: 13, to: 18, className: 'gedit-word-changed' }]);
    handle.dispose();
  });

  it('lays gedit-word-line over each line of a pair that has marks, which hides Monaco\'s character marks', async () => {
    const handle = await shown('G1 X1. F1200', 'G1 X1. F1000');
    fake.lineChanges = [change([1, 1], [1, 1])];
    diffUpdated();
    expect(whole(drawn('original'))).toEqual([{ line: 1, from: 1, to: 13, className: 'gedit-word-line' }]);
    expect(whole(drawn('modified'))).toEqual([{ line: 1, from: 1, to: 13, className: 'gedit-word-line' }]);
    handle.dispose();
  });

  it('keeps Monaco\'s marks on a pair that has no word marks (a moved word, a whole added line)', async () => {
    const handle = await shown('G1 X1. Y2.\nM5', 'G1 Y2. X1.\nM5\nM30');
    fake.lineChanges = [change([1, 1], [1, 1]), change([2, 0], [3, 3])];
    diffUpdated();
    expect(drawn('original')).toEqual([]);
    expect(drawn('modified')).toEqual([]);
    handle.dispose();
  });

  it('pairs the lines of a change in order and leaves the extra lines of the longer side alone', async () => {
    const handle = await shown('A1\nG1 F1', 'A1\nG1 F2\nG1 F3');
    fake.lineChanges = [change([2, 2], [2, 3])];
    diffUpdated();
    expect(words(drawn('original')).map((d) => d.line)).toEqual([2]);
    expect(words(drawn('modified')).map((d) => d.line)).toEqual([2]);
    handle.dispose();
  });

  it('reads each side with its own profile (the language of its model)', async () => {
    const handle = await createDiff({
      container: {} as HTMLElement,
      modifiedDocId: open(false),
      sides: {
        original: { kind: 'text', text: 'Q203=+0', languageId: 'heidenhain-klartext' },
        modified: { kind: 'text', text: 'Q203=-5', languageId: 'heidenhain-klartext' },
      },
      inline: false,
      ignoreTrimWhitespace: false,
    });
    fake.lineChanges = [change([1, 1], [1, 1])];
    diffUpdated();
    expect(words(drawn('original'))).toEqual([{ line: 1, from: 6, to: 8, className: 'gedit-word-changed' }]);
    handle.dispose();
  });

  it('marks the changed argument inside a cycle call with gedit-word-part, over the whole marked call (review NC-8)', async () => {
    const handle = await shown('CYCLE81(10,0,2,-12)', 'CYCLE81(10,0,2,-15)', 'sinumerik');
    fake.lineChanges = [change([1, 1], [1, 1])];
    diffUpdated();
    const parts = (rows: Drawn[]) => rows.filter((d) => d.className === 'gedit-word-part');
    expect(words(drawn('original'))).toEqual([{ line: 1, from: 1, to: 20, className: 'gedit-word-changed' }]);
    // `12` is offsets 16..18 of the line.
    expect(parts(drawn('original'))).toEqual([{ line: 1, from: 17, to: 19, className: 'gedit-word-part' }]);
    expect(parts(drawn('modified'))).toEqual([{ line: 1, from: 17, to: 19, className: 'gedit-word-part' }]);
    handle.dispose();
  });

  it('draws nothing for a language the registry does not know, and does not throw', async () => {
    const handle = await shown('G1 F1', 'G1 F2', 'no-such-profile');
    fake.lineChanges = [change([1, 1], [1, 1])];
    expect(() => diffUpdated()).not.toThrow();
    expect(drawn('modified')).toEqual([]);
    handle.dispose();
  });

  it('draws nothing while the diff has not arrived or has no changes', async () => {
    const handle = await shown('G1 F1', 'G1 F2');
    fake.lineChanges = null;
    diffUpdated();
    fake.lineChanges = [];
    diffUpdated();
    expect(drawn('modified')).toEqual([]);
    handle.dispose();
  });

  it('replaces the marks of the old diff with those of the new one', async () => {
    const handle = await shown('G1 F1\nG1 F1', 'G1 F2\nG1 F1');
    fake.lineChanges = [change([1, 1], [1, 1])];
    diffUpdated();
    const first = fake.collections.slice();
    fake.lineChanges = [];
    diffUpdated();
    expect(first.every((c) => c.cleared)).toBe(true);
    expect(drawn('modified')).toEqual([]);
    handle.dispose();
  });

  it('takes the marks away before a scratch model is refilled, and when the comparison closes', async () => {
    const handle = await shown('G1 F1', 'G1 F2');
    fake.lineChanges = [change([1, 1], [1, 1])];
    diffUpdated();
    const live = fake.collections.slice();
    expect(live.some((c) => c.items.length > 0)).toBe(true);
    handle.show({
      original: { kind: 'text', text: 'G1 F5', languageId: 'fanuc-gcode' },
      modified: { kind: 'text', text: 'G1 F6', languageId: 'fanuc-gcode' },
    });
    expect(live.every((c) => c.cleared && c.items.length === 0)).toBe(true);
    // The new text has no marks until Monaco has diffed it.
    expect(drawn('modified')).toEqual([]);
    fake.lineChanges = [change([1, 1], [1, 1])];
    diffUpdated();
    expect(words(drawn('modified'))).toHaveLength(1);
    const second = fake.collections.slice();
    handle.dispose();
    expect(second.every((c) => c.cleared)).toBe(true);
  });

  it('marks a large diff in slices and stops when the text changes under it', async () => {
    const count = 40_000;
    const a = Array.from({ length: count }, (_, i) => `G1 X${i}. F100`).join('\n');
    const b = Array.from({ length: count }, (_, i) => `G1 X${i}. F200`).join('\n');
    const handle = await shown(a, b);
    fake.lineChanges = [change([1, count], [1, count])];
    diffUpdated();
    const afterFirstSlice = words(drawn('modified')).length;
    // One slice is a few milliseconds of work, not the whole diff.
    expect(afterFirstSlice).toBeGreaterThan(0);
    expect(afterFirstSlice).toBeLessThan(count);
    // An edit makes the diff stale: the run ends, whatever is left is not drawn.
    for (const fn of [...fake.listeners.content]) fn();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(words(drawn('modified')).length).toBe(afterFirstSlice);
    handle.dispose();
  });

  it('finishes a large diff when nothing interrupts it', async () => {
    const count = 6000;
    const a = Array.from({ length: count }, (_, i) => `G1 X${i}. F100`).join('\n');
    const b = Array.from({ length: count }, (_, i) => `G1 X${i}. F200`).join('\n');
    const handle = await shown(a, b);
    fake.lineChanges = [change([1, count], [1, count])];
    diffUpdated();
    for (let waited = 0; waited < 5000 && words(drawn('modified')).length < count; waited += 20) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(words(drawn('modified'))).toHaveLength(count);
    expect(words(drawn('original'))).toHaveLength(count);
    handle.dispose();
  });
});
