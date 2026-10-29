// The helpers of the import dialog, the Rust enum and ids they follow, and the Rust tests rule 36 asks for.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hasKey } from '$lib/i18n';
import {
  CONFIG_REFUSAL_REASONS,
  FIXED_GROUPS,
  IGNORED_REASONS,
  MACHINE_SPECIFIC_KEYS,
  canImport,
  defaultSelection,
  exportFileName,
  parseIgnored,
  selectableGroups,
  toggleGroup,
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

describe('the reasons an entry is left out', () => {
  /** The kebab-case string literals of the Rust module, outside its tests. */
  const rustIds = new Set(
    [...RUST.split('#[cfg(test)]')[0].matchAll(/"([a-z]+(?:-[a-z]+)+)"/g)].map((m) => m[1]),
  );

  it('are the ids configzip.rs uses, each with a message', () => {
    // Every id Rust writes into an `ignored` row is listed (`system-file` is counted, never
    // listed; `kebab-case` is serde's), and every listed id is one Rust writes.
    const notReasons = new Set(['system-file', 'kebab-case']);
    expect([...rustIds].filter((id) => !notReasons.has(id) && !IGNORED_REASONS.includes(id as never))).toEqual([]);
    for (const reason of IGNORED_REASONS) expect(RUST.split('#[cfg(test)]')[0], reason).toContain(`"${reason}"`);
    for (const reason of IGNORED_REASONS) {
      const parsed = parseIgnored(`profiles/a.json: ${reason}`);
      expect(parsed.key, reason).not.toBeNull();
      expect(hasKey(parsed.key ?? ''), reason).toBe(true);
    }
  });

  it('splits a row into the entry and the reason, and keeps a reason it does not know', () => {
    expect(parseIgnored('scripts/gedit_nc.py: reserved-name')).toEqual({
      path: 'scripts/gedit_nc.py',
      reason: 'reserved-name',
      key: 'configuration.ignored.reservedName',
    });
    expect(parseIgnored('a: b: some-new-id')).toEqual({ path: 'a: b', reason: 'some-new-id', key: null });
  });
});

describe('the dialog\'s rules', () => {
  const p = preview(
    group('settings', false, file('settings.json', 'replace')),
    group('profiles', false, file('profiles/a.json', 'same')),
    group('scripts', true, file('scripts/x.py', 'new')),
  );

  it('offers only the groups with a change', () => {
    expect(selectableGroups(p).map((g) => g.id)).toEqual(['settings', 'scripts']);
  });

  it('lets Import go only with something to write, and with the trust box when code is ticked', () => {
    expect(canImport(p, ['settings'], false)).toBe(true);
    expect(canImport(p, ['profiles'], false)).toBe(false);
    expect(canImport(p, [], true)).toBe(false);
    expect(canImport(p, ['settings', 'scripts'], false)).toBe(false);
    expect(canImport(p, ['settings', 'scripts'], true)).toBe(true);
    expect(canImport({ ...p, ok: false }, ['settings'], true)).toBe(false);
  });

  it('keeps the preview\'s order when a group is ticked or unticked', () => {
    expect(toggleGroup(p, ['scripts'], 'settings', true)).toEqual(['settings', 'scripts']);
    expect(toggleGroup(p, ['settings', 'scripts'], 'settings', false)).toEqual(['scripts']);
    expect(toggleGroup(p, ['settings'], 'settings', true)).toEqual(['settings']);
  });

  it('proposes a dated file name', () => {
    expect(exportFileName(new Date(2026, 9, 7))).toBe('gedit-configuration-2026-10-07.zip');
  });
});

describe('the Rust tests the contract asks for (§6.9 rule 36)', () => {
  it.each([
    'every_unsafe_archive_is_refused_whole_and_nothing_is_written',
    'the_files_together_over_32_mib_are_refused',
    'an_archive_that_changed_since_the_preview_writes_nothing',
    'a_failing_write_part_way_puts_back_what_was_written',
    'the_backup_holds_what_was_replaced_and_importing_it_undoes_the_import',
    'when_the_backup_cannot_be_written_nothing_is_imported',
    'scripts_and_package_scripts_need_the_trust_flag_in_rust',
    'settings_are_merged_key_by_key_and_never_take_the_interpreter_or_the_folders',
    'export_then_preview_shows_every_file_as_same',
    'the_round_trip_carries_every_kind_of_file_to_another_computer',
    'an_import_never_deletes_a_file_the_zip_does_not_hold',
    'a_folder_that_is_a_link_is_never_written_into',
    'the_crates_extract_is_never_called',
  ])('%s exists in configzip.rs', (name) => {
    expect(RUST).toContain(`fn ${name}()`);
  });
});
