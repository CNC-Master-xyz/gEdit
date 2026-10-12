// The single-file channel layout and the resolution of a program under it, as the incremental-patch tests read
// them: shared by `incremental.test.ts` and `incremental.slow.test.ts` in src/lib/core/channels.

import { cpOf } from './profiles';
import { resolveDocument } from '../../../src/lib/core/channels/marks';
import type { ChannelParams } from '../../../src/lib/core/channels/types';

const lathe = cpOf('fanuc-lathe');

export const single: ChannelParams = {
  layout: 'single-file',
  list: [
    { id: '1', name: 'Channel 1' },
    { id: '2', name: 'Channel 2' },
  ],
  sectionStart: '^O21(?<channel>\\d\\d)(?![\\d.])',
  sectionEnd: '^M99',
  syncMarks: [
    { id: 'wait', label: 'w', match: { kind: 'codes', codes: 'M900-M999' }, partners: { kind: 'word', address: 'P', decode: 'digits', whenAbsent: { kind: 'none' } } },
    { id: 'm1', label: 'm', semantics: 'count', match: { kind: 'codes', codes: 'M100' }, partners: { kind: 'all' } },
  ],
};
// The channel token is the two digits after O21 (`O2101` = channel "01" = 1 by value).

export function resolution(name: string, lines: string[], p: ChannelParams) {
  const r = resolveDocument(name, lines, lathe, p);
  return r.layout === 'none'
    ? null
    : { layout: r.layout, self: r.self, sections: r.sections, outside: r.outside, marks: r.marks, boundaries: r.boundaries ?? [], lineCount: lines.length, problems: r.problems, dropped: r.dropped };
}
