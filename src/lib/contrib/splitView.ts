// Split view: the same program, or two programs, in two panes (Phase 4 plan AD-50, §6.7 rules 2–8;
// P4.21). One feature per file (plan AD-3); see ./README.md.
//
// `view.splitEditor` shows the active document a second time beside the first, `view.splitEditorDown`
// below it; both panes share one model, so an edit, an undo, a bookmark and the inspector follow
// whichever pane has the focus, and each pane keeps its own cursor, scroll position and folds.
// `view.closeSplit` goes back to one editor (and closes the channel view too, which uses the same
// groups). `F6` and `Shift+F6` move between the panes. The groups themselves are
// `monaco/editorService.ts`; this file is the commands.
//
// No key for the split commands: the usual split key needs AltGr on the owner's Swiss German
// keyboard, and P4g's user keys can bind them (Phase 4 plan §5 P4e decision 13). The split commands
// are not offered while the channel view is open (decision 12): the two views exclude each other.

import Columns2 from 'lucide-svelte/icons/columns-2';
import PanelLeftClose from 'lucide-svelte/icons/panel-left-close';
import Rows2 from 'lucide-svelte/icons/rows-2';
import { get } from 'svelte/store';
import { asIcon } from '$lib/app/icons';
import { channelPanes } from '$lib/monaco/channelPanes';
import { editor } from '$lib/monaco/editorService';
import type { CommandContext, Contribution, GroupContent } from '$lib/app/types';

/** Two panes at most in split view; the channel view's panes are not this feature's. */
type SplitLayout = 'side-by-side' | 'stacked';

/** The channel view is open: its panes are the groups, and the split commands wait for it to close. */
function channelViewOpen(): boolean {
  return editor.groupsState().layout === 'channels';
}

function canSplit(context: CommandContext, layout: SplitLayout): boolean {
  if (context.activeDocId === null || context.compareOpen || channelViewOpen()) return false;
  // Already in that layout: nothing to do.
  return editor.groupsState().layout !== layout;
}

/**
 * Opens split view in `layout`. From one editor, the focused group's document is shown a second
 * time (the new pane starts where the first one is and takes the focus); from the other split
 * layout, the same two panes are laid out the other way.
 */
function split(layout: SplitLayout): void {
  const state = editor.groupsState();
  if (state.layout === 'channels') return;
  if (state.layout === 'single') {
    const content = state.groups[0].content;
    if (content === null) return;
    editor.openGroups({
      layout,
      contents: [{ kind: 'document', docId: content.docId }, { kind: 'document', docId: content.docId }],
      focus: 1,
    });
    return;
  }
  const contents = state.groups.map((group) => group.content).filter((content): content is GroupContent => content !== null);
  editor.openGroups({
    layout,
    contents,
    focus: Math.max(0, state.groups.findIndex((group) => group.id === state.focused)),
  });
}

function closeSplit(): void {
  // The channel view closes through its own service, which also drops its panes and its undo order.
  if (get(channelPanes.state).open) channelPanes.close();
  // Whichever closed it, one editor is what is left (nothing to do when the view already did).
  editor.closeGroups();
}

const hasPanes = (): boolean => editor.groupsState().groups.length > 1;

export default {
  id: 'splitView',
  commands: [
    {
      id: 'view.splitEditor',
      title: 'splitView.split',
      category: 'splitView.category',
      icon: asIcon(Columns2),
      global: true,
      enabled: (c) => canSplit(c, 'side-by-side'),
      run: () => split('side-by-side'),
    },
    {
      id: 'view.splitEditorDown',
      title: 'splitView.splitDown',
      category: 'splitView.category',
      icon: asIcon(Rows2),
      global: true,
      enabled: (c) => canSplit(c, 'stacked'),
      run: () => split('stacked'),
    },
    {
      id: 'view.closeSplit',
      title: 'splitView.close',
      category: 'splitView.category',
      icon: asIcon(PanelLeftClose),
      global: true,
      enabled: (c) => !c.compareOpen && hasPanes(),
      run: () => closeSplit(),
    },
    {
      id: 'view.focusNextPane',
      title: 'splitView.focusNext',
      category: 'splitView.category',
      keys: 'F6',
      global: true,
      enabled: (c) => !c.compareOpen && hasPanes(),
      run: () => editor.focusNextGroup(1),
    },
    {
      id: 'view.focusPreviousPane',
      title: 'splitView.focusPrevious',
      category: 'splitView.category',
      keys: 'Shift+F6',
      global: true,
      enabled: (c) => !c.compareOpen && hasPanes(),
      run: () => editor.focusNextGroup(-1),
    },
  ],
  // After Lines (the motion colours, 50) and before Appearance (90).
  ribbon: [
    { tab: 'view', group: 'splitView.group', command: 'view.splitEditor', order: 60 },
    { tab: 'view', group: 'splitView.group', command: 'view.splitEditorDown', order: 61 },
    { tab: 'view', group: 'splitView.group', command: 'view.closeSplit', order: 62 },
  ],
} satisfies Contribution;
