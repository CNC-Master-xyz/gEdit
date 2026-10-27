// The profile form (plan AD-57, §6.10 rules 7 and 8). Prelude stub: P4.40 writes the rows.

import { describe, expect, it } from 'vitest';
import { PREVIEW_LANGUAGE_ID, ProfileFormNotImplemented, formSections } from './profileForm';
import { validateProfile } from '$lib/core/profiles/validate';

describe('profileForm (P4.40)', () => {
  it('keeps the preview language out of reach of every profile id', () => {
    const result = validateProfile({ id: PREVIEW_LANGUAGE_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.startsWith('id:'))).toBe(true);
  });

  it('is a stub until P4.40', () => {
    expect(() => formSections({ schema: {}, file: {}, resolved: {}, builtin: false })).toThrow(ProfileFormNotImplemented);
  });

  it.todo('builds one section per top-level member in the schema order, with title and help from the schema');
  it.todo('shows an inherited value beside a field the file does not write, and writes nothing for it');
  it.todo('setField writes one member, removes an emptied object, keeps every member it does not offer');
  it.todo('fileText gives the original text back byte for byte when nothing changed (indentation, line ending, final newline)');
  it.todo('never offers modal.units, modal.diameter or modal.sources');
  it.todo('a built-in profile is read-only');
  it.todo('sampleProgram has a program for each grammar and machine type of the built-ins');
});
