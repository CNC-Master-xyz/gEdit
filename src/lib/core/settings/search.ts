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

/** Lower case with the accents taken off (`Ä` finds `a`), so a query matches however it is typed. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

const RANK: Record<SearchHit['where'], number> = { labelStart: 0, label: 1, help: 2, key: 3 };

/**
 * The entries that contain every word of `query` (case and accents ignored) in their label, help
 * or key, best first: a label that starts with the first word, then any label, then the help, then
 * the key; inside a class, in table order. An empty query finds nothing. At most
 * [`MAX_SEARCH_HITS`] (§6.9 rule 43).
 *
 * A word may be found in any of the three texts, so "tab key" finds a setting whose label has
 * "tab" and whose help says "key". The class is where the **first** word was found, label first.
 * Only a setting is found by its key; a page is found by its heading alone.
 */
export function searchSettings(query: string, entries: readonly SearchEntry[]): SearchHit[] {
  const words = fold(query).split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return [];
  const first = words[0];
  const hits: { hit: SearchHit; order: number }[] = [];
  entries.forEach((entry, order) => {
    const label = fold(entry.label);
    const help = fold(entry.help);
    const key = entry.kind === 'setting' ? fold(entry.id) : '';
    const all = `${label}\n${help}\n${key}`;
    if (!words.every((word) => all.includes(word))) return;
    const where: SearchHit['where'] = label.startsWith(first)
      ? 'labelStart'
      : label.includes(first)
        ? 'label'
        : help.includes(first)
          ? 'help'
          : 'key';
    hits.push({ hit: { entry, where }, order });
  });
  hits.sort((a, b) => RANK[a.hit.where] - RANK[b.hit.where] || a.order - b.order);
  return hits.slice(0, MAX_SEARCH_HITS).map((h) => h.hit);
}
