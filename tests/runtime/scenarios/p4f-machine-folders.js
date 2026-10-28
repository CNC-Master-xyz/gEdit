// P4f, machine folders (plan `docs/planning/phase-4-implementation.md` §6.8.4, rules R1 to R6 of `core/machines/folderRules.ts`; P4.30a; the
// integration decision that a duplicated machine drops its folders): a program saved in a machine's folder uses that machine, with no choice
// made by the user. One scenario, five machines on a made-up DNC tree in the run folder.
//
//   machines (all `fanuc-lathe`)         folders
//     Lathe 1                            dnc/lathe1                (with its subfolders)
//     Lathe 1 special                    dnc/lathe1/special        (longer, so it wins inside lathe1)
//     Lathe 5                            dnc/flat                  (no subfolders)
//     Shared A, Shared B                 dnc/shared                (the same folder: two machines, so no machine)
//     Default lathe                      no folder; the default machine of fanuc-lathe
//
//   A. choice            each program's machine as the status item says it (`data-machine-id`, `data-choice`): lathe1/a.nc and lathe1/sub/b.nc
//                        Lathe 1 by the folder; lathe1/special/c.nc Lathe 1 special (longest match); flat/e.nc Lathe 5 but flat/deep/f.nc not
//                        (no subfolders), so the default; other/g.nc the default; an untitled program is never ruled by a folder.
//   B. two on one folder shared/d.nc: the folder chooses nothing, the program goes on to the default as if there were no rule, and the tooltip names both machines.
//   C. the tooltip       the folder that chose the machine is named in the status item's tooltip.
//   D. order             a machine the user picked for the document wins over the folder; the folder wins over the default.
//   E. editing           taking the folder off the special machine moves c.nc to Lathe 1 at once (the rule is read again, nothing is read from the disk).
//   F. duplicate         a copy of a machine has no folders (two machines on one folder is the conflict of B), the original keeps its own; both in `machines.json`.
//
// **The machines are made through the service** (`ctx.machines.add` with `folders`), as `m12-common` does for the channel blocks; the Machines
// page's Folders section is `src/lib/components/dialogs/MachineFolders.test.ts`'s. The expected machine of each file is typed here from the table above.

import { scenario } from '../lib/index.js'
import { activate, addMachine, context, guard, machineItem, newDoc, openAs, ready, sameJson, setDefault, under, waitForMachine, writeAll } from './p4f-common.js'

scenario('p4f-machine-folders', { timeout: 300 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const base = under(h, 'dnc')
  const files = ['lathe1/a.nc', 'lathe1/sub/b.nc', 'lathe1/special/c.nc', 'shared/d.nc', 'flat/e.nc', 'flat/deep/f.nc', 'other/g.nc']
  await writeAll(h, base, Object.fromEntries(files.map((f) => [f, `(${f})\nG0 X1.\nM30\n`])))

  const l1 = await addMachine(h, { name: 'Lathe 1', folders: [{ path: `${base}/lathe1` }] })
  const special = await addMachine(h, { name: 'Lathe 1 special', folders: [{ path: `${base}/lathe1/special`, subfolders: true }] })
  const l5 = await addMachine(h, { name: 'Lathe 5', folders: [{ path: `${base}/flat`, subfolders: false }] })
  const sharedA = await addMachine(h, { name: 'Shared A', folders: [{ path: `${base}/shared` }] })
  const sharedB = await addMachine(h, { name: 'Shared B', folders: [{ path: `${base}/shared` }] })
  const fallback = await addMachine(h, { name: 'Default lathe' })
  await setDefault(h, 'fanuc-lathe', fallback)

  /** The machine item of the active document: id and choice. */
  const item = () => ({ id: machineItem(h)?.dataset.machineId ?? null, choice: machineItem(h)?.dataset.choice ?? null, tip: machineItem(h)?.getAttribute('title') ?? '' })
  /** Opens a program of the tree and waits for the machine item to settle on `id`. @param {string} rel @param {string} id */
  const openWith = async (rel, id) => {
    const doc = await openAs(h, `${base}/${rel}`, 'fanuc-lathe')
    await waitForMachine(h, id)
    return doc
  }
  /** @type {Record<string, string>} */
  const docs = {}

  await guard(h, 'A. each program has the machine of its folder', async () => {
    /** @type {[string, string, string, string][]} */
    const cases = [
      ['lathe1/a.nc', l1, 'folder', 'a file directly in the folder'],
      ['lathe1/sub/b.nc', l1, 'folder', 'a file in a subfolder (Include subfolders is the default)'],
      ['lathe1/special/c.nc', special, 'folder', 'the longest matching folder wins (lathe1/special against lathe1)'],
      ['flat/e.nc', l5, 'folder', 'a file directly in a folder without subfolders'],
      ['flat/deep/f.nc', fallback, 'default', 'a file below a folder that takes no subfolders: not ruled, the default machine'],
      ['other/g.nc', fallback, 'default', 'a file in no machine\'s folder: the default machine'],
    ]
    for (const [rel, id, choice, what] of cases) {
      docs[rel] = await openWith(rel, id)
      const now = item()
      h.check(`${rel}: ${what}`, now.id === id && now.choice === choice, { wanted: [id, choice], got: now })
    }
    const untitled = await newDoc(h, 'G21\nM30\n', 'fanuc-lathe')
    await h.idle()
    h.check('an untitled program is never ruled by a folder (it has no path): the default machine', item().choice !== 'folder' && ctx.docs.get(untitled)?.path === null, item())
  })

  await guard(h, 'B. two machines on one folder: no machine by the rule', async () => {
    docs['shared/d.nc'] = await openWith('shared/d.nc', fallback)
    const now = item()
    const names = 'Shared A, Shared B'
    h.check('shared/d.nc is claimed by Shared A and Shared B: the folder chooses neither, the default machine is used (choice default, not folder)', now.id === fallback && now.choice === 'default', now)
    h.check('and the tooltip says why: the folder belongs to more than one machine, naming both, and that the default is used', now.tip.includes(ctx.t('machineFolders.ambiguous', { folder: `${base}/shared`, names })), now.tip)
  })

  await guard(h, 'C. the tooltip names the folder that chose the machine', async () => {
    await activate(h, docs['lathe1/special/c.nc'])
    await waitForMachine(h, special)
    h.check('Machine chosen by its folder: the folder as written in the machine, here dnc/lathe1/special', item().tip.includes(ctx.t('machineFolders.byFolder', { folder: `${base}/lathe1/special` })), item().tip)
  })

  await guard(h, 'D. the user\'s own choice wins over the folder, the folder over the default', async () => {
    const a = docs['lathe1/a.nc']
    await activate(h, a)
    await waitForMachine(h, l1)
    await /** @type {any} */ (ctx.machines).setForDoc(a, l5)
    await waitForMachine(h, l5)
    h.check('lathe1/a.nc with Lathe 5 picked for the program: the picked machine (choice document), though its folder says Lathe 1', item().id === l5 && item().choice === 'document', item())
    await /** @type {any} */ (ctx.machines).setForDoc(a, undefined)
    await waitForMachine(h, l1)
    h.check('and when the pick is taken back the folder decides again', item().id === l1 && item().choice === 'folder', item())
  })

  await guard(h, 'E. taking a folder off a machine is read again at once', async () => {
    await /** @type {any} */ (ctx.machines).update(special, { folders: [] })
    await activate(h, docs['lathe1/special/c.nc'])
    await waitForMachine(h, l1)
    h.check('lathe1/special/c.nc is now Lathe 1\'s (the next longest folder), by the folder', item().id === l1 && item().choice === 'folder', item())
    const file = /** @type {any} */ (await h.config.read('machines.json'))
    const record = (/** @type {string} */ id) => /** @type {any} */ (file.machines.find((/** @type {any} */ m) => m.id === id))
    h.check('machines.json holds the folders as written: Lathe 1 one folder, Lathe 5 one without subfolders, the special machine none now', sameJson(record(l1).folders, [{ path: `${base}/lathe1` }]) && sameJson(record(l5).folders, [{ path: `${base}/flat`, subfolders: false }]) && (record(special).folders ?? []).length === 0, file.machines.map((/** @type {any} */ m) => [m.name, m.folders]))
  })

  await guard(h, 'F. a duplicated machine has no folders', async () => {
    const copy = await /** @type {any} */ (ctx.machines).duplicate(l1, 'Lathe 1 copy')
    await h.idle()
    const file = /** @type {any} */ (await h.config.read('machines.json'))
    const record = (/** @type {string} */ id) => /** @type {any} */ (file.machines.find((/** @type {any} */ m) => m.id === id))
    h.check('the copy is in machines.json with no folders; the original keeps its one', !!record(copy) && record(copy).folders === undefined && sameJson(record(l1).folders, [{ path: `${base}/lathe1` }]), { copy: record(copy), original: record(l1)?.folders })
    await activate(h, docs['lathe1/a.nc'])
    await waitForMachine(h, l1)
    h.check('so lathe1/a.nc is still Lathe 1 by the folder, not "two machines on one folder"', item().id === l1 && item().choice === 'folder' && !item().tip.includes(ctx.t('machineFolders.ambiguous', { folder: `${base}/lathe1`, names: 'Lathe 1, Lathe 1 copy' })), item())
    // The machines the shared folder belongs to are still two: removing one makes the other the folder's machine.
    await /** @type {any} */ (ctx.machines).remove(sharedB)
    await activate(h, docs['shared/d.nc'])
    await waitForMachine(h, sharedA)
    h.check('and with Shared B removed, shared/d.nc is Shared A\'s by its folder (the conflict was only the two)', item().id === sharedA && item().choice === 'folder', item())
  })

})
