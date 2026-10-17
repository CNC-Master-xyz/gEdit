// Editor groups (Phase 4 plan AD-50, §6.7 rules 1–8; X29). The service is run against a fake Monaco
// (`tests/unit/helpers/editorGroups.ts`), as `editorService.test.ts` does: what is asserted is what the
// service asks of Monaco and what it answers, not Monaco's own behaviour.

import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { createDocumentStore } from '$lib/stores/documents';
import { SHARED_EDITOR_OPTIONS } from './instanceOptions';
import { FIRST_GROUP, GROUP_EDITOR_OPTIONS, MAX_GROUPS, createEditorService } from './editorService';
import { fakePane, groupMonaco, type FakeEditor, type FakeModel } from '../../../tests/unit/helpers/editorGroups';
import type { DocId, DocumentStore, EditorService, GroupId } from '$lib/app/types';
import type { Monaco } from '$lib/monaco/setup';

function addDoc(docs: DocumentStore, id: string, o: { readOnly?: boolean } = {}): DocId {
  return docs.add({
    path: `/nc/${id}.nc`,
    untitledIndex: null,
    profileId: 'fanuc-gcode',
    encoding: { encoding: 'utf-8', hasBom: false },
    eol: 'lf',
    eolMixedOnLoad: false,
    nul: { leader: 0, trailer: 0, stripped: 0 },
    textDirty: false,
    metaDirty: false,
    disk: null,
    external: 'none',
    readOnly: o.readOnly === true,
    readOnlyReason: o.readOnly === true ? 'attribute' : null,
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The service on a fake Monaco, two documents open (`a` active, 20 lines each) and the first group attached. */
async function rig(o: { paneHistory?: { undo(): void; redo(): void } } = {}) {
  const docs = createDocumentStore({ caseInsensitivePaths: false });
  const { api, state } = groupMonaco();
  const service = createEditorService({
    docs,
    loadMonaco: async () => api as Monaco,
    paneHistory: o.paneHistory === undefined ? undefined : () => o.paneHistory,
  });
  const a = addDoc(docs, 'a');
  const b = addDoc(docs, 'b');
  docs.activate(a);
  const text = (name: string): string => Array.from({ length: 20 }, (_, i) => `${name}${i + 1}`).join('\n');
  service.createModel(a, text('a'), 'fanuc-gcode', 'lf');
  service.createModel(b, text('b'), 'fanuc-gcode', 'lf');
  const element = (): HTMLElement => ({}) as HTMLElement;
  await service.attachGroup('g1', element());
  /** Attaches the second (and further) group's editor, as the mounted `EditorGroup` does. */
  const mount = async (...ids: GroupId[]): Promise<FakeEditor[]> => {
    for (const id of ids) await service.attachGroup(id, element());
    return state.editors.filter((e) => !e.disposed);
  };
  const modelOf = (id: DocId): FakeModel => state.models.get(`inmemory://doc/${id}`) as FakeModel;
  return { docs, state, service, a, b, mount, modelOf, element };
}

/** The live editor of a group, found through `groupViews()`. */
function editorOf(service: EditorService, id: GroupId): FakeEditor {
  const view = service.groupViews().find((v) => v.id === id);
  if (!view) throw new Error(`group ${id} has no editor`);
  return view.editor as unknown as FakeEditor;
}

describe('group editors are built without a theme (F118, §6.7 rule 1)', () => {
  it('have no `theme` among their construction options', () => {
    expect(GROUP_EDITOR_OPTIONS).not.toHaveProperty('theme');
  });

  it('share the options every gEdit editor is built with', () => {
    expect(GROUP_EDITOR_OPTIONS).toMatchObject(SHARED_EDITOR_OPTIONS);
    expect(GROUP_EDITOR_OPTIONS).toMatchObject({ model: null, automaticLayout: true });
  });
});

describe('the one-group truth (§6.7 rule 2)', () => {
  it('has one group, g1, showing the active document', async () => {
    const docs = createDocumentStore({ caseInsensitivePaths: false });
    const service = createEditorService({ docs, loadMonaco: () => new Promise<Monaco>(() => {}) });
    expect(MAX_GROUPS).toBe(4);
    expect(service.groupsState()).toEqual({ layout: 'single', groups: [{ id: FIRST_GROUP, content: null }], focused: FIRST_GROUP });
    const id = addDoc(docs, 'a');
    expect(get(service.groups).groups[0].content).toEqual({ kind: 'document', docId: id });
    expect(service.groupViews()).toEqual([]); // no editor yet
  });
});

describe('editor groups (P4.21)', () => {
  // Rule 1: creation and options.
  it('builds every group editor after the first with GROUP_EDITOR_OPTIONS, then replays the shared updateOptions payload, then the group’s own overrides', async () => {
    const h = await rig();
    h.service.updateOptions({ theme: 'vs', fontSize: 22 });
    h.service.updateOptions({ glyphMargin: true });
    const locked = addDoc(h.docs, 'locked', { readOnly: true });
    h.service.createModel(locked, 'x\ny', 'fanuc-gcode', 'lf');
    h.service.openGroups({ layout: 'side-by-side', contents: [{ kind: 'document', docId: h.a }, { kind: 'document', docId: locked }] });
    const [first, second] = await h.mount('g2');

    expect(first.createdWith.theme).toBe('vs-dark'); // the first editor keeps EDITOR_OPTIONS
    expect(second.createdWith).not.toHaveProperty('theme');
    expect(second.createdWith).toMatchObject(SHARED_EDITOR_OPTIONS);
    // The payload so far, merged, minus the theme the first editor already handed over; then the group's lock.
    expect(second.optionUpdates).toHaveLength(2);
    expect(second.optionUpdates[0]).toEqual({ fontSize: 22, glyphMargin: true });
    expect(second.optionUpdates[1]).toMatchObject({ readOnly: true });
    // The group's editor shows the group's document.
    expect(second.getModel()?.uri).toBe(`inmemory://doc/${locked}`);
    // Not the first group: its document is not locked.
    expect(first.effective().readOnly).not.toBe(true);
  });

  it('re-applies each group’s own overrides (readOnly, lineNumbers, wordWrap) after every shared updateOptions call', async () => {
    const h = await rig();
    const locked = addDoc(h.docs, 'locked', { readOnly: true });
    h.service.createModel(locked, 'x\ny', 'fanuc-gcode', 'lf');
    const pane = fakePane(h.a, 'ch1', [1, 2, 10, 11]);
    h.service.registerPane(pane);
    h.service.openGroups({
      layout: 'channels',
      contents: [{ kind: 'pane', docId: h.a, channelId: 'ch1' }, { kind: 'document', docId: locked }, { kind: 'document', docId: h.b }],
    });
    const [first, second, third] = await h.mount('g2', 'g3');
    expect(first.getModel()).toBe(pane.fake);
    expect(first.effective().wordWrap).toBe('off');
    expect(typeof first.effective().lineNumbers).toBe('function');
    expect((first.effective().lineNumbers as (n: number) => string)(3)).toBe('10');

    // Settings change: the shared payload reaches every editor, the last writer is whoever came last.
    h.service.updateOptions({ wordWrap: 'on', lineNumbers: 'on', fontSize: 18 });

    expect(first.effective().wordWrap).toBe('off'); // the pane keeps its own
    expect((first.effective().lineNumbers as (n: number) => string)(4)).toBe('11');
    expect(second.effective().readOnly).toBe(true); // the locked document stays locked
    expect(third.effective().readOnly).not.toBe(true);
    expect(second.effective().wordWrap).toBe('off'); // the channel view is off for every group (CODE-3: a channel file too)
    expect(third.effective().wordWrap).toBe('off');
    expect(third.effective().fontSize).toBe(18);
    // and the user switching line numbers off is respected in a pane too
    h.service.updateOptions({ lineNumbers: 'off' });
    expect(first.effective().lineNumbers).toBe('off');
  });

  it('turns word wrap off in every group of the channel view, pane or channel file, and gives the user’s setting back after it (CODE-3)', async () => {
    const h = await rig();
    h.service.updateOptions({ wordWrap: 'on' });
    const pane = fakePane(h.a, 'ch1', [1, 2, 3]);
    h.service.registerPane(pane);
    // One file per channel: the groups show documents.
    h.service.openGroups({ layout: 'channels', contents: [{ kind: 'document', docId: h.a }, { kind: 'document', docId: h.b }] });
    const [first, second] = await h.mount('g2');
    expect(first.effective().wordWrap).toBe('off');
    expect(second.effective().wordWrap).toBe('off');
    // The user changes the setting while the view is open: the view keeps its rows aligned.
    h.service.updateOptions({ wordWrap: 'on', fontSize: 17 });
    expect(first.effective().wordWrap).toBe('off');
    expect(second.effective().wordWrap).toBe('off');
    expect(second.effective().fontSize).toBe(17);
    // Panes of a program with sections too, and then back to the user's setting.
    h.service.openGroups({ layout: 'channels', contents: [{ kind: 'pane', docId: h.a, channelId: 'ch1' }, { kind: 'document', docId: h.b }] });
    expect(editorOf(h.service, 'g1').effective().wordWrap).toBe('off');
    h.service.closeGroups();
    expect(editorOf(h.service, 'g1').effective().wordWrap).toBe('on');
    // A split view is not the channel view: the user's setting stays.
    h.service.openGroups({ layout: 'side-by-side', contents: [{ kind: 'document', docId: h.a }, { kind: 'document', docId: h.b }] });
    expect(editorOf(h.service, 'g1').effective().wordWrap).toBe('on');
    expect(editorOf(h.service, 'g2').effective().wordWrap).toBe('on');
  });

  it('keeps the theme the user chose when a second group is created (the theme service is never handed vs-dark)', async () => {
    const h = await rig();
    h.service.updateOptions({ theme: 'vs' });
    expect(h.state.theme).toBe('vs');
    const handedBefore = h.state.themeHistory.length;

    h.service.openGroups({ layout: 'side-by-side', contents: [{ kind: 'document', docId: h.a }, { kind: 'document', docId: h.a }] });
    await h.mount('g2');

    expect(h.state.theme).toBe('vs');
    expect(h.state.themeHistory.slice(handedBefore)).toEqual([]);
  });

  it('leaves the theme as it was when the compare overlay unmounts every group and mounts them again', async () => {
    const h = await rig();
    h.service.openGroups({ layout: 'side-by-side', contents: [{ kind: 'document', docId: h.a }, { kind: 'document', docId: h.b }] });
    await h.mount('g2');
    h.service.updateOptions({ theme: 'vs', fontSize: 20 });

    h.service.detachGroup('g1');
    h.service.detachGroup('g2');
    await h.service.attachGroup('g1', h.element());
    await h.service.attachGroup('g2', h.element());

    expect(h.state.theme).toBe('vs'); // the first one is replayed with its theme, the second has none
    const live = h.state.editors.filter((e) => !e.disposed);
    expect(live).toHaveLength(2);
    expect(live[1].createdWith).not.toHaveProperty('theme');
    expect(live[0].effective().fontSize).toBe(20);
    expect(live[1].effective().fontSize).toBe(20);
  });

  // Rule 2: the focused group.
  it('answers the focused group’s editor from editorInstance(), and switches it on a click into another group', async () => {
    const h = await rig();
    h.service.openGroups({ layout: 'side-by-side', contents: [{ kind: 'document', docId: h.a }, { kind: 'document', docId: h.b }] });
    const [one, two] = await h.mount('g2');
    expect(h.service.editorInstance()).toBe(one); // openGroups focuses contents[0]
    expect(h.service.groupsState().focused).toBe('g1');

    two.click();

    expect(h.service.editorInstance()).toBe(two);
    expect(h.service.groupsState().focused).toBe('g2');
    expect(h.service.hasFocus()).toBe(true);
    // the commands act on the focused editor alone
    h.service.triggerAction('editor.action.commentLine');
    expect(two.triggered).toEqual(['editor.action.commentLine']);
    expect(one.triggered).toEqual([]);
  });

  it('gives the editor of a new group the keyboard focus when it is built, if the group was focused before it existed', async () => {
    const h = await rig();
    h.service.openGroups({ layout: 'side-by-side', contents: [{ kind: 'document', docId: h.a }, { kind: 'document', docId: h.a }], focus: 1 });
    const [one] = await h.mount();
    expect(h.service.groupsState().focused).toBe('g2');
    expect(h.service.editorInstance()).toBeUndefined(); // the focused group has no editor yet
    expect(one.calls).not.toContain('focus');

    const [, two] = await h.mount('g2');

    expect(two.calls).toContain('focus');
    expect(h.service.editorInstance()).toBe(two);
    expect(h.service.hasFocus()).toBe(true);
    // and the group that is not focused takes nothing from a late editor
    const other = await rig();
    other.service.openGroups({ layout: 'side-by-side', contents: [{ kind: 'document', docId: other.a }, { kind: 'document', docId: other.b }], focus: 0 });
    const [first, second] = await other.mount('g2');
    expect(second.calls).not.toContain('focus');
    expect(other.service.editorInstance()).toBe(first);
  });

  it('fires onDidFocusGroup and onDidChangeCursor (in document lines) when the focus moves', async () => {
    const h = await rig();
    h.service.openGroups({ layout: 'side-by-side', contents: [{ kind: 'document', docId: h.a }, { kind: 'document', docId: h.b }] });
    const [one, two] = await h.mount('g2');
    one.setPosition({ lineNumber: 3, column: 2 });
    two.setPosition({ lineNumber: 9, column: 4 });
    await settle();
    const focused: GroupId[] = [];
    const cursors: { line: number; column: number }[] = [];
    h.service.onDidFocusGroup((id) => focused.push(id));
    h.service.onDidChangeCursor((c) => cursors.push({ line: c.line, column: c.column }));

    two.click();
    await settle();
    expect(focused).toEqual(['g2']);
    expect(cursors).toEqual([{ line: 9, column: 4 }]);

    two.click(); // the same group again: nothing changed
    await settle();
    expect(focused).toEqual(['g2']);

    one.click();
    await settle();
    expect(focused).toEqual(['g2', 'g1']);
    expect(cursors.at(-1)).toEqual({ line: 3, column: 2 });
  });

  it('makes the focused group’s document the active document; clicking a tab shows it in the focused group', async () => {
    const h = await rig();
    const c = addDoc(h.docs, 'c');
    h.service.createModel(c, 'c1\nc2', 'fanuc-gcode', 'lf');
    h.service.openGroups({ layout: 'side-by-side', contents: [{ kind: 'document', docId: h.a }, { kind: 'document', docId: h.b }] });
    const [one, two] = await h.mount('g2');
    expect(h.docs.getActiveId()).toBe(h.a);

    two.click();
    expect(h.docs.getActiveId()).toBe(h.b); // the focused group's document is the active one

    // A tab of a document the other group shows: that group takes the focus, nothing is replaced.
    h.docs.activate(h.a);
    expect(h.service.groupsState().focused).toBe('g1');
    expect(one.getModel()?.uri).toBe(`inmemory://doc/${h.a}`);
    expect(two.getModel()?.uri).toBe(`inmemory://doc/${h.b}`);

    // A tab of a document no group shows: it opens in the focused group.
    h.docs.activate(c);
    expect(one.getModel()?.uri).toBe(`inmemory://doc/${c}`);
    expect(two.getModel()?.uri).toBe(`inmemory://doc/${h.b}`);
    expect(get(h.service.groups).groups.map((g) => g.content)).toEqual([
      { kind: 'document', docId: c },
      { kind: 'document', docId: h.b },
    ]);
  });

  // Rule 3: the coordinate rule.
  it('answers cursor(), selectionLines(), topLine() in document lines for a pane group, through its PaneSource', async () => {
    const h = await rig();
    // The pane shows the header (1, 2) and the lines 10–13 of the program.
    const pane = fakePane(h.a, 'ch2', [1, 2, 10, 11, 12, 13]);
    h.service.registerPane(pane);
    h.service.openGroups({ layout: 'channels', contents: [{ kind: 'document', docId: h.a }, { kind: 'pane', docId: h.a, channelId: 'ch2' }], focus: 1 });
    const [, paneEditor] = await h.mount('g2');
    expect(paneEditor.getModel()).toBe(pane.fake);

    paneEditor.setPosition({ lineNumber: 4, column: 5 });
    expect(h.service.cursor()).toMatchObject({ line: 11, column: 5 });

    paneEditor.setSelection({ startLineNumber: 4, startColumn: 1, endLineNumber: 5, endColumn: 3 });
    expect(h.service.selectionLines()).toEqual({ startLine: 11, endLine: 12, empty: false });

    paneEditor.visible = { first: 3, last: 6 };
    expect(h.service.topLine()).toBe(10);
    // and the other way: a document line is scrolled to in the pane's own line
    h.service.scrollToTop(12);
    expect(paneEditor.scrollTop).toBe(4 * 20); // pane line 5
    h.service.scrollToTop(5); // a line the pane does not show: nothing moves
    expect(paneEditor.scrollTop).toBe(4 * 20);
  });

  it('sets crossesJunction on a pane selection whose lines are not one run of document lines', async () => {
    const h = await rig();
    // Two sections of one channel: document lines 3–4 and 10–11 (another channel's lines in between).
    const pane = fakePane(h.a, 'ch1', [3, 4, 10, 11]);
    h.service.registerPane(pane);
    h.service.openGroups({ layout: 'channels', contents: [{ kind: 'pane', docId: h.a, channelId: 'ch1' }, { kind: 'document', docId: h.b }] });
    const [paneEditor] = await h.mount('g2');

    paneEditor.setSelection({ startLineNumber: 3, startColumn: 1, endLineNumber: 4, endColumn: 2 });
    expect(h.service.selectionLines()).toEqual({ startLine: 10, endLine: 11, empty: false }); // one run: no flag

    paneEditor.setSelection({ startLineNumber: 2, startColumn: 1, endLineNumber: 3, endColumn: 2 });
    expect(h.service.selectionLines()).toEqual({ startLine: 4, endLine: 10, empty: false, crossesJunction: true });
  });

  it('reveals and selects a document line in the group that shows it, the focused one first', async () => {
    const h = await rig();
    h.service.openGroups({ layout: 'side-by-side', contents: [{ kind: 'document', docId: h.a }, { kind: 'document', docId: h.a }], focus: 1 });
    const [one, two] = await h.mount('g2');

    h.service.reveal(h.a, 7, 3);
    expect(two.position).toEqual({ lineNumber: 7, column: 3 }); // g2 has the focus
    expect(one.position).toEqual({ lineNumber: 1, column: 1 });

    h.service.selectLines(h.a, 4, 6);
    expect(two.selection).toMatchObject({ startLineNumber: 4, startColumn: 1, endLineNumber: 6 });

    // In the channel view the pane that shows the line gets it; a line no pane shows is not revealed.
    const pane = fakePane(h.b, 'ch1', [1, 2, 10, 11]);
    h.service.registerPane(pane);
    h.service.openGroups({ layout: 'channels', contents: [{ kind: 'pane', docId: h.b, channelId: 'ch1' }, { kind: 'document', docId: h.a }] });
    const editors = h.state.editors.filter((e) => !e.disposed);
    const paneEditor = editors.find((e) => e.getModel() === pane.fake) as FakeEditor;
    h.service.reveal(h.b, 11);
    expect(paneEditor.position).toEqual({ lineNumber: 4, column: 1 });
    paneEditor.setPosition({ lineNumber: 1, column: 1 });
    h.service.reveal(h.b, 5);
    expect(paneEditor.position).toEqual({ lineNumber: 1, column: 1 });
    h.service.selectLines(h.b, 10, 11);
    expect(paneEditor.selection).toMatchObject({ startLineNumber: 3, endLineNumber: 4 });
  });

  // Rule 4: the same document in two groups.
  it('shows one model in both groups of split view; an edit in one is in the other, one undo history', async () => {
    const h = await rig();
    h.service.openGroups({ layout: 'stacked', contents: [{ kind: 'document', docId: h.a }, { kind: 'document', docId: h.a }] });
    const [one, two] = await h.mount('g2');

    expect(one.getModel()).toBe(two.getModel());
    expect(one.getModel()).toBe(h.modelOf(h.a)); // the one model of the document: its undo stack is the only one
    expect(h.state.created.filter((m) => m.uri.endsWith(`/${h.a}`))).toHaveLength(1);
    const heard: number[] = [];
    h.service.onDidChangeContent((_id, change) => heard.push(change.startLine));
    h.modelOf(h.a).edit(5, 5, ['changed in g1']);
    expect(heard).toEqual([5]);
    expect(two.getModel()?.getLineContent(5)).toBe('changed in g1');
    expect(h.service.getText(h.a).split('\n')[4]).toBe('changed in g1');
    expect(h.docs.get(h.a)?.textDirty).toBe(true);
  });

  it('keeps a view state per group and document, and restores it when the group shows the document again', async () => {
    const h = await rig();
    const c = addDoc(h.docs, 'c');
    h.docs.activate(h.a);
    h.service.createModel(c, 'c1\nc2', 'fanuc-gcode', 'lf');
    h.service.openGroups({ layout: 'side-by-side', contents: [{ kind: 'document', docId: h.a }, { kind: 'document', docId: h.b }] });
    const [one, two] = await h.mount('g2');
    one.setPosition({ lineNumber: 6, column: 2 });
    one.scrollTop = 100;
    two.setPosition({ lineNumber: 14, column: 1 });
    two.scrollTop = 260;
    const restoredBefore = one.restored.length;

    // g1 shows c (its state for a is saved), then a again: its own state comes back, not g2's.
    h.docs.activate(c);
    expect(one.getModel()?.uri).toBe(`inmemory://doc/${c}`);
    expect(two.getModel()?.uri).toBe(`inmemory://doc/${h.b}`);
    expect(one.restored).toHaveLength(restoredBefore); // c has none yet
    one.setPosition({ lineNumber: 2, column: 1 });
    h.docs.activate(h.a);
    expect(one.getModel()?.uri).toBe(`inmemory://doc/${h.a}`);
    expect(one.restored.at(-1)).toMatchObject({ position: { lineNumber: 6, column: 2 }, scrollTop: 100 });
    expect(one.position).toEqual({ lineNumber: 6, column: 2 });
    expect(two.position).toEqual({ lineNumber: 14, column: 1 });
    expect(two.restored).toHaveLength(0); // g2 was not touched
  });

  // Rule 5: attach, detach and the compare overlay.
  it('keeps every group’s view state across detachGroup / attachGroup (the compare overlay unmounts them all)', async () => {
    const h = await rig();
    h.service.openGroups({ layout: 'side-by-side', contents: [{ kind: 'document', docId: h.a }, { kind: 'document', docId: h.b }] });
    const [one, two] = await h.mount('g2');
    one.setPosition({ lineNumber: 8, column: 3 });
    one.scrollTop = 140;
    two.setPosition({ lineNumber: 12, column: 5 });
    two.scrollTop = 220;

    h.service.detachGroup('g1');
    h.service.detachGroup('g2');
    expect(one.disposed).toBe(true);
    expect(two.disposed).toBe(true);
    expect(h.service.editorInstance()).toBeUndefined();
    expect(h.service.groupViews()).toEqual([]);
    expect(h.service.groupsState().layout).toBe('side-by-side'); // the groups themselves stay
    expect(h.service.cursor()).toBeNull();

    let attached = 0;
    h.service.onDidAttach(() => attached++);
    await h.service.attachGroup('g1', h.element());
    await h.service.attachGroup('g2', h.element());
    const live = h.state.editors.filter((e) => !e.disposed);
    expect(live).toHaveLength(2);
    expect(attached).toBe(2);
    expect(live[0].getModel()?.uri).toBe(`inmemory://doc/${h.a}`);
    expect(live[0].position).toEqual({ lineNumber: 8, column: 3 });
    expect(live[0].scrollTop).toBe(140);
    expect(live[1].getModel()?.uri).toBe(`inmemory://doc/${h.b}`);
    expect(live[1].position).toEqual({ lineNumber: 12, column: 5 });
    expect(live[1].scrollTop).toBe(220);
  });

  it('resolves ready on the first attach of g1 and builds nothing for a group that is not in use', async () => {
    const docs = createDocumentStore({ caseInsensitivePaths: false });
    const { api, state } = groupMonaco();
    const service = createEditorService({ docs, loadMonaco: async () => api as Monaco });
    addDoc(docs, 'a');
    let ready = false;
    void service.ready.then(() => (ready = true));
    await service.attachGroup('g2', {} as HTMLElement);
    await settle();
    expect(ready).toBe(false);
    await service.attachGroup('g1', {} as HTMLElement);
    await settle();
    expect(ready).toBe(true);
    expect(state.editors).toHaveLength(2);
    expect(service.groupViews().map((v) => v.id)).toEqual(['g1']); // g2 is not a group of the layout
    await expect(service.attachGroup('g9', {} as HTMLElement)).rejects.toThrow(RangeError);
  });

  // Rule 6: decoration owners per editor.
  it('lists every live group editor in groupViews(), in display order, with its document and pane', async () => {
    const h = await rig();
    const pane = fakePane(h.a, 'ch2', [1, 2, 9]);
    h.service.registerPane(pane);
    expect(h.service.groupViews().map((v) => [v.id, v.docId, v.pane, v.focused])).toEqual([['g1', h.a, null, true]]);
    h.service.openGroups({ layout: 'channels', contents: [{ kind: 'document', docId: h.b, channelId: 'ch1' }, { kind: 'pane', docId: h.a, channelId: 'ch2' }], focus: 1 });
    // g2 has no editor until its component is mounted
    expect(h.service.groupViews().map((v) => v.id)).toEqual(['g1']);
    await h.mount('g2');

    const views = h.service.groupViews();
    expect(views.map((v) => [v.id, v.docId, v.pane, v.focused])).toEqual([
      ['g1', h.b, null, false],
      ['g2', h.a, pane, true],
    ]);
    expect(views[1].editor).toBe(editorOf(h.service, 'g2'));
  });

  // Rule 7: commands.
  it('routes triggerAction("undo"/"redo") from a channel pane to the channel view (channelPanes.undo/redo)', async () => {
    const calls: string[] = [];
    const h = await rig({ paneHistory: { undo: () => void calls.push('undo'), redo: () => void calls.push('redo') } });
    const pane = fakePane(h.a, 'ch1', [1, 2, 3]);
    h.service.registerPane(pane);
    h.service.openGroups({ layout: 'channels', contents: [{ kind: 'document', docId: h.a }, { kind: 'pane', docId: h.a, channelId: 'ch1' }] });
    const [docEditor, paneEditor] = await h.mount('g2');

    h.service.triggerAction('undo'); // the focused group is the document
    expect(docEditor.triggered).toEqual(['undo']);
    expect(calls).toEqual([]);

    h.service.focusGroup('g2');
    h.service.triggerAction('undo');
    h.service.triggerAction('redo');
    h.service.triggerAction('editor.action.commentLine');
    expect(calls).toEqual(['undo', 'redo']);
    expect(paneEditor.triggered).toEqual(['editor.action.commentLine']);
  });

  // Rule 8, since the first runtime run: the survivor of a close shows the focused group's place even
  // when its slot showed the same document already.
  it('closing a group when both show the same document leaves the survivor at the focused group’s cursor and scroll', async () => {
    for (const how of ['closeGroup', 'closeGroups'] as const) {
      const h = await rig();
      h.service.openGroups({ layout: 'side-by-side', contents: [{ kind: 'document', docId: h.a }, { kind: 'document', docId: h.a }], focus: 1 });
      const [one, two] = await h.mount('g2');
      one.setPosition({ lineNumber: 4, column: 3 });
      one.scrollTop = 40;
      two.setPosition({ lineNumber: 9, column: 7 });
      two.scrollTop = 90;
      if (how === 'closeGroup') h.service.closeGroup('g1');
      else h.service.closeGroups();
      expect(h.service.groupsState().groups).toEqual([{ id: 'g1', content: { kind: 'document', docId: h.a } }]);
      expect(one.position, how).toEqual({ lineNumber: 9, column: 7 });
      expect(one.scrollTop, how).toBe(90);
    }
  });

  it('closing the other group keeps the survivor’s own cursor and scroll, and a document shown once is not disturbed', async () => {
    const h = await rig();
    h.service.openGroups({ layout: 'side-by-side', contents: [{ kind: 'document', docId: h.a }, { kind: 'document', docId: h.a }], focus: 0 });
    const [one, two] = await h.mount('g2');
    one.setPosition({ lineNumber: 4, column: 3 });
    one.scrollTop = 40;
    two.setPosition({ lineNumber: 9, column: 7 });
    two.scrollTop = 90;
    h.service.closeGroup('g2');
    expect(one.position).toEqual({ lineNumber: 4, column: 3 });
    expect(one.scrollTop).toBe(40);
  });

  // Rule 8: closing.
  it('closes a group: the other one stays; a document closed in a group shows the next active document there', async () => {
    const h = await rig();
    const c = addDoc(h.docs, 'c');
    h.service.createModel(c, 'c1', 'fanuc-gcode', 'lf');
    h.docs.activate(h.a);
    h.service.openGroups({ layout: 'side-by-side', contents: [{ kind: 'document', docId: h.a }, { kind: 'document', docId: h.b }] });
    const [one, two] = await h.mount('g2');
    two.setPosition({ lineNumber: 5, column: 1 });

    // Closing the first group: the second one's content moves up, with its place in the document.
    h.service.closeGroup('g1');
    expect(h.service.groupsState()).toEqual({ layout: 'single', groups: [{ id: 'g1', content: { kind: 'document', docId: h.b } }], focused: 'g1' });
    expect(h.docs.getActiveId()).toBe(h.b);
    expect(one.getModel()?.uri).toBe(`inmemory://doc/${h.b}`);
    expect(one.position).toEqual({ lineNumber: 5, column: 1 });
    expect(two.getModel()).toBeNull(); // the host unmounts its component and detaches it
    h.service.detachGroup('g2');
    expect(h.service.groupViews().map((v) => v.id)).toEqual(['g1']);

    // Split again, close the document that the second group shows: it shows what the store makes active.
    h.service.openGroups({ layout: 'side-by-side', contents: [{ kind: 'document', docId: h.b }, { kind: 'document', docId: c }], focus: 1 });
    await h.mount('g2');
    h.service.disposeModel(c);
    h.docs.remove(c); // c was active (g2 is focused); the neighbour to the left is b, which g1 shows
    // Split view with the same document twice is one editor again.
    expect(h.service.groupsState().layout).toBe('single');
    expect(h.service.groupsState().groups).toEqual([{ id: 'g1', content: { kind: 'document', docId: h.b } }]);
  });

  it('shows the active document in a group whose document was closed while the other group keeps its own', async () => {
    const h = await rig();
    const c = addDoc(h.docs, 'c');
    const d = addDoc(h.docs, 'd');
    h.service.createModel(c, 'c1', 'fanuc-gcode', 'lf');
    h.service.createModel(d, 'd1', 'fanuc-gcode', 'lf');
    h.service.openGroups({ layout: 'side-by-side', contents: [{ kind: 'document', docId: c }, { kind: 'document', docId: d }] });
    await h.mount('g2');
    // d is shown in g2 and is not the active document (g1 is focused); closing it replaces it by the active one.
    h.service.disposeModel(d);
    h.docs.remove(d);
    expect(h.service.groupsState().layout).toBe('single'); // c twice
    expect(h.docs.getActiveId()).toBe(c);
    expect(h.service.groupsState().groups).toEqual([{ id: 'g1', content: { kind: 'document', docId: c } }]);
  });

  it('refuses openGroups with a count the layout does not allow (RangeError) and a pane nobody registered', async () => {
    const h = await rig();
    const doc = (docId: DocId) => ({ kind: 'document' as const, docId });
    expect(() => h.service.openGroups({ layout: 'side-by-side', contents: [] })).toThrow(RangeError);
    expect(() => h.service.openGroups({ layout: 'side-by-side', contents: [doc(h.a)] })).toThrow(RangeError);
    expect(() => h.service.openGroups({ layout: 'stacked', contents: [doc(h.a), doc(h.a), doc(h.b)] })).toThrow(RangeError);
    expect(() => h.service.openGroups({ layout: 'channels', contents: [doc(h.a)] })).toThrow(RangeError);
    expect(() => h.service.openGroups({ layout: 'channels', contents: Array.from({ length: MAX_GROUPS + 1 }, () => doc(h.a)) })).toThrow(RangeError);
    expect(() => h.service.openGroups({ layout: 'channels', contents: [doc(h.a), { kind: 'pane', docId: h.a, channelId: 'nobody' }] })).toThrow(RangeError);
    expect(() => h.service.openGroups({ layout: 'side-by-side', contents: [doc(h.a), doc('d404')] })).toThrow(RangeError);
    expect(() => h.service.openGroups({ layout: 'side-by-side', contents: [doc(h.a), doc(h.b)], focus: 2 })).toThrow(RangeError);
    // and nothing changed
    expect(h.service.groupsState().layout).toBe('single');
    expect(h.service.groupsState().groups).toHaveLength(1);
  });

  // Beyond the todo rows: the layouts as a whole.
  it('opens split view, answers the ids in display order and closes it again at the focused cursor', async () => {
    const h = await rig();
    const ids = h.service.openGroups({ layout: 'stacked', contents: [{ kind: 'document', docId: h.a }, { kind: 'document', docId: h.b }], focus: 1 });
    expect(ids).toEqual(['g1', 'g2']);
    expect(h.service.groupsState()).toMatchObject({ layout: 'stacked', focused: 'g2' });
    expect(h.docs.getActiveId()).toBe(h.b);
    const [, two] = await h.mount('g2');
    two.setPosition({ lineNumber: 11, column: 2 });
    two.scrollTop = 300;

    h.service.closeGroups();

    expect(h.service.groupsState()).toEqual({ layout: 'single', groups: [{ id: 'g1', content: { kind: 'document', docId: h.b } }], focused: 'g1' });
    const one = editorOf(h.service, 'g1');
    expect(one.getModel()?.uri).toBe(`inmemory://doc/${h.b}`);
    expect(one.position).toEqual({ lineNumber: 11, column: 2 }); // the focused group's place
    expect(one.scrollTop).toBe(300);
  });

  it('closes the channel view at the program line of the pane’s cursor', async () => {
    const h = await rig();
    const pane = fakePane(h.a, 'ch2', [1, 2, 10, 11, 12]);
    h.service.registerPane(pane);
    h.service.openGroups({ layout: 'channels', contents: [{ kind: 'document', docId: h.b }, { kind: 'pane', docId: h.a, channelId: 'ch2' }], focus: 1 });
    const [, paneEditor] = await h.mount('g2');
    paneEditor.setPosition({ lineNumber: 4, column: 1 });

    h.service.closeGroups();

    expect(h.service.groupsState().groups).toEqual([{ id: 'g1', content: { kind: 'document', docId: h.a } }]);
    expect(h.docs.getActiveId()).toBe(h.a);
    const one = editorOf(h.service, 'g1');
    expect(one.getModel()?.uri).toBe(`inmemory://doc/${h.a}`);
    expect(one.position).toEqual({ lineNumber: 11, column: 1 });
    expect(one.calls).toContain('revealLineInCenter:11');
  });

  it('moves the focus to the next and previous group, wrapping', async () => {
    const h = await rig();
    const c = addDoc(h.docs, 'c');
    h.service.createModel(c, 'c1', 'fanuc-gcode', 'lf');
    h.service.openGroups({ layout: 'channels', contents: [{ kind: 'document', docId: h.a }, { kind: 'document', docId: h.b }, { kind: 'document', docId: c }] });
    await h.mount('g2', 'g3');
    const order: GroupId[] = [];
    h.service.onDidFocusGroup((id) => order.push(id));

    h.service.focusNextGroup(1);
    h.service.focusNextGroup(1);
    h.service.focusNextGroup(1);
    h.service.focusNextGroup(-1);

    expect(order).toEqual(['g2', 'g3', 'g1', 'g3']);
    expect(h.service.groupsState().focused).toBe('g3');
    expect(h.docs.getActiveId()).toBe(c);
    expect(h.service.hasFocus()).toBe(true);
  });

  it('closes a middle group of the channel view and keeps the ids g1…gN', async () => {
    const h = await rig();
    const c = addDoc(h.docs, 'c');
    h.service.createModel(c, 'c1', 'fanuc-gcode', 'lf');
    h.service.openGroups({ layout: 'channels', contents: [{ kind: 'document', docId: h.a }, { kind: 'document', docId: h.b }, { kind: 'document', docId: c }], focus: 2 });
    const [, two, three] = await h.mount('g2', 'g3');
    two.setPosition({ lineNumber: 7, column: 1 });

    h.service.closeGroup('g2');

    expect(h.service.groupsState().layout).toBe('channels');
    expect(h.service.groupsState().groups.map((g) => [g.id, g.content?.docId])).toEqual([['g1', h.a], ['g2', c]]);
    expect(h.service.groupsState().focused).toBe('g2'); // the group that had the focus keeps it
    expect(two.getModel()?.uri).toBe(`inmemory://doc/${c}`); // g3's content moved up into g2's editor
    expect(three.getModel()).toBeNull();
    expect(h.docs.getActiveId()).toBe(c);
  });

  it('closes the channel view when the program of its panes is closed, and a pane whose channel document was closed', async () => {
    const h = await rig();
    const pane1 = fakePane(h.a, 'ch1', [1, 2]);
    const pane2 = fakePane(h.a, 'ch2', [1, 3]);
    h.service.registerPane(pane1);
    h.service.registerPane(pane2);
    h.service.openGroups({
      layout: 'channels',
      contents: [{ kind: 'pane', docId: h.a, channelId: 'ch1' }, { kind: 'pane', docId: h.a, channelId: 'ch2' }],
    });
    await h.mount('g2');

    h.service.disposeModel(h.a);
    h.docs.remove(h.a);

    expect(h.service.groupsState().layout).toBe('single');
    expect(h.service.groupsState().groups).toEqual([{ id: 'g1', content: { kind: 'document', docId: h.b } }]);
    expect(h.docs.getActiveId()).toBe(h.b);

    // one file per channel: three channel documents, one is closed
    const c = addDoc(h.docs, 'c');
    const d = addDoc(h.docs, 'd');
    for (const id of [c, d]) h.service.createModel(id, `${id}1`, 'fanuc-gcode', 'lf');
    h.service.openGroups({
      layout: 'channels',
      contents: [{ kind: 'document', docId: h.b, channelId: 'ch1' }, { kind: 'document', docId: c, channelId: 'ch2' }, { kind: 'document', docId: d, channelId: 'ch3' }],
    });
    await h.mount('g2', 'g3');
    h.service.disposeModel(c);
    h.docs.remove(c);
    expect(h.service.groupsState().groups.map((g) => g.content?.docId)).toEqual([h.b, d]);
    h.service.disposeModel(d);
    h.docs.remove(d);
    expect(h.service.groupsState().layout).toBe('single');
    expect(h.service.groupsState().groups).toEqual([{ id: 'g1', content: { kind: 'document', docId: h.b } }]);
  });

  it('closes a tab of another document in the channel view first (the view is closed, the document shown)', async () => {
    const h = await rig();
    const pane1 = fakePane(h.a, 'ch1', [1, 2]);
    const pane2 = fakePane(h.a, 'ch2', [1, 3]);
    h.service.registerPane(pane1);
    h.service.registerPane(pane2);
    h.service.openGroups({
      layout: 'channels',
      contents: [{ kind: 'pane', docId: h.a, channelId: 'ch1' }, { kind: 'pane', docId: h.a, channelId: 'ch2' }],
    });
    await h.mount('g2');

    h.docs.activate(h.b);

    expect(h.service.groupsState()).toEqual({ layout: 'single', groups: [{ id: 'g1', content: { kind: 'document', docId: h.b } }], focused: 'g1' });
    expect(editorOf(h.service, 'g1').getModel()?.uri).toBe(`inmemory://doc/${h.b}`);
  });

  it('closes the group of a pane that is unregistered', async () => {
    const h = await rig();
    const pane1 = fakePane(h.a, 'ch1', [1, 2]);
    const pane2 = fakePane(h.a, 'ch2', [1, 3]);
    const stop1 = h.service.registerPane(pane1);
    h.service.registerPane(pane2);
    h.service.openGroups({
      layout: 'channels',
      contents: [{ kind: 'pane', docId: h.a, channelId: 'ch1' }, { kind: 'pane', docId: h.a, channelId: 'ch2' }],
    });
    await h.mount('g2');

    stop1();

    expect(h.service.groupsState().layout).toBe('single');
    expect(() => h.service.openGroups({ layout: 'channels', contents: [{ kind: 'pane', docId: h.a, channelId: 'ch1' }, { kind: 'pane', docId: h.a, channelId: 'ch2' }] })).toThrow(RangeError);
  });

  it('locks only the group whose document is locked, and follows the lock at once', async () => {
    const h = await rig();
    h.service.openGroups({ layout: 'side-by-side', contents: [{ kind: 'document', docId: h.a }, { kind: 'document', docId: h.b }] });
    const [one, two] = await h.mount('g2');
    expect(one.effective().readOnly).not.toBe(true);

    h.docs.update(h.b, { readOnly: true, readOnlyReason: 'attribute' });
    expect(two.effective().readOnly).toBe(true);
    expect(one.effective().readOnly).not.toBe(true);

    h.docs.update(h.b, { readOnly: false, readOnlyReason: null });
    expect(two.effective().readOnly).toBe(false);
  });

  it('puts a model created for a shown document straight into every group that shows it', async () => {
    const h = await rig();
    h.service.openGroups({ layout: 'side-by-side', contents: [{ kind: 'document', docId: h.a }, { kind: 'document', docId: h.a }] });
    const [one, two] = await h.mount('g2');
    const before = h.modelOf(h.a);

    h.service.createModel(h.a, 'fresh1\nfresh2', 'fanuc-gcode', 'lf');

    expect(before.disposed).toBe(true);
    expect(one.getModel()).toBe(h.modelOf(h.a));
    expect(two.getModel()).toBe(h.modelOf(h.a));
    expect(h.service.getText(h.a)).toBe('fresh1\nfresh2');
  });

  it('inserts a snippet at a document line in the group that shows it', async () => {
    const h = await rig();
    const pane = fakePane(h.a, 'ch1', [1, 2, 10, 11]);
    h.service.registerPane(pane);
    h.service.openGroups({ layout: 'channels', contents: [{ kind: 'document', docId: h.a }, { kind: 'pane', docId: h.a, channelId: 'ch1' }] });
    const [docEditor, paneEditor] = await h.mount('g2');

    h.service.insertSnippet('G1 X${1:0}', { line: 3, replace: false }); // the focused group, g1, shows it
    expect(docEditor.snippets).toEqual(['\nG1 X${1:0}']);
    expect(docEditor.position.lineNumber).toBe(3);

    paneEditor.click();
    h.service.insertSnippet('M30', { line: 11, replace: true }); // pane line 4
    expect(paneEditor.snippets).toEqual(['M30']);
    expect(paneEditor.calls).toContain('setSelection:4:1-4:4'); // the pane's own line 'L11'
    paneEditor.snippets.length = 0;
    h.service.insertSnippet('M30', { line: 5, replace: true }); // a line the pane does not show
    expect(paneEditor.snippets).toEqual([]);
  });
});
