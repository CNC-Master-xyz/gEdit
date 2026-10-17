// The ribbon re-evaluates its enablement when the state behind the command context changes
// (bootstrap `watchContext`). A machine change or a change of a document's channels moves
// neither a document, the layout, the cursor nor a modal, so the machine and channel
// revisions have to be watched too (since M12 they were not).

import { writable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ machineRevision: null as unknown, channelRevision: null as unknown }));

vi.mock('$lib/stores/machines', async (importOriginal) => {
  const { writable: make } = await import('svelte/store');
  const actual = await importOriginal<typeof import('$lib/stores/machines')>();
  const revision = make(0);
  mocks.machineRevision = revision;
  return { ...actual, machines: { ...actual.machines, revision } };
});

vi.mock('$lib/stores/channels', async (importOriginal) => {
  const { writable: make } = await import('svelte/store');
  const actual = await importOriginal<typeof import('$lib/stores/channels')>();
  const revision = make(0);
  mocks.channelRevision = revision;
  return { ...actual, channels: { ...actual.channels, revision } };
});

import { watchContext } from './bootstrap';

describe('watchContext', () => {
  it('notifies when the machines change', () => {
    const notify = vi.fn();
    const stop = watchContext(notify);
    notify.mockClear();
    (mocks.machineRevision as ReturnType<typeof writable<number>>).update((n) => n + 1);
    expect(notify).toHaveBeenCalledTimes(1);
    stop();
  });

  it('notifies when a document’s channels change', () => {
    const notify = vi.fn();
    const stop = watchContext(notify);
    notify.mockClear();
    (mocks.channelRevision as ReturnType<typeof writable<number>>).update((n) => n + 1);
    expect(notify).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stops watching them when disposed', () => {
    const notify = vi.fn();
    watchContext(notify)();
    notify.mockClear();
    (mocks.machineRevision as ReturnType<typeof writable<number>>).update((n) => n + 1);
    (mocks.channelRevision as ReturnType<typeof writable<number>>).update((n) => n + 1);
    expect(notify).not.toHaveBeenCalled();
  });
});
