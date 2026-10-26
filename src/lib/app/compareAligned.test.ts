// The aligned view of the comparison (Phase 4 plan X30, P4.25) at the service: the view's state
// over the mode, the alignment under the review toggles, and the three merges (a block, a row,
// a run of words) with their undo. The documents are REAL Monaco text models with the real undo
// stack (`monaco/realModel.ts`), so "one undo step of the target" is what Monaco does and not
// what a fake is told; the aligned view itself is a stand-in that holds the cursor and the models
// (its drawing is `monaco/alignedView.test.ts`).

import { render } from 'svelte/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
  createCompareService,
  compare,
  compareController,
  modalStateAfterLine,
  modalStatesAroundEdit,
  type CompareController,
  type CompareDeps,
} from './compare';
import CompareView from '$lib/components/editor/CompareView.svelte';
import compareContribution from '$lib/contrib/compare';
import { createDocumentStore, docs as appDocs } from '$lib/stores/documents';
import { createLayoutStore } from '$lib/stores/layout';
import { profiles as appProfiles } from '$lib/stores/profiles';
import { codes as appCodes } from '$lib/stores/codes';
import { hasKey, t } from '$lib/i18n';
import { copyRowPlan } from '$lib/core/compare/aligned';
import { realModel, type RealModel } from '$lib/monaco/realModel';
import type { AlignedCursor, AlignedHandle } from '$lib/monaco/alignedView';
import type { DiffCursor, DiffLineChange, DiffSide } from '$lib/monaco/diff';
import type { EffectiveProfile } from '$lib/core/machines/types';
import type { CommandContext, DecodeResult, DocId, NewDocMeta, StatusService } from '$lib/app/types';

function newDoc(over: Partial<NewDocMeta> = {}): NewDocMeta {
  return {
    path: null,
    untitledIndex: 1,
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
    ...over,
  };
}

function decoded(text: string): DecodeResult {
  return {
    ok: true,
    text,
    encoding: { encoding: 'utf-8', hasBom: false },
    eol: 'lf',
    eolMixed: false,
    nul: { leader: 0, trailer: 0, stripped: 0 },
  };
}

/** A stand-in for the aligned view: the models, a cursor, and the alignment the service computes from their text. */
class FakeAligned {
  readonly aligned = true as const;
  cursorPos: AlignedCursor = { side: 'modified', line: 1, column: 1 };
  fresh = true;
  calls: string[] = [];
  constructor(
    private readonly models: Record<DiffSide, RealModel>,
    private readonly service: () => CompareController,
  ) {}
  result() {
    return this.service().align({ reuse: false });
  }
  isCurrent(): boolean {
    return this.fresh;
  }
  cursor(): DiffCursor {
    return { side: this.cursorPos.side, line: this.cursorPos.line };
  }
  cursorAt(): AlignedCursor {
    return this.cursorPos;
  }
  lineChanges(): DiffLineChange[] | null {
    return this.result()?.diff.changed.map((b) => ({
      originalStartLineNumber: b.originalCount > 0 ? b.originalStart : b.originalStart - 1,
      originalEndLineNumber: b.originalCount > 0 ? b.originalStart + b.originalCount - 1 : 0,
      modifiedStartLineNumber: b.modifiedCount > 0 ? b.modifiedStart : b.modifiedStart - 1,
      modifiedEndLineNumber: b.modifiedCount > 0 ? b.modifiedStart + b.modifiedCount - 1 : 0,
    })) ?? null;
  }
  planCopy(change: DiffLineChange, direction: 'toModified' | 'toOriginal', cursor: DiffCursor) {
    const result = this.result();
    return result ? copyRowPlan(result.diff, change, direction === 'toModified' ? 'original' : 'modified', cursor) : null;
  }
  model(side: DiffSide): RealModel {
    return this.models[side];
  }
  reveal(side: DiffSide, line: number): void {
    this.calls.push(`reveal:${side}:${line}`);
  }
  nextWhenUpdated(): void {
    this.calls.push('next');
  }
  focusSide(side: DiffSide): void {
    this.calls.push(`focus:${side}`);
  }
  goToDiff(direction: 'next' | 'previous'): void {
    this.calls.push(`go:${direction}`);
  }
  recompute(): void {}
  setInline(): void {}
  setIgnoreTrimWhitespace(): void {}
  focus(): void {}
  show(): void {}
  dispose(): void {}
}

interface Harness {
  service: CompareController;
  /** The text of the documents, which are the live models. */
  models: Record<DiffSide, RealModel>;
  docs: ReturnType<typeof createDocumentStore>;
  a: DocId;
  b: DocId;
  messages: string[];
  view: FakeAligned | null;
  memory: { value: unknown; writes: unknown[] };
  /** Opens a comparison of document `a` (modified) with document `b` (original). */
  open(): Promise<void>;
  /** Puts the aligned view up, as `AlignedDiff` does. */
  mount(cursor: AlignedCursor): FakeAligned;
}

/** `original` is document b, `modified` is document a, as `compare.open(a, { kind: 'document', docId: b })` makes them. */
function harness(
  original: string,
  modified: string,
  o: { fileOriginal?: boolean; codes?: boolean; modalStateAfter?: CompareDeps['modalStateAfter'] } = {},
): Harness {
  const docs = createDocumentStore({ caseInsensitivePaths: false });
  const layout = createLayoutStore({ regionOf: () => 'overlay' });
  const messages: string[] = [];
  const models = { original: realModel(original), modified: realModel(modified) };
  const a = docs.add(newDoc({ path: '/nc/A.nc', untitledIndex: null }));
  const b = docs.add(newDoc({ path: '/nc/B.nc', untitledIndex: null }));
  docs.activate(a);
  const status: StatusService = {
    current: { subscribe: () => () => {} },
    show(text, opts) {
      messages.push(`${opts?.error === true ? '!' : ''}${text}`);
    },
    clear() {},
  };
  const state: Harness = {
    models,
    docs,
    a,
    b,
    messages,
    view: null,
    memory: { value: undefined, writes: [] },
    service: undefined as unknown as CompareController,
    async open() {
      await state.service.open(a, o.fileOriginal === true ? { kind: 'file', path: '/other/B.nc' } : { kind: 'document', docId: b });
    },
    mount(cursor) {
      state.view = new FakeAligned(models, () => state.service);
      state.view.cursorPos = cursor;
      return state.view;
    },
  };
  const deps: CompareDeps = {
    docs,
    layout,
    status,
    profiles: { detect: (_p, _t, fallback) => fallback, compiled: (id) => appProfiles.compiled(id) },
    files: { open: () => Promise.resolve([]), newUntitled: () => 'x' },
    readDisk: () => Promise.resolve(decoded(original)),
    statSize: () => Promise.resolve(null),
    charCountOf: () => 0,
    textOf: (id) => (id === a ? models.modified : models.original).getValue(),
    effectiveOf: (id): EffectiveProfile => {
      const profileId = docs.get(id)?.profileId ?? 'fanuc-gcode';
      return {
        profile: appProfiles.profile(profileId),
        cp: appProfiles.compiled(profileId),
        codes: o.codes === true ? appCodes.forProfile(profileId) : (undefined as never),
        machine: { id: null, name: null, choice: 'none', key: `${profileId}:none`, params: {}, source: {} } as never,
      };
    },
    ...(o.codes === true ? { codesFor: (profileId: string) => appCodes.forProfile(profileId) } : {}),
    ...(o.modalStateAfter ? { modalStateAfter: o.modalStateAfter } : {}),
    pickFile: () => Promise.resolve(null),
    diff: () => state.view as unknown as AlignedHandle | null,
    focusEditorWhenBack: () => {},
    memory: {
      read: () => state.memory.value,
      write: (memo) => {
        state.memory.value = memo;
        state.memory.writes.push(memo);
      },
    },
  };
  state.service = createCompareService(deps);
  return state;
}

const ORIGINAL = ['O1000', 'N10 G90 G54', 'N20 G0 X0 Y0', 'N30 G1 X10. F1200', 'N40 G1 X20.', 'N50 M30'].join('\n');
const MODIFIED = ['O1000', 'N10 G90 G54', 'N20 G0 X0 Y0', 'N30 G1 X10. F1000', 'N40 G1 X20.', 'N50 M30'].join('\n');

describe('the view state of the editor', () => {
  it('is no longer captured by the compare module: the editor groups keep it (P4.21)', async () => {
    const diff = await import('$lib/monaco/diff');
    expect(diff).not.toHaveProperty('captureEditorViewState');
    expect(diff).not.toHaveProperty('restoreEditorViewState');
    expect(diff).toHaveProperty('modelCharCount');
  });
});

describe('the aligned view over the mode', () => {
  let h: Harness;
  beforeEach(async () => {
    h = harness(ORIGINAL, MODIFIED);
    await h.open();
  });

  it('is off to begin with, and leaves the mode alone when it comes on', () => {
    expect(get(h.service.aligned)).toBe(false);
    h.service.setMode('review');
    h.service.setAligned(true);
    expect(get(h.service.aligned)).toBe(true);
    expect(get(h.service.mode)).toBe('review');
  });

  it('is left by choosing Raw or Review, even the one that is already set', () => {
    h.service.setAligned(true);
    h.service.setMode('raw');
    expect(get(h.service.aligned)).toBe(false);
    expect(get(h.service.mode)).toBe('raw');
    h.service.setAligned(true);
    h.service.setMode('review');
    expect(get(h.service.aligned)).toBe(false);
    expect(get(h.service.mode)).toBe('review');
  });

  it('toggles, and does nothing when asked for what it is', () => {
    h.service.toggleAligned();
    expect(get(h.service.aligned)).toBe(true);
    const writes = h.memory.writes.length;
    h.service.setAligned(true);
    expect(h.memory.writes).toHaveLength(writes);
    h.service.toggleAligned();
    expect(get(h.service.aligned)).toBe(false);
  });

  it('is remembered with the other compare settings, and read back as a boolean only', async () => {
    h.service.setAligned(true);
    expect(h.memory.value).toMatchObject({ mode: 'raw', aligned: true });
    h.service.setAligned(false);
    expect(h.memory.value).not.toHaveProperty('aligned');

    const again = harness(ORIGINAL, MODIFIED);
    again.memory.value = { mode: 'review', aligned: true };
    await again.open();
    expect(get(again.service.aligned)).toBe(true);
    expect(get(again.service.mode)).toBe('review');

    const bad = harness(ORIGINAL, MODIFIED);
    bad.memory.value = { aligned: 'yes' };
    await bad.open();
    expect(get(bad.service.aligned)).toBe(false);
  });

  it('shows the documents themselves in both panes, and keeps the review bar’s facts', () => {
    h.service.setMode('review');
    expect(get(h.service.sides)?.modified.kind).toBe('text');
    h.service.setAligned(true);
    expect(get(h.service.sides)).toMatchObject({
      original: { kind: 'document', docId: h.b },
      modified: { kind: 'document', docId: h.a },
    });
    expect(get(h.service.review)).not.toBeNull();
    h.service.setMode('raw');
    expect(get(h.service.review)).toBeNull();
    h.service.setAligned(true);
    expect(get(h.service.review)).not.toBeNull();
  });

  it('copies like the raw view, not like review mode (which copies nothing)', () => {
    h.service.setMode('review');
    expect(get(h.service.copyBlock).toModified).toBe('review');
    h.service.setAligned(true);
    expect(get(h.service.copyBlock)).toEqual({ toModified: null, toOriginal: null });
  });

  it('goes to a line of the file as written, not through the review line map', () => {
    h.service.setAligned(true);
    const view = h.mount({ side: 'modified', line: 1, column: 1 });
    expect(h.service.goToLine(4)).toBe(true);
    expect(view.calls).toContain('reveal:modified:4');
    expect(h.service.goToLine(2, 'original')).toBe(true);
    expect(view.calls).toContain('reveal:original:2');
  });
});

describe('the alignment under the review toggles', () => {
  const renumbered = ORIGINAL.replace(/^N(\d+)/gm, (_m, n: string) => `N${Number(n) * 10}`);

  it('ignores block numbers when the toggle says so: a renumbered program has no difference', async () => {
    const h = harness(ORIGINAL, renumbered);
    await h.open();
    h.service.setAligned(true);
    h.service.setOptions({ ignoreBlockNumbers: true });
    expect(h.service.align()?.diff.changed).toEqual([]);
    h.service.setOptions({ ignoreBlockNumbers: false });
    expect(h.service.align({ reuse: true })?.diff.changed.length).toBeGreaterThan(0);
  });

  it('applies the toggles of the bar to the alignment', async () => {
    const h = await (async () => {
      const x = harness('G1 X1. (A)\nG1 X2.', 'g1 X1. (B)\nG1 X2.');
      await x.open();
      x.service.setAligned(true);
      return x;
    })();
    const off = { ignoreBlockNumbers: false, ignoreWhitespace: false, ignoreComments: false, ignoreCase: false, ignoreNumberFormat: false };
    h.service.setOptions(off);
    expect(h.service.align()?.diff.changed).toHaveLength(1);
    h.service.setOptions({ ignoreComments: true });
    expect(h.service.align()?.diff.changed).toHaveLength(1); // `g1` against `G1` still differs
    h.service.setOptions({ ignoreCase: true });
    expect(h.service.align()?.diff.changed).toEqual([]);
    h.service.setOptions({ ignoreCase: false });
    expect(h.service.align()?.diff.changed).toHaveLength(1);
  });

  it('reuses the normalization the bar was built from, or builds it again from the text', async () => {
    const h = harness(ORIGINAL, MODIFIED);
    await h.open();
    h.service.setAligned(true);
    const built = get(h.service.review);
    h.service.align({ reuse: true });
    expect(get(h.service.review)).toBe(built);
    h.service.align({ reuse: false });
    expect(get(h.service.review)).not.toBe(built);
  });

  it('answers null with no comparison', () => {
    const h = harness(ORIGINAL, MODIFIED);
    expect(h.service.align()).toBeNull();
  });
});

/** The text of a model after `n` undo steps. */
function undone(model: RealModel, n = 1): string {
  for (let i = 0; i < n; i++) model.undo();
  return model.getValue();
}

describe('merging a block', () => {
  async function aligned(original: string, modified: string, cursor: AlignedCursor, o: { fileOriginal?: boolean } = {}) {
    const h = harness(original, modified, o);
    await h.open();
    h.service.setAligned(true);
    h.mount(cursor);
    return h;
  }

  it('copies the original’s lines over the document’s as one undo step of the document', async () => {
    const h = await aligned(ORIGINAL, MODIFIED, { side: 'modified', line: 4, column: 1 });
    // Something typed before the merge is its own step.
    h.models.modified.pushEditOperations(null, [{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: '%' }], () => null);
    expect(await h.service.copyChange('toModified')).toBe(true);
    expect(h.models.modified.getValue()).toBe(['%O1000', 'N10 G90 G54', 'N20 G0 X0 Y0', 'N30 G1 X10. F1200', 'N40 G1 X20.', 'N50 M30'].join('\n'));
    // One undo takes the merge back and leaves what was typed.
    expect(undone(h.models.modified)).toBe(['%O1000', 'N10 G90 G54', 'N20 G0 X0 Y0', 'N30 G1 X10. F1000', 'N40 G1 X20.', 'N50 M30'].join('\n'));
    expect(undone(h.models.modified)).toBe(MODIFIED);
    // The original was not touched, and the target takes the keyboard (so Cmd+Z reaches it).
    expect(h.models.original.getValue()).toBe(ORIGINAL);
    expect(h.view!.calls).toContain('focus:modified');
  });

  it('copies the document’s lines over the original’s the other way, one undo step of the original', async () => {
    const h = await aligned(ORIGINAL, MODIFIED, { side: 'original', line: 4, column: 1 });
    expect(await h.service.copyChange('toOriginal')).toBe(true);
    expect(h.models.original.getValue()).toBe(MODIFIED);
    expect(h.view!.calls).toContain('focus:original');
    expect(undone(h.models.original)).toBe(ORIGINAL);
    expect(h.models.modified.getValue()).toBe(MODIFIED);
  });

  it('does not merge what it copied into what is typed next', async () => {
    const h = await aligned(ORIGINAL, MODIFIED, { side: 'modified', line: 4, column: 1 });
    await h.service.copyChange('toModified');
    h.models.modified.pushEditOperations(null, [{ range: { startLineNumber: 6, startColumn: 8, endLineNumber: 6, endColumn: 8 }, text: ' (END)' }], () => null);
    expect(undone(h.models.modified)).toBe(
      ['O1000', 'N10 G90 G54', 'N20 G0 X0 Y0', 'N30 G1 X10. F1200', 'N40 G1 X20.', 'N50 M30'].join('\n'),
    );
    expect(undone(h.models.modified)).toBe(MODIFIED);
  });

  it('inserts a block the document lacks, and removes one the original lacks', async () => {
    const withExtra = ['O1000', 'N10 G90 G54', 'N15 G4 P500', 'N20 G0 X0 Y0', 'N30 G1 X10. F1200', 'N40 G1 X20.', 'N50 M30'].join('\n');
    const h = await aligned(withExtra, ORIGINAL, { side: 'original', line: 3, column: 1 });
    // The original has the dwell; the document does not: copy it in.
    expect(await h.service.copyChange('toModified')).toBe(true);
    expect(h.models.modified.getValue()).toBe(withExtra);
    expect(undone(h.models.modified)).toBe(ORIGINAL);

    const g = await aligned(ORIGINAL, withExtra, { side: 'modified', line: 3, column: 1 });
    // The document has the dwell; the original does not: copying to the original inserts it there.
    expect(await g.service.copyChange('toOriginal')).toBe(true);
    expect(g.models.original.getValue()).toBe(withExtra);
    // Copying the original (nothing there) over the document removes the lines from the document.
    const k = await aligned(ORIGINAL, withExtra, { side: 'modified', line: 3, column: 1 });
    expect(await k.service.copyChange('toModified')).toBe(true);
    expect(k.models.modified.getValue()).toBe(ORIGINAL);
    expect(undone(k.models.modified)).toBe(withExtra);
  });

  it('copies a block whose lines the options drop together with the rest of it', async () => {
    const o = 'G1 X1.\n(OLD NOTE)\nG1 X2. F100\nM30';
    const m = 'G1 X1.\nG1 X2. F200\nM30';
    const h = await aligned(o, m, { side: 'modified', line: 2, column: 1 });
    h.service.setOptions({ ignoreComments: true });
    expect(await h.service.copyChange('toModified')).toBe(true);
    expect(h.models.modified.getValue()).toBe(o);
  });

  it('copies one row with lineOnly, pairing by rows and not by the position in the block', async () => {
    const o = 'G1 X1.\n(NOTE)\nG1 X2. F100\nG1 X3.\nM30';
    const m = 'G1 X1.\nG1 X2. F200\nG1 X3.\nM30';
    const h = await aligned(o, m, { side: 'original', line: 3, column: 1 });
    h.service.setOptions({ ignoreComments: true });
    expect(await h.service.copyChange('toModified', { lineOnly: true })).toBe(true);
    // The cursor was on original line 3, which faces modified line 2 (the comment has a row of its own).
    expect(h.models.modified.getValue()).toBe('G1 X1.\nG1 X2. F100\nG1 X3.\nM30');
    expect(undone(h.models.modified)).toBe(m);
  });

  it('goes on to the next difference when asked', async () => {
    const h = await aligned(ORIGINAL, MODIFIED, { side: 'modified', line: 4, column: 1 });
    expect(await h.service.copyChange('toModified', { thenNext: true })).toBe(true);
    expect(h.view!.calls).toContain('next');
  });

  describe('refuses', () => {
    it('a merge into a locked document', async () => {
      const h = await aligned(ORIGINAL, MODIFIED, { side: 'modified', line: 4, column: 1 });
      h.docs.update(h.a, { readOnly: true, readOnlyReason: 'user' });
      expect(await h.service.copyChange('toModified')).toBe(false);
      expect(h.messages).toEqual([`!${t('compare.copyLocked')}`]);
      expect(h.models.modified.getValue()).toBe(MODIFIED);
    });

    it('a merge into an original that is a file', async () => {
      const h = await aligned(ORIGINAL, MODIFIED, { side: 'original', line: 4, column: 1 }, { fileOriginal: true });
      expect(await h.service.copyChange('toOriginal')).toBe(false);
      expect(h.messages).toEqual([`!${t('compare.copyNotDocument')}`]);
    });

    it('a merge from an alignment that is out of date', async () => {
      const h = await aligned(ORIGINAL, MODIFIED, { side: 'modified', line: 4, column: 1 });
      h.view!.fresh = false;
      expect(await h.service.copyChange('toModified')).toBe(false);
      expect(h.messages).toEqual([`!${t('compare.copyBusy')}`]);
      expect(h.models.modified.getValue()).toBe(MODIFIED);
    });

    it('a merge where the cursor is in no difference', async () => {
      const h = await aligned(ORIGINAL, MODIFIED, { side: 'modified', line: 1, column: 1 });
      expect(await h.service.copyChange('toModified')).toBe(false);
      expect(h.messages).toEqual([`!${t('compare.copyNoChange')}`]);
    });
  });
});

describe('merging a run of words', () => {
  async function aligned(original: string, modified: string, cursor: AlignedCursor, o: { fileOriginal?: boolean } = {}) {
    const h = harness(original, modified, o);
    await h.open();
    h.service.setAligned(true);
    h.mount(cursor);
    return h;
  }

  it('replaces the word in the document with the original’s, as one undo step of the document', async () => {
    // F1200 starts at column 13 of line 4 in the original pane.
    const h = await aligned(ORIGINAL, MODIFIED, { side: 'original', line: 4, column: 14 });
    expect(await h.service.copyWord('toModified')).toBe(true);
    expect(h.models.modified.getValue()).toBe(ORIGINAL);
    expect(h.view!.calls).toContain('focus:modified');
    expect(undone(h.models.modified)).toBe(MODIFIED);
    expect(h.models.original.getValue()).toBe(ORIGINAL);
  });

  it('replaces the word in the original with the document’s, as one undo step of the original', async () => {
    const h = await aligned(ORIGINAL, MODIFIED, { side: 'modified', line: 4, column: 14 });
    expect(await h.service.copyWord('toOriginal')).toBe(true);
    expect(h.models.original.getValue()).toBe(MODIFIED);
    expect(undone(h.models.original)).toBe(ORIGINAL);
    expect(h.models.modified.getValue()).toBe(MODIFIED);
  });

  it('leaves the other words of the line, and the other places where it differs, alone', async () => {
    const o = 'G1 Y2. X1. F100\nM30';
    const m = 'G1 Y5. X1. F200\nM30';
    const h = await aligned(o, m, { side: 'original', line: 1, column: 5 });
    expect(await h.service.copyWord('toModified')).toBe(true);
    expect(h.models.modified.getValue()).toBe('G1 Y2. X1. F200\nM30');
  });

  it('copies words that stand together as one run', async () => {
    const o = 'G1 X1. Y2. F100\nM30';
    const m = 'G1 X1. Y5. F200\nM30';
    const h = await aligned(o, m, { side: 'original', line: 1, column: 8 });
    expect(await h.service.copyWord('toModified')).toBe(true);
    expect(h.models.modified.getValue()).toBe(o);
  });

  it('takes words in and out of a line', async () => {
    const h = await aligned('G1 X1. Y2. F100', 'G1 X1. F100', { side: 'original', line: 1, column: 8 });
    expect(await h.service.copyWord('toModified')).toBe(true);
    expect(h.models.modified.getValue()).toBe('G1 X1. Y2. F100');
    const g = await aligned('G1 X1. F100', 'G1 X1. Y2. F100', { side: 'modified', line: 1, column: 8 });
    expect(await g.service.copyWord('toModified')).toBe(true);
    expect(g.models.modified.getValue()).toBe('G1 X1. F100');
  });

  it('does not mark or copy what the options ignore (a renumbered block)', async () => {
    const h = await aligned('N10 G1 X1.', 'N20 G1 X1.', { side: 'original', line: 1, column: 2 });
    h.service.setOptions({ ignoreBlockNumbers: true });
    expect(await h.service.copyWord('toModified')).toBe(false);
    expect(h.messages).toEqual([`!${t('compare.wordNoWord')}`]);
    h.service.setOptions({ ignoreBlockNumbers: false });
    expect(await h.service.copyWord('toModified')).toBe(true);
    expect(h.models.modified.getValue()).toBe('N10 G1 X1.');
  });

  describe('the words moved or would glue (review NC-1)', () => {
    it('a feed that moved to another place is replaced where it stands, one F on the line', async () => {
      const o = 'N30 G1 X10. Y20. F100';
      const m = 'N30 G1 F200 X10. Y20.';
      const h = await aligned(o, m, { side: 'original', line: 1, column: o.indexOf('F100') + 2 });
      expect(await h.service.copyWord('toModified')).toBe(true);
      expect(h.models.modified.getValue()).toBe('N30 G1 F100 X10. Y20.');
      expect(h.models.original.getValue()).toBe(o);
      const g = await aligned(o, m, { side: 'modified', line: 1, column: m.indexOf('F200') + 2 });
      expect(await g.service.copyWord('toOriginal')).toBe(true);
      expect(g.models.original.getValue()).toBe('N30 G1 X10. Y20. F200');
      expect(g.models.modified.getValue()).toBe(m);
    });

    it('refuses a copy that would double or drop a letter, and changes neither text', async () => {
      const o = 'G1 X10 Y20 X30';
      const m = 'G1 Y20 X11 X30';
      const h = await aligned(o, m, { side: 'original', line: 1, column: o.indexOf('X10') + 2 });
      expect(await h.service.copyWord('toModified')).toBe(false);
      expect(h.messages).toEqual([`!${t('compare.wordMoved')}`]);
      expect(h.models.original.getValue()).toBe(o);
      expect(h.models.modified.getValue()).toBe(m);
      const g = await aligned(o, m, { side: 'modified', line: 1, column: m.indexOf('X11') + 2 });
      expect(await g.service.copyWord('toOriginal')).toBe(false);
      expect(g.messages).toEqual([`!${t('compare.wordMoved')}`]);
      expect(g.models.original.getValue()).toBe(o);
      expect(g.models.modified.getValue()).toBe(m);
    });

    it('refuses a copy that would write words the line does not read as, and changes neither text', async () => {
      const o = '23-=+ 2';
      const m = '-++Y1GYF';
      const h = await aligned(o, m, { side: 'modified', line: 1, column: m.indexOf('GYF') + 2 });
      expect(await h.service.copyWord('toModified')).toBe(false);
      expect(h.messages).toEqual([`!${t('compare.wordJoins')}`]);
      expect(h.models.original.getValue()).toBe(o);
      expect(h.models.modified.getValue()).toBe(m);
    });
  });

  describe('refuses', () => {
    it('with no comparison, outside the aligned view, and from a stale alignment', async () => {
      const none = harness(ORIGINAL, MODIFIED);
      expect(await none.service.copyWord('toModified')).toBe(false);
      expect(none.messages).toEqual([`!${t('compare.noDocument')}`]);

      const raw = harness(ORIGINAL, MODIFIED);
      await raw.open();
      expect(await raw.service.copyWord('toModified')).toBe(false);
      expect(raw.messages).toEqual([`!${t('compare.wordNeedsAligned')}`]);

      const h = await aligned(ORIGINAL, MODIFIED, { side: 'original', line: 4, column: 14 });
      h.view!.fresh = false;
      expect(await h.service.copyWord('toModified')).toBe(false);
      expect(h.messages).toEqual([`!${t('compare.copyBusy')}`]);
    });

    it('a locked document and an original that is a file', async () => {
      const h = await aligned(ORIGINAL, MODIFIED, { side: 'original', line: 4, column: 14 });
      h.docs.update(h.a, { readOnly: true, readOnlyReason: 'user' });
      expect(await h.service.copyWord('toModified')).toBe(false);
      expect(h.messages).toEqual([`!${t('compare.copyLocked')}`]);
      const f = await aligned(ORIGINAL, MODIFIED, { side: 'modified', line: 4, column: 14 }, { fileOriginal: true });
      expect(await f.service.copyWord('toOriginal')).toBe(false);
      expect(f.messages).toEqual([`!${t('compare.copyNotDocument')}`]);
    });

    it('a cursor that is not in a marked word', async () => {
      const h = await aligned(ORIGINAL, MODIFIED, { side: 'original', line: 4, column: 2 });
      expect(await h.service.copyWord('toModified')).toBe(false);
      expect(h.messages).toEqual([`!${t('compare.wordNoWord')}`]);
      expect(h.models.modified.getValue()).toBe(MODIFIED);
    });

    it('an identical line answers "no changed word", a line with no partner "no matching line" (GB)', async () => {
      const same = await aligned(ORIGINAL, MODIFIED, { side: 'original', line: 5, column: 2 });
      expect(await same.service.copyWord('toModified')).toBe(false);
      expect(same.messages).toEqual([`!${t('compare.wordNoWord')}`]);
      const alone = await aligned('G1 X1.\nM5', 'G1 X1.', { side: 'original', line: 2, column: 2 });
      expect(await alone.service.copyWord('toModified')).toBe(false);
      expect(alone.messages).toEqual([`!${t('compare.wordNoPair')}`]);
    });
  });
});

describe('a copy where the two programs are in different modes (review NC-6)', () => {
  async function aligned(original: string, modified: string, cursor: AlignedCursor, o: Parameters<typeof harness>[2] = {}) {
    const h = harness(original, modified, { codes: true, ...o });
    await h.open();
    h.service.setAligned(true);
    h.mount(cursor);
    return h;
  }
  const warning = (original: string, modified: string) => `!${t('compare.modesDiffer', { original, modified })}`;

  // Line 3 is incremental on the left and absolute on the right; line 4 differs in F.
  const INC = ['O1000', 'N10 G90 G54 G17', 'N20 G91', 'N30 G1 X10. F1200', 'N40 M30'].join('\n');
  const ABS = ['O1000', 'N10 G90 G54 G17', 'N20 G90', 'N30 G1 X10. F1000', 'N40 M30'].join('\n');

  it('copies a change anyway, and then warns: G91 in the original, G90 in the current document', async () => {
    const h = await aligned(INC, ABS, { side: 'modified', line: 4, column: 1 });
    expect(await h.service.copyChange('toModified', { lineOnly: true })).toBe(true);
    expect(h.models.modified.getValue()).toBe(ABS.replace('F1000', 'F1200'));
    expect(h.messages).toEqual([warning('G91', 'G90')]);
    // The other way names the same modes on the same sides.
    h.messages.length = 0;
    expect(undone(h.models.modified)).toBe(ABS);
    h.view!.cursorPos = { side: 'original', line: 4, column: 1 };
    expect(await h.service.copyChange('toOriginal', { lineOnly: true })).toBe(true);
    expect(h.models.original.getValue()).toBe(INC.replace('F1200', 'F1000'));
    expect(h.messages).toEqual([warning('G91', 'G90')]);
  });

  it('copies a word anyway, and then warns, naming every mode that differs in order', async () => {
    const o = ['O1000', 'G20 G91 G18 G55', 'G1 X10. F100', 'M30'].join('\n');
    const m = ['O1000', 'G21 G90 G17 G54', 'G1 X10. F200', 'M30'].join('\n');
    // F100 starts at column 9 of line 3.
    const h = await aligned(o, m, { side: 'original', line: 3, column: 10 });
    expect(await h.service.copyWord('toModified')).toBe(true);
    expect(h.models.modified.getValue()).toBe(m.replace('F200', 'F100'));
    expect(h.messages).toEqual([warning('G91, inch, G18, G55', 'G90, mm, G17, G54')]);
  });

  it('says nothing when the modes are the same at that place, or where the copy only removes lines', async () => {
    const same = await aligned(ORIGINAL, MODIFIED, { side: 'modified', line: 4, column: 1 });
    expect(await same.service.copyChange('toModified')).toBe(true);
    expect(same.messages).toEqual([]);
    // The original lacks the line in front of M30: copying that gap removes the document's line.
    const removal = await aligned(
      ['G91', 'G1 X1.', 'M30'].join('\n'),
      ['G90', 'G1 X1.', 'G1 X2.', 'M30'].join('\n'),
      { side: 'modified', line: 3, column: 1 },
    );
    expect(await removal.service.copyChange('toModified')).toBe(true);
    expect(removal.models.modified.getValue()).toBe(['G90', 'G1 X1.', 'M30'].join('\n'));
    expect(removal.messages).toEqual([]);
  });

  it('reads a file that is not open as a document with its own profile, walking its text', async () => {
    const h = await aligned(INC, ABS, { side: 'modified', line: 4, column: 1 }, { fileOriginal: true });
    expect(await h.service.copyChange('toModified', { lineOnly: true })).toBe(true);
    expect(h.messages).toEqual([warning('G91', 'G90')]);
  });

  it('takes the state of an open document from the modal index when it has the line', async () => {
    const asked: [DocId, number][] = [];
    // The index says the document is incremental above line 4, whatever its text says.
    const indexed = modalStateAfterLine(['N10 G90 G54 G17', 'N20 G91'], appProfiles.compiled('fanuc-gcode'), appCodes.forProfile('fanuc-gcode'), 2);
    const h = await aligned(ABS, ABS.replace('F1000', 'F900'), { side: 'modified', line: 4, column: 1 }, {
      modalStateAfter: (docId, line) => {
        asked.push([docId, line]);
        return docId === h.a ? indexed : null;
      },
    });
    expect(await h.service.copyChange('toModified', { lineOnly: true })).toBe(true);
    expect(asked).toEqual([
      [h.b, 3],
      [h.a, 3],
    ]);
    expect(h.messages).toEqual([warning('G90', 'G91')]);
  });

  it('never stands in the way of a copy: no database, no warning', async () => {
    const h = await aligned(INC, ABS, { side: 'modified', line: 4, column: 1 }, { codes: false });
    expect(await h.service.copyChange('toModified', { lineOnly: true })).toBe(true);
    expect(h.models.modified.getValue()).toBe(ABS.replace('F1000', 'F1200'));
    expect(h.messages).toEqual([]);
  });
});

describe('a copy that changes the modes of the lines below it (the owner, 2026-10-20)', () => {
  async function aligned(original: string, modified: string, cursor: AlignedCursor, o: Parameters<typeof harness>[2] = {}) {
    const h = harness(original, modified, { codes: true, ...o });
    await h.open();
    h.service.setAligned(true);
    h.mount(cursor);
    return h;
  }
  const front = (original: string, modified: string) => `!${t('compare.modesDiffer', { original, modified })}`;
  const end = (before: string, after: string) => `!${t('compare.modesChangeBelow', { before, after })}`;
  const join = (lines: string[]) => lines.join('\n');

  // Lines 3 and 4 differ: the original's block ends in G91, the document's in G90.
  const ENDS_INC = join(['O1000', 'G90 G54 G17', 'G1 X1. F100', 'G91', 'G1 X2.', 'M30']);
  const ENDS_ABS = join(['O1000', 'G90 G54 G17', 'G1 X1. F200', 'G90', 'G1 X2.', 'M30']);

  it('warns at the end only: the copied block ends in G91 where the lines below ran in G90', async () => {
    const h = await aligned(ENDS_INC, ENDS_ABS, { side: 'modified', line: 3, column: 1 });
    expect(await h.service.copyChange('toModified')).toBe(true);
    expect(h.models.modified.getValue()).toBe(ENDS_INC);
    expect(h.messages).toEqual([end('G90', 'G91')]);
    // The other way round: the original's lines below now run in G90 instead of G91.
    h.messages.length = 0;
    expect(undone(h.models.modified)).toBe(ENDS_ABS);
    h.view!.cursorPos = { side: 'original', line: 3, column: 1 };
    expect(await h.service.copyChange('toOriginal')).toBe(true);
    expect(h.models.original.getValue()).toBe(ENDS_ABS);
    expect(h.messages).toEqual([end('G91', 'G90')]);
  });

  it('warns in front only when the copied text leaves the modes below as they were', async () => {
    const o = join(['O1000', 'G91', 'G1 X1. F100', 'G1 X2.', 'M30']);
    const m = join(['O1000', 'G90', 'G1 X1. F200', 'G1 X2.', 'M30']);
    const h = await aligned(o, m, { side: 'modified', line: 3, column: 1 });
    expect(await h.service.copyChange('toModified', { lineOnly: true })).toBe(true);
    expect(h.models.modified.getValue()).toBe(m.replace('F200', 'F100'));
    expect(h.messages).toEqual([front('G91', 'G90')]);
  });

  it('names front and end in one message when both differ', async () => {
    const o = join(['O1000', 'G91', 'G0 Z5.', 'G1 X1. F100', 'G20', 'G1 X2.', 'M30']);
    const m = join(['O1000', 'G90', 'G0 Z5.', 'G1 X1. F200', 'G21', 'G1 X2.', 'M30']);
    const h = await aligned(o, m, { side: 'modified', line: 4, column: 1 });
    expect(await h.service.copyChange('toModified')).toBe(true);
    expect(h.models.modified.getValue()).toBe(m.replace('F200', 'F100').replace('G21', 'G20'));
    expect(h.messages).toEqual([
      `!${t('compare.modesDifferAndChange', { original: 'G91', modified: 'G90', before: 'mm', after: 'inch' })}`,
    ]);
  });

  it('warns when a copy only removes lines and the removed line held the mode', async () => {
    const o = join(['G90', 'G1 X1.', 'G1 X2.', 'M30']);
    const m = join(['G90', 'G1 X1.', 'G91', 'G1 X2.', 'M30']);
    const block = await aligned(o, m, { side: 'modified', line: 3, column: 1 });
    expect(await block.service.copyChange('toModified')).toBe(true);
    expect(block.models.modified.getValue()).toBe(o);
    expect(block.messages).toEqual([end('G91', 'G90')]);
    // The one-row copy removes the same line and says the same.
    const row = await aligned(o, m, { side: 'modified', line: 3, column: 1 });
    expect(await row.service.copyChange('toModified', { lineOnly: true })).toBe(true);
    expect(row.models.modified.getValue()).toBe(o);
    expect(row.messages).toEqual([end('G91', 'G90')]);
  });

  it('warns when a copied or removed word changes the modes of the lines below', async () => {
    const plain = join(['G90', 'G1 X1.', 'G1 X2.', 'M30']);
    const withG91 = join(['G90', 'G1 X1. G91', 'G1 X2.', 'M30']);
    // The original's G91 (columns 8–10 of line 2) goes into the document's line.
    const added = await aligned(withG91, plain, { side: 'original', line: 2, column: 9 });
    expect(await added.service.copyWord('toModified')).toBe(true);
    expect(added.models.modified.getValue()).toBe(withG91);
    expect(added.messages).toEqual([end('G90', 'G91')]);
    // The original has no G91: copying that removes the document's word.
    const removed = await aligned(plain, withG91, { side: 'modified', line: 2, column: 9 });
    expect(await removed.service.copyWord('toModified')).toBe(true);
    expect(removed.models.modified.getValue()).toBe(plain);
    expect(removed.messages).toEqual([end('G91', 'G90')]);
  });

  it('says nothing when the copy changes no mode, or when no line follows it', async () => {
    const same = await aligned(
      join(['G90', 'G1 X1. F100', 'G1 X2.', 'M30']),
      join(['G90', 'G1 X1. F200', 'G1 X2.', 'M30']),
      { side: 'modified', line: 2, column: 1 },
    );
    expect(await same.service.copyChange('toModified')).toBe(true);
    expect(same.messages).toEqual([]);
    // A G91 copied at the very end of the program changes nothing below it (a blank line is nothing).
    const last = await aligned(join(['G90', 'G1 X1.', 'G91', '']), join(['G90', 'G1 X1.', 'G90', '']), {
      side: 'modified',
      line: 3,
      column: 1,
    });
    expect(await last.service.copyChange('toModified')).toBe(true);
    expect(last.models.modified.getValue()).toBe(join(['G90', 'G1 X1.', 'G91', '']));
    expect(last.messages).toEqual([]);
  });

  it('never stands in the way of a copy: no database, no warning at the end either', async () => {
    const h = await aligned(ENDS_INC, ENDS_ABS, { side: 'modified', line: 3, column: 1 }, { codes: false });
    expect(await h.service.copyChange('toModified')).toBe(true);
    expect(h.models.modified.getValue()).toBe(ENDS_INC);
    expect(h.messages).toEqual([]);
  });

  it('reads the line below before and after the edit from one walk to the place', () => {
    const cp = appProfiles.compiled('fanuc-gcode');
    const db = appCodes.forProfile('fanuc-gcode');
    const lines = ['G90 G54', 'G1 X1.', 'G91', 'G1 X2.'];
    // Line 3 (G91) replaced by G90: G91 before, G90 after.
    const replaced = modalStatesAroundEdit(lines, cp, db, 3, 1, ['G90']);
    expect([replaced.before.distance, replaced.after.distance]).toEqual(['incremental', 'absolute']);
    // G55 inserted in front of line 2: the offset below changes, the distance does not.
    const inserted = modalStatesAroundEdit(lines, cp, db, 2, 0, ['G55']);
    expect([inserted.before.groups.offset?.code, inserted.after.groups.offset?.code]).toEqual(['G54', 'G55']);
    expect(inserted.after.distance).toBe('absolute');
    // The state before is the one the plain walk reads after the replaced lines.
    expect(replaced.before).toEqual(modalStateAfterLine(lines, cp, db, 3));
  });
});

describe('the compare view and its commands', () => {
  afterEach(() => {
    compare.close();
    compare.setMode('raw');
    for (const doc of appDocs.all()) appDocs.remove(doc.id);
  });

  it('carries a third button in the mode switch, and the aligned controls once it is on', async () => {
    const a = appDocs.add(newDoc({ path: '/nc/A.nc', untitledIndex: null }));
    const b = appDocs.add(newDoc({ path: '/nc/B.nc', untitledIndex: null }));
    await compare.open(a, { kind: 'document', docId: b });

    const raw = render(CompareView).body;
    expect(raw).toMatch(/data-testid="compare-mode"[^>]*data-mode="aligned"[^>]*aria-pressed="false"/);
    expect(raw).not.toContain('data-testid="compare-copy-word"');
    expect(raw).toContain(t('compare.sideBySide'));

    compareController.setAligned(true);
    const aligned = render(CompareView).body;
    expect(aligned).toContain('data-testid="compare-view" data-source="document" data-mode="aligned"');
    expect(aligned).toMatch(/data-testid="compare-mode"[^>]*data-mode="aligned"[^>]*aria-pressed="true"/);
    expect(aligned).toMatch(/data-testid="compare-mode"[^>]*data-mode="raw"[^>]*aria-pressed="false"/);
    // The review options decide what is equal here too.
    for (const option of ['ignoreBlockNumbers', 'ignoreWhitespace', 'ignoreComments', 'ignoreCase', 'ignoreNumberFormat']) {
      expect(aligned).toContain(`data-option="${option}"`);
    }
    expect(aligned).toContain('data-testid="aligned-host"');
    expect(aligned).toContain('data-testid="compare-copy-word"');
    expect(aligned).toMatch(/data-testid="compare-copy"[^>]*data-direction="toModified"[^>]*data-disabled="false"/);
    // No inline form and no raw whitespace switch in the aligned view.
    expect(aligned).not.toContain(t('compare.ignoreWhitespace') + '</label>');
    expect(aligned).not.toContain(t('compare.sideBySide'));
  });

  const byId = new Map(
    (compareContribution.commands ?? []).map((command) => [command.id, command] as const),
  );
  const context = (over: Partial<CommandContext> = {}): CommandContext => ({ compareOpen: false, ...over }) as CommandContext;

  it('adds three commands, enabled only while a comparison is open, with messages', () => {
    for (const id of ['compare.toggleAligned', 'compare.copyWordToModified', 'compare.copyWordToOriginal']) {
      const command = byId.get(id);
      expect(command, id).toBeDefined();
      expect(command?.enabled?.(context()), id).toBe(false);
      expect(command?.enabled?.(context({ compareOpen: true })), id).toBe(true);
      expect(hasKey(command!.title), id).toBe(true);
      // No key of their own: the block copy keys work in the aligned view as well.
      expect((command as { keys?: string }).keys, id).toBeUndefined();
    }
  });
});
