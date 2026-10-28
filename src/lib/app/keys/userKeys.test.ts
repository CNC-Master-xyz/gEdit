// The service that puts `keybindings.json` into force (Phase 4 plan §6.9 rules 1–5): the file is
// read once, a bad entry costs the entry, a newer or broken file is a notice and no overrides, and
// every edit is written first and applied only when the write worked.

import { get } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import { createUserKeys, type UserKeysDeps } from './userKeys';
import type { KeybindingsLoad } from '$lib/platform/commands';
import type { CommandDef } from '$lib/app/types';
import type { UserBindings } from '$lib/core/keys/userKeys';

const def = (id: string, keys?: CommandDef['keys']): CommandDef => ({ id, title: id, keys, run: () => {} });

function setup(file: Partial<KeybindingsLoad> = {}, over: Partial<UserKeysDeps> = {}) {
  const applied: UserBindings[] = [];
  const saved: Record<string, unknown>[] = [];
  const shown: { text: string; error: boolean; detail?: string }[] = [];
  const deps: UserKeysDeps = {
    load: async () => ({ keybindings: {}, error: null, readOnly: false, ...file }),
    save: async (f) => {
      saved.push(f);
    },
    declared: () => [def('file.save', 'Mod+S'), def('misc'), def('other', { mac: 'Mod+O', other: 'Ctrl+O' })],
    apply: (b) => applied.push(b),
    show: (text, o) => shown.push({ text, error: o?.error === true, ...(o?.detail === undefined ? {} : { detail: o.detail }) }),
    isMac: false,
    available: true,
    ...over,
  };
  return { service: createUserKeys(deps), applied, saved, shown };
}

describe('load', () => {
  it('a missing file is no overrides and no message', async () => {
    const { service, applied, shown } = setup();
    await service.load();
    expect(applied).toEqual([{}]);
    expect(shown).toEqual([]);
    expect(get(service.state)).toMatchObject({ bindings: {}, loaded: true, readOnly: false, error: null });
  });

  it('puts the bindings of the file into force and keeps the problems', async () => {
    const { service, applied, shown } = setup({
      keybindings: { $version: 1, bindings: { misc: 'Mod+K', file: 'K', 'script.run:gone': 'Mod+J' } },
    });
    await service.load();
    expect(applied).toEqual([{ misc: 'Mod+K', 'script.run:gone': 'Mod+J' }]);
    expect(get(service.state).problems.map((p) => p.path)).toEqual(['bindings.file']);
    expect(shown).toHaveLength(1);
    expect(shown[0].text).toBe('1 entry in the key file was ignored. It stays in the file unless you change that command.');
    expect(shown[0].detail).toContain('bindings.file');
  });

  it('a file from a newer gEdit is read, applied and not written', async () => {
    const { service, applied, saved, shown } = setup({ keybindings: { bindings: { misc: 'Mod+K' } }, readOnly: true });
    await service.load();
    expect(applied).toEqual([{ misc: 'Mod+K' }]);
    expect(shown[0].text).toContain('newer gEdit');
    await expect(service.setKey('misc', 'Mod+J')).resolves.toBe(false);
    expect(saved).toEqual([]);
    expect(applied).toHaveLength(1);
  });

  it('a file that could not be used is an error notice and the default keys', async () => {
    const { service, applied, shown } = setup({ error: 'keybindings.json: not valid JSON' });
    await service.load();
    expect(applied).toEqual([{}]);
    expect(shown).toEqual([{ text: 'The key file could not be used. The built-in keys are in force.', error: true, detail: 'keybindings.json: not valid JSON' }]);
  });

  it('never throws when the read itself fails', async () => {
    const { service, applied, shown } = setup({}, { load: async () => Promise.reject(new Error('no ipc')) });
    await expect(service.load()).resolves.toBeUndefined();
    expect(applied).toEqual([{}]);
    expect(shown[0]).toMatchObject({ error: true, detail: 'no ipc' });
  });

  it('reads nothing outside the app', async () => {
    const load = vi.fn();
    const { service, applied } = setup({}, { available: false, load });
    await service.load();
    expect(load).not.toHaveBeenCalled();
    expect(applied).toEqual([]);
    expect(get(service.state).loaded).toBe(true);
  });
});

describe('edits', () => {
  it('writes the file first and applies the bindings after', async () => {
    const order: string[] = [];
    const { service } = setup({}, {
      save: async () => {
        order.push('save');
      },
      apply: () => order.push('apply'),
    });
    await service.load();
    order.length = 0;
    await expect(service.setKey('misc', 'Mod+K')).resolves.toBe(true);
    expect(order).toEqual(['save', 'apply']);
  });

  it('changes the running platform only and keeps the other platform as the file had it', async () => {
    const { service, saved, applied } = setup({ keybindings: { bindings: { misc: { mac: 'Mod+J' } } } });
    await service.load();
    await service.setKey('misc', 'Mod+K');
    expect(saved.at(-1)).toEqual({ bindings: { misc: { mac: 'Mod+J', other: 'Mod+K' } } });
    expect(applied.at(-1)).toEqual({ misc: { mac: 'Mod+J', other: 'Mod+K' } });
  });

  it('null removes the key, reset puts the default back', async () => {
    const { service, saved } = setup();
    await service.load();
    await service.setKey('file.save', null);
    expect(saved.at(-1)).toEqual({ bindings: { 'file.save': { other: null } } });
    await service.reset('file.save');
    expect(saved.at(-1)).toEqual({ bindings: {} });
  });

  it('a write that fails changes nothing and says so', async () => {
    const { service, applied, shown } = setup({}, { save: async () => Promise.reject(new Error('disk full')) });
    await service.load();
    applied.length = 0;
    await expect(service.setKey('misc', 'Mod+K')).resolves.toBe(false);
    expect(applied).toEqual([]);
    expect(get(service.state).bindings).toEqual({});
    expect(shown.at(-1)).toMatchObject({ text: 'The keys could not be saved.', error: true, detail: 'disk full' });
  });

  it('resetAll removes the keys of this platform and leaves the other platform’s', async () => {
    const { service, saved } = setup({
      keybindings: { bindings: { a: 'Mod+K', b: { mac: 'Mod+J' }, c: { other: 'Mod+L' }, d: null } },
    });
    await service.load();
    await service.resetAll();
    // `a` and `d` applied to both platforms, so the mac half stays; `b` is mac only; `c` was this platform's.
    expect(saved.at(-1)).toEqual({ bindings: { a: { mac: 'Mod+K' }, b: { mac: 'Mod+J' }, d: { mac: null } } });
  });

  it('saves with a conflict and says so', async () => {
    const { service, saved, shown } = setup();
    await service.load();
    await expect(service.setKey('misc', 'Mod+S')).resolves.toBe(true);
    expect(saved).toHaveLength(1);
    expect(shown.at(-1)?.text).toMatch(/^Saved\. 1 key is used twice/);
  });

  it('a clean save is quiet', async () => {
    const { service, shown } = setup();
    await service.load();
    await service.setKey('misc', 'Mod+Shift+K');
    expect(shown).toEqual([]);
  });
});

describe('analyse', () => {
  it('gives the keys in force on both platforms over the declared keys', async () => {
    const { service } = setup({ keybindings: { bindings: { misc: 'Mod+S' } } });
    await service.load();
    const both = service.analyse();
    expect(both.other.keys.get('misc')).toBe('Mod+S');
    expect(both.other.keys.has('file.save')).toBe(false);
    expect(both.mac.conflicts).toHaveLength(1);
    expect(both.other.conflicts).toHaveLength(1);
  });

  it('works out a binding that is not saved yet', async () => {
    const { service } = setup();
    await service.load();
    expect(service.analyse({ misc: 'Mod+S' }).other.conflicts).toHaveLength(1);
    expect(service.analyse().other.conflicts).toHaveLength(0);
  });
});

// CODE-5 (P4g review): the second edit was built from the bindings of before the first one was saved.
describe('two edits inside one save', () => {
  it('keeps both, with a save that resolves late', async () => {
    const releases: (() => void)[] = [];
    const { service, saved, applied } = setup({}, {
      save: (f) =>
        new Promise<void>((resolve) => {
          releases.push(() => {
            saved.push(f);
            resolve();
          });
        }),
    });
    await service.load();
    const first = service.setKey('misc', 'Mod+K');
    const second = service.setKey('other', 'Mod+J');
    // The second edit waits for the first; the file is written once per edit, in order.
    await Promise.resolve();
    expect(releases).toHaveLength(1);
    releases[0]();
    await first;
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[1]();
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(saved.at(-1)).toEqual({ bindings: { misc: { other: 'Mod+K' }, other: { other: 'Mod+J' } } });
    expect(get(service.state).bindings).toEqual({ misc: { other: 'Mod+K' }, other: { other: 'Mod+J' } });
    expect(applied.at(-1)).toEqual(get(service.state).bindings);
  });

  it('a reset after a set sees the set', async () => {
    const { service, saved } = setup();
    await service.load();
    const results = await Promise.all([service.setKey('misc', 'Mod+K'), service.setKey('other', 'Mod+J'), service.reset('misc')]);
    expect(results).toEqual([true, true, true]);
    expect(saved.at(-1)).toEqual({ bindings: { other: { other: 'Mod+J' } } });
  });

  it('a failed save does not stop the edits queued behind it', async () => {
    let calls = 0;
    const { service, saved } = setup({}, {
      save: async (f) => {
        calls += 1;
        if (calls === 1) throw new Error('disk full');
        saved.push(f);
      },
    });
    await service.load();
    const results = await Promise.all([service.setKey('misc', 'Mod+K'), service.setKey('other', 'Mod+J')]);
    expect(results).toEqual([false, true]);
    expect(saved.at(-1)).toEqual({ bindings: { other: { other: 'Mod+J' } } });
  });
});

// CODE-6 (P4g review): the first edit of any command deleted every entry the reader had dropped.
describe('entries the reader dropped', () => {
  const file = { keybindings: { bindings: { misc: 'Mod+K', typo: 'Mod+Shft+K', half: { mac: 'Mod+Shft+J', other: 'Mod+J' } } } };

  it('stay in the file when another command is edited', async () => {
    const { service, saved } = setup(file);
    await service.load();
    await service.setKey('other', 'Mod+L');
    expect(saved.at(-1)).toEqual({
      bindings: { misc: 'Mod+K', half: { mac: 'Mod+Shft+J', other: 'Mod+J' }, other: { other: 'Mod+L' }, typo: 'Mod+Shft+K' },
    });
    // The running registry gets only what is valid.
    expect(get(service.state).bindings).toEqual({ misc: 'Mod+K', half: { other: 'Mod+J' }, other: { other: 'Mod+L' } });
  });

  it('go for good once the user changes that command', async () => {
    const { service, saved } = setup(file);
    await service.load();
    await service.setKey('half', 'Mod+H');
    expect((saved.at(-1)?.bindings as Record<string, unknown>).half).toEqual({ other: 'Mod+H' });
    await service.reset('half');
    expect(get(service.state).bindings).toEqual({ misc: 'Mod+K' });
    const bindings = saved.at(-1)?.bindings as Record<string, unknown>;
    expect(bindings).not.toHaveProperty('half');
    expect(bindings.typo).toBe('Mod+Shft+K');
  });

  it('"reset all" removes the keys the user set but keeps an entry nothing of which could be read', async () => {
    const { service, saved } = setup(file);
    await service.load();
    await service.resetAll();
    // `misc` was bound on both systems: this one's key goes, the other system's stays.
    expect(saved.at(-1)).toEqual({ bindings: { misc: { mac: 'Mod+K' }, typo: 'Mod+Shft+K' } });
  });
});
