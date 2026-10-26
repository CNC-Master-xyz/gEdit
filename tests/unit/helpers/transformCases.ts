// The one reader of `tests/fixtures/transforms/<id>/<case>/` (T207).
//
// Every case folder holds `input.nc`, `expected.nc` and `options.json`, and every
// `options.json` has one shape: the run, not just the options.
//
//   { "note": "why the case exists", "profile": "fanuc-gcode", "options": { … },
//     "mode": "add" | "remove",            block-skip only: which of its two transforms runs
//     "scope": { "startLine": 3, "endLine": 9 },   a real selection: input.nc is the whole program
//     "firstLine": 12,                     a bare fragment that starts at this line, no document
//     "expect": { "summary": "…", "skipped": [{ "line": 1, "severity": "info" }], "warnings": ["…"],
//                 "preflight": "…" | null } }
//
// The eight transform tests used to read the folders themselves, with a loader copied from one
// to the next and two shapes of `options.json` (the five cleanups stored the bare options and
// took the dialect from the folder's name). This reader refuses a key it does not know and a
// case that has no note, so a typo in a sidecar fails here, in every test at once, and not as
// a case that quietly runs with its default options. The harness (`tests/runtime/scenarios/
// m4-common.js`) reads the same files and takes the wrapped shape through `caseOptions` and
// `caseProfile`.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CaseMeta {
  note: string;
  profile: string;
  options: Record<string, unknown>;
  mode?: 'add' | 'remove';
  /** A real selection run: `input.nc` is the whole program and this is the scope. */
  scope?: { startLine: number; endLine: number };
  /** A bare fragment with no document behind it. */
  firstLine?: number;
  expect?: {
    summary?: string;
    skipped?: { line: number; severity: string }[];
    warnings?: string[];
    preflight?: string | null;
  };
}

/** What a sidecar may say. Anything else is a typo. */
export const CASE_KEYS = ['note', 'profile', 'options', 'mode', 'scope', 'firstLine', 'expect'] as const;

export interface TransformCase {
  name: string;
  meta: CaseMeta;
  profile: string;
  options: Record<string, unknown>;
  /** `input.nc` and `expected.nc` as written. */
  inputText: string;
  expectedText: string;
  /** The whole program, split the way `TransformService` splits it. */
  document: string[];
  expectedDocument: string[];
  /** True when `meta.scope` makes `input`/`expected` a slice of the document. */
  scoped: boolean;
  /** The lines the transform is handed, and the lines it has to return. */
  input: string[];
  expected: string[];
  /** The document line `input` starts at. */
  firstLine: number;
}

/** The text of a sidecar as a checked `CaseMeta`; throws, naming the case, on anything odd. */
export function parseCaseMeta(text: string, where: string): CaseMeta {
  const raw: unknown = JSON.parse(text);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${where}: options.json is not an object`);
  const meta = raw as Record<string, unknown>;
  for (const key of Object.keys(meta)) {
    if (!(CASE_KEYS as readonly string[]).includes(key)) {
      throw new Error(`${where}: options.json has the unknown key "${key}" (the run is { note, profile, options, … }; the transform's own options go under "options")`);
    }
  }
  if (typeof meta.note !== 'string' || meta.note.trim() === '') throw new Error(`${where}: options.json needs a note saying why the case exists`);
  if (typeof meta.profile !== 'string' || meta.profile === '') throw new Error(`${where}: options.json needs the profile id`);
  if (meta.options === null || typeof meta.options !== 'object' || Array.isArray(meta.options)) {
    throw new Error(`${where}: options.json needs "options", an object (use {} for the defaults)`);
  }
  if (meta.mode !== undefined && meta.mode !== 'add' && meta.mode !== 'remove') throw new Error(`${where}: "mode" is add or remove`);
  if (meta.scope !== undefined && meta.firstLine !== undefined) throw new Error(`${where}: a case has a scope or a firstLine, not both`);
  return meta as unknown as CaseMeta;
}

/** Every case folder under `dir`, sorted by name. */
export function readTransformCases(dir: string): TransformCase[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const where = `${dir}${name}`;
      const meta = parseCaseMeta(readFileSync(join(dir, name, 'options.json'), 'utf8'), where);
      const inputText = readFileSync(join(dir, name, 'input.nc'), 'utf8');
      const expectedText = readFileSync(join(dir, name, 'expected.nc'), 'utf8');
      const document = inputText.split('\n');
      const expectedDocument = expectedText.split('\n');
      const scoped = meta.scope !== undefined;
      const { startLine, endLine } = meta.scope ?? { startLine: meta.firstLine ?? 1, endLine: document.length };
      return {
        name,
        meta,
        profile: meta.profile,
        options: meta.options,
        inputText,
        expectedText,
        document,
        expectedDocument,
        scoped,
        input: scoped ? document.slice(startLine - 1, endLine) : document,
        expected: scoped ? expectedDocument.slice(startLine - 1, endLine) : expectedDocument,
        firstLine: startLine,
      };
    });
}
