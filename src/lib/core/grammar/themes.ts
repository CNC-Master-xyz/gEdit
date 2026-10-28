// The two generated Monaco themes (plan §5 WP3.4, §7.4). Owner: WP3.4.
//
// `gedit-dark` and `gedit-light` are built from `ROLE_COLORS`, so a role has one colour
// across every profile and a new dialect needs no theme work at all. Both inherit from
// Monaco's own `vs-dark` / `vs`, which keeps the hundreds of workbench colours (selection,
// find match, ruler, minimap) that a hand-written theme would have to restate; only the
// editor surface and the token rules are ours.
//
// Monarch appends the language id to every token, so `feed` is emitted as
// `feed.fanuc-gcode`, and Monaco matches a theme rule by dot-separated prefix: a rule on
// `feed` covers every profile, and a rule on `feed.fanuc-gcode` overrides that one profile.
// That is how a profile may carry its own palette (`colors`) without the generator knowing
// anything about it. Three layers (P4h, plan §6.10 rule 6): the built-in role colours, over
// them the user's (`appearance.roleColors`, the role colour editor), over both a profile's own.
// Every colour of the second and third layer has to pass the contrast rule (`contrast.ts`).

import type { Profile, ProfileColors } from '$lib/core/profiles/types';
import { EDITOR_CHROME } from './chrome';
import { roleColorProblem } from './contrast';
import { EDITOR_COLORS, ROLES, ROLE_COLORS, ROLE_FONT_STYLE, THEME_BASE, type Role } from './roles';

/** One entry of `IStandaloneThemeData.rules`. */
export interface ThemeRule {
  token: string;
  foreground?: string;
  fontStyle?: string;
}

/** `IStandaloneThemeData`, typed here so `core/` stays free of Monaco (AD-1). */
export interface GeneratedTheme {
  base: 'vs' | 'vs-dark';
  inherit: true;
  rules: ThemeRule[];
  colors: Record<string, string>;
}

/**
 * The role colours of one theme in a palette (`profile.colors`, `appearance.roleColors`),
 * a role to a `#rrggbb` value. Only a colour that passes `roleColorProblem` is taken: not a
 * colour, a role we do not know, or a contrast below the limit is ignored rather than fatal —
 * the profile validator and the settings merge refuse those first, and a theme that has to be
 * built anyway must never hold an unreadable token (§6.10 rule 6).
 */
export function paletteOverrides(palette: unknown, mode: 'light' | 'dark'): Partial<Record<Role, string>> {
  if (typeof palette !== 'object' || palette === null) return {};
  const forMode = (palette as Record<string, unknown>)[mode];
  if (typeof forMode !== 'object' || forMode === null) return {};
  const out: Partial<Record<Role, string>> = {};
  for (const role of ROLES) {
    const value = (forMode as Record<string, unknown>)[role];
    if (roleColorProblem(value, mode) === null) out[role] = value as string;
  }
  return out;
}

/** The per-profile palette, if the profile carries one (`colors.dark` / `colors.light`). */
export function profileOverrides(p: Profile, mode: 'light' | 'dark'): Partial<Record<Role, string>> {
  return paletteOverrides((p as { colors?: unknown }).colors, mode);
}

/** Which layer a role colour comes from: the built-in palette, the user's, or a profile's own. */
export type ColorLayer = 'builtin' | 'user' | 'profile';

/**
 * The colour a role gets in a theme and the layer it comes from (§6.10 rule 6): the profile's
 * own palette over the user's over the built-in one. `profile` is left out for the editor of the
 * settings, which edits the user layer.
 */
export function layeredRoleColor(
  role: Role,
  mode: 'light' | 'dark',
  user?: unknown,
  profile?: unknown,
): { value: string; layer: ColorLayer } {
  const own = paletteOverrides(profile, mode)[role];
  if (own !== undefined) return { value: own, layer: 'profile' };
  const mine = paletteOverrides(user, mode)[role];
  if (mine !== undefined) return { value: mine, layer: 'user' };
  return { value: ROLE_COLORS[mode][role], layer: 'builtin' };
}

/** One theme: the role rules (the user's colours in their place), then whatever a profile overrides for itself. */
function themeFor(mode: 'light' | 'dark', profiles: readonly Profile[], user: unknown): GeneratedTheme {
  const rules: ThemeRule[] = [];
  const mine = paletteOverrides(user, mode);
  for (const role of ROLES) {
    rules.push({ token: role, foreground: mine[role] ?? ROLE_COLORS[mode][role], ...styleOf(role) });
  }
  for (const profile of profiles) {
    if (typeof profile?.id !== 'string' || profile.id === '') continue;
    const overrides = profileOverrides(profile, mode);
    for (const role of ROLES) {
      const foreground = overrides[role];
      if (foreground !== undefined) rules.push({ token: `${role}.${profile.id}`, foreground, ...styleOf(role) });
    }
  }
  return {
    base: THEME_BASE[mode],
    inherit: true,
    rules,
    colors: {
      ...EDITOR_CHROME[mode],
      'editor.background': EDITOR_COLORS[mode].background,
      'editor.foreground': EDITOR_COLORS[mode].foreground,
    },
  };
}

function styleOf(role: Role): { fontStyle?: string } {
  const fontStyle = ROLE_FONT_STYLE[role];
  return fontStyle === undefined ? {} : { fontStyle };
}

/**
 * Builds `gedit-dark` and `gedit-light` from the role palette, the user's role colours
 * (`appearance.roleColors`, put in the place of the built-in ones) and the per-profile
 * overrides (§6.10 rule 6). The return type is deliberately loose: it is
 * `IStandaloneThemeData`, and `monaco/languages.ts` is where it meets Monaco.
 */
export function generateThemes(profiles: Profile[], user?: ProfileColors): { dark: unknown; light: unknown } {
  const list = Array.isArray(profiles) ? profiles : [];
  return { dark: themeFor('dark', list, user), light: themeFor('light', list, user) };
}
