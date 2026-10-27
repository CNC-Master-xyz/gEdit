// The channel service (plan §7.17, AD-32). Built by WP12.5.
//
// Which channel a document and a line are in, and the wait-code check over the open
// channels. The order is AD-32's: the document's effective machine -> that record's
// `channels` block (`channelBlock`) -> `findSections` (one document) or the file name,
// the marker and the user's assignment (one document per channel) -> `findMarks`.
// No machine, no block, a broken block or no match: `layout: 'none'`, and nothing in the
// UI changes.
//
// Three rules it keeps (they are the contract in `app/types.ts`):
//  - It never opens a file (standing rule 14). Siblings are asked about through
//    `channelSiblings` (metadata only), once per document and on demand, never on a timer;
//    a name that cannot be derived is looked for in the folder's listing (`folderSiblings`,
//    names only, P4.30b). A Siemens job list counts only when the user has it open (J1).
//  - `forDoc` always answers, synchronously, from its cache. The expensive part (sections
//    and marks) is re-run after the outline's 150 ms aggregation, on a machine change, an
//    assignment or a changed path, never on the keystroke path; the cheap part (which
//    open document is channel 2) is re-assembled when a document opens, closes or is
//    assigned. After an edit it is patched from the lines the edits touched
//    (`core/channels/incremental.ts`) instead of read again in full, whenever those lines
//    decide no section (M12 performance fix F2: a full read of 300,000 lines after every
//    pause in typing froze the editor).
//  - One machine decides a check: every member is read with the initiating document's
//    machine, and a sibling that is set to another machine is named, not mixed in.
//
// T171: when the machine's channel rules hold a regular expression of the user's, the
// expensive part never runs a pattern first on the editor's thread. `deps.guard` hands a
// background reader (a Web Worker, `core/regexGuard`); every resolution asks it to run the
// patterns over the lines first (2 s after a machine change or on opening a program, 0.5 s
// over the edited lines after an edit). A pattern that runs out of time is stopped there: the
// document gets "no channels" with a problem that names the pattern, and no retry. Only then
// does the plain synchronous reading run, on patterns that have run to the end once. So with
// a guard, the first answer for a program is "none" until the reader has finished (the
// revision bumps then), and `fresh` answers from the last set instead of reading at once until the first reading is in (after it, `fresh` reads a pending change in place again: the channel view needs the sections right after its own edit).
// Without `deps.guard` (the unit tests, a machine with only generated matchers) nothing changes.
//
// `createChannelService(deps)` plus the singleton wired to the real modules (AD-2), so a
// unit test drives it with fakes.

import { derived, writable, type Readable } from 'svelte/store';
import { checkSyncMarksReport } from '$lib/core/channels/check';
import { waitCodeRuleOf } from '$lib/core/channels/codes';
import { channelAt, channelRefs, resolveChannelToken } from '$lib/core/channels/resolve';
import { sameChannelSet } from '$lib/core/channels/sameSet';
import { mergeDirty, patchResolution, type DirtySpan } from '$lib/core/channels/incremental';
import { findMarks, guardChannelPatterns, macroCallCodes, maskForMarks, resolveDocument, sectionOwners, userPatterns, type MacroCalls } from '$lib/core/channels/marks';
import { documentChannel, fileChannel, listingPattern, siblingNames, siblingsFromListing, type ListedSiblings } from '$lib/core/channels/siblings';
import { jobListNames, MAX_JOB_LINES, readJobList, startsLikeJobList, type JobList } from '$lib/core/channels/jobList';
import { CHANNEL_CAPS, STOPS_AND_ENDS_RULE } from '$lib/core/channels/types';
import type { ChannelBudget, ChannelMember, ChannelParams, ChannelProblem, ChannelRef, ChannelSet, SyncFinding, SyncHit } from '$lib/core/channels/types';
import { channelBlock, type ChannelBlock } from '$lib/core/machines/validate';
import { appGuardRunner } from '$lib/core/regexGuard/app';
import { GUARD_BUDGET_MS } from '$lib/core/regexGuard/guard';
import type { GuardRunner } from '$lib/core/regexGuard/runner';
import type { MachineConfig } from '$lib/core/machines/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import { editor as appEditor } from '$lib/monaco/editorService';
import { channelSiblings, folderSiblings, type FolderSiblings, type SiblingInfo } from '$lib/platform/commands';
import { status as appStatus } from '$lib/app/status';
import { t } from '$lib/i18n';
import { docs as appDocs } from '$lib/stores/documents';
import { fileMemory as appMemory } from '$lib/stores/fileMemory';
import { machines as appMachines } from '$lib/stores/machines';
import { baseName, isMacPlatform, isWindowsPlatform } from '$lib/utils/platform';
import type { ChannelService, ContentChange, Disposable, DocId, DocMeta, DocumentStore, EditorService, FileMemoryStore, Msg } from '$lib/app/types';

/** The answer for a document without channels: nothing found, nothing missing. */
export function noChannels(): ChannelSet {
  return { layout: 'none', self: null, members: [], missing: [], outside: [], marks: [], problems: [], truncated: false };
}

/** What the service needs to know about a document's effective machine. */
export interface EffectiveView {
  cp: CompiledProfile;
  /** `EffectiveMachine.key`. */
  key: string;
  machineId: string | null;
  machineName: string | null;
  /** The profile's `machineParams.channels.waitLetters`. */
  waitLetters?: readonly string[];
  /** T172: the effective code database's macro-call codes (`macroCallCodes`): a wait code after one is an argument. */
  calls?: readonly string[];
}

/** Lines the written order may not be carried across, per channel (WP12.5 computes them, see `outlineService`). */
export type JumpLinesProvider = (docId: DocId, cp: CompiledProfile, channelOf: (line: number) => string | readonly string[]) => Record<string, number[]>;

export interface ChannelServiceDeps {
  docs: Pick<DocumentStore, 'get' | 'all' | 'list'>;
  editor: Pick<EditorService, 'hasModel' | 'getLineCount' | 'getLines' | 'onDidChangeContent'>;
  effective(id: DocId): EffectiveView | null;
  machine(id: string): MachineConfig | undefined;
  block(m: MachineConfig, o: { waitLetters?: readonly string[] }): ChannelBlock;
  machineRevision?: Readable<number>;
  memory: Pick<FileMemoryStore, 'get' | 'remember'>;
  siblingInfo(path: string, names: string[]): Promise<SiblingInfo[]>;
  /**
   * P4.30b (L1 to L3): the plain names in the folder of the open document `path` that fit a
   * glob (`folder_siblings`). Absent: no listing is asked, and a name that cannot be derived
   * stays missing, as before.
   */
  folderSiblings?(path: string, pattern: string): Promise<FolderSiblings>;
  /** P4.30b (J1): a message in the status bar ("This folder has a job list."). Absent: nothing is said. */
  say?(msg: Msg): void;
  schedule(fn: () => void, ms: number): Disposable;
  now(): number;
  /** T171: the background reader of the user's patterns (`appGuardRunner`); absent or null: patterns are read in place, as before. */
  guard?: () => Promise<GuardRunner | null>;
  /** Budgets of the background reader; default 2 s (opening, machine change) and 0.5 s (the edited lines). */
  guardMs?: { full?: number; edit?: number };
  /** Names and stems compare ignoring case (macOS and Windows, as `docs.byPath`). */
  caseInsensitive: boolean;
  delayMs: number;
}

/** What the status item and the commands also need; not part of the §7.17 contract. */
export type ChannelServiceInternals = ChannelService & {
  /** The channel block of the document's machine, when it is valid and not `none`. */
  params(id: DocId): ChannelParams | null;
  /** The machine's label of a rule (`M100-M199 waits`), or '' for an unknown one. */
  ruleLabel(id: DocId, ruleId: string): string;
  /** `multi-file` machine, valid block, this document tied to no channel. */
  unassigned(id: DocId): boolean;
  /** The channel assigned by hand (`channels.assign`), or null. */
  assigned(id: DocId): string | null;
  /** WP12.5's `contrib/channels.ts` hands the check its jump-line provider. */
  useJumpLines(fn: JumpLinesProvider | null): void;
};

interface Base {
  params: ChannelParams;
  cp: CompiledProfile;
  /** `multi-file`: how this document is tied to its channel; null when it is not. */
  self: { ref: ChannelRef; by: SelfBy; stem: string | null; named: boolean } | null;
  sections: { channel: ChannelRef; ranges: { startLine: number; endLine: number }[] }[];
  outside: { startLine: number; endLine: number }[];
  marks: SyncHit[];
  problems: ChannelProblem[];
  truncated: boolean;
  /** `single-file`: the lines that decided the sections; the patch after an edit reads them. */
  boundaries: number[];
  /** The document's line count when this was resolved. */
  lineCount: number;
}

/** P4.30b (T055): the machine names the file of its first channel by `firstFileName`. */
function hasFirstFileName(p: ChannelParams): boolean {
  return typeof p.firstFileName === 'string' && p.firstFileName !== '';
}

/** How a `multi-file` document is tied to its channel (P4.30b adds the job list, J5). */
type SelfBy = 'fileName' | 'marker' | 'assigned' | 'jobList';

/** The lines of a document read once, and the masked-line memo, for the background reader and the reading after it (T171). */
interface SharedLines {
  lines: string[];
  masked: (index: number) => string;
}

/** The budget of the background reader over the lines an edit touched (T171). */
const EDIT_GUARD_MS = 500;

/** How long an abandoned resolution waits before its one retry (M12 fix F4). */
const RETRY_MS = 1000;

interface Entry {
  /** What the base was made from; a different key means "make it again". */
  key: string;
  base: Base | null;
  /** `none` until the base is known to be a layout. */
  set: ChannelSet;
  world: number;
  timer: Disposable | null;
  /** The machine block was present and broken. */
  broken: boolean;
  /**
   * The lines edited since `base` was resolved (M12 performance fix F2): the next resolution
   * patches `base` from them instead of reading the whole document; `full` after a flush.
   */
  dirty: DirtySpan | 'full' | null;
  /**
   * `timer` is the one retry of this abandoned resolution (M12 fix F4), not a pending edit.
   * `fresh` that runs it early runs it as the retry; any other resolution, including one an
   * edit asks for after a successful retry, gets its own retry if it runs out of time
   * (M12 perf review PERF-3: the flag stuck to the entry a retry made, so a `fresh` after the
   * next edit that ran out of time was never retried).
   */
  retryPending: boolean;
  /** Content changes seen since this entry was made; a background reading that started before one is dropped. */
  edits: number;
  /** A user pattern was stopped in the background reader (T171); edits wait longer before the next try. */
  stopped: boolean;
  /** P4.30b: the machine's block is valid and `multi-file`, so an open job list of the folder counts. */
  multi?: boolean;
  /** P4.30b: the job lists of the folder this was resolved with (`jobKeyOf`); another key means "make it again". */
  jobKey?: string;
}

/** How long a program whose pattern was stopped waits after an edit before the reader tries again. */
const STOPPED_RETRY_MS = 3000;

function dirOf(path: string): { dir: string; sep: string } {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (slash < 0) return { dir: '', sep: '/' };
  return { dir: path.slice(0, slash), sep: path[slash] };
}

/** `M101` and `M0101` are the same mark, and so are `P-010` and `P-10` (the Okuma negative P, manual check D2-1); anything else is compared as written. */
export function sameMarkId(a: string, b: string): boolean {
  if (a === b) return true;
  const ma = /^([A-Za-z]*-?)0*(\d+)$/.exec(a);
  const mb = /^([A-Za-z]*-?)0*(\d+)$/.exec(b);
  return ma !== null && mb !== null && ma[1].toUpperCase() === mb[1].toUpperCase() && Number(ma[2]) === Number(mb[2]);
}

export function createChannelService(deps: ChannelServiceDeps): ChannelServiceInternals {
  const revision = writable(0);
  const entries = new Map<DocId, Entry>();
  const session = new Map<DocId, string>(); // assignments of documents without a path
  const siblingCache = new Map<DocId, { path: string; info: Map<string, SiblingInfo>; listed: ListedSiblings | 'unavailable' | null }>();
  const siblingAsked = new Set<DocId>();
  // P4.30b: open documents that are job lists (J1, J2), read once per edit pause; the version
  // counts the readings that changed, so a program resolved with an older one is read again.
  const jobCache = new Map<DocId, JobList | null>();
  const jobVersion = new Map<DocId, number>();
  const jobPending = new Set<DocId>();
  let jobTimer: Disposable | null = null;
  const jobHinted = new Set<DocId>();
  const heads = new Map<DocId, string[]>();
  let epoch = 0; // machine revisions
  let world = 0; // documents opening, closing, being assigned or saved elsewhere
  let worldKey = '';
  let stops: Disposable[] = [];
  let installed = false;
  let jumpProvider: JumpLinesProvider | null = null;

  const same = (a: string, b: string): boolean => (deps.caseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b);
  const bump = (): void => revision.update((n) => n + 1);

  // --- who is assigned ----------------------------------------------------------

  function assignedOf(doc: DocMeta): string | null {
    const fromMemory = doc.path === null ? undefined : deps.memory.get(doc.path)?.channelId;
    if (typeof fromMemory === 'string') return fromMemory;
    return session.get(doc.id) ?? null;
  }

  function currentWorldKey(): string {
    return deps.docs
      .all()
      .map((d) => `${d.id}\t${d.path ?? ''}\t${assignedOf(d) ?? ''}`)
      .join('\n');
  }

  function refreshWorld(): boolean {
    const key = currentWorldKey();
    if (key === worldKey) return false;
    worldKey = key;
    world++;
    return true;
  }

  // --- resolution -----------------------------------------------------------------

  function blockOf(id: DocId): { view: EffectiveView; block: ChannelBlock } | null {
    const view = deps.effective(id);
    if (view === null || view.machineId === null) return null;
    const record = deps.machine(view.machineId);
    if (record === undefined) return null;
    return { view, block: deps.block(record, { waitLetters: view.waitLetters }) };
  }

  function linesOf(id: DocId): string[] {
    const count = deps.editor.getLineCount(id);
    return count < 1 ? [] : deps.editor.getLines(id, 1, count);
  }

  /**
   * The head of a document, as many lines as the marker reads (`CHANNEL_CAPS.markerLines`), never
   * the whole text. P4.30b: kept until the document is edited or closed, so the marker and the
   * job-list test (J2) read each other document once, not once each (CODE-6).
   */
  function headOf(id: DocId): string[] {
    const memo = heads.get(id);
    if (memo !== undefined) return memo;
    const count = Math.min(deps.editor.getLineCount(id), CHANNEL_CAPS.markerLines);
    const head = count < 1 ? [] : deps.editor.getLines(id, 1, count);
    heads.set(id, head);
    return head;
  }

  // --- the job lists (P4.30b, J1 to J7) -----------------------------------------------

  /** J1, J2: whether the open document `id` is a job list, and its entries; read once until it is edited. */
  function jobOf(id: DocId): JobList | null {
    const cached = jobCache.get(id);
    if (cached !== undefined) return cached;
    if (!deps.editor.hasModel(id)) return null;
    const count = deps.editor.getLineCount(id);
    let job: JobList | null = null;
    if (count > 0) {
      const looks = startsLikeJobList(headOf(id));
      if (looks === true || (looks === null && count > CHANNEL_CAPS.markerLines)) {
        // One line past the limit, so `readJobList` can say it stopped (J7).
        const read = readJobList(deps.editor.getLines(id, 1, Math.min(count, MAX_JOB_LINES + 1)));
        job = read.isJobList ? read : null;
      }
    }
    jobCache.set(id, job);
    return job;
  }

  /** The open job lists in `doc`'s folder (never `doc` itself), as one list; null when there is none. */
  function jobFor(doc: DocMeta): JobList | null {
    if (doc.path === null) return null;
    const here = dirOf(doc.path).dir;
    const lists: JobList[] = [];
    for (const d of deps.docs.all()) {
      if (d.id === doc.id || d.path === null || !same(dirOf(d.path).dir, here)) continue;
      const job = jobOf(d.id);
      if (job !== null) lists.push(job);
    }
    if (lists.length <= 1) return lists[0] ?? null;
    return { isJobList: true, entries: lists.flatMap((l) => l.entries), problems: [] };
  }

  /** Which job lists of `doc`'s folder a resolution used, and in which reading. */
  function jobKeyOf(doc: DocMeta): string {
    if (doc.path === null) return '';
    const here = dirOf(doc.path).dir;
    let key = '';
    for (const d of deps.docs.all()) {
      if (d.id === doc.id || d.path === null || !same(dirOf(d.path).dir, here) || jobOf(d.id) === null) continue;
      key += `${d.id}:${jobVersion.get(d.id) ?? 0};`;
    }
    return key;
  }

  /** After an edit pause: the edited documents are read again; one that is or was a job list re-resolves the programs. */
  function jobTick(): void {
    jobTimer = null;
    let changed = false;
    for (const id of jobPending) {
      const was = jobCache.get(id) ?? null;
      jobCache.delete(id);
      const now = jobOf(id);
      if (was !== null || now !== null) {
        jobVersion.set(id, (jobVersion.get(id) ?? 0) + 1);
        changed = true;
      }
    }
    jobPending.clear();
    if (changed) {
      world++;
      bump();
    }
  }

  /** J1: once per program, say that its folder holds a job list that is not open. Names only; nothing is read. */
  function hintJobList(id: DocId, entry: Entry, doc: DocMeta): void {
    const list = deps.folderSiblings;
    const say = deps.say;
    if (entry.multi !== true || doc.path === null || list === undefined || say === undefined || jobHinted.has(id)) return;
    jobHinted.add(id);
    if (jobOf(id) !== null || jobFor(doc) !== null) return;
    const path = doc.path;
    deps.schedule(() => {
      void list(path, '*.JOB')
        .then((answer) => {
          const now = deps.docs.get(id);
          if (answer.names.length > 0 && now !== undefined && jobFor(now) === null) say({ key: 'channelFiles.jobListInFolder' });
        })
        .catch(() => undefined); // the folder could not be listed: nothing to say
    }, 0);
  }

  /**
   * The channel a document is, by the user's assignment, then the header marker, then the
   * file name, then an open job list of its folder (`documentChannel`, the one rule
   * `resolveDocument` also uses).
   */
  function docChannel(
    doc: DocMeta,
    p: ChannelParams,
    cp: CompiledProfile,
    lines: (() => string[]) | null,
  ): { ref: ChannelRef; by: SelfBy; stem: string | null } | null {
    const found = documentChannel(doc.path !== null ? baseName(doc.path) : '', lines === null ? [] : lines(), cp, p, { job: jobFor(doc) });
    const stem = found.stem === '' ? null : found.stem;
    const assigned = assignedOf(doc);
    if (assigned !== null) {
      const ref = resolveChannelToken(p, assigned);
      if (ref !== null) return { ref, by: 'assigned', stem };
    }
    return found.channel === null || found.by === null ? null : { ref: found.channel, by: found.by, stem };
  }

  /**
   * The base after an edit, from the previous one, when the edit allows it (`patchResolution`);
   * null means "resolve the whole document".
   */
  function patched(id: DocId, prev: Entry | undefined, key: string, budget: ChannelBudget & MacroCalls): Base | null {
    if (prev === undefined || prev.key !== key || prev.base === null || prev.dirty === null || prev.dirty === 'full') return null;
    const doc = deps.docs.get(id);
    if (prev.multi === true && (doc === undefined || prev.jobKey !== jobKeyOf(doc))) return null;
    const base = prev.base;
    const next = patchResolution(
      {
        layout: base.params.layout === 'multi-file' ? 'multi-file' : 'single-file',
        self: base.self?.ref ?? null,
        sections: base.sections,
        outside: base.outside,
        marks: base.marks,
        boundaries: base.boundaries,
        lineCount: base.lineCount,
        problems: base.problems,
        dropped: base.truncated ? 1 : 0,
      },
      prev.dirty,
      deps.editor.getLineCount(id),
      (from, to) => deps.editor.getLines(id, from, to),
      base.cp,
      base.params,
      budget,
    );
    if (next === null) return null;
    return { ...base, sections: next.sections, outside: next.outside, marks: next.marks, boundaries: next.boundaries, lineCount: next.lineCount };
  }

  function compute(id: DocId, doc: DocMeta, prev?: Entry, retried = false, shared?: SharedLines): Entry {
    const key = baseKey(id, doc);
    const entry: Entry = { key, base: null, set: noChannels(), world, timer: null, broken: false, dirty: null, retryPending: false, edits: 0, stopped: false };
    // One budget for the patch and, when it declines or runs out of time, the full reading
    // (M12 perf review PERF-4: a large paste was patched with no deadline at all).
    const budget: ChannelBudget & MacroCalls = { deadline: deps.now() + CHANNEL_CAPS.resolveMs, now: deps.now, calls: deps.effective(id)?.calls };
    const quick = patched(id, prev, key, budget);
    if (quick !== null) {
      entry.base = quick;
      entry.multi = prev?.multi;
      entry.jobKey = prev?.jobKey;
      return finish(entry, id);
    }
    const found = blockOf(id);
    if (found === null || !deps.editor.hasModel(id)) {
      if (!deps.editor.hasModel(id)) entry.key = ''; // try again once the model exists
      return finish(entry, id);
    }
    const { view, block } = found;
    if (block.state === 'invalid') {
      entry.broken = true;
      entry.set = {
        ...noChannels(),
        problems: [{ path: '', message: { key: 'channels.problems.blockBroken' } }, ...block.problems.map((p) => ({ path: p.path, message: { key: 'channels.problems.detail', params: { text: p.message } } }))],
      };
      return finish(entry, id);
    }
    if (block.state !== 'valid' || block.params.layout === 'none') return finish(entry, id);

    const p = block.params;
    const cp = view.cp;
    const lines = shared?.lines ?? linesOf(id);
    const base: Base = { params: p, cp, self: null, sections: [], outside: [], marks: [], problems: [], truncated: false, boundaries: [], lineCount: lines.length };
    const multi = p.layout === 'multi-file';
    if (multi) {
      entry.multi = true;
      entry.jobKey = jobKeyOf(doc);
    }
    const job = multi ? jobFor(doc) : null;
    const res = resolveDocument(doc.path !== null ? baseName(doc.path) : '', lines, cp, p, { ...budget, assigned: assignedOf(doc), masked: shared?.masked, job });
    if (res.abandoned) {
      entry.set = { ...noChannels(), truncated: true, problems: [{ path: '', message: { key: 'channels.problems.tooSlow' } }] };
      // M12 fix F4: said (the status item reads the problem), and tried once more a moment
      // later, when a burst of load that ran it out of time has usually passed.
      if (!retried) {
        entry.timer = deps.schedule(() => rerun(id, entry, true), RETRY_MS);
        entry.retryPending = true;
      }
      return finish(entry, id);
    }
    if (res.layout === 'none' || (p.layout === 'multi-file' && res.self === null)) {
      // Not a channel document: nothing to show but what the resolution found to say.
      entry.set = { ...noChannels(), problems: res.problems };
      return finish(entry, id);
    }
    base.problems = res.problems;
    base.marks = res.marks;
    base.truncated = res.dropped > 0;
    base.boundaries = res.boundaries ?? [];
    if (p.layout === 'single-file') {
      base.sections = res.sections.map((s) => ({ channel: s.channel, ranges: s.ranges }));
      base.outside = res.outside;
    } else if (res.self !== null) {
      const file = doc.path !== null ? fileChannel(baseName(doc.path), p) : null;
      base.self = { ref: res.self, by: res.by ?? 'fileName', stem: res.stem === '' ? null : res.stem, named: file !== null };
    }
    entry.base = base;
    return finish(entry, id);
  }

  function baseKey(id: DocId, doc: DocMeta): string {
    const view = deps.effective(id);
    return `${view?.key ?? ''}|${view?.machineId ?? ''}|${epoch}|${doc.path ?? ''}|${assignedOf(doc) ?? ''}`;
  }

  function finish(entry: Entry, id: DocId): Entry {
    if (entry.base !== null) entry.set = assembled(id, entry.base);
    entry.world = world;
    return entry;
  }

  /** The cheap part: which open document, or which existing file, is each channel. */
  function assembled(id: DocId, base: Base): ChannelSet {
    const p = base.params;
    const refs = channelRefs(p);
    if (p.layout === 'single-file') {
      const members: ChannelMember[] = base.sections.map((s) => ({ kind: 'section', channel: s.channel, docId: id, ranges: s.ranges }));
      const found = new Set(base.sections.map((s) => s.channel.id));
      return {
        layout: 'single-file',
        self: null,
        members,
        missing: refs.filter((r) => !found.has(r.id)),
        outside: base.outside,
        marks: base.marks,
        problems: base.problems,
        truncated: base.truncated,
      };
    }
    const self = base.self as NonNullable<Base['self']>;
    const doc = deps.docs.get(id);
    const problems = [...base.problems];
    const members: ChannelMember[] = [
      {
        kind: 'file',
        channel: self.ref,
        name: doc?.title ?? '',
        path: doc?.path ?? null,
        exists: true,
        docId: id,
        by: self.by === 'assigned' ? 'assigned' : self.by,
      },
    ];
    const missing: ChannelRef[] = [];
    // Which channel each other open document is: once per document for the whole assembly.
    const channelOfDoc = new Map<DocId, ReturnType<typeof docChannel>>();
    const asChannel = (d: DocMeta): ReturnType<typeof docChannel> => {
      if (!channelOfDoc.has(d.id)) channelOfDoc.set(d.id, docChannel(d, p, base.cp, deps.editor.hasModel(d.id) ? () => headOf(d.id) : null));
      return channelOfDoc.get(d.id) ?? null;
    };
    const names = doc?.path ? derivedNames(doc, base) : null;
    const cached = doc?.path ? siblingCache.get(id) : undefined;
    const fresh = cached && doc?.path && cached.path === doc.path ? cached : null;
    const known = fresh?.info ?? null;
    const listed = fresh?.listed ?? null;
    const location = doc?.path ? dirOf(doc.path) : null;
    for (const ref of refs) {
      if (ref.id === self.ref.id) continue;
      const open = findOpenSibling(id, self, ref, asChannel);
      if (open !== null) {
        members.push({ kind: 'file', channel: ref, name: open.doc.title, path: open.doc.path, exists: true, docId: open.doc.id, by: open.by });
        continue;
      }
      const name = names?.get(ref.id) ?? null;
      // P4.30b (L2): a name that could not be derived, and the first channel's file of a machine
      // with `firstFileName` (written either way), are looked for in the folder's listing first.
      const byListing = listed !== null && (name === null || (ref.index === 0 && hasFirstFileName(p)));
      if (byListing && listed !== 'unavailable') {
        const hit = listed.found.find((f) => f.channel.id === ref.id);
        if (hit !== undefined && location !== null) {
          members.push({ kind: 'file', channel: ref, name: hit.name, path: `${location.dir}${location.sep}${hit.name}`, exists: true, docId: null, by: 'fileName' });
          continue;
        }
        const two = listed.ambiguous.find((a) => a.channel.id === ref.id);
        if (two !== undefined) {
          // Two files could be this channel: none is taken (refuse rather than guess).
          problems.push({ path: `list[${ref.index}]`, message: { key: 'channelFiles.problems.siblingAmbiguous', params: { channel: ref.name, names: two.names.join(', ') } } });
          missing.push(ref);
          continue;
        }
      }
      const info = name !== null && known !== null ? known.get(name) : undefined;
      if (name !== null && info?.exists === true && location !== null) {
        members.push({ kind: 'file', channel: ref, name, path: `${location.dir}${location.sep}${name}`, exists: true, docId: null, by: 'fileName' });
        continue;
      }
      // The listing was refused, cut off or unavailable (and a derived name, if any, is not there):
      // "could not be checked", never "not found".
      if (info?.error === 'unavailable' || (byListing && listed === 'unavailable')) {
        // "unavailable" (WP12.4): the stat failed or timed out. That is unknown, not "not there".
        problems.push({ path: `list[${ref.index}]`, message: { key: 'channels.problems.siblingUnknown', params: { channel: ref.name } } });
      }
      missing.push(ref);
    }
    members.sort((a, b) => a.channel.index - b.channel.index);
    return { layout: 'multi-file', self: self.ref, members, missing, outside: [], marks: base.marks, problems, truncated: base.truncated };
  }

  /**
   * The file name of each other channel of `doc`'s set, by channel id: from the machine's name
   * rules (`siblingNames`), and (P4.30b, J5) where they give none, from an open job list of the
   * folder (`jobListNames`). `null`: not derived (the folder's listing may still find it).
   */
  function derivedNames(doc: DocMeta, base: Base): Map<string, string | null> {
    const out = new Map<string, string | null>();
    const self = base.self;
    if (self === null || doc.path === null) return out;
    const own = baseName(doc.path);
    if (self.named) for (const n of siblingNames(own, base.params, self.ref.id) ?? []) out.set(n.channel.id, n.name);
    const job = jobFor(doc);
    if (job !== null) {
      for (const [channel, name] of jobListNames(job, base.params)) {
        if (channel === self.ref.id || name === null || same(name, own) || (out.get(channel) ?? null) !== null) continue;
        out.set(channel, name);
      }
    }
    return out;
  }

  function findOpenSibling(
    id: DocId,
    self: NonNullable<Base['self']>,
    ref: ChannelRef,
    asChannel: (d: DocMeta) => ReturnType<typeof docChannel>,
  ): { doc: DocMeta; by: SelfBy } | null {
    let best: { doc: DocMeta; by: SelfBy; score: number } | null = null;
    for (const d of deps.docs.all()) {
      if (d.id === id) continue;
      const found = asChannel(d);
      if (found === null || found.ref.id !== ref.id) continue;
      let score = 1;
      if (self.stem !== null && found.stem !== null) {
        if (!same(self.stem, found.stem)) continue; // another job's file
        score = 2;
      }
      if (best === null || score > best.score) best = { doc: d, by: found.by, score };
    }
    return best === null ? null : { doc: best.doc, by: best.by };
  }

  // --- the service ----------------------------------------------------------------

  function entryOf(id: DocId): Entry | null {
    const doc = deps.docs.get(id);
    if (doc === undefined) return null;
    install();
    let entry = entries.get(id);
    // P4.30b: a program resolved before a job list of its folder was opened, edited or closed is read again.
    const jobsMoved = entry !== undefined && entry.multi === true && entry.jobKey !== jobKeyOf(doc);
    if (entry === undefined || entry.key !== baseKey(id, doc) || jobsMoved) {
      entry?.timer?.();
      if (guardedParams(id) !== null) {
        // T171: no pattern of the user's runs on this thread before the background reader has
        // read the program with it. The answer is "none" until then; the reading starts at once.
        entry = waiting(id, doc);
        entries.set(id, entry);
      } else {
        entry = compute(id, doc);
        entries.set(id, entry);
        afterCompute(id, entry, doc);
      }
    } else if (entry.world !== world && entry.base !== null) {
      entry.set = assembled(id, entry.base);
      entry.world = world;
    }
    return entry;
  }

  /** Once per document: ask which sibling files exist (never on a timer, never by opening). */
  function afterCompute(id: DocId, entry: Entry, doc: DocMeta): void {
    hintJobList(id, entry, doc);
    if (entry.base?.params.layout !== 'multi-file' || entry.base.self === null || doc.path === null) return;
    const cached = siblingCache.get(id);
    if (cached !== undefined && cached.path === doc.path) return;
    if (siblingAsked.has(id)) return;
    siblingAsked.add(id);
    deps.schedule(() => void refreshSiblings(id), 0);
  }

  async function refreshSiblings(id: DocId): Promise<void> {
    let again = false;
    try {
      const doc = deps.docs.get(id);
      const entry = entries.get(id);
      if (doc === undefined || doc.path === null || entry?.base === null || entry === undefined) return;
      const asked = doc.path;
      const base = entry.base;
      const self = base.self;
      if (self === null) return;
      const derived = derivedNames(doc, base);
      const names = [...new Set([...derived.values()].filter((n): n is string => n !== null))].slice(0, CHANNEL_CAPS.siblingNames);
      // P4.30b (L1 to L3): a channel whose name cannot be derived is looked for in the folder's
      // listing, names only, with the stem and `*`; nothing is opened.
      let listed: ListedSiblings | 'unavailable' | null = null;
      const underived = channelRefs(base.params).some(
        (ref) => ref.id !== self.ref.id && ((derived.get(ref.id) ?? null) === null || (ref.index === 0 && hasFirstFileName(base.params))),
      );
      const pattern = self.named && underived && deps.folderSiblings !== undefined ? listingPattern(baseName(asked), base.params) : null;
      if (pattern !== null && deps.folderSiblings !== undefined) {
        try {
          const answer = await deps.folderSiblings(asked, pattern);
          // A cut-off listing may hide a second name for a channel: that is "could not be checked".
          listed = answer.unavailable || answer.truncated ? 'unavailable' : siblingsFromListing(baseName(asked), answer.names, base.params, self.ref.id);
        } catch {
          listed = 'unavailable';
        }
      }
      let info = new Map<string, SiblingInfo>();
      if (names.length > 0) {
        try {
          info = new Map((await deps.siblingInfo(asked, names)).map((i) => [i.name, i]));
        } catch {
          // Refused as a whole (out of scope, a permission error): that is "could not be
          // checked" (owner answer M12-5), never "not found" - the folder was not read.
          info = new Map(names.map((name) => [name, { name, exists: false, bytes: 0, modified: null, error: 'unavailable' }]));
        }
      }
      siblingCache.set(id, { path: asked, info, listed });
      world++;
      bump();
      // Saved under another name while the call was out: the answer is for the old path.
      again = deps.docs.get(id)?.path !== asked;
    } finally {
      siblingAsked.delete(id);
    }
    const entry = entries.get(id);
    const doc = deps.docs.get(id);
    if (again && entry !== undefined && doc !== undefined) afterCompute(id, entry, doc); // asks again for the new path
  }

  // --- the background reader (T171) --------------------------------------------

  /** The channel block of the document's machine when it holds a pattern the user wrote, a guard is wired and the model exists; else null. */
  function guardedParams(id: DocId): ChannelParams | null {
    if (deps.guard === undefined || !deps.editor.hasModel(id)) return null;
    const found = blockOf(id);
    if (found === null || found.block.state !== 'valid' || found.block.params.layout === 'none') return null;
    return userPatterns(found.block.params).length > 0 ? found.block.params : null;
  }

  /** An entry for a document whose first reading is with the background reader: nothing found yet, the reading scheduled now. */
  function waiting(id: DocId, doc: DocMeta): Entry {
    const entry: Entry = { key: baseKey(id, doc), base: null, set: noChannels(), world, timer: null, broken: false, dirty: null, retryPending: false, edits: 0, stopped: false };
    entry.timer = deps.schedule(() => rerun(id, entry), 0);
    return entry;
  }

  /**
   * `rerun` with the background reader in front: the user's patterns run over the program there
   * first (the whole program, or only the lines the edit touched when the resolution can be
   * patched), and only a program they came through is read by the plain code. A change made
   * while the reader was busy drops the answer: its own reading is already scheduled.
   */
  async function rerunGuarded(id: DocId, entry: Entry, retried: boolean): Promise<void> {
    const doc = deps.docs.get(id);
    const found = blockOf(id);
    if (doc === undefined || found === null || found.block.state !== 'valid' || deps.guard === undefined) return;
    const { view, block } = found;
    const p = block.params;
    const key = baseKey(id, doc);
    const edits = entry.edits;
    const span = entry.key === key && entry.base !== null && entry.dirty !== null && entry.dirty !== 'full' ? entry.dirty : null;
    let runner: GuardRunner | null = null;
    try {
      runner = await deps.guard();
    } catch {
      runner = null; // no reader: read in place, as without a guard
    }
    let shared: SharedLines | undefined;
    let verdict: Awaited<ReturnType<typeof guardChannelPatterns>>;
    if (span !== null) {
      const count = deps.editor.getLineCount(id);
      const edited = count < 1 ? [] : deps.editor.getLines(id, Math.min(span.startLine, count), Math.min(span.endLineNew, count));
      verdict = await guardChannelPatterns(runner, edited, view.cp, p, { budgetMs: deps.guardMs?.edit ?? EDIT_GUARD_MS });
    } else {
      const lines = linesOf(id);
      const cache: (string | undefined)[] = new Array(lines.length);
      const masked = (i: number): string => (cache[i] ??= maskForMarks(lines[i], view.cp));
      shared = { lines, masked };
      verdict = await guardChannelPatterns(runner, lines, view.cp, p, { masked, budgetMs: deps.guardMs?.full ?? GUARD_BUDGET_MS });
    }
    const now = deps.docs.get(id);
    if (entries.get(id) !== entry || entry.edits !== edits || now === undefined || baseKey(id, now) !== key) return;
    const before = entry.set;
    if (!verdict.ok) {
      const stopped: Entry = { key, base: null, set: { ...noChannels(), problems: [verdict.problem] }, world, timer: null, broken: false, dirty: null, retryPending: false, edits, stopped: true };
      entries.set(id, stopped);
      if (!sameChannelSet(before, stopped.set)) bump();
      return;
    }
    const next = compute(id, now, entry, retried, shared);
    entries.set(id, next);
    afterCompute(id, next, now);
    if (!sameChannelSet(before, next.set)) bump();
  }

  /** Resolves `entry`'s document again (patched when the edits allow) and tells the readers if it changed. */
  function rerun(id: DocId, entry: Entry, retried = false): void {
    entry.timer = null;
    const doc = deps.docs.get(id);
    if (doc === undefined || entries.get(id) !== entry) return;
    if (guardedParams(id) !== null) {
      void rerunGuarded(id, entry, retried).catch(() => undefined);
      return;
    }
    const before = entry.set;
    const next = compute(id, doc, entry, retried);
    entries.set(id, next);
    if (!sameChannelSet(before, next.set)) bump();
  }

  function onContentChange(id: DocId, change: ContentChange): void {
    heads.delete(id);
    // P4.30b: a document already read as a job list or as none (it lies in a channel program's
    // folder) is read again after the pause (J2; the head only, unless it is a job list). One
    // that was never read is read when a program of its folder asks, with what it holds then.
    if (jobCache.has(id)) {
      jobPending.add(id);
      if (jobTimer === null) jobTimer = deps.schedule(jobTick, deps.delayMs);
    }
    const entry = entries.get(id);
    if (entry === undefined) return;
    // The lines this edit touched, added to those since the last resolution (F2).
    entry.dirty = change.flush || entry.dirty === 'full' ? 'full' : mergeDirty(entry.dirty, change);
    entry.timer?.();
    entry.retryPending = false;
    entry.edits++;
    entry.timer = deps.schedule(() => rerun(id, entry), entry.stopped ? Math.max(deps.delayMs, STOPPED_RETRY_MS) : deps.delayMs);
  }

  function install(): void {
    if (installed) return;
    installed = true;
    worldKey = currentWorldKey();
    stops = [
      deps.editor.onDidChangeContent((id, change) => onContentChange(id, change)),
      deps.docs.list.subscribe(() => {
        if (!refreshWorld()) return;
        const open = new Set(deps.docs.all().map((d) => d.id));
        for (const id of [...jobCache.keys(), ...jobHinted, ...heads.keys()]) {
          if (open.has(id)) continue;
          heads.delete(id);
          jobCache.delete(id);
          jobVersion.delete(id);
          jobPending.delete(id);
          jobHinted.delete(id);
        }
        for (const id of [...entries.keys()]) {
          if (!open.has(id)) {
            entries.get(id)?.timer?.();
            entries.delete(id);
            siblingCache.delete(id);
            siblingAsked.delete(id);
            session.delete(id);
          }
        }
        bump();
      }),
      ...(deps.machineRevision === undefined
        ? []
        : [
            deps.machineRevision.subscribe(() => {
              epoch++;
              if (entries.size > 0) bump();
            }),
          ]),
    ];
  }

  function forDoc(id: DocId): ChannelSet {
    return entryOf(id)?.set ?? noChannels();
  }

  /** Like `forDoc`, but a change that is still waiting for its 150 ms is applied now. */
  function fresh(id: DocId): ChannelSet {
    const entry = entryOf(id);
    const doc = deps.docs.get(id);
    // With a background reader (T171) the first reading of a program, and one that stopped a pattern, is not made here:
    // the answer is the last set. A program the reader has let through (it has a base) is read in place for a pending
    // change, as before: the channel view asks for the sections right after every edit it maps (`freshSet`), and the
    // last set is the one from before that edit, so a line break it typed was judged against sections that had not
    // moved (the edit was taken back) and a section start typed over against sections that were still there (it stayed).
    const held = entry !== null && entry.base === null && guardedParams(id) !== null;
    if (entry?.timer != null && doc !== undefined && !held) {
      entry.timer();
      entry.timer = null;
      const before = entry.set;
      const next = compute(id, doc, entry, entry.retryPending);
      entries.set(id, next);
      afterCompute(id, next, doc);
      if (!sameChannelSet(before, next.set)) bump();
    }
    return forDoc(id);
  }

  function paramsOf(id: DocId): ChannelParams | null {
    const found = blockOf(id);
    return found !== null && found.block.state === 'valid' && found.block.params.layout !== 'none' ? found.block.params : null;
  }

  return {
    revision: derived(revision, (r) => r),

    start(): Disposable {
      install();
      return () => {
        if (!installed) return;
        installed = false;
        for (const stop of stops.reverse()) stop();
        stops = [];
        for (const e of entries.values()) e.timer?.();
        entries.clear();
        jobTimer?.();
        jobTimer = null;
        heads.clear();
        jobCache.clear();
      };
    },

    forDoc,

    fresh,

    channelAt(id: DocId, line: number): ChannelRef | null {
      return channelAt(forDoc(id), line);
    },

    /**
     * M12.5 (§7.16 #178, decision 4): the plain `codes` rule of this document's machine that
     * lists the word. A pure lookup on the machine's valid block (no resolution, no cache to
     * wait for), so hover answers the moment a machine is set.
     */
    waitCodeRule(id: DocId, letter: string, value: number): { ruleId: string; label: string | null; machineName: string | null; semantics: string } | null {
      const found = blockOf(id);
      if (found === null || found.block.state !== 'valid' || found.block.params.layout === 'none') return null;
      const rule = waitCodeRuleOf(found.block.params.syncMarks, letter, value);
      if (rule === null) return null;
      const label = rule.label.trim();
      const record = found.view.machineId === null ? undefined : deps.machine(found.view.machineId);
      return { ruleId: rule.id, label: label === '' ? null : label, semantics: rule.semantics ?? 'rendezvous', machineName: found.view.machineName ?? record?.name ?? null };
    },

    async siblings(id: DocId): Promise<ChannelMember[]> {
      const set = forDoc(id);
      if (set.layout !== 'multi-file') return [];
      siblingCache.delete(id);
      siblingAsked.add(id);
      await refreshSiblings(id);
      const next = forDoc(id);
      return next.members.filter((m) => m.channel.id !== next.self?.id);
    },

    assign(id: DocId, channelId: string | null): void {
      const doc = deps.docs.get(id);
      const p = paramsOf(id);
      if (doc === undefined || p === null || p.layout !== 'multi-file') return;
      if (channelId !== null && !p.list.some((c) => c.id === channelId)) return;
      if (channelId === null) session.delete(id);
      else session.set(id, channelId);
      if (doc.path !== null) deps.memory.remember(doc.path, { channelId: channelId ?? undefined });
      entries.get(id)?.timer?.();
      entries.delete(id);
      siblingAsked.delete(id);
      siblingCache.delete(id);
      refreshWorld();
      world++;
      bump();
    },

    check(id: DocId) {
      const empty = { truncated: false, findings: [] as SyncFinding[], checked: [] as string[], notChecked: [] as ChannelRef[], otherMachines: [] as { channel: string; docId: DocId; machineName: string | null }[] };
      const entry = entryOf(id);
      const base = entry?.base;
      const doc = deps.docs.get(id);
      if (!entry || !base || doc === undefined) return empty;
      const { params: p, cp } = base;
      const set = entry.set;
      const perChannel: Record<string, SyncHit[]> = {};
      const jumpLines: Record<string, number[]> = {};
      const checked: string[] = [];
      const otherMachines = empty.otherMachines;
      const documents: Record<string, string> = {};
      let siblingsLate = false;
      const longLines: { channel: string; count: number }[] = [];
      // One budget for reading every other open channel (the pattern is the user's own).
      const siblingDeadline = deps.now() + CHANNEL_CAPS.resolveMs;
      const initiating = deps.effective(id)?.machineId ?? null;
      const calls = deps.effective(id)?.calls;

      // This document is read afresh (the cached marks may be one debounce old).
      const own = resolveDocument(doc.path !== null ? baseName(doc.path) : '', linesOf(id), cp, p, {
        deadline: deps.now() + CHANNEL_CAPS.resolveMs,
        now: deps.now,
        assigned: assignedOf(doc),
        calls,
      });
      if (own.abandoned) return { ...empty, truncated: true, abandoned: true };
      if (p.layout === 'single-file') {
        for (const hit of own.marks) (perChannel[hit.channel] ??= []).push(hit);
        documents[''] = doc.title;
        for (const s of own.sections) {
          documents[s.channel.id] = doc.title;
          checked.push(s.channel.id);
          perChannel[s.channel.id] ??= [];
        }
        // A line of a shared section is in each of its channels' lists.
        if (jumpProvider !== null) Object.assign(jumpLines, jumpProvider(id, cp, sectionOwners(own.sections)));
      } else {
        for (const m of set.members) {
          if (m.kind !== 'file' || m.docId === null) continue;
          const ch = m.channel.id;
          if (m.docId === id) perChannel[ch] = own.marks;
          else {
            const read = findMarks(linesOf(m.docId), cp, p, { channelOf: () => ch, deadline: siblingDeadline, now: deps.now, calls });
            perChannel[ch] = read.marks;
            if (read.abandoned) siblingsLate = true;
            if ((read.longLines ?? 0) > 0) longLines.push({ channel: ch, count: read.longLines ?? 0 });
          }
          checked.push(ch);
          documents[ch] = m.name;
          if (jumpProvider !== null) {
            const found = jumpProvider(m.docId, cp, () => ch)[ch];
            if (found) jumpLines[ch] = found;
          }
          if (m.docId !== id) {
            const view = deps.effective(m.docId);
            if ((view?.machineId ?? null) !== initiating) otherMachines.push({ channel: ch, docId: m.docId, machineName: view?.machineName ?? null });
          }
        }
      }
      const notChecked = channelRefs(p).filter((r) => !checked.includes(r.id));
      const report = checkSyncMarksReport(perChannel, p, { jumpLines, documents, deadline: deps.now() + CHANNEL_CAPS.checkMs, now: deps.now });
      return { findings: report.findings, truncated: report.truncated || own.dropped > 0 || siblingsLate, checked, notChecked, otherMachines, longLines };
    },

    params: paramsOf,

    ruleLabel(id: DocId, ruleId: string): string {
      if (ruleId === STOPS_AND_ENDS_RULE) return '';
      return paramsOf(id)?.syncMarks.find((r) => r.id === ruleId)?.label ?? '';
    },

    unassigned(id: DocId): boolean {
      const p = paramsOf(id);
      return p !== null && p.layout === 'multi-file' && forDoc(id).layout === 'none';
    },

    assigned(id: DocId): string | null {
      const doc = deps.docs.get(id);
      return doc === undefined ? null : assignedOf(doc);
    },

    useJumpLines(fn: JumpLinesProvider | null): void {
      jumpProvider = fn;
    },
  };
}

/** The application-wide channel service. */
export const channels: ChannelServiceInternals = createChannelService({
  docs: appDocs,
  editor: appEditor,
  effective: (id) => {
    if (appDocs.get(id) === undefined) return null;
    const view = appMachines.effective(id);
    return {
      cp: view.cp,
      key: view.machine.key,
      machineId: view.machine.id,
      machineName: view.machine.name,
      waitLetters: view.profile.machineParams?.channels?.waitLetters,
      calls: macroCallCodes(view.codes),
    };
  },
  machine: (id) => appMachines.get(id),
  block: (m, o) => channelBlock(m, 'machines', o),
  machineRevision: appMachines.revision,
  memory: appMemory,
  siblingInfo: channelSiblings,
  folderSiblings,
  say: (msg) => appStatus.show(t(msg.key, msg.params)),
  schedule: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    return () => clearTimeout(handle);
  },
  now: () => performance.now(),
  guard: appGuardRunner,
  caseInsensitive: isMacPlatform() || isWindowsPlatform(),
  delayMs: 150,
});
