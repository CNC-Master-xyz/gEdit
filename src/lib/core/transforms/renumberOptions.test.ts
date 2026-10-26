// The advanced renumber options (plan §6.6 rules 1–7, X28). Owner: P4.18.
//
// Written by the P4d prelude: the profile members load and are checked, and a profile that
// sets none of them renumbers exactly as before. P4.18 proves the options themselves here,
// rule by rule, and with goldens under `tests/fixtures/transforms/renumber/opt-*` on Fanuc
// mill and lathe, Okuma and Sinumerik (read by `renumber.test.ts`).

import { describe, expect, it } from 'vitest';
import fanucJson from '$lib/data/profiles/fanuc-gcode.json';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { hasKey, t } from '$lib/i18n';
import { compiledBuiltin, context } from '../../../../tests/unit/helpers/transformContext';
import { renumber } from './renumber';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import type { TransformContext, TransformResult } from './types';

function fanuc(): Record<string, unknown> {
  return structuredClone(fanucJson) as unknown as Record<string, unknown>;
}

function pathsOf(patch: (numbering: Record<string, unknown>) => void): string[] {
  const profile = fanuc();
  patch(profile.numbering as Record<string, unknown>);
  const result = validateProfile(profile);
  return result.ok ? [] : result.errors.map((error) => error.slice(0, error.indexOf(':')));
}

describe('the advanced options as profile members (§6.6 rules 1–6)', () => {
  it('are each optional and accepted with a sensible value', () => {
    expect(
      pathsOf((n) =>
        Object.assign(n, {
          fitToMax: true,
          alignColumn: 8,
          everyNth: 5,
          skipContaining: ['(MSG', 'M30'],
          skipFirst: 2,
          skipLast: 1,
          startTrigger: '(START)',
          startAfterTrigger: true,
        }),
      ),
    ).toEqual([]);
    // Off is written as the default value, or as an empty start text.
    expect(pathsOf((n) => Object.assign(n, { alignColumn: 0, everyNth: 1, skipFirst: 0, skipLast: 0, startTrigger: '' }))).toEqual([]);
  });

  it('are reported with their path when they are out of bounds or of the wrong type', () => {
    expect(
      pathsOf((n) =>
        Object.assign(n, {
          fitToMax: 'yes',
          alignColumn: 121,
          everyNth: 0,
          skipContaining: ['', 5],
          skipFirst: -1,
          skipLast: 1.5,
          startTrigger: 'x'.repeat(201),
          startAfterTrigger: 1,
        }),
      ),
    ).toEqual([
      'numbering.fitToMax',
      'numbering.alignColumn',
      'numbering.everyNth',
      'numbering.skipContaining[0]',
      'numbering.skipContaining[1]',
      'numbering.skipFirst',
      'numbering.skipLast',
      'numbering.startTrigger',
      'numbering.startAfterTrigger',
    ]);
  });

  // P4d review CODE-6: the upper bounds, and a text with a blank in it, which the form's
  // space-separated field would split into two.
  it('are reported above their upper bound, and a text to skip with a blank in it', () => {
    expect(pathsOf((n) => Object.assign(n, { everyNth: 1001, skipContaining: ['x'.repeat(201), 'OK'] }))).toEqual([
      'numbering.everyNth',
      'numbering.skipContaining[0]',
    ]);
    expect(pathsOf((n) => Object.assign(n, { everyNth: 1000, skipContaining: ['x'.repeat(200)] }))).toEqual([]);
    expect(pathsOf((n) => Object.assign(n, { skipContaining: ['(MSG A)', 'M01', 'a\tb', ' M30'] }))).toEqual([
      'numbering.skipContaining[0]',
      'numbering.skipContaining[2]',
      'numbering.skipContaining[3]',
    ]);
    expect(pathsOf((n) => Object.assign(n, { skipContaining: Array.from({ length: 201 }, (_, i) => `T${i}`) }))).toEqual(['numbering.skipContaining']);
  });
});

const FANUC = compiledBuiltin('fanuc-gcode');
const OKUMA = compiledBuiltin('okuma-osp');
const SINUMERIK = compiledBuiltin('sinumerik');
const KLARTEXT = compiledBuiltin('heidenhain-klartext');

/** No skip list and one counter for the whole file, so a case shows only its option. */
const FREE = { start: 10, step: 10, skipStartingWith: '', restartAtProgramStart: false };

function run(cp: CompiledProfile, lines: string[], options: Record<string, unknown>, ctx?: Partial<TransformContext>): TransformResult {
  return renumber.run(lines, { ...context(cp, options), ...ctx });
}

function preflight(cp: CompiledProfile, lines: string[], options: Record<string, unknown>): string | null {
  return renumber.preflight?.(lines, context(cp, options))?.key ?? null;
}

function rowsOf(result: TransformResult): [number, string | undefined][] {
  return result.skipped.map((row) => [row.line, row.severity]);
}

/** The shipped Fanuc profile with one change to its numbering or its syntax. */
function fanucWith(numbering: Partial<Profile['numbering']>, syntax: Partial<Profile['syntax']> = {}): CompiledProfile {
  const profile = FANUC.profile;
  return compileProfile({ ...profile, numbering: { ...profile.numbering, ...numbering }, syntax: { ...profile.syntax, ...syntax } });
}

/** What every refusal shares (§6.6 rule 7): nothing written, nothing listed, the reason as the summary. */
function expectRefused(result: TransformResult, lines: string[], key: string): void {
  expect(result.lines).toEqual(lines);
  expect(result.lineMap).toEqual(Int32Array.from(lines, (_line, i) => i));
  expect(result.summary.key).toBe(key);
  expect(result.warnings).toEqual([]);
  expect(result.skipped).toEqual([]);
  expect(result.renumbered).toBeUndefined();
}

describe('the form (§6.6 rule 7)', () => {
  it('offers each option, prefilled from the profile, and none on the consecutive dialect', () => {
    const cp = fanucWith({
      fitToMax: true,
      alignColumn: 8,
      everyNth: 5,
      skipContaining: ['(MSG', 'M01'],
      skipFirst: 2,
      skipLast: 1,
      startTrigger: '(START)',
      startAfterTrigger: true,
    });
    const byId = new Map((renumber.options?.(cp) ?? []).map((field) => [field.id, field]));
    expect(byId.get('fitToMax')).toMatchObject({ type: 'bool', default: true });
    expect(byId.get('alignColumn')).toMatchObject({ type: 'integer', default: 8 });
    expect(byId.get('everyNth')).toMatchObject({ type: 'integer', default: 5 });
    // A space-separated list, like the skip list beside it.
    expect(byId.get('skipContaining')).toMatchObject({ type: 'text', default: '(MSG M01' });
    expect(byId.get('skipFirst')).toMatchObject({ type: 'integer', default: 2 });
    expect(byId.get('skipLast')).toMatchObject({ type: 'integer', default: 1 });
    expect(byId.get('startTrigger')).toMatchObject({ type: 'text', default: '(START)' });
    expect(byId.get('startAfterTrigger')).toMatchObject({ type: 'bool', default: true });
    // The increment says it is not used when the step is fitted (rule 1).
    expect(byId.get('step')?.help).toContain('Fit the increment to the maximum');
    for (const field of byId.values()) expect(field.label.startsWith('ncNumbering.'), field.id).toBe(false);

    expect(renumber.options?.(KLARTEXT)).toEqual([]);
  });

  it('runs a profile that sets the options without a form, as a headless caller does', () => {
    const cp = fanucWith({ everyNth: 2, restartAtProgramStart: false, skipStartingWith: [] });
    expect(run(cp, ['G0 X0', 'G1 X1', 'G1 X2'], {}).lines).toEqual(['N10 G0 X0', 'G1 X1', 'N20 G1 X2']);
    // The form's answer wins over the profile's.
    expect(run(cp, ['G0 X0', 'G1 X1', 'G1 X2'], { everyNth: 1 }).lines).toEqual(['N10 G0 X0', 'N20 G1 X1', 'N30 G1 X2']);
  });

  it('gives Klartext no option at all, whatever a caller passes', () => {
    const lines = ['0 BEGIN PGM T MM', '5 L Z+100 R0 FMAX', '9 END PGM T MM'];
    const everything = { fitToMax: true, max: '', alignColumn: 20, everyNth: 2, skipContaining: 'L', skipFirst: 1, skipLast: 1, startTrigger: 'XYZ' };
    const result = run(KLARTEXT, lines, everything);
    expect(result.lines).toEqual(['0 BEGIN PGM T MM', '1 L Z+100 R0 FMAX', '2 END PGM T MM']);
    expect(result.summary.key).toBe('ncNumbering.renumber.summary');
    expect(result.renumbered).toBeUndefined();
  });

  it('has a message for every summary and warning the options add', () => {
    for (const key of [
      'ncNumbering.renumber.refused.noMax',
      'ncNumbering.renumber.refused.doesNotFit',
      'ncNumbering.renumber.refused.noTrigger',
      'ncNumbering.renumber.fitted',
      'ncNumbering.renumber.everyNthRemoved',
      'ncNumbering.renumber.everyNthKept',
      'ncNumbering.renumber.alignTabs',
    ]) {
      expect(hasKey(key), key).toBe(true);
    }
  });
});

describe('fitToMax (§6.6 rule 1)', () => {
  const FOUR = ['G0 X0', 'G1 X1', 'G1 X2', 'M30'];

  it('takes the largest whole step that keeps the last numbered block at or below max', () => {
    const result = run(FANUC, FOUR, { ...FREE, step: 7, max: 100, fitToMax: true });
    // floor((100 - 10) / 3) = 30; the increment of the form is not used.
    expect(result.lines).toEqual(['N10 G0 X0', 'N40 G1 X1', 'N70 G1 X2', 'N100 M30']);
    expect(result.warnings).toEqual([{ key: 'ncNumbering.renumber.fitted', params: { step: 30, count: 4, start: 10, max: 100 } }]);
    // Not rounded to a "round" increment.
    expect(run(FANUC, FOUR, { ...FREE, max: 99, fitToMax: true }).lines).toEqual(['N10 G0 X0', 'N39 G1 X1', 'N68 G1 X2', 'N97 M30']);
  });

  it('counts the longest program where the counter starts over at each one', () => {
    const lines = ['O1', 'G0 X0', 'G1 X1', 'M30', 'O2', 'G0 X0', 'G1 X1', 'G1 X2', 'G1 X3', 'M30'];
    const result = run(FANUC, lines, { start: 10, skipStartingWith: '', restartAtProgramStart: true, max: 100, fitToMax: true });
    // Five blocks in O2: floor(90 / 4) = 22.
    expect(result.lines).toEqual(['O1', 'N10 G0 X0', 'N32 G1 X1', 'N54 M30', 'O2', 'N10 G0 X0', 'N32 G1 X1', 'N54 G1 X2', 'N76 G1 X3', 'N98 M30']);
  });

  it('counts only the blocks that get a number under everyNth', () => {
    const lines = ['G0 X0', 'G1 X1', 'G1 X2', 'G1 X3', 'G1 X4', 'G1 X5', 'M30'];
    const result = run(FANUC, lines, { ...FREE, max: 100, fitToMax: true, everyNth: 3 });
    expect(result.lines).toEqual(['N10 G0 X0', 'G1 X1', 'G1 X2', 'N55 G1 X3', 'G1 X4', 'G1 X5', 'N100 M30']);
  });

  it('uses the control limit as the maximum where the dialect has one', () => {
    const result = run(OKUMA, ['O1001', 'G0 X0', 'G1 X1', 'M02'], { fitToMax: true });
    expect(result.lines).toEqual(['O1001', 'N10 G0 X0', 'N5004 G1 X1', 'N9998 M02']);
  });

  it('is refused without a maximum, and writes nothing', () => {
    const lines = ['G0 X0', 'GOTO 999', 'M30'];
    const result = run(FANUC, lines, { ...FREE, max: '', fitToMax: true });
    expectRefused(result, lines, 'ncNumbering.renumber.refused.noMax');
    // Nothing to confirm about a run that will not write: the reference question is not asked.
    expect(preflight(FANUC, lines, { ...FREE, max: '', fitToMax: true })).toBeNull();
    expect(preflight(FANUC, lines, { ...FREE, max: '' })).toBe('ncNumbering.renumber.references');
  });

  it('is refused when even a step of 1 does not fit', () => {
    const result = run(FANUC, FOUR, { ...FREE, max: 12, fitToMax: true });
    expectRefused(result, FOUR, 'ncNumbering.renumber.refused.doesNotFit');
    expect(result.summary.params).toEqual({ count: 4, start: 10, max: 12 });
    expect(preflight(FANUC, [...FOUR, 'GOTO 999'], { ...FREE, max: 12, fitToMax: true })).toBeNull();
    // Exactly one step of 1 fits.
    expect(run(FANUC, FOUR, { ...FREE, max: 13, fitToMax: true }).lines).toEqual(['N10 G0 X0', 'N11 G1 X1', 'N12 G1 X2', 'N13 M30']);
    // One block that starts above the maximum does not fit either.
    expectRefused(run(FANUC, ['G0 X0'], { ...FREE, start: 200, max: 100, fitToMax: true }), ['G0 X0'], 'ncNumbering.renumber.refused.doesNotFit');
  });

  it('never asks whether the numbering may start over', () => {
    const lines = Array.from({ length: 20 }, (_v, i) => (i === 0 ? 'N1 GOTO 20' : `N${i + 1} G1 X${i}`));
    expect(preflight(FANUC, lines, { ...FREE, max: 100 })).toBe('ncNumbering.renumber.referencesMayWrap');
    expect(preflight(FANUC, lines, { ...FREE, max: 100, fitToMax: true })).toBeNull();
    // 20 blocks from 10 up to 100: a step of 4, and the jump follows its block.
    expect(run(FANUC, lines, { ...FREE, max: 100, fitToMax: true }).lines[0]).toBe('N10 GOTO 86');
  });
});

describe('alignColumn (§6.6 rule 2)', () => {
  it('pads the gap so the code starts at the column, counting the indentation and the marks in front', () => {
    const result = run(FANUC, ['N5 G0 X0', '  /N6 G1 X1', 'N7 G1 X2 (N7)'], { ...FREE, alignColumn: 8 });
    expect(result.lines).toEqual(['N10    G0 X0', '  /N20 G1 X1', 'N30    G1 X2 (N7)']);
    for (const line of result.lines) expect(line.indexOf('G'), line).toBe(7);
  });

  it('gives a head that already reaches the column one space', () => {
    expect(run(FANUC, ['G0 X0', 'G1 X1'], { ...FREE, start: 1234567, max: '', alignColumn: 6 }).lines).toEqual(['N1234567 G0 X0', 'N1234577 G1 X1']);
    // A head that ends just before the column still gets its space: `N10G0` is no alignment.
    expect(run(FANUC, ['G0 X0'], { ...FREE, alignColumn: 4 }).lines).toEqual(['N10 G0 X0']);
  });

  it('leaves the gap behind a skip mark that follows the number, and a line with no code', () => {
    expect(run(FANUC, ['N7/ G1 X2', 'N8/G1 X3', 'N9', 'N9   '], { ...FREE, alignColumn: 10 }).lines).toEqual(['N10/ G1 X2', 'N20/G1 X3', 'N30', 'N40   ']);
  });

  it('counts a tab as one character and says once that such lines may not line up', () => {
    const result = run(FANUC, ['\tN5 G0', '\tN6 G1', 'N7 G1'], { ...FREE, alignColumn: 8 });
    expect(result.lines).toEqual(['\tN10   G0', '\tN20   G1', 'N30    G1']);
    expect(result.warnings).toEqual([{ key: 'ncNumbering.renumber.alignTabs' }]);
    // A tab behind the number is the gap, which is written anew: nothing to say.
    expect(run(FANUC, ['N5\tG0'], { ...FREE, alignColumn: 8 }).warnings).toEqual([]);
  });

  it('keeps the space a word-separated dialect needs where the head reaches the column', () => {
    // No consecutive dialect has options; a leading-integer profile without `consecutive` does.
    const profile = KLARTEXT.profile;
    const free = compileProfile({ ...profile, numbering: { ...profile.numbering, mode: 'free', start: 10, step: 10 } });
    expect(run(free, ['5 L X+0 R0 FMAX'], { alignColumn: 2 }).lines).toEqual(['10 L X+0 R0 FMAX']);
  });
});

describe('everyNth (§6.6 rule 3)', () => {
  it('numbers every Nth block and takes the number off the blocks between, skip marks kept', () => {
    const lines = ['N1 G0 X0', 'N2 G1 X1', '/N3 G1 X2', 'N4 G1 X3', 'N5/ G1 X4', 'G1 X5', 'N7 M30'];
    const result = run(FANUC, lines, { ...FREE, everyNth: 3 });
    expect(result.lines).toEqual(['N10 G0 X0', 'G1 X1', '/G1 X2', 'N20 G1 X3', '/ G1 X4', 'G1 X5', 'N30 M30']);
    // A block that had no number has none to lose.
    expect(result.warnings).toEqual([{ key: 'ncNumbering.renumber.everyNthRemoved', params: { count: 3 } }]);
    expect(result.lineMap).toEqual(Int32Array.from(lines, (_line, i) => i));
  });

  it('never takes the number of a block a reference names; it gets the next number and the count goes on', () => {
    const lines = ['N1 GOTO 4', 'N2 G1 X1', 'N3 G1 X2', 'N4 G1 X3', 'N5 G1 X4', 'N6 M30'];
    const result = run(FANUC, lines, { ...FREE, everyNth: 2 });
    expect(result.lines).toEqual(['N10 GOTO 30', 'G1 X1', 'N20 G1 X2', 'N30 G1 X3', 'N40 G1 X4', 'M30']);
    expect(result.warnings).toEqual([
      { key: 'ncNumbering.renumber.everyNthRemoved', params: { count: 2 } },
      { key: 'ncNumbering.renumber.everyNthKept', params: { count: 1 } },
      { key: 'ncNumbering.renumber.referencesRewritten', params: { count: 1 } },
    ]);
  });

  it('keeps a block that a reference the dialect never rewrites may name, in every program of the file', () => {
    // `M99 P30` names a block of the caller; the run cannot tell which program that is, so
    // the `N30` of every program keeps a number.
    const lines = ['O1', 'N10 G0 X0', 'N30 G1 X1', 'N40 M30', 'O2', 'N10 G0 X5', 'N20 M99 P30'];
    const result = run(FANUC, lines, { start: 10, step: 10, skipStartingWith: 'O', restartAtProgramStart: true, everyNth: 2 });
    expect(result.lines.slice(0, 4)).toEqual(['O1', 'N10 G0 X0', 'N20 G1 X1', 'N30 M30']);
    expect(result.lines.slice(4)).toEqual(['O2', 'N10 G0 X5', 'M99 P30']);
  });

  it('keeps a main block a main block', () => {
    const result = run(SINUMERIK, ['N1 G0 X0', ':2 G1 X1', 'N3 G1 X2', 'N4 M30'], { ...FREE, everyNth: 2 });
    expect(result.lines).toEqual(['N10 G0 X0', ':20 G1 X1', 'N30 G1 X2', 'M30']);
  });

  it('starts the count over with the numbers at each program start', () => {
    const lines = ['O1', 'G0 X0', 'G1 X1', 'G1 X2', 'O2', 'G0 X0', 'G1 X1'];
    const result = run(FANUC, lines, { start: 10, step: 10, skipStartingWith: '', restartAtProgramStart: true, everyNth: 2 });
    expect(result.lines).toEqual(['O1', 'N10 G0 X0', 'G1 X1', 'N20 G1 X2', 'O2', 'N10 G0 X0', 'G1 X1']);
  });
});

describe('skipContaining (§6.6 rule 4)', () => {
  const LINES = ['G0 X0 (msg first)', 'G1 X1', 'M01 (MSG STOP)', 'G1 X2'];

  it('keeps a line that contains a listed text anywhere, comments included, and lists it', () => {
    const result = run(FANUC, LINES, { ...FREE, skipContaining: 'MSG' });
    expect(result.lines).toEqual(['G0 X0 (msg first)', 'N10 G1 X1', 'M01 (MSG STOP)', 'N20 G1 X2']);
    expect(rowsOf(result)).toEqual([
      [1, 'info'],
      [3, 'info'],
    ]);
    expect(result.skipped[0].message).toBe('Skipped: the line contains one of the texts to skip.');
    expect(result.summary).toEqual({ key: 'ncNumbering.renumber.summarySkipped', params: { count: 2, skipped: 2 } });
  });

  it('reads the texts with the profile case rule', () => {
    const strict = fanucWith({}, { caseSensitive: true });
    expect(run(strict, LINES, { ...FREE, skipContaining: 'MSG' }).lines).toEqual(['N10 G0 X0 (msg first)', 'N20 G1 X1', 'M01 (MSG STOP)', 'N30 G1 X2']);
  });

  it('takes the form field as a space-separated list', () => {
    expect(run(FANUC, LINES, { ...FREE, skipContaining: 'first  STOP' }).lines).toEqual(['G0 X0 (msg first)', 'N10 G1 X1', 'M01 (MSG STOP)', 'N20 G1 X2']);
  });
});

describe('skipFirst and skipLast (§6.6 rule 5)', () => {
  it('keeps the first and last lines of the scope, one row for each, and lists a program marker in them as before', () => {
    const lines = ['%', 'O1000', 'G0 X0', '', 'G1 X1', 'G1 X2', 'M30', '%', ''];
    const result = run(FANUC, lines, { skipFirst: 3, skipLast: 2 });
    expect(result.lines).toEqual(['%', 'O1000', 'G0 X0', '', 'N10 G1 X1', 'N20 G1 X2', 'M30', '%', '']);
    expect(rowsOf(result)).toEqual([
      [1, 'info'],
      [1, 'info'],
      [2, 'info'],
      [7, 'info'],
      [8, 'info'],
    ]);
    expect(result.skipped[0].message).toBe('The first 3 lines keep their text (skip the first lines).');
    expect(result.skipped[3].message).toBe('From here, the last 2 lines keep their text (skip the last lines).');
    // The regions are not skipped lines one by one; the program markers are.
    expect(result.summary).toEqual({ key: 'ncNumbering.renumber.summarySkipped', params: { count: 2, skipped: 3 } });
  });

  it('counts empty lines, and not the element a final newline leaves', () => {
    expect(run(FANUC, ['', '', 'G0 X0', 'G1 X1'], { ...FREE, skipEmpty: false, skipFirst: 2 }).lines).toEqual(['', '', 'N10 G0 X0', 'N20 G1 X1']);
    expect(run(FANUC, ['G0 X0', 'G1 X1', 'G1 X2', ''], { ...FREE, skipLast: 1 }).lines).toEqual(['N10 G0 X0', 'N20 G1 X1', 'G1 X2', '']);
  });

  it('counts the lines of the selection, not of the document', () => {
    const document = ['G0 X0', 'G1 X1', 'G1 X2', 'G1 X3', 'M30'];
    const result = run(FANUC, document.slice(1, 4), { ...FREE, skipFirst: 1, skipLast: 1 }, { firstLine: 2, document });
    expect(result.lines).toEqual(['G1 X1', 'N10 G1 X2', 'G1 X3']);
    expect(rowsOf(result)).toEqual([
      [2, 'info'],
      [4, 'info'],
    ]);
  });

  it('has nothing to renumber when the two cover the scope', () => {
    const lines = ['%', 'G0 X0', 'G1 X1', ''];
    const result = run(FANUC, lines, { ...FREE, skipFirst: 2, skipLast: 1 });
    expect(result.lines).toEqual(lines);
    expect(result.summary).toEqual({ key: 'ncNumbering.renumber.nothing' });
    expect(result.skipped).toEqual([]);
    expect(result.renumbered).toBeUndefined();
    expect(preflight(FANUC, [...lines.slice(0, 3), 'GOTO 999'], { ...FREE, skipFirst: 2, skipLast: 2 })).toBeNull();
  });
});

describe('startTrigger (§6.6 rule 6)', () => {
  const LINES = ['N1 G0 X0', '(start)', 'N5 G1 X1', 'N6 G1 X2'];

  it('starts at the first line containing the text, or at the line after it; one row says where', () => {
    const at = run(FANUC, LINES, { ...FREE, startTrigger: '(START)' });
    expect(at.lines).toEqual(['N1 G0 X0', 'N10 (start)', 'N20 G1 X1', 'N30 G1 X2']);
    expect(rowsOf(at)).toEqual([[2, 'info']]);
    expect(at.skipped[0].message).toBe('Numbering starts at this line, the first that contains "(START)". The lines above keep their text.');
    expect(at.summary).toEqual({ key: 'ncNumbering.renumber.summary', params: { count: 3 } });

    const after = run(FANUC, LINES, { ...FREE, startTrigger: '(START)', startAfterTrigger: true });
    expect(after.lines).toEqual(['N1 G0 X0', '(start)', 'N10 G1 X1', 'N20 G1 X2']);
    expect(rowsOf(after)).toEqual([[2, 'info']]);
  });

  it('applies once per run, not once per program', () => {
    const lines = ['O1', 'G0 X0', '(START)', 'G1 X1', 'M30', 'O2', 'G0 X0', '(START)', 'G1 X1', 'M30'];
    const result = run(FANUC, lines, { startTrigger: '(START)' });
    expect(result.lines).toEqual(['O1', 'G0 X0', '(START)', 'N10 G1 X1', 'N20 M30', 'O2', 'N10 G0 X0', '(START)', 'N20 G1 X1', 'N30 M30']);
  });

  it('is refused when no line of the scope contains the text, and writes nothing', () => {
    const result = run(FANUC, LINES, { ...FREE, startTrigger: 'XYZ' });
    expectRefused(result, LINES, 'ncNumbering.renumber.refused.noTrigger');
    expect(result.summary.params).toEqual({ text: 'XYZ' });
    expect(preflight(FANUC, [...LINES, 'GOTO 999'], { ...FREE, startTrigger: 'XYZ' })).toBeNull();
    // A selection is its own scope: the text above it does not count.
    const document = ['(START)', 'G0 X0', 'G1 X1'];
    const selected = run(FANUC, document.slice(1), { ...FREE, startTrigger: '(START)' }, { firstLine: 2, document });
    expect(selected.summary.key).toBe('ncNumbering.renumber.refused.noTrigger');
  });

  it('decides in the fixed order: the lines above the trigger are not listed, a program marker there is', () => {
    const result = run(FANUC, ['%', '(HEAD)', 'G0 X0', '(START)', 'G1 X1'], { ...FREE, skipStartingWith: '(', startTrigger: 'START', startAfterTrigger: true });
    expect(result.lines).toEqual(['%', '(HEAD)', 'G0 X0', '(START)', 'N10 G1 X1']);
    expect(rowsOf(result)).toEqual([
      [1, 'info'],
      [4, 'info'],
    ]);
  });
});

describe('the lines an option leaves alone (§6.6 rule 7)', () => {
  it('keep their numbers, and a reference to one still resolves', () => {
    const lines = ['N1 GOTO 3', 'N2 G0 X0', 'N3 G1 X1', '(START)', 'N7 G1 X2', 'N8 GOTO 1'];
    const result = run(FANUC, lines, { ...FREE, startTrigger: '(START)', startAfterTrigger: true });
    expect(result.lines).toEqual(['N1 GOTO 3', 'N2 G0 X0', 'N3 G1 X1', '(START)', 'N10 G1 X2', 'N20 GOTO 1']);
    expect(result.warnings).toEqual([]);
  });

  it('keep their text, while a reference on them follows its block like one on a skipped line', () => {
    const lines = ['N1 GOTO 7', '(START)', 'N7 G1 X2', 'N8 M30'];
    const result = run(FANUC, lines, { ...FREE, startTrigger: '(START)', startAfterTrigger: true });
    expect(result.lines).toEqual(['N1 GOTO 10', '(START)', 'N10 G1 X2', 'N20 M30']);
  });

  it('count in the uniqueness after the run', () => {
    // The kept N20 above the trigger and the N20 the run writes below it: the jump names two blocks.
    const lines = ['N10 G0 X0', 'N20 G1 X1', '(START)', 'G1 X2', 'GOTO 20'];
    const result = run(FANUC, lines, { ...FREE, startTrigger: '(START)', startAfterTrigger: true });
    expect(result.lines).toEqual(['N10 G0 X0', 'N20 G1 X1', '(START)', 'N10 G1 X2', 'N20 GOTO 20']);
    // P4d review NC-4: N10 and N20 are on two blocks each now, which the run says as well.
    expect(result.warnings.map((w) => w.key)).toEqual(['ncNumbering.renumber.duplicatesMade', 'ncNumbering.renumber.referencesUnresolved']);
  });
});

// P4d review NC-4: the options leave lines alone, and a number such a line keeps may be the
// one the run writes elsewhere in the program. That used to happen in silence.
describe('numbers the run puts on several blocks (P4d review NC-4)', () => {
  const row = t('ncNumbering.renumber.duplicateMadeRow');

  it('warns once and lists every block of a number a line above the start text kept (fit to max)', () => {
    const lines = ['N10 G0 X1.', 'N20 G0 X2.', 'N30 G0 X3.', 'N40 M30'];
    const result = run(FANUC, lines, { ...FREE, fitToMax: true, max: 100, startTrigger: 'X2.' });
    expect(result.lines).toEqual(['N10 G0 X1.', 'N10 G0 X2.', 'N55 G0 X3.', 'N100 M30']);
    expect(result.warnings.filter((w) => w.key === 'ncNumbering.renumber.duplicatesMade')).toEqual([
      { key: 'ncNumbering.renumber.duplicatesMade', params: { count: 1 } },
    ]);
    expect(result.skipped.filter((r) => r.message === row).map((r) => [r.line, r.severity])).toEqual([
      [1, 'warning'],
      [2, 'warning'],
    ]);
    // A warning, not a refusal: the numbers are written.
    expect(result.summary.key).toBe('ncNumbering.renumber.summary');
  });

  it('warns about a number a skipped line kept', () => {
    const lines = ['N10 G0 X1.', 'N30 G0 X2. (KEEP)', 'N50 G0 X3.', 'N70 M30'];
    const result = run(FANUC, lines, { ...FREE, skipContaining: 'KEEP' });
    expect(result.lines).toEqual(['N10 G0 X1.', 'N30 G0 X2. (KEEP)', 'N20 G0 X3.', 'N30 M30']);
    expect(result.warnings.map((w) => w.key)).toEqual(['ncNumbering.renumber.duplicatesMade']);
    expect(result.skipped.filter((r) => r.message === row).map((r) => r.line)).toEqual([2, 4]);
  });

  it('says nothing about a number that was on several blocks before and is not on more now', () => {
    const lines = ['N30 G0 X1. (KEEP)', 'N30 G0 X2. (KEEP)', 'N50 G0 X3.'];
    const result = run(FANUC, lines, { ...FREE, skipContaining: 'KEEP' });
    expect(result.lines[2]).toBe('N10 G0 X3.');
    expect(result.warnings.map((w) => w.key)).not.toContain('ncNumbering.renumber.duplicatesMade');
  });

  it('counts the numbers, and lists at most 200 rows with the count of all of them', () => {
    // Every other line is skipped and keeps a number the run writes on the line after it.
    const lines: string[] = [];
    for (let i = 0; i < 300; i++) lines.push(`N${(2 * i + 1) * 10} G0 X${i}. (KEEP)`, `G1 X${i}.`);
    const result = run(FANUC, lines, { ...FREE, start: 10, step: 20, skipContaining: 'KEEP' });
    expect(result.lines[1]).toBe('N10 G1 X0.');
    expect(result.warnings.find((w) => w.key === 'ncNumbering.renumber.duplicatesMade')?.params).toEqual({ count: 300 });
    expect(result.skipped.length).toBeLessThanOrEqual(200);
    expect(result.warnings.map((w) => w.key)).toContain('ncNumbering.renumber.skippedTruncated');
  });

  it('leaves a run that wrapped to its own warning', () => {
    const lines = ['G0 X1.', 'G0 X2.', 'G0 X3.'];
    const result = run(FANUC, lines, { ...FREE, max: 20, onOverflow: 'wrap' });
    expect(result.lines).toEqual(['N10 G0 X1.', 'N20 G0 X2.', 'N10 G0 X3.']);
    expect(result.warnings.map((w) => w.key)).toEqual(['ncNumbering.renumber.wrapped']);
  });
});

describe('TransformResult.renumbered (§6.6 rule 11)', () => {
  it('lists every named program whose block numbers changed, with what became of them', () => {
    const lines = ['O1000', 'N5 G0 X0', 'N6 G1 X1', 'G1 X2', 'N10 M30', 'O2000', 'N10 G0 X0', 'N20 M99'];
    const result = run(FANUC, lines, {});
    expect(result.lines).toEqual(['O1000', 'N10 G0 X0', 'N20 G1 X1', 'N30 G1 X2', 'N40 M30', 'O2000', 'N10 G0 X0', 'N20 M99']);
    expect(result.renumbered).toEqual({
      byText: false,
      prefix: 'N',
      // O2000 kept every number, so it is not listed.
      programs: [
        {
          name: '1000',
          key: 1000,
          changed: new Map<number, string | null>([
            [5, '10'],
            [6, '20'],
            [10, '40'],
          ]),
          created: new Set([20, 30, 40]),
          duplicated: new Set(),
        },
      ],
    });
  });

  it('records a removed number as null and a number handed out twice as duplicated', () => {
    const removed = run(FANUC, ['O1000', 'N1 G0', 'N2 G1', 'N3 M30'], { everyNth: 2 });
    expect(removed.renumbered?.programs[0].changed).toEqual(
      new Map<number, string | null>([
        [1, '10'],
        [2, null],
        [3, '20'],
      ]),
    );
    const wrapped = run(FANUC, ['O1000', 'G0', 'G1', 'G1', 'M30'], { max: 20 });
    expect(wrapped.renumbered?.programs[0].duplicated).toEqual(new Set([10, 20]));
  });

  it('keeps the written digits where sequence numbers are names', () => {
    const result = run(OKUMA, ['O1001', 'N0010 G00 X0', 'N0020 M02'], {});
    expect(result.renumbered?.byText).toBe(true);
    expect(result.renumbered?.programs[0].changed).toEqual(
      new Map([
        ['0010', '10'],
        ['0020', '20'],
      ]),
    );
  });

  // P4d integration: the names are `indexPrograms`' own (P4.19), read from the start
  // pattern's `name` group — digits as the number they spell, a `<NAME>` as its text.
  it('names each program as its start line does', () => {
    const lines = ['O0100', 'N5 G0 X0', 'N6 M99', '<SHAFT_T12>', 'N5 G0 X1.', 'N6 M99', 'O0200', 'N10 G0 X2.', 'N20 M99'];
    const result = run(FANUC, lines, {});
    expect(result.renumbered?.programs.map((p) => [p.name, p.key, [...p.changed]])).toEqual([
      [
        '0100',
        100,
        [
          [5, '10'],
          [6, '20'],
        ],
      ],
      [
        'SHAFT_T12',
        'SHAFT_T12',
        [
          [5, '10'],
          [6, '20'],
        ],
      ],
    ]);
    // Okuma: a name of letters, and digits that stay text (sequence numbers are names there).
    const okuma = run(OKUMA, ['OABC', 'N0010 G00 X0', 'N0020 M02', 'O0012', 'N0010 G00 X1', 'N0020 M02'], {});
    expect(okuma.renumbered?.programs.map((p) => [p.name, p.key])).toEqual([
      ['ABC', 'ABC'],
      ['0012', '0012'],
    ]);
  });

  it('leaves out a program without a name, and is absent where no number changed', () => {
    expect(run(FANUC, ['G0 X0', 'G1 X1'], FREE).renumbered).toEqual({ byText: false, prefix: 'N', programs: [] });
    expect(run(FANUC, ['O1000', 'N10 G0 X0', 'N20 M30'], {}).renumbered).toBeUndefined();
    // Spacing alone is no changed number.
    expect(run(FANUC, ['O1000', 'N10 G0 X0', 'N20 M30'], { alignColumn: 8 }).renumbered).toBeUndefined();
    expect(run(KLARTEXT, ['0 BEGIN PGM T MM', '5 L Z+100 R0 FMAX', '9 END PGM T MM'], {}).renumbered).toBeUndefined();
  });
});
