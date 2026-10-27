// Files the system asks gEdit to open: the webview's half (plan section 6.8.2, S7; P4.29).
// The backend has checked and granted every path; the deps are fakes, the thing under test is the
// order (listener before the one ask, recovery first), that nothing is lost between, that the
// opening runs after any open dialog, and the one status line for what was skipped.

import { describe, expect, it, vi } from 'vitest';
import contribution, { batchOf, skippedLine, startOpenRequests } from './openRequests';
import type { OpenRequestsDeps } from './openRequests';
import type { OpenRequestsReady } from '$lib/platform/commands';

/** Lets the promise chains of the module run to the end. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function fakes(waiting: Partial<OpenRequestsReady> = {}) {
  const log: string[] = [];
  const opened: string[][] = [];
  const shown: { text: string; error?: boolean }[] = [];
  let emit: (payload: unknown) => void = () => {};
  let release: () => void = () => {};
  const decision = new Promise<void>((resolve) => (release = resolve));
  const off = vi.fn();
  const deps: OpenRequestsDeps = {
    decided: () => {
      log.push('decided?');
      return decision;
    },
    listen: async (callback) => {
      log.push('listen');
      emit = callback;
      return off;
    },
    ready: async () => {
      log.push('ready');
      return { paths: [], dropped: 0, refused: 0, ...waiting };
    },
    whenFree: async (op) => {
      log.push('whenFree');
      return op();
    },
    open: async (paths) => {
      log.push('open');
      opened.push(paths);
    },
    show: (text, o) => shown.push({ text, error: o?.error }),
  };
  return { deps, log, opened, shown, release, off, emit: (p: unknown) => emit(p) };
}

describe('the payload', () => {
  it('keeps the strings of paths and the whole numbers of the counts, and nothing else', () => {
    expect(batchOf({ paths: ['/a.nc', 7, '', '/b.nc'], refused: 2, dropped: 1, secret: 'x' })).toEqual({
      paths: ['/a.nc', '/b.nc'],
      refused: 2,
      dropped: 1,
    });
    for (const odd of [null, undefined, 'x', 5, [], { paths: 'a' }, { paths: {}, refused: -1, dropped: 1.5 }]) {
      expect(batchOf(odd), JSON.stringify(odd)).toEqual({ paths: [], refused: 0, dropped: 0 });
    }
  });

  it('says what was skipped in one line, and nothing when nothing was', () => {
    expect(skippedLine({ paths: ['/a'], refused: 0, dropped: 0 })).toBeNull();
    expect(skippedLine({ paths: [], refused: 1, dropped: 0 })).toBe(
      'The system asked gEdit to open something that is not a file it can open. It was skipped.',
    );
    const both = skippedLine({ paths: [], refused: 2, dropped: 3 });
    expect(both).toContain('2 things');
    expect(both).toContain('3 were not opened');
  });
});

describe('the start', () => {
  it('waits for crash recovery, registers the listener, and only then asks once', async () => {
    const f = fakes();
    startOpenRequests(f.deps);
    await settle();
    expect(f.log).toEqual(['decided?']);
    f.release();
    await settle();
    expect(f.log).toEqual(['decided?', 'listen', 'ready']);
  });

  it('opens the paths that waited, behind any dialog', async () => {
    const f = fakes({ paths: ['/a.nc', '/b.nc'] });
    startOpenRequests(f.deps);
    f.release();
    await settle();
    expect(f.opened).toEqual([['/a.nc', '/b.nc']]);
    expect(f.log.slice(-2)).toEqual(['whenFree', 'open']);
    expect(f.shown).toEqual([]);
  });

  it('opens the paths of a later event, one hand-over after the other in order', async () => {
    const f = fakes();
    startOpenRequests(f.deps);
    f.release();
    await settle();
    f.emit({ paths: ['/c.nc'], refused: 0 });
    f.emit({ paths: ['/d.nc'], refused: 0 });
    await settle();
    expect(f.opened).toEqual([['/c.nc'], ['/d.nc']]);
  });

  it('says what was skipped after the opening, as an error line', async () => {
    const f = fakes({ paths: ['/a.nc'], refused: 2, dropped: 1 });
    startOpenRequests(f.deps);
    f.release();
    await settle();
    expect(f.log.slice(-1)).toEqual(['open']);
    expect(f.shown).toHaveLength(1);
    expect(f.shown[0].error).toBe(true);
    expect(f.shown[0].text).toContain('2 things');
    // Refusals alone open nothing and still say so.
    f.emit({ paths: [], refused: 1 });
    await settle();
    expect(f.opened).toHaveLength(1);
    expect(f.shown).toHaveLength(2);
  });

  it('ignores an event of the wrong shape', async () => {
    const f = fakes();
    startOpenRequests(f.deps);
    f.release();
    await settle();
    f.emit('/etc/passwd');
    f.emit({ paths: 'x' });
    await settle();
    expect(f.opened).toEqual([]);
    expect(f.shown).toEqual([]);
  });

  it('a failed opening does not stop the next one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = fakes();
    let calls = 0;
    f.deps.open = async (paths) => {
      calls++;
      if (calls === 1) throw new Error('boom');
      f.opened.push(paths);
    };
    startOpenRequests(f.deps);
    f.release();
    await settle();
    f.emit({ paths: ['/a.nc'], refused: 0 });
    f.emit({ paths: ['/b.nc'], refused: 0 });
    await settle();
    expect(f.opened).toEqual([['/b.nc']]);
    warn.mockRestore();
  });

  it('a disposer before recovery has decided registers nothing; after it removes the listener', async () => {
    const early = fakes();
    const stopEarly = startOpenRequests(early.deps);
    stopEarly();
    early.release();
    await settle();
    expect(early.log).toEqual(['decided?']);

    const late = fakes({ paths: ['/a.nc'] });
    const stop = startOpenRequests(late.deps);
    late.release();
    await settle();
    stop();
    expect(late.off).toHaveBeenCalledTimes(1);
    late.emit({ paths: ['/z.nc'], refused: 0 });
    await settle();
    expect(late.opened).toEqual([['/a.nc']]);
  });

  it('a listener that arrives after the disposer is removed at once', async () => {
    const f = fakes();
    const stop = startOpenRequests(f.deps);
    let arrive: (off: () => void) => void = () => {};
    f.deps.listen = () => new Promise((resolve) => (arrive = resolve));
    f.release();
    await settle();
    stop();
    const removed = vi.fn();
    arrive(removed);
    await settle();
    expect(removed).toHaveBeenCalledTimes(1);
    expect(f.log).not.toContain('ready');
  });
});

describe('the contribution', () => {
  it('has the id of its file and starts nothing outside the Tauri runtime', () => {
    expect(contribution.id).toBe('openRequests');
    const stop = contribution.activate();
    expect(typeof stop).toBe('function');
    stop();
  });
});
