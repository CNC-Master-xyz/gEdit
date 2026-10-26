// Whether two resolutions of a document say the same thing to the readers of the channel service
// (v1.2.0 follow-up "channel-enter").
//
// The service told its readers (the channel view, the status item, the map) that a document's channels
// changed when a string made of the whole resolution differed from the one of the resolution before:
// `JSON.stringify` over every mark and every range. For a program with 20,000 waits that is a string of
// some two megabytes, built twice for every line break typed in the channel view. This is the same
// question asked of the two resolutions directly: the same fields in the same order, and the same
// answer, but a mark that is the very same object (the patch of an edit keeps the marks it did not touch)
// costs one comparison, and nothing is allocated.
//
// "The same" is exactly what the string held: the layout, the channel the document is, the members (a
// section by its channel and its ranges, a file by its channel, name, whether it exists, its document and
// how it was tied to the channel), the declared channels not found, the lines outside every section, the
// marks by rule, code, line, channel, partners, `blocking` and `absent`, the problems by path and message, and
// whether a cap stopped the resolution. `blocking` and `absent` were not in the old string, but the readers
// do show them (a wait that is not blocking is not checked; a partner that came from `whenAbsent` is told
// apart), and neither is decided by the code or the partners: a change of either alone (a rule's `blocking`
// edited, a `whenAbsent` case that now applies) has to reach the readers. `sameSet.test.ts` holds the
// function to a reference string with both fields over random pairs of sets.

import type { ChannelMember, ChannelProblem, ChannelRef, ChannelSet, SyncHit } from './types';

type Range = { startLine: number; endLine: number };

function sameRanges(a: readonly Range[], b: readonly Range[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i] && (a[i].startLine !== b[i].startLine || a[i].endLine !== b[i].endLine)) return false;
  }
  return true;
}

function sameMember(a: ChannelMember, b: ChannelMember): boolean {
  if (a === b) return true;
  if (a.kind === 'section') {
    // The string held a section as `[channel id, ranges]` and a file as five fields: a section never equals a file.
    return b.kind === 'section' && a.channel.id === b.channel.id && sameRanges(a.ranges, b.ranges);
  }
  return b.kind === 'file' && a.channel.id === b.channel.id && a.name === b.name && a.exists === b.exists && a.docId === b.docId && a.by === b.by;
}

function sameHit(a: SyncHit, b: SyncHit): boolean {
  if (a === b) return true;
  if (a.line !== b.line || a.mark !== b.mark || a.ruleId !== b.ruleId || a.channel !== b.channel) return false;
  if (a.blocking !== b.blocking || (a.absent === true) !== (b.absent === true)) return false;
  const pa = a.partners;
  const pb = b.partners;
  if (pa === pb) return true;
  if (pa.length !== pb.length) return false;
  for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) return false;
  return true;
}

function sameProblems(a: readonly ChannelProblem[], b: readonly ChannelProblem[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    // A message is a key with parameters: few and small, compared as the string did.
    if (a[i].path !== b[i].path || (a[i].message !== b[i].message && JSON.stringify(a[i].message) !== JSON.stringify(b[i].message))) return false;
  }
  return true;
}

function sameIds(a: readonly ChannelRef[], b: readonly ChannelRef[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].id !== b[i].id) return false;
  return true;
}

/** Whether `a` and `b` tell the readers of the channel service the same (see the file comment). */
export function sameChannelSet(a: ChannelSet, b: ChannelSet): boolean {
  if (a === b) return true;
  if (a.layout !== b.layout || (a.self?.id ?? null) !== (b.self?.id ?? null) || a.truncated !== b.truncated) return false;
  if (a.members.length !== b.members.length || a.marks.length !== b.marks.length || a.outside.length !== b.outside.length) return false;
  for (let i = 0; i < a.members.length; i++) if (!sameMember(a.members[i], b.members[i])) return false;
  if (!sameIds(a.missing, b.missing) || !sameRanges(a.outside, b.outside) || !sameProblems(a.problems, b.problems)) return false;
  for (let i = 0; i < a.marks.length; i++) if (!sameHit(a.marks[i], b.marks[i])) return false;
  return true;
}
