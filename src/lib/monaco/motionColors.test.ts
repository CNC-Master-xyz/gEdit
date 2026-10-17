// The motion marks in the editor (Phase 3 plan AD-34, §6.6; P3.7) with a fake editor, a fake
// modal service, a manual animation frame and manual timers: only the visible range plus the
// margin, at most `maxMarks`, nothing for a state that is not known, the setting off removing
// every mark, one update per frame, no work on the keystroke path, and the CSS variables on a
// theme change. The update budget at 300k lines is in `motionColors.slow.test.ts`.

import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { MOTION_BUDGETS, MOTION_COLORS, MOTION_KINDS } from '$lib/core/nc/motion';
import { KLARTEXT, MILL, fakeIndex, harness, marked, millProgram, started } from '../../../tests/unit/helpers/motionHarness';
import {
  LOOKBACK_LINES,
  MAX_LINES,
  motionVariable,
  VIEW_CHECK_DELAY_MS,
} from './motionColors';
import type { MotionPane } from './motionColors';
import type { ModalState } from '$lib/core/nc/types';
import type { ContentChange } from '$lib/app/types';

describe('the marks in the editor', () => {
  it('marks only the visible lines plus the margin, with the class of the kind', () => {
    const program = millProgram(1000);
    const h = harness(program, { visible: { first: 400, last: 420 } });
    const { colors } = started(h);
    colors.flush();
    const marks = marked(h);
    const lines = [...marks.keys()];
    expect(Math.min(...lines)).toBeGreaterThanOrEqual(400 - MOTION_BUDGETS.marginLines);
    expect(Math.max(...lines)).toBeLessThanOrEqual(420 + MOTION_BUDGETS.marginLines);
    expect(lines.some((n) => n >= 400 && n <= 420)).toBe(true);
    expect(lines.length).toBeGreaterThan(50);
    // Line 401 of the pattern is `G1 Z-…` (index 400 % 5 = 0 → a rapid); the class is mark + kind.
    expect(program[400]).toMatch(/^G0 /);
    expect(marks.get(401)).toBe('gedit-motion-mark gedit-motion-rapid');
    expect(program[401]).toMatch(/^G1 /);
    expect(marks.get(402)).toBe('gedit-motion-mark gedit-motion-linear');
    expect(marks.get(403)).toBe('gedit-motion-mark gedit-motion-linear'); // `X…` under G1
    expect(marks.get(404)).toBe('gedit-motion-mark gedit-motion-arc');
    expect(marks.has(405)).toBe(false); // M8 and a comment
    // One decoration per line, an empty range at column 1.
    const last = h.sets[h.sets.length - 1];
    expect(last.every((d) => d.range.startColumn === 1 && d.range.endColumn === 1 && d.range.startLineNumber === d.range.endLineNumber)).toBe(true);
    // One `statesAfter` call: from the line above the first marked line to the last.
    expect(h.statesCalls).toEqual([{ first: 400 - MOTION_BUDGETS.marginLines - 1, last: 420 + MOTION_BUDGETS.marginLines }]);
  });

  it('keeps the first line of the document in range and clamps the end at the last line', () => {
    const h = harness(millProgram(30), { visible: { first: 1, last: 20 } });
    const { colors } = started(h);
    colors.flush();
    expect(h.statesCalls).toEqual([{ first: 0, last: 30 }]);
    expect(marked(h).get(1)).toBe('gedit-motion-mark gedit-motion-rapid');
    expect(Math.max(...marked(h).keys())).toBeLessThanOrEqual(30);
  });

  it('never makes more than maxMarks marks, even for a very tall editor', () => {
    const h = harness(millProgram(5000), { visible: { first: 1000, last: 4000 } });
    const { colors } = started(h);
    colors.flush();
    const last = h.sets[h.sets.length - 1];
    expect(last.length).toBeLessThanOrEqual(MOTION_BUDGETS.maxMarks);
    const call = h.statesCalls[0];
    expect(call.last - call.first + 1).toBeLessThanOrEqual(1000); // the limit of one `statesAfter` call
    expect(MAX_LINES).toBeLessThanOrEqual(MOTION_BUDGETS.maxMarks);
    // The visible lines come first.
    expect(Math.min(...last.map((d) => d.range.startLineNumber))).toBeGreaterThanOrEqual(1000 - MOTION_BUDGETS.marginLines);
  });

  it('marks nothing for a state that is not known, and marks when the index reaches it', () => {
    const h = harness(millProgram(600));
    const { colors } = started(h);
    h.setStatesNull(true);
    colors.flush();
    expect(h.sets.length).toBe(0);
    expect(h.clears.count).toBeGreaterThan(0);
    h.setStatesNull(false);
    h.reach(); // the service: the index reached the lines
    expect(h.frames.length).toBe(1);
    h.runFrames();
    expect(marked(h).size).toBeGreaterThan(0);
  });

  it('paints a line with an assumed motion mode in no colour', () => {
    // The first moves of a program, before any motion code: nothing is in force.
    const program = ['G90', 'X10. Y10.', 'Z5.', 'G1 X20. F100.', 'X30.'];
    const h = harness(program, { visible: { first: 1, last: 5 } });
    const { colors } = started(h);
    colors.flush();
    expect([...marked(h).keys()]).toEqual([4, 5]);
  });

  it('removes every mark when the setting goes off and brings them back when it goes on', () => {
    const h = harness(millProgram(600));
    const { colors } = started(h);
    colors.flush();
    expect(marked(h).size).toBeGreaterThan(0);
    const clearsBefore = h.clears.count;
    h.enabled.set(false);
    h.runFrames();
    expect(h.clears.count).toBeGreaterThan(clearsBefore);
    const callsOff = h.statesCalls.length;
    h.scrollTo(300, 320);
    h.runFrames();
    expect(h.statesCalls.length, 'no work while it is off').toBe(callsOff);
    const setsBefore = h.sets.length;
    h.enabled.set(true);
    h.runFrames();
    expect(h.sets.length).toBe(setsBefore + 1);
    expect(marked(h).size).toBeGreaterThan(0);
  });

  it('marks nothing in a document that is no NC program, or whose model is not the editor\'s', () => {
    const h = harness(millProgram(600));
    h.nc.current = false;
    const { colors } = started(h);
    colors.flush();
    expect(h.sets.length).toBe(0);
    h.nc.current = true;
    h.deps.editor.model = () => ({}); // another model than the editor shows
    colors.flush();
    expect(h.sets.length).toBe(0);
  });

  it('CODE-2: the slices of other documents, or that reach nothing this editor waits for, repaint nothing', () => {
    const h = harness(millProgram(600));
    const { colors } = started(h);
    colors.flush();
    const sets = h.sets.length;
    const calls = h.statesCalls.length;
    for (let i = 0; i < 50; i++) h.changed.update((n) => n + 1);
    expect(h.frames.length).toBe(0);
    h.runFrames();
    expect(h.statesCalls.length).toBe(calls);
    expect(h.sets.length).toBe(sets);
  });

  it('CODE-2: a repaint that would set the marks that are already there sets nothing, but one after an edit does', () => {
    const h = harness(millProgram(600));
    const { colors } = started(h);
    colors.flush();
    const sets = h.sets.length;
    const calls = h.statesCalls.length;
    h.reach(); // the index moved, and the marks come out the same
    h.runFrames();
    expect(h.statesCalls.length).toBe(calls + 1);
    expect(h.sets.length).toBe(sets);
    // An edit lets the editor move its decorations, so the same list is set again.
    h.edit();
    h.runFrames();
    expect(h.sets.length).toBe(sets + 1);
  });

  it('updates once per frame however many things changed', () => {
    const h = harness(millProgram(600));
    const { colors } = started(h);
    colors.flush();
    const calls = h.statesCalls.length;
    h.changed.update((n) => n + 1);
    h.changed.update((n) => n + 1);
    h.edit();
    h.edit();
    h.scrollTo(380, 400);
    expect(h.frames.length).toBe(1);
    expect(h.statesCalls.length, 'nothing ran yet').toBe(calls);
    h.runFrames();
    expect(h.statesCalls.length).toBe(calls + 1);
  });

  it('does no work on the keystroke path beyond scheduling', () => {
    const h = harness(millProgram(600));
    const { colors } = started(h);
    colors.flush();
    const calls = h.statesCalls.length;
    const effective = h.effectiveCalls.count;
    const lineReads = { count: 0 };
    const getLines = h.deps.editor.getLines;
    h.deps.editor.getLines = (id, a, b) => {
      lineReads.count++;
      return getLines(id, a, b);
    };
    for (let i = 0; i < 200; i++) h.edit();
    expect(h.statesCalls.length).toBe(calls);
    expect(h.effectiveCalls.count).toBe(effective);
    expect(lineReads.count).toBe(0);
    expect(h.frames.length).toBe(1);
    expect(h.timers.length).toBe(1); // the view check, one timer however many keys
  });

  it('asks for the effective view once, and again after a pause in typing, a machine change or a dialect switch', () => {
    const h = harness(millProgram(600));
    const { colors } = started(h);
    colors.flush();
    expect(h.effectiveCalls.count).toBe(1);
    for (let i = 0; i < 20; i++) {
      h.edit();
      h.runFrames();
    }
    expect(h.effectiveCalls.count, 'typing does not ask').toBe(1);
    expect(h.timers[0].ms).toBe(VIEW_CHECK_DELAY_MS);
    h.fireTimers();
    h.runFrames();
    expect(h.effectiveCalls.count).toBe(2);
    h.machineRevision.update((n) => n + 1);
    h.runFrames();
    expect(h.effectiveCalls.count).toBe(3);
    h.profileIdOf.current = 'heidenhain-klartext';
    h.view.current = KLARTEXT;
    h.docsList.update((list) => [...list]);
    h.runFrames();
    expect(h.effectiveCalls.count).toBe(4);
  });

  it('recolours from the new state after a dialect switch', () => {
    const h = harness(['4 L X+1 FMAX', '5 L X+2 F100', '6 C X+3 Y+3 DR+', 'G1 X1.'], { visible: { first: 1, last: 4 } });
    const { colors } = started(h);
    colors.flush();
    expect([...marked(h).values()].map((c) => c.split(' ')[1])).toEqual(['gedit-motion-linear']); // read as a mill: only `G1 X1.` is known
    h.profileIdOf.current = 'heidenhain-klartext';
    h.view.current = KLARTEXT;
    h.docsList.update((list) => [...list]);
    h.runFrames();
    expect([...marked(h).values()].map((c) => c.split(' ')[1])).toEqual(['gedit-motion-rapid', 'gedit-motion-linear', 'gedit-motion-arc']);
  });

  it('needs no update for a short scroll and recentres before the marks run out', () => {
    const h = harness(millProgram(2000), { visible: { first: 800, last: 840 } });
    const { colors } = started(h);
    colors.flush();
    const calls = h.statesCalls.length;
    h.scrollTo(810, 850); // well inside the margin
    h.runFrames();
    expect(h.statesCalls.length).toBe(calls);
    h.scrollTo(870, 910); // 20 lines from the end of the marks
    h.runFrames();
    expect(h.statesCalls.length).toBe(calls + 1);
    expect(h.statesCalls[calls].last).toBe(910 + MOTION_BUDGETS.marginLines);
    h.scrollTo(1500, 1540); // a jump
    h.runFrames();
    expect(h.statesCalls.length).toBe(calls + 2);
    expect(Math.min(...marked(h).keys())).toBeGreaterThanOrEqual(1500 - MOTION_BUDGETS.marginLines);
  });

  it('reads a few lines above the first mark, so the tokenizer\'s line state is the index\'s', () => {
    // A tail line of a continued block is tokenized differently from a head (a leading number
    // is a block number only at the head); the lines above the range tell which one it is.
    const h = harness(millProgram(1000), { visible: { first: 400, last: 420 } });
    const reads: [number, number][] = [];
    const getLines = h.deps.editor.getLines;
    h.deps.editor.getLines = (id, a, b) => {
      reads.push([a, b]);
      return getLines(id, a, b);
    };
    const { colors } = started(h);
    colors.flush();
    expect(LOOKBACK_LINES).toBeGreaterThan(0);
    expect(reads).toEqual([[400 - MOTION_BUDGETS.marginLines - LOOKBACK_LINES, 420 + MOTION_BUDGETS.marginLines]]);
    // At the top of the document there is nothing above to read.
    const top = harness(millProgram(100), { visible: { first: 1, last: 20 } });
    const topReads: [number, number][] = [];
    const topGet = top.deps.editor.getLines;
    top.deps.editor.getLines = (id, a, b) => {
      topReads.push([a, b]);
      return topGet(id, a, b);
    };
    started(top).colors.flush();
    expect(topReads).toEqual([[1, 100]]);
  });

  it('hooks a new editor instance and lets go of the old one', () => {
    const h = harness(millProgram(600));
    const { colors } = started(h);
    colors.flush();
    const first = h.instances[0];
    expect(first.hookCount()).toBe(3);
    const next = h.swapEditor();
    h.runFrames();
    expect(first.hookCount()).toBe(0);
    expect(next.hookCount()).toBe(3);
    expect(next.collectionSets.length).toBe(1);
  });

  it('removes the marks and every listener when it stops', () => {
    const h = harness(millProgram(600));
    const { colors, stop } = started(h);
    colors.flush();
    const clears = h.clears.count;
    stop();
    expect(h.clears.count).toBeGreaterThan(clears);
    expect(h.hooks.content.size + h.hooks.activate.size + h.hooks.attach.size + h.hooks.scroll.size).toBe(0);
    h.changed.update((n) => n + 1);
    h.edit();
    expect(h.frames.length).toBe(0);
  });

  it('ignores an edit in a document that is not the one on screen', () => {
    const h = harness(millProgram(600));
    const { colors } = started(h);
    colors.flush();
    for (const cb of [...h.hooks.content]) cb('other', { startLine: 1, endLine: 1 } as unknown as ContentChange);
    expect(h.frames.length).toBe(0);
  });
});

describe('the colours', () => {
  it('sets the custom properties of the theme in force and again when it changes', () => {
    const h = harness(millProgram(100));
    started(h);
    for (const kind of MOTION_KINDS) expect(h.props.get(motionVariable(kind))).toBe(MOTION_COLORS.dark[kind]);
    expect(motionVariable('arc')).toBe('--gedit-motion-arc');
    h.theme.set('light');
    for (const kind of MOTION_KINDS) expect(h.props.get(motionVariable(kind))).toBe(MOTION_COLORS.light[kind]);
    expect(get(h.theme)).toBe('light');
  });
});

describe('a state that is typed as the index gives it', () => {
  it('reads before and after from consecutive states', () => {
    // A sanity check of the harness: statesAfter(first - 1, last) has one more state than lines.
    const program = millProgram(50);
    const states: ModalState[] | null = fakeIndex(program, MILL).statesAfter(9, 20);
    expect(states?.length).toBe(12);
  });
});

/** A channel pane over the document: `docLines[i]` is the document line of pane line `i + 1`. */
function paneOf(docLines: number[]): MotionPane & { lines: number } {
  const model = { getLineCount: () => docLines.length };
  return { lines: docLines.length, docLine: (n) => docLines[n - 1], model: () => model };
}

describe('one collection per group editor (P4e, Phase 4 plan §6.7 rule 6)', () => {
  it('paints both editors of split view from their own visible range', () => {
    const h = harness(millProgram(1000), { visible: { first: 100, last: 120 } });
    const { colors } = started(h);
    colors.flush();
    const second = h.addGroup({ visible: { first: 700, last: 720 } });
    h.runFrames();

    const first = h.instances[0].collectionSets.at(-1) ?? [];
    const other = second.sets.at(-1) ?? [];
    expect(first.length).toBeGreaterThan(0);
    expect(other.length).toBeGreaterThan(0);
    expect(Math.max(...first.map((d) => d.range.startLineNumber))).toBeLessThanOrEqual(120 + MOTION_BUDGETS.marginLines);
    expect(Math.min(...other.map((d) => d.range.startLineNumber))).toBeGreaterThanOrEqual(700 - MOTION_BUDGETS.marginLines);
    // The first one was not painted again for the second one's sake.
    expect(h.instances[0].collectionSets).toHaveLength(1);
  });

  it('scrolls and edits per editor: an edit repaints both, a scroll of one asks for one frame', () => {
    const h = harness(millProgram(1000), { visible: { first: 100, last: 120 } });
    const { colors } = started(h);
    colors.flush();
    const second = h.addGroup({ visible: { first: 700, last: 720 } });
    h.runFrames();
    const setsFirst = h.instances[0].collectionSets.length;
    const setsSecond = second.sets.length;

    h.edit();
    h.runFrames();

    expect(h.instances[0].collectionSets.length).toBe(setsFirst + 1);
    expect(second.sets.length).toBe(setsSecond + 1);
  });

  it('repaints only the group an edit can reach: one far above it in the document is left alone, and so is the index moving on', () => {
    const h = harness(millProgram(2000), { visible: { first: 1500, last: 1520 } });
    const { colors } = started(h);
    colors.flush();
    const second = h.addGroup({ visible: { first: 100, last: 120 } });
    h.runFrames();
    const setsMain = h.instances[0].collectionSets.length;
    const setsSecond = second.sets.length;
    const calls = h.statesCalls.length;

    // An edit at line 1510: inside the first group's lines, below everything the second group paints.
    h.edit(1510);
    h.reach(); // and the index moves on, as it does after every edit
    h.runFrames();

    expect(h.instances[0].collectionSets.length).toBe(setsMain + 1); // the edited group is set again
    expect(second.sets.length).toBe(setsSecond); // the other one is not
    expect(h.statesCalls.length - calls, 'one read of the states: the edited group').toBe(1);

    // An edit above the second group's lines moves them: it is repainted too.
    h.edit(50);
    h.runFrames();
    expect(second.sets.length).toBe(setsSecond + 1);
    expect(h.instances[0].collectionSets.length).toBe(setsMain + 2);
  });

  it('reads the lines once for two groups at the same place, as a split just made has them', () => {
    const h = harness(millProgram(1000), { visible: { first: 400, last: 420 } });
    const { colors } = started(h);
    colors.flush();
    const calls = h.statesCalls.length;
    const second = h.addGroup({ visible: { first: 400, last: 420 } });
    h.runFrames();
    expect(second.sets.length).toBe(1);
    expect(second.sets[0]).toEqual(h.instances[0].collectionSets[0]);
    expect(h.statesCalls.length - calls, 'the new group is painted from one read').toBe(1);

    // The same lines, edited above: both are painted again from one read, not two.
    h.edit(10);
    h.runFrames();
    expect(h.statesCalls.length - calls).toBe(2);
    expect(second.sets.length).toBe(2);
    expect(h.instances[0].collectionSets.length).toBe(2);
  });

  it('repaints a group whose marks were not complete when the index moves, edit below or not', () => {
    const h = harness(millProgram(600));
    const { colors } = started(h);
    h.setStatesNull(true);
    colors.flush();
    h.setStatesNull(false);
    h.edit(590);
    h.reach();
    h.runFrames();
    expect(marked(h).size).toBeGreaterThan(0);
  });

  it('lets go of the collection and the listeners of an editor that leaves, and keeps the other', () => {
    const h = harness(millProgram(1000), { visible: { first: 100, last: 120 } });
    const { colors } = started(h);
    colors.flush();
    const second = h.addGroup({ visible: { first: 700, last: 720 } });
    h.runFrames();
    expect(second.editor.hookCount()).toBe(3);
    const clears = h.clears.count;
    const callsBefore = h.statesCalls.length;

    h.removeGroup(second.editor);
    h.runFrames();

    expect(second.editor.hookCount()).toBe(0);
    expect(h.instances[0].hookCount()).toBe(3);
    expect(h.statesCalls.length).toBe(callsBefore); // the remaining editor is painted, nothing changed for it
    expect(h.clears.count).toBe(clears);
  });

  it('marks a channel pane at its own lines, with one statesAfter per run of consecutive document lines', () => {
    // The pane shows the header (document lines 1–3), then the channel's lines 20–29 and 40–44.
    const docLines = [1, 2, 3, ...Array.from({ length: 10 }, (_, i) => 20 + i), ...Array.from({ length: 5 }, (_, i) => 40 + i)];
    const program = millProgram(100);
    const h = harness(program, { visible: { first: 1, last: 3 } });
    const { colors } = started(h);
    colors.flush();
    const calls = h.statesCalls.length;
    const pane = h.addGroup({ visible: { first: 1, last: docLines.length }, pane: paneOf(docLines) });
    h.runFrames();

    const marks = new Map((pane.sets.at(-1) ?? []).map((d) => [d.range.startLineNumber, d.options.linesDecorationsClassName]));
    // Three runs of document lines, three reads of the states.
    expect(h.statesCalls.slice(calls)).toEqual([
      { first: 0, last: 3 },
      { first: 19, last: 29 },
      { first: 39, last: 44 },
    ]);
    // Document line 21 is `G1 Z-…` (index 20 % 5 = 0 → a rapid `G0`): pane line 3 + 2 = 5.
    expect(program[20]).toMatch(/^G0 /);
    expect(docLines[4]).toBe(21);
    expect(marks.get(5)).toBe('gedit-motion-mark gedit-motion-rapid');
    // Every mark is at a pane line, none beyond the pane.
    expect(Math.max(...marks.keys())).toBeLessThanOrEqual(docLines.length);
    // A mark at pane line n is the mark of document line docLines[n - 1], exactly as the document itself is marked.
    const whole = harness(program, { visible: { first: 1, last: 100 } });
    started(whole).colors.flush();
    const reference = marked(whole);
    const expected = new Map<number, string>();
    docLines.forEach((docLine, i) => {
      const cls = reference.get(docLine);
      if (cls !== undefined) expected.set(i + 1, cls);
    });
    expect(expected.size).toBeGreaterThan(5);
    expect(marks).toEqual(expected);
  });

  it('keeps a pane within the lines of one update (MAX_LINES)', () => {
    const docLines = Array.from({ length: 4000 }, (_, i) => i * 2 + 1); // every other line: 4,000 runs of one
    const h = harness(millProgram(8001), { visible: { first: 1, last: 1 } });
    const { colors } = started(h);
    colors.flush();
    const calls = h.statesCalls.length;
    h.addGroup({ visible: { first: 1000, last: 3000 }, pane: paneOf(docLines) });
    h.runFrames();
    // One read per run, and no more lines than the budget allows.
    const reads = h.statesCalls.slice(calls);
    expect(reads.length).toBeLessThanOrEqual(MAX_LINES);
    expect(reads.length).toBeGreaterThan(0);
  });
});
