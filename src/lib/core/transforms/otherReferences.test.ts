// References from the other open documents into a renumbered one (plan §6.6 rules 11–13).
// Owner: P4.20a. The service, the confirmation and the undo steps are P4.20b's
// (`app/renumberOthers.test.ts`); this file proves the rules: which documents are read,
// which references name a program of the renumbered document, and what each listed row is.
//
// The renumbered document is run through Renumber Blocks itself wherever the outcome can be
// made that way, so the rows follow what the run really reports in `renumbered`.

import { describe, expect, it } from 'vitest';
import { noMachine } from '$lib/core/machines/effective';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import fanucJson from '$lib/data/profiles/fanuc-gcode.json';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { applyOtherReferences, findOtherReferences, renumberedSourceOf } from './otherReferences';
import { renumber } from './renumber';
import type { CodeDb } from '$lib/core/codes/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { OtherReference, RenumberedSource } from './otherReferences';
import type { RenumberedProgram, RenumberOutcome } from './programs';
import type { TransformContext } from './types';

const NO_CODES: CodeDb = { dialect: 'none', version: 1, addresses: {}, codes: [] };

function compiledFrom(raw: unknown): CompiledProfile {
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  return compileProfile(checked.profile);
}

function builtin(id: string): CompiledProfile {
  return compiledFrom(BUILTIN_PROFILE_JSON.find((p) => (p as { id?: string }).id === id));
}

const FANUC = builtin('fanuc-gcode');
const LATHE = builtin('fanuc-lathe');

/**
 * The shipped Fanuc rules with `M98 P… Q…` allowed to rewrite. The owner keeps it
 * report-only (its Q depends on a parameter), so the `update` of a `called` reference is
 * proved on a profile a user could write. Same profile id as the shipped one.
 */
const CALLED_REWRITES: CompiledProfile = (() => {
  const profile = structuredClone(fanucJson) as unknown as { numbering: { references: { program?: string; rewrite?: boolean }[] } };
  const called = profile.numbering.references.find((rule) => rule.program === 'called');
  if (called === undefined) throw new Error('the shipped Fanuc profile has no called rule');
  delete called.rewrite;
  return compiledFrom(profile);
})();

function context(cp: CompiledProfile, lines: readonly string[], options: Record<string, unknown> = {}): TransformContext {
  return { cp, codes: NO_CODES, options, firstLine: 1, document: lines, machine: noMachine(cp.profile) };
}

/** Renumber Blocks over the whole of `lines` (the form's values in `options`), and the source it gives. */
function renumbered(lines: readonly string[], cp: CompiledProfile = FANUC, options: Record<string, unknown> = {}): { after: string[]; source: RenumberedSource } {
  const result = renumber.run(lines.slice(), context(cp, lines, options));
  if (result.renumbered === undefined) throw new Error(`the run changed no number: ${result.summary.key}`);
  return { after: result.lines, source: renumberedSourceOf(result.lines, cp, result.renumbered) };
}

/** A source with an outcome written by hand, for what a run cannot easily be made to do. */
function handMade(lines: readonly string[], programs: RenumberedProgram[], cp: CompiledProfile = FANUC, byText = false): RenumberedSource {
  const outcome: RenumberOutcome = { byText, prefix: 'N', programs };
  return renumberedSourceOf(lines, cp, outcome);
}

function program(name: string, changed: [number | string, string | null][], created: (number | string)[] = [], duplicated: (number | string)[] = []): RenumberedProgram {
  return { name, key: Number(name), changed: new Map(changed), created: new Set(created), duplicated: new Set(duplicated) };
}

/** The rows of one document as `[line, value, kind, new value, program]`, the shape a reader checks. */
function rows(refs: readonly OtherReference[]): [number, string, string, string | null, string][] {
  return refs.map((ref) => [ref.line, ref.text, ref.kind, ref.newText, ref.program]);
}

/** Finds the rows of each document, with every document on `cp` unless it says otherwise. */
function find(source: RenumberedSource, ...docs: (readonly string[] | { lines: readonly string[]; cp: CompiledProfile })[]): OtherReference[][] {
  return findOtherReferences(
    source,
    docs.map((doc) => ('cp' in doc ? doc : { lines: doc, cp: source.cp })),
  );
}

// ---------------------------------------------------------------------------------------
// The programs. A: the main program O1000 calls the subprogram O2000, which B holds. The run
// numbers A's blocks 10, 20, 30, 40 (they were 1, 2, 3, 4).
// ---------------------------------------------------------------------------------------

const MAIN_A = ['%', 'O1000 (MAIN)', 'N1 G00 X0 Z0', 'N2 M98 P2000', 'N3 G01 X10.', 'N4 M30', '%'];

/** B: the subprogram O2000, returning into a block of its caller. */
function subB(...returns: string[]): string[] {
  return ['%', 'O2000 (SUB)', 'N10 G00 X5.', ...returns, '%'];
}

describe('the source of a renumber (renumberedSourceOf)', () => {
  it('reads the programs and calls of the renumbered document, the untouched ones and the nameless ones too', () => {
    const lines = ['%', 'N1 M98 P2000', 'O1000', 'N1 M98 P2000', 'N2 M98 P#1', 'O1000', 'N1 G00', 'O3000', 'N1 G00', '%'];
    const source = handMade(lines, []);
    // The nameless segment before O1000 and the first O1000 both call O2000.
    expect(source.callers.get(2000)).toEqual([null, 1000]);
    expect(source.held.get(1000)).toBe(2);
    expect(source.held.get(3000)).toBe(1);
    expect(source.callsUnknown).toBe(true);
    expect(handMade(MAIN_A, []).callsUnknown).toBe(false);
  });
});

describe('P4.20a (the other documents, §6.6 rules 11–13)', () => {
  it('lists M99 P from another file into the single caller: the update carries the new value, padding kept', () => {
    const { after, source } = renumbered(MAIN_A);
    expect(after).toEqual(['%', 'O1000 (MAIN)', 'N10 G00 X0 Z0', 'N20 M98 P2000', 'N30 G01 X10.', 'N40 M30', '%']);
    expect(source.outcome.programs.map((p) => p.name)).toEqual(['1000']);

    const [b] = find(source, subB('M99 P3', 'M99 P0003', 'M99 P003'));
    expect(rows(b)).toEqual([
      [4, '3', 'update', '30', '1000'],
      [5, '0003', 'update', '0030', '1000'],
      // A value that outgrows its padding is written in full, never cut.
      [6, '003', 'update', '030', '1000'],
    ]);
    // The span is the value only, the address in front of it is not included.
    expect(b[0]).toMatchObject({ start: 5, end: 6 });
  });

  it('ignores own references, and values whose block the run did not change', () => {
    const { source } = renumbered(MAIN_A);
    // `GOTO 3` and the local call `M98 Q3` name blocks of B's own program; P50 named no block
    // of A before the run and names none after it.
    const [b] = find(source, ['%', 'O2000', 'N10 GOTO 3', 'N20 M98 Q3', 'N30 M99 P50', '%']);
    expect(b).toEqual([]);
  });

  it('reads only documents of the same profile: another one is neither listed nor counted as a caller', () => {
    const { source } = renumbered(MAIN_A);
    const lathe = { lines: subB('M99 P3'), cp: LATHE };
    expect(LATHE.profile.numbering?.references?.some((rule) => rule.program === 'caller')).toBe(true);
    expect(find(source, lathe, subB('M99 P3'))).toEqual([[], [expect.objectContaining({ kind: 'update', newText: '30' })]]);
    // A lathe document that also calls O2000 is never read, so the caller in A stays the only one.
    const latheCaller = { lines: ['%', 'O3000', 'N1 M98 P2000', '%'], cp: LATHE };
    expect(rows(find(source, subB('M99 P3'), latheCaller)[0])).toEqual([[4, '3', 'update', '30', '1000']]);
  });

  it('lists a caller reference only when exactly one program of all open documents calls it, in the renumbered document', () => {
    const { source } = renumbered(MAIN_A);
    // B calls O2000 itself: the return is B's own business.
    expect(find(source, ['%', 'O2000', 'N10 M99 P3', 'O2100', 'N10 M98 P2000', '%'])).toEqual([[]]);
    // A subprogram without a name is called by nobody anyone can name.
    expect(find(source, ['%', 'N10 G00 X5.', 'M99 P3', '%'])).toEqual([[]]);
    // B holds O2000 twice: which of them A calls cannot be told.
    expect(find(source, ['%', 'O2000', 'M99 P3', 'O2000', 'M99 P3', '%'])).toEqual([[]]);
    // The only caller is in another document, which this run did not renumber.
    const elsewhere = renumbered(['%', 'O1000', 'N1 G00', 'N2 X1.', '%']).source;
    expect(find(elsewhere, subB('M99 P1'), ['%', 'O3000', 'N1 M98 P2000', '%'])).toEqual([[], []]);
  });

  it('a renumbered program called from two other files: each call is listed in its own document', () => {
    // B and C both start O1000 at its block 3 (`M98 P… Q…`). The shipped profile never
    // rewrites that Q (the owner): the rows are `kept`, never `update`.
    const { source } = renumbered(MAIN_A);
    const b = ['%', 'O2000', 'N10 M98 P1000 Q3', '%'];
    const c = ['%', 'O3000', 'N10 G00 X1.', 'N20 M98 P1000 Q3', 'M30', '%'];
    const [rowsB, rowsC] = find(source, b, c);
    expect(rows(rowsB)).toEqual([[3, '3', 'kept', null, '1000']]);
    expect(rows(rowsC)).toEqual([[4, '3', 'kept', null, '1000']]);
    // On a profile that allows it, the same calls are updates.
    const rewriting = renumbered(MAIN_A, CALLED_REWRITES).source;
    expect(find(rewriting, b, c).map(rows)).toEqual([[[3, '3', 'update', '30', '1000']], [[4, '3', 'update', '30', '1000']]]);
  });

  it('a renumbered subprogram returned into from two files: the caller cannot be told, a callers row', () => {
    const { source } = renumbered(MAIN_A);
    const c = ['%', 'O3000', 'N1 M98 P2000', '%'];
    expect(rows(find(source, subB('M99 P3'), c)[0])).toEqual([[4, '3', 'callers', null, '1000']]);
    // A second caller in A itself: the same.
    const twoInA = renumbered([...MAIN_A.slice(0, -1), 'O1100', 'N1 M98 P2000', 'N2 M99', '%']).source;
    expect(rows(find(twoInA, subB('M99 P3'))[0])).toEqual([[4, '3', 'callers', null, '1000']]);
  });

  it('counts a call through a variable as a possible second caller, in any open document of the profile', () => {
    const unknownInA = renumbered([...MAIN_A.slice(0, -1), 'O1100', 'N1 M98 P#1', '%']).source;
    expect(unknownInA.callsUnknown).toBe(true);
    expect(rows(find(unknownInA, subB('M99 P3'))[0])).toEqual([[4, '3', 'callers', null, '1000']]);
    const { source } = renumbered(MAIN_A);
    // In B itself.
    expect(rows(find(source, [...subB('M99 P3').slice(0, -1), 'O2100', 'N1 M98 P#5', '%'])[0])).toEqual([[4, '3', 'callers', null, '1000']]);
    // In a third document.
    expect(rows(find(source, subB('M99 P3'), ['%', 'O3000', 'N1 M98 P#5', '%'])[0])).toEqual([[4, '3', 'callers', null, '1000']]);
    // On its own a call through a variable proves no call: nothing in A calls O2000 here.
    const alone = renumbered(['%', 'O1000', 'N1 M98 P#1', 'N2 X1.', '%']).source;
    expect(find(alone, subB('M99 P1'))).toEqual([[]]);
  });

  it('a caller program held under the same name elsewhere cannot be told: callers', () => {
    // A holds an O2000 of its own, so its call runs that one.
    const { source } = renumbered([...MAIN_A.slice(0, -1), 'O2000', 'N1 G00', 'N2 M99', '%']);
    expect(rows(find(source, subB('M99 P3'))[0])).toEqual([[4, '3', 'callers', null, '1000']]);
  });

  it('a caller without a name is not in the run outcome: its return is not listed', () => {
    const lines = ['%', 'N1 G00', 'N2 M98 P2000', 'N3 X1.', 'M30', 'O1100', 'N1 G00', 'N2 G01 X1.', '%'];
    const { source } = renumbered(lines);
    expect(source.callers.get(2000)).toEqual([null]);
    expect(find(source, subB('M99 P3'))).toEqual([[]]);
  });

  it('lists a called reference into a program of the renumbered document that the other document does not hold itself', () => {
    const { source } = renumbered(MAIN_A, CALLED_REWRITES);
    // The packed P (count 2, program 1000) and the repeat word name O1000 as well.
    const b = ['%', 'O2000', 'N10 M98 P1000 Q3', 'N20 M98 P21000 Q3', 'N30 M98 P1000 L2 Q0003', '%'];
    expect(rows(find(source, b)[0])).toEqual([
      [3, '3', 'update', '30', '1000'],
      [4, '3', 'update', '30', '1000'],
      [5, '0003', 'update', '0030', '1000'],
    ]);
    // B holds O1000 itself: its call runs B's own program.
    expect(find(source, ['%', 'O2000', 'N10 M98 P1000 Q3', 'O1000', 'N1 G00', '%'])).toEqual([[]]);
    // Another open document holds O1000 too: which one runs cannot be told.
    expect(find(source, b, ['%', 'O1000', 'N1 G00', '%'])[0]).toEqual([]);
    // A holds it twice.
    const twice = renumbered([...MAIN_A.slice(0, -1), 'O1000', 'N1 G00', 'N2 X1.', '%'], CALLED_REWRITES).source;
    expect(twice.held.get(1000)).toBe(2);
    expect(find(twice, b)).toEqual([[]]);
    // A program this run cannot name, or one nobody renumbered.
    expect(find(source, ['%', 'O2000', 'N10 M98 P#1 Q3', 'N20 M98 P5000 Q3', '%'])).toEqual([[]]);
  });

  it('M98 P… Q… is report-only (the owner): never an update, whatever happened to its block', () => {
    const { source } = renumbered(MAIN_A);
    const refs = find(source, ['%', 'O2000', 'N10 M98 P1000 Q3', 'N20 M98 P1000 Q20', 'N30 M98 P1000 Q50', '%'])[0];
    // Q3: the block has a new number (kept); Q20: named nothing and names `N20 M98 P2000` now (lands).
    expect(rows(refs)).toEqual([
      [3, '3', 'kept', null, '1000'],
      [4, '20', 'lands', null, '1000'],
    ]);
    expect(refs.every((ref) => ref.kind !== 'update' && ref.newText === null)).toBe(true);
    // And Update writes none of them.
    expect(applyOtherReferences(['x'], refs)).toEqual({ lines: ['x'], changed: 0 });
  });

  it('marks gone, duplicate, lands and callers rows, which carry no new value', () => {
    // Every 2nd block: N2 and N4 lose their number (no reference of A names them).
    const nth = renumbered(MAIN_A, FANUC, { everyNth: 2 });
    expect(nth.after.slice(2, 6)).toEqual(['N10 G00 X0 Z0', 'M98 P2000', 'N20 G01 X10.', 'M30']);
    expect(rows(find(nth.source, subB('M99 P2', 'M99 P3', 'M99 P10'))[0])).toEqual([
      [4, '2', 'gone', null, '1000'],
      [5, '3', 'update', '20', '1000'],
      [6, '10', 'lands', null, '1000'],
    ]);

    // A wrapping run hands one number to two blocks: a value that would name it is a duplicate,
    // and so is one whose block kept a number the run gave to another block as well.
    const source = handMade(MAIN_A, [program('1000', [[3, '30'], [4, '40']], [30, 40], [30, 1])]);
    expect(rows(find(source, subB('M99 P3', 'M99 P1', 'M99 P4'))[0])).toEqual([
      [4, '3', 'duplicate', null, '1000'],
      [5, '1', 'duplicate', null, '1000'],
      [6, '4', 'update', '40', '1000'],
    ]);
    // Several possible callers: listed as callers whatever became of the block.
    expect(rows(find(source, subB('M99 P3'), ['%', 'O3000', 'N1 M98 P2000', '%'])[0])).toEqual([[4, '3', 'callers', null, '1000']]);
  });

  it('where sequence numbers are names, an update is exactly the block text, padding and all', () => {
    const source = handMade(MAIN_A, [program('1000', [['0003', '30'], ['3', '0030']])], FANUC, true);
    expect(rows(find(source, subB('M99 P0003', 'M99 P3'))[0])).toEqual([
      [4, '0003', 'update', '30', '1000'],
      [5, '3', 'update', '0030', '1000'],
    ]);
  });

  it('a line with two words of the address cannot be told: kept, never an update', () => {
    const { source } = renumbered(MAIN_A, CALLED_REWRITES);
    expect(rows(find(source, ['%', 'O2000', 'N10 M98 P1000 Q3 Q4', '%'])[0])).toEqual([
      [3, '3', 'kept', null, '1000'],
      [3, '4', 'kept', null, '1000'],
    ]);
  });

  it('lists nothing for a run without named programs or a profile without cross-program rules', () => {
    expect(find(handMade(MAIN_A, []), subB('M99 P3'))).toEqual([[]]);
    const okuma = builtin('okuma-osp');
    const source = handMade(['O1000', 'N1 G00'], [program('1000', [[1, '10']])], okuma);
    expect(find(source, ['GOTO N1'])).toEqual([[]]);
  });

  it('writes an update row the way it was listed, several on a line from the back', () => {
    const { source } = renumbered(MAIN_A, CALLED_REWRITES);
    const b = ['%', 'O2000', 'N10 M98 P1000 Q3', 'N20 M99 P0002', '%'];
    // O2000 returns into A as well: one line with a called value, one with a returned one.
    const refs = find(source, b)[0];
    expect(refs.map((ref) => ref.kind)).toEqual(['update', 'update']);
    expect(applyOtherReferences(b, refs)).toEqual({ lines: ['%', 'O2000', 'N10 M98 P1000 Q30', 'N20 M99 P0020', '%'], changed: 2 });

    // Two values on one line, written from the back so the first keeps its offsets.
    const line = 'G65 P9000 A3 B44';
    const two: OtherReference[] = [
      { line: 1, start: 11, end: 12, text: '3', newText: '300', kind: 'update', program: '9000' },
      { line: 1, start: 14, end: 16, text: '44', newText: '4', kind: 'update', program: '9000' },
      { line: 1, start: 6, end: 9, text: '000', newText: '999', kind: 'gone', program: '9000' },
    ];
    expect(applyOtherReferences([line], two)).toEqual({ lines: ['G65 P9000 A300 B4'], changed: 2 });
    // A span that no longer reads the listed value is left alone and not counted.
    expect(applyOtherReferences(['G65 P9000 A7 B44'], two)).toEqual({ lines: ['G65 P9000 A7 B4'], changed: 1 });
    // The input is never changed in place.
    const input = [line];
    applyOtherReferences(input, two);
    expect(input).toEqual([line]);
  });
});

describe('the P4d review fixes (NC-1, NC-2, CODE-10)', () => {
  /** The `M99 P3` on line 3 of each B below, into A's N3 (N30 after the run). */
  const update: [number, string, string, string | null, string] = [3, '3', 'update', '30', '1000'];

  // NC-1: any call rule that fired without its word used to make B its own caller, so B's
  // return into A was taken for B's own business and not listed.
  it('lists the return of a program whose only call of itself is a bare M96 (no call at all)', () => {
    const { source } = renumbered(MAIN_A);
    expect(rows(find(source, ['%', 'O2000', 'M99 P3', 'N10 M96', '%'])[0])).toEqual([update]);
  });

  it('leaves a return that ends a part B runs with a local call to B, and lists one outside that part', () => {
    const { source } = renumbered(MAIN_A);
    // The return ends the part N50 … M99 P3 that `M98 Q50` runs: it returns into O2000.
    expect(find(source, ['%', 'O2000', 'N10 M98 Q50', 'N20 M99', 'N50 G0 X1.', 'N60 M99 P3', '%'])).toEqual([[]]);
    // The return is above the part: it returns into O2000's caller, A's O1000.
    expect(rows(find(source, ['%', 'O2000', 'M99 P3', 'N10 M98 Q50', 'N50 G0 X1.', 'N60 M99', '%'])[0])).toEqual([update]);
    // A local call whose part cannot be found (a variable) may end anywhere: a second possible caller.
    expect(rows(find(source, ['%', 'O2000', 'M99 P3', 'N10 M98 Q#1', 'N50 G0 X1.', 'N60 M99', '%'])[0])).toEqual([
      [3, '3', 'callers', null, '1000'],
    ]);
  });

  // NC-2: an interrupt returns into whichever program it interrupted.
  it('never lists the return of a program an interrupt may start as an update, wherever the interrupt is', () => {
    const callers: [number, string, string, string | null, string][] = [[4, '3', 'callers', null, '1000']];
    const withInterrupt = renumbered(['%', 'O1000 (MAIN)', 'N1 G00 X0 Z0', 'N2 M98 P2000', 'N3 G01 X10.', 'N4 M96 P2000', 'N5 M30', '%']).source;
    expect(withInterrupt.interrupted).toEqual(new Set([2000]));
    expect(rows(find(withInterrupt, subB('M99 P3'))[0])).toEqual(callers);
    const unknownInterrupt = renumbered(['%', 'O1000 (MAIN)', 'N1 G00 X0 Z0', 'N2 M98 P2000', 'N3 G01 X10.', 'N4 M96 P#1', 'N5 M30', '%']).source;
    expect(unknownInterrupt.interruptsUnknown).toBe(true);
    expect(rows(find(unknownInterrupt, subB('M99 P3'))[0])).toEqual(callers);
    const { source } = renumbered(MAIN_A);
    // In B itself, and in a third document.
    expect(rows(find(source, [...subB('M99 P3').slice(0, -1), 'O2100', 'N1 M96 P2000', '%'])[0])).toEqual(callers);
    expect(rows(find(source, subB('M99 P3'), ['%', 'O3000', 'N1 M96 P2000', '%'])[0])).toEqual(callers);
    // An interrupt alone is no caller in A at all.
    const onlyInterrupt = renumbered(['%', 'O1000', 'N1 G00', 'N2 M96 P2000', 'N3 X1.', '%']).source;
    expect(find(onlyInterrupt, subB('M99 P3'))).toEqual([[]]);
  });

  // CODE-10: a number on two blocks of A before the run named no one block, and the run
  // changed one of them; the value in B used to be dropped from the list in silence.
  it('lists a value whose number was on several blocks before the run, one of which the run changed, as a duplicate', () => {
    const { after, source } = renumbered(['%', 'O1000', 'N1 G00', 'N3 X1.', 'N3 X2.', 'N4 M30', '%']);
    expect(after).toEqual(['%', 'O1000', 'N10 G00', 'N20 X1.', 'N30 X2.', 'N40 M30', '%']);
    expect([...source.outcome.programs[0].duplicated]).toContain(3);
    expect(rows(find(source, ['%', 'O2000', 'N10 M98 P1000 Q3', '%'])[0])).toEqual([[3, '3', 'duplicate', null, '1000']]);
  });
});
