// The machine dialog's fields and the status item's summary (plan §7.15, AD-31; WP6.10).
//
// The fields are generated from the profile's own declaration, so the tests run against
// the **built-in declarations** rather than a hand-written one: a preset or a variant that
// WP6.2 adds to the data has to arrive in the form without a line of code here.
//
// Three properties matter more than the shape of any single field:
//   - only `text`, `choice` and `bool` are used (F46: no new `FieldType`);
//   - a number rule the form cannot express survives an edit ("Custom", §7.15);
//   - a power-on code is only ever offered when the chosen database really has it, and
//     taking one away hands it back so the page can say so (AD-31).

import { describe, expect, it } from 'vitest';
import {
  CUSTOM_PRESET,
  DIAMETER_WORDS_KEY,
  FIELD_DIAMETER,
  FIELD_NAME,
  FIELD_NOTES,
  FIELD_NUMBER_INPUT,
  FIELD_POINTLESS_FEEDS,
  FIELD_UNITS,
  PROFILE_DEFAULT,
  diameterLabel,
  groupCodes,
  machineFields,
  machineFromValues,
  machineSummaryLines,
  machineTooltip,
  modalFieldId,
  modalGroupOf,
  presetIdOf,
  presetOf,
  pointlessFeedsIdOf,
  pruneModalValues,
  followVariantDefaults,
  variantFieldId,
  variantIdOf,
} from './fields';
import { effectiveMachine, noMachine } from './effective';
import { codes } from '$lib/stores/codes';
import { profiles } from '$lib/stores/profiles';
import { valueOf } from './numbers';
import { parseNumber } from '$lib/core/nc/numbers';
import { initialValues } from '$lib/core/forms/values';
import { validateFields } from '$lib/core/forms/validate';
import { hasKey, t } from '$lib/i18n';
import type { FieldSpec } from '$lib/core/forms/types';
import type { MachineConfig, NumberInput } from './types';
import type { MachineParamsDecl } from '$lib/core/profiles/types';

/** The profiles that declare machine parameters, which is what the page offers. */
const WITH_PARAMS = profiles.list().filter((info) => info.hasMachineParams);

const declOf = (id: string): MachineParamsDecl => {
  const decl = profiles.profile(id).machineParams;
  if (decl === undefined) throw new Error(`${id} declares no machine parameters`);
  return decl;
};

const dbOf = (id: string) => codes.byId(profiles.profile(id).codes);

const byId = (fields: FieldSpec[], id: string): FieldSpec | undefined =>
  fields.find((field) => field.id === id);

function machine(over: Partial<MachineConfig> = {}): MachineConfig {
  return {
    id: 'lathe-2',
    name: 'Lathe 2',
    profile: 'fanuc-lathe',
    params: {},
    ...over,
  };
}

describe('machineFields over every built-in declaration', () => {
  it('finds at least the mill and the lathe', () => {
    expect(WITH_PARAMS.map((info) => info.id)).toContain('fanuc-gcode');
    expect(WITH_PARAMS.map((info) => info.id)).toContain('fanuc-lathe');
  });

  for (const info of WITH_PARAMS) {
    describe(info.id, () => {
      const fields = machineFields(declOf(info.id), dbOf(info.id));

      it('uses only the field types §7.5 already has (F46)', () => {
        for (const field of fields) expect(['text', 'choice', 'bool']).toContain(field.type);
      });

      it('asks for a name first and for notes last', () => {
        expect(fields[0].id).toBe(FIELD_NAME);
        expect(fields[0].required).toBe(true);
        expect(fields[fields.length - 1].id).toBe(FIELD_NOTES);
      });

      it('gives every field a label and every choice field its options', () => {
        for (const field of fields) {
          expect(field.label).not.toBe('');
          if (field.type === 'choice') expect((field.choices ?? []).length).toBeGreaterThan(0);
        }
      });

      it('starts from values that only lack the name the user has to type', () => {
        const values = initialValues(fields);
        expect(validateFields(fields, values)).toEqual({ [FIELD_NAME]: { key: 'forms.errors.required' } });
        expect(validateFields(fields, { ...values, [FIELD_NAME]: 'Machine 1' })).toEqual({});
      });

      it('offers one choice per declared preset', () => {
        const declared = declOf(info.id).numberInput;
        if (declared === undefined) {
          expect(byId(fields, FIELD_NUMBER_INPUT)).toBeUndefined();
          return;
        }
        const field = byId(fields, FIELD_NUMBER_INPUT);
        expect(field?.choices?.map((choice) => choice.value)).toEqual(
          declared.presets.map((preset) => preset.id),
        );
        // The label says what the preset does to a number; it is data, not a key.
        expect(field?.choices?.every((choice) => choice.label.length > 10)).toBe(true);
        expect(field?.default).toBe(declared.default);
      });

      it('offers the units, and the diameter only where it is a parameter', () => {
        expect(byId(fields, FIELD_UNITS)?.choices?.map((c) => c.value)).toEqual(['mm', 'inch']);
        expect(byId(fields, FIELD_DIAMETER) !== undefined).toBe(
          declOf(info.id).diameter !== undefined,
        );
      });

      it('offers one choice per variant and per modal group the database has codes for', () => {
        const decl = declOf(info.id);
        for (const variant of decl.variants ?? []) {
          const field = byId(fields, variantFieldId(variant.id));
          expect(field?.type).toBe('choice');
          expect(field?.choices?.map((choice) => choice.value)).toEqual(
            variant.choices.map((choice) => choice.value),
          );
          expect(field?.default).toBe(variant.default);
        }
        for (const group of decl.modalGroups ?? []) {
          const field = byId(fields, modalFieldId(group));
          const entries = groupCodes(dbOf(info.id), group);
          if (entries.length === 0) {
            expect(field).toBeUndefined();
            continue;
          }
          // "Dialect default" first, then the group's codes, and nothing else.
          expect(field?.choices?.map((choice) => choice.value)).toEqual([
            PROFILE_DEFAULT,
            ...entries.map((entry) => entry.code),
          ]);
          expect(field?.default).toBe(PROFILE_DEFAULT);
        }
      });
    });
  }
});

describe('the lathe, whose form is the one M6 ships for', () => {
  const decl = declOf('fanuc-lathe');
  const dbA = codes.byId('fanuc-lathe');
  const dbB = codes.byId('fanuc-lathe-b');

  it('offers the feed modes of the G-code system the database belongs to', () => {
    const inA = byId(machineFields(decl, dbA), modalFieldId('feedmode'))?.choices?.map((c) => c.value);
    const inB = byId(machineFields(decl, dbB), modalFieldId('feedmode'))?.choices?.map((c) => c.value);
    // System A reads G98/G99 as the feed modes; in system B they are cycle-return codes
    // and G95 is the feed per revolution. Offering B's list to an A machine would set a
    // power-on feed mode no code of A's own database can produce.
    expect(inA).toContain('G99');
    expect(inB).not.toContain('G99');
    expect(inB).toContain('G95');
    // Every list starts with "Dialect default", and every entry is a modal code.
    expect(inA?.[0]).toBe(PROFILE_DEFAULT);
    expect(inB?.[0]).toBe(PROFILE_DEFAULT);
  });

  it('shows the diameter parameter, the G-code system and the stored values of a machine', () => {
    const current = machine({
      params: {
        diameter: 'off',
        variants: { gcodeSystem: 'B' },
        modalInitial: { feedmode: 'G95' },
        units: 'inch',
      },
    });
    const fields = machineFields(decl, dbB, current);
    expect(byId(fields, FIELD_NAME)?.default).toBe('Lathe 2');
    expect(byId(fields, FIELD_DIAMETER)?.default).toBe(false);
    expect(byId(fields, FIELD_UNITS)?.default).toBe('inch');
    expect(byId(fields, variantFieldId('gcodeSystem'))?.default).toBe('B');
    expect(byId(fields, modalFieldId('feedmode'))?.default).toBe('G95');
  });

  it('ignores a stored variant or power-on code the declaration does not know', () => {
    const current = machine({
      params: { variants: { gcodeSystem: 'C' }, modalInitial: { feedmode: 'G99' } },
    });
    const fields = machineFields(decl, dbB, current);
    expect(byId(fields, variantFieldId('gcodeSystem'))?.default).toBe('A');
    // `G99` is no feed mode of system B's database, so the form does not claim it is set.
    expect(byId(fields, modalFieldId('feedmode'))?.default).toBe(PROFILE_DEFAULT);
  });
});

// M8 integration: the two turning dialects M8 adds, as the machine form offers them. The
// unit system of an Okuma machine and the diameter mode of a Sinumerik one are machine
// parameters (owner decisions D34, D35), so the form is where the owner corrects them.
describe('the turning dialects of M8', () => {
  it('offers the three Okuma unit systems, with 1 mm as the assumed default', () => {
    const field = byId(machineFields(declOf('okuma-osp'), dbOf('okuma-osp')), FIELD_NUMBER_INPUT);
    expect(field?.choices?.map((choice) => choice.value)).toEqual(['okuma-1mm', 'okuma-1um', 'okuma-10um']);
    expect(field?.default).toBe('okuma-1mm');
  });

  it('starts a Sinumerik machine with diameter programming on, and keeps a machine that has it off', () => {
    const decl = declOf('sinumerik');
    expect(byId(machineFields(decl, dbOf('sinumerik')), FIELD_DIAMETER)?.default).toBe(true);
    const off = machine({ profile: 'sinumerik', params: { diameter: 'off' } });
    expect(byId(machineFields(decl, dbOf('sinumerik'), off), FIELD_DIAMETER)?.default).toBe(false);
  });

  // G8 M8 review: the label said "X and U are diameters" on the two turning dialects that
  // read only X as one, and on Okuma U is a finish allowance. The label names the words of
  // the profile's own `addresses.diameter` now, and hands their count to the message, which
  // decides how to say it for one word and for two. Until that message is there, the plain
  // one stands, so nothing reads `{words}`.
  it('names the words the profile reads as diameters, and only those', () => {
    const wordsOf = (id: string): string[] => profiles.profile(id).addresses.diameter ?? [];
    expect(wordsOf('okuma-osp')).toEqual(['X']);
    expect(wordsOf('sinumerik')).toEqual(['X']);
    expect(wordsOf('fanuc-lathe')).toEqual(['X', 'U']);
    const named = hasKey(DIAMETER_WORDS_KEY);
    const joined: Record<string, string> = { 'okuma-osp': 'X', sinumerik: 'X', 'fanuc-lathe': 'X and U' };
    for (const [id, words] of Object.entries(joined)) {
      const list = wordsOf(id);
      const want = named ? t(DIAMETER_WORDS_KEY, { words, count: list.length }) : t('machines.param.diameter');
      expect(want, id).not.toContain('{');
      if (named) expect(want, id).toContain(words);
      expect(diameterLabel(list), id).toBe(want);
      expect(byId(machineFields(declOf(id), dbOf(id), undefined, list), FIELD_DIAMETER)?.label, id).toBe(want);
      const summary = machineSummaryLines(noMachine(profiles.profile(id)), declOf(id), undefined, list);
      expect(summary.some((entry) => entry.startsWith(`${want}: `)), id).toBe(true);
      expect(machineTooltip(noMachine(profiles.profile(id)), declOf(id), undefined, list), id).toContain(`${want}: `);
    }
    // A caller that has no words gets the message as it is written.
    expect(diameterLabel()).toBe(t('machines.param.diameter'));
    expect(diameterLabel([])).toBe(t('machines.param.diameter'));
  });

  it('offers the power-on groups each turning database has codes for', () => {
    const okuma = machineFields(declOf('okuma-osp'), dbOf('okuma-osp')).map((field) => field.id);
    expect(okuma).toContain(modalFieldId('feedmode'));
    const sinumerik = machineFields(declOf('sinumerik'), dbOf('sinumerik')).map((field) => field.id);
    expect(sinumerik).toContain(modalFieldId('plane'));
  });
});

describe('a number rule the form cannot express', () => {
  const decl = declOf('fanuc-lathe');
  const handEdited: NumberInput = {
    mode: 'increment',
    incrementMm: '0.001',
    classes: { feedPerRev: { mode: 'calculator' }, length: { increment: '0.002' } },
  };

  it('is recognised as custom rather than as a preset', () => {
    expect(presetOf(decl, handEdited)).toBeNull();
    expect(presetIdOf(decl, machine({ params: { numberInput: handEdited } }))).toBe(CUSTOM_PRESET);
  });

  it('is offered as "Custom (edited in the file)" and selected', () => {
    const fields = machineFields(decl, dbOf('fanuc-lathe'), machine({ params: { numberInput: handEdited } }));
    const field = byId(fields, FIELD_NUMBER_INPUT);
    expect(field?.choices?.map((choice) => choice.value)).toContain(CUSTOM_PRESET);
    expect(field?.default).toBe(CUSTOM_PRESET);
  });

  it('is kept when the form comes back with "custom" still selected', () => {
    const current = machine({ params: { numberInput: handEdited } });
    const fields = machineFields(decl, dbOf('fanuc-lathe'), current);
    const values = initialValues(fields);
    expect(machineFromValues(decl, values, current).params.numberInput).toEqual(handEdited);
  });

  it('is replaced, whole, as soon as a preset is picked', () => {
    const current = machine({ params: { numberInput: handEdited } });
    const fields = machineFields(decl, dbOf('fanuc-lathe'), current);
    const values = { ...initialValues(fields), [FIELD_NUMBER_INPUT]: 'is-b' };
    const preset = (decl.numberInput?.presets ?? []).find((entry) => entry.id === 'is-b');
    // The machine stores the preset's whole rule set, not a reference to it (§7.15).
    expect(machineFromValues(decl, values, current).params.numberInput).toEqual(preset?.value);
  });

  it('is not offered as a choice for a machine that has no such rules', () => {
    const fields = machineFields(decl, dbOf('fanuc-lathe'));
    expect(byId(fields, FIELD_NUMBER_INPUT)?.choices?.map((c) => c.value)).not.toContain(CUSTOM_PRESET);
  });
});

describe('machineFromValues', () => {
  const decl = declOf('fanuc-lathe');
  const fields = machineFields(decl, dbOf('fanuc-lathe'));
  const base = initialValues(fields);

  it('trims the name and the notes and keeps them apart from the parameters', () => {
    const built = machineFromValues(decl, { ...base, name: '  Lathe 2 ', notes: ' spindle 2 ' });
    expect(built.name).toBe('Lathe 2');
    expect(built.notes).toBe('spindle 2');
    expect(Object.keys(built.params)).not.toContain('name');
  });

  it('writes the units, the diameter and the chosen variant', () => {
    const built = machineFromValues(decl, {
      ...base,
      [FIELD_UNITS]: 'inch',
      [FIELD_DIAMETER]: false,
      [variantFieldId('gcodeSystem')]: 'B',
    });
    expect(built.params.units).toBe('inch');
    expect(built.params.diameter).toBe('off');
    expect(built.params.variants).toMatchObject({ gcodeSystem: 'B' });
  });

  it('leaves out a power-on group left at the dialect default, and drops one taken back', () => {
    const set = machineFromValues(decl, { ...base, [modalFieldId('feedmode')]: 'G99' });
    expect(set.params.modalInitial).toEqual({ feedmode: 'G99' });

    const current = machine({ params: { modalInitial: { feedmode: 'G99' } } });
    const cleared = machineFromValues(decl, { ...base, [modalFieldId('feedmode')]: PROFILE_DEFAULT }, current);
    expect(cleared.params.modalInitial).toBeUndefined();
  });

  it('keeps a member the form never showed', () => {
    // `channels` arrives in M10 (AD-32) and no field of M6 knows it; editing a name may
    // not delete it.
    const current = machine({
      params: { ...({ channels: { layout: 'none' } } as Record<string, unknown>) },
    });
    const built = machineFromValues(decl, { ...base, name: 'Renamed' }, current);
    expect((built.params as Record<string, unknown>).channels).toEqual({ layout: 'none' });
  });

  it('does not alias the record it was given', () => {
    const current = machine({ params: { variants: { gcodeSystem: 'A' } } });
    const built = machineFromValues(decl, { ...base, [variantFieldId('gcodeSystem')]: 'B' }, current);
    expect(built.params.variants).toMatchObject({ gcodeSystem: 'B' });
    expect(current.params.variants).toEqual({ gcodeSystem: 'A' });
  });
});

// v1.2.0 manual-check fix round (D5-3): in G-code system B the U/W field defaults to "none".
describe('a variant default that follows another (defaultBy)', () => {
  const lathe = declOf('fanuc-lathe');
  const inc = variantFieldId('incrementalAddresses');
  const sys = variantFieldId('gcodeSystem');

  it('is the form default of a machine in system B that has no choice stored', () => {
    const stored = machine({ params: { variants: { gcodeSystem: 'B' } } });
    expect(byId(machineFields(lathe, dbOf('fanuc-lathe'), stored), inc)?.default).toBe('none');
    expect(byId(machineFields(lathe, dbOf('fanuc-lathe')), inc)?.default).toBe('uw');
    const chosen = machine({ params: { variants: { gcodeSystem: 'B', incrementalAddresses: 'uwvh' } } });
    expect(byId(machineFields(lathe, dbOf('fanuc-lathe'), chosen), inc)?.default).toBe('uwvh');
  });

  it('moves with a switch of the G-code system, but not a value chosen by hand', () => {
    const before = initialValues(machineFields(lathe, dbOf('fanuc-lathe')));
    const after: Record<string, unknown> = { ...before, [sys]: 'B' };
    expect(followVariantDefaults(lathe, sys, before, after)).toEqual([inc]);
    expect(after[inc]).toBe('none');
    const back: Record<string, unknown> = { ...after, [sys]: 'A' };
    followVariantDefaults(lathe, sys, after, back);
    expect(back[inc]).toBe('uw');
    const byHand: Record<string, unknown> = { ...before, [inc]: 'uwvh' };
    const switched: Record<string, unknown> = { ...byHand, [sys]: 'B' };
    expect(followVariantDefaults(lathe, sys, byHand, switched)).toEqual([]);
    expect(switched[inc]).toBe('uwvh');
    // Another field moves nothing.
    expect(followVariantDefaults(lathe, inc, before, { ...before })).toEqual([]);
  });
});

describe('pruneModalValues', () => {
  const decl = declOf('fanuc-lathe');

  it('takes back a power-on code the newly chosen database does not have, and says which', () => {
    const values: Record<string, unknown> = { [modalFieldId('feedmode')]: 'G99' };
    const dropped = pruneModalValues(values, machineFields(decl, codes.byId('fanuc-lathe-b')));
    expect(dropped).toEqual(['G99']);
    expect(values[modalFieldId('feedmode')]).toBe(PROFILE_DEFAULT);
  });

  it('leaves a code the new database still has', () => {
    const values: Record<string, unknown> = { [modalFieldId('feedmode')]: 'G94' };
    expect(pruneModalValues(values, machineFields(decl, codes.byId('fanuc-lathe-b')))).toEqual([]);
    expect(values[modalFieldId('feedmode')]).toBe('G94');
  });

  it('never touches a field that is not a power-on group', () => {
    const values: Record<string, unknown> = { [FIELD_NAME]: 'Lathe 2', [FIELD_UNITS]: 'inch' };
    expect(pruneModalValues(values, machineFields(decl, codes.byId('fanuc-lathe')))).toEqual([]);
    expect(values[FIELD_UNITS]).toBe('inch');
  });
});

describe('field ids', () => {
  it('say which variant and which group they belong to', () => {
    expect(variantIdOf(variantFieldId('gcodeSystem'))).toBe('gcodeSystem');
    expect(modalGroupOf(modalFieldId('feedmode'))).toBe('feedmode');
    expect(variantIdOf(FIELD_NAME)).toBeNull();
    expect(modalGroupOf(variantFieldId('gcodeSystem'))).toBeNull();
  });
});

describe('the summary the status item shows', () => {
  const profile = profiles.profile('fanuc-lathe');
  const decl = declOf('fanuc-lathe');

  it('names every parameter as assumed while no machine is chosen', () => {
    const lines = machineSummaryLines(noMachine(profile), decl);
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) expect(line).toContain('dialect default, assumed');
    expect(lines.join('\n')).toContain('G-code system A');
  });

  it('names the power-on state the dialect assumes, which is the F reading of the program', () => {
    // G8 M6. With no machine, `params.modalInitial` is empty and the summary said nothing
    // about the assumed `G99` — although a turning program that never writes a feed mode
    // has every one of its feeds read per revolution because of it. The dialect's own
    // `modal.initial` is handed in now, and each group carries its source.
    const none = machineSummaryLines(noMachine(profile), decl, profile.modal?.initial);
    expect(none).toContain('Feed mode at power-on: G99 — dialect default, assumed');
    expect(none).toContain('Spindle-speed mode at power-on: G97 — dialect default, assumed');
    expect(none).toContain('Plane at power-on: G18 — dialect default, assumed');

    // A machine that sets one of them shadows the dialect there and nowhere else.
    const eff = effectiveMachine(profile, machine({ params: { modalInitial: { feedmode: 'G98' } } }), 'document', {});
    const text = machineSummaryLines(eff, decl, profile.modal?.initial);
    expect(text).toContain('Feed mode at power-on: G98 — set by the machine');
    expect(text).toContain('Spindle-speed mode at power-on: G97 — dialect default, assumed');
    expect(text.filter((line) => line.startsWith('Feed mode at power-on'))).toHaveLength(1);
  });

  it('names the machine as the source of what the machine sets', () => {
    const eff = effectiveMachine(
      profile,
      machine({
        params: {
          units: 'inch',
          diameter: 'off',
          variants: { gcodeSystem: 'B' },
          modalInitial: { feedmode: 'G95' },
        },
      }),
      'document',
      {},
    );
    const text = machineSummaryLines(eff, decl).join('\n');
    expect(text).toContain('G-code system B — set by the machine');
    expect(text).toContain('Inches — set by the machine');
    expect(text).toContain('off — set by the machine');
    expect(text).toContain('G95 — set by the machine');
  });

  it('says when a variant was detected rather than chosen', () => {
    const eff = effectiveMachine(profile, null, 'none', { gcodeSystem: { value: 'B', margin: 4 } });
    expect(machineSummaryLines(eff, decl).join('\n')).toContain(
      'G-code system B — detected in this program',
    );
  });

  it('puts the machine, its parameters and what a click does into the tooltip', () => {
    const eff = effectiveMachine(profile, machine(), 'document', {});
    const tooltip = machineTooltip(eff, decl);
    expect(tooltip.split('\n')[0]).toBe('Machine: Lathe 2');
    expect(tooltip).toContain('Click to choose a machine.');
    expect(machineTooltip(noMachine(profile), decl)).toContain('No machine.');
  });

  it('answers for a dialect that declares nothing at all', () => {
    const klartext = profiles.profile('heidenhain-klartext');
    const lines = machineSummaryLines(noMachine(klartext), klartext.machineParams);
    // No number rules to show, but the units are still a value with a source.
    expect(lines.some((line) => line.includes('Millimetres'))).toBe(true);
  });
});

describe('presets nobody has confirmed (B1 A4)', () => {
  it('say so in plain words, and only those', () => {
    let seen = 0;
    for (const info of WITH_PARAMS) {
      const decl = declOf(info.id);
      const field = byId(machineFields(decl, dbOf(info.id), undefined), FIELD_NUMBER_INPUT);
      for (const preset of decl.numberInput?.presets ?? []) {
        const choice = field?.choices?.find((entry) => entry.value === preset.id);
        const flagged = choice?.label.endsWith(`(${t('machines.value.unconfirmed')})`);
        expect(flagged, `${info.id}/${preset.id}`).toBe(preset.verify === true);
        if (preset.verify === true) {
          seen++;
          expect(choice?.label.startsWith(preset.label)).toBe(true);
          expect(field?.help).toContain(t('machines.param.numberInputUnconfirmed'));
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('keeps the Fanuc mill label short and true', () => {
    const preset = (declOf('fanuc-gcode').numberInput?.presets ?? []).find((p) => p.id === 'calculator');
    expect(preset?.label).toBe('As written: X50 and X50. are both 50 mm');
  });
});

// T084 (the owner's decision of 2026-10-19): "Point-less feeds" is a machine option on the
// Machines page, beside the number-input preset. The machine stores the steps in its own number
// rules, so every reader (numbers.ts, _nc_machine.py and the scripts) reads them without
// knowing the option; with no machine it is never assumed.
describe('the point-less feeds option (T084)', () => {
  it('has a help text that names no one step, since the choices differ between mill and lathe (manual-check D4-1, D4-2)', () => {
    const help = t('machines.param.pointlessFeedsHelp');
    expect(help).not.toMatch(/\d\.\d/);
    for (const id of ['fanuc-gcode', 'fanuc-lathe']) {
      expect(byId(machineFields(declOf(id), dbOf(id)), FIELD_POINTLESS_FEEDS)?.help, id).toBe(help);
    }
  });

  const mill = declOf('fanuc-gcode');
  const lathe = declOf('fanuc-lathe');
  const choicesOf = (decl: MachineParamsDecl) => (decl.numberInput?.pointlessFeeds?.choices ?? []).map((c) => c.value);
  const F = (text: string) => parseNumber(text)!;
  const presetValue = (decl: MachineParamsDecl, id: string): NumberInput =>
    structuredClone(decl.numberInput!.presets.find((preset) => preset.id === id)!.value);

  it('is offered on both Fanuc profiles, after the number-input preset, with the default first', () => {
    for (const decl of [mill, lathe]) {
      const fields = machineFields(decl, dbOf('fanuc-gcode'));
      const ids = fields.map((field) => field.id);
      expect(ids.indexOf(FIELD_POINTLESS_FEEDS)).toBe(ids.indexOf(FIELD_NUMBER_INPUT) + 1);
      const field = byId(fields, FIELD_POINTLESS_FEEDS);
      expect(field?.type).toBe('choice');
      expect(field?.label).toBe('Point-less feeds');
      // Manual-check fix D4-2: each profile states the choices its control has.
      expect(field?.choices?.map((choice) => choice.value)).toEqual(choicesOf(decl));
      expect(field?.choices?.[0].value).toBe('standard');
      expect(field?.default).toBe('standard');
      // A documented default nobody has confirmed: every choice says so.
      for (const choice of field?.choices ?? []) expect(choice.label).toContain('(unconfirmed)');
    }
  });

  it('D4-2: the lathe offers its own choices, independent of the mill', () => {
    expect(choicesOf(lathe)).toEqual(['standard', 'per-minute', 'series-15', 'both']);
    expect(lathe.numberInput?.pointlessFeeds?.choices).not.toEqual(mill.numberInput?.pointlessFeeds?.choices);
  });

  it('is not offered where the profile declares no such option', () => {
    for (const id of ['okuma-osp', 'sinumerik']) {
      expect(choicesOf(declOf(id))).toEqual([]);
      expect(byId(machineFields(declOf(id), dbOf(id)), FIELD_POINTLESS_FEEDS)).toBeUndefined();
    }
  });

  it('writes the chosen steps into the machine number rules, and the reading follows', () => {
    // Manual-check fix D4-2: on the lathe, whose choices name the per-minute feed (the mill
    // has none for it).
    const values = { ...initialValues(machineFields(lathe, dbOf('fanuc-lathe'))), [FIELD_NAME]: 'Lathe 1' };
    const plain = machineFromValues(lathe, { ...values, [FIELD_NUMBER_INPUT]: 'is-b' }).params.numberInput!;
    expect(plain).toEqual(presetValue(lathe, 'is-b'));
    expect(valueOf(F('200'), 'feedPerMin', { numberInput: plain } as never, 'mm')).toBe('200');
    // D4-1: a point-less feed per revolution in 0.0001 mm/rev on the lathe.
    expect(valueOf(F('12345'), 'feedPerRev', { numberInput: plain } as never, 'mm')).toBe('1.2345');

    const perMinute = machineFromValues(lathe, { ...values, [FIELD_NUMBER_INPUT]: 'is-b', [FIELD_POINTLESS_FEEDS]: 'per-minute' })
      .params.numberInput!;
    expect(perMinute.classes?.feedPerMin).toEqual({ mode: 'increment', increment: '0.001', incrementInch: '0.00001' });
    expect(perMinute.classes?.feedPerRev).toEqual(presetValue(lathe, 'is-b').classes?.feedPerRev);
    expect(valueOf(F('200'), 'feedPerMin', { numberInput: perMinute } as never, 'mm')).toBe('0.2');
    expect(valueOf(F('200'), 'feedPerMin', { numberInput: perMinute } as never, 'inch')).toBe('0.002');
    expect(valueOf(F('2500'), 'feedPerRev', { numberInput: perMinute } as never, 'mm')).toBe('0.25');
    // A feed with a point is as written, and a length keeps its step.
    expect(valueOf(F('200.'), 'feedPerMin', { numberInput: perMinute } as never, 'mm')).toBe('200');
    expect(valueOf(F('50'), 'length', { numberInput: perMinute } as never, 'mm')).toBe('0.05');
    // Inverse-time and per-tooth feeds stay without a value (no machine declares them).
    expect(valueOf(F('125'), 'inverseTime', { numberInput: perMinute } as never, 'mm')).toBeNull();
    expect(valueOf(F('12'), 'feedPerTooth', { numberInput: perMinute } as never, 'mm')).toBeNull();

    // "both": the per-minute thousandths and the Series 15 format of the feed per revolution.
    const both = machineFromValues(lathe, { ...values, [FIELD_NUMBER_INPUT]: 'is-a', [FIELD_POINTLESS_FEEDS]: 'both' })
      .params.numberInput!;
    expect(valueOf(F('25'), 'feedPerRev', { numberInput: both } as never, 'mm')).toBe('0.25');
    expect(valueOf(F('25'), 'feedPerRev', { numberInput: both } as never, 'inch')).toBe('0.0025');
    expect(valueOf(F('200'), 'feedPerMin', { numberInput: both } as never, 'mm')).toBe('0.2');
  });

  it('changes nothing under "as written": calculator-type input reads every feed as written', () => {
    const values = { [FIELD_NAME]: 'Lathe 1', [FIELD_NUMBER_INPUT]: 'calculator', [FIELD_POINTLESS_FEEDS]: 'both' };
    expect(machineFromValues(lathe, values).params.numberInput).toEqual(presetValue(lathe, 'calculator'));
  });

  it('reads a stored machine back as its preset and its choice, not as "Custom"', () => {
    const values = { [FIELD_NAME]: 'Mill 1', [FIELD_NUMBER_INPUT]: 'is-c', [FIELD_POINTLESS_FEEDS]: 'per-rev' };
    const stored = machine({ profile: 'fanuc-gcode', params: machineFromValues(mill, values).params });
    expect(presetIdOf(mill, stored)).toBe('is-c');
    expect(presetOf(mill, stored.params.numberInput)?.id).toBe('is-c');
    expect(pointlessFeedsIdOf(mill, stored)).toBe('per-rev');
    const fields = machineFields(mill, dbOf('fanuc-gcode'), stored);
    expect(byId(fields, FIELD_NUMBER_INPUT)?.default).toBe('is-c');
    expect(byId(fields, FIELD_POINTLESS_FEEDS)?.default).toBe('per-rev');
    // An edit of the name keeps the choice.
    const again = machineFromValues(mill, { ...initialValues(fields), [FIELD_NAME]: 'Mill 2' }, stored);
    expect(again.params.numberInput).toEqual(stored.params.numberInput);
  });

  it('leaves a hand-written rule set alone and does not offer the option over it', () => {
    const custom: NumberInput = { mode: 'increment', incrementMm: '0.001', classes: { feedPerMin: { increment: '0.1' } } };
    const stored = machine({ profile: 'fanuc-gcode', params: { numberInput: custom } });
    expect(presetIdOf(mill, stored)).toBe(CUSTOM_PRESET);
    expect(byId(machineFields(mill, dbOf('fanuc-gcode'), stored), FIELD_POINTLESS_FEEDS)).toBeUndefined();
    const kept = machineFromValues(mill, { [FIELD_NAME]: 'x', [FIELD_NUMBER_INPUT]: CUSTOM_PRESET, [FIELD_POINTLESS_FEEDS]: 'both' }, stored);
    expect(kept.params.numberInput).toEqual(custom);
  });

  it('says in the summary how a point-less feed counts, with its source', () => {
    // Manual-check fix D4-2: the lathe's own choice (the mill has no per-minute one).
    const latheProfile = profiles.profile('fanuc-lathe');
    const values = { [FIELD_NAME]: 'Lathe 1', [FIELD_NUMBER_INPUT]: 'is-b', [FIELD_POINTLESS_FEEDS]: 'per-minute' };
    const eff = effectiveMachine(latheProfile, machine({ profile: 'fanuc-lathe', params: machineFromValues(lathe, values).params }), 'document', {});
    const lines = machineSummaryLines(eff, lathe);
    expect(lines).toContain(
      'How the control reads numbers: Increments of 0.001 mm (IS-B): X50 is 0.050 mm, X50. is 50 mm, C90000 is 90°; a point-less feed per minute in 1 mm/min (F200 is 200), per revolution and a thread lead in 0.0001 mm/rev (F2500 is 0.25 mm/rev) — set by the machine',
    );
    expect(lines).toContain(
      'Point-less feeds: Feed per minute in 0.001 mm/min (F200000 is 200 mm/min), feed per revolution and thread lead in 0.0001 mm/rev (F2500 is 0.25 mm/rev) — set by the machine',
    );
    // With no machine the default is listed as assumed; on "as written" there is no such line.
    const profile = profiles.profile('fanuc-gcode');
    const standard = mill.numberInput?.pointlessFeeds?.choices.find((c) => c.value === 'standard')?.label;
    expect(machineSummaryLines(noMachine(profile), mill).join('\n')).toContain(`Point-less feeds: ${standard} — dialect default, assumed`);
    const lathePlain = machineSummaryLines(noMachine(profiles.profile('fanuc-lathe')), lathe);
    expect(lathePlain.some((line) => line.startsWith('Point-less feeds'))).toBe(false);
  });
});

describe('machines stored before the point-less feeds options changed (review CODE-5)', () => {
  // The rule sets exactly as the shipped presets stored them before the manual-check fix
  // round: a machine keeps the whole rule set (§7.15), so these are what old files hold.
  const oldIncrement = (mm: string, inch: string, deg: string, perRev: { mm: string; inch: string }, perMin = { mm: '1', inch: '0.01' }): NumberInput => ({
    mode: 'increment',
    incrementMm: mm,
    incrementInch: inch,
    incrementDeg: deg,
    incrementSec: deg,
    classes: {
      feedPerMin: { mode: 'increment', increment: perMin.mm, incrementInch: perMin.inch },
      feedPerRev: { mode: 'increment', increment: perRev.mm, incrementInch: perRev.inch },
    },
  });
  const oldPerRev = { mm: '0.01', inch: '0.0001' };
  const latheDecl = declOf('fanuc-lathe');
  const millDecl = declOf('fanuc-gcode');

  it('an old lathe machine is its IS preset with "Series 15 format", and reads as before', () => {
    const olds: [string, NumberInput][] = [
      ['is-a', oldIncrement('0.01', '0.001', '0.01', oldPerRev)],
      ['is-b', oldIncrement('0.001', '0.0001', '0.001', oldPerRev)],
      ['is-c', oldIncrement('0.0001', '0.00001', '0.0001', oldPerRev)],
    ];
    for (const [id, value] of olds) {
      const stored = machine({ profile: 'fanuc-lathe', params: { numberInput: value } });
      expect(presetOf(latheDecl, value)?.id, id).toBe(id);
      expect(presetIdOf(latheDecl, stored), id).toBe(id);
      expect(pointlessFeedsIdOf(latheDecl, stored), id).toBe('series-15');
      const fields = machineFields(latheDecl, dbOf('fanuc-lathe'), stored);
      expect(byId(fields, FIELD_NUMBER_INPUT)?.default, id).toBe(id);
      expect(byId(fields, FIELD_POINTLESS_FEEDS)?.default, id).toBe('series-15');
      // Saving the form without a change keeps the old rules, number for number.
      const again = machineFromValues(latheDecl, { ...initialValues(fields), [FIELD_NAME]: 'Lathe 2' }, stored);
      expect(again.params.numberInput, id).toEqual(value);
    }
    // And the numbers read as before: a point-less feed per revolution in 0.01 mm/rev.
    const stored = olds[1][1];
    expect(valueOf(parseNumber('25')!, 'feedPerRev', { numberInput: stored } as never, 'mm')).toBe('0.25');
    expect(valueOf(parseNumber('200')!, 'feedPerMin', { numberInput: stored } as never, 'mm')).toBe('200');
  });

  it('an old mill machine with the per-minute or both choice shows "Custom", with no feeds choice beside it, and keeps its rules', () => {
    const perMin = { mm: '0.001', inch: '0.00001' };
    const olds: Record<string, NumberInput> = {
      'per-minute': oldIncrement('0.001', '0.0001', '0.001', oldPerRev, perMin),
      both: oldIncrement('0.001', '0.0001', '0.001', { mm: '0.001', inch: '0.00001' }, perMin),
    };
    for (const [choice, value] of Object.entries(olds)) {
      const stored = machine({ profile: 'fanuc-gcode', params: { numberInput: value } });
      expect(presetOf(millDecl, value), choice).toBeNull();
      expect(presetIdOf(millDecl, stored), choice).toBe(CUSTOM_PRESET);
      const fields = machineFields(millDecl, dbOf('fanuc-gcode'), stored);
      const numberInput = byId(fields, FIELD_NUMBER_INPUT);
      expect(numberInput?.default, choice).toBe(CUSTOM_PRESET);
      expect(numberInput?.help, choice).toBe(t('machines.value.customDetail'));
      // The form does not show a feeds choice ("Standard") the rules do not follow.
      expect(byId(fields, FIELD_POINTLESS_FEEDS), choice).toBeUndefined();
      // The summary says so too.
      const eff = effectiveMachine(profiles.profile('fanuc-gcode'), stored, 'document', {});
      const lines = machineSummaryLines(eff, millDecl);
      expect(lines.some((line) => line.startsWith(`${t('machines.param.numberInput')}: ${t('machines.value.custom')}`)), choice).toBe(true);
      expect(lines.some((line) => line.startsWith(t('machines.param.pointlessFeeds'))), choice).toBe(false);
      // Saving keeps the rules untouched.
      const again = machineFromValues(millDecl, { ...initialValues(fields), [FIELD_NAME]: 'Mill 2' }, stored);
      expect(again.params.numberInput, choice).toEqual(value);
    }
    // The old per-rev choice and the standard one still match a preset and a choice.
    const perRev = oldIncrement('0.001', '0.0001', '0.001', { mm: '0.001', inch: '0.00001' });
    expect(pointlessFeedsIdOf(millDecl, machine({ profile: 'fanuc-gcode', params: { numberInput: perRev } }))).toBe('per-rev');
    expect(pointlessFeedsIdOf(millDecl, machine({ profile: 'fanuc-gcode', params: { numberInput: oldIncrement('0.001', '0.0001', '0.001', oldPerRev) } }))).toBe('standard');
  });
});
