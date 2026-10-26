// Automatic block number on Enter (Phase 4 plan §6.5 rules 2 and 3; `editing.autoNumber`). Pure, no Monaco and
// no stores: `contrib/typing.ts` reads the key and the editor, asks this, and applies the answer as one undo
// step with the line break.
//
// What is numbered. Plain Enter with the cursor at the end of the line's text (the contrib checks the key, the
// single cursor and the empty selection; this checks the column). The base block is the cursor's line, or the
// head of the block that line continues. A base block without a number, a base line that is nothing but its
// number, a cursor line that ends with the continuation marker (the new line would be its tail), and a cursor
// block whose next line continues it by its leading mark (Okuma `$`: a numbered line in between would take
// that tail over) are a plain Enter: **a line that continues a block is never numbered**.
//
// Free numbering: `base + step`, below the ceiling (the first numbered block below within
// `AUTONUMBER_LOOKAHEAD` lines whose number is not smaller than the base), else the number halfway between, else
// `noGap`; never above `numbering.max` (`overflow`; typing never wraps, only Renumber does). Consecutive
// numbering (Klartext): `base + 1`, and the blocks below take new numbers in the same edit
// (`consecutiveRenumbering`), at most `MAX_RENUMBER_LINES` of them (`tooManyBelow`); not in a channel pane
// (`inPane`), where the blocks below belong to the other channels as well; and not on the program end line
// (`END PGM`), a plain Enter, because a block after it is outside the program.
//
// Cost: the cursor's line, at most `AUTONUMBER_LOOKAHEAD` lines up to the block's head and down to the
// ceiling, and in consecutive mode the lines down to the program end or the limit. No whole-text copy.

import type { CompiledProfile } from '$lib/core/profiles/types';
import {
  MAX_RENUMBER_LINES,
  consecutiveRenumbering,
  endsWithContinuation,
  formatBlockNumber,
  isProgramEndLine,
  maxBlockNumber,
  startsAsContinuation,
  type LineReader,
  type NumberEdit,
} from './blockNumbering';
import { blockHeadReader } from './tokenizer';

/** Where Enter was pressed, as much as the rules need (1-based lines and UTF-16 columns, as Monaco). */
export interface AutoNumberInput {
  /** The cursor's line and column; the selection is empty (a selection is a plain Enter). */
  line: number;
  column: number;
  lineCount: number;
  read: LineReader;
  /** Enter in a channel pane (§6.5 rule 3): the blocks below are the pane's own lines only. */
  inPane?: boolean;
}

/** Why a new line stays without a number although the profile asks for one (the status bar says it). */
export type AutoNumberRefusal =
  /** No number fits between the block above and the next one (`between` is that pair). */
  | { reason: 'noGap'; between: [number, number] }
  /** The next number would pass `numbering.max`. */
  | { reason: 'overflow'; max: number }
  /** Consecutive numbering: more than `MAX_RENUMBER_LINES` blocks below would have to change. */
  | { reason: 'tooManyBelow'; limit: number }
  /** Consecutive numbering in a channel pane: the other channels' blocks would have to follow. */
  | { reason: 'inPane' };

export type AutoNumberAnswer =
  /** Enter as the editor does it, and nothing said (a line the rules do not number, or the cursor not at the end). */
  | { kind: 'plain' }
  /** Type `\n` + `text`; `shifts` are the blocks below that take a new number in the same edit (consecutive mode). */
  | { kind: 'number'; text: string; number: number; shifts: NumberEdit[] }
  /** Enter as usual, with `AutoNumberRefusal` said in the status bar. */
  | ({ kind: 'none' } & AutoNumberRefusal);

/** How far below the new line the next numbered block is looked for, and how far up the head of a block. */
export const AUTONUMBER_LOOKAHEAD = 100;

const PLAIN: AutoNumberAnswer = { kind: 'plain' };

/** The answer for Enter at `input`. */
export function decideAutoNumber(input: AutoNumberInput, cp: CompiledProfile): AutoNumberAnswer {
  const { line, column, lineCount, read } = input;
  if (line < 1 || line > lineCount) return PLAIN;
  const text = read(line);
  // The cursor at the end of the line's text: only blanks after it.
  if (column < 1 || text.slice(column - 1).trim() !== '') return PLAIN;
  // The new line would be the tail of this one.
  if (endsWithContinuation(text, cp)) return PLAIN;
  // The next line continues this block by its leading mark: a numbered line in between would take it over.
  if (line < lineCount && startsAsContinuation(read(line + 1), cp)) return PLAIN;

  // The base block: this line, or the head of the block it continues.
  const base = blockBaseLine(read, line, cp);
  if (base === null) return PLAIN;
  const headOf = blockHeadReader(cp);
  const baseText = base === line ? text : read(base);
  const head = headOf(baseText, false);
  if (head.number === null) return PLAIN;
  // A line that is nothing but its number (an Enter after an automatic number nobody wrote a block behind).
  if (base === line && baseText.slice(head.end).trim() === '') return PLAIN;
  const baseNumber = Number.parseInt(head.number, 10);
  if (!Number.isSafeInteger(baseNumber)) return PLAIN;

  const max = maxBlockNumber(cp);
  if (cp.profile.numbering?.mode === 'consecutive') {
    // The program end (Klartext `END PGM`): a block after it is outside the program.
    if (isProgramEndLine(baseText, cp)) return PLAIN;
    if (input.inPane === true) return { kind: 'none', reason: 'inPane' };
    const number = baseNumber + 1;
    if (number > max) return { kind: 'none', reason: 'overflow', max };
    const formatted = formatBlockNumber(number, cp);
    if (formatted === null) return PLAIN;
    const below = consecutiveRenumbering(read, lineCount, line + 1, number + 1, cp, MAX_RENUMBER_LINES);
    if (!below.ok) {
      return below.reason === 'tooMany'
        ? { kind: 'none', reason: 'tooManyBelow', limit: MAX_RENUMBER_LINES }
        : { kind: 'none', reason: 'overflow', max };
    }
    return { kind: 'number', text: formatted, number, shifts: below.edits };
  }

  // Free numbering.
  const rawStep = cp.profile.numbering?.step;
  const step = typeof rawStep === 'number' && Number.isSafeInteger(rawStep) && rawStep > 0 ? rawStep : 1;
  const candidate = baseNumber + step;
  const ceiling = ceilingBelow(read, lineCount, line, baseNumber, cp, headOf);
  let number = candidate;
  if (ceiling !== null && candidate >= ceiling) {
    const between = baseNumber + Math.floor((ceiling - baseNumber) / 2);
    if (between <= baseNumber) return { kind: 'none', reason: 'noGap', between: [baseNumber, ceiling] };
    number = between;
  }
  if (number > max) return { kind: 'none', reason: 'overflow', max };
  const formatted = formatBlockNumber(number, cp);
  if (formatted === null) return PLAIN;
  return { kind: 'number', text: formatted, number, shifts: [] };
}

/**
 * The first line of the block that `line` belongs to: `line` itself, or, when it continues a block (the line
 * above ends with the continuation marker, or it starts with `syntax.continuationStart`), the head of that
 * block. Null when the head is not within `AUTONUMBER_LOOKAHEAD` lines above, or the first line of the text
 * continues something.
 */
export function blockBaseLine(read: LineReader, line: number, cp: CompiledProfile): number | null {
  let base = line;
  for (let up = 0; ; up++) {
    const continues = (base > 1 && endsWithContinuation(read(base - 1), cp)) || startsAsContinuation(read(base), cp);
    if (!continues) return base;
    if (base === 1 || up >= AUTONUMBER_LOOKAHEAD) return null;
    base--;
  }
}

/**
 * The number of the first numbered block below `line` within `AUTONUMBER_LOOKAHEAD` lines, when it is not smaller
 * than `base`; null otherwise (a smaller number is a restart, a subprogram or another program). An equal number is
 * a ceiling: nothing fits below it, so the answer is `noGap`, never a second copy of the number after it. Lines
 * without a number, comment lines and the tails of a block are passed over.
 */
function ceilingBelow(
  read: LineReader,
  lineCount: number,
  line: number,
  base: number,
  cp: CompiledProfile,
  headOf: ReturnType<typeof blockHeadReader>,
): number | null {
  const last = Math.min(lineCount, line + AUTONUMBER_LOOKAHEAD);
  // The cursor's line does not end with the continuation marker (`decideAutoNumber` checked it).
  let prevContinues = false;
  for (let n = line + 1; n <= last; n++) {
    const text = read(n);
    const tail = prevContinues || startsAsContinuation(text, cp);
    const head = headOf(text, prevContinues);
    prevContinues = head.continues;
    if (tail || head.number === null) continue;
    const value = Number.parseInt(head.number, 10);
    return Number.isSafeInteger(value) && value >= base ? value : null;
  }
  return null;
}
