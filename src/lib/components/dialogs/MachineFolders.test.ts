// The Folders section of a machine (P4.30a; plan 6.8.4). The actions are pure functions over
// `FolderDeps`, tested against a fake machine service: which write each action makes, what it
// refuses and what it says. The markup is rendered with `svelte/server` (no DOM), like the
// other dialogs.

import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { MachineConfig } from '$lib/core/machines/types';
import { t } from '$lib/i18n';

const fake = vi.hoisted(() => {
  const subscribers = new Set<(value: unknown) => void>();
  let list: unknown[] = [];
  return {
    set(next: unknown[]): void {
      list = next;
      for (const run of subscribers) run(next);
    },
    store: {
      subscribe(run: (value: unknown) => void) {
        subscribers.add(run);
        run(list);
        return (): void => void subscribers.delete(run);
      },
    },
  };
});

vi.mock('$lib/stores/machines', () => ({ machines: { list: fake.store } }));
vi.mock('$lib/app/status', () => ({ status: { show: () => {} } }));
vi.mock('$lib/app/dialogs', () => ({ dialogs: { pickFolder: async () => null } }));

import MachineFolders, {
  addFolder,
  clearFolders,
  folderView,
  pickAndAdd,
  removeFolder,
  setSubfolders,
  type FolderDeps,
} from './MachineFolders.svelte';

function machine(id: string, folders?: unknown, name = id): MachineConfig {
  return { id, name, profile: 'fanuc-lathe', params: {}, ...(folders === undefined ? {} : { folders }) } as MachineConfig;
}

function deps(initial: MachineConfig[], o: { blocked?: boolean; picked?: string | null; fail?: boolean } = {}) {
  const all = new Map(initial.map((m) => [m.id, m]));
  const shown: { text: string; error: boolean }[] = [];
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  const d: FolderDeps = {
    machines: {
      get: (id) => all.get(id),
      blocked: () => o.blocked === true,
      update: async (id, patch) => {
        if (o.fail) throw new Error('disk full');
        updates.push({ id, patch: patch as Record<string, unknown> });
        const previous = all.get(id);
        if (previous) all.set(id, { ...previous, ...patch });
      },
    },
    status: { show: (text, x) => void shown.push({ text, error: x?.error === true }) },
    t,
    pickFolder: async () => o.picked ?? null,
    caseInsensitive: false,
  };
  return { d, shown, updates, all };
}

describe('adding a folder', () => {
  it('writes the whole list with the new folder last, as typed (trimmed)', async () => {
    const h = deps([machine('a', [{ path: '/dnc/a' }])]);
    expect(await addFolder('a', '  D:\\DNC\\Lathe1  ', h.d)).toBe(true);
    expect(h.updates).toEqual([{ id: 'a', patch: { folders: [{ path: '/dnc/a' }, { path: 'D:\\DNC\\Lathe1' }] } }]);
  });

  it('refuses a path that is not absolute, with a plain sentence, and writes nothing', async () => {
    const h = deps([machine('a')]);
    for (const text of ['', '   ', 'dnc/lathe1', 'D:dnc', '/dnc/../x', '\\\\server']) {
      expect(await addFolder('a', text, h.d), text).toBe(false);
    }
    expect(h.updates).toEqual([]);
    expect(h.shown[0]).toMatchObject({ error: true });
    expect(h.shown[0].text).toContain('full path');
  });

  it('refuses the same folder twice (another spelling of its separators included)', async () => {
    const h = deps([machine('a', [{ path: 'D:\\DNC\\Lathe1' }])]);
    expect(await addFolder('a', 'D:/DNC/Lathe1/', h.d)).toBe(false);
    expect(h.shown[0].text).toContain('already');
  });

  it('refuses the 17th folder and a path of more than 1,024 characters', async () => {
    const sixteen = Array.from({ length: 16 }, (_, k) => ({ path: `/dnc/${k}` }));
    const full = deps([machine('a', sixteen)]);
    expect(await addFolder('a', '/dnc/new', full.d)).toBe(false);
    expect(full.shown[0].text).toContain('at most 16');
    const long = deps([machine('a')]);
    expect(await addFolder('a', `/${'x'.repeat(1030)}`, long.d)).toBe(false);
    expect(long.shown[0].text).toContain('1024');
  });

  it('a list that cannot be read is not extended: it has to be started again first', async () => {
    const h = deps([machine('a', [{ path: '/ok' }, { path: 'relative' }])]);
    expect(await addFolder('a', '/dnc/a', h.d)).toBe(false);
    expect(await removeFolder('a', 0, h.d)).toBe(false);
    expect(await setSubfolders('a', 0, false, h.d)).toBe(false);
    expect(h.updates).toEqual([]);
    expect(h.shown.every((s) => s.error && s.text.includes('Start the list again'))).toBe(true);
  });

  it('is refused while the machines file cannot be written', async () => {
    const h = deps([machine('a')], { blocked: true });
    expect(await addFolder('a', '/dnc/a', h.d)).toBe(false);
    expect(h.updates).toEqual([]);
    expect(h.shown[0]).toMatchObject({ error: true, text: t('machineFolders.blocked') });
  });

  it('says so when the write fails, and answers false', async () => {
    const h = deps([machine('a')], { fail: true });
    expect(await addFolder('a', '/dnc/a', h.d)).toBe(false);
    expect(h.shown[0]).toMatchObject({ error: true, text: t('machineFolders.saveFailed') });
  });

  it('a machine that is gone is not written', async () => {
    const h = deps([]);
    expect(await addFolder('nope', '/dnc/a', h.d)).toBe(false);
    expect(h.updates).toEqual([]);
  });
});

describe('the picker', () => {
  it('adds the folder the system picker answers, with the same checks', async () => {
    const h = deps([machine('a')], { picked: '/dnc/picked' });
    expect(await pickAndAdd('a', h.d)).toBe(true);
    expect(h.updates[0].patch).toEqual({ folders: [{ path: '/dnc/picked' }] });
  });

  it('does nothing when the user cancels or there is no picker', async () => {
    const h = deps([machine('a')], { picked: null });
    expect(await pickAndAdd('a', h.d)).toBe(false);
    expect(await pickAndAdd('a', { ...h.d, pickFolder: undefined })).toBe(false);
    expect(h.updates).toEqual([]);
  });
});

describe('removing, subfolders, starting again', () => {
  const base = () => deps([machine('a', [{ path: '/dnc/a' }, { path: '/dnc/b', subfolders: false }])]);

  it('removes one folder by position', async () => {
    const h = base();
    expect(await removeFolder('a', 0, h.d)).toBe(true);
    expect(h.updates[0].patch).toEqual({ folders: [{ path: '/dnc/b', subfolders: false }] });
  });

  it('the last folder removed takes the member away', async () => {
    const h = deps([machine('a', [{ path: '/dnc/a' }])]);
    await removeFolder('a', 0, h.d);
    expect(h.updates[0].patch).toEqual({ folders: undefined });
  });

  it('a position that is not there writes nothing', async () => {
    const h = base();
    expect(await removeFolder('a', 5, h.d)).toBe(false);
    expect(await setSubfolders('a', -1, true, h.d)).toBe(false);
    expect(h.updates).toEqual([]);
  });

  it('subfolders off is written as false; on is the default and leaves the member out', async () => {
    const h = base();
    await setSubfolders('a', 0, false, h.d);
    expect(h.updates[0].patch).toEqual({ folders: [{ path: '/dnc/a', subfolders: false }, { path: '/dnc/b', subfolders: false }] });
    await setSubfolders('a', 1, true, h.d);
    expect(h.updates[1].patch).toEqual({ folders: [{ path: '/dnc/a', subfolders: false }, { path: '/dnc/b' }] });
  });

  it('starting a broken list again removes the member', async () => {
    const h = deps([machine('a', 'not a list')]);
    expect(await clearFolders('a', h.d)).toBe(true);
    expect(h.updates[0].patch).toEqual({ folders: undefined });
  });
});

describe('what the section shows', () => {
  it('lists the folders of the machine and the folders it shares with another machine', () => {
    const all = [
      machine('a', [{ path: '/dnc/shared' }, { path: '/dnc/a' }], 'Lathe A'),
      machine('b', [{ path: '/dnc/shared' }], 'Lathe B'),
      machine('c', [{ path: '/dnc/c' }]),
    ];
    const a = folderView('a', all, false);
    expect(a.folders.map((f) => f.path)).toEqual(['/dnc/shared', '/dnc/a']);
    expect(a.conflicts).toHaveLength(1);
    expect(a.conflicts[0]).toContain('"Lathe A" and "Lathe B"');
    expect(folderView('b', all, false).conflicts).toHaveLength(1);
    expect(folderView('c', all, false).conflicts).toEqual([]);
  });

  it('reports the problems of a stored list with their JSON paths', () => {
    const view = folderView('a', [machine('x'), machine('a', [{ path: 'relative' }])], false);
    expect(view.folders).toEqual([]);
    expect(view.problems[0].path).toBe('machines[1].folders[0].path');
  });

  it('renders the rows, the help that a link or a mapped drive is not followed, and the add controls', () => {
    fake.set([machine('a', [{ path: 'D:\\DNC\\Lathe1' }, { path: '/dnc/b', subfolders: false }]), machine('b', [{ path: '/dnc/b' }], 'B')]);
    const html = render(MachineFolders, { props: { machineId: 'a' } }).body;
    expect(html).toContain('data-testid="machine-folders"');
    expect(html).toContain('Folders (2)');
    expect(html.match(/data-testid="folder-row"/g)).toHaveLength(2);
    expect(html).toContain('D:\\DNC\\Lathe1');
    expect(html).toContain('mapped drive');
    expect(html).toContain('data-testid="folder-add-path"');
    expect(html).toContain('Choose folder');
    expect(html).toContain('data-testid="folder-conflict"');
    expect(html).toContain('Same folder on two machines');
  });

  it('renders a broken list with its problems and "Start the list again", and no add controls', () => {
    fake.set([machine('a', [{ path: 'relative' }])]);
    const html = render(MachineFolders, { props: { machineId: 'a' } }).body;
    expect(html).toContain('data-testid="folder-problems"');
    expect(html).toContain('machines[0].folders[0].path');
    expect(html).toContain('Start the list again');
    expect(html).not.toContain('data-testid="folder-add-path"');
  });

  it('disables every control while the file cannot be written', () => {
    fake.set([machine('a', [{ path: '/dnc/a' }])]);
    const html = render(MachineFolders, { props: { machineId: 'a', disabled: true } }).body;
    expect(html.match(/<button[^>]*data-testid="folder-action"[^>]*>/g)!.every((b) => b.includes('disabled'))).toBe(true);
  });
});
