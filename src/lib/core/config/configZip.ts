// The configuration zip, webview side (Phase 4 plan §6.9 rules 16–36, Q4-23). Written by the P4g
// prelude; P4.36 builds the dialog on it. Pure: the zip itself is read, checked and written by
// Rust (`src-tauri/src/configzip.rs`); this module only helps the preview dialog choose and word
// what Rust found.

import type { ConfigImportGroup, ConfigImportPreview, ConfigRefusalReason } from '$lib/platform/commands';

/** The settings keys an import never takes from a zip and an export never writes (they name places on one computer). */
export const MACHINE_SPECIFIC_KEYS: readonly string[] = ['scripts.python', 'scripts.folders'];

/** The groups that always exist, in the order the preview lists them; a package is `package:<name>`, after these. */
export const FIXED_GROUPS = ['settings', 'keys', 'machines', 'profiles', 'codes', 'scripts'] as const;
export type FixedGroup = (typeof FIXED_GROUPS)[number];

/** Every reason Rust can refuse with, in the order of the enum in `configzip.rs` (a test holds the two together). */
export const CONFIG_REFUSAL_REASONS: readonly ConfigRefusalReason[] = [
  'not-zip',
  'archive-too-big',
  'too-many-entries',
  'name-encoding',
  'name-too-long',
  'too-deep',
  'absolute',
  'backslash',
  'colon',
  'control',
  'parent-dir',
  'empty-segment',
  'bad-segment',
  'duplicate',
  'link',
  'special-file',
  'encrypted',
  'method',
  'too-big',
  'total-too-big',
  'ratio',
  'inconsistent',
  'corrupt',
  'no-manifest',
  'bad-manifest',
  'newer-format',
];

/** The i18n key of a refusal's message: the kebab-case id in camel case (`parent-dir` → `parentDir`), because a key segment is an identifier. */
export function refusalKey(reason: ConfigRefusalReason): string {
  const camel = reason.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
  return `configuration.refusal.${camel}`;
}

/** The package a group id names (`package:shop-a` → `shop-a`), or null for the fixed groups. */
export function packageOfGroup(id: string): string | null {
  return id.startsWith('package:') ? id.slice('package:'.length) : null;
}

/** The i18n key of a group's heading; a package group is worded with its name (`configuration.group.package`). */
export function groupKey(id: string): string {
  return packageOfGroup(id) === null ? `configuration.group.${id}` : 'configuration.group.package';
}

/** Whether a group has anything to write: a new or replaced file. A group of identical files has not. */
export function hasChanges(group: ConfigImportGroup): boolean {
  return group.files.some((file) => file.action !== 'same');
}

/**
 * The groups ticked when the preview opens: every group with a change, except the ones that
 * hold code (scripts, packages with scripts), which start unticked so that running someone's
 * Python is always a choice the user makes (§6.9 rule 31).
 */
export function defaultSelection(preview: ConfigImportPreview): string[] {
  return preview.groups.filter((group) => hasChanges(group) && !group.runnable).map((group) => group.id);
}

/** Whether applying `selected` needs the user's trust: some selected group holds code. */
export function selectionNeedsTrust(preview: ConfigImportPreview, selected: readonly string[]): boolean {
  return preview.groups.some((group) => group.runnable && selected.includes(group.id));
}

/** How many files the selection writes, and how many it leaves because they are identical. */
export function selectionCounts(preview: ConfigImportPreview, selected: readonly string[]): { write: number; same: number } {
  let write = 0;
  let same = 0;
  for (const group of preview.groups) {
    if (!selected.includes(group.id)) continue;
    for (const file of group.files) {
      if (file.action === 'same') same += 1;
      else write += 1;
    }
  }
  return { write, same };
}

// --- P4.36: wording what Rust found ---------------------------------------------------------

/**
 * Every reason `configzip.rs` gives for leaving one entry of a zip out of an import (the preview's
 * `ignored` rows, `"<path>: <reason>"`). The entry costs only itself; the rest is imported. A test
 * holds this list to the ids in the Rust source and to a message each.
 */
export const IGNORED_REASONS = [
  'outside-layout',
  'name-not-allowed',
  'reserved-name',
  'not-json-object',
  'not-text',
  'bad-content',
  'too-many-keys',
  'merged-too-big',
  'newer-file',
  'link-on-the-way',
  'target-link',
  'not-a-file',
  'not-a-folder',
  'unreadable',
  'too-big-on-disk',
] as const;
export type IgnoredReason = (typeof IGNORED_REASONS)[number];

function camel(id: string): string {
  return id.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/** One `ignored` row of the preview split into the entry and the reason; a reason this build does not know stays as Rust wrote it. */
export function parseIgnored(line: string): { path: string; reason: string; key: string | null } {
  const at = line.lastIndexOf(': ');
  const path = at < 0 ? line : line.slice(0, at);
  const reason = at < 0 ? '' : line.slice(at + 2);
  const known = (IGNORED_REASONS as readonly string[]).includes(reason);
  return { path, reason, key: known ? `configuration.ignored.${camel(reason)}` : null };
}

/** The name the save dialog proposes: `gedit-configuration-2026-10-27.zip` (local date). */
export function exportFileName(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `gedit-configuration-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.zip`;
}

/** The selectable groups: the ones with a change. A group whose files are all the same has nothing to import. */
export function selectableGroups(preview: ConfigImportPreview): ConfigImportGroup[] {
  return preview.groups.filter(hasChanges);
}

/**
 * Whether Import may be pressed: the preview is not refused, something ticked would be written,
 * and when a ticked group holds code the user ticked "I trust this file" (Rust checks it again).
 */
export function canImport(preview: ConfigImportPreview, selected: readonly string[], trusted: boolean): boolean {
  if (!preview.ok) return false;
  if (selectionCounts(preview, selected).write === 0) return false;
  return trusted || !selectionNeedsTrust(preview, selected);
}

/** Adds or removes `id` from the selection, keeping the preview's order. */
export function toggleGroup(preview: ConfigImportPreview, selected: readonly string[], id: string, on: boolean): string[] {
  const set = new Set(selected);
  if (on) set.add(id);
  else set.delete(id);
  return preview.groups.map((group) => group.id).filter((groupId) => set.has(groupId));
}
