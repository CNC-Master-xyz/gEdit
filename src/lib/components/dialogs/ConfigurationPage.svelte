<!--
  Settings ▸ Configuration (Phase 4 plan §6.9 rules 16–36, 44, 46). The prelude wired the tab;
  P4.36 built the page.

  Two buttons: Export (the save dialog, then the zip) and Import (the open dialog, then the preview
  below the buttons). A modal cannot open over the Settings dialog, so the preview of an import is
  shown on this page; from the palette the same component opens as a dialog of its own. Like the
  Machines and Profiles pages it acts at once: the dialog's Save does not cover it.

  Keep the root element and its test id: the dialog's tests and the runtime harness find the page by it.
-->
<script module lang="ts">
  import type { ConfigurationActions, PickedImport } from '$lib/contrib/configuration';

  /** What the page needs from the outside world, so it can be tested with fakes. */
  export interface ConfigurationPageDeps {
    actions: ConfigurationActions;
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import ImportPreviewDialog from '$lib/components/dialogs/ImportPreviewDialog.svelte';
  import { configurationActions } from '$lib/contrib/configuration';
  import { t } from '$lib/i18n';

  interface Props {
    /** Tests hand in fakes; the app uses the real actions. */
    deps?: ConfigurationPageDeps;
    /** A preview to show at once (tests). */
    initial?: PickedImport | null;
  }

  let { deps = { actions: configurationActions }, initial = null }: Props = $props();

  // The first value only: a pick replaces it.
  let picked = $state<PickedImport | null>(untrack(() => initial));
  let busy = $state(false);

  async function exportNow(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await deps.actions.exportConfiguration();
    } finally {
      busy = false;
    }
  }

  async function importNow(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      picked = await deps.actions.pickImport();
    } finally {
      busy = false;
    }
  }
</script>

<section data-testid="settings-configuration" aria-label={t('configuration.title')}>
  <h3>{t('configuration.title')}</h3>
  <p>{t('configuration.intro')}</p>
  <div class="actions">
    <button type="button" data-testid="config-export" disabled={busy || picked !== null} onclick={() => void exportNow()}>
      {t('configuration.exportButton')}
    </button>
    <button type="button" data-testid="config-import" disabled={busy || picked !== null} onclick={() => void importNow()}>
      {t('configuration.importButton')}
    </button>
  </div>
  <p class="note">{t('configuration.exportNote')}</p>
  <p class="note">{t('configuration.importNote')}</p>
  {#if picked !== null}
    {@const current = picked}
    {#key current}
      <ImportPreviewDialog
        preview={current.preview}
        src={current.src}
        onApply={async (groups, trusted) => {
          await deps.actions.applyImport(current, groups, trusted);
        }}
        onCancel={() => (picked = null)}
      />
    {/key}
  {/if}
</section>

<style>
  .actions {
    display: flex;
    gap: 8px;
    margin: 8px 0;
  }
  .note {
    margin: 4px 0;
    color: var(--text-muted);
  }
</style>
