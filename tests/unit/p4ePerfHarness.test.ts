// The two-pane rows of `p4-perf` (sections D, E and F: split view, the channel view and the aligned view of a comparison on large programs) checked
// without the app: the file is valid, the rows and their budgets are where the README says they are, and the programs the rows are measured on are
// what the rows expect when the real code reads them (`tests/runtime/scenarios/p4e-perf-common.js`). A scenario that expects a count, a line or a
// budget the code does not give would fail on the first runner; here it fails first. The scenario itself is never run on this machine.

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenarios } from '../runtime/lib/index.js';
import {
  ALIGNED_CHANGES,
  ALIGNED_LINES,
  ALIGNED_OPEN_BUDGET_MS,
  ALIGNED_REALIGN_BUDGET_MS,
  ALIGNED_REALIGN_DELAY_MAX_MS,
  CHANNEL_BLOCK,
  ENTERS,
  ENTER_BUDGET_MS,
  FRAME_MS,
  KEYPRESS_P95_BUDGET_MS,
  KEYSTROKES,
  TYPING_COST_BUDGET_MS,
  VIEW_OPEN_BUDGET_MS,
  alignedPair,
  channelLineAt,
  channelProgram,
} from '../runtime/scenarios/p4e-perf-common.js';
import { resolveDocument } from '$lib/core/channels/marks';
import { paneLineOf, projectChannel } from '$lib/core/channels/panes';
import { REALIGN_DELAY_MAX_MS } from '$lib/core/compare/aligned';
import { cpOf } from './helpers/profiles';
import type { ChannelParams, ChannelSet } from '$lib/core/channels/types';

const root = fileURLToPath(new URL('../../', import.meta.url));
const scenarioFile = (name: string): string => join(root, 'tests', 'runtime', 'scenarios', name);
const source = (name: string): string => readFileSync(scenarioFile(name), 'utf8');

describe('p4-perf with the two-pane rows', () => {
  it('is valid JavaScript, in both files', () => {
    for (const file of ['p4-perf.js', 'p4e-perf-common.js']) {
      expect(() => execFileSync(process.execPath, ['--check', scenarioFile(file)], { stdio: 'pipe' }), file).not.toThrow();
    }
  });

  it('stays one scenario of the suite of P4a, never retried, with time for the P4e sections on top of the P4b ones', async () => {
    await import('../runtime/scenarios/p4-perf.js');
    const p4a = readFileSync(join(root, 'tests', 'runtime', 'suites', 'p4a.txt'), 'utf8');
    expect(p4a.match(/^p4-perf$/gm)).toHaveLength(1);
    for (const suite of ['p4b', 'p4e']) expect(readFileSync(join(root, 'tests', 'runtime', 'suites', `${suite}.txt`), 'utf8')).not.toMatch(/^p4-perf$/m);
    const options = scenarios.get('p4-perf')?.options;
    expect(options?.retry).toBe(false);
    // seven runs of up to 930 s each, the probe, and 1200 s for the three sections of P4e
    expect(options?.timeout).toBeGreaterThanOrEqual(8400 + 1200);
  });

  it('has the three sections of P4e, each a guard of its own, after the sections of P4a and P4b', () => {
    const text = source('p4-perf.js');
    const guards = [...text.matchAll(/await guard\(h, '([A-Z])\. ([^']*)'/g)].map((m) => m[1]);
    expect(guards.filter((letter) => 'DEF'.includes(letter))).toEqual(['D', 'E', 'F']);
    expect(text).toContain("'D. Split view on the simple program (two groups, one 300,000-line document)'");
    expect(text).toContain("'E. Channels Side by Side on a 300,000-line program with two channel sections'");
    expect(text).toContain("'F. The aligned view of a comparison of two 100,000-line programs'");
    expect(text.indexOf("'C. Statistics and Time")).toBeLessThan(text.indexOf("'D. Split view"));
    expect(text.indexOf("'F. The aligned view")).toBeLessThan(text.indexOf('status at the end'));
  });

  it('measures every row of the README table, with the budget that row is held to', () => {
    const text = source('p4-perf.js');
    // [a fragment of the row's name, the budget constant it is judged by]
    const rows: [string, string][] = [
      ['in ONE editor (the baseline)', 'KEYPRESS_P95_BUDGET_MS'],
      ['Split Editor on the open', 'VIEW_OPEN_BUDGET_MS'],
      ['keypress to render in group 1 with group 2 on the same lines', 'KEYPRESS_P95_BUDGET_MS'],
      ['and group 2 draws the character within the same budget', 'KEYPRESS_P95_BUDGET_MS'],
      ['the second group costs typing at most a frame:', 'TYPING_COST_BUDGET_MS'],
      ['keypress to render in group 1 with group 2 at the top', 'KEYPRESS_P95_BUDGET_MS'],
      ['keypress to render in group 2:', 'KEYPRESS_P95_BUDGET_MS'],
      ['and group 1 draws the character within the same budget', 'KEYPRESS_P95_BUDGET_MS'],
      ['group 2 costs typing at most a frame', 'TYPING_COST_BUDGET_MS'],
      ['after Close Split the one editor draws a keypress', 'KEYPRESS_P95_BUDGET_MS'],
      ['and no slower than before the split by more than a frame', 'TYPING_COST_BUDGET_MS'],
      ['Channels Side by Side on the open', 'VIEW_OPEN_BUDGET_MS'],
      ['keypress to render in pane 2 of the channel view', 'KEYPRESS_P95_BUDGET_MS'],
      ['the channel view costs typing at most a frame', 'TYPING_COST_BUDGET_MS'],
      ['keypress to render in pane 1:', 'KEYPRESS_P95_BUDGET_MS'],
      ['pane 1 costs typing at most a frame', 'TYPING_COST_BUDGET_MS'],
      ['a line break in pane 2 with', 'ENTER_BUDGET_MS'],
      ['shows its ${3 * K} blocks on both sides within the open budget', 'ALIGNED_OPEN_BUDGET_MS'],
      ['keypress to render in the aligned view at', 'KEYPRESS_P95_BUDGET_MS'],
      ['the typed line is a changed block of its own, drawn again', 'ALIGNED_REALIGN_BUDGET_MS'],
    ];
    for (const [name, budget] of rows) {
      const at = text.indexOf(name);
      expect(at, name).toBeGreaterThan(0);
      // the row is one h.checkTime call; its budget is the third argument, on the same line
      const line = text.slice(text.lastIndexOf('\n', at) + 1, text.indexOf('\n', at));
      expect(line, name).toContain('h.checkTime(');
      expect(line, name).toContain(`, ${budget}, `);
    }
    // every typing row goes through the frame; the cost rows are differences and do not
    expect(text.match(/\+ FRAME_MS, KEYPRESS_P95_BUDGET_MS/g)?.length).toBeGreaterThanOrEqual(10);
  });

  it('types real key presses and checks the typed text and that every keystroke arrived before it judges a time', () => {
    const text = source('p4e-perf-common.js');
    expect(text).toContain("h.nativeKeys([{ key: '1' }])");
    expect(text).toContain("h.nativeKeys([{ key: 'Enter' }])");
    const scenario = source('p4-perf.js');
    expect(scenario.match(/\{ also: reached\(/g)?.length).toBeGreaterThanOrEqual(6);
    expect(scenario).toContain('the typed characters are in the program');
    expect(scenario).toContain('the characters typed in the panes are in the program');
    expect(scenario).toContain('the program in the second pane has the typed characters on that line');
  });

  it('never runs the harness here: the scenario file imports nothing from node', () => {
    for (const file of ['p4-perf.js', 'p4e-perf-common.js']) expect(source(file), file).not.toMatch(/from 'node:|require\(/);
  });
});

describe('the budgets', () => {
  it('are the P1 typing budget for every key, and the derived figures the header explains', () => {
    expect(KEYPRESS_P95_BUDGET_MS).toBe(50);
    expect(FRAME_MS).toBe(17);
    expect(TYPING_COST_BUDGET_MS).toBe(17);
    expect(VIEW_OPEN_BUDGET_MS).toBe(2000);
    expect(ENTER_BUDGET_MS).toBe(100);
    expect(ALIGNED_OPEN_BUDGET_MS).toBe(6000);
    expect(ALIGNED_REALIGN_BUDGET_MS).toBe(9000);
    expect(KEYSTROKES).toBe(40);
    expect(ENTERS).toBe(20);
  });

  it('follow the numbers they are derived from', () => {
    // the longest the aligned view waits before it aligns again is the app's own constant
    expect(ALIGNED_REALIGN_DELAY_MAX_MS).toBe(REALIGN_DELAY_MAX_MS);
    expect(ALIGNED_REALIGN_BUDGET_MS).toBe(REALIGN_DELAY_MAX_MS + ALIGNED_OPEN_BUDGET_MS);
    // the same figures as the other scenarios of the suite
    const read = (file: string, name: string): number => Number(new RegExp(`const ${name} = (\\d+)`).exec(source(file))?.[1]);
    expect(read('m12-perf.js', 'KEYPRESS_P95_BUDGET_MS')).toBe(KEYPRESS_P95_BUDGET_MS);
    expect(read('m12-perf.js', 'TYPING_COST_BUDGET_MS')).toBe(TYPING_COST_BUDGET_MS);
    expect(read('m12-perf.js', 'OPEN_BUDGET_MS')).toBe(VIEW_OPEN_BUDGET_MS);
    expect(read('p3-perf.js', 'KEYPRESS_P95_BUDGET_MS')).toBe(KEYPRESS_P95_BUDGET_MS);
    expect(read('m11-perf.js', 'REVIEW_BUDGET_MS')).toBe(5000);
    expect(ALIGNED_OPEN_BUDGET_MS).toBe(read('m11-perf.js', 'REVIEW_BUDGET_MS') + 1000);
    // and the unit test of the channel panes holds the code to the line-break figure
    expect(readFileSync(join(root, 'src', 'lib', 'monaco', 'channelPanes.typing.slow.test.ts'), 'utf8')).toContain(`const ENTER_BUDGET_MS = ${ENTER_BUDGET_MS};`);
    // the P1 typing budget of the code-side proofs
    for (const file of ['editorGroups.typing.slow.test.ts', 'channelPanes.typing.slow.test.ts']) {
      expect(readFileSync(join(root, 'src', 'lib', 'monaco', file), 'utf8')).toContain(`, ${KEYPRESS_P95_BUDGET_MS}, \``);
    }
  });
});

describe('the program of section E (300,000 lines, two channels, 20,000 waits)', () => {
  const program = channelProgram();
  const cp = cpOf('fanuc-lathe');
  const resolved = resolveDocument('p4-perf-channels-300k.nc', program.lines, cp, CHANNEL_BLOCK as unknown as ChannelParams);

  it('has the size and the waits the section checks', () => {
    expect(program.lines.length).toBeGreaterThan(300000);
    expect(program.marks).toBe(20000);
    expect(program.text.endsWith('\n')).toBe(true);
    expect(program.header).toBe(4);
    expect(program.ranges['1'][0]).toBe(5);
    expect(program.ranges['2'][0]).toBe(program.ranges['1'][1] + 1);
    expect(program.lines[program.ranges['2'][0] - 1]).toBe('O2102 (CHANNEL 2)');
  });

  it('is read by the real resolution as two sections and 20,000 waits, every one with its partner', () => {
    expect(resolved.layout).toBe('single-file');
    expect(resolved.problems).toEqual([]);
    expect(resolved.dropped).toBe(0);
    expect(resolved.marks).toHaveLength(program.marks);
    const ranges = Object.fromEntries(resolved.sections.map((s) => [s.channel.id, s.ranges.map((r) => [r.startLine, r.endLine])]));
    // the last section runs to the end of the program, the closing % included
    expect(ranges).toEqual({ '1': [program.ranges['1']], '2': [[program.ranges['2'][0], program.lines.length]] });
    expect(resolved.outside).toEqual([{ startLine: 1, endLine: program.header }]);
    // the waits of the two channels are the same sequence, so every one has a partner in the other channel
    const byChannel = (id: string) => resolved.marks.filter((m) => m.channel === id).map((m) => `${m.mark} ${m.partners.join(',')}`);
    expect(byChannel('1')).toHaveLength(10000);
    expect(byChannel('1')).toEqual(byChannel('2'));
  });

  it('puts the lines typed on where the pane shows them', () => {
    const set: ChannelSet = {
      layout: 'single-file',
      self: null,
      members: resolved.sections.map((s) => ({ kind: 'section' as const, channel: s.channel, docId: 'perf', ranges: s.ranges })),
      missing: [],
      outside: resolved.outside,
      marks: resolved.marks,
      problems: [],
      truncated: false,
    };
    for (const channel of ['1', '2'] as const) {
      const projection = projectChannel(set, channel)!;
      for (const index of [65001, 70001, 80001]) {
        const at = channelLineAt(program, channel, index);
        expect(at.text, `${channel}:${index}`).toMatch(/^G01 X\d+\.\d{3} Z-\d+\.\d{3} F0\.2$/);
        expect(paneLineOf(projection, at.docLine), `${channel}:${index}`).toBe(at.paneLine);
      }
    }
  });
});

describe('the pair of section F (two 100,000-line programs that differ in 450 places)', () => {
  const pair = alignedPair();
  const K = ALIGNED_CHANGES;

  it('has the size, the differences and the typing line the section checks', () => {
    expect(pair.original).toHaveLength(ALIGNED_LINES);
    expect(pair.modified).toHaveLength(ALIGNED_LINES);
    expect(pair.expected).toEqual({ changed: K, onlyOriginal: K, onlyModified: K });
    const modified = new Set(pair.modified);
    const original = new Set(pair.original);
    expect(pair.original.filter((line) => !modified.has(line))).toHaveLength(2 * K);
    expect(pair.modified.filter((line) => !original.has(line))).toHaveLength(2 * K);
    expect(pair.original[pair.typing.originalLine - 1]).toBe(pair.modified[pair.typing.modifiedLine - 1]);
  });

  it('keeps every line unique, so the diff has an anchor on each side of every difference', () => {
    for (const side of [pair.original, pair.modified]) {
      const motion = side.filter((line) => line.startsWith('N'));
      expect(new Set(motion).size).toBe(motion.length);
      // unique once the block numbers are ignored, as the review options of a Fanuc program ignore them
      const bare = motion.map((line) => line.replace(/^N\d+\s+/, ''));
      expect(new Set(bare).size).toBe(bare.length);
    }
  });

  it('lines the differences up as constructed: a changed feed, a removed line and a new line, apart from one another', () => {
    const modified = new Set(pair.modified);
    const original = new Set(pair.original);
    const asWritten = (line: string): string => line.replace(/F900\.$/, 'F800.');
    const changed: number[] = [];
    const removed: number[] = [];
    pair.original.forEach((line, i) => {
      if (modified.has(line)) return;
      (modified.has(line.replace(/F800\.$/, 'F900.')) ? changed : removed).push(i + 1);
    });
    const added = pair.modified.flatMap((line, i) => (original.has(line) || original.has(asWritten(line)) ? [] : [i + 1]));
    expect(changed).toHaveLength(K);
    expect(removed).toHaveLength(K);
    expect(added).toHaveLength(K);
    // apart from one another in the original's lines (the new lines sit after the line they follow), and from the typing line
    const all = [...changed, ...removed].sort((a, b) => a - b);
    for (let n = 1; n < all.length; n++) expect(all[n] - all[n - 1], `differences at ${all[n - 1]} and ${all[n]}`).toBeGreaterThanOrEqual(200);
    for (const at of all) expect(Math.abs(at - pair.typing.originalLine)).toBeGreaterThanOrEqual(100);
    for (const at of added) expect(Math.abs(at - pair.typing.modifiedLine)).toBeGreaterThanOrEqual(100);
  });

  it('refuses a program too short for its differences', () => {
    expect(() => alignedPair({ lines: 2000, changes: 150 })).toThrow(/too short/);
  });
});
