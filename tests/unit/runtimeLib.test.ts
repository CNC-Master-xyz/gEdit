// The pure helpers of the runtime harness's scenarios (tests/runtime/lib), held to the
// cases a hosted run found, so a scenario's expectation is wrong in `npm test` first and
// not only on the runner.

import { describe, expect, it } from 'vitest';
import { expectedEnd, selectsSegment } from '../runtime/lib/segments.js';
import { awaitReport } from '../runtime/lib/awaitReport.js';
import { mayRetry } from '../runtime/lib/retry.js';
import { scenarios } from '../runtime/lib/index.js';
import { CHOICES, DEFAULTS, FORM_IDS, arcProgram, nearDifferences, wantedArcLine } from '../runtime/scenarios/p4-geometry-common.js';
import { trimBlankEnd } from '$lib/contrib/segments';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Selection = { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
const select = (a: number, b: number, c: number, d: number): Selection => ({ startLineNumber: a, startColumn: b, endLineNumber: c, endColumn: d });

describe('the tool-segment expectation of m10-blockskip', () => {
  // tests/fixtures/nc/fanuc/f01-mill-3tools.nc: 67 lines, the last is `%`, and the file ends in
  // CRLF, so the editor has an empty line 68 and the outline's third tool item ends on it.
  const lines = Array.from({ length: 68 }, (_v, i) => (i === 66 ? '%' : i === 67 ? '' : `G1 X${i}`));
  const lineAt = (n: number): string => lines[n - 1] ?? '';

  it('ends the last segment on the last line with text, as the command does', () => {
    expect(expectedEnd(49, 68, lineAt)).toBe(67);
    expect(expectedEnd(49, 68, lineAt)).toBe(trimBlankEnd(49, 68, lineAt));
  });

  it('accepts the selection the CI run recorded for tool 3: 49:1 to 67:2', () => {
    expect(selectsSegment(select(49, 1, 67, 2), 49, 68, lineAt)).toBe(true);
  });

  it('refuses a selection that includes the blank line, or stops short', () => {
    expect(selectsSegment(select(49, 1, 68, 1), 49, 68, lineAt)).toBe(false);
    expect(selectsSegment(select(49, 1, 66, 7), 49, 68, lineAt)).toBe(false);
    expect(selectsSegment(select(50, 1, 67, 2), 49, 68, lineAt)).toBe(false);
  });

  it('keeps the end of a segment that is followed by the next tool change', () => {
    expect(expectedEnd(5, 14, lineAt)).toBe(14);
    expect(selectsSegment(select(5, 1, 14, 'G1 X13'.length + 1), 5, 14, lineAt)).toBe(true);
  });

  it('never ends above its first line', () => {
    expect(expectedEnd(68, 68, lineAt)).toBe(68);
    expect(expectedEnd(70, 40, () => '')).toBe(70);
  });
});

describe('awaiting the report of a script started from the Tools tab', () => {
  // A fake clock: waitFor advances it by the interval until the probe answers or the timeout is over.
  const world = (reportAt: number, formAt: number | null = null) => {
    let clock = 0;
    let answered: number | null = null;
    const io = {
      now: () => clock,
      waitFor: async <T>(fn: () => T, options: { timeout: number; interval?: number }): Promise<T | undefined> => {
        const end = clock + options.timeout;
        for (;;) {
          const v = fn();
          if (v || clock >= end) return v;
          clock += options.interval ?? 50;
        }
      },
      formOpen: () => formAt !== null && answered === null && clock >= formAt,
      arrived: () => (clock >= reportAt && (formAt === null || answered !== null) ? { title: 'report' } : null),
      answerForm: async () => {
        answered = clock;
        return clock;
      },
    };
    return io;
  };

  it('waits as long as a script without a form takes: 90 s on 300,000 lines is not "no report"', async () => {
    const got = await awaitReport(world(90000), 330000);
    expect(got.how).toBe('report');
    expect(got.report).toEqual({ title: 'report' });
    expect(got.form).toBe(false);
    expect(got.ms).toBeGreaterThanOrEqual(90000);
  });

  it('answers a form when one comes, and times the run from OK', async () => {
    const got = await awaitReport(world(12000, 500), 60000);
    expect(got.form).toBe(true);
    expect(got.report).toEqual({ title: 'report' });
    expect(got.ms).toBeGreaterThanOrEqual(11000);
    expect(got.ms).toBeLessThan(12000);
  });

  it('says it was neither a form nor a report when the whole timeout passes', async () => {
    const got = await awaitReport(world(1e9), 60000);
    expect(got.how).toBe('nothing');
    expect(got.report).toBeNull();
  });

  it('gives a form its own full timeout after OK', async () => {
    const got = await awaitReport(world(5e5, 500), 100000);
    expect(got.how).toBe('form');
    expect(got.report).toBeNull();
    expect(got.ms).toBeGreaterThanOrEqual(100000);
  });
});

describe('which scenarios suite.sh may run a second time', () => {
  it('retries a failed scenario unless the suite or the scenario says no', () => {
    expect(mayRetry(true, {})).toBe(true);
    expect(mayRetry(true, undefined)).toBe(true);
    expect(mayRetry(true, { timeout: 90 })).toBe(true);
    expect(mayRetry(false, {})).toBe(false);
    expect(mayRetry(true, { retry: false })).toBe(false);
    expect(mayRetry(false, { retry: false })).toBe(false);
  });

  it('never retries p4-perf: its runs are minutes long on 300,000 lines, and a retry would double the job', async () => {
    await import('../runtime/scenarios/p4-perf.js');
    const options = scenarios.get('p4-perf')?.options;
    expect(options).toBeDefined();
    expect(mayRetry(true, options)).toBe(false);
    // Its own timeout covers five runs that the app kills at 900 s each, and the job limit of harness.yml covers it.
    expect(options?.timeout).toBeGreaterThanOrEqual(5 * 930);
  });
});

describe('the arc-heavy program and the angled expectations of p4-perf', () => {
  it('writes arcs whose centre vector fits the start and the end to the fourth place', () => {
    const lines = arcProgram({ lines: 3000 }).split('\r\n');
    expect(lines.length - 1).toBeGreaterThanOrEqual(3000);
    expect(lines[1]).toBe('O9002 (ARCS 300K)');
    const arcs = lines.filter((line) => /^G[23] /.test(line));
    expect(arcs.length).toBeGreaterThan(lines.length * 0.9);
    let at: [number, number] | null = null;
    let checked = 0;
    for (const line of lines) {
      const num = (letter: string) => Number(new RegExp(`${letter}(-?\\d+\\.\\d+)`).exec(line)?.[1]);
      const arc = /^G[23] /.test(line);
      if (arc && at) {
        const [i, j] = [num('I'), num('J')];
        const centre: [number, number] = [at[0] + i, at[1] + j];
        const start = Math.hypot(at[0] - centre[0], at[1] - centre[1]);
        const end = Math.hypot(num('X') - centre[0], num('Y') - centre[1]);
        expect(Math.abs(start - end)).toBeLessThan(0.0005);
        checked++;
      }
      if (/^G[0123] X/.test(line)) at = [num('X'), num('Y')];
    }
    expect(checked).toBeGreaterThan(2500);
  });

  it('turns points as points and centre vectors as vectors, and swaps G2 and G3 only under a mirror', () => {
    const arc = 'G3 X1.0000 Y0.0000 I-1.0000 J2.0000 F800.';
    expect(wantedArcLine('rotate', arc, { angle: 90 })).toBe('G3 X0 Y1 I-2 J-1 F800.');
    expect(wantedArcLine('rotate', arc, { angle: 90, cx: 1, cy: 1 })).toBe('G3 X2 Y1 I-2 J-1 F800.');
    // A mirror about the X axis (angle 0) keeps X, negates Y and J, and turns the arc round.
    expect(wantedArcLine('mirror', 'G2 X1.0000 Y2.0000 I1.0000 J1.0000', { angle: 0 })).toBe('G3 X1 Y-2 I1 J-1');
    // The G21 of the head is not an arc, and a comment is left as it is.
    expect(wantedArcLine('mirror', 'G21 G17 (G2 X1. Y1.)', { angle: 0 })).toBe('G21 G17 (G2 X1. Y1.)');
    // About a line at 30 degrees through the origin the point (1, 0) goes to (cos 60, sin 60).
    expect(wantedArcLine('mirror', 'G1 X1.0000 Y0.0000', { angle: 30 })).toBe('G1 X0.5 Y0.866');
  });

  it('compares to one last place and to no more, and holds an unchanged line byte for byte', () => {
    const before = ['G1 X1.0000 Y2.0000', 'G1 Z-1.0000 F200.'];
    const wanted = ['G1 X3.5000 Y4.2500', 'G1 Z-1.0000 F200.'];
    expect(nearDifferences(before, ['G1 X3.5001 Y4.2500', 'G1 Z-1.0000 F200.'], wanted)).toEqual({ wrong: [], edge: 1 });
    expect(nearDifferences(before, ['G1 X3.5003 Y4.2500', 'G1 Z-1.0000 F200.'], wanted).wrong).toHaveLength(1);
    expect(nearDifferences(before, ['G1 X3.5000 Y4.2500', 'G1 Z-1.0001 F200.'], wanted).wrong).toHaveLength(1);
    expect(nearDifferences(before, ['G1 X3.5000 Y4.2500 I1.0', 'G1 Z-1.0000 F200.'], wanted).wrong).toHaveLength(1);
  });
});

describe('the form of the geometry scenarios follows the headers of the three scripts', () => {
  // A choice control carries the index of the choice as its value, so the order of CHOICES must be the
  // header's (the P4a review put "Automatic" first in mirror's list, which moved every other choice by one).
  const header = (script: string): { id: string; type: string; default?: string; values: string[] }[] => {
    const source = readFileSync(join('src-tauri', 'resources', 'scripts', `${script}.py`), 'utf8');
    const block = source.slice(0, source.indexOf('# ///', source.indexOf('# /// gedit') + 1));
    return block
      .split('# [[params]]')
      .slice(1)
      .map((part) => ({
        id: /# id = "([^"]+)"/.exec(part)?.[1] ?? '',
        type: /# type = "([^"]+)"/.exec(part)?.[1] ?? '',
        default: /# default = "?([^"\n]*?)"?\n/.exec(part)?.[1],
        values: [...part.matchAll(/value = "([^"]+)"/g)].map((m) => m[1] ?? ''),
      }));
  };

  for (const script of ['translate', 'rotate', 'mirror'] as const) {
    it(`${script}: the fields, the order of every choice list and the defaults`, () => {
      const params = header(script);
      expect(params.map((p) => p.id)).toEqual(FORM_IDS[script]);
      for (const p of params) {
        if (p.type === 'choice') expect(CHOICES[script]?.[p.id], `${script}.${p.id}`).toEqual(p.values);
        if (p.default !== undefined) expect(String(DEFAULTS[script]?.[p.id]), `${script}.${p.id}`).toBe(p.default);
      }
    });
  }

  it('mirror: the lathe golden picks "In Z" and the large-program run picks "In X"', () => {
    expect(CHOICES.mirror?.about?.[0]).toBe('auto');
    expect(CHOICES.mirror?.about?.indexOf('z')).toBe(4);
    expect(CHOICES.mirror?.about?.indexOf('y-axis')).toBe(1);
  });
});
