// Documents for the hover tests: a program read by the real modal index with the effective profile, code
// database and machine made the way the app makes them, and the hover as `monaco/providers/hover.ts` asks for it.
// Shared by `hoverText.test.ts` and `hoverText.slow.test.ts` in src/lib/core/codes.

import { expect } from 'vitest';
import { applyMachine, effectiveMachine } from '$lib/core/machines/effective';
import { ModalIndex } from '$lib/core/nc/modal';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { t } from '$lib/i18n';
import { loadCodeDb } from '$lib/core/codes/load';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import { blockRange } from '$lib/core/codes/inspect';
import { hoverAt, type HoverContext, type WaitCodeLookup } from '$lib/core/codes/hoverText';
import type { EffectiveMachine, MachineConfig, MachineParams, NumberInput } from '$lib/core/machines/types';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import type { CodeDb } from '$lib/core/codes/types';
import { profileOf } from './profiles';

export const DBS = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, problem) => {
  throw new Error(`${dialect}: ${problem.path}: ${problem.message}`);
});

export interface Doc {
  profile: Profile;
  cp: CompiledProfile;
  db: CodeDb;
  machine: EffectiveMachine;
  lines: string[];
  index: ModalIndex;
}

export interface MachineSpec {
  name?: string;
  params?: Partial<MachineParams>;
  /** Detected variants, as variant detection answers them, for a document with no machine. */
  detected?: Record<string, { value: string; margin: number }>;
  /** A code database to read instead of the built-in one (a user's file merged over it). */
  db?: CodeDb;
}

/** A preset's number input, as a machine stores it. */
export function preset(profileId: string, id: string): NumberInput {
  const found = profileOf(profileId).machineParams?.numberInput?.presets.find((p) => p.id === id);
  if (!found) throw new Error(`${profileId}: no preset ${id}`);
  return found.value;
}

/** `text` on profile `profileId`, read with `machine` (`null` or no `params`: none chosen), the index built. */
export function openDoc(profileId: string, text: string, machine: MachineSpec | null = null): Doc {
  const base = profileOf(profileId);
  const config: MachineConfig | null =
    machine?.params !== undefined ? { id: 'm', name: machine.name ?? 'Machine', profile: profileId, params: machine.params } : null;
  const eff = effectiveMachine(base, config, config ? 'document' : 'none', machine?.detected ?? {});
  const applied = applyMachine(base, eff);
  const checked = validateProfile(applied.profile, { applied: true });
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  const cp = compileProfile(checked.profile);
  const db = machine?.db ?? loadCodeDb(DBS[applied.codes]);
  const lines = text.split('\n');
  const index = new ModalIndex(cp, db);
  index.reset(lines.length, (n) => lines[n - 1] ?? '');
  while (!index.buildSome(1_000)) {
    // until the whole document is read
  }
  return { profile: checked.profile, cp, db, machine: eff, lines, index };
}

/** The context of line `n`, as the provider builds it; `ready: false`: the index has not reached it. */
export function contextAt(doc: Doc, n: number, ready = true): HoverContext {
  const lineCount = doc.lines.length;
  const getLine = (k: number): string => doc.lines[k - 1] ?? '';
  const { first, last } = blockRange({ line: n, lineCount, getLine }, doc.cp);
  const before = ready ? doc.index.stateAfter(first - 1) : null;
  return {
    before,
    after: before === null ? null : doc.index.stateAfter(last),
    profile: doc.profile,
    machine: doc.machine,
    blockLines: { first, last, line: n, lineCount, getLine },
  };
}

export interface HoverIn {
  /** false: no context at all (a diff side, a scratch model). */
  context?: boolean;
  ready?: boolean;
  /** Which occurrence of `at` on the line (0 = the first). */
  nth?: number;
  waitCode?: WaitCodeLookup;
}

/** The hover markdown on line `n` at `at`. Every message the context asks for must exist. */
export function hoverIn(doc: Doc, n: number, at: string, o: HoverIn = {}): string {
  const line = doc.lines[n - 1];
  let offset = -1;
  for (let i = 0; i <= (o.nth ?? 0); i++) offset = line.indexOf(at, offset + 1);
  if (offset < 0) throw new Error(`"${at}" is not on line ${n}: ${line}`);
  const prev = n > 1 ? tokenizeLine(doc.lines[n - 2], doc.cp).state : undefined;
  const context = o.context === false ? undefined : contextAt(doc, n, o.ready !== false);
  const markdown = hoverAt(line, offset, doc.cp, doc.db, t, prev, { context, waitCode: o.waitCode })?.markdown ?? '';
  expect(markdown, 'a message key without a text').not.toContain('assistant.');
  return markdown;
}

/** The markdown with its escapes removed: what the user reads. */
export const plain = (markdown: string): string => markdown.replace(/\\(.)/g, '$1');
/** The readable hover. */
export const read = (doc: Doc, n: number, at: string, o: HoverIn = {}): string => plain(hoverIn(doc, n, at, o));
/** The table rows of a hover: `[word, meaning, written]`, `null` for "not written". */
export function tableOf(text: string): [string, string, string | null][] {
  return text
    .split('\n')
    .filter((row) => row.startsWith('| ') && !row.startsWith('| Word') && !row.startsWith('| ---'))
    .map((row) => {
      const [word, meaning, written] = row.slice(2, -2).split(' | ');
      return [word, meaning, written === '_not written_' ? null : written];
    });
}
export const writtenOf = (text: string): Record<string, string | null> => Object.fromEntries(tableOf(text).map(([w, , v]) => [w, v]));

export const IS_B = { name: 'Lathe IS-B', params: { numberInput: preset('fanuc-lathe', 'is-b') } };
export const CALCULATOR = { name: 'Lathe calc', params: { numberInput: preset('fanuc-lathe', 'calculator') } };
