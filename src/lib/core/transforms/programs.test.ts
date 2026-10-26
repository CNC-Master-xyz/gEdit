// The programs of a file and the calls between them (plan §6.6 rules 8–10). Owner: P4.19.
//
// The P4d prelude wrote the contract rows (the profile members load and are checked, a
// reference word says which program it names, the seam in Renumber Blocks reports a
// reference it cannot place instead of rewriting it); P4.19 filled the stubs in and proves
// here what each rule of the module header does: the names of the programs, the calls a
// line makes (Fanuc's packed `P`, the repeat word, a program name), the resolution of
// `called` and `caller` with each of the five refusals, and what the shipped Fanuc data
// does with it in a renumber.

import { describe, expect, it } from 'vitest';
import { noMachine } from '$lib/core/machines/effective';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import fanucJson from '$lib/data/profiles/fanuc-gcode.json';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { testReport } from '$lib/core/profiles/testReport';
import { t } from '$lib/i18n';
import { callOn, indexPrograms, programKeyOf, targetProgramOf } from './programs';
import { referenceAddresses, referencesOn, scanProgram } from './references';
import { renumber } from './renumber';
import type { CodeDb } from '$lib/core/codes/types';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import type { CallTarget, TargetProgram } from './programs';
import type { TransformContext } from './types';

const NO_CODES: CodeDb = { dialect: 'none', version: 1, addresses: {}, codes: [] };

const BUILTINS: CompiledProfile[] = BUILTIN_PROFILE_JSON.map((raw) => {
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(`a built-in profile does not validate: ${checked.errors.join('; ')}`);
  return compileProfile(checked.profile);
});

function builtin(id: string): CompiledProfile {
  const found = BUILTINS.find((cp) => cp.profile.id === id);
  if (!found) throw new Error(`no profile ${id}`);
  return found;
}

/** A fresh Fanuc profile a test can change in one place. */
function fanuc(): Record<string, unknown> {
  return structuredClone(fanucJson) as unknown as Record<string, unknown>;
}

function numberingOf(profile: Record<string, unknown>): Record<string, unknown> {
  return profile.numbering as Record<string, unknown>;
}

type RawRule = { trigger: string; addresses: string[]; rewrite?: boolean; program?: string };

function rulesOf(profile: Record<string, unknown>): RawRule[] {
  return numberingOf(profile).references as RawRule[];
}

function compiledFrom(profile: Record<string, unknown>): CompiledProfile {
  const checked = validateProfile(profile);
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  return compileProfile(checked.profile);
}

/** The paths the errors of a changed profile point at. */
function pathsOf(patch: (p: Record<string, unknown>) => void): string[] {
  const profile = fanuc();
  patch(profile);
  const result = validateProfile(profile);
  return result.ok ? [] : result.errors.map((error) => error.slice(0, error.indexOf(':')));
}

function context(cp: CompiledProfile, document?: readonly string[], options: Record<string, unknown> = {}): TransformContext {
  return { cp, codes: NO_CODES, options, firstLine: 1, document, machine: noMachine(cp.profile) };
}

/**
 * The shipped Fanuc rules with the `M98 P… Q…` rule allowed to rewrite: the owner keeps it
 * report-only (its Q depends on a parameter), so the `called` resolution is proved on a
 * profile a user could write.
 */
function withCalledRewrite(): Record<string, unknown> {
  const profile = fanuc();
  const called = rulesOf(profile).find((rule) => rule.program === 'called');
  if (called === undefined) throw new Error('the shipped Fanuc profile has no called rule');
  delete called.rewrite;
  return profile;
}

function callOf(cp: CompiledProfile, line: string): CallTarget | null {
  return callOn(tokenizeLine(line, cp).tokens, line, cp);
}

/** Where each reference of the program points, as `[line, address, answer]`. */
function targetsOf(cp: CompiledProfile, lines: readonly string[]): [number, string, TargetProgram][] {
  const scan = scanProgram(lines, context(cp, lines));
  const index = indexPrograms(scan, cp);
  return scan.found.map(({ row, word }) => [row + 1, word.address, targetProgramOf(scan, index, row, word)]);
}

describe('the profile members of P4d (§6.6)', () => {
  it('leave every built-in profile valid; only the Fanuc profiles call programs, the lathe through extends', () => {
    for (const raw of BUILTIN_PROFILE_JSON) {
      const checked = validateProfile(raw);
      expect(checked.ok).toBe(true);
      const profile = raw as unknown as Profile;
      const calls = (profile.numbering as unknown as Record<string, unknown> | undefined)?.calls;
      // M98, G65/G66/G66.1, and since the owner's answer of 2026-10-20 G72.1/G72.2, M96 and M198.
      if (profile.id === 'fanuc-gcode' || profile.id === 'fanuc-lathe') expect(calls).toHaveLength(5);
      else expect(calls).toBeUndefined();
    }
    expect(builtin('fanuc-lathe').re.calls).toEqual(builtin('fanuc-gcode').re.calls);
  });

  it('accept a reference program and call rules', () => {
    expect(pathsOf((p) => Object.assign(p, withCalledRewrite()))).toEqual([]);
    const cp = builtin('fanuc-gcode');
    expect(cp.re.calls?.[0]).toMatchObject({ address: 'P', maxDigits: 4, repeatAddress: 'L' });
    expect(cp.re.calls?.[1]).toMatchObject({ address: 'P', maxDigits: null, repeatAddress: null });
    expect(cp.re.calls?.[0].trigger.test('N20 M98 P1000')).toBe(true);
  });

  it('compile no call rule for a profile without one', () => {
    const profile = fanuc();
    delete numberingOf(profile).calls;
    expect(compiledFrom(profile).re.calls).toEqual([]);
  });

  it('report a wrong program, a broken call rule and its pattern with their paths', () => {
    expect(
      pathsOf((p) => {
        rulesOf(p)[0].program = 'parent';
      }),
    ).toEqual(['numbering.references[0].program']);
    expect(
      pathsOf((p) => {
        numberingOf(p).calls = [{ trigger: '(', address: 'P' }];
      }),
    ).toEqual(['numbering.calls[0].trigger']);
    expect(
      pathsOf((p) => {
        numberingOf(p).calls = [{ trigger: 'M98', address: '9', maxDigits: 0, repeatAddress: 'L L' }];
      }),
    ).toEqual(['numbering.calls[0].address', 'numbering.calls[0].maxDigits', 'numbering.calls[0].repeatAddress']);
    expect(
      pathsOf((p) => {
        numberingOf(p).calls = 'M98';
      }),
    ).toEqual(['numbering.calls']);
    // P4d review CODE-6: the upper bounds.
    expect(
      pathsOf((p) => {
        numberingOf(p).calls = [
          { trigger: 'M98', address: 'P', maxDigits: 17 },
          { trigger: 'M98', address: 'P', maxDigits: 16 },
        ];
      }),
    ).toEqual(['numbering.calls[0].maxDigits']);
    expect(
      pathsOf((p) => {
        numberingOf(p).calls = Array.from({ length: 201 }, () => ({ trigger: 'M98', address: 'P' }));
      }),
    ).toEqual(['numbering.calls']);
    // P4d review NC-1 and NC-2: the word of a local call is an address, the interrupt a yes or no.
    expect(
      pathsOf((p) => {
        numberingOf(p).calls = [{ trigger: 'M98', address: 'P', localAddress: 'Q Q', interrupt: 'yes' }];
      }),
    ).toEqual(['numbering.calls[0].localAddress', 'numbering.calls[0].interrupt']);
  });

  it('compile the local word and the interrupt of the shipped M98 and M96 rules (P4d review NC-1, NC-2)', () => {
    const calls = builtin('fanuc-gcode').re.calls ?? [];
    expect(calls.map((rule) => [rule.localAddress, rule.interrupt])).toEqual([
      ['Q', false],
      [null, false],
      [null, false],
      [null, true],
      [null, false],
    ]);
  });

  it('check the call patterns of a variant overlay too', () => {
    const profile = fanuc();
    profile.machineParams = {
      variants: [
        {
          id: 'calls',
          label: 'Calls',
          choices: [{ value: 'a', label: 'A', overlay: { numbering: { start: 10, step: 10, calls: [{ trigger: '(', address: 'P' }] } } }],
          default: 'a',
        },
      ],
    };
    const result = validateProfile(profile);
    expect(result.ok ? [] : result.errors.join('\n')).toContain('numbering.calls[0].trigger');
  });
});

describe('the program a reference word names (§6.6 rule 8)', () => {
  function wordsOf(cp: CompiledProfile, line: string) {
    return referencesOn(tokenizeLine(line, cp).tokens, line, cp, referenceAddresses(cp));
  }

  it('is the caller for M99 P, the called program for M98 P… Q…, and the own one for a local call and GOTO', () => {
    for (const id of ['fanuc-gcode', 'fanuc-lathe']) {
      const cp = builtin(id);
      expect(wordsOf(cp, 'M99 P30').map((w) => [w.program, w.rewrite])).toEqual([['caller', true]]);
      // The owner (2026-10-19): which block Q names depends on a parameter, so it stays report-only.
      expect(wordsOf(cp, 'M98 P1000 Q30').map((w) => [w.program, w.rewrite])).toEqual([['called', false]]);
      expect(wordsOf(cp, 'M98 <SHAFT_T12> Q30').map((w) => [w.program, w.rewrite])).toEqual([['called', false]]);
      expect(wordsOf(cp, 'M98 Q30').map((w) => [w.program, w.rewrite])).toEqual([['own', true]]);
      expect(wordsOf(cp, 'GOTO 100').map((w) => [w.program, w.rewrite])).toEqual([['own', true]]);
    }
  });

  it('reads a M98 whose program is a variable as a call into another program, never as a local call', () => {
    // Before P4.19 the local rule wanted no `P` followed by a digit, so `M98 P#1 Q30` was a
    // local call and its Q was rewritten with a block number of the caller.
    const cp = builtin('fanuc-gcode');
    expect(wordsOf(cp, 'M98 P#1 Q30').map((w) => [w.program, w.rewrite])).toEqual([['called', false]]);
    expect(wordsOf(cp, 'M98 P[#1+1] Q30').map((w) => [w.program, w.rewrite])).toEqual([['called', false]]);
  });

  it('takes the rewrite away when the rules that fire disagree', () => {
    const profile = withCalledRewrite();
    // A local trigger that fires on `M98 P… Q…` as well: two rules, two programs.
    rulesOf(profile)[1].trigger = '^(?=[^(]*Q\\s*\\d)[^(]*(?<![A-Z])M\\s*0*98(?!\\d)';
    const [word] = wordsOf(compiledFrom(profile), 'M98 P1000 Q30');
    expect(word).toMatchObject({ program: 'own', rewrite: false });
  });
});

describe('program names (§6.6 rule 9)', () => {
  it('names a program by the `name` group of its start pattern; a segment without one has no name', () => {
    const cp = builtin('fanuc-gcode');
    const lines = ['%', 'O0100 (MAIN)', 'N10 M98 P100', 'M30', '<shaft_t12>', 'M99', ':200', 'M99', '%'];
    const index = indexPrograms(scanProgram(lines, context(cp, lines)), cp);
    expect(index.programs.map((p) => [p.row, p.name, p.key])).toEqual([
      [0, null, null],
      [1, '0100', 100],
      [4, 'shaft_t12', 'SHAFT_T12'],
      [6, '200', 200],
    ]);
    expect([...index.byKey]).toEqual([
      [100, [1]],
      ['SHAFT_T12', [2]],
      [200, [3]],
    ]);

    const nameless = fanuc();
    (nameless.program as { start: string[] }).start = ['^\\s*O\\d+'];
    const plain = compiledFrom(nameless);
    const unnamed = indexPrograms(scanProgram(lines, context(plain, lines)), plain);
    expect(unnamed.programs.map((p) => p.name)).toEqual([null, null]);
    expect(unnamed.byKey.size).toBe(0);
  });

  it('compares digit names as numbers where block numbers are numbers (O0100 is P100), as upper-case text elsewhere', () => {
    const fanucCp = builtin('fanuc-gcode');
    expect(programKeyOf('0100', fanucCp)).toBe(100);
    expect(programKeyOf('100', fanucCp)).toBe(100);
    expect(programKeyOf('0', fanucCp)).toBe(0);
    expect(programKeyOf('Shaft_T12', fanucCp)).toBe('SHAFT_T12');
    expect(programKeyOf('', fanucCp)).toBeNull();
    // Too long for a number held exactly: its digits, without the zeros in front.
    expect(programKeyOf('00012345678901234567', fanucCp)).toBe('12345678901234567');
    // Okuma compares its sequence numbers as names, and so its program names.
    const okuma = builtin('okuma-osp');
    expect(programKeyOf('0100', okuma)).toBe('0100');
    expect(programKeyOf('abcd', okuma)).toBe('ABCD');
  });
});

describe('the program a line calls (§6.6 rule 9)', () => {
  const cp = builtin('fanuc-gcode');

  it('reads the called program from the call word: up to maxDigits digits, or any length beside a repeat word (L)', () => {
    expect(callOf(cp, 'N20 M98 P1000')).toEqual({ key: 1000, text: 'P1000' });
    expect(callOf(cp, 'M98P100')).toEqual({ key: 100, text: 'P100' });
    expect(callOf(cp, 'M98 P1010 L2')?.key).toBe(1010);
    // The 30i manuals: a program of five to eight digits takes its count in L.
    expect(callOf(cp, 'M98 P12345 L2')?.key).toBe(12345);
    expect(callOf(cp, 'X100. M98 P1200')?.key).toBe(1200);
    // G65, G66 and G66.1 take the count in L and never pack it.
    expect(callOf(cp, 'G65 P9010 L2 A1. B2.')?.key).toBe(9010);
    expect(callOf(cp, 'G65 P21010')?.key).toBe(21010);
    expect(callOf(cp, 'G66 P9100 Z-20. R5. F500')?.key).toBe(9100);
    expect(callOf(cp, 'G66.1 P9110')?.key).toBe(9110);
  });

  // The owner, 2026-10-20; the 30i manuals: the contour copy G72.1/G72.2 calls the program
  // its P names (or a `<NAME>` behind it) and takes the count in L; the interrupt macro M96
  // names its program the same way; the external call M198 reads its P like M98, a count
  // packed in front of a four-digit program included.
  it('reads the contour copy G72.1/G72.2, the interrupt macro M96 and the external call M198 as calls', () => {
    for (const id of ['fanuc-gcode', 'fanuc-lathe']) {
      const c = builtin(id);
      expect(callOf(c, 'N40 G72.1 P2000 L3 X0 Y0 R120.'), id).toEqual({ key: 2000, text: 'P2000' });
      expect(callOf(c, 'N60 G72.2 P2000 L3 I90. J0')?.key, id).toBe(2000);
      // The count is always an L word: a long P is the program.
      expect(callOf(c, 'G72.1 P21010 X0 Y0 R45.')?.key, id).toBe(21010);
      expect(callOf(c, 'G72.2 <R50> L1 I0 J0')?.key, id).toBe('R50');
      expect(callOf(c, 'M96 P9100')?.key, id).toBe(9100);
      expect(callOf(c, 'M96 <R50>')?.key, id).toBe('R50');
      expect(callOf(c, 'M198 P0123 L3')?.key, id).toBe(123);
      expect(callOf(c, 'M198 P30123')?.key, id).toBe(123);
      expect(callOf(c, 'M198 P12345 L2')?.key, id).toBe(12345);
      // Not calls: the turning cycles G72/G73, M97 (interrupts off), other M codes with 96/198 in them.
      expect(callOf(c, 'G72 P10 Q20 U0.2 W0.1'), id).toBeNull();
      expect(callOf(c, 'G73 P10 Q20'), id).toBeNull();
      expect(callOf(c, 'G72.12 P2000'), id).toBeNull();
      expect(callOf(c, 'M97'), id).toBeNull();
      expect(callOf(c, 'M960 P100'), id).toBeNull();
      expect(callOf(c, 'M1980 P100'), id).toBeNull();
    }
  });

  it('reads a longer call word without the repeat word as a count and a program of maxDigits digits (P21010 = 2 x O1010)', () => {
    expect(callOf(cp, 'N0030 M98 P21010')).toEqual({ key: 1010, text: 'P21010' });
    expect(callOf(cp, 'M98 P51002')?.key).toBe(1002);
    // A program below four digits is padded with zeros when a count stands in front of it.
    expect(callOf(cp, 'M98 P50001')?.key).toBe(1);
    expect(callOf(cp, 'M98 P100100')?.key).toBe(100);
  });

  it('reads a program-name token as the called program (`M98 <SHAFT_T12>`)', () => {
    expect(callOf(cp, 'M98 <SHAFT_T12>')).toEqual({ key: 'SHAFT_T12', text: '<SHAFT_T12>' });
    expect(callOf(cp, 'G65 <R50> L1 A0')?.key).toBe('R50');
    expect(callOf(cp, 'G66 <r50> L1 A1')?.key).toBe('R50');
    expect(callOf(cp, 'G66.1 <R50> L1 A2')?.key).toBe('R50');
  });

  it('gives no program for a variable, an expression, a value too long, two words, or two call rules that name different programs', () => {
    expect(callOf(cp, 'M98 P#1')?.key).toBeNull();
    expect(callOf(cp, 'M98 P[#1+1]')?.key).toBeNull();
    expect(callOf(cp, 'G65 P#10 A1.')?.key).toBeNull();
    expect(callOf(cp, 'M98 P1000.')?.key).toBeNull();
    expect(callOf(cp, 'M98 P1234567890')?.key).toBeNull();
    expect(callOf(cp, 'M98 P1000 P2000')?.key).toBeNull();
    expect(callOf(cp, 'M98 <A> P1000')?.key).toBeNull();
    // M98 and G65 on one block, each naming its own program.
    expect(callOf(cp, 'M98 P1000 G65 P1000')?.key).toBeNull();
    const two = fanuc();
    numberingOf(two).calls = [
      { trigger: '(?<![A-Z])M\\s*0*98(?!\\d)', address: 'P' },
      { trigger: '(?<![A-Z])M\\s*0*98(?!\\d)', address: 'H' },
    ];
    const twoCp = compiledFrom(two);
    expect(callOf(twoCp, 'M98 P1000 H2000')?.key).toBeNull();
    expect(callOf(twoCp, 'M98 P1000 H1000')?.key).toBe(1000);
  });

  it('reads no call where no rule fires, and not in a comment', () => {
    expect(callOf(cp, 'G0 X10. P1000')).toBeNull();
    expect(callOf(cp, 'G0 X10. (M98 P1000)')).toBeNull();
    expect(callOf(builtin('okuma-osp'), 'CALL OABCD')).toBeNull();
    expect(callOf(builtin('sinumerik'), 'L10')).toBeNull();
  });

  it('reads M98 with Q and without P or a name as a local call of the own program (`M98 Q30`), and the part it runs', () => {
    expect(callOf(cp, 'M98 Q30')).toEqual({ key: null, text: '', local: true });
    const lines = ['O0001', 'N10 M98 Q100', 'N20 M30', 'N100 G0 X0', 'N110 M99'];
    const index = indexPrograms(scanProgram(lines, context(cp, lines)), cp);
    expect(index.calls.get(1)).toEqual({ key: 1, text: '', local: true });
    // P4d review NC-1: the program is no caller of itself as a whole, only of the part
    // from N100 to the return behind it.
    expect([...index.callers]).toEqual([]);
    expect([...index.localParts]).toEqual([[0, [{ from: 3, to: 4 }]]]);
  });

  // P4d review NC-1: before the fix every call rule that fired without its word was a local
  // call, so a bare M96 made its program its own caller and an M99 P in it was rewritten.
  it('reads no call where a rule fires without its word and is no local call (a bare M96, M98, G65, M198)', () => {
    for (const id of ['fanuc-gcode', 'fanuc-lathe']) {
      const c = builtin(id);
      for (const line of ['N20 M96', 'M98', 'G65 A1. B2.', 'G66 Z-20.', 'G72.1 X0 Y0 R120.', 'M198', 'M96 Q30', 'M198 Q30']) {
        expect(callOf(c, line), `${id} ${line}`).toBeNull();
      }
    }
    // A user's rule without a local word calls nothing without its word either.
    const profile = fanuc();
    numberingOf(profile).calls = [{ trigger: '(?<![A-Z])M\\s*0*98(?!\\d)', address: 'P' }];
    expect(callOf(compiledFrom(profile), 'M98 Q30')).toBeNull();
  });

  // P4d review NC-2: M96 starts its program as an interrupt.
  it('marks the interrupt macro M96 as an interrupt, and keeps it out of the callers', () => {
    expect(callOf(cp, 'M96 P9100')).toEqual({ key: 9100, text: 'P9100', interrupt: true });
    expect(callOf(cp, 'M96 P#1')).toMatchObject({ key: null, interrupt: true });
    expect(callOf(cp, 'M98 P9100')?.interrupt).toBeUndefined();
    const lines = ['O0001', 'N10 M96 P2000', 'N20 M98 P3000', 'N30 M96 P#1', 'N40 M30', 'O2000', 'M99', 'O3000', 'M99'];
    const index = indexPrograms(scanProgram(lines, context(cp, lines)), cp);
    expect([...index.callers]).toEqual([[3000, [0]]]);
    expect([...index.interrupted]).toEqual([[2000, [0]]]);
    expect(index.unknownInterrupts).toEqual([0]);
    expect(index.unknownCallers).toEqual([]);
  });

  it('indexes every call by row, the callers of each program once, and the programs with an unknown call', () => {
    const lines = ['O0001', 'M98 P1000', 'M98 P21000', 'M98 P#1', 'M30', 'O0002', 'G65 P1000', 'M30', 'O1000', 'M99'];
    const index = indexPrograms(scanProgram(lines, context(cp, lines)), cp);
    expect([...index.calls.keys()]).toEqual([1, 2, 3, 6]);
    expect([...index.callers]).toEqual([[1000, [0, 1]]]);
    expect(index.unknownCallers).toEqual([0]);
  });
});

describe('resolution, per reference (§6.6 rule 10)', () => {
  it('resolves `called` to the one program of the file with that name; notInFile, programTwice, noCall otherwise', () => {
    const cp = compiledFrom(withCalledRewrite());
    const lines = [
      'O0001',
      'N10 M98 P2000 Q50',
      'N20 M98 P3000 Q50',
      'N30 M98 P#1 Q50',
      'N40 M98 P4000 Q50',
      'N50 M98 Q50',
      'N60 M30',
      'O2000',
      'N50 M99',
      'O4000',
      'N50 M99',
      'O4000',
      'N50 M99',
    ];
    expect(targetsOf(cp, lines)).toEqual([
      [2, 'Q', { segment: 1 }],
      [3, 'Q', { refused: 'notInFile', key: 3000 }],
      [4, 'Q', { refused: 'noCall', key: null }],
      [5, 'Q', { refused: 'programTwice', key: 4000 }],
      // The local call names a block of its own program.
      [6, 'Q', { segment: 0 }],
    ]);
  });

  it('resolves `caller` to the one program of the file that calls it; noCaller (none, or no name) and callers (several) otherwise', () => {
    const cp = builtin('fanuc-lathe');
    const lines = [
      'N10 M98 P1000', // a main program without a number: segment 0
      'N20 M98 P2000',
      'N25 M99 P10',
      'O0300',
      'N10 M98 P2000',
      'N20 M98 <SUB_A>',
      'N30 M30',
      'O1000',
      'N10 M99 P20',
      'O2000',
      'N10 M99 P20',
      '<SUB_A>',
      'N10 M99 P20',
      'O5000',
      'N10 M99 P20',
    ];
    expect(targetsOf(cp, lines)).toEqual([
      [3, 'P', { refused: 'noCaller', key: null }],
      [9, 'P', { segment: 0 }],
      [11, 'P', { refused: 'callers', key: 2000 }],
      [13, 'P', { segment: 1 }],
      [15, 'P', { refused: 'noCaller', key: 5000 }],
    ]);
  });

  it('refuses a `caller` whose program is in the file twice, and counts a program with an unknown call as a caller of every one', () => {
    const cp = builtin('fanuc-gcode');
    const twice = ['O0001', 'M98 P1000', 'M30', 'O1000', 'N10 M99 P20', 'O1000', 'N10 M99 P20'];
    expect(targetsOf(cp, twice).map(([, , answer]) => answer)).toEqual([
      { refused: 'programTwice', key: 1000 },
      { refused: 'programTwice', key: 1000 },
    ]);
    const unknown = ['O0001', 'N10 M98 P1000', 'N20 M30', 'O0002', 'N10 M98 P#1', 'N20 M30', 'O1000', 'N10 M99 P10'];
    expect(targetsOf(cp, unknown).map(([, , answer]) => answer)).toEqual([{ refused: 'callers', key: 1000 }]);
    // Only a call through a variable, which proves no call of O1000 at all.
    const onlyUnknown = ['O0002', 'N10 M98 P#1', 'N20 M30', 'O1000', 'N10 M99 P10'];
    expect(targetsOf(cp, onlyUnknown).map(([, , answer]) => answer)).toEqual([{ refused: 'noCaller', key: 1000 }]);
    // The one caller's own call through a variable leaves it the one caller.
    const ownUnknown = ['O0001', 'N10 M98 P1000', 'N20 M98 P#1', 'N30 M30', 'O1000', 'N10 M99 P10'];
    expect(targetsOf(cp, ownUnknown).map(([, , answer]) => answer)).toEqual([{ segment: 0 }]);
  });

  it('counts a local call: the program is its own caller, beside any program that calls it', () => {
    const cp = builtin('fanuc-gcode');
    // A main program whose local subprogram returns with M99 P: the return stays in it.
    const local = ['O0001', 'N10 M98 Q100', 'N20 M30', 'N100 G0 X0', 'N110 M99 P20'];
    expect(targetsOf(cp, local).map(([line, address, answer]) => [line, address, answer])).toEqual([
      [2, 'Q', { segment: 0 }],
      [5, 'P', { segment: 0 }],
    ]);
    // Called from O0002 as well: the M99 P may return into either.
    const both = ['O0002', 'N10 M98 P1', 'N20 M30', ...local];
    expect(targetsOf(cp, both).at(-1)?.[2]).toEqual({ refused: 'callers', key: 1 });
  });

  // P4d review NC-1: the local call proves the caller of a return inside the part it runs
  // (from the block Q names to the next return), and of no other return of the program.
  it('proves the caller only for a return inside the part the local call runs', () => {
    const cp = builtin('fanuc-gcode');
    // N40 M99 P30 is above the part N50…N60: nobody in the file calls O2000.
    const outside = ['O2000', 'N10 G0 X60.', 'N20 M98 Q50', 'N30 G1 X55.', 'N40 M99 P30', 'N50 G0 X1.', 'N60 M99'];
    expect(targetsOf(cp, outside).map(([line, address, answer]) => [line, address, answer])).toEqual([
      [3, 'Q', { segment: 0 }],
      [5, 'P', { refused: 'noCaller', key: 2000 }],
    ]);
    const result = renumber.run(outside, context(cp, outside, { start: 100, step: 10 }));
    expect(result.lines[4]).toBe('N130 M99 P30');
    expect(result.lines[2]).toBe('N110 M98 Q140');
    // Called from O0001 as well: the return outside the part returns into O0001 alone.
    const called = ['O0001', 'N10 M98 P2000', 'N20 G0 X0', 'N30 M30', ...outside];
    expect(targetsOf(cp, called).at(-1)?.[2]).toEqual({ segment: 0 });
    // A return that is the end of the part: the program's own block.
    const inside = ['O2000', 'N10 M98 Q50', 'N20 M30', 'N50 G0 X1.', 'N60 M99 P20'];
    expect(targetsOf(cp, inside).at(-1)?.[2]).toEqual({ segment: 0 });
  });

  it('counts a local call whose part cannot be found as a possible caller of every return of its program', () => {
    const cp = builtin('fanuc-gcode');
    const caller = ['O0001', 'N10 M98 P2000', 'N20 G0 X0', 'N30 M30'];
    // A variable for the block; no N90 in O2000; N50 twice; no return behind N50 inside the program.
    for (const sub of [
      ['O2000', 'N10 M98 Q#1', 'N20 M99 P30', 'N50 G0 X1.', 'N60 M99'],
      ['O2000', 'N10 M98 Q90', 'N20 M99 P30', 'N50 G0 X1.', 'N60 M99'],
      ['O2000', 'N10 M98 Q50', 'N20 M99 P30', 'N50 G0 X1.', 'N50 G0 X2.', 'N60 M99'],
      ['O2000', 'N10 M98 Q50', 'N20 M99 P30', 'N50 G0 X1.', 'O3000', 'N10 M99'],
    ]) {
      expect(targetsOf(cp, [...caller, ...sub]).find(([, address]) => address === 'P')?.[2], sub.join(' ')).toEqual({ refused: 'callers', key: 2000 });
      // Alone it proves nothing.
      expect(targetsOf(cp, sub).find(([, address]) => address === 'P')?.[2], sub.join(' ')).toEqual({ refused: 'noCaller', key: 2000 });
    }
  });

  it('places an own reference in its own program, as M6 did', () => {
    const cp = builtin('fanuc-gcode');
    const lines = ['O3100', 'N50 G00 X20.', 'GOTO 50', 'N60 M30', 'O2000', 'N50 G0 Z5.', 'N60 M99'];
    const scan = scanProgram(lines, context(cp, lines));
    const index = indexPrograms(scan, cp);
    expect(index.programs.map((p) => p.row)).toEqual([0, 4]);
    expect(targetProgramOf(scan, index, 2, scan.found[0].word)).toEqual({ segment: 0 });
  });
});

describe('Renumber Blocks with references across programs (§6.6 rule 10, the M6 rule)', () => {
  const PROGRAM = ['O3100', 'N50 G00 X20.', 'M98 P2000 Q50', 'N60 M30', 'O2000', 'N50 G0 Z5.', 'N60 M99', ''];

  it('keeps M98 P… Q… report-only on the shipped Fanuc profiles, even with the called program in the file (owner)', () => {
    for (const id of ['fanuc-gcode', 'fanuc-lathe']) {
      const result = renumber.run(PROGRAM, context(builtin(id), PROGRAM));
      expect(result.lines[2]).toBe('N20 M98 P2000 Q50');
      expect(result.skipped.some((row) => row.line === 3 && row.message === t('ncNumbering.renumber.referenceKeptRow'))).toBe(true);
      expect(result.warnings.map((w) => w.key)).toContain('ncNumbering.renumber.referencesKept');
    }
  });

  it('rewrites a called reference into the program of the file where a profile allows it', () => {
    const result = renumber.run(PROGRAM, context(compiledFrom(withCalledRewrite()), PROGRAM));
    expect(result.lines).toEqual(['O3100', 'N10 G00 X20.', 'N20 M98 P2000 Q10', 'N30 M30', 'O2000', 'N10 G0 Z5.', 'N20 M99', '']);
    expect(result.warnings.map((w) => w.key)).toEqual(['ncNumbering.renumber.referencesRewritten']);
  });

  it('rewrites M99 P into its single caller and reports it with two callers (fanuc-gcode and fanuc-lathe)', () => {
    const one = ['O2010', 'N10 G0 X0', 'N20 M98 P2011', 'N25 G0 X25.', 'N30 G0 X50.', 'N40 M30', 'O2011', 'N30 G0 Z5.', 'N40 M99 P30', ''];
    const two = [...one.slice(0, -1), 'O2012', 'N10 M98 P2011', 'N20 M30', ''];
    for (const id of ['fanuc-gcode', 'fanuc-lathe']) {
      const cp = builtin(id);
      const single = renumber.run(one, context(cp, one));
      // N30 of the caller is N40 now; the subprogram's own N30 is not where it returns to.
      expect(single.lines[8]).toBe('N20 M99 P40');
      expect(single.warnings.map((w) => w.key)).toEqual(['ncNumbering.renumber.referencesRewritten']);
      const several = renumber.run(two, context(cp, two));
      expect(several.lines[8]).toBe('N20 M99 P30');
      expect(several.skipped.some((row) => row.line === 9 && row.message === t('ncNumbering.renumber.referenceCallersRow'))).toBe(true);
      expect(several.warnings.map((w) => w.key)).toContain('ncNumbering.renumber.referencesUnresolved');
    }
  });

  it('counts a contour copy and an external call as callers (owner 2026-10-20)', () => {
    const sub = ['O2011', 'N30 G0 Z5.', 'N40 M99 P30', ''];
    for (const id of ['fanuc-gcode', 'fanuc-lathe']) {
      const cp = builtin(id);
      // M96 is an interrupt since the P4d review (NC-2): see the next test.
      for (const call of ['G72.1 P2011 L3 X0 Y0 R120.', 'G72.2 P2011 L2 I10. J0', 'M198 P2011']) {
        // One caller: the return is followed into it.
        const one = ['O2010', 'N10 G0 X0', `N20 ${call}`, 'N25 G0 X25.', 'N30 G0 X50.', 'N40 M30', ...sub];
        expect(renumber.run(one, context(cp, one)).lines[8], `${id} ${call}`).toBe('N20 M99 P40');
        // Called by M98 from one program and by this call from another: two callers.
        const two = ['O2010', 'N10 M98 P2011', 'N30 M30', 'O2012', `N10 ${call}`, 'N30 M30', ...sub];
        const result = renumber.run(two, context(cp, two));
        expect(result.lines[8], `${id} ${call}`).toBe('N20 M99 P30');
        expect(result.skipped.some((row) => row.line === 9 && row.message === t('ncNumbering.renumber.referenceCallersRow')), `${id} ${call}`).toBe(
          true,
        );
      }
    }
  });

  // P4d review NC-2: an interrupt returns into whichever program it interrupted, so M96 P2011
  // proves no caller of O2011, alone or beside a call — and M96 P#1 none of any program.
  it('never follows a return of a program an interrupt starts, and says why', () => {
    const sub = ['O2011', 'N30 G0 Z5.', 'N40 M99 P30', ''];
    for (const id of ['fanuc-gcode', 'fanuc-lathe']) {
      const cp = builtin(id);
      for (const head of [
        ['O2010', 'N10 G0 X0', 'N20 M96 P2011', 'N25 G0 X25.', 'N30 G0 X50.', 'N40 M30'],
        ['O2010', 'N10 M96 P2011', 'N20 M98 P2011', 'N25 G0 X25.', 'N30 G0 X50.', 'N40 M30'],
        ['O2010', 'N10 M96 P#100', 'N20 M98 P2011', 'N25 G0 X25.', 'N30 G0 X50.', 'N40 M30'],
      ]) {
        const lines = [...head, ...sub];
        const result = renumber.run(lines, context(cp, lines));
        expect(result.lines[8], `${id} ${head[2]}`).toBe('N20 M99 P30');
        expect(
          result.skipped.some((row) => row.line === 9 && row.message === t('ncNumbering.renumber.referenceInterruptRow')),
          `${id} ${head[2]}`,
        ).toBe(true);
        expect(renumber.preflight?.(lines, context(cp, lines))?.key, `${id} ${head[2]}`).toBe('ncNumbering.renumber.references');
      }
    }
    const cp = builtin('fanuc-gcode');
    expect(targetsOf(cp, ['O0001', 'N10 M96 P2000', 'N20 M30', 'O2000', 'N10 M99 P20']).map(([, , answer]) => answer)).toEqual([
      { refused: 'interrupt', key: 2000 },
    ]);
  });

  it('asks before the run about a return it cannot follow, and not about one it can', () => {
    const cp = builtin('fanuc-lathe');
    const resolved = ['O2010', 'N10 M98 P2011', 'N20 M30', 'O2011', 'N10 M99 P20'];
    expect(renumber.preflight?.(resolved, context(cp, resolved))).toBeNull();
    const alone = ['O2011', 'N10 G0 X0', 'N20 M99 P10'];
    expect(renumber.preflight?.(alone, context(cp, alone))?.key).toBe('ncNumbering.renumber.references');
  });
});

describe('the reference row of Test Profile on Document (§6.6 rules 8–10)', () => {
  it('says which program a value names, and that a return nobody in the file calls is not rewritten', () => {
    const cp = builtin('fanuc-lathe');
    const lines = ['O2010', 'N10 M98 P2011', 'N20 M30', 'O2011', 'N10 M99 P20', 'O2012', 'N10 M99 P20', 'GOTO 10'];
    const report = testReport({ cp, lines, codes: NO_CODES, machine: noMachine(cp.profile) });
    const rows = report.rows.filter((row) => row.kind === 'reference');
    expect(rows.map((row) => [row.line, row.program, row.rewrite, row.refused])).toEqual([
      [5, 'caller', true, undefined],
      [7, 'caller', false, 'noCaller'],
      [8, 'own', true, undefined],
    ]);
  });
});
