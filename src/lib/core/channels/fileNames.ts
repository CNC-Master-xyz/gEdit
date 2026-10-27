// The file names of a channel set when it is written to disk (Phase 4, plan section 6.8).
// Written by the P4f prelude; implemented by **P4.31**.
//
// "Split into Channel Documents" makes one untitled document per channel; "Save Channel Files"
// proposes each its name in the source's folder. Rules, binding:
//
//  N1. The name comes from the machine's own rules, in the order `siblingNames` uses them: the
//      channel's `list[].fileName` template, then the shared `fileNameFor`, each filled with
//      `fillTemplate(template, stem, channel.id)`. With neither, the name is the split's own
//      default (`channels.split.name`: the title, then the channel's name). A name is never
//      derived by replacing a capture of the `fileName` pattern: with no existing file there is
//      nothing to replace in.
//  N2. `stem` is the source document's title without its last extension. The extension of a
//      template-less name is the source's.
//  N3. A name that is not a plain file name (`plainName`) is `null`; the caller then uses the
//      default of N1 and says so.
//  N4. Two channels that get the same name get `null` for both (a template without
//      `{{channel}}`): refuse rather than overwrite one with the other.

import { channelRefs } from './resolve';
import { fillTemplate } from './siblings';
import type { ChannelParams, ChannelRef } from './types';

/** N2: a title without its last extension (`PART.MPF` is `PART`); a name that only starts with a dot keeps it. */
export function stemOf(title: string): string {
  const dot = title.lastIndexOf('.');
  return dot > 0 ? title.slice(0, dot) : title;
}

/** N2: the extension of a title with its dot (`.MPF`), or ''. */
export function extensionOf(title: string): string {
  const dot = title.lastIndexOf('.');
  return dot > 0 ? title.slice(dot) : '';
}

/** N3: a plain file name, with no folder part and no character a file name cannot hold. */
function plainName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !/[/\\:*?"<>|\u0000-\u001f]/.test(name);
}

/** N1 and N3: the name one channel's template gives, or null (no template, or not a plain name). */
function templateName(stem: string, channel: ChannelRef, p: ChannelParams): string | null {
  const own = Array.isArray(p.list) ? p.list.find((c) => c?.id === channel.id)?.fileName : undefined;
  const template = typeof own === 'string' && own !== '' ? own : typeof p.fileNameFor === 'string' && p.fileNameFor !== '' ? p.fileNameFor : null;
  if (template === null) return null;
  const name = fillTemplate(template, stem, channel.id);
  return plainName(name) ? name : null;
}

/**
 * N1 to N4: the proposed file name of `channel`'s document, or null (the caller then proposes
 * the split's default name and says so). Names are compared without regard to case, as the
 * documents store does on macOS and Windows.
 */
export function channelFileName(stem: string, channel: ChannelRef, p: ChannelParams): string | null {
  const name = templateName(stem, channel, p);
  if (name === null) return null;
  const same = name.toLowerCase();
  for (const other of channelRefs(p)) {
    if (other.id === channel.id) continue;
    if (templateName(stem, other, p)?.toLowerCase() === same) return null;
  }
  return name;
}
