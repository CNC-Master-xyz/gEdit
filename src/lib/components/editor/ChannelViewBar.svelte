<!--
  The bar above the channel panes (Phase 4 plan AD-50, AD-51, §6.7 rule 14, §6.11; P4.22b).

  A `banner` panel, so `AppShell` renders it above the editor while the channel view is open and
  not at all otherwise. It says how the view was made (one program with channel sections, or one
  file per channel), which channels are not shown, how many lines are in no channel (sections only)
  and how many of the waits are lined up; its button closes the view.

  Test id `channel-view-bar` with `data-layout` (`single-file` | `multi-file`), `data-not-shown`
  (the channel ids, comma-separated), `data-outside`, `data-matched` and `data-unmatched`; the
  close button has `data-action="close"`.
-->
<script lang="ts">
  import X from 'lucide-svelte/icons/x';
  import { channelPanes } from '$lib/monaco/channelPanes';
  import { channels } from '$lib/stores/channels';
  import { t } from '$lib/i18n';

  const view = channelPanes.state;

  /** A channel's name as the machine declares it, else its id. */
  function nameOf(docId: string | null, id: string): string {
    if (docId === null) return id;
    return channels.params(docId)?.list.find((c) => c.id === id)?.name ?? id;
  }

  const notShown = $derived($view.notShown.map((id) => nameOf($view.docId, id)));
  const total = $derived($view.marks.matched + $view.marks.unmatched);
</script>

{#if $view.open}
  <div
    class="bar"
    data-testid="channel-view-bar"
    data-layout={$view.layout ?? ''}
    data-not-shown={$view.notShown.join(',')}
    data-outside={$view.outsideLines}
    data-matched={$view.marks.matched}
    data-unmatched={$view.marks.unmatched}
    role="status"
    aria-label={t('channelPanes.bar.label')}
  >
    <span class="part layout">{$view.layout === 'multi-file' ? t('channelPanes.bar.layoutFiles') : t('channelPanes.bar.layoutSections')}</span>
    {#if total > 0}
      <span class="part" class:warn={$view.marks.unmatched > 0} data-part="marks">
        {t('channelPanes.bar.marks', { matched: $view.marks.matched, total })}{#if $view.marks.unmatched > 0}, {t('channelPanes.bar.unmatched', { count: $view.marks.unmatched })}{/if}
      </span>
    {/if}
    {#if notShown.length > 0}
      <span class="part" data-part="not-shown">{t('channelPanes.bar.notShown', { channels: notShown.join(', ') })}</span>
    {/if}
    {#if $view.outsideLines > 0}
      <span class="part" data-part="outside">{t('channelPanes.bar.outside', { count: $view.outsideLines })}</span>
    {/if}
    <button
      type="button"
      class="close"
      data-action="close"
      title={t('channelPanes.bar.closeHint')}
      aria-label={t('channelPanes.bar.close')}
      onclick={() => channelPanes.close()}
    >
      <X size={14} />
      <span>{t('channelPanes.bar.close')}</span>
    </button>
  </div>
{/if}

<style>
  .bar {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 16px;
    padding: 2px 8px;
    font-size: 12px;
    color: var(--text-main);
    background-color: var(--bg-ribbon);
    border-bottom: 1px solid var(--border-color);
  }
  .part {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .layout {
    color: var(--text-muted);
  }
  .warn {
    color: var(--warning);
  }
  .close {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
    flex: 0 0 auto;
    padding: 1px 8px;
    color: var(--text-main);
    font: inherit;
    font-size: 12px;
    background-color: var(--bg-app);
    border: 1px solid var(--border-color);
    border-radius: 2px;
    cursor: pointer;
  }
  .close:hover {
    color: var(--text-active);
    background-color: var(--surface-hover);
  }
</style>
