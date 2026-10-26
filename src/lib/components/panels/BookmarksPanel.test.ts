// The bookmark panel (Phase 4 plan §6.5 rule 5, P4.13): the markup contract the runtime harness
// reads (`bookmarks-panel`, `bookmark-row`, `bookmark-row-name`, `bookmark-row-delete`,
// `bookmarks-clear-all`, `bookmarks-empty`) and what the rows, the jump, the delete and Clear All
// do. Rendered with `svelte/server`, so there is no DOM and no `onMount`: the stores and services
// are fakes the test sets; the logic that clicks reach is in the component's module script and is
// called here directly.

import { render } from 'svelte/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatKey } from '$lib/core/keys/keySpec';
import { hasKey } from '$lib/i18n';
import { isMacPlatform } from '$lib/utils/platform';
import type { BookmarkInfo, DocId } from '$lib/app/types';

interface Doc {
  id: DocId;
  title: string;
  path: string | null;
}

const fake = vi.hoisted(() => ({
  infos: new Map<string, BookmarkInfo[]>(),
  models: new Set<string>(),
  memos: new Map<string, { bookmarks: number[]; bookmarkNames?: unknown }>(),
  toggleKeys: 'Mod+F2' as string | undefined,
}));

vi.mock('$lib/monaco/bookmarks', () => ({
  bookmarks: {
    list: (id: string) => fake.infos.get(id) ?? [],
    remove: () => true,
    clear: () => {},
    onDidChange: () => () => {},
  },
}));
vi.mock('$lib/monaco/editorService', () => ({
  editor: {
    hasModel: (id: string) => fake.models.has(id),
    reveal: () => {},
    onDidCreateModel: () => () => {},
  },
}));
vi.mock('$lib/stores/documents', async () => {
  const { writable: w } = await import('svelte/store');
  const list = w<unknown[]>([]);
  return { docs: { list, activate: () => {}, __set: (docs: unknown[]) => list.set(docs) } };
});
vi.mock('$lib/stores/fileMemory', () => ({
  fileMemory: { get: (path: string) => fake.memos.get(path), remember: () => {} },
}));
vi.mock('$lib/app/dialogs', () => ({ dialogs: { confirm: async () => true } }));
vi.mock('$lib/app/status', () => ({ status: { show: () => {} } }));
vi.mock('$lib/app/registry/commands', () => ({
  commands: { get: () => (fake.toggleKeys === undefined ? undefined : { keys: fake.toggleKeys }), run: async () => true },
}));

const panel = await import('./BookmarksPanel.svelte');
const BookmarksPanel = panel.default;
const { collectRows, removeRow, clearRows, clearAllRows, jumpToRow, JUMP_WAIT_MS } = panel;
const { docs } = (await import('$lib/stores/documents')) as unknown as { docs: { __set(docs: Doc[]): void } };

const info = (docId: DocId, line: number, text: string, name?: string): BookmarkInfo => (name === undefined ? { docId, line, text } : { docId, line, text, name });

function setDocs(list: Doc[]): void {
  docs.__set(list);
}

beforeEach(() => {
  fake.infos.clear();
  fake.models.clear();
  fake.memos.clear();
  fake.toggleKeys = 'Mod+F2';
  setDocs([]);
});

describe('collectRows', () => {
  const sources = (list: Doc[]) => ({
    docs: list,
    hasModel: (id: DocId) => fake.models.has(id),
    list: (id: DocId) => fake.infos.get(id) ?? [],
    memo: (path: string) => fake.memos.get(path),
  });

  it('lists the bookmarks of every open document in tab order, then by line', () => {
    fake.models.add('b');
    fake.models.add('a');
    fake.infos.set('a', [info('a', 3, 'G1 X1'), info('a', 9, 'M30', 'End')]);
    fake.infos.set('b', [info('b', 1, 'O1')]);
    const rows = collectRows(
      sources([
        { id: 'b', title: 'b.nc', path: '/nc/b.nc' },
        { id: 'a', title: 'a.nc', path: null },
      ]),
    );
    expect(rows.map((r) => [r.docId, r.line, r.name, r.text, r.file, r.pending])).toEqual([
      ['b', 1, undefined, 'O1', 'b.nc', false],
      ['a', 3, undefined, 'G1 X1', 'a.nc', false],
      ['a', 9, 'End', 'M30', 'a.nc', false],
    ]);
    expect(rows[0].path).toBe('/nc/b.nc');
    expect(rows[1].path).toBeNull();
  });

  it('lists a tab without a model from its waiting memo: line and name, no text', () => {
    fake.memos.set('/nc/c.nc', { bookmarks: [20, 5], bookmarkNames: [{ line: 20, name: 'Late' }] });
    const rows = collectRows(sources([{ id: 'c', title: 'c.nc', path: '/nc/c.nc' }]));
    expect(rows.map((r) => [r.line, r.name, r.text, r.pending])).toEqual([
      [5, undefined, '', true],
      [20, 'Late', '', true],
    ]);
  });

  it('lists a tab that has its model but was never shown from its waiting memo, not from the editor (a restored session)', () => {
    // The tab came back with the session: `fileOps` made its model at once, but the editor knows none of its
    // bookmarks until the tab is shown. Without `waiting` the panel listed nothing for it.
    fake.models.add('c');
    fake.models.add('d');
    fake.memos.set('/nc/c.nc', { bookmarks: [4, 6], bookmarkNames: [{ line: 4, name: 'Tool one' }] });
    fake.infos.set('d', [info('d', 3, 'N100 G90', 'Front tab')]);
    const rows = collectRows({
      docs: [
        { id: 'c', title: 'c.nc', path: '/nc/c.nc' },
        { id: 'd', title: 'd.nc', path: '/nc/d.nc' },
      ],
      hasModel: (id) => fake.models.has(id),
      waiting: (id) => id === 'c',
      list: (id) => fake.infos.get(id) ?? [],
      memo: (path) => fake.memos.get(path),
    });
    expect(rows.map((r) => [r.docId, r.line, r.name, r.text, r.pending])).toEqual([
      ['c', 4, 'Tool one', '', true],
      ['c', 6, undefined, '', true],
      ['d', 3, 'Front tab', 'N100 G90', false],
    ]);
  });

  it('reads the memo as untrusted: a name that is not one, a name of a line that is not a bookmark', () => {
    fake.memos.set('/nc/c.nc', {
      bookmarks: [5],
      bookmarkNames: [{ line: 5, name: 'x'.repeat(61) }, { line: 6, name: 'orphan' }, 'junk'],
    });
    const rows = collectRows(sources([{ id: 'c', title: 'c.nc', path: '/nc/c.nc' }]));
    expect(rows.map((r) => [r.line, r.name])).toEqual([[5, undefined]]);
  });

  it('lists nothing for a tab without a model that has no path or no memo, or a document without bookmarks', () => {
    fake.models.add('a');
    const rows = collectRows(
      sources([
        { id: 'a', title: 'a.nc', path: '/nc/a.nc' },
        { id: 'u', title: 'Untitled-1', path: null },
        { id: 'n', title: 'n.nc', path: '/nc/n.nc' },
      ]),
    );
    expect(rows).toEqual([]);
  });

  it('does not read the memo of a document that has a model (the editor is the truth)', () => {
    fake.models.add('a');
    fake.memos.set('/nc/a.nc', { bookmarks: [1, 2, 3] });
    expect(collectRows(sources([{ id: 'a', title: 'a.nc', path: '/nc/a.nc' }]))).toEqual([]);
  });
});

describe('the markup contract (plan §6.5 rule 5)', () => {
  function html(): string {
    return render(BookmarksPanel).body;
  }

  it('shows the empty text, with the key through the shortcut formatter, and no clear button', () => {
    const out = html();
    expect(out).toContain('data-testid="bookmarks-panel"');
    expect(out).toContain('data-count="0"');
    expect(out).toContain('data-testid="bookmarks-empty"');
    expect(out).not.toContain('data-testid="bookmark-row"');
    expect(out).not.toContain('data-testid="bookmarks-clear-all"');
    expect(out).toContain(`No bookmarks yet. Toggle one with ${formatKey('Mod+F2', isMacPlatform())}.`);
  });

  it('says where to find Toggle Bookmark when it has no key', () => {
    fake.toggleKeys = undefined;
    expect(html()).toContain('No bookmarks yet. Use Toggle Bookmark on the Edit tab.');
  });

  it('draws a row per bookmark with its attributes, the name cell, the delete button and Clear All', () => {
    fake.models.add('a');
    fake.infos.set('a', [info('a', 3, 'G1 X1'), info('a', 9, 'M30', 'End')]);
    setDocs([{ id: 'a', title: 'a.nc', path: '/nc/a.nc' }]);
    const out = html();
    expect(out).toContain('data-count="2"');
    expect(out.match(/data-testid="bookmark-row"/g)).toHaveLength(2);
    expect(out).toContain('data-doc-id="a"');
    expect(out).toContain('data-line="3"');
    expect(out).toContain('data-line="9"');
    expect(out).toContain('data-named="false"');
    expect(out).toContain('data-named="true"');
    expect(out).toContain('data-pending="0"');
    expect(out.match(/data-testid="bookmark-row-name"/g)).toHaveLength(2);
    expect(out.match(/data-testid="bookmark-row-delete"/g)).toHaveLength(2);
    expect(out).toContain('data-testid="bookmarks-clear-all"');
    expect(out).toContain('End');
    expect(out).toContain('G1 X1');
    expect(out).toContain('a.nc');
    expect(out).toContain('Line 9');
    expect(out).not.toContain('data-testid="bookmarks-empty"');
  });

  it('marks a row of a tab without a model with data-pending="1" and takes its rename away', () => {
    fake.memos.set('/nc/c.nc', { bookmarks: [5], bookmarkNames: [{ line: 5, name: 'Late' }] });
    setDocs([{ id: 'c', title: 'c.nc', path: '/nc/c.nc' }]);
    const out = html();
    expect(out).toContain('data-pending="1"');
    expect(out).toContain('data-named="true"');
    expect(out).toMatch(/<button[^>]*disabled[^>]*aria-label="Rename bookmark"|<button[^>]*aria-label="Rename bookmark"[^>]*disabled/);
  });

  it('shows a name and a line text as text, never as markup', () => {
    fake.models.add('a');
    fake.infos.set('a', [info('a', 1, '<img src=x onerror=alert(1)>', '<b>bold</b>')]);
    setDocs([{ id: 'a', title: '<i>a</i>.nc', path: '/nc/a.nc' }]);
    const out = html();
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<b>bold</b>');
    expect(out).not.toContain('<i>a</i>');
    expect(out).toContain('&lt;b>bold&lt;/b>');
  });

  it('has a message for every key it uses', () => {
    for (const key of [
      'bookmarks.panelLabel',
      'bookmarks.emptyKey',
      'bookmarks.emptyNoKey',
      'bookmarks.lineLabel',
      'bookmarks.jump',
      'bookmarks.pendingTip',
      'bookmarks.removeRow',
      'bookmarks.renameRow',
      'bookmarks.clearAll',
      'bookmarks.clearAllTitle',
      'bookmarks.clearAllConfirm',
      'bookmarks.clearAllOk',
      'bookmarks.cleared',
    ]) {
      expect(hasKey(key), key).toBe(true);
    }
  });
});

describe('delete and Clear All', () => {
  function actions() {
    const log: string[] = [];
    const memos = new Map(fake.memos);
    return {
      log,
      memos,
      act: {
        remove: (id: DocId, line: number) => (log.push(`remove:${id}:${line}`), true),
        clear: (id: DocId) => void log.push(`clear:${id}`),
        memo: (path: string) => memos.get(path),
        remember: (path: string, patch: unknown) => void log.push(`remember:${path}:${JSON.stringify(patch)}`),
        changed: () => void log.push('changed'),
      },
    };
  }
  const row = (over: Partial<ReturnType<typeof collectRows>[number]> = {}) => ({
    docId: 'a',
    line: 3,
    text: '',
    file: 'a.nc',
    path: '/nc/a.nc',
    pending: false,
    ...over,
  });

  it('removes a bookmark of a document with a model through the service', () => {
    const h = actions();
    removeRow(h.act, row());
    expect(h.log).toEqual(['remove:a:3', 'changed']);
  });

  it('removes a bookmark of a tab without a model from its memo, the name with it', () => {
    fake.memos.set('/nc/c.nc', {
      bookmarks: [5, 9],
      bookmarkNames: [{ line: 5, name: 'Five' }, { line: 9, name: 'Nine' }],
    });
    const h = actions();
    removeRow(h.act, row({ docId: 'c', line: 5, path: '/nc/c.nc', pending: true }));
    expect(h.log).toEqual(['remember:/nc/c.nc:{"bookmarks":[9],"bookmarkNames":[{"line":9,"name":"Nine"}]}', 'changed']);

    // The last one: no names member at all.
    fake.memos.set('/nc/c.nc', { bookmarks: [5], bookmarkNames: [{ line: 5, name: 'Five' }] });
    const last = actions();
    removeRow(last.act, row({ docId: 'c', line: 5, path: '/nc/c.nc', pending: true }));
    expect(last.log).toEqual(['remember:/nc/c.nc:{"bookmarks":[]}', 'changed']);
  });

  it('does nothing for a tab without a model that has no memo or no path', () => {
    const h = actions();
    removeRow(h.act, row({ pending: true, path: null }));
    removeRow(h.act, row({ pending: true, path: '/nc/none.nc' }));
    expect(h.log).toEqual([]);
  });

  it('clears each document once: the service for a model, the memo for a waiting tab', () => {
    const h = actions();
    clearRows(h.act, [
      row({ docId: 'a', line: 3 }),
      row({ docId: 'a', line: 9 }),
      row({ docId: 'c', line: 5, path: '/nc/c.nc', pending: true }),
      row({ docId: 'c', line: 6, path: '/nc/c.nc', pending: true }),
      row({ docId: 'u', line: 1, path: null, pending: true }),
    ]);
    // `changed` once, after all of them: the panel reads its rows again (a waiting memo has no change event).
    expect(h.log).toEqual(['clear:a', 'remember:/nc/c.nc:{"bookmarks":[]}', 'changed']);
  });

  it('asks once, names the count, and clears only on a yes', async () => {
    const h = actions();
    const asked: number[] = [];
    const said: number[] = [];
    const rows = [row({ line: 3 }), row({ line: 9 }), row({ docId: 'b', line: 1 })];
    const args = (answer: boolean) => ({
      rows: () => rows,
      act: h.act,
      confirm: async (count: number) => (asked.push(count), answer),
      said: (count: number) => void said.push(count),
    });

    expect(await clearAllRows(args(false))).toBe(false);
    expect(asked).toEqual([3]);
    expect(h.log).toEqual([]);
    expect(said).toEqual([]);

    expect(await clearAllRows(args(true))).toBe(true);
    expect(asked).toEqual([3, 3]);
    expect(h.log).toEqual(['clear:a', 'clear:b', 'changed']);
    expect(said).toEqual([3]);
  });

  it('does not ask when there is nothing to clear', async () => {
    const asked: number[] = [];
    const result = await clearAllRows({
      rows: () => [],
      act: actions().act,
      confirm: async (count) => (asked.push(count), true),
      said: () => {},
    });
    expect(result).toBe(false);
    expect(asked).toEqual([]);
  });

  it('reads the rows again after the question: a bookmark removed meanwhile is not cleared twice, one added meanwhile is', async () => {
    const h = actions();
    let rows = [row({ line: 3 })];
    const result = await clearAllRows({
      rows: () => rows,
      act: h.act,
      confirm: async () => {
        rows = [row({ docId: 'b', line: 1 })];
        return true;
      },
      said: () => {},
    });
    expect(result).toBe(true);
    expect(h.log).toEqual(['clear:b', 'changed']);
  });
});

describe('the jump', () => {
  function deps(over: { hasModel?: (id: DocId) => boolean } = {}) {
    const log: string[] = [];
    let created: ((id: DocId) => void) | undefined;
    let stopped = 0;
    let deferred: (() => void)[] = [];
    let timer: { fn: () => void; ms: number; cancelled: boolean } | undefined;
    const d = {
      hasModel: over.hasModel ?? (() => true),
      reveal: (id: DocId, line: number) => void log.push(`reveal:${id}:${line}`),
      activate: (id: DocId) => void log.push(`activate:${id}`),
      onDidCreateModel: (cb: (id: DocId) => void) => {
        created = cb;
        return () => void (stopped += 1);
      },
      defer: (fn: () => void) => void deferred.push(fn),
      after: (fn: () => void, ms: number) => {
        timer = { fn, ms, cancelled: false };
        const mine = timer;
        return () => void (mine.cancelled = true);
      },
    };
    return {
      d,
      log,
      fireCreate: (id: DocId) => created?.(id),
      runDeferred: () => {
        const run = deferred;
        deferred = [];
        run.forEach((fn) => fn());
      },
      get stopped() {
        return stopped;
      },
      get timer() {
        return timer;
      },
    };
  }
  const target = { docId: 'a', line: 12, text: '', file: 'a.nc', path: '/nc/a.nc', pending: false };

  it('reveals the line of a document that has a model (the editor brings the tab to the front)', () => {
    const h = deps();
    jumpToRow(h.d, target);
    expect(h.log).toEqual(['reveal:a:12']);
  });

  it('shows a tab without a model first, and reveals the line once its model exists, after the session restored the cursor', () => {
    const h = deps({ hasModel: () => false });
    jumpToRow(h.d, { ...target, pending: true });
    expect(h.log).toEqual(['activate:a']);
    expect(h.timer?.ms).toBe(JUMP_WAIT_MS);

    h.fireCreate('other');
    h.runDeferred();
    expect(h.log).toEqual(['activate:a']);

    h.fireCreate('a');
    expect(h.log).toEqual(['activate:a']);
    h.runDeferred();
    expect(h.log).toEqual(['activate:a', 'reveal:a:12']);
    expect(h.stopped).toBe(1);
    expect(h.timer?.cancelled).toBe(true);
  });

  it('shows a pending tab that has its model first and reveals the line after the session put its cursor back', () => {
    const h = deps({ hasModel: () => true });
    jumpToRow(h.d, { ...target, pending: true });
    expect(h.log).toEqual(['activate:a']);
    h.runDeferred();
    expect(h.log).toEqual(['activate:a', 'reveal:a:12']);
  });

  it('reveals at once when showing the tab made the model, and gives up waiting after five seconds', () => {
    let has = false;
    const h = deps({ hasModel: () => has });
    h.d.activate = (id) => {
      h.log.push(`activate:${id}`);
      has = true;
    };
    jumpToRow(h.d, { ...target, pending: true });
    expect(h.log).toEqual(['activate:a', 'reveal:a:12']);
    expect(h.stopped).toBe(1);

    const slow = deps({ hasModel: () => false });
    jumpToRow(slow.d, { ...target, pending: true });
    slow.timer?.fn();
    expect(slow.stopped).toBe(1);
  });
});
