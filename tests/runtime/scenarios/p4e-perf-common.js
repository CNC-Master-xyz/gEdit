// What the two-pane rows of `p4-perf` (sections D, E and F: split view, channel view and the aligned view of a comparison on large programs)
// share: the budgets with the reasons for each, the programs, and the measuring of a keypress in one of several editors. This file registers
// no scenario (`loadScenarios()` imports it like any other file under `scenarios/` and finds nothing new in it). The pure parts (the
// programs, the line mapping, the budgets) are held without the app by `tests/unit/p4ePerfHarness.test.ts`.
//
// **Where the budgets come from.** The plan (`docs/planning/phase-4-implementation.md` X34 and §5 P4e decision 14) states one number for
// the two-pane features: they "keep the typing budget of P1" at 300,000 lines, split view with two groups on one document and the channel view
// with two panes; three and four panes have no budget (the owner, 2026-10-17, §7 #387). The P1 budget is the one every typing row of the
// suite uses: the 95th percentile of the time from the keydown to the frame that draws the character is under 50 ms (`m3-perf`'s way, which
// `p3-perf` and `m12-perf` repeat), counted as the DOM change plus one frame. That is `KEYPRESS_P95_BUDGET_MS`, the same number for a
// character typed in either pane. The plan states no figure for anything else, so the rest are PROPOSED here, each derived from a number the
// repo already has, and the report that came with them says so:
//
//   - `TYPING_COST_BUDGET_MS` (17 ms, one frame): what the second pane may add to a keystroke, measured against the same line typed in one
//     editor just before (the allowance `m12-perf` and `p3-perf` give channels, the inspector and the colours). "Keeps the typing budget"
//     says 50 ms; this says the second pane is not what uses it.
//   - `VIEW_OPEN_BUDGET_MS` (2,000 ms): opening split view or the channel view on the 300,000-line program that is already open, from the
//     command to both panes drawn. It is the P1 open budget (`m1-perf`, `m12-perf` `OPEN_BUDGET_MS`): showing a program a second time must
//     not cost more than opening the file did.
//   - `ENTER_BUDGET_MS` (100 ms): a line break in a channel pane of a program with 20,000 waits, the figure `channelPanes.typing.slow.test.ts`
//     already holds the code to (a line break moves every wait below it, so the alignment is made again).
//   - `ALIGNED_OPEN_BUDGET_MS` (6,000 ms): the aligned view of two 100,000-line programs from `compare.open` to the blocks drawn on both
//     sides. It is the review normalization's 5,000 ms (`m11-perf` `REVIEW_BUDGET_MS`, the alignment runs on the normalized lines) plus the
//     1,000 ms the diff and the fillers are held to in `alignedDiff.slow.test.ts`.
//   - `ALIGNED_REALIGN_BUDGET_MS` (9,000 ms): from the last keystroke in a pane of the aligned view to the blocks drawn again. The view waits
//     twice the last alignment, at most `REALIGN_DELAY_MAX_MS` (3,000 ms, `core/compare/aligned.ts`), and then aligns again, which costs what
//     the open costs: 3,000 + `ALIGNED_OPEN_BUDGET_MS`.
//
// On a hosted runner `h.checkTime` multiplies every one of them by `CI_TIME_FACTOR`.

import { plain } from './m3-common.js'
import { context } from './m4-common.js'
import { nextPaint, percentile } from './p3-common.js'
import { groupsOnScreen, hostLayout } from './p4e-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

// ---------------------------------------------------------------- the budgets (see the header)

/** The P1 typing budget: p95 of the keypress to the frame that draws it, under this many ms. */
export const KEYPRESS_P95_BUDGET_MS = 50
/** One frame at 60 Hz: added to the DOM time, and the most a second pane may add to a keystroke. */
export const FRAME_MS = 17
export const TYPING_COST_BUDGET_MS = 17
/** Opening a second view of an open 300,000-line program (the P1 open budget). */
export const VIEW_OPEN_BUDGET_MS = 2000
/** A line break in a channel pane with 20,000 waits (`channelPanes.typing.slow.test.ts` `ENTER_BUDGET_MS`). */
export const ENTER_BUDGET_MS = 100
/** The aligned view of two 100,000-line programs: the review normalization (5,000) and the diff (1,000). */
export const ALIGNED_OPEN_BUDGET_MS = 6000
/** The longest wait of the aligned view before it aligns again (`REALIGN_DELAY_MAX_MS`), and the alignment after it. */
export const ALIGNED_REALIGN_DELAY_MAX_MS = 3000
export const ALIGNED_REALIGN_BUDGET_MS = ALIGNED_REALIGN_DELAY_MAX_MS + ALIGNED_OPEN_BUDGET_MS

/** Characters (and line breaks) typed per measurement, and the refocus attempts a measurement may need. */
export const KEYSTROKES = 40
export const ENTERS = 20
export const MAX_RETRIES = 2

// ---------------------------------------------------------------- the channel program (section E)

/** Lines of motion in each channel of the channel program, and how often a wait comes (`m12-perf`'s program). */
export const PER_CHANNEL = 150000
export const WAIT_EVERY = 15

/** The channel block of the machine: two sections by program number, the waits `M900`-`M999` with their `P` list (`m12-perf`'s). */
export const CHANNEL_BLOCK = {
  layout: 'single-file',
  list: [
    { id: '1', name: 'Channel 1' },
    { id: '2', name: 'Channel 2' },
  ],
  sectionStart: '^O21\\d\\d(?![\\d.])',
  syncMarks: [
    {
      id: 'wait',
      label: 'Wait M900-M999, P = path numbers',
      match: { kind: 'codes', codes: 'M900-M999' },
      partners: { kind: 'word', address: 'P', decode: 'digits', whenAbsent: { kind: 'none' } },
    },
  ],
}

/**
 * Two channels of `PER_CHANNEL` lines in one file: four header lines, the section `O2101` and the section `O2102`, a wait `M9xx P12`
 * every fifteenth line (10,000 a channel, 20,000 marks: the cap of the contract), a tool change every 3,000 lines, and a closing `%`.
 * Both channels write the same waits, so the check has nothing to find and every wait has its partner.
 * @param {{ perChannel?: number, waitEvery?: number }} [o]
 * @returns {{ text: string, lines: string[], header: number, ranges: Record<string, [number, number]>, marks: number }}
 */
export function channelProgram({ perChannel = PER_CHANNEL, waitEvery = WAIT_EVERY } = {}) {
  const lines = ['(WRITTEN FOR GEDIT - SYNTHETIC PERFORMANCE PROGRAM, NOT FOR A MACHINE)', '(TWO CHANNELS IN ONE FILE, 10000 WAITS EACH)', '%', 'G21 G40 G99']
  const header = lines.length
  /** @type {Record<string, [number, number]>} */
  const ranges = {}
  let marks = 0
  for (const channel of ['1', '2']) {
    const start = lines.length + 1
    lines.push(`O210${channel} (CHANNEL ${channel})`)
    let wait = 0
    let x = 0
    for (let i = 1; i <= perChannel; i++) {
      if (i % 3000 === 1) lines.push(`T0${channel}0${1 + ((i / 3000) | 0) % 8} (TOOL)`)
      else if (i % waitEvery === 0) {
        lines.push(`M${900 + (wait++ % 100)} P12`)
        marks++
      } else {
        x = (x + 0.25) % 80
        lines.push(`G01 X${x.toFixed(3)} Z-${(i % 40).toFixed(3)} F0.2`)
      }
    }
    lines.push(channel === '1' ? 'M99' : 'M30')
    ranges[channel] = [start, lines.length]
  }
  lines.push('%')
  return { text: `${lines.join('\n')}\n`, lines, header, ranges, marks }
}

/**
 * The line of the program that is the `index`-th line after the section start of a channel (a motion line: not a tool change, not a
 * wait), and the line of the channel's pane that shows it. A pane holds the header lines and then its section, so the channel's own
 * lines follow the header in order.
 * @param {ReturnType<typeof channelProgram>} program
 * @param {'1' | '2'} channel
 * @param {number} index
 */
export function channelLineAt(program, channel, index) {
  const docLine = program.ranges[channel][0] + index
  return { docLine, paneLine: program.header + (docLine - program.ranges[channel][0]) + 1, text: program.lines[docLine - 1] }
}

// ---------------------------------------------------------------- the pair of programs (section F)

/** Lines of each program of the comparison (the limit the compare tests and `alignedDiff.slow.test.ts` use). */
export const ALIGNED_LINES = 100000
/** How many blocks of each kind the second program differs in: a changed feed, a removed line, an inserted line. */
export const ALIGNED_CHANGES = 150
/** The spacing of the differences, and where they begin: the three of one round are 200 and 400 lines apart. */
const ROUND = 650
const FIRST = 1000

/** One line of the base program: unique by its X, so the patience diff has anchors and no line is a repeat after the block numbers are ignored. @param {number} i 1-based index of the motion line */
const motion = (i) => `N${i * 10} G1 X${(i / 1000).toFixed(3)} Y${i % 997}.25 Z-${i % 53}.5 F800.`

/**
 * Two programs of `lines` lines for the aligned view: the base, and the same program with `changes` rounds of three differences each (the
 * feed of one line is F900 instead of F800, one line is missing, one line is new), none of them next to another. The answer is worked out
 * from the construction: `changes` blocks of each kind, and, for the typing, a line far from every difference.
 * @param {{ lines?: number, changes?: number }} [o]
 * @returns {{ original: string[], modified: string[], expected: { changed: number, onlyOriginal: number, onlyModified: number }, typing: { originalLine: number, modifiedLine: number } }}
 */
export function alignedPair({ lines = ALIGNED_LINES, changes = ALIGNED_CHANGES } = {}) {
  const head = ['%', 'O9100 (WRITTEN FOR GEDIT - SYNTHETIC COMPARE PROGRAM, NOT FOR A MACHINE)', 'G21 G17 G40 G90', 'T1 M6', 'S3000 M3']
  const tail = ['M30', '%']
  const count = lines - head.length - tail.length
  const base = Array.from({ length: count }, (_, k) => motion(k + 1))
  const changedAt = new Set()
  const removedAt = new Set()
  const insertedAfter = new Set()
  for (let round = 0; round < changes; round++) {
    const at = FIRST + round * ROUND
    changedAt.add(at)
    removedAt.add(at + 200)
    insertedAfter.add(at + 400)
  }
  if (Math.max(...insertedAfter) >= count) throw new Error('alignedPair: the program is too short for its differences')
  /** @type {string[]} */
  const modified = []
  for (let k = 0; k < count; k++) {
    const line = base[k]
    if (removedAt.has(k + 1)) continue
    modified.push(changedAt.has(k + 1) ? line.replace(/F800\.$/, 'F900.') : line)
    if (insertedAfter.has(k + 1)) {
      modified.push(`N${(k + 1) * 10 + 5} G1 X${k}.125 Y${k % 89}.375 F800.`)
    }
  }
  // The typing goes to a line that is the same in both and far from every difference (the middle of a round's gap).
  const typingBase = FIRST + Math.floor(changes / 2) * ROUND + 300
  const before = (/** @type {Set<number>} */ set) => [...set].filter((x) => x <= typingBase).length
  const modifiedLine = head.length + typingBase - before(removedAt) + before(insertedAfter)
  return {
    original: [...head, ...base, ...tail],
    modified: [...head, ...modified, ...tail],
    expected: { changed: changes, onlyOriginal: changes, onlyModified: changes },
    typing: { originalLine: head.length + typingBase, modifiedLine },
  }
}

// ---------------------------------------------------------------- measuring a keypress

/** Whether Monaco has drawn a view line with exactly this text inside `root`. @param {Element | null | undefined} root @param {string} text */
export function drawnIn(root, text) {
  for (const line of root?.querySelectorAll('.view-lines .view-line') ?? []) if (plain(line.textContent) === text) return true
  return false
}

/**
 * Whether the host shows `count` editor groups in `layout`, every one with its editor built and a line drawn in it.
 * @param {Harness} h
 * @param {number} count
 * @param {string} layout `single`, `side-by-side`, `stacked` or `channels`
 */
export function groupsDrawn(h, count, layout) {
  const groups = groupsOnScreen(h)
  return hostLayout(h) === layout && groups.length === count && groups.every((g) => g.ready && [...g.el.querySelectorAll('.view-lines .view-line')].some((line) => plain(line.textContent).trim() !== ''))
}

/**
 * Resolves with the time at which `predicate` first holds, polling every 10 ms (and at once); null at the timeout. For states that no
 * single DOM mutation announces.
 * @param {() => boolean} predicate
 * @param {number} timeout
 * @returns {Promise<number | null>}
 */
export function until(predicate, timeout) {
  return new Promise((resolve) => {
    const end = performance.now() + timeout
    const look = () => {
      if (predicate()) return resolve(performance.now())
      if (performance.now() > end) return resolve(null)
      setTimeout(look, 10)
    }
    look()
  })
}

/**
 * Resolves at the moment a DOM change makes `predicate` true, sampling on every mutation; null at the timeout.
 * @param {() => boolean} predicate
 * @param {number} timeout
 * @returns {Promise<number | null>}
 */
export function untilMutation(predicate, timeout) {
  return new Promise((resolve) => {
    if (predicate()) return resolve(performance.now())
    /** @param {number | null} value */
    const done = (value) => {
      observer.disconnect()
      clearTimeout(timer)
      resolve(value)
    }
    const observer = new MutationObserver(() => {
      if (predicate()) done(performance.now())
    })
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true })
    const timer = setTimeout(() => done(null), timeout)
  })
}

/**
 * One editor taking part in a measurement.
 * @typedef {object} Typed
 * @property {() => any} editor the live Monaco editor (a group's, a pane's, a pane of the aligned view)
 * @property {number} line the editor's own line that is typed on
 * @property {() => Promise<boolean>} focus gives that editor the keyboard with the cursor at the end of the line; true when it has it
 */

/**
 * Types `count` characters (`1`) at the end of a line of one editor with real key presses and measures each one: the time from the
 * keydown to the DOM change that draws the line in the typed editor, and, for each of `others` (editors that show the same line), to the
 * DOM change that draws it there (`p3-common.measureTyping`'s way, for several editors).
 * @param {Harness} h
 * @param {Typed} typed
 * @param {number} count
 * @param {(() => any)[]} [others] editors whose view must draw the typed line too
 */
export async function measureChars(h, typed, count, others = []) {
  const modelLine = () => typed.editor().getModel().getLineContent(typed.line)
  const focused = await typed.focus()
  await h.nativeKeys([{ key: '1' }])
  const settled = async () => (await untilMutation(() => drawnIn(typed.editor().getDomNode(), modelLine()), 15000)) !== null
  let warmed = await settled()
  if (!warmed) {
    await typed.focus()
    await h.nativeKeys([{ key: '1' }])
    warmed = await settled()
  }
  /** @type {number[]} */
  const dom = []
  /** @type {number[][]} */
  const elsewhere = others.map(() => [])
  /** @type {number[]} */
  const keydownAt = []
  let retries = 0
  let lastKeyAt = 0
  const stamp = () => keydownAt.push(performance.now())
  window.addEventListener('keydown', stamp, true)
  try {
    for (let i = 0; i < count; i++) {
      const want = `${modelLine()}1`
      keydownAt.length = 0
      const waits = [typed.editor, ...others].map((editor) => untilMutation(() => drawnIn(editor().getDomNode(), want), 5000))
      await h.nativeKeys([{ key: '1' }])
      let shown = await Promise.all(waits)
      if (shown[0] === null && modelLine() !== want) {
        retries++
        await typed.focus()
        keydownAt.length = 0
        const again = [typed.editor, ...others].map((editor) => untilMutation(() => drawnIn(editor().getDomNode(), want), 5000))
        await h.nativeKeys([{ key: '1' }])
        shown = await Promise.all(again)
      }
      if (shown.some((t) => t === null) || keydownAt.length === 0) break
      await nextPaint()
      lastKeyAt = keydownAt[0]
      dom.push(/** @type {number} */ (shown[0]) - keydownAt[0])
      others.forEach((_, k) => elsewhere[k].push(/** @type {number} */ (shown[k + 1]) - keydownAt[0]))
    }
  } finally {
    window.removeEventListener('keydown', stamp, true)
  }
  const p95 = (/** @type {number[]} */ values) => (values.length > 0 ? Math.round(percentile(values, 95)) : -1)
  return {
    focused,
    warmed,
    retries,
    count: dom.length,
    domP95: p95(dom),
    othersP95: elsewhere.map(p95),
    othersCount: elsewhere.map((e) => e.length),
    samples: dom.map(Math.round),
    lastKeyAt,
  }
}

/**
 * Presses Enter `count` times at the end of a line of a channel pane and measures each: the time from the keydown until the pane and
 * the program both have one line more and the page has changed, plus the frame the caller adds. The line break moves every wait below it,
 * so the view aligns the panes again; that is the work this row is about.
 * @param {Harness} h
 * @param {Typed} typed
 * @param {string} docId the program the pane belongs to
 * @param {number} count
 */
export async function measureEnters(h, typed, docId, count) {
  const ctx = context(h)
  const paneLines = () => typed.editor().getModel().getLineCount()
  const docLines = () => ctx.editor.getLineCount(docId)
  const focused = await typed.focus()
  /** @type {number[]} */
  const dom = []
  /** @type {number[]} */
  const keydownAt = []
  let retries = 0
  const stamp = () => keydownAt.push(performance.now())
  window.addEventListener('keydown', stamp, true)
  try {
    for (let i = 0; i < count; i++) {
      const [pane0, doc0] = [paneLines(), docLines()]
      keydownAt.length = 0
      let waiting = untilMutation(() => paneLines() === pane0 + 1 && docLines() === doc0 + 1, 5000)
      await h.nativeKeys([{ key: 'Enter' }])
      let shown = await waiting
      if (shown === null && paneLines() === pane0) {
        retries++
        await typed.focus()
        keydownAt.length = 0
        waiting = untilMutation(() => paneLines() === pane0 + 1 && docLines() === doc0 + 1, 5000)
        await h.nativeKeys([{ key: 'Enter' }])
        shown = await waiting
      }
      if (shown === null || keydownAt.length === 0) break
      await nextPaint()
      dom.push(shown - keydownAt[0])
    }
  } finally {
    window.removeEventListener('keydown', stamp, true)
  }
  return { focused, retries, count: dom.length, domP95: dom.length > 0 ? Math.round(percentile(dom, 95)) : -1, samples: dom.map(Math.round) }
}
