// P4b, "Drilling cycles and time", the second scenario: Statistics and Time and the limits rows of the program checks (plan
// docs/planning/phase-4-implementation.md, H4b; X24 and the check half of X25 as the running app proves them). Expand
// Drilling Cycles is `p4-cycles`; the Motion and limits page is `p4-machines`.
//
//   A. Fanuc, a machine    `statistics/fanuc-mill-g81-g83`: every field of the form starts from the machine's motion block, the run
//                          opens a new document with the golden's CSV and the golden's findings, the program is untouched; then the
//                          same program as a table (the default output)
//   B. Klartext            `statistics/klartext-cycl-call`: no machine page for Klartext, so the values are typed; the golden's CSV
//   C. The form left empty `statistics/fanuc-no-motion`: no machine, nothing typed: the lengths and the feed time, every value a
//                          time needs said as "not set" with one finding each
//   D. The limits rows     `program_checks/limits-fanuc-mill` and `limits-absent`: with a machine that has limits the "Spindle speed
//                          limit" and "Travel" rows of the Results panel are the golden's; with a machine that has none, and with
//                          no machine, there are none
//
// **Everything is started from the Tools tab.** **Every expected answer is a golden**: the program is `input.nc` byte for byte, the
// new document is `expected.csv` byte for byte, the message and findings are `envelope.json`'s (before the machine sentence where
// a machine is chosen: the goldens name none), the check rows are the report golden's `expected.json`. The table of section A is
// not a golden of its own; it is worked out from the CSV golden by the layout rules of the script (a clock for a time, two blanks
// between columns), never from what the script wrote.
//
// A section that throws is one failed check (`m10-common.guard`) and does not take the others down.

import { scenario } from '../lib/index.js'
import { guard, ready, runFromTools, storeRows } from './m10-common.js'
import { pythonProbe, showPanel } from './m5-common.js'
import { reportRows, scriptCase, openCaseAs } from './m8-common.js'
import {
  CYCLE_SCRIPTS,
  TIME_FIELDS,
  activeText,
  beforeMachineSentence,
  clock,
  context,
  csvRows,
  firstDifference,
  goldenFindings,
  makeMill,
  openStatistics,
  read,
  runTools,
  screenFindings,
  statisticsGolden,
  useMachine,
} from './p4-cycles-common.js'

/** @typedef {import('./p4-cycles-common.js').ToolsRun} ToolsRun */

/** The golden's form values as the motion block of a machine: what `fanuc-mill-g81-g83/params.json` types, stored in the page's shape. */
const MILL_MOTION = {
  units: 'mm',
  rapid: { X: 30000, Y: 30000, Z: 20000 },
  rapidKind: 'straight',
  maxFeed: 5000,
  toolChange: 4,
  peckRetract: 0.5,
  peckClearance: 1,
}

/** The limits of `program_checks/limits-fanuc-mill/case.json`, stored as the page stores them. */
const MILL_LIMITS = { units: 'mm', spindle: { main: 10000 }, travel: { X: { min: -800, max: 0 }, Y: { min: -500, max: 0 }, Z: { min: -600, max: 0 } } }

scenario('p4-cycles-time', { timeout: 900 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const probe = await pythonProbe(h)
  h.check('the Python probe has answered, so the scripts can run', probe?.ok === true, probe)

  /**
   * One run of Statistics and Time on a golden's program, the new document's text and the golden's findings.
   * @param {string} label
   * @param {Awaited<ReturnType<typeof statisticsGolden>>} golden
   * @param {string} file
   * @param {{ machine?: { label: string, id: string }, values?: Record<string, unknown>, inspect?: (shown: Record<string, string>) => void }} [o] `values` default to the golden's `params.json`
   */
  const estimates = async (label, golden, file, o = {}) => {
    const opened = await openStatistics(h, golden, file)
    const source = opened.id
    if (o.machine) await useMachine(h, o.machine.label, o.machine.id)
    const docsBefore = ctx.docs.getActiveId()
    h.check(`${label}: the golden program is open as ${golden.profile}, byte for byte, and not changed`, ctx.docs.get(source)?.profileId === golden.profile && h.app.text() === golden.input && ctx.docs.get(source)?.dirty !== true, { profile: ctx.docs.get(source)?.profileId })
    const run = await runTools(h, CYCLE_SCRIPTS.time, o.values ?? golden.params, { inspect: o.inspect })
    h.check(`${label}: the form has the thirteen fields of the header, in order`, JSON.stringify(run.fields) === JSON.stringify(TIME_FIELDS), run.fields)
    const made = await activeText(h)
    h.check(`${label}: a new document opened and took the focus, untitled, in the program's dialect`, made.id !== source && made.id !== docsBefore && ctx.docs.get(made.id)?.path === null && ctx.docs.get(made.id)?.profileId === golden.profile, { id: made.id, source, path: ctx.docs.get(made.id)?.path, profile: ctx.docs.get(made.id)?.profileId })
    h.check(`${label}: the program itself is the same bytes and was not marked as changed`, ctx.editor.getLines(source, 1, ctx.editor.getLineCount(source)).join('\n') === golden.input && ctx.docs.get(source)?.dirty !== true, { dirty: ctx.docs.get(source)?.dirty })
    const wantMessage = o.machine ? beforeMachineSentence(golden.envelope.message) : golden.envelope.message
    h.check(`${label}: the status line carries the golden's message${o.machine ? ' (up to the machine sentence)' : ''}`, o.machine ? run.status.includes(wantMessage) : run.status.endsWith(wantMessage), { got: run.status, want: wantMessage })
    const want = goldenFindings(golden.envelope.findings)
    const shown = screenFindings(h)
    h.check(`${label}: the Results panel holds the golden's ${want.length} finding${want.length === 1 ? '' : 's'}, in order, and nothing else`, JSON.stringify(shown) === JSON.stringify(want), { got: shown, want })
    h.log(`${label}: ${run.ms} ms`)
    return { source, made, run }
  }

  // =============================================================== A. Fanuc, the form from the machine
  await guard(h, 'A. Fanuc with a machine', async () => {
    const mill = await makeMill(h, 'Mill 1', { motion: MILL_MOTION })
    const golden = await statisticsGolden(h, 'fanuc-mill-g81-g83')
    const typed = { format: 'csv' }
    const { source, made } = await estimates('Fanuc G81 and G83, the form from the machine', golden, 'p4-stat-fanuc.nc', {
      machine: { label: 'Mill 1', id: mill },
      values: typed,
      inspect: (shown) => {
        /** @type {Record<string, string>} */
        const want = { peckRetract: '0.5', peckClearance: '1', motionUnits: 'mm', rapidX: '30000', rapidY: '30000', rapidZ: '20000', rapidA: '', rapidB: '', rapidC: '', rapidKind: 'Straight', maxFeed: '5000', toolChange: '4', format: 'Table' }
        h.check('A: every field starts from the machine: the peck values, the units, the three rapid rates, straight rapids, the top feed and the tool change; the axes the machine has no rate for and the output format keep their own start', JSON.stringify(shown) === JSON.stringify(want), { got: shown, want })
        /** The golden's values, as the machine states them. */
        const asStated = { peckRetract: 0.5, peckClearance: 1, motionUnits: 'mm', rapidX: 30000, rapidY: 30000, rapidZ: 20000, rapidKind: 'straight', maxFeed: 5000, toolChange: 4, format: 'csv' }
        h.check('A: the golden types exactly the machine\u2019s values (and the output format), so typing the format alone gives the golden\u2019s answer', JSON.stringify(Object.entries(golden.params).sort()) === JSON.stringify(Object.entries(asStated).sort()), { params: golden.params })
      },
    })
    h.check('A: the new document is expected.csv, byte for byte', made.text === golden.csv, { diff: firstDifference(made.text, golden.csv) })

    // The same program, the default output: a table. Worked out from the CSV by the layout rules.
    ctx.docs.activate(source)
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === source, { timeout: 8000 })
    const second = await runTools(h, CYCLE_SCRIPTS.time, { format: 'table' }, {
      inspect: (shown) => {
        h.check('A: a second run on the same machine shows the machine\u2019s values again', shown.rapidX === '30000' && shown.maxFeed === '5000' && shown.peckRetract === '0.5', shown)
      },
    })
    const table = await activeText(h)
    h.check('A: the table opened as another new document', table.id !== source && table.id !== made.id && ctx.docs.get(table.id)?.path === null, { id: table.id })
    const rows = csvRows(golden.csv)
    const header = rows[0].map((cell) => cell.replace(/ \(s\)$/, ''))
    const wantRows = rows.slice(1).map((cells) => [cells[0], cells[1], cells[2], cells[3], clock(cells[4]), clock(cells[5]), clock(cells[6]), clock(cells[7]), clock(cells[8]), cells[9], cells[10]])
    const lines = table.text.split('\n')
    /** @param {string} line */
    const cellsOf = (line) => {
      const parts = line.trim().split(/ {2,}/)
      return parts
    }
    const tableHeader = cellsOf(lines[0] ?? '')
    const rule = cellsOf(lines[1] ?? '')
    const body = lines.slice(2, 2 + wantRows.length).map(cellsOf)
    const bound = (golden.envelope.message.match(/The estimate is a lower bound: .*?look-ahead\./) ?? [''])[0]
    h.check('A: the table has the header of the CSV (the times without the unit), a rule of dashes under it, a row per tool and a Total, then a blank line and the lower-bound sentence', JSON.stringify(tableHeader) === JSON.stringify(header) && rule.length === header.length && rule.every((cell) => /^-+$/.test(cell)) && lines[2 + wantRows.length] === '' && lines[3 + wantRows.length] === bound, { header: tableHeader, rule, tail: lines.slice(2 + wantRows.length), bound })
    h.check('A: every row is the CSV row with its times as clocks (1:45.3), the empty last cell dropped', body.every((cells, i) => JSON.stringify(cells) === JSON.stringify(wantRows[i].filter((cell, k) => k < wantRows[i].length - 1 || cell !== ''))), { got: body, want: wantRows })
    h.check('A: the status line carries the same message', second.status.includes(beforeMachineSentence(golden.envelope.message)), { got: second.status })
    h.check('A: the Total row’s clocks are the ones of the golden’s message', (() => {
      const total = wantRows[wantRows.length - 1]
      const said = /Estimated time (\S+) for \d+ tools?: feed (\S+), rapid (\S+), dwell (\S+), tool changes (\S+)\./.exec(golden.envelope.message)
      return said !== null && said[1] === total[8] && said[2] === total[4] && said[3] === total[5] && said[4] === total[6] && said[5] === total[7]
    })(), { want: wantRows[wantRows.length - 1], message: golden.envelope.message })
  })

  // =============================================================== B. Klartext, the values typed
  await guard(h, 'B. Klartext', async () => {
    const golden = await statisticsGolden(h, 'klartext-cycl-call')
    const { made } = await estimates('Klartext cycle 200 by CYCL CALL', golden, 'p4-stat-klartext.h', {
      inspect: (shown) => {
        h.check('B: Klartext has no machine page, so every field but the output format starts empty (the format is the one value the form remembers)', Object.entries(shown).every(([field, value]) => field === 'format' || value === ''), shown)
      },
    })
    h.check('B: the new document is expected.csv, byte for byte', made.text === golden.csv, { diff: firstDifference(made.text, golden.csv) })
  })

  // =============================================================== C. the form left empty
  await guard(h, 'C. the form left empty', async () => {
    const golden = await statisticsGolden(h, 'fanuc-no-motion')
    const { made } = await estimates('Fanuc with no machine and an empty form', golden, 'p4-stat-nomotion.nc', {
      inspect: (shown) => {
        h.check('C: without a machine nothing is prefilled: every field but the output format is empty', Object.entries(shown).every(([field, value]) => field === 'format' || value === ''), shown)
      },
    })
    h.check('C: the new document is expected.csv: the lengths and the feed time, rapid, tool-change and total time "not set"', made.text === golden.csv && /not set/.test(made.text), { diff: firstDifference(made.text, golden.csv) })
  })

  // =============================================================== D. the limits rows of the program checks
  await guard(h, 'D. limits in the program checks', async () => {
    const limited = await makeMill(h, 'Mill limits', { limits: MILL_LIMITS })
    const unlimited = await makeMill(h, 'Mill no limits', { motion: { units: 'mm', toolChange: 4 } })
    const withLimits = await scriptCase(h, 'program_checks/limits-fanuc-mill')
    const silent = await scriptCase(h, 'program_checks/limits-absent')
    const golden = withLimits.report
    /** The programs are written for a mill; where detection disagrees the profile is set, as `openGolden` does. @param {string} id */
    const asFanuc = async (id) => {
      if (ctx.docs.get(id)?.profileId !== 'fanuc-gcode') {
        ctx.files.setProfile(id, 'fanuc-gcode')
        await h.idle()
      }
    }
    const ids = ['speedLimit', 'travelLimit']
    /** The limit rows of the report on show, as the store holds them: `line|check|severity|message`. */
    const limitRows = () => storeRows(h).filter((row) => ids.includes(row.checkId)).map((row) => `${row.line}|${row.check}|${row.severity}|${row.message}`)
    const wanted = golden.rows.map((/** @type {any} */ row) => `${row.line}|${row.check}|${row.severity}|${row.message}`)

    // 1. a machine with limits
    const opened = await openCaseAs(h, withLimits, 'p4-limits.nc')
    await asFanuc(opened.id)
    await useMachine(h, 'Mill limits', limited)
    const run = await runFromTools(h, CYCLE_SCRIPTS.checks, () => {}, 120000)
    h.check('D1: with the machine’s limits the report has the golden’s four limit rows: two "Spindle speed limit" warnings, a warning and an error on the "Travel", in line order', JSON.stringify(limitRows()) === JSON.stringify(wanted) && wanted.length === 4, { got: limitRows(), want: wanted })
    h.check('D1: the head of the report counts them, "4 findings in 2 checks"', /^4 findings in 2 checks\./.test(String(read(ctx.results.current)?.message ?? '')), { message: read(ctx.results.current)?.message, form: run.form })
    await showPanel(h, 'results')
    const onScreen = reportRows(h, ['line', 'check', 'severity', 'message']).filter((row) => /^\d+\|(Spindle speed limit|Travel)\|/.test(row))
    h.check('D1: and the Results panel shows the same four rows, the check named "Spindle speed limit" and "Travel"', JSON.stringify(onScreen) === JSON.stringify(wanted), { got: onScreen, want: wanted })
    h.check('D1: work positions of X that span more than its travel are one warning (no work offset brings them all inside), a position in machine coordinates (G53) outside it an error', storeRows(h).filter((row) => row.checkId === 'travelLimit').map((row) => `${row.line}:${row.severity}`).join(' ') === '12:warning 15:error', storeRows(h).filter((row) => row.checkId === 'travelLimit').map((row) => `${row.line}:${row.severity}`))
    h.check('D1: the document was only read: not changed', ctx.docs.get(opened.id)?.dirty !== true && h.app.text() === withLimits.input)

    // 2. the same program, a machine with no limits, then none: nothing is compared
    await useMachine(h, 'Mill no limits', unlimited)
    await runFromTools(h, CYCLE_SCRIPTS.checks, () => {}, 120000)
    h.check('D2: the same program under a machine with no limits block has no Spindle speed limit and no Travel row', limitRows().length === 0, limitRows())
    await useMachine(h, 'None (dialect defaults)', '')
    await runFromTools(h, CYCLE_SCRIPTS.checks, () => {}, 120000)
    h.check('D2: and with no machine at all there are none either', limitRows().length === 0, limitRows())

    // 3. a program that is far over every limit, under the machine that has none: silent, and it says so
    const quiet = await openCaseAs(h, silent, 'p4-limits-absent.nc')
    await asFanuc(quiet.id)
    await useMachine(h, 'Mill no limits', unlimited)
    await runFromTools(h, CYCLE_SCRIPTS.checks, () => {}, 120000)
    const report = read(ctx.results.current)
    h.check('D3: S90000 and a position at X-5000 under a machine with no limits: no row, and the head says "No findings."', limitRows().length === 0 && String(report?.message ?? '').startsWith('No findings.'), { rows: limitRows(), message: report?.message })
    // The same program with limits is not asked: the golden `limits-absent` is the program without limits by design.
    h.check('D3: this program is the golden of a machine with no limits (the same wording as the golden’s head)', String(silent.report.message).startsWith('No findings.') && silent.report.rows.length === 0, { head: silent.report.message })
  })

  h.log(`status at the end: ${h.q('status-message')?.textContent?.trim()}`)
})
