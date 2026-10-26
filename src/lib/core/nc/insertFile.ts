// Insert File and Append File (Phase 4 plan §6.5 rule 8). Pure, no Monaco and no stores: `contrib/insertFile.ts`
// reads the file the way Open reads it, calls this with the text, and applies the answer as one undo step.
//
// The plan answers these questions:
// - Which lines of the file go in: a lone tape mark (`%`) of the file is left out, since it would open or close
//   the tape in the middle of the document; only an empty document takes the file as it is.
// - Where they go: before the cursor's line in column 1 with no selection, otherwise after it; Append after
//   the last line, before an empty last line and before a closing lone `%` or Klartext `END PGM`. Never
//   above or on the program's first lines (a leading `%`, the program-start line `O1000`, `%_N_…_MPF`,
//   `$NAME.MIN%`, `BEGIN PGM`): the lines go below them, unless the file starts a program of its own, which
//   then goes in front of the program-start line.
// - What the status bar warns of (the insert goes ahead): below the program end, below the `%` that ends the
//   tape, a program start or end of the file that lands where blocks of the program follow.
// - What is refused: a block of the file that would join a block of the document (a last line with `~`, a
//   first line with Okuma's `$`); with one program per file (Klartext) a program start or end in the file.
// - Which blocks take new numbers (Klartext: the inserted ones, numbered when they have none, comment lines too,
//   and those below, through `consecutiveRenumbering`; every other profile keeps the numbers it finds).

import type { CompiledProfile } from '$lib/core/profiles/types';
import {
  consecutiveRenumbering,
  formatBlockNumber,
  isLoneTapeMark,
  isProgramEndLine,
  isProgramHeaderLine,
  isProgramStartLine,
  maxBlockNumber,
  MAX_RENUMBER_LINES,
  startsAsContinuation,
  endsWithContinuation,
  type LineReader,
  type NumberEdit,
} from './blockNumbering';
import { maskComments } from './mask';
import { blockNumberOf } from './tokenizer';

export interface InsertRequest {
  where: 'cursor' | 'end';
  /**
   * `where: 'cursor'`: the cursor's line and column, or, when `selected` is set, the selection's last line
   * (a selection that ends in column 1 of a later line does not include that line).
   */
  line: number;
  column: number;
  /** A selection exists: the lines go after `line` whatever `column` is. */
  selected?: boolean;
  lineCount: number;
  read: LineReader;
  /** The file's lines, already decoded and with the line endings of the document (no trailing empty line). */
  lines: readonly string[];
}

/** Every `line` of a refusal is the file's own line (1-based, counting the `%` lines left out). */
export type InsertRefusal =
  | { reason: 'empty' }
  /** The file holds nothing but lone `%` lines, which an insert leaves out. */
  | { reason: 'onlyTapeMarks' }
  /**
   * One program per file (`numbering.mode: 'consecutive'`): the inserted text holds a second program start.
   * `endLine`: the file's program end too, when it has one (the file is a whole program).
   */
  | { reason: 'secondProgramStart'; line: number; endLine?: number }
  /** One program per file: the inserted text holds a program end (Klartext `END PGM`), which would end the program early. */
  | { reason: 'programEndInFile'; line: number }
  /**
   * The file's block would join a block of the document: its last line ends with the continuation marker
   * (`first: false`, Klartext `~`, the block below would become its tail), or its first line starts with the
   * continuation mark below a line (`first: true`, Okuma `$`).
   */
  | { reason: 'continuesBlock'; first: boolean; line: number }
  /** Consecutive numbering: more blocks below would have to change than `MAX_RENUMBER_LINES`. */
  | { reason: 'tooManyBelow'; limit: number }
  /** Consecutive numbering: a number would pass `numbering.max`. */
  | { reason: 'overflow'; max: number };

/** What the status bar warns about after an insert that went ahead. Every `line` is the document's, after the insert. */
export type InsertWarning =
  /** The nearest program end above the inserted lines, with no program start between. */
  | { kind: 'afterProgramEnd'; line: number }
  /** The lone `%` that ends the tape, above the inserted lines: the control reads nothing behind it. */
  | { kind: 'afterTapeEnd'; line: number }
  /**
   * An inserted line starts (`end: false`) or ends (`end: true`) a program, and blocks of the program follow the
   * inserted lines. `text` is that line.
   */
  | { kind: 'programFrame'; end: boolean; line: number; text: string };

export type InsertPlan =
  | {
      ok: true;
      /** The inserted lines go in as whole lines before this line (`lineCount + 1`: after the last one). */
      beforeLine: number;
      /**
       * The text of the inserted lines as they go in: without the file's lone `%` lines, and with Klartext
       * numbering the numbers are already changed.
       */
      lines: string[];
      /**
       * Consecutive numbering: the digits of the blocks **below** the insertion that change, in the
       * document's line numbers **before** the insert (so `line >= beforeLine`). Empty for every other profile.
       */
      numberEdits: NumberEdit[];
      /** The blocks that took a new number: the inserted lines whose number changed or was added, and `numberEdits`. */
      renumbered: number;
      /** The file's lone `%` lines that were left out. */
      tapeMarksLeftOut: number;
      warnings: InsertWarning[];
    }
  | ({ ok: false } & InsertRefusal);

/** True when `line` continues the block above it (that line ends with the continuation marker, or this one starts with the continuation mark). */
function isTail(read: LineReader, line: number, cp: CompiledProfile): boolean {
  return line > 1 && (endsWithContinuation(read(line - 1), cp) || startsAsContinuation(read(line), cp));
}

/** The first line of the block `line` belongs to (`line` itself when it starts a block). */
function headOfBlock(read: LineReader, line: number, cp: CompiledProfile): number {
  let head = line;
  while (isTail(read, head, cp)) head--;
  return head;
}

/** The last line of the block `line` belongs to (`line` itself when nothing continues it). */
function endOfBlock(read: LineReader, lineCount: number, line: number, cp: CompiledProfile): number {
  let end = line;
  while (end < lineCount && isTail(read, end + 1, cp)) end++;
  return end;
}

/** The number a block above the insertion carries: the nearest block head upwards with a number, else null. */
function numberAbove(read: LineReader, beforeLine: number, cp: CompiledProfile): number | null {
  for (let line = beforeLine - 1; line >= 1; line--) {
    const text = read(line);
    const at = blockNumberOf(text, cp);
    if (at === null) continue;
    // A line that continues the block above is not a block head (its number, if it has one, is no block's).
    if (startsAsContinuation(text, cp) || (line > 1 && endsWithContinuation(read(line - 1), cp))) continue;
    return at.value;
  }
  return null;
}

/**
 * The program end the insertion point lies behind: walking up from the line above it, the first program
 * start means the insert is inside a program that has not ended; the first program end is the warning.
 */
function endedAbove(read: LineReader, beforeLine: number, cp: CompiledProfile): number | null {
  if (cp.re.programEnd.length === 0) return null;
  for (let line = beforeLine - 1; line >= 1; line--) {
    const text = read(line);
    if (isProgramStartLine(text, cp)) return null;
    if (isProgramEndLine(text, cp)) return line;
  }
  return null;
}

/** `text` with the digits of `edit` replaced (the columns are 1-based UTF-16, as Monaco takes them). */
function withEdit(text: string, edit: NumberEdit): string {
  return text.slice(0, edit.startColumn - 1) + edit.text + text.slice(edit.endColumn - 1);
}

/** True when `text` is blank or holds nothing but comments. */
function isBlankOrComment(text: string, cp: CompiledProfile): boolean {
  return text.trim() === '' || maskComments(text, cp).trim() === '';
}

/** True when `text` is the line a program starts with: `cp.re.programStart` or the profile's header. */
function isProgramHeadLine(text: string, cp: CompiledProfile): boolean {
  return isProgramStartLine(text, cp) || isProgramHeaderLine(text, cp);
}

/**
 * Whether an inserted line opens or closes a program: `'start'` (a program start, or the profile's header in
 * any form it names: Sinumerik `;%_N_…_SPF` too, which marks where a program of an archive begins), `'end'`
 * (a program end outside a comment), or null.
 */
function frameOf(text: string, cp: CompiledProfile): 'start' | 'end' | null {
  if (isProgramHeadLine(text, cp)) return 'start';
  if (isProgramEndLine(text, cp)) return 'end';
  return null;
}

/**
 * The program's first lines: a leading lone `%` (`tape`, the first line that is not blank) and the
 * program-start line (`start`: the first line after it that is neither blank nor a comment, when it starts a
 * program; `startEnd` the last line of its block). 0 for what the document does not have.
 */
function programHead(read: LineReader, lineCount: number, cp: CompiledProfile): { tape: number; start: number; startEnd: number } {
  let line = 1;
  while (line <= lineCount && read(line).trim() === '') line++;
  let tape = 0;
  if (line <= lineCount && isLoneTapeMark(read(line), cp)) tape = line++;
  for (; line <= lineCount; line++) {
    const text = read(line);
    if (isProgramHeadLine(text, cp)) return { tape, start: line, startEnd: endOfBlock(read, lineCount, line, cp) };
    if (!isBlankOrComment(text, cp)) break;
  }
  return { tape, start: 0, startEnd: 0 };
}

/**
 * True when blocks of the program follow `beforeLine`: going down, a block comes before the next program
 * start (blank lines, comment lines and lone `%` lines are passed over). An inserted program start or end
 * then cuts the program.
 */
function blocksFollow(read: LineReader, lineCount: number, beforeLine: number, cp: CompiledProfile): boolean {
  for (let line = beforeLine; line <= lineCount; line++) {
    const text = read(line);
    if (text.trim() === '' || isLoneTapeMark(text, cp)) continue;
    if (isProgramHeadLine(text, cp)) return false;
    if (isBlankOrComment(text, cp)) continue;
    return true;
  }
  return false;
}

/**
 * The lone `%` that ends the tape above `beforeLine`: the document's last lone `%`, when it is above the
 * insertion point and is not the one that opens the tape (`tape`); else null. A `%` that a program start
 * follows is no tape end but the mark between two programs of a file (`% O1 … M30 % O2 …`), and so is the
 * `%` right above lines that start a program of their own (`ownProgram`).
 */
function tapeEndAbove(read: LineReader, lineCount: number, beforeLine: number, tape: number, ownProgram: boolean, cp: CompiledProfile): number | null {
  if (!isLoneTapeMark('%', cp)) return null; // a profile without a tape (Klartext)
  for (let line = lineCount; line >= beforeLine; line--) if (isLoneTapeMark(read(line), cp)) return null;
  let mark = 0;
  for (let line = beforeLine - 1; line > tape && mark === 0; line--) if (isLoneTapeMark(read(line), cp)) mark = line;
  if (mark === 0) return null;
  for (let line = mark + 1; line < beforeLine; line++) {
    const text = read(line);
    if (isBlankOrComment(text, cp)) continue;
    return isProgramHeadLine(text, cp) ? null : mark;
  }
  return ownProgram ? null : mark;
}

/** Where Append puts the lines: after the last line, before an empty last line, before a closing `%` or `END PGM`. */
function appendPoint(read: LineReader, lineCount: number, cp: CompiledProfile): number {
  let last = lineCount;
  while (last >= 1 && read(last).trim() === '') last--;
  if (last >= 1) {
    const text = read(last);
    // A lone `%` closes the tape only below a line that is not blank (the first one opens it).
    let closes = cp.profile.program?.endRecord === true && isProgramEndLine(text, cp);
    if (isLoneTapeMark(text, cp)) for (let line = last - 1; line >= 1 && !closes; line--) closes = read(line).trim() !== '';
    if (closes) return headOfBlock(read, last, cp);
  }
  // After the last line, or before an empty last line (the document ends with a line break).
  return lineCount >= 1 && read(lineCount) === '' ? lineCount : lineCount + 1;
}

export function planInsert(request: InsertRequest, cp: CompiledProfile): InsertPlan {
  const { lineCount, read } = request;
  // Nothing, or one empty line (a file of one line break): there is nothing to put in.
  if (request.lines.length === 0 || (request.lines.length === 1 && request.lines[0] === '')) return { ok: false, reason: 'empty' };

  // The file's lone `%` lines stay out, unless the document is empty: then the file comes in as it is.
  let documentEmpty = true;
  for (let line = 1; line <= lineCount && documentEmpty; line++) if (read(line).trim() !== '') documentEmpty = false;
  const lines: string[] = [];
  /** The file's own line of each of `lines`. */
  const fileLine: number[] = [];
  request.lines.forEach((text, i) => {
    if (documentEmpty || !isLoneTapeMark(text, cp)) {
      lines.push(text);
      fileLine.push(i + 1);
    }
  });
  const tapeMarksLeftOut = request.lines.length - lines.length;
  if (tapeMarksLeftOut > 0 && lines.every((text) => text.trim() === '')) return { ok: false, reason: 'onlyTapeMarks' };

  const consecutive = cp.profile.numbering?.mode === 'consecutive';
  // The first program start and the first program end of the file.
  let startAt = -1;
  let endAt = -1;
  for (let i = 0; i < lines.length && (startAt < 0 || endAt < 0); i++) {
    const frame = frameOf(lines[i], cp);
    if (frame === 'start' && startAt < 0) startAt = i;
    if (frame === 'end' && endAt < 0) endAt = i;
  }
  if (consecutive && startAt >= 0) {
    return endAt >= 0
      ? { ok: false, reason: 'secondProgramStart', line: fileLine[startAt], endLine: fileLine[endAt] }
      : { ok: false, reason: 'secondProgramStart', line: fileLine[startAt] };
  }
  if (consecutive && endAt >= 0) return { ok: false, reason: 'programEndInFile', line: fileLine[endAt] };
  // The file starts a program of its own: its first line that is neither blank nor a comment starts one.
  const firstBlock = lines.findIndex((text) => !isBlankOrComment(text, cp));
  const ownProgram = firstBlock >= 0 && firstBlock === startAt;

  if (endsWithContinuation(lines[lines.length - 1], cp)) return { ok: false, reason: 'continuesBlock', first: false, line: fileLine[lines.length - 1] };

  let beforeLine: number;
  if (request.where === 'end') {
    beforeLine = appendPoint(read, lineCount, cp);
  } else {
    const line = Math.min(Math.max(Math.trunc(request.line) || 1, 1), Math.max(lineCount, 1));
    // Never between a block and its continuation: before the block's first line, after its last.
    beforeLine = request.selected !== true && request.column === 1 ? headOfBlock(read, line, cp) : endOfBlock(read, lineCount, line, cp) + 1;
  }
  // Never above or on the program's first lines: below them, or a program of the file in front of the program start.
  const head = programHead(read, lineCount, cp);
  const headLast = head.start > 0 ? head.startEnd : head.tape;
  if (headLast > 0 && beforeLine <= headLast) beforeLine = ownProgram && head.start > 0 ? Math.max(beforeLine, head.tape + 1) : headLast + 1;

  if (beforeLine > 1 && startsAsContinuation(lines[0], cp)) return { ok: false, reason: 'continuesBlock', first: true, line: fileLine[0] };

  const count = lines.length;
  const text = [...lines];
  const numberEdits: NumberEdit[] = [];
  let renumbered = 0;

  if (consecutive) {
    // A block of the file without a number takes one (rule 8: the inserted blocks take consecutive numbers);
    // the digits are set by the walk below. A comment line is a block too: the control numbers every line of
    // the program, `12 ; text` (TNC 640 user manual, comments in a block of their own). A tail and a blank line
    // stay as they are.
    const placeholder = formatBlockNumber(0, cp);
    for (let i = 0; i < count && placeholder !== null; i++) {
      const tail = (i > 0 && endsWithContinuation(text[i - 1], cp)) || startsAsContinuation(text[i], cp);
      if (tail || text[i].trim() === '' || blockNumberOf(text[i], cp) !== null) continue;
      text[i] = placeholder + text[i].trimStart();
    }
    // The document as it will be: the blocks above, the file's, the blocks below.
    const total = lineCount + count;
    const combined: LineReader = (line) => {
      if (line < beforeLine) return read(line);
      if (line < beforeLine + count) return text[line - beforeLine];
      return read(line - count);
    };
    const above = numberAbove(read, beforeLine, cp);
    const first = above === null ? (cp.profile.numbering?.start ?? 0) : above + 1;
    // The limit counts the blocks below; the file's own blocks may all change.
    const answer = consecutiveRenumbering(combined, total, beforeLine, first, cp, MAX_RENUMBER_LINES + count);
    if (!answer.ok) {
      return answer.reason === 'overflow'
        ? { ok: false, reason: 'overflow', max: maxBlockNumber(cp) }
        : { ok: false, reason: 'tooManyBelow', limit: MAX_RENUMBER_LINES };
    }
    for (const edit of answer.edits) {
      if (edit.line < beforeLine + count) text[edit.line - beforeLine] = withEdit(text[edit.line - beforeLine], edit);
      else numberEdits.push({ ...edit, line: edit.line - count });
    }
    if (numberEdits.length > MAX_RENUMBER_LINES) return { ok: false, reason: 'tooManyBelow', limit: MAX_RENUMBER_LINES };
    renumbered = numberEdits.length + text.reduce((changed, line, i) => (line === lines[i] ? changed : changed + 1), 0);
  }

  const warnings: InsertWarning[] = [];
  const tapeEnd = tapeEndAbove(read, lineCount, beforeLine, head.tape, ownProgram, cp);
  if (tapeEnd !== null) {
    warnings.push({ kind: 'afterTapeEnd', line: tapeEnd });
  } else if (!ownProgram) {
    // A program of the file's own after the end of the one above is what a file of several programs holds.
    const ended = endedAbove(read, beforeLine, cp);
    if (ended !== null) warnings.push({ kind: 'afterProgramEnd', line: ended });
  }
  const frameAt = startAt >= 0 && (endAt < 0 || startAt < endAt) ? startAt : endAt;
  if (frameAt >= 0 && blocksFollow(read, lineCount, beforeLine, cp)) {
    warnings.push({ kind: 'programFrame', end: frameAt === endAt, line: beforeLine + frameAt, text: lines[frameAt] });
  }
  return { ok: true, beforeLine, lines: text, numberEdits, renumbered, tapeMarksLeftOut, warnings };
}

/**
 * The one replacement that carries a plan out: lines `startLine..endLine` of the document become `newLines`
 * (`applyLines` edits only what differs, so the lines in between stay as they are). The inserted lines come
 * first, then the old lines from the insertion point down to the last one whose number changes, with their
 * new digits. After the last line there is no line to anchor on but the last one, which comes first and
 * unchanged.
 */
export function insertReplacement(
  plan: Extract<InsertPlan, { ok: true }>,
  read: LineReader,
  lineCount: number,
): { startLine: number; endLine: number; newLines: string[] } {
  if (plan.beforeLine > lineCount) {
    return { startLine: lineCount, endLine: lineCount, newLines: [read(lineCount), ...plan.lines] };
  }
  const last = plan.numberEdits.reduce((max, edit) => Math.max(max, edit.line), plan.beforeLine);
  const byLine = new Map(plan.numberEdits.map((edit) => [edit.line, edit]));
  const newLines = [...plan.lines];
  for (let line = plan.beforeLine; line <= last; line++) {
    const old = read(line);
    const edit = byLine.get(line);
    newLines.push(edit === undefined ? old : withEdit(old, edit));
  }
  return { startLine: plan.beforeLine, endLine: last, newLines };
}
