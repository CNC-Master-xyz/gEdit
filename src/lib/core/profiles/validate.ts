// Profile validation (plan §7.4, §7.1, AD-11, AD-31). Owner: WP3.1, and WP6.1 for the
// M6 fields.
//
// Hand-written on purpose (no ajv, F6: the CSP has no `unsafe-eval`, so a generated
// validator could not run, and the bundle stays free of a new dependency).
//
// What it guarantees to its callers:
//   - Every field the P1 code reads is present and has the type `Profile` promises, so
//     the registry, the tokenizer and the grammar generator never type-guard again.
//   - Unknown fields are kept. A profile written for a later phase (`onSave`, `colors`,
//     `extends`, …) still loads here, and a round trip through the app leaves it intact.
//   - Every problem is reported with the JSON path of the field it belongs to
//     (`outline[2].pattern`), because the fix is in the file, not in the app.
//   - Every pattern compiles **and** stays inside the AD-11 subset, so `gedit_nc.py`
//     (§7.10) can compile the same profile with Python's `re` after the mechanical
//     rewrite of `to_py_regex`: `(?<name>` → `(?P<name>`, and `\s`, `\S` and `.` spelled
//     out as the characters ECMAScript means by them (G8 M8).
//   - A label pattern carries the group `name`, and a variable pattern cannot match the
//     empty string (G8 M8): the tokenizers read the one and would stand still on the other.
//
// It collects every problem instead of stopping at the first one, so the settings UI can
// show a profile's full error list in one go.
//
// It never throws and never mutates `raw`; the returned profile is the very object that
// was passed in.
//
// M6 (WP6.1) adds the machine side (§7.1, §7.15, AD-31). Two things about it are worth
// knowing before reading the code:
//
//   - **A profile is checked twice, in two different roles.** The registry checks it as it
//     was *written* (built-in JSON, a user file, both after `extends` was merged), and
//     again after `applyMachine` has written a machine's parameters into it. The second
//     run passes `applied: true`, because three fields are then legitimately there that a
//     profile file may not carry itself (`modal.units`, `modal.diameter`, `modal.sources`,
//     all computed, AD-31) and because `syntax.decimalPointSignificant` then follows the
//     **machine's** number input and not the profile's default preset any more.
//   - **Two checks need the code databases** (a variant's `codes` names one, and
//     `machineParams.modalGroups` names groups of the profile's own). Neither is knowable
//     from the profile alone, so both are optional: the caller that has the databases in
//     hand passes them, and a caller that does not simply does not get those two checks.

import { normalizeCode } from '$lib/core/codes/lookup';
import { paletteProblems } from '$lib/core/grammar/contrast';
import { COMPARE_OPTION_KEYS } from '$lib/core/compare/types';
import type { Eol } from '$lib/app/types';
import type { NumberClass, NumberReading, ParamSource } from '$lib/core/machines/types';
import { hasRepeatedGroupShape, validateChannels } from '$lib/core/machines/validate';
import { NON_NC_EXTENSIONS } from './ncDocument';
import type { OutlineKind, Profile, ProfileValidation } from './types';

/** M13 review fix CODE-1 (plan §4, standing rule 15): the longest a pattern may be. */
export const MAX_PATTERN_LENGTH = 1000;
/** ... the most entries a list of patterns may have (the longest built-in list has 28). */
export const MAX_PATTERN_LIST = 200;
/** ... and the most patterns a whole profile may have. */
export const MAX_PATTERNS_PER_PROFILE = 1000;
/** CODE-17: the longest name of a profile, of its file filter, and of one folder entry. */
export const MAX_NAME_LENGTH = 80;
/** ... and of the short name the status bar shows (the longest built-in one has 11). */
export const MAX_SHORT_NAME_LENGTH = 16;
export const MAX_FOLDER_LENGTH = 260;
/** How much of a wrong value a message repeats. */
const ECHO_LENGTH = 80;

/** What `validateProfile` cannot see in the profile itself (see the header). */
export interface ProfileValidationOptions {
  /**
   * The profile has been through `applyMachine` (AD-31), so the computed `modal` fields
   * belong there and the decimal-point rule is the machine's, not the default preset's.
   */
  applied?: boolean;
  /** Dialect ids that resolve; a variant choice's `codes` has to name one of them. */
  codeDbs?: readonly string[];
  /** The modal group names of the profile's own database; `machineParams.modalGroups` names these. */
  modalGroups?: readonly string[];
  /**
   * CODE-1: whether the repeated-group shape check (`(\w+\s?)*`, which can take exponentially
   * long on a line that almost matches) applies to this pattern text. The caller answers false
   * for the patterns of the built-in profiles, which are ours and bounded by delimiters (13 of
   * 199 would be flagged by the heuristic), and true for anything a user's file wrote or
   * changed. Unset: no shape check.
   */
  checkShape?: (source: string) => boolean;
}

/** An extension as it may be written in a profile: lower case, no dot, no separator. */
const EXTENSION = /^[a-z0-9][a-z0-9_+-]*$/;

/** An address or keyword-like name: a letter, then letters and digits (`X`, `FMAX`, `GOTO`). */
const ADDRESS = /^[A-Za-z][A-Za-z0-9]*$/;
/** Phase 4 (plan §6.2): an arc direction word, an address and its sign (`DR+`). */
const DIRECTION_WORD = /^[A-Za-z][A-Za-z0-9]*[+-]$/;
const ARC_DIRECTIONS = ['cw', 'ccw'] as const;
/** P4d (plan §6.6 rule 8): which program's block a `numbering.references` value names. */
const REFERENCE_PROGRAMS = ['own', 'called', 'caller'] as const;
/** P4d (§6.6 rules 2–6): the bounds of the advanced renumber options. */
const MAX_ALIGN_COLUMN = 120;
const MAX_EVERY_NTH = 1000;
const MAX_SKIP_LINES = 1_000_000;
const MAX_SKIP_TEXT = 200;
/** P4d review CODE-6: a `skipContaining` text has no blank in it (the form splits at blanks). */
const NO_BLANK = /^\S+$/;

/** P9. A main-block prefix: one character that is neither a letter, a digit nor a blank (`:`). */
const MAIN_PREFIX = /^[^A-Za-z0-9\s]$/;

/**
 * M9 review F4. Characters some dialect already gives a meaning at the head of a block or
 * of a word: comments (`(`, `;`), the block skip (`/`), strings (`"`, `'`), the tape mark
 * and program heads (`%`, `$`, `<`), signs, separators and expressions (`+ - . , = [ ] #
 * * >`). A main-block prefix that is one of them would turn `(20 NOTE)` into a block
 * number with code words behind it. The profile's own comment starts, skip characters
 * and continuation mark are refused as well, whatever they are.
 */
const RESERVED_HEAD_CHARS = new Set('();/"\'%$<>+-.,=[]#*'.split(''));

/** P9. An exponent marker: letters only (`EX`). */
const LETTERS = /^[A-Za-z]+$/;

/** P4h (plan §6.10 rule 13; T123): an extra axis name, letters only, two to eight of them. */
export const EXTRA_AXIS_NAME = /^[A-Za-z]{2,8}$/;
/** P4h (§6.10 rule 13): the most extra axis names a profile or a machine may list. */
export const MAX_EXTRA_AXES = 16;
/** P4h (§6.10 rule 9; Q4-19): the bounds of `editing.tabWidth` and `editing.rulers`. */
export const MAX_TAB_WIDTH = 16;
export const MAX_RULERS = 8;
export const MAX_RULER_COLUMN = 1000;

/** A profile id is also a Monaco language id, so it stays plain. */
const PROFILE_ID = /^[a-z0-9][a-z0-9._-]*$/;

const EOLS: readonly Eol[] = ['crlf', 'lf', 'cr'];

const OUTLINE_KINDS: readonly OutlineKind[] = [
  'tool',
  'program',
  'section',
  'comment',
  'label',
  'stop',
  'end',
  'subprogram-call',
];

/** The feed units a word may switch to by itself (`addresses.feedUnitWords`, §7.1). */
const FEED_UNITS = ['per-minute', 'per-rev', 'per-tooth', 'inverse-time'] as const;

/** Where an applied parameter came from (§7.15). */
const PARAM_SOURCES: readonly ParamSource[] = ['machine', 'detected', 'profile'];

/** How a control reads a numeric literal (§7.15). */
const READINGS: readonly NumberReading[] = ['increment', 'calculator', 'scale'];

/** The number classes a `NumberInput` may describe (§7.15). */
const NUMBER_CLASSES: readonly NumberClass[] = ['length', 'angle', 'feedPerMin', 'feedPerRev', 'dwell'];

/**
 * The classes that follow the program's units, and therefore have an inch increment.
 *
 * `angle` is degrees and `dwell` is seconds in a metric and in an inch program alike
 * (§7.15), so an inch increment on either is a mistake in the data, not a setting: it
 * would be read by nothing and hide the fact that the author expected a conversion.
 */
const UNIT_CLASSES: readonly NumberClass[] = ['length', 'feedPerMin', 'feedPerRev'];

/** A number-input preset id (`is-b`, `okuma-10um`): plain, because it is a stored key. */
const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/;

/** A variant id (`gcodeSystem`): a member name of a machine's `params.variants`. */
const VARIANT_ID = /^[A-Za-z][A-Za-z0-9]*$/;

/**
 * A least input increment, or the value of "1" in a scaling unit system: decimal text
 * that is a power of ten no larger than one (`1`, `0.1`, `0.001`, `0.00001`).
 *
 * Text, not a number: `0.0001` as a JSON number is a binary float, and the value ends up
 * in a `Decimal` multiplication that decides where a tool goes (F52).
 */
const INCREMENT = /^(?:1|0\.0*1)$/;

// ---------------------------------------------------------------------------
// The AD-11 pattern subset
// ---------------------------------------------------------------------------

/**
 * Reports why `pattern` leaves the common subset of ECMAScript and Python `re`, or
 * `null` when it stays inside it (AD-11). The rules:
 *
 *   - no Unicode property escape (`\p{…}`, `\P{…}`): Python has no equivalent;
 *   - no named back-reference (`\k<name>`): Python spells it `(?P=name)`;
 *   - no variable-width lookbehind: Python only accepts a fixed width, so `*`, `+`,
 *     a non-group `?`, `{n,}`/`{n,m}` and `|` are rejected inside `(?<=…)` / `(?<!…)`.
 *
 * Whether the pattern compiles at all is a separate question, answered by `new RegExp`.
 * This scan is also what the P2 pattern tester shows next to the field.
 */
export function patternSubsetProblem(pattern: string): string | null {
  let inClass = false;

  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];

    if (c === '\\') {
      const next = pattern[i + 1] ?? '';
      if (next === 'p' || next === 'P') return 'a Unicode property escape (\\p{…}) has no Python equivalent';
      if (next === 'k' && pattern[i + 2] === '<') return 'a named back-reference (\\k<…>) has no Python equivalent';
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') {
      inClass = true;
      continue;
    }
    if (c === '(' && (pattern.startsWith('(?<=', i) || pattern.startsWith('(?<!', i))) {
      const end = closingParen(pattern, i);
      const body = pattern.slice(i + 4, end === -1 ? pattern.length : end);
      const problem = variableWidth(body);
      if (problem !== null) return `a lookbehind must be fixed width (${problem})`;
      // The scan continues inside the body, so an escape it does not know about
      // (`\p{…}`, `\k<…>`) is still caught.
    }
  }
  return null;
}

/** Index of the `)` that closes the group opening at `open`, or -1 when there is none. */
function closingParen(pattern: string, open: number): number {
  let depth = 0;
  let inClass = false;
  for (let i = open; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') inClass = true;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

/** Names the first construct in a lookbehind body that can match more than one width. */
function variableWidth(body: string): string | null {
  let inClass = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') inClass = true;
    else if (c === '*' || c === '+') return `\`${c}\` repeats`;
    else if (c === '|') return '`|` may take branches of different length';
    else if (c === '?' && body[i - 1] !== '(') return '`?` makes a part optional';
    else if (c === '{') {
      const end = body.indexOf('}', i);
      const inner = end === -1 ? body.slice(i + 1) : body.slice(i + 1, end);
      if (!/^\d+$/.test(inner)) return '`{n,m}` repeats a variable number of times';
      i = end === -1 ? body.length : end;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Problem collection and field checks
// ---------------------------------------------------------------------------

/** The problems found so far, each one prefixed with the JSON path of its field. */
class Problems {
  readonly list: string[] = [];
  /** The patterns seen so far, for the cap per profile. */
  patterns = 0;
  /** The cap was reported once; the patterns after it are not looked at. */
  overCap = false;

  constructor(readonly options: ProfileValidationOptions = {}) {}

  add(path: string, message: string): void {
    this.list.push(`${path}: ${message}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A present, plain object, or `null` plus a problem. */
function obj(value: unknown, path: string, p: Problems): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  p.add(path, value === undefined ? 'is required' : 'has to be an object');
  return null;
}

/** An optional plain object: absent is fine, a non-object is not. */
function optObj(value: unknown, path: string, p: Problems): Record<string, unknown> | null {
  return value === undefined ? null : obj(value, path, p);
}

/** A value as a message repeats it: cut to a line, so one long wrong value cannot fill the report. */
function clip(value: string): string {
  return value.length > ECHO_LENGTH ? `${value.slice(0, ECHO_LENGTH)}…` : value;
}

function str(value: unknown, path: string, p: Problems, allow?: RegExp, max?: number): string | null {
  if (typeof value !== 'string' || value === '') {
    p.add(path, value === undefined ? 'is required' : 'has to be a non-empty string');
    return null;
  }
  if (max !== undefined && value.length > max) {
    p.add(path, `is longer than ${max} characters`);
    return null;
  }
  if (allow && !allow.test(value)) {
    p.add(path, `"${clip(value)}" does not match ${String(allow)}`);
    return null;
  }
  return value;
}

function optStr(value: unknown, path: string, p: Problems, allow?: RegExp): void {
  if (value !== undefined) str(value, path, p, allow);
}

function enumOf<T extends string>(value: unknown, path: string, p: Problems, values: readonly T[]): T | null {
  if (typeof value === 'string' && (values as readonly string[]).includes(value)) return value as T;
  p.add(path, `has to be one of ${values.map((v) => `"${v}"`).join(', ')}`);
  return null;
}

function optEnum<T extends string>(value: unknown, path: string, p: Problems, values: readonly T[]): void {
  if (value !== undefined) enumOf(value, path, p, values);
}

function bool(value: unknown, path: string, p: Problems): void {
  if (typeof value !== 'boolean') p.add(path, value === undefined ? 'is required' : 'has to be true or false');
}

function optBool(value: unknown, path: string, p: Problems): void {
  if (value !== undefined) bool(value, path, p);
}

function num(value: unknown, path: string, p: Problems, o: { int?: boolean; min?: number; max?: number } = {}): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    p.add(path, value === undefined ? 'is required' : 'has to be a number');
    return;
  }
  if (o.int && !Number.isInteger(value)) p.add(path, 'has to be a whole number');
  if (o.min !== undefined && value < o.min) p.add(path, `has to be at least ${o.min}`);
  if (o.max !== undefined && value > o.max) p.add(path, `has to be at most ${o.max}`);
}

function optNum(value: unknown, path: string, p: Problems, o: { int?: boolean; min?: number; max?: number } = {}): void {
  if (value !== undefined) num(value, path, p, o);
}

/** A present array, or `null` plus a problem. `min` is the smallest useful length. */
function arr(value: unknown, path: string, p: Problems, min = 0): unknown[] | null {
  if (!Array.isArray(value)) {
    p.add(path, value === undefined ? 'is required' : 'has to be an array');
    return null;
  }
  if (value.length < min) {
    p.add(path, `has to list at least ${min} ${min === 1 ? 'entry' : 'entries'}`);
    return null;
  }
  return value;
}

function strArr(value: unknown, path: string, p: Problems, o: { min?: number; allow?: RegExp; max?: number; cap?: number } = {}): void {
  const list = arr(value, path, p, o.min ?? 0);
  if (!list) return;
  if (o.cap !== undefined && list.length > o.cap) {
    p.add(path, `lists more than ${o.cap} entries`);
    return;
  }
  list.forEach((entry, i) => str(entry, `${path}[${i}]`, p, o.allow, o.max));
}

function optStrArr(value: unknown, path: string, p: Problems, o: { min?: number; allow?: RegExp; max?: number; cap?: number } = {}): void {
  if (value !== undefined) strArr(value, path, p, o);
}

/** A list of patterns or of rules that hold one: an array of at most [`MAX_PATTERN_LIST`] entries. */
function patternArr(value: unknown, path: string, p: Problems, min = 0): unknown[] | null {
  const list = arr(value, path, p, min);
  if (!list) return null;
  if (list.length > MAX_PATTERN_LIST) {
    p.add(path, `lists more than ${MAX_PATTERN_LIST} entries`);
    return null;
  }
  return list;
}

/**
 * A required pattern: a string of at most [`MAX_PATTERN_LENGTH`] characters that compiles,
 * stays inside the AD-11 subset and, where the caller asks for it, has no repeated group that
 * repeats or chooses inside (CODE-1). A profile holds at most [`MAX_PATTERNS_PER_PROFILE`].
 */
function pattern(value: unknown, path: string, p: Problems): void {
  const source = str(value, path, p);
  if (source === null) return;
  p.patterns += 1;
  if (p.patterns > MAX_PATTERNS_PER_PROFILE) {
    if (!p.overCap) {
      p.overCap = true;
      p.add(path, `the profile has more than ${MAX_PATTERNS_PER_PROFILE} patterns; this one and the ones after it are not checked`);
    }
    return;
  }
  if (source.length > MAX_PATTERN_LENGTH) {
    p.add(path, `is longer than ${MAX_PATTERN_LENGTH} characters`);
    return;
  }
  try {
    new RegExp(source);
  } catch (error) {
    p.add(path, error instanceof Error ? error.message : String(error));
    return;
  }
  const problem = patternSubsetProblem(source);
  if (problem !== null) {
    p.add(path, problem);
    return;
  }
  if (p.options.checkShape?.(source) === true && hasRepeatedGroupShape(source)) {
    p.add(
      path,
      'can take very long on some lines; write it without a repeated part inside a repeated part, and without a choice (|) inside a repeated part',
    );
  }
}

function optPattern(value: unknown, path: string, p: Problems): void {
  if (value !== undefined) pattern(value, path, p);
}

/**
 * Lines of every kind of character a program holds, to find out whether a pattern can
 * match the empty string somewhere: in front of a letter, a digit, a blank, a sigil, a
 * bracket, at the end of a line.
 */
const EMPTY_MATCH_PROBES: readonly string[] = [
  ...['', 'X', 'x', '1', '_', ' ', '$', '#', '.', '=', '(', '[', ';'],
  'N10 G1 X-2.5 $A_B=(R1)',
];

/**
 * True when `source` matches the empty string at some position of a probe line.
 *
 * The tokenizers read a variable where the pattern matches, and a match of no characters
 * is no variable at all: it used to leave both of them where they were, so a script or the
 * editor hung on the first line (G8 M8). Both skip an empty match now, but a pattern that
 * allows one is still a mistake — `R?\d*` also reads every bare number as a variable. The
 * probes are a sample, not a proof; the tokenizers' own check covers what they miss.
 */
function matchesEmpty(source: string, caseSensitive: boolean): boolean {
  let re: RegExp;
  try {
    re = new RegExp(source, caseSensitive ? 'y' : 'iy');
  } catch {
    return false; // `pattern()` reports why it does not compile.
  }
  for (const probe of EMPTY_MATCH_PROBES) {
    for (let at = 0; at <= probe.length; at++) {
      re.lastIndex = at;
      const match = re.exec(probe);
      if (match !== null && match[0] === '') return true;
    }
  }
  return false;
}

/** Lines that carry no continuation marker in any dialect: empty, blank, a plain block. */
const PLAIN_BLOCKS: readonly string[] = ['', ' ', '\t', 'G1 X10', 'N10 G1 X10 F100', 'X10'];

/** True when the leading-marker pattern `source` matches a line that has no marker. */
function matchesPlainBlock(source: string, caseSensitive: boolean): boolean {
  let re: RegExp;
  try {
    re = new RegExp(source, caseSensitive ? '' : 'i');
  } catch {
    return false; // `pattern()` reports why it does not compile.
  }
  return PLAIN_BLOCKS.some((line) => re.test(line));
}

/**
 * T177: whether every top-level alternative of a pattern starts with `^`.
 *
 * A leading `^` is not enough: in `^\$ |\$\t` it anchors only the first alternative, and the
 * second matches in the middle of a line. The pattern is split at the `|` that stand outside
 * groups, character classes and escapes, and each part has to start with `^` itself. An
 * alternation inside a group behind the `^` (`^(?:\$ |\$\t)`) is anchored by it. A pattern that
 * hides its anchor in a group (`(?:^\$|^#)`) is refused too: the rule is kept simple enough to
 * be checked by reading, and the message says what to write.
 */
export function anchoredAtLineStart(source: string): boolean {
  const branches: string[] = [];
  let depth = 0;
  let inClass = false;
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') {
      i++; // the escaped character is never syntax
    } else if (inClass) {
      if (c === ']') inClass = false;
    } else if (c === '[') {
      // JavaScript reads `[]` as an empty class and `[^]` as any character, so a `]` right
      // after `[` or `[^` closes the class here (Python would read it as a character: the
      // stricter reading is the one that refuses).
      inClass = true;
      if (source[i + 1] === '^') i++;
    } else if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth = Math.max(0, depth - 1);
    } else if (c === '|' && depth === 0) {
      branches.push(source.slice(start, i));
      start = i + 1;
    }
  }
  branches.push(source.slice(start));
  return branches.every((branch) => branch.startsWith('^'));
}

/** A variable pattern: compiles, stays in the AD-11 subset, and always takes a character. */
function optVariablePattern(value: unknown, path: string, caseSensitive: boolean, p: Problems): void {
  if (value === undefined) return;
  const before = p.list.length;
  pattern(value, path, p);
  if (p.list.length === before && typeof value === 'string' && matchesEmpty(value, caseSensitive)) {
    p.add(path, 'can match an empty string, and a variable has to take at least one character');
  }
}

function patternList(value: unknown, path: string, p: Problems): void {
  const list = patternArr(value, path, p);
  if (!list) return;
  list.forEach((entry, i) => pattern(entry, `${path}[${i}]`, p));
}

// ---------------------------------------------------------------------------
// The sections
// ---------------------------------------------------------------------------

/**
 * CODE-3: a profile cannot claim a `.json` or `.py` file. Those are the profile, code, settings
 * and machines files and the scripts, which gEdit edits as plain text; a profile that took them
 * would upper-case what is typed into them.
 */
function notNc(ext: unknown, path: string, p: Problems): void {
  if (typeof ext === 'string' && NON_NC_EXTENSIONS.includes(ext.toLowerCase())) {
    p.add(path, `"${ext}" files are the profile, settings and script files themselves, not NC programs, so a profile cannot take them`);
  }
}

function checkFiles(value: unknown, p: Problems): void {
  const files = obj(value, 'files', p);
  if (!files) return;
  strArr(files.extensions, 'files.extensions', p, { min: 1, allow: EXTENSION, max: MAX_NAME_LENGTH });
  if (Array.isArray(files.extensions)) {
    files.extensions.forEach((ext, i) => notNc(ext, `files.extensions[${i}]`, p));
  }
  const preferred = str(files.defaultExtension, 'files.defaultExtension', p, EXTENSION);
  if (preferred !== null && Array.isArray(files.extensions) && !files.extensions.includes(preferred)) {
    p.add('files.defaultExtension', `"${preferred}" is not in files.extensions`);
  }
  str(files.filterName, 'files.filterName', p, undefined, MAX_NAME_LENGTH);
  // P1 never rewrites a file it opened: both are `keep` until the P2 `onSave` block.
  enumOf(files.encoding, 'files.encoding', p, ['keep'] as const);
  enumOf(files.lineEnding, 'files.lineEnding', p, ['keep'] as const);
  enumOf(files.newFileLineEnding, 'files.newFileLineEnding', p, EOLS);
}

function checkDetect(value: unknown, p: Problems): void {
  const detect = obj(value, 'detect', p);
  if (!detect) return;

  const extensions = obj(detect.extensions, 'detect.extensions', p);
  if (extensions) {
    for (const [ext, weight] of Object.entries(extensions)) {
      if (!EXTENSION.test(ext)) p.add(`detect.extensions.${clip(ext)}`, 'has to be a lower-case extension without a dot');
      notNc(ext, `detect.extensions.${clip(ext)}`, p);
      num(weight, `detect.extensions.${ext}`, p, { min: 0 });
    }
  }

  const content = patternArr(detect.content, 'detect.content', p);
  if (content) {
    content.forEach((entry, i) => {
      const rule = obj(entry, `detect.content[${i}]`, p);
      if (!rule) return;
      pattern(rule.pattern, `detect.content[${i}].pattern`, p);
      num(rule.weight, `detect.content[${i}].weight`, p, { min: 0 });
    });
  }

  optStrArr(detect.folders, 'detect.folders', p, { max: MAX_FOLDER_LENGTH, cap: MAX_PATTERN_LIST });
  optNum(detect.priority, 'detect.priority', p);
  if (detect.vetoes !== undefined) patternList(detect.vetoes, 'detect.vetoes', p);
}

/**
 * Whether `ch` already means something at the head of a block or a word (M9 review F4):
 * one of [`RESERVED_HEAD_CHARS`], or the first character of one of the profile's comment
 * starts, block-skip characters or continuation mark.
 */
function reservedHead(ch: string, syntax: Record<string, unknown>): boolean {
  if (RESERVED_HEAD_CHARS.has(ch)) return true;
  const comments = Array.isArray(syntax.comments) ? syntax.comments : [];
  for (const entry of comments) {
    const start = entry && typeof entry === 'object' ? (entry as { start?: unknown }).start : undefined;
    if (typeof start === 'string' && start.startsWith(ch)) return true;
  }
  const skip = syntax.blockSkip && typeof syntax.blockSkip === 'object' ? (syntax.blockSkip as { chars?: unknown }).chars : undefined;
  if (typeof skip === 'string' && skip.includes(ch)) return true;
  return typeof syntax.continuationMark === 'string' && syntax.continuationMark.startsWith(ch);
}

function checkSyntax(value: unknown, p: Problems): void {
  const syntax = obj(value, 'syntax', p);
  if (!syntax) return;

  optBool(syntax.caseSensitive, 'syntax.caseSensitive', p);

  const comments = arr(syntax.comments, 'syntax.comments', p, 1);
  if (comments) {
    comments.forEach((entry, i) => {
      const comment = obj(entry, `syntax.comments[${i}]`, p);
      if (!comment) return;
      str(comment.start, `syntax.comments[${i}].start`, p);
      // `null` is the line comment that runs to the end of the line.
      if (comment.end !== null) str(comment.end, `syntax.comments[${i}].end`, p);
    });
  }

  optBool(syntax.strings, 'syntax.strings', p);
  optPattern(syntax.sectionHeading, 'syntax.sectionHeading', p);
  optPattern(syntax.continuation, 'syntax.continuation', p);
  optStr(syntax.continuationMark, 'syntax.continuationMark', p);
  const caseSensitive = syntax.caseSensitive === true;
  // M8 (§7.16 #27): the marker stands at the start of the line it continues, so a pattern
  // that could match further in would make a `$` in the middle of a block a new block's
  // continuation, and one that needs no marker at all (`^`, `^\s*`) would make the whole
  // program one block, with the first thread cycle's lead protecting every feed after it.
  // T177: every alternative is anchored, not only the first (`^\$ |\$\t` matched mid-line).
  const marker = syntax.continuationStart;
  optPattern(marker, 'syntax.continuationStart', p);
  if (typeof marker === 'string' && !marker.startsWith('^')) {
    p.add('syntax.continuationStart', 'has to be anchored at the start of the line (^)');
  } else if (typeof marker === 'string' && !anchoredAtLineStart(marker)) {
    p.add('syntax.continuationStart', 'has to be anchored at the start of the line (^) in every alternative: write ^ in front of each, or ^(?:…|…)');
  } else if (typeof marker === 'string' && matchesPlainBlock(marker, caseSensitive)) {
    p.add('syntax.continuationStart', 'matches a line without a marker, so every line would join the block above');
  }
  optVariablePattern(syntax.variables, 'syntax.variables', caseSensitive, p);

  const blockSkip = optObj(syntax.blockSkip, 'syntax.blockSkip', p);
  if (blockSkip) {
    str(blockSkip.chars, 'syntax.blockSkip.chars', p);
    enumOf(blockSkip.position, 'syntax.blockSkip.position', p, ['before-number', 'after-number', 'either'] as const);
    optBool(blockSkip.levels, 'syntax.blockSkip.levels', p);
    optEnum(blockSkip.plainLevel, 'syntax.blockSkip.plainLevel', p, ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const);
  }

  const blockNumber = obj(syntax.blockNumber, 'syntax.blockNumber', p);
  if (blockNumber) {
    const mode = enumOf(blockNumber.mode, 'syntax.blockNumber.mode', p, ['prefix', 'leading-integer'] as const);
    if (mode === 'prefix') str(blockNumber.prefix, 'syntax.blockNumber.prefix', p, ADDRESS);
    else optStr(blockNumber.prefix, 'syntax.blockNumber.prefix', p, ADDRESS);
    optStrArr(blockNumber.altPrefixes, 'syntax.blockNumber.altPrefixes', p, { allow: ADDRESS });
    bool(blockNumber.mandatory, 'syntax.blockNumber.mandatory', p);
    // P9 (§7.1, R4): the prefix of a main block number (Sinumerik `:123`). One character
    // that cannot start a word, so it can never be read as an address as well.
    optStr(blockNumber.mainPrefix, 'syntax.blockNumber.mainPrefix', p, MAIN_PREFIX);
    const mainPrefix = blockNumber.mainPrefix;
    if (typeof mainPrefix === 'string' && mainPrefix === blockNumber.prefix) {
      p.add('syntax.blockNumber.mainPrefix', 'is the same as syntax.blockNumber.prefix');
    } else if (typeof mainPrefix === 'string' && MAIN_PREFIX.test(mainPrefix) && reservedHead(mainPrefix, syntax)) {
      p.add(
        'syntax.blockNumber.mainPrefix',
        `"${mainPrefix}" already starts a comment, a block skip, a string, a program mark, a sign or an expression, so it cannot start a main block number too`,
      );
    }
  }

  // P8. The four patterns and the two flags the turning dialects add (§7.1). They are
  // optional everywhere: a profile that leaves them out tokenizes exactly as it did in P1.
  optBool(syntax.sequenceNames, 'syntax.sequenceNames', p);
  optPattern(syntax.assignment, 'syntax.assignment', p);
  optPattern(syntax.labels, 'syntax.labels', p);
  // Both tokenizers read the label's name out of this group (§7.1), and without it they
  // find no label at all, while the grammar still paints one (G8 M8).
  if (typeof syntax.labels === 'string' && !syntax.labels.includes('(?<name>')) {
    p.add('syntax.labels', 'has to carry the named group (?<name>…)');
  }
  optBool(syntax.calls, 'syntax.calls', p);
  // P9 (§7.1, R4): an assignment word may carry one bracket index (Sinumerik `LIMS[2]=`),
  // and the control's own multi-letter addresses among the assignment words (Okuma `SB`,
  // `TL`), so the rest are the names a program gives its local variables.
  optBool(syntax.assignmentIndex, 'syntax.assignmentIndex', p);
  optPattern(syntax.extendedAddresses, 'syntax.extendedAddresses', p);
  if (typeof syntax.extendedAddresses === 'string' && matchesEmpty(syntax.extendedAddresses, caseSensitive)) {
    p.add('syntax.extendedAddresses', 'can match an empty string, and an address has to take at least one letter');
  }
  optVariablePattern(syntax.systemVariables, 'syntax.systemVariables', caseSensitive, p);
  // P4a fix B1 (NC-6): the first number of a numbered system variable (Fanuc #1000).
  optNum(syntax.systemVariableNumbers, 'syntax.systemVariableNumbers', p, { int: true, min: 1 });
  // D6-7: an increment after a shift travels the shift too (Sinumerik SD42440).
  optBool(syntax.incrementTravelsShift, 'syntax.incrementTravelsShift', p);
  // Review round (D6-4, NC-9): two notes of Translate.
  optBool(syntax.tcpTableCoordinates, 'syntax.tcpTableCoordinates', p);
  optStrArr(syntax.cycleRAbsoluteWith, 'syntax.cycleRAbsoluteWith', p, { min: 1, allow: /^[a-z0-9][a-z0-9-]*$/ });
  // P4h (§6.10 rule 13; T123): the machine's axis names read with the value packed behind.
  checkExtraAxisNames(syntax.extraAxisNames, p);
  optPattern(syntax.header, 'syntax.header', p);
  // M8 integration (§7.16): the names a program gives itself, one token each.
  optPattern(syntax.names, 'syntax.names', p);
  // Phase 2 (§7.16): a program name in place of a program number (Fanuc `<SHAFT_T12>`).
  const programNames = syntax.programNames;
  optPattern(programNames, 'syntax.programNames', p);
  if (typeof programNames === 'string' && matchesEmpty(programNames, caseSensitive)) {
    p.add('syntax.programNames', 'can match an empty string, and a program name has to take at least one character');
  }

  enumOf(syntax.decimalSeparator, 'syntax.decimalSeparator', p, ['.', ','] as const);
  // §7.16 / R4: the decimal comma. A profile may accept it *alongside* the separator
  // above when reading a number (Klartext CAM output writes both), but not as the same
  // character twice.
  optEnum(syntax.decimalSeparatorAlt, 'syntax.decimalSeparatorAlt', p, ['.', ','] as const);
  if (typeof syntax.decimalSeparatorAlt === 'string' && syntax.decimalSeparatorAlt === (syntax.decimalSeparator ?? '.')) {
    p.add('syntax.decimalSeparatorAlt', 'is the same character as syntax.decimalSeparator');
  }
  // P9 (§7.1, R4): the letters of an exponent inside a number (Sinumerik `1.5EX3`).
  optStr(syntax.exponentMarker, 'syntax.exponentMarker', p, LETTERS);
  // M9 review F4: one letter is an address in every word-address dialect. With `G` as the
  // marker, `X10G1` would read as one number (10 times ten) instead of `X10` and `G1`, so
  // the marker takes two letters at least (`EX`).
  if (typeof syntax.exponentMarker === 'string' && /^[A-Za-z]$/.test(syntax.exponentMarker)) {
    p.add('syntax.exponentMarker', 'has to be at least two letters: a single letter is an address of its own');
  }
  // M9-2 (2026-10-08): marks that address the value behind them (Klartext `#5`).
  checkSymbolAddresses(syntax, p);
  // 2026-10-08: what Remove Spaces may do (Sinumerik refuses it, Okuma keeps long addresses apart).
  optEnum(syntax.removeSpaces, 'syntax.removeSpaces', p, ['refuse', 'keepAroundLongAddresses'] as const);
  bool(syntax.decimalPointSignificant, 'syntax.decimalPointSignificant', p);
  bool(syntax.wordSeparatorRequired, 'syntax.wordSeparatorRequired', p);
  optStr(syntax.incrementalPrefix, 'syntax.incrementalPrefix', p, ADDRESS);
  optStrArr(syntax.keywords, 'syntax.keywords', p);
  optNum(syntax.maxLineLength, 'syntax.maxLineLength', p, { int: true, min: 1 });
  // M10 (WP10.2): read by the program checks.
  optNum(syntax.maxWordDigits, 'syntax.maxWordDigits', p, { int: true, min: 1 });
  optNum(syntax.maxMCodes, 'syntax.maxMCodes', p, { int: true, min: 1 });
  checkTextFields(syntax, caseSensitive, p);
}

/** P4h (§6.10 rule 13): `syntax.extraAxisNames`, letters only, no name twice (ignoring case). */
function checkExtraAxisNames(value: unknown, p: Problems): void {
  if (value === undefined) return;
  const before = p.list.length;
  strArr(value, 'syntax.extraAxisNames', p, { allow: EXTRA_AXIS_NAME, cap: MAX_EXTRA_AXES });
  if (p.list.length !== before || !Array.isArray(value)) return;
  const seen = new Set<string>();
  value.forEach((name, i) => {
    const key = String(name).toUpperCase();
    if (seen.has(key)) p.add(`syntax.extraAxisNames[${i}]`, `"${String(name)}" is already listed`);
    seen.add(key);
  });
}

/** M12.5: a colon word's name, `VCONST`, `HSC-MODE` — letters, digits, `_` and `-`, starting with a letter. */
const COLON_WORD = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * The seven M12.5 fields (§7.16 #179). The keyword lists name keywords of the profile,
 * because the tokenizers only look behind a keyword token; a `freeText` pattern carries the
 * group `text`, the one the tokenizers read; no pattern may match the empty string, which
 * would read nothing as a program name or a text.
 */
function checkTextFields(syntax: Record<string, unknown>, caseSensitive: boolean, p: Problems): void {
  const known = new Set(
    (Array.isArray(syntax.keywords) ? syntax.keywords : [])
      .filter((keyword): keyword is string => typeof keyword === 'string')
      .map((keyword) => keyword.trim().split(/\s+/).join(' ').toUpperCase()),
  );
  const keywordList = (value: unknown, path: string): void => {
    if (value === undefined) return;
    const before = p.list.length;
    strArr(value, path, p, { min: 1 });
    if (p.list.length !== before || !Array.isArray(value)) return;
    value.forEach((entry, i) => {
      if (!known.has(String(entry).trim().split(/\s+/).join(' ').toUpperCase())) p.add(`${path}[${i}]`, 'is not one of syntax.keywords');
    });
  };

  if (syntax.freeText !== undefined) {
    const list = patternArr(syntax.freeText, 'syntax.freeText', p, 1);
    list?.forEach((entry, i) => {
      const path = `syntax.freeText[${i}]`;
      const before = p.list.length;
      pattern(entry, path, p);
      if (p.list.length !== before || typeof entry !== 'string') return;
      if (!entry.includes('(?<text>')) p.add(path, 'has to carry the named group (?<text>…)');
      else if (matchesEmpty(entry, caseSensitive)) p.add(path, 'can match an empty string, and a text has to take at least one character');
    });
  }
  optStrArr(syntax.colonWords, 'syntax.colonWords', p, { min: 1, allow: COLON_WORD });
  const callTargets = optObj(syntax.callTargets, 'syntax.callTargets', p);
  if (callTargets) {
    keywordList(callTargets.after ?? [], 'syntax.callTargets.after');
    const before = p.list.length;
    pattern(callTargets.pattern, 'syntax.callTargets.pattern', p);
    if (p.list.length === before && typeof callTargets.pattern === 'string' && matchesEmpty(callTargets.pattern, caseSensitive)) {
      p.add('syntax.callTargets.pattern', 'can match an empty string, and a program name has to take at least one character');
    }
  }
  keywordList(syntax.labelAfter, 'syntax.labelAfter');
  keywordList(syntax.declareAfter, 'syntax.declareAfter');
  // One letter would make every address of a packed dialect a run of plain text.
  optNum(syntax.plainTextRun, 'syntax.plainTextRun', p, { int: true, min: 2 });
  optBool(syntax.tapeMarker, 'syntax.tapeMarker', p);
}

/**
 * `syntax.symbolAddresses`: one character each, and none that already means something to the
 * tokenizer — a letter, a digit, a blank, `"`, a sign, the decimal separators, a comment
 * start, the continuation mark or a block-skip mark.
 */
function checkSymbolAddresses(syntax: Record<string, unknown>, p: Problems): void {
  const marks = syntax.symbolAddresses;
  if (marks === undefined) return;
  if (!Array.isArray(marks)) {
    p.add('syntax.symbolAddresses', 'has to be a list of single characters');
    return;
  }
  const taken = new Set<string>(['"', '+', '-', '.', ',', '(', ')', '[', ']', '=']);
  const comments = Array.isArray(syntax.comments) ? syntax.comments : [];
  for (const marker of comments) {
    const start = (marker as { start?: unknown } | null)?.start;
    if (typeof start === 'string' && start !== '') taken.add(start[0]);
  }
  if (typeof syntax.continuationMark === 'string' && syntax.continuationMark !== '') taken.add(syntax.continuationMark[0]);
  const skip = syntax.blockSkip as { chars?: unknown } | undefined;
  if (skip && typeof skip.chars === 'string') for (const char of skip.chars) taken.add(char);
  marks.forEach((mark, i) => {
    const path = `syntax.symbolAddresses[${i}]`;
    if (typeof mark !== 'string' || mark.length !== 1) p.add(path, 'has to be one character');
    else if (/[A-Za-z0-9\s]/.test(mark)) p.add(path, 'may not be a letter, a digit or a blank');
    else if (taken.has(mark)) p.add(path, `already means something else in this profile (${mark})`);
  });
}

/**
 * `addresses`. `at` and `complete` serve a variant overlay (P4.39a agreement fix): there the
 * members are checked with the same shapes at the overlay's path, and none is required.
 */
function checkAddresses(value: unknown, p: Problems, at = 'addresses', complete = true): void {
  const addresses = complete ? obj(value, at, p) : optObj(value, at, p);
  if (!addresses) return;
  for (const key of ['tool', 'feed', 'rapid', 'spindle'] as const) {
    optStr(addresses[key], `${at}.${key}`, p, ADDRESS);
  }
  (complete ? strArr : optStrArr)(addresses.axes, `${at}.axes`, p, { min: 1, allow: ADDRESS });
  optStrArr(addresses.arcCenter, `${at}.arcCenter`, p, { allow: ADDRESS });
  optEnum(addresses.arcCenterMode, `${at}.arcCenterMode`, p, ['incremental', 'absolute'] as const);

  // M6 (§7.1). `incremental` says which axis an incremental address moves, so its value
  // has to be one of the axes: `{ U: 'X' }` is what makes `U2.` a step along X, and a typo
  // there would move the wrong axis in every extent and every arithmetic answer.
  const axes = Array.isArray(addresses.axes) ? addresses.axes : [];
  const incremental = optObj(addresses.incremental, `${at}.incremental`, p);
  if (incremental) {
    for (const [word, axis] of Object.entries(incremental)) {
      const where = `${at}.incremental.${word}`;
      if (!ADDRESS.test(word)) p.add(where, 'has to be an address letter');
      const target = str(axis, where, p, ADDRESS);
      if (target !== null && axes.length > 0 && !axes.includes(target)) {
        p.add(where, `"${target}" is not in addresses.axes`);
      }
    }
  }
  optStrArr(addresses.diameter, `${at}.diameter`, p, { allow: ADDRESS });
  optStrArr(addresses.angular, `${at}.angular`, p, { allow: ADDRESS });

  // P8. `LIMS` is an address, not a code: it has to look like one so that a script can
  // find it and leave it alone.
  optStrArr(addresses.speedLimitWords, `${at}.speedLimitWords`, p, { allow: ADDRESS });
  // P4a fix B1 (NC-17): offset numbers that are no position (Sinumerik `D`).
  optStrArr(addresses.offsetWords, `${at}.offsetWords`, p, { allow: ADDRESS });
  // 2026-09: the main spindle's number, as a spindle word writes it (`S1=` is spindle 1).
  optStr(addresses.mainSpindle, `${at}.mainSpindle`, p, /^[A-Za-z0-9]+$/);

  const feedUnitWords = optObj(addresses.feedUnitWords, `${at}.feedUnitWords`, p);
  if (feedUnitWords) {
    for (const [word, unit] of Object.entries(feedUnitWords)) {
      const where = `${at}.feedUnitWords.${word}`;
      if (!ADDRESS.test(word)) p.add(where, 'has to be an address or a keyword');
      enumOf(unit, where, p, FEED_UNITS);
    }
  }

  // Phase 4 (P4a prelude, plan §6.2): the direction words of an arc (Klartext `DR+`, `DR-`).
  // A mirror swaps a word for the one of the other direction, so each direction may have
  // one word at most; the word is an address and a sign, nothing after it.
  const directionWords = optObj(addresses.arcDirectionWords, `${at}.arcDirectionWords`, p);
  if (directionWords) {
    const seen = new Set<string>();
    const spelled = new Set<string>();
    for (const [word, direction] of Object.entries(directionWords)) {
      const where = `${at}.arcDirectionWords.${word}`;
      if (!DIRECTION_WORD.test(word)) {
        p.add(where, 'has to be an address followed by + or -');
        continue;
      }
      // A program is read in upper case, so `DR+` and `dr+` are one word.
      if (spelled.has(word.toUpperCase())) {
        p.add(where, 'the same word as an earlier one, apart from upper and lower case');
        continue;
      }
      spelled.add(word.toUpperCase());
      const value = enumOf(direction, where, p, ARC_DIRECTIONS);
      if (value === null) continue;
      if (seen.has(value)) p.add(where, `a second word for the direction ${value}`);
      seen.add(value);
    }
  }
}

/**
 * `modal` (§7.1, AD-19 rule 8, AD-31).
 *
 * `initial` is the power-on state a profile documents. `units`, `diameter` and `sources`
 * are **computed**: `applyMachine` writes them from the document's machine, and a profile
 * file that carries them would state as a fact of the dialect what is a setting of one
 * machine (AD-31). They are therefore accepted on the way in — the applied profile goes
 * through this same validator — and reported when a profile file itself carries one.
 */
function checkModal(value: unknown, p: Problems, o: ProfileValidationOptions): void {
  const modal = optObj(value, 'modal', p);
  if (!modal) return;

  const initial = optObj(modal.initial, 'modal.initial', p);
  if (initial) {
    for (const [group, code] of Object.entries(initial)) {
      checkModalCode(group, code, 'modal.initial', p);
    }
  }

  optEnum(modal.units, 'modal.units', p, ['mm', 'inch'] as const);
  optEnum(modal.diameter, 'modal.diameter', p, ['on', 'off'] as const);
  const sources = optObj(modal.sources, 'modal.sources', p);
  if (sources) {
    for (const [key, source] of Object.entries(sources)) {
      enumOf(source, `modal.sources.${key}`, p, PARAM_SOURCES);
    }
  }

  if (o.applied) return;
  for (const field of ['units', 'diameter', 'sources'] as const) {
    if (modal[field] !== undefined) {
      p.add(
        `modal.${field}`,
        'is written by the document\'s machine, not by a profile (use machineParams instead)',
      );
    }
  }
}

/** One `<group>: <code>` of a power-on state, wherever it is written. */
function checkModalCode(group: string, code: unknown, path: string, p: Problems): void {
  const at = `${path}.${group}`;
  if (group.trim() === '') p.add(at, 'a modal group needs a name');
  const written = str(code, at, p);
  if (written === null) return;
  // The interpreter matches this against the database's canonical codes, so a padded or
  // lower-case spelling would silently match nothing and leave the group unset.
  const canonical = normalizeCode(written);
  if (canonical !== written) p.add(at, `has to be written as "${canonical}"`);
}

/** `toolCall`; `at` and `complete` as in [`checkAddresses`] (a variant overlay requires nothing). */
function checkToolCall(value: unknown, p: Problems, at = 'toolCall', complete = true): void {
  const toolCall = complete ? obj(value, at, p) : optObj(value, at, p);
  if (!toolCall) return;
  (complete ? pattern : optPattern)(toolCall.trigger, `${at}.trigger`, p);
  (complete ? pattern : optPattern)(toolCall.tool, `${at}.tool`, p);
  // The program map and the tool list read the number out of the named group.
  if (typeof toolCall.tool === 'string' && !toolCall.tool.includes('(?<tool>')) {
    p.add(`${at}.tool`, 'has to carry the named group (?<tool>…)');
  }
  if (complete || toolCall.toolFrom !== undefined) {
    enumOf(toolCall.toolFrom, `${at}.toolFrom`, p, ['same-line', 'same-line-or-last', 'last-before'] as const);
  }
  // M6 (§7.1): a trigger line whose masked text also matches this is not a tool change.
  optPattern(toolCall.ignore, `${at}.ignore`, p);
}

function checkOutline(value: unknown, p: Problems): void {
  const outline = patternArr(value, 'outline', p);
  if (!outline) return;
  outline.forEach((entry, i) => {
    const rule = obj(entry, `outline[${i}]`, p);
    if (!rule) return;
    // M12 (P12, §7.14): channel groups and wait marks come from the channel service only.
    if (rule.kind === 'channel' || rule.kind === 'sync') {
      p.add(`outline[${i}].kind`, `"${rule.kind}" rows are made by the channel service, not by a profile's outline rules`);
    } else enumOf(rule.kind, `outline[${i}].kind`, p, OUTLINE_KINDS);
    pattern(rule.pattern, `outline[${i}].pattern`, p);
  });
}

/** `numbering`; `at` and `complete` as in [`checkAddresses`] (a variant overlay requires nothing). */
function checkNumbering(value: unknown, p: Problems, at = 'numbering', complete = true): void {
  const numbering = complete ? obj(value, at, p) : optObj(value, at, p);
  if (!numbering) return;
  optEnum(numbering.mode, `${at}.mode`, p, ['free', 'consecutive'] as const);
  (complete ? num : optNum)(numbering.start, `${at}.start`, p, { int: true, min: 0 });
  (complete ? num : optNum)(numbering.step, `${at}.step`, p, { int: true, min: 1 });
  optNum(numbering.digits, `${at}.digits`, p, { int: true, min: 0, max: 12 });
  optNum(numbering.max, `${at}.max`, p, { int: true, min: 1 });
  optEnum(numbering.onOverflow, `${at}.onOverflow`, p, ['wrap', 'stop'] as const);
  optNum(numbering.spacesAfter, `${at}.spacesAfter`, p, { int: true, min: 0, max: 16 });
  optStrArr(numbering.skipStartingWith, `${at}.skipStartingWith`, p);
  optBool(numbering.skipEmpty, `${at}.skipEmpty`, p);
  optBool(numbering.restartAtProgramStart, `${at}.restartAtProgramStart`, p);
  optBool(numbering.onlyNumbered, `${at}.onlyNumbered`, p);
  // P4d (plan §6.6 rules 1–6): the advanced options, each optional; a profile that leaves
  // them out renumbers exactly as before.
  optBool(numbering.fitToMax, `${at}.fitToMax`, p);
  optNum(numbering.alignColumn, `${at}.alignColumn`, p, { int: true, min: 0, max: MAX_ALIGN_COLUMN });
  optNum(numbering.everyNth, `${at}.everyNth`, p, { int: true, min: 1, max: MAX_EVERY_NTH });
  // P4d review CODE-6: the form field is a space-separated list, so a text with a blank in
  // it would come back from the form as two texts; it is refused here instead.
  optStrArr(numbering.skipContaining, `${at}.skipContaining`, p, { max: MAX_SKIP_TEXT, cap: MAX_PATTERN_LIST, allow: NO_BLANK });
  optNum(numbering.skipFirst, `${at}.skipFirst`, p, { int: true, min: 0, max: MAX_SKIP_LINES });
  optNum(numbering.skipLast, `${at}.skipLast`, p, { int: true, min: 0, max: MAX_SKIP_LINES });
  // An empty text is "from the first line", the same as leaving it out.
  if (numbering.startTrigger !== undefined && numbering.startTrigger !== '') {
    str(numbering.startTrigger, `${at}.startTrigger`, p, undefined, MAX_SKIP_TEXT);
  }
  optBool(numbering.startAfterTrigger, `${at}.startAfterTrigger`, p);

  if (numbering.references !== undefined) {
    const references = patternArr(numbering.references, `${at}.references`, p);
    references?.forEach((entry, i) => {
      const rule = obj(entry, `${at}.references[${i}]`, p);
      if (!rule) return;
      pattern(rule.trigger, `${at}.references[${i}].trigger`, p);
      strArr(rule.addresses, `${at}.references[${i}].addresses`, p, { min: 1, allow: ADDRESS });
      // M6 (§7.1, F42): `false` means "report, do not rewrite" — a Fanuc `M99 P` may name
      // a block in the caller, which a renumber of this file cannot see.
      optBool(rule.rewrite, `${at}.references[${i}].rewrite`, p);
      // P4d (§6.6 rule 8): which program's block the value names.
      optEnum(rule.program, `${at}.references[${i}].program`, p, REFERENCE_PROGRAMS);
    });
  }

  // P4d (§6.6 rule 9): the lines that call another program, and the word that names it.
  if (numbering.calls !== undefined) {
    const calls = patternArr(numbering.calls, `${at}.calls`, p);
    calls?.forEach((entry, i) => {
      const rule = obj(entry, `${at}.calls[${i}]`, p);
      if (!rule) return;
      pattern(rule.trigger, `${at}.calls[${i}].trigger`, p);
      str(rule.address, `${at}.calls[${i}].address`, p, ADDRESS);
      optNum(rule.maxDigits, `${at}.calls[${i}].maxDigits`, p, { int: true, min: 1, max: 16 });
      optStr(rule.repeatAddress, `${at}.calls[${i}].repeatAddress`, p, ADDRESS);
      // P4d review NC-1 and NC-2: the word of a local call, and a call that is an interrupt.
      optStr(rule.localAddress, `${at}.calls[${i}].localAddress`, p, ADDRESS);
      optBool(rule.interrupt, `${at}.calls[${i}].interrupt`, p);
    });
  }
}

// ---------------------------------------------------------------------------
// The machine-parameter declaration (M6, §7.1, §7.15, §8.8, AD-31)
// ---------------------------------------------------------------------------

/** A `NumberInput`, wherever it is written: a preset's value, or a stored machine's own. */
function checkNumberInput(value: unknown, path: string, p: Problems): void {
  const input = obj(value, path, p);
  if (!input) return;

  enumOf(input.mode, `${path}.mode`, p, READINGS);
  increment(input.incrementMm, `${path}.incrementMm`, p, true);
  increment(input.incrementInch, `${path}.incrementInch`, p);
  increment(input.incrementDeg, `${path}.incrementDeg`, p);
  increment(input.incrementSec, `${path}.incrementSec`, p);

  const classes = optObj(input.classes, `${path}.classes`, p);
  if (!classes) return;
  for (const [name, spec] of Object.entries(classes)) {
    const at = `${path}.classes.${name}`;
    if (!(NUMBER_CLASSES as readonly string[]).includes(name)) {
      p.add(at, `"${name}" is not a number class (${NUMBER_CLASSES.join(', ')})`);
      continue;
    }
    const entry = obj(spec, at, p);
    if (!entry) continue;
    if (entry.mode !== undefined) enumOf(entry.mode, `${at}.mode`, p, READINGS);
    increment(entry.increment, `${at}.increment`, p);
    if (entry.incrementInch !== undefined && !(UNIT_CLASSES as readonly string[]).includes(name)) {
      p.add(`${at}.incrementInch`, `the ${name} class does not follow the program's units`);
    } else {
      increment(entry.incrementInch, `${at}.incrementInch`, p);
    }
  }
}

/** The feed classes a point-less-feeds choice may set (T084). */
const POINTLESS_FEED_CLASSES = ['feedPerMin', 'feedPerRev'] as const;

/**
 * T084: `machineParams.numberInput.pointlessFeeds`, the machine option for feeds written
 * without a point. Its default choice sets nothing: the option is never read without a
 * machine, and a machine that leaves it alone reads its feeds as the preset says.
 */
function checkPointlessFeeds(value: unknown, path: string, p: Problems): void {
  const decl = optObj(value, path, p);
  if (!decl) return;
  optStr(decl.source, `${path}.source`, p);
  optBool(decl.verify, `${path}.verify`, p);
  const choices = arr(decl.choices, `${path}.choices`, p, 1);
  const values = new Set<string>();
  const plain = new Set<string>();
  choices?.forEach((entry, i) => {
    const at = `${path}.choices[${i}]`;
    const choice = obj(entry, at, p);
    if (!choice) return;
    const id = str(choice.value, `${at}.value`, p);
    if (id !== null) {
      if (values.has(id)) p.add(`${at}.value`, `"${id}" is already taken`);
      values.add(id);
    }
    str(choice.label, `${at}.label`, p);
    const classes = optObj(choice.classes, `${at}.classes`, p);
    if (!classes || Object.keys(classes).length === 0) {
      if (id !== null) plain.add(id);
      return;
    }
    for (const [name, spec] of Object.entries(classes)) {
      const where = `${at}.classes.${name}`;
      if (!(POINTLESS_FEED_CLASSES as readonly string[]).includes(name)) {
        p.add(where, `"${name}" is not a feed class (${POINTLESS_FEED_CLASSES.join(', ')})`);
        continue;
      }
      const step = obj(spec, where, p);
      if (!step) continue;
      for (const key of Object.keys(step)) {
        if (key !== 'increment' && key !== 'incrementInch') p.add(`${where}.${key}`, 'only increment and incrementInch may be set');
      }
      increment(step.increment, `${where}.increment`, p, true);
      increment(step.incrementInch, `${where}.incrementInch`, p);
    }
  });
  const fallback = str(decl.default, `${path}.default`, p);
  if (fallback === null || choices === null) return;
  if (!values.has(fallback)) p.add(`${path}.default`, `"${fallback}" is not one of the choices`);
  else if (!plain.has(fallback)) p.add(`${path}.default`, `the default choice "${fallback}" has to set no classes`);
}

/** A least increment: decimal text, a power of ten no larger than one. */
function increment(value: unknown, path: string, p: Problems, required = false): void {
  if (value === undefined) {
    if (required) p.add(path, 'is required');
    return;
  }
  const text = str(value, path, p);
  if (text !== null && !INCREMENT.test(text)) {
    p.add(path, 'has to be decimal text such as "0.001" or "1"');
  }
}

/**
 * A variant overlay (§7.1): a partial profile, limited to the four members a variant may
 * change. The limit is the point — a G-code system decides the power-on state, the tool
 * rule, the numbering and the addresses, and nothing else. It is checked here and again in
 * `applyMachine`, which drops anything else before it merges.
 *
 * The merge result goes through this validator in full when the variant is chosen. This pass
 * checks the members it may set, its power-on codes, and every member of `toolCall`,
 * `numbering` and `addresses` with the shape the profile's own member has (none of them is
 * required: the overlay is merged over a complete profile), so a mistake in an overlay is
 * reported with the profile and not first on the user's document.
 */
function checkOverlay(value: unknown, path: string, p: Problems): void {
  const overlay = optObj(value, path, p);
  if (!overlay) return;

  for (const key of Object.keys(overlay)) {
    if (key !== 'modal' && key !== 'toolCall' && key !== 'numbering' && key !== 'addresses') {
      p.add(`${path}.${key}`, 'an overlay may only set modal, toolCall, numbering and addresses');
    }
  }

  const modal = optObj(overlay.modal, `${path}.modal`, p);
  const initial = modal === null ? null : optObj(modal.initial, `${path}.modal.initial`, p);
  if (initial) {
    for (const [group, code] of Object.entries(initial)) {
      checkModalCode(group, code, `${path}.modal.initial`, p);
    }
  }

  // P4.39a agreement fix (§6.10 rule 2): the three other members are checked with the shapes
  // of the profile's own `toolCall`, `numbering` and `addresses`, none of them required, so the
  // profile schema and this validator give one answer on an overlay. A wrong `toolFrom` or a
  // non-list `addresses.diameter` used to pass here and fail first on the user's document.
  checkToolCall(overlay.toolCall, p, `${path}.toolCall`, false);
  checkNumbering(overlay.numbering, p, `${path}.numbering`, false);
  checkAddresses(overlay.addresses, p, `${path}.addresses`, false);
}

/** One `machineParams.variants` entry (§7.15): the choices, their databases and their rules. */
function checkVariant(value: unknown, path: string, p: Problems, o: ProfileValidationOptions): void {
  const variant = obj(value, path, p);
  if (!variant) return;

  str(variant.id, `${path}.id`, p, VARIANT_ID);
  str(variant.label, `${path}.label`, p);

  const choices = arr(variant.choices, `${path}.choices`, p, 1);
  const values = new Set<string>();
  choices?.forEach((entry, i) => {
    const at = `${path}.choices[${i}]`;
    const choice = obj(entry, at, p);
    if (!choice) return;
    const value = str(choice.value, `${at}.value`, p);
    if (value !== null) {
      if (values.has(value)) p.add(`${at}.value`, `"${value}" is already taken`);
      values.add(value);
    }
    str(choice.label, `${at}.label`, p);

    if (choice.codes !== undefined) {
      const dialect = str(choice.codes, `${at}.codes`, p, PROFILE_ID);
      if (dialect !== null && o.codeDbs !== undefined && !o.codeDbs.includes(dialect)) {
        p.add(`${at}.codes`, `the code database "${dialect}" was not found`);
      }
    }
    checkOverlay(choice.overlay, `${at}.overlay`, p);

    if (choice.detect !== undefined) {
      const rules = patternArr(choice.detect, `${at}.detect`, p);
      rules?.forEach((raw, j) => {
        const rule = obj(raw, `${at}.detect[${j}]`, p);
        if (!rule) return;
        pattern(rule.pattern, `${at}.detect[${j}].pattern`, p);
        num(rule.weight, `${at}.detect[${j}].weight`, p, { min: 0 });
      });
    }
  });

  const fallback = str(variant.default, `${path}.default`, p);
  if (fallback !== null && choices !== null && !values.has(fallback)) {
    p.add(`${path}.default`, `"${fallback}" is not one of the choices`);
  }

  // D5-3: the default that follows another variant. Its values have to be choices of this
  // variant; the other variant and its keys are checked in `checkVariantDefaults`.
  const by = optObj(variant.defaultBy, `${path}.defaultBy`, p);
  if (by) {
    str(by.variant, `${path}.defaultBy.variant`, p, VARIANT_ID);
    const map = obj(by.values, `${path}.defaultBy.values`, p);
    if (map) {
      if (Object.keys(map).length === 0) p.add(`${path}.defaultBy.values`, 'names no value');
      for (const [key, target] of Object.entries(map)) {
        const at = `${path}.defaultBy.values.${key}`;
        if (typeof target !== 'string') p.add(at, 'has to be a choice of this variant');
        else if (choices !== null && !values.has(target)) p.add(at, `"${target}" is not one of the choices`);
      }
    }
  }
}

/**
 * D5-3: a `defaultBy` names another declared variant (not itself, not one whose own default
 * follows a third: no chains) and only that variant's choices as keys.
 */
function checkVariantDefaults(list: unknown[], p: Problems): void {
  const byId = new Map<string, Record<string, unknown>>();
  for (const entry of list) if (isRecord(entry) && typeof entry.id === 'string') byId.set(entry.id, entry);
  list.forEach((entry, i) => {
    if (!isRecord(entry) || !isRecord(entry.defaultBy)) return;
    const at = `machineParams.variants[${i}].defaultBy`;
    const name = entry.defaultBy.variant;
    if (typeof name !== 'string') return;
    const other = byId.get(name);
    if (name === entry.id) p.add(`${at}.variant`, 'cannot name the variant itself');
    else if (other === undefined) p.add(`${at}.variant`, `"${name}" is not a variant of this profile`);
    else if (other.defaultBy !== undefined) p.add(`${at}.variant`, `"${name}" has a defaultBy of its own`);
    if (other === undefined || !isRecord(entry.defaultBy.values)) return;
    const keys = new Set((Array.isArray(other.choices) ? other.choices : []).map((c) => (isRecord(c) ? c.value : undefined)));
    for (const key of Object.keys(entry.defaultBy.values)) {
      if (!keys.has(key)) p.add(`${at}.values.${key}`, `"${key}" is not a choice of "${name}"`);
    }
  });
}

/**
 * `machineParams` (§7.1, §8.8): what a machine configuration of this profile may set.
 *
 * Everything here is **data about a documented default**, never a fact about anybody's
 * machine (AD-31), which is why the checks are strict about the two things a reader cannot
 * see: that the presets can be told apart by id, and that the profile's own
 * `syntax.decimalPointSignificant` says the same as its default preset. The second one is
 * what makes "no machine" behave exactly like Phase 1 — the JSON and the default reading
 * of a number are then one statement, not two that may drift.
 */
function checkMachineParams(root: Record<string, unknown>, p: Problems, o: ProfileValidationOptions): void {
  const decl = optObj(root.machineParams, 'machineParams', p);
  if (!decl) return;

  optEnum(decl.units, 'machineParams.units', p, ['mm', 'inch'] as const);
  optEnum(decl.diameter, 'machineParams.diameter', p, ['on', 'off'] as const);

  const groups = decl.modalGroups;
  if (groups !== undefined) {
    strArr(groups, 'machineParams.modalGroups', p);
    if (Array.isArray(groups) && o.modalGroups !== undefined) {
      groups.forEach((group, i) => {
        if (typeof group === 'string' && !o.modalGroups?.includes(group)) {
          p.add(`machineParams.modalGroups[${i}]`, `"${group}" is not a modal group of this profile's codes`);
        }
      });
    }
  }

  const variants = decl.variants;
  if (variants !== undefined) {
    const list = arr(variants, 'machineParams.variants', p);
    const ids = new Set<string>();
    list?.forEach((entry, i) => {
      checkVariant(entry, `machineParams.variants[${i}]`, p, o);
      const id = isRecord(entry) && typeof entry.id === 'string' ? entry.id : null;
      if (id === null) return;
      if (ids.has(id)) p.add(`machineParams.variants[${i}].id`, `"${id}" is already taken`);
      ids.add(id);
    });
    if (list) checkVariantDefaults(list, p);
  }

  checkChannelPresets(decl.channels, p);
  checkBuilderDecls(decl, p);

  const numberInput = optObj(decl.numberInput, 'machineParams.numberInput', p);
  if (!numberInput) return;

  const presets = arr(numberInput.presets, 'machineParams.numberInput.presets', p, 1);
  const ids = new Set<string>();
  let defaultValue: unknown;
  presets?.forEach((entry, i) => {
    const at = `machineParams.numberInput.presets[${i}]`;
    const preset = obj(entry, at, p);
    if (!preset) return;
    const id = str(preset.id, `${at}.id`, p, PRESET_ID);
    if (id !== null) {
      if (ids.has(id)) p.add(`${at}.id`, `"${id}" is already taken`);
      ids.add(id);
      if (id === numberInput.default) defaultValue = preset.value;
    }
    // The label is what the user picks by, so it says what the control does to a number.
    str(preset.label, `${at}.label`, p);
    optStr(preset.source, `${at}.source`, p);
    optBool(preset.verify, `${at}.verify`, p);
    optBool(preset.digitCheck, `${at}.digitCheck`, p);
    checkNumberInput(preset.value, `${at}.value`, p);
  });
  checkPointlessFeeds(numberInput.pointlessFeeds, 'machineParams.numberInput.pointlessFeeds', p);

  const fallback = str(numberInput.default, 'machineParams.numberInput.default', p);
  if (fallback !== null && presets !== null && !ids.has(fallback)) {
    p.add('machineParams.numberInput.default', `"${fallback}" is not one of the presets`);
    return;
  }
  if (o.applied || !isRecord(defaultValue)) return;

  // "No machine" has to mean what the JSON says (X10): a point-less word is a count of
  // increments exactly where the default preset reads it as one.
  const classes = isRecord(defaultValue.classes) ? defaultValue.classes : {};
  const length = isRecord(classes.length) ? classes.length : {};
  const mode = typeof length.mode === 'string' ? length.mode : defaultValue.mode;
  const significant = mode === 'increment';
  const syntax = isRecord(root.syntax) ? root.syntax : {};
  if (typeof syntax.decimalPointSignificant === 'boolean' && syntax.decimalPointSignificant !== significant) {
    p.add(
      'syntax.decimalPointSignificant',
      `has to be ${significant} for the default number input "${String(numberInput.default)}", which reads a length ${
        significant ? 'in increments' : 'as written'
      }`,
    );
  }
}

/**
 * M12 (P12, §8.9): `machineParams.channels` — the wait letters and the channel presets a
 * machine may start from. The shape is checked here; each preset's `value` goes through the
 * same `validateChannels` a stored machine does (WP12.3), so a built-in preset can never be
 * a block the Machines page would refuse.
 */
function checkChannelPresets(value: unknown, p: Problems): void {
  const decl = optObj(value, 'machineParams.channels', p);
  if (!decl) return;
  if (decl.waitLetters !== undefined) strArr(decl.waitLetters, 'machineParams.channels.waitLetters', p, { allow: /^[A-Z]$/ });
  const letters = Array.isArray(decl.waitLetters) ? decl.waitLetters.filter((l): l is string => typeof l === 'string') : undefined;
  const presets = arr(decl.presets, 'machineParams.channels.presets', p);
  const ids = new Set<string>();
  presets?.forEach((entry, i) => {
    const at = `machineParams.channels.presets[${i}]`;
    const preset = obj(entry, at, p);
    if (!preset) return;
    const id = str(preset.id, `${at}.id`, p, PRESET_ID);
    if (id !== null) {
      if (ids.has(id)) p.add(`${at}.id`, `"${id}" is already taken`);
      ids.add(id);
    }
    str(preset.label, `${at}.label`, p);
    optStr(preset.source, `${at}.source`, p);
    optBool(preset.verify, `${at}.verify`, p);
    if (obj(preset.value, `${at}.value`, p)) {
      for (const problem of validateChannels(preset.value, `${at}.value`, null, { waitLetters: letters })) {
        p.add(problem.path, problem.message);
      }
    }
  });
}

/**
 * P4h (plan §6.10 rules 13 and 14; T123): that a machine of this profile may name extra axes
 * and list the machine builder's codes. Both are only offers; the values are the machine's.
 */
function checkBuilderDecls(decl: Record<string, unknown>, p: Problems): void {
  const axes = optObj(decl.extraAxes, 'machineParams.extraAxes', p);
  if (axes) {
    optStr(axes.source, 'machineParams.extraAxes.source', p);
    optBool(axes.verify, 'machineParams.extraAxes.verify', p);
  }
  const codes = optObj(decl.builderCodes, 'machineParams.builderCodes', p);
  if (codes) {
    strArr(codes.letters, 'machineParams.builderCodes.letters', p, { min: 1, allow: /^[A-Z]$/ });
    optStr(codes.example, 'machineParams.builderCodes.example', p);
    optStr(codes.source, 'machineParams.builderCodes.source', p);
    optBool(codes.verify, 'machineParams.builderCodes.verify', p);
  }
}

function checkNumberFormat(value: unknown, p: Problems): void {
  const fmt = optObj(value, 'numberFormat', p);
  if (!fmt) return;
  if (fmt.decimals !== 'keep') num(fmt.decimals, 'numberFormat.decimals', p, { int: true, min: 0, max: 9 });
  enumOf(fmt.trailingZeros, 'numberFormat.trailingZeros', p, ['keep', 'drop'] as const);
  bool(fmt.keepPoint, 'numberFormat.keepPoint', p);
  enumOf(fmt.plusSign, 'numberFormat.plusSign', p, ['keep', 'always', 'never', 'signed'] as const);
}

function checkToolList(value: unknown, p: Problems): void {
  const toolList = optObj(value, 'toolList', p);
  if (!toolList) return;
  enumOf(toolList.description, 'toolList.description', p, ['auto', 'above', 'below', 'trailing'] as const);
  optPattern(toolList.commentFilter, 'toolList.commentFilter', p);
  optBool(toolList.dropLeadingZeros, 'toolList.dropLeadingZeros', p);
  optBool(toolList.collapseOffsetDigits, 'toolList.collapseOffsetDigits', p);
}

/**
 * P11 (§7.1, §7.7). The review-mode toggles are optional booleans and `keepComments`
 * an optional list of patterns. `tolerance` is accepted with any value and ignored: Phase 1
 * carried it, and the cut (§2.1, D41) must not turn a user profile that still has it into
 * a broken one. §7.16 #148: `cycleNames` is an optional list of patterns, each with the
 * named group `(?<name>…)` whose span `ignoreCycleNames` drops.
 */
function checkCompare(value: unknown, p: Problems): void {
  const compare = optObj(value, 'compare', p);
  if (!compare) return;
  for (const key of COMPARE_OPTION_KEYS) optBool(compare[key], `compare.${key}`, p);
  if (compare.keepComments !== undefined) patternList(compare.keepComments, 'compare.keepComments', p);
  if (compare.cycleNames !== undefined) {
    const list = patternArr(compare.cycleNames, 'compare.cycleNames', p);
    list?.forEach((entry, i) => {
      const before = p.list.length;
      pattern(entry, `compare.cycleNames[${i}]`, p);
      // Review mode drops the span of this group and nothing else.
      if (p.list.length === before && typeof entry === 'string' && !entry.includes('(?<name>')) {
        p.add(`compare.cycleNames[${i}]`, 'has to carry the named group (?<name>…)');
      }
    });
  }
}

/**
 * P13 (AD-30), P4c (plan §6.5), P4h (§6.10 rule 9). `forceUppercase`, `preventLineJoin`,
 * `autoSpace` and `autoNumber` are optional booleans (an absent one is off); `tabWidth` a whole
 * number from 1 to 16; `rulers` at most 8 different whole numbers from 1 to 1000. Any other
 * member (a field of a later phase) is carried unread.
 */
function checkEditing(value: unknown, p: Problems): void {
  const editing = optObj(value, 'editing', p);
  if (!editing) return;
  optBool(editing.forceUppercase, 'editing.forceUppercase', p);
  optBool(editing.preventLineJoin, 'editing.preventLineJoin', p);
  optBool(editing.autoSpace, 'editing.autoSpace', p);
  optBool(editing.autoNumber, 'editing.autoNumber', p);
  optNum(editing.tabWidth, 'editing.tabWidth', p, { int: true, min: 1, max: MAX_TAB_WIDTH });
  if (editing.rulers === undefined) return;
  const rulers = arr(editing.rulers, 'editing.rulers', p);
  if (!rulers) return;
  if (rulers.length > MAX_RULERS) {
    p.add('editing.rulers', `lists more than ${MAX_RULERS} rulers`);
    return;
  }
  const seen = new Set<unknown>();
  rulers.forEach((column, i) => {
    num(column, `editing.rulers[${i}]`, p, { int: true, min: 1, max: MAX_RULER_COLUMN });
    if (seen.has(column)) p.add(`editing.rulers[${i}]`, `${String(column)} is already listed`);
    seen.add(column);
  });
}

/**
 * P4h (plan §6.10 rule 6). `colors`: only `dark` and `light`, only roles, only `#rrggbb` values
 * that reach the contrast limit against the editor background of their theme
 * (`core/grammar/contrast.ts`). A colour that cannot be read is refused, never shown.
 */
function checkColors(value: unknown, p: Problems): void {
  if (value === undefined) return;
  for (const [path, message] of paletteProblems(value)) p.add(path === '' ? 'colors' : `colors.${path}`, message);
}

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

/**
 * Checks `raw` against the profile schema (§7.4 and the M6 fields of §7.1).
 *
 * On success the returned `profile` is `raw` itself, unknown fields included; on failure
 * every problem is listed as `<json.path>: <what is wrong>`. Never throws.
 *
 * `o` carries what the profile cannot say about itself; see [`ProfileValidationOptions`].
 */
export function validateProfile(raw: unknown, o: ProfileValidationOptions = {}): ProfileValidation {
  const p = new Problems(o);
  const root = obj(raw, '(profile)', p);
  if (!root) return { ok: false, errors: p.list };

  str(root.id, 'id', p, PROFILE_ID);
  str(root.name, 'name', p, undefined, MAX_NAME_LENGTH);
  str(root.shortName, 'shortName', p, undefined, MAX_SHORT_NAME_LENGTH);
  num(root.version, 'version', p, { int: true, min: 1 });
  enumOf(root.grammar, 'grammar', p, ['iso', 'klartext', 'okuma', 'sinumerik'] as const);
  const own = str(root.codes, 'codes', p, PROFILE_ID);
  // The database a profile names has to exist (CODE-13): an unknown name, `constructor` included,
  // is refused here, whatever else the caller can tell about it. `codeDbs` is the list of ids.
  if (own !== null && o.codeDbs !== undefined && !o.codeDbs.includes(own)) {
    p.add('codes', `the code database "${own}" was not found`);
  }
  optStr(root.extends, 'extends', p, PROFILE_ID);
  optEnum(root.machineType, 'machineType', p, ['mill', 'lathe'] as const);

  checkFiles(root.files, p);
  checkDetect(root.detect, p);
  checkSyntax(root.syntax, p);
  checkAddresses(root.addresses, p);
  checkToolCall(root.toolCall, p);

  const program = obj(root.program, 'program', p);
  if (program) {
    patternList(program.start, 'program.start', p);
    patternList(program.end, 'program.end', p);
    optBool(program.endRecord, 'program.endRecord', p);
  }

  checkOutline(root.outline, p);
  checkNumbering(root.numbering, p);
  checkNumberFormat(root.numberFormat, p);
  checkModal(root.modal, p, o);
  checkMachineParams(root, p, o);

  const onLoad = optObj(root.onLoad, 'onLoad', p);
  if (onLoad) optBool(onLoad.stripNul, 'onLoad.stripNul', p);

  checkToolList(root.toolList, p);
  checkCompare(root.compare, p);
  checkEditing(root.editing, p);
  checkColors(root.colors, p);

  return p.list.length === 0 ? { ok: true, profile: raw as Profile } : { ok: false, errors: p.list };
}
