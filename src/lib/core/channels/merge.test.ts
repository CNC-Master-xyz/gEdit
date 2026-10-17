// Merging channel documents back (Phase 4 plan AD-51, §6.7 rule 16; P4.23). The first nine
// rows are the prelude's, now running; the rest are the refusals' corners, the skipped
// documents, shared sections, the renewed record and a random round trip.

import { describe, expect, it } from 'vitest';
import type { ChannelSet } from '$lib/core/channels/types';
import { TOY_CHANNELS, TOY_PROGRAM, lcg, toySet } from './paneFixtures';
import { planMerge, splitRecord, type SplitRecord } from './merge';
import { projectChannel, projectedLines } from './panes';

/** The split of the toy program: channel 1 → document `c1`, channel 2 → document `c2`. */
function split(source: readonly string[] = TOY_PROGRAM): SplitRecord {
  return splitRecord({ sourceId: 'toy', lines: source, set: toySet(source), made: [{ channelId: '1', docId: 'c1' }, { channelId: '2', docId: 'c2' }] });
}

function merge(record: SplitRecord, docs: Record<string, string[] | null>, source: readonly string[] = TOY_PROGRAM) {
  return planMerge({
    record,
    source: { lines: source, set: toySet(source) },
    channelLines: (id) => docs[id] ?? null,
    resolve: (lines) => toySet(lines),
  });
}

const C1 = ['%', 'O1000', '$1', 'A1', 'A2', '$1', 'A3'];
const C2 = ['%', 'O1000', '$2', 'B1', '$2', 'B2'];

describe('the split record (§6.7 rule 16)', () => {
  it('records what the split made: the header and each channel’s projection', () => {
    expect(split()).toEqual({
      sourceId: 'toy',
      header: ['%', 'O1000'],
      channels: [
        { channelId: '1', docId: 'c1', lines: C1 },
        { channelId: '2', docId: 'c2', lines: C2 },
      ],
    });
  });

  it('has an empty header when a section starts at line 1, and leaves out a channel without a section', () => {
    const lines = ['$1', 'A1', '$2', 'B1'];
    const record = splitRecord({ sourceId: 's', lines, set: toySet(lines), made: [{ channelId: '1', docId: 'a' }, { channelId: '3', docId: 'x' }, { channelId: '2', docId: 'b' }] });
    expect(record).toEqual({
      sourceId: 's',
      header: [],
      channels: [
        { channelId: '1', docId: 'a', lines: ['$1', 'A1'] },
        { channelId: '2', docId: 'b', lines: ['$2', 'B1'] },
      ],
    });
  });
});

describe('merging channel documents back (§6.7 rule 16)', () => {
  it('writes an edited line back into its range and leaves the other channel alone', () => {
    const answer = merge(split(), { c1: ['%', 'O1000', '$1', 'A1', 'A2', '$1', 'A3 X5.'], c2: C2 });
    expect(answer).toMatchObject({
      ok: true,
      lines: ['%', 'O1000', '$1', 'A1', 'A2', '$2', 'B1', '$1', 'A3 X5.', '$2', 'B2'],
      merged: ['1'],
      skipped: [{ channelId: '2', reason: 'unchanged' }],
    });
  });

  it('puts a line added at the end of a range into that range, above the other channel', () => {
    const answer = merge(split(), { c1: ['%', 'O1000', '$1', 'A1', 'A2', 'A2b', '$1', 'A3'], c2: C2 });
    expect(answer.ok && answer.lines).toEqual(['%', 'O1000', '$1', 'A1', 'A2', 'A2b', '$2', 'B1', '$1', 'A3', '$2', 'B2']);
  });

  it('puts a line added at the very end of a pane after the last range', () => {
    const answer = merge(split(), { c1: C1, c2: [...C2, 'B3'] });
    expect(answer.ok && answer.lines).toEqual([...TOY_PROGRAM, 'B3']);
  });

  it('merges both channels in one answer', () => {
    const answer = merge(split(), { c1: ['%', 'O1000', '$1', 'A1 X1.', 'A2', '$1', 'A3'], c2: ['%', 'O1000', '$2', 'B1', '$2'] });
    expect(answer.ok && answer.lines).toEqual(['%', 'O1000', '$1', 'A1 X1.', 'A2', '$2', 'B1', '$1', 'A3', '$2']);
    expect(answer.ok && answer.merged).toEqual(['1', '2']);
  });

  it('deletes a line, and keeps a changed line in its own range when a hunk changes size', () => {
    const answer = merge(split(), { c1: ['%', 'O1000', '$1', 'A1', '$1', 'A3'], c2: C2 });
    expect(answer.ok && answer.lines).toEqual(['%', 'O1000', '$1', 'A1', '$2', 'B1', '$1', 'A3', '$2', 'B2']);
    const grown = merge(split(), { c1: ['%', 'O1000', '$1', 'A1a', 'A1b', 'A1c', '$1', 'A3'], c2: C2 });
    // A1 and A2 became three lines: two replace in place, the third follows the second.
    expect(grown.ok && grown.lines).toEqual(['%', 'O1000', '$1', 'A1a', 'A1b', 'A1c', '$2', 'B1', '$1', 'A3', '$2', 'B2']);
  });

  it('skips a closed channel document', () => {
    const answer = merge(split(), { c1: null, c2: ['%', 'O1000', '$2', 'B1 Y2.', '$2', 'B2'] });
    expect(answer.ok && answer.skipped).toEqual([{ channelId: '1', reason: 'closed' }]);
    expect(answer.ok && answer.lines).toEqual(['%', 'O1000', '$1', 'A1', 'A2', '$2', 'B1 Y2.', '$1', 'A3', '$2', 'B2']);
  });

  it('is an answer, not a refusal, when nothing is left to merge', () => {
    const answer = merge(split(), { c1: null, c2: C2 });
    expect(answer).toMatchObject({ ok: true, lines: TOY_PROGRAM, merged: [], skipped: [{ channelId: '1', reason: 'closed' }, { channelId: '2', reason: 'unchanged' }] });
  });

  it('does not look at the program when only unchanged or closed documents are left', () => {
    const edited = TOY_PROGRAM.map((l) => (l === 'A1' ? 'A1 Z0.' : l));
    expect(merge(split(), { c1: null, c2: C2 }, edited)).toMatchObject({ ok: true, merged: [], lines: edited });
  });

  it('refuses when the program changed in the lines of a channel it merges', () => {
    const changed = TOY_PROGRAM.map((l) => (l === 'B1' ? 'B1 Z0.' : l));
    expect(merge(split(), { c1: C1, c2: [...C2.slice(0, 3), 'B1 Y2.', ...C2.slice(4)] }, changed)).toEqual({
      ok: false,
      reason: { key: 'channels.merge.sourceChanged', params: { channel: 'Channel 2' } },
      channelId: '2',
    });
  });

  it('refuses when the program’s header changed, whichever channel is merged', () => {
    const changed = TOY_PROGRAM.map((l) => (l === 'O1000' ? 'O1001' : l));
    expect(merge(split(), { c1: ['%', 'O1000', '$1', 'A1 X1.', 'A2', '$1', 'A3'], c2: C2 }, changed)).toMatchObject({
      ok: false,
      reason: { key: 'channels.merge.sourceChanged', params: { channel: 'Channel 1' } },
      channelId: '1',
    });
  });

  it('refuses when lines were added to the program inside a merged channel', () => {
    const changed = [...TOY_PROGRAM.slice(0, 5), 'A2b', ...TOY_PROGRAM.slice(5)];
    expect(merge(split(), { c1: ['%', 'O1000', '$1', 'A1 X1.', 'A2', '$1', 'A3'], c2: C2 }, changed)).toMatchObject({ ok: false, reason: { key: 'channels.merge.sourceChanged' }, channelId: '1' });
  });

  it('merges a channel even when the program changed in another channel’s lines', () => {
    const changed = TOY_PROGRAM.map((l) => (l === 'A1' ? 'A1 Z0.' : l));
    const answer = merge(split(), { c1: C1, c2: [...C2.slice(0, 3), 'B1 Y2.', ...C2.slice(4)] }, changed);
    expect(answer.ok && answer.lines).toEqual(['%', 'O1000', '$1', 'A1 Z0.', 'A2', '$2', 'B1 Y2.', '$1', 'A3', '$2', 'B2']);
  });

  it('merges a channel at its new place when lines were added above it in the other channel', () => {
    const changed = [...TOY_PROGRAM.slice(0, 5), 'A2b', ...TOY_PROGRAM.slice(5)];
    const answer = merge(split(), { c1: C1.slice(0, 5).concat(['$1', 'A3']), c2: [...C2.slice(0, 3), 'B1 Y2.', ...C2.slice(4)] }, changed);
    expect(answer.ok && answer.lines).toEqual(['%', 'O1000', '$1', 'A1', 'A2', 'A2b', '$2', 'B1 Y2.', '$1', 'A3', '$2', 'B2']);
  });

  it('refuses a changed header (it belongs to every channel)', () => {
    const answer = merge(split(), { c1: C1, c2: ['%', 'O2000', '$2', 'B1', '$2', 'B2'] });
    expect(answer).toMatchObject({ ok: false, reason: { key: 'channels.merge.headerChanged', params: { channel: 'Channel 2' } }, channelId: '2' });
  });

  it('refuses a header that lost a line or has lines added', () => {
    expect(merge(split(), { c1: ['%', '$1', 'A1', 'A2', '$1', 'A3'], c2: C2 })).toMatchObject({ ok: false, reason: { key: 'channels.merge.headerChanged' }, channelId: '1' });
    expect(merge(split(), { c1: ['%', 'O1000', '(NEW)', '$1', 'A1', 'A2', '$1', 'A3'], c2: C2 })).toMatchObject({ ok: false, reason: { key: 'channels.merge.headerChanged' } });
    expect(merge(split(), { c1: [], c2: C2 })).toMatchObject({ ok: false, reason: { key: 'channels.merge.headerChanged' } });
  });

  it('refuses an edit that would move lines into another channel', () => {
    // A section start typed into channel 1's document: merged, `A2` would belong to channel 2.
    const answer = merge(split(), { c1: ['%', 'O1000', '$1', 'A1', '$2', 'A2', '$1', 'A3'], c2: C2 });
    expect(answer).toMatchObject({ ok: false, reason: { key: 'channels.merge.sectionsMoved', params: { channel: 'Channel 1' } }, channelId: '1' });
  });

  it('refuses a deleted section start (the lines would join the channel above)', () => {
    const answer = merge(split(), { c1: ['%', 'O1000', '$1', 'A1', 'A2', 'A3'], c2: C2 });
    expect(answer).toMatchObject({ ok: false, reason: { key: 'channels.merge.sectionsMoved' } });
  });

  it('refuses text added at the top of a pane (it would become part of the header)', () => {
    const lines = ['$1', 'A1', '$2', 'B1'];
    const record = split(lines);
    const answer = planMerge({
      record,
      source: { lines, set: toySet(lines) },
      channelLines: (id) => (id === 'c1' ? ['G90', '$1', 'A1'] : null),
      resolve: (merged) => toySet(merged),
    });
    expect(answer).toMatchObject({ ok: false, reason: { key: 'channels.merge.headerChanged' }, channelId: '1' });
  });

  it('names the channel whose lines moved even when it is the one not merged', () => {
    // Channel 1 gains `$2` at its end: channel 1 reads wrong; with channel 2 merged too the answer still names a merged channel first.
    const answer = merge(split(), { c1: [...C1, '$2', 'X'], c2: C2 });
    expect(answer).toMatchObject({ ok: false, reason: { key: 'channels.merge.sectionsMoved' }, channelId: '1' });
  });

  it('changes nothing in the inputs', () => {
    const record = split();
    const before = JSON.stringify(record);
    const source = [...TOY_PROGRAM];
    const doc = [...C1.slice(0, 6), 'A3 X5.'];
    planMerge({ record, source: { lines: source, set: toySet(source) }, channelLines: (id) => (id === 'c1' ? doc : null), resolve: (l) => toySet(l) });
    expect(JSON.stringify(record)).toBe(before);
    expect(source).toEqual(TOY_PROGRAM);
  });
});

describe('the record after a merge', () => {
  it('is renewed for the merged channels and kept for the others', () => {
    const doc = ['%', 'O1000', '$1', 'A1', 'A2', '$1', 'A3 X5.'];
    const first = merge(split(), { c1: doc, c2: null });
    if (!first.ok) throw new Error('refused');
    expect(first.record.channels).toEqual([
      { channelId: '1', docId: 'c1', lines: doc },
      { channelId: '2', docId: 'c2', lines: C2 },
    ]);
    // The same documents against the merged program: nothing left to do.
    const again = merge(first.record, { c1: doc, c2: C2 }, first.lines);
    expect(again).toMatchObject({ ok: true, merged: [], lines: first.lines });
    // A further edit merges from there.
    const more = merge(first.record, { c1: [...doc.slice(0, 3), 'A1 W1.', ...doc.slice(4)], c2: C2 }, first.lines);
    expect(more.ok && more.lines).toEqual(['%', 'O1000', '$1', 'A1 W1.', 'A2', '$2', 'B1', '$1', 'A3 X5.', '$2', 'B2']);
  });
});

describe('sections several channels share', () => {
  /** Header 1–2, then lines 3–4 shared by channels 1 and 2, and line 5 of channel 1 alone. */
  const lines = ['%', 'O1', 'x', 'y', 'z'];
  const range = (startLine: number, endLine: number) => ({ startLine, endLine });
  const shared: ChannelSet = {
    layout: 'single-file',
    self: null,
    members: [
      { kind: 'section', channel: TOY_CHANNELS[0], docId: 'p', ranges: [range(3, 5)] },
      { kind: 'section', channel: TOY_CHANNELS[1], docId: 'p', ranges: [range(3, 4)] },
    ],
    missing: [],
    outside: [range(1, 2)],
    marks: [],
    problems: [],
    truncated: false,
  };
  const record = splitRecord({ sourceId: 'p', lines, set: shared, made: [{ channelId: '1', docId: 'c1' }, { channelId: '2', docId: 'c2' }] });
  const run = (docs: Record<string, string[] | null>, resolve: (l: readonly string[]) => ChannelSet = () => shared) =>
    planMerge({ record, source: { lines, set: shared }, channelLines: (id) => docs[id] ?? null, resolve });

  it('merges an edit of a shared line from one document and shows it to the other', () => {
    const answer = run({ c1: ['%', 'O1', 'x2', 'y', 'z'], c2: null });
    expect(answer.ok && answer.lines).toEqual(['%', 'O1', 'x2', 'y', 'z']);
  });

  it('takes the same change from two documents once', () => {
    const answer = run({ c1: ['%', 'O1', 'x2', 'y', 'z'], c2: ['%', 'O1', 'x2', 'y'] });
    expect(answer.ok && answer.lines).toEqual(['%', 'O1', 'x2', 'y', 'z']);
    expect(answer.ok && answer.merged).toEqual(['1', '2']);
  });

  it('refuses a shared line one merged document changed and another merged document kept (NC-14)', () => {
    // Channel 1 = 3–6, channel 3 = 5–8: lines 5–6 are shared. Document 1 edits line 5, document 3 edits its own line 7.
    const src = ['%', 'O1', 'A1', 'A2', 'S1', 'S2', 'C1', 'C2'];
    const set: ChannelSet = {
      layout: 'single-file',
      self: null,
      missing: [],
      marks: [],
      problems: [],
      truncated: false,
      outside: [range(1, 2)],
      members: [
        { kind: 'section', channel: TOY_CHANNELS[0], docId: 'p', ranges: [range(3, 6)] },
        { kind: 'section', channel: TOY_CHANNELS[2], docId: 'p', ranges: [range(5, 8)] },
      ],
    };
    const rec = splitRecord({ sourceId: 'p', lines: src, set, made: [{ channelId: '1', docId: 'd1' }, { channelId: '3', docId: 'd3' }] });
    const d1 = [...rec.channels[0].lines];
    d1[4] = 'S1-NEW';
    const d3 = [...rec.channels[1].lines];
    d3[4] = 'C1-NEW';
    const answer = planMerge({ record: rec, source: { lines: src, set }, channelLines: (id) => (id === 'd1' ? d1 : d3), resolve: () => set });
    expect(answer).toMatchObject({ ok: false, reason: { key: 'channels.merge.sharedChanged', params: { channel: 'Channel 3' } }, channelId: '3' });
    // Lines added between two shared lines by one document only: the same.
    const added = [...rec.channels[0].lines.slice(0, 5), 'S1b', ...rec.channels[0].lines.slice(5)];
    const again = planMerge({ record: rec, source: { lines: src, set }, channelLines: (id) => (id === 'd1' ? added : d3), resolve: () => set });
    expect(again).toMatchObject({ ok: false, reason: { key: 'channels.merge.sharedChanged' }, channelId: '3' });
  });

  it('refuses two different changes of one shared line', () => {
    const answer = run({ c1: ['%', 'O1', 'x2', 'y', 'z'], c2: ['%', 'O1', 'x3', 'y'] });
    expect(answer).toMatchObject({ ok: false, reason: { key: 'channels.merge.sharedChanged', params: { channel: 'Channel 2' } }, channelId: '2' });
  });
});

describe('a random round trip', () => {
  it('writes the edits of both documents back and reads each channel as its document', () => {
    const next = lcg(7);
    const pick = (n: number): number => Math.floor(next() * n);
    for (let round = 0; round < 60; round++) {
      // A program of 3–5 alternating sections of random length.
      const source = ['%', 'O1'];
      const count = 3 + pick(3);
      for (let s = 0; s < count; s++) {
        source.push(`$${(s % 2) + 1}`);
        for (let k = 0, n = 1 + pick(4); k < n; k++) source.push(`L${s}.${k}`);
      }
      const record = split(source);
      // Random body edits (never a line starting with `$`): replace, insert, delete.
      const docs: Record<string, string[]> = {};
      for (const entry of record.channels) {
        const doc = [...entry.lines];
        for (let e = 0, n = pick(4); e < n; e++) {
          const at = 2 + pick(doc.length - 2);
          const kind = pick(3);
          if (kind === 0 && !doc[at].startsWith('$')) doc[at] = `${doc[at]} E${round}`;
          else if (kind === 1) doc.splice(at + 1, 0, `N${round}.${e}`);
          else if (!doc[at].startsWith('$') && doc.length > 4) doc.splice(at, 1);
        }
        docs[entry.docId] = doc;
      }
      const answer = merge(record, docs, source);
      if (!answer.ok) throw new Error(`round ${round} refused: ${answer.reason.key}`);
      const after = toySet(answer.lines);
      for (const entry of record.channels) {
        const proj = projectChannel(after, entry.channelId)!;
        expect(projectedLines(proj, (a, b) => answer.lines.slice(a - 1, b)), `round ${round}, channel ${entry.channelId}`).toEqual(docs[entry.docId]);
      }
    }
  });
});
