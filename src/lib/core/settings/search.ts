// The settings search box (Phase 4 plan §6.9 rule 43). Written by the P4g prelude; P4.37 fills in
// `searchSettings` and builds the box on it. Pure: the dialog hands it the entries with their
// text already translated, so the search follows the language in use.

/** One thing the box can find: a setting row, or a page of the dialog. */
export interface SearchEntry {
  /** The setting key (`editor.tabWidth`), or the page's tab id (`keyboard`). */
  id: string;
  kind: 'setting' | 'page';
  /** The page (tab) it is on; for a page entry, the page itself. */
  tab: string;
  /** The translated label, the heading of a page. */
  label: string;
  /** The translated help text; empty for a page. */
  help: string;
}

/** One hit, best first. */
export interface SearchHit {
  entry: SearchEntry;
  /** Where the words were found, best first: the label's start, the label, the help, the key. */
  where: 'labelStart' | 'label' | 'help' | 'key';
}

/** The most hits the box lists. */
export const MAX_SEARCH_HITS = 20;

/**
 * The entries that contain every word of `query` (case and accents ignored) in their label, help
 * or key, best first: a label that starts with the first word, then any label, then the help, then
 * the key; inside a class, in table order. An empty query finds nothing. At most
 * [`MAX_SEARCH_HITS`]. P4.37. The stub finds nothing.
 */
export function searchSettings(_query: string, _entries: readonly SearchEntry[]): SearchHit[] {
  return [];
}
