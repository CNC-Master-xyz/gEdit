// The regular-expression guard (T171, T227): the job, the worker's message loop, and the
// runner with its time budget and terminate-and-respawn. The unit project has no Worker, so the
// runner is driven with a fake worker and a clock advanced by hand (a timeout is exact, not a
// race), and one test runs the real entry file, bundled, in a Node worker thread against a
// pattern that really runs away.

import { beforeAll, describe, expect, it } from 'vitest';
import { GUARD_BUDGET_MS, guardJob } from './guard';
import { isLiteralPattern, runGuardJob, type GuardJob, type GuardProbe } from './job';
import { createInlineRunner, createWorkerRunner, type GuardTimers, type WorkerLike } from './runner';
import { installGuardWorker, type GuardReply, type GuardWorkerScope } from './worker';
import { bundleGuardWorker, nodeSpawner } from './nodeWorker.testkit';

const probe = (over: Partial<GuardProbe> = {}): GuardProbe => ({ id: 'p', pattern: 'M9\\d\\d', flags: 'i', scan: 'first', ...over });
const job = (probes: GuardProbe[], lines: string[]): GuardJob => ({ probes, lines });

describe('runGuardJob', () => {
  it('counts the lines a pattern matched, once per line in first mode', () => {
    const r = runGuardJob(job([probe()], ['M901', 'G1 X1', '', 'm902 m903', 'N5 M10']));
    expect(r.probes).toEqual([{ id: 'p', status: 'ok', matchedLines: 2 }]);
  });

  it('finds every match of a line in all mode and steps over an empty match', () => {
    const r = runGuardJob(job([probe({ pattern: 'x*', scan: 'all' }), probe({ id: 'q', pattern: 'G\\d', scan: 'all' })], ['aaa', 'G0 G1']));
    // `x*` matches the empty text in both lines (found, stepped over, no endless loop); `G\d` matches in one.
    expect(r.probes.map((p) => [p.id, p.status, p.matchedLines])).toEqual([
      ['p', 'ok', 2],
      ['q', 'ok', 1],
    ]);
  });

  it('reports a pattern that does not compile instead of throwing', () => {
    expect(runGuardJob(job([probe({ pattern: '(' })], ['a'])).probes[0]).toEqual({ id: 'p', status: 'invalid', matchedLines: 0 });
  });

  it('skips the blank placeholders of lines nobody reads', () => {
    expect(runGuardJob(job([probe({ pattern: '^', scan: 'first' })], ['', '', 'x'])).probes[0].matchedLines).toBe(1);
  });

  it('answers a lookbehind pattern as the pattern alone would (the prefilter changes the speed, not the answer)', () => {
    const lines = ['G1 X1', 'M901', 'XM901', 'M 902', '(M903)'];
    const re = /(?<![A-Za-z_])M[ \t]*9\d\d/i;
    const expected = lines.filter((l) => re.test(l)).length;
    expect(runGuardJob(job([probe({ pattern: re.source })], lines)).probes[0].matchedLines).toBe(expected);
  });

  it('tells the caller which probe starts', () => {
    const seen: string[] = [];
    runGuardJob(job([probe({ id: 'a' }), probe({ id: 'b' })], ['x']), (id) => seen.push(id));
    expect(seen).toEqual(['a', 'b']);
  });
});

describe('isLiteralPattern', () => {
  it('knows a plain literal from regular-expression syntax', () => {
    expect(isLiteralPattern('CHANNEL')).toBe(true);
    expect(isLiteralPattern('M901')).toBe(true);
    expect(isLiteralPattern('; K1')).toBe(true);
    for (const syntax of ['^O1', 'O1$', 'G\\d', 'a|b', 'a.b', 'a*', 'a+', 'a?', '(a)', '[a]', 'a{2}']) {
      expect(isLiteralPattern(syntax)).toBe(false);
    }
  });
});

describe('installGuardWorker', () => {
  const scope = () => {
    const sent: GuardReply[] = [];
    const s: GuardWorkerScope = { postMessage: (m) => void sent.push(m as GuardReply), onmessage: null };
    installGuardWorker(s);
    return { s, sent };
  };

  it('says which probe starts, then answers with the result, under the request number', () => {
    const { s, sent } = scope();
    s.onmessage?.({ data: { seq: 7, job: job([probe({ id: 'a' }), probe({ id: 'b', pattern: 'G' })], ['M901', 'G1']) } });
    expect(sent).toEqual([
      { seq: 7, started: 'a' },
      { seq: 7, started: 'b' },
      { seq: 7, result: { probes: [{ id: 'a', status: 'ok', matchedLines: 1 }, { id: 'b', status: 'ok', matchedLines: 1 }] } },
    ]);
  });

  it('answers an error, never throws, when a job cannot be run', () => {
    const { s, sent } = scope();
    s.onmessage?.({ data: { seq: 1, job: {} } });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ seq: 1, error: expect.any(String) });
  });

  it('ignores a message that is not a request', () => {
    const { s, sent } = scope();
    s.onmessage?.({ data: 'hello' });
    s.onmessage?.({ data: null });
    expect(sent).toEqual([]);
  });
});

/** Lets the runner's queued microtasks run: a job starts one turn after `run`. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Timers the test advances by hand. */
function manualTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: GuardTimers = {
    set: (fn, ms) => {
      const id = nextId++;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clear: (h) => void pending.delete(h as number),
  };
  return {
    timers,
    pending: () => pending.size,
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...pending]) {
        if (t.at <= now) {
          pending.delete(id);
          t.fn();
        }
      }
    },
  };
}

/** A fake worker. `mode`: `echo` runs the real message loop; `silent` never answers (a runaway match). */
function fakeSpawner(mode: 'echo' | 'silent' = 'echo') {
  const made: (WorkerLike & { terminated: boolean; posted: unknown[]; reply(m: unknown): void })[] = [];
  const spawn = (): WorkerLike => {
    const scope: GuardWorkerScope = { postMessage: (m) => w.reply(m), onmessage: null };
    if (mode === 'echo') installGuardWorker(scope);
    const w = {
      terminated: false,
      posted: [] as unknown[],
      onmessage: null as WorkerLike['onmessage'],
      onerror: null as WorkerLike['onerror'],
      postMessage(m: unknown) {
        w.posted.push(m);
        scope.onmessage?.({ data: m });
      },
      terminate() {
        w.terminated = true;
      },
      reply(m: unknown) {
        w.onmessage?.({ data: m });
      },
    };
    made.push(w);
    return w;
  };
  return { spawn, made };
}

describe('createWorkerRunner', () => {
  it('returns the worker result and clears its timer', async () => {
    const clock = manualTimers();
    const { spawn } = fakeSpawner();
    const runner = createWorkerRunner({ spawn, timers: clock.timers });
    const outcome = await runner.run(job([probe()], ['M901']), 500);
    expect(outcome).toEqual({ status: 'done', result: { probes: [{ id: 'p', status: 'ok', matchedLines: 1 }] } });
    expect(clock.pending()).toBe(0);
  });

  it('stops a worker that does not answer within the budget, names the pattern that was running, and starts a new worker for the next job', async () => {
    const clock = manualTimers();
    const silent = fakeSpawner('silent');
    let n = 0;
    const echo = fakeSpawner('echo');
    // The first worker hangs after starting its first probe; later ones are healthy.
    const runner = createWorkerRunner({
      spawn: () => (n++ === 0 ? silent.spawn() : echo.spawn()),
      timers: clock.timers,
    });
    const pending = runner.run(job([probe({ id: 'sectionStart' })], ['x']), 500);
    await tick();
    silent.made[0].reply({ seq: 1, started: 'sectionStart' });
    clock.advance(499);
    expect(silent.made[0].terminated).toBe(false);
    clock.advance(1);
    expect(await pending).toEqual({ status: 'timeout', budgetMs: 500, probe: 'sectionStart' });
    expect(silent.made[0].terminated).toBe(true);
    // The next job gets a fresh worker and works.
    const next = await runner.run(job([probe()], ['M901']), 500);
    expect(next.status).toBe('done');
    expect(echo.made).toHaveLength(1);
    expect(n).toBe(2);
  });

  it('ignores whatever a stopped worker says afterwards', async () => {
    const clock = manualTimers();
    const silent = fakeSpawner('silent');
    const runner = createWorkerRunner({ spawn: silent.spawn, timers: clock.timers });
    const pending = runner.run(job([probe()], ['x']), 100);
    await tick();
    clock.advance(100);
    expect((await pending).status).toBe('timeout');
    silent.made[0].reply({ seq: 1, result: { probes: [] } }); // a late answer: nobody listens
    expect(silent.made[0].onmessage).toBeNull();
  });

  it('runs jobs one after the other', async () => {
    const clock = manualTimers();
    const silent = fakeSpawner('silent');
    const runner = createWorkerRunner({ spawn: silent.spawn, timers: clock.timers });
    const first = runner.run(job([probe()], ['x']), 100);
    const second = runner.run(job([probe({ id: 'second' })], ['x']), 100);
    await tick();
    expect(silent.made[0].posted).toHaveLength(1); // the second waits for the first
    silent.made[0].reply({ seq: 1, result: { probes: [] } });
    expect((await first).status).toBe('done');
    await tick();
    expect(silent.made[0].posted).toHaveLength(2);
    silent.made[0].reply({ seq: 2, result: { probes: [] } });
    expect((await second).status).toBe('done');
  });

  it('reports a worker that breaks, or cannot be started, as failed, not as a slow pattern', async () => {
    const clock = manualTimers();
    const silent = fakeSpawner('silent');
    const runner = createWorkerRunner({ spawn: silent.spawn, timers: clock.timers });
    const broken = runner.run(job([probe()], ['x']), 100);
    await tick();
    silent.made[0].onerror?.({ message: 'boom' });
    expect(await broken).toEqual({ status: 'failed', message: 'boom' });
    expect(silent.made[0].terminated).toBe(true);

    const refusing = createWorkerRunner({
      spawn: () => {
        throw new Error('no worker here');
      },
      timers: clock.timers,
    });
    expect(await refusing.run(job([probe()], ['x']), 100)).toEqual({ status: 'failed', message: 'no worker here' });
  });

  it('turns an error reply into failed and respawns', async () => {
    const clock = manualTimers();
    const echo = fakeSpawner('echo');
    const runner = createWorkerRunner({ spawn: echo.spawn, timers: clock.timers });
    const out = await runner.run({ probes: undefined, lines: [] } as unknown as GuardJob, 100);
    expect(out.status).toBe('failed');
    expect(echo.made[0].terminated).toBe(true);
    expect((await runner.run(job([probe()], ['M901']), 100)).status).toBe('done');
    expect(echo.made).toHaveLength(2);
  });

  it('dispose stops the worker and ends a job in flight as failed', async () => {
    const clock = manualTimers();
    const silent = fakeSpawner('silent');
    const runner = createWorkerRunner({ spawn: silent.spawn, timers: clock.timers });
    const pending = runner.run(job([probe()], ['x']), 100);
    await tick();
    runner.dispose();
    expect(await pending).toEqual({ status: 'failed', message: 'disposed' });
    expect(silent.made[0].terminated).toBe(true);
    expect(clock.pending()).toBe(0);
  });
});

describe('guardJob', () => {
  const never = { run: () => Promise.reject(new Error('the worker must not be asked')), dispose() {} };

  it('does not ask the worker when there is nothing to check', async () => {
    expect(await guardJob(null, job([probe()], ['x']))).toEqual({ ok: true, guarded: false });
    expect(await guardJob(never, job([], ['x']))).toEqual({ ok: true, guarded: false });
    expect(await guardJob(never, job([probe()], []))).toEqual({ ok: true, guarded: false });
  });

  it('says no, with the pattern and the budget, when time ran out', async () => {
    const runner = { run: () => Promise.resolve({ status: 'timeout' as const, budgetMs: 1500, probe: 'q' }), dispose() {} };
    expect(await guardJob(runner, job([probe()], ['x']), 1500)).toEqual({ ok: false, budgetMs: 1500, probe: 'q' });
  });

  it('lets the caller read on when the worker broke', async () => {
    const runner = { run: () => Promise.resolve({ status: 'failed' as const, message: 'x' }), dispose() {} };
    expect(await guardJob(runner, job([probe()], ['x']))).toEqual({ ok: true, guarded: false });
  });

  it('passes through the inline runner', async () => {
    expect(await guardJob(createInlineRunner(), job([probe()], ['M901']))).toEqual({ ok: true, guarded: true });
  });

  it('has a budget of a few seconds', () => {
    expect(GUARD_BUDGET_MS).toBe(2000);
  });
});

describe('the real worker entry (bundled, in a Node worker thread)', () => {
  let code = '';
  beforeAll(async () => {
    code = await bundleGuardWorker();
  });

  it('bundles with nothing left to import', () => {
    expect(code.length).toBeGreaterThan(200);
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/require\(["'](?!node:)/);
  });

  it('runs a job and answers', async () => {
    const spawner = nodeSpawner(code);
    const runner = createWorkerRunner({ spawn: spawner.spawn });
    try {
      const out = await runner.run(job([probe()], ['M901', 'G1']), 5000);
      expect(out).toEqual({ status: 'done', result: { probes: [{ id: 'p', status: 'ok', matchedLines: 1 }] } });
    } finally {
      runner.dispose();
    }
  });

  it('stops a pattern that really runs away, names it, and the next job works on a new thread', async () => {
    const spawner = nodeSpawner(code);
    const runner = createWorkerRunner({ spawn: spawner.spawn });
    try {
      // `(a+)+$` on 40 letters and a `!` takes years; this test gives it 300 ms.
      const runaway = job([probe({ id: 'slow', pattern: '(a+)+$' })], ['G1 X1', `${'a'.repeat(40)}!`]);
      const started = performance.now();
      const out = await runner.run(runaway, 300);
      const took = performance.now() - started;
      expect(out).toEqual({ status: 'timeout', budgetMs: 300, probe: 'slow' });
      expect(took).toBeLessThan(2000);
      expect(spawner.stopped()).toBe(1);
      const next = await runner.run(job([probe()], ['M901']), 5000);
      expect(next.status).toBe('done');
      expect(spawner.started()).toBe(2);
    } finally {
      runner.dispose();
    }
  });
});
