// Helpers the P4g scenarios (`p4g-keys`, `p4g-packages`, `p4g-config`, `p4g-config-import`, `p4g-settings`, `p4g-language`)
// share. This file registers no scenario: `loadScenarios()` imports it like any other file under `scenarios/` and finds
// nothing new in it.
//
// What is here, and why each part exists:
//
//   1. **Seeding the configuration folder.** The `files` option of `scenario()` writes into the run's HOME before the app
//      starts, which is the only way to give the app a `keybindings.json`, a package folder or a profile at startup (the
//      keys are read once at start, `bootstrap.ts`). `CONFIG` is the config folder below the run folder on macOS and `seed`
//      turns `{ 'packages/shop-a/package.json': '...' }` into the option's keys.
//   2. **Settings, on a tab.** `openSettings` starts `settings.open` (which settles only when the dialog closes, so the
//      promise is returned and `closeSettings` awaits it) and opens a tab by its button. The three pages P4g added have
//      their own test ids (`settings-keyboard`, `settings-packages`, `settings-configuration`); the five settings pages
//      carry `settings-page[data-category]`.
//   3. **Zip files made at run time.** The Configuration scenarios need archives the app did not write (a new script, a
//      changed setting, a name with `..`), and the page runs no Node. `zipOf` builds a stored (uncompressed) archive the way
//      the `zip` crate lays one out: a local header and the data per entry, the central directory, the end record, the Unix
//      mode of a plain file in the external attributes. `writeZip` puts it on disk through `h.disk.write` (base64).
//      `zipNames` goes the other way for an archive the app wrote: it reads the central directory off the bytes and answers
//      the entry names (the content of a deflated entry is not read).
//   4. **The import and export through the real dialogs.** Both go through the stubbed file dialogs: `exportTo` queues the
//      save answer and presses the button, `pickImport` queues the open answer and waits for the preview. The preview is read
//      through its test ids (`previewState`).
//
// Expected texts are `ctx.t(...)` of the keys, never read from what the app shows.

import { configPaths, setInput } from './m2-common.js'
import { context, message, ready, ribbonTab } from './m4-common.js'
import { read } from './m5-common.js'

export { configPaths, context, message, read, ready, ribbonTab, setInput }

/** @typedef {import('../lib/api.js').Harness} Harness */

/** The configuration folder below the run folder, as the `files` option spells it (macOS). */
export const CONFIG = 'home/Library/Application Support/com.pburg.gedit'

/**
 * The `files` option for the given files of the configuration folder.
 * @param {Record<string, string>} entries path below the config folder -> text
 * @returns {Record<string, string>}
 */
export function seed(entries) {
  return Object.fromEntries(Object.entries(entries).map(([rel, text]) => [`${CONFIG}/${rel}`, text]))
}

/** @param {unknown} value JSON text of a file the way the app writes one (two-space indent, final newline). */
export const json = (value) => `${JSON.stringify(value, null, 2)}\n`

/** A script with no header: it runs in panel mode and applies to every dialect. @param {string} name */
export const scriptText = (name) => `# ${name}\nimport sys\nprint("${name}")\n`

/** A profile that starts from the Fanuc lathe. @param {string} id @param {Record<string, unknown>} [more] */
export const profileText = (id, more = {}) => json({ id, name: `${id} profile`, shortName: id.toUpperCase().slice(0, 8), extends: 'fanuc-lathe', ...more })

/** A code file that adds one meaning of its own. @param {string} dialect */
export const codesText = (dialect) => json({ dialect, version: 1, extends: 'fanuc-lathe', codes: [{ code: 'M13', label: 'Chip conveyor on', description: 'Starts the chip conveyor.' }] })

// ---------------------------------------------------------------- Settings

/** The test id of each tab's page; the five settings pages share `settings-page`. */
const PAGE_IDS = { keyboard: 'settings-keyboard', packages: 'settings-packages', configuration: 'settings-configuration', machines: 'settings-machines', profiles: 'settings-profiles' }

/** The settings dialog, whichever tab is open. @param {Harness} h */
export const settingsDialog = (h) => h.q('modal', { modal: 'settings' })

/**
 * Opens the settings dialog (on `tab` when given) and waits for the page.
 * @param {Harness} h
 * @param {string} [tab]
 * @returns {Promise<{ closed: Promise<unknown> }>}
 */
export async function openSettings(h, tab) {
  const closed = context(h).commands.run('settings.open')
  if (!(await h.waitFor(() => settingsDialog(h), { timeout: 10000 }))) throw new Error('the settings dialog did not open')
  await h.idle()
  if (tab !== undefined) await openTab(h, tab)
  return { closed }
}

/**
 * Opens a tab of the open settings dialog by its button.
 * @param {Harness} h
 * @param {string} tab
 */
export async function openTab(h, tab) {
  const button = h.q('settings-category', { category: tab })
  if (!button) throw new Error(`the settings dialog has no ${tab} tab`)
  h.click(button)
  const testId = PAGE_IDS[/** @type {keyof typeof PAGE_IDS} */ (tab)]
  const shown = await h.waitFor(() => (testId === undefined ? h.q('settings-page', { category: tab }) : h.q(testId)), { timeout: 8000 })
  if (!shown) throw new Error(`the ${tab} page did not open`)
  await h.idle()
}

/**
 * Closes the settings dialog with Cancel (nothing typed, so no question) and waits for it to be gone.
 * @param {Harness} h
 * @param {{ closed: Promise<unknown> }} opened
 */
export async function closeSettings(h, opened) {
  h.click(h.q('modal-cancel'))
  await h.waitFor(() => !settingsDialog(h), { timeout: 8000 })
  await opened.closed
  await h.idle()
}

/** The control of a settings row. @param {Harness} h @param {string} id */
export const control = (h, id) => /** @type {HTMLInputElement | HTMLSelectElement | null} */ (h.q('form-field', { field: id })?.querySelector('input, select') ?? null)

/** The key a command has now on this (Mac) platform: the registry answers a string, or a pair when the platforms differ. @param {any} ctx @param {string} id */
export function keyNow(ctx, id) {
  const keys = ctx.commands.get(id)?.keys
  return typeof keys === 'string' || keys === undefined ? keys : keys.mac
}

/** The key a command was registered with, on this platform. @param {any} ctx @param {string} id */
export function keyDefault(ctx, id) {
  const keys = ctx.commands.defaultKeys(id)
  return typeof keys === 'string' || keys === undefined ? keys : keys.mac
}

/** The text of an element with the blanks made one. @param {Element | null | undefined} element */
export const textOf = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim()

// ---------------------------------------------------------------- zip files

/** @type {number[]} */
const CRC_TABLE = (() => {
  const table = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table.push(c >>> 0)
  }
  return table
})()

/** @param {Uint8Array} bytes */
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** The manifest every configuration zip starts with. */
export const MANIFEST = JSON.stringify({ format: 1, app: 'gEdit', version: '1.2.0', created: '2026-10-28T08:00:00Z', platform: 'macos' })

/**
 * A stored (uncompressed) zip archive. Every entry is a plain file with Unix mode 0644, dated 1980-01-01. The manifest is the first
 * entry unless `manifest` is `false` or another text.
 * @param {[string, string][]} entries name and text
 * @param {{ manifest?: string | false }} [o]
 * @returns {Uint8Array}
 */
export function zipOf(entries, o = {}) {
  const encoder = new TextEncoder()
  const all = o.manifest === false ? entries : /** @type {[string, string][]} */ ([['gedit-config.json', o.manifest ?? MANIFEST], ...entries])
  /** @type {Uint8Array[]} */
  const parts = []
  /** @type {Uint8Array[]} */
  const central = []
  let offset = 0
  for (const [name, text] of all) {
    const nameBytes = encoder.encode(name)
    const data = encoder.encode(text)
    const crc = crc32(data)
    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0, true)
    lv.setUint16(8, 0, true)
    lv.setUint16(10, 0, true)
    lv.setUint16(12, 0x21, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true)
    local.set(nameBytes, 30)
    const head = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(head.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 0x031e, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, 0, true)
    cv.setUint16(14, 0x21, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true)
    cv.setUint16(32, 0, true)
    cv.setUint16(34, 0, true)
    cv.setUint16(36, 0, true)
    cv.setUint32(38, (0o100644 << 16) >>> 0, true)
    cv.setUint32(42, offset, true)
    head.set(nameBytes, 46)
    parts.push(local, data)
    central.push(head)
    offset += local.length + data.length
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, all.length, true)
  ev.setUint16(10, all.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  const out = new Uint8Array(offset + centralSize + 22)
  let at = 0
  for (const part of [...parts, ...central, end]) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** @param {Uint8Array} bytes */
function base64Of(bytes) {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

/**
 * Builds a zip (see `zipOf`) and writes it to `path`.
 * @param {Harness} h
 * @param {string} path
 * @param {[string, string][]} entries
 * @param {{ manifest?: string | false }} [o]
 * @returns {Promise<string>} the path
 */
export async function writeZip(h, path, entries, o = {}) {
  await h.disk.write(path, { base64: base64Of(zipOf(entries, o)) })
  return path
}

/**
 * The entry names of a zip the app wrote, read off its central directory.
 * @param {Harness} h
 * @param {string} path
 * @returns {Promise<string[]>}
 */
export async function zipNames(h, path) {
  const bytes = Uint8Array.from((await h.disk.hex(path)).split(/\s+/).filter((token) => token !== '').map((token) => parseInt(token, 16)))
  const view = new DataView(bytes.buffer)
  let end = bytes.length - 22
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1
  if (end < 0) throw new Error(`${path}: no end-of-archive record`)
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const names = []
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error(`${path}: bad central directory`)
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    names.push(new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength)))
    at += 46 + nameLength + extraLength + commentLength
  }
  return names
}

// ---------------------------------------------------------------- export and import through the Configuration page

/**
 * Presses Export on the Configuration page; the save dialog answers `dest`. Resolves once the zip is on disk.
 * @param {Harness} h
 * @param {string} dest
 */
export async function exportTo(h, dest) {
  await h.dialogs.queue('save', dest)
  h.click(h.q('config-export'))
  const written = await h.waitFor(async () => ((await h.disk.stat(dest)) !== null ? true : null), { timeout: 15000 })
  if (!written) throw new Error(`the export did not write ${dest}`)
  await h.idle()
}

/**
 * Presses Import on the Configuration page; the open dialog answers `src`. Resolves once the preview is on the page.
 * @param {Harness} h
 * @param {string} src
 */
export async function pickImport(h, src) {
  await h.dialogs.queue('open', src)
  h.click(h.q('config-import'))
  const shown = await h.waitFor(() => h.q('import-preview'), { timeout: 15000 })
  if (!shown) throw new Error('the import preview did not appear')
  await h.idle()
}

/**
 * What the import preview on the page shows: its state, every file with what would happen to it, every group, and the buttons.
 * @param {Harness} h
 */
export function previewState(h) {
  const root = h.q('import-preview')
  return {
    state: root?.dataset.state ?? null,
    files: h.qa('import-file').map((e) => ({ path: e.dataset.path ?? '', action: e.dataset.action ?? '', text: textOf(e) })),
    groups: h.qa('import-group').map((e) => ({
      id: e.dataset.group ?? '',
      runnable: e.dataset.runnable === 'true',
      selectable: e.tagName === 'FIELDSET',
      ticked: /** @type {HTMLInputElement | null} */ (e.querySelector('input[type="checkbox"]'))?.checked === true,
      box: /** @type {HTMLInputElement | null} */ (e.querySelector('input[type="checkbox"]')),
    })),
    refusals: h.qa('import-refusals').flatMap((list) => [...list.querySelectorAll('li')].map((li) => li.dataset.reason ?? '')),
    confirm: /** @type {HTMLButtonElement | null} */ (h.q('import-confirm')),
    trust: /** @type {HTMLInputElement | null} */ (h.q('import-trust')),
    text: textOf(root),
  }
}

/**
 * Presses Cancel (or Close) of the inline preview.
 * @param {Harness} h
 */
export async function leavePreview(h) {
  const root = h.q('import-preview')
  const buttons = [...(root?.querySelectorAll('.buttons button') ?? [])]
  const cancel = /** @type {HTMLElement | undefined} */ (buttons.find((b) => b.getAttribute('data-testid') !== 'import-confirm'))
  if (!cancel) throw new Error('the preview has no Cancel button')
  h.click(cancel)
  await h.waitFor(() => !h.q('import-preview'), { timeout: 5000 })
}

/**
 * Presses Import in the preview and waits until the preview has gone (the import is done and the configuration loaded again).
 * @param {Harness} h
 */
export async function confirmImport(h) {
  const button = /** @type {HTMLButtonElement | null} */ (h.q('import-confirm'))
  if (!button || button.disabled) throw new Error('Import is not available')
  h.click(button)
  const gone = await h.waitFor(() => !h.q('import-preview'), { timeout: 20000 })
  if (!gone) throw new Error('the import did not finish')
  await h.idle()
}

/**
 * Ticks or unticks a checkbox the way a click does.
 * @param {Harness} h
 * @param {HTMLInputElement | null} box
 * @param {boolean} on
 */
export async function tick(h, box, on) {
  if (!box) throw new Error('tick: no checkbox')
  if (box.checked !== on) h.click(box)
  await h.frame()
}
