// The active-pane border (Phase 4 plan §5 P4e decision 4): 2 px in `--accent` for the group with
// the focus, a transparent one of the same width for the others, and `--accent` held at 3:1 or
// better against the editor background in both themes, as the motion colours are held.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EDITOR_COLORS } from '$lib/core/grammar/roles';

const ROOT = join(__dirname, '../../../..');

/** WCAG relative luminance of `#rrggbb`. */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 0xff) + 0.7152 * channel((n >> 8) & 0xff) + 0.0722 * channel(n & 0xff);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The value of `--accent` in the block that starts with `selector`. */
function accentOf(css: string, selector: string): string {
  const start = css.indexOf(selector);
  const block = css.slice(start, css.indexOf('}', start));
  const found = /--accent:\s*(#[0-9a-fA-F]{6})\s*;/.exec(block);
  if (!found) throw new Error(`no --accent in ${selector}`);
  return found[1].toLowerCase();
}

describe('the active pane’s border', () => {
  const css = readFileSync(join(ROOT, 'src/app.css'), 'utf8');

  it('knows the contrast formula it is checked with', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['dark', ':root {'],
    ['light', ":root[data-theme='light'] {"],
  ] as const)('keeps --accent at 3:1 against the %s editor background', (mode, selector) => {
    const ratio = contrast(accentOf(css, selector), EDITOR_COLORS[mode].background);
    expect(ratio).toBeGreaterThanOrEqual(3);
  });

  it('is 2 px wide for every group of a split, transparent unless the group has the focus', () => {
    const source = readFileSync(join(ROOT, 'src/lib/components/editor/EditorGroup.svelte'), 'utf8');
    const style = source.split('<style>')[1] ?? '';
    expect(/\.group\.multiple\s*\{([^}]*)\}/.exec(style)?.[1]).toMatch(/border:\s*2px solid transparent/);
    expect(/\.group\.focused\s*\{([^}]*)\}/.exec(style)?.[1]).toMatch(/border-color:\s*var\(--accent\)/);
    // The border is switched on by the focus alone: nothing else about the box changes with it.
    expect(/\.group\.focused\s*\{([^}]*)\}/.exec(style)?.[1]).not.toMatch(/border-width|padding|margin/);
  });
});
