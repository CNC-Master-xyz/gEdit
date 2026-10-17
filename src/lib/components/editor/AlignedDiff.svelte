<!--
  The aligned NC-aware diff (Phase 4 plan X30, P4.25): the body of the comparison overlay while
  the "Aligned" view is on. `CompareView` owns the toolbar, the review bar and the Esc key and
  mounts this component in place of the raw diff editor; this one owns the container and the
  lifetime of the view in `$lib/monaco/alignedView`.

  The view is registered as the current diff (`setCurrentDiff`), so the navigation buttons, the
  commands of `contrib/compare.ts` and the copy buttons reach it the way they reach the raw
  diff editor. A change of the review toggles realigns it (`recompute`, which reuses the
  normalization the review bar was just built from); a change of either text realigns it by
  itself, a moment after the last keystroke.
-->
<script lang="ts">
  import { get } from 'svelte/store';
  import { compareController } from '$lib/app/compare';
  import { createAlignedView, type AlignedHandle } from '$lib/monaco/alignedView';
  import { hookTyping, type TypingEditor } from '$lib/contrib/typing';
  import { currentDiff, setCurrentDiff } from '$lib/monaco/diff';
  import { t } from '$lib/i18n';

  const content = compareController.content;
  const sides = compareController.sides;
  const reviewOptions = compareController.options;

  let host = $state<HTMLElement | undefined>(undefined);
  let error = $state('');
  /** Deliberately not `$state`: a Monaco object never becomes a Svelte proxy (AD-2). */
  let handle: AlignedHandle | null = null;

  $effect(() => {
    const session = $content;
    const container = host;
    if (!session || !container) return;

    let cancelled = false;
    error = '';
    createAlignedView({
      container,
      modifiedDocId: session.docId,
      sides: get(sides) ?? { original: session.original, modified: { kind: 'document', docId: session.docId } },
      align: (o) => compareController.align(o),
      // Forced upper case and the line-join guard follow the document each pane shows.
      onPane: ({ editor, docId }) => {
        const hooked = hookTyping(editor as unknown as TypingEditor, () => docId);
        return () => hooked.dispose();
      },
      copy: (direction, o) => void compareController.copyChange(direction, { lineOnly: o.lineOnly, thenNext: false }),
    }).then(
      (created) => {
        if (cancelled) {
          created.dispose();
          return;
        }
        handle = created;
        setCurrentDiff(created);
        // The comparison owns the keyboard from here (Esc bubbles out of Monaco to CompareView).
        created.focus();
      },
      (err: unknown) => {
        if (cancelled) return;
        console.error('compare: the aligned view could not be created', err);
        error = t('compare.diffFailed', { error: err instanceof Error ? err.message : String(err) });
      },
    );

    return () => {
      cancelled = true;
      if (handle) {
        if (currentDiff() === handle) setCurrentDiff(null);
        handle.dispose();
        handle = null;
      }
    };
  });

  // The toggles of the review bar decide what is equal: align again. The texts did not change,
  // so the normalization built for the bar is reused.
  $effect(() => {
    void $reviewOptions;
    handle?.recompute({ reuse: true });
  });
</script>

<div class="aligned-host" data-testid="aligned-host" bind:this={host}></div>
{#if error}
  <p class="error" role="alert">{error}</p>
{/if}

<style>
  .aligned-host {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }

  .error {
    flex: 0 0 auto;
    margin: 0;
    padding: 8px 12px;
    color: var(--danger-text);
    font-size: 12px;
    background-color: var(--danger-surface);
  }
</style>
