// Save Channel Files (P4.31, plan section 6.8.6): the names proposed for the channel documents
// of a split, the order of the Save As dialogs, a cancelled one, two files with one name, and the
// command's place (NC tab, channels group, order 96, offered with a split record).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TOY_PROGRAM, toySet } from '$lib/core/channels/paneFixtures';
import { splitRecord } from '$lib/core/channels/merge';
import type { ChannelParams } from '$lib/core/channels/types';
import { hasKey, t } from '$lib/i18n';
import type { DocId, DocMeta } from '$lib/app/types';

vi.mock('$lib/stores/channels', () => ({ channels: {} }));
vi.mock('$lib/app/dialogs', () => ({ dialogs: {} }));
vi.mock('$lib/app/fileOps', () => ({ files: {} }));
vi.mock('$lib/app/modals', () => ({ modals: {} }));
vi.mock('$lib/app/outlineService', () => ({ computeJumpLines: () => ({}), computeFlow: () => ({}) }));
vi.mock('$lib/app/status', () => ({ status: { show: () => {} } }));
vi.mock('$lib/monaco/editorService', () => ({ editor: {} }));
vi.mock('$lib/stores/documents', () => ({ docs: { getActiveId: () => 'toy', get: () => undefined, activate: () => {} } }));
vi.mock('$lib/stores/machines', () => ({ machines: {} }));
vi.mock('$lib/stores/results', () => ({ results: {} }));

const { default: contribution, saveChannelFiles, proposedNames, splitRecords, usualChannelName } = await import('./channels');

const PARAMS = { layout: 'single-file', list: [{ id: '1', name: 'Path 1' }, { id: '2', name: 'Path 2' }] } as ChannelParams;
const record = () => splitRecord({ sourceId: 'toy', lines: TOY_PROGRAM, set: toySet(TOY_PROGRAM), made: [{ channelId: '1', docId: 'c1' }, { channelId: '2', docId: 'c2' }] });
const names = (id: string) => (id === '1' ? 'Path 1' : 'Path 2');

interface Scene {
  shown: { text: string; error: boolean }[];
  /** The order the dialogs were asked in, with the proposed path each had at that moment. */
  asked: { id: DocId; proposed: string | null | undefined }[];
  meta: Map<DocId, Partial<DocMeta>>;
  answers: Map<DocId, boolean>;
  deps: Parameters<typeof saveChannelFiles>[0];
}

function scene(o: { params?: ChannelParams | null; sourcePath?: string | null; closed?: DocId[] } = {}): Scene {
  const meta = new Map<DocId, Partial<DocMeta>>([
    ['toy', { id: 'toy', title: 'PART.MPF', path: o.sourcePath === undefined ? '/jobs/2214/PART.MPF' : o.sourcePath }],
    ['c1', { id: 'c1', title: 'PART — Path 1.MPF', path: null }],
    ['c2', { id: 'c2', title: 'PART — Path 2.MPF', path: null }],
  ]);
  for (const id of o.closed ?? []) meta.delete(id);
  const asked: Scene['asked'] = [];
  const answers = new Map<DocId, boolean>([['c1', true], ['c2', true]]);
  const shown: Scene['shown'] = [];
  const deps: Scene['deps'] = {
    docs: {
      get: (id) => meta.get(id) as DocMeta | undefined,
      update: (id, patch) => void meta.set(id, { ...meta.get(id), ...patch }),
    },
    save: (id) => {
      asked.push({ id, proposed: meta.get(id)?.proposedPath });
      return Promise.resolve(answers.get(id) ?? false);
    },
    params: () => (o.params === undefined ? PARAMS : o.params),
    show: (text, error) => void shown.push({ text, error: error === true }),
  };
  splitRecords.clear();
  splitRecords.remember(record());
  return { shown, asked, meta, answers, deps };
}

describe('the names proposed', () => {
  it('N1: a machine without file-name rules gets the split s usual names in the program s folder', () => {
    const p = proposedNames({ title: 'PART.MPF', path: '/jobs/2214/PART.MPF' }, record(), PARAMS, names);
    expect(p.map((x) => x.name)).toEqual(['/jobs/2214/PART — Path 1.MPF', '/jobs/2214/PART — Path 2.MPF']);
    expect(p.every((x) => x.usual && !x.template)).toBe(true);
  });

  it('N1: the machine s rule wins, with the stem of the program s title', () => {
    const params = { ...PARAMS, fileNameFor: '{{stem}}_CH{{channel}}.nc' } as ChannelParams;
    const p = proposedNames({ title: 'PART.MPF', path: 'C:\\jobs\\PART.MPF' }, record(), params, names);
    expect(p.map((x) => x.name)).toEqual(['C:\\jobs\\PART_CH1.nc', 'C:\\jobs\\PART_CH2.nc']);
    expect(p.every((x) => !x.usual)).toBe(true);
  });

  it('N3, N4: a rule that gives no usable name falls back to the usual one and is marked, so it can be said', () => {
    const params = { ...PARAMS, fileNameFor: '{{stem}}.nc' } as ChannelParams;
    const p = proposedNames({ title: 'PART.MPF', path: null }, record(), params, names);
    expect(p.map((x) => x.name)).toEqual(['PART — Path 1.MPF', 'PART — Path 2.MPF']);
    expect(p.every((x) => x.usual && x.template)).toBe(true);
  });

  it('the usual name is the split s own', () => {
    expect(usualChannelName('PART', '.MPF', 'Path 1')).toBe('PART — Path 1.MPF');
  });
});

describe('saveChannelFiles', () => {
  beforeEach(() => splitRecords.clear());

  it('asks one Save As after the other, each document with its proposed path in the program s folder', async () => {
    const s = scene();
    await saveChannelFiles(s.deps, 'toy');
    expect(s.asked).toEqual([
      { id: 'c1', proposed: '/jobs/2214/PART — Path 1.MPF' },
      { id: 'c2', proposed: '/jobs/2214/PART — Path 2.MPF' },
    ]);
    expect(s.shown).toEqual([{ text: 'Saved 2 of 2 channel files.', error: false }]);
  });

  it('works from a channel document as well as from the program', async () => {
    const s = scene();
    await saveChannelFiles(s.deps, 'c2');
    expect(s.asked.map((a) => a.id)).toEqual(['c1', 'c2']);
  });

  it('a cancelled dialog leaves that document unsaved and goes on; the line says how many were written', async () => {
    const s = scene();
    s.answers.set('c1', false);
    await saveChannelFiles(s.deps, 'toy');
    expect(s.asked.map((a) => a.id)).toEqual(['c1', 'c2']);
    expect(s.shown).toEqual([{ text: 'Saved 1 of 2 channel files.', error: false }]);
    expect(s.meta.get('c1')?.path).toBeNull();
  });

  it('uses one channel s own rule and the usual name for a channel without one, and says nothing about the latter', async () => {
    const s = scene({ params: { ...PARAMS, list: [{ id: '1', name: 'Path 1', fileName: '{{stem}}.MPF' }, { id: '2', name: 'Path 2' }] } as ChannelParams });
    await saveChannelFiles(s.deps, 'toy');
    expect(s.asked[0].proposed).toBe('/jobs/2214/PART.MPF');
    expect(s.asked[1].proposed).toBe('/jobs/2214/PART — Path 2.MPF');
    expect(s.shown[0].text).toBe('Saved 2 of 2 channel files.');
  });

  it('says which channels got the usual name although the machine has a rule for them (the rule gave one name twice)', async () => {
    const s = scene({ params: { ...PARAMS, fileNameFor: '{{stem}}.nc' } as ChannelParams });
    await saveChannelFiles(s.deps, 'toy');
    expect(s.asked.map((a) => a.proposed)).toEqual(['/jobs/2214/PART — Path 1.MPF', '/jobs/2214/PART — Path 2.MPF']);
    expect(s.shown[0].text).toBe('Saved 2 of 2 channel files. The machine has no usable file name for Path 1, Path 2, so the usual name was proposed.');
  });

  it('refuses two files with one name before any dialog is asked', async () => {
    const same = { ...PARAMS, list: [{ id: '1', name: 'Path' }, { id: '2', name: 'Path' }] } as ChannelParams;
    const s = scene({ params: same });
    await saveChannelFiles(s.deps, 'toy');
    expect(s.asked).toEqual([]);
    expect(s.shown[0].error).toBe(true);
    expect(s.shown[0].text).toContain('Two channel files would get the same name');
    expect(s.shown[0].text).toContain('PART — Path.MPF');
  });

  it('skips a channel document that was closed, and counts only the open ones', async () => {
    const s = scene({ closed: ['c1'] });
    await saveChannelFiles(s.deps, 'toy');
    expect(s.asked.map((a) => a.id)).toEqual(['c2']);
    expect(s.shown[0].text).toBe('Saved 1 of 1 channel files.');
  });

  it('refuses in plain words without a split record, with the program closed, or with every document closed', async () => {
    const s = scene();
    splitRecords.clear();
    await saveChannelFiles(s.deps, 'toy');
    expect(s.shown.at(-1)).toEqual({ text: t('channelScope.files.noRecord'), error: true });
    const closedSource = scene({ closed: ['toy'] });
    await saveChannelFiles(closedSource.deps, 'c1');
    expect(closedSource.shown.at(-1)?.error).toBe(true);
    expect(closedSource.shown.at(-1)?.text).toBe(t('channelScope.files.sourceClosed'));
    const noneOpen = scene({ closed: ['c1', 'c2'] });
    await saveChannelFiles(noneOpen.deps, 'toy');
    expect(noneOpen.shown.at(-1)).toEqual({ text: t('channelScope.files.nothingOpen'), error: true });
    expect(noneOpen.asked).toEqual([]);
  });

  it('a program that was never saved proposes the names without a folder', async () => {
    const s = scene({ sourcePath: null });
    await saveChannelFiles(s.deps, 'toy');
    expect(s.asked[0].proposed).toBe('PART — Path 1.MPF');
  });

  it('a channel document that already has a file is saved to it, not asked again for a name', async () => {
    const s = scene();
    s.meta.set('c1', { ...s.meta.get('c1'), path: '/jobs/2214/PART_1.nc' });
    await saveChannelFiles(s.deps, 'toy');
    expect(s.asked[0]).toEqual({ id: 'c1', proposed: undefined });
  });
});

describe('the command', () => {
  const cmd = (contribution.commands ?? []).find((c) => c.id === 'channels.saveChannelFiles');

  it('is on the NC tab in the channels group at order 96, with a title and the channels category', () => {
    expect(cmd).toBeDefined();
    expect(hasKey(cmd?.title ?? '')).toBe(true);
    expect(cmd?.category).toBe('channels.category');
    expect(cmd?.keys).toBeUndefined();
    expect(contribution.ribbon).toContainEqual({ tab: 'nc', group: 'channels.group', command: 'channels.saveChannelFiles', order: 96 });
    expect(t(cmd?.title ?? '')).toBe('Save Channel Files…');
  });

  it('is offered for a program with a split record or one of its channel documents, and for no other', () => {
    scene();
    expect(cmd?.enabled?.({ activeDocId: 'toy' } as never)).toBe(true);
    expect(cmd?.enabled?.({ activeDocId: 'c2' } as never)).toBe(true);
    expect(cmd?.enabled?.({ activeDocId: 'other' } as never)).toBe(false);
    expect(cmd?.enabled?.({ activeDocId: null } as never)).toBe(false);
  });
});
