// T227: a regular expression in Find All or Replace All that runs away is stopped and
// reported, not left to hang the editor. The runner is a spy or the real worker entry (bundled,
// in a Node thread); the unit project has no Web Worker.

import { beforeAll, describe, expect, it } from 'vitest';
import { cpOf } from '../../../../tests/unit/helpers/profiles';
import { createInlineRunner, createWorkerRunner, type GuardRunner } from '../regexGuard/runner';
import type { GuardJob } from '../regexGuard/job';
import { bundleGuardWorker, nodeSpawner } from '../regexGuard/nodeWorker.testkit';
import { findInLinesGuarded, guardQuery, needsGuard, replaceInLinesGuarded } from './guard';
import { findInLines, parseQuery, patternOf, replaceInLines } from './index';
import type { SearchFlags, SearchQuery } from './types';

const fanuc = cpOf('fanuc-lathe');
const TEXT: SearchFlags = { wholeAddress: false, regex: false, caseSensitive: false, inComments: false };

function query(text: string, over: Partial<SearchFlags> = {}): SearchQuery {
  const q = parseQuery(text, fanuc, { ...TEXT, ...over });
  if ('error' in q) throw new Error(q.error.key);
  return q;
}

/** A runner that records the jobs it is given and answers as told. */
function spy(answer: 'done' | 'timeout' | 'failed' = 'done') {
  const jobs: { job: GuardJob; budgetMs: number }[] = [];
  const runner: GuardRunner = {
    run(job, budgetMs) {
      jobs.push({ job, budgetMs });
      if (answer === 'timeout') return Promise.resolve({ status: 'timeout', budgetMs, probe: 'query' });
      if (answer === 'failed') return Promise.resolve({ status: 'failed', message: 'x' });
      return createInlineRunner().run(job, budgetMs);
    },
    dispose() {},
  };
  return { runner, jobs };
}

const LINES = ['N10 G1 X10. Y5.', 'N20 M901 P12', '(G1 in a comment)', 'N30 G01 X-3.'];

describe('which queries go to the worker', () => {
  it('sends a regular expression with syntax in it, and nothing else', () => {
    expect(needsGuard(query('G\\d+', { regex: true }))).toBe(true);
    expect(needsGuard(query('G1', { regex: true }))).toBe(false); // a plain literal cannot run away
    expect(needsGuard(query('(a+)+$', { regex: false }))).toBe(false); // searched as text, not as a pattern
    expect(needsGuard(query('G1', { wholeAddress: true }))).toBe(false);
  });

  it('never asks the worker for the others (the synchronous fast path)', async () => {
    const { runner, jobs } = spy();
    expect(await guardQuery(runner, LINES, query('G1', { regex: true }))).toBeNull();
    expect(await guardQuery(runner, LINES, query('(a+)+$'))).toBeNull();
    expect(await guardQuery(runner, LINES, query('G1', { wholeAddress: true }))).toBeNull();
    expect(jobs).toEqual([]);
  });
});

describe('guardQuery', () => {
  it('runs the pattern of the query over the same lines, as the scanner builds it', async () => {
    const insensitive = spy();
    await guardQuery(insensitive.runner, LINES, query('G\\d+', { regex: true }), { budgetMs: 1234 });
    expect(insensitive.jobs).toEqual([
      { job: { probes: [{ id: 'query', pattern: 'G\\d+', flags: 'gi', scan: 'all' }], lines: LINES }, budgetMs: 1234 },
    ]);
    const sensitive = spy();
    await guardQuery(sensitive.runner, LINES, query('G\\d+', { regex: true, caseSensitive: true }));
    expect(sensitive.jobs[0].job.probes[0].flags).toBe('g');
    // Whatever the scanner builds is what the worker runs, not a copy of its rule.
    const q = query('G\\d+/x', { regex: true });
    const mine = spy();
    await guardQuery(mine.runner, LINES, q);
    const re = patternOf(q as Extract<SearchQuery, { kind: 'text' }>);
    expect(mine.jobs[0].job.probes[0]).toMatchObject({ pattern: re.source, flags: re.flags });
  });

  it('answers a message in plain words when the pattern ran out of time', async () => {
    const { runner } = spy('timeout');
    expect(await guardQuery(runner, LINES, query('(a+)+$', { regex: true }), { budgetMs: 2000 })).toEqual({
      key: 'search.errorRegexSlow',
      params: { seconds: 2 },
    });
  });

  it('reads on when there is no worker or the worker broke', async () => {
    expect(await guardQuery(null, LINES, query('(a+)+$', { regex: true }))).toBeNull();
    expect(await guardQuery(spy('failed').runner, LINES, query('(a+)+$', { regex: true }))).toBeNull();
  });
});

describe('findInLinesGuarded and replaceInLinesGuarded', () => {
  it('give the answer of the plain functions once the pattern came through', async () => {
    const q = query('G0?1\\b', { regex: true });
    const { runner } = spy();
    expect(await findInLinesGuarded(runner, LINES, fanuc, q)).toEqual(findInLines(LINES, fanuc, q));
    expect(await replaceInLinesGuarded(runner, LINES, fanuc, q, 'G2')).toEqual(replaceInLines(LINES, fanuc, q, 'G2'));
    expect(await findInLinesGuarded(runner, LINES, fanuc, q, { max: 1 })).toMatchObject({ truncated: true });
  });

  it('change and find nothing when the pattern was stopped', async () => {
    const q = query('G\\d+', { regex: true });
    const { runner } = spy('timeout');
    const refused = { refused: { key: 'search.errorRegexSlow', params: { seconds: 2 } } };
    expect(await findInLinesGuarded(runner, LINES, fanuc, q)).toEqual(refused);
    expect(await replaceInLinesGuarded(runner, LINES, fanuc, q, 'G2')).toEqual(refused);
  });

  it('do not need the worker for a word query', async () => {
    const q = parseQuery('G1', fanuc, { ...TEXT, wholeAddress: true });
    if ('error' in q) throw new Error('word');
    const { runner, jobs } = spy('timeout');
    expect(await findInLinesGuarded(runner, LINES, fanuc, q)).toEqual(findInLines(LINES, fanuc, q));
    expect(jobs).toEqual([]);
  });
});

describe('a regular expression that really runs away (the real worker entry)', () => {
  let code = '';
  beforeAll(async () => {
    code = await bundleGuardWorker();
  });

  // `(a+)+$` takes twice as long with every extra letter before the `!`: 22 letters finish in
  // about 0.2 s on a current Node (V8 gets faster with each release, so that is no longer a
  // runaway), 32 letters take a minute or more. The test gives the worker 200 ms; on the editor's
  // thread (no guard) it would not return.
  const runaway = [...LINES, `${'a'.repeat(32)}!`];

  it('is stopped and reported by Find, with no hits', async () => {
    const spawner = nodeSpawner(code);
    const runner = createWorkerRunner({ spawn: spawner.spawn });
    try {
      const started = performance.now();
      const out = await findInLinesGuarded(runner, runaway, fanuc, query('(a+)+$', { regex: true }), { budgetMs: 200 });
      expect(out).toEqual({ refused: { key: 'search.errorRegexSlow', params: { seconds: 1 } } });
      expect(performance.now() - started).toBeLessThan(1000);
      expect(spawner.stopped()).toBe(1);
      // The worker was started again: the next query works.
      const next = await findInLinesGuarded(runner, runaway, fanuc, query('G0?1\\b', { regex: true }));
      expect('hits' in next && next.hits.length).toBe(2);
      expect(spawner.started()).toBe(2);
    } finally {
      runner.dispose();
    }
  });

  it('is stopped and reported by Replace, and the lines are not touched', async () => {
    const runner = createWorkerRunner({ spawn: nodeSpawner(code).spawn });
    try {
      const out = await replaceInLinesGuarded(runner, runaway, fanuc, query('(a+)+$', { regex: true }), '', { budgetMs: 200 });
      expect(out).toMatchObject({ refused: { key: 'search.errorRegexSlow' } });
      expect('lines' in out).toBe(false);
    } finally {
      runner.dispose();
    }
  });
});
