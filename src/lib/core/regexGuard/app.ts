// The guard runner of the running app: one real worker for all callers (channels, search),
// started on first use. Where there is no Worker (the unit tests, a server render) the answer
// is null and the callers read the document without a guard, as they did before.

import type { GuardRunner } from './runner';

let shared: Promise<GuardRunner | null> | null = null;

export function appGuardRunner(): Promise<GuardRunner | null> {
  shared ??= (async () => {
    if (typeof Worker === 'undefined') return null;
    try {
      const [{ createWorkerRunner }, { spawnGuardWorker }] = await Promise.all([import('./runner'), import('./spawn')]);
      return createWorkerRunner({ spawn: spawnGuardWorker });
    } catch {
      return null;
    }
  })();
  return shared;
}
