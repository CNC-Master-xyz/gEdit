// Find in Folder (P4.28; plan section 6.8.3): the command, the form, the reading of the files the
// walk sends (with a fake `folderSearch`), the report and the click on a row. The walk itself is
// P4.27's and is proven in Rust and by the `p4-folders` scenario.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandDef, ReportData } from '$lib/app/types';
import type { FolderFile, FolderSearchRequest, FolderSummary } from '$lib/platform/commands';
import type { GuardRunner } from '$lib/core/regexGuard/runner';

type Walk = (req: FolderSearchRequest, onFile: (file: FolderFile) => void, onProgress?: (entries: number, files: number) => void) => Promise<FolderSummary>;

const fake = vi.hoisted(() => ({
  folder: '/nc/lathe1' as string | null,
  answers: [] as (Record<string, unknown> | undefined)[],
  forms: [] as Record<string, unknown>[],
  said: [] as { text: string; error: boolean; sticky: boolean; detail?: string; action?: { label: string; run: () => void } }[],
  reports: [] as ReportData[],
  confirms: [] as { title: string }[],
  confirmAnswer: true,
  requests: [] as unknown[],
  cancelled: [] as string[],
  grants: [] as { root: string; path: string }[],
  grantFails: false,
  opened: [] as string[][],
  revealed: [] as { id: string; line: number }[],
  openDocs: {} as Record<string, string>,
  walk: null as unknown as Walk,
  runner: null as GuardRunner | null,
  parseOverride: null as null | ((text: string) => unknown),
}));

vi.mock('$lib/app/modals', () => ({
  modals: {
    form: (o: { values?: Record<string, unknown> }): Promise<Record<string, unknown> | undefined> => {
      fake.forms.push({ ...o.values });
      return Promise.resolve(fake.answers.shift());
    },
  },
}));
vi.mock('$lib/app/dialogs', () => ({
  dialogs: {
    pickFolder: () => Promise.resolve(fake.folder),
    confirm: (o: { title: string }) => {
      fake.confirms.push(o);
      return Promise.resolve(fake.confirmAnswer);
    },
  },
}));
vi.mock('$lib/app/status', () => ({
  status: {
    show: (text: string, o?: { error?: boolean; sticky?: boolean; detail?: string; action?: { label: string; run: () => void } }) =>
      fake.said.push({ text, error: o?.error === true, sticky: o?.sticky === true, detail: o?.detail, action: o?.action }),
  },
}));
vi.mock('$lib/app/fileOps', () => ({
  files: {
    open: (paths: string[]) => {
      fake.opened.push(paths);
      return Promise.resolve(['new-doc']);
    },
  },
}));
vi.mock('$lib/monaco/editorService', () => ({ editor: { reveal: (id: string, line: number) => fake.revealed.push({ id, line }) } }));
vi.mock('$lib/stores/documents', () => ({
  docs: { byPath: (path: string) => (path in fake.openDocs ? { id: fake.openDocs[path] } : undefined) },
}));
vi.mock('$lib/stores/results', () => ({ results: { show: (r: ReportData) => fake.reports.push(r) } }));
vi.mock('$lib/stores/uiState', async (original) => ({
  ...(await original<typeof import('$lib/stores/uiState')>()),
  uiState: { getLastParams: () => undefined, setLastParams: () => undefined },
}));
vi.mock('$lib/core/regexGuard/app', () => ({ appGuardRunner: () => Promise.resolve(fake.runner) }));
vi.mock('$lib/core/search', async (original) => {
  const real = await original<typeof import('$lib/core/search')>();
  return {
    ...real,
    parseQuery: (text: string, cp: Parameters<typeof real.parseQuery>[1], flags: Parameters<typeof real.parseQuery>[2]) =>
      fake.parseOverride?.(text) ?? real.parseQuery(text, cp, flags),
  };
});
vi.mock('$lib/platform/commands', async (original) => {
  const real = await original<typeof import('$lib/platform/commands')>();
  return {
    ...real,
    folderSearch: (req: FolderSearchRequest, onFile: (file: FolderFile) => void, onProgress?: (entries: number, files: number) => void) => {
      fake.requests.push(req);
      return fake.walk(req, onFile, onProgress);
    },
    folderSearchCancel: (id: string) => {
      fake.cancelled.push(id);
      return Promise.resolve(true);
    },
    folderGrant: (root: string, path: string) => {
      fake.grants.push({ root, path });
      return fake.grantFails ? Promise.reject(new Error('file is not in that folder')) : Promise.resolve();
    },
  };
});

const finder = await import('./findInFolder');
const { hasKey, t } = await import('$lib/i18n');
const contribution = finder.default;
const command = (contribution.commands as CommandDef[])[0];

function file(rel: string, text: string | Uint8Array, index = 0): FolderFile {
  const data = typeof text === 'string' ? new TextEncoder().encode(text) : text;
  return { index, path: `/nc/lathe1/${rel}`, rel, bytes: data.length, mtimeMs: new Date(2026, 9, 5, 7, 3).getTime(), data };
}

function summary(over: Partial<FolderSummary> = {}, skipped: Partial<FolderSummary['skipped']> = {}): FolderSummary {
  return {
    entriesSeen: 9,
    filesRead: 3,
    filesSent: 3,
    bytesRead: 90,
    skipped: { binary: 0, tooLarge: 0, unreadable: 0, links: 0, hidden: 0, tooDeep: 0, bigFolders: 0, ...skipped },
    stoppedBy: null,
    tooLargeNames: [],
    ...over,
  };
}

/** The walk sends `files` in order and ends with `done`. */
function walkOf(files: FolderFile[], done: FolderSummary = summary()): Walk {
  return async (_req, onFile) => {
    for (const f of files) onFile(f);
    return done;
  };
}

const FORM = {
  names: '*.nc; *.tap',
  recursive: true,
  modifiedFrom: '',
  modifiedTo: '',
  query: 'T17',
  wholeAddress: true,
  caseSensitive: false,
  regex: false,
  inComments: false,
  readAs: 'each',
};

async function search(answers: Record<string, unknown> = {}): Promise<ReportData> {
  fake.answers.push({ ...FORM, ...answers });
  await command.run({ activeDocId: null } as never);
  await finder.folderSearchIdle();
  const report = fake.reports.at(-1);
  if (report === undefined) throw new Error('no report');
  return report;
}

const TEXT = ['O0001', 'T17 M6', 'T 17', 'T017', '(T17 CHANGE)', 'T170', 'T1', 'G0 X0'].join('\n');

beforeEach(() => {
  Object.assign(fake, {
    folder: '/nc/lathe1',
    answers: [],
    forms: [],
    said: [],
    reports: [],
    confirms: [],
    confirmAnswer: true,
    requests: [],
    cancelled: [],
    grants: [],
    grantFails: false,
    opened: [],
    revealed: [],
    openDocs: {},
    walk: walkOf([]),
    runner: null,
    parseOverride: null,
  });
});

describe('the command', () => {
  it('is search.findInFolder in the Edit tab Search group at order 133, with no key', () => {
    expect(contribution.commands).toHaveLength(1);
    expect(command.id).toBe('search.findInFolder');
    expect(command.keys).toBeUndefined();
    expect(command.category).toBe('search.category');
    expect(hasKey(command.title)).toBe(true);
    expect(hasKey('search.category')).toBe(true);
    expect(contribution.ribbon).toEqual([{ tab: 'edit', group: 'search.group', command: 'search.findInFolder', order: 133 }]);
  });

  it('does nothing when the folder dialog is cancelled, and when the form is', async () => {
    fake.folder = null;
    await command.run({ activeDocId: null } as never);
    expect(fake.forms).toHaveLength(0);
    fake.folder = '/nc/lathe1';
    fake.answers.push(undefined);
    await command.run({ activeDocId: null } as never);
    expect(fake.requests).toHaveLength(0);
    expect(fake.reports).toHaveLength(0);
  });

  it('starts the form with the registered extensions as name patterns and every file read by its own dialect', async () => {
    fake.answers.push(undefined);
    await command.run({ activeDocId: null } as never);
    const names = String(fake.forms[0].names);
    expect(names).toMatch(/^\*\.nc; /);
    expect(names.split(';').length).toBeLessThanOrEqual(16);
    expect(fake.forms[0].readAs).toBe('each');
    expect(fake.forms[0].recursive).toBe(true);
  });

  it('asks the form again, with what was typed, when a name pattern or a date or the query is refused', async () => {
    fake.answers.push({ ...FORM, names: 'a|b.nc' });
    fake.answers.push({ ...FORM, modifiedFrom: '27.10.2026' });
    fake.answers.push({ ...FORM, modifiedFrom: '2026-10-27', modifiedTo: '2026-10-01' });
    fake.answers.push({ ...FORM, wholeAddress: false, regex: true, query: '(' });
    fake.answers.push(undefined);
    await command.run({ activeDocId: null } as never);
    expect(fake.forms).toHaveLength(5);
    expect(fake.forms[1].names).toBe('a|b.nc');
    expect(fake.said.filter((s) => s.error).map((s) => s.text)).toEqual([
      t('findInFolder.errorNameChar', { name: 'a|b.nc', char: ' |' }),
      t('findInFolder.errorDate', { text: '27.10.2026' }),
      t('findInFolder.errorDateOrder'),
      expect.stringContaining('('),
    ]);
    expect(fake.requests).toHaveLength(0);
  });
});

describe('the request', () => {
  it('carries the folder, the patterns, the dates and the prefilter', async () => {
    fake.walk = walkOf([]);
    await search({ recursive: false, modifiedFrom: '2026-10-20', modifiedTo: '2026-10-27' });
    expect(fake.requests).toHaveLength(1);
    const req = fake.requests[0] as FolderSearchRequest;
    expect(req.id).toMatch(/^[a-z0-9-]{1,64}$/);
    expect(req).toMatchObject({
      root: '/nc/lathe1',
      recursive: false,
      namePatterns: ['*.nc', '*.tap'],
      modifiedAfter: new Date(2026, 9, 20).getTime(),
      modifiedBefore: new Date(2026, 9, 28).getTime(),
      contains: { text: 'T', caseSensitive: false },
    });
  });

  it('sends no prefilter for a word on the program-number address, which calls also name', async () => {
    await search({ query: 'O1234' });
    expect((fake.requests[0] as FolderSearchRequest).contains).toBeNull();
  });

  it('sends the text of a literal query as the prefilter, and none without a query', async () => {
    await search({ query: 'G43 H1', wholeAddress: false });
    expect((fake.requests[0] as FolderSearchRequest).contains).toEqual({ text: 'G43 H1', caseSensitive: false });
    await search({ query: '' });
    expect((fake.requests[1] as FolderSearchRequest).contains).toBeNull();
  });
});

describe('the report', () => {
  it('lists a word query by value as written, never in a comment, with the columns of the contract', async () => {
    fake.walk = walkOf([file('a/part.nc', TEXT)]);
    const report = await search();
    expect(report.columns.map((c) => c.key)).toEqual(['file', 'line', 'text', 'modified']);
    expect(report.rows.map((row) => [row.file, row.line, row.text])).toEqual([
      ['a/part.nc', 2, 'T17 M6'],
      ['a/part.nc', 3, 'T 17'],
      ['a/part.nc', 4, 'T017'],
    ]);
    expect(report.rows[0]).toMatchObject({ path: '/nc/lathe1/a/part.nc', root: '/nc/lathe1', modified: '2026-10-05 07:03', bytes: TEXT.length });
    expect(report.title).toBe(t('findInFolder.title', { count: 3, query: 'T17', folder: 'lathe1' }));
    expect(report.message).toBeUndefined();
    expect(typeof report.openRow).toBe('function');
  });

  it('reads a text search outside comments unless the form says otherwise', async () => {
    fake.walk = walkOf([file('a.nc', TEXT)]);
    const plain = await search({ query: 'T17', wholeAddress: false });
    expect(plain.rows.map((row) => row.line)).toEqual([2, 6]);
    const withComments = await search({ query: 'T17', wholeAddress: false, inComments: true });
    expect(withComments.rows.map((row) => row.line)).toEqual([2, 5, 6]);
  });

  it('says there are no hits, with the folder', async () => {
    fake.walk = walkOf([file('a.nc', 'G0 X0')]);
    const report = await search();
    expect(report.rows).toHaveLength(0);
    expect(report.title).toBe(t('findInFolder.titleNone', { query: 'T17', folder: 'lathe1' }));
  });

  it('lists one row per file, with no line, for a search without a query', async () => {
    fake.walk = walkOf([file('a.nc', 'G0'), file('b/c.tap', 'G1')]);
    const report = await search({ query: '' });
    expect(report.columns.map((c) => c.key)).toEqual(['file', 'modified']);
    expect(report.rows.map((row) => row.file)).toEqual(['a.nc', 'b/c.tap']);
    expect(report.rows.every((row) => !('line' in row))).toBe(true);
    expect(report.title).toBe(t('findInFolder.titleFiles', { count: 2, folder: 'lathe1' }));
  });

  it('reads each file with its own dialect: the same text is a program number in one and a word in another', async () => {
    // Sinumerik writes the tool as T="DRILL"; a Fanuc file as T17. The query T17 must not read the
    // comment of a Sinumerik file either: `;` starts a comment there.
    fake.walk = walkOf([file('a.mpf', 'N10 G0 X0\n; T17 only a comment\nT17\n'), file('b.nc', 'T17\n')]);
    const report = await search();
    expect(report.rows.map((row) => [row.file, row.line])).toEqual([
      ['a.mpf', 3],
      ['b.nc', 1],
    ]);
  });

  it('uses the one profile the form fixes for every file', async () => {
    // In Fanuc ISO `;` is no comment, so T17 after it is a word; the profile of a .mpf file would not read it.
    fake.walk = walkOf([file('a.mpf', 'G0 ; T17\n')]);
    const each = await search();
    expect(each.rows).toHaveLength(0);
    const fixed = await search({ readAs: 'fanuc-gcode' });
    expect(fixed.rows.map((row) => row.line)).toEqual([1]);
  });

  it('decodes like opening a file: a Windows-1252 file and a UTF-16 file with a mark are read', async () => {
    const latin = new Uint8Array([...new TextEncoder().encode('(M'), 0xfc, ...new TextEncoder().encode('ller)\nT17\n')]);
    const utf16 = new Uint8Array([0xff, 0xfe, ...[...'T17\n'].flatMap((c) => [c.charCodeAt(0), 0])]);
    fake.walk = walkOf([file('latin.nc', latin), file('wide.nc', utf16)]);
    const report = await search();
    expect(report.rows.map((row) => [row.file, row.line])).toEqual([
      ['latin.nc', 2],
      ['wide.nc', 1],
    ]);
  });

  it('counts a file that is not text and says so', async () => {
    const binary = new Uint8Array(200).map((_, i) => (i % 2 === 0 ? 0 : 7));
    fake.walk = walkOf([file('bad.nc', binary), file('ok.nc', 'T17\n')], summary({}, { binary: 1 }));
    const report = await search();
    expect(report.rows).toHaveLength(1);
    expect(report.message).toBe(t('findInFolder.skipBinary', { count: 2 }));
  });
});

describe('Q5: what was not read reaches the message', () => {
  it('names every count of the walk in plain words', async () => {
    fake.walk = walkOf(
      [file('a.nc', 'T17')],
      summary({ tooLargeNames: ['big.nc'] }, { tooLarge: 1, unreadable: 2, links: 3, hidden: 4, tooDeep: 1, bigFolders: 1 }),
    );
    const report = await search();
    for (const needle of ['big.nc', '16 MB', '2 files could not be read', '3 links', '4 hidden', '16 levels', '50,000 entries']) {
      expect(report.message, needle).toContain(needle);
    }
    expect(report.title).toBe(t('findInFolder.title', { count: 1, query: 'T17', folder: 'lathe1' }));
  });

  it('says "at least" and why when the walk met a limit', async () => {
    fake.walk = walkOf([file('a.nc', 'T17')], summary({ stoppedBy: 'files' }));
    const report = await search();
    expect(report.title).toBe(t('findInFolder.titleAtLeast', { count: 1, query: 'T17', folder: 'lathe1' }));
    expect(report.message).toContain('Stopped after 20,000 files. Narrow the folder or the name pattern.');
  });

  it('stops at 10,000 hits, cancels the walk, keeps the rows and says "at least"', async () => {
    const many = Array.from({ length: 6000 }, () => 'T17').join('\n');
    fake.walk = walkOf([file('a.nc', many), file('b.nc', many), file('c.nc', many)], summary({ stoppedBy: 'cancelled' }));
    const report = await search();
    expect(report.rows).toHaveLength(10_000);
    expect(report.rows.filter((row) => row.file === 'b.nc')).toHaveLength(4000);
    expect(report.rows.some((row) => row.file === 'c.nc')).toBe(false);
    expect(fake.cancelled).toEqual([(fake.requests[0] as FolderSearchRequest).id]);
    expect(report.title).toBe(t('findInFolder.titleAtLeast', { count: 10_000, query: 'T17', folder: 'lathe1' }));
    expect(report.message).toContain('Stopped after 10,000 hits');
    expect(report.message).not.toContain(t('findInFolder.stoppedUser'));
  });

  it('does not say "at least" for exactly 10,000 hits in the last file', async () => {
    fake.walk = walkOf([file('a.nc', Array.from({ length: 10_000 }, () => 'T17').join('\n'))]);
    const report = await search();
    expect(report.rows).toHaveLength(10_000);
    expect(report.title).toBe(t('findInFolder.title', { count: 10_000, query: 'T17', folder: 'lathe1' }));
    expect(fake.cancelled).toEqual([]);
  });
});

describe('Q4: the query per profile', () => {
  it('parses it once per profile and reports the files whose profile cannot read it, then goes on', async () => {
    const parsed: string[] = [];
    // Call 1 is the form's own check; call 2 is the first profile of the files (the Sinumerik .mpf), which refuses.
    fake.parseOverride = (text) => {
      parsed.push(text);
      return parsed.length === 2 ? { error: { key: 'search.errorWord', params: { query: text } } } : null;
    };
    fake.walk = walkOf([file('a.mpf', 'T17\n'), file('d.mpf', 'T17\n'), file('b.nc', 'T17\n'), file('c.nc', 'T17\n')]);
    const report = await search();
    expect(parsed).toHaveLength(3); // the form, the .mpf profile, the .nc profile: not once per file
    expect(report.rows.map((row) => row.file)).toEqual(['b.nc', 'c.nc']);
    expect(report.message).toContain(t('findInFolder.skipQuery', { count: 2, file: 'a.mpf', message: t('search.errorWord', { query: 'T17' }) }));
  });
});

describe('Q6: a slow pattern', () => {
  it('ends the search at that file, keeps the rows before it and names the file', async () => {
    fake.runner = {
      run: (job) => Promise.resolve(job.lines.includes('SLOW') ? { status: 'timeout', budgetMs: 2000, probe: 'query' } : { status: 'done', result: { probes: [] } }),
      dispose: () => undefined,
    };
    fake.walk = walkOf([file('a.nc', 'T17 X1\nG0'), file('b/slow.nc', 'SLOW\nT17 X1'), file('c.nc', 'T17 X1')], summary({ stoppedBy: 'cancelled' }));
    const report = await search({ query: 'T\\d+ X', wholeAddress: false, regex: true });
    expect(report.rows.map((row) => row.file)).toEqual(['a.nc']);
    expect(report.message).toContain('b/slow.nc');
    expect(report.message).toContain('took too long');
    expect(report.title).toContain('At least');
    expect(fake.cancelled).toHaveLength(1);
  });
});

describe('stopping and running twice', () => {
  it('shows progress in the status bar with a Stop button that ends the search and keeps the rows', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    fake.walk = async (_req, onFile, onProgress) => {
      onFile(file('a.nc', 'T17'));
      onProgress?.(120, 40);
      await gate;
      onFile(file('b.nc', 'T17')); // sent after the stop: the reader drops it
      return summary({ stoppedBy: 'cancelled' });
    };
    fake.answers.push({ ...FORM });
    await command.run({ activeDocId: null } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const progress = fake.said.filter((s) => s.sticky);
    expect(progress.length).toBeGreaterThanOrEqual(2);
    const last = progress.at(-1);
    expect(last?.text).toBe(t('findInFolder.progress', { files: 40, entries: 120 }));
    expect(last?.action?.label).toBe(t('findInFolder.stop'));
    last?.action?.run();
    expect(fake.cancelled).toHaveLength(1);
    release();
    await finder.folderSearchIdle();
    const report = fake.reports[0];
    expect(report.rows.map((row) => row.file)).toEqual(['a.nc']);
    expect(report.message).toBe(t('findInFolder.stoppedUser'));
    expect(report.title).toContain('At least');
  });

  it('offers to stop a running search before it starts another, and stops it when the user agrees', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    fake.walk = async (_req, onFile) => {
      onFile(file('first.nc', 'T17'));
      await gate;
      return summary({ stoppedBy: 'cancelled' });
    };
    fake.answers.push({ ...FORM });
    await command.run({ activeDocId: null } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    fake.walk = walkOf([file('second.nc', 'T17')]);
    fake.answers.push({ ...FORM });
    const second = command.run({ activeDocId: null } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.confirms).toHaveLength(1);
    expect(fake.cancelled).toHaveLength(1);
    release();
    await second;
    await finder.folderSearchIdle();
    expect(fake.reports.map((r) => r.rows.map((row) => row.file))).toEqual([['first.nc'], ['second.nc']]);
  });

  it('leaves the running search alone when the user says no', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    fake.walk = async () => {
      await gate;
      return summary();
    };
    fake.answers.push({ ...FORM });
    await command.run({ activeDocId: null } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    fake.confirmAnswer = false;
    await command.run({ activeDocId: null } as never);
    expect(fake.confirms).toHaveLength(1);
    expect(fake.cancelled).toHaveLength(0);
    expect(fake.forms).toHaveLength(1);
    release();
    await finder.folderSearchIdle();
    expect(fake.reports).toHaveLength(1);
  });

  it('tells the user when the walk refuses, and shows no report', async () => {
    fake.walk = () => Promise.reject(new Error('path is not allowed'));
    fake.answers.push({ ...FORM });
    await command.run({ activeDocId: null } as never);
    await finder.folderSearchIdle();
    expect(fake.reports).toHaveLength(0);
    const last = fake.said.at(-1);
    expect(last).toMatchObject({ text: t('findInFolder.failed'), error: true, detail: 'path is not allowed' });
  });
});

describe('a click on a row', () => {
  const row = { file: 'a/part.nc', path: '/nc/lathe1/a/part.nc', root: '/nc/lathe1', line: 12 };

  it('grants the one file, opens it and shows the line', async () => {
    await finder.openRow(row);
    expect(fake.grants).toEqual([{ root: '/nc/lathe1', path: '/nc/lathe1/a/part.nc' }]);
    expect(fake.opened).toEqual([['/nc/lathe1/a/part.nc']]);
    expect(fake.revealed).toEqual([{ id: 'new-doc', line: 12 }]);
  });

  it('opens a file of a search by name without a line, and shows no line', async () => {
    await finder.openRow({ ...row, line: undefined });
    expect(fake.opened).toHaveLength(1);
    expect(fake.revealed).toHaveLength(0);
  });

  it('shows the line of a file that is already open, without a grant or a second tab', async () => {
    fake.openDocs['/nc/lathe1/a/part.nc'] = 'doc-7';
    await finder.openRow(row);
    expect(fake.grants).toHaveLength(0);
    expect(fake.opened).toHaveLength(0);
    expect(fake.revealed).toEqual([{ id: 'doc-7', line: 12 }]);
  });

  it('says so and opens nothing when the grant is refused', async () => {
    fake.grantFails = true;
    await finder.openRow(row);
    expect(fake.opened).toHaveLength(0);
    expect(fake.said.at(-1)).toMatchObject({ text: t('findInFolder.cannotOpen', { file: 'a/part.nc' }), error: true });
  });

  it('ignores a row with no path', async () => {
    await finder.openRow({ file: 'x', line: 1 });
    expect(fake.grants).toHaveLength(0);
    expect(fake.opened).toHaveLength(0);
  });
});
