// Settings ▸ Configuration (Phase 4 plan §6.9 rules 44, 46): the two buttons and the preview shown
// on the page (a modal cannot open over the Settings dialog). Rendered with `svelte/server`.

import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import ConfigurationPage from './ConfigurationPage.svelte';
import type { ConfigurationActions } from '$lib/contrib/configuration';

const actions = (): ConfigurationActions => ({
  exportConfiguration: vi.fn(async () => null),
  pickImport: vi.fn(async () => null),
  applyImport: vi.fn(async () => null),
});

describe('the Configuration page', () => {
  it('keeps its test id and offers Export and Import', () => {
    const markup = render(ConfigurationPage, { props: { deps: { actions: actions() } } }).body;
    expect(markup).toContain('data-testid="settings-configuration"');
    expect(markup).toContain('data-testid="config-export"');
    expect(markup).toContain('data-testid="config-import"');
    expect(markup).not.toContain('data-testid="import-preview"');
  });

  it('shows the preview of a picked file on the page, and the two buttons wait for it', () => {
    const markup = render(ConfigurationPage, {
      props: {
        deps: { actions: actions() },
        initial: {
          src: '/tmp/c.zip',
          preview: {
            ok: true,
            fingerprint: '0',
            manifest: { appVersion: '', created: '', platform: '' },
            groups: [{ id: 'profiles', runnable: false, files: [{ path: 'profiles/a.json', action: 'new', bytes: 2, items: [], notes: [] }] }],
            ignored: [],
            ignoredCount: 0,
            refusals: [],
            needsTrust: false,
            keptSettings: [],
          },
        },
      },
    }).body;
    expect(markup).toContain('data-testid="import-preview"');
    expect(markup).toMatch(/data-testid="config-import"[^>]*disabled|disabled[^>]*data-testid="config-import"/);
  });
});
