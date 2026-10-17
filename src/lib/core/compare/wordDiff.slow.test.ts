// The cost of the word marks of a large diff (wall-clock budgets; the rules are in
// `wordDiff.test.ts`, the same folder). `monaco/diff.ts` computes them in slices, so the
// budget is the total work, not the longest pause.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expectWithin } from '../../../../tests/unit/helpers/budget';
import { cpOf } from '../../../../tests/unit/helpers/compareProfiles';
import { WORD_DIFF_MAX_WORDS, wordMarkPairs, type PairSide } from './wordDiff';

const LINES = 100_000;

function program(): string[] {
  const source = readFileSync(
    fileURLToPath(new URL('../../../../tests/fixtures/compare/x5-repost/original.nc', import.meta.url)),
    'utf8',
  )
    .split('\n')
    .filter((line) => line !== '');
  return Array.from({ length: LINES }, (_, i) => `${source[i % source.length]} X${i}.`);
}

describe('budget', () => {
  it('marks the words of 100,000 changed line pairs in two seconds', () => {
    const a = program();
    const b = a.map((line, i) => (i % 3 === 0 ? line.replace(/X(\d+)\.$/, 'X$1.5 F100') : `${line} M${i % 9}`));
    const cp = cpOf('fanuc');
    const sideOf = (lines: string[]): PairSide => ({ cp, line: (n) => lines[n - 1] });
    const block = [{ originalStartLineNumber: 1, originalEndLineNumber: LINES, modifiedStartLineNumber: 1, modifiedEndLineNumber: LINES }];
    // Warm the regexes and caches of the tokenizer.
    for (const _ of wordMarkPairs([{ ...block[0], originalEndLineNumber: 1000, modifiedEndLineNumber: 1000 }], sideOf(a), sideOf(b))) void _;
    const started = performance.now();
    let pairs = 0;
    let words = 0;
    for (const pair of wordMarkPairs(block, sideOf(a), sideOf(b))) {
      pairs++;
      words += pair.marks.original.length + pair.marks.modified.length;
    }
    const ms = performance.now() - started;
    expect(pairs).toBe(LINES);
    expect(words).toBeGreaterThanOrEqual(LINES);
    expectWithin(ms, 2000, `100,000 changed pairs: ${ms.toFixed(0)} ms`);
  });

  it('marks 200 pairs of lines at the word cap in two seconds (the table at its largest)', () => {
    const line = Array.from({ length: WORD_DIFF_MAX_WORDS }, (_, i) => `X${i}.`);
    // Every word differs: the alignment table is the whole 500 x 500.
    const a = Array.from({ length: 200 }, () => line.join(' '));
    const b = a.map((l) => l.replace(/X/g, 'Y'));
    const cp = cpOf('fanuc');
    const sideOf = (lines: string[]): PairSide => ({ cp, line: (n) => lines[n - 1] });
    const block = [{ originalStartLineNumber: 1, originalEndLineNumber: 200, modifiedStartLineNumber: 1, modifiedEndLineNumber: 200 }];
    const started = performance.now();
    let pairs = 0;
    for (const _ of wordMarkPairs(block, sideOf(a), sideOf(b))) pairs++;
    const ms = performance.now() - started;
    expect(pairs).toBe(200);
    expectWithin(ms, 2000, `200 pairs of ${WORD_DIFF_MAX_WORDS} words: ${ms.toFixed(0)} ms`);
  });
});
