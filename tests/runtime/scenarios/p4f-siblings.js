// P4f, how a program finds its channel and its other channels' files (plan `docs/planning/phase-4-implementation.md` §6.8.5; P4.30b and the review fixes B and C):
// the Siemens job list (J1 to J7) and the path-1 file name (`firstFileName`, T055) of the Fanuc presets. Two scenarios; the status item of the channel
// (`status-item`, `data-item="channel"`) is what a user reads, so it is what is read here.
//
//   p4f-joblist   a machine with one file per channel and no file-name rule (`sinumerik-2channel`): `SHAFT.MPF` is channel 2 because the open job list `JOBS.JOB`
//                 says `SELECT SHAFT.MPF CH=2`; the subprogram `SHAFT.SPF` of the same name is not (SELECT selects a main program, NC-10); with the job list
//                 closed the program is "not set" again (gEdit reads no job list the user did not open, J1) and the status bar says once that the folder has
//                 one; a job list in another folder says nothing about this folder's programs.
//   p4f-siblings  the Fanuc presets with the path-1 file written without an extension (NC-7, 30i-B p.1424): `O0001.P-2` finds `O0001` as path 1 (before, the
//                 name `O0001.P-1` was looked for and "Path 1 not found" said); `O0001` itself is channel 1 of the set; with both `O0001` and `O0001.P-1` in the
//                 folder nothing is guessed and the item says which two could be path 1 (the user opens the right one); and the three-path preset's own sets
//                 (`threepath.NC1`, `.NC2`, `.NC3` of `tests/fixtures/p4e/channels/`) are found as before, path 1 by its extension `NC1`, not by the new pattern (the re-check
//                 of `p4-channels` after fix C: that scenario's expectations did not change).
//
// Sentences come from `ctx.t(...)`; a name or a machine's channel name is data and is typed here.

import { scenario } from '../lib/index.js'
import { activate, addMachine, channelState, context, guard, openAs, presetBlock, ready, setDefault, under, waitChannel, watchMessages, writeAll } from './p4f-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

scenario('p4f-joblist', { timeout: 240 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const dir = under(h, 'job')
  const other = under(h, 'job2')
  await writeAll(h, dir, {
    'SHAFT.MPF': '; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE\nG1 X10 F0.2\nM30\n',
    'SHAFT.SPF': '; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE\nG1 X20 F0.2\nM17\n',
    'JOBS.JOB': '; WRITTEN FOR GEDIT - SYNTHETIC JOB LIST, NOT FOR A MACHINE\nSELECT SHAFT.MPF CH=2\n',
  })
  await writeAll(h, other, { 'JOBS.JOB': '; WRITTEN FOR GEDIT - SYNTHETIC JOB LIST, NOT FOR A MACHINE\nSELECT SHAFT.MPF CH=1\n' })
  const machine = await addMachine(h, { name: 'Siemens pair', profile: 'sinumerik', channels: presetBlock(h, 'sinumerik', 'sinumerik-2channel') })
  await setDefault(h, 'sinumerik', machine)
  const notSet = ctx.t('channels.status.unassigned')
  /** @type {Record<string, string>} */
  const doc = {}

  await guard(h, 'A. no job list open: the program has no channel and the status bar says the folder has one', async () => {
    const watch = watchMessages(h)
    doc.mpf = await openAs(h, `${dir}/SHAFT.MPF`, 'sinumerik')
    const s = await waitChannel(h, (x) => x.present && x.text === notSet, 10000)
    h.check('SHAFT.MPF: "Channel: not set" (the file name says nothing, no job list is open)', s.text === notSet && s.id === '' && s.layout === 'multi-file', s)
    await h.waitFor(() => watch.seen.includes(ctx.t('channelFiles.jobListInFolder')), { timeout: 10000 })
    watch.stop()
    h.check('and the status bar told once that this folder has a job list to open (names only, nothing is read)', watch.seen.filter((m) => m === ctx.t('channelFiles.jobListInFolder')).length === 1, watch.seen)
  })

  await guard(h, 'B. the open job list gives the channel to the main program, not to the subprogram of the same name', async () => {
    doc.job = await openAs(h, `${dir}/JOBS.JOB`, ctx.profiles.defaultId())
    await activate(h, doc.mpf)
    const s = await waitChannel(h, (x) => x.present && x.id === '2', 15000)
    h.check('SELECT SHAFT.MPF CH=2 makes SHAFT.MPF channel 2 of 2 (one file per channel; the other is not open)', s.id === '2' && s.count === '2' && s.layout === 'multi-file' && s.open === '2', s)
    h.check('and the tooltip counts it among the files of the set that are known', s.title.length > 0, s.title)
    doc.spf = await openAs(h, `${dir}/SHAFT.SPF`, 'sinumerik')
    const sub = await waitChannel(h, (x) => x.present && x.text === notSet, 15000)
    h.check('SHAFT.SPF has the same name but is a subprogram: the job list does not make it channel 2; it is "not set"', sub.id === '' && sub.text === notSet, sub)
    await activate(h, doc.mpf)
    const again = await waitChannel(h, (x) => x.present && x.id === '2', 8000)
    h.check('and SHAFT.MPF is still channel 2', again.id === '2', again)
  })

  await guard(h, 'C. a job list in another folder says nothing about this folder', async () => {
    doc.other = await openAs(h, `${other}/JOBS.JOB`, ctx.profiles.defaultId())
    await activate(h, doc.mpf)
    await h.idle()
    const s = await waitChannel(h, (x) => x.present && x.id === '2', 8000)
    h.check('JOBS.JOB of job2 (SELECT SHAFT.MPF CH=1) is not read for the programs of job/: SHAFT.MPF stays channel 2', s.id === '2', s)
  })

  await guard(h, 'D. closing the job list takes the channel away', async () => {
    await activate(h, doc.job)
    await ctx.commands.run('file.close')
    await h.waitFor(() => !ctx.docs.get(doc.job), { timeout: 8000 })
    await activate(h, doc.mpf)
    const s = await waitChannel(h, (x) => x.present && x.text === notSet, 15000)
    h.check('with the job list of its folder closed SHAFT.MPF is "not set" again: the job list is read from the open document only', s.id === '' && s.text === notSet, s)
  })
})

scenario('p4f-siblings', { timeout: 300 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const one = under(h, 'sib1')
  const two = under(h, 'sib2')
  const program = (/** @type {string} */ path) => `O0001 (${path})\n(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)\nG0 X1.\nM30\n`
  await writeAll(h, one, { O0001: program('PATH 1'), 'O0001.P-2': program('PATH 2') })
  await writeAll(h, two, { O0002: program('PATH 1'), 'O0002.P-1': program('PATH 1 WITH AN EXTENSION'), 'O0002.P-2': program('PATH 2') })
  const pair = await addMachine(h, { name: 'Two paths', channels: presetBlock(h, 'fanuc-lathe', 'fanuc-2path-digits') })
  const three = await addMachine(h, { name: 'Three paths', channels: presetBlock(h, 'fanuc-lathe', 'fanuc-3path-digits') })
  await setDefault(h, 'fanuc-lathe', pair)
  const notOpen = (/** @type {string} */ name) => ctx.t('channels.status.notOpen', { name })

  await guard(h, 'A. path 2 finds the path-1 file that has no extension', async () => {
    const p2 = await openAs(h, `${one}/O0001.P-2`, 'fanuc-lathe')
    const early = await waitChannel(h, (s) => s.present && s.id === '2', 10000)
    h.check('O0001.P-2 is path 2 of 2', early.id === '2' && early.count === '2' && early.layout === 'multi-file', early)
    await h.waitFor(() => channelState(h).missing === '', { timeout: 15000 })
    const s = channelState(h)
    h.check('path 1 is found in the folder as O0001 (written without an extension), though it is not open: nothing is "not found" and the item says Path 1 is not open', s.missing === '' && s.open === '2' && s.text.includes(notOpen('Path 1')), s)
    h.check('and the tooltip says Path 1 was found by its file name', s.title.includes(`Path 1: ${ctx.t('channels.status.foundFileName')}, ${ctx.t('channels.status.stateNotOpen')}`), s.title)
    const p1 = await openAs(h, `${one}/O0001`, 'fanuc-lathe')
    const both = await waitChannel(h, (x) => x.present && x.open === '1 2' && x.id === '1', 15000)
    h.check('O0001 opened is channel 1 of the set (the name carries no number: the machine\'s path-1 pattern says so), and both are open', both.id === '1' && both.open === '1 2' && both.missing === '', both)
    await activate(h, p2)
    const back = await waitChannel(h, (x) => x.present && x.id === '2' && x.open === '1 2', 8000)
    h.check('and from path 2 the set is the same two open files', back.open === '1 2' && back.missing === '', back)
  })

  await guard(h, 'B. two files that could be path 1: nothing is guessed', async () => {
    const p2 = await openAs(h, `${two}/O0002.P-2`, 'fanuc-lathe')
    await activate(h, p2)
    await h.waitFor(() => channelState(h).missing === '1', { timeout: 15000 })
    const s = channelState(h)
    const marker = '\u0001'
    const [head, tail] = ctx.t('channelFiles.problems.siblingAmbiguous', { channel: 'Path 1', names: marker }).split(marker)
    h.check('O0002 and O0002.P-1 are both in the folder: Path 1 is "not found" and the tooltip names the two and asks to open the right one', s.missing === '1' && s.title.includes(head) && s.title.includes(tail) && s.title.includes('O0002.P-1'), s)
  })

  await guard(h, 'C. the three-path preset still finds its paths by the extension', async () => {
    await setDefault(h, 'fanuc-lathe', three)
    const dir = await h.fixture('p4e/channels')
    const p3 = await openAs(h, `${dir}/threepath.NC3`, 'fanuc-lathe')
    await activate(h, p3)
    const s = await waitChannel(h, (x) => x.present && x.id === '3' && x.count === '3', 15000)
    await h.waitFor(() => channelState(h).missing === '', { timeout: 15000 })
    const now = channelState(h)
    h.check('threepath.NC3 alone: path 3 of 3; paths 1 and 2 (NC1, NC2) exist in the folder and are found, none is "not found", only this one is open', s.id === '3' && now.missing === '' && now.open === '3' && now.text.includes(notOpen('Path 1')) && now.text.includes(notOpen('Path 2')), now)
    h.check('and path 1 was found by the file name rule (NC1), as before the path-1 pattern existed', now.title.includes(`Path 1: ${ctx.t('channels.status.foundFileName')}`), now.title)
  })
})
