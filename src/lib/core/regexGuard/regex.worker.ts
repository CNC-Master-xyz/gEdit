// The entry file of the regular-expression guard worker (T171, T227). Vite bundles it as a
// worker of its own (`spawn.ts` imports it with `?worker`); keep it to this one call.

import { installGuardWorker, type GuardWorkerScope } from './worker';

installGuardWorker(self as unknown as GuardWorkerScope);
