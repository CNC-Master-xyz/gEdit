// A real guard worker for the unit tests: the entry file `regex.worker.ts` bundled with esbuild
// (the way Vite bundles it for the app) and started as a Node worker thread. Node has no
// `self`, so a few lines in front of the bundle give it one that talks to the parent port.
// The unit project has no Web Worker; this is the closest to the real thing it can run, and
// it stops a real runaway match with `terminate`.

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { WorkerLike } from './runner';

const ENTRY = fileURLToPath(new URL('./regex.worker.ts', import.meta.url));

const SHIM = `
const { parentPort } = require('node:worker_threads');
globalThis.self = {
  postMessage: (message) => parentPort.postMessage(message),
  set onmessage(handler) { parentPort.on('message', (data) => handler({ data })); },
};
`;

/** The worker entry as one script (no imports left), or throws what esbuild says. */
export async function bundleGuardWorker(): Promise<string> {
  const result = await build({
    entryPoints: [ENTRY],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'neutral',
    target: 'es2022',
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

/** `spawn` for `createWorkerRunner`: each call starts a new thread; `started` counts them. */
export function nodeSpawner(code: string): { spawn(): WorkerLike; started: () => number; stopped: () => number } {
  let started = 0;
  let stopped = 0;
  return {
    spawn() {
      started++;
      const thread = new Worker(SHIM + code, { eval: true });
      const like: WorkerLike = {
        postMessage: (message) => thread.postMessage(message),
        terminate: () => {
          stopped++;
          void thread.terminate();
        },
        onmessage: null,
        onerror: null,
      };
      thread.on('message', (data) => like.onmessage?.({ data }));
      thread.on('error', (err) => like.onerror?.({ message: err.message }));
      return like;
    },
    started: () => started,
    stopped: () => stopped,
  };
}
