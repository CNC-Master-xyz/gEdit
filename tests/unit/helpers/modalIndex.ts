// The built-in profiles as the modal tests read them, and a synthetic mill program with a `ModalIndex`
// over it: shared by `modal.test.ts` and `modal.slow.test.ts` in src/lib/core/nc.

import { loadCodeDb } from '$lib/core/codes/load';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import { applyMachine, effectiveMachine, noMachine } from '$lib/core/machines/effective';
import { compileProfile } from '$lib/core/profiles/compile';
import { resolveProfiles } from '$lib/core/profiles/resolve';
import { validateProfile } from '$lib/core/profiles/validate';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_SOURCES } from '$lib/data/profiles';
import { ModalIndex } from '$lib/core/nc/modal';
import type { CodeDb } from '$lib/core/codes/types';
import type { MachineConfig } from '$lib/core/machines/types';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';

export const PROFILES = new Map<string, Profile>(
  resolveProfiles(BUILTIN_PROFILE_SOURCES).resolved.map((entry) => {
    const checked = validateProfile(entry.profile);
    if (!checked.ok) throw new Error(checked.errors.join('; '));
    return [checked.profile.id, checked.profile];
  }),
);
const CODE_DBS = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, problem) => {
  throw new Error(`${dialect}: ${problem.path}: ${problem.message}`);
});

export interface Ctx {
  cp: CompiledProfile;
  db: CodeDb;
}

const contexts = new Map<string, Ctx>();

/** A built-in profile's effective view: no machine, or the partial machine given. */
export function ctx(profileId: string, params?: MachineConfig['params']): Ctx {
  const key = `${profileId}|${JSON.stringify(params ?? null)}`;
  const found = contexts.get(key);
  if (found) return found;
  const profile = PROFILES.get(profileId);
  if (!profile) throw new Error(`no profile ${profileId}`);
  const machine =
    params === undefined ? noMachine(profile) : effectiveMachine(profile, { id: 't', name: 't', profile: profileId, params }, 'document', {});
  const applied = applyMachine(profile, machine);
  const made = { cp: compileProfile(applied.profile), db: loadCodeDb(CODE_DBS[applied.codes]) };
  contexts.set(key, made);
  return made;
}

const MILL = [
  'N%N% G0 G90 G54 X0. Y0.',
  'N%N% T%T% M6',
  'N%N% G43 Z25. H%T% M8 (TOOL)',
  'N%N% S%S% M3',
  'N%N% G1 Z-1. F200.',
  'N%N% X50.123 Y-40.5 F1200.',
  'N%N% G98 G81 X10. Y10. Z-5. R2. F200.',
  'N%N% X20.',
  'N%N% G80',
  'N%N% G2 X30. Y0. R15.',
  'N%N% G91 G1 X1.',
  'N%N% G90 G68 X0 Y0 R%S%',
  'N%N% G69',
  '',
];

/** A synthetic program: `MILL` repeated, with block numbers, tools and speeds that change. */
export function program(count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const block = Math.floor(i / MILL.length);
    out.push(
      MILL[i % MILL.length]
        .replace('%N%', String((i % 9999) * 10))
        .replace(/%T%/g, String((block % 12) + 1))
        .replace(/%S%/g, String(1000 + (block % 7) * 100)),
    );
  }
  return out;
}

export function indexOver(lines: string[], every: number): ModalIndex {
  const c = ctx('fanuc-gcode');
  const index = new ModalIndex(c.cp, c.db, { every });
  index.reset(lines.length, (n) => lines[n - 1]);
  return index;
}
