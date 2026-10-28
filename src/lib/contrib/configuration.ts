// Export and import of the whole configuration (Phase 4 plan §6.9 rules 16–36, Q4-23). Owner: P4.36.
// One feature per file (plan AD-3); see ./README.md.
//
//   config.export   the configuration folder, written to one zip file you choose
//   config.import   a zip file you choose: a preview of what it would change, then the import
//
// Rust does everything that touches a file (`src-tauri/src/configzip.rs`): it reads the zip under
// its limits, refuses an unsafe one whole, merges `settings.json`, `keybindings.json` and
// `machines.json`, never takes the interpreter or the extra script folders from a file, writes a
// backup zip of what it replaces, and refuses code without the trust flag. This file picks the
// paths, shows the preview, and loads everything again after an import (rule 33), without a
// restart.
//
// The Configuration page (Settings ▸ Configuration) runs the same actions. A modal cannot open
// over the Settings dialog, so the page shows the preview in itself; from the palette the preview
// is a dialog of its own (`ImportPreviewDialog.svelte`, the same component).
//
// No key: both are rare, and an import changes many files (§6.9 rule 45).

import { dialogs } from '$lib/app/dialogs';
import { loadUserKeys } from '$lib/app/keys/userKeys';
import { modals } from '$lib/app/modals';
import { scripts } from '$lib/app/scripts';
import { status } from '$lib/app/status';
import { userConfig } from '$lib/app/userConfig';
import ImportPreviewDialog from '$lib/components/dialogs/ImportPreviewDialog.svelte';
import { exportFileName } from '$lib/core/config/configZip';
import { configExport, configImportApply, configImportPreview } from '$lib/platform/commands';
import type {
  ConfigExportResult,
  ConfigImportPreview,
  ConfigImportResult,
} from '$lib/platform/commands';
import { machines } from '$lib/stores/machines';
import { settings } from '$lib/stores/settings';
import { t } from '$lib/i18n';
import { baseName } from '$lib/utils/platform';
import type { Contribution, NativeDialogs, StatusService, Translate } from '$lib/app/types';

/** A zip picked for import, with what Rust says it would do. */
export interface PickedImport {
  src: string;
  preview: ConfigImportPreview;
}

/** What the actions need from the outside world, so each is testable with fakes. */
export interface ConfigurationDeps {
  dialogs: Pick<NativeDialogs, 'saveFile' | 'pickFile'>;
  status: Pick<StatusService, 'show'>;
  exportZip(dest: string): Promise<ConfigExportResult>;
  previewZip(src: string): Promise<ConfigImportPreview>;
  applyZip(src: string, fingerprint: string, groups: string[], acceptScripts: boolean): Promise<ConfigImportResult>;
  /** Everything an import may have changed, loaded again in order (rule 33); each step may fail alone. */
  reloads: readonly (() => Promise<unknown>)[];
  now(): Date;
  t: Translate;
}

/** English detail for anything thrown across the IPC boundary. */
function detailOf(err: unknown): string {
  if (typeof err === 'string') return err;
  return err instanceof Error ? err.message : String(err);
}

export interface ConfigurationActions {
  /** Asks where to save, writes the zip, says how many files and what was left out. */
  exportConfiguration(): Promise<ConfigExportResult | null>;
  /** Asks for a zip and answers its preview (a refused one too: the preview says why), or null. */
  pickImport(): Promise<PickedImport | null>;
  /** Imports the ticked groups, then loads everything again. Answers null when it failed (and said so). */
  applyImport(picked: PickedImport, groups: string[], trusted: boolean): Promise<ConfigImportResult | null>;
}

export function createConfigurationActions(deps: ConfigurationDeps): ConfigurationActions {
  const { t } = deps;

  async function reloadAll(): Promise<void> {
    const failures: string[] = [];
    for (const reload of deps.reloads) {
      try {
        await reload();
      } catch (err) {
        failures.push(detailOf(err));
      }
    }
    if (failures.length > 0) {
      deps.status.show(t('configuration.reloadFailed'), { error: true, detail: failures.join('\n') });
    }
  }

  return {
    async exportConfiguration() {
      const dest = await deps.dialogs.saveFile({
        defaultPath: exportFileName(deps.now()),
        filters: [{ name: 'Zip', extensions: ['zip'] }],
      });
      if (dest === null) return null;
      try {
        const result = await deps.exportZip(dest);
        const text = t('configuration.exported', { count: result.files, file: baseName(dest) });
        if (result.skipped.length === 0) {
          deps.status.show(text);
        } else {
          deps.status.show(`${text} ${t('configuration.exportSkipped', { count: result.skipped.length })}`, {
            detail: result.skipped.map((s) => `${s.path}: ${s.reason}`).join('\n'),
          });
        }
        return result;
      } catch (err) {
        deps.status.show(t('configuration.exportFailed'), { error: true, detail: detailOf(err) });
        return null;
      }
    },

    async pickImport() {
      const src = await deps.dialogs.pickFile({ title: t('configuration.preview.title') });
      if (src === null) return null;
      try {
        return { src, preview: await deps.previewZip(src) };
      } catch (err) {
        deps.status.show(t('configuration.previewFailed'), { error: true, detail: detailOf(err) });
        return null;
      }
    },

    async applyImport(picked, groups, trusted) {
      let result: ConfigImportResult;
      try {
        result = await deps.applyZip(picked.src, picked.preview.fingerprint, groups, trusted);
      } catch (err) {
        deps.status.show(t('configuration.importFailed'), { error: true, detail: detailOf(err) });
        return null;
      }
      if (result.written > 0) await reloadAll();
      const parts = [
        result.written > 0 ? t('configuration.imported', { count: result.written }) : t('configuration.importedNothing'),
      ];
      if (result.backup !== null) parts.push(t('configuration.importedBackup', { name: result.backup }));
      deps.status.show(parts.join(' '));
      return result;
    },
  };
}

/** The actions of the running app. */
export const configurationActions: ConfigurationActions = createConfigurationActions({
  dialogs,
  status,
  exportZip: configExport,
  previewZip: configImportPreview,
  applyZip: configImportApply,
  reloads: [
    () => settings.reloadFromDisk(),
    () => loadUserKeys(),
    () => machines.reloadFromDisk(),
    () => userConfig.load(),
    () => scripts.rescan(),
  ],
  now: () => new Date(),
  t,
});

/** `config.import` from the palette: pick, then the preview as a dialog of its own. */
async function importFromPalette(): Promise<void> {
  const picked = await dialogs.exclusive(() => configurationActions.pickImport());
  if (!picked) return;
  await modals.open(
    ImportPreviewDialog,
    {
      preview: picked.preview,
      src: picked.src,
      onApply: async (groups: string[], trusted: boolean) => {
        await configurationActions.applyImport(picked, groups, trusted);
      },
    },
    { wide: true },
  );
}

export default {
  id: 'configuration',
  commands: [
    {
      id: 'config.export',
      title: 'configuration.exportTitle',
      category: 'configuration.category',
      global: true,
      run: () => dialogs.exclusive(() => configurationActions.exportConfiguration()),
    },
    {
      id: 'config.import',
      title: 'configuration.importTitle',
      category: 'configuration.category',
      global: true,
      run: () => importFromPalette(),
    },
  ],
} satisfies Contribution;
