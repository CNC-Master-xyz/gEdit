// The CI checks stay wired in (T184, T199-T203). A check that nobody calls proves nothing, and
// a workflow cannot be run here, so this is what a unit test can say about it: the steps are
// there, the scripts and commands they name exist, and the old step they replace is gone.
// What the steps *do* is pinned by the tests of the scripts themselves (checkBundle,
// controlBytes, licenseList, checkAnonymized) and by running the same commands locally.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string) => readFileSync(ROOT + rel, 'utf8').replace(/\r\n/g, '\n');
const CI = read('.github/workflows/ci.yml');
const HARNESS = read('.github/workflows/harness.yml');

/** One job of a workflow: from its `  name:` line to the next job. */
function job(workflow: string, name: string): string {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  if (start < 0) throw new Error(`no job ${name}`);
  const next = workflow.slice(start + 1).search(/\n {2}[a-z][\w-]*:\n/);
  return next < 0 ? workflow.slice(start) : workflow.slice(start, start + 1 + next);
}

describe('ci.yml: the checks job', () => {
  const checks = job(CI, 'checks');

  it.each([
    ['the bundle scan, on the build', 'node scripts/check-bundle.mjs build'],
    ['the exact licence list', 'node scripts/check-license-list.mjs'],
    ['the NUL and control byte scan', 'node scripts/check-control-bytes.mjs'],
    ['the type check of the harness scripts', 'npx tsc -p tests/runtime/harness'],
  ])('runs %s', (_what, command) => {
    expect(checks).toContain(`run: ${command}`);
  });

  it('runs the bundle scan after the build, not before', () => {
    expect(checks.indexOf('npm run build')).toBeGreaterThan(0);
    expect(checks.indexOf('check-bundle.mjs')).toBeGreaterThan(checks.indexOf('npm run build'));
  });

  it('no longer greps the bundle for eval and Function', () => {
    expect(checks).not.toMatch(/grep -rn?E?q? .*(Function|eval)/);
    expect(checks).not.toContain("grep -rq '__gedit'");
  });
});

describe('ci.yml: the python job', () => {
  const python = job(CI, 'python');

  it('runs the whole suite on Windows as well, with the newest interpreter', () => {
    expect(python).toMatch(/os: \[ubuntu-22\.04\]/);
    expect(python).toMatch(/include:[\s\S]*- os: windows-latest\n\s+python: '3\.12'/);
    expect(python).toContain('runs-on: ${{ matrix.os }}');
    expect(python).toContain('python -m unittest discover -s tests/python -t .');
  });

  it('turns line-ending conversion off for the Windows checkout, before the checkout', () => {
    expect(python.indexOf('core.autocrlf false')).toBeGreaterThan(0);
    expect(python.indexOf('core.autocrlf false')).toBeLessThan(python.indexOf('actions/checkout'));
    expect(python).toContain("if: runner.os == 'Windows'");
  });

  it('keeps the names of the Linux jobs, which may be required checks', () => {
    expect(python).toContain("name: Python ${{ matrix.python }}${{ matrix.os == 'windows-latest' && ' (Windows)' || '' }}");
  });
});

describe('harness.yml', () => {
  it('lints harness.rs after the build and before the suite', () => {
    const sync = HARNESS.indexOf('tests/runtime/sync.sh');
    const clippy = HARNESS.indexOf('tests/runtime/clippy.sh');
    const suite = HARNESS.indexOf('tests/runtime/suite.sh');
    expect(sync).toBeGreaterThan(0);
    expect(clippy).toBeGreaterThan(sync);
    expect(suite).toBeGreaterThan(clippy);
  });
});

describe('what the workflows run exists', () => {
  const commands = [...(CI + HARNESS).matchAll(/\bnode ((?:scripts|tests)\/[\w./-]+)/g)].map((m) => m[1]);
  const shells = [...(CI + HARNESS).matchAll(/\b(tests\/runtime\/[\w-]+\.sh)\b/g)].map((m) => m[1]);

  it('names at least the new scripts', () => {
    expect(commands).toEqual(expect.arrayContaining(['scripts/check-bundle.mjs', 'scripts/check-license-list.mjs', 'scripts/check-control-bytes.mjs']));
    expect(shells).toEqual(expect.arrayContaining(['tests/runtime/clippy.sh', 'tests/runtime/sync.sh']));
  });

  it.each([...new Set([...commands, ...shells])])('%s is a file', (path) => {
    expect(existsSync(ROOT + path), path).toBe(true);
  });

  it('has the harness type-check configuration', () => {
    expect(existsSync(ROOT + 'tests/runtime/harness/tsconfig.json')).toBe(true);
  });
});
