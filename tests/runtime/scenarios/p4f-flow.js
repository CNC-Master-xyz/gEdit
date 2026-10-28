// P4f, the channel check follows jumps (plan `docs/planning/phase-4-implementation.md` §6.8.7, rules F1 to F5; P4.32 and the review fixes A: NC-1, NC-3,
// NC-5): Check Wait Codes on the Tools tab, run on two-channel programs whose jumps change which waits run. The programs are the goldens of
// `tests/fixtures/channels/flow/` written out as files (`tests/fixtures/p4f/harness/flow/`, README there), one file per channel, so the
// check is the app's whole path: file names find the other channel, the jump lines and the flow are computed from the open documents, the report is
// the Results panel. One scenario, six programs; each case states what the check says and why, from the golden's own description.
//
//   sif     Siemens, a `GOTOF L1` alone in an `IF R1==1 ... ENDIF` block jumps over `WAITM(2,1,2)`. The jump runs only when R1 is 1, so channel 1 may
//           reach the wait and wait there for ever: the missing partner is reported (NC-1: before the fix the jump inside the block was followed and the
//           missing wait was hidden).
//   selse   the same with the jump in the ELSE part of the block: not followed either.
//   sover   a `GOTOF SKIP1` outside every block jumps over a whole `IF ... ENDIF` block that holds `WAITM(2,1,2)`: the jump always runs, so it is
//           followed, and channel 2, which waits for mark 2, waits for ever (reported on channel 2).
//   srep    `LAB1: ... REPEAT LAB1 P=2` repeats its lines twice more (three passes): the wait inside is counted three times, as channel 2 writes it:
//           no finding.
//   fgoto   Fanuc, a `GOTO 50` alone in its block jumps forward over `M902`: followed, path 2 waits at its `M902` for ever.
//   fsub    Fanuc, `GOTO 100` names an `N100` that is only in the subprogram below `M30` and the next `O` head: the control looks in the same program,
//           so the jump is not followed (NC-5) and the missing `M902` of path 2 is reported on path 1.
//
// A wait is a row of the Results panel with the channel, the line and the document it is in; the row's text is the check's own sentence, tested by
// its shape (`... in A waits for B, but B has no ...`), and the line and the document are what the golden says.

import { scenario } from '../lib/index.js'
import { resultRows } from './m12-common.js'
import { activate, addMachine, channelState, checkWaits, context, findingsOf, guard, openAs, presetBlock, ready, sameJson, setDefault, waitChannel } from './p4f-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

/** `A in X waits for Y, but Y has no ...`: a missing partner. */
const MISSING = /waits for .+, but .+ has no /

scenario('p4f-flow', { timeout: 420 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const dir = await h.fixture('p4f/harness/flow')
  const siemens = await addMachine(h, { name: 'Siemens two channels', profile: 'sinumerik', channels: presetBlock(h, 'sinumerik', 'sinumerik-2channel-c') })
  const fanuc = await addMachine(h, { name: 'Fanuc two paths', profile: 'fanuc-lathe', channels: presetBlock(h, 'fanuc-lathe', 'fanuc-2path') })
  await setDefault(h, 'sinumerik', siemens)
  await setDefault(h, 'fanuc-lathe', fanuc)

  /**
   * Opens the two files of a program, makes channel 1 the active one and runs the check.
   * @param {string[]} names the files of channel 1 and channel 2
   * @param {string} profile
   */
  async function check(names, profile) {
    const ids = []
    for (const name of names) ids.push(await openAs(h, `${dir}/${name}`, profile))
    await activate(h, ids[0])
    await waitChannel(h, (s) => s.present && s.layout === 'multi-file' && s.open === '1 2', 15000)
    const report = await checkWaits(h)
    return { ids, report, rows: resultRows(h) }
  }

  /**
   * @param {string} what
   * @param {string[]} names
   * @param {string} profile
   * @param {{ channel: string, line: number, doc: 0 | 1, code: RegExp }[]} wanted the findings, in the check's order
   * @param {string} machine
   */
  async function expectFindings(what, names, profile, wanted, machine) {
    const { ids, report, rows } = await check(names, profile)
    h.check(`${what}: the findings are ${wanted.length === 0 ? 'none' : wanted.map((w) => `${w.channel} line ${w.line}`).join(', ')}`, sameJson(findingsOf(report), wanted.map((w) => `${w.channel}:${w.line}`)), findingsOf(report))
    if (wanted.length === 0) {
      h.check(`${what}: nothing to look at: the title says all match, and the message lists both channels as checked`, report.title === ctx.t('channels.report.titleNone', { machine }) && /** @type {string} */ (report.message).includes(ctx.t('channels.report.checked', { channels: 'Channel 1, Channel 2' })), { title: report.title, message: report.message })
      return
    }
    h.check(`${what}: each is a missing partner ("waits for ..., but ... has no ..."), not a "not checked"`, wanted.every((w, i) => MISSING.test(report.rows[i].text) && !/not checked/.test(report.rows[i].text)), report.rows.map((/** @type {any} */ r) => r.text))
    h.check(`${what}: each row belongs to the document of its channel and to the line of the golden`, sameJson(rows.map((r) => [r.docId, r.line]), wanted.map((w) => [ids[w.doc], w.line])), rows.map((r) => [r.docId, r.line]))
    h.check(`${what}: and that line holds the wait the golden names`, wanted.every((w) => w.code.test(ctx.editor.getLines(ids[w.doc], w.line, w.line)[0] ?? '')), wanted.map((w) => ctx.editor.getLines(ids[w.doc], w.line, w.line)[0]))
  }

  await guard(h, 'sif. a GOTOF inside IF ... ENDIF does not hide a missing wait', async () => {
    await expectFindings('sif', ['sif_C1.MPF', 'sif_C2.MPF'], 'sinumerik', [{ channel: 'Channel 1', line: 7, doc: 0, code: /WAITM\(2,1,2\)/ }], 'Siemens two channels')
  })

  await guard(h, 'selse. the same with the jump in the ELSE part', async () => {
    await expectFindings('selse', ['selse_C1.MPF', 'selse_C2.MPF'], 'sinumerik', [{ channel: 'Channel 1', line: 9, doc: 0, code: /WAITM\(2,1,2\)/ }], 'Siemens two channels')
  })

  await guard(h, 'sover. a GOTOF over a whole IF block is followed', async () => {
    await expectFindings('sover', ['sover_C1.MPF', 'sover_C2.MPF'], 'sinumerik', [{ channel: 'Channel 2', line: 5, doc: 1, code: /WAITM\(2,1,2\)/ }], 'Siemens two channels')
  })

  await guard(h, 'srep. a counted REPEAT', async () => {
    await expectFindings('srep', ['srep_C1.MPF', 'srep_C2.MPF'], 'sinumerik', [], 'Siemens two channels')
  })

  await guard(h, 'fgoto. a forward GOTO in a Fanuc program is followed', async () => {
    await expectFindings('fgoto', ['fgoto.P-1', 'fgoto.P-2'], 'fanuc-lathe', [{ channel: 'Path 2', line: 7, doc: 1, code: /M902 P3/ }], 'Fanuc two paths')
  })

  await guard(h, 'fsub. a jump into a subprogram is not followed', async () => {
    await expectFindings('fsub', ['fsub.P-1', 'fsub.P-2'], 'fanuc-lathe', [{ channel: 'Path 1', line: 7, doc: 0, code: /M902 P3/ }], 'Fanuc two paths')
    h.check('and the channel item still says the set of two is open (the check changed nothing in the programs)', channelState(h).open === '1 2' && h.dialogs.calls().every((c) => c.kind !== 'message'))
  })
})
