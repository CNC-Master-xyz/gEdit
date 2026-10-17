// Helpers the P4e scenarios share (`p4-split`, `p4-channels`, `p4-compare`). This file registers no
// scenario: `loadScenarios()` imports it like any other file under `scenarios/` and finds nothing new in it.
//
// Four things are worth knowing before reading a check that uses these:
//
//   1. **The editor groups are read from two places.** The DOM says what the user sees: `editor-host`
//      (`data-layout`, `data-groups`) and one `editor-group` per group (`data-group`, `data-index`,
//      `data-doc-id`, `data-kind`, `data-channel`, `data-focused`, `data-ready`), with its header and
//      close button. The service says what Monaco holds: `ctx.editor.groupsState()` and
//      `ctx.editor.groupViews()` (the live editors, in display order). A group's editor is not built
//      until its component is mounted, so `waitGroups` waits for `data-ready="1"` on every group before
//      a scenario touches an editor.
//   2. **The focus is the browser's.** A group has the keyboard when the active element is the
//      textarea inside its box (`textFocusIn`), not when the service says it is focused; the two have to
//      agree and the scenarios check both. A group is given the keyboard with `ctx.editor.focusGroup`
//      or with F6; `h.focusEditor()` is not used because it always takes the first textarea of the host.
//   3. **Keys go through the real key path where the key is the point.** F6 and Shift+F6, Cmd+Z and
//      Cmd+Shift+Z, and everything typed are native key presses; a menu command (Split Editor, Close Split)
//      is clicked on the ribbon's View tab; a cursor is placed with the editor's own `setPosition` because
//      a click would also move the focus and the selection.
//   4. **Expected texts are written out here from the programs' own lines or from `ctx.t(...)`**, never
//      read from what the app shows. The fixtures of the channel scenarios are `tests/fixtures/p4e/`
//      (its README has the line numbers); the comparison pair of `p4-compare` is written in that scenario.

import { context, message, newDoc, ready, ribbonTab } from './m4-common.js'
import { setTheme } from './m3-common.js'
import { guard } from './m10-common.js'

export { context, guard, message, newDoc, ready, ribbonTab, setTheme }

/** @typedef {import('../lib/api.js').Harness} Harness */

/**
 * The editor groups on screen, in display order.
 * @param {Harness} h
 */
export function groupsOnScreen(h) {
  return h
    .qa('editor-group')
    .map((el) => ({
      el,
      id: el.dataset.group ?? '',
      index: Number(el.dataset.index ?? '-1'),
      docId: el.dataset.docId ?? '',
      kind: el.dataset.kind ?? '',
      channel: el.dataset.channel ?? '',
      focused: el.dataset.focused === 'true',
      ready: el.dataset.ready === '1',
    }))
    .sort((a, b) => a.index - b.index)
}

/** The layout the host says it has. @param {Harness} h */
export const hostLayout = (h) => h.q('editor-host')?.dataset.layout ?? ''

/** How many groups the host says it has. @param {Harness} h */
export const hostGroups = (h) => Number(h.q('editor-host')?.dataset.groups ?? '0')

/**
 * Waits until the host shows `count` groups in `layout` and every group has built its editor.
 * @param {Harness} h
 * @param {number} count
 * @param {string} layout `single`, `side-by-side`, `stacked` or `channels`
 * @returns {Promise<ReturnType<typeof groupsOnScreen>>}
 */
export async function waitGroups(h, count, layout) {
  await h.waitFor(
    () => {
      const groups = groupsOnScreen(h)
      return hostLayout(h) === layout && hostGroups(h) === count && groups.length === count && groups.every((g) => g.ready)
    },
    { timeout: 15000 },
  )
  await h.idle()
  return groupsOnScreen(h)
}

/** The live editors of the groups, in display order. @param {Harness} h */
export const views = (h) => /** @type {any[]} */ (/** @type {any} */ (context(h).editor).groupViews())

/** The live editor of one group. @param {Harness} h @param {string} groupId */
export const editorOf = (h, groupId) => /** @type {any} */ (views(h).find((v) => v.id === groupId)?.editor)

/** The group ids of the service, in display order. @param {Harness} h */
export const groupIds = (h) => context(h).editor.groupsState().groups.map((g) => g.id)

/** The group the service says has the focus. @param {Harness} h */
export const focusedGroup = (h) => context(h).editor.groupsState().focused

/** Whether the browser's active element is the text input of group `groupId`. @param {Harness} h @param {string} groupId */
export function textFocusIn(h, groupId) {
  const active = document.activeElement
  return !!active && active.tagName === 'TEXTAREA' && active.closest('[data-testid="editor-group"]')?.getAttribute('data-group') === groupId
}

/** Waits until group `groupId` has the keyboard (service and browser agree). @param {Harness} h @param {string} groupId */
export async function waitFocus(h, groupId) {
  await h.waitFor(() => focusedGroup(h) === groupId && textFocusIn(h, groupId), { timeout: 8000 })
  await h.idle()
  return focusedGroup(h) === groupId && textFocusIn(h, groupId)
}

/**
 * Gives group `groupId` the keyboard and puts its cursor on a pane line.
 * @param {Harness} h
 * @param {string} groupId
 * @param {number} line the editor's own line (a pane's line in the channel view)
 * @param {number} [column]
 */
export async function placeCursor(h, groupId, line, column = 1) {
  context(h).editor.focusGroup(groupId)
  const editor = editorOf(h, groupId)
  if (!editor) throw new Error(`placeCursor: group ${groupId} has no editor`)
  editor.setPosition({ lineNumber: line, column })
  editor.revealLineInCenterIfOutsideViewport(line)
  await waitFocus(h, groupId)
}

/** Types real key presses into whatever has the keyboard. @param {Harness} h @param {string} text */
export async function typeText(h, text) {
  await h.nativeType(text)
  await h.idle()
}

/**
 * One key press, then the page settles.
 * @param {Harness} h
 * @param {string} key
 * @param {string[]} [mods]
 */
export async function pressKey(h, key, mods = []) {
  await h.nativeKeys([{ key, mods: /** @type {any} */ (mods) }])
  await h.idle()
}

/** F6 and Shift+F6. @param {Harness} h */
export const nextPane = (h) => pressKey(h, 'F6')
/** @param {Harness} h */
export const previousPane = (h) => pressKey(h, 'F6', ['shift'])

/** Cmd+Z, Cmd+Shift+Z. @param {Harness} h */
export const undoKey = (h) => pressKey(h, 'z', ['cmd'])
/** @param {Harness} h */
export const redoKey = (h) => pressKey(h, 'z', ['cmd', 'shift'])

/**
 * A ribbon button of the View or NC tab, clicked the way a user does it. Answers false (and clicks
 * nothing) when the button is disabled.
 * @param {Harness} h
 * @param {string} tab the id of the ribbon tab (`view`, `nc`, `edit`)
 * @param {string} command
 */
export async function clickRibbon(h, tab, command) {
  await ribbonTab(h, tab)
  const button = /** @type {HTMLButtonElement | null} */ (h.q('cmd-button', { command }))
  if (!button) throw new Error(`clickRibbon: no ${command} button on the ${tab} tab`)
  if (button.disabled) return false
  h.click(button)
  await h.idle()
  return true
}

/** Whether a ribbon button is there and disabled. @param {Harness} h @param {string} command */
export const ribbonDisabled = (h, command) => /** @type {HTMLButtonElement | null} */ (h.q('cmd-button', { command }))?.disabled === true

/** Whether a ribbon button is there and enabled. @param {Harness} h @param {string} command */
export const ribbonEnabled = (h, command) => /** @type {HTMLButtonElement | null} */ (h.q('cmd-button', { command }))?.disabled === false

/** The computed colour of a CSS variable, as WebKit prints it (`rgb(...)`). @param {string} name */
export function colourOfVariable(name) {
  const probe = document.createElement('span')
  probe.style.color = `var(${name})`
  document.body.appendChild(probe)
  const colour = getComputedStyle(probe).color
  probe.remove()
  return colour
}

/**
 * The Monaco roots of the groups (not the widgets inside them), with the theme class each carries and
 * the colours it paints with.
 * @returns {{ theme: string, background: string, variable: string, group: string }[]}
 */
export function editorLooks() {
  return [...document.querySelectorAll('[data-testid="editor-group"]')].flatMap((group) => {
    const root = /** @type {HTMLElement | null} */ (group.querySelector(':scope > .surface > .monaco-editor'))
    if (!root) return []
    const classes = root.classList
    return [
      {
        theme: classes.contains('vs-dark') ? 'vs-dark' : classes.contains('vs') ? 'vs' : classes.contains('hc-black') ? 'hc-black' : '(none)',
        background: getComputedStyle(root.querySelector('.monaco-editor-background') ?? root).backgroundColor,
        variable: getComputedStyle(root).getPropertyValue('--vscode-editor-background').trim(),
        group: group.getAttribute('data-group') ?? '',
      },
    ]
  })
}

/** The document's own theme and the stored choice. @param {Harness} h */
export const appTheme = (h) => ({ data: document.documentElement.dataset.theme ?? '', setting: context(h).settings.get('appearance.theme') })

/** The Monaco theme a mode needs. @param {'light' | 'dark'} mode */
export const monacoThemeFor = (mode) => (mode === 'dark' ? 'vs-dark' : 'vs')

/** One line of a document, 1-based. @param {Harness} h @param {string} id @param {number} line */
export const lineOf = (h, id, line) => context(h).editor.getLines(id, line, line)[0] ?? ''

/** The whole text of a document without the trailing line break. @param {Harness} h @param {string} id */
export const textOf = (h, id) => context(h).editor.getText(id)

/** The lines of a text as the editor numbers them (the trailing line break is an empty last line). @param {string} text */
export const linesOfText = (text) => text.split('\n')

