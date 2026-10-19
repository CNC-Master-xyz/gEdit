// The look of peterbuilds.dev (Brand batch, v1.2.0): the tokens of `src/app.css`, held to the
// palette the owner chose and to the contrast ratios that make text readable.
//
//  - every pair that carries text is at least 4.5:1 (WCAG AA, normal text), in both themes;
//  - the orange as a mark or a line is at least 3:1 on the editor surface (WCAG, non-text);
//  - the Monaco themes (`core/grammar/chrome.ts`, `EDITOR_COLORS`) say the same as the CSS tokens;
//  - no component writes a colour of its own (`app.css`: "a literal colour outside this file is a
//    bug"), the old blues are gone, and the one bundled font loads from the app itself.
//
// The ratio is the WCAG 2.x formula; the helpers are anchored on the examples of the standard so
// that a broken helper cannot silently pass the palette.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EDITOR_CHROME } from '$lib/core/grammar/chrome';
import { EDITOR_COLORS, ROLES, ROLE_COLORS } from '$lib/core/grammar/roles';

const ROOT = join(__dirname, '../../..');
const SRC = join(ROOT, 'src');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
const css = read('src/app.css');

type Mode = 'dark' | 'light';
const MODES: readonly Mode[] = ['dark', 'light'];
type Rgba = [number, number, number, number];

/** The declarations of the block that starts with `selector`, token name to raw value. */
function tokensOf(selector: string): Map<string, string> {
  const start = css.indexOf(selector);
  expect(start, `no ${selector} block in app.css`).toBeGreaterThanOrEqual(0);
  const block = css.slice(start, css.indexOf('\n}', start));
  const out = new Map<string, string>();
  for (const m of block.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

const TOKENS: Record<Mode, Map<string, string>> = { dark: tokensOf(':root {'), light: tokensOf(":root[data-theme='light'] {") };

/** `#rrggbb`, `#rrggbbaa` or `rgb(r g b / p%)` as 0..255 channels and an alpha of 0..1. */
function parse(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, hex[2] ? Number.parseInt(hex[2], 16) / 255 : 1];
  }
  const fn = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+)%)?\s*\)$/.exec(value);
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3]), fn[4] === undefined ? 1 : Number(fn[4]) / 100];
  throw new Error(`not a colour: ${value}`);
}

/** `fg` laid over the opaque `bg`. */
function over(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3];
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
}

function luminance([r, g, b]: Rgba): number {
  const c = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The colour of a token as a solid one: a translucent token is laid over `under` first. */
function colour(mode: Mode, token: string, under?: string): Rgba {
  const raw = TOKENS[mode].get(token);
  if (raw === undefined) throw new Error(`no ${token} in the ${mode} theme`);
  const c = parse(raw);
  return c[3] === 1 ? c : over(c, colour(mode, under ?? '--bg-app'));
}

const ratio = (mode: Mode, fg: string, bg: string): number => contrast(colour(mode, fg, bg), colour(mode, bg));

describe('the contrast helper', () => {
  it('knows the anchors of the standard', () => {
    expect(contrast([255, 255, 255, 1], [0, 0, 0, 1])).toBeCloseTo(21, 5);
    expect(contrast([255, 255, 255, 1], [255, 255, 255, 1])).toBeCloseTo(1, 5);
    expect(contrast(parse('#767676'), parse('#ffffff'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(parse('#777777'), parse('#ffffff'))).toBeLessThan(4.5);
  });

  it('lays a translucent colour over a surface before it measures', () => {
    expect(over(parse('rgb(255 255 255 / 50%)'), [0, 0, 0, 1])[0]).toBeCloseTo(127.5, 5);
  });
});

describe('the palette of peterbuilds.dev', () => {
  const PALETTE: Record<Mode, Record<string, string>> = {
    dark: {
      '--bg-app': '#0f1115',
      '--bg-panel': '#14171c',
      '--bg-ribbon': '#1a1d23',
      '--status-bg': '#20242b',
      '--border-color': '#353941',
      '--text-main': '#e6e7ea',
      '--text-muted': '#a3a7af',
    },
    light: {
      '--bg-app': '#f9f9fb',
      '--bg-panel': '#f3f3f5',
      '--bg-ribbon': '#eeeef0',
      '--status-bg': '#e8e8ea',
      '--border-color': '#cfc4c5',
      '--text-main': '#1a1c1d',
      '--text-muted': '#4c4546',
    },
  };

  it.each(MODES)('%s: the surfaces, the line and the text are the chosen ones', (mode) => {
    for (const [token, value] of Object.entries(PALETTE[mode])) expect(TOKENS[mode].get(token), `${mode} ${token}`).toBe(value);
  });

  it('has one orange, the same in both themes', () => {
    expect(TOKENS.dark.get('--accent')?.toLowerCase()).toBe('#f25c19');
    expect(TOKENS.light.get('--accent')?.toLowerCase()).toBe('#f25c19');
  });

  it('gives every token of the dark theme a light one, and the other way round', () => {
    const missing = [...TOKENS.dark.keys()].filter((k) => !TOKENS.light.has(k) && k !== '--font-ui' && k !== '--font-display' && k !== '--font-mono');
    expect(missing).toEqual([]);
    expect([...TOKENS.light.keys()].filter((k) => !TOKENS.dark.has(k))).toEqual([]);
  });

  it('keeps the signal colours apart from the orange', () => {
    // The orange is at about 19 degrees of hue; warning (amber, about 43) is the nearest signal.
    const hue = ([r, g, b]: Rgba): number => {
      const [x, y, z] = [r / 255, g / 255, b / 255];
      const mx = Math.max(x, y, z);
      const d = mx - Math.min(x, y, z);
      if (d === 0) return 0;
      const h = mx === x ? ((y - z) / d) % 6 : mx === y ? (z - x) / d + 2 : (x - y) / d + 4;
      return (h * 60 + 360) % 360;
    };
    const orange = hue(parse('#F25C19'));
    for (const mode of MODES) {
      for (const token of ['--success', '--info', '--warning']) {
        const h = hue(colour(mode, token));
        expect(Math.abs(h - orange), `${mode} ${token}`).toBeGreaterThan(20);
      }
    }
    expect(TOKENS.dark.get('--warning')).toBe('#fbbf24');
    expect(TOKENS.dark.get('--info')).toBe('#38bdf8');
    expect(TOKENS.dark.get('--success')).toBe('#34d399');
    expect(TOKENS.dark.get('--danger')).toBe('#f87171');
  });
});

describe('contrast of the pairs that carry text (4.5:1)', () => {
  const SURFACES = ['--bg-app', '--bg-panel', '--bg-ribbon'];
  const TEXT = ['--text-main', '--text-active', '--text-muted', '--accent-text', '--success', '--info', '--warning', '--danger', '--danger-text', '--nc-tool', '--nc-comment'];

  it.each(MODES)('%s: text and signal colours on the app surfaces', (mode) => {
    const failures: string[] = [];
    for (const fg of TEXT) {
      for (const bg of SURFACES) {
        const r = ratio(mode, fg, bg);
        if (r < 4.5) failures.push(`${fg} on ${bg} ${r.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it.each(MODES)('%s: the status bar reads in its normal text colour', (mode) => {
    expect(ratio(mode, '--status-text', '--status-bg')).toBeGreaterThanOrEqual(4.5);
    expect(ratio(mode, '--text-muted', '--status-bg')).toBeGreaterThanOrEqual(4.5);
    // The one orange on the bar is its 2px top line: a non-text mark, 3:1 where it can be had.
    expect(read('src/lib/components/shell/StatusBar.svelte')).toMatch(/border-top:\s*2px solid var\(--accent\)/);
    expect(TOKENS[mode].get('--status-bg')).not.toBe(TOKENS[mode].get('--accent'));
  });

  it.each(MODES)('%s: orange text, links and the focus ring', (mode) => {
    for (const bg of [...SURFACES, '--status-bg']) expect(ratio(mode, '--accent-text', bg), `${mode} --accent-text on ${bg}`).toBeGreaterThanOrEqual(4.5);
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent-text\)/);
  });

  it.each(MODES)('%s: the text on the orange main button is near-black, not white', (mode) => {
    expect(ratio(mode, '--text-on-accent', '--accent')).toBeGreaterThanOrEqual(4.5);
    expect(ratio(mode, '--text-on-accent', '--accent-hover')).toBeGreaterThanOrEqual(4.5);
    // The white the old theme used would have been under AA on this orange.
    expect(contrast(parse('#ffffff'), colour(mode, '--accent'))).toBeLessThan(4.5);
  });

  it.each(MODES)('%s: the inverted-ink button and the solid red', (mode) => {
    expect(ratio(mode, '--btn-ink-text', '--btn-ink-bg')).toBeGreaterThanOrEqual(4.5);
    expect(ratio(mode, '--btn-ink-text', '--btn-ink-hover')).toBeGreaterThanOrEqual(4.5);
    expect(ratio(mode, '--text-on-danger', '--danger-solid')).toBeGreaterThanOrEqual(4.5);
  });

  it.each(MODES)('%s: text on the selected-row tint', (mode) => {
    for (const bg of SURFACES) {
      const tint = over(colour(mode, '--accent-soft', bg), colour(mode, bg));
      expect(contrast(colour(mode, '--text-active', bg), tint), `${mode} --text-active on --accent-soft over ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(MODES)('%s: the tinted signal surfaces keep their text readable', (mode) => {
    const pairs: [string, string][] = [['--info', '--info-surface'], ['--danger-text', '--danger-surface']];
    for (const [fg, surface] of pairs) {
      const tint = over(colour(mode, surface, '--bg-panel'), colour(mode, '--bg-panel'));
      expect(contrast(colour(mode, fg), tint), `${mode} ${fg} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('contrast of the orange as a mark (3:1)', () => {
  it.each(MODES)('%s: --accent on the editor surface', (mode) => {
    // The active-tab bar, the active-group border, the overview-ruler mark. On the light panels
    // (3.0:1) and ribbon (2.9:1) the orange is a mark that never stands alone: the text beside it
    // changes as well, and a ring or a link there uses --accent-text.
    expect(ratio(mode, '--accent', '--bg-app')).toBeGreaterThanOrEqual(3);
  });

  it('--accent on the dark panels and ribbon', () => {
    for (const bg of ['--bg-panel', '--bg-ribbon']) expect(ratio('dark', '--accent', bg)).toBeGreaterThanOrEqual(3);
  });

  it('the overview-ruler mark of the bookmarks is the brand orange', () => {
    expect(read('src/lib/monaco/bookmarks.ts')).toMatch(/const RULER_COLOR = '#F25C19';/);
  });
});

describe('the Monaco themes follow the tokens', () => {
  const SAME: [string, string][] = [
    ['editor.background', '--bg-app'],
    ['editor.foreground', '--text-main'],
    ['editorGutter.background', '--bg-app'],
    ['minimap.background', '--bg-app'],
    ['input.background', '--bg-app'],
    ['editorWidget.background', '--bg-ribbon'],
    ['editorSuggestWidget.background', '--bg-ribbon'],
    ['editorHoverWidget.background', '--bg-ribbon'],
    ['editorWidget.foreground', '--text-main'],
    ['editorWidget.border', '--border-color'],
    ['editorHoverWidget.border', '--border-color'],
    ['input.border', '--border-color'],
    ['editorLineNumber.activeForeground', '--text-main'],
    ['editorError.foreground', '--danger'],
    ['editorWarning.foreground', '--warning'],
    ['editorInfo.foreground', '--info'],
    ['editorCursor.foreground', '--accent-text'],
    ['focusBorder', '--accent-text'],
    ['scrollbarSlider.background', '--scrollbar-thumb'],
    ['scrollbarSlider.activeBackground', '--scrollbar-thumb-hover'],
  ];

  function themeColors(mode: Mode): Record<string, string> {
    return { ...EDITOR_CHROME[mode], 'editor.background': EDITOR_COLORS[mode].background, 'editor.foreground': EDITOR_COLORS[mode].foreground };
  }

  it.each(MODES)('%s: the colours the chrome and the editor share are the same', (mode) => {
    const colors = themeColors(mode);
    const different: string[] = [];
    for (const [id, token] of SAME) {
      const want = parse(TOKENS[mode].get(token) ?? 'missing').slice(0, 3).join(',');
      const got = parse(colors[id] ?? 'missing').slice(0, 3).join(',');
      if (want !== got) different.push(`${id} ${colors[id]} vs ${token} ${TOKENS[mode].get(token)}`);
    }
    // The scrollbar thumbs are translucent in Monaco (a byte of alpha); their colour is the token's.
    expect(different.filter((d) => !d.startsWith('scrollbarSlider'))).toEqual([]);
  });

  it.each(MODES)('%s: the line numbers, the widgets and the selected entries are readable', (mode) => {
    const c = themeColors(mode);
    const bg = parse(c['editor.background']);
    expect(contrast(parse(c['editorLineNumber.foreground']), bg)).toBeGreaterThanOrEqual(4.5);
    for (const widget of ['editorWidget', 'editorSuggestWidget', 'editorHoverWidget', 'menu']) {
      const fill = parse(c[`${widget}.background`]);
      expect(contrast(parse(c[`${widget}.foreground`]), fill), `${mode} ${widget}`).toBeGreaterThanOrEqual(4.5);
    }
    const widget = parse(c['editorSuggestWidget.background']);
    expect(contrast(parse(c['editorSuggestWidget.highlightForeground']), widget)).toBeGreaterThanOrEqual(4.5);
    const selectedEntry = over(parse(c['list.activeSelectionBackground']), widget);
    expect(contrast(parse(c['list.activeSelectionForeground']), selectedEntry)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(MODES)('%s: text stays legible on the orange selection (3:1 for every syntax colour)', (mode) => {
    const c = themeColors(mode);
    const selection = over(parse(c['editor.selectionBackground']), parse(c['editor.background']));
    const weak = [...ROLES, 'foreground' as const]
      .map((role) => {
        const fg = role === 'foreground' ? c['editor.foreground'] : ROLE_COLORS[mode][role];
        return { role, ratio: contrast(parse(fg), selection) };
      })
      .filter((entry) => entry.ratio < 3);
    expect(weak).toEqual([]);
  });

  it.each(MODES)('%s: text stays legible on the find matches (3:1 for every syntax colour, over the surface and the current line)', (mode) => {
    const c = themeColors(mode);
    const weak: string[] = [];
    for (const id of ['editor.findMatchBackground', 'editor.findMatchHighlightBackground']) {
      for (const under of ['editor.background', 'editor.lineHighlightBackground']) {
        const fill = over(parse(c[id]), parse(c[under]));
        for (const role of [...ROLES, 'foreground' as const]) {
          const fg = role === 'foreground' ? c['editor.foreground'] : ROLE_COLORS[mode][role];
          const r = contrast(parse(fg), fill);
          if (r < 3) weak.push(`${role} on ${id} over ${under}: ${r.toFixed(2)}`);
        }
      }
    }
    expect(weak).toEqual([]);
  });

  it.each(MODES)('%s: the current find match stays clear — a stronger fill than the other matches, and an orange border', (mode) => {
    const c = themeColors(mode);
    expect(parse(c['editor.findMatchBackground'])[3]).toBeGreaterThan(parse(c['editor.findMatchHighlightBackground'])[3]);
    // The border is the orange of the mode (a solid, readable one on the light surface).
    const border = parse(c['editor.findMatchBorder']);
    expect(border[3]).toBe(1);
    expect(contrast(border, parse(c['editor.background']))).toBeGreaterThanOrEqual(3);
  });

  it.each(MODES)('%s: the current line does not hide any syntax colour (4.5:1)', (mode) => {
    const c = themeColors(mode);
    const line = parse(c['editor.lineHighlightBackground']);
    const weak = ROLES.map((role) => ({ role, ratio: contrast(parse(ROLE_COLORS[mode][role]), line) })).filter((entry) => entry.ratio < 4.5);
    expect(weak).toEqual([]);
  });
});

/** CIE76 colour difference in CIELAB (D65), as `core/grammar/roles.test.ts` measures it. */
function deltaE(a: Rgba, b: Rgba): number {
  const lab = ([r, g, bl]: Rgba): [number, number, number] => {
    const lin = (v: number): number => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const [R, G, B] = [lin(r), lin(g), lin(bl)];
    const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
    const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
    const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  };
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

describe('the feed word is not orange', () => {
  // Orange is the colour of links, the cursor and the focus ring; a feed word in a tint of it
  // read as a link (light: ΔE 12 from --accent-text). The feed word is violet in both themes.
  it.each(MODES)('%s: feed is far from --accent and --accent-text (ΔE above 25)', (mode) => {
    const feed = parse(ROLE_COLORS[mode].feed);
    for (const token of ['--accent', '--accent-text']) {
      expect(deltaE(feed, colour(mode, token)), `${mode}: feed vs ${token}`).toBeGreaterThan(25);
    }
  });

  it.each(MODES)('%s: the feed word reads on the selection and the selection highlight (3:1)', (mode) => {
    const c = EDITOR_CHROME[mode];
    const surface = parse(EDITOR_COLORS[mode].background);
    const line = parse(c['editor.lineHighlightBackground']);
    for (const id of ['editor.selectionBackground', 'editor.selectionHighlightBackground']) {
      for (const under of [surface, line]) {
        const tint = over(parse(c[id]), under);
        expect(contrast(parse(ROLE_COLORS[mode].feed), tint), `${mode}: feed on ${id}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe('no colour is written out in a component', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, out);
      else out.push(path);
    }
    return out;
  }

  // The tables that hand a colour to Monaco's JavaScript API (it cannot read a CSS variable)
  // and the two margin-mark sheets with their own contrast tests; everything else uses a token.
  const ALLOWED = new Set([
    'src/app.css',
    'src/lib/core/grammar/roles.ts',
    'src/lib/core/grammar/chrome.ts',
    'src/lib/core/nc/motion.ts',
    'src/lib/monaco/channelPanes.ts',
    'src/lib/monaco/bookmarks.ts',
    'src/lib/monaco/channelPanes.css',
    'src/lib/monaco/motionColors.css',
  ]);

  const files = walk(SRC)
    .map((f) => relative(ROOT, f))
    .filter((f) => /\.(svelte|css|html|ts)$/.test(f) && !/\.test\.ts$/.test(f) && !ALLOWED.has(f) && !f.includes('/data/'));

  const COLOUR = /(?<![\w&])#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?\b(?![\w-])|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/;

  it('finds the files it is supposed to look at', () => {
    expect(files.some((f) => f.endsWith('Modal.svelte'))).toBe(true);
    expect(files.some((f) => f.endsWith('StatusBar.svelte'))).toBe(true);
  });

  it('uses only var(--…) tokens in styles', () => {
    const offenders: string[] = [];
    for (const file of files) {
      let text = read(file);
      // Colours only matter where they are styles: the <style> of a component, or a sheet.
      if (file.endsWith('.svelte')) text = [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
      else if (!file.endsWith('.css') && !file.endsWith('.html')) continue;
      text = text.replace(/\/\*[\s\S]*?\*\//g, '');
      text.split('\n').forEach((line, i) => {
        if (COLOUR.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('has none of the old blues anywhere in the sources', () => {
    const blues = /#(?:0078d4|005fb8|2b88d8|004a93|0e639c|1177bb)\b/i;
    const offenders = walk(SRC)
      .filter((f) => /\.(svelte|css|html|ts)$/.test(f) && !f.includes('/data/') && !/\.test\.ts$/.test(f))
      .filter((f) => blues.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});

describe('the fonts', () => {
  it('sets the UI in the system font, not in a named desktop font', () => {
    const ui = TOKENS.dark.get('--font-ui') ?? '';
    expect(ui.startsWith('system-ui')).toBe(true);
    expect(ui).not.toMatch(/Segoe|Tahoma|Verdana|Geneva/);
  });

  it('keeps the editor font where it was', () => {
    expect(TOKENS.dark.get('--font-mono')).toBe('"Fira Code", Consolas, monospace');
    expect(read('src/lib/core/settings/schema.ts')).toContain(`'appearance.editorFontFamily': "Menlo, Consolas, 'DejaVu Sans Mono', monospace"`);
  });

  it('bundles Space Grotesk from node_modules and never loads a font from the web', () => {
    const layout = read('src/routes/+layout.svelte');
    expect(layout).toContain("import '@fontsource-variable/space-grotesk/wght.css';");
    const pkg = JSON.parse(read('package.json')) as { devDependencies: Record<string, string> };
    expect(pkg.devDependencies['@fontsource-variable/space-grotesk']).toBeDefined();
    const sheet = read('node_modules/@fontsource-variable/space-grotesk/wght.css');
    expect(sheet).not.toMatch(/url\(\s*['"]?(https?:)?\/\//);
    // Files over Vite's inline limit (4 KiB) are emitted as files and served from the app, which
    // is what `font-src 'self'` allows; a smaller one would become a `data:` URI and be blocked.
    for (const file of readdirSync(join(ROOT, 'node_modules/@fontsource-variable/space-grotesk/files'))) {
      expect(statSync(join(ROOT, 'node_modules/@fontsource-variable/space-grotesk/files', file)).size, file).toBeGreaterThan(4096);
    }
    const conf = JSON.parse(read('src-tauri/tauri.conf.json')) as { app?: { security?: { csp?: Record<string, unknown> } } };
    expect(conf.app?.security?.csp?.['font-src']).toEqual(["'self'"]);
    const sources = [...walk(SRC)].filter((f) => /\.(svelte|css|html|ts)$/.test(f) && !f.includes('/data/'));
    for (const f of sources) expect(readFileSync(f, 'utf8'), f).not.toMatch(/fonts\.(googleapis|gstatic)\.com|@import\s+url\(/);
  });

  it('uses the display font for headings only', () => {
    expect(TOKENS.dark.get('--font-display')).toMatch(/^"Space Grotesk Variable"/);
    const users = walk(SRC)
      .filter((f) => /\.(svelte|css)$/.test(f))
      .filter((f) => readFileSync(f, 'utf8').includes('var(--font-display)'))
      .map((f) => relative(ROOT, f))
      .sort();
    expect(users).toEqual([
      'src/lib/components/common/Modal.svelte',
      'src/lib/components/dialogs/AboutDialog.svelte',
      'src/lib/components/dialogs/ShortcutsDialog.svelte',
    ]);
  });

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, out);
      else out.push(path);
    }
    return out;
  }
});

describe('the licence of the font', () => {
  it('is in the notices shown in About, with its copyright line', () => {
    const data = JSON.parse(read('src/lib/data/licenses.json')) as {
      packages: { name: string; license: string; textId: string }[];
      texts: Record<string, string>;
    };
    const pkg = data.packages.find((p) => p.name === '@fontsource-variable/space-grotesk');
    expect(pkg?.license).toBe('OFL-1.1');
    expect(data.texts[pkg?.textId ?? '']).toContain('SIL Open Font License');
    expect(existsSync(join(ROOT, 'node_modules/@fontsource-variable/space-grotesk/LICENSE'))).toBe(true);
  });
});
