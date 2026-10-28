// Merge Channels Back (P4.23, plan §5 P4e decision 15, §6.7 rule 16): the record the split
// keeps, the command's refusals in plain words, one `applyLines` call, the real undo step on
// Monaco's own model, and the older record that takes over after the merge is undone.

import { describe, expect, it, vi } from 'vitest';
import type { DocMeta, Msg } from '$lib/app/types';
import { TOY_PROGRAM, toySet } from '$lib/core/channels/paneFixtures';
import { splitRecord } from '$lib/core/channels/merge';
import { applyLinesTo } from '$lib/monaco/applyLines';
import { realModel } from '$lib/monaco/realModel';
import { hasKey, t } from '$lib/i18n';

vi.mock('$lib/stores/channels', () => ({ channels: {} }));
vi.mock('$lib/app/dialogs', () => ({ dialogs: {} }));
vi.mock('$lib/app/fileOps', () => ({ files: {} }));
vi.mock('$lib/app/modals', () => ({ modals: {} }));
vi.mock('$lib/app/outlineService', () => ({ computeJumpLines: () => ({}), computeFlow: () => ({}) }));
vi.mock('$lib/app/status', () => ({ status: { show: () => {} } }));
vi.mock('$lib/monaco/editorService', () => ({ editor: {} }));
vi.mock('$lib/stores/documents', () => ({ docs: { getActiveId: () => 'c1', get: () => undefined, activate: () => {} } }));
vi.mock('$lib/stores/machines', () => ({ machines: {} }));
vi.mock('$lib/stores/results', () => ({ results: {} }));

const { default: contribution, mergeBack, splitRecords } = await import('./channels');

const C1 = ['%', 'O1000', '$1', 'A1', 'A2', '$1', 'A3'];
const C2 = ['%', 'O1000', '$2', 'B1', '$2', 'B2'];

/** A fake app: documents with lines, the toy channel reading, and what was said and written. */
function world(o: { readOnly?: boolean } = {}) {
  const texts = new Map<string, string[]>([
    ['toy', [...TOY_PROGRAM]],
    ['c1', [...C1]],
    ['c2', [...C2]],
  ]);
  const meta = new Map<string, Partial<DocMeta>>([
    ['toy', { id: 'toy', title: 'prog.nc', readOnly: o.readOnly === true }],
    ['c1', { id: 'c1', title: 'prog_1.nc' }],
    ['c2', { id: 'c2', title: 'prog_2.nc' }],
  ]);
  const said: { msg: Msg; error: boolean }[] = [];
  const writes: { id: string; start: number; end: number; lines: string[] }[] = [];
  const activated: string[] = [];
  const deps = {
    docs: { get: (id: string) => meta.get(id) as DocMeta | undefined, activate: (id: string) => void activated.push(id) },
    editor: {
      getLines: (id: string, from: number, to: number) => texts.get(id)!.slice(from - 1, to),
      getLineCount: (id: string) => texts.get(id)!.length,
    },
    fresh: (id: string) => toySet(texts.get(id)!),
    resolve: (_id: string, lines: readonly string[]) => toySet(lines),
    applyLines: (id: string, start: number, end: number, lines: string[]) => {
      writes.push({ id, start, end, lines });
      texts.set(id, [...lines]);
      return { changedLines: 1 };
    },
    say: (msg: Msg, error = false) => void said.push({ msg, error }),
  };
  splitRecords.clear();
  splitRecords.remember(splitRecord({ sourceId: 'toy', lines: TOY_PROGRAM, set: toySet(TOY_PROGRAM), made: [{ channelId: '1', docId: 'c1' }, { channelId: '2', docId: 'c2' }] }));
  return { texts, meta, said, writes, activated, deps };
}

describe('the split’s record', () => {
  it('answers for the program and for each of its channel documents, and for no other document', () => {
    const w = world();
    expect(splitRecords.forDoc('toy')).toHaveLength(1);
    expect(splitRecords.forDoc('c2')[0].sourceId).toBe('toy');
    expect(splitRecords.forDoc('other')).toEqual([]);
    expect(w.said).toEqual([]);
  });

  it('is replaced by a new split of the same program', () => {
    world();
    splitRecords.remember(splitRecord({ sourceId: 'toy', lines: TOY_PROGRAM, set: toySet(TOY_PROGRAM), made: [{ channelId: '1', docId: 'd1' }] }));
    expect(splitRecords.forDoc('c1')).toEqual([]);
    expect(splitRecords.forDoc('d1')).toHaveLength(1);
  });

  it('is offered only for a program with a record or one of its channel documents (the command’s enabled)', () => {
    world();
    const cmd = (contribution.commands ?? []).find((c) => c.id === 'channels.mergeBack')!;
    const context = (activeDocId: string | null) => ({ activeDocId }) as Parameters<typeof cmd.enabled & ((c: never) => boolean)>[0];
    expect(cmd.enabled?.(context('toy') as never)).toBe(true);
    expect(cmd.enabled?.(context('c1') as never)).toBe(true);
    expect(cmd.enabled?.(context('other') as never)).toBe(false);
    expect(cmd.enabled?.(context(null) as never)).toBe(false);
  });

  it('is on the NC tab after the split, with its title and every message', () => {
    expect((contribution.ribbon ?? []).find((r) => r.command === 'channels.mergeBack')).toEqual({ tab: 'nc', group: 'channels.group', command: 'channels.mergeBack', order: 95 });
    for (const key of ['sourceChanged', 'headerChanged', 'sectionsMoved', 'sharedChanged', 'nothing', 'noRecord', 'sourceClosed', 'done']) {
      expect(hasKey(`channels.merge.${key}`), key).toBe(true);
    }
    expect(t('channels.mergeBack')).toBe('Merge Channels Back');
  });
});

describe('Merge Channels Back', () => {
  it('writes the whole program with one applyLines call, shows it and renews the record', () => {
    const w = world();
    w.texts.set('c1', [...C1.slice(0, 6), 'A3 X5.']);
    mergeBack(w.deps, 'c1');
    expect(w.writes).toEqual([{ id: 'toy', start: 1, end: 11, lines: ['%', 'O1000', '$1', 'A1', 'A2', '$2', 'B1', '$1', 'A3 X5.', '$2', 'B2'] }]);
    expect(w.activated).toEqual(['toy']);
    expect(w.said).toEqual([{ msg: { key: 'channels.merge.done', params: { count: 1 } }, error: false }]);
    expect(splitRecords.forDoc('toy')[0].channels[0].lines).toEqual([...C1.slice(0, 6), 'A3 X5.']);
    // Merging again changes nothing more.
    mergeBack(w.deps, 'toy');
    expect(w.writes).toHaveLength(1);
    expect(w.said[1]).toEqual({ msg: { key: 'channels.merge.nothing' }, error: false });
  });

  it('skips a closed channel document and says nothing when every one is closed or unchanged', () => {
    const w = world();
    w.texts.set('c2', ['%', 'O1000', '$2', 'B1 Y2.', '$2', 'B2']);
    w.meta.delete('c1');
    mergeBack(w.deps, 'toy');
    expect(w.writes[0].lines).toEqual(['%', 'O1000', '$1', 'A1', 'A2', '$2', 'B1 Y2.', '$1', 'A3', '$2', 'B2']);
    w.meta.delete('c2');
    mergeBack(w.deps, 'toy');
    expect(w.writes).toHaveLength(1);
    expect(w.said.at(-1)).toEqual({ msg: { key: 'channels.merge.nothing' }, error: false });
  });

  it.each([
    ['the program changed in a merged channel', (w: ReturnType<typeof world>) => {
      w.texts.set('toy', TOY_PROGRAM.map((l) => (l === 'A1' ? 'A1 Z0.' : l)));
      w.texts.set('c1', [...C1.slice(0, 6), 'A3 X5.']);
    }, 'channels.merge.sourceChanged'],
    ['a channel document’s header changed', (w: ReturnType<typeof world>) => w.texts.set('c2', ['%', 'O2000', '$2', 'B1', '$2', 'B2']), 'channels.merge.headerChanged'],
    ['lines would move to another channel', (w: ReturnType<typeof world>) => w.texts.set('c1', ['%', 'O1000', '$1', 'A1', '$2', 'A2', '$1', 'A3']), 'channels.merge.sectionsMoved'],
  ])('refuses and writes nothing when %s', (_name, edit, key) => {
    const w = world();
    edit(w);
    mergeBack(w.deps, 'toy');
    expect(w.writes).toEqual([]);
    expect(w.said).toHaveLength(1);
    expect(w.said[0].error).toBe(true);
    expect(w.said[0].msg.key).toBe(key);
    expect(hasKey(key)).toBe(true);
    expect(t(w.said[0].msg.key, w.said[0].msg.params)).toMatch(/Nothing was changed\.$/);
  });

  it('refuses a document that was not split, a closed program and a read-only program', () => {
    const w = world();
    mergeBack(w.deps, 'other');
    expect(w.said.at(-1)).toEqual({ msg: { key: 'channels.merge.noRecord' }, error: true });
    w.meta.delete('toy');
    mergeBack(w.deps, 'c1');
    expect(w.said.at(-1)).toEqual({ msg: { key: 'channels.merge.sourceClosed' }, error: true });
    const locked = world({ readOnly: true });
    locked.texts.set('c1', [...C1.slice(0, 6), 'A3 X5.']);
    mergeBack(locked.deps, 'c1');
    expect(locked.writes).toEqual([]);
    expect(locked.said[0]).toMatchObject({ error: true, msg: { key: 'readOnly.refusedUser' } });
  });

  it('is one undo step on Monaco’s own model, and the merge can be done again after it', () => {
    const w = world();
    const model = realModel(TOY_PROGRAM.join('\n'));
    w.deps.editor.getLines = (id, from, to) => (id === 'toy' ? model.getValue().split('\n').slice(from - 1, to) : w.texts.get(id)!.slice(from - 1, to));
    w.deps.editor.getLineCount = (id) => (id === 'toy' ? model.getLineCount() : w.texts.get(id)!.length);
    w.deps.fresh = (id) => toySet(id === 'toy' ? model.getValue().split('\n') : w.texts.get(id)!);
    w.deps.applyLines = (_id, start, end, lines) => ({ changedLines: applyLinesTo(model, start, end, lines).changedLines });

    // Something typed first, as its own step.
    model.pushStackElement();
    model.pushEditOperations(null, [{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 }, text: '%' }], () => null);
    model.pushStackElement();

    w.texts.set('c1', ['%', 'O1000', '$1', 'A1 X1.', 'A2', '$1', 'A3 X5.']);
    w.texts.set('c2', ['%', 'O1000', '$2', 'B1', '$2']);
    mergeBack(w.deps, 'toy');
    const merged = ['%', 'O1000', '$1', 'A1 X1.', 'A2', '$2', 'B1', '$1', 'A3 X5.', '$2'];
    expect(model.getValue().split('\n')).toEqual(merged);

    model.undo();
    expect(model.getValue().split('\n')).toEqual(TOY_PROGRAM);

    // The program reads as before the merge again; the documents still hold the edits.
    mergeBack(w.deps, 'toy');
    expect(model.getValue().split('\n')).toEqual(merged);
    expect(w.said.map((s) => s.msg.key)).toEqual(['channels.merge.done', 'channels.merge.done']);
  });
});
