// Split view: two editors on one window, and moving between the panes (Phase 4 plan AD-50,
// §6.7, §6.11). Owner: P4.21; the category, the ribbon group and the command titles were pinned
// by the P4e prelude.
// One namespace per feature (plan AD-14); the namespace name is this file's name.

import type { Messages } from '../types';

export default {
  category: 'View',
  /** Caption of the View-tab group (`{ tab: 'view', group: 'splitView.group' }`), after Lines. */
  group: 'Editor',
  /** `view.splitEditor`: the document a second time, side by side. */
  split: 'Split Editor',
  /** `view.splitEditorDown`: the document a second time, one pane above the other. */
  splitDown: 'Split Editor Down',
  /** `view.closeSplit`: back to one editor (split view and the channel view alike). */
  close: 'Close Split',
  /** `view.focusNextPane`, `F6`: the next pane, wrapping. */
  focusNext: 'Focus Next Pane',
  /** `view.focusPreviousPane`, `Shift+F6`. */
  focusPrevious: 'Focus Previous Pane',
  /** The close button in the header of a pane (its tip and its accessible name). */
  closeGroup: 'Close this pane',
  /** The accessible name of the splitter between two panes. */
  resize: 'Resize the panes',
} as const satisfies Messages;
