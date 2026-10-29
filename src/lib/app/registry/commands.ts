// The command registry (plan §7.1, AD-4). Owner: WP1.1.
//
// One registry drives the ribbon, the window key dispatcher, Monaco's F1 palette and the
// runtime harness. A duplicate id throws, a key conflict logs `console.error` (the harness
// fails on unexpected console errors, so a conflict cannot ship), `run` returns false for
// an unknown or disabled command and shows a status message, and an error thrown by a
// command becomes a status error plus `console.error`.

import { derived, writable } from 'svelte/store';
import { findConflicts, isValidKeySpec, resolveKeys } from '$lib/core/keys/keySpec';
import { mergeKeys, type UserBindings } from '$lib/core/keys/userKeys';
import { status } from '$lib/app/status';
import { t } from '$lib/i18n';
import { isMacPlatform } from '$lib/utils/platform';
import type { CommandContext, CommandDef, CommandRegistry, Disposable } from '$lib/app/types';

/** The context before `setContextProvider` runs, and the fallback if a provider throws. */
const NO_CONTEXT: CommandContext = {
  activeDocId: null,
  profileId: null,
  hasSelection: false,
  editorFocused: false,
  compareOpen: false,
  modalOpen: false,
  scriptRunning: false,
};

const defs = new Map<string, CommandDef>();
/** The user's key bindings (P4g, §6.9 rule 5); `{}` is "the declared keys". */
let overrides: UserBindings = {};
/** The commands whose keys in force differ from the declared ones, as copies; `defs` keeps the originals. */
const effective = new Map<string, CommandDef>();
const revision = writable(0);

let contextProvider: () => CommandContext = () => NO_CONTEXT;
/** The last context handed out, so that `context()` can notice a change on its own. */
let lastContext: CommandContext = NO_CONTEXT;
let bumpScheduled = false;

function bump(): void {
  revision.update((n) => n + 1);
}

/** Bumps `changed` after the current task, so a bump during a subscriber run cannot recurse. */
function bumpSoon(): void {
  if (bumpScheduled) return;
  bumpScheduled = true;
  queueMicrotask(() => {
    bumpScheduled = false;
    bump();
  });
}

function sameContext(a: CommandContext, b: CommandContext): boolean {
  return (
    a.activeDocId === b.activeDocId &&
    a.profileId === b.profileId &&
    a.hasSelection === b.hasSelection &&
    a.editorFocused === b.editorFocused &&
    a.compareOpen === b.compareOpen &&
    a.modalOpen === b.modalOpen &&
    a.scriptRunning === b.scriptRunning
  );
}

function currentContext(): CommandContext {
  let next: CommandContext;
  try {
    next = contextProvider();
  } catch (err) {
    console.error('command context provider failed', err);
    next = NO_CONTEXT;
  }
  if (!sameContext(next, lastContext)) {
    lastContext = next;
    bumpSoon();
  }
  return next;
}

/**
 * Works out the keys in force for every command and keeps a copy for each one that differs from
 * its declared keys. `defs` is never touched, so a dispose still finds the object it registered.
 */
function applyOverrides(): void {
  effective.clear();
  if (Object.keys(overrides).length === 0) return;
  const all = [...defs.values()];
  const mac = mergeKeys(all, overrides, 'mac').keys;
  const other = mergeKeys(all, overrides, 'other').keys;
  for (const def of all) {
    const m = mac.get(def.id);
    const o = other.get(def.id);
    if (m === resolveKeys(def.keys, true) && o === resolveKeys(def.keys, false)) continue;
    const keys: CommandDef['keys'] = m === o ? m : { ...(m === undefined ? {} : { mac: m }), ...(o === undefined ? {} : { other: o }) };
    effective.set(def.id, { ...def, keys });
  }
}

/** Reports the key conflicts `added` introduces against everything registered before them. */
function reportConflicts(added: CommandDef[]): void {
  const isMac = isMacPlatform();
  const addedIds = new Set(added.map((d) => d.id));
  for (const def of added) {
    const spec = resolveKeys(def.keys, isMac);
    if (spec && !isValidKeySpec(spec)) {
      console.error(`command "${def.id}": invalid key spec "${spec}"`);
    }
  }
  // Existing commands come first, so a reported pair always names the newcomer second.
  const ordered = [...defs.values()].filter((d) => !addedIds.has(d.id)).concat(added);
  for (const [first, second] of findConflicts(ordered, isMac)) {
    if (!addedIds.has(second)) continue;
    const spec = resolveKeys(defs.get(second)?.keys, isMac);
    console.error(`key conflict: "${spec}" is claimed by both "${first}" and "${second}"`);
  }
}

export const commands: CommandRegistry = {
  register(input: CommandDef | CommandDef[]): Disposable {
    const added = Array.isArray(input) ? [...input] : [input];
    const seen = new Set<string>();
    for (const def of added) {
      if (!def.id) throw new Error('command registration: a command has no id');
      if (defs.has(def.id) || seen.has(def.id)) {
        throw new Error(`command "${def.id}" is already registered`);
      }
      seen.add(def.id);
    }
    for (const def of added) defs.set(def.id, def);
    reportConflicts(added);
    applyOverrides();
    bump();

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      for (const def of added) {
        // Only remove what is still ours: a later registration of the same id wins.
        if (defs.get(def.id) === def) defs.delete(def.id);
      }
      applyOverrides();
      bump();
    };
  },

  has(id: string): boolean {
    return defs.has(id);
  },

  get(id: string): CommandDef | undefined {
    return effective.get(id) ?? defs.get(id);
  },

  list(): CommandDef[] {
    return [...defs.values()].map((def) => effective.get(def.id) ?? def);
  },

  setKeyOverrides(bindings: UserBindings): void {
    overrides = { ...bindings };
    applyOverrides();
    bump();
  },

  defaultKeys(id: string): CommandDef['keys'] {
    return defs.get(id)?.keys;
  },

  isEnabled(id: string): boolean {
    const def = defs.get(id);
    if (!def) return false;
    if (!def.enabled) return true;
    try {
      return def.enabled(currentContext());
    } catch (err) {
      console.error(`command "${id}": enabled() failed`, err);
      return false;
    }
  },

  async run(id: string, arg?: unknown): Promise<boolean> {
    const def = defs.get(id);
    if (!def) {
      console.error(`command "${id}" is not registered`);
      status.show(t('core.commandUnknown', { id }), { error: true });
      return false;
    }
    const context = currentContext();
    let enabled = true;
    if (def.enabled) {
      try {
        enabled = def.enabled(context);
      } catch (err) {
        console.error(`command "${id}": enabled() failed`, err);
        enabled = false;
      }
    }
    if (!enabled) {
      status.show(t('core.commandDisabled', { title: t(def.title) }));
      return false;
    }
    try {
      await def.run(context, arg);
      return true;
    } catch (err) {
      console.error(`command "${id}" failed`, err);
      status.show(t('core.commandFailed', { title: t(def.title) }), {
        error: true,
        detail: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  },

  context(): CommandContext {
    return currentContext();
  },

  changed: derived(revision, (n) => n),
};

/**
 * Installed once by `app/bootstrap.ts`. Every `context()` read calls `fn`; when the value
 * differs from the previous one, `changed` bumps, so the ribbon re-evaluates enablement.
 */
export function setContextProvider(fn: () => CommandContext): void {
  contextProvider = fn;
  lastContext = NO_CONTEXT;
  bump();
}

/**
 * Bumps `changed` without a registration change. WP1.1 addition (not in §7.1): the
 * context provider is a pull function, so whoever owns the state behind it calls this
 * after a change that the ribbon must see immediately.
 */
export function notifyContextChanged(): void {
  bump();
}

/** Test seam: drops every registration and the context provider. */
export function resetCommandsForTest(): void {
  defs.clear();
  overrides = {};
  effective.clear();
  contextProvider = () => NO_CONTEXT;
  lastContext = NO_CONTEXT;
  bump();
}
