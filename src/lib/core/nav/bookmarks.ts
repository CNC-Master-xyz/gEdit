// Bookmark arithmetic (plan §5 WP4.4). Owner: WP4.4.
//
// The pure half of bookmarks: a sorted list of 1-based line numbers, and what toggling
// and stepping through it mean. Monaco's decorations live next door in
// `monaco/bookmarks.ts`; keeping the arithmetic here is what makes "next and previous
// wrap" testable without an editor.
//
// `core/nav/index.ts` already has `nextInList(sorted, current, dir)` for the tool-change
// list (F7 / Shift+F7), which does **not** wrap. Bookmarks do, which is why they get
// their own function rather than a flag on that one.
//
// Both functions normalize their input (sorted, without duplicates) instead of trusting
// it. The caller is `monaco/bookmarks.ts`, which reads the lines back from Monaco's
// decorations: two bookmarks whose lines an edit has merged arrive as a duplicate, and a
// decoration that moved up past its neighbour arrives out of order. Normalizing here is
// one `Set` and one sort over a handful of numbers, and it is the difference between F2
// visiting every bookmark and F2 getting stuck.

/** `lines` sorted ascending and without duplicates. */
function normalize(lines: readonly number[]): number[] {
  return [...new Set(lines)].sort((a, b) => a - b);
}

/**
 * `lines` with `line` added or removed, kept sorted and without duplicates.
 * The input is never mutated.
 */
export function toggleBookmark(lines: readonly number[], line: number): number[] {
  const rest = lines.filter((other) => other !== line);
  return normalize(rest.length === lines.length ? [...rest, line] : rest);
}

/**
 * The next bookmark after `current` (`dir` 1) or before it (`dir` -1), wrapping around
 * the ends. Null when there are no bookmarks at all.
 *
 * `current` is the cursor's line and need not be a bookmark itself. A single bookmark on
 * the cursor's own line answers with that line, so F2 always reveals something.
 */
export function stepBookmark(lines: readonly number[], current: number, dir: 1 | -1): number | null {
  const sorted = normalize(lines);
  if (sorted.length === 0) return null;
  if (dir === 1) {
    for (const line of sorted) if (line > current) return line;
    return sorted[0];
  }
  for (let i = sorted.length - 1; i >= 0; i -= 1) if (sorted[i] < current) return sorted[i];
  return sorted[sorted.length - 1];
}

// ---------------------------------------------------------------------------------------
// P4c: bookmark names and Bookmark All Matches (plan §6.5 rules 4 to 6; P4.13)
// ---------------------------------------------------------------------------------------

/** At most this many bookmarks per document, in the session and in the memo (`fileMemory`). */
export const MAX_BOOKMARKS = 200;

/** What `toggle` did: set a bookmark, removed one, refused a new one (`full`), or had no line to act on (`none`). */
export type BookmarkToggle = 'set' | 'removed' | 'full' | 'none';

/**
 * True when a bookmark on `line` would be one more than [`MAX_BOOKMARKS`]: the document has the
 * most it keeps and `line` has none to remove. The same limit as saving and Bookmark All Matches
 * (owner 2026-10-19), so a bookmark that was set is never silently dropped at the next save.
 */
export function bookmarkLimitReached(lines: readonly number[], line: number): boolean {
  return !lines.includes(line) && new Set(lines).size >= MAX_BOOKMARKS;
}

/** The longest bookmark name, in characters, after trimming (§6.5 rule 4). */
export const MAX_BOOKMARK_NAME = 60;

/** The longest line text the bookmark panel shows, in characters (§6.5 rule 5). */
export const MAX_BOOKMARK_TEXT = 120;

/** A bookmark with its optional name: the shape the service and the memo exchange. */
export interface BookmarkMark {
  /** 1-based. */
  line: number;
  name?: string;
}

/** What is wrong with a name, for the prompt that asks for it. */
export type BookmarkNameProblem = 'tooLong' | 'control';

// C0 (including tab and line breaks), DEL and C1. A name is one line of plain text, and a
// control character in it would reach the panel, the tooltip and `state.json` as is.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** The problem with `raw` as a name, or null; an empty name is no problem (it removes the name). */
export function bookmarkNameProblem(raw: string): BookmarkNameProblem | null {
  if (CONTROL.test(raw)) return 'control';
  const text = raw.replace(/\s+/g, ' ').trim();
  return overName(text) ? 'tooLong' : null;
}

/**
 * A bookmark name as the contract allows it (§6.5 rule 4): trimmed, inner runs of white space
 * made one blank, 1 to [`MAX_BOOKMARK_NAME`] characters, no control character. `null` for a value
 * that is not a name (not a string, empty after trimming, too long, a control character; a tab
 * or a line break counts as a control character, so it is refused and not turned into a blank).
 * Used on the way in from the prompt and from `state.json`, which is untrusted.
 */
export function cleanBookmarkName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (CONTROL.test(raw)) return null;
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text === '') return null;
  return overName(text) ? null : text;
}

/** More than [`MAX_BOOKMARK_NAME`] characters. A character is at most two UTF-16 units, so a longer text is over without being split into characters (a hand-edited name of millions). */
function overName(text: string): boolean {
  return text.length > 2 * MAX_BOOKMARK_NAME || Array.from(text).length > MAX_BOOKMARK_NAME;
}

function isLine(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/**
 * The names of a memo as `state.json` hands them over (`FileMemo.bookmarkNames`), read as
 * untrusted and checked against `lines`, the bookmarks of the same memo: not an array is no
 * names; an entry that is not `{ line, name }` with a line and a name `cleanBookmarkName`
 * accepts is dropped, and so is a second entry for a line, an entry whose line is not in
 * `lines` and every entry past [`MAX_BOOKMARKS`]. Ascending by line; the names are the cleaned ones.
 */
export function cleanBookmarkNames(value: unknown, lines: readonly number[]): { line: number; name: string }[] {
  if (!Array.isArray(value)) return [];
  const known = new Set(lines);
  const seen = new Set<number>();
  const out: { line: number; name: string }[] = [];
  for (const entry of value) {
    if (out.length >= MAX_BOOKMARKS) break;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const line = (entry as { line?: unknown }).line;
    const name = cleanBookmarkName((entry as { name?: unknown }).name);
    if (!isLine(line) || name === null) continue;
    if (!known.has(line) || seen.has(line)) continue;
    seen.add(line);
    out.push({ line, name });
  }
  return out.sort((a, b) => a.line - b.line);
}

/** The bookmarks of a memo, lines and names together (the names read as untrusted), ascending. */
export function memoMarks(memo: { bookmarks: readonly number[]; bookmarkNames?: unknown }): BookmarkMark[] {
  const lines = [...new Set(memo.bookmarks.filter(isLine))].sort((a, b) => a - b).slice(0, MAX_BOOKMARKS);
  const names = new Map(cleanBookmarkNames(memo.bookmarkNames, lines).map((entry) => [entry.line, entry.name]));
  return lines.map((line) => {
    const name = names.get(line);
    return name === undefined ? { line } : { line, name };
  });
}

/** The marks that carry a name, as `FileMemo.bookmarkNames` stores them (ascending). */
export function namesOf(marks: readonly BookmarkMark[]): { line: number; name: string }[] {
  const out: { line: number; name: string }[] = [];
  for (const mark of marks) if (mark.name !== undefined) out.push({ line: mark.line, name: mark.name });
  return out.sort((a, b) => a.line - b.line);
}

/** A line's text as the panel shows it: trimmed, at most [`MAX_BOOKMARK_TEXT`] characters. */
export function bookmarkText(line: string): string {
  const text = line.trim();
  return Array.from(text).length > MAX_BOOKMARK_TEXT ? Array.from(text).slice(0, MAX_BOOKMARK_TEXT).join('') : text;
}

/** What Bookmark All Matches decides, before anything is marked (§6.5 rule 6). */
export type MatchesPlan =
  | { ok: true; lines: number[]; marked: number; already: number }
  | { ok: false; reason: 'noMatch' | 'tooMany'; matches: number };

/**
 * All or nothing: `matched` are the lines the search finds (any order, duplicates allowed),
 * `existing` the lines that have a bookmark. No match is `noMatch`; the distinct matched lines
 * plus the bookmarks that are there already above [`MAX_BOOKMARKS`] is `tooMany` (`matches` is
 * the distinct matched lines). Otherwise `lines` is every line that has a bookmark afterwards,
 * `marked` the lines that get one now and `already` the matched lines that had one.
 */
export function planMatches(matched: readonly number[], existing: readonly number[]): MatchesPlan {
  const found = [...new Set(matched)].sort((a, b) => a - b);
  if (found.length === 0) return { ok: false, reason: 'noMatch', matches: 0 };
  const have = new Set(existing);
  const already = found.filter((line) => have.has(line)).length;
  const all = new Set([...existing, ...found]);
  if (all.size > MAX_BOOKMARKS) return { ok: false, reason: 'tooMany', matches: found.length };
  return { ok: true, lines: [...all].sort((a, b) => a - b), marked: found.length - already, already };
}
