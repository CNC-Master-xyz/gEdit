// The close button of an editor group (v1.2.0 T030, the rest of CODE-11): a pane of the channel view names its
// channel, any other group keeps "Close this pane". Rendered with `svelte/server` (no DOM, no Monaco).

import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { ChannelViewState, EditorGroupInfo } from '$lib/app/types';

const fake = vi.hoisted(() => ({
  state: { open: true, layout: 'single-file', docId: 'd1', panes: [{ channelId: '2', name: 'Turret B', groupId: 'g2', docId: 'd1' }], notShown: [], outsideLines: 0, marks: { matched: 0, unmatched: 0, none: 0, unknown: 0 } } as unknown as ChannelViewState,
}));

vi.mock('$lib/monaco/channelPanes', () => ({
  channelPanes: {
    state: {
      subscribe: (run: (value: ChannelViewState) => void) => {
        run(fake.state);
        return () => {};
      },
    },
  },
}));
vi.mock('$lib/monaco/editorService', () => ({
  editor: { attachGroup: async () => {}, detachGroup: () => {}, focusGroup: () => {}, closeGroup: () => {} },
}));
vi.mock('$lib/stores/documents', () => ({
  docs: {
    list: {
      subscribe: (run: (value: unknown[]) => void) => {
        run([{ id: 'd1', title: 'SHAFT.NC' }]);
        return () => {};
      },
    },
  },
}));

const EditorGroup = (await import('./EditorGroup.svelte')).default;

const html = (group: EditorGroupInfo, multiple = true): string => render(EditorGroup, { props: { group, index: 1, multiple, focused: false, onerror: () => {} } }).body;
const closeLabel = (body: string): string | undefined => /data-testid="editor-group-close"[^>]*aria-label="([^"]*)"/.exec(body)?.[1];

describe('the close button of an editor group', () => {
  it('names the channel on a channel pane, in its label and its title', () => {
    const body = html({ id: 'g2', content: { kind: 'pane', docId: 'd1', channelId: '2' } });
    expect(closeLabel(body)).toBe('Close the pane of Turret B');
    expect(body).toContain('title="Close the pane of Turret B"');
  });

  it('names the channel of a pane of one file per channel too', () => {
    expect(closeLabel(html({ id: 'g2', content: { kind: 'document', docId: 'd1', channelId: '2' } }))).toBe('Close the pane of Turret B');
  });

  it('keeps "Close this pane" for a group of the split view', () => {
    expect(closeLabel(html({ id: 'g2', content: { kind: 'document', docId: 'd1' } }))).toBe('Close this pane');
  });

  it('gives each pane its own name', () => {
    fake.state = { ...fake.state, panes: [{ channelId: '1', name: 'Turret A', groupId: 'g1', docId: 'd1' }, ...fake.state.panes] };
    expect(closeLabel(html({ id: 'g1', content: { kind: 'pane', docId: 'd1', channelId: '1' } }))).toBe('Close the pane of Turret A');
    expect(closeLabel(html({ id: 'g2', content: { kind: 'pane', docId: 'd1', channelId: '2' } }))).toBe('Close the pane of Turret B');
  });
});
