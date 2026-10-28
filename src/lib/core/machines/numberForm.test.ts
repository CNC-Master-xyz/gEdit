// The per-class number input (plan §6.10 rule 12; P4.43a).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { profileOf } from '../../../../tests/unit/helpers/profiles';
import { withPointlessFeeds } from './fields';
import {
  NUMBER_FORM_CLASSES,
  inputReadingAs,
  numberInputFromRows,
  numberRowProblems,
  numberRows,
  problemClass,
  type NumberClassRow,
} from './numberForm';
import { parseNumber } from '$lib/core/nc/numbers';
import { classReadingOf, valueOf } from './numbers';
import { numberInputProblems } from './validate';
import type { MachineParams, NumberClass, NumberInput } from './types';

const GOLDEN = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../tests/fixtures/machines/numbers.json', import.meta.url)), 'utf8'),
) as { inputs: Record<string, NumberInput & { note?: string; form?: unknown }> };

const PROFILES = ['fanuc-gcode', 'fanuc-lathe', 'okuma-osp'] as const;

function presetsOf(profileId: string) {
  return profileOf(profileId).machineParams?.numberInput?.presets ?? [];
}

function preset(profileId: string, id: string): NumberInput {
  const found = presetsOf(profileId).find((p) => p.id === id);
  if (!found) throw new Error(`${profileId}: no preset ${id}`);
  return found.value;
}

function row(rows: readonly NumberClassRow[], cls: NumberClass): NumberClassRow {
  const found = rows.find((r) => r.cls === cls);
  if (!found) throw new Error(`no row ${cls}`);
  return found;
}

function edit(rows: readonly NumberClassRow[], cls: NumberClass, change: Partial<NumberClassRow>): NumberClassRow[] {
  return rows.map((r) => (r.cls === cls ? { ...r, ...change } : r));
}

const machine = (input: NumberInput): MachineParams =>
  ({ numberInput: input, units: 'mm', diameter: null, variants: {}, modalInitial: {} }) as MachineParams;

describe('numberRows', () => {
  it('gives the five classes of every built-in preset, inch increments only where a class follows the units', () => {
    for (const profileId of PROFILES) {
      for (const p of presetsOf(profileId)) {
        const rows = numberRows(p.value);
        expect(rows.map((r) => r.cls), `${profileId}/${p.id}`).toEqual([...NUMBER_FORM_CLASSES]);
        for (const r of rows) {
          // A row is what the reader reads (rule 1).
          expect(r.mode, `${profileId}/${p.id} ${r.cls}`).toBe(classReadingOf(r.cls, p.value, 'mm')?.mode);
          expect(r.increment).toBe(classReadingOf(r.cls, p.value, 'mm')?.unit);
          if (r.cls === 'angle' || r.cls === 'dwell') expect(r.incrementInch).toBeNull();
          else expect(r.incrementInch).toBe(classReadingOf(r.cls, p.value, 'inch')?.unit ?? null);
        }
      }
    }
  });

  it('reads IS-B as the control does: feeds of their own, everything else from the base', () => {
    const rows = numberRows(preset('fanuc-gcode', 'is-b'));
    expect(rows).toEqual([
      { cls: 'length', mode: 'increment', increment: '0.001', incrementInch: '0.0001', fromBase: true },
      { cls: 'angle', mode: 'increment', increment: '0.001', incrementInch: null, fromBase: true },
      { cls: 'feedPerMin', mode: 'increment', increment: '1', incrementInch: '0.01', fromBase: false },
      { cls: 'feedPerRev', mode: 'increment', increment: '0.01', incrementInch: '0.0001', fromBase: false },
      { cls: 'dwell', mode: 'increment', increment: '0.001', incrementInch: null, fromBase: true },
    ]);
  });

  it('shows an inch step the input does not write as the one the reader derives, and none where a scale has none', () => {
    const rows = numberRows({ mode: 'increment', incrementMm: '0.001' });
    expect(row(rows, 'length').incrementInch).toBe('0.0001');
    const tenMicrons = numberRows(preset('okuma-osp', 'okuma-10um'));
    expect(row(tenMicrons, 'length')).toMatchObject({ mode: 'scale', increment: '0.01', incrementInch: null });
    expect(row(tenMicrons, 'feedPerRev')).toMatchObject({ mode: 'scale', increment: '0.01', incrementInch: null, fromBase: true });
  });

  it('marks an entry that reads like the base as from the base', () => {
    const input: NumberInput = { mode: 'increment', incrementMm: '0.001', classes: { dwell: { mode: 'increment', increment: '0.0010' } } };
    expect(row(numberRows(input), 'dwell').fromBase).toBe(true);
  });
});

describe('numberInputFromRows', () => {
  it('gives every built-in preset back as the very object when no row changed', () => {
    for (const profileId of PROFILES) {
      for (const p of presetsOf(profileId)) {
        expect(numberInputFromRows(p.value, numberRows(p.value)), `${profileId}/${p.id}`).toEqual(p.value);
      }
    }
  });

  it('writes a classes entry only for a row that differs, the smallest one that reads as the row', () => {
    const base = preset('fanuc-gcode', 'is-b');
    let rows = numberRows(base);
    rows = edit(rows, 'dwell', { mode: 'calculator' });
    rows = edit(rows, 'angle', { increment: '0.0001' });
    const out = numberInputFromRows(base, rows);
    expect(out.classes?.dwell).toEqual({ mode: 'calculator' });
    expect(out.classes?.angle).toEqual({ increment: '0.0001' });
    expect(out.classes?.feedPerMin).toEqual(base.classes?.feedPerMin);
    expect(out.incrementMm).toBe('0.001');
    // And the rows of the result are the rows asked for.
    expect(numberRows(out).map(({ fromBase: _f, ...r }) => r)).toEqual(rows.map(({ fromBase: _f, ...r }) => r));
  });

  it('removes the entry of a row put back to the base reading', () => {
    const base = preset('fanuc-gcode', 'is-b');
    const rows = edit(numberRows(base), 'feedPerMin', { increment: '0.001', incrementInch: '0.0001' });
    expect(numberInputFromRows(base, rows).classes?.feedPerMin).toBeUndefined();
    const calc = numberInputFromRows(preset('fanuc-gcode', 'calculator'), numberRows(preset('fanuc-gcode', 'calculator')));
    expect(calc.classes).toBeUndefined();
  });

  it('writes an inch step with its metric step, because the reader reads it only beside one', () => {
    const base: NumberInput = { mode: 'increment', incrementMm: '0.001', incrementInch: '0.0001' };
    const rows = edit(numberRows(base), 'feedPerRev', { incrementInch: '0.00001' });
    const out = numberInputFromRows(base, rows);
    expect(out.classes?.feedPerRev).toEqual({ increment: '0.001', incrementInch: '0.00001' });
    expect(row(numberRows(out), 'feedPerRev').incrementInch).toBe('0.00001');
    // A changed metric step brings its own derived inch step; one that equals it is not written.
    const derived = numberInputFromRows(base, edit(numberRows(base), 'feedPerRev', { increment: '0.01', incrementInch: '0.001' }));
    expect(derived.classes?.feedPerRev).toEqual({ increment: '0.01' });
  });

  it('leaves an emptied inch step to the reader', () => {
    const base = preset('fanuc-gcode', 'is-b');
    const out = numberInputFromRows(base, edit(numberRows(base), 'length', { mode: 'scale', incrementInch: null }));
    expect(out.classes?.length).toEqual({ mode: 'scale' });
  });

  it('compares increments by value and writes them as typed', () => {
    const base = preset('fanuc-gcode', 'is-b');
    expect(numberInputFromRows(base, edit(numberRows(base), 'angle', { increment: '0.0010' })).classes?.angle).toBeUndefined();
    expect(numberInputFromRows(base, edit(numberRows(base), 'angle', { increment: '0.010' })).classes?.angle).toEqual({ increment: '0.010' });
  });

  it('writes what is not a decimal, so the check names it at its row', () => {
    const base = preset('fanuc-gcode', 'is-b');
    const rows = edit(numberRows(base), 'dwell', { increment: '0,01' });
    expect(numberInputFromRows(base, rows).classes?.dwell).toEqual({ increment: '0,01' });
    const problems = numberRowProblems(base, rows, 'm1', 'params.numberInput');
    expect(problems.map((p) => p.path)).toEqual(['params.numberInput.classes.dwell.increment']);
    expect(problemClass(problems[0], 'params.numberInput')).toBe('dwell');
  });

  it('shows a point-less-feed choice as the feed rows it changed, and writes it back unchanged', () => {
    const decl = profileOf('fanuc-gcode').machineParams?.numberInput;
    const choice = decl?.pointlessFeeds?.choices.find((c) => c.value === 'per-rev');
    const value = withPointlessFeeds(preset('fanuc-gcode', 'is-b'), choice);
    const rows = numberRows(value);
    expect(row(rows, 'feedPerRev')).toMatchObject({ increment: '0.001', incrementInch: '0.00001', fromBase: false });
    expect(row(rows, 'feedPerMin')).toMatchObject({ increment: '1', incrementInch: '0.01' });
    expect(numberInputFromRows(value, rows)).toEqual(value);
  });
});

describe('inputReadingAs', () => {
  it('finds the preset the rows read as, even where the smallest entries would be written otherwise', () => {
    const isb = preset('fanuc-gcode', 'is-b');
    const choice = profileOf('fanuc-gcode').machineParams?.numberInput?.pointlessFeeds?.choices.find((c) => c.value === 'per-rev');
    const perRev = withPointlessFeeds(isb, choice);
    const rows = edit(numberRows(isb), 'feedPerRev', { increment: '0.001', incrementInch: '0.00001' });
    // Written from the rows, the entry has no `mode`; the preset with the choice repeats it.
    expect(numberInputFromRows(isb, rows)).not.toEqual(perRev);
    expect(inputReadingAs([isb, perRev], rows)).toBe(perRev);
    expect(inputReadingAs([isb, perRev], edit(rows, 'feedPerRev', { increment: '0.005' }))).toBeNull();
  });
});

describe('numberRowProblems', () => {
  it('answers what numberInputProblems answers for the saved value', () => {
    const base = preset('okuma-osp', 'okuma-1um');
    const cases: NumberClassRow[][] = [
      numberRows(base),
      edit(numberRows(base), 'length', { increment: '0' }),
      edit(numberRows(base), 'feedPerMin', { increment: '', incrementInch: 'x' }),
      edit(numberRows(base), 'angle', { mode: 'scale', increment: '-1' }),
    ];
    for (const rows of cases) {
      const saved = numberInputFromRows(base, rows);
      expect(numberRowProblems(base, rows, 'm', 'machines[0].params.numberInput')).toEqual(
        numberInputProblems(saved, 'm', 'machines[0].params.numberInput'),
      );
    }
    expect(numberRowProblems(base, cases[0], 'm', 'p')).toEqual([]);
    expect(numberRowProblems(base, cases[1], 'm', 'p').map((p) => p.path)).toEqual(['p.classes.length.increment']);
  });

  it('puts a problem of the input as a whole below the table', () => {
    expect(problemClass({ machineId: null, path: 'p.incrementMm', message: '' }, 'p')).toBeNull();
    expect(problemClass({ machineId: null, path: 'p.classes.feedPerRev.mode', message: '' }, 'p')).toBe('feedPerRev');
  });
});

describe('the shared goldens', () => {
  // `tests/fixtures/machines/numbers.json` input `form-rows` is the value this table saves for an
  // IS-B mill whose dwell is read as written and whose angles count in 0.0001°; its value cases
  // are read by `numbers.test.ts` and `tests/python/test_machine.py` alike.
  it('every value reads back through numbers.ts and _nc_machine.py the same (the form-rows input)', () => {
    const base = preset('fanuc-gcode', 'is-b');
    const rows = edit(edit(numberRows(base), 'dwell', { mode: 'calculator' }), 'angle', { increment: '0.0001' });
    const { note: _note, ...written } = GOLDEN.inputs['form-rows'];
    expect(numberInputFromRows(base, rows)).toEqual(written);
    const lit = parseNumber('90000');
    if (lit === null) throw new Error('no literal');
    expect(valueOf(lit, 'angle', machine(written), 'mm')).toBe('9');
  });
});

describe('the inch step of a feed row (NC-5)', () => {
  const base = preset('fanuc-gcode', 'is-b');
  const path = 'params.numberInput';

  it('refuses a feed row read in increments whose metric step changed and whose inch step is empty', () => {
    const rows = numberRows(base);
    for (const cls of ['feedPerMin', 'feedPerRev'] as const) {
      const problems = numberRowProblems(base, edit(rows, cls, { increment: '0.005', incrementInch: null }), 'm', path);
      expect(problems.map((p) => p.path), cls).toEqual([`${path}.classes.${cls}.incrementInch`]);
      expect(problems[0].message).toContain('hundredth');
      expect(problems[0].message).toContain('tenth');
    }
  });

  it('takes the same row once the inch step is written, and writes both steps', () => {
    const rows = edit(numberRows(base), 'feedPerRev', { increment: '0.005', incrementInch: '0.00005' });
    expect(numberRowProblems(base, rows, 'm', path)).toEqual([]);
    expect(numberInputFromRows(base, rows).classes?.feedPerRev).toEqual({ increment: '0.005', incrementInch: '0.00005' });
  });

  it('asks for nothing where an empty inch field is right: lengths (a tenth), a feed read as written or scaled', () => {
    const rows = numberRows(base);
    expect(numberRowProblems(base, edit(rows, 'length', { increment: '0.01', incrementInch: null }), 'm', path)).toEqual([]);
    expect(numberRowProblems(base, edit(rows, 'feedPerRev', { mode: 'calculator', incrementInch: null }), 'm', path)).toEqual([]);
    expect(numberRowProblems(base, edit(rows, 'feedPerMin', { mode: 'scale', increment: '1', incrementInch: null }), 'm', path)).toEqual([]);
  });

  it('refuses an emptied inch field of a feed row even when the metric step did not change', () => {
    const rows = edit(numberRows(base), 'feedPerMin', { incrementInch: null });
    expect(numberRowProblems(base, rows, 'm', path).map((p) => p.path)).toEqual([`${path}.classes.feedPerMin.incrementInch`]);
  });
});
