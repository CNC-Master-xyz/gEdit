// `channels.sideBySide` (Phase 4 plan §6.11 P4e row, §5 P4e decisions 9 and 12; P4.22b): when it is
// offered, what it asks of the channel view, and the file dialog that offers the channel files that
// are not open. The view itself is `monaco/channelPanes.test.ts`.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelMember, ChannelSet } from '$lib/core/channels/types';
import type { CommandContext, CommandDef } from '$lib/app/types';

const fake = vi.hoisted(() => ({
  active: 'a' as string | null,
  docs: new Map<string, { path: string | null }>(),
  sets: new Map<string, unknown>(),
  params: new Map<string, unknown>(),
  siblingsCalls: [] as string[],
  siblingsFail: false,
  opened: [] as string[],
  openAnswer: { ok: true } as { ok: true } | { ok: false; reason: { key: string } },
  dialogCalls: [] as { multiple?: boolean; defaultPath?: string }[],
  dialogAnswer: [] as string[] | undefined,
  filesOpened: [] as string[][],
  said: [] as { text: string; error: boolean }[],
  order: [] as string[],
}));

vi.mock('$lib/monaco/channelPanes', () => ({
  channelPanes: {
    open: async (id: string) => {
      fake.order.push('open');
      fake.opened.push(id);
      return fake.openAnswer;
    },
  },
}));
vi.mock('$lib/stores/channels', () => ({
  channels: {
    params: (id: string) => fake.params.get(id) ?? null,
    fresh: (id: string) => fake.sets.get(id),
    siblings: async (id: string) => {
      fake.siblingsCalls.push(id);
      if (fake.siblingsFail) throw new Error('out of scope');
      return [];
    },
  },
}));
vi.mock('$lib/stores/documents', () => ({
  docs: { getActiveId: () => fake.active, get: (id: string) => fake.docs.get(id) },
}));
vi.mock('$lib/app/dialogs', () => ({
  dialogs: {
    exclusive: async (op: () => Promise<unknown>) => op(),
    openFiles: async (o: { multiple?: boolean; defaultPath?: string }) => {
      fake.order.push('dialog');
      fake.dialogCalls.push(o);
      return fake.dialogAnswer;
    },
  },
}));
vi.mock('$lib/app/fileOps', () => ({
  files: {
    open: async (paths: string[]) => {
      fake.order.push('files.open');
      fake.filesOpened.push(paths);
    },
  },
}));
vi.mock('$lib/app/status', () => ({
  status: { show: (text: string, o?: { error?: boolean }) => fake.said.push({ text, error: o?.error === true }) },
}));

const channelPanes = (await import('./channelPanes')).default;
const { hasKey, t } = await import('$lib/i18n');

const command = (channelPanes.commands ?? [])[0] as CommandDef;
const context = (o: Partial<CommandContext> = {}): CommandContext => ({
  activeDocId: 'a',
  profileId: 'fanuc-lathe',
  hasSelection: false,
  editorFocused: true,
  compareOpen: false,
  modalOpen: false,
  scriptRunning: false,
  ...o,
});

const ref = (id: string, index: number) => ({ id, name: `Turret ${id}`, index });
const member = (channel: number, docId: string | null, exists = true): ChannelMember => ({
  kind: 'file',
  channel: ref(String(channel), channel - 1),
  name: `PART_CH${channel}.nc`,
  path: `/nc/job/PART_CH${channel}.nc`,
  exists,
  docId,
  by: 'fileName',
});
const set = (layout: ChannelSet['layout'], members: ChannelMember[]): ChannelSet => ({ layout, self: null, members, missing: [], outside: [], marks: [], problems: [], truncated: false });

beforeEach(() => {
  fake.active = 'a';
  fake.docs.clear();
  fake.docs.set('a', { path: '/nc/job/PART_CH1.nc' });
  fake.sets.clear();
  fake.params.clear();
  fake.params.set('a', { layout: 'multi-file', list: [] });
  fake.siblingsCalls.length = 0;
  fake.siblingsFail = false;
  fake.opened.length = 0;
  fake.openAnswer = { ok: true };
  fake.dialogCalls.length = 0;
  fake.dialogAnswer = [];
  fake.filesOpened.length = 0;
  fake.said.length = 0;
  fake.order.length = 0;
});

describe('channels.sideBySide', () => {
  it('is the pinned command: NC tab, group Channels, order 94, no key, a banner panel for the bar', () => {
    expect(command.id).toBe('channels.sideBySide');
    expect(command.title).toBe('channelPanes.sideBySide');
    expect(command.category).toBe('channelPanes.category');
    expect(command.keys).toBeUndefined();
    expect(channelPanes.ribbon).toEqual([{ tab: 'nc', group: 'channels.group', command: 'channels.sideBySide', order: 94 }]);
    expect(channelPanes.panels).toMatchObject([{ id: 'channelViewBar', region: 'banner' }]);
    for (const key of [command.title, command.category!, 'channelPanes.refusal.noChannels', 'channelPanes.refusal.onlyOne', 'channelPanes.refusal.needTwoFiles', 'channelPanes.bar.title', 'channelPanes.openOthers.hint', 'channelPanes.openOthers.none']) {
      expect(hasKey(key), key).toBe(true);
    }
    expect(t(command.title)).toBe('Channels Side by Side');
  });

  it('is offered for a document whose machine has channels, and not otherwise or during a comparison', () => {
    expect(command.enabled?.(context())).toBe(true);
    expect(command.enabled?.(context({ activeDocId: null }))).toBe(false);
    expect(command.enabled?.(context({ compareOpen: true }))).toBe(false);
    fake.params.clear();
    expect(command.enabled?.(context())).toBe(false);
  });

  it('opens the view of a program with channel sections at once', async () => {
    fake.sets.set('a', set('single-file', []));
    await command.run(context());
    expect(fake.opened).toEqual(['a']);
    expect(fake.dialogCalls).toEqual([]);
    expect(fake.siblingsCalls).toEqual([]);
    expect(fake.said).toEqual([]);
  });

  it('says why in the status bar when the view does not open', async () => {
    fake.sets.set('a', set('single-file', []));
    fake.openAnswer = { ok: false, reason: { key: 'channelPanes.refusal.onlyOne' } };
    await command.run(context());
    expect(fake.said).toEqual([{ text: t('channelPanes.refusal.onlyOne'), error: true }]);
  });

  describe('one file per channel', () => {
    it('offers the channel files that are not open through the file dialog in the document’s folder, then opens what was picked, then the view', async () => {
      fake.sets.set('a', set('multi-file', [member(1, 'a'), member(2, null), member(3, null)]));
      fake.dialogAnswer = ['/nc/job/PART_CH2.nc', '/nc/job/PART_CH3.nc'];
      await command.run(context());
      expect(fake.siblingsCalls).toEqual(['a']);
      expect(fake.dialogCalls).toEqual([{ multiple: true, defaultPath: '/nc/job' }]);
      expect(fake.filesOpened).toEqual([['/nc/job/PART_CH2.nc', '/nc/job/PART_CH3.nc']]);
      expect(fake.order).toEqual(['dialog', 'files.open', 'open']);
      expect(fake.opened).toEqual(['a']);
      expect(fake.said[0]).toEqual({ text: t('channelPanes.openOthers.hint'), error: false });
    });

    it('opens nothing by itself: a dialog that is cancelled goes on with the files that are open', async () => {
      fake.sets.set('a', set('multi-file', [member(1, 'a'), member(2, 'b'), member(3, null)]));
      fake.dialogAnswer = undefined; // another dialog was in front
      await command.run(context());
      expect(fake.filesOpened).toEqual([]);
      expect(fake.opened).toEqual(['a']);
    });

    it('says so when nothing was picked, and goes on with what is open', async () => {
      fake.sets.set('a', set('multi-file', [member(1, 'a'), member(2, null)]));
      fake.dialogAnswer = [];
      await command.run(context());
      expect(fake.filesOpened).toEqual([]);
      expect(fake.said.at(-1)).toEqual({ text: t('channelPanes.openOthers.none'), error: false });
      expect(fake.opened).toEqual(['a']);
    });

    it('asks nothing when every channel file that exists is open, or the other files do not exist', async () => {
      fake.sets.set('a', set('multi-file', [member(1, 'a'), member(2, 'b'), member(3, null, false)]));
      await command.run(context());
      expect(fake.dialogCalls).toEqual([]);
      expect(fake.opened).toEqual(['a']);
    });

    it('goes on with what is open when the lookup of the other files fails', async () => {
      fake.sets.set('a', set('multi-file', [member(1, 'a'), member(2, null)]));
      fake.siblingsFail = true;
      await command.run(context());
      expect(fake.dialogCalls).toEqual([]);
      expect(fake.opened).toEqual(['a']);
    });

    it('opens the dialog without a folder for a document that has no path', async () => {
      fake.docs.set('a', { path: null });
      fake.sets.set('a', set('multi-file', [member(1, 'a'), member(2, null)]));
      await command.run(context());
      expect(fake.dialogCalls).toEqual([{ multiple: true, defaultPath: undefined }]);
    });
  });
});
