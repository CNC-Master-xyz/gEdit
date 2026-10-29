// Interface languages (Phase 4 plan §6.9 rules 37–42, Q4-18). Written by the P4g prelude; P4.37
// builds the loading and the dialog's choice on it. `i18n/index.ts` (the translator `t`) is a hot
// file the session merges; everything new about languages lives here so it can be written
// without editing it.
//
// The rule in one sentence: English is always complete and always loaded; another message set
// exists only when someone ships one, by adding a folder `src/lib/i18n/<tag>/` with the same
// namespace files as `en/` and a row in `LOCALES` below. With one row the language setting is
// not offered, and `ui.language` falls back to English for any tag.

import type { Messages, Translator } from './types';

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

/** Loaders of namespace files by path, as `import.meta.glob` makes them (lazy). */
export type LocaleLoaders = Readonly<Record<string, () => Promise<unknown>>>;

/**
 * The namespace files of every folder `src/lib/i18n/<tag>/` except `en/`, not loaded yet. Bundled as
 * separate chunks, so a build with English alone carries no second set (and this is empty now).
 */
const shippedLoaders: LocaleLoaders = import.meta.glob(['./*/*.ts', '!./en/*.ts', '!./*/*.test.ts']);

function isMessages(value: unknown): value is Messages {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Loads the message set of `tag` (not English, which ships in the main bundle): every namespace file
 * of the folder `<tag>/`, loaded at once. `null` when there is none, when `tag` is English or no tag,
 * or when any file cannot be loaded or does not hold messages, so a set is used whole or not at all;
 * the caller then stays on English and says so once. Never throws. `loaders` is for tests, which hand
 * it a set that does not ship.
 */
export async function loadLocale(tag: string, loaders: LocaleLoaders = shippedLoaders): Promise<LocaleSet | null> {
  if (!isLocaleTag(tag) || tag.toLowerCase() === DEFAULT_LOCALE) return null;
  const folder = new RegExp(`(?:^|/)${tag.replace(/[^A-Za-z0-9-]/g, '')}/([A-Za-z][A-Za-z0-9]*)\\.ts$`);
  const files = Object.entries(loaders).flatMap(([path, load]) => {
    const name = folder.exec(path)?.[1];
    return name === undefined ? [] : [{ name, load }];
  });
  if (files.length === 0) return null;
  try {
    const modules = await Promise.all(files.map((file) => file.load()));
    const namespaces: Record<string, Messages> = {};
    for (const [index, module] of modules.entries()) {
      const messages = (module as { default?: unknown } | null)?.default;
      if (!isMessages(messages)) return null;
      namespaces[files[index].name] = messages;
    }
    return { tag, namespaces };
  } catch {
    return null;
  }
}

// --- the translator that reads the loaded set ----------------------------------------------------

let installed: Translator | null = null;

/**
 * Makes `translator` the one `t()` and `hasKey()` of `i18n/index.ts` use, or `null` for English
 * alone. Called once at startup by `activateLanguage` (§6.9 rule 39); the language does not change
 * while the app runs (rule 40). `i18n/index.ts` asks `installedTranslator()` on every call.
 */
export function installTranslator(translator: Translator | null): void {
  installed = translator;
}

/** The installed translator, or `null` while English alone is in use. */
export function installedTranslator(): Translator | null {
  return installed;
}

/** A translator that answers from `primary` when it has the key and from `fallback` otherwise. */
export function layerTranslators(primary: Translator, fallback: Translator): Translator {
  return {
    t: (key, params) => (primary.hasKey(key) ? primary.t(key, params) : fallback.t(key, params)),
    hasKey: (key) => primary.hasKey(key) || fallback.hasKey(key),
  };
}

const warned = new Set<string>();
const LOOKS_LIKE_KEY = /^[A-Za-z][\w-]*(?:\.[\w-]+)+$/;

/**
 * What the translator does with a key that no message set has (§6.9 rule 39): in a development
 * build, one warning per key. Only a text shaped like a key (`namespace.name`) is reported; anything
 * else is data shown as it is, such as a template's label used as a command title. Shared by the
 * English translator of `i18n/index.ts` and the one `activateLanguage` layers over the loaded set.
 */
export function reportMissingKey(key: string): void {
  if (import.meta.env.DEV && LOOKS_LIKE_KEY.test(key) && !warned.has(key)) {
    warned.add(key);
    console.warn(`i18n: no message for "${key}"`);
  }
}

/** Forgets which keys were reported (tests). */
export function resetMissingKeyReports(): void {
  warned.clear();
}

// --- the checks that hold a set to English (locale.test.ts; §6.9 rule 38) ------------------------

const PLURAL_FORM = /^(.+)_(zero|one|two|few|many|other)$/;
const PLACEHOLDER = /\{(\w+)\}/g;

/** Every message of `namespaces` by its key, `<namespace>.<path>`. */
export function flattenMessages(namespaces: Readonly<Record<string, Messages>>): Map<string, string> {
  const table = new Map<string, string>();
  const walk = (prefix: string, messages: Messages): void => {
    for (const [name, value] of Object.entries(messages)) {
      if (typeof value === 'string') table.set(`${prefix}.${name}`, value);
      else if (isMessages(value)) walk(`${prefix}.${name}`, value);
    }
  };
  for (const [ns, messages] of Object.entries(namespaces)) walk(ns, messages);
  return table;
}

/** The `{name}` placeholders of a message, sorted, once each. */
export function placeholdersOf(message: string): string[] {
  return [...new Set([...message.matchAll(PLACEHOLDER)].map((m) => m[1]))].sort();
}

/** The plural categories a language needs (`en`: one, other; `pl`: one, few, many, other). */
export function pluralCategories(tag: string): string[] {
  try {
    return new Intl.PluralRules(tag).resolvedOptions().pluralCategories;
  } catch {
    return ['one', 'other'];
  }
}

export interface LocaleReport {
  /** Mistakes: a key English does not have, other placeholders, a plural form missing. Must be empty. */
  problems: string[];
  /** Messages of English (a plural group counts once) that the set does not have yet. Not a failure. */
  missing: number;
  /** Messages of English, counted the same way. */
  total: number;
}

/**
 * Holds `set` to `english` (§6.9 rule 38): every key of the set exists in English, with the same
 * placeholders, and every plural group has the forms its language needs. A set that lacks keys is
 * reported as a count, not as a failure: it shows English for those. A plural form English does not
 * have (`few`) is held to English's `other`; `{count}` may be left out of a form other than `other`
 * (`one`: "one file").
 */
export function checkLocaleSet(
  english: Readonly<Record<string, Messages>>,
  set: LocaleSet,
): LocaleReport {
  const en = flattenMessages(english);
  const own = flattenMessages(set.namespaces);
  const problems: string[] = [];
  const groups = new Map<string, Set<string>>();
  for (const [key, message] of own) {
    const form = PLURAL_FORM.exec(key);
    const counterpart = en.get(key) ?? (form ? en.get(`${form[1]}_other`) : undefined);
    if (counterpart === undefined) {
      problems.push(`${key}: no such message in English`);
      continue;
    }
    if (form) groups.set(form[1], (groups.get(form[1]) ?? new Set()).add(form[2]));
    const want = placeholdersOf(counterpart);
    const got = placeholdersOf(message);
    const leftOutCount = form !== null && form[2] !== 'other' && want.join() === [...got, 'count'].sort().join();
    if (want.join() !== got.join() && !leftOutCount) {
      problems.push(`${key}: placeholders {${got.join(', ')}} differ from English {${want.join(', ')}}`);
    }
  }
  const needed = pluralCategories(set.tag);
  for (const [base, forms] of groups) {
    for (const category of needed) {
      if (!forms.has(category)) problems.push(`${base}: plural form _${category} is missing for ${set.tag}`);
    }
  }
  const units = new Set([...en.keys()].map((key) => PLURAL_FORM.exec(key)?.[1] ?? key));
  const covered = (unit: string): boolean =>
    own.has(unit) || [...own.keys()].some((key) => PLURAL_FORM.exec(key)?.[1] === unit);
  return { problems, missing: [...units].filter((unit) => !covered(unit)).length, total: units.size };
}
