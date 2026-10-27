// Channel scope: the lines of one channel, for Find All and Compare (Phase 4, plan section 6.8.6,
// P4.31). Pure; no I/O.
//
// A channel set says where a channel is: line ranges of the program (`single-file`), or the
// whole document (`multi-file`: the file of that channel). This file turns the set and a
// channel id into the lines to read, or into the plain-words reason why that cannot be done.
// Rules, binding:
//
//  S1. `single-file`: the ranges of the channel's sections, in document order. A channel that
//      has no section in this program is refused (`noSection`), never read as empty.
//  S2. `multi-file`: the whole document when it is the file of that channel; refused when it
//      is another channel's file (`otherChannel`), or when it is not known which channel it
//      is (`unknownChannel`, no guess).
//  S3. No channels at all, or a resolution that ran out of its time: refused (`noChannels`,
//      `tooSlow`).
//  S4. A cut keeps the document's line numbers (`fileLines`), so a row, a go-to-line or an
//      export names the line of the file and never the line of the cut.

import type { Msg } from '$lib/app/types';
import type { CodeDb } from '$lib/core/codes/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import { normalizeRanges } from '$lib/core/search';
import type { LineRange } from '$lib/core/search/types';
import { channelRefs } from './resolve';
import { macroCallCodes, resolveDocument } from './marks';
import { CHANNEL_CAPS, type ChannelParams, type ChannelSet } from './types';

export type ScopeRange = LineRange;

export type Scope = { ok: true; ranges: ScopeRange[] | null } | { ok: false; why: Msg };

/** The machine's name for a channel as the set knows it (found, missing, or the document's own); the id when unknown. */
export function channelNameOf(set: ChannelSet, channelId: string): string {
  const known = set.members.find((m) => m.channel.id === channelId)?.channel ?? set.missing.find((c) => c.id === channelId) ?? (set.self?.id === channelId ? set.self : undefined);
  return known?.name ?? channelId;
}

/**
 * S1 to S3: the lines of channel `channelId` in `set`. `ranges` null: the whole document.
 * `document` names the program in the refusal (its title; the machine's own text, untranslated);
 * `channelName` is the machine's name for the channel when the caller knows it better than this
 * set does (a channel file knows only its own channel).
 */
export function scopeOf(set: ChannelSet, channelId: string, document: string, channelName?: string): Scope {
  const refuse = (key: string, params?: Record<string, string | number>): Scope => ({ ok: false, why: { key, params: { document, ...params } } });
  if (set.problems.some((p) => p.message.key === 'channels.problems.tooSlow')) return { ok: false, why: { key: 'channels.problems.tooSlow' } };
  const name = channelName ?? channelNameOf(set, channelId);
  if (set.layout === 'single-file') {
    const section = set.members.find((m) => m.kind === 'section' && m.channel.id === channelId);
    if (section === undefined || section.kind !== 'section' || section.ranges.length === 0) return refuse('channelScope.noSection', { channel: name });
    return { ok: true, ranges: section.ranges.map((r) => ({ startLine: r.startLine, endLine: r.endLine })) };
  }
  if (set.layout === 'multi-file') {
    if (set.self === null) return refuse('channelScope.unknownChannel');
    if (set.self.id !== channelId) return refuse('channelScope.otherChannel', { channel: name, other: set.self.name });
    return { ok: true, ranges: null };
  }
  return refuse('channelScope.noChannels');
}

/**
 * The channels a document can be limited to, in the machine's order: those `scopeOf` accepts.
 * Empty for a program without channel sections, so the form does not offer a choice.
 */
export function scopableChannels(set: ChannelSet, params: ChannelParams | null): { id: string; name: string }[] {
  if (params === null || set.layout === 'none') return [];
  return channelRefs(params)
    .filter((ref) => scopeOf(set, ref.id, '').ok)
    .map((ref) => ({ id: ref.id, name: ref.name }));
}

/** The lines of a cut and, for each, the line of the document it came from (S4). */
export interface Cut {
  lines: string[];
  /** `fileLines[i]` is the 1-based document line of `lines[i]`. */
  fileLines: Int32Array;
}

/** `lines` cut to `ranges` (null: all of them); ranges are clipped to the document and read in line order, once. */
export function cutLines(lines: readonly string[], ranges: readonly ScopeRange[] | null): Cut {
  const spans = ranges === null ? [{ startLine: 1, endLine: lines.length }] : normalizeRanges(ranges, lines.length);
  const out: string[] = [];
  const from: number[] = [];
  for (const span of spans) {
    for (let line = span.startLine; line <= span.endLine; line++) {
      out.push(lines[line - 1]);
      from.push(line);
    }
  }
  return { lines: out, fileLines: Int32Array.from(from) };
}

/**
 * `lines` read for channels the way the channel service reads a `single-file` program (a
 * program's saved text, or a program that was just rewritten). Any other layout, or a machine
 * without channels, answers `none`: the caller refuses in plain words.
 */
export function setOfLines(lines: readonly string[], cp: CompiledProfile, params: ChannelParams | null, codes: CodeDb | undefined, docId = ''): ChannelSet {
  const empty: ChannelSet = { layout: 'none', self: null, members: [], missing: [], outside: [], marks: [], problems: [], truncated: false };
  if (params === null || params.layout !== 'single-file') return empty;
  const now = () => Date.now();
  const read = resolveDocument('', lines, cp, params, { deadline: now() + CHANNEL_CAPS.resolveMs, now, calls: macroCallCodes(codes) });
  if (read.layout !== 'single-file') return { ...empty, problems: read.problems, truncated: read.abandoned };
  const found = new Set(read.sections.map((section) => section.channel.id));
  return {
    layout: 'single-file',
    self: null,
    members: read.sections.map((section) => ({ kind: 'section' as const, channel: section.channel, docId, ranges: section.ranges })),
    missing: channelRefs(params).filter((ref) => !found.has(ref.id)),
    outside: read.outside,
    marks: read.marks,
    problems: read.problems,
    truncated: read.dropped > 0,
  };
}
