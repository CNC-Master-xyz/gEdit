// Helpers and expectations of the P4d runtime scenarios (`p4-renumber`, `p4-renumber-others`, and the part B of
// `m6-lathe-renumber`). This file registers no scenario: `loadScenarios()` imports it like any other file under
// `scenarios/` and finds nothing new in it. `tests/unit/p4dHarness.test.ts` runs everything in it that does not
// need the app, and checks every table below against the real transform (the options, the references, the rows
// of the other documents), so a scenario cannot expect what the code does not do.
//
// Five things are worth knowing before reading a check that uses these:
//
//   1. **The goldens are read off disk, never retyped.** An option or a reference case is a folder of
//      `tests/fixtures/transforms/renumber/` (`transformCase` copies it into the run folder): the input, the
//      expected text and the options the golden was made with. The options become the *fields of the form*
//      (`formFieldsOf`), so the form's own controls are what is exercised, not `options` handed to the run.
//   2. **The form is reset before each run.** The transform service remembers the form's values per profile
//      (`uiState.lastParams`, key `transform:renumber:<profile>`), so a run that set "Fit the increment to the
//      maximum" would leave it on for the next one. `resetRenumberForm` writes an empty memory, which brings every
//      field back to the profile's own default; the cases that look at the memory itself read the form with
//      `peekForm` without running anything.
//   3. **A document the run left open can change the next run's report.** After a Renumber Blocks run the
//      references in the other open documents of the same dialect are listed (plan section 6.6 rule 11), and that
//      list replaces the report of the run. The goldens reuse program numbers, so every case closes its document
//      when it is done (`finishCase`), and the cases of `p4-renumber-others` give each phase its own program
//      numbers (`world(base)`).
//   4. **The expected texts are `ctx.t(...)` of a key and the parameters of a table here.** The parameters
//      (counts, the fitted step) are written out in `OPTION_CASES` / `REFERENCE_CASES` and held to what the
//      transform reports by the unit test; a row text without parameters is found by its key alone.
//   5. **The programs of the other-documents scenario are written out in `world(base)`**, one main program that
//      calls three subprograms in two other documents and one in a document of another dialect, with the text
//      after the renumber and after the update worked out here by the rules (block 1 to 8 become 10 to 80).

import { context, message, newDoc, runTransform, setField, transformCase } from './m4-common.js'
import { undoKey } from './p4e-common.js'

export { context, message, newDoc, runTransform, transformCase }

/** @typedef {import('../lib/api.js').Harness} Harness */
/** @typedef {{ key: string, params?: Record<string, string | number> }} Msg */

/** The two commands. */
export const RENUMBER = 'nc.renumber'
export const UPDATE_OTHERS = 'nc.updateOtherReferences'

/** The dialects the cases run on. */
export const FANUC = 'fanuc-gcode'
export const LATHE = 'fanuc-lathe'

// ---------------------------------------------------------------- the option cases (P4.18, plan section 6.6 rules 1-7)

/**
 * The option goldens run through the form. `warnings` are the transform's own, with their parameters; `summary`
 * is what the status bar says. A case with `refused` writes nothing and its summary is the whole answer.
 * There is no case for the golden `opt-fit-to-max-no-max`: owner decision A (2026-10-22) is that a blank Maximum field means the
 * dialect's own maximum (99999 on Fanuc; every built-in dialect has one), so the form cannot ask for "no maximum" and that refusal
 * cannot be reached through it.
 * `findings` lists the extra rows of the report that the skipped-line rows of the golden do not describe.
 * @type {{ id: string, profile: string, summary: Msg, warnings: Msg[], refused?: boolean, rows?: { line: number, key: string, params?: Record<string, string | number> }[], note: string }[]}
 */
export const OPTION_CASES = [
  {
    id: 'opt-fit-to-max',
    profile: FANUC,
    summary: { key: 'ncNumbering.renumber.summarySkipped', params: { count: 14, skipped: 3 } },
    warnings: [
      { key: 'ncNumbering.renumber.fitted', params: { step: 76, count: 14, start: 10, max: 999 } },
      { key: 'ncNumbering.renumber.referencesRewritten', params: { count: 1 } },
    ],
    note: '14 blocks from 10 up to 999: the largest whole step is 76 and the last block is N998; the IF ... GOTO follows its block',
  },
  {
    id: 'opt-every-nth',
    profile: LATHE,
    summary: { key: 'ncNumbering.renumber.summarySkipped', params: { count: 7, skipped: 3 } },
    warnings: [
      { key: 'ncNumbering.renumber.everyNthRemoved', params: { count: 8 } },
      { key: 'ncNumbering.renumber.everyNthKept', params: { count: 2 } },
      { key: 'ncNumbering.renumber.referencesRewritten', params: { count: 4 } },
    ],
    note: 'every third block is numbered, the blocks between lose their number, the two the cycles name keep one',
  },
  {
    id: 'opt-skip-containing',
    profile: 'okuma-osp',
    summary: { key: 'ncNumbering.renumber.summarySkipped', params: { count: 7, skipped: 4 } },
    warnings: [],
    rows: [
      { line: 5, key: 'ncNumbering.renumber.skippedContaining' },
      { line: 9, key: 'ncNumbering.renumber.skippedContaining' },
    ],
    note: 'the lines that contain MSG, a comment included and in either case, keep their text and are listed',
  },
  {
    id: 'opt-start-trigger',
    profile: 'okuma-osp',
    summary: { key: 'ncNumbering.renumber.summarySkipped', params: { count: 6, skipped: 1 } },
    warnings: [],
    rows: [{ line: 5, key: 'ncNumbering.renumber.startAfterTriggerRow', params: { text: '(--- CUT ---)' } }],
    note: 'numbering starts at the line after the trigger; the lines above keep their text and one row says where it started',
  },
  {
    id: 'opt-align-column',
    profile: LATHE,
    summary: { key: 'ncNumbering.renumber.summarySkipped', params: { count: 10, skipped: 3 } },
    warnings: [],
    note: 'the code behind each new number starts at column 8; behind a skip mark that follows the number the gap is copied',
  },
  {
    id: 'opt-skip-first-last',
    profile: 'sinumerik',
    summary: { key: 'ncNumbering.renumber.summarySkipped', params: { count: 7, skipped: 1 } },
    warnings: [{ key: 'ncNumbering.renumber.referencesRewritten', params: { count: 1 } }],
    rows: [
      { line: 1, key: 'ncNumbering.renumber.skippedFirstRow', params: { count: 3 } },
      { line: 11, key: 'ncNumbering.renumber.skippedLastRow', params: { count: 1 } },
    ],
    note: 'the first 3 and the last line keep their text; one row for each region',
  },
  {
    id: 'opt-start-trigger-missing',
    profile: 'sinumerik',
    summary: { key: 'ncNumbering.renumber.refused.noTrigger', params: { text: 'START_HERE' } },
    warnings: [],
    refused: true,
    note: 'no line contains the start text: the run writes nothing and says so',
  },
  {
    id: 'opt-fit-to-max-does-not-fit',
    profile: 'okuma-osp',
    summary: { key: 'ncNumbering.renumber.refused.doesNotFit', params: { count: 4, start: 9998, max: 9999 } },
    warnings: [],
    refused: true,
    note: 'four blocks from 9998 do not fit below 9999 even in steps of 1: the run writes nothing and says so',
  },
]

// ---------------------------------------------------------------- the reference cases (P4.19, rules 8-10)

/**
 * The goldens of the reference model run through the form. `pre` is the question asked before the run (its text is
 * `ctx.t(pre.key, pre.params)`), `null` when none is; `warnings` are the transform's; `rows` the reports that
 * carry no parameter, found by line and key; `rewritten` is how many references the golden rewrites.
 * @type {{ id: string, profile: string, pre: Msg | null, warnings: Msg[], rows: { line: number, key: string }[], note: string }[]}
 */
export const REFERENCE_CASES = [
  {
    id: 'ref-return-single-caller',
    profile: LATHE,
    pre: null,
    warnings: [{ key: 'ncNumbering.renumber.referencesRewritten', params: { count: 1 } }],
    rows: [],
    note: 'M99 P20 returns into the one program that calls this one, and follows that program\'s block (P30)',
  },
  {
    id: 'ref-packed-call',
    profile: FANUC,
    pre: null,
    warnings: [{ key: 'ncNumbering.renumber.referencesRewritten', params: { count: 1 } }],
    rows: [],
    note: 'M98 P21010 is O1010 called twice (a count in front of a four-digit program number), so O0001 is the one caller',
  },
  {
    id: 'ref-name-call',
    profile: FANUC,
    pre: null,
    warnings: [{ key: 'ncNumbering.renumber.referencesRewritten', params: { count: 1 } }],
    rows: [],
    note: 'M98 <SHAFT_T12> calls the program of that name, so the return is followed',
  },
  {
    id: 'ref-macro-call',
    profile: FANUC,
    pre: null,
    warnings: [{ key: 'ncNumbering.renumber.referencesRewritten', params: { count: 1 } }],
    rows: [],
    note: 'G65 P9010 calls a macro program; its M99 P returns into the caller',
  },
  {
    id: 'ref-local-call',
    profile: FANUC,
    pre: null,
    warnings: [{ key: 'ncNumbering.renumber.referencesRewritten', params: { count: 2 } }],
    rows: [],
    note: 'M98 Q100 without a program is a call of its own program: the Q and the M99 P of that part both follow their blocks',
  },
  {
    id: 'ref-return-two-callers',
    profile: FANUC,
    pre: { key: 'ncNumbering.renumber.references', params: { count: 1, first: 14 } },
    warnings: [{ key: 'ncNumbering.renumber.referencesUnresolved', params: { count: 1 } }],
    rows: [{ line: 14, key: 'ncNumbering.renumber.referenceCallersRow' }],
    note: 'two programs call O3012, so M99 P30 cannot be told apart: asked first, left as written, reported',
  },
  {
    id: 'ref-return-no-caller',
    profile: LATHE,
    pre: { key: 'ncNumbering.renumber.references', params: { count: 1, first: 5 } },
    warnings: [{ key: 'ncNumbering.renumber.referencesUnresolved', params: { count: 1 } }],
    rows: [{ line: 5, key: 'ncNumbering.renumber.referenceNoCallerRow' }],
    note: 'no program of the file calls O2011: M99 P30 is asked about, left as written and reported',
  },
  {
    id: 'ref-program-twice',
    profile: LATHE,
    pre: { key: 'ncNumbering.renumber.references', params: { count: 2, first: 8 } },
    warnings: [{ key: 'ncNumbering.renumber.referencesUnresolved', params: { count: 2 } }],
    rows: [
      { line: 8, key: 'ncNumbering.renumber.referenceProgramTwiceRow' },
      { line: 11, key: 'ncNumbering.renumber.referenceProgramTwiceRow' },
    ],
    note: 'O2011 is in the file twice: both M99 P20 are asked about, left as written and reported',
  },
  {
    id: 'm98-subprogram-start',
    profile: FANUC,
    pre: { key: 'ncNumbering.renumber.references', params: { count: 1, first: 3 } },
    warnings: [{ key: 'ncNumbering.renumber.referencesKept', params: { count: 1 } }],
    rows: [{ line: 3, key: 'ncNumbering.renumber.referenceKeptRow' }],
    note: 'M98 P2000 Q50 starts O2000 at its N50: never rewritten (the kept row), and the second row says no N50 is left',
  },
  {
    id: 'm98-p-before-call',
    profile: LATHE,
    pre: { key: 'ncNumbering.renumber.references', params: { count: 1, first: 4 } },
    warnings: [
      { key: 'ncNumbering.renumber.referencesRewritten', params: { count: 1 } },
      { key: 'ncNumbering.renumber.referencesKept', params: { count: 1 } },
    ],
    rows: [{ line: 4, key: 'ncNumbering.renumber.referenceKeptRow' }],
    note: 'P2000 M98 Q50 is the same call with the words the other way round: kept; the plain local M98 Q50 below is still followed',
  },
]

// ---------------------------------------------------------------- the form

/**
 * The fields of the form that a golden's `options` stand for: the same names, a missing maximum as an empty
 * field, a list of texts as the space-separated text the field takes.
 * @param {Record<string, unknown>} options
 * @returns {Record<string, string | number | boolean>}
 */
export function formFieldsOf(options) {
  /** @type {Record<string, string | number | boolean>} */
  const fields = {}
  for (const [id, value] of Object.entries(options)) {
    if (value === null || value === undefined) fields[id] = ''
    else if (Array.isArray(value)) fields[id] = value.join(' ')
    else fields[id] = /** @type {string | number | boolean} */ (value)
  }
  return fields
}

/**
 * Brings the renumber form of a dialect back to the profile's defaults by forgetting what it remembered.
 * @param {Harness} h
 * @param {string} profileId
 */
export function resetRenumberForm(h, profileId) {
  context(h).uiState.setLastParams(`transform:renumber:${profileId}`, {})
}

/**
 * Opens the form of Renumber Blocks, reads the controls named and cancels it: what the form starts from.
 * @param {Harness} h
 * @param {string[]} ids field ids
 * @returns {Promise<Record<string, string | boolean | null>>} a checkbox as a boolean, a text or number as its text, `null` for a field that is not there
 */
export async function peekForm(h, ids) {
  const running = context(h).commands.run(RENUMBER)
  if (!(await h.waitFor(() => h.q('modal'), { timeout: 10000 }))) throw new Error('peekForm: Renumber Blocks opened no form')
  /** @type {Record<string, string | boolean | null>} */
  const values = {}
  for (const id of ids) {
    const control = /** @type {HTMLInputElement | null} */ (h.q('form-field', { field: id })?.querySelector('input, select, textarea') ?? null)
    values[id] = control === null ? null : control.type === 'checkbox' ? control.checked : control.value
  }
  h.click(h.q('modal-cancel'))
  await h.waitFor(() => !h.q('modal'), { timeout: 10000 })
  await running
  await h.idle()
  return values
}

/**
 * Opens the form, types the values, and answers what the form says about them without running anything.
 * @param {Harness} h
 * @param {Record<string, string | number | boolean>} fields
 * @returns {Promise<{ errors: Record<string, string | undefined>, okDisabled: boolean }>}
 */
export async function tryForm(h, fields) {
  const running = context(h).commands.run(RENUMBER)
  if (!(await h.waitFor(() => h.q('modal'), { timeout: 10000 }))) throw new Error('tryForm: Renumber Blocks opened no form')
  for (const [id, value] of Object.entries(fields)) setField(h, id, value)
  await h.frame()
  await h.idle()
  /** @type {Record<string, string | undefined>} */
  const errors = {}
  for (const id of Object.keys(fields)) errors[id] = h.q('form-field', { field: id })?.dataset.error
  const okDisabled = /** @type {HTMLButtonElement} */ (h.q('modal-ok')).disabled
  h.click(h.q('modal-cancel'))
  await h.waitFor(() => !h.q('modal'), { timeout: 10000 })
  await running
  await h.idle()
  return { errors, okDisabled }
}

// ---------------------------------------------------------------- running a case

/**
 * What the Results panel shows, as `line|severity|text`.
 * @param {Harness} h
 */
export const findings = (h) => h.qa('results-finding').map((element) => `${element.dataset.line}|${element.dataset.severity}|${element.textContent?.trim()}`)

/** The report's text, message and findings. @param {Harness} h */
export const panelText = (h) => h.q('results-panel')?.textContent ?? ''

/** Whether a native question is on screen. @param {Harness} h */
export const asked = async (h) => (await h.alert.visible()) !== null

/**
 * Runs Renumber Blocks with the form filled, answering the question the golden says is asked (and only that one).
 * @param {Harness} h
 * @param {Record<string, string | number | boolean>} fields
 * @param {{ pre: Msg | null, answer?: string }} question the question expected and the button to click (default `Continue`)
 * @returns {Promise<{ ran: boolean, alertTexts: string[] | null }>}
 */
export async function renumberAsking(h, fields, { pre, answer = 'Continue' }) {
  const ctx = context(h)
  const running = ctx.commands.run(RENUMBER)
  if (!(await h.waitFor(() => h.q('modal'), { timeout: 10000 }))) throw new Error('renumberAsking: Renumber Blocks opened no form')
  for (const [id, value] of Object.entries(fields)) setField(h, id, value)
  await h.frame()
  h.click(h.q('modal-ok'))
  await h.waitFor(() => !h.q('modal'), { timeout: 10000 })
  /** @type {string[] | null} */
  let alertTexts = null
  if (pre !== null) {
    const alert = await h.alert.wait()
    alertTexts = alert === null ? [] : [...(alert.texts ?? [])]
    await h.alert.click(answer)
  }
  const ran = await running
  await h.idle()
  return { ran, alertTexts }
}

/**
 * Takes a case's document away again, whatever state it is in: one undo for what the run wrote, then the close
 * (which asks only if the document is still changed, and is answered with Don't Save).
 * @param {Harness} h
 * @param {string} id
 */
export async function finishCase(h, id) {
  const ctx = context(h)
  await activate(h, id)
  if (ctx.docs.get(id)?.dirty === true) {
    h.focusEditor()
    await undoKey(h)
  }
  await closeDoc(h, id)
}

/**
 * Closes a document, answering the unsaved-changes question with Don't Save when it is asked.
 * @param {Harness} h
 * @param {string} id
 */
export async function closeDoc(h, id) {
  const ctx = context(h)
  const closing = ctx.files.close(id)
  if (ctx.docs.get(id)?.dirty === true) {
    await h.alert.wait({ timeout: 5000 })
    await h.alert.click("Don't Save").catch(() => {})
  }
  await closing
  await h.idle()
}

/**
 * Makes a document the active one and waits for the editor to show it.
 * @param {Harness} h
 * @param {string} id
 */
export async function activate(h, id) {
  context(h).docs.activate(id)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 8000 })
  await h.idle()
}

/**
 * One Cmd+Z in the active document, and the wait until it shows `text`.
 * @param {Harness} h
 * @param {string} text
 * @returns {Promise<boolean>} whether the document got there
 */
export async function undoTo(h, text) {
  h.focusEditor()
  await undoKey(h)
  return Boolean(await h.waitFor(() => h.app.text() === text, { timeout: 10000 }))
}

// ---------------------------------------------------------------- the programs of p4-renumber-others

/**
 * Four documents, written out. `base` gives the program numbers so that each phase of the scenario has its own
 * (the documents of an earlier phase stay open and must not hold the same names).
 *
 *  - **a**, the main program, renumbered by the scenario: eight blocks N1 to N8 become N10 to N80. It calls the
 *    subprograms of B (twice) and C, and the one of D.
 *  - **b**, a document of the same dialect: two subprograms that A calls and return with `M99 P3` / `M99 P5`
 *    (into blocks N3 and N5 of A, so N30 and N50 after the run), and a third program that starts A at its
 *    block 3 with `M98 P<a> Q3` (a reference the dialect never rewrites: listed, not written).
 *  - **c**, another document of the same dialect: a subprogram A calls, returning with `M99 P7`.
 *  - **d**, a document of the *other* dialect (the lathe) holding the subprogram A calls at `N7`: never read,
 *    never listed, never written.
 *
 * `listed` is what the list holds after the run, by document, and `after` the text of each document after the
 * update. Line numbers are the document's own, the first line being 1.
 * @param {number} base the main program's number; the others are worked out from it
 */
export function world(base) {
  // Six phases run in one app (bases 1000 to 1500 in steps of 100) and their documents stay open, so no program number may be
  // held by two of them: with `b2 = base + 1200` and `k = base + 1300` the second phase's O2300 was the first phase's "OTHER",
  // `M98 P2300` named two programs, and the update (rightly) wrote nothing for it. The offsets are 1000 apart, the steps 100:
  // a is 1010-1510, b1 2000-2500, b2 4000-4500, k 5000-5500, d 6000-6500, c 9000-9500. Not O1000 for the main program: the
  // test build opens with a document of its own that holds `O1000`, so `M98 P1000 Q3` named two programs (the one of this
  // world and that one) and the update rightly did not list it.
  const a = base + 10
  const b1 = base + 1000
  const b2 = base + 3000
  const k = base + 4000
  const d = base + 5000
  const c = base + 8000

  const aLines = ['%', `O${a} (MAIN)`, 'N1 G00 X0 Z0', `N2 M98 P${b1}`, 'N3 G01 X10.', `N4 M98 P${b2}`, 'N5 G01 X20.', `N6 M98 P${c}`, `N7 M98 P${d}`, 'N8 M30', '%']
  const bLines = ['%', `O${b1} (FIRST)`, 'N10 G00 X5.', 'N20 M99 P3', `O${b2} (SECOND)`, 'N10 G00 X6.', 'N20 M99 P5', `O${k} (OTHER)`, `N10 M98 P${a} Q3`, 'N20 M30', '%']
  const cLines = ['%', `O${c} (THIRD)`, 'N10 G00 X7.', 'N20 M99 P7', '%']
  const dLines = ['%', `O${d} (LATHE)`, 'N10 G00 X1.', 'N20 M99 P7', '%']

  const text = (/** @type {string[]} */ lines) => lines.join('\n') + '\n'
  const renumbered = aLines.map((line) => line.replace(/^N(\d+)/, (_all, n) => `N${Number(n) * 10}`))
  const updated = (/** @type {string[]} */ lines, /** @type {Record<number, string>} */ changes) => lines.map((line, i) => changes[i + 1] ?? line)

  return {
    base,
    names: { a, b1, b2, k, d, c },
    a: { input: text(aLines), after: text(renumbered) },
    b: { input: text(bLines), after: text(updated(bLines, { 4: 'N20 M99 P30', 7: 'N20 M99 P50' })) },
    c: { input: text(cLines), after: text(updated(cLines, { 4: 'N20 M99 P70' })) },
    d: { input: text(dLines) },
    /** The list after the run: [document, line, kind, value as written, what it becomes]. */
    listed: /** @type {[string, number, string, string, string | null][]} */ ([
      ['b', 4, 'update', '3', '30'],
      ['b', 7, 'update', '5', '50'],
      ['b', 9, 'kept', '3', null],
      ['c', 4, 'update', '7', '70'],
    ]),
    /** How many the update writes, in how many documents, and how many it leaves. */
    updates: { references: 3, documents: 2, left: 1 },
    /** The name of the renumbered program, as the rows give it. */
    program: String(a),
  }
}
