// P4g, your own keys (plan `docs/planning/phase-4-implementation.md` section 5 P4g and section 6.9 rules 1 to 6, 45 and 46; P4.34,
// H4g): a `keybindings.json` that is in the config folder when gEdit starts, the Keyboard page, and the shortcut reference.
//
// What only the running app proves (the unit tests use a fake editor, a fake window and a fake page):
//
//   A. at start        the file is read once at startup and the keys in force follow it: `bookmark.toggle` has Mod+S (a string is both
//                      platforms), `bookmark.next` has Mod+D, and `file.save`, whose default Mod+S was taken, has none. The declared
//                      keys are still there (`commands.defaultKeys`). An entry the reader cannot use (`nav.goto`, a bare G) and an entry
//                      for a command that does not exist (`misc.gone`) do not stop the start.
//   B. real keys       a user key wins over a key the editor owns. Cmd+S in the focused editor runs Toggle Bookmark, once (a second press
//                      takes the bookmark away again), and the save dialog is never asked for. Cmd+D, which is Monaco's own Add Selection
//                      to Next Find Match, runs Next Bookmark: the cursor goes to the next bookmark and nothing is selected (plan rule 6:
//                      the proof on Monaco 0.55.1 that a gEdit action with a user key beats a built-in rule).
//   C. the reference   View, Keyboard Shortcuts marks the two keys the user set as changed and does not mark the displaced default
//                      (`file.save`, which has no key now) as "You set this key"; a command the user never touched is not marked.
//   D. the page        rows with their source, the conflict of the seeded file in the list of keys used twice and as a note under the
//                      command that lost its key, the entry for a command that is gone as "Not available", the problem of the entry
//                      that could not be read, and the search box. Press a key: a key with no Ctrl, Cmd or Alt and no function key is
//                      refused with the reason and the capture goes on, Esc ends the capture and not the dialog, an F-key is saved
//                      (and then runs the command from the editor), a Mac key with Option alone is saved with the notice, Remove key
//                      and Reset per command, and Reset all after a confirmation. The file keeps the entry that could not be read and
//                      the entry of the gone command through every edit, and Reset all keeps the members of the other platform.
//   E. after Reset all the built-in keys are back in force: Cmd+S saves again (the save dialog answers a path).
//
// The programs are written here; the expected texts are `ctx.t(...)` of the keys.

import { scenario } from '../lib/index.js'
import { revealLine } from './m3-common.js'
import { newDoc } from './m4-common.js'
import {
  closeSettings,
  configPaths,
  context,
  json,
  keyDefault,
  keyNow,
  message,
  openSettings,
  ready,
  seed,
  setInput,
  textOf,
} from './p4g-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

const PROGRAM = ['%', 'O1001 (KEYS)', 'N10 G21 G17 G40', 'N20 T1 M6', 'N30 G43 H1 Z50.', 'N40 G1 Z-2. F150.', 'N50 G0 Z50.', 'N60 M30', '%', ''].join('\n')

/** What the file holds when the app starts. A bare G takes typing away and is refused; `misc.gone` names no command. */
const START = {
  $version: 1,
  bindings: { 'bookmark.toggle': 'Mod+S', 'bookmark.next': 'Mod+D', 'nav.goto': 'G', 'misc.gone': 'Mod+Alt+9' },
}

scenario('p4g-keys', { timeout: 420, files: seed({ 'keybindings.json': json(START) }) }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const paths = configPaths(ctx)
  const keysFile = `${paths.configDir}/keybindings.json`
  /** The bindings now in the file. */
  const bindings = async () => JSON.parse(await h.disk.read(keysFile)).bindings
  const row = (/** @type {string} */ id) => h.q('keyboard-row', { command: id })
  const inRow = (/** @type {string} */ id, /** @type {string} */ testId) => /** @type {HTMLElement | null} */ (row(id)?.querySelector(`[data-testid="${testId}"]`) ?? null)
  const press = (/** @type {Parameters<Harness['nativeKeys']>[0]} */ keys) => h.nativeKeys(keys)

  // ============================================================ A. the keys in force at start
  h.check('the app started with the file in the config folder', h.q('app-shell')?.dataset.ready === '1')
  h.check('Toggle Bookmark has Mod+S, from a string that names both platforms', keyNow(ctx, 'bookmark.toggle') === 'Mod+S', ctx.commands.get('bookmark.toggle')?.keys)
  h.check('Next Bookmark has Mod+D', keyNow(ctx, 'bookmark.next') === 'Mod+D', ctx.commands.get('bookmark.next')?.keys)
  h.check('Save lost its key to the user key and shows none', keyNow(ctx, 'file.save') === undefined, ctx.commands.get('file.save')?.keys)
  h.check('the keys the commands were registered with are still there', keyDefault(ctx, 'file.save') === 'Mod+S' && keyDefault(ctx, 'bookmark.toggle') === 'Mod+F2' && keyDefault(ctx, 'bookmark.next') === 'F2', {
    save: ctx.commands.defaultKeys('file.save'),
    toggle: ctx.commands.defaultKeys('bookmark.toggle'),
    next: ctx.commands.defaultKeys('bookmark.next'),
  })
  h.check('the registry did not report a conflict: a user key over a default is told on the page, not as an error', h.rec.errors.length === 0, h.rec.errors)

  // ============================================================ B. real keys beat the editor's own
  const id = await newDoc(h, PROGRAM)
  await revealLine(h, id, 4, 3)
  h.check('the editor is focused', h.focusEditor())
  const dialogsBefore = h.dialogs.calls().length
  await press([{ key: 's', mods: ['cmd'] }])
  await h.waitFor(() => ctx.bookmarks.lines(id).length === 1, { timeout: 5000 })
  h.check('Cmd+S set a bookmark on the cursor line, once', JSON.stringify(ctx.bookmarks.lines(id)) === '[4]', ctx.bookmarks.lines(id))
  await h.idle()
  h.check('and it did not save: no dialog was asked for and the document has no path', h.dialogs.calls().length === dialogsBefore && !ctx.docs.get(id)?.path, { calls: h.dialogs.calls().slice(dialogsBefore), path: ctx.docs.get(id)?.path })
  await press([{ key: 's', mods: ['cmd'] }])
  await h.waitFor(() => ctx.bookmarks.lines(id).length === 0, { timeout: 5000 })
  h.check('a second Cmd+S takes it away again (the key ran once each time)', ctx.bookmarks.lines(id).length === 0, ctx.bookmarks.lines(id))

  ctx.bookmarks.toggle(id, 3)
  ctx.bookmarks.toggle(id, 6)
  await revealLine(h, id, 4, 3)
  h.focusEditor()
  await press([{ key: 'd', mods: ['cmd'] }])
  await h.waitFor(() => h.app.cursor().line === 6, { timeout: 5000 })
  const selection = /** @type {any} */ (ctx.editor.editorInstance())?.getSelection()
  h.check('Cmd+D went to the next bookmark (line 6) and did not select the word under the cursor', h.app.cursor().line === 6 && selection?.isEmpty?.() === true, { cursor: h.app.cursor(), selection: selection?.toString?.() })

  // ============================================================ C. the shortcut reference
  void ctx.commands.run('help.shortcuts')
  await h.waitFor(() => h.q('shortcuts-filter'), { timeout: 8000 })
  h.click(h.q('shortcuts-show-unbound'))
  await h.waitFor(() => h.q('shortcuts-row', { command: 'file.save' }), { timeout: 5000 })
  const refRow = (/** @type {string} */ command) => h.q('shortcuts-row', { command })
  h.check('Toggle Bookmark and Next Bookmark are marked as changed', !!refRow('bookmark.toggle')?.querySelector('[data-testid="shortcuts-changed"]') && !!refRow('bookmark.next')?.querySelector('[data-testid="shortcuts-changed"]'))
  h.check('they show the key the user gave them', (refRow('bookmark.toggle')?.getAttribute('data-keys') ?? '').includes('S') && (refRow('bookmark.next')?.getAttribute('data-keys') ?? '').includes('D'), {
    toggle: refRow('bookmark.toggle')?.getAttribute('data-keys'),
    next: refRow('bookmark.next')?.getAttribute('data-keys'),
  })
  h.check('Save lost its key and is NOT marked as one the user set', !!refRow('file.save') && refRow('file.save')?.getAttribute('data-keys') === null && !refRow('file.save')?.querySelector('[data-testid="shortcuts-changed"]'), refRow('file.save')?.outerHTML.slice(0, 200))
  h.check('a command the user never touched is not marked', !!refRow('file.open') && !refRow('file.open')?.querySelector('[data-testid="shortcuts-changed"]'))
  h.check('exactly two rows carry the mark', h.qa('shortcuts-changed').length === 2, h.qa('shortcuts-changed').length)
  h.click(h.q('modal-cancel'))
  await h.waitFor(() => !h.q('modal', { modal: 'shortcuts' }), { timeout: 5000 })

  // ============================================================ D. the Keyboard page
  const opened = await openSettings(h, 'keyboard')
  await h.waitFor(() => row('file.save'), { timeout: 5000 })
  h.check('the page lists the commands and says how many', h.qa('keyboard-row').length > 20 && /\d/.test(textOf(h.q('keyboard-count'))), textOf(h.q('keyboard-count')))
  h.check('Toggle Bookmark is the user’s: source user, marked changed, with its built-in key shown', row('bookmark.toggle')?.dataset.source === 'user' && !!inRow('bookmark.toggle', 'keyboard-mark-changed') && /F2/.test(textOf(inRow('bookmark.toggle', 'keyboard-default'))), textOf(row('bookmark.toggle')))
  h.check('Save is not the user’s (no entry, so not marked changed) but lost its key: the note names the winner', row('file.save')?.dataset.source === 'default' && !inRow('file.save', 'keyboard-mark-changed') && !!inRow('file.save', 'keyboard-lost') && textOf(inRow('file.save', 'keyboard-key')) === ctx.t('keyboardPage.none'), textOf(row('file.save')))
  h.check('both rows say what kind of conflict it is', row('file.save')?.dataset.conflict === 'user-over-default' && row('bookmark.toggle')?.dataset.conflict === 'user-over-default')
  const conflicts = h.qa('keyboard-conflict')
  h.check('the list of keys used twice has the Mod+S conflict, for Mac and for the other systems', conflicts.length >= 2 && conflicts.every((e) => e.dataset.kind === 'user-over-default') && new Set(conflicts.map((e) => e.dataset.platform)).size === 2, conflicts.map((e) => textOf(e)))
  h.check('a command that does not exist shows as "Not available" and cannot be captured', !!inRow('misc.gone', 'keyboard-mark-unused') && !inRow('misc.gone', 'keyboard-capture'), textOf(row('misc.gone')))
  h.check('the entry that could not be read is listed with its JSON path', textOf(h.q('keyboard-problems')).includes('bindings.nav.goto'), textOf(h.q('keyboard-problems')))
  h.check('the page does not offer Reset on a row with no entry of its own', /** @type {HTMLButtonElement | null} */ (inRow('file.open', 'keyboard-reset'))?.disabled === true)

  // The search box.
  setInput(h.q('keyboard-search'), 'nav.goto')
  await h.waitFor(() => h.qa('keyboard-row').length < 5, { timeout: 5000 })
  h.check('the search finds a command by its id', !!row('nav.goto') && h.qa('keyboard-row').every((e) => (e.dataset.command ?? '').includes('nav.goto')), h.qa('keyboard-row').map((e) => e.dataset.command))
  setInput(h.q('keyboard-search'), 'zzzz-nothing')
  await h.waitFor(() => !!h.q('keyboard-empty'), { timeout: 5000 })
  h.check('and says so when nothing matches', textOf(h.q('keyboard-empty')) === ctx.t('keyboardPage.empty'))
  setInput(h.q('keyboard-search'), '')
  await h.waitFor(() => h.qa('keyboard-row').length > 20, { timeout: 5000 })

  // Press a key: refusals first, the capture goes on.
  const inspector = 'view.toggleInspector'
  h.click(inRow(inspector, 'keyboard-capture'))
  await h.waitFor(() => !!inRow(inspector, 'keyboard-capturing'), { timeout: 3000 })
  h.check('Press a key shows the instruction in place of the key', textOf(inRow(inspector, 'keyboard-capturing')) === ctx.t('keyboardPage.capturing'))
  await press([{ key: 'k' }])
  await h.waitFor(() => !!inRow(inspector, 'keyboard-refused'), { timeout: 3000 })
  h.check('a letter alone is refused, with the reason in plain words', textOf(inRow(inspector, 'keyboard-refused')) === ctx.t('keyboardPage.refusal.noModifier'), textOf(inRow(inspector, 'keyboard-refused')))
  h.check('and the capture is still on', !!inRow(inspector, 'keyboard-capturing'))
  await press([{ key: 'K', mods: ['shift'] }])
  await h.frame()
  h.check('Shift with a letter is refused too: that is a capital letter', textOf(inRow(inspector, 'keyboard-refused')) === ctx.t('keyboardPage.refusal.noModifier') && !!inRow(inspector, 'keyboard-capturing'))
  h.check('nothing was written', row(inspector)?.dataset.source === 'default' && !('view.toggleInspector' in (await bindings())))
  await press([{ key: 'Escape' }])
  await h.waitFor(() => !inRow(inspector, 'keyboard-capturing'), { timeout: 3000 })
  h.check('Esc ends the capture and does not close the dialog', !!h.q('modal', { modal: 'settings' }) && !!h.q('settings-keyboard') && !(await h.alert.visible()))

  // An F-key is saved.
  h.click(inRow(inspector, 'keyboard-capture'))
  await h.waitFor(() => !!inRow(inspector, 'keyboard-capturing'), { timeout: 3000 })
  await press([{ key: 'F8' }])
  await h.waitFor(() => row(inspector)?.dataset.source === 'user', { timeout: 5000 })
  h.check('F8 is saved as the key of Toggle Inspector, for this system', textOf(inRow(inspector, 'keyboard-key')).includes('F8') && !!inRow(inspector, 'keyboard-mark-changed'), textOf(row(inspector)))
  const afterSet = await bindings()
  h.check('the file has it for the Mac only, and still has the entries the reader could not use or did not know', JSON.stringify(afterSet[inspector]) === JSON.stringify({ mac: 'F8' }) && afterSet['nav.goto'] === 'G' && afterSet['misc.gone'] === 'Mod+Alt+9' && afterSet['bookmark.toggle'] === 'Mod+S', afterSet)
  h.check('the key is in force at once', keyNow(ctx, inspector) === 'F8', ctx.commands.get(inspector)?.keys)

  // Option alone on a Mac: saved, with the notice.
  const clear = 'bookmark.clear'
  h.click(inRow(clear, 'keyboard-capture'))
  await h.waitFor(() => !!inRow(clear, 'keyboard-capturing'), { timeout: 3000 })
  await press([{ key: 'j', mods: ['alt'] }])
  await h.waitFor(() => row(clear)?.dataset.source === 'user', { timeout: 5000 })
  h.check('Option+J is allowed and carries the notice that it may type a character', inRow(clear, 'keyboard-notice')?.getAttribute('data-notice') === 'optionCharacter' && textOf(inRow(clear, 'keyboard-notice')) === ctx.t('keyboardPage.notice.optionCharacter'), textOf(row(clear)))

  // Remove key.
  h.click(inRow(clear, 'keyboard-clear'))
  await h.waitFor(async () => JSON.stringify((await bindings())[clear]) === JSON.stringify({ mac: null }), { timeout: 5000 })
  h.check('Remove key leaves the command with no key on this system, and the file says so', textOf(inRow(clear, 'keyboard-key')) === ctx.t('keyboardPage.none') && keyNow(ctx, clear) === undefined, textOf(row(clear)))

  // Reset one.
  h.click(inRow(clear, 'keyboard-reset'))
  await h.waitFor(async () => !(clear in (await bindings())), { timeout: 5000 })
  h.check('Reset takes the entry out of the file and the row back to its source', row(clear)?.dataset.source === 'default' && /** @type {HTMLButtonElement | null} */ (inRow(clear, 'keyboard-reset'))?.disabled === true)
  const afterReset = await bindings()
  h.check('the unreadable entry and the unknown command are still in the file after every edit', afterReset['nav.goto'] === 'G' && afterReset['misc.gone'] === 'Mod+Alt+9', afterReset)

  // Close the page; the F-key works from the editor.
  await closeSettings(h, opened)
  h.focusEditor()
  await press([{ key: 'F8' }])
  await h.waitFor(() => !!h.q('panel', { region: 'left', panel: 'inspector' }), { timeout: 8000 })
  h.check('F8 now toggles the inspector from the editor', !!h.q('panel', { region: 'left', panel: 'inspector' }))
  await press([{ key: 'F8' }])
  await h.waitFor(() => !h.q('panel', { region: 'left', panel: 'inspector' }), { timeout: 8000 })
  h.check('and again takes it away', !h.q('panel', { region: 'left', panel: 'inspector' }))

  // ============================================================ Reset all
  const again = await openSettings(h, 'keyboard')
  await h.waitFor(() => row(inspector), { timeout: 5000 })
  h.check('Reset all is on while there is an entry', /** @type {HTMLButtonElement | null} */ (h.q('keyboard-reset-all'))?.disabled === false)
  h.click(h.q('keyboard-reset-all'))
  const ask = await h.alert.wait({ timeout: 8000 })
  h.check('Reset all asks first', !!ask && (ask.texts ?? []).join(' ').includes(ctx.t('keyboardPage.resetAllConfirm')), ask)
  await h.alert.click('Cancel')
  await h.idle()
  h.check('Cancel changes nothing', keyNow(ctx, inspector) === 'F8' && keyNow(ctx, 'bookmark.toggle') === 'Mod+S')
  h.click(h.q('keyboard-reset-all'))
  await h.alert.wait({ timeout: 8000 })
  await h.alert.click(ctx.t('keyboardPage.resetAll'))
  await h.waitFor(() => keyNow(ctx, 'file.save') === 'Mod+S', { timeout: 8000 })
  h.check('the built-in keys are back in force', keyNow(ctx, 'file.save') === 'Mod+S' && keyNow(ctx, 'bookmark.toggle') === 'Mod+F2' && keyNow(ctx, 'bookmark.next') === 'F2' && keyNow(ctx, inspector) === 'Mod+Alt+A', {
    save: keyNow(ctx, 'file.save'),
    toggle: keyNow(ctx, 'bookmark.toggle'),
    next: keyNow(ctx, 'bookmark.next'),
    inspector: keyNow(ctx, inspector),
  })
  const afterAll = await bindings()
  h.check('the file lost the keys of this system and kept the members of the other one', JSON.stringify(afterAll['bookmark.toggle']) === JSON.stringify({ other: 'Mod+S' }) && JSON.stringify(afterAll['bookmark.next']) === JSON.stringify({ other: 'Mod+D' }) && !(inspector in afterAll), afterAll)
  h.check('and the entries that were not this system’s are still there', afterAll['nav.goto'] === 'G' && JSON.stringify(afterAll['misc.gone']) === JSON.stringify({ other: 'Mod+Alt+9' }), afterAll)
  h.check('the page follows: no row is the user’s on this system any more', h.qa('keyboard-row').every((e) => e.dataset.source === 'default' || e.dataset.command === 'misc.gone'), h.qa('keyboard-row').filter((e) => e.dataset.source === 'user').map((e) => e.dataset.command))
  h.check('and no conflict is listed', h.qa('keyboard-conflict').length === 0, h.qa('keyboard-conflict').map((e) => textOf(e)))
  await closeSettings(h, again)

  // ============================================================ E. Cmd+S saves again
  await revealLine(h, id, 2, 1)
  h.focusEditor()
  await h.nativeType('(X)')
  await h.waitFor(() => ctx.docs.get(id)?.dirty === true, { timeout: 5000 })
  const target = `${h.cfg.run}/keys-after-reset.nc`
  await h.dialogs.queue('save', target)
  await press([{ key: 's', mods: ['cmd'] }])
  await h.waitFor(async () => (await h.title()) === 'keys-after-reset.nc — gEdit', { timeout: 8000 })
  h.check('Cmd+S saves again, through the save dialog', (await h.disk.read(target)).includes('(X)'), message(h))
})
