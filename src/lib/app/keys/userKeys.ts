// The user's key overrides in the running app (Phase 4 plan §6.9 rules 1–6, AD-55). Owner: P4.34
// (the pure rules are `core/keys/userKeys.ts`).
//
// `loadUserKeys()` runs once at startup, after the settings and the machines and before the
// contributions register (`bootstrap.ts`): it reads `keybindings.json` through `keybindingsLoad()`,
// parses it with `parseUserKeys`, and hands the bindings to the command registry
// (`commands.setKeyOverrides`), which answers every later `get`/`list` with the keys in force.
// The Keyboard page saves through the same service (`userKeys.setKey`, `reset`, `resetAll`), which
// writes the file first and updates the registry only when the write worked. A broken or newer
// file is a notice and no overrides; the defaults stay. Never throws.
//
// Every edit is on the running platform only: a Mac user's change leaves the `other` member of an
// entry as it was (§6.9 rule 2), so a file shared between computers keeps both.

import { get, writable, type Readable } from 'svelte/store';
import { commands } from '$lib/app/registry/commands';
import { status } from '$lib/app/status';
import { t } from '$lib/i18n';
import {
  mergeKeys,
  parseUserKeys,
  serializeUserKeys,
  setKeyFor,
  valueFor,
  type KeyPlatform,
  type KeyProblem,
  type MergedKeys,
  type UserBindings,
} from '$lib/core/keys/userKeys';
import { keybindingsLoad, keybindingsSave, type KeybindingsLoad } from '$lib/platform/commands';
import { isMacPlatform, isTauriRuntime } from '$lib/utils/platform';
import type { CommandDef, KeySpec } from '$lib/app/types';

/** What the service knows about the file. */
export interface UserKeysState {
  /** The entries that passed, in the file's order (the commands that are gone included). */
  bindings: UserBindings;
  /** What was left out when the file was read, with JSON paths. */
  problems: KeyProblem[];
  /** The file is from a newer gEdit: it is shown and never written. */
  readOnly: boolean;
  /** English detail of a file that could not be used. */
  error: string | null;
  loaded: boolean;
}

export interface UserKeyService {
  readonly state: Readable<UserKeysState>;
  /** Reads the file and puts the bindings in force. Never throws. */
  load(): Promise<void>;
  /**
   * Sets the key of `id` on the running platform: a spec binds it, `null` removes the key there,
   * `undefined` puts the default back. Resolves false (with a status message) when nothing was
   * saved. Saving with a conflict is allowed; a message says so.
   */
  setKey(id: string, value: KeySpec | null | undefined): Promise<boolean>;
  /** The default key of a command back, on the running platform. */
  reset(id: string): Promise<boolean>;
  /** Every user key gone: the file holds no bindings. */
  resetAll(): Promise<boolean>;
  /** The keys in force on both platforms for `bindings` (the saved ones when omitted), over the declared keys. */
  analyse(bindings?: UserBindings): Record<KeyPlatform, MergedKeys>;
  /** The platform this window runs on. */
  readonly platform: KeyPlatform;
}

export interface UserKeysDeps {
  load(): Promise<KeybindingsLoad>;
  save(file: Record<string, unknown>): Promise<void>;
  /** The registry's answer: every command with its declared keys. */
  declared(): CommandDef[];
  apply(bindings: UserBindings): void;
  show(text: string, o?: { error?: boolean; detail?: string }): void;
  isMac: boolean;
  /** False in a browser without the Tauri runtime (nothing to read). */
  available: boolean;
}

const EMPTY: UserKeysState = { bindings: {}, problems: [], readOnly: false, error: null, loaded: false };

export function createUserKeys(deps: UserKeysDeps): UserKeyService {
  const store = writable<UserKeysState>({ ...EMPTY });
  const platform: KeyPlatform = deps.isMac ? 'mac' : 'other';

  const analyse = (bindings: UserBindings = get(store).bindings): Record<KeyPlatform, MergedKeys> => {
    const defs = deps.declared();
    return { mac: mergeKeys(defs, bindings, 'mac'), other: mergeKeys(defs, bindings, 'other') };
  };

  async function load(): Promise<void> {
    if (!deps.available) {
      store.set({ ...EMPTY, loaded: true });
      return;
    }
    try {
      const file = await deps.load();
      const { bindings, problems } = parseUserKeys(file.keybindings);
      store.set({ bindings, problems, readOnly: file.readOnly, error: file.error, loaded: true });
      deps.apply(bindings);
      if (file.error) {
        deps.show(t('keyboardPage.loadFailed'), { error: true, detail: file.error });
      } else if (file.readOnly) {
        deps.show(t('keyboardPage.readOnly'));
      } else if (problems.length > 0) {
        deps.show(t('keyboardPage.problems', { count: problems.length }), {
          detail: problems.map((p) => `${p.path}: ${p.message}`).slice(0, 5).join('\n'),
        });
      }
    } catch (err) {
      store.set({ ...EMPTY, loaded: true, error: err instanceof Error ? err.message : String(err) });
      deps.apply({});
      deps.show(t('keyboardPage.loadFailed'), { error: true, detail: err instanceof Error ? err.message : String(err) });
    }
  }

  async function commit(next: UserBindings): Promise<boolean> {
    const current = get(store);
    if (current.readOnly) {
      deps.show(t('keyboardPage.readOnly'), { error: true });
      return false;
    }
    try {
      await deps.save(serializeUserKeys(next));
    } catch (err) {
      deps.show(t('keyboardPage.saveFailed'), { error: true, detail: err instanceof Error ? err.message : String(err) });
      return false;
    }
    store.set({ ...current, bindings: next, error: null });
    deps.apply(next);
    const open = Object.values(analyse(next)).reduce((sum, merged) => sum + merged.conflicts.length, 0);
    if (open > 0) deps.show(t('keyboardPage.savedWithConflict', { count: open }));
    return true;
  }

  return {
    state: { subscribe: store.subscribe },
    platform,
    load,
    analyse,
    setKey: (id, value) => commit(setKeyFor(get(store).bindings, id, platform, value)),
    reset: (id) => commit(setKeyFor(get(store).bindings, id, platform, undefined)),
    resetAll: async () => {
      const kept: UserBindings = {};
      const other: KeyPlatform = platform === 'mac' ? 'other' : 'mac';
      // Only the running platform's keys go: the other platform's members stay in the file.
      for (const [id, entry] of Object.entries(get(store).bindings)) {
        const value = valueFor(entry, other);
        if (value !== undefined) Object.assign(kept, setKeyFor({}, id, other, value));
      }
      return commit(kept);
    },
  };
}

export const userKeys: UserKeyService = createUserKeys({
  load: () => keybindingsLoad(),
  save: (file) => keybindingsSave(file),
  declared: () => commands.list().map((def) => ({ ...def, keys: commands.defaultKeys(def.id) })),
  apply: (bindings) => commands.setKeyOverrides(bindings),
  show: (text, o) => status.show(text, o),
  isMac: isMacPlatform(),
  available: isTauriRuntime(),
});

/** Startup (`bootstrap.ts`): the file into the registry. Never throws. */
export async function loadUserKeys(): Promise<void> {
  await userKeys.load();
}
