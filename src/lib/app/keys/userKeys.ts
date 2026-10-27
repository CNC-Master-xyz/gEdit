// The user's key overrides in the running app (Phase 4 plan §6.9 rules 1–6, AD-55). Written by the
// P4g prelude; P4.34 fills it in (the pure rules are `core/keys/userKeys.ts`).
//
// `loadUserKeys()` runs once at startup, after the settings and the machines and before the
// contributions register (`bootstrap.ts`): it reads `keybindings.json` through `keybindingsLoad()`,
// parses it with `parseUserKeys`, and hands the bindings to the command registry
// (`commands.setKeyOverrides`), which answers every later `get`/`list` with the keys in force.
// The Keyboard page saves through the same service, which writes the file and updates the registry
// at once. A broken or newer file is a notice and no overrides; the defaults stay. Never throws.
//
// The stub loads nothing, so the defaults are in force until P4.34.

export async function loadUserKeys(): Promise<void> {
  // P4.34.
}
