// The file names of a channel set when it is written to disk (Phase 4, plan section 6.8).
// Written by the P4f prelude as a **stub**; implemented by **P4.31**.
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

import type { ChannelParams, ChannelRef } from './types';

/** N1 to N4: the proposed file name of `channel`'s document, or null. */
export function channelFileName(_stem: string, _channel: ChannelRef, _p: ChannelParams): string | null {
  throw new Error('not built yet (P4.31)');
}
