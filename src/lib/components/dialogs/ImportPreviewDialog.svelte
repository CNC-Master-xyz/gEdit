<!--
  The preview of "Import Configuration" (Phase 4 plan §6.9 rules 26–31, 34, 46). Owner: P4.36.

  What Rust found in a configuration zip, before anything is written: the groups, each with its
  files marked new, replaces yours or same as yours, the settings, keys and machines that change,
  the entries that are not imported and why, and the settings kept from this computer. A refused
  file shows only its refusals, each in plain words.

  Rules this component keeps:

   1. **Nothing is ticked that holds code.** The first selection is `defaultSelection` (every
      group with a change except scripts and packages with scripts).
   2. **Code needs the tick.** While a ticked group holds code, the trust sentence and the
      "I trust this file" box are shown above Import, and Import stays off until the box is
      ticked. Rust refuses the same selection without the flag, whatever this page does.
   3. **Names are the user's data** (file paths, setting keys, machine names) and stay
      untranslated.

  Two ways in: from the palette `ModalHost` renders it with `close` (inside the dialog frame);
  the Configuration page renders it inline with `onCancel` (a modal cannot open over Settings).
-->
<script module lang="ts">
  import { groupKey, packageOfGroup, parseIgnored, refusalKey } from '$lib/core/config/configZip';
  import type { ConfigImportFile, ConfigImportGroup, ConfigImportItem, ConfigImportPreview } from '$lib/platform/commands';
  import type { Translate } from '$lib/app/types';

  /** A group's heading: its name, or "Package <name>". */
  export function groupTitle(group: ConfigImportGroup, t: Translate): string {
    const name = packageOfGroup(group.id);
    return name === null ? t(groupKey(group.id)) : t(groupKey(group.id), { name });
  }

  /** One changed line of a merged file. */
  export function itemText(item: ConfigImportItem, t: Translate): string {
    return item.from === null
      ? t('configuration.item.added', { label: item.label, to: item.to ?? '' })
      : t('configuration.item.changed', { label: item.label, from: item.from, to: item.to ?? '' });
  }

  /** What happens to one file, in words. */
  export function actionText(file: ConfigImportFile, t: Translate): string {
    return t(`configuration.action.${file.action}`);
  }

  /** An ignored entry, in words: the path and the reason (Rust's id when this build has no message for it). */
  export function ignoredText(line: string, t: Translate): string {
    const { path, reason, key } = parseIgnored(line);
    return `${path}: ${key === null ? reason : t(key)}`;
  }

  /** A refusal, in words: the entry (or "the whole file") and the reason. */
  export function refusalText(refusal: ConfigImportPreview['refusals'][number], t: Translate): string {
    const where = refusal.path === '' ? t('configuration.preview.wholeFile') : refusal.path;
    return `${where}: ${t(refusalKey(refusal.reason))}`;
  }

</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import Modal from '$lib/components/common/Modal.svelte';
  import { t } from '$lib/i18n';
  import { baseName } from '$lib/utils/platform';
  import {
    canImport,
    defaultSelection,
    selectableGroups,
    selectionCounts,
    selectionNeedsTrust,
    toggleGroup,
  } from '$lib/core/config/configZip';

  interface Props {
    preview: ConfigImportPreview;
    /** The zip's path, shown as its file name. */
    src: string;
    /** Runs the import of the ticked groups; the dialog closes when it settles. */
    onApply: (groups: string[], trusted: boolean) => Promise<void>;
    /** Inline on the Configuration page: Cancel and Close. */
    onCancel?: () => void;
    /** Supplied by ModalHost when the preview is a dialog of its own. */
    close?: (value?: unknown) => void;
  }

  let { preview, src, onApply, onCancel, close }: Props = $props();

  // The first selection only: the user's ticks are theirs from then on.
  let selected = $state<string[]>(untrack(() => defaultSelection(preview)));
  let trusted = $state(false);
  let busy = $state(false);

  const groups = $derived(selectableGroups(preview));
  const unchangedGroups = $derived(preview.groups.length - groups.length);
  const counts = $derived(selectionCounts(preview, selected));
  const needsTrust = $derived(selectionNeedsTrust(preview, selected));
  const enabled = $derived(!busy && canImport(preview, selected, trusted));

  function cancel(): void {
    if (busy) return;
    if (close) close();
    else onCancel?.();
  }

  async function confirm(): Promise<void> {
    if (!enabled) return;
    busy = true;
    try {
      await onApply([...selected], trusted);
    } finally {
      busy = false;
      if (close) close();
      else onCancel?.();
    }
  }

  function toggle(id: string, on: boolean): void {
    selected = toggleGroup(preview, selected, id, on);
  }
</script>

{#snippet body()}
  <div class="import-preview" data-testid="import-preview" data-state={preview.ok ? 'ok' : 'refused'}>
    <p class="source">{t('configuration.preview.source', { file: baseName(src) })}</p>
    {#if !preview.ok}
      <h4>{t('configuration.preview.refusedTitle')}</h4>
      <p>{t('configuration.preview.refusedIntro')}</p>
      <ul class="refusals" data-testid="import-refusals">
        {#each preview.refusals as refusal, i (i)}
          <li data-reason={refusal.reason}>{refusalText(refusal, t)}</li>
        {/each}
      </ul>
    {:else}
      {#if preview.manifest.appVersion !== '' || preview.manifest.created !== ''}
        <p class="made-by">
          {t('configuration.preview.madeBy', {
            version: preview.manifest.appVersion,
            created: preview.manifest.created,
            platform: preview.manifest.platform,
          })}
        </p>
      {/if}
      {#if groups.length === 0}
        <p>{t('configuration.preview.nothingInIt')}</p>
      {:else}
        <p>{t('configuration.preview.choose')}</p>
      {/if}
      {#each groups as group (group.id)}
        <fieldset class="group" data-testid="import-group" data-group={group.id} data-runnable={group.runnable ? 'true' : 'false'}>
          <legend>
            <label>
              <input
                type="checkbox"
                checked={selected.includes(group.id)}
                disabled={busy}
                onchange={(e) => toggle(group.id, (e.currentTarget as HTMLInputElement).checked)}
              />
              {groupTitle(group, t)}
              <span class="count">({t('configuration.preview.files', { count: group.files.length })})</span>
              {#if group.runnable}<span class="code">{t('configuration.preview.code')}</span>{/if}
            </label>
          </legend>
          <ul>
            {#each group.files as file (file.path)}
              <li data-testid="import-file" data-action={file.action} data-path={file.path}>
                <span class="path">{file.path}</span>
                <span class="action action-{file.action}">{actionText(file, t)}</span>
                {#if file.items.length > 0}
                  <ul class="items">
                    {#each file.items as item, i (i)}
                      <li>{itemText(item, t)}</li>
                    {/each}
                  </ul>
                {/if}
                {#each file.notes as note, i (i)}
                  <p class="note">{note}</p>
                {/each}
              </li>
            {/each}
          </ul>
        </fieldset>
      {/each}
      {#if unchangedGroups > 0}
        {#each preview.groups.filter((g) => !groups.includes(g)) as group (group.id)}
          <p class="same-group" data-testid="import-group" data-group={group.id} data-runnable={group.runnable ? 'true' : 'false'}>
            {groupTitle(group, t)}: {t('configuration.preview.files', { count: group.files.length })}, {t('configuration.action.same')}
          </p>
        {/each}
      {/if}
      {#if preview.keptSettings.length > 0}
        <p class="kept">{t('configuration.preview.kept', { keys: preview.keptSettings.join(', ') })}</p>
      {/if}
      {#if preview.ignoredCount > 0}
        <details class="ignored">
          <summary>{t('configuration.preview.ignoredTitle', { count: preview.ignoredCount })}</summary>
          <ul>
            {#each preview.ignored as line, i (i)}
              <li>{ignoredText(line, t)}</li>
            {/each}
          </ul>
        </details>
      {/if}
      {#if needsTrust}
        <div class="trust" role="group">
          <p>{t('configuration.preview.trust')}</p>
          <label>
            <input type="checkbox" data-testid="import-trust" bind:checked={trusted} disabled={busy} />
            {t('configuration.preview.trustBox')}
          </label>
        </div>
      {/if}
      <p class="counts">{t('configuration.preview.counts', { write: counts.write, same: counts.same })}</p>
    {/if}
    <div class="buttons">
      <button type="button" onclick={cancel} disabled={busy}>
        {preview.ok ? t('configuration.preview.cancel') : t('configuration.preview.close')}
      </button>
      {#if preview.ok}
        <button type="button" class="primary" data-testid="import-confirm" disabled={!enabled} onclick={() => void confirm()}>
          {busy ? t('configuration.preview.busy') : t('configuration.preview.importButton')}
        </button>
      {/if}
    </div>
  </div>
{/snippet}

{#if close}
  <Modal id="import-preview" title={t('configuration.preview.title')} hideOk onCancel={cancel}>
    {@render body()}
  </Modal>
{:else}
  {@render body()}
{/if}

<style>
  .import-preview {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 60vh;
    overflow: auto;
  }
  .source,
  .made-by,
  .counts,
  .kept {
    margin: 0;
    color: var(--text-muted);
  }
  .refusals li {
    color: var(--danger-text);
  }
  .group {
    border: 1px solid var(--border-color);
    border-radius: 4px;
    padding: 4px 8px;
  }
  .group ul {
    list-style: none;
    margin: 4px 0;
    padding-left: 20px;
  }
  .path {
    font-family: var(--font-mono);
  }
  .action {
    margin-left: 8px;
    color: var(--text-muted);
  }
  .action-replace {
    font-weight: 600;
  }
  .count,
  .code {
    margin-left: 6px;
    color: var(--text-muted);
  }
  .items {
    font-family: var(--font-mono);
  }
  .note {
    margin: 2px 0;
    font-style: italic;
  }
  .same-group {
    margin: 0;
    color: var(--text-muted);
  }
  .trust {
    border: 1px solid var(--border-color);
    border-radius: 4px;
    padding: 6px 8px;
  }
  .trust p {
    margin: 0 0 4px;
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
