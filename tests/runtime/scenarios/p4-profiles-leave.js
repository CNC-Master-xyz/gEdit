// P4h, the profile form inside Settings: nothing typed in the form is lost without a question (plan docs/planning/phase-4-implementation.md
// section 6.10 rule 7; the fix round CODE-1, the owner's rule that the Machines page already keeps: ask before closing, before changing the tab,
// before saving the settings). One scenario.
//
//   A. a form with a change   Settings > Profiles, "Edit in form", a field changed, and in the Editor tab a setting changed before it:
//                             1. Save (the settings) asks, names the file, and Cancel keeps everything: the dialog, the form, the typed
//                                text; nothing is written (settings.json, the profile file).
//                             2. a click on another tab asks the same; Cancel keeps the Profiles tab and the form.
//                             3. Cancel (the dialog's) asks with the longer wording that names the changes made in Settings as well;
//                                the answer Cancel keeps everything.
//                             4. Esc (a real key press, the keyboard in the form) asks the same; "Discard changes" closes the dialog and
//                                writes nothing: the setting is the old one, the profile file the same bytes.
//   B. a form with nothing   a form opened and not changed is not asked about: the tab can change and the dialog can close.
//   C. the form's own Cancel with a change asks "Discard changes?" and names the file; Cancel keeps the form changed, "Discard" leaves it, and
//                             the file is the same bytes.
//
// **Every expected text is `ctx.t(...)`** of the key, the file name is the one the form's own head shows. The alerts are the real NSAlerts of
// `dialogs.confirm` (the answer is a click on the button of the alert). The profile file is written by the scenario.

import { scenario } from '../lib/index.js'
import { setInput } from './m2-common.js'
import {
  addProfile,
  alertText,
  askedNothing,
  closeSettings,
  context,
  fieldControl,
  formDirty,
  formField,
  formFileName,
  formRoot,
  formSave,
  formValue,
  guard,
  openSettings,
  openTab,
  profileAction,
  profileFileText,
  profileRows,
  ready,
  settingControl,
  settingsDialog,
  settingsFile,
  typeInForm,
  waitForForm,
} from './p4-profiles-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

const SHOP = { id: 'shop-mill', name: 'Shop mill', shortName: 'SHOP', version: 1, extends: 'fanuc-gcode', detect: { content: [] } }

/**
 * Opens the form of shop-mill.json inline on the Profiles tab (the dialog has to be open already).
 * @param {Harness} h
 */
async function openForm(h) {
  await openTab(h, 'profiles')
  const row = profileRows(h).find((entry) => entry.id === 'shop-mill' && entry.origin === 'user')
  if (!row) throw new Error(`no row for shop-mill; the page lists ${profileRows(h).map((entry) => entry.id).join(', ')}`)
  h.click(profileAction(h, 'form', { row: row.element }))
  await waitForForm(h)
}

scenario('p4-profiles-leave', { timeout: 420 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  await addProfile(h, 'shop-mill.json', SHOP)
  const baseline = await profileFileText(h, 'shop-mill.json')
  const tabWidth = ctx.settings.get('editor.tabWidth')

  // ============================================================ A. a form with a change
  await guard(h, 'A. Settings asks before the changes in the profile form are lost', async () => {
    const opened = await openSettings(h, 'editor')
    setInput(settingControl(h, 'editor.tabWidth'), String(tabWidth + 2))
    await h.frame()
    await openForm(h)
    h.check('a change of another tab is free while the form is clean (the Editor tab was left with a changed setting without a question)', (await h.alert.visible()) === null && !!formRoot(h) && !formDirty(h))
    await typeInForm(h, 'name', 'Shop mill changed')
    const name = formFileName(h)
    h.check('the form is changed and says which file it is', formDirty(h) && name === 'shop-mill.json', name)
    const kept = async () => !!settingsDialog(h) && h.q('settings-page')?.dataset.category === 'profiles' && formDirty(h) && formValue(h, 'name') === 'Shop mill changed'
    const untouched = async () => (await settingsFile(h))['editor.tabWidth'] === undefined && (await profileFileText(h, 'shop-mill.json')) === baseline

    // 1. Save.
    h.click(h.q('modal-ok'))
    let text = await alertText(h)
    h.check('Save asks, with the title of the settings question and the wording that names the file', text !== null && text.includes(ctx.t('settings.leave.title')) && text.includes(ctx.t('profileForm.leave.message', { name })), text)
    await h.alert.click('Cancel')
    await h.idle()
    h.check('Cancel keeps the dialog, the Profiles tab, the form and what was typed, and nothing is written', await kept(), { page: h.q('settings-page')?.dataset.category })
    h.check('(settings.json has no new tab width, the profile file is the same bytes)', await untouched())

    // 2. A click on another tab.
    h.click(h.q('settings-category', { category: 'editor' }))
    text = await alertText(h)
    h.check('a click on another tab asks the same question', text !== null && text.includes(ctx.t('profileForm.leave.message', { name })), text)
    await h.alert.click('Cancel')
    await h.idle()
    h.check('Cancel keeps the Profiles tab and the form', await kept())

    // 3. The dialog's Cancel.
    h.click(h.q('modal-cancel'))
    text = await alertText(h)
    h.check('Cancel asks too, and names the changes made in Settings as well', text !== null && text.includes(ctx.t('profileForm.leave.withSettings', { name })), text)
    await h.alert.click('Cancel')
    await h.idle()
    h.check('the answer Cancel keeps everything', await kept() && (await untouched()))

    // 4. Esc, with the keyboard in the form.
    fieldControl(formField(h, 'name'))?.focus()
    await h.nativeKeys([{ key: 'Escape' }])
    text = await alertText(h)
    h.check('Esc asks the same question as Cancel', text !== null && text.includes(ctx.t('profileForm.leave.withSettings', { name })), text)
    h.check('the alert offers to discard the changes', (await h.alert.visible())?.buttons?.some((button) => button.includes(ctx.t('settings.leave.ok'))) === true, (await h.alert.visible())?.buttons)
    await h.alert.click(ctx.t('settings.leave.ok'))
    await h.waitFor(() => !settingsDialog(h), { timeout: 8000 })
    await opened.closed
    await h.idle()
    h.check('"Discard changes" closes the dialog', !settingsDialog(h) && !formRoot(h))
    h.check('and writes nothing: the setting is the old one, the profile file the same bytes', ctx.settings.get('editor.tabWidth') === tabWidth && (await untouched()), { tabWidth: ctx.settings.get('editor.tabWidth') })
  })

  // ============================================================ B. a form with nothing changed
  await guard(h, 'B. a clean form is not asked about', async () => {
    const opened = await openSettings(h)
    await openForm(h)
    h.check('the form is open and clean', !!formRoot(h) && !formDirty(h) && formSave(h)?.disabled === true)
    h.click(h.q('settings-category', { category: 'editor' }))
    await h.waitFor(() => h.q('settings-page')?.dataset.category === 'editor', { timeout: 8000 })
    h.check('the tab changes without a question', h.q('settings-page')?.dataset.category === 'editor' && (await h.alert.visible()) === null)
    await openForm(h)
    h.click(h.q('modal-cancel'))
    await h.waitFor(() => !settingsDialog(h), { timeout: 8000 })
    await opened.closed
    h.check('and the dialog closes without a question', !settingsDialog(h) && (await askedNothing(h)))
  })

  // ============================================================ C. the form's own Cancel
  await guard(h, 'C. the form’s own Cancel asks when something was typed', async () => {
    const opened = await openSettings(h)
    await openForm(h)
    const name = formFileName(h)
    await typeInForm(h, 'shortName', 'SHOP X')
    h.check('a field is changed', formDirty(h))
    h.click(h.q('profile-form-cancel'))
    const text = await alertText(h)
    h.check('Cancel asks "Discard changes?" and names the file', text !== null && text.includes(ctx.t('profileForm.leave.title')) && text.includes(ctx.t('profileForm.leave.message', { name })), text)
    await h.alert.click('Cancel')
    await h.idle()
    h.check('the answer Cancel keeps the form and what was typed', !!formRoot(h) && formDirty(h) && formValue(h, 'shortName') === 'SHOP X')
    h.click(h.q('profile-form-cancel'))
    await alertText(h)
    await h.alert.click(ctx.t('profileForm.leave.ok'))
    await h.waitFor(() => !formRoot(h), { timeout: 8000 })
    h.check('"Discard" leaves the form: the list is back, and the file is the same bytes', !formRoot(h) && profileRows(h).some((row) => row.id === 'shop-mill') && (await profileFileText(h, 'shop-mill.json')) === baseline)
    await closeSettings(h, opened)
    h.check('and the dialog now closes without a question (the settings are the old ones)', await askedNothing(h))
  })

  h.check('no alert was left unanswered by the sections above', (await h.alert.visible()) === null)
})
