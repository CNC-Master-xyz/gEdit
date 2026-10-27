// Channel files found in the folder, the file of the first path, and the Siemens job list
// (Phase 4, P4.30b; plan section 6.8.5). One namespace per feature (plan AD-14); the namespace
// name is this file's name.

import type { Messages } from '../types';

export default {
  /** The status item's line for a channel file the job list tied to its channel (`by: 'jobList'`). */
  status: {
    foundJobList: 'found in the job list',
  },

  /** The machine page's channel step (`firstFileName`). `{noun}` is the control's word: channel, path, turret. */
  field: {
    label: 'File name of the first {noun}',
    help: 'A pattern with (?<stem>…) and without (?<channel>…), for example ^(?<stem>[^.]+)$. For a control that writes the program of the first path without an extension. Verify on your machine.',
  },

  /** Said once per program in the status bar (J1): gEdit never reads a file you did not open. */
  jobListInFolder: 'This folder has a job list. Open it to use it for the channels.',

  /** Problems of a channel program that the job list or the folder caused. */
  problems: {
    jobListDisagrees: 'The job list (line {line}) runs this program in {jobList}, but it is {channel} by its name or its header. The name or the header counts.',
    jobListAmbiguous: 'The job list runs this program in more than one channel (lines {lines}), so it does not say which channel this is.',
    siblingAmbiguous: 'More than one file in the folder could be {channel}: {names}. Open the right one.',
  },

  /** What reading a job list found wrong (`readJobList`). */
  jobList: {
    badSelect: 'Line {line} of the job list starts with SELECT but is not "SELECT program CH=number".',
    channelByName: 'Line {line} of the job list names the channel as "{channel}". Only a channel number can be used here.',
    longLines_one: '{count} line of the job list is longer than {max} characters and was not read.',
    longLines_other: '{count} lines of the job list are longer than {max} characters and were not read.',
    truncated: 'Only the first {lines} lines and {entries} SELECT lines of the job list were read.',
  },
} as const satisfies Messages;
