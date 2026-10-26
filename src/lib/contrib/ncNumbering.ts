// The NC tab, "Numbering" group: renumber blocks and remove block numbers
// (plan §5 WP4.2 and WP6.3). Owner: WP6.3. One feature per file (plan AD-3); see
// ./README.md.
//
// There is no logic here on purpose. `TransformService.run` is the whole sequence —
// availability, the options form, the preflight confirmation, the run, the edit, the
// summary and the results (plan §7.3) — so a transform command is one call, and every
// transform behaves the same. M6 adds an options form to "Remove Block Numbers" (one
// checkbox, "Keep numbers that are pointed at") and takes the preflight off the renumber
// runs whose references it can follow; both come out of the transform definitions, and
// neither is visible here. The same holds for P4d's advanced options (plan §6.6 rules 1–7:
// fit to the maximum, a column for the code, every Nth block, skipped texts and regions, a
// start text): they are fields of the renumber form, built by `renumber.options()` from the
// profile and remembered per profile by the transform service, and a run an option refuses
// comes back unchanged with the reason as its summary.
//
// No shortcuts: §7.11 lists every default binding, and neither of these is in it. Both
// commands stay enabled while a document is open even on a dialect that cannot run them;
// `available()` answers with the reason, which the status bar shows. A disabled button
// with no explanation would leave the user guessing why.

import ListOrdered from 'lucide-svelte/icons/list-ordered';
import ListX from 'lucide-svelte/icons/list-x';
import { asIcon } from '$lib/app/icons';
import { transforms } from '$lib/app/transforms';
import { removeBlockNumbers } from '$lib/core/transforms/removeBlockNumbers';
import { renumber } from '$lib/core/transforms/renumber';
import { renumberOthers } from '$lib/app/renumberOthers';
import { docs } from '$lib/stores/documents';
import type { CommandContext, Contribution } from '$lib/app/types';

function hasDocument(context: CommandContext): boolean {
  return context.activeDocId !== null;
}

export default {
  id: 'ncNumbering',
  commands: [
    {
      id: 'nc.renumber',
      title: 'ncNumbering.renumber.title',
      category: 'ncNumbering.category',
      icon: asIcon(ListOrdered),
      global: true,
      enabled: hasDocument,
      // P4d (plan §6.6 rule 11): the references from the other open documents are listed
      // after the run, by the document that was active when it started.
      run: async () => {
        const docId = docs.getActiveId();
        renumberOthers.afterRenumber(docId, await transforms.run(renumber));
      },
    },
    {
      id: 'nc.removeBlockNumbers',
      title: 'ncNumbering.removeBlockNumbers.title',
      category: 'ncNumbering.category',
      icon: asIcon(ListX),
      global: true,
      enabled: hasDocument,
      run: () => transforms.run(removeBlockNumbers),
    },
  ],
  // A group's place in the tab is the smallest `order` its entries carry
  // (`components/shell/ribbonModel.ts`), so 5 puts Numbering before Cleanup's 10. Both
  // groups started at 10 and the tie was broken by first appearance — the alphabetical
  // load order of `contrib/ncCleanup.ts` — which put Cleanup first for no reason anyone
  // chose and would have moved again the next time a contribution file was renamed.
  ribbon: [
    { tab: 'nc', group: 'ncNumbering.group', command: 'nc.renumber', order: 5 },
    { tab: 'nc', group: 'ncNumbering.group', command: 'nc.removeBlockNumbers', order: 15 },
  ],
} satisfies Contribution;
