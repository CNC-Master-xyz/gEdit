// T171: the user's own channel patterns run first in the guard worker, so a pattern that runs
// away is stopped and named instead of freezing the editor. The runner is a spy or the real
// worker entry (bundled, in a Node thread); the unit project has no Web Worker.

import { beforeAll, describe, expect, it } from 'vitest';
import { fanucWait, singleFile } from '../../../../tests/unit/helpers/channelRules';
import { cpOf } from '../../../../tests/unit/helpers/profiles';
import type { GuardJob } from '../regexGuard/job';
import { createInlineRunner, createWorkerRunner, type GuardRunner } from '../regexGuard/runner';
import { bundleGuardWorker, nodeSpawner } from '../regexGuard/nodeWorker.testkit';
import { guardChannelPatterns, resolveDocument, resolveDocumentGuarded, userPatterns } from './marks';
import { CHANNEL_CAPS, type ChannelParams } from './types';

const cp = cpOf('fanuc-lathe');

function spy(answer: 'done' | 'timeout' | 'failed' = 'done', probe: string | null = null) {
  const jobs: { job: GuardJob; budgetMs: number }[] = [];
  const runner: GuardRunner = {
    run(job, budgetMs) {
      jobs.push({ job, budgetMs });
      if (answer === 'timeout') return Promise.resolve({ status: 'timeout', budgetMs, probe });
      if (answer === 'failed') return Promise.resolve({ status: 'failed', message: 'x' });
      return createInlineRunner().run(job, budgetMs);
    },
    dispose() {},
  };
  return { runner, jobs };
}

const multi: ChannelParams = {
  layout: 'multi-file',
  list: [
    { id: '1', name: 'Path 1' },
    { id: '2', name: 'Path 2' },
  ],
  marker: '^\\(CHANNEL (?<channel>\\d)\\)',
  fileName: '_(?<channel>[12])$',
  syncMarks: [
    { id: 'rx', label: 'rx', match: { kind: 'regex', pattern: '(?<mark>WAIT\\d+)' }, partners: { kind: 'line', pattern: 'FOR (?<channels>[\\d,]+)' } },
    { id: 'lit', label: 'lit', match: { kind: 'regex', pattern: 'SYNC' }, partners: { kind: 'all' } },
    { id: 'codes', label: 'c', match: { kind: 'codes', codes: 'M900-M999' }, partners: { kind: 'word', address: 'P', decode: 'digits' } },
  ],
};

describe('userPatterns', () => {
  it('lists the single-file patterns and the rule patterns, not the generated matchers', () => {
    const p: ChannelParams = { ...singleFile, syncMarks: [fanucWait('digits'), multi.syncMarks![0]] };
    expect(userPatterns(p)).toEqual([
      { path: 'sectionStart', pattern: singleFile.sectionStart, reads: 'masked' },
      { path: 'sectionEnd', pattern: singleFile.sectionEnd, reads: 'masked' },
      { path: 'syncMarks[1].match.pattern', pattern: '(?<mark>WAIT\\d+)', reads: 'masked' },
      { path: 'syncMarks[1].partners.pattern', pattern: 'FOR (?<channels>[\\d,]+)', reads: 'masked' },
    ]);
  });

  it('lists the marker of a multi-file block (the head, as written) and skips plain literals and the file name pattern', () => {
    expect(userPatterns(multi).map((u) => [u.path, u.reads])).toEqual([
      ['marker', 'head'],
      ['syncMarks[0].match.pattern', 'masked'],
      ['syncMarks[0].partners.pattern', 'masked'],
    ]); // `SYNC` is a literal; `fileName` reads one name; `codes` is generated
  });

  it('skips a pattern over the length cap (compile refuses it) and a non-string', () => {
    const p = { ...singleFile, sectionStart: 'a+'.repeat(CHANNEL_CAPS.patternLength), sectionEnd: 5 } as unknown as ChannelParams;
    expect(userPatterns(p)).toEqual([]);
  });
});

describe('guardChannelPatterns', () => {
  const lines = ['O1000 (M901)', 'G1 X1', 'x'.repeat(CHANNEL_CAPS.lineLength + 1), 'M30'];

  it('sends the masked lines, a blank for a line too long to read, with the rule flags and "first" scan', async () => {
    const { runner, jobs } = spy();
    const out = await guardChannelPatterns(runner, lines, cp, singleFile);
    expect(out).toEqual({ ok: true, guarded: true });
    expect(jobs).toHaveLength(1);
    const { job, budgetMs } = jobs[0];
    expect(budgetMs).toBe(2000);
    expect(job.probes.map((x) => [x.id, x.flags, x.scan])).toEqual([
      ['sectionStart', 'i', 'first'],
      ['sectionEnd', 'i', 'first'],
    ]);
    expect(job.lines).toEqual([`O1000 ${' '.repeat('(M901)'.length)}`, 'G1 X1', '', 'M30']); // the comment blanked, the long line not sent
  });

  it('uses the caller\'s masked lines, so none is masked twice', async () => {
    const { runner, jobs } = spy();
    const asked: number[] = [];
    await guardChannelPatterns(runner, ['a', 'b'], cp, singleFile, { masked: (i) => (asked.push(i), `m${i}`) });
    expect(jobs[0].job.lines).toEqual(['m0', 'm1']);
    expect(asked).toEqual([0, 1]);
  });

  it('gives the marker its own job: the first 400 lines as written, comments kept', async () => {
    const { runner, jobs } = spy();
    const head = Array.from({ length: CHANNEL_CAPS.markerLines + 50 }, (_, i) => (i === 0 ? '(CHANNEL 2)' : `N${i}`));
    await guardChannelPatterns(runner, head, cp, multi);
    expect(jobs.map((j) => j.job.probes.map((x) => x.id))).toEqual([['syncMarks[0].match.pattern', 'syncMarks[0].partners.pattern'], ['marker']]);
    expect(jobs[1].job.lines).toHaveLength(CHANNEL_CAPS.markerLines);
    expect(jobs[1].job.lines[0]).toBe('(CHANNEL 2)');
    expect(jobs[0].job.lines[0]).toBe(' '.repeat('(CHANNEL 2)'.length)); // masked: the comment is blank
  });

  it('does not ask the worker when no pattern needs it', async () => {
    const { runner, jobs } = spy();
    const plain: ChannelParams = { ...multi, marker: undefined, syncMarks: [fanucWait('digits')] };
    expect(await guardChannelPatterns(runner, lines, cp, plain)).toEqual({ ok: true, guarded: false });
    expect(await guardChannelPatterns(null, lines, cp, singleFile)).toEqual({ ok: true, guarded: false });
    expect(jobs).toEqual([]);
  });

  it('names the pattern that ran out of time, as the user wrote it, shortened if long', async () => {
    const { runner } = spy('timeout', 'syncMarks[0].match.pattern');
    const out = await guardChannelPatterns(runner, lines, cp, multi, { budgetMs: 1500 });
    expect(out).toEqual({
      ok: false,
      problem: { path: 'syncMarks[0].match.pattern', message: { key: 'channels.problems.patternStopped', params: { pattern: '(?<mark>WAIT\\d+)', seconds: 2 } } },
    });
    const longOne = `(${'a'.repeat(80)})+$`;
    const slow = spy('timeout', 'sectionStart');
    const shown = await guardChannelPatterns(slow.runner, lines, cp, { ...singleFile, sectionStart: longOne });
    expect(shown.ok === false && shown.problem.message.params?.pattern).toBe(`${longOne.slice(0, 57)}...`);
  });

  it('reads on (guarded: false) when the worker broke', async () => {
    expect(await guardChannelPatterns(spy('failed').runner, lines, cp, singleFile)).toEqual({ ok: true, guarded: false });
  });
});

describe('resolveDocumentGuarded', () => {
  const program = ['O1000 (CHANNEL 1)', 'M901 P12', 'M30', 'O2000', 'M901 P12', 'M30'];
  const p: ChannelParams = { ...singleFile, sectionStart: '^O(?<channel>[12])\\d{3}(?![\\d.])' };

  it('gives resolveDocument\'s answer once the patterns came through', async () => {
    const { runner } = spy();
    const guarded = await resolveDocumentGuarded(runner, '', program, cp, p);
    const plain = resolveDocument('', program, cp, p);
    expect(guarded.layout).toBe('single-file');
    expect(guarded).toEqual(plain);
  });

  it('reads nothing on the editor\'s thread when a pattern was stopped, and says which', async () => {
    const { runner } = spy('timeout', 'sectionStart');
    const out = await resolveDocumentGuarded(runner, '', program, cp, p);
    // The same program resolves to two sections without the guard's refusal.
    expect(resolveDocument('', program, cp, p).sections).toHaveLength(2);
    expect(out).toMatchObject({ layout: 'none', marks: [], sections: [], outside: [], abandoned: false, patternStopped: true });
    expect(out.problems.map((x) => [x.path, x.message.key])).toEqual([['sectionStart', 'channels.problems.patternStopped']]);
  });

  it('keeps the budget of the synchronous pass for itself: it starts after the guard', async () => {
    let clock = 0;
    const slowGuard: GuardRunner = {
      run(job) {
        clock += 5000; // the worker took 5 s of the caller's clock
        return createInlineRunner().run(job, 0);
      },
      dispose() {},
    };
    const out = await resolveDocumentGuarded(slowGuard, '', program, cp, p, { now: () => clock, resolveMs: 500 });
    expect(out.abandoned).toBe(false);
    expect(out.layout).toBe('single-file');
  });
});

describe('resolveDocument with the caller\'s masked lines', () => {
  it('reads each line through the memo it is given, in both layouts, and answers as without', () => {
    const program = ['O1000', 'M901 P12', 'M30', 'O2000', 'M901 P12', 'M30'];
    const asked: number[] = [];
    const masked = (i: number): string => (asked.push(i), program[i]);
    const withMemo = resolveDocument('', program, cp, singleFile, { masked });
    expect(withMemo).toEqual(resolveDocument('', program, cp, singleFile));
    expect(new Set(asked).size).toBe(program.length);
    const m = { ...multi, syncMarks: [fanucWait('digits')] };
    const seen: number[] = [];
    const out = resolveDocument('PART_1', ['M901 P12'], cp, m, { masked: (i) => (seen.push(i), 'M901 P12') });
    expect(out.marks.map((x) => x.mark)).toEqual(['M901']);
    expect(seen).toEqual([0]);
  });
});

describe('a channel pattern that really runs away (the real worker entry)', () => {
  let code = '';
  beforeAll(async () => {
    code = await bundleGuardWorker();
  });

  // `(a+)+$` takes twice as long with every extra letter before the `!`: 22 letters finish in
  // about 0.2 s on a current Node (no runaway), 32 letters take a minute or more.
  const runaway: ChannelParams = { ...singleFile, sectionEnd: '(a+)+$' };
  const program = ['O1000', 'G1 X1', `${'a'.repeat(32)}!`, 'M30'];

  it('is stopped in the worker and named; the editor thread reads nothing', async () => {
    const spawner = nodeSpawner(code);
    const runner = createWorkerRunner({ spawn: spawner.spawn });
    try {
      const started = performance.now();
      const out = await resolveDocumentGuarded(runner, '', program, cp, runaway, { budgetMs: 200 });
      expect(out).toMatchObject({ layout: 'none', patternStopped: true });
      expect(out.problems[0]).toEqual({
        path: 'sectionEnd',
        message: { key: 'channels.problems.patternStopped', params: { pattern: '(a+)+$', seconds: 1 } },
      });
      expect(performance.now() - started).toBeLessThan(1000);
      expect(spawner.stopped()).toBe(1);
      // A sound block still resolves afterwards, on a new worker.
      const fine = await resolveDocumentGuarded(runner, '', program, cp, singleFile);
      expect(fine.layout).toBe('single-file');
      expect(spawner.started()).toBe(2);
    } finally {
      runner.dispose();
    }
  });
});
