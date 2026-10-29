// The role colour editor (P4h, P4.41, plan §6.10 rule 6). The edits are pure functions of the
// component's module script, tested directly; the markup is rendered with `svelte/server` (no
// DOM), like the other dialogs. Typing and clicking are the runtime scenarios of H4h.

import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { hasKey } from '$lib/i18n';
import { ROLES, ROLE_COLORS } from '$lib/core/grammar/roles';
import { roleColorProblem } from '$lib/core/grammar/contrast';
import type { ProfileColors } from '$lib/core/profiles/types';
import RoleColorRows, { cellOf, editColor, modesOrder, normalizeColor, ratioText, resetColor } from './RoleColorRows.svelte';

const DARK_OWN = '#ffcc00';
const LIGHT_OWN = '#7a3d00';

function markup(over: Record<string, unknown> = {}): string {
  return render(RoleColorRows, { props: { colors: {}, onchange: () => {}, ...over } }).body;
}
const cells = (html: string): string[] => html.match(/<div[^>]*data-testid="role-color-row"[^>]*>/g) ?? [];
const attr = (tag: string, name: string): string | undefined => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1];

describe('the words', () => {
  it('has a message for every role and every text of the editor', () => {
    for (const role of ROLES) expect(hasKey(`appearance.codeColors.roles.${role}`), role).toBe(true);
    for (const key of ['title', 'help', 'profileHelp', 'roleHeading', 'dark', 'light', 'inForce', 'reset', 'resetLabel', 'colorLabel', 'textLabel', 'ratio', 'notAColor', 'tooFaint', 'cannotSave', 'layerBuiltin', 'layerUser', 'layerProfile']) {
      expect(hasKey(`appearance.codeColors.${key}`), key).toBe(true);
    }
  });
});

describe('modesOrder', () => {
  it('puts the theme in force first', () => {
    expect(modesOrder('dark')).toEqual(['dark', 'light']);
    expect(modesOrder('light')).toEqual(['light', 'dark']);
  });
});

describe('ratioText', () => {
  it('is rounded down to one decimal, so a colour below the limit never reads as 4.5', () => {
    expect(ratioText('#ffffff', 'dark')).toMatch(/^\d+\.\d$/);
    // find a colour just under the limit and check it never shows the limit
    for (let g = 0x60; g < 0x90; g++) {
      const hex = `#${g.toString(16).padStart(2, '0').repeat(3)}`;
      if (roleColorProblem(hex, 'dark') !== null) expect(Number(ratioText(hex, 'dark'))).toBeLessThan(4.5);
      else expect(Number(ratioText(hex, 'dark'))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('cellOf', () => {
  it('shows the standard colour with its ratio when nobody changed it', () => {
    const cell = cellOf('feed', 'dark', {});
    expect(cell).toMatchObject({ role: 'feed', mode: 'dark', value: ROLE_COLORS.dark.feed, layer: 'builtin', own: false });
    expect(Number(cell.ratio)).toBeGreaterThanOrEqual(4.5);
  });

  it("shows the user's colour as the user's", () => {
    expect(cellOf('feed', 'dark', { dark: { feed: DARK_OWN } })).toMatchObject({ value: DARK_OWN, layer: 'user', own: true });
    expect(cellOf('feed', 'light', { dark: { feed: DARK_OWN } })).toMatchObject({ layer: 'builtin', own: false });
  });

  it('for a profile: its own colour first, then the colour of the user, then the standard one', () => {
    const user: ProfileColors = { dark: { feed: '#00ccff', gcode: '#00ccff' } };
    const own: ProfileColors = { dark: { feed: DARK_OWN } };
    expect(cellOf('feed', 'dark', own, user, 'profile')).toMatchObject({ value: DARK_OWN, layer: 'profile', own: true });
    expect(cellOf('gcode', 'dark', own, user, 'profile')).toMatchObject({ value: '#00ccff', layer: 'user', own: false });
    expect(cellOf('tool', 'dark', own, user, 'profile')).toMatchObject({ value: ROLE_COLORS.dark.tool, layer: 'builtin', own: false });
  });
});

describe('normalizeColor', () => {
  it('accepts a missing # and capitals, and hands back anything else as typed', () => {
    expect(normalizeColor('FFCC00')).toBe('#ffcc00');
    expect(normalizeColor(' #FFCC00 ')).toBe('#ffcc00');
    expect(normalizeColor('#fc0')).toBe('#fc0');
    expect(normalizeColor('red')).toBe('red');
  });
});

describe('editColor', () => {
  it('sets one colour of one theme and leaves the rest', () => {
    const first = editColor({}, 'feed', 'dark', DARK_OWN);
    expect(first).toEqual({ ok: true, colors: { dark: { feed: DARK_OWN } } });
    const second = editColor((first as { colors: ProfileColors }).colors, 'gcode', 'light', LIGHT_OWN.toUpperCase());
    expect(second).toEqual({ ok: true, colors: { dark: { feed: DARK_OWN }, light: { gcode: LIGHT_OWN } } });
  });

  it('does not change the palette it was given', () => {
    const colors: ProfileColors = { dark: { feed: DARK_OWN } };
    editColor(colors, 'gcode', 'dark', '#00ccff');
    expect(colors).toEqual({ dark: { feed: DARK_OWN } });
  });

  it('refuses a colour that is too faint, with its ratio, in both themes', () => {
    const dark = editColor({}, 'feed', 'dark', '#202020');
    expect(dark).toMatchObject({ ok: false, problem: 'tooFaint' });
    expect(Number((dark as { ratio: string }).ratio)).toBeLessThan(4.5);
    expect(editColor({}, 'feed', 'light', '#f0f0a0')).toMatchObject({ ok: false, problem: 'tooFaint' });
    // a colour that reads on one theme can be refused on the other
    expect(editColor({}, 'feed', 'dark', LIGHT_OWN)).toMatchObject({ ok: false, problem: 'tooFaint' });
    expect(editColor({}, 'feed', 'light', DARK_OWN)).toMatchObject({ ok: false, problem: 'tooFaint' });
  });

  it('refuses text that is not a colour', () => {
    for (const text of ['', 'red', '#12', '#12345g', 'rgb(1,2,3)']) {
      expect(editColor({}, 'feed', 'dark', text), text).toEqual({ ok: false, problem: 'notAColor' });
    }
  });
});

describe('resetColor', () => {
  it('takes the colour away and a theme that is left empty with it', () => {
    const colors: ProfileColors = { dark: { feed: DARK_OWN, gcode: DARK_OWN }, light: { feed: LIGHT_OWN } };
    expect(resetColor(colors, 'feed', 'dark')).toEqual({ dark: { gcode: DARK_OWN }, light: { feed: LIGHT_OWN } });
    expect(resetColor(colors, 'feed', 'light')).toEqual({ dark: { feed: DARK_OWN, gcode: DARK_OWN } });
    expect(resetColor({ dark: { feed: DARK_OWN } }, 'feed', 'dark')).toEqual({});
    expect(colors.dark?.feed).toBe(DARK_OWN);
  });

  it('is fine for a colour that was never set', () => {
    expect(resetColor({}, 'feed', 'dark')).toEqual({});
  });
});

describe('the rows', () => {
  it('has one cell per role and theme, the theme in force first', () => {
    const tags = cells(markup());
    expect(tags).toHaveLength(ROLES.length * 2);
    expect(tags.slice(0, 2).map((tag) => `${attr(tag, 'data-role')}/${attr(tag, 'data-mode')}`)).toEqual([`${ROLES[0]}/dark`, `${ROLES[0]}/light`]);
    const light = cells(markup({ firstMode: 'light' }));
    expect(light.slice(0, 2).map((tag) => attr(tag, 'data-mode'))).toEqual(['light', 'dark']);
  });

  it('says value, ratio and layer on each cell', () => {
    const tags = cells(markup({ colors: { dark: { feed: DARK_OWN } } }));
    const feed = tags.find((tag) => attr(tag, 'data-role') === 'feed' && attr(tag, 'data-mode') === 'dark') as string;
    expect(attr(feed, 'data-value')).toBe(DARK_OWN);
    expect(attr(feed, 'data-layer')).toBe('user');
    expect(attr(feed, 'data-ratio')).toBe(ratioText(DARK_OWN, 'dark'));
    const gcode = tags.find((tag) => attr(tag, 'data-role') === 'gcode' && attr(tag, 'data-mode') === 'light') as string;
    expect(attr(gcode, 'data-value')).toBe(ROLE_COLORS.light.gcode);
    expect(attr(gcode, 'data-layer')).toBe('builtin');
    for (const tag of tags) expect(attr(tag, 'data-ratio')).toMatch(/^\d+\.\d$/);
  });

  it('for a profile shows the layer of each colour', () => {
    const tags = cells(markup({ layer: 'profile', colors: { dark: { feed: DARK_OWN } }, below: { dark: { gcode: '#00ccff' } } }));
    const layers = (role: string): string | undefined => attr(tags.find((tag) => attr(tag, 'data-role') === role && attr(tag, 'data-mode') === 'dark') as string, 'data-layer');
    expect(layers('feed')).toBe('profile');
    expect(layers('gcode')).toBe('user');
    expect(layers('tool')).toBe('builtin');
  });

  it('has a Reset button per cell, enabled only where the edited layer has a colour', () => {
    const html = markup({ colors: { dark: { feed: DARK_OWN } } });
    const buttons = html.match(/<button[^>]*data-testid="role-color-reset"[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(ROLES.length * 2);
    const enabled = buttons.filter((tag) => !/\bdisabled\b/.test(tag));
    expect(enabled.map((tag) => `${attr(tag, 'data-role')}/${attr(tag, 'data-mode')}`)).toEqual(['feed/dark']);
  });

  it('says the editor is fine when nothing is wrong, and shows no message', () => {
    const html = markup();
    expect(html).toContain('data-valid="yes"');
    expect(html).not.toContain('role-colors-blocked');
  });

  it('can leave out the heading, for the profile form', () => {
    expect(markup()).toContain('Code colours');
    expect(markup({ heading: false })).not.toContain('Code colours');
  });
});

describe('the source', () => {
  it('writes no colour of its own in the styles (the brand tokens rule)', () => {
    const source = readFileSync(new URL('./RoleColorRows.svelte', import.meta.url), 'utf8');
    const styles = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
    expect(styles).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(styles).toContain('var(--border-color)');
  });
});
