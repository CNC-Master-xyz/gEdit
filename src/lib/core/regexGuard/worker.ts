// The message loop of the guard worker, written against a minimal scope so a test can drive
// it with a fake (the unit project has no real Worker). `regex.worker.ts` is the entry file
// that hands it the worker's own `self`.

import { runGuardJob, type GuardJob, type GuardJobResult } from './job';

/** What the worker needs of `self` (a DedicatedWorkerGlobalScope has more). */
export interface GuardWorkerScope {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

/** A request the runner posts. `seq` pairs the answer with the request. */
export interface GuardRequest {
  seq: number;
  job: GuardJob;
}

/** What the worker posts back: `started` before each probe, then `result` (or `error`). */
export type GuardReply =
  | { seq: number; started: string }
  | { seq: number; result: GuardJobResult }
  | { seq: number; error: string };

export function installGuardWorker(scope: GuardWorkerScope): void {
  scope.onmessage = (event) => {
    const request = event.data as GuardRequest;
    if (request === null || typeof request !== 'object' || typeof request.seq !== 'number') return;
    try {
      const result = runGuardJob(request.job, (id) => scope.postMessage({ seq: request.seq, started: id } satisfies GuardReply));
      scope.postMessage({ seq: request.seq, result } satisfies GuardReply);
    } catch (err) {
      scope.postMessage({ seq: request.seq, error: err instanceof Error ? err.message : String(err) } satisfies GuardReply);
    }
  };
}
