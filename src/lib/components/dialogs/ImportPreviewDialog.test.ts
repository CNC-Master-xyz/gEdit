// The preview of an import (Phase 4 plan §6.9 rules 26–31, 34, 46).
//
// The markup is rendered with `svelte/server` (no DOM), which is where the test ids of rule 46 are
// checked: `import-preview` with `data-state`, `import-group` with `data-group` and
// `data-runnable`, `import-file` with `data-action`, `import-trust`, `import-confirm`. The test
// with teeth is the trust box: a preview whose code is not ticked must not ask, and Import must
// stay off while code is ticked and the box is not.

import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import ImportPreviewDialog, { actionText, groupTitle, ignoredText, itemText, refusalText } from './ImportPreviewDialog.svelte';
import { t } from '$lib/i18n';
import type { ConfigImportFile, ConfigImportGroup, ConfigImportPreview } from '$lib/platform/commands';

const file = (path: string, action: ConfigImportFile['action'], over: Partial<ConfigImportFile> = {}): ConfigImportFile => ({
  path,
  action,
  bytes: 10,
  items: [],
  notes: [],
  ...over,
});
const group = (id: string, runnable: boolean, ...files: ConfigImportFile[]): ConfigImportGroup => ({ id, runnable, files });
const preview = (over: Partial<ConfigImportPreview> = {}): ConfigImportPreview => ({
  ok: true,
  fingerprint: '0123456789abcdef',
  manifest: { appVersion: '1.2.0', created: '2026-10-27T10:00:00Z', platform: 'macos' },
  groups: [],
  ignored: [],
  ignoredCount: 0,
  refusals: [],
  needsTrust: false,
  keptSettings: [],
  ...over,
});

function html(p: ConfigImportPreview, modal = false): string {
  return render(ImportPreviewDialog, {
    props: {
      preview: p,
      src: '/Users/u/Desktop/shop-config.zip',
      onApply: async () => {},
      ...(modal ? { close: () => {} } : { onCancel: () => {} }),
    },
  }).body;
}

/** The attributes of every element with `data-testid="<id>"`, in order. */
function tags(markup: string, id: string): Record<string, string>[] {
  return [...markup.matchAll(new RegExp(`<[a-z]+[^>]*data-testid="${id}"[^>]*>`, 'g'))].map(([tag]) =>
    Object.fromEntries([...tag.matchAll(/(data-[a-z]+|disabled)(?:="([^"]*)")?/g)].map(([, name, value]) => [name, value ?? ''])),
  );
}

describe('a refused file', () => {
  const p = preview({
    ok: false,
    refusals: [
      { path: 'profiles/../../evil.json', reason: 'parent-dir' },
      { path: '', reason: 'inconsistent' },
    ],
  });

  it('shows the refusals in words and offers no Import', () => {
    const markup = html(p);
    expect(tags(markup, 'import-preview')[0]['data-state']).toBe('refused');
    expect(markup).toContain(t('configuration.preview.refusedTitle'));
    expect(markup).toContain('profiles/../../evil.json');
    expect(markup).toContain(t('configuration.refusal.parentDir'));
    expect(tags(markup, 'import-confirm')).toEqual([]);
    expect(tags(markup, 'import-group')).toEqual([]);
  });

  it('names the whole file when a refusal has no entry', () => {
    expect(refusalText({ path: '', reason: 'not-zip' }, t)).toBe(
      `${t('configuration.preview.wholeFile')}: ${t('configuration.refusal.notZip')}`,
    );
  });
});

describe('a file that can be imported', () => {
  const p = preview({
    groups: [
      group(
        'settings',
        false,
        file('settings.json', 'replace', {
          items: [{ label: 'editor.tabWidth', from: '4', to: '2' }],
          notes: ['scripts.python is not taken from the file; the value on this computer stays'],
        }),
      ),
      group('profiles', false, file('profiles/a.json', 'same')),
      group('scripts', true, file('scripts/x.py', 'new')),
      group('package:shop-a', true, file('packages/shop-a/scripts/y.py', 'new')),
    ],
    ignored: ['readme.txt: outside-layout', 'x.bin: some-new-id'],
    ignoredCount: 3,
    needsTrust: true,
    keptSettings: ['scripts.python'],
  });

  it('lists the groups and files with their test ids', () => {
    const markup = html(p);
    expect(tags(markup, 'import-preview')[0]['data-state']).toBe('ok');
    expect(tags(markup, 'import-group').map((g) => [g['data-group'], g['data-runnable']])).toEqual([
      ['settings', 'false'],
      ['scripts', 'true'],
      ['package:shop-a', 'true'],
      ['profiles', 'false'],
    ]);
    expect(tags(markup, 'import-file').map((f) => [f['data-path'], f['data-action']])).toEqual([
      ['settings.json', 'replace'],
      ['scripts/x.py', 'new'],
      ['packages/shop-a/scripts/y.py', 'new'],
    ]);
    expect(markup).toContain('editor.tabWidth: 4 → 2');
    expect(markup).toContain('Package shop-a');
    expect(markup).toContain('scripts.python');
    expect(markup).toContain('readme.txt: ' + t('configuration.ignored.outsideLayout'));
    expect(markup).toContain('x.bin: some-new-id');
  });

  it('ticks the groups with a change and leaves code unticked, so it does not ask for trust yet', () => {
    const markup = html(p);
    const boxes = [...markup.matchAll(/<input type="checkbox"[^>]*>/g)].map(([tag]) => tag.includes('checked'));
    expect(boxes).toEqual([true, false, false]);
    expect(tags(markup, 'import-trust')).toEqual([]);
    expect('disabled' in tags(markup, 'import-confirm')[0]).toBe(false);
  });

  it('has Import off when nothing would be written', () => {
    const same = preview({ groups: [group('profiles', false, file('profiles/a.json', 'same'))] });
    const markup = html(same);
    expect(markup).toContain(t('configuration.preview.nothingInIt'));
    expect('disabled' in tags(markup, 'import-confirm')[0]).toBe(true);
  });

  it('opens in the dialog frame from the palette', () => {
    expect(html(p, true)).toContain('data-modal="import-preview"');
    expect(html(p)).not.toContain('data-modal=');
  });
});

describe('the words', () => {
  it('word a changed and an added line, an action and a package heading', () => {
    expect(itemText({ label: 'm3', from: null, to: 'New' }, t)).toBe('m3: New (new)');
    expect(itemText({ label: 'm2', from: 'Mill', to: 'Mill 2' }, t)).toBe('m2: Mill → Mill 2');
    expect(actionText(file('a', 'replace'), t)).toBe(t('configuration.action.replace'));
    expect(groupTitle(group('package:shop-a', false), t)).toBe('Package shop-a');
    expect(groupTitle(group('keys', false), t)).toBe(t('configuration.group.keys'));
    expect(ignoredText('scripts/gedit_nc.py: reserved-name', t)).toBe(
      `scripts/gedit_nc.py: ${t('configuration.ignored.reservedName')}`,
    );
  });
});
