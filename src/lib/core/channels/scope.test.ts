// Channel scope (P4.31, plan section 6.8.6; rules S1 to S4 in `scope.ts`).

import { describe, expect, it } from 'vitest';
import { hasKey, t } from '$lib/i18n';
import { TOY_PROGRAM, toySet } from './paneFixtures';
import { channelNameOf, cutLines, scopableChannels, scopeOf, setOfLines } from './scope';
import type { ChannelParams, ChannelSet } from './types';
import { cpOf } from '../../../../tests/unit/helpers/profiles';

const params = { layout: 'single-file', list: [1, 2, 3, 4].map((n) => ({ id: String(n), name: `Channel ${n}` })) } as ChannelParams;

function fileSet(selfId: string | null): ChannelSet {
  return {
    layout: 'multi-file',
    self: selfId === null ? null : { id: selfId, name: `Channel ${selfId}`, index: Number(selfId) - 1 },
    members: [],
    missing: [],
    outside: [],
    marks: [],
    problems: [],
    truncated: false,
  };
}

describe('scopeOf', () => {
  it('S1: a section channel is its ranges, in document order', () => {
    const scope = scopeOf(toySet(TOY_PROGRAM), '1', 'prog.nc');
    expect(scope).toEqual({ ok: true, ranges: [{ startLine: 3, endLine: 5 }, { startLine: 8, endLine: 9 }] });
  });

  it('S1: a declared channel with no section is refused in plain words, not read as empty', () => {
    const scope = scopeOf(toySet(TOY_PROGRAM), '3', 'prog.nc');
    expect(scope).toEqual({ ok: false, why: { key: 'channelScope.noSection', params: { document: 'prog.nc', channel: 'Channel 3' } } });
  });

  it('S2: a channel file is its whole document when it is that channel, else refused', () => {
    expect(scopeOf(fileSet('2'), '2', 'c2.nc')).toEqual({ ok: true, ranges: null });
    expect(scopeOf(fileSet('2'), '1', 'c2.nc')).toEqual({
      ok: false,
      why: { key: 'channelScope.otherChannel', params: { document: 'c2.nc', channel: '1', other: 'Channel 2' } },
    });
    // The caller can give the machine's name for the channel asked for.
    expect(scopeOf(fileSet('2'), '1', 'c2.nc', 'Path 1')).toMatchObject({ why: { params: { channel: 'Path 1' } } });
    expect(scopeOf(fileSet(null), '1', 'x.nc')).toEqual({ ok: false, why: { key: 'channelScope.unknownChannel', params: { document: 'x.nc' } } });
  });

  it('S3: no channels, or a resolution that ran out of its time', () => {
    const none: ChannelSet = { ...fileSet(null), layout: 'none' };
    expect(scopeOf(none, '1', 'a.nc')).toEqual({ ok: false, why: { key: 'channelScope.noChannels', params: { document: 'a.nc' } } });
    const slow: ChannelSet = { ...none, problems: [{ path: '', message: { key: 'channels.problems.tooSlow' } }] };
    expect(scopeOf(slow, '1', 'a.nc')).toEqual({ ok: false, why: { key: 'channels.problems.tooSlow' } });
  });

  it('every refusal has a message', () => {
    for (const key of ['noChannels', 'noSection', 'otherChannel', 'unknownChannel']) {
      expect(hasKey(`channelScope.${key}`), key).toBe(true);
    }
    expect(t('channelScope.noSection', { document: 'prog.nc', channel: 'Path 2' })).toBe('prog.nc has no lines of Path 2.');
  });

  it('names a channel as the machine does', () => {
    expect(channelNameOf(toySet(TOY_PROGRAM), '2')).toBe('Channel 2');
    expect(channelNameOf(toySet(TOY_PROGRAM), '4')).toBe('Channel 4');
    expect(channelNameOf(toySet(TOY_PROGRAM), 'zz')).toBe('zz');
  });
});

describe('scopableChannels', () => {
  it('lists the declared channels the program has, in the machine s order', () => {
    const set = toySet(['%', '$2', 'B', '$1', 'A']);
    expect(scopableChannels(set, params)).toEqual([{ id: '1', name: 'Channel 1' }, { id: '2', name: 'Channel 2' }]);
  });

  it('is empty for a program without channels and for a machine without channel rules', () => {
    expect(scopableChannels({ ...fileSet(null), layout: 'none' }, params)).toEqual([]);
    expect(scopableChannels(toySet(TOY_PROGRAM), null)).toEqual([]);
  });

  it('offers a channel file its own channel only', () => {
    expect(scopableChannels(fileSet('3'), params)).toEqual([{ id: '3', name: 'Channel 3' }]);
  });
});

describe('cutLines', () => {
  it('S4: keeps the lines of the ranges and the file s line of each', () => {
    const cut = cutLines(TOY_PROGRAM, [{ startLine: 8, endLine: 9 }, { startLine: 3, endLine: 5 }]);
    expect(cut.lines).toEqual(['$1', 'A1', 'A2', '$1', 'A3']);
    expect([...cut.fileLines]).toEqual([3, 4, 5, 8, 9]);
  });

  it('null is the whole document, and ranges are clipped to it', () => {
    expect(cutLines(['a', 'b'], null).lines).toEqual(['a', 'b']);
    expect([...cutLines(['a', 'b'], null).fileLines]).toEqual([1, 2]);
    expect(cutLines(['a', 'b'], [{ startLine: 2, endLine: 40 }]).lines).toEqual(['b']);
    expect(cutLines(['a', 'b'], []).lines).toEqual([]);
  });
});

describe('setOfLines', () => {
  it('reads a program for channels with the machine s rules, and says none without them', () => {
    const cp = cpOf('fanuc-lathe');
    const withSections: ChannelParams = { ...params, sectionStart: '^\\$(?<channel>[1-4])$' };
    const set = setOfLines(TOY_PROGRAM, cp, withSections, undefined, 'd1');
    expect(set.layout).toBe('single-file');
    expect(set.members.map((m) => [m.channel.id, m.kind === 'section' ? m.ranges : null])).toEqual([
      ['1', [{ startLine: 3, endLine: 5 }, { startLine: 8, endLine: 9 }]],
      ['2', [{ startLine: 6, endLine: 7 }, { startLine: 10, endLine: 11 }]],
    ]);
    expect(setOfLines(TOY_PROGRAM, cp, null, undefined).layout).toBe('none');
    expect(setOfLines(TOY_PROGRAM, cp, { ...withSections, layout: 'multi-file' }, undefined).layout).toBe('none');
  });
});
