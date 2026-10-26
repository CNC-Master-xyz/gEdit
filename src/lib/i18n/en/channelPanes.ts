// The channel view: one pane per channel, lined up at the wait codes (Phase 4 plan AD-50,
// AD-51, §6.7, §6.11). Owner: P4.22b; the category, the command title and the refusal of a
// selection across sections were pinned by the P4e prelude.
// One namespace per feature (plan AD-14); the namespace name is this file's name.

import type { Messages } from '../types';

export default {
  category: 'Channels',
  /** `channels.sideBySide`: NC tab, group `channels.group`, after Split into Channel Documents. */
  sideBySide: 'Channels Side by Side',
  /** A command that acts on the selected lines, run in a channel pane whose selection runs over another channel's lines (§6.7 rule 3). */
  selectionCrosses: 'The selection runs over the lines of another channel. Select within one section.',

  /** Why the view does not open (`ChannelPaneService.open` answers these; the command says them in the status bar). */
  refusal: {
    noChannels: 'This program has no channels, so there is nothing to show in the channel view.',
    onlyOne: 'Only one channel of this program was found. The view needs at least two.',
    needTwoFiles: 'Open at least two channel files to open the channel view.',
    noDocument: 'There is no program open.',
    notLoaded: 'The channel view could not start. Try again in a moment.',
  },

  /** The file dialog that offers the channel files that are not open (one file per channel). */
  openOthers: {
    /** Said in the status bar before the dialog opens. */
    hint: 'Choose the other channel files to open beside this one.',
    /** After the dialog: nothing was picked, the view goes on with the files that are open. */
    none: 'No files were opened. Showing the channels that are open.',
  },

  /** The bar above the panes (`channel-view-bar`). */
  bar: {
    title: 'Channel view',
    /** The accessible name of the bar. */
    label: 'Channel view',
    layoutSections: 'Channel sections of one program',
    layoutFiles: 'One file per channel',
    notShown: 'Not shown: {channels}',
    outside_one: '{count} line is in no channel and is not shown.',
    outside_other: '{count} lines are in no channel and are not shown.',
    marks: '{matched} of {total} waits lined up',
    unmatched_one: '{count} wait has no partner',
    unmatched_other: '{count} waits have no partner',
    /** A wait names a channel the machine does not have (v1.2.0 T037); the hover of the wait says it too. */
    unknown_one: '{count} wait names a channel this machine does not have',
    unknown_other: '{count} waits name a channel this machine does not have',
    /** Said aloud (never shown) when the last wait without a partner has found one (v1.2.0 T031). */
    allLinedUp: 'All waits are lined up.',
    close: 'Close the view',
    closeHint: 'Back to one editor (Close Split)',
  },

  /** The hover of a wait mark in the line-decorations margin (§6.7 rule 13). */
  mark: {
    /** `{partners}` is "Turret B, line 120; Turret C, line 98". */
    matched: 'Waits with {partners}',
    partner: '{channel}, line {line}',
    /** A named channel that is shown has no matching wait; `{text}` is the wait as written on this line. */
    missing_one: '{channels} has no matching wait for "{text}"',
    missing_other: '{channels} have no matching wait for "{text}"',
    /** The wait names no other channel. */
    alone: 'This wait names no other channel, so nothing can meet it.',
    /** The wait names a channel the machine does not have (`{channels}` as written in the program). */
    unknown_one: 'This wait names channel {channels}, which this machine does not have. The control would wait here for ever.',
    unknown_other: 'This wait names channels {channels}, which this machine does not have. The control would wait here for ever.',
    /** The wait meets the others in another order than the one these panes are lined up in. */
    crossing: 'This wait comes in another order here than in the other channels, so it is not lined up.',
    /** Two waits on one line whose partners are on different lines: the line is lined up at the other one. */
    elsewhere: 'Another wait on this line is already lined up with a different line, so this one is unmatched.',
    /** The channels have this wait a different number of times, but a loop or a jump runs over it (as Check Wait Codes). */
    loop: 'This wait is inside a loop or a jump, so how often it runs is not checked here.',
    /** A SETM of the same mark number in those channels answers the wait (`{channels}` are channel names). */
    answered: 'A SETM in {channels} answers this wait, so it needs no matching wait there.',
  },

  /** The title of a pane whose channel is no longer in the program. */
  gone: '{name} (no longer in the program)',

  /** The close button in a channel pane's header names the channel (v1.2.0 T030); `{channel}` is the pane's title. */
  closePane: 'Close the pane of {channel}',

  /** Status bar. */
  status: {
    opened: 'The channel view shows {count} channels.',
    closedGone: 'The program has no channels any more. The channel view was closed.',
    closedMachine: 'The channels of this machine changed. The channel view was closed.',
    closedSlow: 'This program took too long to read for channels. The channel view was closed.',
    undoInFile: 'That file was changed outside the view. Close the channel view to undo in that file.',
    editDropped: 'That edit was not applied: the pane was still being brought in line with the program. Type it again.',
    /** A pane edit refused because lines would go to another channel (P4e review NC-2, the owner's answer of 2026-10-17). */
    movesLines: "A pane only edits its own channel's lines. To end a section early or add lines after its end, edit the program itself.",
  },
} as const satisfies Messages;
