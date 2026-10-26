// Tests for scripts/check-license-list.mjs, the exact list of licences the app may ship
// (T203). `npm run licenses:check` keeps the notices current; this keeps them to the
// licences someone has read.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ALLOWED, checkLicenses } from '../../scripts/check-license-list.mjs';

const SCRIPT = fileURLToPath(new URL('../../scripts/check-license-list.mjs', import.meta.url));
const REAL = fileURLToPath(new URL('../../src/lib/data/licenses.json', import.meta.url));

interface Pkg {
  name: string;
  version: string;
  license: string;
  source: string;
  textId: string;
}

const pkg = (name: string, license: string, textId = 't'): Pkg => ({ name, version: '1.0.0', license, source: 'npm', textId });
const file = (packages: Pkg[], texts: Record<string, string> = { t: 'text' }) => ({ packages, texts });

describe('checkLicenses', () => {
  it('is quiet when every licence is listed and every entry is in use', () => {
    const data = file(ALLOWED.map((license, i) => pkg(`p${i}`, license)));
    expect(checkLicenses(data)).toEqual({ unlisted: [], unused: [], noText: [] });
  });

  it('names a licence that is not on the list, with the packages that carry it', () => {
    const data = file([...ALLOWED.map((license, i) => pkg(`p${i}`, license)), pkg('newdep', 'GPL-3.0-only'), pkg('other', 'GPL-3.0-only')]);
    expect(checkLicenses(data).unlisted).toEqual([{ license: 'GPL-3.0-only', packages: ['newdep@1.0.0 (npm)', 'other@1.0.0 (npm)'] }]);
  });

  it('is exact: "SEE LICENSE FILE" and a respelled expression are not on the list', () => {
    const data = file([pkg('a', 'SEE LICENSE FILE'), pkg('b', 'MIT/Apache-2.0'), pkg('c', 'mit')]);
    expect(checkLicenses(data, ['MIT']).unlisted.map((entry) => entry.license)).toEqual(['MIT/Apache-2.0', 'SEE LICENSE FILE', 'mit']);
  });

  it('names an entry that no package uses, so the list never allows more than the app ships', () => {
    const data = file([pkg('a', 'MIT')]);
    expect(checkLicenses(data, ['MIT', 'ISC']).unused).toEqual(['ISC']);
  });

  it('names a package whose licence text is missing', () => {
    const data = file([pkg('a', 'MIT', 'gone')], {});
    expect(checkLicenses(data, ['MIT']).noText).toEqual(['a@1.0.0']);
  });
});

describe('the list', () => {
  it('is sorted and has no duplicate', () => {
    expect([...ALLOWED]).toEqual([...new Set(ALLOWED)]);
    expect([...ALLOWED]).toEqual([...ALLOWED].sort());
  });

  it('is exactly the set of licences in the committed notices', () => {
    const real = JSON.parse(readFileSync(REAL, 'utf8'));
    expect(checkLicenses(real)).toEqual({ unlisted: [], unused: [], noText: [] });
  });
});

describe('the command', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  function run(content: string | null) {
    const dir = mkdtempSync(join(tmpdir(), 'gedit-lic-'));
    dirs.push(dir);
    const path = join(dir, 'licenses.json');
    if (content !== null) writeFileSync(path, content);
    return spawnSync(process.execPath, [SCRIPT, '--file', path], { encoding: 'utf8' });
  }

  it('exits 0 on the real file', () => {
    const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('exits 1 and names the package when a licence is added', () => {
    const real = JSON.parse(readFileSync(REAL, 'utf8'));
    real.packages.push(pkg('sneaky-dep', 'AGPL-3.0-or-later', Object.keys(real.texts)[0]));
    const result = run(JSON.stringify(real));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('licence not on the list: "AGPL-3.0-or-later" — sneaky-dep@1.0.0 (npm)');
  });

  it('exits 1 when the last user of a listed licence is gone', () => {
    const real = JSON.parse(readFileSync(REAL, 'utf8'));
    real.packages = real.packages.filter((entry: Pkg) => entry.license !== 'OFL-1.1');
    const result = run(JSON.stringify(real));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('on the list but no package uses it: "OFL-1.1"');
  });

  it('exits 2 for a file that is missing, broken or not a licences file', () => {
    expect(run(null).status).toBe(2);
    expect(run('{ not json').status).toBe(2);
    expect(run('{"hello": 1}').status).toBe(2);
  });
});
