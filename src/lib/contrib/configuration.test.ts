// The configuration contribution (Phase 4 plan §6.9 rules 18–21, 29–33, 45): the two commands, and
// the three actions against fakes — export, pick and preview, apply and the reloads after it.

import { describe, expect, it, vi } from 'vitest';
import contribution, { createConfigurationActions, type ConfigurationDeps } from './configuration';
import { hasKey, t } from '$lib/i18n';
import type { ConfigImportPreview, ConfigImportResult } from '$lib/platform/commands';

const PREVIEW: ConfigImportPreview = {
  ok: true,
  fingerprint: 'abcdef0123456789',
  manifest: { appVersion: '1.2.0', created: '', platform: '' },
  groups: [],
  ignored: [],
  ignoredCount: 0,
  refusals: [],
  needsTrust: false,
  keptSettings: [],
};

function fakes(over: Partial<ConfigurationDeps> = {}) {
  const order: string[] = [];
  const deps: ConfigurationDeps = {
    dialogs: { saveFile: vi.fn(async () => '/out/c.zip'), pickFile: vi.fn(async () => '/in/c.zip') },
    status: { show: vi.fn() },
    exportZip: vi.fn(async () => ({ files: 3, bytes: 100, skipped: [] })),
    previewZip: vi.fn(async () => PREVIEW),
    applyZip: vi.fn(async (): Promise<ConfigImportResult> => ({ written: 2, unchanged: 1, backup: 'before-import-20261027-100000.zip' })),
    reloads: ['settings', 'keys', 'machines', 'userConfig', 'scripts'].map((name) => async () => {
      order.push(name);
    }),
    now: () => new Date(2026, 9, 27),
    t,
    ...over,
  };
  return { deps, order, actions: createConfigurationActions(deps) };
}

describe('the commands', () => {
  it('are config.export and config.import, without a key, with titles', () => {
    const ids = contribution.commands.map((c) => c.id);
    expect(ids).toEqual(['config.export', 'config.import']);
    for (const command of contribution.commands) {
      expect('keys' in command).toBe(false);
      expect(hasKey(command.title)).toBe(true);
      expect(hasKey(command.category)).toBe(true);
    }
  });
});

describe('export', () => {
  it('asks where with a dated name, writes, and names the count and the file', async () => {
    const { deps, actions } = fakes();
    await actions.exportConfiguration();
    expect(deps.dialogs.saveFile).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'gedit-configuration-2026-10-27.zip' }),
    );
    expect(deps.exportZip).toHaveBeenCalledWith('/out/c.zip');
    expect(deps.status.show).toHaveBeenCalledWith(t('configuration.exported', { count: 3, file: 'c.zip' }));
  });

  it('does nothing when the save dialog is cancelled', async () => {
    const { deps, actions } = fakes({ dialogs: { saveFile: vi.fn(async () => null), pickFile: vi.fn() } });
    expect(await actions.exportConfiguration()).toBeNull();
    expect(deps.exportZip).not.toHaveBeenCalled();
  });

  it('lists what was left out in the details', async () => {
    const { deps, actions } = fakes({
      exportZip: vi.fn(async () => ({ files: 1, bytes: 10, skipped: [{ path: 'profiles/big.json', reason: 'larger than 1 MiB' }] })),
    });
    await actions.exportConfiguration();
    expect(deps.status.show).toHaveBeenCalledWith(expect.stringContaining(t('configuration.exportSkipped', { count: 1 })), {
      detail: 'profiles/big.json: larger than 1 MiB',
    });
  });

  it('says so when it fails', async () => {
    const { deps, actions } = fakes({ exportZip: vi.fn(async () => Promise.reject('the zip cannot be saved inside the configuration folder')) });
    expect(await actions.exportConfiguration()).toBeNull();
    expect(deps.status.show).toHaveBeenCalledWith(t('configuration.exportFailed'), {
      error: true,
      detail: 'the zip cannot be saved inside the configuration folder',
    });
  });
});

describe('import', () => {
  it('picks a file and answers its preview', async () => {
    const { deps, actions } = fakes();
    expect(await actions.pickImport()).toEqual({ src: '/in/c.zip', preview: PREVIEW });
    expect(deps.previewZip).toHaveBeenCalledWith('/in/c.zip');
  });

  it('answers null when the pick is cancelled or the file cannot be read', async () => {
    expect(await fakes({ dialogs: { saveFile: vi.fn(), pickFile: vi.fn(async () => null) } }).actions.pickImport()).toBeNull();
    const failing = fakes({ previewZip: vi.fn(async () => Promise.reject('larger than 16 MiB')) });
    expect(await failing.actions.pickImport()).toBeNull();
    expect(failing.deps.status.show).toHaveBeenCalledWith(t('configuration.previewFailed'), { error: true, detail: 'larger than 16 MiB' });
  });

  it('applies with the preview’s fingerprint, then loads everything again in order without a restart', async () => {
    const { deps, order, actions } = fakes();
    const result = await actions.applyImport({ src: '/in/c.zip', preview: PREVIEW }, ['settings', 'scripts'], true);
    expect(deps.applyZip).toHaveBeenCalledWith('/in/c.zip', 'abcdef0123456789', ['settings', 'scripts'], true);
    expect(result?.written).toBe(2);
    expect(order).toEqual(['settings', 'keys', 'machines', 'userConfig', 'scripts']);
    expect(deps.status.show).toHaveBeenCalledWith(
      `${t('configuration.imported', { count: 2 })} ${t('configuration.importedBackup', { name: 'before-import-20261027-100000.zip' })}`,
    );
  });

  it('loads nothing again when nothing was written', async () => {
    const { deps, order, actions } = fakes({ applyZip: vi.fn(async () => ({ written: 0, unchanged: 4, backup: null })) });
    await actions.applyImport({ src: '/in/c.zip', preview: PREVIEW }, ['profiles'], false);
    expect(order).toEqual([]);
    expect(deps.status.show).toHaveBeenCalledWith(t('configuration.importedNothing'));
  });

  it('reports a failed import and loads nothing', async () => {
    const { deps, order, actions } = fakes({
      applyZip: vi.fn(async () => Promise.reject('the file changed since it was previewed; open it again')),
    });
    expect(await actions.applyImport({ src: '/in/c.zip', preview: PREVIEW }, ['profiles'], false)).toBeNull();
    expect(order).toEqual([]);
    expect(deps.status.show).toHaveBeenCalledWith(t('configuration.importFailed'), {
      error: true,
      detail: 'the file changed since it was previewed; open it again',
    });
  });

  it('goes on loading when one step fails, and says so', async () => {
    const ran: string[] = [];
    const { deps, actions } = fakes({
      reloads: [
        async () => ran.push('settings'),
        async () => Promise.reject(new Error('keys broke')),
        async () => ran.push('scripts'),
      ],
    });
    await actions.applyImport({ src: '/in/c.zip', preview: PREVIEW }, ['settings'], false);
    expect(ran).toEqual(['settings', 'scripts']);
    expect(deps.status.show).toHaveBeenCalledWith(t('configuration.reloadFailed'), { error: true, detail: 'keys broke' });
  });
});
