// The sequence a channel executes (plan section 6.8.7, P4.32, rules F1 to F5), pure.
//
// `computeFlow` (`app/outlineService.ts`) says which jumps and counted loops of a channel can be
// followed (`ChannelFlow`); this module turns the channel's marks and that flow into the order the
// control runs them in, which is what the wait-code check (`check.ts`) compares:
//
//   - a followed forward jump (`FlowJump`) ends the run of lines at its own line and goes on at its
//     target: the marks between do not run on that path (F2);
//   - a counted loop (`FlowLoop`) runs its lines `start..end` `count` times in all, one after the
//     other, then the program goes on after `end` (F3);
//   - every other line is run once, in the written order.
//
// The order is given as POSITIONS: a mark's position is its line plus the offset of the run of
// lines it is in, so a program with nothing to follow keeps `position = line` and the check reads it
// exactly as before. An `opaque` line (a jump or loop the flow cannot follow) gets the position of
// each run it is in; every pair of marks with an opaque position between them stays "not judged"
// (F4). A mark on a skipped line has no position.
//
// The flow is checked again here (a jump must go forward and not into or out of a loop, loops must
// not overlap, a count must be a whole number of at least one); a flow that breaks a rule, or one
// that would run more than `FLOW_MAX_STEPS` marks, is not followed: the marks keep their written
// order and every line of the flow is opaque, which is the old reading by jump lines.

import type { ChannelFlow, SyncHit } from './types';

/** The most marks one channel's executed sequence holds; a longer one is read in the written order. */
export const FLOW_MAX_STEPS = 200_000;

/** The largest loop count `computeFlow` hands on (a larger literal count is opaque). */
export const FLOW_MAX_COUNT = 10_000;

export interface FlowStep {
  hit: SyncHit;
  /** Where the mark runs in the executed order; increasing along `steps`. */
  pos: number;
}

export interface FlowSequence {
  /** The marks in the order they run; a mark in a counted loop appears once per pass. */
  steps: FlowStep[];
  /** The positions of the opaque lines, sorted, without repeats. */
  opaque: number[];
  /** Just before the first mark of each REPEATED pass of a loop (pass 2 and later), sorted. */
  repeats: number[];
  /** False when the flow was not followed (see the head of this file). */
  followed: boolean;
}

interface Run {
  from: number;
  to: number;
  repeat: boolean;
}

/** The first index of `sorted` (by `key`) whose key is at least `value`. */
function lowerBound<T>(sorted: readonly T[], value: number, key: (item: T) => number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (key(sorted[mid]) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const sortedUnique = (values: Iterable<number>): number[] => [...new Set([...values].filter((n) => Number.isFinite(n)))].sort((a, b) => a - b);

/** Whether the flow keeps the rules this module relies on (see the head of this file). */
function wellFormed(flow: ChannelFlow): boolean {
  const jumps = Array.isArray(flow.jumps) ? flow.jumps : [];
  const loops = Array.isArray(flow.loops) ? flow.loops : [];
  for (const j of jumps) if (!Number.isInteger(j.line) || !Number.isInteger(j.target) || j.target <= j.line) return false;
  const sorted = [...loops].sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length; i++) {
    const l = sorted[i];
    if (!Number.isInteger(l.start) || !Number.isInteger(l.end) || l.end <= l.start) return false;
    if (!Number.isInteger(l.count) || l.count < 1 || l.count > FLOW_MAX_COUNT) return false;
    if (i > 0 && sorted[i - 1].end >= l.start) return false;
    for (const j of jumps) {
      const lineIn = j.line >= l.start && j.line <= l.end;
      const targetIn = j.target >= l.start && j.target <= l.end;
      // Into, out of or inside a loop, or a skipped span that holds a loop's first line.
      if (lineIn || targetIn || (j.line < l.start && j.target > l.start)) return false;
    }
  }
  return true;
}

/** The marks in the written order and every line of the flow opaque: the reading by jump lines. */
function unfollowed(hits: readonly SyncHit[], flow: ChannelFlow): FlowSequence {
  const opaque = sortedUnique([
    ...(Array.isArray(flow.opaque) ? flow.opaque : []),
    ...(Array.isArray(flow.loops) ? flow.loops.flatMap((l) => [l.start, l.end]) : []),
    ...(Array.isArray(flow.jumps) ? flow.jumps.map((j) => j.target) : []),
  ]);
  const steps = [...hits].sort((a, b) => a.line - b.line).map((hit) => ({ hit, pos: hit.line }));
  return { steps, opaque, repeats: [], followed: false };
}

/**
 * The executed sequence of one channel's marks under `flow` (rules F2 and F3). `hits` are the
 * channel's marks in any order (each a line of this channel).
 */
export function executedSequence(hits: readonly SyncHit[], flow: ChannelFlow): FlowSequence {
  if (!wellFormed(flow)) return unfollowed(hits, flow);
  type Event = { at: number; jump?: { line: number; target: number }; loop?: { start: number; end: number; count: number } };
  const events: Event[] = [...flow.jumps.map((jump) => ({ at: jump.line, jump })), ...flow.loops.map((loop) => ({ at: loop.start, loop }))].sort((a, b) => a.at - b.at);
  const runs: Run[] = [];
  let from = -Infinity;
  for (const ev of events) {
    // A jump or loop on a line a jump skipped never runs.
    if (ev.at < from) continue;
    if (ev.jump) {
      runs.push({ from, to: ev.jump.line, repeat: false });
      from = ev.jump.target;
    } else if (ev.loop) {
      runs.push({ from, to: ev.loop.end, repeat: false });
      for (let pass = 1; pass < ev.loop.count; pass++) runs.push({ from: ev.loop.start, to: ev.loop.end, repeat: true });
      from = ev.loop.end + 1;
    }
  }
  runs.push({ from, to: Infinity, repeat: false });

  const sorted = [...hits].sort((a, b) => a.line - b.line);
  const opaqueLines = sortedUnique(Array.isArray(flow.opaque) ? flow.opaque : []);
  const steps: FlowStep[] = [];
  const opaque: number[] = [];
  const repeats: number[] = [];
  let offset = 0;
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r];
    if (r > 0) offset = runs[r - 1].to + offset - run.from + 1;
    if (run.from > run.to) continue;
    if (run.repeat) repeats.push(run.from + offset - 0.5);
    for (let i = lowerBound(sorted, run.from, (h) => h.line); i < sorted.length && sorted[i].line <= run.to; i++) {
      steps.push({ hit: sorted[i], pos: sorted[i].line + offset });
      if (steps.length > FLOW_MAX_STEPS) return unfollowed(hits, flow);
    }
    for (let i = lowerBound(opaqueLines, run.from, (n) => n); i < opaqueLines.length && opaqueLines[i] <= run.to; i++) opaque.push(opaqueLines[i] + offset);
  }
  return { steps, opaque, repeats, followed: true };
}
