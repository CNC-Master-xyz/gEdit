// Export and import of the whole configuration (Phase 4 plan §6.9 rules 16–36). Owner: P4.36.
// One namespace per feature (plan AD-14); the namespace name is this file's name. The prelude
// wrote the page title, the refusal messages and the group headings (a test holds every refusal
// id of `configzip.rs` to a message); P4.36 added the page's, the preview's and the commands' texts
// and the reasons a file is left out (a test holds every id `configzip.rs` uses to a message).

import type { Messages } from '../types';

export default {
  category: 'Configuration',
  /** The settings page and the heading of the two actions. */
  title: 'Configuration',
  /** `config.export` and `config.import` (palette; the page's buttons). */
  exportTitle: 'Export Configuration…',
  importTitle: 'Import Configuration…',
  intro:
    'Export writes your settings, keys, machines, profiles, code files, scripts and packages to one zip file. Import reads such a file, shows what it would change, and writes nothing until you confirm.',
  /** The page's notes under the two buttons. */
  exportNote: 'The Python interpreter and the extra script folders are not exported: they are places on this computer.',
  importNote: 'An import only adds and replaces files; it never deletes one. Everything it replaces is saved in a backup zip first, and importing that zip undoes the import.',
  exportButton: 'Export…',
  importButton: 'Import…',

  /** Status messages. */
  exported_one: 'Configuration exported to {file}: {count} file.',
  exported_other: 'Configuration exported to {file}: {count} files.',
  exportSkipped_one: '{count} file was left out (see the details).',
  exportSkipped_other: '{count} files were left out (see the details).',
  exportFailed: 'The configuration could not be exported.',
  previewFailed: 'The file could not be read.',
  imported_one: 'Configuration imported: {count} file written.',
  imported_other: 'Configuration imported: {count} files written.',
  importedNothing: 'Nothing was imported: every chosen file is already the same.',
  importedBackup: 'The files it replaced are in {name} (folder import-backups).',
  importFailed: 'The configuration could not be imported.',
  reloadFailed: 'The configuration was imported, but some of it could not be loaded again. Restart gEdit.',

  /** The preview of an import. */
  preview: {
    title: 'Import Configuration',
    source: 'File: {file}',
    madeBy: 'Made by gEdit {version} on {created} ({platform}).',
    refusedTitle: 'This file cannot be imported',
    refusedIntro: 'Nothing was written. The file was refused for these reasons:',
    wholeFile: 'The whole file',
    moreRefusals: 'and more',
    nothingInIt: 'The file holds nothing gEdit can import.',
    choose: 'Choose what to import. Groups whose files are all the same as yours are not ticked.',
    files_one: '{count} file',
    files_other: '{count} files',
    code: 'contains scripts',
    kept: 'Kept from this computer, never taken from a file: {keys}.',
    ignoredTitle_one: '{count} entry in the file is not imported',
    ignoredTitle_other: '{count} entries in the file are not imported',
    trust: 'Scripts and packages run Python on your computer with your rights. Import only a file you trust.',
    trustBox: 'I trust this file',
    counts: '{write} to write, {same} already the same.',
    importButton: 'Import',
    cancel: 'Cancel',
    close: 'Close',
    busy: 'Importing…',
  },

  /** What happens to one file. */
  action: {
    new: 'new',
    replace: 'replaces yours',
    same: 'same as yours',
  },

  /** One changed line of a merged file: a setting, a key or a machine. */
  item: {
    added: '{label}: {to} (new)',
    changed: '{label}: {from} → {to}',
  },

  /** Why an entry of the file is not imported (the file is still imported without it). */
  ignored: {
    outsideLayout: 'not part of a gEdit configuration',
    nameNotAllowed: 'a file name gEdit does not use (lower case letters, digits, . _ - only; scripts end in .py)',
    reservedName: 'the name of gEdit’s own script library, which a file may not replace',
    notJsonObject: 'not a JSON object',
    notText: 'not readable text',
    badContent: 'a part of the file has the wrong shape',
    tooManyKeys: 'more than 1,000 key bindings together with yours',
    mergedTooBig: 'larger than 1 MB together with yours',
    newerFile: 'your file was written by a newer gEdit and is never overwritten',
    linkOnTheWay: 'a folder on the way is a link; gEdit does not write through links',
    targetLink: 'your file is a link; gEdit does not replace links',
    notAFile: 'there is a folder or something else of this name on your computer',
    notAFolder: 'a file stands where a folder belongs',
    unreadable: 'your file could not be read, so it is not replaced',
    tooBigOnDisk: 'your file is larger than 1 MB and could not be saved in the backup',
  },

  /** Headings of the preview's groups; a package group is worded with the package's name. */
  group: {
    settings: 'Settings',
    keys: 'Keyboard shortcuts',
    machines: 'Machines',
    profiles: 'Profiles',
    codes: 'Code files and templates',
    scripts: 'Your scripts',
    package: 'Package {name}',
  },

  /** Why a zip, or one file in it, cannot be imported. The whole file is refused; nothing is written. */
  refusal: {
    notZip: 'This is not a zip file, or it is damaged.',
    archiveTooBig: 'The zip file is larger than 16 MB.',
    tooManyEntries: 'The zip file holds more than 2,000 entries.',
    nameEncoding: 'The name of this entry is not readable text.',
    nameTooLong: 'The name of this entry is too long.',
    tooDeep: 'This entry sits in too many nested folders.',
    absolute: 'This entry starts with a slash and would leave the configuration folder.',
    backslash: 'This entry’s name contains a backslash.',
    colon: 'This entry’s name contains a colon.',
    control: 'This entry’s name contains a control character.',
    parentDir: 'This entry’s name goes up a folder (..) and would leave the configuration folder.',
    emptySegment: 'This entry’s name has an empty part.',
    badSegment: 'This entry’s name has a part Windows cannot hold.',
    duplicate: 'Two entries have the same name once capitals are ignored.',
    link: 'This entry is a link. Links are never imported.',
    specialFile: 'This entry is not an ordinary file.',
    encrypted: 'This entry is encrypted. Encrypted files are not imported.',
    method: 'This entry uses a compression method gEdit does not read.',
    tooBig: 'This file is larger than 1 MB.',
    totalTooBig: 'The files together are larger than 32 MB.',
    ratio: 'This entry unpacks to far more than its size in the zip. It could be a zip bomb.',
    inconsistent: 'The zip file is inconsistent: its entries overlap or disagree with their headers.',
    corrupt: 'This entry could not be read to its end or does not match its size.',
    noManifest: 'This is not a gEdit configuration: it has no gedit-config.json.',
    badManifest: 'The gedit-config.json of this file cannot be read.',
    newerFormat: 'This configuration was made by a newer version of gEdit.',
  },
} satisfies Messages;
