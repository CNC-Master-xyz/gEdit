// The language rules of §6.9 (rules 37–42) and the rows P4.37 turns into tests.

import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, LOCALES, availableLocales, fallbackChain, isLocaleTag, loadLocale, offersLanguageChoice, resolveLocale } from './locale';

describe('what ships', () => {
  it('is English alone, so the language choice is not offered (Q4-18)', () => {
    expect(LOCALES).toEqual([{ tag: 'en', name: 'English' }]);
    expect(availableLocales()).toBe(LOCALES);
    expect(DEFAULT_LOCALE).toBe('en');
    expect(offersLanguageChoice()).toBe(false);
  });
});

describe('a language tag', () => {
  it('is a language with an optional region or script', () => {
    for (const good of ['en', 'de', 'de-CH', 'zh-Hant', 'fil', 'es-419']) expect(isLocaleTag(good), good).toBe(true);
  });

  it('is nothing else', () => {
    for (const bad of ['', 'e', 'english', 'de_CH', 'de-', '-de', 'de-CH-1996', 'de CH', 'DE', 5, null, undefined, 'de-' + 'x'.repeat(9)]) {
      expect(isLocaleTag(bad), String(bad)).toBe(false);
    }
  });
});

describe('resolveLocale', () => {
  it('takes the exact tag, then the language, then English', () => {
    expect(resolveLocale('de-CH', ['en', 'de-CH', 'de'])).toBe('de-CH');
    expect(resolveLocale('de-CH', ['en', 'de'])).toBe('de');
    expect(resolveLocale('de-AT', ['en', 'de-CH'])).toBe('en');
    expect(resolveLocale('fr', ['en', 'de'])).toBe('en');
    expect(resolveLocale('de', ['en'])).toBe('en');
  });

  it('ignores case and answers the available spelling', () => {
    expect(resolveLocale('DE-ch', ['en', 'de-CH'])).toBe('de-CH');
  });

  it('never throws, whatever the setting holds', () => {
    expect(resolveLocale('', ['en'])).toBe('en');
    expect(resolveLocale('not a tag at all', [])).toBe('en');
  });
});

describe('fallbackChain', () => {
  it('ends in English', () => {
    expect(fallbackChain('de-CH')).toEqual(['de-CH', 'de', 'en']);
    expect(fallbackChain('de')).toEqual(['de', 'en']);
    expect(fallbackChain('en')).toEqual(['en']);
    expect(fallbackChain('en-GB')).toEqual(['en-GB', 'en']);
  });
});

describe('P4.37', () => {
  it('the stub loads no set', async () => {
    expect(await loadLocale('de')).toBeNull();
  });

  it.todo('LOCALES and the folders under src/lib/i18n agree: every row has a folder, every folder a row');
  it.todo('every key of a set exists in en/ with the same placeholders and, for a plural, the forms the language needs');
  it.todo('a missing key shows the English text; a key English lacks too shows the key and warns once');
  it.todo('bootstrap awaits the set before the first render and stays on English, with one notice, when it cannot load');
  it.todo('the setting takes effect at the next start; the dialog says so');
  it.todo('plural selection uses the loaded language’s Intl.PluralRules');
});
