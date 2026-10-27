// Turning the Find in Folder form into the request of `folder_search` (Phase 4, plan section 6.8).
// **Stubs** written by the P4f prelude; implemented by **P4.28**.
//
//  Q1. **Name patterns** are split on `;` and spaces, trimmed, empty ones dropped; at most
//      `MAX_PATTERNS` of at most `MAX_PATTERN_CHARS` characters (the constants of
//      `src-tauri/src/folders.rs`, mirrored in `platform/commands.ts`); only `*` and `?` are
//      wildcards, a character that no file name may hold (`/ \ : " < > |`, a control character)
//      is an error in plain words. The form's default is the registered extensions.
//  Q2. **Dates** are local midnight of the first day (inclusive) and local midnight after the last
//      day (exclusive), as milliseconds. An end before the start is an error.
//  Q3. **The prefilter `contains`** is a text that every line the query matches holds verbatim,
//      else none (a false negative would hide a file; a missing prefilter only costs time):
//        - a literal text query: the text, `caseSensitive` as asked, when it is ASCII and 1 to
//          256 bytes; a longer or non-ASCII text: none;
//        - a regular expression with no regular-expression syntax in it (`isLiteralPattern`): the
//          same as a literal;
//        - any other regular expression: none;
//        - a word query (`T17`, `S>12000`): the address letters only, case-insensitive (`T`),
//          never the value (a block may write `T 17`, or `T017`, the query compares values).
//      Inside comments: when `inComments` is false the prefilter still holds (a hit in a comment
//      is dropped later, never the other way round).
//  Q4. **The query is parsed once per profile** the files turn out to have (`parseQuery(text, cp,
//      flags)`); a query that does not parse for the first profile is asked again, as Find All
//      does; one that parses for some profiles and not others reports the files it could not read
//      with their profile's message and goes on.
//  Q5. **Hits** are capped at `FOLDER_MAX_HITS`; past it the search is cancelled and the title
//      says "at least". Binary, too-large, unreadable, link, hidden, too-deep and big-folder
//      counts of the summary go into the report's `message`, in plain words, never silently.
//  Q6. **A slow pattern** (the guard's verdict `refused`) ends the search at that file; the rows
//      found so far stay, the message names the file.

import type { Msg } from '$lib/app/types';
import type { FolderContains } from '$lib/platform/commands';
import type { SearchQuery } from '$lib/core/search';

const NOT_BUILT = 'not built yet (P4.28)';

/** Q1. */
export function parseNamePatterns(_text: string): string[] | { error: Msg } {
  throw new Error(NOT_BUILT);
}

/** Q2. `from` and `to` are `YYYY-MM-DD` or empty. */
export function dateWindow(_from: string, _to: string): { after: number | null; before: number | null } | { error: Msg } {
  throw new Error(NOT_BUILT);
}

/** Q3. */
export function containsFor(_query: SearchQuery | null): FolderContains | null {
  throw new Error(NOT_BUILT);
}
