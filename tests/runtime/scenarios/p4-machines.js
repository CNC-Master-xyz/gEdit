// P4b, "Drilling cycles and time": the page "Motion and limits" of the machine form (plan docs/planning/phase-4-implementation.md,
// §6.4 rules 2 to 4, AD-46, H4b; X25 as the running app proves it: the page half; the check half is `p4-cycles-time`).
//
//   A. The page          on Add: below the machine's own fields, the unit first, one rapid field and one pair of travel ends per axis of
//                        the dialect, the labels that carry the unit chosen (mm/min, inch/min, degrees/min for a rotary axis), every
//                        field empty, the note that gEdit assumes nothing; an Add with the page untouched stores neither block
//   B. Refusals          a value outside its bound is refused next to its field with the bound named, in mm and in inch, at the bound itself
//                        and one step above it; a length or a rate with no unit chosen; half a travel; Save is disabled for as long as
//                        one field fails; then every field valid, Save, and `machines.json` holds the two blocks as the page writes them
//   C. Read back         Edit shows the saved values, with no problem list
//   D. A hand edit       a `machines.json` edited by hand (the two blocks in different units, each valid on its own): a page the user
//                        did not touch keeps both blocks exactly as written while the name or the notes change; a page the user touched
//                        rewrites both from its fields, and asks for the unit first
//   E. A broken block    blocks with problems: the machine row lists each problem with its JSON path, the page lists them with "Start this
//                        page again", an untouched page keeps the blocks as written (the machine is still in use), "Start this page again"
//                        and Save removes both
//
// **The file is the contract, not the list on screen**: every step is judged by `h.config.read('machines.json')` (m6-common). The
// numbers of every expected block are typed in this scenario, never read back from the app; the bounds are the plan's (§6.4 rule 2:
// 200,000 mm/min for a linear rate, 1,000,000 degrees/min for a rotary rapid, 600 s for a tool change, 100 mm for a peck, 200,000 rpm,
// +-100,000 for a travel end; an inch value is held to the bound divided by 25.4 and shown cut to two places: 7,874.01). The
// wording of a message is the app's own (`ctx.t`), never typed here. A section that throws is one failed check (`m10-common.guard`).
//
// **A field of the page is found inside the page** (`motionField`): the machine's own form has a field called `units` as well (the
// units the machine's programs are written in), so `h.q('form-field', { field: 'units' })` is the other one.

import { scenario } from '../lib/index.js'
import { configPaths, setInput } from './m2-common.js'
import { guard, ready } from './m10-common.js'
import {
  clickMachineAction,
  closeSettings,
  context,
  machineAction,
  machineRows,
  machinesFile,
  openMachinesPage,
  sameJson,
} from './m6-common.js'
import { setField } from './m4-common.js'
import { startAdd } from './m8-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

// ---------------------------------------------------------------- the page, read and written through its test ids

/** The page's own form (`machine-motion-form`), or null while the machine form shows none. @param {Harness} h */
const motionForm = (h) => h.q('machine-motion-form')

/**
 * The wrapper of one field of the page, by its `data-field`.
 * @param {Harness} h
 * @param {string} field e.g. `rapid.X`, `travel.A.min`, `spindle.main`
 */
const motionField = (h, field) => /** @type {HTMLElement | null} */ (motionForm(h)?.querySelector(`[data-testid="form-field"][data-field="${CSS.escape(field)}"]`) ?? null)

/** The ids of the page's fields, in the order they are on screen. @param {Harness} h */
const motionFieldIds = (h) => [...(motionForm(h)?.querySelectorAll('[data-testid="form-field"]') ?? [])].map((e) => /** @type {HTMLElement} */ (e).dataset.field ?? '')

/** The fields inside one of the page's groups (`motion-units`, `motion-rapid`, `motion-travel`). @param {Harness} h @param {string} group */
const fieldsIn = (h, group) => [...(h.q(group)?.querySelectorAll('[data-testid="form-field"]') ?? [])].map((e) => /** @type {HTMLElement} */ (e).dataset.field ?? '')

/** The label above a field. @param {Harness} h @param {string} field */
const labelOf = (h, field) => motionField(h, field)?.querySelector('label')?.textContent?.trim() ?? ''

/** What a number or text field of the page holds, `null` when it is not there. @param {Harness} h @param {string} field */
const valueOf = (h, field) => /** @type {HTMLInputElement | null} */ (motionField(h, field)?.querySelector('input'))?.value ?? null

/** The label of the option a choice field of the page shows. @param {Harness} h @param {string} field */
const pickedOf = (h, field) => /** @type {HTMLSelectElement | null} */ (motionField(h, field)?.querySelector('select'))?.selectedOptions[0]?.textContent?.trim() ?? ''

/**
 * Types into a field of the page: a number or text as it is, a choice by its label.
 * @param {Harness} h
 * @param {string} field
 * @param {string | number} value
 */
function put(h, field, value) {
  const control = /** @type {HTMLInputElement | HTMLSelectElement | null} */ (motionField(h, field)?.querySelector('input, select'))
  if (!control) throw new Error(`the page has no field ${JSON.stringify(field)}; it has ${motionFieldIds(h).join(', ')}`)
  if (control instanceof HTMLSelectElement) {
    const option = [...control.options].find((o) => o.textContent?.trim() === String(value))
    if (!option) throw new Error(`field ${field}: no option ${JSON.stringify(value)} in ${[...control.options].map((o) => o.textContent?.trim()).join('|')}`)
    h.select(control, option.value)
  } else {
    setInput(control, String(value))
  }
}

/**
 * The error a field of the page shows: the message key (`data-error`, §7.9) and the text.
 * @param {Harness} h
 * @param {string} field
 */
function errorOf(h, field) {
  const wrapper = motionField(h, field)
  return { key: wrapper?.dataset.error ?? null, text: wrapper?.querySelector('.form-error')?.textContent?.trim() ?? null }
}

/** The fields of the page that fail now. @param {Harness} h */
const failing = (h) => [...(motionForm(h)?.querySelectorAll('[data-testid="form-field"][data-error]') ?? [])].map((e) => /** @type {HTMLElement} */ (e).dataset.field ?? '')

/** Whether Save is off. @param {Harness} h */
const saveOff = (h) => /** @type {HTMLButtonElement | undefined} */ (machineAction(h, 'save'))?.disabled === true

/** Clicks Save and waits until the list is back. @param {Harness} h */
async function save(h) {
  const button = /** @type {HTMLButtonElement | undefined} */ (machineAction(h, 'save'))
  if (button === undefined) throw new Error('the form has no Save button')
  if (button.disabled) throw new Error(`Save is disabled (the page fails at ${JSON.stringify(failing(h))})`)
  h.click(button)
  await h.waitFor(() => !h.q('machine-form'), { timeout: 10000 })
  await h.idle()
}

/**
 * The record of one machine in `machines.json`, by its name, with its position in the file.
 * @param {Harness} h
 * @param {string} name
 */
async function stored(h, name) {
  const file = /** @type {any} */ (await machinesFile(h))
  const at = (file?.machines ?? []).findIndex((/** @type {any} */ m) => m.name === name)
  return { at, record: at < 0 ? null : file.machines[at], file }
}

/** Opens the machine form of a listed machine. @param {Harness} h @param {string} name */
async function edit(h, name) {
  const row = machineRows(h).find((r) => r.name === name)
  if (!row) throw new Error(`no machine ${name} in ${JSON.stringify(machineRows(h).map((r) => r.name))}`)
  await clickMachineAction(h, 'edit', row.id)
  if (!(await h.waitFor(() => h.q('machine-form')?.dataset.kind === 'edit' && motionForm(h), { timeout: 8000 }))) throw new Error(`Edit of ${name} opened no form with the page`)
}

/** The values every field of the page gets in section B, and the blocks they make. */
const VALID = {
  units: 'mm',
  'rapid.X': 30000,
  'rapid.Y': 30000,
  'rapid.Z': 20000,
  'rapid.A': 18000,
  rapidKind: 'per-axis',
  maxFeed: 5000,
  toolChange: 4,
  peckRetract: 0.5,
  peckClearance: 1,
  'spindle.main': 8000,
  'spindle.others': 'S2=4000',
  'travel.X.min': -800,
  'travel.X.max': 0,
  'travel.Y.min': -500,
  'travel.Y.max': 0,
  'travel.Z.min': -600,
  'travel.Z.max': 0,
}
/** The two fields of the page that are choices are picked by the label the app shows, which is the app's own wording. @type {Record<string, string>} */
const SHOWN = {}
const MOTION_B = { units: 'mm', rapid: { X: 30000, Y: 30000, Z: 20000, A: 18000 }, rapidKind: 'per-axis', maxFeed: 5000, toolChange: 4, peckRetract: 0.5, peckClearance: 1 }
const LIMITS_B = { units: 'mm', spindle: { main: 8000, S2: 4000 }, travel: { X: { min: -800, max: 0 }, Y: { min: -500, max: 0 }, Z: { min: -600, max: 0 } } }

scenario('p4-machines', { timeout: 600 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const paths = configPaths(ctx)
  const axes = /** @type {string[]} */ ([...(ctx.profiles.profile('fanuc-gcode').addresses?.axes ?? [])])
  const angular = /** @type {string[]} */ ([...(ctx.profiles.profile('fanuc-gcode').addresses?.angular ?? [])])
  h.check('the Fanuc milling dialect has the nine axes the page is checked against, A, B and C of them rotary (a page of this scenario that is wrong about the axes fails here first)', axes.join('') === 'XYZABCUVW' && angular.join('') === 'ABC', { axes, angular })

  SHOWN.units = ctx.t('machines.motion.unitMm')
  SHOWN.rapidKind = ctx.t('machines.motion.kindPerAxis')
  const page = await openMachinesPage(h)

  // =============================================================== A. what the page is
  await guard(h, 'A. the page', async () => {
    await startAdd(h, 'fanuc-gcode')
    const step = h.q('machine-motion-step')
    const follows = (/** @type {Node | null | undefined} */ a, /** @type {Node | null | undefined} */ b) => !!a && !!b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    h.check('Add of a milling machine ends with the page "Motion and limits", after the machine\u2019s own fields and before Save', !!step && !!motionForm(h) && step.contains(motionForm(h)) && follows(h.q('form-field', { field: 'name' }), step) && follows(step, machineAction(h, 'save')), { step: !!step })
    h.check('the page has its title and the note that every value comes from the machine’s documentation and that gEdit assumes none', (motionForm(h)?.querySelector('h3')?.textContent?.trim() ?? '') === ctx.t('machines.motion.title') && (h.q('motion-note')?.textContent?.trim() ?? '') === ctx.t('machines.motion.note'), { title: motionForm(h)?.querySelector('h3')?.textContent, note: h.q('motion-note')?.textContent })

    const wantFields = ['units', ...axes.map((a) => `rapid.${a}`), 'rapidKind', 'maxFeed', 'toolChange', 'peckRetract', 'peckClearance', 'spindle.main', 'spindle.others', ...axes.flatMap((a) => [`travel.${a}.min`, `travel.${a}.max`])]
    h.check('its fields, in order: the unit first, one rapid rate per axis of the dialect, the rapid kind, the top feed, the tool change, the two peck values, the spindle speeds, then both travel ends of every axis', JSON.stringify(motionFieldIds(h)) === JSON.stringify(wantFields), { got: motionFieldIds(h), want: wantFields })
    h.check('the unit is in a group of its own above the rapid rates and the travel (the unit is chosen first)', JSON.stringify(fieldsIn(h, 'motion-units')) === JSON.stringify(['units']) && JSON.stringify(fieldsIn(h, 'motion-rapid')) === JSON.stringify(axes.map((a) => `rapid.${a}`)) && JSON.stringify(fieldsIn(h, 'motion-travel')) === JSON.stringify(axes.flatMap((a) => [`travel.${a}.min`, `travel.${a}.max`])) && follows(h.q('motion-units'), h.q('motion-rapid')) && follows(h.q('motion-rapid'), h.q('motion-travel')), { units: fieldsIn(h, 'motion-units'), rapid: fieldsIn(h, 'motion-rapid').length, travel: fieldsIn(h, 'motion-travel').length })
    h.check('no value is there to begin with: the unit says "Not set" and every other field is empty (nothing is assumed, Q4-10)', pickedOf(h, 'units') === ctx.t('machines.motion.unitsNotSet') && pickedOf(h, 'rapidKind') === ctx.t('machines.motion.kindNotSet') && motionFieldIds(h).filter((f) => f !== 'units' && f !== 'rapidKind').every((f) => valueOf(h, f) === ''), { units: pickedOf(h, 'units'), kind: pickedOf(h, 'rapidKind'), filled: motionFieldIds(h).filter((f) => valueOf(h, f)) })
    h.check('there is no list of problems on an Add', !h.q('motion-problems') && !h.q('motion-start-again'))

    // The labels carry the unit that is chosen.
    const rate = (/** @type {string} */ axis, /** @type {string} */ unit) => ctx.t('machines.motion.rapid', { axis, unit })
    h.check('with no unit chosen the labels say so: "per minute" for a rate, "chosen unit" for a length', labelOf(h, 'rapid.X') === rate('X', ctx.t('machines.motion.perMinute')) && labelOf(h, 'travel.X.min') === ctx.t('machines.motion.travelMin', { axis: 'X', unit: ctx.t('machines.motion.chosenUnit') }) && labelOf(h, 'peckRetract') === ctx.t('machines.motion.peckRetract', { unit: ctx.t('machines.motion.chosenUnit') }), { rapid: labelOf(h, 'rapid.X'), travel: labelOf(h, 'travel.X.min'), peck: labelOf(h, 'peckRetract') })
    put(h, 'units', ctx.t('machines.motion.unitMm'))
    await h.idle()
    h.check('in millimetres: mm/min for a linear axis, degrees/min for a rotary one, mm for a travel end and degrees for a rotary travel end', labelOf(h, 'rapid.X') === rate('X', 'mm/min') && labelOf(h, 'rapid.A') === rate('A', ctx.t('machines.motion.degreesPerMinute')) && labelOf(h, 'maxFeed') === ctx.t('machines.motion.maxFeed', { unit: 'mm/min' }) && labelOf(h, 'travel.Z.max') === ctx.t('machines.motion.travelMax', { axis: 'Z', unit: 'mm' }) && labelOf(h, 'travel.A.max') === ctx.t('machines.motion.travelMax', { axis: 'A', unit: ctx.t('machines.motion.degrees') }), { rapidX: labelOf(h, 'rapid.X'), rapidA: labelOf(h, 'rapid.A'), maxFeed: labelOf(h, 'maxFeed'), travelZ: labelOf(h, 'travel.Z.max'), travelA: labelOf(h, 'travel.A.max') })
    put(h, 'units', ctx.t('machines.motion.unitInch'))
    await h.idle()
    h.check('in inches: inch/min, inch, and the rotary labels unchanged', labelOf(h, 'rapid.X') === rate('X', 'inch/min') && labelOf(h, 'rapid.A') === rate('A', ctx.t('machines.motion.degreesPerMinute')) && labelOf(h, 'travel.Z.max') === ctx.t('machines.motion.travelMax', { axis: 'Z', unit: 'inch' }), { rapidX: labelOf(h, 'rapid.X'), rapidA: labelOf(h, 'rapid.A'), travelZ: labelOf(h, 'travel.Z.max') })

    // Two controls of the page share an id with a control of the machine's own form (`units`), so the label of the one points at the other.
    const ids = [...document.querySelectorAll('.machines [id]')].map((e) => e.id)
    const duplicates = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]
    h.check('no two controls of the machine form share an id (a label has to point at its own control: the unit of the page and the units of the machine’s programs are two fields)', duplicates.length === 0, duplicates)
    await clickMachineAction(h, 'cancel')
    h.check('Cancel closes the form and writes nothing', !h.q('machine-form') && (await machinesFile(h)) === null, await machinesFile(h))
  })

  await guard(h, 'A2. an untouched page', async () => {
    await startAdd(h, 'fanuc-gcode')
    setField(h, 'name', 'Mill A')
    await h.frame()
    h.check('with the page untouched Save is on, whatever the empty fields', !saveOff(h))
    await save(h)
    const { record } = await stored(h, 'Mill A')
    h.check('a machine added with the page untouched stores neither a motion nor a limits block', record !== null && !('motion' in record.params) && !('limits' in record.params), record?.params)
  })

  // =============================================================== B. the refusals, then a valid page
  await guard(h, 'B. refusals and Save', async () => {
    await startAdd(h, 'fanuc-gcode')
    setField(h, 'name', 'Mill B')
    await h.frame()
    h.check('with a name and the page untouched Save is on', !saveOff(h))

    /**
     * A value that has to be refused: the error is on its field with its key and its text (the bound named), no other field fails and Save is off; then the field is put back.
     * @param {string} label
     * @param {string} field
     * @param {string | number} value
     * @param {string} key
     * @param {Record<string, string | number>} [params]
     * @param {string | number} [back] what the field is given afterwards
     */
    const refused = async (label, field, value, key, params, back = '') => {
      put(h, field, value)
      await h.idle()
      const got = errorOf(h, field)
      h.check(`${label}: ${field} = ${JSON.stringify(value)} is refused next to the field, with the bound`, got.key === key && got.text === ctx.t(key, params), { got, wantKey: key, wantText: ctx.t(key, params) })
      h.check(`${label}: it is the only field that fails, and Save is off`, JSON.stringify(failing(h)) === JSON.stringify([field]) && saveOff(h), { failing: failing(h), saveOff: saveOff(h) })
      put(h, field, back)
      await h.idle()
    }
    /**
     * A value at the bound itself: accepted, nothing fails and Save is on.
     * @param {string} label
     * @param {string} field
     * @param {string | number} value
     */
    const accepted = async (label, field, value) => {
      put(h, field, value)
      await h.idle()
      h.check(`${label}: ${field} = ${JSON.stringify(value)} is accepted: nothing fails and Save is on`, failing(h).length === 0 && !saveOff(h), { failing: failing(h), saveOff: saveOff(h) })
      put(h, field, '')
      await h.idle()
    }

    // a rate with no unit chosen
    put(h, 'rapid.X', 30000)
    await h.idle()
    const noUnit = errorOf(h, 'units')
    h.check('a rate typed before a unit is chosen: the error is on the unit field ("choose mm or inch first"), and Save is off', noUnit.key === 'machines.motion.err.units' && noUnit.text === ctx.t('machines.motion.err.units') && JSON.stringify(failing(h)) === JSON.stringify(['units']) && saveOff(h), { noUnit, failing: failing(h) })
    put(h, 'units', ctx.t('machines.motion.unitMm'))
    await h.idle()
    h.check('choosing mm takes the error away and Save is on again', failing(h).length === 0 && !saveOff(h), { failing: failing(h) })
    put(h, 'rapid.X', '')
    await h.idle()

    // millimetres
    await refused('mm', 'rapid.X', 250000, 'machines.motion.err.above0', { max: '200,000' })
    await refused('mm', 'rapid.X', 0, 'machines.motion.err.above0', { max: '200,000' })
    await accepted('mm, the bound itself', 'rapid.X', 200000)
    await refused('mm', 'rapid.A', 1000001, 'machines.motion.err.above0', { max: '1,000,000' })
    await accepted('mm, a rotary rate at its own bound', 'rapid.A', 1000000)
    await refused('mm', 'maxFeed', 200001, 'machines.motion.err.above0', { max: '200,000' })
    await refused('mm', 'toolChange', -1, 'machines.motion.err.from0', { max: '600' })
    await refused('mm', 'toolChange', 601, 'machines.motion.err.from0', { max: '600' })
    await accepted('mm, 0 s of tool change', 'toolChange', 0)
    await refused('mm', 'peckRetract', 101, 'machines.motion.err.above0', { max: '100' })
    await refused('mm', 'peckClearance', 0, 'machines.motion.err.above0', { max: '100' })
    await refused('mm', 'spindle.main', 200001, 'machines.motion.err.above0', { max: '200,000' })
    await refused('mm', 'spindle.others', 'S2=abc', 'machines.motion.err.otherSpeed', { address: 'S2', max: '200,000' })
    await refused('mm', 'spindle.others', 'junk', 'machines.motion.err.spindles', { part: 'junk' })
    await accepted('mm, two other spindles', 'spindle.others', 'S2=4000, SB=3000')

    // a travel needs both ends, and the lower one below the upper
    put(h, 'travel.X.max', 0)
    await h.idle()
    const half = errorOf(h, 'travel.X.min')
    h.check('only the highest end of a travel: the other end is asked for, and Save is off', half.key === 'machines.motion.err.bothEnds' && half.text === ctx.t('machines.motion.err.bothEnds') && JSON.stringify(failing(h)) === JSON.stringify(['travel.X.min']) && saveOff(h), { half, failing: failing(h) })
    await refused('mm', 'travel.X.min', -100001, 'machines.motion.err.between', { max: '100,000' }, -800)
    h.check('both ends given (-800 and 0): the travel is accepted', failing(h).length === 0 && !saveOff(h), { failing: failing(h) })
    put(h, 'travel.X.max', -800)
    await h.idle()
    const same = errorOf(h, 'travel.X.max')
    h.check('both ends the same: the lowest has to be below the highest, said next to the highest', same.key === 'machines.motion.err.minMax' && same.text === ctx.t('machines.motion.err.minMax') && JSON.stringify(failing(h)) === JSON.stringify(['travel.X.max']) && saveOff(h), { same, failing: failing(h) })
    put(h, 'travel.X.min', '')
    put(h, 'travel.X.max', '')
    await h.idle()
    h.check('both ends emptied: no travel, nothing fails', failing(h).length === 0 && !saveOff(h), { failing: failing(h) })

    // inches: the bound is the mm bound divided by 25.4, shown cut to two places
    put(h, 'units', ctx.t('machines.motion.unitInch'))
    await h.idle()
    await refused('inch', 'rapid.X', 200000, 'machines.motion.err.above0', { max: '7,874.01' })
    await refused('inch', 'rapid.X', 7874.02, 'machines.motion.err.above0', { max: '7,874.01' })
    await accepted('inch, the bound as it is shown', 'rapid.X', 7874.01)
    await refused('inch', 'peckRetract', 4, 'machines.motion.err.above0', { max: '3.93' })
    await accepted('inch, a rotary rate keeps its own bound', 'rapid.A', 1000000)
    put(h, 'travel.Y.min', -100)
    await refused('inch', 'travel.Y.max', 4000, 'machines.motion.err.between', { max: '3,937' })
    put(h, 'travel.Y.min', '')
    await h.idle()

    // the whole page, valid
    for (const [field, value] of Object.entries(VALID)) put(h, field, SHOWN[field] ?? value)
    await h.idle()
    h.check('every field of the page typed, nothing fails and Save is on', failing(h).length === 0 && !saveOff(h), { failing: failing(h) })
    h.check('the rate labels show the unit that was chosen last', labelOf(h, 'rapid.X') === ctx.t('machines.motion.rapid', { axis: 'X', unit: 'mm/min' }), labelOf(h, 'rapid.X'))
    await save(h)
    const { record, file } = await stored(h, 'Mill B')
    h.check('Save writes the two blocks as the page makes them: the motion block with the unit first, the limits block with the spindle speeds by address and the travel by axis', record !== null && sameJson(record.params.motion, MOTION_B) && sameJson(record.params.limits, LIMITS_B), { motion: record?.params?.motion, limits: record?.params?.limits })
    h.check('and the other machine, added with the page untouched, still has neither', sameJson(file.machines.find((/** @type {any} */ m) => m.name === 'Mill A')?.params?.motion, undefined) && file.machines.find((/** @type {any} */ m) => m.name === 'Mill A')?.params?.limits === undefined, file.machines.map((/** @type {any} */ m) => m.name))
    h.check('the row lists the machine with no problem', machineRows(h).find((r) => r.name === 'Mill B')?.problems === 0, machineRows(h).map((r) => `${r.name}:${r.problems}`))
  })

  // =============================================================== C. read back
  await guard(h, 'C. read back', async () => {
    await edit(h, 'Mill B')
    h.check('Edit shows the saved values: the unit, every rate, the kind, the top feed, the tool change, the pecks, the spindles and the travel', pickedOf(h, 'units') === ctx.t('machines.motion.unitMm') && pickedOf(h, 'rapidKind') === ctx.t('machines.motion.kindPerAxis') && Object.entries(VALID).filter(([f]) => f !== 'units' && f !== 'rapidKind').every(([f, v]) => valueOf(h, f) === String(v)), Object.fromEntries(motionFieldIds(h).map((f) => [f, valueOf(h, f)])))
    h.check('the axes the page was given no value for are empty', ['rapid.B', 'rapid.C', 'rapid.U', 'travel.A.min', 'travel.W.max'].every((f) => valueOf(h, f) === ''))
    h.check('and no problem is listed for a block that is usable', !h.q('motion-problems') && failing(h).length === 0 && !saveOff(h))
    await clickMachineAction(h, 'cancel')
  })

  // =============================================================== D. a hand edit
  await guard(h, 'D. a hand edit', async () => {
    // The two blocks in different units: each is valid on its own, the page has one unit for both.
    const before = /** @type {any} */ (await machinesFile(h))
    const handEdited = structuredClone(before)
    const target = handEdited.machines.find((/** @type {any} */ m) => m.name === 'Mill B')
    target.params.limits.units = 'inch'
    await h.disk.write(paths.machinesFile, `${JSON.stringify(handEdited, null, 2)}\n`)
    await /** @type {any} */ (ctx).machines.reloadFromDisk()
    await h.idle()
    h.check('the hand edit is on disk and the machine is still listed with no problem: each block is valid in its own unit', sameJson(await machinesFile(h), handEdited) && machineRows(h).find((r) => r.name === 'Mill B')?.problems === 0, machineRows(h).map((r) => `${r.name}:${r.problems}`))

    await edit(h, 'Mill B')
    h.check('Edit shows no unit for it (the two blocks disagree), and no problem', pickedOf(h, 'units') === ctx.t('machines.motion.unitsNotSet') && !h.q('motion-problems'), { units: pickedOf(h, 'units') })
    setField(h, 'notes', 'hand edited')
    await h.frame()
    h.check('with the page untouched Save is on although the page has no unit', !saveOff(h))
    await save(h)
    const kept = await stored(h, 'Mill B')
    h.check('Save with the page untouched writes the notes and keeps both blocks exactly as written by hand (the motion in mm, the limits in inch)', kept.record?.notes === 'hand edited' && sameJson(kept.record?.params?.motion, MOTION_B) && sameJson(kept.record?.params?.limits, { ...LIMITS_B, units: 'inch' }), { notes: kept.record?.notes, motion: kept.record?.params?.motion, limits: kept.record?.params?.limits })

    // A touched page rewrites both blocks from its fields.
    await edit(h, 'Mill B')
    put(h, 'maxFeed', 6000)
    await h.idle()
    const needsUnit = errorOf(h, 'units')
    h.check('a field changed on that page asks for the unit first: the error is on the unit and Save is off', needsUnit.key === 'machines.motion.err.units' && saveOff(h), { needsUnit, failing: failing(h) })
    put(h, 'units', ctx.t('machines.motion.unitMm'))
    await h.idle()
    h.check('with the unit chosen Save is on', failing(h).length === 0 && !saveOff(h), { failing: failing(h) })
    await save(h)
    const rewritten = await stored(h, 'Mill B')
    h.check('a touched page rewrites both blocks from its fields: the new top feed, and the limits now in the unit the page has', sameJson(rewritten.record?.params?.motion, { ...MOTION_B, maxFeed: 6000 }) && sameJson(rewritten.record?.params?.limits, LIMITS_B), { motion: rewritten.record?.params?.motion, limits: rewritten.record?.params?.limits })
    h.check('and everything else of the record is as it was', rewritten.record?.notes === 'hand edited' && rewritten.record?.id === kept.record?.id && sameJson(rewritten.record?.params?.numberInput, kept.record?.params?.numberInput), { notes: rewritten.record?.notes })
  })

  // =============================================================== E. a broken block
  await guard(h, 'E. a broken block', async () => {
    const BROKEN_MOTION = { units: 'mm', rapid: { X: 'fast', Q: 5 }, speedy: true, toolChange: 9999 }
    const BROKEN_LIMITS = { units: 'mm', spindle: { main: -5 }, travel: { X: { min: 10, max: 5 } } }
    // The problems, each with the JSON path of the member in the file.
    // The file is read as sorted JSON, so the order of two members of one object is not the order they were typed in: the paths are compared as a set.
    const wantTail = ['params.limits.spindle.main', 'params.limits.travel.X', 'params.motion.rapid.Q', 'params.motion.rapid.X', 'params.motion.speedy', 'params.motion.toolChange']
    const before = /** @type {any} */ (await machinesFile(h))
    const base = before.machines.find((/** @type {any} */ m) => m.name === 'Mill B')
    // "Zulu" is first in the file and last by name, "Alpha" the other way round: the path of a problem is the record's place in the file.
    const zulu = { ...structuredClone(base), id: 'zulu', name: 'Zulu', notes: '' }
    zulu.params.motion = BROKEN_MOTION
    zulu.params.limits = BROKEN_LIMITS
    const alpha = { ...structuredClone(base), id: 'alpha', name: 'Alpha', notes: '' }
    alpha.params.motion = { units: 'mm', toolChange: 4 }
    delete alpha.params.limits
    const written = { ...before, machines: [zulu, alpha] }
    await h.disk.write(paths.machinesFile, `${JSON.stringify(written, null, 2)}\n`)
    await /** @type {any} */ (ctx).machines.reloadFromDisk()
    await h.idle()

    const rows = machineRows(h)
    const row = rows.find((r) => r.name === 'Zulu')
    h.check('both machines are listed, and the broken blocks cost the blocks and nothing else: Zulu can still be edited, copied, made the default or removed', rows.length === 2 && !!row && ['edit', 'duplicate', 'default', 'remove'].every((a) => /** @type {HTMLButtonElement | undefined} */ (machineAction(h, a, row.id))?.disabled === false), rows.map((r) => `${r.name}:${r.problems}`))
    h.check(`the row of the machine with the broken blocks counts ${wantTail.length} problems and the healthy one none`, row?.problems === wantTail.length && rows.find((r) => r.name === 'Alpha')?.problems === 0, rows.map((r) => `${r.name}:${r.problems}`))
    /** The problems of one row as the page prints them: the path and the message. @param {HTMLElement} element */
    const printed = (element) => [...element.querySelectorAll('.problem')].map((li) => li.textContent?.trim() ?? '')
    const lines = row ? printed(row.element) : []
    const pathsShown = lines.map((line) => line.split(': ')[0])
    h.check('each problem is listed with the JSON path of the member in the file, and a message after it', lines.length === wantTail.length && lines.every((line) => /^machines\[\d+\]\.params\.(motion|limits)\..+: .{12,}/.test(line)) && JSON.stringify(pathsShown.map((p) => p.replace(/^machines\[\d+\]\./, '')).sort()) === JSON.stringify(wantTail), { lines })
    h.check('the path names the record’s place in the file: Zulu is machines[0], although the list is by name and puts Alpha first', pathsShown.every((p) => p.startsWith('machines[0].')), { pathsShown })
    h.check('the healthy machine with its own motion block lists nothing', row !== undefined && printed(rows.find((r) => r.name === 'Alpha')?.element ?? document.body).length === 0)

    // Edit: the page lists the problems and offers to start again; an untouched page keeps the blocks.
    await edit(h, 'Zulu')
    const listed = [...(h.q('motion-problems')?.querySelectorAll('.problem') ?? [])].map((li) => li.textContent?.trim() ?? '')
    h.check('Edit of that machine: the page lists the same problems (with the title and the note that the block is kept as written) and offers "Start this page again"', listed.length === wantTail.length && JSON.stringify(listed.map((l) => l.split(': ')[0].replace(/^machines\[\d+\]\./, '')).sort()) === JSON.stringify(wantTail) && !!h.q('motion-start-again') && (h.q('motion-problems')?.textContent ?? '').includes(ctx.t('machines.motion.problemsTitle')), { listed })
    h.check('Save is on: the blocks only listed are not errors of the form', !saveOff(h))
    setField(h, 'notes', 'left alone')
    await h.frame()
    await save(h)
    const untouched = await stored(h, 'Zulu')
    h.check('Save with the page untouched keeps both broken blocks exactly as they were written, whatever else changed (the notes)', untouched.record?.notes === 'left alone' && sameJson(untouched.record?.params?.motion, BROKEN_MOTION) && sameJson(untouched.record?.params?.limits, BROKEN_LIMITS), { motion: untouched.record?.params?.motion, limits: untouched.record?.params?.limits })
    h.check('and the file keeps the machines in the order they were in', JSON.stringify(untouched.file.machines.map((/** @type {any} */ m) => m.name)) === JSON.stringify(['Zulu', 'Alpha']), untouched.file.machines.map((/** @type {any} */ m) => m.name))

    // Start this page again, then Save: both blocks go.
    await edit(h, 'Zulu')
    h.click(h.q('motion-start-again'))
    await h.idle()
    h.check('"Start this page again" empties the page: no problem listed, every field empty, no unit', !h.q('motion-problems') && motionFieldIds(h).every((f) => (f === 'units' ? pickedOf(h, f) === ctx.t('machines.motion.unitsNotSet') : f === 'rapidKind' ? pickedOf(h, f) === ctx.t('machines.motion.kindNotSet') : valueOf(h, f) === '')) && failing(h).length === 0, { listed: !!h.q('motion-problems'), failing: failing(h) })
    await save(h)
    const cleared = await stored(h, 'Zulu')
    h.check('Save then removes both blocks from the record, and leaves the healthy machine’s block alone', cleared.record !== null && !('motion' in cleared.record.params) && !('limits' in cleared.record.params) && sameJson(cleared.file.machines.find((/** @type {any} */ m) => m.name === 'Alpha')?.params?.motion, { units: 'mm', toolChange: 4 }), { params: cleared.record?.params })
    h.check('and the row has no problem any more', machineRows(h).find((r) => r.name === 'Zulu')?.problems === 0, machineRows(h).map((r) => `${r.name}:${r.problems}`))
  })

  await closeSettings(h, page)
})
