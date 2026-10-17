// The channel view (Phase 4 plan AD-50, AD-51, §6.7 rules 9–15; X29; P4.22b). Run on the real
// editor service, a real channel service resolving real programs, and the editor's own text models
// (`monaco/realModel.ts`: edits, undo and version ids are Monaco's), with fake editors
// (`tests/unit/helpers/channelPanes.ts`): what is asserted is what the view puts into the models
// and asks of the editors, and the history it leaves.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { EDITOR_COLORS } from '$lib/core/grammar/roles';
import { t } from '$lib/i18n';
import { CLOSED_VIEW, WAIT_RULER_COLORS, paneSourceOfModel } from './channelPanes';
import { docIdOf } from './editorService';
import { computeJumpLines } from '$lib/app/outlineService';
import { WAIT_RULE, fileParams, paneWorld, sectionParams, type PaneEditor, type PaneWorld } from '../../../tests/unit/helpers/channelPanes';
import { cpOf, profileOf } from '../../../tests/unit/helpers/profiles';
import type { ChannelParams, SyncRule } from '$lib/core/channels/types';
import type * as MonacoApi from 'monaco-editor/esm/vs/editor/editor.api.js';

type ITextModel = MonacoApi.editor.ITextModel;

/** Two channels in one program; each waits at `M901P12` (the owner's way of writing it). Doc lines 1–12. */
const PROGRAM = ['%', 'O0100', '(PROGRAM)', 'CH1', 'G0 X10', 'M901P12', 'G1 X20', 'CH2', 'G0 X5', 'G4 U1', 'M901P12', 'G1 X6'];

/** Channel 1 has two ranges with channel 2 between them: its pane has a junction after pane line 5. */
const GAPPED = ['%', 'O0100', 'CH1', 'A1', 'A2', 'CH2', 'B1', 'CH1', 'A3', 'CH2', 'B2'];

const paneModel = (w: PaneWorld, group: string): ITextModel => w.editorOf(group).getModel() as unknown as ITextModel;
const linesOf = (model: ITextModel): string[] => model.getValue().split('\n');

/** The view opened on a program with sections: both editors mounted, nothing pending. */
async function sections(lines: string[] = PROGRAM, n = 2): Promise<{ w: PaneWorld; id: string }> {
  const w = await paneWorld(sectionParams(n));
  const id = w.addDoc(lines.join('\n'));
  expect(await w.panes.open(id)).toEqual({ ok: true });
  await w.mountAll();
  w.panes.flush();
  return { w, id };
}

/** Three channel files, `PART_CH1.nc` … `PART_CH3.nc`, all open; the view opened from the first. */
async function files(texts: string[][]): Promise<{ w: PaneWorld; ids: string[] }> {
  const w = await paneWorld(fileParams(texts.length));
  const ids = texts.map((lines, i) => w.addDoc(lines.join('\n'), { path: `/nc/PART_CH${i + 1}.nc`, activate: i === 0 }));
  expect(await w.panes.open(ids[0])).toEqual({ ok: true });
  await w.mountAll();
  w.panes.flush();
  return { w, ids };
}

const zonesOf = (ed: PaneEditor): [number, number][] => [...ed.zones.values()].map((z): [number, number] => [z.afterLineNumber, z.heightInLines]).sort((a, b) => a[0] - b[0]);
const marksOf = (ed: PaneEditor): { line: number; cls: unknown }[] => ed.marks().map((m) => ({ line: m.range.startLineNumber, cls: m.options.linesDecorationsClassName }));

describe('the channel view stub of the P4e prelude is gone', () => {
  it('starts closed', async () => {
    const w = await paneWorld(sectionParams(2));
    expect(get(w.panes.state)).toEqual(CLOSED_VIEW);
    w.panes.close(); // nothing to close
    w.panes.flush();
    expect(get(w.panes.state).open).toBe(false);
  });
});

describe('the channel view (P4.22b)', () => {
  // Rule 9: opening.
  describe('opening a program with channel sections', () => {
    it('opens one pane per channel of a program with sections, in declared channel order, the header on top of each', async () => {
      const { w, id } = await sections();
      expect(w.editor.groupsState()).toMatchObject({
        layout: 'channels',
        groups: [
          { id: 'g1', content: { kind: 'pane', docId: id, channelId: '1' } },
          { id: 'g2', content: { kind: 'pane', docId: id, channelId: '2' } },
        ],
      });
      expect(w.paneText('g1').split('\n')).toEqual(['%', 'O0100', '(PROGRAM)', 'CH1', 'G0 X10', 'M901P12', 'G1 X20']);
      expect(w.paneText('g2').split('\n')).toEqual(['%', 'O0100', '(PROGRAM)', 'CH2', 'G0 X5', 'G4 U1', 'M901P12', 'G1 X6']);
      expect(get(w.panes.state)).toMatchObject({
        open: true,
        layout: 'single-file',
        docId: id,
        panes: [
          { channelId: '1', name: 'Turret A', groupId: 'g1', docId: id },
          { channelId: '2', name: 'Turret B', groupId: 'g2', docId: id },
        ],
        notShown: [],
        outsideLines: 0,
      });
      // The document is untouched, and the panes are models of their own (no hidden areas).
      expect(w.text(id)).toBe(PROGRAM.join('\n'));
      expect(paneModel(w, 'g1')).not.toBe(w.model(id));
      expect(paneSourceOfModel(paneModel(w, 'g2'))?.channelId).toBe('2');
      expect(paneSourceOfModel(w.model(id))).toBeUndefined();
      // The pane models have their own addresses, which no provider reads as a document (folding and the outline stay empty).
      expect([...w.state.models.keys()].filter((uri) => uri.includes('/pane/')).sort()).toEqual([`inmemory://pane/${id}/1`, `inmemory://pane/${id}/2`]);
      expect(docIdOf({ uri: { scheme: 'inmemory', authority: 'pane', path: `/${id}/1` } })).toBeNull();
    });

    it('focuses the pane of the channel at the cursor and puts the pane’s cursor on that line', async () => {
      const w = await paneWorld(sectionParams(2));
      const id = w.addDoc(PROGRAM.join('\n'));
      w.editorOf('g1').setPosition({ lineNumber: 9, column: 2 }); // `G0 X5`, channel 2
      expect(await w.panes.open(id)).toEqual({ ok: true });
      expect(w.editor.groupsState().focused).toBe('g2');
      await w.mountAll();
      // Pane 2 shows the header (3 lines) and then the lines 8 to 12: document line 9 is pane line 5.
      expect(w.editorOf('g2').position.lineNumber).toBe(5);
      expect(w.editor.cursor()?.line).toBe(9);
    });

    it('says in the status bar how many channels it shows', async () => {
      const { w } = await sections();
      expect(w.said.at(-1)).toEqual([t('channelPanes.status.opened', { count: 2 }), false]);
    });
  });

  describe('opening a program with one file per channel', () => {
    const CH1 = ['%', 'O1', 'G0 X1', 'M901P12', 'G1 X2', 'M910P123', 'M30'];
    const CH2 = ['%', 'O2', 'G0 X1', 'G4 U1', 'G4 U2', 'M901P12', 'G1 X3', 'M910P123'];
    const CH3 = ['%', 'O3', 'G0 X1', 'M910P123', 'G1 X4', 'G2 X5'];

    it('opens the open channel documents of a program with one file per channel, in channel order', async () => {
      const { w, ids } = await files([CH1, CH2, CH3]);
      expect(w.editor.groupsState().layout).toBe('channels');
      expect(w.editor.groupsState().groups.map((g) => g.content)).toEqual([
        { kind: 'document', docId: ids[0], channelId: '1' },
        { kind: 'document', docId: ids[1], channelId: '2' },
        { kind: 'document', docId: ids[2], channelId: '3' },
      ]);
      expect(get(w.panes.state)).toMatchObject({ layout: 'multi-file', docId: ids[0], notShown: [], outsideLines: 0 });
      // The panes are the documents themselves.
      expect(w.editorOf('g2').getModel()).toBe(w.model(ids[1]));
    });

    it('shows the channel files that are open and names the ones that are not', async () => {
      const w = await paneWorld(fileParams(3));
      const a = w.addDoc(CH1.join('\n'), { path: '/nc/PART_CH1.nc' });
      const c = w.addDoc(CH3.join('\n'), { path: '/nc/PART_CH3.nc', activate: false });
      expect(await w.panes.open(a)).toEqual({ ok: true });
      expect(get(w.panes.state).panes.map((p) => [p.channelId, p.docId])).toEqual([['1', a], ['3', c]]);
      expect(get(w.panes.state).notShown).toEqual(['2']);
    });

    it('refuses with fewer than two open channel documents, in plain words', async () => {
      const w = await paneWorld(fileParams(3));
      const a = w.addDoc(CH1.join('\n'), { path: '/nc/PART_CH1.nc' });
      const answer = await w.panes.open(a);
      expect(answer).toEqual({ ok: false, reason: { key: 'channelPanes.refusal.needTwoFiles' } });
      expect(t('channelPanes.refusal.needTwoFiles')).toBe('Open at least two channel files to open the channel view.');
      expect(get(w.panes.state).open).toBe(false);
      expect(w.editor.groupsState().layout).toBe('single');
    });
  });

  describe('refusals', () => {
    it('refuses a program without channels, with one channel only, or a resolution that ran out of time, in plain words', async () => {
      const none = await paneWorld(null);
      const a = none.addDoc(PROGRAM.join('\n'));
      expect(await none.panes.open(a)).toEqual({ ok: false, reason: { key: 'channelPanes.refusal.noChannels' } });

      const one = await paneWorld(sectionParams(2));
      const b = one.addDoc(['%', 'O1', 'CH1', 'G0 X1'].join('\n'));
      expect(await one.panes.open(b)).toEqual({ ok: false, reason: { key: 'channelPanes.refusal.onlyOne' } });

      const slow = await paneWorld(sectionParams(2));
      const c = slow.addDoc(PROGRAM.join('\n'));
      const tooSlow = { layout: 'none', self: null, members: [], missing: [], outside: [], marks: [], truncated: true, problems: [{ path: '', message: { key: 'channels.problems.tooSlow' } }] } as const;
      slow.channels.fresh = () => tooSlow as never;
      expect(await slow.panes.open(c)).toEqual({ ok: false, reason: { key: 'channels.problems.tooSlow' } });

      for (const key of ['channelPanes.refusal.noChannels', 'channelPanes.refusal.onlyOne', 'channels.problems.tooSlow']) {
        expect(t(key), key).not.toBe(key);
      }
      for (const world of [none, one, slow]) {
        expect(get(world.panes.state).open).toBe(false);
        expect(world.editor.groupsState().layout).toBe('single');
      }
    });

    it('refuses an unknown document', async () => {
      const w = await paneWorld(sectionParams(2));
      expect(await w.panes.open('nope')).toEqual({ ok: false, reason: { key: 'channelPanes.refusal.noDocument' } });
    });
  });

  describe('a machine with more than four channels', () => {
    it('shows the first four channels of a machine with more and names the others in the bar', async () => {
      const lines = ['%', 'O1', 'CH1', 'a', 'CH2', 'b', 'CH3', 'c', 'CH4', 'd', 'CH5', 'e'];
      const { w } = await sections(lines, 5);
      expect(get(w.panes.state).panes.map((p) => p.channelId)).toEqual(['1', '2', '3', '4']);
      expect(get(w.panes.state).notShown).toEqual(['5']);
      expect(w.editor.groupsState().groups).toHaveLength(4);
    });
  });

  // Rule 10: edits.
  describe('edits in a pane', () => {
    it('applies a pane edit to the document as its mapped edits, and the other panes follow (a shared header line)', async () => {
      const { w, id } = await sections();
      // A word typed at the end of `G0 X5` (pane 2, line 5 = document line 9).
      w.type(paneModel(w, 'g2'), 5, 6, '0');
      w.panes.flush();
      expect(w.text(id).split('\n')[8]).toBe('G0 X50');
      expect(w.text(id).split('\n')).toHaveLength(PROGRAM.length);
      expect(linesOf(paneModel(w, 'g1'))).toEqual(['%', 'O0100', '(PROGRAM)', 'CH1', 'G0 X10', 'M901P12', 'G1 X20']);
      // The header is every pane's: an edit of it shows in the other.
      w.type(paneModel(w, 'g2'), 2, 6, '1');
      w.panes.flush();
      expect(w.text(id).split('\n')[1]).toBe('O01001');
      expect(linesOf(paneModel(w, 'g1'))[1]).toBe('O01001');
      expect(linesOf(paneModel(w, 'g2'))[1]).toBe('O01001');
    });

    it('puts a line typed at the end of a range into that range and moves nothing of the other channel', async () => {
      const { w, id } = await sections();
      w.type(paneModel(w, 'g1'), 7, 8, '\nG1 Z5'); // after `G1 X20`, the last line of channel 1
      w.panes.flush();
      expect(w.text(id).split('\n').slice(5, 10)).toEqual(['M901P12', 'G1 X20', 'G1 Z5', 'CH2', 'G0 X5']);
      expect(linesOf(paneModel(w, 'g1')).slice(-3)).toEqual(['M901P12', 'G1 X20', 'G1 Z5']);
      expect(linesOf(paneModel(w, 'g2'))).toHaveLength(8);
      expect(get(w.panes.state).panes).toHaveLength(2);
    });

    it('corrects the pane an edit across a junction was made in, and never touches the other channel’s lines', async () => {
      const { w, id } = await sections(GAPPED);
      // Pane 1: `%`, `O0100`, `CH1`, `A1`, `A2` | `CH1`, `A3` (document 8 and 9 follow the other channel). Replace from the end of
      // `A2` up to the start of the next `CH1` with `Z`: in the pane that joins the two lines.
      expect(linesOf(paneModel(w, 'g1'))).toEqual(['%', 'O0100', 'CH1', 'A1', 'A2', 'CH1', 'A3']);
      const model = paneModel(w, 'g1');
      (model as unknown as { pushEditOperations(...a: unknown[]): unknown }).pushEditOperations(
        null,
        [{ range: { startLineNumber: 5, startColumn: 3, endLineNumber: 6, endColumn: 1 }, text: 'Z' }],
        () => null,
      );
      expect(linesOf(model)).toEqual(['%', 'O0100', 'CH1', 'A1', 'A2ZCH1', 'A3']);
      w.panes.flush();
      // The document: `A2Z`; the junction stays a line break and channel 2's own lines are as they were.
      expect(w.text(id).split('\n')).toEqual(['%', 'O0100', 'CH1', 'A1', 'A2Z', 'CH2', 'B1', 'CH1', 'A3', 'CH2', 'B2']);
      // Pane 1 shows what the document says. (P4e review NC-2: an edit that also took the `CH` of the
      // `CH1` would hand `A3` to channel 2; it is refused, see below.)
      expect(linesOf(paneModel(w, 'g1'))).toEqual(['%', 'O0100', 'CH1', 'A1', 'A2Z', 'CH1', 'A3']);
      expect(linesOf(paneModel(w, 'g2'))).toEqual(['%', 'O0100', 'CH2', 'B1', 'CH2', 'B2']);
    });

    it('keeps a pane edit out of the document while the pane belongs to a channel that left the program', async () => {
      const { w, id } = await sections();
      w.type(w.model(id), 8, 1, 'X'); // `CH2` becomes `XCH2`: no section start any more
      w.panes.flush();
      const state = get(w.panes.state);
      expect(state.panes[1].name).toBe(t('channelPanes.gone', { name: 'Turret B' }));
      const before = w.text(id);
      w.type(paneModel(w, 'g2'), 1, 1, 'junk');
      w.panes.flush();
      expect(w.text(id)).toBe(before);
    });
  });

  describe('a change of the document', () => {
    it('re-projects the panes after a change of the document (a transform, an undo, a machine switch)', async () => {
      const { w, id } = await sections();
      // A transform: one call with an edit in each channel.
      (w.model(id) as unknown as { pushEditOperations(...a: unknown[]): unknown }).pushEditOperations(
        null,
        [
          { range: { startLineNumber: 5, startColumn: 1, endLineNumber: 5, endColumn: 7 }, text: 'G00 X10' },
          { range: { startLineNumber: 9, startColumn: 1, endLineNumber: 9, endColumn: 6 }, text: 'G00 X5' },
        ],
        () => null,
      );
      expect(linesOf(paneModel(w, 'g1'))[4]).toBe('G00 X10');
      expect(linesOf(paneModel(w, 'g2'))[4]).toBe('G00 X5');
      // An undo of the document (not through the view).
      w.model(id).undo();
      expect(linesOf(paneModel(w, 'g1'))[4]).toBe('G0 X10');
      expect(linesOf(paneModel(w, 'g2'))[4]).toBe('G0 X5');
      // A machine switch: sections now end at the `G4` line; the lines after it belong to no channel.
      w.switchMachine({ ...sectionParams(2), sectionEnd: '^G4 ' });
      w.panes.flush();
      expect(linesOf(paneModel(w, 'g2'))).toEqual(['%', 'O0100', '(PROGRAM)', 'CH2', 'G0 X5', 'G4 U1']);
      expect(get(w.panes.state).outsideLines).toBe(2);
    });

    it('keeps a pane whose channel left the program open, empty and read-only, with a note — and brings it back with an undo', async () => {
      const { w, id } = await sections();
      // Delete the line `CH2`: channel 2 has no section any more.
      (w.model(id) as unknown as { pushEditOperations(...a: unknown[]): unknown }).pushEditOperations(
        null,
        [{ range: { startLineNumber: 8, startColumn: 1, endLineNumber: 9, endColumn: 1 }, text: '' }],
        () => null,
      );
      w.panes.flush();
      expect(get(w.panes.state).open).toBe(true);
      expect(get(w.panes.state).panes[1]).toMatchObject({ channelId: '2', name: 'Turret B (no longer in the program)' });
      expect(paneModel(w, 'g2').getValue()).toBe('');
      expect(w.editorOf('g2').effective().readOnly).toBe(true);
      expect(w.editorOf('g1').effective().readOnly).not.toBe(true);
      expect(linesOf(paneModel(w, 'g1')).slice(3)).toEqual(['CH1', 'G0 X10', 'M901P12', 'G1 X20', 'G0 X5', 'G4 U1', 'M901P12', 'G1 X6']);
      // The undo brings the channel back, and the pane with it.
      w.panes.undo();
      w.panes.flush();
      expect(get(w.panes.state).panes[1].name).toBe('Turret B');
      expect(linesOf(paneModel(w, 'g2'))).toEqual(['%', 'O0100', '(PROGRAM)', 'CH2', 'G0 X5', 'G4 U1', 'M901P12', 'G1 X6']);
      expect(w.editorOf('g2').effective().readOnly).toBe(false);
    });

    it('closes the view, saying why, when the program has no channels any more', async () => {
      const { w, id } = await sections();
      (w.model(id) as unknown as { pushEditOperations(...a: unknown[]): unknown }).pushEditOperations(
        null,
        [{ range: { startLineNumber: 4, startColumn: 1, endLineNumber: 8, endColumn: 1 }, text: '' }, { range: { startLineNumber: 8, startColumn: 1, endLineNumber: 9, endColumn: 1 }, text: '' }],
        () => null,
      );
      w.panes.flush();
      expect(get(w.panes.state).open).toBe(false);
      expect(w.editor.groupsState().layout).toBe('single');
      expect(w.said.at(-1)).toEqual([t('channelPanes.status.closedGone'), true]);
    });

    it('re-projects with the change as a hint: a line break typed in a pane of a large program reads a few lines, not the program', async () => {
      const lines = ['%', 'O0100'];
      for (let block = 0; block < 20; block++) for (const ch of [1, 2]) lines.push(`CH${ch}`, ...Array.from({ length: 99 }, (_, i) => `G1 X${i} Z-${block}.`));
      const { w } = await sections(lines);
      let read = 0;
      const getLines = w.editor.getLines;
      w.editor.getLines = (id, a, b) => {
        read += b - a + 1;
        return getLines(id, a, b);
      };
      const pane2 = paneModel(w, 'g2');
      const middle = Math.floor(pane2.getLineCount() / 2);
      w.type(pane2, middle, pane2.getLineMaxColumn(middle), '\nG1 Z1');
      w.panes.flush();
      expect(read).toBeLessThan(100);
      expect(pane2.getLineCount()).toBe(2 + 20 * 100 + 1);
      expect(linesOf(w.model(get(w.panes.state).docId!))).toHaveLength(2 + 20 * 200 + 1);
    });

    it('closes the view, saying why, when the program can no longer be read for its channels in time', async () => {
      const { w, id } = await sections();
      const tooSlow = { layout: 'none', self: null, members: [], missing: [], outside: [], marks: [], truncated: true, problems: [{ path: '', message: { key: 'channels.problems.tooSlow' } }] };
      w.channels.fresh = () => tooSlow as never;
      w.type(w.model(id), 5, 1, 'X');
      expect(get(w.panes.state).open).toBe(false);
      expect(w.editor.groupsState().layout).toBe('single');
      expect(w.said.at(-1)).toEqual([t('channelPanes.status.closedSlow'), true]);
    });

    it('follows a program whose model was replaced (a restored or new document; a reload from disk keeps the model and is one edit, see below)', async () => {
      const { w, id } = await sections();
      w.editor.createModel(id, PROGRAM.map((l) => (l === 'G1 X20' ? 'G1 X99' : l)).join('\n'), 'fanuc-lathe', 'lf');
      w.panes.flush();
      expect(linesOf(paneModel(w, 'g1'))[6]).toBe('G1 X99');
      expect(w.text(id).split('\n')[6]).toBe('G1 X99');
    });
  });

  // Rule 11: one undo step of the document.
  describe('undo with channel sections', () => {
    it('makes a word typed in a pane one undo step of the document; Ctrl+Z in any pane undoes it and the pane shows it', async () => {
      const { w, id } = await sections();
      const original = w.text(id);
      w.type(paneModel(w, 'g2'), 5, 6, 'Z');
      w.type(paneModel(w, 'g2'), 5, 7, 'Y'); // the next character of the same word: no boundary between
      expect(w.text(id).split('\n')[8]).toBe('G0 X5ZY');
      w.editor.focusGroup('g1'); // the focus is on the other pane when Ctrl+Z comes
      w.panes.undo();
      expect(w.text(id)).toBe(original);
      expect(linesOf(paneModel(w, 'g2'))[4]).toBe('G0 X5');
      // The pane where the change is takes the focus, with its cursor on the first changed line.
      expect(w.editor.groupsState().focused).toBe('g2');
      expect(w.editorOf('g2').position.lineNumber).toBe(5);
      w.panes.redo();
      expect(w.text(id).split('\n')[8]).toBe('G0 X5ZY');
      expect(linesOf(paneModel(w, 'g2'))[4]).toBe('G0 X5ZY');
    });

    it('sets every boundary of a pane model on the document too: a typed word is one step, the next word another', async () => {
      const { w, id } = await sections();
      w.type(paneModel(w, 'g2'), 5, 6, 'Z');
      paneModel(w, 'g2').pushStackElement(); // what Monaco does between two words
      w.type(paneModel(w, 'g2'), 5, 7, 'Y');
      w.panes.undo();
      expect(w.text(id).split('\n')[8]).toBe('G0 X5Z');
      w.panes.undo();
      expect(w.text(id).split('\n')[8]).toBe('G0 X5');
    });

    it('takes the focus moving to another pane as a boundary', async () => {
      const { w, id } = await sections();
      w.type(paneModel(w, 'g1'), 5, 7, 'A');
      w.editor.focusGroup('g2');
      w.type(paneModel(w, 'g2'), 5, 6, 'B');
      w.panes.undo();
      expect(w.text(id).split('\n')[4]).toBe('G0 X10A');
      expect(w.text(id).split('\n')[8]).toBe('G0 X5');
      expect(w.editor.groupsState().focused).toBe('g2');
      w.panes.undo();
      expect(w.text(id).split('\n')[4]).toBe('G0 X10');
      expect(w.editor.groupsState().focused).toBe('g1');
      expect(w.editorOf('g1').position.lineNumber).toBe(5);
      w.panes.redo();
      expect(w.text(id).split('\n')[4]).toBe('G0 X10A');
    });

    it('routes Edit ▸ Undo and Ctrl+Z / Ctrl+Shift+Z of a pane to the view, never to the pane model’s own history', async () => {
      const { w, id } = await sections();
      const original = w.text(id);
      w.type(paneModel(w, 'g2'), 5, 6, 'Z');
      w.editor.focusGroup('g2');
      // Edit ▸ Undo and the palette: the editor service hands the action to the view.
      w.editor.triggerAction('undo');
      expect(w.text(id)).toBe(original);
      expect(w.editorOf('g2').triggered).not.toContain('undo');
      w.editor.triggerAction('redo');
      expect(w.text(id).split('\n')[8]).toBe('G0 X5Z');
      // Monaco's own undo command, the keys and the context menu, end in `model.undo()` of the editor's model.
      paneModel(w, 'g2').undo();
      expect(w.text(id)).toBe(original);
      expect(linesOf(paneModel(w, 'g2'))[4]).toBe('G0 X5');
      paneModel(w, 'g2').redo();
      expect(w.text(id).split('\n')[8]).toBe('G0 X5Z');
    });

    it('undoes the newest edit of the document from any pane, not the last edit made in that pane', async () => {
      const { w, id } = await sections();
      w.editor.focusGroup('g2');
      w.type(paneModel(w, 'g2'), 5, 6, 'Z');
      w.editor.focusGroup('g1');
      w.type(paneModel(w, 'g1'), 5, 7, 'A');
      // Ctrl+Z in pane 2, whose own last edit is the `Z`: the document's newest step is the `A`.
      paneModel(w, 'g2').undo();
      expect(w.text(id).split('\n')[4]).toBe('G0 X10');
      expect(w.text(id).split('\n')[8]).toBe('G0 X5Z');
      expect(linesOf(paneModel(w, 'g1'))[4]).toBe('G0 X10');
    });

    it('leaves the document and the panes as they were when the view closes: the document’s history is whole', async () => {
      const { w, id } = await sections();
      const original = w.text(id);
      w.type(paneModel(w, 'g2'), 5, 6, 'Z');
      const doc = w.model(id);
      w.panes.close();
      expect(Object.prototype.hasOwnProperty.call(doc, 'undo')).toBe(false);
      expect(w.history()).toBeUndefined();
      expect(w.text(id).split('\n')[8]).toBe('G0 X5Z');
      doc.undo();
      expect(w.text(id)).toBe(original);
    });
  });

  // Rule 12: alignment and scrolling.
  describe('alignment and scrolling', () => {
    it('puts the filler zones of alignPanes into the panes and moves them after an edit that changes a line count', async () => {
      const { w } = await sections();
      // Pane 1 waits at its line 6, pane 2 at its line 7: pane 1 gets a line above its wait.
      expect(zonesOf(w.editorOf('g1'))).toEqual([[5, 1]]);
      expect(zonesOf(w.editorOf('g2'))).toEqual([]);
      const node = [...w.editorOf('g1').zones.values()][0].domNode;
      expect(node.attrs).toMatchObject({ 'data-testid': 'channel-align-zone', 'data-group': 'g1', 'data-after-line': '5', 'data-lines': '1' });
      // A line typed in pane 1 above its wait: the waits are level, and the zone is gone.
      w.type(paneModel(w, 'g1'), 5, 8, '\nG1 Z1');
      w.panes.flush();
      expect(zonesOf(w.editorOf('g1'))).toEqual([]);
      // A line in pane 2 above its wait: now pane 1 needs two, and the zone moves to the line above its wait.
      w.type(paneModel(w, 'g2'), 5, 6, '\nG1 Z2');
      w.panes.flush();
      expect(zonesOf(w.editorOf('g1'))).toEqual([[6, 1]]);
      expect(get(w.panes.state).marks).toEqual({ matched: 2, unmatched: 0, none: 0 });
    });

    it('replaces only the zones that differ: a zone that stays keeps its place, and an edit that changes nothing asks Monaco for nothing', async () => {
      const { w } = await sections();
      const ed = w.editorOf('g1');
      const zoneId = [...ed.zones.keys()][0];
      let calls = 0;
      const original = (ed as unknown as { changeViewZones(cb: (a: unknown) => void): void }).changeViewZones;
      (ed as unknown as { changeViewZones(cb: (a: unknown) => void): void }).changeViewZones = (cb) => {
        calls++;
        original(cb);
      };
      // A character typed on a line that is no wait and changes no line count.
      w.type(paneModel(w, 'g2'), 5, 6, '0');
      w.panes.flush();
      expect(calls).toBe(0);
      expect([...ed.zones.keys()]).toEqual([zoneId]);
    });

    it('scrolls every pane to the same position, whichever pane the wheel or the keyboard scrolled', async () => {
      const { w } = await sections();
      const [a, b] = [w.editorOf('g1'), w.editorOf('g2')];
      b.setScrollTop(300);
      expect(a.scrollTop).toBe(300);
      a.setScrollTop(120);
      expect(b.scrollTop).toBe(120);
      expect(a.scrollTop).toBe(120);
      // A pane that appears later starts where the others are.
      const { w: w3 } = await sections(['%', 'O1', 'CH1', 'a', 'CH2', 'b', 'CH3', 'c'], 3);
      w3.editorOf('g1').setScrollTop(40);
      expect(w3.editorOf('g2').scrollTop).toBe(40);
      expect(w3.editorOf('g3').scrollTop).toBe(40);
    });

    it('does not scroll the panes after the view closed', async () => {
      const { w } = await sections();
      const [a, b] = [w.editorOf('g1'), w.editorOf('g2')];
      void b;
      w.panes.close();
      a.setScrollTop(55);
      expect(a.scrollListeners).toHaveLength(0);
    });
  });

  // Rule 13: marks.
  describe('wait marks', () => {
    it('marks matched waits with gedit-wait-matched and unmatched ones with gedit-wait-unmatched, also in the overview ruler', async () => {
      const { w, id } = await sections();
      expect(marksOf(w.editorOf('g1'))).toEqual([{ line: 6, cls: 'gedit-wait-matched' }]);
      expect(marksOf(w.editorOf('g2'))).toEqual([{ line: 7, cls: 'gedit-wait-matched' }]);
      const matched = w.editorOf('g1').marks()[0].options;
      expect(matched).toMatchObject({ isWholeLine: true, overviewRuler: { color: WAIT_RULER_COLORS.matched } });
      expect(matched.hoverMessage).toMatchObject({ value: 'Waits with Turret B, line 11' });
      expect(get(w.panes.state).marks).toEqual({ matched: 2, unmatched: 0, none: 0 });

      // Channel 2 loses its wait: the one in channel 1 has no partner.
      w.model(id).pushEditOperations(null, [{ range: { startLineNumber: 11, startColumn: 1, endLineNumber: 12, endColumn: 1 }, text: '' }], () => null);
      w.panes.flush();
      expect(marksOf(w.editorOf('g1'))).toEqual([{ line: 6, cls: 'gedit-wait-unmatched' }]);
      expect(marksOf(w.editorOf('g2'))).toEqual([]);
      const unmatched = w.editorOf('g1').marks()[0].options;
      expect(unmatched).toMatchObject({ overviewRuler: { color: WAIT_RULER_COLORS.unmatched } });
      expect(unmatched.hoverMessage).toMatchObject({ value: 'Turret B has no matching wait for "M901P12"' });
      expect(get(w.panes.state).marks).toEqual({ matched: 0, unmatched: 1, none: 0 });
    });

    it('holds the colours of the marks at 3:1 against the editor background in both themes, and the ruler’s on both', () => {
      const luminance = (hex: string): number => {
        const n = Number.parseInt(hex.slice(1), 16);
        const channel = (v: number): number => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel((n >> 16) & 0xff) + 0.7152 * channel((n >> 8) & 0xff) + 0.0722 * channel(n & 0xff);
      };
      const contrast = (a: string, b: string): number => {
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
      const css = readFileSync(join(__dirname, 'channelPanes.css'), 'utf8');
      const blockOf = (selector: string): string => css.slice(css.indexOf(selector), css.indexOf('}', css.indexOf(selector)));
      for (const [mode, selector] of [['dark', ':root {'], ['light', ":root[data-theme='light'] {"]] as const) {
        const block = blockOf(selector);
        for (const token of ['matched', 'unmatched']) {
          const found = new RegExp(`--gedit-wait-${token}:\\s*(#[0-9a-fA-F]{6})`).exec(block);
          expect(found, `${mode} ${token}`).not.toBeNull();
          expect(contrast(found![1], EDITOR_COLORS[mode].background), `${mode} ${token}`).toBeGreaterThanOrEqual(3);
        }
        for (const colour of Object.values(WAIT_RULER_COLORS)) expect(contrast(colour, EDITOR_COLORS[mode].background), `${mode} ruler ${colour}`).toBeGreaterThanOrEqual(3);
      }
      expect(css).toContain('.monaco-editor .gedit-wait-matched');
      expect(css).toContain('.monaco-editor .gedit-wait-unmatched');
    });
  });

  // Rule 14: per-pane look.
  describe('the look of a pane', () => {
    it('shows the document’s line numbers in a pane’s gutter, no word wrap, and its own minimap and overview ruler', async () => {
      const { w } = await sections();
      const lineNumbers = w.editorOf('g2').effective().lineNumbers as (n: number) => string;
      // Pane 2: the header 1–3, then the document lines 8–12.
      expect([1, 3, 4, 5, 8].map((n) => lineNumbers(n))).toEqual(['1', '3', '8', '9', '12']);
      expect(w.editorOf('g2').effective().wordWrap).toBe('off');
      // The minimap and the overview ruler are the editor's own options, left to the setting "Show minimap".
      for (const group of ['g1', 'g2']) {
        const own = w.editorOf(group).optionUpdates.flatMap((u) => Object.keys(u));
        expect(own).not.toContain('minimap');
        expect(own).not.toContain('overviewRulerLanes');
      }
      // The wait marks are in each pane's own overview ruler.
      expect(w.editorOf('g1').marks()[0].options.overviewRuler).toBeDefined();
      expect(w.editorOf('g2').marks()[0].options.overviewRuler).toBeDefined();
    });

    it('makes every pane read-only while its document is locked', async () => {
      const { w, id } = await sections();
      w.docs.update(id, { readOnly: true, readOnlyReason: 'attribute' });
      expect(w.editorOf('g1').effective().readOnly).toBe(true);
      expect(w.editorOf('g2').effective().readOnly).toBe(true);
    });

    it('gives the keyboard focus to the pane clicked and drives the status bar, the inspector and the program map from it', async () => {
      const { w, id } = await sections();
      w.editorOf('g2').setPosition({ lineNumber: 5, column: 3 });
      w.editorOf('g2').click();
      expect(w.editor.groupsState().focused).toBe('g2');
      expect(w.docs.getActiveId()).toBe(id);
      // The cursor is the document’s: line 9 of the program.
      expect(w.editor.cursor()).toMatchObject({ line: 9, column: 3 });
      w.editor.focusNextGroup(1);
      expect(w.editor.groupsState().focused).toBe('g1');
      w.editor.focusNextGroup(-1);
      expect(w.editor.groupsState().focused).toBe('g2');
      // The state names the groups, in channel order, for the active border and the headers.
      expect(get(w.panes.state).panes.map((p) => p.groupId)).toEqual(['g1', 'g2']);
    });
  });

  // Rule 15: one undo history with one file per channel.
  describe('one file per channel', () => {
    const CH1 = ['%', 'O1', 'G0 X1', 'M901P12', 'G1 X2', 'M910P123', 'M30'];
    const CH2 = ['%', 'O2', 'G0 X1', 'G4 U1', 'G4 U2', 'M901P12', 'G1 X3', 'M910P123'];
    const CH3 = ['%', 'O3', 'G0 X1', 'M910P123', 'G1 X4', 'G2 X5'];

    it('undoes the newest edit of any channel document through the ViewUndoStack and focuses its pane; after the view closes each document keeps its own history', async () => {
      const { w, ids } = await files([CH1, CH2, CH3]);
      const [d1, d2, d3] = ids;
      const original = [d1, d2, d3].map((d) => w.text(d));
      w.type(w.model(d1), 3, 7, 'A');
      w.editor.focusGroup('g2');
      w.type(w.model(d2), 3, 7, 'B');
      w.editor.focusGroup('g3');
      w.type(w.model(d3), 3, 7, 'C');
      // The newest edit first, wherever it was made.
      w.panes.undo();
      expect(w.text(d3)).toBe(original[2]);
      expect(w.text(d2)).not.toBe(original[1]);
      expect(w.editor.groupsState().focused).toBe('g3');
      w.panes.undo();
      expect(w.text(d2)).toBe(original[1]);
      expect(w.editor.groupsState().focused).toBe('g2');
      expect(w.editorOf('g2').position.lineNumber).toBe(3);
      w.panes.undo();
      expect(w.text(d1)).toBe(original[0]);
      expect(w.editor.groupsState().focused).toBe('g1');
      w.panes.redo();
      expect(w.text(d1).split('\n')[2]).toBe('G0 X1A');
      expect(w.text(d2)).toBe(original[1]);
      // Ctrl+Z in a pane is the same: Monaco ends in the document model's undo.
      w.model(d1).undo();
      expect(w.text(d1)).toBe(original[0]);
      w.model(d1).redo();
      // Edit ▸ Undo, with the focus in a pane: Monaco's undo action ends in the same `model.undo()`.
      w.editor.focusGroup('g1');
      w.editor.triggerAction('undo');
      expect(w.editorOf('g1').triggered).toContain('undo');
      w.model(d1).undo();
      expect(w.text(d1)).toBe(original[0]);

      // Closing the view drops the order; each document keeps its own history and Save stays per file.
      w.panes.redo();
      w.editor.focusGroup('g2');
      w.type(w.model(d2), 3, 7, 'Q');
      const m2 = w.model(d2);
      w.panes.close();
      expect(Object.prototype.hasOwnProperty.call(m2, 'undo')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(m2, 'pushStackElement')).toBe(false);
      m2.undo();
      expect(w.text(d2)).toBe(original[1]);
      expect(w.model(d1).getAlternativeVersionId()).not.toBe(undefined);
    });

    it('says "undo in that file itself" for a document that was changed outside the view', async () => {
      const { w, ids } = await files([CH1, CH2]);
      w.type(w.model(ids[0]), 3, 7, 'A');
      w.editor.focusGroup('g2');
      // The file's model was replaced (a restored or new document, not a reload from disk, which is an edit
      // of the same model): the entries of the old model are dropped.
      w.editor.createModel(ids[0], CH1.join('\n'), 'fanuc-lathe', 'lf');
      w.panes.undo();
      expect(w.text(ids[0])).toBe(CH1.join('\n'));
      expect(get(w.panes.state).open).toBe(true);
    });

    it('lines up M901P12 in channels 1 and 2 and not in channel 3, and M910P123 in all three', async () => {
      const { w } = await files([CH1, CH2, CH3]);
      // Waits: channel 1 M901 at 4, M910 at 6; channel 2 M901 at 6, M910 at 8; channel 3 M910 at 4.
      expect(get(w.panes.state).marks).toEqual({ matched: 5, unmatched: 0, none: 0 });
      expect(marksOf(w.editorOf('g1'))).toEqual([{ line: 4, cls: 'gedit-wait-matched' }, { line: 6, cls: 'gedit-wait-matched' }]);
      expect(marksOf(w.editorOf('g2'))).toEqual([{ line: 6, cls: 'gedit-wait-matched' }, { line: 8, cls: 'gedit-wait-matched' }]);
      // Channel 3 has only the M910: no mark for M901, which does not name it.
      expect(marksOf(w.editorOf('g3'))).toEqual([{ line: 4, cls: 'gedit-wait-matched' }]);
      // M901: channel 1 is pushed from 4 to 6 (two lines after line 3); M910 then meets at 8 everywhere.
      expect(zonesOf(w.editorOf('g1'))).toEqual([[3, 2], [7, 1]]);
      expect(zonesOf(w.editorOf('g2'))).toEqual([[8, 2]]);
      expect(zonesOf(w.editorOf('g3'))).toEqual([[3, 4]]);
      const rows = (name: string): number => w.editorOf(name).getModel()!.getLineCount() + zonesOf(w.editorOf(name)).reduce((n, z) => n + z[1], 0);
      expect([rows('g1'), rows('g2'), rows('g3')]).toEqual([10, 10, 10]);
      // The hover of a wait of three channels names the other two.
      expect(w.editorOf('g3').marks()[0].options.hoverMessage).toMatchObject({ value: 'Waits with Turret A, line 6; Turret B, line 8' });
    });

    it('marks M910P123 unmatched in channels 1 and 2 when the shown channel 3 has none', async () => {
      const { w } = await files([CH1, CH2, CH3.filter((l) => l !== 'M910P123')]);
      expect(get(w.panes.state).marks).toEqual({ matched: 2, unmatched: 2, none: 0 });
      expect(marksOf(w.editorOf('g1')).map((m) => m.cls)).toEqual(['gedit-wait-matched', 'gedit-wait-unmatched']);
      expect(w.editorOf('g1').marks()[1].options.hoverMessage).toMatchObject({ value: 'Turret C has no matching wait for "M910P123"' });
      expect(marksOf(w.editorOf('g3'))).toEqual([]);
    });

    it('lines up again after an edit of a channel file', async () => {
      const { w, ids } = await files([CH1, CH2, CH3]);
      w.type(w.model(ids[2]), 3, 1, 'G0 Z1\n');
      w.panes.flush();
      expect(marksOf(w.editorOf('g3'))).toEqual([{ line: 5, cls: 'gedit-wait-matched' }]);
      expect(zonesOf(w.editorOf('g3'))).toEqual([[4, 3]]);
    });
  });

  // Closing.
  describe('closing', () => {
    it('drops a pane the user closed, names its channel as not shown, and goes back to one editor when one is left', async () => {
      const lines = ['%', 'O1', 'CH1', 'a', 'CH2', 'b', 'CH3', 'c'];
      const { w } = await sections(lines, 3);
      const modelOfG3 = paneModel(w, 'g3');
      w.editor.closeGroup('g3');
      w.panes.flush();
      expect(get(w.panes.state).panes.map((p) => [p.channelId, p.groupId])).toEqual([['1', 'g1'], ['2', 'g2']]);
      expect(get(w.panes.state).notShown).toEqual(['3']);
      expect(paneSourceOfModel(modelOfG3)).toBeUndefined();
      // Closing a middle pane shifts the later groups up; the state follows.
      const { w: w4 } = await sections(lines, 3);
      w4.editor.closeGroup('g2');
      w4.panes.flush();
      expect(get(w4.panes.state).panes.map((p) => [p.channelId, p.groupId])).toEqual([['1', 'g1'], ['3', 'g2']]);
      // The last but one: one editor is left and the view is closed.
      w4.editor.closeGroup('g2');
      w4.panes.flush();
      expect(get(w4.panes.state)).toEqual(CLOSED_VIEW);
      expect(w4.editor.groupsState().layout).toBe('single');
      expect(w4.history()).toBeUndefined();
    });

    it('closes the view with Close Split: one editor, no pane models, no zones, no marks', async () => {
      const { w, id } = await sections();
      const g1 = w.editorOf('g1');
      const paneModels = [paneModel(w, 'g1'), paneModel(w, 'g2')];
      w.panes.close();
      expect(get(w.panes.state)).toEqual(CLOSED_VIEW);
      expect(w.editor.groupsState().layout).toBe('single');
      expect(w.editor.groupsState().groups).toHaveLength(1);
      expect(g1.getModel()).toBe(w.model(id));
      expect(g1.zones.size).toBe(0);
      expect((paneModels[0] as unknown as { isDisposed(): boolean }).isDisposed()).toBe(true);
      expect((paneModels[1] as unknown as { isDisposed(): boolean }).isDisposed()).toBe(true);
      expect(paneSourceOfModel(paneModels[0])).toBeUndefined();
      // The registrations are gone: a pane cannot be shown any more.
      expect(() => w.editor.openGroups({ layout: 'channels', contents: [{ kind: 'pane', docId: id, channelId: '1' }, { kind: 'pane', docId: id, channelId: '2' }] })).toThrow(RangeError);
    });

    it('closes the view when the tab of another document is chosen', async () => {
      const { w } = await sections();
      const other = w.addDoc('G0 X1', { activate: false });
      w.docs.activate(other);
      expect(w.editor.groupsState().layout).toBe('single');
      expect(get(w.panes.state).open).toBe(false);
    });

    it('opens afresh when it is opened again', async () => {
      const { w, id } = await sections();
      const first = paneModel(w, 'g1');
      expect(await w.panes.open(id)).toEqual({ ok: true });
      expect((first as unknown as { isDisposed(): boolean }).isDisposed()).toBe(true);
      expect(get(w.panes.state).panes).toHaveLength(2);
      expect(w.editor.groupsState().layout).toBe('channels');
    });

    it('closes the view when its program is closed', async () => {
      const { w, id } = await sections();
      w.docs.remove(id);
      w.panes.flush();
      expect(get(w.panes.state).open).toBe(false);
    });
  });
});

// P4e fix batch FB2 (CODE-1, CODE-2, CODE-3, CODE-6, CODE-9): the view's plumbing.
describe('closing a pane of three (CODE-1)', () => {
  const tick = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));
  const microtask = { defer: (fn: () => void) => queueMicrotask(fn) };
  const PROG3 = ['%', 'O0100', 'CH1', 'G0 X10', 'M901P123', 'G1 X20', 'CH2', 'G0 X5', 'G4 U1', 'G4 U2', 'G4 U3', 'M901P123', 'G1 X6', 'CH3', 'G0 X7', 'G0 X8', 'G0 X9', 'M901P123', 'G1 X8'];
  const FILES3 = [
    ['%', 'O1', 'G0 X1', 'M910P123', 'M30'],
    ['%', 'O1', 'G0 X2', 'G0 X3', 'G0 X4', 'M910P123', 'M30'],
    ['%', 'O1', 'M910P123', 'M30'],
  ];

  async function threeSections(): Promise<PaneWorld> {
    const w = await paneWorld(sectionParams(3), { viewDeps: microtask });
    expect(await w.panes.open(w.addDoc(PROG3.join('\n')))).toEqual({ ok: true });
    await w.mountAll();
    await tick();
    return w;
  }

  async function threeFiles(): Promise<PaneWorld> {
    const w = await paneWorld(fileParams(3), { viewDeps: microtask });
    const ids = FILES3.map((l, i) => w.addDoc(l.join('\n'), { path: `/nc/PART_CH${i + 1}.nc`, activate: i === 0 }));
    expect(await w.panes.open(ids[0])).toEqual({ ok: true });
    await w.mountAll();
    await tick();
    return w;
  }

  /** Each surviving editor: one scroll listener, its own model's waits marked, filler zones of its own pane only, scrolling shared. */
  function expectHooked(w: PaneWorld, groups: string[]): void {
    for (const g of groups) {
      const ed = w.editorOf(g);
      const waits = linesOf(ed.getModel() as unknown as ITextModel)
        .map((text, i) => (/^M9\d\d/.test(text) ? i + 1 : 0))
        .filter((n) => n > 0);
      expect(ed.scrollListeners, `scroll listeners of ${g}`).toHaveLength(1);
      expect(
        marksOf(ed).map((m) => m.line),
        `marks of ${g}`,
      ).toEqual(waits);
      expect(
        [...ed.zones.values()].every((z) => z.domNode.attrs['data-group'] === g),
        `zones of ${g}`,
      ).toBe(true);
    }
    w.editorOf(groups[0]).setScrollTop(40);
    for (const g of groups) expect(w.editorOf(g).getScrollTop(), `scroll of ${g}`).toBe(40);
    w.editorOf(groups[groups.length - 1]).setScrollTop(10);
    for (const g of groups) expect(w.editorOf(g).getScrollTop(), `scroll of ${g}`).toBe(10);
  }

  for (const [layout, open] of [['sections', threeSections], ['one file per channel', threeFiles]] as const) {
    it(`re-hooks the editors that are left after the first pane closes, with one file per ${layout === 'sections' ? 'program' : 'channel'} (${layout}), without a flush`, async () => {
      const w = await open();
      w.editor.closeGroup('g1');
      await tick();
      await tick();
      expect(get(w.panes.state).panes.map((p) => [p.channelId, p.groupId])).toEqual([['2', 'g1'], ['3', 'g2']]);
      expectHooked(w, ['g1', 'g2']);
    });

    it(`re-hooks the editors that are left after a middle pane closes (${layout}), without a flush`, async () => {
      const w = await open();
      w.editor.closeGroup('g2');
      await tick();
      await tick();
      expect(get(w.panes.state).panes.map((p) => [p.channelId, p.groupId])).toEqual([['1', 'g1'], ['3', 'g2']]);
      expectHooked(w, ['g1', 'g2']);
    });
  }

  it('removes the zones and marks of a pane that was closed from its editor', async () => {
    const w = await paneWorld(sectionParams(3), { viewDeps: microtask });
    // The fake editor's decoration collection does not record a `clear`; this one does.
    const create = w.api.editor.create as unknown as (element: unknown, options: unknown) => PaneEditor;
    (w.api.editor as unknown as { create: unknown }).create = (element: unknown, options: unknown) => {
      const ed = create(element, options);
      const make = ed.createDecorationsCollection.bind(ed);
      ed.createDecorationsCollection = () => {
        const collection = make();
        return { set: collection.set, clear: () => void ed.collectionSets.push([]) };
      };
      return ed;
    };
    expect(await w.panes.open(w.addDoc(PROG3.join('\n')))).toEqual({ ok: true });
    await w.mountAll();
    await tick();
    const g3 = w.editorOf('g3');
    expect(g3.zones.size).toBeGreaterThan(0);
    expect(g3.marks()).toHaveLength(1);
    w.editor.closeGroup('g3');
    await tick();
    expect(g3.zones.size).toBe(0);
    expect(g3.scrollListeners).toHaveLength(0);
    expect(g3.marks()).toEqual([]);
  });
});

describe('the view’s undo history at open (CODE-2)', () => {
  it('one file per channel: a character typed just before the view opened is not undone by the first Undo in the view, and no refusal is said', async () => {
    const w = await paneWorld(fileParams(2));
    const a = w.addDoc(['%', 'O1', 'G0 X1', 'M901P12', 'M30'].join('\n'), { path: '/nc/PART_CH1.nc', activate: true });
    w.addDoc(['%', 'O1', 'G0 X2', 'M901P12', 'M30'].join('\n'), { path: '/nc/PART_CH2.nc', activate: false });
    w.docs.activate(a);
    w.type(w.model(a), 3, 6, '9'); // typed in the file, then the view opens: the same Monaco undo element
    expect(await w.panes.open(a)).toEqual({ ok: true });
    await w.mountAll();
    w.panes.flush();
    w.type(w.model(a), 3, 7, '8');
    w.panes.flush();
    expect(w.model(a).getLineContent(3)).toBe('G0 X198');
    w.panes.undo();
    w.panes.flush();
    expect(w.model(a).getLineContent(3)).toBe('G0 X19'); // the text at open
    expect(w.said.filter(([, error]) => error)).toEqual([]);
    // The view's history starts at open: the next Undo has nothing more and says nothing; the character
    // typed before it is undone in the file itself once the view is closed.
    w.panes.undo();
    expect(w.model(a).getLineContent(3)).toBe('G0 X19');
    expect(w.said.filter(([, error]) => error)).toEqual([]);
    w.panes.close();
    w.model(a).undo();
    expect(w.model(a).getLineContent(3)).toBe('G0 X1');
  });

  it('sections: the first edit in a pane is its own undo step, after a character typed in the program before the view opened', async () => {
    const w = await paneWorld(sectionParams(2));
    const id = w.addDoc(PROGRAM.join('\n'));
    w.type(w.model(id), 6, 7, '9');
    expect(await w.panes.open(id)).toEqual({ ok: true });
    await w.mountAll();
    w.panes.flush();
    const atOpen = w.text(id);
    w.type(paneModel(w, 'g2'), 5, 6, 'Z');
    expect(w.text(id)).not.toBe(atOpen);
    w.panes.undo();
    expect(w.text(id)).toBe(atOpen);
  });

  it('says what the user can do when a file was changed outside the view', () => {
    expect(t('channelPanes.status.undoInFile')).toBe('That file was changed outside the view. Close the channel view to undo in that file.');
  });
});

describe('word wrap in the channel view (CODE-3)', () => {
  it('is off in every pane while the view is open, with one file per channel too, and the user’s setting is back after the view closes', async () => {
    const w = await paneWorld(fileParams(2));
    const a = w.addDoc(['%', 'O1', 'G0 X1', 'M901P12', 'M30'].join('\n'), { path: '/nc/PART_CH1.nc', activate: true });
    w.addDoc(['%', 'O1', 'G0 X2', 'M901P12', 'M30'].join('\n'), { path: '/nc/PART_CH2.nc', activate: false });
    w.docs.activate(a);
    w.editor.updateOptions({ wordWrap: 'on' } as never);
    expect(await w.panes.open(a)).toEqual({ ok: true });
    const eds = await w.mountAll();
    w.panes.flush();
    expect(eds.map((e) => e.effective().wordWrap)).toEqual(['off', 'off']);
    w.editor.updateOptions({ wordWrap: 'on' } as never); // the user switches it on again with the view open
    expect(eds.map((e) => e.effective().wordWrap)).toEqual(['off', 'off']);
    w.panes.close();
    expect(w.editorOf('g1').effective().wordWrap).toBe('on');
  });

  it('is off in the panes of a program with sections and back after the view closes', async () => {
    const w = await paneWorld(sectionParams(2));
    const id = w.addDoc(PROGRAM.join('\n'));
    w.editor.updateOptions({ wordWrap: 'on' } as never);
    expect(await w.panes.open(id)).toEqual({ ok: true });
    const eds = await w.mountAll();
    expect(eds.map((e) => e.effective().wordWrap)).toEqual(['off', 'off']);
    w.panes.close();
    expect(w.editorOf('g1').effective().wordWrap).toBe('on');
  });
});

describe('an edit in a pane while its correction is pending (CODE-6)', () => {
  it('drops the second edit, tells the user, and leaves document and pane the same after the correction, without throwing', async () => {
    const w = await paneWorld(sectionParams(2));
    const id = w.addDoc(GAPPED.join('\n'));
    expect(await w.panes.open(id)).toEqual({ ok: true });
    await w.mountAll();
    w.panes.flush();
    const pane = paneModel(w, 'g1');
    // An edit over the junction (pane lines 5–6) that joins `A2` and `CH1` in the pane: the pane's correction waits for the
    // end of the task. (Since P4e review NC-2 an edit that also took the `CH1` away is refused, so it joins up to column 1.)
    (pane as unknown as { pushEditOperations: (...a: unknown[]) => unknown }).pushEditOperations(null, [{ range: { startLineNumber: 5, startColumn: 3, endLineNumber: 6, endColumn: 1 }, text: 'X' }], () => null);
    expect(pane.getValue()).toContain('A2XCH1');
    // And one more in the same task, on a line the document projection does not have yet.
    expect(() => w.type(pane, 6, 1, 'Z')).not.toThrow();
    w.panes.flush();
    expect(w.said.some(([text, error]) => error && text === t('channelPanes.status.editDropped'))).toBe(true);
    // The pane shows what the document has for the channel: no character is in one and not in the other.
    expect(w.text(id)).not.toContain('Z');
    expect(pane.getValue()).not.toContain('Z');
    const fresh = await paneWorld(sectionParams(2));
    expect(await fresh.panes.open(fresh.addDoc(w.text(id)))).toEqual({ ok: true });
    await fresh.mountAll();
    expect(pane.getValue()).toBe(paneModel(fresh, 'g1').getValue());
    expect(paneModel(w, 'g2').getValue()).toBe(paneModel(fresh, 'g2').getValue());
  });
});

describe('a reload from disk with the view open (CODE-9)', () => {
  it('is one step of the view’s undo, with sections: one Undo restores the text before it', async () => {
    const { w, id } = await sections();
    const before = w.text(id);
    w.editor.replaceAll(id, PROGRAM.map((l) => (l === 'G1 X20' ? 'G1 X99' : l)).join('\n'));
    w.panes.flush();
    expect(linesOf(paneModel(w, 'g1'))).toContain('G1 X99');
    w.panes.undo();
    w.panes.flush();
    expect(w.text(id)).toBe(before);
    expect(linesOf(paneModel(w, 'g1'))).not.toContain('G1 X99');
  });

  it('is one step of the view’s undo, with one file per channel: one Undo restores the text before it', async () => {
    const { w, ids } = await files([['%', 'O1', 'G0 X1', 'M901P12', 'M30'], ['%', 'O1', 'G0 X2', 'M901P12', 'M30']]);
    const before = w.text(ids[0]);
    w.editor.replaceAll(ids[0], ['%', 'O1', 'G0 X7', 'G0 X8', 'M901P12', 'M30'].join('\n'));
    w.panes.flush();
    expect(w.text(ids[0])).not.toBe(before);
    w.panes.undo();
    w.panes.flush();
    expect(w.text(ids[0])).toBe(before);
    expect(w.said.filter(([, error]) => error)).toEqual([]);
  });
});


// P4e fix batch FB3 (NC-2, NC-10, NC-11, the hover from the alignment's reasons).
const MOVES = "A pane only edits its own channel's lines. To end a section early or add lines after its end, edit the program itself.";

/** A preset of a profile's machine page, as a machine gets it. */
function presetOf(profile: string, id: string): ChannelParams {
  const found = profileOf(profile).machineParams?.channels?.presets.find((x) => x.id === id);
  if (!found) throw new Error(`${profile}: no preset ${id}`);
  return JSON.parse(JSON.stringify(found.value)) as ChannelParams;
}

/** The Okuma two-turret program of the review (G13 / G14 sections). Turret A's pane: header, `G13` … `N2 …` | `G13`, `N3 G1 X80`. */
const OKUMA = ['$PART.MIN%', 'O1000', 'G13', 'N1 G0 X100 Z5', 'N2 G1 Z-10 F0.2', 'G14', 'N1 G0 X50 Z5', 'G13', 'N3 G1 X80', 'G14', 'N2 G1 Z-20', 'M02'];

async function okuma(): Promise<{ w: PaneWorld; id: string }> {
  const w = await paneWorld(presetOf('okuma-osp', 'okuma-2turret'), { cp: 'okuma-osp' });
  const id = w.addDoc(OKUMA.join('\n'));
  expect(await w.panes.open(id)).toEqual({ ok: true });
  await w.mountAll();
  w.panes.flush();
  return { w, id };
}

/** An edit typed into a pane model the way Monaco's editor makes it. */
function edit(model: ITextModel, l1: number, c1: number, l2: number, c2: number, text: string): void {
  (model as unknown as { pushEditOperations(...a: unknown[]): unknown }).pushEditOperations(null, [{ range: { startLineNumber: l1, startColumn: c1, endLineNumber: l2, endColumn: c2 }, text }], () => null);
}

/** A program read afresh in a new view: what each pane shows for `text`. */
async function panesFor(params: ChannelParams, text: string, cp?: string): Promise<string[]> {
  const fresh = await paneWorld(params, cp === undefined ? {} : { cp });
  expect(await fresh.panes.open(fresh.addDoc(text))).toEqual({ ok: true });
  await fresh.mountAll();
  return fresh.editor.groupsState().groups.map((g) => fresh.paneText(g.id));
}

describe('a pane edit that would move lines to another channel (NC-2)', () => {
  const refusedSaid = (w: PaneWorld): boolean => w.said.some(([text, error]) => error && text === MOVES);

  it('says it in plain words', () => {
    expect(t('channelPanes.status.movesLines')).toBe(MOVES);
  });

  for (const [what, l1, c1, l2, c2, text] of [
    ['typing at column 1 of a section start', 6, 1, 6, 1, 'N'],
    ['deleting a section start with lines after it', 6, 1, 7, 1, ''],
    ['deleting the line above a section start together with the start', 5, 1, 7, 1, ''],
    ['a new line at column 1 of the first section start (it would become a header line)', 3, 1, 3, 1, 'X9\n'],
    ['typing a section start of the other channel', 4, 1, 4, 1, 'CH2\n'],
  ] as const) {
    it(`refuses ${what} (toy sections): document unchanged, pane restored, message shown`, async () => {
      const { w, id } = await sections(GAPPED);
      const before = w.text(id);
      const panes = [w.paneText('g1'), w.paneText('g2')];
      edit(paneModel(w, 'g1'), l1, c1, l2, c2, text);
      expect(w.text(id)).toBe(before);
      w.panes.flush();
      expect(w.text(id)).toBe(before);
      expect([w.paneText('g1'), w.paneText('g2')]).toEqual(panes);
      expect(refusedSaid(w)).toBe(true);
      expect(get(w.panes.state).panes.map((p) => p.name)).toEqual(['Turret A', 'Turret B']);
    });
  }

  it('refuses typing in front of a section start and deleting one with lines after it on the Okuma two-turret preset', async () => {
    for (const [l1, c1, l2, c2, text] of [
      [6, 1, 6, 1, 'N'], // `NG13` starts nothing: `N3 G1 X80` would go to turret B
      [5, 1, 7, 1, ''], // `N2 …` and the second `G13` deleted: `N3 G1 X80` would go to turret B
      [3, 1, 3, 1, 'N9 G1 X1\n'], // a line in front of the first `G13` would be a header line
    ] as const) {
      const { w, id } = await okuma();
      const panes = [w.paneText('g1'), w.paneText('g2')];
      edit(paneModel(w, 'g1'), l1, c1, l2, c2, text);
      w.panes.flush();
      expect(w.text(id), JSON.stringify(text)).toBe(OKUMA.join('\n'));
      expect([w.paneText('g1'), w.paneText('g2')]).toEqual(panes);
      expect(refusedSaid(w)).toBe(true);
    }
  });

  it('leaves a clean program clean when it refuses an edit, and a changed one changed (the dirty flag follows the text)', async () => {
    for (const joined of [false, true]) {
      const { w, id } = await sections(GAPPED);
      const pane = paneModel(w, 'g1');
      if (joined) {
        w.type(pane, 4, 3, 'Z'); // the refused edit joins this typing's undo element
        w.panes.flush();
        expect(w.docs.get(id)?.dirty).toBe(true);
      } else {
        expect(w.docs.get(id)?.dirty).toBe(false);
      }
      edit(pane, 6, 1, 6, 1, 'N'); // refused
      w.panes.flush();
      expect(refusedSaid(w)).toBe(true);
      expect(w.docs.get(id)?.dirty, joined ? 'dirty before' : 'clean before').toBe(joined);
      if (!joined) expect(w.text(id)).toBe(GAPPED.join('\n'));
    }
  });

  it('adds no step to the view’s undo: Undo afterwards undoes the step before the refused edit, and Redo brings nothing back', async () => {
    const { w, id } = await sections(GAPPED);
    const original = w.text(id);
    const pane = paneModel(w, 'g1');
    w.type(pane, 4, 3, 'Z'); // `A1Z`, its own step
    pane.pushStackElement();
    const withZ = w.text(id);
    edit(pane, 6, 1, 6, 1, 'N'); // refused
    w.panes.flush();
    expect(w.text(id)).toBe(withZ);
    w.panes.redo();
    w.panes.flush();
    expect(w.text(id)).toBe(withZ);
    w.panes.undo();
    w.panes.flush();
    expect(w.text(id)).toBe(original);
    expect(w.paneText('g1')).toBe(['%', 'O0100', 'CH1', 'A1', 'A2', 'CH1', 'A3'].join('\n'));
  });

  it('keeps the typing the refused edit joined (no boundary between them) as one step', async () => {
    const { w, id } = await sections(GAPPED);
    const original = w.text(id);
    const pane = paneModel(w, 'g1');
    w.type(pane, 4, 3, 'Z');
    edit(pane, 6, 1, 6, 1, 'N'); // same undo element as the `Z`, refused
    w.panes.flush();
    expect(w.text(id).split('\n')[3]).toBe('A1Z');
    expect(w.text(id).split('\n')[7]).toBe('CH1');
    w.type(paneModel(w, 'g1'), 4, 4, 'Y');
    w.panes.flush();
    expect(w.text(id).split('\n')[3]).toBe('A1ZY');
    w.panes.undo();
    w.panes.undo();
    w.panes.flush();
    expect(w.text(id)).toBe(original);
  });

  it('puts a line pasted or entered at column 1 of a later section start at the end of the section above, in the same channel (toy sections)', async () => {
    for (const text of ['X9\n', '\n', 'X8\nX9\n']) {
      const { w, id } = await sections(GAPPED);
      edit(paneModel(w, 'g1'), 6, 1, 6, 1, text);
      w.panes.flush();
      const added = text.slice(0, -1).split('\n');
      expect(w.text(id).split('\n'), JSON.stringify(text)).toEqual(['%', 'O0100', 'CH1', 'A1', 'A2', ...added, 'CH2', 'B1', 'CH1', 'A3', 'CH2', 'B2']);
      expect(w.paneText('g1').split('\n')).toEqual(['%', 'O0100', 'CH1', 'A1', 'A2', ...added, 'CH1', 'A3']);
      expect(w.paneText('g2').split('\n')).toEqual(['%', 'O0100', 'CH2', 'B1', 'CH2', 'B2']);
      expect(refusedSaid(w)).toBe(false);
      expect([w.paneText('g1'), w.paneText('g2')]).toEqual(await panesFor(sectionParams(2), w.text(id)));
    }
  });

  it('puts a line pasted or entered at column 1 of the second G13 into turret A on the Okuma two-turret preset', async () => {
    for (const text of ['N9 G1 X1\n', '\n']) {
      const { w, id } = await okuma();
      const turretB = w.paneText('g2');
      edit(paneModel(w, 'g1'), 6, 1, 6, 1, text);
      w.panes.flush();
      const doc = w.text(id).split('\n');
      expect(doc.slice(4, 7), JSON.stringify(text)).toEqual(['N2 G1 Z-10 F0.2', text.slice(0, -1), 'G14']);
      expect(w.paneText('g2')).toBe(turretB);
      expect(w.paneText('g1').split('\n')).toContain('N3 G1 X80');
      expect(refusedSaid(w)).toBe(false);
      expect([w.paneText('g1'), w.paneText('g2')]).toEqual(await panesFor(presetOf('okuma-osp', 'okuma-2turret'), w.text(id), 'okuma-osp'));
    }
  });

  // The owner's answer of 2026-10-17: a pane edits only its own channel's lines. A code that ends a section
  // (the machine page's "section end") typed in the middle of a section, and a new line after a section's last
  // line, would hand lines to "outside every channel": refused as the cases above are.
  describe('ending a section from a pane, and a new line after its last line', () => {
    /** Two sections that end at `M30`; `(TAIL)` between them belongs to no channel. Pane 1: lines 1–7, pane 2: 1–5. */
    const ENDED = ['%', 'O0100', 'CH1', 'A1', 'A2', 'A3', 'M30', '(TAIL)', 'CH2', 'B1', 'M30'];
    const endedParams = (): ChannelParams => ({ ...sectionParams(2), sectionEnd: '(?<![A-Z0-9])M30(?!\\d)' });
    async function ended(): Promise<{ w: PaneWorld; id: string }> {
      const w = await paneWorld(endedParams());
      const id = w.addDoc(ENDED.join('\n'));
      expect(await w.panes.open(id)).toEqual({ ok: true });
      await w.mountAll();
      w.panes.flush();
      return { w, id };
    }
    /** The Okuma preset with `M02` as its section end (the preset itself has none: a turret ends at the next start). */
    async function okumaEnded(): Promise<{ w: PaneWorld; id: string }> {
      const w = await paneWorld({ ...presetOf('okuma-osp', 'okuma-2turret'), sectionEnd: '(?<![A-Z0-9])M02(?!\\d)' }, { cp: 'okuma-osp' });
      const id = w.addDoc(OKUMA.join('\n'));
      expect(await w.panes.open(id)).toEqual({ ok: true });
      await w.mountAll();
      w.panes.flush();
      return { w, id };
    }
    /** An edit in pane `group` that must be refused: document and both panes unchanged, the message shown. */
    function expectRefused(w: PaneWorld, id: string, group: string, l1: number, c1: number, l2: number, c2: number, text: string): void {
      const before = w.text(id);
      const panes = [w.paneText('g1'), w.paneText('g2')];
      const stack = w.said.length;
      edit(paneModel(w, group), l1, c1, l2, c2, text);
      expect(w.text(id), JSON.stringify(text)).toBe(before);
      w.panes.flush();
      expect(w.text(id), JSON.stringify(text)).toBe(before);
      expect([w.paneText('g1'), w.paneText('g2')]).toEqual(panes);
      expect(w.said.slice(stack).some(([said, error]) => error && said === MOVES)).toBe(true);
    }

    it('starts from the pane texts it claims', async () => {
      const { w } = await ended();
      expect(w.paneText('g1').split('\n')).toEqual(['%', 'O0100', 'CH1', 'A1', 'A2', 'A3', 'M30']);
      expect(w.paneText('g2').split('\n')).toEqual(['%', 'O0100', 'CH2', 'B1', 'M30']);
      const o = await okumaEnded();
      expect(o.w.paneText('g1').split('\n')).toEqual(['$PART.MIN%', 'O1000', 'G13', 'N1 G0 X100 Z5', 'N2 G1 Z-10 F0.2', 'G13', 'N3 G1 X80']);
      expect(o.w.paneText('g2').split('\n')).toEqual(['$PART.MIN%', 'O1000', 'G14', 'N1 G0 X50 Z5', 'G14', 'N2 G1 Z-20', 'M02']);
    });

    for (const [what, l1, c1, l2, c2, text] of [
      ['a new line with the end code in the middle of the section', 5, 3, 5, 3, '\nM30'],
      ['the end code typed over a line in the middle', 5, 1, 5, 3, 'M30'],
      ['the end code added to the end of a line in the middle', 4, 3, 4, 3, ' M30'],
      ['the end code typed as a new line in front of the last line', 7, 1, 7, 1, 'M30\n'],
    ] as const) {
      it(`refuses ${what} (toy sections with a section end): document unchanged, pane restored, message shown`, async () => {
        const { w, id } = await ended();
        expectRefused(w, id, 'g1', l1, c1, l2, c2, text);
      });
    }

    for (const [what, l1, c1, l2, c2, text] of [
      ['Enter after the end line of the first section', 7, 4, 7, 4, '\n'],
      ['a line pasted after the end line of the first section', 7, 4, 7, 4, '\nX9'],
    ] as const) {
      it(`refuses ${what} (toy sections with a section end)`, async () => {
        const { w, id } = await ended();
        expectRefused(w, id, 'g1', l1, c1, l2, c2, text);
      });
    }

    it('refuses Enter after the end line of the last section too (it would end up outside every channel)', async () => {
      const { w, id } = await ended();
      expectRefused(w, id, 'g2', 5, 4, 5, 4, '\n');
    });

    it('refuses the end code typed in the middle of a turret, and Enter after the end line, on the Okuma two-turret preset with a section end', async () => {
      const mid = await okumaEnded();
      expectRefused(mid.w, mid.id, 'g1', 4, 14, 4, 14, '\nM02'); // `N2 …` and the rest of turret A's range would leave it
      const after = await okumaEnded();
      expectRefused(after.w, after.id, 'g2', 7, 4, 7, 4, '\n'); // after `M02`, the last line of turret B
    });

    it('adds no step to the view’s undo: Undo afterwards undoes the step before, Redo brings nothing back', async () => {
      const { w, id } = await ended();
      const original = w.text(id);
      const pane = paneModel(w, 'g1');
      w.type(pane, 4, 3, 'Z'); // `A1Z`, its own step
      pane.pushStackElement();
      const withZ = w.text(id);
      edit(pane, 5, 3, 5, 3, '\nM30'); // refused
      edit(pane, 7, 4, 7, 4, '\n'); // refused
      w.panes.flush();
      expect(w.text(id)).toBe(withZ);
      w.panes.redo();
      w.panes.flush();
      expect(w.text(id)).toBe(withZ);
      w.panes.undo();
      w.panes.flush();
      expect(w.text(id)).toBe(original);
      expect(w.paneText('g1').split('\n')).toEqual(['%', 'O0100', 'CH1', 'A1', 'A2', 'A3', 'M30']);
    });

    it('allows an ordinary Enter in the middle of a section, and one just in front of the end line (control)', async () => {
      const { w, id } = await ended();
      edit(paneModel(w, 'g1'), 4, 3, 4, 3, '\n'); // after `A1`
      w.panes.flush();
      expect(w.text(id).split('\n')).toEqual(['%', 'O0100', 'CH1', 'A1', '', 'A2', 'A3', 'M30', '(TAIL)', 'CH2', 'B1', 'M30']);
      edit(paneModel(w, 'g1'), 7, 3, 7, 3, '\nA4'); // after `A3`, in front of `M30`
      w.panes.flush();
      expect(w.text(id).split('\n')).toEqual(['%', 'O0100', 'CH1', 'A1', '', 'A2', 'A3', 'A4', 'M30', '(TAIL)', 'CH2', 'B1', 'M30']);
      expect(w.paneText('g2').split('\n')).toEqual(['%', 'O0100', 'CH2', 'B1', 'M30']);
      expect(refusedSaid(w)).toBe(false);
    });

    it('allows an ordinary Enter in the middle of a turret on the Okuma preset with a section end (control)', async () => {
      const { w, id } = await okumaEnded();
      edit(paneModel(w, 'g1'), 4, 14, 4, 14, '\n');
      w.panes.flush();
      expect(w.text(id).split('\n').slice(2, 7)).toEqual(['G13', 'N1 G0 X100 Z5', '', 'N2 G1 Z-10 F0.2', 'G14']);
      expect(refusedSaid(w)).toBe(false);
    });
  });

  it('allows deleting a whole range of the channel', async () => {
    const { w, id } = await sections(GAPPED);
    // Pane 1's last range (`CH1`, `A3`), deleted from the end of `A2` to the end of the pane.
    edit(paneModel(w, 'g1'), 5, 3, 7, 3, '');
    w.panes.flush();
    expect(w.text(id).split('\n')).toEqual(['%', 'O0100', 'CH1', 'A1', 'A2', 'CH2', 'B1', 'CH2', 'B2']);
    expect(w.paneText('g1').split('\n')).toEqual(['%', 'O0100', 'CH1', 'A1', 'A2']);
    expect(w.paneText('g2').split('\n')).toEqual(['%', 'O0100', 'CH2', 'B1', 'CH2', 'B2']);
    expect(refusedSaid(w)).toBe(false);
  });
});

describe('waits inside a loop and waits naming a channel the machine does not have (NC-10, NC-11)', () => {
  /** The view with the app's jump-line source (`computeJumpLines`, as Check Wait Codes reads it). */
  async function withJumps(params: ChannelParams, make: (w: PaneWorld) => Promise<void>): Promise<PaneWorld> {
    let world: PaneWorld | null = null;
    const w = await paneWorld(params, {
      viewDeps: {
        jumpLines: (id, channelOf) => computeJumpLines(world!.editor.getLines(id, 1, world!.editor.getLineCount(id)), cpOf('fanuc-lathe'), channelOf),
      },
    });
    world = w;
    await make(w);
    await w.mountAll();
    w.panes.flush();
    return w;
  }

  // Path 1 waits once inside a loop that runs three times; path 2 waits three times.
  const LOOPED = ['%', 'O0100', 'CH1', '#1=0', 'N10 M901P12', '#1=#1+1', 'IF[#1LT3]GOTO10', 'M30', 'CH2', 'M901P12', 'G0 X1', 'M901P12', 'G0 X2', 'M901P12', 'M30'];

  it('does not judge the count of a wait inside a loop, with sections: no red mark, and the hover says why', async () => {
    const w = await withJumps(sectionParams(2), async (world) => {
      expect(await world.panes.open(world.addDoc(LOOPED.join('\n')))).toEqual({ ok: true });
    });
    expect(get(w.panes.state).marks).toEqual({ matched: 2, unmatched: 0, none: 2 });
    expect(marksOf(w.editorOf('g2')).filter((m) => m.cls === 'gedit-wait-unmatched')).toEqual([]);
    const hovers = w.editorOf('g2').marks().map((m) => (m.options.hoverMessage as { value: string }).value);
    expect(hovers.filter((h) => h === t('channelPanes.mark.loop'))).toHaveLength(2);
  });

  it('does not judge the count of a wait inside a loop, with one file per channel', async () => {
    const w = await withJumps(fileParams(2), async (world) => {
      const a = world.addDoc(LOOPED.slice(3, 8).join('\n'), { path: '/nc/PART_CH1.nc' });
      world.addDoc(LOOPED.slice(9).join('\n'), { path: '/nc/PART_CH2.nc', activate: false });
      expect(await world.panes.open(a)).toEqual({ ok: true });
    });
    expect(get(w.panes.state).marks).toEqual({ matched: 2, unmatched: 0, none: 2 });
  });

  it('still marks a count difference outside any loop', async () => {
    const lines = LOOPED.map((l) => (l === 'IF[#1LT3]GOTO10' ? 'G0 X9' : l));
    const w = await withJumps(sectionParams(2), async (world) => {
      expect(await world.panes.open(world.addDoc(lines.join('\n')))).toEqual({ ok: true });
    });
    expect(get(w.panes.state).marks).toEqual({ matched: 2, unmatched: 2, none: 0 });
  });

  it('marks a wait that names a channel the machine does not have, and the hover names it', async () => {
    const { w } = await sections(['%', 'O1', 'CH1', 'M901P14', 'M30', 'CH2', 'G0 X1', 'CH3', 'G0 X2'], 3);
    expect(marksOf(w.editorOf('g1'))).toEqual([{ line: 4, cls: 'gedit-wait-unmatched' }]);
    expect(w.editorOf('g1').marks()[0].options.hoverMessage).toMatchObject({
      value: 'This wait names channel 4, which this machine does not have. The control would wait here for ever.',
    });
  });
});

describe('the hover of a wait says the alignment’s own reason', () => {
  it('names only the channel that lacks the wait of a Siemens WAITM list (three channels)', async () => {
    const params: ChannelParams = { ...fileParams(3), syncMarks: presetOf('sinumerik', 'sinumerik-2channel').syncMarks };
    const w = await paneWorld(params, { cp: 'sinumerik' });
    const a = w.addDoc(['N10 G0 X1', 'N20 WAITM(1,1,2,3)', 'M30'].join('\n'), { path: '/nc/PART_CH1.nc' });
    w.addDoc(['N10 G0 X2', 'N20 WAITM(1,1,2)', 'M30'].join('\n'), { path: '/nc/PART_CH2.nc', activate: false });
    w.addDoc(['N10 G0 X3', 'M30'].join('\n'), { path: '/nc/PART_CH3.nc', activate: false });
    expect(await w.panes.open(a)).toEqual({ ok: true });
    await w.mountAll();
    w.panes.flush();
    expect(marksOf(w.editorOf('g1'))).toEqual([{ line: 2, cls: 'gedit-wait-unmatched' }]);
    expect(w.editorOf('g1').marks()[0].options.hoverMessage).toMatchObject({ value: 'Turret C has no matching wait for "N20 WAITM(1,1,2,3)"' });
  });

  it('says that a SETM answers a WAITM', async () => {
    const params: ChannelParams = { ...fileParams(2), syncMarks: presetOf('sinumerik', 'sinumerik-2channel').syncMarks };
    const w = await paneWorld(params, { cp: 'sinumerik' });
    const a = w.addDoc(['N10 G0 X1', 'N20 WAITM(7,1,2)', 'M30'].join('\n'), { path: '/nc/PART_CH1.nc' });
    w.addDoc(['N10 G0 X2', 'N20 SETM(7)', 'M30'].join('\n'), { path: '/nc/PART_CH2.nc', activate: false });
    expect(await w.panes.open(a)).toEqual({ ok: true });
    await w.mountAll();
    w.panes.flush();
    expect(get(w.panes.state).marks.unmatched).toBe(0);
    const hover = w.editorOf('g1').marks().map((m) => (m.options.hoverMessage as { value: string }).value);
    expect(hover).toEqual(['A SETM in Turret B answers this wait, so it needs no matching wait there.']);
  });

  it('tells a P-less Fanuc wait from one with P: the other channel lacks it (not “another order”)', async () => {
    const rule: SyncRule = { ...WAIT_RULE, partners: { kind: 'word', address: 'P', decode: 'digits', whenAbsent: { kind: 'fixed', channels: ['1', '2'] } } };
    const { w } = await (async () => {
      const world = await paneWorld({ ...sectionParams(2), syncMarks: [rule] });
      const id = world.addDoc(['%', 'O1', 'CH1', 'M901', 'M30', 'CH2', 'M901P12', 'M30'].join('\n'));
      expect(await world.panes.open(id)).toEqual({ ok: true });
      await world.mountAll();
      world.panes.flush();
      return { w: world };
    })();
    expect(w.editorOf('g1').marks()[0].options.hoverMessage).toMatchObject({ value: 'Turret B has no matching wait for "M901"' });
    expect(w.editorOf('g2').marks()[0].options.hoverMessage).toMatchObject({ value: 'Turret A has no matching wait for "M901P12"' });
  });

  it('says a crossing wait comes in another order', async () => {
    const { w } = await sections(['%', 'O1', 'CH1', 'M901P12', 'M902P12', 'M903P12', 'M909P12', 'CH2', 'M909P12', 'M901P12', 'M902P12', 'M903P12'], 2);
    const unmatched = (g: string) => w.editorOf(g).marks().filter((m) => m.options.linesDecorationsClassName === 'gedit-wait-unmatched');
    expect(unmatched('g1').map((m) => m.range.startLineNumber)).toEqual([7]);
    expect(unmatched('g1')[0].options.hoverMessage).toMatchObject({ value: t('channelPanes.mark.crossing') });
  });

  it('has a short plain text for every reason', () => {
    for (const [key, params] of [
      ['channelPanes.mark.alone', {}],
      ['channelPanes.mark.missing', { channels: 'Turret B', count: 1, text: 'M901P12' }],
      ['channelPanes.mark.missing', { channels: 'Turret B, Turret C', count: 2, text: 'M901P123' }],
      ['channelPanes.mark.unknown', { channels: '4', count: 1 }],
      ['channelPanes.mark.unknown', { channels: '4, 5', count: 2 }],
      ['channelPanes.mark.crossing', {}],
      ['channelPanes.mark.elsewhere', {}],
      ['channelPanes.mark.loop', {}],
      ['channelPanes.mark.answered', { channels: 'Channel 2' }],
    ] as const) {
      const text = t(key, params);
      expect(text, key).not.toBe(key);
      expect(text, key).not.toMatch(/\{|\}/);
      expect(text.length, key).toBeLessThan(120);
    }
    expect(t('channelPanes.mark.missing', { channels: 'Turret B, Turret C', count: 2, text: 'M901P123' })).toBe('Turret B, Turret C have no matching wait for "M901P123"');
  });
});
