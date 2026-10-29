// The settings schema (plan §7.7, AD-8). Written in full by the M2 prelude (P2); binding.
//
// One flat, dotted key per setting. `settings.json` holds only the values that differ
// from `DEFAULTS`, plus `"$version": 1`, so a default that changes in a later release
// reaches users who never touched that key.
//
// This module is the single source of truth for three consumers:
//   - `stores/settings.ts` (WP2.6) merges the user file over `DEFAULTS` and validates it
//   - `SettingsDialog.svelte` (WP2.7) renders `SETTING_FIELDS` with `dialog: true`
//   - `monaco/editorOptions.ts` (WP2.6) maps the effective values onto Monaco
// Rust reads the four `scripts.*` keys straight from the file (AD-8); they are never
// passed as arguments of a `script_run`. They are still ordinary settings — the dialog
// offers `scripts.python` and `scripts.folders`, and the dialog saves through
// `settings_save` like every other key — so this is one source of truth for them, not a
// boundary against the webview (`src-tauri/src/scripts/settings.rs`).
//
// i18n: `SETTING_FIELDS` is a static table, so it cannot hold translated text. Every
// label, help text and choice label is an **i18n key** in the `settings` namespace
// (WP2.7 owns `i18n/en/settings.ts`); WP2.7 resolves them through `t()` when it builds
// the `FieldSpec`s it hands to `FormRenderer`. `FieldSpec.label` itself stays display
// text (§7.5), because script and profile labels are data.

import type { FieldSpec } from '$lib/core/forms/types';
import { offersLanguageChoice } from '$lib/i18n/locale';
import type { ProfileColors } from '$lib/core/profiles/types';

/** The `$version` this build writes. A file with a higher version is read, never written. */
export const SETTINGS_VERSION = 1;

/**
 * Every setting, by its dotted key (plan §7.7). The value types are exactly what
 * `settings.json` may carry, so a merged value that does not match is dropped with a
 * warning and the default is used instead (WP2.6).
 */
export interface Settings {
  'appearance.theme': 'system' | 'light' | 'dark';
  'appearance.editorFontFamily': string;
  /** 8-32. */
  'appearance.editorFontSize': number;
  /**
   * P4h (§6.10 rule 6): the user's own colour per role and theme, over the built-in palette
   * and under a profile's own colours. Every colour is `#rrggbb` with a contrast of at least
   * 4.5:1 against the editor background of its theme; one that is not is reported and not
   * used. Edited in Settings, Appearance ("Code colours"), not by the form renderer.
   */
  'appearance.roleColors': ProfileColors;
  /** 1-16. */
  'editor.tabWidth': number;
  'editor.insertSpaces': boolean;
  'editor.renderWhitespace': 'none' | 'boundary' | 'all';
  'editor.wordWrap': boolean;
  'editor.minimap': boolean;
  'editor.lineNumbers': boolean;
  'editor.highlightCurrentLine': boolean;
  'editor.stickyScroll': boolean;
  /** Monaco's drag-and-drop of selected text; off, because it fights file drop. */
  'editor.dragAndDrop': boolean;
  'editor.emptySelectionClipboard': boolean;
  /** Column rulers. Not in the dialog: edit `settings.json`. */
  'editor.rulers': number[];
  'assist.hover': boolean;
  'assist.completion': 'auto' | 'manual' | 'off';
  /**
   * T214: whether Enter takes the highlighted suggestion while the suggestion list is open.
   * Off: Enter always ends the block (an NC block ends with Enter, and the list is open for
   * most of it); Tab takes the suggestion either way.
   */
  'assist.acceptOnEnter': boolean;
  /**
   * Phase 3 (P3a prelude; P3.7): a coloured mark beside every line that moves, by how it
   * moves (rapid, straight, arc, thread, cycle), read from the modal state.
   */
  'assist.motionColors': boolean;
  /** 0-50. */
  'files.recentLength': number;
  /** What happens when a file changes on disk. A dirty document always asks (AD-10). */
  'files.externalChange': 'ask' | 'reload';
  /** A profile id from the profile registry. */
  'files.defaultProfile': string;
  /**
   * M7, AD-21. Where the copy of a file goes that is made **before** a save
   * overwrites it. `history` keeps the last `files.backupCount` versions under the
   * app's own data folder, so the shop folder a DNC or CAM watcher looks at stays
   * clean; `sibling` writes `<path>.bak` next to the file; `off` writes nothing.
   *
   * Rust reads this key and `files.backupCount` straight from the file (the AD-8
   * pattern), so they are never arguments of `files_backup`.
   */
  'files.backup': 'off' | 'sibling' | 'history';
  /** 1-50: how many versions `history` keeps per file. */
  'files.backupCount': number;
  /**
   * B1 A2: the most the copies of all files together may take, in megabytes; the oldest
   * go first, and the newest copy of a file that still exists never does. 0 = no limit.
   */
  'files.backupTotalMb': number;
  /**
   * B1 A2: days after its last copy that the copies of a file that no longer exists are
   * deleted. 0 = keep them for ever.
   */
  'files.backupOrphanDays': number;
  /** M7, AD-21: snapshot dirty documents so a crash or a power cut costs at most 30 s. */
  'files.recovery': boolean;
  /** M7, AD-22: reopen the files that were open when gEdit was last closed. */
  'files.restoreSession': boolean;
  /**
   * M7, AD-22: remember per file where the cursor was, which lines were bookmarked,
   * and a dialect or machine chosen by hand.
   */
  'files.rememberPerFile': boolean;
  /** Absolute path of a Python interpreter; empty means "find one". */
  'scripts.python': string;
  /** Extra script folders, in order; they become the `extra<N>:` roots. */
  'scripts.folders': string[];
  /** 1-3600. */
  'scripts.timeoutSeconds': number;
  'scripts.showBundled': boolean;
  /**
   * P4g (plan §6.9 rules 37–42, Q4-18): the interface language, a tag such as `en` or `de-CH`
   * (`isLocaleTag`). A tag with no message set that ships, and any other value, shows English.
   * Takes effect at the next start. The dialog offers it only when a second language ships
   * (`offersLanguageChoice`), so its row is `dialog: false` until then (P4.37).
   */
  'ui.language': string;
  /**
   * P4g (AD-56, plan §6.9 rule 12): the script packages that are switched off, by folder name.
   * Rust reads this key straight from the file, like `scripts.*`. Edited on the Packages page,
   * never in the dialog's forms.
   */
  'packages.disabled': string[];
}

/** `Object.freeze` without widening the value's type, so `DEFAULTS` stays a `Settings`. */
function freeze<T>(value: T): T {
  return Object.freeze(value) as T;
}

/**
 * The effective value of every key that the user has not set.
 *
 * Frozen, including the array values: the defaults are handed out by reference, and a
 * consumer that wants to change one has to copy it first.
 */
export const DEFAULTS: Settings = freeze({
  'appearance.theme': 'system',
  'appearance.editorFontFamily': "Menlo, Consolas, 'DejaVu Sans Mono', monospace",
  'appearance.editorFontSize': 14,
  'appearance.roleColors': freeze<ProfileColors>({}),
  'editor.tabWidth': 4,
  'editor.insertSpaces': true,
  'editor.renderWhitespace': 'none',
  'editor.wordWrap': false,
  'editor.minimap': false,
  'editor.lineNumbers': true,
  'editor.highlightCurrentLine': true,
  'editor.stickyScroll': true,
  'editor.dragAndDrop': false,
  'editor.emptySelectionClipboard': true,
  'editor.rulers': freeze<number[]>([]),
  'assist.hover': true,
  'assist.completion': 'auto',
  'assist.acceptOnEnter': false,
  'assist.motionColors': true,
  'files.recentLength': 15,
  'files.externalChange': 'reload',
  'files.defaultProfile': 'fanuc-gcode',
  // The default is `history`, not `off`: the one thing this milestone exists for is
  // that the bytes a save replaced are still somewhere afterwards (AD-21).
  'files.backup': 'history',
  'files.backupCount': 5,
  'files.backupTotalMb': 500,
  'files.backupOrphanDays': 90,
  'files.recovery': true,
  'files.restoreSession': true,
  'files.rememberPerFile': true,
  'scripts.python': '',
  'scripts.folders': freeze<string[]>([]),
  'scripts.timeoutSeconds': 60,
  'scripts.showBundled': true,
  'ui.language': 'en',
  'packages.disabled': freeze<string[]>([]),
} satisfies Settings);

/** The pages of the settings dialog, in the order they are shown (WP2.7). */
export type SettingCategory = 'appearance' | 'editor' | 'assistance' | 'files' | 'scripts';

/** One row of the settings table: the key, where it is shown, and how it is edited. */
export interface SettingFieldMeta {
  key: keyof Settings;
  category: SettingCategory;
  /** `field.id` is the setting key, so a form's values record *is* a settings patch. */
  field: Omit<FieldSpec, 'label' | 'help'>;
  /** i18n key in the `settings` namespace. */
  labelKey: string;
  /** i18n key in the `settings` namespace. */
  helpKey?: string;
  /** False for a key that can only be edited in `settings.json`. */
  dialog: boolean;
}

/** Builds one row, keeping `field.id` and `field.default` in step with `Settings`. */
function meta<K extends keyof Settings>(
  key: K,
  category: SettingCategory,
  spec: Omit<FieldSpec, 'id' | 'label' | 'help' | 'default'>,
  o: { dialog?: boolean } = {},
): SettingFieldMeta {
  return {
    key,
    category,
    field: { id: key, default: DEFAULTS[key], ...spec },
    labelKey: `settings.${key}.label`,
    helpKey: `settings.${key}.help`,
    dialog: o.dialog ?? true,
  };
}

/** The choice labels are i18n keys, like `labelKey`; WP2.7 translates them. */
function choice(key: keyof Settings, values: string[]): { label: string; value: unknown }[] {
  return values.map((value) => ({ label: `settings.${key}.choices.${value}`, value }));
}

/**
 * Every setting, in dialog order. The order inside a category is the order of the
 * controls on that page.
 *
 * Known gap (see the P2 hand-off note): `FieldType` has no list type, so
 * `editor.rulers` and `scripts.folders` carry the closest single-value type.
 * `editor.rulers` is `dialog: false` and is never rendered; `scripts.folders` is the
 * "list with add and remove" of §7.7 and WP2.7 renders it with its own control, using
 * the `folder` picker for each entry.
 */
export const SETTING_FIELDS: SettingFieldMeta[] = [
  // Appearance
  meta('appearance.theme', 'appearance', {
    type: 'choice',
    choices: choice('appearance.theme', ['system', 'light', 'dark']),
  }),
  // `required` is not decoration: it is the one place the "this string may not be empty"
  // rule is written down. `validateFields` blocks Save on it in the settings dialog, and
  // `core/settings/merge.ts` reads the same flag when it validates the file, so a hand
  // edit and the dialog cannot disagree (G8 M2).
  meta('appearance.editorFontFamily', 'appearance', { type: 'text', required: true }),
  meta('appearance.editorFontSize', 'appearance', { type: 'integer', min: 8, max: 32 }),
  // A palette is not a form field either: the role colour editor (`RoleColorRows.svelte`)
  // draws it under the theme choice, so the form renderer never sees it (P4.41).
  meta('appearance.roleColors', 'appearance', { type: 'text' }, { dialog: false }),

  // Editor
  meta('editor.tabWidth', 'editor', { type: 'integer', min: 1, max: 16 }),
  meta('editor.insertSpaces', 'editor', { type: 'bool' }),
  meta('editor.renderWhitespace', 'editor', {
    type: 'choice',
    choices: choice('editor.renderWhitespace', ['none', 'boundary', 'all']),
  }),
  meta('editor.wordWrap', 'editor', { type: 'bool' }),
  meta('editor.minimap', 'editor', { type: 'bool' }),
  meta('editor.lineNumbers', 'editor', { type: 'bool' }),
  meta('editor.highlightCurrentLine', 'editor', { type: 'bool' }),
  meta('editor.stickyScroll', 'editor', { type: 'bool' }),
  meta('editor.dragAndDrop', 'editor', { type: 'bool' }),
  meta('editor.emptySelectionClipboard', 'editor', { type: 'bool' }),
  meta('editor.rulers', 'editor', { type: 'text' }, { dialog: false }),

  // Assistance
  meta('assist.hover', 'assistance', { type: 'bool' }),
  meta('assist.completion', 'assistance', {
    type: 'choice',
    choices: choice('assist.completion', ['auto', 'manual', 'off']),
  }),
  meta('assist.acceptOnEnter', 'assistance', { type: 'bool' }),
  meta('assist.motionColors', 'assistance', { type: 'bool' }),

  // Files
  meta('files.recentLength', 'files', { type: 'integer', min: 0, max: 50 }),
  meta('files.externalChange', 'files', {
    type: 'choice',
    choices: choice('files.externalChange', ['ask', 'reload']),
  }),
  // The choices come from the profile registry at render time (WP2.7).
  meta('files.defaultProfile', 'files', { type: 'choice', choices: [], required: true }),
  meta('files.backup', 'files', {
    type: 'choice',
    choices: choice('files.backup', ['history', 'sibling', 'off']),
  }),
  meta('files.backupCount', 'files', { type: 'integer', min: 1, max: 50 }),
  meta('files.backupTotalMb', 'files', { type: 'integer', min: 0, max: 1000000 }),
  meta('files.backupOrphanDays', 'files', { type: 'integer', min: 0, max: 3650 }),
  meta('files.recovery', 'files', { type: 'bool' }),
  meta('files.restoreSession', 'files', { type: 'bool' }),
  meta('files.rememberPerFile', 'files', { type: 'bool' }),

  // Scripts
  meta('scripts.python', 'scripts', { type: 'file' }),
  meta('scripts.folders', 'scripts', { type: 'folder' }),
  meta('scripts.timeoutSeconds', 'scripts', { type: 'integer', min: 1, max: 3600 }),
  meta('scripts.showBundled', 'scripts', { type: 'bool' }),

  // P4g: the language row is on the Appearance page only when a second language ships
  // (`offersLanguageChoice`, rule 41); its choices are the languages that ship, filled in by the
  // dialog. The package list has a page of its own and is never a form row.
  meta('ui.language', 'appearance', { type: 'choice', choices: [] }, { dialog: offersLanguageChoice() }),
  meta('packages.disabled', 'scripts', { type: 'text' }, { dialog: false }),
];
