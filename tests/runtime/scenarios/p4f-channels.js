// P4f, channels on disk and channel scope (plan `docs/planning/phase-4-implementation.md` §6.8.1 item 8 and §6.8.6; P4.31 with the review fixes B and
// the owner's answers of 2026-10-28: channel files are named `PART_1.MPF` style, the copies sentence after the last save, Merge Channels Back).
// Two scenarios on the programs of `tests/fixtures/p4e/channels/` (README there has the line numbers):
//
//   p4f-channel-files   `twin-sections.nc`, two channels in one file: Save Channel Files is off before a split; after Split into Channel Documents the
//                       documents are named `twin-sections_1.nc` and `twin-sections_2.nc` and a click on Save Channel Files asks one Save As per file with
//                       exactly those names in the program's folder; the status bar says two of two were saved and that the files are copies for editing
//                       (the sentence the owner asked for); the files hold their channel only; an edit in a saved channel document is merged back into the
//                       program as one undo step; a second Save Channel Files asks nothing (the documents have their files now).
//   p4f-channel-scope   the Channel choice of Find All (all, one channel, with a document that has no such channel skipped and said) and of Compare with the
//                       saved version: a program with sections is cut to its channel on both sides, aligned and copy are refused in plain words while cut;
//                       a program of one file per channel is offered its own channel only (CODE-2: it used to be refused) and compares the whole file.
//
// **Expected lines are worked out from the programs' text** (the hits of M910 outside comments, the sections as the README says), the sentences are
// `ctx.t(...)`. The machine of the twin program is the channel block of the golden `c10-alternating` (needs `files: REPO_FILE`), the three-path machine is
// the built-in preset `fanuc-lathe/fanuc-3path-digits`.

import { scenario } from '../lib/index.js'
import { REPO_FILE } from './m3-common.js'
import { blockOf } from './m12-common.js'
import { ACTIVE_ONLY, ALL_OPEN, closeCompare, lineChanges, monacoRegistry, paneText, runForm, view } from './m11-common.js'
import { textOf, undo } from './m5-common.js'
import { activate, addMachine, context, guard, message, messageIsError, newDoc, open, openAs, pick, pickerRows, presetBlock, read, ready, report, rowsOf, sameJson, setDefault, waitChannel } from './p4f-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

/** The program's lines that hold `pattern` outside a round-bracket comment, from line `from` to `to` (1-based, inclusive). @param {string[]} lines @param {RegExp} pattern @param {number} from @param {number} to */
const linesWith = (lines, pattern, from, to) => lines.flatMap((text, i) => (i + 1 >= from && i + 1 <= to && pattern.test(text.replace(/\([^)]*\)/g, '')) ? [i + 1] : []))

/** A text without the line breaks at its end, so a pane's text and a file's text compare. @param {string | undefined} text */
const trimmed = (text) => (text ?? '').replace(/\n+$/, '')

scenario('p4f-channel-files', { timeout: 300, files: REPO_FILE }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const dir = await h.fixture('p4e/channels')
  const twinId = await addMachine(h, { name: 'Twin lathe', channels: await blockOf(h, 'c10-alternating') })
  await setDefault(h, 'fanuc-lathe', twinId)
  const twinPath = `${dir}/twin-sections.nc`
  const twinText = await h.disk.read(twinPath)
  const twin = twinText.split('\n')
  const id = await openAs(h, twinPath, 'fanuc-lathe')
  await waitChannel(h, (s) => s.present && s.layout === 'single-file')
  const f1 = `${dir}/twin-sections_1.nc`
  const f2 = `${dir}/twin-sections_2.nc`
  /** @type {string[]} */
  let made = []
  const saves = () => h.dialogs.calls().filter((c) => c.kind === 'save')

  await guard(h, 'A. Save Channel Files is for a split program', async () => {
    h.check('before a split there is nothing to save: the command is not on offer', !ctx.commands.isEnabled('channels.saveChannelFiles'))
  })

  await guard(h, 'B. Split into Channel Documents names the documents like the files', async () => {
    const before = ctx.docs.all().length
    const running = ctx.commands.run('channels.splitToDocuments')
    const alert = await h.alert.wait({ timeout: 10000 })
    h.check('the first split asks once, and the question names Merge Channels Back', !!alert && (alert.texts ?? []).join(' ').includes(ctx.t('channels.mergeBack')), alert)
    await h.alert.click('Split')
    await running
    await h.idle()
    const docs = ctx.docs.all().slice(before)
    made = docs.map((d) => d.id)
    h.check('two documents, named after the program and the channel id as a file would be: twin-sections_1.nc and twin-sections_2.nc (the stem, an underscore, the id, the extension)', sameJson(docs.map((d) => d.title), ['twin-sections_1.nc', 'twin-sections_2.nc']), docs.map((d) => d.title))
    h.check('and neither has a file yet', docs.every((d) => d.path === null))
    h.check('now Save Channel Files is on offer, from the program and from a channel document', ctx.commands.isEnabled('channels.saveChannelFiles'))
  })

  await guard(h, 'C. Save Channel Files: one Save As each, the proposed names, the copies sentence', async () => {
    if (made.length !== 2) throw new Error('no channel documents')
    const asked = saves().length
    await h.dialogs.queue('save', f1)
    await h.dialogs.queue('save', f2)
    await ctx.commands.run('channels.saveChannelFiles')
    await h.idle()
    const dialogs = saves().slice(asked)
    h.check('two Save As dialogs, in channel order, each proposing its name in the folder of the program', sameJson(dialogs.map((c) => /** @type {any} */ (c.args)?.options?.defaultPath), [f1, f2]), dialogs.map((c) => c.args))
    const wanted = `${ctx.t('channelScope.files.saved', { count: 2, total: 2 })} ${ctx.t('channelScope.files.copies')}`
    h.check('the status bar says that 2 of 2 were saved, then that these are copies for editing, to be sent in the form the machine reads, and that Merge Channels Back makes it one file again', message(h) === wanted && !messageIsError(h), { status: message(h), wanted })
    const one = await h.disk.read(f1)
    const two = await h.disk.read(f2)
    h.check('twin-sections_1.nc holds the header and channel 1 only; twin-sections_2.nc the header and channel 2 only', one.startsWith(twin[0]) && one.includes('O1001') && !one.includes('O2001') && two.startsWith(twin[0]) && two.includes('O2001') && !two.includes('O1001'), { one: one.length, two: two.length })
    h.check('the documents are those files now: path set, clean, same names', made.every((d, i) => ctx.docs.get(d)?.path === [f1, f2][i] && ctx.docs.get(d)?.dirty !== true), made.map((d) => [ctx.docs.get(d)?.path, ctx.docs.get(d)?.dirty]))
    h.check('the program itself was not touched', textOf(h, id) === twinText && ctx.docs.get(id)?.dirty !== true)
  })

  await guard(h, 'D. Merge Channels Back after the files are written', async () => {
    if (made.length !== 2) throw new Error('no channel documents')
    await activate(h, made[0])
    ctx.editor.reveal(made[0], 8, 1)
    ctx.editor.insertText('(P4F EDIT 1)\n')
    await h.idle()
    await ctx.commands.run('channels.mergeBack')
    const merged = [...twin.slice(0, 7), '(P4F EDIT 1)', ...twin.slice(7)].join('\n')
    await h.waitFor(() => textOf(h, id) === merged, { timeout: 8000 })
    h.check('the edit of channel 1 is written into the program at its own line (8), everything else as it was', textOf(h, id) === merged, { lines: ctx.editor.getLineCount(id) })
    h.check('the program is the active tab, says what happened (one channel document merged), and is marked changed', ctx.docs.getActiveId() === id && message(h) === ctx.t('channels.merge.done', { count: 1 }) && ctx.docs.get(id)?.dirty === true, { status: message(h) })
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 8000 })
    await undo(h)
    await h.waitFor(() => textOf(h, id) === twinText, { timeout: 8000 })
    h.check('ONE undo takes the merge back', textOf(h, id) === twinText && ctx.docs.get(id)?.dirty !== true)
  })

  await guard(h, 'E. a second Save Channel Files asks nothing', async () => {
    if (made.length !== 2) throw new Error('no channel documents')
    const asked = saves().length
    await ctx.commands.run('channels.saveChannelFiles')
    await h.idle()
    const one = await h.disk.read(f1)
    h.check('the documents have their files, so the command saves them where they are: no dialog, and the edit made in channel 1 is on disk', saves().length === asked && one.includes('(P4F EDIT 1)'), { dialogs: saves().length - asked })
  })

})

scenario('p4f-channel-scope', { timeout: 420, files: REPO_FILE }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const reg = monacoRegistry(h)
  const dir = await h.fixture('p4e/channels')
  const twinId = await addMachine(h, { name: 'Twin lathe', channels: await blockOf(h, 'c10-alternating') })
  const threeId = await addMachine(h, { name: 'Three-path lathe', channels: presetBlock(h, 'fanuc-lathe', 'fanuc-3path-digits') })
  await setDefault(h, 'fanuc-lathe', twinId)
  const twinPath = `${dir}/twin-sections.nc`
  const twinText = await h.disk.read(twinPath)
  const twin = twinText.split('\n')
  const id = await openAs(h, twinPath, 'fanuc-lathe')
  await waitChannel(h, (s) => s.present && s.layout === 'single-file')

  // The sections, as the README of tests/fixtures/p4e says: channel 1 is lines 4 to 100, channel 2 lines 101 to 205.
  const M910_ALL = linesWith(twin, /M910/i, 1, twin.length)
  const M910_CH1 = linesWith(twin, /M910/i, 4, 100)
  const M910_CH2 = linesWith(twin, /M910/i, 101, 205)
  h.check('the program holds M910 once in each channel (lines 60 and 167)', sameJson(M910_ALL, [60, 167]) && sameJson(M910_CH1, [60]) && sameJson(M910_CH2, [167]), M910_ALL)

  /** What a limited comparison's title ends with: the sentence of the title with the usual title left out. @param {string} channel */
  const titleTail = (channel) => ctx.t('channelScope.compare.title', { title: '\u0001', channel }).split('\u0001')[1]

  /** The command that is waiting for the answer of the question that is open. @type {Promise<unknown>} */
  let pending = Promise.resolve()

  /** Runs a command that opens the channel question, reads its rows and leaves it open. @param {string} command */
  async function openAndRead(command) {
    pending = ctx.commands.run(command)
    if (!(await h.waitFor(() => h.q('quick-pick'), { timeout: 10000 }))) throw new Error(`${command} asked no question (status: ${message(h)})`)
    return pickerRows(h).map((r) => r.label)
  }
  /** Answers the question that is open with the entry `label` and waits for the comparison. @param {string} label @param {string} [again] a command to run first (when no question is open) */
  async function pickAndOpen(label, again) {
    if (again !== undefined) {
      pending = ctx.commands.run(again)
      if (!(await h.waitFor(() => h.q('quick-pick'), { timeout: 10000 }))) throw new Error(`${again} asked no question`)
    }
    const row = pickerRows(h).find((r) => r.label === label)
    if (!row) throw new Error(`no entry ${label}; the question has ${JSON.stringify(pickerRows(h).map((r) => r.label))}`)
    h.click(row.element)
    await h.waitFor(() => !h.q('quick-pick'), { timeout: 8000 })
    await pending
    if (!(await h.waitFor(() => !!view(h)?.querySelector('.monaco-diff-editor'), { timeout: 15000 }))) return /** @type {any} */ (null)
    await h.waitFor(() => lineChanges(reg) !== null, { timeout: 30000, interval: 20 })
    await h.idle()
    return /** @type {any} */ (read(/** @type {any} */ (ctx.compare).content))
  }

  /** Find All for M910 with a Channel answer, and the lines it lists. @param {Record<string, unknown>} values */
  const find = async (values) => {
    await runForm(h, 'search.findAll', { query: 'M910', inComments: false, wholeAddress: false, caseSensitive: false, regex: false, scope: ACTIVE_ONLY, ...values })
    return report(h)
  }

  await guard(h, 'A. Find All by channel', async () => {
    const all = await find({ channel: pick('All', 0) })
    h.check('All channels: both M910 (lines 60 and 167), and no sentence about a channel', sameJson(rowsOf(all).map((r) => r.line), M910_ALL) && !all?.message, { rows: rowsOf(all), message: all?.message })
    const two = await find({ channel: pick('Channel 2', 2) })
    h.check('Channel 2: only line 167, the line number is the program\'s; the message says only the lines of Channel 2 were read', sameJson(rowsOf(two).map((r) => r.line), M910_CH2) && two?.message === ctx.t('channelScope.find.message', { channel: 'Channel 2' }), { rows: rowsOf(two), message: two?.message })
    const one = await find({ channel: pick('Channel 1', 1) })
    h.check('Channel 1: only line 60', sameJson(rowsOf(one).map((r) => r.line), M910_CH1) && one?.message === ctx.t('channelScope.find.message', { channel: 'Channel 1' }), rowsOf(one))
  })

  await guard(h, 'B. in all open documents a document without the channel is skipped and counted', async () => {
    const plain = await newDoc(h, 'G21\nM910\nM30\n', 'fanuc-gcode')
    await activate(h, id)
    await runForm(h, 'search.findAll', { query: 'M910', inComments: false, wholeAddress: false, caseSensitive: false, regex: false, scope: ALL_OPEN, channel: pick('Channel 2', 2) })
    const r = report(h)
    h.check('the plain document\'s M910 is not listed, the program\'s line 167 is', sameJson(rowsOf(r).map((x) => [x.docId, x.line]), [[id, 167]]), rowsOf(r))
    h.check('and the message says so: only the lines of Channel 2, 1 document skipped because it has no lines of this channel', r?.message === `${ctx.t('channelScope.find.message', { channel: 'Channel 2' })} ${ctx.t('channelScope.find.skipped', { count: 1 })}`, r?.message)
    h.check('the plain document is still open and untouched', !!ctx.docs.get(plain) && ctx.docs.get(plain)?.dirty !== true)
  })

  await guard(h, 'C. Compare with the saved version, limited to a channel', async () => {
    await activate(h, id)
    ctx.editor.reveal(id, 150, 1)
    ctx.editor.insertText('(P4F COMPARE EDIT)\n')
    await h.idle()
    const rows = (await openAndRead('compare.withSaved')) ?? []
    h.check('the question "Compare which lines?" offers the whole program and each channel', sameJson(rows, ['The whole program', 'Channel 1', 'Channel 2']), rows)
    const cut = await pickAndOpen('Channel 2')
    h.check('the comparison is limited to Channel 2: its title says so, and it records the channel', /** @type {string} */ (cut?.title ?? '').endsWith(titleTail('Channel 2')) && cut?.channel?.id === '2', { title: cut?.title, channel: cut?.channel })
    const saved = trimmed(paneText(reg, 'original'))
    const edited = trimmed(paneText(reg, 'modified'))
    h.check('the saved side is the lines of channel 2 of the saved text (101 to 205), nothing of the header or channel 1', saved === twin.slice(100, 205).join('\n'), { lines: saved.split('\n').length })
    h.check('and the edited side the same lines with the new line in it, so the comparison has the one change', edited === [...twin.slice(100, 149), '(P4F COMPARE EDIT)', ...twin.slice(149, 205)].join('\n') && (lineChanges(reg) ?? []).length === 1, { lines: edited.split('\n').length, changes: (lineChanges(reg) ?? []).length })
    await ctx.commands.run('compare.toggleAligned')
    await h.idle()
    h.check('the aligned view is refused in plain words while the comparison is cut, and stays off', message(h) === ctx.t('channelScope.compare.alignedRefused') && messageIsError(h) && view(h)?.dataset.mode !== 'aligned', { status: message(h), mode: view(h)?.dataset.mode })
    await closeCompare(h)
    const whole = await pickAndOpen('The whole program', 'compare.withSaved')
    h.check('the whole program compares both full texts, with no channel in the title', !whole?.channel && trimmed(paneText(reg, 'original')) === trimmed(twinText), { title: whole?.title })
    await closeCompare(h)
  })

  await guard(h, 'D. a program of one file per channel is offered its own channel', async () => {
    await setDefault(h, 'fanuc-lathe', threeId)
    const path = `${dir}/threepath.NC2`
    const text = await h.disk.read(path)
    const two = await openAs(h, path, 'fanuc-lathe')
    await waitChannel(h, (s) => s.present && s.layout === 'multi-file' && s.id === '2')
    ctx.editor.reveal(two, 10, 1)
    ctx.editor.insertText('(P4F PATH EDIT)\n')
    await h.idle()
    const rows = (await openAndRead('compare.withSaved')) ?? []
    h.check('the question offers the whole file and Path 2 only (a file of another path is not on offer)', sameJson(rows, ['The whole program', 'Path 2']), rows)
    const cut = await pickAndOpen('Path 2')
    h.check('Path 2 opens: the comparison names the channel (this was refused before the review fix)', cut?.channel?.id === '2' && /** @type {string} */ (cut?.title ?? '').endsWith(titleTail('Path 2')), { title: cut?.title, channel: cut?.channel, status: message(h) })
    const lines = text.split('\n')
    h.check('both sides are the whole file of path 2: the saved text and the edited text with the new line 10, one change', trimmed(paneText(reg, 'original')) === trimmed(text) && trimmed(paneText(reg, 'modified')) === trimmed([...lines.slice(0, 9), '(P4F PATH EDIT)', ...lines.slice(9)].join('\n')) && (lineChanges(reg) ?? []).length === 1, { changes: (lineChanges(reg) ?? []).length })
    await closeCompare(h)
  })
})
