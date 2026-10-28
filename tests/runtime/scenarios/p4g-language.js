// P4g, the language setting (plan `docs/planning/phase-4-implementation.md` section 6.9 rules 37 to 42, owner answer Q4-18; P4.37, H4g).
//
// **What can and cannot be run.** Nothing but English ships in v1.2.0 (Q4-18: a translation ships only when the owner provides one), and the
// build the harness makes is the product build, so there is no second message set to switch to, and the language row of the Appearance page is
// not offered (rule 41). The unit tests (`app/language.test.ts`, `i18n/locale.test.ts`) hold the switch itself and the fall back to English for
// a set that is missing, broken or partial, with sets that do not ship (`tests/fixtures/i18n`). What the running app can prove, and this file does:
//
//   p4g-language       `ui.language` is a tag with no message set behind it (`de`, then `de-CH`): the app starts in English with no notice and no
//                      warning, the dialog offers no language row and the search finds none, the tag stays in settings.json through a save of
//                      another setting, and "switching back" (`en`, the default) takes the key out of the file again.
//   p4g-language-bad   a value that is not a tag at all in settings.json: dropped with the usual warning, English in force, the other settings
//                      untouched, and the notice in the dialog.
//
// A scenario that switches to a shipped second language and breaks its message set belongs here as soon as one ships: it needs `LOCALES` to have the
// row, which also turns the language row on (a change to the cumulative `m2-settings` page check).

import { scenario } from '../lib/index.js'
import { closeSettings, context, message, openSettings, ready, seed, setInput, json, textOf } from './p4g-common.js'

scenario('p4g-language', { timeout: 240, files: seed({ 'settings.json': json({ $version: 1, 'ui.language': 'de' }) }) }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const file = async () => /** @type {any} */ (await h.config.read('settings.json'))
  const report = () => ctx.settings.report()

  h.check('a language tag without a message set is a valid value and is kept', ctx.settings.get('ui.language') === 'de' && report().warnings.length === 0 && report().error === undefined, report())
  h.check('English is in use: the texts are the English ones', ctx.t('common.cancel') === 'Cancel' && ctx.t('settings.title') === 'Settings', ctx.t('settings.title'))
  h.check('there is no notice about a language that could not be loaded', h.q('status-message')?.getAttribute('data-error') !== '1' && !message(h).startsWith('The language'), message(h))

  // The dialog offers no language row, and the search finds none.
  const opened = await openSettings(h)
  h.check('the Appearance page has no language row', !h.q('form-field', { field: 'ui.language' }), h.qa('form-field').map((e) => e.dataset.field))
  setInput(h.q('settings-search'), 'language')
  await h.frame()
  h.check('the search for "language" does not find one either', h.qa('settings-search-hit').every((e) => e.dataset.id !== 'ui.language'), h.qa('settings-search-hit').map((e) => e.dataset.id))
  await closeSettings(h, opened)

  // The tag stays through a save of something else.
  await ctx.settings.save({ 'editor.tabWidth': 3 })
  let saved = await file()
  h.check('saving another setting keeps the language tag in the file', saved['ui.language'] === 'de' && saved['editor.tabWidth'] === 3, saved)

  // A regional tag is a tag too, and shows the same English.
  await ctx.settings.save({ 'ui.language': 'de-CH' })
  saved = await file()
  h.check('de-CH is kept as written, with no warning', saved['ui.language'] === 'de-CH' && ctx.settings.get('ui.language') === 'de-CH' && report().warnings.length === 0, { saved, report: report() })
  h.check('the texts are still English', ctx.t('common.cancel') === 'Cancel')

  // Switching back to the default takes the key out of the file; the other values stay.
  await ctx.settings.save({ 'ui.language': 'en' })
  saved = await file()
  h.check('English is the default: the key is gone from the file and the other setting stays', !('ui.language' in saved) && saved['editor.tabWidth'] === 3 && ctx.settings.get('ui.language') === 'en', saved)
})

scenario('p4g-language-bad', { timeout: 240, files: seed({ 'settings.json': json({ $version: 1, 'ui.language': 'Deutsch!', 'editor.tabWidth': 6 }) }) }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const report = ctx.settings.report()

  h.check('the app starts although the value is not a language tag', h.q('app-shell')?.dataset.ready === '1')
  h.check('the value is dropped with the usual warning, one warning, and no error', report.warnings.length === 1 && /ui\.language/.test(report.warnings[0]) && report.error === undefined, report)
  h.check('English is in force, and the other setting is untouched', ctx.settings.get('ui.language') === 'en' && ctx.settings.get('editor.tabWidth') === 6 && ctx.t('common.cancel') === 'Cancel', { language: ctx.settings.get('ui.language'), tab: ctx.settings.get('editor.tabWidth') })

  const opened = await openSettings(h)
  h.check('the dialog says that one value was ignored', !!h.q('settings-notice') && textOf(h.q('settings-notice')).includes('ui.language'), textOf(h.q('settings-notice')))
  await closeSettings(h, opened)
})
