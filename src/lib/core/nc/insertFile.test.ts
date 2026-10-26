// Insert File and Append File (Phase 4 plan §6.5 rule 8): the placement, the append rule, the program-end warning,
// the Klartext numbering and its refusals, the other profiles keeping their numbers. The reading of the file and the
// one undo step are `contrib/insertFile.test.ts`.

import { describe, expect, it } from 'vitest';
import { compileProfile } from '$lib/core/profiles/compile';
import type { CompiledProfile } from '$lib/core/profiles/types';
import { MAX_RENUMBER_LINES } from './blockNumbering';
import { insertReplacement, planInsert, type InsertPlan, type InsertRequest } from './insertFile';
import { cpOf, profileOf } from '../../../../tests/unit/helpers/profiles';

const FANUC = cpOf('fanuc-gcode');
const KLARTEXT = cpOf('heidenhain-klartext');

type Ok = Extract<InsertPlan, { ok: true }>;

function request(doc: readonly string[], lines: readonly string[], rest: Partial<InsertRequest> & { where: InsertRequest['where'] }): InsertRequest {
  return { line: 1, column: 1, lineCount: doc.length, read: (n) => doc[n - 1] ?? '', lines, ...rest };
}

function plan(doc: readonly string[], lines: readonly string[], rest: Partial<InsertRequest> & { where: InsertRequest['where'] }, cp: CompiledProfile = FANUC): InsertPlan {
  return planInsert(request(doc, lines, rest), cp);
}

function ok(answer: InsertPlan): Ok {
  if (!answer.ok) throw new Error(`refused: ${answer.reason}`);
  return answer;
}

/** The document after the plan, by the replacement `applyLines` is given. */
function after(doc: readonly string[], answer: InsertPlan): string[] {
  const p = ok(answer);
  const { startLine, endLine, newLines } = insertReplacement(p, (n) => doc[n - 1] ?? '', doc.length);
  return [...doc.slice(0, startLine - 1), ...newLines, ...doc.slice(endLine)];
}

const PROGRAM = ['O1000', 'N10 G90 G54', 'N20 G1 X1', 'N30 G1 X2', 'N40 M30', '%'];
const TWO = ['%', 'O1', 'N10 G0 X0', 'N20 M30', '%', 'O2', 'N10 G0 X1', 'N20 G0 X2', 'N30 M30', '%'];
const NEW = ['N100 G1 Z-1', 'N110 G1 Z-2'];

describe('insert: where the lines go', () => {
  it('goes before the cursor line when the cursor is in column 1 with no selection', () => {
    const p = ok(plan(PROGRAM, NEW, { where: 'cursor', line: 3, column: 1 }));
    expect(p.beforeLine).toBe(3);
    expect(after(PROGRAM, p)).toEqual(['O1000', 'N10 G90 G54', ...NEW, 'N20 G1 X1', 'N30 G1 X2', 'N40 M30', '%']);
  });

  it('goes after the cursor line when the cursor is anywhere else in the line', () => {
    for (const column of [2, 5, 12]) {
      const p = ok(plan(PROGRAM, NEW, { where: 'cursor', line: 3, column }));
      expect(p.beforeLine, `column ${column}`).toBe(4);
    }
    expect(after(PROGRAM, plan(PROGRAM, NEW, { where: 'cursor', line: 3, column: 2 })).slice(2, 6)).toEqual(['N20 G1 X1', ...NEW, 'N30 G1 X2']);
  });

  it('goes after the last line of a selection, even when the cursor is in column 1', () => {
    const p = ok(plan(PROGRAM, NEW, { where: 'cursor', line: 4, column: 1, selected: true }));
    expect(p.beforeLine).toBe(5);
  });

  it('goes after the last line when the cursor is on it, and before the first line when it is in column 1 there', () => {
    expect(ok(plan(PROGRAM, NEW, { where: 'cursor', line: 6, column: 2 })).beforeLine).toBe(7);
    expect(after(PROGRAM, plan(PROGRAM, NEW, { where: 'cursor', line: 6, column: 2 })).slice(-4)).toEqual(['N40 M30', '%', ...NEW]);
    // A program without a program-start line or a leading `%`: line 1 is a block like any other.
    expect(ok(plan(['N10 G0 X0', 'N20 G1 X1'], NEW, { where: 'cursor', line: 1, column: 1 })).beforeLine).toBe(1);
  });

  it('reads a cursor line outside the document as the nearest line', () => {
    expect(ok(plan(PROGRAM, NEW, { where: 'cursor', line: 99, column: 1 })).beforeLine).toBe(6);
    expect(ok(plan(PROGRAM, NEW, { where: 'cursor', line: 0, column: 2 })).beforeLine).toBe(2);
  });

  it('keeps the file lines as they are, with their own numbers, in every profile but Klartext', () => {
    for (const id of ['fanuc-gcode', 'fanuc-lathe', 'okuma-osp', 'sinumerik', 'sinumerik-mill']) {
      const answer = ok(plan(PROGRAM, ['N5 G1 X9', 'N5 G1 X9'], { where: 'cursor', line: 2, column: 1 }, cpOf(id)));
      expect(answer.lines, id).toEqual(['N5 G1 X9', 'N5 G1 X9']);
      expect(answer.numberEdits, id).toEqual([]);
    }
  });
});

describe('append: the end of the document', () => {
  /** PROGRAM without its closing `%`. */
  const OPEN = PROGRAM.slice(0, -1);

  it('goes after the last line', () => {
    const p = ok(plan(OPEN, NEW, { where: 'end' }));
    expect(p.beforeLine).toBe(OPEN.length + 1);
    expect(after(OPEN, p)).toEqual([...OPEN, ...NEW]);
  });

  it('goes before an empty last line, so no blank line appears', () => {
    const doc = [...OPEN, ''];
    const p = ok(plan(doc, NEW, { where: 'end' }));
    expect(p.beforeLine).toBe(doc.length);
    expect(after(doc, p)).toEqual([...OPEN, ...NEW, '']);
  });

  it('puts a file into an empty document with the line break the document had', () => {
    expect(after([''], plan([''], NEW, { where: 'end' }))).toEqual([...NEW, '']);
  });

  it('does not care where the cursor is', () => {
    expect(ok(plan(OPEN, NEW, { where: 'end', line: 2, column: 1 })).beforeLine).toBe(OPEN.length + 1);
  });
});

describe('an empty file', () => {
  it('is refused: no lines, or one empty line (a file of one line break)', () => {
    expect(plan(PROGRAM, [], { where: 'end' })).toEqual({ ok: false, reason: 'empty' });
    expect(plan(PROGRAM, [''], { where: 'cursor' })).toEqual({ ok: false, reason: 'empty' });
  });

  it('is not what a file of one blank line and a block is', () => {
    expect(plan(PROGRAM, ['', 'G0 X0'], { where: 'end' }).ok).toBe(true);
  });
});

describe('the program end', () => {
  const warning = (answer: InsertPlan) => ok(answer).warnings;

  it('warns when the nearest program end above the insertion point has no program start after it', () => {
    expect(warning(plan(PROGRAM, NEW, { where: 'end' }))).toEqual([{ kind: 'afterProgramEnd', line: 5 }]);
    expect(warning(plan(PROGRAM, NEW, { where: 'cursor', line: 5, column: 4 }))).toEqual([{ kind: 'afterProgramEnd', line: 5 }]);
  });

  it('goes ahead all the same: the lines are in the plan', () => {
    expect(after(PROGRAM, plan(PROGRAM, NEW, { where: 'end' })).slice(-3)).toEqual([...NEW, '%']);
  });

  it('does not warn above the program end, nor in a program that has not ended', () => {
    expect(warning(plan(PROGRAM, NEW, { where: 'cursor', line: 5, column: 1 }))).toEqual([]);
    expect(warning(plan(PROGRAM, NEW, { where: 'cursor', line: 2, column: 3 }))).toEqual([]);
  });

  it('does not warn in the second program of a file with several (O1 … M30 % O2 …)', () => {
    expect(warning(plan(TWO, NEW, { where: 'cursor', line: 7, column: 3 }))).toEqual([]);
    expect(warning(plan(TWO, NEW, { where: 'cursor', line: 8, column: 1 }))).toEqual([]);
  });

  it('warns after the last program of such a file, naming the line of its end', () => {
    expect(warning(plan(TWO, NEW, { where: 'end' }))).toEqual([{ kind: 'afterProgramEnd', line: 9 }]);
  });

  it('warns between two programs, after the end of the first (the `%` line is no start)', () => {
    expect(warning(plan(TWO, NEW, { where: 'cursor', line: 5, column: 2 }))).toEqual([{ kind: 'afterProgramEnd', line: 4 }]);
  });

  it('does not take M30 in a comment for the program end', () => {
    const doc = ['O1', 'N10 G0 X0 (M30 FOLLOWS)', 'N20 G0 X1'];
    expect(warning(plan(doc, NEW, { where: 'end' }))).toEqual([]);
  });

  it('says nothing for a file without a program end', () => {
    expect(warning(plan(['G0 X0', 'G1 X1'], NEW, { where: 'end' }))).toEqual([]);
  });
});

describe('Klartext: one program, consecutive numbers', () => {
  const KT = ['0 BEGIN PGM A MM', '1 L X+0 Y+0 FMAX', '2 L X+10', '3 L X+20', '4 END PGM A MM'];

  it('refuses a second program start in the file, naming the file’s line', () => {
    const answer = plan(KT, ['5 L X+1', '6 BEGIN PGM B MM'], { where: 'cursor', line: 2, column: 2 }, KLARTEXT);
    expect(answer).toEqual({ ok: false, reason: 'secondProgramStart', line: 2 });
  });

  it('numbers the inserted blocks and the blocks below from the number above plus 1', () => {
    const doc = after(KT, plan(KT, ['9 L X+5', '9 L X+6', '; a comment'], { where: 'cursor', line: 3, column: 2 }, KLARTEXT));
    expect(doc).toEqual([
      '0 BEGIN PGM A MM',
      '1 L X+0 Y+0 FMAX',
      '2 L X+10',
      '3 L X+5',
      '4 L X+6',
      '5 ; a comment',
      '6 L X+20',
      '7 END PGM A MM',
    ]);
  });

  it('puts the changes of the blocks below in numberEdits, in the document’s lines before the insert', () => {
    const answer = ok(plan(KT, ['9 L X+5'], { where: 'cursor', line: 3, column: 2 }, KLARTEXT));
    expect(answer.numberEdits.map((e) => [e.line, e.text])).toEqual([
      [4, '4'],
      [5, '5'],
    ]);
    expect(answer.lines).toEqual(['3 L X+5']);
  });

  it('inserts before the cursor line in column 1 and shifts that line too', () => {
    const doc = after(KT, plan(KT, ['1 L X+7'], { where: 'cursor', line: 3, column: 1 }, KLARTEXT));
    expect(doc.slice(1)).toEqual(['1 L X+0 Y+0 FMAX', '2 L X+7', '3 L X+10', '4 L X+20', '5 END PGM A MM']);
  });

  it('keeps the number of a file block that is already right', () => {
    // The file’s own numbers match, and nothing below needs a change: an insert at the end of the blocks.
    const answer = ok(plan(KT, ['4 L X+30'], { where: 'cursor', line: 4, column: 2 }, KLARTEXT));
    expect(answer.lines).toEqual(['4 L X+30']);
    expect(answer.numberEdits.map((e) => e.line)).toEqual([5]);
  });

  it('numbers from numbering.start when there is no numbered block above', () => {
    const doc = ['; only a comment', '0 L X+0'];
    const answer = ok(plan(doc, ['7 L X+1'], { where: 'cursor', line: 1, column: 1 }, KLARTEXT));
    expect(answer.lines).toEqual(['0 L X+1']);
    expect(answer.numberEdits.map((e) => [e.line, e.text])).toEqual([[2, '1']]);
  });

  it('numbers after the program end and still warns', () => {
    const answer = ok(plan(KT, ['1 L X+1'], { where: 'cursor', line: 5, column: 3 }, KLARTEXT));
    expect(answer.beforeLine).toBe(6);
    expect(answer.lines).toEqual(['5 L X+1']);
    expect(answer.warnings).toEqual([{ kind: 'afterProgramEnd', line: 5 }]);
  });

  it('does not warn inside the program', () => {
    expect(ok(plan(KT, ['1 L X+1'], { where: 'cursor', line: 2, column: 5 }, KLARTEXT)).warnings).toEqual([]);
  });

  it('refuses more than MAX_RENUMBER_LINES blocks below, with the limit, and inserts nothing', () => {
    const doc = ['0 BEGIN PGM A MM', ...Array.from({ length: MAX_RENUMBER_LINES + 2 }, (_, i) => `${i + 1} L X+${i}`)];
    expect(plan(doc, ['1 L X+1'], { where: 'cursor', line: 1, column: 2 }, KLARTEXT)).toEqual({
      ok: false,
      reason: 'tooManyBelow',
      limit: MAX_RENUMBER_LINES,
    });
  });

  it('takes exactly MAX_RENUMBER_LINES blocks below', () => {
    const doc = ['0 BEGIN PGM A MM', ...Array.from({ length: MAX_RENUMBER_LINES }, (_, i) => `${i + 1} L X+${i}`)];
    expect(ok(plan(doc, ['1 L X+1'], { where: 'cursor', line: 1, column: 2 }, KLARTEXT)).numberEdits).toHaveLength(MAX_RENUMBER_LINES);
  });

  it('lets a long file renumber all its own blocks when few blocks are below', () => {
    const file = Array.from({ length: MAX_RENUMBER_LINES + 500 }, (_, i) => `${i + 100} L X+${i}`);
    const answer = ok(plan(KT, file, { where: 'cursor', line: 3, column: 2 }, KLARTEXT));
    expect(answer.lines[0]).toBe('3 L X+0');
    expect(answer.lines[answer.lines.length - 1]).toBe(`${3 + file.length - 1} L X+${file.length - 1}`);
  });

  it('refuses numbers above numbering.max', () => {
    const base = profileOf('heidenhain-klartext');
    const small = compileProfile({ ...base, numbering: { ...base.numbering, max: 3 } });
    expect(plan(KT, ['9 L X+5'], { where: 'cursor', line: 3, column: 2 }, small)).toEqual({ ok: false, reason: 'overflow', max: 3 });
  });

  it('does not touch the numbers above the insertion', () => {
    const doc = after(KT, plan(KT, ['L X+5'], { where: 'cursor', line: 4, column: 2 }, KLARTEXT));
    expect(doc.slice(0, 4)).toEqual(KT.slice(0, 4));
  });
});

describe('every other profile keeps the numbers', () => {
  it('writes the file’s numbers as they are and edits nothing below', () => {
    const answer = ok(plan(PROGRAM, ['N10 G1 X1', 'N10 G1 X2'], { where: 'cursor', line: 2, column: 1 }));
    expect(answer.lines).toEqual(['N10 G1 X1', 'N10 G1 X2']);
    expect(answer.numberEdits).toEqual([]);
    expect(after(PROGRAM, answer)).toEqual(['O1000', 'N10 G1 X1', 'N10 G1 X2', ...PROGRAM.slice(1)]);
  });

  it('does not refuse a second program start (a Fanuc file holds several programs)', () => {
    expect(plan(PROGRAM, ['O2', 'N10 G0 X0', 'N20 M30'], { where: 'end' }).ok).toBe(true);
  });
});

describe('never between a block and its continuation', () => {
  const OKUMA = cpOf('okuma-osp');
  // Klartext: `~` ends a line that goes on in the next.
  const KT = ['0 BEGIN PGM A MM', '1 L X+0 ~', '  Y+0 ~', '  FMAX', '2 L X+10', '3 END PGM A MM'];
  // Okuma: a line that starts with `$` continues the block above.
  const OK = ['O1', 'N10 G0 X0', '$ Y0', '$ Z0', 'N20 G1 X1', 'M30'];
  const at = (answer: InsertPlan) => ok(answer).beforeLine;

  it('Klartext ~: after puts the lines behind the block’s last line, wherever the cursor is in it', () => {
    for (const line of [2, 3, 4]) expect(at(plan(KT, ['L X+1'], { where: 'cursor', line, column: 3 }, KLARTEXT)), `line ${line}`).toBe(5);
    expect(at(plan(KT, ['L X+1'], { where: 'cursor', line: 2, column: 1, selected: true }, KLARTEXT))).toBe(5);
  });

  it('Klartext ~: before, in column 1 of a tail, puts the lines before the block’s first line', () => {
    for (const line of [2, 3, 4]) expect(at(plan(KT, ['L X+1'], { where: 'cursor', line, column: 1 }, KLARTEXT)), `line ${line}`).toBe(2);
    expect(at(plan(KT, ['L X+1'], { where: 'cursor', line: 5, column: 1 }, KLARTEXT))).toBe(5);
  });

  it('Klartext ~: the block stays whole and the numbers follow', () => {
    const doc = after(KT, plan(KT, ['9 L X+5'], { where: 'cursor', line: 3, column: 2 }, KLARTEXT));
    expect(doc).toEqual(['0 BEGIN PGM A MM', '1 L X+0 ~', '  Y+0 ~', '  FMAX', '2 L X+5', '3 L X+10', '4 END PGM A MM']);
  });

  it('Okuma $: after puts the lines behind the last $ line', () => {
    expect(at(plan(OK, NEW, { where: 'cursor', line: 2, column: 4 }, OKUMA))).toBe(5);
    expect(at(plan(OK, NEW, { where: 'cursor', line: 3, column: 2 }, OKUMA))).toBe(5);
    expect(at(plan(OK, NEW, { where: 'cursor', line: 4, column: 1, selected: true }, OKUMA))).toBe(5);
    expect(after(OK, plan(OK, NEW, { where: 'cursor', line: 2, column: 4 }, OKUMA)).slice(1, 7)).toEqual(['N10 G0 X0', '$ Y0', '$ Z0', ...NEW, 'N20 G1 X1']);
  });

  it('Okuma $: before, in column 1 of a $ line, puts the lines before the block’s first line', () => {
    expect(at(plan(OK, NEW, { where: 'cursor', line: 3, column: 1 }, OKUMA))).toBe(2);
    expect(at(plan(OK, NEW, { where: 'cursor', line: 4, column: 1 }, OKUMA))).toBe(2);
    expect(at(plan(OK, NEW, { where: 'cursor', line: 2, column: 1 }, OKUMA))).toBe(2);
  });

  it('a block that continues to the last line puts the insert after the document', () => {
    expect(at(plan(['N10 G0 X0', '$ Y0'], NEW, { where: 'cursor', line: 1, column: 2 }, OKUMA))).toBe(3);
  });

  it('a profile without continuation marks is unchanged', () => {
    expect(at(plan(PROGRAM, NEW, { where: 'cursor', line: 3, column: 2 }))).toBe(4);
  });
});

// -- P4c review fixes (F1): frames, edges, numbers ------------------------------------------

const SINUMERIK = cpOf('sinumerik');
const OKUMA_OSP = cpOf('okuma-osp');
/** A Fanuc tape: leading `%`, the program, closing `%`. */
const TAPE = ['%', 'O1000 (PART)', 'N10 G0 X0', 'N20 G1 X5', 'N30 M30', '%'];
/** The Klartext program of the review's repros. */
const KP = [
  '0 BEGIN PGM P MM',
  '1 BLK FORM 0.1 Z X+0 Y+0 Z-20',
  '2 TOOL CALL 1 Z S5000',
  '3 CYCL DEF 200 BOHREN ~',
  '  Q200=2 ;A ~',
  '  Q201=-5 ;B',
  '4 L X+10 R0 FMAX',
  '5 CALL LBL 1',
  '6 LBL 1',
  '7 L Z+100 FMAX',
  '8 LBL 0',
  '9 END PGM P MM',
];

describe('the file’s lone % lines (NC-1, owner Q1)', () => {
  it('are left out, and the plan says how many', () => {
    const answer = ok(plan(TAPE, ['%', 'N100 G1 X1', '%'], { where: 'cursor', line: 3, column: 5 }));
    expect(answer.lines).toEqual(['N100 G1 X1']);
    expect(answer.tapeMarksLeftOut).toBe(2);
    expect(after(TAPE, answer)).toEqual(['%', 'O1000 (PART)', 'N10 G0 X0', 'N100 G1 X1', 'N20 G1 X5', 'N30 M30', '%']);
  });

  it('a % with blanks around it is lone too; a % with more on its line is not', () => {
    const answer = ok(plan(TAPE, ['  % ', 'N100 G1 X1', '%_N_X_MPF'], { where: 'cursor', line: 3, column: 5 }));
    expect(answer.lines).toEqual(['N100 G1 X1', '%_N_X_MPF']);
    expect(answer.tapeMarksLeftOut).toBe(1);
  });

  it('stay in when the document is empty: the file comes in as it is', () => {
    for (const doc of [[''], ['', '  ']]) {
      const answer = ok(plan(doc, ['%', 'O2000', 'N10 G1 X1', 'M30', '%'], { where: 'end' }));
      expect(answer.lines, JSON.stringify(doc)).toEqual(['%', 'O2000', 'N10 G1 X1', 'M30', '%']);
      expect(answer.tapeMarksLeftOut).toBe(0);
      expect(answer.warnings).toEqual([]);
    }
  });

  it('a file of nothing but % lines is refused', () => {
    expect(plan(TAPE, ['%', '%'], { where: 'end' })).toEqual({ ok: false, reason: 'onlyTapeMarks' });
    expect(plan(TAPE, ['%', ''], { where: 'end' })).toEqual({ ok: false, reason: 'onlyTapeMarks' });
  });

  it('Klartext has no tape: a % line there is an ordinary line', () => {
    const KT = ['0 BEGIN PGM A MM', '1 L X+0', '2 END PGM A MM'];
    expect(ok(plan(KT, ['%'], { where: 'cursor', line: 2, column: 2 }, KLARTEXT)).tapeMarksLeftOut).toBe(0);
  });

  it('a refusal names the file’s own line, counting the % lines left out', () => {
    expect(plan(['O1', 'N10 G1 X1', 'N20 G1 X2', 'M02'], ['%', '$Y5', 'N15 X3'], { where: 'cursor', line: 2, column: 5 }, OKUMA_OSP)).toEqual({
      ok: false,
      reason: 'continuesBlock',
      first: true,
      line: 2,
    });
  });
});

describe('a program start or end of the file where blocks of the program follow (NC-1)', () => {
  it('Fanuc: the review’s repro goes ahead with the programFrame warning and without the file’s % lines', () => {
    const answer = ok(plan(TAPE, ['%', 'O2000 (SUB)', 'N10 G1 X1', 'N20 M99', '%'], { where: 'cursor', line: 3, column: 5 }));
    expect(answer.beforeLine).toBe(4);
    expect(answer.lines).toEqual(['O2000 (SUB)', 'N10 G1 X1', 'N20 M99']);
    expect(answer.warnings).toEqual([{ kind: 'programFrame', end: false, line: 4, text: 'O2000 (SUB)' }]);
  });

  it('Sinumerik: a %_N_…_SPF header and a PROC line in the middle of a main program', () => {
    const doc = ['%_N_PART_MPF', 'N10 G0 X0', 'N20 G1 X5', 'N30 M30'];
    expect(ok(plan(doc, ['%_N_SUB_SPF', 'N10 G1 X1', 'N20 RET'], { where: 'cursor', line: 2, column: 5 }, SINUMERIK)).warnings).toEqual([
      { kind: 'programFrame', end: false, line: 3, text: '%_N_SUB_SPF' },
    ]);
    expect(ok(plan(doc, ['PROC SUB', 'N10 G1 X1', 'N20 RET'], { where: 'cursor', line: 2, column: 5 }, SINUMERIK)).warnings).toEqual([
      { kind: 'programFrame', end: false, line: 3, text: 'PROC SUB' },
    ]);
  });

  it('Okuma: a $SUB.SSB% header in the middle of a main program', () => {
    const doc = ['$PART.MIN%', 'N10 G0 X0', 'N20 G1 X5', 'M02'];
    expect(ok(plan(doc, ['$SUB.SSB%', 'OSUB', 'N10 G1 X1', 'RTS'], { where: 'cursor', line: 2, column: 5 }, OKUMA_OSP)).warnings).toEqual([
      { kind: 'programFrame', end: false, line: 3, text: '$SUB.SSB%' },
    ]);
  });

  it('a program end of the file in the middle of a program warns too, naming the inserted line', () => {
    const answer = ok(plan(TAPE, ['N100 G1 X1', 'N110 M30'], { where: 'cursor', line: 3, column: 5 }));
    expect(answer.warnings).toEqual([{ kind: 'programFrame', end: true, line: 5, text: 'N110 M30' }]);
  });

  it('a program start or end in a comment is none; the header in the form the profile names is one', () => {
    const doc = ['%_N_PART_MPF', 'N10 G0 X0', 'N20 G1 X5', 'N30 M30'];
    expect(ok(plan(doc, ['N10 G1 X1 ; M30 PROC A', '; RET'], { where: 'cursor', line: 2, column: 5 }, SINUMERIK)).warnings).toEqual([]);
    expect(ok(plan(TAPE, ['(O2000)', 'N100 G1 X1 (M30)'], { where: 'cursor', line: 3, column: 5 })).warnings).toEqual([]);
    expect(ok(plan(doc, [';%_N_SUB_SPF', 'N10 G1 X1'], { where: 'cursor', line: 2, column: 5 }, SINUMERIK)).warnings).toEqual([
      { kind: 'programFrame', end: false, line: 3, text: ';%_N_SUB_SPF' },
    ]);
  });

  it('is never refused in a profile that holds several programs per file', () => {
    for (const id of ['fanuc-gcode', 'fanuc-lathe', 'okuma-osp', 'sinumerik', 'sinumerik-mill']) {
      expect(plan(TAPE, ['O2000', 'N10 G1 X1', 'N20 M30'], { where: 'cursor', line: 3, column: 5 }, cpOf(id)).ok, id).toBe(true);
    }
  });

  it('does not warn where no block of the program follows: after the last block, between two programs', () => {
    const file = ['O3', 'N10 G0 X0', 'N20 M30'];
    expect(ok(plan(TWO, file, { where: 'end' })).warnings).toEqual([]);
    expect(ok(plan(TWO, file, { where: 'cursor', line: 5, column: 2 })).warnings).toEqual([]);
    expect(ok(plan(TWO, file, { where: 'cursor', line: 5, column: 1 })).warnings).toEqual([]);
    // Comment lines and blank lines before the next program are no blocks of this one.
    const doc = ['O1', 'N10 G0 X0', 'N20 M30', '', '(NEXT)', 'O2', 'N10 G0 X1', 'M30'];
    expect(ok(plan(doc, file, { where: 'cursor', line: 4, column: 1 })).warnings).toEqual([]);
  });
});

describe('Klartext: a program end in the file (NC-2)', () => {
  it('the review’s repro is refused, naming the file’s line, and nothing changes', () => {
    expect(plan(KP, ['5 L X+1', '6 END PGM SUB MM'], { where: 'cursor', line: 7, column: 1 }, KLARTEXT)).toEqual({
      ok: false,
      reason: 'programEndInFile',
      line: 2,
    });
  });

  it('a file with a program start and a program end is refused naming both lines', () => {
    expect(plan(KP, ['0 BEGIN PGM SUB MM', '1 L X+1', '2 END PGM SUB MM'], { where: 'cursor', line: 7, column: 1 }, KLARTEXT)).toEqual({
      ok: false,
      reason: 'secondProgramStart',
      line: 1,
      endLine: 3,
    });
  });

  it('END PGM in a comment is no program end', () => {
    expect(plan(KP, ['L X+1 ; END PGM X MM'], { where: 'cursor', line: 7, column: 1 }, KLARTEXT).ok).toBe(true);
  });
});

describe('the program’s first lines (NC-3, owner Q2(i))', () => {
  it('Klartext, cursor at 1:1: below BEGIN PGM, numbers from 1, the blocks below follow', () => {
    const doc = after(KP, plan(KP, ['5 L X+1', '6 L X+2'], { where: 'cursor', line: 1, column: 1 }, KLARTEXT));
    expect(doc.slice(0, 5)).toEqual(['0 BEGIN PGM P MM', '1 L X+1', '2 L X+2', '3 BLK FORM 0.1 Z X+0 Y+0 Z-20', '4 TOOL CALL 1 Z S5000']);
    expect(doc[doc.length - 1]).toBe('11 END PGM P MM');
  });

  it('Fanuc, cursor at 1:1 or in column 1 of the program-start line: below the leading % and O1000', () => {
    for (const line of [1, 2]) {
      const answer = ok(plan(TAPE, ['N100 G1 X1'], { where: 'cursor', line, column: 1 }));
      expect(answer.beforeLine, `line ${line}`).toBe(3);
    }
    expect(ok(plan(TAPE, ['N100 G1 X1'], { where: 'cursor', line: 1, column: 1, selected: true })).beforeLine).toBe(3);
    expect(ok(plan(TAPE, ['N100 G1 X1'], { where: 'cursor', line: 1, column: 2 })).beforeLine).toBe(3);
    expect(ok(plan(PROGRAM, ['N100 G1 X1'], { where: 'cursor', line: 1, column: 1 })).beforeLine).toBe(2);
  });

  it('a leading % alone, or blank lines and comment lines before the program start', () => {
    expect(ok(plan(['%', 'N10 G0 X0', 'M30', '%'], NEW, { where: 'cursor', line: 1, column: 1 })).beforeLine).toBe(2);
    expect(ok(plan(['', '%', '(HEAD)', 'O1', 'N10 G0', 'M30'], NEW, { where: 'cursor', line: 1, column: 1 })).beforeLine).toBe(5);
  });

  it('Sinumerik %_N_…_MPF and Okuma $NAME.MIN% are program-start lines', () => {
    expect(ok(plan(['%_N_PART_MPF', 'N10 G0 X0', 'M30'], NEW, { where: 'cursor', line: 1, column: 1 }, SINUMERIK)).beforeLine).toBe(2);
    expect(ok(plan(['$PART.MIN%', 'N10 G0 X0', 'M02'], NEW, { where: 'cursor', line: 1, column: 1 }, OKUMA_OSP)).beforeLine).toBe(2);
  });

  it('a file that starts a program of its own goes in front of the program-start line, below the leading %, without warnings', () => {
    const file = ['(SUB)', 'O2000', 'N10 G1 X1', 'N20 M30'];
    for (const line of [1, 2]) {
      const answer = ok(plan(TAPE, file, { where: 'cursor', line, column: 1 }));
      expect(answer.beforeLine, `line ${line}`).toBe(2);
      expect(answer.warnings, `line ${line}`).toEqual([]);
    }
    expect(after(TAPE, plan(TAPE, ['%', 'O2000', 'N20 M30', '%'], { where: 'cursor', line: 1, column: 1 })).slice(0, 4)).toEqual(['%', 'O2000', 'N20 M30', 'O1000 (PART)']);
  });

  it('Append is not moved by it: the end of a document is below its first lines', () => {
    expect(ok(plan(['%'], NEW, { where: 'end' })).beforeLine).toBe(2);
    expect(ok(plan(['%', ''], NEW, { where: 'end' })).beforeLine).toBe(2);
    expect(ok(plan(['O1'], NEW, { where: 'end' })).beforeLine).toBe(2);
  });
});

describe('Klartext: the inserted blocks without a number get one (NC-4)', () => {
  it('the review’s repro: L X+1 and L X+2 become blocks 4 and 5, the blocks below follow', () => {
    const answer = ok(plan(KP, ['L X+1', 'L X+2'], { where: 'cursor', line: 7, column: 1 }, KLARTEXT));
    expect(answer.lines).toEqual(['4 L X+1', '5 L X+2']);
    expect(answer.renumbered).toBe(2 + 6);
    expect(after(KP, answer).slice(6)).toEqual(['4 L X+1', '5 L X+2', '6 L X+10 R0 FMAX', '7 CALL LBL 1', '8 LBL 1', '9 L Z+100 FMAX', '10 LBL 0', '11 END PGM P MM']);
  });

  it('a tail and a blank line take no number; leading blanks of a block go', () => {
    const answer = ok(plan(KP, ['  L X+1 ~', '  F200', '', '; note', 'L X+2'], { where: 'cursor', line: 7, column: 1 }, KLARTEXT));
    expect(answer.lines).toEqual(['4 L X+1 ~', '  F200', '', '5 ; note', '6 L X+2']);
  });
});

describe('Klartext: an inserted comment line is a block and takes a number (the control numbers every line)', () => {
  it('a comment line of its own takes the next number like any block, its leading blanks go', () => {
    const answer = ok(plan(KP, ['; roughing', '  ;finishing', 'L X+1'], { where: 'cursor', line: 7, column: 1 }, KLARTEXT));
    expect(answer.lines).toEqual(['4 ; roughing', '5 ;finishing', '6 L X+1']);
    expect(after(KP, answer).slice(6, 10)).toEqual(['4 ; roughing', '5 ;finishing', '6 L X+1', '7 L X+10 R0 FMAX']);
    // Three inserted lines took a number, and the six blocks below moved up by three.
    expect(answer.renumbered).toBe(3 + 6);
  });

  it('a numbered comment line keeps its place and takes the right number; a structure line takes one too', () => {
    const answer = ok(plan(KP, ['20 ; checked', '* - PART TWO', '21 L X+1'], { where: 'cursor', line: 7, column: 1 }, KLARTEXT));
    expect(answer.lines).toEqual(['4 ; checked', '5 * - PART TWO', '6 L X+1']);
  });

  it('a comment that is the tail of a block (behind a ~ line) and a blank line take none', () => {
    const answer = ok(plan(KP, ['CYCL DEF 200 BOHREN ~', '  Q200=2 ;A', '', ';', 'L X+1'], { where: 'cursor', line: 7, column: 1 }, KLARTEXT));
    expect(answer.lines).toEqual(['4 CYCL DEF 200 BOHREN ~', '  Q200=2 ;A', '', '5 ;', '6 L X+1']);
  });

  it('a file of comment lines only: numbered, and a comment line already in the document below is renumbered as a block', () => {
    const doc = ['0 BEGIN PGM C MM', '1 L X+0', '2 ; old note', '; free note', '3 L X+1', '4 END PGM C MM'];
    const answer = ok(plan(doc, ['; new note'], { where: 'cursor', line: 3, column: 1 }, KLARTEXT));
    expect(answer.lines).toEqual(['2 ; new note']);
    // The numbered comment line below is a block (2 -> 3); the one without a number keeps what it has (rule 9).
    expect(after(doc, answer)).toEqual(['0 BEGIN PGM C MM', '1 L X+0', '2 ; new note', '3 ; old note', '; free note', '4 L X+1', '5 END PGM C MM']);
  });

  it('Fanuc keeps the file’s comment lines as they are (free numbering adds no number)', () => {
    const answer = ok(plan(PROGRAM, ['(ROUGHING)', 'N100 G1 Z-1'], { where: 'cursor', line: 3, column: 1 }));
    expect(answer.lines).toEqual(['(ROUGHING)', 'N100 G1 Z-1']);
  });
});

describe('a closing % and the end of the tape (NC-5, owner Q2(ii))', () => {
  it('Append goes before a closing lone %, also below an empty last line', () => {
    const doc = ['%', 'O2000', 'N10 G1', 'N20 M99', '%', ''];
    const answer = ok(plan(doc, ['N30 G1 X1'], { where: 'end' }));
    expect(answer.beforeLine).toBe(5);
    expect(after(doc, answer)).toEqual(['%', 'O2000', 'N10 G1', 'N20 M99', 'N30 G1 X1', '%', '']);
    expect(answer.warnings).toEqual([]);
  });

  it('behind M30 and before the closing % it warns of the program end', () => {
    expect(ok(plan(['%', 'O2000', 'N10 G1', 'N20 M30', '%'], ['N30 G1 X1'], { where: 'end' })).warnings).toEqual([{ kind: 'afterProgramEnd', line: 4 }]);
  });

  it('a file that starts a program of its own after the last one does not warn (a file of several programs)', () => {
    const answer = ok(plan(TAPE, ['O2000', 'N10 G1 X1', 'N20 M30'], { where: 'end' }));
    expect(answer.beforeLine).toBe(6);
    expect(answer.warnings).toEqual([]);
  });

  it('warns afterTapeEnd below the document’s last lone %, and not of the program end too', () => {
    expect(ok(plan(TAPE, NEW, { where: 'cursor', line: 6, column: 2 })).warnings).toEqual([{ kind: 'afterTapeEnd', line: 6 }]);
    const tail = [...TAPE, 'N50 G0 X0'];
    expect(ok(plan(tail, NEW, { where: 'end' })).warnings).toEqual([{ kind: 'afterTapeEnd', line: 6 }]);
    expect(ok(plan(tail, ['O2', 'N10 G0', 'M30'], { where: 'end' })).warnings).toEqual([{ kind: 'afterTapeEnd', line: 6 }]);
  });

  it('a % between two programs and the leading % do not end the tape', () => {
    expect(ok(plan(TWO, NEW, { where: 'cursor', line: 7, column: 3 })).warnings).toEqual([]);
    // The second program without a closing %: the % above it is the mark between the two, not the tape end.
    const open = TWO.slice(0, -1);
    expect(ok(plan(open, NEW, { where: 'cursor', line: 8, column: 1 })).warnings).toEqual([]);
    expect(ok(plan(open, NEW, { where: 'end' })).warnings).toEqual([{ kind: 'afterProgramEnd', line: 9 }]);
    // Lines that start a program of their own right below the closing % make it such a mark too.
    expect(ok(plan(TAPE, ['O2', 'N10 G0', 'M30'], { where: 'cursor', line: 6, column: 2 })).warnings).toEqual([]);
    expect(ok(plan(['%', 'O1', 'N10 G0 X0', 'N20 G1 X1'], NEW, { where: 'end' })).warnings).toEqual([]);
    expect(ok(plan(['%', 'O1', 'N10 G0 X0'], NEW, { where: 'cursor', line: 3, column: 2 })).warnings).toEqual([]);
  });

  it('Sinumerik and Okuma close the same way; Klartext has no tape', () => {
    expect(ok(plan(['$PART.MIN%', 'N10 G0 X0', 'M02', '%', ''], ['N20 G1 X1'], { where: 'end' }, OKUMA_OSP)).beforeLine).toBe(4);
    expect(ok(plan(['%_N_PART_MPF', 'N10 G0 X0', 'M30', '%'], ['N20 G1 X1'], { where: 'end' }, SINUMERIK)).beforeLine).toBe(4);
  });
});

describe('Klartext Append goes before END PGM (SK-1)', () => {
  it('the inserted blocks take the numbers before END PGM, and END PGM follows', () => {
    const doc = ['0 BEGIN PGM P MM', '1 L X+0', '2 L X+1', '3 END PGM P MM', ''];
    const answer = ok(plan(doc, ['L X+5', '7 L X+6'], { where: 'end' }, KLARTEXT));
    expect(answer.beforeLine).toBe(4);
    expect(answer.warnings).toEqual([]);
    expect(after(doc, answer)).toEqual(['0 BEGIN PGM P MM', '1 L X+0', '2 L X+1', '3 L X+5', '4 L X+6', '5 END PGM P MM', '']);
  });

  it('without a final line break too', () => {
    const KT = ['0 BEGIN PGM A MM', '1 L X+0 Y+0 FMAX', '2 L X+10', '3 L X+20', '4 END PGM A MM'];
    expect(after(KT, plan(KT, ['1 L X+1'], { where: 'end' }, KLARTEXT)).slice(-2)).toEqual(['4 L X+1', '5 END PGM A MM']);
  });

  it('a Fanuc M30 last line is no closing record: Append still goes after it', () => {
    expect(ok(plan(['O1', 'N10 G0', 'M30'], NEW, { where: 'end' })).beforeLine).toBe(4);
  });
});

describe('a file block that would join a block of the document (NC-6)', () => {
  it('Klartext: a last line that ends with ~ is refused (the review’s repro)', () => {
    const doc = ['0 BEGIN PGM P MM', '1 L X+0', '2 L X+1', '3 END PGM P MM'];
    expect(plan(doc, ['5 L X+1', '6 L X+2 ; x ~'], { where: 'cursor', line: 2, column: 3 }, KLARTEXT)).toEqual({
      ok: false,
      reason: 'continuesBlock',
      first: false,
      line: 2,
    });
  });

  it('Okuma: a first line that starts with $ is refused below a line (the review’s repro)', () => {
    expect(plan(['N10 G1 X1', 'N20 G1 X2', 'M02'], ['$Y5', 'N15 X3'], { where: 'cursor', line: 1, column: 5 }, OKUMA_OSP)).toEqual({
      ok: false,
      reason: 'continuesBlock',
      first: true,
      line: 1,
    });
  });

  it('Okuma: before the first line there is no block to join', () => {
    expect(plan(['N10 G1 X1', 'M02'], ['$Y5', 'N15 X3'], { where: 'cursor', line: 1, column: 1 }, OKUMA_OSP).ok).toBe(true);
  });

  it('a ~ or $ inside the file is its own business', () => {
    const doc = ['0 BEGIN PGM P MM', '1 L X+0', '2 END PGM P MM'];
    expect(plan(doc, ['L X+1 ~', '  F200'], { where: 'cursor', line: 2, column: 3 }, KLARTEXT).ok).toBe(true);
    expect(plan(['N10 G1 X1', 'M02'], ['N15 X3', '$Y5'], { where: 'cursor', line: 1, column: 5 }, OKUMA_OSP).ok).toBe(true);
  });
});
