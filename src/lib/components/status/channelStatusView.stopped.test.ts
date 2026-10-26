// T171: the channel status item names a pattern that was stopped in the background reader,
// instead of hiding the item as for a program without channels.

import { describe, expect, it } from 'vitest';
import type { ChannelSet } from '$lib/core/channels/types';
import { patternStoppedProblem } from '$lib/core/channels/marks';
import { channelStatusView } from './channelStatusView';

const none = (problems: ChannelSet['problems']): ChannelSet => ({ layout: 'none', self: null, members: [], missing: [], outside: [], marks: [], problems, truncated: false });
const view = (set: ChannelSet) => channelStatusView({ set, params: null, unassigned: false, cursorLine: 0, channelAt: () => null });

describe('channelStatusView with a stopped pattern', () => {
  it('says so, with the pattern in the tooltip, and styles it as slow', () => {
    const shown = view(none([patternStoppedProblem('sectionStart', '(a+)+$', 2000)]));
    expect(shown).not.toBeNull();
    expect(shown?.label).toBe('Channels: pattern stopped');
    expect(shown?.slow).toBe(true);
    expect(shown?.tooltip).toContain('(a+)+$');
    expect(shown?.tooltip).toContain('2 seconds');
  });

  it('still hides the item for a program without channels', () => {
    expect(view(none([]))).toBeNull();
  });
});
