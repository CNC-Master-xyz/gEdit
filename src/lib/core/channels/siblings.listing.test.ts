// The sibling lookup from a folder listing and the path-1 file (P4.30b; rules L1 to L3 in
// `siblings.ts`, `firstFileName` in `types.ts`).

import { describe, expect, it } from 'vitest';
import { profileOf } from '../../../../tests/unit/helpers/profiles';
import { fileChannel, listingPattern, siblingNames, siblingsFromListing } from './siblings';
import type { ChannelParams } from './types';

/** The shape of the Fanuc three-path preset: `PART_2.ISO`, `PART_3.ISO`, and the path-1 file `PART`. */
const three: ChannelParams = {
  layout: 'multi-file',
  list: [
    { id: '1', name: 'Path 1' },
    { id: '2', name: 'Path 2' },
    { id: '3', name: 'Path 3' },
  ],
  fileName: '^(?<stem>.+)_(?<channel>\\d{1,2})\\.[A-Za-z]+$',
  firstFileName: '^(?<stem>[^.]+)$',
  syncMarks: [],
};


describe('the path-1 file (firstFileName, T055)', () => {
  it('a name that only firstFileName explains is the first channel s file, with its stem', () => {
    expect(fileChannel('PART', three)).toMatchObject({ channel: { id: '1' }, stem: 'PART', by: 'first' });
    expect(fileChannel('part_2.iso', three)).toMatchObject({ channel: { id: '2' }, stem: 'part', by: 'pattern' });
    // The pattern and the templates come first: PART_1.ISO is still path 1 by its name.
    expect(fileChannel('PART_1.ISO', three)).toMatchObject({ channel: { id: '1' }, by: 'pattern' });
    // An extension the path-1 pattern does not allow: no channel file.
    expect(fileChannel('PART.ISO', three)).toBeNull();
  });

  it('without firstFileName nothing changes (no default)', () => {
    const { firstFileName: _gone, ...without } = three;
    expect(fileChannel('PART', without)).toBeNull();
    expect(siblingNames('PART_2.ISO', without)?.map((s) => s.name)).toEqual(['PART_1.ISO', 'PART_3.ISO']);
  });

  it('a pattern with a channel group, without a stem, an empty stem or one that does not compile is no path-1 rule', () => {
    expect(fileChannel('PART', { ...three, firstFileName: '^(?<stem>[^.]+)(?<channel>)$' })).toBeNull();
    expect(fileChannel('PART', { ...three, firstFileName: '^[^.]+$' })).toBeNull();
    expect(fileChannel('PART', { ...three, firstFileName: '^(?<stem>)PART$' })).toBeNull();
    expect(fileChannel('PART', { ...three, firstFileName: '^(?<stem>[^.]+$' })).toBeNull();
  });

  it('with firstFileName the derived names stay as they were (the listing of the folder decides the first channel, in the service)', () => {
    expect(siblingNames('PART_2.ISO', three)?.map((s) => [s.channel.id, s.name])).toEqual([
      ['1', 'PART_1.ISO'],
      ['3', 'PART_3.ISO'],
    ]);
    // A template of the channel's own still names it.
    const own: ChannelParams = { ...three, list: [{ id: '1', name: 'Path 1', fileName: '{{stem}}' }, three.list[1], three.list[2]] };
    expect(siblingNames('PART_2.ISO', own)?.map((s) => s.name)).toEqual(['PART', 'PART_3.ISO']);
  });

  it('the shipped preset carries the line, marked verify', () => {
    const preset = profileOf('fanuc-lathe').machineParams?.channels?.presets.find((p) => p.id === 'fanuc-3path-digits-nop12');
    expect(preset?.verify).toBe(true);
    expect(preset?.value.firstFileName).toBe('^(?<stem>[^.]+)$');
    // Only these presets have one (the owner's decisions: nop12, and on 2026-10-28 (P4f NC-7)
    // the four `.P-n` presets, whose path-1 file the Fanuc manual writes without an extension).
    const withFirst = ['fanuc-3path-digits-nop12', 'fanuc-2path', 'fanuc-2path-digits', 'fanuc-3path-digits', 'fanuc-3path-bitmask'];
    for (const id of ['fanuc-lathe', 'sinumerik', 'okuma-osp', 'fanuc-gcode', 'sinumerik-mill', 'heidenhain-klartext']) {
      for (const p of profileOf(id).machineParams?.channels?.presets ?? []) {
        if (!withFirst.includes(p.id)) expect(p.value.firstFileName, `${id}/${p.id}`).toBeUndefined();
      }
    }
  });
});

describe('siblings from a listing', () => {
  it('L1: the glob is the stem and *, null for a name that is no channel file or a stem under two characters', () => {
    expect(listingPattern('PART_2.ISO', three)).toBe('PART*');
    expect(listingPattern('PART', three)).toBe('PART*');
    expect(listingPattern('NOTES.TXT', three)).toBeNull();
    expect(listingPattern('P_2.ISO', three)).toBeNull();
    // A stem that holds a wildcard character is not looked for.
    expect(listingPattern('PA*RT_2.ISO', three)).toBeNull();
    // A stem that is not at the start of the name is looked for anywhere.
    const after: ChannelParams = { ...three, fileName: '^CH(?<channel>\\d)_(?<stem>.+)$', firstFileName: undefined };
    expect(listingPattern('CH2_SHAFT', after)).toBe('*SHAFT*');
  });

  it('L2: names with the same stem and another channel are found; a channel with two names is ambiguous and gets none', () => {
    const found = siblingsFromListing('PART_2.ISO', ['PART', 'PART_2.ISO', 'part_3.iso', 'PARTS_3.ISO', 'PART.BAK', 'PART_7.ISO'], three);
    expect(found?.found.map((f) => [f.channel.id, f.name])).toEqual([
      ['1', 'PART'],
      ['3', 'part_3.iso'],
    ]);
    expect(found?.ambiguous).toEqual([]);
    expect(found?.missing).toEqual([]);
    const two = siblingsFromListing('PART_2.ISO', ['PART', 'PART_1.ISO', 'PART_3.ISO'], three);
    expect(two?.found.map((f) => f.name)).toEqual(['PART_3.ISO']);
    expect(two?.ambiguous).toEqual([{ channel: expect.objectContaining({ id: '1' }), names: ['PART', 'PART_1.ISO'] }]);
  });

  it('L2: the path-1 file (firstFileName, no channel marker) is the first channel s file of its stem', () => {
    const r = siblingsFromListing('PART', ['PART', 'PART_2.ISO', 'PART_3.ISO', 'OTHER_2.ISO'], three);
    expect(r?.found.map((f) => [f.channel.id, f.name])).toEqual([
      ['2', 'PART_2.ISO'],
      ['3', 'PART_3.ISO'],
    ]);
  });

  it('L2: a declared channel with no name is missing; the document s own name is never a sibling', () => {
    const r = siblingsFromListing('PART_2.ISO', ['PART_2.ISO', 'part_2.iso'], three);
    expect(r?.found).toEqual([]);
    expect((r?.missing ?? []).map((m) => m.id)).toEqual(['1', '3']);
    // A document that is channel 3 by its header (`self`): its own channel is left out, the name's own channel is looked for.
    const header = siblingsFromListing('PART_2.ISO', ['PART', 'PART_3.ISO'], three, '3');
    expect(header?.found.map((f) => f.channel.id)).toEqual(['1']);
    expect((header?.missing ?? []).map((m) => m.id)).toEqual(['2']);
    expect(siblingsFromListing('NOTES.TXT', ['PART'], three)).toBeNull();
  });

  it('L3: the result opens nothing', () => {
    // Pure: the answer is names; a listing with a path or a name no file may have is skipped.
    const r = siblingsFromListing('PART_2.ISO', ['../PART_3.ISO', 'sub/PART_3.ISO', 'PART_3.ISO'], three);
    expect(r?.found.map((f) => f.name)).toEqual(['PART_3.ISO']);
  });
});
