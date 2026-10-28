// Helpers the P4h scenarios share (`p4-profiles-form`, `p4-profiles-leave`, `p4-profiles-colours`, `p4-profiles-editing`, and
// the two scenarios of `p4-machines-numbers`). This file registers no scenario: `loadScenarios()` imports it like any other file
// under `scenarios/` and finds nothing new in it.
//
// What is here, and why each part exists:
//
//   1. **Settings, on a tab.** `openSettings` starts `settings.open` (which settles only when the dialog closes, so the promise is
//      returned and `closeSettings` awaits it) and opens a tab by its button.
//   2. **The profile form is read through its test ids.** The form (`profile-form`, with `data-profile`, `data-readonly`,
//      `data-dirty`) is the same markup in the dialog of the command and inline on the Profiles page. The page's "New profile"
//      form uses the test id `profile-form` as well (with `data-kind`), so `formRoot` picks the one that has `data-profile`.
//      A field is `profile-form-field[data-path]`, a problem sits in its `data-problem`.
//   3. **The live preview is a small Monaco editor.** `previewLines` and `previewColour` read what it has drawn, the same way
//      `m3-common.lineTokens` reads the main editor. The colour of a word is the computed colour of the one span that holds it.
//   4. **The role colour editor.** `colourCell` finds a cell by role and theme. The attribute is `data-role`, written out: the
//      harness's `h.q` takes the key `role` for the ARIA attribute, which every cell also has (`role="cell"`).
//   5. **User profile files are written at run time** (`addProfile`): a folder of the run's HOME, the profiles reloaded through the
//      command a user has. Nothing is read from a fixture whose answer a scenario would then compare with itself.
//
// Expected texts are `ctx.t(...)` of the key, or numbers and colours written in the scenario; nothing is read back from what the
// app shows and called right.

import { setInput } from './m2-common.js'
import { context, hoverAt, plain, repoPath, revealLine, rgbOf, setTheme } from './m3-common.js'
import { newDoc, ready, setField } from './m4-common.js'
import { guard } from './m10-common.js'
import { closeProfilesPage, openProfilesPage, profileAction, profileRows, reloadProfiles, userDirs } from './exit2-common.js'

export { closeProfilesPage, context, guard, hoverAt, newDoc, openProfilesPage, plain, profileAction, profileRows, ready, reloadProfiles, revealLine, rgbOf, setField, setInput, setTheme, userDirs }

/** @typedef {import('../lib/api.js').Harness} Harness */

// ---------------------------------------------------------------- Settings

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
 * Opens a tab of the open settings dialog by its button and waits for its page.
 * @param {Harness} h
 * @param {string} tab
 */
export async function openTab(h, tab) {
  const button = h.q('settings-category', { category: tab })
  if (!button) throw new Error(`the settings dialog has no ${tab} tab`)
  h.click(button)
  if (!(await h.waitFor(() => h.q('settings-page', { category: tab }), { timeout: 8000 }))) throw new Error(`the ${tab} page did not open`)
  await h.idle()
}

/**
 * Closes the settings dialog with Cancel (nothing changed, so no question) and waits for it to be gone.
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
export const settingControl = (h, id) => /** @type {HTMLInputElement | HTMLSelectElement | null} */ (h.q('form-field', { field: id })?.querySelector('input, select') ?? null)

/** `settings.json` as the backend reads it, or an empty object while the file does not exist. @param {Harness} h @returns {Promise<Record<string, any>>} */
export async function settingsFile(h) {
  return /** @type {Record<string, any>} */ ((await h.config.read('settings.json')) ?? {})
}

// ---------------------------------------------------------------- the question before something unsaved is lost

/**
 * The alert the app put up, with all its text, or null when none came within the wait.
 * @param {Harness} h
 * @param {number} [timeout]
 */
export async function alertText(h, timeout = 8000) {
  const info = await h.alert.wait({ timeout })
  return info === null || info === undefined ? null : (info.texts ?? []).join(' ').replace(/\s+/g, ' ')
}

/**
 * True when no alert is up after the page has settled: the answer "the app asked nothing".
 * @param {Harness} h
 */
export async function askedNothing(h) {
  await h.turns(8)
  return (await h.alert.visible()) === null
}

// ---------------------------------------------------------------- user profile files

/**
 * The text of a JSON file in a layout: `indent` spaces, `eol` between the lines, a break at the end.
 * @param {unknown} value
 * @param {{ indent?: number | string, eol?: string }} [o]
 */
export function jsonText(value, { indent = 2, eol = '\n' } = {}) {
  return `${JSON.stringify(value, null, indent).replace(/\n/g, eol)}${eol}`
}

/**
 * Writes a profile file into the user's profiles folder and reloads the profiles, as a user does after copying a file in.
 * @param {Harness} h
 * @param {string} file the file name, `shop-mill.json`
 * @param {Record<string, any>} profile the members, `id` among them
 * @param {{ indent?: number | string, eol?: string }} [layout]
 * @returns {Promise<string>} the text written
 */
export async function addProfile(h, file, profile, layout = {}) {
  const text = jsonText(profile, layout)
  await h.disk.write(`${userDirs(h).profilesDir}/${file}`, text)
  await reloadProfiles(h)
  if (!(await h.waitFor(() => context(h).profiles.get(String(profile.id)) !== undefined, { timeout: 10000 }))) throw new Error(`the profile ${profile.id} did not load from ${file}`)
  return text
}

/** The text of a file in the user's profiles folder. @param {Harness} h @param {string} file */
export const profileFileText = (h, file) => h.disk.read(`${userDirs(h).profilesDir}/${file}`)

/**
 * The `$id` of one of the repository's schemas (`profile`, `machines`, `codes`), which is the address a new file's `$schema`
 * line has to point at. Needs the scenario option `files: REPO_FILE`.
 * @param {Harness} h
 * @param {'profile' | 'machines' | 'codes'} name
 * @returns {Promise<string>}
 */
export async function schemaId(h, name) {
  const repo = await repoPath(h)
  return JSON.parse(await h.disk.read(`${repo}/schemas/${name}.schema.json`)).$id
}

// ---------------------------------------------------------------- the profile form

/** The form's own root (the page's "New profile" form has the same test id and no `data-profile`). @param {Harness} h */
export const formRoot = (h) => h.qa('profile-form').find((element) => element.hasAttribute('data-profile')) ?? null

/** A field of the form by its JSON path. @param {Harness} h @param {string} path */
export const formField = (h, path) => /** @type {HTMLElement | null} */ (formRoot(h)?.querySelector(`[data-testid="profile-form-field"][data-path="${CSS.escape(path)}"]`) ?? null)

/** The control of a field (its colour editor excluded). @param {HTMLElement | null} field */
export const fieldControl = (field) => /** @type {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null} */ (field?.querySelector('input:not([type="color"]), textarea, select') ?? null)

/**
 * Waits until the form has read its file and drawn its sections.
 * @param {Harness} h
 */
export async function waitForForm(h) {
  const shown = await h.waitFor(() => formRoot(h)?.querySelector('[data-testid="profile-form-section"]'), { timeout: 20000 })
  if (!shown) throw new Error(`the profile form did not open; it says: ${(formRoot(h)?.textContent ?? '(no form)').replace(/\s+/g, ' ').slice(0, 200)}`)
  await h.idle()
}

/**
 * Types into a field of the form (a choice is picked by its value).
 * @param {Harness} h
 * @param {string} path
 * @param {string} text
 */
export function typeInForm(h, path, text) {
  const control = fieldControl(formField(h, path))
  if (!control) throw new Error(`the form has no field ${path}; it has ${[...(formRoot(h)?.querySelectorAll('[data-testid="profile-form-field"]') ?? [])].map((e) => /** @type {HTMLElement} */ (e).dataset.path).join(', ')}`)
  if (control instanceof HTMLSelectElement) h.select(control, text)
  else setInput(control, text)
}

/** The value a field shows. @param {Harness} h @param {string} path */
export const formValue = (h, path) => fieldControl(formField(h, path))?.value ?? null

/** The problem the form shows at a field (empty when none). @param {Harness} h @param {string} path */
export const formProblem = (h, path) => formField(h, path)?.dataset.problem ?? ''

/** Whether the form holds changes that are not saved. @param {Harness} h */
export const formDirty = (h) => formRoot(h)?.dataset.dirty === 'true'

/** The form's Save button (inline or in the dialog's footer). @param {Harness} h */
export const formSave = (h) => /** @type {HTMLButtonElement | null} */ (h.q('profile-form-save'))

/** The "Use the parent's value" button of a field. @param {Harness} h @param {string} path */
export const formUseParent = (h, path) => /** @type {HTMLElement | null} */ (formField(h, path)?.querySelector('[data-testid="profile-form-use-parent"]') ?? null)

/** The "Ruler at the longest block" button of the rulers field, or null. @param {Harness} h */
export const formRulerButton = (h) => /** @type {HTMLElement | null} */ (formField(h, 'editing.rulers')?.querySelector('[data-testid="profile-form-ruler-longest"]') ?? null)

/** The file name the form's head shows. @param {Harness} h */
export const formFileName = (h) => (formRoot(h)?.querySelector('.id')?.textContent ?? '').trim()

// ---------------------------------------------------------------- the live preview

/** The preview editor's box. @param {Harness} h */
export const previewHost = (h) => h.q('profile-preview')

/** The lines the preview editor has drawn. @param {Harness} h */
export const previewLines = (h) => [...(previewHost(h)?.querySelectorAll('.view-line') ?? [])].map((element) => plain(element.textContent))

/**
 * The colour a word is drawn in, in the preview: the computed colour of the one span that holds `text`.
 * @param {Harness} h
 * @param {string} text
 * @returns {string | null} `rgb(...)`, or null when no single span holds it
 */
export function previewColour(h, text) {
  for (const line of previewHost(h)?.querySelectorAll('.view-line') ?? []) {
    const spans = [...line.querySelectorAll('span > span')].filter((span) => plain(span.textContent).includes(text))
    if (spans.length === 1) return getComputedStyle(spans[0]).color
  }
  return null
}

// ---------------------------------------------------------------- the open editor's colours

/**
 * The colour a word is drawn in on one line of the open editor, read synchronously (the line has to be on screen: call
 * `revealLine` first). Null when the line is not drawn or no single span holds the word.
 * @param {Harness} h
 * @param {string} id
 * @param {number} line
 * @param {string} text
 * @returns {string | null} `rgb(...)`
 */
export function paintedColour(h, id, line, text) {
  const want = plain(context(h).editor.getLines(id, line, line)[0] ?? '')
  for (const element of h.q('editor-host')?.querySelectorAll('.view-lines .view-line') ?? []) {
    if (plain(element.textContent) !== want) continue
    const spans = [...element.querySelectorAll('span > span')].filter((span) => plain(span.textContent).includes(text))
    if (spans.length === 1) return getComputedStyle(spans[0]).color
  }
  return null
}

// ---------------------------------------------------------------- the role colour editor

/**
 * One cell of the role colour editor: a role in a theme.
 * @param {ParentNode} scope the page, or the profile form
 * @param {string} role
 * @param {'dark' | 'light'} mode
 * @returns {HTMLElement | null}
 */
export function colourCell(scope, role, mode) {
  return /** @type {HTMLElement | null} */ (scope.querySelector(`[data-testid="role-color-row"][data-role="${role}"][data-mode="${mode}"]`))
}

/** The text control of a cell. @param {HTMLElement | null} cell */
export const hexInput = (cell) => /** @type {HTMLInputElement | null} */ (cell?.querySelector('input.hex') ?? null)

/** The colour picker of a cell. @param {HTMLElement | null} cell */
export const pickerInput = (cell) => /** @type {HTMLInputElement | null} */ (cell?.querySelector('input.picker') ?? null)

/** The Reset button of a cell. @param {HTMLElement | null} cell */
export const resetButton = (cell) => /** @type {HTMLButtonElement | null} */ (cell?.querySelector('[data-testid="role-color-reset"]') ?? null)

/**
 * Types a colour into a cell the way a user does, and lets the page settle.
 * @param {Harness} h
 * @param {HTMLElement | null} cell
 * @param {string} text
 */
export async function typeColour(h, cell, text) {
  if (!cell) throw new Error('typeColour: no cell')
  setInput(hexInput(cell), text)
  await h.frame()
}

/** The words under a cell whose colour cannot be saved (empty when none). @param {HTMLElement | null} cell */
export const cellProblem = (cell) => (cell?.querySelector('.problem')?.textContent ?? '').replace(/\s+/g, ' ').trim()

// ---------------------------------------------------------------- the machine form

/**
 * The fields of a machine form's text, by their `data-field`.
 * @param {Harness} h
 * @param {string} field
 * @returns {HTMLElement | null}
 */
export const machineFormField = (h, field) => h.q('form-field', { field })

/** The control of a field of the machine form. @param {Harness} h @param {string} field */
export const machineFormControl = (h, field) => /** @type {HTMLInputElement | HTMLSelectElement | null} */ (machineFormField(h, field)?.querySelector('input, select') ?? null)

// ---------------------------------------------------------------- programs

/**
 * A small fanuc-gcode program with one feed word on line 4 (`F250.`), for the checks of colours.
 * @param {Harness} h
 * @param {string} [profileId]
 * @returns {Promise<string>} the document id
 */
export async function feedProgram(h, profileId = 'fanuc-gcode') {
  return newDoc(h, '(SYNTHETIC COLOUR TEST, NOT FOR A MACHINE)\nN10 G90 G54 G0 X0. Y0.\nN20 T1 M6\nN30 G1 X10. F250.\nN40 M30\n', profileId)
}

/** The line and the word of `feedProgram` whose colour the scenarios read. */
export const FEED_LINE = 4
export const FEED_WORD = 'F250.'
