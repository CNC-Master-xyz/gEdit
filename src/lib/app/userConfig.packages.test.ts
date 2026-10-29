// The package layer of the user configuration (Phase 4 plan §6.9 rules 11 and 12, P4.35): the
// load chain over the real registries with a fake user folder and fake package folders.

import { get, writable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import { createUserConfig, type UserConfigDeps } from './userConfig';
import { createProfileRegistry } from '$lib/stores/profiles';
import { createCodeDbService } from '$lib/stores/codes';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import type { ConfigPaths, PackageFile, PackageList, UserFile, UserFileKind } from '$lib/platform/commands';
import type { DocMeta, ReportData, UserFileText } from '$lib/app/types';

const PATHS = { configDir: '/cfg', profilesDir: '/cfg/profiles', codesDir: '/cfg/codes' } as ConfigPaths;

const json = (value: unknown): string => JSON.stringify(value);
const profileText = (id: string, patch: Record<string, unknown> = {}): string =>
  json({ id, name: `${id} lathe`, shortName: id.toUpperCase().slice(0, 8), extends: 'fanuc-lathe', ...patch });
const own = (id: string, patch: Record<string, unknown> = {}): UserFile => ({ name: `${id}.json`, text: profileText(id, patch), error: null });
const pkgProfile = (pkg: string, id: string, patch: Record<string, unknown> = {}): PackageFile => ({
  package: pkg,
  name: `${id}.json`,
  text: profileText(id, patch),
  error: null,
});
const pkgCodes = (pkg: string, id: string, label: string): PackageFile => ({
  package: pkg,
  name: `${id}.json`,
  text: json({ dialect: id, extends: 'fanuc-lathe', codes: [{ code: 'M13', label }] }),
  error: null,
});

const LIST: PackageList = {
  folder: '/cfg/packages',
  packages: [
    { name: 'shop-a', title: 'Shop A', version: '1', description: '', enabled: true, scripts: 1, profiles: 1, codes: 1, error: null, problems: [] },
  ],
  problems: [],
};

function setup(initial: { user?: Record<UserFileKind, UserFile[]>; packages?: Record<UserFileKind, PackageFile[]> } = {}, over: Partial<UserConfigDeps> = {}) {
  const folder: Record<UserFileKind, UserFile[]> = initial.user ?? { profiles: [], codes: [] };
  const packaged: Record<UserFileKind, PackageFile[]> = initial.packages ?? { profiles: [], codes: [] };
  const codes = createCodeDbService({
    dialectOf: (dialect) => dialect,
    source: (dialect) => BUILTIN_CODE_DB_JSON[dialect],
    sources: () => BUILTIN_CODE_DB_JSON,
    warn: () => {},
  });
  const profiles = createProfileRegistry({
    filtersSupported: true,
    codeDbFiles: () => codes.files(),
    codeDb: (dialect, own) => codes.over(own, dialect),
    onProblem: () => {},
  });
  const handed: { kind: UserFileKind; files: UserFileText[] }[] = [];
  const codeReload = codes.reload.bind(codes);
  const profileReload = profiles.reload.bind(profiles);
  codes.reload = (user) => (handed.push({ kind: 'codes', files: user }), codeReload(user));
  profiles.reload = (user) => (handed.push({ kind: 'profiles', files: user }), profileReload(user));
  const docs: DocMeta[] = [];
  const reports: ReportData[] = [];
  const listPackages = vi.fn(async () => LIST);
  const listPackageFiles = vi.fn(async (kind: UserFileKind) => packaged[kind]);
  const deps: UserConfigDeps = {
    available: () => true,
    list: async (kind) => folder[kind],
    listPackageFiles,
    listPackages,
    codes,
    profiles,
    docs: () => docs,
    text: () => '',
    setProfile: () => {},
    status: () => {},
    report: (data) => reports.push(data),
    paths: writable<ConfigPaths | null>(PATHS),
    caseInsensitivePaths: false,
    backslashSeparator: false,
    ...over,
  };
  return { config: createUserConfig(deps), codes, profiles, folder, packaged, handed, reports, listPackages, listPackageFiles };
}

describe('the package layer of a load', () => {
  it('hands the registries the packages\' files first and the user\'s after them, each marked', async () => {
    const s = setup({
      user: { profiles: [own('mine')], codes: [] },
      packages: { profiles: [pkgProfile('shop-b', 'b-prof'), pkgProfile('shop-a', 'a-prof')], codes: [pkgCodes('shop-a', 'lathe-shop', 'Shop clamp')] },
    });
    expect(await s.config.load()).toEqual([]);
    expect(s.handed.map((h) => h.kind)).toEqual(['codes', 'profiles']);
    expect(s.handed[1].files.map((f) => [f.package ?? null, f.name])).toEqual([
      ['shop-a', 'a-prof.json'],
      ['shop-b', 'b-prof.json'],
      [null, 'mine.json'],
    ]);
    expect(s.profiles.list().map((p) => p.id).slice(-3)).toEqual(['a-prof', 'b-prof', 'mine']);
    expect(s.codes.byId('lathe-shop').codes.some((c) => c.label === 'Shop clamp')).toBe(true);
  });

  it('keeps the Profiles page\'s list to the user\'s own files', async () => {
    const s = setup({ user: { profiles: [own('mine')], codes: [] }, packages: { profiles: [pkgProfile('shop-a', 'a-prof')], codes: [] } });
    await s.config.load();
    expect(get(s.config.files)).toEqual([{ kind: 'profiles', name: 'mine.json', error: null }]);
  });

  it('does nothing when the packages\' files are byte-identical, and reloads when one changes', async () => {
    const s = setup({ packages: { profiles: [pkgProfile('shop-a', 'a-prof')], codes: [] } });
    await s.config.load();
    s.handed.length = 0;
    await s.config.load();
    expect(s.handed).toEqual([]);
    s.packaged.profiles = [pkgProfile('shop-a', 'a-prof', { name: 'Renamed' })];
    await s.config.load();
    expect(s.handed.map((h) => h.kind)).toEqual(['codes', 'profiles']);
    expect(s.profiles.profile('a-prof').name).toBe('Renamed');
  });

  it('follows a switch without a restart: with the package\'s files gone, its profile and code file go', async () => {
    const s = setup({ packages: { profiles: [pkgProfile('shop-a', 'a-prof')], codes: [pkgCodes('shop-a', 'lathe-shop', 'Shop clamp')] } });
    await s.config.load();
    expect(s.profiles.get('a-prof')).toBeDefined();
    s.packaged.profiles = [];
    s.packaged.codes = [];
    await s.config.load();
    expect(s.profiles.get('a-prof')).toBeUndefined();
    expect(s.codes.byId('lathe-shop').codes).toEqual([]);
    // Switched on again: back.
    s.packaged.profiles = [pkgProfile('shop-a', 'a-prof')];
    await s.config.load();
    expect(s.profiles.get('a-prof')).toBeDefined();
  });

  it('replaces a package profile by the user\'s of the same id: a notice, and the Results panel stays shut', async () => {
    const s = setup({
      user: { profiles: [own('shop-lathe', { name: 'Mine', shortName: 'MINE' })], codes: [] },
      packages: { profiles: [pkgProfile('shop-a', 'shop-lathe', { name: 'Theirs', shortName: 'THEIRS' })], codes: [] },
    });
    const problems = await s.config.load();
    expect(s.profiles.profile('shop-lathe').name).toBe('Mine');
    expect(problems).toEqual([expect.objectContaining({ package: 'shop-a', severity: 'info', file: 'shop-lathe.json' })]);
    expect(s.reports).toEqual([]);
    expect(get(s.config.problems)).toEqual(problems);
  });

  it('lists a package file that could not be read as a problem of its package', async () => {
    const s = setup({
      packages: {
        profiles: [{ package: 'shop-a', name: 'big.json', text: null, error: 'larger than 1 MiB' }, pkgProfile('shop-a', 'ok-prof')],
        codes: [{ package: 'shop-b', name: 'deep.json', text: '['.repeat(100), error: null }],
      },
    });
    const problems = await s.config.load();
    expect(problems.find((p) => p.file === 'big.json')).toMatchObject({ package: 'shop-a', kind: 'profiles', message: 'larger than 1 MiB' });
    expect(problems.find((p) => p.file === 'deep.json')).toMatchObject({ package: 'shop-b', kind: 'codes' });
    expect(s.profiles.get('ok-prof')).toBeDefined();
    // The Results report says which package.
    expect(s.reports).toHaveLength(1);
    expect(s.reports[0].rows.map((row) => row.file)).toEqual(expect.arrayContaining(['package shop-a: big.json', 'package shop-b: deep.json']));
  });

  it('tells a package file from the user\'s file of the same name', async () => {
    const s = setup({
      user: { profiles: [{ name: 'same.json', text: '{ nope', error: null }], codes: [] },
      packages: { profiles: [{ package: 'shop-a', name: 'same.json', text: '{ nope', error: null }], codes: [] },
    });
    const problems = await s.config.load();
    expect(problems.filter((p) => p.file === 'same.json').map((p) => p.package)).toEqual(['shop-a', undefined]);
  });

  it('stops like an unreadable user folder when the packages cannot be listed: nothing changes, the user is told', async () => {
    const s = setup({ packages: { profiles: [pkgProfile('shop-a', 'a-prof')], codes: [] } });
    await s.config.load();
    s.listPackageFiles.mockRejectedValueOnce(new Error('boom'));
    s.packaged.profiles = [];
    const problems = await s.config.load();
    expect(problems).toEqual([expect.objectContaining({ file: null, message: 'the folder could not be read: boom' })]);
    expect(s.profiles.get('a-prof')).toBeDefined();
    // The next load tries again and sees the change.
    await s.config.load();
    expect(s.profiles.get('a-prof')).toBeUndefined();
  });

  it('keeps the list of the packages for the page, also after a load that changes nothing', async () => {
    const s = setup();
    expect(get(s.config.packages)).toBeNull();
    await s.config.load();
    expect(get(s.config.packages)).toEqual(LIST);
    s.listPackages.mockResolvedValueOnce({ ...LIST, packages: [] });
    await s.config.load();
    expect(get(s.config.packages)?.packages).toEqual([]);
    // A list that cannot be read keeps the last one.
    s.listPackages.mockRejectedValueOnce(new Error('gone'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    await s.config.load();
    quiet.mockRestore();
    expect(get(s.config.packages)?.packages).toEqual([]);
  });

  it('reads no package where there are no package dependencies', async () => {
    const s = setup({}, { listPackageFiles: undefined, listPackages: undefined });
    expect(await s.config.load()).toEqual([]);
    expect(get(s.config.packages)).toBeNull();
  });
});
