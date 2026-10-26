// How a background build chains its slices (B1 fixperf; T170): shared by the outline pump
// (`outlineService.ts`) and the modal service's (`modalService.ts`), which cannot import each
// other (the outline service already reads the modal service's budget and idle clock).
//
// A slice that has more work behind it follows in the next turn of the event loop (`nextTurn`, a
// message, not a timer: a timer is clamped to at least 1 ms and, nested, to 4, and where there
// is no `requestIdleCallback`, as in the macOS web view, the idle gap is a whole frame), as
// long as no input is waiting (`inputPending`, where the engine can say so) and less than
// `CHAIN_MS` of work has been chained; then the pump takes one timer turn or goes back to idle
// time, so timers and painting are never starved.

import type { Disposable } from '$lib/app/types';

/** Chained slices (no idle gap) may run this long (ms of work) before the pump takes one timer turn. */
export const CHAIN_MS = 24;

let turnChannel: MessageChannel | null = null;
const turnQueue: { fn: () => void; cancelled: boolean }[] = [];

/**
 * Runs `fn` in the next turn of the event loop, without the delay of a timer (a message on a
 * channel of our own; a timer is clamped to at least 1 ms and, nested, to 4). Input that has
 * arrived is served between this and the turn before. Without `MessageChannel` it is a
 * timer of 0.
 */
export function nextTurn(fn: () => void): Disposable {
  if (typeof MessageChannel !== 'function') {
    const handle = setTimeout(fn, 0);
    return () => clearTimeout(handle);
  }
  if (turnChannel === null) {
    turnChannel = new MessageChannel();
    turnChannel.port1.onmessage = () => {
      const task = turnQueue.shift();
      if (task !== undefined && !task.cancelled) task.fn();
    };
  }
  const task = { fn, cancelled: false };
  turnQueue.push(task);
  turnChannel.port2.postMessage(null);
  return () => {
    task.cancelled = true;
  };
}

/** Is the user's input waiting? Only some engines can say (`navigator.scheduling.isInputPending`); the others: no. */
export function inputPending(): boolean {
  const scheduling = (globalThis.navigator as { scheduling?: { isInputPending?: () => boolean } } | undefined)?.scheduling;
  return scheduling?.isInputPending?.() === true;
}

