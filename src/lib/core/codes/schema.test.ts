// The code database schema against the loader (Phase 4 plan §6.10 rules 1–5; the P4h prelude's §7
// row: a third schema, for the user code files). The loader drops what it does not understand and
// reports it; the schema agrees when it refuses a file exactly where the app reports at least one
// problem for it, or names the rule in VALIDATOR_ONLY.
//
// The code's verdict on a user file is what the app does with it (`stores/codes.ts`, `reload`):
// the file read on its own by `loadCodeDb` (and `loadTemplates`), then laid over the database it
// extends, member by member, and loaded again. `info` notices are no refusal. A built-in file is
// read the built-in way (`resolveCodeDbFiles` then `loadCodeDb`).

import { readdirSync, readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import codesSchema from '../../../../schemas/codes.schema.json';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { createCodeDbService } from '$lib/stores/codes';
import { loadCodeDb, type CodeDbProblem } from './load';
import { resolveCodeDbFiles } from './resolve';

type Json = Record<string, unknown>;
type Schema = Record<string, unknown>;

// ---------------------------------------------------------------------------
// The test validator and the schema walkers (rule 3, rule 4, rule 5); the twin of the helpers in
// `core/machines/schema.test.ts`.
// ---------------------------------------------------------------------------

const ALLOWED_KEYWORDS = new Set([
  '$schema', '$id', '$ref', '$defs', '$comment', 'title', 'description', 'type', 'properties', 'required',
  'additionalProperties', 'patternProperties', 'propertyNames', 'items', 'minItems', 'maxItems', 'uniqueItems',
  'enum', 'const', 'pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'minProperties',
  'maxProperties', 'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else', 'default', 'examples',
  'x-gedit-order', 'x-gedit-kind', 'x-gedit-advanced', 'x-gedit-stub',
]);

function testValidator(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, strictTypes: false });
  for (const keyword of ['x-gedit-order', 'x-gedit-kind', 'x-gedit-advanced', 'x-gedit-stub']) ajv.addKeyword(keyword);
  return ajv;
}

const SCHEMA_MAPS = ['properties', 'patternProperties', '$defs'];
const SCHEMA_ONE = ['items', 'additionalProperties', 'propertyNames', 'not', 'if', 'then', 'else'];
const SCHEMA_LIST = ['allOf', 'anyOf', 'oneOf'];

function subschemas(schema: unknown, out: Schema[] = []): Schema[] {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return out;
  const s = schema as Schema;
  out.push(s);
  for (const key of SCHEMA_MAPS) for (const sub of Object.values((s[key] as Json | undefined) ?? {})) subschemas(sub, out);
  for (const key of SCHEMA_ONE) subschemas(s[key], out);
  for (const key of SCHEMA_LIST) for (const sub of (s[key] as unknown[] | undefined) ?? []) subschemas(sub, out);
  return out;
}

function deref(root: Schema, ref: string): Schema {
  expect(ref.startsWith('#/'), ref).toBe(true);
  let at: unknown = root;
  for (const part of ref.slice(2).split('/')) at = (at as Json)[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  expect(at, ref).toBeTypeOf('object');
  return at as Schema;
}

function expand(root: Schema, s: Schema, out: Schema[] = []): Schema[] {
  if (out.includes(s)) return out;
  out.push(s);
  if (typeof s.$ref === 'string') expand(root, deref(root, s.$ref), out);
  for (const key of SCHEMA_LIST) for (const sub of (s[key] as Schema[] | undefined) ?? []) expand(root, sub, out);
  for (const key of ['then', 'else']) if (typeof s[key] === 'object' && s[key] !== null) expand(root, s[key] as Schema, out);
  return out;
}

function schemasAt(root: Schema, path: readonly string[]): Schema[] {
  let at = expand(root, root);
  for (const segment of path) {
    const next: Schema[] = [];
    for (const s of at) {
      if (segment === '[]') {
        if (typeof s.items === 'object' && s.items !== null) next.push(s.items as Schema);
        continue;
      }
      const props = s.properties as Record<string, Schema> | undefined;
      if (props !== undefined && Object.hasOwn(props, segment)) {
        next.push(props[segment]);
        continue;
      }
      let matched = false;
      for (const [pattern, sub] of Object.entries((s.patternProperties as Record<string, Schema> | undefined) ?? {})) {
        if (new RegExp(pattern, 'u').test(segment)) {
          next.push(sub);
          matched = true;
        }
      }
      if (!matched && typeof s.additionalProperties === 'object' && s.additionalProperties !== null) next.push(s.additionalProperties as Schema);
    }
    at = next.flatMap((s) => expand(root, s));
    if (at.length === 0) return [];
  }
  return at;
}

function memberPaths(value: unknown, prefix: string[] = [], out = new Map<string, string[]>()): Map<string, string[]> {
  if (Array.isArray(value)) {
    for (const item of value) memberPaths(item, [...prefix, '[]'], out);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      const path = [...prefix, key];
      out.set(path.join('.'), path);
      memberPaths(item, path, out);
    }
  }
  return out;
}

function schemaPaths(
  root: Schema,
  s: Schema,
  prefix: string[] = [],
  out = new Map<string, string[]>(),
  seen = new Map<string, Set<Schema>>(),
): Map<string, string[]> {
  const key = prefix.join('.');
  const visited = seen.get(key) ?? new Set<Schema>();
  if (visited.has(s) || prefix.length > 16) return out;
  visited.add(s);
  seen.set(key, visited);
  for (const x of expand(root, s)) {
    for (const [name, sub] of Object.entries((x.properties as Record<string, Schema> | undefined) ?? {})) {
      const path = [...prefix, name];
      out.set(path.join('.'), path);
      schemaPaths(root, sub, path, out, seen);
    }
    if (typeof x.items === 'object' && x.items !== null) schemaPaths(root, x.items as Schema, [...prefix, '[]'], out, seen);
    if (typeof x.additionalProperties === 'object' && x.additionalProperties !== null) {
      const path = [...prefix, '*'];
      out.set(path.join('.'), path);
      schemaPaths(root, x.additionalProperties as Schema, path, out, seen);
    }
  }
  return out;
}

const ajv = testValidator();
const validate = ajv.compile(codesSchema);
const ROOT = codesSchema as unknown as Schema;

function schemaAccepts(value: unknown): boolean {
  return validate(value) === true;
}

function schemaErrors(value: unknown): string[] {
  validate(value);
  return (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
}

// ---------------------------------------------------------------------------
// The code's verdict
// ---------------------------------------------------------------------------

/** What the app reports for one user code file named `<name>.json` (errors only). */
function userFileProblems(name: string, raw: unknown): string[] {
  // Only the database the test files lay themselves over: resolving every built-in for each of
  // the broken cases would take most of a minute, and the others do not change the verdict.
  const builtins = { fanuc: BUILTIN_CODE_DB_JSON.fanuc };
  const svc = createCodeDbService({
    dialectOf: (id) => id,
    source: (dialect) => (Object.hasOwn(builtins, dialect) ? builtins[dialect as 'fanuc'] : undefined),
    sources: () => builtins,
    warn: () => {},
  });
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  return svc
    .reload([{ name: `${name}.json`, text }])
    .filter((p) => p.severity !== 'info')
    .map((p) => `${p.path}: ${p.message}`);
}

/** What the built-in reading reports for every built-in file (none, `load.test.ts` holds it). */
function builtinProblems(): string[] {
  const out: string[] = [];
  const resolved = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, p) => out.push(`${dialect} ${p.path}: ${p.message}`));
  for (const [dialect, file] of Object.entries(resolved)) {
    loadCodeDb(file, (p: CodeDbProblem) => out.push(`${dialect} ${p.path}: ${p.message}`));
  }
  return out;
}

// ---------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------

const FULL = JSON.parse(readFileSync('tests/fixtures/p4h/codes/shop-mill.json', 'utf8')) as Json;
const RESOLVED_DIR = 'tests/fixtures/resolved/codes';
const RESOLVED = readdirSync(RESOLVED_DIR)
  .filter((name) => name.endsWith('.json'))
  .map((name) => ({ name, value: JSON.parse(readFileSync(`${RESOLVED_DIR}/${name}`, 'utf8')) as unknown }));

/** The rules JSON Schema cannot say, each with why (rule 2). */
const VALIDATOR_ONLY: Record<string, string> = {
  'dialect-is-file-name': 'the database id has to be the file name, and a schema sees the file, not its name',
  'code-db-exists': 'whether the extended database exists, and whether the file name is a built-in one, is known only to the app',
  'entry-in-parent': 'an entry without a label needs the code in the database below; a schema sees only this file',
  'alias-unique': 'a code or an alias given twice is found after leading zeros and case are taken off',
  'unique-ignoring-case': 'an address letter given twice in other cases (x and X) is the same address',
  'two-block-agreement': 'one address per block, and the same reading in both blocks, compares items of a list with each other',
  'twin-pair': 'a twin names another word of the same code that names it back, one a level and one a distance',
  'expand-rules': 'the steps of an expansion refer to the roles of the parameters (a level needs its role, one parameter per role, a step that reaches the depth)',
  'dwell-form': 'the words of a dwell are words of the code, and one of its lines holds {s}',
  'template-rules': 'a template is checked as a whole: its placeholders against its fields, a default against its bounds and choices, a formula that reads, ids given once',
};

interface Case {
  name: string;
  rule: 'schema' | keyof typeof VALIDATOR_ONLY;
  patch: (f: Json) => void;
}

const clone = <T>(value: T): T => structuredClone(value);
const entries = (f: Json): Json[] => f.codes as Json[];
const entry = (f: Json, code: string): Json => entries(f).find((e) => e.code === code) as Json;
const param = (f: Json, code: string, address: string): Json => ((entry(f, code).params as Json[]).find((p) => p.address === address)) as Json;
const sets = (f: Json): Json => entry(f, 'G907').sets as Json;
const drill = (f: Json): Json => entry(f, 'G904').expand as Json;
const steps = (f: Json): Json[] => drill(f).steps as Json[];
const choice = (f: Json): Json => entry(f, 'G905').expand as Json;
const tpl = (f: Json, i = 0): Json => (f.templates as Json[])[i];
const tparam = (f: Json, id: string): Json => ((tpl(f).params as Json[]).find((p) => p.id === id)) as Json;
const many = (n: number, make: (i: number) => unknown): unknown[] => Array.from({ length: n }, (_, i) => make(i));

const CASES: Case[] = [
  // The file
  { name: 'codes as text', rule: 'schema', patch: (f) => void (f.codes = 'none') },
  { name: 'no database id', rule: 'schema', patch: (f) => void delete f.dialect },
  { name: 'a database id other than the file name', rule: 'dialect-is-file-name', patch: (f) => void (f.dialect = 'shop-lathe') },
  { name: 'a version written as text', rule: 'schema', patch: (f) => void (f.version = '1') },
  { name: 'an empty extends', rule: 'schema', patch: (f) => void (f.extends = '') },
  { name: 'extends as a number', rule: 'schema', patch: (f) => void (f.extends = 5) },
  { name: 'extends of a database that does not exist', rule: 'code-db-exists', patch: (f) => void (f.extends = 'nope') },
  { name: 'a new database that extends nothing', rule: 'code-db-exists', patch: (f) => void delete f.extends },
  { name: 'remove written as text', rule: 'schema', patch: (f) => void (f.remove = 'G89') },
  { name: 'remove with a number', rule: 'schema', patch: (f) => void (f.remove = [89]) },
  { name: 'codes as an object', rule: 'schema', patch: (f) => void (f.codes = {}) },
  { name: 'addresses as a list', rule: 'schema', patch: (f) => void (f.addresses = []) },
  { name: 'an address without a name', rule: 'schema', patch: (f) => void ((f.addresses as Json)[' '] = { label: 'Blank' }) },
  { name: 'an address without a label', rule: 'schema', patch: (f) => void ((f.addresses as Json).Q = { description: 'Q word' }) },
  { name: 'an address description as a number', rule: 'schema', patch: (f) => void ((f.addresses as Json).Q = { label: 'Q', description: 5 }) },
  { name: 'an address given in both cases', rule: 'unique-ignoring-case', patch: (f) => void ((f.addresses as Json).x = { label: 'x axis' }) },
  { name: 'templates as an object', rule: 'schema', patch: (f) => void (f.templates = {}) },
  { name: '201 templates', rule: 'schema', patch: (f) => void (f.templates = many(201, (i) => ({ id: `t${i}`, label: 'T', group: 'G', body: 'G0' }))) },
  // An entry
  { name: 'an entry that is a number', rule: 'schema', patch: (f) => void (f.codes as unknown[]).push(5) },
  { name: 'an entry without a code', rule: 'schema', patch: (f) => void entries(f).push({ label: 'Nothing' }) },
  { name: 'a blank code', rule: 'schema', patch: (f) => void (entry(f, 'SPOS').code = ' ') },
  { name: 'a new code without a label', rule: 'entry-in-parent', patch: (f) => void entries(f).push({ code: 'G999' }) },
  { name: 'a blank label', rule: 'schema', patch: (f) => void (entry(f, 'SPOS').label = ' ') },
  { name: 'a group as a number', rule: 'schema', patch: (f) => void (entry(f, 'SPOS').group = 7) },
  { name: 'a description as a list', rule: 'schema', patch: (f) => void (entry(f, 'SPOS').description = ['a']) },
  { name: 'modal "yes"', rule: 'schema', patch: (f) => void (entry(f, 'SPOS').modal = 'yes') },
  { name: 'aliases as text', rule: 'schema', patch: (f) => void (entry(f, 'SPOS').aliases = 'SPOSA') },
  { name: 'an alias that is a number', rule: 'schema', patch: (f) => void (entry(f, 'SPOS').aliases = [5]) },
  { name: 'a code given twice', rule: 'alias-unique', patch: (f) => void entries(f).push({ code: 'G0906', label: 'Again' }) },
  { name: 'an alias that is another code', rule: 'alias-unique', patch: (f) => void (entry(f, 'SPOS').aliases = ['M300']) },
  { name: 'axis words "world"', rule: 'schema', patch: (f) => void (entry(f, 'M301').axisWords = 'world') },
  { name: 'data words with machine axis words', rule: 'schema', patch: (f) => void (entry(f, 'G902').axisWords = 'machine') },
  { name: 'a frame "opened"', rule: 'schema', patch: (f) => void (entry(f, 'M302').frame = 'opened') },
  { name: 'a frame with a blank in front', rule: 'schema', patch: (f) => void (entry(f, 'M302').frame = ' close') },
  { name: 'a frame without values that opens', rule: 'schema', patch: (f) => void (entry(f, 'M302').frameWithoutValues = 'open') },
  { name: 'zero words as text', rule: 'schema', patch: (f) => void (entry(f, 'G901').frameZeroWords = 'A') },
  { name: 'a zero word that is a number', rule: 'schema', patch: (f) => void (entry(f, 'G901').frameZeroWords = [5]) },
  { name: 'a sub-block that is no number', rule: 'schema', patch: (f) => void (entry(f, 'G901').frameEmptyCloses = 'one') },
  { name: 'a sub-block without zero words', rule: 'schema', patch: (f) => void delete entry(f, 'G901').frameZeroWords },
  { name: 'an identity that is no number', rule: 'schema', patch: (f) => void (entry(f, 'G901').frameIdentity = 'x') },
  { name: 'an identity with an empty list of zero words', rule: 'schema', patch: (f) => {
      entry(f, 'G901').frameZeroWords = [];
      delete entry(f, 'G901').frameEmptyCloses;
    },
  },
  { name: 'a flow "goto"', rule: 'schema', patch: (f) => void (entry(f, 'M300').flow = 'goto') },
  { name: 'conflicts as text', rule: 'schema', patch: (f) => void (entry(f, 'G901').conflicts = 'tcp') },
  { name: 'a conflict that does not exist', rule: 'schema', patch: (f) => void (entry(f, 'G901').conflicts = ['tcpx']) },
  { name: 'a conflict with a blank in front', rule: 'schema', patch: (f) => void (entry(f, 'G901').conflicts = [' tcp']) },
  { name: 'a code condition without a code', rule: 'schema', patch: (f) => void (entry(f, 'G901').conflicts = ['code:']) },
  { name: 'requires as text', rule: 'schema', patch: (f) => void (entry(f, 'G901').requires = 'A') },
  { name: 'an empty own word', rule: 'schema', patch: (f) => void (entry(f, 'G901').ownWords = ['']) },
  { name: 'a contour "begin"', rule: 'schema', patch: (f) => void (entry(f, 'M301').contour = 'begin') },
  { name: 'a pole "centre"', rule: 'schema', patch: (f) => void (entry(f, 'M301').pole = 'centre') },
  { name: 'a machine type "router"', rule: 'schema', patch: (f) => void (entry(f, 'M300').machineType = 'router') },
  { name: 'a review "done"', rule: 'schema', patch: (f) => void (entry(f, 'G76').review = 'done') },
  { name: 'three blocks', rule: 'schema', patch: (f) => void (entry(f, 'G903').blocks = 3) },
  { name: 'all zero is no shift, on a code that does not shift', rule: 'schema', patch: (f) => void Object.assign(entry(f, 'M300'), { shiftZeroIsNone: true }) },
  { name: 'replace "yes"', rule: 'schema', patch: (f) => void (entry(f, 'M8').replace = 'yes') },
  { name: 'replace whole without a label', rule: 'schema', patch: (f) => void delete entry(f, 'M8').label },
  { name: 'verify 1', rule: 'schema', patch: (f) => void (entry(f, 'SPOS').verify = 1) },
  // Its words
  { name: 'words as an object', rule: 'schema', patch: (f) => void (entry(f, 'G906').params = {}) },
  { name: 'a word that is a number', rule: 'schema', patch: (f) => void (entry(f, 'G906').params as unknown[]).push(5) },
  { name: 'a word without a label', rule: 'schema', patch: (f) => void delete param(f, 'G906', 'P').label },
  { name: 'a word with a blank address', rule: 'schema', patch: (f) => void (param(f, 'G906', 'P').address = ' ') },
  { name: 'required "yes"', rule: 'schema', patch: (f) => void (param(f, 'G903', 'Z').required = 'yes') },
  { name: 'a lowest value as text', rule: 'schema', patch: (f) => void (param(f, 'G903', 'Z').min = '-1000') },
  { name: 'a unit "mm"', rule: 'schema', patch: (f) => void (param(f, 'G906', 'X').unit = 'mm') },
  { name: 'a unit with a blank after it', rule: 'schema', patch: (f) => void (param(f, 'G906', 'X').unit = 'dwell ') },
  { name: 'decimals on a length', rule: 'schema', patch: (f) => void Object.assign(param(f, 'G902', 'I'), { unit: 'length' }) },
  { name: 'a position "tool"', rule: 'schema', patch: (f) => void (param(f, 'G903', 'Z').position = 'tool') },
  { name: 'a coordinate of two axes', rule: 'schema', patch: (f) => void (param(f, 'G902', 'J').axis = 'XY') },
  { name: 'a program number "p"', rule: 'schema', patch: (f) => void (param(f, 'G902', 'P').programNumber = 'p') },
  { name: 'an in-plane "corner"', rule: 'schema', patch: (f) => void (param(f, 'G901', 'A').inPlane = 'corner') },
  { name: '0 keeps the rotary axes, on a code that does not turn them', rule: 'schema', patch: (f) => void delete entry(f, 'G901').positionsRotary },
  { name: 'a frame zero "nil"', rule: 'schema', patch: (f) => void (param(f, 'G901', 'A').frameZero = 'nil') },
  { name: 'a frame zero on a code that opens no frame', rule: 'schema', patch: (f) => void (param(f, 'G902', 'L').frameZero = 'zero') },
  { name: 'an empty value that closes', rule: 'schema', patch: (f) => void (param(f, 'G901', 'B').frameCloses = '') },
  { name: 'a sign of "prev"', rule: 'schema', patch: (f) => void (param(f, 'G903', 'L').signOf = 'prev') },
  { name: 'a length along two axes', rule: 'schema', patch: (f) => void (param(f, 'G903', 'R').lengthAlong = 'XY') },
  { name: 'a length along an axis that is a level', rule: 'schema', patch: (f) => void (param(f, 'G903', 'R').position = 'tool-axis') },
  { name: 'a length in force without its axis', rule: 'schema', patch: (f) => void delete param(f, 'G903', 'R').lengthAlong },
  { name: 'a tool offset value "L1"', rule: 'schema', patch: (f) => void (param(f, 'G902', 'L').toolOffsetValues = ['L1']) },
  { name: 'no tool offset values', rule: 'schema', patch: (f) => void (param(f, 'G902', 'L').toolOffsetValues = []) },
  { name: 'tool offset values on a code that does not shift', rule: 'schema', patch: (f) => void delete entry(f, 'G902').shift },
  { name: 'a twin as a number', rule: 'schema', patch: (f) => void (param(f, 'G904', 'D').twin = 5) },
  { name: 'a twin that is no word of the code', rule: 'twin-pair', patch: (f) => void (param(f, 'G904', 'Z').twin = 'U') },
  { name: 'a role "hole"', rule: 'schema', patch: (f) => void (param(f, 'G904', 'Q').expandRole = 'hole') },
  { name: 'a role on a code without an expansion', rule: 'schema', patch: (f) => void (param(f, 'G903', 'Z').expandRole = 'depth') },
  { name: 'a third block', rule: 'schema', patch: (f) => void (param(f, 'G903', 'Q').block = 3) },
  { name: 'a block on a one-block code', rule: 'schema', patch: (f) => void (param(f, 'G906', 'P').block = 1) },
  { name: 'an address twice in one block', rule: 'two-block-agreement', patch: (f) => void (param(f, 'G903', 'Q').address = 'P') },
  { name: 'a different position in the two blocks', rule: 'two-block-agreement', patch: (f) => void ((entry(f, 'G903').params as Json[])[1].position = 'other') },
  // What it switches
  { name: 'sets as a list', rule: 'schema', patch: (f) => void (entry(f, 'G907').sets = []) },
  { name: 'a member of sets gEdit does not know', rule: 'schema', patch: (f) => void (sets(f).coolant = 'on') },
  { name: 'a motion "fast"', rule: 'schema', patch: (f) => void (sets(f).motion = 'fast') },
  { name: 'a speed limit "yes"', rule: 'schema', patch: (f) => void (sets(f).speedLimit = 'yes') },
  { name: 'a speed limit null', rule: 'schema', patch: (f) => void (sets(f).speedLimit = null) },
  { name: 'a limit bound without a limit', rule: 'schema', patch: (f) => void delete sets(f).speedLimit },
  { name: 'an arc direction on a straight line', rule: 'schema', patch: (f) => void delete sets(f).path },
  { name: 'a side without compensation', rule: 'schema', patch: (f) => void (sets(f).radiusComp = 'off') },
  // The expansion
  { name: 'an expansion on a code that starts no cycle', rule: 'schema', patch: (f) => void delete entry(f, 'G904').sets },
  { name: 'an expansion of a tap', rule: 'schema', patch: (f) => void (entry(f, 'G904').tapping = true) },
  { name: 'an expansion that is a number', rule: 'schema', patch: (f) => void (entry(f, 'G904').expand = 5) },
  { name: 'a schema member gEdit does not know', rule: 'schema', patch: (f) => void (drill(f).kinds = 'peck') },
  { name: 'a kind "mill"', rule: 'schema', patch: (f) => void (drill(f).kind = 'mill') },
  { name: 'no steps', rule: 'schema', patch: (f) => void delete drill(f).steps },
  { name: 'an empty list of steps', rule: 'schema', patch: (f) => void (drill(f).steps = []) },
  { name: 'a return by "x"', rule: 'schema', patch: (f) => void (drill(f).returnBy = 'x') },
  { name: 'no leaves', rule: 'schema', patch: (f) => void delete drill(f).leaves },
  { name: 'leaves without the feed', rule: 'schema', patch: (f) => void (drill(f).leaves = { motion: 'before' }) },
  { name: 'leaves with a third member', rule: 'schema', patch: (f) => void (drill(f).leaves = { motion: 'before', feed: 'cycle', speed: 'cycle' }) },
  { name: 'a relative depth "x"', rule: 'schema', patch: (f) => void (drill(f).relativeDepth = 'x') },
  { name: 'defaults as a number', rule: 'schema', patch: (f) => void (((choice(f).cases as Json)['1'] as Json).defaults = 5) },
  { name: 'an empty default', rule: 'schema', patch: (f) => void (((choice(f).cases as Json)['1'] as Json).defaults = { W: ' ' }) },
  { name: 'an empty list of defaults', rule: 'schema', patch: (f) => void (((choice(f).cases as Json)['1'] as Json).defaults = { W: [] }) },
  { name: 'a default listed twice', rule: 'schema', patch: (f) => void (((choice(f).cases as Json)['1'] as Json).defaults = { W: ['0', '0'] }) },
  { name: 'a feed out of 0 that means rapid', rule: 'schema', patch: (f) => void (drill(f).feedOutZero = 'rapid') },
  { name: 'a step that is a number', rule: 'schema', patch: (f) => void (drill(f).steps as unknown[]).push(5) },
  { name: 'a step "jump"', rule: 'schema', patch: (f) => void steps(f).push({ step: 'jump' }) },
  { name: 'a rapid step without its level', rule: 'schema', patch: (f) => void delete steps(f)[0].to },
  { name: 'a rapid step to "top"', rule: 'schema', patch: (f) => void (steps(f)[0].to = 'top') },
  { name: 'a rapid step with a feed', rule: 'schema', patch: (f) => void (steps(f)[0].feed = 'feed') },
  { name: 'a feed step at "slow"', rule: 'schema', patch: (f) => void (steps(f)[3].feed = 'slow') },
  { name: 'pecks without a mode', rule: 'schema', patch: (f) => void delete steps(f)[1].mode },
  { name: 'chip breaks without the retract', rule: 'schema', patch: (f) => void delete steps(f)[1].retract },
  { name: 'chip breaks with a level to go back to', rule: 'schema', patch: (f) => void (steps(f)[1].back = 'r-plane') },
  { name: 'full retracts with a chip break retract', rule: 'schema', patch: (f) => void ((((choice(f).cases as Json)['1'] as Json).steps as Json[])[1].retract = { form: 'peckRetract' }) },
  { name: 'a value with a role and a form field', rule: 'schema', patch: (f) => void (steps(f)[1].retract = { role: 'peck', form: 'peckRetract' }) },
  { name: 'a value of a role "hole"', rule: 'schema', patch: (f) => void (steps(f)[1].retract = { role: 'hole' }) },
  { name: 'an empty value', rule: 'schema', patch: (f) => void (steps(f)[1].retract = {}) },
  { name: 'a dwell in the "middle"', rule: 'schema', patch: (f) => void (steps(f)[2].at = 'middle') },
  { name: 'a lift-off back "yes"', rule: 'schema', patch: (f) => void ((((choice(f).cases as Json)['0'] as Json).steps as Json[])[6].back = 'yes') },
  { name: 'an orient step with a level', rule: 'schema', patch: (f) => void ((((choice(f).cases as Json)['0'] as Json).steps as Json[])[3].to = 'depth') },
  { name: 'a step to a level whose role is missing', rule: 'expand-rules', patch: (f) => void (steps(f)[0].to = 'clearance') },
  { name: 'no step that reaches the depth', rule: 'expand-rules', patch: (f) => void (drill(f).steps = [{ step: 'rapid', to: 'r-plane' }]) },
  { name: 'a role given to two words', rule: 'expand-rules', patch: (f) => void (param(f, 'G904', 'E').expandRole = 'feed') },
  { name: 'cases picked by a word that is no variant', rule: 'expand-rules', patch: (f) => void (choice(f).by = 'Z') },
  { name: 'no cases', rule: 'schema', patch: (f) => void (choice(f).cases = {}) },
  { name: 'cases with a third member', rule: 'schema', patch: (f) => void (choice(f).kind = 'drill') },
  { name: 'a case that is broken', rule: 'schema', patch: (f) => void (((choice(f).cases as Json)['1'] as Json).kind = 'mill') },
  // The dwell
  { name: 'a dwell that is a number', rule: 'schema', patch: (f) => void (entry(f, 'G906').dwell = 5) },
  { name: 'an empty dwell', rule: 'schema', patch: (f) => void (entry(f, 'G906').dwell = {}) },
  { name: 'a dwell in minutes', rule: 'schema', patch: (f) => void (entry(f, 'G906').dwell = { minutes: 'X' }) },
  { name: 'dwell seconds as a number', rule: 'schema', patch: (f) => void (entry(f, 'G906').dwell = { seconds: 5 }) },
  { name: 'dwell seconds in a word of another code', rule: 'dwell-form', patch: (f) => void (entry(f, 'G906').dwell = { seconds: 'Q' }) },
  { name: 'no dwell lines', rule: 'schema', patch: (f) => void (entry(f, 'G906').dwell = { lines: [] }) },
  { name: 'dwell lines without the seconds', rule: 'dwell-form', patch: (f) => void (entry(f, 'G906').dwell = { lines: ['G4'] }) },
  // Templates
  { name: 'a template that is a number', rule: 'schema', patch: (f) => void (f.templates as unknown[]).push(5) },
  { name: 'a template id with a capital', rule: 'schema', patch: (f) => void (tpl(f).id = 'Shop') },
  { name: 'a template id given twice', rule: 'template-rules', patch: (f) => void (tpl(f, 1).id = 'shop-drill') },
  { name: 'a template without a label', rule: 'schema', patch: (f) => void delete tpl(f).label },
  { name: 'a template label of 81 characters', rule: 'schema', patch: (f) => void (tpl(f).label = 'L'.repeat(81)) },
  { name: 'a template label of two lines', rule: 'schema', patch: (f) => void (tpl(f).label = 'Shop\ndrilling') },
  { name: 'a template without a group', rule: 'schema', patch: (f) => void delete tpl(f).group },
  { name: 'a blank description', rule: 'schema', patch: (f) => void (tpl(f).description = ' ') },
  { name: 'a toolbar "yes"', rule: 'schema', patch: (f) => void (tpl(f).toolbar = 'yes') },
  { name: 'a template for a router', rule: 'schema', patch: (f) => void (tpl(f).machineType = 'router') },
  { name: 'a template review "x"', rule: 'schema', patch: (f) => void (tpl(f).review = 'x') },
  { name: 'a blank body', rule: 'schema', patch: (f) => void (tpl(f).body = ' ') },
  { name: 'fields as an object', rule: 'schema', patch: (f) => void (tpl(f).params = {}) },
  { name: '41 fields', rule: 'schema', patch: (f) => void (tpl(f).params = many(41, (i) => ({ id: `p${i}`, label: 'P', type: 'number' }))) },
  { name: 'a snippet with fields', rule: 'schema', patch: (f) => void (tpl(f, 1).params = [{ id: 'x', label: 'X', type: 'number' }]) },
  { name: 'a placeholder that names no field', rule: 'template-rules', patch: (f) => void (tpl(f).body = '{{N}} G0 {{nothing}}') },
  { name: 'a field that is a number', rule: 'schema', patch: (f) => void (tpl(f).params as unknown[]).push(5) },
  { name: 'a field id in capitals', rule: 'schema', patch: (f) => void (tparam(f, 'k').id = 'K') },
  { name: 'a field called sys', rule: 'template-rules', patch: (f) => void (tparam(f, 'k').id = 'sys') },
  { name: 'a field id given twice', rule: 'template-rules', patch: (f) => void (tparam(f, 'k').id = 'z') },
  { name: 'a field without a label', rule: 'schema', patch: (f) => void delete tparam(f, 'k').label },
  { name: 'a field of type "float"', rule: 'schema', patch: (f) => void (tparam(f, 'k').type = 'float') },
  { name: 'a help text of two lines', rule: 'schema', patch: (f) => void (tparam(f, 'z').help = 'The bottom\nof the hole') },
  { name: 'a lowest value on a text', rule: 'schema', patch: (f) => void (tparam(f, 'name').min = 1) },
  { name: 'a lowest value as text', rule: 'schema', patch: (f) => void (tparam(f, 'z').min = '-500') },
  { name: 'a lowest value of an integer with decimals', rule: 'schema', patch: (f) => void (tparam(f, 'k').min = 1.5) },
  { name: 'a lowest value above the highest', rule: 'template-rules', patch: (f) => void (tparam(f, 'k').min = 100) },
  { name: 'choices on a number', rule: 'schema', patch: (f) => void (tparam(f, 'z').choices = [{ label: 'A', value: '1' }]) },
  { name: 'a choice without choices', rule: 'schema', patch: (f) => void delete tparam(f, 'coolant').choices },
  { name: '51 choices', rule: 'schema', patch: (f) => void (tparam(f, 'coolant').choices = many(51, (i) => ({ label: `C${i}`, value: `${i}` }))) },
  { name: 'a choice value that is an object', rule: 'schema', patch: (f) => void (tparam(f, 'coolant').choices = [{ label: 'A', value: {} }]) },
  { name: 'a choice value with a brace', rule: 'schema', patch: (f) => void (tparam(f, 'coolant').choices = [{ label: 'A', value: 'a{b' }]) },
  { name: 'a choice value given twice', rule: 'template-rules', patch: (f) => void (tparam(f, 'coolant').choices = [{ label: 'A', value: '8' }, { label: 'B', value: 8 }]) },
  { name: 'decimals on an integer', rule: 'schema', patch: (f) => void (tparam(f, 'k').decimals = 2) },
  { name: 'seven decimals', rule: 'schema', patch: (f) => void (tparam(f, 'r').decimals = 7) },
  { name: 'digits on a number', rule: 'schema', patch: (f) => void (tparam(f, 'r').digits = 3) },
  { name: 'ten digits', rule: 'schema', patch: (f) => void (tparam(f, 'k').digits = 10) },
  { name: 'a prefix with a brace', rule: 'schema', patch: (f) => void (tparam(f, 'z').prefix = 'Z{') },
  { name: 'a prefix of 17 characters', rule: 'schema', patch: (f) => void (tparam(f, 'z').prefix = 'Z'.repeat(17)) },
  { name: 'a plus sign on a text', rule: 'schema', patch: (f) => void (tparam(f, 'name').plusSign = true) },
  { name: 'upper case on a number', rule: 'schema', patch: (f) => void (tparam(f, 'z').uppercase = true) },
  { name: 'a comment "yes"', rule: 'schema', patch: (f) => void (tparam(f, 'name').comment = 'yes') },
  { name: 'a longest text of 0', rule: 'schema', patch: (f) => void (tparam(f, 'name').maxLength = 0) },
  { name: 'a longest text on a number', rule: 'schema', patch: (f) => void (tparam(f, 'z').maxLength = 5) },
  { name: 'characters "ascii"', rule: 'schema', patch: (f) => void (tparam(f, 'name').charset = 'ascii') },
  { name: 'characters on a number', rule: 'schema', patch: (f) => void (tparam(f, 'z').charset = 'name') },
  { name: 'a unit on a text', rule: 'schema', patch: (f) => void (tparam(f, 'name').unit = 'mm') },
  { name: 'a unit of 17 characters', rule: 'schema', patch: (f) => void (tparam(f, 'z').unit = 'm'.repeat(17)) },
  { name: 'a formula without its formula', rule: 'schema', patch: (f) => void delete tparam(f, 'rpm').formula },
  { name: 'a formula that does not read', rule: 'template-rules', patch: (f) => void (tparam(f, 'rpm').formula = '1000 * (f') },
  { name: 'a formula that is required', rule: 'schema', patch: (f) => void (tparam(f, 'rpm').required = false) },
  { name: 'a formula with a default', rule: 'schema', patch: (f) => void (tparam(f, 'rpm').default = 1) },
  { name: 'a formula that is remembered', rule: 'schema', patch: (f) => void (tparam(f, 'rpm').remember = true) },
  { name: 'a hidden number', rule: 'schema', patch: (f) => void (tparam(f, 'z').hidden = false) },
  { name: 'a formula on a number', rule: 'schema', patch: (f) => void (tparam(f, 'z').formula = '1') },
  { name: 'required "yes" on a field', rule: 'schema', patch: (f) => void (tparam(f, 'z').required = 'yes') },
  { name: 'remember null', rule: 'schema', patch: (f) => void (tparam(f, 'z').remember = null) },
  { name: 'a text default that is a number', rule: 'schema', patch: (f) => void (tparam(f, 'name').default = 5) },
  { name: 'a text default of two lines', rule: 'schema', patch: (f) => void (tparam(f, 'name').default = 'A\nB') },
  { name: 'a text default in lower case', rule: 'template-rules', patch: (f) => void (tparam(f, 'name').default = 'hole') },
  { name: 'a choice default that is no choice', rule: 'template-rules', patch: (f) => void (tparam(f, 'coolant').default = '9') },
  { name: 'a number default that is no number', rule: 'template-rules', patch: (f) => void (tparam(f, 'z').default = 'deep') },
  { name: 'a number default above the highest value', rule: 'template-rules', patch: (f) => void (tparam(f, 'z').default = 5) },
];

// ---------------------------------------------------------------------------
// The rows
// ---------------------------------------------------------------------------

describe('schemas/codes.schema.json (P4.39b)', () => {
  it('is a draft 2020-12 schema with the id exported files point at', () => {
    expect(codesSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(codesSchema.$id).toBe('https://raw.githubusercontent.com/CNC-Master-xyz/gEdit/main/schemas/codes.schema.json');
  });

  it('compiles with the test validator, every keyword in the allowed list (rule 3)', () => {
    expect(typeof validate).toBe('function');
    const used = new Set(subschemas(ROOT).flatMap((s) => Object.keys(s)));
    expect([...used].filter((keyword) => !ALLOWED_KEYWORDS.has(keyword))).toEqual([]);
    expect(subschemas(ROOT).filter((s) => 'x-gedit-stub' in s)).toEqual([]);
  });

  it('gives every member a title and a description, in words without plan ids (rule 3)', () => {
    const missing: string[] = [];
    const planIds: string[] = [];
    for (const [key, path] of schemaPaths(ROOT, ROOT)) {
      const found = schemasAt(ROOT, path.map((p) => (p === '*' ? 'any-key' : p)));
      if (!found.some((s) => typeof s.title === 'string' && typeof s.description === 'string')) missing.push(key);
    }
    for (const s of subschemas(ROOT)) {
      for (const text of [s.title, s.description]) {
        if (typeof text === 'string' && /\b(?:P4|AD-\d|WP\d|§|T\d{3}\b|Q4h|NC-\d|D\d-\d)/.test(text)) planIds.push(text);
      }
    }
    expect(missing).toEqual([]);
    expect(planIds).toEqual([]);
  });

  it('accepts every built-in code file as written (extends, remove, templates included) and as resolved (rule 2)', () => {
    expect(builtinProblems()).toEqual([]);
    for (const [dialect, file] of Object.entries(BUILTIN_CODE_DB_JSON)) expect(schemaErrors(file), dialect).toEqual([]);
    expect(RESOLVED.length).toBeGreaterThan(3);
    for (const { name, value } of RESOLVED) expect(schemaErrors(value), name).toEqual([]);
  });

  it('accepts the full user file, and the app reads it without a problem', () => {
    expect(userFileProblems('shop-mill', FULL)).toEqual([]);
    expect(schemaErrors(FULL)).toEqual([]);
  });

  it('accepts a file laid over a built-in database, with entries that change one member', () => {
    const overlay = { dialect: 'fanuc', codes: [{ code: 'M8', description: 'Through the spindle.' }, { code: 'G1', sets: { motion: 'feed' } }] };
    expect(userFileProblems('fanuc', overlay)).toEqual([]);
    expect(schemaErrors(overlay)).toEqual([]);
  });

  it('agrees with the loader on each broken case, one or more per rule (rule 2)', () => {
    expect(userFileProblems('shop-mill', FULL), 'the full file has to be accepted, or every case is refused for its sake').toEqual([]);
    const wrong: string[] = [];
    for (const c of CASES) {
      const file = clone(FULL);
      c.patch(file);
      const problems = userFileProblems('shop-mill', file);
      const accepted = schemaAccepts(file);
      if (problems.length === 0) wrong.push(`${c.name}: the app accepts it`);
      if (accepted !== (c.rule !== 'schema')) {
        wrong.push(`${c.name}: the schema ${accepted ? 'accepts' : 'refuses'} it (${c.rule}) ${accepted ? '' : schemaErrors(file).slice(0, 3).join('; ')}`);
      }
    }
    expect(wrong).toEqual([]);
  }, 60_000);

  it('names a broken case for every rule of VALIDATOR_ONLY, and a reason for each', () => {
    const shown = new Set(CASES.map((c) => c.rule));
    expect(Object.keys(VALIDATOR_ONLY).filter((id) => !shown.has(id))).toEqual([]);
    for (const reason of Object.values(VALIDATOR_ONLY)) expect(reason.length).toBeGreaterThan(20);
  });

  it('keeps unknown members where the loader ignores them (rule 1)', () => {
    const file = clone(FULL);
    file.$comment = 'shop codes';
    entry(file, 'SPOS').note = 'from the manual';
    param(file, 'G906', 'X').note = 'seconds';
    ((file.addresses as Json).X as Json).note = 'x';
    tpl(file).$comment = 'the drilling template';
    tparam(file, 'z').note = 'x';
    expect(userFileProblems('shop-mill', file)).toEqual([]);
    expect(schemaErrors(file)).toEqual([]);
  });

  it('covers frameZero, frameCloses, turnsRotary and the code:<code> conditions (rule 5)', () => {
    for (const path of ['codes.[].params.[].frameZero', 'codes.[].params.[].frameCloses', 'codes.[].params.[].turnsRotary', 'codes.[].conflicts.[]']) {
      expect(schemasAt(ROOT, path.split('.')).length, path).toBeGreaterThan(0);
    }
    const conflicts = (list: string[]): boolean => {
      const file = clone(FULL);
      entry(file, 'G901').conflicts = list;
      return schemaAccepts(file);
    };
    expect(conflicts(['code:G43.4', '!code:G68', 'frame:frame', '!frame:polar', 'surfaceSpeed', 'feedNotPerMinute', 'cycle'])).toBe(true);
    expect(conflicts(['code:4'])).toBe(false);
    expect(conflicts(['frame:'])).toBe(false);
    expect(conflicts(['!!tcp'])).toBe(false);
  });

  it('covers expand, expandRole, dwell, twin, lengthAlong and the block-aware unit of a two-block entry (rule 5)', () => {
    for (const path of [
      'codes.[].expand.kind',
      'codes.[].expand.cases.any-key.steps.[].mode',
      'codes.[].expand.by',
      'codes.[].params.[].expandRole',
      'codes.[].dwell.lines.[]',
      'codes.[].params.[].twin',
      'codes.[].params.[].lengthAlong',
      'codes.[].params.[].lengthInForce',
      'codes.[].params.[].block',
    ]) {
      expect(schemasAt(ROOT, path.split('.')).length, path).toBeGreaterThan(0);
    }
    // The G76 P of plan §6.10 rule 10: a count in the first block, increments in the second.
    const g903 = (entry(FULL, 'G903').params as Json[]).filter((p) => p.address === 'P').map((p) => [p.block, p.unit]);
    expect(g903).toEqual([
      [1, 'count'],
      [2, 'increment'],
    ]);
  });

  it('describes every member of every built-in file and of the full user file (rule 5a)', () => {
    const undescribed: string[] = [];
    const files = [...Object.entries(BUILTIN_CODE_DB_JSON), ...RESOLVED.map((r) => [r.name, r.value] as const), ['shop-mill', FULL] as const];
    for (const [name, value] of files) {
      for (const [key, path] of memberPaths(value)) {
        if (schemasAt(ROOT, path).length === 0) undescribed.push(`${name}: ${key}`);
      }
    }
    expect(undescribed).toEqual([]);
  });

  it('describes every member of the types, also those no file writes (rule 5b)', () => {
    const ENTRY = [
      'code', 'blocks', 'aliases', 'group', 'modal', 'pitchFeed', 'pitchFeedAmbiguous', 'tappingElsewhere', 'label', 'description',
      'params', 'verify', 'review', 'sets', 'fNotFeed', 'tapping', 'wordsAreData', 'axisWords', 'frame', 'frameWithoutValues',
      'frameZeroWords', 'frameEmptyCloses', 'conflicts', 'alone', 'requires', 'ownWords', 'contour', 'pole', 'call', 'blockFeed',
      'shift', 'shiftZeroIsNone', 'frameIdentity', 'flow', 'blank', 'positionsRotary', 'expand', 'dwell', 'orient', 'machineType', 'replace',
      'usedBy',
    ];
    const PARAM = [
      'address', 'label', 'required', 'min', 'max', 'unit', 'decimals', 'position', 'axis', 'programNumber', 'block', 'inPlane',
      'keepsRotary', 'turnsRotary', 'frameZero', 'frameCloses', 'signOf', 'lengthAlong', 'lengthInForce', 'toolOffsetValues', 'twin', 'expandRole',
    ];
    const SETS = [
      'feedUnit', 'speedUnit', 'distance', 'units', 'plane', 'cycle', 'speedLimit', 'speedLimitBound', 'diameter', 'tcp', 'planeFromAxisWord',
      'spindle', 'toolSpindle', 'motion', 'path', 'arcDirection', 'radiusComp', 'compSide', 'lengthComp', 'exitSpeed', 'language', 'cycleReturn',
    ];
    const SCHEMA = ['kind', 'steps', 'returnBy', 'relativeDepth', 'leaves', 'defaults', 'feedOutZero'];
    const STEP = ['step', 'to', 'feed', 'mode', 'retract', 'back', 'reentry', 'retractAt', 'at'];
    const TEMPLATE = ['id', 'label', 'group', 'description', 'toolbar', 'snippet', 'body', 'params', 'machineType', 'review'];
    const TEMPLATE_PARAM = [
      'id', 'label', 'type', 'help', 'required', 'min', 'max', 'default', 'choices', 'prefix', 'suffix', 'decimals', 'digits', 'plusSign',
      'uppercase', 'comment', 'maxLength', 'charset', 'unit', 'remember', 'formula', 'hidden',
    ];
    const paths = [
      ...['$schema', 'dialect', 'version', 'extends', 'remove', 'addresses', 'codes', 'templates'],
      'addresses.X.label',
      'addresses.X.description',
      ...ENTRY.map((m) => `codes.[].${m}`),
      ...PARAM.map((m) => `codes.[].params.[].${m}`),
      ...SETS.map((m) => `codes.[].sets.${m}`),
      ...SCHEMA.map((m) => `codes.[].expand.${m}`),
      ...STEP.map((m) => `codes.[].expand.steps.[].${m}`),
      'codes.[].expand.steps.[].retract.role',
      'codes.[].expand.steps.[].reentry.form',
      'codes.[].expand.leaves.motion',
      'codes.[].dwell.seconds',
      'codes.[].dwell.increments',
      'codes.[].dwell.revolutions',
      ...TEMPLATE.map((m) => `templates.[].${m}`),
      ...TEMPLATE_PARAM.map((m) => `templates.[].params.[].${m}`),
      'templates.[].params.[].choices.[].label',
      'templates.[].params.[].choices.[].value',
    ];
    expect(paths.filter((key) => schemasAt(ROOT, key.split('.')).length === 0)).toEqual([]);
  });
});
