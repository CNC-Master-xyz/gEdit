// What the shipped Sinumerik database says (plan §8.5, AD-19; gate G10 §8.7 item 3).
// Owner: WP8.5.
//
// Every assertion here decides what the editor tells a machinist, and four of them decide
// whether a program survives a script:
//
//   - `pitchFeed` marks a block whose `F` — or whose `I`/`K` — carries a thread lead. On a
//     cycle written as a call, which stands in a block of its own, it marks a cycle that may
//     take its lead from the feed in force (CYCLE840 without a spindle encoder); a cycle
//     whose lead is one of its arguments (CYCLE84, CYCLE97, CYCLE99) does not carry it.
//     Scaling a lead scraps the thread, so the list is written out in full and compared,
//     not spot-checked.
//   - `fNotFeed` marks `G4`, where `F` is a dwell in seconds. Scaling it changes how long
//     the tool stands still at the bottom of a hole, and reporting it as a feed puts a
//     time into the feed range of the program report.
//   - `sets.speedLimit` marks `G25` and `G26`, whose `S` is a limit and not a speed, exactly
//     as `LIMS=` is on the profile side.
//   - `sets.diameter` marks `DIAMON`, `DIAMOF` and `DIAM90`, and nothing else.
//
// Which entries carry `verify: true` follows one rule, written down here because G10
// reads it: a meaning the notes tag [M] or [P] (the 840D sl programming manual, 06/2019), a
// DIN 66025 meaning, or one the owner decided (D35; M6 on 2026-10-08) is shown in hover; what the manual
// only lists (G942, G952) and what the machine sets up (M19) is not. The source review (2026-09) read
// the cycles manual of 01/2008, which describes CYCLE87–CYCLE89; B1 (a7s) took CYCLE93 and
// CYCLE97 from it as well.
//
// The database is read through `resolveCodeDbFiles` (AD-17) so it is the merge result the
// app uses that is checked, and through `loadCodeDb` where the loaded shape matters.

import { describe, expect, it } from 'vitest';
import sinumerikJson from '$lib/data/codes/sinumerik.json';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { loadCodeDb, type CodeDbProblem } from '$lib/core/codes/load';
import { lookupCode, normalizeCode } from '$lib/core/codes/lookup';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import type { CodeDb, CodeEntry } from '$lib/core/codes/types';

const DIALECT = 'sinumerik';

const problems: CodeDbProblem[] = [];
const db: CodeDb = loadCodeDb(sinumerikJson, (p) => problems.push(p));

const fileProblems: string[] = [];
const FILES = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, p) =>
  fileProblems.push(`${dialect}: ${p.path}: ${p.message}`),
);

/** The resolved entries as they are written in JSON, codes normalised. */
const ENTRIES: CodeEntry[] = ((FILES[DIALECT]?.codes ?? []) as CodeEntry[]).map((entry) => ({
  ...entry,
  code: normalizeCode(entry.code),
}));

function entry(code: string): CodeEntry | undefined {
  return ENTRIES.find((e) => e.code === normalizeCode(code));
}

const codesWith = (predicate: (e: CodeEntry) => boolean): string[] =>
  ENTRIES.filter(predicate).map((e) => e.code).sort();

/** The group names of plan §7.2, plus `pathmode`, which §8.5's table adds for G60–G645. */
const MODAL_GROUPS = [
  'motion', 'plane', 'units', 'distance', 'feedmode', 'spindlemode', 'spindle', 'coolant', 'compensation',
  'lengthComp', 'offset', 'cycle', 'cyclereturn', 'diametermode', 'pathmode',
  // M10 (WP10.2): G290/G291, the language the control reads the program in.
  'language',
  // B1 (a7s): G601–G603, when the next block starts under an exact stop (G group 12).
  'exactstop',
];

describe('the shipped Sinumerik database', () => {
  it('loads and resolves without a single problem', () => {
    expect(problems).toEqual([]);
    expect(fileProblems).toEqual([]);
    expect(db.dialect).toBe(DIALECT);
    expect(FILES[DIALECT]).toBeDefined();
    // It stands on its own: no `extends`, because no other dialect it could extend
    // shares its comment character, its calls or its keywords (AD-17).
    expect((FILES[DIALECT] as { extends?: string }).extends).toBeUndefined();
  });

  it('has no duplicate code and no duplicate alias', () => {
    const keys = ENTRIES.flatMap((e) => [e.code, ...(e.aliases ?? []).map(normalizeCode)]);
    expect(new Set(keys).size, keys.filter((key, i) => keys.indexOf(key) !== i).join(', ')).toBe(keys.length);
  });

  it('gives every entry a label and every address a label', () => {
    for (const e of ENTRIES) {
      expect(e.label?.length, e.code).toBeGreaterThan(0);
      expect(e.code, e.code).toBe(e.code.toUpperCase());
    }
    for (const [letter, address] of Object.entries(db.addresses)) {
      expect(address.label.length, letter).toBeGreaterThan(0);
    }
  });

  it('keeps the addresses the grammar is generated from', () => {
    // The Sinumerik grammar paints every address of this database (WP8.4), so changing
    // this list changes the grammar snapshot another package owns.
    expect(Object.keys(db.addresses).sort()).toEqual(
      ['AR', 'C', 'CR', 'D', 'F', 'G', 'I', 'J', 'K', 'L', 'LIMS', 'M', 'N', 'P', 'S', 'SF', 'T', 'X', 'Y', 'Z'],
    );
  });

  it('puts every modal code in a modal group the plan names', () => {
    // §8.7 item 3: every modal group name comes from §7.2 (and §8.5's path mode); the
    // interpreter treats the group of every `modal` entry as one (§7.2).
    for (const e of ENTRIES.filter((row) => row.modal)) {
      expect(MODAL_GROUPS, `${e.code} is modal in "${String(e.group)}"`).toContain(e.group);
    }
  });

  it('calls nothing non-modal that stays in force until it is switched off', () => {
    // A hover that says "Non-modal" on `SOFT` or `TRANSMIT` tells the reader the opposite
    // of what the control does. Those entries carry no group rather than a wrong one.
    for (const code of ['SOFT', 'BRISK', 'TRANSMIT', 'TRACYL', 'TRAFOOF', 'TRAORI']) {
      expect(entry(code)?.group, code).toBeUndefined();
    }
    // M9 (WP9.1): G74 and G75, the reference-point and fixed-point approaches, act in their block only.
    expect(codesWith((e) => e.group === 'nonmodal')).toEqual([
      'G153', 'G25', 'G26', 'G4', 'G53', 'G63', 'G74', 'G75', 'G9', 'STOPRE', 'SUPA',
    ]);
  });

  it('describes every keyword the profile tokenizes', () => {
    // A keyword the tokenizer hands over as a keyword token and the database has never
    // heard of hovers as "not described yet".
    const raw = BUILTIN_PROFILE_JSON.find((p) => (p as { id?: string }).id === DIALECT);
    const checked = validateProfile(raw);
    if (!checked.ok) throw new Error(checked.errors.join('; '));
    const cp = compileProfile(checked.profile);
    const missing = (cp.profile.syntax.keywords ?? []).filter((keyword) => lookupCode(db, keyword) === null);
    expect(missing, 'keywords without an entry').toEqual([]);
  });

  it('ships the CAM subset §8.5 lists', () => {
    const codes = new Set(ENTRIES.map((e) => e.code));
    const expected = [
      'G0', 'G1', 'G2', 'G3', 'CIP', 'CT',
      'G4',
      'G9', 'G60', 'G64', 'G641', 'G642',
      'G17', 'G18', 'G19',
      'G25', 'G26',
      'G33', 'G331', 'G332',
      'G40', 'G41', 'G42',
      'G53', 'G153', 'SUPA',
      'G54', 'G55', 'G56', 'G57', 'G500',
      'G70', 'G71', 'G700', 'G710',
      'G90', 'G91',
      'G93', 'G94', 'G95',
      'G96', 'G97', 'G961', 'G962', 'G971', 'G972', 'G973',
      'G34', 'G35', 'G335', 'G336', 'G63',
      'DIAMON', 'DIAMOF', 'DIAM90',
      'CYCLE81', 'CYCLE82', 'CYCLE83', 'CYCLE85', 'CYCLE86', 'CYCLE87', 'CYCLE88', 'CYCLE89',
      'CYCLE84', 'CYCLE840',
      'CYCLE93', 'CYCLE95', 'CYCLE97', 'CYCLE99',
      'CYCLE62', 'CYCLE92', 'CYCLE98', 'CYCLE930', 'CYCLE940', 'CYCLE951', 'CYCLE952',
      'MCALL',
      'TRANSMIT', 'TRACYL', 'TRAFOOF', 'SOFT', 'BRISK', 'STOPRE',
      'M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M8', 'M9', 'M17', 'M19', 'M30',
      'GOTOF', 'GOTOB', 'GOTO', 'IF', 'ENDIF', 'WHILE', 'ENDWHILE', 'FOR', 'ENDFOR',
      'LOOP', 'ENDLOOP', 'RET', 'PROC', 'DEF', 'EXTERN', 'CALL', 'EXTCALL',
    ];
    expect(expected.filter((code) => !codes.has(code))).toEqual([]);
  });

  it('describes no machine-builder code', () => {
    // §1 of the notes and the M8 brief: a builder's own cycles show up as ordinary calls
    // (`L7xx`, `NAME(…)`) and are highlighted generically, and an M code above 30 is the
    // builder's — except the ones the control itself predefines, the gear stages M40–M45
    // and M70 (the programming manual's list of M functions, source review 2026-09).
    // Shipping a builder's code as a built-in would put a claim about somebody else's
    // machine into hover.
    expect(ENTRIES.filter((e) => /^L\d+$/.test(e.code)).map((e) => e.code)).toEqual([]);
    const mCodes = ENTRIES.filter((e) => /^M\d+$/.test(e.code)).map((e) => Number(e.code.slice(1)));
    expect(mCodes.filter((n) => n > 30)).toEqual([40, 41, 42, 43, 44, 45, 70]);
  });
});

describe('what a code does to the modal state', () => {
  it('switches the plane, the distance mode, the units, the feed and the speed', () => {
    expect(entry('G18')?.sets).toEqual({ plane: 'ZX' });
    expect(entry('G17')?.sets).toEqual({ plane: 'XY' });
    expect(entry('G90')?.sets).toEqual({ distance: 'absolute' });
    expect(entry('G91')?.sets).toEqual({ distance: 'incremental' });
    expect(entry('G70')?.sets).toEqual({ units: 'inch' });
    expect(entry('G71')?.sets).toEqual({ units: 'mm' });
    expect(entry('G700')?.sets).toEqual({ units: 'inch' });
    expect(entry('G710')?.sets).toEqual({ units: 'mm' });
    // On this control the feed type and the spindle mode are one group (G group 15): G96
    // switches to feed per revolution, G961 and G971 to feed per minute, and G94 or G95
    // end a constant cutting speed.
    expect(entry('G95')?.sets).toEqual({ feedUnit: 'per-rev', speedUnit: 'rpm' });
    expect(entry('G94')?.sets).toEqual({ feedUnit: 'per-minute', speedUnit: 'rpm' });
    expect(entry('G93')?.sets).toEqual({ feedUnit: 'inverse-time', speedUnit: 'rpm' });
    expect(entry('G96')?.sets).toEqual({ feedUnit: 'per-rev', speedUnit: 'surface' });
    expect(entry('G97')?.sets).toEqual({ feedUnit: 'per-rev', speedUnit: 'rpm' });
    expect(entry('G961')?.sets).toEqual({ feedUnit: 'per-minute', speedUnit: 'surface' });
    expect(entry('G971')?.sets).toEqual({ feedUnit: 'per-minute', speedUnit: 'rpm' });
    expect(entry('G973')?.sets).toEqual({ feedUnit: 'per-rev', speedUnit: 'rpm' });
    // G962 and G972 keep the feed unit they find.
    expect(entry('G962')?.sets).toEqual({ speedUnit: 'surface' });
    expect(entry('G972')?.sets).toEqual({ speedUnit: 'rpm' });
    // 2026-09: SVC= is a value word (§7.5) that switches nothing; its `speedUnit` says that
    // its own value is a cutting speed, which scale_speed reads like the S under G96.
    expect(entry('SVC')?.sets).toEqual({ speedUnit: 'surface' });
    expect(entry('SVC')?.group).toBe('tool');
    const feedType = codesWith((e) => e.code !== 'SVC' && (e.sets?.speedUnit !== undefined || e.sets?.feedUnit !== undefined));
    expect(feedType).toEqual(['G93', 'G931', 'G94', 'G942', 'G95', 'G952', 'G96', 'G961', 'G962', 'G97', 'G971', 'G972', 'G973']);
    // M9 review F8: G931's F is the time the move takes, so no script may scale it as a feed.
    expect(entry('G931')?.sets).toEqual({ feedUnit: 'travel-time', speedUnit: 'rpm' });
    for (const code of feedType) expect(entry(code)?.group, code).toBe('feedmode');
    expect(codesWith((e) => e.group === 'spindlemode')).toEqual([]);
    // G70/G71 are the unit switch on this control, not the Fanuc lathe's finishing and
    // roughing cycles. Reading them the other way round would report a cycle where the
    // program only chose millimetres.
    expect(entry('G70')?.group).toBe('units');
    expect(entry('G71')?.description).toMatch(/not a roughing cycle/);
    expect(entry('G70')?.description).toMatch(/not a finishing cycle/);
    expect(entry('G71')?.params).toBeUndefined();
  });

  it('switches diameter programming on DIAMON, DIAMOF and DIAM90 and nowhere else', () => {
    // v1.2.0 manual-check fix round (D5-9): DIAMCYCOF, written inside cycles, moves in radii too.
    expect(codesWith((e) => e.sets?.diameter !== undefined)).toEqual(['DIAM90', 'DIAMCYCOF', 'DIAMOF', 'DIAMON']);
    expect(entry('DIAMCYCOF')?.sets).toEqual({ diameter: 'off' });
    expect(entry('DIAMCYCOF')?.group).toBe('diametermode');
    expect(entry('DIAMON')?.sets).toEqual({ diameter: 'on' });
    expect(entry('DIAMOF')?.sets).toEqual({ diameter: 'off' });
    expect(entry('DIAM90')?.sets).toEqual({ diameter: 'absolute-only' });
    for (const code of ['DIAMON', 'DIAMOF', 'DIAM90']) {
      expect(entry(code)?.group, code).toBe('diametermode');
      expect(entry(code)?.modal, code).toBe(true);
      // D35 is the owner's decision about exactly these three codes.
      expect(entry(code)?.verify, code).toBeUndefined();
    }
  });

  it('keeps the spindle and the coolant switched until another code of their group', () => {
    // As in every other built-in database: M3, M4 and M5 leave the master spindle running
    // or stopped, M8 and M9 the coolant on or off. M19 and SETMS change no running state
    // of that group, and the spindle forms `M3=3` are assignment words, not these codes.
    for (const code of ['M3', 'M4', 'M5']) {
      expect(entry(code)?.group, code).toBe('spindle');
      expect(entry(code)?.modal, code).toBe(true);
    }
    for (const code of ['M8', 'M9']) {
      expect(entry(code)?.group, code).toBe('coolant');
      expect(entry(code)?.modal, code).toBe(true);
    }
    for (const code of ['M19', 'SETMS']) expect(entry(code)?.modal, code).toBeUndefined();
  });

  it('marks G25 and G26 as speed limits, and says they limit the working area with axis words', () => {
    expect(codesWith((e) => e.sets?.speedLimit === true)).toEqual(['G25', 'G26']);
    for (const code of ['G25', 'G26']) {
      expect(entry(code)?.description, code).toMatch(/limit, not a speed/);
      expect(entry(code)?.label, code).toMatch(/working area with axis words/);
      expect(entry(code)?.verify, code).toBeUndefined();
    }
  });

  it('starts a cycle on every CYCLE entry and on G63, for its own block', () => {
    const starts = codesWith((e) => e.sets?.cycle === 'start');
    expect(starts).toEqual([
      'CYCLE61', 'CYCLE62', 'CYCLE72', 'CYCLE81', 'CYCLE82', 'CYCLE83', 'CYCLE84', 'CYCLE840', 'CYCLE85', 'CYCLE86',
      'CYCLE87', 'CYCLE88', 'CYCLE89', 'CYCLE92', 'CYCLE93', 'CYCLE930', 'CYCLE940', 'CYCLE95',
      'CYCLE951', 'CYCLE952', 'CYCLE97', 'CYCLE98', 'CYCLE99', 'G63', 'POCKET3', 'POCKET4', 'SLOT1', 'SLOT2',
    ]);
    // G63 taps once: the move type in force before it applies again after its block.
    expect(entry('G63')?.group).toBe('nonmodal');
    // None of them is modal: a `CYCLE8x(…)` call drills once, at the position it stands
    // at, and `MCALL` is what makes the next positioning blocks repeat it. MCALL neither
    // starts nor cancels a cycle in the data: it is the word that makes the cycle written
    // behind it modal (`call-modal-next`, the interpreter's rule 11b), and alone it ends that.
    for (const code of starts) expect(entry(code)?.modal, code).toBeUndefined();
    expect(entry('MCALL')?.sets).toEqual({ cycle: 'call-modal-next' });
    expect(entry('MCALL')?.group).toBe('cycle');
    expect(codesWith((e) => e.sets?.cycle === 'cancel')).toEqual([]);
  });
});

describe('the words a script must not scale', () => {
  it('marks every code whose F is or follows a thread lead as pitchFeed, and nothing else', () => {
    expect(codesWith((e) => e.pitchFeed === true)).toEqual([
      'CYCLE840', 'G33', 'G331', 'G332', 'G335', 'G336', 'G34', 'G35', 'G63',
    ]);
    for (const code of ['G33', 'G331', 'G332', 'G34', 'G35', 'G335', 'G336']) {
      expect(entry(code)?.group, code).toBe('motion');
      expect(entry(code)?.modal, code).toBe(true);
    }
    // G34 and G35: F is the change of the lead per revolution, never a feed.
    for (const code of ['G34', 'G35']) expect(entry(code)?.description, code).toMatch(/F the change of the lead/);
    // CYCLE840 without a spindle encoder taps with the feed in force (ENC, argument 9).
    expect(entry('CYCLE840')?.description).toMatch(/ENC/);
    // A cycle whose lead is its own argument takes nothing from the feed in force.
    for (const code of ['CYCLE84', 'CYCLE97', 'CYCLE98', 'CYCLE99']) {
      expect(entry(code)?.pitchFeed, code).toBeUndefined();
      expect(entry(code)?.description, code).toMatch(/lead|pitch/i);
    }
    // The drilling, boring and turning cycles have no lead: their feed is an ordinary feed.
    for (const code of ['CYCLE81', 'CYCLE82', 'CYCLE83', 'CYCLE85', 'CYCLE86', 'CYCLE87', 'CYCLE88', 'CYCLE89', 'CYCLE92', 'CYCLE93', 'CYCLE95', 'CYCLE930', 'CYCLE951', 'CYCLE952']) {
      expect(entry(code)?.pitchFeed, code).toBeUndefined();
    }
    // On this control the lead of a `G33` block is in `I`, `J` or `K`, not in `F` (§8.5 and
    // the M8 brief): anything that ever scales an arc centre has to skip such a block.
    expect(entry('G33')?.description).toMatch(/lead, given in I, J or K/);
    expect(db.addresses.K.label).toMatch(/thread lead/);
    expect(db.addresses.I.label).toMatch(/thread lead/);
  });

  // Owner decision of 2026-09-27: the speed of a tap is not scaled. CYCLE84 taps with its
  // lead as an argument, so it is tapping without pitchFeed; G33 is threading.
  it('marks the tapping codes, and no threading code, as tapping', () => {
    expect(codesWith((e) => e.tapping === true)).toEqual(['CYCLE84', 'CYCLE840', 'G331', 'G332', 'G63']);
    expect(entry('CYCLE84')?.pitchFeed).toBeUndefined();
    for (const code of ['G33', 'G34', 'G35', 'G335', 'G336', 'CYCLE97', 'CYCLE99']) {
      expect(entry(code)?.tapping, code).toBeUndefined();
    }
  });

  it('marks G4 as the one code whose F is a time, and says its S is not a speed', () => {
    expect(codesWith((e) => e.fNotFeed === true)).toEqual(['G4']);
    expect(entry('G4')?.group).toBe('nonmodal');
    expect(entry('G4')?.description).toMatch(/in seconds/);
    expect(entry('G4')?.description).toMatch(/S is not a speed/);
    // The dwell is `F` here, never `P` as on a Fanuc control (§4.6 of the notes).
    expect(entry('G4')?.description).not.toMatch(/\bP\b/);
    expect(db.addresses.F.description).toMatch(/G4 it is a dwell/);
    expect(db.addresses.S.description).toMatch(/G4 it is a dwell in spindle revolutions/);
  });

  it('claims no second meaning for a code that has only one here', () => {
    // `pitchFeedAmbiguous` says "this number is a threading cycle in another G-code
    // system of this dialect". Sinumerik has no second system, so nothing carries it.
    expect(codesWith((e) => e.pitchFeedAmbiguous === true)).toEqual([]);
  });

  it('names LIMS a limit in the address list too', () => {
    expect(db.addresses.LIMS.description).toMatch(/limit, not a speed/);
  });
});

describe('the cycles', () => {
  const DRILLING = ['CYCLE81', 'CYCLE82', 'CYCLE83', 'CYCLE84', 'CYCLE840', 'CYCLE85', 'CYCLE86', 'CYCLE87', 'CYCLE88', 'CYCLE89'];
  const unitOf = (code: string, address: string) => entry(code)?.params?.find((p) => p.address === address)?.unit;

  it('start with the five every drilling cycle shares, in the order the control reads them', () => {
    for (const code of DRILLING) {
      const params = entry(code)?.params ?? [];
      expect(params.slice(0, 5).map((p) => p.address), code).toEqual(['RTP', 'RFP', 'SDIS', 'DP', 'DPR']);
      for (const param of params) expect(param.label.length, `${code} ${param.address}`).toBeGreaterThan(0);
    }
    // P10 (R8): the arguments a newer control writes after these are described too, so that
    // address arithmetic can tell a mode argument at 0 from one that changes the positions.
    expect(entry('CYCLE83')?.params?.map((p) => p.address)).toEqual([
      'RTP', 'RFP', 'SDIS', 'DP', 'DPR', 'FDEP', 'FDPR', '_DAM', 'DTB', 'DTS', 'FRF', 'VARI',
      '_AXN', '_MDEP', '_VRT', '_DTD', '_DIS1', '_GMODE', '_DMODE', '_AMODE',
    ]);
    expect(entry('CYCLE84')?.params?.map((p) => p.address)).toEqual([
      'RTP', 'RFP', 'SDIS', 'DP', 'DPR', 'DTB', 'SDAC', 'MPIT', 'PIT', 'POSS', 'SST', 'SST1',
      '_AXN', '_PITA', '_TECHNO', '_VARI', '_DAM', '_VRT', '_PITM', '_PTAB', '_PTABA', '_GMODE', '_DMODE', '_AMODE',
    ]);
  });

  it('reads a dwell as a time and a mode code as a plain number, and leaves positions as written', () => {
    // A cycle takes its values in brackets, by position, as numbers of the program's unit:
    // no machine setting that counts a point-less `X50` in increments applies to them. A
    // length or angle class would let a hypothetical increment preset turn RTP 5 into
    // 0.005 mm, so the positions carry none.
    for (const code of DRILLING) {
      for (const address of ['RTP', 'RFP', 'SDIS', 'DP', 'DPR']) expect(unitOf(code, address), `${code} ${address}`).toBeUndefined();
    }
    expect(unitOf('CYCLE86', 'POSS')).toBeUndefined();
    expect(unitOf('CYCLE82', 'DTB')).toBe('dwell');
    expect(unitOf('CYCLE83', 'DTS')).toBe('dwell');
    // A mode code is a number the control looks up, not a distance: `count` is what stops
    // every reading rule from touching it (§7.2, AD-31).
    expect(unitOf('CYCLE83', 'VARI')).toBe('count');
    expect(unitOf('CYCLE86', 'SDIR')).toBe('count');
    expect(unitOf('CYCLE840', 'ENC')).toBe('count');
    expect(unitOf('CYCLE84', 'SDAC')).toBe('count');
    // A thread pitch has no class at all, so no machine setting can rescale it; the
    // `pitchFeed` flag on the entry is what keeps a script off the whole block.
    expect(unitOf('CYCLE84', 'PIT')).toBeUndefined();
    expect(unitOf('CYCLE84', 'MPIT')).toBeUndefined();
    const units = new Set(ENTRIES.flatMap((e) => (e.params ?? []).map((p) => p.unit)).filter((u) => u !== undefined));
    // M9 (WP9.5a): the leads of the thread codes (`G33` and its kin take theirs from I, J
    // or K; `G34`/`G35` have the change of the lead in F) are declared as what they are, a
    // feed per revolution, so their I, J and K are no arc centres. The cycle pitch `PIT`
    // above is an argument and stays without a class.
    // P4a integration (§7 #307): the intermediate point of CIP (`I1=`, `J1=`, `K1=`) is a
    // coordinate of its axis and has the axis word's class, length; no cycle argument has one.
    expect([...units].sort()).toEqual(['count', 'dwell', 'feedPerRev', 'length']);
    // v1.2 NC fix round (FZ-7 and after): the words written with `=` that describe their own value, a
    // length: the rounding distances ADIS= and ADISPOS=, the corner words CHF=, CHR=, RND=, RNDM=
    // and the arc radius CR=.
    expect(ENTRIES.filter((e) => (e.params ?? []).some((p) => p.unit === 'length')).map((e) => e.code)).toEqual(['CIP', 'ADIS', 'ADISPOS', 'CHF', 'CHR', 'RND', 'RNDM', 'CR']);
    expect(
      ENTRIES.filter((e) => (e.params ?? []).some((p) => p.unit === 'feedPerRev')).map((e) => e.code),
    ).toEqual(['G33', 'G331', 'G332', 'G34', 'G35', 'G335', 'G336']);
    // CYCLE81 has a dwell too, and a dwell of the drilling cycles is seconds when positive
    // and spindle revolutions when negative.
    expect(entry('CYCLE81')?.params?.map((p) => p.address)).toEqual(['RTP', 'RFP', 'SDIS', 'DP', 'DPR', 'DTB', '_GMODE', '_DMODE', '_AMODE']);
    expect(entry('CYCLE81')?.params?.[5].label).toMatch(/revolutions when negative/);
  });

  it('lists the feeds of the turning cycles where a script can find them', () => {
    // A program cut by CYCLE95 or CYCLE952 carries its feeds as arguments: the parameter
    // labels are what scale feed lists them by (a label that names a feed).
    const feeds = (code: string) => (entry(code)?.params ?? []).filter((p) => /\bfeed\b(?!\s+factor)/i.test(p.label)).map((p) => p.address);
    expect(feeds('CYCLE95')).toEqual(['FF1', 'FF2', 'FF3']);
    expect(feeds('CYCLE951')).toEqual(['_FF1']);
    // CYCLE952 has a third feed at the very end, for the finishing cut of a call that roughs
    // and finishes.
    expect(feeds('CYCLE952')).toEqual(['_F', '_FR', '_FS']);
    expect(entry('CYCLE952')?.params?.map((p) => p.address).indexOf('_FS')).toBe(33);
    expect(feeds('CYCLE930')).toEqual(['_FF1']);
    expect(feeds('CYCLE92')).toEqual(['_FF1', '_FF2']);
    expect(feeds('CYCLE99')).toEqual([]);
    expect(entry('CYCLE95')?.label).toMatch(/stock removal/i);
    expect(entry('CYCLE930')?.label).toMatch(/groov/i);
    expect(entry('CYCLE99')?.label).toMatch(/thread/i);
    expect(entry('CYCLE99')?.label).not.toMatch(/undercut|relief/i);
    // B1 (a7s): not in the 4.92 cycle list; described from the cycles manual of 01/2008
    // (§4.3, §4.7). Neither has a feed among its arguments: CYCLE93 names none, and
    // CYCLE97 takes its lead from PIT or MPIT.
    expect(entry('CYCLE93')?.params?.map((p) => p.address)).toEqual([
      'SPD', 'SPL', 'WIDG', 'DIAG', 'STA1', 'ANG1', 'ANG2', 'RCO1', 'RCO2', 'RCI1', 'RCI2', 'FAL1', 'FAL2', 'IDEP', 'DTB', 'VARI', '_VRT', '_DN',
    ]);
    expect(entry('CYCLE97')?.params?.map((p) => p.address)).toEqual([
      'PIT', 'MPIT', 'SPL', 'FPL', 'DM1', 'DM2', 'APP', 'ROP', 'TDEP', 'FAL', 'IANG', 'NSP', 'NRC', 'NID', 'VARI', 'NUMT', '_VRT',
    ]);
    for (const code of ['CYCLE93', 'CYCLE97']) {
      expect(feeds(code), code).toEqual([]);
      expect(entry(code)?.verify, code).toBeUndefined();
      expect(entry(code)?.description, code).not.toMatch(/not described yet/);
    }
    expect(unitOf('CYCLE93', 'DTB')).toBe('dwell');
    expect(entry('CYCLE93')?.params?.find((p) => p.address === 'DTB')?.label).toMatch(/in seconds/);
  });
});

describe('what is confirmed and what is not', () => {
  it('leaves marked for verification only what the manual does not settle', () => {
    // The 840D sl programming manual (06/2019) settles the G groups, the cycles of its 4.92
    // list and the language. What it only lists, what the machine sets up and the cycles
    // it does not describe stay out of hover (§8.7 items 3 and 6). The flags a script
    // reads — `pitchFeed`, `sets` — work regardless.
    // M6 left the list on the owner's answer of 2026-10-08 (M9-7): on a Siemens mill it is
    // the tool change that loads the tool selected with T.
    expect(codesWith((e) => e.verify === true)).toEqual(['G942', 'G952', 'M19']);
    expect(entry('M6')?.description).toMatch(/loads the tool selected with T/);
  });

  it('shows what the notes tag [M], what DIN 66025 fixes and what the owner decided', () => {
    // The turning core: a hover that stayed silent on `G18` or `G95` would be useless.
    const shown = [
      'G0', 'G1', 'G2', 'G3', 'G4', 'G17', 'G18', 'G19', 'G25', 'G26', 'G33', 'G34', 'G35', 'G63', 'G331', 'G332', 'G40',
      'G41', 'G42', 'G53', 'G153', 'G54', 'G500', 'G70', 'G71', 'G90', 'G91', 'G93', 'G94', 'G95', 'G96', 'G97', 'G961',
      'G971', 'DIAMON', 'DIAMOF', 'DIAM90', 'M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M8', 'M9', 'M17', 'M30', 'MSG', 'STOPRE',
      'SETMS', 'IF', 'ELSE', 'ENDIF', 'GOTOF', 'GOTOB', 'GOTO', 'EXTERN', 'AND', 'OR', 'CYCLE81', 'CYCLE83', 'CYCLE84',
      'CYCLE840', 'CYCLE95', 'CYCLE99', 'MCALL', 'RET', 'PROC',
    ];
    for (const code of shown) expect(entry(code)?.verify, code).toBeUndefined();
  });

  it('keeps a claim the notes mark for verification out of the text that is always shown', () => {
    // An address has no `verify` flag, so what it says is always in hover. That leading
    // zeros are part of an L number is settled by the manual; the G43 remark is not.
    expect(db.addresses.L.description).toMatch(/leading zeros/);
    expect(db.addresses.D.description).not.toMatch(/G43/);
    // An operator message is where posts often put the operation name — which the notes
    // mark for verification, so the shown text does not claim it.
    expect(entry('MSG')?.description).not.toMatch(/operation/i);
    for (const code of ['G90', 'G91']) expect(entry(code)?.description, code).not.toMatch(/AC\(|IC\(/);
    expect(entry('GOTOF')?.description).not.toMatch(/block number/);
  });
});

describe('B1 (a7s): the codes taken from the 840D sl manuals', () => {
  // Facts from the 840D sl NC programming manual 06/2019 (§2.11, §3.1.8, §3.7.4, §3.13.5.3,
  // §3.14.10, §3.25.1.5–3.25.1.11, G groups 10, 12, 22, 30) and the cycles manual 01/2008.
  // Each entry carries the owner's review mark until the owner has read it.
  const feeds = (code: string) => (entry(code)?.params ?? []).filter((p) => /\bfeed\b(?!\s+factor)/i.test(p.label)).map((p) => p.address);
  const NEW = [
    'G601', 'G602', 'G603', 'G643', 'G644', 'CYCLE61', 'POCKET3', 'POCKET4', 'SLOT1', 'CTOL', 'OTOL',
    'WAITM', 'WAITMC', 'WAITE', 'SETM', 'CLEARM', 'INIT', 'START', 'COMPSURF', 'CUT3DCC', 'CUT3DCCD',
  ];
  const CHANGED = ['G645', 'CYCLE93', 'CYCLE97'];

  it('ships every new entry with a label and a description, marked for the owner\'s review', () => {
    for (const code of [...NEW, ...CHANGED]) {
      const e = entry(code) as (CodeEntry & { review?: string }) | undefined;
      expect(e, code).toBeDefined();
      expect(e?.description?.length ?? 0, code).toBeGreaterThan(0);
      expect(e?.review, code).toBe('pending');
      expect(e?.verify, code).toBeUndefined();
    }
  });

  it('keeps the exact-stop criteria apart from the path mode, and the new roundings in it', () => {
    // G601–G603 are G group 12: they choose when the next block starts under G60 or G9 and
    // do not end G60. G643 and G644 are path modes of group 10 like G641, G642 and G645.
    for (const code of ['G601', 'G602', 'G603']) {
      expect([entry(code)?.group, entry(code)?.modal], code).toEqual(['exactstop', true]);
      expect(entry(code)?.description, code).toMatch(/G60 or G9/);
    }
    for (const code of ['G643', 'G644', 'G645']) expect([entry(code)?.group, entry(code)?.modal], code).toEqual(['pathmode', true]);
    expect(codesWith((e) => e.group === 'exactstop')).toEqual(['G601', 'G602', 'G603']);
  });

  it('lists the arguments of the milling cycles in the order the control reads them', () => {
    const order = (code: string) => entry(code)?.params?.map((p) => p.address);
    expect(order('CYCLE61')).toEqual([
      '_RTP', '_RFP', '_SDIS', '_DP', '_PA', '_PO', '_LENG', '_WID', '_MID', '_MIDA', '_FALD', '_FFP1', '_VARI', '_LIM', '_DMODE', '_AMODE',
    ]);
    expect(order('POCKET3')).toEqual([
      '_RTP', '_RFP', '_SDIS', '_DP', '_LENG', '_WID', '_CRAD', '_PA', '_PO', '_STA', '_MID', '_FAL', '_FALD', '_FFP1', '_FFD',
      '_CDIR', '_VARI', '_MIDA', '_AP1', '_AP2', '_AD', '_RAD1', '_DP1', '_UMODE', '_FS', '_ZFS', '_GMODE', '_DMODE', '_AMODE',
    ]);
    expect(order('POCKET4')).toEqual([
      '_RTP', '_RFP', '_SDIS', '_DP', '_CDIAM', '_PA', '_PO', '_MID', '_FAL', '_FALD', '_FFP1', '_FFD', '_CDIR', '_VARI', '_MIDA',
      '_AP1', '_AD', '_RAD1', '_DP1', '_UMODE', '_FS', '_ZFS', '_GMODE', '_DMODE', '_AMODE',
    ]);
    expect(order('SLOT1')).toEqual([
      'RTP', 'RFP', 'SDIS', '_DP', '_DPR', 'NUM', 'LENG', 'WID', '_CPA', '_CPO', 'RAD', 'STA1', 'INDA', 'FFD', 'FFP1', '_MID',
      'CDIR', '_FAL', 'VARI', '_MIDF', 'FFP2', 'SSF', '_FALD', '_STA2', '_DP1', '_UMODE', '_FS', '_ZFS', '_GMODE', '_DMODE', '_AMODE',
    ]);
    // POCKET4's fifth argument is a radius unless _DMODE says diameter (the 2008 manual calls it _PRAD).
    expect(entry('POCKET4')?.params?.[4].label).toMatch(/radius, or its diameter/i);
    // SLOT1 changed its meaning between versions: the label says both.
    expect(entry('SLOT1')?.description).toMatch(/Older versions mill NUM slots on a circle/);
  });

  it('names the feeds of the milling cycles so Scale Feed lists them, and no factor or mode as one', () => {
    expect(feeds('CYCLE61')).toEqual(['_FFP1']);
    expect(feeds('POCKET3')).toEqual(['_FFP1', '_FFD']);
    expect(feeds('POCKET4')).toEqual(['_FFP1', '_FFD']);
    // FFP2 is the finishing feed of older SLOT1 versions and reserved in the current one.
    expect(feeds('SLOT1')).toEqual(['FFD', 'FFP1', 'FFP2']);
    for (const code of ['CYCLE61', 'POCKET3', 'POCKET4', 'SLOT1']) {
      expect(entry(code)?.pitchFeed, code).toBeUndefined();
      expect(entry(code)?.tapping, code).toBeUndefined();
    }
  });

  it('describes the tolerance words and the channel commands', () => {
    // CTOL= and OTOL= are values written with `=`, as SVC= is: they switch nothing.
    for (const code of ['CTOL', 'OTOL']) {
      expect(entry(code)?.sets, code).toBeUndefined();
      expect(entry(code)?.modal, code).toBeUndefined();
      expect(entry(code)?.description, code).toMatch(/negative value goes back/);
    }
    for (const code of ['WAITM', 'WAITMC', 'WAITE', 'SETM', 'CLEARM', 'INIT', 'START']) expect(entry(code)?.group, code).toBe('program');
    expect(entry('CLEARM')?.description).toMatch(/CLEARM\(\) clears all/);
  });
});

describe('SLOT2, CYCLE72, ADIS= and ADISPOS= from the manuals (owner decision 2026-10-12)', () => {
  // Facts from the 840D sl NC programming manual 06/2019 (§2.11.2 pp. 298–307, §3.25.1.8
  // pp. 1055–1057, §3.25.1.16 pp. 1070–1073, §4.1 p. 1176, §4.2 p. 1222), the external-cycles
  // manual 03/2009 (§1.21, §1.27) and the cycles manual 01/2008 (§3.6, §3.12). Each entry carries
  // the owner's review mark until the owner has read it.
  const feeds = (code: string) => (entry(code)?.params ?? []).filter((p) => /\bfeed\b(?!\s+factor)/i.test(p.label)).map((p) => p.address);
  const order = (code: string) => entry(code)?.params?.map((p) => p.address);
  const label = (code: string, address: string) => entry(code)?.params?.find((p) => p.address === address)?.label;

  it('ships every new entry with a label and a description, marked for the owner\'s review', () => {
    for (const code of ['SLOT2', 'CYCLE72', 'ADIS', 'ADISPOS']) {
      const e = entry(code) as (CodeEntry & { review?: string }) | undefined;
      expect(e, code).toBeDefined();
      expect(e?.description?.length ?? 0, code).toBeGreaterThan(0);
      expect(e?.review, code).toBe('pending');
      expect(e?.verify, code).toBeUndefined();
    }
  });

  it('lists the arguments of SLOT2 and CYCLE72 in the order the control reads them', () => {
    expect(order('SLOT2')).toEqual([
      'RTP', 'RFP', 'SDIS', '_DP', '_DPR', 'NUM', 'AFSL', 'WID', '_CPA', '_CPO', 'RAD', 'STA1', 'INDA', 'FFD', 'FFP1', '_MID',
      'CDIR', '_FAL', 'VARI', '_MIDF', 'FFP2', 'SSF', '_FFCP', '_UMODE', '_FS', '_ZFS', '_GMODE', '_DMODE', '_AMODE',
    ]);
    expect(order('CYCLE72')).toEqual([
      '_KNAME', '_RTP', '_RFP', '_SDIS', '_DP', '_MID', '_FAL', '_FALD', '_FFP1', '_FFD', '_VARI', '_RL', '_AS1', '_LP1', '_FF3',
      '_AS2', '_LP2', '_UMODE', '_FS', '_ZFS', '_GMODE', '_DMODE', '_AMODE',
    ]);
    for (const code of ['SLOT2', 'CYCLE72']) {
      expect([entry(code)?.group, entry(code)?.sets?.cycle, entry(code)?.modal], code).toEqual(['cycle', 'start', undefined]);
    }
    // The older versions stop after argument 23 (SLOT2, _FFCP) and 17 (CYCLE72, _LP2).
    expect(entry('SLOT2')?.description).toMatch(/first 23 arguments/);
    expect(entry('CYCLE72')?.description).toMatch(/first 17 arguments/);
  });

  it('says both readings where a version changed the meaning of an argument', () => {
    // SLOT2: the milling direction was G2/G3 and the four finishing arguments were active.
    expect(label('SLOT2', 'CDIR')).toMatch(/0 climb, 1 conventional \(older versions 2 with G2, 3 with G3\)/);
    for (const address of ['_MIDF', 'FFP2', 'SSF', '_FFCP']) expect(label('SLOT2', address), address).toMatch(/^Reserved in the current version; .* older ones/);
    // CYCLE72: the retraction digit 0 went to _RTP in the 2008 manual, to the reference point since.
    expect(label('CYCLE72', '_VARI')).toMatch(/0 to the reference point \(older versions: to _RTP\)/);
    expect(label('CYCLE72', '_KNAME')).toMatch(/START:END/);
    expect(entry('CYCLE72')?.description).toMatch(/CYCLE62/);
    // CYCLE62 names the contour for CYCLE72 too, not for a turning cycle only.
    expect(entry('CYCLE62')?.description).toMatch(/CYCLE72/);
    expect((entry('CYCLE62') as (CodeEntry & { review?: string }) | undefined)?.review).toBe('pending');
  });

  it('names the feeds so Scale Feed lists them, and nothing else as one', () => {
    // FFP2 and _FFCP are feeds of older SLOT2 versions and reserved in the current one.
    expect(feeds('SLOT2')).toEqual(['FFD', 'FFP1', 'FFP2', '_FFCP']);
    expect(feeds('CYCLE72')).toEqual(['_FFP1', '_FFD', '_FF3']);
    for (const code of ['SLOT2', 'CYCLE72']) {
      expect(entry(code)?.pitchFeed, code).toBeUndefined();
      expect(entry(code)?.tapping, code).toBeUndefined();
    }
  });

  it('describes ADIS= and ADISPOS= as rounding lengths that switch nothing', () => {
    // Values written with `=`, as CTOL= is: no group, no modal flag, nothing they set.
    for (const code of ['ADIS', 'ADISPOS']) {
      expect([entry(code)?.group, entry(code)?.modal, entry(code)?.sets], code).toEqual([undefined, undefined, undefined]);
      // v1.2 NC fix round: described by their own address, a length, so the transforms keep
      // them; no size of the part (no lengthAlong).
      expect(entry(code)?.params, code).toEqual([expect.objectContaining({ address: code, unit: 'length' })]);
      expect(entry(code)?.params?.[0].lengthAlong, code).toBeUndefined();
      expect(entry(code)?.description, code).toMatch(/G641/);
      expect(entry(code)?.description, code).toMatch(/a length written without a sign, not a feed/);
    }
    expect(entry('ADISPOS')?.description).toMatch(/G0/);
    expect(entry('ADISPOS')?.description).toMatch(/smaller of ADIS and ADISPOS/);
  });

  it('v1.2.0 (NCF-C): describes FRC= and FRCM= as the feeds of a chamfer or rounding, no length', () => {
    // The transforms keep a word an entry describes by its own address; without the entry they
    // refused FRC= as an unknown word. A feed in the unit in force: no unit class, no lengthAlong.
    for (const code of ['FRC', 'FRCM']) {
      expect([entry(code)?.group, entry(code)?.modal, entry(code)?.sets], code).toEqual([undefined, undefined, undefined]);
      expect(entry(code)?.params, code).toEqual([expect.objectContaining({ address: code, min: 0 })]);
      expect(entry(code)?.params?.[0].unit, code).toBeUndefined();
      expect(entry(code)?.params?.[0].lengthAlong, code).toBeUndefined();
      expect((entry(code) as (CodeEntry & { review?: string }) | undefined)?.review, code).toBe('pending');
      expect(entry(code)?.description, code).toMatch(/G94.*G95/);
    }
    expect(entry('FRCM')?.description).toMatch(/FRCM=0/);
  });
});

describe('B1 fix NC (NC-07): CYCLE93 SPD and SLOT1 _DP labels', () => {
  it('says SPD of CYCLE93 is a diameter under diameter programming', () => {
    expect(entry('CYCLE93')?.params?.find((p) => p.address === 'SPD')?.label).toMatch(/diameter/);
  });
  it('says _DP of SLOT1 becomes a depth through _AMODE', () => {
    expect(entry('SLOT1')?.params?.find((p) => p.address === '_DP')?.label).toMatch(/_AMODE/);
  });
});

describe('v1.2.0 manual-check fix round (batch B5): the cycle arguments of the newer manuals', () => {
  // SINUMERIK 840D sl programming manual SW 4.94 (2020), "Programming cycles externally".
  const addresses = (code: string): string[] => (entry(code)?.params ?? []).map((p) => p.address);

  it('D1-3: describes the 14 arguments of CYCLE82, the last five understood only at 0', () => {
    expect(addresses('CYCLE82')).toEqual(['RTP', 'RFP', 'SDIS', 'DP', 'DPR', 'DTB', '_GMODE', '_DMODE', '_AMODE', '_VARI', 'S_ZA', 'S_FA', 'S_ZD', 'S_FD']);
    const late = (entry('CYCLE82')?.params ?? []).slice(9);
    for (const p of late) {
      // A mode: translate, rotate, mirror and address arithmetic refuse a block that writes it as anything but 0.
      expect(p.position, p.address).toBe('mode');
      expect(p.expandRole, p.address).toBe('default');
    }
    const schema = entry('CYCLE82')?.expand;
    expect(schema && 'defaults' in schema ? schema.defaults : undefined).toMatchObject({ _VARI: '0', S_ZA: '0', S_FA: '0', S_ZD: '0', S_FD: '0' });
  });

  it('D5-9: describes all 30 arguments of CYCLE99', () => {
    expect(addresses('CYCLE99')).toEqual([
      '_SPL', '_SPD', '_FPL', '_FPD', '_APP', '_ROP', '_TDEP', '_FAL', '_IANG', '_NSP', '_NRC', '_NID', '_PIT', '_VARI', '_NUMTH',
      '_SDIS', '_MID', '_GDEP', '_PIT1', '_FDEP', '_GST', '_GUD', '_IFLANK', '_PITA', '_PITM', '_PTAB', '_PTABA', '_DMODE', '_AMODE', '_S_XRS',
    ]);
    // Still no reviewed role: the thread cycle is not moved (it refuses as before).
    expect((entry('CYCLE99')?.params ?? []).every((p) => p.position === undefined)).toBe(true);
  });

  it('D6-5: marks the arguments of the swivel to the home position', () => {
    // Read as written: the loader carries these marks from the patch for core/codes on.
    const raw = (p: unknown): Record<string, unknown> => p as Record<string, unknown>;
    const marks = (entry('CYCLE800')?.params ?? []).map((p) => [p.address, raw(p).frameZero ?? raw(p).frameCloses ?? null]);
    expect(marks.filter(([, m]) => m !== null)).toEqual([
      ['_TC', '"0"'], ['_ST', 'onesDigit'], ['_X0', 'zero'], ['_Y0', 'zero'], ['_Z0', 'zero'], ['_A', 'zero'], ['_B', 'zero'], ['_C', 'zero'], ['_X1', 'zero'], ['_Y1', 'zero'], ['_Z1', 'zero'],
    ]);
  });
});
