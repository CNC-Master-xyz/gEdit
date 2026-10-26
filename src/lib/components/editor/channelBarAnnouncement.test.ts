// What the channel bar says aloud (v1.2.0 T031): only the counts that matter, and once when the last problem is gone.

import { describe, expect, it } from 'vitest';
import { announcement } from './channelBarAnnouncement';

const facts = (matched: number, unmatched: number, unknown: number, notShown: string[] = []) => ({ matched, unmatched, unknown, notShown });

describe('the channel bar announcement', () => {
  it('names the waits without a partner and the waits that name a channel the machine lacks', () => {
    expect(announcement(facts(4, 2, 0), false)).toEqual({ text: '2 waits have no partner', problem: true });
    expect(announcement(facts(4, 1, 3), false)).toEqual({ text: '1 wait has no partner. 3 waits name a channel this machine does not have', problem: true });
  });

  it('does not say the lined-up waits: their number changes with every wait that is typed', () => {
    expect(announcement(facts(4, 2, 0), true).text).toBe(announcement(facts(400, 2, 0), true).text);
    expect(announcement(facts(0, 0, 0), false)).toEqual({ text: '', problem: false });
    expect(announcement(facts(7, 0, 0), false)).toEqual({ text: '', problem: false });
  });

  it('says once that all waits are lined up when the last problem has gone, never before', () => {
    expect(announcement(facts(7, 0, 0), true)).toEqual({ text: 'All waits are lined up.', problem: false });
    expect(announcement(facts(0, 0, 0), true).text).toBe('');
  });

  it('adds the channels that are not shown', () => {
    expect(announcement(facts(4, 1, 0, ['Turret C', 'Turret D']), false).text).toBe('1 wait has no partner. Not shown: Turret C, Turret D');
  });
});
