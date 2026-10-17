// X29 and X34, the line "the channel view with two panes on a 300,000-line two-channel program
// keeps the Phase 1 typing budget" (Phase 4 plan §5 P4e decision 14, §6.7 "The proofs"; the pattern
// is `app/p3Typing.budget.slow.test.ts` and `editorGroups.typing.slow.test.ts`). The owner waived
// the budget for three and four panes on 300,000 lines (§7 #387): such programs come from 3D and
// 5-axis milling, not from multi-channel lathes, and nothing is measured for them.
//
// What runs together, as the app does while someone types in the second pane: the real editor
// service, the editor's own text models (the program of 300,000 lines, and the two pane models of
// 150,000 lines each), the real channel service resolving the program (incrementally, as it does for
// the editor), and the channel view. 200 keystrokes in pane 2 near the middle of the program:
//
//   the pane's edit, the mapping to the document (`mapPaneEdits`), the document's edit (one
//   `pushEditOperations`), `channels.fresh`, the re-projection of both panes, the alignment and the
//   marks, the zones — everything the view does for one keystroke, and `flush()` where the app's
//   microtask would run; and, as decision 14 lists "motion colours per group", the real modal
//   service (the index of the 300,000 lines, with one idle slice of its build between two
//   keystrokes, since an edit drops the snapshots behind it) and the real `createMotionColors`
//   painting BOTH pane editors from their own visible range through the panes' line mapping.
//
// A keystroke in six of every hundred is a line break (the program's lines below shift by one,
// every wait mark of both channels moves, the alignment is made again); the rest are characters.
// Nothing here is the application's WebKit (that is `p4-perf`, which measures each editor's view
// model); it is the work of the code, which is where a pass over the whole program per keystroke
// would show.
//
// A wall-clock test on a shared machine: one stall of the machine is not the code's. The 200
// keystrokes run in three rounds and each measure is judged on its **best** round.

import { get, writable } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { loadCodeDb } from '$lib/core/codes/load';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import { applyMachine, noMachine } from '$lib/core/machines/effective';
import { compileProfile } from '$lib/core/profiles/compile';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { createModalService } from '$lib/app/modalService';
import { createMotionColors } from './motionColors';
import { expectWithin } from '../../../tests/unit/helpers/budget';
import { paneWorld, sectionParams } from '../../../tests/unit/helpers/channelPanes';
import { profileOf } from '../../../tests/unit/helpers/profiles';
import type * as MonacoApi from 'monaco-editor/esm/vs/editor/editor.api.js';

type ITextModel = MonacoApi.editor.ITextModel;

const CODE_DBS = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, problem) => {
  throw new Error(`${dialect}: ${problem.path}: ${problem.message}`);
});

/** Sections of 501 lines: the channel line, 249 moves, a wait, 250 moves. */
const SECTION = 501;
const BLOCKS = 300;
const KEYSTROKES = 200;
const ROUNDS = 3;

/** A two-channel lathe program that alternates the channels, 300 × 2 × 501 + 3 lines = 300,603 lines. */
function program(): string[] {
  const lines = ['%', 'O0100', '(BIG PROGRAM)'];
  for (let block = 0; block < BLOCKS; block++) {
    for (const channel of [1, 2]) {
      lines.push(`CH${channel}`);
      for (let i = 0; i < SECTION - 1; i++) lines.push(i === 249 ? 'M901P12' : `G1 X${(i % 90) + 1}. Z-${(block + i) % 70}. F0.2`);
    }
  }
  return lines;
}

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

describe('typing in the channel view on a 300k-line two-channel program', () => {
  it('keeps every keystroke within the typing budget with two panes, and the panes agree with the program afterwards', async () => {
    const lines = program();
    expect(lines.length).toBeGreaterThan(300_000);
    // The resolution of 300,000 lines is not what is under test: no deadline.
    const w = await paneWorld(sectionParams(2), { now: () => 0 });
    const id = w.addDoc(lines.join('\n'));
    expect(await w.panes.open(id)).toEqual({ ok: true });
    await w.mountAll();
    w.panes.flush();

    const state = get(w.panes.state);
    expect(state.panes).toHaveLength(2);
    expect(state.marks.matched).toBe(BLOCKS * 2);
    const pane2 = w.editorOf('g2').getModel() as unknown as ITextModel;
    const doc = w.model(id);
    expect(pane2.getLineCount() + (w.editorOf('g1').getModel() as unknown as ITextModel).getLineCount()).toBe(doc.getLineCount() + 3);

    // Near the middle of pane 2, a few moves into a section.
    let line = 3 + 150 * SECTION + 10;
    const lineBefore = pane2.getLineContent(line);
    const docLineOf = (paneLine: number): number => w.editorOf('g2') && (w.editor.groupViews().find((v) => v.id === 'g2')?.pane?.docLine(paneLine) ?? -1);
    expect(doc.getLineContent(docLineOf(line))).toBe(lineBefore);

    // The motion colours of both panes, on the real modal service with a manual idle queue (the
    // setup of the split-view proof). The colours' frame is a keystroke's work, so it is timed with it.
    const profile = profileOf('fanuc-lathe');
    const applied = applyMachine(profile, noMachine(profile));
    const cp = compileProfile(applied.profile);
    const db = loadCodeDb(CODE_DBS[applied.codes]);
    const idleQueue: (() => void)[] = [];
    const modal = createModalService({
      docs: w.docs,
      editor: w.editor,
      effective: () => ({ cp, db, key: 'k' }),
      idle: (fn) => {
        idleQueue.push(fn);
        return () => void idleQueue.splice(idleQueue.indexOf(fn), 1);
      },
      schedule: () => () => {},
    });
    modal.start();
    let colourFrame: (() => void) | null = null;
    let paintedFrames = 0;
    const colours = createMotionColors({
      editor: {
        getLines: (docId, from, to) => w.editor.getLines(docId, from, to),
        getLineCount: (docId) => w.editor.getLineCount(docId),
        onDidAttach: (cb) => w.editor.onDidAttach(cb),
        onDidActivate: (cb) => w.editor.onDidActivate(cb),
        onDidChangeContent: (cb) => w.editor.onDidChangeContent(cb),
        model: (docId) => w.editor.model(docId),
        groupViews: () => w.editor.groupViews(),
        groups: w.editor.groups,
      },
      docs: w.docs,
      modal,
      effective: () => ({ cp, db }),
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
    const ed1 = w.editorOf('g1');
    const ed2 = w.editorOf('g2');
    // Each pane looks at lines of its own channel: the first at the top, the second at the lines being typed in.
    ed1.visible = { first: 1, last: 51 };
    ed2.visible = { first: line - 25, last: line + 25 };
    const motionSets = (ed: typeof ed1): number =>
      ed.collectionSets.filter((set) => set.some((d) => String((d.options as { linesDecorationsClassName?: string }).linesDecorationsClassName).includes('gedit-motion'))).length;
    const runColours = (): void => {
      const frame = colourFrame;
      colourFrame = null;
      frame?.();
    };
    // Build the whole index once, as an idle app would, then type.
    while (idleQueue.length > 0) idleQueue.shift()!();
    runColours();
    expect(motionSets(ed1), 'motion colours painted in the first pane').toBeGreaterThan(0);
    expect(motionSets(ed2), 'motion colours painted in the second pane').toBeGreaterThan(0);
    const g1Before = motionSets(ed1);
    const g2Before = motionSets(ed2);
    const paintedBefore = paintedFrames;

    const rounds: { p95: number; max: number; slice: number; sliceFrame: number }[] = [];
    let typed = 0;
    for (let round = 0; round < ROUNDS; round++) {
      const frames: number[] = [];
      const slices: number[] = [];
      const sliceFrames: number[] = [];
      for (let i = 0; i < KEYSTROKES; i++) {
        const started = performance.now();
        if (i % 16 === 7) {
          // Enter at the end of the line: a new line below, the cursor on it.
          w.type(pane2, line, pane2.getLineMaxColumn(line), '\nG1 X1. Z-1.');
          line++;
        } else {
          w.type(pane2, line, pane2.getLineMaxColumn(line), String.fromCharCode(97 + (i % 26)));
        }
        w.panes.flush();
        runColours();
        frames.push(performance.now() - started);
        typed++;

        // One slice of the index rebuild between two keystrokes, and the colours it lets be painted.
        const slice = idleQueue.shift();
        if (slice !== undefined) {
          const sliceStarted = performance.now();
          slice();
          slices.push(performance.now() - sliceStarted);
          const framesStarted = performance.now();
          runColours();
          sliceFrames.push(performance.now() - framesStarted);
        }
      }
      rounds.push({ p95: p95(frames), max: Math.max(...frames), slice: Math.max(...slices, 0), sliceFrame: Math.max(...sliceFrames, 0) });
    }
    const best = (measure: (r: (typeof rounds)[number]) => number): number => Math.min(...rounds.map(measure));

    // The Phase 1 typing budget is keypress-to-render p95 < 50 ms; no single frame may take more than 30 ms.
    expectWithin(best((r) => r.p95), 50, `keystrokes in pane 2, p95 of ${KEYSTROKES}, best of ${ROUNDS} rounds`);
    expectWithin(best((r) => r.max), 30, `the slowest keystroke in pane 2, best of ${ROUNDS} rounds`);
    // The idle slice is a task of its own, and so is the colours' frame after it (the split-view proof's bounds).
    expectWithin(best((r) => r.slice), 30, `the slowest idle slice, best of ${ROUNDS} rounds`);
    expectWithin(best((r) => r.sliceFrame), 30, `the slowest colours frame after a slice, two panes, best of ${ROUNDS} rounds`);

    // What is on screen is the program's: the line typed in pane 2 is the document's, the other pane
    // is as the program says, and the waits still meet.
    expect(typed).toBe(ROUNDS * KEYSTROKES);
    expect(doc.getLineContent(docLineOf(line))).toBe(pane2.getLineContent(line));
    const g1 = w.editorOf('g1').getModel() as unknown as ITextModel;
    expect(g1.getLineCount() + pane2.getLineCount()).toBe(doc.getLineCount() + 3);
    expect(get(w.panes.state).marks).toEqual({ matched: BLOCKS * 2, unmatched: 0, none: 0 });
    expect(get(w.panes.state).open).toBe(true);

    // The motion colours kept up: one update per frame at most, in both panes, and once the index has
    // caught up with the last keystroke both panes show their marks again.
    expect(paintedFrames - paintedBefore, 'colour updates').toBeLessThanOrEqual(ROUNDS * (KEYSTROKES * 2 + 2));
    while (idleQueue.length > 0) idleQueue.shift()!();
    runColours();
    expect(motionSets(ed2), 'the second pane was repainted while typing').toBeGreaterThan(g2Before);
    const lastMarks = (ed: typeof ed1): string[] =>
      (ed.collectionSets.filter((set) => set.some((d) => String((d.options as { linesDecorationsClassName?: string }).linesDecorationsClassName).includes('gedit-motion'))).at(-1) ?? []).map(
        (d) => String((d.options as { linesDecorationsClassName?: string }).linesDecorationsClassName),
      );
    expect(lastMarks(ed1).length, 'motion marks in the first pane').toBeGreaterThan(0);
    expect(lastMarks(ed2).length, 'motion marks in the second pane').toBeGreaterThan(0);
    expect(motionSets(ed1)).toBeGreaterThanOrEqual(g1Before);
  }, 240_000);
});
