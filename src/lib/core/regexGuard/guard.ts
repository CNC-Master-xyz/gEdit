// What a caller asks of the guard: "may I read these lines with these patterns?". The answer
// is yes, or no because a pattern ran out of its time budget (and was stopped). See `job.ts`.

import type { GuardJob } from './job';
import type { GuardRunner } from './runner';

/** The default budget of one guarded job. The worker is off the editor's thread, so this is a wait, not a freeze. */
export const GUARD_BUDGET_MS = 2_000;

export type GuardVerdict =
  /** `guarded: false`: nothing was checked (no pattern to check, no worker, or the worker broke); the caller reads on as it always did. */
  | { ok: true; guarded: boolean }
  /** `probe`: the id of the pattern that was running when the budget ran out, or null. */
  | { ok: false; budgetMs: number; probe: string | null };

export async function guardJob(runner: GuardRunner | null, job: GuardJob, budgetMs: number = GUARD_BUDGET_MS): Promise<GuardVerdict> {
  if (runner === null || job.probes.length === 0 || job.lines.length === 0) return { ok: true, guarded: false };
  const outcome = await runner.run(job, budgetMs);
  if (outcome.status === 'timeout') return { ok: false, budgetMs: outcome.budgetMs, probe: outcome.probe };
  // A worker that broke is not a slow pattern: do not take the feature away, read as before.
  return { ok: true, guarded: outcome.status === 'done' };
}
