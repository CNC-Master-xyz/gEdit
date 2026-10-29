// P4h, the machine form's table "Numbers" and the Siemens extra axes (plan docs/planning/phase-4-implementation.md section 6.10 rules 10 to 14,
// P4.43a and P4.43b, the fix round NC-1, NC-5, CODE-3, CODE-10; H4h). Two scenarios.
//
//   p4-machines-numbers   Settings > Machines > Add on the Fanuc lathe and Okuma, on a configuration folder that has no machines file yet
//     A. the table              the choice lists the presets of the profile; the table has five rows (length, angle, feed per minute, feed per
//                               revolution, dwell) and the inch step only where the unit follows the program; the preset IS-B fills it; a new
//                               metric step of a feed row empties the inch step beside it, names the problem at that field and keeps Save off until
//                               the inch step is written; the choice then reads "Custom"; Save writes the rules, and the first machine of a fresh
//                               configuration writes the `$schema` line of the machines schema (CODE-3).
//     B. built-in presets       every preset of the Fanuc lathe and of Okuma (the 10 micron one among them) is saved as it is, with Save on at once,
//                               no question and the rules of the preset in the file (NC-5: a built-in preset is never refused for an inch step).
//     C. typed as written       `0.0010` typed over the preset's `0.001` stays as typed in the field (CODE-10), the choice is still the preset, and
//                               the file holds the preset's own `0.001`.
//     D. the hover              a `G76` second block with `P1500` on a lathe with IS-B: the hover says it is 1.5 mm (P4.43a, NC-2).
//   p4-machines-axes      a Sinumerik mill (T123)
//     A. before                 without a machine the words `AA=90`, `AA90` and `G810` are no axis and no builder code.
//     B. the fields             "Extra axes" and "Machine builder codes": a name that is a keyword of the profile (`GOTO`), a word that is no axis name
//                               and a builder code that gEdit knows (`G17`) are refused at their field with Save off; `AA` and `G810-G829` are saved.
//     C. the hover              with the machine chosen the hover names `AA=90` and `AA90` as an axis of the machine and `G810` as a code of the
//                               machine builder.
//     D. Translate              a program with `AA` words under a machine that lists AA (linear) and QQ (rotary): the golden of
//                               `translate/extra-axis-sinumerik-mill`, with the information row for the linear extra axis (Q-5).
//
// What only the running app proves: the form, its table and its refusals, the file the page writes, the hover over a real program, a script run with a
// machine. **Every expected text is `ctx.t(...)`**; the rules of a preset are read from the profile's own data (`machineParams.numberInput.presets`),
// the golden of Translate from its folder. A section that throws is one failed check (`m10-common.guard`).

import { scenario } from '../lib/index.js'
import { REPO_FILE, hoverAt } from './m3-common.js'
import { setInput } from './m2-common.js'
import { pythonProbe } from './m5-common.js'
import { choiceOf, saveMachineForm, shownPreset, startAdd } from './m8-common.js'
import { openProbe } from './m9-common.js'
import { makeMachine, useMachine } from './exit2-common.js'
import { GEOMETRY, geometryGolden, goldenFindings, openGolden, runGeometry, screenFindings } from './p4-geometry-common.js'
import { closeSettings, machineAction, machineRows, machinesFile, openMachinesPage, pickMachine, sameJson, waitForMachine } from './m6-common.js'
import { askedNothing, context, guard, machineFormField, machineFormControl, newDoc, ready, schemaId, setField } from './p4-profiles-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

// ---------------------------------------------------------------- the table, through its test ids

/** One row of the table by its class. @param {Harness} h @param {string} cls */
const numRow = (h, cls) => h.q('machine-number-row', { class: cls })

/** One field of a row (`feedPerMin`, `increment`). @param {Harness} h @param {string} cls @param {string} member */
const numField = (h, cls, member) => /** @type {HTMLElement | null} */ (numRow(h, cls)?.querySelector(`[data-testid="form-field"][data-field="${cls}.${member}"]`) ?? null)

/** Its text control. @param {Harness} h @param {string} cls @param {string} member */
const numInput = (h, cls, member) => /** @type {HTMLInputElement | null} */ (numField(h, cls, member)?.querySelector('input') ?? null)

/** The classes the table shows, in its order. @param {Harness} h */
const rowClasses = (h) => h.qa('machine-number-row').map((row) => row.dataset.class ?? '')

/** Whether the form's Save is off. @param {Harness} h */
const saveOff = (h) => /** @type {HTMLButtonElement | undefined} */ (machineAction(h, 'save'))?.disabled === true

/** The presets of a profile's number input, as its data lists them. @param {Harness} h @param {string} profileId @returns {any[]} */
const presetsOf = (h, profileId) => /** @type {any[]} */ (/** @type {any} */ (context(h).profiles.profile(profileId)).machineParams?.numberInput?.presets ?? [])

/** The record of a machine in the file, by name. @param {Harness} h @param {string} name @returns {Promise<any>} */
async function recordOf(h, name) {
  const file = /** @type {any} */ (await machinesFile(h))
  return (file?.machines ?? []).find((/** @type {any} */ machine) => machine.name === name) ?? null
}

/**
 * The hover over the first place `needle` stands in a line, one character into the word.
 * @param {Harness} h
 * @param {string} id
 * @param {number} line
 * @param {string} needle
 */
async function hoverOver(h, id, line, needle) {
  const text = context(h).editor.getLines(id, line, line)[0] ?? ''
  const at = text.indexOf(needle)
  if (at < 0) throw new Error(`line ${line} is ${JSON.stringify(text)}: no ${needle}`)
  return hoverAt(h, id, line, at + 2)
}

/** A string with every run of blanks taken out, for "these words are in the hover". @param {string} text */
const squash = (text) => text.replace(/\s+/g, '')

// ================================================================================================ p4-machines-numbers

scenario('p4-machines-numbers', { timeout: 600, files: REPO_FILE }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const lathePresets = presetsOf(h, 'fanuc-lathe')
  const okumaPresets = presetsOf(h, 'okuma-osp')
  const isB = lathePresets.find((preset) => preset.id === 'is-b')
  const okuma10 = okumaPresets.find((preset) => preset.id === 'okuma-10um')
  h.check('the profiles list their presets (Fanuc lathe: IS-A, IS-B, IS-C, as written; Okuma: 1 mm, 1 micron, 10 microns)', lathePresets.length >= 4 && !!isB && okumaPresets.length >= 3 && !!okuma10, { lathe: lathePresets.map((p) => p.id), okuma: okumaPresets.map((p) => p.id) })
  const before = /** @type {any} */ (await machinesFile(h))
  h.check('this configuration has no machine yet', before === null || (before.machines ?? []).length === 0, before)

  // ============================================================ A. the table
  await guard(h, 'A. the table "Numbers"', async () => {
    const opened = await openMachinesPage(h)
    await startAdd(h, 'fanuc-lathe')
    h.check('the choice of the number input lists the presets of the dialect, in the order of its data', JSON.stringify(choiceOf(h, 'numberInput').labels) === JSON.stringify(lathePresets.map((preset) => shownPreset(h, preset))), choiceOf(h, 'numberInput').labels)
    h.check('the table has five rows: length, angle, feed per minute, feed per revolution, dwell', JSON.stringify(rowClasses(h)) === JSON.stringify(['length', 'angle', 'feedPerMin', 'feedPerRev', 'dwell']), rowClasses(h))
    h.check('only the rows whose unit follows the program have a field for the inch step', !!numField(h, 'length', 'incrementInch') && !!numField(h, 'feedPerMin', 'incrementInch') && !!numField(h, 'feedPerRev', 'incrementInch') && !numField(h, 'angle', 'incrementInch') && !numField(h, 'dwell', 'incrementInch'))

    setField(h, 'numberInput', shownPreset(h, isB))
    await h.frame()
    await h.idle()
    h.check('the preset IS-B fills the table: the length in steps of its increment, and the inch step beside it', numInput(h, 'length', 'increment')?.value === isB.value.incrementMm && numInput(h, 'length', 'incrementInch')?.value === isB.value.incrementInch && numRow(h, 'length')?.dataset.mode === 'increment', { mm: numInput(h, 'length', 'increment')?.value, inch: numInput(h, 'length', 'incrementInch')?.value })
    // A machine needs a name before it can be saved (the page keeps Save off without one), so "Save is on" below is about the table only.
    setField(h, 'name', 'Lathe custom feed')
    await h.frame()
    const was = numInput(h, 'feedPerMin', 'increment')?.value ?? ''
    const wasInch = numInput(h, 'feedPerMin', 'incrementInch')?.value ?? ''
    h.check('the feed per minute row has both steps written, and Save is on', was !== '' && wasInch !== '' && !numField(h, 'feedPerMin', 'incrementInch')?.dataset.error && !saveOff(h), { was, wasInch })

    // A new metric step of a feed row.
    const step = was === '2' ? '3' : '2'
    setInput(numInput(h, 'feedPerMin', 'increment'), step)
    await h.frame()
    await h.idle()
    h.check('a new metric step of a feed row empties the inch step beside it (it belonged to the old step)', numInput(h, 'feedPerMin', 'incrementInch')?.value === '', numInput(h, 'feedPerMin', 'incrementInch')?.value)
    const field = numField(h, 'feedPerMin', 'incrementInch')
    h.check('the problem is named at that field, in words, and Save is off', field?.dataset.error === 'machineNumbers.problem' && /inch/i.test(field.querySelector('.form-error')?.textContent ?? '') && saveOff(h), { error: field?.dataset.error, text: field?.querySelector('.form-error')?.textContent })
    h.check('the choice now reads "Custom": the rules are no preset of the list', choiceOf(h, 'numberInput').selected === ctx.t('machines.value.custom'), choiceOf(h, 'numberInput').selected)

    setInput(numInput(h, 'feedPerMin', 'incrementInch'), `0.0${step}`)
    await h.frame()
    await h.idle()
    h.check('with the inch step written the problem is gone and Save is on', !numField(h, 'feedPerMin', 'incrementInch')?.dataset.error && !saveOff(h), numField(h, 'feedPerMin', 'incrementInch')?.dataset.error)

    await saveMachineForm(h, { name: 'Lathe custom feed' })
    const record = await recordOf(h, 'Lathe custom feed')
    h.check('Save wrote the machine with the table’s feed rule: the new metric step and the inch step', record?.params?.numberInput?.classes?.feedPerMin?.increment === step && record.params.numberInput.classes.feedPerMin.incrementInch === `0.0${step}`, record?.params?.numberInput)
    h.check('and kept the preset’s other rules (length in steps of the preset’s increment)', record?.params?.numberInput?.incrementMm === isB.value.incrementMm && record.params.numberInput.mode === isB.value.mode, record?.params?.numberInput)

    const file = /** @type {any} */ (await machinesFile(h))
    const want = await schemaId(h, 'machines')
    h.check('the first machine of a fresh configuration made a file that carries the $schema line', Object.keys(file ?? {})[0] === '$schema' || typeof file?.$schema === 'string', Object.keys(file ?? {}))
    h.check('pointing at the machines schema of the repository, the address the schema itself names', typeof want === 'string' && want.startsWith('https://') && file?.$schema === want, { file: file?.$schema, schema: want })
    h.check('and the file holds that one machine', (file?.machines ?? []).length === 1)
    await closeSettings(h, opened)
  })

  // ============================================================ B. built-in presets
  await guard(h, 'B. every built-in preset is saved as it is', async () => {
    const opened = await openMachinesPage(h)
    for (const [profile, presets] of /** @type {[string, any[]][]} */ ([['fanuc-lathe', lathePresets], ['okuma-osp', okumaPresets]])) {
      for (const preset of presets) {
        const name = `${profile === 'okuma-osp' ? 'Okuma' : 'Lathe'} ${preset.id}`
        await startAdd(h, profile)
        setField(h, 'numberInput', shownPreset(h, preset))
        setField(h, 'name', name)
        await h.frame()
        await h.idle()
        h.check(`${name}: with the preset chosen nothing is wrong in the table and Save is on`, !saveOff(h) && !h.q('machine-number-problems') && h.qa('machine-number-row').every((row) => !row.querySelector('[data-error]')), { rows: h.qa('machine-number-row').length })
        await saveMachineForm(h, { name })
        const record = await recordOf(h, name)
        h.check(`${name}: it was saved without a question and with the rules of the preset`, (await h.alert.visible()) === null && record !== null && (profile === 'okuma-osp' ? sameJson(record.params.numberInput, preset.value) : record.params.numberInput?.incrementMm === preset.value.incrementMm && record.params.numberInput?.mode === preset.value.mode), record?.params?.numberInput)
      }
    }
    h.check('the Okuma 10 micron preset is among them (every number scaled, metric only, marked unconfirmed in the list)', !!(await recordOf(h, 'Okuma okuma-10um')) && shownPreset(h, okuma10).includes(ctx.t('machines.value.unconfirmed')))
    await closeSettings(h, opened)
  })

  // ============================================================ C. typed as written
  await guard(h, 'C. a step typed as 0.0010 stays as typed', async () => {
    const opened = await openMachinesPage(h)
    await startAdd(h, 'fanuc-lathe')
    setField(h, 'numberInput', shownPreset(h, isB))
    await h.frame()
    await h.idle()
    setField(h, 'name', 'Lathe typed')
    await h.frame()
    const input = numInput(h, 'length', 'increment')
    const typed = `${isB.value.incrementMm}0`
    setInput(input, typed)
    await h.frame()
    await h.idle()
    h.check('the field keeps what was typed (0.0010), the zero is not eaten', numInput(h, 'length', 'increment')?.value === typed, numInput(h, 'length', 'increment')?.value)
    h.check('the value is the preset’s: the choice is still IS-B, nothing is refused', choiceOf(h, 'numberInput').selected === shownPreset(h, isB) && !numField(h, 'length', 'increment')?.dataset.error && !saveOff(h), choiceOf(h, 'numberInput').selected)
    await saveMachineForm(h, { name: 'Lathe typed' })
    const record = await recordOf(h, 'Lathe typed')
    h.check('the file holds the preset’s own 0.001, not the text typed', record?.params?.numberInput?.incrementMm === isB.value.incrementMm && record.params.numberInput.incrementMm !== typed, record?.params?.numberInput?.incrementMm)
    await closeSettings(h, opened)
  })

  // ============================================================ D. the hover
  await guard(h, 'D. the hover reads P of the second G76 block by the machine’s step', async () => {
    const program = ['O1234 (SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)', 'G21 G99', 'G00 X50. Z5.', 'G76 P011060 Q100 R0.05', 'G76 X47.5 Z-20. P1500 Q300 F1.5', 'M30', ''].join('\n')
    const probe = await openProbe(h, 'IS-B-THREAD.nc', program, 'fanuc-lathe')
    const machine = await recordOf(h, 'Lathe is-b')
    if (machine === null) throw new Error('the machine Lathe is-b was not saved by section B')
    await pickMachine(h, 'Lathe is-b')
    await waitForMachine(h, machine.id)
    const second = squash(await hoverOver(h, probe.id, 5, 'P1500'))
    h.check('with IS-B chosen the hover on P1500 of the second G76 block says it is 1.5 mm', second.includes(squash('P1500 — 1.5 mm')), second.slice(0, 300))
    const first = await hoverOver(h, probe.id, 4, 'P011060')
    h.check('and the packed P of the first block is not read as a length', !/011060\s*—\s*[\d.]+ mm/.test(first), first.slice(0, 300))
  })

  h.check('no alert was left unanswered by the sections above', await askedNothing(h))
})

// ================================================================================================ p4-machines-axes

scenario('p4-machines-axes', { timeout: 600, files: REPO_FILE }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const probe = await pythonProbe(h)
  h.check('the Python probe has answered, so Translate can run', probe?.ok === true, probe)
  const program = [
    '; SYNTHETIC TEST PROGRAM FOR GEDIT, NOT FOR A MACHINE',
    'N10 G17 G90 G54',
    'N20 G0 X0 Y0 Z50 AA=90',
    'N30 G1 X10 AA90 F200',
    'N40 G0 G810',
    'N50 M30',
    '',
  ].join('\n')
  const id = await newDoc(h, program, 'sinumerik-mill')
  const axis = ctx.t('machines.extra.axisLinear')
  const builder = squash(ctx.t('machines.extra.builderCode'))
  /** The three hovers of the program. */
  const hovers = async () => ({
    equals: squash(await hoverOver(h, id, 3, 'AA=90')),
    plain: squash(await hoverOver(h, id, 4, 'AA90')),
    code: squash(await hoverOver(h, id, 5, 'G810')),
  })

  // ============================================================ A. before
  await guard(h, 'A. without a machine', async () => {
    const said = await hovers()
    h.check('AA=90 and AA90 are no axis of anything yet, and G810 is no builder code', !said.equals.includes(squash(axis)) && !said.plain.includes(squash(axis)) && !said.code.includes(builder), said)
  })

  // ============================================================ B. the fields
  await guard(h, 'B. the two fields of the machine form', async () => {
    const opened = await openMachinesPage(h)
    await startAdd(h, 'sinumerik-mill')
    h.check('the form of a Sinumerik machine has the two fields', !!machineFormField(h, 'extraAxes') && !!machineFormField(h, 'builderCodes'))
    setField(h, 'name', 'Mill AA')
    const errorOf = (/** @type {string} */ field) => machineFormField(h, field)?.dataset.error ?? ''
    const textOf = (/** @type {string} */ field) => machineFormField(h, field)?.querySelector('.form-error')?.textContent ?? ''
    const saveOff = () => /** @type {HTMLButtonElement | undefined} */ (machineAction(h, 'save'))?.disabled === true

    setField(h, 'extraAxes', 'GOTO')
    await h.idle()
    h.check('a name that is a keyword of the profile is refused at its field, with the word named, and Save is off', errorOf('extraAxes') === 'machines.extra.problem' && textOf('extraAxes').includes('GOTO') && saveOff(), { error: errorOf('extraAxes'), text: textOf('extraAxes') })
    setField(h, 'extraAxes', 'A1')
    await h.idle()
    h.check('a word that is no axis name is refused with the way to write one', errorOf('extraAxes') === 'machines.extra.notAxis' && textOf('extraAxes') === ctx.t('machines.extra.notAxis', { item: 'A1' }) && saveOff(), { error: errorOf('extraAxes'), text: textOf('extraAxes') })
    setField(h, 'extraAxes', 'AA')
    await h.idle()
    h.check('AA is accepted', errorOf('extraAxes') === '', errorOf('extraAxes'))
    setField(h, 'builderCodes', 'G17')
    await h.idle()
    h.check('a builder code that gEdit already knows (G17) is refused at its field, and Save is off', errorOf('builderCodes') === 'machines.extra.problem' && textOf('builderCodes').includes('G17') && saveOff(), { error: errorOf('builderCodes'), text: textOf('builderCodes') })
    setField(h, 'builderCodes', 'G810-G829')
    await h.idle()
    h.check('G810-G829 is accepted, and with both fields right Save is on', errorOf('builderCodes') === '' && errorOf('extraAxes') === '' && !saveOff(), { extra: errorOf('extraAxes'), builder: errorOf('builderCodes') })
    h.check('the fields show what was typed', machineFormControl(h, 'extraAxes')?.value === 'AA' && machineFormControl(h, 'builderCodes')?.value === 'G810-G829')
    await saveMachineForm(h, {})
    const record = await recordOf(h, 'Mill AA')
    h.check('Save wrote the axis as a name and a kind, and the builder codes as typed', sameJson(record?.params?.extraAxes, [{ name: 'AA', kind: 'linear' }]) && record.params.builderCodes === 'G810-G829', record?.params)
    h.check('the page lists the machine', machineRows(h).some((row) => row.name === 'Mill AA'))
    await closeSettings(h, opened)
  })

  // ============================================================ C. the hover
  await guard(h, 'C. the hover names the axis and the builder code', async () => {
    const record = await recordOf(h, 'Mill AA')
    if (record === null) throw new Error('the machine Mill AA was not saved by section B')
    await pickMachine(h, 'Mill AA')
    await waitForMachine(h, record.id)
    const said = await hovers()
    h.check('AA=90 is named an axis of the machine', said.equals.includes(squash(axis)), said.equals.slice(0, 200))
    h.check('AA90 is named an axis of the machine as well (the machine reads it as an axis)', said.plain.includes(squash(axis)), said.plain.slice(0, 200))
    h.check('G810 is named a code of the machine builder, not an unknown code', said.code.includes(builder), said.code.slice(0, 200))
  })

  // ============================================================ D. Translate
  await guard(h, 'D. Translate leaves an extra axis as written and says so', async () => {
    const golden = await geometryGolden(h, 'translate', 'extra-axis-sinumerik-mill')
    const { c } = golden
    if (c.expected === null || c.envelope === null) throw new Error('translate/extra-axis-sinumerik-mill is not a golden that writes')
    const machineName = String(c.options.machineName)
    const machineId = await makeMachine(h, { name: machineName, profile: golden.profile, params: c.options.machine })
    const opened = await openGolden(h, golden, 'EXTRA-AXIS.MPF')
    await useMachine(h, machineId, machineName)
    const run = await runGeometry(h, GEOMETRY.translate, c.params)
    h.check('the document is the golden’s expected text, byte for byte', h.app.text() === c.expected, { got: h.app.text().split('\n').slice(0, 12), want: c.expected.split('\n').slice(0, 12) })
    h.check('the status line ends with the golden’s message', run.status.endsWith(c.envelope.message), { got: run.status, want: c.envelope.message })
    const want = goldenFindings(c.envelope.findings)
    const shown = screenFindings(h)
    h.check('the Results panel holds the golden’s findings, in order, and nothing else', JSON.stringify(shown) === JSON.stringify(want), { got: shown, want })
    h.check('one of them is the information row for the linear extra axis: AA is an extra axis of the machine and was left as written', shown.some((row) => /AA is an extra axis of the machine/.test(row) && /^\d+\|info\|/.test(row)), shown)
    h.check('the rotary extra axis (QQ) gets no row of its own', !shown.some((row) => /QQ is an extra axis/.test(row)), shown)
    h.check('the words of AA are still there in the result', /AA15\.5/.test(h.app.text()) && /AA=25/.test(h.app.text()) && opened.id !== '')
  })

  h.check('no alert was left unanswered by the sections above', await askedNothing(h))
})
