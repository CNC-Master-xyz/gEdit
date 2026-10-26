// The expansion schemas of the drilling cycles, as the loader reads them (Phase 4 plan §6.3,
// AD-45; the P4b prelude). `core/codes/load.ts` calls `readExpandRole`, `readExpand` and
// `readDwell`; the rules here are the loader rules of §6.3, and a schema that breaks one is
// dropped whole and reported, so a broken schema is no schema (the expansion then refuses the
// cycle, which is the safe side). Nothing in the app reads a schema: the scripts do
// (`_nc_cycles.py`), from the loaded database the context carries.

import type {
  CodeEntry,
  CodeExpand,
  CodeExpandCases,
  CodeParam,
  DwellForm,
  ExpandLevel,
  ExpandRole,
  ExpandSchema,
  ExpandStep,
  ExpandValue,
} from './types';

/** The roles of `CodeParam.expandRole`, in the order of §6.3 (and of `_nc_cycles.EXPAND_ROLES`). */
export const EXPAND_ROLES = [
  'position',
  'r-plane',
  'surface',
  'clearance',
  'depth',
  'depth-relative',
  'return',
  'return-relative',
  'peck',
  'first-peck',
  'first-peck-relative',
  'peck-decrement',
  'peck-minimum',
  'chip-breaks',
  'chip-retract',
  'advance',
  'dwell',
  'dwell-top',
  'feed',
  'feed-out',
  'repeat',
  'variant',
  'spindle-direction',
  'orient-angle',
  'lift-off-first',
  'lift-off-second',
  'lift-off-axis',
  'default',
] as const satisfies readonly ExpandRole[];

/** The roles one entry may give to more than one parameter. */
export const REPEATABLE_ROLES: readonly ExpandRole[] = ['position', 'default'];

export const EXPAND_KINDS = ['drill', 'peck', 'bore'] as const;
export const EXPAND_LEVELS = ['start', 'r-plane', 'clearance', 'depth', 'return'] as const satisfies readonly ExpandLevel[];
export const EXPAND_STEPS = ['rapid', 'feed', 'pecks', 'dwell', 'spindle-stop', 'spindle-restore', 'orient', 'lift-off'] as const;
export const PECK_MODES = ['chip-break', 'full-retract', 'universal'] as const;
/** The form fields a step may take a value from (Q4-9): the run asks them, prefilled from `MachineMotion`. */
export const PECK_FIELDS = ['peckRetract', 'peckClearance'] as const;
/**
 * What `ExpandSchema.feedOutZero` may say a `feed-out` of 0 means (the owner, 2026-10-20;
 * Klartext 201 `Q208=0`: out at the plunging feed `Q206`): `'feed'`, the `feed` value.
 */
export const FEED_OUT_ZERO = ['feed'] as const;

type Report = (p: { path: string; message: string }) => void;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function has<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

/** `CodeParam.expandRole` of one raw parameter: a role of the list, or reported and dropped. */
export function readExpandRole(raw: unknown, path: string, report: Report): ExpandRole | undefined {
  if (raw === undefined) return undefined;
  if (has(EXPAND_ROLES, raw)) return raw;
  report({ path, message: `expandRole has to be one of ${EXPAND_ROLES.join(', ')}` });
  return undefined;
}

/** What a schema may refer to: the roles the entry's parameters carry, and the `'default'` addresses. */
interface Roles {
  roles: Set<ExpandRole>;
  defaults: Set<string>;
  addresses: Map<string, ExpandRole | undefined>;
}

function rolesOf(params: readonly CodeParam[]): Roles {
  const roles = new Set<ExpandRole>();
  const defaults = new Set<string>();
  const addresses = new Map<string, ExpandRole | undefined>();
  for (const p of params) {
    addresses.set(p.address, p.expandRole);
    if (p.expandRole === undefined) continue;
    roles.add(p.expandRole);
    if (p.expandRole === 'default') defaults.add(p.address);
  }
  return { roles, defaults, addresses };
}

/** The roles a level needs (§6.3, "Levels"); `null` when the level can be computed. */
function levelProblem(level: ExpandLevel, r: Roles, returnBy: unknown): string | null {
  switch (level) {
    case 'start':
      return null;
    case 'r-plane':
      return r.roles.has('r-plane') ? null : 'the level r-plane needs a parameter with the role r-plane';
    case 'clearance':
      return r.roles.has('surface') && r.roles.has('clearance') ? null : 'the level clearance needs the roles surface and clearance';
    case 'depth':
      return r.roles.has('depth') || (r.roles.has('depth-relative') && r.roles.has('surface'))
        ? null
        : 'the level depth needs the role depth, or depth-relative with surface';
    case 'return':
      if (returnBy === 'code') return null;
      return r.roles.has('return') || (r.roles.has('return-relative') && r.roles.has('surface'))
        ? null
        : 'the level return needs returnBy "code", the role return, or return-relative with surface';
  }
}

function valueProblem(raw: unknown, r: Roles): string | null {
  if (!isRecord(raw)) return 'a value is { "role": … } or { "form": … }';
  const keys = Object.keys(raw);
  if (keys.length !== 1) return 'a value is { "role": … } or { "form": … }';
  if ('form' in raw) return has(PECK_FIELDS, raw.form) ? null : `form has to be one of ${PECK_FIELDS.join(', ')}`;
  if ('role' in raw) {
    if (!has(EXPAND_ROLES, raw.role)) return `role has to be one of ${EXPAND_ROLES.join(', ')}`;
    return r.roles.has(raw.role) ? null : `no parameter of this code has the role ${raw.role}`;
  }
  return 'a value is { "role": … } or { "form": … }';
}

const STEP_MEMBERS: Record<(typeof EXPAND_STEPS)[number], readonly string[]> = {
  rapid: ['step', 'to'],
  feed: ['step', 'to', 'feed'],
  pecks: ['step', 'mode', 'retract', 'back', 'reentry', 'retractAt'],
  dwell: ['step', 'at'],
  'spindle-stop': ['step'],
  'spindle-restore': ['step'],
  orient: ['step'],
  'lift-off': ['step', 'back'],
};

function stepProblems(raw: unknown, r: Roles, returnBy: unknown): string[] {
  if (!isRecord(raw)) return ['a step is an object'];
  if (!has(EXPAND_STEPS, raw.step)) return [`step has to be one of ${EXPAND_STEPS.join(', ')}`];
  const out: string[] = [];
  const kind = raw.step;
  for (const key of Object.keys(raw)) if (!STEP_MEMBERS[kind].includes(key)) out.push(`a ${kind} step has no member ${key}`);
  const level = (member: string, required: boolean): void => {
    const value = raw[member];
    if (value === undefined) {
      if (required) out.push(`a ${kind} step needs ${member}`);
      return;
    }
    if (!has(EXPAND_LEVELS, value)) out.push(`${member} has to be one of ${EXPAND_LEVELS.join(', ')}`);
    else {
      const problem = levelProblem(value, r, returnBy);
      if (problem !== null) out.push(problem);
    }
  };
  const value = (member: string, required: boolean): void => {
    if (raw[member] === undefined) {
      if (required) out.push(`a ${raw.mode ?? kind} step needs ${member}`);
      return;
    }
    const problem = valueProblem(raw[member], r);
    if (problem !== null) out.push(`${member}: ${problem}`);
  };
  switch (kind) {
    case 'rapid':
      level('to', true);
      break;
    case 'feed':
      level('to', true);
      if (raw.feed !== undefined && raw.feed !== 'feed' && raw.feed !== 'feed-out') out.push('feed has to be feed or feed-out');
      if (raw.feed === 'feed-out' && !r.roles.has('feed-out')) out.push('feed-out needs a parameter with the role feed-out');
      break;
    case 'pecks': {
      if (!has(PECK_MODES, raw.mode)) {
        out.push(`mode has to be one of ${PECK_MODES.join(', ')}`);
        break;
      }
      if (!r.roles.has('peck') && !r.roles.has('first-peck') && !r.roles.has('first-peck-relative')) out.push('pecks need the role peck');
      const breaking = raw.mode === 'chip-break' || raw.mode === 'universal';
      const retracting = raw.mode === 'full-retract' || raw.mode === 'universal';
      value('retract', breaking);
      level('back', retracting);
      value('reentry', retracting);
      if (!breaking && raw.retract !== undefined) out.push('retract is the chip break of a chip-break or universal step');
      if (!retracting && (raw.back !== undefined || raw.reentry !== undefined)) out.push('back and reentry belong to a full-retract or universal step');
      if (raw.mode === 'universal' && !r.roles.has('chip-breaks')) out.push('a universal step needs the role chip-breaks');
      if (raw.retractAt !== undefined && raw.retractAt !== 'rapid' && raw.retractAt !== 'feed-out') out.push('retractAt has to be rapid or feed-out');
      if (raw.retractAt === 'feed-out' && !r.roles.has('feed-out')) out.push('retractAt feed-out needs the role feed-out');
      break;
    }
    case 'dwell':
      if (raw.at !== 'bottom' && raw.at !== 'top') out.push('at has to be bottom or top');
      else if (!r.roles.has(raw.at === 'bottom' ? 'dwell' : 'dwell-top')) out.push(`a dwell at the ${raw.at} needs the role ${raw.at === 'bottom' ? 'dwell' : 'dwell-top'}`);
      break;
    case 'orient':
      if (!r.roles.has('orient-angle')) out.push('orient needs the role orient-angle');
      break;
    case 'lift-off':
      if (!r.roles.has('lift-off-first') && !r.roles.has('lift-off-second') && !r.roles.has('lift-off-axis')) out.push('lift-off needs a lift-off role');
      if (raw.back !== undefined && typeof raw.back !== 'boolean') out.push('back has to be true or false');
      break;
    default:
      break;
  }
  return out;
}

const SCHEMA_MEMBERS = ['kind', 'steps', 'returnBy', 'relativeDepth', 'leaves', 'defaults', 'feedOutZero'];

function readSchema(raw: unknown, path: string, r: Roles, report: Report): ExpandSchema | null {
  if (!isRecord(raw)) {
    report({ path, message: 'a schema is an object' });
    return null;
  }
  const problems: { path: string; message: string }[] = [];
  const add = (at: string, message: string): void => {
    problems.push({ path: at, message });
  };
  for (const key of Object.keys(raw)) if (!SCHEMA_MEMBERS.includes(key)) add(`${path}.${key}`, `a schema has no member ${key}`);
  if (!has(EXPAND_KINDS, raw.kind)) add(`${path}.kind`, `kind has to be one of ${EXPAND_KINDS.join(', ')}`);
  if (raw.returnBy !== 'code' && raw.returnBy !== 'role') add(`${path}.returnBy`, 'returnBy has to be code or role');
  if (raw.returnBy === 'role' && !r.roles.has('return') && !(r.roles.has('return-relative') && r.roles.has('surface'))) {
    add(`${path}.returnBy`, 'returnBy role needs the role return, or return-relative with surface');
  }
  const relative = r.roles.has('depth-relative') || r.roles.has('first-peck-relative');
  if (raw.relativeDepth !== undefined && raw.relativeDepth !== 'signed' && raw.relativeDepth !== 'into-material') {
    add(`${path}.relativeDepth`, 'relativeDepth has to be signed or into-material');
  } else if (relative && raw.relativeDepth === undefined) {
    add(`${path}.relativeDepth`, 'a relative depth needs relativeDepth (signed or into-material)');
  }
  const leaves = raw.leaves;
  if (!isRecord(leaves) || !['before', 'cycle'].includes(String(leaves.motion)) || !['before', 'cycle'].includes(String(leaves.feed)) || Object.keys(leaves).length !== 2) {
    add(`${path}.leaves`, 'leaves is { "motion": "before" | "cycle", "feed": "before" | "cycle" }');
  }
  const defaults: Record<string, string | string[]> = {};
  if (raw.defaults !== undefined) {
    if (!isRecord(raw.defaults)) add(`${path}.defaults`, 'defaults is an object: address → value, or address → a list of values');
    else {
      for (const [address, value] of Object.entries(raw.defaults)) {
        if (!r.defaults.has(address)) add(`${path}.defaults.${address}`, `${address} is no parameter with the role default`);
        else if (typeof value === 'string' && value.trim() !== '') defaults[address] = value.trim();
        else if (Array.isArray(value)) {
          // A list: the values the manuals prove equivalent (the owner, 2026-10-20), each written as
          // text, none twice.
          const values = value.map((v) => (typeof v === 'string' ? v.trim() : ''));
          if (values.length === 0 || values.some((v) => v === '')) {
            add(`${path}.defaults.${address}`, 'a list of defaults holds at least one value, each written as text, such as ["0", "3"]');
          } else if (new Set(values).size !== values.length) {
            add(`${path}.defaults.${address}`, 'a list of defaults names each value once');
          } else defaults[address] = values;
        } else add(`${path}.defaults.${address}`, 'a default is a value written as text, such as "0", or a list of them');
      }
    }
  }
  for (const address of r.defaults) if (!(address in defaults)) add(`${path}.defaults`, `the role default of ${address} needs its value in defaults`);
  // A feed-out of 0 that means another feed (the owner, 2026-10-20): only a value of the list,
  // and only where the entry has both feeds; every other feed of 0 or less still refuses.
  if (raw.feedOutZero !== undefined) {
    if (!has(FEED_OUT_ZERO, raw.feedOutZero)) add(`${path}.feedOutZero`, `feedOutZero has to be one of ${FEED_OUT_ZERO.join(', ')}`);
    else if (!r.roles.has('feed-out') || !r.roles.has(raw.feedOutZero)) {
      add(`${path}.feedOutZero`, `feedOutZero needs parameters with the roles feed-out and ${raw.feedOutZero}`);
    }
  }
  const steps = raw.steps;
  let reachesDepth = false;
  if (!Array.isArray(steps) || steps.length === 0) add(`${path}.steps`, 'steps is a list of at least one step');
  else {
    steps.forEach((step, i) => {
      for (const message of stepProblems(step, r, raw.returnBy)) add(`${path}.steps[${i}]`, message);
      if (isRecord(step) && ((step.step === 'feed' && step.to === 'depth') || step.step === 'pecks')) reachesDepth = true;
    });
    if (!reachesDepth) add(`${path}.steps`, 'no step feeds to the depth');
  }
  if (problems.length > 0) {
    for (const p of problems) report(p);
    return null;
  }
  const out: ExpandSchema = {
    kind: raw.kind as ExpandSchema['kind'],
    steps: (steps as unknown[]).map((s) => ({ ...(s as Record<string, unknown>) }) as unknown as ExpandStep),
    returnBy: raw.returnBy as ExpandSchema['returnBy'],
    leaves: { motion: (leaves as Record<string, unknown>).motion, feed: (leaves as Record<string, unknown>).feed } as ExpandSchema['leaves'],
  };
  for (const step of out.steps) {
    for (const member of ['retract', 'reentry'] as const) {
      const v = (step as { retract?: ExpandValue; reentry?: ExpandValue })[member];
      if (v !== undefined) (step as Record<string, unknown>)[member] = { ...v };
    }
  }
  if (raw.relativeDepth !== undefined) out.relativeDepth = raw.relativeDepth as ExpandSchema['relativeDepth'];
  if (Object.keys(defaults).length > 0) out.defaults = defaults;
  if (raw.feedOutZero !== undefined) out.feedOutZero = raw.feedOutZero as ExpandSchema['feedOutZero'];
  return out;
}

/**
 * `CodeEntry.expand` of one raw entry, after its parameters and `sets` are read. `undefined`
 * when the entry has none, or when the schema breaks a rule (every problem is reported and
 * the schema is dropped whole). The entry's other members are never touched here.
 */
export function readExpand(raw: unknown, entry: CodeEntry, path: string, report: Report): CodeExpand | undefined {
  if (raw === undefined) return undefined;
  const params = entry.params ?? [];
  const r = rolesOf(params);
  const drop = (message: string, at = path): undefined => {
    report({ path: at, message });
    return undefined;
  };
  const cycle = entry.sets?.cycle;
  if (cycle !== 'start' && cycle !== 'define') return drop(`expand of ${entry.code} needs sets.cycle "start" or "define"`);
  if (entry.tapping === true || entry.pitchFeed === true || entry.pitchFeedAmbiguous === true) {
    return drop(`expand of ${entry.code}: a tapping or thread code is never expanded`);
  }
  for (const role of r.roles) {
    if (REPEATABLE_ROLES.includes(role)) continue;
    const holders = params.filter((p) => p.expandRole === role).map((p) => p.address);
    if (holders.length > 1) return drop(`the role ${role} is given to ${holders.join(' and ')}; one parameter only`, `${path}`);
  }
  if (!isRecord(raw)) return drop('expand is an object');
  if ('by' in raw || 'cases' in raw) {
    const by = raw.by;
    if (typeof by !== 'string' || r.addresses.get(by.toUpperCase()) !== 'variant') {
      return drop('by has to be the address of the parameter with the role variant', `${path}.by`);
    }
    if (Object.keys(raw).some((k) => k !== 'by' && k !== 'cases')) return drop('a schema with cases has only by and cases');
    if (!isRecord(raw.cases) || Object.keys(raw.cases).length === 0) return drop('cases is an object: value → schema', `${path}.cases`);
    const cases: Record<string, ExpandSchema> = {};
    let broken = false;
    for (const [value, schema] of Object.entries(raw.cases)) {
      const read = readSchema(schema, `${path}.cases.${value}`, r, report);
      if (read === null) broken = true;
      else cases[value] = read;
    }
    if (broken) return undefined;
    const out: CodeExpandCases = { by: by.toUpperCase(), cases };
    return out;
  }
  if (r.roles.has('variant')) return drop('the role variant needs a schema with by and cases');
  return readSchema(raw, path, r, report) ?? undefined;
}

/** `CodeEntry.dwell` of one raw entry, after its parameters are read; dropped whole on any problem. */
export function readDwell(raw: unknown, entry: CodeEntry, path: string, report: Report): DwellForm | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    report({ path, message: 'dwell is an object' });
    return undefined;
  }
  const addresses = new Set((entry.params ?? []).map((p) => p.address));
  const out: DwellForm = {};
  const problems: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'seconds' || key === 'increments' || key === 'revolutions') {
      const address = typeof value === 'string' ? value.trim().toUpperCase() : '';
      if (!addresses.has(address)) problems.push(`${key} has to be the address of a parameter of ${entry.code}`);
      else out[key] = address;
    } else if (key === 'lines') {
      const lines = Array.isArray(value) ? value : null;
      if (lines === null || lines.length === 0 || !lines.every((l) => typeof l === 'string' && l.trim() !== '') || !lines.some((l) => (l as string).includes('{s}'))) {
        problems.push('lines is a list of lines, one of them with {s} for the seconds');
      } else out.lines = [...(lines as string[])];
    } else problems.push(`dwell has no member ${key}`);
  }
  if (Object.keys(out).length === 0 && problems.length === 0) problems.push('dwell names at least one way to write a dwell');
  if (problems.length > 0) {
    for (const message of problems) report({ path, message });
    return undefined;
  }
  return out;
}

/** A schema of either form, by the value of its variant parameter (`null`: no schema for that value). */
export function schemaFor(expand: CodeExpand, variant: string | null): ExpandSchema | null {
  if (!('by' in expand)) return expand;
  if (variant === null) return null;
  // Own keys only: a variant text such as "constructor" must not reach `Object.prototype`.
  return Object.hasOwn(expand.cases, variant) ? expand.cases[variant] : null;
}
