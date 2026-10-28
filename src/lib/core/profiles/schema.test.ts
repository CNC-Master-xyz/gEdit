// The profile schema against the hand-written validator (Phase 4 plan AD-57, §6.10 rules 1–5).
//
// The validator stays the gate (P2 F6): the app never validates with the schema. This test holds
// `schemas/profile.schema.json` to the same answer as `resolveProfiles` + `validateProfile` on every
// built-in profile, every fixture profile and a set of broken ones, so a schema that drifts from the
// code fails CI:
//
//   - accepted by the code ⇒ accepted by the schema, always (a red line under a correct file in the
//     user's editor is the one mistake the schema may not make);
//   - refused by the code ⇒ refused by the schema, or the case names its rule in VALIDATOR_ONLY, a
//     rule JSON Schema cannot say, with the sentence why.
//
// The test validator is ajv 8 (draft 2020-12; a dev dependency, Q4h-1), set up in
// `tests/unit/helpers/jsonSchema.ts`. The two definitions this schema shares with
// `machines.schema.json` (`numberInput`, `channelParams`) are the real ones of that file.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ValidateFunction } from 'ajv/dist/2020';
import profileSchema from '../../../../schemas/profile.schema.json';
import machinesSchema from '../../../../schemas/machines.schema.json';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_SOURCES } from '$lib/data/profiles';
import { modalGroupsOf } from '$lib/core/codes/resolve';
import { COMPARE_OPTION_KEYS, type ProfileCompare } from '$lib/core/compare/types';
import { HEX_COLOR } from '$lib/core/grammar/contrast';
import { ROLES } from '$lib/core/grammar/roles';
import type { ProfileFieldKind } from '$lib/app/profileForm';
import { NON_NC_EXTENSIONS } from './ncDocument';
import { resolveProfiles } from './resolve';
import {
  EXTRA_AXIS_NAME,
  MAX_EXTRA_AXES,
  MAX_FOLDER_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PATTERN_LENGTH,
  MAX_PATTERN_LIST,
  MAX_RULERS,
  MAX_RULER_COLUMN,
  MAX_SHORT_NAME_LENGTH,
  MAX_TAB_WIDTH,
  validateProfile,
} from './validate';
import type {
  BuilderCodesDecl,
  CallRule,
  ChannelPreset,
  ChannelPresetsDecl,
  ExtraAxesDecl,
  MachineParamsDecl,
  NumberFormatOptions,
  NumberInputPreset,
  NumberingOptions,
  PointlessFeedChoice,
  PointlessFeedsDecl,
  Profile,
  ProfileColors,
  ProfileEditing,
  ProfileOverlay,
  ProfileSource,
  ReferenceRule,
  VariantChoice,
  VariantDecl,
} from './types';
import { FIXTURES_DIR } from '../../../../tests/unit/helpers/fixtures';
import { ALLOWED_KEYWORDS, testValidator } from '../../../../tests/unit/helpers/jsonSchema';

type Json = Record<string, unknown>;
type SchemaNode = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const clone = <T>(value: T): T => structuredClone(value);
const SCHEMA = profileSchema as unknown as SchemaNode;
const DEFS = SCHEMA.$defs as Record<string, SchemaNode>;

// ---------------------------------------------------------------------------------------------
// The test validator
// ---------------------------------------------------------------------------------------------

/** The definitions of `machines.schema.json` this schema refers to (rule 1). */
const SHARED_DEFS = ['numberInput', 'channelParams'] as const;

function compileProfileSchema(): ValidateFunction {
  const ajv = testValidator();
  ajv.addSchema(machinesSchema);
  return ajv.compile(SCHEMA);
}

const validateBySchema = compileProfileSchema();

/** The schema's verdict: the problems as `<instance path> <message>`, none when it accepts. */
function schemaProblems(file: unknown): string[] {
  if (validateBySchema(file)) return [];
  return (validateBySchema.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`);
}

// ---------------------------------------------------------------------------------------------
// The code's verdict on a file
// ---------------------------------------------------------------------------------------------

const CODE_DBS = Object.keys(BUILTIN_CODE_DB_JSON);

/** Every string of the built-in profiles, which the shape check leaves alone (as the registry does). */
const BUILTIN_STRINGS = new Set<string>();
(function collect(value: unknown): void {
  if (typeof value === 'string') BUILTIN_STRINGS.add(value);
  else if (Array.isArray(value)) value.forEach(collect);
  else if (isRecord(value)) Object.values(value).forEach(collect);
})(BUILTIN_PROFILE_SOURCES.map((source) => source.raw));

/** The options the registry passes for a profile of this origin (`stores/profiles.ts`). */
function registryOptions(profile: Json, origin: 'builtin' | 'user'): Parameters<typeof validateProfile>[1] {
  const codes = profile.codes;
  return {
    codeDbs: CODE_DBS,
    ...(typeof codes === 'string' && Object.hasOwn(BUILTIN_CODE_DB_JSON, codes)
      ? { modalGroups: modalGroupsOf(BUILTIN_CODE_DB_JSON as Record<string, unknown>, codes) }
      : {}),
    ...(origin === 'user' ? { checkShape: (source: string) => !BUILTIN_STRINGS.has(source) } : {}),
  };
}

/**
 * What the app says about `file` as a user profile beside the built-ins: the problems of
 * `resolveProfiles` and `validateProfile`, none when the profile loads.
 */
function codeProblems(file: unknown): string[] {
  const source: ProfileSource = { raw: file, origin: 'user', file: 'user.json' };
  const { resolved, problems } = resolveProfiles([...BUILTIN_PROFILE_SOURCES, source]);
  const out = problems.filter((p) => p.origin === 'user').map((p) => `${p.path}: ${p.message}`);
  const entry = resolved.find((r) => r.origin === 'user');
  if (entry) {
    const checked = validateProfile(entry.profile, registryOptions(entry.profile, 'user'));
    if (!checked.ok) out.push(...checked.errors);
  } else if (out.length === 0) {
    out.push('(not resolved)');
  }
  return out;
}

/** The built-in profiles resolved, as the registry has them. */
const RESOLVED_BUILTINS = resolveProfiles(BUILTIN_PROFILE_SOURCES).resolved;

/** A built-in as resolved, as a complete file of its own: `extends` gone, a user id. */
function completeFrom(builtin: string, id = `shop-${builtin}`): Json {
  const entry = RESOLVED_BUILTINS.find((r) => r.profile.id === builtin);
  if (!entry) throw new Error(`no built-in ${builtin}`);
  const file = clone(entry.profile);
  delete file.extends;
  file.id = id;
  return file;
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const P4H_PROFILES = join(FIXTURES_DIR, 'p4h', 'profiles');
const jsonFiles = (dir: string): string[] => readdirSync(dir).filter((name) => name.endsWith('.json')).sort();

// ---------------------------------------------------------------------------------------------
// The rules JSON Schema cannot say (rule 2)
// ---------------------------------------------------------------------------------------------

/** Each id with the sentence why the schema leaves it to the validator. Every id has a case below. */
const VALIDATOR_ONLY = {
  'pattern-compiles': 'Whether a text compiles as a regular expression needs a regular expression engine, not a keyword.',
  'pattern-subset': 'The common subset of JavaScript and Python regular expressions (no variable-width lookbehind, no \\p{…}, no \\k<…>) is a scan of the pattern, not a keyword.',
  'pattern-shape': 'A repeated group that repeats or chooses inside takes a scan of the pattern, and applies only to the patterns a user wrote.',
  'pattern-empty-match': 'Whether a pattern can match an empty string needs the pattern run on sample lines.',
  'pattern-anchored': 'That every alternative of a pattern starts with ^ needs the alternatives split apart; the schema checks the first one only.',
  'pattern-plain-block': 'Whether a pattern matches a line without the mark needs the pattern run on sample lines.',
  'pattern-count': 'The limit of patterns in a whole profile counts across members; the schema limits each list.',
  'canonical-code': 'Whether a power-on code is written as the code list writes it (G0, not G00) needs the code normalised.',
  'code-db-exists': 'Whether a code list of that name exists depends on the installed code lists.',
  'modal-group-exists': 'Whether a modal group exists depends on the code list the profile names.',
  'unique-by-member': 'A value unique among the entries of a list (preset ids, setting names, choice values) compares one member of each entry; uniqueItems compares whole entries.',
  'default-is-a-choice': 'That a default names one of the listed choices compares two members of the file.',
  'default-by-refers': 'That a default follows another setting that exists, is not itself and has no default rule of its own compares entries of a list.',
  'decimal-point-vs-preset': 'That the decimal point setting matches the reading of the default number input compares two members far apart.',
  'reserved-head-char': 'That a mark is not one of the profile\'s own comment, skip or continuation marks compares members of the file.',
  'incremental-names-an-axis': 'That an incremental address moves one of the listed axes compares two members of the file.',
  contrast: 'The contrast of a colour against the editor background is a computation, not a keyword.',
  'unique-ignoring-case': 'Names that must differ apart from upper and lower case need the case folded; uniqueItems compares them as written.',
  'default-extension-listed': 'That the default extension is one of the listed extensions compares two members of the file.',
  'keyword-of-profile': 'That a keyword list names keywords of syntax.keywords compares two members of the file.',
  'extends-resolves': 'Whether the profile it builds on exists, without a cycle and at most four levels deep, and whether the id is free, depends on the other profiles.',
  'merged-completeness': 'A file with "extends" is checked for completeness only after it is merged with the profile it builds on.',
  'merged-cross-member': 'A rule between two members, one written in the file and one inherited, sees only the file in the schema.',
  'wait-code-list': 'That the wait codes of a channel starting point use the letters of waitLetters compares two members of the file.',
} as const;
type ValidatorOnly = keyof typeof VALIDATOR_ONLY;

/** One broken file: the code refuses it; the schema refuses it too unless `vo` names the rule. */
interface BrokenCase {
  name: string;
  base: () => Json;
  patch: (p: Json) => void;
  vo?: ValidatorOnly;
}

const mill = (): Json => completeFrom('fanuc-gcode');
const lathe = (): Json => completeFrom('fanuc-lathe');
const klartext = (): Json => completeFrom('heidenhain-klartext');
const child = (): Json => ({ id: 'shop-child', name: 'Shop lathe', shortName: 'SHOP', version: 1, extends: 'fanuc-lathe' });

const obj = (p: Json, path: string): Json => path.split('.').reduce((at: Json, key) => at[key] as Json, p);
const syntaxOf = (p: Json): Json => obj(p, 'syntax');
const decl = (p: Json): Json => obj(p, 'machineParams');
const variants = (p: Json): Json[] => decl(p).variants as Json[];
const choicesOf = (p: Json, i = 0): Json[] => variants(p)[i].choices as Json[];
const numberInput = (p: Json): Json => obj(p, 'machineParams.numberInput');
const presets = (p: Json): Json[] => numberInput(p).presets as Json[];
const many = (n: number, make: (i: number) => unknown): unknown[] => Array.from({ length: n }, (_, i) => make(i));

const BROKEN: BrokenCase[] = [
  // The root
  { name: 'not an object', base: mill, patch: (p) => Object.keys(p).forEach((k) => delete p[k]) },
  { name: 'no id', base: mill, patch: (p) => delete p.id },
  { name: 'an id with capitals', base: mill, patch: (p) => (p.id = 'Shop Mill') },
  { name: 'a name of 81 characters', base: mill, patch: (p) => (p.name = 'x'.repeat(MAX_NAME_LENGTH + 1)) },
  { name: 'an empty name', base: mill, patch: (p) => (p.name = '') },
  { name: 'a short name of 17 characters', base: mill, patch: (p) => (p.shortName = 'x'.repeat(MAX_SHORT_NAME_LENGTH + 1)) },
  { name: 'version 0', base: mill, patch: (p) => (p.version = 0) },
  { name: 'version 1.5', base: mill, patch: (p) => (p.version = 1.5) },
  { name: 'an unknown grammar', base: mill, patch: (p) => (p.grammar = 'conversational') },
  { name: 'a code list id with a blank', base: mill, patch: (p) => (p.codes = 'fanuc mill') },
  { name: 'a code list that does not exist', base: mill, patch: (p) => (p.codes = 'fanuc-mill'), vo: 'code-db-exists' },
  { name: 'a machine type of "router"', base: mill, patch: (p) => (p.machineType = 'router') },
  { name: 'no codes in a complete file', base: mill, patch: (p) => delete p.codes },
  // files
  { name: 'no files section', base: mill, patch: (p) => delete p.files },
  { name: 'no extensions', base: mill, patch: (p) => (obj(p, 'files').extensions = []) },
  { name: 'an extension with a dot', base: mill, patch: (p) => (obj(p, 'files').extensions = ['.nc']) },
  { name: 'json as an extension', base: mill, patch: (p) => (obj(p, 'files').extensions = ['nc', 'json']) },
  { name: 'a default extension not listed', base: mill, patch: (p) => (obj(p, 'files').defaultExtension = 'mpf'), vo: 'default-extension-listed' },
  { name: 'py as the default extension', base: mill, patch: (p) => (obj(p, 'files').defaultExtension = 'py') },
  { name: 'a file type name of 81 characters', base: mill, patch: (p) => (obj(p, 'files').filterName = 'x'.repeat(81)) },
  { name: 'an encoding other than keep', base: mill, patch: (p) => (obj(p, 'files').encoding = 'utf-8') },
  { name: 'a line ending other than keep', base: mill, patch: (p) => (obj(p, 'files').lineEnding = 'lf') },
  { name: 'a new-file line ending "unix"', base: mill, patch: (p) => (obj(p, 'files').newFileLineEnding = 'unix') },
  { name: 'no new-file line ending', base: mill, patch: (p) => delete obj(p, 'files').newFileLineEnding },
  // detect
  { name: 'no detect section', base: mill, patch: (p) => delete p.detect },
  { name: 'a detect extension with capitals', base: mill, patch: (p) => (obj(p, 'detect').extensions = { NC: 1 }) },
  { name: 'json as a detect extension', base: mill, patch: (p) => (obj(p, 'detect').extensions = { json: 1 }) },
  { name: 'a negative extension weight', base: mill, patch: (p) => (obj(p, 'detect').extensions = { nc: -1 }) },
  { name: 'detect content that is not a list', base: mill, patch: (p) => (obj(p, 'detect').content = {}) },
  { name: 'a content rule without a weight', base: mill, patch: (p) => (obj(p, 'detect').content = [{ pattern: 'N\\d+' }]) },
  { name: '201 content rules', base: mill, patch: (p) => (obj(p, 'detect').content = many(MAX_PATTERN_LIST + 1, (i) => ({ pattern: `G${i}`, weight: 1 }))) },
  { name: 'a folder of 261 characters', base: mill, patch: (p) => (obj(p, 'detect').folders = ['x'.repeat(MAX_FOLDER_LENGTH + 1)]) },
  { name: 'a priority that is a word', base: mill, patch: (p) => (obj(p, 'detect').priority = 'high') },
  { name: 'vetoes that are one text', base: mill, patch: (p) => (obj(p, 'detect').vetoes = 'DIAMON') },
  // syntax
  { name: 'no syntax section', base: mill, patch: (p) => delete p.syntax },
  { name: 'caseSensitive "yes"', base: mill, patch: (p) => (syntaxOf(p).caseSensitive = 'yes') },
  { name: 'no comments', base: mill, patch: (p) => (syntaxOf(p).comments = []) },
  { name: 'a comment without its end', base: mill, patch: (p) => (syntaxOf(p).comments = [{ start: '(' }]) },
  { name: 'a comment with an empty start', base: mill, patch: (p) => (syntaxOf(p).comments = [{ start: '', end: null }]) },
  { name: 'a pattern that does not compile', base: mill, patch: (p) => (syntaxOf(p).sectionHeading = '(unclosed'), vo: 'pattern-compiles' },
  { name: 'a lookbehind of variable width', base: mill, patch: (p) => (syntaxOf(p).sectionHeading = '(?<=A+)B'), vo: 'pattern-subset' },
  { name: 'a repeated group that repeats inside', base: mill, patch: (p) => (syntaxOf(p).sectionHeading = '^\\((\\w+\\s?)*\\)'), vo: 'pattern-shape' },
  { name: 'a pattern of 1001 characters', base: mill, patch: (p) => (syntaxOf(p).sectionHeading = 'x'.repeat(MAX_PATTERN_LENGTH + 1)) },
  { name: 'a continuation start without ^', base: mill, patch: (p) => (syntaxOf(p).continuationStart = '\\$ ') },
  { name: 'a continuation start anchored in its first alternative only', base: mill, patch: (p) => (syntaxOf(p).continuationStart = '^\\$ |\\$\\t'), vo: 'pattern-anchored' },
  { name: 'a continuation start that needs no mark', base: mill, patch: (p) => (syntaxOf(p).continuationStart = '^\\s*'), vo: 'pattern-plain-block' },
  { name: 'a variable pattern that matches nothing', base: mill, patch: (p) => (syntaxOf(p).variables = 'R?\\d*'), vo: 'pattern-empty-match' },
  { name: 'a block skip position "middle"', base: mill, patch: (p) => (obj(p, 'syntax.blockSkip').position = 'middle') },
  { name: 'a plain skip level "10"', base: mill, patch: (p) => (obj(p, 'syntax.blockSkip').plainLevel = '10') },
  { name: 'a block skip without marks', base: mill, patch: (p) => delete obj(p, 'syntax.blockSkip').chars },
  { name: 'a block number kind "letter"', base: mill, patch: (p) => (obj(p, 'syntax.blockNumber').mode = 'letter') },
  { name: 'a prefix block number without its letter', base: mill, patch: (p) => delete obj(p, 'syntax.blockNumber').prefix },
  { name: 'a block number letter "1"', base: mill, patch: (p) => (obj(p, 'syntax.blockNumber').prefix = '1') },
  { name: 'no "required" on block numbers', base: mill, patch: (p) => delete obj(p, 'syntax.blockNumber').mandatory },
  { name: 'a main block mark that is a letter', base: mill, patch: (p) => (obj(p, 'syntax.blockNumber').mainPrefix = 'A') },
  { name: 'a main block mark that opens a comment', base: mill, patch: (p) => (obj(p, 'syntax.blockNumber').mainPrefix = '(') },
  {
    name: 'a main block mark that is the continuation mark',
    base: mill,
    patch: (p) => {
      syntaxOf(p).continuationMark = '~';
      obj(p, 'syntax.blockNumber').mainPrefix = '~';
    },
    vo: 'reserved-head-char',
  },
  { name: 'a label pattern without the group name', base: mill, patch: (p) => (syntaxOf(p).labels = '^[A-Z_]+:') },
  { name: 'an assignment pattern that is a number', base: mill, patch: (p) => (syntaxOf(p).assignment = 5) },
  { name: 'control addresses that match nothing', base: mill, patch: (p) => (syntaxOf(p).extendedAddresses = '(?:SB)?'), vo: 'pattern-empty-match' },
  { name: 'a first system variable number of 0', base: mill, patch: (p) => (syntaxOf(p).systemVariableNumbers = 0) },
  { name: 'incrementTravelsShift "yes"', base: mill, patch: (p) => (syntaxOf(p).incrementTravelsShift = 'yes') },
  { name: 'an empty cycleRAbsoluteWith', base: mill, patch: (p) => (syntaxOf(p).cycleRAbsoluteWith = []) },
  { name: 'a cycleRAbsoluteWith choice with capitals', base: mill, patch: (p) => (syntaxOf(p).cycleRAbsoluteWith = ['Series-15']) },
  { name: 'extra axis names as one text', base: mill, patch: (p) => (syntaxOf(p).extraAxisNames = 'AA') },
  { name: 'an extra axis name of one letter', base: mill, patch: (p) => (syntaxOf(p).extraAxisNames = ['A']) },
  { name: 'an extra axis name with a digit', base: mill, patch: (p) => (syntaxOf(p).extraAxisNames = ['AA1']) },
  { name: 'an extra axis name of 9 letters', base: mill, patch: (p) => (syntaxOf(p).extraAxisNames = ['ABCDEFGHI']) },
  { name: 'an extra axis name twice', base: mill, patch: (p) => (syntaxOf(p).extraAxisNames = ['AA', 'AA']) },
  { name: 'an extra axis name twice apart from case', base: mill, patch: (p) => (syntaxOf(p).extraAxisNames = ['AA', 'aa']), vo: 'unique-ignoring-case' },
  { name: '17 extra axis names', base: mill, patch: (p) => (syntaxOf(p).extraAxisNames = many(MAX_EXTRA_AXES + 1, (i) => `A${String.fromCharCode(65 + i)}`)) },
  { name: 'a program name pattern that matches nothing', base: mill, patch: (p) => (syntaxOf(p).programNames = '<?[A-Z]*>?'), vo: 'pattern-empty-match' },
  { name: 'a decimal separator ";"', base: mill, patch: (p) => (syntaxOf(p).decimalSeparator = ';') },
  { name: 'no decimal separator', base: mill, patch: (p) => delete syntaxOf(p).decimalSeparator },
  { name: 'a second decimal separator equal to the first', base: mill, patch: (p) => (syntaxOf(p).decimalSeparatorAlt = '.') },
  { name: 'an exponent mark of one letter', base: mill, patch: (p) => (syntaxOf(p).exponentMarker = 'E') },
  { name: 'an exponent mark with a digit', base: mill, patch: (p) => (syntaxOf(p).exponentMarker = 'E1') },
  { name: 'a symbol address of two characters', base: mill, patch: (p) => (syntaxOf(p).symbolAddresses = ['##']) },
  { name: 'a symbol address that is a digit', base: mill, patch: (p) => (syntaxOf(p).symbolAddresses = ['5']) },
  { name: 'a symbol address that is a sign', base: mill, patch: (p) => (syntaxOf(p).symbolAddresses = ['+']) },
  { name: 'a symbol address that is the skip mark', base: mill, patch: (p) => (syntaxOf(p).symbolAddresses = ['/']), vo: 'reserved-head-char' },
  { name: 'symbol addresses as one text', base: mill, patch: (p) => (syntaxOf(p).symbolAddresses = '#') },
  { name: 'Remove Spaces "never"', base: mill, patch: (p) => (syntaxOf(p).removeSpaces = 'never') },
  { name: 'no decimal point setting', base: mill, patch: (p) => delete syntaxOf(p).decimalPointSignificant },
  { name: 'blanks between words "no"', base: mill, patch: (p) => (syntaxOf(p).wordSeparatorRequired = 'no') },
  { name: 'an incremental mark "#"', base: mill, patch: (p) => (syntaxOf(p).incrementalPrefix = '#') },
  { name: 'an empty keyword', base: mill, patch: (p) => (syntaxOf(p).keywords = ['GOTO', '']) },
  { name: 'a longest block of 0', base: mill, patch: (p) => (syntaxOf(p).maxLineLength = 0) },
  { name: 'most digits 1.5', base: mill, patch: (p) => (syntaxOf(p).maxWordDigits = 1.5) },
  { name: 'most M codes -1', base: mill, patch: (p) => (syntaxOf(p).maxMCodes = -1) },
  { name: 'an empty kept-text list', base: mill, patch: (p) => (syntaxOf(p).freeText = []) },
  { name: 'kept text without the group text', base: mill, patch: (p) => (syntaxOf(p).freeText = ['CALL PGM (?<name>\\S+)']) },
  { name: 'kept text that matches nothing', base: mill, patch: (p) => (syntaxOf(p).freeText = ['(?<text>\\S*)']), vo: 'pattern-empty-match' },
  { name: 'a colon word that starts with a digit', base: mill, patch: (p) => (syntaxOf(p).colonWords = ['1VC']) },
  { name: 'call targets without a pattern', base: mill, patch: (p) => (syntaxOf(p).callTargets = { after: ['GOTO'] }) },
  { name: 'call targets without keywords', base: mill, patch: (p) => (syntaxOf(p).callTargets = { pattern: 'O\\d+' }) },
  { name: 'call targets behind a word that is no keyword', base: mill, patch: (p) => (syntaxOf(p).callTargets = { after: ['CALL'], pattern: 'O\\d+' }), vo: 'keyword-of-profile' },
  { name: 'an empty jump keyword list', base: mill, patch: (p) => (syntaxOf(p).labelAfter = []) },
  { name: 'a plain text run of 1', base: mill, patch: (p) => (syntaxOf(p).plainTextRun = 1) },
  { name: 'tapeMarker "no"', base: mill, patch: (p) => (syntaxOf(p).tapeMarker = 'no') },
  // addresses
  { name: 'no addresses section', base: mill, patch: (p) => delete p.addresses },
  { name: 'no axes', base: mill, patch: (p) => (obj(p, 'addresses').axes = []) },
  { name: 'a tool address "1T"', base: mill, patch: (p) => (obj(p, 'addresses').tool = '1T') },
  { name: 'an arc centre mode "relative"', base: mill, patch: (p) => (obj(p, 'addresses').arcCenterMode = 'relative') },
  { name: 'an incremental address that moves no axis', base: mill, patch: (p) => (obj(p, 'addresses').incremental = { U: 'Q' }), vo: 'incremental-names-an-axis' },
  { name: 'an incremental address "1"', base: mill, patch: (p) => (obj(p, 'addresses').incremental = { 1: 'X' }) },
  { name: 'diameter addresses as one text', base: mill, patch: (p) => (obj(p, 'addresses').diameter = 'X') },
  { name: 'a feed unit "per-hour"', base: mill, patch: (p) => (obj(p, 'addresses').feedUnitWords = { FU: 'per-hour' }) },
  { name: 'an arc direction word without its sign', base: mill, patch: (p) => (obj(p, 'addresses').arcDirectionWords = { DR: 'cw' }) },
  { name: 'two arc direction words for one direction', base: mill, patch: (p) => (obj(p, 'addresses').arcDirectionWords = { 'DR+': 'cw', 'DR-': 'cw' }) },
  { name: 'an arc direction word twice apart from case', base: mill, patch: (p) => (obj(p, 'addresses').arcDirectionWords = { 'DR+': 'ccw', 'dr+': 'cw' }), vo: 'unique-ignoring-case' },
  { name: 'a main spindle "S-1"', base: mill, patch: (p) => (obj(p, 'addresses').mainSpindle = 'S-1') },
  // toolCall, program, outline
  { name: 'no tool change', base: mill, patch: (p) => delete p.toolCall },
  { name: 'a tool pattern without the group tool', base: mill, patch: (p) => (obj(p, 'toolCall').tool = 'T(\\d+)') },
  { name: 'a tool number place "next"', base: mill, patch: (p) => (obj(p, 'toolCall').toolFrom = 'next') },
  { name: 'no tool number place', base: mill, patch: (p) => delete obj(p, 'toolCall').toolFrom },
  { name: 'a tool change trigger that does not compile', base: mill, patch: (p) => (obj(p, 'toolCall').trigger = 'M6('), vo: 'pattern-compiles' },
  { name: 'program starts as one text', base: mill, patch: (p) => (obj(p, 'program').start = '^O') },
  { name: 'an empty program end pattern', base: mill, patch: (p) => (obj(p, 'program').end = ['']) },
  { name: 'endRecord "yes"', base: mill, patch: (p) => (obj(p, 'program').endRecord = 'yes') },
  { name: 'outline as an object', base: mill, patch: (p) => (p.outline = {}) },
  { name: 'an outline row of kind channel', base: mill, patch: (p) => (p.outline = [{ kind: 'channel', pattern: 'G13' }]) },
  { name: 'an outline row of kind headline', base: mill, patch: (p) => (p.outline = [{ kind: 'headline', pattern: 'x' }]) },
  { name: 'an outline row without a pattern', base: mill, patch: (p) => (p.outline = [{ kind: 'tool' }]) },
  {
    name: 'more than 1000 patterns in the profile',
    base: mill,
    patch: (p) => {
      const list = (prefix: string): unknown[] => many(MAX_PATTERN_LIST, (i) => `${prefix}${i}`);
      obj(p, 'detect').content = list('A').map((pattern) => ({ pattern, weight: 1 }));
      obj(p, 'detect').vetoes = list('B');
      obj(p, 'program').start = list('C');
      obj(p, 'program').end = list('D');
      p.outline = list('E').map((pattern) => ({ kind: 'comment', pattern }));
      obj(p, 'compare').keepComments = list('F');
    },
    vo: 'pattern-count',
  },
  // numbering
  { name: 'no numbering', base: mill, patch: (p) => delete p.numbering },
  { name: 'a step of 0', base: mill, patch: (p) => (obj(p, 'numbering').step = 0) },
  { name: 'a start of -1', base: mill, patch: (p) => (obj(p, 'numbering').start = -1) },
  { name: 'no start', base: mill, patch: (p) => delete obj(p, 'numbering').start },
  { name: '13 digits', base: mill, patch: (p) => (obj(p, 'numbering').digits = 13) },
  { name: 'an overflow "error"', base: mill, patch: (p) => (obj(p, 'numbering').onOverflow = 'error') },
  { name: '17 blanks after the number', base: mill, patch: (p) => (obj(p, 'numbering').spacesAfter = 17) },
  { name: 'a skip text with a blank', base: mill, patch: (p) => (obj(p, 'numbering').skipContaining = ['(MSG X']) },
  { name: 'a start text of 201 characters', base: mill, patch: (p) => (obj(p, 'numbering').startTrigger = 'x'.repeat(201)) },
  { name: 'a start text that is a number', base: mill, patch: (p) => (obj(p, 'numbering').startTrigger = 5) },
  { name: 'a code column of 121', base: mill, patch: (p) => (obj(p, 'numbering').alignColumn = 121) },
  { name: 'every 0th block', base: mill, patch: (p) => (obj(p, 'numbering').everyNth = 0) },
  { name: 'skip the first 1.5 lines', base: mill, patch: (p) => (obj(p, 'numbering').skipFirst = 1.5) },
  { name: 'a reference without words', base: mill, patch: (p) => (obj(p, 'numbering').references = [{ trigger: 'M99' }]) },
  { name: 'a reference into the "parent" program', base: mill, patch: (p) => (obj(p, 'numbering').references = [{ trigger: 'M99', addresses: ['P'], program: 'parent' }]) },
  { name: 'a call of 17 digits', base: mill, patch: (p) => (obj(p, 'numbering').calls = [{ trigger: 'M98', address: 'P', maxDigits: 17 }]) },
  { name: 'a call without its word', base: mill, patch: (p) => (obj(p, 'numbering').calls = [{ trigger: 'M98' }]) },
  // numberFormat, modal
  { name: '10 decimals', base: klartext, patch: (p) => (obj(p, 'numberFormat').decimals = 10) },
  { name: 'no decimals', base: klartext, patch: (p) => delete obj(p, 'numberFormat').decimals },
  { name: 'a plus sign "plus"', base: klartext, patch: (p) => (obj(p, 'numberFormat').plusSign = 'plus') },
  { name: 'no keepPoint', base: klartext, patch: (p) => delete obj(p, 'numberFormat').keepPoint },
  { name: 'a power-on group with a blank name', base: mill, patch: (p) => (obj(p, 'modal.initial')[' '] = 'G0') },
  { name: 'a power-on code G00', base: mill, patch: (p) => (obj(p, 'modal.initial').motion = 'G00'), vo: 'canonical-code' },
  { name: 'a power-on code that is a number', base: mill, patch: (p) => (obj(p, 'modal.initial').motion = 0) },
  { name: 'units written into the profile', base: mill, patch: (p) => (obj(p, 'modal').units = 'mm') },
  { name: 'diameter written into the profile', base: lathe, patch: (p) => (obj(p, 'modal').diameter = 'on') },
  { name: 'sources written into the profile', base: mill, patch: (p) => (obj(p, 'modal').sources = {}) },
  // machineParams
  { name: 'machine units "cm"', base: mill, patch: (p) => (decl(p).units = 'cm') },
  { name: 'a modal group the codes do not know', base: mill, patch: (p) => (decl(p).modalGroups = ['feedmode', 'feedMode']), vo: 'modal-group-exists' },
  { name: 'a setting without a default', base: lathe, patch: (p) => delete variants(p)[0].default },
  { name: 'a setting name with a blank', base: lathe, patch: (p) => (variants(p)[0].id = 'gcode system') },
  { name: 'a setting name twice', base: lathe, patch: (p) => (variants(p)[1].id = variants(p)[0].id), vo: 'unique-by-member' },
  { name: 'a setting default that is no choice', base: lathe, patch: (p) => (variants(p)[0].default = 'C'), vo: 'default-is-a-choice' },
  { name: 'a setting without choices', base: lathe, patch: (p) => (variants(p)[0].choices = []) },
  { name: 'a choice value twice', base: lathe, patch: (p) => (choicesOf(p)[1].value = choicesOf(p)[0].value), vo: 'unique-by-member' },
  { name: 'a choice code list that does not exist', base: lathe, patch: (p) => (choicesOf(p)[1].codes = 'fanuc-lathe-c'), vo: 'code-db-exists' },
  { name: 'an overlay that changes the syntax', base: lathe, patch: (p) => (choicesOf(p)[1].overlay = { syntax: {} }) },
  { name: 'an overlay tool number place "previous"', base: lathe, patch: (p) => (choicesOf(p)[1].overlay = { toolCall: { toolFrom: 'previous' } }) },
  { name: 'overlay diameter addresses as one text', base: lathe, patch: (p) => (choicesOf(p)[1].overlay = { addresses: { diameter: 'X' } }) },
  { name: 'an overlay step of 0', base: lathe, patch: (p) => (choicesOf(p)[1].overlay = { numbering: { step: 0 } }) },
  { name: 'an overlay power-on code G095', base: lathe, patch: (p) => (choicesOf(p)[1].overlay = { modal: { initial: { feedmode: 'G095' } } }), vo: 'canonical-code' },
  { name: 'a detection rule of a choice without a weight', base: lathe, patch: (p) => (choicesOf(p)[1].detect = [{ pattern: 'G92' }]) },
  { name: 'a default rule that names its own setting', base: lathe, patch: (p) => (obj(variants(p)[1], 'defaultBy').variant = variants(p)[1].id), vo: 'default-by-refers' },
  { name: 'a default rule with no values', base: lathe, patch: (p) => (obj(variants(p)[1], 'defaultBy').values = {}) },
  { name: 'a default rule that gives no choice', base: lathe, patch: (p) => (obj(variants(p)[1], 'defaultBy').values = { B: 'xy' }), vo: 'default-is-a-choice' },
  { name: 'a number input default that is no choice', base: mill, patch: (p) => (numberInput(p).default = 'is-z'), vo: 'default-is-a-choice' },
  { name: 'no number input choices', base: mill, patch: (p) => (numberInput(p).presets = []) },
  { name: 'a number input id with capitals', base: mill, patch: (p) => (presets(p)[0].id = 'IS-B') },
  { name: 'a number input id twice', base: lathe, patch: (p) => (presets(p)[2].id = presets(p)[1].id as string), vo: 'unique-by-member' },
  { name: 'digitCheck "no"', base: mill, patch: (p) => (presets(p)[0].digitCheck = 'no') },
  { name: 'a decimal point setting the default number input contradicts', base: lathe, patch: (p) => (syntaxOf(p).decimalPointSignificant = true), vo: 'decimal-point-vs-preset' },
  { name: 'a number reading "scaled"', base: mill, patch: (p) => (obj(presets(p)[0], 'value').mode = 'scaled') },
  // A profile's preset is stricter than a machine's own number input (the `allOf` overlay): an increment is 1 or a power of ten below it.
  { name: 'a preset length increment of 0.002', base: mill, patch: (p) => (obj(presets(p)[0], 'value').incrementMm = '0.002') },
  { name: 'a preset inch increment of 0.5', base: mill, patch: (p) => (obj(presets(p)[0], 'value').incrementInch = '0.5') },
  { name: 'a preset angle increment of 5', base: mill, patch: (p) => (obj(presets(p)[0], 'value').incrementDeg = '5') },
  { name: 'a preset dwell increment of 0.25', base: mill, patch: (p) => (obj(presets(p)[0], 'value').incrementSec = '0.25') },
  {
    name: 'a preset feed class increment of 0.002',
    base: mill,
    patch: (p) => (obj(presets(p)[0], 'value').classes = { feedPerMin: { mode: 'increment', increment: '0.002' } }),
  },
  { name: 'a feeds-without-a-point default that sets steps', base: mill, patch: (p) => (obj(numberInput(p), 'pointlessFeeds').default = 'per-rev'), vo: 'default-is-a-choice' },
  {
    name: 'a feeds-without-a-point step for dwell',
    base: mill,
    patch: (p) => ((obj(numberInput(p), 'pointlessFeeds').choices as Json[])[1].classes = { dwell: { increment: '0.001' } }),
  },
  {
    name: 'a feeds-without-a-point step with a reading',
    base: mill,
    patch: (p) => ((obj(numberInput(p), 'pointlessFeeds').choices as Json[])[1].classes = { feedPerRev: { increment: '0.001', mode: 'increment' } }),
  },
  {
    name: 'a feeds-without-a-point step of 0.002',
    base: mill,
    patch: (p) => ((obj(numberInput(p), 'pointlessFeeds').choices as Json[])[1].classes = { feedPerRev: { increment: '0.002' } }),
  },
  { name: 'a wait code letter in small letters', base: lathe, patch: (p) => (obj(decl(p), 'channels').waitLetters = ['m']) },
  { name: 'a channel starting point id twice', base: lathe, patch: (p) => ((obj(decl(p), 'channels').presets as Json[])[1].id = (obj(decl(p), 'channels').presets as Json[])[0].id), vo: 'unique-by-member' },
  { name: 'wait codes of a letter the control does not use', base: lathe, patch: (p) => (obj(decl(p), 'channels').waitLetters = ['P']), vo: 'wait-code-list' },
  { name: 'channel starting points without a list', base: lathe, patch: (p) => delete obj(decl(p), 'channels').presets },
  { name: 'a channel starting point without channels', base: lathe, patch: (p) => delete (obj(decl(p), 'channels').presets as Json[])[0].value },
  { name: 'extra axes offered as true', base: mill, patch: (p) => (decl(p).extraAxes = true) },
  { name: 'builder codes without letters', base: mill, patch: (p) => (decl(p).builderCodes = { example: 'G810' }) },
  { name: 'builder codes with an empty letter list', base: mill, patch: (p) => (decl(p).builderCodes = { letters: [] }) },
  { name: 'a builder code letter in small letters', base: mill, patch: (p) => (decl(p).builderCodes = { letters: ['g'] }) },
  // onLoad, toolList, compare, editing, colors
  { name: 'stripNul "yes"', base: mill, patch: (p) => (p.onLoad = { stripNul: 'yes' }) },
  { name: 'a tool description place "left"', base: mill, patch: (p) => (obj(p, 'toolList').description = 'left') },
  { name: 'no tool description place', base: mill, patch: (p) => delete obj(p, 'toolList').description },
  { name: 'a decoration filter that does not compile', base: mill, patch: (p) => (obj(p, 'toolList').commentFilter = '[-'), vo: 'pattern-compiles' },
  { name: 'ignoreCase "yes"', base: mill, patch: (p) => (obj(p, 'compare').ignoreCase = 'yes') },
  { name: 'comments the control reads as one text', base: mill, patch: (p) => (obj(p, 'compare').keepComments = '#') },
  { name: 'a cycle name pattern without the group name', base: mill, patch: (p) => (obj(p, 'compare').cycleNames = ['CYCL DEF \\d+ (\\S+)']) },
  { name: 'a tab width of 0', base: mill, patch: (p) => (p.editing = { tabWidth: 0 }) },
  { name: 'a tab width of 17', base: mill, patch: (p) => (p.editing = { tabWidth: MAX_TAB_WIDTH + 1 }) },
  { name: 'a tab width of 2.5', base: mill, patch: (p) => (p.editing = { tabWidth: 2.5 }) },
  { name: 'nine rulers', base: mill, patch: (p) => (p.editing = { rulers: many(MAX_RULERS + 1, (i) => i + 1) }) },
  { name: 'a ruler at column 0', base: mill, patch: (p) => (p.editing = { rulers: [0] }) },
  { name: 'a ruler at column 1001', base: mill, patch: (p) => (p.editing = { rulers: [MAX_RULER_COLUMN + 1] }) },
  { name: 'a ruler twice', base: mill, patch: (p) => (p.editing = { rulers: [80, 80] }) },
  { name: 'forceUppercase "yes"', base: mill, patch: (p) => (p.editing = { forceUppercase: 'yes' }) },
  { name: 'colours as one text', base: mill, patch: (p) => (p.colors = 'blue') },
  { name: 'colours of a theme "dim"', base: mill, patch: (p) => (p.colors = { dim: {} }) },
  { name: 'a colour of a role "speed"', base: mill, patch: (p) => (p.colors = { dark: { speed: '#ffaa00' } }) },
  { name: 'a colour written "orange"', base: mill, patch: (p) => (p.colors = { dark: { feed: 'orange' } }) },
  { name: 'a colour too pale for the dark theme', base: mill, patch: (p) => (p.colors = { dark: { feed: '#222222' } }), vo: 'contrast' },
  { name: 'a colour too pale for the light theme', base: mill, patch: (p) => (p.colors = { light: { feed: '#ffee00' } }), vo: 'contrast' },
  // A file with "extends"
  { name: 'a child without its own short name', base: child, patch: (p) => delete p.shortName },
  { name: 'a child of a profile that does not exist', base: child, patch: (p) => (p.extends = 'fanuc-mill'), vo: 'extends-resolves' },
  { name: 'a child with the id of a built-in', base: child, patch: (p) => (p.id = 'fanuc-gcode'), vo: 'extends-resolves' },
  { name: 'a child that builds on itself', base: child, patch: (p) => (p.extends = p.id), vo: 'extends-resolves' },
  { name: 'a child with a parent id with capitals', base: child, patch: (p) => (p.extends = 'Fanuc-Lathe') },
  { name: 'a child with units', base: child, patch: (p) => (p.modal = { units: 'inch' }) },
  { name: 'a child with a tab width of 17', base: child, patch: (p) => (p.editing = { tabWidth: 17 }) },
  { name: 'a child with half a number format', base: child, patch: (p) => (p.numberFormat = { decimals: 3 }), vo: 'merged-completeness' },
  { name: 'a child with a second decimal separator equal to the inherited one', base: child, patch: (p) => (p.syntax = { decimalSeparatorAlt: '.' }), vo: 'merged-cross-member' },
  { name: 'a child with a pale colour', base: child, patch: (p) => (p.colors = { dark: { comment: '#303030' } }), vo: 'contrast' },
  { name: 'a child with an overlay that changes the files', base: child, patch: (p) => (p.machineParams = { variants: [{ id: 'x', label: 'X', default: 'a', choices: [{ value: 'a', label: 'A', overlay: { files: {} } }] }] }) },
];

/** Files both accept, each at a limit or with a member a careless schema would refuse. */
const ACCEPTED: { name: string; base: () => Json; patch: (p: Json) => void }[] = [
  { name: 'as resolved', base: mill, patch: () => {} },
  { name: 'a name of 80 and a short name of 16 characters', base: mill, patch: (p) => Object.assign(p, { name: 'x'.repeat(80), shortName: 'x'.repeat(16) }) },
  { name: 'a member of a later version', base: mill, patch: (p) => (p.somethingLater = { deep: [1, 2] }) },
  { name: 'unknown members inside a section', base: mill, patch: (p) => Object.assign(syntaxOf(p), { somethingLater: true }) },
  { name: 'the $schema line', base: mill, patch: (p) => (p.$schema = SCHEMA.$id) },
  { name: 'tab widths 1 and 16, no rulers', base: mill, patch: (p) => (p.editing = { tabWidth: 16, rulers: [] }) },
  { name: 'rulers at 1 and 1000, eight of them', base: mill, patch: (p) => (p.editing = { tabWidth: 1, rulers: [1, 2, 3, 4, 5, 6, 7, 1000] }) },
  { name: 'empty colours', base: mill, patch: (p) => (p.colors = {}) },
  { name: 'colours of the light theme only, every role', base: mill, patch: (p) => (p.colors = { light: {} }) },
  { name: 'sixteen extra axis names', base: mill, patch: (p) => (syntaxOf(p).extraAxisNames = many(16, (i) => `QQ${String.fromCharCode(65 + i)}`)) },
  { name: 'an empty start text', base: mill, patch: (p) => (obj(p, 'numbering').startTrigger = '') },
  { name: 'a start text of 200 characters', base: mill, patch: (p) => (obj(p, 'numbering').startTrigger = 'x'.repeat(200)) },
  { name: 'a line comment', base: mill, patch: (p) => (syntaxOf(p).comments = [{ start: ';', end: null }]) },
  { name: 'decimals 0', base: klartext, patch: (p) => (obj(p, 'numberFormat').decimals = 0) },
  { name: '200 outline rows', base: mill, patch: (p) => (p.outline = many(200, (i) => ({ kind: 'comment', pattern: `X${i}` }))) },
  { name: 'empty program start and end lists', base: mill, patch: (p) => (p.program = { start: [], end: [] }) },
  { name: 'no content rules', base: mill, patch: (p) => (obj(p, 'detect').content = []) },
  { name: 'a tolerance of any kind', base: mill, patch: (p) => (obj(p, 'compare').tolerance = { old: 'value' }) },
  { name: 'empty machine settings', base: mill, patch: (p) => (p.machineParams = {}) },
  { name: 'an empty power-on state', base: mill, patch: (p) => (p.modal = { initial: {} }) },
  { name: 'one arc direction word', base: mill, patch: (p) => (obj(p, 'addresses').arcDirectionWords = { 'DR+': 'ccw' }) },
  { name: 'an overlay that changes only the step', base: lathe, patch: (p) => (choicesOf(p)[1].overlay = { numbering: { step: 10 } }) },
  { name: 'an overlay with members of a later version', base: lathe, patch: (p) => (choicesOf(p)[1].overlay = { toolCall: { later: 1 }, modal: { later: 2 } }) },
  { name: 'a feeds-without-a-point choice with empty steps', base: mill, patch: (p) => ((obj(numberInput(p), 'pointlessFeeds').choices as Json[])[0].classes = {}) },
  { name: 'a child that writes only its identity', base: child, patch: () => {} },
  { name: 'a child that switches its detection off', base: child, patch: (p) => (p.detect = { content: [] }) },
  { name: 'a child that changes one block number member', base: child, patch: (p) => (p.syntax = { blockNumber: { mode: 'prefix' } }) },
  { name: 'a child with half a numbering', base: child, patch: (p) => (p.numbering = { step: 5 }) },
  { name: 'a child with an extra axis offer', base: child, patch: (p) => (p.machineParams = { extraAxes: {}, builderCodes: { letters: ['G'] } }) },
];

// ---------------------------------------------------------------------------------------------
// Walking the schema
// ---------------------------------------------------------------------------------------------

/** The schema a `$ref` points at, or null for one into `machines.schema.json` (P4.39b's to cover). */
function deref(ref: string): SchemaNode | null {
  const local = /^#\/\$defs\/([A-Za-z]+)$/.exec(ref);
  if (local) return DEFS[local[1]] ?? null;
  if (ref.startsWith('machines.schema.json#/$defs/')) return null;
  throw new Error(`unexpected $ref ${ref}`);
}

/** `node` and every schema it applies along with it (`$ref`, `allOf`, `anyOf`, `oneOf`, `then`, `else`). */
function expand(node: SchemaNode, out: SchemaNode[] = []): SchemaNode[] {
  out.push(node);
  if (typeof node.$ref === 'string') {
    const target = deref(node.$ref);
    if (target) expand(target, out);
    else out.push({ 'x-shared': true });
  }
  for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
    if (Array.isArray(node[key])) for (const part of node[key] as SchemaNode[]) expand(part, out);
  }
  for (const key of ['then', 'else'] as const) if (isRecord(node[key])) expand(node[key] as SchemaNode, out);
  return out;
}

/** True when the schema says nothing about the inside of a value (`{}`, a shared definition). */
const opaque = (nodes: SchemaNode[]): boolean =>
  nodes.some((n) => n['x-shared'] === true) ||
  nodes.filter((n) => !(Object.keys(n).length === 1 && 'allOf' in n)).every((n) => !['type', 'properties', 'items', 'additionalProperties', 'patternProperties', 'enum', 'const', '$ref', 'allOf', 'anyOf'].some((k) => k in n));

/** The member paths of `value` (arrays as `[]`) that `node` does not describe (rule 5a). */
function undescribed(value: unknown, node: SchemaNode, path = ''): string[] {
  const nodes = expand(node);
  if (opaque(nodes)) return [];
  if (Array.isArray(value)) {
    const items = nodes.filter((n) => isRecord(n.items)).map((n) => n.items as SchemaNode);
    if (items.length === 0) return value.length > 0 ? [`${path}[]`] : [];
    return [...new Set(value.flatMap((entry) => items.flatMap((item) => undescribed(entry, item, `${path}[]`))))];
  }
  if (!isRecord(value)) return [];
  const out: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const at = path === '' ? key : `${path}.${key}`;
    const found: SchemaNode[] = [];
    for (const n of nodes) {
      if (isRecord(n.properties) && isRecord((n.properties as Json)[key])) found.push((n.properties as Json)[key] as SchemaNode);
      if (isRecord(n.patternProperties)) {
        for (const [re, sub] of Object.entries(n.patternProperties as Json)) if (new RegExp(re, 'u').test(key)) found.push(sub as SchemaNode);
      }
      if (isRecord(n.additionalProperties)) found.push(n.additionalProperties as SchemaNode);
    }
    // The union of every schema that applies to the member: `$defs/complete` adds constraints
    // (required members) to a section without describing all of its members again.
    if (found.length === 0) out.push(at);
    else out.push(...undescribed(child, { allOf: found }, at));
  }
  return [...new Set(out)];
}

/** Every schema object below `node`, with its JSON pointer, skipping `$defs.complete` and the `if`/`not` conditions when asked. */
function* schemaObjects(node: unknown, pointer = '#', skipConditions = false): Generator<[string, SchemaNode]> {
  if (!isRecord(node)) return;
  yield [pointer, node];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'enum' || key === 'const' || key === 'default' || key === 'examples' || key === 'x-gedit-order') continue;
    if (skipConditions && (key === 'if' || key === 'not')) continue;
    if (key === 'properties' || key === '$defs' || key === 'patternProperties') {
      for (const [name, sub] of Object.entries(value as Json)) {
        if (skipConditions && key === '$defs' && name === 'complete') continue;
        yield* schemaObjects(sub, `${pointer}/${key}/${name}`, skipConditions);
      }
    } else if (Array.isArray(value)) {
      for (const [i, sub] of value.entries()) yield* schemaObjects(sub, `${pointer}/${key}/${i}`, skipConditions);
    } else if (isRecord(value)) {
      yield* schemaObjects(value, `${pointer}/${key}`, skipConditions);
    }
  }
}

/** Every property schema (a member a file may write), as `[pointer, schema]`. */
function* propertySchemas(): Generator<[string, SchemaNode]> {
  for (const [pointer, node] of schemaObjects(SCHEMA, '#', true)) {
    if (/\/properties\/[^/]+$/.test(pointer)) yield [pointer, node];
  }
}

/** The schema of a member path (`syntax.blockNumber`, `machineParams.variants[]`), resolving refs. */
function at(path: string): SchemaNode {
  let nodes = expand(SCHEMA);
  for (const part of path === '' ? [] : path.split('.')) {
    const [name, ...brackets] = part.split('[]');
    const next = nodes.flatMap((n) => (isRecord(n.properties) && isRecord((n.properties as Json)[name]) ? [(n.properties as Json)[name] as SchemaNode] : []));
    if (next.length === 0) throw new Error(`the schema has no ${path} (at ${name})`);
    nodes = next.flatMap((n) => expand(n));
    for (let i = 0; i < brackets.length; i++) nodes = nodes.flatMap((n) => (isRecord(n.items) ? expand(n.items as SchemaNode) : []));
  }
  return { allOf: nodes };
}

/** The member names a schema path describes. */
function membersAt(path: string): string[] {
  const names = new Set<string>();
  for (const n of expand(at(path))) if (isRecord(n.properties)) for (const key of Object.keys(n.properties)) names.add(key);
  return [...names].sort();
}

// ---------------------------------------------------------------------------------------------
// The member lists (rule 5): a member added to a type without the schema fails `npm run check`
// ---------------------------------------------------------------------------------------------

/** The named members of `T`, without an index signature. */
type Known<T> = keyof { [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K] } & string;
/** `list` when it names every member of `T`; otherwise the type check names the missing ones. */
function members<T>(): <const L extends readonly Known<T>[]>(
  list: L & ([Exclude<Known<T>, L[number]>] extends [never] ? unknown : { missing: Exclude<Known<T>, L[number]> }),
) => readonly string[] {
  return (list) => [...(list as readonly string[])].sort();
}

type Modal = NonNullable<Profile['modal']>;
const MEMBER_LISTS: [string, readonly string[]][] = [
  ['', members<Profile>()(['id', 'name', 'shortName', 'version', 'extends', 'machineType', 'modal', 'machineParams', 'grammar', 'codes', 'files', 'detect', 'syntax', 'addresses', 'toolCall', 'program', 'outline', 'numbering', 'numberFormat', 'onLoad', 'toolList', 'compare', 'editing', 'colors'])],
  ['files', members<Profile['files']>()(['extensions', 'defaultExtension', 'filterName', 'encoding', 'lineEnding', 'newFileLineEnding'])],
  ['detect', members<Profile['detect']>()(['extensions', 'content', 'folders', 'priority', 'vetoes'])],
  ['syntax', members<Profile['syntax']>()([
    'caseSensitive', 'strings', 'comments', 'sectionHeading', 'continuation', 'continuationMark', 'continuationStart', 'blockSkip', 'blockNumber',
    'decimalSeparator', 'decimalPointSignificant', 'wordSeparatorRequired', 'incrementalPrefix', 'variables', 'keywords', 'maxLineLength',
    'maxWordDigits', 'maxMCodes', 'sequenceNames', 'assignment', 'labels', 'calls', 'systemVariables', 'systemVariableNumbers',
    'incrementTravelsShift', 'tcpTableCoordinates', 'cycleRAbsoluteWith', 'header', 'names', 'decimalSeparatorAlt', 'programNames',
    'assignmentIndex', 'extendedAddresses', 'exponentMarker', 'symbolAddresses', 'removeSpaces', 'freeText', 'colonWords', 'callTargets',
    'labelAfter', 'declareAfter', 'plainTextRun', 'tapeMarker', 'extraAxisNames',
  ])],
  ['syntax.blockSkip', members<NonNullable<Profile['syntax']['blockSkip']>>()(['chars', 'position', 'levels', 'plainLevel'])],
  ['syntax.blockNumber', members<Profile['syntax']['blockNumber']>()(['mode', 'prefix', 'altPrefixes', 'mandatory', 'mainPrefix'])],
  ['syntax.callTargets', members<NonNullable<Profile['syntax']['callTargets']>>()(['after', 'pattern'])],
  ['syntax.comments[]', members<Profile['syntax']['comments'][number]>()(['start', 'end'])],
  ['addresses', members<Profile['addresses']>()([
    'tool', 'feed', 'rapid', 'spindle', 'axes', 'arcCenter', 'arcCenterMode', 'incremental', 'diameter', 'angular', 'feedUnitWords',
    'speedLimitWords', 'offsetWords', 'mainSpindle', 'arcDirectionWords',
  ])],
  ['toolCall', members<Profile['toolCall']>()(['trigger', 'tool', 'toolFrom', 'ignore'])],
  ['program', members<Profile['program']>()(['start', 'end', 'endRecord'])],
  ['outline[]', members<Profile['outline'][number]>()(['kind', 'pattern'])],
  ['numbering', members<NumberingOptions>()([
    'mode', 'start', 'step', 'digits', 'max', 'onOverflow', 'spacesAfter', 'skipStartingWith', 'skipEmpty', 'restartAtProgramStart',
    'onlyNumbered', 'fitToMax', 'alignColumn', 'everyNth', 'skipContaining', 'skipFirst', 'skipLast', 'startTrigger', 'startAfterTrigger',
    'references', 'calls',
  ])],
  ['numbering.references[]', members<ReferenceRule>()(['trigger', 'addresses', 'rewrite', 'program'])],
  ['numbering.calls[]', members<CallRule>()(['trigger', 'address', 'maxDigits', 'repeatAddress', 'localAddress', 'interrupt'])],
  ['numberFormat', members<NumberFormatOptions>()(['decimals', 'trailingZeros', 'keepPoint', 'plusSign'])],
  // `units`, `diameter` and `sources` are the machine's: the schema refuses them (rule 1).
  ['modal', members<Omit<Modal, 'units' | 'diameter' | 'sources'>>()(['initial'])],
  ['onLoad', members<NonNullable<Profile['onLoad']>>()(['stripNul'])],
  ['toolList', members<NonNullable<Profile['toolList']>>()(['description', 'commentFilter', 'dropLeadingZeros', 'collapseOffsetDigits'])],
  ['compare', members<ProfileCompare>()([...COMPARE_OPTION_KEYS, 'keepComments', 'cycleNames', 'tolerance'])],
  ['editing', members<ProfileEditing>()(['forceUppercase', 'preventLineJoin', 'autoSpace', 'autoNumber', 'tabWidth', 'rulers'])],
  ['colors', members<ProfileColors>()(['dark', 'light'])],
  ['machineParams', members<MachineParamsDecl>()(['numberInput', 'units', 'diameter', 'modalGroups', 'variants', 'channels', 'extraAxes', 'builderCodes'])],
  ['machineParams.numberInput', members<NonNullable<MachineParamsDecl['numberInput']>>()(['default', 'presets', 'pointlessFeeds'])],
  ['machineParams.numberInput.presets[]', members<NumberInputPreset>()(['id', 'label', 'value', 'source', 'verify', 'digitCheck'])],
  ['machineParams.numberInput.pointlessFeeds', members<PointlessFeedsDecl>()(['default', 'choices', 'source', 'verify'])],
  ['machineParams.numberInput.pointlessFeeds.choices[]', members<PointlessFeedChoice>()(['value', 'label', 'classes'])],
  ['machineParams.variants[]', members<VariantDecl>()(['id', 'label', 'default', 'defaultBy', 'choices'])],
  ['machineParams.variants[].defaultBy', members<NonNullable<VariantDecl['defaultBy']>>()(['variant', 'values'])],
  ['machineParams.variants[].choices[]', members<VariantChoice>()(['value', 'label', 'codes', 'overlay', 'detect'])],
  ['machineParams.variants[].choices[].overlay', members<ProfileOverlay>()(['modal', 'toolCall', 'numbering', 'addresses'])],
  ['machineParams.channels', members<ChannelPresetsDecl>()(['waitLetters', 'presets'])],
  ['machineParams.channels.presets[]', members<ChannelPreset>()(['id', 'label', 'value', 'source', 'verify'])],
  ['machineParams.extraAxes', members<ExtraAxesDecl>()(['source', 'verify'])],
  ['machineParams.builderCodes', members<BuilderCodesDecl>()(['letters', 'example', 'source', 'verify'])],
];

/**
 * Members no built-in profile writes (rule 5b). Each is written by `every-member.json`, whose
 * every path the schema describes; the list keeps them from silently leaving the fixture.
 */
const NOT_IN_A_BUILTIN = [
  'machineParams.variants[].defaultBy',
  'toolCall.toolFrom',
  'syntax.incrementTravelsShift',
  'syntax.tcpTableCoordinates',
  'syntax.cycleRAbsoluteWith',
  'editing.autoSpace',
  'editing.autoNumber',
  'editing.tabWidth',
  'editing.rulers',
  'numbering.fitToMax',
  'numbering.alignColumn',
  'numbering.everyNth',
  'numbering.skipContaining',
  'numbering.skipFirst',
  'numbering.skipLast',
  'numbering.startTrigger',
  'numbering.startAfterTrigger',
  'numbering.references[].program',
  'numbering.calls[].localAddress',
  'numbering.calls[].interrupt',
  'colors.dark',
  'colors.light',
  'syntax.extraAxisNames',
  'machineParams.extraAxes.source',
  'machineParams.extraAxes.verify',
  'machineParams.builderCodes.letters',
  'machineParams.builderCodes.example',
  'machineParams.variants[].choices[].overlay.numbering',
  'compare.tolerance',
] as const;

/** The value at a member path of `file` (`[]`: the first entry that has the rest). */
function valueAt(file: unknown, path: string): unknown[] {
  let values: unknown[] = [file];
  for (const part of path.split('.')) {
    const [name, ...brackets] = part.split('[]');
    values = values.flatMap((v) => (isRecord(v) && v[name] !== undefined ? [v[name]] : []));
    for (let i = 0; i < brackets.length; i++) values = values.flatMap((v) => (Array.isArray(v) ? v : []));
  }
  return values;
}

const EVERY_MEMBER = readJson(join(P4H_PROFILES, 'valid', 'every-member.json')) as Json;

/** The fields the form shows as JSON only (§6.10 rule 7). */
const JSON_ONLY = ['compare.cycleNames', 'machineParams.channels', 'machineParams.variants', 'numbering.calls', 'numbering.references'];
const FIELD_KINDS: readonly ProfileFieldKind[] = ['text', 'pattern', 'integer', 'number', 'bool', 'choice', 'text-list', 'pattern-list', 'weights', 'rows', 'colors', 'json'];

// ---------------------------------------------------------------------------------------------

describe('schemas/profile.schema.json (P4.39a)', () => {
  it('is a draft 2020-12 schema with the id exported files point at', () => {
    expect(profileSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(profileSchema.$id).toBe('https://raw.githubusercontent.com/CNC-Master-xyz/gEdit/main/schemas/profile.schema.json');
  });

  it('takes a $schema member of any JSON type, and describes the extra axes as the control reads them (NC-1, CODE-10)', () => {
    const raw = BUILTIN_PROFILE_SOURCES[0].raw as Json;
    for (const odd of [5, null, ['x']]) expect(schemaProblems({ ...raw, $schema: odd }), JSON.stringify(odd)).toEqual([]);
    const text = JSON.stringify(profileSchema);
    expect(text).toContain('A Siemens control writes them with an equals sign (AA=90); some machines also take AA90.');
    expect(text).toContain('so list a name only if your machine reads it as an axis');
    expect(text).not.toContain('read with the value packed behind them');
  });

  it('compiles with the test validator (rule 4), every keyword in the allowed list (rule 3)', () => {
    expect(typeof validateBySchema).toBe('function');
    const used = new Set<string>();
    for (const [, node] of schemaObjects(SCHEMA)) for (const key of Object.keys(node)) used.add(key);
    expect([...used].filter((key) => !ALLOWED_KEYWORDS.has(key)).sort()).toEqual([]);
    // The skeleton's mark is gone.
    expect(used.has('x-gedit-stub')).toBe(false);
  });

  it('accepts every built-in profile file as written, and every built-in profile as resolved (rule 2)', () => {
    for (const source of BUILTIN_PROFILE_SOURCES) {
      const id = (source.raw as Json).id as string;
      expect(schemaProblems(source.raw), `${id} as written`).toEqual([]);
    }
    for (const entry of RESOLVED_BUILTINS) {
      const id = entry.profile.id as string;
      const checked = validateProfile(entry.profile, registryOptions(entry.profile, 'builtin'));
      expect(checked.ok ? [] : checked.errors, `${id}: the validator`).toEqual([]);
      const complete = clone(entry.profile);
      delete complete.extends;
      expect(schemaProblems(complete), `${id} as resolved, without extends`).toEqual([]);
    }
  });

  it('accepts every fixture profile the validator accepts, and refuses every one it refuses (rule 2)', () => {
    // The resolved goldens: complete profiles once `extends` is removed.
    const goldens = join(FIXTURES_DIR, 'resolved', 'profiles');
    for (const name of jsonFiles(goldens)) {
      const file = readJson(join(goldens, name)) as Json;
      expect(validateProfile(file, registryOptions(file, 'builtin')).ok, name).toBe(true);
      delete file.extends;
      expect(schemaProblems(file), name).toEqual([]);
    }
    // User profiles as a user writes them.
    for (const name of jsonFiles(join(P4H_PROFILES, 'valid'))) {
      const file = readJson(join(P4H_PROFILES, 'valid', name));
      expect(codeProblems(file), `${name}: the code`).toEqual([]);
      expect(schemaProblems(file), `${name}: the schema`).toEqual([]);
    }
  });

  it('agrees with validateProfile on each broken profile of tests/fixtures/p4h/profiles/broken/ (rule 2)', () => {
    const verdicts: Record<string, ValidatorOnly | 'both'> = {
      'machine-units.json': 'both',
      'no-short-name.json': 'both',
      'pale-feed.json': 'contrast',
      'tab-width.json': 'both',
      'unknown-parent.json': 'extends-resolves',
    };
    const dir = join(P4H_PROFILES, 'broken');
    expect(jsonFiles(dir)).toEqual(Object.keys(verdicts).sort());
    for (const name of jsonFiles(dir)) {
      const file = readJson(join(dir, name));
      expect(codeProblems(file).length, `${name}: the code refuses it`).toBeGreaterThan(0);
      if (verdicts[name] === 'both') expect(schemaProblems(file).length, `${name}: the schema refuses it`).toBeGreaterThan(0);
      else expect(schemaProblems(file), `${name}: validator-only (${verdicts[name]})`).toEqual([]);
    }
  });

  it('agrees with the validator on every broken case: refused by both, or a validator-only rule (rule 2)', () => {
    for (const c of BROKEN) {
      const file = c.base();
      c.patch(file);
      const raw = c.name === 'not an object' ? [] : file;
      expect(codeProblems(raw).length, `${c.name}: the code refuses it`).toBeGreaterThan(0);
      if (c.vo === undefined) expect(schemaProblems(raw).length, `${c.name}: the schema refuses it`).toBeGreaterThan(0);
      else expect(schemaProblems(raw), `${c.name}: validator-only (${c.vo}), so the schema accepts it`).toEqual([]);
    }
  });

  it('refuses nothing the validator accepts: every validator-only rule has its sentence and a case (rule 2)', () => {
    for (const c of ACCEPTED) {
      const file = c.base();
      c.patch(file);
      expect(codeProblems(file), `${c.name}: the code`).toEqual([]);
      expect(schemaProblems(file), `${c.name}: the schema`).toEqual([]);
    }
    const used = new Set(BROKEN.flatMap((c) => (c.vo ? [c.vo] : [])));
    used.add('contrast').add('extends-resolves'); // the broken files above
    for (const [id, why] of Object.entries(VALIDATOR_ONLY)) {
      expect(why.length, id).toBeGreaterThan(20);
      expect(used.has(id as ValidatorOnly), `${id} has a case`).toBe(true);
    }
    // The case names stay apart, so a failing one can be found.
    expect(new Set(BROKEN.map((c) => c.name)).size).toBe(BROKEN.length);
  });

  it('checks completeness only without extends, and the shape of every member with it (rule 1)', () => {
    const identity = child();
    expect(schemaProblems(identity)).toEqual([]);
    const { extends: _parent, ...alone } = identity;
    void _parent;
    expect(schemaProblems(alone).some((p) => p.includes("must have required property 'files'"))).toBe(true);
    expect(codeProblems(alone).length).toBeGreaterThan(0);
    // With extends the identity is still required, as the merge rule says.
    const { shortName: _short, ...nameless } = identity;
    void _short;
    expect(schemaProblems(nameless).length).toBeGreaterThan(0);
    // Completeness reaches into the sections: a complete file needs its block number letter...
    const noLetter = mill();
    delete obj(noLetter, 'syntax.blockNumber').prefix;
    expect(schemaProblems(noLetter).length).toBeGreaterThan(0);
    // ...while a child may write a block number kind and inherit the letter.
    expect(schemaProblems({ ...identity, syntax: { blockNumber: { mode: 'prefix' } } })).toEqual([]);
    // The shape is checked in a child too.
    expect(schemaProblems({ ...identity, syntax: { blockNumber: { mode: 'letter' } } }).length).toBeGreaterThan(0);
  });

  it("refuses modal.units, modal.diameter and modal.sources in a file (they are the machine's, rule 1)", () => {
    for (const member of ['units', 'diameter', 'sources'] as const) {
      const file = { ...child(), modal: { [member]: member === 'sources' ? {} : 'mm' } };
      expect(schemaProblems(file).length, member).toBeGreaterThan(0);
      expect(codeProblems(file).length, member).toBeGreaterThan(0);
    }
    expect(membersAt('modal')).toEqual(['initial']);
  });

  it('covers every member of Profile, ProfileEditing, ProfileColors and MachineParamsDecl (the member list, rule 5)', () => {
    for (const [path, list] of MEMBER_LISTS) {
      const described = path === '' ? membersAt('').filter((m) => m !== '$schema') : membersAt(path);
      expect(described, path || '(the root)').toEqual(list);
    }
    // Rule 5a: every member path of every built-in file and every fixture is described.
    const files: [string, unknown][] = [
      ...BUILTIN_PROFILE_SOURCES.map((s): [string, unknown] => [`${(s.raw as Json).id as string} as written`, s.raw]),
      ...RESOLVED_BUILTINS.map((r): [string, unknown] => [`${r.profile.id as string} as resolved`, r.profile]),
      ...jsonFiles(join(P4H_PROFILES, 'valid')).map((name): [string, unknown] => [name, readJson(join(P4H_PROFILES, 'valid', name))]),
    ];
    for (const [name, file] of files) expect(undescribed(file, SCHEMA), name).toEqual([]);
  });

  it('covers the manual-check members: defaultBy, toolFrom last-before, the three syntax notes (rule 5)', () => {
    for (const path of NOT_IN_A_BUILTIN) {
      expect(valueAt(EVERY_MEMBER, path).length, `every-member.json writes ${path}`).toBeGreaterThan(0);
    }
    expect(undescribed(EVERY_MEMBER, SCHEMA)).toEqual([]);
    expect(valueAt(EVERY_MEMBER, 'toolCall.toolFrom')).toEqual(['last-before']);
    // The variants of the manual check are data of the built-ins; the schema checks their shape only.
    const ids = RESOLVED_BUILTINS.flatMap((r) => valueAt(r.profile, 'machineParams.variants[].id'));
    for (const id of ['toolChange', 'toolOnChangeLine', 'counterSpindleY']) expect(ids, id).toContain(id);
    expect(JSON.stringify(at('machineParams.variants[].id'))).not.toContain('toolChange');
  });

  it('refers to machines.schema.json for numberInput and channelParams (rule 1)', () => {
    expect(at('machineParams.numberInput.presets[].value').allOf).toContainEqual(
      expect.objectContaining({ $ref: 'machines.schema.json#/$defs/numberInput' }),
    );
    expect(at('machineParams.channels.presets[].value').allOf).toContainEqual(
      expect.objectContaining({ $ref: 'machines.schema.json#/$defs/channelParams' }),
    );
    // No other reference leaves the file, and none dangles.
    for (const [pointer, node] of schemaObjects(SCHEMA)) {
      if (typeof node.$ref !== 'string') continue;
      if (node.$ref.startsWith('machines.schema.json')) {
        expect(SHARED_DEFS.map((d) => `machines.schema.json#/$defs/${d}`), pointer).toContain(node.$ref);
      } else {
        expect(deref(node.$ref), pointer).not.toBeNull();
      }
    }
    // Every built-in preset is held to the shared definitions.
    for (const entry of RESOLVED_BUILTINS) {
      const file = clone(entry.profile);
      delete file.extends;
      expect(schemaProblems(file), entry.profile.id as string).toEqual([]);
    }
  });

  it("gives every member a title and a description, the form's help (rule 3)", () => {
    const problems: string[] = [];
    for (const [pointer, node] of propertySchemas()) {
      if (typeof node.title !== 'string' || node.title.trim() === '') problems.push(`${pointer}: no title`);
      if (typeof node.description !== 'string' || node.description.trim() === '') problems.push(`${pointer}: no description`);
      const text = `${String(node.title)} ${String(node.description)}`;
      // Plain words for an NC programmer: no plan ids, no work package numbers.
      if (/§|\bAD-\d|\bWP\d|\bQ4h-|\bP4\.\d|\bprelude\b|\bmilestone\b/i.test(text)) problems.push(`${pointer}: a plan reference in the help`);
      // One to three sentences.
      const sentences = String(node.description).split(/(?<=[.!?])\s+(?=[A-Z"(])/).length;
      if (sentences > 4) problems.push(`${pointer}: ${sentences} sentences`);
    }
    expect(problems).toEqual([]);
  });

  it('orders the form, names field kinds the form knows and marks the JSON-only fields (rule 3, §6.10 rule 7)', () => {
    const order = SCHEMA['x-gedit-order'] as string[];
    expect([...order].sort()).toEqual(membersAt('').filter((m) => m !== '$schema'));
    const jsonOnly: string[] = [];
    for (const [pointer, node] of schemaObjects(SCHEMA)) {
      const kindOf = node['x-gedit-kind'];
      if (kindOf === undefined) continue;
      expect(FIELD_KINDS, pointer).toContain(kindOf);
      if (kindOf === 'json') jsonOnly.push(pointer.replace(/^#\//, '').replace(/\$defs\/[A-Za-z]+\/|properties\//g, '').split('/').join('.'));
    }
    const named = new Set(jsonOnly.map((p) => p.split('.').pop()));
    for (const path of JSON_ONLY) expect(named.has(path.split('.').pop()), path).toBe(true);
    expect(jsonOnly).toHaveLength(JSON_ONLY.length);
  });

  it('closes an object only where the validator refuses an unknown member (rule 1)', () => {
    const closed: string[] = [];
    for (const [pointer, node] of schemaObjects(SCHEMA)) {
      if (node.additionalProperties === false || (isRecord(node.propertyNames) && Array.isArray(node.propertyNames.enum))) closed.push(pointer);
    }
    expect(closed.sort()).toEqual(
      [
        '#/$defs/overlay',
        '#/$defs/roleColors',
        '#/properties/colors',
        '#/$defs/machineParams/properties/numberInput/properties/pointlessFeeds/properties/choices/items/properties/classes',
        '#/$defs/machineParams/properties/numberInput/properties/pointlessFeeds/properties/choices/items/properties/classes/additionalProperties',
      ].sort(),
    );
  });

  it('keeps its limits, lists and patterns those of the validator', () => {
    const syntax = at('syntax');
    void syntax;
    const node = (path: string): SchemaNode[] => expand(at(path));
    const first = <T>(path: string, key: string): T => node(path).find((n) => key in n)?.[key] as T;
    expect(first<number>('name', 'maxLength')).toBe(MAX_NAME_LENGTH);
    expect(first<number>('shortName', 'maxLength')).toBe(MAX_SHORT_NAME_LENGTH);
    expect(first<number>('editing.tabWidth', 'maximum')).toBe(MAX_TAB_WIDTH);
    expect(first<number>('editing.rulers', 'maxItems')).toBe(MAX_RULERS);
    expect(first<number>('syntax.extraAxisNames', 'maxItems')).toBe(MAX_EXTRA_AXES);
    expect(new RegExp((expand(first<SchemaNode>('syntax.extraAxisNames', 'items')).find((n) => 'pattern' in n) as Json).pattern as string).source).toBe(EXTRA_AXIS_NAME.source);
    expect(DEFS.pattern.maxLength).toBe(MAX_PATTERN_LENGTH);
    expect(DEFS.patternList.maxItems).toBe(MAX_PATTERN_LIST);
    expect(JSON.stringify(at('editing.rulers'))).toContain(`"maximum":${MAX_RULER_COLUMN}`);
    expect(JSON.stringify(at('detect.folders'))).toContain(`"maxLength":${MAX_FOLDER_LENGTH}`);
    expect(DEFS.roleColors.propertyNames).toEqual({ enum: [...ROLES] });
    expect((DEFS.roleColors.additionalProperties as Json).pattern).toBe(HEX_COLOR.source);
    expect(JSON.stringify(at('files.extensions'))).toContain(JSON.stringify({ enum: [...NON_NC_EXTENSIONS] }));
  });
});
