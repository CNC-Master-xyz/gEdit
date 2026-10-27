// The package rules of §6.9 shared with Rust, and the rows P4.35 turns into tests.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LAYER_ORDER,
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

describe('P4.35', () => {
  it.todo('Rust: packages_list lists the folders by name, a link and a bad name with an error, the 33rd as a problem');
  it.todo('Rust: a package’s profile and code files are read under the user-file limits (64 files, 1 MiB, UTF-8, no link followed)');
  it.todo('Rust: the total read over all packages stops at 32 MiB and lists the rest unread with the cap error');
  it.todo('Rust: a disabled package is listed with enabled false and contributes no script root and no file');
  it.todo('Rust: discovery lists the package roots between bundled and user; a user script shadows a package script of the same name');
  it.todo('Rust: a package script is not editable, script_source_path refuses it, script_copy_to_user copies it');
  it.todo('app: userConfig lays package files under the user’s files; a user profile with a package profile’s id replaces it with a notice');
  it.todo('app: switching a package off and rescanning removes its scripts, profiles and codes without a restart');
});
