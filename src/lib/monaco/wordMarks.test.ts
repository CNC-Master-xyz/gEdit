// The colours of the word marks (P4.24, `wordMarks.css`) in both themes.
//
// The mark is the `--warning` token of `src/app.css` at a faint tint behind the word, plus a
// line under it. The test reads both files, blends the tint over the editor background the
// way the browser does, and measures: every colour of the syntax palette must still read on
// the tint (the palette itself reaches 4.5:1 on the plain background, roles.test.ts), and the
// line, which is no text, must stand out from the background by 3:1.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EDITOR_COLORS, ROLES, ROLE_COLORS } from '$lib/core/grammar/roles';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const wordCss = read('./wordMarks.css');
const appCss = read('../../app.css');

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;

function luminance([r, g, b]: Rgb): number {
  const linear = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const blend = (over: Rgb, alpha: number, under: Rgb): Rgb => over.map((c, i) => c * alpha + under[i] * (1 - alpha)) as Rgb;

/** `--warning` in the `:root` block (dark) or the `:root[data-theme='light']` block of app.css. */
function warning(mode: 'dark' | 'light'): Rgb {
  const start = mode === 'dark' ? appCss.indexOf(':root {') : appCss.indexOf(":root[data-theme='light'] {");
  const block = appCss.slice(start, appCss.indexOf('}', start));
  const match = /--warning:\s*(#[0-9a-f]{6})/i.exec(block);
  if (!match) throw new Error(`no --warning in the ${mode} block`);
  return rgb(match[1]);
}

const tint = Number(/color-mix\(in srgb, var\(--warning\) (\d+)%, transparent\)/.exec(wordCss)?.[1]) / 100;

describe('the word mark colours', () => {
  it('are made of the --warning token and nothing else (no literal colour)', () => {
    expect(tint).toBeGreaterThan(0);
    expect(tint).toBeLessThanOrEqual(0.2);
    expect(wordCss).toMatch(/box-shadow: inset 0 -1px 0 0 var\(--warning\)/);
    // A colour written out would not follow the theme (app.css: "a literal colour outside this file is a bug").
    expect(wordCss.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  it.each(['dark', 'light'] as const)('%s: every syntax colour reads on the tint (at least 4:1)', (mode) => {
    const background = rgb(EDITOR_COLORS[mode].background);
    const under = blend(warning(mode), tint, background);
    // `invalid` is the linter's colour; the grammar never emits it (roles.ts).
    const colours = [...ROLES.filter((role) => role !== 'invalid').map((role) => ROLE_COLORS[mode][role]), EDITOR_COLORS[mode].foreground];
    const failures = colours.map((hex) => ({ hex, ratio: contrast(rgb(hex), under) })).filter((c) => c.ratio < 4);
    expect(failures, `${mode}: under 4:1 on the tint`).toEqual([]);
  });

  it.each(['dark', 'light'] as const)('%s: the line under the word stands out from the background by 3:1', (mode) => {
    expect(contrast(warning(mode), rgb(EDITOR_COLORS[mode].background))).toBeGreaterThanOrEqual(3);
  });

  it('the tint can be seen against the background at all, but never by hue alone', () => {
    for (const mode of ['dark', 'light'] as const) {
      const background = rgb(EDITOR_COLORS[mode].background);
      expect(contrast(blend(warning(mode), tint, background), background)).toBeGreaterThan(1.05);
    }
  });

  it('frames the parts of a long word with lines of the same token and no darker tint (review NC-8)', () => {
    const rule = /\.gedit-word-changed\.gedit-word-part\s*\{([^}]*)\}/.exec(wordCss)?.[1] ?? '';
    expect(rule).toMatch(/inset 0 -2px 0 0 var\(--warning\)/);
    expect(rule).toMatch(/inset 0 1px 0 0 var\(--warning\)/);
    // The syntax colours read on it as on the word: no background of its own.
    expect(rule).not.toMatch(/background/);
  });

  it('names the classes diff.ts draws and hides Monaco\'s character marks under the whole-line class', () => {
    expect(wordCss).toContain('.gedit-word-changed');
    expect(wordCss).toMatch(/\.gedit-word-line\.char-insert/);
    expect(wordCss).toMatch(/\.gedit-word-line\.char-delete/);
  });
});
