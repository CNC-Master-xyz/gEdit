// Turning the Find in Folder form into the request of `folder_search` (Phase 4, plan section 6.8).
// Written as stubs by the P4f prelude; implemented by **P4.28**.
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
//      **One addition (P4.28, proposed section 7 row):** a word query whose address is the
//      program-number address of some dialect (`O`) also finds the calls that name that program
//      (`M98 P1234` for `O1234`), and such a line holds no `O`. The caller says which addresses
//      those are (`o.programAddress`); a word query on one of them gets no prefilter.
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
import { FOLDER_LIMITS } from '$lib/platform/commands';
import type { FolderContains, FolderSearchRequest } from '$lib/platform/commands';
import { isLiteralPattern } from '$lib/core/regexGuard/job';
import type { SearchQuery } from '$lib/core/search';

/** A character no file name may hold on Windows (the strictest of the three systems), or a control character. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_NAME_CHAR = /[/\\:"<>|\u0000-\u001f\u007f]/;

/** Q1. */
export function parseNamePatterns(text: string): string[] | { error: Msg } {
  const patterns = text
    .split(/[;\s]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (patterns.length > FOLDER_LIMITS.maxPatterns) {
    return { error: { key: 'findInFolder.errorNamesMany', params: { max: FOLDER_LIMITS.maxPatterns } } };
  }
  for (const pattern of patterns) {
    if (pattern.length > FOLDER_LIMITS.maxPatternChars) {
      return { error: { key: 'findInFolder.errorNameLong', params: { max: FOLDER_LIMITS.maxPatternChars } } };
    }
    const bad = FORBIDDEN_NAME_CHAR.exec(pattern);
    if (bad !== null) {
      const char = bad[0] < ' ' || bad[0] === '\u007f' ? '' : ` ${bad[0]}`;
      return { error: { key: 'findInFolder.errorNameChar', params: { name: pattern, char } } };
    }
  }
  return patterns;
}

/** `YYYY-MM-DD` as a calendar day, or null when it is not a real one (2026-02-30). */
function dayOf(text: string): Date | null {
  const found = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (found === null) return null;
  const [year, month, day] = [Number(found[1]), Number(found[2]), Number(found[3])];
  const date = new Date(year, month - 1, day);
  date.setFullYear(year); // years 0 to 99 are 1900 to 1999 in the constructor
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

/** Q2. `from` and `to` are `YYYY-MM-DD` or empty. */
export function dateWindow(from: string, to: string): { after: number | null; before: number | null } | { error: Msg } {
  const first = from.trim();
  const last = to.trim();
  let after: Date | null = null;
  let endDay: Date | null = null;
  if (first !== '') {
    after = dayOf(first);
    if (after === null) return { error: { key: 'findInFolder.errorDate', params: { text: first } } };
  }
  if (last !== '') {
    endDay = dayOf(last);
    if (endDay === null) return { error: { key: 'findInFolder.errorDate', params: { text: last } } };
  }
  if (after !== null && endDay !== null && endDay.getTime() < after.getTime()) {
    return { error: { key: 'findInFolder.errorDateOrder' } };
  }
  // The day after the last one, as the same local midnight (a day is 23 or 25 hours long twice a year).
  const before = endDay === null ? null : new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate() + 1);
  return { after: after === null ? null : after.getTime(), before: before === null ? null : before.getTime() };
}

/** Whether `text` is 1 to 256 bytes of printable ASCII. */
function usableText(text: string): boolean {
  return text.length >= 1 && text.length <= FOLDER_LIMITS.maxContainsBytes && /^[\x20-\x7e]+$/.test(text);
}

/** Q3. */
export function containsFor(query: SearchQuery | null, o?: { programAddress?: (address: string) => boolean }): FolderContains | null {
  if (query === null) return null;
  if (query.kind === 'word') {
    const letters = /^,?([A-Za-z]+)/.exec(query.address)?.[1] ?? '';
    if (letters === '') return null;
    // A call that names the program (`M98 P1234`) is a hit of `O1234` and holds no `O`.
    if (o?.programAddress?.(query.address) === true) return null;
    return { text: letters, caseSensitive: false };
  }
  if (query.regex && !isLiteralPattern(query.text)) return null;
  return usableText(query.text) ? { text: query.text, caseSensitive: query.caseSensitive } : null;
}

/** The request of the walk, from what the form said (already checked by the three functions above). */
export function folderRequest(
  id: string,
  form: { root: string; recursive: boolean },
  names: string[],
  window: { after: number | null; before: number | null },
  contains: FolderContains | null,
): FolderSearchRequest {
  return {
    id,
    root: form.root,
    recursive: form.recursive,
    namePatterns: names,
    modifiedAfter: window.after,
    modifiedBefore: window.before,
    contains,
  };
}
