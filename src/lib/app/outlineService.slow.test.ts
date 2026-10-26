// The cost of the program map of a big program: with channels after an edit, and the last stage of
// its first build (wall-clock budgets).
// What the map holds is in `outlineService.test.ts` (same folder).

import { writable } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { expectWithin, fastest } from '../../../tests/unit/helpers/budget';
import { big, harness } from '../../../tests/unit/helpers/outlineHarness';
import { cpOf } from '../../../tests/unit/helpers/profiles';
import { OutlineIndex } from '$lib/core/profiles/outline';
import { AGGREGATE_LINES, AGGREGATE_MARKS } from './outlineService';

describe('the program map of a big program with channels (M12 performance fix F1)', () => {
  it('publishes the grouped map of 300k lines with 20,000 waits after an edit within the outline budget (G7)', () => {
    const { lines, set } = big(150_000);
    const h = harness({ channels: { forDoc: () => set, revision: writable(0), ruleLabel: () => '' }, chunkLines: 20_000 });
    const id = h.add(lines.join('\n'));
    h.flush();
    let n = 0;
    const ms = fastest(3, () => {
      h.edit(id, 20_000 + (n++ % 2), n % 2 === 0 ? 'T09 M6' : 'G01 X1.');
      h.flush();
    });
    // The index's own aggregation is P1's; the grouping and the row reuse add little to it.
    expectWithin(ms, 200, 'grouped map after an edit, 300k lines, 20,000 waits');
  });
});

// T136: the last stage of the first build. With 30,000 rows the tree used to be made in one
// stretch inside the slice that read the last line (30 to 95 ms here, 100 to 230 ms on a busy Mac);
// it is made in runs now. The run is counted in lines and marks, so what is held to a budget is
// the run a slice can overshoot by. The 95th percentile of the runs is the figure: a pause of the
// garbage collector inside one run (10 to 20 ms, in the reading stage as much as in this one) is the
// engine's and not the code's, and a run that is a long stretch again shows in every percentile.
describe('the last stage of the first build of a large program (T136)', () => {
  const LINES = 300_000;
  const SHAPES: [string, string, string[]][] = [
    [
      'okuma-osp',
      'okuma-osp',
      ['N%N% G00 X400 Z300', 'NLAP1 G85 (BAR TURNING)', 'N%N% G96 S180 M03', 'N%N% T0202 (55 DEG INSERT)', 'N%N% G01 X56.123 Z-40.5 F0.28', 'N%N% SB=1200 M13', 'N%N% X=V1+V2 Z=V3', '/N%N% IF [V1 EQ 5] GOTO NLAP1', 'N%N% G04 F2', ''],
    ],
    [
      'sinumerik',
      'sinumerik',
      ['N%N% G18 G95 G90', 'N%N% T="DRILL_D8" D1', 'N%N% MSG("ROUGH;FINISH")', 'N%N% CYCLE83(50,0,2,-25,,-5)', 'N%N% G1 X56.123 Z-40.5 F0.28 ;CUT', 'N%N% G26 S3=2500 LIMS=3000', 'N%N% R1=R2*2 X=AC(10)', 'LOOP_A: G0 X200 Z200', '/1 N%N% $AA_IM[X]', ':%N% G1 X1.5EX3 Z-2EX-4', '/1 /3 N%N% LIMS[2]=1800 S[SPI]=300 M[2]=3', 'N%N% T[1]="DRILL_8" FA[X]=200', ''],
    ],
    [
      'fanuc-gcode',
      'fanuc-gcode',
      ['O1001 (PART)', '(ROUGHING)', 'N%N% T1 M6', 'N%N% G43 Z25. H1 M8', 'N%N% G1 X50.123 Y-40.5 F1200.', 'N%N% G1 X51.123 Y-40.5', 'N%N% M1', 'N%N% G1 Z-1.5 F200.', 'N%N% M98 P1000', 'N%N% G1 X52.123 Y-40.5'],
    ],
  ];

  function program(source: string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < LINES; i++) out.push(source[i % source.length].replace('%N%', String((i % 9999) * 10)));
    return out;
  }

  it.each(SHAPES)('%s: the runs of the aggregation of 300,000 lines are short, and the tree is the one made at once', (_name, profileId, source) => {
    const cp = cpOf(profileId);
    const lines = program(source);
    let p95 = Infinity;
    let p50 = 0;
    let max = 0;
    let whole = Infinity;
    let runs = 0;
    for (let round = 0; round < 3; round++) {
      const outline = new OutlineIndex(cp);
      outline.reset(lines);
      const took: number[] = [];
      for (;;) {
        const started = performance.now();
        const done = outline.aggregateSome(AGGREGATE_LINES, AGGREGATE_MARKS);
        took.push(performance.now() - started);
        if (done) break;
      }
      took.sort((a, b) => a - b);
      runs = took.length;
      if (took[Math.floor(runs * 0.95)] < p95) {
        p95 = took[Math.floor(runs * 0.95)];
        p50 = took[Math.floor(runs / 2)];
        max = took[runs - 1];
      }
      const tree = JSON.stringify(outline.items());

      const atOnce = new OutlineIndex(cp);
      atOnce.reset(lines);
      const started = performance.now();
      const items = atOnce.items();
      whole = Math.min(whole, performance.now() - started);
      expect(JSON.stringify(items)).toBe(tree);
    }
    // The stage is in many runs, not one stretch.
    expect(runs).toBeGreaterThan(50);
    expectWithin(p95, 8, `95th percentile of ${runs} runs (median ${p50.toFixed(2)}, longest ${max.toFixed(1)}; aggregated at once: ${whole.toFixed(0)} ms)`);
  }, 120_000);
});
