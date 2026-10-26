// The work of the regular-expression guard (T171, T227), as plain data and one pure function.
//
// A pattern the user wrote (a channel pattern of a machine, a regular expression in Find All
// or Replace All) can run away: nested repeats such as `(a+)+$` take time that doubles with
// every character of a line, and JavaScript cannot interrupt a match once it has begun. The
// editor therefore never meets such a pattern first. The guard runs it in a Web Worker
// (`runner.ts`, `worker.ts`) over the same lines, with a time budget, and the worker is
// stopped and started again when the budget runs out. A pattern that came through the guard
// has run to the end once over these lines, so the plain, synchronous code that reads the
// document afterwards (`findMarks`, `findInLines`) does not freeze on it.
//
// This file is what the worker runs. It imports nothing but the lookbehind prefilter, which has
// no imports itself, so the worker bundle stays small and the file runs in the unit tests too.

import { lookbehindPrefilter } from '../channels/prefilter';

/** One pattern to run over the lines of a job. */
export interface GuardProbe {
  /** Echoed back; names the pattern in a timeout (`GuardTimeout.probe`). */
  id: string;
  pattern: string;
  flags: string;
  /**
   * `first`: the pattern is asked once per line (`exec`), as the channel code does.
   * `all`: every match in a line is found, empty matches stepped over, as Find All and
   * Replace All do (`textScanner`).
   */
  scan: 'first' | 'all';
}

export interface GuardJob {
  probes: GuardProbe[];
  /** The lines every probe reads. A line the caller will never give to a pattern is `''`. */
  lines: string[];
}

export interface ProbeOutcome {
  id: string;
  /** `invalid`: the pattern does not compile (the code that reads the document reports that). */
  status: 'ok' | 'invalid';
  /** Lines the pattern matched. */
  matchedLines: number;
}

export interface GuardJobResult {
  probes: ProbeOutcome[];
}

/**
 * Runs every probe over every line, one probe after the other. `onProbe` is told before each
 * probe starts, so the one that was running when time ran out can be named.
 */
export function runGuardJob(job: GuardJob, onProbe?: (id: string) => void): GuardJobResult {
  const probes: ProbeOutcome[] = [];
  for (const probe of job.probes) {
    onProbe?.(probe.id);
    probes.push(runProbe(probe, job.lines));
  }
  return { probes };
}

function runProbe(probe: GuardProbe, lines: readonly string[]): ProbeOutcome {
  let re: RegExp;
  try {
    // Global in `all` mode so `lastIndex` steps through the matches; never sticky.
    const flags = probe.flags.replace(/[gy]/g, '') + (probe.scan === 'all' ? 'g' : '');
    re = new RegExp(probe.pattern, flags);
  } catch {
    return { id: probe.id, status: 'invalid', matchedLines: 0 };
  }
  // The same cheap test the readers put in front of a pattern with a lookbehind (see
  // `prefilter.ts`): a line it rejects is a line the pattern rejects, so the guard measures the
  // pattern the way the editor will run it.
  const pre = probe.scan === 'first' ? lookbehindPrefilter(re) : null;
  let matchedLines = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') continue;
    if (pre !== null && !pre.test(line)) continue;
    if (probe.scan === 'first') {
      if (re.exec(line) !== null) matchedLines++;
      continue;
    }
    let any = false;
    re.lastIndex = 0;
    for (let m = re.exec(line); m !== null; m = re.exec(line)) {
      any = true;
      // An empty match (`^`, `x*`) marks no text; step over it or the loop never ends.
      if (m[0].length === 0) re.lastIndex = m.index + 1;
    }
    if (any) matchedLines++;
  }
  return { id: probe.id, status: 'ok', matchedLines };
}

/**
 * A pattern with no regular-expression syntax in it: it is a plain literal, cannot run away,
 * and needs no worker. (`.` counts as syntax; a literal with a dot is sent to the worker, which
 * costs one round trip and is never wrong.)
 */
export function isLiteralPattern(pattern: string): boolean {
  return !/[\\^$.|?*+()[\]{}]/.test(pattern);
}
