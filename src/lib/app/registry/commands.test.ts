// The command registry (plan §5 WP1.1 "Tests": a duplicate id throws, dispose works,
// enablement gates `run` (a disabled run returns false and shows a status message), and a
// conflict logs an error).
//
// `app/status` is mocked, because the real one is a no-op until WP1.5 (the P1 hand-off
// says to assert on an injected fake or `vi.mock`, never on that module).

import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const show = vi.fn();
vi.mock('$lib/app/status', () => ({
  status: { current: { subscribe: () => () => {} }, show: (...a: unknown[]) => show(...a), clear: () => {} },
}));

const { commands, notifyContextChanged, resetCommandsForTest, setContextProvider } = await import(
  './commands'
);
import type { CommandContext, CommandDef } from '$lib/app/types';

function command(over: Partial<CommandDef> & { id: string }): CommandDef {
  return { title: `t.${over.id}`, run: () => {}, ...over };
}

function context(over: Partial<CommandContext> = {}): CommandContext {
  return {
    activeDocId: null,
    profileId: null,
    hasSelection: false,
    editorFocused: false,
    compareOpen: false,
    modalOpen: false,
    scriptRunning: false,
    ...over,
  };
}

let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetCommandsForTest();
  show.mockClear();
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errors.mockRestore();
  resetCommandsForTest();
});

describe('register', () => {
  it('stores single defs and batches, and reports them', () => {
    commands.register(command({ id: 'file.save' }));
    commands.register([command({ id: 'file.open' }), command({ id: 'file.new' })]);
    expect(commands.has('file.save')).toBe(true);
    expect(commands.get('file.open')?.title).toBe('t.file.open');
    expect(commands.list().map((d) => d.id)).toEqual(['file.save', 'file.open', 'file.new']);
    expect(commands.get('nope')).toBeUndefined();
    expect(commands.has('nope')).toBe(false);
  });

  it('throws on a duplicate id and registers nothing from that batch', () => {
    commands.register(command({ id: 'file.save' }));
    expect(() => commands.register(command({ id: 'file.save' }))).toThrow(/already registered/);
    expect(() =>
      commands.register([command({ id: 'file.open' }), command({ id: 'file.open' })]),
    ).toThrow(/already registered/);
    expect(commands.list().map((d) => d.id)).toEqual(['file.save']);
  });

  it('disposes exactly its own ids, and a second dispose is harmless', () => {
    const disposeA = commands.register([command({ id: 'a' }), command({ id: 'b' })]);
    commands.register(command({ id: 'c' }));
    disposeA();
    disposeA();
    expect(commands.list().map((d) => d.id)).toEqual(['c']);
  });

  it('bumps `changed` on register and on dispose', () => {
    const seen: number[] = [];
    const stop = commands.changed.subscribe((n) => seen.push(n));
    const dispose = commands.register(command({ id: 'a' }));
    dispose();
    stop();
    expect(seen.length).toBe(3);
    expect(seen[2]).toBeGreaterThan(seen[0]);
    notifyContextChanged();
    expect(get(commands.changed)).toBeGreaterThan(seen[2]);
  });

  it('logs a console error when two commands claim the same shortcut', () => {
    commands.register(command({ id: 'a.one', keys: 'Mod+K' }));
    expect(errors).not.toHaveBeenCalled();
    commands.register(command({ id: 'b.two', keys: 'Mod+K' }));
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0][0])).toContain('key conflict');
    expect(String(errors.mock.calls[0][0])).toContain('a.one');
    expect(String(errors.mock.calls[0][0])).toContain('b.two');
  });

  it('does not report the same conflict again on a later, unrelated registration', () => {
    commands.register([command({ id: 'a.one', keys: 'Mod+K' }), command({ id: 'b.two', keys: 'Mod+K' })]);
    errors.mockClear();
    commands.register(command({ id: 'c.three', keys: 'Mod+J' }));
    expect(errors).not.toHaveBeenCalled();
  });

  it('logs a console error for a malformed key spec', () => {
    commands.register(command({ id: 'a.bad', keys: 'Meta+S' }));
    expect(String(errors.mock.calls[0][0])).toContain('invalid key spec');
  });
});

describe('context', () => {
  it('reads through the installed provider', () => {
    expect(commands.context().activeDocId).toBeNull();
    setContextProvider(() => context({ activeDocId: 'd1', hasSelection: true }));
    expect(commands.context()).toEqual(context({ activeDocId: 'd1', hasSelection: true }));
  });

  it('falls back to the neutral context when the provider throws', () => {
    setContextProvider(() => {
      throw new Error('boom');
    });
    expect(commands.context().activeDocId).toBeNull();
    expect(errors).toHaveBeenCalled();
  });
});

describe('isEnabled and run', () => {
  it('is enabled by default and gated by `enabled`', () => {
    setContextProvider(() => context({ activeDocId: 'd1' }));
    commands.register([
      command({ id: 'always' }),
      command({ id: 'needsDoc', enabled: (c) => c.activeDocId !== null }),
      command({ id: 'needsSelection', enabled: (c) => c.hasSelection }),
    ]);
    expect(commands.isEnabled('always')).toBe(true);
    expect(commands.isEnabled('needsDoc')).toBe(true);
    expect(commands.isEnabled('needsSelection')).toBe(false);
    expect(commands.isEnabled('missing')).toBe(false);
  });

  it('runs a command with the context and the argument, and returns true', async () => {
    const run = vi.fn();
    setContextProvider(() => context({ activeDocId: 'd7' }));
    commands.register(command({ id: 'file.save', run }));
    await expect(commands.run('file.save', { silent: true })).resolves.toBe(true);
    expect(run).toHaveBeenCalledWith(context({ activeDocId: 'd7' }), { silent: true });
    expect(show).not.toHaveBeenCalled();
  });

  it('awaits an async command', async () => {
    let done = false;
    commands.register(
      command({
        id: 'slow',
        run: async () => {
          await Promise.resolve();
          done = true;
        },
      }),
    );
    await expect(commands.run('slow')).resolves.toBe(true);
    expect(done).toBe(true);
  });

  it('refuses a disabled command with a plain status message', async () => {
    const run = vi.fn();
    commands.register(command({ id: 'file.save', enabled: () => false, run }));
    await expect(commands.run('file.save')).resolves.toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0][1]).toBeUndefined();
  });

  it('refuses an unknown command with a status error', async () => {
    await expect(commands.run('nope')).resolves.toBe(false);
    expect(show).toHaveBeenCalledWith(expect.stringContaining('nope'), { error: true });
    expect(errors).toHaveBeenCalled();
  });

  it('turns a thrown error into a status error plus a console error', async () => {
    commands.register(
      command({
        id: 'boom',
        run: () => {
          throw new Error('disk on fire');
        },
      }),
    );
    await expect(commands.run('boom')).resolves.toBe(false);
    expect(show).toHaveBeenCalledWith(expect.any(String), {
      error: true,
      detail: 'disk on fire',
    });
    expect(errors).toHaveBeenCalled();
  });

  it('turns a rejected promise into the same failure', async () => {
    commands.register(command({ id: 'boom', run: () => Promise.reject(new Error('nope')) }));
    await expect(commands.run('boom')).resolves.toBe(false);
    expect(show).toHaveBeenCalledWith(expect.any(String), { error: true, detail: 'nope' });
  });
});

describe('the user’s keys (P4g, §6.9 rule 5)', () => {
  const save = () => command({ id: 'file.save', keys: 'Mod+S' });

  it('get and list answer with the keys in force; defaultKeys keeps the declared ones', () => {
    commands.register([save(), command({ id: 'file.open', keys: { mac: 'Mod+O', other: 'Ctrl+O' } }), command({ id: 'misc' })]);
    commands.setKeyOverrides({ misc: 'Mod+Shift+M', 'file.open': { other: 'Ctrl+Alt+O' } });
    expect(commands.get('misc')?.keys).toEqual('Mod+Shift+M');
    expect(commands.get('file.open')?.keys).toEqual({ mac: 'Mod+O', other: 'Ctrl+Alt+O' });
    expect(commands.list().map((d) => d.keys)).toEqual(['Mod+S', { mac: 'Mod+O', other: 'Ctrl+Alt+O' }, 'Mod+Shift+M']);
    expect(commands.defaultKeys('misc')).toBeUndefined();
    expect(commands.defaultKeys('file.open')).toEqual({ mac: 'Mod+O', other: 'Ctrl+O' });
    expect(commands.defaultKeys('nope')).toBeUndefined();
  });

  it('a command the user did not touch is handed out as it was registered', () => {
    const def = save();
    commands.register(def);
    commands.setKeyOverrides({ other: 'Mod+K' });
    expect(commands.get('file.save')).toBe(def);
  });

  it('the user’s key wins over a default and the displaced command shows none; nothing is logged', () => {
    commands.register([save(), command({ id: 'misc' })]);
    commands.setKeyOverrides({ misc: 'Mod+S' });
    expect(commands.get('misc')?.keys).toBe('Mod+S');
    expect(commands.get('file.save')?.keys).toBeUndefined();
    expect(errors).not.toHaveBeenCalled();
  });

  it('two user keys on one key leave neither of them active', () => {
    commands.register([command({ id: 'a' }), command({ id: 'b' })]);
    commands.setKeyOverrides({ a: 'Mod+K', b: 'mod+k' });
    expect(commands.get('a')?.keys).toBeUndefined();
    expect(commands.get('b')?.keys).toBeUndefined();
  });

  it('a script command registered later gets its key at register time, and loses it when it goes', () => {
    commands.setKeyOverrides({ 'script.run:user:a.py': 'Mod+Shift+F9' });
    const off = commands.register(command({ id: 'script.run:user:a.py' }));
    expect(commands.get('script.run:user:a.py')?.keys).toBe('Mod+Shift+F9');
    off();
    expect(commands.get('script.run:user:a.py')).toBeUndefined();
    commands.register(command({ id: 'script.run:user:a.py' }));
    expect(commands.get('script.run:user:a.py')?.keys).toBe('Mod+Shift+F9');
  });

  it('a later registration that takes a default key from a user key does not take it back', () => {
    commands.register(command({ id: 'a' }));
    commands.setKeyOverrides({ a: 'Mod+K' });
    commands.register(command({ id: 'late', keys: 'Mod+K' }));
    expect(commands.get('a')?.keys).toBe('Mod+K');
    expect(commands.get('late')?.keys).toBeUndefined();
  });

  it('an empty set puts the declared keys back and bumps changed', () => {
    commands.register([save(), command({ id: 'misc' })]);
    commands.setKeyOverrides({ misc: 'Mod+S' });
    let bumps = 0;
    const off = commands.changed.subscribe(() => (bumps += 1));
    bumps = 0;
    commands.setKeyOverrides({});
    off();
    expect(bumps).toBe(1);
    expect(commands.get('file.save')?.keys).toBe('Mod+S');
    expect(commands.get('misc')?.keys).toBeUndefined();
  });

  it('a duplicate default still logs a conflict (the console error stays for declared keys)', () => {
    commands.register(save());
    commands.register(command({ id: 'other', keys: 'Mod+S' }));
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('key conflict'));
  });

  it('run still works on a command whose key changed', async () => {
    const run = vi.fn();
    commands.register(command({ id: 'misc', run }));
    commands.setKeyOverrides({ misc: 'Mod+K' });
    await expect(commands.run('misc')).resolves.toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });
});
