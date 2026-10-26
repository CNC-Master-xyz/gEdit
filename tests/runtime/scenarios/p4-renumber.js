// P4d, Renumber Blocks: the options and the references across programs (plan `docs/planning/phase-4-implementation.md` section 5 P4d,
// section 6.6 rules 1-10; P4.18 and P4.19). The pure rules have golden tests; what only the running app proves is that the *form* carries them:
// every option is a field of the dialog, a value outside its bound is refused next to the field, the values are remembered per dialect, the run
// writes what the golden says, one undo takes it back, and a reference the run cannot follow is asked about first and reported with its reason.
//
//   A. the form        the new fields exist with the profile's own defaults (Fit to maximum off, every block, no column, nothing skipped, no start text); a
//                      value past a bound (column 121, every 0th block, a million and one lines to skip, a start text of 201 characters) marks its field
//                      and disables OK; what was typed is remembered for the dialect it was typed for and not for another.
//   B. the options     the goldens `opt-*` typed into the form, each on its own dialect: Fit to maximum (the largest whole step, 76, the last block N998 and
//                      the IF ... GOTO following its block), Every Nth block (the blocks between lose their number, the two a cycle names keep one),
//                      Skip lines containing (a comment included, either case), Start trigger (the line after it), Align to a column, Skip the first and
//                      last lines (one row for each region). Each gives the golden's text, the status line and the warnings of the transform, the golden's
//                      rows in the Results panel, no question, and one undo takes the run back.
//   C. the refusals    a start text no line contains, and four blocks that do not fit below the maximum: the run writes nothing, the document is not
//                      changed, the status bar says why, no question is asked. (Fit to maximum without a maximum is not here: a blank Maximum field is read
//                      as the profile's own maximum, which every built-in dialect has, so the form cannot ask for it.)
//   D. the references  the goldens of the reference model: a return (M99 P) into the one program that calls this one, through a packed M98 P21010,
//                      a program name <SHAFT_T12>, a macro call G65 P and the local call M98 Q, is rewritten and asks nothing; two callers, no caller and a
//                      program that is in the file twice are asked about first (the question carries the count and the first line), left as written and
//                      reported with their reason; M98 P Q is the kept row (never rewritten) and the second row says that no such block is left.
//                      Continue goes ahead and Cancel changes nothing at all.
//
// The programs are the goldens of `tests/fixtures/transforms/renumber/`, copied into the run folder and read, so the scenario and the unit tests cannot
// drift apart; the counts and steps in the expected messages are in `p4-renumber-common.js` and `tests/unit/p4dHarness.test.ts` holds them to the
// real transform. Nothing is read from what the app shows except through the test ids and the editors' own models.

import { scenario } from '../lib/index.js'
import {
  FANUC,
  LATHE,
  OPTION_CASES,
  RENUMBER,
  REFERENCE_CASES,
  asked,
  context,
  finishCase,
  findings,
  formFieldsOf,
  message,
  newDoc,
  panelText,
  peekForm,
  renumberAsking,
  resetRenumberForm,
  runTransform,
  transformCase,
  tryForm,
  undoTo,
} from './p4-renumber-common.js'
import { ready } from './m4-common.js'

/** The skipped-line rows the golden lists, as `line|severity`, sorted so that two rows on one line compare. */
const rowsOf = (/** @type {{ line: number, severity: string }[]} */ skipped) => skipped.map((s) => `${s.line}|${s.severity}`).sort()

/** The rows on screen as `line|severity`, sorted. @param {import('../lib/api.js').Harness} h */
const shown = (h) =>
  findings(h)
    .map((entry) => entry.split('|').slice(0, 2).join('|'))
    .sort()

scenario('p4-renumber', { timeout: 900 }, async (h) => {
  const ctx = context(h)
  await ready(h)

  // ================================================== A. the form
  resetRenumberForm(h, FANUC)
  resetRenumberForm(h, LATHE)
  const fanuc = await newDoc(h, 'O1\nN1 G0 X0\nN2 M30\n', FANUC)
  const defaults = await peekForm(h, ['fitToMax', 'everyNth', 'alignColumn', 'skipContaining', 'skipFirst', 'skipLast', 'startTrigger', 'startAfterTrigger'])
  h.check(
    'the form has the new fields, each at the dialect\'s own default: Fit to maximum off, every block, no column, nothing skipped, no start text',
    defaults.fitToMax === false && defaults.everyNth === '1' && defaults.alignColumn === '0' && defaults.skipContaining === '' && defaults.skipFirst === '0' && defaults.skipLast === '0' && defaults.startTrigger === '' && defaults.startAfterTrigger === false,
    defaults,
  )

  const past = await tryForm(h, { alignColumn: 121, everyNth: 0, skipFirst: 1000001, startTrigger: 'x'.repeat(201) })
  h.check(
    'a value past its bound marks its own field, for the column (121), the interval (0), the lines to skip (1,000,001) and a start text of 201 characters',
    Object.values(past.errors).every((error) => typeof error === 'string' && error !== ''),
    past.errors,
  )
  h.check('and OK stays disabled while one of them is wrong', past.okDisabled === true, past)
  const edge = await tryForm(h, { alignColumn: 120, everyNth: 1000, skipFirst: 1000000, startTrigger: 'x'.repeat(200) })
  h.check('the bounds themselves are accepted: column 120, every 1,000th block, 1,000,000 lines, 200 characters', Object.values(edge.errors).every((error) => !error) && edge.okDisabled === false, edge)
  h.check('a form that was cancelled changed nothing in the program and remembered nothing', ctx.editor.getText(fanuc) === 'O1\nN1 G0 X0\nN2 M30\n' && (await peekForm(h, ['alignColumn'])).alignColumn === '0')
  await finishCase(h, fanuc)

  // ================================================== B and C. the option goldens, typed into the form
  /** @type {string | undefined} */
  let rememberedOn
  for (const kase of OPTION_CASES) {
    const golden = await transformCase(h, 'renumber', kase.id)
    h.check(`${kase.id}: the golden runs on ${kase.profile}`, golden.profile === kase.profile, golden.profile)
    // The lathe form has not been used yet: leaving its memory alone is what lets the case below tell that the Fanuc mill's answers are not its own.
    if (kase.id !== 'opt-every-nth') resetRenumberForm(h, golden.profile)
    const id = await newDoc(h, golden.input, golden.profile)
    const fields = formFieldsOf(golden.options)

    // The memory is per dialect: after Fit to maximum on the Fanuc mill, the lathe's form still starts with it off.
    if (kase.id === 'opt-every-nth') {
      const lathe = await peekForm(h, ['fitToMax', 'max'])
      h.check('opt-every-nth: the lathe form starts with Fit to maximum off although the Fanuc mill form was run with it on', lathe.fitToMax === false && rememberedOn === FANUC, { lathe, rememberedOn })
    }

    const { ran, alertTexts } = await renumberAsking(h, fields, { pre: null })
    h.check(`${kase.id}: the command ran`, ran === true, ran)
    h.check(`${kase.id}: no question was asked`, alertTexts === null && !(await asked(h)), alertTexts)

    if (kase.refused === true) {
      h.check(`${kase.id}: a refusal writes nothing: the program is exactly as it was`, h.app.text() === golden.input && ctx.docs.get(id)?.dirty !== true, {
        text: h.app.text().split('\n'),
        dirty: ctx.docs.get(id)?.dirty,
      })
      h.check(`${kase.id}: and the status bar says why`, message(h) === ctx.t(kase.summary.key, kase.summary.params), { got: message(h), want: ctx.t(kase.summary.key, kase.summary.params) })
    } else {
      h.check(`${kase.id}: the program is the golden, ${kase.note}`, h.app.text() === golden.expected, {
        got: h.app.text().split('\n'),
        want: golden.expected.split('\n'),
        status: message(h),
      })
      h.check(`${kase.id}: the status bar gives the summary`, message(h) === ctx.t(kase.summary.key, kase.summary.params), { got: message(h), want: ctx.t(kase.summary.key, kase.summary.params) })
      const panel = panelText(h)
      h.check(
        `${kase.id}: the Results panel gives every warning of the run`,
        kase.warnings.every((warning) => panel.includes(ctx.t(warning.key, warning.params))),
        { missing: kase.warnings.filter((warning) => !panel.includes(ctx.t(warning.key, warning.params))).map((warning) => ctx.t(warning.key, warning.params)), panel: panel.slice(0, 400) },
      )
      const want = rowsOf(golden.sidecar.expect.skipped)
      h.check(`${kase.id}: and the golden's rows, line by line`, JSON.stringify(shown(h)) === JSON.stringify(want), { got: shown(h), want })
      for (const row of kase.rows ?? []) {
        const text = ctx.t(row.key, row.params)
        h.check(`${kase.id}: line ${row.line} says ${JSON.stringify(text.slice(0, 50))}...`, findings(h).some((entry) => entry.startsWith(`${row.line}|`) && entry.includes(text)), findings(h))
      }
      const text = h.app.text()
      h.focusEditor()
      h.check(`${kase.id}: one undo takes the whole run back`, (await undoTo(h, golden.input)) && text !== golden.input, { now: h.app.text().split('\n').slice(0, 4) })
    }

    // What was typed is remembered for this dialect: the form opens with it again.
    if (kase.id === 'opt-fit-to-max') {
      const again = await peekForm(h, ['fitToMax', 'max'])
      h.check('opt-fit-to-max: the form remembers what was typed for this dialect: Fit to maximum on, maximum 999', again.fitToMax === true && again.max === '999', again)
      rememberedOn = golden.profile
    }
    await finishCase(h, id)
  }

  // ================================================== D. the references across programs
  for (const kase of REFERENCE_CASES) {
    const golden = await transformCase(h, 'renumber', kase.id)
    h.check(`${kase.id}: the golden runs on ${kase.profile}`, golden.profile === kase.profile, golden.profile)
    resetRenumberForm(h, golden.profile)
    const id = await newDoc(h, golden.input, golden.profile)
    const { ran, alertTexts } = await renumberAsking(h, formFieldsOf(golden.options), { pre: kase.pre })

    if (kase.pre === null) {
      h.check(`${kase.id}: nothing is asked: every reference could be followed`, alertTexts === null && !(await asked(h)), alertTexts)
    } else {
      const wanted = ctx.t(kase.pre.key, kase.pre.params)
      h.check(`${kase.id}: the run is asked about first, with the count and the first line, and Continue goes ahead`, ran === true && (alertTexts ?? []).join('\n').includes(wanted), { alert: alertTexts, wanted })
    }
    h.check(`${kase.id}: the program is the golden, ${kase.note}`, h.app.text() === golden.expected, {
      got: h.app.text().split('\n'),
      want: golden.expected.split('\n'),
      status: message(h),
    })
    const panel = panelText(h)
    h.check(
      `${kase.id}: the Results panel says what happened to the references`,
      kase.warnings.every((warning) => panel.includes(ctx.t(warning.key, warning.params))),
      { missing: kase.warnings.filter((warning) => !panel.includes(ctx.t(warning.key, warning.params))).map((warning) => ctx.t(warning.key, warning.params)), panel: panel.slice(0, 400) },
    )
    const want = rowsOf(golden.sidecar.expect.skipped)
    h.check(`${kase.id}: and the golden's rows, line by line`, JSON.stringify(shown(h)) === JSON.stringify(want), { got: shown(h), want })
    for (const row of kase.rows) {
      const text = ctx.t(row.key)
      h.check(`${kase.id}: line ${row.line} gives its reason: ${JSON.stringify(text.slice(0, 60))}...`, findings(h).some((entry) => entry.startsWith(`${row.line}|warning|`) && entry.includes(text)), findings(h))
    }
    if (kase.id === 'm98-subprogram-start') {
      // M13 review NC-8: the same line also says that the N50 it named is gone after the run, which is where a call would stop with an alarm.
      h.check(
        'm98-subprogram-start: and a second row on that line says that no block N50 is left',
        findings(h).filter((entry) => entry.startsWith('3|warning|')).some((entry) => /no block N50 is left/.test(entry)),
        findings(h),
      )
    }
    if (kase.id === 'ref-return-single-caller') {
      h.check('ref-return-single-caller: the value is the caller\'s block 20, now 30, and the subprogram\'s own N30 is not where it returns', h.app.text().includes('M99 P30') && !h.app.text().includes('M99 P20'), h.app.text().split('\n'))
    }
    if (kase.id === 'ref-packed-call') {
      h.check('ref-packed-call: M98 P21010 itself is untouched, the count is not a block number', h.app.text().includes('M98 P21010'), h.app.text().split('\n'))
    }
    const changed = h.app.text() !== golden.input
    h.focusEditor()
    h.check(`${kase.id}: one undo takes the whole run back`, (await undoTo(h, golden.input)) && changed, { now: h.app.text().split('\n').slice(0, 4) })
    await finishCase(h, id)
  }

  // Cancel is the other answer to the question, and it has to change nothing at all.
  const twice = await transformCase(h, 'renumber', 'ref-program-twice')
  resetRenumberForm(h, twice.profile)
  const cancelled = await newDoc(h, twice.input, twice.profile)
  const { alertTexts } = await renumberAsking(h, {}, { pre: REFERENCE_CASES.find((c) => c.id === 'ref-program-twice')?.pre ?? null, answer: 'Cancel' })
  h.check('answering the question with Cancel leaves the program exactly as it was, and not changed', h.app.text() === twice.input && ctx.docs.get(cancelled)?.dirty !== true && (alertTexts ?? []).length > 0, {
    text: h.app.text().split('\n'),
    dirty: ctx.docs.get(cancelled)?.dirty,
  })
  await finishCase(h, cancelled)

  // The form without a question is the same command as always: a plain program renumbers by the defaults and nothing about the new options shows.
  const plain = await transformCase(h, 'renumber', 'basic')
  resetRenumberForm(h, plain.profile)
  const basic = await newDoc(h, plain.input, plain.profile)
  const ranBasic = await runTransform(h, RENUMBER, { form: true })
  h.check('a program without options or references renumbers by the defaults, as before P4d', ranBasic && h.app.text() === plain.expected, {
    got: h.app.text().split('\n'),
    want: plain.expected.split('\n'),
  })
  await finishCase(h, basic)
})
