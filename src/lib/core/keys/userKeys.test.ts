// The key rules of §6.9 (rules 2–6): which keys a user may bind, reading the file, the merge, the capture.

import { describe, expect, it } from 'vitest';
import { formatKey } from '$lib/core/keys/keySpec';
import {
  KEYBINDINGS_VERSION,
  MAX_COMMAND_ID_CHARS,
  bindingOf,
  captureKey,
  setKeyFor,
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


describe('parseUserKeys (rule 3)', () => {
  const parse = (bindings: unknown) => parseUserKeys({ $version: 1, bindings });

  it('takes a string, null and { mac, other }', () => {
    const { bindings, problems } = parse({ 'file.save': 'Mod+K', 'view.x': null, 'view.y': { mac: 'Mod+J', other: null } });
    expect(bindings).toEqual({ 'file.save': 'Mod+K', 'view.x': null, 'view.y': { mac: 'Mod+J', other: null } });
    expect(problems).toEqual([]);
  });

  it('an empty file or one without bindings is no overrides and no problem', () => {
    expect(parseUserKeys({})).toEqual({ bindings: {}, problems: [], dropped: {} });
    expect(parseUserKeys({ $version: 1 })).toEqual({ bindings: {}, problems: [], dropped: {} });
  });

  it('a file that is not an object, or bindings that is not an object, costs everything with one problem', () => {
    for (const raw of [null, [], 'x', 3]) {
      const out = parseUserKeys(raw);
      expect(out.bindings, String(raw)).toEqual({});
      expect(out.problems.map((p) => [p.path, p.reason])).toEqual([['bindings', 'wrongType']]);
    }
    const out = parseUserKeys({ bindings: ['Mod+K'] });
    expect(out.problems.map((p) => [p.path, p.reason])).toEqual([['bindings', 'wrongType']]);
  });

  it('a number, an array, a boolean and a nested object are wrongType with the JSON path; the other entries stay', () => {
    const { bindings, problems } = parse({ a: 5, b: ['Mod+K'], c: true, d: { mac: { x: 1 } }, ok: 'Mod+K' });
    expect(bindings).toEqual({ ok: 'Mod+K' });
    expect(problems.map((p) => [p.path, p.reason])).toEqual([
      ['bindings.a', 'wrongType'],
      ['bindings.b', 'wrongType'],
      ['bindings.c', 'wrongType'],
      ['bindings.d.mac', 'wrongType'],
    ]);
    expect(problems[0].message).toMatch(/number/);
  });

  it('a spec that checkUserKey refuses costs its member, not the entry or the file', () => {
    const { bindings, problems } = parse({
      a: { mac: 'K', other: 'Mod+K' },
      b: 'Hyper+K',
      c: { mac: 'Mod+Q', other: 'Mod+Q' },
      d: 'Shift+K',
      e: 'Mod+C',
      ok: 'Mod+K',
    });
    // c: Mod+Q is reserved on a Mac only, so its other member stays.
    expect(bindings).toEqual({ a: { other: 'Mod+K' }, c: { other: 'Mod+Q' }, ok: 'Mod+K' });
    expect(problems.map((p) => [p.path, p.reason])).toEqual([
      ['bindings.a.mac', 'noModifier'],
      ['bindings.b', 'unparsable'],
      ['bindings.c.mac', 'reserved'],
      ['bindings.d', 'noModifier'],
      ['bindings.e.mac', 'reserved'],
      ['bindings.e.other', 'reserved'],
    ]);
  });

  it('a string that only one platform refuses stays for the other platform', () => {
    const { bindings, problems } = parse({ q: 'Mod+Q', f4: 'Alt+F4' });
    expect(bindings).toEqual({ q: { other: 'Mod+Q' }, f4: { mac: 'Alt+F4' } });
    expect(problems.map((p) => p.path)).toEqual(['bindings.q.mac', 'bindings.f4.other']);
  });

  it('a member that is not mac or other is wrongType and the rest of the entry stays', () => {
    const { bindings, problems } = parse({ a: { mac: 'Mod+K', linux: 'Mod+J' } });
    expect(bindings).toEqual({ a: { mac: 'Mod+K' } });
    expect(problems.map((p) => [p.path, p.reason])).toEqual([['bindings.a.linux', 'wrongType']]);
  });

  it('an empty id, an id longer than the limit and __proto__ are badId', () => {
    const long = 'x'.repeat(MAX_COMMAND_ID_CHARS + 1);
    const raw = JSON.parse(`{"bindings": {"": "Mod+K", "${long}": "Mod+K", "__proto__": "Mod+K", "fine": "Mod+K"}}`) as unknown;
    const { bindings, problems } = parseUserKeys(raw);
    expect(Object.keys(bindings)).toEqual(['fine']);
    expect(problems.map((p) => p.reason)).toEqual(['badId', 'badId', 'badId']);
    expect(problems[1].path.length).toBeLessThan(60);
  });

  it('keeps the first MAX_USER_BINDINGS entries and reports tooMany once', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < MAX_USER_BINDINGS + 5; i += 1) many[`cmd.n${i}`] = 'Mod+K';
    const { bindings, problems } = parse(many);
    expect(Object.keys(bindings)).toHaveLength(MAX_USER_BINDINGS);
    expect(problems.filter((p) => p.reason === 'tooMany')).toHaveLength(1);
  });

  it('keeps a command id the registry does not know (a script that is gone)', () => {
    expect(parse({ 'script.run:user:gone.py': 'Mod+Shift+F9' }).bindings).toEqual({ 'script.run:user:gone.py': 'Mod+Shift+F9' });
  });

  it('a command called constructor is an ordinary id', () => {
    const { bindings } = parse({ constructor: 'Mod+K' });
    expect(bindingOf(bindings, 'constructor')).toBe('Mod+K');
    expect(bindingOf({}, 'constructor')).toBeUndefined();
  });
});

describe('mergeKeys (rule 5)', () => {
  const defs = [def('a', 'Mod+K'), def('b', { mac: 'Mod+J', other: 'Ctrl+J' }), def('c'), def('d', 'Mod+L')];
  const keysOf = (m: ReturnType<typeof mergeKeys>) => [...m.keys].map(([id, k]) => `${id}=${k}`);

  it('gives the defaults of the platform and no conflict without bindings', () => {
    const merged = mergeKeys(defs, {}, 'mac');
    expect(keysOf(merged)).toEqual(['a=Mod+K', 'b=Mod+J', 'd=Mod+L']);
    expect(merged.conflicts).toEqual([]);
    expect(formatKey(merged.keys.get('a') ?? 'F1', true)).toBe('⌘K');
  });

  it('a user key replaces the command’s own default', () => {
    const merged = mergeKeys(defs, { a: 'Mod+Shift+K' }, 'other');
    expect(merged.keys.get('a')).toBe('Mod+Shift+K');
    expect(merged.conflicts).toEqual([]);
  });

  it('a user key over another command’s default is user-over-default: the winner has the key, the other has none', () => {
    const merged = mergeKeys(defs, { c: 'Mod+K' }, 'other');
    expect(merged.keys.get('c')).toBe('Mod+K');
    expect(merged.keys.has('a')).toBe(false);
    expect(merged.conflicts).toEqual([{ platform: 'other', key: 'Ctrl+K', kind: 'user-over-default', winner: 'c', others: ['a'] }]);
  });

  it('two user keys on one key leave it to neither, and not to the default holder either', () => {
    const merged = mergeKeys(defs, { b: 'Mod+K', c: 'Ctrl+K' }, 'other');
    expect(merged.keys.has('b')).toBe(false);
    expect(merged.keys.has('c')).toBe(false);
    expect(merged.keys.has('a')).toBe(false);
    expect(merged.conflicts).toEqual([{ platform: 'other', key: 'Ctrl+K', kind: 'user-user', winner: null, others: ['b', 'c', 'a'] }]);
  });

  it('two user keys on a free key leave neither active', () => {
    const merged = mergeKeys(defs, { b: 'Mod+Shift+Q', c: 'Mod+shift+q' }, 'mac');
    expect(keysOf(merged)).toEqual(['a=Mod+K', 'd=Mod+L']);
    expect(merged.conflicts.map((c) => c.kind)).toEqual(['user-user']);
  });

  it('null removes the default; { mac } leaves the other platform’s default', () => {
    expect(mergeKeys(defs, { a: null }, 'mac').keys.has('a')).toBe(false);
    expect(mergeKeys(defs, { a: null }, 'other').keys.has('a')).toBe(false);
    expect(mergeKeys(defs, { b: { mac: 'Mod+Shift+J' } }, 'mac').keys.get('b')).toBe('Mod+Shift+J');
    expect(mergeKeys(defs, { b: { mac: 'Mod+Shift+J' } }, 'other').keys.get('b')).toBe('Ctrl+J');
  });

  it('a key freed by moving its own command can be taken without a conflict', () => {
    const merged = mergeKeys(defs, { a: 'Mod+Shift+K', c: 'Mod+K' }, 'mac');
    expect(merged.conflicts).toEqual([]);
    expect(merged.keys.get('c')).toBe('Mod+K');
    expect(merged.keys.get('a')).toBe('Mod+Shift+K');
  });

  it('Mod and Ctrl are one key off macOS, so Mod+K and Ctrl+K conflict there and not on a Mac', () => {
    const bindings = { c: 'Ctrl+K' };
    expect(mergeKeys(defs, bindings, 'other').conflicts).toHaveLength(1);
    const mac = mergeKeys(defs, bindings, 'mac');
    expect(mac.conflicts).toEqual([]);
    expect(mac.keys.get('a')).toBe('Mod+K');
    expect(mac.keys.get('c')).toBe('Ctrl+K');
  });

  it('finds the conflicts of both platforms, whichever runs', () => {
    const bindings = { c: { mac: 'Mod+K', other: 'Mod+Shift+L' }, d: { other: 'Mod+Shift+L' } };
    expect(mergeKeys(defs, bindings, 'mac').conflicts.map((c) => c.kind)).toEqual(['user-over-default']);
    expect(mergeKeys(defs, bindings, 'other').conflicts.map((c) => c.kind)).toEqual(['user-user']);
  });

  it('an entry for a command that is not registered takes no key from anybody', () => {
    const merged = mergeKeys(defs, { 'script.run:gone': 'Mod+K' }, 'mac');
    expect(merged.keys.get('a')).toBe('Mod+K');
    expect(merged.conflicts).toEqual([]);
  });

  it('shows the key the way the platform writes it in the conflict', () => {
    expect(mergeKeys(defs, { c: 'Mod+K' }, 'mac').conflicts[0].key).toBe('⌘K');
  });
});

describe('serializeUserKeys and setKeyFor', () => {
  it('wraps the bindings and drops what says nothing', () => {
    expect(serializeUserKeys({ 'file.save': 'Mod+S', x: {}, y: { mac: 'Mod+K', other: 'Mod+K' }, z: { mac: 'Mod+K', other: null } })).toEqual({
      bindings: { 'file.save': 'Mod+S', y: 'Mod+K', z: { mac: 'Mod+K', other: null } },
    });
  });

  it('what serialize writes, parse reads back', () => {
    const bindings = { a: 'Mod+K', b: null, c: { mac: 'Mod+J' }, d: { other: null } };
    expect(parseUserKeys(serializeUserKeys(bindings)).bindings).toEqual(bindings);
  });

  // CODE-6: the raw entry of what the reader dropped can be written back.
  it('answers the raw entry of every command the reader dropped something from, and writes it back while the command is unchanged', () => {
    const raw = { bad: 'Mod+Shft+K', half: { mac: 'Mod+Shft+J', other: 'Mod+J' }, fine: 'Mod+K', num: 5 };
    const read = parseUserKeys({ $version: 1, bindings: raw });
    expect(read.dropped).toEqual({ bad: 'Mod+Shft+K', half: raw.half, num: 5 });
    expect(serializeUserKeys(read.bindings, { read: read.bindings, dropped: read.dropped })).toEqual({
      bindings: { half: raw.half, fine: 'Mod+K', bad: 'Mod+Shft+K', num: 5 },
    });
    // Without `keep` nothing comes back (the old behaviour).
    expect(serializeUserKeys(read.bindings)).toEqual({ bindings: { half: { other: 'Mod+J' }, fine: 'Mod+K' } });
  });

  it('does not write the raw entry of a command whose binding changed since the read, or that was removed', () => {
    const read = parseUserKeys({ $version: 1, bindings: { half: { mac: 'Mod+Shft+J', other: 'Mod+J' }, bad: 'Mod+Shft+K' } });
    const keep = { read: read.bindings, dropped: read.dropped };
    expect(serializeUserKeys({ half: { other: 'Mod+H' } }, keep)).toEqual({ bindings: { half: { other: 'Mod+H' }, bad: 'Mod+Shft+K' } });
    expect(serializeUserKeys({}, keep)).toEqual({ bindings: { bad: 'Mod+Shft+K' } });
    // A command the reader dropped whole and the user has now bound is the user's.
    expect(serializeUserKeys({ half: { other: 'Mod+J' }, bad: 'Mod+K' }, keep)).toEqual({
      bindings: { half: { mac: 'Mod+Shft+J', other: 'Mod+J' }, bad: 'Mod+K' },
    });
  });

  it('never rewrites __proto__ and drops nothing silently past the cap', () => {
    const read = parseUserKeys(JSON.parse('{"bindings":{"__proto__":"x","ok":"Mod+K"}}'));
    expect(Object.keys(read.dropped)).toEqual([]);
  });

  it('setKeyFor binds one platform and keeps the other as it was', () => {
    expect(setKeyFor({}, 'a', 'mac', 'Mod+K')).toEqual({ a: { mac: 'Mod+K' } });
    expect(setKeyFor({ a: 'Mod+J' }, 'a', 'mac', 'Mod+K')).toEqual({ a: { mac: 'Mod+K', other: 'Mod+J' } });
    expect(setKeyFor({ a: { other: 'Mod+J' } }, 'a', 'mac', 'Mod+J')).toEqual({ a: 'Mod+J' });
    expect(setKeyFor({}, 'a', 'other', null)).toEqual({ a: { other: null } });
  });

  it('setKeyFor with undefined puts the default back and drops an entry with nothing left', () => {
    expect(setKeyFor({ a: { mac: 'Mod+K', other: 'Mod+J' } }, 'a', 'mac', undefined)).toEqual({ a: { other: 'Mod+J' } });
    expect(setKeyFor({ a: { mac: 'Mod+K' }, b: 'Mod+L' }, 'a', 'mac', undefined)).toEqual({ b: 'Mod+L' });
    expect(setKeyFor({ a: 'Mod+K' }, 'a', 'other', undefined)).toEqual({ a: { mac: 'Mod+K' } });
  });

  it('setKeyFor does not change its input', () => {
    const before = { a: 'Mod+K' };
    setKeyFor(before, 'a', 'mac', 'Mod+J');
    expect(before).toEqual({ a: 'Mod+K' });
  });
});

describe('captureKey (rule 4)', () => {
  const ev = (code: string, mods: Partial<{ meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }> = {}, altGraph = false) => ({
    key: 'x',
    code,
    metaKey: mods.meta === true,
    ctrlKey: mods.ctrl === true,
    altKey: mods.alt === true,
    shiftKey: mods.shift === true,
    getModifierState: (name: string) => altGraph && name === 'AltGraph',
  });

  it('records the physical key with Mod for Cmd on a Mac and for Ctrl elsewhere', () => {
    expect(captureKey(ev('KeyK', { meta: true }), 'mac')).toEqual({ spec: 'Mod+K' });
    expect(captureKey(ev('KeyK', { ctrl: true }), 'mac')).toEqual({ spec: 'Ctrl+K' });
    expect(captureKey(ev('KeyK', { ctrl: true, shift: true }), 'other')).toEqual({ spec: 'Mod+Shift+K' });
    expect(captureKey(ev('Digit7', { ctrl: true, alt: true }), 'other')).toEqual({ spec: 'Mod+Alt+7' });
    expect(captureKey(ev('F9', { shift: true }), 'other')).toEqual({ spec: 'Shift+F9' });
    expect(captureKey(ev('Comma', { ctrl: true }), 'other')).toEqual({ spec: 'Mod+,' });
    expect(captureKey(ev('ArrowUp', { alt: true }), 'other')).toEqual({ spec: 'Alt+Up' });
  });

  it('waits while only a modifier is down', () => {
    for (const code of ['ShiftLeft', 'ControlLeft', 'AltRight', 'MetaLeft', 'AltGraph']) {
      expect(captureKey(ev(code, { ctrl: true }), 'other'), code).toBeNull();
    }
  });

  it('refuses a press with the AltGraph state, because it types a character', () => {
    expect(captureKey(ev('KeyE', { ctrl: true, alt: true }, true), 'other')).toEqual({ refusal: 'altGraph' });
  });

  it('refuses what checkUserKey refuses, with its reason', () => {
    expect(captureKey(ev('KeyK'), 'other')).toEqual({ refusal: 'noModifier' });
    expect(captureKey(ev('KeyK', { shift: true }), 'other')).toEqual({ refusal: 'noModifier' });
    expect(captureKey(ev('KeyC', { ctrl: true }), 'other')).toEqual({ refusal: 'reserved' });
    expect(captureKey(ev('KeyQ', { meta: true }), 'mac')).toEqual({ refusal: 'reserved' });
    expect(captureKey(ev('F4', { alt: true }), 'other')).toEqual({ refusal: 'reserved' });
  });

  it('refuses a key it has no name for and the Windows key off macOS', () => {
    expect(captureKey(ev('IntlBackslash', { ctrl: true }), 'other')).toEqual({ refusal: 'unparsable' });
    expect(captureKey(ev('KeyK', { meta: true }), 'other')).toEqual({ refusal: 'unparsable' });
  });
});
