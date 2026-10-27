// A Siemens job list as a source of "this file is channel n" (Phase 4, T126, plan section 6.8).
// Written by the P4f prelude as **stubs**; implemented by **P4.30b**.
//
// The manual's shape (Sinumerik 840D sl operating manual, "Creating a job list"; HMI-Advanced
// operating manual, job list syntax): a job list is a text file (`.JOB`) of instructions
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

import type { ChannelParams, ChannelProblem, ChannelRef } from './types';

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
}

const NOT_BUILT = 'not built yet (P4.30b)';

/** J2, J3, J7: the entries of an open document's lines. */
export function readJobList(_lines: readonly string[]): JobList {
  throw new Error(NOT_BUILT);
}

/** J4: the form two program names compare in. */
export function programKey(_name: string): string {
  throw new Error(NOT_BUILT);
}

/** J3 to J6: which channel the job list gives the file `baseName`, and the `SELECT` line that says so. */
export function jobListChannel(
  _job: JobList,
  _baseName: string,
  _p: ChannelParams,
): { channel: ChannelRef; line: number } | { ambiguous: number[] } | null {
  throw new Error(NOT_BUILT);
}
