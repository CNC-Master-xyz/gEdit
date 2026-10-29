// Which scripts are offered, and in what order (plan §5 WP5.1 step 1, §5 WP5.2).
//
// The filter is the one gate both work packages go through, so what it hides has to be
// hidden everywhere: the ribbon, the palette, `script.run:<id>` and `script.runLast`. The
// tests are written as the five rules of the module header, one by one, because each of
// them errs towards *showing* a script and that bias is the point.

import { describe, expect, it } from 'vitest';
import { fitsProfile, groupScripts, scriptLabel, scriptsForProfile } from './filter';
import type { ScriptEntry, ScriptMeta } from '$lib/platform/commands';

function meta(over: Partial<ScriptMeta> = {}): ScriptMeta {
  return {
    name: 'Scale feed rates',
    description: 'Scales every feed word by a percentage.',
    profiles: null,
    input: 'selection-or-document',
    output: 'replace',
    timeout: null,
    envelope: true,
    documents: 'active',
    params: [],
    warnings: [],
    ...over,
  };
}

function entry(id: string, over: Partial<ScriptEntry> = {}): ScriptEntry {
  return {
    id,
    root: id.split(':')[0],
    group: null,
    fileName: id.split(':')[1] ?? id,
    meta: meta(),
    headerError: null,
    shadowed: false,
    editable: false,
    ...over,
  };
}

describe('scriptsForProfile', () => {
  it('drops a shadowed script, which is unreachable by id anyway', () => {
    const entries = [entry('bundled:scale_feed.py', { shadowed: true }), entry('user:scale_feed.py')];
    expect(scriptsForProfile(entries, 'fanuc-gcode').map((s) => s.id)).toEqual(['user:scale_feed.py']);
  });

  it('offers a script with no header for every profile: v1 predates the field', () => {
    const v1 = entry('user:old.py', { meta: null });
    expect(fitsProfile(v1, 'fanuc-gcode')).toBe(true);
    expect(fitsProfile(v1, 'heidenhain-klartext')).toBe(true);
  });

  it('offers a script whose header did not parse, for the same reason', () => {
    const broken = entry('user:broken.py', { meta: null, headerError: '`name` must not be empty' });
    expect(fitsProfile(broken, 'heidenhain-klartext')).toBe(true);
  });

  it('treats an omitted `profiles` as every profile', () => {
    expect(fitsProfile(entry('user:x.py', { meta: meta({ profiles: null }) }), 'anything')).toBe(true);
  });

  it('compares the profile id exactly', () => {
    const fanuc = entry('bundled:x.py', { meta: meta({ profiles: ['fanuc-gcode'] }) });
    expect(fitsProfile(fanuc, 'fanuc-gcode')).toBe(true);
    expect(fitsProfile(fanuc, 'Fanuc-GCode')).toBe(false);
    expect(fitsProfile(fanuc, 'heidenhain-klartext')).toBe(false);
  });

  it('hides nothing when no document is open', () => {
    const fanuc = entry('bundled:x.py', { meta: meta({ profiles: ['fanuc-gcode'] }) });
    expect(fitsProfile(fanuc, null)).toBe(true);
  });

  it('keeps the order `scripts_list` gave', () => {
    const entries = [entry('bundled:b.py'), entry('bundled:a.py'), entry('user:c.py')];
    expect(scriptsForProfile(entries, 'fanuc-gcode').map((s) => s.id)).toEqual([
      'bundled:b.py',
      'bundled:a.py',
      'user:c.py',
    ]);
  });
});

describe('groupScripts', () => {
  it('puts the ungrouped scripts first, then one section per subfolder', () => {
    const entries = [
      entry('bundled:a.py'),
      entry('user:lathe/b.py', { group: 'lathe' }),
      entry('user:c.py'),
      entry('user:mill/d.py', { group: 'mill' }),
      entry('user:lathe/e.py', { group: 'lathe' }),
    ];
    expect(groupScripts(entries)).toEqual([
      { group: null, scripts: [entries[0], entries[2]] },
      { group: 'lathe', scripts: [entries[1], entries[4]] },
      { group: 'mill', scripts: [entries[3]] },
    ]);
  });

  it('leaves out the ungrouped section when every script sits in a subfolder', () => {
    const entries = [entry('user:mill/d.py', { group: 'mill' })];
    expect(groupScripts(entries).map((section) => section.group)).toEqual(['mill']);
  });

  it('answers with nothing for nothing', () => {
    expect(groupScripts([])).toEqual([]);
  });

  it('treats an empty group name as no group', () => {
    const entries = [entry('user:a.py', { group: '' })];
    expect(groupScripts(entries)).toEqual([{ group: null, scripts: entries }]);
  });
});

describe('groupScripts: the sections of packages (P4g, §6.9 rule 10)', () => {
  it('gives every package and subfolder a section of its own, after the ungrouped one, in listing order', () => {
    const entries = [
      entry('bundled:a.py'),
      entry('pkg-shop-a:facing.py'),
      entry('pkg-shop-a:finish/chamfer.py', { group: 'finish' }),
      entry('pkg-shop-b:facing.py'),
      entry('user:c.py'),
      entry('user:finish/d.py', { group: 'finish' }),
    ];
    expect(groupScripts(entries)).toEqual([
      { group: null, scripts: [entries[0], entries[4]] },
      { group: null, package: 'shop-a', scripts: [entries[1]] },
      { group: 'finish', package: 'shop-a', scripts: [entries[2]] },
      { group: null, package: 'shop-b', scripts: [entries[3]] },
      { group: 'finish', scripts: [entries[5]] },
    ]);
  });

  it('does not put a package folder and a user folder of one name into one section', () => {
    const entries = [entry('pkg-shop-a:turning/a.py', { group: 'turning' }), entry('user:turning/b.py', { group: 'turning' })];
    const sections = groupScripts(entries);
    expect(sections).toHaveLength(2);
    expect(sections.map((section) => section.package)).toEqual(['shop-a', undefined]);
  });

  it('leaves a package out of a section that is not one (a root named like a package but not a package name)', () => {
    expect(groupScripts([entry('pkg-Shop:a.py')]).map((section) => section.package)).toEqual([undefined]);
  });

  it('keeps a shadowed package script out of the offered list, like any other', () => {
    const entries = [entry('pkg-shop-a:facing.py', { shadowed: true }), entry('user:facing.py')];
    expect(scriptsForProfile(entries, null).map((s) => s.id)).toEqual(['user:facing.py']);
  });
});

describe('scriptLabel', () => {
  it('is the header name', () => {
    expect(scriptLabel(entry('bundled:scale_feed.py'))).toBe('Scale feed rates');
  });

  it('falls back to the file name without a header', () => {
    expect(scriptLabel(entry('user:old.py', { meta: null }))).toBe('old.py');
  });

  it('falls back to the file name for a blank header name', () => {
    expect(scriptLabel(entry('user:old.py', { meta: meta({ name: '   ' }) }))).toBe('old.py');
  });
});
