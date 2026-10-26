// Whether an edit of one line can change a program's channels (v1.2.0 T026).
//
// The channel view asked the channel service for the program's resolution after every keystroke
// in a pane: the service patches the answer from the one before, which still copies every mark
// and every section range, so a program with 20,000 waits cost a few hundred milliseconds per
// character. A character typed into an ordinary line changes nothing about the channels: the
// same sections on the same lines, the same marks. It changes them only when it touches a line
// that is a wait or the start or end of a section, or when it writes one.
//
// `patchResolution` (incremental.ts) decides the same thing for the service, with the same reads:
// the section start and end patterns and the wait rules, on the lines written and on the lines that
// held a boundary or a mark before. Both are read from the text of the line (a start, an end and a
// wait are found line by line), so the old text of the edited line and the new one are all it takes.
// The answer here is never a guess either: it holds only for a program whose resolution has nothing
// to say (no problem, nothing dropped), and the unit test holds it to a full resolution over random edits.

import { findMarks, maskForMarks } from './marks';
import { lookbehindPrefilter } from './prefilter';
import { compileChannelPattern } from './resolve';
import { CHANNEL_CAPS, type ChannelParams, type ChannelSet } from './types';
import type { CompiledProfile } from '$lib/core/profiles/types';

/** Whether the resolution `set` is one an edit can be reasoned about on: sections of one program, no problem, no mark dropped. */
export function canReasonAbout(set: ChannelSet): boolean {
  return set.layout === 'single-file' && set.problems.length === 0 && !set.truncated && set.members.every((m) => m.kind === 'section');
}

const compiled = new Map<string, ReturnType<typeof compileChannelPattern>>();

/** `compileChannelPattern`, kept: the same two patterns are read for every character typed. */
function compiledPattern(pattern: string, flags: string): ReturnType<typeof compileChannelPattern> {
  const key = `${flags}\u0000${pattern}`;
  let found = compiled.get(key);
  if (found === undefined) {
    if (compiled.size > 64) compiled.clear();
    found = compileChannelPattern(pattern, flags, '');
    compiled.set(key, found);
  }
  return found;
}

/** Whether `text` can be a wait, or the start or the end of a section, under `p`: the reading of an edited line `patchResolution` declines on. */
export function lineMayBeStructure(text: string, cp: CompiledProfile, p: ChannelParams): boolean {
  if (text.length > CHANNEL_CAPS.lineLength) return true;
  const masked = maskForMarks(text, cp);
  for (const pattern of [p.sectionStart, p.sectionEnd]) {
    if (typeof pattern !== 'string') continue;
    const found = compiledPattern(pattern, cp.flags);
    if ('problem' in found) return true;
    const pre = lookbehindPrefilter(found.re);
    if ((pre === null || pre.test(masked)) && ((found.re.lastIndex = 0), found.re.test(masked))) return true;
  }
  const marks = findMarks([text], cp, p, { channelOf: () => '', masked: () => masked });
  return marks.marks.length > 0 || marks.dropped > 0 || (marks.longLines ?? 0) > 0 || marks.abandoned;
}

/**
 * Whether changing a line of a program from `oldText` to `newText` leaves its channels as they were: it held no wait and
 * neither started nor ended a section, and is none of those now. The caller says that the program's resolution is
 * one it can reason about (`canReasonAbout`).
 */
export function editKeepsChannels(oldText: string, newText: string, cp: CompiledProfile, p: ChannelParams): boolean {
  return !lineMayBeStructure(oldText, cp, p) && !lineMayBeStructure(newText, cp, p);
}
