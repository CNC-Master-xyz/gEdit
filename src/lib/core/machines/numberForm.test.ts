// The per-class number input (plan §6.10 rule 12). Prelude stub: P4.43a writes the rows.

import { describe, expect, it } from 'vitest';
import { NumberFormNotImplemented, numberRows } from './numberForm';

describe('numberForm (P4.43a)', () => {
  it('is a stub until P4.43a', () => {
    expect(() => numberRows({ mode: 'increment', incrementMm: '0.001' })).toThrow(NumberFormNotImplemented);
  });

  it.todo('numberRows gives the five classes of every built-in preset, inch increments only where a class follows the units');
  it.todo('numberInputFromRows writes a classes entry only for a row that differs; rows equal to the base give the base back');
  it.todo('a point-less-feed choice shows as the feed rows it changed');
  it.todo('numberRowProblems answers what numberInputProblems answers for the saved value');
  it.todo('every value reads back through numbers.ts and _nc_machine.py the same (the shared goldens)');
});
