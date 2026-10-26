// Puts the print view on the page and takes it off again (P4.15). The only place that touches `document` for it, so
// `app/print.ts` is tested with a fake of this function.

import { mount, unmount } from 'svelte';
import PrintView from './PrintView.svelte';
import type { PrintDocument, PrintViewHandle } from '$lib/app/print';

/** Mounts `PrintView` as the last child of `document.body`; `destroy` removes it. */
export function mountPrintView(doc: PrintDocument): PrintViewHandle {
  const instance = mount(PrintView, { target: document.body, props: { doc } });
  return {
    destroy() {
      void unmount(instance);
    },
  };
}
