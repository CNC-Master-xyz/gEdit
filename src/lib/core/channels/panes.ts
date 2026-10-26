// The channel panes' mapping (Phase 4 plan AD-51, §6.7 rules 9–14). Contract by the P4e
// prelude, implemented by P4.22a (Wave A); P4.22b (the panes in the editor) and P4.23 (merging
// a split back) use it.
//
// A program with channel sections is one document. Its channel view shows one pane per
// channel, and a pane is a Monaco model of its own holding that channel's lines: the program's
// header (the lines before the first section, as "Split into Channel Documents" copies them)
// and then every range of the channel in document order. Nothing is hidden in the document's
// own model (no `setHiddenAreas`, P2 F54), so a program over 300,000 lines works the same.
//
// Everything here is pure: line numbers in, line numbers and edits out. No Monaco, no store.
// A `ChannelSet` is what `channels.fresh(docId)` answers (AD-32); the header is its `outside`
// range that starts at line 1.
//
// The rules (binding; §6.7 has the reasons):
//  1. A projection is a list of segments, each a run of consecutive document lines shown as
//     consecutive pane lines: the header first (`kind: 'header'`, absent when the first section
//     starts at line 1), then the channel's ranges in document order. A document line may be in
//     several projections (the header; a section several channels share, `+S1/S3`).
//  2. `docLineOf` answers every pane line; `paneLineOf` is null for a document line the pane
//     does not show (another channel's, or one outside every channel after the header).
//  3. An edit in a pane maps character for character: a range inside one segment moves by the
//     segment's offset, columns unchanged. A range that crosses from segment k into segment
//     k+1 (a junction) becomes two edits: the text replaces from its start to the end of the
//     last line of segment k, and the part of segment k+1 up to its end is deleted; the lines of
//     other channels in between are never touched. The junction stays a line break, so the pane
//     that made such an edit is re-projected afterwards (rule 6). (P4.22a, as built: segments
//     that are consecutive in the document, the header and the section right below it, are no
//     junction. An edit that ends at column 1 of the first line after a junction takes the
//     junction's line break with it only when nothing of its text would then stick to a line of
//     another channel: it starts at column 1 and deletes, or its text ends with a line break.
//     Otherwise the break stays.)
//  4. An insertion at the end of a segment's last line belongs to that segment (the range above
//     the junction), an insertion at column 1 of a segment's first line to that segment. Where a
//     line ends up is then the document's own reading (the sections run to the next start).
//     P4e review NC-2 (the owner's answer of 2026-10-17): a new line typed or pasted at column 1
//     of a section start goes to the end of the range above in the same pane, so it stays in
//     the channel; and an edit that would move lines to another channel anyway (a section start
//     typed, changed or deleted in a pane) is refused: `paneEditMovesLines` tells the caller.
//  5. Mapped edits are in document coordinates of the document **before** the edit, in
//     ascending order, never overlapping: one `pushEditOperations` call takes them all.
//  6. A change of the document re-projects each pane by the fewest pane edits that make the
//     pane's text equal to the new projection (`reprojectEdits`). The pane an edit came from
//     needs none unless rule 3's junction or a moved section boundary changed what it shows.
//  7. Alignment (`alignPanes`): the owner's rule of 2026-10-17 (the same code with the same
//     `P` set meets in exactly the channels the `P` names, n-th with n-th), which generalises
//     Go to the Matching Mark (`contrib/channels.ts`, `findPartner`) from two channels to N.
//     See the function's comment.

import { asksSamePartners } from '$lib/core/channels/check';
import type { ChannelRef, ChannelSet, SyncHit, SyncRule } from '$lib/core/channels/types';

/** The most channels the channel view shows at once (AD-50, the owner, 2026-10-17). */
export const MAX_CHANNEL_PANES = 4;

/** A run of consecutive document lines shown as consecutive pane lines. 1-based. */
export interface PaneSegment {
  docStart: number;
  paneStart: number;
  length: number;
  kind: 'header' | 'section';
}

/** One channel's pane: its segments in pane order (and so in document order). */
export interface ChannelProjection {
  channelId: string;
  segments: readonly PaneSegment[];
  /** The pane's line count: the sum of the segment lengths, at least 1. */
  lineCount: number;
}

/** Monaco's `IRange`, spelled out (core imports no Monaco). 1-based, `end` exclusive in columns. */
export interface TextRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/** One edit, the shape `pushEditOperations` takes. `text` is LF. */
export interface TextEdit {
  range: TextRange;
  text: string;
}

// ---------------------------------------------------------------------------
// Projection and the line mapping
// ---------------------------------------------------------------------------

/**
 * The projection of channel `channelId` of `set` (rule 1), or null when the set has no
 * section member for it (`layout` other than `single-file`, or a channel that was not found).
 */
export function projectChannel(set: ChannelSet, channelId: string): ChannelProjection | null {
  let ranges: readonly { startLine: number; endLine: number }[] | null = null;
  for (const m of set.members) {
    if (m.kind === 'section' && m.channel.id === channelId) {
      ranges = m.ranges;
      break;
    }
  }
  if (ranges === null) return null;
  const segments: PaneSegment[] = [];
  let paneStart = 1;
  const header = set.outside.find((r) => r.startLine === 1);
  if (header && header.endLine >= 1) {
    segments.push({ docStart: 1, paneStart, length: header.endLine, kind: 'header' });
    paneStart += header.endLine;
  }
  const sorted = ranges.every((r, i) => i === 0 || ranges[i - 1].startLine <= r.startLine) ? ranges : [...ranges].sort((a, b) => a.startLine - b.startLine);
  for (const r of sorted) {
    const length = r.endLine - r.startLine + 1;
    if (length < 1) continue;
    segments.push({ docStart: r.startLine, paneStart, length, kind: 'section' });
    paneStart += length;
  }
  return { channelId, segments, lineCount: Math.max(1, paneStart - 1) };
}

/** The index of the last segment whose `key` is at most `value`, or -1. */
function lastAtMost<T>(items: readonly T[], key: (item: T) => number, value: number): number {
  let lo = 0;
  let hi = items.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (key(items[mid]) <= value) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** The document line of pane line `paneLine` (rule 2). `RangeError` outside `1…lineCount`. O(log segments). */
export function docLineOf(p: ChannelProjection, paneLine: number): number {
  const i = Number.isInteger(paneLine) && paneLine >= 1 && paneLine <= p.lineCount ? lastAtMost(p.segments, (s) => s.paneStart, paneLine) : -1;
  if (i < 0) throw new RangeError(`pane line ${paneLine} is outside 1…${p.lineCount}`);
  const s = p.segments[i];
  return s.docStart + (paneLine - s.paneStart);
}

/** The pane line of document line `docLine`, or null when the pane does not show it (rule 2). O(log segments). */
export function paneLineOf(p: ChannelProjection, docLine: number): number | null {
  const i = lastAtMost(p.segments, (s) => s.docStart, docLine);
  if (i < 0) return null;
  const s = p.segments[i];
  return docLine < s.docStart + s.length ? s.paneStart + (docLine - s.docStart) : null;
}

/** `length` pane lines from pane line `from` (1-based), read from the document by segment. */
function readPane(p: ChannelProjection, getLines: (from: number, to: number) => string[], from: number, to: number): string[] {
  if (to < from) return [];
  if (p.segments.length === 0) return [''];
  const out: string[] = [];
  let i = Math.max(0, lastAtMost(p.segments, (s) => s.paneStart, from));
  for (; i < p.segments.length && p.segments[i].paneStart <= to; i++) {
    const s = p.segments[i];
    const a = Math.max(from, s.paneStart);
    const b = Math.min(to, s.paneStart + s.length - 1);
    if (b < a) continue;
    const lines = getLines(s.docStart + (a - s.paneStart), s.docStart + (b - s.paneStart));
    for (let k = 0; k < lines.length; k++) out.push(lines[k]);
  }
  return out;
}

/** The pane's text as lines, read from the document by segment (`getLines` is 1-based inclusive). */
export function projectedLines(p: ChannelProjection, getLines: (from: number, to: number) => string[]): string[] {
  return readPane(p, getLines, 1, p.lineCount);
}

/**
 * The marks of one channel in pane lines: the hits of `marks` that belong to the pane's channel
 * and sit on a line the pane shows (`SyncHit.line` is a document line for a program with
 * sections), in line order. For `alignPanes`' `PaneMarks`.
 */
export function marksInPane(p: ChannelProjection, marks: readonly SyncHit[]): SyncHit[] {
  const out: SyncHit[] = [];
  for (const h of marks) {
    if (h.channel !== p.channelId) continue;
    const line = paneLineOf(p, h.line);
    if (line !== null) out.push({ ...h, line });
  }
  return out.sort((a, b) => a.line - b.line);
}

// ---------------------------------------------------------------------------
// A pane edit, mapped to the document
// ---------------------------------------------------------------------------

/** Segments that are consecutive in the document are one run: an edit across them is no junction. */
interface Run {
  docStart: number;
  paneStart: number;
  length: number;
}

const runCache = new WeakMap<ChannelProjection, readonly Run[]>();

function runsOf(p: ChannelProjection): readonly Run[] {
  const cached = runCache.get(p);
  if (cached) return cached;
  const runs: Run[] = [];
  for (const s of p.segments) {
    const last = runs[runs.length - 1];
    if (last && last.docStart + last.length === s.docStart) last.length += s.length;
    else runs.push({ docStart: s.docStart, paneStart: s.paneStart, length: s.length });
  }
  runCache.set(p, runs);
  return runs;
}

function runIndexOf(runs: readonly Run[], p: ChannelProjection, paneLine: number): number {
  const i = Number.isInteger(paneLine) && paneLine >= 1 && paneLine <= p.lineCount ? lastAtMost(runs, (r) => r.paneStart, paneLine) : -1;
  if (i < 0) throw new RangeError(`pane line ${paneLine} is outside 1…${p.lineCount}`);
  return i;
}

function edit(l1: number, c1: number, l2: number, c2: number, text: string): TextEdit {
  return { range: { startLineNumber: l1, startColumn: c1, endLineNumber: l2, endColumn: c2 }, text };
}

const isNothing = (e: TextEdit): boolean =>
  e.text === '' && e.range.startLineNumber === e.range.endLineNumber && e.range.startColumn === e.range.endColumn;

/**
 * The document edits of one pane content event (rules 3–5). `edits` are the event's changes in
 * pane coordinates of the pane **before** the event (Monaco's `IModelContentChange.range` and
 * `text`), `paneMaxColumn` the max column of a pane line before the event, `docLineCount` (optional)
 * the document's line count before the event.
 *
 * An edit inside one run of consecutive document lines moves by the run's offset. One that
 * crosses a junction becomes: the text from its start to the end of the last line of the run it
 * starts in; the runs it covers entirely, deleted as whole lines; and the part of the run it
 * ends in up to its end, deleted. The junction stays a line break (the pane is re-projected).
 * Where the edit ends at column 1 of the first line after a junction and nothing of its text
 * would then stick to a line of another channel (it starts at column 1 and deletes, or its text
 * ends with a line break) the line break at the junction goes with it, so deleting the last
 * lines of a range deletes them whole; otherwise the break stays.
 *
 * P4e review fixes (NC-2):
 *  - An insertion whose text ends with a line break, at column 1 of the first line of a run
 *    (a section start), is a new line typed or pasted just above that section start. It goes to
 *    the end of the last line of the run above, with the line break moved in front, so the new
 *    line stays in this channel instead of joining the channel whose lines lie in between. Not
 *    for the pane's first section run: above it is the header (every channel's), so such an
 *    insertion maps as written and `paneEditMovesLines` refuses it.
 *  - An edit across a junction that ends at the end of the last line of the run it ends in takes
 *    that whole run (its lines and their line break), so deleting the pane's lines of a whole
 *    range leaves no empty line behind in the document. Only where a document line follows the
 *    run: a run that is not the pane's last, or one that ends before `docLineCount`.
 */
export function mapPaneEdits(
  p: ChannelProjection,
  edits: readonly TextEdit[],
  paneMaxColumn: (paneLine: number) => number,
  docLineCount?: number,
): TextEdit[] {
  const runs = runsOf(p);
  const sorted =
    edits.length > 1
      ? [...edits].sort(
          (a, b) => a.range.startLineNumber - b.range.startLineNumber || a.range.startColumn - b.range.startColumn,
        )
      : edits;
  const out: TextEdit[] = [];
  const at = (r: Run, paneLine: number): number => r.docStart + (paneLine - r.paneStart);
  const wholeRun = (r: Run): TextEdit => edit(r.docStart, 1, r.docStart + r.length, 1, '');
  // The run of the pane's first section line: above it is the header, never a run of this channel.
  const firstSection = p.segments.find((sg) => sg.kind === 'section');
  const firstSectionRun = firstSection === undefined ? -1 : lastAtMost(runs, (r) => r.paneStart, firstSection.paneStart);
  let moved = false;
  for (const e of sorted) {
    const { startLineNumber: l1, startColumn: c1, endLineNumber: l2, endColumn: c2 } = e.range;
    const s = runIndexOf(runs, p, l1);
    const t = runIndexOf(runs, p, l2);
    const rs = runs[s];
    if (s === t) {
      const aboveStart = l1 === l2 && c1 === 1 && c2 === 1 && l1 === rs.paneStart && s > 0 && s !== firstSectionRun && e.text.endsWith('\n');
      if (aboveStart) {
        // NC-2: a new line just above a section start goes to the end of the run above.
        const prev = runs[s - 1];
        const prevEnd = prev.paneStart + prev.length - 1;
        const column = paneMaxColumn(prevEnd);
        out.push(edit(at(prev, prevEnd), column, at(prev, prevEnd), column, '\n' + e.text.slice(0, -1)));
        moved = true;
        continue;
      }
      out.push(edit(at(rs, l1), c1, at(rs, l2), c2, e.text));
      continue;
    }
    // A junction. The runs strictly between the start's and the end's are covered whole.
    const re = runs[t];
    const sDocEnd = rs.docStart + rs.length - 1;
    const reDocEnd = re.docStart + re.length - 1;
    const endsAtLineStart = c2 === 1 && l2 === re.paneStart;
    const safe = e.text.endsWith('\n') || (e.text === '' && c1 === 1);
    const endsAtRunEnd =
      l2 === re.paneStart + re.length - 1 &&
      c2 === paneMaxColumn(l2) &&
      (t < runs.length - 1 || (docLineCount !== undefined && reDocEnd < docLineCount));
    const breakGoes = endsAtLineStart && safe;
    if (breakGoes) {
      out.push(edit(at(rs, l1), c1, sDocEnd + 1, 1, e.text));
    } else {
      const first = edit(at(rs, l1), c1, sDocEnd, paneMaxColumn(rs.paneStart + rs.length - 1), e.text);
      if (!isNothing(first)) out.push(first);
    }
    for (let j = s + 1; j < t; j++) out.push(wholeRun(runs[j]));
    if (!breakGoes && endsAtRunEnd) {
      out.push(wholeRun(re));
    } else if (!endsAtLineStart) {
      const tail = edit(re.docStart, 1, at(re, l2), c2, '');
      if (!isNothing(tail)) out.push(tail);
    }
  }
  if (moved && out.length > 1) {
    out.sort((a, b) => a.range.startLineNumber - b.range.startLineNumber || a.range.startColumn - b.range.startColumn);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The guard: an edit in a pane never moves lines between channels (NC-2)
// ---------------------------------------------------------------------------

/** A run of document lines, 1-based inclusive. */
interface Span {
  from: number;
  to: number;
}

/** What `paneEditMovesLines` answers when the edit would move lines. */
export interface PaneEditMove {
  moves: true;
  /** The channels whose lines would change in a way the edit did not write itself (ids, in the
   *  order of `before.members`, then the ones only `after` has). Empty when only the header or
   *  the lines outside every channel would change. */
  channels: string[];
  /** The first document line (after the edit) where it shows. */
  line: number;
}

/** The lines each part of the program belongs to: the header, the other outside lines, each channel. */
function partsOf(set: ChannelSet): Map<string, Span[]> {
  const parts = new Map<string, Span[]>();
  const put = (key: string, from: number, to: number): void => {
    if (to < from) return;
    const list = parts.get(key) ?? [];
    list.push({ from, to });
    parts.set(key, list);
  };
  for (const r of set.outside) put(r.startLine === 1 ? '\u0000header' : '\u0000outside', r.startLine, r.endLine);
  for (const m of set.members) {
    if (m.kind !== 'section') continue;
    for (const r of m.ranges) put(`#${m.channel.id}`, r.startLine, r.endLine);
  }
  for (const [key, list] of parts) parts.set(key, normalize(list));
  return parts;
}

/** Sorted, disjoint, adjacent spans joined. */
function normalize(spans: readonly Span[]): Span[] {
  const sorted = [...spans].filter((s) => s.to >= s.from).sort((a, b) => a.from - b.from);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.from <= last.to + 1) last.to = Math.max(last.to, s.to);
    else out.push({ ...s });
  }
  return out;
}

function covers(spans: readonly Span[] | undefined, line: number): boolean {
  if (!spans) return false;
  const i = lastAtMost(spans, (s) => s.from, line);
  return i >= 0 && spans[i].to >= line;
}

/** `spans` without the lines of `cut` (both normalized). */
function without(spans: readonly Span[], cut: readonly Span[]): Span[] {
  const out: Span[] = [];
  let j = 0;
  for (const s of spans) {
    let from = s.from;
    while (j < cut.length && cut[j].to < from) j++;
    let k = j;
    while (k < cut.length && cut[k].from <= s.to && from <= s.to) {
      if (cut[k].from > from) out.push({ from, to: cut[k].from - 1 });
      from = Math.max(from, cut[k].to + 1);
      k++;
    }
    if (from <= s.to) out.push({ from, to: s.to });
  }
  return out;
}

/** How many lines of `spans` lie in `w`. */
function overlap(spans: readonly Span[] | undefined, w: Span): number {
  if (!spans) return 0;
  let n = 0;
  for (let i = Math.max(0, lastAtMost(spans, (s) => s.from, w.from)); i < spans.length && spans[i].from <= w.to; i++) {
    const a = Math.max(spans[i].from, w.from);
    const b = Math.min(spans[i].to, w.to);
    if (b >= a) n += b - a + 1;
  }
  return n;
}

/**
 * NC-2, the guard of a pane edit: whether the document edit `edits` (what `mapPaneEdits`
 * answered, in document coordinates **before** the edit, ascending) moves lines from one channel
 * to another. `before` is the channel set the edit was mapped with, `after` the set of the
 * document once the edit is applied (`channels.fresh` again). Pure; O(ranges + edits) per part.
 *
 * The edit moves lines when
 *  - a line it did not write (every line outside the edits' own lines) belongs, after it, to
 *    other channels than before (or leaves or joins the header or the lines outside every
 *    channel): typing in front of or deleting a section start, which hands the lines below it
 *    to the channel above; or
 *  - a line it wrote does not belong to exactly the channels of the line where the edit began
 *    (the pane's own channel, with a section it shares, or the header for an edit in the
 *    header): a new section start typed into a pane, or a new line inserted at column 1 of the
 *    pane's first section line, which would become a header line.
 * A line that only shifts up or down (lines inserted or deleted above it) keeps its channels, so
 * deleting a whole range of the pane, or lines inside a section, is fine. An edit that inserts
 * line breaks at column 1, or deletes whole lines up to column 1, leaves that line its own: it
 * is not counted as written.
 *
 * Answers `{ moves: false }` for a set that is not `single-file` before; a `before` with
 * sections and an `after` without (`layout` no longer `single-file`) moves every line.
 */
export function paneEditMovesLines(before: ChannelSet, after: ChannelSet, edits: readonly TextEdit[]): { moves: false } | PaneEditMove {
  if (before.layout !== 'single-file') return { moves: false };
  const sorted = [...edits].sort(
    (a, b) => a.range.startLineNumber - b.range.startLineNumber || a.range.startColumn - b.range.startColumn,
  );
  const old = partsOf(before);
  const now = after.layout === 'single-file' ? partsOf(after) : new Map<string, Span[]>();
  // The kept blocks (old lines that move by `shift`) and the written lines (new coordinates).
  const blocks: { from: number; to: number; shift: number }[] = [];
  const written: { span: Span; parts: Set<string> }[] = [];
  let cursor = 1;
  let delta = 0;
  for (const e of sorted) {
    const { startLineNumber: l1, startColumn: c1, endLineNumber: l2, endColumn: c2 } = e.range;
    let breaks = 0;
    for (let i = e.text.indexOf('\n'); i >= 0; i = e.text.indexOf('\n', i + 1)) breaks++;
    const lastPiece = e.text.slice(e.text.lastIndexOf('\n') + 1);
    // The old end line comes out whole (shifted) when nothing is written in front of its column 1.
    const keepsEnd = lastPiece === '' && c2 === 1 && (breaks > 0 || c1 === 1);
    const oldTo = keepsEnd ? l2 - 1 : l2;
    const newFrom = l1 + delta;
    const newTo = newFrom + breaks - (keepsEnd ? 1 : 0);
    if (l1 - 1 >= cursor) blocks.push({ from: cursor, to: l1 - 1, shift: delta });
    cursor = Math.max(cursor, oldTo + 1, l1);
    if (newTo >= newFrom) {
      const parts = new Set<string>();
      for (const [key, spans] of old) if (covers(spans, l1)) parts.add(key);
      written.push({ span: { from: newFrom, to: newTo }, parts });
    }
    delta += breaks - (l2 - l1);
  }
  blocks.push({ from: cursor, to: Number.MAX_SAFE_INTEGER, shift: delta });
  const writtenSpans = normalize(written.map((w) => w.span));

  const keys = new Set([...old.keys(), ...now.keys()]);
  const order = [
    ...before.members.map((m) => `#${m.channel.id}`),
    ...(after.layout === 'single-file' ? after.members.map((m) => `#${m.channel.id}`) : []),
  ];
  const moved = new Set<string>();
  let firstLine = Infinity;
  for (const key of keys) {
    // Rule A: the lines it did not write keep their channels.
    const expected: Span[] = [];
    const spans = old.get(key) ?? [];
    let b = 0;
    for (const s of spans) {
      while (b < blocks.length && blocks[b].to < s.from) b++;
      for (let k = b; k < blocks.length && blocks[k].from <= s.to; k++) {
        const from = Math.max(s.from, blocks[k].from);
        const to = Math.min(s.to, blocks[k].to);
        if (to >= from) expected.push({ from: from + blocks[k].shift, to: to + blocks[k].shift });
      }
    }
    const want = normalize(expected);
    const got = without(now.get(key) ?? [], writtenSpans);
    let differs = want.length !== got.length;
    for (let i = 0; !differs && i < want.length; i++) differs = want[i].from !== got[i].from || want[i].to !== got[i].to;
    if (differs) {
      moved.add(key);
      let i = 0;
      while (i < want.length && i < got.length && want[i].from === got[i].from && want[i].to === got[i].to) i++;
      const line = Math.min(want[i]?.from ?? Infinity, got[i]?.from ?? Infinity);
      firstLine = Math.min(firstLine, line);
    }
    // Rule B: the lines it wrote belong to the channels of the line it began on.
    for (const w of written) {
      const inside = overlap(now.get(key), w.span);
      const size = w.span.to - w.span.from + 1;
      if (w.parts.has(key) ? inside !== size : inside !== 0) {
        moved.add(key);
        firstLine = Math.min(firstLine, w.span.from);
      }
    }
  }
  if (moved.size === 0) return { moves: false };
  const channels = [...new Set(order.filter((k) => moved.has(k)).map((k) => k.slice(1)))];
  return { moves: true, channels, line: Number.isFinite(firstLine) ? firstLine : 1 };
}

// ---------------------------------------------------------------------------
// Re-projection
// ---------------------------------------------------------------------------

/**
 * Where a change of the document is, when the caller knows (§6.7 rule 10: the content event):
 * the old document lines `from…oldTo` were replaced by the new lines `from…newTo`, either range
 * possibly empty (`oldTo = from - 1`), and no other line changed. `changeHull` makes it from
 * the changes of one event. It saves `reprojectEdits` the scan of the unchanged lines, which on
 * a 300,000-line program is the cost of a keystroke; a wrong hint gives a wrong pane.
 */
export interface DocChangeHint {
  from: number;
  oldTo: number;
  newTo: number;
}

/**
 * The hint of one content event: `changes` in document coordinates of the document **before**
 * the event (Monaco's `IModelContentChange.range` and `text`).
 */
export function changeHull(changes: readonly TextEdit[]): DocChangeHint {
  let from = Infinity;
  let oldTo = -Infinity;
  let delta = 0;
  for (const c of changes) {
    from = Math.min(from, c.range.startLineNumber);
    oldTo = Math.max(oldTo, c.range.endLineNumber);
    let breaks = 0;
    for (let i = c.text.indexOf('\n'); i >= 0; i = c.text.indexOf('\n', i + 1)) breaks++;
    delta += breaks - (c.range.endLineNumber - c.range.startLineNumber);
  }
  if (changes.length === 0) return { from: 1, oldTo: 0, newTo: 0 };
  return { from, oldTo, newTo: oldTo + delta };
}

/** How many lines of the pane lie in document lines `< docLine`. */
function paneLinesBefore(p: ChannelProjection, docLine: number): number {
  const i = lastAtMost(p.segments, (s) => s.docStart, docLine - 1);
  if (i < 0) return 0;
  const s = p.segments[i];
  return s.paneStart - 1 + Math.min(s.length, docLine - s.docStart);
}

/** The segments of `p` cut to the document lines `> after`, as [docStart − after, length] pairs. */
function tailShape(p: ChannelProjection, after: number): number[] {
  const out: number[] = [];
  for (let i = p.segments.length - 1; i >= 0; i--) {
    const s = p.segments[i];
    const end = s.docStart + s.length - 1;
    if (end <= after) break;
    const start = Math.max(s.docStart, after + 1);
    out.push(start - after, end - start + 1);
  }
  return out;
}

const SCAN_CHUNK = 4096;
/** Past this many lines on a side the changed middle is replaced as a whole, not diffed. */
const DIFF_MAX_LINES = 20_000;
/** Past this many edits the diff gives up and the middle is replaced as a whole. */
const DIFF_MAX_EDITS = 96;

interface Hunk {
  aFrom: number;
  aTo: number;
  bFrom: number;
  bTo: number;
}

/** Myers' O(ND) line diff, capped at `maxD` edits; the hunks of changed lines, or null past the cap. */
function diffLines(a: readonly string[], b: readonly string[], maxD: number): Hunk[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, maxD);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) x = v[off + k + 1];
      else x = v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return null;
  const aDel = new Uint8Array(n);
  const bIns = new Uint8Array(m);
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const vd = trace[d];
    const k = x - y;
    const down = k === -d || (k !== d && vd[off + k - 1] < vd[off + k + 1]);
    const prevK = down ? k + 1 : k - 1;
    const prevX = vd[off + prevK];
    const prevY = prevX - prevK;
    if (down) bIns[prevY] = 1;
    else aDel[prevX] = 1;
    x = prevX;
    y = prevY;
  }
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && !aDel[i] && j < m && !bIns[j]) {
      i++;
      j++;
      continue;
    }
    const aFrom = i;
    const bFrom = j;
    while (i < n && aDel[i]) i++;
    while (j < m && bIns[j]) j++;
    hunks.push({ aFrom, aTo: i, bFrom, bTo: j });
  }
  return hunks;
}

/**
 * The pane edits that turn the pane of `before` into the pane of `after` (rule 6), in pane
 * coordinates of the old pane, ascending, never overlapping. `oldPaneLines` reads the pane as it
 * is, `docLines` the document as it is now. Lines whose content and place did not change are not
 * touched, so the pane's cursor, its bookmarks and its scroll position stay where they are.
 * `changed` (optional) is the document's change, see `DocChangeHint`.
 */
export function reprojectEdits(
  before: ChannelProjection,
  after: ChannelProjection,
  o: {
    oldPaneLines: (from: number, to: number) => string[];
    docLines: (from: number, to: number) => string[];
    changed?: DocChangeHint;
  },
): TextEdit[] {
  const oldCount = before.lineCount;
  const newCount = after.lineCount;
  const readOld = (from: number, to: number): string[] => (to < from ? [] : o.oldPaneLines(from, to));
  const readNew = (from: number, to: number): string[] => readPane(after, o.docLines, from, to);
  const limit = Math.min(oldCount, newCount);

  // The unchanged lines above.
  let prefix = 0;
  const h = o.changed;
  if (h) {
    prefix = Math.min(limit, paneLinesBefore(before, h.from), paneLinesBefore(after, h.from));
  } else {
    while (prefix < limit) {
      const n = Math.min(SCAN_CHUNK, limit - prefix);
      const a = readOld(prefix + 1, prefix + n);
      const b = readNew(prefix + 1, prefix + n);
      let k = 0;
      while (k < n && a[k] === b[k]) k++;
      prefix += k;
      if (k < n) break;
    }
  }

  // The unchanged lines below.
  let suffix = 0;
  const room = limit - prefix;
  let known = false;
  if (h) {
    // The same shape below the change (relative to its last line) means the same lines.
    const tb = tailShape(before, h.oldTo);
    const ta = tailShape(after, h.newTo);
    if (tb.length === ta.length && tb.every((value, i) => value === ta[i])) {
      known = true;
      for (let i = 1; i < tb.length; i += 2) suffix += tb[i];
      suffix = Math.min(suffix, room);
    }
  }
  if (!known) {
    while (suffix < room) {
      const n = Math.min(SCAN_CHUNK, room - suffix);
      const a = readOld(oldCount - suffix - n + 1, oldCount - suffix);
      const b = readNew(newCount - suffix - n + 1, newCount - suffix);
      let k = 0;
      while (k < n && a[n - 1 - k] === b[n - 1 - k]) k++;
      suffix += k;
      if (k < n) break;
    }
  }

  const oldFrom = prefix + 1;
  const oldTo = oldCount - suffix;
  const oldMid = readOld(oldFrom, oldTo);
  const newMid = readNew(prefix + 1, newCount - suffix);
  if (oldMid.length === 0 && newMid.length === 0) return [];

  let hunks: Hunk[] | null = null;
  if (oldMid.length > 0 && newMid.length > 0 && oldMid.length <= DIFF_MAX_LINES && newMid.length <= DIFF_MAX_LINES) {
    hunks = diffLines(oldMid, newMid, DIFF_MAX_EDITS);
  }
  hunks ??= [{ aFrom: 0, aTo: oldMid.length, bFrom: 0, bTo: newMid.length }];

  const textOfOld = (line: number): string => (line >= oldFrom && line <= oldTo ? oldMid[line - oldFrom] : readOld(line, line)[0]);
  const maxColumn = (line: number): number => textOfOld(line).length + 1;
  const edits: TextEdit[] = [];
  for (const hk of hunks) {
    const lo = oldFrom + hk.aFrom; // the first old line of the hunk (for an insertion: the line it goes before)
    const hi = oldFrom + hk.aTo - 1; // the last old line of the hunk
    const inserted = newMid.slice(hk.bFrom, hk.bTo);
    if (hk.aTo === hk.aFrom) {
      if (lo <= oldCount) edits.push(edit(lo, 1, lo, 1, inserted.join('\n') + '\n'));
      else edits.push(edit(oldCount, maxColumn(oldCount), oldCount, maxColumn(oldCount), '\n' + inserted.join('\n')));
    } else if (inserted.length === 0) {
      if (hi < oldCount) edits.push(edit(lo, 1, hi + 1, 1, ''));
      else if (lo > 1) edits.push(edit(lo - 1, maxColumn(lo - 1), hi, maxColumn(hi), ''));
      else edits.push(edit(1, 1, hi, maxColumn(hi), ''));
    } else {
      edits.push(edit(lo, 1, hi, maxColumn(hi), inserted.join('\n')));
    }
  }
  return edits;
}

// ---------------------------------------------------------------------------
// Alignment at the wait codes
// ---------------------------------------------------------------------------

/**
 * How a wait-code line of a pane is marked (§6.7 rule 13):
 *  - `matched`: lined up with the same occurrence in every other pane its `P` names;
 *  - `unmatched`: a blocking wait one of whose named channels is shown and has no n-th
 *    occurrence of the same code with the same `P` (a different `P` is a different wait), one
 *    that names a channel the machine does not have, or whose occurrence could not be lined up
 *    (it crosses others, or its line was already lined up with another wait);
 *  - `none`: a mark that needs no partner in view: not blocking, an `ordered` number present in
 *    one channel only (legal), a wait whose other named channels are none of the panes, a
 *    Siemens wait answered by a `SETM`, or a count difference inside a loop (not judged).
 */
export type MarkState = 'matched' | 'unmatched' | 'none';

/**
 * Why a blocking wait is `unmatched`, or `none` for a reason worth saying (the hover). Channel
 * ids, as the marks carry them.
 *  - `alone`: it names no channel but its own;
 *  - `missing`: these shown channels have no wait to meet it;
 *  - `unknown`: it names these channels, which the machine does not declare (it never completes);
 *  - `crossing`: it meets the others in another order than the one the panes are lined up in;
 *  - `elsewhere`: its line was already lined up with another wait of the line (two waits in one
 *    block whose partners are on different lines);
 *  - `loop` (state `none`): the channels have it a different number of times, but one of them
 *    is inside a loop or a jump, so the count is not judged (as Check Wait Codes, NC-04);
 *  - `answered` (state `none`): a mark that answers it (Siemens `SETM`) is in these channels.
 */
export type MarkReason =
  | { kind: 'alone' }
  | { kind: 'missing'; channels: string[] }
  | { kind: 'unknown'; channels: string[] }
  | { kind: 'crossing' }
  | { kind: 'elsewhere' }
  | { kind: 'loop' }
  | { kind: 'answered'; channels: string[] };

/** One pane for the alignment. `marks` are in line order with `line` in **pane** lines. */
export interface PaneMarks {
  channel: ChannelRef;
  lineCount: number;
  marks: readonly SyncHit[];
}

/** What the alignment may know besides the marks (all optional; P4e review NC-10, NC-11). */
export interface AlignOptions {
  /**
   * Per channel id, the lines the written order and count may not be carried across: jump
   * targets and backward jumps (WP12.5, `computeJumpLines`), **in the line numbers of the
   * pane's marks** (pane lines for sections of one program: map them with `paneLineOf` and leave
   * out the ones the pane does not show). A wait with a jump line at or before it and one at or
   * after it is inside a loop: a count difference of its code is not judged (`none`, `loop`).
   */
  jumpLines?: Readonly<Record<string, readonly number[]>>;
  /** The machine's declared channel ids (`ChannelParams.list[].id`). A wait that names an id not
   *  in it is `unmatched` (`unknown`). Absent: such a wait is judged like any other. */
  declared?: readonly string[];
  /**
   * The alignment the same panes had before an edit (the one `alignPanes` returned last). An edit that only moves the
   * lines of the waits (a line break typed in an ordinary line of a pane) leaves who meets whom and in which order as it
   * was: then the answer is that alignment with the rows worked out again (`fillRows`) and not the whole of it again
   * (v1.2.0 channel-enter: at 20,000 waits that is the cost of a line break). Used only when it is certain to give the
   * answer a full alignment would (`reusablePlan`); otherwise it is ignored.
   */
  previous?: Alignment;
}

/** `M0901` and `M901` are one code; anything else is compared as written (as `sameMarkId` of the channel store). */
function codeByValue(code: string): string {
  const m = /^([A-Za-z]*-?)0*(\d+)$/.exec(code); // `P-010` is `P-10` (the Okuma negative P, D2-1)
  return m === null ? code : m[1].toUpperCase() + m[2];
}

/** The value of an id that is all digits, or -1. */
function digitsValue(id: string): number {
  if (id.length === 0 || id.length > 15) return -1;
  let n = 0;
  for (let i = 0; i < id.length; i++) {
    const d = id.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return -1;
    n = n * 10 + d;
  }
  return n;
}

/** Digits by value first, then the rest as written. */
function compareIds(a: string, b: string): number {
  if (a === b) return 0;
  const x = digitsValue(a);
  const y = digitsValue(b);
  if (x >= 0 && y >= 0) return x - y || (a < b ? -1 : 1);
  if (x >= 0 || y >= 0) return x >= 0 ? -1 : 1;
  return a < b ? -1 : 1;
}

/** The channels taking part in a wait: its partners and its own channel, sorted, without repeats. */
function takingPart(hit: SyncHit): string[] {
  const ids = hit.partners.includes(hit.channel) ? [...hit.partners] : [...hit.partners, hit.channel];
  if (ids.length < 2) return ids;
  ids.sort(compareIds);
  return ids.filter((id, i) => i === 0 || id !== ids[i - 1]);
}

/**
 * Whether the waits of `rule` pair channel by channel (P4e review NC-4, the owner's answer of
 * 2026-10-17): a rule whose partners are a **list** on the line (`partners.kind: 'line'`, the
 * Siemens `WAITM(1,1,2)`, whose lists may differ per channel) and that does not ask for the same
 * partners (`samePartners`). Its n-th wait of an id in channel A that names B meets the n-th of
 * B that names A, as Check Wait Codes pairs them; a `SETM` of the id answers it. Every other
 * rule, above all a `P`-word rule (`partners.kind: 'word'`, built-in or built on the machine
 * page), keeps the owner's same-`P` key (`waitKey`).
 */
export function pairsByList(rule: SyncRule | undefined): boolean {
  return rule !== undefined && rule.partners.kind === 'line' && rule.samePartners !== true && (rule.semantics ?? 'rendezvous') === 'rendezvous';
}

/** The id of a mark as the pairing compares it: the code by value (`M0901` is `M901`). */
export function markIdOf(hit: SyncHit): string {
  return codeByValue(hit.mark);
}

/** Whether a mark of `rule` answers a wait for its id in another channel (a non-blocking Siemens `SETM`). */
export function answersWait(hit: SyncHit, rule: SyncRule | undefined): boolean {
  return !hit.blocking && rule?.answers === true && (rule.semantics ?? 'rendezvous') === 'rendezvous';
}

/**
 * The key of a wait (the owner's rule, 2026-10-17): the rule, the code by value
 * (`sameMarkId`: `M0901` is `M901`; `''` for a `count` rule) and the set of channels taking
 * part, which is the mark's resolved partners (`SyncHit.partners`: the `P` word read as path
 * digits or bits by the machine's rule) **with its own channel added**, ids sorted (digits by
 * value). Manual check D2-2 (2026-10-25): for a rule that asks for the same partners (below) the
 * set is the one written, the own channel NOT added, as Check Wait Codes compares it; a set
 * without the own channel keys apart (it meets nothing, as the check reports it). So `M901 P12` in path 1 and `M901 P12` in path 2 have one key, `M901 P123` another,
 * and a Siemens `WAITM(1,2)` in channel 1 the same key as `WAITM(1,1)` in channel 2. A piece the
 * machine does not declare stays in the set as written, so such a wait never completes.
 *
 * `rule` (optional) is the mark's own rule. For a rule that asks for the same partners
 * (`asksSamePartners`: `samePartners: true`, or a rule whose partners are a `P` word and that
 * does not say `samePartners: false` — the Fanuc wait M-code) the key also says whether the wait
 * was written without its `P` word (`SyncHit.absent`), so a `P`-less `M901` never meets an
 * `M901 P3` (alarm 0160, P4e review NC-3). Check Wait Codes reads the same answer (v1.2.0, T044),
 * so the view and the check never disagree. Without `rule` the key is the one above. The waits
 * of a rule that `pairsByList` are paired by `alignPanes` and `findPartner` channel by channel,
 * not by this key.
 */
export function waitKey(hit: SyncHit, rule?: SyncRule): string {
  if (!asksSamePartners(rule)) return `${hit.ruleId}\u0001${codeByValue(hit.mark)}\u0001${takingPart(hit).join(',')}`;
  const absent = hit.absent === true ? '\u0001-' : '\u0001+';
  // Manual check D2-2: the set as written. A set that leaves out the own channel (`M901 P2` in
  // path 1, which Check Wait Codes reports) keys apart, with its channel, so it meets nothing.
  const own = hit.absent === true || hit.partners.includes(hit.channel) ? '' : `\u0001!${hit.channel}`;
  return `${hit.ruleId}\u0001${codeByValue(hit.mark)}\u0001${writtenSet(hit).join(',')}${own}${absent}`;
}

/** The channels a wait's partner word names, as written (the own channel not added), sorted, without repeats. */
function writtenSet(hit: SyncHit): string[] {
  const ids = [...hit.partners];
  ids.sort(compareIds);
  return ids.filter((id, i) => i === 0 || id !== ids[i - 1]);
}

/** One lined-up wait: one mark per pane it involves (at least two), `pane` ascending. */
export interface AlignedGroup {
  marks: readonly { pane: number; line: number }[];
}

/** Filler space: a view zone of `lines` line heights after pane line `afterLine` (0 = above the first line). */
export interface FillerZone {
  pane: number;
  afterLine: number;
  lines: number;
}

export interface Alignment {
  /** In the order they are shown, top to bottom. */
  groups: AlignedGroup[];
  /** `states[pane][i]` is the state of `panes[pane].marks[i]`. */
  states: MarkState[][];
  /** `reasons[pane][i]`: why `panes[pane].marks[i]` is `unmatched` (always set then), or why a
   *  blocking wait is `none` when there is something to say (`loop`, `answered`); else null. */
  reasons: (MarkReason | null)[][];
  /** At most one zone per pane and line, `afterLine` ascending per pane; the trailing zones
   *  that make every pane equally tall are included (`afterLine` = the pane's line count). */
  zones: FillerZone[];
}

interface Occurrence {
  members: { pane: number; index: number }[];
  /** Per pane, the index of its mark there, or -1. */
  at: Int32Array;
}

/** Indexes of one longest strictly increasing subsequence of `values` (deterministic, as `check.ts`). */
function lisIndexes(values: readonly number[]): Set<number> {
  const tails: number[] = [];
  const prev = new Int32Array(values.length).fill(-1);
  for (let i = 0; i < values.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (values[tails[mid]] < values[i]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const kept = new Set<number>();
  for (let i = tails.length > 0 ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) kept.add(i);
  return kept;
}

/** Past this many occurrences dropped for crossing (three or four panes), or this many
 *  occurrences looked at while counting crossings, the walk decides the rest. */
const MAX_CROSSING_DROPS = 256;
const MAX_CROSSING_WORK = 50_000;

/**
 * Lines the panes up at their wait codes (rule 7; §6.7 "Alignment").
 *
 * **Occurrences** — the owner's rule (2026-10-17): a wait code carries a `P` word that lists the
 * channels taking part (`P12` = channels 1 and 2, `P123` = 1, 2 and 3); they meet there, and a
 * channel the `P` does not name does not stop. So the n-th blocking mark of one key (`waitKey`,
 * with the mark's rule: a `P`-less Fanuc wait is another key than one with `P`) in a channel the
 * key names meets the n-th mark of that key in **each** other channel it names: one occurrence,
 * lined up across every pane it names. A pane whose channel the key does not name gets nothing
 * for it. This generalises the pairing of Go to the Matching Mark (`findPartner`) from two
 * channels to N, and adds the owner's "same `P`": a `P12` wait no longer meets a `P123` wait.
 *
 * **Lists** (P4e review NC-4) — a rule that `pairsByList` (the Siemens `WAITM`, whose lists may
 * differ per channel: `WAITM(1,1,2,3)` in channel 1, `WAITM(1,1,2)` in channel 2) pairs as Check
 * Wait Codes does: per pair of shown channels A and B, the n-th wait of an id in A that names B
 * meets the n-th wait of that id in B that names A, unless a mark that answers it (`SETM`) of
 * that id is in A or B; then the waits of that id need no partner between A and B. The pairs
 * make the occurrences (a wait joins the occurrence of each wait it pairs with, never two marks
 * of one pane in one occurrence). A wait is complete when each shown channel it names paired
 * with it or answered it; an occurrence of complete waits is lined up; a complete wait that is
 * alone in its occurrence (answered by a `SETM`) or with an incomplete one is `none`.
 *
 * **Complete or unmatched** — an occurrence is lined up when every named channel that is shown
 * has its n-th mark of the key and at least two are shown; otherwise every shown mark of it is
 * `unmatched` (a named channel that is shown lacks it: at the machine the others would wait for
 * ever). Except (NC-10): when every shown named channel has the key at least once and one of
 * those marks is inside a loop (`o.jumpLines`), the count is not judged: `none`, `loop`. A named
 * channel that is **not** shown (more than four channels, or a channel file that is not open) is
 * not judged; the view's bar names the channels not shown. A wait that names a channel the
 * machine does not declare (`o.declared`) is `unmatched`, `unknown` (NC-11). `ordered` marks
 * (Okuma `P` numbers) line up where the same number is in the named channels and are `none`
 * where it is in one only; non-blocking marks are `none`. A blocking wait that names no channel
 * but its own (a `P`-less wait of a machine whose rule says "no partner") is `unmatched`: the
 * control stops on it (WP12.2).
 *
 * **Order** (P4e review NC-5, amending the prelude's tie-break) — the occurrences are lined up
 * in an order every pane agrees with. With two panes, the longest run of occurrences in the same
 * order in both is kept (the longest increasing subsequence, as Check Wait Codes judges the
 * order) and the others are `unmatched`, `crossing`: one misplaced wait costs only itself. With
 * three or four, the occurrence that crosses the most others (counted per pair of panes) is
 * dropped first, ties by its lowest pane, then its line there, until none crosses another; then,
 * walking the occurrences, one is taken when it is the next in every pane it involves, and when
 * none is (a cycle over three panes), the next one of the lowest pane is dropped. The same input
 * always gives the same answer.
 *
 * **Filler** — walking the occurrences in order, each pane's mark of one is pushed down to the
 * lowest of them by a zone right above it; then every pane gets a trailing zone up to the
 * tallest, so the panes scroll together to their ends (§6.7 rule 12). Panes that share no
 * occurrence are not lined up with each other except at the end. A line holds one row: an
 * occurrence whose mark sits on a line an earlier one already lined up, at another row, is
 * `unmatched`, `elsewhere` (NC-12).
 */
export function alignPanes(panes: readonly PaneMarks[], rules: readonly SyncRule[], o: AlignOptions = {}): Alignment {
  const reused = o.previous === undefined ? null : realign(o.previous, panes, rules, o);
  if (reused !== null) return reused;
  const ruleOf = new Map<string, SyncRule>();
  for (const r of rules) if (!ruleOf.has(r.id)) ruleOf.set(r.id, r);
  const semanticsOf = (id: string): string => ruleOf.get(id)?.semantics ?? 'rendezvous';
  const paneOfChannel = new Map<string, number>();
  panes.forEach((p, i) => {
    if (!paneOfChannel.has(p.channel.id)) paneOfChannel.set(p.channel.id, i);
  });
  const states: MarkState[][] = panes.map((p) => p.marks.map(() => 'none' as MarkState));
  const reasons: (MarkReason | null)[][] = panes.map((p) => p.marks.map(() => null));
  const unmatched = (pane: number, index: number, reason: MarkReason): void => {
    states[pane][index] = 'unmatched';
    reasons[pane][index] = reason;
  };
  const declared = o.declared === undefined ? null : new Set(o.declared);
  const unknownOf = (named: readonly string[]): string[] => (declared === null ? [] : named.filter((id) => !declared.has(id)));
  const jumps = new Map<string, number[]>();
  for (const [channel, lines] of Object.entries(o.jumpLines ?? {})) {
    jumps.set(channel, [...new Set(lines.filter((n) => Number.isFinite(n)))].sort((a, b) => a - b));
  }
  /** As Check Wait Codes: a jump line at or before the mark and one at or after it. */
  const looped = (pane: number, line: number): boolean => {
    const lines = jumps.get(panes[pane].channel.id);
    return lines !== undefined && lines.length > 1 && lines[0] !== lines[lines.length - 1] && lines[0] <= line && lines[lines.length - 1] >= line;
  };
  const newOccurrence = (members: { pane: number; index: number }[]): Occurrence => {
    const at = new Int32Array(panes.length).fill(-1);
    for (const m of members) at[m.pane] = m.index;
    return { members: [...members].sort((a, b) => a.pane - b.pane), at };
  };
  const candidates: Occurrence[] = [];

  // 1. The same-P key: the n-th mark of each key, per pane, is one occurrence.
  const keyed = new Map<string, { key: string; named: string[]; ordered: boolean; members: { pane: number; index: number }[] }>();
  /** Per key, per pane, the indexes of its marks. */
  const ofKey = new Map<string, Map<number, number[]>>();
  panes.forEach((p, i) => {
    p.marks.forEach((hit, j) => {
      if (!hit.blocking) return;
      const rule = ruleOf.get(hit.ruleId);
      if (pairsByList(rule)) return;
      const key = waitKey(hit, rule);
      let perPane = ofKey.get(key);
      if (!perPane) ofKey.set(key, (perPane = new Map()));
      let list = perPane.get(i);
      if (!list) perPane.set(i, (list = []));
      const id = `${key}\u0002${list.length}`;
      list.push(j);
      let occ = keyed.get(id);
      if (!occ) {
        occ = { key, named: takingPart(hit), ordered: semanticsOf(hit.ruleId) === 'ordered', members: [] };
        keyed.set(id, occ);
      }
      occ.members.push({ pane: i, index: j });
    });
  });
  for (const occ of keyed.values()) {
    const unknown = unknownOf(occ.named);
    if (unknown.length > 0) {
      for (const m of occ.members) unmatched(m.pane, m.index, { kind: 'unknown', channels: unknown });
      continue;
    }
    if (occ.ordered) {
      if (occ.members.length >= 2) candidates.push(newOccurrence(occ.members));
      continue;
    }
    if (occ.named.length < 2) {
      for (const m of occ.members) unmatched(m.pane, m.index, { kind: 'alone' });
      continue;
    }
    const shownNamed = occ.named.filter((id) => paneOfChannel.has(id));
    if (shownNamed.length < 2) continue;
    if (occ.members.length === shownNamed.length) {
      candidates.push(newOccurrence(occ.members));
      continue;
    }
    const perPane = ofKey.get(occ.key)!;
    const lacking = shownNamed.filter((id) => !occ.members.some((m) => m.pane === paneOfChannel.get(id)));
    const everyHasIt = shownNamed.every((id) => (perPane.get(paneOfChannel.get(id)!)?.length ?? 0) > 0);
    const inLoop =
      everyHasIt &&
      shownNamed.some((id) => {
        const pane = paneOfChannel.get(id)!;
        return perPane.get(pane)!.some((index) => looped(pane, panes[pane].marks[index].line));
      });
    for (const m of occ.members) {
      if (inLoop) reasons[m.pane][m.index] = { kind: 'loop' };
      else unmatched(m.pane, m.index, { kind: 'missing', channels: lacking });
    }
  }

  // 2. Lists: pairs channel by channel (NC-4).
  interface ListMark {
    pane: number;
    index: number;
    hit: SyncHit;
    /** Per shown pane it names: 'open' until paired, answered or excused by a loop. */
    needs: Map<number, 'open' | 'paired' | 'answered' | 'loop'>;
    parent: ListMark;
    panesOf: Set<number>;
  }
  const answeredIn = panes.map((p) => {
    const ids = new Set<string>();
    for (const h of p.marks) if (answersWait(h, ruleOf.get(h.ruleId))) ids.add(codeByValue(h.mark));
    return ids;
  });
  const listMarks: ListMark[] = [];
  /** Per pane, `ruleId + id` → its list waits in line order. */
  const listsOf = panes.map(() => new Map<string, ListMark[]>());
  panes.forEach((p, i) => {
    p.marks.forEach((hit, j) => {
      if (!hit.blocking || !pairsByList(ruleOf.get(hit.ruleId))) return;
      const needs = new Map<number, 'open' | 'paired' | 'answered' | 'loop'>();
      for (const partner of hit.partners) {
        const pane = paneOfChannel.get(partner);
        if (partner !== hit.channel && pane !== undefined && pane !== i) needs.set(pane, 'open');
      }
      const lm = { pane: i, index: j, hit, needs, panesOf: new Set([i]) } as ListMark;
      lm.parent = lm;
      listMarks.push(lm);
      const key = `${hit.ruleId}\u0001${codeByValue(hit.mark)}`;
      const list = listsOf[i].get(key) ?? [];
      list.push(lm);
      listsOf[i].set(key, list);
    });
  });
  const root = (x: ListMark): ListMark => {
    while (x.parent !== x) {
      x.parent = x.parent.parent;
      x = x.parent;
    }
    return x;
  };
  const join = (x: ListMark, y: ListMark): void => {
    const rx = root(x);
    const ry = root(y);
    if (rx === ry) return;
    for (const pane of ry.panesOf) if (rx.panesOf.has(pane)) return; // never two marks of one pane
    ry.parent = rx;
    for (const pane of ry.panesOf) rx.panesOf.add(pane);
  };
  if (listMarks.length > 0) {
    for (let a = 0; a < panes.length; a++) {
      for (let b = a + 1; b < panes.length; b++) {
        const keys = new Set([...listsOf[a].keys(), ...listsOf[b].keys()]);
        for (const key of keys) {
          const la = (listsOf[a].get(key) ?? []).filter((m) => m.needs.has(b));
          const lb = (listsOf[b].get(key) ?? []).filter((m) => m.needs.has(a));
          if (la.length === 0 && lb.length === 0) continue;
          const id = key.slice(key.indexOf('\u0001') + 1);
          if (answeredIn[a].has(id) || answeredIn[b].has(id)) {
            for (const m of la) m.needs.set(b, 'answered');
            for (const m of lb) m.needs.set(a, 'answered');
            continue;
          }
          const n = Math.min(la.length, lb.length);
          for (let k = 0; k < n; k++) {
            la[k].needs.set(b, 'paired');
            lb[k].needs.set(a, 'paired');
            join(la[k], lb[k]);
          }
          if (n > 0 && la.length !== lb.length && [...la, ...lb].some((m) => looped(m.pane, m.hit.line))) {
            for (let k = n; k < la.length; k++) la[k].needs.set(b, 'loop');
            for (let k = n; k < lb.length; k++) lb[k].needs.set(a, 'loop');
          }
        }
      }
    }
    const complete = new Set<ListMark>();
    for (const m of listMarks) {
      const unknown = unknownOf(takingPart(m.hit));
      if (unknown.length > 0) unmatched(m.pane, m.index, { kind: 'unknown', channels: unknown });
      else if (takingPart(m.hit).length < 2) unmatched(m.pane, m.index, { kind: 'alone' });
      else {
        const open = [...m.needs].filter(([, v]) => v === 'open').map(([pane]) => pane);
        if (open.length > 0) {
          unmatched(m.pane, m.index, { kind: 'missing', channels: open.sort((x, y) => x - y).map((pane) => panes[pane].channel.id) });
        } else complete.add(m);
      }
    }
    const components = new Map<ListMark, ListMark[]>();
    for (const m of listMarks) {
      const r = root(m);
      const list = components.get(r) ?? [];
      list.push(m);
      components.set(r, list);
    }
    for (const members of components.values()) {
      if (members.length >= 2 && members.every((m) => complete.has(m))) {
        candidates.push(newOccurrence(members.map((m) => ({ pane: m.pane, index: m.index }))));
        continue;
      }
      for (const m of members) {
        if (!complete.has(m)) continue;
        const answered = [...m.needs].filter(([, v]) => v === 'answered').map(([pane]) => pane).sort((x, y) => x - y);
        if (answered.length > 0) reasons[m.pane][m.index] = { kind: 'answered', channels: answered.map((pane) => panes[pane].channel.id) };
        else if ([...m.needs.values()].includes('loop')) reasons[m.pane][m.index] = { kind: 'loop' };
      }
    }
  }

  // 3. The order every pane agrees with.
  const alive = new Set<Occurrence>(candidates);
  const drop = (occ: Occurrence): void => {
    alive.delete(occ);
    for (const m of occ.members) unmatched(m.pane, m.index, { kind: 'crossing' });
  };
  if (panes.length === 2) {
    // The longest run in the same order in both panes (NC-5, as Check Wait Codes judges it).
    const both = candidates.filter((c) => c.at[0] >= 0 && c.at[1] >= 0).sort((x, y) => x.at[0] - y.at[0]);
    const kept = lisIndexes(both.map((c) => c.at[1]));
    both.forEach((c, i) => {
      if (!kept.has(i)) drop(c);
    });
  } else if (panes.length > 2) {
    dropMostCrossing(panes, alive, drop);
  }
  const queues: Occurrence[][] = panes.map(() => []);
  for (const occ of alive) for (const m of occ.members) queues[m.pane].push(occ);
  queues.forEach((q, i) => q.sort((x, y) => x.at[i] - y.at[i]));
  const head = new Array<number>(panes.length).fill(0);
  const headOf = (i: number): Occurrence | null => {
    const q = queues[i];
    while (head[i] < q.length && !alive.has(q[head[i]])) head[i]++;
    return head[i] < q.length ? q[head[i]] : null;
  };
  const inOrder: Occurrence[] = [];
  for (;;) {
    let first: Occurrence | null = null;
    let taken: Occurrence | null = null;
    for (let i = 0; i < panes.length && taken === null; i++) {
      const c = headOf(i);
      if (c === null) continue;
      first ??= c;
      if (c.members.every((m) => headOf(m.pane) === c)) taken = c;
    }
    if (first === null) break;
    if (taken === null) {
      // A cycle the crossing count did not break: the lowest pane's next one is dropped.
      drop(first);
      continue;
    }
    alive.delete(taken);
    inOrder.push(taken);
  }

  const aligned = fillRows(panes, states, reasons, inOrder);
  plans.set(aligned, { panes, rules, declared: o.declared === undefined ? null : o.declared.join('\u0001'), jumps: o.jumpLines !== undefined, inOrder, reused: false });
  return aligned;
}

/**
 * Step 4 of `alignPanes`: every group at the row of its lowest mark, then equal heights. A line holds one row (NC-12).
 * `states` and `reasons` are the answer of the steps before it and are changed in place (`matched`, or `elsewhere`).
 */
function fillRows(panes: readonly PaneMarks[], states: MarkState[][], reasons: (MarkReason | null)[][], inOrder: readonly Occurrence[]): Alignment {
  const extra = new Array<number>(panes.length).fill(0);
  const rowOfLine = panes.map(() => new Map<number, number>());
  const zoneAt = new Map<string, FillerZone>();
  const addZone = (pane: number, afterLine: number, lines: number): void => {
    const key = `${pane}:${afterLine}`;
    const z = zoneAt.get(key);
    if (z) z.lines += lines;
    else zoneAt.set(key, { pane, afterLine, lines });
  };
  const groups: AlignedGroup[] = [];
  for (const occ of inOrder) {
    const members = occ.members;
    let target = 0;
    let crowded = false;
    for (const m of members) target = Math.max(target, panes[m.pane].marks[m.index].line + extra[m.pane]);
    for (const m of members) {
      const line = panes[m.pane].marks[m.index].line;
      if (rowOfLine[m.pane].has(line) && line + extra[m.pane] !== target) crowded = true;
    }
    if (crowded) {
      for (const m of members) {
        states[m.pane][m.index] = 'unmatched';
        reasons[m.pane][m.index] = { kind: 'elsewhere' };
      }
      continue;
    }
    const placed: { pane: number; line: number }[] = [];
    for (const m of members) {
      const line = panes[m.pane].marks[m.index].line;
      const need = target - (line + extra[m.pane]);
      if (need > 0) {
        addZone(m.pane, line - 1, need);
        extra[m.pane] += need;
      }
      rowOfLine[m.pane].set(line, target);
      states[m.pane][m.index] = 'matched';
      reasons[m.pane][m.index] = null;
      placed.push({ pane: m.pane, line });
    }
    groups.push({ marks: placed });
  }
  const tallest = panes.reduce((t, p, i) => Math.max(t, p.lineCount + extra[i]), 0);
  panes.forEach((p, i) => {
    const gap = tallest - (p.lineCount + extra[i]);
    if (gap > 0) addZone(i, p.lineCount, gap);
  });
  const zones = [...zoneAt.values()].sort((a, b) => a.pane - b.pane || a.afterLine - b.afterLine);
  return { groups, states, reasons, zones };
}

/** What a full alignment keeps for `AlignOptions.previous`: the inputs it was made from and the order it found (steps 1 to 3). */
interface Plan {
  panes: readonly PaneMarks[];
  rules: readonly SyncRule[];
  declared: string | null;
  jumps: boolean;
  inOrder: readonly Occurrence[];
  /** Made by `realign` from an earlier alignment, not by the whole of `alignPanes`. */
  reused: boolean;
}

const plans = new WeakMap<Alignment, Plan>();

/** Whether `a` and `b` are the same mark but for the line (what steps 1 to 3 read: the rule, the code, the channel, the partners, whether it blocks and whether its partner word was absent). */
function sameButLine(a: SyncHit, b: SyncHit): boolean {
  if (a === b) return true;
  if (a.mark !== b.mark || a.ruleId !== b.ruleId || a.channel !== b.channel || a.blocking !== b.blocking || a.absent !== b.absent || a.partners.length !== b.partners.length) return false;
  for (let i = 0; i < a.partners.length; i++) if (a.partners[i] !== b.partners[i]) return false;
  return true;
}

/** Whether `alignment` was made from an earlier one (`AlignOptions.previous`) and not by the whole of `alignPanes`: for the tests, which hold a reuse to the whole. */
export function wasRealigned(alignment: Alignment): boolean {
  return plans.get(alignment)?.reused === true;
}

/** Whether two lists of rules are the same rules (the machine's block keeps its objects between edits, so the objects usually are). */
function sameRules(a: readonly SyncRule[], b: readonly SyncRule[]): boolean {
  if (a === b) return true;
  return a.length === b.length && a.every((rule, i) => rule === b[i] || JSON.stringify(rule) === JSON.stringify(b[i]));
}

/**
 * The alignment of `panes` from `prev`, the one of the same panes before an edit, when the edit only moved lines: the same
 * panes (channels), the same rules and declared channels, and in every pane the same marks in the same order that differ
 * in their lines at most. Who meets whom, in which order and what the reasons are is then what `prev` found (the first
 * three steps of `alignPanes` read the marks by index and never by line, when no jump lines are given); only the rows,
 * which are lines, are worked out again. Null when that cannot be said, or when `prev` used jump lines or `o` has them.
 */
function realign(prev: Alignment, panes: readonly PaneMarks[], rules: readonly SyncRule[], o: AlignOptions): Alignment | null {
  const plan = plans.get(prev);
  if (plan === undefined || plan.jumps || o.jumpLines !== undefined || !sameRules(plan.rules, rules)) return null;
  if ((o.declared === undefined ? null : o.declared.join('\u0001')) !== plan.declared) return null;
  if (plan.panes.length !== panes.length) return null;
  for (let i = 0; i < panes.length; i++) {
    const before = plan.panes[i];
    const now = panes[i];
    if (before.channel !== now.channel || before.marks.length !== now.marks.length) return null;
    for (let j = 0; j < now.marks.length; j++) if (!sameButLine(before.marks[j], now.marks[j])) return null;
  }
  // The steps before step 4 left these marks as they came; step 4 made them `matched` or `elsewhere`.
  const states = prev.states.map((row) => row.slice());
  const reasons = prev.reasons.map((row) => row.slice());
  for (const occ of plan.inOrder) {
    for (const m of occ.members) {
      states[m.pane][m.index] = 'none';
      reasons[m.pane][m.index] = null;
    }
  }
  const aligned = fillRows(panes, states, reasons, plan.inOrder);
  plans.set(aligned, { ...plan, panes, reused: true });
  return aligned;
}

/**
 * Three or four panes (NC-5): drops the occurrence that crosses the most others until none
 * crosses another. Two occurrences cross when two panes they both involve have them in a
 * different order; an occurrence's count is the sum over the pairs of panes. Ties: its lowest
 * pane, then its line there.
 */
function dropMostCrossing(panes: readonly PaneMarks[], alive: Set<Occurrence>, drop: (occ: Occurrence) => void): void {
  // A pair of panes whose occurrences are in one order stays so when occurrences are dropped.
  const pairs: [number, number][] = [];
  for (let p = 0; p < panes.length; p++) for (let q = p + 1; q < panes.length; q++) pairs.push([p, q]);
  let work = 0;
  for (let round = 0; round < MAX_CROSSING_DROPS && work < MAX_CROSSING_WORK; round++) {
    const count = new Map<Occurrence, number>();
    for (let k = pairs.length - 1; k >= 0; k--) {
      const [p, q] = pairs[k];
      const seq = [...alive].filter((c) => c.at[p] >= 0 && c.at[q] >= 0).sort((x, y) => x.at[p] - y.at[p]);
      work += seq.length;
      let increasing = true;
      for (let i = 1; i < seq.length && increasing; i++) increasing = seq[i - 1].at[q] < seq[i].at[q];
      if (increasing) {
        pairs.splice(k, 1);
        continue;
      }
      // Per element: the earlier ones with a later q position plus the later ones with an earlier one (a Fenwick tree).
      const size = panes[q].marks.length + 1;
      const tree = new Int32Array(size + 1);
      const add = (i: number): void => {
        for (i++; i <= size; i += i & -i) tree[i]++;
      };
      const sum = (i: number): number => {
        let s = 0;
        for (i++; i > 0; i -= i & -i) s += tree[i];
        return s;
      };
      const inversions = new Int32Array(seq.length);
      seq.forEach((c, i) => {
        inversions[i] += i - sum(c.at[q]); // earlier, later in q
        add(c.at[q]);
      });
      tree.fill(0);
      for (let i = seq.length - 1; i >= 0; i--) {
        inversions[i] += sum(seq[i].at[q] - 1); // later, earlier in q
        add(seq[i].at[q]);
      }
      seq.forEach((c, i) => {
        if (inversions[i] > 0) count.set(c, (count.get(c) ?? 0) + inversions[i]);
      });
    }
    if (count.size === 0) return;
    let worst: Occurrence | null = null;
    let most = -1;
    for (const [occ, n] of count) {
      if (n > most || (n === most && worst !== null && before(occ, worst))) {
        worst = occ;
        most = n;
      }
    }
    drop(worst!);
  }

  function before(x: Occurrence, y: Occurrence): boolean {
    const px = x.members[0].pane;
    const py = y.members[0].pane;
    if (px !== py) return px < py;
    const lx = panes[px].marks[x.members[0].index].line;
    const ly = panes[py].marks[y.members[0].index].line;
    return lx !== ly ? lx < ly : x.members[0].index < y.members[0].index;
  }
}
