// P4e, split view (plan `docs/planning/phase-4-implementation.md` §5 P4e, P4.21; exit criterion X29, the split
// half): the document in two panes on one model, each with its own cursor and scroll, F6 and Shift+F6 between
// them, the 2 px accent border on the pane with the keyboard, the splitter, Close Split, a second editor that
// leaves the theme as it was, and the comparison that takes the editors away and gives them back.
//
// What only the running app can prove (the unit tests use a fake Monaco):
//   A. the theme       a second editor is built without a `theme` option, because Monaco hands a `theme` to its one
//                      global theme service (F118: the whole window used to fall back to dark). In the light and the
//                      dark theme: both editors wear the theme in force and paint the same background, the stored
//                      choice and `data-theme` do not move, and a theme change with the split open reaches both.
//   B. one editor      no header, no border, F6 and Close Split are not offered, Split Editor is.
//   C. split right     the ribbon button (View tab, group Editor) opens two panes side by side; the new pane starts
//                      where the first one is and takes the keyboard (service and browser agree); each pane has a header
//                      with the document's name and a close button; the focused pane has the accent border, the other a
//                      transparent border of the same width; Split Editor is not offered again, Close Split is.
//   D. one document    one model in both panes; own cursor and own scroll per pane; the status bar's cursor, `h.app.cursor()`
//                      and the typing options follow the focused pane (a typed `g` becomes `G` in pane 2); ONE undo
//                      history: Cmd+Z from pane 1 takes back what was typed in pane 2, Cmd+Shift+Z brings it back.
//   E. F6              real key presses move the keyboard between the panes and wrap, and the border follows.
//   F. the splitter    an arrow key moves it by 5 per cent, a double click makes the panes equal again.
//   G. split down      from the open split, Split Editor Down lays the same two panes one above the other, and
//                      Split Editor lays them side by side again (the same group ids, the same cursors).
//   H. close           a pane's own X closes it, Close Split from the ribbon closes the split; the one editor that is
//                      left shows the focused pane's cursor.
//   I. the comparison  with a split open, a comparison takes both editors away (`editorInstance()` is undefined, no split
//                      command is offered) and closing it builds them again: both panes, the same pane focused, the
//                      keyboard back in it, each cursor where it was.
//
// The program is 120 lines written here; the checks name their lines. Nothing is read from what the app shows except
// through the test ids and the editors' own models.

import { scenario } from '../lib/index.js'
import { closeCompare, openCompare, monacoRegistry, view as compareView } from './m11-common.js'
import {
  appTheme,
  clickRibbon,
  colourOfVariable,
  context,
  editorLooks,
  editorOf,
  focusedGroup,
  groupIds,
  groupsOnScreen,
  guard,
  hostGroups,
  hostLayout,
  lineOf,
  monacoThemeFor,
  newDoc,
  nextPane,
  placeCursor,
  previousPane,
  ready,
  redoKey,
  ribbonDisabled,
  ribbonEnabled,
  ribbonTab,
  setTheme,
  textOf,
  typeText,
  undoKey,
  views,
  waitFocus,
  waitGroups,
} from './p4e-common.js'

/** The program: a comment saying what it is, then 119 numbered blocks. */
const PROGRAM_LINES = [
  '(SYNTHETIC TEST PROGRAM FOR THE SPLIT VIEW, NOT FOR A MACHINE)',
  ...Array.from({ length: 119 }, (_, i) => `N${(i + 1) * 10} G01 X${(i % 40) + 1}. Y${(i % 17) + 1}. F200`),
]
const PROGRAM = `${PROGRAM_LINES.join('\n')}\n`

/** A second, different program for the comparison of section I. */
const OTHER = `${PROGRAM_LINES.map((line, i) => (i === 4 ? `${line} (CHANGED)` : line)).join('\n')}\n`

/** The accent colour at the border, as WebKit prints it, and the transparent one. */
const TRANSPARENT = 'rgba(0, 0, 0, 0)'

scenario('p4-split', { timeout: 420 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const id = await newDoc(h, PROGRAM, 'fanuc-gcode')
  const other = await newDoc(h, OTHER, 'fanuc-gcode')
  ctx.docs.activate(id)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 8000 })
  await h.idle()
  const title = ctx.docs.get(id)?.title ?? ''
  const reg = monacoRegistry(h)

  // ============================================================ B. one editor
  await guard(h, 'B. one editor', async () => {
    const [only] = groupsOnScreen(h)
    h.check('the host has one group in the layout "single"', hostLayout(h) === 'single' && hostGroups(h) === 1 && groupsOnScreen(h).length === 1, { layout: hostLayout(h), groups: hostGroups(h) })
    h.check('the service says the same', ctx.editor.groupsState().layout === 'single' && ctx.editor.groupsState().groups.length === 1, ctx.editor.groupsState())
    h.check('a single group has no header and no splitter', h.qa('editor-group-header').length === 0 && h.qa('editor-splitter').length === 0)
    h.check('and no border (the border is only for more than one pane)', getComputedStyle(only.el).borderTopWidth === '0px', getComputedStyle(only.el).borderTopWidth)
    await ribbonTab(h, 'view')
    h.check('Split Editor and Split Editor Down are on offer; Close Split, F6 and Shift+F6 are not', ribbonEnabled(h, 'view.splitEditor') && ribbonEnabled(h, 'view.splitEditorDown') && ribbonDisabled(h, 'view.closeSplit') && !ctx.commands.isEnabled('view.focusNextPane') && !ctx.commands.isEnabled('view.focusPreviousPane'), {
      split: ribbonEnabled(h, 'view.splitEditor'),
      down: ribbonEnabled(h, 'view.splitEditorDown'),
      close: ribbonEnabled(h, 'view.closeSplit'),
      next: ctx.commands.isEnabled('view.focusNextPane'),
    })
    h.check('F6 and Shift+F6 carry the keys of the plan', ctx.commands.get('view.focusNextPane')?.keys === 'F6' && ctx.commands.get('view.focusPreviousPane')?.keys === 'Shift+F6', [ctx.commands.get('view.focusNextPane')?.keys, ctx.commands.get('view.focusPreviousPane')?.keys])
    h.check('and the split commands carry none (the usual split key needs AltGr on a Swiss German keyboard)', ['view.splitEditor', 'view.splitEditorDown', 'view.closeSplit'].every((c) => ctx.commands.get(c) !== undefined && ctx.commands.get(c)?.keys === undefined))
  })

  // ============================================================ A. the theme, in both themes
  await guard(h, 'A. the second editor leaves the theme as it was', async () => {
    for (const mode of /** @type {const} */ (['light', 'dark'])) {
      const flip = mode === 'light' ? 'dark' : 'light'
      await setTheme(h, mode)
      await h.waitFor(() => editorLooks().length === 1 && editorLooks()[0].theme === monacoThemeFor(mode), { timeout: 5000 })
      const one = editorLooks()
      h.check(`${mode}: one editor, on the ${monacoThemeFor(mode)} theme`, one.length === 1 && one[0].theme === monacoThemeFor(mode), one)

      await clickRibbon(h, 'view', 'view.splitEditor')
      await waitGroups(h, 2, 'side-by-side')
      const two = editorLooks()
      h.check(`${mode}: after Split Editor both editors wear the ${monacoThemeFor(mode)} theme (the second one did not set the global theme)`, two.length === 2 && two.every((l) => l.theme === monacoThemeFor(mode)), two)
      h.check(`${mode}: and both paint the first editor's background, computed from the theme`, one.length === 1 && two.length === 2 && two.every((l) => l.background === one[0].background && l.variable === one[0].variable), { before: one, after: two })
      h.check(`${mode}: the document's theme and the stored choice did not move`, appTheme(h).data === mode && appTheme(h).setting === mode, appTheme(h))
      const state = ctx.editor.groupsState()
      h.check(`${mode}: the service lists the two panes of one document`, state.layout === 'side-by-side' && state.groups.length === 2 && state.groups.every((g) => g.content?.kind === 'document' && g.content.docId === id), state)

      // A theme change with the split open reaches both editors (one hands the theme to the global service).
      await setTheme(h, flip)
      await h.waitFor(() => editorLooks().length === 2 && editorLooks().every((l) => l.theme === monacoThemeFor(flip)), { timeout: 8000 })
      h.check(`${mode}: switching to ${flip} with the split open changes both editors`, editorLooks().length === 2 && editorLooks().every((l) => l.theme === monacoThemeFor(flip)), editorLooks())
      await setTheme(h, mode)
      await h.waitFor(() => editorLooks().length === 2 && editorLooks().every((l) => l.theme === monacoThemeFor(mode)), { timeout: 8000 })
      h.check(`${mode}: and back`, one.length === 1 && editorLooks().length === 2 && editorLooks().every((l) => l.theme === monacoThemeFor(mode) && l.background === one[0].background), editorLooks())

      await clickRibbon(h, 'view', 'view.closeSplit')
      await waitGroups(h, 1, 'single')
      const back = editorLooks()
      h.check(`${mode}: after Close Split the one editor is still on the ${monacoThemeFor(mode)} theme`, back.length === 1 && back[0].theme === monacoThemeFor(mode) && back[0].background === one[0].background, back)
    }
  })

  // ============================================================ C. split right
  ctx.docs.activate(id)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 8000 })
  ctx.editor.reveal(id, 60, 1)
  await h.idle()
  const firstScroll = ctx.editor.topLine() ?? 0
  /** @type {string[]} */
  let ids = []
  await guard(h, 'C. split right', async () => {
    await clickRibbon(h, 'view', 'view.splitEditor')
    const groups = await waitGroups(h, 2, 'side-by-side')
    ids = groupIds(h)
    h.check('two groups, side by side, on the one document', groups.length === 2 && groups.every((g) => g.docId === id && g.kind === 'document'), groups.map((g) => `${g.id}:${g.docId}:${g.kind}`))
    h.check('the new pane has the keyboard: the service says so, and so does the browser', focusedGroup(h) === ids[1] && (await waitFocus(h, ids[1])) && groups[1].focused, { focused: focusedGroup(h), active: document.activeElement?.tagName })
    h.check('it starts where the first pane is: the cursor on line 60 in both', views(h).length === 2 && views(h).every((v) => v.editor.getPosition()?.lineNumber === 60), views(h).map((v) => v.editor.getPosition()))
    h.check('and the first pane is still scrolled to the same place', Math.abs((ctx.editor.topLine() ?? 0) - firstScroll) <= 2, { before: firstScroll, after: ctx.editor.topLine() })
    const headers = h.qa('editor-group-header')
    h.check('each pane has a header with the document\'s name and a close button', headers.length === 2 && headers.every((x) => x.querySelector('.title')?.textContent?.trim() === title) && h.qa('editor-group-close').length === 2, headers.map((x) => x.textContent?.trim()))
    h.check('one splitter between them, a separator', h.qa('editor-splitter').length === 1 && h.q('editor-splitter')?.getAttribute('role') === 'separator')

    const accent = colourOfVariable('--accent')
    const border = (/** @type {number} */ i) => getComputedStyle(groups[i].el)
    h.check('both panes have a border of the same width, so the focus moving moves nothing', border(0).borderTopWidth === '2px' && border(1).borderTopWidth === '2px', [border(0).borderTopWidth, border(1).borderTopWidth])
    h.check('the pane with the keyboard has the accent border, the other a transparent one', border(1).borderTopColor === accent && border(0).borderTopColor === TRANSPARENT, { accent, first: border(0).borderTopColor, second: border(1).borderTopColor })
    h.check('side by side: the second pane lies to the right of the first, on the same height', groups[1].el.getBoundingClientRect().left >= groups[0].el.getBoundingClientRect().right - 1 && Math.abs(groups[1].el.getBoundingClientRect().top - groups[0].el.getBoundingClientRect().top) < 2)
    h.check('Split Editor is not offered again; Split Editor Down and Close Split are', ribbonDisabled(h, 'view.splitEditor') && ribbonEnabled(h, 'view.splitEditorDown') && ribbonEnabled(h, 'view.closeSplit'), { split: ribbonEnabled(h, 'view.splitEditor'), down: ribbonEnabled(h, 'view.splitEditorDown'), close: ribbonEnabled(h, 'view.closeSplit') })
    h.check('F6 and Shift+F6 are on offer now', ctx.commands.isEnabled('view.focusNextPane') && ctx.commands.isEnabled('view.focusPreviousPane'))
  })

  // ============================================================ D. one document in two panes
  await guard(h, 'D. one text, one undo, an own cursor and scroll per pane', async () => {
    if (ids.length !== 2) throw new Error('no split to work in')
    const [first, second] = ids
    const a = editorOf(h, first)
    const b = editorOf(h, second)
    h.check('both panes show one model', !!a && !!b && a.getModel() === b.getModel() && a.getModel() !== null, { same: a?.getModel() === b?.getModel() })

    // Own cursor and own scroll.
    b.setPosition({ lineNumber: 100, column: 1 })
    b.revealLineInCenter(100)
    await h.idle()
    h.check('the second pane\'s cursor moved to line 100 and the first pane\'s did not', b.getPosition().lineNumber === 100 && a.getPosition().lineNumber === 60, { first: a.getPosition(), second: b.getPosition() })
    h.check('the second pane scrolled; the first kept its own place', b.getScrollTop() !== a.getScrollTop() && a.getVisibleRanges()[0].startLineNumber < 60 && b.getVisibleRanges()[0].startLineNumber > 60, { first: a.getVisibleRanges()[0], second: b.getVisibleRanges()[0] })
    h.check('the cursor the app reports (status bar, inspector, program map) is the focused pane\'s', h.app.cursor().line === 100, h.app.cursor())

    // The typing options follow the focused pane: a typed g is a G, in pane 2.
    await placeCursor(h, second, 3, 1)
    const before = textOf(h, id)
    await typeText(h, 'g')
    const want3 = `G${PROGRAM_LINES[2]}`
    h.check('a lower-case g typed in the second pane is written as a G (the typing options follow the focused pane)', lineOf(h, id, 3) === want3, { line: lineOf(h, id, 3), want: want3 })
    h.check('the first pane shows the same line (one model)', a.getModel().getLineContent(3) === want3)
    h.check('the document is marked as changed', ctx.docs.get(id)?.dirty === true)
    h.check('the cursor of the first pane was not pulled to the edit', a.getPosition().lineNumber === 60, a.getPosition())

    // One undo history: from the first pane.
    await nextPane(h)
    await waitFocus(h, first)
    h.check('F6 moved the keyboard to the first pane (wrapping from the second) and h.app.cursor() follows it', focusedGroup(h) === first && h.app.cursor().line === 60, { focused: focusedGroup(h), cursor: h.app.cursor() })
    await undoKey(h)
    await h.waitFor(() => textOf(h, id) === before, { timeout: 8000 })
    h.check('one Cmd+Z in the first pane takes back what was typed in the second: one history for the document', textOf(h, id) === before, { line: lineOf(h, id, 3) })
    await redoKey(h)
    await h.waitFor(() => lineOf(h, id, 3) === want3, { timeout: 8000 })
    h.check('Cmd+Shift+Z brings it back', lineOf(h, id, 3) === want3, lineOf(h, id, 3))
    await undoKey(h)
    await h.waitFor(() => textOf(h, id) === before, { timeout: 8000 })
    h.check('and a last undo leaves the document as it was', textOf(h, id) === before && ctx.docs.get(id)?.dirty !== true, { dirty: ctx.docs.get(id)?.dirty })
  })

  // ============================================================ E. F6 and Shift+F6
  await guard(h, 'E. F6 and Shift+F6', async () => {
    const [first, second] = ids
    if (!first || !second) throw new Error('no split to work in')
    await waitFocus(h, first)
    const accent = colourOfVariable('--accent')
    const colours = () => groupsOnScreen(h).map((g) => getComputedStyle(g.el).borderTopColor)
    h.check('start: the first pane has the keyboard and the accent border', focusedGroup(h) === first && colours()[0] === accent && colours()[1] === TRANSPARENT, colours())
    await nextPane(h)
    await waitFocus(h, second)
    h.check('F6 moves to the second pane; the border follows', focusedGroup(h) === second && colours()[1] === accent && colours()[0] === TRANSPARENT, colours())
    await nextPane(h)
    await waitFocus(h, first)
    h.check('F6 again wraps to the first', focusedGroup(h) === first && colours()[0] === accent, colours())
    await previousPane(h)
    await waitFocus(h, second)
    h.check('Shift+F6 goes back, wrapping the other way', focusedGroup(h) === second && colours()[1] === accent, colours())
    h.check('exactly one pane is marked focused at a time', groupsOnScreen(h).filter((g) => g.focused).length === 1)
  })

  // ============================================================ F. the splitter
  await guard(h, 'F. the splitter', async () => {
    const splitter = h.q('editor-splitter')
    if (!splitter) throw new Error('no splitter')
    const widths = () => groupsOnScreen(h).map((g) => g.el.getBoundingClientRect().width)
    h.check('start: the panes share the room equally', splitter.getAttribute('aria-valuenow') === '50' && Math.abs(widths()[0] - widths()[1]) < 2, { now: splitter.getAttribute('aria-valuenow'), widths: widths() })
    splitter.focus()
    await h.nativeKeys([{ key: 'ArrowRight' }])
    await h.idle()
    h.check('an arrow key moves it by 5 per cent: the first pane is wider', splitter.getAttribute('aria-valuenow') === '55' && widths()[0] > widths()[1] + 20, { now: splitter.getAttribute('aria-valuenow'), widths: widths() })
    await h.nativeClick(splitter, { clickCount: 2 })
    await h.waitFor(() => splitter.getAttribute('aria-valuenow') === '50', { timeout: 5000 })
    h.check('a double click makes them equal again', splitter.getAttribute('aria-valuenow') === '50' && Math.abs(widths()[0] - widths()[1]) < 2, { now: splitter.getAttribute('aria-valuenow'), widths: widths() })
  })

  // ============================================================ G. split down and back
  await guard(h, 'G. split down, and side by side again', async () => {
    const [first, second] = ids
    const before = views(h).map((v) => v.editor.getPosition().lineNumber)
    await clickRibbon(h, 'view', 'view.splitEditorDown')
    const groups = await waitGroups(h, 2, 'stacked')
    h.check('Split Editor Down lays the same two panes one above the other', groups.length === 2 && groups[0].id === first && groups[1].id === second, groups.map((g) => g.id))
    const top = groups[0].el.getBoundingClientRect()
    const bottom = groups[1].el.getBoundingClientRect()
    h.check('the second pane is below the first', bottom.top >= top.bottom - 1 && Math.abs(bottom.left - top.left) < 2, { top, bottom })
    h.check('the splitter says it is horizontal', h.q('editor-splitter')?.getAttribute('aria-orientation') === 'horizontal')
    h.check('no new pane was made, and the cursors are where they were', groupIds(h).join() === ids.join() && views(h).map((v) => v.editor.getPosition().lineNumber).join() === before.join(), { ids: groupIds(h), before, after: views(h).map((v) => v.editor.getPosition().lineNumber) })
    h.check('now Split Editor is on offer and Split Editor Down is not', ribbonEnabled(h, 'view.splitEditor') && ribbonDisabled(h, 'view.splitEditorDown'))
    await clickRibbon(h, 'view', 'view.splitEditor')
    const again = await waitGroups(h, 2, 'side-by-side')
    h.check('Split Editor from the stacked split lays them side by side again, still two panes', again.length === 2 && again[0].id === first && again[1].id === second, again.map((g) => g.id))
  })

  // ============================================================ I. the comparison takes the editors away
  await guard(h, 'I. the comparison detaches the panes and builds them again', async () => {
    const [first, second] = ids
    await placeCursor(h, first, 40, 1)
    await placeCursor(h, second, 90, 1)
    const wasTop = /** @type {number[]} */ (views(h).map((v) => v.editor.getVisibleRanges()[0].startLineNumber))
    h.check('start: the second pane has the keyboard, the cursors are on lines 40 and 90', focusedGroup(h) === second && views(h).map((v) => v.editor.getPosition().lineNumber).join() === '40,90', views(h).map((v) => v.editor.getPosition()))
    await openCompare(h, reg, id, { kind: 'document', docId: other })
    h.check('the comparison replaced the editor area: no host, no group on screen', !h.q('editor-host') && groupsOnScreen(h).length === 0 && !!compareView(h))
    h.check('while it is open there is no editor: editorInstance() is undefined', ctx.editor.editorInstance() === undefined, typeof ctx.editor.editorInstance())
    h.check('the service still holds the split: two groups, the second focused', ctx.editor.groupsState().layout === 'side-by-side' && ctx.editor.groupsState().groups.length === 2 && focusedGroup(h) === second, ctx.editor.groupsState())
    h.check('no split command is offered meanwhile (not on the ribbon, not by key)', !ctx.commands.isEnabled('view.splitEditor') && !ctx.commands.isEnabled('view.splitEditorDown') && !ctx.commands.isEnabled('view.closeSplit') && !ctx.commands.isEnabled('view.focusNextPane') && !ctx.commands.isEnabled('view.focusPreviousPane'))
    await closeCompare(h)
    const groups = await waitGroups(h, 2, 'side-by-side')
    h.check('closing the comparison builds both panes again, side by side, on the same document', groups.length === 2 && groups.every((g) => g.docId === id) && groups[0].id === first && groups[1].id === second, groups.map((g) => `${g.id}:${g.docId}`))
    h.check('and the same pane is focused, the keyboard is back in it', (await waitFocus(h, second)) && groupsOnScreen(h)[1].focused, { focused: focusedGroup(h), active: document.activeElement?.tagName })
    h.check('each pane\'s cursor is where it was (40 and 90)', views(h).map((v) => v.editor.getPosition().lineNumber).join() === '40,90', views(h).map((v) => v.editor.getPosition()))
    const nowTop = /** @type {number[]} */ (views(h).map((v) => v.editor.getVisibleRanges()[0].startLineNumber))
    h.check('and each pane is scrolled to about the same place', nowTop.length === 2 && wasTop.length === 2 && nowTop.every((top, i) => Math.abs(top - wasTop[i]) <= 3), { was: wasTop, now: nowTop })
    h.check('the one model is shared again', views(h)[0].editor.getModel() === views(h)[1].editor.getModel())
    h.check('the split commands are on offer again', ribbonEnabled(h, 'view.splitEditorDown') && ribbonEnabled(h, 'view.closeSplit'))
  })

  // ============================================================ H. close
  await guard(h, 'H. close a pane, close the split', async () => {
    const [first, second] = ids
    const closeButton = (/** @type {string} */ group) => h.qa('editor-group-close').find((b) => b.dataset.group === group)
    await placeCursor(h, second, 90, 1)
    h.click(closeButton(first))
    const left = await waitGroups(h, 1, 'single')
    h.check('the X in a pane\'s header closes that pane: one editor is left', left.length === 1 && hostLayout(h) === 'single' && h.qa('editor-group-header').length === 0, left.map((g) => g.id))
    h.check('and it shows the document at the cursor of the pane that was focused (line 90)', ctx.editor.groupsState().groups.length === 1 && h.app.cursor().line === 90, h.app.cursor())

    await clickRibbon(h, 'view', 'view.splitEditor')
    const split = await waitGroups(h, 2, 'side-by-side')
    h.check('Split Editor splits again', split.length === 2)
    const second2 = groupIds(h)[1]
    await placeCursor(h, second2, 7, 1)
    await clickRibbon(h, 'view', 'view.closeSplit')
    const closed = await waitGroups(h, 1, 'single')
    h.check('Close Split goes back to one editor, no header, no splitter', closed.length === 1 && h.qa('editor-group-header').length === 0 && h.qa('editor-splitter').length === 0)
    h.check('which shows the focused pane\'s cursor (line 7)', h.app.cursor().line === 7 && ribbonDisabled(h, 'view.closeSplit') && ribbonEnabled(h, 'view.splitEditor'), { cursor: h.app.cursor() })
    h.check('the text was never touched', textOf(h, id) === PROGRAM && ctx.docs.get(id)?.dirty !== true)
  })

  h.check('no split command left anything behind: one group in the service', ctx.editor.groupsState().groups.length === 1 && ctx.editor.groupsState().layout === 'single')
})
