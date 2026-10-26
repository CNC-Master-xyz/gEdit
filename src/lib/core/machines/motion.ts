// A machine's motion data and limits (Phase 4 plan §6.4, AD-46). Written by P4.8 on the
// signatures of the P4b prelude; the page "Motion and limits"
// (`components/dialogs/MachineMotionForm.svelte`) reads and writes through it.
//
// The rule of `channelBlock` (`validate.ts`) holds here too: these blocks do not change how a
// program is read, so a broken block costs the block and never the record. `validateMachine`
// never reports them; the Machines page lists their problems with JSON paths, the scripts get
// no `motion` or `limits` member, and every other parameter of the machine stays in use.
//
// Nothing here has a default that stands for a machine (Q4-10): a value is set by the user
// from the machine's documentation or it is not set, and whatever needs it says so.
//
// Four parts:
//   1. the bounds and the one number check both the validator and the form read;
//   2. `validateMotion`/`validateLimits` and the two `…Block` functions (the contract);
//   3. the form's values and the blocks they make (`motionToValues`, `blocksFromValues`,
//      `blockIssues`), so the page's rules are pure functions and testable without a DOM;
//   4. the script header's `prefill = "machine.motion.<member>"` (§6.4 rule 5), a closed
//      list of members that is looked up and never evaluated.

import type { MachineConfig, MachineLimits, MachineMotion, MachineProblem } from './types';

/**
 * The bounds a value has to keep (in mm, mm/min, rpm, seconds; an inch value is held to the
 * mm bound divided by 25.4, a rotary rate in degrees per minute to `rapidRotary`). A value
 * outside is refused with its JSON path: not a guess at a typo, a refusal (plan §6.4 rule 2).
 */
export const MOTION_BOUNDS = {
  /** Linear rapid and top feed, mm/min: above 0 and at most this. */
  rate: 200_000,
  /** Rotary rapid, degrees per minute. */
  rapidRotary: 1_000_000,
  /** Tool change, seconds: 0 or more and at most this. */
  toolChange: 600,
  /** Peck retract and clearance, mm: above 0 and at most this. */
  peck: 100,
  /** Spindle speed, rpm: above 0 and at most this. */
  spindle: 200_000,
  /** Travel ends, mm (degrees for a rotary axis: ±100,000 too); `min` below `max`. */
  travel: 100_000,
} as const;

/** What a stored machine's `params.motion` amounts to (the shape of `ChannelBlock`). */
export type MotionBlock =
  | { state: 'absent' }
  | { state: 'valid'; motion: MachineMotion }
  | { state: 'invalid'; problems: MachineProblem[] };

/** What a stored machine's `params.limits` amounts to. */
export type LimitsBlock =
  | { state: 'absent' }
  | { state: 'valid'; limits: MachineLimits }
  | { state: 'invalid'; problems: MachineProblem[] };

/** The profile's axis letters and the ones of them that are rotary (`addresses.axes`, `.angular`). */
export interface AxisSets {
  axes: readonly string[];
  angular: readonly string[];
}

type Units = 'mm' | 'inch';

const MM_PER_INCH = 25.4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const MOTION_MEMBERS = ['units', 'rapid', 'rapidKind', 'maxFeed', 'toolChange', 'peckRetract', 'peckClearance'] as const;
const LIMITS_MEMBERS = ['units', 'spindle', 'travel'] as const;
const RAPID_KINDS = ['straight', 'per-axis'] as const;

/** A speed address as a spindle key: `S2`, `SB`; `main` is the plain speed word. */
export const SPINDLE_KEY_RE = /^[A-Z][A-Z0-9]{0,3}$/;

// ---------------------------------------------------------------------------
// 1. Bounds and the number check
// ---------------------------------------------------------------------------

/** What a number is: the bound it keeps and the range it may take. */
export type NumberKind = 'rate' | 'rapidRotary' | 'toolChange' | 'peck' | 'spindle' | 'travel';

/** Why a number is refused: not a number at all, below its range, above its bound. */
export type NumberFault = 'notNumber' | 'tooLow' | 'tooHigh';

/** True for the kinds whose bound is a length or a linear rate: an inch value is held to the bound ÷ 25.4. */
function scalesWithUnits(kind: NumberKind, rotary: boolean): boolean {
  return (kind === 'rate' || kind === 'peck' || kind === 'travel') && !rotary;
}

/** The bound of a kind in the given units (the exact bound, used for the comparison). */
export function boundOf(kind: NumberKind, units: Units, rotary = false): number {
  const mm = MOTION_BOUNDS[kind];
  return units === 'inch' && scalesWithUnits(kind, rotary) ? mm / MM_PER_INCH : mm;
}

/**
 * A bound as shown to the user: grouped by thousands, cut (never rounded up) to two decimals,
 * so a value typed exactly as shown is never refused.
 */
export function boundText(bound: number): string {
  const cut = Math.floor(bound * 100 + 1e-9) / 100;
  return cut.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** The fault of one number against its kind, or `null`. A string, `null` or `NaN` is no number. */
export function numberFault(kind: NumberKind, value: unknown, units: Units, rotary = false): NumberFault | null {
  if (!isNumber(value)) return 'notNumber';
  const bound = boundOf(kind, units, rotary);
  if (kind === 'travel') {
    if (value < -bound) return 'tooLow';
    return value > bound ? 'tooHigh' : null;
  }
  if (kind === 'toolChange') {
    if (value < 0) return 'tooLow';
  } else if (value <= 0) {
    return 'tooLow';
  }
  return value > bound ? 'tooHigh' : null;
}

/** The unit a number of this kind is counted in, as the messages say it. */
function unitWord(kind: NumberKind, units: Units, rotary: boolean): string {
  switch (kind) {
    case 'rapidRotary':
      return 'degrees/min';
    case 'toolChange':
      return 'seconds';
    case 'spindle':
      return 'rpm';
    case 'rate':
      return `${units}/min`;
    case 'peck':
      return units;
    case 'travel':
      return rotary ? 'degrees' : units;
  }
}

/** The plain sentence of the rule: "a rapid rate is a number of mm/min above 0 and at most 200,000". */
function ruleText(what: string, kind: NumberKind, units: Units, rotary: boolean): string {
  const bound = boundText(boundOf(kind, units, rotary));
  const unit = unitWord(kind, units, rotary);
  if (kind === 'travel') return `${what} is a number of ${unit} between -${bound} and ${bound}`;
  if (kind === 'toolChange') return `${what} is a number of ${unit}, 0 or more and at most ${bound}`;
  return `${what} is a number of ${unit} above 0 and at most ${bound}`;
}

// ---------------------------------------------------------------------------
// 2. The validators and the blocks
// ---------------------------------------------------------------------------

interface Sink {
  problems: MachineProblem[];
  add(at: string, message: string): void;
}

function sink(id: string | null): Sink {
  const problems: MachineProblem[] = [];
  return { problems, add: (path, message) => problems.push({ machineId: id, path, message }) };
}

/** `units` of a block: the value when it is one, else mm (the messages need some unit), and whether it was usable. */
function unitsOf(raw: Record<string, unknown>, path: string, out: Sink): { units: Units; ok: boolean } {
  const value = raw.units;
  if (value === undefined) return { units: 'mm', ok: false };
  if (value === 'mm' || value === 'inch') return { units: value, ok: true };
  out.add(`${path}.units`, 'the units are "mm" or "inch"');
  return { units: 'mm', ok: false };
}

function unknownMembers(raw: Record<string, unknown>, known: readonly string[], path: string, what: string, out: Sink): void {
  for (const key of Object.keys(raw)) {
    if (!known.includes(key)) out.add(`${path}.${key}`, `"${key}" is not a member of the ${what}; its members are ${known.join(', ')}`);
  }
}

function checkNumber(
  raw: unknown,
  at: string,
  what: string,
  kind: NumberKind,
  units: Units,
  rotary: boolean,
  out: Sink,
): void {
  if (numberFault(kind, raw, units, rotary) !== null) out.add(at, ruleText(what, kind, units, rotary));
}

const NEEDS_UNITS = 'choose mm or inch: every length and rate in this block is read in it';

/**
 * The problems of a raw `motion` block, each with a JSON path under `path`
 * (`machines[2].params.motion.rapid.X`). `axes`/`angular`: the profile's `addresses.axes`
 * and `addresses.angular`, so a rate names an axis of the profile and a rotary rate is read
 * in degrees.
 */
export function validateMotion(raw: unknown, path: string, id: string | null, o: AxisSets): MachineProblem[] {
  const out = sink(id);
  if (!isRecord(raw)) {
    out.add(path, 'the motion block is an object with units, rapid, rapidKind, maxFeed, toolChange, peckRetract and peckClearance; to have none, remove it');
    return out.problems;
  }
  unknownMembers(raw, MOTION_MEMBERS, path, 'motion block', out);
  const { units, ok } = unitsOf(raw, path, out);
  let needsUnits = false;

  const rapid = raw.rapid;
  if (rapid !== undefined) {
    if (!isRecord(rapid)) {
      out.add(`${path}.rapid`, 'the rapid rates are an object with one rate per axis letter, for example { "X": 30000 }');
    } else {
      for (const [axis, rate] of Object.entries(rapid)) {
        const at = `${path}.rapid.${axis}`;
        if (!o.axes.includes(axis)) {
          out.add(at, `${axis} is not an axis of this dialect; its axes are ${o.axes.join(', ')}`);
          continue;
        }
        needsUnits = true;
        const rotary = o.angular.includes(axis);
        checkNumber(rate, at, rotary ? `the rapid rate of ${axis}` : 'a rapid rate', rotary ? 'rapidRotary' : 'rate', units, rotary, out);
      }
    }
  }
  if (raw.rapidKind !== undefined && !RAPID_KINDS.includes(raw.rapidKind as (typeof RAPID_KINDS)[number])) {
    out.add(`${path}.rapidKind`, 'the rapid kind is "straight" (all axes on one line) or "per-axis" (each axis at its own rate)');
  }
  if (raw.maxFeed !== undefined) {
    needsUnits = true;
    checkNumber(raw.maxFeed, `${path}.maxFeed`, 'the top feed', 'rate', units, false, out);
  }
  if (raw.toolChange !== undefined) checkNumber(raw.toolChange, `${path}.toolChange`, 'the tool-change time', 'toolChange', units, false, out);
  if (raw.peckRetract !== undefined) {
    needsUnits = true;
    checkNumber(raw.peckRetract, `${path}.peckRetract`, 'the peck retract', 'peck', units, false, out);
  }
  if (raw.peckClearance !== undefined) {
    needsUnits = true;
    checkNumber(raw.peckClearance, `${path}.peckClearance`, 'the peck clearance', 'peck', units, false, out);
  }
  if (needsUnits && !ok && raw.units === undefined) out.add(`${path}.units`, NEEDS_UNITS);
  return out.problems;
}

/** The problems of a raw `limits` block, as `validateMotion`. */
export function validateLimits(raw: unknown, path: string, id: string | null, o: AxisSets): MachineProblem[] {
  const out = sink(id);
  if (!isRecord(raw)) {
    out.add(path, 'the limits block is an object with units, spindle and travel; to have none, remove it');
    return out.problems;
  }
  unknownMembers(raw, LIMITS_MEMBERS, path, 'limits block', out);
  const { units, ok } = unitsOf(raw, path, out);
  let needsUnits = false;

  const spindle = raw.spindle;
  if (spindle !== undefined) {
    if (!isRecord(spindle)) {
      out.add(`${path}.spindle`, 'the spindle limits are an object with one top speed per spindle, for example { "main": 4000, "S2": 3000 }');
    } else {
      for (const [key, speed] of Object.entries(spindle)) {
        const at = `${path}.spindle.${key}`;
        if (key !== 'main' && !SPINDLE_KEY_RE.test(key)) {
          out.add(at, `"${key}" is not a spindle: use "main" for the plain speed word, or the speed address such as S2 or SB`);
          continue;
        }
        checkNumber(speed, at, key === 'main' ? 'the top speed of the main spindle' : `the top speed of ${key}`, 'spindle', units, false, out);
      }
    }
  }

  const travel = raw.travel;
  if (travel !== undefined) {
    if (!isRecord(travel)) {
      out.add(`${path}.travel`, 'the travel is an object with one entry per axis letter, for example { "X": { "min": -300, "max": 300 } }');
    } else {
      for (const [axis, entry] of Object.entries(travel)) {
        const at = `${path}.travel.${axis}`;
        if (!o.axes.includes(axis)) {
          out.add(at, `${axis} is not an axis of this dialect; its axes are ${o.axes.join(', ')}`);
          continue;
        }
        needsUnits = true;
        const rotary = o.angular.includes(axis);
        const what = `the travel of ${axis}`;
        if (!isRecord(entry)) {
          out.add(at, `${what} is { "min": …, "max": … } in machine coordinates`);
          continue;
        }
        for (const key of Object.keys(entry)) {
          if (key !== 'min' && key !== 'max') out.add(`${at}.${key}`, `"${key}" is not a member of the travel; it has min and max`);
        }
        let usable = true;
        for (const end of ['min', 'max'] as const) {
          if (numberFault('travel', entry[end], units, rotary) !== null) {
            usable = false;
            out.add(`${at}.${end}`, ruleText(`the ${end === 'min' ? 'lowest' : 'highest'} position of ${axis}`, 'travel', units, rotary));
          }
        }
        if (usable && (entry.min as number) >= (entry.max as number)) {
          out.add(at, `${what} has its lowest position (min) below its highest (max)`);
        }
      }
    }
  }
  if (needsUnits && !ok && raw.units === undefined) out.add(`${path}.units`, NEEDS_UNITS);
  return out.problems;
}

function paramsOf(m: MachineConfig): Record<string, unknown> {
  return isRecord(m.params) ? (m.params as Record<string, unknown>) : {};
}

/** The motion block of one stored machine, for the page and the script context. */
export function motionBlock(m: MachineConfig, path: string, o: AxisSets): MotionBlock {
  const raw = paramsOf(m).motion;
  if (raw === undefined) return { state: 'absent' };
  const id = typeof m.id === 'string' ? m.id : null;
  const problems = validateMotion(raw, `${path}.params.motion`, id, o);
  if (problems.length > 0) return { state: 'invalid', problems };
  return { state: 'valid', motion: structuredClone(raw) as MachineMotion };
}

/** The limits block of one stored machine. */
export function limitsBlock(m: MachineConfig, path: string, o: AxisSets): LimitsBlock {
  const raw = paramsOf(m).limits;
  if (raw === undefined) return { state: 'absent' };
  const id = typeof m.id === 'string' ? m.id : null;
  const problems = validateLimits(raw, `${path}.params.limits`, id, o);
  if (problems.length > 0) return { state: 'invalid', problems };
  return { state: 'valid', limits: structuredClone(raw) as MachineLimits };
}

// ---------------------------------------------------------------------------
// 3. The page's values and the blocks they make
// ---------------------------------------------------------------------------

/** Field ids of the page; stable, the runtime scenarios read `data-field`. */
export const MV = {
  units: 'units',
  rapidKind: 'rapidKind',
  maxFeed: 'maxFeed',
  toolChange: 'toolChange',
  peckRetract: 'peckRetract',
  peckClearance: 'peckClearance',
  spindleMain: 'spindle.main',
  spindleOthers: 'spindle.others',
  rapid: (axis: string): string => `rapid.${axis}`,
  travelMin: (axis: string): string => `travel.${axis}.min`,
  travelMax: (axis: string): string => `travel.${axis}.max`,
} as const;

/** What the page reads from a stored value: a number as itself, anything else as its text so its error shows. */
function shown(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (isNumber(value)) return value;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** The "other spindles" field as text: `S2=4000, SB=3000`. */
export function spindleOthersText(spindle: Record<string, unknown>): string {
  return Object.entries(spindle)
    .filter(([key]) => key !== 'main')
    .map(([key, value]) => `${key}=${String(shown(value) ?? '')}`)
    .join(', ');
}

/**
 * The text of "other spindles" as entries. A part that is not `address=speed` (and `main=`,
 * which has its own field) goes to `bad`
 * and is never guessed at; a speed that is not a number stays text so the number check names it.
 */
export function parseSpindleOthers(text: string): { entries: Record<string, number | string>; bad: string[] } {
  const entries: Record<string, number | string> = {};
  const bad: string[] = [];
  for (const part of text.split(/[,;\n]/)) {
    const piece = part.trim();
    if (piece === '') continue;
    const match = /^([A-Za-z][A-Za-z0-9]{0,3})\s*=\s*(.*)$/.exec(piece);
    if (match === null || match[2].trim() === '') {
      bad.push(piece);
      continue;
    }
    const key = match[1].toUpperCase();
    const speed = match[2].trim();
    // `main` is the page's own "Main spindle" field; typed here it would be stored as the key MAIN.
    if (key === 'MAIN' || Object.hasOwn(entries, key)) {
      bad.push(piece);
      continue;
    }
    entries[key] = speed !== '' && Number.isFinite(Number(speed)) ? Number(speed) : speed;
  }
  return { entries, bad };
}

/**
 * The page's values for the two stored blocks, read leniently: what is there is shown, what
 * is not usable shows as its text (so its error is visible) and what the page has no field
 * for is left out. One `units` for both blocks; when the two blocks disagree it starts empty,
 * and the page asks for a choice.
 */
export function motionToValues(motionRaw: unknown, limitsRaw: unknown): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const motion = isRecord(motionRaw) ? motionRaw : {};
  const limits = isRecord(limitsRaw) ? limitsRaw : {};
  const unit = (raw: Record<string, unknown>): Units | undefined => (raw.units === 'mm' || raw.units === 'inch' ? raw.units : undefined);
  const a = unit(motion);
  const b = unit(limits);
  values[MV.units] = a !== undefined && b !== undefined && a !== b ? '' : (a ?? b ?? '');
  if (isRecord(motion.rapid)) {
    for (const [axis, rate] of Object.entries(motion.rapid)) values[MV.rapid(axis)] = shown(rate);
  }
  values[MV.rapidKind] = RAPID_KINDS.includes(motion.rapidKind as (typeof RAPID_KINDS)[number]) ? motion.rapidKind : '';
  for (const key of ['maxFeed', 'toolChange', 'peckRetract', 'peckClearance'] as const) {
    if (motion[key] !== undefined) values[key] = shown(motion[key]);
  }
  if (isRecord(limits.spindle)) {
    if (limits.spindle.main !== undefined) values[MV.spindleMain] = shown(limits.spindle.main);
    values[MV.spindleOthers] = spindleOthersText(limits.spindle);
  }
  if (isRecord(limits.travel)) {
    for (const [axis, entry] of Object.entries(limits.travel)) {
      if (!isRecord(entry)) continue;
      if (entry.min !== undefined) values[MV.travelMin(axis)] = shown(entry.min);
      if (entry.max !== undefined) values[MV.travelMax(axis)] = shown(entry.max);
    }
  }
  return values;
}

/** The text of a text field; anything else is no text. */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** A value the page holds for a number field: a number or unparsable text counts as set, a blank does not. */
function filled(value: unknown): number | string | undefined {
  if (isNumber(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  return undefined;
}

/** `Number(text)` for a field that holds text because it did not parse; otherwise the number. */
function numeric(value: number | string): number | string {
  return typeof value === 'number' ? value : Number.isFinite(Number(value)) ? Number(value) : value;
}

/**
 * The blocks the page's values make, as raw JSON (a field that does not parse stays text, so
 * `validateMotion`/`validateLimits` name it). An empty block is `undefined`: saving an empty
 * field removes the member and an empty block removes the block (§6.4 rule 4). `units` is
 * written into a block that has anything else and only then.
 */
export function blocksFromValues(values: Record<string, unknown>, o: AxisSets): { motion?: Record<string, unknown>; limits?: Record<string, unknown> } {
  const units = values[MV.units] === 'mm' || values[MV.units] === 'inch' ? values[MV.units] : undefined;
  const motion: Record<string, unknown> = {};
  const limits: Record<string, unknown> = {};

  const rapid: Record<string, unknown> = {};
  for (const axis of o.axes) {
    const rate = filled(values[MV.rapid(axis)]);
    if (rate !== undefined) rapid[axis] = numeric(rate);
  }
  if (Object.keys(rapid).length > 0) motion.rapid = rapid;
  if (RAPID_KINDS.includes(values[MV.rapidKind] as (typeof RAPID_KINDS)[number])) motion.rapidKind = values[MV.rapidKind];
  for (const key of ['maxFeed', 'toolChange', 'peckRetract', 'peckClearance'] as const) {
    const value = filled(values[key]);
    if (value !== undefined) motion[key] = numeric(value);
  }

  const spindle: Record<string, unknown> = {};
  const main = filled(values[MV.spindleMain]);
  if (main !== undefined) spindle.main = numeric(main);
  const others = parseSpindleOthers(textOf(values[MV.spindleOthers])).entries;
  Object.assign(spindle, others);
  if (Object.keys(spindle).length > 0) limits.spindle = spindle;

  const travel: Record<string, unknown> = {};
  for (const axis of o.axes) {
    const min = filled(values[MV.travelMin(axis)]);
    const max = filled(values[MV.travelMax(axis)]);
    if (min === undefined && max === undefined) continue;
    const entry: Record<string, unknown> = {};
    if (min !== undefined) entry.min = numeric(min);
    if (max !== undefined) entry.max = numeric(max);
    travel[axis] = entry;
  }
  if (Object.keys(travel).length > 0) limits.travel = travel;

  const out: { motion?: Record<string, unknown>; limits?: Record<string, unknown> } = {};
  if (Object.keys(motion).length > 0) out.motion = units === undefined ? motion : { units, ...motion };
  if (Object.keys(limits).length > 0) out.limits = units === undefined ? limits : { units, ...limits };
  return out;
}

/** What a field is wrong with, as a catalog key and its parameters (the form shows `t(key, params)`). */
export interface FieldIssue {
  key: string;
  params?: Record<string, string | number>;
}

function faultIssue(kind: NumberKind, units: Units, rotary: boolean): FieldIssue {
  const bound = boundText(boundOf(kind, units, rotary));
  if (kind === 'travel') return { key: 'machines.motion.err.between', params: { max: bound } };
  if (kind === 'toolChange') return { key: 'machines.motion.err.from0', params: { max: bound } };
  return { key: 'machines.motion.err.above0', params: { max: bound } };
}

/**
 * The messages of the page's values, one per field that fails (§6.4 rule 2, said next to the
 * field). The rules are `numberFault`'s, the validators' own; two more belong to the form
 * alone: a position needs both its ends, and a length or rate needs the units chosen.
 */
export function blockIssues(values: Record<string, unknown>, o: AxisSets): Record<string, FieldIssue> {
  const issues: Record<string, FieldIssue> = {};
  const units: Units = values[MV.units] === 'inch' ? 'inch' : 'mm';
  let needsUnits = false;

  const number = (id: string, kind: NumberKind, rotary = false, lengthOrRate = false): number | string | undefined => {
    const value = filled(values[id]);
    if (value === undefined) return undefined;
    if (lengthOrRate) needsUnits = true;
    if (numberFault(kind, numeric(value), units, rotary) !== null) issues[id] = faultIssue(kind, units, rotary);
    return numeric(value);
  };

  for (const axis of o.axes) {
    const rotary = o.angular.includes(axis);
    number(MV.rapid(axis), rotary ? 'rapidRotary' : 'rate', rotary, true);
  }
  number(MV.maxFeed, 'rate', false, true);
  number(MV.toolChange, 'toolChange');
  number(MV.peckRetract, 'peck', false, true);
  number(MV.peckClearance, 'peck', false, true);
  number(MV.spindleMain, 'spindle');

  const others = parseSpindleOthers(textOf(values[MV.spindleOthers]));
  if (others.bad.length > 0) issues[MV.spindleOthers] = { key: 'machines.motion.err.spindles', params: { part: others.bad[0] } };
  else {
    for (const [key, speed] of Object.entries(others.entries)) {
      if (numberFault('spindle', speed, units) !== null) {
        issues[MV.spindleOthers] = { key: 'machines.motion.err.otherSpeed', params: { address: key, max: boundText(MOTION_BOUNDS.spindle) } };
        break;
      }
    }
  }

  for (const axis of o.axes) {
    const rotary = o.angular.includes(axis);
    const min = number(MV.travelMin(axis), 'travel', rotary, true);
    const max = number(MV.travelMax(axis), 'travel', rotary, true);
    if ((min === undefined) !== (max === undefined)) {
      issues[min === undefined ? MV.travelMin(axis) : MV.travelMax(axis)] = { key: 'machines.motion.err.bothEnds' };
    } else if (typeof min === 'number' && typeof max === 'number' && min >= max && issues[MV.travelMax(axis)] === undefined) {
      issues[MV.travelMax(axis)] = { key: 'machines.motion.err.minMax' };
    }
  }

  if (needsUnits && values[MV.units] !== 'mm' && values[MV.units] !== 'inch') issues[MV.units] = { key: 'machines.motion.err.units' };
  return issues;
}

// ---------------------------------------------------------------------------
// 4. The script header's `prefill` (§6.4 rule 5)
// ---------------------------------------------------------------------------

const PREFILL_PLAIN = ['peckRetract', 'peckClearance', 'maxFeed', 'toolChange', 'rapidKind', 'units'] as const;

/**
 * The parameter types a machine value can fill: it is a number, or the text of a choice. A text
 * field is left out because the value is handed over as a number (`validateFields` would call it
 * invalid and the field would stay empty without a word). The same list as `PREFILL_TYPES` in
 * `src-tauri/src/scripts/meta.rs`, which drops the prefill of any other type with a warning.
 */
export const PREFILL_TYPES = ['number', 'integer', 'choice'] as const;

/** The prefill member of a form field: its `prefill`, but only on a type a machine value can fill. */
export function prefillMemberOf(field: { type: string; prefill?: unknown }): string | null {
  return (PREFILL_TYPES as readonly string[]).includes(field.type) ? prefillMember(field.prefill) : null;
}

/**
 * The member a `prefill = "machine.motion.<member>"` names, or `null` for anything else.
 * The list is closed — the six plain members and `rapid.<axis>` with a speed-address-like
 * axis — so a header can only ever select one of these, never reach into the record.
 */
export function prefillMember(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const prefix = 'machine.motion.';
  if (!text.startsWith(prefix)) return null;
  const member = text.slice(prefix.length);
  if ((PREFILL_PLAIN as readonly string[]).includes(member)) return member;
  const axis = /^rapid\.([A-Z][A-Z0-9]{0,3})$/.exec(member);
  return axis === null ? null : member;
}

/**
 * The machine's value for one prefill member: a number or a text, or `undefined` while the
 * machine has none (the field stays empty). `motion` is a **valid** block (`motionBlock`).
 */
export function prefillValue(member: string, motion: MachineMotion | undefined): number | string | undefined {
  if (motion === undefined) return undefined;
  const rapid = /^rapid\.(.+)$/.exec(member);
  if (rapid !== null) {
    const rates = motion.rapid;
    return rates !== undefined && Object.hasOwn(rates, rapid[1]) ? rates[rapid[1]] : undefined;
  }
  if (!(PREFILL_PLAIN as readonly string[]).includes(member)) return undefined;
  const value = (motion as Record<string, unknown>)[member];
  return isNumber(value) || typeof value === 'string' ? value : undefined;
}
