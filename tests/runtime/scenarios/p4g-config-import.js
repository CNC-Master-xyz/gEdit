// P4g, importing a configuration where it can go wrong (plan `docs/planning/phase-4-implementation.md` section 6.9 rules 27 to 33 and the review
// fixes T1, R2, R5; P4.36, H4g). `p4g-config` is the zip side (export, the round trip, backup and undo, refusals); this one is what happens around
// the import: the settings dialog that is open while it runs, a package that is off, code that needs the trust tick, and a write that fails.
//
// The run starts with a settings file (tab width 6, the package cfg-pkg switched off), that package, and one code file of the user's. The zips are
// built at run time (`p4g-common.js` `writeZip`) and answered by the stubbed open dialog.
//
//   A. inside Settings  An import run on the Configuration page while the dialog is open (regression of CODE-1 / fix T1):
//                       the dialog follows the changed value for a field nobody edited, a field that was edited keeps the edit, Save writes the
//                       edit and does NOT write the old value back over the import, and closing after an import asks nothing about discarding.
//                       The preview names the keys it keeps from this computer (the interpreter, never taken from a file).
//   B. a package off    A file cannot switch a package back on (regression of R2): the settings file of a zip with an empty list changes the
//                       tab width and leaves the package off; a list with another name adds that name (a file may switch packages off).
//   C. trust            Scripts are never ticked by themselves and are not written when the trust tick is not given; ticking them brings the
//                       sentence and the box, Import stays off until the box is ticked, and then the script is on disk and offered.
//   D. a failing import A write that fails half way (a folder that cannot be written to) puts back what was already written, removes the
//                       folders the import made (regression of R5), keeps the backup, says so in the status bar, and a second try with the
//                       folder writable then succeeds.
//
// The expected texts are `ctx.t(...)` of the keys.

import { scenario } from '../lib/index.js'
import { osOp } from './m7-common.js'
import {
  closeSettings,
  codesText,
  confirmImport,
  configPaths,
  context,
  control,
  json,
  message,
  openSettings,
  openTab,
  pickImport,
  previewState,
  profileText,
  read,
  ready,
  scriptText,
  seed,
  setInput,
  settingsDialog,
  tick,
  writeZip,
} from './p4g-common.js'

const WORLD = seed({
  'settings.json': json({ $version: 1, 'editor.tabWidth': 6, 'packages.disabled': ['cfg-pkg'] }),
  'packages/cfg-pkg/package.json': json({ name: 'Cfg package' }),
  'packages/cfg-pkg/scripts/pkgtool.py': scriptText('pkgtool'),
  'codes/old-codes.json': codesText('old-codes'),
})

/** @param {unknown} settings the content of a settings.json in a zip */
const settingsEntry = (settings) => /** @type {[string, string]} */ (['settings.json', json({ $version: 1, ...(/** @type {object} */ (settings)) })])

scenario('p4g-config-import', { timeout: 480, files: WORLD }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const paths = configPaths(ctx)
  const run = h.cfg.run
  const backups = `${paths.dataDir}/import-backups`
  const settingsNow = async () => /** @type {any} */ (await h.config.read('settings.json'))
  const exists = async (/** @type {string} */ path) => (await h.disk.stat(path)) !== null
  const scriptIds = () => /** @type {any[]} */ (read(ctx.scripts.list)).map((e) => e.id)
  const listing = async (/** @type {string} */ dir) => {
    try {
      return (await h.disk.list(dir)).map((entry) => entry.name)
    } catch {
      return []
    }
  }

  // ============================================================ A. an import while Settings is open
  const first = await openSettings(h)
  setInput(control(h, 'appearance.editorFontSize'), '20')
  await h.frame()
  await openTab(h, 'configuration')
  const zip1 = await writeZip(h, `${run}/in1.zip`, [settingsEntry({ 'editor.tabWidth': 3, 'scripts.python': '/nowhere/python' })])
  await pickImport(h, zip1)
  let shown = previewState(h)
  h.check('the preview ticks the settings and shows the key that changes', shown.groups.find((g) => g.id === 'settings')?.ticked === true && shown.files.some((f) => f.path === 'settings.json' && f.action === 'replace' && f.text.includes('editor.tabWidth')), shown.files)
  h.check('and names the interpreter as a setting kept from this computer', shown.text.includes(ctx.t('configuration.preview.kept', { keys: 'scripts.python' })), shown.text.slice(0, 400))
  await confirmImport(h)
  h.check('the live setting is the imported one', ctx.settings.get('editor.tabWidth') === 3, ctx.settings.get('editor.tabWidth'))
  await openTab(h, 'editor')
  h.check('the dialog follows: the tab width field shows the imported value, not the old one it was opened with', control(h, 'editor.tabWidth')?.value === '3', control(h, 'editor.tabWidth')?.value)
  await openTab(h, 'appearance')
  h.check('and the field that was edited keeps the edit', control(h, 'appearance.editorFontSize')?.value === '20', control(h, 'appearance.editorFontSize')?.value)
  h.click(h.q('modal-ok'))
  await h.waitFor(() => !settingsDialog(h), { timeout: 8000 })
  await first.closed
  await h.idle()
  let file = await settingsNow()
  h.check('Save wrote the edit and did not write the old tab width back over the import', file['editor.tabWidth'] === 3 && file['appearance.editorFontSize'] === 20, file)
  h.check('the interpreter of the zip was never taken, and the package is still off', !('scripts.python' in file) && JSON.stringify(file['packages.disabled']) === JSON.stringify(['cfg-pkg']), file)

  const second = await openSettings(h, 'configuration')
  const zip2 = await writeZip(h, `${run}/in2.zip`, [settingsEntry({ 'editor.tabWidth': 4 })])
  await pickImport(h, zip2)
  await confirmImport(h)
  h.click(h.q('modal-cancel'))
  const closed = await h.waitFor(() => !settingsDialog(h), { timeout: 5000 })
  const question = closed ? null : await h.alert.visible()
  if (question) {
    await h.alert.click(ctx.t('settings.leave.ok'))
    await h.waitFor(() => !settingsDialog(h), { timeout: 8000 })
  }
  h.check('closing the dialog after an import asks nothing about discarding changes', !!closed && question === null, question)
  await second.closed
  h.check('and the imported value is the one in force and in the file', ctx.settings.get('editor.tabWidth') === 4 && (await settingsNow())['editor.tabWidth'] === 4)

  // ============================================================ B. a file cannot switch a package on
  const third = await openSettings(h, 'configuration')
  const zip3 = await writeZip(h, `${run}/in3.zip`, [settingsEntry({ 'editor.tabWidth': 7, 'packages.disabled': [] })])
  await pickImport(h, zip3)
  shown = previewState(h)
  h.check('a list that lacks the name of a package that is off is a change of the tab width only', shown.files.length === 1 && shown.files[0].path === 'settings.json' && shown.files[0].text.includes('editor.tabWidth') && !shown.files[0].text.includes('packages.disabled'), shown.files)
  await confirmImport(h)
  h.check('the tab width is the imported one and the package is still off', ctx.settings.get('editor.tabWidth') === 7 && JSON.stringify(ctx.settings.get('packages.disabled')) === JSON.stringify(['cfg-pkg']), ctx.settings.get('packages.disabled'))
  const zip3b = await writeZip(h, `${run}/in3b.zip`, [settingsEntry({ 'packages.disabled': ['other-pkg'] })])
  await pickImport(h, zip3b)
  await confirmImport(h)
  h.check('a file can switch another package off: the list is the union, this computer’s names first', JSON.stringify(ctx.settings.get('packages.disabled')) === JSON.stringify(['cfg-pkg', 'other-pkg']), ctx.settings.get('packages.disabled'))
  await openTab(h, 'packages')
  await h.waitFor(() => h.q('package-row', { package: 'cfg-pkg' }), { timeout: 8000 })
  h.check('the Packages page still shows cfg-pkg as off, and none of its scripts is offered', h.q('package-row', { package: 'cfg-pkg' })?.dataset.enabled === '0' && !scriptIds().some((id) => id.startsWith('pkg-cfg-pkg:')), scriptIds())
  await closeSettings(h, third)

  // ============================================================ C. code needs the trust tick
  const fourth = await openSettings(h, 'configuration')
  const imported = `${paths.userScriptsDir}/imported_tool.py`
  const zip4 = await writeZip(h, `${run}/in4.zip`, [settingsEntry({ 'editor.tabWidth': 5 }), ['scripts/imported_tool.py', scriptText('imported_tool')]])
  await pickImport(h, zip4)
  shown = previewState(h)
  const scriptsGroup = shown.groups.find((g) => g.id === 'scripts')
  h.check('the scripts of the zip are a group of their own that holds code and is NOT ticked by itself', scriptsGroup?.selectable === true && scriptsGroup.runnable === true && scriptsGroup.ticked === false && shown.groups.find((g) => g.id === 'settings')?.ticked === true, shown.groups.map((g) => `${g.id}:${g.ticked}:${g.runnable}`))
  h.check('no trust sentence or box is shown while no code is ticked', shown.trust === null && !shown.text.includes(ctx.t('configuration.preview.trust')))
  await confirmImport(h)
  h.check('importing without the scripts writes the setting and not the script', ctx.settings.get('editor.tabWidth') === 5 && !(await exists(imported)), { tab: ctx.settings.get('editor.tabWidth'), script: await exists(imported) })

  await pickImport(h, zip4)
  shown = previewState(h)
  h.check('the same zip again: the settings are now the same as yours, the script is new', !shown.groups.find((g) => g.id === 'settings')?.selectable && shown.files.length === 1 && shown.files[0].path === 'scripts/imported_tool.py' && shown.files[0].action === 'new', shown.files)
  h.check('Import is off: nothing is ticked', shown.confirm?.disabled === true)
  await tick(h, previewState(h).groups.find((g) => g.id === 'scripts')?.box ?? null, true)
  shown = previewState(h)
  h.check('ticking the scripts brings the sentence about Python and your rights, and the box', shown.text.includes(ctx.t('configuration.preview.trust')) && shown.trust !== null && shown.trust.checked === false, shown.text.slice(-300))
  h.check('Import stays off until the box is ticked', shown.confirm?.disabled === true)
  await tick(h, shown.trust, true)
  h.check('then it is on', previewState(h).confirm?.disabled === false)
  await tick(h, previewState(h).groups.find((g) => g.id === 'scripts')?.box ?? null, false)
  h.check('and off again when the scripts are unticked', previewState(h).confirm?.disabled === true && previewState(h).trust === null)
  await tick(h, previewState(h).groups.find((g) => g.id === 'scripts')?.box ?? null, true)
  await tick(h, previewState(h).trust, true)
  await confirmImport(h)
  h.check('the script is on disk, as the zip had it, and offered to run', (await exists(imported)) && (await h.disk.read(imported)) === scriptText('imported_tool'), message(h))
  await h.waitFor(() => scriptIds().includes('user:imported_tool.py'), { timeout: 15000 })
  h.check('the script list was read again without a restart', scriptIds().includes('user:imported_tool.py'), scriptIds())
  h.check('the status bar counts the one file written', message(h).startsWith(ctx.t('configuration.imported', { count: 1 })), message(h))
  await closeSettings(h, fourth)

  // ============================================================ D. a write that fails is put back
  const codesFile = `${paths.codesDir}/old-codes.json`
  const codesBefore = await h.disk.read(codesFile)
  const newCodes = json({ dialect: 'old-codes', version: 1, extends: 'fanuc-lathe', codes: [{ code: 'M14', label: 'Other meaning', description: 'Changed by the import.' }] })
  const zip5 = await writeZip(h, `${run}/in5.zip`, [
    ['codes/old-codes.json', newCodes],
    ['scripts/rb_tool.py', scriptText('rb_tool')],
    ['profiles/rb-profile.json', profileText('rb-profile')],
    settingsEntry({ 'editor.tabWidth': 8 }),
    ['packages/rb-pkg/package.json', json({ name: 'Rollback package' })],
    ['packages/rb-pkg/scripts/x.py', scriptText('x')],
  ])
  const fifth = await openSettings(h, 'configuration')
  const backupsBefore = (await listing(backups)).length
  /** Ticks every group and the trust box. */
  const tickEverything = async () => {
    for (const group of previewState(h).groups.filter((g) => g.selectable)) await tick(h, previewState(h).groups.find((g) => g.id === group.id)?.box ?? null, true)
    if (previewState(h).trust) await tick(h, previewState(h).trust, true)
  }
  await pickImport(h, zip5)
  shown = previewState(h)
  h.check('the preview lists a replaced code file, new files, a new package, and two groups of code that are not ticked', shown.files.some((f) => f.path === 'codes/old-codes.json' && f.action === 'replace') && shown.files.some((f) => f.path === 'profiles/rb-profile.json' && f.action === 'new') && shown.groups.filter((g) => g.runnable).every((g) => !g.ticked) && shown.groups.some((g) => g.id === 'package:rb-pkg'), { groups: shown.groups.map((g) => `${g.id}:${g.ticked}`), files: shown.files.map((f) => f.path) })
  await tickEverything()
  await osOp(h, 'chmod', paths.profilesDir, { mode: '555' })
  try {
    await confirmImport(h)
  } finally {
    await osOp(h, 'chmod', paths.profilesDir, { mode: '755' })
  }
  h.check('the status bar says the import failed, as an error', message(h) === ctx.t('configuration.importFailed') && h.q('status-message')?.getAttribute('data-error') === '1', message(h))
  h.check('the code file that was already replaced is back as it was', (await h.disk.read(codesFile)) === codesBefore)
  h.check('the script and the package that were already written are gone, and the folder the import made with them', !(await exists(`${paths.userScriptsDir}/rb_tool.py`)) && !(await exists(`${paths.configDir}/packages/rb-pkg/package.json`)) && !(await exists(`${paths.configDir}/packages/rb-pkg`)), {
    script: await exists(`${paths.userScriptsDir}/rb_tool.py`),
    folder: await exists(`${paths.configDir}/packages/rb-pkg`),
  })
  h.check('the file that failed and the settings, which come last, were never written', !(await exists(`${paths.profilesDir}/rb-profile.json`)) && (await settingsNow())['editor.tabWidth'] === 5 && ctx.settings.get('editor.tabWidth') === 5)
  h.check('the backup of what was about to be replaced is kept', (await listing(backups)).length >= 1, { before: backupsBefore, now: await listing(backups) })

  await pickImport(h, zip5)
  await tickEverything()
  await confirmImport(h)
  h.check('with the folder writable the same import goes through: every file is written', (await exists(`${paths.profilesDir}/rb-profile.json`)) && (await exists(`${paths.userScriptsDir}/rb_tool.py`)) && (await exists(`${paths.configDir}/packages/rb-pkg/scripts/x.py`)) && (await h.disk.read(codesFile)) === newCodes && ctx.settings.get('editor.tabWidth') === 8, message(h))
  h.check('and the status bar counts them', message(h).startsWith(ctx.t('configuration.imported', { count: 6 })), message(h))
  await closeSettings(h, fifth)
  h.check('no question is left unanswered', (await h.alert.visible()) === null)
})
