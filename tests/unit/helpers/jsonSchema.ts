// Shared by the three schema agreement tests (`core/{profiles,machines,codes}/schema.test.ts`, Phase 4
// plan AD-57, §6.10 rules 3-5): the test validator (ajv 8, draft 2020-12; a dev dependency, Q4h-1; never
// shipped, the hand-written checks stay the gate), the keywords a gEdit schema may use and the walkers
// that follow `$ref`, `allOf`, `anyOf`, `oneOf`, `then` and `else` through a schema.

import Ajv2020 from 'ajv/dist/2020';
import { expect } from 'vitest';

export type Json = Record<string, unknown>;
export type Schema = Record<string, unknown>;

/** Our four annotations (rule 3); ajv's strict mode refuses any other unknown keyword. */
export const GEDIT_KEYWORDS = ['x-gedit-order', 'x-gedit-kind', 'x-gedit-advanced', 'x-gedit-stub'] as const;

/** Rule 3: the keywords a gEdit schema may use. */
export const ALLOWED_KEYWORDS = new Set<string>([
  '$schema', '$id', '$ref', '$defs', '$comment', 'title', 'description', 'type', 'properties', 'required',
  'additionalProperties', 'patternProperties', 'propertyNames', 'items', 'minItems', 'maxItems', 'uniqueItems',
  'enum', 'const', 'pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'minProperties',
  'maxProperties', 'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else', 'default', 'examples',
  ...GEDIT_KEYWORDS,
]);

/** The validator of the tests only (Q4h-1): never shipped, the hand-written checks stay the gate. */
export function testValidator(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, strictTypes: false });
  for (const keyword of GEDIT_KEYWORDS) ajv.addKeyword(keyword);
  return ajv;
}

export const SCHEMA_MAPS = ['properties', 'patternProperties', '$defs'];
export const SCHEMA_ONE = ['items', 'additionalProperties', 'propertyNames', 'not', 'if', 'then', 'else'];
export const SCHEMA_LIST = ['allOf', 'anyOf', 'oneOf'];

/** Every schema object below `schema`, the root included. */
export function subschemas(schema: unknown, out: Schema[] = []): Schema[] {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return out;
  const s = schema as Schema;
  out.push(s);
  for (const key of SCHEMA_MAPS) for (const sub of Object.values((s[key] as Json | undefined) ?? {})) subschemas(sub, out);
  for (const key of SCHEMA_ONE) subschemas(s[key], out);
  for (const key of SCHEMA_LIST) for (const sub of (s[key] as unknown[] | undefined) ?? []) subschemas(sub, out);
  return out;
}

/** Resolves a `#/…` pointer inside `root`. */
export function deref(root: Schema, ref: string): Schema {
  expect(ref.startsWith('#/'), ref).toBe(true);
  let at: unknown = root;
  for (const part of ref.slice(2).split('/')) at = (at as Json)[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  expect(at, ref).toBeTypeOf('object');
  return at as Schema;
}

/** `s` with every schema it applies along with it: `$ref`, `allOf`/`anyOf`/`oneOf`, `then`/`else` (never `not` or `if`). */
export function expand(root: Schema, s: Schema, out: Schema[] = []): Schema[] {
  if (out.includes(s)) return out;
  out.push(s);
  if (typeof s.$ref === 'string') expand(root, deref(root, s.$ref), out);
  for (const key of SCHEMA_LIST) for (const sub of (s[key] as Schema[] | undefined) ?? []) expand(root, sub, out);
  for (const key of ['then', 'else']) if (typeof s[key] === 'object' && s[key] !== null) expand(root, s[key] as Schema, out);
  return out;
}

/** The schemas that describe the member at `path` (`'[]'` for an array item), or none. */
export function schemasAt(root: Schema, path: readonly string[]): Schema[] {
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

/** Every member path of a JSON value, arrays as `[]`. */
export function memberPaths(value: unknown, prefix: string[] = [], out = new Map<string, string[]>()): Map<string, string[]> {
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

/** Every member path the schema itself names (properties, items, additionalProperties as `*`). */
export function schemaPaths(
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
