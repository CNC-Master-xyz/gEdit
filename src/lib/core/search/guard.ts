// A regular expression in Find All or Replace All that runs away (T227, M11 review CODE-4).
//
// `findInLines` and `replaceInLines` are synchronous and cannot be interrupted, so a pattern
// such as `(a+)+$` on a long line froze the editor. These wrappers first run the query's
// pattern over the same lines in the guard worker (`core/regexGuard`), with a time budget; a
// pattern that passes has run to the end once, and the synchronous scanner then reads the
// document as before. A pattern that does not pass is stopped, and the answer is a message in
// plain words, never a hang.
//
// Synchronous fast paths: a word query and a text query that is not a regular expression
// never go to the worker (they cannot run away), nor does a regular expression that has no
// regular-expression syntax in it.
//
// This file is the only part of the search code that knows the worker; `index.ts` only exports `patternOf`.

import type { Msg } from '$lib/app/types';
import type { CodeDb } from '$lib/core/codes/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import { GUARD_BUDGET_MS, guardJob } from '$lib/core/regexGuard/guard';
import { isLiteralPattern } from '$lib/core/regexGuard/job';
import type { GuardRunner } from '$lib/core/regexGuard/runner';
import { findInLines, patternOf, replaceInLines } from './index';
import type { SearchHit, SearchQuery } from './types';

/** Why a guarded search or replace did not run: a message for the status bar. */
export type GuardedRefusal = { refused: Msg };

/** Whether `q` needs the worker at all. */
export function needsGuard(q: SearchQuery): q is Extract<SearchQuery, { kind: 'text' }> {
  return q.kind === 'text' && q.regex && !isLiteralPattern(q.text);
}

/**
 * Runs the pattern of `q` over `lines` in the guard worker. `null`: it came through (or there
 * was nothing to check); else the message that says it was stopped.
 */
export async function guardQuery(
  runner: GuardRunner | null,
  lines: readonly string[],
  q: SearchQuery,
  o?: { budgetMs?: number },
): Promise<Msg | null> {
  if (!needsGuard(q)) return null;
  // The very pattern the scanner runs (`patternOf`); one that does not compile is the scanner's to report.
  let re: RegExp;
  try {
    re = patternOf(q);
  } catch {
    return null;
  }
  const verdict = await guardJob(
    runner,
    { probes: [{ id: 'query', pattern: re.source, flags: re.flags, scan: 'all' }], lines: lines as string[] },
    o?.budgetMs ?? GUARD_BUDGET_MS,
  );
  if (verdict.ok) return null;
  return { key: 'search.errorRegexSlow', params: { seconds: Math.max(1, Math.round(verdict.budgetMs / 1000)) } };
}

/** `findInLines`, after the guard. */
export async function findInLinesGuarded(
  runner: GuardRunner | null,
  lines: string[],
  cp: CompiledProfile,
  q: SearchQuery,
  o?: { max?: number; codes?: CodeDb; budgetMs?: number },
): Promise<{ hits: SearchHit[]; truncated: boolean } | GuardedRefusal> {
  const refused = await guardQuery(runner, lines, q, o);
  if (refused !== null) return { refused };
  return findInLines(lines, cp, q, o);
}

/** `replaceInLines`, after the guard. */
export async function replaceInLinesGuarded(
  runner: GuardRunner | null,
  lines: string[],
  cp: CompiledProfile,
  q: SearchQuery,
  replacement: string,
  o?: { budgetMs?: number },
): Promise<{ lines: string[]; count: number } | GuardedRefusal> {
  const refused = await guardQuery(runner, lines, q, o);
  if (refused !== null) return { refused };
  return replaceInLines(lines, cp, q, replacement);
}
