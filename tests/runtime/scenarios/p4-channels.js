// P4e, the channel view and Merge Channels Back (plan `docs/planning/phase-4-implementation.md` §5 P4e, P4.22 and
// P4.23; exit criterion X29, the channel half): the channels of a program side by side in one pane each, lined up at
// their wait codes, always scrolling together, edited with one undo history, and a split brought back.
//
// **The programs are synthetic** (`tests/fixtures/p4e/README.md` has every line number): `twin-sections.nc`, two
// channels in one file (the machine's block is the one of `tests/fixtures/channels/resolve/c10-alternating.json`), and
// `threepath.NC1`, `.NC2`, `.NC3`, one file per path (the built-in preset `fanuc-lathe/fanuc-3path-digits`). The waits
// are the owner's (2026-10-17): `P` lists the channels as digits, `M901P12` meets in channels 1 and 2, `M910P123` in all
// three. The twin program's machine declares two channels only, so its wait for every channel is `M910P12`: a `P123` there
// would name a channel 3 the machine does not have and stay unmatched (plan section 9, NC-11). The expected alignment is worked out by hand from the line numbers (a wait is pushed down to the lowest of its
// partners, then every pane is as tall as the tallest) and written out below; it is not read from the app.
//
//   A. refusals        no machine: the command is off. A one-channel program: "no channels". (One file per channel with the
//                      other files not picked is the first section of C: the file dialog and "open at least two".)
//   B. one program     NC tab, Channels Side by Side: the bar (`channel-view-bar` and its data attributes and texts), two panes
//                      with the program's line numbers, the pane at the cursor focused; the filler zones, the panes level at
//                      each wait (the tops of the wait lines are equal) and equally tall; matched and unmatched marks in the
//                      margin, in the model's decorations and in the DOM, and the hover of an unmatched one; scroll one pane
//                      by script, by the keyboard, to the end and back: all follow with no drift; a pane edit (digits typed in
//                      pane 2; a new line, which moves the zones) is ONE undo step from either pane, with Cmd+Z, Cmd+Shift+Z
//                      and Edit > Undo, and the pane where the change is takes the focus; a digit typed in front of a section
//                      start in a pane is refused with the plain message, the program and the pane as they were (P4e review
//                      NC-2); the compare overlay takes the editors away and the view survives it; the bar's button, Close
//                      Split and a pane's own X end the view.
//   N. matching mark   Mod+Alt+P pairs the same code with the same P set (plan section 7 #388): M901P12 meets M901P12, and
//                      M902P123 in channel 1 has no partner in channel 2's M902P12 (before P4e it jumped there).
//   C. three files     the file dialog offers the other two, nothing opens by itself; three panes, "5 of 6 waits lined up,
//                      1 wait has no partner"; an edit in file 1 and an edit in file 2 are undone newest first wherever
//                      the keyboard is and the pane of each takes the focus (one history over three documents); file 3 is
//                      never touched; a pane's X leaves two panes and names the third in the bar, the second X ends the view;
//                      running the command again opens the view from the open files without asking. Closing the FIRST pane of
//                      three, and (opened again) the MIDDLE one: each editor that is left shows only its own path's marks and
//                      zones, and the two scroll together (P4e review CODE-1, CODE-13).
//   D. merge back      Split into Channel Documents, an edit in each channel document, Merge Channels Back writes both into the
//                      program as ONE undo step (and again after the undo); a program changed in a channel's lines since the
//                      split refuses the merge in plain words and changes nothing.

import { scenario } from '../lib/index.js'
import { hoverAt } from './m3-common.js'
import { read } from './m5-common.js'
import { openCompare, closeCompare, monacoRegistry } from './m11-common.js'
import { NC_DIR, REPO_FILE, blockOf, channelMachines, goto, keys, presetBlock, open, press, waitChannel } from './m12-common.js'
import {
  clickRibbon,
  context,
  focusedGroup,
  groupIds,
  groupsOnScreen,
  guard,
  hostGroups,
  hostLayout,
  message,
  newDoc,
  nextPane,
  placeCursor,
  pressKey,
  ready,
  redoKey,
  ribbonDisabled,
  ribbonEnabled,
  ribbonTab,
  textOf,
  typeText,
  undoKey,
  views,
  waitFocus,
  waitGroups,
} from './p4e-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

/** The wait lines of a text: `[line, text]` for each line that is exactly a wait code. @param {string[]} lines @param {number} from @param {number} to */
const waitLines = (lines, from, to) => lines.flatMap((text, i) => (i + 1 >= from && i + 1 <= to && /^M9\d\dP\d+$/.test(text) ? [[i + 1, text]] : []))

/** The bar, as the page shows it. @param {Harness} h */
function barState(h) {
  const bar = h.q('channel-view-bar')
  return bar === null
    ? null
    : {
        layout: bar.dataset.layout ?? '',
        notShown: bar.dataset.notShown ?? '',
        outside: bar.dataset.outside ?? '',
        matched: bar.dataset.matched ?? '',
        unmatched: bar.dataset.unmatched ?? '',
        marks: (bar.querySelector('[data-part="marks"]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        notShownText: (bar.querySelector('[data-part="not-shown"]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        outsideText: (bar.querySelector('[data-part="outside"]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        layoutText: (bar.querySelector('.layout')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      }
}

/** The filler zones on screen as `pane:afterLine:lines`, sorted. @param {Harness} h */
function zonesNow(h) {
  const index = new Map(groupIds(h).map((id, i) => [id, i]))
  return h
    .qa('channel-align-zone')
    .map((z) => `${index.get(z.dataset.group ?? '')}:${z.dataset.afterLine}:${z.dataset.lines}`)
    .sort()
}

/** The wait marks a pane's model carries: `[line, state]`. @param {any} editor */
function marksOf(editor) {
  return /** @type {any[]} */ (editor.getModel().getAllDecorations())
    .filter((d) => String(d.options.linesDecorationsClassName ?? '').startsWith('gedit-wait-'))
    .map((d) => [d.range.startLineNumber, d.options.linesDecorationsClassName === 'gedit-wait-matched' ? 'matched' : 'unmatched'])
    .sort((a, b) => a[0] - b[0])
}

/** The scroll position of every pane. @param {Harness} h */
const tops = (h) => views(h).map((v) => v.editor.getScrollTop())

/** Waits until every pane is at the same scroll position (and at `want`, when given). @param {Harness} h @param {number} [want] */
async function waitTogether(h, want) {
  await h.waitFor(
    () => {
      const t = tops(h)
      return t.length > 1 && t.every((x) => x === t[0]) && (want === undefined || t[0] === want)
    },
    { timeout: 6000 },
  )
  return tops(h)
}

/** The top of a line as the pane draws it (the filler above it included). @param {Harness} h @param {number} pane @param {number} line */
const topOf = (h, pane, line) => views(h)[pane].editor.getTopForLineNumber(line)

/** The numbers the line-number gutter of a pane shows right now. @param {Harness} h @param {string} groupId */
const gutterOf = (h, groupId) =>
  [...(groupsOnScreen(h).find((g) => g.id === groupId)?.el.querySelectorAll('.margin-view-overlays .line-numbers') ?? [])]
    .map((e) => (e.textContent ?? '').trim())
    // Monaco recycles the line elements, so the DOM order is not the order of the lines.
    .sort((a, b) => Number(a) - Number(b))

const sameJson = (/** @type {unknown} */ a, /** @type {unknown} */ b) => JSON.stringify(a) === JSON.stringify(b)

scenario('p4-channels', { timeout: 900, files: REPO_FILE }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const reg = monacoRegistry(h)
  const dir = await h.fixture('p4e/channels')
  const ncDir = await h.fixture(NC_DIR)
  const machines = channelMachines(h)
  const twinBlock = await blockOf(h, 'c10-alternating')
  const twinId = await machines.add('Twin lathe', twinBlock)
  const threeId = await machines.add('Three-path lathe', presetBlock(h, 'fanuc-lathe', 'fanuc-3path-digits'))
  const useMachine = async (/** @type {string} */ machineId) => {
    await ctx.machines.setDefault('fanuc-lathe', machineId)
    await h.idle()
  }
  const other = await newDoc(h, '(SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)\nG21\nM30\n', 'fanuc-gcode')

  // The programs, and the line numbers the checks rely on.
  const twinPath = `${dir}/twin-sections.nc`
  const twinText = await h.disk.read(twinPath)
  const twin = twinText.split('\n') // 206 lines and the empty one after the last line break
  const paneOne = twin.slice(0, 100).join('\n')
  const paneTwo = [...twin.slice(0, 3), ...twin.slice(100, 205)].join('\n')
  const files = [1, 2, 3].map((n) => `${dir}/threepath.NC${n}`)
  const fileLines = await Promise.all(files.map(async (f) => (await h.disk.read(f)).split('\n')))
  h.check(
    'the fixtures are where tests/fixtures/p4e/README.md says: twin-sections.nc has 206 lines, its waits are on 9, 60, 80 (channel 1) and 103, 167 (channel 2); the paths have 22, 24 and 20 lines',
    twin.length === 207 &&
      twin[3].startsWith('O1001') &&
      twin[100].startsWith('O2001') &&
      sameJson(waitLines(twin, 4, 100), [[9, 'M901P12'], [60, 'M910P12'], [80, 'M920P12']]) &&
      sameJson(waitLines(twin, 101, 205), [[103, 'M901P12'], [167, 'M910P12']]) &&
      sameJson(fileLines.map((l) => l.length - 1), [22, 24, 20]) &&
      sameJson(waitLines(fileLines[0], 1, 99), [[9, 'M901P12'], [15, 'M910P123']]) &&
      sameJson(waitLines(fileLines[1], 1, 99), [[7, 'M901P12'], [18, 'M910P123']]) &&
      sameJson(waitLines(fileLines[2], 1, 99), [[12, 'M910P123'], [16, 'M920P13']]),
    { twin: twin.length, waits: waitLines(twin, 1, 300), files: fileLines.map((l) => waitLines(l, 1, 99)) },
  )

  // ============================================================ A. what is refused
  await guard(h, 'A. refusals', async () => {
    const lone = await open(h, `${ncDir}/c05-one-channel.nc`)
    h.check('with no machine that has channels the command is not on offer (NC tab, Channels)', (await ribbonTab(h, 'nc'), ribbonDisabled(h, 'channels.sideBySide') && !ctx.commands.isEnabled('channels.sideBySide')), { enabled: ctx.commands.isEnabled('channels.sideBySide') })
    await useMachine(twinId)
    await ribbonTab(h, 'nc')
    h.check('with the machine of a two-channel lathe it is on offer', ribbonEnabled(h, 'channels.sideBySide') && ctx.commands.isEnabled('channels.sideBySide'))
    h.check('and it sits in the group Channels, beside the split and the merge', (() => {
      const group = [...document.querySelectorAll('.ribbon-body .ribbon-group')].find((g) => g.querySelector('[data-command="channels.sideBySide"]'))
      return !!group && !!group.querySelector('[data-command="channels.splitToDocuments"]') && !!group.querySelector('[data-command="channels.mergeBack"]') && (group.querySelector(':scope > .group-label')?.textContent ?? '').trim() === ctx.t('channels.group')
    })())
    await ctx.commands.run('channels.sideBySide')
    await h.idle()
    h.check('a program with one channel only (one section of the machine\'s two): the plain refusal, no view, still one editor', message(h) === ctx.t('channelPanes.refusal.onlyOne') && h.q('status-message')?.getAttribute('data-error') === '1' && !h.q('channel-view-bar') && hostLayout(h) === 'single', { status: message(h), layout: hostLayout(h) })
    await ctx.commands.run('file.close')
    await h.waitFor(() => !ctx.docs.get(lone), { timeout: 8000 })
  })

  // ============================================================ B. one program with sections
  await useMachine(twinId)
  const id = await open(h, twinPath)
  h.check('the program is read as a Fanuc lathe program', ctx.docs.get(id)?.profileId === 'fanuc-lathe', ctx.docs.get(id)?.profileId)
  const item = await waitChannel(h, (s) => s.present)
  h.check('and the channel item says one program, two channels', item.layout === 'single-file' && item.count === '2', item)
  /** @type {string[]} */
  let ids = []
  const ZONES_TWIN = ['0:59:13', '1:108:2', '1:5:3'].sort()

  await guard(h, 'B1. open, the bar, the panes, the alignment', async () => {
    ctx.editor.reveal(id, 130, 1)
    await h.idle()
    await clickRibbon(h, 'nc', 'channels.sideBySide')
    const groups = await waitGroups(h, 2, 'channels')
    // The plain status clears after 4 s: read it before the waits below.
    const openedStatus = message(h)
    ids = groupIds(h)
    await h.waitFor(() => h.q('channel-view-bar'), { timeout: 8000 })
    await h.waitFor(() => zonesNow(h).length === 3, { timeout: 8000 })
    // The panes follow the pane at the cursor; the checks below read the top of the programs.
    views(h)[0].editor.setScrollTop(0)
    await waitTogether(h, 0)
    const view = read(ctx.channelPanes.state)
    h.check('the view is open: two panes of one program, one pane per channel in the machine\'s order', view.open && view.layout === 'single-file' && view.panes.length === 2 && sameJson(view.panes.map((p) => p.channelId), ['1', '2']) && view.panes.every((p) => p.docId === id), view)
    h.check('the groups are panes of the program, named after the channels', groups.length === 2 && groups.every((g) => g.kind === 'pane' && g.docId === id) && sameJson(groups.map((g) => g.channel), ['1', '2']) && sameJson(h.qa('editor-group-header').map((x) => x.querySelector('.title')?.textContent?.trim()), ['Channel 1', 'Channel 2']), groups.map((g) => `${g.id}:${g.kind}:${g.channel}`))
    h.check('the status bar says how many channels are shown', openedStatus === ctx.t('channelPanes.status.opened', { count: 2 }), openedStatus)
    h.check('the pane of the channel at the cursor (line 130 is channel 2) has the keyboard', focusedGroup(h) === ids[1] && (await waitFocus(h, ids[1])), { focused: focusedGroup(h), ids })

    const bar = barState(h)
    h.check('the bar: one program with sections, nothing not shown, 2 lines in no channel (the closing % and the empty line after it), 4 of 5 waits lined up and 1 without a partner', bar !== null && bar.layout === 'single-file' && bar.notShown === '' && bar.outside === '2' && bar.matched === '4' && bar.unmatched === '1', bar)
    h.check('and says so in words', bar !== null && bar.layoutText === ctx.t('channelPanes.bar.layoutSections') && bar.marks === `${ctx.t('channelPanes.bar.marks', { matched: 4, total: 5 })}, ${ctx.t('channelPanes.bar.unmatched', { count: 1 })}` && bar.outsideText === ctx.t('channelPanes.bar.outside', { count: 2 }) && bar.notShownText === '', bar)
    h.check('Split Editor is not offered while the view is open; Close Split, F6 and Shift+F6 are', (await ribbonTab(h, 'view'), ribbonDisabled(h, 'view.splitEditor') && ribbonDisabled(h, 'view.splitEditorDown') && ribbonEnabled(h, 'view.closeSplit') && ctx.commands.isEnabled('view.focusNextPane') && ctx.commands.isEnabled('view.focusPreviousPane')))

    const [a, b] = views(h).map((v) => v.editor)
    h.check('pane 1 holds the header and channel 1 (100 lines), pane 2 the header and channel 2 (108 lines), as the program writes them', a.getModel().getValue() === paneOne && b.getModel().getValue() === paneTwo, { one: a.getModel().getLineCount(), two: b.getModel().getLineCount() })
    h.check('the panes are models of their own, not the program\'s', a.getModel() !== b.getModel() && a.getModel().uri.toString().startsWith('inmemory://pane/'), a.getModel().uri.toString())
    const gutter = gutterOf(h, ids[1])
    h.check('the gutter of pane 2 shows the program\'s line numbers: 1, 2, 3 for the header, then 101, 102, 103', sameJson(gutter.slice(0, 6), ['1', '2', '3', '101', '102', '103']) , gutter.slice(0, 8))

    h.check('the filler zones, by data attributes: pane 1 after line 59 (13 lines), pane 2 after line 5 (3) and after line 108 (2)', sameJson(zonesNow(h), ZONES_TWIN), zonesNow(h))
    h.check('the panes are level at each wait: M901P12 (pane 1 line 9, pane 2 line 6) and M910P12 (60 and 70) are at the same height', topOf(h, 0, 9) === topOf(h, 1, 6) && topOf(h, 0, 60) === topOf(h, 1, 70), { m901: [topOf(h, 0, 9), topOf(h, 1, 6)], m910: [topOf(h, 0, 60), topOf(h, 1, 70)] })
    h.check('and the panes are equally tall (the trailing zone), so they scroll to the same end', Math.abs(a.getScrollHeight() - b.getScrollHeight()) <= 1, [a.getScrollHeight(), b.getScrollHeight()])

    h.check('the marks of pane 1 in the model: lines 9 and 60 matched, line 80 unmatched (channel 2 has no M920P12)', sameJson(marksOf(a), [[9, 'matched'], [60, 'matched'], [80, 'unmatched']]), marksOf(a))
    h.check('the marks of pane 2: lines 6 and 70 matched', sameJson(marksOf(b), [[6, 'matched'], [70, 'matched']]), marksOf(b))
    const seen = groupsOnScreen(h)[0].el.querySelectorAll('.gedit-wait-matched')
    h.check('a matched mark is drawn in the margin of pane 1 (line 9 is on screen)', seen.length >= 1, seen.length)
  })

  await guard(h, 'B2. the unmatched mark and its hover', async () => {
    if (ids.length !== 2) throw new Error('no view')
    ctx.editor.reveal(id, 80, 1)
    await h.waitFor(() => groupsOnScreen(h)[0]?.el.querySelector('.gedit-wait-unmatched'), { timeout: 5000 })
    const root = groupsOnScreen(h)[0].el
    const matchedColour = getComputedStyle(root.querySelector('.gedit-wait-matched') ?? root).backgroundColor
    const unmatched = root.querySelector('.gedit-wait-unmatched')
    const unmatchedColour = unmatched ? getComputedStyle(unmatched).backgroundColor : ''
    h.check('the unmatched mark is drawn on screen, in another colour than a matched one', !!unmatched && unmatchedColour !== matchedColour && unmatchedColour !== 'rgba(0, 0, 0, 0)', { matchedColour, unmatchedColour })
    const hover = await hoverAt(h, id, 80, 1)
    h.check('the hover on line 80 says which channel has no matching wait, and for which wait', hover.includes('Channel 2') && hover.includes('M920P12') && /no matching wait/i.test(hover), hover)
    const hoverMatched = await hoverAt(h, id, 9, 1)
    h.check('the hover on the matched wait on line 9 names the partner: Channel 2, line 103 (the program\'s line)', hoverMatched.includes('Channel 2, line 103'), hoverMatched)
    ctx.editor.triggerAction('editor.action.hideHover')
  })

  await guard(h, 'B3. scrolling together', async () => {
    if (ids.length !== 2) throw new Error('no view')
    const [a, b] = views(h).map((v) => v.editor)
    h.check('start: both panes are at one position', sameJson(new Set(tops(h)).size, 1), tops(h))
    a.setScrollTop(600)
    h.check('scrolling pane 1 scrolls pane 2 to the same place', sameJson(await waitTogether(h, 600), [600, 600]), tops(h))
    b.setScrollTop(150)
    h.check('and the other way round', sameJson(await waitTogether(h, 150), [150, 150]), tops(h))
    /** @type {string[]} */
    const drift = []
    for (const [pane, to] of /** @type {[number, number][]} */ ([[0, 300], [1, 1000], [0, 40], [1, 777], [0, 1200], [1, 5], [0, 333]])) {
      views(h)[pane].editor.setScrollTop(to)
      const now = await waitTogether(h, to)
      if (now.length !== 2 || !now.every((x) => x === to)) drift.push(`pane ${pane + 1} to ${to}: ${now.join(', ')}`)
    }
    h.check('seven scrolls alternating between the panes end exactly where they were sent, in every pane: no drift', drift.length === 0, drift)
    a.setScrollTop(1e7)
    const end = await waitTogether(h)
    h.check('scrolled to the end, both panes end together (they are equally tall)', end[0] === end[1] && end[0] > 600, end)
    // The keyboard: PageDown in pane 2.
    a.setScrollTop(0)
    await waitTogether(h, 0)
    await placeCursor(h, ids[1], 1, 1)
    for (let i = 0; i < 3; i++) await pressKey(h, 'PageDown')
    const keyed = await waitTogether(h)
    h.check('the keyboard scrolls them together too: three PageDown in pane 2 move both panes down by the same amount', keyed[0] === keyed[1] && keyed[0] > 100, keyed)
    a.setScrollTop(0)
    await waitTogether(h, 0)
  })

  await guard(h, 'B4. an edit in a pane is one step of the program\'s history', async () => {
    if (ids.length !== 2) throw new Error('no view')
    const [first, second] = ids
    // ---- digits typed in pane 2
    await placeCursor(h, second, 12, 1)
    await typeText(h, '77')
    const want = `77${twin[108]}`
    h.check('77 typed in pane 2 at line 12 is written into the program at line 109 (pane line 12 of channel 2) and nowhere else', ctx.editor.getLines(id, 109, 109)[0] === want && textOf(h, id) === [...twin.slice(0, 108), want, ...twin.slice(109)].join('\n'), { line: ctx.editor.getLines(id, 109, 109)[0] })
    h.check('pane 2 shows it, pane 1 is unchanged', views(h)[1].editor.getModel().getLineContent(12) === want && views(h)[0].editor.getModel().getValue() === paneOne)
    h.check('the program is marked as changed', ctx.docs.get(id)?.dirty === true)
    await nextPane(h)
    await waitFocus(h, first)
    await undoKey(h)
    await h.waitFor(() => textOf(h, id) === twinText, { timeout: 8000 })
    h.check('Cmd+Z in pane 1 takes it back: ONE undo step restores the program byte for byte', textOf(h, id) === twinText, { line: ctx.editor.getLines(id, 109, 109)[0] })
    h.check('and the pane where the change was takes the keyboard back and shows it', (await waitFocus(h, second)) && views(h)[1].editor.getPosition().lineNumber === 12, { focused: focusedGroup(h), cursor: views(h)[1].editor.getPosition() })
    h.check('the program is clean again', ctx.docs.get(id)?.dirty !== true)
    await redoKey(h)
    await h.waitFor(() => ctx.editor.getLines(id, 109, 109)[0] === want, { timeout: 8000 })
    h.check('Cmd+Shift+Z brings it back in one step', ctx.editor.getLines(id, 109, 109)[0] === want && (await waitFocus(h, second)))
    // Edit > Undo from the ribbon, with the keyboard in pane 1.
    await nextPane(h)
    await waitFocus(h, first)
    await ribbonTab(h, 'edit')
    h.click(h.q('cmd-button', { command: 'edit.undo' }))
    await h.waitFor(() => textOf(h, id) === twinText, { timeout: 8000 })
    h.check('Edit > Undo does the same from pane 1', textOf(h, id) === twinText, { line: ctx.editor.getLines(id, 109, 109)[0] })

    // ---- a new line in channel 2 moves the zones, and the undo moves them back
    await placeCursor(h, second, 12, 1000)
    await pressKey(h, 'Enter')
    await h.waitFor(() => ctx.editor.getLineCount(id) === twin.length + 1, { timeout: 8000 })
    h.check('Enter at the end of pane line 12 adds one line to channel 2 in the program (line 110)', ctx.editor.getLineCount(id) === twin.length + 1 && ctx.editor.getLines(id, 110, 110)[0] === '' && ctx.editor.getLines(id, 109, 109)[0] === twin[108], { count: ctx.editor.getLineCount(id) })
    await h.waitFor(() => sameJson(zonesNow(h), ['0:59:14', '1:109:2', '1:5:3'].sort()), { timeout: 8000 })
    h.check('the alignment follows: channel 2\'s M910P12 is one line lower, so pane 1 gets 14 filler lines before its own, and pane 2\'s trailing zone is at line 109', sameJson(zonesNow(h), ['0:59:14', '1:109:2', '1:5:3'].sort()), zonesNow(h))
    h.check('the waits are still level, and the panes equally tall', topOf(h, 0, 60) === topOf(h, 1, 71) && Math.abs(views(h)[0].editor.getScrollHeight() - views(h)[1].editor.getScrollHeight()) <= 1, { tops: [topOf(h, 0, 60), topOf(h, 1, 71)] })
    await nextPane(h)
    await waitFocus(h, first)
    await undoKey(h)
    await h.waitFor(() => textOf(h, id) === twinText, { timeout: 8000 })
    h.check('Cmd+Z in pane 1 takes the new line back (one step)', textOf(h, id) === twinText && ctx.docs.get(id)?.dirty !== true)
    await h.waitFor(() => sameJson(zonesNow(h), ZONES_TWIN), { timeout: 8000 })
    h.check('and the zones are the first ones again', sameJson(zonesNow(h), ZONES_TWIN), zonesNow(h))
    h.check('the bar says 4 of 5 again', barState(h)?.matched === '4' && barState(h)?.unmatched === '1', barState(h))
  })

  await guard(h, 'B4b. a pane edit that would move lines to another channel is refused (NC-2)', async () => {
    if (ids.length !== 2) throw new Error('no view')
    const second = ids[1]
    h.check('before: the program is as on disk and pane 2 line 4 is the section start O2001', textOf(h, id) === twinText && views(h)[1].editor.getModel().getLineContent(4) === twin[100], views(h)[1]?.editor.getModel().getLineContent(4))
    // A digit in front of `O2001` makes it no section start: channel 2's lines would leave the channel.
    await placeCursor(h, second, 4, 1)
    await typeText(h, '7')
    const refusal = ctx.t('channelPanes.status.movesLines')
    await h.waitFor(() => message(h) === refusal, { timeout: 8000 })
    h.check('the status bar says it in plain words, as an error', message(h) === refusal && h.q('status-message')?.getAttribute('data-error') === '1', { status: message(h) })
    await h.waitFor(() => views(h)[1]?.editor.getModel().getValue() === paneTwo, { timeout: 8000 })
    h.check('the program is unchanged, byte for byte, and not marked as changed', textOf(h, id) === twinText && ctx.docs.get(id)?.dirty !== true, { line: ctx.editor.getLines(id, 101, 101)[0], dirty: ctx.docs.get(id)?.dirty })
    h.check('pane 2 shows the section start again, pane 1 is untouched, both panes stay', views(h).length === 2 && views(h)[1].editor.getModel().getValue() === paneTwo && views(h)[0].editor.getModel().getValue() === paneOne && read(ctx.channelPanes.state).panes.length === 2)
    h.check('the alignment is the first one', sameJson(zonesNow(h), ZONES_TWIN) && barState(h)?.matched === '4' && barState(h)?.unmatched === '1', { zones: zonesNow(h), bar: barState(h) })
    await undoKey(h)
    await h.idle()
    h.check('Cmd+Z afterwards does not bring the refused digit back or change the program', textOf(h, id) === twinText, { line: ctx.editor.getLines(id, 101, 101)[0] })
  })

  await guard(h, 'B5. the comparison takes the editors away and the view survives it', async () => {
    if (ids.length !== 2) throw new Error('no view')
    views(h)[1].editor.setScrollTop(0)
    await openCompare(h, reg, id, { kind: 'document', docId: other })
    h.check('the comparison replaced the editor area: no group on screen, no editor instance', !h.q('editor-host') && groupsOnScreen(h).length === 0 && ctx.editor.editorInstance() === undefined)
    h.check('the channel view is still open meanwhile (the service holds the panes)', read(ctx.channelPanes.state).open === true && ctx.editor.groupsState().layout === 'channels')
    await closeCompare(h)
    const groups = await waitGroups(h, 2, 'channels')
    h.check('closing it builds the two panes again', groups.length === 2 && groups.every((g) => g.kind === 'pane'), groups.map((g) => g.id))
    await h.waitFor(() => zonesNow(h).length === 3, { timeout: 8000 })
    h.check('the new editors got their zones and marks again (re-hooked)', sameJson(zonesNow(h), ZONES_TWIN) && sameJson(marksOf(views(h)[0].editor), [[9, 'matched'], [60, 'matched'], [80, 'unmatched']]) && sameJson(marksOf(views(h)[1].editor), [[6, 'matched'], [70, 'matched']]), { zones: zonesNow(h), marks: marksOf(views(h)[0].editor) })
    views(h)[0].editor.setScrollTop(420)
    h.check('and they scroll together again', sameJson(await waitTogether(h, 420), [420, 420]), tops(h))
    h.check('the bar is still there with its numbers', barState(h)?.matched === '4' && barState(h)?.unmatched === '1', barState(h))
    views(h)[0].editor.setScrollTop(0)
    await waitTogether(h, 0)
  })

  await guard(h, 'B6. three ways to close the view', async () => {
    h.click(h.q('channel-view-bar')?.querySelector('[data-action="close"]'))
    await waitGroups(h, 1, 'single')
    h.check('the button in the bar closes the view: one editor, no bar, the program untouched', !h.q('channel-view-bar') && read(ctx.channelPanes.state).open === false && textOf(h, id) === twinText && h.qa('channel-align-zone').length === 0, { zones: h.qa('channel-align-zone').length })
    h.check('the pane models are gone with it', !(/** @type {any} */ (views(h)[0]?.editor.getModel())?.uri.toString().startsWith('inmemory://pane/')))

    await clickRibbon(h, 'nc', 'channels.sideBySide')
    await waitGroups(h, 2, 'channels')
    await h.waitFor(() => zonesNow(h).length === 3, { timeout: 8000 })
    h.check('the command opens it again', hostLayout(h) === 'channels' && !!h.q('channel-view-bar'))
    await clickRibbon(h, 'view', 'view.closeSplit')
    await waitGroups(h, 1, 'single')
    h.check('View > Close Split closes it too', !h.q('channel-view-bar') && read(ctx.channelPanes.state).open === false)

    await clickRibbon(h, 'nc', 'channels.sideBySide')
    const open2 = await waitGroups(h, 2, 'channels')
    h.click(h.qa('editor-group-close').find((b) => b.dataset.group === open2[0].id))
    await waitGroups(h, 1, 'single')
    h.check('the X in a pane\'s header: down to one pane the view ends', !h.q('channel-view-bar') && read(ctx.channelPanes.state).open === false && hostGroups(h) === 1)
    h.check('and the program is as it was', textOf(h, id) === twinText && ctx.docs.get(id)?.dirty !== true)
  })

  // ============================================================ the matching mark follows the P set
  await guard(h, 'N. Go to the Matching Mark pairs the same code with the same P set (plan §7 #388)', async () => {
    const text = [
      '(SYNTHETIC TEST PROGRAM FOR THE MATCHING MARK, NOT FOR A MACHINE)',
      '%',
      'O1001 (CHANNEL 1)',
      'M901P12',
      'M902P123',
      'M30',
      'O2001 (CHANNEL 2)',
      'M902P12',
      'M901P12',
      'M30',
      '%',
      '',
    ].join('\n')
    const nav = await newDoc(h, text, 'fanuc-lathe')
    await waitChannel(h, (s) => s.present && s.layout === 'single-file')
    /** Mod+Alt+P from a line; the line the cursor is on afterwards. @param {number} line */
    const partnerFrom = async (line) => {
      await goto(h, nav, line)
      await press(h, keys.partner)
      return h.app.cursor().line
    }
    h.check('M901P12 in channel 1 (line 4) goes to M901P12 in channel 2 (line 9), and back', (await partnerFrom(4)) === 9 && (await partnerFrom(9)) === 4, h.app.cursor())
    const stay = await partnerFrom(5)
    h.check('M902P123 (channel 1, line 5) has no partner: channel 2 has an M902P12, which is another wait; the cursor stays and the status says so', stay === 5 && message(h) === ctx.t('channels.nav.partnerNone'), { line: stay, status: message(h) })
    const stayBack = await partnerFrom(8)
    h.check('and M902P12 (channel 2, line 8) does not jump to the M902P123 in channel 1 either', stayBack === 8 && message(h) === ctx.t('channels.nav.partnerNone'), { line: stayBack, status: message(h) })
  })

  // ============================================================ C. one file per channel
  await guard(h, 'C1. the other files are asked for, not opened', async () => {
    await useMachine(threeId)
    const one = await open(h, files[0])
    if (ctx.docs.get(one)?.profileId !== 'fanuc-lathe') h.app.setProfile('fanuc-lathe')
    const state = await waitChannel(h, (s) => s.present && s.layout === 'multi-file')
    h.check('path 1 of a set of three: the item says one file per channel, channel 1 of 3, the other two exist but are not open', state.id === '1' && state.count === '3' && state.open === '1' && state.missing === '', state)
    const docsBefore = ctx.docs.all().length
    const callsBefore = h.dialogs.calls().filter((c) => c.kind === 'open').length
    await h.dialogs.queue('open', null)
    await ctx.commands.run('channels.sideBySide')
    await h.idle()
    const asked = h.dialogs.calls().filter((c) => c.kind === 'open').slice(callsBefore)
    h.check('the command asks which files to open: one dialog, several files, in the folder of the document', asked.length === 1 && asked[0].args.options.multiple === true && asked[0].args.options.defaultPath === dir, asked.map((c) => c.args.options))
    h.check('cancelled: nothing was opened by itself, and the refusal says at least two channel files are needed', ctx.docs.all().length === docsBefore && message(h) === ctx.t('channelPanes.refusal.needTwoFiles') && h.q('status-message')?.getAttribute('data-error') === '1' && !h.q('channel-view-bar'), { status: message(h) })
  })

  const fileIds = [0, 1, 2].map((i) => ctx.docs.byPath(files[i])?.id ?? '')
  // The models carry the empty line after the last line break, so each path is one line longer than the file's text lines.
  const ZONES_THREE = ['0:14:5', '0:23:1', '1:25:2', '1:6:2', '2:11:8'].sort()
  const ZONES_ONE_TWO = ['0:14:5', '1:25:1', '1:6:2'].sort()

  await guard(h, 'C2. three panes, lined up', async () => {
    const callsBefore = h.dialogs.calls().filter((c) => c.kind === 'open').length
    await h.dialogs.queue('open', [files[1], files[2]])
    await clickRibbon(h, 'nc', 'channels.sideBySide')
    const groups = await waitGroups(h, 3, 'channels')
    ids = groupIds(h)
    fileIds[0] = ctx.docs.byPath(files[0])?.id ?? ''
    fileIds[1] = ctx.docs.byPath(files[1])?.id ?? ''
    fileIds[2] = ctx.docs.byPath(files[2])?.id ?? ''
    await h.waitFor(() => zonesNow(h).length === 5, { timeout: 10000 })
    const asked = h.dialogs.calls().filter((c) => c.kind === 'open').slice(callsBefore)
    h.check('the two files the user picked are open, and no others', fileIds.length === 3 && fileIds.every((x) => x !== '') && asked.length === 1, { asked: asked.length, fileIds })
    h.check('three groups, each the document of one path, named after the path and the file', groups.length === 3 && groups.every((g) => g.kind === 'document') && sameJson(groups.map((g) => g.docId), fileIds) && sameJson(groups.map((g) => g.channel), ['1', '2', '3']) && sameJson(h.qa('editor-group-header').map((x) => x.querySelector('.title')?.textContent?.trim()), ['Path 1 · threepath.NC1', 'Path 2 · threepath.NC2', 'Path 3 · threepath.NC3']), h.qa('editor-group-header').map((x) => x.textContent?.trim()))
    h.check('the pane of the file the command was started from has the keyboard', focusedGroup(h) === ids[0] && (await waitFocus(h, ids[0])), { focused: focusedGroup(h) })
    h.check('the status bar says three channels', message(h) === ctx.t('channelPanes.status.opened', { count: 3 }), message(h))
    const bar = barState(h)
    h.check('the bar: one file per channel, nothing not shown, 5 of 6 waits lined up, 1 without a partner, no lines "in no channel"', bar !== null && bar.layout === 'multi-file' && bar.notShown === '' && bar.outside === '0' && bar.matched === '5' && bar.unmatched === '1' && bar.layoutText === ctx.t('channelPanes.bar.layoutFiles') && bar.marks === `${ctx.t('channelPanes.bar.marks', { matched: 5, total: 6 })}, ${ctx.t('channelPanes.bar.unmatched', { count: 1 })}` && bar.outsideText === '', bar)
    h.check('the filler zones: path 1 after 14 (5 lines) and 23 (1), path 2 after 6 (2) and 25 (2), path 3 after 11 (8)', sameJson(zonesNow(h), ZONES_THREE), zonesNow(h))
    h.check('M901P12 (path 1 line 9, path 2 line 7) is level, and M910P123 on lines 15, 18 and 12 is level in all three', topOf(h, 0, 9) === topOf(h, 1, 7) && topOf(h, 0, 15) === topOf(h, 1, 18) && topOf(h, 1, 18) === topOf(h, 2, 12), { m901: [topOf(h, 0, 9), topOf(h, 1, 7)], m910: [topOf(h, 0, 15), topOf(h, 1, 18), topOf(h, 2, 12)] })
    const heights = views(h).map((v) => v.editor.getScrollHeight())
    h.check('and all three panes are equally tall', Math.max(...heights) - Math.min(...heights) <= 1, heights)
    h.check('marks: M901P12 and M910P123 matched in paths 1 and 2; in path 3 M910P123 matched and M920P13 unmatched (path 1 has none)', sameJson(marksOf(views(h)[0].editor), [[9, 'matched'], [15, 'matched']]) && sameJson(marksOf(views(h)[1].editor), [[7, 'matched'], [18, 'matched']]) && sameJson(marksOf(views(h)[2].editor), [[12, 'matched'], [16, 'unmatched']]), views(h).map((v) => marksOf(v.editor)))
    const hover = await hoverAt(h, fileIds[2], 16, 1)
    h.check('the hover on path 3\'s unmatched wait says Path 1 has no matching wait for it', hover.includes('Path 1') && hover.includes('M920P13') && /no matching wait/i.test(hover), hover)
    ctx.editor.triggerAction('editor.action.hideHover')
    views(h)[2].editor.setScrollTop(40)
    h.check('the three panes scroll together', sameJson(await waitTogether(h, 40), [40, 40, 40]), tops(h))
    views(h)[2].editor.setScrollTop(0)
    await waitTogether(h, 0)
  })

  await guard(h, 'C3. one history over three files', async () => {
    if (ids.length !== 3) throw new Error('no three-pane view')
    const [g1, g2, g3] = ids
    const text = (/** @type {number} */ i) => textOf(h, fileIds[i])
    const original = fileLines.map((l) => l.join('\n'))
    // An edit in file 1, then one in file 2.
    await placeCursor(h, g1, 10, 1)
    await typeText(h, '77')
    await nextPane(h)
    await waitFocus(h, g2)
    await placeCursor(h, g2, 9, 1)
    await typeText(h, '88')
    h.check('77 is in path 1 at line 10 and 88 in path 2 at line 9, nothing else changed (path 3 least of all)', text(0) === [...fileLines[0].slice(0, 9), `77${fileLines[0][9]}`, ...fileLines[0].slice(10)].join('\n') && text(1) === [...fileLines[1].slice(0, 8), `88${fileLines[1][8]}`, ...fileLines[1].slice(9)].join('\n') && text(2) === original[2], { dirty: fileIds.map((d) => ctx.docs.get(d)?.dirty) })
    h.check('each file has its own dirty mark: paths 1 and 2 changed, path 3 not', ctx.docs.get(fileIds[0])?.dirty === true && ctx.docs.get(fileIds[1])?.dirty === true && ctx.docs.get(fileIds[2])?.dirty !== true)
    await undoKey(h)
    await h.waitFor(() => text(1) === original[1], { timeout: 8000 })
    h.check('the first Cmd+Z takes back the NEWEST edit (path 2) and leaves path 1\'s', text(1) === original[1] && text(0) !== original[0], { dirty: fileIds.map((d) => ctx.docs.get(d)?.dirty) })
    h.check('and path 2 is clean again while path 1 is not', ctx.docs.get(fileIds[1])?.dirty !== true && ctx.docs.get(fileIds[0])?.dirty === true)
    h.check('the keyboard is in the pane where the change was (path 2)', await waitFocus(h, g2), { focused: focusedGroup(h) })
    await undoKey(h)
    await h.waitFor(() => text(0) === original[0], { timeout: 8000 })
    h.check('the second Cmd+Z takes back path 1\'s edit, though the keyboard was in path 2: the pane of that change takes the keyboard', text(0) === original[0] && (await waitFocus(h, g1)), { focused: focusedGroup(h) })
    h.check('every file is back to its bytes, clean', fileIds.length === 3 && fileIds.every((d, i) => text(i) === original[i] && ctx.docs.get(d)?.dirty !== true))
    await redoKey(h)
    await h.waitFor(() => text(0) !== original[0], { timeout: 8000 })
    h.check('Cmd+Shift+Z redoes path 1\'s edit first (the oldest undone) in its own pane', text(0) !== original[0] && text(1) === original[1] && (await waitFocus(h, g1)))
    await redoKey(h)
    await h.waitFor(() => text(1) !== original[1], { timeout: 8000 })
    h.check('and then path 2\'s', text(1) !== original[1] && (await waitFocus(h, g2)))
    await undoKey(h)
    await undoKey(h)
    await h.waitFor(() => text(0) === original[0] && text(1) === original[1], { timeout: 8000 })
    h.check('two more undos leave all three files as they were on disk', fileIds.length === 3 && fileIds.every((_, i) => text(i) === original[i]) && fileIds.every((d) => ctx.docs.get(d)?.dirty !== true), fileIds.map((d) => ctx.docs.get(d)?.dirty))
    h.check('and path 3 was never touched', (await h.disk.read(files[2])) === original[2] && text(2) === original[2] && g3 !== '')
  })

  await guard(h, 'C4. closing panes', async () => {
    if (ids.length !== 3) throw new Error('no three-pane view')
    const [g1, , g3] = ids
    h.click(h.qa('editor-group-close').find((b) => b.dataset.group === g3))
    await waitGroups(h, 2, 'channels')
    await h.waitFor(() => barState(h)?.notShown === '3', { timeout: 8000 })
    h.check('the X on the third pane leaves two panes, and the bar names the channel that is not shown', hostGroups(h) === 2 && barState(h)?.notShown === '3' && barState(h)?.notShownText === ctx.t('channelPanes.bar.notShown', { channels: 'Path 3' }), barState(h))
    await h.waitFor(() => sameJson(zonesNow(h), ZONES_ONE_TWO), { timeout: 8000 })
    h.check('the alignment is redone for two: M910P123 meets in paths 1 and 2 (path 3 is not shown, so it is not judged), 4 of 4 lined up', sameJson(zonesNow(h), ZONES_ONE_TWO) && barState(h)?.matched === '4' && barState(h)?.unmatched === '0', { zones: zonesNow(h), bar: barState(h) })
    h.check('the closed pane\'s file is still open as a tab and untouched', !!ctx.docs.get(fileIds[2]) && ctx.docs.get(fileIds[2])?.dirty !== true)
    h.click(h.qa('editor-group-close').find((b) => b.dataset.group === g1))
    await waitGroups(h, 1, 'single')
    h.check('the second X leaves one pane: that is no channel view, it ends', !h.q('channel-view-bar') && read(ctx.channelPanes.state).open === false && hostLayout(h) === 'single' && h.qa('channel-align-zone').length === 0)
    // With the files open, the command needs no dialog.
    const calls = h.dialogs.calls().filter((c) => c.kind === 'open').length
    ctx.docs.activate(fileIds[1])
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === fileIds[1], { timeout: 8000 })
    await clickRibbon(h, 'nc', 'channels.sideBySide')
    await waitGroups(h, 3, 'channels')
    await h.waitFor(() => zonesNow(h).length === 5, { timeout: 8000 })
    h.check('opened again from the three open files: no question, three panes, the pane of the active file focused', h.dialogs.calls().filter((c) => c.kind === 'open').length === calls && sameJson(zonesNow(h), ZONES_THREE) && focusedGroup(h) === groupIds(h)[1], { zones: zonesNow(h), focused: focusedGroup(h) })
    await clickRibbon(h, 'view', 'view.closeSplit')
    await waitGroups(h, 1, 'single')
    h.check('Close Split ends it', !h.q('channel-view-bar') && read(ctx.channelPanes.state).open === false)
  })

  await guard(h, 'C5. closing the first pane of three, and then the middle one: the editors that are left keep their own marks (CODE-1)', async () => {
    /** @type {[number, number[], string[], [number, string][][]][]} */
    const cases = [
      // Path 1 closed: M910P123 meets in paths 2 (line 18) and 3 (line 12); M901P12 and M920P13 name path 1, which is not shown.
      [0, [1, 2], ['0:25:2', '1:11:6'], [[[18, 'matched']], [[12, 'matched']]]],
      // Path 2 closed: M910P123 meets in paths 1 (15) and 3 (12); M920P13 in path 3 has no partner in path 1.
      [1, [0, 2], ['0:23:1', '1:11:3'], [[[15, 'matched']], [[12, 'matched'], [16, 'unmatched']]]],
    ]
    for (const [close, left, zones, marks] of cases) {
      const which = close === 0 ? 'the first' : 'the middle'
      ctx.docs.activate(fileIds[0])
      await h.waitFor(() => h.q('editor-host')?.dataset.docId === fileIds[0], { timeout: 8000 })
      await clickRibbon(h, 'nc', 'channels.sideBySide')
      await waitGroups(h, 3, 'channels')
      await h.waitFor(() => zonesNow(h).length === 5, { timeout: 8000 })
      const three = groupIds(h)
      h.check(`three panes again before ${which} closes`, three.length === 3 && sameJson(zonesNow(h), ZONES_THREE), { groups: three, zones: zonesNow(h) })
      if (three.length !== 3) throw new Error('no three-pane view')
      h.click(h.qa('editor-group-close').find((b) => b.dataset.group === three[close]))
      await waitGroups(h, 2, 'channels')
      await h.waitFor(() => sameJson(zonesNow(h), zones), { timeout: 8000 })
      const left2 = views(h)
      h.check(`${which} pane closed: two editors are left, each showing its own path's file`, left2.length === 2 && left.length === 2 && sameJson(left2.map((v) => v.editor.getModel()?.uri.toString()), left.map((i) => ctx.editor.model(fileIds[i])?.uri.toString())), left2.map((v) => v.editor.getModel()?.uri.toString()))
      h.check(`and the filler zones are the ones of the two paths that are left`, sameJson(zonesNow(h), zones), zonesNow(h))
      const seen = left2.map((v) => marksOf(v.editor))
      h.check(`each editor carries the marks of its own path only, on its own wait lines`, sameJson(seen, marks) && seen.length === 2 && seen.every((list, i) => list.length > 0 && list.every(([line]) => /^M9\d\dP\d+$/.test(left2[i].editor.getModel().getLineContent(line)))), seen)
      left2[1].editor.setScrollTop(40)
      h.check(`the two editors scroll together`, sameJson(await waitTogether(h, 40), [40, 40]), tops(h))
      left2[0].editor.setScrollTop(0)
      h.check(`and back, from the other one`, sameJson(await waitTogether(h, 0), [0, 0]), tops(h))
      await clickRibbon(h, 'view', 'view.closeSplit')
      await waitGroups(h, 1, 'single')
    }
    h.check('Close Split ends the view, and no file was changed', !h.q('channel-view-bar') && fileIds.length === 3 && fileIds.every((d) => ctx.docs.get(d)?.dirty !== true))
  })

  // ============================================================ D. merge back
  await guard(h, 'D. Split into Channel Documents, edit, Merge Channels Back', async () => {
    await useMachine(twinId)
    ctx.docs.activate(id)
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 8000 })
    await waitChannel(h, (s) => s.present && s.layout === 'single-file')
    h.check('before a split the merge is not on offer', !ctx.commands.isEnabled('channels.mergeBack'))
    const before = ctx.docs.all().length
    const running = ctx.commands.run('channels.splitToDocuments')
    const alert = await h.alert.wait({ timeout: 8000 })
    h.check('the first split says that changes can come back with Merge Channels Back', !!alert && (alert.texts ?? []).join(' ').includes(ctx.t('channels.mergeBack')), alert)
    await h.alert.click('Split')
    await running
    await h.idle()
    const made = ctx.docs.all().slice(before)
    h.check('it made two documents, and the first is on screen', made.length === 2 && ctx.docs.getActiveId() === made[0].id, made.map((d) => d.title))
    h.check('the status bar says how many and where the changes can go', message(h) === ctx.t('channels.split.done', { count: 2 }), message(h))
    const [c1, c2] = made.map((d) => d.id)
    h.check('Merge Channels Back is on offer on the channel document (NC tab)', (await ribbonTab(h, 'nc'), ribbonEnabled(h, 'channels.mergeBack')))
    await ctx.commands.run('channels.mergeBack')
    h.check('with nothing changed it says so and writes nothing', message(h) === ctx.t('channels.merge.nothing') && ctx.docs.get(id)?.dirty !== true && textOf(h, id) === twinText, message(h))

    // Edit both channel documents: a line before line 8 of channel 1, a line before line 12 of channel 2.
    ctx.editor.reveal(c1, 8, 1)
    ctx.editor.insertText('(P4E EDIT 1)\n')
    ctx.editor.reveal(c2, 12, 1)
    ctx.editor.insertText('(P4E EDIT 2)\n')
    await h.idle()
    const merged = [...twin.slice(0, 7), '(P4E EDIT 1)', ...twin.slice(7, 108), '(P4E EDIT 2)', ...twin.slice(108)].join('\n')
    ctx.docs.activate(c1)
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === c1, { timeout: 8000 })
    await clickRibbon(h, 'nc', 'channels.mergeBack')
    await h.waitFor(() => textOf(h, id) === merged, { timeout: 8000 })
    h.check('Merge Channels Back writes both documents into the program: line 8 and line 109 are the new ones, everything else is as it was', textOf(h, id) === merged, { count: ctx.editor.getLineCount(id) })
    h.check('the program is the active tab and says what happened', ctx.docs.getActiveId() === id && message(h) === ctx.t('channels.merge.done', { count: 2 }), { active: ctx.docs.getActiveId(), status: message(h) })
    h.check('the program is marked as changed, the channel documents keep their text', ctx.docs.get(id)?.dirty === true && ctx.editor.getLines(c1, 8, 8)[0] === '(P4E EDIT 1)')
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 8000 })
    h.focusEditor()
    await undoKey(h)
    await h.waitFor(() => textOf(h, id) === twinText, { timeout: 8000 })
    h.check('ONE Cmd+Z takes the whole merge back (both channels)', textOf(h, id) === twinText && ctx.docs.get(id)?.dirty !== true, { count: ctx.editor.getLineCount(id) })

    // After the undo the merge works again.
    ctx.docs.activate(c2)
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === c2, { timeout: 8000 })
    await ctx.commands.run('channels.mergeBack')
    await h.waitFor(() => textOf(h, id) === merged, { timeout: 8000 })
    h.check('after an undo of a merge, merging again works (from the other channel document)', textOf(h, id) === merged, message(h))
    h.focusEditor()
    await undoKey(h)
    await h.waitFor(() => textOf(h, id) === twinText, { timeout: 8000 })
    h.check('and is one undo step again', textOf(h, id) === twinText)

    // A refusal: the program changed in channel 1's lines after the split.
    ctx.docs.activate(id)
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 8000 })
    const again = ctx.docs.all().length
    await ctx.commands.run('channels.splitToDocuments')
    await h.idle()
    const [d1] = ctx.docs.all().slice(again).map((d) => d.id)
    ctx.editor.reveal(id, 10, 1)
    ctx.editor.insertText('(P4E DIRECT)\n')
    await h.idle()
    const changedByHand = textOf(h, id)
    ctx.editor.reveal(d1, 8, 1)
    ctx.editor.insertText('(P4E EDIT 3)\n')
    await h.idle()
    ctx.docs.activate(d1)
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === d1, { timeout: 8000 })
    await ctx.commands.run('channels.mergeBack')
    await h.idle()
    const marker = '\u0001'
    const [head, tail] = ctx.t('channels.merge.sourceChanged', { channel: marker }).split(marker)
    h.check('the program was changed in channel 1\'s lines after the split: the merge is refused in plain words, as an error, ending "Nothing was changed."', message(h).startsWith(head) && message(h).endsWith(tail) && tail.endsWith('Nothing was changed.') && h.q('status-message')?.getAttribute('data-error') === '1', { status: message(h) })
    h.check('and the program is exactly as it was before the merge was tried', textOf(h, id) === changedByHand, { count: ctx.editor.getLineCount(id) })
  })
})
