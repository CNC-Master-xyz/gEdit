// Which open documents still wait for their remembered state (plan §6.5 rule 5, session rule 3).
//
// A file that comes back from the session has its model at once (`fileOps` makes it when the file
// opens, pending while Monaco is not up), but its remembered cursor and bookmarks are put into the
// editor only when the tab is in front (`app/session.ts`, `apply`). Until then the bookmarks of that
// document are in its memo (`stores/fileMemory`) and nowhere else: the editor's bookmark service
// knows none of them. The bookmark panel asks this registry to tell such a tab from one whose
// bookmarks are live, because "has a model" does not say it.
//
// The file tracker keeps the set; nothing else writes it.

import type { DocId } from '$lib/app/types';

const waiting = new Set<DocId>();

export const memoWaiting = {
  /** Whether the bookmarks of `id` are still in its memo and not yet in the editor. */
  has(id: DocId): boolean {
    return waiting.has(id);
  },
  add(id: DocId): void {
    waiting.add(id);
  },
  delete(id: DocId): void {
    waiting.delete(id);
  },
  clear(): void {
    waiting.clear();
  },
};
