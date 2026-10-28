// Find in Folder: the contract between the form, the Rust walk and the Results panel (Phase 4,
// AD-53, plan section 6.8). Written by the P4f prelude; implemented by **P4.28** (the request and
// the rows) on **P4.27**'s command. A signature here changes only with a numbered section 7 row.
//
// Who does what: Rust finds the files (`folder_search`: the walk, the name pattern, the dates,
// the size, the binary check, a literal prefilter) and sends each one's bytes; the webview
// decodes them with the editor's own codec (`core/text/codec.ts`), reads them with the profile
// of the file (`profiles.detect`, or the one profile the form fixes) and matches the query with
// `findInLines` after the regular-expression guard (`findInLinesGuarded`). The query is never
// sent to Rust, except as the literal prefilter `contains`.

import type { Msg } from '$lib/app/types';

/** The hits kept in the Results panel; the search stops past it and says "at least". */
export const FOLDER_MAX_HITS = 10_000;

/** What the form asks (`contrib/findInFolder.ts`). */
export interface FolderForm {
  /** The folder the user picked in the folder dialog (an absolute path). */
  root: string;
  recursive: boolean;
  /** `*.nc; *.tap`: patterns separated by `;` or a space. Empty: every name. */
  names: string;
  /** `YYYY-MM-DD` in the user's time zone, inclusive; empty: no limit. */
  modifiedFrom: string;
  modifiedTo: string;
  /** The same query text and flags as Find All (`core/search`). Empty: a search by name and date only. */
  query: string;
  wholeAddress: boolean;
  regex: boolean;
  caseSensitive: boolean;
  inComments: boolean;
  /** `each`: the profile of each file by its name and content; otherwise a profile id for all. */
  readAs: string;
}

/**
 * One row of the Results panel for a file or a hit (`ReportData.rows`). Columns, in this order:
 * `file` (path below the folder), `line`, `text`, `modified`. A search without a query lists one
 * row per file with no `line`. `path` and `root` are not columns; they say which file to open.
 */
export interface FolderRow {
  file: string;
  /** Absolute. */
  path: string;
  /** The folder searched, as `folder_grant` wants it. */
  root: string;
  line?: number;
  text?: string;
  /** Local date and time, `YYYY-MM-DD HH:mm`. */
  modified: string;
  bytes: number;
  /** The id of the search that made the row; set when the report is shown (`folder_grant` opens only the last search's files). */
  search?: string;
}

/** The plain-words refusals of the form; the keys live in `i18n/en/findInFolder.ts`. */
export type FolderFormError = { error: Msg };
