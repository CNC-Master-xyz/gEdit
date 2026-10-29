// WY-CODE-1: a file the system hands over opens only when the start is over, whatever the
// file-name order of the contributions. `openRequests` (24) activates before `recovery` (34) and
// `session` (40), so its wait cannot be decided at activation: it waits for every contribution
// to have activated (the claims are then made), for the crash-recovery decision, and for the
// session restore. The three activations run here in file-name order through the real loader;
// recovery is the real claim/mark pair around a stub dialog.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The first import of the real application graph is slow on a cold transform cache.
vi.setConfig({ testTimeout: 90_000 });

const fake = vi.hoisted(() => ({
  log: [] as string[],
  restoreEnabled: true,
  /** Settles the stub session restore, which the test holds open. */
  finishRestore: undefined as (() => void) | undefined,
}));

vi.mock('$lib/utils/platform', async (importActual) => ({
  ...(await importActual<typeof import('$lib/utils/platform')>()),
  isTauriRuntime: () => true,
}));
vi.mock('$lib/platform/commands', async (importActual) => ({
  ...(await importActual<typeof import('$lib/platform/commands')>()),
  openRequestsReady: async () => {
    fake.log.push('ready');
    return { paths: ['/dnc/clicked.nc'], dropped: 0, refused: 0 };
  },
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: async () => {
    fake.log.push('listen');
    return () => {};
  },
}));
vi.mock('$lib/app/fileOps', () => ({
  files: {
    open: async (paths: string[]) => {
      fake.log.push(`files.open ${paths.join(',')}`);
      return [];
    },
  },
}));
vi.mock('$lib/app/session', async (importActual) => ({
  ...(await importActual<typeof import('$lib/app/session')>()),
  startFileTracker: () => () => {},
  session: {
    restore: async () => {
      if (!fake.restoreEnabled) return 0;
      fake.log.push('session.restore begins');
      await new Promise<void>((resolve) => (fake.finishRestore = resolve));
      fake.log.push('session.restore ends');
      return 1;
    },
    start: () => () => {},
  },
}));

/** Lets every detached flow run as far as it can get. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

beforeEach(() => {
  vi.resetModules();
  fake.log = [];
  fake.restoreEnabled = true;
  fake.finishRestore = undefined;
});

/** The three real activations in file-name order; recovery is a stub dialog around the real gate. */
async function startInFileNameOrder(opts: { recovery: boolean }) {
  const { registerContributions } = await import('$lib/app/contributions');
  const recovery = await import('$lib/app/recovery');
  const { default: openRequests } = await import('./openRequests');
  const { default: session } = await import('./session');
  const stubRecovery = {
    id: 'recovery',
    activate() {
      recovery.claimRestoreDecision();
      return () => {};
    },
  };
  const list = opts.recovery ? [openRequests, stubRecovery, session] : [openRequests, session];
  const loaded = registerContributions(list);
  return {
    loaded,
    decide: () => {
      fake.log.push('markRestoreDecided');
      recovery.markRestoreDecided();
    },
  };
}

describe('files handed over by the system at a cold start', () => {
  it('open after the recovery decision and after the session restore, not before', async () => {
    const run = await startInFileNameOrder({ recovery: true });
    await run.loaded;
    await settle();
    // Everything has activated; the dialog is still up and the restore has not begun.
    expect(fake.log.some((l) => l.startsWith('files.open'))).toBe(false);
    expect(fake.log).not.toContain('listen');

    run.decide();
    await settle();
    // The restore is running now; the clicked file must still wait for its front tab.
    expect(fake.log).toContain('session.restore begins');
    expect(fake.log.some((l) => l.startsWith('files.open'))).toBe(false);

    fake.finishRestore?.();
    await settle();
    const at = (entry: string): number => fake.log.indexOf(entry);
    expect(at('files.open /dnc/clicked.nc')).toBeGreaterThan(at('markRestoreDecided'));
    expect(at('files.open /dnc/clicked.nc')).toBeGreaterThan(at('session.restore ends'));
    expect(fake.log.filter((l) => l.startsWith('files.open'))).toHaveLength(1);
  });

  it('open promptly when the session restore is off', async () => {
    fake.restoreEnabled = false;
    const run = await startInFileNameOrder({ recovery: false });
    await run.loaded;
    await settle();
    expect(fake.log).toContain('files.open /dnc/clicked.nc');
  });

  it('open promptly when no session contribution started at all', async () => {
    const { registerContributions } = await import('$lib/app/contributions');
    const { default: openRequests } = await import('./openRequests');
    await registerContributions([openRequests]);
    await settle();
    expect(fake.log).toContain('files.open /dnc/clicked.nc');
  });
});
