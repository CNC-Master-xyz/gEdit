// The machine form's table "Numbers" (plan §6.10 rule 12; P4.43a). The rows and the saved
// value are pure functions of `core/machines/numberForm.ts` and are tested there; here: the
// markup (rendered with `svelte/server`, no DOM, like the other dialogs), the plain labels, a
// change of a field, the problems at their row, and the mount on the Machines page (its module
// helpers, over a fake machine service). Typing is the H4h runtime scenario.

import { render } from 'svelte/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MachineConfig, MachineProblem, NumberInput } from '$lib/core/machines/types';
import { numberRows, type NumberClassRow } from '$lib/core/machines/numberForm';
import { profileOf } from '../../../../tests/unit/helpers/profiles';

const fake = vi.hoisted(() => ({
  list: [] as unknown[],
  add: vi.fn(async (_machine: unknown): Promise<string> => 'new-id'),
  update: vi.fn(async (_id: string, _patch: unknown): Promise<void> => {}),
  shown: [] as { text: string; error: boolean }[],
}));

vi.mock('$lib/app/status', () => ({
  status: { show: (text: string, o?: { error?: boolean }) => fake.shown.push({ text, error: o?.error === true }) },
}));

vi.mock('$lib/stores/machines', async () => {
  const { writable } = await import('svelte/store');
  return {
    machines: {
      list: writable([]),
      revision: writable(0),
      problems: () => [],
      blocked: () => false,
      readOnly: () => false,
      get: (id: string) => (fake.list as MachineConfig[]).find((m) => m.id === id),
      add: fake.add,
      update: fake.update,
    },
  };
});

const MachineNumberForm = (await import('./MachineNumberForm.svelte')).default;
const { changedRow, numberErrors, numberFieldsOf } = await import('./MachineNumberForm.svelte');
const { addDraft, editDraft, fieldsFor, numberRowsOf, numberProblemsOf, submitDraft, withNumberRows, NUMBERS_PATH } = await import(
  './MachinesPage.svelte'
);
const { machines } = await import('$lib/stores/machines');
const { codes } = await import('$lib/stores/codes');
const { profiles } = await import('$lib/stores/profiles');
const { docs } = await import('$lib/stores/documents');
const { dialogs } = await import('$lib/app/dialogs');
const { status } = await import('$lib/app/status');
const { t } = await import('$lib/i18n');
const { CUSTOM_PRESET, FIELD_NAME, FIELD_NUMBER_INPUT, FIELD_POINTLESS_FEEDS, withPointlessFeeds } = await import('$lib/core/machines/fields');

const deps = { machines, profiles, codes, docs, dialogs, status, t } as unknown as Parameters<typeof submitDraft>[1];

function preset(profileId: string, id: string): NumberInput {
  const found = profileOf(profileId).machineParams?.numberInput?.presets.find((p) => p.id === id);
  if (!found) throw new Error(`${profileId}: no preset ${id}`);
  return found.value;
}

function markup(rows: readonly NumberClassRow[], over: Record<string, unknown> = {}): string {
  return render(MachineNumberForm, { props: { rows, onChange: () => {}, ...over } }).body;
}

function edit(rows: readonly NumberClassRow[], cls: string, change: Partial<NumberClassRow>): NumberClassRow[] {
  return rows.map((r) => (r.cls === cls ? { ...r, ...change } : r));
}

beforeEach(() => {
  fake.list = [];
  fake.add.mockClear();
  fake.update.mockClear();
  fake.shown.length = 0;
});

describe('MachineNumberForm: the table', () => {
  const rows = numberRows(preset('fanuc-gcode', 'is-b'));
  const html = markup(rows, { machineId: 'mill-1' });

  it('is titled and has one row per kind of number, with the test ids of §6.11', () => {
    expect(html).toContain('data-testid="machine-number-form"');
    expect(html).toContain('data-machine="mill-1"');
    expect(html).toContain('Numbers');
    expect([...html.matchAll(/data-testid="machine-number-row" data-class="([a-zA-Z]+)" data-mode="([a-z]+)" data-from-base="(true|false)"/g)].map((m) => m.slice(1))).toEqual([
      ['length', 'increment', 'true'],
      ['angle', 'increment', 'true'],
      ['feedPerMin', 'increment', 'false'],
      ['feedPerRev', 'increment', 'false'],
      ['dwell', 'increment', 'true'],
    ]);
  });

  it('speaks plain words: the kinds, the three readings, the units', () => {
    for (const label of ['Length', 'Angle', 'Feed per minute', 'Feed per revolution', 'Dwell']) expect(html).toContain(label);
    expect(html).toContain('In steps of the increment (a number without a point)');
    expect(html).toContain('As written');
    expect(html).toContain('Every number times the unit');
    expect(html).toContain('mm/rev');
    expect(html).toContain('inch/min');
    expect(html).not.toMatch(/feedPerMin<|incrementMm|calculator</);
  });

  it('offers an inch increment only for the kinds that follow the program units', () => {
    expect(html).toContain('data-field="length.incrementInch"');
    expect(html).toContain('data-field="feedPerRev.incrementInch"');
    expect(html).not.toContain('data-field="angle.incrementInch"');
    expect(html).not.toContain('data-field="dwell.incrementInch"');
  });

  it('marks a row with a rule of its own', () => {
    expect(html.match(/Own rule/g)).toHaveLength(2);
  });

  it('says "Custom" only when asked, and shows no problem list without problems', () => {
    expect(html).not.toContain('data-testid="machine-number-custom"');
    expect(html).not.toContain('data-testid="machine-number-problems"');
    expect(markup(rows, { custom: true })).toContain('data-testid="machine-number-custom"');
  });

  it('shows a problem at its field, and one of the rules as a whole under the table', () => {
    const problems: MachineProblem[] = [
      { machineId: null, path: 'params.numberInput.classes.dwell.increment', message: 'an increment is decimal text above zero, e.g. "0.001"' },
      { machineId: null, path: 'params.numberInput.incrementMm', message: 'the metric increment is decimal text above zero, e.g. "0.001"' },
    ];
    const shown = markup(rows, { problems });
    expect(shown).toMatch(/data-field="dwell.increment" data-error="machineNumbers.problem"/);
    expect(shown).toContain('data-testid="machine-number-problems"');
    expect(shown).toContain('the metric increment is decimal text above zero');
    const { byField, general } = numberErrors(problems, 'params.numberInput');
    expect(Object.keys(byField)).toEqual(['dwell.increment']);
    expect(general).toHaveLength(1);
  });
});

describe('MachineNumberForm: a change', () => {
  const row: NumberClassRow = { cls: 'feedPerRev', mode: 'increment', increment: '0.01', incrementInch: '0.0001', fromBase: false };

  it('takes a reading, an increment as typed, and an emptied inch field as "the reader decides"', () => {
    expect(changedRow(row, 'feedPerRev.mode', 'scale').mode).toBe('scale');
    expect(changedRow(row, 'feedPerRev.mode', 'nonsense')).toBe(row);
    expect(changedRow(row, 'feedPerRev.increment', ' 0.001 ').increment).toBe('0.001');
    expect(changedRow(row, 'feedPerRev.incrementInch', '').incrementInch).toBeNull();
    // A field of another row changes nothing.
    expect(changedRow(row, 'length.increment', '1')).toBe(row);
  });

  it('labels every field and leaves no field without its unit', () => {
    const fields = numberFieldsOf(row);
    expect(fields.map((f) => [f.id, f.unit ?? null])).toEqual([
      ['feedPerRev.mode', null],
      ['feedPerRev.increment', 'mm/rev'],
      ['feedPerRev.incrementInch', 'inch/rev'],
    ]);
  });
});

// The first call builds the profiles and code databases, which takes a while on a busy machine.
describe('the table on the Machines page', { timeout: 120_000 }, () => {
  it('starts from the chosen preset, and a preset choice fills it', () => {
    const draft = addDraft('fanuc-gcode', deps);
    expect(numberRowsOf(draft, deps)).toEqual(numberRows(preset('fanuc-gcode', 'is-b')));
    const calc = { ...draft, values: { ...draft.values, [FIELD_NUMBER_INPUT]: 'calculator' } };
    expect(numberRowsOf(calc, deps)).toEqual(numberRows(preset('fanuc-gcode', 'calculator')));
  });

  it('shows a hand-written rule set that matches no preset instead of "edited in the file"', () => {
    const own: NumberInput = { mode: 'increment', incrementMm: '0.001', classes: { dwell: { mode: 'calculator' } } };
    const machine: MachineConfig = { id: 'mill-1', name: 'Mill 1', profile: 'fanuc-gcode', params: { numberInput: own } };
    fake.list = [machine];
    const draft = editDraft(machine, deps);
    expect(draft.values[FIELD_NUMBER_INPUT]).toBe(CUSTOM_PRESET);
    expect(numberRowsOf(draft, deps)?.find((r) => r.cls === 'dwell')).toMatchObject({ mode: 'calculator', fromBase: false });
  });

  it('turns the preset choice to "Custom" once a row is edited by hand, and back when the rows are a preset again', () => {
    const draft = addDraft('fanuc-gcode', deps);
    const rows = numberRowsOf(draft, deps) ?? [];
    const edited = withNumberRows(draft, edit(rows, 'feedPerRev', { increment: '0.005' }), deps);
    expect(edited.values[FIELD_NUMBER_INPUT]).toBe(CUSTOM_PRESET);
    const choice = fieldsFor(edited, deps).find((f) => f.id === FIELD_NUMBER_INPUT);
    expect(choice?.choices?.some((c) => c.value === CUSTOM_PRESET)).toBe(true);
    // The point-less-feed option of T084: a feed row set to its other choice is that choice.
    const perRev = withNumberRows(draft, edit(rows, 'feedPerRev', { increment: '0.001', incrementInch: '0.00001' }), deps);
    expect(perRev.values[FIELD_NUMBER_INPUT]).toBe('is-b');
    expect(perRev.values[FIELD_POINTLESS_FEEDS]).toBe('per-rev');
    // …and it is saved as that very rule set.
    expect(perRev.numbers?.base).toEqual(
      withPointlessFeeds(preset('fanuc-gcode', 'is-b'), profileOf('fanuc-gcode').machineParams?.numberInput?.pointlessFeeds?.choices[1]),
    );
  });

  it('saves the whole number input the rows give, and refuses rows with a problem', async () => {
    const draft = addDraft('fanuc-gcode', deps);
    const rows = numberRowsOf(draft, deps) ?? [];
    const named = { ...draft, values: { ...draft.values, [FIELD_NAME]: 'Mill 9' } };
    const good = withNumberRows(named, edit(rows, 'dwell', { mode: 'calculator' }), deps);
    expect(await submitDraft(good, deps)).toBe(true);
    const saved = fake.add.mock.calls[0][0] as unknown as MachineConfig;
    expect(saved.params.numberInput).toEqual({ ...preset('fanuc-gcode', 'is-b'), classes: { ...preset('fanuc-gcode', 'is-b').classes, dwell: { mode: 'calculator' } } });

    const bad = withNumberRows(named, edit(rows, 'dwell', { increment: '0' }), deps);
    expect(numberProblemsOf(bad).map((p) => p.path)).toEqual([`${NUMBERS_PATH}.classes.dwell.increment`]);
    expect(await submitDraft(bad, deps)).toBe(false);
    expect(fake.add).toHaveBeenCalledTimes(1);
  });

  it('leaves a rule set that was not edited as the choice gives it', async () => {
    const own: NumberInput = { mode: 'increment', incrementMm: '0.001', classes: { dwell: { mode: 'calculator', increment: '0.0010' } } };
    const machine: MachineConfig = { id: 'mill-1', name: 'Mill 1', profile: 'fanuc-gcode', params: { numberInput: own } };
    fake.list = [machine];
    expect(await submitDraft(editDraft(machine, deps), deps)).toBe(true);
    const patch = fake.update.mock.calls[0][1] as { params: { numberInput: NumberInput } };
    expect(patch.params.numberInput).toEqual(own);
  });
});

describe('the inch step of a row (NC-5, NC-7)', () => {
  const feed: NumberClassRow = { cls: 'feedPerRev', mode: 'increment', increment: '0.01', incrementInch: '0.0001', fromBase: false };
  const length: NumberClassRow = { cls: 'length', mode: 'increment', increment: '0.001', incrementInch: '0.0001', fromBase: true };

  it('clears the inch field of a row whose metric step is edited, and keeps it when the value is the same', () => {
    expect(changedRow(feed, 'feedPerRev.increment', '0.001').incrementInch).toBeNull();
    expect(changedRow(length, 'length.increment', '0.01').incrementInch).toBeNull();
    expect(changedRow(feed, 'feedPerRev.increment', '0.0100').incrementInch).toBe('0.0001');
    expect(changedRow(feed, 'feedPerRev.mode', 'scale').incrementInch).toBe('0.0001');
  });

  it('names the inch step of a feed in the help, and no longer calls an empty field a tenth', () => {
    const help = (row: NumberClassRow) => numberFieldsOf(row).find((f) => f.id.endsWith('.incrementInch'))?.help ?? '';
    expect(help(feed)).toContain('Fanuc: a hundredth of the metric step, Okuma: a tenth');
    expect(help(feed)).not.toMatch(/^Empty/);
    expect(help(length)).toContain('a tenth of the metric increment');
  });

  it('says on the length row that the step still counts the micrometre cycle values', () => {
    const help = (row: NumberClassRow) => numberFieldsOf(row).find((f) => f.id.endsWith('.increment'))?.help ?? '';
    expect(help(length)).toContain('G74/G75 P and Q, G76 P and Q, G83 Q');
    expect(help(length)).toContain('As written');
    expect(help(feed)).not.toContain('G76');
  });

  it('blocks a Save on the page until the feed row has its inch step', () => {
    const draft = addDraft('fanuc-gcode', deps);
    const rows = numberRowsOf(draft, deps) ?? [];
    const typed = changedRow(rows.find((r) => r.cls === 'feedPerRev') as NumberClassRow, 'feedPerRev.increment', '0.005');
    const open = withNumberRows(draft, rows.map((r) => (r.cls === 'feedPerRev' ? typed : r)), deps);
    expect(numberProblemsOf(open).map((p) => p.path)).toEqual([`${NUMBERS_PATH}.classes.feedPerRev.incrementInch`]);
    const { byField } = numberErrors(numberProblemsOf(open), NUMBERS_PATH);
    expect(Object.keys(byField)).toEqual(['feedPerRev.incrementInch']);
    const written = withNumberRows(open, (open.numbers?.rows ?? []).map((r) => (r.cls === 'feedPerRev' ? { ...r, incrementInch: '0.00005' } : r)), deps);
    expect(numberProblemsOf(written)).toEqual([]);
  });
});

describe('rows typed to read like a preset (CODE-10)', () => {
  it('keeps the typed text and still names the preset', () => {
    const draft = addDraft('fanuc-gcode', deps);
    const rows = numberRowsOf(draft, deps) ?? [];
    const typed = withNumberRows(draft, edit(rows, 'length', { increment: '0.0010' }), deps);
    expect(typed.values[FIELD_NUMBER_INPUT]).toBe('is-b');
    expect(typed.numbers?.rows.find((r) => r.cls === 'length')?.increment).toBe('0.0010');
    // …and what is saved is the preset's own value.
    expect(numberProblemsOf(typed)).toEqual([]);
    expect(typed.numbers?.base).toEqual(preset('fanuc-gcode', 'is-b'));
  });
});
