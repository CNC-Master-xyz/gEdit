<!--
  The role colour editor (P4h, P4.41, plan §6.10 rule 6): one row per kind of word, both themes
  side by side with the theme in force first, each cell a colour picker, the colour as text, the
  contrast ratio against the editor background and "Reset" (back to the colour of the layer
  below). Settings, Appearance uses it for the user's colours (`appearance.roleColors`); the
  profile form (P4.40) uses it for a profile's own (`colors`, `layer="profile"`, `below` the
  user's colours).

  The component edits one `ProfileColors` and nothing else: the parent owns the pending value,
  passes it as `colors` and takes the next one from `onchange`. A colour that cannot be read, or
  that is too faint to read on its background (the contrast rule of `core/grammar/contrast.ts`,
  the same one the profile and settings validators use), is never passed on: the cell keeps what
  was typed, says why in plain words, and `onvalid(false)` tells the parent to block Save.

  Live preview is the open editor itself: with `preview` set, every change defines the themes
  again (`previewRoleColors`) and the editor repaints; leaving the page puts the saved colours
  back. The component never sets a `theme` option on an editor (F118).
-->
<script module lang="ts">
  import { HEX_COLOR, MIN_ROLE_CONTRAST, contrastRatio, roleColorProblem } from '$lib/core/grammar/contrast';
  import { EDITOR_COLORS, ROLES, type Role } from '$lib/core/grammar/roles';
  import { layeredRoleColor, type ColorLayer } from '$lib/core/grammar/themes';
  import type { ProfileColors } from '$lib/core/profiles/types';

  export type ColorMode = 'dark' | 'light';

  /** What one cell (one role in one theme) shows. */
  export interface ColorCell {
    role: Role;
    mode: ColorMode;
    /** The colour in force, `#rrggbb`. */
    value: string;
    /** Where it comes from; `builtin` is the standard palette. */
    layer: ColorLayer;
    /** True when the edited layer itself holds a colour here, so "Reset" has something to do. */
    own: boolean;
    /** The contrast against the editor background, rounded down to one decimal. */
    ratio: string;
  }

  /** The two themes, the one in force first. */
  export function modesOrder(first: ColorMode): [ColorMode, ColorMode] {
    return first === 'light' ? ['light', 'dark'] : ['dark', 'light'];
  }

  /** `3.1` for 3.14 and `4.4` for 4.49: a ratio below the limit never reads as the limit. */
  export function ratioText(value: string, mode: ColorMode): string {
    return (Math.floor(contrastRatio(value, EDITOR_COLORS[mode].background) * 10) / 10).toFixed(1);
  }

  /** The cell of `role` in `mode` for the edited palette `colors`; `below` is the user's palette when a profile's is edited. */
  export function cellOf(
    role: Role,
    mode: ColorMode,
    colors: ProfileColors,
    below: ProfileColors = {},
    layer: 'user' | 'profile' = 'user',
  ): ColorCell {
    const found = layer === 'profile' ? layeredRoleColor(role, mode, below, colors) : layeredRoleColor(role, mode, colors);
    return { role, mode, value: found.value, layer: found.layer, own: found.layer === layer, ratio: ratioText(found.value, mode) };
  }

  /** `#RRGGBB`, `rrggbb` and ` #rrggbb ` all become `#rrggbb`; anything else is returned as it was typed. */
  export function normalizeColor(text: string): string {
    const trimmed = text.trim();
    const withHash = /^[0-9a-fA-F]{6}$/.test(trimmed) ? `#${trimmed}` : trimmed;
    return HEX_COLOR.test(withHash) ? withHash.toLowerCase() : text;
  }

  /** The result of typing or picking a colour. */
  export type ColorEdit =
    | { ok: true; colors: ProfileColors }
    | { ok: false; problem: 'notAColor' | 'tooFaint'; ratio?: string };

  /**
   * `colors` with `role` in `mode` set to `text`, or the reason it cannot be: not `#rrggbb`, or
   * below the contrast limit. The palette itself is never changed.
   */
  export function editColor(colors: ProfileColors, role: Role, mode: ColorMode, text: string): ColorEdit {
    const value = normalizeColor(text);
    if (!HEX_COLOR.test(value)) return { ok: false, problem: 'notAColor' };
    if (roleColorProblem(value, mode) !== null) return { ok: false, problem: 'tooFaint', ratio: ratioText(value, mode) };
    return { ok: true, colors: { ...colors, [mode]: { ...colors[mode], [role]: value } } };
  }

  /** `colors` without the colour of `role` in `mode`; a theme left empty is left out, and so is an empty palette member. */
  export function resetColor(colors: ProfileColors, role: Role, mode: ColorMode): ProfileColors {
    const next: ProfileColors = { ...colors };
    const { [role]: _removed, ...rest } = colors[mode] ?? {};
    if (Object.keys(rest).length > 0) next[mode] = rest;
    else delete next[mode];
    return next;
  }

  export { MIN_ROLE_CONTRAST };
</script>

<script lang="ts">
  import { previewRoleColors } from '$lib/monaco/languages';
  import { t } from '$lib/i18n';

  interface Props {
    /** The palette being edited (the pending value of the parent). */
    colors: ProfileColors;
    /** The next palette; only called with colours that can be saved. */
    onchange: (next: ProfileColors) => void;
    /** `user` edits the user's colours, `profile` a profile's own. */
    layer?: 'user' | 'profile';
    /** For `layer="profile"`: the user's colours, the layer below. */
    below?: ProfileColors;
    /** The theme in force, shown first. */
    firstMode?: ColorMode;
    /** False while a typed colour cannot be saved, true again once every cell is fine. */
    onvalid?: (valid: boolean) => void;
    /** Show every change in the open editor, and put the saved colours back when the page is left. */
    preview?: boolean;
    /** Shows the heading and the help text above the rows. */
    heading?: boolean;
  }

  let { colors, onchange, layer = 'user', below = {}, firstMode = 'dark', onvalid, preview = false, heading = true }: Props = $props();

  /** What was typed in a cell that cannot be saved, by `mode.role`. */
  let drafts = $state<Record<string, string>>({});

  const order = $derived(modesOrder(firstMode));
  const valid = $derived(Object.keys(drafts).length === 0);

  $effect(() => {
    onvalid?.(valid);
  });

  // Only the user's colours can be shown in the editor as they are; a profile's own colours
  // belong to that profile's documents and have their own preview in the profile form.
  const previewing = $derived(preview && layer === 'user');

  $effect(() => {
    // Reads `colors` so the preview follows every accepted change.
    if (previewing) previewRoleColors(colors);
  });

  $effect(() => {
    if (!previewing) return;
    return () => previewRoleColors(null);
  });

  const keyOf = (role: Role, mode: ColorMode): string => `${mode}.${role}`;

  /** The keys are built from the role and the theme; `components/dialogs/RoleColorRows.test.ts` checks that every one has a message. */
  function roleLabel(role: Role): string {
    return t(`appearance.codeColors.roles.${role}`);
  }
  function themeLabel(mode: ColorMode): string {
    return mode === 'dark' ? t('appearance.codeColors.dark') : t('appearance.codeColors.light');
  }

  function layerLabel(cell: ColorLayer): string {
    switch (cell) {
      case 'profile':
        return t('appearance.codeColors.layerProfile');
      case 'user':
        return t('appearance.codeColors.layerUser');
      default:
        return t('appearance.codeColors.layerBuiltin');
    }
  }

  function enter(role: Role, mode: ColorMode, text: string): void {
    const result = editColor(colors, role, mode, text);
    const key = keyOf(role, mode);
    if (result.ok) {
      const { [key]: _gone, ...rest } = drafts;
      drafts = rest;
      onchange(result.colors);
    } else {
      drafts = { ...drafts, [key]: text };
    }
  }

  function reset(role: Role, mode: ColorMode): void {
    const { [keyOf(role, mode)]: _gone, ...rest } = drafts;
    drafts = rest;
    onchange(resetColor(colors, role, mode));
  }

  /** The words under a cell whose draft cannot be saved. */
  function problemOf(role: Role, mode: ColorMode): string | null {
    const text = drafts[keyOf(role, mode)];
    if (text === undefined) return null;
    const edit = editColor(colors, role, mode, text);
    if (edit.ok) return null;
    if (edit.problem === 'notAColor') return t('appearance.codeColors.notAColor');
    return t('appearance.codeColors.tooFaint', { theme: mode, ratio: edit.ratio ?? '', min: MIN_ROLE_CONTRAST.toFixed(1) });
  }
</script>

<div class="role-colors" data-testid="role-colors" data-layer={layer} data-valid={valid ? 'yes' : 'no'}>
  {#if heading}
    <h3 class="title">{t('appearance.codeColors.title')}</h3>
    <p class="help">{layer === 'profile' ? t('appearance.codeColors.profileHelp') : t('appearance.codeColors.help')}</p>
  {/if}
  {#if !valid}
    <p class="blocked" role="alert" data-testid="role-colors-blocked">{t('appearance.codeColors.cannotSave')}</p>
  {/if}
  <div class="grid" role="table">
    <div class="head" role="row">
      <span role="columnheader">{t('appearance.codeColors.roleHeading')}</span>
      {#each order as mode, i (mode)}
        <span role="columnheader">{themeLabel(mode)}{#if i === 0}<span class="note"> ({t('appearance.codeColors.inForce')})</span>{/if}</span>
      {/each}
    </div>
    {#each ROLES as role (role)}
      <div class="line" role="row">
        <span class="name" role="rowheader">{roleLabel(role)}</span>
        {#each order as mode (mode)}
          {@const cell = cellOf(role, mode, colors, below, layer)}
          {@const draft = drafts[keyOf(role, mode)]}
          {@const shown = draft ?? cell.value}
          {@const problem = problemOf(role, mode)}
          <div
            class="cell"
            role="cell"
            data-testid="role-color-row"
            data-role={role}
            data-mode={mode}
            data-value={shown}
            data-ratio={HEX_COLOR.test(shown) ? ratioText(shown, mode) : ''}
            data-layer={cell.layer}
          >
            <div class="controls">
              <input
                class="picker"
                type="color"
                value={HEX_COLOR.test(shown) ? shown : cell.value}
                aria-label={t('appearance.codeColors.colorLabel', { role: roleLabel(role), theme: themeLabel(mode) })}
                oninput={(event) => enter(role, mode, event.currentTarget.value)}
              />
              <input
                class="hex"
                type="text"
                spellcheck="false"
                autocomplete="off"
                maxlength="7"
                value={shown}
                aria-label={t('appearance.codeColors.textLabel', { role: roleLabel(role), theme: themeLabel(mode) })}
                aria-invalid={problem === null ? undefined : 'true'}
                oninput={(event) => enter(role, mode, event.currentTarget.value)}
              />
              <span class="ratio" class:bad={problem !== null}>{t('appearance.codeColors.ratio', { ratio: HEX_COLOR.test(shown) ? ratioText(shown, mode) : '–' })}</span>
              <span class="layer">{layerLabel(cell.layer)}</span>
              <button
                type="button"
                class="reset"
                data-testid="role-color-reset"
                data-role={role}
                data-mode={mode}
                disabled={!cell.own && draft === undefined}
                title={t('appearance.codeColors.resetHelp')}
                aria-label={t('appearance.codeColors.resetLabel', { role: roleLabel(role), theme: mode })}
                onclick={() => reset(role, mode)}
              >{t('appearance.codeColors.reset')}</button>
            </div>
            {#if problem !== null}
              <p class="problem" role="alert">{problem}</p>
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  </div>
</div>

<style>
  .role-colors {
    display: flex;
    flex-direction: column;
    gap: 8px;
    color: var(--text-main);
    font-size: 13px;
  }
  .title {
    margin: 0;
    font-size: 14px;
  }
  .help {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }
  .blocked,
  .problem {
    margin: 0;
    color: var(--danger-text);
    font-size: 12px;
  }
  .grid {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .head,
  .line {
    display: grid;
    grid-template-columns: minmax(150px, 1fr) minmax(250px, 2fr) minmax(250px, 2fr);
    gap: 8px;
    align-items: start;
  }
  .head {
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border-color);
    color: var(--text-muted);
    font-size: 12px;
  }
  .note {
    font-weight: normal;
  }
  .line {
    padding: 3px 0;
  }
  .name {
    padding-top: 5px;
  }
  .cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .controls {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
  }
  .picker {
    width: 32px;
    height: 26px;
    padding: 0;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-app);
    cursor: pointer;
  }
  .hex {
    box-sizing: border-box;
    width: 80px;
    padding: 4px 6px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-app);
    color: var(--text-main);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .hex:focus {
    border-color: var(--accent-text);
    outline: none;
  }
  .hex[aria-invalid='true'] {
    border-color: var(--danger);
  }
  .ratio {
    min-width: 54px;
    color: var(--text-muted);
    font-size: 12px;
  }
  .ratio.bad {
    color: var(--danger-text);
  }
  .layer {
    color: var(--text-muted);
    font-size: 11px;
  }
  .reset {
    padding: 3px 8px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-ribbon);
    color: var(--text-main);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .reset:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
