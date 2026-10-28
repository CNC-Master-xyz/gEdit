// Settings ▸ Keyboard (Phase 4 plan §6.9 rules 1–6, §6.9 rule 46 test ids). `keyboardRows` is pure;
// the markup is rendered with `svelte/server` (no DOM) over a fake service, so the rows, the marks,
// the conflict texts and the ids the harness looks for are covered here. Pressing a key and the
// buttons are the runtime scenario's (`p4-settings`).

import { render } from 'svelte/server';
import { writable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandDef } from '$lib/app/types';
import type { UserBindings } from '$lib/core/keys/userKeys';

const fake = vi.hoisted(() => ({
  bindings: {} as Record<string, unknown>,
  readOnly: false,
  error: null as string | null,
  problems: [] as { path: string; reason: string; message: string }[],
}));

vi.mock('$lib/app/dialogs', () => ({ dialogs: { confirm: async () => true } }));
vi.mock('$lib/app/status', () => ({ status: { show: () => {} } }));
vi.mock('$lib/app/keys/userKeys', async () => {
  const { derived } = await import('svelte/store');
  const core = await import('$lib/core/keys/userKeys');
  const { commands } = await import('$lib/app/registry/commands');
  const state = writable({ bindings: {}, problems: [], readOnly: false, error: null, loaded: true });
  return {
    userKeys: {
      platform: 'other',
      state: derived(state, (s) => ({
        ...s,
        bindings: fake.bindings,
        problems: fake.problems,
        readOnly: fake.readOnly,
        error: fake.error,
      })),
      analyse: (bindings: UserBindings = fake.bindings as UserBindings) => {
        const defs = commands.list().map((d) => ({ ...d, keys: commands.defaultKeys(d.id) }));
        return { mac: core.mergeKeys(defs, bindings, 'mac'), other: core.mergeKeys(defs, bindings, 'other') };
      },
      setKey: async () => true,
      reset: async () => true,
      resetAll: async () => true,
    },
  };
});

const { commands, resetCommandsForTest } = await import('$lib/app/registry/commands');
const KeyboardPage = (await import('./KeyboardPage.svelte')).default;
const { keyboardRows, labelOf } = await import('./KeyboardPage.svelte');
const { mergeKeys } = await import('$lib/core/keys/userKeys');

function def(over: Partial<CommandDef> & { id: string }): CommandDef {
  return { title: `t.${over.id}`, run: () => {}, ...over };
}

const page = (): string => render(KeyboardPage).body;

beforeEach(() => {
  resetCommandsForTest();
  fake.bindings = {};
  fake.readOnly = false;
  fake.error = null;
  fake.problems = [];
});

afterEach(() => resetCommandsForTest());

describe('keyboardRows', () => {
  const defs = [def({ id: 'b.two', category: 'z.cat', keys: 'Mod+K' }), def({ id: 'a.one', category: 'a.cat' }), def({ id: 'loose' })];
  const declared = (id: string) => (id === 'b.two' ? 'Mod+K' : undefined);
  const rowsFor = (bindings: UserBindings) =>
    keyboardRows(defs.map((d) => ({ ...d, keys: declared(d.id) })), bindings, mergeKeys(defs.map((d) => ({ ...d, keys: declared(d.id) })), bindings, 'other'), declared);

  it('lists every command, by category key and id, the uncategorized last', () => {
    expect(rowsFor({}).map((r) => r.id)).toEqual(['a.one', 'b.two', 'loose']);
  });

  it('marks a default key as default and a bound one as changed, with the built-in key beside it', () => {
    const rows = rowsFor({ 'a.one': 'Mod+J', 'b.two': null });
    const one = rows.find((r) => r.id === 'a.one');
    const two = rows.find((r) => r.id === 'b.two');
    expect(one).toMatchObject({ source: 'user', changed: true, keyNow: 'Mod+J', unused: false, conflict: 'none' });
    expect(two).toMatchObject({ source: 'user', changed: true, keyDefault: 'Mod+K' });
    expect(two?.keyNow).toBeUndefined();
    expect(rows.find((r) => r.id === 'loose')).toMatchObject({ source: 'default', changed: false });
  });

  it('a member for the other platform does not change this one', () => {
    const rows = rowsFor({ 'a.one': { mac: 'Mod+J' } });
    expect(rows.find((r) => r.id === 'a.one')).toMatchObject({ source: 'default', changed: false });
    expect(rows.find((r) => r.id === 'a.one')?.keyNow).toBeUndefined();
  });

  it('shows who won and who lost a key', () => {
    const rows = rowsFor({ 'a.one': 'Mod+K' });
    expect(rows.find((r) => r.id === 'a.one')).toMatchObject({ conflict: 'user-over-default', role: 'winner', with: ['b.two'] });
    expect(rows.find((r) => r.id === 'b.two')).toMatchObject({ conflict: 'user-over-default', role: 'lost', with: ['a.one'] });
    expect(rows.find((r) => r.id === 'b.two')?.keyNow).toBeUndefined();
  });

  it('shows two user keys on one key as on hold', () => {
    const rows = rowsFor({ 'a.one': 'Mod+Shift+J', loose: 'Ctrl+Shift+J' });
    expect(rows.find((r) => r.id === 'a.one')).toMatchObject({ conflict: 'user-user', role: 'hold' });
    expect(rows.find((r) => r.id === 'loose')).toMatchObject({ conflict: 'user-user', role: 'hold' });
  });

  it('lists the entries of commands that are not registered, last, as not available', () => {
    const rows = rowsFor({ 'script.run:user:gone.py': 'Mod+Shift+F9' });
    expect(rows.at(-1)).toMatchObject({ id: 'script.run:user:gone.py', unused: true, changed: true, keyNow: 'Mod+Shift+F9' });
  });

  it('flags a key that may type a character', () => {
    expect(rowsFor({ 'a.one': 'Mod+Alt+S' }).find((r) => r.id === 'a.one')?.notice).toBe('altGr');
    expect(rowsFor({ 'a.one': 'Mod+S' }).find((r) => r.id === 'a.one')?.notice).toBeNull();
  });

  it('labelOf writes the key for the platform', () => {
    expect(labelOf('Mod+Shift+K', 'mac')).toBe('⇧⌘K');
    expect(labelOf('Mod+Shift+K', 'other')).toBe('Ctrl+Shift+K');
    expect(labelOf(undefined, 'mac')).toBeUndefined();
  });
});

describe('KeyboardPage markup', () => {
  it('keeps the root test id and lists the commands with the ids of §6.9 rule 46', () => {
    commands.register([def({ id: 'file.save', category: 'files.category', keys: 'Mod+S' }), def({ id: 'misc' })]);
    const html = page();
    expect(html).toContain('data-testid="settings-keyboard"');
    expect(html).toContain('data-testid="keyboard-search"');
    expect(html.match(/data-testid="keyboard-row"/g)).toHaveLength(2);
    expect(html).toMatch(/data-command="file\.save"[^>]*data-source="default"[^>]*data-conflict="none"/);
    expect(html).toContain('Ctrl+S');
    expect(html.match(/data-testid="keyboard-capture"/g)).toHaveLength(2);
    expect(html).toContain('data-testid="keyboard-reset-all"');
    expect(html).not.toContain('data-testid="keyboard-conflicts"');
  });

  it('marks a changed key with source "user", the changed mark and the built-in key', () => {
    commands.register([def({ id: 'file.save', keys: 'Mod+S' })]);
    fake.bindings = { 'file.save': { other: 'Mod+Shift+S' } };
    const html = page();
    expect(html).toMatch(/data-command="file\.save"[^>]*data-source="user"/);
    expect(html).toContain('data-testid="keyboard-mark-changed"');
    expect(html).toContain('Ctrl+Shift+S');
    expect(html).toContain('data-testid="keyboard-default"');
  });

  it('shows a conflict in the list on top and on both rows, in plain words', () => {
    commands.register([def({ id: 'file.save', title: 'Save file', keys: 'Mod+S' }), def({ id: 'misc', title: 'Misc' })]);
    fake.bindings = { misc: { other: 'Mod+S' } };
    const html = page();
    expect(html).toContain('data-testid="keyboard-conflicts"');
    expect(html).toMatch(/data-testid="keyboard-conflict" data-platform="other" data-kind="user-over-default"/);
    expect(html).toContain('Ctrl+S (Windows and Linux): Misc has it now. Save file lost it.');
    expect(html).toMatch(/data-command="file\.save"[^>]*data-conflict="user-over-default"/);
    expect(html).toContain('data-testid="keyboard-lost"');
    expect(html).toContain('Lost its key to Misc.');
  });

  it('says what two user keys on one key mean', () => {
    commands.register([def({ id: 'a', title: 'Alpha' }), def({ id: 'b', title: 'Beta' })]);
    fake.bindings = { a: 'Mod+K', b: 'Ctrl+K' };
    const html = page();
    expect(html).toMatch(/data-kind="user-user"/);
    expect(html).toContain('None of them has it until you change one.');
    expect(html).toContain('data-testid="keyboard-hold"');
  });

  it('shows the AltGr notice beside a Ctrl+Alt key', () => {
    commands.register([def({ id: 'a' })]);
    fake.bindings = { a: { other: 'Mod+Alt+S' } };
    const html = page();
    expect(html).toContain('data-testid="keyboard-notice"');
    expect(html).toContain('AltGr');
  });

  it('lists an entry whose command is gone as not available, without a capture button', () => {
    fake.bindings = { 'script.run:user:gone.py': 'Mod+Shift+F9' };
    const html = page();
    expect(html).toContain('data-testid="keyboard-mark-unused"');
    expect(html).toContain('data-command="script.run:user:gone.py"');
    expect(html).not.toContain('data-testid="keyboard-capture"');
    expect(html).toContain('data-testid="keyboard-reset"');
  });

  it('says so when the file is from a newer gEdit and switches the buttons off', () => {
    commands.register([def({ id: 'a' })]);
    fake.readOnly = true;
    const html = page();
    expect(html).toContain('data-testid="keyboard-readonly"');
    expect(html).toMatch(/data-testid="keyboard-capture"[^>]*disabled/);
  });

  it('lists what was ignored in the file', () => {
    fake.problems = [{ path: 'bindings.x', reason: 'noModifier', message: '"K" has no Ctrl, Cmd or Alt and is not a function key.' }];
    const html = page();
    expect(html).toContain('data-testid="keyboard-problems"');
    expect(html).toContain('bindings.x');
  });
});
