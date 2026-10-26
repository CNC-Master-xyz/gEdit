<!--
  The print view (Phase 4 plan §6.5 rule 10, P4.15). `app/print.ts` mounts it on `document.body` just before
  `window.print()` and removes it afterwards (`afterprint`, the next print, the document closing, five minutes).

  **What it is.** Hidden on screen. In print it is the only thing the page shows: everything else in the body is
  `display: none` there. One `.print-page` box per page of the model, of a fixed size, with a page break after it.
  The model (`buildPrintDocument`) did the cutting; this component draws rows as they are and never wraps or
  measures anything.

  **Document text is text.** Every string below is interpolated with `{…}`, which Svelte escapes; there is no
  `{@html}` here and there must never be one: an NC comment can hold `<script>`.

  Test ids (plan §6.11): `print-view` (`data-pages`, `data-colors`, `data-scope`, `data-line-numbers`),
  `print-page` (`data-page`), `print-line` (`data-line`, empty on a continuation row).
-->
<script lang="ts">
  import { t } from '$lib/i18n';
  import {
    PRINT_FONT_STACK,
    PRINT_HEADER_ROWS,
    PRINT_LINE_EM,
    PRINT_PAGE_WIDTH_MM,
    gutterText,
    pageHeightEm,
  } from './printStyle';
  import type { PrintDocument } from '$lib/app/print';

  let { doc }: { doc: PrintDocument } = $props();
</script>

<div
  class="print-root"
  data-testid="print-view"
  data-pages={doc.pages.length}
  data-colors={doc.options.colors}
  data-scope={doc.options.scope}
  data-line-numbers={doc.gutter > 0 ? '1' : '0'}
  style:font-family={PRINT_FONT_STACK}
  style:font-size="{doc.options.fontPt}pt"
  style:line-height={PRINT_LINE_EM}
  style:--page-width="{PRINT_PAGE_WIDTH_MM}mm"
  style:--page-height="{pageHeightEm(doc.rows)}em"
  style:--head-height="{PRINT_HEADER_ROWS * PRINT_LINE_EM}em"
  style:--row-height="{PRINT_LINE_EM}em"
>
  {#each doc.pages as page (page.number)}
    <section class="print-page" data-testid="print-page" data-page={page.number}>
      <header class="print-head">
        <span class="print-name">{doc.title}</span>
        <span class="print-date">{doc.date}</span>
        <span class="print-of">{t('print.pageOf', { page: page.number, pages: doc.pages.length })}</span>
      </header>
      {#each page.rows as row}
        <!-- One line, no blanks between the parts: the row is `white-space: pre` and a blank would shift the columns. -->
        <div class="print-row" data-testid="print-line" data-line={row.line ?? ''}>{#if doc.gutter > 0}<span class="print-num">{gutterText(row.line, doc.gutter)}</span>{/if}{#each row.spans as span}{#if span.color !== undefined}<span style:color={span.color}>{span.text}</span>{:else}{span.text}{/if}{/each}</div>
      {/each}
    </section>
  {/each}
</div>

<style>
  /* Not on screen: the view exists only for the print operation. */
  @media screen {
    .print-root {
      display: none;
    }
  }

  .print-root {
    color: var(--print-ink);
    background: var(--print-paper);
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .print-page {
    width: var(--page-width);
    height: var(--page-height);
    overflow: hidden;
    break-after: page;
    page-break-after: always;
  }
  .print-page:last-child {
    break-after: auto;
    page-break-after: auto;
  }

  .print-head {
    display: flex;
    gap: 2em;
    box-sizing: border-box;
    height: var(--head-height);
    border-bottom: 0.5pt solid var(--print-ink);
    white-space: pre;
  }
  .print-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .print-of {
    text-align: right;
  }

  .print-row {
    height: var(--row-height);
    overflow: hidden;
    white-space: pre;
  }
  .print-num {
    color: var(--print-ink-muted);
  }
  .print-root[data-colors='black'] .print-num {
    color: var(--print-ink);
  }

  /* In print it is the only visible thing: the application and its dialogs are out of the page flow. */
  @media print {
    @page {
      margin: 15mm;
    }
    :global(html),
    :global(body) {
      height: auto !important;
      overflow: visible !important;
      background: var(--print-paper) !important;
    }
    :global(body > :not(.print-root)) {
      display: none !important;
    }
  }
</style>
