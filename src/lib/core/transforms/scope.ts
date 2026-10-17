// What a transform runs on (plan §5 WP4.1). Owner: **WP4.1**.
//
// The rule is one sentence: a selection is extended to whole lines, and without one the
// scope is the whole document. It lives in `core/` and takes plain numbers, so it is
// testable without Monaco; `app/transforms.ts` feeds it `editor.selectionLines()` and
// `editor.getLineCount()`.
//
// Whole lines, always. A transform rewrites blocks, and half a block is not a block: a
// selection that starts inside `N100 G0 X10` has to take the `N100` with it or the
// renumber would write a second block number into the middle of the line.
//
// `EditorService.selectionLines()` has already done one part of that job — a selection
// that ends in column 1 of the next line reports the line above as its end, so dragging
// past the last character does not drag an extra empty block in. Everything else happens
// here: ordering, clamping and "an empty selection is not a selection".

/** A 1-based, inclusive line range, plus where it came from. */
export interface TransformScope {
  startLine: number;
  endLine: number;
  /** True when the user had a selection; the status summary says "in the selection". */
  fromSelection: boolean;
  /**
   * True when the selection ran over the lines of another channel (it was made in a channel pane
   * and is not one run of document lines, Phase 4 plan §6.7 rule 3). Acting on the document lines
   * in between would change a channel the user cannot see in that pane, so a command that acts on
   * the selected lines refuses (`SELECTION_CROSSES`).
   */
  crossesJunction?: true;
}

/** The refusal of every command that acts on the selected lines when `TransformScope.crossesJunction` is set. */
export const SELECTION_CROSSES: Readonly<{ key: string }> = Object.freeze({ key: 'channelPanes.selectionCrosses' });

/** The selection as `EditorService.selectionLines()` reports it. */
export interface ScopeSelection {
  startLine: number;
  endLine: number;
  /** A caret with nothing selected. */
  empty: boolean;
  /** The selection is not one run of document lines (a channel pane's selection across a junction). */
  crossesJunction?: boolean;
}

/** `value` as a line number inside `1..lineCount`; anything unusable becomes 1. */
function clampLine(value: number, lineCount: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.floor(value), 1), lineCount);
}

/**
 * The scope of a run.
 *
 * `lineCount` is the document's line count (at least 1). `selection` is null when there
 * is no editor or no cursor. An empty selection is not a selection: the whole document
 * is the scope.
 *
 * The result is always clamped to `1..lineCount`, so a stale selection cannot make a
 * transform read past the end of the model.
 */
export function transformScope(lineCount: number, selection: ScopeSelection | null): TransformScope {
  const lines = Number.isFinite(lineCount) ? Math.max(Math.floor(lineCount), 1) : 1;
  if (!selection || selection.empty) return { startLine: 1, endLine: lines, fromSelection: false };

  // A backwards selection (dragged upwards) reports its anchor first; the scope is a
  // range, not a direction.
  const a = clampLine(selection.startLine, lines);
  const b = clampLine(selection.endLine, lines);
  return {
    startLine: Math.min(a, b),
    endLine: Math.max(a, b),
    fromSelection: true,
    ...(selection.crossesJunction === true ? { crossesJunction: true as const } : {}),
  };
}
