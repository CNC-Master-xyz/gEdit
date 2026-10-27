// A Siemens job list as a source of "this file is channel n" (Phase 4, T126, plan section 6.8).
// Written by the P4f prelude as stubs; implemented by P4.30b.
//
// The manual's shape (Sinumerik 840D sl operating manual, "Creating a job list"; HMI-Advanced
// operating manual, job list syntax; the pages are cited in the plan): a job list is a text
// file (`.JOB`) of instructions
//
//     SELECT <program> CH=<channel number> [DISK]
//
// `<program>` is an absolute or relative path of a program (`//NC/WKS.DIR/SHAFT.WPD/SHAFT1.MPF`,
// `SHAFT2.MPF`, `/shaft1.wpd/side1.mpf`), `CH=` the channel as a number; the older syntax also
// allows a channel name from `NETNAMES.INI` (`CH=Station5`) and `NCU,n` (`CH=ncu_b,1`). `LOAD`
// and `COPY` instructions stand in the same file. A comment is `;` at the start of a line or
// text in round brackets. Only `SELECT` says which program runs in which channel.
//
// Rules, binding:
//
//  J1. **The job list is a document the user has open.** gEdit never reads a `.JOB` file the user
//      did not open (the webview reads no file the user did not pick or drop, standing rule 14).
//      `readJobList` gets the lines of an open document; `folder_siblings` may tell the user that a
//      `*.JOB` file is in the folder (a status message: "This folder has a job list. Open it to
//      use it for the channels."), nothing more.
//  J2. **A document is a job list** when its first non-blank, non-comment line starts with
//      `SELECT`, `LOAD` or `COPY` (case-insensitive) and at least one `SELECT` line reads. It
//      does not depend on the file extension or the profile.
//  J3. **The channel is a plain number or nothing.** `CH=2` names channel 2 (compared with the
//      machine's channel ids and aliases by value, as `resolveChannelToken` does). A name
//      (`CH=Station5`) or `NCU,n` form is listed as an entry with `channelKind: 'name'` or
//      `'ncu'` and answers no channel (refuse rather than guess: the name is defined in a file
//      gEdit does not read); the entry's line is reported as a problem.
//  J4. **Program names compare as the control reads them**, without a guess: the last path
//      segment, case-insensitive, the extension (`.MPF`, `.SPF`) and a leading `_N_` with a
//      trailing `_MPF` / `_SPF` (the archive spelling `_N_SHAFT1_MPF`) dropped. `programKey`
//      is that form. A document's base name matching two entries of different channels
//      answers no channel (ambiguous, a problem).
//  J5. **Where it sits in the order of sources** (`documentChannel`): the user's own assignment,
//      then the header `marker`, then the file name (`fileName` pattern or template), then the
//      job list; `by: 'jobList'`. A job list that disagrees with a name or a marker is a
//      problem (`channels.problems.jobListDisagrees`), the stronger source wins, as for
//      `marker` against the file name today.
//  J6. **Only for machines with `layout: 'multi-file'`**; for any other the job list is ignored.
//  J7. **Bounds.** At most `MAX_JOB_ENTRIES` entries and `MAX_JOB_LINES` lines are read; a line
//      longer than `CHANNEL_CAPS.lineLength` is skipped and counted.

import { resolveChannelToken } from './resolve';
import { CHANNEL_CAPS, type ChannelParams, type ChannelProblem, type ChannelRef } from './types';

export const MAX_JOB_ENTRIES = 64;
export const MAX_JOB_LINES = 2000;

export interface JobListEntry {
  /** 1-based line of the `SELECT`. */
  line: number;
  /** The program as written, without `CH=` and `DISK`. */
  program: string;
  /** The channel token as written (`2`, `Station5`, `ncu_b,1`). */
  channel: string;
  channelKind: 'number' | 'name' | 'ncu';
  /** The optional `DISK` keyword (a program run from outside the NC memory) was written. */
  disk: boolean;
}

export interface JobList {
  /** J2 held. */
  isJobList: boolean;
  entries: JobListEntry[];
  problems: ChannelProblem[];
  /** J7: lines longer than `CHANNEL_CAPS.lineLength`, not read. */
  longLines?: number;
  /** J7: a limit stopped the reading (`MAX_JOB_LINES` lines or `MAX_JOB_ENTRIES` entries). */
  truncated?: boolean;
}

/** The instructions a job list is made of (J2). */
const INSTRUCTION = /^(SELECT|LOAD|COPY)(?![A-Za-z0-9_])/i;

/**
 * `SELECT <program> CH=<channel> [DISK]`. The program runs up to the blank before `CH=`; the
 * channel is a number, a name, or a name, a comma and a number (`ncu_b,1`, also with blanks
 * around the comma).
 */
const SELECT = /^SELECT\s+(?<program>\S(?:.*?\S)?)\s+CH\s*=\s*(?<channel>[^\s,]+(?:\s*,\s*[^\s,]+)?)(?:\s+(?<disk>DISK))?$/i;

/** The line without its comments: `;` to the end of the line, and text in round brackets (an unclosed bracket runs to the end). */
function withoutComments(line: string): string {
  const semi = line.indexOf(';');
  const cut = semi < 0 ? line : line.slice(0, semi);
  return cut.replace(/\([^)]*(?:\)|$)/g, ' ').trim();
}

function lineProblem(line: number, key: string, params: Record<string, string | number> = {}): ChannelProblem {
  return { path: `line:${line}`, message: { key, params: { line, ...params } } };
}

/**
 * J2, cheaply: whether the first line that is neither blank nor a comment starts with
 * `SELECT`, `LOAD` or `COPY`; null when `lines` hold no such line (read more to decide).
 */
export function startsLikeJobList(lines: readonly string[]): boolean | null {
  for (const raw of lines) {
    if (raw.length > CHANNEL_CAPS.lineLength) continue;
    const text = withoutComments(raw);
    if (text !== '') return INSTRUCTION.test(text);
  }
  return null;
}

/** J2, J3, J7: the entries of an open document's lines. */
export function readJobList(lines: readonly string[]): JobList {
  const entries: JobListEntry[] = [];
  const problems: ChannelProblem[] = [];
  let first: string | null = null;
  let longLines = 0;
  let truncated = lines.length > MAX_JOB_LINES;
  const count = Math.min(lines.length, MAX_JOB_LINES);
  for (let i = 0; i < count; i++) {
    const raw = lines[i];
    if (raw.length > CHANNEL_CAPS.lineLength) {
      longLines++;
      continue;
    }
    const text = withoutComments(raw);
    if (text === '') continue;
    if (first === null) {
      first = text;
      // J2: a program is no job list; nothing more is read from it.
      if (!INSTRUCTION.test(first)) return { isJobList: false, entries: [], problems: [] };
    }
    if (!/^SELECT(?![A-Za-z0-9_])/i.test(text)) continue; // LOAD and COPY say nothing about channels
    const line = i + 1;
    const m = SELECT.exec(text);
    if (m?.groups === undefined) {
      problems.push(lineProblem(line, 'channelFiles.jobList.badSelect'));
      continue;
    }
    if (entries.length >= MAX_JOB_ENTRIES) {
      truncated = true;
      break;
    }
    const channel = m.groups.channel.replace(/\s+/g, '');
    const channelKind: JobListEntry['channelKind'] = /^\d+$/.test(channel) ? 'number' : channel.includes(',') ? 'ncu' : 'name';
    entries.push({ line, program: m.groups.program, channel, channelKind, disk: m.groups.disk !== undefined });
    // J3: a name is defined in a file gEdit does not read; refuse rather than guess.
    if (channelKind !== 'number') problems.push(lineProblem(line, 'channelFiles.jobList.channelByName', { channel }));
  }
  if (longLines > 0) problems.push({ path: 'lines', message: { key: 'channelFiles.jobList.longLines', params: { count: longLines, max: CHANNEL_CAPS.lineLength } } });
  if (truncated) problems.push({ path: 'lines', message: { key: 'channelFiles.jobList.truncated', params: { lines: MAX_JOB_LINES, entries: MAX_JOB_ENTRIES } } });
  const isJobList = first !== null && entries.length > 0;
  return { isJobList, entries: isJobList ? entries : [], problems: isJobList ? problems : [], longLines, truncated };
}

/** J4: the form two program names compare in. */
export function programKey(name: string): string {
  const last = name.trim().split(/[\\/]/).pop() ?? '';
  const archive = /^_N_(.+)_(?:MPF|SPF)$/i.exec(last);
  const plain = archive !== null ? archive[1] : last.replace(/\.(?:MPF|SPF)$/i, '');
  return plain.toUpperCase();
}

/** J3 to J6: which channel the job list gives the file `baseName`, and the `SELECT` line that says so. */
export function jobListChannel(
  job: JobList,
  baseName: string,
  p: ChannelParams,
): { channel: ChannelRef; line: number } | { ambiguous: number[] } | null {
  if (p.layout !== 'multi-file' || !job.isJobList) return null;
  const key = programKey(baseName);
  if (key === '') return null;
  const matching = job.entries.filter((e) => programKey(e.program) === key);
  if (matching.length === 0) return null;
  const found = new Map<string, { channel: ChannelRef; line: number }>();
  let unknown = false;
  for (const e of matching) {
    const ref = e.channelKind === 'number' ? resolveChannelToken(p, e.channel) : null;
    if (ref === null) unknown = true;
    else if (!found.has(ref.id)) found.set(ref.id, { channel: ref, line: e.line });
  }
  // One entry that names no channel of this machine beside one that does: which one runs here
  // is not known (J3, refuse rather than guess).
  if (found.size > 1 || (found.size === 1 && unknown)) return { ambiguous: matching.map((e) => e.line) };
  return found.size === 1 ? [...found.values()][0] : null;
}

/**
 * The file name the job list gives each channel, when it can be told: the last segment of the
 * program as written, only when it carries an extension (a program written without one, such
 * as `SELECT PART12 CH=1`, names no file: which extension it has is not guessed). A channel
 * with two different names gets none.
 */
export function jobListNames(job: JobList, p: ChannelParams): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (p.layout !== 'multi-file' || !job.isJobList) return out;
  for (const e of job.entries) {
    const ref = e.channelKind === 'number' ? resolveChannelToken(p, e.channel) : null;
    if (ref === null) continue;
    const last = e.program.trim().split(/[\\/]/).pop() ?? '';
    const name = /^[^.]+\.[A-Za-z0-9]+$/.test(last) && !/^_N_/i.test(last) ? last : null;
    const before = out.get(ref.id);
    if (before === undefined) out.set(ref.id, name);
    else if (before !== null && (name === null || before.toLowerCase() !== name.toLowerCase())) out.set(ref.id, null);
  }
  return out;
}
