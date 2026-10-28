// The language rules of §6.9 (rules 37–42) and the rows P4.37 turns into tests.

import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { namespaces } from './index';
import {
  DEFAULT_LOCALE,
  LOCALES,
  availableLocales,
  checkLocaleSet,
  fallbackChain,
  isLocaleTag,
  loadLocale,
  offersLanguageChoice,
  placeholdersOf,
  pluralCategories,
  resolveLocale,
  type LocaleLoaders,
  type LocaleSet,
} from './locale';

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

// The sets the tests below load do not ship: they live in tests/fixtures/i18n/<tag>/ and are handed to
// loadLocale as loaders, the way `import.meta.glob` hands it the shipped folders.
const fixtures: LocaleLoaders = import.meta.glob('../../../tests/fixtures/i18n/*/*.ts');

describe('loadLocale', () => {
  it('finds no set while English is all that ships', async () => {
    expect(await loadLocale('de')).toBeNull();
    expect(await loadLocale('de-CH')).toBeNull();
  });

  it('loads every namespace file of the folder, and only that folder', async () => {
    const de = await loadLocale('de', fixtures);
    expect(de?.tag).toBe('de');
    expect(Object.keys(de?.namespaces ?? {}).sort()).toEqual(['common', 'settings']);
    expect(de?.namespaces.common).toHaveProperty('cancel', 'Abbrechen');
    // `de` is not `de-CH`: the folder name is matched whole.
    const ch = await loadLocale('de-CH', fixtures);
    expect(Object.keys(ch?.namespaces ?? {})).toEqual(['common']);
    expect(ch?.namespaces.common).toEqual({ save: 'Sichern' });
  });

  it('has nothing to load for English, a tag without a folder, or no tag', async () => {
    expect(await loadLocale('en', fixtures)).toBeNull();
    expect(await loadLocale('fr', fixtures)).toBeNull();
    expect(await loadLocale('', fixtures)).toBeNull();
    expect(await loadLocale('../etc', fixtures)).toBeNull();
  });

  it('uses a set whole or not at all: a file that does not hold messages, or fails to load, gives null', async () => {
    expect(await loadLocale('broken', fixtures)).toBeNull();
    const failing: LocaleLoaders = {
      './de/common.ts': () => Promise.resolve({ default: { cancel: 'Abbrechen' } }),
      './de/settings.ts': () => Promise.reject(new Error('chunk failed')),
    };
    expect(await loadLocale('de', failing)).toBeNull();
  });
});

describe('what ships and the folders agree (§6.9 rule 38)', () => {
  const folders = readdirSync(fileURLToPath(new URL('.', import.meta.url)), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  it('has a row for every folder and a folder for every row', () => {
    expect(folders).toEqual(LOCALES.map((locale) => locale.tag).sort());
  });

  it('has a tag a setting can hold in every row, with the language’s own name', () => {
    for (const locale of LOCALES) {
      expect(isLocaleTag(locale.tag), locale.tag).toBe(true);
      expect(locale.name.trim(), locale.tag).not.toBe('');
    }
  });

  it('holds every shipped set to English: its keys, its placeholders and its plural forms', async () => {
    for (const locale of LOCALES.filter((l) => l.tag !== DEFAULT_LOCALE)) {
      const set = await loadLocale(locale.tag);
      expect(set, locale.tag).not.toBeNull();
      const report = checkLocaleSet(namespaces, set as LocaleSet);
      expect(report.problems, locale.tag).toEqual([]);
      // A set that lacks keys is reported as a count and shows English for them; it does not fail.
      expect(report.missing, locale.tag).toBeLessThanOrEqual(report.total);
    }
  });
});

describe('checkLocaleSet', () => {
  it('passes a partial set that follows English, and counts what it lacks', async () => {
    const de = (await loadLocale('de', fixtures)) as LocaleSet;
    const report = checkLocaleSet(namespaces, de);
    expect(report.problems).toEqual([]);
    expect(report.total).toBeGreaterThan(500);
    // Eight of the English messages are here (the plural group counts once).
    expect(report.total - report.missing).toBe(8);
  });

  it('reports a key English lacks, other placeholders and a plural form the language needs', async () => {
    const pl = (await loadLocale('pl', fixtures)) as LocaleSet;
    expect(checkLocaleSet(namespaces, pl).problems.sort()).toEqual(
      [
        'common.files: plural form _many is missing for pl',
        'common.lineNumber: placeholders {row} differ from English {line}',
        'common.lines: plural form _few is missing for pl',
        'common.lines: plural form _many is missing for pl',
        'common.lines: plural form _other is missing for pl',
        'common.nonesuch: no such message in English',
      ].sort(),
    );
  });

  it('lets a plural form other than `other` leave {count} out ("one file"), and nothing else', () => {
    const english = { demo: { n_one: '{count} file', n_other: '{count} files' } };
    const ok = { tag: 'de', namespaces: { demo: { n_one: 'eine Datei', n_other: '{count} Dateien' } } };
    expect(checkLocaleSet(english, ok).problems).toEqual([]);
    const bad = { tag: 'de', namespaces: { demo: { n_one: '{count} Datei', n_other: 'Dateien' } } };
    expect(checkLocaleSet(english, bad).problems).toEqual(['demo.n_other: placeholders {} differ from English {count}']);
  });

  it('knows the plural forms of a language', () => {
    expect([...pluralCategories('en')].sort()).toEqual(['one', 'other']);
    expect([...pluralCategories('pl')].sort()).toEqual(['few', 'many', 'one', 'other']);
    expect(pluralCategories('not a tag')).toEqual(['one', 'other']);
  });

  it('reads placeholders once each, sorted', () => {
    expect(placeholdersOf('{b} and {a} and {b}')).toEqual(['a', 'b']);
    expect(placeholdersOf('none')).toEqual([]);
  });
});
