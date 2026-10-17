// The programs of the P4e runtime scenarios (`tests/fixtures/p4e/`) and the alignment the scenario `p4-channels` expects
// of them. The scenario cannot run in `npm test`; this holds its numbers (the lines of the waits, the filler zones, which
// marks are matched) to what the core says for the same programs, so a changed fixture or a changed alignment rule fails
// here, in seconds, and not in the hosted runtime run an hour later. The expected values below are worked out by hand
// from the line numbers (a wait is pushed down to the lowest of its partners, then every pane is as tall as the tallest);
// they are the same as in the scenario and in `tests/fixtures/p4e/README.md`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { alignPanes, marksInPane, projectChannel } from '$lib/core/channels/panes';
import { resolveDocument } from '$lib/core/channels/marks';
import { compileProfile } from '$lib/core/profiles/compile';
import { detectProfile } from '$lib/core/profiles/detect';
import { validateProfile } from '$lib/core/profiles/validate';
import { FIXTURES_DIR } from './helpers/fixtures';
import type { ChannelParams, ChannelSet } from '$lib/core/channels/types';
import type { CompiledProfile } from '$lib/core/profiles/types';

const DIR = join(FIXTURES_DIR, 'p4e', 'channels');
const BUILTINS: CompiledProfile[] = BUILTIN_PROFILE_JSON.map((raw) => {
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  return compileProfile(checked.profile);
});
const lathe = BUILTINS.find((c) => c.profile.id === 'fanuc-lathe') as CompiledProfile;

const read = (name: string) => readFileSync(join(DIR, name), 'latin1');
const linesOf = (name: string) => read(name).replace(/\n$/, '').split('\n');
const sorted = (zones: { pane: number; afterLine: number; lines: number }[]) => zones.map((z) => `${z.pane}:${z.afterLine}:${z.lines}`).sort();

/** The channel block of the golden the scenario uses for the two-channel program (`c10-alternating`). */
const twinBlock = (JSON.parse(readFileSync(join(FIXTURES_DIR, 'channels', 'resolve', 'c10-alternating.json'), 'utf8')) as { machine: { channels: ChannelParams } }).machine.channels;
const threePath = (lathe.profile.machineParams?.channels?.presets.find((p) => p.id === 'fanuc-3path-digits') as { value: ChannelParams }).value;

describe('the P4e fixture programs', () => {
  const names = ['twin-sections.nc', 'threepath.NC1', 'threepath.NC2', 'threepath.NC3'];
  const readme = readFileSync(join(FIXTURES_DIR, 'p4e', 'README.md'), 'utf8');

  it.each(names)('%s is written for gEdit, LF, ends with a line break, is listed, and is read as a Fanuc lathe program', (name) => {
    const text = read(name);
    expect(text).not.toContain('\r');
    expect(text.endsWith('\n')).toBe(true);
    expect(text.split('\n', 1)[0]).toMatch(/^\(WRITTEN FOR GEDIT\b.*SYNTHETIC/);
    expect(readme).toContain(`\`${name}\``);
    expect(detectProfile(BUILTINS, `/work/${name}`, text, 'fanuc-gcode')).toBe('fanuc-lathe');
  });
});

describe('twin-sections.nc in the channel view (p4-channels, section B)', () => {
  const lines = linesOf('twin-sections.nc');
  const resolved = resolveDocument('twin-sections.nc', lines, lathe, twinBlock, {});
  const set = {
    layout: resolved.layout,
    self: null,
    members: resolved.sections.map((s) => ({ kind: 'section', channel: s.channel, docId: 'd', ranges: s.ranges })),
    missing: [],
    outside: resolved.outside,
    marks: resolved.marks,
    problems: [],
    truncated: false,
  } as unknown as ChannelSet;
  const panes = resolved.sections.map((s) => {
    const proj = projectChannel(set, s.channel.id);
    if (proj === null) throw new Error('no projection');
    return { channel: s.channel, lineCount: proj.lineCount, marks: marksInPane(proj, resolved.marks) };
  });
  const aligned = alignPanes(panes, twinBlock.syncMarks);

  it('has 206 lines, channel 1 on 4 to 100 and channel 2 on 101 to 205, and line 206 in no channel', () => {
    expect(lines).toHaveLength(206);
    expect(resolved.sections.map((s) => [s.channel.id, s.ranges])).toEqual([
      ['1', [{ startLine: 4, endLine: 100 }]],
      ['2', [{ startLine: 101, endLine: 205 }]],
    ]);
    expect(resolved.outside).toEqual([
      { startLine: 1, endLine: 3 },
      { startLine: 206, endLine: 206 },
    ]);
  });

  it('has the owner\'s waits: M901P12 and M910P12 in both channels (the machine has two; a P123 would name a missing channel 3), M920P12 in channel 1 only', () => {
    expect(resolved.marks.map((m) => [m.mark, m.line, m.channel, m.partners])).toEqual([
      ['M901', 9, '1', ['1', '2']],
      ['M910', 60, '1', ['1', '2']],
      ['M920', 80, '1', ['1', '2']],
      ['M901', 103, '2', ['1', '2']],
      ['M910', 167, '2', ['1', '2']],
    ]);
  });

  it('has panes of 100 and 108 lines, 4 waits lined up and M920P12 unmatched, and the three filler zones the scenario expects', () => {
    expect(panes.map((p) => p.lineCount)).toEqual([100, 108]);
    expect(aligned.states).toEqual([
      ['matched', 'matched', 'unmatched'],
      ['matched', 'matched'],
    ]);
    expect(sorted(aligned.zones)).toEqual(['0:59:13', '1:108:2', '1:5:3'].sort());
  });
});

// The editor's text of a file that ends with a line break has one empty line more than the file's lines; the runtime scenario
// reads the alignment of THAT text (the numbers above were once worked out without it).
describe('the same programs as the editor holds them, with the empty line after the last line break (p4-channels)', () => {
  const modelOf = (name: string) => read(name).split('\n');

  it('twin-sections.nc: 207 lines, 2 of them in no channel (the % and the empty last line), the same panes and zones', () => {
    const lines = modelOf('twin-sections.nc');
    const resolved = resolveDocument('twin-sections.nc', lines, lathe, twinBlock, {});
    expect(lines).toHaveLength(207);
    expect(resolved.outside).toEqual([
      { startLine: 1, endLine: 3 },
      { startLine: 206, endLine: 207 },
    ]);
    const set = {
      layout: resolved.layout,
      self: null,
      members: resolved.sections.map((s) => ({ kind: 'section', channel: s.channel, docId: 'd', ranges: s.ranges })),
      missing: [],
      outside: resolved.outside,
      marks: resolved.marks,
      problems: [],
      truncated: false,
    } as unknown as ChannelSet;
    const panes = resolved.sections.map((s) => {
      const proj = projectChannel(set, s.channel.id);
      if (proj === null) throw new Error('no projection');
      return { channel: s.channel, lineCount: proj.lineCount, marks: marksInPane(proj, resolved.marks) };
    });
    const aligned = alignPanes(panes, twinBlock.syncMarks);
    expect(panes.map((p) => p.lineCount)).toEqual([100, 108]);
    expect(sorted(aligned.zones)).toEqual(['0:59:13', '1:108:2', '1:5:3'].sort());
    expect(aligned.states).toEqual([
      ['matched', 'matched', 'unmatched'],
      ['matched', 'matched'],
    ]);
  });

  it('threepath.NC1 to NC3: 23, 25 and 21 lines, the filler zones one line later after the last wait of paths 1 and 2, then every subset the scenario closes to', () => {
    const lines = ['threepath.NC1', 'threepath.NC2', 'threepath.NC3'].map(modelOf);
    expect(lines.map((l) => l.length)).toEqual([23, 25, 21]);
    const zonesOf = (shown: number[]) =>
      sorted(
        alignPanes(
          shown.map((p, k) => {
            const r = resolveDocument(`threepath.NC${p + 1}`, lines[p], lathe, threePath, {});
            return { channel: { ...threePath.list[p], index: k }, lineCount: lines[p].length, marks: r.marks.map((m) => ({ ...m, channel: String(p + 1) })) };
          }),
          threePath.syncMarks,
        ).zones,
      );
    expect(zonesOf([0, 1, 2])).toEqual(['0:14:5', '0:23:1', '1:25:2', '1:6:2', '2:11:8'].sort());
    expect(zonesOf([0, 1])).toEqual(['0:14:5', '1:25:1', '1:6:2'].sort());
    expect(zonesOf([1, 2])).toEqual(['0:25:2', '1:11:6'].sort());
    expect(zonesOf([0, 2])).toEqual(['0:23:1', '1:11:3'].sort());
  });
});

describe('the three-path set in the channel view (p4-channels, section C)', () => {
  const files = ['threepath.NC1', 'threepath.NC2', 'threepath.NC3'];
  const lines = files.map(linesOf);
  const resolved = files.map((name, i) => resolveDocument(name, lines[i], lathe, threePath, {}));

  it('has 22, 24 and 20 lines, path 1 to 3 by the extension, and no problem', () => {
    expect(lines.map((l) => l.length)).toEqual([22, 24, 20]);
    expect(resolved.map((r) => [r.layout, r.self?.id, r.problems.length])).toEqual([
      ['multi-file', '1', 0],
      ['multi-file', '2', 0],
      ['multi-file', '3', 0],
    ]);
  });

  it('has the owner\'s waits and M920P13 in path 3 only', () => {
    expect(resolved.map((r) => r.marks.map((m) => [m.mark, m.line, m.partners]))).toEqual([
      [['M901', 9, ['1', '2']], ['M910', 15, ['1', '2', '3']]],
      [['M901', 7, ['1', '2']], ['M910', 18, ['1', '2', '3']]],
      [['M910', 12, ['1', '2', '3']], ['M920', 16, ['1', '3']]],
    ]);
  });

  it('lines up 5 of 6, leaves M920P13 unmatched, and gives the five filler zones the scenario expects', () => {
    const aligned = alignPanes(
      resolved.map((r, i) => ({ channel: { ...threePath.list[i], index: i }, lineCount: lines[i].length, marks: r.marks.map((m) => ({ ...m, channel: String(i + 1) })) })),
      threePath.syncMarks,
    );
    expect(aligned.states).toEqual([
      ['matched', 'matched'],
      ['matched', 'matched'],
      ['matched', 'unmatched'],
    ]);
    expect(sorted(aligned.zones)).toEqual(['0:14:5', '0:22:1', '1:24:2', '1:6:2', '2:11:8'].sort());
  });
});
