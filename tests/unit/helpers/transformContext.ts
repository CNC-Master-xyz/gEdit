// What the slow tests of the text transforms need to run one: a compiled built-in profile and the
// context a transform is given. Used by the `<transform>.slow.test.ts` files in src/lib/core/transforms.

import { noMachine } from '$lib/core/machines/effective';
import type { CodeDb } from '$lib/core/codes/types';
import fanucJson from '$lib/data/profiles/fanuc-gcode.json';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import type { TransformContext } from '$lib/core/transforms/types';

export const fanuc = compileProfile(fanucJson as unknown as Profile);

const NO_CODES: CodeDb = { dialect: 'test', version: 1, addresses: {}, codes: [] };

/** A built-in profile, validated and compiled the way the registry does. */
export function compiledBuiltin(id: string): CompiledProfile {
  const raw = BUILTIN_PROFILE_JSON.find((entry) => (entry as { id?: string }).id === id);
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(`a built-in profile does not validate: ${checked.errors.join('; ')}`);
  return compileProfile(checked.profile);
}

/** The context of a whole-document run with no machine chosen. */
export function context(cp: CompiledProfile, options: Record<string, unknown> = {}): TransformContext {
  return { cp, codes: NO_CODES, options, firstLine: 1, machine: noMachine(cp.profile) };
}
