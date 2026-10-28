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

/** Bytewise, so the order is the same on every platform and in every language (as in Rust). */
export function byteOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A file of a package or of the user's own folder, as `userConfig` hands it to the registries. */
export interface LayeredFile {
  name: string;
  /** The package folder the file comes from; unset for the user's own file. */
  package?: string;
}

/**
 * The files in the order the registries read them (§6.9 rule 11): every package's files first,
 * packages by folder name and files by name, then the user's own files by name. A later file
 * wins where two define one thing; of two with one id the first one loads.
 */
export function layerSorted<T extends LayeredFile>(files: readonly T[]): T[] {
  return [...files].sort((a, b) => {
    if ((a.package === undefined) !== (b.package === undefined)) return a.package === undefined ? 1 : -1;
    return byteOrder(a.package ?? '', b.package ?? '') || byteOrder(a.name, b.name);
  });
}

/**
 * The new value of `packages.disabled` after `name` is switched on or off. A name whose folder
 * is gone stays in the list (the folder may come back); the order is kept.
 */
export function withPackageEnabled(disabled: readonly string[], name: string, enabled: boolean): string[] {
  if (enabled) return disabled.filter((entry) => entry !== name);
  return disabled.includes(name) ? [...disabled] : [...disabled, name];
}

/** Whether `name` is switched off by the setting's value. */
export function isPackageDisabled(disabled: readonly string[], name: string): boolean {
  return disabled.includes(name);
}

/**
 * The name a package is shown under: the `name` of its `package.json`, or the folder name.
 * `titles` is folder name → display name as `packages_list` answered it.
 */
export function packageTitle(titles: ReadonlyMap<string, string>, name: string): string {
  const title = titles.get(name);
  return title === undefined || title.trim() === '' ? name : title;
}
