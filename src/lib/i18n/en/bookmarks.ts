// Bookmarks: toggle, next, previous, clear (contrib/bookmarks.ts). Owner: WP4.4.
// One namespace per feature (plan AD-14); the namespace name is this file's name.

import type { Messages } from '../types';

export default {
  category: 'Bookmarks',
  toggle: 'Toggle Bookmark',
  next: 'Next Bookmark',
  prev: 'Previous Bookmark',
  clear: 'Clear Bookmarks',
  /** P4c (plan §6.5, §6.11): the titles, the ribbon group and the panel's name, then the messages of P4.13. */
  /** Caption of the Edit-tab group (`{ tab: 'edit', group: 'bookmarks.group' }`), after Go To. */
  group: 'Bookmarks',
  /** `bookmark.rename`: asks for the name of the bookmark on the cursor's line (sets the bookmark if there is none). */
  rename: 'Name Bookmark',
  /** `bookmark.addAllMatches`: a bookmark on every line the find widget's search finds. */
  addAllMatches: 'Bookmark All Matches',
  /** `view.toggleBookmarks`: shows or hides the bookmark panel in the left region. */
  togglePanel: 'Bookmark Panel',
  /** The panel's title (its tab in the left region). */
  panelTitle: 'Bookmarks',
  set: 'Bookmark set.',
  removed: 'Bookmark removed.',
  /** A new bookmark in a document that already has the most it keeps (Toggle Bookmark, Name Bookmark). */
  full: 'This document has {max} bookmarks, the most it keeps. Remove one first.',
  none: 'This document has no bookmarks.',
  cleared_one: 'Removed {count} bookmark.',
  cleared_other: 'Removed {count} bookmarks.',
  // `bookmark.rename` (rule 4)
  renameTitle: 'Bookmark name',
  renamePlaceholder: 'Name (leave empty for none)',
  nameTooLong: 'A bookmark name has at most {max} characters.',
  nameInvalid: 'A bookmark name cannot contain control characters.',
  named: 'Bookmark named \u201C{name}\u201D.',
  nameRemoved: 'Name removed. The bookmark stays.',
  // `bookmark.addAllMatches` (rule 6)
  noDocument: 'Open a program first.',
  noSearch: 'Search for something first: open Find and type it.',
  noMatch: 'No line matches the search.',
  tooMany: '{count} lines match, and a document keeps at most {max} bookmarks. Narrow the search.',
  tooManyAdded:
    '{count} lines match, and this document already has {have} bookmarks. It keeps at most {max}. Narrow the search.',
  matched_one: 'Bookmarked {count} line.',
  matched_other: 'Bookmarked {count} lines.',
  matchedSome_one: 'Bookmarked {count} line ({already} already had one).',
  matchedSome_other: 'Bookmarked {count} lines ({already} already had one).',
  allHad_one: 'This line already has a bookmark.',
  allHad_other: 'All {count} matching lines already have a bookmark.',
  // The panel (rule 5)
  panelLabel: 'Bookmarks of the open documents',
  emptyKey: 'No bookmarks yet. Toggle one with {key}.',
  emptyNoKey: 'No bookmarks yet. Use Toggle Bookmark on the Edit tab.',
  lineLabel: 'Line {line}',
  jump: 'Go to line {line} of {file}',
  pendingTip: 'This tab has not been shown yet. Its bookmarks are the ones remembered for the file.',
  removeRow: 'Remove bookmark',
  renameRow: 'Rename bookmark',
  clearAll: 'Clear All',
  clearAllTitle: 'Clear All Bookmarks',
  clearAllConfirm_one: 'Remove {count} bookmark from all open documents?',
  clearAllConfirm_other: 'Remove {count} bookmarks from all open documents?',
  clearAllOk: 'Remove',
} as const satisfies Messages;
