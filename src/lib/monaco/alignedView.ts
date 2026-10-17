// The aligned NC-aware diff in the editor (Phase 4 plan X30, P4.25). Owner: P4.25.
//
// Two ordinary code editors side by side, each showing the program **as written**: the original
// side on the left, the compared document on the right. Nothing in them is a normalized copy, so
// the text can be edited (unless it is locked) and a merge copies the original lines. The
// alignment is `core/compare/aligned.ts`; this module draws it:
//
//  - **Fillers.** A view zone under the last line of a side's run keeps the other side's extra
//    lines level (the missing lines are as high as the lines they face). Both panes then have the
//    same height and scroll as one: `onDidScrollChange` of either sets the other's position.
//  - **Blocks.** A whole-line tint on the lines of each changed block (`gedit-aligned-changed` where
//    both sides have lines, `-only-original` / `-only-modified` where the other has none), and
//    in the narrow column between the line numbers and the text an arrow on the block's first line
//    (`gedit-aligned-arrow-right` on the left pane copies the block to the document,
//    `-left` on the right pane copies it to the original). A side with no line in the block has
//    the arrow inside its filler instead. Shift+click copies one row.
//  - **Words.** `gedit-word-changed` (`wordMarks.css`, P4.24) on each whole word that differs, in
//    slices of `MARK_SLICE_MS` so a program with 100,000 changed lines never blocks typing; a
//    run ends when the text changes again.
//
// The view is a `DiffHandle` (the shape `diff.ts` gives the toolbar, the commands and the merge),
// so the compare commands, the next/previous buttons and `copyChange` reach it through
// `currentDiff()` as they reach the raw view. Its `lineChanges()` are the changed blocks, and it
// adds `planCopy` (a one-line copy follows the rows, not the position in the block), the word
// merge and the alignment itself.
//
// Freshness: any change of either text makes `isCurrent()` false until the alignment has been
// recomputed (`RECOMPUTE_DELAY_MS` after the last change), and a merge planned from a stale
// alignment is refused by the caller (`compare.copyBusy`), as in the raw view. The zones follow
// an edit meanwhile (Monaco moves them with their line).
//
// The editors are created with the options every editor of gEdit shares (`SHARED_EDITOR_OPTIONS`,
// see `diff.ts` rule 1) and `wordWrap: 'off'`: a wrapped line is taller on one side and would
// break the alignment. `create()` hands its options to the one standalone configuration service,
// so nothing else that is not already set the same way is passed; the main editor is rebuilt
// with the user's settings when the comparison closes. No `theme` (rule 2).
//
// What the user's settings add (`alignedPaneOptions`): font, whitespace, rulers, line highlight,
// line numbers and hover follow the settings, live, and the suggestions are off (no pop-up list
// while typing; Ctrl+Space still works). They are applied through each instance's own
// `updateOptions` right after `create()` (the same synchronous block, so nothing is painted with
// Monaco's defaults), never in the construction options. Both ways write into the one shared
// configuration service; that is harmless here because the main editor does not exist while the
// comparison is open and is rebuilt from `EditorService`'s own replay when it closes. Layout keys
// (word wrap, minimap, sticky scroll) are not taken.
//
// Typing helpers (forced upper case, no accidental line join: `contrib/typing.ts`): `monaco/` does
// not import `contrib/`, so the request carries `onPane`. It is called for each pane that may be
// typed into (a document that is not locked) with the pane's editor and the id of the document
// it shows, and what it returns is called when the pane is locked, when its model changes and
// when the view closes. A text original has no document and gets no call.
//
// IMPORTANT: Monaco is reached through `$lib/monaco/setup` (dynamic import); a static import of
// `core` would put Monaco into the initial bundle.

import type * as MonacoApi from 'monaco-editor/esm/vs/editor/editor.api.js';
import { getMonaco } from '$lib/monaco/setup';
import { editor as editorService } from '$lib/monaco/editorService';
import { SHARED_EDITOR_OPTIONS } from '$lib/monaco/instanceOptions';
import { editorOptionsFor } from '$lib/monaco/editorOptions';
import { settings as appSettings } from '$lib/stores/settings';
import type { Settings } from '$lib/core/settings/schema';
import {
  alignedMarkPairs,
  blockAt,
  copyRowPlan,
  fillers,
  lineChangeOf,
  neighbourBlock,
  type AlignedBlock,
  type AlignedDiff,
  type AlignedSide,
  type LineMergePlan,
  type PairReader,
} from '$lib/core/compare/aligned';
import { docs } from '$lib/stores/documents';
import { t } from '$lib/i18n';
import type { Disposable, DocId } from '$lib/app/types';
import type { EditableModel } from '$lib/monaco/applyLines';
import { WORD_CHANGED_CLASS, type DiffCursor, type DiffHandle, type DiffLineChange, type DiffSide, type DiffSides } from './diff';
import './wordMarks.css';
import './alignedView.css';

/** Wait after the last change of either text before the alignment is recomputed. */
export const RECOMPUTE_DELAY_MS = 150;

/** The longest a slice of word-mark work runs before it yields to the browser. */
const MARK_SLICE_MS = 12;

/** The classes the view draws with (`alignedView.css`). */
export const ALIGNED_CLASSES = {
  changed: 'gedit-aligned-changed',
  onlyOriginal: 'gedit-aligned-only-original',
  onlyModified: 'gedit-aligned-only-modified',
  arrowRight: 'gedit-aligned-arrow-right',
  arrowLeft: 'gedit-aligned-arrow-left',
  filler: 'gedit-aligned-filler',
  fillerArrow: 'gedit-aligned-filler-arrow',
} as const;

/**
 * The keys of the user's editor settings (`editorOptionsFor`) the panes follow. An allow-list:
 * `wordWrap`, `minimap` and `stickyScroll` are layout and stay as the view needs them, and the
 * completion keys are replaced by `NO_SUGGESTIONS`.
 */
const PANE_SETTING_KEYS = [
  'fontFamily',
  'fontSize',
  'renderWhitespace',
  'lineNumbers',
  'renderLineHighlight',
  'rulers',
  'hover',
  'dragAndDrop',
  'emptySelectionClipboard',
] as const;

/** No pop-up suggestions while typing in a pane (the manual Ctrl+Space stays). */
export const NO_SUGGESTIONS = { quickSuggestions: false, suggestOnTriggerCharacters: false } as const;

/** The options a pane takes from the settings `s` (applied with `updateOptions`, see the header). */
export function alignedPaneOptions(s: Settings): Record<string, unknown> {
  const all = editorOptionsFor(s);
  const out: Record<string, unknown> = {};
  for (const key of PANE_SETTING_KEYS) if (key in all) out[key] = all[key];
  return { ...out, ...NO_SUGGESTIONS };
}

/**
 * The size of the copy arrow, in pixels from the left edge of the line-decorations strip and
 * from the top of the line, with a little room round the triangle (`alignedView.css` draws it:
 * 7 px wide, 10 px high, 5 px down, the left-pointing one 2 px in). A click in the strip outside
 * this box does not copy.
 */
export const ARROW_BOX = { left: 0, right: 12, top: 3, bottom: 17 } as const;

/** The gap, in px, between the scrollbar and the arrow in an original-side filler. */
const FILLER_ARROW_INSET = 6;
/** The width of the filler arrow's triangle (its left border in `alignedView.css`). */
const FILLER_ARROW_WIDTH = 7;

/** Whether a click at (`x`, `y`) in the strip hits the arrow; a null `y` (unknown) is judged by `x` alone. */
export function arrowHit(x: number, y: number | null): boolean {
  if (!(x >= ARROW_BOX.left && x < ARROW_BOX.right)) return false;
  return y === null || (y >= ARROW_BOX.top && y < ARROW_BOX.bottom);
}

/** The alignment of the two texts as they are now, with what reads its words. */
export interface AlignedResult {
  diff: AlignedDiff;
  reader: PairReader;
}

/** Which way a copy goes; the names of `CompareService.copyChange`. */
export type AlignedDirection = 'toModified' | 'toOriginal';

/** What the component asks for. */
export interface AlignedRequest {
  container: HTMLElement;
  /** The compared document: its lock decides whether the right pane may be edited. */
  modifiedDocId: DocId;
  /** Document sides show the document's live model; a text side is a read-only model of its own. */
  sides: DiffSides;
  /**
   * Aligns the texts as they are. `reuse`: only the options changed, the texts did not (the
   * caller may use the normalization it already has). Null when there is nothing to align.
   */
  align(o: { reuse: boolean }): AlignedResult | null;
  /** An arrow in a pane was clicked: the caller copies (and says why not, if it cannot). */
  copy(direction: AlignedDirection, o: { lineOnly: boolean }): void;
  /** Hooks the typing helpers into an editable pane; the returned function undoes it. */
  onPane?(pane: AlignedPane): Disposable | void;
}

/** One pane that may be typed into, as `AlignedRequest.onPane` gets it. */
export interface AlignedPane {
  side: AlignedSide;
  editor: MonacoApi.editor.IStandaloneCodeEditor;
  /** The document the pane shows; it follows that document's dialect and settings. */
  docId: DocId;
}

/** The pane's cursor with its column, for the word merge. */
export interface AlignedCursor extends DiffCursor {
  column: number;
}

/** A mounted aligned view: a `DiffHandle` plus what only this view knows. */
export interface AlignedHandle extends DiffHandle {
  readonly aligned: true;
  /** The alignment on screen, or null before the first one. */
  result(): AlignedResult | null;
  /** The cursor with its column. */
  cursorAt(): AlignedCursor | null;
  /** The plan for copying one row at `cursor` in `direction` (the rows decide the pairing, not the position in the block). */
  planCopy(change: DiffLineChange, direction: AlignedDirection, cursor: DiffCursor): LineMergePlan | null;
  /** The options changed (or the text did, behind the view's back): align again now. */
  recompute(o?: { reuse?: boolean }): void;
  /** Puts the keyboard in one pane (after a merge: the target, so that undo reaches it). */
  focusSide(side: AlignedSide): void;
}

/** True for a handle the aligned view made. */
export function isAlignedHandle(handle: DiffHandle | null | undefined): handle is AlignedHandle {
  return (handle as AlignedHandle | null | undefined)?.aligned === true;
}

// ---------------------------------------------------------------------------
// The scratch model
// ---------------------------------------------------------------------------

/**
 * The model behind an original side that is a file or the saved version: one, created on
 * first use and **never disposed**, like the scratch models of `diff.ts` (Monaco's editor
 * worker may still be asked about a model that has just been disposed, and a text that
 * outlives its comparison is blanked instead). Only the view that filled it blanks it.
 */
let scratch: MonacoApi.editor.ITextModel | undefined;
let scratchOwner: object | undefined;

function scratchModel(monaco: typeof MonacoApi, owner: object, text: string, languageId: string): MonacoApi.editor.ITextModel {
  if (!scratch || scratch.isDisposed()) {
    scratch = monaco.editor.createModel(text, languageId);
  } else {
    if (scratch.getLanguageId() !== languageId) monaco.editor.setModelLanguage(scratch, languageId);
    scratch.setValue(text);
  }
  scratchOwner = owner;
  return scratch;
}

function releaseScratch(owner: object): void {
  if (scratchOwner !== owner) return;
  scratchOwner = undefined;
  if (scratch && !scratch.isDisposed()) scratch.setValue('');
}

/** The models the aligned view runs on (a test counts them). */
export function alignedScratchCount(): number {
  return scratch && !scratch.isDisposed() ? 1 : 0;
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export async function createAlignedView(req: AlignedRequest): Promise<AlignedHandle> {
  const monaco = await getMonaco();

  // -- models ---------------------------------------------------------------

  const modifiedModel = documentModel(req.sides.modified);
  const owner: object = {};
  const originalSource = req.sides.original;
  const originalModel =
    originalSource.kind === 'text'
      ? scratchModel(monaco, owner, originalSource.text, originalSource.languageId)
      : documentModel(originalSource);

  function documentModel(source: DiffSides['modified']): MonacoApi.editor.ITextModel {
    if (source.kind !== 'document') throw new Error('compare: the compared document is a document');
    const model = editorService.model(source.docId);
    if (!model) throw new Error(`compare: document "${source.docId}" has no model`);
    return model;
  }

  // -- the two editors ------------------------------------------------------

  const root = req.container.ownerDocument.createElement('div');
  root.className = 'gedit-aligned';
  root.dataset.testid = 'aligned-view';
  const panes: Record<AlignedSide, HTMLElement> = {
    original: req.container.ownerDocument.createElement('div'),
    modified: req.container.ownerDocument.createElement('div'),
  };
  for (const side of ['original', 'modified'] as const) {
    panes[side].className = 'gedit-aligned-pane';
    panes[side].dataset.testid = `aligned-pane-${side}`;
    root.appendChild(panes[side]);
  }
  req.container.appendChild(root);

  const lockedNow = (side: AlignedSide): boolean => {
    if (side === 'modified') return docs.get(req.modifiedDocId)?.readOnly === true;
    return originalSource.kind === 'text' || docs.get(originalSource.docId)?.readOnly === true;
  };
  const applied: Record<AlignedSide, boolean> = { original: lockedNow('original'), modified: lockedNow('modified') };

  const create = (side: AlignedSide, model: MonacoApi.editor.ITextModel): MonacoApi.editor.IStandaloneCodeEditor =>
    monaco.editor.create(panes[side], {
      model,
      automaticLayout: true,
      readOnly: applied[side],
      readOnlyMessage: { value: t('readOnly.editorMessage') },
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: 'off',
      ...SHARED_EDITOR_OPTIONS,
    });
  const editors: Record<AlignedSide, MonacoApi.editor.IStandaloneCodeEditor> = {
    original: create('original', originalModel),
    modified: create('modified', modifiedModel),
  };

  // The user's settings, now and when they change (the subscription calls at once).
  const applyPaneOptions = (s: Settings): void => {
    if (disposed) return;
    const options = alignedPaneOptions(s);
    editors.original.updateOptions(options);
    editors.modified.updateOptions(options);
  };
  let disposed = false;
  const stopSettings = appSettings.values.subscribe(applyPaneOptions);
  /** The pane the user was last in: a toolbar button takes the focus away from both. */
  let lastSide: AlignedSide = 'modified';
  let current: AlignedResult | null = null;
  /** False from any change of either text until the alignment has been redone. */
  let fresh = false;
  let recomputeTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingNext: Disposable | null = null;
  const updated = new Set<() => void>();

  // The typing hooks: only an editable pane that still shows its document has one.
  const paneDocId = (side: AlignedSide): DocId | null =>
    side === 'modified' ? req.modifiedDocId : originalSource.kind === 'document' ? originalSource.docId : null;
  const paneHooks: Record<AlignedSide, Disposable | null> = { original: null, modified: null };
  const modelMoved: Record<AlignedSide, boolean> = { original: false, modified: false };
  const syncPaneHook = (side: AlignedSide): void => {
    const docId = paneDocId(side);
    const wanted = req.onPane !== undefined && !disposed && !applied[side] && !modelMoved[side] && docId !== null;
    if (wanted && paneHooks[side] === null && docId !== null) {
      paneHooks[side] = req.onPane?.({ side, editor: editors[side], docId }) ?? (() => {});
    } else if (!wanted && paneHooks[side] !== null) {
      paneHooks[side]?.();
      paneHooks[side] = null;
    }
  };
  const trackModel = (['original', 'modified'] as const).map((side) =>
    editors[side].onDidChangeModel(() => {
      modelMoved[side] = true;
      syncPaneHook(side);
    }),
  );
  syncPaneHook('original');
  syncPaneHook('modified');

  const applyLock = (): void => {
    if (disposed) return;
    for (const side of ['original', 'modified'] as const) {
      const locked = lockedNow(side);
      if (locked === applied[side]) continue;
      applied[side] = locked;
      editors[side].updateOptions({ readOnly: locked });
      syncPaneHook(side);
    }
  };
  const stopFollowingLock = docs.list.subscribe(applyLock);

  // -- scroll as one --------------------------------------------------------

  let syncing = false;
  const scrollWith = (from: AlignedSide, to: AlignedSide) =>
    editors[from].onDidScrollChange((event) => {
      if (syncing || !(event.scrollTopChanged || event.scrollLeftChanged)) return;
      syncing = true;
      try {
        editors[to].setScrollPosition({
          scrollTop: editors[from].getScrollTop(),
          scrollLeft: editors[from].getScrollLeft(),
        });
      } finally {
        syncing = false;
      }
    });
  const scrollListeners = [scrollWith('original', 'modified'), scrollWith('modified', 'original')];

  // -- what is drawn --------------------------------------------------------

  const zoneIds: Record<AlignedSide, string[]> = { original: [], modified: [] };
  const blockMarks = {
    original: editors.original.createDecorationsCollection(),
    modified: editors.modified.createDecorationsCollection(),
  };
  let wordMarks: Record<AlignedSide, MonacoApi.editor.IEditorDecorationsCollection> | null = null;
  let marksRun = 0;
  let marksTimer: ReturnType<typeof setTimeout> | undefined;

  const stopMarks = (): void => {
    marksRun++;
    clearTimeout(marksTimer);
    if (wordMarks) {
      wordMarks.original.clear();
      wordMarks.modified.clear();
      wordMarks = null;
    }
  };

  /** Where an arrow on `side` (or in its filler) sends the block: from this pane to the other. */
  const directionOf = (side: AlignedSide): AlignedDirection => (side === 'original' ? 'toModified' : 'toOriginal');

  /** The name of the arrow of `side`: the tooltip of the margin arrow and the label of the filler button. */
  const arrowTitle = (side: AlignedSide): string =>
    side === 'original' ? t('compare.alignedArrowToModified') : t('compare.alignedArrowToOriginal');

  /** Puts the cursor in `block` (on the side that has lines there) and copies. */
  const copyBlock = (block: AlignedBlock, side: AlignedSide, lineOnly: boolean): void => {
    // The copy works on the change at the cursor: put it where the block is.
    const hasLines = side === 'original' ? block.originalCount > 0 : block.modifiedCount > 0;
    const holder: AlignedSide = hasLines ? side : side === 'original' ? 'modified' : 'original';
    const line = holder === 'original' ? block.originalStart : block.modifiedStart;
    placeCursor(holder, line);
    // The direction is the pane the arrow is in: its version goes to the other pane.
    req.copy(directionOf(side), { lineOnly });
  };

  function placeCursor(side: AlignedSide, line: number): void {
    const model = editors[side].getModel();
    const count = model?.getLineCount() ?? 1;
    editors[side].setPosition({ lineNumber: Math.min(Math.max(line, 1), count), column: 1 });
    lastSide = side;
    // The copy reads the pane with the text focus: it must be this one.
    editors[side].focus();
  }

  /**
   * How far from the pane's right edge the arrow in an original-side filler sits: the filler
   * spans the whole editor width, the vertical scrollbar and the overview ruler included, and
   * both draw over it, so a click on an arrow at a plain 6 px would land on the ruler.
   */
  const arrowInset = (side: AlignedSide): number => {
    const layout = editors[side].getLayoutInfo();
    const ruler = layout.overviewRuler;
    return Math.max(layout.verticalScrollbarWidth, ruler ? ruler.width + ruler.right : 0) + FILLER_ARROW_INSET;
  };
  /** The arrows of the fillers drawn now (the original side's are kept clear of the scrollbar). */
  let fillerArrows: { arrow: HTMLElement; side: AlignedSide; block: AlignedBlock }[] = [];
  // Monaco makes a view zone as wide as the scroll width (`Math.max(scrollWidth, contentWidth)`),
  // which a long line or a wide editor puts far past the pane's visible right edge: an arrow
  // placed from the zone's own right edge would sit outside the pane, hidden and under the other
  // pane. It is placed from the visible right edge instead (the zone scrolls with the text, so the
  // horizontal scroll is added) and follows the scroll and the layout.
  const placeFillerArrow = (arrow: HTMLElement, side: AlignedSide): void => {
    if (side !== 'original') return;
    const layout = editors[side].getLayoutInfo();
    const visible = layout.width - layout.contentLeft;
    arrow.style.right = 'auto';
    arrow.style.left = `${Math.max(0, editors[side].getScrollLeft() + visible - arrowInset(side) - FILLER_ARROW_WIDTH)}px`;
  };
  const placeFillerArrows = (): void => {
    for (const { arrow, side } of fillerArrows) placeFillerArrow(arrow, side);
  };

  const fillerNode = (side: AlignedSide, block: AlignedBlock): HTMLElement => {
    const node = req.container.ownerDocument.createElement('div');
    node.className = ALIGNED_CLASSES.filler;
    node.dataset.testid = 'aligned-filler';
    node.dataset.side = side;
    // A side with no line in a changed block has no line to carry the arrow: it sits in the filler.
    const empty = side === 'original' ? block.originalCount === 0 : block.modifiedCount === 0;
    if (empty && block.kind === 'changed') {
      const arrow = req.container.ownerDocument.createElement('span');
      arrow.className = ALIGNED_CLASSES.fillerArrow;
      arrow.dataset.testid = 'aligned-arrow';
      arrow.dataset.side = side;
      const label = arrowTitle(side);
      arrow.title = label;
      // A button for the keyboard and for a screen reader: Tab reaches it, Enter or Space copies.
      arrow.tabIndex = 0;
      arrow.setAttribute('role', 'button');
      arrow.setAttribute('aria-label', label);
      arrow.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        copyBlock(block, side, (event as MouseEvent).shiftKey === true);
      });
      arrow.addEventListener('keydown', (event) => {
        const key = event as KeyboardEvent;
        if (key.key !== 'Enter' && key.key !== ' ') return;
        key.preventDefault();
        key.stopPropagation();
        copyBlock(block, side, key.shiftKey === true);
      });
      node.appendChild(arrow);
      fillerArrows.push({ arrow, side, block });
      placeFillerArrow(arrow, side);
    }
    return node;
  };

  const drawBlocks = (result: AlignedResult): void => {
    const { diff } = result;
    const decorations: Record<AlignedSide, MonacoApi.editor.IModelDeltaDecoration[]> = { original: [], modified: [] };
    for (const block of diff.changed) {
      for (const side of ['original', 'modified'] as const) {
        const start = side === 'original' ? block.originalStart : block.modifiedStart;
        const count = side === 'original' ? block.originalCount : block.modifiedCount;
        if (count === 0) continue;
        const other = side === 'original' ? block.modifiedCount : block.originalCount;
        const className =
          other > 0 ? ALIGNED_CLASSES.changed : side === 'original' ? ALIGNED_CLASSES.onlyOriginal : ALIGNED_CLASSES.onlyModified;
        decorations[side].push({
          range: new monaco.Range(start, 1, start + count - 1, 1),
          options: { isWholeLine: true, className },
        });
        decorations[side].push({
          range: new monaco.Range(start, 1, start, 1),
          options: {
            linesDecorationsClassName: side === 'original' ? ALIGNED_CLASSES.arrowRight : ALIGNED_CLASSES.arrowLeft,
            // The title of the arrow (it is also what hovering the strip says).
            linesDecorationsTooltip: arrowTitle(side),
          },
        });
      }
    }
    blockMarks.original.set(decorations.original);
    blockMarks.modified.set(decorations.modified);
  };

  const drawFillers = (result: AlignedResult): void => {
    const { diff } = result;
    const list = fillers(diff);
    fillerArrows = [];
    for (const side of ['original', 'modified'] as const) {
      const lineCount = editors[side].getModel()?.getLineCount() ?? 0;
      editors[side].changeViewZones((accessor) => {
        for (const id of zoneIds[side]) accessor.removeZone(id);
        zoneIds[side] = [];
        for (const filler of list) {
          if (filler.side !== side) continue;
          zoneIds[side].push(
            accessor.addZone({
              afterLineNumber: Math.min(filler.afterLine, lineCount),
              heightInLines: filler.lines,
              domNode: fillerNode(side, diff.blocks[filler.block]),
              suppressMouseDown: true,
            }),
          );
        }
      });
    }
    // New zones above the viewport move the text: put both panes back on one position.
    syncing = true;
    try {
      editors.modified.setScrollTop(editors.original.getScrollTop());
    } finally {
      syncing = false;
    }
  };

  const startMarks = (result: AlignedResult): void => {
    stopMarks();
    const collections = {
      original: editors.original.createDecorationsCollection(),
      modified: editors.modified.createDecorationsCollection(),
    };
    wordMarks = collections;
    const run = marksRun;
    const pairs = alignedMarkPairs(result.diff, result.reader);
    const slice = (): void => {
      if (run !== marksRun || disposed || !fresh) return;
      const forOriginal: MonacoApi.editor.IModelDeltaDecoration[] = [];
      const forModified: MonacoApi.editor.IModelDeltaDecoration[] = [];
      const until = performance.now() + MARK_SLICE_MS;
      let finished = false;
      do {
        const next = pairs.next();
        if (next.done) {
          finished = true;
          break;
        }
        const { originalLine, modifiedLine, marks } = next.value;
        for (const span of marks.original) {
          forOriginal.push({
            range: new monaco.Range(originalLine, span.start + 1, originalLine, span.end + 1),
            options: { inlineClassName: WORD_CHANGED_CLASS },
          });
        }
        for (const span of marks.modified) {
          forModified.push({
            range: new monaco.Range(modifiedLine, span.start + 1, modifiedLine, span.end + 1),
            options: { inlineClassName: WORD_CHANGED_CLASS },
          });
        }
      } while (performance.now() < until);
      if (forOriginal.length > 0) collections.original.append(forOriginal);
      if (forModified.length > 0) collections.modified.append(forModified);
      if (!finished) marksTimer = setTimeout(slice, 0);
    };
    slice();
  };

  const recompute = (o: { reuse?: boolean } = {}): void => {
    clearTimeout(recomputeTimer);
    if (disposed) return;
    stopMarks();
    const result = req.align({ reuse: o.reuse === true });
    current = result;
    fresh = result !== null;
    if (result) {
      drawBlocks(result);
      drawFillers(result);
      startMarks(result);
    } else {
      blockMarks.original.clear();
      blockMarks.modified.clear();
    }
    for (const listener of [...updated]) listener();
  };

  const markStale = (): void => {
    if (disposed) return;
    fresh = false;
    stopMarks();
    clearTimeout(recomputeTimer);
    recomputeTimer = setTimeout(() => recompute(), RECOMPUTE_DELAY_MS);
  };

  // -- the mouse ------------------------------------------------------------

  /** The pixel position of a click in the line-decorations strip, from the line's top; null parts are unknown. */
  const stripPoint = (
    side: AlignedSide,
    target: MonacoApi.editor.IMouseTarget,
    browserEvent: MouseEvent | undefined,
    line: number,
  ): { x: number; y: number | null } | null => {
    const detail = (target as { detail?: Partial<MonacoApi.editor.IMouseTargetMarginData> }).detail;
    if (detail?.offsetX === undefined) return null;
    // Monaco's own arithmetic (`mouseTarget.js`): the strip starts after the glyph margin and the line numbers.
    const x = detail.offsetX - ((detail.glyphMarginLeft ?? 0) + (detail.glyphMarginWidth ?? 0) + (detail.lineNumbersWidth ?? 0));
    const editor = editors[side];
    const box = editor.getDomNode()?.getBoundingClientRect();
    const y =
      browserEvent && box ? browserEvent.clientY - box.top - (editor.getTopForLineNumber(line) - editor.getScrollTop()) : null;
    return { x, y };
  };

  const mouseListeners = (['original', 'modified'] as const).map((side) =>
    editors[side].onMouseDown((event) => {
      if (disposed) return;
      lastSide = side;
      // A filler's arrow: Monaco draws its text layer over the view zones, so in the app the
      // arrow itself never gets the click (a `z-index` inside a zone does not lift it above the
      // text). Monaco reports the click as one on the view zone; it copies when it lands on the arrow.
      if (event.target.type === monaco.editor.MouseTargetType.CONTENT_VIEW_ZONE) {
        const browserEvent = event.event.browserEvent;
        const hit = fillerArrows.find(({ arrow, side: s }) => {
          if (s !== side) return false;
          const r = arrow.getBoundingClientRect();
          // A little slack round the 7 x 10 px triangle, as the margin arrow's box has.
          return (
            r.width > 0 &&
            browserEvent.clientX >= r.left - 3 &&
            browserEvent.clientX <= r.right + 3 &&
            browserEvent.clientY >= r.top - 3 &&
            browserEvent.clientY <= r.bottom + 3
          );
        });
        if (!hit) return;
        event.event.preventDefault();
        copyBlock(hit.block, side, event.event.shiftKey);
        return;
      }
      if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS) return;
      const line = event.target.position?.lineNumber;
      if (line === undefined || current === null || !fresh) return;
      const block = blockAt(current.diff.changed, side, line);
      // Only the first line of a block carries the arrow.
      if (!block || (side === 'original' ? block.originalStart : block.modifiedStart) !== line) return;
      // ... and only the arrow itself copies, not the rest of the strip (CODE-11).
      const point = stripPoint(side, event.target, event.event.browserEvent, line);
      if (point === null || !arrowHit(point.x, point.y)) return;
      copyBlock(block, side, event.event.shiftKey);
    }),
  );

  // The same copy for the keyboard and the context menu: the block at the cursor goes to the
  // other pane (the app says why not when the cursor is in no block or the text is out of date).
  const copyActions = (['original', 'modified'] as const).map((side) =>
    editors[side].addAction({
      id: 'gedit.aligned.copyBlock',
      label: t(side === 'original' ? 'compare.copyToModified' : 'compare.copyToOriginal'),
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1,
      run: () => {
        if (!disposed) req.copy(directionOf(side), { lineOnly: false });
      },
    }),
  );

  const trackFocus = (['original', 'modified'] as const).map((side) =>
    editors[side].onDidFocusEditorText(() => {
      lastSide = side;
    }),
  );
  // The scrollbar can change width (a scrollbar setting, a pane resize): the arrows follow.
  const trackLayout = (['original', 'modified'] as const).flatMap((side) => [
    editors[side].onDidLayoutChange(placeFillerArrows),
    editors[side].onDidScrollChange((event) => {
      if (event.scrollLeftChanged) placeFillerArrows();
    }),
  ]);
  const trackContent = (['original', 'modified'] as const).flatMap((side) => [
    editors[side].onDidChangeModelContent(markStale),
    editors[side].onDidChangeModel(markStale),
  ]);

  // The caller has just built the normalization this alignment runs on.
  recompute({ reuse: true });

  // -- the handle -----------------------------------------------------------

  const sideOfCursor = (): AlignedSide =>
    editors.original.hasTextFocus() ? 'original' : editors.modified.hasTextFocus() ? 'modified' : lastSide;

  const reveal = (side: AlignedSide, line: number): void => {
    if (disposed) return;
    const editor = editors[side];
    const count = editor.getModel()?.getLineCount() ?? 1;
    const lineNumber = Math.min(Math.max(Math.floor(line), 1), count);
    editor.setPosition({ lineNumber, column: 1 });
    editor.revealLineInCenterIfOutsideViewport(lineNumber);
  };

  const handle: AlignedHandle = {
    aligned: true,
    goToDiff(direction): void {
      if (disposed || current === null) return;
      const side = sideOfCursor();
      const position = editors[side].getPosition();
      const block = neighbourBlock(current.diff, side, position?.lineNumber ?? 0, direction);
      if (!block) return;
      // An empty side's start is the line the block would begin at, which may be one past the end.
      reveal('modified', block.modifiedStart);
      reveal('original', block.originalStart);
      lastSide = 'modified';
    },
    setInline(): void {
      // There is no inline form of the aligned view.
    },
    setIgnoreTrimWhitespace(): void {
      // The ignore options of review mode decide what is equal.
    },
    focus(): void {
      if (!disposed) editors.modified.focus();
    },
    show(): void {
      // Both panes always show the documents themselves; the toggles go through `recompute`.
    },
    cursor(): DiffCursor | null {
      if (disposed) return null;
      const side = sideOfCursor();
      const position = editors[side].getPosition();
      return position ? { side, line: position.lineNumber } : null;
    },
    cursorAt(): AlignedCursor | null {
      if (disposed) return null;
      const side = sideOfCursor();
      const position = editors[side].getPosition();
      return position ? { side, line: position.lineNumber, column: position.column } : null;
    },
    lineChanges(): DiffLineChange[] | null {
      if (disposed || current === null) return null;
      return current.diff.changed.map(lineChangeOf);
    },
    isCurrent(): boolean {
      return !disposed && fresh && current !== null;
    },
    model(side: DiffSide): EditableModel | null {
      if (disposed) return null;
      return editors[side].getModel() as EditableModel | null;
    },
    reveal(side: DiffSide, line: number): void {
      reveal(side, line);
    },
    nextWhenUpdated(): void {
      if (disposed) return;
      pendingNext?.();
      const once = (): void => {
        updated.delete(once);
        pendingNext = null;
        if (!disposed) handle.goToDiff('next');
      };
      updated.add(once);
      pendingNext = () => updated.delete(once);
    },
    result: () => current,
    planCopy(change, direction, cursor): LineMergePlan | null {
      if (current === null) return null;
      return copyRowPlan(current.diff, change, direction === 'toModified' ? 'original' : 'modified', cursor);
    },
    recompute(o): void {
      recompute(o);
    },
    focusSide(side): void {
      if (disposed) return;
      lastSide = side;
      editors[side].focus();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      clearTimeout(recomputeTimer);
      pendingNext?.();
      updated.clear();
      stopMarks();
      stopFollowingLock();
      stopSettings();
      syncPaneHook('original');
      syncPaneHook('modified');
      for (const listener of [...trackModel, ...copyActions, ...scrollListeners, ...mouseListeners, ...trackFocus, ...trackLayout, ...trackContent]) listener.dispose();
      // The editors go before the models they show; the documents' models outlive this view.
      editors.original.dispose();
      editors.modified.dispose();
      releaseScratch(owner);
      root.remove();
    },
  };
  return handle;
}
