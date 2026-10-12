// The resolution after an edit (M12 performance fix F2): whatever `patchResolution` answers
// equals a full `resolveDocument` of the edited text, over random edits of random programs,
// and it declines (null) exactly where it cannot know.

import { describe, expect, it } from 'vitest';
import { cpOf } from '../../../../tests/unit/helpers/profiles';
import { resolution, single } from '../../../../tests/unit/helpers/channelIncremental';
import { mergeDirty, patchResolution, type DirtySpan, type LineResolution } from './incremental';
import type { ChannelParams } from './types';

const lathe = cpOf('fanuc-lathe');

const multi: ChannelParams = {
  layout: 'multi-file',
  list: [
    { id: '1', name: 'Path 1' },
    { id: '2', name: 'Path 2' },
  ],
  fileName: '^(?<stem>.+)_CH(?<channel>\\d)\\.nc$',
  syncMarks: [{ id: 'wait', label: 'w', match: { kind: 'codes', codes: 'M900-M999' }, partners: { kind: 'all' } }],
};

/** A small deterministic random source, so a failure can be replayed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const BODY = ['G01 X10. Z-2. F0.2', 'G00 X50.', 'M901 P12', 'M902', 'M100', '(M903 IN A COMMENT)', 'T0101', 'N10 M904 P1', 'G01 Z-5.'];
const ALL = [...BODY, 'O2101', 'O2102', 'M99', 'M30', '%'];

function program(next: () => number, size: number): string[] {
  const lines = ['%', 'O0001 (HEAD)'];
  let channel = 1;
  while (lines.length < size) {
    if (next() < 0.03) lines.push(`O210${channel++ % 2 === 1 ? 1 : 2}`);
    else if (next() < 0.01) lines.push('M99');
    else lines.push(BODY[Math.floor(next() * BODY.length)]);
  }
  lines.push('M30', '%');
  return lines;
}

/** Replaces old lines `start..endOld` with `text`, as one Monaco change; the span it reports. */
function edit(lines: string[], start: number, endOld: number, text: string[]): DirtySpan {
  lines.splice(start - 1, endOld - start + 1, ...text);
  return { startLine: start, endLineOld: endOld, endLineNew: start + text.length - 1 };
}

const pick = (r: LineResolution) => ({ sections: r.sections, outside: r.outside, marks: r.marks });

describe('patchResolution', () => {
  it('equals a full resolution after every edit it accepts, and accepts most edits', () => {
    for (const p of [single, multi]) {
      let accepted = 0;
      let declined = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const next = rng(seed);
        const name = 'part_CH1.nc';
        const lines = p.layout === 'multi-file' ? [...Array(420).fill('G00 X1.'), ...program(next, 300)] : program(next, 300);
        let prev = resolution(name, lines, p);
        if (prev === null) continue;
        for (let k = 0; k < 25 && prev !== null; k++) {
          // In a multi-file document most edits are below the header the marker is read from.
          const floor = p.layout === 'multi-file' && next() < 0.9 ? 401 : 1;
          const start = floor + Math.floor(next() * (lines.length - floor + 1));
          const span = Math.floor(next() * 3);
          const endOld = Math.min(lines.length, start + span);
          // An edit is one or a few lines, sometimes a typed character, sometimes a new section line.
          const count = Math.floor(next() * 4);
          const text = Array.from({ length: Math.max(1, count) }, () => (next() < 0.5 ? `${lines[start - 1] ?? ''}1` : ALL[Math.floor(next() * ALL.length)]));
          // Two edits merged into one span, as the service does between two resolutions.
          let d = edit(lines, start, endOld, text);
          if (next() < 0.3) {
            const at = Math.min(lines.length, d.startLine + Math.floor(next() * 5));
            d = mergeDirty(d, edit(lines, at, at, [lines[at - 1] + ' ', 'G01 X2.']));
          }
          const full = resolution(name, lines, p);
          const patched = patchResolution(prev, d, lines.length, (a, b) => lines.slice(a - 1, b), lathe, p);
          if (patched === null) declined++;
          else {
            accepted++;
            expect(full, `seed ${seed} edit ${k}`).not.toBeNull();
            expect(pick(patched), `seed ${seed} edit ${k}`).toEqual(pick(full as LineResolution));
            expect(patched.boundaries).toEqual((full as LineResolution).boundaries);
          }
          prev = full;
        }
      }
      expect(accepted, p.layout).toBeGreaterThan(declined);
    }
  });

  it('declines an edit that touches a section start, writes one, or makes a line too long', () => {
    const lines = ['%', 'O2101', 'M901 P12', 'G01 X1.', 'O2102', 'M901 P12', 'G01 X2.', 'M30'];
    const prev = resolution('a.nc', lines, single) as NonNullable<ReturnType<typeof resolution>>;
    const read = (copy: string[]) => (a: number, b: number) => copy.slice(a - 1, b);
    const run = (start: number, endOld: number, text: string[]) => {
      const copy = [...lines];
      const d = edit(copy, start, endOld, text);
      return patchResolution(prev, d, copy.length, read(copy), lathe, single);
    };
    expect(run(2, 2, ['O2101 '])).toBeNull(); // a start line edited
    expect(run(4, 4, ['O2102'])).toBeNull(); // a start written
    expect(run(4, 4, ['M99'])).toBeNull(); // an end written
    expect(run(4, 4, ['X'.repeat(1001)])).toBeNull(); // too long to read
    expect(run(4, 4, ['G01 X1.', 'M902 P12'])?.marks.map((m) => [m.mark, m.line, m.channel])).toEqual([
      ['M901', 3, '1'],
      ['M902', 5, '1'],
      ['M901', 7, '2'],
    ]);
  });

  it('holds the edited lines to the budget: past the deadline it declines, for the full reading to say (PERF-4)', () => {
    const lines = ['%', 'O2101', 'M901 P12', 'G01 X1.', 'O2102', 'M901 P12', 'G01 X2.', 'M30'];
    const prev = resolution('a.nc', lines, single) as NonNullable<ReturnType<typeof resolution>>;
    const pasted = Array.from({ length: 50 }, (_, i) => (i % 5 === 0 ? 'M902 P12' : 'G01 X3.'));
    const copy = [...lines];
    const d = edit(copy, 4, 4, pasted);
    const read = (a: number, b: number) => copy.slice(a - 1, b);
    let t = 0;
    const clock = { deadline: 10, now: () => (t += 1) }; // the deadline passes on the 10th line
    expect(patchResolution(prev, d, copy.length, read, lathe, single, clock)).toBeNull();
    expect(patchResolution(prev, d, copy.length, read, lathe, single, { deadline: 1e9, now: () => 0 })?.marks).toHaveLength(12);
  });

  it('merges two edits into one span of the text before both', () => {
    // Line 10 edited, then a line inserted after it, then line 20 (of the new text) edited.
    expect(mergeDirty(mergeDirty({ startLine: 10, endLineOld: 10, endLineNew: 10 }, { startLine: 10, endLineOld: 10, endLineNew: 11 }), { startLine: 20, endLineOld: 20, endLineNew: 20 })).toEqual({
      startLine: 10,
      endLineOld: 19,
      endLineNew: 20,
    });
  });
});
