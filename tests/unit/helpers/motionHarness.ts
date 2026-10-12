// A fake editor, modal service, animation frame and timers around the real `createMotionColors`, and a mill
// program for it: shared by `motionColors.test.ts` and `motionColors.slow.test.ts` in src/lib/monaco.

import { writable } from 'svelte/store';
import { loadCodeDb } from '$lib/core/codes/load';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import { applyMachine, noMachine } from '$lib/core/machines/effective';
import { ModalIndex } from '$lib/core/nc/modal';
import { compileProfile } from '$lib/core/profiles/compile';
import { resolveProfiles } from '$lib/core/profiles/resolve';
import { validateProfile } from '$lib/core/profiles/validate';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_SOURCES } from '$lib/data/profiles';
import {
  createMotionColors,
  type MotionColorsDeps,
  type MotionDecoration,
  type MotionEditor,
  type MotionView,
} from '$lib/monaco/motionColors';
import type { Profile } from '$lib/core/profiles/types';
import type { ContentChange, DocId, DocMeta } from '$lib/app/types';

export const PROFILES = new Map<string, Profile>(
  resolveProfiles(BUILTIN_PROFILE_SOURCES).resolved.map((entry) => {
    const checked = validateProfile(entry.profile);
    if (!checked.ok) throw new Error(checked.errors.join('; '));
    return [checked.profile.id, checked.profile];
  }),
);
export const CODE_DBS = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, problem) => {
  throw new Error(`${dialect}: ${problem.path}: ${problem.message}`);
});

export function viewOf(profileId: string): MotionView {
  const profile = PROFILES.get(profileId) as Profile;
  const applied = applyMachine(profile, noMachine(profile));
  return { cp: compileProfile(applied.profile), db: loadCodeDb(CODE_DBS[applied.codes]) };
}

export const MILL = viewOf('fanuc-gcode');
export const KLARTEXT = viewOf('heidenhain-klartext');

/** A mill program of `n` lines: a rapid, a feed move, an arc and a comment, over and over. */
export function millProgram(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    switch (i % 5) {
      case 0:
        out.push(i === 0 ? 'G90 G0 X0 Y0' : `G0 X${i % 90}. Y${i % 70}.`);
        break;
      case 1:
        out.push(`G1 Z-${(i % 9) + 1}. F200.`);
        break;
      case 2:
        out.push(`X${(i % 80) + 1}.`);
        break;
      case 3:
        out.push(`G2 X${(i % 80) + 2}. Y${i % 60}. I1. J0.`);
        break;
      default:
        out.push('M8 (COOLANT)');
    }
  }
  return out;
}

export interface Harness {
  deps: MotionColorsDeps;
  lines: { current: string[] };
  /** What the collection was last set to, and how often. */
  sets: MotionDecoration[][];
  clears: { count: number };
  visible: { first: number; last: number };
  enabled: ReturnType<typeof writable<boolean>>;
  theme: ReturnType<typeof writable<'light' | 'dark'>>;
  changed: ReturnType<typeof writable<number>>;
  /** `modal.revisionOf` of every document. */
  revision: { value: number };
  /** The index moved in a way a mark can show: the revision and `changed` both move. */
  reach(): void;
  machineRevision: ReturnType<typeof writable<number>>;
  docsList: ReturnType<typeof writable<DocMeta[]>>;
  statesCalls: { first: number; last: number }[];
  effectiveCalls: { count: number };
  props: Map<string, string>;
  frames: (() => void)[];
  timers: { fn: () => void; ms: number }[];
  runFrames(): void;
  fireTimers(): void;
  scrollTo(first: number, last: number): void;
  edit(): void;
  setStatesNull(value: boolean): void;
  swapEditor(): FakeEditor;
  instances: FakeEditor[];
  active: { id: DocId | null };
  model: { current: object | undefined };
  profileIdOf: { current: string };
  nc: { current: boolean };
  view: { current: MotionView };
  hooks: { scroll: Set<() => void>; layout: Set<() => void>; model: Set<() => void>; content: Set<(id: DocId, c: ContentChange) => void>; activate: Set<(id: DocId | null) => void>; attach: Set<() => void> };
}

export interface FakeEditor extends MotionEditor {
  collectionSets: MotionDecoration[][];
  hookCount(): number;
}

export function doc(id: DocId, profileId: string): DocMeta {
  return { id, profileId, path: null, title: id } as unknown as DocMeta;
}

export function harness(program: string[], o?: { view?: MotionView; index?: ModalIndex; visible?: { first: number; last: number } }): Harness {
  const lines = { current: program };
  const sets: MotionDecoration[][] = [];
  const clears = { count: 0 };
  const visible = o?.visible ?? { first: 400, last: 420 };
  const enabled = writable(true);
  const theme = writable<'light' | 'dark'>('dark');
  const changed = writable(0);
  const revision = { value: 1 };
  const machineRevision = writable(0);
  const docsList = writable<DocMeta[]>([doc('a', 'fanuc-gcode')]);
  const statesCalls: { first: number; last: number }[] = [];
  const effectiveCalls = { count: 0 };
  const props = new Map<string, string>();
  const frames: (() => void)[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const active: { id: DocId | null } = { id: 'a' };
  const model: { current: object | undefined } = { current: {} };
  const profileIdOf = { current: 'fanuc-gcode' };
  const nc = { current: true };
  const view = { current: o?.view ?? MILL };
  let statesNull = false;
  let built: { view: MotionView; index: ModalIndex } | null = null;
  const hooks: Harness['hooks'] = { scroll: new Set(), layout: new Set(), model: new Set(), content: new Set(), activate: new Set(), attach: new Set() };
  const instances: FakeEditor[] = [];

  function makeEditor(): FakeEditor {
    const editorHooks = { count: 0 };
    const collectionSets: MotionDecoration[][] = [];
    const hook = (set: Set<() => void>) => (cb: () => void) => {
      set.add(cb);
      editorHooks.count++;
      return {
        dispose: () => {
          set.delete(cb);
          editorHooks.count--;
        },
      };
    };
    return {
      collectionSets,
      hookCount: () => editorHooks.count,
      getModel: () => model.current,
      getVisibleRanges: () => (model.current === undefined ? [] : [{ startLineNumber: visible.first, endLineNumber: visible.last }]),
      onDidScrollChange: hook(hooks.scroll),
      onDidLayoutChange: hook(hooks.layout),
      onDidChangeModel: hook(hooks.model),
      createDecorationsCollection: () => ({
        set: (decorations) => {
          sets.push(decorations);
          collectionSets.push(decorations);
        },
        clear: () => {
          clears.count++;
        },
      }),
    };
  }
  instances.push(makeEditor());

  const deps: MotionColorsDeps = {
    editor: {
      getLines: (_id, from, to) => lines.current.slice(from - 1, to),
      getLineCount: () => lines.current.length,
      onDidAttach: (cb) => {
        hooks.attach.add(cb);
        return () => hooks.attach.delete(cb);
      },
      onDidActivate: (cb) => {
        hooks.activate.add(cb);
        return () => hooks.activate.delete(cb);
      },
      onDidChangeContent: (cb) => {
        hooks.content.add(cb);
        return () => hooks.content.delete(cb);
      },
      model: () => model.current,
      editorInstance: () => instances[instances.length - 1],
    },
    docs: {
      getActiveId: () => active.id,
      get: (id) => (id === 'a' ? doc('a', profileIdOf.current) : undefined),
      list: { subscribe: docsList.subscribe },
    },
    modal: {
      statesAfter: (_id, first, last) => {
        statesCalls.push({ first, last });
        if (statesNull) return null;
        if (o?.index !== undefined) return o.index.statesAfter(first, last);
        if (built === null || built.view !== view.current) built = { view: view.current, index: fakeIndex(lines.current, view.current) };
        return built.index.statesAfter(first, last);
      },
      changed: { subscribe: changed.subscribe },
      revisionOf: () => revision.value,
    },
    effective: () => {
      effectiveCalls.count++;
      return view.current;
    },
    isNc: () => nc.current,
    enabled: { subscribe: enabled.subscribe },
    theme: { subscribe: theme.subscribe },
    machineRevision: { subscribe: machineRevision.subscribe },
    frame: (fn) => {
      frames.push(fn);
      return () => {
        const at = frames.indexOf(fn);
        if (at >= 0) frames.splice(at, 1);
      };
    },
    schedule: (fn, ms) => {
      const timer = { fn, ms };
      timers.push(timer);
      return () => {
        const at = timers.indexOf(timer);
        if (at >= 0) timers.splice(at, 1);
      };
    },
    setProperty: (name, value) => {
      props.set(name, value);
    },
  };

  return {
    deps,
    lines,
    sets,
    clears,
    visible,
    enabled,
    theme,
    changed,
    revision,
    reach() {
      revision.value++;
      changed.update((n) => n + 1);
    },
    machineRevision,
    docsList,
    statesCalls,
    effectiveCalls,
    props,
    frames,
    timers,
    runFrames() {
      const pending = frames.splice(0);
      for (const fn of pending) fn();
    },
    fireTimers() {
      const pending = timers.splice(0);
      for (const timer of pending) timer.fn();
    },
    scrollTo(first, last) {
      visible.first = first;
      visible.last = last;
      for (const cb of [...hooks.scroll]) cb();
    },
    edit() {
      for (const cb of [...hooks.content]) cb('a', { startLine: 1, endLine: 1 } as unknown as ContentChange);
    },
    setStatesNull(value) {
      statesNull = value;
    },
    swapEditor() {
      const next = makeEditor();
      instances.push(next);
      for (const cb of [...hooks.attach]) cb();
      return next;
    },
    instances,
    active,
    model,
    profileIdOf,
    nc,
    view,
    hooks,
  };
}

/** A built index over `lines`, ready; the states are real. */
export function fakeIndex(lines: string[], view: MotionView): ModalIndex {
  const index = new ModalIndex(view.cp, view.db);
  index.reset(lines.length, (n) => lines[n - 1]);
  while (!index.buildSome(1000)) {
    /* build to the end */
  }
  return index;
}

/** The lines marked by the last `set`, with their classes. */
export function marked(h: Harness): Map<number, string> {
  const last = h.sets[h.sets.length - 1] ?? [];
  return new Map(last.map((d) => [d.range.startLineNumber, d.options.linesDecorationsClassName]));
}

export function started(h: Harness): { stop: () => void; colors: ReturnType<typeof createMotionColors> } {
  const colors = createMotionColors(h.deps);
  const stop = colors.start();
  return { stop, colors };
}
