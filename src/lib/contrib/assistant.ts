// The code assistant: hover help and completion (plan §5 WP3.6). Owner: WP3.6.
// One feature per file (plan AD-3); see ./README.md.
//
// No command and no shortcut: both features are Monaco providers that answer while the
// user types or points, and both are switched with `assist.hover` and `assist.completion`
// in the settings dialog (§7.7). Adding a keybinding here would only collide with the
// ones §7.11 already assigns.
//
// A provider is registered per profile, because the Monaco language id *is* the profile
// id: a dialect brings its own database (`profile.codes`), so the hover on the same word
// says something different in a Fanuc and in a Klartext document.
//
// About README rule 10 ("no Monaco import at module level"): nothing here imports
// `$lib/monaco/core`. `getMonaco()` is the lazy loader itself, and it is only called
// after `editor.ready`, so this file adds nothing to the initial bundle and asks for
// Monaco only once the editor has it. Registration is therefore late, which is safe: a
// hover or a suggestion can only be asked for through an editor that exists.

import { editor } from '$lib/monaco/editorService';
import { registerCompletion } from '$lib/monaco/providers/completion';
import { registerHover } from '$lib/monaco/providers/hover';
import { getMonaco } from '$lib/monaco/setup';
import { profiles } from '$lib/stores/profiles';
import type { Contribution, Disposable } from '$lib/app/types';

export default {
  id: 'assistant',
  activate(): Disposable {
    let stopped = false;
    const registrations: Disposable[] = [];

    // Whether Enter accepts a suggestion is the setting `assist.acceptOnEnter` (off by
    // default: Enter ends a block, Tab accepts), mapped onto the editor with the other
    // settings in `monaco/editorOptions.ts` (T214). Monaco's own default (`on`) hands Enter
    // to the suggest widget whenever it is open, which is for most of an NC block: typing
    // `M6` offers M6, and the Enter behind it would be swallowed.

    void (async () => {
      await editor.ready;
      const monaco = await getMonaco();
      if (stopped) return;
      // One pair per profile id, once. A reload (AD-29, `profiles.revision`) can add ids; one
      // it removes keeps its providers, which nothing can ask any more.
      const have = new Set<string>();
      const sync = (): void => {
        for (const profile of profiles.list()) {
          if (have.has(profile.id)) continue;
          have.add(profile.id);
          registrations.push(registerHover(monaco, profile.id), registerCompletion(monaco, profile.id));
        }
      };
      sync();
      registrations.push(profiles.revision.subscribe(sync));
    })().catch(() => {
      // `editor.ready` never rejects, and a Monaco that cannot be loaded is already
      // reported by EditorHost (and leaves `data-ready` at "0"). A second message here
      // would only be noise — and a console error fails the runtime harness.
    });

    return () => {
      stopped = true;
      for (const dispose of registrations) dispose();
      registrations.length = 0;
    };
  },
} satisfies Contribution;
