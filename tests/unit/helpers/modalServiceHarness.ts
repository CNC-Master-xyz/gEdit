// A fake editor, idle queue and clock around the real modal service, and a mill program for it: shared by
// `modalService.test.ts` and `modalService.slow.test.ts` in src/lib/app.

import { writable } from 'svelte/store';
import { loadCodeDb } from '$lib/core/codes/load';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import { applyMachine, effectiveMachine, noMachine } from '$lib/core/machines/effective';
import { maskComments } from '$lib/core/nc/mask';
import { ModalInterpreter } from '$lib/core/nc/modal';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { compileProfile } from '$lib/core/profiles/compile';
import { resolveProfiles } from '$lib/core/profiles/resolve';
import { validateProfile } from '$lib/core/profiles/validate';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_SOURCES } from '$lib/data/profiles';
import { createDocumentStore } from '$lib/stores/documents';
import { createModalService, type ModalServiceInternals, type ModalView } from '$lib/app/modalService';
import type { MachineConfig } from '$lib/core/machines/types';
import type { LineState, ModalState } from '$lib/core/nc/types';
import type { Profile } from '$lib/core/profiles/types';
import type { ContentChange, Disposable, DocId, Eol, FileEncoding, NewDocMeta } from '$lib/app/types';

export const PROFILES = new Map<string, Profile>(
  resolveProfiles(BUILTIN_PROFILE_SOURCES).resolved.map((entry) => {
    const checked = validateProfile(entry.profile);
    if (!checked.ok) throw new Error(checked.errors.join('; '));
    return [checked.profile.id, checked.profile];
  }),
);
const CODE_DBS = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, problem) => {
  throw new Error(`${dialect}: ${problem.path}: ${problem.message}`);
});

/** A built-in profile's effective view, with no machine or a partial one. */
export function viewOf(profileId: string, params?: MachineConfig['params']): ModalView {
  const profile = PROFILES.get(profileId) as Profile;
  const machine =
    params === undefined ? noMachine(profile) : effectiveMachine(profile, { id: 'm', name: 'm', profile: profileId, params }, 'document', {});
  const applied = applyMachine(profile, machine);
  return { cp: compileProfile(applied.profile), db: loadCodeDb(CODE_DBS[applied.codes]), key: `${profileId}|${JSON.stringify(params ?? null)}` };
}

export const MILL = viewOf('fanuc-gcode');

/** The states of a fresh walk, power-on first. */
export function walk(view: ModalView, lines: readonly string[]): ModalState[] {
  const interp = new ModalInterpreter(view.cp, view.db);
  const out = [interp.state()];
  let state: LineState | undefined;
  lines.forEach((line, i) => {
    const r = tokenizeLine(line, view.cp, state);
    state = r.state;
    interp.update(r.tokens, i + 1, maskComments(line, view.cp));
    out.push(interp.state());
  });
  return out;
}

/** `n` lines of a mill program whose state changes on most lines. */
export function program(n: number, feed = 'F100.'): string[] {
  const pool = ['G0 X0. Y0.', `G1 X10. ${feed}`, 'T2 M6', 'S1200 M3', 'G81 X5. Z-3. R1.', 'G80', 'G91 X1.', 'G90 Y2.'];
  return Array.from({ length: n }, (_, i) => pool[i % pool.length]);
}

export const META: NewDocMeta = {
  path: null,
  untitledIndex: 1,
  profileId: 'fanuc-gcode',
  encoding: { encoding: 'utf-8', hasBom: false } satisfies FileEncoding,
  eol: 'lf' satisfies Eol,
  eolMixedOnLoad: false,
  nul: { leader: 0, trailer: 0, stripped: 0 },
  textDirty: false,
  metaDirty: false,
  disk: null,
  external: 'none',
  readOnly: false,
  readOnlyReason: null,
};

interface Task {
  fn: () => void;
  cancelled: boolean;
}

export function harness(o: { budgetMs?: number } = {}) {
  const docs = createDocumentStore({ caseInsensitivePaths: false });
  const lines = new Map<DocId, string[]>();
  /** Documents whose text the editor only has queued (`hasModel` is true for them, `model` is undefined). */
  const queued = new Set<DocId>();
  const reads = { getLines: 0, getLineCount: 0 };
  const views = new Map<DocId, ModalView | null>();
  const idle: Task[] = [];
  const timers: Task[] = [];
  const machineRevision = writable(0);
  const profileRevision = writable(0);
  let onContent: (id: DocId, change: ContentChange) => void = () => {};
  let onCreate: (id: DocId) => void = () => {};
  let version = 1;
  let effectiveCalls = 0;
  const queue = (list: Task[], fn: () => void): Disposable => {
    const task = { fn, cancelled: false };
    list.push(task);
    return () => {
      task.cancelled = true;
    };
  };

  const service: ModalServiceInternals = createModalService({
    docs,
    editor: {
      // A realized model only: a queued one is `hasModel` for the real editor, not `model`.
      model: (id) => (lines.has(id) && !queued.has(id) ? ({} as never) : undefined),
      getLineCount: (id) => {
        reads.getLineCount++;
        return lines.get(id)?.length ?? 0;
      },
      getLines: (id, from, to) => {
        reads.getLines++;
        return (lines.get(id) ?? []).slice(Math.max(1, from) - 1, to);
      },
      onDidChangeContent: (cb) => {
        onContent = cb;
        return () => (onContent = () => {});
      },
      onDidCreateModel: (cb) => {
        onCreate = cb;
        return () => (onCreate = () => {});
      },
    },
    effective: (id) => {
      effectiveCalls++;
      return views.has(id) ? (views.get(id) ?? null) : MILL;
    },
    machineRevision,
    profileRevision,
    idle: (fn) => queue(idle, fn),
    schedule: (fn) => queue(timers, fn),
    every: 10,
    budgetMs: o.budgetMs,
  });
  const stop = service.start();

  /** Runs one idle callback; false when none was queued. */
  function idleOnce(): boolean {
    const task = idle.shift();
    if (task === undefined) return false;
    if (!task.cancelled) task.fn();
    return true;
  }

  return {
    docs,
    service,
    lines,
    views,
    machineRevision,
    profileRevision,
    queued,
    reads,
    /** Fires the created-model event for `id` (Monaco attached and realized its queued model). */
    created: (id: DocId) => onCreate(id),
    stop,
    effectiveCalls: () => effectiveCalls,
    add(text: string[], o: { model?: boolean; activate?: boolean; path?: string | null } = {}): DocId {
      const id = docs.add({ ...META, path: o.path ?? null }, { activate: o.activate ?? true });
      if (o.model !== false) {
        lines.set(id, text);
        onCreate(id);
      }
      return id;
    },
    createModel(id: DocId, text: string[]): void {
      lines.set(id, text);
      onCreate(id);
    },
    /** An edit event with explicit spans (several changes of one event: the span starts at the lowest). */
    spanEdit(id: DocId, startLine: number, apply: (own: string[]) => void): void {
      const own = lines.get(id) as string[];
      const oldCount = own.length;
      apply(own);
      onContent(id, { startLine, endLineOld: oldCount, endLineNew: own.length, flush: false, versionId: ++version });
    },
    /** Replaces line `line` (1-based) with `text`, or inserts it when `insert` is set. */
    edit(id: DocId, line: number, text: string, insert = false): void {
      const own = lines.get(id) as string[];
      if (insert) own.splice(line - 1, 0, text);
      else own[line - 1] = text;
      onContent(id, { startLine: line, endLineOld: line, endLineNew: insert ? line + 1 : line, flush: false, versionId: ++version });
    },
    setText(id: DocId, text: string[]): void {
      lines.set(id, text);
      onContent(id, { startLine: 1, endLineOld: 1, endLineNew: text.length, flush: true, versionId: ++version });
    },
    idleOnce,
    /** Runs every idle callback until nothing is queued; the number that ran. */
    idleAll(): number {
      let ran = 0;
      while (idleOnce()) ran++;
      return ran;
    },
    idlePending: () => idle.filter((task) => !task.cancelled).length,
    /** Runs the pending timers (the key check after an edit). */
    timers(): void {
      for (const task of timers.splice(0)) if (!task.cancelled) task.fn();
    },
  };
}
