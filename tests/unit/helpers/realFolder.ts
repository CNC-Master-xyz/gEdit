// Where the owner's local programs are (the folder and its manifest), shared by `realFixtures.test.ts`
// and `realFixtures.slow.test.ts` in tests/unit. See the first of them for the rules (standing rule 12).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type RealProgram, type Source, programsOf } from './g11';

export type { RealProgram } from './g11';

/** Where the manifest and the programs are, or why there is none. */
export type RealFolder =
  | { kind: 'folder'; path: string; source: 'env' | 'worktree' }
  | { kind: 'not-found' };

const HERE = dirname(fileURLToPath(import.meta.url));

/** The repository this module is in: a worktree, or the main checkout. */
export const REPO = resolve(HERE, '..', '..', '..');

/**
 * The main working tree, even from inside a linked worktree.
 *
 * `git rev-parse --git-common-dir` answers the **shared** `.git` directory, which is the
 * main checkout's; its parent is the main working tree.
 */
export function mainWorkingTree(): string | null {
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: HERE,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (common === '') return null;
    const root = isAbsolute(common) ? common : resolve(HERE, common);
    return dirname(root);
  } catch {
    return null;
  }
}

/** The folder to read, without ever revealing it in a message. */
export function realFolder(env: NodeJS.ProcessEnv = process.env): RealFolder {
  const named = env.GEDIT_REAL_FIXTURES;
  if (typeof named === 'string' && named.trim() !== '') {
    const path = resolve(named.trim());
    if (existsSync(path) && statSync(path).isDirectory()) return { kind: 'folder', path, source: 'env' };
    return { kind: 'not-found' };
  }
  const tree = mainWorkingTree();
  const fallback = tree === null ? null : join(tree, 'tests', 'real');
  if (fallback !== null && existsSync(fallback) && statSync(fallback).isDirectory()) {
    return { kind: 'folder', path: fallback, source: 'worktree' };
  }
  return { kind: 'not-found' };
}

/** The manifest of a folder, or null when there is none (which is "no programs"). */
export function readManifest(folder: string): RealProgram[] | null {
  const path = join(folder, 'manifest.json');
  if (!existsSync(path)) return null;
  return programsOf(JSON.parse(readFileSync(path, 'utf8')));
}

/** The source as the report names it: which of the two folders, never its path. */
export function sourceOf(folder: Extract<RealFolder, { kind: 'folder' }>): Source {
  return folder.source === 'env' ? 'GEDIT_REAL_FIXTURES' : 'main working tree';
}

/** What a run found, for the line the commit body records (counts only, never a path). */
export function summary(folder: RealFolder, programs: RealProgram[] | null): string {
  if (folder.kind === 'not-found') return 'G11 skipped: no local folder found';
  if (programs === null || programs.length === 0) {
    return `G11 skipped: no programs in the local folder (${sourceOf(folder)})`;
  }
  return `G11: ${programs.length} local programs (${sourceOf(folder)})`;
}

/**
 * Whether `GEDIT_G11_REPORT` may be written to `path`: inside the local folder or outside
 * the repository, never under its `tests/` (a report there could end up committed, and
 * its counts are the owner's). The main working tree's `tests/real/` is the local folder
 * and gitignored, so it is allowed.
 */
export function reportPathAllowed(path: string, roots: readonly string[]): boolean {
  const target = resolve(path);
  for (const root of roots) {
    const tests = join(root, 'tests');
    const inside = (dir: string): boolean => {
      const rel = relative(dir, target);
      return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
    };
    if (inside(tests) && !inside(join(tests, 'real'))) return false;
  }
  return true;
}
