// T171: what the background reader costs the editor's thread on a 300,000-line program (a
// wall-clock budget; the m12-perf scenario holds the first resolution to 150 ms).
//
// On this thread the reader costs: masking the lines (done once, the plain reading reuses the
// memo), building the job, and posting it to the worker (a structured clone, which is what
// `postMessage` does; `structuredClone` is the closest thing node has: about 50 to 100 ms for
// 300,000 lines). The worker's own time is off this thread and is not measured here. The
// resolution then runs as a second task, without the masking, so no single task on this thread
// is longer than the one task of the plain reading was. A gross regression is what this guards
// (the job built twice, a second masking, a clone per pattern); the m12-perf scenario on the
// runner is the check of the 150 ms itself.

import { describe, expect, it } from 'vitest';
import { fanucWait, singleFile as single } from '../../../../tests/unit/helpers/channelRules';
import { cpOf } from '../../../../tests/unit/helpers/profiles';
import type { GuardRunner } from '../regexGuard/runner';
import { guardChannelPatterns, maskForMarks, resolveDocument, resolveDocumentGuarded } from './marks';
import type { ChannelParams } from './types';

const lathe = cpOf('fanuc-lathe');

const p: ChannelParams = { ...single, syncMarks: [fanucWait('digits')] };

function program(): string[] {
  const body = ['G01 X52.4 Z-30.2 F0.25', 'G00 X56. Z2. (RETRACT)', 'M901 P12', 'G01 Z-12.5 F0.1', 'M100', 'T0303 (OD FINISH)'];
  const lines: string[] = [];
  for (let i = 0; lines.length < 300_000; i++) {
    if (i % 5000 === 0) lines.push(i % 10000 === 0 ? 'O1001' : 'O2001');
    lines.push(body[i % body.length]);
  }
  return lines;
}

/** A reader that only pays what `postMessage` pays on this thread. */
const posting: GuardRunner = {
  run: (job) => {
    structuredClone(job);
    return Promise.resolve({ status: 'done', result: { probes: job.probes.map((x) => ({ id: x.id, status: 'ok' as const, matchedLines: 0 })) } });
  },
  dispose: () => undefined,
};

describe('the background reader on 300,000 lines', () => {
  it('costs the editor\'s thread less than 250 ms for the job and the post, the masking being shared with the plain reading', async () => {
    const lines = program();
    const masked: string[] = lines.map((l) => maskForMarks(l, lathe)); // what the plain reading needs anyway
    let best = Infinity;
    for (let round = 0; round < 3; round++) {
      const started = performance.now();
      const out = await guardChannelPatterns(posting, lines, lathe, p, { masked: (i) => masked[i] });
      best = Math.min(best, performance.now() - started);
      expect(out).toEqual({ ok: true, guarded: true });
    }
    expect(best, 'job and post of 300k masked lines').toBeLessThan(250);
  });

  it('resolves the same marks as the plain reading', async () => {
    const lines = program();
    const plain = resolveDocument('big.nc', lines, lathe, p, { deadline: Infinity });
    const guarded = await resolveDocumentGuarded(posting, 'big.nc', lines, lathe, p, { resolveMs: Infinity });
    expect(plain.marks).toHaveLength(20_000);
    expect(guarded.marks).toEqual(plain.marks);
  });

  it('masks each line once for the reader and the plain reading together', async () => {
    const lines = program().slice(0, 50_000);
    let masks = 0;
    const counting: GuardRunner = { ...posting };
    const memo: string[] = [];
    const masked = (i: number): string => {
      if (memo[i] === undefined) {
        masks++;
        memo[i] = maskForMarks(lines[i], lathe);
      }
      return memo[i];
    };
    await guardChannelPatterns(counting, lines, lathe, p, { masked });
    const after = masks;
    resolveDocument('big.nc', lines, lathe, p, { masked, deadline: Infinity });
    expect(after).toBe(lines.length);
    expect(masks).toBe(lines.length); // the plain reading asked for nothing new
  });
});
