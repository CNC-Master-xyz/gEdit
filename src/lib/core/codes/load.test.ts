// The loader and the shipped databases (plan §5, WP3.3). Owner: WP3.3.
//
// Two jobs here: the built-in files must come through without a single problem, and a
// hand-written user database must lose only the broken parts, never the whole file.

import { describe, expect, it } from 'vitest';
import fanucJson from '$lib/data/codes/fanuc.json';
import heidenhainJson from '$lib/data/codes/heidenhain.json';
import okumaJson from '$lib/data/codes/okuma.json';
import sinumerikJson from '$lib/data/codes/sinumerik.json';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import { detectProfile } from '$lib/core/profiles/detect';
import { validateProfile } from '$lib/core/profiles/validate';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { t } from '$lib/i18n';
import { editorText, listFixtures, openFixture } from '../../../../tests/unit/helpers/fixtures';
import { CodeDbError, emptyCodeDb, loadCodeDb, type CodeDbProblem } from './load';
import { resolveCodeDbs } from './resolve';
import { unionCodeDb, variantDialects } from '$lib/monaco/languages';
import { lookupCode } from './lookup';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { LineState } from '$lib/core/nc/types';
import type { CodeDb } from './types';

/** Loads a database and hands back everything the loader had to say about it. */
function load(raw: unknown): { db: CodeDb; problems: CodeDbProblem[] } {
  const problems: CodeDbProblem[] = [];
  const db = loadCodeDb(raw, (p) => problems.push(p));
  return { db, problems };
}

const fanuc = load(fanucJson);
const heidenhain = load(heidenhainJson);
const okuma = load(okumaJson);
const sinumerik = load(sinumerikJson);

describe('built-in code databases', () => {
  it('ships one database per dialect, keyed by profile.codes', () => {
    // M6 adds the two Fanuc lathe databases: the system-A one a lathe document reads, and
    // the system-B variant a machine can switch to (AD-17, AD-31).
    expect(Object.keys(BUILTIN_CODE_DB_JSON).sort()).toEqual([
      'fanuc',
      'fanuc-lathe',
      'fanuc-lathe-b',
      'heidenhain',
      'okuma',
      'sinumerik',
      'sinumerik-mill',
    ]);
    expect(fanuc.db.dialect).toBe('fanuc');
    expect(heidenhain.db.dialect).toBe('heidenhain');
  });

  it('loads without a single problem', () => {
    expect(fanuc.problems).toEqual([]);
    expect(heidenhain.problems).toEqual([]);
  });

  // M6: the loader used to drop `sets`, so the data said one thing and `codes.byId()`
  // another. The interpreter reads the loaded database, not the file (AD-19).
  it('carries what a code sets through to the loaded database', () => {
    const setsOf = (db: CodeDb, code: string) => db.codes.find((entry) => entry.code === code)?.sets;
    expect(setsOf(fanuc.db, 'G94')).toEqual({ feedUnit: 'per-minute' });
    expect(setsOf(fanuc.db, 'G21')).toEqual({ units: 'mm' });
    expect(setsOf(fanuc.db, 'G18')).toEqual({ plane: 'ZX' });
    expect(setsOf(fanuc.db, 'G91')).toEqual({ distance: 'incremental' });
    expect(setsOf(fanuc.db, 'G80')).toEqual({ cycle: 'cancel' });
    expect(setsOf(fanuc.db, 'G83')).toEqual({ cycle: 'start' });
    expect(setsOf(fanuc.db, 'G50')).toEqual({ speedLimit: true });
    expect(setsOf(fanuc.db, 'G96')).toEqual({ speedUnit: 'surface' });
    // M10 (WP10.2): the program checks read a rapid from the database too.
    expect(setsOf(fanuc.db, 'G0')).toEqual({ motion: 'rapid' });
  });

  it('has no duplicate code and no duplicate alias', () => {
    for (const { db } of [fanuc, heidenhain]) {
      const keys = db.codes.flatMap((e) => [e.code, ...(e.aliases ?? [])]);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('gives every entry a label and every address a label', () => {
    for (const { db } of [fanuc, heidenhain]) {
      for (const entry of db.codes) {
        expect(entry.label.length, entry.code).toBeGreaterThan(0);
        expect(entry.code).toBe(entry.code.toUpperCase());
      }
      for (const [letter, address] of Object.entries(db.addresses)) {
        expect(address.label.length, letter).toBeGreaterThan(0);
      }
    }
  });

  it('gives every modal code a group, and never one that two modal groups share', () => {
    for (const { db } of [fanuc, heidenhain]) {
      for (const entry of db.codes.filter((e) => e.modal)) {
        expect(entry.group, entry.code).toBeTruthy();
      }
    }
    // The spindle direction (M3/M4/M5) and the spindle speed mode (G96/G97) replace each
    // other only within their own group, so they do not share a group name.
    const spindle = fanuc.db.codes.find((e) => e.code === 'M3')?.group;
    expect(fanuc.db.codes.find((e) => e.code === 'G96')?.group).not.toBe(spindle);
  });

  // 2026-09 decision: `pitchFeed` sits in the cycle or motion group, or on
  // a modal code of a group of its own — a mode such as Fanuc's tapping mode `G63`, which is
  // in force until another code of its group (`G61`, `G62`, `G64`) replaces it. The scripts'
  // tracker reads such a mode off the groups (`FeedModeTracker.pitch_mode`); a non-modal
  // `pitchFeed` code outside those groups would say nothing about any block and is refused.
  it('keeps every pitchFeed code in the cycle or motion group, or on a modal mode', () => {
    for (const { db } of [fanuc, heidenhain]) {
      const pitch = db.codes.filter((e) => e.pitchFeed);
      expect(pitch.length).toBeGreaterThan(0);
      for (const entry of pitch) {
        const inCycleOrMotion = ['cycle', 'motion'].includes(entry.group ?? '');
        expect(inCycleOrMotion || entry.modal === true, entry.code).toBe(true);
      }
    }
    const modes = fanuc.db.codes.filter((e) => e.pitchFeed && !['cycle', 'motion'].includes(e.group ?? ''));
    expect(modes.map((e) => e.code)).toEqual(['G63']);
    // The mode ends with the other codes of its group, so all of them are in the database.
    const group = modes[0].group;
    expect(fanuc.db.codes.filter((e) => e.group === group).map((e) => e.code)).toEqual(['G61', 'G62', 'G63', 'G64']);
  });

  // G76 is not in the `pitchFeed` list although the plan names it: the entry shipped
  // here is the *mill* fine-boring cycle, whose F is a boring feed. It is in the
  // `pitchFeedAmbiguous` list below instead, which is what a scaling script needs to
  // refuse it while no lathe profile exists.
  it('marks the tapping and threading codes the plan names as pitchFeed', () => {
    const fanucPitch = fanuc.db.codes.filter((e) => e.pitchFeed).map((e) => e.code);
    // The source review (2026-09) added the variable-lead thread G34 from the control's list.
    // 2026-09: the older-format rigid tapping cycles and the tapping mode.
    expect(fanucPitch.sort()).toEqual(['G32', 'G33', 'G34', 'G63', 'G74', 'G84', 'G84.2', 'G84.3']);
    expect(fanuc.db.codes.find((e) => e.code === 'G76')?.pitchFeed).toBeUndefined();

    const klartextPitch = heidenhain.db.codes.filter((e) => e.pitchFeed).map((e) => e.code);
    expect(klartextPitch.sort()).toEqual(['CYCL DEF 206', 'CYCL DEF 207', 'CYCL DEF 209']);
  });

  // Owner decision of 2026-09-27: the speed of a tap is not scaled. `tapping` is what
  // scale_speed reads, so a tapping code without it would have its speed scaled.
  it('marks the tapping codes, and no threading code, as tapping', () => {
    const tapping = (db: CodeDb) => db.codes.filter((e) => e.tapping).map((e) => e.code).sort();
    expect(tapping(fanuc.db)).toEqual(['G63', 'G74', 'G84', 'G84.2', 'G84.3', 'M29']);
    expect(tapping(heidenhain.db)).toEqual(['CYCL DEF 206', 'CYCL DEF 207', 'CYCL DEF 209']);
    for (const code of ['G32', 'G33', 'G34', 'G76', 'G92']) {
      expect(fanuc.db.codes.find((e) => e.code === code)?.tapping, code).toBeUndefined();
    }
  });

  // The words of a macro call and of a data-setting block are no feeds.
  it('marks the macro calls and the data-setting block as blocks whose words are data', () => {
    // M9 (WP9.2): the modal call that runs after every block, G66.1, is one of them.
    expect(fanuc.db.codes.filter((e) => e.wordsAreData).map((e) => e.code)).toEqual(['G10', 'G65', 'G66', 'G66.1']);
    // G67 ends the modal call; its block has no arguments.
    expect(fanuc.db.codes.find((e) => e.code === 'G67')?.wordsAreData).toBeUndefined();
    expect(heidenhain.db.codes.some((e) => e.wordsAreData)).toBe(false);
  });

  it('marks the codes whose number is a threading cycle in another G-code system', () => {
    // G8 M4: `scale_feed` multiplied the thread lead of every G76 and G92 block on a
    // lathe program, because the hazard was written in the entry's prose and nowhere a
    // machine could read it. `fanuc-gcode` is the only G-code profile that ships, so a
    // lathe program lands on it.
    const ambiguous = fanuc.db.codes.filter((e) => e.pitchFeedAmbiguous).map((e) => e.code);
    expect(ambiguous.sort()).toEqual(['G76', 'G92']);
    // Every one of them says so in its own description as well, which is where the
    // reviewer found it.
    for (const code of ambiguous) {
      const entry = fanuc.db.codes.find((e) => e.code === code);
      expect(entry?.description, code).toMatch(/system A/);
    }
    // The flag is about a code that means two things, not about a code that is a pitch:
    // the two lists do not overlap, and Klartext has no second G-code system.
    expect(fanuc.db.codes.some((e) => e.pitchFeed && e.pitchFeedAmbiguous)).toBe(false);
    expect(heidenhain.db.codes.some((e) => e.pitchFeedAmbiguous)).toBe(false);
  });

  it('ships the Fanuc CAM subset the plan lists', () => {
    const codes = new Set(fanuc.db.codes.map((e) => e.code));
    const want = [
      'G0', 'G1', 'G2', 'G3', 'G4',
      'G17', 'G18', 'G19', 'G20', 'G21', 'G28',
      'G32', 'G33',
      'G40', 'G41', 'G42', 'G43', 'G49',
      'G53', 'G54', 'G55', 'G56', 'G57', 'G58', 'G59', 'G54.1',
      'G73', 'G74', 'G76',
      'G80', 'G81', 'G82', 'G83', 'G84', 'G85', 'G86', 'G87', 'G88', 'G89',
      'G90', 'G91', 'G94', 'G95', 'G96', 'G97', 'G98', 'G99',
      'M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9',
      'M19', 'M30', 'M98', 'M99',
    ];
    for (const code of want) expect(codes, code).toContain(code);
    for (const letter of ['X', 'Y', 'Z', 'I', 'J', 'K', 'F', 'S', 'T', 'H', 'D', 'P', 'Q', 'N', 'O', 'G', 'M']) {
      expect(fanuc.db.addresses[letter], letter).toBeDefined();
    }
  });

  it('ships the Klartext subset the plan lists', () => {
    const codes = new Set(heidenhain.db.codes.map((e) => e.code));
    const want = [
      'L', 'C', 'CC', 'CR', 'CT', 'RND', 'CHF',
      'LBL', 'CALL LBL', 'CALL PGM',
      'TOOL CALL', 'TOOL DEF',
      'CYCL DEF 200', 'CYCL DEF 201', 'CYCL DEF 203', 'CYCL DEF 205',
      'CYCL DEF 206', 'CYCL DEF 207', 'CYCL DEF 209', 'CYCL DEF 240',
      'CYCL CALL', 'FMAX', 'FAUTO', 'R0', 'RL', 'RR',
      'BEGIN PGM', 'END PGM', 'BLK FORM',
      'M0', 'M3', 'M5', 'M8', 'M9', 'M30',
    ];
    for (const code of want) expect(codes, code).toContain(code);
  });

  it('confirms PLANE and FUNCTION TCPM, and leaves the rest of Klartext confirmed', () => {
    // The source review (2026-09): the TNC 640 manual settles the PLANE and TCPM forms,
    // so nothing in the Klartext database is waiting for verification any more.
    const verify = new Set(heidenhain.db.codes.filter((e) => e.verify).map((e) => e.code));
    for (const code of ['PLANE SPATIAL', 'PLANE RESET', 'FUNCTION TCPM', 'FUNCTION RESET TCPM', 'CYCL CALL POS']) {
      expect(verify, code).not.toContain(code);
    }
    // The 200-series cycles whose parameter list the syntax notes flag.
    for (const code of ['CYCL DEF 200', 'CYCL DEF 201']) expect(verify, code).not.toContain(code);
    for (const code of ['L', 'CC', 'TOOL CALL', 'FMAX', 'R0', 'M8']) {
      expect(verify, code).not.toContain(code);
    }
  });

  it('leaves the codes the assistant explains out of the unverified set', () => {
    const verify = new Set(fanuc.db.codes.filter((e) => e.verify).map((e) => e.code));
    for (const code of ['G0', 'G1', 'G43', 'G54', 'G81', 'G83', 'G84', 'M6', 'M8', 'M30']) {
      expect(verify, code).not.toContain(code);
    }
  });

  it('gives the drilling cycles their parameters', () => {
    const g83 = fanuc.db.codes.find((e) => e.code === 'G83');
    expect(g83?.params?.map((p) => p.address)).toEqual(['X', 'Y', 'Z', 'R', 'Q', 'F', 'K']);
    expect(g83?.params?.filter((p) => p.required).map((p) => p.address)).toEqual(['Z', 'R', 'Q', 'F']);

    const cycle200 = heidenhain.db.codes.find((e) => e.code === 'CYCL DEF 200');
    expect(cycle200?.params?.map((p) => p.address)).toEqual([
      'Q200', 'Q201', 'Q206', 'Q202', 'Q210', 'Q203', 'Q204', 'Q211', 'Q395',
    ]);
  });

  it('writes every parameter of a Klartext cycle block, so a snippet is complete', () => {
    // A Q-style cycle definition carries one line per parameter, so all of them are
    // required. The exceptions are the optional parameters a later software version
    // appended at the end, which older controls do not know: Q395, and Q208 of cycle 205
    // (both from software 34059x-04, source review 2026-09).
    // B1 (a7s): the optional parameters the TNC 640 cycle manual (10/2017, "new and changed
    // cycle functions") names as added to cycles 22, 25, 251–254, 256 and 257; and the `F` of
    // cycle 19, a word of its 19.1 sub-block, not a parameter line.
    const LATER: Record<string, string[]> = {
      // B1 fix NC (NC-08): ABST is a word of the 19.1 sub-block too; the manual's own
      // contour-formula example writes cycles 22 and 23 without Q208.
      'CYCL DEF 19': ['F', 'ABST'],
      // Wave Y (T096): the tool names QS13 and QS18 are written instead of Q13 and Q18.
      'CYCL DEF 21': ['QS13'],
      'CYCL DEF 22': ['QS18', 'Q208', 'Q401', 'Q404'],
      'CYCL DEF 23': ['Q208'],
      'CYCL DEF 25': ['Q18', 'QS18', 'Q446', 'Q447', 'Q448'],
      'CYCL DEF 251': ['Q439'],
      'CYCL DEF 252': ['Q439'],
      'CYCL DEF 253': ['Q439'],
      'CYCL DEF 254': ['Q439'],
      'CYCL DEF 256': ['Q215', 'Q369', 'Q338', 'Q385'],
      'CYCL DEF 257': ['Q215', 'Q369', 'Q338', 'Q385'],
      // P4a fix B1 (NC-15): cycle 26's factors and centre are words of its 26.1 sub-block, each
      // written only for the axes it scales.
      'CYCL DEF 26': ['X', 'Y', 'Z', 'CCX', 'CCY', 'CCZ'],
    };
    const optional = (code: string, address: string) =>
      address === 'Q395' || (code === 'CYCL DEF 205' && address === 'Q208') || (LATER[code] ?? []).includes(address);
    for (const entry of heidenhain.db.codes.filter((e) => e.code.startsWith('CYCL DEF '))) {
      for (const param of entry.params ?? []) {
        const label = `${entry.code} ${param.address}`;
        if (optional(entry.code, param.address)) expect(param.required, label).toBeUndefined();
        else expect(param.required, label).toBe(true);
      }
    }
  });
});

describe('loadCodeDb', () => {
  it('copies frameEmptyCloses beside frameZeroWords and drops a malformed one (M12.5, §7.16 #180)', () => {
    const { db, problems } = load({
      dialect: 'x',
      version: 1,
      codes: [
        { code: 'CYCL DEF 19', label: 'Tilt', group: 'tilt', frame: 'open', frameZeroWords: ['A', 'B', 'C'], frameEmptyCloses: '1' },
        { code: 'CYCL DEF 7', label: 'Shift', group: 'frame', frame: 'open', frameZeroWords: ['X'], frameEmptyCloses: 'one' },
        { code: 'CYCL DEF 8', label: 'Mirror', group: 'frame', frame: 'open', frameEmptyCloses: '1' },
      ],
    });
    expect(db.codes.map((e) => e.frameEmptyCloses ?? null)).toEqual(['1', null, null]);
    expect(problems.map((p) => p.path)).toEqual(['codes[1].frameEmptyCloses', 'codes[2].frameEmptyCloses']);
    expect(problems[1].message).toMatch(/needs frameZeroWords/);
  });

  it('ships the empty CYCL DEF 19.1 as the end of cycle 19 (TNC 640 cycle manual, cycle 19 reset)', () => {
    const entry = heidenhain.db.codes.find((e) => e.code === 'CYCL DEF 19');
    expect(entry?.frameEmptyCloses).toBe('1');
    // P4a integration (§7 #299): cycle 8 ends the same way, an empty 8.1 (its axes carry no value).
    expect(heidenhain.db.codes.filter((e) => e.frameEmptyCloses !== undefined).map((e) => e.code)).toEqual(['CYCL DEF 8', 'CYCL DEF 19']);
    for (const other of [fanuc, okuma, sinumerik]) {
      expect(other.db.codes.filter((e) => e.frameEmptyCloses !== undefined)).toEqual([]);
    }
  });

  it('refuses a file that is not a code database', () => {
    expect(() => loadCodeDb(null)).toThrow(CodeDbError);
    expect(() => loadCodeDb([])).toThrow(CodeDbError);
    expect(() => loadCodeDb({ version: 1, codes: [] })).toThrow(/dialect/);
    expect(() => loadCodeDb({ dialect: 'x', codes: {} })).toThrow(/codes/);
  });

  it('carries the JSON path on the error', () => {
    try {
      loadCodeDb({ dialect: 'x' });
      expect.unreachable('expected a CodeDbError');
    } catch (err) {
      expect(err).toBeInstanceOf(CodeDbError);
      expect((err as CodeDbError).path).toBe('codes');
    }
  });

  it('normalises the stored code and drops padding aliases without a word', () => {
    const { db, problems } = load({
      dialect: 'x',
      version: 1,
      codes: [{ code: 'g01', aliases: ['G01', 'G001'], label: 'Line' }],
    });
    expect(db.codes[0].code).toBe('G1');
    expect(db.codes[0].aliases).toBeUndefined();
    expect(problems).toEqual([]);
  });

  it('keeps an alias that is a different spelling', () => {
    const { db } = load({
      dialect: 'x',
      version: 1,
      codes: [{ code: 'FMAX', aliases: ['F MAX'], label: 'Rapid' }],
    });
    expect(db.codes[0].aliases).toEqual(['F MAX']);
  });

  it('drops a duplicate code and names the entry that owns it', () => {
    const { db, problems } = load({
      dialect: 'x',
      version: 1,
      codes: [
        { code: 'G0', label: 'Rapid' },
        { code: 'G00', label: 'Rapid again' },
      ],
    });
    expect(db.codes).toHaveLength(1);
    expect(db.codes[0].label).toBe('Rapid');
    expect(problems).toHaveLength(1);
    expect(problems[0].path).toBe('codes[1]');
    expect(problems[0].message).toMatch(/duplicate code G0/);
  });

  it('drops an alias that another entry already owns and keeps the entry', () => {
    const { db, problems } = load({
      dialect: 'x',
      version: 1,
      codes: [
        { code: 'G0', label: 'Rapid' },
        { code: 'G1', aliases: ['G0', 'GLIN'], label: 'Line' },
      ],
    });
    expect(db.codes).toHaveLength(2);
    expect(db.codes[1].aliases).toEqual(['GLIN']);
    expect(problems).toHaveLength(1);
    expect(problems[0].path).toBe('codes[1].aliases');
  });

  it('drops a broken entry, address and parameter but loads the rest of the file', () => {
    const { db, problems } = load({
      dialect: 'x',
      version: 1,
      addresses: { X: { label: 'X axis' }, Y: { description: 'no label' }, Z: 7 },
      codes: [
        { code: 'G0', label: 'Rapid' },
        { label: 'no code' },
        { code: 'G1' },
        'not an object',
        { code: 'G81', label: 'Drill', params: [{ address: 'Z', label: 'Bottom' }, { label: 'no address' }] },
      ],
    });
    expect(db.codes.map((e) => e.code)).toEqual(['G0', 'G81']);
    expect(Object.keys(db.addresses)).toEqual(['X']);
    expect(db.codes[1].params?.map((p) => p.address)).toEqual(['Z']);
    expect(problems.map((p) => p.path)).toEqual([
      'addresses.Y',
      'addresses.Z',
      'codes[1]',
      'codes[2].label',
      'codes[3]',
      'codes[4].params[1]',
    ]);
  });

  it('reads a missing version as 1 and says so', () => {
    const { db, problems } = load({ dialect: 'x', codes: [] });
    expect(db.version).toBe(1);
    expect(problems.map((p) => p.path)).toEqual(['version']);
  });

  it('keeps only the flags that are set', () => {
    const { db } = load({
      dialect: 'x',
      version: 1,
      codes: [
        { code: 'G84', label: 'Tap', modal: true, pitchFeed: true, tapping: true, verify: true, group: 'cycle' },
        { code: 'G0', label: 'Rapid', modal: false, pitchFeed: 'yes', pitchFeedAmbiguous: 1, tapping: 'yes', wordsAreData: 1 },
        { code: 'G76', label: 'Bore', pitchFeedAmbiguous: true, group: 'cycle' },
        { code: 'G65', label: 'Macro call', wordsAreData: true },
        { code: 'G284', label: 'LAP change', pitchFeedAmbiguous: true, tappingElsewhere: true },
        { code: 'G288', label: 'LAP thread', pitchFeedAmbiguous: true, tappingElsewhere: 'yes' },
      ],
    });
    expect(db.codes[0]).toMatchObject({ modal: true, pitchFeed: true, tapping: true, verify: true, group: 'cycle' });
    expect(db.codes[1].modal).toBeUndefined();
    expect(db.codes[1].pitchFeed).toBeUndefined();
    expect(db.codes[1].pitchFeedAmbiguous).toBeUndefined();
    expect(db.codes[1].tapping).toBeUndefined();
    expect(db.codes[1].wordsAreData).toBeUndefined();
    expect(db.codes[1].group).toBeUndefined();
    expect(db.codes[2].pitchFeedAmbiguous).toBe(true);
    // 2026-09: the scripts read `tapping` and `wordsAreData` from the loaded database, so
    // the loader has to carry them (it once dropped `sets` the same way).
    expect(db.codes[3].wordsAreData).toBe(true);
    // 2026-09 (review finding NC1): and `tappingElsewhere`, which scale_speed reads.
    expect(db.codes[4].tappingElsewhere).toBe(true);
    expect(db.codes[5].tappingElsewhere).toBeUndefined();
    expect(db.codes[2].tappingElsewhere).toBeUndefined();
  });

  it('builds an empty database for a dialect with no file', () => {
    const db = emptyCodeDb('okuma');
    expect(db).toEqual({ dialect: 'okuma', version: 0, addresses: {}, codes: [] });
  });

  // M6 (§7.2, AD-19): what a code switches on is the whole of what the modal interpreter
  // reads, so a value it does not know has to be dropped and reported rather than carried
  // into the interpreter, where it would silently leave the state unknown.
  it('reads what a code sets, and drops a member it does not know', () => {
    const { db, problems } = load({
      dialect: 'x',
      version: 1,
      codes: [
        {
          code: 'G99',
          label: 'Feed per revolution',
          group: 'feedmode',
          modal: true,
          sets: { feedUnit: 'per-rev' },
        },
        { code: 'G18', label: 'ZX plane', sets: { plane: 'ZX', units: 'mm', distance: 'incremental' } },
        { code: 'G50', label: 'Speed clamp', sets: { speedLimit: true } },
        { code: 'G80', label: 'Cancel cycle', sets: { cycle: 'cancel' } },
        { code: 'G96', label: 'Constant surface speed', sets: { speedUnit: 'surface', diameter: 'on' } },
        { code: 'G1', label: 'Line', sets: { feedUnit: 'per-second', tool: 'next' } },
        { code: 'G2', label: 'Arc', sets: 'per-rev' },
        { code: 'G3', label: 'Arc', sets: { speedLimit: 'yes' } },
      ],
    });
    expect(db.codes[0].sets).toEqual({ feedUnit: 'per-rev' });
    expect(db.codes[1].sets).toEqual({ plane: 'ZX', units: 'mm', distance: 'incremental' });
    expect(db.codes[2].sets).toEqual({ speedLimit: true });
    expect(db.codes[3].sets).toEqual({ cycle: 'cancel' });
    expect(db.codes[4].sets).toEqual({ speedUnit: 'surface', diameter: 'on' });
    // The broken ones keep their label and lose only what was wrong.
    expect(db.codes[5]).toEqual({ code: 'G1', label: 'Line' });
    expect(db.codes[6]).toEqual({ code: 'G2', label: 'Arc' });
    expect(db.codes[7]).toEqual({ code: 'G3', label: 'Arc' });
    expect(problems.map((p) => p.path)).toEqual([
      'codes[5].sets.feedUnit',
      'codes[5].sets.tool',
      'codes[6].sets',
      'codes[7].sets.speedLimit',
    ]);
  });

  // AD-31: the class of a cycle parameter wins over its address, because a cycle is where
  // a control most often breaks its own convention (the µm pecks of §8.2).
  it('reads how a cycle parameter is meant to be read, and reports an unknown reading', () => {
    const { db, problems } = load({
      dialect: 'x',
      version: 1,
      codes: [
        {
          code: 'G83',
          label: 'Peck drilling',
          params: [
            { address: 'Q', label: 'Peck', unit: 'increment' },
            { address: 'P', label: 'Dwell', unit: 'count' },
            { address: 'Z', label: 'Depth', unit: 'length' },
            { address: 'F', label: 'Feed', unit: 'feedPerRev' },
            { address: 'R', label: 'Plane' },
            { address: 'K', label: 'Repeat', unit: 'times' },
          ],
        },
      ],
    });
    expect(db.codes[0].params?.map((param) => param.unit)).toEqual([
      'increment',
      'count',
      'length',
      'feedPerRev',
      undefined,
      undefined,
    ]);
    expect(problems.map((p) => p.path)).toEqual(['codes[0].params[5].unit']);
  });
});

// ---------------------------------------------------------------------------
// The database against the rest of the app
// ---------------------------------------------------------------------------
//
// A code database is only worth having where it answers. These checks tie it to the three
// things that decide whether it does: the words the profile tokenizes, the codes the
// project's own fixtures contain, and the group catalogue hover renders.

describe('the database against the rest of the app', () => {
  const profiles = BUILTIN_PROFILE_JSON.map((raw) => {
    const checked = validateProfile(raw);
    if (!checked.ok) throw new Error(checked.errors.join('; '));
    return compileProfile(checked.profile);
  });
  // The **resolved** databases (AD-17): a child file holds only what differs from its
  // parent, so a profile's real database is the merge, not the file.
  const RESOLVED = resolveCodeDbs(BUILTIN_CODE_DB_JSON);
  const dbOf = (cp: CompiledProfile): CodeDb => RESOLVED[cp.profile.codes] ?? emptyCodeDb(cp.profile.codes);
  /**
   * M6: every database a profile can end up with, as one lookup table.
   *
   * A profile may offer a machine parameter that swaps the database (the Fanuc lathe's
   * G-code system A or B, AD-31), and which one a document gets is decided per document.
   * "Is this code described anywhere the profile might use it?" is therefore a question
   * about the union, and only that union covers a system-B program such as
   * `l05-system-b.nc`, whose `G77`, `G78` and `G95` live in the variant database.
   */
  const anyDbOf = (cp: CompiledProfile): CodeDb =>
    unionCodeDb(variantDialects(cp.profile).map((dialect) => RESOLVED[dialect] ?? emptyCodeDb(dialect)));

  it('describes every keyword its profile tokenizes', () => {
    // A keyword the tokenizer hands over as a keyword token and the database has never
    // heard of hovers as "not described yet" — on `MM`, that is the first line of every
    // Klartext program.
    for (const cp of profiles) {
      const db = dbOf(cp);
      const missing = (cp.profile.syntax.keywords ?? []).filter((keyword) => lookupCode(db, keyword) === null);
      expect(missing, `${cp.profile.id} keywords without an entry`).toEqual([]);
    }
  });

  it('describes every G and M word the shipped fixtures contain', () => {
    // The owner's real programs (`nc/owner-public/`) are left out: they carry standard
    // codes the databases do not describe yet and builder codes they never will, which
    // `tests/fixtures/README.md` lists as known gaps. The synthetic fixtures are written
    // from the syntax notes, so for them a missing entry is a mistake in the data. The
    // programs of dialects gEdit has no profile for (`nc/uncertain/`, M12.5) are left out
    // too: their words belong to no database.
    const missing = new Map<string, string[]>();
    const skipped = (path: string): boolean => path.startsWith('nc/owner-public/') || path.startsWith('nc/uncertain/');
    for (const rel of listFixtures('nc').filter((path) => !skipped(path))) {
      const opened = openFixture(rel);
      if (opened.refused !== null) continue;
      const text = editorText(opened.text);
      const id = detectProfile(profiles, `/work/${rel}`, opened.text, 'fanuc-gcode');
      const cp = profiles.find((p) => p.profile.id === id);
      if (!cp) continue;
      const db = anyDbOf(cp);
      let state: LineState | undefined;
      for (const line of text.split('\n')) {
        const result = tokenizeLine(line, cp, state);
        state = result.state;
        for (const token of result.tokens) {
          if (token.kind !== 'word' || token.address === undefined) continue;
          if (token.address !== 'G' && token.address !== 'M') continue;
          const code = `${token.address}${token.valueText ?? ''}`;
          if (lookupCode(db, code) !== null) continue;
          missing.set(code, [...(missing.get(code) ?? []), rel]);
        }
      }
    }
    expect(Object.fromEntries(missing)).toEqual({});
  });

  it('has a group name for every group the databases use', () => {
    // M8 integration: the turning databases too. Their `turret` and `lap` entries are
    // still `verify`, but the name is shown the day one of them is confirmed.
    for (const { db } of [fanuc, heidenhain, okuma, sinumerik]) {
      for (const entry of db.codes) {
        if (entry.group === undefined) continue;
        const key = `assistant.group.${entry.group}`;
        expect(t(key), `${entry.code} is in group "${entry.group}"`).not.toBe(key);
      }
    }
  });

  it('keeps tool centre point management out of the working-plane group', () => {
    // TCPM holds the tool tip on the path while rotary axes move; it neither selects nor
    // tilts a plane, and `plane` is what Fanuc G17 to G19 mean. A tilted plane is a group
    // of its own for the same reason (source review, 2026-09): `plane` is the modal group
    // whose `sets.plane` says XY, ZX or YZ.
    const groupOf = (code: string) => heidenhain.db.codes.find((e) => e.code === code)?.group;
    for (const code of ['FUNCTION TCPM', 'FUNCTION RESET TCPM', 'M128', 'M129']) {
      expect(groupOf(code), code).toBe('tcpm');
    }
    for (const code of ['FUNCTION TCPM', 'FUNCTION RESET TCPM']) {
      expect(heidenhain.db.codes.find((e) => e.code === code)?.modal, code).toBe(true);
    }
    expect(groupOf('PLANE SPATIAL')).toBe('tilt');
    expect(groupOf('PLANE RESET')).toBe('tilt');
    expect(fanuc.db.codes.find((e) => e.code === 'G17')?.group).toBe('plane');
  });

  it('does not tell the reader to distrust the M codes it describes itself', () => {
    // The `M` address used to say that everything above M9 is machine specific, four
    // entries above M19, M30, M98 and M99.
    const text = fanuc.db.addresses.M.description ?? '';
    for (const code of ['M19', 'M29', 'M30', 'M98', 'M99']) expect(text, code).toContain(code);
  });

  it('does not claim a feed unit the program header can contradict', () => {
    // `INCH` makes F tenths of an inch per minute, and a rotary axis makes it deg/min.
    const text = heidenhain.db.addresses.F.description ?? '';
    expect(text).toContain('INCH');
    expect(text.toLowerCase()).toContain('degrees per minute');
  });
});

describe('B1: the block of a two-block cycle (CodeParam.block) and the review mark', () => {
  const g71 = (params: unknown[], extra: Record<string, unknown> = {}): unknown => ({
    dialect: 'x',
    version: 1,
    codes: [{ code: 'G71', label: 'Roughing', blocks: 2, ...extra, params }],
  });

  it('keeps one declaration of an address per block, each with its own label', () => {
    const { db, problems } = load(
      g71([
        { address: 'U', label: 'Depth of cut', block: 1 },
        { address: 'U', label: 'Allowance on X', block: 2 },
        { address: 'P', label: 'First profile block', unit: 'count', block: 2 },
        { address: 'F', label: 'Feed' },
      ]),
    );
    expect(problems).toEqual([]);
    expect(db.codes[0].params?.map((p) => [p.address, p.label, p.block ?? null])).toEqual([
      ['U', 'Depth of cut', 1],
      ['U', 'Allowance on X', 2],
      ['P', 'First profile block', 2],
      ['F', 'Feed', null],
    ]);
  });

  it('drops a block that is not 1 or 2, and a block on an entry that is no two-block cycle', () => {
    const { db, problems } = load({
      dialect: 'x',
      version: 1,
      codes: [
        { code: 'G71', label: 'Roughing', blocks: 2, params: [{ address: 'U', label: 'u', block: 3 }] },
        { code: 'G83', label: 'Drilling', params: [{ address: 'Q', label: 'q', block: 2 }] },
      ],
    });
    expect(problems.map((p) => p.path)).toEqual(['codes[0].params[0].block', 'codes[1].params[0].block']);
    expect(problems[1].message).toContain('"blocks": 2');
    // The parameter stays, without the block it cannot have.
    expect(db.codes.map((e) => e.params?.[0].block ?? null)).toEqual([null, null]);
  });

  it('refuses a second declaration for the same block, and one whose reading differs from the other block', () => {
    const { db, problems } = load(
      g71([
        { address: 'U', label: 'Depth of cut', block: 1 },
        { address: 'U', label: 'Again', block: 1 },
        { address: 'R', label: 'Retract' },
        { address: 'R', label: 'Retract of the second block', block: 2 },
        { address: 'P', label: 'Packed', unit: 'count', block: 1 },
        { address: 'P', label: 'Height', unit: 'increment', block: 2 },
      ]),
    );
    expect(problems.map((p) => p.path)).toEqual(['codes[0].params[1]', 'codes[0].params[3]', 'codes[0].params[5].unit']);
    expect(problems[2].message).toContain('same unit in both blocks');
    expect(db.codes[0].params?.map((p) => p.label)).toEqual(['Depth of cut', 'Retract', 'Packed']);
  });

  it('reads review: "pending" and drops any other value', () => {
    const { db, problems } = load({
      dialect: 'x',
      version: 1,
      codes: [
        { code: 'G29', label: 'Return', review: 'pending' },
        { code: 'G30', label: 'Return 2', review: 'done' },
      ],
    });
    expect(db.codes.map((e) => e.review ?? null)).toEqual(['pending', null]);
    expect(problems.map((p) => p.path)).toEqual(['codes[1].review']);
  });

  it('marks every entry the B1 manual pass wrote or changed for the owner\'s review', () => {
    // The P4a prelude (Phase 4 plan §6.2) adds the arc direction to G2/G3 and the compensation
    // side to G41/G42 (RL/RR on Klartext) and marks those entries the same way; the P4a Wave B
    // integration (§7 #299 to #307) the resets (G52, TRANS, ATRANS, Klartext cycles 7, 8, 10),
    // PATTERN DEF, CIP, CYCLE95 and the Fanuc lathe's G70. P4.6 (Phase 4 plan §6.3 rule 11): the
    // drilling cycles with an expansion schema, the cycle returns G98/G99, the dwell codes (Fanuc
    // and Sinumerik G4, Klartext cycle 9) and the new Sinumerik SPOS.
    const marked = (dialect: string): string[] =>
      (BUILTIN_CODE_DB_JSON[dialect] as { codes: { code: string; review?: string }[] }).codes
        .filter((e) => e.review === 'pending')
        .map((e) => e.code);
    expect(marked('fanuc')).toEqual([
      'G2', 'G3', 'G4', 'G5.4', 'G6.2', 'G10', 'G29', 'G30.1', 'G41', 'G42', 'G41.2', 'G41.3', 'G41.4', 'G41.5', 'G41.6', 'G42.2', 'G42.4', 'G42.5', 'G42.6', 'G43.1', 'G43.4', 'G43.5', 'G52', 'G53.1',
      // The manual-check round (D6-2, D6-3, 2026-10-25): G53.6, and tilt and TCP together.
      // Wave Y (T107): the macro calls G65 and G66 need P.
      'G53.6', 'G65', 'G66', 'G68.2', 'G68.3', 'G68.4',
      'G73', 'G81', 'G82', 'G83', 'G85', 'G86', 'G89', 'G92.1', 'G98', 'G99',
      // P4a fix B1 (§7 #312): the flow codes.
      'GOTO', 'DO', 'END',
    ]);
    // v1.2 NC fix round: G10's tool-offset tables (T013) and the single passes' taper (T009).
    // v1.2.0 (NCR-4): system A's G77-G79 read as system B's single passes.
    // Manual-check fix round (B2): the tilted planes without the tcp conflict (D6-3), the lathe's
    // own G53.6 with D, and the drilling cycles G83-G89 with their roles (D5-8).
    expect(marked('fanuc-lathe')).toEqual([
      'G41', 'G42', 'G50.3', 'G68.1', 'G68.2', 'G68.3', 'G68.4', 'G69.1', 'G53.6', 'G70', 'G71', 'G72', 'G73', 'G74', 'G75', 'G76',
      'G77', 'G78', 'G79', 'G83', 'G84', 'G85', 'G87', 'G88', 'G89', 'G90', 'G92', 'G94',
    ]);
    expect(marked('fanuc-lathe-b')).toEqual(['G77', 'G78', 'G79', 'G92.1', 'G83', 'G84', 'G85', 'G87', 'G88', 'G89']);
    // The Okuma lathe codes (package A7-O).
    // P4a fix B1 (§7 #312, #316): the chamfer and corner round, and the jumps.
    // v1.2 NC fix round (NCF-A follow-up): the thread passes and the L-radius arcs (lengthAlong).
    // Manual-check review round (NC-5): the turret wait M100.
    // Wave Y (T101, T102): G24, G25 and G314.
    expect(marked('okuma')).toEqual(['G2', 'G3', 'G20', 'G21', 'G24', 'G25', 'G31', 'G32', 'G33', 'G41', 'G42', 'G75', 'G76', 'G84', 'G85', 'G86', 'G93', 'G102', 'G103', 'G119', 'G132', 'G133', 'G313', 'G314', 'M85', 'M100', 'GOTO', 'IF']);
    // The Sinumerik and Klartext codes (package A7-S); SLOT2, CYCLE72, ADIS and ADISPOS were
    // added from the manuals afterwards (owner decision 2026-10-12) and carry the same mark,
    // as does CYCLE62, whose description now names CYCLE72 next to the turning cycles.
    expect(marked('sinumerik')).toEqual([
      'G2', 'G3', 'CIP', 'G4', 'G601', 'G602', 'G603', 'G643', 'G644', 'G645', 'G41', 'G42',
      // Wave Y (T103): the fixed point number FP= of G75.
      'G75',
      // v1.2.0 manual-check fix round (D5-9): diameter programming off while a cycle runs.
      'DIAMCYCOF',
      // v1.2.0 (NCR-9b): the drilling cycles' depth twins (DP and DPR, FDEP and FDPR).
      'CYCLE81', 'CYCLE82', 'CYCLE83', 'CYCLE84', 'CYCLE840', 'CYCLE85', 'CYCLE86', 'CYCLE87', 'CYCLE88', 'CYCLE89',
      'CYCLE61', 'POCKET3', 'POCKET4', 'SLOT1', 'SLOT2', 'CYCLE72', 'CYCLE93',
      'CYCLE95', 'CYCLE97',
      // v1.2.0 T144: the turning cycles of the newer manual, marked with their machine type.
      'CYCLE99', 'CYCLE92', 'CYCLE930', 'CYCLE940', 'CYCLE951', 'CYCLE952', 'CYCLE98',
      'CYCLE62', 'CYCLE800', 'SPOS', 'CTOL', 'OTOL', 'ADIS', 'ADISPOS',
      // v1.2 NC fix round (FZ-7): the corner words, a length each; (NCF-C) their feeds.
      'CHF', 'CHR', 'RND', 'RNDM', 'CR', 'FRC', 'FRCM', 'WAITM', 'WAITMC', 'WAITE', 'SETM', 'CLEARM', 'INIT', 'START', 'TRANS', 'ATRANS',
      // v1.2.0 manual-check fix round (D6-1): the frames by solid angles, along the tool and on the workpiece.
      'ROTS', 'AROTS', 'CROTS', 'TOFRAME', 'TOFRAMEZ', 'TOFRAMEY', 'TOFRAMEX', 'TOROT', 'TOROTZ', 'TOROTY', 'TOROTX', 'TOROTOF', 'PAROT', 'PAROTOF',
      'COMPSURF', 'CUT3DCC', 'CUT3DCCD',
      // P4a fix B1 (§7 #312): the flow codes.
      'GOTOF', 'GOTOB', 'GOTO', 'GOTOC', 'IF', 'ELSE', 'ENDIF', 'WHILE', 'ENDWHILE', 'FOR', 'ENDFOR', 'REPEAT', 'REPEATB', 'UNTIL', 'LOOP', 'ENDLOOP',
    ]);
    // P4a fix B1 (§7 #311-#318): the blank, the labels and jumps, the system write, the scalings,
    // the datum shift's reset and the keywords that turn the rotary axes.
    // v1.2 NC fix round (FZ-6): the approach and departure codes describe LEN, CCA and R.
    expect(marked('heidenhain')).toEqual([
      // The corner and arc words of the contour (CR, RND, CHF), marked lengthAlong.
      'BLK FORM', 'CR', 'RND', 'CHF', 'APPR LT', 'APPR LN', 'APPR CT', 'APPR LCT', 'DEP LT', 'DEP LN', 'DEP CT', 'DEP LCT', 'RL', 'RR', 'VC', 'LBL', 'FN 9', 'FN 10', 'FN 11', 'FN 12', 'FN 17', 'CYCL DEF 7', 'CYCL DEF 8', 'CYCL DEF 9', 'CYCL DEF 10', 'CYCL DEF 11', 'CYCL DEF 19',
      // v1.2 NC fix round (NCF-A follow-up): the bore and thread milling diameters, the centring diameter.
      // P4b fix batch 3 (NC-6): CYCL CALL POS, whose feed counts for its own block only.
      'CYCL DEF 26', 'PATTERN DEF', 'CYCL CALL POS', 'CYCL DEF 200', 'CYCL DEF 201', 'CYCL DEF 208', 'CYCL DEF 240', 'CYCL DEF 262', 'CYCL DEF 251', 'CYCL DEF 252', 'CYCL DEF 253', 'CYCL DEF 254', 'CYCL DEF 256',
      // Wave Y (T093-T095): the pattern calls 220 and 221, face milling 233 and the contour data of cycle 20.
      'CYCL DEF 257', 'CYCL DEF 220', 'CYCL DEF 221', 'CYCL DEF 233', 'CYCL DEF 14', 'CYCL DEF 20', 'CYCL DEF 21', 'CYCL DEF 22', 'CYCL DEF 23', 'CYCL DEF 24', 'CYCL DEF 25',
      'PLANE SPATIAL', 'PLANE PROJECTED', 'PLANE EULER', 'PLANE VECTOR', 'PLANE POINTS', 'PLANE RELATIV',
      'PLANE AXIAL', 'PLANE RESET', 'TRANS DATUM', 'M128', 'M140', 'MOVE', 'TURN',
      // v1.2.0 manual-check fix round (D6-8): the words that choose between the two rotary solutions.
      'SEQ+', 'SEQ-', 'SYM+', 'SYM-',
    ]);
  });
});

describe('B1: the words a code owns (`ownWords`, package A6)', () => {
  it('reads the list upper case, reports what is not a word, and keeps the entry', () => {
    const { db, problems } = load({
      dialect: 'x',
      version: 1,
      codes: [
        { code: 'M128', label: 'TCP on', ownWords: ['f'] },
        { code: 'M140', label: 'Retract', ownWords: ['F', 7] },
        { code: 'PLANE RESET', label: 'Reset', ownWords: 'F' },
        { code: 'M129', label: 'TCP off' },
      ],
    });
    expect(db.codes.map((e) => e.ownWords ?? null)).toEqual([['F'], ['F'], null, null]);
    expect(problems.map((p) => p.path)).toEqual(['codes[1].ownWords[1]', 'codes[2].ownWords']);
  });

  it('carries the shipped Klartext list through the loader, where the scripts read it', () => {
    // Without the loader member the app would drop the attribute and the scripts, which get
    // the loaded entries, would read every one of these F words as a path feed.
    const owning = heidenhain.db.codes.filter((e) => e.ownWords !== undefined).map((e) => e.code).sort();
    expect(owning).toEqual([
      'CYCL DEF 19', 'M128', 'M140', 'PLANE AXIAL', 'PLANE EULER', 'PLANE POINTS', 'PLANE PROJECTED',
      'PLANE RELATIV', 'PLANE RESET', 'PLANE SPATIAL', 'PLANE VECTOR',
    ]);
    for (const code of owning) expect(lookupCode(heidenhain.db, code)?.ownWords, code).toEqual(['F']);
    // FUNCTION TCPM's `F TCP` is a keyword, not a value: it owns nothing.
    expect(lookupCode(heidenhain.db, 'FUNCTION TCPM')?.ownWords).toBeUndefined();
  });
});

describe('B1 NC-06: a count that is a real number (`decimals`)', () => {
  it('keeps decimals on a count and reports it anywhere else', () => {
    const { db, problems } = load({
      dialect: 'x',
      version: 1,
      codes: [
        {
          code: 'G68.2',
          label: 'Tilted plane',
          params: [
            { address: 'I', label: 'Euler angle', unit: 'count', decimals: true },
            { address: 'X', label: 'Origin', decimals: true },
            { address: 'K', label: 'Repeat', unit: 'count', decimals: 'yes' },
            { address: 'P', label: 'Count', unit: 'count', decimals: false },
          ],
        },
      ],
    });
    expect(db.codes[0].params?.map((p) => p.decimals ?? null)).toEqual([true, null, null, null]);
    expect(problems.map((p) => [p.path, p.message])).toEqual([
      ['codes[0].params[1].decimals', 'decimals needs "unit": "count"'],
      ['codes[0].params[2].decimals', 'decimals has to be true or false'],
    ]);
  });
});

describe('P4a fix B1: the members the geometry fixes read (plan §7 #311-#318)', () => {
  it('carries the flow codes, the blank, the rotary turn and the scaling identity', () => {
    const { db, problems } = load({
      dialect: 'x',
      version: 1,
      codes: [
        { code: 'GOTO', label: 'Jump', flow: 'jump' },
        { code: 'LBL', label: 'Label', flow: 'label' },
        { code: 'BLK FORM', label: 'Blank', axisWords: 'data', blank: true },
        { code: 'TURN', label: 'Turn', positionsRotary: true },
        { code: 'CYCL DEF 11', label: 'Scaling', frame: 'open', frameZeroWords: ['SCL'], frameIdentity: '1' },
        {
          code: 'CYCLE800',
          label: 'Swivel',
          positionsRotary: true,
          params: [{ address: '_DIR', label: 'Direction', keepsRotary: true }],
        },
        {
          code: 'CYCL DEF 251',
          label: 'Pocket',
          params: [
            { address: 'Q224', label: 'Angle', position: 'none', inPlane: 'angle' },
            { address: 'Q367', label: 'Corner', position: 'none', inPlane: 'side' },
          ],
        },
        { code: 'G75', label: 'Chamfer', params: [{ address: 'L', label: 'Size', unit: 'length', signOf: 'next-move' }] },
      ],
    });
    expect(problems).toEqual([]);
    const at = (code: string) => db.codes.find((e) => e.code === code);
    expect(at('GOTO')?.flow).toBe('jump');
    expect(at('LBL')?.flow).toBe('label');
    expect(at('BLK FORM')?.blank).toBe(true);
    expect(at('TURN')?.positionsRotary).toBe(true);
    expect(at('CYCL DEF 11')?.frameIdentity).toBe('1');
    expect(at('CYCLE800')?.params?.[0].keepsRotary).toBe(true);
    expect(at('CYCL DEF 251')?.params?.map((p) => p.inPlane)).toEqual(['angle', 'side']);
    expect(at('G75')?.params?.[0].signOf).toBe('next-move');
  });

  it('drops and reports a value it does not know, and a member without its partner', () => {
    const { db, problems } = load({
      dialect: 'x',
      version: 1,
      codes: [
        { code: 'GOTO', label: 'Jump', flow: 'goto' },
        { code: 'CYCL DEF 11', label: 'Scaling', frame: 'open', frameIdentity: '1' },
        { code: 'CYCL DEF 26', label: 'Scaling', frame: 'open', frameZeroWords: ['X'], frameIdentity: 'one' },
        { code: 'CYCLE832', label: 'Tolerance', params: [{ address: '_TOL', label: 'Tolerance', keepsRotary: true }] },
        { code: 'G1', label: 'Line', params: [{ address: 'Q1', label: 'Angle', inPlane: 'corner', signOf: 'previous-move' }] },
      ],
    });
    expect(db.codes.map((e) => e.code)).toEqual(['GOTO', 'CYCL DEF 11', 'CYCL DEF 26', 'CYCLE832', 'G1']);
    expect(db.codes.some((e) => e.flow !== undefined || e.frameIdentity !== undefined)).toBe(false);
    expect(db.codes.find((e) => e.code === 'CYCLE832')?.params?.[0].keepsRotary).toBeUndefined();
    expect(problems.map((p) => p.path)).toEqual([
      'codes[0].flow',
      'codes[1].frameIdentity',
      'codes[2].frameIdentity',
      'codes[3].params[0].keepsRotary',
      'codes[4].params[0].inPlane',
      'codes[4].params[0].signOf',
    ]);
  });

  it('D6-3: accepts a condition that names one code (code:G68), negated or not', () => {
    const { db, problems } = load({
      dialect: 'x',
      version: 1,
      codes: [
        { code: 'G43.4', label: 'Tool centre point', conflicts: ['code:G68', '!code:G68.2', 'cycle'] },
        { code: 'G43.5', label: 'Tool centre point', conflicts: ['code:', 'code:68', 'code:G6 8'] },
      ],
    });
    expect(db.codes.find((e) => e.code === 'G43.4')?.conflicts).toEqual(['code:G68', '!code:G68.2', 'cycle']);
    expect(db.codes.find((e) => e.code === 'G43.5')?.conflicts).toBeUndefined();
    expect(problems.map((p) => p.path)).toEqual(['codes[1].conflicts[0]', 'codes[1].conflicts[1]', 'codes[1].conflicts[2]']);
  });

  it('D6-5, D6-6: carries frameZero, frameCloses and turnsRotary, and drops them without their partner', () => {
    const { db, problems } = load({
      dialect: 'x',
      version: 1,
      codes: [
        {
          code: 'CYCLE800',
          label: 'Swivel',
          frame: 'open',
          params: [
            { address: '_TC', label: 'Data set', frameCloses: '"0"' },
            { address: '_ST', label: 'State', frameZero: 'onesDigit' },
            { address: '_A', label: 'Angle', frameZero: 'zero' },
          ],
        },
        { code: 'CYCL DEF 19', label: 'Tilt', positionsRotary: true, params: [{ address: 'F', label: 'Feed', turnsRotary: true }] },
        { code: 'CYCLE832', label: 'Tolerance', params: [{ address: '_TOL', label: 'Tolerance', frameZero: 'zero', turnsRotary: true }] },
        { code: 'CYCLE801', label: 'Grid', frame: 'open', params: [{ address: '_A', label: 'Angle', frameZero: 'half', frameCloses: '' }] },
      ],
    });
    const at = (code: string) => db.codes.find((e) => e.code === code);
    expect(at('CYCLE800')?.params?.map((p) => [p.frameCloses ?? null, p.frameZero ?? null])).toEqual([
      ['"0"', null],
      [null, 'onesDigit'],
      [null, 'zero'],
    ]);
    expect(at('CYCL DEF 19')?.params?.[0].turnsRotary).toBe(true);
    expect(at('CYCLE832')?.params?.[0].frameZero).toBeUndefined();
    expect(at('CYCLE832')?.params?.[0].turnsRotary).toBeUndefined();
    expect(at('CYCLE801')?.params?.[0].frameZero).toBeUndefined();
    expect(problems.map((p) => p.path)).toEqual([
      'codes[2].params[0].turnsRotary',
      'codes[2].params[0].frameZero',
      'codes[3].params[0].frameZero',
      'codes[3].params[0].frameCloses',
    ]);
  });

  it('CODE-13: keeps shiftZeroIsNone only on a shift or a data code of the offset group', () => {
    const { db, problems } = load({
      dialect: 'x',
      version: 1,
      codes: [
        { code: 'G52', label: 'Local shift', axisWords: 'data', shift: true, shiftZeroIsNone: true },
        { code: 'TRANS DATUM', label: 'Datum shift', group: 'offset', axisWords: 'data', shiftZeroIsNone: true },
        { code: 'G92', label: 'Set', group: 'offset', shiftZeroIsNone: true },
        { code: 'G1', label: 'Line', group: 'motion', shiftZeroIsNone: true },
      ],
    });
    expect(db.codes.map((e) => [e.code, e.shiftZeroIsNone ?? null])).toEqual([
      ['G52', true],
      ['TRANS DATUM', true],
      ['G92', null],
      ['G1', null],
    ]);
    expect(problems.map((p) => p.path)).toEqual(['codes[2].shiftZeroIsNone', 'codes[3].shiftZeroIsNone']);
  });

  it('v1.2 T009/T012: keeps lengthAlong as an axis letter or "plane", never next to another role', () => {
    const { db, problems } = load({
      dialect: 'x',
      version: 1,
      codes: [
        { code: 'G90', label: 'Turning pass', params: [{ address: 'R', label: 'Taper', lengthAlong: 'x' }] },
        { code: 'G94', label: 'Facing pass', params: [{ address: 'R', label: 'Taper', position: 'none', lengthAlong: 'Z' }] },
        { code: 'CYCL DEF 251', label: 'Pocket', params: [{ address: 'Q218', label: 'Length', position: 'none', lengthAlong: 'plane' }] },
        { code: 'CYCL DEF 200', label: 'Drilling', params: [{ address: 'Q203', label: 'Surface', position: 'tool-axis', lengthAlong: 'Z' }] },
        { code: 'G1', label: 'Line', params: [{ address: 'Q1', label: 'Length', lengthAlong: 'XY' }] },
      ],
    });
    expect(db.codes.map((e) => e.params?.[0].lengthAlong ?? null)).toEqual(['X', 'Z', 'plane', null, null]);
    expect(db.codes[3].params?.[0].position).toBe('tool-axis');
    expect(problems.map((p) => p.path)).toEqual(['codes[3].params[0].lengthAlong', 'codes[4].params[0].lengthAlong']);
  });

  it('v1.2: keeps lengthInForce only next to lengthAlong', () => {
    const { db, problems } = load({
      dialect: 'x',
      version: 1,
      codes: [
        { code: 'RNDM', label: 'Rounding', params: [{ address: 'RNDM', label: 'Radius', unit: 'length', lengthAlong: 'plane', lengthInForce: true }] },
        { code: 'ADIS', label: 'Distance', params: [{ address: 'ADIS', label: 'Distance', unit: 'length', lengthInForce: true }] },
      ],
    });
    expect(db.codes.map((e) => e.params?.[0].lengthInForce ?? null)).toEqual([true, null]);
    expect(problems.map((p) => p.path)).toEqual(['codes[1].params[0].lengthInForce']);
  });

  it('v1.2 T013: keeps toolOffsetValues only as whole numbers on a shift code', () => {
    const { db, problems } = load({
      dialect: 'x',
      version: 1,
      codes: [
        { code: 'G10', label: 'Data setting', wordsAreData: true, shift: true, params: [{ address: 'L', label: 'Table', toolOffsetValues: ['1', '10', '11'] }] },
        { code: 'G11', label: 'Data setting', shift: true, params: [{ address: 'L', label: 'Table', toolOffsetValues: ['L10'] }] },
        { code: 'G12', label: 'Data setting', shift: true, params: [{ address: 'L', label: 'Table', toolOffsetValues: [] }] },
        { code: 'G65', label: 'Macro call', wordsAreData: true, params: [{ address: 'L', label: 'Count', toolOffsetValues: ['10'] }] },
      ],
    });
    expect(db.codes.map((e) => e.params?.[0].toolOffsetValues ?? null)).toEqual([['1', '10', '11'], null, null, null]);
    expect(problems.map((p) => p.path)).toEqual([
      'codes[1].params[0].toolOffsetValues',
      'codes[2].params[0].toolOffsetValues',
      'codes[3].params[0].toolOffsetValues',
    ]);
  });

  it('v1.2.0 NCR-9b: keeps a twin only as a pair of a tool-axis position and its relative depth', () => {
    const depth = (twin?: unknown, position = 'tool-axis') => ({ address: 'DP', label: 'Depth', position, ...(twin === undefined ? {} : { twin }) });
    const relative = (twin?: unknown, position = 'none') => ({ address: 'DPR', label: 'Relative depth', position, ...(twin === undefined ? {} : { twin }) });
    const { db, problems } = load({
      dialect: 'x',
      version: 1,
      codes: [
        // 0: the pair, both sides naming each other; the address is read upper case.
        { code: 'CYCLE81', label: 'Drilling', params: [depth('dpr'), relative('DP')] },
        // 1: one side only.
        { code: 'CYCLE82', label: 'Drilling', params: [depth('DPR'), relative()] },
        // 2: a twin that is no parameter of the code, and one that names itself.
        { code: 'CYCLE83', label: 'Drilling', params: [depth('FDPR'), { ...relative(), twin: 'DPR' }] },
        // 3: two absolute positions are no pair.
        { code: 'CYCLE84', label: 'Tapping', params: [depth('DPR'), relative('DP', 'tool-axis')] },
        // 4: a position nobody reviewed is no pair either.
        { code: 'CYCLE85', label: 'Boring', params: [{ address: 'DP', label: 'Depth', twin: 'DPR' }, relative('DP')] },
        // 5: not an address.
        { code: 'CYCLE86', label: 'Boring', params: [depth(7), relative()] },
      ],
    });
    const twins = db.codes.map((e) => (e.params ?? []).map((p) => p.twin ?? null));
    expect(twins).toEqual([
      ['DPR', 'DP'],
      [null, null],
      [null, null],
      [null, null],
      [null, null],
      [null, null],
    ]);
    expect(problems.map((p) => p.path)).toEqual([
      'codes[1].params[0].twin',
      'codes[2].params[0].twin',
      'codes[2].params[1].twin',
      'codes[3].params[0].twin',
      'codes[3].params[1].twin',
      'codes[4].params[0].twin',
      'codes[4].params[1].twin',
      'codes[5].params[0].twin',
    ]);
    // The rest of a parameter with a broken twin is kept as written.
    expect(db.codes[3].params?.map((p) => p.position)).toEqual(['tool-axis', 'tool-axis']);
  });

  it('v1.2.0 NCR-9b: carries the Sinumerik depth twins through the loader, where the scripts read them', () => {
    // The cycles manual: the depth is given either absolute (DP) or from the reference plane
    // (DPR); with both, DPR counts; the first peck FDPR works like DPR; an empty parameter is 0.
    const pairs = sinumerik.db.codes
      .filter((e) => (e.params ?? []).some((p) => p.twin !== undefined))
      .map((e) => [e.code, (e.params ?? []).filter((p) => p.twin !== undefined).map((p) => `${p.address}>${p.twin}`).join(' ')]);
    expect(pairs).toEqual([
      ['CYCLE81', 'DP>DPR DPR>DP'],
      ['CYCLE82', 'DP>DPR DPR>DP'],
      ['CYCLE83', 'DP>DPR DPR>DP FDEP>FDPR FDPR>FDEP'],
      ['CYCLE84', 'DP>DPR DPR>DP'],
      ['CYCLE840', 'DP>DPR DPR>DP'],
      ['CYCLE85', 'DP>DPR DPR>DP'],
      ['CYCLE86', 'DP>DPR DPR>DP'],
      ['CYCLE87', 'DP>DPR DPR>DP'],
      ['CYCLE88', 'DP>DPR DPR>DP'],
      ['CYCLE89', 'DP>DPR DPR>DP'],
      ['SLOT1', '_DP>_DPR _DPR>_DP'],
      ['SLOT2', '_DP>_DPR _DPR>_DP'],
    ]);
    // Every Sinumerik code with a relative depth has its twin marked, and every marked entry is
    // on the owner's review page.
    const absoluteOf: Record<string, string> = { DPR: 'DP', _DPR: '_DP', FDPR: 'FDEP' };
    for (const e of sinumerik.db.codes) {
      for (const p of e.params ?? []) {
        if (absoluteOf[p.address] !== undefined) expect(p.twin, `${e.code} ${p.address}`).toBe(absoluteOf[p.address]);
      }
    }
    for (const [code] of pairs) expect(lookupCode(sinumerik.db, code)?.review, code).toBe('pending');
    // No other dialect ships a twin.
    for (const db of [fanuc.db, heidenhain.db, okuma.db]) {
      expect(db.codes.some((e) => (e.params ?? []).some((p) => p.twin !== undefined))).toBe(false);
    }
  });

  it('v1.2 T009: a two-block entry has to agree on lengthAlong in both blocks', () => {
    const { db, problems } = load({
      dialect: 'x',
      version: 1,
      codes: [
        {
          code: 'G76',
          label: 'Threading',
          blocks: 2,
          params: [
            { address: 'R', label: 'Allowance', position: 'none', block: 1 },
            { address: 'R', label: 'Taper', position: 'none', lengthAlong: 'X', block: 2 },
          ],
        },
      ],
    });
    expect(db.codes[0].params?.map((p) => p.label)).toEqual(['Allowance']);
    expect(problems.map((p) => p.path)).toEqual(['codes[0].params[1].lengthAlong']);
  });
});

describe('P4b follow-ups (v1.2.0)', () => {
  it('T144: reads machineType "mill" or "lathe" and drops any other value', () => {
    const { db, problems } = load({
      dialect: 'x',
      version: 1,
      codes: [
        { code: 'POCKET3', label: 'Pocket', machineType: 'mill' },
        { code: 'CYCLE95', label: 'Stock removal', machineType: 'lathe' },
        { code: 'CYCLE81', label: 'Drilling' },
        { code: 'CYCLE97', label: 'Thread', machineType: 'turning' },
        { code: 'CYCLE98', label: 'Thread chain', machineType: true },
      ],
    });
    expect(db.codes.map((e) => e.machineType ?? null)).toEqual(['mill', 'lathe', null, null, null]);
    expect(problems.map((p) => p.path)).toEqual(['codes[3].machineType', 'codes[4].machineType']);
  });

  it('T144: marks the Sinumerik turning cycles as the cycle manuals sort them; the milling and drilling cycles stay for every machine', () => {
    // 840D sl NC programming manual 06/2019 §3.25.1 (the technology table: turning CYCLE951,
    // 930, 940, 99, 98, 92 and contour turning CYCLE952); 840D cycles manual 01/2008 chapter 4
    // (the turning cycles CYCLE93, 95, 97, 98). The milling cycles (CYCLE61, POCKET3, POCKET4,
    // SLOT1, SLOT2, contour milling CYCLE72) are unmarked: a lathe with driven tools runs them
    // too (owner 2026-10-22, WX-NC-4), so the cycle form offers them on the turning profile.
    const typed = (type: 'mill' | 'lathe'): string[] => sinumerik.db.codes.filter((e) => e.machineType === type).map((e) => e.code);
    expect(typed('lathe')).toEqual(['CYCLE93', 'CYCLE95', 'CYCLE97', 'CYCLE99', 'CYCLE92', 'CYCLE930', 'CYCLE940', 'CYCLE951', 'CYCLE952', 'CYCLE98']);
    expect(typed('mill')).toEqual([]);
    // The milling and drilling cycles, the contour call both technologies use, and every other entry are unmarked.
    for (const code of ['CYCLE61', 'POCKET3', 'POCKET4', 'SLOT1', 'SLOT2', 'CYCLE72', 'CYCLE81', 'CYCLE82', 'CYCLE83', 'CYCLE84', 'CYCLE840', 'CYCLE85', 'CYCLE86', 'CYCLE87', 'CYCLE88', 'CYCLE89', 'CYCLE62', 'CYCLE800']) {
      expect(lookupCode(sinumerik.db, code)?.machineType, code).toBeUndefined();
    }
    // Every marked entry is on the owner's review page, and no other database marks one.
    for (const code of [...typed('lathe'), ...typed('mill')]) expect(lookupCode(sinumerik.db, code)?.review, code).toBe('pending');
    for (const raw of Object.values(BUILTIN_CODE_DB_JSON)) {
      const db = load(raw).db;
      if (db.dialect === 'sinumerik') continue;
      expect(db.codes.filter((e) => e.machineType !== undefined).map((e) => e.code), db.dialect).toEqual([]);
    }
  });

  it('the Fanuc lathe roughing cycles G71, G72 and G73 need P and Q in their second block (30i lathe manual §4.2.1-4.2.3)', () => {
    // The cycle runs from the block that writes P (ns) and Q (nf); the first block has neither.
    const lathe = resolveCodeDbs(BUILTIN_CODE_DB_JSON);
    for (const dialect of ['fanuc-lathe', 'fanuc-lathe-b']) {
      for (const code of ['G71', 'G72', 'G73']) {
        const params = lookupCode(lathe[dialect], code)?.params ?? [];
        const required = params.filter((p) => p.required === true).map((p) => `${p.address}${p.block}`);
        expect(required, `${dialect} ${code}`).toEqual(['P2', 'Q2']);
      }
    }
  });

  it('Klartext 201 reads Q208=0 as the plunging feed Q206 (the owner, 2026-10-20; TNC 640 cycles manual §3.4)', () => {
    const entry = lookupCode(heidenhain.db, 'CYCL DEF 201');
    expect(entry?.expand && 'kind' in entry.expand ? entry.expand.feedOutZero : null).toBe('feed');
    expect(entry?.params?.find((p) => p.address === 'Q208')?.label).toBe('Retract feed (0: the plunging feed Q206)');
    // No other schema gives a feed of 0 a meaning: there it still refuses.
    for (const db of [fanuc.db, heidenhain.db, sinumerik.db]) {
      for (const e of db.codes) {
        if (e.code === 'CYCL DEF 201' || e.expand === undefined) continue;
        const schemas = 'by' in e.expand ? Object.values(e.expand.cases) : [e.expand];
        for (const schema of schemas) expect(schema.feedOutZero, e.code).toBeUndefined();
      }
    }
  });

  it('P4b fix batch 3 (NC-6): reads blockFeed true and reports any other value', () => {
    const { db, problems } = load({
      dialect: 'x',
      version: 1,
      codes: [
        { code: 'CYCL CALL POS', label: 'Call at a position', blockFeed: true },
        { code: 'CYCL CALL', label: 'Call' },
        { code: 'CYCL CALL PAT', label: 'Call on a pattern', blockFeed: 'yes' },
        { code: 'M99', label: 'Call once', blockFeed: false },
      ],
    });
    expect(db.codes.map((e) => e.blockFeed ?? null)).toEqual([true, null, null, null]);
    expect(problems.map((p) => p.path)).toEqual(['codes[2].blockFeed']);
  });

  it('P4b fix batch 3 (NC-1, NC-6): the subprogram calls carry call, and CYCL CALL POS a feed for its block only', () => {
    const calls = (db: CodeDb): string[] => db.codes.filter((e) => e.call === true).map((e) => e.code);
    expect(calls(heidenhain.db)).toEqual(['CALL LBL', 'CALL PGM']);
    expect(calls(sinumerik.db)).toEqual(['CALL', 'PCALL', 'EXTCALL']);
    expect(calls(okuma.db)).toEqual(['CALL', 'MODIN']);
    // A cycle entry is never a call: Expand Drilling Cycles reads CYCL CALL and M99 itself.
    for (const db of [fanuc.db, heidenhain.db, sinumerik.db, okuma.db]) {
      expect(db.codes.filter((e) => e.call === true && e.sets?.cycle !== undefined).map((e) => e.code), db.dialect).toEqual([]);
    }
    for (const raw of Object.values(BUILTIN_CODE_DB_JSON)) {
      const db = load(raw).db;
      // Wave Y (T163): RND and CHF, whose feed applies to the rounding or the chamfer only.
      expect(db.codes.filter((e) => e.blockFeed === true).map((e) => e.code), db.dialect).toEqual(db.dialect === 'heidenhain' ? ['RND', 'CHF', 'CYCL CALL POS'] : []);
    }
  });
});
