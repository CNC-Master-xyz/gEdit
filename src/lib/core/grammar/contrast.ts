// The contrast rule of the role colours (Phase 4 plan §6.10 rule 6; P4h prelude).
//
// One rule for every colour a token can get: the built-in palette (`roles.ts`, held to it by
// `roles.test.ts`), a user's role colour (the setting `appearance.roleColors`) and a profile's
// own colour (`profile.colors`). A colour must reach the WCAG AA ratio of 4.5:1 against the
// editor background of its theme (`EDITOR_COLORS`), or it is refused: an unreadable token is
// how a wrong word goes unnoticed on the shop floor. The validators of the profile and the
// settings call `roleColorProblem`; the role colour editor (P4.41) shows the same answer
// before a colour is saved.

import { EDITOR_COLORS, ROLES, type Role } from './roles';

/** WCAG AA for normal text, the limit of `roles.test.ts`. */
export const MIN_ROLE_CONTRAST = 4.5;

/** `#rrggbb`, the one colour spelling a profile, a setting or the generator accepts. */
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** True for a role name (`feed`, `gcode`, …). */
export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** The relative luminance of a `#rrggbb` colour (WCAG 2.x). */
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 0xff) + 0.7152 * channel((n >> 8) & 0xff) + 0.0722 * channel(n & 0xff);
}

/** The contrast ratio of two `#rrggbb` colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Why `value` cannot be a role colour in the `mode` theme, in plain words, or `null` when it
 * can: not `#rrggbb`, or below `MIN_ROLE_CONTRAST` against that theme's editor background
 * (the message gives the ratio, rounded down to one decimal, so 4.49 never reads as 4.5).
 */
export function roleColorProblem(value: unknown, mode: 'light' | 'dark'): string | null {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) return 'has to be a colour written as #rrggbb';
  const ratio = contrastRatio(value, EDITOR_COLORS[mode].background);
  if (ratio >= MIN_ROLE_CONTRAST) return null;
  const shown = Math.floor(ratio * 10) / 10;
  return `has a contrast of ${shown}:1 against the ${mode} editor background; at least ${MIN_ROLE_CONTRAST}:1 is needed to read it`;
}

/**
 * Every problem of a palette (`profile.colors`, `appearance.roleColors`) as `[path, message]`,
 * `path` relative to the palette (`dark.feed`). Only `dark` and `light`, only roles, only
 * colours that pass `roleColorProblem`. An empty palette, or an empty theme in it, is fine.
 */
export function paletteProblems(raw: unknown): [string, string][] {
  const out: [string, string][] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [['', 'has to be an object']];
  for (const [mode, roles] of Object.entries(raw as Record<string, unknown>)) {
    if (mode !== 'dark' && mode !== 'light') {
      out.push([mode, 'only "dark" and "light" can have colours']);
      continue;
    }
    if (typeof roles !== 'object' || roles === null || Array.isArray(roles)) {
      out.push([mode, 'has to be an object of role colours']);
      continue;
    }
    for (const [role, value] of Object.entries(roles as Record<string, unknown>)) {
      if (!isRole(role)) {
        out.push([`${mode}.${role}`, `is not a role; the roles are ${ROLES.join(', ')}`]);
        continue;
      }
      const problem = roleColorProblem(value, mode);
      if (problem !== null) out.push([`${mode}.${role}`, problem]);
    }
  }
  return out;
}
