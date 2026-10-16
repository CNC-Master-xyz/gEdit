// X34 for Phase 4 (plan docs/planning/phase-4-implementation.md §2.2 X34, §5 P4a H4a): the budgets of the new
// features at 300,000 lines. This is the **first part**, P4a's: Translate, Rotate and Mirror on a 300,000-line
// program (and, for the slow cases, on an arc-heavy one at 30 degrees), each within the 900 s the three scripts allow. The later milestones add their sections below (the
// expansion on 300,000 lines, the typing budgets, Find in Folder, the bookmark panel); each section is a `guard`
// of its own so one cannot take another down.
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

import { CI_TIME_FACTOR } from '../lib/api.js'
import { scenario } from '../lib/index.js'
import { largeProgram } from './m3-common.js'
import { canon, differences, guard, openPath, pythonProbe, ready } from './m10-common.js'
import { GEOMETRY, MIRROR, MIRROR_ANGLED, ROTATE, ROTATE_ANGLED, TRANSLATE, arcProgram, context, message, nearDifferences, runGeometry, splitLines, wantedArcLine, wantedLine } from './p4-geometry-common.js'

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

// The scenario's own timeout is the worst case: five runs that the app kills at the limit (900 s plus 30 s to say so), each with a
// minute or two of opening, apply, undo and comparison, and the Python probe. No retry: see the header.
scenario('p4-perf', { timeout: 6600, retry: false }, async (h) => {
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
   * @param {'simple' | 'arcs'} program
   */
  async function open(program) {
    const text = program === 'simple' ? largeProgram({ lines: LINES }) : arcProgram({ lines: LINES })
    const path = `${h.cfg.run}/p4-perf-${program}-300k.nc`
    await h.disk.write(path, text)
    const opened = await openPath(h, path)
    const id = opened.id
    await h.waitFor(() => ctx.editor.getLineCount(id) === splitLines(text).length + 1, { timeout: 120000, interval: 50 })
    await h.idle({ timeout: 60000 })
    const original = h.app.text()
    const before = splitLines(original)
    const name = program === 'simple' ? 'O9001 (PERF 300K)' : 'O9002 (ARCS 300K)'
    h.check(`${program}: the program has ${before.length} lines and ${(text.length / 1024 / 1024).toFixed(1)} MiB, and is open as a Fanuc mill program`, before.length >= LINES && ctx.docs.get(id)?.profileId === 'fanuc-gcode', { lines: before.length, profile: ctx.docs.get(id)?.profileId })
    h.check(`${program}: it is a synthetic program of the harness: the header says what it is`, before[1] === name && before.every((line) => !/[\r]/.test(line)), before.slice(0, 3))
    if (program === 'arcs') {
      const arcs = before.filter((line) => /^G[23] /.test(line)).length
      h.check(`arcs: most of the program is arcs (${arcs} of ${before.length} lines)`, arcs > before.length * 0.9, { arcs })
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

  h.log(`status at the end: ${message(h)}`)
})
