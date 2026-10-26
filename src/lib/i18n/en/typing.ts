// Typing options: upper case while typing and no accidental join of two blocks (plan §6 M13,
// AD-30, §7.13). Owner: WP13.4; the category, the ribbon group and the command title were
// pinned by the M13 prelude (P13); WP13.4 adds the rest. P4c (plan §6.5, P4.12): auto space and
// the automatic block number.
// One namespace per feature (plan AD-14); the namespace name is this file's name.

import type { Messages } from '../types';

export default {
  category: 'Edit',
  /** Caption of the Edit-tab group (`{ tab: 'edit', group: 'typing.group' }`), after Go To. */
  group: 'Typing',
  /** `edit.toggleForceUppercase`: upper-case typing off or on again, for this session only. */
  toggleForceUppercase: 'Upper-Case Typing',
  /** Status message after the toggle; comments, strings and kept text are named so the rule is not a surprise. */
  upperOn: 'Upper-case typing is on for this session. Comments, strings and kept text stay as typed.',
  upperOff: 'Upper-case typing is off for this session.',
  /** One of the three switches on a document that is not an NC program (a profile, a settings file or a script). */
  notHere: 'Upper-case typing, auto space and automatic block numbers are for NC programs. They do not act in .json and .py files.',
  /** `edit.toggleAutoSpace`: auto-space off or on again, for this session only (P4c, plan §6.5; P4.12). */
  toggleAutoSpace: 'Auto Space',
  spaceOn: 'Auto space is on for this session. A letter that starts a new word gets a space in front of it.',
  spaceOff: 'Auto space is off for this session.',
  /** `edit.toggleAutoNumber`: the automatic block number on Enter off or on again, for this session only (P4c; P4.12). */
  toggleAutoNumber: 'Automatic Block Number',
  numberOn: 'Automatic block numbers are on for this session. Enter at the end of a numbered block starts the next one.',
  numberOff: 'Automatic block numbers are off for this session.',
  /** Enter made a new line without a number although automatic numbers are on (plan §6.5 rule 2). `{from}`/`{to}` as written, e.g. N120. */
  numberNoGap: 'No number fits between {from} and {to}, so the new line has none. Use Renumber Blocks on the NC tab.',
  /** `{max}` is the largest block number of the profile, as written. */
  numberOverflow: 'The next block number would be above {max}, the largest this control takes, so the new line has none. Use Renumber Blocks on the NC tab.',
  /** Consecutive numbering (Klartext): the blocks below would all have to move. */
  numberTooMany: 'The new line has no number: it would renumber more than {limit} blocks below it, so the program is left as it is. Use Renumber Blocks on the NC tab.',
  /** Consecutive numbering in a channel pane. */
  numberInPane: 'The new line has no number: in a channel pane the blocks below also belong to the other channels. Number it in the whole program, or use Renumber Blocks on the NC tab.',
  /** Shown when Backspace in column 1 or Delete at the end of a line was refused (`editing.preventLineJoin`). */
  noJoin: 'Not joined: that would run two blocks together. Select the line break to delete it.',
} as const satisfies Messages;
