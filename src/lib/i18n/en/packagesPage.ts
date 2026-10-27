// The Packages page of the settings dialog (Phase 4 plan §6.9 rules 7–15). Owner: P4.35.
// One namespace per feature (plan AD-14); the namespace name is this file's name. The prelude
// wrote the page title; P4.35 adds the page's own texts. Package names, script names and file
// names are data and stay as they are.

import type { Messages } from '../types';

export default {
  category: 'Packages',
  title: 'Packages',
  intro:
    'A package is a folder of scripts, profiles and code files. To add one, copy its folder into the packages folder and press Reload. To remove one, delete its folder. gEdit never downloads a package.',
  trust:
    'A package is as trusted as a script you wrote yourself: its scripts run with your rights. Switching a package on is your decision; nothing runs just because a package is listed.',
  folder: 'Packages folder:',
  reload: 'Reload',
  none: 'No packages yet.',
  loading: 'Reading the packages folder…',
  unreadable: 'The packages folder could not be read: {detail}',
  switchLabel: 'Use package {name}',
  on: 'On',
  off: 'Off',
  folderName: 'Folder: {name}',
  version: 'Version {version}',
  counts: 'Scripts: {scripts}, profiles: {profiles}, code files: {codes}',
  switchedOff: 'Switched off: nothing of this package is loaded.',
  notUsable: 'This folder cannot be used as a package: {reason}',
  problems: 'Problems and notes',
  loadProblems: 'Problems of the last load',
  problemFile: 'package {package}: {file}',
  switchedOn: 'Package {name} is on.',
  switchedOffStatus: 'Package {name} is off.',
  switchFailed: 'Package {name} could not be switched.',
  reloaded: 'Packages reloaded.',
  reloadFailed: 'The packages could not be reloaded.',
} satisfies Messages;
