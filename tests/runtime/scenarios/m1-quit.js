// Quitting with more than one unsaved document (plan §5 M1 H1 `m1-quit-multi`, §7.2
// `FileOps.confirmQuit`): every way out of the window has to ask ONE combined question
// that names every unsaved document, and honour the answer.
//
// The three ways in: Cmd+Q through the app menu, the red close button (`performClose:`)
// and `window.close()` from Rust. Each goes through `CloseRequested`, which the file
// contribution prevents before it asks.

import { scenario } from '../lib/index.js'

const COMBINED = JSON.stringify(['Save All', 'Discard All', 'Cancel'])

scenario('m1-quit-multi', { timeout: 180 }, async (h) => {
  const ctx = /** @type {import('$lib/app/types').AppContext} */ (h.app.ctx)
  const dirtyTabs = () => h.qa('doc-tab', { dirty: '1' }).map((e) => e.dataset.path)

  const fanuc = await h.fixture('nc/fanuc/f01-mill-3tools.nc')
  const klartext = await h.fixture('nc/heidenhain/h01-3tools.h')
  const packed = await h.fixture('nc/fanuc/f02-packed.nc')
  const fanucHex = await h.disk.hex(fanuc)
  const klartextHex = await h.disk.hex(klartext)

  // ------------------------------------------------------------ two unsaved documents
  await h.dialogs.queue('open', [fanuc, klartext])
  await h.nativeKeys([{ key: 'o', mods: ['cmd'] }])
  await h.waitFor(() => !!h.q('doc-tab', { path: klartext }) && !h.q('doc-tab', { path: '' }), { timeout: 10000 })

  for (const path of [fanuc, klartext]) {
    h.click(h.q('doc-tab', { path }))
    await h.waitFor(() => h.q('doc-tab', { path, active: '1' }) !== null)
    h.focusEditor()
    await h.nativeType('(UNSAVED)')
    await h.waitFor(() => !!h.q('doc-tab', { path, dirty: '1' }), { timeout: 4000 })
  }
  h.check('two documents are unsaved', JSON.stringify(dirtyTabs()) === JSON.stringify([fanuc, klartext]), dirtyTabs())

  /**
   * Asks the window to close and checks the one combined alert that must come back.
   * @param {string} how
   * @param {() => Promise<unknown>} request
   */
  const asksOnce = async (how, request) => {
    await request()
    const alert = await h.alert.wait()
    const state = await h.window.state()
    h.check(`${how}: one combined alert, with Save All / Discard All / Cancel`, JSON.stringify(alert?.buttons) === COMBINED && state.alerts === 1, { alert, state })
    h.check(`${how}: it names both unsaved documents`, (alert?.texts ?? []).join('\n').includes('f01-mill-3tools.nc') && (alert?.texts ?? []).join('\n').includes('h01-3tools.h'), alert?.texts)
    return alert
  }

  await asksOnce('Cmd+Q', () => h.nativeKeys([{ key: 'q', mods: ['cmd'] }]))
  // T182: a file dropped while the question is up is dropped, like a second Cmd+S. The drop handler takes the lock the
  // quit holds (G8 F2): "Save All" re-reads the documents, and a tab that arrived after the question would be written
  // although the question never named it. Counted, not timed: the drop would have asked the backend about its path
  // (`files_stat`) first, and would have added a tab.
  const statsBefore = h.rec.ipc.calls['files_stat'] ?? 0
  await h.drop([packed], { x: 300, y: 300 })
  await h.turns()
  const afterDrop = { tabs: h.qa('doc-tab').map((e) => e.dataset.path), stats: (h.rec.ipc.calls['files_stat'] ?? 0) - statsBefore, state: await h.window.state() }
  h.check(
    'a file dropped while the quit question is up is not opened and not even looked at, and the question stays the only alert',
    afterDrop.tabs.length === 2 && !afterDrop.tabs.includes(packed) && afterDrop.stats === 0 && afterDrop.state.alerts === 1,
    afterDrop,
  )
  // A second request while the question is up must not stack a second alert.
  await h.window.performClose()
  await h.turns()
  const stacked = await h.window.state()
  h.check('a second close request while the question is up adds no second alert', stacked.alerts === 1, stacked)
  await h.alert.click('Cancel')
  await h.idle()
  h.check('Cancel keeps the window and both unsaved documents', (await h.window.state()).exists && JSON.stringify(dirtyTabs()) === JSON.stringify([fanuc, klartext]), {
    state: await h.window.state(),
    dirty: dirtyTabs(),
  })
  // The lock is free again after the answer: a drop is taken (an open file is focused, no tab is added).
  await h.drop([fanuc], { x: 300, y: 300 })
  await h.waitFor(() => h.q('status-message')?.textContent === 'f01-mill-3tools.nc is already open', { timeout: 8000 })
  h.check('after Cancel a drop is taken again: the open file is focused and no tab is added', h.qa('doc-tab').length === 2 && !!h.q('doc-tab', { path: fanuc, active: '1' }), {
    tabs: h.qa('doc-tab').map((e) => e.dataset.path),
    status: h.q('status-message')?.textContent,
  })

  await asksOnce('the red close button', () => h.window.performClose())
  await h.alert.click('Cancel')
  await h.idle()
  h.check('Cancel after the red button keeps the window', (await h.window.state()).exists && h.qa('doc-tab').length === 2, dirtyTabs())

  await asksOnce('window.close()', () => h.window.close())
  await h.alert.click('Cancel')
  await h.idle()
  h.check('Cancel after window.close() keeps the window', (await h.window.state()).exists && h.qa('doc-tab').length === 2, dirtyTabs())

  // Mod+Shift+W is the webview's Close Window; it takes the same path.
  await asksOnce('Cmd+Shift+W', () => h.nativeKeys([{ key: 'w', mods: ['cmd', 'shift'] }]))
  await h.alert.click('Cancel')
  await h.idle()
  h.check('Cancel after Cmd+Shift+W keeps the window', (await h.window.state()).exists && h.qa('doc-tab').length === 2, dirtyTabs())

  // A single unsaved document keeps the M0 wording, so the combined dialog is only for
  // the case it is meant for.
  h.click(h.q('doc-tab', { path: fanuc }))
  await h.waitFor(() => h.q('doc-tab', { path: fanuc, active: '1' }) !== null)
  let undos = 0
  while (undos < 40 && h.q('doc-tab', { path: fanuc, dirty: '1' })) {
    ctx.editor.triggerAction('undo')
    undos++
    await h.sleep(30)
  }
  h.check('one document is unsaved again', JSON.stringify(dirtyTabs()) === JSON.stringify([klartext]), dirtyTabs())
  await h.window.close()
  const single = await h.alert.wait()
  h.check('with one unsaved document the alert is the single-document one', JSON.stringify(single?.buttons) === JSON.stringify(['Save', "Don't Save", 'Cancel']), single)
  h.check('it names that document', (single?.texts ?? []).join('\n').includes('h01-3tools.h'), single?.texts)
  await h.alert.click('Cancel')
  await h.idle()

  // ------------------------------------------------------------ Discard All exits
  h.click(h.q('doc-tab', { path: fanuc }))
  await h.waitFor(() => h.q('doc-tab', { path: fanuc, active: '1' }) !== null)
  h.focusEditor()
  await h.nativeType('(UNSAVED AGAIN)')
  await h.waitFor(() => h.qa('doc-tab', { dirty: '1' }).length === 2, { timeout: 4000 })

  h.expectExit({
    files: [
      { path: fanuc, hex: fanucHex },
      { path: klartext, hex: klartextHex },
    ],
    events: ['MenuEvent quit', 'CloseRequested main', 'Exit'],
  })
  await h.nativeKeys([{ key: 'q', mods: ['cmd'] }])
  await h.alert.wait()
  await h.alert.click('Discard All').catch(() => {})
})

// Save All on the quit question (T179). The other scenarios of this file answer Cancel or Discard All; this is the
// answer that can lose work: it writes every unsaved document before the window goes. Two programs and a note that has
// no file yet, so one of the writes needs a Save As, and that is the one the user can decline.
//
//   first    Save All with the Save As of the note cancelled. The two programs come first and are written; the note's
//            cancelled dialog stops the quit (`confirmQuit` stops on cancel, M5), and the status bar names what was
//            not saved. Nothing is lost and the window stays.
//   second   Cmd+Q again, now one unsaved document: Save, with a path for the note. The note is written, then the app
//            exits, and the three files are read after the exit.
scenario('m1-quit-save-all', { timeout: 180 }, async (h) => {
  const ctx = /** @type {import('$lib/app/types').AppContext} */ (h.app.ctx)
  const dirtyPaths = () => h.qa('doc-tab', { dirty: '1' }).map((e) => e.dataset.path)
  const alertText = (/** @type {{ texts?: string[] } | null} */ alert) => (alert?.texts ?? []).join('\n')

  const fanuc = await h.fixture('nc/fanuc/f01-mill-3tools.nc')
  const klartext = await h.fixture('nc/heidenhain/h01-3tools.h')
  const note = `${h.cfg.run}/saved-note.nc`

  await h.dialogs.queue('open', [fanuc, klartext])
  await h.nativeKeys([{ key: 'o', mods: ['cmd'] }])
  await h.waitFor(() => !!h.q('doc-tab', { path: klartext }) && !h.q('doc-tab', { path: '' }), { timeout: 10000 })
  for (const path of [fanuc, klartext]) {
    h.click(h.q('doc-tab', { path }))
    await h.waitFor(() => h.q('doc-tab', { path, active: '1' }) !== null)
    h.focusEditor()
    await h.nativeType('(UNSAVED)')
    await h.waitFor(() => !!h.q('doc-tab', { path, dirty: '1' }), { timeout: 4000 })
  }
  await ctx.commands.run('file.new')
  await h.waitFor(() => !!h.q('doc-tab', { path: '', active: '1' }), { timeout: 5000 })
  const noteId = ctx.docs.getActiveId() ?? ''
  h.focusEditor()
  await h.nativeType('(NOTE)')
  await h.waitFor(() => !!h.q('doc-tab', { path: '', dirty: '1' }), { timeout: 4000 })
  const noteTitle = ctx.docs.get(noteId)?.title ?? ''
  h.check('two programs and a note without a file are unsaved', JSON.stringify(dirtyPaths()) === JSON.stringify([fanuc, klartext, '']), dirtyPaths())
  const fanucBefore = await h.disk.read(fanuc)

  // ------------------------------------------------------------ first: Save All, the note's Save As cancelled
  await h.dialogs.queue('save', null)
  await h.nativeKeys([{ key: 'q', mods: ['cmd'] }])
  const question = await h.alert.wait()
  h.check('Cmd+Q asks one combined question that names all three', JSON.stringify(question?.buttons) === COMBINED && alertText(question).includes('f01-mill-3tools.nc') && alertText(question).includes('h01-3tools.h') && alertText(question).includes(noteTitle), question)
  await h.alert.click('Save All')
  await h.waitFor(() => h.dialogs.calls().some((c) => c.kind === 'save'), { timeout: 10000 })
  await h.idle()
  const partial = {
    window: await h.window.state(),
    dirty: dirtyPaths(),
    status: h.q('status-message')?.textContent,
    error: h.q('status-message')?.getAttribute('data-error'),
  }
  h.check('with the note\'s Save As cancelled the quit is stopped: the window is there and no alert is left', partial.window.exists === true && partial.window.alerts === 0 && (await h.alert.visible()) === null, partial)
  h.check('only the note is still unsaved: the two programs were written before it', JSON.stringify(partial.dirty) === JSON.stringify(['']), partial.dirty)
  h.check('the programs are on disk with the typed text, the first one changed', (await h.disk.read(fanuc)).includes('(UNSAVED)') && (await h.disk.read(klartext)).includes('(UNSAVED)') && (await h.disk.read(fanuc)) !== fanucBefore)
  h.check('the status bar says what was saved and what was not, as an error', partial.status === ctx.t('files.savedAllPartial', { saved: 2, list: noteTitle }) && partial.error === '1', partial)

  // ------------------------------------------------------------ second: the note gets its file, then the app exits
  await h.dialogs.queue('save', note)
  await h.expectExit({
    events: ['MenuEvent quit', 'CloseRequested main', 'Exit'],
    files: [
      { path: note, includes: '(NOTE)' },
      { path: fanuc, includes: '(UNSAVED)' },
      { path: klartext, includes: '(UNSAVED)' },
    ],
  })
  await h.nativeKeys([{ key: 'q', mods: ['cmd'] }])
  const last = await h.alert.wait()
  h.check('the second question is the single-document one and names the note', JSON.stringify(last?.buttons) === JSON.stringify(['Save', "Don't Save", 'Cancel']) && alertText(last).includes(noteTitle), last)
  await h.alert.click('Save').catch(() => {})
})
