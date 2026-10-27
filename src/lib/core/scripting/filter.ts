// Which scripts are offered, and in what order (plan §5 WP5.1 step 1, §5 WP5.2 "grouped
// by folder, filtered by profile").
//
// *Suggested shape*, not a §7 contract: it is here because **two** work packages need the
// same answer and must not disagree. WP5.2 builds the Tools ribbon group and the
// `script.run:<id>` commands from it; WP5.1 uses the same filter before it runs one, so a
// script that is hidden for the active profile cannot be reached through the palette
// either. Change it inside WP5.1 and say so in the hand-off.
//
// Discovery, shadowing and the `scripts.showBundled` setting are Rust's (AD-8, AD-13):
// `scripts_list` has already applied them. What is left here is the profile filter and the
// menu shape.
//
// The rules, all of which err towards *showing* a script — hiding one the user wrote is a
// bug report, showing one that does not fit is a run that says so:
//
//  - `shadowed: true` is dropped. It is unreachable by id.
//  - `meta === null` (no header, or an unusable one) is offered for every profile: v1
//    scripts predate the field.
//  - `meta.profiles === null` means "every profile" (an omitted key in the header).
//  - Otherwise the active profile id must be in `meta.profiles`, compared exactly.
//  - `profileId === null` (no document open) hides nothing; the command's own `enabled`
//    decides whether it can run.
//
// WP5.1 kept all five and added nothing. `scriptsForProfile` is deliberately the only
// gate: `ScriptService.run` calls it on the one entry it is about to run, so the ribbon,
// the palette, `script.run:<id>` and `script.runLast` all pass through the same sentence.
// A `runLast` of a script that fits another profile is therefore refused with a reason
// rather than run against a program it was never written for.

import { packageOfRoot } from '$lib/core/packages/packages';
import type { ScriptEntry } from '$lib/platform/commands';

/** One menu section: the scripts of one subfolder, or of the root. */
export interface ScriptGroup {
  /** The subfolder name, or null for the scripts that sit directly in a root. */
  group: string | null;
  /**
   * P4g (§6.9 rule 10): the folder name of the script package the section belongs to; unset for the
   * scripts of `bundled`, `user` and the extra folders. A package's scripts are never in a section
   * with another root's, so the menu can show them under the package's display name.
   */
  package?: string;
  scripts: ScriptEntry[];
}

/** Whether `entry` is offered while `profileId` is the active dialect. */
export function fitsProfile(entry: ScriptEntry, profileId: string | null): boolean {
  if (entry.shadowed) return false;
  const wanted = entry.meta?.profiles;
  if (wanted === undefined || wanted === null) return true;
  if (profileId === null) return true;
  return wanted.includes(profileId);
}

/** The scripts offered for `profileId`, in the order `scripts_list` gave them. */
export function scriptsForProfile(
  entries: readonly ScriptEntry[],
  profileId: string | null,
): ScriptEntry[] {
  return entries.filter((entry) => fitsProfile(entry, profileId));
}

/**
 * The same scripts as menu sections: the ungrouped ones first, then one section per
 * subfolder. Within a section the order is `scripts_list`'s.
 *
 * The sections follow the order their first script appears in, rather than an alphabetical
 * one, so the menu mirrors what the backend listed — bundled scripts first, then the packages
 * by name, then the user folder, then the extra folders — and a rescan cannot reshuffle it.
 * The scripts of a package are sections of their own (`ScriptGroup.package`), one per package
 * and subfolder, after the ungrouped section of everything else.
 */
export function groupScripts(entries: readonly ScriptEntry[]): ScriptGroup[] {
  const sections = new Map<string, ScriptGroup>();
  const sectionOf = (pkg: string | null, group: string | null): ScriptGroup => {
    const key = `${pkg ?? ''}\u0000${group ?? ''}`;
    let section = sections.get(key);
    if (section === undefined) {
      section = { group, ...(pkg === null ? {} : { package: pkg }), scripts: [] };
      sections.set(key, section);
    }
    return section;
  };
  // The ungrouped section always comes first, even when every script sits in a subfolder:
  // an empty one is dropped again below.
  sectionOf(null, null);

  for (const entry of entries) {
    sectionOf(packageOfRoot(entry.root), entry.group === null || entry.group === '' ? null : entry.group).scripts.push(entry);
  }

  return [...sections.values()].filter((section) => section.scripts.length > 0);
}

/** The display name of a script: its header `name`, or the file name. Data, untranslated. */
export function scriptLabel(entry: ScriptEntry): string {
  const name = entry.meta?.name.trim() ?? '';
  return name === '' ? entry.fileName : name;
}
