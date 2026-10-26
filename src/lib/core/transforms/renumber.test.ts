// Renumber blocks (plan §5 WP4.2 and WP6.3). Owner: WP6.3.
//
// The cases that matter are golden files, not strings in this test:
// `tests/fixtures/transforms/renumber/<case>/{input.nc,options.json,expected.nc}` is
// input, options and result, and a case is added by adding a folder. A transform that
// corrupts a program is the worst bug this project can ship, so every rule the module
// header claims — skip marks, packed code, comments, block names, Klartext continuation
// lines, references, the trailing newline — has a file next to it that proves it.
//
// `options.json` carries the run as well as the case: `profile` picks the built-in
// dialect, `options` is what the form would have collected, and `expect` pins the summary
// key, the reported lines and the warnings. What is not listed is not checked.
//
// Two ways to place the input inside a document, and the difference is the point of half
// the cases here:
//
//  - **`scope: { startLine, endLine }`** — `input.nc` and `expected.nc` are the *whole
//    program*, and the transform is handed the slice plus the document, exactly as
//    `app/transforms.ts` does it. This is what a real selection run looks like, so a
//    `GOTO` above the selection and a Klartext block that the selection starts inside
//    are both visible to it.
//  - **`firstLine`** — the transform is handed a bare fragment and no document, which is
//    a headless caller. It is a real case too, and what it must not do is pretend it
//    checked the rest of the program.
//
// The rest of the file covers what a fixture cannot: the option fields, the preflight,
// the identity `lineMap`, and the 100k-line budget.

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readTransformCases } from '../../../../tests/unit/helpers/transformCases';
import type { CaseMeta } from '../../../../tests/unit/helpers/transformCases';
import { noMachine } from '$lib/core/machines/effective';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { t } from '$lib/i18n';
import { renumber } from './renumber';
import type { CodeDb } from '$lib/core/codes/types';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import type { TransformContext } from './types';

const CASES_DIR = fileURLToPath(new URL('../../../../tests/fixtures/transforms/renumber/', import.meta.url));

const FANUC = 'fanuc-gcode';
const KLARTEXT = 'heidenhain-klartext';

/** The built-ins, through the same gate the registry uses. */
const BUILTINS: CompiledProfile[] = BUILTIN_PROFILE_JSON.map((raw) => {
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(`a built-in profile does not validate: ${checked.errors.join('; ')}`);
  return compileProfile(checked.profile);
});

function compiled(id: string): CompiledProfile {
  const found = BUILTINS.find((cp) => cp.profile.id === id);
  if (!found) throw new Error(`no profile ${id}`);
  return found;
}

/** Transforms read `codes` for what a code *means*; numbering never asks. */
const NO_CODES: CodeDb = { dialect: 'none', version: 1, addresses: {}, codes: [] };

function context(
  cp: CompiledProfile,
  options: Record<string, unknown> = {},
  firstLine = 1,
  document?: readonly string[],
): TransformContext {
  return { cp, codes: NO_CODES, options, firstLine, document, machine: noMachine(cp.profile) };
}

interface GoldenCase {
  name: string;
  meta: CaseMeta;
  /** The lines the transform is handed. */
  input: string[];
  /** The lines it has to return. */
  expected: string[];
  firstLine: number;
  /** The whole program, for a `scope` case; undefined for a bare fragment. */
  document?: string[];
  /** The whole program after the run, which is `expected` itself without a `scope`. */
  expectedDocument: string[];
}

/** Every case folder, sorted; the text is split the way `TransformService` splits it. */
function goldenCases(): GoldenCase[] {
  return readTransformCases(CASES_DIR).map((golden) => ({
    name: golden.name,
    meta: golden.meta,
    input: golden.input,
    expected: golden.expected,
    firstLine: golden.firstLine,
    document: golden.scoped ? golden.document : undefined,
    expectedDocument: golden.expectedDocument,
  }));
}

const CASES = goldenCases();

/** The context a case runs in, whichever of the two shapes it uses. */
function contextOf(golden: GoldenCase): TransformContext {
  return context(compiled(golden.meta.profile ?? FANUC), golden.meta.options ?? {}, golden.firstLine, golden.document);
}

describe('renumber goldens', () => {
  it('has the cases the work package promised', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(12);
    expect(CASES.every((c) => c.meta.note.trim() !== '')).toBe(true);
  });

  it.each(CASES.map((c) => [c.name, c] as const))('%s', (_name, golden) => {
    const ctx = contextOf(golden);
    const want = golden.meta.expect ?? {};

    expect(renumber.preflight?.(golden.input, ctx)?.key ?? null).toBe(want.preflight ?? null);

    const result = renumber.run(golden.input, ctx);
    expect(result.lines).toEqual(golden.expected);
    // The line array is the document's trailing state (types.ts, rule 5).
    expect(result.lines.length).toBe(golden.input.length);
    // A selection run rewrites the selection and nothing else, so everything outside it
    // has to be the same text in `input.nc` and `expected.nc`.
    if (golden.document) {
      const applied = [...golden.document];
      applied.splice(golden.firstLine - 1, result.lines.length, ...result.lines);
      expect(applied).toEqual(golden.expectedDocument);
    }

    if (want.summary !== undefined) expect(result.summary.key).toBe(want.summary);
    if (want.skipped !== undefined) {
      expect(result.skipped.map((s) => ({ line: s.line, severity: s.severity }))).toEqual(want.skipped);
      // `Located.message` is display text (plan §7.1); an untranslated key would show up here.
      expect(result.skipped.every((s) => s.message.trim() !== '' && !s.message.startsWith('ncNumbering.'))).toBe(true);
    }
    if (want.warnings !== undefined) expect(result.warnings.map((w) => w.key)).toEqual(want.warnings);
  });

  it('is idempotent: renumbering the result changes nothing', () => {
    for (const golden of CASES) {
      const ctx = contextOf(golden);
      const again = renumber.run(golden.expected, { ...ctx, document: golden.document ? golden.expectedDocument : undefined });
      expect(again.lines, golden.name).toEqual(golden.expected);
    }
  });

  it('maps every input line to itself: nothing is inserted or deleted', () => {
    for (const golden of CASES) {
      const result = renumber.run(golden.input, contextOf(golden));
      expect(result.lineMap, golden.name).toEqual(Int32Array.from(golden.input.map((_line, i) => i)));
    }
  });
});

describe('availability and options', () => {
  it('runs on every built-in dialect', () => {
    for (const cp of BUILTINS) expect(renumber.available(cp), cp.profile.id).toBe(true);
  });

  it('offers the profile numbering as the defaults', () => {
    const fields = renumber.options?.(compiled(FANUC)) ?? [];
    const byId = new Map(fields.map((field) => [field.id, field]));
    expect([...byId.keys()]).toEqual([
      'start',
      'step',
      'digits',
      'max',
      'fitToMax',
      'onOverflow',
      'spacesAfter',
      'alignColumn',
      'everyNth',
      'skipStartingWith',
      'skipContaining',
      'skipFirst',
      'skipLast',
      'startTrigger',
      'startAfterTrigger',
      'skipEmpty',
      'restartAtProgramStart',
      'onlyNumbered',
      'altPrefixes',
    ]);
    expect(byId.get('start')?.default).toBe(10);
    expect(byId.get('step')?.default).toBe(10);
    expect(byId.get('max')?.default).toBe(99999);
    expect(byId.get('onOverflow')?.default).toBe('wrap');
    expect(byId.get('skipStartingWith')?.default).toBe('% O (');
    expect(byId.get('skipEmpty')?.default).toBe(true);
    expect(byId.get('restartAtProgramStart')?.default).toBe(true);
    expect(byId.get('onlyNumbered')?.default).toBe(false);
    // P4d (§6.6 rules 1–6): a profile without the advanced options gets them off.
    expect(byId.get('fitToMax')?.default).toBe(false);
    expect(byId.get('alignColumn')).toMatchObject({ default: 0, min: 0, max: 120 });
    expect(byId.get('everyNth')).toMatchObject({ default: 1, min: 1, max: 1000 });
    expect(byId.get('skipContaining')?.default).toBe('');
    expect(byId.get('skipFirst')).toMatchObject({ default: 0, min: 0, max: 1_000_000 });
    expect(byId.get('skipLast')).toMatchObject({ default: 0, min: 0, max: 1_000_000 });
    expect(byId.get('startTrigger')).toMatchObject({ default: '', maxLength: 200 });
    expect(byId.get('startAfterTrigger')?.default).toBe(false);
    expect(fields.every((field) => field.label.trim() !== '' && !field.label.includes('ncNumbering.'))).toBe(true);
  });

  // Digits allowed 9 on Okuma, and N00010 is a number the control rejects.
  it('bounds the form by the limit of a dialect that stops at its maximum', () => {
    const byId = new Map((renumber.options?.(compiled('okuma-osp')) ?? []).map((field) => [field.id, field]));
    expect(byId.get('digits')).toMatchObject({ default: 0, min: 0, max: 4 });
    expect(byId.get('max')).toMatchObject({ default: 9999, max: 9999, required: true });
    expect(byId.get('start')).toMatchObject({ max: 9999 });
    expect(byId.get('onOverflow')?.default).toBe('stop');
  });

  it('leaves the maximum open where it is only the point the counter starts over', () => {
    const byId = new Map((renumber.options?.(compiled(FANUC)) ?? []).map((field) => [field.id, field]));
    expect(byId.get('digits')?.max).toBe(9);
    expect(byId.get('max')?.required).toBe(false);
    expect(byId.get('max')?.max).toBe(999999999);
  });

  // Sinumerik's N is a whole number (INT): no five-digit limit, but a limit all the same,
  // and a 5-axis post numbers past N3,700,000, so wrapping would write duplicates.
  it('bounds Sinumerik by the INT limit of its block number and stops there', () => {
    const byId = new Map((renumber.options?.(compiled('sinumerik')) ?? []).map((field) => [field.id, field]));
    expect(byId.get('digits')).toMatchObject({ default: 0, max: 10 });
    expect(byId.get('max')).toMatchObject({ default: 2147483647, max: 2147483647, required: true });
    expect(byId.get('onOverflow')?.default).toBe('stop');
  });

  it('holds a caller that skipped the form to the same limit, and says so', () => {
    const okuma = compiled('okuma-osp');
    const result = renumber.run(['N1 G0 X0', 'N2 G0 X1'], context(okuma, { digits: 7, max: 50000, start: 9990 }));
    expect(result.lines).toEqual(['N9990 G0 X0', 'N2 G0 X1']);
    expect(result.warnings).toEqual([
      expect.objectContaining({ key: 'ncNumbering.renumber.overflowStopped' }),
      { key: 'ncNumbering.renumber.limitedMax', params: { max: 9999 } },
      { key: 'ncNumbering.renumber.limitedDigits', params: { digits: 4 } },
    ]);
    // Review: only the answer that was over is named. A run that asked for
    // too high a maximum and left the digits alone was told "at most 0 digits".
    const maxOnly = renumber.run(['N1 G0 X0'], context(okuma, { max: 50000 }));
    expect(maxOnly.warnings).toEqual([{ key: 'ncNumbering.renumber.limitedMax', params: { max: 9999 } }]);
    const digitsOnly = renumber.run(['N1 G0 X0'], context(okuma, { digits: 6, max: 9999 }));
    expect(digitsOnly.lines).toEqual(['N0010 G0 X0']);
    expect(digitsOnly.warnings).toEqual([{ key: 'ncNumbering.renumber.limitedDigits', params: { digits: 4 } }]);
    const within = renumber.run(['N1 G0 X0'], context(okuma, { digits: 4 }));
    expect(within.lines).toEqual(['N0010 G0 X0']);
    expect(within.warnings).toEqual([]);
  });

  it('has no form at all on a dialect that numbers consecutively', () => {
    expect(renumber.options?.(compiled(KLARTEXT))).toEqual([]);
  });

  it('keeps a word-separated dialect from losing the space behind the number', () => {
    const cp = compiled(KLARTEXT);
    const result = renumber.run(['0 BEGIN PGM T MM', '5 L Z+100 R0 FMAX', '9 END PGM T MM'], context(cp, { spacesAfter: 0 }));
    expect(result.lines).toEqual(['0 BEGIN PGM T MM', '1 L Z+100 R0 FMAX', '2 END PGM T MM']);
  });
});

describe('preflight', () => {
  const fanuc = compiled(FANUC);

  it('says nothing when no line points at a block number', () => {
    expect(renumber.preflight?.(['N10 G0 X0', 'N20 M98 P2000', 'N30 M99'], context(fanuc))).toBeNull();
  });

  it('counts the lines that do and names the first', () => {
    const msg = renumber.preflight?.(['N10 G0 X0', 'GOTO 100', 'N30 M99 P20'], context(fanuc));
    expect(msg?.key).toBe('ncNumbering.renumber.references');
    expect(msg?.params).toEqual({ count: 2, first: 2 });
  });

  it('reports document lines when the run is a selection', () => {
    expect(renumber.preflight?.(['GOTO 100'], context(fanuc, {}, 30))?.params).toEqual({ count: 1, first: 30 });
  });

  it('does not see a reference inside a comment', () => {
    expect(renumber.preflight?.(['N10 G0 X0 (GOTO 100 LATER)'], context(fanuc))).toBeNull();
  });

  it('asks before numbering only part of a consecutively numbered program', () => {
    const cp = compiled(KLARTEXT);
    expect(renumber.preflight?.(['5 L X+0 R0 FMAX'], context(cp, {}, 1))).toBeNull();
    expect(renumber.preflight?.(['5 L X+0 R0 FMAX'], context(cp, {}, 5))?.key).toBe('ncNumbering.renumber.consecutiveSelection');
  });
});

describe('option values that never reach a valid form', () => {
  const fanuc = compiled(FANUC);

  it('falls back to the profile for a field left empty', () => {
    const result = renumber.run(['G0 X0', 'G0 X1.'], context(fanuc, { start: '', step: undefined, skipStartingWith: '', restartAtProgramStart: false }));
    expect(result.lines).toEqual(['N10 G0 X0', 'N20 G0 X1.']);
  });

  it('reads an empty maximum as no maximum', () => {
    const result = renumber.run(['G0 X0'], context(fanuc, { start: 999999, max: '', skipStartingWith: '', restartAtProgramStart: false }));
    expect(result.lines).toEqual(['N999999 G0 X0']);
  });

  it('says so when the shipped defaults wrap a big program into duplicate numbers', () => {
    // G8 M4, with the reviewer's own program: 12,000 blocks renumbered with the
    // `fanuc-gcode` defaults (start 10, step 10, max 99999, onOverflow 'wrap'). The
    // numbers pass the maximum at line 10,000 and 2,001 block numbers end up used twice,
    // which breaks block search and restart on the control and makes GOTO, M99 P and
    // G71 P-Q ambiguous. Only the `stop` branch used to warn.
    const lines = Array.from({ length: 12_000 }, (_v, i) => `N${i + 1} G1 X${i}.`);
    const result = renumber.run(lines, context(compiled(FANUC), { skipStartingWith: '', restartAtProgramStart: false }));

    expect(result.lines[0]).toBe('N10 G1 X0.');
    expect(result.lines[9998]).toBe('N99990 G1 X9998.');
    expect(result.lines[9999]).toBe('N10 G1 X9999.');
    expect(result.lines[11_999]).toBe('N20010 G1 X11999.');

    const numbers = result.lines.map((line) => line.slice(0, line.indexOf(' ')));
    expect(numbers.length - new Set(numbers).size).toBe(2001);

    const wrapped = result.warnings.find((w) => w.key === 'ncNumbering.renumber.wrapped');
    expect(wrapped?.params).toEqual({ count: 1, line: 10_000, start: 10, max: 99999 });
    // And the first wrapped line is in the table, where it can be clicked.
    expect(result.skipped.some((s) => s.line === 10_000 && s.severity === 'warning')).toBe(true);
  });

  it('stops instead of looping when the start value is itself above the maximum', () => {
    const result = renumber.run(['G0 X0', 'G0 X1.'], context(fanuc, { start: 100, max: 50, onOverflow: 'wrap', skipStartingWith: '', restartAtProgramStart: false }));
    expect(result.lines).toEqual(['G0 X0', 'G0 X1.']);
    expect(result.warnings.map((w) => w.key)).toEqual(['ncNumbering.renumber.overflowStopped']);
  });
});

describe('the results table', () => {
  const fanuc = compiled(FANUC);

  it('stops at 200 rows and says how many there were', () => {
    const lines = Array.from({ length: 5000 }, (_v, i) => `(COMMENT ${i})`);
    const result = renumber.run(lines, context(fanuc, { skipStartingWith: '(', restartAtProgramStart: false }));
    expect(result.skipped).toHaveLength(200);
    expect(result.summary).toEqual({ key: 'ncNumbering.renumber.summarySkipped', params: { count: 0, skipped: 5000 } });
    expect(result.warnings).toEqual([{ key: 'ncNumbering.renumber.skippedTruncated', params: { shown: 200, total: 5000 } }]);
  });

  it('says nothing happened when nothing could', () => {
    expect(renumber.run(['', '', ''], context(fanuc)).summary).toEqual({ key: 'ncNumbering.renumber.nothing' });
  });
});

describe('references', () => {
  const fanuc = compiled(FANUC);

  /** The shipped Fanuc profile with the reference rules replaced. */
  function withReferences(references: NonNullable<Profile['numbering']['references']>): CompiledProfile {
    return compileProfile({ ...fanuc.profile, numbering: { ...fanuc.profile.numbering, references } });
  }

  const M99 = '(?<![A-Z])M99(?!\\d)';
  const FREE = { start: 10, step: 10, skipStartingWith: '', restartAtProgramStart: false };

  it('rewrites a value whose block it can name, and only that value', () => {
    const cp = withReferences([{ trigger: '(?<![A-Z])GOTO', addresses: ['GOTO'] }]);
    const result = renumber.run(['N5 GOTO 7', 'N6 G0 X7. P7', 'N7 M30'], context(cp, FREE));
    // The `X7.` and the `P7` are not references and must not move with the jump.
    expect(result.lines).toEqual(['N10 GOTO 30', 'N20 G0 X7. P7', 'N30 M30']);
    expect(result.warnings).toEqual([{ key: 'ncNumbering.renumber.referencesRewritten', params: { count: 1 } }]);
  });

  it('leaves a value alone where the rule says report only (F42)', () => {
    // The shipped Fanuc profiles carry `rewrite: false` on a `M98` block that also names a
    // program (I6; the owner 2026-10-19: `M98 P… Q…` stays report-only), and the goldens
    // `m98-subprogram-start` and `m98-p-before-call` pin it. `M99 P` is no longer one of
    // them since P4d: it is resolved in the calling program (`program: caller`, golden
    // `m99-p-caller`). What this proves is the machinery underneath: with the flag set, the
    // value is reported and never touched, although the number exists in this very program
    // — which is the case that makes a silent rewrite dangerous.
    const report = withReferences([{ trigger: M99, addresses: ['P'], rewrite: false }]);
    const rewrite = withReferences([{ trigger: M99, addresses: ['P'] }]);
    const lines = ['N5 G0 X0', 'N6 M99 P5'];

    const kept = renumber.run(lines, context(report, FREE));
    expect(kept.lines).toEqual(['N10 G0 X0', 'N20 M99 P5']);
    expect(kept.warnings).toEqual([{ key: 'ncNumbering.renumber.referencesKept', params: { count: 1 } }]);
    expect(kept.skipped.map((s) => [s.line, s.severity])).toEqual([[2, 'warning']]);

    expect(renumber.run(lines, context(rewrite, FREE)).lines).toEqual(['N10 G0 X0', 'N20 M99 P10']);
  });

  it('says nothing about a reference whose block keeps its number', () => {
    const cp = withReferences([{ trigger: '(?<![A-Z])GOTO', addresses: ['GOTO'] }]);
    const result = renumber.run(['N10 GOTO 20', 'N20 M30'], context(cp, FREE));
    expect(result.lines).toEqual(['N10 GOTO 20', 'N20 M30']);
    expect(result.warnings).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('rewrites several values on one line from the back, so the offsets hold', () => {
    const cp = withReferences([{ trigger: '(?<![A-Z])G71(?!\\d)', addresses: ['P', 'Q'] }]);
    const result = renumber.run(['N5 G71 P6 Q7 U0.4', 'N6 G0 X1.', 'N7 X2.'], context(cp, FREE));
    expect(result.lines[0]).toBe('N10 G71 P20 Q30 U0.4');
  });

  it('lists a reference row next to the skipped line above it, not behind every one', () => {
    const cp = withReferences([{ trigger: '(?<![A-Z])GOTO', addresses: ['GOTO'] }]);
    const result = renumber.run(['(HEADER)', 'N5 GOTO 999', '(MIDDLE)', 'N6 M30'], context(cp, { ...FREE, skipStartingWith: '(' }));
    expect(result.skipped.map((s) => [s.line, s.severity])).toEqual([
      [1, 'info'],
      [2, 'warning'],
      [3, 'info'],
    ]);
  });

  it('counts the references it rewrote, kept and could not follow, each on its own', () => {
    const cp = withReferences([
      { trigger: '(?<![A-Z])GOTO', addresses: ['GOTO'] },
      { trigger: M99, addresses: ['P'], rewrite: false },
    ]);
    const result = renumber.run(['N5 GOTO 7', 'N6 GOTO 999', 'N7 M99 P7'], context(cp, FREE));
    expect(result.warnings).toEqual([
      { key: 'ncNumbering.renumber.referencesRewritten', params: { count: 1 } },
      { key: 'ncNumbering.renumber.referencesKept', params: { count: 1 } },
      { key: 'ncNumbering.renumber.referencesUnresolved', params: { count: 1 } },
    ]);
  });

  it('asks only about the references it cannot follow', () => {
    const cp = withReferences([{ trigger: '(?<![A-Z])GOTO', addresses: ['GOTO'] }]);
    // Every jump lands: nothing to confirm.
    expect(renumber.preflight?.(['N5 GOTO 7', 'N6 G0 X0', 'N7 M30'], context(cp, FREE))).toBeNull();
    // One does not: the dialog names it.
    const msg = renumber.preflight?.(['N5 GOTO 999', 'N6 G0 X0', 'N7 M30'], context(cp, FREE));
    expect(msg?.key).toBe('ncNumbering.renumber.references');
    expect(msg?.params).toEqual({ count: 1, first: 1 });
  });

  it('never writes a computed jump, and never keeps quiet about one', () => {
    const cp = withReferences([{ trigger: '(?<![A-Z])GOTO', addresses: ['GOTO'] }]);
    const result = renumber.run(['N5 GOTO #100', 'N6 M30'], context(cp, FREE));
    expect(result.lines).toEqual(['N10 GOTO #100', 'N20 M30']);
    expect(result.warnings).toEqual([{ key: 'ncNumbering.renumber.referencesUnresolved', params: { count: 1 } }]);
  });

  describe('a value left as written whose block got another number (M13 review NC-8)', () => {
    // The shipped profile: `M99 P` names a block of the caller (`program: caller`). No
    // program of these files calls `O2`, so the value is refused (noCaller) and left as
    // written, and the one block of the file that carries the number is where it lands.
    const RUN = { start: 10, step: 10, skipStartingWith: '% O (', restartAtProgramStart: true, onlyNumbered: true };
    const SUB = ['%', 'O2', 'G0 X5.', 'M99 P30'];

    it('names the other block the return now lands on', () => {
      const main = ['O1', 'N5 G0 X0', 'N10 T0101', 'N15 M08', 'N20 G1 X1.', 'N25 Z-1.', 'N30 X1.', 'N35 G0 X50.', 'N40 M30', '%'];
      const lines = [...SUB, ...main];
      const result = renumber.run(lines, context(fanuc, RUN, 1, lines));
      // The run itself: `N30` (line 11) is `N60` now, the `M08` (line 8) is `N30`.
      expect(result.lines[10]).toBe('N60 X1.');
      expect(result.lines[7]).toBe('N30 M08');
      expect(result.lines[3]).toBe('M99 P30');
      const rows = result.skipped.filter((row) => row.line === 4).map((row) => row.message);
      expect(rows).toContain(
        'M99 P30 named N30 on line 11; after this renumber N30 is line 8 (N30 M08), so the jump lands there.',
      );
      // The generic preflight stays.
      expect(renumber.preflight?.(lines, context(fanuc, RUN, 1, lines))?.key).toBe('ncNumbering.renumber.references');
    });

    it('says when no block with that number is left', () => {
      const lines = [...SUB, 'O1', 'N30 X1.', 'N40 M30', '%'];
      const result = renumber.run(lines, context(fanuc, RUN, 1, lines));
      expect(result.lines.slice(5, 7)).toEqual(['N10 X1.', 'N20 M30']);
      const rows = result.skipped.filter((row) => row.line === 4).map((row) => row.message);
      expect(rows).toContain(
        'M99 P30 named N30 on line 6; after this renumber no block N30 is left, so the control will stop with an alarm.',
      );
    });

    it('says nothing more when the named block keeps its number', () => {
      const lines = [...SUB, 'O1', 'N10 G0 X0', 'N20 G1 X1.', 'N30 X1.', 'N40 M30', '%'];
      const result = renumber.run(lines, context(fanuc, RUN, 1, lines));
      // Only the row every kept reference gets.
      expect(result.skipped.filter((row) => row.line === 4 && row.severity === 'warning')).toHaveLength(1);
    });

    // P4d integration (§6.6 rule 10): `M98 P… Q…` stays report-only, but where the program
    // it calls is in the file, its `Q` is looked for in that program and nowhere else.
    it('looks for a report-only value in the program its line calls', () => {
      // O2000 and O3000 both carry an N50: M6's answer ("the one block of the file with that
      // number") had none, so the run said nothing although O2000's N50 is gone.
      const lines = ['O1000', 'N10 M98 P2000 Q50', 'N20 M30', 'O2000', 'N50 G0 X0', 'N60 M99', 'O3000', 'N50 G0 X1.', 'N60 M99'];
      const result = renumber.run(lines, context(fanuc, RUN, 1, lines));
      expect(result.lines).toEqual(['O1000', 'N10 M98 P2000 Q50', 'N20 M30', 'O2000', 'N10 G0 X0', 'N20 M99', 'O3000', 'N10 G0 X1.', 'N20 M99']);
      const rows = result.skipped.filter((row) => row.line === 2).map((row) => row.message);
      expect(rows).toContain(
        'N10 M98 P2000 Q50 named N50 on line 5; after this renumber no block N50 is left, so the control will stop with an alarm.',
      );
    });

    it('says nothing about a block of another program when the called one is not in the file', () => {
      // O4000 is not here, so O2000's N50 is not what `Q50` names (M6 took it for the answer).
      const lines = ['O1000', 'N10 M98 P4000 Q50', 'N20 M30', 'O2000', 'N50 G0 X0', 'N60 M99'];
      const result = renumber.run(lines, context(fanuc, RUN, 1, lines));
      expect(result.lines[4]).toBe('N10 G0 X0');
      expect(result.skipped.filter((row) => row.line === 2).map((row) => row.message)).toEqual([
        'This line points at a block of another program (M98 P… Q… starts the called program at block Q). This dialect never rewrites such a value, so it was left as it is; check it.',
      ]);
    });
  });

  it('says why a return of a program that is in the file twice is left as it is', () => {
    // The row fits a call (`M98 P2011 Q…`) and a return (`M99 P…`) alike: the name is the trouble.
    const lines = ['O2010', 'N10 G0 X100. Z100.', 'N15 M98 P2011', 'N20 M30', 'O2011', 'N10 G0 X60.', 'N20 M99 P20', 'O2011', 'N10 G0 X70.', 'N20 M99 P20'];
    const result = renumber.run(lines, context(fanuc, { start: 10, step: 10, skipStartingWith: 'O', restartAtProgramStart: true }, 1, lines));
    const text = 'Two programs in this file have the same name, so which program this line points into cannot be told; it was left as it is.';
    expect(result.skipped.filter((row) => row.severity === 'warning').map((row) => [row.line, row.message])).toEqual([
      [7, text],
      [10, text],
    ]);
  });

  it('follows the block numbers of the program the jump stands in', () => {
    const cp = withReferences([{ trigger: '(?<![A-Z])GOTO', addresses: ['GOTO'] }]);
    const lines = ['O1000', 'N5 GOTO 9', 'N9 G0 X0', 'M30', 'O1001', 'N5 GOTO 9', 'N9 G0 Z5.', 'M30'];
    const result = renumber.run(lines, context(cp, { start: 10, step: 10, skipStartingWith: '% O (', restartAtProgramStart: true }));
    expect(result.lines[1]).toBe('N10 GOTO 20');
    expect(result.lines[5]).toBe('N10 GOTO 20');
  });
});

describe('sequence numbers that are names (G10 M8)', () => {
  // The goldens `okuma-*` pin the reviewer's programs. What they cannot show side by side
  // is the one program read by both rules: Fanuc finds `N0100` for `GOTO 100`, Okuma does
  // not find `N0100` for `GOTO N100`, because on that control they are two names.
  const okuma = compiled('okuma-osp');
  const FREE = { start: 10, step: 10, skipStartingWith: '% O (', restartAtProgramStart: true };

  it('does not follow a jump to a name written with other zeros', () => {
    const result = renumber.run(['O1001', 'N0100 G00 X0', 'N5 GOTO N100', 'N6 M02'], context(okuma, FREE));
    expect(result.lines).toEqual(['O1001', 'N10 G00 X0', 'N20 GOTO N100', 'N30 M02']);
    expect(result.warnings.map((w) => w.key)).toEqual(['ncNumbering.renumber.referencesUnresolved']);
    expect(result.skipped.map((s) => [s.line, s.severity])).toEqual([
      [1, 'info'],
      [3, 'warning'],
    ]);
    // …and asks before it runs, because the jump already names nothing.
    expect(renumber.preflight?.(['O1001', 'N0100 G00 X0', 'N5 GOTO N100', 'N6 M02'], context(okuma, FREE))?.key).toBe(
      'ncNumbering.renumber.references',
    );
  });

  // B1: the `$` lines of an Okuma block were kept only by the editable skip list. With `$`
  // taken out of it, `N30 $ H1.8 …` took the mark off the head of the line and cut the line
  // off its block; `syntax.continuationStart` now keeps it whatever the list says.
  it('never numbers a line that continues the block above, with or without $ in the skip list', () => {
    const lines = ['O1001', 'N5 G00 X100 Z50', 'N6 G01 X50 Z0 F0.2', '$ H1.8 Z-20', 'N7 M02'];
    for (const skipStartingWith of ['% O (', '$ % O (']) {
      const result = renumber.run(lines, context(okuma, { ...FREE, skipStartingWith }));
      expect(result.lines, skipStartingWith).toEqual(['O1001', 'N10 G00 X100 Z50', 'N20 G01 X50 Z0 F0.2', '$ H1.8 Z-20', 'N30 M02']);
      expect(result.skipped.map((s) => [s.line, s.severity]), skipStartingWith).toEqual([
        [1, 'info'],
        [4, 'info'],
      ]);
    }
    const free = renumber.run(lines, context(okuma, { ...FREE, skipStartingWith: '% O (' }));
    expect(free.skipped[1].message).toBe('Skipped: this line continues the block above it.');
  });

  it('moves a jump whose block keeps its number but not its text', () => {
    // N0010 becomes N10: the same number, another name. Left alone, GOTO N0010 would
    // point at nothing, and the run used to say nothing about it.
    const result = renumber.run(['O1001', 'N0010 G00 X0', 'N0020 GOTO N0010', 'N0030 M02'], context(okuma, FREE));
    expect(result.lines).toEqual(['O1001', 'N10 G00 X0', 'N20 GOTO N10', 'N30 M02']);
    expect(result.warnings).toEqual([{ key: 'ncNumbering.renumber.referencesRewritten', params: { count: 1 } }]);
  });

  it('reports a jump whose new name the run hands out twice', () => {
    // A block outside the selection keeps the name N10, and the selection writes N10 as
    // well: the jump that followed its block would name two of them.
    const document = ['O1001', 'N10 G00 X0', 'N0050 G01 X1', 'N0060 GOTO N0050', 'N0070 M02'];
    const result = renumber.run(document.slice(2), context(okuma, FREE, 3, document));
    expect(result.lines).toEqual(['N10 G01 X1', 'N20 GOTO N0050', 'N30 M02']);
    // P4d review NC-4: and says that N10 is on two blocks now.
    expect(result.warnings.map((w) => w.key)).toEqual(['ncNumbering.renumber.duplicatesMade', 'ncNumbering.renumber.referencesUnresolved']);
  });
});

describe('Sinumerik jump targets (M11 review NC-3)', () => {
  const cp = compiled('sinumerik');
  const FREE = { start: 10, step: 10, skipStartingWith: '', restartAtProgramStart: false };

  it('follows a jump to a block number written without N', () => {
    for (const jump of ['GOTOF', 'GOTOB', 'GOTOC', 'GOTO']) {
      const result = renumber.run([`N5 ${jump} 7`, 'N6 G0 X0', 'N7 M30'], context(cp, FREE));
      expect(result.lines, jump).toEqual([`N10 ${jump} 30`, 'N20 G0 X0', 'N30 M30']);
      expect(result.warnings, jump).toEqual([{ key: 'ncNumbering.renumber.referencesRewritten', params: { count: 1 } }]);
    }
  });

  it('still follows a jump to a main block and to an N block', () => {
    expect(renumber.run(['N5 GOTOF :7', 'N6 G0 X0', ':7 M30'], context(cp, FREE)).lines).toEqual(['N10 GOTOF :30', 'N20 G0 X0', ':30 M30']);
    expect(renumber.run(['N5 GOTOF N7', 'N6 G0 X0', 'N7 M30'], context(cp, FREE)).lines).toEqual(['N10 GOTOF N30', 'N20 G0 X0', 'N30 M30']);
  });

  it('reports a jump through a string or a name that is no label of the program', () => {
    for (const jump of ['GOTOF DEST', 'GOTOF "N"<<R10']) {
      const lines = [`N5 ${jump}`, 'N6 G0 X0', 'N7 M30'];
      const result = renumber.run(lines, context(cp, FREE));
      expect(result.lines[0], jump).toBe(`N10 ${jump}`);
      expect(result.warnings, jump).toEqual([{ key: 'ncNumbering.renumber.referencesUnresolved', params: { count: 1 } }]);
      expect(renumber.preflight?.(lines, context(cp, FREE))?.key, jump).toBe('ncNumbering.renumber.references');
    }
  });

  it('says nothing about a jump to a label of the program', () => {
    const lines = ['N5 LOOP_A: G0 X0', 'N6 GOTOB LOOP_A', 'N7 M30'];
    const result = renumber.run(lines, context(cp, FREE));
    expect(result.lines).toEqual(['N10 LOOP_A: G0 X0', 'N20 GOTOB LOOP_A', 'N30 M30']);
    expect(result.warnings).toEqual([]);
    expect(renumber.preflight?.(lines, context(cp, FREE))).toBeNull();
  });
});

// P4d review NC-3: a reference outside the run's lines whose program cannot be told used to
// be dropped in silence, also where a program it may name has the block among those lines.
describe('a reference outside the lines that may point into them (P4d review NC-3)', () => {
  const fanuc = compiled(FANUC);
  const RUN = { start: 100, step: 10, skipStartingWith: '', restartAtProgramStart: true };

  /** The run over `[from, to]` (1-based, inclusive) of `document`, its rows and its preflight. */
  function runOver(document: string[], from: number, to: number) {
    const ctx = context(fanuc, RUN, from, document);
    const lines = document.slice(from - 1, to);
    return { result: renumber.run(lines, ctx), preflight: renumber.preflight?.(lines, ctx) ?? null };
  }

  it('reports a call through a variable whose Q may name a block of the selected program', () => {
    const document = ['O0001', 'N10 M98 P#1 Q20', 'N20 M30', 'O1000', 'N10 G0 X1.', 'N20 G0 X2.', 'N30 M99'];
    const { result, preflight } = runOver(document, 4, 7);
    expect(result.lines).toEqual(['O1000', 'N100 G0 X1.', 'N110 G0 X2.', 'N120 M99']);
    expect(result.skipped.filter((row) => row.line === 2).map((row) => row.message)).toEqual([t('ncNumbering.renumber.referenceNoCallRow')]);
    expect(preflight).toEqual({ key: 'ncNumbering.renumber.references', params: { count: 1, first: 2 } });
  });

  it('reports a return nobody calls whose own program has the block among the lines (a main program jumps inside it)', () => {
    const document = ['O1000', 'N10 G0 X1.', 'N20 G0 X2.', 'N30 G0 X3.', 'N40 M99 P20'];
    const { result, preflight } = runOver(document, 1, 4);
    expect(result.skipped.filter((row) => row.line === 5).map((row) => row.message)).toEqual([t('ncNumbering.renumber.referenceNoCallerRow')]);
    expect(preflight?.key).toBe('ncNumbering.renumber.references');
  });

  it('says nothing where no program the reference may name has the block among the lines', () => {
    // O3000 does not call O1000 and has no unknown call: its N20 is not where M99 P20 returns to.
    const document = ['O0001', 'N10 M98 P1000', 'N20 M30', 'O0002', 'N10 M98 P1000', 'N20 M30', 'O1000', 'N10 M99 P20', 'O3000', 'N10 G0 X0', 'N20 M30'];
    const { result, preflight } = runOver(document, 9, 11);
    expect(result.skipped.filter((row) => row.line === 8)).toEqual([]);
    expect(preflight).toBeNull();
  });

  it('reports a return of a program an interrupt starts where any program has the block among the lines', () => {
    const document = ['O0001', 'N10 M96 P1000', 'N20 M30', 'O1000', 'N10 M99 P20', 'O3000', 'N10 G0 X0', 'N20 M30'];
    const { result, preflight } = runOver(document, 6, 8);
    expect(result.skipped.filter((row) => row.line === 5).map((row) => row.message)).toEqual([t('ncNumbering.renumber.referenceInterruptRow')]);
    expect(preflight?.key).toBe('ncNumbering.renumber.references');
  });
});

// P4d review NC-9: the row of a value the dialect never rewrites says which of the two it is.
describe('the row of a value that is never rewritten (P4d review NC-9)', () => {
  it('says "another program" for M98 P… Q… and "a milling profile" for a G70–G73 cycle on the mill', () => {
    const fanuc = compiled(FANUC);
    const lines = ['O1000', 'N10 M98 P2000 Q50', 'N20 G71 P30 Q40 U0.2 W0.1', 'N30 G0 X1.', 'N40 G1 X2.', 'N50 M30'];
    const result = renumber.run(lines, context(fanuc, {}, 1, lines));
    expect(result.skipped.filter((row) => row.line === 2).map((row) => row.message)).toEqual([t('ncNumbering.renumber.referenceKeptRow')]);
    expect(result.skipped.filter((row) => row.line === 3).map((row) => row.message)[0]).toBe(t('ncNumbering.renumber.referenceKeptOwnRow'));
    expect(t('ncNumbering.renumber.referenceKeptRow')).toContain('M98 P… Q…');
    expect(t('ncNumbering.renumber.referenceKeptRow')).not.toContain('milling');
    expect(t('ncNumbering.renumber.referenceKeptOwnRow')).toContain('G70–G73');
  });
});
