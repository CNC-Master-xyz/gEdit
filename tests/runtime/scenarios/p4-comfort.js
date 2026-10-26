// P4c, typing help and bookmarks (plan `docs/planning/phase-4-implementation.md` §6.5, P4.12 to P4.15 and H4c; exit
// criteria X26 and X27 that the running app proves): the two typing switches, named bookmarks and their panel,
// Bookmark All Matches from the find widget, Select and Delete Block Range, Insert File and Append File, and the print
// view and Export as HTML. Real key presses where the key is the point (typing, Enter, Cmd+Z, Cmd+F2, Cmd+P).
//
// What only the running app proves (the unit tests use a fake editor and a fake webview):
//   S. the ribbon      the Edit tab's Typing, Bookmarks and Block Range groups and the File tab's Insert and Print groups
//                      hold the commands the plan names, in its order; only Print has a key, Mod+P.
//   A. Auto Space      off until the session switch is on (a profile carries neither flag); `G1` + `x` is `G1 X` and one
//                      undo takes the space and the letter back; the same rule in a Klartext program (`X+10Y`); nothing
//                      changes in a comment or a word that goes on (`GOTO`); an inserted text (a paste) is not a key;
//                      the switch is not saved; off again, the letters stand as typed.
//   B. Enter, Fanuc    the number of the new line is the gap number (N115 between N110 and N120, N122 between N120 and
//                      N125, N140 at the end), the cursor ends behind it, one undo and one redo; no gap (N125, N126) says
//                      so in the status bar and the line break still happens; a comment line, the middle of a line and the
//                      switch off are the editor's Enter, silently; typed `S1200 M3` then Enter still numbers (the
//                      suggestion list a typed word may open does not take Enter in this app).
//   C. Enter, Klartext  the new block takes the next number and every block below follows in the same edit (one undo,
//                      one redo), the continuation line of a block is not renumbered, a line that continues a block is
//                      never numbered, and Enter on the continuation line numbers after the whole block; both switches on
//                      type `l x+1y+1` as `4 L X+1 Y+1`. Both switches off again.
//   D. bookmarks       the prompt (a name is trimmed and its blanks made one; too long or with a control character is
//                      refused in the prompt with the limit named; an empty answer keeps the bookmark and drops the name;
//                      Cancel changes nothing; a line without a bookmark gets one), names that follow their line through
//                      an edit and an undo, names that survive closing and opening the file, the panel (empty text,
//                      rows of every document in tab order with line text, a click jumps and focuses, rename by the pencil
//                      and by a double click, delete, Clear All asks once and counts), Bookmark All Matches from the
//                      find widget (nothing to search, case, regular expression, a bad one, find in selection, names kept,
//                      the cursor not moved), and the 201st bookmark refused by Toggle, Name and the matches.
//   E. block range     the form: the selection's lines prefill, the kind is remembered, every refusal is shown in the
//                      form with its message key and OK stays off; Select selects whole lines, with the blocks in the
//                      status bar; a block with continuation lines is taken whole; Delete is one undo.
//   F. insert, append  Insert before the cursor line in column 1, after it elsewhere, at line 1 below the leading `%` and
//                      the program-start line; Append before the closing `%` (Klartext: before END PGM); the inserted
//                      lines are selected; the warning behind a program end, behind the `%` that ends the tape (and none
//                      in the second program of a file); a file's lone `%` lines are left out and a program start that
//                      lands where blocks follow is warned of; Klartext renumbers the file's blocks and those below in one
//                      undo; a second program start, a program end in the file, a last line ending with `~`, an empty file
//                      and a cancelled dialog change nothing.
//   G. print           Mod+P opens the form, the form's defaults and its remembered values; the print view (`print-view`
//                      with its data attributes, `print-page`, `print-line`) holds the document's lines, the page header,
//                      the colours, the line numbers; a selection prints with the document's own line numbers; a line
//                      wider than the page goes on in a row without a number; more than 20,000 lines are refused; the view
//                      goes at `afterprint`, at the next print and when the document closes. `setPrintFunction` is a stub:
//                      no system dialog is ever opened.
//   H. export          Export as HTML through the stubbed save dialog: the file's name and filter, one page per print page,
//                      the comment's `<`, `&` and quotes escaped, no script; a cancelled dialog writes nothing and says
//                      nothing.
//
//   p4-comfort-names-1/2  Named bookmarks across a restart: tabs that nobody has shown yet have their model but not their bookmarks, so the panel
//                      lists their waiting memo (name, no text; `data-pending="1"`), a click shows the tab first and then
//                      jumps, a delete on such a row changes the memo, and Clear All asks once for all of them.
//
// The programs are `tests/fixtures/p4c/harness/` (its README says which line every check relies on, and
// `tests/unit/p4cHarnessFixtures.test.ts` holds the expected texts of this file to what the core says for them). The
// expected texts below are written out from those programs or come from `ctx.t(...)`; nothing is read back from the app
// except through the test ids and the editors' own models. No fixed sleeps: `h.waitFor`, `h.idle`, `h.turns`.

import { scenario } from '../lib/index.js'
import { setInput } from './m2-common.js'
import { openPath, revealLine } from './m3-common.js'
import { setField } from './m4-common.js'
import { messageIsError } from './m5-common.js'
import { ribbonGroups } from './p3b-common.js'
import { docIdFor, otherRun, quitCleanly, requireFirstRun } from './m7-common.js'
import { clickRibbon, context, guard, lineOf, message, newDoc, pressKey, ready, redoKey as redoPress, ribbonTab, textOf, typeText, undoKey as undoPress } from './p4e-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

// ================================================================================================ expected texts

/**
 * The typed texts of section A (all lower case, as a user types them) and what the document must hold: the profile,
 * the keys, the text. Each row is a rule of plan §6.5 rule 1; `tests/unit/p4cHarnessFixtures.test.ts` replays every
 * row through `decideTyping` with upper-case typing and auto-space on and holds it to the same text.
 */
export const SPACE_CASES = [
  { profile: 'fanuc-gcode', typed: 'g1x5.y2.z-1. f200 (go to) m3', want: 'G1 X5. Y2. Z-1. F200 (go to) M3', why: 'G1X is G1 X, X5.Y is X5. Y, a space already there is not doubled, a comment stays as typed' },
  { profile: 'fanuc-gcode', typed: 'n10g1x5', want: 'N10 G1 X5', why: 'a block number and a word that follows it' },
  { profile: 'fanuc-gcode', typed: '(g1x5)', want: '(g1x5)', why: 'nothing in a comment' },
  { profile: 'fanuc-gcode', typed: 'goto10', want: 'GOTO10', why: 'a letter that goes on with the word is not a new word' },
  { profile: 'heidenhain-klartext', typed: 'l x+10y+5', want: 'L X+10 Y+5', why: 'Klartext words must be separated: X+10Y is X+10 Y' },
]

/** The Klartext program of `klartext-edit.h` after Enter at the end of line 4 (block 3): block 4 is new, every block below follows. */
export const KT_ENTER_4 = [
  '0 BEGIN PGM SHORT MM',
  '1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE',
  '2 TOOL CALL 5 Z S3000',
  '3 L Z+50 R0 FMAX M3',
  '4 ',
  '5 L X+10 Y+10 R0 FMAX',
  '6 L X+90 Y+10 RL ~',
  '  F400',
  '7 L Z-2 F200',
  '8 L Z+50 R0 FMAX M30',
  '9 END PGM SHORT MM',
  '',
]

/** The same program after Enter at the end of line 7, the continuation line of block 5: the new block 6 comes after the whole block. */
export const KT_ENTER_TAIL = [
  '0 BEGIN PGM SHORT MM',
  '1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE',
  '2 TOOL CALL 5 Z S3000',
  '3 L Z+50 R0 FMAX M3',
  '4 L X+10 Y+10 R0 FMAX',
  '5 L X+90 Y+10 RL ~',
  '  F400',
  '6 ',
  '7 L Z-2 F200',
  '8 L Z+50 R0 FMAX M30',
  '9 END PGM SHORT MM',
  '',
]

/** `klartext-edit.h` after Insert File of `insert-klartext.h` at line 5, column 1: the file's blocks are 4 to 6, the blocks below follow. */
export const KT_INSERT = [
  '0 BEGIN PGM SHORT MM',
  '1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE',
  '2 TOOL CALL 5 Z S3000',
  '3 L Z+50 R0 FMAX M3',
  '4 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE',
  '5 L X+1 Y+1 R0 FMAX',
  '6 L Z-1 F100',
  '7 L X+10 Y+10 R0 FMAX',
  '8 L X+90 Y+10 RL ~',
  '  F400',
  '9 L Z-2 F200',
  '10 L Z+50 R0 FMAX M30',
  '11 END PGM SHORT MM',
  '',
]

/** The blocks Insert File says it renumbered in `KT_INSERT`: the file's three (20, 21, 22 became 4, 5, 6) and the five below. */
export const KT_INSERT_RENUMBERED = 8

/** `klartext-edit.h` after Append File of `insert-klartext.h`: before END PGM, the file's blocks are 8 to 10, END PGM is 11. */
export const KT_APPEND = [
  '0 BEGIN PGM SHORT MM',
  '1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE',
  '2 TOOL CALL 5 Z S3000',
  '3 L Z+50 R0 FMAX M3',
  '4 L X+10 Y+10 R0 FMAX',
  '5 L X+90 Y+10 RL ~',
  '  F400',
  '6 L Z-2 F200',
  '7 L Z+50 R0 FMAX M30',
  '8 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE',
  '9 L X+1 Y+1 R0 FMAX',
  '10 L Z-1 F100',
  '11 END PGM SHORT MM',
  '',
]

/** The blocks Append File says it renumbered in `KT_APPEND`: the file's three and END PGM. */
export const KT_APPEND_RENUMBERED = 4

/** Line 4 of `fanuc-edit.nc` after typing ` S1200 M3` at its end (the CODE-1 check of section B). */
export const TYPED_M3_LINE = 'N110 T1 M6 S1200 M3'

/** A Fanuc file of two programs: the second one is where the insert of section F goes (no warning there). */
export const TWO_PROGRAMS = ['%', 'O1', 'N10 G0 X0', 'N20 M30', '%', 'O2', 'N10 G0 X1', 'N20 G0 X2', ''].join('\n')

// ================================================================================================ small helpers

/** The lines of a fixture's text, without the empty last line the final line break makes. @param {string} text */
const linesOf = (text) => text.replace(/\n$/, '').split('\n')

/** `lines` with `extra` put in after line `n` (1-based). @param {string[]} lines @param {number} n @param {string[]} extra */
const after = (lines, n, extra) => [...lines.slice(0, n), ...extra, ...lines.slice(n)]

/**
 * A fixture of `tests/fixtures/p4c/harness/`: a fresh copy in the run folder, its path and its text.
 * @param {Harness} h
 * @param {string} name
 */
async function fixture(h, name) {
  const path = await h.fixture(`p4c/harness/${name}`)
  return { path, text: await h.disk.read(path) }
}

/** The status bar's message carries the error mark. @param {Harness} h */
const isError = (h) => messageIsError(h)

/** Waits until the status bar says nothing, after clearing it (so a later check reads this action's message only). @param {Harness} h */
async function quiet(h) {
  context(h).status.clear()
  await h.waitFor(() => message(h) === '', { timeout: 5000 })
}

/**
 * One key press into the editor, then the page settles.
 * @param {Harness} h
 * @param {string} key
 * @param {string[]} [mods]
 */
async function press(h, key, mods = []) {
  h.focusEditor()
  await pressKey(h, key, mods)
}

/** Cmd+Z in the editor (the editor gets the keyboard first). @param {Harness} h */
async function undoKey(h) {
  h.focusEditor()
  await undoPress(h)
}

/** Cmd+Shift+Z in the editor. @param {Harness} h */
async function redoKey(h) {
  h.focusEditor()
  await redoPress(h)
}

/**
 * Puts the cursor at the end of line `line` of `id`, gives the editor the keyboard and presses Enter.
 * @param {Harness} h
 * @param {string} id
 * @param {number} line
 * @param {number} [column] default: the end of the line
 */
async function enterAt(h, id, line, column) {
  const text = lineOf(h, id, line)
  await revealLine(h, id, line, column ?? text.length + 1)
  await press(h, 'Enter')
}

/**
 * Clicks a ribbon switch (a toggle on the Edit tab) and gives the keyboard back to the editor.
 * @param {Harness} h
 * @param {string} command
 */
async function toggleSwitch(h, command) {
  const done = await clickRibbon(h, 'edit', command)
  if (!done) throw new Error(`${command} is not on offer`)
  h.focusEditor()
}

/**
 * The state of one document's bookmarks as the panel and the service report it.
 * @param {Harness} h
 * @param {string} id
 */
const marksOf = (h, id) => context(h).bookmarks.list(id).map((b) => ({ line: b.line, name: b.name ?? null }))

/** The rows of the bookmark panel. @param {Harness} h */
const panelRows = (h) =>
  h.qa('bookmark-row').map((row) => ({
    el: row,
    docId: row.dataset.docId ?? '',
    line: Number(row.dataset.line ?? '0'),
    named: row.dataset.named === 'true',
    pending: row.dataset.pending === '1',
    name: row.querySelector('[data-testid="bookmark-row-name"]')?.textContent?.trim() ?? '',
    text: row.textContent ?? '',
  }))

/**
 * Answers the one-line prompt that is on screen (`bookmark.rename`).
 * @param {Harness} h
 * @param {{ answer?: string, cancel?: boolean }} o
 * @returns {Promise<{ initial: string, error: string | undefined, okDisabled: boolean }>} what the prompt showed before it was answered
 */
async function answerPrompt(h, { answer, cancel = false }) {
  await h.waitFor(() => h.q('modal', { modal: 'prompt' }), { timeout: 8000 })
  const input = /** @type {HTMLInputElement | null} */ (h.q('form-field', { field: 'value' }))
  if (!input) throw new Error('the prompt has no input')
  const initial = input.value
  if (answer !== undefined) setInput(input, answer)
  await h.frame()
  const shown = { initial, error: input.dataset.error, okDisabled: /** @type {HTMLButtonElement | null} */ (h.q('modal-ok'))?.disabled === true }
  h.click(h.q(cancel ? 'modal-cancel' : 'modal-ok'))
  await h.waitFor(() => !h.q('modal'), { timeout: 8000 })
  return shown
}

/**
 * Runs `bookmark.rename` (for the cursor's line, or the row it is given) and answers its prompt.
 * @param {Harness} h
 * @param {{ answer?: string, cancel?: boolean }} o
 * @param {{ docId: string, line: number }} [row]
 */
async function renameBookmark(h, o, row) {
  const running = context(h).commands.run('bookmark.rename', row)
  const shown = await answerPrompt(h, o)
  await running
  await h.idle()
  return shown
}

/**
 * Opens the form of a range command. `running` is the promise of the command, which settles only when the form is
 * answered, so it is wrapped: awaiting `openForm` must not wait for it.
 * @param {Harness} h
 * @param {string} command
 */
async function openForm(h, command) {
  const running = context(h).commands.run(command)
  await h.waitFor(() => h.q('modal', { modal: 'form' }), { timeout: 8000 })
  return { running }
}

/** The field of the form on screen. @param {Harness} h @param {string} id */
const field = (h, id) => h.q('form-field', { field: id })

/** What the open form refuses: the message key of each field and of the form, and whether OK is off. @param {Harness} h */
function refusal(h) {
  const keys = ['kind', 'from', 'to'].map((id) => field(h, id)?.dataset.error ?? '')
  return {
    from: keys[1],
    to: keys[2],
    form: h.q('template-preview')?.dataset.error ?? '',
    okDisabled: /** @type {HTMLButtonElement | null} */ (h.q('modal-ok'))?.disabled === true,
  }
}

/**
 * Answers the open form: fills `fields`, presses OK (or Cancel) and waits for the command.
 * @param {Harness} h
 * @param {Promise<unknown>} running
 * @param {Record<string, string | number | boolean>} fields
 * @param {boolean} [cancel]
 */
async function answerForm(h, running, fields, cancel = false) {
  for (const [id, value] of Object.entries(fields)) setField(h, id, value)
  await h.frame()
  h.click(h.q(cancel ? 'modal-cancel' : 'modal-ok'))
  await h.waitFor(() => !h.q('modal'), { timeout: 8000 })
  await running
  await h.idle()
}

/**
 * Runs Insert File or Append File with a queued file dialog.
 * @param {Harness} h
 * @param {'file.insertFile' | 'file.appendFile'} command
 * @param {string | null} path the file the dialog answers, or null for Cancel
 */
async function insertFrom(h, command, path) {
  await h.dialogs.queue('open', path)
  await context(h).commands.run(command)
  await h.idle()
}

/** The find widget's own state, from the focused editor. @param {Harness} h */
function findState(h) {
  const editor = /** @type {any} */ (context(h).editor.editorInstance())
  const controller = editor?.getContribution('editor.contrib.findController')
  const state = controller?.getState?.()
  if (!state) throw new Error('the find controller has no state')
  return state
}

/** Opens the find widget and waits until it shows. @param {Harness} h */
async function openFind(h) {
  await context(h).commands.run('edit.find')
  await h.waitFor(() => !!document.querySelector('.find-widget.visible'), { timeout: 8000 })
  await h.idle()
}

// ================================================================================================ p4-comfort

scenario('p4-comfort', { timeout: 900 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const FANUC = await fixture(h, 'fanuc-edit.nc')
  const KLARTEXT = await fixture(h, 'klartext-edit.h')
  const fanucLines = linesOf(FANUC.text)
  const klartextLines = linesOf(KLARTEXT.text)

  // ============================================================ S. the commands and the ribbon
  await guard(h, 'S. the ribbon', async () => {
    /** @param {string} tab @param {string} labelKey */
    const group = async (tab, labelKey) => {
      await ribbonTab(h, tab)
      return ribbonGroups(h).find((g) => g.label === ctx.t(labelKey))?.commands ?? []
    }
    const typing = await group('edit', 'typing.group')
    h.check('Edit, Typing: Upper-Case Typing, then Auto Space and Automatic Block Number', typing.join() === 'edit.toggleForceUppercase,edit.toggleAutoSpace,edit.toggleAutoNumber', typing)
    const marks = await group('edit', 'bookmarks.group')
    h.check('Edit, Bookmarks: toggle, next, previous, name, all matches, the panel', marks.join() === 'bookmark.toggle,bookmark.next,bookmark.prev,bookmark.rename,bookmark.addAllMatches,view.toggleBookmarks', marks)
    const ranges = await group('edit', 'ranges.group')
    h.check('Edit, Block Range: Select and Delete', ranges.join() === 'edit.selectBlockRange,edit.deleteBlockRange', ranges)
    const inserts = await group('file', 'insertFile.group')
    h.check('File, Insert: Insert File and Append File', inserts.join() === 'file.insertFile,file.appendFile', inserts)
    const prints = await group('file', 'print.group')
    h.check('File, Print: Print and Export as HTML', prints.join() === 'file.print,file.exportHtml', prints)
    const panels = await group('view', 'view.groupPanels')
    h.check('View, Panels: the bookmark panel is there too', panels.includes('view.toggleBookmarks'), panels)
    h.check('Print is Mod+P, and none of the other new commands carries a key', ctx.commands.get('file.print')?.keys === 'Mod+P' && ['edit.toggleAutoSpace', 'edit.toggleAutoNumber', 'bookmark.rename', 'bookmark.addAllMatches', 'view.toggleBookmarks', 'edit.selectBlockRange', 'edit.deleteBlockRange', 'file.insertFile', 'file.appendFile', 'file.exportHtml'].every((c) => ctx.commands.get(c) !== undefined && ctx.commands.get(c)?.keys === undefined), ctx.commands.get('file.print')?.keys)
    const profile = ctx.profiles.profile('fanuc-gcode')
    const klartext = ctx.profiles.profile('heidenhain-klartext')
    h.check('no built-in profile carries either typing flag (absent is off)', [profile, klartext].every((p) => p.editing?.autoSpace === undefined && p.editing?.autoNumber === undefined), [profile.editing, klartext.editing])
  })

  // ============================================================ A. Auto Space
  await guard(h, 'A. Auto Space', async () => {
    const untouched = await newDoc(h, '', 'fanuc-gcode')
    h.focusEditor()
    await typeText(h, 'g1x5.')
    h.check('off until it is switched on: the profile asks for nothing, so G1X5. stays one word (the capitals are the upper-case typing)', textOf(h, untouched) === 'G1X5.', textOf(h, untouched))

    await toggleSwitch(h, 'edit.toggleAutoSpace')
    h.check('the switch says it is on, for this session', message(h) === ctx.t('typing.spaceOn'), message(h))

    // One keystroke, one undo step: the space and the letter go together.
    const one = await newDoc(h, 'G1', 'fanuc-gcode')
    await revealLine(h, one, 1, 3)
    await press(h, 'x')
    h.check('X typed behind G1 is G1 X: the space and the capital', textOf(h, one) === 'G1 X', textOf(h, one))
    await undoKey(h)
    h.check('one undo takes the space and the letter back together', textOf(h, one) === 'G1', JSON.stringify(textOf(h, one)))

    for (const c of SPACE_CASES) {
      const id = await newDoc(h, '', c.profile)
      h.focusEditor()
      await typeText(h, c.typed)
      h.check(`${c.profile}: ${c.typed} gives ${c.want} (${c.why})`, textOf(h, id) === c.want, { got: textOf(h, id), want: c.want })
    }
    await press(h, 'Escape')

    // What is not a key is not touched.
    const pasted = await newDoc(h, '', 'fanuc-gcode')
    h.focusEditor()
    await h.insertText('G1X5')
    await h.idle()
    h.check('an inserted text (a paste, an input method) is not a key press: G1X5 stays', textOf(h, pasted) === 'G1X5', textOf(h, pasted))

    // The switch is for the session and every document, and is never saved.
    const saved = JSON.stringify(await h.config.read('settings.json')) + JSON.stringify(await h.config.read('state.json'))
    h.check('the switch is saved nowhere: neither settings.json nor state.json mention it', !/autoSpace|toggleAutoSpace/i.test(saved))

    await toggleSwitch(h, 'edit.toggleAutoSpace')
    h.check('the next press switches it off and says so', message(h) === ctx.t('typing.spaceOff'), message(h))
    const off = await newDoc(h, '', 'fanuc-gcode')
    h.focusEditor()
    await typeText(h, 'g1x5.')
    h.check('off again: G1X5. is one word again', textOf(h, off) === 'G1X5.', textOf(h, off))
  })

  // ============================================================ B. Enter, a Fanuc program
  await guard(h, 'B. Enter, Fanuc', async () => {
    const id = await newDoc(h, FANUC.text, 'fanuc-gcode')
    // The switch is off: the editor's Enter, nothing else.
    await enterAt(h, id, 4)
    h.check('with the switch off Enter is the editor\'s: an empty line, no number', textOf(h, id) === after(fanucLines, 4, ['']).concat('').join('\n'), textOf(h, id))
    await undoKey(h)
    h.check('(one undo puts the program back)', textOf(h, id) === FANUC.text, textOf(h, id))

    await toggleSwitch(h, 'edit.toggleAutoNumber')
    h.check('the switch says it is on, for this session', message(h) === ctx.t('typing.numberOn'), message(h))

    // The gap number: N110, a comment line, N120 -> N115.
    await enterAt(h, id, 4)
    h.check('Enter at the end of N110 starts N115: the step would reach N120, so the number between (the comment line is passed over)', textOf(h, id) === after(fanucLines, 4, ['N115 ']).concat('').join('\n'), textOf(h, id))
    h.check('the cursor stands behind the number, on the new line', h.app.cursor().line === 5 && h.app.cursor().column === 6, h.app.cursor())
    await undoKey(h)
    h.check('the line break and the number are one undo step', textOf(h, id) === FANUC.text, textOf(h, id))
    await redoKey(h)
    h.check('and one redo', textOf(h, id) === after(fanucLines, 4, ['N115 ']).concat('').join('\n'), textOf(h, id))
    await undoKey(h)

    await enterAt(h, id, 6)
    h.check('N120 above N125: N122 (the number halfway between)', lineOf(h, id, 7) === 'N122 ' && textOf(h, id) === after(fanucLines, 6, ['N122 ']).concat('').join('\n'), textOf(h, id))
    await undoKey(h)
    await enterAt(h, id, 9)
    h.check('N130 M30 with nothing numbered below: N140, the profile\'s step', lineOf(h, id, 10) === 'N140 ', lineOf(h, id, 10))
    await undoKey(h)

    // No gap: the line break happens, nothing else, and the status bar says why.
    await quiet(h)
    await enterAt(h, id, 7)
    h.check('N125 above N126: no number fits, the line break still happens and the program is otherwise as it was', textOf(h, id) === after(fanucLines, 7, ['']).concat('').join('\n'), textOf(h, id))
    // A plain sentence, not an error: the line break happened and nothing went wrong (plan 6.5 rule 2, `docs/user/editing.md`: "the status bar says why").
    h.check('and the status bar names the two blocks', message(h) === ctx.t('typing.numberNoGap', { from: 'N125', to: 'N126' }) && !isError(h), { message: message(h), error: isError(h) })
    await undoKey(h)

    // Silent plain Enter: a comment line, the middle of a line.
    await quiet(h)
    await enterAt(h, id, 5)
    h.check('a comment line has no block number: the editor\'s Enter, and nothing is said', textOf(h, id) === after(fanucLines, 5, ['']).concat('').join('\n') && message(h) === '', { text: textOf(h, id), message: message(h) })
    await undoKey(h)
    await enterAt(h, id, 6, 5)
    h.check('Enter in the middle of a line splits it as the editor does, with no number', ctx.editor.getLineCount(id) === fanucLines.length + 2 && lineOf(h, id, 6) === 'N120' && lineOf(h, id, 7).trim() === 'G1 X5. F200.' && message(h) === '', { line6: lineOf(h, id, 6), line7: lineOf(h, id, 7) })
    await undoKey(h)
    h.check('(the program is whole again)', textOf(h, id) === FANUC.text, textOf(h, id))

    // The number is typed text: more typing goes on behind it.
    await enterAt(h, id, 4)
    await typeText(h, 'g1x6.')
    h.check('typing goes on behind the number, in capitals, and Auto Space (off) is a switch of its own: N115 G1X6.', lineOf(h, id, 5) === 'N115 G1X6.' && lineOf(h, id, 7) === 'N120 G1 X5. F200.', { line5: lineOf(h, id, 5), line7: lineOf(h, id, 7) })
    await press(h, 'Escape')

    // A typed word can open the suggestion list (M3, M6, T words). Enter in this app never accepts a suggestion,
    // so the number still comes (review CODE-1).
    const typed = await newDoc(h, FANUC.text, 'fanuc-gcode')
    await revealLine(h, typed, 4, lineOf(h, typed, 4).length + 1)
    h.focusEditor()
    await typeText(h, ' S1200 M3')
    const listOpen = document.querySelector('.suggest-widget.visible') !== null
    await press(h, 'Enter')
    h.check('S1200 M3 typed at the end of N110, then Enter: the new line still starts with N115', lineOf(h, typed, 4) === TYPED_M3_LINE && textOf(h, typed) === after([...fanucLines.slice(0, 3), TYPED_M3_LINE, ...fanucLines.slice(4)], 4, ['N115 ']).concat('').join('\n'), { lines: textOf(h, typed).split('\n'), listOpen })
    h.check('and the cursor stands behind the number', h.app.cursor().line === 5 && h.app.cursor().column === 6, h.app.cursor())
    await press(h, 'Escape')
  })

  // ============================================================ C. Enter, a Klartext program
  await guard(h, 'C. Enter, Klartext', async () => {
    const id = await newDoc(h, KLARTEXT.text, 'heidenhain-klartext')
    const text = (/** @type {string[]} */ lines) => lines.join('\n')
    await quiet(h)
    await enterAt(h, id, 4)
    h.check('Enter at the end of block 3: block 4 is new and every block below follows (the continuation line is not touched, END PGM is renumbered)', textOf(h, id) === text(KT_ENTER_4), { got: textOf(h, id).split('\n'), want: KT_ENTER_4 })
    h.check('the cursor stands behind the number, on the new line', h.app.cursor().line === 5 && h.app.cursor().column === 3, h.app.cursor())
    await undoKey(h)
    h.check('five changed lines, one undo step: the program is as it was', textOf(h, id) === KLARTEXT.text, textOf(h, id))
    await redoKey(h)
    h.check('and one redo brings the numbers back', textOf(h, id) === text(KT_ENTER_4), textOf(h, id))
    await undoKey(h)

    // A line that continues a block is never numbered.
    await enterAt(h, id, 6)
    h.check('Enter at the end of the line that ends with ~ is the editor\'s: the next line would be the block\'s tail, so no number and no shifts', textOf(h, id) === after(klartextLines, 6, ['']).concat('').join('\n') && message(h) === '', { text: textOf(h, id).split('\n'), message: message(h) })
    await undoKey(h)
    await enterAt(h, id, 7)
    h.check('Enter at the end of the continuation line numbers after the whole block: the base block is block 5', textOf(h, id) === text(KT_ENTER_TAIL), { got: textOf(h, id).split('\n'), want: KT_ENTER_TAIL })
    await undoKey(h)
    h.check('(and one undo again)', textOf(h, id) === KLARTEXT.text, textOf(h, id))

    // Both switches on: the number, then words that need their blanks.
    await toggleSwitch(h, 'edit.toggleAutoSpace')
    await enterAt(h, id, 4)
    await typeText(h, 'l x+1y+1')
    h.check('both switches on: the number, then L X+1 Y+1 with the blank before Y', lineOf(h, id, 5) === '4 L X+1 Y+1' && lineOf(h, id, 6) === '5 L X+10 Y+10 R0 FMAX', { line5: lineOf(h, id, 5), line6: lineOf(h, id, 6) })
    await press(h, 'Escape')

    // Both off again: the next sections type plain text.
    await toggleSwitch(h, 'edit.toggleAutoSpace')
    h.check('Auto Space off again', message(h) === ctx.t('typing.spaceOff'), message(h))
    await toggleSwitch(h, 'edit.toggleAutoNumber')
    h.check('Automatic Block Number off again', message(h) === ctx.t('typing.numberOff'), message(h))
    const saved = JSON.stringify(await h.config.read('settings.json')) + JSON.stringify(await h.config.read('state.json'))
    h.check('neither switch is saved anywhere', !/autoNumber|autoSpace|toggleAutoNumber|toggleAutoSpace/i.test(saved))
  })

  // ============================================================ D. bookmarks
  const bookmarkPath = `${h.cfg.run}/bookmarks/bookmarks.nc`
  await h.disk.copy(FANUC.path, bookmarkPath)
  /** @type {string} */
  let bm = ''
  await guard(h, 'D1. the panel is empty, then the names', async () => {
    bm = (await openPath(h, bookmarkPath)).id
    await clickRibbon(h, 'edit', 'view.toggleBookmarks')
    await h.waitFor(() => h.q('bookmarks-panel'), { timeout: 8000 })
    h.check('the panel is open and says there is no bookmark yet, with the key of Toggle Bookmark', h.q('bookmarks-empty') !== null && h.q('bookmarks-panel')?.dataset.count === '0' && /^No bookmarks yet\./.test(h.q('bookmarks-empty')?.textContent?.trim() ?? '') && /F2/.test(h.q('bookmarks-empty')?.textContent ?? ''), h.q('bookmarks-empty')?.textContent)

    // A name: trimmed, the blanks made one.
    await revealLine(h, bm, 4, 1)
    let shown = await renameBookmark(h, { answer: '  Tool   one ' })
    h.check('Name Bookmark on a line without one: the prompt starts empty', shown.initial === '', shown)
    h.check('and the answer sets the bookmark and its name, trimmed, with its blanks made one', JSON.stringify(marksOf(h, bm)) === JSON.stringify([{ line: 4, name: 'Tool one' }]), marksOf(h, bm))
    h.check('the status bar says what it is called', message(h) === ctx.t('bookmarks.named', { name: 'Tool one' }), message(h))
    await h.waitFor(() => h.q('bookmarks-panel')?.dataset.count === '1', { timeout: 5000 })
    h.check('the open panel followed: one row, named', panelRows(h).length === 1 && panelRows(h)[0].named && panelRows(h)[0].name === 'Tool one' && panelRows(h)[0].line === 4, panelRows(h).map((r) => ({ line: r.line, name: r.name })))

    // Cancel changes nothing; the current name is prefilled.
    shown = await renameBookmark(h, { answer: 'Other', cancel: true })
    h.check('on a named line the prompt starts with the name, and Cancel changes nothing', shown.initial === 'Tool one' && JSON.stringify(marksOf(h, bm)) === JSON.stringify([{ line: 4, name: 'Tool one' }]), { shown, marks: marksOf(h, bm) })

    // The limit and the control characters are said in the prompt, nothing is cut.
    await revealLine(h, bm, 6, 1)
    const running = ctx.commands.run('bookmark.rename')
    await h.waitFor(() => h.q('modal', { modal: 'prompt' }), { timeout: 8000 })
    const input = /** @type {HTMLInputElement} */ (h.q('form-field', { field: 'value' }))
    setInput(input, 'x'.repeat(61))
    await h.frame()
    h.check('a name of 61 characters is refused in the prompt with the limit, and OK is off', input.dataset.error === 'bookmarks.nameTooLong' && /** @type {HTMLButtonElement} */ (h.q('modal-ok')).disabled, { error: input.dataset.error })
    setInput(input, 'x'.repeat(60))
    await h.frame()
    h.check('60 characters are fine', input.dataset.error === undefined && !(/** @type {HTMLButtonElement} */ (h.q('modal-ok')).disabled), input.dataset.error)
    setInput(input, 'a\u0007b')
    await h.frame()
    h.check('a control character is refused too', input.dataset.error === 'bookmarks.nameInvalid', input.dataset.error)
    setInput(input, 'Pass two')
    await h.frame()
    h.click(h.q('modal-ok'))
    await h.waitFor(() => !h.q('modal'), { timeout: 8000 })
    await running
    await h.idle()
    h.check('line 6 is bookmarked as "Pass two"', JSON.stringify(marksOf(h, bm)) === JSON.stringify([{ line: 4, name: 'Tool one' }, { line: 6, name: 'Pass two' }]), marksOf(h, bm))

    // An empty answer keeps the bookmark and drops the name.
    shown = await renameBookmark(h, { answer: '' })
    h.check('an empty answer keeps the bookmark and removes only the name, and says so', JSON.stringify(marksOf(h, bm)) === JSON.stringify([{ line: 4, name: 'Tool one' }, { line: 6, name: null }]) && message(h) === ctx.t('bookmarks.nameRemoved') && shown.initial === 'Pass two', { marks: marksOf(h, bm), message: message(h) })
    await renameBookmark(h, { answer: 'Pass two' })

    // A line without a bookmark gets one with its name.
    await revealLine(h, bm, 9, 1)
    await renameBookmark(h, { answer: 'End' })
    h.check('a line without a bookmark gets one by being named', JSON.stringify(marksOf(h, bm).map((m) => m.line)) === '[4,6,9]' && marksOf(h, bm)[2].name === 'End', marksOf(h, bm))

    // Toggling off takes the name with it.
    await press(h, 'F2', ['cmd'])
    await h.waitFor(() => !ctx.bookmarks.lines(bm).includes(9), { timeout: 5000 })
    await press(h, 'F2', ['cmd'])
    await h.waitFor(() => ctx.bookmarks.lines(bm).includes(9), { timeout: 5000 })
    h.check('toggled off and on again, the bookmark has lost its name', marksOf(h, bm)[2]?.line === 9 && marksOf(h, bm)[2]?.name === null, marksOf(h, bm))
    await press(h, 'F2', ['cmd'])
    await h.waitFor(() => !ctx.bookmarks.lines(bm).includes(9), { timeout: 5000 })

    // The name follows its line through an edit and an undo.
    await revealLine(h, bm, 1, 1)
    await press(h, 'Enter')
    h.check('a line break above moves the bookmarks down and the names with them', JSON.stringify(marksOf(h, bm)) === JSON.stringify([{ line: 5, name: 'Tool one' }, { line: 7, name: 'Pass two' }]), marksOf(h, bm))
    await undoKey(h)
    h.check('and the undo moves both back', JSON.stringify(marksOf(h, bm)) === JSON.stringify([{ line: 4, name: 'Tool one' }, { line: 6, name: 'Pass two' }]), marksOf(h, bm))
  })

  await guard(h, 'D2. the names survive closing and opening the file', async () => {
    await h.waitFor(() => ctx.docs.get(bm)?.dirty === false, { timeout: 5000 })
    await ctx.commands.run('file.close')
    await h.waitFor(() => !ctx.docs.get(bm), { timeout: 8000 })
    h.check('closing the file took its rows out of the panel', panelRows(h).every((r) => r.docId !== bm), panelRows(h).length)
    const memo = ctx.fileMemory.get(bookmarkPath)
    h.check('the memo beside the file holds the lines and, in a member of its own, the names', JSON.stringify(memo?.bookmarks) === '[4,6]' && JSON.stringify(memo?.bookmarkNames) === JSON.stringify([{ line: 4, name: 'Tool one' }, { line: 6, name: 'Pass two' }]), memo)
    await ctx.uiState.flush()
    const state = /** @type {any} */ (await h.config.read('state.json'))
    h.check('and state.json has them', JSON.stringify(state?.ui?.files?.[bookmarkPath]?.bookmarkNames) === JSON.stringify([{ line: 4, name: 'Tool one' }, { line: 6, name: 'Pass two' }]), state?.ui?.files?.[bookmarkPath])
    bm = (await openPath(h, bookmarkPath)).id
    await h.waitFor(() => marksOf(h, bm).length === 2, { timeout: 8000 })
    h.check('the file opened again has its bookmarks and their names', JSON.stringify(marksOf(h, bm)) === JSON.stringify([{ line: 4, name: 'Tool one' }, { line: 6, name: 'Pass two' }]), marksOf(h, bm))
    ctx.bookmarks.toggle(bm, 9)
    ctx.bookmarks.setName(bm, 9, 'End')
  })

  await guard(h, 'D3. the panel', async () => {
    // A second document with marks of its own, after the first in tab order.
    const other = await newDoc(h, 'G0 X1.\nG0 X2.\nG0 X3.\nM30\n', 'fanuc-gcode')
    ctx.bookmarks.toggle(other, 2)
    ctx.bookmarks.setName(other, 3, 'Second document')
    await h.waitFor(() => h.q('bookmarks-panel')?.dataset.count === '5', { timeout: 8000 })
    let rows = panelRows(h)
    h.check('the panel lists the bookmarks of every open document, in tab order and then by line', JSON.stringify(rows.map((r) => `${r.docId === bm ? 'bm' : 'other'}:${r.line}`)) === JSON.stringify(['bm:4', 'bm:6', 'bm:9', 'other:2', 'other:3']), rows.map((r) => `${r.docId}:${r.line}`))
    h.check('each row carries the name (empty for none) and the line\'s text', rows[0].name === 'Tool one' && rows[0].text.includes('N110 T1 M6') && rows[2].name === 'End' && rows[3].name === '' && !rows[3].named && rows[3].text.includes('G0 X2.') && rows[4].named && rows[4].text.includes('Second document'), rows.map((r) => ({ line: r.line, name: r.name })))
    h.check('and says that none of them waits for a model', rows.every((r) => !r.pending), rows.map((r) => r.pending))

    // A click jumps: the document comes to the front and the line is shown, the editor has the keyboard.
    h.check('the second document is in front', h.q('editor-host')?.dataset.docId === other)
    h.click(rows[1].el.querySelector('button'))
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === bm && h.app.cursor().line === 6, { timeout: 8000 })
    await h.idle()
    h.check('a click on a row of the other document brings it to the front, on that line, with the editor focused', h.q('editor-host')?.dataset.docId === bm && h.app.cursor().line === 6 && !!h.q('editor-host')?.contains(document.activeElement), { doc: h.q('editor-host')?.dataset.docId, cursor: h.app.cursor() })

    // Rename by the pencil, by a double click; delete.
    const pencil = (/** @type {number} */ i) => panelRows(h)[i].el.querySelectorAll('button')[1]
    h.click(pencil(1))
    const pencilShown = await answerPrompt(h, { answer: 'Pass 2' })
    await h.waitFor(() => panelRows(h)[1]?.name === 'Pass 2', { timeout: 5000 })
    h.check('the pencil asks for that row\'s name, prefilled, and the row shows the new name', pencilShown.initial === 'Pass two' && panelRows(h)[1].name === 'Pass 2' && marksOf(h, bm)[1].name === 'Pass 2', { pencilShown, rows: panelRows(h).map((r) => r.name) })

    const nameCell = panelRows(h)[0].el.querySelector('[data-testid="bookmark-row-name"]')
    nameCell?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    const doubled = await answerPrompt(h, { answer: 'Never used', cancel: true })
    h.check('a double click on a name asks for it too (Cancel changed nothing)', doubled.initial === 'Tool one' && marksOf(h, bm)[0].name === 'Tool one', { doubled, marks: marksOf(h, bm) })

    const del = h.q('bookmark-row-delete', { 'data-doc-id': bm, 'data-line': 9 })
    h.click(del)
    await h.waitFor(() => !ctx.bookmarks.lines(bm).includes(9), { timeout: 5000 })
    await h.waitFor(() => h.q('bookmarks-panel')?.dataset.count === '4', { timeout: 5000 })
    h.check('a row\'s delete button removes that bookmark and its name', JSON.stringify(ctx.bookmarks.lines(bm)) === '[4,6]' && panelRows(h).length === 4, { lines: ctx.bookmarks.lines(bm), rows: panelRows(h).length })

    // Clear All asks once, with the count.
    rows = panelRows(h)
    h.click(h.q('bookmarks-clear-all'))
    const ask = await h.alert.wait()
    h.check('Clear All asks, naming the count of every open document\'s bookmarks', (ask?.texts ?? []).some((t) => t.includes(ctx.t('bookmarks.clearAllConfirm', { count: 4 }))) && (ask?.buttons ?? []).includes(ctx.t('bookmarks.clearAllOk')), ask)
    await h.alert.click(ctx.t('common.cancel'))
    await h.turns(6)
    h.check('Cancel keeps all four', panelRows(h).length === 4 && ctx.bookmarks.lines(bm).length === 2 && ctx.bookmarks.lines(other).length === 2, panelRows(h).length)
    h.click(h.q('bookmarks-clear-all'))
    await h.alert.wait()
    await h.alert.click(ctx.t('bookmarks.clearAllOk'))
    await h.waitFor(() => h.q('bookmarks-empty'), { timeout: 8000 })
    h.check('the confirmation removes the bookmarks and names of every open document and the panel is empty again', ctx.bookmarks.lines(bm).length === 0 && ctx.bookmarks.lines(other).length === 0 && h.q('bookmarks-panel')?.dataset.count === '0', { bm: ctx.bookmarks.lines(bm), other: ctx.bookmarks.lines(other) })
    h.check('and the status bar counts them', message(h) === ctx.t('bookmarks.cleared', { count: 4 }), message(h))
  })

  await guard(h, 'D4. Bookmark All Matches', async () => {
    const id = await newDoc(h, 'G1 X1.\nG0 X2.\ng1 x3.\nG01 X4.\nM3\nG1 X5.\n', 'fanuc-gcode')
    ctx.bookmarks.setName(id, 3, 'keep me')
    const lines = () => JSON.stringify(ctx.bookmarks.lines(id))
    await revealLine(h, id, 5, 1)

    // Nothing to search.
    await ctx.commands.run('bookmark.addAllMatches')
    await h.idle()
    h.check('with no search in the find widget it says what to do and marks nothing beyond line 3', message(h) === ctx.t('bookmarks.noSearch') && lines() === '[3]', { message: message(h), lines: lines() })

    await openFind(h)
    const state = findState(h)
    const cursor = h.app.cursor()
    state.change({ searchString: 'G1', isRegex: false, matchCase: false, wholeWord: false }, false)
    await h.idle()
    await ctx.commands.run('bookmark.addAllMatches')
    await h.idle()
    h.check('the widget\'s search G1 (any case) bookmarks lines 1, 3 and 6, and says one already had one', lines() === '[1,3,6]' && message(h) === ctx.t('bookmarks.matchedSome', { count: 3, already: 1 }), { lines: lines(), message: message(h) })
    h.check('the bookmark that was there keeps its name', marksOf(h, id).find((m) => m.line === 3)?.name === 'keep me', marksOf(h, id))
    h.check('and the cursor did not move', h.app.cursor().line === cursor.line && h.app.cursor().column === cursor.column, { before: cursor, after: h.app.cursor() })

    await ctx.commands.run('bookmark.addAllMatches')
    await h.idle()
    h.check('again: every matching line already has one, and it says so', lines() === '[1,3,6]' && message(h) === ctx.t('bookmarks.allHad', { count: 3 }), { lines: lines(), message: message(h) })

    ctx.bookmarks.clear(id)
    state.change({ matchCase: true }, false)
    await h.idle()
    await ctx.commands.run('bookmark.addAllMatches')
    await h.idle()
    h.check('with "match case" on, g1 on line 3 is not a match: lines 1 and 6', lines() === '[1,6]' && message(h) === ctx.t('bookmarks.matched', { count: 2 }), { lines: lines(), message: message(h) })

    state.change({ matchCase: false, isRegex: true, searchString: 'G0?1' }, false)
    await h.idle()
    await ctx.commands.run('bookmark.addAllMatches')
    await h.idle()
    h.check('a regular expression G0?1 adds the lines it finds: 3 and 4 are new, 1 and 6 were there', lines() === '[1,3,4,6]' && message(h) === ctx.t('bookmarks.matchedSome', { count: 4, already: 2 }), { lines: lines(), message: message(h) })

    state.change({ searchString: 'ZZZ' }, false)
    await h.idle()
    await ctx.commands.run('bookmark.addAllMatches')
    await h.idle()
    h.check('a search nothing matches changes nothing and says so', lines() === '[1,3,4,6]' && message(h) === ctx.t('bookmarks.noMatch'), { lines: lines(), message: message(h) })
    state.change({ searchString: '(' }, false)
    await h.idle()
    await ctx.commands.run('bookmark.addAllMatches')
    await h.idle()
    h.check('a regular expression that does not compile is "no match", not an error', lines() === '[1,3,4,6]' && message(h) === ctx.t('bookmarks.noMatch'), { lines: lines(), message: message(h) })

    // Find in selection: lines 1 and 2 only.
    ctx.bookmarks.clear(id)
    state.change({ isRegex: false, searchString: 'X', searchScope: [{ startLineNumber: 1, startColumn: 1, endLineNumber: 2, endColumn: 7 }] }, false)
    await h.idle()
    await ctx.commands.run('bookmark.addAllMatches')
    await h.idle()
    h.check('with "find in selection" the matches of the selected lines only: 1 and 2', lines() === '[1,2]', { lines: lines(), message: message(h) })
    state.change({ searchScope: null }, false)
    ctx.editor.triggerAction('closeFindWidget')
    await h.idle()
  })

  await guard(h, 'D5. the 201st bookmark', async () => {
    const rowsText = Array.from({ length: 250 }, (_, i) => (i < 200 ? `G1 X${i + 1}. (BM)` : `G0 X${i + 1}.`))
    const id = await newDoc(h, `${rowsText.join('\n')}\n`, 'fanuc-gcode')
    await openFind(h)
    const state = findState(h)
    state.change({ searchString: 'G', isRegex: false, matchCase: false, wholeWord: false, searchScope: null }, false)
    await h.idle()
    await ctx.commands.run('bookmark.addAllMatches')
    await h.idle()
    h.check('250 lines match and a document keeps 200: all or nothing, with both counts, nothing is marked', ctx.bookmarks.lines(id).length === 0 && message(h) === ctx.t('bookmarks.tooMany', { count: 250, max: 200 }) && isError(h), { count: ctx.bookmarks.lines(id).length, message: message(h) })

    state.change({ searchString: '(BM)' }, false)
    await h.idle()
    await ctx.commands.run('bookmark.addAllMatches')
    await h.idle()
    h.check('200 lines match: all 200 are bookmarked', ctx.bookmarks.lines(id).length === 200 && message(h) === ctx.t('bookmarks.matched', { count: 200 }), { count: ctx.bookmarks.lines(id).length, message: message(h) })
    ctx.editor.triggerAction('closeFindWidget')
    await h.idle()

    await revealLine(h, id, 201, 1)
    await quiet(h)
    await press(h, 'F2', ['cmd'])
    await h.waitFor(() => message(h) !== '', { timeout: 5000 })
    h.check('Toggle Bookmark on a 201st line is refused, with the limit, as an error', ctx.bookmarks.lines(id).length === 200 && !ctx.bookmarks.lines(id).includes(201) && message(h) === ctx.t('bookmarks.full', { max: 200 }) && isError(h), { count: ctx.bookmarks.lines(id).length, message: message(h) })

    await quiet(h)
    await ctx.commands.run('bookmark.rename')
    await h.idle()
    h.check('so is Name Bookmark on a line without one, and it opens no prompt', !h.q('modal') && ctx.bookmarks.lines(id).length === 200 && message(h) === ctx.t('bookmarks.full', { max: 200 }), { message: message(h) })

    await openFind(h)
    state.change({ searchString: 'G0' }, false)
    await h.idle()
    await ctx.commands.run('bookmark.addAllMatches')
    await h.idle()
    h.check('50 lines match but 200 are there already: nothing is marked and both counts are said', ctx.bookmarks.lines(id).length === 200 && message(h) === ctx.t('bookmarks.tooManyAdded', { count: 50, have: 200, max: 200 }), { count: ctx.bookmarks.lines(id).length, message: message(h) })
    ctx.editor.triggerAction('closeFindWidget')

    ctx.bookmarks.toggle(id, 1)
    await revealLine(h, id, 201, 1)
    await press(h, 'F2', ['cmd'])
    await h.waitFor(() => ctx.bookmarks.lines(id).includes(201), { timeout: 5000 })
    h.check('the limit is a count: with one removed the 201st line takes it', ctx.bookmarks.lines(id).length === 200 && ctx.bookmarks.lines(id).includes(201) && !ctx.bookmarks.lines(id).includes(1), ctx.bookmarks.lines(id).length)
  })

  // ============================================================ E. block range
  await guard(h, 'E. Select and Delete Block Range', async () => {
    const id = await newDoc(h, FANUC.text, 'fanuc-gcode')
    h.check('the range commands are offered', ctx.commands.isEnabled('edit.selectBlockRange') && ctx.commands.isEnabled('edit.deleteBlockRange'))

    // The form starts with the selection's lines (line mode is the first answer).
    ctx.editor.selectLines(id, 3, 4)
    await h.idle()
    let running = (await openForm(h, 'edit.selectBlockRange')).running
    h.check('with lines 3 to 4 selected the form starts with 3 and 4, in line mode', /** @type {HTMLInputElement} */ (field(h, 'from')?.querySelector('input'))?.value === '3' && /** @type {HTMLInputElement} */ (field(h, 'to')?.querySelector('input'))?.value === '4' && field(h, 'kind')?.querySelector('select')?.selectedOptions[0]?.textContent?.trim() === ctx.t('ranges.kindLine'), { from: field(h, 'from')?.querySelector('input')?.value, to: field(h, 'to')?.querySelector('input')?.value })
    await answerForm(h, running, {}, true)
    h.check('Cancel selects nothing: lines 3 and 4 are still the selection', ctx.editor.selectionLines()?.startLine === 3 && ctx.editor.selectionLines()?.endLine === 4, ctx.editor.selectionLines())

    // Line numbers.
    running = (await openForm(h, 'edit.selectBlockRange')).running
    setField(h, 'from', 'abc')
    setField(h, 'to', '5')
    await h.frame()
    h.check('not a number: refused in the form, OK is off', refusal(h).from === 'ranges.notNumberLine' && refusal(h).okDisabled, refusal(h))
    setField(h, 'from', '3')
    setField(h, 'to', '999')
    await h.frame()
    h.check('a line beyond the program: refused in the form with the line count', refusal(h).to === 'ranges.outsideProgram' && refusal(h).okDisabled, refusal(h))
    setField(h, 'from', '6')
    setField(h, 'to', '3')
    await h.frame()
    h.check('first below last: refused as a whole', refusal(h).form === 'ranges.reversedLine' && refusal(h).okDisabled, refusal(h))
    await answerForm(h, running, { from: '3', to: '6' })
    h.check('lines 3 to 6 are selected whole', ctx.editor.selectionLines()?.startLine === 3 && ctx.editor.selectionLines()?.endLine === 6, ctx.editor.selectionLines())
    h.check('and the status bar names them', message(h) === ctx.t('ranges.selected', { what: ctx.t('ranges.lines', { first: 3, last: 6 }) }), message(h))

    // Block numbers: the kind is remembered for the next form.
    running = (await openForm(h, 'edit.selectBlockRange')).running
    setField(h, 'kind', ctx.t('ranges.kindBlock'))
    setField(h, 'from', 'N999')
    setField(h, 'to', 'N126')
    await h.frame()
    h.check('a block that is not in the program: refused with the field', refusal(h).from === 'ranges.missingBlock' && refusal(h).okDisabled, refusal(h))
    setField(h, 'from', 'N126')
    setField(h, 'to', 'N120')
    await h.frame()
    h.check('the first block after the last: refused', refusal(h).form === 'ranges.reversedBlock', refusal(h))
    await answerForm(h, running, { from: '120', to: 'N126' })
    h.check('120 and N126 are blocks: lines 6 to 8 are selected, and the status bar names the blocks as well', ctx.editor.selectionLines()?.startLine === 6 && ctx.editor.selectionLines()?.endLine === 8 && message(h) === ctx.t('ranges.selected', { what: ctx.t('ranges.withBlocks', { lines: ctx.t('ranges.lines', { first: 6, last: 8 }), blocks: ctx.t('ranges.blocks', { from: 'N120', to: 'N126' }) }) }), { selection: ctx.editor.selectionLines(), message: message(h) })

    ctx.editor.selectLines(id, 3, 4)
    running = (await openForm(h, 'edit.selectBlockRange')).running
    h.check('the next form is in block mode (remembered) and does not start with the selection\'s lines', field(h, 'kind')?.querySelector('select')?.selectedOptions[0]?.textContent?.trim() === ctx.t('ranges.kindBlock') && /** @type {HTMLInputElement} */ (field(h, 'from')?.querySelector('input'))?.value === '', field(h, 'kind')?.querySelector('select')?.selectedOptions[0]?.textContent)
    await answerForm(h, running, {}, true)

    // Two programs: a number two blocks carry is no guess.
    const two = await newDoc(h, TWO_PROGRAMS, 'fanuc-gcode')
    running = (await openForm(h, 'edit.selectBlockRange')).running
    setField(h, 'kind', ctx.t('ranges.kindBlock'))
    setField(h, 'from', 'N10')
    setField(h, 'to', 'N20')
    await h.frame()
    h.check('N10 is in both programs: refused, naming the lines, OK is off', refusal(h).from === 'ranges.duplicateBlock' && refusal(h).okDisabled, refusal(h))
    await answerForm(h, running, {}, true)
    h.check('(nothing was selected in the program of two)', ctx.editor.selectionLines()?.empty !== false && ctx.docs.get(two)?.dirty === false)

    // A block with a continuation line is taken whole.
    const kt = await newDoc(h, KLARTEXT.text, 'heidenhain-klartext')
    running = (await openForm(h, 'edit.selectBlockRange')).running
    await answerForm(h, running, { kind: ctx.t('ranges.kindBlock'), from: '5', to: '5' })
    h.check('block 5 runs over two lines: lines 6 and 7 are selected, the block is not cut in two', ctx.editor.selectionLines()?.startLine === 6 && ctx.editor.selectionLines()?.endLine === 7 && message(h) === ctx.t('ranges.selected', { what: ctx.t('ranges.withBlocks', { lines: ctx.t('ranges.lines', { first: 6, last: 7 }), blocks: ctx.t('ranges.block', { block: '5' }) }) }), { selection: ctx.editor.selectionLines(), message: message(h) })

    // Delete: whole lines with their line breaks, one undo step.
    running = (await openForm(h, 'edit.deleteBlockRange')).running
    await answerForm(h, running, { kind: ctx.t('ranges.kindBlock'), from: '5', to: '5' })
    h.check('Delete Block Range removes block 5 with its continuation line, and says how many lines', textOf(h, kt) === klartextLines.filter((_, i) => i !== 5 && i !== 6).concat('').join('\n') && message(h) === ctx.t('ranges.deleted', { count: 2, what: ctx.t('ranges.withBlocks', { lines: ctx.t('ranges.lines', { first: 6, last: 7 }), blocks: ctx.t('ranges.block', { block: '5' }) }) }), { text: textOf(h, kt).split('\n'), message: message(h) })
    h.check('the cursor stands where the range was', h.app.cursor().line === 6, h.app.cursor())
    await undoKey(h)
    h.check('one undo brings the two lines back', textOf(h, kt) === KLARTEXT.text, textOf(h, kt).split('\n'))

    running = (await openForm(h, 'edit.deleteBlockRange')).running
    await answerForm(h, running, { kind: ctx.t('ranges.kindLine'), from: '3', to: '4' })
    h.check('lines 3 and 4 deleted by number in the Klartext program', textOf(h, kt) === klartextLines.filter((_, i) => i !== 2 && i !== 3).concat('').join('\n'), textOf(h, kt).split('\n'))
    await undoKey(h)
    h.check('and one undo', textOf(h, kt) === KLARTEXT.text)
  })

  // ============================================================ F. Insert File and Append File
  await guard(h, 'F. Insert File and Append File', async () => {
    const insertFanuc = await fixture(h, 'insert-fanuc.nc')
    const insertLines = linesOf(insertFanuc.text)
    const id = await newDoc(h, FANUC.text, 'fanuc-gcode')

    // Cursor in column 1: before the cursor's line. The file's own numbers stay (not Klartext).
    await revealLine(h, id, 7, 1)
    await quiet(h)
    await insertFrom(h, 'file.insertFile', insertFanuc.path)
    h.check('Insert File with the cursor in column 1 of line 7 puts the file\'s lines before it, numbers as they are', textOf(h, id) === after(fanucLines, 6, insertLines).concat('').join('\n'), textOf(h, id).split('\n'))
    h.check('the inserted lines are selected, first to last', ctx.editor.selectionLines()?.startLine === 7 && ctx.editor.selectionLines()?.endLine === 10, ctx.editor.selectionLines())
    h.check('the status bar names the file and the lines, and warns of nothing (the program has not ended there)', message(h) === ctx.t('insertFile.done', { count: 4, name: 'insert-fanuc.nc', where: ctx.t('insertFile.atLines', { first: 7, last: 10 }) }) && !isError(h), { message: message(h), error: isError(h) })
    await undoKey(h)
    h.check('one undo takes the whole insert back', textOf(h, id) === FANUC.text, textOf(h, id).split('\n'))

    // Cursor elsewhere in the line: after the cursor's line.
    await revealLine(h, id, 7, 4)
    await insertFrom(h, 'file.insertFile', insertFanuc.path)
    h.check('with the cursor inside line 7 the lines go after it', textOf(h, id) === after(fanucLines, 7, insertLines).concat('').join('\n'), textOf(h, id).split('\n'))
    await undoKey(h)

    // Insert at line 1, column 1: never above the program's first lines, so below the leading % and O1001.
    await revealLine(h, id, 1, 1)
    await quiet(h)
    await insertFrom(h, 'file.insertFile', insertFanuc.path)
    h.check('Insert File at line 1, column 1 puts the lines below the leading % and the program-start line O1001', textOf(h, id) === after(fanucLines, 2, insertLines).concat('').join('\n'), textOf(h, id).split('\n'))
    h.check('lines 3 to 6 are selected and nothing is warned of', ctx.editor.selectionLines()?.startLine === 3 && ctx.editor.selectionLines()?.endLine === 6 && message(h) === ctx.t('insertFile.done', { count: 4, name: 'insert-fanuc.nc', where: ctx.t('insertFile.atLines', { first: 3, last: 6 }) }) && !isError(h), { selection: ctx.editor.selectionLines(), message: message(h) })
    await undoKey(h)

    // On the closing % line, after it: the control reads nothing behind the % that ends the tape.
    await revealLine(h, id, 10, 2)
    await quiet(h)
    await insertFrom(h, 'file.insertFile', insertFanuc.path)
    h.check('Insert File after the closing % goes ahead (lines 11 to 14)', textOf(h, id) === [...fanucLines, ...insertLines, ''].join('\n'), textOf(h, id).split('\n'))
    h.check('and warns in red that the % at line 10 ends the tape, not of the program end too', message(h).includes(ctx.t('insertFile.afterTapeEnd', { line: 10 })) && !message(h).includes(ctx.t('insertFile.afterProgramEnd', { line: 9 })) && isError(h), { message: message(h), error: isError(h) })
    await undoKey(h)
    h.check('(one undo)', textOf(h, id) === FANUC.text)

    // Append: before the closing %, behind M30: the program has ended, and the status bar warns.
    await quiet(h)
    await insertFrom(h, 'file.appendFile', insertFanuc.path)
    h.check('Append File puts the lines before the closing %, which stays the last line', textOf(h, id) === [...fanucLines.slice(0, 9), ...insertLines, '%', ''].join('\n'), textOf(h, id).split('\n'))
    h.check('and selects them: lines 10 to 13', ctx.editor.selectionLines()?.startLine === 10 && ctx.editor.selectionLines()?.endLine === 13, ctx.editor.selectionLines())
    h.check('behind the M30 on line 9 the program has ended: the insert went ahead and the status bar warns, as an error', message(h).includes(ctx.t('insertFile.afterProgramEnd', { line: 9 })) && isError(h), { message: message(h), error: isError(h) })
    await undoKey(h)
    h.check('one undo', textOf(h, id) === FANUC.text)

    // A file of its own program between two lone %: the % lines stay out, and the program start that lands
    // where blocks of this program follow is warned of.
    const frame = await fixture(h, 'insert-fanuc-frame.nc')
    await revealLine(h, id, 6, 1)
    await quiet(h)
    await insertFrom(h, 'file.insertFile', frame.path)
    h.check('the file\'s two % lines are left out: O2000 and its comment go in before line 6', textOf(h, id) === after(fanucLines, 5, linesOf(frame.text).slice(1, -1)).concat('').join('\n'), textOf(h, id).split('\n'))
    h.check('the status bar says so and warns in red that O2000 starts a program in the middle of this one', message(h).includes(ctx.t('insertFile.tapeMarksLeftOut', { count: 2 })) && message(h).includes(ctx.t('insertFile.programFrameStart', { line: 6, text: 'O2000' })) && isError(h), { message: message(h), error: isError(h) })
    await undoKey(h)
    h.check('(one undo again)', textOf(h, id) === FANUC.text)

    // A file of two programs: inside the second one nothing has ended.
    const two = await newDoc(h, TWO_PROGRAMS, 'fanuc-gcode')
    await quiet(h)
    await revealLine(h, two, 8, 1)
    await insertFrom(h, 'file.insertFile', insertFanuc.path)
    h.check('in the second program of a file the insert does not warn', message(h).includes('Inserted 4 lines') && !message(h).includes(ctx.t('insertFile.afterProgramEnd', { line: 4 })) && !isError(h), { message: message(h), error: isError(h) })
    h.check('and went in before line 8', lineOf(h, two, 8) === insertLines[0] && lineOf(h, two, 12) === 'N20 G0 X2', textOf(h, two).split('\n'))

    // Klartext: the numbers.
    const insertKt = await fixture(h, 'insert-klartext.h')
    const kt = await newDoc(h, KLARTEXT.text, 'heidenhain-klartext')
    await revealLine(h, kt, 5, 1)
    await quiet(h)
    await insertFrom(h, 'file.insertFile', insertKt.path)
    h.check('Klartext: the file\'s blocks take the numbers 4 to 6 and every block below follows (the continuation line is left as it is)', textOf(h, kt) === KT_INSERT.join('\n'), textOf(h, kt).split('\n'))
    h.check('the status bar says how many blocks it renumbered', message(h).includes(ctx.t('insertFile.renumbered', { count: KT_INSERT_RENUMBERED })), message(h))
    h.check('and the inserted lines are selected: 5 to 7', ctx.editor.selectionLines()?.startLine === 5 && ctx.editor.selectionLines()?.endLine === 7, ctx.editor.selectionLines())
    await undoKey(h)
    h.check('inserted text and new numbers are one undo step', textOf(h, kt) === KLARTEXT.text, textOf(h, kt).split('\n'))

    // Klartext Append: before END PGM, which takes the next number.
    await quiet(h)
    await insertFrom(h, 'file.appendFile', insertKt.path)
    h.check('Klartext Append File puts the blocks before END PGM: they are 8 to 10 and END PGM is 11', textOf(h, kt) === KT_APPEND.join('\n'), textOf(h, kt).split('\n'))
    h.check('lines 10 to 12 are selected and the status bar counts four renumbered blocks', ctx.editor.selectionLines()?.startLine === 10 && ctx.editor.selectionLines()?.endLine === 12 && message(h).includes(ctx.t('insertFile.renumbered', { count: KT_APPEND_RENUMBERED })), { selection: ctx.editor.selectionLines(), message: message(h) })
    await undoKey(h)
    h.check('(one undo)', textOf(h, kt) === KLARTEXT.text, textOf(h, kt).split('\n'))

    // Refusals change nothing.
    const second = await fixture(h, 'insert-klartext-second.h')
    await quiet(h)
    await insertFrom(h, 'file.insertFile', second.path)
    h.check('a file that starts a second program is refused, naming the line, and nothing is inserted', textOf(h, kt) === KLARTEXT.text && message(h) === ctx.t('insertFile.secondProgramStart', { text: '0 BEGIN PGM OTHER MM', line: 1 }) && isError(h), { message: message(h) })
    const ended = await fixture(h, 'insert-klartext-end.h')
    await quiet(h)
    await insertFrom(h, 'file.insertFile', ended.path)
    h.check('a file that ends a program (END PGM at its line 3) is refused, and nothing is inserted', textOf(h, kt) === KLARTEXT.text && message(h) === ctx.t('insertFile.programEndInFile', { text: '22 END PGM OTHER MM', line: 3 }) && isError(h), { message: message(h) })
    const open = await fixture(h, 'insert-klartext-tilde.h')
    await quiet(h)
    await insertFrom(h, 'file.insertFile', open.path)
    h.check('a file whose last line ends with ~ is refused: the block below would become part of it', textOf(h, kt) === KLARTEXT.text && message(h) === ctx.t('insertFile.continuesBelow', { name: 'insert-klartext-tilde.h', mark: '~' }) && isError(h), { message: message(h) })
    const emptyPath = `${h.cfg.run}/insert/empty.nc`
    await h.disk.write(emptyPath, '')
    await quiet(h)
    await insertFrom(h, 'file.appendFile', emptyPath)
    h.check('an empty file is refused with its name', textOf(h, kt) === KLARTEXT.text && message(h) === ctx.t('insertFile.empty', { name: 'empty.nc' }), message(h))
    await quiet(h)
    await insertFrom(h, 'file.insertFile', null)
    h.check('a cancelled file dialog changes nothing and says nothing', textOf(h, kt) === KLARTEXT.text && message(h) === '', message(h))
  })

  // ============================================================ G. print
  /** @type {any[]} */
  const printed = []
  ctx.print.setPrintFunction(() => {
    const view = /** @type {HTMLElement | null} */ (document.querySelector('[data-testid="print-view"]'))
    printed.push(
      view === null
        ? null
        : {
            pages: Number(view.dataset.pages),
            colors: view.dataset.colors,
            scope: view.dataset.scope,
            lineNumbers: view.dataset.lineNumbers,
            pageBoxes: view.querySelectorAll('[data-testid="print-page"]').length,
            rows: view.querySelectorAll('[data-testid="print-line"]').length,
          },
    )
  })
  /**
   * The rows of the print view that is on screen. `cut` is the width of the line-number gutter, taken off the text.
   * @param {number} cut
   */
  const viewRows = (cut) => {
    const rows = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('[data-testid="print-view"] [data-testid="print-line"]')])
    return rows.map((el) => ({
      line: el.dataset.line ?? '',
      text: (el.textContent ?? '').slice(cut),
      colored: el.querySelectorAll('[style*="color"]').length,
      page: Number(el.closest('[data-testid="print-page"]')?.getAttribute('data-page') ?? '0'),
    }))
  }
  /**
   * The rows put together into the document's lines: a row without a number goes on the line above it.
   * @param {ReturnType<typeof viewRows>} rows
   */
  const rebuilt = (rows) => {
    /** @type {{ line: number, text: string }[]} */
    const out = []
    for (const row of rows) {
      if (row.line !== '') out.push({ line: Number(row.line), text: row.text })
      else if (out.length > 0) out[out.length - 1].text += row.text
    }
    return out
  }
  /**
   * Mod+P, the form filled, OK, and the wait for the stubbed print function.
   * @param {Record<string, string | number | boolean>} fields
   */
  const printWith = async (fields) => {
    const before = printed.length
    await h.nativeKeys([{ key: 'p', mods: ['cmd'] }])
    await h.waitFor(() => h.q('modal', { modal: 'form' }), { timeout: 8000 })
    for (const [id, value] of Object.entries(fields)) setField(h, id, value)
    await h.frame()
    h.click(h.q('modal-ok'))
    await h.waitFor(() => !h.q('modal'), { timeout: 8000 })
    await h.waitFor(() => printed.length === before + 1, { timeout: 10000 })
    await h.idle()
    return printed[printed.length - 1]
  }

  const demo = await fixture(h, 'print-demo.nc')
  const demoPath = `${h.cfg.run}/print/print-demo.nc`
  await h.disk.copy(demo.path, demoPath)
  const demoLines = demo.text.split('\n') // the editor's lines: the empty last one is a line of the document
  /** @type {string} */
  let pd = ''
  await guard(h, 'G1. Mod+P, the form and the view', async () => {
    pd = (await openPath(h, demoPath)).id
    h.check('the document has the lines of the fixture, and the empty one the last line break makes', ctx.editor.getLineCount(pd) === demoLines.length, ctx.editor.getLineCount(pd))
    const dialogsBefore = h.dialogs.calls().length

    await h.nativeKeys([{ key: 'p', mods: ['cmd'] }])
    await h.waitFor(() => h.q('modal', { modal: 'form' }), { timeout: 8000 })
    const scope = /** @type {HTMLSelectElement} */ (field(h, 'scope')?.querySelector('select'))
    h.check('Mod+P opens the print form, whose OK button prints', /** @type {HTMLElement} */ (h.q('modal-ok'))?.textContent?.trim() === ctx.t('print.form.okPrint'))
    h.check('without a selection the form offers the whole program only', scope?.options.length === 1 && scope.selectedOptions[0]?.textContent?.trim() === ctx.t('print.form.scopeDocument'), [...(scope?.options ?? [])].map((o) => o.textContent))
    h.check('the defaults: in colour, line numbers on, 9 points', field(h, 'colors')?.querySelector('select')?.selectedOptions[0]?.textContent?.trim() === ctx.t('print.form.colorsColor') && /** @type {HTMLInputElement} */ (field(h, 'lineNumbers')?.querySelector('input'))?.checked === true && /** @type {HTMLInputElement} */ (field(h, 'fontPt')?.querySelector('input'))?.value === '9', { fontPt: field(h, 'fontPt')?.querySelector('input')?.value })
    h.click(h.q('modal-cancel'))
    await h.waitFor(() => !h.q('modal'), { timeout: 8000 })
    h.check('Cancel prints nothing', printed.length === 0 && !h.q('print-view'))

    const first = await printWith({})
    const model = ctx.print.build({ scope: 'document', colors: 'color', lineNumbers: true, fontPt: 9 })
    const rows = viewRows(String(demoLines.length).length + 1)
    const rowsPerPage = model?.rows ?? 0
    const continuation = rows.filter((r) => r.line === '').length
    h.check('the print function was called once, with the view mounted: one box per page, one row per line', first !== null && printed.length === 1 && first.scope === 'document' && first.colors === 'color' && first.lineNumbers === '1' && first.pageBoxes === first.pages && first.rows === rows.length, first)
    h.check('the view is the document\'s: one numbered row per line, 1 to the last, in order', JSON.stringify(rebuilt(rows).map((r) => r.line)) === JSON.stringify(demoLines.map((_, i) => i + 1)), rebuilt(rows).length)
    h.check('the long comment goes on in a row of its own without a number', continuation === 1 && rows[rows.findIndex((r) => r.line === '') - 1]?.line === '4', { continuation })
    h.check('what each line shows is the line itself (a wider line is cut across its rows and put together again)', JSON.stringify(rebuilt(rows).map((r) => r.text)) === JSON.stringify(demoLines), rebuilt(rows).filter((r, i) => r.text !== demoLines[i]).slice(0, 2))
    h.check('the pages are cut by the model\'s rows: ceil(rows / rows per page) of them', rowsPerPage >= 30 && rowsPerPage <= 100 && first !== null && first.pages === Math.ceil(rows.length / rowsPerPage) && rows.filter((r) => r.page === 1).length === rowsPerPage, { rowsPerPage, pages: first?.pages, rows: rows.length })
    const header = h.qa('print-page')[0]?.querySelector('header')?.textContent ?? ''
    h.check('every page has a header: the document\'s name, the date, "Page n of m"', h.qa('print-page').every((p, i) => (p.querySelector('header')?.textContent ?? '').includes(ctx.t('print.pageOf', { page: i + 1, pages: first?.pages })) && (p.querySelector('header')?.textContent ?? '').includes('print-demo.nc')) && header.includes(new Date().toLocaleDateString()), header)
    h.check('in colour: the text of the program carries colours', rows.some((r) => r.colored > 0), rows.slice(0, 5).map((r) => r.colored))
    h.check('no system dialog was opened for any of it (the print function is a stub)', h.dialogs.calls().length === dialogsBefore, h.dialogs.calls().slice(dialogsBefore))
    const remembered = ctx.uiState.getLastParams('print')
    h.check('the form\'s answer is remembered under "print"', remembered?.colors === 'color' && remembered?.fontPt === 9, remembered)

    // Black, no numbers, 12 points: the view follows the options.
    const second = await printWith({ colors: ctx.t('print.form.colorsBlack'), lineNumbers: false, fontPt: 12 })
    const rows12 = viewRows(0)
    const model12 = ctx.print.build({ scope: 'document', colors: 'black', lineNumbers: false, fontPt: 12 })
    h.check('a second print replaces the first view: one view on the page, black, without numbers', h.qa('print-view').length === 1 && second.colors === 'black' && second.lineNumbers === '0', { views: h.qa('print-view').length, second })
    h.check('black writes no colour, and the rows are the lines exactly (no gutter)', rows12.every((r) => r.colored === 0) && JSON.stringify(rebuilt(rows12).map((r) => r.text)) === JSON.stringify(demoLines), rows12.slice(0, 3))
    h.check('12 points: fewer rows per page, so more pages than at 9', (model12?.rows ?? 99) < rowsPerPage && second.pages > first.pages, { rows12: model12?.rows, rows9: rowsPerPage, pages: [first.pages, second.pages] })
    const again = ctx.uiState.getLastParams('print')
    await h.nativeKeys([{ key: 'p', mods: ['cmd'] }])
    await h.waitFor(() => h.q('modal', { modal: 'form' }), { timeout: 8000 })
    h.check('the next form starts with the remembered answer: black, no numbers, 12', again?.colors === 'black' && field(h, 'colors')?.querySelector('select')?.selectedOptions[0]?.textContent?.trim() === ctx.t('print.form.colorsBlack') && /** @type {HTMLInputElement} */ (field(h, 'lineNumbers')?.querySelector('input'))?.checked === false && /** @type {HTMLInputElement} */ (field(h, 'fontPt')?.querySelector('input'))?.value === '12', again)
    h.click(h.q('modal-cancel'))
    await h.waitFor(() => !h.q('modal'), { timeout: 8000 })

    // The view goes at afterprint.
    window.dispatchEvent(new Event('afterprint'))
    await h.waitFor(() => !h.q('print-view'), { timeout: 5000 })
    h.check('the view is taken off the page at afterprint', !h.q('print-view') && h.qa('print-page').length === 0)
  })

  await guard(h, 'G2. a selection, the limit, the view with the document', async () => {
    // A selection prints with its own line numbers.
    ctx.editor.selectLines(pd, 10, 15)
    await h.idle()
    await h.nativeKeys([{ key: 'p', mods: ['cmd'] }])
    await h.waitFor(() => h.q('modal', { modal: 'form' }), { timeout: 8000 })
    const scope = /** @type {HTMLSelectElement} */ (field(h, 'scope')?.querySelector('select'))
    h.check('with lines selected the form offers both, and the selection is the one chosen', scope?.options.length === 2 && scope.selectedOptions[0]?.textContent?.trim() === ctx.t('print.form.scopeSelection'), [...(scope?.options ?? [])].map((o) => o.textContent))
    h.click(h.q('modal-cancel'))
    await h.waitFor(() => !h.q('modal'), { timeout: 8000 })
    const before = printed.length
    const sel = await printWith({ colors: ctx.t('print.form.colorsColor'), lineNumbers: true, fontPt: 9 })
    const rows = viewRows(3)
    h.check('the selection prints as scope "selection", with the document\'s own line numbers 10 to 15', printed.length === before + 1 && sel.scope === 'selection' && JSON.stringify(rows.map((r) => r.line)) === JSON.stringify(['10', '11', '12', '13', '14', '15']) && sel.pages === 1, { sel, lines: rows.map((r) => r.line) })
    h.check('and the lines are those lines of the program', JSON.stringify(rebuilt(rows).map((r) => r.text)) === JSON.stringify(demoLines.slice(9, 15)), rows.map((r) => r.text))

    // The view goes when the document closes.
    h.check('the view of the selection is on the page', h.qa('print-view').length === 1)
    await h.waitFor(() => ctx.docs.get(pd)?.dirty === false, { timeout: 5000 })
    await ctx.commands.run('file.close')
    await h.waitFor(() => !ctx.docs.get(pd), { timeout: 8000 })
    await h.waitFor(() => !h.q('print-view'), { timeout: 5000 })
    h.check('closing the printed document takes the view off the page', !h.q('print-view'))

    // More than 20,000 lines are refused, and nothing is called.
    const huge = await newDoc(h, `${Array.from({ length: 20001 }, (_, i) => `N${i + 1} G1 X${i % 90}.`).join('\n')}`, 'fanuc-gcode')
    const calls = printed.length
    await quiet(h)
    await h.nativeKeys([{ key: 'p', mods: ['cmd'] }])
    await h.waitFor(() => h.q('modal', { modal: 'form' }), { timeout: 8000 })
    h.click(h.q('modal-ok'))
    await h.waitFor(() => !h.q('modal'), { timeout: 8000 })
    await h.waitFor(() => message(h) !== '', { timeout: 8000 })
    h.check('a program of 20,001 lines is refused with both numbers, as an error, and the print function is not called', ctx.editor.getLineCount(huge) === 20001 && message(h) === ctx.t('print.tooLong', { lines: '20,001', max: '20,000' }) && isError(h) && printed.length === calls && !h.q('print-view'), { message: message(h), printed: printed.length - calls })
  })

  // ============================================================ H. export
  await guard(h, 'H. Export as HTML', async () => {
    pd = (await openPath(h, demoPath)).id
    const out = `${h.cfg.run}/print-demo.html`
    const model = ctx.print.build({ scope: 'document', colors: 'color', lineNumbers: true, fontPt: 9 })
    const calls = h.dialogs.calls().length
    await h.dialogs.queue('save', out)
    const running = ctx.commands.run('file.exportHtml')
    await h.waitFor(() => h.q('modal', { modal: 'form' }), { timeout: 8000 })
    h.check('Export as HTML asks the same form, with its own OK', /** @type {HTMLElement} */ (h.q('modal-ok'))?.textContent?.trim() === ctx.t('print.form.okExport'))
    // The form remembers the last print (black, no numbers, 12 points): the export is asked for the defaults.
    for (const [id, value] of Object.entries({ colors: ctx.t('print.form.colorsColor'), lineNumbers: true, fontPt: 9 })) setField(h, id, value)
    await h.frame()
    h.click(h.q('modal-ok'))
    await h.waitFor(() => !h.q('modal'), { timeout: 8000 })
    await running
    await h.idle()
    const asked = h.dialogs.calls().slice(calls).filter((c) => c.kind === 'save')
    h.check('the save dialog was asked once, for print-demo.html, with a web page filter', asked.length === 1 && asked[0].args.options.defaultPath === 'print-demo.html' && JSON.stringify(asked[0].args.options.filters?.[0]?.extensions) === JSON.stringify(['html', 'htm']), asked.map((c) => c.args.options))
    const html = await h.disk.read(out)
    h.check('the file is one web page: a doctype, UTF-8, no script', /^<!doctype html>/i.test(html) && html.includes('<meta charset="utf-8">') && !/<script/i.test(html))
    h.check('one section per page of the print model, each with its "Page n of m"', model !== null && (html.match(/<section class="page"/g) ?? []).length === model.pages.length && html.includes(ctx.t('print.pageOf', { page: 1, pages: model.pages.length })), { pages: model?.pages.length })
    h.check('every line of the program is there with its own number', demoLines.every((_, i) => html.includes(`data-line="${i + 1}"`)) && (html.match(/data-line="\d+"/g) ?? []).length === demoLines.length)
    h.check('the comment\'s < > & and quotes are written as text, not as markup', html.includes('(CHECK &lt;B&gt; &amp; &quot;Q&quot; &#39;S&#39;)') && !html.includes('<B>'), html.slice(html.indexOf('CHECK') - 20, html.indexOf('CHECK') + 80))
    h.check('the status bar says how many pages went where', message(h) === ctx.t('print.exported', { count: model?.pages.length ?? 0, name: 'print-demo.html' }), message(h))

    // A cancelled dialog is silent and writes nothing.
    const other = `${h.cfg.run}/never.html`
    await h.dialogs.queue('save', null)
    await quiet(h)
    const cancelled = ctx.commands.run('file.exportHtml')
    await h.waitFor(() => h.q('modal', { modal: 'form' }), { timeout: 8000 })
    h.click(h.q('modal-ok'))
    await h.waitFor(() => !h.q('modal'), { timeout: 8000 })
    await cancelled
    await h.turns(6)
    h.check('a cancelled save dialog says nothing and writes nothing', message(h) === '' && (await h.disk.stat(other)) === null, message(h))
  })

  h.check('no file dialog and no alert was left unanswered by the sections above', (await h.alert.visible()) === null)
})

// ================================================================================================ p4-comfort-names

const HOME_1 = '{run}/state-home'
const HOME_2 = '{run}/../p4-comfort-names-1/state-home'

/** The three programs of this pair: the copies of the fixtures, the marks each keeps. */
const PAIR = [
  { name: 'prog-a.nc', fixture: 'fanuc-edit.nc', marks: [{ line: 4, name: 'Tool one' }, { line: 6, name: null }, { line: 8, name: 'Pass two' }] },
  { name: 'prog-b.h', fixture: 'klartext-edit.h', marks: [{ line: 3, name: 'Klartext start' }, { line: 5, name: null }] },
  { name: 'prog-c.nc', fixture: 'fanuc-edit.nc', marks: [{ line: 3, name: 'Front tab' }] },
]
const pairPaths = (/** @type {string} */ run) => PAIR.map((p) => `${run}/keep/${p.name}`)

scenario('p4-comfort-names-1', { timeout: 300, vars: { HOME: HOME_1 } }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const paths = pairPaths(h.cfg.run)
  for (const [at, program] of PAIR.entries()) await h.disk.copy(await h.fixture(`p4c/harness/${program.fixture}`), paths[at])
  await h.dialogs.queue('open', paths)
  await ctx.files.open()
  await h.waitFor(() => paths.every((path) => !!ctx.docs.byPath(path)), { timeout: 20000 })
  const ids = paths.map((path) => docIdFor(ctx, path))

  // Each tab is shown, marked and left: the memo of a tab is written when the user switches away from it.
  for (const [at, program] of PAIR.entries()) {
    ctx.docs.activate(ids[at])
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === ids[at], { timeout: 10000 })
    await h.idle()
    for (const mark of program.marks) {
      ctx.bookmarks.toggle(ids[at], mark.line)
      if (mark.name !== null) ctx.bookmarks.setName(ids[at], mark.line, mark.name)
    }
    h.check(`${program.name}: the marks are set, with their names`, JSON.stringify(ctx.bookmarks.list(ids[at]).map((b) => ({ line: b.line, name: b.name ?? null }))) === JSON.stringify(program.marks), ctx.bookmarks.list(ids[at]))
  }

  await ctx.uiState.flush()
  const first = ctx.fileMemory.get(paths[0])
  h.check('the first tab, left behind, has its memo: the lines, and the names in a member of their own', JSON.stringify(first?.bookmarks) === '[4,6,8]' && JSON.stringify(first?.bookmarkNames) === JSON.stringify([{ line: 4, name: 'Tool one' }, { line: 8, name: 'Pass two' }]), first)
  const second = ctx.fileMemory.get(paths[1])
  h.check('and so does the second', JSON.stringify(second?.bookmarks) === '[3,5]' && JSON.stringify(second?.bookmarkNames) === JSON.stringify([{ line: 3, name: 'Klartext start' }]), second)
  await quitCleanly(h)
})

scenario('p4-comfort-names-2', { timeout: 300, vars: { HOME: HOME_2 } }, async (h) => {
  const ctx = context(h)
  await ready(h)
  await requireFirstRun(h, 'p4-comfort-names-1')
  const paths = pairPaths(otherRun(h.cfg.run, 'p4-comfort-names-1'))
  await h.waitFor(() => paths.every((path) => !!ctx.docs.byPath(path)), { timeout: 30000 })
  await h.idle()
  const ids = paths.map((path) => docIdFor(ctx, path))
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === ids[2], { timeout: 15000 })
  h.check('the three programs are open again, the third in front', h.q('editor-host')?.dataset.docId === ids[2], h.q('editor-host')?.dataset.docId)
  // Every restored tab has its model from the start (`fileOps` makes it when the file opens); what the first two lack is their remembered
  // state, which is put in when the tab comes to the front. So "not shown yet" reads: no bookmark in the editor, the memo still waiting.
  h.check('the first two tabs have not been shown: the editor holds none of their bookmarks yet, the front tab has its one', ctx.bookmarks.lines(ids[0]).length === 0 && ctx.bookmarks.lines(ids[1]).length === 0 && ctx.bookmarks.lines(ids[2]).length === 1, ids.map((id) => ctx.bookmarks.lines(id)))

  await clickRibbon(h, 'edit', 'view.toggleBookmarks')
  await h.waitFor(() => h.q('bookmarks-panel')?.dataset.count === '6', { timeout: 10000 })
  let rows = panelRows(h)
  h.check('the panel lists all six bookmarks, in tab order and then by line', JSON.stringify(rows.map((r) => `${ids.indexOf(r.docId)}:${r.line}`)) === JSON.stringify(['0:4', '0:6', '0:8', '1:3', '1:5', '2:3']), rows.map((r) => `${r.docId}:${r.line}`))
  h.check('the two tabs without a model are listed from their waiting memo: pending, with their names and no line text', rows.slice(0, 5).every((r) => r.pending) && rows[0].name === 'Tool one' && rows[2].name === 'Pass two' && !rows[1].named && rows[3].name === 'Klartext start' && !rows[0].text.includes('N110'), rows.slice(0, 5).map((r) => ({ line: r.line, name: r.name, pending: r.pending })))
  h.check('the front tab\'s row is a live one, with its line text', !rows[5].pending && rows[5].name === 'Front tab' && rows[5].text.includes('N100 G90'), rows[5])

  // A click on a pending row shows the tab first and then jumps.
  h.click(rows[2].el.querySelector('button'))
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === ids[0] && ctx.editor.hasModel(ids[0]) && h.app.cursor().line === 8, { timeout: 10000 })
  await h.idle()
  h.check('a click on a row of a tab nobody had shown brings the tab to the front and the cursor to line 8', h.q('editor-host')?.dataset.docId === ids[0] && h.app.cursor().line === 8, { doc: h.q('editor-host')?.dataset.docId, cursor: h.app.cursor() })
  rows = panelRows(h)
  h.check('now that the tab has a model its rows are live, with the line text, and the names are all there', rows.slice(0, 3).every((r) => !r.pending) && rows[2].text.includes('N126') && JSON.stringify(ctx.bookmarks.list(ids[0]).map((b) => ({ line: b.line, name: b.name ?? null }))) === JSON.stringify(PAIR[0].marks), rows.slice(0, 3).map((r) => ({ line: r.line, pending: r.pending })))

  // A delete on a pending row changes the memo.
  const pending = h.q('bookmark-row-delete', { 'data-doc-id': ids[1], 'data-line': 5 })
  h.check('the second tab\'s row still waits for its model', !!pending && panelRows(h).find((r) => r.docId === ids[1] && r.line === 5)?.pending === true)
  h.click(pending)
  await h.waitFor(() => h.q('bookmarks-panel')?.dataset.count === '5', { timeout: 5000 })
  const memo = ctx.fileMemory.get(paths[1])
  h.check('the delete on a row without a model removes the bookmark from the memo and keeps the other one with its name', JSON.stringify(memo?.bookmarks) === '[3]' && JSON.stringify(memo?.bookmarkNames) === JSON.stringify([{ line: 3, name: 'Klartext start' }]) && ctx.bookmarks.lines(ids[1]).length === 0, memo)
  ctx.docs.activate(ids[1])
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === ids[1] && ctx.editor.hasModel(ids[1]), { timeout: 10000 })
  await h.waitFor(() => ctx.bookmarks.lines(ids[1]).length > 0, { timeout: 8000 })
  h.check('the tab shown afterwards has only the bookmark that is left, with its name', JSON.stringify(ctx.bookmarks.list(ids[1]).map((b) => ({ line: b.line, name: b.name ?? null }))) === JSON.stringify([{ line: 3, name: 'Klartext start' }]), ctx.bookmarks.list(ids[1]))

  // Clear All, over live rows.
  h.click(h.q('bookmarks-clear-all'))
  const ask = await h.alert.wait()
  h.check('Clear All asks once, with the count of all open documents', (ask?.texts ?? []).some((t) => t.includes(ctx.t('bookmarks.clearAllConfirm', { count: 5 }))), ask)
  await h.alert.click(ctx.t('bookmarks.clearAllOk'))
  await h.waitFor(() => h.q('bookmarks-empty'), { timeout: 8000 })
  h.check('and removes them everywhere', ids.every((id) => ctx.bookmarks.lines(id).length === 0), ids.map((id) => ctx.bookmarks.lines(id)))
  h.check('not one program was changed', ids.every((id) => ctx.docs.get(id)?.dirty === false), ids.map((id) => ctx.docs.get(id)?.dirty))
})
