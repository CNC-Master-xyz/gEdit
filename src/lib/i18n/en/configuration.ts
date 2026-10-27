// Export and import of the whole configuration (Phase 4 plan §6.9 rules 16–36). Owner: P4.36.
// One namespace per feature (plan AD-14); the namespace name is this file's name. The prelude
// wrote the page title, the refusal messages and the group headings (a test holds every refusal
// id of `configzip.rs` to a message); P4.36 adds the dialog's own texts.

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
