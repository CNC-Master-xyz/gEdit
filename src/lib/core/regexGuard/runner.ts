// The runner of the guard (T171, T227): posts a job to a worker, waits at most a time budget
// for the answer, and when the budget runs out stops the worker for good (`terminate`) and
// starts a fresh one for the next job. A match that has begun cannot be interrupted from
// inside the worker, so stopping the whole worker is the only way to stop it.
//
// The worker and the clock are injected: the app gives it the real worker (`spawn.ts`), a
// unit test gives it a fake worker that never answers and a clock it advances by hand, so a
// timeout is driven deterministically. Jobs run one after the other.

import { runGuardJob, type GuardJob, type GuardJobResult } from './job';
import type { GuardReply } from './worker';

/** What the runner needs of a `Worker`. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}

export interface GuardTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/** What a job came to. */
export type GuardOutcome =
  | { status: 'done'; result: GuardJobResult }
  /** The budget passed. The worker was stopped; `probe` is the pattern that was running, if known. */
  | { status: 'timeout'; budgetMs: number; probe: string | null }
  /** The worker could not be started or broke (not a slow pattern). */
  | { status: 'failed'; message: string };

export interface GuardRunner {
  run(job: GuardJob, budgetMs: number): Promise<GuardOutcome>;
  /** Stops the worker; a job still waiting for it ends as `failed`. */
  dispose(): void;
}

const realTimers: GuardTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createWorkerRunner(o: { spawn(): WorkerLike; timers?: GuardTimers }): GuardRunner {
  const timers = o.timers ?? realTimers;
  let worker: WorkerLike | null = null;
  let seq = 0;
  let tail: Promise<unknown> = Promise.resolve();
  /** Ends the job in flight early (dispose). */
  let abort: ((message: string) => void) | null = null;

  const stop = (): void => {
    const w = worker;
    worker = null;
    if (w === null) return;
    w.onmessage = null;
    w.onerror = null;
    w.terminate();
  };

  const execute = (job: GuardJob, budgetMs: number): Promise<GuardOutcome> =>
    new Promise<GuardOutcome>((resolve) => {
      let w: WorkerLike;
      try {
        w = worker ??= o.spawn();
      } catch (err) {
        worker = null;
        resolve({ status: 'failed', message: err instanceof Error ? err.message : String(err) });
        return;
      }
      const mine = ++seq;
      let probe: string | null = null;
      let timer: unknown = null;
      const finish = (outcome: GuardOutcome): void => {
        if (timer !== null) timers.clear(timer);
        timer = null;
        abort = null;
        resolve(outcome);
      };
      abort = (message) => {
        stop();
        finish({ status: 'failed', message });
      };
      w.onmessage = (event) => {
        const reply = event.data as GuardReply;
        if (reply === null || typeof reply !== 'object' || reply.seq !== mine) return;
        if ('started' in reply) probe = reply.started;
        else if ('result' in reply) finish({ status: 'done', result: reply.result });
        else {
          stop();
          finish({ status: 'failed', message: reply.error });
        }
      };
      w.onerror = (event) => {
        stop();
        finish({ status: 'failed', message: event.message ?? 'worker error' });
      };
      timer = timers.set(() => {
        // The budget is up: stop the worker (and with it the match that will not end).
        stop();
        finish({ status: 'timeout', budgetMs, probe });
      }, budgetMs);
      try {
        w.postMessage({ seq: mine, job });
      } catch (err) {
        stop();
        finish({ status: 'failed', message: err instanceof Error ? err.message : String(err) });
      }
    });

  return {
    run(job, budgetMs) {
      const next = tail.then(() => execute(job, budgetMs));
      tail = next.catch(() => undefined);
      return next;
    },
    dispose() {
      if (abort !== null) abort('disposed');
      else stop();
    },
  };
}

/**
 * A runner that does the work on the calling thread, at once, without a limit. For tests of
 * the code around the guard, and the answer where no Worker exists (it guards nothing).
 */
export function createInlineRunner(): GuardRunner {
  return {
    run(job) {
      return Promise.resolve({ status: 'done', result: runGuardJob(job) });
    },
    dispose() {},
  };
}
