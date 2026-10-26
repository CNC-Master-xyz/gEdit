// Sync marks (plan §7.17, WP12.1 deliver, R5; written by P12, extended by WP12.1): the rule
// kinds, the partner readings, what is never guessed, the caps, the budget and the 300k-line
// resolution.

import { describe, expect, it } from 'vitest';
import { fanucWait, singleFile as single } from '../../../../tests/unit/helpers/channelRules';
import { cpOf, profileOf } from '../../../../tests/unit/helpers/profiles';
import fanucCodes from '$lib/data/codes/fanuc.json';
import okumaCodes from '$lib/data/codes/okuma.json';
import { decodePartnerText, findMarks, macroCallCodes, resolveDocument } from './marks';
import { STOPS_AND_ENDS_RULE, type ChannelParams, type SyncRule } from './types';

const lathe = cpOf('fanuc-lathe');
const sinumerik = cpOf('sinumerik');

const three = (rules: SyncRule[], over: Partial<ChannelParams> = {}): ChannelParams => ({
  layout: 'multi-file',
  list: [
    { id: '1', name: 'Path 1' },
    { id: '2', name: 'Path 2' },
    { id: '3', name: 'Path 3', aliases: ['P3X'] },
  ],
  syncMarks: rules,
  ...over,
});

const run = (lines: string[], p: ChannelParams, cp = lathe) => findMarks(lines, cp, p, { channelOf: () => '1' }).marks;

describe('decodePartnerText (R5)', () => {
  it('reads digits as path numbers, 0 as path 10, and skips a leading 0', () => {
    expect(decodePartnerText('123', 'digits')).toEqual(['1', '2', '3']);
    expect(decodePartnerText('321', 'digits')).toEqual(['3', '2', '1']);
    expect(decodePartnerText('103579', 'digits')).toEqual(['1', '10', '3', '5', '7', '9']);
    expect(decodePartnerText('013579', 'digits')).toEqual(['1', '3', '5', '7', '9']);
  });
  it('reads a bit sum', () => {
    expect(decodePartnerText('7', 'bitmask')).toEqual(['1', '2', '3']);
    expect(decodePartnerText('341', 'bitmask')).toEqual(['1', '3', '5', '7', '9']);
    expect(decodePartnerText('0', 'bitmask')).toEqual([]);
  });
  it('keeps what it cannot read as one piece', () => {
    expect(decodePartnerText('#1', 'digits')).toEqual(['#1']);
    expect(decodePartnerText('99999999999', 'bitmask')).toEqual(['99999999999']);
  });
  it('splits, trims and drops empty pieces', () => {
    expect(decodePartnerText(' 1, WAIT_K2 ,', 'split')).toEqual(['1', 'WAIT_K2']);
  });
});

describe('findMarks', () => {
  it('reads Fanuc wait M-codes with a digit P word, packed or spaced', () => {
    const marks = run(['N10M901P123', 'N20 M902 P12', 'M903', 'G0 X1'], three([fanucWait('digits', { kind: 'fixed', channels: ['1', '2'] })]));
    expect(marks.map((m) => [m.mark, m.line, m.partners])).toEqual([
      ['M901', 1, ['1', '2', '3']],
      ['M902', 2, ['1', '2']],
      ['M903', 3, ['1', '2']],
    ]);
  });

  it('gives a P-less wait no partner by default and keeps an undeclared path', () => {
    const marks = run(['M901', 'M902 P14'], three([fanucWait('digits')]));
    expect(marks.map((m) => m.partners)).toEqual([[], ['1', '4']]);
  });

  it('reads a bit-sum P word', () => {
    expect(run(['M901 P5'], three([fanucWait('bitmask')]))[0].partners).toEqual(['1', '3']);
  });

  it('ignores a wait in a comment', () => {
    expect(run(['(M901 P12)', 'G0 X1 (M902)'], three([fanucWait('digits')]))).toEqual([]);
  });

  it('lets the first rule own a line, and carries blocking and count rules', () => {
    const rules: SyncRule[] = [
      { id: 'count', label: 'c', semantics: 'count', match: { kind: 'codes', codes: 'M100' }, partners: { kind: 'all' } },
      { id: 'flag', label: 'f', blocking: false, match: { kind: 'prefix', prefix: 'M1', idDigits: { min: 2, max: 2 } }, partners: { kind: 'fixed', channels: ['P3X'] } },
    ];
    const marks = run(['M100', 'M101', 'M1001'], three(rules));
    expect(marks.map((m) => [m.ruleId, m.mark, m.partners, m.blocking])).toEqual([
      ['count', '', ['1', '2', '3'], true],
      ['flag', '01', ['3'], false],
    ]);
  });

  it('reads a WAITM line through split partners and aliases, never a string', () => {
    const rule: SyncRule = {
      id: 'waitm',
      label: 'w',
      match: { kind: 'regex', pattern: '\\bWAITMC?\\s*\\(\\s*(?<mark>\\d+)' },
      partners: { kind: 'line', pattern: '\\bWAITMC?\\s*\\(\\s*\\d+\\s*,(?<channels>[^)]*)\\)' },
    };
    const p = three([rule], { list: [{ id: '1', name: 'A', aliases: ['WAIT_K1'] }, { id: '2', name: 'B', aliases: ['WAIT_K2'] }] });
    const marks = run(['NN10: WAITM(10, WAIT_K1, WAIT_K2)', 'MSG("WAITM(11,1,2)")', '; WAITM(12,1,2)'], p, sinumerik);
    expect(marks.map((m) => [m.mark, m.partners])).toEqual([['10', ['1', '2']]]);
  });

  it('adds the profile’s stops and ends when stopsAndEndsWait is set', () => {
    const p = three([], { stopsAndEndsWait: true });
    const marks = run(['G0 X1', 'M01', 'M30'], p);
    expect(marks.map((m) => [m.ruleId, m.line, m.partners])).toEqual([
      [STOPS_AND_ENDS_RULE, 2, ['1', '2', '3']],
      [STOPS_AND_ENDS_RULE, 3, ['1', '2', '3']],
    ]);
    expect(run(['M30'], three([]))).toEqual([]);
  });

  it('keys each mark to the channel of its line', () => {
    const marks = findMarks(['M901 P12', 'X1', 'M902 P12'], lathe, three([fanucWait('digits')]), {
      channelOf: (line) => (line === 1 ? '' : '2'),
    }).marks;
    expect(marks.map((m) => m.channel)).toEqual(['', '2']);
  });

  it('keeps 20,000 marks and counts the rest', () => {
    const lines = Array.from({ length: 20_005 }, () => 'M901 P12');
    const r = findMarks(lines, lathe, three([fanucWait('digits')]), { channelOf: () => '1' });
    expect(r.marks).toHaveLength(20_000);
    expect(r.dropped).toBe(5);
  });

  it('finds nothing with a rule that does not compile', () => {
    const bad: SyncRule = { id: 'x', label: 'x', match: { kind: 'regex', pattern: '(?<mark>' }, partners: { kind: 'all' } };
    expect(run(['M901'], three([bad]))).toEqual([]);
  });
});

describe('findMarks, WP12.1: a wait is read as the control reads it, or not at all', () => {
  const digits = three([fanucWait('digits', { kind: 'fixed', channels: ['1', '2'] })]);

  it('reads M0901, M 901 and m901 as the one wait M901', () => {
    expect(run(['M0901 P12', 'M 901 P12', 'm901p12', 'N10M901P12'], digits).map((m) => m.mark)).toEqual(['M901', 'M901', 'M901', 'M901']);
  });

  it('never reads a decimal, a longer number, an assignment or a variable as a wait', () => {
    expect(run(['M901.5 P12', 'M9010 P12', 'M901=1', '#901=12', 'M[901] P12', 'XM901 P12'], digits)).toEqual([]);
  });

  it('makes a P word it cannot read one unknown piece, never "no P"', () => {
    const marks = run(['M901 P12.', 'M902 P#1', 'M903 P[#5]', 'M904 P', 'M905 P12 P13', 'M906 P12 P12', 'M907 P1=2'], digits);
    expect(marks.map((m) => [m.mark, m.partners])).toEqual([
      ['M901', ['P12.']],
      ['M902', ['P#1']],
      ['M903', ['P[#5]']],
      ['M904', ['P']],
      ['M905', ['P12 P13']],
      ['M906', ['1', '2']],
      ['M907', ['1', '2']],
    ]);
  });

  it('reads the P word after a comment, and not one inside it', () => {
    expect(run(['M901 (WAIT) P13', 'M902 (P13)'], digits).map((m) => m.partners)).toEqual([
      ['1', '3'],
      ['1', '2'],
    ]);
  });

  it('reads a prefix rule with and without idDigits, never an assignment', () => {
    const rule = (idDigits?: { min: number; max: number }): SyncRule => ({ id: 'p', label: 'p', match: { kind: 'prefix', prefix: 'M1', idDigits }, partners: { kind: 'all' } });
    expect(run(['M130', 'M1305', 'M13', 'M1=5'], three([rule()])).map((m) => m.mark)).toEqual(['30', '305', '3']);
    expect(run(['M130', 'M1305', 'M13', 'M130.5'], three([rule({ min: 2, max: 2 })])).map((m) => m.mark)).toEqual(['30']);
  });

  it('runs an id-less count regex without a mark capture, and finds nothing for another kind without one', () => {
    const count: SyncRule = { id: 'c', label: 'c', semantics: 'count', match: { kind: 'regex', pattern: '\\bM100\\b' }, partners: { kind: 'all' } };
    const rendezvous: SyncRule = { ...count, semantics: 'rendezvous' };
    expect(run(['M100', 'M1000'], three([count])).map((m) => [m.ruleId, m.mark])).toEqual([['c', '']]);
    expect(run(['M100'], three([rendezvous]))).toEqual([]);
  });

  it('decodes line partners as digits or a bit sum, keeps an undeclared piece, and applies whenAbsent', () => {
    const line = (decode: 'digits' | 'bitmask' | 'split', whenAbsent?: SyncRule['partners'] extends infer P ? (P extends { kind: 'line'; whenAbsent?: infer W } ? W : never) : never): SyncRule => ({
      id: 'l',
      label: 'l',
      match: { kind: 'regex', pattern: '(?<![A-Z])(?<mark>M9\\d\\d)(?!\\d)' },
      partners: { kind: 'line', pattern: '(?<![A-Z])P(?<channels>\\d+)', decode, whenAbsent },
    });
    expect(run(['M901 P13', 'M902'], three([line('digits')])).map((m) => m.partners)).toEqual([['1', '3'], []]);
    expect(run(['M901 P5', 'M902'], three([line('bitmask', { kind: 'all' })])).map((m) => m.partners)).toEqual([
      ['1', '3'],
      ['1', '2', '3'],
    ]);
    expect(run(['M901 P4'], three([line('split', { kind: 'fixed', channels: ['P3X'] })]))[0].partners).toEqual(['4']);
  });

  it('lists a mark of a shared section once per channel, each with its own partners array', () => {
    const r = findMarks(['M901 P12', 'X1', 'M902 P12'], lathe, digits, { channelOf: (line) => (line === 1 ? ['1', '3'] : []) });
    expect(r.marks.map((m) => [m.mark, m.channel])).toEqual([
      ['M901', '1'],
      ['M901', '3'],
      ['M902', ''],
    ]);
    expect(r.marks[0].partners).not.toBe(r.marks[1].partners);
    r.marks[0].partners.push('x');
    expect(r.marks[1].partners).toEqual(['1', '2']);
  });

  it('gives up past its deadline and says so', () => {
    let t = 0;
    const lines = Array.from({ length: 5000 }, () => 'M901 P12');
    const r = findMarks(lines, lathe, digits, { channelOf: () => '1', deadline: 10, now: () => (t += 20) });
    expect(r.abandoned).toBe(true);
    // M12 review fix CODE-1: the deadline is read on every line, so the read stops after the
    // first line once the clock is past it (it used to run on to line 1,024).
    expect(r.marks.length).toBe(1);
  });

  it('reads the real wait shapes with the three-path preset as it ships', () => {
    const preset = profileOf('fanuc-lathe').machineParams?.channels?.presets.find((x) => x.id === 'fanuc-3path-digits');
    expect(preset).toBeDefined();
    const marks = run(['N10 M901P123', 'M902 P12', 'M903 P31', 'M904', 'M905P3.'], preset!.value);
    expect(marks.map((m) => [m.mark, m.partners])).toEqual([
      ['M901', ['1', '2', '3']],
      ['M902', ['1', '2']],
      ['M903', ['3', '1']],
      ['M904', []],
      ['M905', ['P3.']],
    ]);
  });
});

describe('resolveDocument', () => {
  it('answers none, with no marks, for a program with no section', () => {
    const r = resolveDocument('a.nc', ['O5555', 'M901 P12', 'M30'], lathe, single);
    expect([r.layout, r.marks, r.problems]).toEqual(['none', [], []]);
  });

  it('keys each mark to the channel of its line and a mark outside to no channel', () => {
    const r = resolveDocument('a.nc', ['O1001', 'M901 P12', 'M99', 'M902 P12', 'O2001', 'M901 P12', 'M30'], lathe, single);
    expect(r.layout).toBe('single-file');
    expect(r.marks.map((m) => [m.mark, m.line, m.channel])).toEqual([
      ['M901', 2, '1'],
      ['M902', 4, ''],
      ['M901', 6, '2'],
    ]);
    expect(r.outside).toEqual([{ startLine: 4, endLine: 4 }]);
  });

  it('answers none past the deadline', () => {
    let t = 0;
    const lines = Array.from({ length: 5000 }, (_, i) => (i === 0 ? 'O1001' : 'M901 P12'));
    const r = resolveDocument('a.nc', lines, lathe, single, { deadline: 10, now: () => (t += 20) });
    expect([r.layout, r.abandoned, r.marks]).toEqual(['none', true, []]);
  });

  it('lets the user’s assignment win in multi-file, and ignores one that names no channel', () => {
    const multi: ChannelParams = { ...single, layout: 'multi-file', fileName: '^(?<stem>.+)_CH(?<channel>\\d)\\.nc$' };
    expect(resolveDocument('a_CH1.nc', ['M901 P12'], lathe, multi, { assigned: '2' })).toMatchObject({ layout: 'multi-file', self: { id: '2' }, by: 'assigned' });
    expect(resolveDocument('a_CH1.nc', ['M901 P12'], lathe, multi, { assigned: '7' })).toMatchObject({ self: { id: '1' }, by: 'fileName' });
    expect(resolveDocument('loose.nc', ['M901 P12'], lathe, multi).layout).toBe('none');
  });
});

// T172 (review NC-05): a wait code written after a macro call is an argument of the call.
describe('a wait code after a macro call (T172)', () => {
  const calls = macroCallCodes(fanucCodes);
  const withCalls = (lines: string[], p: ChannelParams, cp = lathe, c: readonly string[] = calls) =>
    findMarks(lines, cp, p, { channelOf: () => '1', calls: c }).marks;

  it('reads the macro-call codes from the database flag, not from a list of its own', () => {
    expect(calls).toEqual(['G65']);
    // Okuma's G65 is a corner control, not a call: no flag, no call code. Merge seam (v12/wave): P4b flags
    // Okuma's CALL and MODIN (programs run with the words of their block), so those two are listed; being
    // keywords, not a letter and a number, they hide no wait word (the test below with `G65 M901`).
    expect(macroCallCodes(okumaCodes)).toEqual(['CALL', 'MODIN']);
    expect(macroCallCodes(okumaCodes)).not.toContain('G65');
    expect(macroCallCodes(null)).toEqual([]);
  });

  it('does not read G65 P9010 M901 as a wait, however the call is written', () => {
    const p = three([fanucWait('digits')]);
    expect(run(['G65 P9010 M901'], p).map((m) => m.mark)).toEqual(['M901']); // without the calls: the old reading
    expect(withCalls(['G65 P9010 M901', 'N10 G065 P9010 M902', 'g 65 p9010 m903', 'G65P9010M904L2'], p)).toEqual([]);
  });

  it('keeps a wait in front of the call, a wait on a line without one, and a call in a comment', () => {
    const p = three([fanucWait('digits')]);
    const marks = withCalls(['M901 G65 P9010 M902', 'M903 P12', '(G65 P9010) M904', 'G65.1 M905', 'G650 M906', 'G65=1 M907'], p);
    expect(marks.map((m) => [m.mark, m.line])).toEqual([
      ['M901', 1],
      ['M903', 2],
      ['M904', 3],
      ['M905', 4],
      ['M906', 5],
      ['M907', 6],
    ]);
  });

  it('holds for a prefix rule and for a pattern that reads the line from its start', () => {
    const prefix: SyncRule = { id: 'pre', label: 'p', match: { kind: 'prefix', prefix: 'M1', idDigits: { min: 2, max: 2 } }, partners: { kind: 'all' } };
    expect(withCalls(['G65 P9010 M130', 'M131 G65 P9010'], three([prefix])).map((m) => m.mark)).toEqual(['31']);
    const fromStart: SyncRule = { id: 'rx', label: 'r', match: { kind: 'regex', pattern: '^.*?M(?<mark>9\\d\\d)' }, partners: { kind: 'all' } };
    expect(withCalls(['G65 P9010 M901', 'M902 G65 P9010'], three([fromStart])).map((m) => m.mark)).toEqual(['902']);
  });

  it('gives the line to the next rule when the first rule\'s mark is an argument', () => {
    const args: SyncRule = { id: 'late', label: 'l', match: { kind: 'codes', codes: 'M950-M959' }, partners: { kind: 'all' } };
    const front: SyncRule = { id: 'front', label: 'f', match: { kind: 'codes', codes: 'M100' }, partners: { kind: 'all' } };
    expect(withCalls(['M100 G65 P9010 M950'], three([args, front])).map((m) => [m.ruleId, m.mark])).toEqual([['front', 'M100']]);
  });

  it('leaves a control without a call code as it was (Okuma: G65 is no call)', () => {
    expect(withCalls(['G65 M901'], three([fanucWait('digits')]), lathe, macroCallCodes(okumaCodes)).map((m) => m.mark)).toEqual(['M901']);
  });

  it('holds for a stop or end that waits: G65 P9010 M30 hands M30 to the macro (the owner, 2026-10-19)', () => {
    const p = three([fanucWait('digits')], { stopsAndEndsWait: true });
    const lines = ['G65 P9010 M30', 'M30', 'M0 G65 P9010', 'G65 P9010 M1', '(G65 P9010) M30', 'G65 P9010 M99'];
    expect(run(lines, p).map((m) => m.line)).toEqual([1, 2, 3, 4, 5, 6]); // without the calls: the old reading
    expect(withCalls(lines, p).map((m) => [m.ruleId, m.line])).toEqual([
      [STOPS_AND_ENDS_RULE, 2],
      [STOPS_AND_ENDS_RULE, 3],
      [STOPS_AND_ENDS_RULE, 5],
    ]);
  });

  it('reads a stop or end pattern that starts at the line start by where the code ends', () => {
    // Okuma's end pattern reads from the line start (`NEND ... M02`); G65 stands in for a call code here.
    const okuma = cpOf('okuma-osp');
    const p = three([], { stopsAndEndsWait: true });
    expect(withCalls(['NEND G65 P1 M02', 'NEND M02 G65 P1'], p, okuma).map((m) => m.line)).toEqual([2]);
    expect(run(['NEND G65 P1 M02'], p, okuma).map((m) => m.line)).toEqual([1]);
  });

  it('is handed through resolveDocument', () => {
    const lines = ['O1001', 'G65 P9010 M901', 'M902 P12', 'M99', 'O2001', 'M902 P12', 'M30'];
    expect(resolveDocument('', lines, lathe, single).marks.map((m) => m.mark)).toEqual(['M901', 'M902', 'M902']);
    expect(resolveDocument('', lines, lathe, single, { calls }).marks.map((m) => [m.mark, m.line, m.channel])).toEqual([
      ['M902', 3, '1'],
      ['M902', 6, '2'],
    ]);
  });
});
