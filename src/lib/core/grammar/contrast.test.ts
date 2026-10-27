// The contrast rule of the role colours (plan §6.10 rule 6).

import { describe, expect, it } from 'vitest';
import { MIN_ROLE_CONTRAST, contrastRatio, paletteProblems, roleColorProblem } from './contrast';
import { EDITOR_COLORS, ROLES, ROLE_COLORS } from './roles';

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for a colour on itself', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#6ab0f3', '#6ab0f3')).toBe(1);
  });
});

describe('roleColorProblem', () => {
  it('accepts every built-in role colour in its own theme', () => {
    for (const mode of ['dark', 'light'] as const) {
      for (const role of ROLES) expect(roleColorProblem(ROLE_COLORS[mode][role], mode), `${mode}.${role}`).toBeNull();
    }
  });

  it('refuses a colour that is not #rrggbb', () => {
    for (const value of ['red', '#fff', '#12345g', 12, null, '#1234567']) {
      expect(roleColorProblem(value, 'dark')).toMatch(/#rrggbb/);
    }
  });

  it('refuses a colour below the limit and names its ratio, rounded down', () => {
    // The dark background itself, and a dark grey on it.
    expect(roleColorProblem(EDITOR_COLORS.dark.background, 'dark')).toMatch(/contrast of 1:1/);
    expect(roleColorProblem('#444444', 'dark')).toMatch(/at least 4\.5:1/);
    // A light grey is fine on dark and refused on light.
    expect(roleColorProblem('#cccccc', 'dark')).toBeNull();
    expect(roleColorProblem('#cccccc', 'light')).toMatch(/light editor background/);
  });

  it('never shows a ratio just below the limit as the limit', () => {
    // Search a grey whose ratio on the light background lies in [4.45, 4.5).
    let found: string | null = null;
    for (let v = 0; v < 256 && found === null; v++) {
      const hex = `#${v.toString(16).padStart(2, '0').repeat(3)}`;
      const r = contrastRatio(hex, EDITOR_COLORS.light.background);
      if (r < MIN_ROLE_CONTRAST && r >= 4.45) found = hex;
    }
    if (found !== null) expect(roleColorProblem(found, 'light')).toMatch(/contrast of 4\.4:1/);
  });
});

describe('paletteProblems', () => {
  it('accepts an empty palette, an empty theme and good colours', () => {
    expect(paletteProblems({})).toEqual([]);
    expect(paletteProblems({ dark: {} })).toEqual([]);
    expect(paletteProblems({ dark: { feed: '#ffaa00' }, light: { feed: '#7a3d00' } })).toEqual([]);
  });

  it('names each problem by its path', () => {
    expect(paletteProblems({ dim: {}, dark: { feeds: '#ffaa00', gcode: '#000000' }, light: [] }).map(([p]) => p)).toEqual([
      'dim',
      'dark.feeds',
      'dark.gcode',
      'light',
    ]);
    expect(paletteProblems([])).toEqual([['', 'has to be an object']]);
  });
});
