// A comparison limited to a channel (P4.31, plan section 6.8.6): both sides cut to the channel's
// lines, the result says which channel it is, the maps name the files' lines, nothing is copied
// from a cut, the aligned view is put aside for it, and a side without that channel refuses in
// plain words. The service runs on the real document and layout stores with fake sides.

import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCompareService, type CompareController, type CompareDeps } from './compare';
import { TOY_PROGRAM, toySet } from '$lib/core/channels/paneFixtures';
import type { ChannelSet } from '$lib/core/channels/types';
import { createDocumentStore } from '$lib/stores/documents';
import { createLayoutStore } from '$lib/stores/layout';
import { profiles as appProfiles } from '$lib/stores/profiles';
import type { EffectiveProfile } from '$lib/core/machines/types';
import type { DecodeResult, DocId, NewDocMeta, StatusService } from '$lib/app/types';

function newDoc(over: Partial<NewDocMeta> = {}): NewDocMeta {
  return {
    path: null,
    untitledIndex: 1,
    profileId: 'fanuc-gcode',
    encoding: { encoding: 'utf-8', hasBom: false },
    eol: 'crlf',
    eolMixed: false,
    eolMixedOnLoad: false,
    nul: { leader: 0, trailer: 0, stripped: 0 },
    textDirty: false,
    metaDirty: false,
    disk: null,
    external: 'none',
    readOnly: false,
    readOnlyReason: null,
    ...over,
  } as NewDocMeta;
}

const decoded = (text: string): DecodeResult => ({
  ok: true,
  text,
  encoding: { encoding: 'utf-8', hasBom: false },
  eol: 'lf',
  eolMixed: false,
  nul: { leader: 0, trailer: 0, stripped: 0 },
});

/** The program with its channels, two edits in channel 1 and one in channel 2. */
const BEFORE = TOY_PROGRAM;
const AFTER = ['%', 'O1000 (new)', '$1', 'A1', 'A2 X', '$2', 'B1', '$1', 'A3', '$2', 'B2 Y'];

interface World {
  service: CompareController;
  messages: string[];
  texts: Map<DocId, string>;
  sets: Map<DocId, ChannelSet>;
  a: DocId;
  b: DocId;
  savedSets: string[][];
  memory: { value: unknown };
  revealed: string[];
  untitled: string[];
}

function world(): World {
  const docs = createDocumentStore({ caseInsensitivePaths: false });
  const layout = createLayoutStore({ regionOf: () => 'overlay' });
  const messages: string[] = [];
  const texts = new Map<DocId, string>();
  const sets = new Map<DocId, ChannelSet>();
  const savedSets: string[][] = [];
  const memory = { value: undefined as unknown };
  const revealed: string[] = [];
  const untitled: string[] = [];
  const a = docs.add(newDoc({ path: '/nc/prog.nc', untitledIndex: null }), { activate: true });
  const b = docs.add(newDoc({ path: '/nc/old.nc', untitledIndex: null }), { activate: false });
  texts.set(a, AFTER.join('\n'));
  texts.set(b, BEFORE.join('\n'));
  sets.set(a, toySet(AFTER));
  sets.set(b, toySet(BEFORE));
  const status: StatusService = {
    current: { subscribe: () => () => {} },
    show(text, o) {
      messages.push(`${o?.error === true ? '!' : ''}${text}`);
    },
    clear() {},
  };
  const deps: CompareDeps = {
    docs,
    layout,
    status,
    profiles: { detect: (_p, _t, fallback) => fallback, compiled: (id) => appProfiles.compiled(id) },
    files: {
      open: () => Promise.resolve([]),
      newUntitled: (o) => {
        untitled.push(o?.text ?? '');
        return docs.add(newDoc({ untitledIndex: docs.nextUntitledIndex() }), { activate: false });
      },
    },
    readDisk: () => Promise.resolve(decoded(BEFORE.join('\n'))),
    statSize: () => Promise.resolve(null),
    charCountOf: () => 10,
    textOf: (id) => texts.get(id) ?? '',
    effectiveOf: (id): EffectiveProfile => {
      const profileId = docs.get(id)?.profileId ?? 'fanuc-gcode';
      return {
        profile: appProfiles.profile(profileId),
        cp: appProfiles.compiled(profileId),
        codes: undefined as never,
        machine: { id: 'm', name: 'Twin', choice: 'document', key: 'm', params: { numberInput: { mode: 'calculator' } }, source: { numberInput: 'machine' } } as never,
      };
    },
    pickFile: () => Promise.resolve(null),
    diff: () => ({ reveal: (side: string, line: number) => void revealed.push(`${side}:${line}`) }) as never,
    channelSet: (id, lines) => {
      if (lines === undefined) return sets.get(id) ?? toySet([]);
      savedSets.push([...lines]);
      return toySet(lines);
    },
    memory: { read: () => memory.value, write: (m) => void (memory.value = m) },
    focusEditorWhenBack: () => {},
  };
  return { service: createCompareService(deps), messages, texts, sets, a, b, savedSets, memory, revealed, untitled };
}

let w: World;
beforeEach(() => {
  w = world();
});

describe('a comparison limited to a channel', () => {
  it('cuts both sides to the lines of the channel, in raw mode as written', async () => {
    expect(await w.service.open(w.a, { kind: 'document', docId: w.b }, { channel: '1' })).toBe(true);
    const sides = get(w.service.sides);
    expect(sides?.modified).toEqual({ kind: 'text', text: ['$1', 'A1', 'A2 X', '$1', 'A3'].join('\n'), languageId: 'fanuc-gcode' });
    expect(sides?.original).toEqual({ kind: 'text', text: ['$1', 'A1', 'A2', '$1', 'A3'].join('\n'), languageId: 'fanuc-gcode' });
  });

  it('says which channel the comparison is about, with the machine s name for it', async () => {
    await w.service.open(w.a, { kind: 'document', docId: w.b }, { channel: '2' });
    expect(get(w.service.session)?.title).toContain('Channel 2');
    expect(get(w.service.content)?.channel).toEqual({ id: '2', name: 'Channel 2' });
  });

  it('without a channel it is the whole program and its title is the usual one', async () => {
    await w.service.open(w.a, { kind: 'document', docId: w.b });
    expect(get(w.service.content)?.channel).toBeUndefined();
    expect(get(w.service.session)?.title).not.toContain('Channel');
    expect(get(w.service.sides)).toEqual({ original: { kind: 'document', docId: w.b }, modified: { kind: 'document', docId: w.a } });
  });

  it('go to line names the files line, not the line of the cut', async () => {
    await w.service.open(w.a, { kind: 'document', docId: w.b }, { channel: '1' });
    // The cut of channel 1 holds the file's lines 3, 4, 5, 8 and 9.
    expect([...(get(w.service.review)?.modified.lineMap ?? [])]).toEqual([3, 4, 5, 8, 9]);
    expect(w.service.goToLine(8, 'modified')).toBe(true);
    expect(w.revealed).toEqual(['modified:4']);
  });

  it('review mode normalizes the cut and its map still names the files lines', async () => {
    await w.service.open(w.a, { kind: 'document', docId: w.b }, { channel: '2' });
    w.service.setMode('review');
    const review = get(w.service.review);
    expect(review).not.toBeNull();
    const map = [...(review?.modified.lineMap ?? [])];
    expect(map.length).toBeGreaterThan(0);
    for (const line of map) expect([6, 7, 10, 11]).toContain(line);
  });

  it('refuses when a document has no lines of the channel, leaving the editor as it was', async () => {
    w.sets.set(w.b, toySet(['%', '$1', 'A']));
    expect(await w.service.open(w.a, { kind: 'document', docId: w.b }, { channel: '2' })).toBe(false);
    expect(w.messages.at(-1)).toBe('!old.nc has no lines of Channel 2.');
    expect(get(w.service.content)).toBeNull();
  });

  it('refuses a program without channel sections in plain words', async () => {
    w.sets.set(w.a, { ...toySet([]), layout: 'none' });
    expect(await w.service.open(w.a, { kind: 'document', docId: w.b }, { channel: '1' })).toBe(false);
    expect(w.messages.at(-1)).toMatch(/^!prog\.nc has no channel sections/);
  });

  it('cuts the saved version by the sections of the same program', async () => {
    expect(await w.service.open(w.a, { kind: 'saved' }, { channel: '2' })).toBe(true);
    expect(w.savedSets).toEqual([BEFORE]);
    expect(get(w.service.sides)?.original).toEqual({ kind: 'text', text: ['$2', 'B1', '$2', 'B2'].join('\n'), languageId: 'fanuc-gcode' });
  });

  it('refuses a file that is not open as a document: it has no machine, so no channels', async () => {
    expect(await w.service.open(w.a, { kind: 'file', path: '/nc/other.nc' }, { channel: '1' })).toBe(false);
    expect(w.messages.at(-1)).toMatch(/^!A file that is not open as a document has no channel rules/);
    expect(get(w.service.content)).toBeNull();
  });

  it('a channel file against its channel in the program: the file is whole, the program is cut', async () => {
    w.sets.set(w.b, {
      layout: 'multi-file',
      self: { id: '2', name: 'Channel 2', index: 1 },
      members: [],
      missing: [],
      outside: [],
      marks: [],
      problems: [],
      truncated: false,
    });
    w.texts.set(w.b, ['$2', 'B1', '$2', 'B2'].join('\n'));
    expect(await w.service.open(w.a, { kind: 'document', docId: w.b }, { channel: '2' })).toBe(true);
    expect(get(w.service.sides)?.original).toEqual({ kind: 'text', text: ['$2', 'B1', '$2', 'B2'].join('\n'), languageId: 'fanuc-gcode' });
    // ...and against channel 1 the other side refuses: it is channel 2's file.
    expect(await w.service.open(w.a, { kind: 'document', docId: w.b }, { channel: '1' })).toBe(false);
    expect(w.messages.at(-1)).toBe('!old.nc is the file of Channel 2, not of Channel 1.');
  });

  it('copies nothing from a cut, and says why', async () => {
    await w.service.open(w.a, { kind: 'document', docId: w.b }, { channel: '1' });
    expect(await w.service.copyChange('toModified')).toBe(false);
    expect(w.messages.at(-1)).toMatch(/^!A comparison limited to a channel/);
    expect(await w.service.copyWord('toModified')).toBe(false);
    const block = get(w.service.copyBlock);
    expect(block.toModified).toBe('review');
    expect(block.toOriginal).toBe('review');
  });

  it('puts the aligned view aside for a cut and back for the next whole comparison', async () => {
    w.memory.value = { aligned: true };
    await w.service.open(w.a, { kind: 'document', docId: w.b }, { channel: '1' });
    expect(get(w.service.aligned)).toBe(false);
    w.service.setAligned(true);
    expect(get(w.service.aligned)).toBe(false);
    expect(w.messages.at(-1)).toMatch(/^!The aligned view shows whole programs/);
    // The preference is still the user's: a change of another option keeps it in the memo.
    w.service.setInline(true);
    expect((w.memory.value as { aligned?: boolean }).aligned).toBe(true);
    w.service.close();
    expect(get(w.service.aligned)).toBe(true);
    await w.service.open(w.a, { kind: 'document', docId: w.b });
    expect(get(w.service.aligned)).toBe(true);
  });

  it('exports the cut, not the whole program', async () => {
    await w.service.open(w.a, { kind: 'document', docId: w.b }, { channel: '2' });
    const id = await w.service.exportDiff({ normalized: false });
    expect(id).not.toBeNull();
    const text = w.untitled[0];
    expect(text).toContain('B2 Y');
    expect(text).not.toContain('A2 X');
    expect(text).not.toContain('O1000');
  });
});
