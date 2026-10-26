// P4d, References in other open documents (plan `docs/planning/phase-4-implementation.md` section 6.6 rules 11-13; P4.20a and P4.20b, the command
// `nc.updateOtherReferences`, "Update References in Other Documents"). A subprogram that lives in another file returns with `M99 P3`, a block of
// the main program that has just been renumbered; the renumber lists those lines and, when asked, writes the new numbers.
//
//   A. the list        a document renumbered alone lists nothing and the command is off; with two more documents of the same dialect open, the same run
//                      lists four references (three to rewrite, one that the dialect never rewrites), each as a row with its own document and line, and says
//                      so in the status bar. A document of another dialect is neither read nor listed. A click on a row opens that document on that line.
//   B. the update      one confirmation that says how many references in how many documents it rewrites and how many it cannot; then every document gets
//                      its new values as its own undo step: one undo in the first brings back both of its lines and leaves the other document alone. The
//                      renumbered program, the kept reference and the other dialect's document are not touched, the list is gone and the command off.
//   C. recompute      Update finds the references again in the open documents as they are then (owner B, 2026-10-22). A document that changed so that
//                      its rows are other ones (a line break at its top moves its reference down): the fresh list is shown in Results, nothing is written, no
//                      question is asked, the status bar says the documents changed and to check the list and run Update again; the next Update writes the
//                      fresh rows. The renumbered document itself changed: refused with "Undo your changes in {name}, or undo the renumber and run it
//                      again", nothing written, the list kept; undoing the change makes the next Update go through.
//   D. locked, declined  a document that would be written and is locked refuses the whole update, nothing written, the list kept so that it can be tried
//                      again; Cancel at the question writes nothing and keeps the list.
//   E. closed          closing a listed document does not take the command away while another one still has references to write; Update then shows the
//                      list without it and writes nothing. Closing the renumbered document takes the command away.
//   F. enabled state   the ribbon button and the command follow all of the above: off before any renumber, off after a renumber with nothing to list, on
//                      with a list that has a reference to write, off after the update, on after a refusal that showed a fresh list, and off after the
//                      renumbered document is closed.
//   G. kept and locked  a renumber that is refused (a start text no line contains) writes nothing and keeps the list (P4.20b: the list goes only when a
//                      later run that wrote replaces it); a locked renumbered document does not block the update, which writes the other documents.
//   H. replaced        a second renumber that writes replaces a list that was never updated: the status bar and one row of Results say how many references
//                      of the earlier renumber of that document were not updated, and the two runs are never composed (owner C, 2026-10-22).
//
// The programs are written in `p4-renumber-common.js` (`world(base)`) with the text after the renumber and after the update worked out from the rules; the
// unit test `tests/unit/p4dHarness.test.ts` runs them through the real transform and the real rules. Each phase has program numbers of its own because the
// documents of an earlier phase stay open. Expected messages are `ctx.t(...)` of the service's keys.

import { scenario } from '../lib/index.js'
import { cmdButton, ready, ribbonTab } from './m4-common.js'
import {
  FANUC,
  LATHE,
  RENUMBER,
  UPDATE_OTHERS,
  activate,
  asked,
  closeDoc,
  context,
  message,
  newDoc,
  panelText,
  resetRenumberForm,
  runTransform,
  undoTo,
  world,
} from './p4-renumber-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

/** The rows of the Results table: document, line and text. @param {Harness} h */
const rows = (h) =>
  h.qa('results-row').map((element) => ({
    element,
    docId: element.dataset.docId ?? '',
    line: Number(element.dataset.line ?? '0'),
    text: element.textContent ?? '',
  }))

/** Whether the ribbon button of the command (on the NC tab) is there and enabled. @param {Harness} h */
async function ribbonEnabled(h) {
  await ribbonTab(h, 'nc')
  const button = /** @type {HTMLButtonElement | null} */ (cmdButton(h, UPDATE_OTHERS))
  return button !== null && !button.disabled
}

/**
 * Opens the four documents of a world, the main program first, and leaves nothing renumbered.
 * @param {Harness} h
 * @param {ReturnType<typeof world>} w
 * @param {{ withA?: string }} [o] the main program, when it is open already
 */
async function openWorld(h, w, o = {}) {
  const a = o.withA ?? (await newDoc(h, w.a.input, FANUC))
  const b = await newDoc(h, w.b.input, FANUC)
  const c = await newDoc(h, w.c.input, FANUC)
  const d = await newDoc(h, w.d.input, LATHE)
  await activate(h, a)
  return { a, b, c, d }
}

/**
 * Renumber Blocks on the active document with the dialect's defaults (N10 in steps of 10), asking nothing.
 * @param {Harness} h
 */
async function renumberDefaults(h) {
  resetRenumberForm(h, FANUC)
  return runTransform(h, RENUMBER, { form: true })
}

/**
 * Runs the update command, answers its question, and settles.
 * @param {Harness} h
 * @param {string | null} answer the button to click, `null` when no question is expected
 * @returns {Promise<{ ran: boolean, alertTexts: string[] | null }>}
 */
async function runUpdate(h, answer) {
  const running = context(h).commands.run(UPDATE_OTHERS)
  /** @type {string[] | null} */
  let alertTexts = null
  if (answer !== null) {
    const alert = await h.alert.wait()
    alertTexts = alert === null ? [] : [...(alert.texts ?? [])]
    await h.alert.click(answer)
  }
  const ran = await running
  await h.idle()
  return { ran, alertTexts }
}

scenario('p4-renumber-others', { timeout: 900 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const text = (/** @type {string} */ id) => ctx.editor.getText(id)
  const enabled = () => ctx.commands.isEnabled(UPDATE_OTHERS)

  // ================================================== F (start). nothing to update yet
  h.check('the command is off before any renumber has run', enabled() === false, enabled())

  // ================================================== A. the list
  const w = world(1000)
  const a = await newDoc(h, w.a.input, FANUC)
  await ribbonTab(h, 'nc')
  const button = /** @type {HTMLButtonElement | null} */ (cmdButton(h, UPDATE_OTHERS))
  h.check('Update References in Other Documents is on the NC tab and disabled', button !== null && button.disabled, button?.disabled)

  await renumberDefaults(h)
  h.check('the main program alone renumbers to N10 ... N80', text(a) === w.a.after, text(a).split('\n'))
  h.check('with no other document open there is nothing to list: no rows for another document and the command stays off', rows(h).every((row) => row.docId === a) && !enabled() && !(await ribbonEnabled(h)), rows(h).map((row) => `${row.docId}:${row.line}`))
  h.focusEditor()
  h.check('and one undo takes the renumber back', await undoTo(h, w.a.input), text(a).split('\n'))

  const { b, c, d } = await openWorld(h, w, { withA: a })
  h.check('two more documents of the dialect and one of the lathe are open, the main program is the active one', h.q('editor-host')?.dataset.docId === a && ctx.docs.get(b)?.profileId === FANUC && ctx.docs.get(c)?.profileId === FANUC && ctx.docs.get(d)?.profileId === LATHE)
  const ids = { b, c, d }

  await renumberDefaults(h)
  h.check('the main program is renumbered as before', text(a) === w.a.after, text(a).split('\n'))
  h.check('and nothing else is touched by the run: the others are exactly what they were', text(b) === w.b.input && text(c) === w.c.input && text(d) === w.d.input)

  const listed = rows(h).filter((row) => row.docId !== a)
  h.check(
    'the Results table lists four references, each with its own document and line (the other dialect\'s document is not among them)',
    listed.length === w.listed.length && w.listed.every(([doc, line]) => listed.some((row) => row.docId === ids[/** @type {'b' | 'c'} */ (doc)] && row.line === line)) && listed.every((row) => row.docId !== d),
    listed.map((row) => `${row.docId}:${row.line}`),
  )
  for (const [doc, line, kind, value, becomes] of w.listed) {
    const row = listed.find((entry) => entry.docId === ids[/** @type {'b' | 'c'} */ (doc)] && entry.line === line)
    const what = kind === 'update' ? ctx.t('renumberOthers.row.update', { text: value, newText: becomes ?? '', program: w.program }) : ctx.t(`renumberOthers.row.${kind}`, { text: value, program: w.program })
    h.check(`the row of line ${line} of document ${doc.toUpperCase()} says what happens: ${what}`, !!row && row.text.includes(what), row?.text)
  }
  h.check('the table\'s columns are the document, the line, the line as written and what happens', ['document', 'line', 'text', 'what'].every((column) => panelText(h).includes(ctx.t(`renumberOthers.column.${column}`))), panelText(h).slice(0, 200))

  const found = ctx.t('renumberOthers.found', { count: w.listed.length })
  const next = ctx.t('renumberOthers.next.canUpdate', { count: w.updates.references })
  h.check('the status bar says how many there are and that the command rewrites the ones marked to update', message(h).includes(found) && message(h).includes(next), message(h))
  h.check('the command and its ribbon button are on', enabled() && (await ribbonEnabled(h)), enabled())

  // A click on a row opens that document on that line.
  const second = listed.find((row) => row.docId === ids.b && row.line === 7)
  if (!second) throw new Error('no row for line 7 of the first other document')
  h.click(second.element)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === b, { timeout: 8000 })
  await h.idle()
  h.check('a click on a row opens that document on that line', h.q('editor-host')?.dataset.docId === b && h.app.cursor().line === 7, { doc: h.q('editor-host')?.dataset.docId, cursor: h.app.cursor() })
  h.check('and only that: nothing was written by looking', text(b) === w.b.input && enabled())

  // ================================================== B. the update
  await activate(h, a)
  const asking = await runUpdate(h, 'Update')
  const wanted = [
    ctx.t('renumberOthers.confirm.references', { count: w.updates.references }),
    ctx.t('renumberOthers.confirm.inDocuments', { count: w.updates.documents }),
    ctx.t('renumberOthers.confirm.undo'),
    ctx.t('renumberOthers.confirm.cannot', { count: w.updates.left }),
  ]
  const asked1 = (asking.alertTexts ?? []).join('\n')
  h.check('one question: how many references in how many documents it rewrites, that each document has its own undo step, and how many it cannot rewrite', wanted.every((sentence) => asked1.includes(sentence)), { asked: asking.alertTexts, wanted })
  h.check('Update goes ahead', asking.ran === true)
  h.check('the first document has both of its values, and nothing else in it moved', text(b) === w.b.after, text(b).split('\n'))
  h.check('the second document has its value', text(c) === w.c.after, text(c).split('\n'))
  h.check('the renumbered program, the kept reference and the document of the other dialect are untouched', text(a) === w.a.after && text(b).includes(`M98 P${w.names.a} Q3`) && text(d) === w.d.input)
  h.check(
    'the status bar says how many were written in how many documents',
    message(h).includes(ctx.t('renumberOthers.done.references', { count: w.updates.references })) && message(h).includes(ctx.t('renumberOthers.confirm.inDocuments', { count: w.updates.documents })),
    message(h),
  )
  h.check('the list is gone: the command and its button are off', !enabled() && !(await ribbonEnabled(h)))
  h.check(
    'what stays in the table is the reference that is never written, with the note that it stays as it is',
    panelText(h).includes(ctx.t('renumberOthers.done.rest', { count: w.updates.left })) && rows(h).some((row) => row.docId === b && row.line === 9) && !rows(h).some((row) => row.docId === c),
    panelText(h).slice(0, 300),
  )

  // One undo step for each document.
  await activate(h, b)
  h.check('Cmd+Z in the first document takes back both of its values in one step', await undoTo(h, w.b.input), text(b).split('\n'))
  h.check('and leaves the other document as it was updated', text(c) === w.c.after)
  await activate(h, c)
  h.check('Cmd+Z in the second document takes back its value', await undoTo(h, w.c.input), text(c).split('\n'))
  h.check('and the renumbered program stays renumbered', text(a) === w.a.after)

  // ================================================== C. recompute: a document changed
  const x = world(1100)
  const xa = await newDoc(h, x.a.input, FANUC)
  const xo = await openWorld(h, x, { withA: xa })
  await renumberDefaults(h)
  h.check('C: the list is made again for the new programs', enabled() && text(xa) === x.a.after, message(h))
  await activate(h, xo.c)
  h.focusEditor()
  await h.nativeKeys([{ key: 'Enter' }])
  await h.idle()
  const typed = text(xo.c)
  h.check('C: a line break at the top of the second document changes it and moves its reference down one line', typed === `\n${x.c.input}` && ctx.docs.get(xo.c)?.dirty === true, typed.split('\n').slice(0, 3))
  await activate(h, xa)
  const refreshed = await runUpdate(h, null)
  h.check('C: the update asks nothing and writes nothing', refreshed.ran === true && !(await asked(h)), refreshed)
  h.check('C: nothing was written anywhere: the first document, the second as typed, the main program', text(xo.b) === x.b.input && text(xo.c) === typed && text(xa) === x.a.after, { b: text(xo.b).split('\n'), c: text(xo.c).split('\n') })
  h.check('C: the status bar says the documents changed, that the new list is in Results, and to run Update again', message(h) === ctx.t('renumberOthers.refused.listChanged'), message(h))
  h.check('C: and the old advice to run Renumber Blocks again is gone', !message(h).includes('Run Renumber Blocks again'), message(h))
  h.check(
    'C: the fresh list is in Results: the reference of the second document is on line 5 now, not on line 4',
    rows(h).some((row) => row.docId === xo.c && row.line === 5) && !rows(h).some((row) => row.docId === xo.c && row.line === 4),
    rows(h).map((row) => `${row.docId}:${row.line}`),
  )
  h.check('C: the command stays on, there are references to write', enabled() && (await ribbonEnabled(h)))
  const second2 = await runUpdate(h, 'Update')
  h.check('C: the next Update goes through with the fresh list, the typed line break kept', second2.ran === true && text(xo.b) === x.b.after && text(xo.c) === typed.replace('M99 P7', 'M99 P70'), { b: text(xo.b).split('\n'), c: text(xo.c).split('\n') })

  // ---- C, the renumbered document itself changed
  const f = world(1300)
  const fa = await newDoc(h, f.a.input, FANUC)
  const fo = await openWorld(h, f, { withA: fa })
  await renumberDefaults(h)
  h.check('C: the list is made for the programs of the renumbered-document phase', enabled() && text(fa) === f.a.after, message(h))
  await activate(h, fa)
  h.focusEditor()
  await h.nativeType('X')
  await h.idle()
  h.check('C: a character typed into the renumbered document changes it', text(fa) !== f.a.after && ctx.docs.get(fa)?.dirty === true, text(fa).split('\n').slice(0, 3))
  const sourceRefused = await runUpdate(h, null)
  h.check('C: the update asks nothing and writes nothing in the other documents', sourceRefused.ran === true && !(await asked(h)) && text(fo.b) === f.b.input && text(fo.c) === f.c.input, { b: text(fo.b).split('\n'), c: text(fo.c).split('\n') })
  h.check('C: the status bar says to undo the changes in the document or undo the renumber and run it again', message(h) === ctx.t('renumberOthers.refused.sourceChanged', { name: ctx.docs.get(fa)?.title ?? '' }), message(h))
  h.check('C: the list stays, so the command stays on', enabled())
  h.check('C: undoing the typed character brings the renumbered text back', await undoTo(h, f.a.after), text(fa).split('\n'))
  const afterUndo = await runUpdate(h, 'Update')
  h.check('C: and the update then goes through', afterUndo.ran === true && text(fo.b) === f.b.after && text(fo.c) === f.c.after, { b: text(fo.b).split('\n'), c: text(fo.c).split('\n') })

  // ================================================== D. locked, declined
  const y = world(1200)
  const ya = await newDoc(h, y.a.input, FANUC)
  const yo = await openWorld(h, y, { withA: ya })
  await renumberDefaults(h)
  h.check('D: the list is made for the third set of programs', enabled() && text(ya) === y.a.after, message(h))
  await activate(h, yo.c)
  await ctx.commands.run('file.toggleReadOnly')
  await h.waitFor(() => ctx.docs.get(yo.c)?.readOnly === true, { timeout: 8000 })
  await activate(h, ya)
  const lockedRun = await runUpdate(h, null)
  h.check('D: a locked document that would be written refuses the whole update without a question', lockedRun.ran === true && !(await asked(h)), lockedRun)
  h.check('D: nothing was written anywhere', text(yo.b) === y.b.input && text(yo.c) === y.c.input, { b: text(yo.b).split('\n'), c: text(yo.c).split('\n') })
  h.check('D: the status bar says the document is locked and that nothing was written in any document', /locked/.test(message(h)) && message(h).includes(ctx.t('renumberOthers.refused.nothingWritten')), message(h))
  h.check('D: a lock can be lifted, so the list stays and the command stays on', enabled())

  await activate(h, yo.c)
  await ctx.commands.run('file.toggleReadOnly')
  await h.waitFor(() => ctx.docs.get(yo.c)?.readOnly === false, { timeout: 8000 })
  await activate(h, ya)
  const declined = await runUpdate(h, 'Cancel')
  h.check('D: Cancel at the question writes nothing', declined.ran === true && (declined.alertTexts ?? []).length > 0 && text(yo.b) === y.b.input && text(yo.c) === y.c.input, { b: text(yo.b).split('\n'), c: text(yo.c).split('\n') })
  h.check('D: and keeps the list: the command is still on', enabled() && (await ribbonEnabled(h)))

  // ================================================== E. closed
  await closeDoc(h, yo.c)
  h.check('E: closing a listed document does not take the command away: the other document still has references to write', enabled() && (await ribbonEnabled(h)))
  const afterClose = await runUpdate(h, null)
  h.check('E: running it finds the references again, writes nothing and asks nothing', afterClose.ran === true && text(yo.b) === y.b.input && !(await asked(h)), { ran: afterClose.ran, status: message(h) })
  h.check('E: the status bar says the documents changed, and the list shown has no row of the closed document', message(h) === ctx.t('renumberOthers.refused.listChanged') && rows(h).every((row) => row.docId !== yo.c) && rows(h).some((row) => row.docId === yo.b), { status: message(h), rows: rows(h).map((row) => `${row.docId}:${row.line}`) })
  await closeDoc(h, ya)
  h.check('E: closing the renumbered document takes the command away', !enabled() && !(await ribbonEnabled(h)), enabled())
  const afterCloseA = await runUpdate(h, null)
  h.check('E: running it anyway writes nothing and asks nothing', afterCloseA.ran === false && text(yo.b) === y.b.input && !(await asked(h)), { ran: afterCloseA.ran, status: message(h) })

  // ================================================== G. a refused renumber keeps the list, a locked renumbered document does not block
  const g = world(1400)
  const ga = await newDoc(h, g.a.input, FANUC)
  const go = await openWorld(h, g, { withA: ga })
  await renumberDefaults(h)
  h.check('G: the list is made for the programs of this phase', enabled() && text(ga) === g.a.after, message(h))
  resetRenumberForm(h, FANUC)
  const refusedRun = await runTransform(h, RENUMBER, { form: true, fields: { startTrigger: 'NO_SUCH_TEXT' } })
  resetRenumberForm(h, FANUC)
  h.check('G: a renumber with a start text no line contains is refused: the document is as it was and no question is asked', refusedRun === true && text(ga) === g.a.after && !(await asked(h)), { ran: refusedRun, text: text(ga).split('\n') })
  h.check('G: and the status bar gives the reason', message(h) === ctx.t('ncNumbering.renumber.refused.noTrigger', { text: 'NO_SUCH_TEXT' }), message(h))
  h.check('G: the refused run keeps the list: the command is still on and its button too', enabled() && (await ribbonEnabled(h)))
  await ctx.commands.run('file.toggleReadOnly')
  await h.waitFor(() => ctx.docs.get(ga)?.readOnly === true, { timeout: 8000 })
  const lockedA = await runUpdate(h, 'Update')
  h.check('G: the renumbered document is locked and the update still goes through: it writes the other documents, not that one', lockedA.ran === true && text(go.b) === g.b.after && text(go.c) === g.c.after && text(ga) === g.a.after, { b: text(go.b).split('\n'), c: text(go.c).split('\n') })
  await ctx.commands.run('file.toggleReadOnly')
  await h.waitFor(() => ctx.docs.get(ga)?.readOnly === false, { timeout: 8000 })

  // ================================================== H. a second renumber replaces a list that was never updated
  const k = world(1500)
  const ka = await newDoc(h, k.a.input, FANUC)
  await openWorld(h, k, { withA: ka })
  await renumberDefaults(h)
  h.check('H: the list is made for the programs of this phase and has the references to write', enabled() && text(ka) === k.a.after, message(h))
  resetRenumberForm(h, FANUC)
  await runTransform(h, RENUMBER, { form: true, fields: { start: 100 } })
  resetRenumberForm(h, FANUC)
  const lost = ctx.t('renumberOthers.replaced', { count: k.updates.references, name: ctx.docs.get(ka)?.title ?? '' })
  h.check('H: the second renumber of the same document renumbered it again, from N100', text(ka) !== k.a.after && text(ka).includes('N100 '), text(ka).split('\n'))
  h.check('H: the status bar says how many references of the earlier renumber were not updated and are no longer listed', message(h).includes(lost), message(h))
  h.check('H: Results has the same sentence as one row', panelText(h).includes(lost), panelText(h).slice(0, 300))
  h.check('H: the earlier list is gone, not composed with this run: the command is off', !enabled() && !(await ribbonEnabled(h)))
})
