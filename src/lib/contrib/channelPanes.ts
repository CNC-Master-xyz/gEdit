// The channel view: the channels of a multi-channel program side by side, lined up at their wait
// codes (Phase 4 plan AD-50, AD-51, §6.7, §6.11; P4.22b). One feature per file (plan AD-3); see
// ./README.md.
//
// `channels.sideBySide` opens one pane per channel: for a program with channel sections, from the
// sections of the active document; for one file per channel, from the channel documents that are
// open. A channel file that exists next to the document and is not open is offered through the
// file dialog, in the document's folder, as "Open channel 2…" does (standing rule 14: the webview
// reads no file the user did not pick), and the view goes on with what is open afterwards. The
// panes themselves are `monaco/channelPanes.ts`; the bar above them is `ChannelViewBar.svelte`;
// Close Split (`contrib/splitView.ts`) closes the view. No key: the usual split keys need AltGr on
// the owner's Swiss German keyboard (Phase 4 plan §5 P4e decision 13).

import Columns3 from 'lucide-svelte/icons/columns-3';
import ChannelViewBar from '$lib/components/editor/ChannelViewBar.svelte';
import { asIcon } from '$lib/app/icons';
import { dialogs } from '$lib/app/dialogs';
import { files } from '$lib/app/fileOps';
import { status } from '$lib/app/status';
import { channelPanes } from '$lib/monaco/channelPanes';
import { channels } from '$lib/stores/channels';
import { docs } from '$lib/stores/documents';
import { t } from '$lib/i18n';
import type { CommandContext, Contribution, DocId, Msg } from '$lib/app/types';

function say(msg: Msg, error = false): void {
  status.show(t(msg.key, msg.params), error ? { error: true } : undefined);
}

/** The machine of the document has a channel layout (the command is offered); whether the program has the channels is the run's answer. */
function offered(context: CommandContext): boolean {
  return context.activeDocId !== null && !context.compareOpen && channels.params(context.activeDocId) !== null;
}

/** The folder of the document, for the file dialog; undefined for a document without a path. */
function folderOf(id: DocId): string | undefined {
  const path = docs.get(id)?.path ?? null;
  const slash = path === null ? -1 : Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return path !== null && slash > 0 ? path.slice(0, slash) : undefined;
}

/**
 * Channel files that exist beside the document and are not open: the user is asked, through the
 * file dialog in the document's folder, which to open. Nothing is opened by itself, and a dialog
 * that picks nothing leaves the view to the files that are open.
 */
async function offerSiblings(id: DocId): Promise<void> {
  try {
    await channels.siblings(id);
  } catch {
    return; // the lookup is metadata only; a failure leaves the files that are open
  }
  const waiting = channels.fresh(id).members.filter((m) => m.kind === 'file' && m.docId === null && m.exists);
  if (waiting.length === 0) return;
  say({ key: 'channelPanes.openOthers.hint' });
  const picked = await dialogs.exclusive(() => dialogs.openFiles({ multiple: true, defaultPath: folderOf(id) }));
  if (picked === undefined) return;
  if (picked.length === 0) {
    say({ key: 'channelPanes.openOthers.none' });
    return;
  }
  await files.open(picked);
}

async function sideBySide(): Promise<void> {
  const id = docs.getActiveId();
  if (id === null) return;
  if (channels.fresh(id).layout === 'multi-file') await offerSiblings(id);
  const answer = await channelPanes.open(id);
  if (!answer.ok) say(answer.reason, true);
}

export default {
  id: 'channelPanes',
  commands: [
    {
      id: 'channels.sideBySide',
      title: 'channelPanes.sideBySide',
      category: 'channelPanes.category',
      icon: asIcon(Columns3),
      global: true,
      enabled: offered,
      run: () => sideBySide(),
    },
  ],
  ribbon: [{ tab: 'nc', group: 'channels.group', command: 'channels.sideBySide', order: 94 }],
  panels: [{ id: 'channelViewBar', region: 'banner', title: 'channelPanes.bar.title', component: ChannelViewBar, order: 20 }],
} satisfies Contribution;
