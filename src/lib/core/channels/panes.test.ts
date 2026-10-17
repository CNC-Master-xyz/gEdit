// The channel panes' mapping and alignment (Phase 4 plan AD-51, §6.7 rules 9–14). Written by the
// P4e prelude, run since P4.22a implemented `panes.ts`; the cases after "extra cases" are
// P4.22a's own.

import { describe, expect, it } from 'vitest';
import { MAX_GROUPS } from '$lib/monaco/editorService';
import { cpOf, profileOf } from '../../../../tests/unit/helpers/profiles';
import { checkSyncMarks } from './check';
import { resolveDocument } from './marks';
import { TOY_CHANNELS, TOY_PROGRAM, applyEdits, lcg, toySet, wait } from './paneFixtures';
import {
  MAX_CHANNEL_PANES,
  alignPanes,
  changeHull,
  docLineOf,
  mapPaneEdits,
  marksInPane,
  paneEditMovesLines,
  paneLineOf,
  projectChannel,
  projectedLines,
  reprojectEdits,
  waitKey,
  type ChannelProjection,
  type TextEdit,
} from './panes';
import type { ChannelParams, ChannelSet, SyncHit, SyncRule } from './types';

const linesOf = (doc: readonly string[]) => (from: number, to: number) => doc.slice(from - 1, to);
const at = (l1: number, c1: number, l2: number, c2: number, text: string): TextEdit => ({
  range: { startLineNumber: l1, startColumn: c1, endLineNumber: l2, endColumn: c2 },
  text,
});
const project = (doc: readonly string[], channel: string): ChannelProjection => {
  const p = projectChannel(toySet(doc), channel);
  if (p === null) throw new Error(`no channel ${channel}`);
  return p;
};
const paneOf = (doc: readonly string[], channel: string): string[] => projectedLines(project(doc, channel), linesOf(doc));

describe('the cap', () => {
  it('is the editor groups’ cap (AD-50: four)', () => {
    expect(MAX_CHANNEL_PANES).toBe(4);
    expect(MAX_CHANNEL_PANES).toBe(MAX_GROUPS);
  });
});

describe('projection (rule 1, 2)', () => {
  it('shows the header, then the channel’s ranges in document order', () => {
    expect(project(TOY_PROGRAM, '1')).toEqual({
      channelId: '1',
      segments: [
        { docStart: 1, paneStart: 1, length: 2, kind: 'header' },
        { docStart: 3, paneStart: 3, length: 3, kind: 'section' },
        { docStart: 8, paneStart: 6, length: 2, kind: 'section' },
      ],
      lineCount: 7,
    });
    expect(paneOf(TOY_PROGRAM, '1')).toEqual(['%', 'O1000', '$1', 'A1', 'A2', '$1', 'A3']);
    expect(paneOf(TOY_PROGRAM, '2')).toEqual(['%', 'O1000', '$2', 'B1', '$2', 'B2']);
  });

  it('is what Split into Channel Documents makes (the merge relies on it)', () => {
    // `splitTexts` (contrib/channels.ts): the header, then the channel's ranges.
    expect(paneOf(TOY_PROGRAM, '2').join('\n')).toBe(['%', 'O1000', '$2', 'B1', '$2', 'B2'].join('\n'));
  });

  it('has no header when the first section starts at line 1', () => {
    const doc = ['$1', 'A1', '$2', 'B1'];
    expect(project(doc, '2').segments).toEqual([{ docStart: 3, paneStart: 1, length: 2, kind: 'section' }]);
  });

  it('answers null for a channel the program does not have', () => {
    expect(projectChannel(toySet(TOY_PROGRAM), '3')).toBeNull();
  });

  it('maps lines both ways', () => {
    const p = project(TOY_PROGRAM, '1');
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => docLineOf(p, n))).toEqual([1, 2, 3, 4, 5, 8, 9]);
    expect([1, 5, 6, 7, 8, 9, 10, 11].map((n) => paneLineOf(p, n))).toEqual([1, 5, null, null, 6, 7, null, null]);
    expect(() => docLineOf(p, 0)).toThrow(RangeError);
    expect(() => docLineOf(p, 8)).toThrow(RangeError);
  });
});

describe('an edit in a pane (rules 3–5)', () => {
  const p = () => project(TOY_PROGRAM, '1');
  const maxColumn = (n: number) => paneOf(TOY_PROGRAM, '1')[n - 1].length + 1;

  it('moves by its segment’s offset, columns unchanged', () => {
    expect(mapPaneEdits(p(), [at(4, 3, 4, 3, 'X')], maxColumn)).toEqual([at(4, 3, 4, 3, 'X')]);
    expect(mapPaneEdits(p(), [at(7, 1, 7, 3, 'A9')], maxColumn)).toEqual([at(9, 1, 9, 3, 'A9')]);
    expect(mapPaneEdits(p(), [at(2, 2, 2, 6, '2000')], maxColumn)).toEqual([at(2, 2, 2, 6, '2000')]);
  });

  it('maps every change of a multi-cursor event, ascending', () => {
    // Monaco reports the changes of one event in reverse document order.
    expect(mapPaneEdits(p(), [at(7, 3, 7, 3, 'b'), at(4, 3, 4, 3, 'a')], maxColumn)).toEqual([at(4, 3, 4, 3, 'a'), at(9, 3, 9, 3, 'b')]);
  });

  it('splits a range that crosses a junction and never touches the other channel', () => {
    // From the end of `A2` (pane 5) to after `$1` (pane 6 = document 8): the lines 6–7 of channel 2 stay.
    expect(mapPaneEdits(p(), [at(5, 3, 6, 3, 'Z')], maxColumn)).toEqual([at(5, 3, 5, 3, 'Z'), at(8, 1, 8, 3, '')]);
  });

  it('deletes whole lines up to a junction as whole lines', () => {
    // Deleting pane line 5 (`A2` and its line break) deletes document line 5 and nothing else.
    const mapped = mapPaneEdits(p(), [at(5, 1, 6, 1, '')], maxColumn);
    expect(mapped).toEqual([at(5, 1, 6, 1, '')]);
    const doc = applyEdits(TOY_PROGRAM, mapped);
    expect(paneOf(doc, '1')).toEqual(applyEdits(paneOf(TOY_PROGRAM, '1'), [at(5, 1, 6, 1, '')]));
    expect(paneOf(doc, '2')).toEqual(paneOf(TOY_PROGRAM, '2'));
  });

  it('puts a line typed at the end of a range into that range (rule 4)', () => {
    const mapped = mapPaneEdits(p(), [at(5, 3, 5, 3, '\nA2b')], maxColumn);
    expect(mapped).toEqual([at(5, 3, 5, 3, '\nA2b')]);
    expect(applyEdits(TOY_PROGRAM, mapped).slice(4, 7)).toEqual(['A2', 'A2b', '$2']);
  });

  it('gives the pane’s own text back after re-projection, for random edits inside a section', () => {
    const rnd = lcg(42);
    let doc = [...TOY_PROGRAM, '$1', ...Array.from({ length: 40 }, (_, i) => `A${10 + i} X${i}`), '$2', 'B3'];
    for (let round = 0; round < 300; round++) {
      const channel = rnd() < 0.5 ? '1' : '2';
      const pane = paneOf(doc, channel);
      const line = 1 + Math.floor(rnd() * pane.length);
      if (/^\$/.test(pane[line - 1])) continue; // a section start stays as it is in this property
      const len = pane[line - 1].length;
      const c1 = 1 + Math.floor(rnd() * (len + 1));
      const c2 = c1 + Math.floor(rnd() * (len + 2 - c1));
      const text = rnd() < 0.2 ? `\nN${round}` : rnd() < 0.5 ? '' : `w${round}`;
      const edit = at(line, c1, line, c2, text);
      const mapped = mapPaneEdits(project(doc, channel), [edit], (n) => pane[n - 1].length + 1);
      const next = applyEdits(doc, mapped);
      expect(paneOf(next, channel), `round ${round}`).toEqual(applyEdits(pane, [edit]));
      doc = next;
    }
  });
});

describe('re-projection after a change of the document (rule 6)', () => {
  it('needs no edit for a pane whose lines did not change', () => {
    const doc = applyEdits(TOY_PROGRAM, [at(4, 3, 4, 3, 'X')]); // channel 1 only
    expect(reprojectEdits(project(TOY_PROGRAM, '2'), project(doc, '2'), { oldPaneLines: linesOf(paneOf(TOY_PROGRAM, '2')), docLines: linesOf(doc) })).toEqual([]);
  });

  it('brings every pane to the new projection, for random edits of the document (sections moving too)', () => {
    const rnd = lcg(7);
    let doc = [...TOY_PROGRAM];
    for (let round = 0; round < 400; round++) {
      const line = 1 + Math.floor(rnd() * doc.length);
      const r = rnd();
      const edit =
        r < 0.3
          ? at(line, doc[line - 1].length + 1, line, doc[line - 1].length + 1, `\nL${round}`)
          : r < 0.45 && doc.length > 3
            ? at(line, 1, Math.min(line + 1, doc.length), line < doc.length ? 1 : doc[line - 1].length + 1, '')
            : r < 0.55
              ? at(line, 1, line, 1, `$${1 + Math.floor(rnd() * 3)}\n`)
              : at(line, 1, line, doc[line - 1].length + 1, `T${round}`);
      const next = applyEdits(doc, [edit]);
      for (const channel of ['1', '2', '3']) {
        const before = projectChannel(toySet(doc), channel);
        const after = projectChannel(toySet(next), channel);
        if (before === null || after === null) continue;
        const oldPane = projectedLines(before, linesOf(doc));
        const edits = reprojectEdits(before, after, { oldPaneLines: linesOf(oldPane), docLines: linesOf(next) });
        expect(applyEdits(oldPane, edits), `round ${round}, channel ${channel}`).toEqual(projectedLines(after, linesOf(next)));
      }
      doc = next;
    }
  });
});

describe('alignment at the wait codes (rule 7, the owner’s rule of 2026-10-17)', () => {
  const rules: SyncRule[] = [
    { id: 'w', label: 'Waits', match: { kind: 'codes', codes: 'M900-M999' }, partners: { kind: 'word', address: 'P', decode: 'digits' }, samePartners: true },
    { id: 'o', label: 'Order', semantics: 'ordered', match: { kind: 'prefix', prefix: 'P' }, partners: { kind: 'all' } },
  ];
  const [c1, c2, c3] = TOY_CHANNELS;
  const pane = (channel: typeof c1, marks: ReturnType<typeof wait>[], lineCount = 10) => ({ channel, lineCount, marks });

  it('keys a wait by its code and its P set, its own channel included', () => {
    expect(waitKey(wait('1', 3, 'M901', '12'))).toBe(waitKey(wait('2', 9, 'M901', '12')));
    expect(waitKey(wait('1', 3, 'M901', '12'))).not.toBe(waitKey(wait('1', 3, 'M901', '123')));
    expect(waitKey(wait('1', 3, 'M901', '2'))).toBe(waitKey(wait('2', 3, 'M901', '1')));
  });

  it('lines up a wait of all three channels (M910 P123) as one group', () => {
    const a = alignPanes([pane(c1, [wait('1', 3, 'M910', '123')]), pane(c2, [wait('2', 5, 'M910', '123')]), pane(c3, [wait('3', 2, 'M910', '123')])], rules);
    expect(a.groups).toEqual([{ marks: [{ pane: 0, line: 3 }, { pane: 1, line: 5 }, { pane: 2, line: 2 }] }]);
    expect(a.states).toEqual([['matched'], ['matched'], ['matched']]);
    // Rows before the marks: 2, 4, 1 → everyone down to 4; then all to the tallest (13 rows).
    expect(a.zones).toEqual([
      { pane: 0, afterLine: 2, lines: 2 },
      { pane: 0, afterLine: 10, lines: 1 },
      { pane: 1, afterLine: 10, lines: 3 },
      { pane: 2, afterLine: 1, lines: 3 },
    ]);
  });

  it('lines up M901 P12 in channels 1 and 2 and leaves channel 3 alone', () => {
    const a = alignPanes([pane(c1, [wait('1', 4, 'M901', '12')]), pane(c2, [wait('2', 6, 'M901', '12')]), pane(c3, [])], rules);
    expect(a.groups).toEqual([{ marks: [{ pane: 0, line: 4 }, { pane: 1, line: 6 }] }]);
    expect(a.states).toEqual([['matched'], ['matched'], []]);
    expect(a.zones.filter((z) => z.pane === 2)).toEqual([{ pane: 2, afterLine: 10, lines: 2 }]); // only the trailing filler
  });

  it('does not pair the same code with a different P: both are unmatched', () => {
    const a = alignPanes([pane(c1, [wait('1', 4, 'M901', '12')]), pane(c2, [wait('2', 4, 'M901', '123')]), pane(c3, [])], rules);
    expect(a.groups).toEqual([]);
    expect(a.states).toEqual([['unmatched'], ['unmatched'], []]);
    expect(a.zones).toEqual([]);
  });

  it('pairs the n-th occurrence with the n-th', () => {
    const a = alignPanes([pane(c1, [wait('1', 3, 'M901', '12'), wait('1', 7, 'M901', '12')]), pane(c2, [wait('2', 4, 'M901', '12')])], rules);
    expect(a.groups).toEqual([{ marks: [{ pane: 0, line: 3 }, { pane: 1, line: 4 }] }]);
    expect(a.states).toEqual([['matched', 'unmatched'], ['matched']]);
  });

  it('drops the crossing wait of the lowest pane, the same way every time', () => {
    const a = alignPanes(
      [pane(c1, [wait('1', 2, 'M901', '12'), wait('1', 5, 'M902', '12')]), pane(c2, [wait('2', 2, 'M902', '12'), wait('2', 5, 'M901', '12')])],
      rules,
    );
    expect(a.groups).toEqual([{ marks: [{ pane: 0, line: 5 }, { pane: 1, line: 2 }] }]);
    expect(a.states).toEqual([['unmatched', 'matched'], ['matched', 'unmatched']]);
    expect(a.zones).toEqual([
      { pane: 0, afterLine: 10, lines: 3 },
      { pane: 1, afterLine: 1, lines: 3 },
    ]);
  });

  it('judges only the channels shown: P123 with channels 1 and 2 on screen lines them up', () => {
    const a = alignPanes([pane(c1, [wait('1', 3, 'M910', '123')]), pane(c2, [wait('2', 3, 'M910', '123')])], rules);
    expect(a.states).toEqual([['matched'], ['matched']]);
  });

  it('marks a mark that needs no partner as none (not blocking, an ordered number in one channel)', () => {
    const a = alignPanes(
      [
        pane(c1, [wait('1', 2, 'M950', '12', { blocking: false }), wait('1', 4, '10', '12', { ruleId: 'o' })]),
        pane(c2, [wait('2', 3, '20', '12', { ruleId: 'o' }), wait('2', 6, '10', '12', { ruleId: 'o' })]),
      ],
      rules,
    );
    expect(a.states).toEqual([['none', 'matched'], ['none', 'matched']]);
  });
});

// ---------------------------------------------------------------------------
// P4.22a's own cases
// ---------------------------------------------------------------------------

describe('extra cases: projection', () => {
  it('shows a section that two channels share in both panes, and nothing for a channel without sections', () => {
    const set = toySet(TOY_PROGRAM);
    expect(projectChannel({ ...set, layout: 'multi-file' }, '9')).toBeNull();
    expect(projectChannel({ ...set, members: set.members.filter((m) => m.kind !== 'section') }, '1')).toBeNull();
  });

  it('keeps the line count at one for a pane with no lines', () => {
    const set = toySet(['$1', 'A1']);
    const p = { ...projectChannel(set, '1')!, segments: [], lineCount: 1 };
    expect(projectedLines(p, linesOf(['$1', 'A1']))).toEqual(['']);
    expect(paneLineOf(p, 1)).toBeNull();
    expect(() => docLineOf(p, 1)).toThrow(RangeError);
  });

  it('joins the header and a section that starts right below it into one run for edits, not for the segments', () => {
    const p = project(TOY_PROGRAM, '1');
    expect(p.segments).toHaveLength(3);
    // pane 2 (header) to pane 3 (`$1`): one edit, no junction between them
    expect(mapPaneEdits(p, [at(2, 3, 3, 2, '')], (n) => paneOf(TOY_PROGRAM, '1')[n - 1].length + 1)).toEqual([at(2, 3, 3, 2, '')]);
  });

  it('answers the pane line of a document line by binary search over many segments', () => {
    const doc = ['H'];
    for (let i = 0; i < 500; i++) doc.push(i % 2 === 0 ? '$1' : '$2', `L${i}`, `M${i}`);
    const p = project(doc, '2');
    for (let n = 1; n <= p.lineCount; n++) expect(paneLineOf(p, docLineOf(p, n))).toBe(n);
    expect(paneLineOf(p, 2)).toBeNull();
    expect(paneLineOf(p, 0)).toBeNull();
    expect(paneLineOf(p, 100_000)).toBeNull();
  });
});

describe('extra cases: an edit across a junction (rule 3)', () => {
  const doc = ['%', '$1', 'A1', '$2', 'B1', 'B2', '$1', 'A2', '$2', 'B3', '$1', 'A3', 'A4'];
  // channel 1: pane 1 `%` | 2 `$1` | 3 `A1` | 4 `$1` | 5 `A2` | 6 `$1` | 7 `A3` | 8 `A4`; doc 1–3, 7–8, 11–13
  const pane = paneOf(doc, '1');
  const p = project(doc, '1');
  const maxColumn = (n: number) => pane[n - 1].length + 1;

  it('keeps the break when the edit would glue its text to another channel’s line', () => {
    expect(pane).toEqual(['%', '$1', 'A1', '$1', 'A2', '$1', 'A3', 'A4']);
    // Delete from inside `A1` to the start of the next range: nothing of channel 2 changes.
    expect(mapPaneEdits(p, [at(3, 2, 4, 1, '')], maxColumn)).toEqual([at(3, 2, 3, 3, '')]);
    // The same with text that ends in a line break: the break at the junction is replaced.
    expect(mapPaneEdits(p, [at(3, 1, 4, 1, 'X\n')], maxColumn)).toEqual([at(3, 1, 4, 1, 'X\n')]);
    // Without a line break at the end of the text the line stays a line of its own.
    expect(mapPaneEdits(p, [at(3, 1, 4, 1, 'X')], maxColumn)).toEqual([at(3, 1, 3, 3, 'X')]);
  });

  it('deletes a range it covers as whole lines, and the head of the range it ends in', () => {
    // From the end of `A1` (pane 3) to column 2 of `A3` (pane 7): covers the whole range 4–5 (document 7–8),
    // and ends in the range 6–8 (document 11–13) after its first line and the `A` of `A3`.
    const mapped = mapPaneEdits(p, [at(3, 3, 7, 2, '')], maxColumn);
    expect(mapped).toEqual([at(7, 1, 9, 1, ''), at(11, 1, 12, 2, '')]);
    const next = applyEdits(doc, mapped);
    expect(next.filter((l) => l.startsWith('B'))).toEqual(['B1', 'B2', 'B3']);
  });

  it('covers a whole range and stops at the start of the next one', () => {
    const mapped = mapPaneEdits(p, [at(4, 1, 6, 1, '')], maxColumn);
    expect(mapped).toEqual([at(7, 1, 9, 1, '')]);
    expect(paneOf(applyEdits(doc, mapped), '2')).toEqual(paneOf(doc, '2'));
  });

  it('makes no edit for the break at a junction deleted alone', () => {
    expect(mapPaneEdits(p, [at(3, 3, 4, 1, '')], maxColumn)).toEqual([]);
  });

  it('maps edits of one event in any order, ascending', () => {
    const a = at(3, 1, 3, 1, 'a');
    const b = at(5, 1, 5, 1, 'b');
    const c = at(8, 3, 8, 3, 'c');
    expect(mapPaneEdits(p, [c, a, b], maxColumn)).toEqual([at(3, 1, 3, 1, 'a'), at(8, 1, 8, 1, 'b'), at(13, 3, 13, 3, 'c')]);
  });

  it('refuses a line outside the pane', () => {
    expect(() => mapPaneEdits(p, [at(9, 1, 9, 1, 'x')], maxColumn)).toThrow(RangeError);
  });

  it('never changes a line of another channel, for random edits across junctions', () => {
    const rnd = lcg(99);
    let program = [...doc, ...Array.from({ length: 30 }, (_, i) => (i % 5 === 0 ? (i % 10 === 0 ? '$2' : '$1') : `${i % 10 < 5 ? 'B' : 'A'}${i}`))];
    for (let round = 0; round < 400; round++) {
      const channel = '1';
      const proj = projectChannel(toySet(program), channel);
      if (proj === null) {
        program = [...doc];
        continue;
      }
      const current = projectedLines(proj, linesOf(program));
      const l1 = 1 + Math.floor(rnd() * current.length);
      const starts = proj.segments.map((sg) => sg.paneStart).filter((n) => n > l1);
      const toStart = starts.length > 0 && rnd() < 0.5; // half of the edits end at column 1 of a later range
      const l2 = toStart ? starts[Math.floor(rnd() * starts.length)] : Math.min(current.length, l1 + Math.floor(rnd() * 6));
      const c1 = rnd() < 0.3 ? 1 : 1 + Math.floor(rnd() * (current[l1 - 1].length + 1));
      const c2 = toStart ? 1 : 1 + Math.floor(rnd() * (current[l2 - 1].length + 1));
      if (l1 === l2 && c2 < c1) continue;
      const text = rnd() < 0.3 ? '' : rnd() < 0.5 ? `w${round}` : rnd() < 0.5 ? `w${round}\n` : `\nN${round}`;
      const mapped = mapPaneEdits(proj, [at(l1, c1, l2, c2, text)], (n) => current[n - 1].length + 1);
      for (let k = 1; k < mapped.length; k++) {
        const prev = mapped[k - 1].range;
        const now = mapped[k].range;
        expect(prev.endLineNumber < now.startLineNumber || (prev.endLineNumber === now.startLineNumber && prev.endColumn <= now.startColumn), `round ${round} order`).toBe(true);
      }
      const next = applyEdits(program, mapped);
      // The lines the pane does not show (channel 2's lines and its section marks) are all still
      // there, whole and in the same order.
      const shown = new Set(proj.segments.flatMap((sg) => Array.from({ length: sg.length }, (_, i) => sg.docStart + i)));
      const hiddenBefore = program.filter((_, i) => !shown.has(i + 1));
      let kept = 0;
      for (const l of next) if (l === hiddenBefore[kept]) kept++;
      expect(kept, `round ${round}: the other channel's lines kept`).toBe(hiddenBefore.length);
      program = next;
    }
  });
});

describe('extra cases: re-projection', () => {
  const apply = (oldPane: string[], edits: TextEdit[]) => applyEdits(oldPane, edits);

  it('changes only the lines that changed', () => {
    const doc = applyEdits(TOY_PROGRAM, [at(4, 3, 4, 3, 'X')]);
    const edits = reprojectEdits(project(TOY_PROGRAM, '1'), project(doc, '1'), { oldPaneLines: linesOf(paneOf(TOY_PROGRAM, '1')), docLines: linesOf(doc) });
    expect(edits).toEqual([at(4, 1, 4, 3, 'A1X')]);
  });

  it('inserts, deletes and replaces as lines, once each', () => {
    const base = ['%', '$1', ...Array.from({ length: 20 }, (_, i) => `A${i}`)];
    const old = paneOf(base, '1');
    const cases: string[][] = [
      [...base.slice(0, 10), 'NEW', ...base.slice(10)],
      [...base.slice(0, 10), ...base.slice(12)],
      [...base.slice(0, 10), 'X1', 'X2', ...base.slice(13)],
      [...base, 'LAST'],
      [...base.slice(0, -2)],
      [...base.slice(0, 5), 'Q', ...base.slice(6, 15), 'R', ...base.slice(15)],
    ];
    const counts = [1, 1, 1, 1, 1, 2];
    cases.forEach((next, i) => {
      const edits = reprojectEdits(project(base, '1'), project(next, '1'), { oldPaneLines: linesOf(old), docLines: linesOf(next) });
      expect(edits.length, `case ${i}`).toBe(counts[i]);
      expect(apply(old, edits), `case ${i}`).toEqual(paneOf(next, '1'));
    });
  });

  it('moves lines between panes when a section start is typed or deleted', () => {
    const doc = ['H', '$1', 'A1', 'A2', 'A3', '$2', 'B1'];
    const next = applyEdits(doc, [at(4, 1, 4, 1, '$2\n')]); // A2, A3 now belong to channel 2
    for (const channel of ['1', '2']) {
      const old = paneOf(doc, channel);
      const edits = reprojectEdits(project(doc, channel), project(next, channel), { oldPaneLines: linesOf(old), docLines: linesOf(next) });
      expect(apply(old, edits), channel).toEqual(paneOf(next, channel));
    }
  });

  it('gives the same edits with the document’s change as a hint, for random edits', () => {
    const rnd = lcg(5);
    let doc = [...TOY_PROGRAM, ...Array.from({ length: 60 }, (_, i) => (i % 9 === 0 ? `$${1 + (i % 2)}` : `L${i}`))];
    for (let round = 0; round < 500; round++) {
      const line = 1 + Math.floor(rnd() * doc.length);
      const r = rnd();
      const edits: TextEdit[] = [];
      if (r < 0.25) edits.push(at(line, 1, line, 1, `ins${round}\n`));
      else if (r < 0.4 && line < doc.length) edits.push(at(line, 1, line + 1, 1, ''));
      else if (r < 0.5) edits.push(at(line, 1, line, 1, `$${1 + Math.floor(rnd() * 3)}\n`));
      else if (r < 0.6 && line + 2 <= doc.length) edits.push(at(line, 2, line + 2, 1, 'Z'));
      else if (r < 0.7 && doc.length > 4) {
        // two changes of one event, in document coordinates before the event
        const second = Math.min(doc.length, line + 3);
        if (second > line) edits.push(at(line, 1, line, 1, `a${round}\nb\n`), at(second, 1, second, 2, ''));
      } else edits.push(at(line, 1, line, doc[line - 1].length + 1, `T${round}`));
      if (edits.length === 0) continue;
      const next = applyEdits(doc, edits);
      const changed = changeHull(edits);
      for (const channel of ['1', '2', '3']) {
        const before = projectChannel(toySet(doc), channel);
        const after = projectChannel(toySet(next), channel);
        if (before === null || after === null) continue;
        const oldPane = projectedLines(before, linesOf(doc));
        const plain = reprojectEdits(before, after, { oldPaneLines: linesOf(oldPane), docLines: linesOf(next) });
        const hinted = reprojectEdits(before, after, { oldPaneLines: linesOf(oldPane), docLines: linesOf(next), changed });
        expect(apply(oldPane, hinted), `round ${round}, channel ${channel}`).toEqual(projectedLines(after, linesOf(next)));
        expect(apply(oldPane, plain), `round ${round}, channel ${channel}`).toEqual(projectedLines(after, linesOf(next)));
      }
      doc = next;
    }
  });

  it('describes the hull of an event’s changes', () => {
    expect(changeHull([at(5, 2, 5, 4, 'x')])).toEqual({ from: 5, oldTo: 5, newTo: 5 });
    expect(changeHull([at(5, 2, 7, 1, 'a\nb\nc')])).toEqual({ from: 5, oldTo: 7, newTo: 7 });
    expect(changeHull([at(3, 1, 3, 1, 'a\n'), at(9, 1, 10, 1, '')])).toEqual({ from: 3, oldTo: 10, newTo: 10 });
  });
});

describe('extra cases: the marks of a pane', () => {
  it('maps a channel’s marks from document lines to pane lines', () => {
    const p = project(TOY_PROGRAM, '1');
    const marks = [wait('1', 9, 'M901', '12'), wait('2', 7, 'M901', '12'), wait('1', 4, 'M902', '12'), wait('1', 7, 'M903', '12')];
    expect(marksInPane(p, marks).map((m) => [m.mark, m.line])).toEqual([['M902', 4], ['M901', 7]]);
  });
});

describe('extra cases: alignment', () => {
  const rules: SyncRule[] = [
    { id: 'w', label: 'Waits', match: { kind: 'codes', codes: 'M900-M999' }, partners: { kind: 'word', address: 'P', decode: 'digits' }, samePartners: true },
    { id: 'o', label: 'Order', semantics: 'ordered', match: { kind: 'prefix', prefix: 'P' }, partners: { kind: 'all' } },
    { id: 'c', label: 'Count', semantics: 'count', match: { kind: 'codes', codes: 'M100' }, partners: { kind: 'all' } },
  ];
  const [c1, c2, c3, c4] = TOY_CHANNELS;
  const pane = (channel: typeof c1, marks: ReturnType<typeof wait>[], lineCount = 10) => ({ channel, lineCount, marks });

  it('reads a code by value and sorts the channel set by value', () => {
    expect(waitKey(wait('1', 1, 'M0901', '12'))).toBe(waitKey(wait('2', 9, 'M901', '12')));
    expect(waitKey(wait('1', 1, 'M901', '12'))).not.toBe(waitKey(wait('1', 1, 'M902', '12')));
    expect(waitKey(wait('1', 1, 'M901', '12'))).not.toBe(waitKey(wait('1', 1, 'M901', '12', { ruleId: 'x' })));
    expect(waitKey(wait('1', 1, 'M901', '21'))).toBe(waitKey(wait('2', 1, 'M901', '1')));
    // 10 sorts after 9, as a number
    expect(waitKey({ ...wait('1', 1, 'M901', ''), partners: ['10', '9', '2'] })).toBe(waitKey({ ...wait('9', 1, 'M901', ''), partners: ['2', '10', '1'] }));
    expect(waitKey(wait('1', 1, '', '12', { ruleId: 'c' }))).toBe(waitKey(wait('2', 1, '', '12', { ruleId: 'c' })));
  });

  it('lines up two separate pairs in four panes (M901 P12 and M902 P34)', () => {
    const a = alignPanes(
      [
        pane(c1, [wait('1', 3, 'M901', '12')]),
        pane(c2, [wait('2', 6, 'M901', '12')]),
        pane(c3, [wait('3', 2, 'M902', '34')]),
        pane(c4, [wait('4', 8, 'M902', '34')]),
      ],
      rules,
    );
    expect(a.groups).toEqual([
      { marks: [{ pane: 0, line: 3 }, { pane: 1, line: 6 }] },
      { marks: [{ pane: 2, line: 2 }, { pane: 3, line: 8 }] },
    ]);
    expect(a.states).toEqual([['matched'], ['matched'], ['matched'], ['matched']]);
    // Rows to each mark: 3 → 6 (pane 0 +3), 2 → 8 (pane 2 +6); heights 13, 10, 16, 10; trailing up to 16.
    expect(a.zones).toEqual([
      { pane: 0, afterLine: 2, lines: 3 },
      { pane: 0, afterLine: 10, lines: 3 },
      { pane: 1, afterLine: 10, lines: 6 },
      { pane: 2, afterLine: 1, lines: 6 },
      { pane: 3, afterLine: 10, lines: 6 },
    ]);
  });

  it('marks a wait that names only its own channel as unmatched, and one whose partner is not shown as none', () => {
    const lone = alignPanes([pane(c1, [wait('1', 3, 'M901', '')]), pane(c2, [])], rules);
    expect(lone.states).toEqual([['unmatched'], []]);
    const away = alignPanes([pane(c1, [wait('1', 3, 'M901', '19')]), pane(c2, [])], rules);
    expect(away.states).toEqual([['none'], []]);
  });

  it('marks every mark of an occurrence unmatched when a shown channel it names lacks it', () => {
    const a = alignPanes([pane(c1, [wait('1', 3, 'M910', '123')]), pane(c2, [wait('2', 3, 'M910', '123')]), pane(c3, [])], rules);
    expect(a.states).toEqual([['unmatched'], ['unmatched'], []]);
    expect(a.groups).toEqual([]);
  });

  it('pairs a count rule by order and number', () => {
    const a = alignPanes(
      [pane(c1, [wait('1', 2, '', '12', { ruleId: 'c' }), wait('1', 6, '', '12', { ruleId: 'c' })]), pane(c2, [wait('2', 4, '', '12', { ruleId: 'c' })])],
      rules,
    );
    expect(a.states).toEqual([['matched', 'unmatched'], ['matched']]);
  });

  it('keeps the longest run in the same order in two panes and drops the rest, the same every time (NC-5)', () => {
    const marks = (...codes: [number, string][]) => codes.map(([line, code]) => wait('1', line, code, '12'));
    const input = () => [
      pane(c1, marks([2, 'M901'], [4, 'M902'], [6, 'M903'])),
      pane(c2, [wait('2', 2, 'M903', '12'), wait('2', 4, 'M901', '12'), wait('2', 6, 'M902', '12')]),
    ];
    const a = alignPanes(input(), rules);
    // M901, M902 are in the same order in both; only M903 crosses them (as Check Wait Codes says).
    expect(a.states).toEqual([['matched', 'matched', 'unmatched'], ['unmatched', 'matched', 'matched']]);
    expect(a.reasons[0][2]).toEqual({ kind: 'crossing' });
    expect(alignPanes(input(), rules)).toEqual(a);
  });

  it('lines up an ordered number wherever two panes have it and leaves the others alone', () => {
    const o = (channel: string, line: number, mark: string) => wait(channel, line, mark, '123', { ruleId: 'o' });
    const a = alignPanes([pane(c1, [o('1', 2, '10'), o('1', 5, '30')]), pane(c2, [o('2', 3, '10')]), pane(c3, [o('3', 4, '30'), o('3', 8, '40')])], rules);
    expect(a.states).toEqual([['matched', 'matched'], ['matched'], ['matched', 'none']]);
    expect(a.groups).toEqual([
      { marks: [{ pane: 0, line: 2 }, { pane: 1, line: 3 }] },
      { marks: [{ pane: 0, line: 5 }, { pane: 2, line: 4 }] },
    ]);
  });

  it('holds for random marks: members of a group meet at one row, groups keep the order, heights are equal', () => {
    const rnd = lcg(2026);
    for (let round = 0; round < 300; round++) {
      const channels = [c1, c2, c3, c4].slice(0, 2 + Math.floor(rnd() * 3));
      const panes = channels.map((channel) => {
        const lineCount = 5 + Math.floor(rnd() * 40);
        const lines = new Set<number>();
        for (let k = Math.floor(rnd() * 8); k > 0; k--) lines.add(1 + Math.floor(rnd() * lineCount));
        const marks = [...lines]
          .sort((a, b) => a - b)
          .map((line) => {
            const code = `M9${Math.floor(rnd() * 3)}0`;
            const named = channels.filter((c) => c === channel || rnd() < 0.7).map((c) => c.id).join('');
            return wait(channel.id, line, code, named, { blocking: rnd() < 0.9 });
          });
        return pane(channel, marks, lineCount);
      });
      const a = alignPanes(panes, rules);
      expect(alignPanes(panes, rules)).toEqual(a);
      const rowOf = (paneIndex: number, line: number): number =>
        line + a.zones.filter((z) => z.pane === paneIndex && z.afterLine < line).reduce((sum, z) => sum + z.lines, 0);
      const last = panes.map(() => 0);
      for (const g of a.groups) {
        expect(g.marks.length, `round ${round}`).toBeGreaterThanOrEqual(2);
        const rows = g.marks.map((m) => rowOf(m.pane, m.line));
        expect(new Set(rows).size, `round ${round} rows ${rows}`).toBe(1);
        for (const m of g.marks) {
          expect(m.line, `round ${round} order`).toBeGreaterThanOrEqual(last[m.pane]);
          last[m.pane] = m.line;
        }
      }
      const heights = panes.map((p, i) => p.lineCount + a.zones.filter((z) => z.pane === i).reduce((sum, z) => sum + z.lines, 0));
      expect(new Set(heights).size, `round ${round} heights`).toBe(1);
      const matched = panes.flatMap((_, i) => a.states[i].filter((s) => s === 'matched')).length;
      expect(matched).toBe(a.groups.reduce((n, g) => n + g.marks.length, 0));
      const keys = new Set(a.zones.map((z) => `${z.pane}:${z.afterLine}`));
      expect(keys.size).toBe(a.zones.length);
      panes.forEach((p, i) => p.marks.forEach((m, j) => { if (!m.blocking) expect(a.states[i][j]).toBe('none'); }));
    }
  });
});

// ---------------------------------------------------------------------------
// The P4e review fixes (FB1): one regression test per finding, each failing without its fix.
// The programs are synthetic, written for gEdit; the presets are the ones gEdit ships.
// ---------------------------------------------------------------------------

function presetOf(profile: string, id: string): ChannelParams {
  const found = profileOf(profile).machineParams?.channels?.presets.find((x) => x.id === id);
  if (!found) throw new Error(`${profile}: no preset ${id}`);
  return JSON.parse(JSON.stringify(found.value)) as ChannelParams;
}

/** A program with sections, read with a preset as `channels.fresh` reads it. */
function presetSet(profile: string, params: ChannelParams, lines: readonly string[]): ChannelSet {
  const r = resolveDocument('x', lines, cpOf(profile), params, {});
  if (r.layout === 'none') return { layout: 'none', self: null, members: [], missing: [], outside: [], marks: [], problems: r.problems, truncated: false };
  return {
    layout: 'single-file',
    self: null,
    missing: [],
    marks: r.marks,
    problems: r.problems,
    truncated: false,
    outside: r.outside,
    members: r.sections.map((sc) => ({ kind: 'section' as const, channel: sc.channel, docId: 'p', ranges: sc.ranges })),
  };
}

/** The panes of one file per channel, each read with the preset (as `alignPanes` gets them in the view). */
function filePanes(profile: string, params: ChannelParams, files: Record<string, string[]>) {
  const cp = cpOf(profile);
  const per: Record<string, SyncHit[]> = {};
  const panes = Object.entries(files).map(([channel, lines], index) => {
    per[channel] = resolveDocument('x', lines, cp, params, { assigned: channel }).marks;
    return { channel: { id: channel, name: `C${channel}`, index }, lineCount: lines.length, marks: per[channel] };
  });
  return { panes, per };
}

describe('P4e NC-2: a pane edit never moves lines to another channel', () => {
  /** Maps a pane edit of channel `ch`, applies it, and asks the guard. */
  function paneEdit(lines: readonly string[], setOf: (l: readonly string[]) => ChannelSet, ch: string, e: TextEdit) {
    const before = setOf(lines);
    const proj = projectChannel(before, ch)!;
    const pane = projectedLines(proj, linesOf(lines));
    const mapped = mapPaneEdits(proj, [e], (n) => pane[n - 1].length + 1, lines.length);
    const doc = applyEdits(lines, mapped);
    const after = setOf(doc);
    return { mapped, doc, after, verdict: paneEditMovesLines(before, after, mapped), pane: applyEdits(pane, [e]) };
  }
  const panesOf = (set: ChannelSet, doc: readonly string[]) =>
    Object.fromEntries(set.members.map((m) => [m.channel.id, projectedLines(projectChannel(set, m.channel.id)!, linesOf(doc))]));

  it('puts a line pasted or typed at column 1 of a section start at the end of the range above, in the same channel (toy set)', () => {
    // Pane 1 line 6 is the second `$1` (document line 8); the range above ends with `A2` (document 5).
    const pasted = paneEdit(TOY_PROGRAM, toySet, '1', at(6, 1, 6, 1, 'X9\n'));
    expect(pasted.mapped).toEqual([at(5, 3, 5, 3, '\nX9')]);
    expect(panesOf(pasted.after, pasted.doc)).toEqual({ '1': ['%', 'O1000', '$1', 'A1', 'A2', 'X9', '$1', 'A3'], '2': paneOf(TOY_PROGRAM, '2') });
    expect(pasted.verdict).toEqual({ moves: false });
    const enter = paneEdit(TOY_PROGRAM, toySet, '1', at(6, 1, 6, 1, '\n'));
    expect(enter.mapped).toEqual([at(5, 3, 5, 3, '\n')]);
    expect(panesOf(enter.after, enter.doc)['1']).toEqual(enter.pane);
    expect(panesOf(enter.after, enter.doc)['2']).toEqual(paneOf(TOY_PROGRAM, '2'));
    // Two lines pasted: both stay.
    const two = paneEdit(TOY_PROGRAM, toySet, '1', at(6, 1, 6, 1, 'X1\nX2\n'));
    expect(panesOf(two.after, two.doc)['1']).toEqual(two.pane);
    expect(two.verdict).toEqual({ moves: false });
  });

  it('does the same on the Okuma two-turret preset (G13/G14)', () => {
    const params = presetOf('okuma-osp', 'okuma-2turret');
    const setOf = (l: readonly string[]) => presetSet('okuma-osp', params, l);
    const doc = ['$PART.MIN%', 'O1000', 'G13', 'N1 G0 X100 Z5', 'N2 G1 Z-10 F0.2', 'G14', 'N1 G0 X50 Z5', 'G13', 'N3 G1 X80', 'G14', 'N2 G1 Z-20', 'M02'];
    const before = panesOf(setOf(doc), doc);
    expect(before.a[5]).toBe('G13'); // pane line 6 is the second G13
    for (const text of ['N9 G1 X1\n', '\n']) {
      const r = paneEdit(doc, setOf, 'a', at(6, 1, 6, 1, text));
      const after = panesOf(r.after, r.doc);
      expect(after.a, JSON.stringify(text)).toEqual(r.pane);
      expect(after.b, JSON.stringify(text)).toEqual(before.b);
      expect(r.verdict).toEqual({ moves: false });
    }
  });

  it('refuses typing in front of a section start and deleting one with lines after it', () => {
    const params = presetOf('okuma-osp', 'okuma-2turret');
    const setOf = (l: readonly string[]) => presetSet('okuma-osp', params, l);
    const doc = ['$PART.MIN%', 'O1000', 'G13', 'N1 G0 X100 Z5', 'N2 G1 Z-10 F0.2', 'G14', 'N1 G0 X50 Z5', 'G13', 'N3 G1 X80', 'G14', 'N2 G1 Z-20', 'M02'];
    // `N` typed at column 1 of the second G13: `NG13` starts nothing, `N3 G1 X80` would go to turret B.
    expect(paneEdit(doc, setOf, 'a', at(6, 1, 6, 1, 'N')).verdict).toMatchObject({ moves: true, channels: ['a', 'b'] });
    // `N2 …` and `G13` deleted from turret A's pane: `N3 G1 X80` would go to turret B.
    expect(paneEdit(doc, setOf, 'a', at(5, 1, 7, 1, '')).verdict).toMatchObject({ moves: true });
    // A line inserted at column 1 of the first section start would become a header line (every turret's).
    expect(paneEdit(doc, setOf, 'a', at(3, 1, 3, 1, 'N9 G1 X1\n')).verdict).toMatchObject({ moves: true, channels: ['a'] });
    // A section start of the other turret typed into the pane.
    expect(paneEdit(doc, setOf, 'a', at(4, 1, 4, 1, 'G14\n')).verdict).toMatchObject({ moves: true });
  });

  // Owner's answer of 2026-10-17: a code that ends a section typed mid-section, and a new line after a
  // section's last line (it would fall outside every channel), are refused like a moved section start.
  describe('a section end (the machine page’s "section end")', () => {
    const base = presetOf('okuma-osp', 'okuma-2turret');
    const params: ChannelParams = { ...base, sectionEnd: '(?<![A-Z0-9])M02(?!\\d)' };
    const setOf = (l: readonly string[]) => presetSet('okuma-osp', params, l);
    // Turret A: lines 3–5 and 8–9; turret B: 6–7 and 10–12 (`M02` ends it); nothing is outside but the header.
    const doc = ['$PART.MIN%', 'O1000', 'G13', 'N1 G0 X100 Z5', 'N2 G1 Z-10 F0.2', 'G14', 'N1 G0 X50 Z5', 'G13', 'N3 G1 X80', 'G14', 'N2 G1 Z-20', 'M02'];
    // Turret A with an end code in its second range: lines after `M02` up to the next start are outside every channel.
    const withTail = ['$PART.MIN%', 'O1000', 'G13', 'N1 G0 X100 Z5', 'M02', 'N9 (TAIL)', 'G14', 'N1 G0 X50 Z5', 'M02'];

    it('reads the end line as the last line of its section and the lines after it as outside every channel', () => {
      const set = setOf(withTail);
      expect(set.members.map((m) => [m.channel.id, m.kind === 'section' ? m.ranges : null])).toEqual([
        ['a', [{ startLine: 3, endLine: 5 }]],
        ['b', [{ startLine: 7, endLine: 9 }]],
      ]);
      expect(set.outside).toEqual([
        { startLine: 1, endLine: 2 },
        { startLine: 6, endLine: 6 },
      ]);
    });

    it('refuses the end code typed in the middle of a section (a new line, over a line, at the end of a line)', () => {
      for (const e of [at(4, 14, 4, 14, '\nM02'), at(4, 1, 4, 14, 'M02'), at(4, 14, 4, 14, ' M02'), at(5, 1, 5, 1, 'M02\n')]) {
        const r = paneEdit(doc, setOf, 'a', e);
        expect(r.verdict, JSON.stringify(e)).toMatchObject({ moves: true });
      }
    });

    it('refuses Enter and a pasted line after the last line of a section that has an end line', () => {
      // Turret A (withTail): pane line 5 is `M02`, its end line.
      for (const text of ['\n', '\nX9', '\nX8\nX9']) {
        const r = paneEdit(withTail, setOf, 'a', at(5, 4, 5, 4, text));
        expect(r.verdict, JSON.stringify(text)).toMatchObject({ moves: true, channels: ['a'] });
      }
      // The last section of the program: pane line 7 of turret B is `M02` (document line 12).
      expect(paneEdit(doc, setOf, 'b', at(7, 4, 7, 4, '\n')).verdict).toMatchObject({ moves: true, channels: ['b'] });
    });

    it('allows an ordinary Enter in the middle of a section and just in front of the end line (control)', () => {
      for (const e of [at(4, 14, 4, 14, '\n'), at(4, 14, 4, 14, '\nN1b G1 X1')]) {
        const r = paneEdit(withTail, setOf, 'a', e);
        expect(r.verdict, JSON.stringify(e)).toEqual({ moves: false });
        expect(panesOf(r.after, r.doc).a).toEqual(r.pane);
        expect(panesOf(r.after, r.doc).b).toEqual(panesOf(setOf(withTail), withTail).b);
      }
    });

    it('allows Enter after the last line of a section that has no end line (it stays in the channel)', () => {
      const plain = presetSet('okuma-osp', base, doc);
      const r = paneEdit(doc, (l) => presetSet('okuma-osp', base, l), 'b', at(7, 4, 7, 4, '\n'));
      expect(plain.members.length).toBe(2);
      expect(r.verdict).toEqual({ moves: false });
      expect(panesOf(r.after, r.doc).b).toEqual(r.pane);
    });
  });

  it('allows deleting a whole range, editing a section start that stays one, and editing the header', () => {
    const doc = [...TOY_PROGRAM, '$1', 'A4', '$2', 'B3'];
    // Pane 1: % O1000 $1 A1 A2 | $1 A3 | $1 A4 (document 1–5, 8–9, 12–13).
    expect(paneOf(doc, '1')).toEqual(['%', 'O1000', '$1', 'A1', 'A2', '$1', 'A3', '$1', 'A4']);
    // The middle range, deleted as lines 6–7 (Delete Line: column 1 to column 1).
    const middle = paneEdit(doc, toySet, '1', at(6, 1, 8, 1, ''));
    expect(middle.verdict).toEqual({ moves: false });
    expect(panesOf(middle.after, middle.doc)['1']).toEqual(middle.pane);
    // The last range, deleted from the end of the line above to the end of the pane.
    const last = paneEdit(doc, toySet, '1', at(7, 3, 9, 3, ''));
    expect(last.mapped).toEqual([at(12, 1, 14, 1, '')]);
    expect(last.verdict).toEqual({ moves: false });
    expect(panesOf(last.after, last.doc)).toEqual({ '1': last.pane, '2': paneOf(doc, '2') });
    expect(paneEdit(doc, toySet, '1', at(6, 3, 6, 3, '')).verdict).toEqual({ moves: false });
    expect(paneEdit(doc, toySet, '1', at(2, 2, 2, 6, '2000')).verdict).toEqual({ moves: false });
    expect(paneEdit(doc, toySet, '1', at(2, 6, 2, 6, '\n(NEW)')).verdict).toEqual({ moves: false });
    expect(paneEdit(doc, toySet, '1', at(4, 3, 4, 3, '\nA1b\nA1c')).verdict).toEqual({ moves: false });
  });

  it('refuses every edit that changes another channel’s lines and allows the others, for random edits', () => {
    const rnd = lcg(4242);
    const pieces = ['$1', '$2', 'A', '', '\n', 'x\n', '\n$1', '$2\n', 'Q'];
    let doc = [...TOY_PROGRAM, '$1', 'A4', 'A5', '$2', 'B3', '$1', 'A6'];
    let refused = 0;
    for (let round = 0; round < 400; round++) {
      const ch = rnd() < 0.5 ? '1' : '2';
      const proj = projectChannel(toySet(doc), ch);
      if (proj === null) {
        doc = [...TOY_PROGRAM];
        continue;
      }
      const pane = projectedLines(proj, linesOf(doc));
      const l1 = 1 + Math.floor(rnd() * pane.length);
      const l2 = Math.min(pane.length, l1 + Math.floor(rnd() * 3));
      const c1 = rnd() < 0.5 ? 1 : 1 + Math.floor(rnd() * (pane[l1 - 1].length + 1));
      const c2 = rnd() < 0.5 && l2 > l1 ? 1 : 1 + Math.floor(rnd() * (pane[l2 - 1].length + 1));
      if (l1 === l2 && c2 < c1) continue;
      const r = paneEdit(doc, toySet, ch, at(l1, c1, l2, c2, pieces[Math.floor(rnd() * pieces.length)]));
      const other = ch === '1' ? '2' : '1';
      const otherProj = projectChannel(r.after, other);
      const body = (lines: string[] | null, set: ChannelSet) => (lines === null ? null : lines.slice(set.outside.find((x) => x.startLine === 1)?.endLine ?? 0));
      const otherBefore = body(paneOf(doc, other), toySet(doc));
      const otherAfter = otherProj === null ? null : body(projectedLines(otherProj, linesOf(r.doc)), r.after);
      if (!r.verdict.moves) {
        // Allowed: the other channel's own lines are exactly what they were.
        expect(otherAfter, `round ${round}`).toEqual(otherBefore);
        doc = r.doc;
      } else refused++;
    }
    expect(refused).toBeGreaterThan(20);
  });

  it('says that every line moves when the edit leaves no section at all', () => {
    const doc = ['%', '$1', 'A1'];
    const r = paneEdit(doc, toySet, '1', at(2, 1, 2, 3, 'X'));
    expect(r.after.members).toEqual([]);
    expect(r.verdict).toMatchObject({ moves: true, channels: ['1'] });
  });
});

describe('P4e NC-3: a Fanuc wait without P never meets one with P', () => {
  const params = presetOf('fanuc-lathe', 'fanuc-2path');
  it('marks M901 against M901 P3 unmatched, as Check Wait Codes reports it', () => {
    const { panes, per } = filePanes('fanuc-lathe', params, { '1': ['G0 X0', 'M901', 'M30'], '2': ['G0 X0', 'M901 P3', 'M30'] });
    expect(per['1'][0].absent).toBe(true);
    const a = alignPanes(panes, params.syncMarks);
    expect(a.states).toEqual([['unmatched'], ['unmatched']]);
    expect(checkSyncMarks(per, params).map((f) => f.kind)).toContain('partners-differ');
  });
  it('lines up M901 with M901, and M901 P3 with M901 P3', () => {
    for (const [one, two] of [['M901', 'M901'], ['M901 P3', 'M901 P3']]) {
      const { panes } = filePanes('fanuc-lathe', params, { '1': ['G0 X0', one, 'M30'], '2': ['G0 X0', two, 'M30'] });
      expect(alignPanes(panes, params.syncMarks).states, one).toEqual([['matched'], ['matched']]);
    }
  });
  it('keys the P-less wait apart only for a samePartners rule', () => {
    const rule = params.syncMarks.find((r) => r.samePartners === true)!;
    const bare = { ...wait('1', 2, 'M901', '12', { ruleId: rule.id }), absent: true as const };
    const written = wait('2', 2, 'M901', '12', { ruleId: rule.id });
    expect(waitKey(bare, rule)).not.toBe(waitKey(written, rule));
    expect(waitKey(bare)).toBe(waitKey(written));
    expect(waitKey(bare, { ...rule, samePartners: false })).toBe(waitKey(written, { ...rule, samePartners: false }));
  });
});

describe('P4e NC-4: Siemens WAITM lists pair channel by channel; the owner’s same-P rule stays for P words', () => {
  const three = (): ChannelParams => {
    const p = presetOf('sinumerik', 'sinumerik-2channel');
    p.list.push({ id: '3', name: 'Channel 3' });
    return p;
  };
  it('lines up WAITM(1,1,2,3), WAITM(1,1,2) and WAITM(1,1,3) as one wait (legal lists that differ)', () => {
    const p = three();
    const { panes, per } = filePanes('sinumerik', p, {
      '1': ['G0 X0', 'WAITM(1,1,2,3)', 'G1 X1', 'M30'],
      '2': ['G0 X0', 'WAITM(1,1,2)', 'M30'],
      '3': ['G0 X0', 'WAITM(1,1,3)', 'M30'],
    });
    expect(checkSyncMarks(per, p)).toEqual([]);
    const a = alignPanes(panes, p.syncMarks);
    expect(a.states).toEqual([['matched'], ['matched'], ['matched']]);
    expect(a.groups).toEqual([{ marks: [{ pane: 0, line: 2 }, { pane: 1, line: 2 }, { pane: 2, line: 2 }] }]);
  });
  it('lets a SETM answer a WAITM: not red', () => {
    const p = presetOf('sinumerik', 'sinumerik-2channel');
    const { panes, per } = filePanes('sinumerik', p, { '1': ['G0 X0', 'WAITM(7,1,2)', 'M30'], '2': ['G0 X0', 'SETM(7)', 'G1 X5', 'M30'] });
    expect(checkSyncMarks(per, p)).toEqual([]);
    const a = alignPanes(panes, p.syncMarks);
    expect(a.states[0]).toEqual(['none']);
    expect(a.reasons[0][0]).toEqual({ kind: 'answered', channels: ['2'] });
  });
  it('still marks a WAITM the other channel never answers, and pairs two-channel waits as before', () => {
    const p = presetOf('sinumerik', 'sinumerik-2channel');
    const lone = filePanes('sinumerik', p, { '1': ['WAITM(3,1,2)', 'M30'], '2': ['WAITM(4,1,2)', 'M30'] });
    expect(alignPanes(lone.panes, p.syncMarks).states).toEqual([['unmatched'], ['unmatched']]);
    const pair = filePanes('sinumerik', p, { '1': ['WAITM(1,1,2)', 'G1 X1', 'WAITM(2,1,2)', 'M30'], '2': ['G0 X0', 'WAITM(1,1,2)', 'WAITM(2,1,2)', 'M30'] });
    const a = alignPanes(pair.panes, p.syncMarks);
    expect(a.states).toEqual([['matched', 'matched'], ['matched', 'matched']]);
    expect(a.groups.map((g) => g.marks.map((m) => m.line))).toEqual([[1, 2], [3, 3]]);
  });
  it('keeps the same-P key for a P-word rule built without samePartners (the owner’s rule)', () => {
    const rules: SyncRule[] = [{ id: 'w', label: 'Waits', match: { kind: 'codes', codes: 'M900-M999' }, partners: { kind: 'word', address: 'P', decode: 'digits' } }];
    const [c1, c2, c3] = TOY_CHANNELS;
    const differ = alignPanes(
      [
        { channel: c1, lineCount: 10, marks: [wait('1', 3, 'M901', '12')] },
        { channel: c2, lineCount: 10, marks: [wait('2', 3, 'M901', '123')] },
        { channel: c3, lineCount: 10, marks: [] },
      ],
      rules,
    );
    expect(differ.states).toEqual([['unmatched'], ['unmatched'], []]);
    const all = alignPanes(
      [c1, c2, c3].map((c, i) => ({ channel: c, lineCount: 10, marks: [wait(c.id, 2 + i, 'M910', '123')] })),
      rules,
    );
    expect(all.groups).toEqual([{ marks: [{ pane: 0, line: 2 }, { pane: 1, line: 3 }, { pane: 2, line: 4 }] }]);
  });
});

describe('P4e NC-5: one misplaced wait costs only itself', () => {
  const rules: SyncRule[] = [{ id: 'w', label: 'w', match: { kind: 'codes', codes: 'M900-M999' }, partners: { kind: 'all' } }];
  const ch1 = [wait('1', 10, 'M901', '12'), wait('1', 20, 'M902', '12'), wait('1', 30, 'M903', '12'), wait('1', 40, 'M909', '12')];
  const ch2 = [wait('2', 5, 'M909', '12'), wait('2', 10, 'M901', '12'), wait('2', 20, 'M902', '12'), wait('2', 30, 'M903', '12')];
  const [c1, c2, c3] = TOY_CHANNELS;
  it('drops only M909, whichever pane comes first', () => {
    const a = alignPanes([{ channel: c1, lineCount: 50, marks: ch1 }, { channel: c2, lineCount: 50, marks: ch2 }], rules);
    expect(a.states).toEqual([['matched', 'matched', 'matched', 'unmatched'], ['unmatched', 'matched', 'matched', 'matched']]);
    const b = alignPanes([{ channel: c2, lineCount: 50, marks: ch2 }, { channel: c1, lineCount: 50, marks: ch1 }], rules);
    expect(b.states).toEqual([['unmatched', 'matched', 'matched', 'matched'], ['matched', 'matched', 'matched', 'unmatched']]);
  });
  it('drops the wait that crosses the most first with three panes', () => {
    const w3 = (ch: string, codes: string[]) => codes.map((code, i) => wait(ch, 10 * (i + 1), code, '123'));
    const a = alignPanes(
      [
        { channel: c1, lineCount: 50, marks: w3('1', ['M901', 'M902', 'M903', 'M909']) },
        { channel: c2, lineCount: 50, marks: w3('2', ['M909', 'M901', 'M902', 'M903']) },
        { channel: c3, lineCount: 50, marks: w3('3', ['M901', 'M902', 'M903', 'M909']) },
      ],
      rules,
    );
    expect(a.states).toEqual([
      ['matched', 'matched', 'matched', 'unmatched'],
      ['unmatched', 'matched', 'matched', 'matched'],
      ['matched', 'matched', 'matched', 'unmatched'],
    ]);
  });
});

describe('P4e NC-10, NC-11, NC-12', () => {
  const digits = presetOf('fanuc-lathe', 'fanuc-2path-digits');
  it('does not judge a count difference of a wait inside a loop (NC-10)', () => {
    const { panes, per } = filePanes('fanuc-lathe', digits, { '1': ['N10 M901 P12', 'G1 X1', 'IF[#1LT3]GOTO10', 'M30'], '2': ['M901 P12', 'M901 P12', 'M901 P12', 'M30'] });
    const jumpLines = { '1': [1, 3] };
    expect(checkSyncMarks(per, digits, { jumpLines }).map((f) => f.kind)).toEqual(['count-not-checked']);
    const a = alignPanes(panes, digits.syncMarks, { jumpLines });
    expect(a.states.flat()).not.toContain('unmatched');
    expect(a.reasons[1][1]).toEqual({ kind: 'loop' });
    // Without the jump lines, as before: the two extra waits have no partner.
    expect(alignPanes(panes, digits.syncMarks).states[1]).toEqual(['matched', 'unmatched', 'unmatched']);
  });
  it('marks a wait naming a path the machine does not have (NC-11)', () => {
    const p = presetOf('fanuc-lathe', 'fanuc-3path-digits');
    const { panes, per } = filePanes('fanuc-lathe', p, { '1': ['M901 P14', 'M30'], '2': ['M30'], '3': ['M30'] });
    expect(checkSyncMarks(per, p).map((f) => f.kind)).toContain('unknown-channel');
    const a = alignPanes(panes, p.syncMarks, { declared: p.list.map((c) => c.id) });
    expect(a.states[0]).toEqual(['unmatched']);
    expect(a.reasons[0][0]).toEqual({ kind: 'unknown', channels: ['4'] });
  });
  it('lines up a line once: a second wait on it whose partner is elsewhere is unmatched (NC-12)', () => {
    const rs = [
      { id: 'p', label: 'p', semantics: 'ordered', match: { kind: 'codes', codes: 'P1-P9999' }, partners: { kind: 'all' } },
      { id: 'm', label: 'm', semantics: 'count', match: { kind: 'codes', codes: 'M100' }, partners: { kind: 'all' } },
    ] as SyncRule[];
    const [c1, c2] = TOY_CHANNELS;
    const A = [wait('1', 5, '10', '12', { ruleId: 'p' }), wait('1', 5, '', '12', { ruleId: 'm' })];
    const B = [wait('2', 3, '10', '12', { ruleId: 'p' }), wait('2', 9, '', '12', { ruleId: 'm' })];
    const a = alignPanes([{ channel: c1, lineCount: 20, marks: A }, { channel: c2, lineCount: 20, marks: B }], rs);
    expect(a.states).toEqual([['matched', 'unmatched'], ['matched', 'unmatched']]);
    expect(a.reasons[0][1]).toEqual({ kind: 'elsewhere' });
    expect(a.groups).toEqual([{ marks: [{ pane: 0, line: 5 }, { pane: 1, line: 3 }] }]);
    // Both waits on one line in each pane: one row, both lined up.
    const same = alignPanes([{ channel: c1, lineCount: 20, marks: A }, { channel: c2, lineCount: 20, marks: [B[0], { ...B[1], line: 3 }] }], rs);
    expect(same.states).toEqual([['matched', 'matched'], ['matched', 'matched']]);
  });
});
