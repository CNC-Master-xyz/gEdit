// Select or delete a block range (Phase 4 plan §6.5 rule 7): the pure resolver, every refusal, the continuation lines
// and each dialect's way of numbering. The form and the commands are `contrib/ranges.test.ts`.

import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { blockLabel, indexBlocks, MAX_LISTED_LINES, resolveBlockRange, type BlockRangeAnswer } from './blockRange';
import type { CompiledProfile } from '$lib/core/profiles/types';

function compiled(id: string): CompiledProfile {
  const raw = BUILTIN_PROFILE_JSON.find((entry) => (entry as { id?: string }).id === id);
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  return compileProfile(checked.profile);
}

const FANUC = compiled('fanuc-gcode');
const KLARTEXT = compiled('heidenhain-klartext');
const SINUMERIK = compiled('sinumerik');
const OKUMA = compiled('okuma-osp');

function range(text: string, cp: CompiledProfile, kind: 'line' | 'block', from: string, to: string): BlockRangeAnswer {
  const lines = text.split('\n');
  return resolveBlockRange((line) => lines[line - 1] ?? '', lines.length, cp, { kind, from, to });
}

const FANUC_PROGRAM = [
  'O1000', //                         1
  'N10 G90 G54', //                   2
  'N20 G1 X1 (N999 is a comment)', // 3
  'N30 G1 X2', //                     4
  '(N40 not a block)', //             5
  'N50 G1 X3', //                     6
  'N60 M30', //                       7
  '%', //                             8
].join('\n');

describe('line numbers', () => {
  it('selects the inclusive lines', () => {
    expect(range(FANUC_PROGRAM, FANUC, 'line', '2', '4')).toEqual({ ok: true, startLine: 2, endLine: 4, blocks: null });
    expect(range(FANUC_PROGRAM, FANUC, 'line', ' 3 ', '3')).toEqual({ ok: true, startLine: 3, endLine: 3, blocks: null });
    expect(range(FANUC_PROGRAM, FANUC, 'line', '1', '8')).toEqual({ ok: true, startLine: 1, endLine: 8, blocks: null });
  });

  it('refuses what is not a whole number (notNumber, and the field that is wrong)', () => {
    for (const bad of ['', 'abc', '1.5', '-2', 'N10', '1e3', '2 3']) {
      expect(range(FANUC_PROGRAM, FANUC, 'line', bad, '4'), bad).toEqual({ ok: false, reason: 'notNumber', field: 'from' });
      expect(range(FANUC_PROGRAM, FANUC, 'line', '2', bad), bad).toEqual({ ok: false, reason: 'notNumber', field: 'to' });
    }
  });

  it('refuses a line outside the program and names the line count (outsideProgram)', () => {
    expect(range(FANUC_PROGRAM, FANUC, 'line', '0', '4')).toEqual({ ok: false, reason: 'outsideProgram', field: 'from', lineCount: 8 });
    expect(range(FANUC_PROGRAM, FANUC, 'line', '2', '9')).toEqual({ ok: false, reason: 'outsideProgram', field: 'to', lineCount: 8 });
    expect(range(FANUC_PROGRAM, FANUC, 'line', '99', '100')).toMatchObject({ reason: 'outsideProgram', field: 'from' });
    expect(range(FANUC_PROGRAM, FANUC, 'line', '2', '9'.repeat(400))).toMatchObject({ reason: 'outsideProgram', field: 'to' });
  });

  it('refuses a first line below the last (reversed)', () => {
    expect(range(FANUC_PROGRAM, FANUC, 'line', '5', '4')).toEqual({ ok: false, reason: 'reversed' });
  });

  it('judges the first field first: a wrong number is reported before a number outside the program', () => {
    expect(range(FANUC_PROGRAM, FANUC, 'line', '99', 'x')).toMatchObject({ reason: 'notNumber', field: 'to' });
    expect(range(FANUC_PROGRAM, FANUC, 'line', '99', '1')).toMatchObject({ reason: 'outsideProgram', field: 'from' });
  });
});

describe('block numbers', () => {
  it('reads 30 and N30 alike, in either case and with a blank', () => {
    const want = { ok: true, startLine: 3, endLine: 6, blocks: { from: 20, to: 50 } };
    expect(range(FANUC_PROGRAM, FANUC, 'block', '20', '50')).toEqual(want);
    expect(range(FANUC_PROGRAM, FANUC, 'block', 'N20', 'N50')).toEqual(want);
    expect(range(FANUC_PROGRAM, FANUC, 'block', 'n 20', ' 50 ')).toEqual(want);
  });

  it('takes one block when both numbers are the same', () => {
    expect(range(FANUC_PROGRAM, FANUC, 'block', 'N30', '30')).toEqual({ ok: true, startLine: 4, endLine: 4, blocks: { from: 30, to: 30 } });
  });

  it('refuses a text that is not a block number (notNumber)', () => {
    for (const bad of ['', 'abc', 'N', 'N1.5', '-3', 'N10N20', 'G10', 'X10', 'O10', 'P10', 'NN10', ':10', '10N']) {
      expect(range(FANUC_PROGRAM, FANUC, 'block', bad, 'N50'), bad).toEqual({ ok: false, reason: 'notNumber', field: 'from' });
      expect(range(FANUC_PROGRAM, FANUC, 'block', 'N10', bad), bad).toEqual({ ok: false, reason: 'notNumber', field: 'to' });
    }
  });

  it('refuses a number that is not in the program (missingBlock), and a number that is only in a comment', () => {
    expect(range(FANUC_PROGRAM, FANUC, 'block', 'N15', 'N50')).toEqual({ ok: false, reason: 'missingBlock', field: 'from', number: 15 });
    expect(range(FANUC_PROGRAM, FANUC, 'block', 'N10', 'N70')).toEqual({ ok: false, reason: 'missingBlock', field: 'to', number: 70 });
    expect(range(FANUC_PROGRAM, FANUC, 'block', 'N10', 'N999')).toMatchObject({ reason: 'missingBlock', number: 999 });
    expect(range(FANUC_PROGRAM, FANUC, 'block', 'N40', 'N50')).toMatchObject({ reason: 'missingBlock', number: 40 });
  });

  it('refuses a first block that comes after the last (reversed)', () => {
    expect(range(FANUC_PROGRAM, FANUC, 'block', 'N50', 'N20')).toEqual({ ok: false, reason: 'reversed' });
  });

  it('refuses a number that two blocks carry (duplicateBlock) and names the lines; it never guesses', () => {
    const text = ['N10 G1 X1', 'N20 G1 X2', 'N30 M99', 'N10 G1 X3', 'N40 G1 X4'].join('\n');
    expect(range(text, FANUC, 'block', 'N10', 'N40')).toEqual({ ok: false, reason: 'duplicateBlock', field: 'from', number: 10, lines: [1, 4], total: 2 });
    expect(range(text, FANUC, 'block', 'N20', 'N10')).toEqual({ ok: false, reason: 'duplicateBlock', field: 'to', number: 10, lines: [1, 4], total: 2 });
    // Go to Block takes the next one after the cursor; the range does not choose.
    expect(range(text, FANUC, 'block', 'N20', 'N30')).toMatchObject({ ok: true });
  });

  it('lists at most five lines and says how many there are', () => {
    const text = Array.from({ length: 8 }, (_, i) => `N10 G1 X${i}`).join('\n');
    const answer = range(text, FANUC, 'block', 'N10', 'N10');
    expect(answer).toMatchObject({ ok: false, reason: 'duplicateBlock', total: 8 });
    expect((answer as { lines: number[] }).lines).toEqual([1, 2, 3, 4, 5]);
    expect(MAX_LISTED_LINES).toBe(5);
  });

  it('reads the first field first: a missing first block is reported before a duplicate last one', () => {
    const text = ['N10 G1', 'N10 G1', 'N20 G1'].join('\n');
    expect(range(text, FANUC, 'block', 'N15', 'N10')).toMatchObject({ reason: 'missingBlock', field: 'from' });
    expect(range(text, FANUC, 'block', 'N20', 'N15')).toMatchObject({ reason: 'missingBlock', field: 'to' });
  });
});

describe('the block runs to its last continuation line', () => {
  const KLARTEXT_PROGRAM = [
    '0 BEGIN PGM TEST MM', //   1
    '1 L X+1 Y+1 ~', //          2
    '  Z+2 ~', //                3
    '  F100', //                 4
    '2 L X+5', //                5
    '3 L X+6 ~', //              6
    '  Y+7 ~', //                7
    '  Z+8', //                  8
    '4 END PGM TEST MM', //      9
  ].join('\n');

  it('Klartext: a block continued with ~ is never cut in two', () => {
    expect(range(KLARTEXT_PROGRAM, KLARTEXT, 'block', '1', '1')).toEqual({ ok: true, startLine: 2, endLine: 4, blocks: { from: 1, to: 1 } });
    expect(range(KLARTEXT_PROGRAM, KLARTEXT, 'block', '2', '3')).toEqual({ ok: true, startLine: 5, endLine: 8, blocks: { from: 2, to: 3 } });
    expect(range(KLARTEXT_PROGRAM, KLARTEXT, 'block', '1', '4')).toEqual({ ok: true, startLine: 2, endLine: 9, blocks: { from: 1, to: 4 } });
  });

  it('a continuation line is not a head: its number-looking start is no block number', () => {
    const text = ['1 L X+1 ~', '5 Y+2', '2 L X+3'].join('\n');
    // Line 2 continues block 1 and its "5" is part of the block.
    expect(range(text, KLARTEXT, 'block', '5', '5')).toMatchObject({ ok: false, reason: 'missingBlock', number: 5 });
    expect(range(text, KLARTEXT, 'block', '1', '1')).toEqual({ ok: true, startLine: 1, endLine: 2, blocks: { from: 1, to: 1 } });
  });

  it('the from block starts at its own line, whatever it continues to', () => {
    expect(range(KLARTEXT_PROGRAM, KLARTEXT, 'block', '3', '4')).toEqual({ ok: true, startLine: 6, endLine: 9, blocks: { from: 3, to: 4 } });
  });

  it('a continued last block at the program end runs to the last line', () => {
    const text = ['1 L X+1', '2 L X+2 ~', '  Y+3 ~'].join('\n');
    expect(range(text, KLARTEXT, 'block', '2', '2')).toEqual({ ok: true, startLine: 2, endLine: 3, blocks: { from: 2, to: 2 } });
  });

  it('Okuma: a line that starts with $ continues the block above', () => {
    const text = ['N10 G1 X1', '$ Y2', '$ Z3', 'N20 G1 X4', 'N30 M30'].join('\n');
    expect(range(text, OKUMA, 'block', 'N10', 'N10')).toEqual({ ok: true, startLine: 1, endLine: 3, blocks: { from: 10, to: 10 } });
    expect(range(text, OKUMA, 'block', 'N10', 'N20')).toEqual({ ok: true, startLine: 1, endLine: 4, blocks: { from: 10, to: 20 } });
  });
});

describe('each dialect numbers its own way', () => {
  it('Fanuc: the N address, with or without it typed; a program number is no block', () => {
    expect(range(FANUC_PROGRAM, FANUC, 'block', '10', '60')).toMatchObject({ ok: true, startLine: 2, endLine: 7 });
    // `O1000` is the program number, not a block: only the profile's block prefix is read (NC-12).
    expect(range(FANUC_PROGRAM, FANUC, 'block', 'O1000', '60')).toEqual({ ok: false, reason: 'notNumber', field: 'from' });
  });

  it('another address letter is no block number: G10 and X10 do not find N10, for Select and Delete alike (NC-12)', () => {
    for (const bad of ['G10', 'X10', 'g10', 'M10', 'T10']) {
      expect(range(FANUC_PROGRAM, FANUC, 'block', bad, 'N30'), bad).toEqual({ ok: false, reason: 'notNumber', field: 'from' });
      expect(range(FANUC_PROGRAM, FANUC, 'block', 'N10', bad), bad).toEqual({ ok: false, reason: 'notNumber', field: 'to' });
    }
    // Klartext: only a bare number, or N as Go to Block takes it.
    const text = ['0 BEGIN PGM T MM', '1 L X+1', '2 L X+2', '3 END PGM T MM'].join('\n');
    for (const bad of ['L1', 'X1', 'Q1', 'LBL1']) {
      expect(range(text, KLARTEXT, 'block', bad, '2'), bad).toEqual({ ok: false, reason: 'notNumber', field: 'from' });
    }
    expect(range(text, KLARTEXT, 'block', 'n1', 'N 2')).toMatchObject({ ok: true, startLine: 2, endLine: 3 });
    // Sinumerik: N, the main-block mark, a bare number; no other letter.
    const sin = ['%_N_MAIN_MPF', ':100 G1 X1', 'N110 G1 X2', 'N120 M30'].join('\n');
    expect(range(sin, SINUMERIK, 'block', 'G100', 'N120')).toEqual({ ok: false, reason: 'notNumber', field: 'from' });
    expect(range(sin, SINUMERIK, 'block', ': 100', 'n120')).toMatchObject({ ok: true, startLine: 2, endLine: 4 });
  });

  it('reads the profile’s own block prefix and its other spellings, in either case (NC-12)', () => {
    const raw = BUILTIN_PROFILE_JSON.find((entry) => (entry as { id?: string }).id === 'fanuc-gcode') as Record<string, unknown>;
    const syntax = raw.syntax as Record<string, unknown>;
    const checked = validateProfile({ ...raw, syntax: { ...syntax, blockNumber: { mode: 'prefix', prefix: 'N', altPrefixes: ['S'], mandatory: false } } });
    if (!checked.ok) throw new Error(checked.errors.join('; '));
    const alt = compileProfile(checked.profile);
    expect(range(FANUC_PROGRAM, alt, 'block', 's20', 'S50')).toMatchObject({ ok: true, startLine: 3, endLine: 6 });
    expect(range(FANUC_PROGRAM, alt, 'block', 'G20', 'N50')).toEqual({ ok: false, reason: 'notNumber', field: 'from' });
  });

  it('Klartext: the leading integer is the block number; BEGIN PGM is block 0 and END PGM the last block', () => {
    const text = ['0 BEGIN PGM T MM', '1 L X+1', '2 L X+2', '3 END PGM T MM'].join('\n');
    expect(range(text, KLARTEXT, 'block', '1', '2')).toEqual({ ok: true, startLine: 2, endLine: 3, blocks: { from: 1, to: 2 } });
    // NC-13: 0 is the BEGIN PGM line and 3 the END PGM line, so 0–3 is the whole program (the session's decision).
    expect(range(text, KLARTEXT, 'block', '0', '3')).toEqual({ ok: true, startLine: 1, endLine: 4, blocks: { from: 0, to: 3 } });
    // Klartext has no prefix and still answers N1, as Go to Block does.
    expect(range(text, KLARTEXT, 'block', 'N1', 'N2')).toMatchObject({ ok: true, startLine: 2, endLine: 3 });
    expect(range(text, KLARTEXT, 'block', '1', '5')).toMatchObject({ reason: 'missingBlock', field: 'to', number: 5 });
  });

  it('Sinumerik: N blocks, the main block :100 with its mark, and a label is no block number', () => {
    const text = ['%_N_MAIN_MPF', ':100 G1 X1', 'N110 G1 X2', 'MARKE1: G1 X3', 'N120 G1 X4', 'N130 GOTOB MARKE1', 'M30'].join('\n');
    expect(range(text, SINUMERIK, 'block', 'N110', 'N120')).toEqual({ ok: true, startLine: 3, endLine: 5, blocks: { from: 110, to: 120 } });
    expect(range(text, SINUMERIK, 'block', '110', '130')).toMatchObject({ ok: true, startLine: 3, endLine: 6 });
    expect(range(text, SINUMERIK, 'block', ':100', 'N120')).toMatchObject({ ok: true, startLine: 2, endLine: 5 });
    expect(range(text, SINUMERIK, 'block', 'N100', 'N120')).toMatchObject({ ok: true, startLine: 2, endLine: 5 });
    expect(range(text, SINUMERIK, 'block', 'MARKE1', 'N120')).toMatchObject({ reason: 'notNumber', field: 'from' });
  });

  it('Okuma: N0100 and N100 are two names, compared as typed', () => {
    const text = ['N0100 G1 X1', 'N100 G1 X2', 'N200 G1 X3'].join('\n');
    expect(range(text, OKUMA, 'block', 'N0100', 'N200')).toEqual({ ok: true, startLine: 1, endLine: 3, blocks: { from: 100, to: 200 } });
    expect(range(text, OKUMA, 'block', 'N100', 'N200')).toEqual({ ok: true, startLine: 2, endLine: 3, blocks: { from: 100, to: 200 } });
    // Fanuc reads them as the same number, so it is a duplicate there.
    expect(range(text, FANUC, 'block', 'N100', 'N200')).toMatchObject({ reason: 'duplicateBlock', total: 2, lines: [1, 2] });
  });

  it('writes a block number the way the dialect does', () => {
    expect(blockLabel(120, FANUC)).toBe('N120');
    expect(blockLabel(120, SINUMERIK)).toBe('N120');
    expect(blockLabel(7, KLARTEXT)).toBe('7');
  });
});

describe('the index of a document (the form asks again on every keystroke)', () => {
  it('answers like the resolver without it, and reads only the lines of the continuation', () => {
    const lines = FANUC_PROGRAM.split('\n');
    let reads = 0;
    const read = (line: number): string => {
      reads++;
      return lines[line - 1] ?? '';
    };
    const index = indexBlocks(read, lines.length, FANUC);
    expect(reads).toBe(lines.length);
    reads = 0;
    for (const [from, to] of [['N10', 'N60'], ['N15', 'N60'], ['N60', 'N10'], ['x', 'N10']]) {
      const request = { kind: 'block' as const, from, to };
      const answer = resolveBlockRange(read, lines.length, FANUC, request, index);
      expect(answer).toEqual(resolveBlockRange((line) => lines[line - 1] ?? '', lines.length, FANUC, request));
    }
    // Only the end of a found block is read again (its own line and the one after it), never the whole program.
    expect(reads).toBeLessThanOrEqual(2);
  });
});

describe('a large program', () => {
  it('reads 300,000 lines in one pass', () => {
    const lines = Array.from({ length: 300_000 }, (_, i) => `N${i + 1} G1 X${i}`);
    const answer = resolveBlockRange((line) => lines[line - 1] ?? '', lines.length, FANUC, { kind: 'block', from: 'N1000', to: 'N299000' });
    expect(answer).toMatchObject({ ok: true, startLine: 1000, endLine: 299_000 });
  });
});
