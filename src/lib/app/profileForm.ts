// The profile form (Phase 4 plan AD-57, §6.10 rules 7 and 8; P4.40).
//
// The form is generated from `schemas/profile.schema.json`: one section per top-level member
// (in the schema's `x-gedit-order`), one field per member the schema describes as a value, its
// title and help from the schema's `title` and `description`. It edits the user profile's
// **file** — the members the file writes itself — and shows what the file inherits from its
// parent (`extends`) beside each field. It never writes a resolved profile back, never writes
// `modal.units`/`diameter`/`sources`, and never removes a member it does not offer (an unknown
// member, a later-phase field and the members shown as JSON stay as written).
//
// Saving goes through the profile's **document** (the AD-40 pattern, as the template manager
// does): the form's result replaces the text of the file's document as one undo step, and
// `files.save` does the rest (backup, the external-change check, the M13 reload). Before that the
// draft is checked by `validateProfile` on the merge with its parent, exactly the check the
// registry applies at load, and a problem is shown at its field. A built-in profile is shown
// read-only with "Duplicate as a user profile".
//
// This file holds no Monaco, no store and no Tauri import: everything it reaches comes in
// through `ProfileFormDeps`, so the tests drive it with fakes. `contrib/profileForm.ts` wires the
// real services.

import { get, writable, type Readable } from 'svelte/store';
import profileSchemaJson from '../../../schemas/profile.schema.json';
import { t } from '$lib/i18n';
import type { DocumentPort } from '$lib/app/templateManager';
import { SAMPLE_TEMPLATES } from '$lib/data/samples';
import { patternSubsetProblem } from '$lib/core/profiles/validate';
import type { Msg } from '$lib/app/types';
import type { Profile } from '$lib/core/profiles/types';

// ---------------------------------------------------------------------------------------------
// The contract (types and constants)
// ---------------------------------------------------------------------------------------------

/**
 * The Monaco language id of the live preview (§6.10 rule 8). It starts with `_`, which no
 * profile id can (`PROFILE_ID` in `core/profiles/validate.ts`), so the preview's grammar and its
 * theme rules (`<role>.-profile-preview`: Monarch writes the `_` of a language id as `-`) can never touch a real profile's documents.
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
  /** `choice`: the schema's `enum`, in its order (numbers as their text, see `numericChoices`). */
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
  /** A built-in profile, or a member the form only shows (`json`, a fixed value). */
  readOnly: boolean;
  /** The schema calls it advanced: shown behind "More" in its section. */
  advanced: boolean;
  /** `text-list`: whether the entries are text or whole numbers (`editing.rulers`). */
  itemKind?: 'text' | 'integer';
  /** A `text` column that may be `null` (a comment that runs to the end of the line); an empty entry is `null`. */
  nullable?: boolean;
  /** `choice`: the entries that are numbers in the file (`numberFormat.decimals`), the others are words. */
  numericChoices?: boolean;
  /** `text-list`, `rows`: the most entries the schema allows. */
  maxItems?: number;
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

// ---------------------------------------------------------------------------------------------
// The schema walk
// ---------------------------------------------------------------------------------------------

type Node = Record<string, unknown>;

const isNode = (value: unknown): value is Node => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Members the form never offers: the identity (`id` after the file exists is the Profiles page's
 * rename; `extends` is chosen when the file is made), the schema line, and the three members
 * only a machine writes (the schema refuses them in a file as well).
 */
export const NEVER_OFFERED: readonly string[] = ['$schema', 'id', 'extends', 'modal.units', 'modal.diameter', 'modal.sources'];

/**
 * Members the form only shows, as formatted JSON, because their rows cannot be made plain
 * (§6.10 rule 7), plus the ones whose shape is a table of its own elsewhere or a map the form has
 * no row for. "Open as JSON" is next to them.
 */
export const SHOWN_AS_JSON: readonly string[] = [
  'machineParams.variants',
  'machineParams.channels',
  'machineParams.numberInput',
  'numbering.references',
  'numbering.calls',
  'compare.cycleNames',
  'compare.tolerance',
  'modal.initial',
  'addresses.incremental',
  'addresses.feedUnitWords',
  'addresses.arcDirectionWords',
];

/** The schema's `$ref` into its own `$defs`, with the referring node's own keywords on top. */
function resolveNode(node: unknown, root: Node, depth = 0): Node {
  if (!isNode(node)) return {};
  const ref = node.$ref;
  if (typeof ref !== 'string' || depth > 8) return node;
  const prefix = '#/$defs/';
  if (!ref.startsWith(prefix)) return node;
  const defs = root.$defs;
  const target = isNode(defs) ? defs[ref.slice(prefix.length)] : undefined;
  if (!isNode(target)) return node;
  const { $ref: _ref, ...own } = node;
  return { ...resolveNode(target, root, depth + 1), ...own };
}

/** The properties of an object node, in the schema's order. */
function propertiesOf(node: Node): [string, unknown][] {
  return isNode(node.properties) ? Object.entries(node.properties) : [];
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function getAt(source: unknown, path: string): unknown {
  let at: unknown = source;
  for (const part of path.split('.')) {
    if (!isNode(at) || !Object.hasOwn(at, part)) return undefined;
    at = at[part];
  }
  return at;
}

function typeOf(node: Node): string | undefined {
  const type = node.type;
  if (typeof type === 'string') return type;
  if (Array.isArray(type)) return type.find((entry): entry is string => typeof entry === 'string' && entry !== 'null');
  return undefined;
}

/** The kind of a node that carries no `x-gedit-kind`, from its type; `json` when the form has no widget. */
function inferKind(node: Node, root: Node): ProfileFieldKind {
  if (Array.isArray(node.enum) || 'const' in node) return 'choice';
  if (Array.isArray(node.anyOf)) {
    const branches = node.anyOf.map((entry) => resolveNode(entry, root));
    return branches.every((b) => 'const' in b || b.type === 'integer') ? 'choice' : 'json';
  }
  switch (typeOf(node)) {
    case 'string':
      return 'text';
    case 'integer':
      return 'integer';
    case 'number':
      return 'number';
    case 'boolean':
      return 'bool';
    case 'array': {
      const items = resolveNode(node.items, root);
      const type = typeOf(items);
      return type === 'string' || type === 'integer' ? 'text-list' : 'json';
    }
    default:
      return 'json';
  }
}

const KINDS: readonly ProfileFieldKind[] = [
  'text', 'pattern', 'integer', 'number', 'bool', 'choice', 'text-list', 'pattern-list', 'weights', 'rows', 'colors', 'json',
];

/** One field from a schema node. */
function fieldOf(path: string, raw: unknown, root: Node, file: Node, resolved: Node, builtin: boolean): ProfileFormField {
  const node = resolveNode(raw, root);
  const declared = node['x-gedit-kind'];
  let kind: ProfileFieldKind =
    typeof declared === 'string' && (KINDS as readonly string[]).includes(declared) ? (declared as ProfileFieldKind) : inferKind(node, root);
  if (SHOWN_AS_JSON.includes(path)) kind = 'json';
  const own = getAt(file, path);
  const inherited = own === undefined && typeof file.extends === 'string' ? getAt(resolved, path) : undefined;
  const field: ProfileFormField = {
    path,
    title: text(node.title),
    help: text(node.description),
    kind,
    own,
    inherited,
    readOnly: builtin || kind === 'json' || 'const' in node,
    advanced: node['x-gedit-advanced'] === true,
  };
  if (kind === 'choice') {
    if (Array.isArray(node.enum)) field.choices = node.enum.map(String);
    else if ('const' in node) field.choices = [String(node.const)];
    else if (Array.isArray(node.anyOf)) {
      const choices: string[] = [];
      for (const branch of node.anyOf.map((entry) => resolveNode(entry, root))) {
        if ('const' in branch) choices.push(String(branch.const));
        else if (branch.type === 'integer') {
          const low = typeof branch.minimum === 'number' ? branch.minimum : 0;
          const high = typeof branch.maximum === 'number' ? branch.maximum : low;
          for (let n = low; n <= high; n++) choices.push(String(n));
          field.numericChoices = true;
        }
      }
      field.choices = choices;
    }
  }
  if (kind === 'integer' || kind === 'number') {
    if (typeof node.minimum === 'number') field.min = node.minimum;
    if (typeof node.maximum === 'number') field.max = node.maximum;
  }
  if (kind === 'text-list') {
    field.itemKind = typeOf(resolveNode(node.items, root)) === 'integer' ? 'integer' : 'text';
    if (typeof node.maxItems === 'number') field.maxItems = node.maxItems;
  }
  if (kind === 'rows') {
    if (typeof node.maxItems === 'number') field.maxItems = node.maxItems;
    const items = resolveNode(node.items, root);
    field.columns = propertiesOf(items).map(([name, column]) => {
      const columnNode = resolveNode(column, root);
      const columnField = fieldOf(name, column, root, {}, {}, builtin);
      if (Array.isArray(columnNode.type) && columnNode.type.includes('null')) columnField.nullable = true;
      return columnField;
    });
  }
  return field;
}

/** Whether a node is an object the form lists member by member. */
function isGroup(node: Node): boolean {
  return typeOf(node) === 'object' && isNode(node.properties) && node['x-gedit-kind'] === undefined;
}

/** The top-level member names in the form's order: `x-gedit-order`, then any the schema describes besides. */
function orderOf(root: Node): string[] {
  const listed = Array.isArray(root['x-gedit-order']) ? root['x-gedit-order'].filter((n): n is string => typeof n === 'string') : [];
  const rest = propertiesOf(root).map(([name]) => name).filter((name) => !listed.includes(name));
  return [...listed, ...rest];
}

/** The sections of the form, in the schema's order (§6.10 rule 7). */
export function formSections(input: ProfileFormInput): ProfileFormSection[] {
  const root = isNode(input.schema) ? input.schema : {};
  const properties = isNode(root.properties) ? root.properties : {};
  const sections: ProfileFormSection[] = [];

  const leaves = (path: string, raw: unknown, into: ProfileFormField[]): void => {
    if (NEVER_OFFERED.includes(path)) return;
    const node = resolveNode(raw, root);
    if (isGroup(node) && !SHOWN_AS_JSON.includes(path)) {
      for (const [name, child] of propertiesOf(node)) leaves(`${path}.${name}`, child, into);
      return;
    }
    into.push(fieldOf(path, raw, root, input.file, input.resolved, input.builtin));
  };

  for (const name of orderOf(root)) {
    if (NEVER_OFFERED.includes(name) || !Object.hasOwn(properties, name)) continue;
    const node = resolveNode(properties[name], root);
    const fields: ProfileFormField[] = [];
    leaves(name, properties[name], fields);
    if (fields.length === 0) continue;
    sections.push({ id: name, title: text(node.title), help: text(node.description), fields });
  }
  return sections;
}

// ---------------------------------------------------------------------------------------------
// Changing the file
// ---------------------------------------------------------------------------------------------

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

const SCHEMA_ROOT = (isNode(profileSchemaJson) ? profileSchemaJson : {}) as Node;

/** The members of the object at `parentPath` in the schema's order; empty where the schema says nothing. */
function schemaKeys(parentPath: string): string[] {
  if (parentPath === '') return orderOf(SCHEMA_ROOT);
  let node: Node = SCHEMA_ROOT;
  for (const part of parentPath.split('.')) {
    const props = isNode(node.properties) ? node.properties : {};
    if (!Object.hasOwn(props, part)) return [];
    node = resolveNode(props[part], SCHEMA_ROOT);
  }
  return propertiesOf(node).map(([name]) => name);
}

/** `object` with `key` set to `value`, a new key placed after the members that come before it in the schema. */
function withKey(object: Node, key: string, value: unknown, parentPath: string): Node {
  if (Object.hasOwn(object, key)) return { ...object, [key]: value };
  const order = schemaKeys(parentPath);
  const rank = order.indexOf(key);
  const entries = Object.entries(object);
  let at = entries.length;
  if (rank >= 0) {
    let after = -1;
    entries.forEach(([name], i) => {
      const r = order.indexOf(name);
      if (r >= 0 && r < rank) after = i;
    });
    if (after >= 0) at = after + 1;
    else {
      const first = entries.findIndex(([name]) => order.indexOf(name) > rank);
      at = first >= 0 ? first : entries.length;
    }
  }
  const next = [...entries.slice(0, at), [key, value] as [string, unknown], ...entries.slice(at)];
  return Object.fromEntries(next);
}

/**
 * The file with one member set, or removed when `value` is undefined (an object left empty by
 * the removal is removed too). Returns a new object; `file` is not changed. Member order is kept,
 * a new member goes after its siblings in the schema's order.
 */
export function setField(file: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const parts = path.split('.');
  if (parts.some((part) => part === '' || FORBIDDEN.has(part))) throw new Error(`not a path of a profile: ${path}`);
  const apply = (object: Node, index: number): Node | undefined => {
    const key = parts[index];
    const parentPath = parts.slice(0, index).join('.');
    if (index === parts.length - 1) {
      if (value !== undefined) return withKey(object, key, value, parentPath);
      if (!Object.hasOwn(object, key)) return object;
      const { [key]: _gone, ...rest } = object;
      return rest;
    }
    const child = Object.hasOwn(object, key) && isNode(object[key]) ? object[key] : undefined;
    if (child === undefined && value === undefined) return object;
    const next = apply(child ?? {}, index + 1);
    if (next === undefined || (value === undefined && Object.keys(next).length === 0)) {
      const { [key]: _gone, ...rest } = object;
      return rest;
    }
    return withKey(object, key, next, parentPath);
  };
  return apply(file, 0) ?? {};
}

function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((entry, i) => sameJson(entry, b[i]));
  }
  if (isNode(a) && isNode(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]));
  }
  return false;
}

/** The indentation text the original uses: its first indented line; none for a file on one line. */
function indentOf(original: string): string | number {
  const found = /^([ \t]+)\S/m.exec(original);
  if (found === null) return original.trim().includes('\n') ? 2 : 0;
  return found[1].startsWith('\t') ? '\t' : found[1].length;
}

/**
 * The text the file's document gets: `file` as JSON in the indentation and line ending of
 * `original`, with a final line break when `original` had one. Equal objects give `original`
 * back unchanged, so opening and saving the form changes no byte.
 */
export function fileText(original: string, file: Record<string, unknown>): string {
  const bom = original.startsWith('\uFEFF') ? '\uFEFF' : '';
  const body = original.slice(bom.length);
  try {
    if (sameJson(JSON.parse(body), file)) return original;
  } catch {
    // Not JSON: the file is written anew below, in the default layout.
  }
  const eol = /\r\n/.test(body) ? '\r\n' : /\n/.test(body) ? '\n' : /\r/.test(body) ? '\r' : '\n';
  const finalBreak = body === '' || /[\r\n]$/.test(body);
  const json = JSON.stringify(file, null, indentOf(body));
  return `${bom}${json.replace(/\n/g, eol)}${finalBreak ? eol : ''}`;
}

// ---------------------------------------------------------------------------------------------
// Typing into the list-like fields
// ---------------------------------------------------------------------------------------------

/**
 * The longest block the dialect takes (`syntax.maxLineLength`): the draft's own value, else the
 * profile as it resolves; null where none is set (§6.10 rule 9, the one-click ruler).
 */
export function longestBlock(file: Record<string, unknown>, preview: Profile | null): number | null {
  const own = isNode(file.syntax) ? file.syntax.maxLineLength : undefined;
  const value = own !== undefined ? own : preview?.syntax?.maxLineLength;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/** The rulers with `column` added, in order; null when `current` already has it. */
export function withRuler(current: unknown, column: number): number[] | null {
  const list = Array.isArray(current) ? current.filter((entry): entry is number => typeof entry === 'number') : [];
  if (list.includes(column)) return null;
  return [...list, column].sort((a, b) => a - b);
}

/** A list as the form shows it: one entry per line. */
export function listText(value: unknown): string {
  return Array.isArray(value) ? value.map(String).join('\n') : '';
}

/** A list from the lines typed: blank lines are left out. A whole-number list refuses a line that is not one. */
export function parseList(source: string, itemKind: 'text' | 'integer' = 'text'): { ok: true; value: (string | number)[] } | { ok: false; line: number } {
  const value: (string | number)[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    if (itemKind === 'integer') {
      if (!/^-?\d+$/.test(line)) return { ok: false, line: i + 1 };
      value.push(Number(line));
    } else value.push(line);
  }
  return { ok: true, value };
}

/** A map of extension to weight as the form shows it: `nc = 1`, one per line. */
export function weightsText(value: unknown): string {
  return isNode(value) ? Object.entries(value).map(([key, weight]) => `${key} = ${String(weight)}`).join('\n') : '';
}

/** The map from the lines typed. A line that is not `name = number` (or a name twice) is refused. */
export function parseWeights(source: string): { ok: true; value: Record<string, number> } | { ok: false; line: number } {
  const value: Record<string, number> = {};
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    const found = /^(\S+)\s*=\s*(\d+(?:\.\d+)?)$/.exec(line);
    if (found === null || FORBIDDEN.has(found[1]) || Object.hasOwn(value, found[1])) return { ok: false, line: i + 1 };
    value[found[1]] = Number(found[2]);
  }
  return { ok: true, value };
}

/** A value in one short line, for "From fanuc-gcode: …": text as it is, a list joined, anything else as JSON; cut at 80 characters. */
export function describeValue(value: unknown, max = 80): string {
  let shown: string;
  if (typeof value === 'string') shown = value;
  else if (Array.isArray(value) && value.every((entry) => typeof entry === 'string' || typeof entry === 'number')) shown = value.join(', ');
  else shown = JSON.stringify(value) ?? '';
  return shown.length > max ? `${shown.slice(0, max - 1)}…` : shown;
}

/** The named group a pattern field needs, by field path (the check of `validateProfile` says the same). */
export const PATTERN_GROUPS: Readonly<Record<string, string>> = {
  'toolCall.tool': 'tool',
  'syntax.labels': 'name',
  'syntax.freeText': 'text',
};

/** What the pattern tester says about one pattern: nothing wrong, or the reason in plain words. */
export function patternAnswer(pattern: string, group?: string): { ok: true } | { ok: false; reason: string } {
  try {
    new RegExp(pattern);
  } catch (err) {
    return { ok: false, reason: errorText(err) };
  }
  const subset = patternSubsetProblem(pattern);
  if (subset !== null) return { ok: false, reason: subset };
  if (group !== undefined && !pattern.includes(`(?<${group}>`)) return { ok: false, reason: t('profileForm.pattern.needsGroup', { group }) };
  return { ok: true };
}

/** A new row of a table field: empty text, the first choice of a column that chooses, 1 for a weight. */
export function blankRow(columns: readonly ProfileFormField[]): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const column of columns) {
    if (column.kind === 'choice') row[column.path] = column.choices?.[0] ?? '';
    else if (column.kind === 'number' || column.kind === 'integer') row[column.path] = 1;
    else row[column.path] = column.nullable === true ? null : '';
  }
  return row;
}

// ---------------------------------------------------------------------------------------------
// The sample program of the live preview
// ---------------------------------------------------------------------------------------------

/** What the sample needs of the draft profile: how it writes comments and block numbers. */
function writers(profile: Profile): { note: (words: string) => string; n: (step: number) => string; skip: string } {
  const comments = Array.isArray(profile.syntax?.comments) ? profile.syntax.comments : [];
  const closed = comments.find((c) => typeof c?.start === 'string' && c.start !== '' && typeof c.end === 'string' && c.end !== '');
  const open = comments.find((c) => typeof c?.start === 'string' && c.start !== '');
  const block = profile.syntax?.blockNumber;
  const prefix = typeof block?.prefix === 'string' && block.prefix !== '' ? block.prefix : 'N';
  const skip = typeof profile.syntax?.blockSkip?.chars === 'string' && profile.syntax.blockSkip.chars !== '' ? profile.syntax.blockSkip.chars[0] : '/';
  return {
    note: (words) => {
      if (open !== undefined && (open.end === null || open.end === undefined)) return `${open.start}${words}`;
      if (closed !== undefined) return `${closed.start}${words}${closed.end}`;
      return `(${words})`;
    },
    n: (step) => (block?.mode === 'leading-integer' ? `${step}` : `${prefix}${step}`),
    skip,
  };
}

/**
 * The sample program of the live preview: one per grammar and machine type (§6.10 rule 8). The
 * programs are synthetic and short (`data/samples`, see its README): a few blocks that show the
 * kinds of word the colours are for. A comment, a block number and the block skip are written the
 * way the draft profile writes them, so changing the comment mark in the form changes the preview.
 * A grammar or machine type there is no sample for gets the ISO milling program.
 */
export function sampleProgram(profile: Profile): string {
  const w = writers(profile);
  const grammar = typeof profile.grammar === 'string' ? profile.grammar : 'iso';
  const type = profile.machineType === 'lathe' ? 'lathe' : 'mill';
  const template = SAMPLE_TEMPLATES[`${grammar}-${type}`] ?? SAMPLE_TEMPLATES['iso-mill'] ?? '';
  const text = template
    .replace(/\{n(\d+)\}/g, (_match, step: string) => w.n(Number(step)))
    .replace(/\{note:([^}]*)\}/g, (_match, words: string) => w.note(words))
    .replace(/\{skip\}/g, w.skip);
  return text.endsWith('\n') ? text : `${text}\n`;
}

// ---------------------------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------------------------

/** Which file the form opens. */
export type ProfileFormTarget =
  | { kind: 'user'; name: string }
  | { kind: 'builtin'; id: string };

/** Why the form could not open (or save), in plain words; the dialog shows it in place of the fields. */
export type ProfileFormMessage = { msg: Msg; error: boolean };

export interface ProfileFormState {
  /** True while the file is being read or saved. */
  busy: boolean;
  /** The form is open on a file (false after `close`, or when it could not open). */
  open: boolean;
  /** The file name (`my-lathe.json`); null for a built-in. */
  fileName: string | null;
  /** The profile id of the file (shown, never changed here). */
  id: string;
  /** The profile it extends, or null. */
  parent: string | null;
  readOnly: boolean;
  sections: ProfileFormSection[];
  /** The draft: the file as it would be written. */
  file: Record<string, unknown>;
  dirty: boolean;
  /** The problems of the draft by the path of their field (the closest field above the problem's path). */
  problems: Record<string, string[]>;
  /** The problems that belong to no field of the form. */
  loose: string[];
  /** Whether the draft can be saved. */
  canSave: boolean;
  /** The draft as a profile (merged with its parents) when it is valid; the last valid one otherwise. */
  preview: Profile | null;
  /** Why the preview is not the draft: the first problem, or null. */
  previewProblem: string | null;
  message: ProfileFormMessage | null;
  /** Why the file cannot be edited (unreadable, not an object, a document with unsaved changes). */
  refusal: Msg | null;
}

export interface ProfileFormModel {
  state: Readable<ProfileFormState>;
  /** Reads the file and builds the sections. */
  load(target: ProfileFormTarget): Promise<boolean>;
  /** Sets a member of the draft; `undefined` takes it out of the file (the parent's value applies again). */
  set(path: string, value: unknown): void;
  /** `set(path, undefined)`. */
  reset(path: string): void;
  /** The colours were edited and cannot be saved (a cell with a colour that is too pale). */
  setColorsValid(valid: boolean): void;
  /** Writes the draft through the file's document. True when it was saved. */
  save(): Promise<boolean>;
  /** Asks, when there are unsaved changes, whether they may go; true to continue. */
  leave(): Promise<boolean>;
}

/** Everything the model reaches. */
export interface ProfileFormDeps {
  /** `schemas/profile.schema.json`. */
  schema: unknown;
  /** The text of one of the user's profile files, or the reason it cannot be read. */
  readUser(name: string): Promise<{ text: string | null; error: string | null }>;
  userPath(name: string): Promise<string>;
  /** A built-in profile: the file as written and its resolved form; undefined when there is none. */
  builtin(id: string): { file: Record<string, unknown>; resolved: Record<string, unknown> } | undefined;
  /** The profile a file extends, resolved (the registry's), or undefined when it does not load. */
  parent(id: string): Record<string, unknown> | undefined;
  /**
   * The problems of a profile as the registry would find them at load, `<path>: <message>` each,
   * and the profile when there are none. Takes the merged draft (the file over its parent).
   */
  check(merged: Record<string, unknown>, own: Record<string, unknown>): { errors: string[] } | { profile: Profile };
  docs: DocumentPort;
  /** The folders are read again after a save (the save hook does it too; this is the backstop). */
  reload(): Promise<unknown>;
  confirm(o: { title: string; message: string; ok: string }): Promise<boolean>;
}

const emptyState = (): ProfileFormState => ({
  busy: false,
  open: false,
  fileName: null,
  id: '',
  parent: null,
  readOnly: false,
  sections: [],
  file: {},
  dirty: false,
  problems: {},
  loose: [],
  canSave: false,
  preview: null,
  previewProblem: null,
  message: null,
  refusal: null,
});

/** `syntax.comments[0].start` → `syntax.comments` (an index is not a member). */
function memberPath(path: string): string {
  return path.replace(/\[\d+\]/g, '');
}

/** Merge helper: the file over its parent's resolved object, as `resolveProfiles` does (objects merge, anything else replaces). */
export function mergeOver(parent: Node, child: Node): Node {
  const out: Node = {};
  for (const [key, value] of Object.entries(parent)) {
    if (key === '$schema' || FORBIDDEN.has(key)) continue;
    out[key] = value;
  }
  for (const [key, value] of Object.entries(child)) {
    if (key === '$schema' || FORBIDDEN.has(key)) continue;
    const mine = out[key];
    out[key] = isNode(mine) && isNode(value) ? mergeOver(mine, value) : value;
  }
  return out;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createProfileForm(deps: ProfileFormDeps): ProfileFormModel {
  const store = writable<ProfileFormState>(emptyState());
  let target: ProfileFormTarget | null = null;
  /** The file as the form read it: the draft is compared with it, and a change on disk meanwhile is noticed. */
  let initial: Node = {};
  let colorsValid = true;
  let lastGood: Profile | null = null;

  const snapshot = (): ProfileFormState => get(store);

  /** Recomputes sections, problems, the preview and the flags from the draft. */
  function refresh(file: Node, readOnly: boolean, builtinResolved?: Node): void {
    const parentId = typeof file.extends === 'string' && file.extends !== '' ? file.extends : null;
    const parent = parentId === null ? undefined : deps.parent(parentId);
    const problems: Record<string, string[]> = {};
    const loose: string[] = [];
    let previewProblem: string | null = null;
    let preview = lastGood;

    // The inherited values come from the parent chain: the file over it, resolved.
    const resolved = builtinResolved ?? (parent === undefined ? file : mergeOver(parent, file));
    const sections = formSections({ schema: deps.schema, file, resolved, builtin: readOnly });
    const fieldPaths = sections.flatMap((s) => s.fields.map((f) => f.path));

    const assign = (error: string): void => {
      const at = error.indexOf(': ');
      const path = at < 0 ? '' : memberPath(error.slice(0, at));
      const message = at < 0 ? error : error.slice(at + 2);
      const owner = fieldPaths
        .filter((p) => path === p || path.startsWith(`${p}.`))
        .sort((a, b) => b.length - a.length)[0];
      if (owner === undefined) loose.push(at < 0 || path === '' ? message : `${path}: ${message}`);
      else (problems[owner] ??= []).push(message);
    };

    if (builtinResolved !== undefined) {
      preview = builtinResolved as unknown as Profile;
    } else if (parentId !== null && parent === undefined) {
      loose.push(t('profileForm.problem.noParent', { parent: parentId }));
      previewProblem = loose[0];
    } else if (!readOnly) {
      const checked = deps.check(resolved, file);
      if ('errors' in checked) {
        checked.errors.forEach(assign);
        previewProblem = checked.errors[0] ?? null;
      } else {
        lastGood = checked.profile;
        preview = checked.profile;
      }
      // The registry wants a profile that extends another to write its own name and short
      // name (it checks the file, not the merge), so a cleared one is a problem here too.
      if (parentId !== null) {
        for (const own of ['name', 'shortName']) {
          const value = file[own];
          if (typeof value !== 'string' || value === '') (problems[own] ??= []).push(t('profileForm.problem.ownField'));
        }
      }
    }

    const hasProblems = Object.keys(problems).length > 0 || loose.length > 0;
    store.update((s) => ({
      ...s,
      sections,
      file,
      parent: parentId,
      problems,
      loose,
      preview,
      previewProblem,
      dirty: !sameJson(file, initial),
      canSave: !readOnly && !hasProblems && colorsValid,
    }));
  }

  /** Why the file cannot be edited right now, or null. */
  function documentRefusal(name: string, path: string): Msg | null {
    const open = deps.docs.find(path);
    return open !== undefined && open.dirty ? { key: 'profileForm.saveFirst', params: { name } } : null;
  }

  const model: ProfileFormModel = {
    state: { subscribe: store.subscribe },

    async load(next) {
      if (!(await model.leave())) return false;
      target = next;
      colorsValid = true;
      lastGood = null;
      store.set({ ...emptyState(), busy: true });
      try {
        if (next.kind === 'builtin') {
          const found = deps.builtin(next.id);
          if (found === undefined) {
            store.set({ ...emptyState(), refusal: { key: 'profileForm.unknownProfile', params: { id: next.id } } });
            return false;
          }
          initial = structuredClone(found.file);
          store.set({ ...emptyState(), open: true, id: next.id, readOnly: true });
          refresh(structuredClone(found.file), true, found.resolved);
          return true;
        }
        const read = await deps.readUser(next.name);
        if (read.text === null) {
          store.set({ ...emptyState(), fileName: next.name, refusal: { key: 'profileForm.cannotRead', params: { name: next.name, detail: read.error ?? '' } } });
          return false;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(read.text.replace(/^\uFEFF/, ''));
        } catch (err) {
          store.set({ ...emptyState(), fileName: next.name, refusal: { key: 'profileForm.notJson', params: { name: next.name, detail: errorText(err) } } });
          return false;
        }
        if (!isNode(parsed)) {
          store.set({ ...emptyState(), fileName: next.name, refusal: { key: 'profileForm.notObject', params: { name: next.name } } });
          return false;
        }
        const path = await deps.userPath(next.name);
        const refusal = documentRefusal(next.name, path);
        if (refusal !== null) {
          store.set({ ...emptyState(), fileName: next.name, refusal });
          return false;
        }
        initial = structuredClone(parsed);
        store.set({
          ...emptyState(),
          open: true,
          fileName: next.name,
          id: typeof parsed.id === 'string' ? parsed.id : next.name.replace(/\.json$/, ''),
        });
        refresh(structuredClone(parsed), false);
        return true;
      } catch (err) {
        store.set({ ...emptyState(), refusal: { key: 'profileForm.failed', params: { detail: errorText(err) } } });
        return false;
      } finally {
        store.update((s) => (s.busy ? { ...s, busy: false } : s));
      }
    },

    set(path, value) {
      const s = snapshot();
      if (!s.open || s.readOnly || s.busy) return;
      refresh(setField(s.file, path, value), false);
      store.update((state) => (state.message === null ? state : { ...state, message: null }));
    },

    reset(path) {
      model.set(path, undefined);
    },

    setColorsValid(valid) {
      if (colorsValid === valid) return;
      colorsValid = valid;
      store.update((s) => ({ ...s, canSave: !s.readOnly && s.open && Object.keys(s.problems).length === 0 && s.loose.length === 0 && valid }));
    },

    async save() {
      const s = snapshot();
      if (!s.open || s.readOnly || s.busy || target === null || target.kind !== 'user') return false;
      if (!s.canSave) return false;
      if (!s.dirty) return true;
      const name = target.name;
      store.update((state) => ({ ...state, busy: true, message: null }));
      const fail = (msg: Msg): false => {
        store.update((state) => ({ ...state, busy: false, message: { msg, error: true } }));
        return false;
      };
      try {
        const path = await deps.userPath(name);
        const open = deps.docs.find(path);
        if (open !== undefined && open.dirty) return fail({ key: 'profileForm.saveFirst', params: { name } });
        const previous = deps.docs.activeId();
        let id = open?.id;
        if (id === undefined) {
          const opened = await deps.docs.open(path);
          if (opened === null) return fail({ key: 'profileForm.openFailed', params: { name } });
          id = opened;
        }
        const docId = id;
        // Opening the file's tab activated it; the tab the user was in comes back.
        const restore = (): void => {
          if (previous !== null && previous !== docId) deps.docs.activate(previous);
        };
        const now = deps.docs.text(docId);
        let current: unknown;
        try {
          current = JSON.parse(now.replace(/^\uFEFF/, ''));
        } catch (err) {
          restore();
          return fail({ key: 'profileForm.notJson', params: { name, detail: errorText(err) } });
        }
        if (!sameJson(current, initial)) {
          restore();
          return fail({ key: 'profileForm.changed', params: { name } });
        }
        const text = fileText(now, s.file);
        // The read-only lock (AD-23): the text is put into the tab without typing, so Monaco's option does not stop it.
        const locked = deps.docs.refusal(docId, t('profileForm.lockAction'));
        if (locked !== null) {
          restore();
          return fail(locked);
        }
        const before = now;
        deps.docs.replace(docId, text);
        if (deps.docs.text(docId) !== text) {
          restore();
          return fail({ key: 'profileForm.locked', params: { name } });
        }
        let saved = false;
        try {
          saved = await deps.docs.save(docId);
        } finally {
          if (!saved) {
            deps.docs.replace(docId, before);
            deps.docs.markClean(docId);
          }
          restore();
        }
        if (!saved) return fail({ key: 'profileForm.notSaved', params: { name } });
        initial = structuredClone(s.file);
        try {
          await deps.reload();
        } catch {
          // The save hook reloads as well; a failure here is the Profiles page's to show.
        }
        store.update((state) => ({ ...state, busy: false, dirty: false, message: { msg: { key: 'profileForm.saved', params: { name } }, error: false } }));
        return true;
      } catch (err) {
        return fail({ key: 'profileForm.failed', params: { detail: errorText(err) } });
      }
    },

    async leave() {
      const s = snapshot();
      if (!s.open || !s.dirty || s.readOnly) return true;
      return deps.confirm({
        title: t('profileForm.leave.title'),
        message: t('profileForm.leave.message', { name: s.fileName ?? s.id }),
        ok: t('profileForm.leave.ok'),
      });
    },
  };
  return model;
}

/** The schema the form reads, as imported. */
export const profileSchema: unknown = profileSchemaJson;

/** The values of the draft that the colour editor shows: the file's `colors`, or an empty palette. */
export function colorsOf(file: Record<string, unknown>): { dark?: Record<string, string>; light?: Record<string, string> } {
  const colors = file.colors;
  return isNode(colors) ? (colors as { dark?: Record<string, string>; light?: Record<string, string> }) : {};
}
