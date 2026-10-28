// Find in Folder: search a folder's files for a word, a text or a regular expression, and list
// the hits in Results (contrib/findInFolder.ts, core/folders/*). Owner: P4.28 (Phase 4, P4f;
// plan section 6.8.3). One namespace per feature (plan AD-14); the namespace is this file's name.

import type { Messages } from '../types';

export default {
  /** `search.findInFolder`, Edit tab, Search group (no key). */
  command: 'Find in Folder…',

  // The folder dialog and the form.
  pickTitle: 'Folder to search',
  formTitle: 'Find in Folder: {folder}',
  names: 'File names',
  namesHelp:
    'Patterns separated by a semicolon or a space, such as *.nc; *.tap. * stands for any characters, ? for one. Empty: every file.',
  recursive: 'Include subfolders',
  modifiedFrom: 'Changed from',
  modifiedTo: 'Changed up to',
  dateHelp: 'A day as YYYY-MM-DD, such as 2026-10-27. Empty: no limit.',
  query: 'Find',
  queryHelp:
    'Text, or with "Whole address" a word such as G1, T1 or S>12000. Empty: list the files that fit the name and the dates. Every file is read with its own dialect.',
  readAs: 'Read the files as',
  readAsEach: 'Each file by its name and content',

  // Refusals of the form, in plain words.
  errorNamesMany: 'Too many file name patterns. Use at most {max}, or a * to take them together.',
  errorNameLong: 'A file name pattern is longer than {max} characters.',
  errorNameChar: 'The pattern {name} holds a character that no file name can hold{char}. Only * and ? stand for other characters.',
  errorDate: '"{text}" is not a day. Write it as YYYY-MM-DD, such as 2026-10-27.',
  errorDateOrder: 'The last day is before the first day.',

  // The Results report.
  title_one: '1 hit for {query} in {folder}',
  title_other: '{count} hits for {query} in {folder}',
  titleNone: 'No hits for {query} in {folder}',
  titleAtLeast_one: 'At least 1 hit for {query} in {folder}',
  titleAtLeast_other: 'At least {count} hits for {query} in {folder}',
  titleAtLeastNone: 'No hits yet for {query} in {folder}',
  titleFiles_one: '1 file in {folder}',
  titleFiles_other: '{count} files in {folder}',
  titleFilesNone: 'No files in {folder} fit',
  titleFilesAtLeast_one: 'At least 1 file in {folder}',
  titleFilesAtLeast_other: 'At least {count} files in {folder}',
  titleFilesAtLeastNone: 'No files yet in {folder}',
  columnFile: 'File',
  columnLine: 'Line',
  columnText: 'Text',
  columnModified: 'Changed',
  openTitle: 'Open {file}',

  // Why a search stopped early (the message of the report).
  stoppedUser: 'Stopped. The list shows what was found until then.',
  stoppedHits: 'Stopped after {count} hits. Make the query narrower, or the folder or the name pattern.',
  stoppedSlow:
    'Stopped at {file}: the regular expression took too long on it. The hits before it are listed. Make the pattern simpler: avoid a repeat inside a repeat, such as (a+)+.',
  stoppedEntries: 'Stopped after looking at {count} entries. Narrow the folder or the name pattern.',
  stoppedFiles: 'Stopped after {count} files. Narrow the folder or the name pattern.',
  stoppedBytes: 'Stopped after reading a very large amount of text. Narrow the folder or the name pattern.',
  stoppedTime: 'Stopped after {minutes} minutes. Narrow the folder or the name pattern.',

  // What was not read (the message of the report).
  skipBinary_one: '1 file is not text and was not searched.',
  skipBinary_other: '{count} files are not text and were not searched.',
  skipTooLarge_one: '1 file is over {mb} MB and was not searched: {names}.',
  skipTooLarge_other: '{count} files are over {mb} MB and were not searched: {names}.',
  skipTooLargeMore_one: '1 file is over {mb} MB and was not searched: {names}.',
  skipTooLargeMore_other: '{count} files are over {mb} MB and were not searched: {names} and {more} more.',
  skipUnreadable_one: '1 file could not be read.',
  skipUnreadable_other: '{count} files could not be read.',
  skipLinks_one: '1 link was not followed.',
  skipLinks_other: '{count} links were not followed.',
  skipHidden_one: '1 hidden file or folder was skipped.',
  skipHidden_other: '{count} hidden files and folders were skipped.',
  skipTooDeep_one: '1 folder deeper than {levels} levels was skipped.',
  skipTooDeep_other: '{count} folders deeper than {levels} levels were skipped.',
  skipBigFolders_one: '1 folder with more than {entries} entries was skipped.',
  skipBigFolders_other: '{count} folders with more than {entries} entries were skipped.',
  skipQuery_one: 'One file was not searched because its dialect cannot read the query: {file}: {message}',
  skipQuery_other: '{count} files were not searched because their dialect cannot read the query; the first is {file}: {message}',

  // Running, and stopping.
  progress: 'Searching… {files} files read, {entries} entries looked at.',
  stop: 'Stop',
  found: 'Find in Folder: {count} in the list.',
  foundNone: 'Find in Folder: nothing found.',
  runningTitle: 'A search is running',
  runningMessage: 'Another Find in Folder is still running. Stop it and start this one?',
  runningStop: 'Stop and search',
  failed: 'Find in Folder could not search that folder.',
  cannotOpen: 'Could not open {file}.',
  olderSearch: '{file} is from an earlier search, so it cannot be opened from this list any more. Search the folder again to open it.',
} as const satisfies Messages;
