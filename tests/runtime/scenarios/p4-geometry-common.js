// Helpers the P4a geometry scenarios share (`p4-geometry`, `p4-perf`). This file registers no scenario:
// `loadScenarios()` imports it like any other file under `scenarios/` and finds nothing new in it.
//
// Four things are worth knowing before reading a check that uses these:
//
//   1. **A script is started the way a user starts it: from the Tools tab.** The three geometry scripts
//      are built-in scripts (B1 A9), so their buttons are on the Tools tab in the group "Built-in Scripts".
//      `runGeometry` clicks the button, fills the form that opens, clicks OK and waits for the run to end.
//      The run is told by `scripts.running` going up and down (a subscription, so a run too short for a
//      poll is still seen), never by a wait of a fixed length. The form is filled through the field ids
//      the golden README pins (`tests/fixtures/scripts/README.md`, "The forms"), and a number or a choice
//      the golden's `params.json` leaves out gets the form's default, so a value the app remembered from
//      the run before cannot leak into this one.
//   2. **Every expected text comes from a golden** (`tests/fixtures/scripts/{translate,rotate,mirror}/<case>`):
//      the program is `input.nc` copied byte for byte, the result is `expected.nc` byte for byte, the message
//      and the findings are `envelope.json`'s, a refused run is `refused.json`'s. Nothing NC is typed here.
//      The one exception is the 300,000-line program of `p4-perf`, whose answer is worked out from its own
//      text by `wantedLine` (a shift, a turn by 90 degrees, a mirror about a line), never by running the
//      script and calling the output right. Its second program, the arc-heavy one (`arcProgram`), is turned by 30
//      degrees and mirrored about a line at 30 degrees; `wantedArcLine` works those out from the line's own words
//      with the formulas of the rotation and the reflection, rounded to the four places the program is written
//      in, and `nearDifferences` compares with a tolerance of one last place (a value on the edge of a rounding
//      may fall either way).
//   3. **The Results panel shows what the app keeps of a finding**: its line, its severity and its text
//      (`m8-common.findings`). The finding's `reason` id is in the script's envelope and in the golden, not
//      on the screen; the first refused block is therefore held to its line and its words.
//   4. **A run with nothing to list clears its own report.** `app/scripts.ts` publishes no report when the
//      envelope has no finding, so "no rows" is the expected answer for a clean run (the rotation by 90
//      degrees of the golden), and a check for it reads the panel, not the store.

import { setInput } from './m2-common.js'
import { context } from './m3-common.js'
import { message, ribbonTab } from './m4-common.js'
import { read, scriptService } from './m5-common.js'
import { findings as screenFindings, goldenFindings, openCaseAs, scriptCase, summaryIs } from './m8-common.js'
import { fieldIds, outsideComments, splitLines } from './m10-common.js'

export { context, goldenFindings, message, read, ribbonTab, scriptCase, scriptService, screenFindings, summaryIs, splitLines, fieldIds }

/** @typedef {import('../lib/api.js').Harness} Harness */

/** The three scripts P4a adds to the bundle (their `name` headers are Translate, Rotate and Mirror). */
export const GEOMETRY = {
  translate: 'bundled:translate.py',
  rotate: 'bundled:rotate.py',
  mirror: 'bundled:mirror.py',
}

/** The form ids of every script, in the order of its `[[params]]` (the golden README's table and the script headers). */
export const FORM_IDS = {
  translate: ['dx', 'dy', 'dz', 'decimals'],
  rotate: ['cx', 'cy', 'angle', 'decimals'],
  mirror: ['about', 'px', 'py', 'angle', 'z0', 'decimals'],
}

/**
 * The choices of every choice field, in the order of the header's `choices` list. The options of a choice
 * control carry their index as their value (`FormRenderer.svelte`), so a golden's `"about": "y-axis"` is
 * found here and picked by its place.
 * @type {Record<string, Record<string, string[]>>}
 */
export const CHOICES = {
  translate: { decimals: ['keep'] },
  rotate: { decimals: ['keep', '3', '4'] },
  mirror: { about: ['auto', 'y-axis', 'x-axis', 'line', 'z'], decimals: ['keep', '3', '4'] },
}

/**
 * What the form holds when a golden leaves a field out: the `default` of the header. `angle` of rotate has
 * none (it is `required`), so a golden for rotate always names it.
 * @type {Record<string, Record<string, string | number>>}
 */
export const DEFAULTS = {
  translate: { dx: 0, dy: 0, dz: 0, decimals: 'keep' },
  rotate: { cx: 0, cy: 0, decimals: 'keep' },
  mirror: { about: 'auto', px: 0, py: 0, angle: 0, z0: 0, decimals: 'keep' },
}

/**
 * The name of a script (`translate`) from its id (`bundled:translate.py`).
 * @param {string} scriptId
 * @returns {'translate' | 'rotate' | 'mirror'}
 */
export function nameOf(scriptId) {
  const found = /** @type {'translate' | 'rotate' | 'mirror' | undefined} */ (Object.entries(GEOMETRY).find(([, id]) => id === scriptId)?.[0])
  if (!found) throw new Error(`${scriptId} is not a geometry script`)
  return found
}

// ---------------------------------------------------------------- the goldens

/**
 * @typedef {object} GeometryGolden
 * @property {import('./m8-common.js').ScriptCase} c the case folder, read (`input.nc`, `expected.nc`, `envelope.json`, `params.json`, `case.json`)
 * @property {{ message: string, findings: any[] } | null} refused `refused.json` of a refused run, else null
 * @property {string} profile the profile the case runs under (`case.json`'s `profile`, else the Fanuc mill)
 */

/**
 * `tests/fixtures/scripts/<script>/<name>`, copied into the run folder and read.
 * @param {Harness} h
 * @param {string} script `translate`, `rotate` or `mirror`
 * @param {string} name the case folder
 * @returns {Promise<GeometryGolden>}
 */
export async function geometryGolden(h, script, name) {
  const c = await scriptCase(h, `${script}/${name}`)
  const refusedText = await h.disk.read(`${c.dir}/refused.json`).catch(() => null)
  return { c, refused: refusedText === null ? null : JSON.parse(refusedText), profile: typeof c.options.profile === 'string' ? c.options.profile : 'fanuc-gcode' }
}

/**
 * Opens a golden's `input.nc` byte for byte as `<fileName>` in the run folder, under the profile the case
 * names (a short synthetic program is not always detected as the dialect it is written for, so the profile
 * is set when detection disagrees, as `m9-common.openProbe` does).
 * @param {Harness} h
 * @param {GeometryGolden} golden
 * @param {string} fileName
 * @returns {Promise<{ id: string, detected: boolean }>}
 */
export async function openGolden(h, golden, fileName) {
  const ctx = context(h)
  const opened = await openCaseAs(h, golden.c, fileName)
  const detected = ctx.docs.get(opened.id)?.profileId === golden.profile
  if (!detected) {
    ctx.files.setProfile(opened.id, golden.profile)
    await h.idle()
  }
  return { id: opened.id, detected }
}

// ---------------------------------------------------------------- the form

/**
 * Fills the form that is open: every field of the script, from `values` over the header's defaults.
 * @param {Harness} h
 * @param {'translate' | 'rotate' | 'mirror'} script
 * @param {Record<string, unknown>} values the golden's `params.json`
 */
export function fillGeometryForm(h, script, values) {
  /** @type {Record<string, unknown>} */
  const all = { ...DEFAULTS[script], ...values }
  for (const field of FORM_IDS[script]) {
    if (!(field in all)) throw new Error(`${script}: no value for the field ${field}; the golden gives ${JSON.stringify(Object.keys(values))}`)
  }
  for (const [field, value] of Object.entries(all)) {
    const wrapper = h.q('form-field', { field })
    if (!wrapper) throw new Error(`${script}: the form has no field ${JSON.stringify(field)}; it has ${fieldIds(h).join(', ')}`)
    const control = /** @type {HTMLInputElement | HTMLSelectElement | null} */ (wrapper.querySelector('input, select, textarea'))
    if (!control) throw new Error(`${script}: field ${field} has no control`)
    if (control instanceof HTMLSelectElement) {
      const index = (CHOICES[script][field] ?? []).indexOf(String(value))
      if (index < 0) throw new Error(`${script}: field ${field} has no choice ${JSON.stringify(value)}; the header lists ${JSON.stringify(CHOICES[script][field])}`)
      h.select(control, String(index))
    } else {
      setInput(control, String(value))
    }
  }
}

/**
 * The value a number field of the open form shows, or null when it is empty.
 * @param {Harness} h
 * @param {string} field
 * @returns {number | null}
 */
export function fieldNumber(h, field) {
  const control = /** @type {HTMLInputElement | null} */ (h.q('form-field', { field })?.querySelector('input'))
  const text = (control?.value ?? '').trim()
  return text === '' ? null : Number(text.replace(',', '.'))
}

/**
 * The label of the option a choice field of the open form shows.
 * @param {Harness} h
 * @param {string} field
 */
export function fieldChoice(h, field) {
  const control = /** @type {HTMLSelectElement | null} */ (h.q('form-field', { field })?.querySelector('select'))
  return control?.selectedOptions[0]?.textContent?.trim() ?? ''
}

// ---------------------------------------------------------------- running

/**
 * @typedef {object} GeometryRun
 * @property {string[]} fields the field ids the form showed
 * @property {number} ms from the click on OK until the run has ended and its result is applied and drawn
 * @property {string} status the status line at the end
 */

/**
 * Runs a geometry script from the Tools tab: the button of the group "Built-in Scripts", the form, OK.
 * Waits until the run has ended (see point 1 of the header) and the editor has settled.
 *
 * `inspect` is called with the form open and before it is filled, for a check of what the user first sees.
 * @param {Harness} h
 * @param {string} scriptId
 * @param {Record<string, unknown>} values the form's values (the golden's `params.json`)
 * @param {{ timeout?: number, inspect?: (fields: string[]) => void }} [o] timeout: ms to wait for the run to end, from OK
 * @returns {Promise<GeometryRun>}
 */
export async function runGeometry(h, scriptId, values, o = {}) {
  const script = nameOf(scriptId)
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
    o.inspect?.(fields)
    fillGeometryForm(h, script, values)
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
    await h.idle({ timeout: 120000 })
    const ms = Math.round(performance.now() - at)
    return { fields, ms, status: message(h) }
  } finally {
    stop()
  }
}

/**
 * Stops the script that is running, if one is, and waits until it has ended.
 * @param {Harness} h
 */
export async function stopRun(h) {
  const running = () => read(scriptService(h).running) !== null
  if (!running()) return
  await context(h).commands.run('script.cancel')
  await h.waitFor(() => !running(), { timeout: 20000, interval: 50 })
  await h.idle()
}

// ---------------------------------------------------------------- the large program

/** The pattern of a word `letter` followed by a number, outside a longer name. @param {string} letter */
const wordPattern = (letter) => new RegExp(`(?<![A-Za-z0-9_])${letter}([+-]?\\d+(?:\\.\\d*)?)`, 'g')

/** A number as a word writes it for a comparison by value: six places at most, no trailing zeros, no minus zero. @param {number} value */
const plain = (value) => {
  const rounded = Math.round(value * 1e6) / 1e6
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

/**
 * The line the transform should give, for a line of `p4-perf`'s program (`m3-common.largeProgram`: G90, millimetres, XY
 * plane, words with a decimal point, X and Y always together on a line that has either). Written as a plain
 * number, so a comparison goes by value (`m10-common.differences`).
 * @param {'translate' | 'rotate' | 'mirror'} script
 * @param {string} line
 * @returns {string}
 */
export function wantedLine(script, line) {
  return outsideComments(line, 'paren', (code) => {
    if (script === 'translate') {
      return code
        .replace(wordPattern('X'), (_all, n) => `X${plain(Number(n) + TRANSLATE.dx)}`)
        .replace(wordPattern('Y'), (_all, n) => `Y${plain(Number(n) + TRANSLATE.dy)}`)
        .replace(wordPattern('Z'), (_all, n) => `Z${plain(Number(n) + TRANSLATE.dz)}`)
    }
    if (script === 'mirror') {
      // In X about the line X = MIRROR.px: X' = 2 px - X; Y and Z stay.
      return code.replace(wordPattern('X'), (_all, n) => `X${plain(2 * MIRROR.px - Number(n))}`)
    }
    // Rotation by 90 degrees counter-clockwise about X0 Y0: X' = -Y, Y' = X. A line with only one of the two does not exist in the program.
    const x = new RegExp(wordPattern('X').source).exec(code)
    const y = new RegExp(wordPattern('Y').source).exec(code)
    if (!x || !y) return code
    const xv = Number(x[1])
    const yv = Number(y[1])
    return code.replace(wordPattern('X'), () => `X${plain(-yv)}`).replace(wordPattern('Y'), () => `Y${plain(xv)}`)
  })
}

/** The form values of the large-program runs. The shifts, the centre and the line are whole numbers, so every result is exact. */
export const TRANSLATE = { dx: 10, dy: 10, dz: 10 }
export const ROTATE = { cx: 0, cy: 0, angle: 90 }
export const MIRROR = { about: 'y-axis', px: 50 }

// ---------------------------------------------------------------- the arc-heavy program and the angled transforms

/** The form values of the angled runs: a turn by 30 degrees about X12.5 Y-7.5, a mirror about the line through X5 Y-3 at 30 degrees. */
export const ROTATE_ANGLED = { cx: 12.5, cy: -7.5, angle: 30 }
export const MIRROR_ANGLED = { about: 'line', px: 5, py: -3, angle: 30 }

/** A coordinate as the program writes it: four places, no minus zero. @param {number} value */
const fixed4 = (value) => (Math.abs(value) < 0.00005 ? 0 : value).toFixed(4)

/**
 * An arc-heavy synthetic program: rings of 48 arcs each (7.5 degrees apart, a ring counter-clockwise `G3` or clockwise
 * `G2` by turns, radius 8 to 28 about a centre that moves from ring to ring), every ring entered by a `G1` to its start
 * point and a `G1 Z` change. Every coordinate and every centre vector is written with four decimals and a point, `I` and `J` always
 * together (the centre is relative to the start of the arc, as the Fanuc profile reads it, worked out from the start as
 * written, so every arc is consistent to the fourth place). Same head and tail as `m3-common.largeProgram` apart from the name. Rounded
 * to the places it is written in, so a turn by an angle that is not a multiple of 90 degrees rounds back to the same four places
 * without the arc check refusing it. About 95 of 100 lines are arcs or moves in XY.
 * @param {{ lines?: number }} [o]
 * @returns {string} CRLF line ends, as `largeProgram`
 */
export function arcProgram({ lines: minLines = 300000 } = {}) {
  const head = ['%', 'O9002 (ARCS 300K)', 'G21 G17 G40 G49 G80 G90 G94', 'T1 M6', 'S3000 M3', 'G0 X20.0000 Y0.0000', 'G43 Z25. H1 M8', 'G1 Z-1. F200.']
  const tail = ['G0 Z25.', 'M30', '%']
  const out = [...head]
  /** @param {number} value */
  const round4 = (value) => Math.round(value * 1e4) / 1e4
  // The last ring is cut short when the program reaches its length; a ring's two entry lines may overshoot it by one.
  for (let ring = 0; out.length < minLines - tail.length; ring++) {
    const centreX = (ring % 7) * 3
    const centreY = (ring % 5) * 2
    const radius = 8 + (ring % 9) * 2.5
    const sign = ring % 2 === 0 ? 1 : -1
    const word = sign > 0 ? 'G3' : 'G2'
    out.push(`G1 Z${fixed4(-1 - (ring % 4) * 0.5)} F200.`)
    let x = round4(centreX + radius)
    let y = round4(centreY)
    out.push(`G1 X${fixed4(x)} Y${fixed4(y)} F800.`)
    for (let step = 1; step <= 48 && out.length < minLines - tail.length; step++) {
      const angle = (sign * step * 7.5 * Math.PI) / 180
      const ex = round4(centreX + radius * Math.cos(angle))
      const ey = round4(centreY + radius * Math.sin(angle))
      out.push(`${word} X${fixed4(ex)} Y${fixed4(ey)} I${fixed4(round4(centreX - x))} J${fixed4(round4(centreY - y))} F800.`)
      x = ex
      y = ey
    }
  }
  out.push(...tail)
  return out.join('\r\n') + '\r\n'
}

/**
 * The line an angled rotation or an angled mirror should give, for a line of `arcProgram`: points are turned (or reflected)
 * as points, the centre vector `I`, `J` as a vector (no centre, no shift), `G2` and `G3` swap under a mirror, and a line
 * without X and Y both stays as it is. Rounded to four places and written as a plain number, so a comparison goes by value.
 * Worked out from the formulas alone; no script runs.
 * @param {'rotate' | 'mirror'} script
 * @param {string} line
 * @param {{ cx?: number, cy?: number, px?: number, py?: number, angle: number }} v the form values of the run
 * @returns {string}
 */
export function wantedArcLine(script, line, v) {
  return outsideComments(line, 'paren', (code) => {
    const number = (/** @type {string} */ letter) => {
      const found = new RegExp(wordPattern(letter).source).exec(code)
      return found ? Number(found[1]) : null
    }
    const x = number('X')
    const y = number('Y')
    const i = number('I')
    const j = number('J')
    const round4 = (/** @type {number} */ value) => plain(Math.round(value * 1e4) / 1e4)
    const theta = (v.angle * Math.PI) / 180
    /** @type {(a: number, b: number) => [number, number]} */
    let point
    /** @type {(a: number, b: number) => [number, number]} */
    let vector
    if (script === 'rotate') {
      const [c, s] = [Math.cos(theta), Math.sin(theta)]
      const [cx, cy] = [v.cx ?? 0, v.cy ?? 0]
      vector = (a, b) => [a * c - b * s, a * s + b * c]
      point = (a, b) => {
        const [da, db] = vector(a - cx, b - cy)
        return [cx + da, cy + db]
      }
    } else {
      // A reflection about the line through (px, py) at the angle: the matrix of 2 theta.
      const [c, s] = [Math.cos(2 * theta), Math.sin(2 * theta)]
      const [px, py] = [v.px ?? 0, v.py ?? 0]
      vector = (a, b) => [a * c + b * s, a * s - b * c]
      point = (a, b) => {
        const [da, db] = vector(a - px, b - py)
        return [px + da, py + db]
      }
    }
    let result = code
    if (x !== null && y !== null) {
      const [nx, ny] = point(x, y)
      result = result.replace(wordPattern('X'), () => `X${round4(nx)}`).replace(wordPattern('Y'), () => `Y${round4(ny)}`)
    }
    if (i !== null && j !== null) {
      const [ni, nj] = vector(i, j)
      result = result.replace(wordPattern('I'), () => `I${round4(ni)}`).replace(wordPattern('J'), () => `J${round4(nj)}`)
    }
    if (script === 'mirror') result = result.replace(/(?<![A-Za-z0-9_.])G([23])(?!\d)/g, (_all, n) => `G${n === '2' ? '3' : '2'}`)
    return result
  })
}

const NUMBERS = /[+-]?\d+(?:\.\d*)?|\.\d+/g

/**
 * Compares a document with the lines it should hold, for an angled run whose numbers are rounded: a line the
 * transform leaves as it was must be the same bytes, a changed line must have the same words and each number within
 * `tolerance` of the wanted one (one last place, 0.0001: a value on the edge of a rounding falls either way). Answers
 * the lines that differ and how many numbers were off by the rounding edge (so the comparison cannot hide a pattern).
 * @param {string[]} before
 * @param {string[]} after
 * @param {string[]} wanted
 * @param {number} [tolerance]
 * @returns {{ wrong: { line: number, was: string, got: string, want: string }[], edge: number }}
 */
export function nearDifferences(before, after, wanted, tolerance = 0.0001 + 1e-9) {
  /** @type {{ line: number, was: string, got: string, want: string }[]} */
  const wrong = []
  let edge = 0
  const count = Math.max(before.length, after.length, wanted.length)
  for (let k = 0; k < count; k++) {
    const was = before[k] ?? '(missing)'
    const got = after[k] ?? '(missing)'
    const want = wanted[k] ?? '(missing)'
    if (got === want) continue
    let same = false
    if (want !== was) {
      const g = got.match(NUMBERS) ?? []
      const w = want.match(NUMBERS) ?? []
      if (g.length === w.length && got.replace(NUMBERS, '#') === want.replace(NUMBERS, '#')) {
        const off = g.map((n, m) => Math.abs(Number(n) - Number(w[m])))
        same = off.every((d) => d <= tolerance)
        if (same && off.some((d) => d > 1e-6)) edge += off.filter((d) => d > 1e-6).length
      }
    }
    if (!same) wrong.push({ line: k + 1, was, got, want })
  }
  return { wrong, edge }
}
