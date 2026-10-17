// The cost of the channel panes' pure logic on a 300,000-line two-channel program (wall-clock
// budgets; the rules are in `panes.test.ts`). The typing budget of the panes in the editor, with
// the models and the view zones, is `monaco/channelPanes.typing.slow.test.ts` (P4.22b); this is
// the share of it that lives in `core/channels/panes.ts`: projecting, mapping a keystroke,
// re-projecting both panes and aligning the marks.

import { describe, expect, it } from 'vitest';
import { expectWithin, fastest } from '../../../../tests/unit/helpers/budget';
import { TOY_CHANNELS, applyEdits, toySet, wait } from './paneFixtures';
import {
  alignPanes,
  changeHull,
  docLineOf,
  mapPaneEdits,
  paneLineOf,
  projectChannel,
  projectedLines,
  reprojectEdits,
  type TextEdit,
} from './panes';
import type { SyncRule } from './types';

const LINES = 300_000;
const SECTION = 60;

/** `$1`/`$2` sections of 60 lines each, a header of two lines. */
function bigProgram(): string[] {
  const doc = ['%', 'O1000'];
  for (let s = 0; doc.length < LINES; s++) {
    doc.push(s % 2 === 0 ? '$1' : '$2');
    for (let i = 0; i < SECTION - 1 && doc.length < LINES; i++) doc.push(`N${doc.length} G01 X${i}.5 Z-${i}.25 F0.2`);
  }
  return doc;
}

const at = (l1: number, c1: number, l2: number, c2: number, text: string): TextEdit => ({
  range: { startLineNumber: l1, startColumn: c1, endLineNumber: l2, endColumn: c2 },
  text,
});

describe('the channel panes on 300,000 lines', () => {
  const doc = bigProgram();
  const set = toySet(doc);
  const read = (lines: readonly string[]) => (from: number, to: number) => lines.slice(from - 1, to);
  const p1 = projectChannel(set, '1')!;
  const p2 = projectChannel(set, '2')!;

  it('projects both channels and maps lines within the budget', () => {
    expect(p1.lineCount + p2.lineCount).toBe(LINES + 2);
    const project = fastest(3, () => {
      projectChannel(set, '1');
      projectChannel(set, '2');
    });
    expectWithin(project, 20, 'projecting two channels of 5,000 sections');
    const map = fastest(3, () => {
      let sum = 0;
      for (let n = 1; n <= p2.lineCount; n += 50) sum += paneLineOf(p2, docLineOf(p2, n)) ?? 0;
      expect(sum).toBeGreaterThan(0);
    });
    expectWithin(map, 50, '3,000 round trips of the line mapping');
  });

  it('maps and re-projects a keystroke in the middle of pane 2 within the budget (G7-style: a few ms)', () => {
    const middle = Math.floor(p2.lineCount / 2) + 7;
    const docLine = docLineOf(p2, middle);
    const col = doc[docLine - 1].length + 1;
    const typed = at(middle, col, middle, col, 'x');
    const paneText = projectedLines(p2, read(doc));
    let mapped: TextEdit[] = [];
    const mapMs = fastest(5, () => {
      mapped = mapPaneEdits(p2, [typed], () => col);
    });
    expect(mapped).toEqual([at(docLine, col, docLine, col, 'x')]);
    expectWithin(mapMs, 1, 'mapping one keystroke');

    const next = applyEdits(doc, mapped);
    const nextSet = toySet(next);
    // Pane 1 hears of the same change: nothing to do, and quickly.
    const after1 = projectChannel(nextSet, '1')!;
    const oldPane1 = projectedLines(p1, read(doc));
    const hinted1 = fastest(5, () => {
      expect(reprojectEdits(p1, after1, { oldPaneLines: read(oldPane1), docLines: read(next), changed: changeHull(mapped) })).toEqual([]);
    });
    expectWithin(hinted1, 10, 're-projecting the other pane with the change as a hint');
    const plain1 = fastest(3, () => {
      expect(reprojectEdits(p1, after1, { oldPaneLines: read(oldPane1), docLines: read(next) })).toEqual([]);
    });
    expect(plain1).toBeLessThan(500);
    expectWithin(plain1, 150, 're-projecting the other pane by scanning, no hint');

    // Pane 2 has not got the character yet (the source pane normally has it already): one edit.
    const after2 = projectChannel(nextSet, '2')!;
    let own: TextEdit[] = [];
    const ownMs = fastest(5, () => {
      own = reprojectEdits(p2, after2, { oldPaneLines: read(paneText), docLines: read(next), changed: changeHull(mapped) });
    });
    expect(own).toHaveLength(1);
    expectWithin(ownMs, 10, 're-projecting the pane that was not the source, with a hint');
  });

  it('re-projects the panes after a section start near the top is deleted (a section changes pane)', () => {
    const edit = at(3 + SECTION, 1, 4 + SECTION, 1, ''); // the `$2` line of the second section
    const next = applyEdits(doc, [edit]);
    const nextSet = toySet(next);
    const after1 = projectChannel(nextSet, '1')!;
    const oldPane1 = projectedLines(p1, read(doc));
    let edits: TextEdit[] = [];
    const ms = fastest(2, () => {
      edits = reprojectEdits(p1, after1, { oldPaneLines: read(oldPane1), docLines: read(next), changed: changeHull([edit]) });
    });
    expect(applyEdits(oldPane1, edits)).toEqual(projectedLines(after1, read(next)));
    expectWithin(ms, 500, 're-projecting a pane after a section start moved a part of the program');
  });

  it('aligns the most marks a document keeps (20,000, 10,000 in each of two panes) within the budget', () => {
    const rules: SyncRule[] = [{ id: 'w', label: 'Waits', match: { kind: 'codes', codes: 'M900-M999' }, partners: { kind: 'word', address: 'P', decode: 'digits' } }];
    const marks = (channel: string, step: number) => Array.from({ length: 10_000 }, (_, i) => wait(channel, 1 + i * step, `M9${String(i % 90).padStart(2, '0')}`, '12'));
    const [c1, c2] = TOY_CHANNELS;
    const panes = [
      { channel: c1, lineCount: p1.lineCount, marks: marks('1', 7) },
      { channel: c2, lineCount: p2.lineCount, marks: marks('2', 6) },
    ];
    let matched = 0;
    const ms = fastest(2, () => {
      const a = alignPanes(panes, rules);
      matched = a.groups.length;
    });
    expect(matched).toBe(10_000);
    expectWithin(ms, 200, 'aligning 20,000 marks of two panes');
  });
});
