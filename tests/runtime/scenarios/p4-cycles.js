// P4b, "Drilling cycles and time": Expand Drilling Cycles, the built-in script of Phase 4 that writes the drilling cycles of a
// milling program out as plain moves (plan docs/planning/phase-4-implementation.md, H4b; X23 as the running app proves it).
// The statistics, the time estimate and the limits rows of the program checks are `p4-cycles-time`.
//
//   0. The Tools tab     the two P4b scripts are built in: their buttons, their headers read without a warning, the form ids,
//                        the `prefill` lines that tie the form to the machine's motion block
//   A. Fanuc G81         `fanuc-g81-g98-g99`: the cycle under G98 and G99, the blocks that run it again, G1 written back after G80
//   B. Fanuc pecks       `fanuc-g83-g73-pecks`: the deep peck and the high-speed peck, with the two values typed into the form
//   C. Klartext          `klartext-200-calls`: cycle 200 by M99, CYCL CALL POS, M89 and CYCL CALL, renumbered
//   D. Refusals          `fanuc-return-assumed`, `fanuc-pecks-no-form`, `lathe-refused`: the text is the same bytes, never marked as
//                        changed, one row per refused block in Results (the owner's rule of 2026-10-19: G98/G99 is never assumed)
//   E. The prefill       a machine with a motion block fills the two peck fields, so the run needs no typing; a machine without
//                        one leaves them empty and the run is refused; a value the form held under one machine is not carried to another
//
// **Everything is started from the Tools tab** (`p4-cycles-common.runTools`), the way the owner starts it. **Every expected
// answer is a golden** (`tests/fixtures/scripts/expand_cycles/**`): the program is `input.nc` byte for byte, the result
// `expected.nc` byte for byte, the status line ends with the golden's `message` (before the machine sentence where a machine is
// chosen), the Results panel holds the golden's findings in order, and one undo takes the document back to `input.nc`. A refused
// run hands the text back unchanged (Q4-1): the same bytes, never marked as changed.
//
// One scenario, because each section needs the app for a few seconds and the Python interpreter is started per run (the run takes
// about two minutes on the hosted runner). A section that throws is one failed check (`m10-common.guard`) and does not take the
// others down.

import { scenario } from '../lib/index.js'
import { guard, ready, ribbonTab, undo } from './m10-common.js'
import { pythonProbe, redo } from './m5-common.js'
import { ribbonGroups } from './p3b-common.js'
import {
  CYCLE_SCRIPTS,
  EXPAND_FIELDS,
  TIME_FIELDS,
  PREFILLED,
  beforeMachineSentence,
  context,
  firstDifference,
  geometryGolden,
  goldenFindings,
  makeMill,
  openGolden,
  read,
  runTools,
  screenFindings,
  scriptService,
  useMachine,
} from './p4-cycles-common.js'

/** @typedef {import('./p4-cycles-common.js').ToolsRun} ToolsRun */

/** The motion block of the machine of section E: the two peck values of the golden `fanuc-g83-g73-pecks`, in mm. */
const PECK_MOTION = { units: 'mm', peckRetract: 0.5, peckClearance: 1 }

scenario('p4-cycles', { timeout: 900 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const probe = await pythonProbe(h)
  h.check('the Python probe has answered, so the scripts can run', probe?.ok === true, probe)

  /** The Results panel's text. */
  const resultsText = () => h.q('results-panel')?.textContent ?? ''

  /**
   * One run that writes: the golden's program, the script from the Tools tab, the golden's result, one undo.
   * @param {string} label
   * @param {string} name the case folder
   * @param {string} file the file name in the run folder
   * @param {{ machine?: { label: string, id: string }, values?: Record<string, unknown>, inspect?: (shown: Record<string, string>) => void }} [o] `values` default to the golden's `params.json`
   */
  const writes = async (label, name, file, o = {}) => {
    const golden = await geometryGolden(h, 'expand_cycles', name)
    const { c } = golden
    if (c.expected === null || c.envelope === null) throw new Error(`expand_cycles/${name} is not a golden that writes`)
    const opened = await openGolden(h, golden, file)
    const id = opened.id
    if (o.machine) await useMachine(h, o.machine.label, o.machine.id)
    h.check(`${label}: the golden program is open as ${golden.profile}, byte for byte`, ctx.docs.get(id)?.profileId === golden.profile && h.app.text() === c.input, { profile: ctx.docs.get(id)?.profileId, same: h.app.text() === c.input })
    const run = await runTools(h, CYCLE_SCRIPTS.expand, o.values ?? c.params, { inspect: o.inspect })
    const got = h.app.text()
    h.check(`${label}: the form has the fields ${EXPAND_FIELDS.join(', ')}`, JSON.stringify(run.fields) === JSON.stringify(EXPAND_FIELDS), run.fields)
    h.check(`${label}: the document is the golden's expected text, byte for byte`, got === c.expected, { diff: firstDifference(got, c.expected) })
    const wantMessage = o.machine ? beforeMachineSentence(c.envelope.message) : c.envelope.message
    h.check(`${label}: the status line carries the golden's message${o.machine ? ' (up to the machine sentence)' : ''}`, o.machine ? run.status.includes(wantMessage) : run.status.endsWith(wantMessage), { got: run.status, want: wantMessage })
    const want = goldenFindings(c.envelope.findings)
    const shown = screenFindings(h)
    h.check(`${label}: the Results panel holds the golden's ${want.length} finding${want.length === 1 ? '' : 's'}, in order, and nothing else`, JSON.stringify(shown) === JSON.stringify(want), { got: shown, want })
    h.check(`${label}: the document is marked as changed`, ctx.docs.get(id)?.dirty === true)
    await undo(h)
    h.check(`${label}: one undo takes the whole run back to the input, byte for byte`, h.app.text() === c.input, { diff: firstDifference(h.app.text(), c.input) })
    await redo(h)
    h.check(`${label}: and one redo brings the result back`, h.app.text() === c.expected, { diff: firstDifference(h.app.text(), c.expected) })
    await undo(h)
    h.log(`${label}: ${run.ms} ms`)
    return { id, golden, run }
  }

  /**
   * One refused run: the document stays as it was and every refused block is a row in Results.
   * @param {string} label
   * @param {string} name
   * @param {string} file
   * @param {{ machine?: { label: string, id: string }, values?: Record<string, unknown> }} [o]
   */
  const refuses = async (label, name, file, o = {}) => {
    const golden = await geometryGolden(h, 'expand_cycles', name)
    const { c, refused } = golden
    if (refused === null) throw new Error(`expand_cycles/${name} is not a refused golden`)
    const opened = await openGolden(h, golden, file)
    const id = opened.id
    if (o.machine) await useMachine(h, o.machine.label, o.machine.id)
    const dirtyBefore = ctx.docs.get(id)?.dirty === true
    h.check(`${label}: the golden program is open as ${golden.profile}, byte for byte, and not changed`, ctx.docs.get(id)?.profileId === golden.profile && h.app.text() === c.input && !dirtyBefore, { profile: ctx.docs.get(id)?.profileId, dirty: dirtyBefore })
    const run = await runTools(h, CYCLE_SCRIPTS.expand, o.values ?? c.params)
    h.check(`${label}: the document is exactly the input, byte for byte`, h.app.text() === c.input, { diff: firstDifference(h.app.text(), c.input) })
    h.check(`${label}: and was not marked as changed: the refusal made no edit`, (ctx.docs.get(id)?.dirty === true) === dirtyBefore, { dirty: ctx.docs.get(id)?.dirty })
    const wantMessage = o.machine ? beforeMachineSentence(refused.message) : refused.message
    h.check(`${label}: the status line carries the refusal's message${o.machine ? ' (up to the machine sentence)' : ''}`, o.machine ? run.status.includes(wantMessage) : run.status.endsWith(wantMessage), { got: run.status, want: wantMessage })
    const shown = screenFindings(h)
    const want = goldenFindings(refused.findings)
    h.check(`${label}: the Results panel lists ${want.length} refused block${want.length === 1 ? '' : 's'}, one row each, the golden's words, in line order`, JSON.stringify(shown) === JSON.stringify(want), { got: shown, want })
    h.check(`${label}: and the head of the panel carries the refusal's message`, resultsText().includes(wantMessage), resultsText().slice(0, 240))
    await undo(h)
    h.check(`${label}: there is nothing to undo: the document is still the input`, h.app.text() === c.input && (ctx.docs.get(id)?.dirty === true) === dirtyBefore, { dirty: ctx.docs.get(id)?.dirty })
    return { id, run }
  }

  // =============================================================== 0. the Tools tab offers the two scripts
  await guard(h, '0. the Tools tab', async () => {
    const golden = await geometryGolden(h, 'expand_cycles', 'fanuc-g81-g98-g99')
    await openGolden(h, golden, 'p4-cycles-tools.nc')
    await ribbonTab(h, 'tools')
    const holder = ribbonGroups(h).find((g) => g.label === ctx.t('scripts.groupBundled'))
    h.check('the Tools tab has the group "Built-in Scripts"', holder !== undefined, ribbonGroups(h).map((g) => g.label))
    const wanted = [
      { scriptId: CYCLE_SCRIPTS.expand, name: 'Expand Drilling Cycles' },
      { scriptId: CYCLE_SCRIPTS.time, name: 'Statistics and Time' },
    ]
    const items = wanted.map((w) => ({ ...w, item: h.q('script-item', { scriptId: w.scriptId }) }))
    h.check(
      'it offers Expand Drilling Cycles and Statistics and Time, each as its own button with its own run command, inside that group',
      items.every((i) => i.item !== null && holder?.element.contains(i.item) === true && i.item.getAttribute('data-command') === `script.run:${i.scriptId}`),
      items.map((i) => [i.scriptId, i.item?.getAttribute('data-command')]),
    )
    h.check('named by the headers', JSON.stringify(items.map((i) => i.item?.textContent?.trim())) === JSON.stringify(wanted.map((w) => w.name)), items.map((i) => i.item?.textContent?.trim()))
    h.check('each carries its description as the tooltip, longer than the name', items.every((i) => (i.item?.getAttribute('title') ?? '').length > (i.item?.textContent ?? '').trim().length + 40), items.map((i) => i.item?.getAttribute('title')?.length))
    h.check('and each is enabled for a Fanuc milling program', items.every((i) => i.item !== null && !(/** @type {HTMLButtonElement} */ (i.item).disabled)))

    const listed = /** @type {any[]} */ (read(scriptService(h).list))
    /** @param {string} id */
    const entryOf = (id) => listed.find((e) => e.id === id)
    const expand = entryOf(CYCLE_SCRIPTS.expand)
    const time = entryOf(CYCLE_SCRIPTS.time)
    h.check(
      'Expand Drilling Cycles: the header is read with no warning: it replaces the text, returns an envelope, has the 900 s timeout, the two peck fields and their units, each prefilled from the machine',
      expand?.headerError === null && expand?.meta?.warnings?.length === 0 && expand.meta.output === 'replace' && expand.meta.envelope === true && expand.meta.timeout === 900 &&
        JSON.stringify(expand.meta.params.map((/** @type {any} */ p) => p.id)) === JSON.stringify(EXPAND_FIELDS) &&
        expand.meta.params.every((/** @type {any} */ p) => p.prefill === PREFILLED[p.id]),
      { err: expand?.headerError, output: expand?.meta?.output, envelope: expand?.meta?.envelope, timeout: expand?.meta?.timeout, params: expand?.meta?.params?.map((/** @type {any} */ p) => [p.id, p.prefill]), warnings: expand?.meta?.warnings },
    )
    h.check(
      'Statistics and Time: the header is read with no warning: it opens a new document, returns an envelope, has the 900 s timeout and the thirteen fields, every one but the output format prefilled from the machine',
      time?.headerError === null && time?.meta?.warnings?.length === 0 && time.meta.output === 'new-document' && time.meta.envelope === true && time.meta.timeout === 900 &&
        JSON.stringify(time.meta.params.map((/** @type {any} */ p) => p.id)) === JSON.stringify(TIME_FIELDS) &&
        time.meta.params.every((/** @type {any} */ p) => (p.id === 'format' ? p.prefill === undefined : p.prefill === PREFILLED[p.id])),
      { err: time?.headerError, output: time?.meta?.output, envelope: time?.meta?.envelope, timeout: time?.meta?.timeout, params: time?.meta?.params?.map((/** @type {any} */ p) => [p.id, p.prefill]), warnings: time?.meta?.warnings },
    )
    await ribbonTab(h, 'scripts')
    h.check('neither is on the Scripts tab: they are built in', h.qa('script-item').every((e) => (e.dataset.scriptId ?? '').startsWith('bundled:') === false), h.qa('script-item').map((e) => e.dataset.scriptId))
  })

  // =============================================================== A. a Fanuc G81 under G98 and G99
  await guard(h, 'A. Fanuc G81', async () => {
    await writes('Fanuc G81 under G98 and G99', 'fanuc-g81-g98-g99', 'p4-g81.nc', {
      inspect: (shown) => {
        h.check('A: without a machine the two peck fields start empty', ['peckRetract', 'peckClearance'].every((f) => shown[f] === ''), shown)
      },
    })
  })

  // =============================================================== B. the pecks, typed
  await guard(h, 'B. Fanuc G83 and G73', async () => {
    await writes('Fanuc G83 and G73 with the two values typed (0.5 and 1)', 'fanuc-g83-g73-pecks', 'p4-pecks.nc')
  })

  // =============================================================== C. Klartext cycle 200
  await guard(h, 'C. Klartext 200', async () => {
    await writes('Klartext cycle 200 by M99, CYCL CALL POS, M89 and CYCL CALL', 'klartext-200-calls', 'p4-klartext-200.h')
  })

  // =============================================================== D. refusals
  await guard(h, 'D1. return level not stated', async () => {
    await refuses('a G81 with no G98 or G99 anywhere (return-assumed)', 'fanuc-return-assumed', 'p4-return-assumed.nc')
  })
  await guard(h, 'D2. the peck values missing', async () => {
    await refuses('a G83 and a G73 with both form fields empty (Q4-9)', 'fanuc-pecks-no-form', 'p4-pecks-no-form.nc')
  })
  await guard(h, 'D3. a turning program', async () => {
    await refuses('a turning program', 'lathe-refused', 'p4-lathe-refused.nc')
  })

  // =============================================================== E. the prefill from the machine's motion block
  await guard(h, 'E. the prefill', async () => {
    const withPecks = await makeMill(h, 'Mill pecks', { motion: PECK_MOTION })
    const without = await makeMill(h, 'Mill plain')
    const golden = await geometryGolden(h, 'expand_cycles', 'fanuc-g83-g73-pecks')
    const { c } = golden
    if (c.expected === null || c.envelope === null) throw new Error('expand_cycles/fanuc-g83-g73-pecks is not a golden that writes')

    // 1. a machine with the two values: the form shows them and the run needs no typing
    const opened = await openGolden(h, golden, 'p4-prefill.nc')
    const id = opened.id
    await useMachine(h, 'Mill pecks', withPecks)
    const run = await runTools(h, CYCLE_SCRIPTS.expand, {}, {
      inspect: (shown) => {
        h.check('E1: the form opens with the machine’s retract (0.5) and clearance (1) in the two peck fields', shown.peckRetract === '0.5' && shown.peckClearance === '1', shown)
      },
    })
    h.check('E1: run with nothing typed, the document is the golden whose form values are those two numbers, byte for byte', h.app.text() === c.expected, { diff: firstDifference(h.app.text(), c.expected) })
    h.check('E1: the status line carries the golden’s message up to the machine sentence', run.status.includes(beforeMachineSentence(c.envelope.message)), { got: run.status })
    await undo(h)
    h.check('E1: one undo brings the program back', h.app.text() === c.input, { diff: firstDifference(h.app.text(), c.input) })

    // 2. a machine without a motion block: empty fields, and the run is refused for them
    await useMachine(h, 'Mill plain', without)
    const refusedGolden = await geometryGolden(h, 'expand_cycles', 'fanuc-pecks-no-form')
    h.check('E2: this program is the one of the refusal golden: the two peck cycles', c.input.includes('G83') && c.input.includes('G73') && refusedGolden.refused !== null)
    const second = await runTools(h, CYCLE_SCRIPTS.expand, {}, {
      inspect: (shown) => {
        h.check('E2: under a machine with no motion block the two fields are empty, not the 0.5 and 1 the form held a moment ago', shown.peckRetract === '' && shown.peckClearance === '', shown)
      },
    })
    h.check('E2: the run is refused for the two missing values, and the program is the same bytes', h.app.text() === c.input && /peck/.test(second.status), { status: second.status })
    const shown = screenFindings(h)
    // One error row for every block that cannot be written out: the G83 (N40), the G73 (N50) and the block that repeats the
    // G73 at the next hole (N60 X25.), which needs the same retract. (The first run of this scenario expected two rows,
    // those of the refusal golden `fanuc-pecks-no-form`, whose program has no such repeat.)
    h.check('E2: Results names the cycle blocks, one error row each (the deep peck clearance of N40, the high-speed peck retract of N50 and of the repeat in N60)', shown.length === 3 && shown.every((row) => row.split('|')[1] === 'error') && shown.filter((row) => /deep peck clearance/.test(row)).length === 1 && shown.filter((row) => /high-speed peck retract/.test(row)).length === 2, shown)
    await undo(h)

    // 3. back to the first machine, then to none: the prefill follows the document's machine every time
    await useMachine(h, 'Mill pecks', withPecks)
    await runTools(h, CYCLE_SCRIPTS.expand, {}, {
      inspect: (values) => {
        h.check('E3: choosing the first machine again fills the two fields again', values.peckRetract === '0.5' && values.peckClearance === '1', values)
      },
    })
    await undo(h)
    await useMachine(h, 'None (dialect defaults)', '')
    await runTools(h, CYCLE_SCRIPTS.expand, {}, {
      inspect: (values) => {
        h.check('E3: with no machine the fields are empty, not what the run before left behind', values.peckRetract === '' && values.peckClearance === '', values)
      },
    })
    await undo(h)
  })

  h.log(`status at the end: ${h.q('status-message')?.textContent?.trim()}`)
})
