// Block numbers for lines that are typed or inserted (Phase 4 plan §6.5 rules 2, 3 and 9). Pure functions,
// no Monaco and no stores. P4.12 wrote the bodies; P4.14's Insert File and Append File reuse them, so the
// two never carry two numbering rules.
//
// `renumber.ts` of the NC tab is a different thing (a whole selection or document, every option of P4d); this
// module answers only "how is the number of one new line written" and "what do the blocks below become when
// the control wants consecutive numbers" (`numbering.mode: 'consecutive'`, Klartext). It does not call
// `renumber.ts`.
//
// Everything reads lines through a `LineReader`, one line at a time, so a 300,000-line program costs what
// the lines below the edit cost, and the walk stops as soon as the limit is passed.

import type { CompiledProfile } from '$lib/core/profiles/types';
import { maskComments } from './mask';
import { blockHeadReader, blockNumberOf, lexSpec } from './tokenizer';

/** The text of 1-based line `n` ('' past the end); the caller reads from the model without copying it all. */
export type LineReader = (line: number) => string;

/**
 * One edit of a line's text, in 1-based UTF-16 columns as Monaco takes them. A line that has a block number
 * has its digits replaced (`startColumn` to `endColumn` cover the digits only: the prefix, a main-block
 * prefix, a block-skip mark and the blanks after the number stay as written); a line that has none gets
 * the number inserted (`startColumn === endColumn`). `consecutiveRenumbering` only ever replaces digits.
 */
export interface NumberEdit {
  line: number;
  startColumn: number;
  endColumn: number;
  text: string;
}

/** The largest number a profile's block may carry: `numbering.max`, or no limit of its own. */
export function maxBlockNumber(cp: CompiledProfile): number {
  const max = cp.profile.numbering?.max;
  return typeof max === 'number' && Number.isFinite(max) && max >= 0 ? max : Number.MAX_SAFE_INTEGER;
}

/** `value` as digits, zero-padded to `numbering.digits` (0 or absent: no padding). */
function digitsOf(value: number, cp: CompiledProfile): string {
  const digits = cp.profile.numbering?.digits;
  const text = String(value);
  return typeof digits === 'number' && digits > text.length ? text.padStart(digits, '0') : text;
}

/** A whole number from 0 to the profile's maximum. */
function fits(value: number, cp: CompiledProfile): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= maxBlockNumber(cp);
}

/**
 * The block number as it is written in a new line: the profile's `blockNumber.prefix` (never an `altPrefix`,
 * never the main-block prefix, rule 2; none for a `leading-integer` profile such as Klartext), `value`
 * zero-padded to `numbering.digits`, then `numbering.spacesAfter` blanks (default 1). `null` when `value` is
 * not a whole number from 0 to `numbering.max`, or the profile numbers with a prefix it does not name.
 */
export function formatBlockNumber(value: number, cp: CompiledProfile): string | null {
  if (!fits(value, cp)) return null;
  const spec = cp.profile.syntax.blockNumber;
  let prefix = '';
  if (spec.mode === 'prefix') {
    if (typeof spec.prefix !== 'string' || spec.prefix === '') return null;
    prefix = spec.prefix;
  }
  const after = cp.profile.numbering?.spacesAfter;
  const spaces = typeof after === 'number' && Number.isInteger(after) && after >= 0 ? Math.min(after, 16) : 1;
  return prefix + digitsOf(value, cp) + ' '.repeat(spaces);
}

/** The block number without the blanks behind it, as a message names it (`N120`, Klartext `12`). */
export function blockNumberLabel(value: number, cp: CompiledProfile): string {
  const spec = cp.profile.syntax.blockNumber;
  const prefix = spec.mode === 'prefix' && typeof spec.prefix === 'string' ? spec.prefix : '';
  return prefix + digitsOf(value, cp);
}

export type ConsecutiveAnswer =
  | { ok: true; edits: NumberEdit[]; last: number }
  | { ok: false; reason: 'tooMany' | 'overflow' };

/**
 * True when `line`, outside its comments, matches one of `patterns`. The line is masked only when a pattern
 * matches it as written (masking only blanks text out, so a line that does not match as written has no match
 * outside its comments either, short of a comment written between `END` and `PGM`, which no control reads as
 * the end). A walk over 5,000 lines then masks almost none of them: half the cost of the walk.
 */
function matchesOutsideComments(line: string, patterns: readonly RegExp[], cp: CompiledProfile): boolean {
  if (line === '' || !anyMatches(line, patterns)) return false;
  return anyMatches(maskComments(line, cp), patterns);
}

/** True when one of `patterns` matches `text` (a loop, not `some`: this runs for every line of a walk below the cursor). */
function anyMatches(text: string, patterns: readonly RegExp[]): boolean {
  for (let i = 0; i < patterns.length; i++) {
    const re = patterns[i];
    re.lastIndex = 0;
    if (re.test(text)) return true;
  }
  return false;
}

/** True when `line` closes the program (`cp.re.programEnd` outside a comment: Klartext `END PGM`). */
export function isProgramEndLine(line: string, cp: CompiledProfile): boolean {
  return matchesOutsideComments(line, cp.re.programEnd, cp);
}

/** True when `line` opens a program (`cp.re.programStart` outside a comment: Klartext `BEGIN PGM`). */
export function isProgramStartLine(line: string, cp: CompiledProfile): boolean {
  return matchesOutsideComments(line, cp.re.programStart, cp);
}

/** True when `line` continues the block above by its leading mark (`syntax.continuationStart`, Okuma `$`). */
export function startsAsContinuation(line: string, cp: CompiledProfile): boolean {
  const re = cp.re.continuationStart;
  if (!re) return false;
  re.lastIndex = 0;
  return re.test(line);
}

/**
 * True when `line` is a lone tape mark: a `%` with nothing but blanks around it, in a profile whose `%` at the
 * head of a line is the tape mark (`syntax.tapeMarker`; Klartext has none). The first one opens the tape, and
 * the control reads nothing behind the one that closes it (Fanuc, Okuma).
 */
export function isLoneTapeMark(line: string, cp: CompiledProfile): boolean {
  return line.length > 0 && line.trim() === '%' && lexSpec(cp).tapeMarker;
}

/**
 * True when `line` is the profile's program header as written (`syntax.header`: Okuma `$NAME.MIN%`, Sinumerik
 * `%_N_NAME_MPF`), the line that names the program before its first block. Not a `cp.re.programStart` line by
 * itself in every profile (Okuma's header is none), so a caller that looks for the line a program starts with
 * asks both.
 */
export function isProgramHeaderLine(line: string, cp: CompiledProfile): boolean {
  const re = cp.re.header;
  if (!re || line === '') return false;
  re.lastIndex = 0;
  return re.test(line);
}

/** True when `line` ends with the continuation marker (`syntax.continuation`, Klartext `~`), so the next line is its tail. */
export function endsWithContinuation(line: string, cp: CompiledProfile): boolean {
  const re = cp.re.continuation;
  if (!re) return false;
  re.lastIndex = 0;
  return re.test(line);
}

/**
 * Consecutive numbering (Klartext): the numbered blocks from `fromLine` to the program end (`cp.re.programEnd`'s
 * line included, or the last line) are numbered `firstNumber`, `firstNumber + 1`, … in order. A line that
 * continues a block (the line above ends with the continuation marker, or it starts with
 * `syntax.continuationStart`), a line without a block number (a comment line, a blank line) and a program
 * start (`BEGIN PGM`, block 0, which also ends the walk: it belongs to the next program) keep what they
 * have. `last` is the number of the last block (`firstNumber - 1` when there is none). Only the lines whose
 * number changes are edited, digits only. `tooMany` when more than `maxLines` lines would change (typing
 * stays inside the frame budget; the caller says so and leaves the program alone), `overflow` when a number
 * would pass `numbering.max`. The walk reads one line at a time and stops at the first refusal.
 *
 * Cost (P4c): the walk is the work of an Enter near the 5,000-line limit, so a line takes the cheapest reading
 * that gives the head's answer. The tail of a block is not read for a head at all; a Klartext block (digits at
 * column 1) is read by a digit scan (`leadingIntegerOf`); every other line takes the general reading of its head.
 * `blockNumbering.equality.test.ts` holds the scan to the general reading on random programs and the fixtures.
 */
export function consecutiveRenumbering(
  read: LineReader,
  lineCount: number,
  fromLine: number,
  firstNumber: number,
  cp: CompiledProfile,
  maxLines: number,
): ConsecutiveAnswer {
  const head = blockHeadReader(cp);
  const lead = leadingIntegerOf(cp);
  const continuation = cp.re.continuation ?? null;
  const max = maxBlockNumber(cp);
  const padTo = typeof cp.profile.numbering?.digits === 'number' ? cp.profile.numbering.digits : 0;
  const edits: NumberEdit[] = [];
  let next = firstNumber;
  const start = Math.max(1, fromLine);
  // The line above the first one tells whether the first one is the tail of a block.
  let prevContinues = start > 1 && start - 1 <= lineCount ? endsWithContinuation(read(start - 1), cp) : false;
  for (let line = start; line <= lineCount; line++) {
    const text = read(line);
    const tail = prevContinues || startsAsContinuation(text, cp);
    if (tail) {
      // The tail of a block keeps what it has; only whether it ends with the marker matters (the walk's
      // answer to the line below), not the head of a line that is not read.
      prevContinues = continuation !== null && continuation.exec(text) !== null;
      continue;
    }
    // Where the block number's digits stand in the line (`from` to `to`, 0-based), or -1 when it has none.
    let from = -1;
    let to = -1;
    let found = false;
    if (lead !== null && text.length > 0 && isDigitCode(text.charCodeAt(0))) {
      // The shape of nearly every numbered Klartext block (digits at column 1): a digit scan reads it as
      // `blockHeadOf` and `blockNumberOf` do (see `leadingIntegerOf`), without their objects.
      let limit = text.length;
      const cut = continuation === null ? null : continuation.exec(text);
      prevContinues = cut !== null;
      if (cut !== null) limit = cut.index;
      let i = 1;
      while (i < text.length && isDigitCode(text.charCodeAt(i))) i++;
      if (i < limit) {
        const after = text.charCodeAt(i);
        if (isBlankCode(after) || (lead.afterSkip !== null && lead.afterSkip.includes(after))) {
          from = 0;
          to = i;
        }
        found = true;
      } else if (limit === text.length) {
        from = 0;
        to = i;
        found = true;
      }
    }
    if (!found) {
      // Any other line: the general reading of the head.
      const info = head(text, prevContinues);
      prevContinues = info.continues;
      if (info.number !== null) {
        const at = blockNumberOf(text, cp);
        if (at !== null && at.text === info.number) {
          from = at.end - at.text.length;
          to = at.end;
        }
      }
    }
    if (isProgramStartLine(text, cp)) break;
    if (from >= 0) {
      if (!Number.isSafeInteger(next) || next < 0 || next > max) return { ok: false, reason: 'overflow' };
      let digits = String(next);
      if (padTo > digits.length) digits = digits.padStart(padTo, '0');
      if (digits.length !== to - from || !text.startsWith(digits, from)) {
        if (edits.length >= maxLines) return { ok: false, reason: 'tooMany' };
        edits.push({ line, startColumn: from + 1, endColumn: to + 1, text: digits });
      }
      next++;
    }
    if (isProgramEndLine(text, cp)) break;
  }
  return { ok: true, edits, last: next - 1 };
}

// -- the digit scan of `consecutiveRenumbering` ---------------------------------------------

/** What the digit scan needs of a profile that numbers by a leading integer (Klartext). */
interface LeadingInteger {
  /** The block-skip marks that may stand behind the number in place of a blank, or null. */
  afterSkip: readonly number[] | null;
}

const LEADING_INTEGER = new WeakMap<CompiledProfile, LeadingInteger | null>();

/**
 * The digit scan applies to a profile whose block number is a leading integer, with no `syntax.header`, no
 * `syntax.labels`, no sequence names and no block-skip mark that is a digit. For a line that starts with a
 * digit, `blockHeadOf` then reads: no header, no skip before the number, no label, no name, the digits as the
 * number when the block starts behind them (a blank, or a skip mark `skip.after` allows, or the end of the
 * text), and `blockNumberOf` reads the same digits. Anything else takes the general reading.
 */
function leadingIntegerOf(cp: CompiledProfile): LeadingInteger | null {
  let lead = LEADING_INTEGER.get(cp);
  if (lead === undefined) {
    const spec = lexSpec(cp);
    const digitSkip = spec.skip !== null && spec.skip.codes.some((code) => code >= 0x30 && code <= 0x39);
    lead =
      spec.blockNumberMode === 'leading-integer' && !spec.header && !spec.labels && !spec.sequenceNames && !digitSkip
        ? { afterSkip: spec.skip !== null && spec.skip.after ? spec.skip.codes : null }
        : null;
    LEADING_INTEGER.set(cp, lead);
  }
  return lead;
}

function isDigitCode(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

/** The blanks of the tokenizer: space, tab, vertical tab, form feed and the no-break space. */
function isBlankCode(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0b || code === 0x0c || code === 0xa0;
}

/** The most lines one Enter or one Insert File may renumber below it (§6.5 rule 3). */
export const MAX_RENUMBER_LINES = 5000;

