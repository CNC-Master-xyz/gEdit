// Helpers the P4f scenarios share (H4f: Find in Folder, files from the system, machine folders, channel files and
// channel scope, the check that follows jumps, the Siemens job list, the path-1 file). This file registers no scenario:
// `loadScenarios()` imports it like any other file under `scenarios/` and finds nothing new in it.
//
// Four things are worth knowing before reading a check that uses these:
//
//   1. **The programs and folders are built here, in the run folder, from text typed in the scenario** (`tests/fixtures/p4f/harness/`
//      only holds the flow programs, which are the goldens of `tests/fixtures/channels/flow/` written out as files). A folder tree
//      is made with `h.disk.write` (parent folders included), `h.disk.symlink` (a link the way a user or a CAM post makes one) and
//      `h.disk.copy` (many files in few calls). Every expected row, count and sentence is worked out from those texts or taken from
//      `ctx.t(...)`, never read from what the app shows.
//   2. **A folder is picked through the queued folder dialog**, which grants the folder the way the dialog plugin does: the folder
//      itself, not what is below it (the dialog is asked for `recursive: false`). A row of Find in Folder therefore opens its file
//      only through `folder_grant`, which is the point of the scenarios that click a row.
//   3. **A search runs after the form is answered**, so `startFolderSearch` returns when the walk has begun and `waitFolderReport`
//      waits for the report. The form remembers its last answers (`uiState.lastParams`), so every call states every field, `inComments`
//      before `wholeAddress` (the box is greyed out while Whole address is ticked).
//   4. **A scenario section never takes the rest down with it** (`guard`, M10).

import { context } from './m3-common.js'
import { message, newDoc, ready, ribbonTab } from './m4-common.js'
import { read } from './m5-common.js'
import { machineItem, pickEntry, pickerRows, waitForMachine } from './m6-common.js'
import { fillForm, guard, pick } from './m10-common.js'
import { report, rowsOf } from './m11-common.js'
import { LATHE_PARAMS, activate, activeId, channelState, goto, open, presetBlock, waitChannel, waitReport } from './m12-common.js'

export { LATHE_PARAMS, fillForm, activate, activeId, channelState, context, goto, guard, machineItem, message, newDoc, open, pick, pickEntry, pickerRows, presetBlock, read, ready, report, ribbonTab, rowsOf, waitChannel, waitForMachine, waitReport }

/** @typedef {import('../lib/api.js').Harness} Harness */

/** The same value a failed check prints: a JSON equality of two plain values. @param {unknown} a @param {unknown} b */
export const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** Whether the status bar shows an error. @param {Harness} h */
export const messageIsError = (h) => h.q('status-message')?.getAttribute('data-error') === '1'

/**
 * Waits until the status bar says exactly `text` (a status message clears after a few seconds, so the wait is short and the
 * caller reads it soon after the action).
 * @param {Harness} h
 * @param {string} text
 * @param {number} [timeout]
 */
export async function waitMessage(h, text, timeout = 8000) {
  await h.waitFor(() => message(h) === text, { timeout })
  return message(h)
}

/** The run folder's own subfolder `name`, as a path (not created). @param {Harness} h @param {string} name */
export const under = (h, name) => `${h.cfg.run}/${name}`

/**
 * Writes files below `base`. `files` maps a path relative to `base` to its text, or to `{ base64 }` for bytes. The calls go in
 * batches so a few hundred files do not wait for each other one by one.
 * @param {Harness} h
 * @param {string} base
 * @param {Record<string, string | { base64: string }>} files
 */
export async function writeAll(h, base, files) {
  const names = Object.keys(files)
  for (let i = 0; i < names.length; i += 40) {
    await Promise.all(names.slice(i, i + 40).map((rel) => h.disk.write(`${base}/${rel}`, files[rel])))
  }
}

/** Bytes as the base64 text `h.disk.write` takes. @param {number[]} bytes */
export const b64 = (bytes) => btoa(String.fromCharCode(...bytes))

/** The URL form of a path, as the system hands a file to a running app on macOS. @param {string} path */
export const fileUrl = (path) => `file://${path.split('/').map(encodeURIComponent).join('/')}`

/** Whether the page runs on macOS (the hand-over of files from the system differs per system). */
export const onMac = () => /Mac/i.test(navigator.platform) || /Macintosh/.test(navigator.userAgent)

// ---------------------------------------------------------------- Find in Folder

/** Every field of the Find in Folder form, so a call never depends on what the form remembered. */
export const FOLDER_FORM = {
  names: '*.nc; *.mpf',
  recursive: true,
  modifiedFrom: '',
  modifiedTo: '',
  query: '',
  inComments: true,
  wholeAddress: false,
  caseSensitive: false,
  regex: false,
  readAs: pick('Each', 0),
}

/**
 * Runs `search.findInFolder` up to the end of the form: the folder is picked through the queued dialog, the form is answered with
 * `values` (over `FOLDER_FORM`) and confirmed. The search has begun when this returns.
 * @param {Harness} h
 * @param {string} root
 * @param {Record<string, unknown>} values
 * @returns {Promise<unknown>} the report that was on the panel before (to wait for a new one)
 */
export async function startFolderSearch(h, root, values) {
  const ctx = context(h)
  const before = report(h)
  await h.dialogs.queue('folder', root)
  const running = ctx.commands.run('search.findInFolder')
  if (!(await h.waitFor(() => h.q('modal'), { timeout: 15000 }))) throw new Error(`search.findInFolder opened no form (status: ${message(h)})`)
  fillForm(h, { ...FOLDER_FORM, ...values })
  await h.frame()
  h.click(h.q('modal-ok'))
  await h.waitFor(() => !h.q('modal'), { timeout: 15000 })
  await running
  return before
}

/**
 * Waits for a report that is not `before`, and answers it.
 * @param {Harness} h
 * @param {unknown} before
 * @param {number} [timeout]
 * @returns {Promise<any>}
 */
export async function waitFolderReport(h, before, timeout = 120000) {
  await h.waitFor(() => {
    const now = report(h)
    return now !== null && now !== before
  }, { timeout })
  await h.idle()
  return report(h)
}

/** Starts a search and waits for its report. @param {Harness} h @param {string} root @param {Record<string, unknown>} values */
export async function findInFolder(h, root, values) {
  const before = await startFolderSearch(h, root, values)
  return waitFolderReport(h, before)
}

/** The files of a report's rows, as the folder-relative texts the rows show, sorted. @param {any} r */
export const filesOf = (r) => [...new Set(/** @type {any[]} */ (r?.rows ?? []).map((row) => String(row.file)))].sort()

/** `file:line` of every row, sorted. @param {any} r */
export const hitsOf = (r) => /** @type {any[]} */ (r?.rows ?? []).map((row) => `${row.file}:${row.line}`).sort()

// ---------------------------------------------------------------- machines and documents

/**
 * A machine made through the service. `channels` is the channel block (a preset's value or a golden's), `folders` the folder rules.
 * Fanuc lathe machines take the lathe's own number rules, the others the first number preset of their dialect.
 * @param {Harness} h
 * @param {{ name: string, profile?: string, channels?: object, folders?: { path: string, subfolders?: boolean }[] }} o
 * @returns {Promise<string>} the machine's id
 */
export async function addMachine(h, o) {
  const ctx = context(h)
  const profile = o.profile ?? 'fanuc-lathe'
  const decl = /** @type {any} */ (ctx.profiles.profile(profile)).machineParams
  const preset = decl?.numberInput?.presets?.[0]?.value
  const base = profile === 'fanuc-lathe' ? structuredClone(LATHE_PARAMS) : { ...(preset === undefined ? {} : { numberInput: structuredClone(preset) }), units: 'mm', diameter: 'on' }
  const record = {
    name: o.name,
    profile,
    notes: '',
    params: { ...base, ...(o.channels === undefined ? {} : { channels: structuredClone(o.channels) }) },
    ...(o.folders === undefined ? {} : { folders: o.folders }),
  }
  const id = await /** @type {any} */ (ctx.machines).add(record)
  await h.idle()
  return id
}

/** Makes machine `id` the default of `profile`. @param {Harness} h @param {string} profile @param {string} id */
export async function setDefault(h, profile, id) {
  await /** @type {any} */ (context(h).machines).setDefault(profile, id)
  await h.idle()
}

/**
 * Opens a file through the queued dialog and gives it the profile `profileId` when detection chose another one (a machine fits the
 * documents of its own dialect only).
 * @param {Harness} h
 * @param {string} path
 * @param {string} profileId
 * @returns {Promise<string>} the document id
 */
export async function openAs(h, path, profileId) {
  const id = await open(h, path)
  if (context(h).docs.get(id)?.profileId !== profileId) {
    h.app.setProfile(profileId)
    await h.idle()
  }
  return id
}

// ---------------------------------------------------------------- the check

/**
 * Presses Check Wait Codes on the Tools tab and waits for the new report.
 * @param {Harness} h
 * @returns {Promise<any>}
 */
export async function checkWaits(h) {
  const before = read(context(h).results.current)
  await ribbonTab(h, 'tools')
  h.click(h.q('cmd-button', { command: 'channels.checkSync' }))
  return waitReport(h, before)
}

/** The rows of a check report as `channel:line`. @param {any} r */
export const findingsOf = (r) => /** @type {any[]} */ (r?.rows ?? []).map((row) => `${row.channel}:${row.line}`)
