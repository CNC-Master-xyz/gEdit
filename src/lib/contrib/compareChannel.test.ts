// The Channel choice of Compare (P4.31, plan section 6.8.6): asked after the other side is
// chosen, for a program with channel sections; the first answer is the whole program; a
// command given its document as an argument is never asked; a file is never cut.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TOY_PROGRAM, toySet } from '$lib/core/channels/paneFixtures';
import type { QuickPickItem } from '$lib/app/types';

const fake = vi.hoisted(() => ({
  sets: {} as Record<string, unknown>,
  params: null as unknown,
  picks: [] as (string | null | undefined)[],
  asked: [] as { items: { label: string; detail?: string; value: string | null }[]; placeholder?: string }[],
  opened: [] as { docId: string; source: unknown; o: unknown }[],
  docs: [{ id: 'a', title: 'a.nc', path: '/a.nc' }, { id: 'b', title: 'b.nc', path: '/b.nc' }] as { id: string; title: string; path: string | null }[],
}));

vi.mock('$lib/app/compare', () => ({
  compareController: { open: (docId: string, source: unknown, o: unknown) => (fake.opened.push({ docId, source, o }), Promise.resolve(true)) },
  autoTarget: (all: { id: string }[], docId: string) => {
    const others = all.filter((d) => d.id !== docId);
    return others.length === 1 ? others[0].id : null;
  },
  availableSources: () => ['saved', 'document', 'file'],
  documentTargets: (all: { id: string }[], docId: string) => all.filter((d) => d.id !== docId),
}));
vi.mock('$lib/components/editor/CompareView.svelte', () => ({ default: {} }));
vi.mock('$lib/monaco/diff', () => ({ currentDiff: () => null }));
vi.mock('$lib/app/dialogs', () => ({ dialogs: { exclusive: (f: () => unknown) => f(), pickFile: () => Promise.resolve('/x.nc') } }));
vi.mock('$lib/app/modals', () => ({
  modals: {
    quickPick: (items: QuickPickItem<string | null>[], o: { placeholder?: string }) => {
      fake.asked.push({ items: items as never, placeholder: o.placeholder });
      return Promise.resolve(fake.picks.shift());
    },
  },
}));
vi.mock('$lib/app/status', () => ({ status: { show: () => {} } }));
vi.mock('$lib/stores/documents', () => ({ docs: { all: () => fake.docs, get: (id: string) => fake.docs.find((d) => d.id === id) } }));
vi.mock('$lib/stores/channels', () => ({
  channels: {
    fresh: (id: string) => fake.sets[id] ?? { layout: 'none', self: null, members: [], missing: [], outside: [], marks: [], problems: [], truncated: false },
    params: () => fake.params,
  },
}));

const { default: contribution, askChannel } = await import('./compare');
const byId = new Map((contribution.commands ?? []).map((c) => [c.id, c]));
const run = (id: string, arg?: unknown) => byId.get(id)?.run({ activeDocId: 'a' } as never, arg);

const PARAMS = { layout: 'single-file', list: [{ id: '1', name: 'Path 1' }, { id: '2', name: 'Path 2' }, { id: '3', name: 'Path 3' }] };

beforeEach(() => {
  fake.sets = { a: toySet(TOY_PROGRAM) };
  fake.params = PARAMS;
  fake.picks = [];
  fake.asked = [];
  fake.opened = [];
  fake.docs = [{ id: 'a', title: 'a.nc', path: '/a.nc' }, { id: 'b', title: 'b.nc', path: '/b.nc' }];
});

describe('askChannel', () => {
  it('offers the whole program first, then each channel the program has', async () => {
    fake.picks.push(null);
    expect(await askChannel('a')).toEqual({});
    expect(fake.asked[0].items.map((i) => [i.label, i.value])).toEqual([
      ['The whole program', null],
      ['Path 1', '1'],
      ['Path 2', '2'],
    ]);
    expect(fake.asked[0].placeholder).toBe('Compare which lines?');
  });

  it('answers the channel picked, and undefined when the question is cancelled', async () => {
    fake.picks.push('2');
    expect(await askChannel('a')).toEqual({ channel: '2' });
    fake.picks.push(undefined);
    expect(await askChannel('a')).toBeUndefined();
  });

  it('does not ask about a program without channel sections', async () => {
    fake.sets = {};
    expect(await askChannel('a')).toEqual({});
    expect(fake.asked).toEqual([]);
  });
});

describe('the compare commands', () => {
  it('compare.withDocument asks and hands the channel to the comparison', async () => {
    fake.picks.push('1');
    await run('compare.withDocument');
    expect(fake.opened).toEqual([{ docId: 'a', source: { kind: 'document', docId: 'b' }, o: { channel: '1' } }]);
  });

  it('the whole program is the first answer, and opens as before', async () => {
    fake.picks.push(null);
    await run('compare.withSaved');
    expect(fake.opened).toEqual([{ docId: 'a', source: { kind: 'saved' }, o: {} }]);
  });

  it('a cancelled question opens nothing', async () => {
    fake.picks.push(undefined);
    await run('compare.withDocument');
    expect(fake.opened).toEqual([]);
  });

  it('a command given its document as an argument (the external-change banner) is never asked', async () => {
    await run('compare.withSaved', { docId: 'a' });
    expect(fake.asked).toEqual([]);
    expect(fake.opened).toEqual([{ docId: 'a', source: { kind: 'saved' }, o: {} }]);
  });

  it('a program without channels is compared without a question', async () => {
    fake.sets = {};
    await run('compare.withDocument');
    expect(fake.asked).toEqual([]);
    expect(fake.opened).toHaveLength(1);
  });

  it('a file is never cut: no question for compare.withFile', async () => {
    await run('compare.withFile');
    expect(fake.asked).toEqual([]);
    expect(fake.opened).toEqual([{ docId: 'a', source: { kind: 'file', path: '/x.nc' }, o: undefined }]);
  });
});
