// The interface language at startup (§6.9 rules 37–41). The sets used here do not ship: they are the
// fixtures under tests/fixtures/i18n, handed in as loaders.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activateLanguage, type LanguageDeps } from './language';
import { installTranslator, installedTranslator, loadLocale, resetMissingKeyReports, type LocaleLoaders } from '$lib/i18n/locale';
import type { Translator } from '$lib/i18n/types';

const fixtures: LocaleLoaders = import.meta.glob('../../../tests/fixtures/i18n/*/*.ts');
const ENGLISH = { tag: 'en', name: 'English' };
const DEUTSCH = { tag: 'de', name: 'Deutsch' };
const SWISS = { tag: 'de-CH', name: 'Deutsch (Schweiz)' };
const POLSKI = { tag: 'pl', name: 'Polski' };

interface Run {
  installed: Translator | null | undefined;
  notified: string[];
  load: ReturnType<typeof vi.fn>;
  result: string;
}

async function run(language: unknown, locales: LanguageDeps['locales'], load?: LanguageDeps['load']): Promise<Run> {
  const out: Run = {
    installed: undefined,
    notified: [],
    load: vi.fn(load ?? ((tag: string) => loadLocale(tag, fixtures))),
    result: '',
  };
  out.result = await activateLanguage({
    language: () => language,
    locales,
    load: out.load as unknown as LanguageDeps['load'],
    install: (translator) => (out.installed = translator),
    notify: (name) => out.notified.push(name),
  });
  return out;
}

beforeEach(() => {
  resetMissingKeyReports();
});

afterEach(() => {
  vi.restoreAllMocks();
  installTranslator(null);
});

describe('activateLanguage with English alone (what ships in v1.2.0)', () => {
  it('loads nothing and leaves English in use, whatever the setting holds', async () => {
    for (const language of ['en', 'de', 'de-CH', 'EN', '', 'x', 5, null, undefined]) {
      const r = await run(language, [ENGLISH]);
      expect(r.result, String(language)).toBe('en');
      expect(r.installed, String(language)).toBeNull();
      expect(r.load, String(language)).not.toHaveBeenCalled();
      expect(r.notified, String(language)).toEqual([]);
    }
  });

  it('runs against the real settings and the real folders without a notice', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await activateLanguage()).toBe('en');
    expect(installedTranslator()).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('activateLanguage with a second language', () => {
  it('shows the set first and English for what it lacks', async () => {
    const r = await run('de', [ENGLISH, DEUTSCH]);
    expect(r.result).toBe('de');
    const tr = r.installed as Translator;
    expect(tr.t('common.cancel')).toBe('Abbrechen');
    expect(tr.t('settings.editor.tabWidth.label')).toBe('Tabulatorbreite');
    expect(tr.t('common.close')).toBe('Close'); // not translated yet: English
    expect(tr.hasKey('common.close')).toBe(true);
    expect(tr.t('common.lineNumber', { line: 7 })).toBe('Zeile 7');
    expect(r.notified).toEqual([]);
  });

  it('shows a key that no set has as the key itself and warns once in a development build', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tr = (await run('de', [ENGLISH, DEUTSCH])).installed as Translator;
    expect(tr.t('common.nonesuch')).toBe('common.nonesuch');
    expect(tr.t('common.nonesuch')).toBe('common.nonesuch');
    expect(tr.hasKey('common.nonesuch')).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('i18n: no message for "common.nonesuch"');
  });

  it('puts a region over its language over English (de-CH, de, en)', async () => {
    const r = await run('de-CH', [ENGLISH, DEUTSCH, SWISS]);
    expect(r.result).toBe('de-CH');
    expect(r.load.mock.calls.map((c) => c[0]).sort()).toEqual(['de', 'de-CH']);
    const tr = r.installed as Translator;
    expect(tr.t('common.save')).toBe('Sichern'); // the region's word
    expect(tr.t('common.cancel')).toBe('Abbrechen'); // the language's
    expect(tr.t('common.close')).toBe('Close'); // English's
  });

  it('takes the language for a region that does not ship, in any case', async () => {
    const r = await run('DE-at', [ENGLISH, DEUTSCH]);
    expect(r.result).toBe('de');
    expect((r.installed as Translator).t('common.cancel')).toBe('Abbrechen');
    expect((await run('fr', [ENGLISH, DEUTSCH])).installed).toBeNull();
  });

  it('selects plural forms with the loaded language’s rules, not English’s', async () => {
    const tr = (await run('pl', [ENGLISH, POLSKI])).installed as Translator;
    expect(tr.t('common.files', { count: 1 })).toBe('1 plik');
    expect(tr.t('common.files', { count: 2 })).toBe('2 pliki'); // Polish `few`; English would say "other"
    expect(tr.t('common.files', { count: 5 })).toBe('5 pliku'); // `many` is missing in the fixture: `other`
    const en = (await run('de', [ENGLISH, DEUTSCH])).installed as Translator;
    expect(en.t('common.lines', { count: 1 })).toBe('1 Zeile');
    expect(en.t('common.lines', { count: 2 })).toBe('2 Zeilen');
  });
});

describe('activateLanguage when the set cannot be loaded', () => {
  it('stays on English and says so once, naming the language', async () => {
    const r = await run('de', [ENGLISH, DEUTSCH], async () => null);
    expect(r.result).toBe('en');
    expect(r.installed).toBeNull();
    expect(r.notified).toEqual(['Deutsch']);
  });

  it('does the same when only the language behind a region is missing', async () => {
    const r = await run('de-CH', [ENGLISH, DEUTSCH, SWISS], async (tag) => (tag === 'de' ? null : loadLocale(tag, fixtures)));
    expect(r.result).toBe('en');
    expect(r.installed).toBeNull();
    expect(r.notified).toEqual(['Deutsch (Schweiz)']);
  });

  it('never throws, even if the loader does', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await run('de', [ENGLISH, DEUTSCH], async () => {
      throw new Error('boom');
    });
    expect(r.result).toBe('en');
    expect(r.installed).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('the installed translator', () => {
  it('is what i18n/index.ts asks for, and null means English alone', () => {
    const tr: Translator = { t: () => 'x', hasKey: () => true };
    installTranslator(tr);
    expect(installedTranslator()).toBe(tr);
    installTranslator(null);
    expect(installedTranslator()).toBeNull();
  });
});
