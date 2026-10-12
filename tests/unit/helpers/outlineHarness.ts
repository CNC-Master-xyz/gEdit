// A fake editor and clock around the real outline service, and a big two-channel program for it: shared by
// `outlineService.test.ts` and `outlineService.slow.test.ts` in src/lib/app.

import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { createDocumentStore } from '$lib/stores/documents';
import { createOutlineService, type OutlineServiceDeps, type OutlineServiceInternals } from '$lib/app/outlineService';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { ChannelSet } from '$lib/core/channels/types';
import type { ContentChange, Disposable, DocId, DocumentStore, Eol, FileEncoding, NewDocMeta } from '$lib/app/types';

export const FANUC = 'fanuc-gcode';
export const KLARTEXT = 'heidenhain-klartext';

export const COMPILED = new Map<string, CompiledProfile>(
  BUILTIN_PROFILE_JSON.map((raw) => {
    const checked = validateProfile(raw);
    if (!checked.ok) throw new Error(checked.errors.join('; '));
    const cp = compileProfile(checked.profile);
    return [cp.profile.id, cp] as const;
  }),
);

/** A queued `setTimeout`, so a test can run the timers by hand. */
export interface Task {
  fn: () => void;
  ms: number;
  cancelled: boolean;
}

/**
 * The fake clock of the first build's time budget (B1 B2): every reading moves it on by
 * `tick` ms. At 10 ms a reading finds the 8 ms budget spent, so a slice reads one run of
 * `chunkLines` lines (the behaviour these tests were written for); a smaller tick lets a
 * slice read several.
 */
export interface Clock {
  tick: number;
  at: number;
  reads: number;
  /** ms the clock moves on for every line the build reads (the cost of classifying it). */
  perLine: number;
}

export interface Harness {
  docs: DocumentStore;
  outline: OutlineServiceInternals;
  /** Adds a document with `text` and returns its id. */
  add(text: string, profileId?: string): DocId;
  setText(id: DocId, text: string, change?: Partial<ContentChange>): void;
  /** Replaces one line and fires the matching change event. */
  edit(id: DocId, line: number, text: string): void;
  createModel(id: DocId): void;
  /** Runs every queued task, repeatedly, until nothing is left (the whole build). */
  flush(): number;
  /** Runs only the tasks queued with `ms === 0` (the build slices), once. */
  runChunks(): number;
  pending(): number;
  clock: Clock;
  /** The slices queued on the idle scheduler (only with `idleQueue`). */
  idleTasks: Task[];
  /** The slices queued for the next turn of the event loop (only with `turnQueue`). */
  turnTasks: Task[];
  /** `inputPending()` answers this (only with `turnQueue`). */
  input: { pending: boolean };
  /** Every `getLines(from, to)` the build asked, in order. */
  reads: [number, number][];
  /**
   * Runs the next slice the way the event loop would and says where it came from: the idle
   * scheduler, the next turn, or a zero timer. `null` when none is queued.
   */
  nextSlice(): 'idle' | 'turn' | 'timer' | null;
  /** The timers queued with `ms > 0` that are not the 150 ms publish: what the pause is made of. */
  waits(): number[];
  stop: Disposable;
}

export const META: NewDocMeta = {
  path: null,
  untitledIndex: 1,
  profileId: FANUC,
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

export function harness(over: Partial<OutlineServiceDeps> & { idleQueue?: boolean; turnQueue?: boolean } = {}): Harness {
  const { idleQueue = false, turnQueue = false, ...overrides } = over;
  const docs = createDocumentStore({ caseInsensitivePaths: false });
  const clock: Clock = { tick: 10, at: 0, reads: 0, perLine: 0 };
  const idleTasks: Task[] = [];
  const turnTasks: Task[] = [];
  const input = { pending: false };
  const reads: [number, number][] = [];
  const lines = new Map<DocId, string[]>();
  const tasks: Task[] = [];
  let onContent: (id: DocId, change: ContentChange) => void = () => {};
  let onCreate: (id: DocId) => void = () => {};
  let version = 1;

  const deps: OutlineServiceDeps = {
    docs,
    editor: {
      hasModel: (id) => lines.has(id),
      getLineCount: (id) => lines.get(id)?.length ?? 0,
      getLines: (id, from, to) => {
        const read = (lines.get(id) ?? []).slice(Math.max(1, from) - 1, to);
        reads.push([from, to]);
        clock.at += clock.perLine * read.length;
        return read;
      },
      onDidChangeContent: (cb) => {
        onContent = cb;
        return () => {
          onContent = () => {};
        };
      },
      onDidCreateModel: (cb) => {
        onCreate = cb;
        return () => {
          onCreate = () => {};
        };
      },
    },
    // The document's effective view (AD-31). Without a machine the key is the profile id,
    // so a profile switch still rebuilds the index — and so does a machine switch, which
    // is what the key is there for.
    effective: (id: DocId) => {
      const profileId = docs.get(id)?.profileId;
      const cp = profileId === undefined ? undefined : COMPILED.get(profileId);
      return cp === undefined ? null : { cp, key: profileId as string };
    },
    schedule: (fn, ms) => {
      const task: Task = { fn, ms, cancelled: false };
      tasks.push(task);
      return () => {
        task.cancelled = true;
      };
    },
    now: () => {
      clock.reads++;
      return (clock.at += clock.tick);
    },
    ...(idleQueue
      ? {
          idle: (fn: () => void): Disposable => {
            const task: Task = { fn, ms: -1, cancelled: false };
            idleTasks.push(task);
            return () => {
              task.cancelled = true;
            };
          },
        }
      : {}),
    ...(turnQueue
      ? {
          nextTurn: (fn: () => void): Disposable => {
            const task: Task = { fn, ms: -2, cancelled: false };
            turnTasks.push(task);
            return () => {
              task.cancelled = true;
            };
          },
          inputPending: () => input.pending,
        }
      : {}),
    chunkLines: 4,
    delayMs: 150,
    ...overrides,
  };

  const outline = createOutlineService(deps);

  function run(only?: number): number {
    const queued = tasks.splice(0, tasks.length).filter((task) => !task.cancelled);
    let ran = 0;
    for (const task of queued) {
      if (only !== undefined && task.ms !== only) {
        tasks.push(task);
        continue;
      }
      ran++;
      task.fn();
    }
    return ran;
  }

  /** The slices of the build: on the idle scheduler when the test gave one, on a zero timer otherwise. */
  function runChunks(): number {
    const queued = [...idleTasks.splice(0, idleTasks.length), ...turnTasks.splice(0, turnTasks.length)].filter((task) => !task.cancelled);
    for (const task of queued) task.fn();
    return queued.length + run(0);
  }

  function nextSlice(): 'idle' | 'turn' | 'timer' | null {
    for (const [queue, name] of [[idleTasks, 'idle'], [turnTasks, 'turn']] as const) {
      const at = queue.findIndex((task) => !task.cancelled);
      if (at >= 0) {
        const [task] = queue.splice(at, 1);
        task.fn();
        return name;
      }
    }
    const at = tasks.findIndex((task) => !task.cancelled && task.ms === 0);
    if (at >= 0) {
      const [task] = tasks.splice(at, 1);
      task.fn();
      return 'timer';
    }
    return null;
  }

  return {
    docs,
    outline,
    stop: outline.start(),
    turnTasks,
    input,
    reads,
    nextSlice,
    waits: () => tasks.filter((task) => !task.cancelled && task.ms !== 0 && task.ms !== 150).map((task) => task.ms),
    add(text, profileId = FANUC) {
      const id = docs.add({ ...META, profileId });
      lines.set(id, text.split('\n'));
      // What the program map does when a document becomes the active one, and what
      // starts the index (AD-12: after the first render).
      outline.items(id);
      return id;
    },
    setText(id, text, change) {
      const before = lines.get(id)?.length ?? 0;
      lines.set(id, text.split('\n'));
      onContent(id, {
        startLine: 1,
        endLineOld: Math.max(before, 1),
        endLineNew: text.split('\n').length,
        flush: true,
        versionId: ++version,
        ...change,
      });
    },
    edit(id, line, text) {
      const own = lines.get(id) ?? [];
      own[line - 1] = text;
      onContent(id, { startLine: line, endLineOld: line, endLineNew: line, flush: false, versionId: ++version });
    },
    createModel(id) {
      onCreate(id);
    },
    flush() {
      let total = 0;
      for (let i = 0; i < 1000 && (tasks.some((task) => !task.cancelled) || idleTasks.some((task) => !task.cancelled) || turnTasks.some((task) => !task.cancelled)); i++) {
        total += runChunks();
        total += run();
      }
      return total;
    },
    runChunks,
    clock,
    idleTasks,
    pending() {
      return (
        tasks.filter((task) => !task.cancelled).length +
        idleTasks.filter((task) => !task.cancelled).length +
        turnTasks.filter((task) => !task.cancelled).length
      );
    },
  };
}

/** Two sections of `perChannel` lines each, a wait every 15th line, a tool every 3,000th. */
export function big(perChannel: number): { lines: string[]; set: ChannelSet } {
  const lines = ['%'];
  const marks: ChannelSet['marks'] = [];
  const ranges: { startLine: number; endLine: number }[] = [];
  for (const channel of ['1', '2']) {
    const start = lines.length + 1;
    lines.push(`O210${channel}`);
    for (let i = 1; i <= perChannel; i++) {
      if (i % 3000 === 1) lines.push(`T0${channel}01 M6`);
      else if (i % 15 === 0) {
        lines.push(`M${900 + (i % 100)} P12`);
        marks.push({ ruleId: 'w', mark: `M${900 + (i % 100)}`, line: lines.length, channel, partners: [channel === '1' ? '2' : '1'], blocking: true });
      } else lines.push(`G01 X${i % 80}.25 Z-1. F0.2`);
    }
    ranges.push({ startLine: start, endLine: lines.length });
  }
  const set: ChannelSet = {
    layout: 'single-file',
    self: null,
    members: [
      { kind: 'section', channel: { id: '1', name: 'Channel 1', index: 0 }, docId: 'd', ranges: [ranges[0]] },
      { kind: 'section', channel: { id: '2', name: 'Channel 2', index: 1 }, docId: 'd', ranges: [ranges[1]] },
    ],
    missing: [],
    outside: [{ startLine: 1, endLine: 1 }],
    marks,
    problems: [],
    truncated: false,
  };
  return { lines, set };
}
