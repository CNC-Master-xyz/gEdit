// The three layers of the role colours (P4h, P4.41, plan §6.10 rule 6): the built-in palette, the
// user's role colours (`appearance.roleColors`) over it, a profile's own `colors` over both.

import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { validateProfile } from '$lib/core/profiles/validate';
import type { Profile, ProfileColors } from '$lib/core/profiles/types';
import { roleColorProblem } from './contrast';
import { EDITOR_COLORS, ROLES, ROLE_COLORS, ROLE_FONT_STYLE, type Role } from './roles';
import { generateThemes, layeredRoleColor, paletteOverrides, profileOverrides, type GeneratedTheme } from './themes';

const fanuc = (() => {
  const raw = BUILTIN_PROFILE_JSON.find((entry) => (entry as { id?: string }).id === 'fanuc-gcode');
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  return checked.profile;
})();
const withColors = (colors: unknown): Profile => ({ ...fanuc, colors }) as Profile;

type Themes = { dark: GeneratedTheme; light: GeneratedTheme };
const themes = (profiles: Profile[], user?: ProfileColors): Themes => generateThemes(profiles, user) as Themes;
const rule = (theme: GeneratedTheme, token: string) => theme.rules.find((entry) => entry.token === token);

// Two colours that read on their theme: the test would be worthless on a colour that is refused.
const DARK_OWN = '#ffcc00';
const LIGHT_OWN = '#7a3d00';

describe('the colours chosen for the tests', () => {
  it('pass the contrast rule', () => {
    expect(roleColorProblem(DARK_OWN, 'dark')).toBeNull();
    expect(roleColorProblem(LIGHT_OWN, 'light')).toBeNull();
    // and the pale ones below do not
    expect(roleColorProblem('#202020', 'dark')).not.toBeNull();
    expect(roleColorProblem('#f0f0a0', 'light')).not.toBeNull();
  });
});

describe('generateThemes: the user layer', () => {
  it('is the built-in palette when the user has no colours', () => {
    for (const given of [undefined, {}, { dark: {} }]) {
      const out = themes([fanuc], given as ProfileColors | undefined);
      for (const mode of ['dark', 'light'] as const) {
        for (const role of ROLES) expect(rule(out[mode], role)?.foreground).toBe(ROLE_COLORS[mode][role]);
        expect(out[mode].rules).toHaveLength(ROLES.length);
      }
    }
  });

  it("puts the user's colour in the place of the built-in one, in its own theme only", () => {
    const out = themes([fanuc], { dark: { feed: DARK_OWN }, light: { gcode: LIGHT_OWN } });
    expect(rule(out.dark, 'feed')?.foreground).toBe(DARK_OWN);
    expect(rule(out.light, 'feed')?.foreground).toBe(ROLE_COLORS.light.feed);
    expect(rule(out.light, 'gcode')?.foreground).toBe(LIGHT_OWN);
    expect(rule(out.dark, 'gcode')?.foreground).toBe(ROLE_COLORS.dark.gcode);
    // still one rule per role, so nothing else moved
    expect(out.dark.rules).toHaveLength(ROLES.length);
    expect(out.light.rules).toHaveLength(ROLES.length);
  });

  it('keeps the font style of the role', () => {
    const styled = (Object.keys(ROLE_FONT_STYLE) as Role[])[0];
    const out = themes([fanuc], { dark: { [styled]: DARK_OWN } });
    expect(rule(out.dark, styled)?.fontStyle).toBe(ROLE_FONT_STYLE[styled]);
  });

  it('does not use a colour that is too faint, not a colour or for a role that does not exist', () => {
    const out = themes([fanuc], {
      dark: { feed: '#202020', gcode: 'red', nonsense: DARK_OWN },
      light: { feed: '#f0f0a0' },
    } as unknown as ProfileColors);
    expect(rule(out.dark, 'feed')?.foreground).toBe(ROLE_COLORS.dark.feed);
    expect(rule(out.dark, 'gcode')?.foreground).toBe(ROLE_COLORS.dark.gcode);
    expect(rule(out.light, 'feed')?.foreground).toBe(ROLE_COLORS.light.feed);
    expect(out.dark.rules).toHaveLength(ROLES.length);
  });

  it('keeps the editor surface', () => {
    const out = themes([fanuc], { dark: { feed: DARK_OWN } });
    expect(out.dark.colors['editor.background']).toBe(EDITOR_COLORS.dark.background);
  });
});

describe('generateThemes: the profile layer on top of the user layer', () => {
  it("writes the profile's colour as a rule `<role>.<profile id>` after every base rule", () => {
    const painted = withColors({ dark: { feed: DARK_OWN } });
    const out = themes([painted], { dark: { feed: '#00ccff' } });
    expect(rule(out.dark, 'feed')?.foreground).toBe('#00ccff');
    expect(rule(out.dark, `feed.${fanuc.id}`)?.foreground).toBe(DARK_OWN);
    const own = out.dark.rules.findIndex((entry) => entry.token === `feed.${fanuc.id}`);
    expect(own).toBeGreaterThanOrEqual(ROLES.length);
  });

  it('puts nothing in the rules of another profile', () => {
    const other = { ...fanuc, id: 'other-profile' } as Profile;
    const out = themes([withColors({ dark: { feed: DARK_OWN } }), other]);
    expect(rule(out.dark, `feed.${fanuc.id}`)).toBeDefined();
    expect(rule(out.dark, 'feed.other-profile')).toBeUndefined();
  });

  it('ignores a profile colour that is too faint, as the profile validator refuses the file first', () => {
    const faint = withColors({ dark: { feed: '#202020' }, light: { feed: '#f0f0a0' } });
    expect(profileOverrides(faint, 'dark')).toEqual({});
    expect(profileOverrides(faint, 'light')).toEqual({});
    expect(themes([faint]).dark.rules).toHaveLength(ROLES.length);
  });
});

describe('paletteOverrides', () => {
  it('takes the readable colours of one theme and nothing else', () => {
    expect(paletteOverrides({ dark: { feed: DARK_OWN, gcode: '#202020' }, light: { feed: LIGHT_OWN } }, 'dark')).toEqual({ feed: DARK_OWN });
    expect(paletteOverrides(undefined, 'dark')).toEqual({});
    expect(paletteOverrides(7, 'dark')).toEqual({});
    expect(paletteOverrides({ dark: 'x' }, 'dark')).toEqual({});
  });
});

describe('layeredRoleColor', () => {
  const user = { dark: { feed: '#00ccff' } };
  const profile = { dark: { feed: DARK_OWN, gcode: DARK_OWN } };

  it('answers the colour and the layer it comes from', () => {
    expect(layeredRoleColor('feed', 'dark')).toEqual({ value: ROLE_COLORS.dark.feed, layer: 'builtin' });
    expect(layeredRoleColor('feed', 'dark', user)).toEqual({ value: '#00ccff', layer: 'user' });
    expect(layeredRoleColor('feed', 'dark', user, profile)).toEqual({ value: DARK_OWN, layer: 'profile' });
    expect(layeredRoleColor('tool', 'dark', user, profile)).toEqual({ value: ROLE_COLORS.dark.tool, layer: 'builtin' });
    expect(layeredRoleColor('feed', 'light', user, profile).layer).toBe('builtin');
  });
});
