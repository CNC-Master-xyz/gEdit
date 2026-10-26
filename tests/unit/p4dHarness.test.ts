// The P4d runtime scenarios (`p4-renumber`, `p4-renumber-others`, part B of `m6-lathe-renumber`) checked without the app: the suite, the
// registered scenarios, and every table of `tests/runtime/scenarios/p4-renumber-common.js` held to what the real transform does. A scenario
// that expects a count, a step, a row or a document text the code does not produce would fail on the first runner; here it fails first.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenarios } from '../runtime/lib/index.js';
import { FANUC, LATHE, OPTION_CASES, REFERENCE_CASES, formFieldsOf, world } from '../runtime/scenarios/p4-renumber-common.js';
import { initialValues } from '$lib/core/forms/values';
import { noMachine } from '$lib/core/machines/effective';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { t } from '$lib/i18n';
import { applyOtherReferences, findOtherReferences, renumberedSourceOf } from '$lib/core/transforms/otherReferences';
import { renumber } from '$lib/core/transforms/renumber';
import type { CodeDb } from '$lib/core/codes/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { TransformContext } from '$lib/core/transforms/types';

const root = fileURLToPath(new URL('../../', import.meta.url));
const goldens = join(root, 'tests', 'fixtures', 'transforms', 'renumber');
const NO_CODES: CodeDb = { dialect: 'none', version: 1, addresses: {}, codes: [] };

function builtin(id: string): CompiledProfile {
  const checked = validateProfile(BUILTIN_PROFILE_JSON.find((p) => (p as { id?: string }).id === id));
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  return compileProfile(checked.profile);
}

/** The text of a golden file as the editor holds it: lines, the final line break being an empty last line. */
const linesOf = (text: string): string[] => text.split('\n');

function contextOf(cp: CompiledProfile, lines: readonly string[], options: Record<string, unknown>): TransformContext {
  return { cp, codes: NO_CODES, options, firstLine: 1, document: lines, machine: noMachine(cp.profile) };
}

interface Golden {
  profile: string;
  options: Record<string, unknown>;
  input: string[];
  expected: string[];
  expect: { summary: string; skipped: { line: number; severity: string }[]; warnings: string[]; preflight: string | null };
}

function golden(id: string): Golden {
  const dir = join(goldens, id);
  const sidecar = JSON.parse(readFileSync(join(dir, 'options.json'), 'utf8'));
  return {
    profile: sidecar.profile,
    options: sidecar.options ?? {},
    input: linesOf(readFileSync(join(dir, 'input.nc'), 'utf8')),
    expected: linesOf(readFileSync(join(dir, 'expected.nc'), 'utf8')),
    expect: sidecar.expect,
  };
}

/** What the form would hand the transform for the fields the scenario types: the profile's defaults, then the typed values (an empty number field is no value). */
function formValues(cp: CompiledProfile, options: Record<string, unknown>): Record<string, unknown> {
  const fields = renumber.options?.(cp) ?? [];
  const ids = fields.map((f) => f.id);
  const typed = formFieldsOf(options);
  for (const id of Object.keys(typed)) expect(ids, `the form has a field ${id}`).toContain(id);
  const values = initialValues(fields);
  for (const [id, value] of Object.entries(typed)) {
    const field = fields.find((f) => f.id === id);
    values[id] = value === '' && (field?.type === 'integer' || field?.type === 'number') ? undefined : value;
  }
  return values;
}

describe('the P4d suite', () => {
  const suite = readFileSync(join(root, 'tests', 'runtime', 'suites', 'p4d.txt'), 'utf8')
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter((line) => line !== '');

  it('lists p4-renumber and p4-renumber-others, and each is a registered scenario', async () => {
    await import('../runtime/scenarios/p4-renumber.js');
    await import('../runtime/scenarios/p4-renumber-others.js');
    expect(suite).toEqual(['p4-renumber', 'p4-renumber-others']);
    for (const name of suite) expect(scenarios.get(name), name).toBeDefined();
  });

  it('leaves m6-lathe-renumber in the suite of M6, still registered, and in no second suite', async () => {
    await import('../runtime/scenarios/m6-lathe-renumber.js');
    expect(scenarios.get('m6-lathe-renumber')).toBeDefined();
    expect(readFileSync(join(root, 'tests', 'runtime', 'suites', 'm6.txt'), 'utf8')).toMatch(/^m6-lathe-renumber$/m);
    expect(suite).not.toContain('m6-lathe-renumber');
  });

  it('is listed with the other suites of the cumulative run and counted: the sum of the suite files is the number the workflow and CONTRIBUTING.md give', () => {
    const dir = join(root, 'tests', 'runtime', 'suites');
    const names = readFileSync(join(root, '.github', 'workflows', 'harness.yml'), 'utf8').match(/suites\/\{m\{[^}]*\},([^}]*)\}\.txt/)?.[1].split(',') ?? [];
    expect(names).toContain('p4d');
    let total = 0;
    for (const name of [...Array(13).keys()].map((n) => `m${n}`).concat(names)) {
      total += readFileSync(join(dir, `${name}.txt`), 'utf8')
        .split('\n')
        .filter((line) => line.replace(/#.*/, '').trim() !== '').length;
    }
    const counted = Number(/(\d+) scenarios that drive the real app/.exec(readFileSync(join(root, '.github', 'workflows', 'harness.yml'), 'utf8'))?.[1]);
    expect(total).toBe(counted);
    expect(readFileSync(join(root, 'CONTRIBUTING.md'), 'utf8')).toContain(`The suite is ${total} scenarios`);
  });
});

describe('the option cases run through the form give the golden', () => {
  it('has a case for every option golden that can be asked for through the form, with its refusals', () => {
    expect(OPTION_CASES.map((c) => c.id)).toEqual([
      'opt-fit-to-max',
      'opt-every-nth',
      'opt-skip-containing',
      'opt-start-trigger',
      'opt-align-column',
      'opt-skip-first-last',
      'opt-start-trigger-missing',
      'opt-fit-to-max-does-not-fit',
    ]);
  });

  for (const kase of OPTION_CASES) {
    it(`${kase.id}: the typed fields give the golden text, the summary and the warnings of the table, and no question`, () => {
      const g = golden(kase.id);
      expect(g.profile).toBe(kase.profile);
      const cp = builtin(g.profile);
      const lines = g.input.slice();
      const ctx = contextOf(cp, lines, formValues(cp, g.options));
      expect(renumber.preflight?.(lines.slice(), ctx) ?? null).toBeNull();
      const result = renumber.run(lines.slice(), ctx);
      expect(result.lines).toEqual(g.expected);
      expect(result.summary).toEqual(kase.summary);
      expect(result.warnings).toEqual(kase.warnings);
      expect(result.warnings.map((w) => w.key)).toEqual(g.expect.warnings);
      expect(result.skipped.map((s) => ({ line: s.line, severity: s.severity }))).toEqual(g.expect.skipped);
      for (const row of kase.rows ?? []) {
        const wanted = t(row.key, row.params as Record<string, string | number> | undefined);
        expect(result.skipped.some((s) => s.line === row.line && s.message === wanted), `${row.line}: ${wanted}`).toBe(true);
      }
      if (kase.refused === true) expect(result.lines).toEqual(g.input);
    });
  }

  it('the form of the fanuc dialect remembers a maximum of 999 only when typed, and starts without Fit to maximum', () => {
    const cp = builtin(FANUC);
    const values = initialValues(renumber.options?.(cp) ?? []);
    expect(values.fitToMax).toBe(false);
    expect(values.everyNth).toBe(1);
    expect(values.alignColumn).toBe(0);
    expect(values.skipContaining).toBe('');
    expect(values.startTrigger).toBe('');
  });

  it('the fields the scenario bounds-tests have the bounds it types past', () => {
    const fields = renumber.options?.(builtin(FANUC)) ?? [];
    const field = (id: string) => fields.find((f) => f.id === id) as { min?: number; max?: number; maxLength?: number };
    expect(field('alignColumn').max).toBe(120);
    expect(field('everyNth')).toMatchObject({ min: 1, max: 1000 });
    expect(field('skipFirst').max).toBe(1_000_000);
    expect(field('startTrigger').maxLength).toBe(200);
  });
});

describe('the reference cases run through the form give the golden', () => {
  it('has the cases the plan names: the rewritten returns and calls, the questions asked, the kept rows', () => {
    expect(REFERENCE_CASES.map((c) => c.id)).toEqual([
      'ref-return-single-caller',
      'ref-packed-call',
      'ref-name-call',
      'ref-macro-call',
      'ref-local-call',
      'ref-return-two-callers',
      'ref-return-no-caller',
      'ref-program-twice',
      'm98-subprogram-start',
      'm98-p-before-call',
    ]);
  });

  for (const kase of REFERENCE_CASES) {
    it(`${kase.id}: the golden text, the question (${kase.pre === null ? 'none' : 'asked'}), the warnings and the rows of the table`, () => {
      const g = golden(kase.id);
      expect(g.profile).toBe(kase.profile);
      const cp = builtin(g.profile);
      const lines = g.input.slice();
      const ctx = contextOf(cp, lines, formValues(cp, g.options));
      expect(renumber.preflight?.(lines.slice(), ctx) ?? null).toEqual(kase.pre);
      expect(g.expect.preflight).toBe(kase.pre === null ? null : kase.pre.key);
      const result = renumber.run(lines.slice(), ctx);
      expect(result.lines).toEqual(g.expected);
      expect(result.warnings).toEqual(kase.warnings);
      expect(result.skipped.map((s) => ({ line: s.line, severity: s.severity }))).toEqual(g.expect.skipped);
      for (const row of kase.rows) {
        const wanted = t(row.key);
        expect(result.skipped.some((s) => s.line === row.line && s.message === wanted), `${row.line}: ${wanted}`).toBe(true);
      }
    });
  }

  it('M99 P30 of m99-p-caller is resolved into the one caller: no question, no warning, nothing but the two program markers in the report', () => {
    const g = golden('m99-p-caller');
    const cp = builtin(g.profile);
    expect(g.profile).toBe(LATHE);
    const ctx = contextOf(cp, g.input, {});
    expect(renumber.preflight?.(g.input.slice(), ctx) ?? null).toBeNull();
    const result = renumber.run(g.input.slice(), ctx);
    expect(result.lines).toEqual(g.expected);
    expect(result.lines).toContain('N20 M99 P30');
    expect(result.warnings).toEqual([]);
    expect(result.skipped.map((s) => `${s.line}|${s.severity}`)).toEqual(['1|info', '5|info']);
  });

  it('the two-callers golden leaves the value as written and says which line: the text the scenario looks for is the row on line 14', () => {
    const g = golden('ref-return-two-callers');
    const cp = builtin(g.profile);
    const result = renumber.run(g.input.slice(), contextOf(cp, g.input, {}));
    expect(result.lines[13]).toBe('N30 M99 P30');
    expect(t('ncNumbering.renumber.referenceCallersRow')).toMatch(/more than one program/);
    expect(t('ncNumbering.renumber.referenceNoCallerRow')).toMatch(/no program in this file calls this one/);
  });
});

describe('the programs of p4-renumber-others, run through the real rules', () => {
  /** What the app does after the run: the other documents of the dialect, read after the renumber. */
  function afterRenumber(w: ReturnType<typeof world>) {
    const cp = builtin(FANUC);
    const aLines = linesOf(w.a.input);
    // The dialog's defaults, no question first (the scenario answers none), and nothing reported for the calls of other programs (they carry no block number).
    expect(renumber.preflight?.(aLines.slice(), contextOf(cp, aLines, {})) ?? null).toBeNull();
    const result = renumber.run(aLines.slice(), contextOf(cp, aLines, {}));
    expect(result.warnings).toEqual([]);
    expect(result.lines.join('\n')).toBe(w.a.after);
    if (result.renumbered === undefined) throw new Error('the run changed no block number');
    const source = renumberedSourceOf(result.lines, cp, result.renumbered);
    return { cp, result, source };
  }

  for (const base of [1000, 1100, 1200, 1300, 1400, 1500]) {
    it(`base ${base}: A becomes N10 to N80, the list is the table, and the update gives the texts of the world`, () => {
      const w = world(base);
      const { cp, source } = afterRenumber(w);
      const b = linesOf(w.b.input);
      const c = linesOf(w.c.input);
      // The lathe document D is of another dialect: the app passes only the documents of A's profile.
      const [rowsB, rowsC] = findOtherReferences(source, [
        { lines: b, cp },
        { lines: c, cp },
      ]);
      const got = [...rowsB.map((r) => ['b', r.line, r.kind, r.text, r.newText] as const), ...rowsC.map((r) => ['c', r.line, r.kind, r.text, r.newText] as const)];
      expect(got).toEqual(w.listed);
      for (const r of [...rowsB, ...rowsC]) expect(r.program).toBe(w.program);

      const updatedB = applyOtherReferences(b, rowsB);
      const updatedC = applyOtherReferences(c, rowsC);
      expect(updatedB.lines.join('\n')).toBe(w.b.after);
      expect(updatedC.lines.join('\n')).toBe(w.c.after);
      // Only the update rows are written: two in B, one in C.
      expect(updatedB.changed + updatedC.changed).toBe(w.updates.references);
      expect(rowsB.filter((r) => r.kind === 'update').length).toBe(2);
      expect(rowsC.filter((r) => r.kind === 'update').length).toBe(1);
      expect([...rowsB, ...rowsC].filter((r) => r.kind !== 'update').length).toBe(w.updates.left);
      // The rows' texts: the kept row is the M98 P.. Q.. that the dialect never rewrites.
      expect(b[8]).toBe(`N10 M98 P${w.names.a} Q3`);
    });
  }

  it('no program number is held by two of the six phases: their documents stay open in one app, and a name held twice is never rewritten', () => {
    const numbers = [1000, 1100, 1200, 1300, 1400, 1500].flatMap((base) => Object.values(world(base).names));
    expect(new Set(numbers).size).toBe(numbers.length);
    // ...nor the O1000 of the document the test build starts with.
    expect(numbers).not.toContain(1000);
  });

  it('the lathe document would be listed if it were read, which is why it is left out: it is of another dialect', () => {
    const w = world(1000);
    const { cp, source } = afterRenumber(w);
    const [rows] = findOtherReferences(source, [{ lines: linesOf(w.d.input), cp }]);
    expect(rows.map((r) => [r.line, r.kind, r.newText])).toEqual([[4, 'update', '70']]);
    const lathe = builtin(LATHE);
    expect(lathe.profile.id).not.toBe(cp.profile.id);
  });

  it('a block number typed into C before the update changes nothing that the rules list: the document is told apart by its version, not by its text', () => {
    // The scenario types a character at the start of C; the rows are about the M99 line only.
    const w = world(1100);
    const { cp, source } = afterRenumber(w);
    const typed = linesOf(w.c.input);
    typed[0] = `X${typed[0]}`;
    const [rows] = findOtherReferences(source, [{ lines: typed, cp }]);
    expect(rows.map((r) => [r.line, r.kind, r.newText])).toEqual([[4, 'update', '70']]);
  });

  it('the texts the scenario reads from the service exist and take the parameters it gives them', () => {
    expect(t('renumberOthers.found', { count: 4 })).toBe('4 references in other open documents point into programs you just renumbered.');
    expect(t('renumberOthers.next.canUpdate', { count: 3 })).toContain('rewrites the 3 marked to update');
    expect(t('renumberOthers.row.update', { text: '3', newText: '30', program: '1000' })).toBe('3 becomes 30 (program 1000).');
    expect(t('renumberOthers.confirm.references', { count: 3 })).toBe('Rewrite 3 references');
    expect(t('renumberOthers.confirm.inDocuments', { count: 2 })).toBe('in 2 other documents.');
    expect(t('renumberOthers.done.references', { count: 3 })).toBe('Updated 3 references');
    expect(t('renumberOthers.done.rest', { count: 1 })).toBe('1 more is listed below and stays as it is.');
    expect(t('renumberOthers.refused.listChanged')).toContain('Check it and run Update References in Other Documents again');
    expect(t('renumberOthers.refused.listChanged')).not.toContain('Run Renumber Blocks again');
    expect(t('renumberOthers.refused.sourceChanged', { name: 'Untitled-3' })).toBe(
      'Nothing was written: Untitled-3 changed after the renumber. Undo your changes in Untitled-3, or undo the renumber and run it again.',
    );
    expect(t('renumberOthers.replaced', { count: 3, name: 'Untitled-1' })).toBe(
      '3 references from the earlier renumber of Untitled-1 were not updated and are no longer listed. Undo both renumbers, renumber once, then update.',
    );
    expect(t('renumberOthers.refused.nothingWritten')).toBe('Nothing was written in any document.');
    expect(t('renumberOthers.confirm.ok')).toBe('Update');
  });
});

describe('the scenario files', () => {
  const scenarioDir = join(root, 'tests', 'runtime', 'scenarios');
  const source = (file: string): string => readFileSync(join(scenarioDir, file), 'utf8');

  it('p4-renumber and p4-renumber-others take their expected text from the goldens and ctx.t, and never run a form without resetting its memory', () => {
    for (const file of ['p4-renumber.js', 'p4-renumber-others.js']) {
      const text = source(file);
      expect(text, file).toContain("from './p4-renumber-common.js'");
      expect(text, file).toMatch(/scenario\('p4-renumber/);
    }
    expect(source('p4-renumber.js')).toContain('resetRenumberForm(');
  });

  it('p4-renumber-others asks for the texts of the service that exist, and covers the recompute, the kept list, the locked document and the replaced list (P4d review H4d item 4)', () => {
    const text = source('p4-renumber-others.js');
    // Every static ctx.t key of the scenario is a real message (a missing key would answer with the key itself).
    const keys = [...text.matchAll(/ctx\.t\('([^'$]+)'/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(10);
    for (const key of new Set(keys)) {
      expect(t(key, { count: 2, name: 'N', text: 'x', newText: 'y', program: 'p', step: 1, start: 1, max: 1 }), key).not.toBe(key);
    }
    expect(text).not.toContain('renumberOthers.refused.changed');
    // The phases of the owner's answers B and C, and the checks the review found missing.
    for (const needle of ['renumberOthers.refused.listChanged', 'renumberOthers.refused.sourceChanged', "'renumberOthers.replaced'", "startTrigger: 'NO_SUCH_TEXT'", "'file.toggleReadOnly'"]) {
      expect(text, needle).toContain(needle);
    }
    // The header describes the recompute flow and no longer the dead end.
    expect(text).toContain('Update finds the references again');
    expect(text).not.toContain('Renumber\n//                      Blocks again lists anew');
  });

  it('the part B of m6-lathe-renumber no longer expects a question for M99 P30 and has the three returns of P4.19', () => {
    const text = source('m6-lathe-renumber.js');
    expect(text).not.toContain("confirm: 'Continue' })\n  h.check('a reference the run cannot follow is asked about first");
    expect(text).toContain("'ref-return-single-caller'");
    expect(text).toContain("'ref-return-no-caller'");
    expect(text).toContain("'m99-p-caller'");
  });
});
