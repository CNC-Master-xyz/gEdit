// Which machine a program uses by the folder its file is in (P4.30a; plan 6.8.4, rules R4 and
// R6). The service is built over fakes (AD-2) with the real profiles and code databases, like
// `machines.test.ts`; the order under test is: the document's own choice, the folder, the
// profile's default, none.

import { describe, expect, it } from 'vitest';
import { profiles } from './profiles';
import { codes } from './codes';
import { createMachineService } from './machines';
import type { ConfigLoad } from '$lib/platform/commands';
import type { DocId, MachineService } from '$lib/app/types';
import type { EffectiveMachine } from '$lib/core/machines/types';

const PATHS: ConfigLoad['paths'] = {
  configDir: '/cfg',
  dataDir: '/data',
  settingsFile: '/cfg/settings.json',
  stateFile: '/data/state.json',
  userScriptsDir: '/cfg/scripts',
  machinesFile: '/cfg/machines.json',
  profilesDir: '/cfg/profiles',
  codesDir: '/cfg/codes',
};

interface FakeDoc {
  id: DocId;
  profileId: string;
  machineId?: string | null;
  path?: string | null;
}

const FILE = {
  $version: 1,
  machines: [
    { id: 'lathe-a', name: 'Lathe A', profile: 'fanuc-lathe', params: {}, folders: [{ path: 'D:\\DNC\\LatheA' }] },
    { id: 'lathe-b', name: 'Lathe B', profile: 'fanuc-lathe', params: {}, folders: [{ path: '/dnc/b' }, { path: '/dnc/shared' }] },
    { id: 'lathe-c', name: 'Lathe C', profile: 'fanuc-lathe', params: {}, folders: [{ path: '/dnc/shared' }, { path: '/dnc/c/top', subfolders: false }] },
    { id: 'mill-1', name: 'Mill 1', profile: 'fanuc-gcode', params: {}, folders: [{ path: '/dnc/mill' }] },
    { id: 'okuma-1', name: 'Okuma 1', profile: 'okuma-osp', params: {}, folders: [{ path: '/dnc/okuma' }] },
    { id: 'broken', name: 'Broken', profile: 'fanuc-lathe', params: { units: 'furlong' }, folders: [{ path: '/dnc/broken' }] },
    { id: 'default-lathe', name: 'Default lathe', profile: 'fanuc-lathe', params: {} },
  ],
  defaults: { 'fanuc-lathe': 'default-lathe' },
};

function harness(docs: FakeDoc[], over: { file?: Record<string, unknown>; caseInsensitive?: boolean } = {}) {
  const list = new Map<DocId, FakeDoc>(docs.map((doc) => [doc.id, { ...doc }]));
  const notes: string[] = [];
  const saved: Record<string, unknown>[] = [];
  let disk: Record<string, unknown> = over.file ?? FILE;
  const load = (): ConfigLoad => ({
    settings: {},
    settingsError: null,
    ui: {},
    stateError: null,
    machines: disk,
    machinesError: null,
    paths: PATHS,
  });
  const machines: MachineService = createMachineService({
    docs: {
      get: (id) => list.get(id),
      byPath: (path) => [...list.values()].find((doc) => doc.path === path),
      all: () => [...list.values()],
      update: (id, patch) => {
        const doc = list.get(id);
        if (doc && patch.machineId !== undefined) doc.machineId = patch.machineId;
      },
    },
    remember: () => {},
    profiles: {
      defaultId: () => profiles.defaultId(),
      get: (id) => profiles.get(id),
      profile: (id) => profiles.profile(id),
      effective: (id, eff) => profiles.effective(id, eff),
      detectVariants: () => ({}),
    },
    codeDb: (dialect) => codes.byId(dialect),
    text: () => '',
    version: () => 0,
    save: async (file) => {
      saved.push(file);
      disk = { $version: 1, ...file };
    },
    replace: async () => null,
    reload: async () => load(),
    openFile: async () => PATHS.machinesFile,
    open: async () => [],
    notify: (text) => void notes.push(text),
    isTauri: () => true,
    caseInsensitivePaths: over.caseInsensitive ?? false,
  });
  machines.load(load());
  return {
    machines,
    notes,
    saved,
    setPath(id: DocId, path: string | null) {
      const doc = list.get(id);
      if (doc) doc.path = path;
    },
    async settle() {
      await Promise.resolve();
    },
  };
}

const eff = (h: ReturnType<typeof harness>, id: DocId): EffectiveMachine => h.machines.effective(id).machine;
const LATHE = (path: string | null, over: Partial<FakeDoc> = {}): FakeDoc => ({ id: 'd1', profileId: 'fanuc-lathe', path, ...over });

describe('R4: the order is own choice, folder, default, none', () => {
  it('a program in a machine s folder uses that machine, choice "folder"', () => {
    const h = harness([LATHE('/dnc/b/part.nc')]);
    expect(eff(h, 'd1')).toMatchObject({ id: 'lathe-b', name: 'Lathe B', choice: 'folder' });
  });

  it('the folder beats the profile default', () => {
    const h = harness([LATHE('/dnc/b/part.nc')]);
    expect(eff(h, 'd1').id).not.toBe('default-lathe');
    const outside = harness([LATHE('/elsewhere/part.nc')]);
    expect(eff(outside, 'd1')).toMatchObject({ id: 'default-lathe', choice: 'default' });
  });

  it('the document s own choice beats the folder, an explicit none included', () => {
    const h = harness([LATHE('/dnc/b/part.nc')]);
    h.machines.setForDoc('d1', 'lathe-c');
    expect(eff(h, 'd1')).toMatchObject({ id: 'lathe-c', choice: 'document' });
    h.machines.setForDoc('d1', null);
    expect(eff(h, 'd1')).toMatchObject({ id: null, choice: 'document' });
    h.machines.setForDoc('d1', undefined); // follow the rule again
    expect(eff(h, 'd1')).toMatchObject({ id: 'lathe-b', choice: 'folder' });
  });

  it('a program without a file path is never ruled by a folder', () => {
    const h = harness([LATHE(null), { id: 'd2', profileId: 'fanuc-lathe' }]);
    expect(eff(h, 'd1').choice).toBe('default');
    expect(eff(h, 'd2').choice).toBe('default');
  });

  it('the effective profile follows the folder machine', () => {
    const h = harness([LATHE('D:\\DNC\\LatheA\\part.nc')], { caseInsensitive: true });
    expect(eff(h, 'd1')).toMatchObject({ id: 'lathe-a', choice: 'folder' });
    expect(h.machines.effective('d1').machine.id).toBe('lathe-a');
  });

  it('Save As into another folder changes the machine at once (the cached view is not reused)', () => {
    const h = harness([LATHE('/dnc/b/part.nc')]);
    expect(eff(h, 'd1').id).toBe('lathe-b');
    h.setPath('d1', '/dnc/c/top/part.nc');
    expect(eff(h, 'd1')).toMatchObject({ id: 'lathe-c', choice: 'folder' });
    h.setPath('d1', '/somewhere/part.nc');
    expect(eff(h, 'd1').choice).toBe('default');
  });

  it('the longest folder wins, and subfolders: false is respected', () => {
    const h = harness([LATHE('/dnc/c/top/part.nc'), LATHE('/dnc/c/top/deeper/part.nc', { id: 'd2' })]);
    expect(eff(h, 'd1').id).toBe('lathe-c');
    expect(eff(h, 'd2').choice).toBe('default'); // /dnc/c/top holds only its own files
  });

  it('case follows the platform', () => {
    expect(eff(harness([LATHE('D:\\dnc\\lathea\\p.nc')], { caseInsensitive: true }), 'd1').choice).toBe('folder');
    expect(eff(harness([LATHE('/DNC/B/p.nc')], { caseInsensitive: false }), 'd1').choice).toBe('default');
    expect(eff(harness([LATHE('/DNC/B/p.nc')], { caseInsensitive: true }), 'd1').choice).toBe('folder');
  });
});

describe('R3: two machines on one folder choose nothing', () => {
  it('falls through to the default, as if there were no rule', () => {
    const h = harness([LATHE('/dnc/shared/part.nc')]);
    expect(eff(h, 'd1')).toMatchObject({ id: 'default-lathe', choice: 'default' });
  });
});

describe('R4: a folder machine that cannot be applied is told once', () => {
  it('a machine of another dialect family is not applied, with the existing wording', async () => {
    const h = harness([LATHE('/dnc/okuma/part.nc')]);
    expect(eff(h, 'd1')).toMatchObject({ id: 'default-lathe', choice: 'default' });
    expect(eff(h, 'd1').choice).toBe('default');
    await h.settle();
    expect(h.notes).toEqual(['Machine "Okuma 1" is not for this profile; the defaults are assumed']);
  });

  it('a machine the file does not describe usably is not applied', async () => {
    const h = harness([LATHE('/dnc/broken/part.nc')]);
    expect(eff(h, 'd1')).toMatchObject({ id: 'default-lathe', choice: 'default' });
    await h.settle();
    expect(h.notes).toHaveLength(1);
    expect(h.notes[0]).toContain('"Broken"');
    expect(h.notes[0]).toContain('cannot be used');
  });

  it('a mill machine in the folder of a lathe program is the family rule of the picker: applied', () => {
    const h = harness([LATHE('/dnc/mill/part.nc')]);
    expect(eff(h, 'd1')).toMatchObject({ id: 'mill-1', choice: 'folder' });
  });

  it('a chosen machine that went away falls through to the folder, with its own message', async () => {
    const h = harness([LATHE('/dnc/b/part.nc', { machineId: 'vanished' })]);
    expect(eff(h, 'd1')).toMatchObject({ id: 'lathe-b', choice: 'folder' });
    await h.settle();
    expect(h.notes).toEqual(['The machine of this document is no longer available; the defaults are assumed']);
  });
});

describe('editing the folders of a machine', () => {
  it('a new folder takes effect for the open documents at once', async () => {
    const h = harness([LATHE('/new/place/part.nc')]);
    expect(eff(h, 'd1').choice).toBe('default');
    await h.machines.update('lathe-a', { folders: [{ path: 'D:\\DNC\\LatheA' }, { path: '/new/place' }] });
    expect(eff(h, 'd1')).toMatchObject({ id: 'lathe-a', choice: 'folder' });
    expect((h.saved.at(-1)?.machines as { id: string; folders?: unknown }[]).find((m) => m.id === 'lathe-a')?.folders).toEqual([
      { path: 'D:\\DNC\\LatheA' },
      { path: '/new/place' },
    ]);
  });

  it('removing a machine takes its folders with it', async () => {
    const h = harness([LATHE('/dnc/b/part.nc')]);
    await h.machines.remove('lathe-b');
    expect(eff(h, 'd1').choice).toBe('default');
  });

  it('an edit of the name keeps the folders (the member rides through the form s patch)', async () => {
    const h = harness([LATHE('/dnc/b/part.nc')]);
    await h.machines.update('lathe-b', { name: 'Lathe B2', notes: 'hall 2' });
    expect(eff(h, 'd1')).toMatchObject({ id: 'lathe-b', choice: 'folder' });
  });

  it('a broken list gives no folders; the machine is still chosen by hand', () => {
    const file = { ...FILE, machines: [{ id: 'm', name: 'M', profile: 'fanuc-lathe', params: {}, folders: [{ path: 'relative' }] }], defaults: {} };
    const h = harness([LATHE('/relative/part.nc')], { file });
    expect(eff(h, 'd1').choice).toBe('none');
    h.machines.setForDoc('d1', 'm');
    expect(eff(h, 'd1')).toMatchObject({ id: 'm', choice: 'document' });
  });
});
