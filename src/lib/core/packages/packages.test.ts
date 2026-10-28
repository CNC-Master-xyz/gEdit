// The package rules of §6.9 shared with Rust, and the rows P4.35 turns into tests.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LAYER_ORDER,
  byteOrder,
  isPackageDisabled,
  layerSorted,
  packageTitle,
  withPackageEnabled,
  MAX_PACKAGES,
  PACKAGES_DISABLED_KEY,
  PACKAGE_ROOT_PREFIX,
  isPackageName,
  packageOfRoot,
  packageOfScriptId,
  packageRoot,
} from './packages';

const RUST = readFileSync(fileURLToPath(new URL('../../../../src-tauri/src/packages.rs', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

describe('the package name', () => {
  it('accepts what a user file stem accepts', () => {
    for (const good of ['shop', 'shop-a', 'a.b_c-1', '0abc', 'a'.repeat(64)]) expect(isPackageName(good), good).toBe(true);
  });

  it('refuses everything else, as the Rust rule does', () => {
    for (const bad of ['', 'Shop', '-shop', '.hidden', 'my shop', 'shop:a', 'shop/a', 'shöp', 'shop.', 'con', 'nul', 'com1', 'lpt2', 'a'.repeat(65)]) {
      expect(isPackageName(bad), bad).toBe(false);
    }
  });
});

describe('the script root of a package', () => {
  it('is pkg-<name>, and only that is a package root', () => {
    expect(packageRoot('shop-a')).toBe('pkg-shop-a');
    expect(packageOfRoot('pkg-shop-a')).toBe('shop-a');
    for (const other of ['bundled', 'user', 'extra0', 'pkg-', 'pkg-Shop', 'pkg-a:b', 'package-a']) expect(packageOfRoot(other), other).toBeNull();
  });

  it('is read from a script id', () => {
    expect(packageOfScriptId('pkg-shop-a:finish/chamfer.py')).toBe('shop-a');
    expect(packageOfScriptId('pkg-shop-a:facing.py')).toBe('shop-a');
    expect(packageOfScriptId('user:facing.py')).toBeNull();
    expect(packageOfScriptId('nocolon')).toBeNull();
  });
});

describe('the constants Rust shares', () => {
  it('are the same numbers and names', () => {
    expect(MAX_PACKAGES).toBe(32);
    expect(RUST).toContain(`pub const MAX_PACKAGES: usize = ${MAX_PACKAGES};`);
    expect(RUST).toContain(`pub const ROOT_PREFIX: &str = "${PACKAGE_ROOT_PREFIX}";`);
    expect(RUST).toContain(`pub const KEY_PACKAGES_DISABLED: &str = "${PACKAGES_DISABLED_KEY}";`);
  });

  it('put the packages between the built-ins and the user’s own files', () => {
    expect([...LAYER_ORDER]).toEqual(['builtin', 'package', 'user']);
  });
});

describe('the order the registries read the files in', () => {
  it('puts every package\'s files first, packages by folder name and files by name, the user\'s own last', () => {
    const files = [
      { name: 'mine.json' },
      { name: 'z.json', package: 'shop-b' },
      { name: 'a.json', package: 'shop-b' },
      { name: 'b.json', package: 'shop-a' },
      { name: 'a.json' },
    ];
    expect(layerSorted(files).map((f) => `${f.package ?? ''}/${f.name}`)).toEqual([
      'shop-a/b.json',
      'shop-b/a.json',
      'shop-b/z.json',
      '/a.json',
      '/mine.json',
    ]);
    // The input is not touched.
    expect(files[0].name).toBe('mine.json');
  });

  it('is bytewise, as Rust is', () => {
    expect(byteOrder('B', 'a')).toBe(-1);
    expect(byteOrder('a', 'a')).toBe(0);
    expect(layerSorted([{ name: 'a' }, { name: 'B' }]).map((f) => f.name)).toEqual(['B', 'a']);
  });
});

describe('switching a package on and off', () => {
  it('adds the name when it is switched off and removes it when it is switched on', () => {
    expect(withPackageEnabled([], 'shop-a', false)).toEqual(['shop-a']);
    expect(withPackageEnabled(['shop-a'], 'shop-a', false)).toEqual(['shop-a']);
    expect(withPackageEnabled(['shop-a', 'shop-b'], 'shop-a', true)).toEqual(['shop-b']);
    expect(withPackageEnabled(['shop-b'], 'shop-a', true)).toEqual(['shop-b']);
  });

  it('keeps a name whose folder is gone, and the order, and does not touch its input', () => {
    const before = ['gone', 'shop-b'];
    expect(withPackageEnabled(before, 'shop-a', false)).toEqual(['gone', 'shop-b', 'shop-a']);
    expect(withPackageEnabled(before, 'shop-b', true)).toEqual(['gone']);
    expect(before).toEqual(['gone', 'shop-b']);
  });

  it('asks whether a package is off', () => {
    expect(isPackageDisabled(['shop-a'], 'shop-a')).toBe(true);
    expect(isPackageDisabled(['shop-a'], 'shop-b')).toBe(false);
  });

  it('shows the display name, or the folder name when there is none', () => {
    const titles = new Map([['shop-a', 'Shop A'], ['shop-b', '  ']]);
    expect(packageTitle(titles, 'shop-a')).toBe('Shop A');
    expect(packageTitle(titles, 'shop-b')).toBe('shop-b');
    expect(packageTitle(titles, 'shop-c')).toBe('shop-c');
  });
});

// The rows of the P4.35 contract that Rust answers are tests in `src-tauri/src/packages.rs`,
// `scripts/discovery.rs`, `scripts/settings.rs` and `userfiles.rs`; this keeps the list visible
// from the webview side, so a renamed or removed test is noticed.
describe('the Rust side has a test for each rule', () => {
  const DISCOVERY = readFileSync(
    fileURLToPath(new URL('../../../../src-tauri/src/scripts/discovery.rs', import.meta.url)),
    'utf8',
  );
  const SETTINGS = readFileSync(
    fileURLToPath(new URL('../../../../src-tauri/src/scripts/settings.rs', import.meta.url)),
    'utf8',
  );

  it('packages.rs: the walks, the links, the 33rd folder, the caps and the switch', () => {
    for (const name of [
      'packages_list_by_name_with_manifest_and_counts',
      'a_folder_that_is_not_a_package_name_is_listed_with_the_reason_and_not_read',
      'the_33rd_folder_is_a_problem_and_not_read',
      'a_package_folder_that_is_a_link_is_listed_with_an_error_and_not_followed',
      'a_link_inside_a_package_is_not_followed',
      'files_are_listed_packages_by_name_then_files_by_name_and_failures_are_kept',
      'a_file_over_one_mebibyte_and_the_65th_file_are_refused_as_for_the_users_own',
      'the_cap_over_all_packages_is_32_mebibytes_and_a_file_past_it_is_listed_unread',
      'a_switched_off_package_is_listed_and_contributes_nothing',
    ]) {
      expect(RUST, name).toContain(`fn ${name}()`);
    }
  });

  it('discovery.rs: the roots, the shadowing, the copy, the links and the cap', () => {
    for (const name of [
      'package_roots_sit_between_bundled_and_user_by_name_and_are_not_editable',
      'user_scripts_beat_a_package_and_a_later_package_beats_an_earlier_one',
      'a_package_script_resolves_but_is_not_editable_and_the_copy_shadows_it',
      'a_disabled_package_has_no_root',
      'a_link_inside_a_package_is_neither_listed_nor_resolved',
      'a_package_scripts_folder_that_is_a_link_gets_no_root_and_does_not_resolve',
      'the_headers_of_all_packages_together_are_read_under_the_cap',
    ]) {
      expect(DISCOVERY, name).toContain(`fn ${name}()`);
    }
  });

  it('settings.rs: packages.disabled is read with the other keys', () => {
    expect(SETTINGS).toContain('fn reads_the_switched_off_packages()');
  });
});
