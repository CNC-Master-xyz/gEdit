// The Results rows of Find in Folder and the notes of its message (P4.28; plan section 6.8.3).
// Pure: no store, no dialog, no translation. The notes are `Msg`s the command translates.
//
// A row is `FolderRow` (`types.ts`): `file`, `line`, `text`, `modified` are the columns, `path`,
// `root` and `bytes` say which file to open. A search without a query lists one row per file.

import type { Msg } from '$lib/app/types';
import type { FolderFile, FolderStop, FolderSummary } from '$lib/platform/commands';
import { FOLDER_LIMITS } from '$lib/platform/commands';
import type { SearchHit } from '$lib/core/search';
import { FOLDER_MAX_HITS } from './types';
import type { FolderRow } from './types';

/** Characters of a line a row shows; the same cut as Find All. */
export const FOLDER_ROW_TEXT_MAX = 200;

const two = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD HH:mm` in the user's time zone; empty when the file system gave no time. */
export function modifiedLabel(mtimeMs: number | null): string {
  if (mtimeMs === null || !Number.isFinite(mtimeMs)) return '';
  const date = new Date(mtimeMs);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** The line, cut to about `FOLDER_ROW_TEXT_MAX` characters around the hit when it is longer. */
export function hitText(hit: SearchHit): string {
  const text = hit.text;
  if (text.length <= FOLDER_ROW_TEXT_MAX) return text.trim();
  const from = Math.max(0, hit.start - 60);
  const to = Math.min(text.length, from + FOLDER_ROW_TEXT_MAX);
  return `${from > 0 ? '…' : ''}${text.slice(from, to).trim()}${to < text.length ? '…' : ''}`;
}

type Meta = Pick<FolderFile, 'path' | 'rel' | 'bytes' | 'mtimeMs'>;

/** The row of a file that fits, for a search with no query. */
export function fileRow(file: Meta, root: string): FolderRow {
  return { file: file.rel, path: file.path, root, modified: modifiedLabel(file.mtimeMs), bytes: file.bytes };
}

/** One row per hit of a file. */
export function hitRows(file: Meta, root: string, hits: readonly SearchHit[]): FolderRow[] {
  return hits.map((hit) => ({ ...fileRow(file, root), line: hit.line, text: hitText(hit) }));
}

/** Thousands separated by a comma, for the sentences ("20,000 files"). */
export function grouped(n: number): string {
  return n.toLocaleString('en-US');
}

/** The last name of a folder path, either separator; a share root `\\dnc\lathe1` gives `lathe1`. */
export function folderName(root: string): string {
  const parts = root.split(/[\\/]+/).filter((part) => part !== '');
  return parts[parts.length - 1] ?? root;
}

/** What the notes need besides the walk's own summary. */
export interface FolderOutcome {
  summary: FolderSummary | null;
  /** The user pressed Stop. */
  stoppedByUser: boolean;
  /** The hit cap was met (the search cancelled itself). */
  capped: boolean;
  /** Q6: the relative path of the file whose regular expression ran away. */
  slowFile: string | null;
  /** Files the webview could not read as text (the codec said binary). */
  undecoded: number;
  /** Q4: files whose profile could not read the query, with the profile's message. */
  queryRefused: { file: string; message: string }[];
}

/** Whether the list can be incomplete: the user, a cap or a limit of the walk stopped the search. */
export function isPartial(outcome: FolderOutcome): boolean {
  return outcome.stoppedByUser || outcome.capped || outcome.slowFile !== null || (outcome.summary?.stoppedBy ?? null) !== null;
}

const STOP_KEY: Record<Exclude<FolderStop, 'cancelled'>, string> = {
  entries: 'findInFolder.stoppedEntries',
  files: 'findInFolder.stoppedFiles',
  bytes: 'findInFolder.stoppedBytes',
  time: 'findInFolder.stoppedTime',
};

/** The sentences of the report's message, in the order the user needs them: why it stopped first, then what was not read. */
export function notesOf(outcome: FolderOutcome): Msg[] {
  const notes: Msg[] = [];
  const summary = outcome.summary;
  if (outcome.slowFile !== null) {
    notes.push({ key: 'findInFolder.stoppedSlow', params: { file: outcome.slowFile } });
  } else if (outcome.capped) {
    notes.push({ key: 'findInFolder.stoppedHits', params: { count: grouped(FOLDER_MAX_HITS) } });
  } else if (outcome.stoppedByUser || summary?.stoppedBy === 'cancelled') {
    notes.push({ key: 'findInFolder.stoppedUser' });
  } else if (summary?.stoppedBy != null) {
    const key = STOP_KEY[summary.stoppedBy];
    const params: Record<string, string | number> | undefined =
      summary.stoppedBy === 'entries'
        ? { count: grouped(FOLDER_LIMITS.maxEntries) }
        : summary.stoppedBy === 'files'
          ? { count: grouped(FOLDER_LIMITS.maxFilesRead) }
          : summary.stoppedBy === 'time'
            ? { minutes: FOLDER_LIMITS.maxSeconds / 60 }
            : undefined;
    notes.push({ key, ...(params === undefined ? {} : { params }) });
  }

  if (summary !== null) {
    const skipped = summary.skipped;
    const binary = skipped.binary + outcome.undecoded;
    if (binary > 0) notes.push({ key: 'findInFolder.skipBinary', params: { count: binary } });
    if (skipped.tooLarge > 0) {
      const listed = summary.tooLargeNames.slice(0, FOLDER_LIMITS.maxListedNames);
      const more = skipped.tooLarge - listed.length;
      notes.push({
        key: more > 0 ? 'findInFolder.skipTooLargeMore' : 'findInFolder.skipTooLarge',
        params: { count: skipped.tooLarge, mb: FOLDER_LIMITS.maxFileBytes / (1024 * 1024), names: listed.join(', '), more },
      });
    }
    if (skipped.unreadable > 0) notes.push({ key: 'findInFolder.skipUnreadable', params: { count: skipped.unreadable } });
    if (skipped.links > 0) notes.push({ key: 'findInFolder.skipLinks', params: { count: skipped.links } });
    if (skipped.hidden > 0) notes.push({ key: 'findInFolder.skipHidden', params: { count: skipped.hidden } });
    if (skipped.tooDeep > 0) notes.push({ key: 'findInFolder.skipTooDeep', params: { count: skipped.tooDeep, levels: FOLDER_LIMITS.maxDepth } });
    if (skipped.bigFolders > 0) {
      notes.push({ key: 'findInFolder.skipBigFolders', params: { count: skipped.bigFolders, entries: grouped(FOLDER_LIMITS.maxDirEntries) } });
    }
  } else if (outcome.undecoded > 0) {
    notes.push({ key: 'findInFolder.skipBinary', params: { count: outcome.undecoded } });
  }

  if (outcome.queryRefused.length > 0) {
    const first = outcome.queryRefused[0];
    notes.push({
      key: 'findInFolder.skipQuery',
      params: { count: outcome.queryRefused.length, file: first.file, message: first.message },
    });
  }
  return notes;
}
