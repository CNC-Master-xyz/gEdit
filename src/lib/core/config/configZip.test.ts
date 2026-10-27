// The helpers of the import dialog, the Rust enum they follow, and the rows P4.36 turns into tests.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hasKey } from '$lib/i18n';
import {
  CONFIG_REFUSAL_REASONS,
  FIXED_GROUPS,
  MACHINE_SPECIFIC_KEYS,
  defaultSelection,
  groupKey,
  hasChanges,
  packageOfGroup,
  refusalKey,
  selectionCounts,
  selectionNeedsTrust,
} from './configZip';
import type { ConfigImportFile, ConfigImportGroup, ConfigImportPreview } from '$lib/platform/commands';

const RUST = readFileSync(fileURLToPath(new URL('../../../../src-tauri/src/configzip.rs', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

const file = (path: string, action: ConfigImportFile['action']): ConfigImportFile => ({ path, action, bytes: 10, items: [], notes: [] });
const group = (id: string, runnable: boolean, ...files: ConfigImportFile[]): ConfigImportGroup => ({ id, runnable, files });
const preview = (...groups: ConfigImportGroup[]): ConfigImportPreview => ({
  ok: true,
  fingerprint: '0123456789abcdef',
  manifest: { appVersion: '1.2.0', created: '2026-10-27T10:00:00Z', platform: 'macos' },
  groups,
  ignored: [],
  ignoredCount: 0,
  refusals: [],
  needsTrust: groups.some((g) => g.runnable),
  keptSettings: [],
});

/** `FooBar` → `foo-bar`, as serde's kebab-case does for the enum variants. */
const kebab = (name: string): string => name.replace(/[A-Z]/g, (c, i) => (i === 0 ? '' : '-') + c.toLowerCase());

/** The variants of `pub enum <name> { … }` in configzip.rs, in order. */
function variantsOf(name: string): string[] {
  const start = RUST.indexOf(`pub enum ${name} {`);
  expect(start, `enum ${name} in configzip.rs`).toBeGreaterThan(-1);
  const body = RUST.slice(start, RUST.indexOf('\n}\n', start));
  return [...body.matchAll(/^    ([A-Z][A-Za-z]*),?$/gm)].map((m) => m[1]);
}

describe('the refusal reasons', () => {
  it('are the variants of the Rust enum, in order, in kebab case', () => {
    expect(CONFIG_REFUSAL_REASONS).toEqual(variantsOf('RefusalReason').map(kebab));
  });

  it('each have a message', () => {
    for (const reason of CONFIG_REFUSAL_REASONS) expect(hasKey(refusalKey(reason)), reason).toBe(true);
  });

  it('the groups have headings', () => {
    for (const id of FIXED_GROUPS) expect(hasKey(groupKey(id)), id).toBe(true);
    expect(hasKey(groupKey('package:shop-a'))).toBe(true);
  });
});

describe('the numbers and names Rust shares', () => {
  it('are the same', () => {
    expect(MACHINE_SPECIFIC_KEYS).toEqual(['scripts.python', 'scripts.folders']);
    expect(RUST).toContain('pub const MACHINE_SPECIFIC_KEYS: [&str; 2] = ["scripts.python", "scripts.folders"];');
    expect(RUST).toContain('pub const MANIFEST_NAME: &str = "gedit-config.json";');
  });
});

describe('the selection', () => {
  const p = preview(
    group('settings', false, file('settings.json', 'replace')),
    group('profiles', false, file('profiles/a.json', 'same'), file('profiles/b.json', 'same')),
    group('codes', false, file('codes/a.json', 'new'), file('codes/b.json', 'same')),
    group('scripts', true, file('scripts/x.py', 'new')),
    group('package:shop', true, file('packages/shop/scripts/y.py', 'new')),
  );

  it('ticks the groups with a change and leaves code unticked', () => {
    expect(defaultSelection(p)).toEqual(['settings', 'codes']);
    expect(hasChanges(p.groups[1])).toBe(false);
  });

  it('needs trust exactly when a ticked group holds code', () => {
    expect(selectionNeedsTrust(p, ['settings', 'codes'])).toBe(false);
    expect(selectionNeedsTrust(p, ['settings', 'scripts'])).toBe(true);
    expect(selectionNeedsTrust(p, ['package:shop'])).toBe(true);
    expect(selectionNeedsTrust(p, [])).toBe(false);
  });

  it('counts what is written and what is left because it is identical', () => {
    expect(selectionCounts(p, ['settings', 'profiles', 'codes'])).toEqual({ write: 2, same: 3 });
    expect(selectionCounts(p, [])).toEqual({ write: 0, same: 0 });
  });

  it('reads a package from its group id', () => {
    expect(packageOfGroup('package:shop-a')).toBe('shop-a');
    expect(packageOfGroup('scripts')).toBeNull();
  });
});

describe('P4.36', () => {
  it.todo('Rust: export writes the manifest first, then settings (without the machine-specific keys), keybindings, machines, profiles, codes, scripts and packages');
  it.todo('Rust: export skips a file over the caps or outside the rules and lists it; exporting then previewing the result shows every file as same');
  it.todo('Rust: preview of a zip with a ..-name, an absolute name, a symlink, an encrypted entry or a bomb is refused whole and lists each entry');
  it.todo('Rust: preview ignores entries outside the layout and lists them; __MACOSX and .DS_Store are counted, not listed');
  it.todo('Rust: preview and apply of a settings.json that holds scripts.python or scripts.folders keep the user’s values and say so');
  it.todo('Rust: apply with a changed archive (fingerprint differs) writes nothing');
  it.todo('Rust: apply writes a backup zip of everything it replaces first; when the backup cannot be written nothing is imported');
  it.todo('Rust: apply of a runnable group without acceptScripts is refused');
  it.todo('Rust: a failure part-way restores the files already replaced and says so');
  it.todo('Rust: import never deletes a file the zip does not hold');
  it.todo('app: the dialog lists groups and files with new / replace / same, the settings keys and machines that change, and the trust box for code');
  it.todo('app: after an import the settings, keys, machines, user files and scripts are loaded again without a restart');
});
