// Folder rules of a machine: the Folders section of the Machines page and the status item's
// line (Phase 4 plan 6.8.4, P4.30a). One namespace per feature (plan AD-14); the namespace
// name is this file's name. Folder paths and machine names are data and stay as written.

import type { Messages } from '../types';

export default {
  /** Summary of the section; `count` folders. */
  title: 'Folders ({count})',
  intro:
    'Programs saved in one of these folders use this machine, unless you pick another machine for the program. A program that is not saved yet is never matched. The longest matching folder wins.',
  /** Help line: the rule reads the text of the path only (R1, R6). */
  help:
    'gEdit compares the folder as written and does not look inside it. A program opened through another spelling of the same folder (a mapped drive instead of the network path, a link) is not matched: add that spelling as well.',
  empty: 'No folders. Programs from a folder you add here use this machine.',
  subfolders: 'Include subfolders',
  remove: 'Remove',
  removeTip: 'Remove this folder from the machine',
  pathLabel: 'Folder',
  pathPlaceholder: 'D:\\DNC\\Lathe1 or \\\\server\\share\\Lathe1 or /dnc/lathe1',
  add: 'Add folder',
  pick: 'Choose folder…',
  pickTitle: 'Folder of the programs for this machine',
  /** Two machines claim one folder: the problem line (`folderConflicts`) is shown as it is, behind this. */
  conflict: 'Same folder on two machines',

  /** A list written by hand that cannot be used. */
  brokenTitle: 'The folder list in machines.json cannot be used, so this machine has no folders:',
  startAgain: 'Start the list again',

  /** Refusals; the machine file is not changed. */
  notAbsolute:
    'A folder is written as a full path: a drive letter (D:\\DNC), a network share (\\\\server\\share) or a path from the root (/dnc). “..” is not allowed.',
  tooLong: 'A folder path has at most {max} characters.',
  tooMany: 'A machine has at most {max} folders.',
  brokenList: 'The folder list in machines.json cannot be used. Start the list again first.',
  already: 'This machine already has that folder.',
  blocked: 'The machines file cannot be written now.',
  saveFailed: 'The folder list could not be saved',

  /** The status item's tooltip: why this machine (`byFolder`), or why none (`ambiguous`). */
  byFolder: 'Machine chosen by its folder: {folder}',
  ambiguous: 'The folder {folder} belongs to more than one machine ({names}); the profile’s default machine is used.',
} as const satisfies Messages;
