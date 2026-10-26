// Icon typing for contributions. Owner: integration (I1); see the mergeA hand-off note.
//
// `CommandDef.icon`, `PanelDef.icon` and the component fields in §7.1 are Svelte 5
// `Component`s. lucide-svelte 1.0.1 still ships Svelte 4 typings - every icon is declared
// as `class X extends SvelteComponentTyped<…>` (`NM/lucide-svelte/dist/icons/*.svelte.d.ts`)
// - so `icon: Command` is a type error even though the component renders fine. Rather than
// let every contribution carry its own cast, or widen the contract to a union that the
// ribbon then has to render, the cast lives here once and the contract stays `Component`.
//
// Delete `asIcon` (and this file) when lucide-svelte ships Svelte 5 typings: the fix is
// then to drop the call, not to change `app/types.ts`.
//
// Checked again for v1.2.0 (T217): `lucide-svelte` is still at 1.0.1 on its `latest` tag
// (the only newer builds are a 1.0.0 release candidate and old betas), with the same
// Svelte 4 declarations, so the cast stays. The Svelte 5 icons live in a different
// package, `@lucide/svelte`; moving to it would change every icon import in the app, so
// it is its own piece of work and not part of this cast.

import type { Component } from 'svelte';

/** A Svelte 4 class component, which is what lucide-svelte 1.0.1 declares. */
type LegacyComponent = new (...args: never[]) => unknown;

/**
 * An icon component, typed as the registries expect it.
 *
 * ```ts
 * import Save from 'lucide-svelte/icons/save';   // the deep path, not the barrel
 * import { asIcon } from '$lib/app/icons';
 *
 * { id: 'file.save', title: 'files.save', icon: asIcon(Save), run: … }
 * ```
 *
 * Import icons from `lucide-svelte/icons/<name>`. The `lucide-svelte` barrel pulls in
 * every icon and costs seconds of vite transform in each test file that reaches a
 * contribution (WP1.1 §5).
 */
export function asIcon(icon: Component<never> | LegacyComponent): Component {
  return icon as unknown as Component;
}
