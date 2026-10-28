// The settings dialog (plan §5 WP2.7). The parts worth a unit test are pure and live in
// the component's module script: which pages exist, how a `SettingFieldMeta` becomes a
// translated `FieldSpec`, and what Save sends.
//
// The test the plan asks for is `i18n`: every label, help and choice key of
// `SETTING_FIELDS` has a message in the `settings` namespace. The table is static and its
// keys are built rather than written, so `i18n/keys.test.ts` cannot see them and this is
// the only thing standing between a new setting and a raw key on screen.
//
// The markup is rendered with `svelte/server`, which needs no DOM. Clicking a page,
// editing a value and saving are the M2 runtime scenarios' job.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import SettingsDialog, {
  CATEGORY_ORDER,
  CONFIGURATION_TAB,
  KEYBOARD_TAB,
  MACHINES_TAB,
  PACKAGES_TAB,
  PAGE_TABS,
  PROFILES_TAB,
  tabsOf,
  LIST_KEYS,
  changedValues,
  defaultValues,
  isListKey,
  pagesOf,
  rebaseValues,
  sameValue,
  snapshotValues,
  specOf,
  leaveQuestion,
  mayChangeTab,
  mayLeave,
  settingsModal,
  controlOfRow,
  languageChoices,
  savedMessage,
  searchEntriesOf,
  type SpecDeps,
} from './SettingsDialog.svelte';
import { validateFields } from '$lib/core/forms/validate';
import {
  DEFAULTS,
  SETTING_FIELDS,
  type SettingFieldMeta,
  type Settings,
} from '$lib/core/settings/schema';
import { hasKey, t } from '$lib/i18n';
import { offersLanguageChoice } from '$lib/i18n/locale';
import type { FieldChoice } from '$lib/core/forms/types';
import { searchSettings } from '$lib/core/settings/search';

/** The two profiles M1 knows; M3 replaces the registry, not the shape. */
const PROFILE_CHOICES: FieldChoice[] = [
  { label: 'Fanuc', value: 'fanuc-gcode' },
  { label: 'Heidenhain', value: 'heidenhain-klartext' },
];

const deps: SpecDeps = {
  translate: t,
  hasKey,
  choicesFor: (key) => (key === 'files.defaultProfile' ? PROFILE_CHOICES : undefined),
};

/** A `deps` that reports every key as missing, so the fallbacks are visible. */
const noMessages: SpecDeps = { translate: (key) => key, hasKey: () => false };

function meta(over: Partial<SettingFieldMeta> = {}): SettingFieldMeta {
  return {
    key: 'editor.tabWidth',
    category: 'editor',
    field: { id: 'editor.tabWidth', type: 'integer', default: 4, min: 1, max: 16 },
    labelKey: 'settings.editor.tabWidth.label',
    helpKey: 'settings.editor.tabWidth.help',
    dialog: true,
    ...over,
  };
}

describe('i18n of SETTING_FIELDS', () => {
  it('every label key has a message in the settings namespace', () => {
    const missing = SETTING_FIELDS.filter((m) => !hasKey(m.labelKey)).map((m) => m.labelKey);
    expect(missing).toEqual([]);
  });

  it('every help key has a message', () => {
    const missing = SETTING_FIELDS.flatMap((m) =>
      m.helpKey !== undefined && !hasKey(m.helpKey) ? [m.helpKey] : [],
    );
    expect(missing).toEqual([]);
  });

  it('every choice label has a message', () => {
    const missing = SETTING_FIELDS.flatMap((m) =>
      (m.field.choices ?? []).map((c) => c.label).filter((label) => !hasKey(label)),
    );
    expect(missing).toEqual([]);
  });

  it('the keys really are the ones the schema builds, not a copy of this list', () => {
    expect(SETTING_FIELDS.length).toBeGreaterThan(20);
    for (const m of SETTING_FIELDS) {
      expect(m.labelKey).toBe(`settings.${m.key}.label`);
      expect(m.field.id).toBe(m.key);
    }
  });

  it('no label resolves to the key itself', () => {
    const raw = SETTING_FIELDS.map((m) => specOf(m, deps).label).filter((label) =>
      label.startsWith('settings.'),
    );
    expect(raw).toEqual([]);
  });

  it('the five page headings have messages', () => {
    for (const category of CATEGORY_ORDER) expect(hasKey(`settings.categories.${category}`)).toBe(true);
  });
});

describe('the tabs (M13, P4g)', () => {
  it('ends with the five pages that are not settings: Machines, Profiles, Keyboard, Packages, Configuration', () => {
    const tabs = tabsOf(pagesOf());
    expect(tabs.slice(-5)).toEqual([MACHINES_TAB, PROFILES_TAB, KEYBOARD_TAB, PACKAGES_TAB, CONFIGURATION_TAB]);
    expect(tabs.slice(0, -5)).toEqual(pagesOf().map((page) => page.category));
    expect([...PAGE_TABS]).toEqual(tabs.slice(-5));
  });

  it('has a heading for each of the P4g tabs, and a placeholder page the work packages fill', () => {
    for (const tab of [KEYBOARD_TAB, PACKAGES_TAB, CONFIGURATION_TAB]) {
      expect(hasKey(`settings.categories.${tab}`), tab).toBe(true);
      const html = render(SettingsDialog, { props: { close: () => {}, initialTab: tab } }).body;
      expect(html, tab).toContain(`data-testid="settings-${tab}"`);
      expect(html, tab).toContain(`data-category="${tab}"`);
    }
  });

  it('has a heading for the Profiles tab', () => {
    expect(hasKey('settings.categories.profiles')).toBe(true);
  });

  it('opens on the Profiles tab when asked, and shows its page', () => {
    const html = render(SettingsDialog, { props: { close: () => {}, initialTab: PROFILES_TAB } }).body;
    expect(html).toContain('data-testid="settings-profiles"');
    expect(html).toContain('data-category="profiles"');
    expect(html).not.toContain('data-testid="settings-machines"');
  });
});

describe('pagesOf', () => {
  const pages = pagesOf();

  it('has one page per category, in the order of §7.7', () => {
    expect(pages.map((p) => p.category)).toEqual([...CATEGORY_ORDER]);
  });

  it('shows every field marked dialog and no other', () => {
    const shown = pages.flatMap((p) => p.metas.map((m) => m.key));
    expect(shown).toEqual(SETTING_FIELDS.filter((m) => m.dialog).map((m) => m.key));
    expect(shown).not.toContain('editor.rulers');
  });

  it('keeps the table order inside a page', () => {
    const editor = pages.find((p) => p.category === 'editor');
    expect(editor?.metas.slice(0, 2).map((m) => m.key)).toEqual([
      'editor.tabWidth',
      'editor.insertSpaces',
    ]);
  });

  it('leaves out a category that has nothing to show', () => {
    expect(pagesOf([meta({ dialog: false })])).toEqual([]);
    expect(pagesOf([meta()]).map((p) => p.category)).toEqual(['editor']);
  });
});

describe('specOf', () => {
  it('resolves the label and the help text through t()', () => {
    const spec = specOf(meta(), deps);
    expect(spec.label).toBe(t('settings.editor.tabWidth.label'));
    expect(spec.help).toBe(t('settings.editor.tabWidth.help'));
    expect(spec.label).not.toContain('settings.');
  });

  it('keeps the id, the type and the constraints of the schema row', () => {
    expect(specOf(meta(), deps)).toMatchObject({
      id: 'editor.tabWidth',
      type: 'integer',
      default: 4,
      min: 1,
      max: 16,
    });
  });

  it('translates the choice labels but not their values', () => {
    const spec = specOf(
      SETTING_FIELDS.find((m) => m.key === 'appearance.theme') as SettingFieldMeta,
      deps,
    );
    expect(spec.choices?.map((c) => c.value)).toEqual(['system', 'light', 'dark']);
    expect(spec.choices?.map((c) => c.label)).toEqual(['System', 'Light', 'Dark']);
  });

  it('takes the choices of a data-driven field from the caller', () => {
    const spec = specOf(
      SETTING_FIELDS.find((m) => m.key === 'files.defaultProfile') as SettingFieldMeta,
      deps,
    );
    expect(spec.choices).toEqual(PROFILE_CHOICES);
    expect(spec.default).toBe(DEFAULTS['files.defaultProfile']);
  });

  it('gives a choice field an empty list rather than none when nothing supplies one', () => {
    const bare = specOf(
      SETTING_FIELDS.find((m) => m.key === 'files.defaultProfile') as SettingFieldMeta,
      { translate: t, hasKey },
    );
    expect(bare.choices).toEqual([]);
  });

  it('falls back to the key and drops the help text when a message is missing', () => {
    const spec = specOf(meta(), noMessages);
    expect(spec.label).toBe('editor.tabWidth');
    expect(spec.help).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(spec, 'help')).toBe(false);
  });

  it('leaves the schema row alone', () => {
    const row = meta();
    const before = JSON.stringify(row);
    specOf(row, deps);
    expect(JSON.stringify(row)).toBe(before);
  });
});

describe('the fields the dialog renders', () => {
  /** What the component builds: every dialog field except the list-valued ones. */
  const specs = pagesOf()
    .flatMap((p) => p.metas)
    .filter((m) => !isListKey(m.key))
    .map((m) => specOf(m, deps));

  it('accepts the shipped defaults without a single error', () => {
    expect(validateFields(specs, snapshotValues(DEFAULTS))).toEqual({});
  });

  it('keeps scripts.folders out, because a list would fail a folder field', () => {
    expect(LIST_KEYS).toEqual(['scripts.folders']);
    expect(specs.map((s) => s.id)).not.toContain('scripts.folders');
    const folder = specOf(
      SETTING_FIELDS.find((m) => m.key === 'scripts.folders') as SettingFieldMeta,
      deps,
    );
    expect(validateFields([folder], { 'scripts.folders': ['/tmp/a'] })).toEqual({
      'scripts.folders': { key: 'forms.errors.invalid' },
    });
  });

  it('reports a value outside its bounds instead of correcting it', () => {
    const values = { ...snapshotValues(DEFAULTS), 'editor.tabWidth': 99 };
    expect(validateFields(specs, values)['editor.tabWidth']).toEqual({
      key: 'forms.errors.range',
      params: { min: 1, max: 16 },
    });
  });

  it('rejects a profile id the registry does not offer', () => {
    const values = { ...snapshotValues(DEFAULTS), 'files.defaultProfile': 'nonesuch' };
    expect(validateFields(specs, values)['files.defaultProfile']).toEqual({
      key: 'forms.errors.notInChoices',
    });
  });
});

describe('snapshotValues', () => {
  it('has one entry per dialog field and none for the others', () => {
    const values = snapshotValues(DEFAULTS);
    expect(Object.keys(values)).toEqual(SETTING_FIELDS.filter((m) => m.dialog).map((m) => m.key));
    expect(values['editor.tabWidth']).toBe(4);
  });

  it('copies a list, so the frozen defaults cannot be edited through the form', () => {
    const values = snapshotValues(DEFAULTS);
    const folders = values['scripts.folders'] as string[];
    expect(folders).toEqual([]);
    expect(folders).not.toBe(DEFAULTS['scripts.folders']);
    expect(() => folders.push('/tmp/x')).not.toThrow();
    expect(DEFAULTS['scripts.folders']).toEqual([]);
  });

  it('takes the effective values, not the defaults', () => {
    const effective: Settings = { ...DEFAULTS, 'editor.tabWidth': 2, 'scripts.folders': ['/a'] };
    const values = snapshotValues(effective);
    expect(values['editor.tabWidth']).toBe(2);
    expect(values['scripts.folders']).toEqual(['/a']);
    expect(values['scripts.folders']).not.toBe(effective['scripts.folders']);
  });
});

describe('sameValue', () => {
  it('compares lists entry by entry', () => {
    expect(sameValue(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameValue(['a'], ['a', 'b'])).toBe(false);
    expect(sameValue(['a'], 'a')).toBe(false);
    expect(sameValue([], [])).toBe(true);
  });

  it('compares everything else by identity', () => {
    expect(sameValue(4, 4)).toBe(true);
    expect(sameValue(4, '4')).toBe(false);
    expect(sameValue(undefined, undefined)).toBe(true);
  });
});

describe('changedValues', () => {
  it('is empty while nothing was touched', () => {
    expect(changedValues(snapshotValues(DEFAULTS), DEFAULTS)).toEqual({});
  });

  it('holds only what the user changed', () => {
    const values = { ...snapshotValues(DEFAULTS), 'editor.tabWidth': 2 };
    expect(changedValues(values, DEFAULTS)).toEqual({ 'editor.tabWidth': 2 });
  });

  it('notices a changed list and ignores one that only looks new', () => {
    const effective: Settings = { ...DEFAULTS, 'scripts.folders': ['/a'] };
    expect(changedValues({ 'scripts.folders': ['/a'] }, effective)).toEqual({});
    expect(changedValues({ 'scripts.folders': ['/a', '/b'] }, effective)).toEqual({
      'scripts.folders': ['/a', '/b'],
    });
    expect(changedValues({ 'scripts.folders': [] }, effective)).toEqual({ 'scripts.folders': [] });
  });

  it('is a patch against the effective values, not against the defaults', () => {
    const effective: Settings = { ...DEFAULTS, 'editor.tabWidth': 2 };
    expect(changedValues({ 'editor.tabWidth': 2 }, effective)).toEqual({});
    expect(changedValues({ 'editor.tabWidth': 4 }, effective)).toEqual({ 'editor.tabWidth': 4 });
  });

  it('never carries a key the dialog does not render', () => {
    const values = { ...snapshotValues(DEFAULTS), 'editor.rulers': [80], 'not.a.setting': 1 };
    expect(changedValues(values, DEFAULTS)).toEqual({});
  });
});

// CODE-1 (P4g review): a configuration import inside Settings changes the live values; the dialog's
// pending values used to stay as they were, so every imported setting counted as the user's edit
// (the close question appeared and Save wrote the old values back over the import).
describe('rebaseValues (the live settings move while the dialog is open)', () => {
  const before: Settings = { ...DEFAULTS, 'editor.tabWidth': 4, 'scripts.folders': ['/a'] };
  const imported: Settings = { ...before, 'editor.tabWidth': 2, 'scripts.folders': ['/a', '/b'] };

  it('lets a value the user did not touch follow the live value: nothing is left to save or to ask about', () => {
    const next = rebaseValues(snapshotValues(before), before, imported);
    expect(next['editor.tabWidth']).toBe(2);
    expect(next['scripts.folders']).toEqual(['/a', '/b']);
    expect(changedValues(next, imported)).toEqual({});
    // Without the rebase the import counts as an edit (what the close guard and Save used to see).
    expect(Object.keys(changedValues(snapshotValues(before), imported)).sort()).toEqual(['editor.tabWidth', 'scripts.folders']);
  });

  it('keeps a value the user edited, and the patch holds exactly that edit', () => {
    const typed = { ...snapshotValues(before), 'editor.tabWidth': 8 };
    const next = rebaseValues(typed, before, imported);
    expect(next['editor.tabWidth']).toBe(8);
    expect(next['scripts.folders']).toEqual(['/a', '/b']);
    expect(changedValues(next, imported)).toEqual({ 'editor.tabWidth': 8 });
  });

  it('compares lists entry by entry and copies the list it takes over', () => {
    const typed = { ...snapshotValues(before), 'scripts.folders': ['/a', '/c'] };
    expect(rebaseValues(typed, before, imported)['scripts.folders']).toEqual(['/a', '/c']);
    const next = rebaseValues(snapshotValues(before), before, imported);
    expect(next['scripts.folders']).not.toBe(imported['scripts.folders']);
  });

  it('answers the same object when no dialog value moved, and ignores keys the dialog does not render', () => {
    const current = snapshotValues(before);
    expect(rebaseValues(current, before, before)).toBe(current);
    const quiet: Settings = { ...before, 'packages.disabled': ['x'] };
    expect(rebaseValues(current, before, quiet)).toBe(current);
  });

  it('is wired to the live settings store in the dialog', () => {
    // The instance needs a DOM to run; the real flow (import inside Settings, then Save) is a runtime scenario.
    const source = readFileSync(fileURLToPath(new URL('./SettingsDialog.svelte', import.meta.url)), 'utf8');
    expect(source).toMatch(/settings\.values\.subscribe\(\(after\)[\s\S]{0,200}rebaseValues\(current, synced, after\)/);
  });
});

describe('defaultValues', () => {
  it('answers with the defaults of the given rows, as copies', () => {
    const scripts = SETTING_FIELDS.filter((m) => m.category === 'scripts');
    const values = defaultValues(scripts);
    expect(values['scripts.timeoutSeconds']).toBe(60);
    expect(values['scripts.folders']).toEqual([]);
    expect(values['scripts.folders']).not.toBe(DEFAULTS['scripts.folders']);
  });
});

describe('SettingsDialog markup', () => {
  const html = render(SettingsDialog, { props: { close: () => {} } }).body;

  it('is a modal the harness finds by name, with Save and Cancel', () => {
    expect(html).toContain('data-modal="settings"');
    expect(html).toContain('data-testid="modal-ok"');
    expect(html).toContain('data-testid="modal-cancel"');
  });

  it('offers the five pages, with the first one selected', () => {
    for (const category of CATEGORY_ORDER) expect(html).toContain(`data-category="${category}"`);
    expect(html).toContain('data-testid="settings-page"');
    expect(html).toMatch(/data-testid="settings-category"[^>]*data-category="appearance"/);
  });

  it('renders the fields of the open page and not those of another', () => {
    expect(html).toContain('data-field="appearance.theme"');
    expect(html).toContain('data-field="appearance.editorFontSize"');
    expect(html).not.toContain('data-field="editor.tabWidth"');
    expect(html).not.toContain('data-field="scripts.folders"');
  });

  it('has the two footer actions', () => {
    expect(html).toContain('data-testid="settings-reset"');
    expect(html).toContain('data-testid="settings-open-file"');
  });

  it('says nothing about a broken or read-only file when there is none', () => {
    expect(html).not.toContain('data-testid="settings-notice"');
    expect(html).not.toContain('data-testid="settings-readonly"');
  });
});

// B1 A4: Settings asks before it closes with something typed in it.
describe('changing the tab with a machine form open (B1 A9)', () => {
  const asking = (answer: boolean) => {
    const asks: string[] = [];
    return {
      asks,
      confirm: async (o: { message: string }): Promise<boolean> => {
        asks.push(o.message);
        return answer;
      },
    };
  };

  it('asks before leaving the Machines tab with the form open, in the machine wording', async () => {
    const no = asking(false);
    expect(await mayChangeTab(MACHINES_TAB, PROFILES_TAB, true, no.confirm, t)).toBe(false);
    expect(no.asks).toEqual([t('settings.leave.draftMessage')]);
    const yes = asking(true);
    expect(await mayChangeTab(MACHINES_TAB, 'appearance', true, yes.confirm, t)).toBe(true);
    expect(yes.asks).toHaveLength(1);
  });

  it('asks nothing when the form is closed, on any other tab, or on a click on the tab that is shown', async () => {
    const none = asking(false);
    expect(await mayChangeTab(MACHINES_TAB, PROFILES_TAB, false, none.confirm, t)).toBe(true);
    expect(await mayChangeTab(PROFILES_TAB, MACHINES_TAB, true, none.confirm, t)).toBe(true);
    expect(await mayChangeTab('appearance', PROFILES_TAB, true, none.confirm, t)).toBe(true);
    expect(await mayChangeTab(MACHINES_TAB, MACHINES_TAB, true, none.confirm, t)).toBe(true);
    expect(none.asks).toEqual([]);
  });

  it('is what the tab buttons and the arrow keys go through', () => {
    const source = readFileSync(fileURLToPath(new URL('./SettingsDialog.svelte', import.meta.url)), 'utf8');
    expect(source).toContain('mayChangeTab(active, category, machinesModel.hasDraft()');
    expect(source).toContain('onclick={() => void selectCategory(tab)}');
    expect(source).toContain('void selectCategory(tabs[next])');
  });
});

describe('leaving with something typed', () => {
  it('asks nothing when nothing was changed', async () => {
    expect(leaveQuestion({ values: false, draft: false }, t)).toBeNull();
    let asked = 0;
    const ok = await mayLeave(
      { values: false, draft: false },
      async () => {
        asked += 1;
        return false;
      },
      t,
    );
    expect(ok).toBe(true);
    expect(asked).toBe(0);
  });

  it('names what would be lost, in the template manager’s words', () => {
    const values = leaveQuestion({ values: true, draft: false }, t);
    const draft = leaveQuestion({ values: false, draft: true }, t);
    const both = leaveQuestion({ values: true, draft: true }, t);
    expect(values?.message).toBe(t('settings.leave.valuesMessage'));
    expect(draft?.message).toBe(t('settings.leave.draftMessage'));
    expect(both?.message).toBe(t('settings.leave.bothMessage'));
    expect(new Set([values?.message, draft?.message, both?.message]).size).toBe(3);
    expect(values?.title).toBe(t('settings.leave.title'));
    expect(values?.ok).toBe(t('settings.leave.ok'));
  });

  it('closes only when the user agrees', async () => {
    const asks: string[] = [];
    const answer = (value: boolean) => async (o: { title: string; message: string }): Promise<boolean> => {
      asks.push(o.message);
      return value;
    };
    expect(await mayLeave({ values: false, draft: true }, answer(false), t)).toBe(false);
    expect(await mayLeave({ values: true, draft: false }, answer(true), t)).toBe(true);
    expect(asks).toHaveLength(2);
  });

  it('gives every opener a model whose question starts as "yes" and a mayClose that uses it', async () => {
    const { props, options } = settingsModal('machines');
    expect(props.initialTab).toBe('machines');
    expect(await options.mayClose!()).toBe(true);
    props.model.leave = async () => false;
    expect(await options.mayClose!()).toBe(false);
    expect('initialTab' in settingsModal().props).toBe(false);
  });

  it('has the texts it asks with', () => {
    for (const key of ['title', 'valuesMessage', 'draftMessage', 'bothMessage', 'ok']) {
      expect(hasKey(`settings.leave.${key}`), key).toBe(true);
    }
  });
});

// P4.37 (§6.9 rules 40, 41, 43). The keyboard and focus behaviour of the box needs a DOM and is
// the runtime scenario's; what the box searches, what a hit leads to and the language row are here.
describe('the settings search (rule 43)', () => {
  const tabLabel = (tab: string): string => t(`settings.categories.${tab}`);
  const entries = searchEntriesOf(pagesOf(), deps, tabLabel);
  const hitIds = (query: string, list = entries): string[] => searchSettings(query, list).map((h) => h.entry.id);

  it('has a heading entry for every tab, then a row entry for every row that is in the dialog', () => {
    const pages = entries.filter((e) => e.kind === 'page');
    expect(pages.map((e) => e.id)).toEqual(tabsOf(pagesOf()));
    expect(pages.map((e) => e.label)).toContain('Keyboard');
    expect(pages.map((e) => e.label)).toContain('Configuration');
    const rows = entries.filter((e) => e.kind === 'setting');
    expect(rows.map((e) => e.id)).toEqual(pagesOf().flatMap((p) => p.metas.map((m) => m.key)));
    expect(entries.slice(0, pages.length)).toEqual(pages);
  });

  it('offers a setting whose row is not in the dialog nowhere', () => {
    expect(entries.map((e) => e.id)).not.toContain('editor.rulers');
    expect(entries.map((e) => e.id)).not.toContain('packages.disabled');
    expect(hitIds('rulers')).toEqual([]);
    // The language row is in only when a second language ships.
    expect(entries.some((e) => e.id === 'ui.language')).toBe(offersLanguageChoice());
  });

  it('gives each row its translated label and help, and the page it is on', () => {
    const row = entries.find((e) => e.id === 'editor.tabWidth');
    expect(row).toEqual({
      id: 'editor.tabWidth',
      kind: 'setting',
      tab: 'editor',
      label: t('settings.editor.tabWidth.label'),
      help: t('settings.editor.tabWidth.help'),
    });
  });

  it('finds a setting by its label, its help text or its key, and a page by its heading', () => {
    expect(hitIds('tab width')[0]).toBe('editor.tabWidth');
    expect(hitIds('previous version never gone')).toContain('files.backup');
    expect(hitIds('assist.motionColors')[0]).toBe('assist.motionColors');
    expect(searchSettings('keyboard', entries)[0]).toMatchObject({ entry: { id: 'keyboard', kind: 'page', tab: 'keyboard' } });
    expect(hitIds('packages')[0]).toBe('packages');
    expect(hitIds('machines')[0]).toBe('machines');
    expect(hitIds('profiles')[0]).toBe('profiles');
    expect(hitIds('')).toEqual([]);
  });

  it('finds a list row (the script folders) like any other', () => {
    expect(hitIds('script folder')).toContain('scripts.folders');
  });

  it('follows the language in use: the texts it is given are the ones searched', () => {
    const german: SpecDeps = { ...deps, translate: (key) => `de:${key}` };
    const translated = searchEntriesOf(pagesOf(), german, (tab) => `Seite ${tab}`);
    expect(hitIds('seite keyboard', translated)).toEqual(['keyboard']);
    expect(hitIds('de:settings.editor.tabWidth.label', translated)).toEqual(['editor.tabWidth']);
    // The English words are no longer in the labels; the key is, so a programmer who knows the key still finds it.
    expect(hitIds('Tab width', translated)).toContain('editor.tabWidth');
  });

  it('finds a hit’s control: the first input, select or button of the row (data-field)', () => {
    const control = { id: 'control' } as unknown as HTMLElement;
    const row = { querySelector: (selector: string) => (selector.includes('input') ? control : null) };
    const seen: string[] = [];
    const page = {
      querySelector: (selector: string) => {
        seen.push(selector);
        return selector === '[data-field="editor.tabWidth"]' ? row : null;
      },
    } as unknown as ParentNode;
    expect(controlOfRow(page, 'editor.tabWidth')).toBe(control);
    expect(controlOfRow(page, 'editor.minimap')).toBeNull();
    expect(seen).toEqual(['[data-field="editor.tabWidth"]', '[data-field="editor.minimap"]']);
    // A row without a control of those kinds is itself the target.
    const bare = { querySelector: () => null };
    const pageBare = { querySelector: () => bare } as unknown as ParentNode;
    expect(controlOfRow(pageBare, 'x')).toBe(bare);
  });

  it('renders the box before the pages, with its test id, and no result list while it is empty', () => {
    const html = render(SettingsDialog, { props: { close: () => {} } }).body;
    expect(html).toContain('data-testid="settings-search"');
    expect(html).toContain('role="searchbox"');
    expect(html.indexOf('data-testid="settings-search"')).toBeLessThan(html.indexOf('data-testid="settings-category"'));
    expect(html).not.toContain('data-testid="settings-search-hit"');
    expect(html).not.toContain('data-testid="settings-search-none"');
  });

  it('wires Escape to clear the box before it reaches the dialog, and Enter to take the best hit, not to Save', () => {
    const source = readFileSync(fileURLToPath(new URL('./SettingsDialog.svelte', import.meta.url)), 'utf8');
    const handler = source.slice(source.indexOf('function onSearchKey'), source.indexOf('function onHitKey'));
    expect(handler).toMatch(/e\.key === 'Escape' && searching/);
    expect(handler).toContain('e.stopPropagation()');
    expect(handler).toContain('void chooseHit(hits[0])');
    // Escape with an empty box is not handled: it closes the dialog as before.
    expect(handler).not.toMatch(/Escape'\s*\)/);
    // The keys are listened for by hand on the wrapper: a delegated `onkeydown` never sees Enter and Escape, because the
    // dialog frame stops them on its own panel first (the environment has no DOM, so the order is pinned by the wiring).
    expect(source).toContain('class="search" use:searchKeys');
    expect(source).toMatch(/function searchKeys[\s\S]*addEventListener\('keydown'/);
    expect(source).not.toContain('onkeydown={onSearchKey}');
    expect(source).not.toMatch(/onkeydown=\{\(e\) => onHitKey/);
    expect(source).toContain('data-testid="settings-search-hit"');
    expect(source).toMatch(/data-id=\{hit\.entry\.id\}/);
    expect(source).toMatch(/data-tab=\{hit\.entry\.tab\}/);
  });

  it('has the texts of the box', () => {
    for (const key of ['label', 'placeholder', 'clear', 'hitsLabel', 'none', 'page', 'inPage', 'found_one', 'found_other']) {
      expect(hasKey(`settings.search.${key}`), key).toBe(true);
    }
  });
});

describe('the language row (rules 37, 40, 41)', () => {
  const english = { tag: 'en', name: 'English' };
  const deutsch = { tag: 'de', name: 'Deutsch' };

  it('is not offered while English alone ships', () => {
    const row = SETTING_FIELDS.find((m) => m.key === 'ui.language') as SettingFieldMeta;
    expect(row.dialog).toBe(false);
    expect(pagesOf().flatMap((p) => p.metas).map((m) => m.key)).not.toContain('ui.language');
    expect(Object.keys(snapshotValues(DEFAULTS))).not.toContain('ui.language');
    const html = render(SettingsDialog, { props: { close: () => {} } }).body;
    expect(html).not.toContain('data-field="ui.language"');
  });

  it('is a choice among the languages that ship, by their own names, once a second one does', () => {
    const row = { ...(SETTING_FIELDS.find((m) => m.key === 'ui.language') as SettingFieldMeta), dialog: true };
    const withLanguages: SpecDeps = { ...deps, choicesFor: (key) => (key === 'ui.language' ? languageChoices('en', [english, deutsch], t) : undefined) };
    const spec = specOf(row, withLanguages);
    expect(spec.label).toBe(t('settings.ui.language.label'));
    expect(spec.help).toBe(t('settings.ui.language.help'));
    expect(spec.choices).toEqual([
      { label: 'English', value: 'en' },
      { label: 'Deutsch', value: 'de' },
    ]);
    expect(validateFields([spec], { 'ui.language': 'de' })).toEqual({});
    const pages = pagesOf([row]);
    expect(pages.map((p) => p.category)).toEqual(['appearance']);
    expect(snapshotValues(DEFAULTS, [row])).toEqual({ 'ui.language': 'en' });
    expect(changedValues({ 'ui.language': 'de' }, DEFAULTS, [row])).toEqual({ 'ui.language': 'de' });
  });

  it('keeps a stored value that is not offered as one more choice, so opening the dialog changes nothing', () => {
    const choices = languageChoices('de-CH', [english, deutsch], t);
    expect(choices.map((c) => c.value)).toEqual(['en', 'de', 'de-CH']);
    expect(choices[2].label).toBe('de-CH (shown as Deutsch)');
    expect(languageChoices('fr', [english, deutsch], t)[2].label).toBe('fr (shown as English)');
    expect(languageChoices('en', [english, deutsch], t)).toHaveLength(2);
    expect(languageChoices(undefined, [english], t)).toEqual([{ label: 'English', value: 'en' }]);
  });

  it('says on Save that the change applies at the next start, and only when the language changed', () => {
    expect(savedMessage({ 'ui.language': 'de' }, t)).toBe('Settings saved. The change applies the next time gEdit starts.');
    expect(savedMessage({ 'editor.tabWidth': 2 }, t)).toBe(t('settings.saved'));
    expect(savedMessage({}, t)).toBe(t('settings.saved'));
    // The dialog uses it, and builds nothing that switches the language while the app runs (rule 40).
    const source = readFileSync(fileURLToPath(new URL('./SettingsDialog.svelte', import.meta.url)), 'utf8');
    expect(source).toContain('status.show(savedMessage(patch, t))');
  });

  it('has its texts', () => {
    for (const key of ['settings.languageNextStart', 'settings.languageLoadFailed', 'settings.languageOther', 'settings.ui.language.label', 'settings.ui.language.help']) {
      expect(hasKey(key), key).toBe(true);
    }
    expect(t('settings.ui.language.help')).toContain('applies the next time gEdit starts');
  });
});
