// X34 for Phase 4 (plan docs/planning/phase-4-implementation.md §2.2 X34, §5 P4a H4a and P4b H4b): the budgets of the new
// features at 300,000 lines. The **first part**, P4a's (section A): Translate, Rotate and Mirror on a 300,000-line
// program (and, for the slow cases, on an arc-heavy one at 30 degrees), each within the 900 s the three scripts allow. The
// **second part**, P4b's (sections B and C): Expand Drilling Cycles on a 300,000-line drilling program and Statistics and Time on the
// simple program, each within the 900 s of its own `# timeout` header. The **third part**, P4e's (sections D, E and F): the two-pane
// features on large programs, the typing budget of P1 with a second pane (split view and the channel view at 300,000 lines) and the
// aligned view of a comparison at 100,000 lines; see the paragraph at the end of this header. The later milestones add their sections
// below (Find in Folder, the bookmark panel); each section is a `guard` of its own so one cannot take another down.
//
// **What the budget is.** The three scripts declare `# timeout = 900` (the owner's decision Q-C of the P4a review: the
// geometry scripts need more than the 300 s of the M10 scripts, and the header wins over `scripts.timeoutSeconds`,
// `runner.rs` `timeout_secs`), so the limit a user meets is 900 s (`SCRIPT_LIMIT_MS`; the story is told in `m10-perf.js`).
// X34 asked 300 s; the plan's row records the change. Two budgets, as `m10-perf` has them:
//
//   - **On the development Mac** (`LOCAL_TARGET_MS`, 450 s, half the limit) a run that creeps toward the limit
//     shows long before a user meets the app's kill. After the optimisation batch (B6) the slowest case (the
//     arc-heavy program mirrored at 30 degrees) takes about 112 s of script time for 300,000 lines at normal
//     priority and about 355 s at background priority; 450 s leaves room for the apply on top and for a Mac that
//     is busy with other work.
//   - **On a hosted runner** `h.checkTime` multiplies every budget by `CI_TIME_FACTOR`, but the app's own limit is
//     not stretched there, so the budget handed to it is the limit divided by that factor and the check means
//     "finished before the app killed it" (900 s). A script the app kills is a failed section (`runGeometry`
//     stops the run and throws), never a slow pass.
//
// **What is run.** The simple program (`m3-common.largeProgram`: straight lines only) with the three scripts as they
// were, and the arc-heavy program (`p4-geometry-common.arcProgram`: 95 of 100 lines are arcs or moves in XY, every
// coordinate and centre vector with four decimals) with the two runs that are slow: Rotate by 30 degrees (not a
// multiple of 90, so every word is rounded and every arc checked a second time) and Mirror about a line at 30 degrees
// (the same, with G2/G3 swapped). Those two were the runs the review found at or over the old limit; the simple
// 90 degree case could not see them. The scenario is not retried by `suite.sh` (`retry: false`): a run is minutes
// long, and a second run of the same cost after a failure that is a regression would only double the job's time.
//
// **Correctness at size.** A budget met by a script that did nothing is no budget. The program is the synthetic
// one of the M3 to M12 perf scenarios (`m3-common.largeProgram`: absolute G90, millimetres, XY plane, every
// word with a decimal point), so the answer is worked out here from the program's own text
// (`p4-geometry-common.wantedLine`: a shift by whole numbers, a turn by 90 degrees, a mirror about the line
// X50) and every line of the document is compared with it (`m10-common.differences`: a line that must not
// change is compared byte for byte, a changed one by its numbers). The angled runs round their words, so their
// answer is worked out from the formulas of the rotation and the reflection (`wantedArcLine`) and compared with the
// tolerance of one last place (`nearDifferences`); the number of words on that edge is logged. The run is one undo
// step, and the one undo brings back the whole program, not the lines on screen.
//
// The Output panel is never opened here: it would draw the 300,000-line result it keeps.
//
// **The P4b part** (the same two budgets: Expand Drilling Cycles and Statistics and Time both declare `# timeout = 900`). Section B
// expands `p4-cycles-common.drillProgram`: 300,000 lines, mostly feed moves, with two holes drilled by `G98 G81` in every twelfth line (about
// 50,000 holes), which the expansion writes out as about 440,000 lines. The answer is not the script's own text: `checkDrillExpansion` holds
// every line that is no cycle block to its place byte for byte, and walks the lines the cycle blocks became to see that the tool, for every
// hole in order, comes to the R plane at rapid, drills to the depth at the cycle's feed and goes back to the initial level at rapid; the
// oracle is held to a recorded pair in `tests/unit/p4bHarness.test.ts`. Section C runs Statistics and Time on the simple program of
// section A with the form typed (the page of a machine would prefill the same values) and compares its Total row with the lengths and the
// feed time worked out from the program's own text (`largeProgramTotals`), to the 0.01 mm and 0.1 s the CSV is written in, plus a small
// tolerance for the sum of 300,000 floating point lengths. Both budgets go through `h.checkTime` like the first part.
//
// **The P4e part** (plan X34 and §5 P4e decision 14: "a second editor pane keeps the typing budget of P1", proved on the runner for the
// WebKit part, each editor's view model, P2 F56; the `*.typing.slow.test.ts` files prove the code's own work). H4e did not write it. Three
// sections, each a `guard`; the budgets and the reasons for each are in `p4e-perf-common.js`:
//   D. Split view: the simple program (300,000 lines) typed on in one editor (the baseline), then Split Editor (the open within the P1 open
//      budget), then 40 characters typed in group 1 while group 2 draws the same lines, in group 1 while group 2 is at the top, and in
//      group 2 while group 1 draws the same lines (each: p95 of the keypress to the frame under 50 ms, no more than one frame over the
//      baseline, the other group drawing the character within the same 50 ms), and, after Close Split, the one editor against the baseline.
//   E. Channel view: a 300,000-line program with two channel sections and 20,000 waits (the program of `m12-perf`), Channels Side by Side
//      (the open within the P1 open budget, the bar saying all 20,000 waits are lined up), 40 characters typed in pane 2 and in pane 1
//      (the same two budgets), and 20 line breaks in pane 2 (the alignment made again for 20,000 waits, p95 within 100 ms).
//   F. The aligned view: two 100,000-line programs that differ in 450 places (150 changed feeds, 150 removed lines, 150 new lines), the
//      view opened (`compare.setMode('aligned')` then `compare.open`: from the call to the blocks drawn on both sides, with the blocks
//      counted against the construction), 40 characters typed in the current document's pane (the typing budget), and the alignment made
//      again after the pause (from the last key to the blocks redrawn).
// The typing is real key presses (`h.nativeKeys`), so like every scenario of the suite these run on the runner and never on the owner's Mac.

import { CI_TIME_FACTOR } from '../lib/api.js'
import { scenario } from '../lib/index.js'
import { largeProgram } from './m3-common.js'
import { canon, differences, guard, openPath, pythonProbe, ready } from './m10-common.js'
import { closeCompare, monacoRegistry } from './m11-common.js'
import { channelMachines, waitChannel } from './m12-common.js'
import { CYCLE_SCRIPTS, activeText, checkDrillExpansion, csvRows, drillProgram, largeProgramTotals, runTools } from './p4-cycles-common.js'
import { GEOMETRY, MIRROR, MIRROR_ANGLED, ROTATE, ROTATE_ANGLED, TRANSLATE, arcProgram, context, message, nearDifferences, runGeometry, splitLines, wantedArcLine, wantedLine } from './p4-geometry-common.js'

import {
  ALIGNED_CHANGES,
  ALIGNED_LINES,
  ALIGNED_OPEN_BUDGET_MS,
  ALIGNED_REALIGN_BUDGET_MS,
  CHANNEL_BLOCK,
  ENTERS,
  ENTER_BUDGET_MS,
  FRAME_MS,
  KEYPRESS_P95_BUDGET_MS,
  KEYSTROKES,
  MAX_RETRIES,
  TYPING_COST_BUDGET_MS,
  VIEW_OPEN_BUDGET_MS,
  alignedPair,
  channelLineAt,
  channelProgram,
  groupsDrawn,
  measureChars,
  measureEnters,
  until,
} from './p4e-perf-common.js'
import { editorOf, groupIds, groupsOnScreen, hostLayout, placeCursor, views, waitGroups } from './p4e-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

/**
 * Whether a line's numbers differ from the line it was: by value, so a result that writes `X50.0000` for an `X50.0000` the
 * transform leaves where it is (x = 50 mirrored about X50) is no change, however the number is written.
 * @param {string} was
 * @param {string} now
 */
const movedBy = (was, now) => was !== now && canon(was) !== canon(now)

/** What the app kills these scripts at: their `# timeout = 900` header (it wins over `scripts.timeoutSeconds`). */
const SCRIPT_LIMIT_MS = 900000
/** The target on the development Mac: half the limit (see the header). */
const LOCAL_TARGET_MS = 450000

const LINES = 300000

/**
 * One run of a script on one of the two programs.
 * @typedef {object} Case
 * @property {'simple' | 'arcs'} program
 * @property {'translate' | 'rotate' | 'mirror'} script
 * @property {Record<string, unknown>} values the form values
 * @property {string} what the sentence of the check
 * @property {(line: string) => string} wanted the line the run should give, worked out from the line alone
 * @property {boolean} rounds the run rounds its words (an angle that is not a multiple of 90): compared to one last place
 */

/** The runs, in the order they are made (the simple program first, then the arc-heavy one). @type {Case[]} */
const CASES = [
  { program: 'simple', script: 'translate', values: TRANSLATE, what: `moves every X, Y and Z by ${TRANSLATE.dx}`, wanted: (line) => wantedLine('translate', line), rounds: false },
  { program: 'simple', script: 'rotate', values: ROTATE, what: `turns the path by ${ROTATE.angle} degrees about X${ROTATE.cx} Y${ROTATE.cy}`, wanted: (line) => wantedLine('rotate', line), rounds: false },
  { program: 'simple', script: 'mirror', values: MIRROR, what: `mirrors every X in X about X${MIRROR.px}`, wanted: (line) => wantedLine('mirror', line), rounds: false },
  {
    program: 'arcs',
    script: 'rotate',
    values: ROTATE_ANGLED,
    what: `turns the path and every arc centre by ${ROTATE_ANGLED.angle} degrees about X${ROTATE_ANGLED.cx} Y${ROTATE_ANGLED.cy}`,
    wanted: (line) => wantedArcLine('rotate', line, ROTATE_ANGLED),
    rounds: true,
  },
  {
    program: 'arcs',
    script: 'mirror',
    values: MIRROR_ANGLED,
    what: `mirrors the path and every arc about the line through X${MIRROR_ANGLED.px} Y${MIRROR_ANGLED.py} at ${MIRROR_ANGLED.angle} degrees, G2 and G3 swapped`,
    wanted: (line) => wantedArcLine('mirror', line, MIRROR_ANGLED),
    rounds: true,
  },
]

// The scenario's own timeout is the worst case: seven runs that the app kills at the limit (900 s plus 30 s to say so), each with a
// minute or two of opening, apply, undo and comparison, and the Python probe (it was 6600 s for the five of the first part), and the
// 1200 s of the P4e part (three programs written and opened, about 400 key presses, two views opened). No retry: see the header.
scenario('p4-perf', { timeout: 9600, retry: false }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const probe = await pythonProbe(h)
  h.check('the Python probe has answered, so the scripts can run', probe?.ok === true, probe)
  // checkTime stretches a budget by CI_TIME_FACTOR on a hosted runner; the app's own limit is not stretched, so the
  // budget handed to it there is the limit divided by that factor (the same arrangement as m10-perf). Locally it is the target.
  const budget = h.cfg.ci ? SCRIPT_LIMIT_MS / CI_TIME_FACTOR : LOCAL_TARGET_MS
  const budgetText = h.cfg.ci ? `the ${SCRIPT_LIMIT_MS / 1000} s the app grants` : `the ${LOCAL_TARGET_MS / 1000} s target, half the ${SCRIPT_LIMIT_MS / 1000} s the app grants`
  // How long the scenario waits for a run to end: the limit, and a little for the app to say it killed the run.
  const wait = SCRIPT_LIMIT_MS + 30000

  /**
   * Writes a program, opens it and checks it is what the section expects; the document is the active one afterwards.
   * @param {'simple' | 'arcs' | 'drill'} program
   */
  async function open(program) {
    const text = program === 'simple' ? largeProgram({ lines: LINES }) : program === 'arcs' ? arcProgram({ lines: LINES }) : drillProgram({ lines: LINES })
    const path = `${h.cfg.run}/p4-perf-${program}-300k.nc`
    await h.disk.write(path, text)
    const opened = await openPath(h, path)
    const id = opened.id
    await h.waitFor(() => ctx.editor.getLineCount(id) === splitLines(text).length + 1, { timeout: 120000, interval: 50 })
    await h.idle({ timeout: 60000 })
    const original = h.app.text()
    const before = splitLines(original)
    const name = program === 'simple' ? 'O9001 (PERF 300K)' : program === 'arcs' ? 'O9002 (ARCS 300K)' : 'O9003 (DRILL 300K - WRITTEN FOR GEDIT, SYNTHETIC)'
    h.check(`${program}: the program has ${before.length} lines and ${(text.length / 1024 / 1024).toFixed(1)} MiB, and is open as a Fanuc mill program`, before.length >= LINES && ctx.docs.get(id)?.profileId === 'fanuc-gcode', { lines: before.length, profile: ctx.docs.get(id)?.profileId })
    h.check(`${program}: it is a synthetic program of the harness: the header says what it is`, before[1] === name && before.every((line) => !/[\r]/.test(line)), before.slice(0, 3))
    if (program === 'arcs') {
      const arcs = before.filter((line) => /^G[23] /.test(line)).length
      h.check(`arcs: most of the program is arcs (${arcs} of ${before.length} lines)`, arcs > before.length * 0.9, { arcs })
    }
    if (program === 'drill') {
      const cycles = before.filter((line) => /^G98 G81 /.test(line)).length
      h.check(`drill: the program drills ${cycles * 2} holes in ${cycles} cycle blocks and ${cycles} repeats, and the rest is feed moves`, cycles > 20000 && before.filter((line) => /G81/.test(line)).length === cycles, { cycles })
    }
    return { id, original, before }
  }

  // =============================================================== A. P4a: translate, rotate, mirror at 300,000 lines
  /** @type {Record<string, { id: string, original: string, before: string[] }>} */
  const programs = {}

  for (const { program, script, values, what, wanted: wantedFor, rounds } of CASES) {
    const label = `${script}${rounds ? ` at ${/** @type {any} */ (values).angle} degrees` : ''} on the ${program} program`
    await guard(h, `A. ${label}`, async () => {
      programs[program] ??= await open(program)
      const { id, original, before } = programs[program]
      const wanted = before.map(wantedFor)
      const wantedChanged = wanted.reduce((n, line, i) => n + (movedBy(before[i], line) ? 1 : 0), 0)
      h.check(`${label}: the expected result changes most of the program (${wantedChanged} of ${before.length} lines)`, wantedChanged > before.length * 0.9, { wantedChanged })

      const run = await runGeometry(h, GEOMETRY[script], values, { timeout: wait })
      h.checkTime(`${label} finishes within the script budget (${budgetText}), apply included`, run.ms, budget, { status: run.status })
      h.check(`${label}: the run ended with its result and not with the app's own timeout message`, !/timed out|stopped|failed/i.test(run.status), run.status)

      const after = splitLines(h.app.text())
      const { wrong, edge } = rounds ? nearDifferences(before, after, wanted) : { wrong: differences(before, after, wanted), edge: 0 }
      h.check(`${script} ${what}, and no other word of any line changed`, after.length === before.length && wrong.length === 0, { lines: after.length, wrong: wrong.length, first: wrong.slice(0, 4) })
      const changed = after.reduce((n, line, i) => n + (movedBy(before[i], line) ? 1 : 0), 0)
      h.check(`${label}: the document changed on ${wantedChanged} lines (by value), as expected`, changed === wantedChanged, { changed, wantedChanged })
      h.check(`${label}: the document is marked as changed`, ctx.docs.get(id)?.dirty === true)

      // The run is one undo step, and as cheap to take back as the apply of a transform is (P1 G7).
      const instance = /** @type {any} */ (ctx.editor.editorInstance())
      const probeLine = before.findIndex((line, i) => line !== after[i]) + 1
      const started = performance.now()
      instance.trigger('p4', 'undo', null)
      await h.waitFor(() => ctx.editor.getLines(id, probeLine, probeLine)[0] === before[probeLine - 1], { timeout: 60000, interval: 1 })
      const undoMs = Math.round(performance.now() - started)
      await h.idle({ timeout: 60000 })
      h.check(`${label}: one undo takes the whole run back, not the visible lines`, h.app.text() === original, { lines: ctx.editor.getLineCount(id), probeLine })
      h.log(`${label}: ${run.ms} ms for ${before.length} lines (${run.status.slice(-160)}), ${edge} numbers on the edge of a rounding, undo ${undoMs} ms`)
    })
  }

  // =============================================================== B. P4b: Expand Drilling Cycles at 300,000 lines
  await guard(h, 'B. Expand Drilling Cycles on the drilling program', async () => {
    const { id, original, before } = await open('drill')
    ctx.docs.activate(id)
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 15000 })
    const run = await runTools(h, CYCLE_SCRIPTS.expand, {}, { timeout: wait })
    h.checkTime(`expand on the drilling program finishes within the script budget (${budgetText}), apply included`, run.ms, budget, { status: run.status })
    h.check('expand: the run ended with its result and not with the app\u2019s own timeout message or a refusal', /Expanded [\d,]+ cycles/.test(run.status) && !/timed out|stopped|failed|Nothing was changed/i.test(run.status), run.status)

    const after = splitLines(h.app.text())
    const { problems, holes } = checkDrillExpansion(before, after)
    const wantHoles = before.filter((line) => /(?<![A-Z0-9])G81(?!\d)/.test(line) || /^X-?\d+\.?\d*$/.test(line)).length
    h.check('expand: every line that is no cycle block is where it was, and the tool drills every hole in order, rapid to the R plane, feed to the depth, rapid back to the initial level', problems.length === 0, { problems })
    h.check(`expand: the ${wantHoles} holes of the program are all drilled (${holes} found)`, holes === wantHoles && wantHoles > 40000, { holes, wantHoles })
    h.check('expand: the result is longer than the program by the blocks the cycles became (about 1.4 times) and no cycle word is left but G80', after.length > before.length * 1.3 && after.length < before.length * 1.6 && !after.some((line) => /(?<![A-Z0-9])G8[1-9](?!\d)/.test(line)), { before: before.length, after: after.length })
    h.check('expand: the document is marked as changed', ctx.docs.get(id)?.dirty === true)

    const instance = /** @type {any} */ (ctx.editor.editorInstance())
    const started = performance.now()
    instance.trigger('p4', 'undo', null)
    await h.waitFor(() => ctx.editor.getLineCount(id) === before.length + 1, { timeout: 60000, interval: 1 })
    const undoMs = Math.round(performance.now() - started)
    await h.idle({ timeout: 60000 })
    h.check('expand: one undo takes the whole run back, not the visible lines', h.app.text() === original, { lines: ctx.editor.getLineCount(id) })
    h.log(`expand: ${run.ms} ms for ${before.length} lines into ${after.length} (${run.status.slice(0, 160)}), undo ${undoMs} ms`)
  })

  // =============================================================== C. P4b: Statistics and Time at 300,000 lines
  await guard(h, 'C. Statistics and Time on the simple program', async () => {
    const { id, original } = programs.simple ?? (programs.simple = await open('simple'))
    ctx.docs.activate(id)
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 15000 })
    const text = largeProgram({ lines: LINES })
    const want = largeProgramTotals(text)
    const run = await runTools(h, CYCLE_SCRIPTS.time, { motionUnits: 'mm', rapidX: 30000, rapidY: 30000, rapidZ: 20000, rapidKind: 'straight', toolChange: 4, format: 'csv' }, { timeout: wait })
    h.checkTime(`statistics on the simple program finishes within the script budget (${budgetText}), the new document included`, run.ms, budget, { status: run.status })
    const made = await activeText(h)
    const rows = csvRows(made.text)
    const total = rows.find((cells) => cells[0] === 'Total')
    const near = (/** @type {string | undefined} */ cell, /** @type {number} */ value, /** @type {number} */ tolerance) => cell !== undefined && Math.abs(Number(cell) - value) <= tolerance
    h.check('statistics: a new document opened with the CSV: a header, the tool T1 and the Total', made.id !== id && rows.length === 3 && rows[1][0] === 'T1' && !!total, { rows })
    h.check(`statistics: the feed length is ${want.feedLength.toFixed(2)} mm, worked out from the program (to 0.01 mm and the rounding of 300,000 lengths)`, near(total?.[1], want.feedLength, 0.01 + want.feedLength * 1e-7), { got: total?.[1], want: want.feedLength })
    h.check(`statistics: the rapid length is ${want.rapidLength.toFixed(2)} mm`, near(total?.[2], want.rapidLength, 0.01 + want.rapidLength * 1e-7), { got: total?.[2], want: want.rapidLength })
    h.check('statistics: one tool change, and the feed time, 0.0 s of dwell and 4.0 s of tool change are what the program and the form make of them', total?.[3] === '1' && near(total?.[4], want.feedTime, 0.15) && total?.[6] === '0.0' && total?.[7] === '4.0', { total, want })
    h.check(`statistics: the ${want.notEstimated} moves whose start is not known are the only ones not estimated`, total?.[9] === String(want.notEstimated), { got: total?.[9], want: want.notEstimated })
    h.check('statistics: the program is the same bytes and was not marked as changed', h.q('editor-host') !== null && ctx.editor.getLineCount(id) === splitLines(original).length + 1 && ctx.docs.get(id)?.dirty !== true, { dirty: ctx.docs.get(id)?.dirty })
    h.log(`statistics: ${run.ms} ms (${run.status.slice(0, 200)})`)
  })

  // =============================================================== D. P4e: split view on a 300,000-line document
  /** The line of the simple program that is typed on (a feed move: `p3-perf` types there too). */
  const SPLIT_LINE = 150000
  /**
   * One group's editor as `measureChars` needs it: the live editor of the group, and a focus that puts the cursor at the end of a line.
   * @param {string} groupId
   * @param {number} line
   * @returns {import('./p4e-perf-common.js').Typed}
   */
  const inGroup = (groupId, line) => ({
    editor: () => editorOf(h, groupId),
    line,
    focus: async () => {
      await placeCursor(h, groupId, line, 1000000)
      const editor = editorOf(h, groupId)
      return !!editor && editor.hasTextFocus() && editor.getPosition()?.lineNumber === line
    },
  })
  /** What a measurement has to show before its times mean anything. @param {Awaited<ReturnType<typeof measureChars>>} r */
  const reached = (r) => r.count === KEYSTROKES && r.warmed && r.retries <= MAX_RETRIES

  await guard(h, 'D. Split view on the simple program (two groups, one 300,000-line document)', async () => {
    const { id } = programs.simple ?? (programs.simple = await open('simple'))
    ctx.docs.activate(id)
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 15000 })
    await h.idle({ timeout: 60000 })
    const feed = ctx.editor.getLines(id, SPLIT_LINE, SPLIT_LINE)[0] ?? ''
    h.check(`split: line ${SPLIT_LINE} of the program is a feed move, the line the keys are typed on`, /^G1 X/.test(feed), feed)
    await waitGroups(h, 1, 'single')
    const [first] = groupIds(h)

    // The baseline: the same typing in the one editor, just before the second group exists.
    const one = await measureChars(h, inGroup(first, SPLIT_LINE), KEYSTROKES)
    h.check('split: every keystroke of the one-editor baseline reached the screen', reached(one), one)
    h.checkTime(`split: keypress to render at ${LINES} lines in ONE editor (the baseline): drawn ${one.domP95} ms after the keydown, on screen within`, one.domP95 + FRAME_MS, KEYPRESS_P95_BUDGET_MS, { one }, { also: reached(one), strict: true })

    // Split Editor: the new group starts where the first one is and takes the keyboard.
    const started = performance.now()
    await ctx.commands.run('view.splitEditor')
    const shown = await until(() => groupsDrawn(h, 2, 'side-by-side'), 30000)
    const openMs = Math.round((shown ?? performance.now()) - started)
    h.checkTime(`split: Split Editor on the open ${LINES}-line document shows both groups drawn within the open budget`, openMs, VIEW_OPEN_BUDGET_MS, { shown: shown !== null, layout: hostLayout(h) }, { also: shown !== null })
    const ids = groupIds(h)
    await waitGroups(h, 2, 'side-by-side')
    await h.idle({ timeout: 60000 })
    h.check('split: two groups of the one document, side by side', ids.length === 2 && ids[0] === first && groupsOnScreen(h).every((g) => g.docId === id), { ids, first })

    // 1. Group 2 draws the very lines being typed on: both views have to follow every character.
    let line = SPLIT_LINE + 1
    editorOf(h, ids[1])?.revealLineInCenter(line)
    await h.idle()
    const same = await measureChars(h, inGroup(ids[0], line), KEYSTROKES, [() => editorOf(h, ids[1])])
    h.check('split: typing in group 1 with group 2 on the same lines: every keystroke reached both groups', reached(same) && same.othersCount[0] === KEYSTROKES, same)
    h.checkTime(`split: keypress to render in group 1 with group 2 on the same lines: drawn ${same.domP95} ms after the keydown, on screen within`, same.domP95 + FRAME_MS, KEYPRESS_P95_BUDGET_MS, { same, one }, { also: reached(same), strict: true })
    h.checkTime(`split: and group 2 draws the character within the same budget: ${same.othersP95[0]} ms after the keydown`, same.othersP95[0] + FRAME_MS, KEYPRESS_P95_BUDGET_MS, { same }, { also: same.othersCount[0] === KEYSTROKES, strict: true })
    h.checkTime(`split: the second group costs typing at most a frame: ${same.domP95} ms against ${one.domP95} ms in one editor`, same.domP95 - one.domP95, TYPING_COST_BUDGET_MS, { same: same.domP95, one: one.domP95 })

    // 2. Group 2 at the top of the program: the edit does not reach what it draws.
    line = SPLIT_LINE + 2
    editorOf(h, ids[1])?.setScrollTop(0)
    await h.idle()
    const header = await measureChars(h, inGroup(ids[0], line), KEYSTROKES)
    h.check('split: typing in group 1 with group 2 at the top of the program: every keystroke reached the screen', reached(header), header)
    h.checkTime(`split: keypress to render in group 1 with group 2 at the top: drawn ${header.domP95} ms after the keydown, on screen within`, header.domP95 + FRAME_MS, KEYPRESS_P95_BUDGET_MS, { header, one }, { also: reached(header), strict: true })
    h.checkTime(`split: the second group costs typing at most a frame there too: ${header.domP95} ms against ${one.domP95} ms`, header.domP95 - one.domP95, TYPING_COST_BUDGET_MS, { header: header.domP95, one: one.domP95 })

    // 3. The keyboard in group 2, group 1 on the same lines.
    line = SPLIT_LINE + 3
    editorOf(h, ids[0])?.revealLineInCenter(line)
    await h.idle()
    const second = await measureChars(h, inGroup(ids[1], line), KEYSTROKES, [() => editorOf(h, ids[0])])
    h.check('split: typing in group 2 with group 1 on the same lines: every keystroke reached both groups', reached(second) && second.othersCount[0] === KEYSTROKES, second)
    h.checkTime(`split: keypress to render in group 2: drawn ${second.domP95} ms after the keydown, on screen within`, second.domP95 + FRAME_MS, KEYPRESS_P95_BUDGET_MS, { second, one }, { also: reached(second), strict: true })
    h.checkTime(`split: and group 1 draws the character within the same budget: ${second.othersP95[0]} ms after the keydown`, second.othersP95[0] + FRAME_MS, KEYPRESS_P95_BUDGET_MS, { second }, { also: second.othersCount[0] === KEYSTROKES, strict: true })
    h.checkTime(`split: group 2 costs typing at most a frame: ${second.domP95} ms against ${one.domP95} ms in one editor`, second.domP95 - one.domP95, TYPING_COST_BUDGET_MS, { second: second.domP95, one: one.domP95 })

    // The keys went into the one model, three lines of it.
    const typedLines = [SPLIT_LINE + 1, SPLIT_LINE + 2, SPLIT_LINE + 3].map((n) => ctx.editor.getLines(id, n, n)[0] ?? '')
    h.check(`split: the typed characters are in the program, ${KEYSTROKES} or more on each of the three lines`, typedLines.every((text) => new RegExp(`1{${KEYSTROKES},}$`).test(text)), typedLines.map((text) => text.slice(-48)))
    h.check('split: the program is marked as changed', ctx.docs.get(id)?.dirty === true)

    // Close Split: the one editor that is left types as it did before the split (the single-editor budget does not move).
    await ctx.commands.run('view.closeSplit')
    await waitGroups(h, 1, 'single')
    await h.idle({ timeout: 60000 })
    const [rest] = groupIds(h)
    const after = await measureChars(h, inGroup(rest, SPLIT_LINE + 4), KEYSTROKES)
    h.check('split: after Close Split every keystroke of the one editor reached the screen', reached(after), after)
    h.checkTime(`split: after Close Split the one editor draws a keypress in ${after.domP95} ms, as before the split (${one.domP95} ms): on screen within`, after.domP95 + FRAME_MS, KEYPRESS_P95_BUDGET_MS, { after, one }, { also: reached(after), strict: true })
    h.checkTime(`split: and no slower than before the split by more than a frame: ${after.domP95} ms against ${one.domP95} ms`, after.domP95 - one.domP95, TYPING_COST_BUDGET_MS, { after: after.domP95, one: one.domP95 })
    h.log(`split: open ${openMs} ms; typing p95 (drawn) ${one.domP95} ms in one editor, ${same.domP95} / ${same.othersP95[0]} ms in group 1 / group 2 on the same lines, ${header.domP95} ms with group 2 at the top, ${second.domP95} / ${second.othersP95[0]} ms in group 2 / group 1, ${after.domP95} ms after Close Split`)
  })

  // =============================================================== E. P4e: the channel view on a 300,000-line two-channel program
  await guard(h, 'E. Channels Side by Side on a 300,000-line program with two channel sections', async () => {
    const program = channelProgram()
    h.check(`channels: the generated program has ${program.lines.length} lines (over 300,000), two sections and ${program.marks} waits`, program.lines.length > 300000 && program.marks === 20000, { lines: program.lines.length, marks: program.marks, ranges: program.ranges })
    const machineId = await channelMachines(h).add('Perf lathe (two channels)', CHANNEL_BLOCK)
    await ctx.machines.setDefault('fanuc-lathe', machineId)
    const path = `${h.cfg.run}/p4-perf-channels-300k.nc`
    await h.disk.write(path, program.text)
    const opened = await openPath(h, path)
    const id = opened.id
    await h.waitFor(() => ctx.editor.getLineCount(id) === program.lines.length + 1, { timeout: 120000, interval: 50 })
    h.check('channels: the program is open as a Fanuc lathe program, and its machine has two channels', ctx.docs.get(id)?.profileId === 'fanuc-lathe', ctx.docs.get(id)?.profileId)
    await waitChannel(h, (s) => s.present, 30000)
    await ctx.outline.whenReady(id)
    await ctx.modal.whenReady(id)
    await h.idle({ timeout: 60000 })
    const set = ctx.channels.forDoc(id)
    h.check(`channels: the ${program.marks} waits are all found and the machine reads two sections`, set.marks.length === program.marks && set.layout === 'single-file', { marks: set.marks.length, layout: set.layout })

    // The lines typed on, each a motion line (not a tool change, not a wait) so no two measurements touch the same line: the baseline
    // in one editor, pane 1, pane 2 and the line breaks.
    const lineBase = channelLineAt(program, '2', 65001)
    const lineOne = channelLineAt(program, '1', 70001)
    const lineTwo = channelLineAt(program, '2', 70001)
    const lineEnter = channelLineAt(program, '2', 80001)
    h.check('channels: the lines typed on are motion moves of their channel', [lineBase, lineOne, lineTwo, lineEnter].every((l) => /^G01 X/.test(l.text) && ctx.editor.getLines(id, l.docLine, l.docLine)[0] === l.text), [lineBase, lineOne, lineTwo, lineEnter])

    // The baseline: the same typing in the one editor, with the channels resolved.
    await waitGroups(h, 1, 'single')
    const [only] = groupIds(h)
    const alone = await measureChars(h, inGroup(only, lineBase.docLine), KEYSTROKES)
    h.check('channels: every keystroke of the one-editor baseline reached the screen', reached(alone), alone)

    // Channels Side by Side, with the cursor in channel 2.
    ctx.editor.reveal(id, lineTwo.docLine, 1)
    await h.idle()
    const started = performance.now()
    await ctx.commands.run('channels.sideBySide')
    const shown = await until(() => groupsDrawn(h, 2, 'channels') && h.q('channel-view-bar') !== null, 30000)
    const openMs = Math.round((shown ?? performance.now()) - started)
    h.checkTime(`channels: Channels Side by Side on the open ${program.lines.length}-line program shows both panes drawn, with the bar, within the open budget`, openMs, VIEW_OPEN_BUDGET_MS, { shown: shown !== null, layout: hostLayout(h) }, { also: shown !== null })
    const ids = groupIds(h)
    await waitGroups(h, 2, 'channels')
    await h.idle({ timeout: 60000 })
    const bar = h.q('channel-view-bar')
    h.check(`channels: the bar says all ${program.marks} waits are lined up and none is without a partner`, bar?.dataset.matched === String(program.marks) && bar?.dataset.unmatched === '0', { matched: bar?.dataset.matched, unmatched: bar?.dataset.unmatched })
    const [paneOne, paneTwo] = views(h).map((v) => v.editor)
    h.check('channels: pane 1 and pane 2 show the program’s lines (the header and their channel’s section)', paneOne.getModel().getLineContent(lineOne.paneLine) === lineOne.text && paneTwo.getModel().getLineContent(lineTwo.paneLine) === lineTwo.text, { one: paneOne.getModel().getLineContent(lineOne.paneLine), two: paneTwo.getModel().getLineContent(lineTwo.paneLine) })

    // Characters in pane 2, then in pane 1 (the panes scroll together, so each shows its channel at the same height).
    const typedTwo = await measureChars(h, inGroup(ids[1], lineTwo.paneLine + 1), KEYSTROKES)
    h.check('channels: typing in pane 2: every keystroke reached the screen', reached(typedTwo), typedTwo)
    h.checkTime(`channels: keypress to render in pane 2 of the channel view: drawn ${typedTwo.domP95} ms after the keydown, on screen within`, typedTwo.domP95 + FRAME_MS, KEYPRESS_P95_BUDGET_MS, { typedTwo, alone }, { also: reached(typedTwo), strict: true })
    h.checkTime(`channels: the channel view costs typing at most a frame: ${typedTwo.domP95} ms against ${alone.domP95} ms in one editor`, typedTwo.domP95 - alone.domP95, TYPING_COST_BUDGET_MS, { typedTwo: typedTwo.domP95, alone: alone.domP95 })
    const typedOne = await measureChars(h, inGroup(ids[0], lineOne.paneLine + 1), KEYSTROKES)
    h.check('channels: typing in pane 1: every keystroke reached the screen', reached(typedOne), typedOne)
    h.checkTime(`channels: keypress to render in pane 1: drawn ${typedOne.domP95} ms after the keydown, on screen within`, typedOne.domP95 + FRAME_MS, KEYPRESS_P95_BUDGET_MS, { typedOne, alone }, { also: reached(typedOne), strict: true })
    h.checkTime(`channels: pane 1 costs typing at most a frame: ${typedOne.domP95} ms against ${alone.domP95} ms in one editor`, typedOne.domP95 - alone.domP95, TYPING_COST_BUDGET_MS, { typedOne: typedOne.domP95, alone: alone.domP95 })
    const written = [lineTwo.docLine + 1, lineOne.docLine + 1].map((n) => ctx.editor.getLines(id, n, n)[0] ?? '')
    h.check(`channels: the characters typed in the panes are in the program, ${KEYSTROKES} or more on each line`, written.every((text) => new RegExp(`1{${KEYSTROKES},}$`).test(text)), written.map((text) => text.slice(-48)))
    await h.waitFor(() => ctx.channels.forDoc(id).marks.length === program.marks, { timeout: 20000 })
    h.check('channels: after the typing the same waits are found', ctx.channels.forDoc(id).marks.length === program.marks && ctx.channels.forDoc(id).layout === 'single-file', { marks: ctx.channels.forDoc(id).marks.length })

    // Line breaks in pane 2: every wait below moves by one line, so the panes are aligned again.
    const lines0 = ctx.editor.getLineCount(id)
    const breaks = await measureEnters(h, inGroup(ids[1], lineEnter.paneLine), id, ENTERS)
    h.check(`channels: ${ENTERS} line breaks in pane 2: every one reached the pane and the program`, breaks.count === ENTERS && breaks.retries <= MAX_RETRIES && ctx.editor.getLineCount(id) === lines0 + breaks.count, { breaks, lines0, lines: ctx.editor.getLineCount(id) })
    h.checkTime(`channels: a line break in pane 2 with ${program.marks} waits below: in the pane and the program ${breaks.domP95} ms after the keydown, on screen within`, breaks.domP95 + FRAME_MS, ENTER_BUDGET_MS, { breaks }, { also: breaks.count === ENTERS, strict: true })
    await h.waitFor(() => ctx.channels.forDoc(id).marks.length === program.marks, { timeout: 20000 })
    h.check('channels: after the line breaks the same waits are found', ctx.channels.forDoc(id).marks.length === program.marks, { marks: ctx.channels.forDoc(id).marks.length })
    h.log(`channels: open ${openMs} ms; typing p95 (drawn) ${alone.domP95} ms in one editor, ${typedTwo.domP95} ms in pane 2, ${typedOne.domP95} ms in pane 1; line break p95 ${breaks.domP95} ms`)

    await ctx.commands.run('view.closeSplit')
    await waitGroups(h, 1, 'single')
  })

  // =============================================================== F. P4e: the aligned view of two 100,000-line programs
  await guard(h, 'F. The aligned view of a comparison of two 100,000-line programs', async () => {
    const pair = alignedPair()
    const K = ALIGNED_CHANGES
    h.check(`aligned: the programs have ${pair.original.length} and ${pair.modified.length} lines (the second has ${K} fewer and ${K} more), and the typing line is the same in both`, pair.original.length === ALIGNED_LINES && pair.modified.length === ALIGNED_LINES && pair.original[pair.typing.originalLine - 1] === pair.modified[pair.typing.modifiedLine - 1], { original: pair.original.length, modified: pair.modified.length })
    const pathOriginal = `${h.cfg.run}/p4-perf-aligned-original-100k.nc`
    const pathModified = `${h.cfg.run}/p4-perf-aligned-modified-100k.nc`
    await h.disk.write(pathOriginal, `${pair.original.join('\n')}\n`)
    await h.disk.write(pathModified, `${pair.modified.join('\n')}\n`)
    const a = (await openPath(h, pathOriginal)).id
    const b = (await openPath(h, pathModified)).id
    await h.waitFor(() => ctx.editor.getLineCount(a) === pair.original.length + 1 && ctx.editor.getLineCount(b) === pair.modified.length + 1, { timeout: 120000, interval: 50 })
    await h.idle({ timeout: 60000 })
    ctx.docs.activate(b)
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === b, { timeout: 15000 })
    await h.idle({ timeout: 60000 })
    const reg = monacoRegistry(h)
    const compare = /** @type {any} */ (ctx.compare)

    /** Both panes of the aligned view, the live editors. */
    const pane = () => {
      const find = (/** @type {'original' | 'modified'} */ side) => {
        const host = h.q(`aligned-pane-${side}`)
        return /** @type {any} */ (reg.editors.listCodeEditors().find((/** @type {any} */ e) => !!host && host.contains(e.getDomNode())))
      }
      return { original: find('original'), modified: find('modified') }
    }
    /** The decorations of a model with a class. @param {any} editor @param {string} className */
    const marked = (editor, className) => (editor ? /** @type {any[]} */ (editor.getModel().getAllDecorations()).filter((d) => d.options.className === className).length : -1)
    /** The block counts the view draws, per side. */
    const blocks = () => {
      const { original, modified } = pane()
      return { changed: marked(modified, 'gedit-aligned-changed'), onlyModified: marked(modified, 'gedit-aligned-only-modified'), onlyOriginal: marked(original, 'gedit-aligned-only-original'), changedOriginal: marked(original, 'gedit-aligned-changed') }
    }
    const drawnAll = (/** @type {number} */ changed) => {
      const now = blocks()
      return now.changed === changed && now.changedOriginal === changed && now.onlyModified === pair.expected.onlyModified && now.onlyOriginal === pair.expected.onlyOriginal
    }

    // `setMode` takes raw or review; the aligned view is a switch of its own (`setAligned`), which `open` then keeps.
    compare.setAligned(true)
    const started = performance.now()
    const opening = compare.open(b, { kind: 'document', docId: a })
    const shown = await until(() => drawnAll(pair.expected.changed), 180000)
    const openMs = Math.round((shown ?? performance.now()) - started)
    await opening
    h.checkTime(`aligned: the aligned view of two ${ALIGNED_LINES}-line programs shows its ${3 * K} blocks on both sides within the open budget (the review normalization and the alignment included)`, openMs, ALIGNED_OPEN_BUDGET_MS, { shown: shown !== null, blocks: blocks() }, { also: shown !== null })
    await h.idle({ timeout: 120000 })
    const now = blocks()
    h.check(`aligned: ${K} changed blocks on both sides, ${K} lines only in the first program, ${K} only in the second, and nothing else`, drawnAll(pair.expected.changed), now)
    const arrows = (/** @type {any} */ editor) => (editor ? /** @type {any[]} */ (editor.getModel().getAllDecorations()).filter((d) => String(d.options.linesDecorationsClassName ?? '').startsWith('gedit-aligned-arrow')).length : -1)
    h.check(`aligned: a copy arrow on every block of each side (${2 * K} a side)`, arrows(pane().original) === 2 * K && arrows(pane().modified) === 2 * K, { original: arrows(pane().original), modified: arrows(pane().modified) })
    h.check('aligned: the panes show the programs as written (the first line of each, and the line count)', pane().original?.getModel().getLineCount() === pair.original.length + 1 && pane().modified?.getModel().getLineCount() === pair.modified.length + 1 && pane().modified?.getModel().getLineContent(2) === pair.modified[1], { original: pane().original?.getModel().getLineCount(), modified: pane().modified?.getModel().getLineCount() })

    // Typing in the current document's pane, then the alignment made again after the pause.
    const line = pair.typing.modifiedLine
    const typed = /** @type {import('./p4e-perf-common.js').Typed} */ ({
      editor: () => pane().modified,
      line,
      focus: async () => {
        const editor = pane().modified
        if (!editor) return false
        editor.setPosition({ lineNumber: line, column: 1000000 })
        editor.revealLineInCenter(line)
        editor.focus()
        await h.waitFor(() => editor.hasTextFocus(), { timeout: 5000 })
        return editor.hasTextFocus() && editor.getPosition()?.lineNumber === line
      },
    })
    const typing = await measureChars(h, typed, KEYSTROKES)
    h.check('aligned: typing in the current document’s pane: every keystroke reached the screen', reached(typing), typing)
    h.checkTime(`aligned: keypress to render in the aligned view at ${ALIGNED_LINES} lines: drawn ${typing.domP95} ms after the keydown, on screen within`, typing.domP95 + FRAME_MS, KEYPRESS_P95_BUDGET_MS, { typing }, { also: reached(typing), strict: true })
    const early = drawnAll(pair.expected.changed + 1)
    const redrawn = await until(() => drawnAll(pair.expected.changed + 1), ALIGNED_REALIGN_BUDGET_MS * 4)
    const realignMs = Math.max(0, Math.round((redrawn ?? performance.now()) - typing.lastKeyAt))
    h.checkTime(`aligned: after the last key the typed line is a changed block of its own, drawn again ${realignMs} ms later`, realignMs, ALIGNED_REALIGN_BUDGET_MS, { redrawn: redrawn !== null, alignedDuringTyping: early, blocks: blocks() }, { also: redrawn !== null })
    h.check('aligned: the program in the second pane has the typed characters on that line, and the first program is as it was', new RegExp(`1{${KEYSTROKES},}$`).test(ctx.editor.getLines(b, line, line)[0] ?? '') && ctx.editor.getLines(a, pair.typing.originalLine, pair.typing.originalLine)[0] === pair.original[pair.typing.originalLine - 1])
    h.log(`aligned: open ${openMs} ms for ${3 * K} blocks; typing p95 (drawn) ${typing.domP95} ms; realigned ${realignMs} ms after the last key${early ? ' (already during the typing)' : ''}`)

    await closeCompare(h)
    h.check('aligned: the comparison is closed and the editor is back', !h.q('compare-view') && !h.q('aligned-view') && !!h.q('editor-host'))
  })

  h.log(`status at the end: ${message(h)}`)
})
