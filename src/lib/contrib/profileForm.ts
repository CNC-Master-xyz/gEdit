// "Edit Profile in Form" (Phase 4 plan §6.10 rule 7, AD-57; P4.40). One feature per file (plan
// AD-3); see ./README.md.
//
//   profile.editInForm   the form of a profile file: the profile of the active program when it is a
//                        profile of yours, a built-in one read-only; or `{ name }`, one of your
//                        files (what the Profiles page passes)
//
// No default key: it is rare, and the page and the palette are the ways in. The model is
// `app/profileForm.ts` (no Monaco, no store, no Tauri); this file wires it to the real services:
//
//   - the text of a file:      `user_files_list`, `user_file_path` (no new command);
//   - changing and saving it:  the file's document, through `files.open` and `files.save`, so the
//                              backup, the external-change check and the reload on save (M13) all
//                              apply and the change can be undone in the tab (AD-40);
//   - the check of the draft:  `validateProfile` on the draft merged over its parent, with the
//                              options the registry loads a profile with.
//
// The Settings dialog is a modal, and a modal cannot open over it: the Profiles page shows the same
// form inline (it asks for `realProfileForm()` here), and this command opens the dialog.

import FilePen from 'lucide-svelte/icons/file-pen';
import ProfileFormDialog from '$lib/components/dialogs/ProfileFormDialog.svelte';
import { asIcon } from '$lib/app/icons';
import { dialogs } from '$lib/app/dialogs';
import { files } from '$lib/app/fileOps';
import { lockRefusal } from '$lib/app/readOnlyLock';
import { modals } from '$lib/app/modals';
import { createProfileForm, profileSchema, type ProfileFormDeps, type ProfileFormModel, type ProfileFormTarget } from '$lib/app/profileForm';
import { commands } from '$lib/app/registry/commands';
import { status } from '$lib/app/status';
import { userConfig } from '$lib/app/userConfig';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { modalGroupsOf } from '$lib/core/codes/resolve';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_SOURCES } from '$lib/data/profiles';
import { editor } from '$lib/monaco/editorService';
import { userFilePath, userFilesList } from '$lib/platform/commands';
import { codes } from '$lib/stores/codes';
import { docs } from '$lib/stores/documents';
import { profiles } from '$lib/stores/profiles';
import { t } from '$lib/i18n';
import type { Contribution, Msg } from '$lib/app/types';
import type { Profile } from '$lib/core/profiles/types';

function recordOf(arg: unknown): Record<string, unknown> {
  return typeof arg === 'object' && arg !== null ? (arg as Record<string, unknown>) : {};
}

/** Every string of the built-in profiles' JSON: a pattern that is one of these is the shipped one (as the registry holds it). */
let builtinTexts: Set<string> | undefined;
function builtinTextSet(): Set<string> {
  if (builtinTexts !== undefined) return builtinTexts;
  const out = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string') out.add(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (typeof value === 'object' && value !== null) Object.values(value).forEach(visit);
  };
  for (const source of BUILTIN_PROFILE_SOURCES) visit(source.raw);
  builtinTexts = out;
  return out;
}

/** Every string a file writes itself: the patterns the shape check of `validateProfile` applies to. */
function stringsOf(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === 'string') into.add(value);
  else if (Array.isArray(value)) value.forEach((entry) => stringsOf(entry, into));
  else if (typeof value === 'object' && value !== null) Object.values(value).forEach((entry) => stringsOf(entry, into));
  return into;
}

function codeFilesNow(): Record<string, unknown> {
  try {
    return codes.files();
  } catch {
    return BUILTIN_CODE_DB_JSON;
  }
}

/** The draft as the registry would check it at load: `validateProfile` with the same options, then the compiler. */
function check(merged: Record<string, unknown>, own: Record<string, unknown>): { errors: string[] } | { profile: Profile } {
  const files = codeFilesNow();
  const written = stringsOf(own);
  const checked = validateProfile(merged, {
    codeDbs: Object.keys(files),
    modalGroups: typeof merged.codes === 'string' && Object.hasOwn(files, merged.codes) ? modalGroupsOf(files, merged.codes) : undefined,
    // The patterns the file wrote itself are held to the shape rule; the shipped ones it inherits are not.
    checkShape: (source) => written.has(source) && !builtinTextSet().has(source),
  });
  if (!checked.ok) return { errors: checked.errors };
  try {
    compileProfile(checked.profile);
  } catch (error) {
    return { errors: [error instanceof Error ? error.message : String(error)] };
  }
  return { profile: checked.profile };
}

/** The form wired to the real services. */
export function realProfileForm(): ProfileFormModel {
  const deps: ProfileFormDeps = {
    schema: profileSchema,
    readUser: async (name) => {
      const list = await userFilesList('profiles');
      const entry = list.find((file) => file.name === name);
      return entry === undefined ? { text: null, error: 'not found' } : { text: entry.text, error: entry.error };
    },
    userPath: (name) => userFilePath('profiles', name),
    builtin: (id) => {
      const source = BUILTIN_PROFILE_SOURCES.find((entry) => (entry.raw as { id?: unknown }).id === id);
      if (source === undefined || profiles.get(id) === undefined) return undefined;
      return { file: source.raw as Record<string, unknown>, resolved: profiles.profile(id) as unknown as Record<string, unknown> };
    },
    parent: (id) => (profiles.get(id) === undefined ? undefined : (profiles.profile(id) as unknown as Record<string, unknown>)),
    check,
    docs: {
      find: (path) => {
        const doc = docs.byPath(path);
        return doc === undefined ? undefined : { id: doc.id, dirty: doc.dirty, title: doc.title };
      },
      // The program the user works in (maybe an untouched new document) stays where it is.
      open: async (path) => (await files.open([path], { keepScratch: true }))[0] ?? null,
      text: (id) => editor.getText(id),
      replace: (id, text) => editor.replaceAll(id, text),
      refusal: (id, action) => {
        const doc = docs.get(id);
        return doc === undefined ? null : lockRefusal(doc, action);
      },
      markClean: (id) => editor.markClean(id),
      save: (id) => files.save(id),
      activeId: () => docs.getActiveId(),
      activate: (id) => docs.activate(id),
    },
    reload: () => userConfig.load(),
    confirm: (o) => dialogs.confirm({ title: o.title, message: o.message, ok: o.ok, kind: 'warning' }),
  };
  return createProfileForm(deps);
}

/** What the command was asked to open: a file of yours, or the profile of the active program. */
export function targetOf(argument: unknown): ProfileFormTarget | Msg {
  const arg = recordOf(argument);
  if (typeof arg.name === 'string' && arg.name !== '') return { kind: 'user', name: arg.name };
  const docId = docs.getActiveId();
  const doc = docId === null ? undefined : docs.get(docId);
  if (doc === undefined) return { key: 'profileForm.noDocument' };
  const info = profiles.get(doc.profileId);
  if (info === undefined) return { key: 'profileForm.unknownProfile', params: { id: doc.profileId } };
  if (info.origin === 'user') {
    if (info.file === null) return { key: 'profileForm.unknownProfile', params: { id: info.id } };
    return { kind: 'user', name: info.file };
  }
  return { kind: 'builtin', id: info.id };
}

/** English detail for anything thrown across the IPC boundary. */
function detailOf(err: unknown): string {
  if (typeof err === 'string') return err;
  return err instanceof Error ? err.message : String(err);
}

async function editInForm(argument: unknown): Promise<void> {
  const target = targetOf(argument);
  if ('key' in target) {
    status.show(t(target.key, target.params), { error: true });
    return;
  }
  const model = realProfileForm();
  try {
    await model.load(target);
  } catch (err) {
    status.show(t('profileForm.failed', { detail: detailOf(err) }), { error: true });
    return;
  }
  const next: { after: 'duplicate' | 'json' | null } = { after: null };
  try {
    await modals.open(
      ProfileFormDialog,
      {
        model,
        onduplicate: target.kind === 'builtin' ? () => (next.after = 'duplicate') : undefined,
        onopenjson: target.kind === 'user' ? () => (next.after = 'json') : undefined,
      },
      { wide: true, mayClose: () => model.leave() },
    );
  } catch (err) {
    status.show(t('profileForm.failed', { detail: detailOf(err) }), { error: true });
    return;
  }
  // The dialog is closed: what it asked for can open its own dialogs now.
  if (next.after === 'duplicate' && target.kind === 'builtin') await commands.run('profile.newFrom', { kind: 'profiles', parent: target.id });
  else if (next.after === 'json' && target.kind === 'user') await commands.run('profile.open', { kind: 'profiles', name: target.name });
}

export default {
  id: 'profileForm',
  commands: [
    {
      id: 'profile.editInForm',
      title: 'profileForm.edit',
      category: 'profileForm.category',
      icon: asIcon(FilePen),
      global: true,
      run: (_c, arg) => editInForm(arg),
    },
  ],
} satisfies Contribution;
