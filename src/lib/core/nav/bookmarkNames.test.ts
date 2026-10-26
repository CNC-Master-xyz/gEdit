// Bookmark names (Phase 4 plan §6.5 rules 4 to 6): the pure half and the memo. The service, the
// commands, the panel and the session have their own files next to them
// (`monaco/bookmarkNames.test.ts`, `contrib/bookmarks.test.ts`, `components/panels/BookmarksPanel.test.ts`,
// `app/session.test.ts`).

import { describe, expect, it, vi } from 'vitest';
import {
  MAX_BOOKMARKS,
  MAX_BOOKMARK_NAME,
  MAX_BOOKMARK_TEXT,
  bookmarkLimitReached,
  bookmarkNameProblem,
  bookmarkText,
  cleanBookmarkName,
  cleanBookmarkNames,
  memoMarks,
  namesOf,
  planMatches,
} from './bookmarks';
import { MAX_REMEMBERED_BOOKMARKS, MAX_REMEMBERED_BYTES, MAX_REMEMBERED_FILES, createFileMemory } from '$lib/stores/fileMemory';
import { sanitizeUiState } from '$lib/stores/uiState';
import type { FileMemo } from '$lib/app/types';

describe('bookmark names (limits)', () => {
  it('pins the limits of the contract; the session cap is the memo cap', () => {
    expect(MAX_BOOKMARKS).toBe(MAX_REMEMBERED_BOOKMARKS);
    expect(MAX_BOOKMARKS).toBe(200);
    expect(MAX_BOOKMARK_NAME).toBe(60);
    expect(MAX_BOOKMARK_TEXT).toBe(120);
  });
});

describe('cleanBookmarkName', () => {
  it('trims and makes every inner run of white space one blank', () => {
    expect(cleanBookmarkName('  Roughing  done  ')).toBe('Roughing done');
    expect(cleanBookmarkName('a   　 b')).toBe('a b');
    expect(cleanBookmarkName('Bohren')).toBe('Bohren');
  });

  it('refuses what is not a name: empty, blank, not a string', () => {
    for (const raw of ['', '   ', ' ', null, undefined, 5, {}, [], ['a'], true]) {
      expect(cleanBookmarkName(raw), String(raw)).toBeNull();
    }
  });

  it('refuses a control character, tab and line break included (never turned into a blank)', () => {
    for (const raw of ['a\u0000b', 'a\u0007b', 'a\tb', 'a\nb', 'a\rb', 'a\u007fb', 'a\u0085b', '\u001b[31mred']) {
      expect(cleanBookmarkName(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it('allows exactly 60 characters and refuses 61 (counted after the white space is made one blank)', () => {
    expect(cleanBookmarkName('x'.repeat(60))).toBe('x'.repeat(60));
    expect(cleanBookmarkName('x'.repeat(61))).toBeNull();
    // 60 after collapsing, 70 before: it is the cleaned name that counts.
    const padded = `${'x'.repeat(30)}${' '.repeat(11)}${'y'.repeat(29)}`;
    expect(cleanBookmarkName(padded)).toBe(`${'x'.repeat(30)} ${'y'.repeat(29)}`);
  });

  it('refuses a hand-edited name of millions of characters without splitting it into characters (CODE-18)', () => {
    const spy = vi.spyOn(Array, 'from');
    try {
      expect(cleanBookmarkName('x'.repeat(5_000_000))).toBeNull();
      expect(bookmarkNameProblem('x'.repeat(5_000_000))).toBe('tooLong');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('counts a character, not a UTF-16 unit', () => {
    expect(cleanBookmarkName('\u{1F527}'.repeat(60))).toBe('\u{1F527}'.repeat(60));
    expect(cleanBookmarkName('\u{1F527}'.repeat(61))).toBeNull();
  });

  it('keeps text that looks like markup as text', () => {
    expect(cleanBookmarkName('<b>"G54" & co</b>')).toBe('<b>"G54" & co</b>');
  });
});

describe('bookmarkNameProblem (what the prompt says)', () => {
  it('has no problem with a good name or an empty one (an empty answer removes the name)', () => {
    expect(bookmarkNameProblem('Roughing')).toBeNull();
    expect(bookmarkNameProblem('')).toBeNull();
    expect(bookmarkNameProblem('   ')).toBeNull();
  });

  it('names the limit problem and the control character problem, and agrees with cleanBookmarkName', () => {
    expect(bookmarkNameProblem('x'.repeat(61))).toBe('tooLong');
    expect(bookmarkNameProblem('a\u0007b')).toBe('control');
    for (const raw of ['x'.repeat(60), 'x'.repeat(61), 'a\tb', ' ok ', '']) {
      expect(bookmarkNameProblem(raw) === null && raw.trim() !== '', JSON.stringify(raw)).toBe(cleanBookmarkName(raw) !== null);
    }
  });
});

describe('cleanBookmarkNames (state.json is untrusted)', () => {
  const lines = [3, 7, 12];

  it('keeps good entries, cleaned and ascending by line', () => {
    const got = cleanBookmarkNames(
      [
        { line: 12, name: '  last ' },
        { line: 3, name: 'first' },
      ],
      lines,
    );
    expect(got).toEqual([
      { line: 3, name: 'first' },
      { line: 12, name: 'last' },
    ]);
  });

  it('is [] when the member is not an array', () => {
    for (const value of [undefined, null, 'x', 5, {}, { line: 3, name: 'a' }, true]) {
      expect(cleanBookmarkNames(value, lines), String(value)).toEqual([]);
    }
  });

  it('drops an entry that is not { line, name } with a line and a name', () => {
    const got = cleanBookmarkNames(
      [
        null,
        'x',
        7,
        [3, 'a'],
        { line: 3 },
        { name: 'no line' },
        { line: '3', name: 'string line' },
        { line: 0, name: 'zero' },
        { line: -1, name: 'negative' },
        { line: 2.5, name: 'fraction' },
        { line: 3, name: '' },
        { line: 3, name: '   ' },
        { line: 3, name: 5 },
        { line: 3, name: 'x'.repeat(61) },
        { line: 3, name: 'bad\u0007' },
        { line: 7, name: 'good' },
      ],
      lines,
    );
    expect(got).toEqual([{ line: 7, name: 'good' }]);
  });

  it('drops a second entry for a line (the first wins)', () => {
    expect(
      cleanBookmarkNames(
        [
          { line: 3, name: 'one' },
          { line: 3, name: 'two' },
        ],
        lines,
      ),
    ).toEqual([{ line: 3, name: 'one' }]);
  });

  it('drops an entry whose line is not a bookmark (an orphan)', () => {
    expect(
      cleanBookmarkNames(
        [
          { line: 4, name: 'orphan' },
          { line: 3, name: 'kept' },
        ],
        lines,
      ),
    ).toEqual([{ line: 3, name: 'kept' }]);
    expect(cleanBookmarkNames([{ line: 3, name: 'a' }], [])).toEqual([]);
  });

  it('keeps at most MAX_BOOKMARKS entries', () => {
    const many = Array.from({ length: MAX_BOOKMARKS + 50 }, (_, i) => i + 1);
    const got = cleanBookmarkNames(many.map((line) => ({ line, name: `n${line}` })), many);
    expect(got).toHaveLength(MAX_BOOKMARKS);
    expect(got[0]).toEqual({ line: 1, name: 'n1' });
    expect(got.at(-1)).toEqual({ line: MAX_BOOKMARKS, name: `n${MAX_BOOKMARKS}` });
  });

  it('keeps nothing but line and name of an entry', () => {
    expect(cleanBookmarkNames([{ line: 3, name: 'a', extra: { deep: 1 } }], lines)).toEqual([{ line: 3, name: 'a' }]);
  });
});

describe('memoMarks and namesOf', () => {
  it('puts the lines and the names of a memo together; a name of another line is no mark', () => {
    expect(
      memoMarks({
        bookmarks: [12, 3, 3, 0, 7],
        bookmarkNames: [
          { line: 7, name: 'seven' },
          { line: 9, name: 'orphan' },
        ],
      }),
    ).toEqual([{ line: 3 }, { line: 7, name: 'seven' }, { line: 12 }]);
  });

  it('reads a memo of an older build (no names) as it was', () => {
    expect(memoMarks({ bookmarks: [4, 9] })).toEqual([{ line: 4 }, { line: 9 }]);
  });

  it('turns marks back into the stored names, ascending', () => {
    expect(namesOf([{ line: 9, name: 'b' }, { line: 2 }, { line: 5, name: 'a' }])).toEqual([
      { line: 5, name: 'a' },
      { line: 9, name: 'b' },
    ]);
  });
});

describe('bookmarkText', () => {
  it('trims and cuts at 120 characters', () => {
    expect(bookmarkText('   G1 X10.  ')).toBe('G1 X10.');
    expect(bookmarkText('')).toBe('');
    expect(bookmarkText('x'.repeat(130))).toBe('x'.repeat(120));
    expect(bookmarkText('\u{1F527}'.repeat(130))).toBe('\u{1F527}'.repeat(120));
  });
});

describe('planMatches (all or nothing)', () => {
  it('is noMatch for no line', () => {
    expect(planMatches([], [4])).toEqual({ ok: false, reason: 'noMatch', matches: 0 });
  });

  it('marks the distinct lines, counts the ones that had a bookmark, and keeps the others', () => {
    const plan = planMatches([9, 3, 3, 12], [3, 20]);
    expect(plan).toEqual({ ok: true, lines: [3, 9, 12, 20], marked: 2, already: 1 });
  });

  it('allows exactly 200 bookmarks in all and refuses 201, with the matched lines counted', () => {
    const upTo = (n: number, from = 1) => Array.from({ length: n }, (_, i) => from + i);
    expect(planMatches(upTo(200), []).ok).toBe(true);
    expect(planMatches(upTo(201), [])).toEqual({ ok: false, reason: 'tooMany', matches: 201 });
    // 150 matched + 60 there already is 210: the bookmarks that are there count.
    expect(planMatches(upTo(150), upTo(60, 1000))).toEqual({ ok: false, reason: 'tooMany', matches: 150 });
    // Lines that are bookmarks already cost nothing.
    expect(planMatches(upTo(200), upTo(200)).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------
// state.json: the lines stay a number[], the names are read as untrusted
// ---------------------------------------------------------------------------------------

const memo = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  line: 12,
  column: 3,
  top: 8,
  bookmarks: [4, 12, 30],
  at: 1_700_000_000_000,
  ...patch,
});

const filesOf = (entry: unknown, path = '/nc/a.nc') => sanitizeUiState({ files: { [path]: entry } }).files[path];

describe('state.json: the names are untrusted', () => {
  it('keeps good names, beside the unchanged lines', () => {
    const got = filesOf(memo({ bookmarkNames: [{ line: 12, name: 'Tool 2' }, { line: 4, name: 'Start' }] }));
    expect(got.bookmarks).toEqual([4, 12, 30]);
    expect(got.bookmarkNames).toEqual([
      { line: 4, name: 'Start' },
      { line: 12, name: 'Tool 2' },
    ]);
  });

  it('turns a member that is not an array into [], and a memo without it stays without it', () => {
    for (const bad of ['names', 5, null, { line: 4, name: 'x' }, true]) {
      expect(filesOf(memo({ bookmarkNames: bad })).bookmarkNames, String(bad)).toEqual([]);
    }
    expect('bookmarkNames' in filesOf(memo())).toBe(false);
  });

  it('drops a bad entry, a second entry for a line, an orphan and everything over 200', () => {
    const got = filesOf(
      memo({
        bookmarkNames: [
          { line: 4, name: 'ok' },
          { line: 4, name: 'again' },
          { line: 5, name: 'orphan' },
          { line: 12, name: '' },
          { line: 30, name: 'x'.repeat(61) },
          { line: 'x', name: 'bad line' },
          null,
        ],
      }),
    );
    expect(got.bookmarkNames).toEqual([{ line: 4, name: 'ok' }]);

    const lines = Array.from({ length: 300 }, (_, i) => i + 1);
    const heavy = filesOf(memo({ bookmarks: lines, bookmarkNames: lines.map((line) => ({ line, name: `n${line}` })) }));
    expect(heavy.bookmarkNames).toHaveLength(MAX_BOOKMARKS);
  });

  it('does not keep what a name entry carries besides line and name', () => {
    const got = filesOf(memo({ bookmarkNames: [{ line: 4, name: 'a', extra: 1 }] }));
    expect(got.bookmarkNames).toEqual([{ line: 4, name: 'a' }]);
  });
});

interface Harness {
  memory: ReturnType<typeof createFileMemory>;
  files: Record<string, FileMemo>;
}

function harness(files: Record<string, FileMemo> = {}): Harness {
  let now = 1_000;
  const state = {
    files,
    memory: undefined as unknown as ReturnType<typeof createFileMemory>,
  };
  state.memory = createFileMemory({
    read: () => state.files,
    write: (next) => {
      state.files = next;
    },
    enabled: () => true,
    knownProfile: () => true,
    now: () => (now += 1),
  });
  return state;
}

describe('the per-file memory keeps the names with the lines', () => {
  it('round-trips names through remember, state.json and the loader', () => {
    const h = harness();
    h.memory.remember('/a.nc', {
      line: 9,
      bookmarks: [3, 8],
      bookmarkNames: [
        { line: 8, name: 'Finish' },
        { line: 3, name: 'Start' },
      ],
    });
    const stored = h.memory.get('/a.nc');
    expect(stored?.bookmarks).toEqual([3, 8]);
    expect(stored?.bookmarkNames).toEqual([
      { line: 3, name: 'Start' },
      { line: 8, name: 'Finish' },
    ]);
    // Through the file and back, as the next start reads it.
    const reloaded = sanitizeUiState(JSON.parse(JSON.stringify({ files: h.files }))).files['/a.nc'];
    expect(reloaded.bookmarkNames).toEqual(stored?.bookmarkNames);
    expect(reloaded.bookmarks).toEqual([3, 8]);
  });

  it('reads the names it is handed as untrusted, whoever hands them over', () => {
    const h = harness();
    h.memory.remember('/a.nc', {
      bookmarks: [3, 8],
      bookmarkNames: [
        { line: 3, name: ' ok ' },
        { line: 3, name: 'second' },
        { line: 5, name: 'orphan' },
        { line: 8, name: 'x'.repeat(61) },
        'junk',
      ] as unknown as { line: number; name: string }[],
    });
    expect(h.memory.get('/a.nc')?.bookmarkNames).toEqual([{ line: 3, name: 'ok' }]);
  });

  it('drops the name with its bookmark: a patch of the lines alone keeps the names of the lines that stay', () => {
    const h = harness();
    h.memory.remember('/a.nc', { bookmarks: [3, 8], bookmarkNames: [{ line: 3, name: 'a' }, { line: 8, name: 'b' }] });
    h.memory.remember('/a.nc', { bookmarks: [8] });
    expect(h.memory.get('/a.nc')?.bookmarkNames).toEqual([{ line: 8, name: 'b' }]);
    h.memory.remember('/a.nc', { line: 4, bookmarks: [] });
    expect(h.memory.get('/a.nc')?.bookmarkNames).toBeUndefined();
    expect('bookmarkNames' in (h.memory.get('/a.nc') ?? {})).toBe(false);
  });

  it('removes the member when no bookmark has a name any more (undefined in the patch)', () => {
    const h = harness();
    h.memory.remember('/a.nc', { bookmarks: [3], bookmarkNames: [{ line: 3, name: 'a' }] });
    h.memory.remember('/a.nc', { bookmarks: [3], bookmarkNames: undefined });
    expect('bookmarkNames' in (h.memory.get('/a.nc') ?? {})).toBe(false);
    expect(h.memory.get('/a.nc')?.bookmarks).toEqual([3]);
  });

  it('forgets a memo that carried only bookmarks and names once both are gone', () => {
    const h = harness();
    h.memory.remember('/a.nc', { bookmarks: [3], bookmarkNames: [{ line: 3, name: 'a' }] });
    h.memory.remember('/a.nc', { bookmarks: [], bookmarkNames: undefined });
    expect(h.memory.get('/a.nc')).toBeUndefined();
  });

  it('does not count bookmarkNames among the members of a later build (it is known)', () => {
    // A memo whose only content is a stray `bookmarkNames` carries nothing: it is not stored.
    const h = harness();
    h.memory.remember('/a.nc', { bookmarkNames: [{ line: 3, name: 'a' }] });
    expect(h.memory.get('/a.nc')).toBeUndefined();
  });

  it('keeps at most 200 names, the same cap as the lines (MAX_REMEMBERED_BOOKMARKS)', () => {
    const h = harness();
    const lines = Array.from({ length: 260 }, (_, i) => i + 1);
    h.memory.remember('/a.nc', { bookmarks: lines, bookmarkNames: lines.map((line) => ({ line, name: `n${line}` })) });
    expect(h.memory.get('/a.nc')?.bookmarks).toHaveLength(MAX_REMEMBERED_BOOKMARKS);
    expect(h.memory.get('/a.nc')?.bookmarkNames).toHaveLength(MAX_REMEMBERED_BOOKMARKS);
  });
});

describe('downgrade safety: an older build keeps the bookmarks', () => {
  // What M7's loader and writer did with a memo: `bookmarks` filtered to lines, every other member
  // kept whole. A copy of that logic stands in for the older build.
  function olderBuildReads(entry: Record<string, unknown>): Record<string, unknown> {
    const isLine = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1;
    const bookmarks = Array.isArray(entry.bookmarks) ? entry.bookmarks.filter(isLine) : [];
    return { ...entry, bookmarks };
  }

  it('writes bookmarks as the plain number[] of M7, whether or not the bookmarks have names', () => {
    const h = harness();
    h.memory.remember('/a.nc', { bookmarks: [3, 8], bookmarkNames: [{ line: 3, name: 'Start' }] });
    const onDisk = JSON.parse(JSON.stringify(h.files['/a.nc'])) as Record<string, unknown>;
    expect(onDisk.bookmarks).toEqual([3, 8]);
    expect((onDisk.bookmarks as unknown[]).every((line) => typeof line === 'number')).toBe(true);
    const older = olderBuildReads(onDisk);
    expect(older.bookmarks).toEqual([3, 8]);
    // ...and it keeps the names verbatim like a member it does not know.
    expect(older.bookmarkNames).toEqual([{ line: 3, name: 'Start' }]);
  });

  it('reads a memo an older build wrote (no names) with its lines and no names', () => {
    const got = filesOf(memo({ bookmarks: [4, 9] }));
    expect(got.bookmarks).toEqual([4, 9]);
    expect(got.bookmarkNames).toBeUndefined();
  });

  it('brings the names back after an older build changed the lines: names of lines that went are dropped, the rest stay', () => {
    // This build wrote lines 3 and 8 with names; an older one removed line 3 and added line 20.
    const afterOlder = olderBuildReads({ ...memo({ bookmarks: [8, 20] }), bookmarkNames: [{ line: 3, name: 'Start' }, { line: 8, name: 'Finish' }] });
    const got = filesOf(afterOlder);
    expect(got.bookmarks).toEqual([8, 20]);
    expect(got.bookmarkNames).toEqual([{ line: 8, name: 'Finish' }]);
  });
});

describe('the byte budget counts the names', () => {
  /** What `serde_json::to_vec_pretty` really writes for a `state.json` holding these. */
  function prettyBytes(files: Record<string, FileMemo>): number {
    const whole = { $version: 1, recent: [], ui: { layout: {}, lastParams: {}, lastScript: null, files } };
    return JSON.stringify(whole, null, 2).length + 1;
  }

  it('keeps the file under its cap with 200 short names in every memo (each name is four lines when pretty-printed)', () => {
    const h = harness();
    const lines = Array.from({ length: MAX_BOOKMARKS }, (_, i) => 100 + i * 7);
    for (let n = 0; n < MAX_REMEMBERED_FILES; n += 1) {
      h.memory.remember(`/Users/peter/NC/Auftraege/2026/job-${String(n).padStart(4, '0')}/welle-${n}.nc`, {
        line: 12345,
        bookmarks: lines,
        bookmarkNames: lines.map((line) => ({ line, name: 'a' })),
      });
    }
    expect(prettyBytes(h.files)).toBeLessThan(MAX_REMEMBERED_BYTES + 4096);
    expect(prettyBytes(h.files)).toBeLessThan(1024 * 1024);
    expect(Object.keys(h.files).length).toBeGreaterThan(10);
  });
});

describe('bookmarkLimitReached (the 201st bookmark, owner 2026-10-19)', () => {
  const full = Array.from({ length: MAX_BOOKMARKS }, (_, i) => i + 1);

  it('is true for a new line in a full document, false for a line that has a bookmark', () => {
    expect(bookmarkLimitReached(full, MAX_BOOKMARKS + 1)).toBe(true);
    expect(bookmarkLimitReached(full, 57)).toBe(false);
  });

  it('is false below the limit, and counts a line once however often the list repeats it', () => {
    expect(bookmarkLimitReached(full.slice(1), MAX_BOOKMARKS + 1)).toBe(false);
    expect(bookmarkLimitReached([], 1)).toBe(false);
    expect(bookmarkLimitReached([...full.slice(1), 5, 5, 5], MAX_BOOKMARKS + 1)).toBe(false);
  });
});
