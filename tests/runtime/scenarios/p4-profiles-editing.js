// P4h, a profile's own tab width and rulers (plan docs/planning/phase-4-implementation.md section 6.10 rule 9, Q4h-4; P4.42, H4h): `editing.tabWidth` and
// `editing.rulers` of a profile win over the general settings for the documents of that profile. The tab width lives on the model of a document; the
// rulers are an option of the editor, so they follow the pane: in split view two panes that show documents of different profiles keep their own.
//
//   A. one editor     three programs (two of user profiles with their own tab width and rulers, one of the built-in Fanuc profile that has neither): each is
//                     shown in turn; the model has the tab width, the editor the rulers, of its profile, and the setting's where the profile has none
//                     (rulers drawn: the `view-ruler` lines of the editor).
//   B. split view     two panes with documents of different profiles: each keeps the rulers of its own profile, the tab widths stay on the models;
//                     with the built-in program in the second pane it takes the setting's rulers (none).
//   C. a setting      a change of the rulers setting reaches the pane whose profile has none and leaves the other; a change of the tab width setting made
//                     in the Settings dialog (real controls, Save) reaches the model whose profile has none and leaves the profile's.
//   D. a profile      the profile file changed and the profiles reloaded: the new tab width and rulers are applied to the open model and to the pane at
//                     once; an empty list of rulers in the profile is "no ruler", although the setting has some.
//   E. one editor     Close Split: the one editor that is left takes the rulers of the document it shows.
//
// What only the running app proves: Monaco's own option of an editor instance (`getRawOptions().rulers`, the drawn `view-ruler` lines) and the model's
// `tabSize`, with two editors alive. The panes are opened with the service (`openGroups`) because the View tab's split shows one document twice.
// The numbers are written here; the programs are three short synthetic ones.

import { scenario } from '../lib/index.js'
import { ready } from './m4-common.js'
import { openSettings, settingControl, addProfile, context, guard, newDoc, setInput } from './p4-profiles-common.js'
import { groupsOnScreen, views, waitGroups } from './p4e-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

const PROGRAM = '(SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)\nN10 G90 G54 G0 X0. Y0.\nN20 T1 M6\nN30 G1 X10. F250.\nN40 M30\n'

/** A profile that extends the Fanuc mill and writes its own tab width and rulers. @param {string} id @param {number} tabWidth @param {number[]} rulers */
const profileOf = (id, tabWidth, rulers) => ({ id, name: id.toUpperCase(), shortName: id.toUpperCase().slice(0, 8), version: 1, extends: 'fanuc-gcode', detect: { content: [] }, editing: { tabWidth, rulers } })

/**
 * The rulers an editor has been given, as text: `[72]`.
 * @param {any} editor
 */
const rulersOf = (editor) => JSON.stringify(editor?.getRawOptions?.().rulers ?? null)

scenario('p4-profiles-editing', { timeout: 420 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  await addProfile(h, 'rule-a.json', profileOf('rule-a', 2, [72]))
  await addProfile(h, 'rule-b.json', profileOf('rule-b', 8, [100, 120]))
  const a = await newDoc(h, PROGRAM, 'rule-a')
  const b = await newDoc(h, PROGRAM, 'rule-b')
  const c = await newDoc(h, PROGRAM, 'fanuc-gcode')
  const tabSize = (/** @type {string} */ id) => ctx.editor.model(id)?.getOptions().tabSize
  const settingTab = ctx.settings.get('editor.tabWidth')
  const settingRulers = JSON.stringify(ctx.settings.get('editor.rulers'))
  h.check('the general settings are the defaults to begin with (tab width 4, no rulers)', settingTab === 4 && settingRulers === '[]', { settingTab, settingRulers })
  h.check('the three programs are programs of their profiles', ctx.docs.get(a)?.profileId === 'rule-a' && ctx.docs.get(b)?.profileId === 'rule-b' && ctx.docs.get(c)?.profileId === 'fanuc-gcode')

  /** Shows a program in the one editor and waits for it. @param {string} id */
  const show = async (id) => {
    ctx.docs.activate(id)
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 8000 })
    await h.idle()
  }

  // ============================================================ A. one editor
  await guard(h, 'A. one editor: the profile’s tab width and rulers, else the setting’s', async () => {
    /** @type {[string, string, number, string, number][]} */
    const cases = [
      ['rule-a', a, 2, '[72]', 1],
      ['rule-b', b, 8, '[100,120]', 2],
      ['fanuc-gcode (no tab width and no rulers of its own)', c, settingTab, settingRulers, 0],
    ]
    for (const [name, id, wantTab, wantRulers, drawnRulers] of cases) {
      await show(id)
      await h.waitFor(() => rulersOf(views(h)[0]?.editor) === wantRulers && tabSize(id) === wantTab, { timeout: 8000 })
      const [group] = groupsOnScreen(h)
      h.check(`${name}: the model has tab width ${wantTab}`, tabSize(id) === wantTab, tabSize(id))
      h.check(`${name}: the editor has the rulers ${wantRulers}`, rulersOf(views(h)[0]?.editor) === wantRulers, rulersOf(views(h)[0]?.editor))
      h.check(`${name}: and draws ${drawnRulers} ruler line${drawnRulers === 1 ? '' : 's'}`, group?.el.querySelectorAll('.view-ruler').length === drawnRulers, group?.el.querySelectorAll('.view-ruler').length)
    }
  })

  // ============================================================ B. split view
  await guard(h, 'B. split view: each pane keeps the rulers of its own profile', async () => {
    await show(a)
    ctx.editor.openGroups({ layout: 'side-by-side', contents: [{ kind: 'document', docId: a }, { kind: 'document', docId: b }] })
    await waitGroups(h, 2, 'side-by-side')
    const ruler = (/** @type {number} */ i) => rulersOf(views(h)[i]?.editor)
    await h.waitFor(() => ruler(0) === '[72]' && ruler(1) === '[100,120]', { timeout: 8000 })
    h.check('the panes show the two programs of different profiles', views(h).map((view) => view.docId).join() === `${a},${b}`, views(h).map((view) => view.docId))
    h.check('the first pane has the rulers of rule-a and the second those of rule-b', ruler(0) === '[72]' && ruler(1) === '[100,120]', [ruler(0), ruler(1)])
    h.check('each pane draws its own: one line, two lines', groupsOnScreen(h)[0]?.el.querySelectorAll('.view-ruler').length === 1 && groupsOnScreen(h)[1]?.el.querySelectorAll('.view-ruler').length === 2, groupsOnScreen(h).map((g) => g.el.querySelectorAll('.view-ruler').length))
    h.check('the tab widths are on the models: 2 and 8', tabSize(a) === 2 && tabSize(b) === 8, [tabSize(a), tabSize(b)])

    ctx.editor.openGroups({ layout: 'side-by-side', contents: [{ kind: 'document', docId: a }, { kind: 'document', docId: c }] })
    await waitGroups(h, 2, 'side-by-side')
    await h.waitFor(() => ruler(0) === '[72]' && ruler(1) === settingRulers, { timeout: 8000 })
    h.check('a pane that shows the built-in program takes the setting’s rulers (none), the other keeps rule-a’s', ruler(0) === '[72]' && ruler(1) === settingRulers, [ruler(0), ruler(1)])
  })

  // ============================================================ C. a setting changes
  await guard(h, 'C. a general setting reaches what has no value of its own', async () => {
    const ruler = (/** @type {number} */ i) => rulersOf(views(h)[i]?.editor)
    await ctx.settings.save({ 'editor.rulers': [60] })
    await h.waitFor(() => ruler(1) === '[60]', { timeout: 8000 })
    h.check('the rulers setting reaches the pane of the built-in program and leaves the pane of rule-a', ruler(0) === '[72]' && ruler(1) === '[60]', [ruler(0), ruler(1)])

    const opened = await openSettings(h, 'editor')
    setInput(settingControl(h, 'editor.tabWidth'), '6')
    await h.frame()
    h.click(h.q('modal-ok'))
    await h.waitFor(() => !h.q('modal', { modal: 'settings' }), { timeout: 10000 })
    await opened.closed
    await h.waitFor(() => tabSize(c) === 6, { timeout: 8000 })
    h.check('the tab width saved in the Settings dialog reaches the model of the built-in program', tabSize(c) === 6, tabSize(c))
    h.check('and leaves the models of the profiles that write their own', tabSize(a) === 2 && tabSize(b) === 8, [tabSize(a), tabSize(b)])
  })

  // ============================================================ D. a profile changes
  await guard(h, 'D. a profile file changed and reloaded', async () => {
    const ruler = (/** @type {number} */ i) => rulersOf(views(h)[i]?.editor)
    await addProfile(h, 'rule-a.json', profileOf('rule-a', 3, [50]))
    await h.waitFor(() => ruler(0) === '[50]' && tabSize(a) === 3, { timeout: 10000 })
    h.check('a new tab width and new rulers in the profile are applied to the open model and the pane at once', ruler(0) === '[50]' && tabSize(a) === 3 && ruler(1) === '[60]', { rulers: [ruler(0), ruler(1)], tab: tabSize(a) })
    await addProfile(h, 'rule-a.json', profileOf('rule-a', 3, []))
    await h.waitFor(() => ruler(0) === '[]', { timeout: 10000 })
    h.check('an empty list of rulers in the profile is "no ruler", although the setting has one', ruler(0) === '[]' && ruler(1) === '[60]' && groupsOnScreen(h)[0]?.el.querySelectorAll('.view-ruler').length === 0, [ruler(0), ruler(1)])
  })

  // ============================================================ E. close the split
  await guard(h, 'E. Close Split: the one editor takes the rulers of its document', async () => {
    ctx.editor.focusGroup(views(h)[1].id)
    await h.idle()
    ctx.editor.closeGroups()
    await h.waitFor(() => groupsOnScreen(h).length === 1 && views(h).length === 1, { timeout: 8000 })
    await h.idle()
    const shown = ctx.editor.groupsState().groups[0]?.content
    const doc = shown !== null && shown !== undefined ? shown.docId : null
    h.check('one editor is left, on the document of the pane that had the keyboard (the built-in program)', doc === c, doc)
    await h.waitFor(() => rulersOf(views(h)[0]?.editor) === '[60]', { timeout: 8000 })
    h.check('it has the setting’s rulers, which that program’s profile does not override', rulersOf(views(h)[0]?.editor) === '[60]', rulersOf(views(h)[0]?.editor))
    await show(a)
    await h.waitFor(() => rulersOf(views(h)[0]?.editor) === '[]', { timeout: 8000 })
    h.check('and showing rule-a again gives it rule-a’s (empty) list', rulersOf(views(h)[0]?.editor) === '[]', rulersOf(views(h)[0]?.editor))
  })
})
