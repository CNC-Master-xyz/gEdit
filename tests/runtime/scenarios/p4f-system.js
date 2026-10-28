// P4f, files from the system (plan `docs/planning/phase-4-implementation.md` §6.8.1 item 4 and §6.8.2 S7; P4.29; AD-54): a program the
// user double-clicks in the file browser, or opens with "Open With", opens in the running gEdit; what the system hands over that is not
// a file gEdit may open is skipped and the user is told once. One scenario.
//
// **What this proves and what it cannot.** The harness cannot start a second gEdit process, and on macOS there is none to start: the system
// keeps one instance of a bundled app and tells it with `RunEvent::Opened` (the single-instance plugin is not registered there, AD-54). So the
// hand-over is made by a harness command, `h_open_request` (`tests/runtime/harness/harness.rs`), that calls the functions the real hand-over
// calls: on macOS `open_requests::opened` with file URLs, on Windows and Linux `open_requests::second_instance` with the arguments of a second
// start. Everything after the system's call is the real thing: the argument checks of S7 (options, URLs of other schemes, a folder, a missing
// file, the app's own `state.json`, at most 32 paths), the grant of each file, the event `gedit-open-requests`, the page's listener, the opening
// by `files.open` and the one status line for what was skipped. What is **not** proven here: that the operating system calls the app at all (the
// bundle's `fileAssociations` are held by `tests/unit/p4fSecurity.test.ts`; the double-click on Windows and Linux is a manual check, plan §10
// "P4f"), and the window being brought to the front.
//
//   A. one file        the file opens as the active tab without a file dialog; the same file handed over again (twice in one list, and in a
//                      second call) is not a second tab.
//   B. refused         two good files with four things that are not: a URL of another scheme (an argument that is not a path on Windows and
//                      Linux), a folder, a missing file and `state.json`. The two files open; the status bar says once, as an error, that 4
//                      things were skipped.
//   C. relative        (Windows and Linux only) a relative path is joined to the working folder of the second start.
//   D. more than 32    33 files: the first 32 open and the status bar says that 1 thing was skipped.

import { scenario } from '../lib/index.js'
import { context, fileUrl, guard, message, messageIsError, onMac, ready, under, writeAll } from './p4f-common.js'

scenario('p4f-system', { timeout: 300 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const dir = under(h, 'sys')
  const mac = onMac()
  /** One argument as the system spells it on this platform. @param {string} path */
  const arg = (path) => (mac ? fileUrl(path) : path)
  /** Hands the app these arguments; answers which hand-over ran. @param {string[]} args @param {string | null} [cwd] */
  const handOver = (args, cwd = null) => h.invoke('h_open_request', { args, cwd })
  const opened = (/** @type {string} */ path) => ctx.docs.byPath(path) ?? undefined
  const dialogsOpened = () => h.dialogs.calls().filter((c) => c.kind === 'open').length

  const A = `${dir}/a.nc`
  const B = `${dir}/b.nc`
  const C = `${dir}/c.nc`
  const many = Array.from({ length: 33 }, (_, i) => `${dir}/many/n${String(i + 1).padStart(2, '0')}.nc`)
  await writeAll(h, dir, {
    'a.nc': 'G0 X1\nM30\n',
    'b.nc': 'G0 X2\nM30\n',
    'c.nc': 'G0 X3\nM30\n',
    'rel.nc': 'G0 X4\nM30\n',
    'folder/inside.nc': 'M30\n',
    ...Object.fromEntries(many.map((p, i) => [p.slice(dir.length + 1), `G0 X${i}\nM30\n`])),
  })

  await guard(h, 'A. one file', async () => {
    const dialogs = dialogsOpened()
    const kind = await handOver([arg(A)])
    h.check(`this system hands files over as ${mac ? '"opened" (RunEvent::Opened, file URLs)' : '"second-instance" (the arguments of a second start)'}`, kind === (mac ? 'opened' : 'second-instance'), kind)
    await h.waitFor(() => opened(A) && ctx.docs.getActiveId() === opened(A)?.id, { timeout: 20000 })
    const doc = opened(A)
    h.check('the file is open as the active tab, with the text of the file, not changed', !!doc && ctx.docs.getActiveId() === doc.id && ctx.editor.getLines(doc.id, 1, 1)[0] === 'G0 X1' && doc.dirty !== true, doc?.title)
    h.check('nobody asked for it: no file dialog was shown', dialogsOpened() === dialogs, h.dialogs.calls())
    const tabs = ctx.docs.all().length
    await handOver([arg(A), arg(A)])
    await handOver([arg(A)])
    await h.turns(10)
    await h.idle()
    h.check('the same file handed over twice in one list and again later is the tab it already is: no second tab', ctx.docs.all().length === tabs && ctx.docs.getActiveId() === doc?.id, { tabs: ctx.docs.all().length, was: tabs })
  })

  await guard(h, 'B. what is not a file gEdit may open is skipped and said once', async () => {
    const recovery = await h.recoveryDir()
    const stateFile = `${recovery.slice(0, recovery.lastIndexOf('/'))}/state.json`
    const refused = [
      'https://example.com/not-a-file.nc',
      arg(`${dir}/folder`),
      arg(`${dir}/does-not-exist.nc`),
      arg(stateFile),
    ]
    await handOver([arg(B), ...refused, arg(C)])
    await h.waitFor(() => opened(B) && opened(C), { timeout: 20000 })
    h.check('the two good files open (in the order they were handed over), and nothing else does: not the folder, not the missing file, not the app\'s own state file', !!opened(B) && !!opened(C) && !opened(`${dir}/folder`) && !opened(stateFile) && !opened(`${dir}/does-not-exist.nc`), ctx.docs.all().map((d) => d.title))
    const wanted = ctx.t('openRequests.refused', { count: 4 })
    await h.waitFor(() => message(h) === wanted, { timeout: 15000 })
    h.check('the status bar tells once, as an error, that 4 things the system asked for were skipped', message(h) === wanted && messageIsError(h), message(h))
    h.check('no dialog came up for any of them', h.dialogs.calls().every((c) => c.kind !== 'message'), h.dialogs.calls())
  })

  await guard(h, 'C. a relative path (Windows and Linux)', async () => {
    if (mac) {
      h.log('p4f-system C: a relative path is an argument of a second start; macOS hands over URLs only (not simulated here)')
      return
    }
    await handOver(['rel.nc'], dir)
    await h.waitFor(() => opened(`${dir}/rel.nc`), { timeout: 20000 })
    h.check('a relative file name is joined to the working folder of the second start', !!opened(`${dir}/rel.nc`))
  })

  await guard(h, 'D. at most 32 paths in one hand-over', async () => {
    await handOver(many.map(arg))
    await h.waitFor(() => many.slice(0, 32).every((p) => opened(p)), { timeout: 60000 })
    const wanted = ctx.t('openRequests.refused', { count: 1 })
    await h.waitFor(() => message(h) === wanted, { timeout: 30000 })
    h.check('the first 32 of 33 files open, the 33rd does not', many.slice(0, 32).every((p) => !!opened(p)) && !opened(many[32]), ctx.docs.all().length)
    h.check('and the status bar says that 1 thing was skipped', message(h) === wanted && messageIsError(h), message(h))
  })
})
