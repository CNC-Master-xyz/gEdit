// Merging the user's `settings.json` over the defaults, and back (plan AD-8). Owner: WP2.6.
//
// The two directions are separate on purpose:
//   - `mergeSettings` is tolerant. A value of the wrong type, out of range or not among
//     the choices is dropped with a warning and the default is used, because a settings
//     file edited by hand must never leave the app unusable. Unknown keys are KEPT, so a
//     file written by a newer build survives a round trip through an older one.
//   - `diffFromDefaults` is strict. It writes only what differs from `DEFAULTS`, with
//     sorted keys, so the file stays small and diffable.
//
// The rules are derived from `schema.ts` rather than written out a second time: the type
// comes from the default's own type, the range and the choices from `SETTING_FIELDS`, and
// "may not be empty" from that row's `required` — the same flag the settings dialog
// validates against, so the file and the form cannot disagree (G8 M2). Only what the
// field table cannot express lives here: the element type of the two list settings.
//
// Warnings are English detail text (AD-14): the store shows them under a translated
// summary.

import { paletteProblems } from '$lib/core/grammar/contrast';
import { ROLES } from '$lib/core/grammar/roles';
import { DEFAULTS, SETTING_FIELDS, type Settings } from './schema';

export interface MergeResult {
  /** The defaults with every valid user value applied. */
  values: Settings;
  /** English detail text, one per dropped or corrected value (AD-14). */
  warnings: string[];
  /** Keys that are not in `Settings`, kept so that `diffFromDefaults` can write them back. */
  unknown: Record<string, unknown>;
}

/** Every settings key, in the order `DEFAULTS` declares them. */
const KEYS = Object.keys(DEFAULTS) as (keyof Settings)[];

type Kind = 'string' | 'number' | 'boolean' | 'integers' | 'strings' | 'palette';

interface Rule {
  kind: Kind;
  /** Whole numbers only, with inclusive bounds (`integer` fields). */
  min?: number;
  max?: number;
  /** The allowed values of a choice field; absent when the choices are data (profiles). */
  choices?: readonly unknown[];
  /** A string setting whose empty value would have no meaning. */
  nonEmpty?: boolean;
}

/**
 * `FieldType` has no list type (see the P2 hand-off), so the two array settings carry an
 * unrelated field type and their element type is named here instead.
 */
const LIST_KIND: Partial<Record<keyof Settings, Kind>> = {
  'editor.rulers': 'integers',
  'scripts.folders': 'strings',
  'appearance.roleColors': 'palette',
};

function ruleFor(key: keyof Settings): Rule {
  const list = LIST_KIND[key];
  if (list) return { kind: list };

  const meta = SETTING_FIELDS.find((f) => f.key === key);
  const field = meta?.field;
  const value = DEFAULTS[key];

  if (typeof value === 'boolean') return { kind: 'boolean' };
  if (typeof value === 'number') {
    return { kind: 'number', min: field?.min, max: field?.max };
  }
  const choices = field?.type === 'choice' ? (field.choices ?? []).map((c) => c.value) : [];
  return {
    kind: 'string',
    ...(choices.length > 0 ? { choices } : {}),
    // `scripts.python` is deliberately not `required`: empty means "find one" (§7.7).
    ...(field?.required === true ? { nonEmpty: true } : {}),
  };
}

const RULES = new Map<keyof Settings, Rule>(KEYS.map((key) => [key, ruleFor(key)]));

/** What a valid value would have looked like, for the warning text. */
function expected(rule: Rule): string {
  switch (rule.kind) {
    case 'boolean':
      return 'expected true or false';
    case 'number':
      if (rule.min !== undefined && rule.max !== undefined) {
        return `expected a whole number between ${rule.min} and ${rule.max}`;
      }
      return 'expected a whole number';
    case 'integers':
      return 'expected a list of whole numbers';
    case 'strings':
      return 'expected a list of non-empty strings';
    case 'palette':
      return 'expected an object with "dark" and "light", each a role and a #rrggbb colour';
    default:
      if (rule.choices) return `expected one of ${rule.choices.map(String).join(', ')}`;
      return rule.nonEmpty ? 'expected a non-empty string' : 'expected a string';
  }
}

/** A whole number inside the rule's bounds. */
function validNumber(raw: unknown, rule: Rule): boolean {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return false;
  if (rule.min !== undefined && raw < rule.min) return false;
  return !(rule.max !== undefined && raw > rule.max);
}

/**
 * The value to use for `key`, or undefined when `raw` cannot be used.
 *
 * A list is taken whole or not at all: correcting one entry away silently would change
 * the order of the rest, and the file is the user's to fix.
 */
function accept(raw: unknown, rule: Rule): unknown | undefined {
  switch (rule.kind) {
    case 'boolean':
      return typeof raw === 'boolean' ? raw : undefined;
    case 'number':
      return validNumber(raw, rule) ? raw : undefined;
    case 'integers':
      if (!Array.isArray(raw)) return undefined;
      return raw.every((v) => typeof v === 'number' && Number.isInteger(v) && v >= 0)
        ? [...(raw as number[])]
        : undefined;
    case 'strings':
      if (!Array.isArray(raw)) return undefined;
      return raw.every((v) => typeof v === 'string' && v.length > 0)
        ? [...(raw as string[])]
        : undefined;
    case 'palette':
      return cleanPalette(raw);
    default:
      if (typeof raw !== 'string') return undefined;
      if (rule.nonEmpty && raw.length === 0) return undefined;
      if (rule.choices && !rule.choices.includes(raw)) return undefined;
      return raw;
  }
}

/**
 * The usable part of a palette (`appearance.roleColors`): the colours that pass the contrast
 * rule, in the order of the roles, `dark` before `light`, an empty theme left out. Unlike a
 * list, a palette is taken colour by colour (§6.10 rule 6): the setting keeps its other colours
 * and `paletteWarnings` names each one that is not used. Undefined when `raw` is not an object.
 */
function cleanPalette(raw: unknown): Record<string, Record<string, string>> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const bad = new Set(paletteProblems(raw).map(([path]) => path));
  const out: Record<string, Record<string, string>> = {};
  for (const mode of ['dark', 'light'] as const) {
    const roles = (raw as Record<string, unknown>)[mode];
    if (typeof roles !== 'object' || roles === null || Array.isArray(roles)) continue;
    const kept: Record<string, string> = {};
    for (const role of ROLES) {
      const value = (roles as Record<string, unknown>)[role];
      if (value !== undefined && !bad.has(`${mode}.${role}`)) kept[role] = value as string;
    }
    if (Object.keys(kept).length > 0) out[mode] = kept;
  }
  return out;
}

/** One warning per colour of a palette that is not used, named by its place in the file. */
function paletteWarnings(key: string, raw: unknown): string[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [];
  return paletteProblems(raw).map(([path, message]) => `"${key}${path === '' ? '' : `.${path}`}": ${message}; not used`);
}

/**
 * `target[key] = value`, for a key that comes from a file.
 *
 * Plain bracket assignment is not enough: for `__proto__` it invokes
 * `Object.prototype`'s setter and changes the accumulator's prototype instead of storing
 * anything, so such a member of `settings.json` vanished from the "unknown keys are KEPT"
 * round trip of AD-8 — exactly the case the rule exists for (G8 M2). `defineProperty`
 * always creates an own, enumerable data property.
 */
function put(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** Short, readable JSON for a warning; a long value is cut so the status detail stays one line. */
function show(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

/** Applies the raw contents of `settings.json` (without `$version`) over `DEFAULTS`. */
export function mergeSettings(raw: Record<string, unknown>): MergeResult {
  const values = { ...DEFAULTS } as Settings;
  const warnings: string[] = [];
  const unknown: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    const rule = RULES.get(key as keyof Settings);
    if (!rule) {
      // A key this build does not know: kept verbatim so that switching back to a newer
      // build does not lose it (AD-8).
      put(unknown, key, value);
      continue;
    }
    const accepted = accept(value, rule);
    if (rule.kind === 'palette' && accepted !== undefined) warnings.push(...paletteWarnings(key, value));
    if (accepted === undefined) {
      warnings.push(
        `"${key}": ${expected(rule)}, got ${show(value)}; using the default ${show(DEFAULTS[key as keyof Settings])}`,
      );
      continue;
    }
    // The rule was built from this key's own default, so the accepted value has its type.
    (values as unknown as Record<string, unknown>)[key] = accepted;
  }

  return { values, warnings, unknown };
}

/** Value equality that also covers the two list settings and the palette. */
function same(a: unknown, b: unknown): boolean {
  if (isPalette(a) || isPalette(b)) return JSON.stringify(canonicalPalette(a)) === JSON.stringify(canonicalPalette(b));
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => value === b[index]);
  }
  return a === b;
}

function isPalette(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A palette with its keys in a fixed order, so two spellings of one palette compare equal. */
function canonicalPalette(value: unknown): unknown {
  return isPalette(value) ? (cleanPalette(value) ?? {}) : value;
}

/** A copy, so that nothing hands out a reference into the store's own state. */
function copy(value: unknown): unknown {
  if (isPalette(value)) return structuredClone(canonicalPalette(value));
  return Array.isArray(value) ? [...value] : value;
}

/** The keys of `values` that differ from `DEFAULTS`, plus `unknown`, with sorted keys. */
export function diffFromDefaults(
  values: Settings,
  unknown: Record<string, unknown> = {},
): Record<string, unknown> {
  const changed = new Map<string, unknown>();
  for (const key of KEYS) {
    if (!same(values[key], DEFAULTS[key])) changed.set(key, copy(values[key]));
  }
  for (const [key, value] of Object.entries(unknown)) {
    // `$version` is written by the store, and a key this build knows is never "unknown".
    if (key === '$version' || RULES.has(key as keyof Settings)) continue;
    changed.set(key, value);
  }

  const out: Record<string, unknown> = {};
  for (const key of [...changed.keys()].sort()) put(out, key, changed.get(key));
  return out;
}
