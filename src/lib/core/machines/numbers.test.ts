// How the control reads numbers (plan §7.15, AD-31). Owner: WP6.9.
//
// The table lives in `tests/fixtures/machines/numbers.json` because `_nc_machine.py` has
// to answer every case the same way (`tests/python/test_machine.py` reads the same file).
// A disagreement between the two implementations is a failure, not a rounding detail, so
// a case is added here and there or nowhere.
//
// The cases below the table are the ones that are about these functions' own edges rather
// than about a rule a machine declares.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CodeEntry } from '$lib/core/codes/types';
import { arcCentreEntry } from '$lib/core/codes/wordValue';
import type { NumericLiteral } from '$lib/core/nc/types';
import type { FeedUnit, MachineParamsDecl, NumberFormatOptions, Profile } from '$lib/core/profiles/types';
import { parseNumber } from '$lib/core/nc/numbers';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { withPointlessFeeds } from './fields';
import { numberClassOf, readingsOf, resolveValue, valueOf, writeBack, WRITE_BACK_ERRORS } from './numbers';
import type { EffectiveMachine, MachineParams, NumberInput, ResolvedClass } from './types';

interface Golden {
  fmt: NumberFormatOptions;
  /** A `NumberInput` written out, or (T206) a shipped preset named `profile/preset`. */
  inputs: Record<string, NumberInput | { note?: string; preset: string }>;
  decls: Record<string, { profile?: string; numberInput?: { default: string; presets: { id: string; label: string; input: string }[] } }>;
  profiles: Record<string, { profile?: string; inline?: unknown }>;
  class: {
    note: string;
    profile: string;
    address: string;
    feedUnit: FeedUnit;
    pitchFeed?: boolean;
    codes: unknown[];
    /** M9: the entries of the codes in force the block does not write. */
    inForce?: unknown[];
    /** FB-2: modal codes in force outside the cycle and motion groups; each lends its arc-centre words. */
    modes?: unknown[];
    /** P4h (T118): which block of a two-block cycle of `codes` the block is; absent or null: not known. */
    cycleBlock?: 1 | 2 | null;
    expected: ResolvedClass;
  }[];
  value: {
    note: string;
    literal: string;
    class: string;
    input: string | null;
    units: 'mm' | 'inch';
    expected: string | null;
  }[];
  writeBack: {
    note: string;
    value: string;
    original: string;
    class: string;
    input: string | null;
    units: 'mm' | 'inch';
    refuseRounding?: boolean;
    expected: { text: string; rounded: boolean } | { error: keyof typeof WRITE_BACK_ERRORS };
  }[];
  readings: {
    note: string;
    literal: string;
    class: string;
    decl: string;
    units: 'mm' | 'inch';
    expected: { preset: string; value: string | null }[];
  }[];
  resolve: {
    note: string;
    literal: string;
    class: ResolvedClass;
    source: 'machine' | 'profile';
    input: string | null;
    decl: string;
    units: 'mm' | 'inch';
    expected: { value: string | null; readings: string[] };
  }[];
}

const GOLDEN = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../tests/fixtures/machines/numbers.json', import.meta.url)), 'utf8'),
) as Golden;

/** A built-in profile as the app uses it (parents merged in). */
function builtin(id: string): Profile {
  const found = (BUILTIN_PROFILE_JSON as { id?: string }[]).find((profile) => profile?.id === id);
  expect(found, `no built-in profile ${id}`).toBeDefined();
  return found as unknown as Profile;
}

function profileOf(name: string): Profile {
  const entry = GOLDEN.profiles[name];
  expect(entry, `no profile ${name} in the golden set`).toBeDefined();
  return entry.profile !== undefined ? builtin(entry.profile) : (entry.inline as Profile);
}

/** A `machineParams` declaration: a built-in profile's, or one the golden set writes itself. */
function declOf(name: string): MachineParamsDecl | undefined {
  const entry = GOLDEN.decls[name];
  expect(entry, `no declaration ${name} in the golden set`).toBeDefined();
  if (entry.profile !== undefined) return builtin(entry.profile).machineParams;
  const written = entry.numberInput;
  if (!written) return undefined;
  return {
    numberInput: {
      default: written.default,
      presets: written.presets.map((preset) => ({
        id: preset.id,
        label: preset.label,
        value: inputOf(preset.input) as NumberInput,
      })),
    },
  };
}

function inputOf(name: string | null): NumberInput | null {
  if (name === null) return null;
  const input = GOLDEN.inputs[name];
  expect(input, `no number input ${name} in the golden set`).toBeDefined();
  if ('preset' in input) return shippedPreset(input.preset);
  return input;
}

/**
 * T206: a preset the golden set names (`fanuc-gcode/is-b`) instead of copying it, read from the
 * shipped profile, so the cases always test the data the app ships. Mirrors `input_of` in
 * `test_machine.py`.
 */
function shippedPreset(ref: string): NumberInput {
  const [profileId, presetId] = ref.split('/');
  const found = builtin(profileId).machineParams?.numberInput?.presets.find((preset) => preset.id === presetId);
  expect(found, `no preset ${ref} in the shipped profiles`).toBeDefined();
  return found!.value;
}

/** The machine parameters a case describes; only `numberInput` matters to these functions. */
function paramsOf(name: string | null): MachineParams {
  return { numberInput: inputOf(name), units: 'mm', diameter: null, variants: {}, modalInitial: {} };
}

/**
 * A golden literal as the tokenizer would have produced it. A comma is read the way the
 * Klartext tokenizer reads its decimal comma (2026-09): the strict parse first, then the
 * comma retried as the point, `raw` kept as written. Mirrors `literal` in `test_machine.py`.
 */
function literalOf(raw: string): NumericLiteral {
  const direct = parseNumber(raw);
  const alt = direct === null && raw.includes(',') ? parseNumber(raw.replace(',', '.')) : null;
  const parsed = direct ?? (alt === null ? null : { ...alt, raw });
  expect(parsed, `${raw} does not parse`).not.toBeNull();
  return parsed as NumericLiteral;
}

const CASE_COUNT =
  GOLDEN.class.length + GOLDEN.value.length + GOLDEN.writeBack.length + GOLDEN.readings.length + GOLDEN.resolve.length;

describe('machines/numbers.json', () => {
  it('holds the cases the plan asks for', () => {
    expect(CASE_COUNT).toBeGreaterThanOrEqual(80);
  });

  it.each(GOLDEN.class.map((c, i) => [`${i + 1}. ${c.note}`, c] as const))('class %s', (_name, c) => {
    const profile = profileOf(c.profile);
    // FB-2: what the modes in force lend, as `inForceEntries` adds it (`arc_centre_entry` in Python).
    const lent = ((c.modes ?? []) as CodeEntry[]).map((entry) => arcCentreEntry(entry, profile)).filter((e): e is CodeEntry => e !== null);
    const inForce = c.inForce !== undefined || lent.length > 0 ? [...((c.inForce ?? []) as CodeEntry[]), ...lent] : undefined;
    expect(
      numberClassOf(c.address, {
        profile,
        feedUnit: c.feedUnit,
        blockCodes: c.codes as CodeEntry[],
        pitchFeed: c.pitchFeed === true,
        ...(inForce !== undefined ? { inForce } : {}),
        ...(c.cycleBlock !== undefined ? { cycleBlock: c.cycleBlock } : {}),
      }),
    ).toBe(c.expected);
  });

  it.each(GOLDEN.value.map((c, i) => [`${i + 1}. ${c.note}`, c] as const))('value %s', (_name, c) => {
    expect(valueOf(literalOf(c.literal), c.class as 'length', paramsOf(c.input), c.units)).toBe(c.expected);
  });

  it.each(GOLDEN.writeBack.map((c, i) => [`${i + 1}. ${c.note}`, c] as const))('writeBack %s', (_name, c) => {
    const result = writeBack(
      c.value,
      literalOf(c.original),
      c.class as 'length',
      paramsOf(c.input),
      c.units,
      GOLDEN.fmt,
      { refuseRounding: c.refuseRounding === true },
    );
    if ('error' in c.expected) {
      expect(result).toEqual({ error: expect.objectContaining({ key: WRITE_BACK_ERRORS[c.expected.error].key }) });
    } else {
      expect(result).toEqual(c.expected);
    }
  });

  it.each(GOLDEN.readings.map((c, i) => [`${i + 1}. ${c.note}`, c] as const))('readings %s', (_name, c) => {
    const readings = readingsOf(literalOf(c.literal), c.class as 'length', declOf(c.decl), c.units);
    expect(readings.map((reading) => ({ preset: reading.preset, value: reading.value }))).toEqual(c.expected);
    // Every reading carries the preset's own label, which is what the user is shown.
    for (const reading of readings) expect(reading.label.length, reading.preset).toBeGreaterThan(0);
  });

  it.each(GOLDEN.resolve.map((c, i) => [`${i + 1}. ${c.note}`, c] as const))('resolve %s', (_name, c) => {
    const eff = {
      id: null,
      name: null,
      choice: c.source === 'machine' ? 'document' : 'none',
      params: paramsOf(c.input),
      source: {
        numberInput: c.source,
        units: 'profile',
        diameter: 'profile',
        variants: {},
        modalInitial: {},
      },
      key: 'test',
      mismatch: null,
    } as EffectiveMachine;
    const result = resolveValue(literalOf(c.literal), c.class, eff, declOf(c.decl), c.units);
    expect(result.value).toBe(c.expected.value);
    expect(result.readings.map((reading) => reading.preset)).toEqual(c.expected.readings);
  });
});

const IS_B: MachineParams = {
  numberInput: {
    mode: 'increment',
    incrementMm: '0.001',
    incrementInch: '0.0001',
    incrementDeg: '0.001',
    incrementSec: '0.001',
    classes: { feedPerMin: { mode: 'calculator' }, feedPerRev: { mode: 'calculator' } },
  },
  units: 'mm',
  diameter: null,
  variants: {},
  modalInitial: {},
};

const KEEP: NumberFormatOptions = { decimals: 'keep', trailingZeros: 'keep', keepPoint: true, plusSign: 'keep' };

describe('numberClassOf', () => {
  const mill = builtin('fanuc-gcode');

  // T212: this used to take the first code's unit, so the answer hung on the order the caller
  // listed the block's codes in. Two codes that disagree now tell nothing, in either order.
  it('gives no class when two codes declare the same address with different units, in either order', () => {
    const codes = [
      { code: 'G4', label: 'Dwell', params: [{ address: 'X', label: 'Time', unit: 'dwell' as const }] },
      { code: 'G83', label: 'Peck', params: [{ address: 'X', label: 'Position', unit: 'increment' as const }] },
    ] as CodeEntry[];
    expect(numberClassOf('X', { profile: mill, feedUnit: 'per-minute', blockCodes: codes, pitchFeed: false })).toBeNull();
    expect(numberClassOf('X', { profile: mill, feedUnit: 'per-minute', blockCodes: [...codes].reverse(), pitchFeed: false })).toBeNull();
  });

  it('ignores a parameter of another address and a parameter without a unit', () => {
    const codes = [
      { code: 'G81', label: 'Drill', params: [{ address: 'Z', label: 'Depth' }, { address: 'K', label: 'Repeats', unit: 'count' as const }] },
    ] as CodeEntry[];
    expect(numberClassOf('Z', { profile: mill, feedUnit: 'per-minute', blockCodes: codes, pitchFeed: false })).toBe('length');
  });

  it('answers nothing for an empty address', () => {
    expect(numberClassOf('', { profile: mill, feedUnit: 'per-minute', blockCodes: [], pitchFeed: false })).toBeNull();
  });
});

describe('valueOf', () => {
  it('never returns a minus zero, whichever reading produced it', () => {
    for (const raw of ['-0', '-0.', '-0.000']) {
      expect(valueOf(literalOf(raw), 'length', IS_B, 'mm'), raw).toBe('0');
    }
  });

  it('strips the trailing zeros the multiplication produced, so two readings can be compared as text', () => {
    expect(valueOf(literalOf('50'), 'length', IS_B, 'mm')).toBe('0.05');
    expect(valueOf(literalOf('50.000'), 'length', IS_B, 'mm')).toBe('50');
  });

  it('gives a literal that is not a number no value at all', () => {
    expect(valueOf({ raw: '1.2.3', sign: '', intPart: '1', fracPart: '2', hasPoint: true }, 'length', IS_B, 'mm')).toBeNull();
  });
});

describe('writeBack', () => {
  it('reports the rounding rather than hiding it, and refuses it when asked to', () => {
    const rounded = writeBack('0.0505', literalOf('50'), 'length', IS_B, 'mm', KEEP);
    expect(rounded).toEqual({ text: '51', rounded: true });
    const refused = writeBack('0.0505', literalOf('50'), 'length', IS_B, 'mm', KEEP, { refuseRounding: true });
    expect('error' in refused && refused.error.key).toBe(WRITE_BACK_ERRORS.rounded.key);
    // The message can say what the machine reads this word in.
    expect('error' in refused && refused.error.params?.increment).toBe('0.001');
  });

  it('does not refuse a value that fits, even with refuseRounding', () => {
    expect(writeBack('0.05', literalOf('50'), 'length', IS_B, 'mm', KEEP, { refuseRounding: true })).toEqual({
      text: '50',
      rounded: false,
    });
  });

  it('keeps a point-less word point-less in all three readings', () => {
    const calculator: MachineParams = { ...IS_B, numberInput: { mode: 'calculator', incrementMm: '1' } };
    const scale: MachineParams = { ...IS_B, numberInput: { mode: 'scale', incrementMm: '0.01' } };
    for (const [machine, value, text] of [
      [IS_B, '0.06', '60'],
      [calculator, '60', '60'],
      [scale, '0.6', '60'],
    ] as const) {
      expect(writeBack(value, literalOf('50'), 'length', machine, 'mm', KEEP), value).toEqual({ text, rounded: false });
    }
  });

  it('keeps the point of a word that has one in all three readings', () => {
    const calculator: MachineParams = { ...IS_B, numberInput: { mode: 'calculator', incrementMm: '1' } };
    const scale: MachineParams = { ...IS_B, numberInput: { mode: 'scale', incrementMm: '0.01' } };
    for (const [machine, value, text] of [
      [IS_B, '60', '60.'],
      [calculator, '60', '60.'],
      [scale, '0.6', '60.'],
    ] as const) {
      expect(writeBack(value, literalOf('50.'), 'length', machine, 'mm', KEEP), value).toEqual({ text, rounded: false });
    }
  });

  it('refuses a value that is not a decimal number instead of throwing', () => {
    const result = writeBack('1e3', literalOf('50'), 'length', IS_B, 'mm', KEEP);
    expect('error' in result && result.error.key).toBe(WRITE_BACK_ERRORS.notANumber.key);
  });
});

describe('readingsOf', () => {
  it('puts the declared default first, whatever order the presets are written in', () => {
    const decl: MachineParamsDecl = {
      numberInput: {
        default: 'calculator',
        presets: [
          { id: 'is-b', label: 'IS-B', value: { mode: 'increment', incrementMm: '0.001' } },
          { id: 'calculator', label: 'As written', value: { mode: 'calculator', incrementMm: '1' } },
        ],
      },
    };
    expect(readingsOf(literalOf('50'), 'length', decl, 'mm').map((r) => r.preset)).toEqual(['calculator', 'is-b']);
  });

  it('answers nothing for a profile that declares no machine parameters at all', () => {
    expect(readingsOf(literalOf('50'), 'length', undefined, 'mm')).toEqual([]);
  });
});

// T084: the golden set writes two machine number inputs out (`fine-feeds`, `is-c-per-rev`)
// because no profile ships them as presets. They are exactly what the Machines page stores
// for a preset with a "Point-less feeds" choice over it, so the golden values are the values
// such a machine gets, in both languages.
describe('the point-less feeds option (T084) and the golden set', () => {
  const feedsDecl = () => builtin('fanuc-gcode').machineParams?.numberInput?.pointlessFeeds;
  const choice = (value: string) => feedsDecl()?.choices.find((entry) => entry.value === value);
  const written = (name: string): NumberInput => {
    const { note: _note, ...input } = GOLDEN.inputs[name] as NumberInput & { note?: string };
    return input;
  };

  // Manual-check fix D4-2: the lathe states its own choices; `fine-feeds` is a hand-written
  // machine rule set since then (no choice of either profile makes it).
  const latheChoice = (value: string) =>
    builtin('fanuc-lathe').machineParams?.numberInput?.pointlessFeeds?.choices.find((entry) => entry.value === value);

  it('lathe-per-minute and lathe-series-15 are the lathe is-b preset with the lathe choices', () => {
    expect(latheChoice('per-minute')).toBeDefined();
    expect(withPointlessFeeds(shippedPreset('fanuc-lathe/is-b'), latheChoice('per-minute'))).toEqual(written('lathe-per-minute'));
    expect(withPointlessFeeds(shippedPreset('fanuc-lathe/is-b'), latheChoice('series-15'))).toEqual(written('lathe-series-15'));
  });

  it('is-c-per-rev is the is-c preset with the choice "per-rev"', () => {
    expect(withPointlessFeeds(shippedPreset('fanuc-gcode/is-c'), choice('per-rev'))).toEqual(written('is-c-per-rev'));
  });

  it('the default choice and an "as written" preset change nothing', () => {
    const isB = shippedPreset('fanuc-gcode/is-b');
    expect(withPointlessFeeds(isB, choice(feedsDecl()!.default))).toEqual(isB);
    const calculator = shippedPreset('fanuc-lathe/calculator');
    expect(withPointlessFeeds(calculator, latheChoice('both'))).toEqual(calculator);
  });
});
