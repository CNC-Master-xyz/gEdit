// The profile schema against the hand-written validator (Phase 4 plan AD-57, §6.10 rules 1–5).
// Prelude stub: P4.39a writes the rows. The validator stays the gate (P2 F6); this test holds the
// schema to the same answer on every built-in profile, every fixture profile and a set of broken
// ones, so a schema that drifts from `validateProfile` fails CI.

import { describe, expect, it } from 'vitest';
import profileSchema from '../../../../schemas/profile.schema.json';

describe('schemas/profile.schema.json (P4.39a)', () => {
  it('is a draft 2020-12 schema with the id exported files point at', () => {
    expect(profileSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(profileSchema.$id).toBe('https://raw.githubusercontent.com/CNC-Master-xyz/gEdit/main/schemas/profile.schema.json');
  });

  it.todo('compiles with the test validator (rule 4), every keyword in the allowed list (rule 3)');
  it.todo('accepts every built-in profile file as written, and every built-in profile as resolved (rule 2)');
  it.todo('accepts every fixture profile the validator accepts, and refuses every one it refuses (rule 2)');
  it.todo('agrees with validateProfile on each broken profile of tests/fixtures/p4h/profiles/broken/ (rule 2)');
  it.todo('refuses nothing the validator accepts: every validator-only rule is a row of VALIDATOR_ONLY (rule 2)');
  it.todo('checks completeness only without extends, and the shape of every member with it (rule 1)');
  it.todo('refuses modal.units, modal.diameter and modal.sources in a file (they are the machine\'s, rule 1)');
  it.todo('covers every member of Profile, ProfileEditing, ProfileColors and MachineParamsDecl (the member list, rule 5)');
  it.todo('covers the manual-check members: defaultBy, toolFrom last-before, the three syntax notes (rule 5)');
  it.todo('refers to machines.schema.json for numberInput and channelParams (rule 1)');
  it.todo('gives every member a title and a description, the form\'s help (rule 3)');
});
