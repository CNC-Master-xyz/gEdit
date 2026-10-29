// Wave Y, batch BL-NC-data: the code-database entries it added or changed, each from a manual
// (sources by document and page in the batch report and plan §7), each marked for the owner's
// review. What the scripts do with them is held in `tests/python/test_bl_nc_data.py`.
//
//   - T093: Klartext cycle 20 CONTOUR DATA, DEF-active, with Q5 and Q7 on the tool axis and the
//     SL cycles 21 to 24 that read it (`usedBy`);
//   - T094: the pattern cycles 220 and 221, which call the cycle defined last at points of
//     their own (`sets.cycle: 'call'`, centre or start `position: 'other'`);
//   - T095: the face milling cycle 233;
//   - T096: the tool names QS13 and QS18 of the SL cycles 21, 22 and 25;
//   - T163: RND and CHF cut at feed (a motion mark), their feed for that block only;
//   - T101, T102: Okuma G24 and G25 (moves to positions in the machine's parameters), G314
//     (turret D);
//   - T103: the fixed point number FP= of Sinumerik G75;
//   - T107: Fanuc G65 and G66 need a P word (both Fanuc profiles).

import { describe, expect, it } from 'vitest';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { loadCodeDb, type CodeDbProblem } from '$lib/core/codes/load';
import { lookupCode, positionOf } from '$lib/core/codes/lookup';
import { resolveCodeDbs } from '$lib/core/codes/resolve';
import type { CodeEntry } from '$lib/core/codes/types';

const RAW = BUILTIN_CODE_DB_JSON as Record<string, { codes: (CodeEntry & { review?: string; usedBy?: string[] })[] }>;
const LOADED = resolveCodeDbs(BUILTIN_CODE_DB_JSON);
const raw = (dialect: string, code: string) => RAW[dialect].codes.find((e) => e.code === code);
const entry = (dialect: string, code: string) => lookupCode(LOADED[dialect], code);
const order = (dialect: string, code: string) => entry(dialect, code)?.params?.map((p) => p.address);
const roles = (dialect: string, code: string) =>
  Object.fromEntries((entry(dialect, code)?.params ?? []).map((p) => [p.address, positionOf(p)]));
const param = (dialect: string, code: string, address: string) => entry(dialect, code)?.params?.find((p) => p.address === address);

const ADDED: [string, string][] = [
  ['heidenhain', 'CYCL DEF 20'],
  ['heidenhain', 'CYCL DEF 220'],
  ['heidenhain', 'CYCL DEF 221'],
  ['heidenhain', 'CYCL DEF 233'],
  ['heidenhain', 'RND'],
  ['heidenhain', 'CHF'],
  ['okuma', 'G24'],
  ['okuma', 'G25'],
  ['okuma', 'G314'],
  ['sinumerik', 'G75'],
  ['fanuc', 'G65'],
  ['fanuc', 'G66'],
];

describe('BL-NC-data (Wave Y): the entries load and wait for the owner\'s review', () => {
  it('loads every database without a problem', () => {
    for (const dialect of ['heidenhain', 'okuma', 'sinumerik', 'fanuc']) {
      const problems: CodeDbProblem[] = [];
      loadCodeDb(BUILTIN_CODE_DB_JSON[dialect as keyof typeof BUILTIN_CODE_DB_JSON], (p) => problems.push(p));
      expect(problems, dialect).toEqual([]);
    }
  });

  it('marks every added or changed entry for review and gives it a description', () => {
    for (const [dialect, code] of ADDED) {
      expect(raw(dialect, code)?.review, `${dialect} ${code}`).toBe('pending');
      expect(entry(dialect, code)?.description?.length ?? 0, `${dialect} ${code}`).toBeGreaterThan(0);
    }
  });
});

describe('T093: Klartext cycle 20 CONTOUR DATA', () => {
  it('is DEF-active: a cycle entry with parameters and no run value, like cycle 14', () => {
    const e = entry('heidenhain', 'CYCL DEF 20');
    expect(e?.group).toBe('cycle');
    expect(e?.sets).toBeUndefined();
    expect(order('heidenhain', 'CYCL DEF 20')).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9']);
  });

  it('has the surface Q5 and the clearance height Q7 on the tool axis, every other value no position', () => {
    expect(roles('heidenhain', 'CYCL DEF 20')).toEqual({
      Q1: 'none', Q2: 'none', Q3: 'none', Q4: 'none', Q5: 'tool-axis', Q6: 'none', Q7: 'tool-axis', Q8: 'none', Q9: 'none',
    });
    expect(param('heidenhain', 'CYCL DEF 20', 'Q8')?.lengthAlong).toBe('plane');
  });

  it('names the SL cycles that read its values (address arithmetic moves them together)', () => {
    // Read from the loaded database: the scripts get the loader's entries, not the file's.
    expect(entry('heidenhain', 'CYCL DEF 20')?.usedBy).toEqual(['CYCL DEF 21', 'CYCL DEF 22', 'CYCL DEF 23', 'CYCL DEF 24']);
    // Cycle 25 has its own surface and clearance height and needs no cycle 20.
    expect(entry('heidenhain', 'CYCL DEF 20')?.usedBy).not.toContain('CYCL DEF 25');
    // The only DEF-active cycle with parameters in any database: the schema is cycle 20's.
    const defActive = Object.entries(RAW).flatMap(([dialect, db]) =>
      db.codes.filter((e) => e.group === 'cycle' && !e.sets?.cycle && (e.params ?? []).length > 0).map((e) => `${dialect} ${e.code}`),
    );
    expect(defActive).toEqual(['heidenhain CYCL DEF 20']);
  });
});

describe('T094: the pattern cycles 220 and 221', () => {
  it('call the cycle defined last, at a centre or start point of their own', () => {
    for (const code of ['CYCL DEF 220', 'CYCL DEF 221']) expect(entry('heidenhain', code)?.sets, code).toEqual({ cycle: 'call' });
    expect(order('heidenhain', 'CYCL DEF 220')).toEqual([
      'Q216', 'Q217', 'Q244', 'Q245', 'Q246', 'Q247', 'Q241', 'Q200', 'Q203', 'Q204', 'Q301', 'Q365',
    ]);
    expect(order('heidenhain', 'CYCL DEF 221')).toEqual([
      'Q225', 'Q226', 'Q237', 'Q238', 'Q242', 'Q243', 'Q224', 'Q200', 'Q203', 'Q204', 'Q301',
    ]);
    const other = (code: string) => Object.entries(roles('heidenhain', code)).filter(([, r]) => r === 'other').map(([a]) => a);
    expect(other('CYCL DEF 220')).toEqual(['Q216', 'Q217']);
    expect(other('CYCL DEF 221')).toEqual(['Q225', 'Q226']);
    for (const code of ['CYCL DEF 220', 'CYCL DEF 221']) {
      expect(roles('heidenhain', code).Q203, code).toBe('tool-axis');
      expect(Object.values(roles('heidenhain', code)), `${code}: every parameter reviewed`).not.toContain(null);
    }
  });
});

describe('T095: the face milling cycle 233', () => {
  it('is a definition with the start and end levels on the tool axis', () => {
    expect(entry('heidenhain', 'CYCL DEF 233')?.sets).toEqual({ cycle: 'define' });
    expect(order('heidenhain', 'CYCL DEF 233')).toEqual([
      'Q215', 'Q389', 'Q350', 'Q218', 'Q219', 'Q227', 'Q386', 'Q369', 'Q202', 'Q370', 'Q207', 'Q385', 'Q253', 'Q357', 'Q200',
      'Q204', 'Q347', 'Q348', 'Q349', 'Q220', 'Q368', 'Q338', 'Q367',
    ]);
    const r = roles('heidenhain', 'CYCL DEF 233');
    expect(Object.entries(r).filter(([, v]) => v === 'tool-axis').map(([a]) => a)).toEqual(['Q227', 'Q386']);
    expect(Object.values(r)).not.toContain('other');
    expect(Object.values(r)).not.toContain(null);
    // Its sizes in the plane are not scaled by a multiply of one axis, and its corner (Q367)
    // refuses rotate and mirror.
    for (const a of ['Q218', 'Q219', 'Q220']) expect(param('heidenhain', 'CYCL DEF 233', a)?.lengthAlong, a).toBe('plane');
    expect(param('heidenhain', 'CYCL DEF 233', 'Q367')?.inPlane).toBe('side');
    // Feeds are labelled as feeds, the modes are not (Scale Feed reads the labels).
    const feeds = (entry('heidenhain', 'CYCL DEF 233')?.params ?? []).filter((p) => /\bfeed/i.test(p.label)).map((p) => p.address);
    expect(feeds).toEqual(['Q207', 'Q385', 'Q253']);
  });
});

describe('T096: the tool names QS13 and QS18 of the SL cycles', () => {
  it('describe the name written instead of the number, as a value and no position', () => {
    for (const [code, number, name] of [
      ['CYCL DEF 21', 'Q13', 'QS13'],
      ['CYCL DEF 22', 'Q18', 'QS18'],
      ['CYCL DEF 25', 'Q18', 'QS18'],
    ]) {
      const list = order('heidenhain', code) ?? [];
      expect(list.indexOf(name), code).toBe(list.indexOf(number) + 1);
      expect(param('heidenhain', code, name)?.position, code).toBe('none');
      expect(param('heidenhain', code, name)?.required, code).toBeUndefined();
      // A tool number or name is no length: a multiply of the tool axis does not refuse it.
      expect(param('heidenhain', code, name)?.unit, code).toBe('count');
      expect(param('heidenhain', code, number)?.unit, code).toBe('count');
    }
  });
});

describe('T163: Klartext RND and CHF cut at feed', () => {
  it('get a motion mark and keep their feed to their own block', () => {
    // RND is marked as a feed move, not as an arc: as an arc (`path: 'arc'`) its corner radius R
    // would be read as an arc radius by address arithmetic and the transforms.
    expect(entry('heidenhain', 'RND')?.sets).toEqual({ motion: 'feed' });
    expect(entry('heidenhain', 'CHF')?.sets).toEqual({ motion: 'feed' });
    for (const code of ['RND', 'CHF']) {
      expect(entry('heidenhain', code)?.blockFeed, code).toBe(true);
      expect(entry('heidenhain', code)?.modal, code).toBeUndefined();
      // No direction flag: the direction of the rounding follows from the corner.
      expect(entry('heidenhain', code)?.sets?.arcDirection, code).toBeUndefined();
    }
  });
});

describe('T101, T102: Okuma G24, G25 and G314', () => {
  it('reads G24 and G25 as rapid moves to positions set in the machine, like G20 and G21', () => {
    for (const code of ['G24', 'G25']) {
      expect(entry('okuma', code)?.axisWords, code).toBe('machine');
      expect(entry('okuma', code)?.sets, code).toEqual({ motion: 'rapid' });
      expect(entry('okuma', code)?.modal, code).toBeUndefined();
    }
  });

  it('knows G314 as turret D, in the turret group with G13, G14 and G313', () => {
    expect(entry('okuma', 'G314')?.group).toBe('turret');
    expect(entry('okuma', 'G314')?.label).toBe('Turret D');
    expect(entry('okuma', 'G313')?.group).toBe('turret');
  });
});

describe('T164: the Okuma C-axis contour arcs G102 and G103 (an NC look, no change)', () => {
  it('stay arcs by radius L under 180 degrees, with no direction flag', () => {
    // OSP-P300 programming manual: G102 clockwise, G103 counter-clockwise, X and C together,
    // L the radius, the arc under 180 degrees chosen. The text does not say from which side
    // the face is seen, so a mirror keeps refusing them (plan §7 #297).
    for (const code of ['G102', 'G103']) {
      expect(entry('okuma', code)?.sets, code).toEqual({ motion: 'feed', path: 'arc' });
      expect(param('okuma', code, 'L')?.required, code).toBe(true);
      expect(entry('okuma', code)?.description, code).toMatch(/under 180 degrees/);
    }
    expect(entry('okuma', 'G102')?.label).toMatch(/clockwise/);
    expect(entry('okuma', 'G103')?.label).toMatch(/counter-clockwise/);
  });
});

describe('T103: the fixed point of Sinumerik G75', () => {
  it('describes FP= as the number of a fixed point, 0 to 4, no position', () => {
    const fp = param('sinumerik', 'G75', 'FP');
    expect(fp).toMatchObject({ min: 0, max: 4, unit: 'count' });
    expect(fp?.position).toBeUndefined();
    expect(entry('sinumerik', 'G75')?.axisWords).toBe('machine');
  });
});

describe('T107: Fanuc G65 and G66 need P', () => {
  it('requires the program number on the mill and both lathe databases', () => {
    for (const dialect of ['fanuc', 'fanuc-lathe', 'fanuc-lathe-b']) {
      for (const code of ['G65', 'G66']) expect(entry(dialect, code)?.requires, `${dialect} ${code}`).toEqual(['P']);
    }
  });
});
