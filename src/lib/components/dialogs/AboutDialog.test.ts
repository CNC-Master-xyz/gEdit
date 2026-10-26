// About (plan §5 WP2.4). Rendered with `svelte/server`, which needs no DOM: it covers the
// version, the two addresses, the "no update check" statement and the fact that the
// third-party notices start collapsed. Expanding them needs a click, which the M2 runtime
// scenarios do. The shape of `licenses.json` is checked against what the dialog reads, so
// a change to `scripts/gen-licenses.mjs` cannot silently break About.

import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import AboutDialog, { ISSUES_URL, NOTICE_PAGE, REPOSITORY_URL, packageKey, visiblePackages, type LicenseData } from './AboutDialog.svelte';

const html = render(AboutDialog, { props: { close: () => {} } }).body;

/** The text of the element with this test id. Svelte adds a scoped class after the attribute. */
function at(testId: string, text: string): RegExp {
  return new RegExp(`data-testid="${testId}"[^>]*>[^<]*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
}

describe('AboutDialog markup', () => {
  it('is a modal the harness can find by name, with Close and no confirm button', () => {
    expect(html).toContain('data-modal="about"');
    expect(html).toContain('data-testid="modal-cancel"');
    expect(html).not.toContain('data-testid="modal-ok"');
  });

  it('shows the build version', () => {
    expect(html).toMatch(at('about-version', __APP_VERSION__));
    expect(__APP_VERSION__).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('names the project license', () => {
    expect(html).toMatch(at('about-license', 'MIT'));
  });

  it('shows the repository and the issue tracker as plain text, not as links', () => {
    expect(html).toMatch(at('about-repository', REPOSITORY_URL));
    expect(html).toMatch(at('about-issues', ISSUES_URL));
    expect(ISSUES_URL.startsWith(REPOSITORY_URL)).toBe(true);
    expect(html).not.toContain('<a ');
  });

  it('says that nothing checks for updates', () => {
    expect(html).toMatch(at('about-updates', 'never checks for updates'));
  });

  it('keeps the third-party notices behind a button, so nothing loads with the dialog', () => {
    expect(html).toContain('data-testid="about-notices"');
    expect(html).not.toContain('data-testid="license-entry"');
    expect(html).not.toContain('data-testid="about-notices-status"');
  });
});

describe('licenses.json', () => {
  it('has the shape the dialog reads, and a text for every package', async () => {
    const data = ((await import('$lib/data/licenses.json')) as { default: unknown }).default as LicenseData;
    expect(data.packages.length).toBeGreaterThan(0);
    const missing = data.packages.filter((pkg) => typeof data.texts[pkg.textId] !== 'string');
    expect(missing).toEqual([]);
    const bad = data.packages.filter(
      (pkg) =>
        !pkg.name ||
        !pkg.version ||
        !pkg.license ||
        (pkg.source !== 'npm' && pkg.source !== 'cargo'),
    );
    expect(bad).toEqual([]);
  });

  it('gives every package a distinct key', async () => {
    const data = ((await import('$lib/data/licenses.json')) as { default: unknown }).default as LicenseData;
    expect(new Set(data.packages.map(packageKey)).size).toBe(data.packages.length);
  });
});

// T219: the notices list had several hundred rows, all drawn at once.
describe('the notice list is drawn a page at a time', () => {
  it('starts with one page and adds one page per request, then stops', () => {
    const all = Array.from({ length: 460 }, (_, i) => i);
    expect(visiblePackages(all, NOTICE_PAGE)).toHaveLength(NOTICE_PAGE);
    expect(visiblePackages(all, NOTICE_PAGE * 2)).toHaveLength(NOTICE_PAGE * 2);
    expect(visiblePackages(all, NOTICE_PAGE * 20)).toHaveLength(460);
    expect(visiblePackages(all, 0)).toEqual([]);
    expect(visiblePackages(all, -5)).toEqual([]);
    expect(visiblePackages(all, NOTICE_PAGE)[0]).toBe(0);
  });

  it('is a page that is much smaller than the real list', async () => {
    const data = ((await import('$lib/data/licenses.json')) as { default: unknown }).default as LicenseData;
    expect(NOTICE_PAGE).toBeGreaterThan(0);
    expect(data.packages.length).toBeGreaterThan(NOTICE_PAGE * 2);
  });
});
