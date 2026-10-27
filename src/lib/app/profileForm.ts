// The profile form (Phase 4 plan AD-57, §6.10 rules 7 and 8; P4.40). Prelude stub: the
// signatures are the contract, the bodies are P4.40's.
//
// The form is generated from `schemas/profile.schema.json`: one section per top-level member
// (in the schema's `x-gedit-order`), one field per member the schema marks as a form field, its
// title and help from the schema's `title` and `description`. It edits the user profile's
// **file** — the members the file writes itself — and shows what the file inherits from its
// parent (`extends`) beside each field. It never writes a resolved profile back, never writes
// `modal.units`/`diameter`/`sources`, and never removes a member it does not offer (an unknown
// member, a later-phase field and the members shown as JSON stay as written).
//
// Saving goes through the profile's **document** (the AD-40 pattern): the form's result replaces
// the text of the file's document as one undo step, and `files.save` does the rest (backup, the
// external-change check, the M13 reload, `validateProfile` as the gate). A built-in profile is
// shown read-only with "Duplicate as a user profile".

import type { Profile } from '$lib/core/profiles/types';

/** Thrown by every function below until P4.40 writes it. */
export class ProfileFormNotImplemented extends Error {
  constructor(what: string) {
    super(`${what}: the profile form is not built yet (P4.40)`);
    this.name = 'ProfileFormNotImplemented';
  }
}

/**
 * The Monaco language id of the live preview (§6.10 rule 8). It starts with `_`, which no
 * profile id can (`PROFILE_ID` in `core/profiles/validate.ts`), so the preview's grammar and its
 * theme rules (`<role>._profile-preview`) can never touch a real profile's documents.
 */
export const PREVIEW_LANGUAGE_ID = '_profile-preview';

/** How a field is edited. `json`: shown as formatted JSON, edited in the file's tab only. */
export type ProfileFieldKind =
  | 'text'
  | 'pattern'
  | 'integer'
  | 'number'
  | 'bool'
  | 'choice'
  | 'text-list'
  | 'pattern-list'
  | 'weights'
  | 'rows'
  | 'colors'
  | 'json';

/** One field of the form. Titles and help are data from the schema (English, AD-14). */
export interface ProfileFormField {
  /** The JSON path in the profile, `syntax.blockNumber.prefix`, `outline`. */
  path: string;
  title: string;
  help: string;
  kind: ProfileFieldKind;
  /** `choice`: the schema's `enum`, in its order. */
  choices?: readonly string[];
  /** `integer`, `number`: the schema's bounds. */
  min?: number;
  max?: number;
  /** `rows`: the columns of one row (`detect.content`: `pattern`, `weight`; `outline`: `kind`, `pattern`). */
  columns?: readonly ProfileFormField[];
  /** The value the file writes, or undefined when it writes none. */
  own: unknown;
  /** The value the parent chain gives when the file writes none (undefined without `extends`). */
  inherited: unknown;
  /** A built-in profile, or a member the form only shows (`json`). */
  readOnly: boolean;
  /** The schema calls it advanced: shown behind "More" in its section. */
  advanced: boolean;
}

/** One section of the form: a top-level member of the profile. */
export interface ProfileFormSection {
  /** The member name: `files`, `detect`, `syntax`, … */
  id: string;
  title: string;
  help: string;
  fields: ProfileFormField[];
}

/** What the form needs to build itself. */
export interface ProfileFormInput {
  /** `schemas/profile.schema.json`, as imported. */
  schema: unknown;
  /** The profile file as written (a user file's JSON, or a built-in's). */
  file: Record<string, unknown>;
  /** The same profile resolved through its parents (`resolveProfiles`), for `inherited`. */
  resolved: Record<string, unknown>;
  builtin: boolean;
}

/** The sections of the form, in the schema's order (§6.10 rule 7). */
export function formSections(input: ProfileFormInput): ProfileFormSection[] {
  void input;
  throw new ProfileFormNotImplemented('formSections');
}

/**
 * The file with one member set, or removed when `value` is undefined (an object left empty by
 * the removal is removed too). Returns a new object; `file` is not changed. Member order is kept,
 * a new member goes after its siblings in the schema's order.
 */
export function setField(file: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  void file;
  void path;
  void value;
  throw new ProfileFormNotImplemented('setField');
}

/**
 * The text the file's document gets: `file` as JSON in the indentation and line ending of
 * `original`, with a final line break when `original` had one. Equal objects give `original`
 * back unchanged, so opening and saving the form changes no byte.
 */
export function fileText(original: string, file: Record<string, unknown>): string {
  void original;
  void file;
  throw new ProfileFormNotImplemented('fileText');
}

/** The sample program of the live preview: one per grammar and machine type (§6.10 rule 8). */
export function sampleProgram(profile: Profile): string {
  void profile;
  throw new ProfileFormNotImplemented('sampleProgram');
}
