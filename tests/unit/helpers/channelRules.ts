// A wait rule and a single-file channel layout shared by `marks.test.ts` and `marks.slow.test.ts`
// in src/lib/core/channels.

import type { ChannelParams, SyncRule } from '../../../src/lib/core/channels/types';

export const fanucWait = (decode: 'digits' | 'bitmask', whenAbsent?: { kind: 'fixed'; channels: string[] } | { kind: 'none' }): SyncRule => ({
  id: 'wait',
  label: 'wait',
  match: { kind: 'codes', codes: 'M900-M999' },
  partners: { kind: 'word', address: 'P', decode, whenAbsent },
});

export const singleFile: ChannelParams = {
  layout: 'single-file',
  list: [
    { id: '1', name: 'Channel 1' },
    { id: '2', name: 'Channel 2' },
  ],
  sectionStart: '^O(?<channel>[12])\\d{3}(?![\\d.])',
  sectionEnd: '(?<![A-Z])M(?:99|30)(?![\\d.])',
  syncMarks: [fanucWait('digits')],
};
