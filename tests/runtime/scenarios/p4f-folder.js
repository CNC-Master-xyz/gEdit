// P4f, Find in Folder (plan `docs/planning/phase-4-implementation.md` §6.8.1 items 1 and 2, §6.8.2 S2 to S6 and §6.8.3; P4.27 and
// P4.28; the owner's rule of 2026-10-27 that a row opens only while its search is the last one): the real walk of a real folder tree,
// the Results rows that open their file, and the guards around them. Four scenarios, independent of each other:
//
//   p4f-folder        the tree (`ftree`, built here): a text query over five files at four levels; what was not read is said and counted
//                     (a binary file, a file over 16 MB named, two links, two hidden entries, a folder below the 16th level); the name
//                     pattern and the date window; a search with no query lists the files. A click on a row grants that one file and
//                     opens it at the hit line; a row of a file that is already open reveals without asking Rust again; after a new
//                     search a row of the old one says in plain words that it is from an earlier search, and asks nothing of Rust.
//   p4f-folder-stop   1,500 files: Stop in the status bar ends the search, the rows found so far stay and the report says it was
//                     stopped; the next search runs at once (the slot is free) and lists every file.
//   p4f-folder-regex  a regular expression that runs away is stopped in the background reader on the second file (the hits before it
//                     stay, the file is named), the editor keeps answering and the next search works; a pattern that does not compile
//                     is refused in the form and starts no search.
//   p4f-folder-busy   Rust allows one search at a time: of two started together one is refused with the plain sentence; the refused one
//                     does not take the winner's files out of the set `folder_grant` opens, and does not put its own into it.
//
// **Expected rows and counts are worked out from the files written here** (every file's text is in the scenario), the sentences are
// `ctx.t(...)`, the order of the notes is the one of `core/folders/rows.ts` (binary, too large, links, hidden, too deep). Rows are compared
// sorted: the walk's order inside a folder is Rust's (tested there), what is proven here is which files and lines. Links are made with
// `h.disk.symlink`, so the scenario is macOS and Linux (as `h_symlink` is).

import { Channel } from '@tauri-apps/api/core'
import { scenario } from '../lib/index.js'
import {
  b64,
  context,
  filesOf,
  findInFolder,
  fillForm,
  FOLDER_FORM,
  guard,
  hitsOf,
  message,
  messageIsError,
  ready,
  report,
  sameJson,
  startFolderSearch,
  under,
  waitFolderReport,
  writeAll,
} from './p4f-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

/** The deep chain: `d1/d2/.../d<n>`. @param {number} n */
const chain = (n) => Array.from({ length: n }, (_, i) => `d${i + 1}`).join('/')

/** 17,825,793 bytes of `A` (3 x 5,941,931): one byte more than 17 MiB, over the 16 MiB limit. */
const BIG = { base64: 'QUFB'.repeat(5941931) }

scenario('p4f-folder', { timeout: 420 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const root = under(h, 'ftree')
  const ipcCount = (/** @type {string} */ cmd) => h.rec.ipc.calls[cmd] ?? 0

  // ------------------------------------------------------------ the tree
  const A = ['(PROGRAM A)', 'G90 G54', 'T17 M6', 'G1 X10. F200. (HITME A4)', 'M30']
  await writeAll(h, root, {
    'a-main.nc': `${A.join('\n')}\n`,
    'b-second.nc': 'G0 X0\n(HITME B2)\nM30\n',
    'sub/inner.mpf': ';HITME in a comment\nG1 X1 F100\n',
    'sub/deeper/c.nc': 'G0 X5\nG1 Z-1 F50\nM8\n(HITME C4)\nM30\n',
    [`${chain(16)}/deep.nc`]: '(HITME DEEP)\nM30\n',
    [`${chain(17)}/toodeep.nc`]: '(HITME TOO DEEP)\nM30\n',
    '.hidden.nc': '(HITME HIDDEN)\n',
    '.hiddendir/x.nc': '(HITME IN HIDDEN FOLDER)\n',
    'notes.txt': 'HITME in a note\n',
    'bin.nc': { base64: b64([0, 72, 73, 84, 77, 69, 10]) },
    'big.nc': BIG,
  })
  await h.disk.symlink(`${root}/a-main.nc`, `${root}/link-to-a.nc`)
  await h.disk.symlink(`${root}/sub`, `${root}/link-dir`)
  // An old file, for the date window: 2020-06-15 12:00 UTC.
  await h.disk.touch(`${root}/a-main.nc`, 1592222400)

  const EXPECTED_HITS = ['a-main.nc:4', 'b-second.nc:2', `${chain(16)}/deep.nc:1`, 'sub/deeper/c.nc:4', 'sub/inner.mpf:1'].sort()

  /** @type {any} */
  let first = null

  await guard(h, 'A. a text query over the tree', async () => {
    first = await findInFolder(h, root, { query: 'HITME' })
    h.check('five hits in five files at four levels: the comment hits of a, b, c, the chain below 16 levels and the Siemens comment; none in a hidden file or folder, a link, a binary file, the 17 MB file, the folder at the 17th level or notes.txt (not a name that fits)', sameJson(hitsOf(first), EXPECTED_HITS), hitsOf(first))
    h.check('the title counts them and names the folder', first.title === ctx.t('findInFolder.title', { count: 5, query: 'HITME', folder: 'ftree' }), first.title)
    h.check('the columns are the file below the folder, the line, the text and the date', sameJson(first.columns.map((/** @type {any} */ c) => c.key), ['file', 'line', 'text', 'modified']), first.columns)
    const hit = first.rows.find((/** @type {any} */ r) => r.file === 'a-main.nc')
    h.check('a row holds the line as the file writes it, trimmed, and the local date of the file', hit?.line === 4 && hit?.text === 'G1 X10. F200. (HITME A4)' && /^2020-06-1[56] \d\d:\d\d$/.test(hit?.modified ?? ''), hit)
    const notes = [
      ctx.t('findInFolder.skipBinary', { count: 1 }),
      ctx.t('findInFolder.skipTooLarge', { count: 1, mb: 16, names: 'big.nc' }),
      ctx.t('findInFolder.skipLinks', { count: 2 }),
      ctx.t('findInFolder.skipHidden', { count: 2 }),
      ctx.t('findInFolder.skipTooDeep', { count: 1, levels: 16 }),
    ]
    h.check('the message says what was not read, in the panel\'s order: 1 binary file, big.nc over 16 MB by name, 2 links not followed, 2 hidden entries, 1 folder deeper than 16 levels; nothing else', first.message === notes.join(' '), { message: first.message, wanted: notes.join(' ') })
    await h.waitFor(() => h.qa('results-row').length === 5, { timeout: 8000 })
    const rowPaths = h.qa('results-row').map((e) => e.dataset.path ?? '')
    h.check('the Results panel shows the five rows, each with the absolute path of its file and the folder it was found in (data-path, data-root)', rowPaths.length === 5 && rowPaths.every((p) => p.startsWith('/')) && h.qa('results-row').every((e) => (e.dataset.root ?? '') !== ''), rowPaths)
    h.check('and the search left the page answering: the status bar counts the rows', message(h) === ctx.t('findInFolder.found', { count: 5 }), message(h))
  })

  await guard(h, 'B. a row opens its file; a file that is open is revealed without a second grant', async () => {
    if (first === null) throw new Error('no first report')
    const rowOf = (/** @type {string} */ rel) => h.qa('results-row').find((e) => (e.dataset.path ?? '').endsWith(`/${rel}`))
    const path = `${root}/a-main.nc`
    h.check('before the click the file is not open', ctx.docs.byPath(path) === undefined || ctx.docs.byPath(path) === null)
    const grants = ipcCount('folder_grant')
    h.click(rowOf('a-main.nc'))
    await h.waitFor(() => ctx.docs.byPath(path) && ctx.docs.getActiveId() === ctx.docs.byPath(path)?.id && h.app.cursor().line === 4, { timeout: 15000 })
    const doc = ctx.docs.byPath(path)
    h.check('a click grants the one file, opens it as the active tab and puts the cursor on the hit line (4)', !!doc && ctx.docs.getActiveId() === doc.id && h.app.cursor().line === 4 && ipcCount('folder_grant') === grants + 1, { cursor: h.app.cursor(), grants: ipcCount('folder_grant') - grants })
    h.check('the file is the one on disk, unchanged', !!doc && doc.dirty !== true && ctx.editor.getLines(doc.id, 4, 4)[0] === 'G1 X10. F200. (HITME A4)')
    ctx.editor.reveal(doc?.id ?? '', 1, 1)
    await h.waitFor(() => h.app.cursor().line === 1, { timeout: 5000 })
    const tabs = ctx.docs.all().length
    h.click(rowOf('a-main.nc'))
    await h.waitFor(() => h.app.cursor().line === 4, { timeout: 8000 })
    h.check('a second click on the row of the open file reveals the line again: no second tab and no second grant', h.app.cursor().line === 4 && ctx.docs.all().length === tabs && ipcCount('folder_grant') === grants + 1, { tabs: ctx.docs.all().length, grants: ipcCount('folder_grant') - grants })
    const inner = `${root}/sub/inner.mpf`
    h.click(rowOf('sub/inner.mpf'))
    await h.waitFor(() => ctx.docs.byPath(inner), { timeout: 15000 })
    h.check('a row of a file in a subfolder opens it too, and is a tab of its own', !!ctx.docs.byPath(inner) && ctx.docs.all().length === tabs + 1, ctx.docs.all().map((d) => d.title))
  })

  await guard(h, 'C. after a new search an old row says it is from an earlier search', async () => {
    if (first === null) throw new Error('no first report')
    const oldRow = first.rows.find((/** @type {any} */ r) => r.file === 'b-second.nc')
    const bPath = `${root}/b-second.nc`
    const second = await findInFolder(h, root, { query: 'G0' })
    h.check('a second search (the text G0) finds it in b-second.nc line 1 and in sub/deeper/c.nc line 1', hitsOf(second).includes('b-second.nc:1') && hitsOf(second).includes('sub/deeper/c.nc:1'), hitsOf(second))
    const grants = ipcCount('folder_grant')
    await first.openRow(oldRow)
    h.check('the old report\'s row is not opened: the status bar says, as an error, that the file is from an earlier search and to search the folder again', messageIsError(h) && message(h) === ctx.t('findInFolder.olderSearch', { file: 'b-second.nc' }), { status: message(h) })
    h.check('and Rust was not asked, no tab was made', ipcCount('folder_grant') === grants && !ctx.docs.byPath(bPath), { grants: ipcCount('folder_grant') - grants })
    await h.waitFor(() => h.qa('results-row').length === second.rows.length, { timeout: 8000 })
    const fresh = h.qa('results-row').find((e) => (e.dataset.path ?? '').endsWith('/b-second.nc'))
    h.click(fresh)
    await h.waitFor(() => ctx.docs.byPath(bPath), { timeout: 15000 })
    h.check('a row of the newest search opens as before', !!ctx.docs.byPath(bPath) && ipcCount('folder_grant') === grants + 1)
  })

  await guard(h, 'D. the name pattern, the date window and a search with no query', async () => {
    const mpf = await findInFolder(h, root, { names: '*.mpf', query: '' })
    h.check('no query: one row per file that fits the name, with the date and no line; *.mpf is sub/inner.mpf only', sameJson(filesOf(mpf), ['sub/inner.mpf']) && mpf.rows.every((/** @type {any} */ r) => r.line === undefined) && sameJson(mpf.columns.map((/** @type {any} */ c) => c.key), ['file', 'modified']), { files: filesOf(mpf), columns: mpf.columns })
    h.check('and its title counts files', mpf.title === ctx.t('findInFolder.titleFiles', { count: 1, folder: 'ftree' }), mpf.title)
    const old = await findInFolder(h, root, { names: '*.nc', modifiedTo: '2021-01-01' })
    h.check('changed up to 2021-01-01: the one file that was set to 2020 (a-main.nc), though every other file fits the name', sameJson(filesOf(old), ['a-main.nc']), filesOf(old))
    const recent = await findInFolder(h, root, { names: '*.nc', modifiedFrom: '2021-01-01' })
    h.check('changed from 2021-01-01: not a-main.nc, but the others that fit (b-second.nc and the files below), the 17 MB one named in the message, the binary one counted', !filesOf(recent).includes('a-main.nc') && filesOf(recent).includes('b-second.nc') && filesOf(recent).includes('sub/deeper/c.nc'), filesOf(recent))
    const flat = await findInFolder(h, root, { names: '*.nc', recursive: false, query: '' })
    h.check('without the subfolders: only the .nc files of the folder itself (a-main, b-second, and not sub/ or the chain)', sameJson(filesOf(flat), ['a-main.nc', 'b-second.nc']), filesOf(flat))
    const upper = await findInFolder(h, root, { names: '*.NC', query: 'hitme', caseSensitive: false })
    h.check('names and queries are not case sensitive by default: *.NC and hitme find the four hits of the .nc files (not the .mpf one)', sameJson(hitsOf(upper), EXPECTED_HITS.filter((hit) => !hit.startsWith('sub/inner.mpf'))), hitsOf(upper))
    const exact = await findInFolder(h, root, { names: '*.nc; *.mpf', query: 'hitme', caseSensitive: true })
    h.check('with Case sensitive on, hitme does not match HITME: no hit, and the title says so', exact.rows.length === 0 && exact.title === ctx.t('findInFolder.titleNone', { query: 'hitme', folder: 'ftree' }), exact.title)
    const word = await findInFolder(h, root, { names: '*.nc', query: 'T17', wholeAddress: true, inComments: false })
    h.check('Whole address finds the tool word T17 as the dialect reads it: a-main.nc line 3 only (the T of a comment is not one)', sameJson(hitsOf(word), ['a-main.nc:3']), hitsOf(word))
  })
})

scenario('p4f-folder-stop', { timeout: 420 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const root = under(h, 'many')
  // 150 folders of 10 files by copying one: 1,500 files of three lines each.
  const seed = Object.fromEntries(Array.from({ length: 10 }, (_, j) => [`s0/f${j}.nc`, `G0 X${j}\nG1 X${j + 1} F100\nG2 X${j + 2} I1\n`]))
  await writeAll(h, root, seed)
  for (let i = 1; i < 150; i += 25) {
    await Promise.all(Array.from({ length: Math.min(25, 150 - i) }, (_, k) => h.disk.copy(`${root}/s0`, `${root}/s${i + k}`)))
  }
  h.check('the tree has 150 folders', (await h.disk.list(root)).length === 150)

  await guard(h, 'A. Stop ends the search; the rows found so far stay', async () => {
    const before = await startFolderSearch(h, root, { names: '*.nc', query: 'G[0-9]+', regex: true })
    const stop = await h.waitFor(() => h.q('status-message-action'), { timeout: 20000 })
    h.check('while it runs the status bar offers Stop', !!stop && (stop?.textContent ?? '').trim() === ctx.t('findInFolder.stop'), stop?.textContent)
    h.click(stop)
    const r = await waitFolderReport(h, before)
    const n = r.rows.length
    h.check('the report says it was stopped by the user, and the list shows what was found until then', (r.message ?? '').includes(ctx.t('findInFolder.stoppedUser')), r.message)
    h.check('and counts "at least" that many: fewer than the 4,500 hits all the files hold', n < 4500 && r.title === ctx.t(n === 0 ? 'findInFolder.titleAtLeastNone' : 'findInFolder.titleAtLeast', { count: n, query: 'G[0-9]+', folder: 'many' }), { rows: n, title: r.title })
  })

  await guard(h, 'B. the next search runs at once and lists every file', async () => {
    const r = await findInFolder(h, root, { names: '*.nc', query: '' })
    h.check('the walk is free again: a search with no query lists all 1,500 files, with no note of a stop', r.rows.length === 1500 && !r.message && r.title === ctx.t('findInFolder.titleFiles', { count: 1500, folder: 'many' }), { rows: r.rows.length, message: r.message, title: r.title })
  })
})

scenario('p4f-folder-regex', { timeout: 240 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const root = under(h, 'rx')
  await writeAll(h, root, {
    'a-ok.nc': '(x)\nxxy\nM30\n',
    'b-quick.nc': 'G0\nM30\n',
    // V8 (Windows, WebView2) runs away on the first of these lines. WebKit (macOS, Linux) does not: it ends a match
    // after about 100 million steps (about half a second here) and answers "no match", so one line is never slow
    // enough for the guard's 2 s budget. Sixteen lines are: the pattern runs away on each engine, and the guard
    // stops it on each.
    'z-slow.nc': `G0\n${`${'x'.repeat(40)}!\n`.repeat(16)}M30\n`,
  })
  const ipcCount = (/** @type {string} */ cmd) => h.rec.ipc.calls[cmd] ?? 0

  await guard(h, 'A. a pattern that runs away is stopped on the file it ran away on', async () => {
    const started = Date.now()
    const r = await findInFolder(h, root, { names: '*.nc', query: '(x+x+)+y', regex: true })
    const seconds = (Date.now() - started) / 1000
    h.check('the hit before the slow file stays (a-ok.nc line 2); nothing from z-slow.nc', sameJson(hitsOf(r), ['a-ok.nc:2']), hitsOf(r))
    h.check('the report names the file the expression took too long on, and says nothing else was skipped', r.message === ctx.t('findInFolder.stoppedSlow', { file: 'z-slow.nc' }), r.message)
    h.check('and counts "at least"', r.title === ctx.t('findInFolder.titleAtLeast', { count: 1, query: '(x+x+)+y', folder: 'rx' }), r.title)
    h.check('the stop came from the guard (a budget of seconds), not from a hung page', seconds < 90, seconds)
  })

  await guard(h, 'B. the page keeps answering and the next search works', async () => {
    const r = await findInFolder(h, root, { names: '*.nc', query: 'xxy', regex: false })
    h.check('a plain text search of the same folder finds a-ok.nc line 2 and z-slow.nc has none: the guard\'s worker did not leave the reader stuck', sameJson(hitsOf(r), ['a-ok.nc:2']) && !r.message, { hits: hitsOf(r), message: r.message })
  })

  await guard(h, 'C. a pattern that does not compile is refused in the form', async () => {
    const reportBefore = report(h)
    const searches = ipcCount('folder_search')
    await h.dialogs.queue('folder', root)
    const running = ctx.commands.run('search.findInFolder')
    if (!(await h.waitFor(() => h.q('modal'), { timeout: 15000 }))) throw new Error('no form')
    fillForm(h, { ...FOLDER_FORM, names: '*.nc', query: '(', regex: true })
    await h.frame()
    h.click(h.q('modal-ok'))
    await h.waitFor(() => messageIsError(h), { timeout: 8000 })
    h.check('the status bar says, as an error, that the expression is not valid, and the form is shown again with the answers', messageIsError(h) && !!h.q('modal') && h.q('form-field', { field: 'query' }) !== null, { status: message(h) })
    h.click(h.q('modal-cancel'))
    await h.waitFor(() => !h.q('modal'), { timeout: 8000 })
    await running
    h.check('cancelled: no search was started and the old report is still there', ipcCount('folder_search') === searches && report(h) === reportBefore, { searches: ipcCount('folder_search') - searches })
  })
})

scenario('p4f-folder-busy', { timeout: 300 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const rootOf = (/** @type {string} */ n) => under(h, `busy/${n}`)
  // Two folders of 2,000 files each (200 folders of 10 files, made by copying one).
  const seedFor = (/** @type {string} */ tag) => Object.fromEntries(Array.from({ length: 10 }, (_, j) => [`g0/f${j}.nc`, `(${tag} ${j})\n${'G1 X1. Y2. Z3. F100.\n'.repeat(20)}`]))
  for (const name of ['w1', 'w2']) {
    await writeAll(h, rootOf(name), seedFor(name))
    for (let i = 1; i < 200; i += 25) {
      await Promise.all(Array.from({ length: Math.min(25, 200 - i) }, (_, k) => h.disk.copy(`${rootOf(name)}/g0`, `${rootOf(name)}/g${i + k}`)))
    }
    await h.dialogs.queue('folder', rootOf(name))
    await ctx.dialogs.pickFolder({ title: 'busy' })
  }

  /** One `folder_search` straight to Rust, with the files it sends noted. @param {string} id @param {string} root */
  const search = (id, root) => {
    /** @type {string[]} */
    const sent = []
    /** @type {Channel<any>} */
    const channel = new Channel()
    channel.onmessage = (m) => {
      if (m && !(m instanceof ArrayBuffer) && m.kind === 'file') sent.push(String(m.path))
    }
    const req = { id, root, recursive: true, namePatterns: ['*.nc'], modifiedAfter: null, modifiedBefore: null, contains: null }
    return { sent, done: h.attempt('folder_search', { req, onEvent: channel }) }
  }

  await guard(h, 'A. one search at a time', async () => {
    const a = search('busy-a', rootOf('w1'))
    const b = search('busy-b', rootOf('w2'))
    const [ra, rb] = await Promise.all([a.done, b.done])
    const ok = [ra, rb].filter((r) => r.ok)
    const refused = [ra, rb].filter((r) => !r.ok)
    h.check('of two searches started together exactly one ran to its end and one was refused', ok.length === 1 && refused.length === 1, { a: ra.ok, b: rb.ok })
    h.check('the refusal is the plain sentence: another search is already running (Rust\'s fixed text, never an operating-system error)', /** @type {any} */ (refused[0])?.error === 'another search is already running', refused[0])
    const winner = ra.ok ? { ...a, root: rootOf('w1') } : { ...b, root: rootOf('w2') }
    const loser = ra.ok ? { ...b, root: rootOf('w2') } : { ...a, root: rootOf('w1') }
    h.check('the search that ran counted all its 2,000 files and was not stopped', /** @type {any} */ (ok[0])?.value?.filesSent === 2000 && /** @type {any} */ (ok[0])?.value?.stoppedBy === null, ok[0])
    await h.waitFor(() => winner.sent.length === 2000, { timeout: 20000 })
    h.check('and its channel carried 2,000 files; the refused one sent none', winner.sent.length === 2000 && loser.sent.length === 0, { winner: winner.sent.length, loser: loser.sent.length })

    const granted = await h.attempt('folder_grant', { root: winner.root, path: winner.sent[0] })
    h.check('a file the running search sent can still be granted after the refusal: a refused request does not take the files out of the set', granted.ok === true, granted)
    const notSent = await h.attempt('folder_grant', { root: loser.root, path: `${loser.root}/g0/f0.nc` })
    h.check('a file of the refused search\'s folder cannot: it was never sent, and the sentence says to search the folder again', notSent.ok === false && /** @type {any} */ (notSent).error === 'this file was not in the last search; search the folder again to open it', notSent)
    const again = await search('busy-c', loser.root).done
    h.check('when the first search is over the walk is free again: the next request runs', again.ok === true, again)
  })
})
