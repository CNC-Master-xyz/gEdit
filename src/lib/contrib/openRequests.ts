// Files the operating system asks gEdit to open (plan Phase 4, AD-54, section 6.8; P4f).
// One feature per file (plan AD-3); see ./README.md.
//
// Two ways lead here, and Rust has already checked and granted every path (section 6.8.2, S7):
// a double-click or "Open With" (macOS: the system tells the running app; Windows and Linux: a
// second start of gEdit hands its file names to the first and ends), and nothing else. The
// backend sends the event `gedit-open-requests` with `{ paths, refused }`, and keeps what
// arrives before this window can listen. This file is the webview's half:
//
//   1. **Wait for the start to be over** (`startupDecisions`), in this order: every contribution
//      has activated (the claims of crash recovery and of the session restore are made, whatever
//      the file-name order: this file sorts before both), crash recovery has decided (a file
//      opened from disk while the recovery dialog is up would take the path of a recovered
//      document), and the session restore has put up its front tab (so the file the user
//      double-clicked is the one in front, and a recovered file is not opened twice).
//   2. **Register the listener, then ask once** (`open_requests_ready`). In that order, so a
//      path that arrives between the two is in the answer or in an event, never in neither.
//   3. **Open with `files.open`**: the 50 MiB and 50 files rules, the encoding questions and
//      the read-only rules are that function's. It runs behind any dialog that is open
//      (`dialogs.whenFree`): a double-click is an answer to nobody's question and must not be
//      thrown away because a Save dialog was up.
//   4. **Say what was skipped**: `refused` (not a file gEdit may open) and `dropped` (the queue
//      overflowed) become one status line after the opening.
//
// What the payload carries is trusted only as far as its shape: anything else is ignored.

import { awaitRestoreDecision } from '$lib/app/recovery';
import { contributionsLoaded } from '$lib/app/contributionsLoaded';
import { awaitSessionRestore } from '$lib/app/session';
import { dialogs } from '$lib/app/dialogs';
import { files } from '$lib/app/fileOps';
import { status } from '$lib/app/status';
import { OPEN_REQUESTS_EVENT, openRequestsReady } from '$lib/platform/commands';
import { isTauriRuntime } from '$lib/utils/platform';
import { t } from '$lib/i18n';
import type { Contribution, Disposable } from '$lib/app/types';
import type { OpenRequestsReady } from '$lib/platform/commands';

/** What one hand-over says: the paths to open and how many arguments were skipped or lost. */
export interface OpenBatch {
  paths: string[];
  refused: number;
  dropped: number;
}

/** What the module needs, injected so a unit test needs no webview (AD-2). */
export interface OpenRequestsDeps {
  /** Settles when the start is over: contributions loaded, recovery decided, session restored. */
  decided(): Promise<void>;
  /** Registers the listener for the event; resolves with the function that removes it. */
  listen(callback: (payload: unknown) => void): Promise<Disposable>;
  /** `open_requests_ready`: the paths that waited, and what was dropped or refused meanwhile. */
  ready(): Promise<OpenRequestsReady>;
  /** Runs `op` when no dialog chain is running (and waits its turn otherwise). */
  whenFree<T>(op: () => Promise<T>): Promise<T>;
  open(paths: string[]): Promise<unknown>;
  show(text: string, o?: { error?: boolean }): void;
}

/**
 * Contributions loaded, then the crash-recovery decision, then the session restore. Each step
 * resolves at once when its owner never started (no claim, nobody to ask), so a switched-off
 * session restore or a missing contribution cannot hold a hand-over back for ever.
 */
export async function startupDecisions(loaded: Promise<void>): Promise<void> {
  await loaded;
  await awaitRestoreDecision();
  await awaitSessionRestore();
}

const real: OpenRequestsDeps = {
  decided: () => startupDecisions(contributionsLoaded),
  listen: async (callback) => {
    const { listen } = await import('@tauri-apps/api/event');
    return listen<unknown>(OPEN_REQUESTS_EVENT, (event) => callback(event.payload));
  },
  ready: () => openRequestsReady(),
  whenFree: (op) => dialogs.whenFree(op),
  open: (paths) => files.open(paths),
  show: (text, o) => status.show(text, o),
};

/** A count the backend sent, or 0 for anything that is not a whole, non-negative number. */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}

/** The event payload `{ paths, refused }` as a batch; anything of another shape reads as empty. */
export function batchOf(payload: unknown): OpenBatch {
  if (payload === null || typeof payload !== 'object') return { paths: [], refused: 0, dropped: 0 };
  const raw = payload as { paths?: unknown; refused?: unknown; dropped?: unknown };
  const paths = Array.isArray(raw.paths)
    ? raw.paths.filter((p): p is string => typeof p === 'string' && p.length > 0)
    : [];
  return { paths, refused: count(raw.refused), dropped: count(raw.dropped) };
}

/** The one status line for what was skipped, or `null` when nothing was. */
export function skippedLine(batch: OpenBatch): string | null {
  const lines: string[] = [];
  if (batch.refused > 0) lines.push(t('openRequests.refused', { count: batch.refused }));
  if (batch.dropped > 0) lines.push(t('openRequests.dropped', { count: batch.dropped }));
  return lines.length > 0 ? lines.join(' · ') : null;
}

/**
 * Starts listening. Returns the disposer; it works whether or not the listener has been
 * registered yet. Batches are opened one after the other, in the order they arrived.
 */
export function startOpenRequests(deps: OpenRequestsDeps = real): Disposable {
  let disposed = false;
  let off: Disposable | undefined;
  let chain: Promise<void> = Promise.resolve();

  const handle = (batch: OpenBatch): void => {
    chain = chain.then(async () => {
      if (disposed) return;
      try {
        if (batch.paths.length > 0) await deps.whenFree(() => deps.open(batch.paths));
      } catch (err) {
        console.warn('a file the system asked for could not be opened', err);
      }
      // After the opening, which shows its own summary: this line is about what never got there.
      const line = skippedLine(batch);
      if (line !== null) deps.show(line, { error: true });
    });
  };

  void (async () => {
    try {
      await deps.decided();
      if (disposed) return;
      const stop = await deps.listen((payload) => handle(batchOf(payload)));
      if (disposed) {
        stop();
        return;
      }
      off = stop;
      // Only now: a path that came before this point waits in Rust and is in this answer.
      const waiting = await deps.ready();
      if (disposed) return;
      handle(batchOf(waiting));
    } catch (err) {
      console.warn('files from the system cannot be received', err);
    }
  })();

  return () => {
    disposed = true;
    off?.();
  };
}

export default {
  id: 'openRequests',
  activate(): Disposable {
    // `npm run dev` in a plain browser has no backend to ask.
    if (!isTauriRuntime()) return () => {};
    return startOpenRequests();
  },
} satisfies Contribution;
