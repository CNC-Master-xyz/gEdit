// Insert file and append file (Phase 4 plan §6.5, §6.11). Owner: P4.14; the category, the ribbon group and the command titles were
// pinned by the P4c prelude, the owner adds the messages.
// One namespace per feature (plan AD-14); the namespace name is this file's name.

import type { Messages } from '../types';

export default {
  category: 'File',
  /** Caption of the File-tab group (`{ tab: 'file', group: 'insertFile.group' }`), after the file commands. */
  group: 'Insert',
  /** `file.insertFile`: the blocks of another file at the cursor. */
  insert: 'Insert File',
  /** `file.appendFile`: the blocks of another file after the last line. */
  append: 'Append File',

  /** The status bar, after the insert. `{where}` is "at line 12" or "at lines 12–40". */
  done_one: 'Inserted 1 line from {name} {where}. Undo takes it back.',
  done_other: 'Inserted {count} lines from {name} {where}. Undo takes them back.',
  atLine: 'at line {line}',
  atLines: 'at lines {first}–{last}',
  renumbered_one: 'Renumbered 1 block.',
  renumbered_other: 'Renumbered {count} blocks.',
  nulDropped_one: 'Left out 1 NUL byte of the file.',
  nulDropped_other: 'Left out {count} NUL bytes of the file.',
  /** A lone `%` of the file would open or close the tape in the middle of the program; only an empty document takes it. */
  tapeMarksLeftOut_one: 'Left out the % line of the file.',
  tapeMarksLeftOut_other: 'Left out the {count} % lines of the file.',
  /** Said after an insert that went ahead below a program end. */
  afterProgramEnd: 'The program ends at line {line}. The inserted blocks come after it and do not run unless they are called.',
  /** Said after an insert that went ahead below the `%` that ends the tape. */
  afterTapeEnd: 'The % at line {line} ends the tape. The control reads nothing after it, so it does not read the inserted lines.',
  /** An inserted line starts a program, and blocks of the program follow the insert. `{line}` is the document's line. */
  programFrameStart: 'Line {line} (“{text}”) starts a program in the middle of this one: the blocks below it now belong to that program. Check the program.',
  /** An inserted line ends the program, and blocks of the program follow the insert. */
  programFrameEnd: 'Line {line} (“{text}”) ends the program in the middle: the blocks below it do not run. Check the program.',

  /** Nothing was inserted. */
  noDocument: 'Open a program first.',
  /** `{title}` is the command: Insert File or Append File. */
  notAvailable: '{title} is not available while the channel view or the comparison is open.',
  notReadable: 'Could not read {name}. Nothing was inserted.',
  unknownSize: 'Could not tell how large {name} is. Nothing was inserted. Try again.',
  tooLarge: '{name} is {size}, which is more than the {limit} gEdit can open. Nothing was inserted.',
  binary: '{name} is {percent}% NUL bytes, so it is data rather than a program. Nothing was inserted.',
  empty: '{name} is empty. Nothing was inserted.',
  onlyTapeMarks: '{name} holds only % lines, and an insert leaves them out. Nothing was inserted.',
  /** `{text}` is the start of the line, `{line}` its number in the file. */
  secondProgramStart:
    'The file starts a second program (“{text}” at its line {line}). A program of this control holds only one: remove that line from the file first. Nothing was inserted.',
  /** The file holds a whole program: its start and its end, each with its line in the file. */
  secondProgram:
    'The file is a program of its own (“{text}” at its line {line}, “{endText}” at its line {endLine}). A program of this control holds only one: remove those lines from the file first. Nothing was inserted.',
  /** `{text}` is the start of the line, `{line}` its number in the file. */
  programEndInFile:
    'The file ends a program (“{text}” at its line {line}). The program would end there, before the blocks below it: remove that line from the file first. Nothing was inserted.',
  /** The file's first line starts with the continuation mark (Okuma `$`). */
  continuesAbove: 'The first line of {name} starts with “{mark}”, so it would become part of the block above it. Nothing was inserted.',
  /** The file's last line ends with the continuation mark (Klartext `~`). */
  continuesBelow: 'The last line of {name} ends with “{mark}”, so the block below it would become part of it. Complete that block in the file first. Nothing was inserted.',
  tooManyBelow: 'More than {limit} blocks below would need new numbers, so nothing was inserted. Renumber from the NC tab, or insert closer to the end.',
  overflow: 'The new numbers would pass {max}, the highest block number of this control. Nothing was inserted.',
  /** The document changed while the file was being read, or another one came to the front. */
  changed: 'While the file was read, the program was closed or locked, or another program came to the front. Nothing was inserted.',
} as const satisfies Messages;
