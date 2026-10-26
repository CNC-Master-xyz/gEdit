// The jump lines of a program, kept from one version to the next (v1.2.0 T033).
//
// The channel view needs the jump lines of a program (`computeJumpLines`: the lines a jump
// names, the lines of backward jumps and of loops) whenever a wait has no partner, to tell a wait
// in a loop from a missing one. They were read again for every version of the program: at 300,000
// lines that is every line tokenized again after each Enter. An edit almost never changes them.
// A jump line is a line with a block number, a label, a loop word or an address a jump goes
// through, and so is the line of a jump; when the lines an edit replaced held none of those, and
// the lines it wrote hold none, the jump lines are the old ones with the lines after the edit
// moved by the number of lines the edit added.
//
// The answer is never a guess: whenever that reasoning does not hold (a relevant line replaced or
// written, a paste of many lines, a flush, a version nobody told about, sections that are not the
// old ones moved) the program is read in full as before. The unit test holds the cache to
// `computeJumpLines` over random edits.

import { maskedOf, referenceAddresses } from '$lib/core/transforms/references';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import type { CompiledProfile } from '$lib/core/profiles/types';

/** Jump lines by channel id, in the program's own lines (`computeJumpLines`). */
export type JumpLines = Record<string, number[]>;

/** The sections the answer was made for (channel and ranges, as `ChannelSet` members carry them); null for one channel. */
export type SectionPrint = readonly { channel: string; ranges: readonly { startLine: number; endLine: number }[] }[] | null;

/** The lines an edit replaced, as `ContentChange` says them. */
export interface JumpChange {
  startLine: number;
  endLineOld: number;
  endLineNew: number;
  flush: boolean;
  /** The program's version after the change. */
  versionId: number;
}

/** A paste longer than this is not carried over: the program is read again when the answer is needed. */
const MAX_NOTED_LINES = 2000;

const addressCache = new WeakMap<CompiledProfile, Set<string>>();

/**
 * Whether `line` can be a line `computeJumpLines` puts in its answer or reads a jump from: it holds a block number, a
 * label, a keyword (the loop words, `GOTO`) or a word of an address a `numbering.references` rule reads on a line that rule's
 * trigger matches (`M98 P1000`; not `M8`). Any line
 * that is not (a move, a comment, a blank line) changes nothing about the jump lines by being edited, written or
 * deleted. Conservative on purpose: a keyword of any kind counts.
 */
export function mayDecideJumps(line: string, cp: CompiledProfile): boolean {
  if (line.length === 0) return false;
  let addresses = addressCache.get(cp);
  if (addresses === undefined) {
    addresses = referenceAddresses(cp);
    addressCache.set(cp, addresses);
  }
  const tokens = tokenizeLine(line, cp).tokens;
  let carriesReference = false;
  for (const token of tokens) {
    if (token.kind === 'blockNumber' || token.kind === 'label' || token.kind === 'keyword') return true;
    if (token.kind === 'word' && token.address !== undefined && addresses.has(token.address)) carriesReference = true;
  }
  // An address a rule reads is not yet a jump: `M98 P1` is, `M8` is not. The rule's trigger, on the line without its comments, says so.
  if (!carriesReference) return false;
  const masked = maskedOf(line, tokens);
  return cp.re.references.some((rule) => ((rule.trigger.lastIndex = 0), rule.trigger.test(masked)));
}

interface Entry {
  /** The program's version the answer and the text are those of. */
  version: number;
  lines: JumpLines;
  /** The program's lines at `version`. */
  text: string[];
  sections: { channel: string; ranges: { startLine: number; endLine: number }[] }[] | null;
}

/** A range after an edit: moved when it lies below it, grown when it holds it, left alone above it (anything else is a boundary that moved, and the next comparison says so). */
function moved(r: { startLine: number; endLine: number }, c: JumpChange): { startLine: number; endLine: number } {
  const delta = c.endLineNew - c.endLineOld;
  if (delta === 0 || r.endLine < c.startLine) return r;
  if (r.startLine > c.endLineOld) return { startLine: r.startLine + delta, endLine: r.endLine + delta };
  if (r.startLine <= c.startLine && r.endLine >= c.endLineOld) return { startLine: r.startLine, endLine: r.endLine + delta };
  return r;
}

function samePrint(a: Entry['sections'], b: SectionPrint): boolean {
  if (a === null || b === null) return a === null && b === null;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].channel !== b[i].channel || a[i].ranges.length !== b[i].ranges.length) return false;
    for (let k = 0; k < a[i].ranges.length; k++) {
      if (a[i].ranges[k].startLine !== b[i].ranges[k].startLine || a[i].ranges[k].endLine !== b[i].ranges[k].endLine) return false;
    }
  }
  return true;
}

/** The index of the first number above `line` in the sorted list. */
function firstAbove(list: readonly number[], line: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] <= line) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface JumpLineCache {
  /**
   * The jump lines of program `id` at `version`: the kept answer when it is still the program's, else
   * `compute(lines)` over `read()`. `sections` says which lines are in which channel (`null`: one channel).
   */
  get(id: string, version: number, sections: SectionPrint, read: () => string[], compute: (lines: string[]) => JumpLines): JumpLines;
  /**
   * The program changed: carry the kept answer over to the new version when the edit cannot have changed it.
   * Answers `kept` then, `dropped` when the edit may have changed the jump lines (the next `get` reads the
   * program again), and `none` when nothing was kept for the program.
   */
  note(id: string, change: JumpChange, readNew: (from: number, to: number) => string[]): 'kept' | 'dropped' | 'none';
  /** Drops what is kept for program `id`, or for every program. */
  forget(id?: string): void;
}

/** `mayDecide(line)` is `mayDecideJumps` under the program's profile; absent, nothing is carried over. */
export function createJumpLineCache(mayDecide: ((id: string, line: string) => boolean) | undefined): JumpLineCache {
  const entries = new Map<string, Entry>();
  return {
    get(id, version, sections, read, compute) {
      const kept = entries.get(id);
      if (kept !== undefined && kept.version === version && samePrint(kept.sections, sections)) return kept.lines;
      const text = read();
      const lines = compute(text);
      if (mayDecide === undefined) {
        entries.delete(id);
        return lines;
      }
      entries.set(id, {
        version,
        lines,
        text,
        sections: sections === null ? null : sections.map((s) => ({ channel: s.channel, ranges: s.ranges.map((r) => ({ startLine: r.startLine, endLine: r.endLine })) })),
      });
      return lines;
    },

    note(id, change, readNew) {
      const entry = entries.get(id);
      if (entry === undefined || mayDecide === undefined) return 'none';
      const oldCount = change.endLineOld - change.startLine + 1;
      const newCount = change.endLineNew - change.startLine + 1;
      // One version per event: a version nobody was told about means the text kept here is not the program's.
      if (change.versionId !== entry.version + 1 || change.flush || newCount < 1 || oldCount < 1 || change.endLineOld > entry.text.length || newCount > MAX_NOTED_LINES || oldCount > MAX_NOTED_LINES) {
        entries.delete(id);
        return 'dropped';
      }
      const replaced = entry.text.slice(change.startLine - 1, change.endLineOld);
      const written = readNew(change.startLine, change.endLineNew);
      if (written.length !== newCount || replaced.some((l) => mayDecide(id, l)) || written.some((l) => mayDecide(id, l))) {
        entries.delete(id);
        return 'dropped';
      }
      if (oldCount === newCount) {
        for (let i = 0; i < newCount; i++) entry.text[change.startLine - 1 + i] = written[i];
      } else {
        entry.text = entry.text.slice(0, change.startLine - 1).concat(written, entry.text.slice(change.endLineOld));
      }
      const delta = newCount - oldCount;
      if (delta !== 0) {
        // A new object: the answer `get` gave out before is not changed under whoever holds it.
        const lines: JumpLines = {};
        for (const [channel, list] of Object.entries(entry.lines)) {
          const from = firstAbove(list, change.endLineOld);
          lines[channel] = from < list.length ? list.slice(0, from).concat(list.slice(from).map((n) => n + delta)) : list;
        }
        entry.lines = lines;
        if (entry.sections !== null) for (const s of entry.sections) s.ranges = s.ranges.map((r) => moved(r, change));
      }
      entry.version = change.versionId;
      return 'kept';
    },

    forget(id) {
      if (id === undefined) entries.clear();
      else entries.delete(id);
    },
  };
}
