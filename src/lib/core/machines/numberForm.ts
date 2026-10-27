// The per-class number input of the machine dialog (Phase 4 plan §6.10 rule 12; P4.43a). Prelude
// stub: the signatures are the contract, the bodies are P4.43a's.
//
// Today a machine whose number input differs from every preset shows "Custom (edited in the
// file)". The page adds a table: one row per number class (length, angle, feed per minute, feed
// per revolution, dwell) with how the control reads a number of that class (in increments, as
// written, scaled) and its increment in mm (or degrees, seconds) and in inch. It starts from the
// machine's whole `numberInput` (the preset with the point-less-feed choice applied), and saving
// writes the whole value back, checked by `numberInputProblems` (`core/machines/validate.ts`),
// the same rules as the file. A class row equal to what the base reading gives writes no
// `classes` entry.

import type { MachineProblem, NumberClass, NumberInput, NumberReading } from './types';

/** Thrown by every function below until P4.43a writes it. */
export class NumberFormNotImplemented extends Error {
  constructor(what: string) {
    super(`${what}: the per-class number input is not built yet (P4.43a)`);
    this.name = 'NumberFormNotImplemented';
  }
}

/** The classes in the order the table shows them. */
export const NUMBER_FORM_CLASSES: readonly NumberClass[] = ['length', 'angle', 'feedPerMin', 'feedPerRev', 'dwell'];

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

/** The five rows of `input`, in `NUMBER_FORM_CLASSES` order. */
export function numberRows(input: NumberInput): NumberClassRow[] {
  void input;
  throw new NumberFormNotImplemented('numberRows');
}

/** `base` with the rows written in: a row that differs from the base reading becomes a `classes` entry. */
export function numberInputFromRows(base: NumberInput, rows: readonly NumberClassRow[]): NumberInput {
  void base;
  void rows;
  throw new NumberFormNotImplemented('numberInputFromRows');
}

/** The problems of the value the rows would save, by `numberInputProblems`, under `path`. */
export function numberRowProblems(base: NumberInput, rows: readonly NumberClassRow[], id: string | null, path: string): MachineProblem[] {
  void base;
  void rows;
  void id;
  void path;
  throw new NumberFormNotImplemented('numberRowProblems');
}
