// An inspector view of a built-in profile (with or without a machine) and the modal states the inspector tests
// write by hand: shared by `inspect.test.ts` and `inspect.slow.test.ts` in src/lib/core/codes.

import { loadCodeDb } from '$lib/core/codes/load';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import type { InspectView } from '$lib/core/codes/inspect';
import { applyMachine, effectiveMachine } from '$lib/core/machines/effective';
import type { MachineConfig, MachineParams, NumberInput } from '$lib/core/machines/types';
import type { ModalState, ModalValue } from '$lib/core/nc/types';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { profileOf } from './profiles';

export const DBS = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, problem) => {
  throw new Error(`${dialect}: ${problem.path}: ${problem.message}`);
});

export function preset(profileId: string, id: string): NumberInput {
  const found = profileOf(profileId).machineParams?.numberInput?.presets.find((p) => p.id === id);
  if (!found) throw new Error(`${profileId}: no preset ${id}`);
  return found.value;
}

export function viewOf(profileId: string, o: { name?: string; params?: Partial<MachineParams> } | null = null): InspectView {
  const base = profileOf(profileId);
  const machine: MachineConfig | null = o ? { id: 'm', name: o.name ?? 'Machine', profile: profileId, params: o.params ?? {} } : null;
  const eff = effectiveMachine(base, machine, machine ? 'document' : 'none', {});
  const applied = applyMachine(base, eff);
  const checked = validateProfile(applied.profile, { applied: true });
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  return { profile: checked.profile, cp: compileProfile(checked.profile), db: loadCodeDb(DBS[applied.codes]), machine: eff };
}

export function mv(code: string, line = 0, from: ModalValue['from'] = 'profile'): ModalValue {
  return line === 0 ? { code, line, assumed: true, from } : { code, line, assumed: false };
}

export function state(o: Partial<Omit<ModalState, 'block'>> & { block?: Partial<ModalState['block']> } = {}): ModalState {
  const { block, ...rest } = o;
  return {
    groups: {},
    feedUnit: 'unknown',
    speedUnit: 'unknown',
    distance: 'unknown',
    units: { value: 'mm', line: 0, assumed: true, from: 'profile' },
    plane: 'unknown',
    diameter: null,
    tool: null,
    feed: null,
    speed: null,
    speedLimit: null,
    activeCycle: null,
    definedCycle: null,
    modalCall: null,
    frame: null,
    tcp: null,
    pitchFeedAmbiguous: null,
    ...rest,
    block: { cycle: null, pitchFeed: false, speedLimit: false, fNotFeed: false, toolChange: false, ...block },
  };
}
