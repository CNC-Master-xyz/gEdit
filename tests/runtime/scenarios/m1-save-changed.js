// Saving over a file that another program changed (T183, plan §5 M1 `FileOps.save`, AD-10): the guard on the write
// itself, driven with the real Cmd+S and the real NSAlert. `b1-files-spellings` proves the question for a rewrite that
// size and time cannot see, and answers Cancel through the command API; this is the path a user takes, with all
// three answers a file can leave:
//
//   changed   a CAM post rewrote the file (other text, other size, later time) while the tab holds unsaved text. The
//             tab shows the change (the banner); Cmd+S asks "Changed on Disk" instead of writing. Cancel writes
//             nothing and leaves the other program's bytes and the unsaved text; a second Cmd+S answered with
//             Overwrite writes the tab's text over the file.
//   deleted   the file is gone: a save needs no question, because there is nothing to overwrite. It writes the file
//             again, without an alert.

import { scenario } from '../lib/index.js'

scenario('m1-save-changed', { timeout: 150 }, async (h) => {
  const ctx = /** @type {any} */ (h.app.ctx)
  const file = await h.fixture('nc/fanuc/f01-mill-3tools.nc')
  const tab = () => h.q('doc-tab', { path: file })
  const save = () => h.nativeKeys([{ key: 's', mods: ['cmd'] }])

  await h.dialogs.queue('open', [file])
  await h.nativeKeys([{ key: 'o', mods: ['cmd'] }])
  await h.waitFor(() => !!tab(), { timeout: 10000 })
  const id = ctx.docs.byPath(file).id
  h.check('the file is open and clean', tab()?.dataset.dirty === '0' && tab()?.dataset.external === 'none', { dirty: tab()?.dataset.dirty, external: tab()?.dataset.external })
  h.focusEditor()
  await h.nativeType('(MINE)\n')
  await h.waitFor(() => tab()?.dataset.dirty === '1', { timeout: 4000 })

  // ------------------------------------------------------------ changed
  const theirs = '(THEIRS, REWRITTEN BY THE POST)\nG0 X0\nM30\n'
  await h.disk.write(file, theirs)
  await h.disk.touch(file, Date.now() / 1000 + 30)
  await ctx.external.checkNow()
  await h.waitFor(() => tab()?.dataset.external === 'changed', { timeout: 8000 })
  h.check('the unsaved tab shows the change and is not reloaded over', tab()?.dataset.external === 'changed' && tab()?.dataset.dirty === '1' && ctx.editor.getText(id).includes('(MINE)'), {
    external: tab()?.dataset.external,
    dirty: tab()?.dataset.dirty,
  })

  await save()
  const question = await h.alert.wait()
  const shown = [...(question?.texts ?? []), ...(question?.buttons ?? [])].join('\n')
  h.check(
    'Cmd+S asks "Changed on Disk" and names the file, with Overwrite and Cancel',
    !!question && shown.includes(ctx.t('files.changedOnDiskTitle')) && shown.includes('f01-mill-3tools.nc') && (question.buttons ?? []).includes(ctx.t('files.overwriteButton')) && (question.buttons ?? []).includes('Cancel'),
    question,
  )
  h.check('nothing is written while the question is up', (await h.disk.read(file)) === theirs, await h.disk.read(file))
  await h.alert.click('Cancel')
  await h.idle()
  h.check(
    'Cancel writes nothing: the file is as the other program left it, the text is still unsaved, the change is still shown',
    (await h.disk.read(file)) === theirs && tab()?.dataset.dirty === '1' && tab()?.dataset.external === 'changed' && ctx.editor.getText(id).includes('(MINE)') && (await h.alert.visible()) === null,
    { disk: (await h.disk.read(file)).slice(0, 40), dirty: tab()?.dataset.dirty, external: tab()?.dataset.external },
  )

  await save()
  await h.alert.wait()
  await h.alert.click(ctx.t('files.overwriteButton'))
  await h.waitFor(() => tab()?.dataset.dirty === '0', { timeout: 8000 })
  const written = await h.disk.read(file)
  h.check('Overwrite writes the tab\'s text over the other program\'s, and the tab is clean again', written.includes('(MINE)') && !written.includes('THEIRS') && tab()?.dataset.dirty === '0', { disk: written.slice(0, 40), dirty: tab()?.dataset.dirty })
  await h.waitFor(() => tab()?.dataset.external === 'none', { timeout: 8000 })
  h.check('and the change is no longer shown', tab()?.dataset.external === 'none', tab()?.dataset.external)

  // ------------------------------------------------------------ deleted
  h.focusEditor()
  await h.nativeType('(AGAIN)\n')
  await h.waitFor(() => tab()?.dataset.dirty === '1', { timeout: 4000 })
  const text = ctx.editor.getText(id)
  await h.disk.remove(file)
  await ctx.external.checkNow()
  await h.waitFor(() => tab()?.dataset.external === 'deleted', { timeout: 8000 })
  h.check('the file is gone from disk and the tab says so', (await h.disk.stat(file)) === null && tab()?.dataset.external === 'deleted', { external: tab()?.dataset.external })
  await save()
  await h.waitFor(() => tab()?.dataset.dirty === '0', { timeout: 8000 })
  const again = await h.disk.stat(file)
  h.check('saving a file that is gone writes it again without a question', !!again && again.len > 0 && (await h.disk.read(file)).includes('(AGAIN)') && (await h.alert.visible()) === null, { stat: again })
  h.check('the text written is the tab\'s own', (await h.disk.read(file)).replace(/\r\n/g, '\n') === text, { disk: (await h.disk.read(file)).slice(0, 60) })
})
