// The bar above the channel panes (Phase 4 plan §6.7 rule 14, §6.11 `channel-view-bar`; P4.22b): the
// markup contract, rendered with `svelte/server` (no DOM, no Monaco).

import { render } from 'svelte/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { announcement } from './channelBarAnnouncement';
import type { ChannelViewState } from '$lib/app/types';

const fake = vi.hoisted(() => ({
  state: { open: false, layout: null, docId: null, panes: [], notShown: [], outsideLines: 0, marks: { matched: 0, unmatched: 0, none: 0, unknown: 0 } } as unknown as ChannelViewState,
}));

vi.mock('$lib/monaco/channelPanes', () => ({
  channelPanes: {
    state: {
      subscribe: (run: (value: ChannelViewState) => void) => {
        run(fake.state);
        return () => {};
      },
    },
    close: () => {},
  },
}));
vi.mock('$lib/stores/channels', () => ({
  channels: { params: () => ({ list: [{ id: '3', name: 'Turret C' }, { id: '4', name: 'Turret D' }] }) },
}));

const Bar = (await import('./ChannelViewBar.svelte')).default;
const html = (): string => render(Bar).body;

const open = (over: Partial<ChannelViewState>): ChannelViewState => ({
  open: true,
  layout: 'single-file',
  docId: 'd1',
  panes: [],
  notShown: [],
  outsideLines: 0,
  marks: { matched: 0, unmatched: 0, none: 0, unknown: 0 },
  ...over,
});

beforeEach(() => {
  fake.state = open({ open: false, layout: null, docId: null });
});

describe('the channel view bar', () => {
  it('is not there while the view is closed', () => {
    expect(html()).not.toContain('channel-view-bar');
  });

  it('carries the test-id contract and says how the view was made', () => {
    fake.state = open({ notShown: ['3', '4'], outsideLines: 12, marks: { matched: 6, unmatched: 2, none: 1, unknown: 0 } });
    const body = html();
    expect(body).toContain('data-testid="channel-view-bar"');
    expect(body).toContain('data-layout="single-file"');
    expect(body).toContain('data-not-shown="3,4"');
    expect(body).toContain('data-outside="12"');
    expect(body).toContain('data-matched="6"');
    expect(body).toContain('data-unmatched="2"');
    expect(body).toContain('Channel sections of one program');
    expect(body).toContain('data-action="close"');
  });

  it('names the channels that are not shown by their names, and the lines that are in no channel', () => {
    fake.state = open({ notShown: ['3', '4'], outsideLines: 1 });
    const body = html();
    expect(body).toContain('Not shown: Turret C, Turret D');
    expect(body).toContain('1 line is in no channel and is not shown.');
    fake.state = open({ outsideLines: 12 });
    expect(html()).toContain('12 lines are in no channel and are not shown.');
  });

  it('says how many waits are lined up and how many have no partner, and leaves the parts out that have nothing to say', () => {
    fake.state = open({ layout: 'multi-file', marks: { matched: 4, unmatched: 1, none: 0, unknown: 0 } });
    const body = html();
    expect(body).toContain('One file per channel');
    expect(body).toContain('4 of 5 waits lined up');
    expect(body).toContain('1 wait has no partner');
    expect(body).not.toContain('Not shown');
    expect(body).not.toContain('is in no channel');
    fake.state = open({});
    expect(html()).not.toContain('waits lined up');
  });

  it('says a wait that names a channel the machine does not have apart from the waits without a partner (T037)', () => {
    fake.state = open({ marks: { matched: 3, unmatched: 0, none: 0, unknown: 2 } });
    const body = html();
    expect(body).toContain('data-unknown="2"');
    expect(body).toContain('3 of 5 waits lined up');
    expect(body).toContain('2 waits name a channel this machine does not have');
    expect(body).not.toContain('no partner');
    fake.state = open({ marks: { matched: 3, unmatched: 1, none: 0, unknown: 1 } });
    const both = html().replace(/<!--.*?-->/g, '');
    expect(both).toContain('3 of 5 waits lined up, 1 wait has no partner, 1 wait names a channel this machine does not have');
  });

  describe('what it announces (T031)', () => {
    const said = (): string => /data-testid="channel-view-announce"[^>]*>([^<]*)</.exec(html())?.[1] ?? 'missing';

    it('is not a live region itself: only a hidden polite one carries the changes', () => {
      fake.state = open({ marks: { matched: 4, unmatched: 1, none: 0, unknown: 0 } });
      const body = html();
      expect(body.match(/role="status"/g)).toHaveLength(1);
      expect(body).toMatch(/data-testid="channel-view-bar"[^>]*role="group"/);
      expect(body).toMatch(/role="status" aria-live="polite" data-testid="channel-view-announce"/);
    });

    it('says the same for any number of lined-up waits and of lines in no channel', () => {
      fake.state = open({ marks: { matched: 4, unmatched: 2, none: 0, unknown: 0 }, outsideLines: 1 });
      const first = said();
      expect(first).toBe('2 waits have no partner');
      fake.state = open({ marks: { matched: 40, unmatched: 2, none: 3, unknown: 0 }, outsideLines: 90 });
      expect(said()).toBe(first);
    });

    it('has the live region while the view is closed, empty, so the first words at opening are announced (WX-CODE-3)', () => {
      const closed = html();
      expect(closed).not.toContain('channel-view-bar');
      expect(closed).toMatch(/role="status" aria-live="polite" data-testid="channel-view-announce"[^>]*><\/span>/);
      expect(closed.match(/role="status"/g)).toHaveLength(1);
      // Open, it is the same one region (one in the markup, outside the bar), and carries the first problems.
      fake.state = open({ marks: { matched: 4, unmatched: 1, none: 0, unknown: 0 } });
      const opened = html();
      expect(opened.match(/role="status"/g)).toHaveLength(1);
      expect(opened.indexOf('channel-view-announce')).toBeLessThan(opened.indexOf('channel-view-bar'));
      expect(said()).toBe('1 wait has no partner');
    });

    it('says "All waits are lined up." exactly once when the last problem goes, as the bar feeds its memory back (WX-CODE-3)', () => {
      // The component keeps `hadProblem` between answers (an effect, not state); this is the same fold.
      const states = [
        { matched: 4, unmatched: 0, unknown: 0 },
        { matched: 3, unmatched: 1, unknown: 0 },
        { matched: 4, unmatched: 0, unknown: 0 },
        { matched: 5, unmatched: 0, unknown: 0 },
        { matched: 5, unmatched: 0, unknown: 0 },
      ];
      let hadProblem = false;
      const heard = states.map((facts) => {
        const answer = announcement({ ...facts, notShown: [] }, hadProblem);
        hadProblem = answer.problem;
        return answer.text;
      });
      expect(heard).toEqual(['', '1 wait has no partner', 'All waits are lined up.', '', '']);
    });

    it('says nothing while all is well, and names the channels that are not shown', () => {
      fake.state = open({ marks: { matched: 4, unmatched: 0, none: 0, unknown: 0 } });
      expect(said()).toBe('');
      fake.state = open({ notShown: ['3'], marks: { matched: 4, unmatched: 0, none: 0, unknown: 0 } });
      expect(said()).toBe('Not shown: Turret C');
    });
  });
});
