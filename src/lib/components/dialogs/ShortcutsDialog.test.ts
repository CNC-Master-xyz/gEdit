// The shortcut table (plan §5 WP2.4). `shortcutRows` and `groupRows` are pure, so the
// ordering, the platform labels and the grouping are covered without a DOM. The markup is
// rendered with `svelte/server`, which needs no DOM either; filtering and the keyboard are
// covered by the M2 runtime scenarios.

import { render } from 'svelte/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ShortcutsDialog, { groupRows, shortcutRows, visibleRows, type ShortcutRow } from './ShortcutsDialog.svelte';
import { commands } from '$lib/app/registry/commands';
import type { CommandDef, Disposable } from '$lib/app/types';
import type { UserBindings } from '$lib/core/keys/userKeys';

// The user's entries as the dialog reads them (the service is mocked; the registry takes the keys).
const userState = vi.hoisted(() => ({ store: null as null | { set(v: unknown): void } }));
vi.mock('$lib/app/keys/userKeys', async () => {
  const { writable } = await import('svelte/store');
  const store = writable({ bindings: {} });
  userState.store = store;
  return { userKeys: { state: store, platform: 'other' } };
});
const setUserBindings = (bindings: UserBindings): void => userState.store?.set({ bindings });

function def(over: Partial<CommandDef> & { id: string }): CommandDef {
  return { title: `t.${over.id}`, run: () => {}, ...over };
}

function row(id: string, category?: string): ShortcutRow {
  return category === undefined ? { id, title: `t.${id}` } : { id, title: `t.${id}`, category };
}

describe('shortcutRows', () => {
  it('keeps the i18n keys and formats the shortcut for the platform', () => {
    const defs = [def({ id: 'file.save', title: 'files.save', category: 'files.category', keys: 'Mod+S' })];
    expect(shortcutRows(defs, true)).toEqual([
      { id: 'file.save', title: 'files.save', category: 'files.category', keys: '⌘S' },
    ]);
    expect(shortcutRows(defs, false)).toEqual([
      { id: 'file.save', title: 'files.save', category: 'files.category', keys: 'Ctrl+S' },
    ]);
  });

  it('takes the spec of this platform and leaves the other one out', () => {
    const defs = [def({ id: 'a', keys: { mac: 'Mod+Alt+S' } }), def({ id: 'b', keys: { other: 'Ctrl+Alt+S' } })];
    expect(shortcutRows(defs, true).map((r) => r.keys)).toEqual(['⌥⌘S', undefined]);
    expect(shortcutRows(defs, false).map((r) => r.keys)).toEqual([undefined, 'Ctrl+Alt+S']);
  });

  it('lists a command without a shortcut, and one whose spec does not parse', () => {
    const rows = shortcutRows([def({ id: 'a' }), def({ id: 'b', keys: 'Mod+Nonsense' })], false);
    expect(rows.map((r) => r.keys)).toEqual([undefined, undefined]);
  });

  it('sorts by category key and then by command id, with the uncategorized commands last', () => {
    const defs = [
      def({ id: 'view.b', category: 'view.category' }),
      def({ id: 'loose' }),
      def({ id: 'file.b', category: 'files.category' }),
      def({ id: 'file.a', category: 'files.category' }),
      def({ id: 'view.a', category: 'view.category' }),
    ];
    expect(shortcutRows(defs, false).map((r) => r.id)).toEqual([
      'file.a',
      'file.b',
      'view.a',
      'view.b',
      'loose',
    ]);
  });

  it('does not invent a category for a command without one', () => {
    const [first] = shortcutRows([def({ id: 'a' })], false);
    expect(Object.prototype.hasOwnProperty.call(first, 'category')).toBe(false);
  });

  it('leaves its input alone', () => {
    const defs = [def({ id: 'b' }), def({ id: 'a' })];
    shortcutRows(defs, false);
    expect(defs.map((d) => d.id)).toEqual(['b', 'a']);
  });
});

describe('shortcutRows with the declared keys (P4g, §6.9 rule 6)', () => {
  const declared = (keys: CommandDef['keys']) => () => keys;

  it('marks a row whose key differs from the declared one, with the built-in key', () => {
    const rows = shortcutRows([def({ id: 'a', keys: 'Mod+Shift+K' })], false, declared('Mod+K'));
    expect(rows).toEqual([{ id: 'a', title: 't.a', keys: 'Ctrl+Shift+K', changed: true, builtIn: 'Ctrl+K' }]);
  });

  it('marks a command that lost its key, and one that got a key it did not have', () => {
    const lost = shortcutRows([def({ id: 'a' })], false, declared('Mod+K'))[0];
    expect(lost).toMatchObject({ changed: true, builtIn: 'Ctrl+K' });
    expect(lost.keys).toBeUndefined();
    const gained = shortcutRows([def({ id: 'a', keys: 'Mod+K' })], false, declared(undefined))[0];
    expect(gained.changed).toBe(true);
    expect(gained.builtIn).toBeUndefined();
  });

  it('does not mark a row that has its declared key, or one that differs only on the other platform', () => {
    const same = shortcutRows([def({ id: 'a', keys: 'Mod+K' })], false, declared('Mod+K'));
    expect(same[0].changed).toBeUndefined();
    const otherPlatform = shortcutRows([def({ id: 'a', keys: { mac: 'Mod+J', other: 'Ctrl+K' } })], false, declared({ mac: 'Mod+K', other: 'Ctrl+K' }));
    expect(otherPlatform[0].changed).toBeUndefined();
  });

  // CODE-9 (P4g review): a default that lost its key to a user key on the same keys is not the user's entry.
  it('marks only commands the user has an entry for, when it is told which', () => {
    const userSet = (id: string) => id === 'mine';
    const rows = shortcutRows(
      [def({ id: 'displaced' }), def({ id: 'mine', keys: 'Mod+Shift+K' })],
      false,
      declared('Mod+K'),
      userSet,
    );
    expect(rows.find((r) => r.id === 'displaced')?.changed).toBeUndefined();
    expect(rows.find((r) => r.id === 'displaced')?.builtIn).toBeUndefined();
    expect(rows.find((r) => r.id === 'mine')).toMatchObject({ changed: true, builtIn: 'Ctrl+K' });
  });

  it('marks nothing when no declared keys are given', () => {
    expect(shortcutRows([def({ id: 'a', keys: 'Mod+K' })], false)[0].changed).toBeUndefined();
  });
});

describe('groupRows', () => {
  /** Two different category keys, one shared heading - exactly what the real catalog has. */
  const labelOf = (r: ShortcutRow): string => {
    if (!r.category) return 'Other';
    return r.category === 'core.categoryView' || r.category === 'view.category' ? 'View' : 'Files';
  };

  it('merges two category keys that carry the same label', () => {
    const groups = groupRows(
      [row('a', 'core.categoryView'), row('b', 'files.category'), row('c', 'view.category')],
      labelOf,
    );
    expect(groups.map((g) => g.label)).toEqual(['Files', 'View']);
    expect(groups[1].rows.map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('sorts the headings and keeps the row order inside a group', () => {
    const groups = groupRows([row('v1', 'view.category'), row('f1', 'files.category'), row('v2', 'view.category')], labelOf);
    expect(groups.map((g) => g.label)).toEqual(['Files', 'View']);
    expect(groups[1].rows.map((r) => r.id)).toEqual(['v1', 'v2']);
  });

  it('puts the group of the uncategorized commands last, whatever its heading is', () => {
    const groups = groupRows([row('z', 'files.category'), row('a')], (r) => (r.category ? 'Zulu' : 'Alpha'));
    expect(groups.map((g) => g.label)).toEqual(['Zulu', 'Alpha']);
  });

  it('returns nothing for no rows', () => {
    expect(groupRows([], () => 'x')).toEqual([]);
  });
});

describe('visibleRows (B1 A4)', () => {
  const rows: ShortcutRow[] = [
    { id: 'a', title: 't.a', keys: 'Ctrl+A' },
    { id: 'b', title: 't.b' },
  ];
  it('keeps only the commands with a key unless asked for all', () => {
    expect(visibleRows(rows, false).map((r) => r.id)).toEqual(['a']);
    expect(visibleRows(rows, true).map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('ShortcutsDialog markup', () => {
  let registered: Disposable | undefined;

  afterEach(() => {
    registered?.();
    registered = undefined;
    commands.setKeyOverrides({});
    setUserBindings({});
  });

  function markup(showUnbound = false): string {
    return render(ShortcutsDialog, { props: { close: () => {}, showUnbound } }).body;
  }

  it('is a modal the harness can find by name, with Close and no confirm button', () => {
    const html = markup();
    expect(html).toContain('data-modal="shortcuts"');
    expect(html).toContain('data-testid="modal-cancel"');
    expect(html).not.toContain('data-testid="modal-ok"');
    expect(html).toContain('data-testid="shortcuts-filter"');
  });

  it('shows the commands that have a key, with their heading and their keys', () => {
    registered = commands.register([
      def({ id: 'help.about', title: 'help.about', category: 'help.category' }),
      def({ id: 'help.shortcuts', title: 'help.shortcuts', category: 'help.category', keys: 'Mod+K' }),
    ]);
    const html = markup();
    expect(html.match(/data-testid="shortcuts-row"/g)).toHaveLength(1);
    expect(html).not.toContain('data-command="help.about"');
    // The one left out is counted, so the list never looks short for no reason (B1 A4).
    expect(html).toContain('data-testid="shortcuts-hidden"');
    expect(html).toContain('1 command without a key is hidden.');
    expect(html).toContain('data-group="Help"');
    expect(html).toContain('Keyboard Shortcuts');
    expect(html).toMatch(/data-command="help\.shortcuts"[^>]*data-keys="(⌘K|Ctrl\+K)"/);
    expect(html).not.toContain('data-testid="shortcuts-empty"');
  });

  it('lists the commands without a key too behind "Show commands without a key"', () => {
    registered = commands.register([
      def({ id: 'help.about', title: 'help.about', category: 'help.category' }),
      def({ id: 'help.shortcuts', title: 'help.shortcuts', category: 'help.category', keys: 'Mod+K' }),
    ]);
    const html = markup(true);
    expect(html).toContain('data-testid="shortcuts-show-unbound"');
    expect(html).toContain('Show commands without a key');
    expect(html.match(/data-testid="shortcuts-row"/g)).toHaveLength(2);
    expect(html).toContain('data-command="help.about"');
    expect(html).not.toContain('data-testid="shortcuts-hidden"');
  });

  it('shows the key in force, marks a key the user changed and links to the Keyboard page', () => {
    registered = commands.register([
      def({ id: 'help.shortcuts', title: 'help.shortcuts', category: 'help.category', keys: 'Mod+K' }),
      def({ id: 'help.about', title: 'help.about', category: 'help.category', keys: 'Mod+J' }),
    ]);
    commands.setKeyOverrides({ 'help.shortcuts': 'Mod+Shift+K' });
    setUserBindings({ 'help.shortcuts': 'Mod+Shift+K' });
    const html = markup();
    expect(html).toMatch(/data-command="help\.shortcuts"[^>]*data-keys="(⇧⌘K|Ctrl\+Shift\+K)"/);
    expect(html.match(/data-testid="shortcuts-changed"/g)).toHaveLength(1);
    expect(html).toContain('You set this key. The built-in key is');
    expect(html).toContain('data-testid="shortcuts-change"');
    expect(html).toContain('Change keys…');
  });

  it('does not say "You set this key" on a command that lost its key to the user\'s key on the same keys', () => {
    registered = commands.register([
      def({ id: 'help.shortcuts', title: 'help.shortcuts', keys: 'Mod+K' }),
      def({ id: 'help.about', title: 'help.about', keys: 'Mod+J' }),
    ]);
    // The user bound Mod+K to help.about: help.shortcuts has no key now, and nothing of it is the user's.
    commands.setKeyOverrides({ 'help.about': 'Mod+K' });
    setUserBindings({ 'help.about': 'Mod+K' });
    const html = markup(true);
    expect(html.match(/data-testid="shortcuts-changed"/g)).toHaveLength(1);
    expect(html).toMatch(/data-command="help\.about"[\s\S]*?shortcuts-changed/);
    expect(html).not.toMatch(/data-command="help\.shortcuts"[\s\S]*?shortcuts-changed/);
  });

  it('marks nothing while no key is changed', () => {
    registered = commands.register(def({ id: 'help.shortcuts', title: 'help.shortcuts', keys: 'Mod+K' }));
    expect(markup()).not.toContain('data-testid="shortcuts-changed"');
  });

  it('says so when no command is registered', () => {
    expect(markup()).toContain('data-testid="shortcuts-empty"');
  });
});
