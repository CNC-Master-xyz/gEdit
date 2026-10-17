<!--
  The editor area (plan §5 WP1.2, §7.9; Phase 4 plan AD-50, §6.7 rule 5).

  The host owns nothing but the layout: one `EditorGroup` per group of `editor.groups`, side by
  side or stacked, with a splitter between two neighbours. Each group builds its own editor when it
  is mounted (`editor.attachGroup`), and the document store decides which model the focused group
  shows. `data-doc-id` mirrors the active document so the runtime harness can tell the documents
  apart; `data-layout` and `data-groups` say how many editors there are and how they lie.

  The groups share the room equally; the splitter moves the border between its two neighbours
  (a drag, or the arrow keys on the focused splitter; a double click makes them equal again).
-->
<script lang="ts">
  import EditorGroup from './EditorGroup.svelte';
  import { editor } from '$lib/monaco/editorService';
  import { docs } from '$lib/stores/documents';
  import { t } from '$lib/i18n';

  const activeId = docs.activeId;
  const groups = editor.groups;

  /** The least a group keeps of the room the two neighbours of a splitter share, as a share of it. */
  const MIN_SHARE = 0.1;
  /** How far one arrow key moves a splitter, as a share of the room its two neighbours share. */
  const STEP = 0.05;

  let loadError = $state('');
  let area = $state<HTMLElement | undefined>(undefined);
  /** The room each group takes, as weights; reset to equal when the layout or the count changes. */
  let sized = $state<{ key: string; weights: number[] }>({ key: '', weights: [] });

  const stacked = $derived($groups.layout === 'stacked');
  const sizeKey = $derived(`${$groups.layout}:${$groups.groups.length}`);
  const weights = $derived(sized.key === sizeKey ? sized.weights : $groups.groups.map(() => 1));

  function onerror(err: unknown): void {
    console.error('Failed to load the Monaco editor', err);
    loadError = t('editor.loadFailed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  function setPair(index: number, share: number): void {
    const next = [...weights];
    const total = next[index] + next[index + 1];
    const clamped = Math.min(Math.max(share, MIN_SHARE), 1 - MIN_SHARE);
    next[index] = total * clamped;
    next[index + 1] = total * (1 - clamped);
    sized = { key: sizeKey, weights: next };
  }

  function slotRect(index: number): DOMRect | undefined {
    return area?.querySelectorAll<HTMLElement>('.slot')[index]?.getBoundingClientRect();
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const element = event.currentTarget as HTMLElement;
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // no live pointer (a synthetic event): the move events still reach this handler
    }
    event.preventDefault();
  }

  function onPointerMove(event: PointerEvent, index: number): void {
    if (event.buttons !== 1) return;
    const before = slotRect(index);
    const after = slotRect(index + 1);
    if (!before || !after) return;
    const start = stacked ? before.top : before.left;
    const room = stacked ? before.height + after.height : before.width + after.width;
    if (room <= 0) return;
    setPair(index, ((stacked ? event.clientY : event.clientX) - start) / room);
  }

  function onKeyDown(event: KeyboardEvent, index: number): void {
    const grow = stacked ? 'ArrowDown' : 'ArrowRight';
    const shrink = stacked ? 'ArrowUp' : 'ArrowLeft';
    if (event.key !== grow && event.key !== shrink) return;
    const total = weights[index] + weights[index + 1];
    setPair(index, weights[index] / total + (event.key === grow ? STEP : -STEP));
    event.preventDefault();
  }
</script>

<div
  class="editor-wrapper"
  data-testid="editor-host"
  data-doc-id={$activeId ?? ''}
  data-layout={$groups.layout}
  data-groups={$groups.groups.length}
>
  <div class="area" class:stacked bind:this={area}>
    {#each $groups.groups as group, index (group.id)}
      {#if index > 0}
        <!-- The ARIA window-splitter pattern; svelte-check reads `separator` as a structure role (see shell/Splitter.svelte). -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
          class="splitter"
          data-testid="editor-splitter"
          data-index={index - 1}
          role="separator"
          tabindex="0"
          aria-orientation={stacked ? 'horizontal' : 'vertical'}
          aria-label={t('splitView.resize')}
          aria-valuenow={Math.round((100 * weights[index - 1]) / (weights[index - 1] + weights[index]))}
          aria-valuemin={Math.round(MIN_SHARE * 100)}
          aria-valuemax={Math.round((1 - MIN_SHARE) * 100)}
          onpointerdown={onPointerDown}
          onpointermove={(event) => onPointerMove(event, index - 1)}
          onkeydown={(event) => onKeyDown(event, index - 1)}
          ondblclick={() => (sized = { key: sizeKey, weights: $groups.groups.map(() => 1) })}
        ></div>
      {/if}
      <div class="slot" style:flex-grow={weights[index] ?? 1}>
        <EditorGroup
          {group}
          {index}
          multiple={$groups.groups.length > 1}
          focused={$groups.focused === group.id}
          {onerror}
        />
      </div>
    {/each}
  </div>
  {#if loadError}
    <div class="editor-error" role="alert">{loadError}</div>
  {/if}
</div>

<style>
  .editor-wrapper {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    /* Not `hidden` (B1 A9). Monaco puts the tips of the find widget's buttons and the
       context menu into its own container as absolutely positioned boxes, and a tip that
       belongs above the first lines lies outside the wrapper: `hidden` cut it off. The
       editor inside is exactly as large as this box (`automaticLayout`), so nothing
       inside it can make the box grow. */
    overflow: visible;
    background-color: var(--bg-app);
  }
  .area {
    display: flex;
    flex-direction: row;
    width: 100%;
    height: 100%;
  }
  .area.stacked {
    flex-direction: column;
  }
  .slot {
    display: flex;
    flex-basis: 0;
    flex-shrink: 1;
    min-width: 0;
    min-height: 0;
  }
  .splitter {
    flex: 0 0 4px;
    background-color: var(--border-color);
    cursor: col-resize;
    touch-action: none;
  }
  .area.stacked > .splitter {
    cursor: row-resize;
  }
  .splitter:hover,
  .splitter:focus-visible {
    background-color: var(--accent);
    outline: none;
  }
  .editor-error {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    color: #f38ba8;
    font-size: 13px;
    text-align: center;
  }
</style>
