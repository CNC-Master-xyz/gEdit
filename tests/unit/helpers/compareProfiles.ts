// The built-in profiles as the compare tests read them, compiled once: shared by `compare.test.ts` and
// `compare.slow.test.ts` in src/lib/core/compare.

import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';

function profile(id: string): Profile {
  const result = validateProfile(BUILTIN_PROFILE_JSON.find((p) => (p as { id?: string }).id === id));
  if (!result.ok) throw new Error(`${id}: ${result.errors.join('; ')}`);
  return result.profile;
}

export const PROFILES = {
  fanuc: profile('fanuc-gcode'),
  lathe: profile('fanuc-lathe'),
  klartext: profile('heidenhain-klartext'),
  okuma: profile('okuma-osp'),
  sinumerik: profile('sinumerik'),
  sinumerikMill: profile('sinumerik-mill'),
};
export type ProfileKey = keyof typeof PROFILES;

const COMPILED = new Map<string, CompiledProfile>();
export function cpOf(key: ProfileKey): CompiledProfile {
  let cp = COMPILED.get(key);
  if (!cp) {
    cp = compileProfile(PROFILES[key]);
    COMPILED.set(key, cp);
  }
  return cp;
}
