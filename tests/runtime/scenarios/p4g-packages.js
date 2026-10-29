// P4g, script packages (plan `docs/planning/phase-4-implementation.md` section 5 P4g and section 6.9 rules 7 to 15, 45 and 46;
// P4.35, H4g): folders in `<config>/packages` that bring scripts, profiles and code files, listed on Settings > Packages, switched on and off
// without a restart, and kept apart from the user's own files.
//
// The run starts with three package folders and one loose profile in the config folder (the `files` option writes them into the run's HOME
// before the app starts, because the scripts are looked for at start):
//   shop-a      package.json (display name "Shop A"), scripts/facing.py, scripts/finish/chamfer.py, one profile, one code file
//   shop-b      no package.json, one profile that does not load (numbering.step is text)
//   Bad Name    a folder name a package cannot have
//   profiles/broken.json   the user's own profile with the same file name and the same mistake as shop-b's
//
// What only the running app proves:
//   A. the page        the folder to copy a package to, the plain line about trust, one row per folder in byte order, the display name,
//                      version, description and counts of a package, a folder that cannot be a package listed with the reason and a
//                      switch that is off and disabled, a package with no manifest listed under its folder name.
//   B. the layers      a package's profile is among the profiles; the problem of shop-b's profile is told with the package ("package
//                      shop-b: broken.json") on the Packages page, in the Results panel and among the loose problems of the Profiles page,
//                      and is never a line of the row of the user's own broken.json, which has its own problem.
//   C. the Scripts menu  a package's scripts are sections of their own under the package's display name ("Shop A", "Shop A / finish"),
//                      in the ids `pkg-shop-a:facing.py` and `pkg-shop-a:finish/chamfer.py`; not editable in place.
//   D. switching       the switch writes `packages.disabled`, and with no restart takes the scripts out of the Scripts menu (a run of one
//                      fails with "Unknown script folder") and the profile out of the registry; on again brings them back. The dialog asks
//                      nothing when it closes: the page acted at once and the dialog's Save does not cover it.
//   E. Reload          a changed package.json changes the caption of the Scripts menu only when Reload is pressed; a folder copied in while
//                      the app runs shows up on Reload with its script.
//   F. copy to user folder  Edit Script on a package script asks the package question (the script, the package, Copy and edit or
//                      Cancel); Cancel changes nothing; Copy and edit puts the copy in the user's folder, opens it, and the copy shadows the
//                      package's script, which stays listed.
//
// The expected texts are `ctx.t(...)` of the keys.

import { scenario } from '../lib/index.js'
import { openProfilesPage, closeProfilesPage, profileRows } from './exit2-common.js'
import {
  closeSettings,
  codesText,
  configPaths,
  context,
  json,
  message,
  openSettings,
  profileText,
  read,
  ready,
  ribbonTab,
  scriptText,
  seed,
  textOf,
} from './p4g-common.js'

const BROKEN = (/** @type {string} */ id) => json({ id, name: `${id} profile`, shortName: id.toUpperCase().slice(0, 8), extends: 'fanuc-lathe', numbering: { step: 'seven' } })

const WORLD = seed({
  'packages/shop-a/package.json': json({ name: 'Shop A', version: '1.2', description: 'Facing and finishing for the lathe' }),
  'packages/shop-a/scripts/facing.py': scriptText('facing'),
  'packages/shop-a/scripts/finish/chamfer.py': scriptText('chamfer'),
  'packages/shop-a/profiles/shop-a-lathe.json': profileText('shop-a-lathe'),
  'packages/shop-a/codes/shop-a-codes.json': codesText('shop-a-codes'),
  'packages/shop-b/profiles/broken.json': BROKEN('shop-b-x'),
  'packages/Bad Name/package.json': json({ name: 'Never read' }),
  'profiles/broken.json': BROKEN('mine-x'),
})

/** The prefix and the rest of a message that has one placeholder, so a text can be matched without knowing the value. @param {string} text */
const around = (text) => text.split('@@')

scenario('p4g-packages', { timeout: 420, files: WORLD }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const paths = configPaths(ctx)
  const row = (/** @type {string} */ name) => h.q('package-row', { package: name })
  const inRow = (/** @type {string} */ name, /** @type {string} */ testId) => row(name)?.querySelector(`[data-testid="${testId}"]`) ?? null
  const toggle = (/** @type {string} */ name) => /** @type {HTMLInputElement | null} */ (inRow(name, 'package-toggle'))
  const scriptIds = () => h.qa('script-item').map((e) => e.dataset.scriptId ?? '')
  const captions = (/** @type {string} */ pkg) => h.qa('scripts-group', { package: pkg }).map((e) => textOf(e.querySelector('.caption')))
  const profileIds = () => ctx.profiles.list().map((p) => p.id)
  /** @param {string} id */
  const scriptEntry = (id) => /** @type {any[]} */ (read(ctx.scripts.list)).find((e) => e.id === id)

  // Scripts appear in the list of the Scripts tab.
  await ribbonTab(h, 'scripts')
  const sawScripts = await h.waitFor(() => scriptIds().includes('pkg-shop-a:facing.py'), { timeout: 20000 })
  h.check('the scripts of a package are offered on the Scripts tab, at start', !!sawScripts, scriptIds())

  // ============================================================ A. the page
  const opened = await openSettings(h, 'packages')
  await h.waitFor(() => row('shop-a'), { timeout: 8000 })
  h.check('the page shows the folder to copy a package to', textOf(h.q('packages-folder')) === `${paths.configDir}/packages`, textOf(h.q('packages-folder')))
  h.check('the page says in one plain line that a package is as trusted as a script of your own', textOf(h.q('packages-trust')) === ctx.t('packagesPage.trust'))
  const names = h.qa('package-row').map((e) => e.dataset.package)
  h.check('one row per folder, in byte order', JSON.stringify(names) === JSON.stringify(['Bad Name', 'shop-a', 'shop-b']), names)
  const shopA = textOf(row('shop-a'))
  h.check('a package is shown under the name of its package.json, with version and description', shopA.includes('Shop A') && shopA.includes(ctx.t('packagesPage.version', { version: '1.2' })) && shopA.includes('Facing and finishing for the lathe'), shopA)
  h.check('and the folder name, since it differs', shopA.includes(ctx.t('packagesPage.folderName', { name: 'shop-a' })), shopA)
  h.check('it counts two scripts, one profile and one code file', shopA.includes(ctx.t('packagesPage.counts', { scripts: 2, profiles: 1, codes: 1 })), shopA)
  h.check('it is on, and the switch can be used', row('shop-a')?.dataset.enabled === '1' && toggle('shop-a')?.checked === true && toggle('shop-a')?.disabled === false)
  h.check('a folder with no package.json is listed under its folder name and counts its profile', textOf(row('shop-b')).includes(ctx.t('packagesPage.counts', { scripts: 0, profiles: 1, codes: 0 })) && !textOf(row('shop-b')).includes(ctx.t('packagesPage.folderName', { name: 'shop-b' })), textOf(row('shop-b')))
  const [reasonHead] = around(ctx.t('packagesPage.notUsable', { reason: '@@' }))
  h.check('a folder name a package cannot have is listed with the reason, and its switch cannot be used', textOf(row('Bad Name')).includes(reasonHead) && toggle('Bad Name')?.disabled === true, textOf(row('Bad Name')))

  // ============================================================ B. the problem of a package, apart from the user's own
  const pkgLine = ctx.t('packagesPage.problemFile', { package: 'shop-b', file: 'broken.json' })
  const loadLines = h.qa('package-load-problems').flatMap((list) => [...list.querySelectorAll('li')].map((li) => textOf(li)))
  h.check('the Packages page lists the problem of the package file with the package named', loadLines.length >= 1 && loadLines.every((line) => line.startsWith('package ')) && loadLines.some((line) => line.includes(pkgLine) && line.includes('numbering.step')), loadLines)
  h.check('and none of its lines is the user’s own broken.json', loadLines.every((line) => line.includes('shop-b') || line.includes('shop-a')), loadLines)
  h.check('the profile of shop-a is among the profiles, and the one that did not load is not', profileIds().includes('shop-a-lathe') && !profileIds().includes('shop-b-x') && !profileIds().includes('mine-x'), profileIds())
  const report = /** @type {any} */ (read(ctx.results.current))
  const reportFiles = (report?.rows ?? []).map((/** @type {any} */ r) => r.file)
  h.check('the load report in the Results panel names the package for its file and not for the user’s', reportFiles.includes(pkgLine) && reportFiles.includes('broken.json'), reportFiles)
  await closeSettings(h, opened)

  const profilesPage = await openProfilesPage(h)
  const mine = profileRows(h).filter((r) => r.file === 'broken.json')
  h.check('the Profiles page has one row for broken.json, the user’s', mine.length === 1 && mine[0].origin === 'user', mine.map((r) => `${r.id}:${r.origin}`))
  h.check('with its own problem and nothing of the package’s', mine[0]?.problems >= 1 && mine[0].problemTexts.every((text) => !text.includes('shop-b')), mine[0]?.problemTexts)
  const loose = h.qa('profiles-notice').map((e) => textOf(e))
  h.check('the package’s problem is among the loose ones, told with its package', loose.some((text) => text.includes(pkgLine)), loose)
  await closeProfilesPage(h, profilesPage)

  // ============================================================ C. the Scripts menu
  await ribbonTab(h, 'scripts')
  h.check('both scripts of shop-a are offered, under ids with the package root', scriptIds().includes('pkg-shop-a:facing.py') && scriptIds().includes('pkg-shop-a:finish/chamfer.py'), scriptIds())
  h.check('they are two sections of their own, under the package’s display name', JSON.stringify(captions('shop-a').sort()) === JSON.stringify(['Shop A', 'Shop A / finish']), captions('shop-a'))
  h.check('a package script cannot be edited in place', scriptEntry('pkg-shop-a:facing.py')?.editable === false && scriptEntry('pkg-shop-a:facing.py')?.root === 'pkg-shop-a', scriptEntry('pkg-shop-a:facing.py'))

  // ============================================================ D. switching off and on, no restart
  const second = await openSettings(h, 'packages')
  await h.waitFor(() => row('shop-a'), { timeout: 8000 })
  h.click(toggle('shop-a'))
  await h.waitFor(() => row('shop-a')?.dataset.enabled === '0', { timeout: 10000 })
  await h.waitFor(() => !scriptIds().includes('pkg-shop-a:facing.py'), { timeout: 10000 })
  h.check('Off: the row says so and nothing of the package is loaded', textOf(row('shop-a')).includes(ctx.t('packagesPage.switchedOff')) && !profileIds().includes('shop-a-lathe'), textOf(row('shop-a')))
  h.check('Off: its scripts are gone from the Scripts menu without a restart', !scriptIds().some((id) => id.startsWith('pkg-shop-a:')), scriptIds())
  h.check('the status bar says it', message(h) === ctx.t('packagesPage.switchedOffStatus', { name: 'shop-a' }), message(h))
  await h.idle()
  const saved = /** @type {any} */ (await h.config.read('settings.json'))
  h.check('the setting packages.disabled lists the folder name', JSON.stringify(saved?.['packages.disabled']) === JSON.stringify(['shop-a']), saved)
  const tried = await h.attempt('script_run', { req: { runId: 'rh-p4g-off', scriptId: 'pkg-shop-a:facing.py', stdin: '', context: {}, timeoutSecs: 20 } })
  h.check('a script of a package that is off fails with "Unknown script folder"', !tried.ok && /Unknown script folder/i.test(String(tried.error)), tried)
  h.click(toggle('shop-a'))
  await h.waitFor(() => row('shop-a')?.dataset.enabled === '1', { timeout: 10000 })
  await h.waitFor(() => scriptIds().includes('pkg-shop-a:facing.py') && profileIds().includes('shop-a-lathe'), { timeout: 10000 })
  h.check('On: scripts and profile are back', scriptIds().includes('pkg-shop-a:finish/chamfer.py') && profileIds().includes('shop-a-lathe') && message(h) === ctx.t('packagesPage.switchedOn', { name: 'shop-a' }), { ids: scriptIds(), message: message(h) })
  const savedOn = /** @type {any} */ (await h.config.read('settings.json'))
  h.check('and the name is out of packages.disabled again', !(savedOn?.['packages.disabled'] ?? []).includes('shop-a'), savedOn)

  // ============================================================ E. Reload
  await h.disk.write(`${paths.configDir}/packages/shop-a/package.json`, json({ name: 'Shop A2', version: '1.3', description: 'Renamed' }))
  await h.idle()
  h.check('a changed package.json changes nothing before Reload', captions('shop-a').includes('Shop A') && !captions('shop-a').includes('Shop A2'), captions('shop-a'))
  await h.disk.write(`${paths.configDir}/packages/shop-c/scripts/extra.py`, scriptText('extra'))
  h.click(h.q('package-reload'))
  await h.waitFor(() => captions('shop-a').includes('Shop A2'), { timeout: 10000 })
  h.check('Reload changes the caption of the Scripts menu to the new display name', JSON.stringify(captions('shop-a').sort()) === JSON.stringify(['Shop A2', 'Shop A2 / finish']), captions('shop-a'))
  await h.waitFor(() => row('shop-c'), { timeout: 10000 })
  h.check('and the page shows the new version', textOf(row('shop-a')).includes(ctx.t('packagesPage.version', { version: '1.3' })), textOf(row('shop-a')))
  h.check('a folder copied in is listed with its script, under its folder name', !!row('shop-c') && scriptIds().includes('pkg-shop-c:extra.py') && captions('shop-c').includes('shop-c'), { rows: h.qa('package-row').map((e) => e.dataset.package), captions: captions('shop-c') })
  h.check('the status bar says the packages were reloaded', message(h) === ctx.t('packagesPage.reloaded'), message(h))
  await closeSettings(h, second)
  h.check('closing the dialog asked nothing', (await h.alert.visible()) === null)

  // ============================================================ F. copy to your own folder
  const [head, tail] = around(ctx.t('scripts.openPackageMessage', { script: '@@', package: 'shop-a' }))
  void ctx.commands.run('script.openSource', 'pkg-shop-a:facing.py')
  const ask = await h.alert.wait({ timeout: 10000 })
  const texts = (ask?.texts ?? []).join(' ')
  h.check('Edit Script on a package script asks the package question: its title, the package named, Copy and edit or Cancel', !!ask && texts.includes(ctx.t('scripts.openPackageTitle')) && texts.includes(head.trim()) && texts.includes(tail.trim()) && (ask.buttons ?? []).includes(ctx.t('scripts.copyButton')) && (ask.buttons ?? []).includes('Cancel'), ask)
  await h.alert.click('Cancel')
  await h.idle()
  h.check('Cancel copies nothing', (await h.disk.stat(`${paths.userScriptsDir}/facing.py`)) === null && !scriptIds().includes('user:facing.py'))
  void ctx.commands.run('script.openSource', 'pkg-shop-a:facing.py')
  await h.alert.wait({ timeout: 10000 })
  await h.alert.click(ctx.t('scripts.copyButton'))
  await h.waitFor(async () => (await h.disk.stat(`${paths.userScriptsDir}/facing.py`)) !== null, { timeout: 10000 })
  await h.waitFor(() => scriptEntry('user:facing.py') && scriptEntry('pkg-shop-a:facing.py')?.shadowed === true, { timeout: 10000 })
  h.check('Copy and edit puts the copy into your scripts folder', (await h.disk.read(`${paths.userScriptsDir}/facing.py`)) === (await h.disk.read(`${paths.configDir}/packages/shop-a/scripts/facing.py`)))
  h.check('opens it as a document', !!ctx.docs.byPath(`${paths.userScriptsDir}/facing.py`), ctx.docs.all().map((d) => d.title))
  h.check('the copy shadows the package’s script, which stays listed', scriptEntry('user:facing.py')?.editable === true && scriptEntry('pkg-shop-a:facing.py')?.shadowed === true, { user: scriptEntry('user:facing.py'), pkg: scriptEntry('pkg-shop-a:facing.py') })
})
