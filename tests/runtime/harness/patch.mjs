// The part of sync.sh's patching that can be checked without building anything: what the
// harness changes in `tauri.conf.json`. (`lib.rs` and `Cargo.toml` are patched in sync.mjs.)

/**
 * The window config of a test build: hidden until the harness has sized it, and with a
 * **non-persistent WebKit data store** (`incognito`, T198). A test build used the same
 * website data as the owner's installed app (cookies, local storage, caches of the web view
 * under `~/Library/WebKit/<identifier>`), so a run could read what another one had stored and
 * the owner's data could be changed by a test. Nothing in the app stores anything there that a
 * scenario needs across a restart (the app's own files live in the config and data folders,
 * which `HOME` already isolates). `GEDIT_RH_PERSISTENT_WEBKIT=1` at sync time keeps the old store.
 * @param {string} src the text of the repository's `tauri.conf.json`
 * @param {{ persistentWebkit?: boolean }} [opts]
 * @returns {string}
 */
export function patchTauriConf(src, { persistentWebkit = process.env.GEDIT_RH_PERSISTENT_WEBKIT === '1' } = {}) {
  const cfg = JSON.parse(src)
  for (const w of cfg.app?.windows ?? []) {
    w.visible = false
    if (!persistentWebkit) w.incognito = true
  }
  return JSON.stringify(cfg, null, 2) + '\n'
}
