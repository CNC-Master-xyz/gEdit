// Interface languages (Phase 4 plan §6.9 rules 37–42, Q4-18). Written by the P4g prelude; P4.37
// builds the loading and the dialog's choice on it. `i18n/index.ts` (the translator `t`) is a hot
// file the session merges; everything new about languages lives here so it can be written
// without editing it.
//
// The rule in one sentence: English is always complete and always loaded; another message set
// exists only when someone ships one, by adding a folder `src/lib/i18n/<tag>/` with the same
// namespace files as `en/` and a row in `LOCALES` below. With one row the language setting is
// not offered, and `ui.language` falls back to English for any tag.

import type { Messages } from './types';

/** One interface language that ships. `name` is the language's own name ("Deutsch"). */
export interface LocaleInfo {
  tag: string;
  name: string;
}

/**
 * The languages that ship, English first. A translation ships when its folder exists and its row
 * is here; `locale.test.ts` holds the two together and holds every message of a set to the key
 * and the placeholders of the English one.
 */
export const LOCALES: readonly LocaleInfo[] = [{ tag: 'en', name: 'English' }];

/** The language that is always complete and the last of every fallback chain. */
export const DEFAULT_LOCALE = 'en';

/** What `ui.language` may hold: a BCP 47 language and an optional region or script (`de`, `de-CH`, `zh-Hant`). */
export const LOCALE_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

export function isLocaleTag(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 12 && LOCALE_TAG.test(value);
}

/**
 * The message set to use for `requested` among the `available` tags: the exact tag, else its
 * language (`de-CH` → `de`), else English. Case is ignored; the answer is the available tag as
 * spelled there. Never throws, so a typo in `settings.json` costs the language and nothing else.
 */
export function resolveLocale(requested: string, available: readonly string[]): string {
  const wanted = requested.toLowerCase();
  const find = (tag: string): string | undefined => available.find((a) => a.toLowerCase() === tag);
  return find(wanted) ?? find(wanted.split('-')[0]) ?? DEFAULT_LOCALE;
}

/** The sets to look in for one message, most specific first, English last: `['de-CH', 'de', 'en']`. */
export function fallbackChain(resolved: string): string[] {
  const chain = [resolved];
  const language = resolved.split('-')[0];
  if (language !== resolved) chain.push(language);
  if (!chain.includes(DEFAULT_LOCALE)) chain.push(DEFAULT_LOCALE);
  return chain;
}

/** The languages that ship. */
export function availableLocales(): readonly LocaleInfo[] {
  return LOCALES;
}

/** Whether the language setting is worth offering: only when there is a second language. */
export function offersLanguageChoice(): boolean {
  return LOCALES.length > 1;
}

/** A loaded message set: its tag and its namespaces (the shape of `namespaces` in `i18n/index.ts`). */
export interface LocaleSet {
  tag: string;
  namespaces: Readonly<Record<string, Messages>>;
}

/**
 * Loads the message set of `tag` (not English, which ships in the main bundle). `null` when there
 * is none or it cannot be loaded; the caller then stays on English and says so once. P4.37. The
 * stub finds nothing, because no translation ships.
 */
export async function loadLocale(_tag: string): Promise<LocaleSet | null> {
  return null;
}
