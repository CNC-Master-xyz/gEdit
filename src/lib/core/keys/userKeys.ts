// The user's key overrides (Phase 4 plan §6.9 rules 1–6, AD-55). Written by the P4g prelude;
// P4.34 fills in `parseUserKeys` and `mergeKeys` and builds the Keyboard page on them.
//
// Pure (`core/`): no Svelte, no Monaco, no Tauri. The file `<config>/keybindings.json` is read
// and written by Rust (`src-tauri/src/keybindings.rs`); this module says what its content may be.
//
// What is final here (the key rules the Keyboard page and the file reader share): the file
// constants, the shapes, `checkUserKey` (which keys a user may bind) and `noticeOf` (the keys
// that may type a character instead of running a command). What is P4.34's: `parseUserKeys`,
// `mergeKeys` and `serializeUserKeys`.

import { parseKey, resolveKeys } from '$lib/core/keys/keySpec';
import type { CommandDef, KeySpec } from '$lib/app/types';

/** The `$version` this build writes. Must match `KEYBINDINGS_VERSION` in `src-tauri/src/keybindings.rs`. */
export const KEYBINDINGS_VERSION = 1;

/** The most entries `bindings` may hold. Must match `MAX_BINDINGS` in `src-tauri/src/keybindings.rs`. */
export const MAX_USER_BINDINGS = 1000;

/** The longest command id an entry may name (`script.run:<script id>` is the longest kind). */
export const MAX_COMMAND_ID_CHARS = 200;

/** The platforms a key is stored and checked for. */
export type KeyPlatform = 'mac' | 'other';

/**
 * One entry of `bindings`, keyed by the command id:
 * - a key spec: both platforms (write `Mod+…`, which is Cmd on a Mac and Ctrl elsewhere);
 * - `null`: the command has no key on either platform (a default is removed);
 * - `{ mac, other }`: per platform; a missing member keeps that platform's default, `null`
 *   removes it there.
 */
export type UserKeyValue = KeySpec | null | { mac?: KeySpec | null; other?: KeySpec | null };

/** The file's content once read: the entries that passed, in the file's order. */
export type UserBindings = Record<string, UserKeyValue>;

/** Why a key or an entry is refused (the ids of the Keyboard page's messages, `keyboardPage.refusal.<id>`). */
export type KeyRefusal =
  /** Not a key spec (`parseKey` threw). */
  | 'unparsable'
  /** A key without Ctrl, Cmd or Alt that is not an F-key would take typing away. */
  | 'noModifier'
  /** A key the system or the clipboard and undo own. */
  | 'reserved'
  /** The entry is not a spec, null or `{ mac, other }`. */
  | 'wrongType'
  /** The command id is empty or longer than `MAX_COMMAND_ID_CHARS`. */
  | 'badId'
  /** More than `MAX_USER_BINDINGS` entries (the rest are dropped). */
  | 'tooMany';

/** A problem with the file or one entry, with the JSON path of the part at fault. */
export interface KeyProblem {
  /** `bindings.view.splitEditor.mac`, or `bindings` for the object itself. */
  path: string;
  reason: KeyRefusal;
  /** English detail (AD-14). */
  message: string;
}

/** What reading the file gives. A bad entry costs the entry, never the file. */
export interface ParsedUserKeys {
  bindings: UserBindings;
  problems: KeyProblem[];
}

/**
 * Keys that can be used but that may produce a character instead of running the command on some
 * keyboards: `altGr` (Ctrl+Alt with a printing key, where AltGr is Ctrl+Alt on Windows and Linux
 * layouts such as the Swiss German one) and `optionCharacter` (Option with a printing key on a
 * Mac). Shown beside the key on the Keyboard page; never a refusal.
 */
export type KeyNotice = 'altGr' | 'optionCharacter';

/** The keys no user binding may take, per platform (`Mod` is Cmd on a Mac, Ctrl elsewhere). */
export const RESERVED_KEYS: Readonly<Record<KeyPlatform, readonly KeySpec[]>> = {
  mac: [
    'Mod+C',
    'Mod+X',
    'Mod+V',
    'Mod+A',
    'Mod+Z',
    'Mod+Shift+Z',
    'Mod+Y',
    'Mod+Q',
    'Mod+H',
    'Mod+M',
    'Mod+Space',
  ],
  other: ['Mod+C', 'Mod+X', 'Mod+V', 'Mod+A', 'Mod+Z', 'Mod+Shift+Z', 'Mod+Y', 'Alt+F4'],
};

/** A comparable form of a spec on one platform (`Mod` and `Ctrl` are one key off macOS). */
function signatureOf(spec: KeySpec, platform: KeyPlatform): string {
  const p = parseKey(spec);
  const mod = platform === 'mac' ? p.mod : p.mod || p.ctrl;
  const ctrl = platform === 'mac' ? p.ctrl : false;
  return `${mod ? 'mod+' : ''}${ctrl ? 'ctrl+' : ''}${p.alt ? 'alt+' : ''}${p.shift ? 'shift+' : ''}${p.key}`;
}

const F_KEY = /^F([1-9]|1[0-9])$/;

/**
 * Whether a user may bind `spec` on `platform`: `null` when it is allowed, else the reason.
 * Rules (§6.9 rule 4): it parses; it has Ctrl, Cmd or Alt, unless it is an F-key (Shift alone is
 * not enough: `Shift+A` is a capital letter); it is not one of `RESERVED_KEYS[platform]`.
 */
export function checkUserKey(spec: KeySpec, platform: KeyPlatform): KeyRefusal | null {
  let parsed;
  try {
    parsed = parseKey(spec);
  } catch {
    return 'unparsable';
  }
  if (!parsed.mod && !parsed.ctrl && !parsed.alt && !F_KEY.test(parsed.key)) return 'noModifier';
  const signature = signatureOf(spec, platform);
  if (RESERVED_KEYS[platform].some((reserved) => signatureOf(reserved, platform) === signature)) {
    return 'reserved';
  }
  return null;
}

/** True for a main key that types a character on some layout: a letter, a digit or punctuation. */
function isPrinting(key: string): boolean {
  return /^[A-Z0-9]$/.test(key) || /^[,./;'[\]\\\-=`+]$/.test(key);
}

/**
 * Whether `spec` may type a character instead of running the command on `platform`, and which
 * kind of notice the Keyboard page shows. Windows and Linux: Ctrl and Alt together with a
 * printing key (AltGr). macOS: Option alone with a printing key.
 */
export function noticeOf(spec: KeySpec, platform: KeyPlatform): KeyNotice | null {
  let parsed;
  try {
    parsed = parseKey(spec);
  } catch {
    return null;
  }
  if (!isPrinting(parsed.key)) return null;
  if (platform === 'other' && (parsed.mod || parsed.ctrl) && parsed.alt) return 'altGr';
  if (platform === 'mac' && parsed.alt && !parsed.mod && !parsed.ctrl) return 'optionCharacter';
  return null;
}

/** The spec an entry gives for `platform`: `undefined` when it leaves the default, `null` when it removes it. */
export function valueFor(value: UserKeyValue, platform: KeyPlatform): KeySpec | null | undefined {
  if (value === null || typeof value === 'string') return value;
  return value[platform];
}

// ---------------------------------------------------------------------------
// P4.34
// ---------------------------------------------------------------------------

/** One key claimed twice on one platform. */
export interface KeyConflict {
  platform: KeyPlatform;
  /** The key as the platform spells it (`formatKey`). */
  key: string;
  /**
   * `user-over-default`: a user binding took a key another command has by default; the user's
   * command has the key and the displaced one has none (§6.9 rule 5). `user-user`: two user
   * bindings name one key; neither has it until the user fixes one.
   */
  kind: 'user-over-default' | 'user-user';
  /** The command that has the key now; `null` for `user-user`. */
  winner: string | null;
  /** The commands that were displaced or are on hold. */
  others: string[];
}

/** The keys in force on one platform. */
export interface MergedKeys {
  platform: KeyPlatform;
  /** Command id → the key it has now; absent when it has none. */
  keys: Map<string, KeySpec>;
  conflicts: KeyConflict[];
}

/**
 * Reads the object of `keybindings.json` (without `$version`). A bad entry is a problem with its
 * JSON path and is left out; the others stay. P4.34. The stub keeps nothing.
 */
export function parseUserKeys(_raw: unknown): ParsedUserKeys {
  return { bindings: {}, problems: [] };
}

/**
 * The keys in force on `platform`: each command's default (`resolveKeys`), then the user's
 * bindings over them, with the conflicts the merge found (§6.9 rule 5). P4.34. The stub gives
 * the defaults and no conflict.
 */
export function mergeKeys(defs: readonly CommandDef[], _bindings: UserBindings, platform: KeyPlatform): MergedKeys {
  const keys = new Map<string, KeySpec>();
  for (const def of defs) {
    const spec = resolveKeys(def.keys, platform === 'mac');
    if (spec) keys.set(def.id, spec);
  }
  return { platform, keys, conflicts: [] };
}

/** The text of `keybindings.json` for these bindings (without `$version`, which Rust stamps). P4.34. */
export function serializeUserKeys(bindings: UserBindings): Record<string, unknown> {
  return { bindings: { ...bindings } };
}
