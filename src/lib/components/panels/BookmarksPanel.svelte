<!--
  The bookmark panel (Phase 4 plan §6.5 rule 5, P4.13): the bookmarks of every open document.
  Test ids: `bookmarks-panel` (`data-count`), `bookmark-row` (`data-doc-id`, `data-line`,
  `data-named`, `data-pending`), `bookmark-row-name`, `bookmark-row-delete`, `bookmarks-clear-all`
  and `bookmarks-empty`.

  Rows are in tab order, then by line: the file, the line, the name and the line's text. A click
  on a row jumps (the document comes to the front, the line is revealed, the editor is focused);
  each row has a button that removes the bookmark and one that renames it (a double click on the
  name does the same, through the `bookmark.rename` prompt for that row). Clear All asks once.
  A tab whose bookmarks are not in the editor yet (restored, not shown yet: session rule 3; it has its
  model, but its remembered state waits for the tab to be in front) lists the bookmarks of its
  waiting memo, line and name without text; its jump shows the tab first and its delete changes
  the memo (and the panel reads its rows again at once, a memo having no change event). The panel follows
  `bookmarks.onDidChange` and the documents' list, and reads the lines'
  text only while it is mounted. Every name and line text is shown as text, never as markup.
-->
<script module lang="ts">
  import { memoMarks, namesOf } from '$lib/core/nav/bookmarks';
  import type { BookmarkInfo, DocId } from '$lib/app/types';

  /** One row of the panel. */
  export interface BookmarkRow {
    docId: DocId;
    /** 1-based. */
    line: number;
    name?: string;
    /** The line's text, trimmed; empty for a document without a model. */
    text: string;
    /** The document's title. */
    file: string;
    /** The document's path, for the tooltip; null for an untitled document. */
    path: string | null;
    /** The document's bookmarks are not in the editor yet (no model, or the tab was never shown since the session came back): the row comes from its waiting memo. */
    pending: boolean;
  }

  /** What `collectRows` reads, so the rows can be built without the stores. */
  export interface RowSources {
    docs: readonly { id: DocId; title: string; path: string | null }[];
    hasModel(id: DocId): boolean;
    /**
     * Whether the bookmarks of a document that has its model are still in its memo. A tab that came back with the
     * session has its model from the start, and the editor knows none of its bookmarks until the tab is shown.
     */
    waiting?(id: DocId): boolean;
    list(id: DocId): BookmarkInfo[];
    memo(path: string): { bookmarks: number[]; bookmarkNames?: unknown } | undefined;
  }

  /** The bookmarks of every open document, in tab order, then by line (§6.5 rule 5). */
  export function collectRows(src: RowSources): BookmarkRow[] {
    const rows: BookmarkRow[] = [];
    for (const doc of src.docs) {
      if (src.hasModel(doc.id) && src.waiting?.(doc.id) !== true) {
        for (const info of src.list(doc.id)) {
          rows.push({ docId: doc.id, line: info.line, name: info.name, text: info.text, file: doc.title, path: doc.path, pending: false });
        }
        continue;
      }
      const memo = doc.path === null ? undefined : src.memo(doc.path);
      if (memo === undefined) continue;
      for (const mark of memoMarks(memo)) {
        rows.push({ docId: doc.id, line: mark.line, name: mark.name, text: '', file: doc.title, path: doc.path, pending: true });
      }
    }
    return rows;
  }

  /** What `removeRow` and `clearRows` change. */
  export interface RowActions {
    remove(id: DocId, line: number): boolean;
    clear(id: DocId): void;
    memo(path: string): { bookmarks: number[]; bookmarkNames?: unknown } | undefined;
    remember(path: string, patch: { bookmarks: number[]; bookmarkNames: { line: number; name: string }[] | undefined }): void;
    /**
     * Called after a row was removed or cleared. A waiting memo has no `bookmarks.onDidChange` to tell the
     * panel, so the panel reads its rows again when this fires.
     */
    changed(): void;
  }

  /** Removes one bookmark: in the session for a document with a model, in the waiting memo otherwise. */
  export function removeRow(act: RowActions, row: BookmarkRow): void {
    if (!row.pending) {
      act.remove(row.docId, row.line);
      act.changed();
      return;
    }
    if (row.path === null) return;
    const memo = act.memo(row.path);
    if (memo === undefined) return;
    const marks = memoMarks(memo).filter((mark) => mark.line !== row.line);
    const names = namesOf(marks);
    act.remember(row.path, { bookmarks: marks.map((mark) => mark.line), bookmarkNames: names.length > 0 ? names : undefined });
    act.changed();
  }

  /** Removes every bookmark and name of the documents the rows belong to. */
  export function clearRows(act: RowActions, rows: readonly BookmarkRow[]): void {
    const done = new Set<DocId>();
    for (const row of rows) {
      if (done.has(row.docId)) continue;
      done.add(row.docId);
      if (!row.pending) act.clear(row.docId);
      else if (row.path !== null) act.remember(row.path, { bookmarks: [], bookmarkNames: undefined });
    }
    act.changed();
  }

  /** Asks once (`confirm` names the count) and, on a yes, removes every bookmark of every open document. */
  export async function clearAllRows(o: {
    rows: () => readonly BookmarkRow[];
    act: RowActions;
    confirm: (count: number) => Promise<boolean>;
    said: (count: number) => void;
  }): Promise<boolean> {
    const count = o.rows().length;
    if (count === 0) return false;
    if (!(await o.confirm(count))) return false;
    // The rows as they are after the question, not before it.
    clearRows(o.act, o.rows());
    o.said(count);
    return true;
  }

  /** What `jumpToRow` needs of the editor, the tabs and the clock. */
  export interface JumpDeps {
    hasModel(id: DocId): boolean;
    reveal(id: DocId, line: number): void;
    activate(id: DocId): void;
    /** The editor made a model for a document; answers the way to stop listening. */
    onDidCreateModel(cb: (id: DocId) => void): () => void;
    /** Runs `fn` after the current task (after the session's own restore of the cursor). */
    defer(fn: () => void): void;
    /** Runs `fn` after `ms`; answers the way to cancel. */
    after(fn: () => void, ms: number): () => void;
  }

  /** How long a jump waits for the model of a tab that had none. */
  export const JUMP_WAIT_MS = 5000;

  /**
   * Brings the document to the front and reveals the line. A tab that has no model yet, or whose
   * remembered state waits, is shown first and the line is revealed once the editor has put its state in.
   */
  export function jumpToRow(deps: JumpDeps, row: BookmarkRow): void {
    if (deps.hasModel(row.docId)) {
      if (!row.pending) {
        deps.reveal(row.docId, row.line);
        return;
      }
      // A tab that has its model but was never shown: showing it puts its remembered cursor back, so the line is
      // revealed after that, not before it.
      deps.activate(row.docId);
      deps.defer(() => deps.reveal(row.docId, row.line));
      return;
    }
    let stop = () => {};
    let cancel = () => {};
    const done = () => {
      stop();
      cancel();
    };
    stop = deps.onDidCreateModel((id) => {
      if (id !== row.docId) return;
      done();
      deps.defer(() => deps.reveal(row.docId, row.line));
    });
    cancel = deps.after(done, JUMP_WAIT_MS);
    deps.activate(row.docId);
    // Showing the tab can make the model at once.
    if (deps.hasModel(row.docId)) {
      done();
      deps.reveal(row.docId, row.line);
    }
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import Pencil from 'lucide-svelte/icons/pencil';
  import X from 'lucide-svelte/icons/x';
  import { dialogs } from '$lib/app/dialogs';
  import { commands } from '$lib/app/registry/commands';
  import { status } from '$lib/app/status';
  import { formatKey, resolveKeys } from '$lib/core/keys/keySpec';
  import { bookmarks } from '$lib/monaco/bookmarks';
  import { editor } from '$lib/monaco/editorService';
  import { docs } from '$lib/stores/documents';
  import { fileMemory } from '$lib/stores/fileMemory';
  import { memoWaiting } from '$lib/app/memoWaiting';
  import { t } from '$lib/i18n';
  import { isMacPlatform } from '$lib/utils/platform';

  const list = docs.list;
  /** Bumped when a bookmark changed anywhere; the rows are read again once per frame at most. */
  let version = $state(0);

  const rows = $derived.by(() => {
    void version;
    return collectRows({
      docs: $list,
      hasModel: (id) => editor.hasModel(id),
      waiting: (id) => memoWaiting.has(id),
      list: (id) => bookmarks.list(id),
      memo: (path) => fileMemory.get(path),
    });
  });

  const actions: RowActions = {
    remove: (id, line) => bookmarks.remove(id, line),
    clear: (id) => bookmarks.clear(id),
    memo: (path) => fileMemory.get(path),
    remember: (path, patch) => fileMemory.remember(path, patch),
    changed: () => {
      version += 1;
    },
  };

  onMount(() => {
    let scheduled = false;
    let frame = 0;
    const refresh = () => {
      scheduled = false;
      version += 1;
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(refresh);
      else queueMicrotask(refresh);
    };
    const stops = [bookmarks.onDidChange(schedule), editor.onDidCreateModel(schedule)];
    return () => {
      for (const stop of stops) stop();
      scheduled = false;
      if (frame !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
    };
  });

  /** The key of Toggle Bookmark in the platform's notation, for the empty state. */
  const toggleKey = $derived.by(() => {
    const isMac = isMacPlatform();
    const spec = resolveKeys(commands.get('bookmark.toggle')?.keys, isMac);
    return spec === undefined ? null : formatKey(spec, isMac);
  });

  const jumpDeps: JumpDeps = {
    hasModel: (id) => editor.hasModel(id),
    reveal: (id, line) => editor.reveal(id, line),
    activate: (id) => docs.activate(id),
    onDidCreateModel: (cb) => editor.onDidCreateModel(cb),
    defer: (fn) => void setTimeout(fn, 0),
    after: (fn, ms) => {
      const timer = setTimeout(fn, ms);
      return () => clearTimeout(timer);
    },
  };

  function jump(row: BookmarkRow): void {
    jumpToRow(jumpDeps, row);
  }

  function renameRow(row: BookmarkRow): void {
    if (row.pending) return;
    void commands.run('bookmark.rename', { docId: row.docId, line: row.line });
  }

  async function clearAll(): Promise<void> {
    await clearAllRows({
      rows: () => rows,
      act: actions,
      confirm: (count) =>
        dialogs.confirm({
          title: t('bookmarks.clearAllTitle'),
          message: t('bookmarks.clearAllConfirm', { count }),
          ok: t('bookmarks.clearAllOk'),
        }),
      said: (count) => status.show(t('bookmarks.cleared', { count })),
    });
  }
</script>

<div class="bookmarks" data-testid="bookmarks-panel" data-count={rows.length} role="region" aria-label={t('bookmarks.panelLabel')}>
  {#if rows.length === 0}
    <p class="hint" data-testid="bookmarks-empty">
      {toggleKey === null ? t('bookmarks.emptyNoKey') : t('bookmarks.emptyKey', { key: toggleKey })}
    </p>
  {:else}
    <div class="head">
      <span class="count">{t('bookmarks.panelTitle')} ({rows.length})</span>
      <button type="button" class="clear" data-testid="bookmarks-clear-all" onclick={() => void clearAll()}>
        {t('bookmarks.clearAll')}
      </button>
    </div>
    <ul class="rows">
      {#each rows as row (`${row.docId}:${row.line}`)}
        <li
          class="row"
          data-testid="bookmark-row"
          data-doc-id={row.docId}
          data-line={row.line}
          data-named={row.name !== undefined ? 'true' : 'false'}
          data-pending={row.pending ? '1' : '0'}
        >
          <button
            type="button"
            class="jump"
            title={row.pending ? `${row.path ?? row.file}\n${t('bookmarks.pendingTip')}` : (row.path ?? row.file)}
            aria-label={t('bookmarks.jump', { line: row.line, file: row.file })}
            onclick={() => jump(row)}
          >
            <span class="where">
              <span class="file">{row.file}</span>
              <span class="line">{t('bookmarks.lineLabel', { line: row.line })}</span>
            </span>
            <span class="name" data-testid="bookmark-row-name" ondblclick={() => renameRow(row)} role="presentation">{row.name ?? ''}</span>
            <span class="text">{row.text}</span>
          </button>
          <button
            type="button"
            class="tool"
            title={t('bookmarks.renameRow')}
            aria-label={t('bookmarks.renameRow')}
            disabled={row.pending}
            onclick={() => renameRow(row)}
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            class="tool"
            data-testid="bookmark-row-delete"
            data-doc-id={row.docId}
            data-line={row.line}
            title={t('bookmarks.removeRow')}
            aria-label={t('bookmarks.removeRow')}
            onclick={() => removeRow(actions, row)}
          >
            <X size={13} />
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .bookmarks {
    padding: 6px 8px;
    font-size: 12px;
    color: var(--text-main);
  }

  .hint {
    margin: 6px 2px;
    color: var(--text-muted);
    font-style: italic;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 2px 2px 6px;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .clear {
    padding: 2px 8px;
    color: var(--text-main);
    font: inherit;
    font-size: 11px;
    letter-spacing: normal;
    text-transform: none;
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 2px;
    cursor: pointer;
  }
  .clear:hover {
    background-color: var(--surface-hover);
    border-color: var(--surface-hover-border);
  }
  .clear:focus-visible,
  .jump:focus-visible,
  .tool:focus-visible {
    outline: 1px solid var(--accent-text);
    outline-offset: -1px;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .row {
    display: flex;
    align-items: stretch;
    border-radius: 2px;
  }
  .row:hover {
    background-color: var(--surface-hover);
  }
  .row[data-pending='1'] .text {
    display: none;
  }

  .jump {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    padding: 3px 6px;
    color: inherit;
    font: inherit;
    text-align: left;
    background: transparent;
    border: 0;
    border-radius: 2px;
    cursor: pointer;
  }

  .where {
    display: flex;
    align-items: baseline;
    gap: 8px;
    color: var(--text-muted);
    font-size: 11px;
  }
  .file {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .line {
    flex: 0 0 auto;
    margin-left: auto;
    color: var(--accent-text);
  }

  .name {
    overflow: hidden;
    color: var(--text-active);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name:empty {
    display: none;
  }

  .text {
    overflow: hidden;
    color: var(--text-main);
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .text:empty {
    display: none;
  }

  .tool {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    padding: 0 5px;
    color: var(--text-muted);
    background: transparent;
    border: 0;
    border-radius: 2px;
    cursor: pointer;
    opacity: 0;
  }
  .row:hover .tool,
  .row:focus-within .tool {
    opacity: 1;
  }
  .tool:hover:not(:disabled) {
    color: var(--text-active);
  }
  .tool:disabled {
    color: var(--text-disabled);
    cursor: default;
  }
</style>
