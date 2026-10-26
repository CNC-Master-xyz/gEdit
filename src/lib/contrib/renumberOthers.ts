// References in the other open documents after a renumber (plan §6.6 rules 11–13, AD-49,
// Q4-17). Owner: **P4.20**. One feature per file (plan AD-3); see ./README.md.
//
// Registers `nc.updateOtherReferences` ("Update References in Other Documents…", NC tab,
// Numbering group, after Renumber Blocks and before Remove Block Numbers; no key). It is
// enabled while the list from the last renumber has a reference it may write (`renumberOthers.canUpdate()`), and
// runs `renumberOthers.update()`, which asks once, writes each document as its own undo step
// and says its answer in the status bar (`app/renumberOthers.ts`; texts in
// `i18n/en/renumberOthers.ts`). There is no logic here on purpose.
//
// `activate()` forwards the service's `revision` to the command registry: the list appears
// and goes without any document, selection or layout change, which are the only things the
// ribbon watches on its own.

import FilePen from 'lucide-svelte/icons/file-pen-line';
import { asIcon } from '$lib/app/icons';
import { renumberOthers } from '$lib/app/renumberOthers';
import { notifyContextChanged } from '$lib/app/registry/commands';
import type { Contribution } from '$lib/app/types';

export default {
  id: 'renumberOthers',
  commands: [
    {
      id: 'nc.updateOtherReferences',
      title: 'renumberOthers.update',
      category: 'ncNumbering.category',
      icon: asIcon(FilePen),
      global: true,
      enabled: () => renumberOthers.canUpdate(),
      run: async () => {
        await renumberOthers.update();
      },
    },
  ],
  // Between Renumber Blocks (5) and Remove Block Numbers (15), `contrib/ncNumbering.ts`.
  ribbon: [{ tab: 'nc', group: 'ncNumbering.group', command: 'nc.updateOtherReferences', order: 10 }],
  activate() {
    return renumberOthers.revision.subscribe(() => notifyContextChanged());
  },
} satisfies Contribution;
