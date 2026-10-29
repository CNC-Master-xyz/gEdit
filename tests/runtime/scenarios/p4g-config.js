// P4g, export and import of the whole configuration, the zip side (plan `docs/planning/phase-4-implementation.md` section 5 P4g and
// section 6.9 rules 16 to 36, 45 and 46; P4.36, H4g). The side that needs a changed settings dialog, a trust tick and a failing write is
// `p4g-config-import`.
//
// The run starts with a configuration of every kind in the config folder (`files` writes it into the run's HOME before the app starts): a
// settings file, a key file, one profile, one code file, one script of the user's and one package with a script; a machine is made through the
// service. The zips the scenario needs besides the one the app writes are built at run time (`p4g-common.js` `writeZip`).
//
//   A. the commands     Export Configuration and Import Configuration are commands without a key.
//   B. export           through the Configuration page and the stubbed save dialog: the status bar counts the files and names the zip; the
//                       archive starts with gedit-config.json and holds every kind of file in the layout of the config folder and nothing
//                       else (no state.json, no window state, no .bak, no backup or recovery folder).
//   C. the round trip   importing that zip at once shows every group as "same as yours": nothing to choose, Import is off, nothing was
//                       written (no backup folder).
//   D. backup and undo  a setting changed after the export is a "replaces yours" line with the old and the new value; Import writes it,
//                       the status bar names the backup zip, the backup holds the file as it was, and importing the backup undoes the
//                       import.
//   E. refusals         a zip with a name that goes up a folder, a file that is not a zip, a zip with no gedit-config.json and a
//                       zip from a newer format are each refused whole, with the reason in words, no Import button, and nothing written
//                       outside the config folder.
//   F. the palette      Export Configuration and Import Configuration also work as commands (the preview is then a dialog of its own).
//
// The expected texts are `ctx.t(...)` of the keys.

import { scenario } from '../lib/index.js'
import { machineMaker } from './m10-common.js'
import {
  CONFIG,
  closeSettings,
  codesText,
  configPaths,
  context,
  exportTo,
  json,
  keyNow,
  leavePreview,
  message,
  confirmImport,
  openSettings,
  pickImport,
  previewState,
  profileText,
  ready,
  scriptText,
  seed,
  textOf,
  writeZip,
  zipNames,
} from './p4g-common.js'

const WORLD = seed({
  'settings.json': json({ $version: 1, 'editor.tabWidth': 6 }),
  'keybindings.json': json({ $version: 1, bindings: { 'view.toggleInspector': 'F8' } }),
  'profiles/cfg-lathe.json': profileText('cfg-lathe'),
  'codes/cfg-codes.json': codesText('cfg-codes'),
  'scripts/cfg_tool.py': scriptText('cfg_tool'),
  'packages/cfg-pkg/package.json': json({ name: 'Cfg package', version: '1' }),
  'packages/cfg-pkg/scripts/pkgtool.py': scriptText('pkgtool'),
})

/** Every name an export may contain, by the layout of the config folder (plan rule 16). */
const LAYOUT = /^(gedit-config\.json|settings\.json|keybindings\.json|machines\.json|(profiles|codes)\/[^/]+\.json|scripts\/([^/]+\/)?[^/]+\.py|packages\/[^/]+\/(package\.json|(profiles|codes)\/[^/]+\.json|scripts\/([^/]+\/)?[^/]+\.py))$/

scenario('p4g-config', { timeout: 420, files: WORLD }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const paths = configPaths(ctx)
  const run = h.cfg.run
  const backups = `${paths.dataDir}/import-backups`
  const listing = async (/** @type {string} */ dir) => {
    try {
      return (await h.disk.list(dir)).map((entry) => entry.name)
    } catch {
      return []
    }
  }
  const tabWidth = async () => /** @type {any} */ (await h.config.read('settings.json'))?.['editor.tabWidth']

  // ============================================================ A. the commands
  h.check('Export Configuration and Import Configuration are commands, and neither has a key', !!ctx.commands.get('config.export') && !!ctx.commands.get('config.import') && keyNow(ctx, 'config.export') === undefined && keyNow(ctx, 'config.import') === undefined)
  h.check('the config folder holds the seeded files where the layout says', paths.userScriptsDir === `${paths.configDir}/scripts` && !!(await h.disk.stat(`${paths.configDir}/packages/cfg-pkg/package.json`)), { scripts: paths.userScriptsDir, config: paths.configDir, seeded: CONFIG })
  await machineMaker(h).add('Cfg lathe', 'fanuc-lathe', 'is-b')
  h.check('a machine was made, so machines.json exists', (await h.disk.stat(`${paths.configDir}/machines.json`)) !== null)

  // ============================================================ B. export
  const opened = await openSettings(h, 'configuration')
  h.check('the page offers Export and Import and says what each does', !!h.q('config-export') && !!h.q('config-import') && textOf(h.q('settings-configuration')).includes(ctx.t('configuration.exportNote')) && textOf(h.q('settings-configuration')).includes(ctx.t('configuration.importNote')))
  const first = `${run}/export1.zip`
  await exportTo(h, first)
  const names = await zipNames(h, first)
  const count = Number(/(\d+) files?\./.exec(message(h))?.[1] ?? 'NaN')
  h.check('the status bar counts the files and names the zip', message(h) === ctx.t('configuration.exported', { count, file: 'export1.zip' }) && [names.length, names.length - 1].includes(count), { message: message(h), names })
  h.check('the archive starts with its manifest', names[0] === 'gedit-config.json', names)
  const wanted = ['settings.json', 'keybindings.json', 'machines.json', 'profiles/cfg-lathe.json', 'codes/cfg-codes.json', 'scripts/cfg_tool.py', 'packages/cfg-pkg/package.json', 'packages/cfg-pkg/scripts/pkgtool.py']
  h.check('it holds every kind of file, under the names of the config folder', wanted.every((name) => names.includes(name)), { missing: wanted.filter((name) => !names.includes(name)), names })
  h.check('and nothing outside the layout: no state, window state, backup or recovery file', names.every((name) => LAYOUT.test(name)) && !names.some((name) => /state|\.bak|recovery|import-backups/i.test(name)), names.filter((name) => !LAYOUT.test(name)))

  // ============================================================ C. the round trip
  await pickImport(h, first)
  let shown = previewState(h)
  h.check('the zip the app wrote is accepted', shown.state === 'ok', shown.text)
  h.check('every group is listed as the same as yours, and no file is offered to write', shown.files.length === 0 && ['settings', 'keys', 'machines', 'profiles', 'codes', 'scripts', 'package:cfg-pkg'].every((id) => shown.groups.some((g) => g.id === id && !g.selectable)), { files: shown.files, groups: shown.groups.map((g) => g.id) })
  h.check('the preview says there is nothing to import, and Import is off', shown.text.includes(ctx.t('configuration.preview.nothingInIt')) && shown.confirm?.disabled === true, shown.text.slice(0, 300))
  h.check('the package group is marked as holding code', shown.groups.find((g) => g.id === 'package:cfg-pkg')?.runnable === true && shown.groups.find((g) => g.id === 'scripts')?.runnable === true)
  await leavePreview(h)
  h.check('nothing was written: there is no backup folder', (await listing(backups)).length === 0, await listing(backups))

  // ============================================================ D. backup and undo
  await ctx.settings.save({ 'editor.tabWidth': 9 })
  h.check('the setting was changed after the export', (await tabWidth()) === 9)
  await pickImport(h, first)
  shown = previewState(h)
  const settingsFile = shown.files.find((f) => f.path === 'settings.json')
  h.check('the settings file is a "replaces yours" line, and it is the only one', shown.files.length === 1 && settingsFile?.action === 'replace', shown.files)
  h.check('with the old and the new value of the key', /editor\.tabWidth/.test(settingsFile?.text ?? '') && (settingsFile?.text ?? '').includes('9') && (settingsFile?.text ?? '').includes('6'), settingsFile?.text)
  h.check('the settings group is ticked and holds no code, so Import needs no trust', shown.groups.find((g) => g.id === 'settings')?.ticked === true && shown.trust === null && shown.confirm?.disabled === false)
  await confirmImport(h)
  h.check('the setting is what the zip said, and the dialog follows without a restart', (await tabWidth()) === 6 && ctx.settings.get('editor.tabWidth') === 6)
  const made = await listing(backups)
  h.check('one backup zip was written, with the date in its name', made.length === 1 && /^before-import-[0-9-]+\.zip$/.test(made[0]), made)
  h.check('the status bar names it', message(h) === `${ctx.t('configuration.imported', { count: 1 })} ${ctx.t('configuration.importedBackup', { name: made[0] })}`, message(h))
  const backupNames = await zipNames(h, `${backups}/${made[0]}`)
  h.check('the backup is in the same format and holds the file that was replaced, and only that', backupNames.includes('settings.json') && backupNames.every((name) => LAYOUT.test(name)) && !backupNames.some((name) => name !== 'gedit-config.json' && name !== 'settings.json'), backupNames)
  await pickImport(h, `${backups}/${made[0]}`)
  shown = previewState(h)
  h.check('importing the backup is a preview like any other and shows the setting as it was', shown.state === 'ok' && shown.files.length === 1 && shown.files[0].path === 'settings.json' && shown.files[0].action === 'replace', shown.files)
  await confirmImport(h)
  h.check('and it undoes the import', (await tabWidth()) === 9 && ctx.settings.get('editor.tabWidth') === 9)
  await ctx.settings.save({ 'editor.tabWidth': 6 })

  // ============================================================ E. refusals
  const outside = `${paths.configDir}/../escape.json`
  /** @type {[string, string, [string, string][], { manifest?: string | false }][]} */
  const bad = [
    ['a name that goes up a folder', 'parent-dir', [['../escape.json', '{}']], {}],
    ['a zip with no gedit-config.json', 'no-manifest', [['settings.json', '{}']], { manifest: false }],
    ['a zip from a newer format', 'newer-format', [['settings.json', '{}']], { manifest: JSON.stringify({ format: 2, app: 'gEdit' }) }],
    ['a manifest that is not gEdit’s', 'bad-manifest', [['settings.json', '{}']], { manifest: JSON.stringify({ format: 1, app: 'other' }) }],
  ]
  for (const [title, reason, entries, options] of bad) {
    const file = await writeZip(h, `${run}/bad-${reason}.zip`, entries, options)
    await pickImport(h, file)
    shown = previewState(h)
    h.check(`${title} is refused whole, with the reason`, shown.state === 'refused' && shown.refusals.includes(reason), { state: shown.state, refusals: shown.refusals })
    h.check(`and the reason is told in words, there is no Import button, and the file is not offered`, shown.text.includes(ctx.t(`configuration.refusal.${reason.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}`)) && shown.confirm === null && shown.files.length === 0, shown.text.slice(0, 300))
    await leavePreview(h)
  }
  await h.disk.write(`${run}/not-a-zip.zip`, 'this is not a zip file\n')
  await pickImport(h, `${run}/not-a-zip.zip`)
  shown = previewState(h)
  h.check('a file that is not a zip is refused whole', shown.state === 'refused' && shown.refusals.includes('not-zip') && shown.text.includes(ctx.t('configuration.refusal.notZip')), { state: shown.state, refusals: shown.refusals })
  await leavePreview(h)
  h.check('nothing was written outside the config folder, and the settings are as they were', (await h.disk.stat(outside)) === null && (await tabWidth()) === 6)
  await closeSettings(h, opened)

  // ============================================================ F. the palette
  const second = `${run}/export2.zip`
  await h.dialogs.queue('save', second)
  await ctx.commands.run('config.export')
  await h.waitFor(async () => ((await h.disk.stat(second)) !== null ? true : null), { timeout: 15000 })
  await h.idle()
  h.check('Export Configuration as a command writes the zip', (await zipNames(h, second))[0] === 'gedit-config.json' && message(h).includes('export2.zip'), message(h))
  await h.dialogs.queue('open', second)
  void ctx.commands.run('config.import')
  const dialog = await h.waitFor(() => h.q('modal', { modal: 'import-preview' }), { timeout: 15000 })
  h.check('Import Configuration as a command shows the preview as a dialog of its own', !!dialog && previewState(h).state === 'ok', textOf(dialog))
  h.click(h.q('modal-cancel'))
  await h.waitFor(() => !h.q('modal', { modal: 'import-preview' }), { timeout: 8000 })
  h.check('Cancel closes it and writes nothing', (await tabWidth()) === 6 && (await listing(backups)).length >= 1, await listing(backups))
})
