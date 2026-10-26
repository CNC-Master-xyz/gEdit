// Automatic block number on Enter (Phase 4 plan §6.5 rules 2 and 3, X26). The answer for one Enter, from the
// lines around it; the key, the cursor and the edit are `contrib/typing.ts` and its test.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUTONUMBER_LOOKAHEAD, decideAutoNumber, type AutoNumberAnswer } from './autoNumber';
import { MAX_RENUMBER_LINES, type LineReader } from './blockNumbering';
import { compileProfile } from '$lib/core/profiles/compile';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import { cpOf, profileOf } from '../../../../tests/unit/helpers/profiles';

const FIXTURES = new URL('../../../../tests/fixtures/p4c/typing/', import.meta.url);
const linesOf = (name: string): string[] => readFileSync(new URL(name, FIXTURES), 'utf8').replace(/\n$/, '').split('\n');

const FANUC = cpOf('fanuc-gcode');
const KLARTEXT = cpOf('heidenhain-klartext');

/** Enter at the end of `line` (or at `column`) of `lines`. */
function enter(lines: readonly string[], line: number, cp: CompiledProfile, extra: { column?: number; inPane?: boolean } = {}): AutoNumberAnswer {
  const read: LineReader = (n) => lines[n - 1] ?? '';
  const column = extra.column ?? (lines[line - 1] ?? '').length + 1;
  return decideAutoNumber({ line, column, lineCount: lines.length, read, inPane: extra.inPane }, cp);
}

function variant(id: string, numbering: Partial<Profile['numbering']>): CompiledProfile {
  const base = profileOf(id);
  return compileProfile({ ...base, numbering: { ...base.numbering, ...numbering } });
}

const numbered = (text: string, number: number) => ({ kind: 'number', text, number, shifts: [] });

describe('free numbering (X26)', () => {
  it('Enter after N120 G1 X5. starts N130 (the profile step, prefix, one blank)', () => {
    expect(enter(['N120 G1 X5.'], 1, FANUC)).toEqual(numbered('N130 ', 130));
    expect(enter(['N10 G0 X0'], 1, cpOf('okuma-osp'))).toEqual(numbered('N20 ', 20));
    expect(enter(['N10 G0 X0'], 1, cpOf('sinumerik'))).toEqual(numbered('N20 ', 20));
    expect(enter(['N10 G0 X0'], 1, cpOf('sinumerik-mill'))).toEqual(numbered('N20 ', 20));
    expect(enter(['N10 G0 X0'], 1, cpOf('fanuc-lathe'))).toEqual(numbered('N20 ', 20));
  });

  it('writes numbering.digits and numbering.spacesAfter, not the base block’s own spelling', () => {
    expect(enter(['N0010 G0 X0'], 1, FANUC)).toEqual(numbered('N20 ', 20));
    expect(enter(['N10 G0 X0'], 1, variant('fanuc-gcode', { digits: 4, step: 5, spacesAfter: 2 }))).toEqual(numbered('N0015  ', 15));
  });

  it('reads the gaps of the fixture: the step, the number between, no gap', () => {
    const lines = linesOf('fanuc-gaps.nc');
    // N100 then N110: the step would reach N110, so the number between is N105.
    expect(enter(lines, 3, FANUC)).toEqual(numbered('N105 ', 105));
    // N110, a comment line, N120: the comment is passed over, so N115.
    expect(enter(lines, 4, FANUC)).toEqual(numbered('N115 ', 115));
    // N120 then N125: N122.
    expect(enter(lines, 6, FANUC)).toEqual(numbered('N122 ', 122));
    // N125 then N126: nothing fits, and the answer names the pair.
    expect(enter(lines, 7, FANUC)).toEqual({ kind: 'none', reason: 'noGap', between: [125, 126] });
    // N126 then N130: N128.
    expect(enter(lines, 8, FANUC)).toEqual(numbered('N128 ', 128));
    // N130 M30 with only `%` below: N140.
    expect(enter(lines, 9, FANUC)).toEqual(numbered('N140 ', 140));
  });

  it('N120 and N121 is noGap', () => {
    expect(enter(['N120 G1 X1.', 'N121 G1 X2.'], 1, FANUC)).toEqual({ kind: 'none', reason: 'noGap', between: [120, 121] });
  });

  it('uses the step when the next block is far enough above it', () => {
    expect(enter(['N120 G1 X1.', 'N200 G1 X2.'], 1, FANUC)).toEqual(numbered('N130 ', 130));
  });

  it('a smaller number below is a restart, a subprogram or another program: no ceiling', () => {
    expect(enter(['N120 M30', '%', 'O2000', 'N10 G0 X0'], 1, FANUC)).toEqual(numbered('N130 ', 130));
    expect(enter(['N120 G1 X1.', 'N110 G1 X2.'], 1, FANUC)).toEqual(numbered('N130 ', 130));
  });

  it('an equal number below is a ceiling: nothing fits, noGap (NC-10: N10, N10, N20 never types a second N20)', () => {
    expect(enter(['N120 G1 X1.', 'N120 G1 X2.'], 1, FANUC)).toEqual({ kind: 'none', reason: 'noGap', between: [120, 120] });
    expect(enter(['N10 G1 X1.', 'N10 G1 X2.', 'N20 G1 X3.'], 1, FANUC)).toEqual({ kind: 'none', reason: 'noGap', between: [10, 10] });
    // The second N10 still numbers against N20.
    expect(enter(['N10 G1 X1.', 'N10 G1 X2.', 'N20 G1 X3.'], 2, FANUC)).toEqual(numbered('N15 ', 15));
  });

  it(`the ceiling is looked for within ${AUTONUMBER_LOOKAHEAD} lines only`, () => {
    const far = ['N120 G1 X1.', ...Array.from({ length: AUTONUMBER_LOOKAHEAD }, () => 'G1 X2.'), 'N125 G1 X3.'];
    expect(enter(far, 1, FANUC)).toEqual(numbered('N130 ', 130));
    const near = ['N120 G1 X1.', ...Array.from({ length: AUTONUMBER_LOOKAHEAD - 1 }, () => 'G1 X2.'), 'N125 G1 X3.'];
    expect(enter(near, 1, FANUC)).toEqual(numbered('N122 ', 122));
  });

  it('a candidate above numbering.max is overflow and never wraps', () => {
    // Okuma: max 9999, onOverflow `stop`; Fanuc: max 99999, onOverflow `wrap` — typing never wraps either way.
    expect(enter(['N9995 G1 X1'], 1, cpOf('okuma-osp'))).toEqual({ kind: 'none', reason: 'overflow', max: 9999 });
    expect(enter(['N99990 G1 X1.'], 1, FANUC)).toEqual({ kind: 'none', reason: 'overflow', max: 99999 });
    // A ceiling under the maximum still leaves room between.
    expect(enter(['N9990 G1 X1', 'N9999 M30'], 1, cpOf('okuma-osp'))).toEqual(numbered('N9994 ', 9994));
  });

  it('a base block without a number, a line that is only its number, the program marker: plain Enter, nothing said', () => {
    expect(enter(['G1 X5.'], 1, FANUC)).toEqual({ kind: 'plain' });
    expect(enter(['N130 '], 1, FANUC)).toEqual({ kind: 'plain' });
    expect(enter(['N130'], 1, FANUC)).toEqual({ kind: 'plain' });
    expect(enter(['%'], 1, FANUC)).toEqual({ kind: 'plain' });
    expect(enter(['O1001'], 1, FANUC)).toEqual({ kind: 'plain' });
    expect(enter(['(N10 IN A COMMENT)'], 1, FANUC)).toEqual({ kind: 'plain' });
    expect(enter([''], 1, FANUC)).toEqual({ kind: 'plain' });
    // An Okuma sequence name is a label, not a block number.
    expect(enter(['NLAP1 G1 X10'], 1, cpOf('okuma-osp'))).toEqual({ kind: 'plain' });
  });

  it('only at the end of the text: Enter in the middle of a line is the editor’s; blanks after the cursor do not count', () => {
    expect(enter(['N120 G1 X5.'], 1, FANUC, { column: 5 })).toEqual({ kind: 'plain' });
    expect(enter(['N120 G1 X5.   '], 1, FANUC, { column: 12 })).toEqual(numbered('N130 ', 130));
    expect(enter(['N120 G1 X5.'], 1, FANUC, { column: 0 })).toEqual({ kind: 'plain' });
  });

  it('a block-skip mark is not copied, and the number is read behind it', () => {
    expect(enter(['/N120 G1 X5.'], 1, FANUC)).toEqual(numbered('N130 ', 130));
    expect(enter(['/2 N120 G1 X5.'], 1, FANUC)).toEqual(numbered('N130 ', 130));
  });

  it('a Sinumerik main block is read as a number; the new line is an N block', () => {
    expect(enter([':100 G0 X0', 'N200 G1 X1'], 1, cpOf('sinumerik'))).toEqual(numbered('N110 ', 110));
  });
});

describe('continued blocks (X26: a line that continues a block is never numbered)', () => {
  const OKUMA = cpOf('okuma-osp');

  it('Okuma: Enter on a `$` line numbers after the head of its block', () => {
    expect(enter(['N10 G1 X10', '$ Y20', 'N30 G0 Z50'], 2, OKUMA)).toEqual(numbered('N20 ', 20));
    expect(enter(['N10 G1 X10', '$ Y20', '$ Z5'], 3, OKUMA)).toEqual(numbered('N20 ', 20));
  });

  it('Okuma: Enter at the end of a block whose next line is its `$` tail is plain (the new line would take the tail over)', () => {
    expect(enter(['N10 G1 X10', '$ Y20', 'N30 G0 Z50'], 1, OKUMA)).toEqual({ kind: 'plain' });
  });

  it('Okuma: the `$` tails below are passed over when the ceiling is looked for', () => {
    expect(enter(['N10 G1 X10', '$ Y20', 'G1 X5', '$ Y5', 'N15 M2'], 2, OKUMA)).toEqual(numbered('N12 ', 12));
  });

  it('Klartext: a line ending with `~` gives a plain Enter; its tail numbers after the head', () => {
    const plate = linesOf('klartext-plate.h');
    expect(enter(plate, 10, KLARTEXT)).toEqual({ kind: 'plain' });
    const tail = enter(plate, 11, KLARTEXT);
    expect(tail.kind === 'number' && [tail.text, tail.number]).toEqual(['9 ', 9]);
  });

  it(`a head further up than ${AUTONUMBER_LOOKAHEAD} lines is not looked for: plain Enter`, () => {
    const lines = ['N10 G1 X10', ...Array.from({ length: AUTONUMBER_LOOKAHEAD + 1 }, () => '$ Y20')];
    expect(enter(lines, lines.length, OKUMA)).toEqual({ kind: 'plain' });
  });
});

describe('consecutive numbering (Klartext, rule 3)', () => {
  const plate = linesOf('klartext-plate.h');

  it('the new line is base + 1 and the blocks below take new numbers in the same answer, up to END PGM', () => {
    const answer = enter(plate, 9, KLARTEXT); // `7 L Z-2 F200`
    expect(answer.kind).toBe('number');
    if (answer.kind !== 'number') return;
    expect([answer.text, answer.number]).toEqual(['8 ', 8]);
    // Line 11 is the tail of block 8 (`~`): it keeps what it has.
    expect(answer.shifts.map((s) => [s.line, s.text])).toEqual([
      [10, '9'],
      [12, '10'],
      [13, '11'],
      [14, '12'],
    ]);
  });

  it('after BEGIN PGM the new line is block 1 and every block below moves', () => {
    const answer = enter(plate, 1, KLARTEXT);
    expect(answer.kind === 'number' && [answer.text, answer.shifts.length, answer.shifts.at(-1)?.text]).toEqual(['1 ', 11, '12']);
  });

  it('Enter on the END PGM line is plain: no numbered block after the program end (NC-9)', () => {
    expect(enter(plate, 14, KLARTEXT)).toEqual({ kind: 'plain' });
    expect(enter(['0 BEGIN PGM T MM', '1 L X+1', '2 END PGM T MM', '0 BEGIN PGM U MM'], 3, KLARTEXT)).toEqual({ kind: 'plain' });
    // The block above END PGM still numbers, and END PGM follows.
    expect(enter(plate, 13, KLARTEXT)).toEqual({ kind: 'number', text: '11 ', number: 11, shifts: [{ line: 14, startColumn: 1, endColumn: 3, text: '12' }] });
  });

  it(`more than ${MAX_RENUMBER_LINES} blocks below is tooManyBelow, the program untouched`, () => {
    const count = MAX_RENUMBER_LINES + 2;
    const big = ['0 BEGIN PGM BIG MM', ...Array.from({ length: count }, (_, i) => `${i + 1} L X+${i % 100}`), `${count + 1} END PGM BIG MM`];
    expect(enter(big, 1, KLARTEXT)).toEqual({ kind: 'none', reason: 'tooManyBelow', limit: MAX_RENUMBER_LINES });
    // Near the end the shift is small enough.
    const late = enter(big, big.length - 10, KLARTEXT);
    expect(late.kind === 'number' && late.shifts.length).toBe(10);
  });

  it('a number above numbering.max, for the new line or one below, is overflow', () => {
    const capped = variant('heidenhain-klartext', { max: 11 });
    // The new line would be 8, but END PGM would become 12.
    expect(enter(plate, 9, capped)).toEqual({ kind: 'none', reason: 'overflow', max: 11 });
    // The new line itself would be 11 (above block 10, the last before END PGM).
    expect(enter(plate, 13, variant('heidenhain-klartext', { max: 10 }))).toEqual({ kind: 'none', reason: 'overflow', max: 10 });
  });

  it('a comment line without a number is the editor’s Enter', () => {
    expect(enter(plate, 6, KLARTEXT)).toEqual({ kind: 'plain' });
  });
});

describe('channel panes (rule 3)', () => {
  it('free numbering works from the pane’s own lines', () => {
    expect(enter(['N10 G0 X0', 'N20 G1 X1'], 1, FANUC, { inPane: true })).toEqual(numbered('N15 ', 15));
  });

  it('consecutive numbering is inPane: the blocks below belong to the other channels too', () => {
    expect(enter(linesOf('klartext-plate.h'), 9, KLARTEXT, { inPane: true })).toEqual({ kind: 'none', reason: 'inPane' });
  });
});
