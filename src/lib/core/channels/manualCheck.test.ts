// The manual-check fix round, channels and wait codes (2026-10-25, decisions D2-1, D2-2, D2-4,
// D2-5, D2-7): one regression test per change, each failing without it. The programs are
// synthetic, written for gEdit; the wait shapes are the ones the Okuma OSP programming manual
// and alarm list, the Fanuc 30i manual (alarm 0160, parameter 8103), the Siemens WAITM pages
// and the Nakamura-Tome and Star programming manuals describe.

import { describe, expect, it } from 'vitest';
import { cpOf, profileOf } from '../../../../tests/unit/helpers/profiles';
import { checkSyncMarks, checkSyncMarksReport } from './check';
import { findMarks, resolveDocument } from './marks';
import { alignPanes, waitKey } from './panes';
import type { ChannelParams, SyncFinding, SyncHit, SyncRule } from './types';

function presetOf(profile: string, id: string): ChannelParams {
  const found = profileOf(profile).machineParams?.channels?.presets.find((p) => p.id === id);
  if (!found) throw new Error(`${profile}: no preset ${id}`);
  return found.value;
}

/** One document per channel, read with the preset as it ships, then checked. */
function check(profile: string, p: ChannelParams, program: Record<string, string[]>): SyncFinding[] {
  const cp = cpOf(profile);
  const perChannel: Record<string, SyncHit[]> = {};
  for (const [channel, lines] of Object.entries(program)) perChannel[channel] = findMarks(lines, cp, p, { channelOf: () => channel }).marks;
  return checkSyncMarks(perChannel, p);
}

const okuma = presetOf('okuma-osp', 'okuma-2turret');

/** One Okuma program with G13/G14 sections, read and checked as the channel service does it. */
function okumaCheck(lines: string[], p: ChannelParams = okuma): { findings: SyncFinding[]; marks: SyncHit[] } {
  const r = resolveDocument('PART.MIN', lines, cpOf('okuma-osp'), p);
  const perChannel: Record<string, SyncHit[]> = {};
  for (const hit of r.marks) (perChannel[hit.channel] ??= []).push(hit);
  for (const s of r.sections) perChannel[s.channel.id] ??= [];
  return { findings: checkSyncMarksReport(perChannel, p).findings, marks: r.marks };
}

const brief = (f: SyncFinding[]) => f.map((x) => [x.kind, x.channel, x.line]);

describe('D2-1: the Okuma negative P (P-10) is a wait both turrets need', () => {
  it('P-10 on turret A only is missing on B', () => {
    const { findings, marks } = okumaCheck(['G13', 'G0 X100', 'P-10', 'G14', 'G0 X200']);
    expect(marks.map((m) => [m.ruleId, m.mark, m.channel])).toEqual([['p-negative', 'P-10', 'a']]);
    expect(brief(findings)).toEqual([['missing', 'a', 3]]);
  });

  it('P-10 on both turrets meets, P-010 is P-10, and it is not part of the order', () => {
    const { findings, marks } = okumaCheck(['G13', 'P20', 'P-10', 'P30', 'G14', 'P20', 'P-010', 'P30']);
    expect(marks.filter((m) => m.ruleId === 'p-negative').map((m) => m.channel)).toEqual(['a', 'b']);
    expect(findings).toEqual([]);
  });
});

describe('D2-2: a Fanuc wait compares its P as written', () => {
  const bitmask = presetOf('fanuc-lathe', 'fanuc-2path');
  const digits = presetOf('fanuc-lathe', 'fanuc-2path-digits');

  it('M901 P2 in path 1 (bit sum: path 2 only) does not name path 1', () => {
    const f = check('fanuc-lathe', bitmask, { '1': ['M901 P2'], '2': ['M901 P3'] });
    expect(brief(f)).toEqual([['own-channel-not-named', '1', 1]]);
    expect(f[0].message).toEqual({
      key: 'channels.findings.ownChannelNotNamed',
      params: { mark: 'M901', channel: 'Path 1', names: 'Path 2' },
    });
  });

  it('each path naming only the other is reported in both, never paired as equal', () => {
    const f = check('fanuc-lathe', digits, { '1': ['M901 P2'], '2': ['M901 P1'] });
    expect(brief(f)).toEqual([
      ['own-channel-not-named', '1', 1],
      ['own-channel-not-named', '2', 1],
    ]);
  });

  it('a wrong wait does not take the place of the right one beside it (no false count-mismatch)', () => {
    const f = check('fanuc-lathe', digits, { '1': ['M901 P2', 'M901 P12'], '2': ['M901 P12'] });
    expect(brief(f)).toEqual([['own-channel-not-named', '1', 1]]);
    // The wrong one second: the same single finding, on its own line.
    const g = check('fanuc-lathe', digits, { '1': ['M901 P12', 'M901 P2'], '2': ['M901 P12'] });
    expect(brief(g)).toEqual([['own-channel-not-named', '1', 2]]);
  });

  it('a wrong wait only absorbs the count difference it stands for', () => {
    const f = check('fanuc-lathe', digits, { '1': ['M901 P2'], '2': ['M901 P12', 'M901 P12'] });
    expect(brief(f)).toEqual([
      ['own-channel-not-named', '1', 1],
      ['count-mismatch', '2', 2],
    ]);
    expect(f[1].counts).toEqual({ channel: 2, other: 1 });
  });

  it('the channel view keys them apart, as the check does', () => {
    const cp = cpOf('fanuc-lathe');
    const one = findMarks(['M901 P2'], cp, bitmask, { channelOf: () => '1' }).marks;
    const two = findMarks(['M901 P3'], cp, bitmask, { channelOf: () => '2' }).marks;
    const rule = bitmask.syncMarks[0];
    expect(waitKey(one[0], rule)).not.toBe(waitKey(two[0], rule));
    const panes = [
      { channel: { id: '1', name: 'P1', index: 0 }, lineCount: 1, marks: one },
      { channel: { id: '2', name: 'P2', index: 1 }, lineCount: 1, marks: two },
    ];
    expect(alignPanes(panes, bitmask.syncMarks).states).toEqual([['unmatched'], ['unmatched']]);
    // The same P written alike still lines up.
    const same = findMarks(['M901 P3'], cp, bitmask, { channelOf: () => '1' }).marks;
    expect(waitKey(same[0], rule)).toBe(waitKey(two[0], rule));
  });

  it('is off with samePartners: false', () => {
    const off: ChannelParams = { ...bitmask, syncMarks: bitmask.syncMarks.map((r) => ({ ...r, samePartners: false })) };
    expect(check('fanuc-lathe', off, { '1': ['M901 P2'], '2': ['M901 P3'] })).toEqual([]);
  });
});

describe('D2-4: the Okuma spindle commands and M100', () => {
  it('(c) a spindle command at a P code the other turret lacks is missing', () => {
    const { findings } = okumaCheck(['G13', 'S1500 M42 M03 P10', 'G14', 'G0 X200']);
    expect(brief(findings)).toEqual([['missing', 'a', 2]]);
    expect(findings[0].message.key).toBe('channels.findings.missingWithCode');
  });

  it('(c) the manual\'s own form passes: the spindle command at P10 on A, after P10 on B', () => {
    const program = ['G13', 'G00 X500 Z500', 'S1500 M42 M03 P10', 'G00 X100 Z150', 'G01 Z50 F3.5 P20', 'M05 P40', 'G14', 'G00 X500 Z500 P10', 'S1500 M42 M03', 'G00 X130 Z150 P30', 'G01 X20 F2.5 P40', 'M05'];
    const { findings, marks } = okumaCheck(program);
    expect(marks.filter((m) => m.withCode !== undefined).map((m) => [m.mark, m.withCode])).toEqual([
      ['P10', 'S1500'],
      ['P40', 'M5'],
    ]);
    expect(findings).toEqual([]);
  });

  it('(a) an M100 that meets a P code on the other turret is a warning', () => {
    const { findings } = okumaCheck(['G13', 'P10', 'M100', 'G14', 'M100', 'P10']);
    expect(brief(findings)).toEqual([['meets-other-rule', 'b', 5]]);
    expect(findings[0]).toMatchObject({ severity: 'warning', other: 'a', otherLine: 2 });
    expect(findings[0].message.params).toMatchObject({ mark: 'M100', otherMark: 'P10', channel: 'Turret B', other: 'Turret A' });
    expect(okumaCheck(['G13', 'P10', 'M100', 'G14', 'P10', 'M100']).findings).toEqual([]);
    // Counts that differ are the count finding alone (one defect, one finding).
    expect(brief(okumaCheck(['G13', 'P10', 'M100', 'M100', 'G14', 'M100', 'P10']).findings)).toEqual([['count-mismatch', 'a', 4]]);
    // A P on one side only lets the smaller number pass, as the order rule reads it.
    expect(okumaCheck(['G13', 'P10', 'P20', 'P30', 'M100', 'G14', 'P10', 'P30', 'M100']).findings).toEqual([]);
    // ...and then the larger one waits at its P: an M100 on the other side meets it there.
    expect(brief(okumaCheck(['G13', 'P10', 'P20', 'M100', 'G14', 'P10', 'P30', 'M100']).findings)).toEqual([['meets-other-rule', 'a', 4]]);
  });
});

describe('D2-5: lists, mark numbers, blocks of their own, and a P that belongs to a wait', () => {
  const siemens = presetOf('sinumerik', 'sinumerik-2channel');

  it('SETM(5,6) sets both marks, so WAITM(6,1,2) is answered', () => {
    const marks = findMarks(['SETM(5, 6)', 'CLEARM(5,6)'], cpOf('sinumerik'), siemens, { channelOf: () => '2' }).marks;
    expect(marks.map((m) => [m.ruleId, m.mark])).toEqual([
      ['setm', '5'],
      ['setm', '6'],
      ['clearm', '5'],
      ['clearm', '6'],
    ]);
    expect(check('sinumerik', siemens, { '1': ['WAITM(6,1,2)'], '2': ['SETM(5,6)'] })).toEqual([]);
  });

  it('a WAITM mark number outside 0 to 99 is a warning; a variable is not judged', () => {
    const f = check('sinumerik', siemens, { '1': ['WAITM(100,1,2)', 'WAITM(R1,1,2)'], '2': ['WAITM(100,1,2)', 'WAITM(R1,1,2)'] });
    expect(brief(f)).toEqual([
      ['mark-out-of-range', '1', 1],
      ['mark-out-of-range', '2', 1],
    ]);
    expect(f.every((x) => x.severity === 'warning')).toBe(true);
  });

  it('CODE-9: a negative or fractional WAITM number is out of range; 1. is mark 1; a variable is not judged', () => {
    const waits = (marks: string[]) => marks.map((m) => `WAITM(${m},1,2)`);
    const both = (marks: string[]) => check('sinumerik', siemens, { '1': waits(marks), '2': waits(marks) });
    expect(brief(both(['-1', '1.5']))).toEqual([
      ['mark-out-of-range', '1', 1],
      ['mark-out-of-range', '1', 2],
      ['mark-out-of-range', '2', 1],
      ['mark-out-of-range', '2', 2],
    ]);
    expect(both(['1.', '5', '99', '0', 'R1'])).toEqual([]);
    expect(brief(both(['100']))).toEqual([
      ['mark-out-of-range', '1', 1],
      ['mark-out-of-range', '2', 1],
    ]);
  });

  it('a Fanuc wait that shares its block is a warning; block number, P and a comment are its own', () => {
    const p = presetOf('fanuc-lathe', 'fanuc-2path');
    const f = check('fanuc-lathe', p, { '1': ['G0 X10. M901', 'N20 M902 P3 (WAIT)'], '2': ['M901', 'M902 P3'] });
    expect(brief(f)).toEqual([['shares-block', '1', 1]]);
    expect(f[0].severity).toBe('warning');
    // Okuma P codes share blocks by design.
    expect(okumaCheck(['G13', 'S1500 M42 M03 P10', 'G14', 'G0 X1 P10']).findings).toEqual([]);
  });

  it('CODE-4: the plain shapes read without a pattern give the same "shares its block" answer as the general reading', () => {
    const p = presetOf('fanuc-lathe', 'fanuc-2path');
    const shared = (line: string) => findMarks([line], cpOf('fanuc-lathe'), p, { channelOf: () => '1' }).marks[0]?.shared === true;
    for (const line of ['M901', 'M901 P12', 'M901P12', '  M901  p12  ', '/M901 P12', 'N10 M901 P12', 'M901 P', 'M901 P12 P13', 'M901 (NOTE)', 'M901 P12 (NOTE)']) {
      expect([line, shared(line)]).toEqual([line, false]);
    }
    for (const line of ['G0 X10. M901', 'M901 P12 X5', 'M901 Q3', 'M901 P12 M5', 'M901 P1 2 X5', 'M901 X5 P12', 'S100 M901 P12']) {
      expect([line, shared(line)]).toEqual([line, true]);
    }
  });

  it('a P after a user\'s wait M code on an Okuma is that wait\'s partner word, not an order number', () => {
    const user: SyncRule = {
      id: 'm9',
      label: 'M9xx waits',
      match: { kind: 'codes', codes: 'M900-M999' },
      partners: { kind: 'word', address: 'P', decode: 'digits' },
    };
    const p: ChannelParams = { ...okuma, syncMarks: [...okuma.syncMarks, user] };
    const { marks } = okumaCheck(['G13', 'M901 P12', 'P10', 'G14', 'M901 P12', 'P10'], p);
    expect(marks.map((m) => [m.ruleId, m.mark])).toEqual([
      ['m9', 'M901'],
      ['p-code', 'P10'],
      ['m9', 'M901'],
      ['p-code', 'P10'],
    ]);
  });

  it('CODE-8: a list rule with no mark in it does not swallow a later rule\'s mark on the same line', () => {
    const list: SyncRule = {
      id: 'setm',
      label: 'SETM',
      semantics: 'rendezvous',
      blocking: false,
      match: { kind: 'regex', pattern: 'SETM\\((?<mark>[^)]*)\\)' },
      markSeparator: ',',
      partners: { kind: 'all' },
    };
    const m100: SyncRule = { id: 'm100', label: 'M100', semantics: 'count', match: { kind: 'codes', codes: 'M100' }, partners: { kind: 'all' } };
    const p: ChannelParams = { ...siemens, syncMarks: [list, m100] };
    const marks = findMarks(['SETM(,) M100', 'SETM(,)'], cpOf('sinumerik'), p, { channelOf: () => 'a' }).marks;
    expect(marks.map((m) => [m.ruleId, m.mark, m.line])).toEqual([['m100', '', 1]]);
  });

  it('the three-path builder preset says when M198 is a wait', () => {
    expect(profileOf('fanuc-lathe').machineParams?.channels?.presets.find((x) => x.id === 'fanuc-3path-digits-nop12')?.label).toMatch(
      /M198 counts as a wait only if .*parameter 6030/,
    );
  });
});

describe('D2-7: the Nakamura-Tome and Star presets', () => {
  const cp = cpOf('fanuc-lathe');

  it('Nakamura-Tome two units: M100-M199 without P wait for both', () => {
    const p = presetOf('fanuc-lathe', 'fanuc-nakamura-2unit');
    expect(findMarks(['M100', 'M199', 'M200', 'M99'], cp, p, { channelOf: () => '1' }).marks.map((m) => [m.mark, m.partners])).toEqual([
      ['M100', ['1', '2']],
      ['M199', ['1', '2']],
    ]);
    expect(check('fanuc-lathe', p, { '1': ['M100', 'M101'], '2': ['M100', 'M102'] }).map((f) => f.kind)).toContain('missing');
  });

  it('Nakamura-Tome three units: the manual\'s example passes, a wait without P does not', () => {
    const p = presetOf('fanuc-lathe', 'fanuc-nakamura-3unit-digits');
    const program = {
      '1': ['M100P12', 'M100P13', 'M103P123'],
      '2': ['M100P12', 'M102P23', 'M103P123'],
      '3': ['M100P13', 'M102P23', 'M103P123'],
    };
    expect(check('fanuc-lathe', p, program)).toEqual([]);
    expect(brief(check('fanuc-lathe', p, { '1': ['M100'], '2': ['M100'], '3': [] }))).toEqual([
      ['unmatched', '1', 1],
      ['unmatched', '2', 1],
    ]);
  });

  it('Star two heads: M200-M999 are waits, M199 and M40 are not', () => {
    const p = presetOf('fanuc-lathe', 'fanuc-star-2head');
    expect(findMarks(['M40', 'M199', 'M200', 'M999'], cp, p, { channelOf: () => '2' }).marks.map((m) => m.mark)).toEqual(['M200', 'M999']);
    expect(check('fanuc-lathe', p, { '1': ['M200', 'M300'], '2': ['M200', 'M300'] })).toEqual([]);
  });
});
