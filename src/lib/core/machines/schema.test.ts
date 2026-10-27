// The machines schema against the hand-written checks (Phase 4 plan AD-57, §6.10 rules 1–5).
// Prelude stub: P4.39b writes the rows. `readMachine`, `validateMachine`, `channelBlock`,
// `motionBlock` and `limitsBlock` stay the gate; this test holds the schema to the same answer on
// the shape of a record, and lists the rules that need the profile (VALIDATOR_ONLY).

import { describe, expect, it } from 'vitest';
import machinesSchema from '../../../../schemas/machines.schema.json';

describe('schemas/machines.schema.json (P4.39b)', () => {
  it('is a draft 2020-12 schema with the id exported files point at', () => {
    expect(machinesSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(machinesSchema.$id).toBe('https://raw.githubusercontent.com/CNC-Master-xyz/gEdit/main/schemas/machines.schema.json');
  });

  it.todo('compiles with the test validator, every keyword in the allowed list (rule 3)');
  it.todo('accepts every machines file of tests/fixtures/machines/files/ the code accepts (rule 2)');
  it.todo('agrees with the checks on each broken record of tests/fixtures/p4h/machines/broken/ (rule 2)');
  it.todo('keeps unknown members at every level, as the file reader does (rule 1)');
  it.todo('covers channels with withCodes, sharesWaitsWith, markSeparator and markValues (rule 5)');
  it.todo('covers motion, limits, extraAxes and builderCodes (rule 5)');
  it.todo('every channel preset of every built-in profile validates under $defs/channelParams (rule 1)');
});
