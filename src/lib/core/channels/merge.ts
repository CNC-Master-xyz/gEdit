// Merging split channel documents back into their program (Phase 4 plan AD-51, §6.7 rule 16).
// Written by the P4e prelude as a stub; implemented by **P4.23**, on the mapping of
// `core/channels/panes.ts` (P4.22a).
//
// "Split into Channel Documents" makes one untitled document per channel whose text is exactly
// that channel's projection (`projectedLines(projectChannel(set, channel))`: the header, then
// the channel's ranges). The split now also keeps a record of what it made (`SplitRecord`, in
// memory for the session; P4f writes the documents to disk and decides whether the record is
// kept with them). "Merge Channels Back" turns the record and the documents' current text into
// the new text of the program, refused as a whole when any check below fails:
//
//  1. The program has to show, for every channel that is merged, the projection the record
//     holds: an edit in the program since the split (or since the last merge) inside that
//     channel's lines refuses (`channels.merge.sourceChanged`, naming the channel). Edits in
//     the lines of a channel that is not merged, or in lines of no channel, stay as they are.
//     The header counts as every channel's: a header edited in the program refuses too.
//  2. A channel document's first `header.length` lines must still be the header: the header
//     belongs to every channel, and two documents could change it in two ways
//     (`channels.merge.headerChanged`, naming the channel).
//  3. A closed channel document is not merged (`skipped: 'closed'`); an unchanged one is not
//     either (`skipped: 'unchanged'`). Nothing left to merge is an answer, not a refusal.
//  4. The body edits of a document (a line diff of the recorded text against the current
//     one) are mapped into the program through the channel's projection (panes.ts rules 3–5:
//     an insertion between two ranges goes to the end of the range above).
//  5. The merged program is read again with the machine's section rules; every merged channel
//     must then project exactly to its document's text and every other channel to what it
//     was. An edit that starts or ends a section (a wait or a section mark typed in the wrong
//     channel) would move lines between channels and refuses (`channels.merge.sectionsMoved`).
//  6. The caller writes the answer with `applyLines(source, 1, lineCount, lines)`: the
//     minimal edits as **one undo step** of the program, bookmarks on untouched lines kept.
//     The record is then renewed (`MergeAnswer.record`): a merged channel's lines become its
//     document's text, a channel that was skipped keeps what it had, so a later merge starts
//     from there.
//
// As built (P4.23), where the rules above leave room:
//  - A hunk of the line diff pairs its old and new lines in order: a changed line stays in its
//    own place; lines left over are deleted, or inserted after the last line of the hunk. An
//    insertion with no deleted line is placed after the pane line above it (rule 4's "end of
//    the range above"). Lines added between the header and the first range are a change of
//    the header (`headerChanged`).
//  - Two documents that change the same program line (a section several channels share)
//    differently refuse (`channels.merge.sharedChanged`); the same change twice goes in once.
//    So does a shared line (or lines added between two shared lines) that one merged document
//    changed and another merged document, which shows it too, kept as it was (P4e review NC-14:
//    before, rule 5 refused it with `sectionsMoved`, the wrong reason).
//  - A channel that is not merged must read, after the merge, as it does now plus the edits
//    that landed in lines it shares; anything else is `sectionsMoved`.


import type { DocId, Msg } from '$lib/app/types';
import type { ChannelSet } from '$lib/core/channels/types';
import { diffLines } from '$lib/core/transforms/lineDiff';
import { docLineOf, paneLineOf, projectChannel, projectedLines, type ChannelProjection } from './panes';

/** What the split remembers (§6.7 rule 16). */
export interface SplitRecord {
  sourceId: DocId;
  /** The program's header at the split (the outside range from line 1); may be empty. */
  header: readonly string[];
  /** One per channel document the split made, in declared channel order. */
  channels: readonly {
    channelId: string;
    docId: DocId;
    /** The document's lines as made: `header` and then the channel's ranges. */
    lines: readonly string[];
  }[];
}

export type MergeAnswer =
  | {
      ok: true;
      /** The whole new text of the program, as lines. */
      lines: string[];
      /** The channels whose edits went in, in declared order. */
      merged: string[];
      skipped: { channelId: string; reason: 'closed' | 'unchanged' }[];
      /** The record to keep after the write (rule 6): the same split, synchronised for the merged channels. */
      record: SplitRecord;
    }
  | { ok: false; reason: Msg; channelId?: string };

const sameLines = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((line, i) => line === b[i]);

/** The program's header: the outside range from line 1, as lines (empty when a section starts at line 1). */
function headerOf(lines: readonly string[], set: ChannelSet): string[] {
  const header = set.outside.find((r) => r.startLine === 1);
  return header ? lines.slice(0, header.endLine) : [];
}

/** The lines `channelId` shows in `set` over `lines`, or null when the set has no section for it. */
function projection(set: ChannelSet, lines: readonly string[], channelId: string): { proj: ChannelProjection; lines: string[] } | null {
  const proj = projectChannel(set, channelId);
  return proj === null ? null : { proj, lines: projectedLines(proj, (from, to) => lines.slice(from - 1, to) as string[]) };
}

/**
 * The record of a split: `made` are the documents in declared channel order (a channel the
 * program has no section for has no document and is left out).
 */
export function splitRecord(o: {
  sourceId: DocId;
  lines: readonly string[];
  set: ChannelSet;
  made: readonly { channelId: string; docId: DocId }[];
}): SplitRecord {
  const channels: { channelId: string; docId: DocId; lines: readonly string[] }[] = [];
  for (const m of o.made) {
    const shown = projection(o.set, o.lines, m.channelId);
    if (shown !== null) channels.push({ channelId: m.channelId, docId: m.docId, lines: shown.lines });
  }
  return { sourceId: o.sourceId, header: headerOf(o.lines, o.set), channels };
}

type Outcome = { kind: 'delete' } | { kind: 'replace'; text: string };

/**
 * The merge (rules 1–5). `channelLines` answers a channel document's current lines, or null
 * when it is closed; `resolve` reads lines with the program's machine (`resolveDocument`).
 */
export function planMerge(o: {
  record: SplitRecord;
  source: { lines: readonly string[]; set: ChannelSet };
  channelLines(docId: DocId): readonly string[] | null;
  resolve(lines: readonly string[]): ChannelSet;
}): MergeAnswer {
  const { record, source } = o;
  const nameOf = (id: string): string =>
    source.set.members.find((m) => m.channel.id === id)?.channel.name ?? source.set.missing.find((c) => c.id === id)?.name ?? id;
  const refuse = (key: string, channelId: string): MergeAnswer => ({
    ok: false,
    reason: { key, params: { channel: nameOf(channelId) } },
    channelId,
  });

  // Rule 3: closed and unchanged documents are skipped.
  const skipped: { channelId: string; reason: 'closed' | 'unchanged' }[] = [];
  const todo: { channelId: string; docId: DocId; doc: readonly string[]; recorded: readonly string[] }[] = [];
  for (const entry of record.channels) {
    const doc = o.channelLines(entry.docId);
    if (doc === null) skipped.push({ channelId: entry.channelId, reason: 'closed' });
    else if (sameLines(doc, entry.lines)) skipped.push({ channelId: entry.channelId, reason: 'unchanged' });
    else todo.push({ channelId: entry.channelId, docId: entry.docId, doc, recorded: entry.lines });
  }
  if (todo.length === 0) return { ok: true, lines: [...source.lines], merged: [], skipped, record };

  // Rules 2 and 1, channel by channel in declared order.
  const header = record.header;
  const shown = new Map<string, { proj: ChannelProjection; lines: string[] }>();
  for (const t of todo) {
    if (t.doc.length < header.length || !sameLines(t.doc.slice(0, header.length), header)) return refuse('channels.merge.headerChanged', t.channelId);
    const now = projection(source.set, source.lines, t.channelId);
    if (now === null || !sameLines(now.lines, t.recorded)) return refuse('channels.merge.sourceChanged', t.channelId);
    shown.set(t.channelId, now);
  }

  // Rule 4: the body edits, mapped to program lines.
  const outcomes = new Map<number, Outcome>();
  const inserts = new Map<number, string[]>();
  /** Which documents changed a program line (`outcomes`) or added lines after it (`inserts`). */
  const changedBy = new Map<number, Set<string>>();
  const insertedBy = new Map<number, Set<string>>();
  const note = (map: Map<number, Set<string>>, line: number, channelId: string): void => {
    const set = map.get(line);
    if (set) set.add(channelId);
    else map.set(line, new Set([channelId]));
  };
  let current = '';
  const claim = (line: number, next: Outcome): boolean => {
    note(changedBy, line, current);
    const had = outcomes.get(line);
    if (had === undefined) {
      outcomes.set(line, next);
      return true;
    }
    return had.kind === next.kind && (had.kind === 'delete' || (next.kind === 'replace' && had.text === next.text));
  };
  for (const t of todo) {
    current = t.channelId;
    const { proj } = shown.get(t.channelId)!;
    for (const e of diffLines(t.recorded as string[], t.doc as string[])) {
      const removed = e.oldEnd - e.oldStart;
      // Text added between the header and the first range is a change of the header: it would
      // sit above every channel's first range, not above this one's.
      if (removed === 0 && e.oldStart <= header.length) return refuse('channels.merge.headerChanged', t.channelId);
      const paired = Math.min(removed, e.newLines.length);
      for (let k = 0; k < removed; k++) {
        const line = docLineOf(proj, e.oldStart + k + 1);
        if (!claim(line, k < paired ? { kind: 'replace', text: e.newLines[k] } : { kind: 'delete' })) return refuse('channels.merge.sharedChanged', t.channelId);
      }
      if (e.newLines.length > removed) {
        const extra = e.newLines.slice(removed);
        const after = removed > 0 ? docLineOf(proj, e.oldEnd) : e.oldStart >= 1 ? docLineOf(proj, e.oldStart) : docLineOf(proj, 1) - 1;
        note(insertedBy, after, t.channelId);
        const had = inserts.get(after);
        if (had === undefined) inserts.set(after, extra);
        else if (!sameLines(had, extra)) return refuse('channels.merge.sharedChanged', t.channelId);
      }
    }
  }
  // NC-14: a shared line one merged document changed and another, which shows it too, did not.
  for (const t of todo) {
    const { proj } = shown.get(t.channelId)!;
    const shows = (line: number): boolean => line >= 1 && paneLineOf(proj, line) !== null;
    for (const [line, by] of changedBy) {
      if (!by.has(t.channelId) && shows(line)) return refuse('channels.merge.sharedChanged', t.channelId);
    }
    for (const [line, by] of insertedBy) {
      // Lines added after `line` sit between two lines this document shows.
      if (!by.has(t.channelId) && shows(line) && shows(line + 1)) {
        return refuse('channels.merge.sharedChanged', t.channelId);
      }
    }
  }
  const merged: string[] = [...(inserts.get(0) ?? [])];
  source.lines.forEach((text, i) => {
    const line = i + 1;
    const outcome = outcomes.get(line);
    if (outcome === undefined) merged.push(text);
    else if (outcome.kind === 'replace') merged.push(outcome.text);
    if (inserts.has(line)) merged.push(...inserts.get(line)!);
  });

  // Rule 5: read the merged program again; every channel must read as intended.
  const after = o.resolve(merged);
  const changed = new Set(todo.map((t) => t.channelId));
  const wanted = (channelId: string): readonly string[] | null => {
    const t = todo.find((x) => x.channelId === channelId);
    if (t !== undefined) return t.doc;
    const now = shown.get(channelId) ?? projection(source.set, source.lines, channelId);
    if (now === null) return null;
    // What it was, with the edits that landed in lines it shares.
    const out: string[] = [];
    for (let n = 1; n <= now.proj.lineCount; n++) {
      const line = docLineOf(now.proj, n);
      const outcome = outcomes.get(line);
      if (outcome === undefined) out.push(source.lines[line - 1]);
      else if (outcome.kind === 'replace') out.push(outcome.text);
      if (inserts.has(line)) out.push(...inserts.get(line)!);
    }
    return out;
  };
  const order = [...record.channels.map((c) => c.channelId).filter((id) => changed.has(id)), ...record.channels.map((c) => c.channelId).filter((id) => !changed.has(id))];
  for (const id of order) {
    const expect = wanted(id);
    const got = projection(after, merged, id);
    if (expect === null ? got !== null : got === null || !sameLines(got.lines, expect)) return refuse('channels.merge.sectionsMoved', id);
  }

  return {
    ok: true,
    lines: merged,
    merged: todo.map((t) => t.channelId),
    skipped,
    record: { ...record, channels: record.channels.map((c) => (changed.has(c.channelId) ? { ...c, lines: todo.find((t) => t.channelId === c.channelId)!.doc } : c)) },
  };
}
