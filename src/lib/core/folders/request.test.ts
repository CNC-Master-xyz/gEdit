// The Find in Folder request (P4.28; rules Q1 to Q6 in `request.ts` and plan section 6.8). Q4 to Q6 are
// the engine's and are held in `contrib/findInFolder.test.ts`.

import { describe, expect, it } from 'vitest';
import { compileProfile } from '$lib/core/profiles/compile';
import type { Profile } from '$lib/core/profiles/types';
import fanucJson from '$lib/data/profiles/fanuc-gcode.json';
import { parseQuery } from '$lib/core/search';
import type { SearchFlags, SearchQuery } from '$lib/core/search';
import { FOLDER_LIMITS } from '$lib/platform/commands';
import { containsFor, dateWindow, folderRequest, parseNamePatterns } from './request';
import { FOLDER_MAX_HITS } from './types';

const cp = compileProfile(fanucJson as unknown as Profile);
const OFF: SearchFlags = { wholeAddress: false, regex: false, caseSensitive: false, inComments: false };
const query = (text: string, flags: Partial<SearchFlags> = {}): SearchQuery => {
  const parsed = parseQuery(text, cp, { ...OFF, ...flags });
  if ('error' in parsed) throw new Error(parsed.error.key);
  return parsed;
};

describe('folder request', () => {
  it('the hit cap is the one of Find All', () => {
    expect(FOLDER_MAX_HITS).toBe(10_000);
  });

  describe('Q1: name patterns', () => {
    it('split on ; and spaces, trimmed, empty ones dropped', () => {
      expect(parseNamePatterns('*.nc; *.tap  ;;  O??? ')).toEqual(['*.nc', '*.tap', 'O???']);
      expect(parseNamePatterns('')).toEqual([]);
      expect(parseNamePatterns(' ; ')).toEqual([]);
    });

    it('allow 16 patterns of 128 characters and refuse one more', () => {
      const sixteen = Array.from({ length: FOLDER_LIMITS.maxPatterns }, (_, i) => `*${i}.nc`);
      expect(parseNamePatterns(sixteen.join(';'))).toEqual(sixteen);
      expect(parseNamePatterns([...sixteen, '*.x'].join(';'))).toEqual({
        error: { key: 'findInFolder.errorNamesMany', params: { max: 16 } },
      });
      expect(parseNamePatterns('a'.repeat(128))).toEqual(['a'.repeat(128)]);
      expect(parseNamePatterns('a'.repeat(129))).toEqual({ error: { key: 'findInFolder.errorNameLong', params: { max: 128 } } });
    });

    it('refuse a character no file name holds, naming the pattern and the character', () => {
      for (const bad of ['/', '\\', ':', '"', '<', '>', '|']) {
        const result = parseNamePatterns(`ok.nc; a${bad}b.nc`);
        expect(result, bad).toEqual({ error: { key: 'findInFolder.errorNameChar', params: { name: `a${bad}b.nc`, char: ` ${bad}` } } });
      }
      // A control character is named by no letter.
      expect(parseNamePatterns('a\u0001.nc')).toEqual({ error: { key: 'findInFolder.errorNameChar', params: { name: 'a\u0001.nc', char: '' } } });
    });

    it('keep * and ? and a dot as they are', () => {
      expect(parseNamePatterns('*.N?;PART.*;.hidden')).toEqual(['*.N?', 'PART.*', '.hidden']);
    });
  });

  describe('Q2: dates', () => {
    const midnight = (y: number, m: number, d: number): number => new Date(y, m - 1, d).getTime();

    it('are local midnight of the first day and local midnight after the last day', () => {
      expect(dateWindow('2026-10-20', '2026-10-27')).toEqual({ after: midnight(2026, 10, 20), before: midnight(2026, 10, 28) });
      expect(dateWindow('2026-10-27', '2026-10-27')).toEqual({ after: midnight(2026, 10, 27), before: midnight(2026, 10, 28) });
    });

    it('roll over a month and a year end, and over the change of the clock', () => {
      expect(dateWindow('', '2026-12-31')).toEqual({ after: null, before: midnight(2027, 1, 1) });
      expect(dateWindow('', '2026-02-28')).toEqual({ after: null, before: midnight(2026, 3, 1) });
      // The day after the last day is a calendar day, not 24 hours later: 2026-10-25 is 25 hours long in Europe.
      const result = dateWindow('2026-10-25', '2026-10-25');
      expect('before' in result && result.before).toBe(new Date(2026, 9, 26).getTime());
    });

    it('may leave either end open, or both', () => {
      expect(dateWindow('2026-10-20', '')).toEqual({ after: midnight(2026, 10, 20), before: null });
      expect(dateWindow('', '')).toEqual({ after: null, before: null });
    });

    it('refuse an end before the start, and a text that is no day', () => {
      expect(dateWindow('2026-10-27', '2026-10-26')).toEqual({ error: { key: 'findInFolder.errorDateOrder' } });
      for (const bad of ['27.10.2026', '2026-13-01', '2026-02-30', '2026-1-5', 'yesterday']) {
        expect(dateWindow(bad, ''), bad).toEqual({ error: { key: 'findInFolder.errorDate', params: { text: bad } } });
        expect(dateWindow('', bad), bad).toEqual({ error: { key: 'findInFolder.errorDate', params: { text: bad } } });
      }
    });
  });

  describe('Q3: the prefilter', () => {
    it('is the text of a literal query, with the case flag as asked', () => {
      expect(containsFor(query('G43 H1'))).toEqual({ text: 'G43 H1', caseSensitive: false });
      expect(containsFor(query('Ab', { caseSensitive: true }))).toEqual({ text: 'Ab', caseSensitive: true });
    });

    it('is the text of a regular expression that has no syntax in it', () => {
      expect(containsFor(query('M6 T', { regex: true }))).toEqual({ text: 'M6 T', caseSensitive: false });
    });

    it('is none for a regular expression with syntax, a long text or a non-ASCII text', () => {
      expect(containsFor(query('G0?1', { regex: true }))).toBeNull();
      expect(containsFor(query('X.', { regex: true }))).toBeNull();
      expect(containsFor(query('\\d+', { regex: true }))).toBeNull();
      expect(containsFor(query('a'.repeat(257)))).toBeNull();
      expect(containsFor(query('a'.repeat(256)))).toEqual({ text: 'a'.repeat(256), caseSensitive: false });
      expect(containsFor(query('Drehen Müller'))).toBeNull();
      expect(containsFor(query('(Größe)'))).toBeNull();
    });

    it('is none without a query', () => {
      expect(containsFor(null)).toBeNull();
    });

    it('is the address letters only for a word, never the value', () => {
      // T17 is found in "T 17" and "T017": the value is the query's business, not the bytes'.
      expect(containsFor(query('T17', { wholeAddress: true }))).toEqual({ text: 'T', caseSensitive: false });
      expect(containsFor(query('S>12000', { wholeAddress: true }))).toEqual({ text: 'S', caseSensitive: false });
      expect(containsFor(query('SB=500', { wholeAddress: true }))).toEqual({ text: 'SB', caseSensitive: false });
      expect(containsFor(query('X', { wholeAddress: true }))).toEqual({ text: 'X', caseSensitive: false });
    });

    it('drops the digits of an assignment address (Sinumerik S1=…) and the comma of a ,R', () => {
      expect(containsFor(query('S1=500', { wholeAddress: true }))).toEqual({ text: 'S', caseSensitive: false });
      expect(containsFor(query(',R2', { wholeAddress: true }))).toEqual({ text: 'R', caseSensitive: false });
    });

    it('is none for a word on a program-number address: a call (M98 P1234) names the program and holds no O', () => {
      const isProgram = (address: string): boolean => address === 'O';
      expect(containsFor(query('O1234', { wholeAddress: true }), { programAddress: isProgram })).toBeNull();
      expect(containsFor(query('T1', { wholeAddress: true }), { programAddress: isProgram })).toEqual({ text: 'T', caseSensitive: false });
    });
  });

  it('builds the request of the walk from the pieces', () => {
    expect(
      folderRequest('fs-1', { root: '/nc', recursive: false }, ['*.nc'], { after: 5, before: 9 }, { text: 'T', caseSensitive: false }),
    ).toEqual({
      id: 'fs-1',
      root: '/nc',
      recursive: false,
      namePatterns: ['*.nc'],
      modifiedAfter: 5,
      modifiedBefore: 9,
      contains: { text: 'T', caseSensitive: false },
    });
  });
});
