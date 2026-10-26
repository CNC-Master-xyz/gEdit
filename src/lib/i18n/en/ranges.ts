// Select or delete a block range (Phase 4 plan §6.5 rule 7, §6.11). Owner: P4.14a; the category, the ribbon group and the command titles were
// pinned by the P4c prelude.
// One namespace per feature (plan AD-14); the namespace name is this file's name.

import type { Messages } from '../types';

export default {
  category: 'Edit',
  /** Caption of the Edit-tab group (`{ tab: 'edit', group: 'ranges.group' }`), after Bookmarks. */
  group: 'Block Range',
  /** `edit.selectBlockRange`: asks for a first and a last line or block number and selects the whole range. */
  select: 'Select Block Range',
  /** `edit.deleteBlockRange`: the same form, and the range is deleted as one undo step. */
  delete: 'Delete Block Range',

  /** The form. */
  kindLabel: 'Range of',
  kindLine: 'Line numbers',
  kindBlock: 'Block numbers',
  fromLabel: 'From',
  toLabel: 'To',
  fromHelp: 'First line or block of the range.',
  toHelp: 'Last line or block of the range. A block that continues over several lines is taken whole.',
  okSelect: 'Select',
  okDelete: 'Delete',

  /** What is wrong with the numbers; shown in the form, nothing is selected or deleted. */
  notNumberLine: 'Enter a whole number, for example 120.',
  notNumberBlock: 'Enter a block number, for example N120 or 120.',
  outsideProgram: 'The program has {lineCount} lines. Enter a line from 1 to {lineCount}.',
  missingBlock: 'Block {block} is not in the program.',
  /** `{lines}` is a list such as "12 and 340" or "12, 40 and 90". */
  duplicateBlock: 'Block {block} is at lines {lines}. Use line numbers.',
  duplicateBlockMore: 'Block {block} is at lines {lines} and {more} more. Use line numbers.',
  listAnd: '{head} and {last}',
  reversedLine: 'The first line is below the last line. Swap the two.',
  reversedBlock: 'The first block comes after the last block in the program. Swap the two.',

  /** The status bar. `{what}` is "lines 12–40 (blocks N100–N200)" or "line 12". */
  lines: 'lines {first}–{last}',
  line: 'line {line}',
  blocks: 'blocks {from}–{to}',
  block: 'block {block}',
  withBlocks: '{lines} ({blocks})',
  selected: 'Selected {what}.',
  deleted_one: 'Deleted {what}. Undo brings it back.',
  deleted_other: 'Deleted {count} lines: {what}. Undo brings them back.',
  /** Nothing was changed. */
  noDocument: 'Open a program first.',
} as const satisfies Messages;
