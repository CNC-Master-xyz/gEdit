// The File tab's "Print" group (Phase 4 plan §6.5 rule 10, P4.15): `file.print` (Mod+P) and `file.exportHtml`.
// One feature per file (plan AD-3); see ./README.md.
//
// Both commands ask the same form (scope, colours, line numbers, font size; remembered in
// `uiState.lastParams['print']`) and hand the answer to `app/print.ts`, which builds the pages and does the rest:
// the hidden print view and the system's print dialog for Print, one HTML file through the save dialog for Export.
//
// **Neither command has an `enabled` rule.** The key dispatcher swallows a key only for a command that is enabled,
// and a `Mod+P` that is let through would reach the webview's own print shortcut and print the application's window
// (WebView2 has one). Without a program the command runs and says so in the status bar instead.
//
// The dispatcher also lets a key through while a modal is open and in a text field (it owns those keys), so
// `activate` adds a bubble-phase `keydown` listener on the window that swallows the chord in exactly those cases
// and runs nothing: a print there would be the application's window, a blank page. It decides from the same
// conditions as the dispatcher (modal open, editable target) instead of from whether the dispatcher ran, so it does
// not matter which of the two listeners the window calls first.

import FileCode from 'lucide-svelte/icons/file-code';
import Printer from 'lucide-svelte/icons/printer';
import { dialogs } from '$lib/app/dialogs';
import { asIcon } from '$lib/app/icons';
import { modals } from '$lib/app/modals';
import { PRINT_FORM_KEY, optionsFromValues, print, printFields } from '$lib/app/print';
import type { PrintOptions, PrintService } from '$lib/app/print';
import { isEditableTarget } from '$lib/app/keys/dispatcher';
import { initialValues } from '$lib/core/forms/values';
import { matchesKey } from '$lib/core/keys/keySpec';
import { t } from '$lib/i18n';
import { editor } from '$lib/monaco/editorService';
import { isMacPlatform } from '$lib/utils/platform';
import { uiState } from '$lib/stores/uiState';
import type { Contribution, Disposable, EditorService, Modals, NativeDialogs, UiStateStore } from '$lib/app/types';

/** What the two commands need, injected so a unit test needs neither Monaco nor a webview. */
export interface PrintCommandDeps {
  editor: Pick<EditorService, 'selectionLines'>;
  modals: Pick<Modals, 'form'>;
  dialogs: Pick<NativeDialogs, 'exclusive'>;
  uiState: Pick<UiStateStore, 'getLastParams' | 'setLastParams'>;
  print: Pick<PrintService, 'print' | 'exportHtml'>;
  t: (key: string) => string;
}

/** Asks the form; undefined when the user cancelled. The selection, when there is one, is the default scope. */
export async function askPrintOptions(
  deps: Pick<PrintCommandDeps, 'editor' | 'modals' | 'uiState' | 't'>,
  title: string,
  okLabel: string,
): Promise<PrintOptions | undefined> {
  const selection = deps.editor.selectionLines();
  const hasSelection = selection !== null && !selection.empty;
  const fields = printFields(hasSelection);
  const values = {
    ...initialValues(fields, deps.uiState.getLastParams(PRINT_FORM_KEY)),
    // What was printed last time does not say what is wanted now: with a selection it is the selection.
    scope: hasSelection ? 'selection' : 'document',
  };
  const answered = await deps.modals.form({ title, fields, values, okLabel });
  if (answered === undefined) return undefined;
  deps.uiState.setLastParams(PRINT_FORM_KEY, answered);
  return optionsFromValues(answered, hasSelection);
}

/** `file.print`. */
export async function runPrint(deps: PrintCommandDeps): Promise<void> {
  const options = await askPrintOptions(deps, deps.t('print.print'), deps.t('print.form.okPrint'));
  if (options !== undefined) await deps.print.print(options);
}

/** `file.exportHtml`: the save dialog is a native dialog, so it takes the one-chain lock (`dialogs.exclusive`). */
export async function runExportHtml(deps: PrintCommandDeps): Promise<void> {
  const options = await askPrintOptions(deps, deps.t('print.exportHtml'), deps.t('print.form.okExport'));
  if (options !== undefined) await deps.dialogs.exclusive(() => deps.print.exportHtml(options));
}

/** What the swallowing listener reads off a keydown event; `KeyboardEvent` satisfies it. */
export interface ChordEvent {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
  target: unknown;
  preventDefault(): void;
}

/**
 * Takes `Mod+P` away from the webview in the two places the dispatcher leaves it alone, a modal and a text field,
 * without printing. Returns true when it swallowed the event; an event someone else already took is left as it is.
 */
export function swallowPrintChord(e: ChordEvent, env: { isModalOpen: boolean; isMac: boolean }): boolean {
  if (e.defaultPrevented) return false;
  if (!matchesKey('Mod+P', e, env.isMac)) return false;
  if (!env.isModalOpen && !isEditableTarget(e.target)) return false; // the dispatcher takes it and prints
  e.preventDefault();
  return true;
}

const deps: PrintCommandDeps = { editor, modals, dialogs, uiState, print, t: (key) => t(key) };

export default {
  id: 'print',
  activate(): Disposable {
    if (typeof window === 'undefined') return () => {};
    let modalOpen = false;
    const unsubscribe = modals.isOpen.subscribe((open) => {
      modalOpen = open;
    });
    const isMac = isMacPlatform();
    const onKeyDown = (e: KeyboardEvent): void => {
      swallowPrintChord(e, { isModalOpen: modalOpen, isMac });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      unsubscribe();
    };
  },
  commands: [
    {
      id: 'file.print',
      title: 'print.print',
      category: 'print.category',
      icon: asIcon(Printer),
      keys: 'Mod+P',
      global: true,
      run: () => runPrint(deps),
    },
    {
      id: 'file.exportHtml',
      title: 'print.exportHtml',
      category: 'print.category',
      icon: asIcon(FileCode),
      global: true,
      run: () => runExportHtml(deps),
    },
  ],
  ribbon: [
    { tab: 'file', group: 'print.group', command: 'file.print', order: 90, size: 'large' },
    { tab: 'file', group: 'print.group', command: 'file.exportHtml', order: 91 },
  ],
} satisfies Contribution;
