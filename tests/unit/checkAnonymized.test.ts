// Tests for tests/gen/check-anonymized.mjs, the reading aid that lists what looks personal
// in a program the owner is thinking of publishing (T176).
//
// It used to flag 100 and more lines of the published set — every cycle number, label
// number and swivel number, because a part number was "two capitals and three digits"
// anywhere on a line — and it never read a string, which is where a Siemens program
// had named a machine builder.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkText, commentTextOf } from '../gen/check-anonymized.mjs';

const SCRIPT = fileURLToPath(new URL('../gen/check-anonymized.mjs', import.meta.url));
const PUBLISHED = fileURLToPath(new URL('../fixtures/nc/owner-public/', import.meta.url));

/** The rules that fired on a text, one per flagged line. */
const rulesOf = (text: string) => checkText(text).map((entry) => entry.rule);

describe('check-anonymized: numbers that are code, not names', () => {
  it.each([
    ['a Klartext cycle definition', '12 CYCL DEF 200 BOHREN ~'],
    ['a Klartext label call', '29 CALL LBL 100'],
    ['a Klartext label', '30 LBL 1000'],
    ['a Klartext swivel block', '31 PLANE SPATIAL SPA-120.5 SPB+30 SPC+0 TURN MB MAX FMAX'],
    ['a Sinumerik cycle call', 'N40 CYCLE832(0.01,1,1)'],
    ['a Sinumerik swivel cycle', 'N50 CYCLE800(1,"",100000,57,0,0,0,0,0,0,0,0,0,-1)'],
    ['a heading comment line that names a label', '13 * - LBL 100 FACING'],
    ['a comment that names a cycle', '; CYCLE800 SWIVEL FOR THE BACK SIDE'],
  ])('does not flag %s', (_what, line) => {
    expect(rulesOf(line)).toEqual([]);
  });
});

describe('check-anonymized: part numbers in comments and strings', () => {
  it.each([
    ['a Fanuc comment', 'N10 G0 X1 (PART AB-12345)'],
    ['a line comment', '; DRW 4711-2'],
    ['a string', 'MSG("ABC12345")'],
    ['a Klartext heading', '5 * - XY-4000 REV 2'],
  ])('flags one in %s', (_what, line) => {
    expect(rulesOf(line)).toEqual(['partNumber']);
  });

  it('a shape in the code of a block is not a part number', () => {
    expect(rulesOf('N10 AB1234 X10')).toEqual([]);
  });
});

// WX-CODE-5: the name of a program is data, not a comment; with the part number rule limited to comments and
// strings (T176), "0 BEGIN PGM BRACKET1234 MM" was no longer flagged at all.
describe('check-anonymized: part numbers in program names', () => {
  it.each([
    ['a Klartext BEGIN PGM', '0 BEGIN PGM BRACKET1234 MM'],
    ['a Klartext END PGM', '2 END PGM BRACKET1234 MM'],
    ['a Klartext BEGIN PGM without a block number, inches', 'BEGIN PGM AB-12345 INCH'],
    ['a Fanuc named program', '<BRACKET1234>'],
    ['a Fanuc named program with a block number', 'N10 <XY_4711-2>'],
  ])('flags one in %s', (_what, line) => {
    expect(rulesOf(line)).toEqual(['programName']);
  });

  it.each([
    ['a plain Klartext name', '0 BEGIN PGM TEST MM'],
    ['a short numbered Klartext name', '0 BEGIN PGM WP42 MM'],
    ['a name with a tool number', '0 BEGIN PGM SF10 MM'],
    ['a Fanuc name with a letter and a number', '<SHAFT_T12-A>'],
    ['a Fanuc name with a feed in it', '<CHAMFER_F12>'],
    ['a numbered program', '0 BEGIN PGM 1 MM'],
  ])('does not flag %s', (_what, line) => {
    expect(rulesOf(line)).toEqual([]);
  });

  it('keeps the Okuma and Sinumerik header rules', () => {
    expect(rulesOf('%_N_BRACKET1234_MPF')).toEqual(['header']);
    expect(rulesOf('$BRACKET1234.MIN%')).toEqual(['header']);
  });

  it('flags the program name of a whole Klartext program once per header line', () => {
    const lines = checkText('0 BEGIN PGM BRACKET1234 MM\n1 L X+0 R0 FMAX\n2 END PGM BRACKET1234 MM\n');
    expect(lines.map((entry) => [entry.line, entry.rule])).toEqual([[1, 'programName'], [3, 'programName']]);
  });
});

describe('check-anonymized: strings are read', () => {
  it.each([
    ['a cycle argument', 'N20 CYCLE832(0.01,"ACME",1)'],
    ['a message', 'N20 MSG("CHECK THE CLAMP")'],
    ['a tool name', 'N20 T="TEST_KOM" D1'],
    ['a workpiece name', 'N20 WORKPIECE(,,,"BOX",1,2,3)'],
  ])('flags text in %s', (_what, line) => {
    expect(rulesOf(line)).toEqual(['string']);
  });

  it('leaves a string without a word alone', () => {
    expect(rulesOf('N20 CYCLE800(1,"",100000,"12",0)')).toEqual([]);
  });

  it('does not report the same line twice, and keeps the more specific reason', () => {
    expect(checkText('N20 MSG("KUNDE MUELLER")').map((entry) => entry.rule)).toEqual(['customer']);
  });
});

describe('check-anonymized: the other rules still work', () => {
  it.each([
    ['name', 'N10 (BRACKET FOR ACME GmbH)'],
    ['customer', 'N10 (AUFTRAG 12)'],
    ['date', 'N10 (2026-09-25)'],
    ['path', 'N10 (C:\\Jobs\\a.nc)'],
    ['email', 'N10 (a.b@example.org)'],
    ['phone', 'N10 (CALL +49 7071 123456)'],
    ['nonAscii', 'N10 (Müller)'],
    ['header', '%_N_PART1_MPF'],
  ])('flags %s', (rule, line) => {
    expect(rulesOf(line)).toEqual([rule]);
  });

  it('lets a plain program through', () => {
    expect(rulesOf('%\nO1001 (BRACKET)\nN10 G90 G54\nN20 G0 X10. Y10.\nM30\n%')).toEqual([]);
  });

  it('a paren group after a letter is an argument list, not a comment', () => {
    expect(commentTextOf('N40 CYCLE832(0.01,1,1)')).toBeNull();
    expect(commentTextOf('N40 G1 X1 (A COMMENT)')).toBe('(A COMMENT)');
  });
});

describe('check-anonymized: the published set', () => {
  /** Every file under tests/fixtures/nc/owner-public that is a program. */
  function programs(dir = PUBLISHED): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return programs(path);
      return /\.(md|json)$/i.test(name) ? [] : [path];
    });
  }

  it('flags no part number, and few lines overall (it was over 100)', () => {
    const all = programs().flatMap((file) => checkText(readFileSync(file, 'latin1')));
    expect(all.filter((entry) => entry.rule === 'partNumber')).toEqual([]);
    expect(all.filter((entry) => entry.rule === 'programName')).toEqual([]);
    expect(all.length).toBeLessThanOrEqual(25);
  });

  it('reads the strings of the published Siemens programs', () => {
    const all = programs().flatMap((file) => checkText(readFileSync(file, 'latin1')));
    expect(all.some((entry) => entry.rule === 'string')).toBe(true);
  });
});

describe('check-anonymized: the command', () => {
  function run(text: string | null) {
    const dir = mkdtempSync(join(tmpdir(), 'gedit-anon-'));
    try {
      const file = join(dir, 'p.nc');
      if (text !== null) writeFileSync(file, text);
      return spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('exits 0 for a clean file, 1 for a flagged one and 2 for one it cannot read', () => {
    expect(run('N10 G0 X1\n').status).toBe(0);
    const flagged = run('N10 (CUSTOMER 4)\n');
    expect(flagged.status).toBe(1);
    expect(flagged.stdout).toContain('line 1');
    expect(run(null).status).toBe(2);
  });
});
