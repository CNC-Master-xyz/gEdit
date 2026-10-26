// Bookmarks: toggle, next, previous and clear (plan §5 WP4.4, §7.11: Mod+F2, F2,
// Shift+F2). One feature per file (plan AD-3); see ./README.md.
//
// The three shortcuts are Monaco's own: F2 is Rename Symbol and Mod+F2 is Change All
// Occurrences, neither of which means anything in an NC program. The removals below drop
// them, so the keys are free for the bookmarks — and they are removals rather than a
// silent overlap, because two commands on one key are a conflict the registry reports as
// a `console.error` and the runtime harness fails on. Select All Occurrences keeps
// Mod+Shift+L (§7.11).
//
// The arithmetic is in `core/nav/bookmarks.ts` and the decorations in
// `monaco/bookmarks.ts`; this file is the keyboard, the palette and the status messages.
// `activate()` is also where the decoration service is handed the Monaco enums it needs:
// `getMonaco()` after `editor.ready` loads nothing early (the editor already has it) and
// nothing twice (it is the same memoized promise) — the same shape `contrib/assistant.ts`
// uses, and the reason README rule 10 allows it.
//
// P4c (plan §6.5 rules 4 to 6; P4.13) adds `bookmark.rename`, `bookmark.addAllMatches` and
// `view.toggleBookmarks` (the panel of `components/panels/BookmarksPanel.svelte`, left region,
// order 15, between the Program Map and the Inspector), and the Edit tab's Bookmarks group
// (`bookmarks.group`, orders 142 to 147). The ribbon rows are `Contribution.ribbon` rows; the
// four older commands keep their ids and keys.

import Bookmark from 'lucide-svelte/icons/bookmark';
import BookmarkCheck from 'lucide-svelte/icons/bookmark-check';
import ArrowDownToLine from 'lucide-svelte/icons/arrow-down-to-line';
import ArrowUpToLine from 'lucide-svelte/icons/arrow-up-to-line';
import PanelLeft from 'lucide-svelte/icons/panel-left';
import TextCursorInput from 'lucide-svelte/icons/text-cursor-input';
import { get } from 'svelte/store';
import { asIcon } from '$lib/app/icons';
import { modals } from '$lib/app/modals';
import { panels } from '$lib/app/registry/panels';
import { status } from '$lib/app/status';
import BookmarksPanel from '$lib/components/panels/BookmarksPanel.svelte';
import {
  MAX_BOOKMARK_NAME,
  MAX_BOOKMARKS,
  bookmarkLimitReached,
  bookmarkNameProblem,
  cleanBookmarkName,
} from '$lib/core/nav/bookmarks';
import { bookmarks } from '$lib/monaco/bookmarks';
import { editor } from '$lib/monaco/editorService';
import { getMonaco } from '$lib/monaco/setup';
import { docs } from '$lib/stores/documents';
import { layout } from '$lib/stores/layout';
import { t } from '$lib/i18n';
import type { CommandContext, Contribution, Disposable, DocId, Msg } from '$lib/app/types';

function hasDocument(context: CommandContext): boolean {
  return context.activeDocId !== null;
}

/** The bookmarks of the active document, or null when there is no document. */
function linesOfActive(): number[] | null {
  const id = docs.getActiveId();
  return id === null ? null : bookmarks.lines(id);
}

function step(dir: 1 | -1): void {
  const lines = linesOfActive();
  if (lines === null) return;
  if (lines.length === 0) {
    status.show(t('bookmarks.none'));
    return;
  }
  if (dir === 1) bookmarks.next();
  else bookmarks.prev();
  // The cursor is the feedback. What must not stay on screen is the *previous* command's
  // message — "Bookmark set." after a jump, or a red "The program ends at line 38." — which
  // for its whole timeout reads as the answer to the jump just made (G8 M5).
  status.clear();
}

function toggle(): void {
  const id = docs.getActiveId();
  if (id === null) return;
  const before = bookmarks.lines(id).length;
  // The same limit as saving and Bookmark All Matches: a 201st bookmark is refused, and says so.
  if (bookmarks.toggle() === 'full') {
    status.show(t('bookmarks.full', { max: MAX_BOOKMARKS }), { error: true });
    return;
  }
  const after = bookmarks.lines(id).length;
  // The glyph in the margin is the real feedback; the message is for the case where the
  // margin is off screen, and it says which way the toggle went.
  if (after > before) status.show(t('bookmarks.set'));
  else if (after < before) status.show(t('bookmarks.removed'));
}

function clear(): void {
  const id = docs.getActiveId();
  if (id === null) return;
  const count = bookmarks.lines(id).length;
  if (count === 0) {
    status.show(t('bookmarks.none'));
    return;
  }
  bookmarks.clear(id);
  status.show(t('bookmarks.cleared', { count }));
}

/** The id the panel registers under; `layout.show` takes it. */
export const BOOKMARKS_PANEL_ID = 'bookmarks';

/** Shows the bookmark panel, or, when it is the panel on show, the panel it replaced (the Inspector's toggle). */
export function toggleBookmarksPanel(): void {
  const left = get(layout.state).left;
  if (left.visible && left.active === BOOKMARKS_PANEL_ID) {
    const other = get(panels.panels).find((panel) => panel.region === 'left' && panel.id !== BOOKMARKS_PANEL_ID);
    if (other) layout.show(other.id);
    else layout.hide('left');
    return;
  }
  layout.show(BOOKMARKS_PANEL_ID);
}

/** What the prompt says about a name that cannot be kept; an empty name is fine (it removes the name). */
function nameMessage(raw: string): Msg | null {
  switch (bookmarkNameProblem(raw)) {
    case 'tooLong':
      return { key: 'bookmarks.nameTooLong', params: { max: MAX_BOOKMARK_NAME } };
    case 'control':
      return { key: 'bookmarks.nameInvalid' };
    default:
      return null;
  }
}

/** `{ docId, line }` handed to `bookmark.rename` by the panel's rows; anything else is "the cursor's line". */
function renameTarget(arg: unknown): { id: DocId; line: number } | null {
  if (typeof arg === 'object' && arg !== null) {
    const { docId, line } = arg as { docId?: unknown; line?: unknown };
    if (typeof docId === 'string' && typeof line === 'number' && Number.isInteger(line) && line >= 1) {
      return { id: docId, line };
    }
  }
  const id = docs.getActiveId();
  const line = editor.cursor()?.line;
  return id === null || line === undefined ? null : { id, line };
}

/**
 * Asks for the name of the bookmark on the line (the current name filled in) and sets it. The
 * bookmark is set when the line has none; an empty answer removes the name and keeps the bookmark
 * (on a line without one it just sets the bookmark); cancel does nothing (§6.5 rule 4).
 */
async function rename(arg?: unknown): Promise<void> {
  const target = renameTarget(arg);
  if (target === null) return;
  const { id, line } = target;
  // A line without a bookmark would get one, which a full document refuses (asked before the name).
  if (bookmarkLimitReached(bookmarks.lines(id), line)) {
    status.show(t('bookmarks.full', { max: MAX_BOOKMARKS }), { error: true });
    return;
  }
  const current = bookmarks.list(id).find((info) => info.line === line)?.name;
  const answer = await modals.prompt({
    title: t('bookmarks.renameTitle'),
    placeholder: t('bookmarks.renamePlaceholder'),
    initial: current ?? '',
    validate: nameMessage,
  });
  if (answer === undefined) return;
  const name = cleanBookmarkName(answer);
  if (name === null) {
    // Refused names never get here (the prompt validates), so this is the empty answer.
    if (bookmarks.lines(id).includes(line)) {
      if (current !== undefined) {
        bookmarks.setName(id, line, null);
        status.show(t('bookmarks.nameRemoved'));
      }
    } else {
      bookmarks.toggle(id, line);
      status.show(t('bookmarks.set'));
    }
    return;
  }
  const saved = bookmarks.setName(id, line, name);
  if (saved !== null) status.show(t('bookmarks.named', { name: saved }));
}

/** Bookmark All Matches: the focused find widget's search, all or nothing (§6.5 rule 6). */
function addAllMatches(): void {
  const answer = bookmarks.addAllMatches();
  if (answer.ok) {
    const count = answer.marked + answer.already;
    if (answer.marked === 0) status.show(t('bookmarks.allHad', { count }));
    else if (answer.already === 0) status.show(t('bookmarks.matched', { count }));
    else status.show(t('bookmarks.matchedSome', { count, already: answer.already }));
    return;
  }
  const matches = answer.matches ?? 0;
  switch (answer.reason) {
    case 'noDocument':
      status.show(t('bookmarks.noDocument'));
      break;
    case 'noSearch':
      status.show(t('bookmarks.noSearch'));
      break;
    case 'noMatch':
      status.show(t('bookmarks.noMatch'));
      break;
    case 'tooMany': {
      const id = docs.getActiveId();
      const have = id === null ? 0 : bookmarks.lines(id).length;
      // Fewer matches than the limit, so it is the bookmarks already there that tip it over.
      if (matches < MAX_BOOKMARKS && have > 0) {
        status.show(t('bookmarks.tooManyAdded', { count: matches, have, max: MAX_BOOKMARKS }), { error: true });
      } else {
        status.show(t('bookmarks.tooMany', { count: matches, max: MAX_BOOKMARKS }), { error: true });
      }
      break;
    }
  }
}

export default {
  id: 'bookmarks',
  commands: [
    {
      id: 'bookmark.toggle',
      title: 'bookmarks.toggle',
      category: 'bookmarks.category',
      icon: asIcon(Bookmark),
      keys: 'Mod+F2',
      global: true,
      enabled: hasDocument,
      run: () => toggle(),
    },
    {
      id: 'bookmark.next',
      title: 'bookmarks.next',
      category: 'bookmarks.category',
      icon: asIcon(ArrowDownToLine),
      keys: 'F2',
      global: true,
      enabled: hasDocument,
      run: () => step(1),
    },
    {
      id: 'bookmark.prev',
      title: 'bookmarks.prev',
      category: 'bookmarks.category',
      icon: asIcon(ArrowUpToLine),
      keys: 'Shift+F2',
      global: true,
      enabled: hasDocument,
      run: () => step(-1),
    },
    {
      id: 'bookmark.clear',
      title: 'bookmarks.clear',
      category: 'bookmarks.category',
      global: true,
      enabled: hasDocument,
      run: () => clear(),
    },
    {
      id: 'bookmark.rename',
      title: 'bookmarks.rename',
      category: 'bookmarks.category',
      icon: asIcon(TextCursorInput),
      global: true,
      enabled: hasDocument,
      run: (_context, arg) => rename(arg),
    },
    {
      id: 'bookmark.addAllMatches',
      title: 'bookmarks.addAllMatches',
      category: 'bookmarks.category',
      icon: asIcon(BookmarkCheck),
      global: true,
      enabled: hasDocument,
      run: () => addAllMatches(),
    },
    {
      id: 'view.toggleBookmarks',
      title: 'bookmarks.togglePanel',
      category: 'bookmarks.category',
      icon: asIcon(PanelLeft),
      global: true,
      run: () => toggleBookmarksPanel(),
    },
  ],
  panels: [
    {
      id: BOOKMARKS_PANEL_ID,
      region: 'left',
      title: 'bookmarks.panelTitle',
      component: BookmarksPanel,
      order: 15,
    },
  ],
  ribbon: [
    { tab: 'edit', group: 'bookmarks.group', command: 'bookmark.toggle', order: 142 },
    { tab: 'edit', group: 'bookmarks.group', command: 'bookmark.next', order: 143 },
    { tab: 'edit', group: 'bookmarks.group', command: 'bookmark.prev', order: 144 },
    { tab: 'edit', group: 'bookmarks.group', command: 'bookmark.rename', order: 145 },
    { tab: 'edit', group: 'bookmarks.group', command: 'bookmark.addAllMatches', order: 146 },
    { tab: 'edit', group: 'bookmarks.group', command: 'view.toggleBookmarks', order: 147 },
    { tab: 'view', group: 'view.groupPanels', command: 'view.toggleBookmarks', order: 16 },
  ],
  keybindingRemovals: [
    { keys: 'F2', command: 'editor.action.rename' },
    { keys: 'Mod+F2', command: 'editor.action.changeAll' },
  ],
  activate(): Disposable {
    let uninstall: Disposable | undefined;
    let stopped = false;

    void (async () => {
      await editor.ready;
      const monaco = await getMonaco();
      if (stopped) return;
      uninstall = bookmarks.install(monaco);
    })().catch(() => {
      // `editor.ready` never rejects, and a Monaco that cannot be loaded is already
      // reported by EditorHost. A second message here would only be noise — and a console
      // error fails the runtime harness.
    });

    return () => {
      stopped = true;
      uninstall?.();
      uninstall = undefined;
    };
  },
} satisfies Contribution;
