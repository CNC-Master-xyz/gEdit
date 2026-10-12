// The cost of find and replace over 300,000 lines (wall-clock budgets).
// What a query means is in `search.test.ts` (same folder).

import { describe, expect, it } from 'vitest';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { resolveCodeDbs } from '$lib/core/codes/resolve';
import { compileProfile } from '$lib/core/profiles/compile';
import type { Profile } from '$lib/core/profiles/types';
import fanucJson from '$lib/data/profiles/fanuc-gcode.json';
import { expectWithin } from '../../../../tests/unit/helpers/budget';
import { findInLines, parseQuery, replaceInLines } from './index';
import type { SearchFlags, SearchQuery } from './types';

const fanuc = compileProfile(fanucJson as unknown as Profile);
const CODES = resolveCodeDbs(BUILTIN_CODE_DB_JSON);

const WORD: SearchFlags = { wholeAddress: true, regex: false, caseSensitive: false, inComments: false };

function word(text: string, cp = fanuc): SearchQuery {
  const q = parseQuery(text, cp, WORD);
  if ('error' in q) throw new Error(q.error.key);
  return q;
}

describe('the budget', () => {
  it('300k lines of a Fanuc program in a second', () => {
    const block = ['N10 G1 X10.5 Y20. F300', 'G0 Z5.', 'X-12.345 Y8.', '(COMMENT G1)', 'T1 M6', 'S12000 M3', 'G2 X5. Y5. I2. J0.', 'M98 P2000'];
    const lines = Array.from({ length: 300_000 }, (_, i) => block[i % block.length]);
    const q = word('T1');
    const started = performance.now();
    const r = findInLines(lines, fanuc, q, { max: Infinity, codes: CODES.fanuc });
    expectWithin(performance.now() - started, 1000, 'find T1 in 300k lines');
    expect(r.hits).toHaveLength(37_500);

    const text = parseQuery('g2 x', fanuc, { wholeAddress: false, regex: false, caseSensitive: false, inComments: false });
    if ('error' in text) throw new Error('parse');
    const started2 = performance.now();
    findInLines(lines, fanuc, text, { max: Infinity });
    expectWithin(performance.now() - started2, 1000, 'text find in 300k lines');

    const started3 = performance.now();
    const replaced = replaceInLines(lines, fanuc, q, 'T2');
    expectWithin(performance.now() - started3, 1000, 'replace T1 in 300k lines');
    expect(replaced.count).toBe(37_500);
  });
});
