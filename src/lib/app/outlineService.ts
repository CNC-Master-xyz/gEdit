// The outline service (plan §7.3, AD-12). Owner: WP3.5.
//
// One `OutlineIndex` (core/profiles/outline.ts) per open document. The first build runs
// after the first render, in slices of at most `BUILD_BUDGET_MS` (8 ms, the budget of the
// modal index), so opening a 10 MB program never blocks a frame (B1 B2; it was 20,000
// lines a slice, which is 150 ms and more on a slow engine). A machine switch that changes how
// the program reads rebuilds the same way (below). Every content change is fed into
// `applyChange`, and only the *published* items are debounced by 150 ms. `toolLines()` and
// `itemAt()` answer from the index directly, because F7 pressed right after a keystroke
// must not step to a stale line.
//
// **How the slices follow each other** (B1 fixperf). B2 scheduled every slice with
// `runWhenIdle`, and where there is no `requestIdleCallback` (the macOS webview) that is a
// timer 16 ms away: 8 ms of work, 16 ms of waiting, so the map was ready three to four times
// later than with the 20,000-line steps (Fanuc 300k: 1.46 s to 4.1 s) and folding and the
// symbol providers wait for it. Now one *pump* runs the slices of every document:
//  - the first slice of a build waits for idle time (opening a document never classifies
//    inside the event that created it);
//  - the next slices follow in the next turn of the event loop (`nextTurn`, a message, not a
//    timer), as long as no input is waiting (`inputPending`, where the engine can say so;
//    the input event that arrives meanwhile is served between two slices either way). After
//    input the pump goes back to idle time; every `CHAIN_MS` of chained work it also takes
//    one timer turn, so timers and painting are never starved;
//  - the run of lines between two looks at the clock grows with the measured cost per line,
//    inside the slice's deadline (`maxChunkLines`), and is never below `chunkLines`;
//  - the active document's build goes first, and nothing is built for `switchQuietMs` after
//    a switch to a document that is already known, so a tab switch is not taxed by a build
//    of another document (the switch onto the 10 MB program measured 49 ms, then 80 ms).
// A document is indexed once, not once per tab switch: the M1 program map re-parsed on
// every switch and paid ~36 ms on a 10 MB program (G7). Here the panel only swaps which
// store it subscribes to.
//
// **The last stage** (T136). Once every line is read, the marks are put into the tree in runs
// of their own (`OutlineIndex.aggregateSome`; `AGGREGATE_LINES`, `AGGREGATE_MARKS`), inside the
// same slices and under the same budget. It used to be one stretch inside the slice that read
// the last line: 100 to 230 ms for 300,000 lines with 30,000 rows (Okuma, Sinumerik).
// While the build runs nothing is published: the tree of the part that is read was
// aggregated whole for the debounce that `rebuild` arms, and again for every keystroke typed
// meanwhile. What was published before stays until the build is done.
//
// **A machine switch** rebuilds the map only when the profile it reads is another one
// (`sameOutlineReading`): the comment, program and tool rules, the tool list and the syntax.
// A machine that changes the modal state the program starts from (power-on units, diameter
// programming, feed mode) leaves the marks as they are.
//
// Why the slice loop re-reads the line count instead of trusting the change events: while
// the first build is running, an edit *below* the built prefix needs no work at all (the
// build has not read those lines yet), and an edit *inside* it is a normal `applyChange`
// plus a shift of the build cursor. Only a change that straddles the boundary, or a flush
// (`setValue`, reload, compare), restarts the build.
//
// `createOutlineService(deps)` plus the singleton wired to the real modules (AD-2), so a
// unit test drives it with a fake editor and a fake clock.

import { writable, type Readable, type Writable } from 'svelte/store';
import { OutlineIndex, sameOutlineReading, type OutlineItem } from '$lib/core/profiles/outline';
import { editor as appEditor } from '$lib/monaco/editorService';
import { docs as appDocs } from '$lib/stores/documents';
import { machines as appMachines } from '$lib/stores/machines';
import { profiles as appProfiles } from '$lib/stores/profiles';
import { channels as appChannels } from '$lib/stores/channels';
import { STOPS_AND_ENDS_RULE } from '$lib/core/channels/types';
import { shownMark } from '$lib/core/channels/marks';
import type { ChannelFlow, ChannelParams, ChannelSet, SyncRule } from '$lib/core/channels/types';
import { FLOW_MAX_COUNT } from '$lib/core/channels/flow';
import { labelsOf, referenceAddresses, referencesOn, blockKeyOf, comparesByText, maskedOf } from '$lib/core/transforms/references';
import type { BlockKey } from '$lib/core/transforms/references';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { IDLE_BUDGET_MS, runWhenIdle } from '$lib/app/modalService';
import { CHAIN_MS, inputPending, nextTurn } from '$lib/app/scheduler';
import { t } from '$lib/i18n';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { Disposable, DocId, DocumentStore, EditorService, OutlineService } from '$lib/app/types';

/**
 * Lines the first build reads between two looks at the clock (AD-12). A slice runs at least
 * one such run and stops at the first look that finds `BUILD_BUDGET_MS` spent, so the longest
 * a slice holds the main thread is the budget plus one run.
 */
export const CHUNK_LINES = 250;
/** The most lines one run reads once the cost per line is known (B1 fixperf); the deadline still ends the slice. */
export const MAX_CHUNK_LINES = 1000;
/** How much of what is left of a slice's budget the next run is sized to use (the rest is margin). */
const RUN_SHARE = 0.7;
/**
 * The last stage of the first build, the aggregation of the marks into the tree, runs in
 * runs as well (T136): at most this many lines, or this many marks that say something (a tool
 * call, a comment, a stop), between two looks at the clock. A run of either costs a few
 * milliseconds at most, so the stage ends within the slice's budget plus one run like the
 * reading does; it used to be one stretch of 100 to 230 ms over 300,000 lines with 30,000
 * rows.
 */
export const AGGREGATE_LINES = 20_000;
export const AGGREGATE_MARKS = 400;
/** After a switch to a document that is already open, no slice runs for this long (ms). */
export const SWITCH_QUIET_MS = 150;
/** The most one slice of the first build spends, the modal index's budget (B1 B2). */
export const BUILD_BUDGET_MS = IDLE_BUDGET_MS;
/** How long the published items wait after the last change (AD-12). */
export const AGGREGATE_DELAY_MS = 150;

export interface OutlineServiceDeps {
  docs: Pick<DocumentStore, 'get' | 'list' | 'activeId' | 'getActiveId'>;
  editor: Pick<EditorService, 'hasModel' | 'getLineCount' | 'getLines' | 'onDidChangeContent' | 'onDidCreateModel'>;
  /**
   * The document's **effective** compiled profile and the key it was built from (AD-31),
   * or null while the document is unknown.
   *
   * The key, not the profile id, is what an index is rebuilt on. A machine decides which
   * G-code system a lathe program is read in, and with it which lines are tool changes —
   * so switching the machine has to rebuild the map exactly as switching the profile does.
   */
  effective(id: DocId): { cp: CompiledProfile; key: string } | null;
  /** Bumps whenever a machine or a document's choice changed, so the keys are re-read. */
  machineRevision?: Readable<number>;
  /**
   * M13 (AD-29): `profiles.revision`. A reload compiles every profile again, so a document's
   * effective profile can be a different object under the same key; the index is rebuilt for
   * those whose profile is different in content, and kept for the others.
   */
  profileRevision?: Readable<number>;
  /**
   * M12 (WP12.5): the channels of a document. With a `single-file` layout the published
   * items are grouped per channel; without it (or without this member) they are the P1 tree.
   */
  channels?: {
    forDoc(id: DocId): ChannelSet;
    revision: Readable<number>;
    ruleLabel(id: DocId, ruleId: string): string;
    /** The machine's channel block (M13 review NC-10: a `prefix` rule's marks are shown with
     *  their prefix, `M130` and not `30`). Absent = the ids as they are keyed. */
    params?(id: DocId): ChannelParams | null;
  };
  /** `setTimeout`, as a canceller; `ms` of 0 means "after this frame". */
  schedule(fn: () => void, ms: number): Disposable;
  /**
   * Runs `fn` when the app is idle (`runWhenIdle`): where the first slice of a build starts,
   * and where the build goes on after input (B1 B2). Absent, it is `schedule(fn, 0)`.
   */
  idle?(fn: () => void): Disposable;
  /**
   * Runs `fn` in the next turn of the event loop, without a timer's delay (a message): how a
   * slice follows the one before it (B1 fixperf). Absent, the slices wait on `idle` like the
   * first one.
   */
  nextTurn?(fn: () => void): Disposable;
  /** True while the user's input is waiting for the main thread (`isInputPending`); absent: never known. */
  inputPending?(): boolean;
  /** `SWITCH_QUIET_MS` when absent; 0 switches the pause off. */
  switchQuietMs?: number;
  /** The most lines a run reads once the cost per line is known; absent: `chunkLines`, a fixed run. */
  maxChunkLines?: number;
  /** The clock of the slice budget (`performance.now`). Absent, `performance.now`. */
  now?(): number;
  /** The most one slice spends, in ms; `BUILD_BUDGET_MS` when absent. */
  budgetMs?: number;
  /** Lines between two looks at the clock (`CHUNK_LINES`). */
  chunkLines: number;
  /** The most lines and the most marks one run of the aggregation covers (`AGGREGATE_LINES`, `AGGREGATE_MARKS`). */
  aggregateRun?: { lines: number; marks: number };
  delayMs: number;
}

interface Entry {
  /** `EffectiveMachine.key`: the profile **and** the machine the index was built with. */
  key: string;
  /** The compiled profile the index was built with (a reload replaces the object, not always the content). */
  cp: CompiledProfile;
  index: OutlineIndex;
  store: Writable<OutlineItem[]>;
  /**
   * The chunked first build, or null once it has finished: `next` is the first line it has
   * not read, and `aggregating` says that every line is read and the marks are being put
   * into the tree (`OutlineIndex.aggregateSome`).
   */
  build: { next: number; aggregating: boolean } | null;
  ready: Promise<void>;
  markReady: () => void;
  /** The pending aggregation. */
  publish: Disposable | null;
  id: DocId;
  /** What the grouped map was last published from, and the rows (M12 performance fix F1). */
  grouped: { items: OutlineItem[]; set: ChannelSet; rows: GroupedItem[] } | null;
}

/** A row of the grouped tree: `channelId` is set on a channel group's row (`OutlineItem.channelId`). */
export type GroupedItem = OutlineItem;

/**
 * The most waits of one channel the map lists one by one (M12 performance fix F1). Past it the
 * channel's waits are one `sync` row with their `count`, on the first wait's line, and
 * Next/Previous Sync Point (`Alt+F7`) reaches each of them. A 300k-line program with 20,000
 * waits drew 20,000 rows, and every edit rebuilt them for 7 to 14 s.
 */
export const SYNC_ROWS_MAX = 250;

/** The `sync` rows of each channel, built once per channel set (`groupByChannel`). */
const syncRowCache = new WeakMap<ChannelSet, Map<string, GroupedItem[]>>();

function syncRowsOf(set: ChannelSet, markText: (hit: ChannelSet['marks'][number]) => string): Map<string, GroupedItem[]> {
  const cached = syncRowCache.get(set);
  if (cached !== undefined) return cached;
  const perChannel = new Map<string, ChannelSet['marks']>();
  for (const hit of set.marks) {
    if (!hit.blocking || hit.ruleId === STOPS_AND_ENDS_RULE) continue;
    const list = perChannel.get(hit.channel);
    if (list) list.push(hit);
    else perChannel.set(hit.channel, [hit]);
  }
  const rows = new Map<string, GroupedItem[]>();
  for (const [channel, hits] of perChannel) {
    rows.set(
      channel,
      hits.length > SYNC_ROWS_MAX
        ? [{ kind: 'sync', line: hits[0].line, text: t('channels.map.waits', { count: hits.length }), count: hits.length }]
        : hits.map((hit) => ({ kind: 'sync', line: hit.line, text: markText(hit) })),
    );
  }
  syncRowCache.set(set, rows);
  return rows;
}

/** Same row, field by field, with the same children objects (`reuseRows`). */
function sameRow(a: GroupedItem, b: GroupedItem): boolean {
  if (a.kind !== b.kind || a.line !== b.line || a.endLine !== b.endLine || a.text !== b.text || a.tool !== b.tool || a.channelId !== b.channelId || a.count !== b.count) return false;
  const ac = a.children;
  const bc = b.children;
  if (ac === bc) return true;
  if (ac === undefined || bc === undefined || ac.length !== bc.length) return false;
  for (let i = 0; i < ac.length; i++) if (ac[i] !== bc[i]) return false;
  return true;
}

/**
 * The incremental half of the grouped map (M12 performance fix F1): every row of `next` that
 * equals a row of `previous` (same key, same fields, same children) is replaced by the
 * previous object, and so is a children list whose rows all were. The panel's keyed lists then
 * touch only the rows an edit changed, instead of redrawing the whole map.
 */
export function reuseRows(previous: readonly GroupedItem[], next: GroupedItem[]): GroupedItem[] {
  const old = new Map<string, GroupedItem>();
  const index = (rows: readonly GroupedItem[]): void => {
    for (const row of rows) {
      old.set(`${row.kind}:${row.line}:${row.channelId ?? ''}`, row);
      if (row.children) index(row.children);
    }
  };
  index(previous);
  if (old.size === 0) return next;
  const visit = (rows: GroupedItem[], before: readonly GroupedItem[] | undefined): GroupedItem[] => {
    let same = before !== undefined && before.length === rows.length;
    const out = rows.map((row, i) => {
      if (row.children) {
        const prev = old.get(`${row.kind}:${row.line}:${row.channelId ?? ''}`);
        row.children = visit(row.children, prev?.children);
      }
      const prev = old.get(`${row.kind}:${row.line}:${row.channelId ?? ''}`);
      const kept = prev !== undefined && sameRow(prev, row) ? prev : row;
      if (same && before?.[i] !== kept) same = false;
      return kept;
    });
    return same && before !== undefined ? (before as GroupedItem[]) : out;
  };
  return visit(next, previous);
}

/** Display text of the group that holds the lines no channel owns. */
function outsideText(): string {
  return t('channels.map.outside');
}

/**
 * The program map of a `single-file` document with channels: one `channel` row per channel
 * with the items of **every one of its ranges**, in document order, and its blocking marks
 * as `sync` rows; the lines no channel owns are the group "Outside the channels".
 *
 * A tool segment's children stay under it while they are in the same channel; one that
 * lies in another channel's range becomes a row of that channel.
 */
export function groupByChannel(
  items: readonly OutlineItem[],
  set: ChannelSet,
  markText: (hit: ChannelSet['marks'][number]) => string,
): GroupedItem[] {
  // Every channel that holds a line (a shared section holds it for each of its channels).
  const ownersOf = (line: number): string[] => {
    const ids: string[] = [];
    for (const m of set.members) {
      if (m.kind === 'section' && m.ranges.some((r) => line >= r.startLine && line <= r.endLine)) ids.push(m.channel.id);
    }
    return ids.length === 0 ? [''] : ids;
  };
  const groups = new Map<string, GroupedItem[]>();
  const push = (key: string, item: GroupedItem): void => {
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  };
  for (const item of items) {
    const owners = ownersOf(item.line);
    const same = (line: number): boolean => ownersOf(line).join('\t') === owners.join('\t');
    const parent: GroupedItem = { ...item };
    delete parent.children;
    const kept: OutlineItem[] = [];
    for (const child of item.children ?? []) {
      if (same(child.line)) kept.push(child);
      else for (const key of ownersOf(child.line)) push(key, child);
    }
    if (kept.length > 0) parent.children = kept;
    for (const key of owners) push(key, parent);
  }
  for (const [channel, rows] of syncRowsOf(set, markText)) for (const row of rows) push(channel, row);
  const rows: GroupedItem[] = [];
  for (const m of set.members) {
    if (m.kind !== 'section') continue;
    const children = (groups.get(m.channel.id) ?? []).sort((a, b) => a.line - b.line);
    rows.push({
      kind: 'channel',
      line: m.ranges[0].startLine,
      endLine: m.ranges[m.ranges.length - 1].endLine,
      text: m.channel.name,
      channelId: m.channel.id,
      children,
    });
  }
  const outside = groups.get('');
  if (outside !== undefined && outside.length > 0) {
    outside.sort((a, b) => a.line - b.line);
    rows.push({ kind: 'channel', line: outside[0].line, text: outsideText(), channelId: '', children: outside });
  }
  return rows;
}

/** The keywords that open (`WHILE`, `DO`, `FOR`, `LOOP`, `REPEAT`) or close (`END`, `ENDWHILE`, `ENDFOR`, `ENDLOOP`, `UNTIL`) a loop. */
const LOOP_KEYWORDS = new Set(['WHILE', 'DO', 'FOR', 'LOOP', 'REPEAT', 'END', 'ENDWHILE', 'ENDFOR', 'ENDLOOP', 'UNTIL']);

/** Does the line start or end a structured loop? (Read from the keyword tokens, so a comment or a string never counts.) */
function isLoopLine(tokens: readonly { kind: string; address?: string }[]): boolean {
  return tokens.some((tok) => tok.kind === 'keyword' && tok.address !== undefined && LOOP_KEYWORDS.has(tok.address.toUpperCase()));
}

/**
 * The lines the written order of a channel may not be carried across (§7.17 "Order not
 * checked"): a line that a jump of the SAME channel names (`GOTO`/`GOTOB`/`GOTOF`,
 * `M99 P`, `M98 Q`, through `numbering.references`; a block number or a label), and the line
 * of a backward jump. A label that nothing jumps to is not one: in a Siemens program every
 * wait line carries its own label. A jump whose target cannot be named (a variable, a
 * computed string) or is not in the channel is left out.
 *
 * The first and the last line of a structured loop (Fanuc `WHILE`/`DO n`/`END n`, Siemens
 * `WHILE`/`FOR`/`LOOP`/`REPEAT` and `ENDWHILE`/`ENDFOR`/`ENDLOOP`/`UNTIL`) are in the list too: the
 * end is a backward jump, the start is where it lands.
 */
export function computeJumpLines(
  lines: readonly string[],
  cp: CompiledProfile,
  channelOf: (line: number) => string | readonly string[],
): Record<string, number[]> {
  const out: Record<string, Set<number>> = {};
  const put = (channel: string, line: number): void => {
    (out[channel] ??= new Set()).add(line);
  };
  const finish = (): Record<string, number[]> => {
    const result: Record<string, number[]> = {};
    for (const [channel, set] of Object.entries(out)) result[channel] = [...set].sort((a, b) => a - b);
    return result;
  };
  const channelsOf = (line: number): readonly string[] => {
    const owner = channelOf(line);
    return typeof owner === 'string' ? [owner] : owner.length === 0 ? [''] : owner;
  };
  if (cp.re.references.length === 0) {
    for (let i = 0; i < lines.length; i++) {
      if (isLoopLine(tokenizeLine(lines[i], cp).tokens)) for (const channel of channelsOf(i + 1)) put(channel, i + 1);
    }
    return finish();
  }
  const addresses = referenceAddresses(cp);
  const labels = labelsOf(lines, cp);
  const byText = comparesByText(cp);
  const numbers = new Map<string, number[]>(); // `${channel}	${key}` -> lines
  const names = new Map<string, number[]>();
  const jumps: { line: number; channel: string; key: BlockKey | null; name: string | null }[] = [];
  const add = (map: Map<string, number[]>, k: string, line: number): void => {
    const list = map.get(k);
    if (list) list.push(line);
    else map.set(k, [line]);
  };
  const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const tokens = tokenizeLine(line, cp).tokens;
    // A line of a shared section is in each of its channels; outside every section it is in ''.
    const channelsHere = channelsOf(i + 1);
    const loopLine = isLoopLine(tokens);
    const masked = maskedOf(line, tokens);
    // The label that defines this line (`LAB1:`, the Okuma `NLAB1` at the head); one behind a jump names its target.
    let headLabel: string | null = null;
    for (const tok of tokens) {
      if (tok.kind === 'label' && tok.address !== undefined) {
        headLabel = tok.address.toUpperCase();
        break;
      }
      if (tok.kind !== 'whitespace' && tok.kind !== 'blockNumber' && tok.kind !== 'skip') break;
    }
    for (const channel of channelsHere) {
      if (loopLine) put(channel, i + 1);
      for (const tok of tokens) {
        if (tok.kind === 'blockNumber' && tok.valueText !== undefined) {
          const key = blockKeyOf(tok.valueText, byText);
          if (key !== null) add(numbers, `${channel}\t${String(key)}`, i + 1);
        }
      }
      if (headLabel !== null) add(names, `${channel}\t${headLabel}`, i + 1);
      for (const w of referencesOn(tokens, line, cp, addresses, labels)) jumps.push({ line: i + 1, channel, key: w.key, name: null });
      // A jump to a label of the file: `referencesOn` leaves those out on purpose.
      let named = false;
      for (let k = 0; k < tokens.length; k++) {
        const tok = tokens[k];
        if ((tok.kind !== 'keyword' && tok.kind !== 'word') || tok.address === undefined || !addresses.has(tok.address)) continue;
        const next = tokens[k + 1]?.kind === 'whitespace' ? tokens[k + 2] : tokens[k + 1];
        // The target as a `label` token (Sinumerik `GOTOF L1`, Okuma `GOTO NLAB1`) or as a plain name the file defines.
        let name: string | null = null;
        if (next !== undefined && next.kind === 'label' && next.address !== undefined) name = next.address.toUpperCase();
        else if (next !== undefined && next.kind === 'unknown' && IDENT.test(next.text) && labels.has(next.text.toUpperCase())) name = next.text.toUpperCase();
        if (name === null) continue;
        if (!cp.re.references.some((r) => r.addresses.includes(tok.address as string) && r.trigger.test(masked))) continue;
        jumps.push({ line: i + 1, channel, key: null, name });
        named = true;
      }
      // A named target behind a reference trigger without a jump keyword (the Okuma `IF [V1 EQ 1] NLAB1`), as computeFlow reads it.
      if (!named && cp.re.references.some((r) => r.trigger.test(masked))) {
        for (const tok of tokens) {
          if (tok.kind === 'label' && tok.address !== undefined && tok.address.toUpperCase() !== headLabel) jumps.push({ line: i + 1, channel, key: null, name: tok.address.toUpperCase() });
        }
      }
    }
  }
  for (const j of jumps) {
    const targets = j.key !== null ? numbers.get(`${j.channel}\t${String(j.key)}`) : j.name !== null ? names.get(`${j.channel}\t${j.name}`) : undefined;
    if (targets === undefined) continue;
    for (const target of targets) {
      put(j.channel, target);
      if (target <= j.line) put(j.channel, j.line);
    }
  }
  return finish();
}

// ---------------------------------------------------------------------------------------
// P4.32 (plan section 6.8.7, rules F1 to F5): what the wait-code check may follow
// ---------------------------------------------------------------------------------------

/** The unconditional jump keywords (Fanuc and Okuma `GOTO`, Sinumerik `GOTO`, `GOTOF`, `GOTOB`, `GOTOC`). */
const GOTO_FAMILY = /^GOTO[FBC]?$/;
/** A block number or main block number in front of a check-structure line. */
const HEAD = String.raw`^\s*(?:(?:N|:)\d+\s+)?`;
/** Sinumerik `FOR R1=1 TO 3` alone in its block, both bounds plain whole numbers. */
const FOR_LINE = new RegExp(`${HEAD}FOR\\s+[A-Z_][A-Z0-9_]*\\s*=\\s*(\\d{1,9})\\s+TO\\s+(\\d{1,9})\\s*$`, 'i');
const ENDFOR_LINE = new RegExp(`${HEAD}ENDFOR\\s*$`, 'i');
/** Sinumerik `REPEAT LABEL P=n` alone in its block (the repetition of the lines from the label to here). */
const REPEAT_LABEL = new RegExp(`${HEAD}REPEAT\\s+([A-Z_][A-Z0-9_]*)(?:\\s+P\\s*=\\s*(\\d{1,9}))?\\s*$`, 'i');
/** Any Sinumerik program section repetition with labels (`REPEAT A`, `REPEAT A B P=2`, `REPEATB A`). */
const REPEAT_ANY = new RegExp(`${HEAD}(REPEATB?)\\s+([A-Z_][A-Z0-9_]*)(?:\\s+([A-Z_][A-Z0-9_]*))?`, 'i');

/** One channel's lines as `computeFlow` reads them. */
interface FlowScan {
  numbers: Map<string, number[]>;
  names: Map<string, number[]>;
  /** Lines with a loop keyword (`isLoopLine`), plus `REPEATB` lines. */
  loopLines: Set<number>;
  gotos: { line: number; keyword: string; key: BlockKey | null; name: string | null; bare: boolean }[];
  /** The other references (`M99 P`, `M98 Q`, the Okuma `IF … N`), read as `computeJumpLines` reads them. */
  refs: { line: number; key: BlockKey | null; name: string | null }[];
  fors: { line: number; from: number; to: number; bare: boolean }[];
  endfors: { line: number; bare: boolean }[];
  repeats: { line: number; start: string; end: string | null; times: number | null; single: boolean }[];
}

/**
 * What the wait-code check may follow in each channel (plan section 6.8.7): the unconditional
 * forward jumps whose target is exactly one line of the same channel, the counted loops with a
 * literal count, and the lines it must not carry the written order across (`opaque`). Every
 * channel that holds a line gets an entry.
 *
 * - F1: a `GOTO`, `GOTOF` or `GOTOC` alone in its block (a block number or label in front is
 *   allowed) with one target line in the channel, after the jump, is followed. `IF … GOTO`, a
 *   `CASE`, a skippable block (`/`), `GOTOB`, a computed target, no target or two, and a target in
 *   another channel are opaque.
 * - F2: a followed jump's skipped lines hold no loop line and no target of any other jump.
 * - F3: a counted loop is a `FOR v=a TO b` / `ENDFOR` pair with whole-number bounds, `a < b`
 *   (`count = b - a + 1`), and a `REPEAT LABEL P=n` whose label is written once before it (`count =
 *   n + 1`: the lines run once on the way and are repeated `n` times; no `P` is `n = 1`). Its
 *   lines hold no other loop, jump or target, and nothing else jumps to its first or last line.
 *   `WHILE`, `DO`, `LOOP`, `REPEAT … UNTIL`, `REPEATB` and the other `REPEAT` forms are opaque.
 * - What is not followed is opaque the way `computeJumpLines` reads it: the target lines, and the
 *   jump's own line when it goes backward (or nowhere known); the loop lines; the labels a
 *   repetition names.
 */
export function computeFlow(
  lines: readonly string[],
  cp: CompiledProfile,
  channelOf: (line: number) => string | readonly string[],
): Record<string, ChannelFlow> {
  const scans = new Map<string, FlowScan>();
  const scanOf = (channel: string): FlowScan => {
    let s = scans.get(channel);
    if (!s) {
      s = { numbers: new Map(), names: new Map(), loopLines: new Set(), gotos: [], refs: [], fors: [], endfors: [], repeats: [] };
      scans.set(channel, s);
    }
    return s;
  };
  const push = (map: Map<string, number[]>, k: string, line: number): void => {
    const list = map.get(k);
    if (list) list.push(line);
    else map.set(k, [line]);
  };
  const addresses = referenceAddresses(cp);
  const byText = comparesByText(cp);
  const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const n = i + 1;
    const tokens = tokenizeLine(line, cp).tokens;
    const owner = channelOf(n);
    const channelsHere = typeof owner === 'string' ? [owner] : owner.length === 0 ? [''] : owner;
    const masked = maskedOf(line, tokens);
    const loopLine = isLoopLine(tokens);
    const keywords = tokens.filter((t) => t.kind === 'keyword' && t.address !== undefined).map((t) => (t.address as string).toUpperCase());
    // The head of the block: a label there defines it (`LAB:`, the Okuma `NLAB1`); one behind a jump names a target.
    let headLabel: string | null = null;
    let headToken: (typeof tokens)[number] | undefined;
    for (const tok of tokens) {
      if (tok.kind === 'label' && tok.address !== undefined) {
        headLabel = tok.address.toUpperCase();
        headToken = tok;
        break;
      }
      if (tok.kind !== 'whitespace' && tok.kind !== 'blockNumber' && tok.kind !== 'skip') break;
    }
    // The unconditional jumps of this line, with their targets.
    const gotos: FlowScan['gotos'] = [];
    const significant = tokens.filter((t) => t.kind !== 'whitespace' && t.kind !== 'comment');
    for (let k = 0; k < tokens.length; k++) {
      const tok = tokens[k];
      if (tok.kind !== 'keyword' || tok.address === undefined || !GOTO_FAMILY.test(tok.address.toUpperCase())) continue;
      let key: BlockKey | null = null;
      let name: string | null = null;
      let target: (typeof tokens)[number] | undefined;
      if (tok.valueText !== undefined && tok.valueText !== '') key = blockKeyOf(tok.valueText, byText);
      else {
        target = tokens[k + 1]?.kind === 'whitespace' ? tokens[k + 2] : tokens[k + 1];
        if (target !== undefined && target.kind === 'word' && target.valueText !== undefined && (target.address === undefined || target.address.toUpperCase() === 'N')) key = blockKeyOf(target.valueText, byText);
        else if (target !== undefined && target.kind === 'label' && target.address !== undefined) name = target.address.toUpperCase();
        else if (target !== undefined && target.kind === 'unknown' && IDENT.test(target.text)) name = target.text.toUpperCase();
      }
      // Alone in its block: a block number, a label that defines this line, the keyword and its target.
      const rest = significant.filter((t) => t !== tok && t !== target && t !== headToken && t.kind !== 'blockNumber');
      gotos.push({ line: n, keyword: tok.address.toUpperCase(), key, name, bare: rest.length === 0 });
    }
    if (gotos.length > 1) for (const g of gotos) g.bare = false;
    // The other references (computeJumpLines' reading), on a line without a jump keyword.
    const refs: FlowScan['refs'] = [];
    if (gotos.length === 0 && cp.re.references.length > 0) {
      for (const w of referencesOn(tokens, line, cp, addresses)) if (w.key !== null) refs.push({ line: n, key: w.key, name: null });
      // A named target behind a reference trigger (the Okuma `IF [V1 EQ 1] NLAB2`).
      if (cp.re.references.some((r) => r.trigger.test(masked))) {
        for (const tok of tokens) if (tok.kind === 'label' && tok.address !== undefined && tok.address.toUpperCase() !== headLabel) refs.push({ line: n, key: null, name: tok.address.toUpperCase() });
      }
    }
    const repeat = keywords.includes('REPEAT') || keywords.includes('REPEATB') ? REPEAT_ANY.exec(masked) : null;
    for (const channel of channelsHere) {
      const s = scanOf(channel);
      if (loopLine) s.loopLines.add(n);
      for (const tok of tokens) {
        if (tok.kind === 'blockNumber' && tok.valueText !== undefined) {
          const key = blockKeyOf(tok.valueText, byText);
          if (key !== null) push(s.numbers, String(key), n);
        }
      }
      if (headLabel !== null) push(s.names, headLabel, n);
      s.gotos.push(...gotos);
      s.refs.push(...refs);
      if (keywords.includes('FOR')) {
        const m = FOR_LINE.exec(masked);
        s.fors.push(m ? { line: n, from: Number(m[1]), to: Number(m[2]), bare: true } : { line: n, from: 0, to: 0, bare: false });
      }
      if (keywords.includes('ENDFOR')) s.endfors.push({ line: n, bare: ENDFOR_LINE.test(masked) });
      if (repeat !== null) {
        const single = repeat[1].toUpperCase() === 'REPEAT' ? REPEAT_LABEL.exec(masked) : null;
        if (repeat[1].toUpperCase() === 'REPEATB') s.loopLines.add(n);
        s.repeats.push({
          line: n,
          start: repeat[2].toUpperCase(),
          end: repeat[3] !== undefined && !/^P$/i.test(repeat[3]) ? repeat[3].toUpperCase() : null,
          times: single ? (single[2] === undefined ? 1 : Number(single[2])) : null,
          single: single !== null,
        });
      }
    }
  }

  const out: Record<string, ChannelFlow> = {};
  for (const [channel, s] of scans) out[channel] = flowOf(s);
  return out;
}

/** Sorted, and any of them strictly between `lo` and `hi`. */
function anyBetween(sorted: readonly number[], lo: number, hi: number): boolean {
  let left = 0;
  let right = sorted.length;
  while (left < right) {
    const mid = (left + right) >> 1;
    if (sorted[mid] <= lo) left = mid + 1;
    else right = mid;
  }
  return left < sorted.length && sorted[left] < hi;
}

/** One channel's `ChannelFlow` from its scan (the rules of `computeFlow`). */
function flowOf(s: FlowScan): ChannelFlow {
  const targetsOf = (key: BlockKey | null, name: string | null): number[] =>
    (key !== null ? s.numbers.get(String(key)) : name !== null ? s.names.get(name) : undefined) ?? [];
  /** Every line something jumps to, with the lines that jump there. */
  const targeted = new Map<number, Set<number>>();
  const aim = (target: number, from: number): void => {
    const set = targeted.get(target);
    if (set) set.add(from);
    else targeted.set(target, new Set([from]));
  };
  const gotos = s.gotos.map((g) => ({ ...g, targets: targetsOf(g.key, g.name) }));
  const refs = s.refs.map((r) => ({ ...r, targets: targetsOf(r.key, r.name) }));
  const repeats = s.repeats.map((r) => ({ ...r, starts: s.names.get(r.start) ?? [], ends: r.end !== null ? (s.names.get(r.end) ?? []) : [] }));
  for (const g of gotos) for (const t of g.targets) aim(t, g.line);
  for (const r of refs) for (const t of r.targets) aim(t, r.line);
  for (const r of repeats) for (const t of [...r.starts, ...r.ends]) aim(t, r.line);

  const sortedNums = (values: Iterable<number>): number[] => [...new Set(values)].sort((a, b) => a - b);
  const loopLines = sortedNums(s.loopLines);
  const targetLines = sortedNums(targeted.keys());
  const jumpLines = sortedNums([...gotos.map((g) => g.line), ...refs.map((r) => r.line), ...repeats.map((r) => r.line)]);
  const quiet = (start: number, end: number): boolean => !anyBetween(loopLines, start, end) && !anyBetween(targetLines, start, end) && !anyBetween(jumpLines, start, end);

  const opaque = new Set<number>();
  const jumps: ChannelFlow['jumps'] = [];
  const loops: ChannelFlow['loops'] = [];

  for (const g of gotos) {
    const one = g.targets.length === 1 ? g.targets[0] : null;
    if (g.bare && g.keyword !== 'GOTOB' && one !== null && one > g.line && !anyBetween(loopLines, g.line, one) && !anyBetween(targetLines, g.line, one)) {
      jumps.push({ line: g.line, target: one });
      continue;
    }
    for (const t of g.targets) opaque.add(t);
    if (g.targets.length === 0 || g.keyword === 'GOTOB' || g.targets.some((t) => t <= g.line)) opaque.add(g.line);
  }
  for (const r of refs) {
    for (const t of r.targets) {
      opaque.add(t);
      if (t <= r.line) opaque.add(r.line);
    }
  }

  // FOR / ENDFOR, matched innermost first.
  const followedLoopLines = new Set<number>();
  const marks = [...s.fors.map((f) => ({ line: f.line, open: f })), ...s.endfors.map((e) => ({ line: e.line, close: e }))].sort((a, b) => a.line - b.line);
  const stack: FlowScan['fors'] = [];
  for (const m of marks) {
    if ('open' in m && m.open) {
      stack.push(m.open);
      continue;
    }
    const f = stack.pop();
    const e = 'close' in m ? m.close : undefined;
    if (f === undefined || e === undefined) continue;
    const count = f.to - f.from + 1;
    if (f.bare && e.bare && f.from < f.to && count <= FLOW_MAX_COUNT && quiet(f.line, e.line) && !targeted.has(f.line) && !targeted.has(e.line)) {
      loops.push({ start: f.line, end: e.line, count });
      followedLoopLines.add(f.line).add(e.line);
    }
  }
  // REPEAT LABEL P=n: the lines from the label to the REPEAT line.
  for (const r of repeats) {
    const start = r.starts.length === 1 ? r.starts[0] : null;
    const endLabels = s.names.get('ENDLABEL') ?? [];
    const others = start === null ? undefined : targeted.get(start);
    if (
      r.single &&
      r.times !== null &&
      r.times >= 1 &&
      r.times + 1 <= FLOW_MAX_COUNT &&
      start !== null &&
      start < r.line &&
      !anyBetween(endLabels, start - 1, r.line) &&
      quiet(start, r.line) &&
      others !== undefined &&
      others.size === 1 &&
      !s.loopLines.has(start) &&
      !jumpLines.includes(start) &&
      !targeted.has(r.line)
    ) {
      loops.push({ start, end: r.line, count: r.times + 1 });
      followedLoopLines.add(r.line);
      continue;
    }
    opaque.add(r.line);
    for (const t of [...r.starts, ...r.ends]) opaque.add(t);
  }
  for (const line of loopLines) if (!followedLoopLines.has(line)) opaque.add(line);

  loops.sort((a, b) => a.start - b.start);
  return { jumps, loops, opaque: [...opaque].sort((a, b) => a - b) };
}

/** The service, plus the hooks that are not part of the §7.3 contract. */
export type OutlineServiceInternals = OutlineService & {
  /** Installs the listeners; the returned disposer drops them and every index. */
  start(): Disposable;
  /**
   * The items as they are right now, debounce and all bypassed. The Monaco providers use
   * this: Monaco asks for symbols and folding ranges with its own delay already, and
   * answering with a 150 ms old tree would fold the wrong lines.
   */
  snapshot(id: DocId): OutlineItem[];
};

export function createOutlineService(deps: OutlineServiceDeps): OutlineServiceInternals {
  const entries = new Map<DocId, Entry>();
  let stops: Disposable[] = [];
  let installed = false;
  const now = deps.now ?? (() => performance.now());
  const budget = deps.budgetMs ?? BUILD_BUDGET_MS;
  const quietMs = deps.switchQuietMs ?? SWITCH_QUIET_MS;
  const maxRun = Math.max(deps.chunkLines, deps.maxChunkLines ?? deps.chunkLines);
  const aggregateRun = deps.aggregateRun ?? { lines: AGGREGATE_LINES, marks: AGGREGATE_MARKS };
  /** The scheduler of a slice that waits for idle time: the idle clock, or the next turn where the deps give none. */
  const later = (fn: () => void): Disposable => (deps.idle !== undefined ? deps.idle(fn) : deps.schedule(fn, 0));
  /** The pump that runs the slices, or null while none is waiting. */
  let pump: Disposable | null = null;
  /** No slice runs before this time (a tab switch is on its way). */
  let quietUntil = -Infinity;
  /** ms of work since the pump last took a timer turn or idle time. */
  let chained = 0;
  /** What a line costs to read, in ms (a running average; 0 = not measured yet). */
  let perLine = 0;

  function install(): void {
    if (installed) return;
    installed = true;
    stops = [
      deps.editor.onDidChangeContent((id, change) => {
        const entry = entries.get(id);
        if (!entry) return;
        if (change.flush) {
          rebuild(id, entry);
          return;
        }
        // Once every line is read an edit is a normal `applyChange`: the index is complete,
        // and the aggregation either goes on (the edit is below it) or starts again.
        if (entry.build !== null && !entry.build.aggregating) {
          const built = entry.build.next; // the first line the build has not read yet
          if (change.startLine >= built) return; // below the prefix: the build reads it
          if (change.endLineOld >= built) {
            rebuild(id, entry); // straddles the boundary
            return;
          }
          entry.build.next += change.endLineNew - change.endLineOld;
        }
        entry.index.applyChange(change.startLine, change.endLineOld, deps.editor.getLines(id, change.startLine, change.endLineNew));
        // An edit that reached what the aggregation had read ends the first build here: every
        // line is classified and the index is current, and starting the walk again would never
        // end while the typing goes on (a keystroke every few ms above the walk sends it back
        // to the first line each time). The map is published by the debounce the edit arms,
        // which is the path of every edit after the first build; the walk goes on only for an
        // edit below it.
        if (entry.build !== null && entry.build.aggregating && !entry.index.aggregating) {
          entry.build = null;
          entry.markReady();
        }
        schedulePublish(entry);
      }),
      // A switch to a document that is already open must not share the main thread with a
      // build (B1 fixperf): the slices wait until it is over. A document that is opened
      // for the first time has no index yet and loses nothing.
      (() => {
        let first = true;
        return deps.docs.activeId.subscribe((id) => {
          if (first) {
            first = false;
            return;
          }
          if (quietMs > 0 && id !== null && entries.has(id)) quietUntil = now() + quietMs;
        });
      })(),
      // A fresh Monaco model replaces the text the index was built from.
      deps.editor.onDidCreateModel((id) => {
        const entry = entries.get(id);
        if (entry) rebuild(id, entry);
      }),
      // Closed documents lose their index; a profile or machine change rebuilds it.
      deps.docs.list.subscribe((list) => {
        const open = new Set(list.map((doc) => doc.id));
        for (const [id, entry] of [...entries]) {
          if (!open.has(id)) drop(id, entry);
          else reindexIfChanged(id, entry);
        }
      }),
      ...(deps.channels === undefined
        ? []
        : [
            deps.channels.revision.subscribe(() => {
              // A publish that is already waiting reads the new channels when it runs; pushing it
              // back by another 150 ms would hold an edit's map back twice as long (M12 fix F1:
              // the channels re-resolve on the same 150 ms after an edit, just before the map).
              for (const entry of entries.values()) if (entry.build === null && entry.publish === null) schedulePublish(entry);
            }),
          ]),
      ...(deps.machineRevision === undefined
        ? []
        : [
            deps.machineRevision.subscribe(() => {
              for (const [id, entry] of [...entries]) reindexIfChanged(id, entry);
            }),
          ]),
      ...(deps.profileRevision === undefined
        ? []
        : [
            deps.profileRevision.subscribe(() => {
              for (const [id, entry] of [...entries]) reindexIfChanged(id, entry);
            }),
          ]),
    ];
  }

  /** Rebuilds when the document's effective view is not the one the index was built with. */
  function reindexIfChanged(id: DocId, entry: Entry): void {
    const view = deps.effective(id);
    if (view === null) return;
    if (view.key === entry.key && view.cp === entry.cp) return;
    // A machine switch or a reload made another key or another object. Only a profile the
    // map reads differently needs a new index (T136): a machine that changes the power-on
    // state of the modal index, or a reload that made an equal profile, leaves the marks as
    // they are, and the first build of a 300,000-line program is not paid again.
    const same = sameOutlineReading(view.cp, entry.cp);
    entry.key = view.key;
    entry.cp = view.cp;
    if (same) return;
    entry.index = new OutlineIndex(view.cp);
    rebuild(id, entry);
  }

  /** The effective compiled profile, or an empty one that classifies nothing. */
  function profileOf(id: DocId): CompiledProfile {
    return deps.effective(id)?.cp ?? EMPTY_PROFILE;
  }

  function drop(id: DocId, entry: Entry): void {
    entry.build = null;
    entry.publish?.();
    // Nothing is going to build this document any more, so a waiter must not hang.
    entry.markReady();
    entries.delete(id);
  }

  /** The items as published: the P1 tree, or grouped by channel (M12). */
  function publishNow(entry: Entry): void {
    // While the first build runs nothing is published: the tree of the part that is read
    // would be aggregated in one go (a stall that grows with the prefix, once for the
    // debounce that `rebuild` arms and once more for every keystroke typed meanwhile), and
    // the map is published whole by the slice that finishes the build. What was published
    // before stays until then.
    if (entry.build !== null) return;
    const items = entry.index.items();
    const set = deps.channels?.forDoc(entry.id);
    if (deps.channels === undefined || set === undefined || set.layout !== 'single-file' || set.members.length === 0) {
      entry.grouped = null;
      entry.store.set(items);
      return;
    }
    // Nothing changed since the last publish (a channel revision of another document, say).
    if (entry.grouped !== null && entry.grouped.items === items && entry.grouped.set === set) return;
    const channels = deps.channels;
    const rules = new Map<string, SyncRule>();
    for (const rule of channels.params?.(entry.id)?.syncMarks ?? []) if (!rules.has(rule.id)) rules.set(rule.id, rule);
    const fresh = groupByChannel(items, set, (hit) =>
      hit.mark !== '' ? shownMark(hit.mark, rules.get(hit.ruleId)) : channels.ruleLabel(entry.id, hit.ruleId) || hit.ruleId,
    );
    const rows = entry.grouped === null ? fresh : reuseRows(entry.grouped.rows, fresh);
    entry.grouped = { items, set, rows };
    entry.store.set(rows);
  }

  /** Publishes the aggregated items after the debounce. */
  function schedulePublish(entry: Entry): void {
    entry.publish?.();
    entry.publish = deps.schedule(() => {
      entry.publish = null;
      publishNow(entry);
    }, deps.delayMs);
  }

  /** Lines the next run reads: `chunkLines` until the cost of a line is known, then as many as fit in `left` ms. */
  function runLines(left: number): number {
    if (maxRun <= deps.chunkLines || perLine <= 0 || left <= 0) return deps.chunkLines;
    return Math.min(maxRun, Math.max(deps.chunkLines, Math.floor((left * RUN_SHARE) / perLine)));
  }

  /**
   * One slice of the first build of `entry`: reads runs of lines until the budget is spent (at
   * least one run, so the build moves on), then hands the main thread back. Once every line
   * is read, the marks are put into the tree in runs too (`OutlineIndex.aggregateSome`, T136),
   * the first of them in the slice that read the last line. The slice that completes the tree
   * finishes the build and publishes at once. Answers the ms it took.
   */
  function step(entry: Entry): number {
    const build = entry.build;
    if (build === null) return 0;
    const id = entry.id;
    const started = now();
    let at = started;
    for (;;) {
      let sampled = false;
      if (!build.aggregating) {
        const total = deps.editor.getLineCount(id);
        const from = build.next;
        const end = Math.min(total, from + runLines(budget - (at - started)) - 1);
        if (end >= from) {
          entry.index.applyChange(from, from - 1, deps.editor.getLines(id, from, end));
          build.next = end + 1;
        }
        if (build.next > total) build.aggregating = true;
        else {
          const after = now();
          if (end >= from && after > at) {
            const sample = (after - at) / (end - from + 1);
            perLine = perLine === 0 ? sample : (perLine + sample) / 2;
          }
          at = after;
          sampled = true;
        }
      }
      if (build.aggregating) {
        if (entry.index.aggregateSome(aggregateRun.lines, aggregateRun.marks)) {
          entry.build = null;
          entry.publish?.();
          entry.publish = null;
          publishNow(entry);
          entry.markReady();
          return at - started;
        }
        if (!sampled) at = now();
      }
      if (at - started >= budget) return at - started;
    }
  }

  /** The build to work on: the active document's, else the first one waiting. */
  function nextBuild(): Entry | null {
    const active = deps.docs.getActiveId();
    const own = active === null ? undefined : entries.get(active);
    if (own !== undefined && own.build !== null) return own;
    for (const entry of entries.values()) if (entry.build !== null) return entry;
    return null;
  }

  /** Runs one slice, then queues the next the way the situation asks for (see the header). */
  function runPump(): void {
    pump = null;
    if (quietMs > 0) {
      const left = quietUntil - now();
      if (left > 0) {
        pump = deps.schedule(runPump, Math.ceil(left));
        return;
      }
    }
    const entry = nextBuild();
    if (entry === null) {
      chained = 0;
      return;
    }
    chained += step(entry);
    if (nextBuild() === null) {
      chained = 0;
      return;
    }
    if (deps.inputPending?.() === true) {
      chained = 0;
      pump = later(runPump);
    } else if (deps.nextTurn === undefined) {
      pump = later(runPump);
    } else if (chained >= CHAIN_MS) {
      chained = 0;
      pump = deps.schedule(runPump, 0);
    } else {
      pump = deps.nextTurn(runPump);
    }
  }

  function rebuild(id: DocId, entry: Entry): void {
    // A flush (`setValue`, reload from disk, compare) or a profile change empties the
    // index and starts over, so a `whenReady` that the *previous* build resolved must not
    // keep answering: the Monaco providers await it and would then read an empty tree and
    // drop every fold arrow. A rebuild that interrupts an unfinished build keeps the
    // promise that is still pending — re-arming it there would strand its waiters.
    if (entry.build === null) arm(entry);
    entry.index.reset([]);
    // The first slice waits for idle time as well, so opening a document never
    // classifies a run of lines inside the event that created it.
    entry.build = { next: 1, aggregating: false };
    if (pump === null) {
      chained = 0;
      pump = later(runPump);
    }
    schedulePublish(entry);
  }

  /** Gives the entry a fresh, unresolved readiness promise. */
  function arm(entry: { ready: Promise<void>; markReady: () => void }): void {
    entry.ready = new Promise<void>((resolve) => {
      entry.markReady = resolve;
    });
  }

  function ensure(id: DocId): Entry {
    install();
    const found = entries.get(id);
    if (found) return found;

    const view = deps.effective(id);
    const entry: Entry = {
      key: view?.key ?? '',
      cp: view?.cp ?? profileOf(id),
      index: new OutlineIndex(view?.cp ?? profileOf(id)),
      store: writable<OutlineItem[]>([]),
      build: null,
      ready: Promise.resolve(),
      markReady: () => {},
      publish: null,
      id,
      grouped: null,
    };
    arm(entry);
    entries.set(id, entry);
    if (deps.editor.hasModel(id)) rebuild(id, entry);
    return entry;
  }

  return {
    items(id: DocId): Readable<OutlineItem[]> {
      // Asking for the store is what starts the index: the program map asks as soon as a
      // document becomes the active one, which is the "after the first render" of AD-12.
      return ensure(id).store;
    },

    snapshot(id: DocId): OutlineItem[] {
      return ensure(id).index.items();
    },

    toolLines(id: DocId, channelId?: string): number[] {
      const lines = ensure(id).index.toolLines();
      if (channelId === undefined) return lines;
      // M12: only the lines inside that channel's ranges ("next tool change in this channel").
      const ranges = (deps.channels?.forDoc(id).members ?? []).flatMap((m) =>
        m.kind === 'section' && m.channel.id === channelId ? m.ranges : [],
      );
      return lines.filter((line) => ranges.some((r) => line >= r.startLine && line <= r.endLine));
    },

    itemAt(id: DocId, line: number): OutlineItem | null {
      return ensure(id).index.itemAt(line);
    },

    whenReady(id: DocId): Promise<void> {
      const entry = ensure(id);
      // A document whose model has not been created yet has nothing to build from; the
      // `onDidCreateModel` listener starts the build and resolves this promise.
      return entry.ready;
    },

    start(): Disposable {
      install();
      return () => {
        if (!installed) return;
        installed = false;
        for (const stop of stops.reverse()) stop();
        stops = [];
        pump?.();
        pump = null;
        for (const [id, entry] of [...entries]) drop(id, entry);
      };
    },
  };
}

/**
 * The fallback for a document whose profile the registry does not know (a stale id in a
 * restored session). It classifies nothing, so the map is empty instead of wrong.
 */
const EMPTY_PROFILE: CompiledProfile = {
  profile: { syntax: { comments: [] }, toolCall: { toolFrom: 'same-line' }, outline: [] } as unknown as CompiledProfile['profile'],
  flags: 'i',
  re: {
    detectContent: [],
    detectVetoes: [],
    toolTrigger: /(?!)/,
    tool: /(?!)/,
    programStart: [],
    programEnd: [],
    outline: [],
    references: [],
  },
  keywords: [],
};

/** The turn and input helpers the pump uses live in `scheduler.ts` (the modal service chains its slices the same way); re-exported for the callers and tests that import them from here. */
export { CHAIN_MS, inputPending, nextTurn };

/** The application-wide outline service. */
export const outline: OutlineServiceInternals = createOutlineService({
  docs: appDocs,
  editor: appEditor,
  effective: (id) => {
    const doc = appDocs.get(id);
    // A reload can remove a document's profile for the moment between the registry swap and
    // `userConfig.load` detecting the document again (AD-29): nothing to index then.
    if (doc === undefined || appProfiles.get(doc.profileId) === undefined) return null;
    const view = appMachines.effective(id);
    return { cp: view.cp, key: view.machine.key };
  },
  machineRevision: appMachines.revision,
  profileRevision: appProfiles.revision,
  channels: appChannels,
  schedule: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    return () => clearTimeout(handle);
  },
  idle: runWhenIdle,
  nextTurn,
  inputPending,
  now: () => performance.now(),
  chunkLines: CHUNK_LINES,
  maxChunkLines: MAX_CHUNK_LINES,
  delayMs: AGGREGATE_DELAY_MS,
});
