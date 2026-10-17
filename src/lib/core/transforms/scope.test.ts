// What a transform runs on (plan §5 WP4.1): a selection extended to whole lines, the
// whole document without one, and a stale selection that can no longer be trusted.

import { describe, expect, it } from 'vitest';
import { SELECTION_CROSSES, transformScope } from './scope';

describe('transformScope', () => {
  it('takes the whole document when there is no selection', () => {
    expect(transformScope(120, null)).toEqual({ startLine: 1, endLine: 120, fromSelection: false });
  });

  it('takes the whole document for a bare caret', () => {
    expect(transformScope(9, { startLine: 4, endLine: 4, empty: true })).toEqual({
      startLine: 1,
      endLine: 9,
      fromSelection: false,
    });
  });

  it('extends a selection to whole lines', () => {
    // The columns never reach this function: half a block is not a block.
    expect(transformScope(50, { startLine: 12, endLine: 15, empty: false })).toEqual({
      startLine: 12,
      endLine: 15,
      fromSelection: true,
    });
  });

  it('keeps a one-line selection to that line', () => {
    expect(transformScope(50, { startLine: 7, endLine: 7, empty: false })).toEqual({
      startLine: 7,
      endLine: 7,
      fromSelection: true,
    });
  });

  it('orders a selection that was dragged upwards', () => {
    expect(transformScope(50, { startLine: 20, endLine: 8, empty: false })).toEqual({
      startLine: 8,
      endLine: 20,
      fromSelection: true,
    });
  });

  it('clamps a selection that outlived the text it was made in', () => {
    expect(transformScope(10, { startLine: 8, endLine: 400, empty: false })).toEqual({
      startLine: 8,
      endLine: 10,
      fromSelection: true,
    });
    expect(transformScope(10, { startLine: 0, endLine: -3, empty: false })).toEqual({
      startLine: 1,
      endLine: 1,
      fromSelection: true,
    });
  });

  it('never returns a range below one line', () => {
    expect(transformScope(0, null)).toEqual({ startLine: 1, endLine: 1, fromSelection: false });
    expect(transformScope(Number.NaN, null)).toEqual({
      startLine: 1,
      endLine: 1,
      fromSelection: false,
    });
  });

  it('floors a fractional line number rather than rounding past the end', () => {
    expect(transformScope(10.9, { startLine: 2.7, endLine: 4.2, empty: false })).toEqual({
      startLine: 2,
      endLine: 4,
      fromSelection: true,
    });
  });
});

// Phase 4, P4e (§6.7 rule 3): a selection in a channel pane that runs over another channel's lines.
describe('transformScope and a selection across a junction', () => {
  it('carries the flag of a selection that is not one run of document lines', () => {
    expect(transformScope(120, { startLine: 20, endLine: 80, empty: false, crossesJunction: true })).toEqual({
      startLine: 20,
      endLine: 80,
      fromSelection: true,
      crossesJunction: true,
    });
  });

  it('has no flag for a selection that is one run, and ignores it for a bare caret', () => {
    expect(transformScope(120, { startLine: 20, endLine: 30, empty: false })).not.toHaveProperty('crossesJunction');
    expect(transformScope(120, { startLine: 20, endLine: 80, empty: true, crossesJunction: true })).toEqual({ startLine: 1, endLine: 120, fromSelection: false });
  });

  it('names the refusal the commands say, in plain words', async () => {
    expect(SELECTION_CROSSES).toEqual({ key: 'channelPanes.selectionCrosses' });
    const { t } = await import('$lib/i18n');
    expect(t(SELECTION_CROSSES.key)).toBe('The selection runs over the lines of another channel. Select within one section.');
  });
});
