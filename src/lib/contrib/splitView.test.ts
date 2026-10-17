// The split view commands (Phase 4 plan §6.11 P4e rows, §5 P4e decisions 12 and 13): which are
// offered when, what each asks of the editor groups, and the two keys. The groups themselves
// are `monaco/editorGroups.test.ts`.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandContext, CommandDef, EditorGroupsState } from '$lib/app/types';

const fake = vi.hoisted(() => ({
  state: { layout: 'single', groups: [{ id: 'g1', content: { kind: 'document', docId: 'a' } }], focused: 'g1' } as EditorGroupsState,
  calls: [] as unknown[][],
  channelViewOpen: false,
  closedChannelView: 0,
}));

vi.mock('$lib/monaco/editorService', () => ({
  editor: {
    groupsState: () => fake.state,
    openGroups: (o: unknown) => fake.calls.push(['openGroups', o]),
    closeGroups: () => fake.calls.push(['closeGroups']),
    focusNextGroup: (dir: number) => fake.calls.push(['focusNextGroup', dir]),
  },
}));
vi.mock('$lib/monaco/channelPanes', async () => {
  const { writable: store } = await import('svelte/store');
  return {
    channelPanes: {
      state: {
        subscribe: (run: (v: { open: boolean }) => void) => store({ open: false }).subscribe(() => run({ open: fake.channelViewOpen })),
      },
      close: () => {
        fake.closedChannelView++;
        fake.calls.push(['channelPanes.close']);
        fake.state = { layout: 'single', groups: [fake.state.groups[0]], focused: 'g1' };
      },
    },
  };
});

const splitView = (await import('./splitView')).default;
const { hasKey } = await import('$lib/i18n');

const commands = new Map((splitView.commands ?? []).map((c) => [c.id, c as CommandDef]));
const context = (o: Partial<CommandContext> = {}): CommandContext => ({
  activeDocId: 'a',
  profileId: 'fanuc-gcode',
  hasSelection: false,
  editorFocused: true,
  compareOpen: false,
  modalOpen: false,
  scriptRunning: false,
  ...o,
});
const enabled = (id: string, o?: Partial<CommandContext>): boolean => commands.get(id)?.enabled?.(context(o)) ?? true;
const run = (id: string): unknown => commands.get(id)?.run(context());

const single = (): EditorGroupsState => ({ layout: 'single', groups: [{ id: 'g1', content: { kind: 'document', docId: 'a' } }], focused: 'g1' });
const twoDocs = (layout: 'side-by-side' | 'stacked', focused = 'g1'): EditorGroupsState => ({
  layout,
  groups: [
    { id: 'g1', content: { kind: 'document', docId: 'a' } },
    { id: 'g2', content: { kind: 'document', docId: 'b' } },
  ],
  focused,
});

beforeEach(() => {
  fake.state = single();
  fake.calls = [];
  fake.channelViewOpen = false;
  fake.closedChannelView = 0;
});

describe('the declaration', () => {
  it('is the five commands of §6.11, the keys on the two focus commands only', () => {
    expect([...commands.keys()]).toEqual(['view.splitEditor', 'view.splitEditorDown', 'view.closeSplit', 'view.focusNextPane', 'view.focusPreviousPane']);
    expect(commands.get('view.focusNextPane')?.keys).toBe('F6');
    expect(commands.get('view.focusPreviousPane')?.keys).toBe('Shift+F6');
    for (const id of ['view.splitEditor', 'view.splitEditorDown', 'view.closeSplit']) expect(commands.get(id)?.keys, id).toBeUndefined();
    for (const command of commands.values()) {
      expect(command.category).toBe('splitView.category');
      expect(hasKey(command.title), command.title).toBe(true);
      expect(command.global).toBe(true);
    }
  });

  it('puts the three split buttons in the View tab, group Editor', () => {
    expect(splitView.ribbon?.map((r) => [r.tab, r.group, r.command])).toEqual([
      ['view', 'splitView.group', 'view.splitEditor'],
      ['view', 'splitView.group', 'view.splitEditorDown'],
      ['view', 'splitView.group', 'view.closeSplit'],
    ]);
    for (const key of ['splitView.group', 'splitView.category', 'splitView.closeGroup', 'splitView.resize']) expect(hasKey(key), key).toBe(true);
  });
});

describe('which commands are offered', () => {
  it('offers the splits from one editor and Close Split / the focus keys only from more than one', () => {
    expect(enabled('view.splitEditor')).toBe(true);
    expect(enabled('view.splitEditorDown')).toBe(true);
    expect(enabled('view.closeSplit')).toBe(false);
    expect(enabled('view.focusNextPane')).toBe(false);
    expect(enabled('view.focusPreviousPane')).toBe(false);

    fake.state = twoDocs('side-by-side');
    expect(enabled('view.closeSplit')).toBe(true);
    expect(enabled('view.focusNextPane')).toBe(true);
    expect(enabled('view.focusPreviousPane')).toBe(true);
    expect(enabled('view.splitEditor')).toBe(false); // already side by side
    expect(enabled('view.splitEditorDown')).toBe(true); // lays the two panes out the other way
  });

  it('offers no split while the channel view is open, but Close Split and the focus keys', () => {
    fake.state = { ...twoDocs('side-by-side'), layout: 'channels' };
    expect(enabled('view.splitEditor')).toBe(false);
    expect(enabled('view.splitEditorDown')).toBe(false);
    expect(enabled('view.closeSplit')).toBe(true);
    expect(enabled('view.focusNextPane')).toBe(true);
  });

  it('offers nothing without a document, or while the comparison covers the editor', () => {
    expect(enabled('view.splitEditor', { activeDocId: null })).toBe(false);
    for (const id of commands.keys()) expect(enabled(id, { compareOpen: true }), id).toBe(false);
  });
});

describe('what the commands do', () => {
  it('splits the focused group’s document a second time, side by side or below, the new pane in focus', () => {
    run('view.splitEditor');
    run('view.splitEditorDown');
    expect(fake.calls).toEqual([
      ['openGroups', { layout: 'side-by-side', contents: [{ kind: 'document', docId: 'a' }, { kind: 'document', docId: 'a' }], focus: 1 }],
      ['openGroups', { layout: 'stacked', contents: [{ kind: 'document', docId: 'a' }, { kind: 'document', docId: 'a' }], focus: 1 }],
    ]);
  });

  it('lays out the two panes of an open split the other way and keeps the focus where it is', () => {
    fake.state = twoDocs('side-by-side', 'g2');
    run('view.splitEditorDown');
    expect(fake.calls).toEqual([
      ['openGroups', { layout: 'stacked', contents: [{ kind: 'document', docId: 'a' }, { kind: 'document', docId: 'b' }], focus: 1 }],
    ]);
  });

  it('closes the split through the groups, and the channel view through its own service', () => {
    fake.state = twoDocs('side-by-side');
    run('view.closeSplit');
    expect(fake.calls).toEqual([['closeGroups']]);

    fake.calls = [];
    fake.state = { ...twoDocs('side-by-side'), layout: 'channels' };
    fake.channelViewOpen = true;
    run('view.closeSplit');
    expect(fake.calls).toEqual([['channelPanes.close'], ['closeGroups']]);
    expect(fake.closedChannelView).toBe(1);
  });

  it('moves the focus to the next pane with F6 and to the previous one with Shift+F6', () => {
    fake.state = twoDocs('side-by-side');
    run('view.focusNextPane');
    run('view.focusPreviousPane');
    expect(fake.calls).toEqual([['focusNextGroup', 1], ['focusNextGroup', -1]]);
  });
});
