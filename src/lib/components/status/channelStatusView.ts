// What the channel status item shows (the markup is `ChannelStatus.svelte`). A plain function
// of the channel set so the words can be tested without a DOM.

import type { ChannelParams, ChannelRef, ChannelSet } from '$lib/core/channels/types';
import { t } from '$lib/i18n';

export interface ChannelStatusView {
  id: string;
  count: string;
  missing: string;
  layout: string;
  open: string;
  label: string;
  tooltip: string;
  broken: boolean;
  /** The resolution ran out of its time (`channels.problems.tooSlow`, M12 fix F4). */
  slow?: boolean;
}

export function channelStatusView(o: {
  set: ChannelSet;
  params: ChannelParams | null;
  unassigned: boolean;
  /** 0 = not known yet. */
  cursorLine: number;
  channelAt(line: number): ChannelRef | null;
}): ChannelStatusView | null {
  const { set, params } = o;
  const count = params?.list.length ?? 0;
  // The status of a missing channel is "could not be checked" only when the service said so
  // (`siblingUnknown`); a channel without a section has a problem at the same path, which is not that.
  const unknown = (c: ChannelRef): boolean => set.problems.some((p) => p.message.key === 'channels.problems.siblingUnknown' && p.path === `list[${c.index}]`);
  const base = { count: String(count), missing: set.missing.map((c) => c.id).join(' ') };

  if (set.layout === 'none') {
    if (o.unassigned) {
      return { ...base, id: '', layout: 'multi-file', open: '', label: t('channels.status.unassigned'), tooltip: t('channels.status.unassignedTooltip'), broken: false };
    }
    if (set.problems.some((p) => p.message.key === 'channels.problems.blockBroken')) {
      return { ...base, id: '', layout: '', open: '', label: t('channels.status.broken'), tooltip: set.problems.map((p) => t(p.message.key, p.message.params)).join('\n'), broken: true };
    }
    // M12 fix F4: a resolution that was abandoned is said, never a silent "no channels".
    if (set.problems.some((p) => p.message.key === 'channels.problems.tooSlow')) {
      return { ...base, id: '', layout: '', open: '', label: t('channels.status.tooSlow'), tooltip: t('channels.problems.tooSlow'), broken: false, slow: true };
    }
    // T171: a pattern of the machine's channel rules was stopped; the item names it instead of hiding.
    const stopped = set.problems.find((p) => p.message.key === 'channels.problems.patternStopped');
    if (stopped !== undefined) {
      return { ...base, id: '', layout: '', open: '', label: t('channels.status.patternStopped'), tooltip: t(stopped.message.key, stopped.message.params), broken: false, slow: true };
    }
    return null;
  }

  const lines: string[] = [set.layout === 'single-file' ? t('channels.status.tooltipSingle') : t('channels.status.tooltipMulti')];
  for (const m of set.members) {
    if (m.kind === 'section') {
      lines.push(`${m.channel.name}: ${t('channels.status.foundSections', { count: m.ranges.length })}`);
    } else {
      const how = m.by === 'fileName' ? 'channels.status.foundFileName' : m.by === 'marker' ? 'channels.status.foundMarker' : 'channels.status.foundAssigned';
      const state = m.docId !== null ? 'channels.status.stateOpen' : 'channels.status.stateNotOpen';
      lines.push(`${m.channel.name}: ${t(how)}, ${t(state)}`);
    }
  }
  // One program with sections (T127): a channel without a section is information, not a fault —
  // a one-turret program on a two-turret machine (a single `G13`) simply does not use the other
  // turret. If a wait code does name it, Check Wait Codes says so. One file per channel: a file
  // that is not in the folder stays "not found".
  const single = set.layout === 'single-file';
  for (const c of set.missing) {
    const state = unknown(c) ? 'channels.status.stateUnknown' : single ? 'channels.status.stateNotUsed' : 'channels.status.stateNotFound';
    lines.push(`${c.name}: ${t(state)}`);
  }
  // Both are already said on the channel's own line: "could not be checked", and (one program
  // with sections) "not used in this program".
  const saidOnItsLine = (key: string): boolean => key === 'channels.problems.siblingUnknown' || (single && key === 'channels.problems.channelNotFound');
  for (const p of set.problems) if (!saidOnItsLine(p.message.key)) lines.push(t(p.message.key, p.message.params));
  const open = set.members.filter((m) => m.kind === 'section' || m.docId !== null).map((m) => m.channel.id).join(' ');

  if (set.layout === 'single-file') {
    const at = o.cursorLine > 0 ? o.channelAt(o.cursorLine) : null;
    const label = at ? t('channels.status.channel', { name: at.name }) : t('channels.status.outside');
    return { ...base, id: at?.id ?? '', layout: set.layout, open, label, tooltip: lines.join('\n'), broken: false };
  }
  const self = set.self;
  const index = (self?.index ?? 0) + 1;
  let label = t('channels.status.multi', { name: self?.name ?? '', index, count });
  const notes = [
    ...set.members.filter((m) => m.kind === 'file' && m.docId === null).map((m) => t('channels.status.notOpen', { name: m.channel.name })),
    ...set.missing.map((c) => t(unknown(c) ? 'channels.status.unknown' : 'channels.status.notFound', { name: c.name })),
  ];
  if (notes.length > 0) label += `, ${notes.join(', ')}`;
  return { ...base, id: self?.id ?? '', layout: set.layout, open, label, tooltip: lines.join('\n'), broken: false };
}
