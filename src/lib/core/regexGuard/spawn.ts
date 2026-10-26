// Starts the real guard worker. Only the app imports this file (through `app.ts`, lazily):
// the `?worker` import is Vite's, and the unit project does not have it.

import GuardWorker from './regex.worker?worker';
import type { WorkerLike } from './runner';

export function spawnGuardWorker(): WorkerLike {
  // Vite emits the worker as its own same-origin file (no blob:, no data:), which the CSP's
  // `worker-src 'self'` allows, as for the editor worker.
  return new GuardWorker() as unknown as WorkerLike;
}
