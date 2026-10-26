// The hover of a wait mark in the channel view, made when the pointer rests on it (v1.2.0 channel-enter).
//
// The view used to give every wait mark its hover as a decoration, so the sentence "Waits with Turret B,
// line 120" was built for every wait of the program each time the alignment changed: for 20,000 waits
// that was most of the cost of a line break typed in a pane. A hover provider is asked for the one line the
// pointer is on, so the sentence is built for that line and no other. `channelPanes.ts` owns the answers
// (it knows the alignment); this file only puts the question to it.
//
// Like the other hover, the contents are built with `isTrusted: false` and `supportHtml: false`: a channel
// name and the text of a wait come from the machine and the open file, which are data, not app code.
//
// IMPORTANT: Monaco is reached only through the object `getMonaco()` hands over; nothing is imported from it.

import type { Monaco } from '$lib/monaco/setup';
import type { Disposable } from '$lib/app/types';
import type * as MonacoApi from 'monaco-editor/esm/vs/editor/editor.api.js';

/** The sentences for the wait marks on `line` of `model`, in the order of the marks; none for a model the view does not show or a line without a mark. */
export type WaitHoverAnswer = (model: MonacoApi.editor.ITextModel, line: number) => readonly string[];

/** Registers the wait hover for models of language `languageId`; the returned function takes it away. */
export function registerWaitHover(monaco: Monaco, languageId: string, answer: WaitHoverAnswer): Disposable {
  const languages = monaco.languages as Partial<Monaco['languages']> | undefined;
  // A Monaco without hover providers (a test's fake of it) has no hovers to give.
  if (languages?.registerHoverProvider === undefined) return () => {};
  const registration = languages.registerHoverProvider(languageId, {
    provideHover(model, position) {
      const sentences = answer(model, position.lineNumber);
      if (sentences.length === 0) return null;
      return {
        range: { startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: model.getLineMaxColumn(position.lineNumber) },
        contents: sentences.map((value) => ({ value, isTrusted: false, supportHtml: false })),
      };
    },
  });
  return () => registration.dispose();
}
