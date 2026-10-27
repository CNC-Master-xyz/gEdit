// The key rules of §6.9 (rules 3–6) and the stubs P4.34 fills in.

import { describe, expect, it } from 'vitest';
import { formatKey } from '$lib/core/keys/keySpec';
import {
  KEYBINDINGS_VERSION,
  MAX_USER_BINDINGS,
  RESERVED_KEYS,
  checkUserKey,
  mergeKeys,
  noticeOf,
  parseUserKeys,
  serializeUserKeys,
  valueFor,
} from './userKeys';
import type { CommandDef } from '$lib/app/types';

const def = (id: string, keys?: CommandDef['keys']): CommandDef => ({ id, title: id, keys, run: () => {} });

describe('the numbers Rust shares', () => {
  it('are the prelude numbers', () => {
    expect(KEYBINDINGS_VERSION).toBe(1);
    expect(MAX_USER_BINDINGS).toBe(1000);
  });
});

describe('checkUserKey', () => {
  it('allows a key with Ctrl, Cmd or Alt, and an F-key alone', () => {
    for (const spec of ['Mod+K', 'Mod+Shift+K', 'Ctrl+Alt+K', 'Alt+K', 'F9', 'Shift+F9', 'Mod+F12', 'Mod+,']) {
      expect(checkUserKey(spec, 'mac'), spec).toBeNull();
      expect(checkUserKey(spec, 'other'), spec).toBeNull();
    }
  });

  it('refuses a key that would take typing away', () => {
    for (const spec of ['K', 'Shift+K', '5', ',', 'Enter', 'Space', 'Tab', 'Escape', 'Left', 'Home', 'Delete', 'Shift+Left']) {
      expect(checkUserKey(spec, 'other'), spec).toBe('noModifier');
    }
  });

  it('refuses what is not a key spec', () => {
    for (const spec of ['', 'Mod+', 'Hyper+K', 'Mod+Mod+K', 'Mod+Banana']) {
      expect(checkUserKey(spec, 'mac'), spec).toBe('unparsable');
    }
  });

  it('refuses the keys the system, the clipboard and undo own', () => {
    for (const platform of ['mac', 'other'] as const) {
      for (const spec of RESERVED_KEYS[platform]) expect(checkUserKey(spec, platform), `${platform} ${spec}`).toBe('reserved');
    }
    // Spelled another way: lower case, another modifier order, Ctrl for Mod off macOS.
    expect(checkUserKey('shift+mod+z', 'mac')).toBe('reserved');
    expect(checkUserKey('Ctrl+C', 'other')).toBe('reserved');
    // Off macOS Ctrl+Q is nothing special; on a Mac Ctrl is not Cmd, so Ctrl+C is free there.
    expect(checkUserKey('Mod+Q', 'other')).toBeNull();
    expect(checkUserKey('Ctrl+C', 'mac')).toBeNull();
    expect(checkUserKey('Alt+F4', 'mac')).toBeNull();
    expect(checkUserKey('Alt+F4', 'other')).toBe('reserved');
  });

  it('does not reserve a key gEdit itself binds by default', () => {
    for (const spec of ['Mod+S', 'Mod+W', 'Mod+G', 'F7', 'Mod+F9', 'Mod+Alt+C']) {
      expect(checkUserKey(spec, 'other'), spec).toBeNull();
    }
  });
});

describe('noticeOf (the AltGr and Option keys)', () => {
  it('flags Ctrl+Alt with a printing key off macOS, on the Swiss German keyboard AltGr is Ctrl+Alt', () => {
    expect(noticeOf('Mod+Alt+S', 'other')).toBe('altGr');
    expect(noticeOf('Ctrl+Alt+7', 'other')).toBe('altGr');
    expect(noticeOf('Mod+Alt+,', 'other')).toBe('altGr');
    expect(noticeOf('Mod+Alt+F5', 'other')).toBeNull();
    expect(noticeOf('Alt+S', 'other')).toBeNull();
    expect(noticeOf('Mod+Alt+Left', 'other')).toBeNull();
  });

  it('flags Option with a printing key on a Mac, and not Cmd+Option', () => {
    expect(noticeOf('Alt+S', 'mac')).toBe('optionCharacter');
    expect(noticeOf('Mod+Alt+S', 'mac')).toBeNull();
    expect(noticeOf('Alt+F5', 'mac')).toBeNull();
  });

  it('is quiet for a spec that does not parse', () => {
    expect(noticeOf('nonsense', 'mac')).toBeNull();
  });
});

describe('valueFor', () => {
  it('reads a string, null and a per-platform object', () => {
    expect(valueFor('Mod+K', 'mac')).toBe('Mod+K');
    expect(valueFor(null, 'other')).toBeNull();
    expect(valueFor({ mac: 'Mod+K' }, 'mac')).toBe('Mod+K');
    expect(valueFor({ mac: 'Mod+K' }, 'other')).toBeUndefined();
    expect(valueFor({ other: null }, 'other')).toBeNull();
  });
});

describe('the prelude stubs', () => {
  it('parseUserKeys keeps nothing until P4.34', () => {
    expect(parseUserKeys({ 'file.save': 'Mod+S' })).toEqual({ bindings: {}, problems: [] });
  });

  it('mergeKeys gives the defaults of the platform and no conflict until P4.34', () => {
    const merged = mergeKeys([def('a', 'Mod+K'), def('b', { mac: 'Mod+J', other: 'Ctrl+J' }), def('c')], {}, 'mac');
    expect([...merged.keys]).toEqual([
      ['a', 'Mod+K'],
      ['b', 'Mod+J'],
    ]);
    expect(merged.conflicts).toEqual([]);
    expect(formatKey(merged.keys.get('a') ?? 'F1', true)).toBe('⌘K');
  });

  it('serializeUserKeys wraps the bindings', () => {
    expect(serializeUserKeys({ 'file.save': 'Mod+S' })).toEqual({ bindings: { 'file.save': 'Mod+S' } });
  });

  it.todo('parseUserKeys: a string, null and { mac, other } pass; a number, an array and a nested object are wrongType with the JSON path');
  it.todo('parseUserKeys: a spec that checkUserKey refuses costs its member, not the entry or the file');
  it.todo('parseUserKeys: an id longer than MAX_COMMAND_ID_CHARS is badId; entries past MAX_USER_BINDINGS are dropped with one tooMany');
  it.todo('parseUserKeys: a command id the registry does not know is kept (a script that is gone, a package switched off)');
  it.todo('mergeKeys: a user key over another command’s default is user-over-default; the winner has the key and the other has none');
  it.todo('mergeKeys: two user bindings on one key are user-user and neither has the key');
  it.todo('mergeKeys: null removes the default; { mac } leaves the other platform’s default');
  it.todo('mergeKeys: Mod and Ctrl are one key off macOS, so Mod+K and Ctrl+K conflict there and not on a Mac');
  it.todo('mergeKeys: conflicts are found for both platforms whichever runs');
});
