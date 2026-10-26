<!--
  One editor group: a box with an optional header and the element its Monaco editor lives in
  (Phase 4 plan AD-50, §6.7 rule 5).

  The group's editor is built by `editor.attachGroup` when this component is mounted and disposed
  by `editor.detachGroup` when it is destroyed; the group itself (its document, its view state)
  stays in the service, so the compare overlay, which unmounts every group and mounts them again,
  loses nothing. `data-ready` is "1" once the editor is built.

  The header shows what the group shows: the document's title, or a channel pane's channel; its
  close button closes this group (`editor.closeGroup`). A single group has no header. The box has
  a border of the width of the active mark in every layout with more than one group, `--accent`
  for the group with the keyboard focus and transparent for the others, so the focus moving
  changes no size (Phase 4 plan §5 P4e decision 4).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import X from 'lucide-svelte/icons/x';
  import { channelPanes } from '$lib/monaco/channelPanes';
  import { editor } from '$lib/monaco/editorService';
  import { docs } from '$lib/stores/documents';
  import { t } from '$lib/i18n';
  import type { EditorGroupInfo } from '$lib/app/types';

  interface Props {
    group: EditorGroupInfo;
    /** The group's place in display order, 0-based. */
    index: number;
    /** More than one group is open: the header and the focus border show. */
    multiple: boolean;
    focused: boolean;
    onerror: (err: unknown) => void;
  }

  const { group, index, multiple, focused, onerror }: Props = $props();

  const list = docs.list;
  const view = channelPanes.state;

  let container = $state<HTMLElement | undefined>(undefined);
  let ready = $state(false);

  onMount(() => {
    const id = group.id;
    if (!container) return;
    editor
      .attachGroup(id, container)
      .then(() => {
        ready = true;
      })
      .catch(onerror);
    return () => {
      ready = false;
      editor.detachGroup(id);
    };
  });

  const content = $derived(group.content);
  const kind = $derived(content?.kind ?? 'document');
  const channelId = $derived(content !== null && 'channelId' in content ? (content.channelId ?? '') : '');
  const docTitle = $derived($list.find((doc) => doc.id === content?.docId)?.title ?? '');
  /** A channel's name as the channel view knows it, else its id. */
  const channelName = $derived($view.panes.find((pane) => pane.groupId === group.id)?.name ?? channelId);
  /** The close button's name: a channel pane names its channel (v1.2.0 T030); another group is "Close this pane". */
  const closeLabel = $derived(channelId === '' ? t('splitView.closeGroup') : t('channelPanes.closePane', { channel: channelName }));
  const title = $derived.by(() => {
    if (channelId === '') return docTitle;
    // A pane of a program shows the channel; one file per channel shows the file as well.
    return kind === 'pane' ? channelName : `${channelName} · ${docTitle}`;
  });
</script>

<div
  class="group"
  class:multiple
  class:focused={multiple && focused}
  data-testid="editor-group"
  data-group={group.id}
  data-index={index}
  data-doc-id={content?.docId ?? ''}
  data-kind={kind}
  data-channel={channelId}
  data-focused={focused ? 'true' : 'false'}
  data-ready={ready ? '1' : '0'}
>
  {#if multiple}
    <!-- A click on the header gives the group the focus, as a click into its editor does. -->
    <div
      class="header"
      data-testid="editor-group-header"
      data-group={group.id}
      role="presentation"
      onpointerdown={() => editor.focusGroup(group.id)}
    >
      <span class="title" title={title}>{title}</span>
      <button
        type="button"
        class="close"
        data-testid="editor-group-close"
        data-group={group.id}
        aria-label={closeLabel}
        title={closeLabel}
        onpointerdown={(event) => event.stopPropagation()}
        onclick={() => editor.closeGroup(group.id)}
      >
        <X size={14} />
      </button>
    </div>
  {/if}
  <div class="surface" bind:this={container}></div>
</div>

<style>
  .group {
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
    background-color: var(--bg-app);
  }
  /* The same width for every group, so the focus moving moves nothing. */
  .group.multiple {
    border: 2px solid transparent;
    box-sizing: border-box;
  }
  .group.focused {
    border-color: var(--accent);
  }
  .header {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 0 0 auto;
    height: 24px;
    padding: 0 4px 0 8px;
    background-color: var(--bg-panel);
    border-bottom: 1px solid var(--border-color);
    font-size: 12px;
    color: var(--text-muted);
  }
  .group.focused .header {
    color: var(--text-main);
  }
  .title {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .close:hover {
    background-color: var(--surface-hover);
  }
  .surface {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }
</style>
