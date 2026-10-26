// The helpers the background builds chain their slices with (T170: shared by the outline and the modal service).

import { describe, expect, it } from 'vitest';
import * as outlineService from './outlineService';
import { CHAIN_MS, inputPending, nextTurn } from './scheduler';

describe('the scheduler', () => {
  it('runs a callback in the next turn, in order, and not a cancelled one', async () => {
    const order: number[] = [];
    nextTurn(() => order.push(1));
    const cancel = nextTurn(() => order.push(2));
    nextTurn(() => order.push(3));
    cancel();
    await new Promise<void>((resolve) => nextTurn(resolve));
    expect(order).toEqual([1, 3]);
  });

  it('is what the outline service chains with (and still exports for its callers)', () => {
    expect(outlineService.nextTurn).toBe(nextTurn);
    expect(outlineService.inputPending).toBe(inputPending);
    expect(outlineService.CHAIN_MS).toBe(CHAIN_MS);
  });

  it('knows no pending input where the engine cannot say', () => {
    expect(inputPending()).toBe(false);
  });
});
