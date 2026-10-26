// The kept jump lines of a program (v1.2.0 T033): whatever the cache answers equals a fresh
// `computeJumpLines` of the edited text over random edits, it reads the program again only where
// it cannot know, and it carries an edit of an ordinary line over without reading anything.

import { describe, expect, it } from 'vitest';
import { computeJumpLines } from '$lib/app/outlineService';
import { cpOf } from '../../../../tests/unit/helpers/profiles';
import { createJumpLineCache, mayDecideJumps, type JumpChange, type SectionPrint } from './jumpCache';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const lathe = cpOf('fanuc-lathe');
const sinumerik = cpOf('sinumerik');

/** Lines with nothing a jump cares about, and the ones that matter to jump lines. */
const PLAIN = ['G01 X10. Z-2. F0.2', 'G00 X50.', 'M901P12', 'M8', 'G65 P9810', '(A COMMENT WITH N10 AND GOTO20 AND M99 P10)', 'T0101', '', 'G01 Z-5.'];
const FANUC_JUMPS = ['N10 G0 X1.', 'N20 M99', 'N30 G1 X3.', 'IF[#1LT3]GOTO10', 'GOTO30', 'WHILE[#1LT3]DO1', 'END1', 'M99 P10', 'N40 G4 U1.'];
const SINUMERIK_JUMPS = ['LOOP_A:', 'END_A: G1 X1', 'GOTOB LOOP_A', 'GOTOF END_A', 'WHILE R1<3', 'ENDWHILE', 'N50 G0 X2', 'N60 G1 X3', 'GOTO N50'];

/** Sections from the lines: a line `CH1` or `CH2` starts one that runs to the next such line; the lines above the first are no channel's. */
function sectionsOf(lines: readonly string[]): { owner: (line: number) => string; print: SectionPrint } {
  const owners: string[] = [];
  let current = '';
  for (const line of lines) {
    if (line === 'CH1') current = '1';
    else if (line === 'CH2') current = '2';
    owners.push(current);
  }
  const byChannel = new Map<string, { startLine: number; endLine: number }[]>();
  owners.forEach((owner, i) => {
    if (owner === '') return;
    const ranges = byChannel.get(owner) ?? [];
    const last = ranges[ranges.length - 1];
    if (last !== undefined && last.endLine === i) last.endLine = i + 1;
    else ranges.push({ startLine: i + 1, endLine: i + 1 });
    byChannel.set(owner, ranges);
  });
  return { owner: (line) => owners[line - 1] ?? '', print: [...byChannel].map(([channel, ranges]) => ({ channel, ranges })) };
}

describe('mayDecideJumps', () => {
  it('is false for a move, a comment, a wait and a blank line, and true for what a jump is made of', () => {
    for (const line of PLAIN) expect(mayDecideJumps(line, lathe), line).toBe(false);
    for (const line of FANUC_JUMPS) expect(mayDecideJumps(line, lathe), line).toBe(true);
    for (const line of SINUMERIK_JUMPS) expect(mayDecideJumps(line, sinumerik), line).toBe(true);
  });
});

describe('the kept jump lines', () => {
  for (const [name, cp, jumps] of [
    ['Fanuc', lathe, FANUC_JUMPS],
    ['Sinumerik', sinumerik, SINUMERIK_JUMPS],
  ] as const) {
    it(`equals computeJumpLines over random edits (${name}) and reads the program again only when it has to`, () => {
      const next = rng(name === 'Fanuc' ? 7 : 11);
      const pool = [...PLAIN, ...PLAIN, ...PLAIN, ...jumps, 'CH1', 'CH2'];
      const lines: string[] = ['%', 'O0001', 'CH1'];
      for (let i = 0; i < 60; i++) lines.push(pool[Math.floor(next() * pool.length)]);
      lines.splice(30, 0, 'CH2');
      const cache = createJumpLineCache((_id, line) => mayDecideJumps(line, cp));
      let version = 1;
      let reads = 0;
      const answer = (): Record<string, number[]> => {
        const { owner, print } = sectionsOf(lines);
        return cache.get('d', version, print, () => [...lines], (text) => {
          reads++;
          return computeJumpLines(text, cp, owner);
        });
      };
      const fresh = (): Record<string, number[]> => computeJumpLines([...lines], cp, sectionsOf(lines).owner);
      for (let step = 0; step < 300; step++) {
        expect(answer(), `step ${step}`).toEqual(fresh());
        const kind = next();
        const at = 1 + Math.floor(next() * lines.length);
        const line = pool[Math.floor(next() * pool.length)];
        let change: JumpChange;
        if (kind < 0.35) {
          // A character typed at the end of line `at` (or a replacement of the line).
          lines[at - 1] = kind < 0.2 ? `${lines[at - 1]} X` : line;
          change = { startLine: at, endLineOld: at, endLineNew: at, flush: false, versionId: ++version };
        } else if (kind < 0.6) {
          // Enter: a line below `at` (the text of `line` on it).
          lines.splice(at, 0, line);
          change = { startLine: at, endLineOld: at, endLineNew: at + 1, flush: false, versionId: ++version };
        } else if (kind < 0.8 && lines.length > 8 && at < lines.length) {
          // A whole line deleted: Monaco's span runs over the line and the one below it, which keeps its text.
          lines.splice(at - 1, 1);
          change = { startLine: at, endLineOld: at + 1, endLineNew: at, flush: false, versionId: ++version };
        } else {
          // A paste of three lines over two.
          const end = Math.min(at + 1, lines.length);
          const pasted = [pool[Math.floor(next() * pool.length)], pool[Math.floor(next() * pool.length)], pool[Math.floor(next() * pool.length)]];
          lines.splice(at - 1, end - at + 1, ...pasted);
          change = { startLine: at, endLineOld: end, endLineNew: at + 2, flush: false, versionId: ++version };
        }
        cache.note('d', change, (a, b) => lines.slice(a - 1, b));
      }
      expect(answer()).toEqual(fresh());
      // 300 edits of which most touch ordinary lines: a read for each would be 300.
      expect(reads, 'full reads').toBeLessThan(230);
    }, 120_000);
  }

  it('carries an edit of an ordinary line over without reading the program, and shifts the lines after an Enter', () => {
    const lines = ['%', 'CH1', 'N10 G0 X1.', 'G1 X2.', 'GOTO10', 'CH2', 'G1 X3.', 'N10 G0 X4.', 'IF[#1LT2]GOTO10', 'M30'];
    const cache = createJumpLineCache((_id, line) => mayDecideJumps(line, lathe));
    let version = 1;
    let reads = 0;
    const get = (): Record<string, number[]> => {
      const { owner, print } = sectionsOf(lines);
      return cache.get('d', version, print, () => [...lines], (text) => {
        reads++;
        return computeJumpLines(text, lathe, owner);
      });
    };
    expect(get()).toEqual({ '1': [3, 5], '2': [8, 9] });
    expect(reads).toBe(1);
    // A character in an ordinary line.
    lines[3] = 'G1 X2.5';
    cache.note('d', { startLine: 4, endLineOld: 4, endLineNew: 4, flush: false, versionId: ++version }, (a, b) => lines.slice(a - 1, b));
    expect(get()).toEqual({ '1': [3, 5], '2': [8, 9] });
    // Enter after line 4: every line below moves down by one.
    lines.splice(4, 0, 'G0 Z1.');
    cache.note('d', { startLine: 4, endLineOld: 4, endLineNew: 5, flush: false, versionId: ++version }, (a, b) => lines.slice(a - 1, b));
    expect(get()).toEqual({ '1': [3, 6], '2': [9, 10] });
    expect(reads).toBe(1);
    // A jump written: the program is read again.
    lines[6] = 'GOTO10';
    cache.note('d', { startLine: 7, endLineOld: 7, endLineNew: 7, flush: false, versionId: ++version }, (a, b) => lines.slice(a - 1, b));
    expect(get()).toEqual(computeJumpLines([...lines], lathe, sectionsOf(lines).owner));
    expect(reads).toBe(2);
  });

  it('reads again for a version nobody told it about, for a flush, and when the sections are not the old ones moved', () => {
    const lines = ['%', 'CH1', 'N10 G0 X1.', 'GOTO10', 'CH2', 'G1 X3.', 'N10 G0 X4.', 'GOTO10', 'M30'];
    const cache = createJumpLineCache((_id, line) => mayDecideJumps(line, lathe));
    let version = 1;
    let reads = 0;
    const get = (): Record<string, number[]> => {
      const { owner, print } = sectionsOf(lines);
      return cache.get('d', version, print, () => [...lines], (text) => {
        reads++;
        return computeJumpLines(text, lathe, owner);
      });
    };
    get();
    // An edit that was not noted: the version differs.
    lines[5] = 'G1 X9.';
    version++;
    expect(get()).toEqual(computeJumpLines([...lines], lathe, sectionsOf(lines).owner));
    expect(reads).toBe(2);
    // A flush.
    cache.note('d', { startLine: 1, endLineOld: 9, endLineNew: 9, flush: true, versionId: ++version }, (a, b) => lines.slice(a - 1, b));
    get();
    expect(reads).toBe(3);
    // A section start that moved from line 5 to line 6 with no relevant line touched: the sections are not the old ones shifted.
    lines[4] = 'G1 X8.';
    lines[5] = 'CH2';
    cache.note('d', { startLine: 5, endLineOld: 6, endLineNew: 6, flush: false, versionId: ++version }, (a, b) => lines.slice(a - 1, b));
    expect(get()).toEqual(computeJumpLines([...lines], lathe, sectionsOf(lines).owner));
    expect(reads).toBe(4);
  });

  it('keeps nothing without a way to tell which lines matter', () => {
    const cache = createJumpLineCache(undefined);
    let reads = 0;
    const read = (): Record<string, number[]> => cache.get('d', 1, null, () => ['G1 X1.'], () => (reads++, {}));
    read();
    read();
    expect(reads).toBe(2);
  });
});
