// P4g, the settings search box (plan `docs/planning/phase-4-implementation.md` section 6.9 rule 43; P4.37, H4g). The box sits at the top of the
// settings dialog; real key presses where the key is the point (typing, Enter, Escape, the arrow down).
//
// What only the running app proves (the unit tests have no dialog around the box):
//   A. focus          the box has the keyboard when the dialog opens; nothing is listed for an empty box.
//   B. finding        a query finds a setting by its label, in table order after the label that starts with it; case and accents do not
//                     matter (`TAB WÏDTH`); nothing found says so; at most 20 results are listed however many match; the × empties the box and
//                     puts the keyboard back in it.
//   C. Enter          takes the best result: the page of the setting opens, the control has the keyboard, the box is empty. It does NOT reach the
//                     dialog, where Enter would be Save: with a value edited in the dialog (the font size) the dialog stays open, the edit stays in
//                     its field, and settings.json is not written. Enter with nothing found changes nothing.
//   D. Escape         clears the box before it can close the dialog; the next Escape is the dialog's own (it asks, because the edit is unsaved).
//   E. the keys       the arrow down moves to the first result (Escape there clears the box and the keyboard goes back to it); a click on a result
//                     does what Enter does; a page is found by its heading and opened (Keyboard).
//
// The expected texts are `ctx.t(...)` of the keys.

import { scenario } from '../lib/index.js'
import { control, context, openSettings, ready, setInput, settingsDialog, textOf } from './p4g-common.js'

scenario('p4g-settings', { timeout: 300 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const search = () => /** @type {HTMLInputElement | null} */ (h.q('settings-search'))
  const hits = () => h.qa('settings-search-hit')
  const hitIds = () => hits().map((e) => e.dataset.id)
  const fieldOfFocus = () => document.activeElement?.closest('[data-field]')?.getAttribute('data-field') ?? null
  const page = () => h.q('settings-page')?.dataset.category ?? null
  /** The font size as the file has it: undefined while the file does not exist or does not hold it. */
  const savedFontSize = async () => /** @type {any} */ (await h.config.read('settings.json'))?.['appearance.editorFontSize']
  /** Types into the box with real key presses, after giving it the keyboard. */
  const typeInBox = async (/** @type {string} */ text) => {
    search()?.focus()
    await h.nativeType(text)
    await h.frame()
  }
  const clearBox = async () => {
    setInput(search(), '')
    await h.waitFor(() => hits().length === 0 && !h.q('settings-search-none'), { timeout: 3000 })
  }

  const opened = await openSettings(h)

  // ============================================================ A. focus
  h.check('the search box has the keyboard when the dialog opens', document.activeElement === search(), document.activeElement?.outerHTML.slice(0, 120))
  h.check('an empty box lists nothing and says nothing', hits().length === 0 && !h.q('settings-search-none') && !h.q('settings-search-clear'))

  // ============================================================ B. finding
  await typeInBox('tab width')
  await h.waitFor(() => hits().length > 0, { timeout: 3000 })
  h.check('a query finds the setting by its label', hitIds()[0] === 'editor.tabWidth' && hits()[0].dataset.tab === 'editor', hitIds())
  h.check('and shows the label and where it is', textOf(hits()[0]).startsWith('Tab width'), textOf(hits()[0]))
  h.check('the × appears with text in the box', !!h.q('settings-search-clear'))
  setInput(search(), 'TAB WÏDTH')
  await h.waitFor(() => hitIds()[0] === 'editor.tabWidth', { timeout: 3000 })
  h.check('case and accents do not matter', hitIds()[0] === 'editor.tabWidth', hitIds())
  setInput(search(), 'font')
  await h.waitFor(() => hitIds().includes('appearance.editorFontSize'), { timeout: 3000 })
  h.check('"font" finds the font family and the font size', hitIds().includes('appearance.editorFontSize') && hitIds().includes('appearance.editorFontFamily'), hitIds())
  setInput(search(), 'dots')
  await h.waitFor(() => hitIds().includes('editor.renderWhitespace'), { timeout: 3000 })
  h.check('the help text is searched too: "dots" finds Show spaces and tabs, whose help says blanks are shown as dots', hitIds().includes('editor.renderWhitespace'), hitIds())
  setInput(search(), 'editor.word')
  await h.waitFor(() => hitIds().includes('editor.wordWrap'), { timeout: 3000 })
  h.check('the key itself is searched: "editor.word" finds Wrap long lines', hitIds().includes('editor.wordWrap'), hitIds())
  setInput(search(), 'zzzzq')
  await h.waitFor(() => !!h.q('settings-search-none'), { timeout: 3000 })
  h.check('nothing found says so', hits().length === 0 && textOf(h.q('settings-search-none')) === ctx.t('settings.search.none'))
  setInput(search(), 'e')
  await h.waitFor(() => hits().length > 0, { timeout: 3000 })
  h.check('at most 20 results are listed, however many settings contain the letter', hits().length === 20, hits().length)
  h.click(h.q('settings-search-clear'))
  await h.waitFor(() => hits().length === 0, { timeout: 3000 })
  h.check('the × empties the box, lists nothing and gives the box the keyboard back', search()?.value === '' && document.activeElement === search() && !h.q('settings-search-clear'))

  // ============================================================ C. Enter
  setInput(control(h, 'appearance.editorFontSize'), '22')
  await h.frame()
  await typeInBox('nothing-like-this')
  await h.waitFor(() => !!h.q('settings-search-none'), { timeout: 3000 })
  await h.nativeKeys([{ key: 'Enter' }])
  await h.idle()
  h.check('Enter with nothing found changes nothing: the dialog is open, on the same page, and the edit is there', !!settingsDialog(h) && page() === 'appearance' && control(h, 'appearance.editorFontSize')?.value === '22' && (await savedFontSize()) === undefined, { open: !!settingsDialog(h), page: page() })
  await clearBox()
  await typeInBox('tab width')
  await h.waitFor(() => hits().length > 0, { timeout: 3000 })
  await h.nativeKeys([{ key: 'Enter' }])
  await h.waitFor(() => page() === 'editor', { timeout: 5000 })
  await h.waitFor(() => fieldOfFocus() === 'editor.tabWidth', { timeout: 3000 })
  h.check('Enter opened the page of the best result and gave its control the keyboard', page() === 'editor' && fieldOfFocus() === 'editor.tabWidth', { page: page(), focus: fieldOfFocus() })
  h.check('and emptied the box', search()?.value === '' && hits().length === 0)
  h.check('Enter did not reach the dialog: it is still open, nothing was saved', !!settingsDialog(h) && (await savedFontSize()) === undefined && ctx.settings.get('appearance.editorFontSize') === 14, { saved: await savedFontSize(), size: ctx.settings.get('appearance.editorFontSize') })
  h.click(h.q('settings-category', { category: 'appearance' }))
  await h.waitFor(() => page() === 'appearance', { timeout: 3000 })
  h.check('the edit made before the search is still in its field', control(h, 'appearance.editorFontSize')?.value === '22')

  // ============================================================ D. Escape
  await typeInBox('font')
  await h.waitFor(() => hits().length > 0, { timeout: 3000 })
  await h.nativeKeys([{ key: 'Escape' }])
  await h.waitFor(() => hits().length === 0, { timeout: 3000 })
  h.check('the first Escape empties the box and leaves the dialog open', search()?.value === '' && !!settingsDialog(h) && (await h.alert.visible()) === null)
  await h.nativeKeys([{ key: 'Escape' }])
  const ask = await h.alert.wait({ timeout: 8000 })
  h.check('the next Escape is the dialog’s own: it asks, because the font size was not saved', !!ask && (ask.texts ?? []).join(' ').includes(ctx.t('settings.leave.title')), ask)
  await h.alert.click('Cancel')
  await h.idle()
  h.check('Cancel keeps the dialog and the edit', !!settingsDialog(h) && control(h, 'appearance.editorFontSize')?.value === '22')

  // ============================================================ E. the keys and the mouse
  await typeInBox('tab width')
  await h.waitFor(() => hits().length > 0, { timeout: 3000 })
  await h.nativeKeys([{ key: 'ArrowDown' }])
  await h.waitFor(() => document.activeElement === hits()[0], { timeout: 3000 })
  h.check('the arrow down moves the keyboard to the first result', document.activeElement === hits()[0])
  await h.nativeKeys([{ key: 'Escape' }])
  await h.waitFor(() => hits().length === 0, { timeout: 3000 })
  h.check('Escape on a result empties the box and gives it the keyboard back', search()?.value === '' && document.activeElement === search() && !!settingsDialog(h))
  await typeInBox('wrap')
  await h.waitFor(() => hitIds().includes('editor.wordWrap'), { timeout: 3000 })
  h.click(hits().find((e) => e.dataset.id === 'editor.wordWrap'))
  await h.waitFor(() => fieldOfFocus() === 'editor.wordWrap', { timeout: 5000 })
  h.check('a click on a result does what Enter does', page() === 'editor' && fieldOfFocus() === 'editor.wordWrap' && search()?.value === '', { page: page(), focus: fieldOfFocus() })
  await typeInBox('keyboard')
  await h.waitFor(() => hits().length > 0, { timeout: 3000 })
  h.check('a page is found by its heading', hits()[0].dataset.id === 'keyboard' && hits()[0].dataset.tab === 'keyboard', hitIds())
  await h.nativeKeys([{ key: 'Enter' }])
  await h.waitFor(() => !!h.q('settings-keyboard'), { timeout: 8000 })
  h.check('and Enter opens it', !!h.q('settings-keyboard') && search()?.value === '' && !!settingsDialog(h))

  // Leave without keeping the edit.
  h.click(h.q('modal-cancel'))
  await h.alert.wait({ timeout: 8000 })
  await h.alert.click(ctx.t('settings.leave.ok'))
  await h.waitFor(() => !settingsDialog(h), { timeout: 8000 })
  await opened.closed
  h.check('Discard changes closes the dialog and nothing of it was saved', (await savedFontSize()) === undefined && ctx.settings.get('appearance.editorFontSize') === 14)
})
