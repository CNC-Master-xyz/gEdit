// What the search contribution declares and does (plan §6 M11, WP11.1, §7.13): the three
// commands and their key, find-all from the form into Results, the replace handed to the
// transform runner, and the whole-address find handed to the editor's find widget.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandDef, ReportData } from '$lib/app/types';
import { compileProfile } from '$lib/core/profiles/compile';
import type { Profile } from '$lib/core/profiles/types';
import fanucJson from '$lib/data/profiles/fanuc-gcode.json';

const cp = compileProfile(fanucJson as unknown as Profile);

const fake = vi.hoisted(() => ({
  answers: [] as (Record<string, unknown> | undefined)[],
  forms: [] as Record<string, unknown>[],
  lives: [] as (((values: Record<string, unknown>) => unknown) | undefined)[],
  documents: {} as Record<string, string[]>,
  titles: {} as Record<string, string>,
  reports: [] as unknown[],
  said: [] as { text: string; error: boolean }[],
  ran: [] as { id: string; o: unknown }[],
  actions: [] as { id: string; payload: unknown }[],
  selected: '',
  models: new Set<string>(),
  runner: null as import('$lib/core/regexGuard/runner').GuardRunner | null,
  /** P4.31: the channel set `channels.fresh` answers per document, and the machine's channel block. */
  sets: {} as Record<string, unknown>,
  channelParams: null as unknown,
  fields: [] as unknown[][],
}));

vi.mock('$lib/app/modals', () => ({
  modals: {
    form: (o: { fields?: unknown[]; values?: Record<string, unknown>; live?: (values: Record<string, unknown>) => unknown }): Promise<Record<string, unknown> | undefined> => {
      fake.forms.push({ ...o.values });
      fake.fields.push(o.fields ?? []);
      fake.lives.push(o.live);
      return Promise.resolve(fake.answers.shift());
    },
  },
}));
vi.mock('$lib/app/status', () => ({
  status: { show: (text: string, o?: { error?: boolean }) => fake.said.push({ text, error: o?.error === true }) },
}));
vi.mock('$lib/app/transforms', () => ({
  transforms: {
    run: (def: { id: string }, o: unknown): Promise<null> => {
      fake.ran.push({ id: def.id, o });
      return Promise.resolve(null);
    },
  },
}));
vi.mock('$lib/monaco/editorService', () => ({
  editor: {
    selectedText: () => fake.selected,
    hasModel: (id: string) => fake.models.has(id),
    getLineCount: (id: string) => fake.documents[id].length,
    getLines: (id: string, from: number, to: number) => fake.documents[id].slice(from - 1, to),
    triggerAction: (id: string, payload?: unknown) => fake.actions.push({ id, payload }),
    presetFind: (s: string) => fake.actions.push({ id: 'preset', payload: s }),
  },
}));
vi.mock('$lib/stores/documents', () => ({
  docs: {
    all: () => Object.keys(fake.documents).map((id) => ({ id, title: fake.titles[id] })),
    get: (id: string) => (id in fake.documents ? { id, title: fake.titles[id] } : undefined),
  },
}));
vi.mock('$lib/stores/channels', () => ({
  channels: {
    fresh: (id: string) => fake.sets[id] ?? { layout: 'none', self: null, members: [], missing: [], outside: [], marks: [], problems: [], truncated: false },
    params: () => fake.channelParams,
  },
}));
vi.mock('$lib/stores/machines', () => ({ machines: { effective: () => ({ cp, codes: undefined }) } }));
vi.mock('$lib/stores/results', () => ({ results: { show: (r: unknown) => fake.reports.push(r) } }));
vi.mock('$lib/core/regexGuard/app', () => ({ appGuardRunner: () => Promise.resolve(fake.runner) }));
vi.mock('$lib/stores/uiState', () => ({ uiState: { getLastParams: () => undefined, setLastParams: () => undefined } }));

const search = (await import('./search')).default;
const { hasKey } = await import('$lib/i18n');
const { toySet } = await import('$lib/core/channels/paneFixtures');

const byId = new Map<string, CommandDef>((search.commands ?? []).map((def) => [def.id, def]));
const run = (id: string, docId = 'a'): unknown => byId.get(id)?.run({ activeDocId: docId } as never);

const FORM = { query: 'G1', wholeAddress: true, caseSensitive: false, regex: false, inComments: false, scope: 'active' };

beforeEach(() => {
  Object.assign(fake, {
    answers: [],
    forms: [],
    lives: [],
    documents: { a: ['G1 X1', 'G0 X2', 'G01 (G1)', 'G10'], b: ['G1', 'X5'] },
    titles: { a: 'part.nc', b: 'part.nc' },
    reports: [],
    said: [],
    ran: [],
    actions: [],
    selected: '',
    models: new Set(['a', 'b']),
    runner: null,
    sets: {},
    channelParams: null,
    fields: [],
  });
});

describe('the search commands', () => {
  it('are the three of plan §7.13, and only find-all has a key', () => {
    expect([...byId.keys()]).toEqual(['search.findAll', 'search.replace', 'search.wholeAddressInFind']);
    expect(byId.get('search.findAll')?.keys).toBe('Mod+Shift+F');
    expect(byId.get('search.replace')?.keys).toBeUndefined();
    expect(byId.get('search.wholeAddressInFind')?.keys).toBeUndefined();
  });

  it('need a document, and have a message for every title and category', () => {
    for (const def of byId.values()) {
      expect(def.enabled?.({ activeDocId: null } as never), def.id).toBe(false);
      expect(def.enabled?.({ activeDocId: 'd1' } as never), def.id).toBe(true);
      expect(hasKey(def.title), def.title).toBe(true);
      expect(def.category !== undefined && hasKey(def.category), def.id).toBe(true);
    }
  });

  it('sit in one Edit-tab group, with a caption', () => {
    for (const item of search.ribbon ?? []) {
      expect(item.tab).toBe('edit');
      expect(item.group).toBe('search.group');
    }
    expect((search.ribbon ?? []).map((item) => item.command)).toEqual([...byId.keys()]);
    expect(hasKey('search.group')).toBe(true);
  });
});

describe('search.findAll', () => {
  it('puts the hits of the active document into Results', async () => {
    fake.answers.push(FORM);
    await run('search.findAll');
    const report = fake.reports[0] as ReportData;
    expect(report.title).toBe('2 hits for G1');
    expect(report.rows).toEqual([
      { document: 'part.nc', docId: 'a', line: 1, text: 'G1 X1' },
      { document: 'part.nc', docId: 'a', line: 3, text: 'G01 (G1)' },
    ]);
    expect(report.columns.map((c) => c.key)).toEqual(['line', 'text']);
    expect(report.dropped).toBeUndefined();
  });

  it('searches every open document, each row with its own document id', async () => {
    fake.answers.push({ ...FORM, scope: 'open' });
    await run('search.findAll');
    const report = fake.reports[0] as ReportData;
    expect(report.rows.map((r) => [r.docId, r.line])).toEqual([['a', 1], ['a', 3], ['b', 1]]);
    expect(report.columns.map((c) => c.key)).toEqual(['document', 'line', 'text']);
  });

  it('says so when nothing is found', async () => {
    fake.answers.push({ ...FORM, query: 'T9' });
    await run('search.findAll');
    expect((fake.reports[0] as ReportData).title).toBe('No hits for T9');
    expect(fake.said.at(-1)).toEqual({ text: 'No hits.', error: false });
  });

  it('asks again, with what was typed, when the query does not parse', async () => {
    fake.answers.push({ ...FORM, query: '(', wholeAddress: false, regex: true }, FORM);
    await run('search.findAll');
    expect(fake.said[0].error).toBe(true);
    expect(fake.forms[1].query).toBe('(');
    expect((fake.reports[0] as ReportData).rows).toHaveLength(2);
  });

  it('starts from the selected text', async () => {
    fake.selected = 'G10';
    await run('search.findAll');
    expect(fake.forms[0].query).toBe('G10');
    expect(fake.reports).toEqual([]);
  });

  it('cuts a very long line to a few hundred characters around the hit (CODE-16)', async () => {
    fake.documents.a = [`${'X1 '.repeat(40_000)}G1 ${'Y2 '.repeat(40_000)}`];
    fake.answers.push(FORM);
    await run('search.findAll');
    const [row] = (fake.reports[0] as ReportData).rows;
    const text = String(row.text);
    expect(text.length).toBeLessThanOrEqual(300);
    expect(text).toContain('G1');
  });

  it('caps the rows and counts what it left out', async () => {
    fake.documents.a = Array.from({ length: 10_050 }, () => 'G1');
    fake.answers.push(FORM);
    await run('search.findAll');
    const report = fake.reports[0] as ReportData;
    expect(report.rows).toHaveLength(10_000);
    expect(report.dropped).toBe(50);
    expect(report.title).toBe('10050 hits for G1');
  });
});

describe('search.replace', () => {
  it('hands the answers to the replace transform, into the text by default', async () => {
    const answers = { ...FORM, replacement: 'G0', output: 'replace' };
    fake.answers.push(answers);
    await run('search.replace');
    expect(fake.ran).toEqual([{ id: 'replace', o: { options: answers, skipForm: true, target: 'replace' } }]);
  });

  it('can put the result into a new tab', async () => {
    fake.answers.push({ ...FORM, replacement: 'G0', output: 'new-document' });
    await run('search.replace');
    expect((fake.ran[0].o as { target: string }).target).toBe('new-document');
  });

  it('runs nothing when the form is cancelled', async () => {
    fake.answers.push(undefined);
    await run('search.replace');
    expect(fake.ran).toEqual([]);
  });

  it('drops the selection that was only the starting query, so the whole program is the scope (CODE-3)', async () => {
    fake.selected = 'G01';
    fake.answers.push({ ...FORM, query: 'G01', replacement: 'G1', output: 'replace' });
    await run('search.replace');
    expect(fake.actions).toEqual([{ id: 'cancelSelection', payload: undefined }]);
    expect(fake.ran).toHaveLength(1);
  });

  it('keeps a selection the user did not use as the query (a real scope)', async () => {
    fake.selected = 'G01';
    fake.answers.push({ ...FORM, query: 'G1', replacement: 'G0', output: 'replace' });
    await run('search.replace');
    expect(fake.actions).toEqual([]);
  });
});

describe('search.wholeAddressInFind', () => {
  it('opens the find widget on the whole-address regex', async () => {
    fake.answers.push({ query: 'g1' });
    await run('search.wholeAddressInFind');
    expect(fake.actions).toEqual([
      { id: 'preset', payload: '(?<![A-Z_])G\\+?0*1(?:\\.0*)?(?![\\d.])' },
      {
        id: 'editor.actions.findWithArgs',
        payload: { searchString: '(?<![A-Z_])G\\+?0*1(?:\\.0*)?(?![\\d.])', isRegex: true, isCaseSensitive: false, matchWholeWord: false },
      },
    ]);
  });

  it('refuses a condition, which a regex cannot express, and asks again', async () => {
    fake.answers.push({ query: 'S>100' }, undefined);
    await run('search.wholeAddressInFind');
    expect(fake.said[0].error).toBe(true);
    expect(fake.actions).toEqual([]);
  });
});

describe('the search forms (T226)', () => {
  it.each(['search.findAll', 'search.replace'])('%s grays out Also in comments while Whole address is ticked', async (id) => {
    fake.answers.push(undefined);
    await run(id);
    const live = fake.lives[0];
    expect(typeof live).toBe('function');
    expect(live?.({ wholeAddress: true, inComments: true })).toMatchObject({ readOnly: ['inComments'] });
    expect(live?.({ wholeAddress: false })).toEqual({});
  });
});

describe('the form texts (CODE-2, NC-4, CODE-7, CODE-17)', () => {
  it('say that Also in comments is for text searches', async () => {
    const { t } = await import('$lib/i18n');
    expect(t('search.inComments')).toMatch(/text/i);
  });

  it('say that a word without a value replaces only the address', async () => {
    const { t } = await import('$lib/i18n');
    expect(t('search.replacementHelp')).toMatch(/without a value/);
  });

  it('say that empty regex matches are skipped, and that find takes a bare address', async () => {
    const { t } = await import('$lib/i18n');
    expect(t('search.regexHelp')).toMatch(/empty/);
    expect(t('search.wholeAddressNeedsValue', { query: 'S>1' })).toMatch(/address, or an address with a number/);
  });
});

describe('a regular expression that runs away (T227)', () => {
  const RUNAWAY = { ...FORM, query: '(a+)+$', wholeAddress: false, regex: true, replacement: 'x', output: 'replace' };
  /** A worker that never finishes the pattern: the budget runs out. */
  const stuck = (): { runner: import('$lib/core/regexGuard/runner').GuardRunner; jobs: unknown[] } => {
    const jobs: unknown[] = [];
    return {
      jobs,
      runner: {
        run: (job, budgetMs) => {
          jobs.push(job);
          return Promise.resolve({ status: 'timeout' as const, budgetMs, probe: 'query' });
        },
        dispose: () => undefined,
      },
    };
  };

  it('Find All stops it, says so in plain words and lists nothing', async () => {
    const s = stuck();
    fake.runner = s.runner;
    fake.answers.push(RUNAWAY);
    await run('search.findAll');
    expect(s.jobs).toHaveLength(1);
    expect(fake.reports).toEqual([]);
    expect(fake.said.at(-1)?.error).toBe(true);
    expect(fake.said.at(-1)?.text).toMatch(/took longer than 2 seconds and was stopped/);
  });

  it('Find All of every open document stops at the first document that runs away', async () => {
    const s = stuck();
    fake.runner = s.runner;
    fake.answers.push({ ...RUNAWAY, scope: 'open' });
    await run('search.findAll');
    expect(s.jobs).toHaveLength(1);
    expect(fake.reports).toEqual([]);
  });

  it('Replace All stops it before the transform reads the document, and changes nothing', async () => {
    const s = stuck();
    fake.runner = s.runner;
    fake.answers.push(RUNAWAY);
    await run('search.replace');
    expect(s.jobs).toHaveLength(1);
    expect(fake.ran).toEqual([]);
    expect(fake.said.at(-1)?.text).toMatch(/Nothing was found or changed/);
  });

  it('lets a sound pattern through, and a word query never asks the worker', async () => {
    const s = stuck();
    fake.runner = { run: (job, ms) => (s.jobs.push(job), import('$lib/core/regexGuard/runner').then((m) => m.createInlineRunner().run(job, ms))), dispose: () => undefined };
    fake.answers.push({ ...FORM, query: 'G\\d', wholeAddress: false, regex: true });
    await run('search.findAll');
    expect((fake.reports[0] as ReportData).rows.length).toBeGreaterThan(0);
    expect(s.jobs).toHaveLength(1);
    fake.answers.push(FORM);
    await run('search.findAll');
    expect(s.jobs).toHaveLength(1); // the word query did not go to the worker
  });
});

describe('Find All limited to a channel (P4.31)', () => {
  // Channel 1 at 3-4 and 7, channel 2 at 5-6; G1 in every channel.
  const PROGRAM = ['%', 'O1000', '$1', 'G1 X1', '$2', 'G1 X2', '$1', 'G1 X3'];
  const PARAMS = { layout: 'single-file', list: [{ id: '1', name: 'Path 1' }, { id: '2', name: 'Path 2' }, { id: '3', name: 'Path 3' }] };
  const idsOf = (fields: unknown[]) => (fields as { id: string }[]).map((f) => f.id);

  beforeEach(() => {
    fake.documents = { a: PROGRAM, b: ['G1', 'X5'] };
    fake.sets = { a: toySet(PROGRAM) };
    fake.channelParams = PARAMS;
  });

  it('offers the Channel choice: all, then each channel the program has in the machine s order', async () => {
    fake.answers.push(undefined);
    await run('search.findAll');
    const field = (fake.fields[0] as { id: string; choices: { label: string; value: string }[]; default: string }[]).find((f) => f.id === 'channel');
    expect(field?.default).toBe('*');
    expect(field?.choices).toEqual([
      { label: 'All channels', value: '*' },
      { label: 'Path 1', value: '1' },
      { label: 'Path 2', value: '2' },
    ]);
  });

  it('offers nothing for a program without channel sections', async () => {
    fake.sets = {};
    fake.answers.push(undefined);
    await run('search.findAll');
    expect(idsOf(fake.fields[0])).not.toContain('channel');
  });

  it('reads only the lines of the channel, and the rows keep the document s line numbers', async () => {
    fake.answers.push({ ...FORM, channel: '1' });
    await run('search.findAll');
    const report = fake.reports[0] as ReportData;
    expect(report.rows.map((r) => r.line)).toEqual([4, 8]);
    expect(report.title).toBe('2 hits for G1');
    expect(report.message).toBe('Only the lines of Path 1.');
  });

  it('All channels is the whole program, without a note', async () => {
    fake.answers.push({ ...FORM, channel: '*' });
    await run('search.findAll');
    const report = fake.reports[0] as ReportData;
    expect(report.rows.map((r) => r.line)).toEqual([4, 6, 8]);
    expect(report.message).toBeUndefined();
  });

  it('a remembered channel this program does not have is all channels', async () => {
    fake.answers.push({ ...FORM, channel: '3' });
    await run('search.findAll');
    expect((fake.reports[0] as ReportData).rows).toHaveLength(3);
  });

  it('in all open documents, a document without that channel is skipped and the Results say so', async () => {
    fake.answers.push({ ...FORM, scope: 'open', channel: '2' });
    await run('search.findAll');
    const report = fake.reports[0] as ReportData;
    expect(report.rows.map((r) => [r.docId, r.line])).toEqual([['a', 6]]);
    expect(report.message).toBe('Only the lines of Path 2. 1 document was skipped because it has no lines of this channel.');
  });

  it('a channel file is searched whole when it is that channel s file', async () => {
    fake.sets.b = { layout: 'multi-file', self: { id: '1', name: 'Path 1', index: 0 }, members: [], missing: [], outside: [], marks: [], problems: [], truncated: false };
    fake.answers.push({ ...FORM, scope: 'open', channel: '1' });
    await run('search.findAll');
    expect((fake.reports[0] as ReportData).rows.map((r) => [r.docId, r.line])).toEqual([['a', 4], ['a', 8], ['b', 1]]);
  });

  it('keeps the regex guard: a pattern that runs away inside the channel is stopped', async () => {
    fake.runner = {
      run: (_job, budgetMs) => Promise.resolve({ status: 'timeout' as const, budgetMs, probe: 'query' }),
      dispose: () => undefined,
    };
    fake.answers.push({ ...FORM, query: '(a+)+$', wholeAddress: false, regex: true, channel: '1' });
    await run('search.findAll');
    expect(fake.reports).toEqual([]);
    expect(fake.said.at(-1)?.error).toBe(true);
  });

  it('Replace All has no Channel choice', async () => {
    fake.answers.push(undefined);
    await run('search.replace');
    expect(idsOf(fake.fields[0])).not.toContain('channel');
  });
});
