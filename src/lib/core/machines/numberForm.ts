// The per-class number input of the machine dialog (Phase 4 plan §6.10 rule 12; P4.43a).
//
// A machine whose number input differs from every preset used to show "Custom (edited in the
// file)". The page now shows a table: one row per number class (length, angle, feed per minute,
// feed per revolution, dwell) with how the control reads a number of that class (in increments,
// as written, scaled) and its increment in mm (or degrees, seconds) and in inch. It starts from
// the machine's whole `numberInput` (the preset with the point-less-feed choice applied), and
// saving writes the whole value back, checked by `numberInputProblems`
// (`core/machines/validate.ts`), the same rules as the file. A class row equal to what the base
// reading gives writes no `classes` entry.
//
// Three rules:
//
//  1. **A row is what the machine reads** (`classReadingOf` in `numbers.ts`, the reading every
//     value of gEdit goes through), never a copy of the stored members: an inch increment the
//     input does not write shows as the tenth of the metric one the reader derives, an angle
//     without its own increment shows the digits of `incrementMm`. So a row can never say
//     something the hover would contradict.
//  2. **What did not change is written as it was.** `numberInputFromRows` keeps the input's own
//     `classes` entry of every row that equals the row it gives, so a preset's value comes back
//     as the very object, and a point-less-feed choice keeps its form. A changed row gets the
//     smallest entry that reads as the row.
//  3. **Increments are decimal text**, compared by value (`'0.0010'` is `'0.001'`) and written as
//     typed; something that is not a decimal is written too, so `numberInputProblems` names it at
//     its row instead of the form quietly dropping it.

import { canonicalDecimal, classReadingOf } from './numbers';
import { numberInputProblems } from './validate';
import type { MachineProblem, NumberClass, NumberInput, NumberReading } from './types';

/** The classes in the order the table shows them. */
export const NUMBER_FORM_CLASSES: readonly NumberClass[] = ['length', 'angle', 'feedPerMin', 'feedPerRev', 'dwell'];

/** The readings a row may choose, in the order the table offers them. */
export const NUMBER_FORM_READINGS: readonly NumberReading[] = ['increment', 'calculator', 'scale'];

/** One row of the table: how one class is read. Increments are decimal text, never numbers. */
export interface NumberClassRow {
  cls: NumberClass;
  mode: NumberReading;
  /** mm for length and the feeds, degrees for angle, seconds for dwell. */
  increment: string;
  /** Only for the classes that follow the program's units (length, the feeds); null otherwise. */
  incrementInch: string | null;
  /** True when the row is what `mode`/`incrementMm`… of the input give without a `classes` entry. */
  fromBase: boolean;
}

type ClassEntry = NonNullable<NumberInput['classes']>[NumberClass];

/** The classes whose unit follows the program's mm/inch state (and so have an inch increment). */
export function followsUnits(cls: NumberClass): boolean {
  return cls === 'length' || cls === 'feedPerMin' || cls === 'feedPerRev';
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** `input` without its entry for `cls`. */
function withoutEntry(input: NumberInput, cls: NumberClass): NumberInput {
  const out = clone(input);
  if (out.classes !== undefined) {
    delete out.classes[cls];
    if (Object.keys(out.classes).length === 0) delete out.classes;
  }
  return out;
}

/** `input` with `entry` as the entry of `cls` (none when undefined). */
function withEntry(input: NumberInput, cls: NumberClass, entry: ClassEntry | undefined): NumberInput {
  const out = withoutEntry(input, cls);
  if (entry !== undefined) out.classes = { ...(out.classes ?? {}), [cls]: entry };
  return out;
}

/** The row `input` gives for `cls`, before `fromBase` is known. */
function readRow(input: NumberInput, cls: NumberClass): Omit<NumberClassRow, 'fromBase'> {
  const mm = classReadingOf(cls, input, 'mm');
  const entryMode = input.classes?.[cls]?.mode;
  const mode: NumberReading = mm?.mode ?? entryMode ?? input.mode;
  const inch = followsUnits(cls) ? classReadingOf(cls, input, 'inch') : null;
  return { cls, mode, increment: mm?.unit ?? '', incrementInch: inch?.unit ?? null };
}

/** Two increments are the same value (both decimal text), or the same text. */
export function sameDecimal(a: string | null, b: string | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  const left = strictCanonical(a);
  return left !== null && left === strictCanonical(b);
}

/** The canonical text of a decimal written the way the machines file writes one, or null. */
function strictCanonical(text: string): string | null {
  return /^\d+(?:\.\d+)?$/.test(text) ? canonicalDecimal(text) : null;
}

function sameRow(a: Omit<NumberClassRow, 'fromBase'>, b: Omit<NumberClassRow, 'fromBase'>): boolean {
  return a.mode === b.mode && sameDecimal(a.increment, b.increment) && sameDecimal(a.incrementInch, b.incrementInch);
}

/** The five rows of `input`, in `NUMBER_FORM_CLASSES` order. */
export function numberRows(input: NumberInput): NumberClassRow[] {
  return NUMBER_FORM_CLASSES.map((cls) => {
    const row = readRow(input, cls);
    return { ...row, fromBase: sameRow(row, readRow(withoutEntry(input, cls), cls)) };
  });
}

/**
 * The smallest `classes` entry that makes `base` read `row` for its class (rule 2), or
 * undefined when the base reading already does.
 *
 * An entry's `incrementInch` is read only beside its own `increment` (`numbers.ts` `unitOf`,
 * `_nc_machine._unit_of`), so an inch step is always written with the metric one. An empty inch
 * field (null) asks for nothing: the reader's own inch step applies.
 */
function entryFor(base: NumberInput, row: NumberClassRow): ClassEntry | undefined {
  const plain = withoutEntry(base, row.cls);
  const start = readRow(plain, row.cls);
  const entry: NonNullable<ClassEntry> = {};
  if (row.mode !== start.mode) entry.mode = row.mode;
  if (!sameDecimal(row.increment, start.increment)) entry.increment = row.increment;
  if (followsUnits(row.cls) && row.incrementInch !== null) {
    const reads = readRow(withEntry(plain, row.cls, Object.keys(entry).length > 0 ? entry : undefined), row.cls);
    if (!sameDecimal(row.incrementInch, reads.incrementInch)) {
      entry.increment = row.increment;
      entry.incrementInch = row.incrementInch;
    }
  }
  return Object.keys(entry).length > 0 ? entry : undefined;
}

/** `base` with the rows written in: a row that differs from the base reading becomes a `classes` entry. */
export function numberInputFromRows(base: NumberInput, rows: readonly NumberClassRow[]): NumberInput {
  let out = clone(base);
  const before = numberRows(base);
  for (const row of rows) {
    if (!NUMBER_FORM_CLASSES.includes(row.cls)) continue;
    const was = before.find((other) => other.cls === row.cls);
    // Rule 2: a row the user did not change keeps the input's own entry as it was.
    if (was !== undefined && sameRow(was, row)) continue;
    out = withEntry(out, row.cls, entryFor(out, row));
  }
  return out;
}

/**
 * The first of `candidates` (the presets, each with every point-less-feed choice over it) that
 * reads exactly as `rows`, or null. The page puts that very object in place of the rows' own
 * value, so rows typed back to a preset are that preset again and not "Custom": the preset
 * choice matches a stored value member by member, and the rows' smallest entries are not
 * always written the way the preset writes them (an `increment` mode a preset repeats).
 */
export function inputReadingAs(candidates: readonly NumberInput[], rows: readonly NumberClassRow[]): NumberInput | null {
  const wanted = NUMBER_FORM_CLASSES.map((cls) => rows.find((r) => r.cls === cls));
  for (const candidate of candidates) {
    const own = numberRows(candidate);
    if (own.every((r, i) => wanted[i] !== undefined && sameRow(r, wanted[i] as NumberClassRow))) return candidate;
  }
  return null;
}

/** The feeds, whose inch step is not the tenth of the metric one on every control (NC-5). */
const FEED_CLASSES: readonly NumberClass[] = ['feedPerMin', 'feedPerRev'];

/**
 * The problems of the value the rows would save, by `numberInputProblems`, under `path`, and
 * the one the file cannot see (NC-5): a feed row read in increments needs its inch step written.
 * The reader would fill an empty field with a tenth of the metric step, which is right for
 * lengths and for an Okuma feed but a tenfold error for a Fanuc feed (a hundredth), and the
 * metric step of a row that was edited no longer belongs to the inch step it had. Refuse rather
 * than guess.
 */
export function numberRowProblems(base: NumberInput, rows: readonly NumberClassRow[], id: string | null, path: string): MachineProblem[] {
  const problems = numberInputProblems(numberInputFromRows(base, rows), id, path);
  for (const row of rows) {
    if (FEED_CLASSES.includes(row.cls) && row.mode === 'increment' && row.incrementInch === null) {
      problems.push({ machineId: id, path: `${path}.classes.${row.cls}.incrementInch`, message: INCH_STEP_NEEDED });
    }
  }
  return problems;
}

/** The problem of a feed row without its inch step, in the words of the form. */
export const INCH_STEP_NEEDED = 'write the inch step of this feed: on Fanuc a hundredth of the metric step, on Okuma a tenth';

/**
 * The class a problem of `numberRowProblems` belongs to (`<path>.classes.<cls>…`), or null for
 * a problem of the input as a whole (its `mode`, its `incrementMm`), which the table shows
 * below the rows.
 */
export function problemClass(problem: MachineProblem, path: string): NumberClass | null {
  const prefix = `${path}.classes.`;
  if (!problem.path.startsWith(prefix)) return null;
  const name = problem.path.slice(prefix.length).split('.')[0];
  return NUMBER_FORM_CLASSES.find((cls) => cls === name) ?? null;
}
