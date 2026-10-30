// T210 (owner rule of 2026-10-27: "a value is treated as a feed only when the data marks it").
// The code database marks every parameter that is a feed rate with `unit: 'feed'` (or a fixed
// feed unit such as Okuma `G101`'s feed per minute), and Scale feed rates no longer reads the
// English label. This pins the decisions: every parameter whose label speaks of a feed is either
// marked or listed below with the reason it is none, so a new entry cannot slip in unmarked.
// The manual sources of the non-obvious calls are in the batch report (plan §7).

import { describe, expect, it } from 'vitest';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { lookupCode } from '$lib/core/codes/lookup';
import { resolveCodeDbs } from '$lib/core/codes/resolve';
import type { CodeEntry, CodeParam } from '$lib/core/codes/types';

const RAW = BUILTIN_CODE_DB_JSON as Record<string, { codes?: CodeEntry[] }>;
const LOADED = resolveCodeDbs(BUILTIN_CODE_DB_JSON);

/** The units that make a parameter a feed rate (`scale_feed.PARAM_FEED_UNITS`). */
const FEED_UNITS = ['feed', 'feedPerMin'];

/** Parameters whose label speaks of a feed and that are no feed rate, with the reason. */
const NOT_A_FEED: Record<string, string> = {
  // The R point of the Fanuc drilling cycles is a position: where the feed starts.
  ...Object.fromEntries(
    ['G73', 'G74', 'G76', 'G81', 'G82', 'G83', 'G84', 'G84.2', 'G84.3', 'G85', 'G86', 'G88', 'G89'].map((code) => [
      `fanuc ${code} R`,
      'a position',
    ]),
  ),
  // A factor of the feed for the first peck: it follows the feed it multiplies.
  'sinumerik CYCLE83 FRF': 'a factor',
  // Digit-coded modes whose label mentions a feed: counts.
  'sinumerik CYCLE82 _AMODE': 'a count',
  'sinumerik CYCLE82 _VARI': 'a count',
  'sinumerik POCKET3 _DMODE': 'a count',
  'sinumerik POCKET4 _DMODE': 'a count',
  'sinumerik CYCLE72 _DMODE': 'a count',
};

const FEED_LABEL = /\bfeed/i;

function* params(): Generator<[string, CodeEntry, CodeParam]> {
  for (const [dialect, db] of Object.entries(RAW)) {
    for (const entry of db.codes ?? []) {
      for (const param of entry.params ?? []) yield [dialect, entry, param];
    }
  }
}

describe('the feed marker (T210)', () => {
  it('marks every parameter whose label speaks of a feed, or says why it is none', () => {
    const unmarked: string[] = [];
    const stale: string[] = [];
    for (const [dialect, entry, param] of params()) {
      if (!FEED_LABEL.test(param.label ?? '')) continue;
      const key = `${dialect} ${entry.code} ${param.address}`;
      const marked = FEED_UNITS.includes(param.unit ?? '');
      if (!marked && !(key in NOT_A_FEED)) unmarked.push(key);
      if (marked && key in NOT_A_FEED) stale.push(key);
    }
    expect(unmarked).toEqual([]);
    expect(stale).toEqual([]);
  });

  it('marks no parameter whose label does not speak of a feed (no lead, no inverse time)', () => {
    for (const [dialect, entry, param] of params()) {
      if (param.unit !== 'feed') continue;
      expect(FEED_LABEL.test(param.label ?? ''), `${dialect} ${entry.code} ${param.address}`).toBe(true);
    }
  });

  it('counts the marks per database', () => {
    const counts: Record<string, number> = {};
    for (const [dialect, , param] of params()) if (param.unit === 'feed') counts[dialect] = (counts[dialect] ?? 0) + 1;
    expect(counts).toEqual({
      fanuc: 15,
      'fanuc-lathe': 13,
      'fanuc-lathe-b': 6,
      heidenhain: 63,
      // Owner 2026-10-30: G181, G182, G183 and G189 moved to feedPerMin (LG33-019-R22 p.210).
      okuma: 9,
      sinumerik: 31,
    });
  });

  it('keeps the marker through the loader, and leaves the leads and the non-feeds alone', () => {
    const unit = (dialect: string, code: string, address: string, block?: number) =>
      lookupCode(LOADED[dialect], code)?.params?.find((p) => p.address === address && (block === undefined || p.block === block))?.unit;
    expect(unit('heidenhain', 'CYCL DEF 200', 'Q206')).toBe('feed');
    expect(unit('sinumerik-mill', 'CYCLE85', 'FFR')).toBe('feed');
    expect(unit('sinumerik-mill', 'CYCLE83', 'FRF')).toBeUndefined();
    expect(unit('fanuc-lathe', 'G71', 'F', 2)).toBe('feed');
    expect(unit('fanuc-lathe', 'G32', 'F')).toBe('feedPerRev');
    expect(unit('fanuc', 'G81', 'F')).toBe('feed');
    expect(unit('fanuc', 'G81', 'R')).toBeUndefined();
    expect(unit('okuma', 'G101', 'F')).toBe('feedPerMin');
    for (const code of ['G181', 'G182', 'G183', 'G189']) expect(unit('okuma', code, 'F'), code).toBe('feedPerMin');
    expect(unit('okuma', 'G184', 'F')).toBe('feed');
    expect(unit('okuma', 'G84', 'FA')).toBe('feed');
  });
});
