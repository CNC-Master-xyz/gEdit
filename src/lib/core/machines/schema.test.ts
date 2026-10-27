// The machines schema against the hand-written checks (Phase 4 plan AD-57, §6.10 rules 1–5).
// `readMachine`, `validateMachine`, `channelBlock`, `motionBlock` and `limitsBlock` stay the gate;
// this test holds the schema to the same answer on every machines file the tests hold and on a
// broken set written as patches of one full file, and lists the rules that need the profile, the
// code database or a compiled pattern (VALIDATOR_ONLY).
//
// The code's verdict on a file is what the Machines page lists: a file that cannot be used, a
// newer `$version`, a record that is not understood, a record its profile refuses, a default
// machine that is not text, and a broken channel, motion or limits block (those cost the block,
// not the record, but they are listed).

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import machinesSchema from '../../../../schemas/machines.schema.json';
import { ALLOWED_KEYWORDS, type Json, memberPaths, type Schema, schemaPaths, schemasAt, subschemas, testValidator } from '../../../../tests/unit/helpers/jsonSchema';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { validateProfile } from '$lib/core/profiles/validate';
import { codes } from '$lib/stores/codes';
import type { Profile } from '$lib/core/profiles/types';
import { applyMachine, effectiveMachine } from './effective';
import { defaultProblems, parseMachinesFile, positionOf } from './file';
import { limitsBlock, motionBlock } from './motion';
import { MACHINES_VERSION, type MachineConfig, type MachineProblem } from './types';
import { channelBlock, validateMachine } from './validate';

const ajv = testValidator();
const validate = ajv.compile(machinesSchema);
const ROOT = machinesSchema as unknown as Schema;

function schemaAccepts(value: unknown): boolean {
  return validate(value) === true;
}

function schemaErrors(value: unknown): string[] {
  validate(value);
  return (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
}

// ---------------------------------------------------------------------------
// The code's verdict
// ---------------------------------------------------------------------------

const BUILTIN: Profile[] = BUILTIN_PROFILE_JSON.map((raw) => {
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  return checked.profile;
});

/**
 * The built-in profiles, with the Siemens profile offering extra axes and builder codes as plan
 * §6.10 rules 13 and 14 make it do (P4.43b writes those two members into `sinumerik.json`; until
 * then the test lays them on, so the members are tested now).
 */
function profileOf(id: string): Profile | undefined {
  const found = BUILTIN.find((p) => p.id === id);
  if (found === undefined || id !== 'sinumerik') return found;
  const decl = found.machineParams ?? {};
  return {
    ...found,
    machineParams: {
      ...decl,
      extraAxes: decl.extraAxes ?? { verify: true },
      builderCodes: decl.builderCodes ?? { letters: ['G'], example: 'G810-G829', verify: true },
    },
  };
}

/** Every problem the Machines page would list for this file (see the header). */
function codeProblems(raw: unknown): MachineProblem[] {
  const parsed = parseMachinesFile(raw);
  if (parsed.error !== null) return [{ machineId: null, path: '', message: parsed.error }];
  const out: MachineProblem[] = [];
  if (parsed.version > MACHINES_VERSION) out.push({ machineId: null, path: '$version', message: 'a newer file' });
  for (const entry of parsed.invalid) out.push(...entry.problems);
  out.push(...defaultProblems(parsed.defaults));
  parsed.machines.forEach((m: MachineConfig, i) => {
    const path = `machines[${positionOf(m) ?? i}]`;
    const profile = profileOf(m.profile);
    let db;
    try {
      db = profile === undefined ? undefined : codes.byId(applyMachine(profile, effectiveMachine(profile, m, 'document', {})).codes);
    } catch {
      db = undefined;
    }
    out.push(...validateMachine(m, { path, profile, codes: db }));
    if (profile === undefined) return;
    const waitLetters = profile.machineParams?.channels?.waitLetters;
    const channels = channelBlock(m, path, { waitLetters });
    if (channels.state === 'invalid') out.push(...channels.problems);
    const sets = { axes: profile.addresses?.axes ?? [], angular: profile.addresses?.angular ?? [] };
    const motion = motionBlock(m, path, sets);
    if (motion.state === 'invalid') out.push(...motion.problems);
    const limits = limitsBlock(m, path, sets);
    if (limits.state === 'invalid') out.push(...limits.problems);
  });
  return out;
}

// ---------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------

const FILES_DIR = 'tests/fixtures/machines/files';
/** Not machines files: tables of cases that other tests read. */
const NOT_A_MACHINES_FILE = new Set(['r6-tool-words.json']);
const FIXTURES = readdirSync(FILES_DIR)
  .filter((name) => name.endsWith('.json') && !NOT_A_MACHINES_FILE.has(name))
  .map((name) => ({ name, value: JSON.parse(readFileSync(`${FILES_DIR}/${name}`, 'utf8')) as unknown }));

const FULL = JSON.parse(readFileSync('tests/fixtures/p4h/machines/full.json', 'utf8')) as Json;

/**
 * The rules JSON Schema cannot say, each with why (rule 2). A broken case that names one of these
 * is refused by the code and accepted by the schema.
 */
const VALIDATOR_ONLY: Record<string, string> = {
  'profile-exists': 'whether the profile a machine names is loaded is known only to the app, not to the file',
  'machine-offers': 'which members a machine may set depends on what its profile declares in machineParams',
  'variant-choice': "a variant's choices are listed in the profile, not in the machines file",
  'modal-code-in-group': 'whether a power-on code exists and belongs to its group is answered by the code database',
  'unique-by-member': 'JSON Schema can say that whole items differ, not that one member of each item does (ids, names, aliases, rule ids)',
  'pattern-compiles': 'a schema can say that a pattern is text, not that it compiles as a regular expression',
  'pattern-subset': "gEdit's pattern language (AD-11) leaves out parts of the regular expressions a pattern could still match as text",
  'pattern-shape': 'a pattern that repeats a repeated part can take very long; finding that shape needs a parser',
  'channel-references': 'a wait rule names channels and other rules of the same block by their text',
  'wait-code-list': 'a list of codes and ranges is read by its own parser, with the letters the profile allows',
  'builder-code-letter': "the letters of a builder code list come from the profile's declaration",
  'min-not-above-max': 'JSON Schema cannot compare two values of one object (travel, mark numbers, digits)',
  'motion-axis-of-profile': "the axis letters of a rate or a travel are the profile's",
  'bound-by-axis': 'a rotary axis has its own bound and a linear one in inch the mm bound divided by 25.4; which axis is rotary is in the profile',
};

interface Case {
  name: string;
  /** `schema`: the schema refuses it too; otherwise the VALIDATOR_ONLY rule it shows. */
  rule: 'schema' | keyof typeof VALIDATOR_ONLY;
  patch: (f: Json) => void;
}

const clone = <T>(value: T): T => structuredClone(value);
const recs = (f: Json): Json[] => f.machines as Json[];
const rec = (f: Json, id: string): Json => recs(f).find((m) => m.id === id) as Json;
const params = (f: Json, id: string): Json => rec(f, id).params as Json;
const lathe = (f: Json): Json => params(f, 'lathe-full');
const okuma = (f: Json): Json => params(f, 'okuma-full');
const sin = (f: Json): Json => params(f, 'sinumerik-full');
const ch = (p: Json): Json => p.channels as Json;
const rule = (p: Json, i = 0): Json => (ch(p).syncMarks as Json[])[i];
const ni = (f: Json): Json => lathe(f).numberInput as Json;
const motion = (f: Json): Json => lathe(f).motion as Json;
const limits = (f: Json): Json => lathe(f).limits as Json;
const many = (n: number, make: (i: number) => unknown): unknown[] => Array.from({ length: n }, (_, i) => make(i));

const CASES: Case[] = [
  // The file
  { name: 'a file that is a list', rule: 'schema', patch: (f) => void (f.machines = 'none') },
  { name: 'defaults that are not an object', rule: 'schema', patch: (f) => void (f.defaults = ['lathe-full']) },
  { name: 'a default machine that is a number', rule: 'schema', patch: (f) => void (f.defaults = { 'fanuc-lathe': 5 }) },
  { name: 'a default machine that is a list', rule: 'schema', patch: (f) => void (f.defaults = { 'fanuc-lathe': ['lathe-full'] }) },
  { name: 'a newer file version', rule: 'schema', patch: (f) => void (f.$version = 2) },
  { name: 'more than 100 machines', rule: 'schema', patch: (f) => void (f.machines = many(101, (i) => ({ id: `m${i}`, name: `M ${i}`, profile: 'fanuc-gcode' }))) },
  // readMachine
  { name: 'a record that is no object', rule: 'schema', patch: (f) => void (f.machines as unknown[]).push(5) },
  { name: 'an id with a capital', rule: 'schema', patch: (f) => void (rec(f, 'mill-plain').id = 'Mill') },
  { name: 'an id used twice', rule: 'unique-by-member', patch: (f) => void (rec(f, 'mill-plain').id = 'lathe-full') },
  { name: 'a blank name', rule: 'schema', patch: (f) => void (rec(f, 'mill-plain').name = '  ') },
  { name: 'a name of 65 characters', rule: 'schema', patch: (f) => void (rec(f, 'mill-plain').name = 'x'.repeat(65)) },
  { name: 'a name used twice, ignoring case', rule: 'unique-by-member', patch: (f) => void (rec(f, 'mill-plain').name = 'LATHE WITH EVERY MEMBER') },
  { name: 'no profile', rule: 'schema', patch: (f) => void delete rec(f, 'mill-plain').profile },
  { name: 'params that are a list', rule: 'schema', patch: (f) => void (rec(f, 'mill-plain').params = []) },
  { name: 'notes of 501 characters', rule: 'schema', patch: (f) => void (rec(f, 'mill-plain').notes = 'n'.repeat(501)) },
  { name: 'notes that are a number', rule: 'schema', patch: (f) => void (rec(f, 'mill-plain').notes = 5) },
  // validateMachine
  { name: 'a profile that is not loaded', rule: 'profile-exists', patch: (f) => void (rec(f, 'mill-plain').profile = 'my-mill') },
  { name: 'a profile without machine parameters', rule: 'machine-offers', patch: (f) => void (rec(f, 'mill-plain').profile = 'heidenhain-klartext') },
  { name: 'a reading that does not exist', rule: 'schema', patch: (f) => void (ni(f).mode = 'inches') },
  { name: 'no metric increment', rule: 'schema', patch: (f) => void delete ni(f).incrementMm },
  { name: 'a metric increment of zero', rule: 'schema', patch: (f) => void (ni(f).incrementMm = '0.000') },
  { name: 'an increment as a number', rule: 'schema', patch: (f) => void (ni(f).incrementMm = 0.001) },
  { name: 'an increment with an exponent', rule: 'schema', patch: (f) => void (ni(f).incrementInch = '1e-4') },
  { name: 'a negative degree increment', rule: 'schema', patch: (f) => void (ni(f).incrementDeg = '-1') },
  { name: 'classes that are text', rule: 'schema', patch: (f) => void (ni(f).classes = 'none') },
  { name: 'a class that does not exist', rule: 'schema', patch: (f) => void ((ni(f).classes as Json).torque = {}) },
  { name: 'a class entry that is a number', rule: 'schema', patch: (f) => void ((ni(f).classes as Json).dwell = 1) },
  { name: 'a class with a reading that does not exist', rule: 'schema', patch: (f) => void (((ni(f).classes as Json).feedPerRev as Json).mode = 'as-written') },
  { name: 'a class increment that is no decimal', rule: 'schema', patch: (f) => void (((ni(f).classes as Json).dwell as Json).increment = 'x') },
  { name: 'an inch increment on the angle class', rule: 'schema', patch: (f) => void (((ni(f).classes as Json).angle as Json).incrementInch = '0.001') },
  { name: 'units in cm', rule: 'schema', patch: (f) => void (lathe(f).units = 'cm') },
  { name: 'units that are null', rule: 'schema', patch: (f) => void (lathe(f).units = null) },
  { name: 'a diameter mode "yes"', rule: 'schema', patch: (f) => void (lathe(f).diameter = 'yes') },
  { name: 'a diameter mode on a mill', rule: 'machine-offers', patch: (f) => void (params(f, 'mill-plain').diameter = 'on') },
  { name: 'variants that are a list', rule: 'schema', patch: (f) => void (lathe(f).variants = ['B']) },
  { name: 'a variant the profile does not have', rule: 'machine-offers', patch: (f) => void ((lathe(f).variants as Json).gcodeSystems = 'B') },
  { name: 'a variant choice the profile does not list', rule: 'variant-choice', patch: (f) => void ((lathe(f).variants as Json).gcodeSystem = 'Q') },
  { name: 'a variant choice that is a number', rule: 'schema', patch: (f) => void ((lathe(f).variants as Json).gcodeSystem = 2) },
  { name: 'modalInitial that is text', rule: 'schema', patch: (f) => void (lathe(f).modalInitial = 'G95') },
  { name: 'a power-on group the profile does not offer', rule: 'machine-offers', patch: (f) => void ((lathe(f).modalInitial as Json).coolant = 'M9') },
  { name: 'an empty power-on code', rule: 'schema', patch: (f) => void ((lathe(f).modalInitial as Json).feedmode = '') },
  { name: 'a power-on code the database does not know', rule: 'modal-code-in-group', patch: (f) => void ((lathe(f).modalInitial as Json).feedmode = 'G950') },
  { name: 'a power-on code of another group', rule: 'modal-code-in-group', patch: (f) => void ((lathe(f).modalInitial as Json).feedmode = 'G1') },
  // Extra axes and builder codes (prelude shape; the clashes are P4.43b's)
  { name: 'extra axes on a profile that has none', rule: 'machine-offers', patch: (f) => void (lathe(f).extraAxes = [{ name: 'AA', kind: 'linear' }]) },
  { name: 'extra axes that are text', rule: 'schema', patch: (f) => void (sin(f).extraAxes = 'AA') },
  { name: 'seventeen extra axes', rule: 'schema', patch: (f) => void (sin(f).extraAxes = many(17, (i) => ({ name: `A${String.fromCharCode(65 + i)}`, kind: 'linear' }))) },
  { name: 'an extra axis that is text', rule: 'schema', patch: (f) => void (sin(f).extraAxes = ['AA']) },
  { name: 'an extra axis of one letter', rule: 'schema', patch: (f) => void ((sin(f).extraAxes as Json[])[0].name = 'A') },
  { name: 'an extra axis in lower case', rule: 'schema', patch: (f) => void ((sin(f).extraAxes as Json[])[0].name = 'aa') },
  { name: 'an extra axis listed twice', rule: 'unique-by-member', patch: (f) => void ((sin(f).extraAxes as Json[])[1].name = 'AA') },
  { name: 'an extra axis of a third kind', rule: 'schema', patch: (f) => void ((sin(f).extraAxes as Json[])[0].kind = 'spindle') },
  { name: 'builder codes on a profile that has none', rule: 'machine-offers', patch: (f) => void (lathe(f).builderCodes = 'G810') },
  { name: 'empty builder codes', rule: 'schema', patch: (f) => void (sin(f).builderCodes = ' ') },
  { name: 'builder codes of 1001 characters', rule: 'schema', patch: (f) => void (sin(f).builderCodes = `G810,${' '.repeat(996)}`) },
  { name: 'builder codes of another letter', rule: 'builder-code-letter', patch: (f) => void (sin(f).builderCodes = 'M810-M829') },
  { name: 'builder codes that do not read', rule: 'wait-code-list', patch: (f) => void (sin(f).builderCodes = 'G81O') },
  // validateChannels: the block and its channels
  { name: 'channels that are text', rule: 'schema', patch: (f) => void (lathe(f).channels = 'two paths') },
  { name: 'the layout "none"', rule: 'schema', patch: (f) => void (ch(lathe(f)).layout = 'none') },
  { name: 'no channel list', rule: 'schema', patch: (f) => void delete ch(lathe(f)).list },
  { name: 'one channel', rule: 'schema', patch: (f) => void (ch(lathe(f)).list as unknown[]).pop() },
  { name: 'thirty-three channels', rule: 'schema', patch: (f) => void (ch(lathe(f)).list = many(33, (i) => ({ id: `c${i}`, name: `C ${i}` }))) },
  { name: 'a channel that is text', rule: 'schema', patch: (f) => void ((ch(lathe(f)).list as unknown[])[1] = '2') },
  { name: 'a channel id with a capital', rule: 'schema', patch: (f) => void (((ch(lathe(f)).list as Json[])[1]).id = 'P2') },
  { name: 'a channel id used twice', rule: 'unique-by-member', patch: (f) => void (((ch(lathe(f)).list as Json[])[1]).id = '1') },
  { name: 'a blank channel name', rule: 'schema', patch: (f) => void (((ch(lathe(f)).list as Json[])[1]).name = '') },
  { name: 'a channel name of 33 characters', rule: 'schema', patch: (f) => void (((ch(lathe(f)).list as Json[])[1]).name = 'n'.repeat(33)) },
  { name: 'aliases that are text', rule: 'schema', patch: (f) => void (((ch(lathe(f)).list as Json[])[0]).aliases = 'P1') },
  { name: 'nine aliases', rule: 'schema', patch: (f) => void (((ch(lathe(f)).list as Json[])[0]).aliases = many(9, (i) => `a${i}`)) },
  { name: 'a blank alias', rule: 'schema', patch: (f) => void (((ch(lathe(f)).list as Json[])[0]).aliases = [' ']) },
  { name: "an alias that is another channel's id", rule: 'unique-by-member', patch: (f) => void (((ch(lathe(f)).list as Json[])[0]).aliases = ['2']) },
  { name: 'a channel file name in a single program', rule: 'schema', patch: (f) => void (((ch(okuma(f)).list as Json[])[0]).fileName = '{{stem}}.MIN') },
  { name: 'a blank channel file name', rule: 'schema', patch: (f) => void (((ch(lathe(f)).list as Json[])[0]).fileName = ' ') },
  { name: 'a channel file name with a stranger in braces', rule: 'schema', patch: (f) => void (((ch(lathe(f)).list as Json[])[0]).fileName = '{{name}}_1.NC') },
  { name: 'a channel file name with single braces', rule: 'schema', patch: (f) => void (((ch(lathe(f)).list as Json[])[0]).fileName = '{stem}_1.NC') },
  // validateChannels: the layout's patterns
  { name: 'a single program without a section start', rule: 'schema', patch: (f) => void delete ch(okuma(f)).sectionStart },
  { name: 'a single program with a file name pattern', rule: 'schema', patch: (f) => void (ch(okuma(f)).fileName = '^(?<stem>.+)$') },
  { name: 'a single program with a marker', rule: 'schema', patch: (f) => void (ch(okuma(f)).marker = '(?<channel>A)') },
  { name: 'one program per channel with a section start', rule: 'schema', patch: (f) => void (ch(lathe(f)).sectionStart = 'G13') },
  { name: 'one program per channel with a section separator', rule: 'schema', patch: (f) => void (ch(lathe(f)).sectionSeparator = '/') },
  { name: 'a section start that does not compile', rule: 'pattern-compiles', patch: (f) => void (ch(okuma(f)).sectionStart = '(G13') },
  { name: 'a section end outside the pattern language', rule: 'pattern-subset', patch: (f) => void (ch(okuma(f)).sectionEnd = '\\p{L}') },
  { name: 'a section end that can take very long', rule: 'pattern-shape', patch: (f) => void (ch(okuma(f)).sectionEnd = '(a+)+$') },
  { name: 'a section start of 1001 characters', rule: 'schema', patch: (f) => void (ch(okuma(f)).sectionStart = `G${'1'.repeat(1000)}`) },
  { name: 'a section separator of two characters', rule: 'schema', patch: (f) => void (ch(okuma(f)).sectionSeparator = '//') },
  { name: 'a section separator that is a letter', rule: 'schema', patch: (f) => void (ch(okuma(f)).sectionSeparator = 'x') },
  { name: 'a file name pattern without the stem', rule: 'schema', patch: (f) => void (ch(lathe(f)).fileName = '^.+_(?<channel>\\d)$') },
  { name: 'a file name template without the channel', rule: 'schema', patch: (f) => void (ch(lathe(f)).fileNameFor = '{{stem}}.NC') },
  { name: 'a file name template with a stranger', rule: 'schema', patch: (f) => void (ch(lathe(f)).fileNameFor = '{{stem}}_{{path}}_{{channel}}') },
  { name: 'a file name template with single braces', rule: 'schema', patch: (f) => void (ch(lathe(f)).fileNameFor = '{stem}_{{channel}}') },
  { name: 'a marker without the channel', rule: 'schema', patch: (f) => void (ch(lathe(f)).marker = '^\\(PATH \\d\\)') },
  { name: 'stops and ends "yes"', rule: 'schema', patch: (f) => void (ch(lathe(f)).stopsAndEndsWait = 'yes') },
  // validateChannels: the wait rules
  { name: 'wait rules that are an object', rule: 'schema', patch: (f) => void (ch(lathe(f)).syncMarks = {}) },
  { name: 'thirty-three wait rules', rule: 'schema', patch: (f) => void (ch(lathe(f)).syncMarks = many(33, (i) => ({ ...rule(lathe(f), 1), id: `r${i}` }))) },
  { name: 'a wait rule that is text', rule: 'schema', patch: (f) => void ((ch(lathe(f)).syncMarks as unknown[])[1] = 'wait') },
  { name: 'a blank rule id', rule: 'schema', patch: (f) => void (rule(lathe(f)).id = ' ') },
  { name: 'the rule id of the stops and ends', rule: 'schema', patch: (f) => void (rule(lathe(f)).id = 'stops-and-ends') },
  { name: 'a rule id used twice', rule: 'unique-by-member', patch: (f) => void (rule(lathe(f), 1).id = 'wait') },
  { name: 'a rule without a label', rule: 'schema', patch: (f) => void delete rule(lathe(f)).label },
  { name: 'a rule that checks "sometimes"', rule: 'schema', patch: (f) => void (rule(lathe(f)).semantics = 'sometimes') },
  { name: 'blocking "yes"', rule: 'schema', patch: (f) => void (rule(lathe(f)).blocking = 'yes') },
  { name: 'answers "yes"', rule: 'schema', patch: (f) => void (rule(sin(f), 1).answers = 'yes') },
  { name: 'samePartners 1', rule: 'schema', patch: (f) => void (rule(lathe(f)).samePartners = 1) },
  { name: 'an empty mark separator', rule: 'schema', patch: (f) => void (rule(sin(f), 1).markSeparator = '') },
  { name: 'mark numbers with min above max', rule: 'min-not-above-max', patch: (f) => void (rule(sin(f)).markValues = { min: 99, max: 0 }) },
  { name: 'mark numbers that are not whole', rule: 'schema', patch: (f) => void (rule(sin(f)).markValues = { min: 0.5, max: 99 }) },
  { name: 'codes with a common mark that are a number', rule: 'schema', patch: (f) => void (rule(okuma(f)).withCodes = 3) },
  { name: 'codes with a common mark that do not read', rule: 'wait-code-list', patch: (f) => void (rule(okuma(f)).withCodes = 'M3-') },
  { name: 'a rule without what it matches', rule: 'schema', patch: (f) => void delete rule(lathe(f)).match },
  { name: 'a match of a fourth kind', rule: 'schema', patch: (f) => void (rule(lathe(f)).match = { kind: 'word', codes: 'M100' }) },
  { name: 'wait codes that are a list', rule: 'schema', patch: (f) => void (rule(lathe(f)).match = { kind: 'codes', codes: ['M100'] }) },
  { name: 'wait codes of a letter the profile does not wait with', rule: 'wait-code-list', patch: (f) => void (rule(lathe(f)).match = { kind: 'codes', codes: 'Q100-Q199' }) },
  { name: 'a prefix that starts with a digit', rule: 'schema', patch: (f) => void (rule(lathe(f), 1).match = { kind: 'prefix', prefix: '2M' }) },
  { name: 'a prefix with no digits', rule: 'schema', patch: (f) => void (rule(lathe(f), 1).match = { kind: 'prefix', prefix: 'M2', idDigits: { min: 0, max: 2 } }) },
  { name: 'a prefix with more digits first', rule: 'min-not-above-max', patch: (f) => void (rule(lathe(f), 1).match = { kind: 'prefix', prefix: 'M2', idDigits: { min: 3, max: 2 } }) },
  { name: 'a pattern without the mark', rule: 'schema', patch: (f) => void (rule(sin(f)).match = { kind: 'regex', pattern: '\\bWAITM\\(' }) },
  { name: 'a rule without whom it waits for', rule: 'schema', patch: (f) => void delete rule(lathe(f)).partners },
  { name: 'partners of a fifth kind', rule: 'schema', patch: (f) => void (rule(lathe(f)).partners = { kind: 'some' }) },
  { name: 'fixed partners without a channel', rule: 'schema', patch: (f) => void (rule(lathe(f), 1).partners = { kind: 'fixed', channels: [] }) },
  { name: 'fixed partners naming a channel that does not exist', rule: 'channel-references', patch: (f) => void (rule(lathe(f), 1).partners = { kind: 'fixed', channels: ['3'] }) },
  { name: 'a partner word of two letters', rule: 'schema', patch: (f) => void ((rule(lathe(f)).partners as Json).address = 'PP') },
  { name: 'a partner word read as a list', rule: 'schema', patch: (f) => void ((rule(lathe(f)).partners as Json).decode = 'split') },
  { name: 'without the word: "some"', rule: 'schema', patch: (f) => void ((rule(lathe(f)).partners as Json).whenAbsent = { kind: 'some' }) },
  { name: 'without the word: fixed to no channel', rule: 'schema', patch: (f) => void ((rule(lathe(f)).partners as Json).whenAbsent = { kind: 'fixed' }) },
  { name: 'a partner pattern without the channels', rule: 'schema', patch: (f) => void ((rule(sin(f)).partners as Json).pattern = 'WAITM') },
  { name: 'a partner separator that is a number', rule: 'schema', patch: (f) => void ((rule(sin(f)).partners as Json).separator = 1) },
  { name: 'a partner list read as letters', rule: 'schema', patch: (f) => void ((rule(sin(f)).partners as Json).decode = 'letters') },
  { name: 'a blank rule to share waits with', rule: 'schema', patch: (f) => void (rule(okuma(f)).sharesWaitsWith = '') },
  { name: 'sharing waits with a rule that does not exist', rule: 'channel-references', patch: (f) => void (rule(okuma(f)).sharesWaitsWith = 'm200') },
  { name: 'sharing waits with a rule that does not count', rule: 'channel-references', patch: (f) => void (rule(okuma(f), 1).semantics = 'rendezvous') },
  // motionBlock, limitsBlock
  { name: 'motion that is text', rule: 'schema', patch: (f) => void (lathe(f).motion = 'fast') },
  { name: 'a motion member gEdit does not know', rule: 'schema', patch: (f) => void (motion(f).jerk = 5) },
  { name: 'motion units in cm', rule: 'schema', patch: (f) => void (motion(f).units = 'cm') },
  { name: 'rapid rates that are a list', rule: 'schema', patch: (f) => void (motion(f).rapid = [20000]) },
  { name: 'a rapid rate of an axis the profile does not have', rule: 'motion-axis-of-profile', patch: (f) => void ((motion(f).rapid as Json).Q = 1000) },
  { name: 'a rapid rate of zero', rule: 'schema', patch: (f) => void ((motion(f).rapid as Json).X = 0) },
  { name: 'a rapid rate as text', rule: 'schema', patch: (f) => void ((motion(f).rapid as Json).X = '20000') },
  { name: 'a linear rapid rate above its bound', rule: 'bound-by-axis', patch: (f) => void ((motion(f).rapid as Json).X = 300000) },
  { name: 'a rapid kind "diagonal"', rule: 'schema', patch: (f) => void (motion(f).rapidKind = 'diagonal') },
  { name: 'a top feed of zero', rule: 'schema', patch: (f) => void (motion(f).maxFeed = 0) },
  { name: 'a top feed above 200,000 mm/min', rule: 'schema', patch: (f) => void (motion(f).maxFeed = 200001) },
  { name: 'a top feed above its bound in inch', rule: 'schema', patch: (f) => void Object.assign(motion(f), { units: 'inch', rapid: {}, maxFeed: 8000, peckRetract: 0.02, peckClearance: 0.04 }) },
  { name: 'a negative tool change time', rule: 'schema', patch: (f) => void (motion(f).toolChange = -1) },
  { name: 'a tool change of 601 s', rule: 'schema', patch: (f) => void (motion(f).toolChange = 601) },
  { name: 'a peck retract of zero', rule: 'schema', patch: (f) => void (motion(f).peckRetract = 0) },
  { name: 'a peck clearance above 100 mm', rule: 'schema', patch: (f) => void (motion(f).peckClearance = 101) },
  { name: 'a peck retract above its bound in inch', rule: 'schema', patch: (f) => void Object.assign(motion(f), { units: 'inch', rapid: {}, maxFeed: 400, peckRetract: 4 }) },
  { name: 'rates without units', rule: 'schema', patch: (f) => void delete motion(f).units },
  { name: 'limits that are a number', rule: 'schema', patch: (f) => void (lathe(f).limits = 5) },
  { name: 'a limits member gEdit does not know', rule: 'schema', patch: (f) => void (limits(f).torque = 5) },
  { name: 'spindle limits that are a number', rule: 'schema', patch: (f) => void (limits(f).spindle = 4000) },
  { name: 'a spindle in lower case', rule: 'schema', patch: (f) => void ((limits(f).spindle as Json).s2 = 3000) },
  { name: 'a top speed of zero', rule: 'schema', patch: (f) => void ((limits(f).spindle as Json).main = 0) },
  { name: 'a top speed above 200,000 rpm', rule: 'schema', patch: (f) => void ((limits(f).spindle as Json).main = 200001) },
  { name: 'travel that is a list', rule: 'schema', patch: (f) => void (limits(f).travel = []) },
  { name: 'travel of an axis the profile does not have', rule: 'motion-axis-of-profile', patch: (f) => void ((limits(f).travel as Json).Q = { min: 0, max: 1 }) },
  { name: 'travel that is a number', rule: 'schema', patch: (f) => void ((limits(f).travel as Json).X = 300) },
  { name: 'travel with a third member', rule: 'schema', patch: (f) => void ((limits(f).travel as Json).X = { min: 0, max: 1, home: 0 }) },
  { name: 'travel with a lowest position as text', rule: 'schema', patch: (f) => void ((limits(f).travel as Json).X = { min: '0', max: 1 }) },
  { name: 'travel with min above max', rule: 'min-not-above-max', patch: (f) => void ((limits(f).travel as Json).X = { min: 5, max: 1 }) },
  { name: 'travel beyond 100,000', rule: 'schema', patch: (f) => void ((limits(f).travel as Json).X = { min: -100001, max: 1 }) },
  { name: 'linear travel beyond its bound in inch', rule: 'bound-by-axis', patch: (f) => void Object.assign(limits(f), { units: 'inch', travel: { X: { min: 0, max: 4000 } } }) },
  { name: 'travel without units', rule: 'schema', patch: (f) => void delete limits(f).units },
];

// ---------------------------------------------------------------------------
// The rows
// ---------------------------------------------------------------------------

describe('schemas/machines.schema.json (P4.39b)', () => {
  it('is a draft 2020-12 schema with the id exported files point at', () => {
    expect(machinesSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(machinesSchema.$id).toBe('https://raw.githubusercontent.com/CNC-Master-xyz/gEdit/main/schemas/machines.schema.json');
  });

  it('compiles with the test validator, every keyword in the allowed list (rule 3)', () => {
    expect(typeof validate).toBe('function');
    const used = new Set(subschemas(ROOT).flatMap((s) => Object.keys(s)));
    expect([...used].filter((keyword) => !ALLOWED_KEYWORDS.has(keyword))).toEqual([]);
    expect(subschemas(ROOT).filter((s) => 'x-gedit-stub' in s)).toEqual([]);
  });

  it('gives every member a title and a description, in words without plan ids (rule 3)', () => {
    const missing: string[] = [];
    const planIds: string[] = [];
    for (const [key, path] of schemaPaths(ROOT, ROOT)) {
      const found = schemasAt(ROOT, path.map((p) => (p === '*' ? 'any-key' : p)));
      if (!found.some((s) => typeof s.title === 'string' && typeof s.description === 'string')) missing.push(key);
    }
    for (const s of subschemas(ROOT)) {
      for (const text of [s.title, s.description]) {
        if (typeof text === 'string' && /\b(?:P4|AD-\d|WP\d|§|T\d{3}\b|Q4h)/.test(text)) planIds.push(text);
      }
    }
    expect(missing).toEqual([]);
    expect(planIds).toEqual([]);
  });

  it('accepts the full file, and the code accepts it too', () => {
    expect(codeProblems(FULL)).toEqual([]);
    expect(schemaErrors(FULL)).toEqual([]);
  });

  it('agrees with the code on every machines file of tests/fixtures/machines/files/ (rule 2)', () => {
    expect(FIXTURES.length).toBeGreaterThan(5);
    for (const { name, value } of FIXTURES) {
      const problems = codeProblems(value);
      const accepted = schemaAccepts(value);
      if (problems.length === 0) {
        expect(schemaErrors(value), `${name}: the code accepts it, so the schema must`).toEqual([]);
      } else {
        // Refused by the code: refused by the schema, or by a rule only the code can see.
        const onlyCode = name === 'channels-bad-pattern.json' || name === 'channels-unknown-channel.json';
        expect(accepted, `${name}: ${problems.map((p) => p.path).join(', ')}`).toBe(onlyCode);
      }
    }
  });

  it('agrees with the checks on each broken case, one or more per rule (rule 2)', () => {
    expect(codeProblems(FULL), 'the full file has to be accepted, or every case is refused for its sake').toEqual([]);
    const wrong: string[] = [];
    for (const c of CASES) {
      const file = clone(FULL);
      c.patch(file);
      const problems = codeProblems(file);
      const accepted = schemaAccepts(file);
      if (problems.length === 0) wrong.push(`${c.name}: the code accepts it`);
      if (accepted !== (c.rule !== 'schema')) {
        wrong.push(`${c.name}: the schema ${accepted ? 'accepts' : 'refuses'} it (${c.rule}) ${accepted ? '' : schemaErrors(file).slice(0, 3).join('; ')}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('names a broken case for every rule of VALIDATOR_ONLY, and a reason for each', () => {
    const shown = new Set(CASES.map((c) => c.rule));
    expect(Object.keys(VALIDATOR_ONLY).filter((id) => !shown.has(id))).toEqual([]);
    for (const reason of Object.values(VALIDATOR_ONLY)) expect(reason.length).toBeGreaterThan(20);
  });

  it('keeps unknown members at every level where the file reader keeps them (rule 1)', () => {
    const file = clone(FULL);
    file.workshop = 'hall 2';
    rec(file, 'lathe-full').tooling = { turret: 12 };
    lathe(file).spindleGearRange = 'low';
    (ni(file) as Json).note = 'from the manual';
    ((ni(file).classes as Json).dwell as Json).note = 'seconds';
    ch(lathe(file)).comment = 'two paths';
    ((ch(lathe(file)).list as Json[])[0]).colour = 'blue';
    rule(lathe(file)).comment = 'M100 to M199';
    (rule(lathe(file)).match as Json).note = 'x';
    (rule(lathe(file)).partners as Json).note = 'x';
    (sin(file).extraAxes as Json[])[0].note = 'the builder calls it the loader axis';
    expect(codeProblems(file)).toEqual([]);
    expect(schemaErrors(file)).toEqual([]);
  });

  it('accepts a wait rule that checks by count without a mark in its pattern, as the code does', () => {
    const file = clone(FULL);
    rule(sin(file)).semantics = 'count';
    rule(sin(file)).match = { kind: 'regex', pattern: '\\bWAITM\\b' };
    expect(codeProblems(file)).toEqual([]);
    expect(schemaErrors(file)).toEqual([]);
    // semantics written as null reads as a rendezvous, which needs the mark.
    rule(sin(file)).semantics = null;
    expect(codeProblems(file).length).toBeGreaterThan(0);
    expect(schemaAccepts(file)).toBe(false);
  });

  it('accepts members the kind of a rule does not read, as the code does', () => {
    const file = clone(FULL);
    // A "codes" rule does not read prefix, an "all" partner does not read address or decode.
    (rule(okuma(file)).match as Json).prefix = 5;
    (rule(okuma(file)).partners as Json).decode = 'nonsense';
    expect(codeProblems(file)).toEqual([]);
    expect(schemaErrors(file)).toEqual([]);
  });

  it('every channel preset and number input preset of every built-in profile validates under its $defs (rule 1)', () => {
    const channels = ajv.getSchema(`${machinesSchema.$id}#/$defs/channelParams`);
    const numbers = ajv.getSchema(`${machinesSchema.$id}#/$defs/numberInput`);
    expect(channels).toBeTypeOf('function');
    expect(numbers).toBeTypeOf('function');
    let count = 0;
    for (const profile of BUILTIN) {
      for (const preset of profile.machineParams?.channels?.presets ?? []) {
        count += 1;
        expect(channels?.(preset.value), `${profile.id} ${preset.id}: ${JSON.stringify(channels?.errors)}`).toBe(true);
      }
      for (const preset of profile.machineParams?.numberInput?.presets ?? []) {
        count += 1;
        expect(numbers?.(preset.value), `${profile.id} ${preset.id}: ${JSON.stringify(numbers?.errors)}`).toBe(true);
      }
    }
    expect(count).toBeGreaterThan(20);
  });

  it('describes every member of every machines fixture (rule 5a)', () => {
    /** Members the fixtures write on purpose to test that unknown members are kept. */
    const UNKNOWN_ON_PURPOSE = new Set(['workshop', 'machines.[].tooling', 'machines.[].spindleGearRange', 'machines.[].params.channels.futureOption']);
    const undescribed: string[] = [];
    // A file that is a list is no machines file at all (the reader refuses it whole), so it has no members to describe.
    const files = [...FIXTURES, { name: 'full.json', value: FULL as unknown }].filter((f) => !Array.isArray(f.value));
    for (const { name, value } of files) {
      for (const [key, path] of memberPaths(value)) {
        if ([...UNKNOWN_ON_PURPOSE].some((u) => key === u || key.startsWith(`${u}.`))) continue;
        if (schemasAt(ROOT, path).length === 0) undescribed.push(`${name}: ${key}`);
      }
    }
    expect(undescribed).toEqual([]);
  });

  it('describes the members no fixture writes, from the hand list (rule 5b)', () => {
    const HAND_LIST = [
      'machines.[].params.channels.syncMarks.[].withCodes',
      'machines.[].params.channels.syncMarks.[].sharesWaitsWith',
      'machines.[].params.channels.syncMarks.[].markSeparator',
      'machines.[].params.channels.syncMarks.[].markValues.min',
      'machines.[].params.channels.syncMarks.[].markValues.max',
      'machines.[].params.channels.syncMarks.[].answers',
      'machines.[].params.channels.syncMarks.[].samePartners',
      'machines.[].params.channels.syncMarks.[].blocking',
      'machines.[].params.channels.syncMarks.[].semantics',
      'machines.[].params.channels.syncMarks.[].match.idDigits.max',
      'machines.[].params.channels.syncMarks.[].partners.whenAbsent.channels.[]',
      'machines.[].params.channels.syncMarks.[].partners.separator',
      'machines.[].params.channels.list.[].fileName',
      'machines.[].params.channels.sectionSeparator',
      'machines.[].params.channels.fileNameFor',
      'machines.[].params.channels.marker',
      'machines.[].params.channels.stopsAndEndsWait',
      'machines.[].params.numberInput.classes.dwell.incrementInch',
      'machines.[].params.motion.peckClearance',
      'machines.[].params.motion.rapidKind',
      'machines.[].params.limits.travel.B.min',
      'machines.[].params.limits.spindle.SB',
      'machines.[].params.extraAxes.[].kind',
      'machines.[].params.builderCodes',
      'machines.[].notes',
      'defaults.okuma-osp',
      '$schema',
    ];
    expect(HAND_LIST.filter((key) => schemasAt(ROOT, key.split('.')).length === 0)).toEqual([]);
  });
});
