// P4h, "The profile form" (plan docs/planning/phase-4-implementation.md section 6.10 rule 7, AD-57; P4.40, H4h): Edit Profile in Form, the
// fields of one profile file with the live preview beside them. Two scenarios, one per way in.
//
//   p4-profiles-form       the command (`profile.editInForm`) in a dialog
//     A. the profile of the open program   the form opens on the user profile of the active program; a field that is not written shows what
//                                          the parent gives ("From fanuc-gcode: 10"); the live preview follows a field (the block number
//                                          letter) and a colour (the feed colour, with the refusal of a colour that is too faint); "Use the
//                                          parent's value" takes a member out again and the draft is clean again; a profile built on another
//                                          cannot be saved without its own name and short name; "Ruler at the longest block" adds the ruler;
//                                          Save writes the file in its own layout (four-space indent, CRLF, the members where they were),
//                                          loads it, keeps the user's tab; opening the form and leaving changes no byte.
//     B. a built-in profile                the form is read-only: every control off, Save off, the note and "Duplicate as a user profile"
//   p4-profiles-form-page  the same form inline on Settings > Profiles (a modal cannot open over the Settings dialog)
//     A. the button                        "Edit in form" on a row of your own files and on none of the built-in ones; the form replaces the
//                                          list, no second dialog; the draft is clean until a field changes; "Use the parent's value"; Save
//                                          writes the file in its layout and leaves the form.
//     B. the $schema line                  a profile made with "New profile from…" starts with the `$schema` line of the repository's
//                                          schema, as its first member.
//
// What only the running app proves: the form is generated from the schema and mounted in a dialog and in the page, the preview is a real
// Monaco editor, the save goes through the file's document (backup, reload, the tab of the user's program stays). **Expected texts are
// `ctx.t(...)`**; the numbers and colours are written here. The file the scenario writes is its own (a four-space, CRLF layout, so a save
// that re-wrote the file in the default layout is seen).

import { scenario } from '../lib/index.js'
import { REPO_FILE } from './m3-common.js'
import {
  addProfile,
  closeProfilesPage,
  colourCell,
  context,
  feedProgram,
  formDirty,
  formField,
  formFileName,
  formProblem,
  formRulerButton,
  formRoot,
  formSave,
  formUseParent,
  formValue,
  guard,
  openProfilesPage,
  previewColour,
  previewLines,
  profileAction,
  profileFileText,
  profileRows,
  ready,
  rgbOf,
  schemaId,
  setField,
  setTheme,
  typeColour,
  cellProblem,
  typeInForm,
  userDirs,
  waitForForm,
} from './p4-profiles-common.js'

/** The profile the scenarios edit: it extends the Fanuc mill and writes only what is its own. */
const SHOP = { id: 'shop-mill', name: 'Shop mill', shortName: 'SHOP', version: 1, extends: 'fanuc-gcode', detect: { content: [] } }

/** Its layout on disk: four blanks, CRLF, a break at the end. */
const LAYOUT = { indent: 4, eol: '\r\n' }

/** True when every line break of `text` is CRLF and it ends with one. @param {string} text */
const allCrlf = (text) => text.endsWith('\r\n') && !/(?<!\r)\n/.test(text)

/** The first member names of a parsed file. @param {string} text @param {number} count */
const firstKeys = (text, count) => Object.keys(JSON.parse(text)).slice(0, count)

scenario('p4-profiles-form', { timeout: 480, files: REPO_FILE }, async (h) => {
  const ctx = context(h)
  await ready(h)
  await setTheme(h, 'dark')
  const original = await addProfile(h, 'shop-mill.json', SHOP, LAYOUT)
  const path = `${userDirs(h).profilesDir}/shop-mill.json`

  // ============================================================ A. the profile of the open program
  await guard(h, 'A. the command opens the form on the profile of the open program', async () => {
    const command = ctx.commands.get('profile.editInForm')
    h.check('the command is registered and has no key of its own', command !== undefined && command.keys === undefined, command?.keys)
    const program = await feedProgram(h, 'shop-mill')
    h.check('the open program is a program of the user profile', ctx.docs.get(program)?.profileId === 'shop-mill', ctx.docs.get(program)?.profileId)

    const running = ctx.commands.run('profile.editInForm')
    const dialog = await h.waitFor(() => h.q('modal', { modal: 'profile-form' }), { timeout: 15000 })
    h.check('Edit Profile in Form opens a dialog of its own', !!dialog)
    await waitForForm(h)
    const root = formRoot(h)
    h.check('it holds the form of the file shop-mill.json, not read-only and with nothing changed', root?.dataset.profile === 'shop-mill' && root.dataset.readonly === 'false' && !formDirty(h) && formFileName(h) === 'shop-mill.json', { profile: root?.dataset.profile, file: formFileName(h) })
    h.check('the dialog says whose form it is', (dialog?.textContent ?? '').includes(ctx.t('profileForm.title', { name: root?.dataset.profile ?? '' })), (dialog?.textContent ?? '').slice(0, 120))
    h.check('Save is off while nothing is changed', formSave(h)?.disabled === true)
    h.check('a member the file writes shows its own value', formValue(h, 'name') === 'Shop mill' && formField(h, 'name')?.dataset.inherited === 'false', formValue(h, 'name'))
    const inherited = formField(h, 'numbering.step')
    h.check('a member it does not write shows what the parent gives, beside an empty field', inherited?.dataset.inherited === 'true' && formValue(h, 'numbering.step') === '' && (inherited.querySelector('[data-testid="profile-form-inherited"]')?.textContent ?? '').trim() === ctx.t('profileForm.inherited', { parent: 'fanuc-gcode', value: '10' }), inherited?.querySelector('[data-testid="profile-form-inherited"]')?.textContent)

    // The live preview.
    await h.waitFor(() => previewLines(h).some((line) => /^N10 /.test(line)), { timeout: 15000 })
    h.check('the preview shows a sample program with the profile’s block numbers (N10)', previewLines(h).some((line) => /^N10 /.test(line)), previewLines(h).slice(0, 4))
    typeInForm(h, 'syntax.blockNumber.prefix', 'L')
    await h.waitFor(() => previewLines(h).some((line) => /^L10 /.test(line)), { timeout: 8000 })
    h.check('a field changed in the form changes the preview (block number letter L)', previewLines(h).some((line) => /^L10 /.test(line)) && !previewLines(h).some((line) => /^N10 /.test(line)), previewLines(h).slice(0, 4))
    h.check('and the draft is marked as changed, Save is on', formDirty(h) && formSave(h)?.disabled === false)
    h.click(formUseParent(h, 'syntax.blockNumber.prefix'))
    await h.waitFor(() => previewLines(h).some((line) => /^N10 /.test(line)) && !previewLines(h).some((line) => /^L10 /.test(line)), { timeout: 8000 })
    h.check('"Use the parent’s value" takes the member out again: the preview is back and the draft is clean', previewLines(h).some((line) => /^N10 /.test(line)) && !formDirty(h) && formSave(h)?.disabled === true, { dirty: formDirty(h) })

    // Colours: one in the dark theme, then one that is too faint.
    const cell = colourCell(formRoot(h) ?? document, 'feed', 'dark')
    const before = previewColour(h, 'F250.')
    await typeColour(h, cell, '#ffaa00')
    await h.waitFor(() => previewColour(h, 'F250.') === rgbOf('#ffaa00'), { timeout: 10000 })
    h.check('a colour set for the profile is drawn in the preview at once', previewColour(h, 'F250.') === rgbOf('#ffaa00') && before !== rgbOf('#ffaa00'), { before, now: previewColour(h, 'F250.') })
    h.check('the cell says the colour is this profile’s', cell?.dataset.layer === 'profile' && formDirty(h), cell?.dataset.layer)
    await typeColour(h, cell, '#222222')
    h.check('a colour too faint to read on the dark background is refused with its ratio', cellProblem(cell) === ctx.t('appearance.codeColors.tooFaint', { theme: 'dark', ratio: cell?.dataset.ratio ?? '', min: '4.5' }), cellProblem(cell))
    h.check('and Save is off while it stands; the preview keeps the last colour that could be read', formSave(h)?.disabled === true && previewColour(h, 'F250.') === rgbOf('#ffaa00'), previewColour(h, 'F250.'))
    await typeColour(h, cell, '#ffaa00')
    h.check('typed again, the colour is accepted and Save is on', cellProblem(cell) === '' && formSave(h)?.disabled === false, cellProblem(cell))

    // A profile built on another needs its own name and short name.
    typeInForm(h, 'name', '')
    h.check('a profile built on another cannot be saved without its own name: the problem sits at the field and Save is off', formProblem(h, 'name') === ctx.t('profileForm.problem.ownField') && formSave(h)?.disabled === true, formProblem(h, 'name'))
    typeInForm(h, 'name', 'Shop mill 2')
    typeInForm(h, 'shortName', '')
    h.check('nor without its own short name', formProblem(h, 'shortName') === ctx.t('profileForm.problem.ownField') && formSave(h)?.disabled === true, formProblem(h, 'shortName'))
    typeInForm(h, 'shortName', 'SHOP 2')
    h.check('with both names written the problem is gone and Save is on', formProblem(h, 'name') === '' && formProblem(h, 'shortName') === '' && formSave(h)?.disabled === false)

    // Numbers, and the ruler at the longest block.
    typeInForm(h, 'numbering.step', '5')
    typeInForm(h, 'editing.tabWidth', '3')
    h.check('before a longest block is written there is no one-click ruler', formRulerButton(h) === null)
    typeInForm(h, 'syntax.maxLineLength', '80')
    const ruler = await h.waitFor(() => formRulerButton(h), { timeout: 5000 })
    h.check('with a longest block of 80 the rulers field offers "Ruler at the longest block (80)"', !!ruler && ruler.dataset.column === '80' && (ruler.textContent ?? '').trim() === ctx.t('profileForm.rulerAtLongest', { count: 80 }), ruler?.textContent)
    h.click(ruler)
    await h.waitFor(() => formValue(h, 'editing.rulers') === '80', { timeout: 5000 })
    h.check('one click writes the ruler 80 into the list, and the offer is gone', formValue(h, 'editing.rulers') === '80' && formRulerButton(h) === null, formValue(h, 'editing.rulers'))

    // Save.
    h.check('Save is on', formSave(h)?.disabled === false)
    h.click(formSave(h))
    await h.waitFor(() => !h.q('modal', { modal: 'profile-form' }), { timeout: 20000 })
    await running
    await h.idle()
    const written = await profileFileText(h, 'shop-mill.json')
    /** @type {any} */
    const parsed = JSON.parse(written)
    h.check('the dialog closed and the file holds the changes', parsed.name === 'Shop mill 2' && parsed.shortName === 'SHOP 2' && parsed.numbering?.step === 5 && parsed.editing?.tabWidth === 3 && JSON.stringify(parsed.editing?.rulers) === '[80]' && parsed.syntax?.maxLineLength === 80 && parsed.colors?.dark?.feed === '#ffaa00', parsed)
    h.check('and nothing else: the block number letter, taken out again, is not in the file', parsed.syntax?.blockNumber === undefined, parsed.syntax)
    h.check('the file keeps its layout: four blanks, CRLF everywhere, a CRLF at the end', /^ {4}"id"/m.test(written) && !/^ {2}"/m.test(written) && allCrlf(written), JSON.stringify(written.slice(0, 80)))
    h.check('and its members where they were, the new ones after them', JSON.stringify(firstKeys(written, 6)) === JSON.stringify(['id', 'name', 'shortName', 'version', 'extends', 'detect']) && !written.includes('$schema'), firstKeys(written, 8))
    h.check('the profile was loaded again: the registry has the new name, numbering, tab width and rulers', ctx.profiles.profile('shop-mill').name === 'Shop mill 2' && ctx.profiles.profile('shop-mill').numbering?.step === 5 && ctx.profiles.profile('shop-mill').editing?.tabWidth === 3 && JSON.stringify(ctx.profiles.profile('shop-mill').editing?.rulers) === '[80]', ctx.profiles.profile('shop-mill').editing)
    h.check('the user’s program is still the tab in front, and the profile file’s tab is not left changed', h.q('editor-host')?.dataset.docId === program && ctx.docs.byPath(path)?.dirty !== true, { shown: h.q('editor-host')?.dataset.docId, program })
  })

  // ============================================================ A2. nothing changed, nothing written
  await guard(h, 'A2. opening the form and leaving changes no byte', async () => {
    const same = await profileFileText(h, 'shop-mill.json')
    const running = ctx.commands.run('profile.editInForm', { name: 'shop-mill.json' })
    await h.waitFor(() => h.q('modal', { modal: 'profile-form' }), { timeout: 15000 })
    await waitForForm(h)
    h.check('the form of the named file opens (the argument of the command, as the Profiles page passes it)', formRoot(h)?.dataset.profile === 'shop-mill' && formValue(h, 'name') === 'Shop mill 2')
    h.click(h.q('modal-cancel'))
    await h.waitFor(() => !h.q('modal', { modal: 'profile-form' }), { timeout: 10000 })
    await running
    h.check('Cancel on a form with nothing changed asks nothing', (await h.alert.visible()) === null)
    h.check('and the file is the same bytes', (await profileFileText(h, 'shop-mill.json')) === same, null)
    h.check('(and that is still the file’s own layout, CRLF throughout)', allCrlf(same) && allCrlf(original))
  })

  // ============================================================ B. a built-in profile
  await guard(h, 'B. a built-in profile is shown read-only', async () => {
    const program = await feedProgram(h, 'fanuc-gcode')
    const running = ctx.commands.run('profile.editInForm')
    await h.waitFor(() => h.q('modal', { modal: 'profile-form' }), { timeout: 15000 })
    await waitForForm(h)
    const root = formRoot(h)
    h.check('the form of a built-in profile is marked read-only', root?.dataset.profile === 'fanuc-gcode' && root.dataset.readonly === 'true', root?.dataset.readonly)
    h.check('it says so in plain words and offers "Duplicate as a user profile"', (h.q('profile-form-readonly')?.textContent ?? '').trim() === ctx.t('profileForm.readOnlyNote') && (h.q('profile-form-duplicate')?.textContent ?? '').trim() === ctx.t('profileForm.duplicate'), h.q('profile-form-readonly')?.textContent)
    const controls = [...(root?.querySelectorAll('[data-testid="profile-form-field"] input:not([type="color"]), [data-testid="profile-form-field"] textarea, [data-testid="profile-form-field"] select') ?? [])]
    h.check('every control is off', controls.length > 10 && controls.every((control) => /** @type {HTMLInputElement} */ (control).disabled), { controls: controls.length, on: controls.filter((control) => !(/** @type {HTMLInputElement} */ (control).disabled)).length })
    h.check('and Save is off', formSave(h)?.disabled === true)
    h.check('the program the form was asked about is untouched', ctx.docs.get(program)?.dirty !== true)
    h.click(h.q('modal-cancel'))
    await h.waitFor(() => !h.q('modal', { modal: 'profile-form' }), { timeout: 10000 })
    await running
    h.check('Cancel closes it without a question', (await h.alert.visible()) === null)
  })

  h.check('no alert was left unanswered by the sections above', (await h.alert.visible()) === null)
})

// ================================================================================================ p4-profiles-form-page

scenario('p4-profiles-form-page', { timeout: 420, files: REPO_FILE }, async (h) => {
  const ctx = context(h)
  await ready(h)
  await setTheme(h, 'dark')
  await addProfile(h, 'shop-mill.json', SHOP, LAYOUT)
  const path = `${userDirs(h).profilesDir}/shop-mill.json`
  const opened = await openProfilesPage(h)

  // ============================================================ A. the button
  await guard(h, 'A. Edit in form on the Profiles page', async () => {
    const rows = profileRows(h)
    const mine = rows.find((row) => row.id === 'shop-mill' && row.origin === 'user')
    const builtin = rows.filter((row) => row.origin === 'builtin')
    h.check('the page lists the profile file', !!mine && mine.file === 'shop-mill.json', rows.map((row) => `${row.id}:${row.origin}`))
    h.check('a row of your own offers "Edit in form"; no built-in row does', !!mine && !!profileAction(h, 'form', { row: mine.element }) && builtin.length >= 6 && builtin.every((row) => !profileAction(h, 'form', { row: row.element })), builtin.length)
    h.check('the button is called what the command is called in words', (profileAction(h, 'form', { row: mine?.element })?.textContent ?? '').trim() === ctx.t('profileForm.editButton'))

    h.click(profileAction(h, 'form', { row: mine?.element }))
    await waitForForm(h)
    h.check('the form replaces the list inside the page; no second dialog is opened', !!formRoot(h) && !h.q('modal', { modal: 'profile-form' }) && !!h.q('settings-profiles') && profileRows(h).length === 0, { rows: profileRows(h).length })
    h.check('it is the form of shop-mill.json with nothing changed', formRoot(h)?.dataset.profile === 'shop-mill' && formRoot(h)?.dataset.readonly === 'false' && !formDirty(h) && formSave(h)?.disabled === true)
    h.check('the preview editor is there and has drawn the sample', !!h.q('profile-preview') && (await h.waitFor(() => previewLines(h).some((line) => /^N10 /.test(line)), { timeout: 15000 })) === true, previewLines(h).slice(0, 3))

    typeInForm(h, 'numbering.step', '7')
    h.check('a changed field marks the form changed and turns Save on', formDirty(h) && formSave(h)?.disabled === false)
    h.click(formUseParent(h, 'numbering.step'))
    await h.frame()
    h.check('"Use the parent’s value" gives the parent’s value back; the form is clean again', formField(h, 'numbering.step')?.dataset.inherited === 'true' && !formDirty(h), formValue(h, 'numbering.step'))

    typeInForm(h, 'editing.tabWidth', '2')
    typeInForm(h, 'name', 'Shop mill B')
    h.check('two fields changed', formDirty(h) && formSave(h)?.disabled === false)
    h.click(formSave(h))
    await h.waitFor(() => !formRoot(h), { timeout: 20000 })
    await h.idle()
    const written = await profileFileText(h, 'shop-mill.json')
    /** @type {any} */
    const parsed = JSON.parse(written)
    h.check('Save wrote the file and left the form: the list is back', parsed.name === 'Shop mill B' && parsed.editing?.tabWidth === 2 && profileRows(h).some((row) => row.id === 'shop-mill'), parsed)
    h.check('the member that was put back to the parent’s value is not in the file', parsed.numbering === undefined)
    h.check('the file keeps its layout (four blanks, CRLF) and its members where they were', /^ {4}"id"/m.test(written) && allCrlf(written) && JSON.stringify(firstKeys(written, 6)) === JSON.stringify(['id', 'name', 'shortName', 'version', 'extends', 'detect']), JSON.stringify(written.slice(0, 80)))
    h.check('the list shows the new name', profileRows(h).find((row) => row.id === 'shop-mill')?.text.includes('Shop mill B') === true, profileRows(h).find((row) => row.id === 'shop-mill')?.text)
    h.check('the registry has the new tab width, and the profile file’s tab is not left changed', ctx.profiles.profile('shop-mill').editing?.tabWidth === 2 && ctx.docs.byPath(path)?.dirty !== true)
  })

  // ============================================================ B. the $schema line
  await guard(h, 'B. a new profile file starts with the $schema line', async () => {
    const row = profileRows(h).find((entry) => entry.id === 'fanuc-gcode' && entry.origin === 'builtin')
    if (!row) throw new Error('no fanuc-gcode row')
    h.click(profileAction(h, 'new', { row: row.element }))
    await h.waitFor(() => h.q('profile-form', { kind: 'profiles' }), { timeout: 5000 })
    setField(h, 'name', 'shop-new')
    await h.frame()
    h.click(profileAction(h, 'create'))
    await h.waitFor(() => !h.q('profile-form', { kind: 'profiles' }), { timeout: 10000 })
    await h.waitFor(async () => (await h.disk.stat(`${userDirs(h).profilesDir}/shop-new.json`)) !== null, { timeout: 8000 })
    const text = await profileFileText(h, 'shop-new.json')
    /** @type {any} */
    const parsed = JSON.parse(text)
    const want = await schemaId(h, 'profile')
    h.check('the new file’s first member is the $schema line', Object.keys(parsed)[0] === '$schema', Object.keys(parsed))
    h.check('it points at the profile schema of the repository, the address the schema itself names', typeof want === 'string' && want.startsWith('https://') && parsed.$schema === want, { file: parsed.$schema, schema: want })
    h.check('and the file still says what it is and what it starts from', parsed.id === 'shop-new' && parsed.extends === 'fanuc-gcode', parsed)
  })

  await closeProfilesPage(h, opened)
  h.check('Cancel on the page asks nothing: no form was left open and no setting was changed', (await h.alert.visible()) === null)
})
