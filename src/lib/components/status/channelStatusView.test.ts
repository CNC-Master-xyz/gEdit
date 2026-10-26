// The words of the channel status item (`channelStatusView`), without a DOM.

import { describe, expect, it } from 'vitest';
import type { ChannelParams, ChannelProblem, ChannelRef, ChannelSet } from '$lib/core/channels/types';
import { channelStatusView } from './channelStatusView';

const A: ChannelRef = { id: '1', name: 'Turret A', index: 0 };
const B: ChannelRef = { id: '2', name: 'Turret B', index: 1 };
const params = (layout: 'single-file' | 'multi-file') =>
  ({ layout, list: [{ id: '1', name: 'Turret A' }, { id: '2', name: 'Turret B' }], syncMarks: [] }) as unknown as ChannelParams;
const notFound: ChannelProblem = { path: 'list[1]', message: { key: 'channels.problems.channelNotFound', params: { channel: 'Turret B' } } };

/** A twin-turret machine and a one-turret program: one `G13` section, no `G14` (T127). */
function oneTurret(ranges: { startLine: number; endLine: number }[], problems: ChannelProblem[] = [notFound]): ChannelSet {
  return {
    layout: 'single-file',
    self: null,
    members: [{ kind: 'section', channel: A, docId: 'd1', ranges }],
    missing: [B],
    outside: [{ startLine: 1, endLine: 4 }],
    marks: [],
    problems,
    truncated: false,
  } as unknown as ChannelSet;
}

const view = (set: ChannelSet, layout: 'single-file' | 'multi-file' = 'single-file') =>
  channelStatusView({ set, params: params(layout), unassigned: false, cursorLine: 10, channelAt: (line) => (line >= 5 ? A : null) });

describe('channelStatusView', () => {
  it('on one program with sections, a channel without a section is information: "not used in this program", said once (T127)', () => {
    const v = view(oneTurret([{ startLine: 5, endLine: 20 }]));
    expect(v?.label).toBe('Channel: Turret A');
    expect(v?.broken).toBe(false);
    expect(v?.tooltip.split('\n')).toEqual(['One program holds all the channels.', 'Turret A: in this program, 1 section', 'Turret B: not used in this program']);
    expect(v?.tooltip).not.toContain('not found');
    expect(v?.tooltip).not.toContain('has no section');
  });

  it('counts the sections in the right number (one section, two sections)', () => {
    const two = view(oneTurret([{ startLine: 5, endLine: 9 }, { startLine: 12, endLine: 20 }]));
    expect(two?.tooltip).toContain('Turret A: in this program, 2 sections');
  });

  it('still lists the other problems of one program with sections', () => {
    const odd: ChannelProblem = { path: 'line:7', message: { key: 'channels.problems.unknownChannel', params: { line: 7, token: 'G15' } } };
    const v = view(oneTurret([{ startLine: 5, endLine: 20 }], [notFound, odd]));
    expect(v?.tooltip).toContain('Line 7 names “G15”, which is not a channel or alias of this machine.');
  });

  it('keeps "not found" for one file per channel whose other file is not in the folder', () => {
    const set = {
      layout: 'multi-file',
      self: A,
      members: [{ kind: 'file', channel: A, docId: 'd1', by: 'fileName', name: 'part_1.nc' }],
      missing: [B],
      outside: [],
      marks: [],
      problems: [],
      truncated: false,
    } as unknown as ChannelSet;
    const v = view(set, 'multi-file');
    expect(v?.label).toBe('Turret A (1 of 2), Turret B not found');
    expect(v?.tooltip).toContain('Turret B: not found');
  });
});
