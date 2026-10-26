// Whether typing in one line can change a program's channels (v1.2.0 T026): `false` is a promise that a full
// resolution after the edit equals the one before it, held to `resolveDocument` over random edits.

import { describe, expect, it } from 'vitest';
import { cpOf } from '../../../../tests/unit/helpers/profiles';
import { resolution, single } from '../../../../tests/unit/helpers/channelIncremental';
import { canReasonAbout, editKeepsChannels, lineMayBeStructure } from './touch';
import type { ChannelSet } from './types';

const lathe = cpOf('fanuc-lathe');

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

type Resolution = NonNullable<ReturnType<typeof resolution>>;

/** A `ChannelSet` of sections from a resolution (what the channel service assembles). */
function setOf(r: Resolution): ChannelSet {
  return {
    layout: 'single-file',
    self: null,
    members: r.sections.map((s) => ({ kind: 'section', channel: s.channel, docId: 'd', ranges: s.ranges })),
    missing: [],
    outside: r.outside,
    marks: r.marks,
    problems: [],
    truncated: false,
  } as unknown as ChannelSet;
}

describe('lineMayBeStructure', () => {
  it('is true for a wait, the start and the end of a section and a line too long to read, false for the rest', () => {
    expect(lineMayBeStructure('M901 P12', lathe, single)).toBe(true);
    expect(lineMayBeStructure('M100', lathe, single)).toBe(true);
    expect(lineMayBeStructure('O2101 (PATH 1)', lathe, single)).toBe(true);
    expect(lineMayBeStructure('M99', lathe, single)).toBe(true);
    expect(lineMayBeStructure('X'.repeat(1001), lathe, single)).toBe(true);
    for (const line of ['G01 X10. Z-2. F0.2', '', '(M901 P12 IN A COMMENT)', 'T0101', 'N10 G00 X5.', 'M9']) expect(lineMayBeStructure(line, lathe, single), line).toBe(false);
  });

  it('is true for a pattern that does not compile (the resolution says why)', () => {
    expect(lineMayBeStructure('G1 X1.', lathe, { ...single, sectionStart: '(' })).toBe(true);
  });
});

describe('canReasonAbout', () => {
  const lines = ['%', 'O2101', 'M901 P12', 'G01 X1.', 'M99', 'O2102', 'M901 P12', 'G01 X2.', 'M99', '(TAIL)'];
  const set = setOf(resolution('a.nc', lines, single) as Resolution);

  it('is true for sections of one program with nothing to say', () => {
    expect(canReasonAbout(set)).toBe(true);
  });

  it('is false where an edit cannot be reasoned about: one file per channel, a problem, dropped marks', () => {
    expect(canReasonAbout({ ...set, layout: 'multi-file' })).toBe(false);
    expect(canReasonAbout({ ...set, problems: [{ path: 'x', message: { key: 'k' } }] } as ChannelSet)).toBe(false);
    expect(canReasonAbout({ ...set, truncated: true })).toBe(false);
  });
});

describe('editKeepsChannels', () => {
  it('is true for a character in an ordinary line and false for one in a wait, a section start or end, or one that writes one', () => {
    expect(editKeepsChannels('G01 X1.', 'G01 X1.5', lathe, single)).toBe(true);
    expect(editKeepsChannels('M901 P12', 'M901 P123', lathe, single)).toBe(false); // a wait
    expect(editKeepsChannels('O2101', 'O2101 ', lathe, single)).toBe(false); // a start
    expect(editKeepsChannels('M99', 'M99 ', lathe, single)).toBe(false); // an end
    expect(editKeepsChannels('G01 X1.', 'M902 P12', lathe, single)).toBe(false); // a wait written
    expect(editKeepsChannels('G01 X1.', 'O2102', lathe, single)).toBe(false); // a start written
  });

  it('keeps what the full resolution says, over random edits of random programs', () => {
    const POOL = ['G01 X10. Z-2. F0.2', 'G00 X50.', 'M901 P12', 'M902', '(M903 IN A COMMENT)', 'T0101', 'N10 M904 P1', 'G01 Z-5.', 'M100', 'O2101', 'O2102', 'M99', 'M30'];
    let kept = 0;
    let declined = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const next = rng(seed);
      const text: string[] = ['%', 'O0001 (HEAD)'];
      while (text.length < 200) text.push(next() < 0.03 ? (next() < 0.5 ? 'O2101' : 'O2102') : next() < 0.02 ? 'M99' : POOL[Math.floor(next() * 8)]);
      text.push('M30', '%');
      let prev = resolution('a.nc', text, single) as Resolution | null;
      for (let k = 0; k < 40 && prev !== null; k++) {
        const at = 1 + Math.floor(next() * text.length);
        const old = text[at - 1];
        const typed = next() < 0.5 ? `${old}1` : next() < 0.5 ? POOL[Math.floor(next() * POOL.length)] : old.slice(0, Math.max(0, old.length - 1));
        const keeps = canReasonAbout(setOf(prev)) && editKeepsChannels(old, typed, lathe, single);
        text[at - 1] = typed;
        const full = resolution('a.nc', text, single) as Resolution | null;
        if (keeps) {
          kept++;
          expect(full, `seed ${seed} edit ${k}`).not.toBeNull();
          const pick = (x: Resolution) => ({ sections: x.sections, outside: x.outside, marks: x.marks });
          expect(pick(full as Resolution), `seed ${seed} edit ${k}: ${old} -> ${typed}`).toEqual(pick(prev));
        } else declined++;
        prev = full;
      }
    }
    expect(kept).toBeGreaterThan(declined);
  });
});
