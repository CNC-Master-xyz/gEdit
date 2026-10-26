// Helpers the P4b scenarios share (`p4-cycles`, `p4-cycles-time`, `p4-perf` section B). This file registers no scenario:
// `loadScenarios()` imports it like any other file under `scenarios/` and finds nothing new in it.
//
// Four things are worth knowing before reading a check that uses these:
//
//   1. **A script is started the way a user starts it: from the Tools tab.** Expand Drilling Cycles and Statistics and
//      Time are built-in scripts (B1 A9), so their buttons are on the Tools tab in the group "Built-in Scripts".
//      `runTools` clicks the button, reads what the form shows before it is touched (that is where a prefill from the
//      machine is seen), fills it, clicks OK and waits for the run to end. The end of a run is told by `scripts.running`
//      going up and down (a subscription, so a run too short for a poll is still seen), never by a wait of a fixed length.
//      Only the fields the caller names are touched: a field that is prefilled from the machine keeps the machine's
//      value, which is what the scenarios of the prefill rely on.
//   2. **Every expected text comes from a golden** (`tests/fixtures/scripts/{expand_cycles,statistics}/<case>`): the program
//      is `input.nc` byte for byte, the result `expected.nc` (or `expected.csv`) byte for byte, the message and the
//      findings are `envelope.json`'s or `refused.json`'s. Nothing NC is typed here except the programs of `p4-perf`,
//      whose answer is worked out from their own text.
//   3. **The goldens name no machine**, so the message of a golden ends with the sentence "No machine chosen: ...". A
//      run with a machine says something else after the same first part, so a check with a machine compares the part
//      before that sentence (`beforeMachineSentence`) and a check without one compares the whole message.
//   4. **The machines are made through the service** (`ctx.machines.add`), with the `motion` and `limits` blocks
//      written as the page writes them: the page that edits them is `p4-machines`' business. The number rules are the
//      profile's own preset, so a label and its data cannot drift apart here.

import { setInput } from './m2-common.js'
import { context } from './m3-common.js'
import { message, ribbonTab } from './m4-common.js'
import { read, scriptService } from './m5-common.js'
import { pickMachine, waitForMachine } from './m6-common.js'
import { findings as screenFindings, goldenFindings } from './m8-common.js'
import { fieldIds, splitLines } from './m10-common.js'
import { geometryGolden, openGolden, stopRun } from './p4-geometry-common.js'

export { context, fieldIds, geometryGolden, goldenFindings, message, openGolden, read, ribbonTab, screenFindings, scriptService, splitLines, stopRun }

/** @typedef {import('../lib/api.js').Harness} Harness */

/** The scripts P4b adds to the bundle (their `name` headers are "Expand Drilling Cycles" and "Statistics and Time"). */
export const CYCLE_SCRIPTS = {
  expand: 'bundled:expand_cycles.py',
  time: 'bundled:time_estimate.py',
  checks: 'bundled:program_checks.py',
}

/** The form ids of Expand Drilling Cycles, in the order of its `[[params]]` (the headers of `expand_cycles.py`). */
export const EXPAND_FIELDS = ['peckRetract', 'peckClearance', 'motionUnits']

/** The form ids of Statistics and Time, in the order of its `[[params]]` (the header of `time_estimate.py`; plan §6.4 rule 6). */
export const TIME_FIELDS = ['peckRetract', 'peckClearance', 'motionUnits', 'rapidX', 'rapidY', 'rapidZ', 'rapidA', 'rapidB', 'rapidC', 'rapidKind', 'maxFeed', 'toolChange', 'format']

/**
 * The fields of Statistics and Time that start from the machine's motion block, with the member each reads (the `prefill`
 * lines of the header). `format` is not one of them.
 * @type {Record<string, string>}
 */
export const PREFILLED = {
  peckRetract: 'machine.motion.peckRetract',
  peckClearance: 'machine.motion.peckClearance',
  motionUnits: 'machine.motion.units',
  rapidX: 'machine.motion.rapid.X',
  rapidY: 'machine.motion.rapid.Y',
  rapidZ: 'machine.motion.rapid.Z',
  rapidA: 'machine.motion.rapid.A',
  rapidB: 'machine.motion.rapid.B',
  rapidC: 'machine.motion.rapid.C',
  rapidKind: 'machine.motion.rapidKind',
  maxFeed: 'machine.motion.maxFeed',
  toolChange: 'machine.motion.toolChange',
}

/**
 * The visible label of every choice of the Statistics and Time form, by the value a golden's `params.json` gives (the
 * `choices` of the header). A choice control's options carry their index as their value, so one is picked by its label.
 * @type {Record<string, Record<string, string>>}
 */
export const CHOICE_LABELS = {
  motionUnits: { mm: 'mm', inch: 'inch' },
  rapidKind: { straight: 'Straight', 'per-axis': 'Each axis at its own rate' },
  format: { table: 'Table', csv: 'CSV' },
}

// ---------------------------------------------------------------- the machines

/**
 * A mill machine (the Fanuc milling dialect) made through the service, with the blocks given. Waits until the service
 * has written the file.
 * @param {Harness} h
 * @param {string} name
 * @param {{ motion?: object, limits?: object, profile?: string, preset?: string }} [o]
 * @returns {Promise<string>} the machine's id
 */
export async function makeMill(h, name, o = {}) {
  const ctx = context(h)
  const profile = o.profile ?? 'fanuc-gcode'
  const preset = o.preset ?? 'is-b'
  const found = ctx.profiles.profile(profile).machineParams?.numberInput?.presets?.find((entry) => entry.id === preset)
  if (found === undefined) throw new Error(`${profile} has no number preset ${preset}`)
  const params = { numberInput: /** @type {any} */ (found.value), units: 'mm', ...(o.motion === undefined ? {} : { motion: o.motion }), ...(o.limits === undefined ? {} : { limits: o.limits }) }
  const id = await /** @type {any} */ (ctx).machines.add({ name, profile, notes: '', params })
  await h.idle()
  return id
}

/**
 * Picks a machine for the active document and waits until the status item shows it (`''` for none).
 * @param {Harness} h
 * @param {string} label the entry's label: the machine's name, or "None (dialect defaults)"
 * @param {string} id the machine's id, `''` for none
 */
export async function useMachine(h, label, id) {
  await pickMachine(h, label)
  await waitForMachine(h, id)
}

// ---------------------------------------------------------------- the form

/**
 * The text a field of the open form shows (a number or text field), or null when the form has no such field.
 * @param {Harness} h
 * @param {string} field
 * @returns {string | null}
 */
export function fieldText(h, field) {
  const control = /** @type {HTMLInputElement | null} */ (h.q('form-field', { field })?.querySelector('input'))
  return control === null ? null : control.value.trim()
}

/**
 * The label of the option a choice field of the open form shows, `''` while it shows none (its placeholder is not a choice).
 * @param {Harness} h
 * @param {string} field
 */
export function fieldPicked(h, field) {
  const control = /** @type {HTMLSelectElement | null} */ (h.q('form-field', { field })?.querySelector('select'))
  if (control === null) return ''
  const option = control.selectedOptions[0]
  return option === undefined || option.disabled || option.value === '' ? '' : (option.textContent?.trim() ?? '')
}

/**
 * Everything the open form shows, as one record: a number or text field as its text, a choice as its picked label.
 * @param {Harness} h
 * @returns {Record<string, string>}
 */
export function formValues(h) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const field of fieldIds(h)) {
    const wrapper = h.q('form-field', { field })
    out[field] = wrapper?.querySelector('select') ? fieldPicked(h, field) : (fieldText(h, field) ?? '')
  }
  return out
}

/**
 * Types the values into the form that is open. A number or text is typed as it is (an empty string empties the field), a
 * choice is picked by the label `CHOICE_LABELS` gives its value. A field the values do not name is left as the form shows it.
 * @param {Harness} h
 * @param {Record<string, unknown>} values
 */
export function fillForm(h, values) {
  for (const [field, value] of Object.entries(values)) {
    const wrapper = h.q('form-field', { field })
    if (!wrapper) throw new Error(`the form has no field ${JSON.stringify(field)}; it has ${fieldIds(h).join(', ')}`)
    const control = /** @type {HTMLInputElement | HTMLSelectElement | null} */ (wrapper.querySelector('input, select, textarea'))
    if (!control) throw new Error(`field ${field} has no control`)
    if (control instanceof HTMLSelectElement) {
      const label = CHOICE_LABELS[field]?.[String(value)]
      if (label === undefined) throw new Error(`field ${field} has no choice ${JSON.stringify(value)}; the header lists ${JSON.stringify(CHOICE_LABELS[field])}`)
      const option = [...control.options].find((o) => o.textContent?.trim() === label)
      if (!option) throw new Error(`field ${field}: no option ${JSON.stringify(label)} in ${[...control.options].map((o) => o.textContent?.trim()).join('|')}`)
      h.select(control, option.value)
    } else {
      setInput(control, String(value))
    }
  }
}

// ---------------------------------------------------------------- running

/**
 * @typedef {object} ToolsRun
 * @property {string[]} fields the field ids the form showed
 * @property {Record<string, string>} shown what the form showed before anything was typed into it
 * @property {number} ms from the click on OK until the run has ended and its result is applied and drawn
 * @property {string} status the status line at the end
 */

/**
 * Runs a built-in script from the Tools tab: the button of the group "Built-in Scripts", the form, OK. Waits until the run
 * has ended (point 1 of the header) and the editor has settled.
 * @param {Harness} h
 * @param {string} scriptId
 * @param {Record<string, unknown>} [values] the fields to type (`fillForm`); the others stay as shown
 * @param {{ timeout?: number, inspect?: (shown: Record<string, string>) => void }} [o] timeout: ms to wait for the run to end, from OK; `inspect` is called with the form open and untouched
 * @returns {Promise<ToolsRun>}
 */
export async function runTools(h, scriptId, values = {}, o = {}) {
  const service = scriptService(h)
  await ribbonTab(h, 'tools')
  const item = await h.waitFor(() => h.q('script-item', { scriptId }), { timeout: 10000 })
  if (!item) throw new Error(`the Tools tab offers no ${scriptId}; it offers ${JSON.stringify(h.qa('script-item').map((e) => e.dataset.scriptId))}`)
  if (/** @type {HTMLButtonElement} */ (item).disabled) throw new Error(`the button of ${scriptId} is disabled (status: ${message(h)})`)

  const seen = { started: false, ended: false }
  const stop = service.running.subscribe((/** @type {unknown} */ running) => {
    if (running !== null && running !== undefined) seen.started = true
    else if (seen.started) seen.ended = true
  })
  try {
    h.click(item)
    const modal = await h.waitFor(() => h.q('modal'), { timeout: 20000 })
    if (!modal) throw new Error(`${scriptId}: no form after the click (status: ${message(h)})`)
    const fields = fieldIds(h)
    const shown = formValues(h)
    o.inspect?.(shown)
    fillForm(h, values)
    await h.frame()
    const at = performance.now()
    h.click(h.q('modal-ok'))
    await h.waitFor(() => !h.q('modal'), { timeout: 15000 })
    if (h.q('modal')) throw new Error(`${scriptId}: OK did not close the form (is a field refused?): ${(h.q('modal')?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 300)}`)
    const ended = await h.waitFor(() => (seen.ended ? true : null), { timeout: o.timeout ?? 120000, interval: 25 })
    if (ended !== true) {
      const status = message(h)
      await stopRun(h)
      throw new Error(`${scriptId}: the run did not end within ${o.timeout ?? 120000} ms of OK (status: ${status})`)
    }
    await h.idle({ timeout: o.timeout ?? 120000 })
    const ms = Math.round(performance.now() - at)
    return { fields, shown, ms, status: message(h) }
  } finally {
    stop()
  }
}

/**
 * The first line that differs between two texts, for a failing check's detail.
 * @param {string} a
 * @param {string} b
 */
export function firstDifference(a, b) {
  if (a === b) return null
  const x = a.split('\n')
  const y = b.split('\n')
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return { line: i + 1, got: x[i], want: y[i], gotLines: x.length, wantLines: y.length }
  return null
}

/**
 * A golden's message as far as it does not depend on the machine: everything before the sentence "No machine chosen".
 * With a machine chosen the script says something else after it (point 3 of the header).
 * @param {string} golden
 */
export function beforeMachineSentence(golden) {
  const cut = golden.indexOf(' No machine chosen')
  return cut < 0 ? golden : golden.slice(0, cut)
}

/**
 * The document the active tab shows, as text, once the editor shows it.
 * @param {Harness} h
 * @returns {Promise<{ id: string, text: string }>}
 */
export async function activeText(h) {
  const ctx = context(h)
  const id = ctx.docs.getActiveId()
  if (id === null) throw new Error('no document is active')
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 10000 })
  await h.idle()
  const count = ctx.editor.getLineCount(id)
  return { id, text: ctx.editor.getLines(id, 1, count).join('\n') }
}

// ---------------------------------------------------------------- the statistics goldens

/**
 * `tests/fixtures/scripts/statistics/<name>`, copied into the run folder and read: the program, the form's values, the profile,
 * the CSV and the envelope.
 * @param {Harness} h
 * @param {string} name the case folder
 * @returns {Promise<{ dir: string, input: string, params: Record<string, unknown>, profile: string, csv: string, envelope: { message: string, findings: any[] } }>}
 */
export async function statisticsGolden(h, name) {
  const dir = await h.fixture(`scripts/statistics/${name}`)
  /** @param {string} file */
  const text = async (file) => {
    const got = await h.disk.read(`${dir}/${file}`).catch(() => null)
    if (got === null) throw new Error(`statistics/${name} has no ${file}`)
    return got
  }
  const options = JSON.parse(await text('case.json'))
  return {
    dir,
    input: await text('input.nc'),
    params: JSON.parse(await text('params.json')),
    profile: typeof options.profile === 'string' ? options.profile : 'fanuc-gcode',
    csv: await text('expected.csv'),
    envelope: JSON.parse(await text('envelope.json')),
  }
}

/**
 * Opens a statistics golden's program byte for byte as `<fileName>`, under the profile the case names, in the shape
 * `openGolden` takes.
 * @param {Harness} h
 * @param {Awaited<ReturnType<typeof statisticsGolden>>} golden
 * @param {string} fileName
 */
export async function openStatistics(h, golden, fileName) {
  return openGolden(h, /** @type {any} */ ({ c: { dir: golden.dir, input: golden.input }, profile: golden.profile, refused: null }), fileName)
}

// ---------------------------------------------------------------- the large drilling program (p4-perf, section B)

/** The numbers of `drillProgram`'s cycle: the depth, the R plane, the initial level (`G43 Z50.`), the cycle's feed, the feed of the moves between. */
export const DRILL = { depth: -5, plane: 2, level: 50, feed: 150, travelFeed: 800 }

/** The lines in one group of `drillProgram`: the cycle block, the block that repeats it, `G80`, nine feed moves. */
export const DRILL_GROUP_LINES = 12

/**
 * A drilling program for the expansion at 300,000 lines: a Fanuc mill program (absolute, millimetres, every word with a point)
 * that drills two holes by `G98 G81` in every group of twelve lines (the cycle block, a block that repeats it, `G80`), followed
 * by nine feed moves, so the program is mostly moves, as a real one is. The return mode is written in the cycle block, as the owner
 * wants it (a cycle with no `G98`/`G99` is refused), and the first hole is where the tool stands.
 * @param {{ lines?: number }} [o] at least this many lines
 * @returns {string} CRLF line ends, as the other programs of `p4-perf`
 */
export function drillProgram({ lines: minLines = 300000 } = {}) {
  const head = ['%', 'O9003 (DRILL 300K - WRITTEN FOR GEDIT, SYNTHETIC)', 'G21 G17 G40 G49 G80 G90 G94', 'T1 M6', 'S3000 M3', 'G0 X0. Y0.', `G43 Z${DRILL.level}. H1 M8`, `G1 X0. Y0. F${DRILL.travelFeed}.`]
  const tail = [`G0 Z${DRILL.level}.`, 'M30', '%']
  const out = [...head]
  for (let g = 0; out.length + DRILL_GROUP_LINES + tail.length <= minLines; g++) {
    const x = (g % 40) * 3
    const y = Math.floor(g / 40) % 30
    out.push(`G98 G81 X${x}. Y${y}. Z${DRILL.depth}. R${DRILL.plane}. F${DRILL.feed}.`)
    out.push(`X${x + 10}.`)
    out.push('G80')
    for (let k = 0; k < 9; k++) out.push(`G1 X${x + k}. Y${y + 1}. F${DRILL.travelFeed}.`)
  }
  // A program of at least `minLines`: fill up with feed moves, which no cycle touches.
  while (out.length + tail.length < minLines) out.push(`G1 X1. Y1. F${DRILL.travelFeed}.`)
  out.push(...tail)
  return out.join('\r\n') + '\r\n'
}

/**
 * Where the tool stands after every line, by the plainest reading of the words: absolute `X`, `Y`, `Z`, `G0`/`G1` (also `G00`/`G01`) as the
 * motion mode and `F` as the feed, comments left out. Only good for the programs of this file (`drillProgram` and what the expansion
 * writes of it): no incremental words, no arcs, no frames.
 * @param {string[]} lines
 * @returns {{ x: number | null, y: number | null, z: number | null, mode: number | null, feed: number | null }[]}
 */
export function walkLines(lines) {
  let x = /** @type {number | null} */ (null)
  let y = /** @type {number | null} */ (null)
  let z = /** @type {number | null} */ (null)
  let mode = /** @type {number | null} */ (null)
  let feed = /** @type {number | null} */ (null)
  return lines.map((raw) => {
    const code = raw.replace(/\([^)]*\)/g, '')
    const g = /(?<![A-Z0-9])G0?([01])(?!\d)/.exec(code)
    if (g) mode = Number(g[1])
    /** @param {string} letter */
    const word = (letter) => {
      const found = new RegExp(`(?<![A-Z0-9])${letter}(-?\\d*\\.?\\d+)`).exec(code)
      return found ? Number(found[1]) : null
    }
    x = word('X') ?? x
    y = word('Y') ?? y
    z = word('Z') ?? z
    feed = word('F') ?? feed
    return { x, y, z, mode, feed }
  })
}

/**
 * Whether the expansion of a `drillProgram` is right, worked out from the program's own text and not from what the script writes:
 * every line that is no cycle block (the head, the feed moves, `G80`, the tail) is the same line, byte for byte; in place of the cycle
 * blocks of a run (a `G81` block and the blocks that repeat it) there are no cycle words, and walking the lines the tool, for every hole in
 * order, comes to the hole at the R plane at rapid, then to the depth at feed `F` of the cycle, then back to the level it started from
 * at rapid (`G98`), and the run ends at the last hole at that level. A hole takes three or four blocks. Answers every problem found
 * (at most 20), an empty list for a right expansion.
 * @param {string[]} before the program's lines
 * @param {string[]} after the expansion's lines
 * @returns {{ problems: string[], holes: number }}
 */
export function checkDrillExpansion(before, after) {
  /** @type {string[]} */
  const problems = []
  const say = (/** @type {string} */ text) => {
    if (problems.length < 20) problems.push(text)
  }
  const states = walkLines(after)
  const isRepeat = (/** @type {string} */ line) => /^X-?\d+\.?\d*$/.test(line)
  const kept = (/** @type {string} */ line) => !/(?<![A-Z0-9])G81(?!\d)/.test(line) && !isRepeat(line)
  let holes = 0
  let j = 0
  for (let i = 0; i < before.length && problems.length < 20; ) {
    const line = before[i]
    if (kept(line)) {
      if (after[j] !== line) {
        say(`line ${i + 1} of the program should be line ${j + 1} of the result, unchanged: ${JSON.stringify(line)}, found ${JSON.stringify(after[j])}`)
        break
      }
      i++
      j++
      continue
    }
    // A run of cycle blocks: the hole each of them drills.
    /** @type {{ x: number, y: number, z: number, r: number, f: number, line: number }[]} */
    const run = []
    let y = NaN
    let z = NaN
    let r = NaN
    let f = NaN
    while (i < before.length && !kept(before[i])) {
      const text = before[i]
      /** @param {string} letter */
      const word = (letter) => {
        const found = new RegExp(`(?<![A-Z0-9])${letter}(-?\\d*\\.?\\d+)`).exec(text)
        return found ? Number(found[1]) : NaN
      }
      y = Number.isNaN(word('Y')) ? y : word('Y')
      z = Number.isNaN(word('Z')) ? z : word('Z')
      r = Number.isNaN(word('R')) ? r : word('R')
      f = Number.isNaN(word('F')) ? f : word('F')
      run.push({ x: word('X'), y, z, r, f, line: i + 1 })
      i++
    }
    const stop = i < before.length ? before[i] : null
    let k = j
    while (k < after.length && after[k] !== stop) k++
    if (stop !== null && k >= after.length) {
      say(`the line after the cycle blocks of line ${run[0].line}, ${JSON.stringify(stop)}, is not in the result`)
      break
    }
    for (let m = j; m < k; m++) {
      if (/(?<![A-Z0-9])G8\d(?!\d)/.test(after[m])) say(`line ${m + 1} of the result still runs a cycle: ${JSON.stringify(after[m])}`)
    }
    if (k - j < 3 * run.length || k - j > 4 * run.length) say(`the ${run.length} holes of line ${run[0].line} became ${k - j} blocks, not three or four each`)
    const level = j > 0 ? states[j - 1].z : null
    if (level !== DRILL.level) say(`before line ${run[0].line} the tool is at Z${level}, not at the initial level Z${DRILL.level}`)
    let at = j
    for (const hole of run) {
      /** @param {number} from @param {(s: ReturnType<typeof walkLines>[number]) => boolean} test */
      const find = (from, test) => {
        for (let m = from; m < k; m++) if (test(states[m])) return m
        return -1
      }
      const here = (/** @type {{ x: number | null, y: number | null }} */ s) => s.x === hole.x && s.y === hole.y
      const toPlane = find(at, (s) => here(s) && s.z === hole.r && s.mode === 0)
      const toDepth = toPlane < 0 ? -1 : find(toPlane + 1, (s) => here(s) && s.z === hole.z && s.mode === 1 && s.feed === hole.f)
      const back = toDepth < 0 ? -1 : find(toDepth + 1, (s) => here(s) && s.z === level && s.mode === 0)
      if (toPlane < 0) say(`the hole of line ${hole.line} (X${hole.x} Y${hole.y}) is not reached at the R plane Z${hole.r} at rapid`)
      else if (toDepth < 0) say(`the hole of line ${hole.line} (X${hole.x} Y${hole.y}) is not drilled to Z${hole.z} at feed F${hole.f}`)
      else if (back < 0) say(`the hole of line ${hole.line} (X${hole.x} Y${hole.y}) is not left at rapid to the initial level Z${level}`)
      if (back < 0) break
      at = back + 1
      holes++
    }
    const last = run[run.length - 1]
    const end = states[k - 1]
    if (end && (end.x !== last.x || end.y !== last.y || end.z !== level)) say(`the cycle blocks of line ${run[0].line} end at X${end.x} Y${end.y} Z${end.z}, not at the last hole at the initial level`)
    j = k
  }
  if (problems.length === 0 && j !== after.length) say(`the result has ${after.length - j} more lines than the program accounts for`)
  return { problems, holes }
}

/**
 * The totals of a program of `m3-common.largeProgram`'s kind, worked out from its text the way Statistics and Time must: the start of the
 * program's first move of an axis is not known (the move is not timed), a `G1` is timed at its `F`, a `G0` has a length only. Floating point,
 * so a comparison with the script's two-decimal table allows a small tolerance.
 * @param {string} text CRLF or LF
 * @returns {{ feedLength: number, rapidLength: number, feedTime: number, notEstimated: number }}
 */
export function largeProgramTotals(text) {
  let x = /** @type {number | null} */ (null)
  let y = /** @type {number | null} */ (null)
  let z = /** @type {number | null} */ (null)
  let mode = /** @type {number | null} */ (null)
  let feed = /** @type {number | null} */ (null)
  let feedLength = 0
  let rapidLength = 0
  let feedTime = 0
  let notEstimated = 0
  for (const raw of text.split(/\r?\n/)) {
    const code = raw.replace(/\([^)]*\)/g, '')
    const g = /(?<![A-Z0-9])G0?([01])(?!\d)/.exec(code)
    if (g) mode = Number(g[1])
    /** @param {string} letter */
    const word = (letter) => {
      const found = new RegExp(`(?<![A-Z0-9])${letter}(-?\\d*\\.?\\d+)`).exec(code)
      return found ? Number(found[1]) : null
    }
    feed = word('F') ?? feed
    const wx = word('X')
    const wy = word('Y')
    const wz = word('Z')
    if (wx === null && wy === null && wz === null) continue
    const known = (wx === null || x !== null) && (wy === null || y !== null) && (wz === null || z !== null)
    if (known) {
      const length = Math.hypot((wx ?? x ?? 0) - (x ?? 0), (wy ?? y ?? 0) - (y ?? 0), (wz ?? z ?? 0) - (z ?? 0))
      if (mode === 1 && feed !== null) {
        feedLength += length
        feedTime += (length / feed) * 60
      } else if (mode === 0) rapidLength += length
    } else notEstimated++
    x = wx ?? x
    y = wy ?? y
    z = wz ?? z
  }
  return { feedLength, rapidLength, feedTime, notEstimated }
}

// ---------------------------------------------------------------- the CSV and the table of Statistics and Time

/**
 * A time in seconds as the table shows it (`1:15.3`, `1:02:03.4` past an hour) from the CSV's one decimal; the CSV and the
 * table both round the same exact value to 0.1 s, so the one is the other's text.
 * @param {string} csvCell `72.9` or `not set`
 */
export function clock(csvCell) {
  if (!/^\d+\.\d$/.test(csvCell)) return csvCell
  const [whole, tenth] = csvCell.split('.')
  const seconds = Number(whole)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const two = (/** @type {number} */ n) => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${two(minutes % 60)}:${two(seconds % 60)}.${tenth}` : `${minutes}:${two(seconds % 60)}.${tenth}`
}

/**
 * Splits CSV text the way the script writes it: LF, a cell in double quotes when it holds a comma.
 * @param {string} csv
 * @returns {string[][]}
 */
export function csvRows(csv) {
  return csv
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      /** @type {string[]} */
      const cells = []
      let cell = ''
      let quoted = false
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (quoted) {
          if (ch === '"' && line[i + 1] === '"') {
            cell += '"'
            i++
          } else if (ch === '"') quoted = false
          else cell += ch
        } else if (ch === '"') quoted = true
        else if (ch === ',') {
          cells.push(cell)
          cell = ''
        } else cell += ch
      }
      cells.push(cell)
      return cells
    })
}

