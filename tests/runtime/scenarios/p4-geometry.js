// P4a, "Move the path": Translate, Rotate and Mirror, the three built-in geometry scripts of Phase 4 (plan
// docs/planning/phase-4-implementation.md, H4a; X19 to X22 as the running app proves them).
//
//   A. Translate        the golden `translate/fanuc-mill-shift` from the Tools tab: the form, the result, one undo
//   B. Rotate           `rotate/fanuc-mill-90`: a clean run lists nothing, one undo
//   C. Mirror           `mirror/fanuc-mill-x-decimal` (the swapped G2/G3/G41/G42, the warnings listed) and, for a
//                       turning program, `mirror/lathe-z-counter-spindle` (the Z mirror for the counter spindle)
//   D. Refused runs     one refused golden per script (`translate/fanuc-mill-frames-settings`, `rotate/fanuc-mill-refused`,
//                       `mirror/fanuc-mill-refused`): the document is untouched and every refused block is a row in Results
//
// **Everything is started from the Tools tab**, in the group "Built-in Scripts" (`p4-geometry-common.runGeometry`), the
// way the owner starts it; the form is filled by the field ids the golden README pins. **Every expected answer is a
// golden** (`tests/fixtures/scripts/**`): the program is `input.nc` byte for byte, the result `expected.nc` byte for
// byte, the status line ends with the golden's `message`, the Results panel holds the golden's findings (line, severity
// and words, in order), and one undo takes the document back to `input.nc`. A refused run hands the text back
// unchanged (Q4-1): the document is the same bytes and was never marked as changed.
//
// Why a single scenario: each section needs the app for a few seconds and the Python interpreter is started per run,
// so the sections share one app (the run takes about two minutes on the hosted runner). A section that throws is one
// failed check (`m10-common.guard`) and does not take the others down.

import { scenario } from '../lib/index.js'
import { guard, ready, ribbonTab, undo } from './m10-common.js'
import { pythonProbe, redo } from './m5-common.js'
import { ribbonGroups } from './p3b-common.js'
import {
  FORM_IDS,
  GEOMETRY,
  context,
  fieldChoice,
  fieldNumber,
  geometryGolden,
  goldenFindings,
  openGolden,
  read,
  runGeometry,
  screenFindings,
  scriptService,
} from './p4-geometry-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */
/** @typedef {'translate' | 'rotate' | 'mirror'} Script */

scenario('p4-geometry', { timeout: 900 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const probe = await pythonProbe(h)
  h.check('the Python probe has answered, so the scripts can run', probe?.ok === true, probe)

  /** The Results panel's text, and whether it is up. */
  const resultsText = () => h.q('results-panel')?.textContent ?? ''

  /**
   * One run that writes: the golden's program, the script from the Tools tab, the golden's result, one undo.
   * @param {string} label
   * @param {Script} script
   * @param {string} name the case folder
   * @param {string} file the file name in the run folder
   * @param {{ inspect?: (fields: string[]) => void }} [o]
   */
  const writes = async (label, script, name, file, o = {}) => {
    const golden = await geometryGolden(h, script, name)
    const { c } = golden
    if (c.expected === null || c.envelope === null) throw new Error(`${script}/${name} is not a golden that writes`)
    const opened = await openGolden(h, golden, file)
    const id = opened.id
    h.check(`${label}: the golden program is open as ${golden.profile}, byte for byte`, ctx.docs.get(id)?.profileId === golden.profile && h.app.text() === c.input, { profile: ctx.docs.get(id)?.profileId, same: h.app.text() === c.input })
    const run = await runGeometry(h, GEOMETRY[script], c.params, { inspect: o.inspect })
    const got = h.app.text()
    h.check(`${label}: the form has the fields ${FORM_IDS[script].join(', ')}`, JSON.stringify(run.fields) === JSON.stringify(FORM_IDS[script]), run.fields)
    h.check(`${label}: the document is the golden's expected text, byte for byte`, got === c.expected, { got: got.split('\n').slice(0, 24), want: c.expected.split('\n').slice(0, 24) })
    h.check(`${label}: the status line ends with the golden's message`, run.status.endsWith(c.envelope.message), { got: run.status, want: c.envelope.message })
    const want = goldenFindings(c.envelope.findings)
    const shown = screenFindings(h)
    h.check(`${label}: the Results panel holds the golden's ${want.length} finding${want.length === 1 ? '' : 's'}, in order, and nothing else`, JSON.stringify(shown) === JSON.stringify(want), { got: shown, want })
    if (want.length > 0) h.check(`${label}: and its head carries the golden's message`, resultsText().includes(c.envelope.message), resultsText().slice(0, 240))
    h.check(`${label}: the document is marked as changed`, ctx.docs.get(id)?.dirty === true)
    await undo(h)
    h.check(`${label}: one undo takes the whole run back to the input, byte for byte`, h.app.text() === c.input, { diff: firstDifference(h.app.text(), c.input) })
    await redo(h)
    h.check(`${label}: and one redo brings the result back`, h.app.text() === c.expected, { diff: firstDifference(h.app.text(), c.expected) })
    await undo(h)
    h.log(`${label}: ${run.ms} ms`)
    return { id, golden }
  }

  /**
   * One refused run: the document stays as it was and every refused block is a row in Results.
   * @param {string} label
   * @param {Script} script
   * @param {string} name
   * @param {string} file
   */
  const refuses = async (label, script, name, file) => {
    const golden = await geometryGolden(h, script, name)
    const { c, refused } = golden
    if (refused === null) throw new Error(`${script}/${name} is not a refused golden`)
    const opened = await openGolden(h, golden, file)
    const id = opened.id
    const dirtyBefore = ctx.docs.get(id)?.dirty === true
    h.check(`${label}: the golden program is open as ${golden.profile}, byte for byte, and not changed`, ctx.docs.get(id)?.profileId === golden.profile && h.app.text() === c.input && !dirtyBefore, { profile: ctx.docs.get(id)?.profileId, dirty: dirtyBefore })
    const run = await runGeometry(h, GEOMETRY[script], c.params)
    h.check(`${label}: the document is exactly the input, byte for byte`, h.app.text() === c.input, { diff: firstDifference(h.app.text(), c.input) })
    h.check(`${label}: and was not marked as changed: the refusal made no edit`, (ctx.docs.get(id)?.dirty === true) === dirtyBefore, { dirty: ctx.docs.get(id)?.dirty })
    h.check(`${label}: the status line ends with the refusal's message`, run.status.endsWith(refused.message), { got: run.status, want: refused.message })
    const shown = screenFindings(h)
    h.check(`${label}: the Results panel lists ${refused.findings.length} refused blocks, one row each`, shown.length === refused.findings.length, { got: shown.length, want: refused.findings.length })
    const first = refused.findings[0]
    h.check(`${label}: the first row is the first refused block: line ${first.line}, an error, and the golden's words`, shown[0] === `${first.line}|error|${first.message}`, { got: shown[0], want: `${first.line}|error|${first.message}` })
    h.check(`${label}: every row is the golden's, in line order`, JSON.stringify(shown) === JSON.stringify(goldenFindings(refused.findings)), { got: shown.slice(0, 4), want: goldenFindings(refused.findings).slice(0, 4) })
    h.check(`${label}: and the head of the panel carries the refusal's message`, resultsText().includes(refused.message), resultsText().slice(0, 240))
    await undo(h)
    h.check(`${label}: there is nothing to undo: the document is still the input`, h.app.text() === c.input && (ctx.docs.get(id)?.dirty === true) === dirtyBefore, { dirty: ctx.docs.get(id)?.dirty })
  }

  // =============================================================== 0. the Tools tab offers the three scripts
  await guard(h, '0. the Tools tab', async () => {
    const golden = await geometryGolden(h, 'translate', 'fanuc-mill-shift')
    await openGolden(h, golden, 'p4-tools.nc')
    await ribbonTab(h, 'tools')
    const group = ctx.t('scripts.groupBundled')
    const groups = ribbonGroups(h)
    const holder = groups.find((g) => g.label === group)
    h.check('the Tools tab has the group "Built-in Scripts"', holder !== undefined, groups.map((g) => g.label))
    const items = Object.entries(GEOMETRY).map(([script, scriptId]) => ({ script, scriptId, item: h.q('script-item', { scriptId }) }))
    h.check('and it offers Translate, Rotate and Mirror, each as its own button with its own run command', items.every((i) => i.item !== null && holder?.element.contains(i.item) === true && i.item.getAttribute('data-command') === `script.run:${i.scriptId}`), items.map((i) => [i.scriptId, i.item?.getAttribute('data-command')]))
    h.check('named by the headers: Translate, Rotate, Mirror', JSON.stringify(items.map((i) => i.item?.textContent?.trim())) === JSON.stringify(['Translate', 'Rotate', 'Mirror']), items.map((i) => i.item?.textContent?.trim()))
    h.check('each carries its description as the tooltip, longer than the name', items.every((i) => (i.item?.getAttribute('title') ?? '').length > (i.item?.textContent ?? '').trim().length + 40), items.map((i) => i.item?.getAttribute('title')?.length))
    h.check('and each is enabled for a Fanuc milling program', items.every((i) => i.item !== null && !(/** @type {HTMLButtonElement} */ (i.item).disabled)))
    const listed = /** @type {any[]} */ (read(scriptService(h).list))
    h.check(
      'the discovery parsed the three headers with no warning: replacing scripts that return an envelope, with the form ids of the golden README and the 900 s timeout the owner gave the geometry scripts (Q-C, 2026-10-16)',
      Object.entries(GEOMETRY).every(([script, id]) => {
        const entry = listed.find((e) => e.id === id)
        return entry !== undefined && entry.headerError === null && entry.meta !== null && entry.meta.warnings.length === 0 && entry.meta.output === 'replace' && entry.meta.envelope === true && entry.meta.timeout === 900 && JSON.stringify(entry.meta.params.map((/** @type {any} */ p) => p.id)) === JSON.stringify(FORM_IDS[/** @type {Script} */ (script)])
      }),
      listed.filter((e) => Object.values(GEOMETRY).includes(e.id)).map((e) => ({ id: e.id, err: e.headerError, out: e.meta?.output, envelope: e.meta?.envelope, timeout: e.meta?.timeout, params: e.meta?.params?.map((/** @type {any} */ p) => p.id), warnings: e.meta?.warnings })),
    )
    await ribbonTab(h, 'scripts')
    h.check('none of them is on the Scripts tab: they are built in', h.qa('script-item').every((e) => !(e.dataset.scriptId ?? '').startsWith('bundled:')), h.qa('script-item').map((e) => e.dataset.scriptId))
  })

  // =============================================================== A. Translate
  await guard(h, 'A. Translate', async () => {
    await writes('Translate by X1.25 Y-2 Z0.5', 'translate', 'fanuc-mill-shift', 'p4-translate.nc', {
      inspect: (fields) => {
        h.check('Translate: a form that opens for the first time shows the shifts at 0 and the decimals "As written"', ['dx', 'dy', 'dz'].every((f) => fieldNumber(h, f) === 0) && fieldChoice(h, 'decimals') === 'As written', { fields, dx: fieldNumber(h, 'dx'), dy: fieldNumber(h, 'dy'), dz: fieldNumber(h, 'dz'), decimals: fieldChoice(h, 'decimals') })
      },
    })
  })

  // =============================================================== B. Rotate
  await guard(h, 'B. Rotate', async () => {
    await writes('Rotate by 90 degrees about X0 Y0', 'rotate', 'fanuc-mill-90', 'p4-rotate.nc', {
      inspect: (fields) => {
        h.check('Rotate: a form that opens for the first time shows the centre at 0 and the angle empty (it is required)', fieldNumber(h, 'cx') === 0 && fieldNumber(h, 'cy') === 0 && fieldNumber(h, 'angle') === null, { fields, cx: fieldNumber(h, 'cx'), cy: fieldNumber(h, 'cy'), angle: fieldNumber(h, 'angle') })
      },
    })
  })

  // =============================================================== C. Mirror
  await guard(h, 'C1. Mirror a milling program', async () => {
    await writes('Mirror in X about X12.5', 'mirror', 'fanuc-mill-x-decimal', 'p4-mirror.nc', {
      inspect: (fields) => {
        h.check('Mirror: a form that opens for the first time shows "Automatic" (in Z on a turning program, in X on a milling one), the point at 0 and the decimals "As written"', fieldChoice(h, 'about').startsWith('Automatic') && ['px', 'py', 'angle', 'z0'].every((f) => fieldNumber(h, f) === 0) && fieldChoice(h, 'decimals') === 'As written', { fields, about: fieldChoice(h, 'about'), decimals: fieldChoice(h, 'decimals') })
      },
    })
  })
  await guard(h, 'C2. Mirror a turning program in Z', async () => {
    await writes('Mirror in Z for the counter spindle (Fanuc lathe)', 'mirror', 'lathe-z-counter-spindle', 'p4-mirror-lathe.nc')
  })

  // =============================================================== D. refused runs
  await guard(h, 'D1. Translate refused', async () => {
    await refuses('Translate refused (frames, coordinate settings)', 'translate', 'fanuc-mill-frames-settings', 'p4-translate-refused.nc')
  })
  await guard(h, 'D2. Rotate refused', async () => {
    await refuses('Rotate refused (thirteen kinds of block)', 'rotate', 'fanuc-mill-refused', 'p4-rotate-refused.nc')
  })
  await guard(h, 'D3. Mirror refused', async () => {
    await refuses('Mirror refused (thirteen kinds of block)', 'mirror', 'fanuc-mill-refused', 'p4-mirror-refused.nc')
  })
})

/**
 * The first line that differs between two texts, for a failing check's detail.
 * @param {string} a
 * @param {string} b
 */
function firstDifference(a, b) {
  if (a === b) return null
  const x = a.split('\n')
  const y = b.split('\n')
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return { line: i + 1, got: x[i], want: y[i], gotLines: x.length, wantLines: y.length }
  return null
}
