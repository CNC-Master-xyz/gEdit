// Settings ▸ Packages (Phase 4 plan §6.9 rules 7–15, P4.35). The actions are tested against a
// fake of the page's dependencies; the markup is rendered with `svelte/server` (no DOM).

import { render } from 'svelte/server';
import { writable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import { t } from '$lib/i18n';
import type { PackageInfo, PackageList } from '$lib/platform/commands';
import type { ProfileProblem } from '$lib/core/profiles/types';

vi.mock('$lib/app/status', () => ({ status: { show: () => {} } }));
vi.mock('$lib/app/scripts', () => ({ scripts: { rescan: async () => {} } }));
vi.mock('$lib/app/userConfig', () => ({
  userConfig: { problems: writable<ProfileProblem[]>([]), packages: writable(null), load: async () => [] },
}));

const PackagesPage = (await import('./PackagesPage.svelte')).default;
const { MAX_ROW_LINES, loadLines, reloadPackages, rowsOf, switchPackage } = await import('./PackagesPage.svelte');
type Deps = Parameters<typeof switchPackage>[2];

const info = (over: Partial<PackageInfo> = {}): PackageInfo => ({
  name: 'shop-a',
  title: 'Shop A',
  version: '1.2',
  description: 'Facing and chamfer',
  enabled: true,
  scripts: 2,
  profiles: 1,
  codes: 3,
  error: null,
  problems: [],
  ...over,
});
const list = (...packages: PackageInfo[]): PackageList => ({ folder: '/cfg/packages', packages, problems: [] });

function deps(disabled: string[] = [], over: Partial<Deps> = {}) {
  const calls: string[] = [];
  const state = { disabled };
  const shown: { text: string; error: boolean }[] = [];
  const d: Deps = {
    list: async () => list(info()),
    disabled: () => state.disabled,
    saveDisabled: async (names) => {
      calls.push(`save ${JSON.stringify(names)}`);
      state.disabled = names;
    },
    rescan: async () => void calls.push('rescan'),
    load: async () => void calls.push('load'),
    status: { show: (text, o) => void shown.push({ text, error: o?.error === true }) },
    t,
    ...over,
  };
  return { d, calls, shown, state };
}

describe('the rows', () => {
  it('shows the display name, the counts and the state, and the folder name when it differs', () => {
    const rows = rowsOf(list(info(), info({ name: 'plain', title: '', enabled: false, scripts: 0, profiles: 0, codes: 0 })), t);
    expect(rows[0]).toMatchObject({ name: 'shop-a', title: 'Shop A', version: '1.2', enabled: true, scripts: 2, profiles: 1, codes: 3 });
    expect(rows[1]).toMatchObject({ name: 'plain', title: 'plain', enabled: false });
  });

  it('bounds the notes of a row', () => {
    const many = Array.from({ length: MAX_ROW_LINES + 5 }, (_, i) => `note ${i}`);
    const lines = rowsOf(list(info({ problems: many })), t)[0].lines;
    expect(lines).toHaveLength(MAX_ROW_LINES + 1);
    expect(lines.at(-1)).toContain('5');
  });

  it('formats the problems of the last load that belong to a package, and only those', () => {
    const problems: ProfileProblem[] = [
      { origin: 'user', file: 'x.json', package: 'shop-a', profileId: null, path: 'id', message: 'the id is already taken', kind: 'profiles' },
      { origin: 'user', file: 'mine.json', profileId: null, path: '', message: 'not valid JSON', kind: 'profiles' },
    ];
    expect(loadLines(problems, t)).toEqual(['package shop-a: x.json (id): the id is already taken']);
  });
});

describe('switching a package', () => {
  it('saves the setting first, then rescans the scripts and loads the files again (no restart)', async () => {
    const { d, calls, shown } = deps();
    expect(await switchPackage('shop-a', false, d)).toBe(true);
    expect(calls).toEqual(['save ["shop-a"]', 'rescan', 'load']);
    expect(shown.at(-1)).toEqual({ text: 'Package shop-a is off.', error: false });
  });

  it('switches it on by taking the name out, and keeps the names of folders that are gone', async () => {
    const { d, calls, shown, state } = deps(['gone', 'shop-a']);
    expect(await switchPackage('shop-a', true, d)).toBe(true);
    expect(state.disabled).toEqual(['gone']);
    expect(calls).toEqual(['save ["gone"]', 'rescan', 'load']);
    expect(shown.at(-1)?.text).toBe('Package shop-a is on.');
  });

  it('does nothing when it is already so', async () => {
    const { d, calls } = deps(['shop-a']);
    expect(await switchPackage('shop-a', false, d)).toBe(true);
    expect(await switchPackage('shop-b', true, d)).toBe(true);
    expect(calls).toEqual([]);
  });

  it('says so and changes nothing else when the setting cannot be saved', async () => {
    const { d, calls, shown } = deps([], {
      saveDisabled: async () => {
        throw new Error('disk full');
      },
    });
    expect(await switchPackage('shop-a', false, d)).toBe(false);
    expect(calls).toEqual([]);
    expect(shown).toEqual([{ text: 'Package shop-a could not be switched.', error: true }]);
  });

  it('still loads the files when the rescan fails', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { d, calls } = deps([], {
      rescan: async () => {
        throw new Error('no python');
      },
    });
    expect(await switchPackage('shop-a', false, d)).toBe(true);
    expect(calls).toEqual(['save ["shop-a"]', 'load']);
    quiet.mockRestore();
  });

  it('Reload runs the same two steps without touching the setting', async () => {
    const { d, calls, shown } = deps();
    await reloadPackages(d);
    expect(calls).toEqual(['rescan', 'load']);
    expect(shown.at(-1)?.text).toBe('Packages reloaded.');
  });
});

describe('the page', () => {
  const html = render(PackagesPage).body;

  it('keeps the root and its test id, says that a package is as trusted as a script, and shows the Reload button', () => {
    expect(html).toContain('data-testid="settings-packages"');
    expect(html).toContain('as trusted as a script you wrote yourself');
    expect(html).toContain('data-testid="package-reload"');
    expect(html).toContain('gEdit never downloads a package');
  });

  it('offers no way to fetch or install a package from a link', () => {
    expect(html.toLowerCase()).not.toContain('install from');
    expect(html.toLowerCase()).not.toContain('<input type="url"');
    expect(html.toLowerCase()).not.toContain('download a package from');
  });

  it('says it is reading the folder until the list has come', () => {
    expect(html).toContain('Reading the packages folder');
  });
});

describe('the page with a list', () => {
  const shown = (over: Partial<PackageInfo>[] = [{}]) => render(PackagesPage, { props: { initial: list(...over.map((o) => info(o))) } }).body;

  it('has one row per package with its name, switch and state as the harness reads them', () => {
    const html = shown([{}, { name: 'shop-b', title: 'Shop B', enabled: false }]);
    expect(html.match(/data-testid="package-row"/g)).toHaveLength(2);
    expect(html).toMatch(/data-package="shop-a"[^>]*data-enabled="1"|data-enabled="1"[^>]*data-package="shop-a"/);
    expect(html).toMatch(/data-package="shop-b"[^>]*data-enabled="0"|data-enabled="0"[^>]*data-package="shop-b"/);
    expect(html.match(/data-testid="package-toggle"/g)).toHaveLength(2);
    expect(html).toContain('Shop A');
    expect(html).toContain('Scripts: 2, profiles: 1, code files: 3');
    expect(html).toContain('Folder: shop-a');
    expect(html).toContain('/cfg/packages');
  });

  it('says a switched-off package loads nothing', () => {
    expect(shown([{ enabled: false }])).toContain('Switched off: nothing of this package is loaded.');
  });

  it('lists a folder that cannot be used with the reason and gives it no switch to turn on', () => {
    const html = shown([{ name: 'linked', title: 'linked', error: 'a link, not followed; copy the package folder here instead' }]);
    expect(html).toContain('This folder cannot be used as a package: a link, not followed');
    expect(html).toMatch(/data-testid="package-toggle"[^>]*disabled/);
  });

  it('shows the notes of a manifest', () => {
    expect(shown([{ problems: ['no package.json (the folder name is shown)'] }])).toContain('no package.json (the folder name is shown)');
  });

  it('says there are none when the folder is empty', () => {
    expect(render(PackagesPage, { props: { initial: list() } }).body).toContain('No packages yet.');
  });
});
