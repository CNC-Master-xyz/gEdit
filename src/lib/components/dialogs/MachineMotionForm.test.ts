// The page "Motion and limits" (plan §6.4 rule 4, P4.8): plain labels with units, every field
// optional and empty by default, a note that every value comes from the machine's
// documentation, the peck values saying they only prefill, the problems of a broken stored
// block listed with their paths. The checks and the conversions are pure functions of
// `core/machines/motion.ts` and are tested there; rendered here with `svelte/server` (no DOM),
// like the other dialogs. Typing is the H4b runtime scenarios.

import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { MV, motionToValues } from '$lib/core/machines/motion';
import { t } from '$lib/i18n';
import MachineMotionForm, { motionErrors, motionFieldGroups } from './MachineMotionForm.svelte';

const MILL = { axes: ['X', 'Y', 'Z', 'A', 'B', 'C'], angular: ['A', 'B', 'C'] };
const LATHE = { axes: ['X', 'Z', 'C', 'Y'], angular: ['C'] };

function markup(values: Record<string, unknown>, over: Record<string, unknown> = {}): string {
  return render(MachineMotionForm, { props: { values, onChange: () => {}, axes: MILL.axes, angular: MILL.angular, ...over } }).body;
}

const EMPTY = motionToValues(undefined, undefined);

describe('MachineMotionForm: a machine without data', () => {
  const html = markup(EMPTY);

  it('is titled, says every value comes from the documentation and that gEdit assumes none', () => {
    expect(html).toContain('data-testid="machine-motion-form"');
    expect(html).toContain('Motion and limits');
    expect(html).toContain('data-testid="motion-note"');
    expect(html).toContain('Every value comes from your machine’s documentation');
    expect(html).toContain('gEdit assumes none');
  });

  it('asks for the unit first, before any rate', () => {
    expect(html.indexOf('data-field="units"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-field="units"')).toBeLessThan(html.indexOf('data-field="rapid.X"'));
    expect(html).toContain('Millimetres (mm)');
    expect(html).toContain('Inches');
  });

  it('offers every field of the contract, one rapid rate and one travel pair per axis of the dialect', () => {
    for (const id of ['rapidKind', 'maxFeed', 'toolChange', 'peckRetract', 'peckClearance', 'spindle.main', 'spindle.others']) {
      expect(html).toContain(`data-field="${id}"`);
    }
    for (const axis of MILL.axes) {
      expect(html).toContain(`data-field="rapid.${axis}"`);
      expect(html).toContain(`data-field="travel.${axis}.min"`);
      expect(html).toContain(`data-field="travel.${axis}.max"`);
    }
    expect(html).not.toContain('data-field="rapid.W"');
  });

  it('leaves every field empty and shows no error and no problem list', () => {
    expect(html).not.toContain('data-error');
    expect(html).not.toContain('data-testid="motion-problems"');
    expect(html).not.toMatch(/<input[^>]*value="[^"]+"[^>]*>/); // no number text filled in
  });

  it('says the two peck values only prefill the expansion and statistics forms', () => {
    expect(html.match(/Only fills in the expansion and statistics forms/g)).toHaveLength(2);
  });

  it('follows the axes of another dialect', () => {
    const lathe = markup(EMPTY, { axes: LATHE.axes, angular: LATHE.angular });
    expect(lathe).toContain('data-field="rapid.X"');
    expect(lathe).toContain('data-field="rapid.C"');
    expect(lathe).not.toContain('data-field="rapid.A"');
  });
});

describe('MachineMotionForm: the units in the labels', () => {
  const labels = (values: Record<string, unknown>, o = MILL): Record<string, string> =>
    Object.fromEntries(Object.values(motionFieldGroups(values, o)).flat().map((f) => [f.id, f.label]));

  it('names mm per minute, inch per minute, degrees for a rotary axis', () => {
    const mm = labels({ units: 'mm' });
    expect(mm['rapid.X']).toBe('Rapid rate X (mm/min)');
    expect(mm['rapid.C']).toBe('Rapid rate C (degrees/min)');
    expect(mm.maxFeed).toBe('Top cutting feed (mm/min)');
    expect(mm.peckRetract).toBe('Retract of a high-speed peck, G73 (mm)');
    expect(mm['travel.X.min']).toBe('Travel X, lowest (mm)');
    expect(mm['travel.A.max']).toBe('Travel A, highest (degrees)');
    expect(mm.toolChange).toBe('Tool change time (seconds)');
    expect(mm['spindle.main']).toBe('Main spindle (rpm)');
    const inch = labels({ units: 'inch' });
    expect(inch['rapid.X']).toBe('Rapid rate X (inch/min)');
    expect(inch.peckClearance).toBe('Clearance of a deep peck, G83 (inch)');
    expect(inch['travel.Z.max']).toBe('Travel Z, highest (inch)');
  });

  it('says "per minute" and "chosen unit" until a unit is chosen', () => {
    const none = labels({ units: '' });
    expect(none['rapid.X']).toBe('Rapid rate X (per minute)');
    expect(none.peckRetract).toContain('(chosen unit)');
  });

  it('renders the label of the chosen unit', () => {
    expect(markup({ ...EMPTY, units: 'inch' })).toContain('Rapid rate X (inch/min)');
  });
});

describe('MachineMotionForm: values and errors', () => {
  it('shows the stored values', () => {
    const html = markup(motionToValues({ units: 'mm', rapid: { X: 30000 }, maxFeed: 9000 }, { spindle: { main: 6000, S2: 3000 } }));
    expect(html).toContain('value="30000"');
    expect(html).toContain('value="9000"');
    expect(html).toContain('value="6000"');
    expect(html).toContain('value="S2=3000"');
  });

  it('shows an error next to the field, with the bound in the unit', () => {
    const html = markup({ ...EMPTY, units: 'inch', maxFeed: 9000, toolChange: 700 });
    expect(html).toContain('data-error="machines.motion.err.above0"');
    expect(html).toContain('Enter a number above 0 and at most 7,874.01.');
    expect(html).toContain('data-error="machines.motion.err.from0"');
    expect(html).toContain('Enter a number, 0 or more and at most 600.');
  });

  it('asks for the units once a length is typed', () => {
    const html = markup({ ...EMPTY, maxFeed: 5000 });
    expect(html).toContain('data-error="machines.motion.err.units"');
    expect(html).toContain('Choose mm or inch first');
  });

  it('motionErrors is blockIssues in the form FormRenderer shows', () => {
    expect(motionErrors({ ...EMPTY, [MV.travelMin('X')]: 5, [MV.travelMax('X')]: 5, units: 'mm' }, MILL)).toEqual({
      [MV.travelMax('X')]: { key: 'machines.motion.err.minMax' },
    });
    expect(motionErrors(EMPTY, MILL)).toEqual({});
    for (const issue of Object.values(motionErrors({ ...EMPTY, maxFeed: -1, units: 'mm', [MV.spindleOthers]: 'x' }, MILL))) {
      expect(t(issue.key, issue.params)).not.toBe(issue.key); // every key is in the catalog
    }
  });
});

describe('MachineMotionForm: a stored block that cannot be used', () => {
  const problems = ['machines[2].params.motion.maxFeed: the top feed is a number of mm/min above 0 and at most 200,000'];

  it('lists the problems with their paths, and says the block is kept', () => {
    const html = markup(motionToValues({ units: 'mm', maxFeed: -5 }, undefined), { problems, onStartAgain: () => {} });
    expect(html).toContain('data-testid="motion-problems"');
    expect(html).toContain('machines[2].params.motion.maxFeed');
    expect(html).toContain('This block is kept as written but cannot be used');
    expect(html).toContain('data-testid="motion-start-again"');
    expect(html).toContain('Start this page again');
    // the bad value is shown in its field, with the field's own error
    expect(html).toContain('value="-5"');
  });

  it('shows no start-again button when the page cannot offer it', () => {
    expect(markup(EMPTY, { problems })).not.toContain('data-testid="motion-start-again"');
  });
});

describe('MachineMotionForm: ids next to the machine form', () => {
  it('prefixes every control id so the page never repeats an id of the machine form (its own units field)', () => {
    const html = markup(EMPTY);
    expect(html).toContain('id="motion-field-units"');
    expect(html).toContain('id="motion-field-units-help"');
    expect(html).not.toMatch(/id="field-/);
    expect(html).not.toMatch(/for="field-/);
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('MachineMotionForm: the X travel of a lathe is a diameter', () => {
  const travel = (o: { axes: string[]; angular: string[]; diameter?: string[] }) =>
    Object.fromEntries(motionFieldGroups({ units: 'mm' }, o).travel.map((f) => [f.id, f]));

  it('says diameter in the label and the help of the X travel on a lathe, and of no other axis', () => {
    const lathe = travel({ ...LATHE, diameter: ['X', 'U'] });
    expect(lathe['travel.X.min']!.label).toBe('Travel X (diameter), lowest (mm)');
    expect(lathe['travel.X.max']!.label).toBe('Travel X (diameter), highest (mm)');
    expect(lathe['travel.X.min']!.help).toContain('X is a diameter');
    expect(lathe['travel.Z.min']!.label).toBe('Travel Z, lowest (mm)');
    expect(lathe['travel.Z.min']!.help).toBeUndefined();
    expect(lathe['travel.C.max']!.label).toBe('Travel C, highest (degrees)');
  });

  it('keeps the plain label on a mill, and on a machine page that passes no diameter words', () => {
    for (const mill of [travel(MILL), travel({ ...MILL, diameter: [] })]) {
      expect(mill['travel.X.min']!.label).toBe('Travel X, lowest (mm)');
      expect(mill['travel.X.min']!.help).toBeUndefined();
    }
  });

  it('shows the lathe wording in the rendered form and not the mill one', () => {
    const lathe = markup(EMPTY, { axes: LATHE.axes, angular: LATHE.angular, diameter: ['X', 'U'] });
    expect(lathe).toContain('Travel X (diameter), lowest');
    expect(lathe).toContain('enter the travel as a diameter');
    expect(markup(EMPTY)).not.toContain('(diameter)');
  });
});
