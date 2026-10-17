// X29 and X34, the line "split view (two groups on one 300,000-line document) keeps the Phase 1
// typing budget" (Phase 4 plan §5 P4e decision 14, §6.7 "The proofs"; the pattern is
// `app/p3Typing.budget.slow.test.ts`, which this one extends by the second group).
//
// What runs together, as the app does while someone types in the split view of a large program:
//
//   the real editor service with two groups on ONE model of 300,000 lines (a fake Monaco, whose
//   model is a line array), the real `ModalIndex` behind the real `createModalService`, the real
//   `createInspectorService` following the focused group's cursor, the real `createMotionColors`
//   painting BOTH group editors from their own visible range (one far from the other), and the
//   real bookmark service with twenty bookmarks on the document, 200 keystrokes at line 150,999
//   in the first group, with one idle slice of the index build between two keystrokes (an edit
//   drops the snapshots behind it, so the build has to start again every time).
//
// What a keystroke costs the main thread is the edit handlers (the listeners of the service, the
// modal service, the inspector, the colours of both groups and the bookmark mirror), the
// inspector's frame and the colours' frame; the idle slice is a task of its own, so it is timed
// separately. Nothing here is the application's WebKit (that is `p4-perf`, which measures each
// editor's view model); it is the work of the code, which is where a listener per group that
// repaints or maps the whole document for every keystroke would show.
//
// A wall-clock test on a shared machine: one stall of the machine is not the code's. The 200
// keystrokes run in three rounds and each measure is judged on its **best** round, the way the
// repo's `fastest` judges a steady state (`tests/unit/helpers/budget.ts`); the budgets are the
// same as for one round. A real slowdown is in every round.

import { writable } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { loadCodeDb } from '$lib/core/codes/load';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import { applyMachine, noMachine } from '$lib/core/machines/effective';
import { compileProfile } from '$lib/core/profiles/compile';
import { createDocumentStore } from '$lib/stores/documents';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { createInspectorService, type InspectorSnapshot } from '$lib/app/inspectorService';
import { createModalService } from '$lib/app/modalService';
import { createBookmarks, type BookmarkMonaco } from './bookmarks';
import { createEditorService } from './editorService';
import { createMotionColors } from './motionColors';
import { expectWithin } from '../../../tests/unit/helpers/budget';
import { groupMonaco, type FakeEditor, type FakeModel } from '../../../tests/unit/helpers/editorGroups';
import { profileOf } from '../../../tests/unit/helpers/profiles';
import type { Monaco } from '$lib/monaco/setup';
import type { EffectiveProfile } from '$lib/core/machines/types';
import type { DocId, Eol, FileEncoding, NewDocMeta } from '$lib/app/types';

const CODE_DBS = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, problem) => {
  throw new Error(`${dialect}: ${problem.path}: ${problem.message}`);
});

const LINES = 300_000;
const CURSOR_LINE = 150_999;
/** Where the second group looks in the two placements: at the top of the program, and at the very lines being edited. */
const HEADER_TOP = 20;
const SAME_TOP = CURSOR_LINE - 25;
const KEYSTROKES = 200;
/** Rounds of KEYSTROKES keystrokes; a measure counts with its best round. */
const ROUNDS = 3;

const META: NewDocMeta = {
  path: null,
  untitledIndex: 1,
  profileId: 'fanuc-gcode',
  encoding: { encoding: 'utf-8', hasBom: false } satisfies FileEncoding,
  eol: 'lf' satisfies Eol,
  eolMixedOnLoad: false,
  nul: { leader: 0, trailer: 0, stripped: 0 },
  textDirty: false,
  metaDirty: false,
  disk: null,
  external: 'none',
  readOnly: false,
  readOnlyReason: null,
};

const MONACO_ENUMS = {
  editor: { TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 }, OverviewRulerLane: { Left: 1 } },
} as unknown as BookmarkMonaco;

/** A mill program: moves, a cycle, a tool change, a comment, over and over. */
function program(n: number): string[] {
  const pool = ['G0 X0. Y0.', 'G1 X10. Y5. F100.', 'T2 M6', 'S1200 M3', 'G81 X5. Z-3. R1.', 'G80', 'G2 X20. Y5. I5. J0.', '(NEXT)'];
  return Array.from({ length: n }, (_, i) => pool[i % pool.length]);
}

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

describe('typing in split view on a 300k-line program', () => {
  it.each([
    // The header while editing: the second group is far above the edit, which cannot change what it shows.
    { placement: 'the second group looks at the top of the program', otherTop: HEADER_TOP, repainted: false },
    // A split just made: both groups show the lines being edited, and both are painted from one read.
    { placement: 'both groups look at the lines being edited', otherTop: SAME_TOP, repainted: true },
  ])('keeps every keystroke frame within the typing budget with two groups on one model, $placement, and a slice that reaches nothing new asks for no frame', async ({ otherTop, repainted }) => {
    const docs = createDocumentStore({ caseInsensitivePaths: false });
    const id: DocId = docs.add({ ...META }, { activate: true });

    const profile = profileOf('fanuc-gcode');
    const applied = applyMachine(profile, noMachine(profile));
    const cp = compileProfile(applied.profile);
    const codes = loadCodeDb(CODE_DBS[applied.codes]);
    const machine = noMachine(profile);
    const effective: EffectiveProfile = { profile: applied.profile, cp, codes, machine };

    // -- the editor service with two groups on the one model ---------------------------------
    const { api, state } = groupMonaco();
    const editor = createEditorService({ docs, loadMonaco: async () => api as Monaco });
    editor.createModel(id, program(LINES).join('\n'), 'fanuc-gcode', 'lf');
    await editor.attachGroup('g1', {} as HTMLElement);
    editor.openGroups({ layout: 'side-by-side', contents: [{ kind: 'document', docId: id }, { kind: 'document', docId: id }], focus: 0 });
    await editor.attachGroup('g2', {} as HTMLElement);
    const [first, second] = state.editors as [FakeEditor, FakeEditor];
    const model = state.models.get(`inmemory://doc/${id}`) as FakeModel;
    expect(first.getModel()).toBe(model);
    expect(second.getModel()).toBe(model);
    first.visible = { first: CURSOR_LINE - 25, last: CURSOR_LINE + 25 };
    second.visible = { first: otherTop, last: otherTop + 50 };
    first.setPosition({ lineNumber: CURSOR_LINE, column: 3 });
    expect(editor.groupViews().map((view) => view.id)).toEqual(['g1', 'g2']);
    expect(editor.cursor()?.line).toBe(CURSOR_LINE);

    // -- the modal service, on a manual idle queue -----------------------------------------
    const idleQueue: (() => void)[] = [];
    const modal = createModalService({
      docs,
      editor,
      effective: () => ({ cp, db: codes, key: 'fanuc-gcode' }),
      idle: (fn) => {
        idleQueue.push(fn);
        return () => void idleQueue.splice(idleQueue.indexOf(fn), 1);
      },
      schedule: () => () => {},
    });
    modal.start();

    // -- the inspector, following the focused group's cursor -------------------------------
    let inspected = 0;
    let inspectorFrame: (() => void) | null = null;
    const published: InspectorSnapshot[] = [];
    const inspector = createInspectorService({
      docs,
      editor,
      effective: () => {
        inspected++;
        return effective;
      },
      modal,
      revisions: [],
      frame: (fn) => {
        inspectorFrame = fn;
        return () => {
          inspectorFrame = null;
        };
      },
      applyLines: () => ({ changedLines: 0 }),
      prompt: async () => undefined,
      status: { show: () => {} },
      t: (key) => key,
    });
    inspector.snapshot.subscribe((s) => published.push(s));
    inspector.follow();

    // -- the colours of both group editors ---------------------------------------------------
    let colourFrame: (() => void) | null = null;
    let paintedFrames = 0;
    const colours = createMotionColors({
      editor: {
        getLines: (docId, from, to) => editor.getLines(docId, from, to),
        getLineCount: (docId) => editor.getLineCount(docId),
        onDidAttach: (cb) => editor.onDidAttach(cb),
        onDidActivate: (cb) => editor.onDidActivate(cb),
        onDidChangeContent: (cb) => editor.onDidChangeContent(cb),
        model: (docId) => editor.model(docId),
        groupViews: () => editor.groupViews(),
        groups: editor.groups,
      },
      docs,
      modal,
      effective: () => ({ cp, db: codes }),
      isNc: () => true,
      enabled: writable(true),
      theme: writable<'light' | 'dark'>('dark'),
      frame: (fn) => {
        colourFrame = () => {
          paintedFrames++;
          fn();
        };
        return () => {
          colourFrame = null;
        };
      },
      schedule: () => () => {},
      setProperty: () => {},
    });
    colours.start();

    // -- the bookmarks of the document -------------------------------------------------------
    const bookmarks = createBookmarks({ editor, docs });
    bookmarks.install(MONACO_ENUMS);
    for (let i = 0; i < 20; i++) bookmarks.toggle(id, 1000 + i * 9000);
    expect(bookmarks.lines(id)).toHaveLength(20);
    // No channel pane is open, so the bookmark mirror has nothing to do: the keystroke path costs it one test.

    // -- build the whole index once, as an idle app would, then type -------------------------
    while (idleQueue.length > 0) idleQueue.shift()!();
    const runFrames = (): void => {
      const a = inspectorFrame;
      inspectorFrame = null;
      a?.();
      const b = colourFrame;
      colourFrame = null;
      b?.();
    };
    runFrames();
    const last = published.at(-1)!;
    expect(last.kind === 'block' && last.inspection.stateReady).toBe(true);
    expect(first.collectionSets.length).toBeGreaterThan(0);
    expect(second.collectionSets.length).toBeGreaterThan(0);

    const inspectedBefore = inspected;
    const publishedBefore = published.length;
    const paintedBefore = paintedFrames;
    const firstBefore = first.collectionSets.length;
    const secondBefore = second.collectionSets.length;
    const rounds: { p95: number; max: number; slice: number; sliceFrame: number; slices: number }[] = [];

    for (let round = 0; round < ROUNDS; round++) {
      const keystrokeFrames: number[] = [];
      const slices: number[] = [];
      const sliceFrames: number[] = [];

      for (let i = 0; i < KEYSTROKES; i++) {
        // The keystroke: the model changes, every listener hears it, the frames run.
        const started = performance.now();
        model.edit(CURSOR_LINE, CURSOR_LINE, [`G1 X${i % 90}. Y${i % 70}. F${100 + ((i + round) % 9)}.`]);
        runFrames();
        keystrokeFrames.push(performance.now() - started);

        // One slice of the rebuild between two keystrokes, and whatever it asks for.
        const slice = idleQueue.shift();
        if (slice !== undefined) {
          const sliceStarted = performance.now();
          slice();
          slices.push(performance.now() - sliceStarted);
          const framesStarted = performance.now();
          runFrames();
          sliceFrames.push(performance.now() - framesStarted);
        }
      }
      rounds.push({
        p95: p95(keystrokeFrames),
        max: Math.max(...keystrokeFrames),
        slice: Math.max(...slices, 0),
        sliceFrame: Math.max(...sliceFrames, 0),
        slices: slices.length,
      });
    }
    const best = (measure: (r: (typeof rounds)[number]) => number): number => Math.min(...rounds.map(measure));

    // The Phase 1 typing budget is keypress-to-render p95 < 50 ms; no single frame may take more than 30 ms.
    expectWithin(best((r) => r.p95), 50, `keystroke frames, two groups, ${repainted ? 'same lines' : 'header'}, p95 of ${KEYSTROKES}, best of ${ROUNDS} rounds`);
    expectWithin(best((r) => r.max), 30, `the slowest keystroke frame, two groups, best of ${ROUNDS} rounds`);
    // The idle slice is a task of its own and stays within its 8 ms budget (plus the line it is on).
    for (const r of rounds) expect(r.slices).toBeGreaterThan(KEYSTROKES / 2);
    expectWithin(best((r) => r.slice), 30, `the slowest idle slice, best of ${ROUNDS} rounds`);
    expectWithin(best((r) => r.sliceFrame), 30, `the slowest frame after a slice, two groups, best of ${ROUNDS} rounds`);

    // The listeners are not multiplied by the groups: one block reading and one snapshot per frame, one colour update per frame.
    expect(inspected - inspectedBefore, 'block readings of the inspector').toBeLessThanOrEqual(ROUNDS * (KEYSTROKES + 2));
    expect(published.length - publishedBefore, 'snapshots the panel was given').toBeLessThanOrEqual(ROUNDS * (KEYSTROKES + 2));
    expect(paintedFrames - paintedBefore, 'colour updates').toBeLessThanOrEqual(ROUNDS * (KEYSTROKES + 2));
    // Both groups are repainted from their own range, once per frame at most.
    expect(first.collectionSets.length - firstBefore, 'colour sets of the first group').toBeLessThanOrEqual(ROUNDS * (KEYSTROKES + 2));
    expect(second.collectionSets.length - secondBefore, 'colour sets of the second group').toBeLessThanOrEqual(ROUNDS * (KEYSTROKES + 2));
    expect(first.collectionSets.length).toBeGreaterThan(firstBefore);
    if (repainted) expect(second.collectionSets.length).toBeGreaterThan(secondBefore);
    else expect(second.collectionSets.length, 'an edit below a group’s lines repaints nothing there').toBe(secondBefore);

    // And what is on screen is the edited program's: the second group shows the same model.
    const shown = published.at(-1)!;
    expect(shown.kind).toBe('block');
    if (shown.kind === 'block') {
      expect(shown.cursorLine).toBe(CURSOR_LINE);
      expect(shown.inspection.stateReady).toBe(true);
    }
    expect(second.getModel()?.getLineContent(CURSOR_LINE)).toBe(model.getLineContent(CURSOR_LINE));
    expect(bookmarks.lines(id)).toHaveLength(20);
  }, 180_000);
});
