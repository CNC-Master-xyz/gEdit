// The cost of `renumber` over 100,000 lines (wall-clock budgets).
// What it does is in `renumber.test.ts` (same folder).

import { describe, expect, it } from 'vitest';
import { compiledBuiltin, context } from '../../../../tests/unit/helpers/transformContext';
import { renumber } from './renumber';

const FANUC = 'fanuc-gcode';

describe('performance', () => {
  const fanuc = compiledBuiltin(FANUC);

  it('renumbers 100k lines with a jump in every seventh block well inside a second', () => {
    const cp = compiledBuiltin(FANUC);
    // One program, `GOTO`s that all land: the worst case for the reference pass, because
    // every one of them is looked up and rewritten.
    const lines: string[] = ['O1000'];
    for (let i = 0; i < 100_000; i++) lines.push(i % 7 === 0 ? `N${i + 1} GOTO ${i + 2}` : `N${i + 1} G1 X${i}.`);

    const started = performance.now();
    const result = renumber.run(lines, context(cp, { start: 10, step: 10, max: null, skipStartingWith: '% O (', restartAtProgramStart: true }));
    const ms = performance.now() - started;

    expect(result.lines[1]).toBe('N10 GOTO 20');
    const rewritten = result.warnings.find((w) => w.key === 'ncNumbering.renumber.referencesRewritten');
    expect(rewritten?.params).toEqual({ count: 14_286 });
    // The budget is 1 s; the assertion leaves room for a loaded CI machine.
    expect(ms, `${Math.round(ms)} ms for 100k lines with references`).toBeLessThan(3000);
  });

  it('renumbers 100k Sinumerik lines with main blocks and their jumps well inside a second (M9)', () => {
    // The main-block pass reads the document once more, and only where the prefix occurs;
    // this is that case at its worst: a main block every tenth line and a jump to each.
    const cp = compiledBuiltin('sinumerik');
    const lines: string[] = ['%_N_MAIN_MPF'];
    for (let i = 0; i < 100_000; i++) {
      if (i % 10 === 0) lines.push(`:${i + 1} G0 X${i}`);
      else if (i % 10 === 5) lines.push(`N${i + 1} IF R1==${i} GOTOB :${i - 4}`);
      else lines.push(`N${i + 1} G1 X${i}`);
    }

    const started = performance.now();
    const result = renumber.run(lines, context(cp, { start: 10, step: 10 }));
    const ms = performance.now() - started;

    expect(result.lines[1]).toBe(':10 G0 X0');
    expect(result.lines[6]).toBe('N60 IF R1==5 GOTOB :10');
    const rewritten = result.warnings.find((w) => w.key === 'ncNumbering.renumber.referencesRewritten');
    expect(rewritten?.params).toEqual({ count: 10_000 });
    // The budget is 1 s; the assertion leaves room for a loaded CI machine.
    expect(ms, `${Math.round(ms)} ms for 100k Sinumerik lines with main blocks`).toBeLessThan(3000);
  });

  it('renumbers 100k lines with every advanced option on well inside a second (P4d, §6.6)', () => {
    // Every option at once over one program: a fitted increment (it needs the count of a
    // first walk before the first number), every third block, a column, two skipped regions,
    // a start text and a skipped text, and a jump in every seventh block that `everyNth`
    // must keep a number for.
    const cp = compiledBuiltin(FANUC);
    const lines: string[] = ['%', 'O1000 (ALL OPTIONS)', '(HEADER)', '(START)'];
    for (let i = 0; i < 100_000; i++) {
      if (i % 7 === 0) lines.push(`N${i + 1} GOTO ${i + 3}`);
      else if (i % 50 === 1) lines.push(`N${i + 1} M01 (MSG ${i})`);
      else lines.push(`N${i + 1} G1 X${i}.`);
    }
    lines.push('M30', '%', '');
    const options = {
      start: 10,
      max: 99_999_999,
      fitToMax: true,
      alignColumn: 10,
      everyNth: 3,
      skipContaining: 'MSG',
      skipFirst: 2,
      skipLast: 2,
      startTrigger: '(START)',
      startAfterTrigger: true,
      skipStartingWith: '% O (',
      restartAtProgramStart: true,
    };

    const started = performance.now();
    const result = renumber.run(lines, context(cp, options));
    const ms = performance.now() - started;

    expect(result.lines).toHaveLength(lines.length);
    expect(result.lines.slice(0, 4)).toEqual(lines.slice(0, 4));
    expect(result.lines[4].startsWith('N10      GOTO ')).toBe(true);
    expect(result.warnings.map((w) => w.key)).toEqual(
      expect.arrayContaining([
        'ncNumbering.renumber.fitted',
        'ncNumbering.renumber.everyNthRemoved',
        'ncNumbering.renumber.everyNthKept',
        'ncNumbering.renumber.referencesRewritten',
      ]),
    );
    // The budget is 1 s; the assertion leaves room for a loaded CI machine.
    expect(ms, `${Math.round(ms)} ms for 100k lines with every option`).toBeLessThan(3000);
  });

  it('renumbers 100k lines well inside a second', () => {
    const source = ['G0 G90 X0. Y0.', 'N5 T1 M6', 'G43 H1 Z50. (ROUGH)', 'G1 X10. Y10. F250.', '/N100 G0 Z5.', 'M98 P2000', ''];
    const lines = Array.from({ length: 100_000 }, (_v, i) => source[i % source.length]);

    const started = performance.now();
    const result = renumber.run(lines, context(fanuc, { skipStartingWith: '', restartAtProgramStart: false }));
    const ms = performance.now() - started;

    expect(result.lines).toHaveLength(lines.length);
    // The budget is 1 s; the assertion leaves room for a loaded CI machine.
    expect(ms, `${Math.round(ms)} ms for 100k lines`).toBeLessThan(3000);
  });
});
