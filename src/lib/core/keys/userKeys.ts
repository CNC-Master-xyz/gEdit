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

import { formatKey, parseKey, resolveKeys } from '$lib/core/keys/keySpec';
import type { KeyEventLike } from '$lib/core/keys/keySpec';
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

/** The entry of `id`, own properties only (`constructor` is a command id like any other). */
export function bindingOf(bindings: UserBindings, id: string): UserKeyValue | undefined {
  return Object.prototype.hasOwnProperty.call(bindings, id) ? bindings[id] : undefined;
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
   * bindings name one key; neither has it until the user fixes one (a command that has the key
   * by default is displaced as well, so that the key runs nothing while the question is open).
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

const PLATFORMS: readonly KeyPlatform[] = ['mac', 'other'];

function kindOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}

function shortId(id: string): string {
  return id.length > 40 ? `${id.slice(0, 40)}…` : id;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Reads `keybindings.json` (the object Rust hands over, `$version` and all). A bad entry costs the
 * entry and a bad member costs the member, never the file; each problem has the JSON path of the
 * part at fault (§6.9 rule 3). A command id the registry does not know is kept: the key is back
 * when the script or the package is. `serializeUserKeys` is the way back.
 */
export function parseUserKeys(raw: unknown): ParsedUserKeys {
  const bindings: UserBindings = {};
  const problems: KeyProblem[] = [];
  if (!isRecord(raw)) {
    problems.push({ path: 'bindings', reason: 'wrongType', message: `The key file has to hold an object, not ${kindOf(raw)}.` });
    return { bindings, problems };
  }
  const entries = raw.bindings;
  if (entries === undefined) return { bindings, problems };
  if (!isRecord(entries)) {
    problems.push({ path: 'bindings', reason: 'wrongType', message: `"bindings" has to be an object, not ${kindOf(entries)}.` });
    return { bindings, problems };
  }

  const ids = Object.keys(entries);
  if (ids.length > MAX_USER_BINDINGS) {
    problems.push({
      path: 'bindings',
      reason: 'tooMany',
      message: `More than ${MAX_USER_BINDINGS} entries; the first ${MAX_USER_BINDINGS} are kept.`,
    });
  }
  for (const id of ids.slice(0, MAX_USER_BINDINGS)) {
    const path = `bindings.${shortId(id)}`;
    if (id.length === 0 || id.length > MAX_COMMAND_ID_CHARS || id === '__proto__') {
      problems.push({ path, reason: 'badId', message: 'The command id is empty or too long.' });
      continue;
    }
    const value = entries[id];
    const kept = readEntry(value, path, problems);
    if (kept !== undefined) bindings[id] = kept;
  }
  return { bindings, problems };
}

/** One entry; `undefined` when nothing of it survives. */
function readEntry(value: unknown, path: string, problems: KeyProblem[]): UserKeyValue | undefined {
  if (value === null) return null;
  if (typeof value === 'string') return readSpec(value, PLATFORMS, path, problems) ? value : readPartial(value);
  if (!isRecord(value)) {
    problems.push({
      path,
      reason: 'wrongType',
      message: `A key is text, null, or { "mac": …, "other": … }, not ${kindOf(value)}.`,
    });
    return undefined;
  }
  const out: { mac?: KeySpec | null; other?: KeySpec | null } = {};
  for (const name of Object.keys(value)) {
    const member = value[name];
    const memberPath = `${path}.${name}`;
    if (name !== 'mac' && name !== 'other') {
      problems.push({ path: memberPath, reason: 'wrongType', message: `"${name}" is not "mac" or "other".` });
      continue;
    }
    if (member === null) out[name] = null;
    else if (typeof member === 'string') {
      if (readSpec(member, [name], memberPath, problems)) out[name] = member;
    } else {
      problems.push({ path: memberPath, reason: 'wrongType', message: `A key is text or null, not ${kindOf(member)}.` });
    }
  }
  return out.mac === undefined && out.other === undefined ? undefined : out;
}

/** Checks `spec` on each platform; records the refusals; true when it is allowed on all of them. */
function readSpec(spec: string, platforms: readonly string[], path: string, problems: KeyProblem[]): boolean {
  let ok = true;
  for (const platform of platforms as KeyPlatform[]) {
    const reason = checkUserKey(spec, platform);
    if (!reason) continue;
    ok = false;
    // A string is both platforms: say which one is at fault when the answers differ.
    const where = platforms.length > 1 && reason === 'reserved' ? `${path}.${platform}` : path;
    if (problems.some((p) => p.path === where && p.reason === reason)) continue;
    problems.push({ path: where, reason, message: refusalText(spec, reason) });
  }
  return ok;
}

/** A string that one platform refuses: the platform that allows it keeps it (the problem is already recorded). */
function readPartial(spec: string): UserKeyValue | undefined {
  const allowed = PLATFORMS.filter((platform) => checkUserKey(spec, platform) === null);
  if (allowed.length === 0) return undefined;
  const out: { mac?: KeySpec; other?: KeySpec } = {};
  for (const platform of allowed) out[platform] = spec;
  return out;
}

function refusalText(spec: string, reason: KeyRefusal): string {
  switch (reason) {
    case 'unparsable':
      return `"${spec}" is not a key.`;
    case 'noModifier':
      return `"${spec}" has no Ctrl, Cmd or Alt and is not a function key.`;
    case 'reserved':
      return `"${spec}" belongs to the system, the clipboard or undo.`;
    default:
      return `"${spec}" cannot be used.`;
  }
}

/** The spec of `signatureOf`-comparable keys that parse; invalid ones are skipped. */
function signatureOrNull(spec: KeySpec, platform: KeyPlatform): string | null {
  try {
    return signatureOf(spec, platform);
  } catch {
    return null;
  }
}

/**
 * The keys in force on `platform`: each command's default (`resolveKeys`), then the user's
 * bindings over them, with the conflicts the merge found (§6.9 rule 5). A user key replaces
 * the command's own default on that platform; over another command's default it takes the key
 * and that command shows none (`user-over-default`); two user keys on one key leave the key to
 * neither (`user-user`). Entries for commands that are not in `defs` do nothing here.
 */
export function mergeKeys(defs: readonly CommandDef[], bindings: UserBindings, platform: KeyPlatform): MergedKeys {
  const isMac = platform === 'mac';
  /** Defaults in force (the command's own default is gone once the user has said anything for it). */
  const final = new Map<string, KeySpec>();
  /** The user's keys, by command. */
  const user = new Map<string, KeySpec>();

  for (const def of defs) {
    const entry = bindingOf(bindings, def.id);
    const own = entry === undefined ? undefined : valueFor(entry, platform);
    if (own === undefined) {
      const spec = resolveKeys(def.keys, isMac);
      if (spec) final.set(def.id, spec);
    } else if (own !== null && signatureOrNull(own, platform) !== null) {
      user.set(def.id, own);
    }
  }

  // Who holds each key, by signature.
  const bySig = new Map<string, { users: string[]; defaults: string[] }>();
  const slot = (sig: string) => {
    let entry = bySig.get(sig);
    if (!entry) bySig.set(sig, (entry = { users: [], defaults: [] }));
    return entry;
  };
  for (const [id, spec] of user) {
    const sig = signatureOrNull(spec, platform);
    if (sig) slot(sig).users.push(id);
  }
  for (const [id, spec] of final) {
    const sig = signatureOrNull(spec, platform);
    // Defaults that are malformed stay as they are; the registry reports them.
    if (sig) slot(sig).defaults.push(id);
  }

  const conflicts: KeyConflict[] = [];
  const displaced = new Set<string>();
  const onHold = new Set<string>();
  for (const who of bySig.values()) {
    if (who.users.length === 0) continue;
    const spec = user.get(who.users[0]) as KeySpec;
    const label = formatKey(spec, isMac);
    if (who.users.length >= 2) {
      for (const id of who.users) onHold.add(id);
      for (const id of who.defaults) displaced.add(id);
      conflicts.push({ platform, key: label, kind: 'user-user', winner: null, others: [...who.users, ...who.defaults] });
    } else if (who.defaults.length > 0) {
      for (const id of who.defaults) displaced.add(id);
      conflicts.push({ platform, key: label, kind: 'user-over-default', winner: who.users[0], others: [...who.defaults] });
    }
  }

  // The keys in force, in the order of `defs`.
  const keys = new Map<string, KeySpec>();
  for (const def of defs) {
    if (user.has(def.id)) {
      if (!onHold.has(def.id)) keys.set(def.id, user.get(def.id) as KeySpec);
    } else if (final.has(def.id) && !displaced.has(def.id)) {
      keys.set(def.id, final.get(def.id) as KeySpec);
    }
  }
  return { platform, keys, conflicts };
}

/**
 * The text of `keybindings.json` for these bindings (without `$version`, which Rust stamps). An
 * entry that says nothing is left out; a pair with one key on both platforms becomes that key.
 */
export function serializeUserKeys(bindings: UserBindings): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const id of Object.keys(bindings)) {
    const value = bindings[id];
    if (value === null || typeof value === 'string') {
      out[id] = value;
      continue;
    }
    const { mac, other } = value;
    if (mac === undefined && other === undefined) continue;
    if (mac !== undefined && other !== undefined && mac === other) out[id] = mac;
    else out[id] = { ...(mac === undefined ? {} : { mac }), ...(other === undefined ? {} : { other }) };
  }
  return { bindings: out };
}

/**
 * `bindings` with the key of `id` on `platform` set: a spec binds it, `null` removes the key
 * there, `undefined` puts the default back (the entry goes when nothing is left). The other
 * platform keeps what it had. Pure; the Keyboard page's edits all go through here.
 */
export function setKeyFor(
  bindings: UserBindings,
  id: string,
  platform: KeyPlatform,
  value: KeySpec | null | undefined,
): UserBindings {
  const out: UserBindings = { ...bindings };
  const current = bindingOf(bindings, id);
  const other: KeyPlatform = platform === 'mac' ? 'other' : 'mac';
  const kept = current === undefined ? undefined : valueFor(current, other);
  delete out[id];
  if (value === undefined && kept === undefined) return out;
  if (value !== undefined && kept !== undefined && value === kept) {
    out[id] = value;
    return out;
  }
  const pair: { mac?: KeySpec | null; other?: KeySpec | null } = {};
  if (value !== undefined) pair[platform] = value;
  if (kept !== undefined) pair[other] = kept;
  out[id] = pair;
  return out;
}

/** What pressing a key on the Keyboard page records. */
export type CapturedKey =
  | { spec: KeySpec }
  /** `altGraph`: the key was pressed with AltGr, which types a character; it is not a shortcut. */
  | { refusal: 'altGraph' | KeyRefusal };

/** Codes of the keys that are not a letter, a digit or an F-key, and the spec name of each. */
const CODE_NAMES: Readonly<Record<string, string>> = {
  Escape: 'Escape',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Tab: 'Tab',
  Space: 'Space',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
};

const MODIFIER_CODES = /^(Shift|Control|Alt|Meta|OS|AltGraph|CapsLock|NumLock|ScrollLock|Fn)(Left|Right)?$/;

/** The event fields `captureKey` reads. */
export interface CaptureEvent extends KeyEventLike {
  getModifierState?(key: string): boolean;
}

/**
 * The key spec a key press records on the Keyboard page (§6.9 rule 4): the physical key
 * (`event.code`) with the modifiers, written `Mod+…` (Cmd on a Mac, Ctrl elsewhere). `null` for a
 * modifier on its own (still waiting for the key). A press with the AltGraph state is refused:
 * it types a character. A key `checkUserKey` refuses comes back as its reason.
 */
export function captureKey(e: CaptureEvent, platform: KeyPlatform): CapturedKey | null {
  if (MODIFIER_CODES.test(e.code)) return null;
  if (typeof e.getModifierState === 'function' && e.getModifierState('AltGraph')) return { refusal: 'altGraph' };
  let key: string | undefined;
  const letter = /^Key([A-Z])$/.exec(e.code);
  const digit = /^Digit([0-9])$/.exec(e.code);
  if (letter) key = letter[1];
  else if (digit) key = digit[1];
  else if (F_KEY.test(e.code)) key = e.code;
  else key = CODE_NAMES[e.code];
  if (key === undefined) return { refusal: 'unparsable' };
  // The Windows key and the like have no spelling off macOS.
  if (platform === 'other' && e.metaKey) return { refusal: 'unparsable' };
  const parts: string[] = [];
  if (platform === 'mac') {
    if (e.metaKey) parts.push('Mod');
    if (e.ctrlKey) parts.push('Ctrl');
  } else if (e.ctrlKey) parts.push('Mod');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  const spec = parts.join('+');
  const refusal = checkUserKey(spec, platform);
  return refusal ? { refusal } : { spec };
}
