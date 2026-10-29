// The code files of script packages (Phase 4 plan §6.9 rule 11, P4.35): overlays laid on the
// built-ins package by package and then the user's, member by member; a database of a package's
// own that the user's file of the same id replaces; a problem that names its package.

import { describe, expect, it } from 'vitest';
import { createCodeDbService } from './codes';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import type { CodeDb } from '$lib/core/codes/types';

function service() {
  return createCodeDbService({
    dialectOf: (id) => id,
    source: (dialect) => BUILTIN_CODE_DB_JSON[dialect],
    sources: () => BUILTIN_CODE_DB_JSON,
    warn: () => {},
  });
}

const file = (name: string, content: unknown, pkg?: string) => ({
  name,
  text: JSON.stringify(content),
  ...(pkg === undefined ? {} : { package: pkg }),
});
const entryOf = (db: CodeDb, code: string) => db.codes.find((entry) => entry.code === code);
const labelOf = (db: CodeDb, code: string) => entryOf(db, code)?.label;

const overlay = (label: string, extra: Record<string, unknown> = {}) => ({
  dialect: 'fanuc-lathe',
  codes: [{ code: 'M13', label, ...extra }],
});

describe('overlays: the built-in, then the packages by name, then the user', () => {
  it('lays a package overlay over the built-in database and its children', () => {
    const svc = service();
    expect(svc.reload([file('fanuc-lathe.json', overlay('Chuck clamp (A)'), 'shop-a')])).toEqual([]);
    expect(labelOf(svc.byId('fanuc-lathe'), 'M13')).toBe('Chuck clamp (A)');
    expect(labelOf(svc.byId('fanuc-lathe-b'), 'M13')).toBe('Chuck clamp (A)');
    // The rest of the built-in is there, and a dialect nobody touched is as it was.
    expect(labelOf(svc.byId('fanuc-lathe'), 'G28')).toBe('Return to the reference point');
    expect(svc.byId('fanuc').codes.length).toBe(service().byId('fanuc').codes.length);
  });

  it('lets a later package win over an earlier one, and the user over both', () => {
    const files = [
      file('fanuc-lathe.json', overlay('Clamp (B)'), 'shop-b'),
      file('fanuc-lathe.json', overlay('Clamp (A)'), 'shop-a'),
      file('fanuc-lathe.json', overlay('Clamp (mine)')),
    ];
    const svc = service();
    svc.reload(files.slice(0, 2));
    // Packages by name, so shop-b is the later one whatever order the files arrive in.
    expect(labelOf(svc.byId('fanuc-lathe'), 'M13')).toBe('Clamp (B)');
    svc.reload(files);
    expect(labelOf(svc.byId('fanuc-lathe'), 'M13')).toBe('Clamp (mine)');
    svc.reload(files.slice(0, 2));
    expect(labelOf(svc.byId('fanuc-lathe'), 'M13')).toBe('Clamp (B)');
    svc.reload([]);
    expect(labelOf(svc.byId('fanuc-lathe'), 'M13')).not.toBe('Clamp (B)');
  });

  it('merges member by member across the layers, so a package keeps what another one set', () => {
    const svc = service();
    const g76 = (extra: Record<string, unknown>) => ({ dialect: 'fanuc-lathe', codes: [{ code: 'G76', ...extra }] });
    const problems = svc.reload([
      file('fanuc-lathe.json', g76({ label: 'Threading (A)' }), 'shop-a'),
      file('fanuc-lathe.json', g76({ pitchFeed: false }), 'shop-b'),
    ]);
    const merged = entryOf(svc.byId('fanuc-lathe'), 'G76');
    // A's label and the rest of the built-in entry stay; B switched `pitchFeed` off.
    expect(merged).toMatchObject({ label: 'Threading (A)', sets: { cycle: 'start' } });
    expect(merged?.pitchFeed).toBeFalsy();
    // Every changed meaning is a notice in the file that changed it, with its package.
    const notices = problems.filter((p) => p.severity === 'info');
    expect(notices.length).toBeGreaterThan(0);
    const fromB = notices.find((p) => p.package === 'shop-b' && p.path.endsWith('.pitchFeed'));
    expect(fromB).toMatchObject({ file: 'fanuc-lathe.json', profileId: 'fanuc-lathe', kind: 'codes' });
    // It says what it was laid over (the package's layer), and it does not call a package's entry "yours".
    expect(fromB?.message).toContain('of package shop-a');
    expect(fromB?.message).not.toContain('your entry');
  });

  it('calls the user\'s own entry yours, also when it sits on a package', () => {
    const svc = service();
    const problems = svc.reload([
      file('fanuc-lathe.json', { dialect: 'fanuc-lathe', codes: [{ code: 'G76', pitchFeed: false }] }, 'shop-a'),
      file('fanuc-lathe.json', { dialect: 'fanuc-lathe', codes: [{ code: 'G76', pitchFeed: true }] }),
    ]);
    const mine = problems.find((p) => p.package === undefined && p.severity === 'info');
    expect(mine?.message).toContain('your entry');
    expect(mine?.message).toContain('of package shop-a');
  });

  it('serves every layer to the profile registry, the lower ones under ids no profile can name', () => {
    const svc = service();
    svc.reload([file('fanuc-lathe.json', overlay('A'), 'shop-a'), file('fanuc-lathe.json', overlay('B'), 'shop-b')]);
    const keys = Object.keys(svc.files());
    expect(keys).toContain('fanuc-lathe');
    expect(keys).toContain('fanuc-lathe@base');
    expect(keys).toContain('fanuc-lathe@l0');
  });

  it('keeps the user-only behaviour: one overlay, no layer ids, no package on a problem', () => {
    const svc = service();
    const problems = svc.reload([file('fanuc-lathe.json', overlay('Mine', { pitchFeed: undefined }))]);
    expect(problems.every((p) => p.package === undefined)).toBe(true);
    expect(Object.keys(svc.files()).filter((key) => key.includes('@'))).toEqual(['fanuc-lathe@base']);
  });
});

describe('a database of a package\'s own', () => {
  const own = (label: string) => ({ dialect: 'lathe-shop', extends: 'fanuc-lathe', codes: [{ code: 'M13', label }] });

  it('extends a built-in database like the user\'s own', () => {
    const svc = service();
    expect(svc.reload([file('lathe-shop.json', own('Shop clamp'), 'shop-a')])).toEqual([]);
    expect(labelOf(svc.byId('lathe-shop'), 'M13')).toBe('Shop clamp');
    expect(labelOf(svc.byId('lathe-shop'), 'G28')).toBe('Return to the reference point');
  });

  it('is replaced by the user\'s file of the same id, with a notice on the package\'s file', () => {
    const svc = service();
    const problems = svc.reload([file('lathe-shop.json', own('From the package'), 'shop-a'), file('lathe-shop.json', own('Mine'))]);
    expect(labelOf(svc.byId('lathe-shop'), 'M13')).toBe('Mine');
    expect(problems).toEqual([
      expect.objectContaining({ package: 'shop-a', file: 'lathe-shop.json', severity: 'info', kind: 'codes', profileId: 'lathe-shop' }),
    ]);
    expect(problems[0].message).toContain('replaced by your own code file lathe-shop.json');
  });

  it('loads the first of two packages with one id, by package name, and reports the second', () => {
    const svc = service();
    const problems = svc.reload([file('lathe-shop.json', own('B'), 'shop-b'), file('lathe-shop.json', own('A'), 'shop-a')]);
    expect(labelOf(svc.byId('lathe-shop'), 'M13')).toBe('A');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ package: 'shop-b', file: 'lathe-shop.json', path: 'dialect', kind: 'codes' });
    expect(problems[0].severity).toBeUndefined();
    expect(problems[0].message).toBe('the id is already taken by package shop-a');
  });
});

describe('a problem names its package', () => {
  it('on a broken file, a bad entry and a missing parent, and not on the user\'s own', () => {
    const svc = service();
    const problems = svc.reload([
      { name: 'broken.json', text: '{ nope', package: 'shop-a' },
      file('no-parent.json', { dialect: 'no-parent', extends: 'nowhere', codes: [] }, 'shop-a'),
      file('fanuc-lathe.json', { dialect: 'fanuc-lathe', codes: [{ code: 'M13', label: 'ok' }, { code: '??' }] }, 'shop-b'),
      { name: 'mine.json', text: '{ nope' },
    ]);
    const of = (name: string) => problems.filter((p) => p.file === name);
    expect(of('broken.json')[0]).toMatchObject({ package: 'shop-a', kind: 'codes' });
    expect(of('no-parent.json')[0]).toMatchObject({ package: 'shop-a', path: 'extends' });
    expect(of('fanuc-lathe.json')[0]).toMatchObject({ package: 'shop-b' });
    expect(of('mine.json')[0].package).toBeUndefined();
    // The good entry of the broken-entry file still loaded.
    expect(labelOf(svc.byId('fanuc-lathe'), 'M13')).toBe('ok');
  });
});
