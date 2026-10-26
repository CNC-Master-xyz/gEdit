// clippy.sh: clippy over the patched app that sync.sh builds, so harness.rs is linted as
// the crate module it becomes. Run it after sync.sh (T201).
// Usage: clippy.sh
//
// harness.rs is not part of `src-tauri`: sync.sh copies it into a patched copy of the app
// under $GEDIT_RH_DIR/app, so the `cargo clippy` of the `rust` job in ci.yml never sees it
// (and `rustfmt --check`, which the `checks` job runs, only formats it). Warnings are errors,
// as for the app itself. The copy sync.sh made has to be the harness.rs in this checkout,
// otherwise the answer would be about an older file; the script says so and stops (exit 2).
// Exit code 0: clean, 1: clippy found something, 2: nothing to check yet.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { RUNTIME_DIR, rhDir } from './core.mjs'

const rh = rhDir()
const tauriDir = path.join(rh, 'app', 'src-tauri')
const mine = path.join(RUNTIME_DIR, 'harness/harness.rs')
const synced = path.join(tauriDir, 'src/harness.rs')

if (!fs.existsSync(synced)) {
  console.error(`clippy: ${synced} does not exist; run tests/runtime/sync.sh first`)
  process.exit(2)
}
if (!fs.readFileSync(mine).equals(fs.readFileSync(synced))) {
  console.error('clippy: the harness.rs that sync.sh copied is not the one in this checkout; run tests/runtime/sync.sh again')
  process.exit(2)
}

// The features sync.sh builds with, and its target folder, so the dependencies it compiled are reused.
const run = spawnSync('cargo', ['clippy', '--all-targets', '--features', 'tauri/custom-protocol', '--', '-D', 'warnings'], {
  cwd: tauriDir,
  stdio: 'inherit',
  env: { ...process.env, CARGO_TARGET_DIR: path.join(rh, 'target') },
})
if (run.error) {
  console.error(`clippy: cargo could not be started: ${run.error.message}`)
  process.exit(2)
}
process.exit(run.status === 0 ? 0 : 1)
