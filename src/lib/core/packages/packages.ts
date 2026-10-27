// Script packages (Phase 4 plan §6.9 rules 7–15, AD-56). Written by the P4g prelude; P4.35 builds
// the layer on it. Pure (`core/`): the rules the webview shares with `src-tauri/src/packages.rs`.
//
// A package is a folder `<config>/packages/<name>/` with `scripts/`, `profiles/`, `codes/` and a
// small `package.json`. It sits between the built-ins and the user's own files; the setting
// `packages.disabled` lists the switched-off ones by folder name.

/** The setting that lists the switched-off packages. Read by Rust from `settings.json` as well. */
export const PACKAGES_DISABLED_KEY = 'packages.disabled';

/** The prefix of a package's script root: its scripts have ids like `pkg-shop-a:finish/chamfer.py`. */
export const PACKAGE_ROOT_PREFIX = 'pkg-';

/** The most package folders listed. Must match `MAX_PACKAGES` in `src-tauri/src/packages.rs`. */
export const MAX_PACKAGES = 32;

/** The manifest of a package. */
export const PACKAGE_MANIFEST = 'package.json';

const DEVICE_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * Whether `name` can be a package folder: `^[a-z0-9][a-z0-9._-]{0,63}$`, no trailing dot, not a DOS
 * device name. The twin of `validate_package_name` in `src-tauri/src/packages.rs`.
 */
export function isPackageName(name: string): boolean {
  return NAME.test(name) && !name.endsWith('.') && !DEVICE_NAME.test(name);
}

/** The script root of package `name`. */
export function packageRoot(name: string): string {
  return `${PACKAGE_ROOT_PREFIX}${name}`;
}

/** The package a script root belongs to, or null for `bundled`, `user`, `extra<N>` and anything else. */
export function packageOfRoot(root: string): string | null {
  if (!root.startsWith(PACKAGE_ROOT_PREFIX)) return null;
  const name = root.slice(PACKAGE_ROOT_PREFIX.length);
  return isPackageName(name) ? name : null;
}

/** The package a script id (`pkg-shop-a:finish/chamfer.py`) belongs to, or null. */
export function packageOfScriptId(scriptId: string): string | null {
  const colon = scriptId.indexOf(':');
  return colon < 0 ? null : packageOfRoot(scriptId.slice(0, colon));
}

/**
 * The layers a user file can come from, lowest first: the built-ins, the packages (by folder
 * name, A to Z), the user's own files. A later layer wins where two define one thing (§6.9 rule 11).
 */
export const LAYER_ORDER = ['builtin', 'package', 'user'] as const;
export type Layer = (typeof LAYER_ORDER)[number];
