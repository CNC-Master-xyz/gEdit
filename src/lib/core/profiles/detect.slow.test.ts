// The cost of profile detection on a 200,000-line file (a wall-clock budget).
// The scoring rules are in `detect.test.ts` (same folder).

import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { expectWithin, fastest } from '../../../../tests/unit/helpers/budget';
import { compileProfile } from './compile';
import { detectProfile } from './detect';
import { validateProfile } from './validate';
import type { CompiledProfile } from './types';

const FANUC = 'fanuc-gcode';
const KLARTEXT = 'heidenhain-klartext';

const BUILTINS: CompiledProfile[] = BUILTIN_PROFILE_JSON.map((raw) => {
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(`a built-in profile does not validate: ${checked.errors.join('; ')}`);
  return compileProfile(checked.profile);
});

describe('the content score', () => {
  it('does not read the rest of a large file', () => {
    // Detection is on the open path: it has to look at 400 lines, not at 200 000.
    const big = `%\nO1234\n${Array.from({ length: 200_000 }, (_, i) => `N${i} G1 X${i}.`).join('\n')}\n`;
    expect(detectProfile(BUILTINS, '/work/big.nc', big, KLARTEXT)).toBe(FANUC);
    // A few milliseconds in practice; the limit only catches a full split. One pause of
    // a loaded machine is 100 ms, so the fastest of three runs is what is held to it.
    expectWithin(
      fastest(3, () => detectProfile(BUILTINS, '/work/big.nc', big, KLARTEXT)),
      100,
      '400 lines of a 200 000-line file',
    );
  });
});
