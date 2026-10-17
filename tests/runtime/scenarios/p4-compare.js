// P4e, the word marks and the aligned view in a comparison (plan `docs/planning/phase-4-implementation.md` §5 P4e, P4.24
// and P4.25; exit criterion X30): a changed line pair marks the whole words that differ, and the third view of the
// comparison, Aligned, shows both programs as written, level on their blocks, and merges a block or a word either way
// as one undo step of the target.
//
// **The pair is written here** (a Fanuc milling program, nine lines against ten). Against `ORIGINAL`, `CURRENT` has
// `F1200` changed to `F1000` on line 5, block `N60` renumbered to `N65` on line 7 (nothing else changed there), and a new
// block `N75` on line 9. So, with the review options of a Fanuc program (block numbers ignored):
//   - raw view          three changes: lines 5 and 7 (a changed pair each) and the new line 9; the word marks are
//                       `F1200` / `F1000` and `N60` / `N65` (whole words, not two digits);
//   - review mode       the normalized copies: the renumbered line is equal, so the marks are `F1200` / `F1000` only;
//   - aligned           two blocks (line 5 against 5, and the new line 9 against nothing, with one filler line on the
//                       original side), the same word marks; with "block numbers" off, a third block (line 7) and the
//                       marks `N60` / `N65` come in.
//
//   A. the raw view and review mode    the word marks, read from the models' decorations (`gedit-word-changed`); the marks go
//                                      with the comparison (none are left on the document afterwards).
//   B. the aligned view                the third button of the switch, the two panes with the programs as written, the tinted
//                                      blocks, the arrows in the margin, the filler that keeps the panes level (the tops of
//                                      facing lines are equal and the panes equally tall), the word marks.
//   C. the review toggle               "block numbers" off adds the renumbered line as a difference, on removes it again.
//   D. merging                         a click on a block's arrow (a real mouse click) copies the block: ONE undo step of the
//                                      target, and the target has the keyboard; the arrow in the original's filler removes
//                                      the block the original lacks; the arrow of a one-sided block copies it into the
//                                      original; "← Word" copies the marked word at the cursor into the original.
//   D5. typing in a pane               forced upper case (the dialect's own setting) reaches the aligned view's panes: `g1x10`
//                                      typed with real key presses into the current document's pane reads `G1X10` in the
//                                      document, and the other pane's document is not touched; undone again afterwards.
//   E. closing                         the editors are back, the keyboard is in the editor, no mark or tint is left.

import { scenario } from '../lib/index.js'
import { closeCompare, diffEditor, guard, monacoRegistry, openCompare, setMode, toggles, view } from './m11-common.js'
import { context, message, newDoc, ready, textOf, undoKey } from './p4e-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

const ORIGINAL = [
  '(SYNTHETIC COMPARE PAIR FOR THE WORD MARKS AND THE ALIGNED VIEW, NOT FOR A MACHINE)',
  'N10 G21 G40 G90',
  'N20 T1 M6',
  'N30 G0 X0. Y0.',
  'N40 G1 X10. Y5. F1200',
  'N50 G1 X20. Y5.',
  'N60 G1 X30. Y10.',
  'N70 G1 X40. Y10.',
  'N80 M30',
  '',
]
const CURRENT = [
  ORIGINAL[0],
  'N10 G21 G40 G90',
  'N20 T1 M6',
  'N30 G0 X0. Y0.',
  'N40 G1 X10. Y5. F1000',
  'N50 G1 X20. Y5.',
  'N65 G1 X30. Y10.',
  'N70 G1 X40. Y10.',
  'N75 G1 X45. Y10.',
  'N80 M30',
  '',
]
const ORIGINAL_TEXT = ORIGINAL.join('\n')
const CURRENT_TEXT = CURRENT.join('\n')

const CHANGED = 'gedit-aligned-changed'
const ONLY_MODIFIED = 'gedit-aligned-only-modified'
const WORD = 'gedit-word-changed'

/** Lines of the whole-line tint `className` on a model. @param {any} editor @param {string} className */
function tinted(editor, className) {
  return /** @type {any[]} */ (editor.getModel().getAllDecorations())
    .filter((d) => d.options.className === className)
    .flatMap((d) => Array.from({ length: d.range.endLineNumber - d.range.startLineNumber + 1 }, (_, i) => d.range.startLineNumber + i))
    .sort((a, b) => a - b)
}

/** The marked words of a model, sorted. @param {any} editor */
function words(editor) {
  const model = editor.getModel()
  return /** @type {any[]} */ (model.getAllDecorations())
    .filter((d) => d.options.inlineClassName === WORD)
    .map((d) => model.getValueInRange(d.range))
    .sort()
}

/** The lines that carry an arrow in the margin: `[line, class]`. @param {any} editor */
function arrows(editor) {
  return /** @type {any[]} */ (editor.getModel().getAllDecorations())
    .filter((d) => String(d.options.linesDecorationsClassName ?? '').startsWith('gedit-aligned-arrow'))
    .map((d) => [d.range.startLineNumber, d.options.linesDecorationsClassName])
    .sort((a, b) => a[0] - b[0])
}

const sameJson = (/** @type {unknown} */ a, /** @type {unknown} */ b) => JSON.stringify(a) === JSON.stringify(b)

scenario('p4-compare', { timeout: 420 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const original = await newDoc(h, ORIGINAL_TEXT, 'fanuc-gcode')
  const current = await newDoc(h, CURRENT_TEXT, 'fanuc-gcode')
  const reg = monacoRegistry(h)
  const source = { kind: /** @type {const} */ ('document'), docId: original }

  /** Both panes of the aligned view. */
  const pane = () => {
    const find = (/** @type {'original' | 'modified'} */ side) => {
      const host = h.q(`aligned-pane-${side}`)
      return /** @type {any} */ (reg.editors.listCodeEditors().find((/** @type {any} */ e) => !!host && host.contains(e.getDomNode())))
    }
    return { original: find('original'), modified: find('modified') }
  }
  /** Waits until the aligned view says exactly which lines are tinted as changed (the alignment is redone 150 ms after a change). @param {number[]} want */
  const waitBlocks = async (want) => {
    await h.waitFor(() => pane().original && pane().modified && sameJson(tinted(pane().original, CHANGED), want) && sameJson(tinted(pane().modified, CHANGED), want), { timeout: 8000 })
    await h.idle()
    return pane()
  }
  const lineHeight = (/** @type {any} */ editor) => editor.getTopForLineNumber(3) - editor.getTopForLineNumber(2)

  // ============================================================ A. word marks in the raw view and review mode
  await guard(h, 'A. word marks', async () => {
    await openCompare(h, reg, current, source)
    await setMode(h, 'raw')
    const diff = diffEditor(reg)
    const o = () => diff.getOriginalEditor()
    const m = () => diff.getModifiedEditor()
    await h.waitFor(() => sameJson(words(o()), ['F1200', 'N60']) && sameJson(words(m()), ['F1000', 'N65']), { timeout: 10000 })
    h.check('raw view: the whole words that differ are marked on the original side: F1200 and N60 (not two digits of them)', sameJson(words(o()), ['F1200', 'N60']), words(o()))
    h.check('and on the current side: F1000 and N65; the new line N75 has no partner and no mark', sameJson(words(m()), ['F1000', 'N65']), words(m()))
    const onScreen = [...(view(h)?.querySelectorAll(`.${WORD}`) ?? [])].map((e) => e.textContent ?? '').join('')
    h.check('the marks are drawn: the words are on screen with the mark class', onScreen.includes('F1200') && onScreen.includes('F1000'), onScreen)

    await setMode(h, 'review')
    await h.waitFor(() => sameJson(words(diffEditor(reg).getOriginalEditor()), ['F1200']) && sameJson(words(diffEditor(reg).getModifiedEditor()), ['F1000']), { timeout: 10000 })
    h.check('review mode (block numbers ignored): the renumbered line is no difference, so only F1200 and F1000 are marked', sameJson(words(diffEditor(reg).getOriginalEditor()), ['F1200']) && sameJson(words(diffEditor(reg).getModifiedEditor()), ['F1000']), { original: words(diffEditor(reg).getOriginalEditor()), modified: words(diffEditor(reg).getModifiedEditor()) })
    h.check('the switch has three buttons, Raw, Review and Aligned, and Review is the pressed one', sameJson(h.qa('compare-mode').map((e) => e.dataset.mode), ['raw', 'review', 'aligned']) && h.q('compare-mode', { mode: 'review' })?.getAttribute('aria-pressed') === 'true' && h.q('compare-mode', { mode: 'aligned' })?.getAttribute('aria-pressed') === 'false', h.qa('compare-mode').map((e) => `${e.dataset.mode}:${e.getAttribute('aria-pressed')}`))
  })

  // ============================================================ B. the aligned view
  await guard(h, 'B. the aligned view', async () => {
    await setMode(h, 'aligned')
    await h.waitFor(() => h.q('aligned-view') && pane().original && pane().modified, { timeout: 15000 })
    await waitBlocks([5])
    const { original: o, modified: m } = pane()
    h.check('the view says aligned, the third button is pressed, and the diff editor is gone', view(h)?.dataset.mode === 'aligned' && h.q('compare-mode', { mode: 'aligned' })?.getAttribute('aria-pressed') === 'true' && h.q('compare-mode', { mode: 'review' })?.getAttribute('aria-pressed') === 'false' && !view(h)?.querySelector('.monaco-diff-editor') && !!h.q('aligned-host'), { mode: view(h)?.dataset.mode })
    h.check('two panes: the original on the left and the current document on the right, in two editors', !!h.q('aligned-pane-original') && !!h.q('aligned-pane-modified') && !!o && !!m && (h.q('aligned-pane-original')?.getBoundingClientRect().right ?? Infinity) <= (h.q('aligned-pane-modified')?.getBoundingClientRect().left ?? 0) + 2)
    h.check('both programs are shown as written (block numbers and all)', o.getModel().getValue(1) === ORIGINAL_TEXT && m.getModel().getValue(1) === CURRENT_TEXT)
    h.check('the review bar stays: the five toggles, block numbers on', h.qa('compare-option').length === 5 && toggles(h).ignoreBlockNumbers === true, toggles(h))
    h.check('the toolbar offers the block copy both ways and the word copy both ways', h.qa('compare-copy').length === 2 && h.qa('compare-copy-word').length === 2 && sameJson(h.qa('compare-copy-word').map((e) => e.dataset.direction).sort(), ['toModified', 'toOriginal']))

    h.check('the changed pair is tinted on both sides: line 5 against line 5 (the renumbered line 7 is equal while block numbers are ignored)', sameJson(tinted(o, CHANGED), [5]) && sameJson(tinted(m, CHANGED), [5]), { o: tinted(o, CHANGED), m: tinted(m, CHANGED) })
    h.check('the new line is tinted as one-sided on the current side only: line 9', sameJson(tinted(m, ONLY_MODIFIED), [9]) && tinted(o, ONLY_MODIFIED).length === 0, tinted(m, ONLY_MODIFIED))
    h.check('arrows in the margin: right on the original\'s line 5; left on the current\'s lines 5 and 9', sameJson(arrows(o), [[5, 'gedit-aligned-arrow-right']]) && sameJson(arrows(m), [[5, 'gedit-aligned-arrow-left'], [9, 'gedit-aligned-arrow-left']]), { o: arrows(o), m: arrows(m) })

    // Level: the original has no line for the new one, so a filler of one line sits after its line 8.
    const fillers = h.qa('aligned-filler')
    h.check('one filler, on the original side, one line high', fillers.length === 1 && fillers[0].dataset.side === 'original' && Math.abs(fillers[0].getBoundingClientRect().height - lineHeight(o)) < 2, fillers.map((f) => `${f.dataset.side}:${f.getBoundingClientRect().height}`))
    h.check('with the filler the panes are level: the original\'s lines 8 and 9 face the current\'s lines 8 and 10 at the same height', o.getTopForLineNumber(8) === m.getTopForLineNumber(8) && o.getTopForLineNumber(9) === m.getTopForLineNumber(10), { o: [o.getTopForLineNumber(8), o.getTopForLineNumber(9)], m: [m.getTopForLineNumber(8), m.getTopForLineNumber(10)] })
    h.check('and the two panes are equally tall', Math.abs(o.getScrollHeight() - m.getScrollHeight()) <= 1, [o.getScrollHeight(), m.getScrollHeight()])
    h.check('a filler arrow sits in it: the original has no line for the new block, so its arrow is in the filler', h.qa('aligned-arrow').length === 1 && h.q('aligned-arrow')?.dataset.side === 'original', h.qa('aligned-arrow').length)

    await h.waitFor(() => sameJson(words(o), ['F1200']) && sameJson(words(m), ['F1000']), { timeout: 8000 })
    h.check('the word marks are in the changed pair: F1200 and F1000, whole words', sameJson(words(o), ['F1200']) && sameJson(words(m), ['F1000']), { o: words(o), m: words(m) })
  })

  // ============================================================ C. the review toggles
  await guard(h, 'C. a review toggle takes a renumbered-only difference out', async () => {
    h.click(h.q('compare-option', { option: 'ignoreBlockNumbers' }))
    const both = await waitBlocks([5, 7])
    h.check('block numbers off: the renumbered line 7 (N60 against N65) is a difference now, a block of its own', sameJson(tinted(both.original, CHANGED), [5, 7]) && sameJson(tinted(both.modified, CHANGED), [5, 7]) && toggles(h).ignoreBlockNumbers === false, { o: tinted(both.original, CHANGED), toggles: toggles(h) })
    await h.waitFor(() => sameJson(words(both.original), ['F1200', 'N60']) && sameJson(words(both.modified), ['F1000', 'N65']), { timeout: 8000 })
    h.check('and its words are marked: N60 and N65', sameJson(words(both.original), ['F1200', 'N60']) && sameJson(words(both.modified), ['F1000', 'N65']), { o: words(both.original), m: words(both.modified) })
    h.check('the panes are still level (same line count each side, so no extra filler for it)', both.original.getTopForLineNumber(9) === both.modified.getTopForLineNumber(10))
    h.click(h.q('compare-option', { option: 'ignoreBlockNumbers' }))
    const back = await waitBlocks([5])
    h.check('block numbers on again: the renumbered line is no difference any more', sameJson(tinted(back.original, CHANGED), [5]) && toggles(h).ignoreBlockNumbers === true, { o: tinted(back.original, CHANGED), toggles: toggles(h) })
    await h.waitFor(() => sameJson(words(back.original), ['F1200']) && sameJson(words(back.modified), ['F1000']), { timeout: 8000 })
    h.check('and its word marks go with it', sameJson(words(back.original), ['F1200']) && sameJson(words(back.modified), ['F1000']), { o: words(back.original), m: words(back.modified) })
  })

  // ============================================================ D. merging
  await guard(h, 'D1. the arrow of a block copies it: one undo step, the target has the keyboard', async () => {
    const arrow = h.q('aligned-pane-original')?.querySelector('.gedit-aligned-arrow-right')
    if (!arrow) throw new Error('no arrow on the original side')
    // The strip is 26 px wide and only the drawn triangle (x 0-12) copies: the centre (x 13) would miss it.
    await h.nativeClick(/** @type {HTMLElement} */ (arrow), { dx: -9 })
    const merged = [...CURRENT.slice(0, 4), ORIGINAL[4], ...CURRENT.slice(5)].join('\n')
    await h.waitFor(() => textOf(h, current) === merged, { timeout: 8000 })
    h.check('a click on the arrow in the original\'s margin copies line 5 over the current document\'s line 5: the document now says F1200', textOf(h, current) === merged, { line: ctx.editor.getLines(current, 5, 5)[0], status: message(h) })
    h.check('the original is untouched, the current document is marked as changed', textOf(h, original) === ORIGINAL_TEXT && ctx.docs.get(current)?.dirty === true)
    await waitBlocks([])
    h.check('and the block is no difference any more (only the new line is left)', sameJson(tinted(pane().modified, CHANGED), []) && sameJson(tinted(pane().modified, ONLY_MODIFIED), [9]))
    h.check('the keyboard is in the target: the current document\'s pane', document.activeElement?.tagName === 'TEXTAREA' && !!h.q('aligned-pane-modified')?.contains(document.activeElement), document.activeElement?.className)
    await undoKey(h)
    await h.waitFor(() => textOf(h, current) === CURRENT_TEXT, { timeout: 8000 })
    h.check('ONE Cmd+Z takes the whole merge back', textOf(h, current) === CURRENT_TEXT && ctx.docs.get(current)?.dirty !== true, { line: ctx.editor.getLines(current, 5, 5)[0] })
    const again = await waitBlocks([5])
    h.check('and the block is a difference again, with its word marks', sameJson(tinted(again.original, CHANGED), [5]), tinted(again.original, CHANGED))
  })

  await guard(h, 'D2. the filler\'s arrow removes the block the original lacks', async () => {
    await waitBlocks([5])
    await h.waitFor(() => !!h.q('aligned-arrow'), { timeout: 5000 })
    await h.nativeClick(h.q('aligned-arrow'))
    const without = [...CURRENT.slice(0, 8), ...CURRENT.slice(9)].join('\n')
    await h.waitFor(() => textOf(h, current) === without, { timeout: 8000 })
    h.check('the arrow in the original\'s filler copies "nothing" over the new line: N75 is gone from the current document, nothing else changed', textOf(h, current) === without, { count: ctx.editor.getLineCount(current), status: message(h) })
    await h.waitFor(() => h.qa('aligned-filler').length === 0, { timeout: 5000 })
    h.check('and the filler went with the difference', h.qa('aligned-filler').length === 0)
    await undoKey(h)
    await h.waitFor(() => textOf(h, current) === CURRENT_TEXT, { timeout: 8000 })
    h.check('one Cmd+Z brings the line back', textOf(h, current) === CURRENT_TEXT)
    await waitBlocks([5])
    await h.waitFor(() => h.qa('aligned-filler').length === 1, { timeout: 5000 })
  })

  await guard(h, 'D3. the arrow of a one-sided block copies it into the original', async () => {
    const arrow = [...(h.q('aligned-pane-modified')?.querySelectorAll('.gedit-aligned-arrow-left') ?? [])].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[1]
    if (!arrow) throw new Error('no arrow on the current side\'s line 9')
    // The strip is 26 px wide and only the drawn triangle (x 0-12) copies: the centre (x 13) would miss it.
    await h.nativeClick(/** @type {HTMLElement} */ (arrow), { dx: -9 })
    const withLine = [...ORIGINAL.slice(0, 8), CURRENT[8], ...ORIGINAL.slice(8)].join('\n')
    await h.waitFor(() => textOf(h, original) === withLine, { timeout: 8000 })
    h.check('the arrow on the current document\'s line 9 inserts N75 into the original, behind its line 8 (an open document can be edited)', textOf(h, original) === withLine && textOf(h, current) === CURRENT_TEXT, { count: ctx.editor.getLineCount(original), status: message(h) })
    h.check('the keyboard is in the original\'s pane now', document.activeElement?.tagName === 'TEXTAREA' && !!h.q('aligned-pane-original')?.contains(document.activeElement))
    await undoKey(h)
    await h.waitFor(() => textOf(h, original) === ORIGINAL_TEXT, { timeout: 8000 })
    h.check('ONE Cmd+Z in the original takes it back; the current document was never touched', textOf(h, original) === ORIGINAL_TEXT && textOf(h, current) === CURRENT_TEXT && ctx.docs.get(original)?.dirty !== true)
    await waitBlocks([5])
  })

  await guard(h, 'D4. a word is copied', async () => {
    const { modified: m } = pane()
    const column = CURRENT[4].indexOf('F1000') + 3
    m.focus()
    m.setPosition({ lineNumber: 5, column })
    await h.idle()
    const copyWord = h.q('compare-copy-word', { direction: 'toOriginal' })
    h.check('"← Word" is on offer with the cursor in F1000', copyWord?.getAttribute('data-disabled') !== 'true', copyWord?.getAttribute('data-disabled'))
    h.click(copyWord)
    const wanted = [...ORIGINAL.slice(0, 4), ORIGINAL[4].replace('F1200', 'F1000'), ...ORIGINAL.slice(5)].join('\n')
    await h.waitFor(() => textOf(h, original) === wanted, { timeout: 8000 })
    h.check('it writes F1000 over F1200 in the original: that word only, the rest of the line and of the program as it was', textOf(h, original) === wanted && textOf(h, current) === CURRENT_TEXT, { line: ctx.editor.getLines(original, 5, 5)[0], status: message(h) })
    h.check('the keyboard is in the target, the original\'s pane', document.activeElement?.tagName === 'TEXTAREA' && !!h.q('aligned-pane-original')?.contains(document.activeElement))
    await undoKey(h)
    await h.waitFor(() => textOf(h, original) === ORIGINAL_TEXT, { timeout: 8000 })
    h.check('one Cmd+Z takes the word back', textOf(h, original) === ORIGINAL_TEXT && ctx.docs.get(original)?.dirty !== true)
    await waitBlocks([5])
    const noWord = h.q('compare-copy-word', { direction: 'toModified' })
    pane().original.focus()
    // Line 5 differs, and column 2 is in N40, outside the marked F1200.
    pane().original.setPosition({ lineNumber: 5, column: 2 })
    await h.idle()
    h.click(noWord)
    await h.idle()
    h.check('with the cursor in no marked word it says so and changes nothing', message(h) === ctx.t('compare.wordNoWord') && textOf(h, original) === ORIGINAL_TEXT && textOf(h, current) === CURRENT_TEXT, { status: message(h) })
  })

  await guard(h, 'D5. typing in the editable pane follows the document\'s upper-case setting', async () => {
    await waitBlocks([5])
    const profile = ctx.profiles.profile('fanuc-gcode')
    h.check('the Fanuc profile asks for capitals (what the pane is hooked to)', profile.editing?.forceUppercase === true, profile.editing)
    const { modified: m } = pane()
    const last = m.getModel().getLineCount()
    h.check('the current document ends with an empty line to type on', m.getModel().getLineContent(last) === '', m.getModel().getLineContent(last))
    m.focus()
    m.setPosition({ lineNumber: last, column: 1 })
    await h.idle()
    const input = h.q('aligned-pane-modified')?.querySelector('textarea')
    h.check('the keyboard is in the current document\'s pane (real key presses go there)', !!input && document.activeElement === input, document.activeElement?.className)
    await h.nativeType('g1x10')
    await h.waitFor(() => textOf(h, current).split('\n').some((l) => l === 'G1X10' || l.toLowerCase() === 'g1x10'), { timeout: 8000 })
    await h.idle()
    const lines = textOf(h, current).split('\n')
    const typed = lines.length > last - 1 ? lines[last - 1] : undefined
    h.check('g1x10 typed into the pane reads G1X10 in the document (capitals only; the helper adds no blanks)', typed === 'G1X10', { typed, status: message(h) })
    h.check('the rest of the current document is as it was', lines.length > 0 && lines.slice(0, last - 1).join('\n') === CURRENT.slice(0, last - 1).join('\n'), lines.length)
    h.check('the pane shows the same line, and the document is marked as changed', m.getModel().getLineContent(last) === 'G1X10' && ctx.docs.get(current)?.dirty === true, m.getModel().getLineContent(last))
    h.check('the other pane\'s document (the original) is not touched', textOf(h, original) === ORIGINAL_TEXT && ctx.docs.get(original)?.dirty !== true && pane().original.getModel().getValue(1) === ORIGINAL_TEXT)
    // Back to the pair the following steps expect: undo until the typing is gone (a bounded number of steps).
    for (let i = 0; i < 12 && textOf(h, current) !== CURRENT_TEXT; i++) await undoKey(h)
    await h.waitFor(() => textOf(h, current) === CURRENT_TEXT, { timeout: 8000 })
    h.check('Cmd+Z takes the typing back: the current document is as it was, and not marked as changed', textOf(h, current) === CURRENT_TEXT && ctx.docs.get(current)?.dirty !== true, textOf(h, current).split('\n').slice(-3))
    await waitBlocks([5])
  })

  // ============================================================ E. closing
  await guard(h, 'E. closing the comparison', async () => {
    const modelOfCurrent = ctx.editor.model(current)
    await closeCompare(h)
    h.check('the editor is back and shows the current document', !!h.q('editor-host') && h.q('editor-host')?.dataset.docId === current && !h.q('compare-view') && !h.q('aligned-view'))
    await h.waitFor(() => ctx.editor.editorInstance() !== undefined && ctx.editor.hasFocus(), { timeout: 8000 })
    h.check('the keyboard is in the editor again (the editor has the text focus)', ctx.editor.hasFocus() && document.activeElement?.tagName === 'TEXTAREA' && !!h.q('editor-host')?.contains(document.activeElement), { active: document.activeElement?.tagName })
    h.check('no mark and no tint is left on the document\'s text', modelOfCurrent !== undefined && /** @type {any[]} */ (modelOfCurrent.getAllDecorations()).every((d) => d.options.inlineClassName !== WORD && d.options.className !== CHANGED && d.options.className !== ONLY_MODIFIED), /** @type {any[]} */ (modelOfCurrent?.getAllDecorations() ?? []).map((d) => d.options.inlineClassName ?? d.options.className ?? ''))
    h.check('both programs are as they were', textOf(h, original) === ORIGINAL_TEXT && textOf(h, current) === CURRENT_TEXT)
  })
})
