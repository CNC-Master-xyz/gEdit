// The interface language at startup (Phase 4 plan §6.9 rules 37–42, Q4-18).
//
// `activateLanguage()` runs once, right after `settings.load()` and before anything is rendered
// or any user file is read (so the first messages are already in the right language): it reads
// `ui.language`, resolves it against the message sets that ship (`resolveLocale`), loads the set
// (`loadLocale`) and makes the translator of `i18n/index.ts` use it, with English as the fallback
// for every missing key. It never throws: a set that cannot be loaded leaves English in use and
// shows one notice. The language does not change while the app runs (rule 40).
//
// With English alone shipping (Q4-18) this finds nothing to load and installs nothing, so every
// text comes from English exactly as before.

import { get } from 'svelte/store';
import { status } from '$lib/app/status';
import { createTranslator, namespaces, t } from '$lib/i18n';
import {
  DEFAULT_LOCALE,
  LOCALES,
  fallbackChain,
  installTranslator,
  layerTranslators,
  loadLocale,
  reportMissingKey,
  resolveLocale,
  type LocaleInfo,
  type LocaleSet,
} from '$lib/i18n/locale';
import type { Translator } from '$lib/i18n/types';
import { settings } from '$lib/stores/settings';

/** What `activateLanguage` needs from outside, so it can be tested with a set that does not ship. */
export interface LanguageDeps {
  /** The effective `ui.language`. */
  language: () => unknown;
  /** The languages that ship. */
  locales: readonly LocaleInfo[];
  load: (tag: string) => Promise<LocaleSet | null>;
  install: (translator: Translator | null) => void;
  /** The one notice when a set cannot be loaded; `language` is the language's own name. */
  notify: (language: string) => void;
}

const defaultDeps: LanguageDeps = {
  language: () => get(settings.values)['ui.language'],
  locales: LOCALES,
  load: (tag) => loadLocale(tag),
  install: installTranslator,
  notify: (language) => status.show(t('settings.languageLoadFailed', { language }), { error: true }),
};

/**
 * Sets the language of the interface from `ui.language`. Returns the tag that is in use (`en` when
 * nothing else is, or the set could not be loaded). Never throws.
 */
export async function activateLanguage(deps: Partial<LanguageDeps> = {}): Promise<string> {
  const d = { ...defaultDeps, ...deps };
  try {
    const available = d.locales.map((locale) => locale.tag);
    const requested = d.language();
    const resolved = resolveLocale(typeof requested === 'string' ? requested : DEFAULT_LOCALE, available);
    // The sets to read, most specific first: `de-CH` over `de`; only those that ship, never English.
    const wanted = fallbackChain(resolved).filter(
      (tag) => tag !== DEFAULT_LOCALE && available.some((a) => a === tag),
    );
    if (wanted.length === 0) {
      d.install(null);
      return DEFAULT_LOCALE;
    }
    const loaded = await Promise.all(wanted.map((tag) => d.load(tag)));
    if (loaded.some((set) => set === null)) {
      d.install(null);
      d.notify(d.locales.find((locale) => locale.tag === resolved)?.name ?? resolved);
      return DEFAULT_LOCALE;
    }
    // English is built here, not taken from `t`, which asks the translator being installed.
    let layered: Translator = createTranslator(namespaces, DEFAULT_LOCALE, { onMissing: reportMissingKey });
    for (const set of (loaded as LocaleSet[]).reverse()) {
      layered = layerTranslators(createTranslator(set.namespaces, set.tag), layered);
    }
    d.install(layered);
    return resolved;
  } catch (err) {
    console.error('the interface language could not be set; using English', err);
    d.install(null);
    return DEFAULT_LOCALE;
  }
}
