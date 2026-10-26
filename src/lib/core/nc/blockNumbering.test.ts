// The numbering helpers shared by auto-number and Insert File (Phase 4 plan §6.5 rule 9). P4.12 writes them first.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MAX_RENUMBER_LINES,
  blockNumberLabel,
  consecutiveRenumbering,
  formatBlockNumber,
  isLoneTapeMark,
  isProgramEndLine,
  isProgramHeaderLine,
  type LineReader,
  type NumberEdit,
} from './blockNumbering';
import { compileProfile } from '$lib/core/profiles/compile';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import { cpOf, profileOf } from '../../../../tests/unit/helpers/profiles';

const FIXTURES = new URL('../../../../tests/fixtures/p4c/typing/', import.meta.url);
const linesOf = (name: string): string[] => readFileSync(new URL(name, FIXTURES), 'utf8').replace(/\n$/, '').split('\n');
const readerOf = (lines: readonly string[]): LineReader => (n) => lines[n - 1] ?? '';

/** A built-in profile with its numbering (and block-number syntax) changed. */
function variant(id: string, numbering: Partial<Profile['numbering']>, blockNumber?: Partial<Profile['syntax']['blockNumber']>): CompiledProfile {
  const base = profileOf(id);
  return compileProfile({
    ...base,
    numbering: { ...base.numbering, ...numbering },
    syntax: blockNumber ? { ...base.syntax, blockNumber: { ...base.syntax.blockNumber, ...blockNumber } } : base.syntax,
  });
}

/** The lines with the edits applied (right to left within a line). */
function apply(lines: readonly string[], edits: readonly NumberEdit[]): string[] {
  const out = [...lines];
  const sorted = [...edits].sort((a, b) => a.line - b.line || b.startColumn - a.startColumn);
  for (const e of sorted) {
    const text = out[e.line - 1];
    out[e.line - 1] = text.slice(0, e.startColumn - 1) + e.text + text.slice(e.endColumn - 1);
  }
  return out;
}

describe('formatBlockNumber', () => {
  it('pins the renumber limit of the contract', () => {
    expect(MAX_RENUMBER_LINES).toBe(5000);
  });

  it('writes the prefix, the digits and one blank by default', () => {
    expect(formatBlockNumber(130, cpOf('fanuc-gcode'))).toBe('N130 ');
    expect(formatBlockNumber(10, cpOf('okuma-osp'))).toBe('N10 ');
    expect(formatBlockNumber(20, cpOf('sinumerik'))).toBe('N20 ');
    // Klartext numbers with the leading integer: no prefix; spacesAfter is absent there, so one blank.
    expect(formatBlockNumber(12, cpOf('heidenhain-klartext'))).toBe('12 ');
  });

  it('pads to numbering.digits and writes numbering.spacesAfter blanks', () => {
    const cp = variant('fanuc-gcode', { digits: 4, spacesAfter: 2 });
    expect(formatBlockNumber(30, cp)).toBe('N0030  ');
    expect(formatBlockNumber(123456, variant('fanuc-gcode', { digits: 4, max: 999999 }))).toBe('N123456 ');
    expect(formatBlockNumber(5, variant('fanuc-gcode', { spacesAfter: 0 }))).toBe('N5');
  });

  it('is null above numbering.max, below 0 and for a fraction', () => {
    const cp = cpOf('okuma-osp'); // max 9999
    expect(formatBlockNumber(9999, cp)).toBe('N9999 ');
    expect(formatBlockNumber(10000, cp)).toBeNull();
    expect(formatBlockNumber(-1, cp)).toBeNull();
    expect(formatBlockNumber(1.5, cp)).toBeNull();
  });

  it('never writes an altPrefix or the main-block prefix', () => {
    // Sinumerik has a main-block prefix `:`; a new line is always an `N` block.
    expect(cpOf('sinumerik').profile.syntax.blockNumber.mainPrefix).toBe(':');
    expect(formatBlockNumber(40, cpOf('sinumerik'))).toBe('N40 ');
    expect(formatBlockNumber(40, variant('fanuc-gcode', {}, { altPrefixes: ['n', 'B'] }))).toBe('N40 ');
  });

  it('is null for a prefix profile that names no prefix', () => {
    expect(formatBlockNumber(10, variant('fanuc-gcode', {}, { prefix: undefined }))).toBeNull();
  });

  it('labels a number for a message without the blanks', () => {
    expect(blockNumberLabel(120, cpOf('fanuc-gcode'))).toBe('N120');
    expect(blockNumberLabel(7, variant('fanuc-gcode', { digits: 3 }))).toBe('N007');
    expect(blockNumberLabel(12, cpOf('heidenhain-klartext'))).toBe('12');
  });
});

describe('consecutiveRenumbering (Klartext)', () => {
  const cp = cpOf('heidenhain-klartext');
  const plate = linesOf('klartext-plate.h');

  it('reads the fixture as the README says', () => {
    expect(plate).toHaveLength(14);
    expect(plate[0]).toMatch(/^0 BEGIN PGM/);
    expect(isProgramEndLine(plate[13], cp)).toBe(true);
  });

  it('numbers the blocks from fromLine to END PGM with firstNumber, +1, …, replacing the digits only', () => {
    // Enter after block 6 (line 8): the new line is 7, the blocks below start at 8.
    const answer = consecutiveRenumbering(readerOf(plate), plate.length, 9, 8, cp, MAX_RENUMBER_LINES);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.last).toBe(12);
    expect(answer.edits.map((e) => e.line)).toEqual([9, 10, 12, 13, 14]);
    expect(answer.edits[0]).toEqual({ line: 9, startColumn: 1, endColumn: 2, text: '8' });
    const after = apply(plate, answer.edits);
    expect(after.slice(8)).toEqual([
      '8 L Z-2 F200',
      '9 L X+90 Y+10 RL ~',
      '  F400',
      '10 L X+90 Y+70',
      '11 L Z+50 R0 FMAX M30',
      '12 END PGM PLATE MM',
    ]);
  });

  it('keeps a continuation line and a comment line without a number as they are', () => {
    const answer = consecutiveRenumbering(readerOf(plate), plate.length, 2, 2, cp, MAX_RENUMBER_LINES);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    const touched = new Set(answer.edits.map((e) => e.line));
    expect(touched.has(6)).toBe(false); // `; roughing pass`
    expect(touched.has(11)).toBe(false); // `  F400`, the tail of block 8
    const after = apply(plate, answer.edits);
    expect(after[5]).toBe(plate[5]);
    expect(after[10]).toBe(plate[10]);
    expect(after[13]).toBe('12 END PGM PLATE MM');
  });

  it('a numbered comment line (`2 ; text`, as the control writes it) is a block and moves with the others', () => {
    const lines = ['0 BEGIN PGM C MM', '1 L X+0', '2 ; note', '; free note', '3 * - PART TWO', '4 L X+1', '5 END PGM C MM'];
    const answer = consecutiveRenumbering(readerOf(lines), lines.length, 3, 7, cp, MAX_RENUMBER_LINES);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(apply(lines, answer.edits).slice(2)).toEqual(['7 ; note', '; free note', '8 * - PART TWO', '9 L X+1', '10 END PGM C MM']);
    expect(answer.last).toBe(10);
  });

  it('changes nothing when the numbers are already right, and says the last one', () => {
    const answer = consecutiveRenumbering(readerOf(plate), plate.length, 2, 1, cp, MAX_RENUMBER_LINES);
    expect(answer).toEqual({ ok: true, edits: [], last: 11 });
  });

  it('starts at the tail of a block as a tail: the line after a `~` line is not a block', () => {
    // From line 11 (`  F400`, the tail of block 8): the next block is line 12.
    const answer = consecutiveRenumbering(readerOf(plate), plate.length, 11, 20, cp, MAX_RENUMBER_LINES);
    expect(answer.ok && answer.edits.map((e) => [e.line, e.text])).toEqual([
      [12, '20'],
      [13, '21'],
      [14, '22'],
    ]);
  });

  it('stops after END PGM and before a BEGIN PGM: block 0 of a program is never renumbered', () => {
    const two = [...plate, '0 BEGIN PGM NEXT MM', '1 L Z+50 R0 FMAX', '2 END PGM NEXT MM'];
    const answer = consecutiveRenumbering(readerOf(two), two.length, 13, 30, cp, MAX_RENUMBER_LINES);
    expect(answer.ok && answer.edits.map((e) => e.line)).toEqual([13, 14]);
    // A walk that meets a program start before any end stops in front of it.
    const noEnd = ['0 BEGIN PGM A MM', '1 L X+0', '0 BEGIN PGM B MM', '1 L X+0'];
    const second = consecutiveRenumbering(readerOf(noEnd), noEnd.length, 2, 5, cp, MAX_RENUMBER_LINES);
    expect(second.ok && second.edits).toEqual([{ line: 2, startColumn: 1, endColumn: 2, text: '5' }]);
  });

  it('reads END PGM and BEGIN PGM outside comments only: a comment that names them does not end the walk', () => {
    const lines = ['0 BEGIN PGM A MM', '1 L X+0 ; END PGM comes later', '; BEGIN PGM is not here', '2 L X+10', '3 END PGM A MM'];
    const answer = consecutiveRenumbering(readerOf(lines), lines.length, 2, 5, cp, MAX_RENUMBER_LINES);
    expect(answer.ok && answer.edits.map((e) => [e.line, e.text])).toEqual([
      [2, '5'],
      [4, '6'],
      [5, '7'],
    ]);
  });

  it('runs to the last line when there is no END PGM', () => {
    const open = ['0 BEGIN PGM A MM', '1 L X+0', '2 L X+10'];
    const answer = consecutiveRenumbering(readerOf(open), open.length, 2, 2, cp, MAX_RENUMBER_LINES);
    expect(answer).toEqual({
      ok: true,
      edits: [
        { line: 2, startColumn: 1, endColumn: 2, text: '2' },
        { line: 3, startColumn: 1, endColumn: 2, text: '3' },
      ],
      last: 3,
    });
  });

  it('is tooMany above maxLines changed lines and reads no further than that', () => {
    const lines = ['0 BEGIN PGM BIG MM', ...Array.from({ length: 50 }, (_, i) => `${i + 1} L X+${i}`), '51 END PGM BIG MM'];
    let reads = 0;
    const read: LineReader = (n) => {
      reads++;
      return lines[n - 1] ?? '';
    };
    expect(consecutiveRenumbering(read, lines.length, 2, 2, cp, 10)).toEqual({ ok: false, reason: 'tooMany' });
    expect(reads).toBeLessThan(15);
    // Exactly maxLines changes is still fine.
    expect(consecutiveRenumbering(readerOf(lines), lines.length, 43, 43, cp, 10)).toMatchObject({ ok: true, last: 52 });
  });

  it('is overflow when a number would pass numbering.max', () => {
    const capped = variant('heidenhain-klartext', { max: 11 });
    expect(consecutiveRenumbering(readerOf(plate), plate.length, 9, 8, capped, MAX_RENUMBER_LINES)).toEqual({
      ok: false,
      reason: 'overflow',
    });
  });

  it('keeps a block-skip mark and the blanks after the number, and pads to numbering.digits', () => {
    const lines = ['0 BEGIN PGM A MM', '/1  L X+0', '2 L X+10', '3 END PGM A MM'];
    const answer = consecutiveRenumbering(readerOf(lines), lines.length, 2, 7, variant('heidenhain-klartext', { digits: 2 }), 100);
    expect(answer.ok && apply(lines, answer.edits)).toEqual(['0 BEGIN PGM A MM', '/07  L X+0', '08 L X+10', '09 END PGM A MM']);
  });
});

describe('consecutiveRenumbering in other profiles', () => {
  it('replaces only the digits after the prefix and skips an Okuma `$` continuation line', () => {
    const cp = cpOf('okuma-osp');
    const lines = ['N10 G0 X0', '$ Y0', 'N20 G1 X1', '(note)', 'N30 M2'];
    const answer = consecutiveRenumbering(readerOf(lines), lines.length, 1, 1, cp, 100);
    expect(answer.ok && apply(lines, answer.edits)).toEqual(['N1 G0 X0', '$ Y0', 'N2 G1 X1', '(note)', 'N3 M2']);
  });

  it('keeps the main-block prefix of a Sinumerik block', () => {
    const cp = cpOf('sinumerik');
    const lines = ['N10 G0 X0', ':20 G1 X1', 'N30 M30'];
    const answer = consecutiveRenumbering(readerOf(lines), lines.length, 2, 11, cp, 100);
    expect(answer.ok && apply(lines, answer.edits)).toEqual(['N10 G0 X0', ':11 G1 X1', 'N12 M30']);
  });
});

describe('the frame readers Insert File shares (P4c review, F1)', () => {
  it('isLoneTapeMark: a % with only blanks around it, in a profile that has a tape', () => {
    for (const id of ['fanuc-gcode', 'fanuc-lathe', 'okuma-osp', 'sinumerik']) {
      const cp = cpOf(id);
      expect(isLoneTapeMark('%', cp), id).toBe(true);
      expect(isLoneTapeMark('  %\t', cp), id).toBe(true);
      for (const line of ['', '%%', '% (X)', '%_N_A_MPF', 'N10 %', '$A.MIN%']) expect(isLoneTapeMark(line, cp), `${id} ${line}`).toBe(false);
    }
    expect(isLoneTapeMark('%', cpOf('heidenhain-klartext'))).toBe(false);
  });

  it('isProgramHeaderLine: the profile’s header as written (Okuma $NAME.MIN%, Sinumerik %_N_NAME_MPF), none elsewhere', () => {
    expect(isProgramHeaderLine('$PART.MIN%', cpOf('okuma-osp'))).toBe(true);
    expect(isProgramHeaderLine('$Y5', cpOf('okuma-osp'))).toBe(false);
    expect(isProgramHeaderLine('%_N_PART_MPF', cpOf('sinumerik'))).toBe(true);
    expect(isProgramHeaderLine(';%_N_PART_MPF', cpOf('sinumerik'))).toBe(true);
    expect(isProgramHeaderLine('N10 G0 X0', cpOf('sinumerik'))).toBe(false);
    expect(isProgramHeaderLine('O1000', cpOf('fanuc-gcode'))).toBe(false);
    expect(isProgramHeaderLine('0 BEGIN PGM A MM', cpOf('heidenhain-klartext'))).toBe(false);
  });
});
