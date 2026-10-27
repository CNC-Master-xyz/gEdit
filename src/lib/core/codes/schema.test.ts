// The code database schema against the loader (Phase 4 plan §6.10 rules 1–5; §7 row of the P4h
// prelude: a third schema, for the user code files). Prelude stub: P4.39b writes the rows. The
// loader drops what it does not understand and reports it; the schema agrees when it refuses a
// file exactly where `loadCodeDb` / `loadTemplates` report at least one problem.

import { describe, expect, it } from 'vitest';
import codesSchema from '../../../../schemas/codes.schema.json';

describe('schemas/codes.schema.json (P4.39b)', () => {
  it('is a draft 2020-12 schema with the id exported files point at', () => {
    expect(codesSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(codesSchema.$id).toBe('https://raw.githubusercontent.com/CNC-Master-xyz/gEdit/main/schemas/codes.schema.json');
  });

  it.todo('compiles with the test validator, every keyword in the allowed list (rule 3)');
  it.todo('accepts every built-in code file as written (extends, remove, templates included) (rule 2)');
  it.todo('agrees with the loader on each broken entry of tests/fixtures/p4h/codes/broken/ (rule 2)');
  it.todo('covers frameZero, frameCloses, turnsRotary and the code:<code> conditions (rule 5)');
  it.todo('covers expand, expandRole, dwell, twin, lengthAlong and the block-aware unit of a two-block entry (rule 5)');
});
