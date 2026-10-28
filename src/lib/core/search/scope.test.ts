// Find All limited to line ranges (P4.31, plan section 6.8.6): `SearchOptions.ranges` reads only
// those lines, keeps the document's line numbers, and reaches the regex guard as the lines the
// search will read.

import { describe, expect, it } from 'vitest';
import { cpOf } from '../../../../tests/unit/helpers/profiles';
import { createInlineRunner, type GuardRunner } from '../regexGuard/runner';
import type { GuardJob } from '../regexGuard/job';
import { findInLinesGuarded } from './guard';
import { findInLines, linesInRanges, normalizeRanges, parseQuery } from './index';
import type { SearchFlags, SearchQuery } from './types';

const fanuc = cpOf('fanuc-lathe');
const klartext = cpOf('heidenhain-klartext');
const WORD: SearchFlags = { wholeAddress: true, regex: false, caseSensitive: false, inComments: false };
const TEXT: SearchFlags = { wholeAddress: false, regex: false, caseSensitive: false, inComments: false };

function query(text: string, cp = fanuc, flags: SearchFlags = WORD): SearchQuery {
  const q = parseQuery(text, cp, flags);
  if ('error' in q) throw new Error(q.error.key);
  return q;
}

// Two channels in one program: channel 1 at 3-4 and 7, channel 2 at 5-6.
const LINES = ['%', 'O1000', 'G1 X1', 'G0 X2', 'G1 X3', 'G1 X4', 'G1 X5'];

describe('findInLines with ranges', () => {
  it('reads only the lines of the ranges and keeps the document s line numbers', () => {
    const { hits, truncated } = findInLines(LINES, fanuc, query('G1'), { ranges: [{ startLine: 3, endLine: 4 }, { startLine: 7, endLine: 7 }] });
    expect(hits.map((h) => h.line)).toEqual([3, 7]);
    expect(hits.map((h) => h.text)).toEqual(['G1 X1', 'G1 X5']);
    expect(truncated).toBe(false);
  });

  it('is the old behaviour without ranges, and finds nothing outside them', () => {
    expect(findInLines(LINES, fanuc, query('G1')).hits.map((h) => h.line)).toEqual([3, 5, 6, 7]);
    expect(findInLines(LINES, fanuc, query('G1'), { ranges: [{ startLine: 1, endLine: 2 }] }).hits).toEqual([]);
  });

  it('an empty list of ranges reads no line at all', () => {
    expect(findInLines(LINES, fanuc, query('G1'), { ranges: [] })).toEqual({ hits: [], truncated: false });
  });

  it('reads the ranges in line order, a line in two ranges once, and clips ranges to the document', () => {
    const ranges = [{ startLine: 6, endLine: 99 }, { startLine: 3, endLine: 6 }, { startLine: -4, endLine: 3 }];
    expect(findInLines(LINES, fanuc, query('G1'), { ranges }).hits.map((h) => h.line)).toEqual([3, 5, 6, 7]);
    expect(normalizeRanges([{ startLine: 5, endLine: 6 }, { startLine: 1, endLine: 2 }, { startLine: 3, endLine: 3 }, { startLine: 9, endLine: 8 }], 7)).toEqual([
      { startLine: 1, endLine: 3 },
      { startLine: 5, endLine: 6 },
    ]);
  });

  it('a text search is limited the same way, and the cap counts the hits of the ranges', () => {
    const ranges = [{ startLine: 5, endLine: 7 }];
    expect(findInLines(LINES, fanuc, query('X', fanuc, TEXT), { ranges }).hits.map((h) => h.line)).toEqual([5, 6, 7]);
    const capped = findInLines(LINES, fanuc, query('X', fanuc, TEXT), { ranges, max: 2 });
    expect(capped.hits.map((h) => h.line)).toEqual([5, 6]);
    expect(capped.truncated).toBe(true);
  });

  it('finds the same words in a range as the whole-program search finds there (a range may start in a continued block)', () => {
    const lines = ['0 BEGIN PGM A MM', '1 L X10 ~', '2 L X20', '3 L X30'];
    const whole = findInLines(lines, klartext, query('L', klartext)).hits.map((h) => h.line);
    expect(whole).toEqual([2, 3, 4]);
    const scoped = findInLines(lines, klartext, query('L', klartext), { ranges: [{ startLine: 3, endLine: 4 }] }).hits.map((h) => h.line);
    expect(scoped).toEqual([3, 4]);
  });
});

describe('the guard reads the lines the search reads', () => {
  function spy() {
    const jobs: GuardJob[] = [];
    const runner: GuardRunner = {
      run(job, budgetMs) {
        jobs.push(job);
        return createInlineRunner().run(job, budgetMs);
      },
      dispose() {},
    };
    return { runner, jobs };
  }

  it('gives the worker only the lines of the ranges', async () => {
    const { runner, jobs } = spy();
    const q = query('X\\d', fanuc, { ...TEXT, regex: true });
    const found = await findInLinesGuarded(runner, LINES, fanuc, q, { ranges: [{ startLine: 5, endLine: 6 }] });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].lines).toEqual(['G1 X3', 'G1 X4']);
    expect('hits' in found && found.hits.map((h) => h.line)).toEqual([5, 6]);
  });

  it('without ranges gives it every line, as before', async () => {
    const { runner, jobs } = spy();
    await findInLinesGuarded(runner, LINES, fanuc, query('X\\d', fanuc, { ...TEXT, regex: true }));
    expect(jobs[0].lines).toEqual(LINES);
  });

  it('still stops a pattern that runs away inside the ranges', async () => {
    const runner: GuardRunner = {
      run: (_job, budgetMs) => Promise.resolve({ status: 'timeout', budgetMs, probe: 'query' }),
      dispose() {},
    };
    const q = query('(a+)+$', fanuc, { ...TEXT, regex: true });
    const found = await findInLinesGuarded(runner, LINES, fanuc, q, { ranges: [{ startLine: 3, endLine: 4 }] });
    expect('refused' in found).toBe(true);
  });

  it('linesInRanges is the lines the ranges cover', () => {
    expect(linesInRanges(LINES, [{ startLine: 6, endLine: 7 }, { startLine: 1, endLine: 1 }])).toEqual(['%', 'G1 X4', 'G1 X5']);
  });
});
