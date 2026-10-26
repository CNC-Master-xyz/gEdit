// `sameChannelSet` answers what the string the channel service used to compare answered (v1.2.0
// channel-enter): `JSON.stringify` over the layout, the channel, the members, the missing channels, the lines
// outside, the marks, the problems and the cap flag, plus a mark's `blocking` and `absent` (review WX-CODE-7:
// the readers show both, and a change of either alone must reach them). Held to that string over random pairs
// of sets, which differ in one field or in none.

import { describe, expect, it } from 'vitest';
import { sameChannelSet } from './sameSet';
import { lcg } from './paneFixtures';
import type { ChannelMember, ChannelRef, ChannelSet, SyncHit } from './types';

/** The string the service compared before: the old `signatureOf`, kept here as the reference. */
function signatureOf(set: ChannelSet): string {
  return JSON.stringify([
    set.layout,
    set.self?.id ?? null,
    set.members.map((m) => (m.kind === 'section' ? [m.channel.id, m.ranges] : [m.channel.id, m.name, m.exists, m.docId, m.by])),
    set.missing.map((c) => c.id),
    set.outside,
    set.marks.map((h) => [h.ruleId, h.mark, h.line, h.channel, h.partners, h.blocking, h.absent === true]),
    set.problems.map((p) => [p.path, p.message]),
    set.truncated,
  ]);
}

const REFS: ChannelRef[] = [1, 2, 3].map((n, index) => ({ id: String(n), name: `Turret ${n}`, index }));

function randomSet(next: () => number): ChannelSet {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)];
  const single = next() < 0.7;
  const members: ChannelMember[] = REFS.slice(0, 1 + Math.floor(next() * 3)).map((channel) =>
    single
      ? { kind: 'section', channel, docId: 'd', ranges: Array.from({ length: Math.floor(next() * 3) }, (_, i) => ({ startLine: i * 10 + 1, endLine: i * 10 + 1 + Math.floor(next() * 5) })) }
      : { kind: 'file', channel, name: pick(['A_CH1.nc', 'B_CH1.nc']), path: null, exists: next() < 0.8, docId: pick(['d1', 'd2', null]), by: pick(['fileName', 'marker', 'assigned'] as const) },
  );
  const marks: SyncHit[] = Array.from({ length: Math.floor(next() * 6) }, (_, i) => ({
    ruleId: pick(['wait', 'order']),
    mark: pick(['M901', 'M902', '']),
    line: 3 + i * 4,
    channel: pick(['1', '2']),
    partners: pick([['1', '2'], ['1'], ['1', '2', '3']]),
    blocking: next() < 0.9,
    ...(next() < 0.2 ? { absent: true as const } : {}),
  }));
  return {
    layout: single ? 'single-file' : 'multi-file',
    self: single || next() < 0.2 ? null : REFS[0],
    members,
    missing: REFS.slice(members.length),
    outside: next() < 0.5 ? [] : [{ startLine: 1, endLine: 2 }],
    marks,
    problems: next() < 0.8 ? [] : [{ path: 'list[1]', message: { key: 'channels.problems.siblingUnknown', params: { channel: 'Turret 2' } } }],
    truncated: next() < 0.1,
  };
}

/** A copy of `set` (no object shared) with at most one change of a field. */
function changed(set: ChannelSet, next: () => number): ChannelSet {
  const copy: ChannelSet = JSON.parse(JSON.stringify(set));
  const which = Math.floor(next() * 15);
  const m = copy.marks[Math.floor(next() * copy.marks.length)];
  const member = copy.members[Math.floor(next() * copy.members.length)];
  switch (which) {
    case 0: copy.layout = copy.layout === 'single-file' ? 'multi-file' : 'single-file'; break;
    case 1: copy.self = copy.self === null ? REFS[1] : null; break;
    case 2: copy.truncated = !copy.truncated; break;
    case 3: copy.outside = copy.outside.length === 0 ? [{ startLine: 1, endLine: 1 }] : [{ ...copy.outside[0], endLine: copy.outside[0].endLine + 1 }]; break;
    case 4: copy.missing = copy.missing.slice(1); break;
    case 5: copy.problems = copy.problems.length === 0 ? [{ path: 'x', message: { key: 'k' } }] : [{ ...copy.problems[0], message: { key: 'other' } }]; break;
    case 6: if (m) m.line += 1; break;
    case 7: if (m) m.mark += '1'; break;
    case 8: if (m) m.partners = [...m.partners, '4']; break;
    case 9: if (m) m.blocking = !m.blocking; break;
    case 10: if (m) m.channel += 'x'; break;
    case 11: if (member?.kind === 'section') member.ranges = [...member.ranges, { startLine: 90, endLine: 91 }]; else if (member) member.name += 'x'; break;
    case 12: if (member?.kind === 'file') member.exists = !member.exists; break;
    case 13: copy.members = copy.members.slice(1); break;
    case 14: if (m) { if (m.absent) delete m.absent; else m.absent = true; } break;
  }
  return copy;
}

describe('sameChannelSet', () => {
  it('says what the old string said, over random pairs of sets that are the same, change in one field, or are unrelated', () => {
    let same = 0;
    let different = 0;
    for (let seed = 1; seed <= 1500; seed++) {
      const next = lcg(seed);
      const a = randomSet(next);
      const b = next() < 0.25 ? randomSet(next) : next() < 0.15 ? a : changed(a, next);
      const expected = signatureOf(a) === signatureOf(b);
      expect(sameChannelSet(a, b), `seed ${seed}`).toBe(expected);
      expect(sameChannelSet(b, a), `seed ${seed} reversed`).toBe(expected);
      if (expected) same++;
      else different++;
    }
    expect(same).toBeGreaterThan(150);
    expect(different).toBeGreaterThan(150);
  });

  it('is true for a set and a copy of it that shares no object, and false for a mark moved by a line break', () => {
    const a: ChannelSet = { ...randomSet(lcg(7)), marks: [{ ruleId: 'wait', mark: 'M901', line: 4, channel: '1', partners: ['1', '2'], blocking: true }] };
    expect(sameChannelSet(a, JSON.parse(JSON.stringify(a)))).toBe(true);
    // What the patch of an edit hands back: the marks it did not touch are the same objects, a moved one is a new object with a new line.
    expect(sameChannelSet(a, { ...a, marks: [{ ...a.marks[0], line: 5 }] })).toBe(false);
    expect(sameChannelSet(a, { ...a, marks: [...a.marks] })).toBe(true);
  });

  it('sees a mark that differs only in blocking, or only in absent (WX-CODE-7)', () => {
    const mark: SyncHit = { ruleId: 'wait', mark: 'M901', line: 4, channel: '1', partners: ['1', '2'], blocking: true };
    const a: ChannelSet = { ...randomSet(lcg(7)), marks: [mark] };
    expect(sameChannelSet(a, { ...a, marks: [{ ...mark, blocking: false }] })).toBe(false);
    expect(sameChannelSet(a, { ...a, marks: [{ ...mark, absent: true }] })).toBe(false);
    expect(sameChannelSet({ ...a, marks: [{ ...mark, absent: true }] }, a)).toBe(false);
    // An absent that is spelled out as undefined is no absent.
    expect(sameChannelSet(a, { ...a, marks: [{ ...mark, absent: undefined }] })).toBe(true);
  });
});
