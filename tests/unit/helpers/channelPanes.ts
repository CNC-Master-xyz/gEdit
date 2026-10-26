// Test support for the channel view (Phase 4 plan §6.7; P4.22b): the real editor service on a fake
// Monaco whose models are the editor's own text models (`monaco/realModel.ts`: edits, undo and the
// version ids are Monaco's), a real channel service resolving real programs under a machine with
// channels, and the channel view on top. The editors are the fake ones of `editorGroups.ts`, with a
// scroll listener, `getScrollTop` and `changeViewZones` added.
//
// Not imported by the app.

import { writable } from 'svelte/store';
import { createChannelPanes, type ChannelPanesDeps } from '$lib/monaco/channelPanes';
import { editKeepsChannels } from '$lib/core/channels/touch';
import { createEditorService } from '$lib/monaco/editorService';
import { realModel } from '$lib/monaco/realModel';
import { createChannelService, type EffectiveView } from '$lib/stores/channels';
import { createDocumentStore } from '$lib/stores/documents';
import { cpOf } from './profiles';
import { groupMonaco, type FakeEditor, type FakeMonacoState } from './editorGroups';
import type { PaneHistory } from '$lib/monaco/editorService';
import type { ChannelParams, SyncRule } from '$lib/core/channels/types';
import type { MachineConfig } from '$lib/core/machines/types';
import type { DocId, EditorService, GroupId, NewDocMeta } from '$lib/app/types';
import type * as MonacoApi from 'monaco-editor/esm/vs/editor/editor.api.js';

type ITextModel = MonacoApi.editor.ITextModel;
import type { Monaco } from '$lib/monaco/setup';

/** A fake group editor with what the channel view asks of a real one. */
export interface PaneEditor extends FakeEditor {
  /** The view zones: id → what `addZone` was given. */
  zones: Map<string, { afterLineNumber: number; heightInLines: number; domNode: FakeNode }>;
  scrollListeners: ((e: { scrollTop: number; scrollTopChanged: boolean }) => void)[];
  getScrollTop(): number;
  /** The decorations the view put on the editor, the last `set`. */
  marks(): { range: { startLineNumber: number }; options: Record<string, unknown> }[];
}

/** A hover provider as the view registers it. */
export interface HoverRegistration {
  language: string;
  provider: { provideHover(model: unknown, position: { lineNumber: number; column: number }): { range: unknown; contents: { value: string; isTrusted?: boolean; supportHtml?: boolean }[] } | null | undefined };
}

export interface FakeNode {
  className: string;
  attrs: Record<string, string>;
  setAttribute(name: string, value: string): void;
}

export const fakeNode = (): FakeNode => ({
  className: '',
  attrs: {},
  setAttribute(name, value) {
    this.attrs[name] = value;
  },
});

function augment(ed: FakeEditor): PaneEditor {
  const pane = ed as PaneEditor;
  pane.zones = new Map();
  pane.scrollListeners = [];
  let seq = 0;
  pane.onDidScrollChange = (cb) => {
    pane.scrollListeners.push(cb as never);
    return { dispose: () => void pane.scrollListeners.splice(pane.scrollListeners.indexOf(cb as never), 1) };
  };
  pane.setScrollTop = (top: number) => {
    const changed = pane.scrollTop !== top;
    pane.scrollTop = top;
    if (changed) for (const cb of [...pane.scrollListeners]) cb({ scrollTop: top, scrollTopChanged: true });
  };
  pane.getScrollTop = () => pane.scrollTop;
  (pane as unknown as { changeViewZones(cb: (accessor: unknown) => void): void }).changeViewZones = (cb) => {
    cb({
      addZone(zone: { afterLineNumber: number; heightInLines: number; domNode: FakeNode }) {
        const id = `z${++seq}`;
        pane.zones.set(id, zone);
        return id;
      },
      removeZone: (id: string) => pane.zones.delete(id),
      layoutZone: () => {},
    });
  };
  pane.marks = () => (pane.collectionSets.at(-1) ?? []) as never;
  return pane;
}

/** The fake Monaco of the groups, with real text models and the augmented editors. */
export function paneMonaco(): { api: Monaco; state: FakeMonacoState; hovers: HoverRegistration[] } {
  const { api, state } = groupMonaco();
  // The hover providers the view registers (`monaco.languages.registerHoverProvider`), the live ones in registration order.
  const hovers: HoverRegistration[] = [];
  (api as unknown as { languages: unknown }).languages = {
    registerHoverProvider(language: string, provider: HoverRegistration['provider']) {
      const entry = { language, provider };
      hovers.push(entry);
      return { dispose: () => void hovers.splice(hovers.indexOf(entry), 1) };
    },
  };
  const editor = (api as unknown as { editor: Record<string, unknown> }).editor;
  const create = editor.create as (element: unknown, options: Record<string, unknown>) => FakeEditor;
  editor.create = (element: unknown, options: Record<string, unknown>) => augment(create(element, options));
  editor.createModel = (text: string, _language: string, uri: { value: string }) => {
    const model = realModel(text) as unknown as { dispose(): void; uri: unknown };
    const dispose = model.dispose.bind(model);
    state.models.set(uri.value, model as never);
    model.dispose = () => {
      state.models.delete(uri.value);
      dispose();
    };
    return model;
  };
  return { api, state, hovers };
}

// -- a machine with channels ------------------------------------------------------------------

export const WAIT_RULE: SyncRule = {
  id: 'wait',
  label: 'Waits',
  match: { kind: 'codes', codes: 'M900-M999' },
  partners: { kind: 'word', address: 'P', decode: 'digits', whenAbsent: { kind: 'none' } },
  samePartners: true,
};

const NAMES = ['Turret A', 'Turret B', 'Turret C', 'Turret D', 'Turret E', 'Turret F'];

/** `n` channels in one program: a line `CH<n>` starts the section of channel `n`. */
export function sectionParams(n: number): ChannelParams {
  return {
    layout: 'single-file',
    list: NAMES.slice(0, n).map((name, i) => ({ id: String(i + 1), name })),
    sectionStart: `^CH(?<channel>[1-${n}])$`,
    syncMarks: [WAIT_RULE],
  };
}

/** `n` channels with one file each: `PART_CH1.nc`, `PART_CH2.nc`, … */
export function fileParams(n: number): ChannelParams {
  return {
    layout: 'multi-file',
    list: NAMES.slice(0, n).map((name, i) => ({ id: String(i + 1), name })),
    fileName: '^(?<stem>.+)_CH(?<channel>\\d+)\\.nc$',
    syncMarks: [WAIT_RULE],
  };
}

const META: NewDocMeta = {
  path: null,
  untitledIndex: 1,
  profileId: 'fanuc-lathe',
  encoding: { encoding: 'utf-8', hasBom: false },
  eol: 'lf',
  eolMixedOnLoad: false,
  nul: { leader: 0, trailer: 0, stripped: 0 },
  textDirty: false,
  metaDirty: false,
  disk: null,
  external: 'none',
  readOnly: false,
  readOnlyReason: null,
};

export interface PaneWorld {
  docs: ReturnType<typeof createDocumentStore>;
  api: Monaco;
  state: FakeMonacoState;
  editor: EditorService;
  channels: ReturnType<typeof createChannelService>;
  panes: ReturnType<typeof createChannelPanes>;
  /** What the status bar was told, in order: `[text, error]`. */
  said: [string, boolean][];
  /** The tasks the channel service's debounce timers wait for. */
  timers: (() => void)[];
  /** The undo/redo route the view registered with the editor service, if any. */
  history(): PaneHistory | undefined;
  /** A document with `text` under the machine; `path` makes it a file of a set. */
  addDoc(text: string, o?: { path?: string; activate?: boolean }): DocId;
  /** The live fake editor of group `id`, mounted if it was not. */
  mount(id: GroupId): Promise<PaneEditor>;
  editorOf(id: GroupId): PaneEditor;
  /** The hover providers registered now (the view's wait hovers). */
  hovers: HoverRegistration[];
  /** What the wait hovers say for line `line` of the model shown in group `group` (every provider asked, in order); empty when none has anything to say. */
  hover(group: GroupId, line: number): string[];
  /** The real model of a document. */
  model(id: DocId): ITextModel;
  /** The text of a document, LF-joined. */
  text(id: DocId): string;
  /** The pane model text of group `id`. */
  paneText(id: GroupId): string;
  /** Replaces text in the model of `id` as a typed edit would (an edit that joins the open undo element). */
  type(model: ITextModel, line: number, column: number, text: string, endColumn?: number): void;
  /** Mounts every group the view opened, in order. */
  mountAll(): Promise<PaneEditor[]>;
  /** The machine's channel layout changed (another machine, or the same one edited). */
  switchMachine(next: ChannelParams | null): void;
}

/** The world: documents, the editor service, a real channel service under `params` and the channel view. */
export async function paneWorld(params: ChannelParams | null, o: { cp?: string; viewDeps?: Partial<ChannelPanesDeps>; now?: () => number } = {}): Promise<PaneWorld> {
  const docs = createDocumentStore({ caseInsensitivePaths: false });
  const { api, state, hovers } = paneMonaco();
  let registered: PaneHistory | undefined;
  const editor = createEditorService({ docs, loadMonaco: async () => api, paneHistory: () => registered });
  const timers: (() => void)[] = [];
  const cp = cpOf(o.cp ?? 'fanuc-lathe');
  const machine: MachineConfig = { id: 'm1', name: 'Lathe', profile: o.cp ?? 'fanuc-lathe', params: {} };
  let current = params;
  const revision = writable(0);
  const effective = (): EffectiveView => ({ cp, key: 'k', machineId: 'm1', machineName: 'Lathe' });
  const channels = createChannelService({
    docs: { get: (id) => docs.get(id), all: () => docs.all(), list: docs.list },
    editor: {
      hasModel: (id) => editor.hasModel(id),
      getLineCount: (id) => editor.getLineCount(id),
      getLines: (id, a, b) => editor.getLines(id, a, b),
      onDidChangeContent: (cb) => editor.onDidChangeContent(cb),
    },
    effective,
    machine: () => machine,
    block: () => (current === null ? { state: 'absent' } : { state: 'valid', params: current }),
    machineRevision: revision,
    memory: { get: () => undefined, remember: () => {} },
    siblingInfo: async () => [],
    schedule: (fn) => {
      timers.push(fn);
      return () => {
        const at = timers.indexOf(fn);
        if (at >= 0) timers.splice(at, 1);
      };
    },
    // A program of 300,000 lines may take the resolution past its 500 ms; the typing proof is not about that.
    now: o.now ?? (() => performance.now()),
    caseInsensitive: false,
    delayMs: 150,
  });
  channels.start();
  const said: [string, boolean][] = [];
  const deferred: (() => void)[] = [];
  const panes = createChannelPanes({
    editor,
    docs,
    channels,
    loadMonaco: async () => api,
    registerHistory: (history) => {
      registered = history;
      return () => {
        if (registered === history) registered = undefined;
      };
    },
    status: { show: (text, opts) => void said.push([text, opts?.error === true]) },
    createNode: () => fakeNode(),
    // The microtask of the app, made explicit: a test calls `panes.flush()` where the harness would wait.
    defer: (fn) => void deferred.push(fn),
    // As the app wires it: typing in an ordinary line does not ask the channel service again.
    editKeepsChannels: (_id, oldText, newText) => current !== null && editKeepsChannels(oldText, newText, cp, current),
    ...o.viewDeps,
  });

  const element = (): HTMLElement => ({}) as HTMLElement;
  const world: PaneWorld = {
    docs,
    api,
    state,
    editor,
    channels,
    panes,
    said,
    timers,
    history: () => registered,
    hovers,
    hover(group, line) {
      const model = world.editorOf(group).getModel() as unknown as ITextModel;
      const out: string[] = [];
      for (const { provider } of [...hovers]) {
        const answer = provider.provideHover(model, { lineNumber: line, column: 1 });
        for (const content of answer?.contents ?? []) out.push(content.value);
      }
      return out;
    },
    addDoc(text, opts = {}) {
      const id = docs.add({ ...META, path: opts.path ?? null, untitledIndex: opts.path ? null : META.untitledIndex }, { activate: opts.activate ?? true });
      editor.createModel(id, text, 'fanuc-lathe', 'lf');
      return id;
    },
    async mount(id) {
      await editor.attachGroup(id, element());
      return world.editorOf(id);
    },
    editorOf(id) {
      const view = editor.groupViews().find((v) => v.id === id);
      if (!view) throw new Error(`group ${id} has no editor`);
      return view.editor as unknown as PaneEditor;
    },
    model: (id) => editor.model(id) as ITextModel,
    text: (id) => (editor.model(id) as ITextModel).getValue(),
    paneText: (id) => (world.editorOf(id).getModel() as unknown as ITextModel).getValue(),
    type(model, line, column, text, endColumn) {
      (model as unknown as { pushEditOperations: (...a: unknown[]) => unknown }).pushEditOperations(
        null,
        [{ range: { startLineNumber: line, startColumn: column, endLineNumber: line, endColumn: endColumn ?? column }, text }],
        () => null,
      );
    },
    switchMachine(next) {
      current = next;
      revision.update((n) => n + 1);
    },
    async mountAll() {
      const out: PaneEditor[] = [];
      for (const group of editor.groupsState().groups) out.push(await world.mount(group.id));
      return out;
    },
  };
  // The first group is mounted by the host at startup.
  await editor.attachGroup('g1', element());
  return world;
}

/** Runs a `flush` for the view and the channel service's timers, as the app's microtask and debounce would. */
export function settle(world: PaneWorld): void {
  world.panes.flush();
}
