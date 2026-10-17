// Multi-channel programs: the status item, the navigation between wait codes, the check, the
// assignment and the split (plan §6 M12, WP12.5, §7.13, AD-32). One feature per file (plan
// AD-3); see ./README.md.
//
// The service (`stores/channels.ts`) knows which channel a line is in and where the wait
// codes are; this file is the keyboard, the quick picks and the reports. The decisions that
// are not UI (the next mark, the partner of a mark, the texts of a split) are plain functions
// so a unit test reads them without the app.
//
// `Mod+Alt+P` is Monaco's own "toggle preserve case" on macOS (`Cmd+Option+P`, editor focus,
// no precondition), so the removal below frees the key for `channels.gotoPartner` (§7.16 #153).
// gEdit opens nothing by itself (standing rule 14): "Open the other channels" is the file
// dialog, in this document's folder, and the user picks.
//
// The split keeps a record of what it made, for this session (`splitRecords`); "Merge Channels
// Back" (P4.23) turns the record and the documents' current text into the program's new text
// with `core/channels/merge.ts` and writes it as one undo step.
//
// Channel names are the machine's own text and stay untranslated (README rule 3).

import ArrowLeftRight from 'lucide-svelte/icons/arrow-left-right';
import Columns2 from 'lucide-svelte/icons/columns-2';
import Hourglass from 'lucide-svelte/icons/hourglass';
import Merge from 'lucide-svelte/icons/merge';
import Split from 'lucide-svelte/icons/split';
import ChannelStatus from '$lib/components/status/ChannelStatus.svelte';
import { asIcon } from '$lib/app/icons';
import { dialogs } from '$lib/app/dialogs';
import { files } from '$lib/app/fileOps';
import { modals } from '$lib/app/modals';
import { computeJumpLines } from '$lib/app/outlineService';
import { channelRefs, channelsAt } from '$lib/core/channels/resolve';
import { resolveDocument, shownMark } from '$lib/core/channels/marks';
import { planMerge, splitRecord, type SplitRecord } from '$lib/core/channels/merge';
import { answersWait, markIdOf, pairsByList, waitKey } from '$lib/core/channels/panes';
import { status } from '$lib/app/status';
import { CHANNEL_CAPS, type ChannelParams, type ChannelRef, type ChannelSet, type SyncFinding, type SyncHit, type SyncRule } from '$lib/core/channels/types';
import { applyLines } from '$lib/monaco/applyLines';
import { editor } from '$lib/monaco/editorService';
import { channels } from '$lib/stores/channels';
import { docs } from '$lib/stores/documents';
import { machines } from '$lib/stores/machines';
import { results } from '$lib/stores/results';
import { lockRefusal } from '$lib/app/readOnlyLock';
import { t } from '$lib/i18n';
import type { ChannelService, CommandContext, Contribution, Disposable, DocId, DocMeta, Msg, QuickPickItem, ReportData } from '$lib/app/types';

function hasDocument(context: CommandContext): boolean {
  return context.activeDocId !== null;
}

function say(msg: Msg, error = false): void {
  status.show(t(msg.key, msg.params), error ? { error: true } : undefined);
}

// --- the decisions ----------------------------------------------------------

/**
 * The next (`dir` 1) or previous (-1) mark after `line`, wrapping like bookmarks do;
 * null when there is none at all.
 */
export function stepSync(marks: readonly SyncHit[], line: number, dir: 1 | -1): { mark: SyncHit; wrapped: boolean } | null {
  if (marks.length === 0) return null;
  const sorted = [...marks].sort((a, b) => a.line - b.line);
  if (dir === 1) {
    const next = sorted.find((m) => m.line > line);
    return next ? { mark: next, wrapped: false } : { mark: sorted[0], wrapped: true };
  }
  const prev = [...sorted].reverse().find((m) => m.line < line);
  return prev ? { mark: prev, wrapped: false } : { mark: sorted[sorted.length - 1], wrapped: true };
}

export type PartnerAnswer =
  | { kind: 'found'; channel: ChannelRef; docId: DocId; hit: SyncHit }
  | { kind: 'notOpen'; channel: ChannelRef }
  | { kind: 'none' };

/**
 * The same wait in the next channel it names, paired as the channel view pairs it
 * (`alignPanes`, `core/channels/panes.ts`). Only the channels the wait names are asked. A
 * channel that is not open cannot answer (`marksOf` null); it is named when no open channel does.
 *
 * - By the pairing key (`waitKey`, the owner's rule of 2026-10-17, §7 #388): the same code
 *   **and the same `P` set** (the channel's own included), the n-th occurrence in this channel
 *   with the n-th in the other. So an `M901 P12` is answered by the `M901 P12` of the other
 *   channel and never by an `M901 P123`, and a program that waits on `M901 P12` three times has
 *   three distinct partners. With `rules`, a `samePartners` rule's `P`-less wait meets only a
 *   `P`-less one (P4e review NC-3).
 * - A rule that `pairsByList` (the Siemens `WAITM`, P4e review NC-4; needs `rules`): the n-th
 *   wait of its id in this channel that names the other channel meets the n-th wait of that id
 *   there that names this one, as Check Wait Codes pairs them; when there is none, a mark there
 *   that answers it (`SETM` of the id) is the partner.
 */
export function findPartner(o: {
  order: readonly ChannelRef[];
  self: string;
  mark: SyncHit;
  ownMarks: readonly SyncHit[];
  marksOf(channelId: string): { docId: DocId; marks: readonly SyncHit[] } | null;
  /** The machine's wait rules (`ChannelParams.syncMarks`); absent: every rule pairs by `waitKey`. */
  rules?: readonly SyncRule[];
}): PartnerAnswer {
  const ruleOf = (id: string): SyncRule | undefined => o.rules?.find((r) => r.id === id);
  const rule = ruleOf(o.mark.ruleId);
  const byList = o.mark.blocking && pairsByList(rule);
  const key = waitKey(o.mark, rule);
  const id = markIdOf(o.mark);
  const k = o.ownMarks.filter((h) => h.channel === o.mark.channel && h.line <= o.mark.line && waitKey(h, rule) === key).length - 1;
  const at = o.order.findIndex((c) => c.id === o.self);
  let notOpen: ChannelRef | null = null;
  for (let step = 1; step < o.order.length; step++) {
    const channel = o.order[(at + step) % o.order.length];
    if (!o.mark.partners.includes(channel.id)) continue;
    const info = o.marksOf(channel.id);
    if (info === null) {
      notOpen ??= channel;
      continue;
    }
    if (byList) {
      // Channel by channel: the n-th of this id naming that channel meets the n-th there naming this one.
      const sameWait = (h: SyncHit): boolean => h.blocking && h.ruleId === o.mark.ruleId && markIdOf(h) === id;
      const n = o.ownMarks.filter((h) => h.channel === o.mark.channel && h.line <= o.mark.line && sameWait(h) && h.partners.includes(channel.id)).length - 1;
      const hit = info.marks.filter((h) => sameWait(h) && h.partners.includes(o.self))[Math.max(n, 0)];
      if (hit) return { kind: 'found', channel, docId: info.docId, hit };
      const answer = info.marks.find((h) => markIdOf(h) === id && answersWait(h, ruleOf(h.ruleId)));
      if (answer) return { kind: 'found', channel, docId: info.docId, hit: answer };
      continue;
    }
    const hit = info.marks.filter((h) => waitKey(h, rule) === key)[Math.max(k, 0)];
    if (hit) return { kind: 'found', channel, docId: info.docId, hit };
  }
  return notOpen ? { kind: 'notOpen', channel: notOpen } : { kind: 'none' };
}

/**
 * One text per channel for `channels.splitToDocuments`: the program's own header (the lines
 * before the first section: the `%` leader, the `O` number, the `%_N_…_MPF` block) and then
 * that channel's ranges in document order.
 */
export function splitTexts(lines: readonly string[], set: ChannelSet): { channel: ChannelRef; text: string }[] {
  const header = set.outside.find((r) => r.startLine === 1);
  const head = header ? lines.slice(0, header.endLine) : [];
  const out: { channel: ChannelRef; text: string }[] = [];
  for (const m of set.members) {
    if (m.kind !== 'section') continue;
    const body = m.ranges.flatMap((r) => lines.slice(r.startLine - 1, r.endLine));
    out.push({ channel: m.channel, text: [...head, ...body].join('\n') });
  }
  return out;
}

/**
 * What a mark is called on screen: its code, or the rule's label for a code-less one. A
 * `prefix` rule's mark is keyed by its digits and shown with the prefix, `M130` and not `30`
 * (M13 review NC-10). Exported for the tests.
 */
export function markName(docId: DocId, hit: SyncHit): string {
  if (hit.mark === '') return channels.ruleLabel(docId, hit.ruleId) || hit.ruleId;
  return shownMark(hit.mark, channels.params(docId)?.syncMarks.find((rule) => rule.id === hit.ruleId));
}

// --- navigation ---------------------------------------------------------------

function cursorLine(): number {
  return editor.cursor()?.line ?? 1;
}

/** The resolution ran out of its time (M12 fix F4): the set is empty, but not because there are no channels. */
function tooSlow(set: ChannelSet): boolean {
  return set.problems.some((p) => p.message.key === 'channels.problems.tooSlow');
}

/**
 * "This program has no channels", or, for a program that took too long to read, that
 * (M12 perf review PERF-2: Alt+F7 and Go to Partner said "no channels" for it).
 */
function sayNoChannels(set: ChannelSet): void {
  if (tooSlow(set)) say({ key: 'channels.problems.tooSlow' }, true);
  else say({ key: 'channels.nav.noChannels' });
}

function stepSyncPoint(dir: 1 | -1): void {
  const id = docs.getActiveId();
  if (id === null) return;
  const set = channels.fresh(id);
  if (set.layout === 'none') {
    sayNoChannels(set);
    return;
  }
  const line = cursorLine();
  const here = channelsAt(set, line);
  // Outside every channel (the header) the step runs over all of the program's marks;
  // in a section several channels share, over the marks of each of them.
  const marks = here.length === 0 ? set.marks : set.marks.filter((m) => here.some((c) => c.id === m.channel));
  const found = stepSync(marks, line, dir);
  if (found === null) {
    say(here.length === 0 ? { key: 'channels.nav.noMarks' } : { key: 'channels.nav.noMarksChannel', params: { channel: here.map((c) => c.name).join(', ') } });
    return;
  }
  editor.reveal(id, found.mark.line);
  const params = { mark: markName(id, found.mark), line: found.mark.line };
  say({ key: found.wrapped ? 'channels.nav.syncWrapped' : 'channels.nav.syncAt', params });
}

function gotoPartner(): void {
  const id = docs.getActiveId();
  if (id === null) return;
  const set = channels.fresh(id);
  const params = channels.params(id);
  if (set.layout === 'none' || params === null) {
    sayNoChannels(set);
    return;
  }
  const line = cursorLine();
  const mark = set.marks.find((m) => m.line === line);
  if (mark === undefined) {
    say({ key: 'channels.nav.putCursorOnMark' }, true);
    return;
  }
  const order: ChannelRef[] = params.list.map((c, index) => ({ id: c.id, name: c.name, index }));
  const answer = findPartner({
    order,
    self: mark.channel,
    mark,
    ownMarks: set.marks.filter((m) => m.channel === mark.channel),
    rules: params.syncMarks,
    marksOf: (channelId) => {
      if (set.layout === 'single-file') {
        return set.members.some((m) => m.channel.id === channelId) ? { docId: id, marks: set.marks.filter((m) => m.channel === channelId) } : null;
      }
      const member = set.members.find((m) => m.channel.id === channelId);
      if (member === undefined || member.kind !== 'file' || member.docId === null) return null;
      return { docId: member.docId, marks: channels.fresh(member.docId).marks };
    },
  });
  if (answer.kind === 'none') {
    say({ key: 'channels.nav.partnerNone' });
  } else if (answer.kind === 'notOpen') {
    say({ key: 'channels.nav.partnerNotOpen', params: { channel: answer.channel.name } }, true);
  } else {
    editor.reveal(answer.docId, answer.hit.line);
    if (answer.docId === id) {
      say({ key: 'channels.nav.partnerFound', params: { channel: answer.channel.name, line: answer.hit.line } });
    } else {
      const document = docs.get(answer.docId)?.title ?? '';
      say({ key: 'channels.nav.partnerSwitched', params: { channel: answer.channel.name, document, line: answer.hit.line } });
    }
  }
}

// --- the status item's click ---------------------------------------------------

type Pick = { kind: 'reveal'; docId: DocId; line: number } | { kind: 'focus'; docId: DocId } | { kind: 'open' } | { kind: 'assign'; channel: string | null };

function rangesText(ranges: { startLine: number; endLine: number }[]): string {
  return ranges.map((r) => (r.startLine === r.endLine ? String(r.startLine) : `${r.startLine}-${r.endLine}`)).join(', ');
}

export function selectItems(id: DocId, set: ChannelSet, assignable: { id: string; name: string }[], assigned: string | null): QuickPickItem<Pick>[] {
  const items: QuickPickItem<Pick>[] = [];
  if (set.layout === 'single-file') {
    for (const m of set.members) {
      if (m.kind !== 'section') continue;
      items.push({ label: m.channel.name, detail: t('channels.pick.lines', { lines: rangesText(m.ranges) }), value: { kind: 'reveal', docId: id, line: m.ranges[0].startLine } });
    }
  } else if (set.layout === 'multi-file') {
    for (const m of set.members) {
      if (m.kind !== 'file' || m.docId === null) continue;
      items.push({
        label: m.channel.name,
        description: m.docId === id ? t('channels.pick.thisDocument') : undefined,
        detail: m.name,
        value: { kind: 'focus', docId: m.docId },
      });
    }
    if (set.members.some((m) => m.kind === 'file' && m.docId === null) || set.missing.length > 0) {
      items.push({
        label: t('channels.pick.open'),
        detail: t('channels.pick.openDetail'),
        value: { kind: 'open' },
      });
    }
  }
  if (set.layout === 'multi-file' || assignable.length > 0) {
    for (const c of assignable) {
      if (c.id === set.self?.id) continue;
      items.push({ label: t('channels.pick.assign', { name: c.name }), value: { kind: 'assign', channel: c.id } });
    }
    if (assigned !== null) items.push({ label: t('channels.pick.clear'), detail: t('channels.pick.clearDetail'), value: { kind: 'assign', channel: null } });
  }
  return items;
}

async function openOthers(id: DocId): Promise<void> {
  const path = docs.get(id)?.path ?? null;
  const slash = path === null ? -1 : Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const defaultPath = path !== null && slash > 0 ? path.slice(0, slash) : undefined;
  const picked = await dialogs.exclusive(() => dialogs.openFiles({ multiple: true, defaultPath }));
  if (picked === undefined) return;
  if (picked.length === 0) {
    say({ key: 'channels.nav.openedNone' });
    return;
  }
  await files.open(picked);
}

async function applyPick(id: DocId, picked: Pick): Promise<void> {
  switch (picked.kind) {
    case 'reveal':
      editor.reveal(picked.docId, picked.line);
      return;
    case 'focus':
      docs.activate(picked.docId);
      editor.focus();
      return;
    case 'open':
      await openOthers(id);
      return;
    case 'assign':
      assignTo(id, picked.channel);
  }
}

function assignTo(id: DocId, channelId: string | null): void {
  const params = channels.params(id);
  const title = docs.get(id)?.title ?? '';
  channels.assign(id, channelId);
  const name = params?.list.find((c) => c.id === channelId)?.name;
  if (channelId === null) say({ key: 'channels.assignDialog.cleared', params: { title } });
  else say({ key: 'channels.assignDialog.set', params: { title, channel: name ?? channelId } });
}

async function selectChannel(): Promise<void> {
  const id = docs.getActiveId();
  if (id === null) return;
  const set = channels.forDoc(id);
  const params = channels.params(id);
  if (params === null) {
    say({ key: 'channels.nav.noChannels' });
    return;
  }
  // Refresh which sibling files exist, on demand (never on a timer).
  if (set.layout === 'multi-file') await channels.siblings(id);
  const now = channels.forDoc(id);
  const assignable = params.layout === 'multi-file' ? params.list.map((c) => ({ id: c.id, name: c.name })) : [];
  const items = selectItems(id, now, assignable, channels.assigned(id));
  const picked = await modals.quickPick(items, { placeholder: t('channels.pick.placeholder') });
  if (picked !== undefined) await applyPick(id, picked);
}

async function assignChannel(): Promise<void> {
  const id = docs.getActiveId();
  if (id === null) return;
  const params = channels.params(id);
  if (params === null || params.layout !== 'multi-file') {
    say({ key: 'channels.assignDialog.unavailable' }, true);
    return;
  }
  const current = channels.forDoc(id).self?.id ?? channels.assigned(id);
  const items: QuickPickItem<string | null>[] = params.list.map((c) => ({
    label: c.name,
    description: c.id === current ? t('channels.pick.thisDocument') : undefined,
    value: c.id,
  }));
  if (channels.assigned(id) !== null) items.push({ label: t('channels.pick.clear'), detail: t('channels.pick.clearDetail'), value: null });
  const picked = await modals.quickPick(items, { placeholder: t('channels.assignDialog.placeholder') });
  if (picked !== undefined) assignTo(id, picked);
}

// --- the check -------------------------------------------------------------------

const MAX_ROWS = 2000;

export function checkReport(o: {
  machine: string;
  current: string;
  names: Map<string, string>;
  result: ReturnType<ChannelService['check']> & { truncated?: boolean };
  docOf(channel: string): DocId | null;
  textOf(finding: SyncFinding): string;
}): ReportData {
  const { result } = o;
  const nameOf = (id: string): string => o.names.get(id) ?? id;
  const rows = result.findings.slice(0, MAX_ROWS).map((f) => ({
    channel: nameOf(f.channel),
    docId: o.docOf(f.channel),
    line: f.line,
    text: o.textOf(f),
  }));
  const parts: string[] = [];
  if (result.checked.length > 0) parts.push(t('channels.report.checked', { channels: result.checked.map(nameOf).join(', ') }));
  if (result.notChecked.length > 0) parts.push(t('channels.report.notChecked', { channels: result.notChecked.map((c) => c.name).join(', ') }));
  for (const l of result.longLines ?? []) parts.push(t('channels.report.longLines', { channel: nameOf(l.channel), count: l.count, max: CHANNEL_CAPS.lineLength }));
  for (const other of result.otherMachines) {
    parts.push(
      other.machineName === null
        ? t('channels.report.otherMachineNone', { channel: nameOf(other.channel), current: o.current })
        : t('channels.report.otherMachine', { channel: nameOf(other.channel), machine: other.machineName, current: o.current }),
    );
  }
  const count = result.findings.length;
  if (result.abandoned === true) parts.unshift(t('channels.report.slow'));
  else if (result.truncated) parts.unshift(t('channels.findings.truncated'));
  return {
    title:
      result.abandoned === true
        ? t('channels.report.titleSlow', { machine: o.machine })
        : count === 0
          ? t('channels.report.titleNone', { machine: o.machine })
          : t('channels.report.title', { machine: o.machine, count }),
    message: parts.join(' '),
    columns: [
      { key: 'channel', label: t('channels.report.columnChannel') },
      { key: 'line', label: t('channels.report.columnLine') },
      { key: 'text', label: t('channels.report.columnText') },
    ],
    rows,
    docId: docs.getActiveId() ?? undefined,
    ...(count > MAX_ROWS ? { dropped: count - MAX_ROWS } : {}),
  };
}

async function checkSync(): Promise<void> {
  const id = docs.getActiveId();
  if (id === null) return;
  const set = channels.forDoc(id);
  const params = channels.params(id);
  const machine = machines.effective(id).machine;
  // M12 fix F4: a resolution that ran out of its time is said, never an empty report.
  const slow = tooSlow(set);
  if (params === null || (set.layout === 'none' && !slow)) {
    say({ key: 'channels.report.noChannels' }, true);
    return;
  }
  const result = slow ? { findings: [], truncated: true, checked: [], notChecked: [], otherMachines: [], abandoned: true } : channels.check(id);
  const names = new Map(params.list.map((c) => [c.id, c.name]));
  const report = checkReport({
    machine: machine.name ?? t('channels.report.noMachine'),
    current: machine.name ?? t('channels.report.noMachine'),
    names,
    result,
    docOf: (channel) => {
      if (set.layout === 'single-file') return id;
      const member = set.members.find((m) => m.channel.id === channel);
      return member?.kind === 'file' ? member.docId : null;
    },
    textOf: (f) => t(f.message.key, f.message.params),
  });
  results.show(report);
  status.show(report.title, result.abandoned === true ? { error: true } : undefined);

  // "Use this machine for channel 2": one pick per sibling that is set to another machine.
  if (machine.id === null) return;
  let changed = false;
  for (const other of result.otherMachines) {
    const sibling = docs.get(other.docId);
    if (sibling === undefined) continue;
    if (!machines.compatibleWith(sibling.profileId).some((m) => m.id === machine.id)) continue;
    const channel = names.get(other.channel) ?? other.channel;
    const pick = await modals.quickPick<boolean>(
      [
        { label: t('channels.report.useMachine', { machine: machine.name ?? '', channel }), detail: t('channels.report.useMachineDetail'), value: true },
        { label: t('channels.report.leave'), value: false },
      ],
      { placeholder: t('channels.report.useMachinePlaceholder') },
    );
    if (pick === true) {
      machines.setForDoc(other.docId, machine.id);
      changed = true;
    }
  }
  if (changed) await checkSync();
}

// --- the tester --------------------------------------------------------------------

function testOnDocument(): void {
  const id = docs.getActiveId();
  if (id === null) return;
  const title = docs.get(id)?.title ?? '';
  const set = channels.forDoc(id);
  const params = channels.params(id);
  if (params === null && set.problems.length === 0) {
    say({ key: 'channels.test.machineNone' }, true);
    return;
  }
  const rows: Record<string, unknown>[] = [];
  const names = new Map((params?.list ?? []).map((c) => [c.id, c.name]));
  for (const m of set.members) {
    const text =
      m.kind === 'section'
        ? t('channels.pick.lines', { lines: rangesText(m.ranges) })
        : `${m.name}${m.docId === null ? '' : ` — ${t('channels.status.stateOpen')}`}`;
    rows.push({ what: t('channels.test.channel'), text: `${m.channel.name}: ${text}`, line: m.kind === 'section' ? m.ranges[0].startLine : null, docId: id });
  }
  for (const hit of set.marks) {
    const channel = names.get(hit.channel) ?? '';
    rows.push({ what: t('channels.test.mark'), text: `${markName(id, hit)}${channel ? ` (${channel})` : ''}`, line: hit.line, docId: id });
  }
  for (const p of set.problems) rows.push({ what: t('channels.test.problem'), text: t(p.message.key, p.message.params), line: null, docId: id });
  results.show({
    title: set.layout === 'none' ? t('channels.test.titleNone', { document: title }) : t('channels.test.title', { document: title }),
    message: t('channels.test.marks', { count: set.marks.length }),
    columns: [
      { key: 'what', label: t('channels.test.columnWhat') },
      { key: 'line', label: t('channels.report.columnLine') },
      { key: 'text', label: t('channels.test.columnText') },
    ],
    rows,
    docId: id,
  });
}

// --- the split -----------------------------------------------------------------------

let splitConfirmed = false;

async function splitToDocuments(): Promise<void> {
  const id = docs.getActiveId();
  const doc = id === null ? undefined : docs.get(id);
  if (id === null || doc === undefined) return;
  const set = channels.fresh(id);
  if (tooSlow(set)) {
    say({ key: 'channels.problems.tooSlow' }, true);
    return;
  }
  if (set.layout !== 'single-file') {
    say({ key: 'channels.split.notSingleFile' }, true);
    return;
  }
  const lines = editor.getLines(id, 1, editor.getLineCount(id));
  const texts = splitTexts(lines, set);
  if (texts.length === 0) {
    say({ key: 'channels.split.nothing' }, true);
    return;
  }
  if (!splitConfirmed) {
    const ok = await dialogs.confirm({
      title: t('channels.split.confirmTitle'),
      message: t('channels.split.confirm'),
      ok: t('channels.split.ok'),
      kind: 'info',
    });
    if (!ok) return;
    splitConfirmed = true;
  }
  const dot = doc.title.lastIndexOf('.');
  const stem = dot > 0 ? doc.title.slice(0, dot) : doc.title;
  const ext = dot > 0 ? doc.title.slice(dot) : '';
  const machineId = machines.effective(id).machine.id;
  const made: DocId[] = [];
  for (const { channel, text } of texts) {
    const next = files.newUntitled({ profileId: doc.profileId, text, activate: false });
    docs.update(next, { proposedPath: `${t('channels.split.name', { title: stem, channel: channel.name })}${ext}` });
    if (machineId !== null) machines.setForDoc(next, machineId);
    made.push(next);
  }
  splitRecords.remember(
    splitRecord({ sourceId: id, lines, set, made: texts.map((x, i) => ({ channelId: x.channel.id, docId: made[i] })) }),
  );
  docs.activate(made[0]);
  status.show(t('channels.split.done', { count: made.length }));
}

// --- the merge back (P4.23) -----------------------------------------------------------

/**
 * What the splits of this session made, by program, newest record first. A merge renews the
 * record; the older ones stay (at most `KEPT`) so that undoing a merge, which puts the
 * program back as the older record holds it, can be merged again.
 */
const KEPT = 4;

function createSplitRecords() {
  const bySource = new Map<DocId, SplitRecord[]>();
  return {
    /** A new split of a program replaces what was kept for it. */
    remember(record: SplitRecord): void {
      bySource.set(record.sourceId, [record]);
    },
    /** A merge's renewed record, in front of the older ones. */
    renew(record: SplitRecord): void {
      bySource.set(record.sourceId, [record, ...(bySource.get(record.sourceId) ?? [])].slice(0, KEPT));
    },
    /** The records of the program the document is, or a channel document of. */
    forDoc(id: DocId): SplitRecord[] {
      const own = bySource.get(id);
      if (own !== undefined) return own;
      for (const records of bySource.values()) {
        if (records[0].channels.some((c) => c.docId === id)) return records;
      }
      return [];
    },
    clear(): void {
      bySource.clear();
    },
  };
}

export const splitRecords = createSplitRecords();

/** Everything `mergeBack` touches, so a test can drive it without the app. */
export interface MergeBackDeps {
  docs: { get(id: DocId): DocMeta | undefined; activate(id: DocId): void };
  editor: { getLines(id: DocId, from: number, to: number): string[]; getLineCount(id: DocId): number };
  fresh(id: DocId): ChannelSet;
  /** The program's lines read with its machine. */
  resolve(id: DocId, lines: readonly string[]): ChannelSet;
  applyLines(id: DocId, startLine: number, endLine: number, newLines: string[]): { changedLines: number; locked?: true };
  say(msg: Msg, error?: boolean): void;
}

/** `lines` read for channels the way the service reads the document (`single-file` only). */
function resolveLines(id: DocId, lines: readonly string[]): ChannelSet {
  const empty: ChannelSet = { layout: 'none', self: null, members: [], missing: [], outside: [], marks: [], problems: [], truncated: false };
  const params: ChannelParams | null = channels.params(id);
  if (params === null || params.layout !== 'single-file') return empty;
  const now = () => Date.now();
  const read = resolveDocument('', lines, machines.effective(id).cp, params, { deadline: now() + CHANNEL_CAPS.resolveMs, now });
  if (read.layout !== 'single-file') return { ...empty, problems: read.problems, truncated: read.abandoned };
  const found = new Set(read.sections.map((section) => section.channel.id));
  return {
    layout: 'single-file',
    self: null,
    members: read.sections.map((section) => ({ kind: 'section' as const, channel: section.channel, docId: id, ranges: section.ranges })),
    missing: channelRefs(params).filter((ref) => !found.has(ref.id)),
    outside: read.outside,
    marks: read.marks,
    problems: read.problems,
    truncated: read.dropped > 0,
  };
}

/**
 * `channels.mergeBack` for the program `activeId` is, or a channel document of: refused in
 * plain words (the three refusals of `planMerge`, a locked program, a closed program), else
 * written with one `applyLines` (one undo step) and the record renewed. No question first: the
 * merge is one undo step (plan §5 P4e decision 15).
 */
export function mergeBack(deps: MergeBackDeps, activeId: DocId): void {
  const records = splitRecords.forDoc(activeId);
  if (records.length === 0) {
    deps.say({ key: 'channels.merge.noRecord' }, true);
    return;
  }
  const sourceId = records[0].sourceId;
  const source = deps.docs.get(sourceId);
  if (source === undefined) {
    deps.say({ key: 'channels.merge.sourceClosed' }, true);
    return;
  }
  const locked = lockRefusal(source, t('channels.mergeBack'));
  if (locked !== null) {
    deps.say(locked, true);
    return;
  }
  const set = deps.fresh(sourceId);
  if (tooSlow(set)) {
    deps.say({ key: 'channels.problems.tooSlow' }, true);
    return;
  }
  const count = deps.editor.getLineCount(sourceId);
  const lines = deps.editor.getLines(sourceId, 1, count);
  type Planned = ReturnType<typeof planMerge>;
  let refused: Extract<Planned, { ok: false }> | null = null;
  let idle: Extract<Planned, { ok: true }> | null = null;
  let answer: Extract<Planned, { ok: true }> | null = null;
  for (const record of records) {
    const planned = planMerge({
      record,
      source: { lines, set },
      channelLines: (docId) => (deps.docs.get(docId) === undefined ? null : deps.editor.getLines(docId, 1, deps.editor.getLineCount(docId))),
      resolve: (merged) => deps.resolve(sourceId, merged),
    });
    if (planned.ok && planned.merged.length > 0) {
      answer = planned;
      break;
    }
    // An older record helps when the program no longer reads as the newer one holds it, or the
    // newer one finds the documents in step with the program (a merge undone).
    if (planned.ok) idle ??= planned;
    else refused ??= planned;
  }
  answer ??= idle;
  if (answer === null) {
    deps.say((refused as NonNullable<typeof refused>).reason, true);
    return;
  }
  if (answer.merged.length === 0) {
    deps.say({ key: 'channels.merge.nothing' });
    return;
  }
  const done = deps.applyLines(sourceId, 1, count, answer.lines);
  if (done.locked) {
    deps.say({ key: 'readOnly.refusedUser', params: { name: source.title, action: t('channels.mergeBack') } }, true);
    return;
  }
  splitRecords.renew(answer.record);
  deps.docs.activate(sourceId);
  deps.say({ key: 'channels.merge.done', params: { count: answer.merged.length } });
}

export default {
  id: 'channels',
  commands: [
    {
      id: 'channels.nextSyncPoint',
      title: 'channels.nextSyncPoint',
      category: 'channels.category',
      icon: asIcon(Hourglass),
      keys: 'Alt+F7',
      global: true,
      enabled: hasDocument,
      run: () => stepSyncPoint(1),
    },
    {
      id: 'channels.prevSyncPoint',
      title: 'channels.prevSyncPoint',
      category: 'channels.category',
      icon: asIcon(Hourglass),
      keys: 'Shift+Alt+F7',
      global: true,
      enabled: hasDocument,
      run: () => stepSyncPoint(-1),
    },
    {
      id: 'channels.gotoPartner',
      title: 'channels.gotoPartner',
      category: 'channels.category',
      icon: asIcon(ArrowLeftRight),
      keys: 'Mod+Alt+P',
      global: true,
      enabled: hasDocument,
      run: () => gotoPartner(),
    },
    {
      id: 'channels.select',
      title: 'channels.select',
      category: 'channels.category',
      global: true,
      enabled: hasDocument,
      run: () => selectChannel(),
    },
    {
      id: 'channels.assign',
      title: 'channels.assign',
      category: 'channels.category',
      global: true,
      enabled: hasDocument,
      run: () => assignChannel(),
    },
    {
      id: 'channels.checkSync',
      title: 'channels.checkSync',
      category: 'channels.category',
      icon: asIcon(Hourglass),
      global: true,
      enabled: hasDocument,
      run: () => checkSync(),
    },
    {
      id: 'channels.splitToDocuments',
      title: 'channels.splitToDocuments',
      category: 'channels.category',
      icon: asIcon(Split),
      global: true,
      enabled: (c) => c.activeDocId !== null && channels.forDoc(c.activeDocId).layout === 'single-file',
      run: () => splitToDocuments(),
    },
    {
      id: 'channels.mergeBack',
      title: 'channels.mergeBack',
      category: 'channels.category',
      icon: asIcon(Merge),
      global: true,
      enabled: (c) => c.activeDocId !== null && splitRecords.forDoc(c.activeDocId).length > 0,
      run: () => {
        const id = docs.getActiveId();
        if (id === null) return;
        mergeBack(
          {
            docs,
            editor,
            fresh: (id) => channels.fresh(id),
            resolve: resolveLines,
            applyLines,
            say,
          },
          id,
        );
      },
    },
    {
      id: 'channels.testOnDocument',
      title: 'channels.testOnDocument',
      category: 'channels.category',
      icon: asIcon(Columns2),
      global: true,
      enabled: hasDocument,
      run: () => testOnDocument(),
    },
  ],
  ribbon: [
    { tab: 'nc', group: 'channels.group', command: 'channels.nextSyncPoint', order: 90 },
    { tab: 'nc', group: 'channels.group', command: 'channels.prevSyncPoint', order: 91 },
    { tab: 'nc', group: 'channels.group', command: 'channels.gotoPartner', order: 92 },
    { tab: 'nc', group: 'channels.group', command: 'channels.splitToDocuments', order: 93 },
    { tab: 'nc', group: 'channels.group', command: 'channels.mergeBack', order: 95 },
    { tab: 'tools', group: 'channels.toolsGroup', command: 'channels.checkSync', order: 60 },
  ],
  // Next to the machine item (15): the machine says how the control reads the program, the
  // channel says which stream of it this document is.
  statusItems: [{ id: 'channel', side: 'right', order: 16, component: ChannelStatus }],
  keybindingRemovals: [{ keys: 'Mod+Alt+P', command: 'togglePreserveCase' }],
  activate(): Disposable {
    channels.useJumpLines((id, cp, channelOf) => computeJumpLines(editor.getLines(id, 1, editor.getLineCount(id)), cp, channelOf));
    return () => channels.useJumpLines(null);
  },
} satisfies Contribution;
