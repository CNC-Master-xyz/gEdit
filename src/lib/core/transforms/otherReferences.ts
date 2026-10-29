// References from the other open documents into a renumbered one (plan §6.6 rules 11–13,
// AD-49, Q4-17). Owner: **P4.20a** (the rules; the service and the command are P4.20b's
// `app/renumberOthers.ts` and `contrib/renumberOthers.ts`).
//
// After a renumber of document A, a line of another open document B may still point at a
// block of A by its old number: `M98 P1000 Q30` where `O1000` is a program of A and not of
// B, or `M99 P30` in a subprogram of B that only a program of A calls. This module lists
// those lines (pure: lines in, rows out) and writes the new values into B's lines when the
// user asks for it. It never reads a file that is not open, and it never decides on its own
// to write: `contrib/renumberOthers.ts` asks first and writes each document as its own
// undo step.
//
// The rules (§6.6 rule 12), in short:
//
//  - B is read only when it has the same profile id as A (another dialect's references do
//    not name A's programs; the owner, 2026-10-19: other profiles are never read) and is
//    not A. A document of another profile does not count as a caller either.
//  - A `called` reference of B names a program of A when B has no program of that name, A
//    has exactly one, and no other open document of the profile has one
//    (`RenumberedSource.held`). The call is read with `programs.ts`' rules: the packed
//    Fanuc `P` (`M98 P21000` calls O1000), the repeat word, a program name, and every call
//    rule of the profile (`M98`, `G65`, `G66`, `G72.1`/`G72.2`, `M96`, `M198`).
//  - A `caller` reference of B names a program of A when the program it stands in has a
//    name, B holds that name once and calls it from none of its programs, no other open
//    document holds the name, and among A and every other open document of the profile
//    exactly one program calls it, in A, with a name. A program that calls one this run
//    cannot name (`M98 P#1`) may call any program, so it counts as a second possible
//    caller (as in-file, `ProgramIndex.unknownCallers`); several possible callers with at
//    least one in A give a `callers` row. P4d review NC-1: B's local call (`M98 Q30`) makes
//    a return inside the part it runs B's own business, and one whose part cannot be found
//    a second possible caller. P4d review NC-2: an interrupt (`M96 P2000`) in B, in A or in
//    another open document never proves a caller — the program returns into whichever one
//    it interrupted — so such a return is never an `update` (a `callers` row at most).
//  - An `own` reference never leaves B.
//  - Only a value whose block in A the run changed, removed or created is listed: `update`
//    (the block has a new number: the value can be rewritten), `gone` (the run removed the
//    number), `duplicate` (the number the value would name now names several blocks),
//    `lands` (the value named no block before and names one now), `callers` (more than one
//    program may be the one it returns to, so it cannot be told), and `kept` (P4.20a, §7
//    row: the value's block has a new number, but the profile never rewrites this
//    reference — Fanuc `M98 P… Q…`, report-only by the owner's decision — or the line
//    carries two words of its address, so which one is meant cannot be told).
//  - Rewrite only what is provable, as in-file (§6.6 rule 10, the M6 rule): only `update`
//    rows carry a `newText`, and only they are ever written. A value that is no plain
//    block number (`P#1`) is not listed: it named no block before the run either.

import { noMachine } from '$lib/core/machines/effective';
import { blockKeyOf, scanProgram } from './references';
import { indexPrograms, interruptMayStart, localReturnOf } from './programs';
import type { CodeDb } from '$lib/core/codes/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { BlockKey, ProgramScan, ReferenceWord } from './references';
import type { ProgramIndex, ProgramKey, RenumberedProgram, RenumberOutcome } from './programs';
import type { TransformContext } from './types';

/**
 * What a listed reference is, and whether "Update" may write it. Only `update` is written.
 * `kept` is P4.20a's addition (§7 row): the block got a new number, but the reference is
 * one the profile never rewrites (or cannot be told on its line).
 */
export type OtherReferenceKind = 'update' | 'gone' | 'duplicate' | 'lands' | 'callers' | 'kept';

/** One listed reference in another document. */
export interface OtherReference {
  /** 1-based line in the other document. */
  line: number;
  /** Offsets of the value inside the line (the address in front of it is not included). */
  start: number;
  end: number;
  /** The value as written (`'30'`, `'0030'`). */
  text: string;
  /** What `update` writes in place of `text`, written the way the old value was; null otherwise. */
  newText: string | null;
  kind: OtherReferenceKind;
  /** The program of the renumbered document the value points into, by its name (`'1000'`). */
  program: string;
}

/** One other open document, as this module reads it. */
export interface OtherDocument {
  lines: readonly string[];
  /** The document's own effective profile. */
  cp: CompiledProfile;
}

/**
 * What the module knows about the renumbered document. Build it with [`renumberedSourceOf`]
 * from the document's lines after the run; the members below `callers` are P4.20a's
 * additions (§7 row), without which a single caller or a single program cannot be proved.
 */
export interface RenumberedSource {
  /** The renumbered document's effective profile; another document is read only when its profile id is the same. */
  cp: CompiledProfile;
  outcome: RenumberOutcome;
  /**
   * Callee program key → the programs of the renumbered document that call it, one entry
   * per program: by key, or null for a calling program without a name (P4.20a: it is a
   * caller all the same, and nothing else can name it).
   */
  callers: ReadonlyMap<ProgramKey, readonly (ProgramKey | null)[]>;
  /** P4.20a: program key → how many programs of the renumbered document carry it (the untouched ones too). */
  held: ReadonlyMap<ProgramKey, number>;
  /** P4.20a: true when a program of the renumbered document calls one this run cannot name (`M98 P#1`). */
  callsUnknown: boolean;
  /**
   * P4d review NC-2: the programs an interrupt of the renumbered document starts
   * (`M96 P2000`). Optional for a hand-made source; [`renumberedSourceOf`] always sets it.
   */
  interrupted?: ReadonlySet<ProgramKey>;
  /** P4d review NC-2: true when an interrupt of the renumbered document names no program this run can read (`M96 P#1`). */
  interruptsUnknown?: boolean;
}

const NO_CODES: CodeDb = { dialect: 'none', version: 1, addresses: {}, codes: [] };

/** The scan and the program index of a whole document, as Renumber Blocks reads it. */
function indexOf(lines: readonly string[], cp: CompiledProfile): { scan: ProgramScan; index: ProgramIndex } {
  const ctx: TransformContext = { cp, codes: NO_CODES, machine: noMachine(cp.profile), options: {}, firstLine: 1, document: lines };
  const scan = scanProgram(lines, ctx);
  return { scan, index: indexPrograms(scan, cp) };
}

/**
 * The source for [`findOtherReferences`]: the renumbered document's programs and calls,
 * read from its lines (those after the run; a renumber changes no program name and no
 * call), and the run's `TransformResult.renumbered`.
 */
export function renumberedSourceOf(lines: readonly string[], cp: CompiledProfile, outcome: RenumberOutcome): RenumberedSource {
  const { index } = indexOf(lines, cp);
  const callers = new Map<ProgramKey, (ProgramKey | null)[]>();
  // One entry per calling program, as in-file `caller` counts them: two programs of one
  // name are two callers (and neither can be told apart from the other by its name).
  for (const [callee, segments] of index.callers) callers.set(callee, segments.map((segment) => index.programs[segment]?.key ?? null));
  const held = new Map<ProgramKey, number>();
  for (const [key, segments] of index.byKey) held.set(key, segments.length);
  return {
    cp,
    outcome,
    callers,
    held,
    callsUnknown: index.unknownCallers.length > 0,
    interrupted: new Set(index.interrupted.keys()),
    interruptsUnknown: index.unknownInterrupts.length > 0,
  };
}

/** What one other document of the profile holds and calls. */
interface Reading {
  doc: OtherDocument;
  scan: ProgramScan;
  index: ProgramIndex;
}

/** True when the profile has a reference rule that can name a block of another program. */
function namesOtherPrograms(cp: CompiledProfile): boolean {
  return (cp.profile.numbering?.references ?? []).some((rule) => rule?.program === 'called' || rule?.program === 'caller');
}

/** The program of the outcome with this key, when exactly one carries it; null otherwise. */
function renumberedProgram(outcome: RenumberOutcome, key: ProgramKey): RenumberedProgram | null {
  let found: RenumberedProgram | null = null;
  for (const program of outcome.programs) {
    if (program.key !== key) continue;
    if (found !== null) return null;
    found = program;
  }
  return found;
}

/** How many programs of the renumbered document carry `key`. */
function heldInSource(source: RenumberedSource, key: ProgramKey): number {
  return source.held.get(key) ?? 0;
}

/** True when the run touched what `key` names in `program`. */
function touches(program: RenumberedProgram, key: BlockKey): boolean {
  return program.changed.has(key) || program.created.has(key) || program.duplicated.has(key);
}

/**
 * The new value, written the way the old one was (the in-file rule of `renumber.ts`): zero
 * padding kept where block numbers are numbers, exactly the block's new text where they
 * are names.
 */
function writtenLike(word: ReferenceWord, digits: string, byText: boolean): string {
  if (byText || word.target === null) return digits;
  const value = String(Number(digits));
  const padded = word.text.length > String(word.target).length;
  return padded && value.length < word.text.length ? value.padStart(word.text.length, '0') : value;
}

/**
 * What became of the block `key` names in `program`, or null when the run did not touch it.
 * `rewritable` is false for a value the rules never rewrite: it is listed as `kept` where
 * it would be an `update`.
 */
function classify(
  program: RenumberedProgram,
  word: ReferenceWord,
  key: BlockKey,
  byText: boolean,
  rewritable: boolean,
): { kind: OtherReferenceKind; newText: string | null } | null {
  if (program.changed.has(key)) {
    const digits = program.changed.get(key) ?? null;
    if (digits === null) return { kind: 'gone', newText: null };
    const named = blockKeyOf(digits, byText);
    if (named === null || program.duplicated.has(named)) return { kind: 'duplicate', newText: null };
    if (!rewritable) return { kind: 'kept', newText: null };
    return { kind: 'update', newText: writtenLike(word, digits, byText) };
  }
  if (program.created.has(key)) return { kind: 'lands', newText: null };
  if (program.duplicated.has(key)) return { kind: 'duplicate', newText: null };
  return null;
}

/** How many programs of the other documents except `skip` carry `key`. */
function heldElsewhere(readings: readonly Reading[], skip: Reading, key: ProgramKey): number {
  let count = 0;
  for (const reading of readings) if (reading !== skip) count += reading.index.byKey.get(key)?.length ?? 0;
  return count;
}

/** One reference of B, decided (§6.6 rule 12); null when it is not listed. */
function decide(
  source: RenumberedSource,
  readings: readonly Reading[],
  reading: Reading,
  row: number,
  word: ReferenceWord,
): OtherReference | null {
  if (word.program === 'own' || word.key === null) return null;
  const { scan, index } = reading;
  const byText = source.outcome.byText;
  const key = blockKeyOf(word.text, byText);
  if (key === null) return null;
  const rewritable = word.rewrite && !word.ambiguous;
  const row1 = scan.firstLine + row;
  const listed = (program: RenumberedProgram, found: { kind: OtherReferenceKind; newText: string | null }): OtherReference => ({
    line: row1,
    start: word.start,
    end: word.end,
    text: word.text,
    newText: found.newText,
    kind: found.kind,
    program: program.name,
  });

  if (word.program === 'called') {
    const call = index.calls.get(row);
    // No readable call, or a local one (`M98 Q30` runs a part of B's own program).
    // An external call (`M198`) runs a program from a device, never A's program of that number.
    if (call === undefined || call.local === true || call.external === true || call.key === null) return null;
    // B holds the program itself: the reference is B's own business (the in-file rules).
    if ((index.byKey.get(call.key)?.length ?? 0) > 0) return null;
    // A holds it once and no other open document holds it: only then is it A's program.
    if (heldInSource(source, call.key) !== 1 || heldElsewhere(readings, reading, call.key) > 0) return null;
    const program = renumberedProgram(source.outcome, call.key);
    if (program === null) return null;
    const found = classify(program, word, key, byText, rewritable);
    return found === null ? null : listed(program, found);
  }

  // `caller`: the program the reference stands in, and who calls it.
  const own = index.programs[scan.segmentOf[row]]?.key ?? null;
  if (own === null) return null;
  // B holds that name twice (in-file `programTwice`), or a program of B calls it: B's own business.
  if ((index.byKey.get(own)?.length ?? 0) !== 1) return null;
  if ((index.callers.get(own)?.length ?? 0) > 0) return null;
  // A local call of B ends with this return (NC-1): B's own business too.
  const local = localReturnOf(scan, index, row);
  if (local === 'inside') return null;

  const inSource = source.callers.get(own) ?? [];
  // Only a caller in A makes this A's business; a caller elsewhere is no run's concern here.
  if (inSource.length === 0) return null;
  let known = inSource.length;
  // A local call of B whose part cannot be found may end here as well (NC-1), and an
  // interrupt anywhere that may start this program returns into whichever program it
  // interrupted (NC-2): both make the caller in A one of several.
  let possible =
    index.unknownCallers.length > 0 ||
    source.callsUnknown ||
    local === 'maybe' ||
    interruptMayStart(index, own) ||
    source.interrupted?.has(own) === true ||
    source.interruptsUnknown === true;
  for (const other of readings) {
    if (other === reading) continue;
    known += other.index.callers.get(own)?.length ?? 0;
    if (other.index.unknownCallers.length > 0 || interruptMayStart(other.index, own)) possible = true;
  }
  // The name is held elsewhere as well (A, or another open document): whose calls run
  // which of them cannot be told.
  const twice = heldInSource(source, own) > 0 || heldElsewhere(readings, reading, own) > 0;

  if (known === 1 && !possible && !twice) {
    const caller = inSource[0];
    // A caller without a name is not in `renumbered` (rule 11): what the run did to it is not known here.
    if (caller === null || heldInSource(source, caller) !== 1) return null;
    const program = renumberedProgram(source.outcome, caller);
    if (program === null) return null;
    const found = classify(program, word, key, byText, rewritable);
    return found === null ? null : listed(program, found);
  }

  // Several possible callers: listed when the value's block was touched in one of A's.
  for (const caller of inSource) {
    if (caller === null) continue;
    const program = renumberedProgram(source.outcome, caller);
    if (program !== null && touches(program, key)) return listed(program, { kind: 'callers', newText: null });
  }
  return null;
}

/**
 * The listed references of every other document, one list per entry of `others` in the
 * same order (an empty list for a document with none, and for one of another profile).
 * Rows are in line order, and in the order of the words on a line.
 */
export function findOtherReferences(source: RenumberedSource, others: readonly OtherDocument[]): OtherReference[][] {
  const result: OtherReference[][] = others.map(() => []);
  if (source.outcome.programs.length === 0 || !namesOtherPrograms(source.cp)) return result;
  const profileId = source.cp.profile.id;
  const readings: (Reading | null)[] = others.map((doc) => {
    if (doc.cp.profile.id !== profileId) return null;
    return { doc, ...indexOf(doc.lines, doc.cp) };
  });
  const same = readings.filter((reading): reading is Reading => reading !== null);
  readings.forEach((reading, i) => {
    if (reading === null) return;
    for (const { row, word } of reading.scan.found) {
      const listed = decide(source, same, reading, row, word);
      if (listed !== null) result[i].push(listed);
    }
  });
  return result;
}

/**
 * `lines` with every `update` reference written (the others are left), and how many values
 * were written; the line count does not change. Several values on one line are written
 * from the back, so an earlier span keeps its offsets. A span that no longer reads the
 * listed value is left alone and not counted (the service refuses a changed document as a
 * whole before it gets here, §6.6 rule 13; this is the last guard, never a guess).
 */
export function applyOtherReferences(lines: readonly string[], refs: readonly OtherReference[]): { lines: string[]; changed: number } {
  const out = lines.slice();
  const byLine = new Map<number, OtherReference[]>();
  for (const ref of refs) {
    if (ref.kind !== 'update' || ref.newText === null) continue;
    const list = byLine.get(ref.line);
    if (list === undefined) byLine.set(ref.line, [ref]);
    else list.push(ref);
  }
  let changed = 0;
  for (const [line, list] of byLine) {
    const index = line - 1;
    let text = out[index];
    if (text === undefined) continue;
    list.sort((a, b) => b.start - a.start);
    let limit = text.length;
    for (const ref of list) {
      // Overlapping spans, or one that no longer holds the value: left as it is.
      if (ref.end > limit || text.slice(ref.start, ref.end) !== ref.text) continue;
      text = text.slice(0, ref.start) + ref.newText + text.slice(ref.end);
      limit = ref.start;
      changed++;
    }
    out[index] = text;
  }
  return { lines: out, changed };
}
