// The file names of a channel set written to disk (P4.31; rules N1 to N4 in `fileNames.ts`).

import { describe, expect, it } from 'vitest';
import { channelFileName, extensionOf, stemOf } from './fileNames';
import { channelRefs } from './resolve';
import type { ChannelParams } from './types';

function params(o: Partial<ChannelParams> & { names?: (string | undefined)[] } = {}): ChannelParams {
  const { names, ...rest } = o;
  return {
    layout: 'single-file',
    list: [
      { id: '1', name: 'Path 1', ...(names?.[0] !== undefined ? { fileName: names[0] } : {}) },
      { id: '2', name: 'Path 2', ...(names?.[1] !== undefined ? { fileName: names[1] } : {}) },
    ],
    ...rest,
  } as ChannelParams;
}

const name = (stem: string, index: number, p: ChannelParams): string | null => channelFileName(stem, channelRefs(p)[index], p);

describe('channel file names', () => {
  it('N1: the channel s own template, then the shared one, each filled with the stem and the channel id', () => {
    const p = params({ fileNameFor: '{{stem}}_CH{{channel}}.nc', names: ['{{stem}}.MPF', undefined] });
    expect(name('PART', 0, p)).toBe('PART.MPF');
    expect(name('PART', 1, p)).toBe('PART_CH2.nc');
  });

  it('N1: no template: null, and the caller uses the split s default name', () => {
    expect(name('PART', 0, params())).toBeNull();
    expect(name('PART', 1, params({ fileNameFor: '' }))).toBeNull();
  });

  it('N1: the name is never derived from the fileName pattern (nothing to replace in)', () => {
    expect(name('PART', 1, params({ fileName: '^(?<stem>.+)_CH(?<channel>\\d+)\\.nc$' }))).toBeNull();
  });

  it('N2: the stem is the title without its last extension', () => {
    expect(stemOf('PART.MPF')).toBe('PART');
    expect(stemOf('a.b.nc')).toBe('a.b');
    expect(stemOf('NOEXT')).toBe('NOEXT');
    expect(stemOf('.hidden')).toBe('.hidden');
    expect(extensionOf('a.b.nc')).toBe('.nc');
    expect(extensionOf('NOEXT')).toBe('');
    expect(extensionOf('.hidden')).toBe('');
  });

  it('N2: a stem that holds a template word is inserted as written', () => {
    const p = params({ fileNameFor: '{{stem}}_{{channel}}.nc' });
    expect(name('{{channel}}$&', 0, p)).toBe('{{channel}}$&_1.nc');
  });

  it('N3: a name with a path separator or a character no file name holds is null', () => {
    for (const bad of ['../{{stem}}.nc', 'sub/{{stem}}.nc', 'sub\\{{stem}}.nc', '{{stem}}:1.nc', '{{stem}}?.nc', '{{stem}}*.nc', '{{stem}}|1.nc']) {
      const p = params({ fileNameFor: bad.replace('.nc', '_{{channel}}.nc') });
      expect(name('PART', 0, p), bad).toBeNull();
    }
    expect(name('..', 0, params({ fileNameFor: '{{stem}}' }))).toBeNull();
    expect(name('PART', 0, params({ fileNameFor: '{{stem}}_{{channel}}.nc' }))).toBe('PART_1.nc');
  });

  it('N3: a stem that brings a separator into the name makes the name null', () => {
    expect(name('a/b', 0, params({ fileNameFor: '{{stem}}_{{channel}}.nc' }))).toBeNull();
  });

  it('N4: two channels with the same name both get null', () => {
    const p = params({ fileNameFor: '{{stem}}.nc' });
    expect(name('PART', 0, p)).toBeNull();
    expect(name('PART', 1, p)).toBeNull();
  });

  it('N4: the same name in another case is the same name', () => {
    const p = params({ names: ['{{stem}}.MPF', '{{stem}}.mpf'] });
    expect(name('PART', 0, p)).toBeNull();
    expect(name('PART', 1, p)).toBeNull();
  });

  it('N4: a channel whose name is its own keeps it when the other channel has none', () => {
    const p = params({ names: ['{{stem}}.MPF', undefined] });
    expect(name('PART', 0, p)).toBe('PART.MPF');
    expect(name('PART', 1, p)).toBeNull();
  });
});
