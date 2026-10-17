// The aligned view (Phase 4 plan X30, P4.25): what it asks of the editor for a given alignment.
// Monaco is a fake that records the zones, decorations, options and scroll positions it is
// given; nothing here is Monaco's own logic (the alignment is `core/compare/alignedDiff.test.ts`,
// the editing and its undo `app/compareAligned.test.ts`).

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { docs } from '$lib/stores/documents';
import { settings } from '$lib/stores/settings';
import { cpOf } from '../../../tests/unit/helpers/compareProfiles';
import { alignSides, makePairReader, type AlignedDiff } from '$lib/core/compare/aligned';
import { normalizeLines, prepareNormalize } from '$lib/core/compare';
import { COMPARE_FALLBACK, type CompareOptions } from '$lib/core/compare/types';
import type { Disposable, DocId } from '$lib/app/types';

interface FakeModel {
  id: string;
  lines: string[];
  language: string;
  disposed: boolean;
  isDisposed(): boolean;
  getLanguageId(): string;
  setValue(text: string): void;
  getLineCount(): number;
  dispose(): void;
}

interface FakeZone {
  afterLineNumber: number;
  heightInLines: number;
  domNode: FakeNode;
}

/** Just enough of a DOM node: the view builds filler nodes and an arrow inside them. */
class FakeNode {
  className = '';
  dataset: Record<string, string> = {};
  title = '';
  tabIndex = -1;
  style: Record<string, string> = {};
  attributes: Record<string, string> = {};
  children: FakeNode[] = [];
  listeners = new Map<string, ((event: unknown) => void)[]>();
  ownerDocument = { createElement: () => new FakeNode() };
  /** No layout in a fake: a test that needs a place on screen sets this. */
  getBoundingClientRect = (): { left: number; right: number; top: number; bottom: number; width: number; height: number } => ({
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    width: 0,
    height: 0,
  });
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  appendChild(node: FakeNode): FakeNode {
    this.children.push(node);
    return node;
  }
  addEventListener(type: string, fn: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  remove(): void {
    this.removed = true;
  }
  removed = false;
}

interface Item {
  range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
  options: {
    className?: string;
    inlineClassName?: string;
    linesDecorationsClassName?: string;
    linesDecorationsTooltip?: string;
    isWholeLine?: boolean;
  };
}

interface FakeEditor {
  side: 'original' | 'modified';
  model: FakeModel;
  options: Record<string, unknown>;
  updates: Record<string, unknown>[];
  scrollTop: number;
  scrollLeft: number;
  scrollListeners: ((e: { scrollTopChanged: boolean; scrollLeftChanged: boolean }) => void)[];
  mouseListeners: ((e: unknown) => void)[];
  contentListeners: (() => void)[];
  modelListeners: (() => void)[];
  layoutListeners: (() => void)[];
  /** What `getLayoutInfo()` answers: the scrollbar and the overview ruler on the right. */
  layout: { width: number; contentLeft: number; verticalScrollbarWidth: number; overviewRuler: { width: number; right: number } };
  zones: Map<string, FakeZone>;
  removedZones: string[];
  collections: { items: Item[]; cleared: number }[];
  position: { lineNumber: number; column: number };
  revealed: number[];
  focused: number;
  disposed: boolean;
  actions: { id: string; label: string; contextMenuGroupId?: string; run(): void; disposed: boolean }[];
}

const fake = vi.hoisted(() => ({
  editors: [] as unknown[],
  models: new Map<string, unknown>(),
  created: [] as unknown[],
  zoneSeq: 0,
}));

function fakeModel(id: string, text: string, language = 'fanuc-gcode'): FakeModel {
  const model: FakeModel = {
    id,
    lines: text.split('\n'),
    language,
    disposed: false,
    isDisposed: () => model.disposed,
    getLanguageId: () => model.language,
    setValue: (value) => {
      model.lines = value.split('\n');
    },
    getLineCount: () => model.lines.length,
    dispose: () => {
      model.disposed = true;
    },
  };
  return model;
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
      MouseTargetType: { GUTTER_LINE_DECORATIONS: 4, CONTENT_TEXT: 6, CONTENT_VIEW_ZONE: 8 },
      createModel: (text: string, language: string) => {
        const model = fakeModel(`scratch${fake.created.length}`, text, language);
        fake.created.push(model);
        return model;
      },
      setModelLanguage: (model: FakeModel, language: string) => {
        model.language = language;
      },
      create: (container: { dataset: Record<string, string> }, options: Record<string, unknown>) => {
        const side = container.dataset.testid === 'aligned-pane-original' ? 'original' : 'modified';
        const state: FakeEditor = {
          side,
          model: options.model as FakeModel,
          options,
          updates: [],
          scrollTop: 0,
          scrollLeft: 0,
          scrollListeners: [],
          mouseListeners: [],
          contentListeners: [],
          modelListeners: [],
          layoutListeners: [],
          layout: { width: 400, contentLeft: 50, verticalScrollbarWidth: 14, overviewRuler: { width: 14, right: 0 } },
          zones: new Map(),
          removedZones: [],
          collections: [],
          position: { lineNumber: 1, column: 1 },
          revealed: [],
          focused: 0,
          disposed: false,
          actions: [],
        };
        fake.editors.push(state);
        const scroll = (top: number, left: number): void => {
          const changed = { scrollTopChanged: top !== state.scrollTop, scrollLeftChanged: left !== state.scrollLeft };
          state.scrollTop = top;
          state.scrollLeft = left;
          if (changed.scrollTopChanged || changed.scrollLeftChanged) for (const fn of [...state.scrollListeners]) fn(changed);
        };
        const listen = <T,>(list: T[], fn: T) => {
          list.push(fn);
          return { dispose: () => void list.splice(list.indexOf(fn), 1) };
        };
        return {
          getModel: () => state.model,
          onDidScrollChange: (fn: never) => listen(state.scrollListeners, fn),
          onMouseDown: (fn: never) => listen(state.mouseListeners, fn),
          onDidFocusEditorText: () => ({ dispose() {} }),
          onDidChangeModelContent: (fn: never) => listen(state.contentListeners, fn),
          onDidChangeModel: (fn: never) => listen(state.modelListeners, fn),
          onDidLayoutChange: (fn: never) => listen(state.layoutListeners, fn),
          getLayoutInfo: () => state.layout,
          getScrollTop: () => state.scrollTop,
          getScrollLeft: () => state.scrollLeft,
          setScrollTop: (top: number) => scroll(top, state.scrollLeft),
          setScrollPosition: (p: { scrollTop: number; scrollLeft: number }) => scroll(p.scrollTop, p.scrollLeft),
          changeViewZones: (cb: (accessor: unknown) => void) =>
            cb({
              addZone: (zone: FakeZone) => {
                const id = `z${++fake.zoneSeq}`;
                state.zones.set(id, zone);
                return id;
              },
              removeZone: (id: string) => {
                state.zones.delete(id);
                state.removedZones.push(id);
              },
            }),
          createDecorationsCollection: () => {
            const collection = { items: [] as Item[], cleared: 0 };
            state.collections.push(collection);
            return {
              set: (list: Item[]) => void (collection.items = [...list]),
              append: (list: Item[]) => void collection.items.push(...list),
              clear: () => {
                collection.items = [];
                collection.cleared++;
              },
            };
          },
          // The pane sits 100 px down the page, each line is 20 px high, and there is no scroll offset.
          getDomNode: () => ({ getBoundingClientRect: () => ({ top: 100 }) }),
          getTopForLineNumber: (line: number) => (line - 1) * 20,
          addAction: (action: { id: string; label: string; contextMenuGroupId?: string; run(): void }) => {
            const entry = { ...action, disposed: false };
            state.actions.push(entry);
            return { dispose: () => void (entry.disposed = true) };
          },
          getPosition: () => state.position,
          setPosition: (p: { lineNumber: number; column: number }) => void (state.position = p),
          revealLineInCenterIfOutsideViewport: (line: number) => void state.revealed.push(line),
          hasTextFocus: () => false,
          focus: () => void state.focused++,
          updateOptions: (o: Record<string, unknown>) => void state.updates.push(o),
          dispose: () => {
            state.disposed = true;
          },
        };
      },
    },
  }),
}));

vi.mock('$lib/monaco/editorService', () => ({
  editor: { model: (id: string) => fake.models.get(id) },
}));

const { createAlignedView, ALIGNED_CLASSES, RECOMPUTE_DELAY_MS, alignedScratchCount, isAlignedHandle, arrowHit, ARROW_BOX, alignedPaneOptions } =
  await import('./alignedView');
type AlignedHandle = Awaited<ReturnType<typeof createAlignedView>>;
type AlignedPane = Parameters<NonNullable<Parameters<typeof createAlignedView>[0]['onPane']>>[0];

const cp = cpOf('fanuc');
const OPTIONS: CompareOptions = { ...COMPARE_FALLBACK, ignoreBlockNumbers: true, ignoreWhitespace: true, ignoreNumberFormat: true };

const editorOf = (side: 'original' | 'modified'): FakeEditor => {
  const list = (fake.editors as FakeEditor[]).filter((e) => e.side === side);
  return list[list.length - 1];
};

function alignModels(a: FakeModel, b: FakeModel) {
  return () => {
    const side = (lines: string[]) => {
      const n = normalizeLines(lines, cp, OPTIONS);
      return { lineCount: lines.length, normalized: n.lineMap.length === 0 ? [] : n.text.split('\n'), lineMap: n.lineMap };
    };
    const diff: AlignedDiff = alignSides(side(a.lines), side(b.lines));
    const wordSide = (lines: string[]) => ({ cp, ctx: prepareNormalize(lines, cp), lines });
    return { diff, reader: makePairReader(wordSide(a.lines), wordSide(b.lines), OPTIONS) };
  };
}

const opened: DocId[] = [];
function openDoc(): DocId {
  const id = docs.add({
    path: null,
    untitledIndex: 200 + opened.length,
    profileId: 'fanuc-gcode',
    encoding: { encoding: 'utf-8', hasBom: false },
    eol: 'lf',
    eolMixedOnLoad: false,
    nul: { leader: 0, trailer: 0, stripped: 0 },
    textDirty: false,
    metaDirty: false,
    disk: null,
    external: 'none',
    readOnly: false,
    readOnlyReason: null,
  });
  opened.push(id);
  return id;
}
function lockDoc(id: DocId, readOnly: boolean): void {
  docs.update(id, { readOnly, readOnlyReason: readOnly ? 'user' : null });
}

const ORIGINAL = ['O1000', 'N10 G1 X10. F1200', 'N20 G1 X20.', 'N30 M30'];
const MODIFIED = ['O1000', 'N10 G1 X10. F1000', 'N15 G4 P500', 'N20 G1 X20.', 'N30 M30'];

interface Setup {
  handle: AlignedHandle;
  original: FakeModel;
  modified: FakeModel;
  copy: ReturnType<typeof vi.fn>;
  align: ReturnType<typeof vi.fn>;
  docId: DocId;
  originalId: DocId;
}

async function setup(
  o: { text?: boolean; original?: string[]; modified?: string[]; onPane?: (pane: AlignedPane) => Disposable | void; lockOriginal?: boolean } = {},
): Promise<Setup> {
  const docId = openDoc();
  const originalId = openDoc();
  if (o.lockOriginal === true) lockDoc(originalId, true);
  const modified = fakeModel('m', (o.modified ?? MODIFIED).join('\n'));
  const original = fakeModel('o', (o.original ?? ORIGINAL).join('\n'));
  fake.models.set(docId, modified);
  fake.models.set(originalId, original);
  const copy = vi.fn();
  const alignFn = alignModels(original, modified);
  const align = vi.fn((_o: { reuse: boolean }) => alignFn());
  const handle = await createAlignedView({
    container: new FakeNode() as unknown as HTMLElement,
    modifiedDocId: docId,
    sides: {
      original: o.text === true ? { kind: 'text', text: original.lines.join('\n'), languageId: 'fanuc-gcode' } : { kind: 'document', docId: originalId },
      modified: { kind: 'document', docId },
    },
    align,
    copy,
    onPane: o.onPane,
  });
  return { handle, original, modified, copy, align, docId, originalId };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  vi.useRealTimers();
  await settings.reset(['appearance.editorFontSize', 'appearance.editorFontFamily', 'assist.completion', 'editor.wordWrap']);
  for (const id of opened.splice(0)) docs.remove(id);
  fake.editors.length = 0;
  fake.models.clear();
  fake.created.length = 0;
});

describe('creation', () => {
  it('builds two editors on the live models with the options every editor shares, and no theme', async () => {
    const s = await setup();
    expect(fake.editors).toHaveLength(2);
    expect(editorOf('original').model).toBe(s.original);
    expect(editorOf('modified').model).toBe(s.modified);
    for (const side of ['original', 'modified'] as const) {
      expect(editorOf(side).options).toMatchObject({
        automaticLayout: true,
        colorDecorators: false,
        defaultColorDecorators: 'never',
        fixedOverflowWidgets: true,
        // A wrapped line is taller on one side and would break the alignment.
        wordWrap: 'off',
      });
      expect(editorOf(side).options).not.toHaveProperty('theme');
      expect(editorOf(side).options).not.toHaveProperty('hover');
    }
    s.handle.dispose();
  });

  /** What a pane is configured with once `create()` and the updates after it have run. */
  const effectiveOptions = (side: 'original' | 'modified'): Record<string, unknown> =>
    Object.assign({}, editorOf(side).options, ...editorOf(side).updates);

  it('turns the suggestion pop-ups off in both panes (CODE-7)', async () => {
    const s = await setup();
    for (const side of ['original', 'modified'] as const) {
      expect(effectiveOptions(side)).toMatchObject({ quickSuggestions: false, suggestOnTriggerCharacters: false });
    }
    s.handle.dispose();
  });

  it('takes the font and the display settings of the user, through the pane\'s own updateOptions, never the layout keys (CODE-7)', async () => {
    await settings.save({ 'appearance.editorFontSize': 19, 'appearance.editorFontFamily': 'Menlo', 'editor.wordWrap': true });
    const s = await setup();
    for (const side of ['original', 'modified'] as const) {
      // Not in the construction options (they land in the shared configuration service) ...
      expect(editorOf(side).options).not.toHaveProperty('fontSize');
      expect(editorOf(side).options).not.toHaveProperty('quickSuggestions');
      // ... but in the update that follows `create()`.
      expect(editorOf(side).updates[0]).toMatchObject({ fontSize: 19, fontFamily: 'Menlo', quickSuggestions: false });
      expect(effectiveOptions(side).wordWrap).toBe('off');
      expect(effectiveOptions(side).minimap).toEqual({ enabled: false });
      for (const layout of ['wordWrap', 'minimap', 'stickyScroll']) expect(editorOf(side).updates[0]).not.toHaveProperty(layout);
    }
    s.handle.dispose();
  });

  it('keeps the suggestions off whatever the completion setting says, and follows a font change while open (CODE-7)', async () => {
    await settings.save({ 'assist.completion': 'auto' });
    const s = await setup();
    expect(effectiveOptions('modified')).toMatchObject({ quickSuggestions: false, suggestOnTriggerCharacters: false });
    await settings.save({ 'appearance.editorFontSize': 22 });
    for (const side of ['original', 'modified'] as const) {
      const last = editorOf(side).updates[editorOf(side).updates.length - 1];
      expect(last).toMatchObject({ fontSize: 22, quickSuggestions: false });
    }
    // Closed: a later change reaches nothing.
    const count = editorOf('modified').updates.length;
    s.handle.dispose();
    await settings.save({ 'appearance.editorFontSize': 23 });
    expect(editorOf('modified').updates).toHaveLength(count);
  });

  it('alignedPaneOptions is a closed subset of the settings plus the two suggestion switches', () => {
    const options = alignedPaneOptions(get(settings.values));
    expect(Object.keys(options).sort()).toEqual(
      [
        'dragAndDrop',
        'emptySelectionClipboard',
        'fontFamily',
        'fontSize',
        'hover',
        'lineNumbers',
        'quickSuggestions',
        'renderLineHighlight',
        'renderWhitespace',
        'rulers',
        'suggestOnTriggerCharacters',
      ].sort(),
    );
  });

  it('is a diff handle the compare commands reach through currentDiff()', async () => {
    const s = await setup();
    expect(isAlignedHandle(s.handle)).toBe(true);
    expect(isAlignedHandle(null)).toBe(false);
    expect(isAlignedHandle({ ...s.handle, aligned: false } as never)).toBe(false);
    s.handle.dispose();
  });

  it('aligns once, with the normalization the caller just built', async () => {
    const s = await setup();
    expect(s.align).toHaveBeenCalledTimes(1);
    expect(s.align).toHaveBeenCalledWith({ reuse: true });
    expect(s.handle.isCurrent()).toBe(true);
    s.handle.dispose();
  });

  it('shows a file or the saved version in a model of its own, locked, and blanks it when it closes', async () => {
    const s = await setup({ text: true });
    expect(fake.created).toHaveLength(1);
    expect(editorOf('original').options.readOnly).toBe(true);
    expect(editorOf('modified').options.readOnly).toBe(false);
    s.handle.dispose();
    // Blanked, not disposed (the editor worker may still be asked about it); the document's model is untouched.
    const scratch = fake.created[0] as FakeModel;
    expect(scratch).toMatchObject({ lines: [''], disposed: false });
    expect(s.modified.disposed).toBe(false);
    expect(alignedScratchCount()).toBe(1);
    const again = await setup({ text: true });
    expect(fake.created).toHaveLength(1);
    again.handle.dispose();
  });

  it('refuses a document that has no model, before it builds anything', async () => {
    const id = openDoc();
    await expect(
      createAlignedView({
        container: new FakeNode() as unknown as HTMLElement,
        modifiedDocId: id,
        sides: { original: { kind: 'text', text: 'X', languageId: 'nc' }, modified: { kind: 'document', docId: id } },
        align: () => null,
        copy: () => {},
      }),
    ).rejects.toThrow(/has no model/);
    expect(fake.editors).toHaveLength(0);
  });
});

describe('what is drawn', () => {
  it('keeps the panes level with a filler under the last line before an insertion', async () => {
    const s = await setup();
    // The modified side has `N15 G4 P500` in addition: one line of filler on the original, under line 2.
    const zones = [...editorOf('original').zones.values()];
    expect(zones.map((z) => [z.afterLineNumber, z.heightInLines])).toEqual([[2, 1]]);
    expect(editorOf('modified').zones.size).toBe(0);
    expect(zones[0].domNode.className).toBe(ALIGNED_CLASSES.filler);
    s.handle.dispose();
  });

  it('puts the merge arrow of an empty side in its filler, and sends the block the way the arrow points', async () => {
    // A pure insertion: the original has no line in the block, so its arrow cannot sit on a line.
    const s = await setup({ original: ['O1000', 'N10 G1 X10.', 'N30 M30'], modified: ['O1000', 'N10 G1 X10.', 'N20 G4 P500', 'N30 M30'] });
    const filler = [...editorOf('original').zones.values()][0].domNode;
    const arrow = filler.children[0];
    expect(arrow.className).toBe(ALIGNED_CLASSES.fillerArrow);
    expect(arrow.dataset.side).toBe('original');
    let prevented = 0;
    arrow.listeners.get('mousedown')![0]({ preventDefault: () => prevented++, stopPropagation: () => {} });
    expect(prevented).toBe(1);
    // The original is the side with no line: its (empty) version goes to the document; the cursor is put in the block on the side that has lines.
    expect(s.copy).toHaveBeenCalledWith('toModified', { lineOnly: false });
    expect(editorOf('modified').position.lineNumber).toBe(3);
    s.handle.dispose();
  });

  it('places the original side filler arrow from the pane\'s visible right edge, clear of the scrollbar and the ruler, following the layout and the horizontal scroll (GB, harness run 3)', async () => {
    const s = await setup({ original: ['O1000', 'N10 G1 X10.', 'N30 M30'], modified: ['O1000', 'N10 G1 X10.', 'N20 G4 P500', 'N30 M30'] });
    const original = editorOf('original');
    const arrow = [...original.zones.values()][0].domNode.children[0];
    const left = (): number => Number.parseFloat(arrow.style.left);
    // The zone is as wide as the scroll width; the arrow is placed from the visible edge:
    // visible width 400 - 50 = 350, minus the scrollbar or ruler (14) and 6 px, minus the triangle (7).
    expect(arrow.style.right).toBe('auto');
    expect(left()).toBe(350 - 20 - 7);
    original.layout = { width: 400, contentLeft: 50, verticalScrollbarWidth: 20, overviewRuler: { width: 14, right: 0 } };
    for (const fn of [...original.layoutListeners]) fn();
    expect(left()).toBe(350 - 26 - 7);
    // A ruler wider than the scrollbar (or set apart from it) counts as well.
    original.layout = { width: 400, contentLeft: 50, verticalScrollbarWidth: 10, overviewRuler: { width: 14, right: 4 } };
    for (const fn of [...original.layoutListeners]) fn();
    expect(left()).toBe(350 - 24 - 7);
    // Scrolled to the right, the zone moves with the text: the arrow keeps its place on screen.
    original.scrollLeft = 120;
    for (const fn of [...original.scrollListeners]) fn({ scrollTopChanged: false, scrollLeftChanged: true });
    expect(left()).toBe(120 + 350 - 24 - 7);
    s.handle.dispose();
    expect(original.layoutListeners).toHaveLength(0);
  });

  it('shows the hand over the drawn triangle of the margin arrow only, not over the whole strip (GB)', () => {
    const css = readFileSync(new URL('./alignedView.css', import.meta.url), 'utf8');
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ selector: m[1].trim().replace(/\/\*[\s\S]*?\*\//g, '').trim(), body: m[2] }));
    const pointer = rules.filter((r) => /cursor:\s*pointer/.test(r.body)).map((r) => r.selector);
    // The strip itself (the decoration's own div) keeps the default cursor; its ::before is the triangle.
    const selectors = pointer.flatMap((sel) => sel.split(',').map((x) => x.trim()));
    expect(selectors.filter((x) => /gedit-aligned-arrow-(right|left)$/.test(x))).toEqual([]);
    expect(pointer.join(' ')).toContain('.gedit-aligned-arrow-right::before');
    expect(pointer.join(' ')).toContain('.gedit-aligned-arrow-left::before');
  });

  it('makes the filler arrow a button the keyboard reaches, with a name (CODE-11)', async () => {
    const s = await setup({ original: ['O1000', 'N10 G1 X10.', 'N30 M30'], modified: ['O1000', 'N10 G1 X10.', 'N20 G4 P500', 'N30 M30'] });
    const arrow = [...editorOf('original').zones.values()][0].domNode.children[0];
    expect(arrow.tabIndex).toBe(0);
    expect(arrow.attributes.role).toBe('button');
    expect(arrow.attributes['aria-label']).toBe(arrow.title);
    expect(arrow.title).toContain('current document');
    const press = (key: string, shiftKey = false) => {
      let prevented = 0;
      arrow.listeners.get('keydown')![0]({ key, shiftKey, preventDefault: () => prevented++, stopPropagation: () => {} });
      return prevented;
    };
    expect(press('a')).toBe(0);
    expect(press('Tab')).toBe(0);
    expect(s.copy).not.toHaveBeenCalled();
    expect(press('Enter')).toBe(1);
    expect(s.copy).toHaveBeenLastCalledWith('toModified', { lineOnly: false });
    expect(press(' ')).toBe(1);
    expect(s.copy).toHaveBeenCalledTimes(2);
    press('Enter', true);
    expect(s.copy).toHaveBeenLastCalledWith('toModified', { lineOnly: true });
    s.handle.dispose();
  });

  it('copies when a click Monaco reports on the filler lands on its arrow: the text layer lies over the view zones, so the arrow itself never gets it (harness run 3)', async () => {
    const s = await setup({ original: ['O1000', 'N10 G1 X10.', 'N30 M30'], modified: ['O1000', 'N10 G1 X10.', 'N20 G4 P500', 'N30 M30'] });
    const original = editorOf('original');
    const arrow = [...original.zones.values()][0].domNode.children[0];
    arrow.getBoundingClientRect = () => ({ left: 300, right: 307, top: 200, bottom: 210, width: 7, height: 10 });
    let prevented = 0;
    const click = (clientX: number, clientY: number, type = 8, shiftKey = false) =>
      original.mouseListeners[0]({
        target: { type, position: null },
        event: { shiftKey, browserEvent: { clientX, clientY }, preventDefault: () => prevented++ },
      });
    // Elsewhere in the filler, or a click on text at the same point: nothing.
    click(250, 205);
    click(303, 230);
    click(303, 205, 6);
    expect(s.copy).not.toHaveBeenCalled();
    // On the arrow (with a few pixels of slack): the block is copied, and the click goes no further.
    click(303, 205);
    expect(s.copy).toHaveBeenLastCalledWith('toModified', { lineOnly: false });
    expect(prevented).toBe(1);
    click(309, 198, 8, true);
    expect(s.copy).toHaveBeenLastCalledWith('toModified', { lineOnly: true });
    // The other pane's view-zone clicks never reach this pane's arrow.
    editorOf('modified').mouseListeners[0]({ target: { type: 8, position: null }, event: { shiftKey: false, browserEvent: { clientX: 303, clientY: 205 }, preventDefault: () => {} } });
    expect(s.copy).toHaveBeenCalledTimes(2);
    s.handle.dispose();
  });

  it('has no arrow in the filler of a side that has lines in the block (its lines carry it)', async () => {
    const s = await setup();
    const filler = [...editorOf('original').zones.values()][0].domNode;
    expect(filler.children).toHaveLength(0);
    s.handle.dispose();
  });

  it('tints the lines of a changed block and puts the arrow on its first line, in both panes', async () => {
    const s = await setup();
    const items = (side: 'original' | 'modified') => editorOf(side).collections[0].items;
    // F1200 → F1000 and the inserted dwell are one block: one line against two.
    expect(items('original').map((i) => i.options.className ?? i.options.linesDecorationsClassName)).toEqual([
      ALIGNED_CLASSES.changed,
      ALIGNED_CLASSES.arrowRight,
    ]);
    expect(items('modified').map((i) => i.options.className ?? i.options.linesDecorationsClassName)).toEqual([
      ALIGNED_CLASSES.changed,
      ALIGNED_CLASSES.arrowLeft,
    ]);
    expect(items('original')[0].range).toMatchObject({ startLineNumber: 2, endLineNumber: 2 });
    expect(items('modified')[0].range).toMatchObject({ startLineNumber: 2, endLineNumber: 3 });
    expect(items('modified')[1].range).toMatchObject({ startLineNumber: 2, endLineNumber: 2 });
    s.handle.dispose();
  });

  it('tints a line that exists on one side only with its own colour', async () => {
    const s = await setup({ original: ['O1000', 'N10 G1 X10.', 'N30 M30'], modified: ['O1000', 'N10 G1 X10.', 'N20 G4 P500', 'N30 M30'] });
    expect(editorOf('modified').collections[0].items[0].options.className).toBe(ALIGNED_CLASSES.onlyModified);
    expect(editorOf('original').collections[0].items).toEqual([]);
    s.handle.dispose();
    const gone = await setup({ original: ['O1000', 'N10 G1 X10.', 'N20 G4 P500', 'N30 M30'], modified: ['O1000', 'N10 G1 X10.', 'N30 M30'] });
    expect(editorOf('original').collections[0].items[0].options.className).toBe(ALIGNED_CLASSES.onlyOriginal);
    gone.handle.dispose();
  });

  it('draws the word marks of the changed lines, whole words, on the lines as written', async () => {
    const s = await setup();
    await vi.runAllTimersAsync();
    const marks = (side: 'original' | 'modified') => editorOf(side).collections[1].items;
    expect(marks('original').map((i) => [i.range.startLineNumber, i.range.startColumn, i.range.endColumn, i.options.inlineClassName])).toEqual([
      [2, 13, 18, 'gedit-word-changed'],
    ]);
    expect(marks('modified').map((i) => [i.range.startLineNumber, i.range.startColumn, i.range.endColumn])).toEqual([[2, 13, 18]]);
    s.handle.dispose();
  });

  it('follows the toggles: realigning replaces the zones and the tints', async () => {
    const s = await setup();
    const first = [...editorOf('original').zones.keys()];
    s.handle.recompute({ reuse: true });
    expect(s.align).toHaveBeenLastCalledWith({ reuse: true });
    expect(editorOf('original').removedZones).toEqual(first);
    expect([...editorOf('original').zones.keys()]).not.toEqual(first);
    expect(editorOf('original').zones.size).toBe(1);
    s.handle.dispose();
  });
});

describe('scrolling as one', () => {
  it('moves the other pane to the same position, without looping', async () => {
    const s = await setup();
    const left = editorOf('original');
    const right = editorOf('modified');
    const events: string[] = [];
    right.scrollListeners.push(() => events.push('right'));
    left.scrollListeners.push(() => events.push('left'));
    // The user scrolls the left pane: Monaco has moved it and tells the view's listener (the first one).
    left.scrollTop = 120;
    left.scrollLeft = 30;
    left.scrollListeners[0]({ scrollTopChanged: true, scrollLeftChanged: true });
    expect(right.scrollTop).toBe(120);
    expect(right.scrollLeft).toBe(30);
    // The follow did not send the position back: the right pane's own events are one, the left pane's none.
    expect(events).toEqual(['right']);
    // And the other way.
    right.scrollTop = 40;
    right.scrollListeners[0]({ scrollTopChanged: true, scrollLeftChanged: false });
    expect(left.scrollTop).toBe(40);
    s.handle.dispose();
  });

  it('ignores a scroll event that moved nothing', async () => {
    const s = await setup();
    const right = editorOf('modified');
    right.scrollTop = 7;
    editorOf('original').scrollListeners[0]({ scrollTopChanged: false, scrollLeftChanged: false });
    expect(right.scrollTop).toBe(7);
    s.handle.dispose();
  });
});

describe('the arrows in the margin', () => {
  // The strip starts after the glyph margin (10 + 18 px) and the line numbers (22 px): 50 px in.
  // A line is 20 px high and the pane starts 100 px down the page (see the fake editor).
  type At = { x: number; y: number };
  const ON_ARROW: At = { x: 3, y: 10 };
  const click = (side: 'original' | 'modified', line: number, shift = false, at: At | null = ON_ARROW) =>
    editorOf(side).mouseListeners[0]({
      target: {
        type: 4,
        position: { lineNumber: line, column: 1 },
        detail:
          at === null ? undefined : { offsetX: 50 + at.x, glyphMarginLeft: 10, glyphMarginWidth: 18, lineNumbersWidth: 22 },
      },
      event: { shiftKey: shift, browserEvent: { clientY: 100 + (line - 1) * 20 + (at?.y ?? 0) } },
    });

  it('copies the block from the pane whose arrow was pressed, with the cursor in the block', async () => {
    const s = await setup();
    click('original', 2);
    expect(s.copy).toHaveBeenLastCalledWith('toModified', { lineOnly: false });
    expect(editorOf('original').position.lineNumber).toBe(2);
    click('modified', 2);
    expect(s.copy).toHaveBeenLastCalledWith('toOriginal', { lineOnly: false });
    expect(editorOf('modified').position.lineNumber).toBe(2);
    s.handle.dispose();
  });

  it('copies one row with Shift', async () => {
    const s = await setup();
    click('original', 2, true);
    expect(s.copy).toHaveBeenLastCalledWith('toModified', { lineOnly: true });
    s.handle.dispose();
  });

  it('does nothing for a click outside the arrow column, off the first line of a block, or on a line that is not in a block', async () => {
    const s = await setup();
    editorOf('original').mouseListeners[0]({ target: { type: 6, position: { lineNumber: 2, column: 1 } }, event: { shiftKey: false } });
    click('original', 1);
    click('original', 3);
    click('modified', 3); // the second line of the block has no arrow
    expect(s.copy).not.toHaveBeenCalled();
    s.handle.dispose();
  });

  it('copies only on the arrow itself, not anywhere in the strip at the first line of a block (CODE-11)', async () => {
    const s = await setup();
    // Along the strip, past the triangle ...
    click('original', 2, false, { x: 30, y: 10 });
    click('original', 2, false, { x: 12, y: 10 });
    click('original', 2, false, { x: -1, y: 10 });
    // ... above and below it, still on the block's first line.
    click('original', 2, false, { x: 3, y: 0 });
    click('original', 2, false, { x: 3, y: 19 });
    // A click without the position of the mouse in the strip cannot be placed: nothing happens.
    click('original', 2, false, null);
    expect(s.copy).not.toHaveBeenCalled();
    // The triangle's corners do copy, in either pane (the left-pointing one sits 2 px in).
    click('original', 2, false, { x: 0, y: 5 });
    click('modified', 2, false, { x: 9, y: 15 });
    expect(s.copy.mock.calls.map((c) => c[0])).toEqual(['toModified', 'toOriginal']);
    s.handle.dispose();
  });

  it('knows where the arrow is (the box allows the 7 x 10 px triangle drawn by the stylesheet)', () => {
    expect(arrowHit(0, 5)).toBe(true);
    expect(arrowHit(9, 14)).toBe(true);
    expect(arrowHit(ARROW_BOX.right, 10)).toBe(false);
    expect(arrowHit(-1, 10)).toBe(false);
    expect(arrowHit(3, ARROW_BOX.top - 1)).toBe(false);
    expect(arrowHit(3, ARROW_BOX.bottom)).toBe(false);
    expect(arrowHit(3, null)).toBe(true);
    expect(arrowHit(40, null)).toBe(false);
  });

  it('names the margin arrow in its tooltip, one for each way (CODE-11)', async () => {
    const s = await setup();
    const tooltips = (side: 'original' | 'modified') =>
      editorOf(side).collections[0].items.filter((i) => i.options.linesDecorationsClassName).map((i) => i.options.linesDecorationsTooltip);
    expect(tooltips('original')).toEqual([expect.stringContaining('current document')]);
    expect(tooltips('modified')).toEqual([expect.stringContaining('original')]);
    s.handle.dispose();
  });

  it('puts the copy of the block at the cursor in each pane\'s menu and the keyboard\'s reach, and takes it away on close (CODE-11)', async () => {
    const s = await setup();
    const action = (side: 'original' | 'modified') => editorOf(side).actions.find((a) => a.id === 'gedit.aligned.copyBlock')!;
    expect(action('original').label).toBe('Copy Change to Current Document');
    expect(action('modified').label).toBe('Copy Change to Original');
    expect(action('original').contextMenuGroupId).toBeTruthy();
    action('original').run();
    expect(s.copy).toHaveBeenLastCalledWith('toModified', { lineOnly: false });
    action('modified').run();
    expect(s.copy).toHaveBeenLastCalledWith('toOriginal', { lineOnly: false });
    s.handle.dispose();
    expect(action('original').disposed).toBe(true);
    expect(action('modified').disposed).toBe(true);
  });

  it('does nothing while the alignment is out of date', async () => {
    const s = await setup();
    for (const fn of editorOf('modified').contentListeners) fn();
    click('original', 2);
    expect(s.copy).not.toHaveBeenCalled();
    s.handle.dispose();
  });
});

describe('after an edit', () => {
  it('is out of date at once and aligned again a moment after the last change', async () => {
    const s = await setup();
    expect(s.handle.isCurrent()).toBe(true);
    for (const fn of editorOf('modified').contentListeners) fn();
    expect(s.handle.isCurrent()).toBe(false);
    s.modified.lines.splice(2, 1);
    await vi.advanceTimersByTimeAsync(RECOMPUTE_DELAY_MS - 1);
    expect(s.handle.isCurrent()).toBe(false);
    for (const fn of editorOf('original').contentListeners) fn();
    await vi.advanceTimersByTimeAsync(RECOMPUTE_DELAY_MS - 1);
    expect(s.handle.isCurrent()).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(s.handle.isCurrent()).toBe(true);
    // Not reused: the texts changed, so the normalization is built again.
    expect(s.align).toHaveBeenLastCalledWith({ reuse: false });
    expect(s.align).toHaveBeenCalledTimes(2);
    // The filler of the insertion is gone with the insertion.
    expect(editorOf('original').zones.size).toBe(0);
    s.handle.dispose();
  });

  it('goes to the next difference once the alignment is back (the merge keys do this after a copy)', async () => {
    const s = await setup();
    s.handle.reveal('modified', 1);
    for (const fn of editorOf('modified').contentListeners) fn();
    s.handle.nextWhenUpdated();
    editorOf('modified').revealed.length = 0;
    await vi.advanceTimersByTimeAsync(RECOMPUTE_DELAY_MS + 1);
    expect(editorOf('modified').revealed.length).toBeGreaterThan(0);
    s.handle.dispose();
  });
});

describe('navigation and the handle', () => {
  it('goes to the next and previous change, round the ends, from the pane the cursor is in', async () => {
    const s = await setup();
    s.handle.reveal('modified', 1);
    editorOf('modified').revealed.length = 0;
    s.handle.goToDiff('next');
    expect(editorOf('modified').position.lineNumber).toBe(2);
    expect(editorOf('original').position.lineNumber).toBe(2);
    // One block only: next from inside it wraps round to it again.
    s.handle.goToDiff('next');
    expect(editorOf('modified').position.lineNumber).toBe(2);
    s.handle.reveal('modified', 5);
    s.handle.goToDiff('previous');
    expect(editorOf('modified').position.lineNumber).toBe(2);
    s.handle.dispose();
  });

  it('reports the changes the way Monaco does, and its own alignment', async () => {
    const s = await setup();
    expect(s.handle.lineChanges()).toEqual([
      { originalStartLineNumber: 2, originalEndLineNumber: 2, modifiedStartLineNumber: 2, modifiedEndLineNumber: 3 },
    ]);
    expect(s.handle.result()?.diff.changed).toHaveLength(1);
    expect(s.handle.cursorAt()).toEqual({ side: 'modified', line: 1, column: 1 });
    expect(s.handle.cursor()).toEqual({ side: 'modified', line: 1 });
    expect(s.handle.model('original')).toBe(s.original);
    s.handle.dispose();
  });

  it('plans a one-line copy by rows', async () => {
    const s = await setup();
    const change = s.handle.lineChanges()![0];
    // The inserted line, original → modified: nothing to copy, so the document's line is removed.
    expect(s.handle.planCopy(change, 'toModified', { side: 'modified', line: 3 })).toEqual({
      sourceFrom: 0,
      sourceCount: 0,
      targetAt: 3,
      targetRemove: 1,
    });
    // modified → original: the line goes in behind original line 2.
    expect(s.handle.planCopy(change, 'toOriginal', { side: 'modified', line: 3 })).toEqual({
      sourceFrom: 3,
      sourceCount: 1,
      targetAt: 3,
      targetRemove: 0,
    });
    expect(s.handle.planCopy({ ...change, modifiedStartLineNumber: 99 }, 'toOriginal', { side: 'modified', line: 3 })).toBeNull();
    s.handle.dispose();
  });

  it('puts the keyboard in a pane on request, and answers nothing without an alignment', async () => {
    const s = await setup();
    s.handle.focusSide('original');
    expect(editorOf('original').focused).toBe(1);
    s.handle.focus();
    expect(editorOf('modified').focused).toBe(1);
    s.handle.dispose();
    const empty = await createAlignedView({
      container: new FakeNode() as unknown as HTMLElement,
      modifiedDocId: s.docId,
      sides: { original: { kind: 'document', docId: s.originalId }, modified: { kind: 'document', docId: s.docId } },
      align: () => null,
      copy: () => {},
    });
    expect(empty.isCurrent()).toBe(false);
    expect(empty.lineChanges()).toBeNull();
    expect(empty.result()).toBeNull();
    expect(empty.planCopy({ originalStartLineNumber: 1, originalEndLineNumber: 1, modifiedStartLineNumber: 1, modifiedEndLineNumber: 1 }, 'toModified', { side: 'modified', line: 1 })).toBeNull();
    empty.goToDiff('next');
    empty.dispose();
  });
});

describe('the read-only lock (AD-23)', () => {
  it('builds a locked document locked, follows the lock while the view is open, and stops when it closes', async () => {
    const s = await setup();
    // The settings update that follows `create()` is not a lock update.
    const locks = (side: 'original' | 'modified') => editorOf(side).updates.filter((u) => 'readOnly' in u);
    expect(editorOf('modified').options.readOnly).toBe(false);
    lockDoc(s.docId, true);
    expect(locks('modified')).toEqual([{ readOnly: true }]);
    lockDoc(s.docId, false);
    expect(locks('modified')).toEqual([{ readOnly: true }, { readOnly: false }]);
    lockDoc(s.originalId, true);
    expect(locks('original')).toEqual([{ readOnly: true }]);
    s.handle.dispose();
    lockDoc(s.docId, true);
    expect(locks('modified')).toHaveLength(2);
  });
});

describe('the typing helpers in the panes (P4e FT)', () => {
  /** What `onPane` was asked and what was undone, per call. */
  const recorder = () => {
    const panes: AlignedPane[] = [];
    const undone: number[] = [];
    return {
      panes,
      undone,
      onPane: (pane: AlignedPane): Disposable => {
        panes.push(pane);
        const n = panes.length - 1;
        return () => void undone.push(n);
      },
    };
  };

  it('hooks every editable pane with the pane\'s editor and the id of the document it shows', async () => {
    const r = recorder();
    const s = await setup({ onPane: r.onPane });
    expect(r.panes.map((p) => [p.side, p.docId])).toEqual([
      ['original', s.originalId],
      ['modified', s.docId],
    ]);
    expect(r.panes[0].editor).toBeDefined();
    expect(r.undone).toEqual([]);
    s.handle.dispose();
  });

  it('gives a read-only original side and a text original no hook', async () => {
    const locked = recorder();
    const a = await setup({ onPane: locked.onPane, lockOriginal: true });
    expect(locked.panes.map((p) => p.side)).toEqual(['modified']);
    a.handle.dispose();
    const text = recorder();
    const b = await setup({ onPane: text.onPane, text: true });
    expect(text.panes.map((p) => [p.side, p.docId])).toEqual([['modified', b.docId]]);
    b.handle.dispose();
  });

  it('follows the lock while the view is open: a pane that is locked loses its hook and gets it back when unlocked', async () => {
    const r = recorder();
    const s = await setup({ onPane: r.onPane });
    lockDoc(s.docId, true);
    expect(r.undone).toEqual([1]);
    lockDoc(s.docId, false);
    expect(r.panes.map((p) => p.side)).toEqual(['original', 'modified', 'modified']);
    s.handle.dispose();
    expect(r.undone.sort()).toEqual([1, 2, 0].sort());
  });

  it('lets go of a pane whose model changes, and of both on close; nothing is hooked after that', async () => {
    const r = recorder();
    const s = await setup({ onPane: r.onPane });
    for (const fn of editorOf('original').modelListeners) fn();
    expect(r.undone).toEqual([0]);
    lockDoc(s.originalId, true);
    lockDoc(s.originalId, false);
    expect(r.panes).toHaveLength(2); // the pane no longer shows its document: no new hook
    s.handle.dispose();
    expect(r.undone).toEqual([0, 1]);
    lockDoc(s.docId, true);
    lockDoc(s.docId, false);
    expect(r.panes).toHaveLength(2);
    expect(editorOf('original').modelListeners).toEqual([]);
  });

  it('asks for nothing when the request has no onPane', async () => {
    const s = await setup();
    s.handle.dispose();
  });
});

describe('closing', () => {
  it('disposes both editors but not the documents’ models, and nothing runs afterwards', async () => {
    const s = await setup();
    for (const fn of editorOf('modified').contentListeners) fn();
    s.handle.dispose();
    expect(editorOf('original').disposed).toBe(true);
    expect(editorOf('modified').disposed).toBe(true);
    expect(s.original.disposed).toBe(false);
    expect(s.modified.disposed).toBe(false);
    const calls = s.align.mock.calls.length;
    await vi.advanceTimersByTimeAsync(RECOMPUTE_DELAY_MS * 3);
    expect(s.align.mock.calls.length).toBe(calls);
    expect(s.handle.isCurrent()).toBe(false);
    expect(s.handle.cursor()).toBeNull();
    s.handle.dispose(); // twice is harmless
  });
});
