// The helpers and lists of the P4b runtime scenarios (`p4-machines`, `p4-cycles`, `p4-cycles-time`, `p4-perf` sections B and C) that can be
// held without the app: the suite, the form ids against the script headers, the lists of bundled scripts, and the oracle and the totals
// of the 300,000-line sections (`tests/runtime/scenarios/p4-cycles-common.js`, `tests/fixtures/p4b/harness/README.md`).

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenarios } from '../runtime/lib/index.js';
import { BUNDLED } from '../runtime/scenarios/m5-common.js';
import {
  CHOICE_LABELS,
  DRILL,
  DRILL_GROUP_LINES,
  EXPAND_FIELDS,
  PREFILLED,
  TIME_FIELDS,
  beforeMachineSentence,
  checkDrillExpansion,
  clock,
  csvRows,
  drillProgram,
  largeProgramTotals,
  walkLines,
} from '../runtime/scenarios/p4-cycles-common.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const scriptsDir = join(root, 'src-tauri', 'resources', 'scripts');
const fixtureDir = join(root, 'tests', 'fixtures', 'p4b', 'harness');
const lines = (text: string): string[] => text.replace(/\r?\n$/, '').split(/\r?\n/);

/** The `[[params]]` of a script's header: id, prefill and the labels of its choices, in order. */
function header(script: string): { id: string; prefill?: string; labels: string[] }[] {
  const source = readFileSync(join(scriptsDir, `${script}.py`), 'utf8');
  const block = source.slice(0, source.indexOf('# ///', source.indexOf('# /// gedit') + 1));
  return block
    .split('# [[params]]')
    .slice(1)
    .map((part) => ({
      id: /# id = "([^"]+)"/.exec(part)?.[1] ?? '',
      prefill: /# prefill = "([^"]+)"/.exec(part)?.[1],
      labels: [...part.matchAll(/label = "([^"]+)", value = "([^"]+)"/g)].map((m) => `${m[2]}=${m[1]}`),
    }));
}

describe('the P4b suite', () => {
  const suite = readFileSync(join(root, 'tests', 'runtime', 'suites', 'p4b.txt'), 'utf8')
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter((line) => line !== '');

  it('lists p4-machines, p4-cycles and p4-cycles-time, and each is a registered scenario', async () => {
    await import('../runtime/scenarios/p4-machines.js');
    await import('../runtime/scenarios/p4-cycles.js');
    await import('../runtime/scenarios/p4-cycles-time.js');
    expect(suite).toEqual(['p4-machines', 'p4-cycles', 'p4-cycles-time']);
    for (const name of suite) expect(scenarios.get(name), name).toBeDefined();
  });

  it('has p4-perf, with the two sections of P4b, in the suite of P4a and not in its own', async () => {
    await import('../runtime/scenarios/p4-perf.js');
    const p4a = readFileSync(join(root, 'tests', 'runtime', 'suites', 'p4a.txt'), 'utf8');
    expect(p4a).toMatch(/^p4-perf$/m);
    expect(suite).not.toContain('p4-perf');
    const source = readFileSync(join(root, 'tests', 'runtime', 'scenarios', 'p4-perf.js'), 'utf8');
    expect(source).toContain("'B. Expand Drilling Cycles on the drilling program'");
    expect(source).toContain("'C. Statistics and Time on the simple program'");
    // seven runs of up to 930 s each, and the probe: the old 6600 s was the five of the first part
    expect(scenarios.get('p4-perf')?.options.timeout).toBeGreaterThanOrEqual(7 * 930);
    expect(scenarios.get('p4-perf')?.options.retry).toBe(false);
  });
});

describe('the forms of the two scripts follow their headers', () => {
  it('Expand Drilling Cycles: the field ids in order, both prefilled from the motion block', () => {
    const params = header('expand_cycles');
    expect(params.map((p) => p.id)).toEqual(EXPAND_FIELDS);
    for (const p of params) expect(p.prefill, p.id).toBe(PREFILLED[p.id]);
  });

  it('Statistics and Time: the field ids in order, every one but the output format prefilled, and the labels of every choice', () => {
    const params = header('time_estimate');
    expect(params.map((p) => p.id)).toEqual(TIME_FIELDS);
    for (const p of params) {
      if (p.id === 'format') expect(p.prefill).toBeUndefined();
      else expect(p.prefill, p.id).toBe(PREFILLED[p.id]);
      const labels = CHOICE_LABELS[p.id];
      if (p.labels.length > 0) expect(Object.entries(labels ?? {}).map(([value, label]) => `${value}=${label}`), p.id).toEqual(p.labels);
      else expect(labels, p.id).toBeUndefined();
    }
  });
});

describe('the lists of bundled scripts', () => {
  it('m5-common.BUNDLED and the list of m4-scripts are the scripts the folder ships: every file with a gedit header, sorted', () => {
    const shipped = readdirSync(scriptsDir)
      .filter((f) => f.endsWith('.py') && /^# \/\/\/ gedit\s*$/m.test(readFileSync(join(scriptsDir, f), 'utf8')))
      .map((f) => `bundled:${f}`)
      .sort();
    expect(BUNDLED).toEqual(shipped);
    expect(shipped).toContain('bundled:expand_cycles.py');
    expect(shipped).toContain('bundled:time_estimate.py');
    const m4 = readFileSync(join(root, 'tests', 'runtime', 'scenarios', 'm4-scripts.js'), 'utf8');
    const listed = [...(/const BUNDLED = \[([\s\S]*?)\]/.exec(m4)?.[1] ?? '').matchAll(/'(bundled:[^']+)'/g)].map((m) => m[1]);
    expect(listed).toEqual(shipped);
  });
});

describe('the drilling program of p4-perf section B and the oracle that judges its expansion', () => {
  const input = lines(readFileSync(join(fixtureDir, 'drill-60.in.nc'), 'utf8'));
  const recorded = lines(readFileSync(join(fixtureDir, 'drill-60.out.nc'), 'utf8'));

  it('is what the recorded fixture is: drillProgram of 60 lines, the head, four groups of twelve lines, a filler line and the tail', () => {
    const made = drillProgram({ lines: 60 });
    expect(made).toContain('\r\n');
    expect(lines(made)).toEqual(input);
    expect(input).toHaveLength(60);
    expect(input[1]).toContain('WRITTEN FOR GEDIT');
    expect(input.filter((line) => /^G98 G81 /.test(line))).toHaveLength(4);
    expect(input.filter((line) => /^X\d+\.$/.test(line))).toHaveLength(4);
    expect(DRILL_GROUP_LINES).toBe(12);
  });

  it('has at least the lines asked for, and at 300,000 lines about 50,000 holes', () => {
    const big = lines(drillProgram({ lines: 300000 }));
    expect(big.length).toBeGreaterThanOrEqual(300000);
    expect(big.length).toBeLessThan(300000 + DRILL_GROUP_LINES);
    expect(big.filter((line) => /G81/.test(line))).toHaveLength(24999);
    expect(big[big.length - 1]).toBe('%');
  });

  it('accepts the expansion the script wrote for it (8 holes, 31 blocks)', () => {
    const { problems, holes } = checkDrillExpansion(input, recorded);
    expect(problems).toEqual([]);
    expect(holes).toBe(8);
    expect(recorded.length).toBe(input.length - 8 + 31);
  });

  it('refuses every way an expansion can be wrong', () => {
    /** The recorded expansion with one change, and what the oracle says about it. */
    const wrong = (change: (out: string[]) => string[]): string[] => checkDrillExpansion(input, change([...recorded])).problems;
    const at = (out: string[], pattern: RegExp, nth = 0): number => out.map((line, i) => (pattern.test(line) ? i : -1)).filter((i) => i >= 0)[nth] ?? -1;

    // a hole not drilled: its feed move to the depth is gone
    expect(wrong((out) => (out.splice(at(out, /^G1 Z-5\./, 2), 1), out)).join('\n')).toMatch(/not drilled to Z-5/);
    // the wrong feed
    expect(wrong((out) => ((out[at(out, /^G1 Z-5\. F150\./)] = 'G1 Z-5. F100.'), out)).join('\n')).toMatch(/not drilled to Z-5 at feed F150/);
    // the wrong depth
    expect(wrong((out) => ((out[at(out, /^G1 Z-5\./, 1)] = 'G1 Z-4.'), out)).join('\n')).toMatch(/not drilled/);
    // never back at the initial level
    expect(wrong((out) => ((out[at(out, /^G0 Z50/, 0)] = 'G0 Z40.'), out)).join('\n')).toMatch(/not left at rapid to the initial level/);
    // the way back at feed instead of rapid
    expect(wrong((out) => ((out[at(out, /^G0 Z50/, 0)] = 'G1 Z50.'), out)).join('\n')).toMatch(/not left at rapid/);
    // the R plane missed
    expect(wrong((out) => ((out[at(out, /^Z2\./, 0)] = 'Z3.'), out)).join('\n')).toMatch(/not reached at the R plane/);
    // a hole at the wrong place
    expect(wrong((out) => ((out[at(out, /^X10\./)] = 'X11.'), out)).join('\n')).toMatch(/\(X10 Y0\)/);
    // a cycle left in
    expect(wrong((out) => (out.splice(at(out, /^X10\./), 0, 'G98 G81 X10. Y0. Z-5. R2. F150.'), out)).join('\n')).toMatch(/still runs a cycle/);
    // a line of the program that is no cycle block, changed
    expect(wrong((out) => ((out[at(out, /^G1 X5\. Y1\./)] = 'G1 X5. Y2. F800.'), out)).join('\n')).toMatch(/should be line \d+ of the result, unchanged/);
    // an extra line at the end, and one missing
    expect(wrong((out) => [...out, 'M30'])).not.toEqual([]);
    expect(wrong((out) => out.slice(0, -1))).not.toEqual([]);
    // a move that is no part of the program, where the first cycle ends
    expect(wrong((out) => (out.splice(at(out, /^G80/, 0), 0, 'G0 X99.'), out)).join('\n')).toMatch(/end at X99/);
  });

  it('reads the words of a line the plain way: comments left out, G0 and G00 and G1 and G01 as the mode, a G10 or a G17 as none', () => {
    const states = walkLines(['G21 G17 (G1 X9.) G0 X1. Y2.', 'G01 Z-3. F150.', 'G10 L2 X7.', 'Z5.']);
    expect(states.map((s) => [s.x, s.y, s.z, s.mode, s.feed])).toEqual([
      [1, 2, null, 0, null],
      [1, 2, -3, 1, 150],
      [7, 2, -3, 1, 150],
      [7, 2, 5, 1, 150],
    ]);
  });
});

describe('the totals of a program of largeProgram\'s kind, worked out from its text', () => {
  it('counts the feed and the rapid length and the feed time of the moves whose start is known, and the others as not estimated', () => {
    const text = ['%', 'O1 (X)', 'G21 G17 G90 G94', 'T1 M6', 'G0 X0. Y0.', 'G43 Z25. H1 M8', 'G1 Z-1. F200.', 'G1 X3. Y4. F600.', 'G0 Z25.', 'M30', '%'].join('\r\n');
    const totals = largeProgramTotals(text);
    // The first two moves start where the program has not said it stands; the plunge from Z25 is 26 mm at F200, the move 5 mm at F600, the rapid 26 mm.
    expect(totals.notEstimated).toBe(2);
    expect(totals.feedLength).toBeCloseTo(31, 9);
    expect(totals.rapidLength).toBeCloseTo(26, 9);
    expect(totals.feedTime).toBeCloseTo((26 / 200) * 60 + (5 / 600) * 60, 9);
  });
});

describe('the CSV and the table helpers of p4-cycles-time', () => {
  it('turns the one decimal of a CSV time into the clock the table shows, and leaves "not set" alone', () => {
    expect(clock('72.9')).toBe('1:12.9');
    expect(clock('0.1')).toBe('0:00.1');
    expect(clock('105.3')).toBe('1:45.3');
    expect(clock('3723.4')).toBe('1:02:03.4');
    expect(clock('not set')).toBe('not set');
  });

  it('reads the CSV of the golden with its quoted header cell', () => {
    const csv = readFileSync(join(root, 'tests', 'fixtures', 'scripts', 'statistics', 'fanuc-mill-g81-g83', 'expected.csv'), 'utf8');
    const rows = csvRows(csv);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveLength(11);
    expect(rows[0][10]).toBe('Not estimated, by kind and line');
    expect(rows[3].slice(0, 3)).toEqual(['Total', '403.29', '621.64']);
    expect(rows[3][10]).toBe('position-unknown 5-6');
  });

  it('cuts a golden message before the sentence about the machine', () => {
    expect(beforeMachineSentence('Expanded 3 cycles (3 holes) into 12 blocks. No machine chosen: a word whose reading depends on the machine would refuse the run.')).toBe('Expanded 3 cycles (3 holes) into 12 blocks.');
    expect(beforeMachineSentence('Nothing to cut.')).toBe('Nothing to cut.');
  });

  it('knows the cycle the drilling program is built from', () => {
    expect(DRILL).toEqual({ depth: -5, plane: 2, level: 50, feed: 150, travelFeed: 800 });
  });
});
