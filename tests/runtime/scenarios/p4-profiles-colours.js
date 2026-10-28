// P4h, "Code colours" (plan docs/planning/phase-4-implementation.md section 6.10 rule 6; P4.41, the fix round CODE-4, CODE-8, CODE-9; H4h): the role
// colour editor of Settings > Appearance, its preview in the open editor, the question when it is left, and the colours in print. Two scenarios.
//
//   p4-profiles-colours
//     A. set, refuse, preview, reset   a role colour typed in the dark theme is drawn in the open editor at once (before Save), is "yours" in
//                                      the cell and can be reset; a colour too faint to read (4.5 to 1) is refused with its ratio in plain words,
//                                      blocks Save and leaves the editor on the last colour that could be read; so does a text that is no colour;
//                                      a valid one is accepted again; Reset gives back the standard colour; Cancel puts the old colours back
//                                      (and asks, because a colour was changed).
//     B. save, and the question          Save writes `appearance.roleColors` (the dark and the light theme); entering the same colour again, in
//                                      capitals, asks nothing on Cancel; a colour reset and entered again, so that the roles were edited in
//                                      another order than they are kept in, asks nothing either (CODE-8); a different colour does ask.
//     C. print and export                the exported page uses the user's light colour and not the standard one (CODE-9); a profile's own colour
//                                      wins over the user's for the documents of that profile; the user's colour still holds for the other
//                                      documents.
//   p4-profiles-colours-drag           dragging the colour picker (a hundred and more input events) with a large program open: the page stays
//                                      responsive (the longest frame, the cost of a burst, the time until the editor shows the last colour,
//                                      a click that follows), measured with `h.checkTime` (a generous bound; ten times that on a hosted runner).
//
// What only the running app proves: the colour picker and the text control are real inputs, the themes of the one Monaco in the window are defined
// again for every change, the open editor repaints, and the question is the real NSAlert. **The standard colours are read from the source**
// (`m3-common.loadPalette`), the colours typed are written here, the words are `ctx.t(...)`.

import { scenario } from '../lib/index.js'
import { REPO_FILE, loadPalette, largeProgram, revealLine, rgbOf, setTheme } from './m3-common.js'
import { openProbe } from './m9-common.js'
import {
  FEED_LINE,
  FEED_WORD,
  addProfile,
  alertText,
  askedNothing,
  cellProblem,
  colourCell,
  context,
  feedProgram,
  guard,
  openSettings,
  paintedColour,
  pickerInput,
  ready,
  resetButton,
  setField,
  settingsDialog,
  settingsFile,
  typeColour,
} from './p4-profiles-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

const DARK_FEED = '#ffaa00'
const DARK_TOOL = '#7fd4ff'
const LIGHT_FEED = '#7a3d00'
const PROFILE_FEED = '#552200'

/**
 * Presses the dialog's Cancel and answers what happens: it closed, or it asked (the question stays up for the caller to answer).
 * @param {Harness} h
 * @param {{ closed: Promise<unknown> }} opened
 * @returns {Promise<{ asked: boolean, text: string | null }>}
 */
async function cancelDialog(h, opened) {
  h.click(h.q('modal-cancel'))
  const outcome = await h.waitFor(async () => (!settingsDialog(h) ? 'closed' : (await h.alert.visible()) !== null ? 'asked' : null), { timeout: 6000, interval: 100 })
  if (outcome === 'asked') return { asked: true, text: await alertText(h) }
  await opened.closed
  await h.idle()
  return { asked: false, text: null }
}

/**
 * Discards what is typed in the open dialog: Cancel, and the answer "Discard changes" when it asks.
 * @param {Harness} h
 * @param {{ closed: Promise<unknown> }} opened
 */
async function discardDialog(h, opened) {
  const result = await cancelDialog(h, opened)
  if (result.asked) {
    await h.alert.click(context(h).t('settings.leave.ok'))
    await h.waitFor(() => !settingsDialog(h), { timeout: 8000 })
    await opened.closed
    await h.idle()
  }
}

/**
 * Exports the active document as HTML through the real command, form and (stubbed) save dialog, and answers the page.
 * @param {Harness} h
 * @param {string} name file name without the extension
 * @returns {Promise<string>}
 */
async function exportHtml(h, name) {
  const ctx = context(h)
  const out = `${h.cfg.run}/${name}.html`
  await h.dialogs.queue('save', out)
  const running = ctx.commands.run('file.exportHtml')
  await h.waitFor(() => h.q('modal', { modal: 'form' }), { timeout: 8000 })
  // The form remembers the last print: it is asked for colours, with numbers, at 9 points.
  for (const [id, value] of Object.entries({ colors: ctx.t('print.form.colorsColor'), lineNumbers: true, fontPt: 9 })) setField(h, id, value)
  await h.frame()
  h.click(h.q('modal-ok'))
  await h.waitFor(() => !h.q('modal'), { timeout: 8000 })
  await running
  await h.idle()
  return h.disk.read(out)
}

/**
 * Shows a document and waits until the editor has it.
 * @param {Harness} h
 * @param {string} id
 */
async function show(h, id) {
  context(h).docs.activate(id)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 8000 })
  await h.idle()
}

scenario('p4-profiles-colours', { timeout: 540, files: REPO_FILE }, async (h) => {
  const ctx = context(h)
  await ready(h)
  await setTheme(h, 'dark')
  const palette = await loadPalette(h)
  const builtinFeed = palette.dark?.feed
  const builtinLightFeed = palette.light?.feed
  h.check('the standard feed colours were read from the source (dark and light)', typeof builtinFeed === 'string' && typeof builtinLightFeed === 'string' && builtinFeed !== DARK_FEED, palette.dark?.feed)
  const id = await feedProgram(h)
  await revealLine(h, id, FEED_LINE, 1)
  /** The colour the open editor draws the feed word in now. */
  const drawn = () => paintedColour(h, id, FEED_LINE, FEED_WORD)
  await h.waitFor(() => drawn() === rgbOf(String(builtinFeed)), { timeout: 8000 })
  h.check('the feed word is drawn in the standard colour to begin with', drawn() === rgbOf(String(builtinFeed)), drawn())

  // ============================================================ A. set, refuse, preview, reset
  await guard(h, 'A. a role colour: set, refused, shown in the open editor, reset', async () => {
    const opened = await openSettings(h, 'appearance')
    const cell = colourCell(document, 'feed', 'dark')
    h.check('the page has a cell for each of the 18 kinds of word in both themes', h.qa('role-color-row').length === 36, h.qa('role-color-row').length)
    h.check('the feed colour is the standard one, with a ratio that passes (4.5 to 1), and there is nothing to reset', cell?.dataset.value === builtinFeed && cell.dataset.layer === 'builtin' && Number(cell.dataset.ratio) >= 4.5 && resetButton(cell)?.disabled === true, cell?.dataset)

    await typeColour(h, cell, DARK_FEED)
    h.check('a colour typed becomes the cell’s, "yours", and can be reset', cell?.dataset.value === DARK_FEED && cell.dataset.layer === 'user' && resetButton(cell)?.disabled === false, cell?.dataset)
    await h.waitFor(() => drawn() === rgbOf(DARK_FEED), { timeout: 8000 })
    h.check('the open editor draws the feed word in it at once, before anything is saved', drawn() === rgbOf(DARK_FEED), drawn())
    h.check('nothing is saved yet', JSON.stringify(ctx.settings.get('appearance.roleColors')) === '{}' && (await settingsFile(h))['appearance.roleColors'] === undefined, ctx.settings.get('appearance.roleColors'))

    await typeColour(h, cell, '#222222')
    h.check('a colour too faint on the dark background is refused with its ratio and the limit', cellProblem(cell) === ctx.t('appearance.codeColors.tooFaint', { theme: 'dark', ratio: cell?.dataset.ratio ?? '', min: '4.5' }) && Number(cell?.dataset.ratio) < 4.5, { problem: cellProblem(cell), ratio: cell?.dataset.ratio })
    h.check('the page says a colour cannot be saved and Save is off', h.q('role-colors')?.dataset.valid === 'no' && (h.q('role-colors-blocked')?.textContent ?? '').trim() === ctx.t('appearance.codeColors.cannotSave') && /** @type {HTMLButtonElement | null} */ (h.q('modal-ok'))?.disabled === true)
    await h.turns(6)
    h.check('the editor keeps the last colour that could be read', drawn() === rgbOf(DARK_FEED), drawn())

    await typeColour(h, cell, 'red')
    h.check('a text that is no colour is refused with the way to write one', cellProblem(cell) === ctx.t('appearance.codeColors.notAColor') && h.q('role-colors')?.dataset.valid === 'no', cellProblem(cell))

    await typeColour(h, cell, '#33ccff')
    h.check('a colour that can be read is accepted again: no refusal, Save is on', cellProblem(cell) === '' && h.q('role-colors')?.dataset.valid === 'yes' && !h.q('role-colors-blocked') && /** @type {HTMLButtonElement | null} */ (h.q('modal-ok'))?.disabled === false)
    await h.waitFor(() => drawn() === rgbOf('#33ccff'), { timeout: 8000 })
    h.check('and the editor shows it', drawn() === rgbOf('#33ccff'), drawn())

    h.click(resetButton(cell))
    await h.frame()
    h.check('Reset gives back the standard colour and has nothing left to reset', cell?.dataset.value === builtinFeed && cell.dataset.layer === 'builtin' && resetButton(cell)?.disabled === true, cell?.dataset)
    await h.waitFor(() => drawn() === rgbOf(String(builtinFeed)), { timeout: 8000 })
    h.check('and the editor draws it again', drawn() === rgbOf(String(builtinFeed)), drawn())

    await typeColour(h, cell, DARK_FEED)
    await h.waitFor(() => drawn() === rgbOf(DARK_FEED), { timeout: 8000 })
    const result = await cancelDialog(h, opened)
    h.check('Cancel asks, because a colour was changed', result.asked && (result.text ?? '').includes(ctx.t('settings.leave.title')) && (result.text ?? '').includes(ctx.t('settings.leave.valuesMessage')), result)
    await h.alert.click(ctx.t('settings.leave.ok'))
    await h.waitFor(() => !settingsDialog(h), { timeout: 8000 })
    await opened.closed
    await h.waitFor(() => drawn() === rgbOf(String(builtinFeed)), { timeout: 8000 })
    h.check('"Discard changes" puts the old colours back in the editor', drawn() === rgbOf(String(builtinFeed)), drawn())
    h.check('and nothing was saved', JSON.stringify(ctx.settings.get('appearance.roleColors')) === '{}' && (await settingsFile(h))['appearance.roleColors'] === undefined)
  })

  // ============================================================ B. save, and the question
  await guard(h, 'B. Save writes the colours, and the question is only asked for a real change', async () => {
    const opened = await openSettings(h, 'appearance')
    await typeColour(h, colourCell(document, 'tool', 'dark'), DARK_TOOL)
    await typeColour(h, colourCell(document, 'feed', 'dark'), DARK_FEED)
    await typeColour(h, colourCell(document, 'feed', 'light'), LIGHT_FEED)
    h.click(h.q('modal-ok'))
    await h.waitFor(() => !settingsDialog(h), { timeout: 10000 })
    await opened.closed
    await h.idle()
    /** @type {any} */
    const saved = (await settingsFile(h))['appearance.roleColors']
    h.check('Save wrote the three colours, in the dark and the light theme, and nothing else', saved?.dark?.feed === DARK_FEED && saved?.dark?.tool === DARK_TOOL && saved?.light?.feed === LIGHT_FEED && Object.keys(saved?.dark ?? {}).length === 2 && Object.keys(saved?.light ?? {}).length === 1, saved)
    await h.waitFor(() => drawn() === rgbOf(DARK_FEED), { timeout: 8000 })
    h.check('the editor keeps the saved colour after the dialog closed', drawn() === rgbOf(DARK_FEED), drawn())

    // The same colour, entered again in capitals.
    let again = await openSettings(h, 'appearance')
    const cell = colourCell(document, 'feed', 'dark')
    h.check('the saved colours are in the cells, as the user’s', cell?.dataset.value === DARK_FEED && cell.dataset.layer === 'user')
    await typeColour(h, cell, DARK_FEED.toUpperCase())
    h.check('capitals are the same colour: the cell holds it in small letters', cell?.dataset.value === DARK_FEED && cell.dataset.layer === 'user', cell?.dataset)
    let result = await cancelDialog(h, again)
    h.check('entering the same colour again is no change: Cancel asks nothing and closes', !result.asked && !settingsDialog(h), result)
    if (result.asked) await discardDialog(h, again)

    // A colour reset and entered again: the roles were edited in another order than they are kept in (CODE-8).
    again = await openSettings(h, 'appearance')
    const feed = colourCell(document, 'feed', 'dark')
    h.click(resetButton(feed))
    await h.frame()
    await typeColour(h, feed, DARK_FEED)
    h.check('the feed colour was reset and typed again', feed?.dataset.value === DARK_FEED && feed.dataset.layer === 'user')
    result = await cancelDialog(h, again)
    h.check('the same colours, edited in another order than they are kept in, are no change: Cancel asks nothing', !result.asked && !settingsDialog(h), result)
    if (result.asked) await discardDialog(h, again)

    // A different colour does ask.
    again = await openSettings(h, 'appearance')
    await typeColour(h, colourCell(document, 'feed', 'dark'), '#ffbb00')
    result = await cancelDialog(h, again)
    h.check('a different colour makes Cancel ask', result.asked && (result.text ?? '').includes(ctx.t('settings.leave.valuesMessage')), result)
    await h.alert.click('Cancel')
    await h.idle()
    h.check('the answer Cancel keeps the dialog and the typed colour', !!settingsDialog(h) && colourCell(document, 'feed', 'dark')?.dataset.value === '#ffbb00')
    await discardDialog(h, again)
    h.check('and "Discard changes" leaves the saved colour as it was', !settingsDialog(h) && JSON.stringify(((await settingsFile(h))['appearance.roleColors'])?.dark?.feed) === JSON.stringify(DARK_FEED))
  })

  // ============================================================ C. print and export
  await guard(h, 'C. the exported page uses the user’s colour, a profile’s own wins for its documents', async () => {
    await show(h, id)
    let html = await exportHtml(h, 'user-colour')
    h.check('the page uses the user’s light colour for the feed word', html.includes(`color:${LIGHT_FEED}`), html.slice(html.indexOf('<style>'), html.indexOf('<style>') + 400))
    h.check('and not the standard light colour of that kind of word', typeof builtinLightFeed === 'string' && !html.includes(`color:${builtinLightFeed}`), builtinLightFeed)

    await addProfile(h, 'shop-print.json', { id: 'shop-print', name: 'Shop print', shortName: 'SHOP PR', version: 1, extends: 'fanuc-gcode', detect: { content: [] }, colors: { light: { feed: PROFILE_FEED } } })
    const own = await feedProgram(h, 'shop-print')
    await show(h, own)
    h.check('the second program is a program of the profile with its own light colour', ctx.docs.get(own)?.profileId === 'shop-print')
    html = await exportHtml(h, 'profile-colour')
    h.check('its page uses the profile’s colour for the feed word, which wins over the user’s', html.includes(`color:${PROFILE_FEED}`) && !html.includes(`color:${LIGHT_FEED}`), html.slice(html.indexOf('<style>'), html.indexOf('<style>') + 400))

    await show(h, id)
    html = await exportHtml(h, 'user-colour-again')
    h.check('a program of another profile still gets the user’s colour', html.includes(`color:${LIGHT_FEED}`) && !html.includes(`color:${PROFILE_FEED}`))
  })

  h.check('no alert was left unanswered by the sections above', (await h.alert.visible()) === null)
})

// ================================================================================================ p4-profiles-colours-drag

/** Lines of the program that is open while the picker is dragged. */
const DRAG_LINES = 100000
/** The input events of the dragging, one per frame like a mouse; and the burst in one task. */
const DRAG_EVENTS = 90
const BURST_EVENTS = 200
/** The line of the program whose feed word the scenario reads (`G1 X… Y… Z… F800.`). */
const BIG_LINE = 12
const BIG_WORD = 'F800.'

/** A colour that can be read on both backgrounds, `i` of `count` along the green channel. @param {number} i @param {number} count */
function along(i, count) {
  const green = 0x80 + Math.floor((i * 0x7f) / Math.max(1, count - 1))
  return `#ff${green.toString(16).padStart(2, '0')}00`
}

scenario('p4-profiles-colours-drag', { timeout: 600, files: REPO_FILE }, async (h) => {
  const ctx = context(h)
  await ready(h)
  await setTheme(h, 'dark')
  const big = await openProbe(h, 'BIG-DRAG.nc', largeProgram({ lines: DRAG_LINES }).replace(/\r\n/g, '\n'), 'fanuc-gcode')
  await revealLine(h, big.id, BIG_LINE, 1)
  const drawn = () => paintedColour(h, big.id, BIG_LINE, BIG_WORD)
  h.check(`a program of ${DRAG_LINES.toLocaleString('en-US')} lines is open as a Fanuc program`, ctx.editor.getLineCount(big.id) >= DRAG_LINES && ctx.docs.get(big.id)?.profileId === 'fanuc-gcode', ctx.editor.getLineCount(big.id))
  const standard = await h.waitFor(() => drawn(), { timeout: 15000 })
  h.check('the feed word of line 12 is drawn', typeof standard === 'string' && standard !== '', standard)

  const opened = await openSettings(h, 'appearance')
  const cell = colourCell(document, 'feed', 'dark')
  const picker = pickerInput(cell)
  if (!picker) throw new Error('the feed cell has no colour picker')

  await guard(h, 'dragging the colour picker', async () => {
    // One input event per frame, as a mouse produces them; the longest gap between two frames is how long the page was stuck.
    const colours = Array.from({ length: DRAG_EVENTS }, (_, i) => along(i, DRAG_EVENTS))
    /** @type {number[]} */
    const gaps = []
    const started = performance.now()
    let last = started
    for (const colour of colours) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
      const now = performance.now()
      gaps.push(now - last)
      last = now
      picker.value = colour
      picker.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const worst = Math.max(...gaps)
    const finalColour = colours[colours.length - 1]
    const settledAt = performance.now()
    await h.waitFor(() => drawn() === rgbOf(finalColour), { timeout: 20000, interval: 20 })
    const settle = performance.now() - settledAt
    h.checkTime(`dragging: the longest wait for a frame in ${DRAG_EVENTS} input events`, worst, 300, { total: Math.round(performance.now() - started), frames: gaps.length })
    h.checkTime('dragging: the open editor shows the last colour after the last event', settle, 1500, { drawn: drawn() })
    h.check('the cell holds the last colour, as a valid one', cell?.dataset.value === finalColour && h.q('role-colors')?.dataset.valid === 'yes', cell?.dataset)
    h.check('and the open editor draws the feed word in it', drawn() === rgbOf(finalColour), drawn())
  })

  await guard(h, 'a burst of events in one task, and a click right after', async () => {
    const t0 = performance.now()
    for (let i = 0; i < BURST_EVENTS; i++) {
      picker.value = along(i, BURST_EVENTS)
      picker.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const burst = performance.now() - t0
    h.checkTime(`${BURST_EVENTS} input events in one task (the cost of the handlers before the page draws)`, burst, 1500)
    const last = along(BURST_EVENTS - 1, BURST_EVENTS)
    await h.waitFor(() => drawn() === rgbOf(last), { timeout: 20000, interval: 20 })
    h.check('the editor shows the last colour of the burst, not an earlier one', drawn() === rgbOf(last), drawn())

    // The dialog still answers: a click on Reset takes effect within the budget.
    const clicked = performance.now()
    h.click(resetButton(cell))
    await h.waitFor(() => cell?.dataset.layer === 'builtin', { timeout: 10000, interval: 10 })
    h.checkTime('a click on Reset right after the burst takes effect', performance.now() - clicked, 500, { layer: cell?.dataset.layer })
    await h.waitFor(() => drawn() === standard, { timeout: 20000 })
    h.check('and the editor goes back to the standard colour', drawn() === standard, drawn())
  })

  const result = await cancelDialog(h, opened)
  if (result.asked) {
    await h.alert.click(ctx.t('settings.leave.ok'))
    await h.waitFor(() => !settingsDialog(h), { timeout: 8000 })
    await opened.closed
  }
  h.check('Cancel leaves nothing behind: no colour saved, no question left up', JSON.stringify(ctx.settings.get('appearance.roleColors')) === '{}' && (await askedNothing(h)))
})
