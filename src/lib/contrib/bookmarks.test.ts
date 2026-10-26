// What the bookmark contribution declares (plan §5 WP4.4, §7.11).
//
// The three shortcuts and the two Monaco bindings they take over are a contract: a key
// §7.11 does not list, or a Monaco default left in place underneath one of ours, is a
// conflict the command registry reports as a `console.error` and the runtime harness
// turns into a failed scenario. Same reasoning as `navigation.test.ts` (WP3.5).

import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { panels, resetPanelsForTest } from '$lib/app/registry/panels';
import { defaultLayout, layout } from '$lib/stores/layout';
import type { BookmarkInfo, BookmarkMatchesAnswer, CommandDef, DocId, Msg, RibbonItemDef } from '$lib/app/types';

const fake = vi.hoisted(() => {
  let lines: number[] = [];
  return {
    activeId: 'd1' as DocId | null,
    /** `null` is a `status.clear()`: the bar was emptied, not written to. */
    messages: [] as (string | null)[],
    /** `{ error: true }` of the messages, by index in `messages` (a `status.clear()` is not one). */
    errors: [] as boolean[],
    calls: [] as string[],
    cursorLine: 12 as number | undefined,
    /** What the prompt is asked and what it answers (`undefined` is cancel). */
    prompts: [] as { title: string; initial?: string; placeholder?: string; validate?: (v: string) => Msg | null }[],
    promptAnswer: undefined as string | undefined,
    infos: [] as BookmarkInfo[],
    matches: { ok: true, marked: 0, already: 0 } as BookmarkMatchesAnswer,
    setNameResult: null as string | null,
    toggleResult: undefined as 'set' | 'removed' | 'full' | 'none' | undefined,
    installs: 0,
    uninstalls: 0,
    monacoResolved: false,
    setLines(next: number[]): void {
      lines = [...next];
    },
    reset(): void {
      fake.activeId = 'd1';
      fake.messages = [];
      fake.errors = [];
      fake.calls = [];
      fake.cursorLine = 12;
      fake.prompts = [];
      fake.promptAnswer = undefined;
      fake.infos = [];
      fake.matches = { ok: true, marked: 0, already: 0 };
      fake.setNameResult = null;
      fake.toggleResult = undefined;
      fake.installs = 0;
      fake.uninstalls = 0;
      lines = [];
    },
    bookmarks: {
      toggle(id?: string, line?: number): 'set' | 'removed' | 'full' | 'none' | undefined {
        fake.calls.push(id === undefined ? 'toggle' : `toggle:${id}:${line}`);
        return fake.toggleResult;
      },
      list: (): BookmarkInfo[] => [...fake.infos],
      setName(id: string, line: number, name: string | null): string | null {
        fake.calls.push(`setName:${id}:${line}:${name}`);
        return fake.setNameResult;
      },
      addAllMatches(): BookmarkMatchesAnswer {
        fake.calls.push('addAllMatches');
        return fake.matches;
      },
      next(): void {
        fake.calls.push('next');
      },
      prev(): void {
        fake.calls.push('prev');
      },
      clear(): void {
        fake.calls.push('clear');
        lines = [];
      },
      lines: (): number[] => [...lines],
      install(): () => void {
        fake.installs += 1;
        return () => {
          fake.uninstalls += 1;
        };
      },
    },
  };
});

vi.mock('$lib/monaco/bookmarks', () => ({ bookmarks: fake.bookmarks }));
vi.mock('$lib/monaco/editorService', () => ({
  editor: { ready: Promise.resolve(), cursor: () => (fake.cursorLine === undefined ? null : { line: fake.cursorLine }) },
}));
vi.mock('$lib/app/modals', () => ({
  modals: {
    prompt: async (o: { title: string; initial?: string; placeholder?: string; validate?: (v: string) => Msg | null }) => {
      fake.prompts.push(o);
      return fake.promptAnswer;
    },
  },
}));
vi.mock('$lib/monaco/setup', () => ({
  getMonaco: async () => {
    fake.monacoResolved = true;
    return {};
  },
}));
vi.mock('$lib/stores/documents', () => ({ docs: { getActiveId: (): DocId | null => fake.activeId } }));
vi.mock('$lib/app/status', () => ({
  status: {
    show: (text: string, o?: { error?: boolean }) => {
      fake.messages.push(text);
      fake.errors.push(o?.error === true);
    },
    // A jump that worked clears whatever was on the bar, so an older error is
    // never left standing as the answer to it (G8 M5). `null` is what the tests
    // read as "nothing is showing".
    clear: () => fake.messages.push(null),
  },
}));

const bookmarksModule = await import('./bookmarks');
const bookmarksContrib = bookmarksModule.default;
const { toggleBookmarksPanel, BOOKMARKS_PANEL_ID } = bookmarksModule;
const { hasKey, t } = await import('$lib/i18n');

const byId = new Map<string, CommandDef>((bookmarksContrib.commands ?? []).map((def) => [def.id, def]));
const run = async (id: string, arg?: unknown): Promise<void> => {
  await byId.get(id)?.run({ activeDocId: fake.activeId } as never, arg);
};

const originalToggle = fake.bookmarks.toggle;

beforeEach(() => {
  fake.reset();
  // The toggle cases below swap in their own `toggle`; the later ones start from the recording one.
  fake.bookmarks.toggle = originalToggle;
});

describe('commands', () => {
  it('registers exactly the bookmark commands, with the shortcuts of plan §7.11', () => {
    expect([...byId.keys()]).toEqual([
      'bookmark.toggle',
      'bookmark.next',
      'bookmark.prev',
      'bookmark.clear',
      'bookmark.rename',
      'bookmark.addAllMatches',
      'view.toggleBookmarks',
    ]);
    expect(Object.fromEntries([...byId].map(([id, def]) => [id, def.keys ?? null]))).toEqual({
      'bookmark.toggle': 'Mod+F2',
      'bookmark.next': 'F2',
      'bookmark.prev': 'Shift+F2',
      'bookmark.clear': null,
      'bookmark.rename': null,
      'bookmark.addAllMatches': null,
      'view.toggleBookmarks': null,
    });
  });

  it('runs outside the editor too, and only with a document', () => {
    for (const def of byId.values()) {
      expect(def.global, def.id).toBe(true);
      // The panel toggle needs no document (it is the Inspector's toggle again).
      if (def.id === 'view.toggleBookmarks') {
        expect(def.enabled, def.id).toBeUndefined();
        continue;
      }
      expect(def.enabled?.({ activeDocId: null } as never), def.id).toBe(false);
      expect(def.enabled?.({ activeDocId: 'd1' } as never), def.id).toBe(true);
    }
  });

  it('stays in the palette, because Monaco has nothing of its own to list', () => {
    for (const def of byId.values()) expect(def.palette, def.id).toBeUndefined();
  });

  it('has a message for every title and category it names', () => {
    for (const def of byId.values()) {
      expect(hasKey(def.title), def.title).toBe(true);
      expect(def.category !== undefined && hasKey(def.category), def.id).toBe(true);
    }
  });
});

describe('keybinding removals', () => {
  it('drops the two Monaco defaults that sit on F2 and Mod+F2', () => {
    expect(bookmarksContrib.keybindingRemovals).toEqual([
      { keys: 'F2', command: 'editor.action.rename' },
      { keys: 'Mod+F2', command: 'editor.action.changeAll' },
    ]);
  });

  it('leaves every other Monaco binding alone (Mod+Shift+L stays select-all-occurrences)', () => {
    const removed = (bookmarksContrib.keybindingRemovals ?? []).map((r) => r.keys);
    expect(removed).not.toContain('Mod+Shift+L');
  });
});

describe('toggle', () => {
  it('says which way it went', async () => {
    fake.bookmarks.toggle = () => {
      fake.calls.push('toggle');
      fake.setLines([12]);
      return 'set';
    };
    await run('bookmark.toggle');
    expect(fake.calls).toEqual(['toggle']);
    expect(fake.messages).toEqual([t('bookmarks.set')]);

    fake.bookmarks.toggle = () => {
      fake.calls.push('toggle');
      fake.setLines([]);
      return 'removed';
    };
    await run('bookmark.toggle');
    expect(fake.messages.at(-1)).toBe(t('bookmarks.removed'));
  });

  it('refuses a 201st bookmark with a message, and does not claim it set one', async () => {
    fake.toggleResult = 'full';
    fake.setLines(Array.from({ length: 200 }, (_, i) => i + 1));
    await run('bookmark.toggle');
    expect(fake.messages).toEqual([t('bookmarks.full', { max: 200 })]);
    expect(fake.errors).toEqual([true]);
    expect(t('bookmarks.full', { max: 200 })).toContain('200');
  });

  it('does nothing without a document', async () => {
    fake.activeId = null;
    await run('bookmark.toggle');
    expect(fake.calls).toEqual([]);
    expect(fake.messages).toEqual([]);
  });
});

describe('next and previous', () => {
  it('step through the bookmarks', async () => {
    fake.setLines([4, 12]);
    await run('bookmark.next');
    await run('bookmark.prev');
    expect(fake.calls).toEqual(['next', 'prev']);
    // Each jump clears the bar instead of saying anything, so "Bookmark set." from the
    // command before it does not sit there reading as the answer (G8 M5).
    expect(fake.messages).toEqual([null, null]);
  });

  it('say so instead of doing nothing when the document has none', async () => {
    await run('bookmark.next');
    await run('bookmark.prev');
    expect(fake.calls).toEqual([]);
    expect(fake.messages).toEqual([t('bookmarks.none'), t('bookmarks.none')]);
  });
});

describe('clear', () => {
  it('reports how many it removed, with the right plural', async () => {
    fake.setLines([4]);
    await run('bookmark.clear');
    expect(fake.messages.at(-1)).toBe('Removed 1 bookmark.');

    fake.setLines([4, 12, 20]);
    await run('bookmark.clear');
    expect(fake.messages.at(-1)).toBe('Removed 3 bookmarks.');
    expect(fake.calls).toEqual(['clear', 'clear']);
  });

  it('says there is nothing to clear rather than showing "removed 0"', async () => {
    await run('bookmark.clear');
    expect(fake.calls).toEqual([]);
    expect(fake.messages).toEqual([t('bookmarks.none')]);
  });
});

describe('activate', () => {
  it('hands Monaco to the decoration service once the editor is ready, and undoes it', async () => {
    const dispose = bookmarksContrib.activate();
    expect(fake.installs).toBe(0); // not before the editor is ready
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.monacoResolved).toBe(true);
    expect(fake.installs).toBe(1);

    (dispose as () => void)();
    expect(fake.uninstalls).toBe(1);
  });

  it('installs nothing when it is disposed before Monaco arrives', async () => {
    const dispose = bookmarksContrib.activate();
    (dispose as () => void)();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.installs).toBe(0);
    expect(fake.uninstalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------
// P4c (plan §6.5 rules 4 to 6; P4.13)
// ---------------------------------------------------------------------------------------

describe('the ribbon group and the panel (rule 5)', () => {
  const ribbon = (bookmarksContrib.ribbon ?? []) as RibbonItemDef[];

  it('puts the Bookmarks group on the Edit tab at orders 142 to 147, after Go To (140) and before Typing (150)', () => {
    const edit = ribbon.filter((item) => item.tab === 'edit');
    expect(edit.map((item) => [item.group, item.command, item.order])).toEqual([
      ['bookmarks.group', 'bookmark.toggle', 142],
      ['bookmarks.group', 'bookmark.next', 143],
      ['bookmarks.group', 'bookmark.prev', 144],
      ['bookmarks.group', 'bookmark.rename', 145],
      ['bookmarks.group', 'bookmark.addAllMatches', 146],
      ['bookmarks.group', 'view.toggleBookmarks', 147],
    ]);
    expect(hasKey('bookmarks.group')).toBe(true);
    for (const item of ribbon) expect(byId.has(item.command), item.command).toBe(true);
  });

  it('adds the panel toggle to the View tab, in the Panels group', () => {
    const view = ribbon.filter((item) => item.tab === 'view');
    expect(view).toEqual([{ tab: 'view', group: 'view.groupPanels', command: 'view.toggleBookmarks', order: 16 }]);
  });

  it('registers the panel in the left region at order 15, between the Program Map (10) and the Inspector (20)', () => {
    const panel = (bookmarksContrib.panels ?? [])[0];
    expect([panel.id, panel.region, panel.title, panel.order]).toEqual(['bookmarks', 'left', 'bookmarks.panelTitle', 15]);
    expect(hasKey(panel.title)).toBe(true);
    expect(BOOKMARKS_PANEL_ID).toBe('bookmarks');
  });

  it('shows the panel on the first toggle and the panel it replaced on the second', () => {
    resetPanelsForTest();
    layout.restore(defaultLayout());
    const noop = {} as never;
    panels.add({ id: 'programMap', region: 'left', title: 'programMap.title', component: noop, order: 10 });
    for (const def of bookmarksContrib.panels ?? []) panels.add(def);

    toggleBookmarksPanel();
    expect(get(layout.state).left).toMatchObject({ visible: true, active: 'bookmarks' });
    toggleBookmarksPanel();
    expect(get(layout.state).left).toMatchObject({ visible: true, active: 'programMap' });
    toggleBookmarksPanel();
    expect(get(layout.state).left.active).toBe('bookmarks');

    // With nothing else in the region, the second toggle hides it.
    resetPanelsForTest();
    for (const def of bookmarksContrib.panels ?? []) panels.add(def);
    toggleBookmarksPanel();
    expect(get(layout.state).left.visible).toBe(false);
    resetPanelsForTest();
  });
});

describe('rename (rule 4)', () => {
  it('refuses a line without a bookmark in a full document before it asks for a name', async () => {
    fake.setLines(Array.from({ length: 200 }, (_, i) => i + 1));
    fake.cursorLine = 250;
    fake.promptAnswer = 'Too many';
    await run('bookmark.rename');
    expect(fake.prompts).toEqual([]);
    expect(fake.calls).toEqual([]);
    expect(fake.messages).toEqual([t('bookmarks.full', { max: 200 })]);
    expect(fake.errors).toEqual([true]);
    // A line that has a bookmark can still be named.
    fake.cursorLine = 5;
    fake.setNameResult = 'Too many';
    await run('bookmark.rename');
    expect(fake.calls).toEqual(['setName:d1:5:Too many']);
  });

  it('asks for the name with the current one filled in, and sets it on the cursor line', async () => {
    fake.cursorLine = 12;
    fake.infos = [{ docId: 'd1', line: 12, name: 'Old', text: 'G1' }];
    fake.promptAnswer = 'Drill 6';
    fake.setNameResult = 'Drill 6';
    await run('bookmark.rename');
    expect(fake.prompts).toHaveLength(1);
    expect(fake.prompts[0].initial).toBe('Old');
    expect(fake.prompts[0].title).toBe(t('bookmarks.renameTitle'));
    expect(fake.calls).toEqual(['setName:d1:12:Drill 6']);
    expect(fake.messages).toEqual([t('bookmarks.named', { name: 'Drill 6' })]);
  });

  it('starts with an empty field when the line has no bookmark or no name', async () => {
    fake.promptAnswer = undefined;
    await run('bookmark.rename');
    expect(fake.prompts[0].initial).toBe('');
    fake.infos = [{ docId: 'd1', line: 12, text: '' }];
    await run('bookmark.rename');
    expect(fake.prompts[1].initial).toBe('');
  });

  it('does nothing when the prompt is cancelled', async () => {
    fake.promptAnswer = undefined;
    await run('bookmark.rename');
    expect(fake.calls).toEqual([]);
    expect(fake.messages).toEqual([]);
  });

  it('removes the name and keeps the bookmark on an empty answer', async () => {
    fake.setLines([12]);
    fake.infos = [{ docId: 'd1', line: 12, name: 'Old', text: '' }];
    fake.promptAnswer = '   ';
    await run('bookmark.rename');
    expect(fake.calls).toEqual(['setName:d1:12:null']);
    expect(fake.messages).toEqual([t('bookmarks.nameRemoved')]);
  });

  it('says nothing and changes nothing on an empty answer for a bookmark that has no name', async () => {
    fake.setLines([12]);
    fake.infos = [{ docId: 'd1', line: 12, text: '' }];
    fake.promptAnswer = '';
    await run('bookmark.rename');
    expect(fake.calls).toEqual([]);
  });

  it('sets the bookmark on an empty answer when the line has none', async () => {
    fake.promptAnswer = '';
    await run('bookmark.rename');
    expect(fake.calls).toEqual(['toggle:d1:12']);
    expect(fake.messages).toEqual([t('bookmarks.set')]);
  });

  it('names the bookmark of the row it is given (the panel), not the cursor line', async () => {
    fake.infos = [{ docId: 'd2', line: 40, name: 'Row', text: '' }];
    fake.promptAnswer = 'Renamed';
    fake.setNameResult = 'Renamed';
    await run('bookmark.rename', { docId: 'd2', line: 40 });
    expect(fake.prompts[0].initial).toBe('Row');
    expect(fake.calls).toEqual(['setName:d2:40:Renamed']);
  });

  it('takes a bad argument for none, and does nothing without a cursor or a document', async () => {
    fake.promptAnswer = 'x';
    fake.cursorLine = undefined;
    await run('bookmark.rename', { docId: 3, line: 'x' });
    await run('bookmark.rename', { docId: 'd2', line: 0 });
    expect(fake.prompts).toEqual([]);
    fake.cursorLine = 5;
    fake.activeId = null;
    await run('bookmark.rename');
    expect(fake.prompts).toEqual([]);
  });

  it('refuses a name over 60 characters in the prompt, naming the limit, and one with a control character', async () => {
    fake.promptAnswer = undefined;
    await run('bookmark.rename');
    const validate = fake.prompts[0].validate!;
    expect(validate('Roughing')).toBeNull();
    expect(validate('')).toBeNull();
    expect(validate('x'.repeat(60))).toBeNull();
    expect(validate('x'.repeat(61))).toEqual({ key: 'bookmarks.nameTooLong', params: { max: 60 } });
    expect(validate('a\u0007b')).toEqual({ key: 'bookmarks.nameInvalid' });
    expect(hasKey('bookmarks.nameTooLong')).toBe(true);
    expect(t('bookmarks.nameTooLong', { max: 60 })).toContain('60');
    expect(hasKey('bookmarks.nameInvalid')).toBe(true);
  });
});

describe('addAllMatches (rule 6)', () => {
  it('says how many lines it bookmarked, with the right plural and the lines that had one', async () => {
    fake.matches = { ok: true, marked: 12, already: 0 };
    await run('bookmark.addAllMatches');
    fake.matches = { ok: true, marked: 1, already: 0 };
    await run('bookmark.addAllMatches');
    fake.matches = { ok: true, marked: 9, already: 3 };
    await run('bookmark.addAllMatches');
    expect(fake.messages).toEqual(['Bookmarked 12 lines.', 'Bookmarked 1 line.', 'Bookmarked 12 lines (3 already had one).']);
    expect(fake.errors).toEqual([false, false, false]);
  });

  it('says so when every matching line had a bookmark already', async () => {
    fake.matches = { ok: true, marked: 0, already: 4 };
    await run('bookmark.addAllMatches');
    fake.matches = { ok: true, marked: 0, already: 1 };
    await run('bookmark.addAllMatches');
    expect(fake.messages).toEqual(['All 4 matching lines already have a bookmark.', 'This line already has a bookmark.']);
  });

  it('says why nothing was marked, in plain words', async () => {
    fake.matches = { ok: false, reason: 'noSearch' };
    await run('bookmark.addAllMatches');
    fake.matches = { ok: false, reason: 'noMatch', matches: 0 };
    await run('bookmark.addAllMatches');
    fake.matches = { ok: false, reason: 'noDocument' };
    await run('bookmark.addAllMatches');
    expect(fake.messages).toEqual([
      'Search for something first: open Find and type it.',
      'No line matches the search.',
      'Open a program first.',
    ]);
  });

  it('says "340 lines match, and a document keeps at most 200 bookmarks" for too many, as an error', async () => {
    fake.matches = { ok: false, reason: 'tooMany', matches: 340 };
    await run('bookmark.addAllMatches');
    expect(fake.messages).toEqual(['340 lines match, and a document keeps at most 200 bookmarks. Narrow the search.']);
    expect(fake.errors).toEqual([true]);
  });

  it('names the bookmarks that are there when the matches alone would fit', async () => {
    fake.setLines(Array.from({ length: 60 }, (_, i) => i + 1));
    fake.matches = { ok: false, reason: 'tooMany', matches: 150 };
    await run('bookmark.addAllMatches');
    expect(fake.messages).toEqual(['150 lines match, and this document already has 60 bookmarks. It keeps at most 200. Narrow the search.']);
  });

  it('is offered only with a document', () => {
    expect(byId.get('bookmark.addAllMatches')?.enabled?.({ activeDocId: null } as never)).toBe(false);
  });
});
