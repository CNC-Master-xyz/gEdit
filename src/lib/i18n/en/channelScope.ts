// Channel files on disk and channel scope (Phase 4, P4.31, plan section 6.8.6): "Save Channel
// Files", the Channel choice of Find All and of Compare. One namespace per feature (plan AD-14);
// the namespace name is this file's name. Channel names are the machine's own text and stay
// untranslated (README rule 3).

import type { Messages } from '../types';

export default {
  /** `channels.saveChannelFiles`: NC tab, group `channels.group`, after Merge Channels Back. */
  saveFiles: 'Save Channel Files…',

  files: {
    noRecord: 'There are no channel documents of a split of this program to save.',
    sourceClosed: 'The program these channel documents were split from has been closed. Save each channel document with Save As.',
    nothingOpen: 'The channel documents of this program have been closed. Nothing was saved.',
    /** Two channels would be proposed the same name: nothing is asked. `{names}` is the shared name. */
    sameName: 'Two channel files would get the same name ({names}). Nothing was saved. Change the file names of the channels in the machine settings.',
    /** The status line after the last dialog; `{count}` of `{total}` documents were written. */
    saved: 'Saved {count} of {total} channel files.',
    /** Appended when some channels got the usual name because the machine has no usable file name for them. `{channels}` is a list of channel names. */
    /** After the last dialog, when at least one file was written: the files are for editing (owner decision Q4, 2026-10-28). */
    copies: 'These channel files are copies for editing. Send the program to the machine in the form it reads; Merge Channels Back makes it one file again.',
    usualName: 'The machine has no usable file name for {channels}, so the usual name was proposed.',
  },

  /** The Channel choice of the Find All form. */
  find: {
    label: 'Channel',
    all: 'All channels',
    help: 'Look only in the lines of one channel. Replace All is not limited to a channel.',
    /** The Results message when the search was limited; `{channel}` is the machine's name for it. */
    message: 'Only the lines of {channel}.',
    skipped_one: '1 document was skipped because it has no lines of this channel.',
    skipped_other: '{count} documents were skipped because they have no lines of this channel.',
  },

  /** The question before a comparison of a program that has channels. */
  compare: {
    placeholder: 'Compare which lines?',
    whole: 'The whole program',
    wholeDetail: 'Every line of both sides.',
    channelDetail: 'Only the lines of this channel, on both sides.',
    /** The title of a comparison limited to a channel; `{title}` is the usual title. */
    title: '{title} · {channel}',
    /** A file that is not open as a document has no machine, so it has no channel rules. */
    fileSide: 'A file that is not open as a document has no channel rules. Open it first, or compare the whole program.',
    copyRefused: 'A comparison limited to a channel shows only part of the program, so nothing can be copied from it. Compare the whole program to copy.',
    alignedRefused: 'The aligned view shows whole programs. It is not available while a comparison is limited to a channel.',
  },

  /** Why a document cannot be limited to a channel. `{document}` is its name. */
  noChannels: '{document} has no channel sections, so it cannot be limited to a channel.',
  noSection: '{document} has no lines of {channel}.',
  otherChannel: '{document} is the file of {other}, not of {channel}.',
  unknownChannel: 'It is not known which channel {document} is. Assign its channel first.',
} satisfies Messages;
