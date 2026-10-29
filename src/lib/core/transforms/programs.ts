// The programs of a file and the calls between them (plan §6.6 rules 8–10, AD-49). Owner:
// **P4.19**.
//
// A block-number reference names a block of **a** program: `GOTO 100` one of the program
// it stands in, `M98 P1000 Q30` one of `O1000`, `M99 P30` one of the program that called
// the subprogram it stands in (F42). `references.ts` says which of the three a word means
// (`ReferenceWord.program`); this module says which program of the file that is, or why
// it cannot be told — and then the caller reports instead of guessing.
//
// The rules (§6.6), in short:
//
//  - A program is a segment of `ProgramScan` (split where `program.start` matches). Its
//    name is the `name` group of the first start pattern that matches its first line; a
//    segment without one (the lines before the first program start, a start pattern
//    without the group) has no name and can be neither called nor resolved.
//  - Names are compared as numbers where they are digits and the dialect compares block
//    numbers as numbers (`O0100` is `P100`), and as upper-case text otherwise.
//  - A line calls a program when a `numbering.calls` rule fires on it (§6.6 rule 9): the
//    trigger matches the comment-masked line, and the program is the plain number of the
//    rule's word or a program-name token behind the trigger (`M98 <SHAFT_T12>`), read with
//    the `program.start` patterns. Fanuc packs a repeat count into the word: with
//    `maxDigits` 4 and `repeatAddress` `L`, `M98 P21010` calls O1010 twice and
//    `M98 P12345 L2` calls O12345 (the 30i manuals). Two rules that name different
//    programs on one line, a variable or an expression in the word, two such words, or a
//    value longer than `MAX_TARGET_DIGITS` make the call unknown (`key` null).
//  - The local call (P4.19, narrowed by the P4d review NC-1, §7 row): only a rule with a
//    `localAddress` calls on a line without its word and without a name, and only where
//    that word is on the line — Fanuc `M98 Q30` runs the blocks of its own program from
//    N30 up to the next return (the first line from there on where a `caller` reference
//    rule's trigger matches, `M99`) as a subprogram (`CallTarget.local`). Any other rule
//    that fires without its word calls nothing (a bare `M96`, `G65` without `P`). A local
//    call proves the caller of an `M99 P` **inside that part** only; where the part cannot
//    be found (`M98 Q#1`, no such block, the block twice, no return behind it) the program
//    is a possible caller of every return in it and proves none.
//  - An interrupt (P4d review NC-2, §7 row; `CallRule.interrupt`, Fanuc `M96 P2000`)
//    starts its program when a signal arrives, and that program returns into whichever
//    program it interrupted. It never proves a caller: an `M99 P` in a program an interrupt
//    of the file may start is refused (`interrupt`), and so is every `M99 P` of a file with
//    an interrupt whose program cannot be named (`M96 P#1`).
//  - `called` resolves to the one program of the file with the name the line calls (to
//    the line's own program for a local call); `caller` to the one program of the file
//    whose lines call the program the reference stands in. None, or more than one, is a
//    refusal with its reason. A program with an unknown call (`M98 P#1`) may call any
//    program, so beside a known caller it is a second possible one (`unknownCallers`,
//    §7 row): refuse rather than guess. On its own it proves no call: `noCaller`.

import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { MAX_TARGET_DIGITS, blockKeyOf, comparesByText, maskedOf, ruleProgram } from './references';
import type { LineState, NcToken } from '$lib/core/nc/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { BlockKey, ProgramScan, ReferenceWord } from './references';

/**
 * What tells two programs apart: the number a program name of digits spells (`O0100` and
 * `M98 P100` are one program) where the dialect compares numbers, the upper-case text
 * otherwise (`<SHAFT_T12>`, Okuma `OABCD`, Sinumerik `PART1`).
 */
export type ProgramKey = number | string;

/** One program of the scanned file. */
export interface ProgramInfo {
  /** Index into `ProgramScan.segments`; `programs[i].segment === i`. */
  segment: number;
  /** The row of `ProgramScan.scanned` the program starts on. */
  row: number;
  /** The name as `program.start`'s `name` group reads it (`'1000'`, `'SHAFT_T12'`), or null. */
  name: string | null;
  key: ProgramKey | null;
}

/** The program a line calls (§6.6 rule 9). */
export interface CallTarget {
  /**
   * The program, or null when the line calls one it cannot name (a variable, `P#1`). For a
   * local call (`local`), the key of the line's own program once `indexPrograms` has
   * placed it (null from `callOn`, and where that program has no name).
   */
  key: ProgramKey | null;
  /** The word or name as written (`'P1000'`, `'<SHAFT_T12>'`), for the result rows; `''` for a local call. */
  text: string;
  /**
   * P4.19 (§7 row): the call rule fired without its word and without a name, and with its
   * `localAddress` word, so the line calls the program it stands in (Fanuc `M98 Q30`, the
   * local call; narrowed by the P4d review NC-1).
   */
  local?: true;
  /** P4d review NC-2: a rule that fired is an interrupt (`CallRule.interrupt`, `M96 P2000`). */
  interrupt?: true;
  /**
   * Wave Y geometry fix G5 (§7 row): a rule that fired runs its program from an external device
   * (`CallRule.external`, Fanuc `M198 P2000`). The program of the document with that number is not
   * what a block reference on the line names (`targetProgramOf`, `possibleProgramsOf`, the other
   * documents). It still counts as a caller for the returns of that program (owner 2026-10-20).
   */
  external?: true;
}

/**
 * P4d review NC-1: the rows a local call runs — from the block it names to the first line
 * from there on where a `caller` reference rule's trigger matches (the return, `M99`), both
 * included, inside one program.
 */
export interface LocalPart {
  from: number;
  to: number;
}

/** The programs of a file, and who calls whom. */
export interface ProgramIndex {
  /** One entry per segment of the scan, in order. */
  programs: readonly ProgramInfo[];
  /** Program key → the segments that carry it; more than one means the name is not unique. */
  byKey: ReadonlyMap<ProgramKey, readonly number[]>;
  /** Row of the scan → the program that line calls. Only rows with a call. */
  calls: ReadonlyMap<number, CallTarget>;
  /**
   * Program key → the segments with at least one line that calls it, without repeats, in
   * order. A local call and an interrupt are not in it (P4d review NC-1, NC-2): see
   * `localParts` and `interrupted`.
   */
  callers: ReadonlyMap<ProgramKey, readonly number[]>;
  /**
   * P4.19 (§7 row): the segments with at least one call this run cannot name (`M98 P#1`),
   * without repeats, in order. Such a program may call any program of the file, so
   * `caller` counts it beside a program's known callers (it proves no call on its own).
   */
  unknownCallers: readonly number[];
  /**
   * P4d review NC-1: segment → the parts its local calls run, in the order of the calls;
   * null for a call whose part cannot be found. Only segments with a local call.
   */
  localParts: ReadonlyMap<number, readonly (LocalPart | null)[]>;
  /** P4d review NC-2: program key → the segments with an interrupt that starts it (`M96 P2000`). */
  interrupted: ReadonlyMap<ProgramKey, readonly number[]>;
  /** P4d review NC-2: the segments with an interrupt whose program this run cannot name (`M96 P#1`). */
  unknownInterrupts: readonly number[];
}

/**
 * Why a reference's program cannot be told (§6.6 rule 10). Each becomes a result row of
 * its own (`ncNumbering.renumber.reference<Reason>Row`).
 *
 *  - `noCall`: a `called` reference whose line calls no program this run can name.
 *  - `notInFile`: the program it calls is not in this file.
 *  - `programTwice`: two programs of this file carry that name — the called one, or (P4.19,
 *    §7 row) for a `caller` reference the program it stands in, whose callers then cannot
 *    be told apart.
 *  - `noCaller`: no program of this file calls the program the `caller` reference stands
 *    in, or that program has no name (a main program, or a subprogram called from another
 *    file: `M99 P` in a main program jumps inside it, in a subprogram it returns to the
 *    caller, and which one this is cannot be read from the file).
 *  - `callers`: more than one program of this file calls it (or may: `unknownCallers`, a
 *    local call whose part cannot be found).
 *  - `interrupt` (P4d review NC-2): an interrupt of this file may start the program the
 *    `caller` reference stands in, and an interrupt returns into whichever program it
 *    interrupted.
 */
export type TargetRefusal = 'noCall' | 'notInFile' | 'programTwice' | 'noCaller' | 'callers' | 'interrupt';

/** The program whose blocks a reference is resolved in, or why there is none. */
export type TargetProgram = { segment: number } | { refused: TargetRefusal; key: ProgramKey | null };

/** Above this many digits a name of digits is kept as text: a JavaScript number no longer holds it exactly. */
const MAX_NUMBER_DIGITS = 15;

const DIGITS = /^\d+$/;

/**
 * The key of a program name, or null when the text is no name (§6.6 rule 8).
 *
 * Digits are a number where the dialect compares block numbers as numbers (`'0100'` is
 * 100, the program `M98 P100` calls); everything else, and digits on a dialect whose
 * sequence numbers are names (Okuma), is the upper-case text. A name of more digits than a
 * number holds exactly is its digits without the leading zeros, as text.
 */
export function programKeyOf(name: string, cp: CompiledProfile): ProgramKey | null {
  const text = name.trim();
  if (text === '') return null;
  if (DIGITS.test(text) && !comparesByText(cp)) {
    const digits = text.replace(/^0+(?=\d)/, '');
    return digits.length <= MAX_NUMBER_DIGITS ? Number(digits) : digits;
  }
  return text.toUpperCase();
}

/** The name a `program.start` pattern reads from `text` (its `name` group), or null. */
function startNameOf(text: string, cp: CompiledProfile): string | null {
  for (const re of cp.re.programStart) {
    const match = re.exec(text);
    if (match === null) continue;
    const name = match.groups?.name;
    return typeof name === 'string' && name !== '' ? name : null;
  }
  return null;
}

type CallRuleCompiled = NonNullable<CompiledProfile['re']['calls']>[number];

/** The words of `address` on the line (upper case compared). */
function wordsOf(tokens: readonly NcToken[], address: string): NcToken[] {
  const upper = address.toUpperCase();
  return tokens.filter((token) => token.kind === 'word' && token.address !== undefined && token.address.toUpperCase() === upper);
}

/**
 * What one rule that fired reads from the line: a target, or null when it calls nothing —
 * it fired without its word and without a name, and it has no `localAddress` word on the
 * line (P4d review NC-1: a bare `M96` or `G65` is no call, only `M98 Q30` is a local one).
 */
function callOfRule(rule: CallRuleCompiled, tokens: readonly NcToken[], masked: string, cp: CompiledProfile): CallTarget | null {
  const match = rule.trigger.exec(masked);
  const after = match === null ? 0 : match.index + match[0].length;
  const address = rule.address.toUpperCase();
  const repeat = rule.repeatAddress?.toUpperCase() ?? null;
  const interrupt: { interrupt?: true; external?: true } = {
    ...(rule.interrupt === true ? { interrupt: true as const } : {}),
    ...(rule.external === true ? { external: true as const } : {}),
  };
  const candidates: NcToken[] = [];
  let repeated = false;
  for (const token of tokens) {
    if (token.kind === 'word' && token.address !== undefined) {
      const upper = token.address.toUpperCase();
      if (upper === address) candidates.push(token);
      else if (repeat !== null && upper === repeat) repeated = true;
    } else if (token.kind === 'programMarker' && token.start >= after && token.text.trim() !== '') {
      // A program name behind the call word (`M98 <SHAFT_T12>`); one at the head of the
      // line is the program's own start, not what it calls.
      candidates.push(token);
    }
  }
  if (candidates.length === 0) {
    const local = rule.localAddress ?? null;
    if (local === null || wordsOf(tokens, local).length === 0) return null;
    return { key: null, text: '', local: true, ...interrupt };
  }
  if (candidates.length > 1) return { key: null, text: candidates.map((token) => token.text).join(' '), ...interrupt };
  const token = candidates[0];
  if (token.kind === 'programMarker') {
    const name = startNameOf(token.text, cp);
    return { key: name === null ? null : programKeyOf(name, cp), text: token.text, ...interrupt };
  }
  const value = token.valueText ?? '';
  if (!DIGITS.test(value) || value.length > MAX_TARGET_DIGITS) return { key: null, text: token.text, ...interrupt };
  // Fanuc's packed word (the 30i manuals): up to `maxDigits` digits are the program; a
  // longer value is a repeat count followed by a program of `maxDigits` digits — unless
  // the block carries the repeat word, which a program of more digits needs for its count.
  const program = rule.maxDigits !== null && !repeated && value.length > rule.maxDigits ? value.slice(-rule.maxDigits) : value;
  return { key: programKeyOf(program, cp), text: token.text, ...interrupt };
}

/** True when two targets name the same call. */
function sameCall(a: CallTarget, b: CallTarget): boolean {
  if (a.local === true || b.local === true) return a.local === b.local;
  return a.key !== null && a.key === b.key;
}

/**
 * The program this line calls under `numbering.calls`, or null when no call rule fires
 * (or every one that fires calls nothing, see `callOfRule`).
 *
 * `tokens` are the line's tokens (`tokenizeLine`); the triggers are tried on the line with
 * its comments blanked. Several rules that fire must agree on the program, or the call is
 * unknown (`key` null). The call is an interrupt when one of the rules is.
 */
export function callOn(tokens: readonly NcToken[], line: string, cp: CompiledProfile): CallTarget | null {
  const rules = cp.re.calls ?? [];
  if (rules.length === 0) return null;
  const masked = maskedOf(line, tokens as NcToken[]);
  const fired: CallTarget[] = [];
  for (const rule of rules) {
    if (!rule.trigger.test(masked)) continue;
    const call = callOfRule(rule, tokens, masked, cp);
    if (call !== null) fired.push(call);
  }
  if (fired.length === 0) return null;
  const first = fired[0];
  const interrupt = fired.some((call) => call.interrupt === true);
  const external = fired.every((call) => call.external === true);
  const merged: CallTarget = fired.every((call) => sameCall(first, call))
    ? { ...first }
    : { key: null, text: fired.map((call) => call.text).filter((text) => text !== '').join(' ') };
  delete merged.interrupt;
  delete merged.external;
  if (interrupt) merged.interrupt = true;
  // Only when every rule that fired is external; one that is not still names a program of the file.
  if (external) merged.external = true;
  return merged;
}

/** Appends `value` to the list under `key` unless the list holds it already. */
function addOnce<K>(map: Map<K, number[]>, key: K, value: number): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else if (!list.includes(value)) list.push(value);
}

/**
 * P4d review NC-1: the rows of the scan where a `caller` reference rule's trigger matches
 * the comment-masked line (the returns, `M99`), in order. Read only for a file with a local
 * call.
 */
function returnRows(scan: ProgramScan, cp: CompiledProfile): number[] {
  const triggers = cp.re.references.filter((_rule, i) => ruleProgram(cp, i) === 'caller').map((rule) => rule.trigger);
  if (triggers.length === 0) return [];
  const stateful = cp.profile.syntax?.continuation !== undefined;
  const rows: number[] = [];
  let state: LineState | undefined;
  for (let row = 0; row < scan.scanned.length; row++) {
    const line = scan.scanned[row];
    if (!stateful && !triggers.some((re) => re.test(line))) continue;
    const { tokens, state: next } = tokenizeLine(line, cp, state);
    if (stateful) state = next;
    const masked = maskedOf(line, tokens);
    if (triggers.some((re) => re.test(masked))) rows.push(row);
  }
  return rows;
}

/** The first entry of the sorted `rows` at or after `row`, or -1. */
function firstAtOrAfter(rows: readonly number[], row: number): number {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid] < row) lo = mid + 1;
    else hi = mid;
  }
  return lo < rows.length ? rows[lo] : -1;
}

/**
 * P4d review NC-1: the part a local call runs, or null when it cannot be found — the block
 * its word names is missing or there twice in its program (or the value is no block number),
 * or no return follows it inside the program.
 */
function localPartOf(scan: ProgramScan, segment: number, value: string | null, returns: readonly number[]): LocalPart | null {
  if (value === null) return null;
  const key = blockKeyOf(value, scan.byText);
  if (key === null) return null;
  const site = scan.segments[segment]?.get(key);
  if (site === undefined || site.count !== 1) return null;
  const to = firstAtOrAfter(returns, site.row);
  if (to < 0 || scan.segmentOf[to] !== segment) return null;
  return { from: site.row, to };
}

/**
 * The block a local call on this line names: the digits of the one `localAddress` word of
 * the first local rule that fires, or null (several such words, or a variable).
 */
function localValueOf(tokens: readonly NcToken[], line: string, cp: CompiledProfile): string | null {
  const masked = maskedOf(line, tokens as NcToken[]);
  for (const rule of cp.re.calls ?? []) {
    if (rule.localAddress === null || rule.localAddress === undefined || !rule.trigger.test(masked)) continue;
    const words = wordsOf(tokens, rule.localAddress);
    if (words.length !== 1) return null;
    const value = words[0].valueText ?? '';
    return DIGITS.test(value) ? value : null;
  }
  return null;
}

/**
 * The programs of the scanned file and the calls between them. Reads `scan.scanned` once
 * more with the tokenizer, only where a call rule's trigger can match (every line on a
 * dialect with continuation lines, whose state the next line needs), and once more where
 * the file has a local call, for its returns.
 */
export function indexPrograms(scan: ProgramScan, cp: CompiledProfile): ProgramIndex {
  const programs: ProgramInfo[] = scan.segments.map((_, segment) => ({ segment, row: 0, name: null, key: null }));
  // Segments are numbered in row order, so the first row of each is where its number first shows.
  let last = -1;
  for (let row = 0; row < scan.segmentOf.length; row++) {
    const segment = scan.segmentOf[row];
    if (segment === last) continue;
    last = segment;
    if (programs[segment] !== undefined) programs[segment].row = row;
  }

  const byKey = new Map<ProgramKey, number[]>();
  if (cp.re.programStart.length > 0) {
    for (const program of programs) {
      const line = scan.scanned[program.row];
      if (line === undefined) continue;
      const masked = maskedOf(line, tokenizeLine(line, cp).tokens);
      const name = startNameOf(masked, cp);
      if (name === null) continue;
      program.name = name;
      program.key = programKeyOf(name, cp);
      if (program.key !== null) addOnce(byKey, program.key, program.segment);
    }
  }

  const calls = new Map<number, CallTarget>();
  const callers = new Map<ProgramKey, number[]>();
  const unknown = new Set<number>();
  const interrupted = new Map<ProgramKey, number[]>();
  const unknownInterrupts = new Set<number>();
  const localCalls: { segment: number; value: string | null }[] = [];
  const rules = cp.re.calls ?? [];
  if (rules.length > 0) {
    const stateful = cp.profile.syntax?.continuation !== undefined;
    let state: LineState | undefined;
    for (let row = 0; row < scan.scanned.length; row++) {
      const line = scan.scanned[row];
      if (!stateful && !rules.some((rule) => rule.trigger.test(line))) continue;
      const { tokens, state: next } = tokenizeLine(line, cp, state);
      if (stateful) state = next;
      const call = callOn(tokens, line, cp);
      if (call === null) continue;
      const segment = scan.segmentOf[row];
      if (call.local === true) {
        // The local call runs a part of its own program; it makes the program no caller of
        // itself as a whole, only of the returns inside that part (NC-1).
        calls.set(row, { ...call, key: programs[segment]?.key ?? null });
        localCalls.push({ segment, value: localValueOf(tokens, line, cp) });
        continue;
      }
      calls.set(row, call);
      if (call.interrupt === true) {
        // An interrupt never proves a caller (NC-2).
        if (call.key === null) unknownInterrupts.add(segment);
        else addOnce(interrupted, call.key, segment);
        continue;
      }
      if (call.key === null) unknown.add(segment);
      else addOnce(callers, call.key, segment);
    }
  }

  const localParts = new Map<number, (LocalPart | null)[]>();
  if (localCalls.length > 0) {
    const returns = returnRows(scan, cp);
    for (const { segment, value } of localCalls) {
      const part = localPartOf(scan, segment, value, returns);
      const list = localParts.get(segment);
      if (list === undefined) localParts.set(segment, [part]);
      else list.push(part);
    }
  }

  const sorted = (set: Set<number>): number[] => [...set].sort((a, b) => a - b);
  return {
    programs,
    byKey,
    calls,
    callers,
    unknownCallers: sorted(unknown),
    localParts,
    interrupted,
    unknownInterrupts: sorted(unknownInterrupts),
  };
}

/**
 * P4d review NC-1: what the local calls of the program `row` stands in say about a return
 * on that row — `inside` a part one of them runs (proved: the return goes back into this
 * program), `maybe` (a local call whose part cannot be found may end here), or null.
 */
export function localReturnOf(scan: ProgramScan, index: ProgramIndex, row: number): 'inside' | 'maybe' | null {
  const parts = index.localParts.get(scan.segmentOf[row]);
  if (parts === undefined) return null;
  let maybe = false;
  for (const part of parts) {
    if (part === null) maybe = true;
    else if (part.from <= row && row <= part.to) return 'inside';
  }
  return maybe ? 'maybe' : null;
}

/** P4d review NC-2: true when an interrupt of the file may start the program `key` names. */
export function interruptMayStart(index: ProgramIndex, key: ProgramKey | null): boolean {
  if (index.unknownInterrupts.length > 0) return true;
  return key !== null && (index.interrupted.get(key)?.length ?? 0) > 0;
}

/**
 * The program a reference on `row` names a block of (§6.6 rule 10): its own for `own`, the
 * one its line calls for `called`, the one that calls its program for `caller`.
 *
 * The answer for `own` is the behaviour of M6 and stays exactly that.
 */
export function targetProgramOf(scan: ProgramScan, index: ProgramIndex, row: number, word: ReferenceWord): TargetProgram {
  const own = scan.segmentOf[row];
  if (word.program === 'own') return { segment: own };

  if (word.program === 'called') {
    const call = index.calls.get(row);
    if (call === undefined) return { refused: 'noCall', key: null };
    // A local call runs a part of the line's own program.
    if (call.local === true) return { segment: own };
    if (call.key === null) return { refused: 'noCall', key: null };
    // An external call runs a program from a device, not the program of the file with that number.
    if (call.external === true) return { refused: 'notInFile', key: call.key };
    const carriers = index.byKey.get(call.key) ?? [];
    if (carriers.length === 0) return { refused: 'notInFile', key: call.key };
    if (carriers.length > 1) return { refused: 'programTwice', key: call.key };
    return { segment: carriers[0] };
  }

  const key = index.programs[own]?.key ?? null;
  if (key === null) return { refused: 'noCaller', key: null };
  // Two programs of that name: which of them a call runs, and so whose caller is meant,
  // cannot be told.
  if ((index.byKey.get(key)?.length ?? 0) > 1) return { refused: 'programTwice', key };
  // An interrupt returns into whichever program it interrupted (NC-2).
  if (interruptMayStart(index, key)) return { refused: 'interrupt', key };
  const local = localReturnOf(scan, index, row);
  // The callers this file proves: the programs that call this one, and this one itself
  // where the return ends a part a local call of it runs (NC-1).
  const proved = new Set<number>(index.callers.get(key) ?? []);
  if (local === 'inside') proved.add(own);
  // A call through a variable is no proof that a program calls this one, but it may: it
  // makes a known caller one of several. So does a local call whose part is not known.
  if (proved.size === 0) return { refused: 'noCaller', key };
  const possible = new Set<number>(proved);
  for (const segment of index.unknownCallers) possible.add(segment);
  if (local === 'maybe') possible.add(own);
  if (possible.size > 1) return { refused: 'callers', key };
  return { segment: [...proved][0] };
}

/**
 * P4d review NC-3: the programs a `caller` or `called` reference the file cannot resolve
 * may still name a block of, so a run that renumbers one of them can say so about a
 * reference outside its lines. Null where that is any program of the file (an unknown
 * call, an interrupt); an empty list where it is none of them (`notInFile`).
 */
export function possibleProgramsOf(scan: ProgramScan, index: ProgramIndex, row: number, word: ReferenceWord): readonly number[] | null {
  const own = scan.segmentOf[row];
  if (word.program === 'own') return [own];
  if (word.program === 'called') {
    const call = index.calls.get(row);
    if (call === undefined || call.local === true) return [own];
    if (call.key === null) return null;
    if (call.external === true) return [];
    return index.byKey.get(call.key) ?? [];
  }
  const key = index.programs[own]?.key ?? null;
  if (interruptMayStart(index, key)) return null;
  // The return may jump inside its own program (a main program, or one started as one),
  // or return into any program that calls it or may.
  const possible = new Set<number>([own]);
  if (key !== null) {
    for (const segment of index.callers.get(key) ?? []) possible.add(segment);
    for (const segment of index.unknownCallers) possible.add(segment);
  }
  return [...possible].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// What a renumber did, for the other open documents (§6.6 rules 11–13; P4.18 fills it,
// P4.20 reads it)
// ---------------------------------------------------------------------------

/** One named program of the renumbered document, and what the run did to its block numbers. */
export interface RenumberedProgram {
  name: string;
  key: ProgramKey;
  /**
   * Block key before the run → the digits that block carries after it, as written (`'20'`,
   * `'0020'`), or null when the run removed the number (`everyNth`). Only blocks whose key
   * changed; a block that kept its number is not in it.
   */
  changed: ReadonlyMap<BlockKey, string | null>;
  /** Keys that name a block of the program after the run and named none before it. */
  created: ReadonlySet<BlockKey>;
  /**
   * Keys that more than one block of the program carries after the run, and (P4d review
   * CODE-10) keys that more than one carried before it where the run changed one of them:
   * a value that names one of them names no one block.
   */
  duplicated: ReadonlySet<BlockKey>;
}

/**
 * `TransformResult.renumbered`: every **named** program of the document in which the run
 * changed a block number (a program without a name cannot be called from elsewhere). Absent
 * on a run that changed no number, and on the consecutive dialect (Klartext has no
 * block-number references, §6.6 rule 7).
 */
export interface RenumberOutcome {
  /** `ProgramScan.byText`: block keys are the written digits, not numbers. */
  byText: boolean;
  /** The block prefix the run writes (`'N'`), for the result rows. */
  prefix: string;
  programs: readonly RenumberedProgram[];
}
