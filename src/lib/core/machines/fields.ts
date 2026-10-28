// The machine dialog's fields, and the one-line summary of an effective machine
// (plan §7.15 "Dialog fields", AD-31 "Management" and "Selection UI"). Owner: WP6.10.
//
// Everything here is **generated from the profile's declaration** (`machineParams`, §8.8).
// No dialect is named, no preset is spelled out and no variant is known to this file: a
// profile that declares another unit table or another G-code system gets its form for
// free, and G10 reviews the data rather than this code.
//
// Three rules the form lives by:
//
//  1. **Only existing `FieldType`s** (F46): `text`, `choice` and `bool`. The page renders
//     them with the same `FormRenderer` every other generated form uses, so there is one
//     form engine in the app and no machine-shaped control anywhere.
//  2. **A value the form cannot express is kept, not dropped.** A `numberInput` written by
//     hand that matches no preset shows as "Custom (edited in the file)" and survives an
//     edit of the name; so do a `channels` block (M10) and any member a later version adds.
//     `machineFromValues` starts from the stored parameters and overwrites only what the
//     form actually offered.
//  3. **Nothing is corrected silently.** `pruneModalValues` is the one place a value is
//     taken away — when the user switches to a G-code system whose database does not have
//     that code at all — and it hands back what it dropped so the page can say so.
//
// Labels: the field titles are UI strings and go through `t()`; preset labels, variant
// labels, code labels and machine names are **data** and stay as the JSON has them (AD-14).

import { hasKey, t } from '$lib/i18n';
import type { ChannelParams } from '$lib/core/channels/types';
import type { Msg } from '$lib/app/types';
import type { CodeDb, CodeEntry } from '$lib/core/codes/types';
import type { FieldChoice, FieldSpec } from '$lib/core/forms/types';
import type {
  MachineParamsDecl,
  NumberInputPreset,
  PointlessFeedChoice,
  PointlessFeedsDecl,
  VariantDecl,
} from '$lib/core/profiles/types';
import { MAX_BUILDER_CODES_LENGTH, MAX_NAME_LENGTH, MAX_NOTES_LENGTH } from './validate';
import { EXTRA_AXIS_NAME, MAX_EXTRA_AXES } from '$lib/core/profiles/validate';
import { variantDefaultOf } from './effective';
import type { EffectiveMachine, ExtraAxis, MachineConfig, MachineParams, NumberInput, ParamSource } from './types';

/** Field ids. They are stable: the runtime scenarios read `data-field` (§7.9). */
export const FIELD_NAME = 'name';
export const FIELD_NUMBER_INPUT = 'numberInput';
/** T084: how a feed without a point counts, an option on top of the number-input preset. */
export const FIELD_POINTLESS_FEEDS = 'pointlessFeeds';
export const FIELD_UNITS = 'units';
export const FIELD_DIAMETER = 'diameter';
export const FIELD_NOTES = 'notes';
/** P4h (§6.10 rule 13; T123): the machine's extra axes as one line of text (`AA, BB rotary`). */
export const FIELD_EXTRA_AXES = 'extraAxes';
/** P4h (§6.10 rule 14; T123): the machine builder's codes, in the wait codes' list form. */
export const FIELD_BUILDER_CODES = 'builderCodes';
/** `variant.<id>` and `modal.<group>`, so one flat values record holds the whole machine. */
export const VARIANT_PREFIX = 'variant.';
export const MODAL_PREFIX = 'modal.';

/** The `numberInput` choice for a stored value that matches no preset (§7.15). */
export const CUSTOM_PRESET = 'custom';
/** The `choice` value that means "leave it to the profile" for a modal group. */
export const PROFILE_DEFAULT = '';

export function variantFieldId(id: string): string {
  return `${VARIANT_PREFIX}${id}`;
}

export function modalFieldId(group: string): string {
  return `${MODAL_PREFIX}${group}`;
}

/** The variant id of `variant.<id>`, or null for any other field. */
export function variantIdOf(fieldId: string): string | null {
  return fieldId.startsWith(VARIANT_PREFIX) ? fieldId.slice(VARIANT_PREFIX.length) : null;
}

/**
 * D5-3: after the form's variant field `changedId` moved from `before` to `after`, a
 * variant whose default follows it (`defaultBy`) and still stands at its old default takes
 * the new one; a value chosen by hand stays. Returns the field ids it moved.
 */
export function followVariantDefaults(
  decl: MachineParamsDecl | undefined,
  changedId: string,
  before: Readonly<Record<string, unknown>>,
  after: Record<string, unknown>,
): string[] {
  const changed = variantIdOf(changedId);
  if (changed === null) return [];
  const standingOf = (values: Readonly<Record<string, unknown>>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const variant of variantsOf(decl)) {
      const value = values[variantFieldId(variant.id)];
      out[variant.id] = typeof value === 'string' && value !== '' ? value : variant.default;
    }
    return out;
  };
  const was = standingOf(before);
  const now = standingOf(after);
  const moved: string[] = [];
  for (const variant of variantsOf(decl)) {
    if (variant.defaultBy?.variant !== changed) continue;
    const field = variantFieldId(variant.id);
    const old = variantDefaultOf(variant, was);
    const next = variantDefaultOf(variant, now);
    if (old !== next && (after[field] === undefined || after[field] === old)) {
      after[field] = next;
      moved.push(field);
    }
  }
  return moved;
}

/** The modal group of `modal.<group>`, or null for any other field. */
export function modalGroupOf(fieldId: string): string | null {
  return fieldId.startsWith(MODAL_PREFIX) ? fieldId.slice(MODAL_PREFIX.length) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** JSON with object keys sorted, so two equal number rules give one string. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) {
    const parts = Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`);
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const presetsOf = (decl: MachineParamsDecl | undefined): NumberInputPreset[] =>
  Array.isArray(decl?.numberInput?.presets) ? decl.numberInput.presets : [];

const variantsOf = (decl: MachineParamsDecl | undefined): VariantDecl[] =>
  Array.isArray(decl?.variants) ? decl.variants : [];

const groupsOf = (decl: MachineParamsDecl | undefined): string[] =>
  Array.isArray(decl?.modalGroups) ? decl.modalGroups : [];

/** T084: the profile's point-less-feeds option, or undefined when it declares none. */
function feedsDeclOf(decl: MachineParamsDecl | undefined): PointlessFeedsDecl | undefined {
  const feeds = decl?.numberInput?.pointlessFeeds;
  return isRecord(feeds) && Array.isArray(feeds.choices) && feeds.choices.length > 0 ? feeds : undefined;
}

/** The choices of the option, the default first (the one a plain preset matches). */
function feedChoicesOf(feeds: PointlessFeedsDecl): PointlessFeedChoice[] {
  const list = feeds.choices.filter((choice): choice is PointlessFeedChoice => isRecord(choice) && typeof choice.value === 'string');
  return [...list.filter((choice) => choice.value === feeds.default), ...list.filter((choice) => choice.value !== feeds.default)];
}

/** The feed classes the option can change. */
const POINTLESS_FEED_CLASSES = ['feedPerMin', 'feedPerRev'] as const;

/** Whether `value` counts a feed of this class in increments when it is written without a point. */
function countsFeed(value: NumberInput, cls: (typeof POINTLESS_FEED_CLASSES)[number]): boolean {
  return (value.classes?.[cls]?.mode ?? value.mode) === 'increment';
}

/**
 * T084: the number rules of a preset with the steps of a point-less-feeds choice over them.
 *
 * A choice changes a feed class only where the preset counts that class in increments: with
 * calculator-type input every feed is read as written, whatever the feed parameters say. An
 * inch step the choice does not name is not kept from the preset either (it belonged to the
 * old step); the class then falls back to a tenth of the metric one, as an increment does.
 * The machine stores the result whole, like a preset, so nothing has to read the option
 * itself: `numbers.ts`, `_nc_machine.py` and every script read the classes they always read.
 */
export function withPointlessFeeds(value: NumberInput, choice: PointlessFeedChoice | undefined): NumberInput {
  const out = clone(value);
  for (const cls of POINTLESS_FEED_CLASSES) {
    const step = choice?.classes?.[cls];
    if (!isRecord(step) || typeof step.increment !== 'string' || !countsFeed(out, cls)) continue;
    const next: { mode?: NumberInput['mode']; increment?: string; incrementInch?: string } = {
      ...(out.classes?.[cls] ?? {}),
      increment: step.increment,
    };
    if (typeof step.incrementInch === 'string') next.incrementInch = step.incrementInch;
    else delete next.incrementInch;
    out.classes = { ...(out.classes ?? {}), [cls]: next };
  }
  return out;
}

/** The preset and the point-less-feeds choice whose rules are exactly `value`, or null. */
function matchOf(
  decl: MachineParamsDecl | undefined,
  value: NumberInput | null | undefined,
): { preset: NumberInputPreset; feeds: PointlessFeedChoice | null } | null {
  if (!isRecord(value)) return null;
  const wanted = canonical(value);
  const feeds = feedsDeclOf(decl);
  const choices: (PointlessFeedChoice | undefined)[] = feeds ? feedChoicesOf(feeds) : [undefined];
  for (const preset of presetsOf(decl)) {
    if (!isRecord(preset?.value)) continue;
    for (const choice of choices) {
      if (canonical(withPointlessFeeds(preset.value, choice)) === wanted) return { preset, feeds: choice ?? null };
    }
  }
  return null;
}

/**
 * The preset whose rules are exactly `value`, or null — which is what "Custom" means. T084:
 * a preset with a point-less-feeds choice over it is still that preset.
 */
export function presetOf(
  decl: MachineParamsDecl | undefined,
  value: NumberInput | null | undefined,
): NumberInputPreset | null {
  return matchOf(decl, value)?.preset ?? null;
}

/**
 * T084: the point-less-feeds choice a machine's stored rules amount to, or the declared
 * default; '' when the profile declares no such option.
 */
export function pointlessFeedsIdOf(decl: MachineParamsDecl | undefined, current?: MachineConfig): string {
  const feeds = feedsDeclOf(decl);
  if (feeds === undefined) return '';
  const fallback = feedChoicesOf(feeds)[0]?.value ?? '';
  return matchOf(decl, current?.params?.numberInput)?.feeds?.value ?? fallback;
}

/** The preset id a machine's stored rules amount to: a preset, `custom`, or the default. */
export function presetIdOf(decl: MachineParamsDecl | undefined, current?: MachineConfig): string {
  const stored = current?.params?.numberInput;
  if (isRecord(stored)) return presetOf(decl, stored)?.id ?? CUSTOM_PRESET;
  const declared = decl?.numberInput;
  if (declared === undefined) return '';
  const presets = presetsOf(decl);
  return presets.some((preset) => preset?.id === declared.default) ? declared.default : (presets[0]?.id ?? '');
}

/**
 * The message that names the diameter words: `{words}` and a plural `count`, so it can
 * say "is" for one of them. Built at runtime and checked with `hasKey`, as keys.test.ts
 * asks of such a key.
 */
export const DIAMETER_WORDS_KEY = 'machines.param.diameterWords';

/**
 * The label of the diameter parameter, naming the words the profile reads as diameters
 * (`addresses.diameter`): `X and U` on a Fanuc lathe, `X` alone on Okuma and Sinumerik,
 * where `U` is no diameter at all — on Okuma it is a finish allowance (G8 M8). Without
 * words, or while the message that names them is not there, it is the plain message.
 */
export function diameterLabel(words?: readonly string[]): string {
  const list = (words ?? []).filter((word): word is string => typeof word === 'string' && word !== '');
  if (list.length === 0 || !hasKey(DIAMETER_WORDS_KEY)) return t('machines.param.diameter');
  const joined = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(list);
  return t(DIAMETER_WORDS_KEY, { words: joined, count: list.length });
}

/** The label of a modal group: a word we have for it, else the group's own name. */
export function groupLabel(group: string): string {
  const key = `machines.groups.${group}`;
  return hasKey(key) ? t(key) : t('machines.param.modal', { group });
}

/** The power-on codes a machine may pick for `group`: the database's modal entries. */
export function groupCodes(codes: CodeDb | undefined, group: string): CodeEntry[] {
  const list = Array.isArray(codes?.codes) ? codes.codes : [];
  return list.filter((entry) => entry?.modal === true && entry.group === group);
}

/** `G95 — Feed per revolution`; both halves are data (AD-14). */
function codeChoice(entry: CodeEntry): FieldChoice {
  return { label: `${entry.code} — ${entry.label}`, value: entry.code };
}

/**
 * The form for one machine of a profile that declares `decl`, over the code database
 * `codes` the machine's **currently chosen** variant names — that is what decides which
 * power-on codes exist (Fanuc system A has `G98`/`G99` as feed modes, system B has
 * `G94`/`G95` and reads `G98`/`G99` as cycle-return codes).
 *
 * `current` is the machine being edited; without it the fields are a new machine's.
 * `diameterWords` is the profile's `addresses.diameter`, which the diameter field names.
 */
export function machineFields(
  decl: MachineParamsDecl,
  codes: CodeDb,
  current?: MachineConfig,
  diameterWords?: readonly string[],
): FieldSpec[] {
  const fields: FieldSpec[] = [
    {
      id: FIELD_NAME,
      type: 'text',
      label: t('machines.param.name'),
      help: t('machines.param.nameHelp'),
      required: true,
      maxLength: MAX_NAME_LENGTH,
      default: current?.name ?? '',
    },
  ];

  const presets = presetsOf(decl);
  if (decl.numberInput !== undefined && presets.length > 0) {
    // A preset with `verify` is a documented default nobody has confirmed for a machine of
    // this kind: the choice says so in plain words (B1 A4). The label itself is data.
    const choices: FieldChoice[] = presets.map((preset) => ({
      label: preset.verify === true ? `${preset.label} (${t('machines.value.unconfirmed')})` : preset.label,
      value: preset.id,
    }));
    const chosen = presetIdOf(decl, current);
    if (chosen === CUSTOM_PRESET) {
      choices.push({ label: t('machines.value.custom'), value: CUSTOM_PRESET });
    }
    fields.push({
      id: FIELD_NUMBER_INPUT,
      type: 'choice',
      label: t('machines.param.numberInput'),
      help:
        chosen === CUSTOM_PRESET
          ? t('machines.value.customDetail')
          : presets.some((preset) => preset.verify === true)
            ? `${t('machines.param.numberInputHelp')} ${t('machines.param.numberInputUnconfirmed')}`
            : t('machines.param.numberInputHelp'),
      choices,
      default: chosen,
    });

    // T084: the option is offered beside the preset it modifies. A "Custom" rule set is
    // edited in the file, so the form leaves its feeds alone too.
    const feeds = feedsDeclOf(decl);
    if (feeds !== undefined && chosen !== CUSTOM_PRESET) {
      const unconfirmed = feeds.verify === true;
      fields.push({
        id: FIELD_POINTLESS_FEEDS,
        type: 'choice',
        label: t('machines.param.pointlessFeeds'),
        help: t('machines.param.pointlessFeedsHelp'),
        choices: feedChoicesOf(feeds).map((choice) => ({
          label: unconfirmed ? `${choice.label} (${t('machines.value.unconfirmed')})` : choice.label,
          value: choice.value,
        })),
        default: pointlessFeedsIdOf(decl, current),
      });
    }
  }

  fields.push({
    id: FIELD_UNITS,
    type: 'choice',
    label: t('machines.param.units'),
    help: t('machines.param.unitsHelp'),
    choices: [
      { label: t('machines.value.mm'), value: 'mm' },
      { label: t('machines.value.inch'), value: 'inch' },
    ],
    default: current?.params?.units ?? decl.units ?? 'mm',
  });

  if (decl.diameter !== undefined) {
    fields.push({
      id: FIELD_DIAMETER,
      type: 'bool',
      label: diameterLabel(diameterWords),
      help: t('machines.param.diameterHelp'),
      default: (current?.params?.diameter ?? decl.diameter) === 'on',
    });
  }

  // D5-3: what every variant stands at on this machine, for a default that follows another.
  const standing: Record<string, string> = {};
  for (const variant of variantsOf(decl)) {
    if (typeof variant?.id !== 'string') continue;
    const stored = current?.params?.variants?.[variant.id];
    standing[variant.id] = typeof stored === 'string' && stored !== '' ? stored : variant.default;
  }
  for (const variant of variantsOf(decl)) {
    if (typeof variant?.id !== 'string' || variant.id === '') continue;
    const choices = (Array.isArray(variant.choices) ? variant.choices : [])
      .filter((choice) => typeof choice?.value === 'string')
      .map((choice) => ({ label: choice.label ?? choice.value, value: choice.value }));
    if (choices.length === 0) continue;
    const stored = current?.params?.variants?.[variant.id];
    const chosen = choices.some((choice) => choice.value === stored) ? (stored as string) : variantDefaultOf(variant, standing);
    fields.push({
      id: variantFieldId(variant.id),
      type: 'choice',
      // The variant's label is data ('G-code system'), like its choices.
      label: variant.label,
      choices,
      default: choices.some((choice) => choice.value === chosen) ? chosen : choices[0].value,
    });
  }

  for (const group of groupsOf(decl)) {
    if (typeof group !== 'string' || group === '') continue;
    const entries = groupCodes(codes, group);
    if (entries.length === 0) continue;
    const stored = current?.params?.modalInitial?.[group];
    fields.push({
      id: modalFieldId(group),
      type: 'choice',
      label: groupLabel(group),
      help: t('machines.param.modalHelp'),
      choices: [
        { label: t('machines.value.profileDefault'), value: PROFILE_DEFAULT },
        ...entries.map(codeChoice),
      ],
      default: entries.some((entry) => entry.code === stored) ? (stored as string) : PROFILE_DEFAULT,
    });
  }

  // P4h (§6.10 rules 13, 14; T123): offered where the profile declares them.
  if (decl.extraAxes !== undefined) {
    fields.push({
      id: FIELD_EXTRA_AXES,
      type: 'text',
      label: t('machines.param.extraAxes'),
      help: t('machines.param.extraAxesHelp'),
      maxLength: EXTRA_AXES_TEXT_LENGTH,
      default: formatExtraAxes(current?.params?.extraAxes),
    });
  }
  if (decl.builderCodes !== undefined) {
    const letters = Array.isArray(decl.builderCodes.letters) ? decl.builderCodes.letters : [];
    fields.push({
      id: FIELD_BUILDER_CODES,
      type: 'text',
      label: t('machines.param.builderCodes'),
      help: t('machines.param.builderCodesHelp', { example: decl.builderCodes.example ?? `${letters[0] ?? 'G'}810-${letters[0] ?? 'G'}829` }),
      maxLength: MAX_BUILDER_CODES_LENGTH,
      default: typeof current?.params?.builderCodes === 'string' ? current.params.builderCodes : '',
    });
  }

  fields.push({
    id: FIELD_NOTES,
    type: 'text',
    label: t('machines.param.notes'),
    help: t('machines.param.notesHelp'),
    maxLength: MAX_NOTES_LENGTH,
    default: current?.notes ?? '',
  });

  return fields;
}

/**
 * The machine the form describes. It starts from the stored parameters, so a `channels`
 * block (M10), a per-class number rule written by hand and any member a later version adds
 * survive an edit of the name; only what the form offered is overwritten.
 */
export function machineFromValues(
  decl: MachineParamsDecl,
  values: Record<string, unknown>,
  current?: MachineConfig,
  o: { channels?: ChannelParams } = {},
): { name: string; notes: string; params: Partial<MachineParams> } {
  const params: Partial<MachineParams> = current?.params ? clone(current.params) : {};

  // The Channels step edits a block of its own (outside the `FieldSpec` values): when the
  // caller passes `channels` the block is replaced by it, and removed when it is `undefined`
  // ("No channels"). Without the option the stored block is kept as it is.
  if ('channels' in o) {
    if (o.channels === undefined) delete params.channels;
    else params.channels = clone(o.channels);
  }

  const presetId = values[FIELD_NUMBER_INPUT];
  if (typeof presetId === 'string' && presetId !== '' && presetId !== CUSTOM_PRESET) {
    const preset = presetsOf(decl).find((entry) => entry?.id === presetId);
    // The machine stores the **whole** rule set of the preset it was given, so a later
    // change to the profile's preset data never changes a machine under the user's hands.
    // T084: with the point-less-feeds choice over it, written into the same rules.
    const feeds = feedsDeclOf(decl);
    const wanted = values[FIELD_POINTLESS_FEEDS];
    const choice = feeds?.choices.find((entry) => isRecord(entry) && entry.value === wanted);
    if (preset?.value) params.numberInput = withPointlessFeeds(preset.value, choice);
  }

  const units = values[FIELD_UNITS];
  if (units === 'mm' || units === 'inch') params.units = units;

  if (decl.diameter !== undefined) {
    const diameter = values[FIELD_DIAMETER];
    if (typeof diameter === 'boolean') params.diameter = diameter ? 'on' : 'off';
  }

  const variants: Record<string, string> = { ...(params.variants ?? {}) };
  for (const variant of variantsOf(decl)) {
    if (typeof variant?.id !== 'string' || variant.id === '') continue;
    const value = values[variantFieldId(variant.id)];
    if (typeof value === 'string' && value !== '') variants[variant.id] = value;
  }
  if (Object.keys(variants).length > 0) params.variants = variants;

  const modalInitial: Record<string, string> = { ...(params.modalInitial ?? {}) };
  for (const group of groupsOf(decl)) {
    if (typeof group !== 'string' || group === '') continue;
    const value = values[modalFieldId(group)];
    if (typeof value === 'string' && value !== PROFILE_DEFAULT) modalInitial[group] = value;
    else delete modalInitial[group];
  }
  if (Object.keys(modalInitial).length > 0) params.modalInitial = modalInitial;
  else delete params.modalInitial;

  // P4h (§6.10 rules 13, 14): an empty field removes the member; a list the field cannot read
  // leaves the stored one alone (the page refuses to save it, `extraFieldProblems`).
  if (decl.extraAxes !== undefined && typeof values[FIELD_EXTRA_AXES] === 'string') {
    const parsed = parseExtraAxes(values[FIELD_EXTRA_AXES] as string);
    if (parsed.errors.length === 0) {
      if (parsed.axes.length > 0) params.extraAxes = parsed.axes;
      else delete params.extraAxes;
    }
  }
  if (decl.builderCodes !== undefined && typeof values[FIELD_BUILDER_CODES] === 'string') {
    const text = (values[FIELD_BUILDER_CODES] as string).trim();
    if (text !== '') params.builderCodes = text;
    else delete params.builderCodes;
  }

  const name = typeof values[FIELD_NAME] === 'string' ? (values[FIELD_NAME] as string).trim() : '';
  const notes = typeof values[FIELD_NOTES] === 'string' ? (values[FIELD_NOTES] as string).trim() : '';
  return { name, notes, params };
}

/** The longest text of the extra axes field: 16 names of 8 letters with ", " and " rotary". */
export const EXTRA_AXES_TEXT_LENGTH = MAX_EXTRA_AXES * (8 + 7 + 2);

/**
 * P4h (§6.10 rule 13): the extra axes field's text. Names are separated by commas (or
 * semicolons); each is 2 to 8 letters, stored in capitals, optionally followed by "rotary" or
 * "linear" (the default). Every item that cannot be read is an error that quotes it.
 */
export function parseExtraAxes(text: string): { axes: ExtraAxis[]; errors: Msg[] } {
  const axes: ExtraAxis[] = [];
  const errors: Msg[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[,;\n]/)) {
    const item = raw.trim();
    if (item === '') continue;
    const parts = item.split(/\s+/);
    const kind = parts.length === 2 ? parts[1].toLowerCase() : 'linear';
    if (parts.length > 2 || !EXTRA_AXIS_NAME.test(parts[0]) || (kind !== 'linear' && kind !== 'rotary')) {
      errors.push({ key: 'machines.extra.notAxis', params: { item } });
      continue;
    }
    const name = parts[0].toUpperCase();
    if (seen.has(name)) {
      errors.push({ key: 'machines.extra.twice', params: { name } });
      continue;
    }
    seen.add(name);
    axes.push({ name, kind });
  }
  if (errors.length === 0 && axes.length > MAX_EXTRA_AXES) errors.push({ key: 'machines.extra.tooMany', params: { max: MAX_EXTRA_AXES } });
  return { axes, errors };
}

/**
 * P4h (§6.10 rules 13, 14): the problems of the two fields, by field id. A text the field cannot
 * read says so first; otherwise the record's own rules speak (`validateMachine`, run by the
 * caller on the machine the form describes and handed in as `problems`): a name the profile
 * already reads, a builder code gEdit knows, a list it cannot read.
 */
export function extraFieldErrors(
  decl: MachineParamsDecl,
  values: Readonly<Record<string, unknown>>,
  problems: readonly { path: string; message: string }[],
): Record<string, Msg> {
  const errors: Record<string, Msg> = {};
  const fromRecord = (member: string): Msg | undefined => {
    const found = problems.find((problem) => /\.params\.(\w+)/.exec(problem.path)?.[1] === member);
    return found ? { key: 'machines.extra.problem', params: { message: found.message } } : undefined;
  };
  if (decl.extraAxes !== undefined && typeof values[FIELD_EXTRA_AXES] === 'string') {
    const parsed = parseExtraAxes(values[FIELD_EXTRA_AXES] as string);
    const error = parsed.errors[0] ?? fromRecord('extraAxes');
    if (error) errors[FIELD_EXTRA_AXES] = error;
  }
  if (decl.builderCodes !== undefined && typeof values[FIELD_BUILDER_CODES] === 'string') {
    const error = fromRecord('builderCodes');
    if (error) errors[FIELD_BUILDER_CODES] = error;
  }
  return errors;
}

/** The field's text of stored extra axes: `AA, BB rotary`. Tolerant of a hand-written list. */
export function formatExtraAxes(axes: readonly ExtraAxis[] | undefined): string {
  if (!Array.isArray(axes)) return '';
  return axes
    .filter((axis) => isRecord(axis) && typeof axis.name === 'string')
    .map((axis) => (axis.kind === 'rotary' ? `${axis.name} rotary` : axis.name))
    .join(', ');
}

/**
 * Power-on codes the rebuilt form no longer offers, reset to "dialect default" **in
 * place**, and handed back so the caller can say what it took away.
 *
 * It happens when the user switches the G-code system while a power-on code of the old
 * system is set: `G99` is a feed mode in system A and a cycle-return code in system B, and
 * keeping it would set a feed mode no code of the machine's own database can produce.
 */
export function pruneModalValues(
  values: Record<string, unknown>,
  fields: readonly FieldSpec[],
): string[] {
  const dropped: string[] = [];
  for (const field of fields) {
    if (modalGroupOf(field.id) === null) continue;
    const value = values[field.id];
    if (typeof value !== 'string' || value === PROFILE_DEFAULT) continue;
    if ((field.choices ?? []).some((choice) => choice.value === value)) continue;
    values[field.id] = PROFILE_DEFAULT;
    dropped.push(value);
  }
  return dropped;
}

/** 'set by the machine' / 'detected in this program' / 'dialect default, assumed'. */
export function sourceLabel(source: ParamSource): string {
  switch (source) {
    case 'machine':
      return t('machines.source.machine');
    case 'detected':
      return t('machines.source.detected');
    default:
      return t('machines.source.profile');
  }
}

/** `How the control reads numbers: … — set by the machine`. */
function line(label: string, value: string, source: ParamSource): string {
  return `${label}: ${value} — ${sourceLabel(source)}`;
}

/**
 * Every effective parameter with its source, one line each — the status item's tooltip
 * (AD-31 "Selection UI").
 *
 * The point of the list is that a value can be **checked**: "feed per revolution" alone
 * tells nobody whether the control really powers up that way or gEdit guessed it from the
 * dialect's documentation.
 *
 * `initial` is the **dialect's** own power-on state (`profile.modal.initial`), and it is
 * what makes that promise true of the assumption that matters most. `params.modalInitial`
 * holds only what a machine sets, so a document with no machine — where every group is
 * assumed — listed number input, units, diameter and the G-code system and said nothing
 * at all about the assumed `G99` that decides whether every `F` of the program is read per
 * revolution or per minute (G8 M6). A group the machine sets shadows the dialect's, and
 * the source column tells the two apart.
 *
 * `diameterWords` is the profile's `addresses.diameter`, which the diameter line names.
 */
export function machineSummaryLines(
  eff: EffectiveMachine,
  decl: MachineParamsDecl | undefined,
  initial?: Readonly<Record<string, string>>,
  diameterWords?: readonly string[],
): string[] {
  const lines: string[] = [];
  const params = eff.params;

  if (decl?.numberInput !== undefined) {
    const match = matchOf(decl, params.numberInput);
    lines.push(
      line(
        t('machines.param.numberInput'),
        match?.preset.label ?? t('machines.value.custom'),
        eff.source.numberInput,
      ),
    );
    // T084: how a point-less feed counts, where the preset counts feeds at all.
    const feeds = feedsDeclOf(decl);
    const counts = match !== null && POINTLESS_FEED_CLASSES.some((cls) => countsFeed(match.preset.value, cls));
    if (feeds !== undefined && counts) {
      const choice = match.feeds ?? feedChoicesOf(feeds)[0];
      if (choice !== undefined) lines.push(line(t('machines.param.pointlessFeeds'), choice.label, eff.source.numberInput));
    }
  }
  lines.push(
    line(
      t('machines.param.units'),
      params.units === 'inch' ? t('machines.value.inch') : t('machines.value.mm'),
      eff.source.units,
    ),
  );
  if (params.diameter !== null) {
    lines.push(
      line(
        diameterLabel(diameterWords),
        params.diameter === 'on' ? t('machines.value.on') : t('machines.value.off'),
        eff.source.diameter,
      ),
    );
  }
  for (const variant of variantsOf(decl)) {
    if (typeof variant?.id !== 'string') continue;
    const value = params.variants[variant.id];
    if (value === undefined) continue;
    const choice = (Array.isArray(variant.choices) ? variant.choices : []).find(
      (entry) => entry?.value === value,
    );
    lines.push(line(variant.label, choice?.label ?? value, eff.source.variants[variant.id] ?? 'profile'));
  }
  // The groups the dialect offers, in its own order, with what the machine says over it.
  const modal: Record<string, string> = { ...(initial ?? {}), ...params.modalInitial };
  for (const [group, code] of Object.entries(modal)) {
    lines.push(line(groupLabel(group), code, eff.source.modalInitial[group] ?? 'profile'));
  }
  return lines;
}

/** The tooltip of the status item: the machine, its parameters and what a click does. */
export function machineTooltip(
  eff: EffectiveMachine,
  decl: MachineParamsDecl | undefined,
  initial?: Readonly<Record<string, string>>,
  diameterWords?: readonly string[],
): string {
  const head =
    eff.name === null ? t('machines.tooltip.none') : t('machines.tooltip.machine', { name: eff.name });
  return [head, ...machineSummaryLines(eff, decl, initial, diameterWords), t('machines.tooltip.hint')].join('\n');
}
