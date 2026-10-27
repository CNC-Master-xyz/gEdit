// The profiles of script packages (Phase 4 plan §6.9 rule 11, P4.35): packages first, the user's
// own after them; a profile of your own with a package profile's id replaces it, with a notice;
// of two packages with one id the first by name loads; a problem names its package.

import { describe, expect, it } from 'vitest';
import { createProfileRegistry } from './profiles';
import { createCodeDbService } from './codes';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';

function wired() {
  const codes = createCodeDbService({
    dialectOf: (dialect) => dialect,
    source: (dialect) => BUILTIN_CODE_DB_JSON[dialect],
    sources: () => BUILTIN_CODE_DB_JSON,
    warn: () => {},
  });
  const messages: string[] = [];
  const registry = createProfileRegistry({
    filtersSupported: true,
    codeDbFiles: () => codes.files(),
    codeDb: (dialect, own) => codes.over(own, dialect),
    onProblem: (message) => messages.push(message),
  });
  return { codes, registry, messages };
}

function profile(id: string, patch: Record<string, unknown> = {}, pkg?: string, fileName = `${id}.json`) {
  return {
    name: fileName,
    text: JSON.stringify({ id, name: `${id} lathe`, shortName: id.toUpperCase().slice(0, 8), extends: 'fanuc-lathe', ...patch }),
    ...(pkg === undefined ? {} : { package: pkg }),
  };
}

describe('profiles of packages', () => {
  it('loads a package profile after the built-ins and marks it as a file of the user\'s kind', () => {
    const { registry } = wired();
    expect(registry.reload([profile('shop-lathe', {}, 'shop-a')])).toEqual([]);
    expect(registry.list().map((p) => p.id).slice(-1)).toEqual(['shop-lathe']);
    expect(registry.get('shop-lathe')).toMatchObject({ origin: 'user', parent: 'fanuc-lathe' });
    // The file is told apart from a file of the user's own of the same name.
    expect(registry.get('shop-lathe')?.file).toBe('shop-a/shop-lathe.json');
  });

  it('lists the packages\' profiles before the user\'s own, packages by name', () => {
    const { registry } = wired();
    registry.reload([profile('mine'), profile('b-prof', {}, 'shop-b'), profile('a-prof', {}, 'shop-a')]);
    expect(registry.list().map((p) => p.id).slice(-3)).toEqual(['a-prof', 'b-prof', 'mine']);
  });

  it('replaces a package profile by the user\'s of the same id, with a notice on the package\'s file', () => {
    const { registry } = wired();
    const problems = registry.reload([
      profile('shop-lathe', { name: 'From the package', shortName: 'PKG' }, 'shop-a'),
      profile('shop-lathe', { name: 'Mine', shortName: 'MINE' }),
    ]);
    expect(registry.profile('shop-lathe').name).toBe('Mine');
    expect(registry.get('shop-lathe')?.file).toBe('shop-lathe.json');
    expect(problems).toEqual([
      expect.objectContaining({
        origin: 'user',
        package: 'shop-a',
        file: 'shop-lathe.json',
        profileId: 'shop-lathe',
        path: 'id',
        severity: 'info',
        kind: 'profiles',
      }),
    ]);
    expect(problems[0].message).toContain('replaced by your own profile in shop-lathe.json');
    // The replacement is not an error: the registry's problems hold only that notice.
    expect(registry.problems().filter((p) => p.severity !== 'info')).toEqual([]);
  });

  it('loads the first of two packages with one id, by package name, and reports the second', () => {
    const { registry } = wired();
    const problems = registry.reload([
      profile('twin', { name: 'Second', shortName: 'Two' }, 'shop-b'),
      profile('twin', { name: 'First', shortName: 'One' }, 'shop-a'),
    ]);
    expect(registry.profile('twin').name).toBe('First');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ package: 'shop-b', file: 'twin.json', path: 'id', message: 'the id is already taken' });
  });

  it('reports a package profile with a built-in id and keeps the built-in', () => {
    const { registry } = wired();
    const problems = registry.reload([profile('fanuc-gcode', { name: 'Theirs', shortName: 'Theirs' }, 'shop-a')]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ package: 'shop-a', file: 'fanuc-gcode.json', profileId: 'fanuc-gcode', path: 'id' });
    expect(problems[0].message).toBe('the id belongs to a built-in profile');
    expect(registry.get('fanuc-gcode')).toMatchObject({ origin: 'builtin', file: null });
  });

  it('names the package of a broken file, of a validation problem and of a bad parent', () => {
    const { registry, messages } = wired();
    const problems = registry.reload([
      { name: 'not-json.json', text: '{ nope', package: 'shop-a' },
      profile('bad-step', { numbering: { step: 'ten' } }, 'shop-a'),
      profile('no-parent', { extends: 'nowhere' }, 'shop-b'),
      { name: 'not-json.json', text: '{ nope' },
    ]);
    const byPackage = (pkg: string | undefined, file: string) => problems.filter((p) => p.package === pkg && p.file === file);
    expect(byPackage('shop-a', 'not-json.json')[0].message).toMatch(/not valid JSON/);
    expect(byPackage('shop-a', 'bad-step.json')[0]).toMatchObject({ profileId: 'bad-step', path: 'numbering.step' });
    expect(byPackage('shop-b', 'no-parent.json')[0]).toMatchObject({ profileId: 'no-parent', path: 'extends' });
    // The user's own file of the same name as a package's is not mistaken for it.
    expect(byPackage(undefined, 'not-json.json')).toHaveLength(1);
    expect(messages.some((m) => m.startsWith('package shop-a: not-json.json was not loaded'))).toBe(true);
  });

  it('lets a profile extend one of another package or of the user, whatever the layers', () => {
    const { registry } = wired();
    const problems = registry.reload([
      profile('child', { extends: 'base', name: 'Child', shortName: 'Child' }, 'shop-a'),
      profile('base', { numbering: { step: 5 } }, 'shop-b'),
    ]);
    expect(problems).toEqual([]);
    expect(registry.profile('child').numbering?.step).toBe(5);
    // The user's replacement of the parent is what the package's child then extends.
    registry.reload([
      profile('child', { extends: 'base', name: 'Child', shortName: 'Child' }, 'shop-a'),
      profile('base', { numbering: { step: 5 } }, 'shop-b'),
      profile('base', { numbering: { step: 2 } }),
    ]);
    expect(registry.profile('child').numbering?.step).toBe(2);
  });

  it('forgets a package profile when its package is switched off', () => {
    const { registry } = wired();
    registry.reload([profile('shop-lathe', {}, 'shop-a')]);
    expect(registry.get('shop-lathe')).toBeDefined();
    registry.reload([]);
    expect(registry.get('shop-lathe')).toBeUndefined();
  });
});
