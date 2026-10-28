// Compare with an open document, a file or the saved version (plan §5 WP2.5, §7.11).
// One feature per file (plan AD-3); see ./README.md.
//
// Only `compare.with` has a shortcut (Mod+Alt+C, §7.11). The navigation commands
// deliberately have none: F7 and Shift+F7 belong to `nav.nextTool`/`nav.prevTool` from M3
// on, and a key conflict is a `console.error` the runtime harness fails on. Esc is not a
// binding either — `CompareView` handles it itself, so Monaco's find widget still gets
// the first Esc.
//
// M11 (AD-26): the review mode and the merge. `compare.copyToModified` and
// `compare.copyToOriginal` take `Mod+Alt+Right` / `Mod+Alt+Left` and are enabled only while a
// comparison is open (§7.13); they copy the change block at the cursor and go on to the next
// one, and an argument `{ lineOnly: true }` copies the one line. `compare.exportDiff` takes
// `{ normalized }` (default: review mode's). `compare.files` needs no document.
//
// P4.31 (plan §6.8.6): a program with channel sections is compared whole or limited to one
// channel. The question (`askChannel`) comes after the other side is chosen, for a document or
// the saved version (a file that is not open has no machine, so it has no channel to cut);
// the first answer is the whole program. A command given its document as an argument (the
// external-change banner) is never asked.
//
// `compare.withSaved` takes `{ docId }`, which is how the external-change banner (WP2.3)
// reaches it for the document the banner belongs to.

import FileDiff from 'lucide-svelte/icons/file-diff';
import { asIcon } from '$lib/app/icons';
import { get } from 'svelte/store';
import { compareController, autoTarget, availableSources, documentTargets } from '$lib/app/compare';
import CompareView from '$lib/components/editor/CompareView.svelte';
import { currentDiff } from '$lib/monaco/diff';
import { dialogs } from '$lib/app/dialogs';
import { modals } from '$lib/app/modals';
import { status } from '$lib/app/status';
import { scopableChannels } from '$lib/core/channels/scope';
import { channels } from '$lib/stores/channels';
import { docs } from '$lib/stores/documents';
import { t } from '$lib/i18n';
import type {
  CommandContext,
  CompareSource,
  Contribution,
  DocId,
  QuickPickItem,
} from '$lib/app/types';
import type { CompareSourceKind } from '$lib/app/compare';

/** The id of the overlay panel; `app/compare.ts` opens the region by this name. */
const PANEL_ID = 'compare';

/** The document a compare command works on: the argument's, else the active one. */
function targetDoc(context: CommandContext, arg?: unknown): DocId | null {
  if (arg && typeof arg === 'object' && typeof (arg as { docId?: unknown }).docId === 'string') {
    return (arg as { docId: string }).docId;
  }
  if (typeof arg === 'string') return arg;
  return context.activeDocId;
}

function hasDocument(context: CommandContext): boolean {
  return context.activeDocId !== null;
}

function hasOtherDocument(context: CommandContext): boolean {
  return context.activeDocId !== null && docs.all().length > 1;
}

function activeHasPath(context: CommandContext): boolean {
  const id = context.activeDocId;
  return id !== null && (docs.get(id)?.path ?? null) !== null;
}

/** One entry of the `compare.with` picker. Written out, so `i18n/keys.test.ts` sees the keys. */
function sourceItem(kind: CompareSourceKind): QuickPickItem<CompareSourceKind> {
  if (kind === 'saved') {
    return { label: t('compare.sourceSaved'), detail: t('compare.sourceSavedDetail'), value: kind };
  }
  if (kind === 'document') {
    return { label: t('compare.sourceDocument'), detail: t('compare.sourceDocumentDetail'), value: kind };
  }
  return { label: t('compare.sourceFile'), detail: t('compare.sourceFileDetail'), value: kind };
}

/**
 * The question of P4.31: whole program or one channel. `{}` is the whole program, `{ channel }` a
 * channel id, undefined a cancelled question. A program without channel sections is not asked.
 */
export async function askChannel(docId: DocId): Promise<{ channel?: string } | undefined> {
  const offered = scopableChannels(channels.fresh(docId), channels.params(docId));
  if (offered.length === 0) return {};
  const items: QuickPickItem<string | null>[] = [
    { label: t('channelScope.compare.whole'), detail: t('channelScope.compare.wholeDetail'), value: null },
    ...offered.map((c) => ({ label: c.name, detail: t('channelScope.compare.channelDetail'), value: c.id })),
  ];
  const picked = await modals.quickPick(items, { placeholder: t('channelScope.compare.placeholder') });
  if (picked === undefined) return undefined;
  return picked === null ? {} : { channel: picked };
}

/** Opens the comparison, after the channel question when `ask` (a command run by hand). */
async function openCompare(docId: DocId, source: CompareSource, ask: boolean): Promise<void> {
  const scope = ask && source.kind !== 'file' ? await askChannel(docId) : {};
  if (scope === undefined) return;
  await compareController.open(docId, source, scope);
}

async function withDocument(docId: DocId, ask = true): Promise<void> {
  const all = docs.all();
  const auto = autoTarget(all, docId);
  if (auto !== null) {
    await openCompare(docId, { kind: 'document', docId: auto }, ask);
    return;
  }
  const targets = documentTargets(all, docId);
  if (targets.length === 0) {
    status.show(t('compare.noOtherDocument'), { error: true });
    return;
  }
  const items: QuickPickItem<DocId>[] = targets.map((doc) => ({
    label: doc.title,
    description: doc.path ?? undefined,
    value: doc.id,
  }));
  const picked = await modals.quickPick(items, { placeholder: t('compare.pickDocument') });
  if (picked === undefined) return;
  await openCompare(docId, { kind: 'document', docId: picked }, ask);
}

async function withFile(docId: DocId): Promise<void> {
  // `dialogs.pickFile` grants the chosen path in the fs scope, the same way `open` does
  // (F3), so `files.readDisk` may read it afterwards.
  const path = await dialogs.exclusive(() => dialogs.pickFile({ title: t('compare.pickFileTitle') }));
  if (!path) return;
  await compareController.open(docId, { kind: 'file', path });
}

async function withSaved(docId: DocId, ask = true): Promise<void> {
  await openCompare(docId, { kind: 'saved' }, ask);
}

/** `{ lineOnly, thenNext }` from a command argument; the keys go on to the next change. */
function copyOptions(arg: unknown): { lineOnly: boolean; thenNext: boolean } {
  const given = arg && typeof arg === 'object' ? (arg as { lineOnly?: unknown; thenNext?: unknown }) : {};
  const lineOnly = given.lineOnly === true;
  return { lineOnly, thenNext: typeof given.thenNext === 'boolean' ? given.thenNext : !lineOnly };
}

async function withAny(docId: DocId, ask = true): Promise<void> {
  const kinds = availableSources(docs.get(docId), docs.all().length);
  if (kinds.length === 0) {
    status.show(t('compare.noDocument'), { error: true });
    return;
  }
  const picked = await modals.quickPick(kinds.map(sourceItem), {
    placeholder: t('compare.pickSource'),
  });
  if (picked === undefined) return;
  if (picked === 'saved') await withSaved(docId, ask);
  else if (picked === 'document') await withDocument(docId, ask);
  else await withFile(docId);
}

export default {
  id: 'compare',
  panels: [
    {
      id: PANEL_ID,
      region: 'overlay',
      title: 'compare.title',
      component: CompareView,
      order: 10,
    },
  ],
  commands: [
    {
      id: 'compare.with',
      title: 'compare.with',
      category: 'compare.category',
      icon: asIcon(FileDiff),
      keys: 'Mod+Alt+C',
      global: true,
      enabled: hasDocument,
      run: (context, arg) => {
        const id = targetDoc(context, arg);
        return id === null ? undefined : withAny(id, arg === undefined);
      },
    },
    {
      id: 'compare.withDocument',
      title: 'compare.withDocument',
      category: 'compare.category',
      global: true,
      enabled: hasOtherDocument,
      run: (context, arg) => {
        const id = targetDoc(context, arg);
        return id === null ? undefined : withDocument(id, arg === undefined);
      },
    },
    {
      id: 'compare.withFile',
      title: 'compare.withFile',
      category: 'compare.category',
      global: true,
      enabled: hasDocument,
      run: (context, arg) => {
        const id = targetDoc(context, arg);
        return id === null ? undefined : withFile(id);
      },
    },
    {
      id: 'compare.withSaved',
      title: 'compare.withSaved',
      category: 'compare.category',
      global: true,
      // The argument may name another document, but the enablement can only see the
      // active one; `open()` refuses an untitled document again, with its own message.
      enabled: activeHasPath,
      run: (context, arg) => {
        const id = targetDoc(context, arg);
        return id === null ? undefined : withSaved(id, arg === undefined);
      },
    },
    {
      id: 'compare.close',
      title: 'compare.close',
      category: 'compare.category',
      global: true,
      enabled: (context) => context.compareOpen,
      run: () => compareController.close(),
    },
    {
      id: 'compare.nextDiff',
      title: 'compare.nextDiff',
      category: 'compare.category',
      global: true,
      enabled: (context) => context.compareOpen,
      run: () => currentDiff()?.goToDiff('next'),
    },
    {
      id: 'compare.prevDiff',
      title: 'compare.prevDiff',
      category: 'compare.category',
      global: true,
      enabled: (context) => context.compareOpen,
      run: () => currentDiff()?.goToDiff('previous'),
    },
    {
      id: 'compare.toggleInline',
      title: 'compare.toggleInline',
      category: 'compare.category',
      global: true,
      enabled: (context) => context.compareOpen,
      run: () => compareController.toggleInline(),
    },
    {
      id: 'compare.toggleReview',
      title: 'compare.toggleReview',
      category: 'compare.category',
      global: true,
      enabled: (context) => context.compareOpen,
      run: () => compareController.toggleMode(),
    },
    {
      id: 'compare.toggleAligned',
      title: 'compare.toggleAligned',
      category: 'compare.category',
      global: true,
      enabled: (context) => context.compareOpen,
      run: () => compareController.toggleAligned(),
    },
    {
      id: 'compare.copyToModified',
      title: 'compare.copyToModified',
      category: 'compare.category',
      keys: 'Mod+Alt+Right',
      global: true,
      enabled: (context) => context.compareOpen,
      run: (_context, arg) => compareController.copyChange('toModified', copyOptions(arg)),
    },
    {
      id: 'compare.copyToOriginal',
      title: 'compare.copyToOriginal',
      category: 'compare.category',
      keys: 'Mod+Alt+Left',
      global: true,
      enabled: (context) => context.compareOpen,
      run: (_context, arg) => compareController.copyChange('toOriginal', copyOptions(arg)),
    },
    {
      id: 'compare.copyWordToModified',
      title: 'compare.copyWordToModified',
      category: 'compare.category',
      global: true,
      enabled: (context) => context.compareOpen,
      run: () => compareController.copyWord('toModified'),
    },
    {
      id: 'compare.copyWordToOriginal',
      title: 'compare.copyWordToOriginal',
      category: 'compare.category',
      global: true,
      enabled: (context) => context.compareOpen,
      run: () => compareController.copyWord('toOriginal'),
    },
    {
      id: 'compare.exportDiff',
      title: 'compare.exportDiff',
      category: 'compare.category',
      global: true,
      enabled: (context) => context.compareOpen,
      run: (_context, arg) => {
        const given = arg && typeof arg === 'object' ? (arg as { normalized?: unknown }) : {};
        const normalized =
          typeof given.normalized === 'boolean' ? given.normalized : get(compareController.mode) === 'review';
        return compareController.exportDiff({ normalized });
      },
    },
    {
      id: 'compare.files',
      title: 'compare.files',
      category: 'compare.category',
      global: true,
      run: () => compareController.openFiles(),
    },
  ],
  ribbon: [
    { tab: 'tools', group: 'compare.group', command: 'compare.with', order: 10 },
    { tab: 'tools', group: 'compare.group', command: 'compare.files', order: 11 },
  ],
} satisfies Contribution;
