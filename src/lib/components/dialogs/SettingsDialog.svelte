<!--
  The settings dialog (plan §5 WP2.7, §7.7). Owner: WP2.7.

  Five pages - Appearance, Editor, Assistance, Files, Scripts - built from
  `SETTING_FIELDS` and drawn by `FormRenderer`, so a new setting needs one row in
  `core/settings/schema.ts` plus its three i18n keys and nothing here.

  What this dialog adds on top of `FormRenderer`:
    - `SETTING_FIELDS` carries i18n **keys** (it is a static table); `specOf` resolves the
      label, the help text and the choice labels through `t()` before a `FieldSpec` is
      built (AD-14).
    - `files.defaultProfile` has no choices of its own: they are the profile registry's,
      and profile names are data and stay untranslated.
    - `scripts.folders` is a list, and §7.5 has no list field type, so it is left out of
      the `FieldSpec[]` and rendered by the control below - handing an array to a `folder`
      field would only produce `forms.errors.invalid` (WP2.2 §6).

  Opened by `settings.open` through `modals.open`, so ModalHost renders it inside the
  `Modal` frame (which is where `data-testid="modal"` comes from) and it is never mounted
  directly.

  P4.37 (plan §6.9 rules 40, 41, 43): the search box above the pages, and the language row. The
  box is `searchSettings` over `searchEntriesOf` (every row that is in the dialog, and the
  heading of every page); choosing a hit opens its page and focuses the control. The language row
  is on the Appearance page only when a second language ships (`ui.language` has `dialog:
  offersLanguageChoice()` in the schema); its choices are `languageChoices`, and Save says that
  the change applies at the next start.

  Save writes a patch of the values that actually changed; the store turns that into a
  file holding only the non-default values. "Reset category" is the store's `reset()` and
  therefore hits the file immediately, which the confirmation says.
-->
<script module lang="ts">
  import {
    DEFAULTS,
    SETTING_FIELDS,
    type SettingCategory,
    type SettingFieldMeta,
    type Settings,
  } from '$lib/core/settings/schema';
  import type { FieldChoice, FieldSpec } from '$lib/core/forms/types';
  import type { SearchEntry } from '$lib/core/settings/search';
  import type { ProfileColors } from '$lib/core/profiles/types';
  import { resolveLocale, type LocaleInfo } from '$lib/i18n/locale';
  import type { ModalOptions, Translate } from '$lib/app/types';

  /** The pages, in the order §7.7 lists them. */
  export const CATEGORY_ORDER: readonly SettingCategory[] = [
    'appearance',
    'editor',
    'assistance',
    'files',
    'scripts',
  ];

  /**
   * Keys whose value is a list. `FieldType` has none, so these are rendered by this
   * dialog's own add-and-remove control and never reach `FormRenderer` or
   * `validateFields`.
   */
  export const LIST_KEYS: readonly string[] = ['scripts.folders'];

  export function isListKey(key: string): boolean {
    return LIST_KEYS.includes(key);
  }

  /** One page of the dialog. */
  export interface SettingsPage {
    category: SettingCategory;
    /** Every row of that category with `dialog: true`, in table order. */
    metas: SettingFieldMeta[];
  }

  /**
   * The Machines page (M6, AD-31). It is **not** a settings category: machine
   * configurations are records in `machines.json`, not keys in `settings.json` (D50), and
   * `pagesOf` only builds pages from `SETTING_FIELDS` (F47). So it is a tab of its own,
   * after the schema pages, and the page component owns everything inside it.
   */
  // Typed with its own literal so an importer keeps it (svelte2tsx widens a plain `const`
  // export to `string`, and `machines.manage` passes it as a `DialogTab`).
  export const MACHINES_TAB: 'machines' = 'machines';

  /**
   * The Profiles page (M13, AD-29): your own profiles and code files are files in two
   * folders, not settings keys, so it is a tab of its own like Machines.
   */
  export const PROFILES_TAB: 'profiles' = 'profiles';

  /**
   * The Keyboard, Packages and Configuration pages (P4g, plan §6.9). Like Machines and Profiles
   * they are not settings categories: each edits a file or a folder of its own (`keybindings.json`,
   * `<config>/packages`, the configuration zip), acts at once, and has no Save of this dialog's.
   * The prelude wired the tabs and their placeholder pages; P4.34, P4.35 and P4.36 fill the pages
   * and P4.37 owns this file from here.
   */
  export const KEYBOARD_TAB: 'keyboard' = 'keyboard';
  export const PACKAGES_TAB: 'packages' = 'packages';
  export const CONFIGURATION_TAB: 'configuration' = 'configuration';

  /** A tab of the dialog: a settings category, or one of the pages that are not settings. */
  export type DialogTab =
    | SettingCategory
    | typeof MACHINES_TAB
    | typeof PROFILES_TAB
    | typeof KEYBOARD_TAB
    | typeof PACKAGES_TAB
    | typeof CONFIGURATION_TAB;

  /** The pages that act on their own: nothing of theirs is saved, reset or asked about by the dialog's buttons. */
  export const PAGE_TABS: readonly DialogTab[] = [
    MACHINES_TAB,
    PROFILES_TAB,
    KEYBOARD_TAB,
    PACKAGES_TAB,
    CONFIGURATION_TAB,
  ];

  /** The tabs, in order: the schema pages, then Machines, Profiles, Keyboard, Packages and Configuration. */
  export function tabsOf(pages: readonly SettingsPage[]): DialogTab[] {
    return [...pages.map((page) => page.category), ...PAGE_TABS];
  }

  /**
   * What the dialog tells whoever opened it. `leave` is the dialog's own question "may this
   * close without losing what was typed?"; the opener hands it to `modals.open` as `mayClose`,
   * so Esc with the focus outside the panel and a press outside it ask too (B1 A4). Until the
   * dialog is on screen there is nothing to lose.
   */
  export interface SettingsModel {
    leave: () => Promise<boolean>;
  }

  /**
   * The props and the options every opener of this dialog passes to `modals.open`, so that
   * all of them (`settings.open`, `profile.manage`, `machines.manage`) get the same question.
   */
  export function settingsModal(initialTab?: DialogTab): {
    props: { initialTab?: DialogTab; model: SettingsModel };
    options: ModalOptions;
  } {
    const model: SettingsModel = { leave: async () => true };
    return {
      props: { ...(initialTab === undefined ? {} : { initialTab }), model },
      options: { mayClose: () => model.leave() },
    };
  }

  /** What would be lost by leaving: values changed on a settings page, an unfinished machine form. */
  export interface LeaveState {
    values: boolean;
    draft: boolean;
    /** The file of a profile form that has unsaved changes (Profiles page), else null or left out. */
    profile?: string | null;
  }

  /** The question to ask for `state`, or null when nothing would be lost. Wording after the template manager's. */
  export function leaveQuestion(
    state: LeaveState,
    translate: Translate,
  ): { title: string; message: string; ok: string } | null {
    const profile = state.profile ?? null;
    if (!state.values && !state.draft && profile === null) return null;
    return {
      title: translate('settings.leave.title'),
      message:
        profile !== null
          ? translate(state.values ? 'profileForm.leave.withSettings' : 'profileForm.leave.message', { name: profile })
          : state.values
            ? state.draft
              ? translate('settings.leave.bothMessage')
              : translate('settings.leave.valuesMessage')
            : translate('settings.leave.draftMessage'),
      ok: translate('settings.leave.ok'),
    };
  }

  /** Asks `leaveQuestion` when there is one; true when leaving is fine. */
  export async function mayLeave(
    state: LeaveState,
    confirm: (o: { title: string; message: string; ok: string; kind: 'warning' }) => Promise<boolean>,
    translate: Translate,
  ): Promise<boolean> {
    const question = leaveQuestion(state, translate);
    return question === null ? true : confirm({ ...question, kind: 'warning' });
  }

  /**
   * May the dialog change from tab `from` to tab `to`? Only the Machines page holds something
   * a tab change would lose: it is unmounted when another tab is shown, and with it a
   * half-filled machine form. So a change away from Machines asks while the form is open
   * (`draft`); every other change, and a click on the tab that is already shown, is free
   * (B1 A9, the open point of A4). The settings values are kept across tabs and are not asked about.
   */
  export async function mayChangeTab(
    from: DialogTab,
    to: DialogTab,
    draft: boolean,
    confirm: (o: { title: string; message: string; ok: string; kind: 'warning' }) => Promise<boolean>,
    translate: Translate,
    profile: string | null = null,
  ): Promise<boolean> {
    if (to === from) return true;
    // The Profiles page holds the same kind of thing: an inline form with changes not saved.
    if (from === PROFILES_TAB && profile !== null) return mayLeave({ values: false, draft: false, profile }, confirm, translate);
    if (from !== MACHINES_TAB || !draft) return true;
    return mayLeave({ values: false, draft: true }, confirm, translate);
  }

  /**
   * Whether two palettes (`appearance.roleColors`) hold the same colours. The dialog's palette
   * keeps the order the roles were edited in and the saved one is in the order of the roles, so
   * the comparison goes role by role (and ignores a theme with no colours).
   */
  export function samePalette(a: unknown, b: unknown): boolean {
    const canonical = (palette: unknown): string => {
      const out: [string, [string, unknown][]][] = [];
      if (typeof palette === 'object' && palette !== null) {
        for (const mode of Object.keys(palette).sort()) {
          const roles = (palette as Record<string, unknown>)[mode];
          if (typeof roles !== 'object' || roles === null) continue;
          const entries = Object.entries(roles).filter(([, value]) => value !== undefined).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
          if (entries.length > 0) out.push([mode, entries]);
        }
      }
      return JSON.stringify(out);
    };
    return canonical(a) === canonical(b);
  }

  /** The pages that have something to show, in `CATEGORY_ORDER`. */
  export function pagesOf(metas: readonly SettingFieldMeta[] = SETTING_FIELDS): SettingsPage[] {
    return CATEGORY_ORDER.map((category) => ({
      category,
      metas: metas.filter((meta) => meta.dialog && meta.category === category),
    })).filter((page) => page.metas.length > 0);
  }

  /** What `specOf` needs from the outside world, so it stays pure and testable. */
  export interface SpecDeps {
    translate: Translate;
    /** `t()` answers with the key itself when there is no message; this keeps that off the screen. */
    hasKey: (key: string) => boolean;
    /** Options for a field whose choices are data rather than schema (`files.defaultProfile`). */
    choicesFor?: (key: keyof Settings) => FieldChoice[] | undefined;
  }

  /** `t(key)`, or nothing when the namespace has no message for it. */
  function message(key: string | undefined, deps: SpecDeps): string | undefined {
    if (key === undefined) return undefined;
    return deps.hasKey(key) ? deps.translate(key) : undefined;
  }

  /**
   * The `FieldSpec` for one row: `field` with its i18n keys resolved. `field.id` is the
   * setting key, so the values record of the form **is** a settings patch.
   */
  export function specOf(meta: SettingFieldMeta, deps: SpecDeps): FieldSpec {
    const spec: FieldSpec = {
      ...meta.field,
      id: meta.key,
      label: message(meta.labelKey, deps) ?? meta.key,
    };
    const help = message(meta.helpKey, deps);
    if (help !== undefined) spec.help = help;
    const own = meta.field.choices ?? [];
    if (own.length > 0) {
      spec.choices = own.map((choice) => ({
        ...choice,
        label: message(choice.label, deps) ?? choice.label,
      }));
    } else if (meta.field.type === 'choice' || meta.field.type === 'address-list') {
      spec.choices = deps.choicesFor?.(meta.key) ?? [];
    }
    return spec;
  }

  /** Copies the container of a list value, so editing the form cannot touch `DEFAULTS`. */
  function detach(value: unknown): unknown {
    return Array.isArray(value) ? [...value] : value;
  }

  /** Values of the same shape? Arrays compare entry by entry; everything else is `Object.is`. */
  export function sameValue(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) || Array.isArray(b)) {
      return (
        Array.isArray(a) &&
        Array.isArray(b) &&
        a.length === b.length &&
        a.every((entry, i) => Object.is(entry, b[i]))
      );
    }
    return Object.is(a, b);
  }

  /** The dialog's starting values: the effective settings, with every list copied. */
  export function snapshotValues(
    effective: Settings,
    metas: readonly SettingFieldMeta[] = SETTING_FIELDS,
  ): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const meta of metas) if (meta.dialog) values[meta.key] = detach(effective[meta.key]);
    return values;
  }

  /**
   * The pending values after the live settings moved from `before` to `after` (a configuration
   * import, a reset, a change from another window). A key the user did not touch (its pending
   * value still equals the value at the last sync) follows the live value, so it is not counted as
   * the user's edit and Save does not write the old value back over the change. A key the user
   * edited keeps the edit. Returns `current` itself when nothing moves.
   */
  export function rebaseValues(
    current: Record<string, unknown>,
    before: Settings,
    after: Settings,
    metas: readonly SettingFieldMeta[] = SETTING_FIELDS,
  ): Record<string, unknown> {
    let next: Record<string, unknown> | null = null;
    for (const meta of metas) {
      if (!meta.dialog) continue;
      if (!Object.prototype.hasOwnProperty.call(current, meta.key)) continue;
      if (sameValue(before[meta.key], after[meta.key])) continue;
      if (!sameValue(current[meta.key], before[meta.key])) continue;
      next ??= { ...current };
      next[meta.key] = detach(after[meta.key]);
    }
    return next ?? current;
  }

  /**
   * The pending code colours after the live settings moved from `before` to `after` (a
   * configuration import, a reset): untouched colours follow the live ones, edited colours stay.
   * Returns `colors` itself when nothing moves.
   */
  export function rebasePalette(colors: ProfileColors, before: Settings, after: Settings): ProfileColors {
    const was = before['appearance.roleColors'];
    const now = after['appearance.roleColors'];
    if (samePalette(was, now) || !samePalette(colors, was)) return colors;
    return structuredClone(now);
  }

  /** The keys of `metas` put back to their defaults, as a patch for the pending values. */
  export function defaultValues(metas: readonly SettingFieldMeta[]): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const meta of metas) values[meta.key] = detach(DEFAULTS[meta.key]);
    return values;
  }

  /**
   * Only what the user changed. Sending the untouched values as well would write the same
   * file - the store diffs against the defaults - but a minimal patch is what "save writes
   * only the changed keys" means, and it keeps a value this build does not understand from
   * travelling through a form.
   */
  export function changedValues(
    values: Record<string, unknown>,
    effective: Settings,
    metas: readonly SettingFieldMeta[] = SETTING_FIELDS,
  ): Partial<Settings> {
    const patch: Record<string, unknown> = {};
    for (const meta of metas) {
      if (!meta.dialog) continue;
      if (!Object.prototype.hasOwnProperty.call(values, meta.key)) continue;
      if (!sameValue(values[meta.key], effective[meta.key])) patch[meta.key] = values[meta.key];
    }
    return patch as Partial<Settings>;
  }

  // --- P4.37: the search box and the language row (delimited; the rest of the module is older) ---

  /**
   * What the search box looks through (§6.9 rule 43): the heading of every tab first, then every
   * row that is in the dialog, in table order, with its label and help text resolved through `deps`
   * (so the box follows the language in use). A row that is not in the dialog (`dialog: false`) is
   * not offered. `tabLabel` names a tab.
   */
  export function searchEntriesOf(
    pages: readonly SettingsPage[],
    deps: SpecDeps,
    tabLabel: (tab: DialogTab) => string,
  ): SearchEntry[] {
    const entries: SearchEntry[] = tabsOf(pages).map((tab) => ({
      id: tab,
      kind: 'page',
      tab,
      label: tabLabel(tab),
      help: '',
    }));
    for (const page of pages) {
      for (const meta of page.metas) {
        if (!meta.dialog) continue;
        const spec = specOf(meta, deps);
        entries.push({ id: meta.key, kind: 'setting', tab: page.category, label: spec.label, help: spec.help ?? '' });
      }
    }
    return entries;
  }

  /**
   * The choices of `ui.language`: the languages that ship, by their own names. A value that is not
   * one of them (`de-CH` when only `de` ships, or a language that was removed) is kept as one more
   * choice that says what is shown instead, so opening the dialog never changes the setting.
   */
  export function languageChoices(
    current: unknown,
    locales: readonly LocaleInfo[],
    translate: Translate,
  ): FieldChoice[] {
    const choices: FieldChoice[] = locales.map((locale) => ({ label: locale.name, value: locale.tag }));
    if (typeof current === 'string' && !locales.some((locale) => locale.tag === current)) {
      const shown = resolveLocale(current, locales.map((locale) => locale.tag));
      const name = locales.find((locale) => locale.tag === shown)?.name ?? shown;
      choices.push({ label: translate('settings.languageOther', { tag: current, shown: name }), value: current });
    }
    return choices;
  }

  /** What the status bar says after a save: that the language applies at the next start, or just "saved" (rule 40). */
  export function savedMessage(patch: Partial<Settings>, translate: Translate): string {
    return Object.prototype.hasOwnProperty.call(patch, 'ui.language')
      ? `${translate('settings.saved')}. ${translate('settings.languageNextStart')}`
      : translate('settings.saved');
  }

  /** The control a search hit leads to: the first thing to type into or press inside the row `id` on `page`. */
  export function controlOfRow(page: ParentNode, id: string): HTMLElement | null {
    const row = page.querySelector<HTMLElement>(`[data-field="${id}"]`);
    if (row === null) return null;
    return row.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea, button') ?? row;
  }
</script>

<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { get } from 'svelte/store';
  import Modal from '$lib/components/common/Modal.svelte';
  import MachinesPage, { type MachinesModel } from '$lib/components/dialogs/MachinesPage.svelte';
  import ProfilesPage, { type ProfilesModel } from '$lib/components/dialogs/ProfilesPage.svelte';
  import KeyboardPage from '$lib/components/dialogs/KeyboardPage.svelte';
  import PackagesPage from '$lib/components/dialogs/PackagesPage.svelte';
  import ConfigurationPage from '$lib/components/dialogs/ConfigurationPage.svelte';
  import FormRenderer from '$lib/components/forms/FormRenderer.svelte';
  import { dialogs } from '$lib/app/dialogs';
  import { files } from '$lib/app/fileOps';
  import { status } from '$lib/app/status';
  import { validateFields } from '$lib/core/forms/validate';
  import { searchSettings, type SearchHit } from '$lib/core/settings/search';
  import { availableLocales } from '$lib/i18n/locale';
  import { settingsOpenFile } from '$lib/platform/commands';
  import RoleColorRows from '$lib/components/dialogs/RoleColorRows.svelte';
  import { effectiveTheme } from '$lib/app/theme';
  import { profiles } from '$lib/stores/profiles';
  import { settings } from '$lib/stores/settings';
  import { hasKey, t } from '$lib/i18n';
  import type { Msg } from '$lib/app/types';

  interface Props {
    /** Supplied by ModalHost. Resolves `settings.open`; the value is unused. */
    close: (value?: unknown) => void;
    /**
     * The tab to open on (I6, M6). `settings.open` leaves it out and gets the first page;
     * `machines.manage` asks for `MACHINES_TAB`, so the command that means "manage my
     * machines" does not land on Appearance. An unknown value is ignored rather than
     * shown as an empty dialog.
     */
    initialTab?: DialogTab;
    /** Filled in by the dialog: the opener's `mayClose` asks through it (see `settingsModal`). */
    model?: SettingsModel;
  }

  let { close, initialTab, model }: Props = $props();

  const paths = settings.paths;

  const pages = pagesOf();
  const tabs = tabsOf(pages);
  const readOnly = settings.isReadOnly();
  const report = settings.report();

  /** Literal `t()` keys, so `i18n/keys.test.ts` can scan them. */
  function categoryLabel(category: DialogTab): string {
    switch (category) {
      case 'appearance':
        return t('settings.categories.appearance');
      case 'editor':
        return t('settings.categories.editor');
      case 'assistance':
        return t('settings.categories.assistance');
      case 'files':
        return t('settings.categories.files');
      case MACHINES_TAB:
        return t('settings.categories.machines');
      case PROFILES_TAB:
        return t('settings.categories.profiles');
      case KEYBOARD_TAB:
        return t('settings.categories.keyboard');
      case PACKAGES_TAB:
        return t('settings.categories.packages');
      case CONFIGURATION_TAB:
        return t('settings.categories.configuration');
      default:
        return t('settings.categories.scripts');
    }
  }

  /** Profile names are data and stay untranslated (AD-14). */
  const specDeps: SpecDeps = {
    translate: t,
    hasKey,
    choicesFor: (key) =>
      key === 'files.defaultProfile'
        ? profiles.list().map((info) => ({ label: info.name, value: info.id }))
        : key === 'ui.language'
          ? languageChoices(get(settings.values)['ui.language'], availableLocales(), t)
          : undefined,
  };

  /** Every page's `FieldSpec`s, built once: the schema and the profiles do not change here. */
  const specs = new Map<SettingCategory, FieldSpec[]>(
    pages.map((page) => [
      page.category,
      page.metas.filter((meta) => !isListKey(meta.key)).map((meta) => specOf(meta, specDeps)),
    ]),
  );

  /** The list-valued rows of a page, with their labels resolved the same way. */
  const listSpecs = new Map<SettingCategory, FieldSpec[]>(
    pages.map((page) => [
      page.category,
      page.metas.filter((meta) => isListKey(meta.key)).map((meta) => specOf(meta, specDeps)),
    ]),
  );

  const everySpec = pages.flatMap((page) => specs.get(page.category) ?? []);

  // Seeded once, on purpose: the dialog owns the pending values until Save or Cancel.
  let current = $state<Record<string, unknown>>(untrack(() => snapshotValues(get(settings.values))));
  // Read once, like `current` above: the caller says where the dialog opens, and from then
  // on the tab belongs to the user.
  let active = $state<DialogTab>(
    untrack(() =>
      initialTab !== undefined && tabs.includes(initialTab) ? initialTab : (pages[0]?.category ?? 'appearance'),
    ),
  );
  // The code colours (P4.41) are a palette, not a form field: the dialog keeps the pending
  // palette here, `RoleColorRows` edits it and shows it live in the open editor.
  let colors = $state<ProfileColors>(untrack(() => structuredClone(get(settings.values)['appearance.roleColors'])));
  let colorsValid = $state(true);
  const colorsChanged = (): boolean => !samePalette(colors, get(settings.values)['appearance.roleColors']);
  let tablist = $state<HTMLElement | undefined>(undefined);
  let busy = $state(false);

  /** What the Machines page says about its form: filled in by the page while it is shown. */
  const machinesModel: MachinesModel = { hasDraft: () => false };
  /** The same for the Profiles page: an inline profile form with changes that are not saved. */
  const profilesModel: ProfilesModel = { hasDraft: () => false, draftName: () => null };

  /** What closing now would lose. The machine form lives in the page, which is only mounted on its tab. */
  function leaveState(): LeaveState {
    return {
      values: !readOnly && (Object.keys(changedValues(current, get(settings.values))).length > 0 || colorsChanged()),
      draft: machinesModel.hasDraft(),
      profile: profilesModel.draftName(),
    };
  }

  /** Asks before the dialog closes with something typed in it; true when it may close. */
  function askToLeave(state: LeaveState = leaveState()): Promise<boolean> {
    return mayLeave(state, (o) => dialogs.confirm(o), t);
  }

  // The opener's `mayClose` (Esc outside the panel, a press outside it) asks through this.
  untrack(() => {
    if (model !== undefined) model.leave = () => askToLeave();
  });

  // The live settings can change while the dialog is open (Configuration > Import, a reset). A
  // value the user has not edited follows them; an edited one stays (`rebaseValues`).
  let synced = untrack(() => get(settings.values));
  $effect(() =>
    settings.values.subscribe((after) => {
      untrack(() => {
        current = rebaseValues(current, synced, after);
        colors = rebasePalette(colors, synced, after);
        synced = after;
      });
    }),
  );

  const errors = $derived(validateFields(everySpec, current));
  const blocked = $derived(Object.keys(errors).length > 0 || !colorsValid);

  /** Pages that hold a field the user has to fix before anything can be saved. */
  const invalid = $derived(
    new Set<string>(
      pages
        .filter((page) => page.metas.some((meta) => errors[meta.key] !== undefined))
        .map((page) => page.category),
    ),
  );

  const activeSpecs = $derived(specs.get(active as SettingCategory) ?? []);
  const activeLists = $derived(listSpecs.get(active as SettingCategory) ?? []);

  function set(id: string, value: unknown): void {
    current = { ...current, [id]: value };
  }

  function errorsFor(list: FieldSpec[]): Record<string, Msg> {
    const shown: Record<string, Msg> = {};
    for (const spec of list) {
      const problem = errors[spec.id];
      if (problem) shown[spec.id] = problem;
    }
    return shown;
  }

  /** English detail for anything thrown across the IPC boundary. */
  function detailOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  // --- the category tabs ----------------------------------------------------

  /** A question is already open for a tab change (a second click must not stack another). */
  let changingTab = false;

  function focusActiveTab(): void {
    tablist?.querySelector<HTMLElement>(`[data-category="${active}"]`)?.focus();
  }

  async function selectCategory(category: DialogTab): Promise<void> {
    if (changingTab) return;
    // The ordinary change happens at once; only a change away from an open machine or profile form asks.
    const profile = profilesModel.draftName();
    if (category === active || (active !== MACHINES_TAB && active !== PROFILES_TAB) || (!machinesModel.hasDraft() && profile === null)) {
      active = category;
      focusActiveTab();
      return;
    }
    changingTab = true;
    try {
      if (await mayChangeTab(active, category, machinesModel.hasDraft(), (o) => dialogs.confirm(o), t, profile)) active = category;
    } finally {
      changingTab = false;
    }
    // The tab that is shown takes the focus, also when the user said no and stays on it.
    focusActiveTab();
  }

  /** Arrow keys, Home and End move between the pages, as a tab list is expected to. */
  function onTabKey(e: KeyboardEvent): void {
    const index = tabs.indexOf(active);
    let next = index;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    e.stopPropagation();
    void selectCategory(tabs[next]);
  }

  // --- the search box (P4.37, §6.9 rule 43) ---------------------------------

  /** What the box searches: built once, in the language in use (it does not change while the app runs). */
  const searchEntries = searchEntriesOf(pages, specDeps, categoryLabel);
  let query = $state('');
  let searchInput = $state<HTMLInputElement | undefined>(undefined);
  let pageElement = $state<HTMLElement | undefined>(undefined);
  let hitList = $state<HTMLElement | undefined>(undefined);
  const hits = $derived(searchSettings(query, searchEntries));
  const searching = $derived(query.trim() !== '');

  function clearSearch(): void {
    query = '';
    searchInput?.focus();
  }

  /** Opens the page of a hit and puts the focus on its control (a page hit leaves it on the page's tab). */
  async function chooseHit(hit: SearchHit): Promise<void> {
    const tab = hit.entry.tab as DialogTab;
    await selectCategory(tab);
    // A question about an unfinished machine form can be answered "stay": then the hit is not followed.
    if (active !== tab) return;
    query = '';
    if (hit.entry.kind !== 'setting') return;
    await tick();
    const control = pageElement === undefined ? null : controlOfRow(pageElement, hit.entry.id);
    control?.scrollIntoView?.({ block: 'nearest' });
    control?.focus();
  }

  function hitButtons(): HTMLElement[] {
    return hitList === undefined ? [] : [...hitList.querySelectorAll<HTMLElement>('[data-testid="settings-search-hit"]')];
  }

  /**
   * The keys of the box and of the results. They are listened for by hand on the wrapper (the
   * `searchKeys` action below), not with `onkeydown`: Svelte delegates `onkeydown` to the root, but
   * the dialog frame (`Modal`) listens on its own panel and stops Enter and Escape there, so a
   * delegated handler would never see them. A listener on a descendant of the panel runs first.
   */
  function searchKeys(node: HTMLElement): { destroy: () => void } {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target;
      if (target === searchInput) onSearchKey(e);
      else if (target instanceof HTMLElement && target.dataset.testid === 'settings-search-hit') {
        onHitKey(e, hitButtons().indexOf(target));
      }
    };
    node.addEventListener('keydown', onKey);
    return { destroy: () => node.removeEventListener('keydown', onKey) };
  }

  /** Enter takes the best hit, and must not reach the dialog, where it would mean Save. Escape clears the box before it closes the dialog. */
  function onSearchKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && searching) {
      e.preventDefault();
      e.stopPropagation();
      clearSearch();
    } else if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      e.stopPropagation();
      if (hits.length > 0) void chooseHit(hits[0]);
    } else if (e.key === 'ArrowDown' && hits.length > 0) {
      e.preventDefault();
      hitButtons()[0]?.focus();
    }
  }

  function onHitKey(e: KeyboardEvent, index: number): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      clearSearch();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const buttons = hitButtons();
      const next = index + (e.key === 'ArrowDown' ? 1 : -1);
      if (next < 0) searchInput?.focus();
      else buttons[Math.min(next, buttons.length - 1)]?.focus();
    }
  }

  // --- the list control (scripts.folders) -----------------------------------

  function listOf(id: string): string[] {
    const value = current[id];
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
  }

  async function addToList(spec: FieldSpec): Promise<void> {
    const picked = await dialogs.exclusive(() =>
      dialogs.pickFolder({ title: t('settings.pickScriptFolder') }),
    );
    if (typeof picked !== 'string') return;
    const entries = listOf(spec.id);
    if (entries.includes(picked)) {
      status.show(t('settings.folderAlready'));
      return;
    }
    set(spec.id, [...entries, picked]);
  }

  function removeFromList(spec: FieldSpec, index: number): void {
    set(
      spec.id,
      listOf(spec.id).filter((_entry, i) => i !== index),
    );
  }

  // --- the footer -----------------------------------------------------------

  async function resetCategory(): Promise<void> {
    const page = pages.find((entry) => entry.category === active);
    if (!page || busy) return;
    const label = categoryLabel(page.category);
    const confirmed = await dialogs.confirm({
      title: t('settings.resetTitle', { category: label }),
      message: t('settings.resetMessage', { category: label }),
      ok: t('common.reset'),
      cancel: t('common.cancel'),
      kind: 'warning',
    });
    if (!confirmed) return;
    busy = true;
    try {
      await settings.reset(page.metas.map((meta) => meta.key));
    } catch (err) {
      status.show(t('settings.resetFailed'), { error: true, detail: detailOf(err) });
      return;
    } finally {
      busy = false;
    }
    // The written values are the defaults, so the form can follow without re-reading.
    current = { ...current, ...defaultValues(page.metas) };
    status.show(t('settings.resetDone', { category: label }));
  }

  /**
   * Hands the file to `files.open`, which needs no dialog: `settings_open_file` creates it
   * if it has to and grants that one path. The dialog closes first, because the file is a
   * document from then on and editing it there is the point.
   */
  async function openSettingsFile(): Promise<void> {
    if (busy) return;
    // The file replaces the dialog, so what was typed here is gone: ask first.
    if (!(await askToLeave())) return;
    busy = true;
    let path: string;
    try {
      path = await settingsOpenFile();
    } catch (err) {
      status.show(t('settings.openFileFailed'), { error: true, detail: detailOf(err) });
      return;
    } finally {
      busy = false;
    }
    close();
    await files.open([path]);
  }

  /** Cancel and Esc inside the panel: closes, after asking when something typed would be lost. */
  async function cancel(): Promise<void> {
    if (await askToLeave()) close();
  }

  async function save(): Promise<void> {
    if (blocked || readOnly || busy) return;
    // Save writes the settings and closes; a machine form that is still open would go with
    // it, so that is asked about first (the values are what the user is saving).
    if (!(await askToLeave({ values: false, draft: machinesModel.hasDraft(), profile: profilesModel.draftName() }))) return;
    const patch: Partial<Settings> = changedValues(current, get(settings.values));
    if (colorsChanged()) patch['appearance.roleColors'] = $state.snapshot(colors);
    if (Object.keys(patch).length === 0) {
      close();
      return;
    }
    busy = true;
    try {
      await settings.save(patch);
    } catch (err) {
      status.show(t('settings.saveFailed'), { error: true, detail: detailOf(err) });
      return;
    } finally {
      busy = false;
    }
    // A value the store could not use has already been reported by `settings.save()`
    // itself, as a status error naming what was dropped. Saying "Settings saved" on top of
    // that would replace the warning with a success message, and §7.5 is explicit that a
    // form never corrects a value behind the user's back (G8 M2). The fields that could
    // reach this are `required` in `SETTING_FIELDS`, so Save is normally blocked first;
    // this is the second line, for a patch no control produced.
    if (settings.lastWriteWarnings().length === 0) status.show(savedMessage(patch, t));
    close();
  }
</script>

<Modal
  id="settings"
  title={t('settings.title')}
  okLabel={t('common.save')}
  okDisabled={blocked || readOnly || busy}
  onOk={() => void save()}
  onCancel={() => void cancel()}
>
  {#snippet footer()}
    <button
      type="button"
      class="footer-action"
      data-testid="settings-reset"
      disabled={readOnly || busy || PAGE_TABS.includes(active)}
      onclick={() => void resetCategory()}
    >
      {t('settings.reset')}
    </button>
    <button
      type="button"
      class="footer-action"
      data-testid="settings-open-file"
      disabled={busy}
      onclick={() => void openSettingsFile()}
    >
      {t('settings.openFile')}
    </button>
  {/snippet}

  <div class="settings">
    {#if readOnly}
      <p class="notice" data-testid="settings-readonly">{t('settings.readOnly')}</p>
    {/if}
    {#if report.error !== undefined}
      <p class="notice" data-testid="settings-notice">
        {t('settings.problemError', { detail: report.error })}
      </p>
    {:else if report.warnings.length > 0}
      <p class="notice" data-testid="settings-notice">
        {t('settings.problemIgnored', {
          count: report.warnings.length,
          detail: report.warnings.join(' · '),
        })}
      </p>
    {/if}

    <div class="search" use:searchKeys>
      <div class="search-box">
        <input
          type="text"
          class="search-input"
          data-testid="settings-search"
          role="searchbox"
          placeholder={t('settings.search.placeholder')}
          aria-label={t('settings.search.label')}
          aria-controls="settings-search-hits"
          autocomplete="off"
          spellcheck="false"
          bind:this={searchInput}
          bind:value={query}
        />
        {#if searching}
          <button
            type="button"
            class="search-clear"
            data-testid="settings-search-clear"
            aria-label={t('settings.search.clear')}
            onclick={clearSearch}
          >
            ×
          </button>
        {/if}
      </div>
      <div id="settings-search-hits" bind:this={hitList}>
        {#if searching}
          {#if hits.length === 0}
            <p class="search-none" data-testid="settings-search-none">{t('settings.search.none')}</p>
          {:else}
            <p class="sr-only" aria-live="polite">{t('settings.search.found', { count: hits.length })}</p>
            <ul class="hits" aria-label={t('settings.search.hitsLabel')}>
              {#each hits as hit (hit.entry.kind + hit.entry.id)}
                <li>
                  <button
                    type="button"
                    class="hit"
                    data-testid="settings-search-hit"
                    data-id={hit.entry.id}
                    data-tab={hit.entry.tab}
                    onclick={() => void chooseHit(hit)}
                  >
                    <span class="hit-label">{hit.entry.label}</span>
                    <span class="hit-where">
                      {hit.entry.kind === 'page'
                        ? t('settings.search.page')
                        : t('settings.search.inPage', { page: categoryLabel(hit.entry.tab as DialogTab) })}
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        {/if}
      </div>
    </div>

    <div class="panes">
      <div
        class="tabs"
        role="tablist"
        aria-orientation="vertical"
        aria-label={t('settings.categoriesLabel')}
        bind:this={tablist}
      >
        {#each tabs as tab (tab)}
          <button
            type="button"
            role="tab"
            id="settings-tab-{tab}"
            class="tab"
            class:selected={tab === active}
            data-testid="settings-category"
            data-category={tab}
            data-invalid={invalid.has(tab) ? '1' : '0'}
            aria-selected={tab === active}
            aria-controls="settings-page-{tab}"
            tabindex={tab === active ? 0 : -1}
            onclick={() => void selectCategory(tab)}
            onkeydown={onTabKey}
          >
            {categoryLabel(tab)}
          </button>
        {/each}
      </div>

      <div
        class="page"
        role="tabpanel"
        id="settings-page-{active}"
        aria-labelledby="settings-tab-{active}"
        data-testid="settings-page"
        data-category={active}
        bind:this={pageElement}
      >
        {#if active === MACHINES_TAB}
          <MachinesPage model={machinesModel} />
        {:else if active === PROFILES_TAB}
          <ProfilesPage model={profilesModel} />
        {:else if active === KEYBOARD_TAB}
          <KeyboardPage />
        {:else if active === PACKAGES_TAB}
          <PackagesPage />
        {:else if active === CONFIGURATION_TAB}
          <ConfigurationPage />
        {:else}
          <FormRenderer
            fields={activeSpecs}
            values={current}
            errors={errorsFor(activeSpecs)}
            onChange={set}
          />
          {#if active === 'appearance'}
            <RoleColorRows
              {colors}
              firstMode={$effectiveTheme}
              preview
              onchange={(next) => (colors = next)}
              onvalid={(valid) => (colorsValid = valid)}
            />
          {/if}
        {/if}

        {#each activeLists as spec (spec.id)}
          {@const entries = listOf(spec.id)}
          <div class="form-field" data-testid="form-field" data-field={spec.id}>
            <span class="form-label">{spec.label}</span>
            {#if entries.length === 0}
              <p class="form-help">{t('settings.listEmpty')}</p>
            {:else}
              <ul class="list">
                {#each entries as entry, index (entry)}
                  <li class="list-row" data-testid="settings-list-item" data-index={index}>
                    <code class="path">{entry}</code>
                    <button
                      type="button"
                      class="list-remove"
                      data-testid="settings-list-remove"
                      aria-label={t('settings.listRemove', { path: entry })}
                      onclick={() => removeFromList(spec, index)}
                    >
                      ×
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
            <button
              type="button"
              class="list-add"
              data-testid="settings-list-add"
              onclick={() => void addToList(spec)}
            >
              {t('settings.listAdd')}
            </button>
            {#if spec.help}<p class="form-help">{spec.help}</p>{/if}
          </div>
        {/each}

        {#if active === 'scripts'}
          <div class="form-field">
            <span class="form-label">{t('settings.scriptsFolder')}</span>
            <code class="path" data-testid="settings-scripts-folder">
              {$paths?.userScriptsDir ?? t('settings.pathUnknown')}
            </code>
            <p class="form-help">{t('settings.scriptsFolderHelp')}</p>
          </div>
        {/if}
      </div>
    </div>
  </div>
</Modal>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    min-height: 0;
    font-size: 13px;
  }

  .notice {
    margin: 0 0 10px;
    padding: 6px 8px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-app);
    color: var(--danger-text);
    font-size: 12px;
  }

  .search {
    margin: 0 0 10px;
  }

  .search-box {
    position: relative;
  }

  .search-input {
    width: 100%;
    box-sizing: border-box;
    padding: 4px 24px 4px 8px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-app);
    color: var(--text-main);
    font: inherit;
    font-size: 13px;
  }

  .search-clear {
    position: absolute;
    top: 50%;
    right: 3px;
    width: 20px;
    padding: 0;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 14px;
    line-height: 18px;
    transform: translateY(-50%);
    cursor: pointer;
  }

  .search-clear:hover {
    background: var(--surface-hover);
  }

  .search-none {
    margin: 6px 0 0;
    color: var(--text-muted);
    font-size: 12px;
  }

  .hits {
    display: flex;
    flex-direction: column;
    max-height: 190px;
    margin: 4px 0 0;
    padding: 2px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-ribbon);
    list-style: none;
    overflow-y: auto;
  }

  .hit {
    display: flex;
    width: 100%;
    gap: 10px;
    justify-content: space-between;
    padding: 3px 8px;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: var(--text-main);
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }

  .hit:hover,
  .hit:focus-visible {
    background: var(--surface-hover);
  }

  .hit-where {
    flex: 0 0 auto;
    color: var(--text-muted);
    font-size: 12px;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    border: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .panes {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    min-height: 0;
  }

  .tabs {
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    gap: 2px;
    width: 130px;
  }

  .tab {
    padding: 5px 8px;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    color: var(--text-main);
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }

  .tab:hover {
    background: var(--surface-hover);
  }

  .tab.selected {
    /* The selected category is marked by a tint and an orange bar, not a solid orange
       block: the text keeps its normal colour on a surface. */
    background: var(--accent-soft);
    box-shadow: inset 2px 0 0 var(--accent);
    color: var(--text-active);
  }

  .tab[data-invalid='1']::after {
    content: ' !';
    color: var(--danger-text);
    font-weight: 700;
  }

  .tab.selected[data-invalid='1']::after {
    color: var(--text-active);
  }

  .page {
    flex: 1 1 auto;
    min-width: 0;
    max-height: 48vh;
    padding-right: 4px;
    overflow-y: auto;
  }

  /* The list control mirrors FormRenderer's field layout, whose styles are scoped to it. */
  .form-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0 0 14px;
  }

  .form-label {
    color: var(--text-main);
    font-size: 13px;
  }

  .form-help {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .list-row {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 2px 4px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
  }

  .path {
    flex: 1 1 auto;
    min-width: 0;
    color: var(--text-main);
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    user-select: text;
    cursor: text;
  }

  .list-remove {
    flex: 0 0 auto;
    width: 20px;
    padding: 0;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 14px;
    line-height: 18px;
    cursor: pointer;
  }

  .list-remove:hover {
    background: var(--surface-hover);
    color: var(--danger-text);
  }

  .list-add,
  .footer-action {
    align-self: flex-start;
    padding: 4px 10px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-ribbon);
    color: var(--text-main);
    font: inherit;
    font-size: 13px;
    white-space: nowrap;
    cursor: pointer;
  }

  .list-add:hover,
  .footer-action:hover:not(:disabled) {
    background: var(--surface-hover);
  }

  .footer-action:disabled {
    color: var(--text-disabled);
    cursor: default;
  }
</style>
