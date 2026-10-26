// Typing options: upper case while typing and no accidental join of two blocks (plan AD-30,
// §6 M13 WP13.4, §7.13). One feature per file (plan AD-3); see ./README.md.
//
// The decisions are `core/nc/typing.ts`; this file reads the keyboard and the editor.
//
//   - A plain lower-case letter key becomes `editor.trigger('keyboard', 'type', { text })`
//     with the capital, so auto-closing, the suggest widget and the undo grouping stay the
//     editor's: the capital is one undo step with the keystroke, exactly like a typed letter.
//     Paste, IME composition, modifier chords and the harness's `insertText` are not keys
//     and are not touched. Cursors that disagree (one in a comment, another in code) get
//     their own text through one `executeEdits`.
//   - Backspace in column 1 and Delete at the end of a line, with an empty selection, that
//     would join two lines which both hold text are swallowed and the status bar says why;
//     removing an empty or blank line still works.
//   - Both are for NC programs only (M13 review fix CODE-3): a document whose file is a `.json`
//     or `.py` one — a profile, a code file, the settings, a script — is left to the editor, so
//     `"extends"` stays `"extends"`. The switch says so instead of doing nothing.
//   - A key press reads the least it can (CODE-7): the length of a line before its text, and
//     the neighbouring lines only at the edge where a join could happen, so a program saved as
//     one 10 MB line costs nothing per key. (The lines below an automatic number's Enter are the
//     exception: the walk reads their text first and judges the length from it, one lookup per line
//     instead of three; a line over `MAX_TYPING_LINE` still reads as empty.)
//
// The aligned compare view has two editors of its own; `hookTyping` hooks one of them for the
// document it shows (the view's component calls it, `monaco/` does not import this file).
//
// The compare overlay recreates the editor instance. `ensureHook` hooks the instance the
// service has at activation and again on every `editor.onDidAttach` (the service fires it
// when an `attach()` has built and bound a new instance), so a new instance is hooked before
// anyone can type into it; an instance it already hooked costs one comparison.
//
// `edit.toggleForceUppercase` is a session switch: it overrides the profile's flag for every
// document until the app closes and is never saved (§7.11). `preventLineJoin` has no switch.
//
// P4c (plan §6.5 rules 1–3, P4.12): auto-space and the automatic block number.
//
//   - A letter key with `editing.autoSpace` on asks `core/nc/autoSpace.ts` whether a space goes in
//     front of it (`G1X` → `G1 X`); the space and the letter (the capital, with upper case on) are
//     one `type` command, so one undo step with the keystroke; cursors that disagree get their own
//     text through one `executeEdits`, as with upper case.
//   - Plain Enter with `editing.autoNumber` on (no Ctrl, Alt, Cmd or Shift, no IME, one cursor, an
//     empty selection, and Enter not owned by the suggestion list: the editor's `acceptSuggestionOnEnter`
//     is `'off'`, or the list is not visible) asks `core/nc/autoNumber.ts`. A number is one
//     `executeEdits` between two undo stops: the line break, the base block's indentation, the
//     number, and in consecutive numbering (Klartext) every block below that takes a new number —
//     one undo step. A refusal says why in the status bar and leaves the Enter to the editor; a
//     line the rules do not number is the editor's Enter, silently.
//   - `edit.toggleAutoSpace` and `edit.toggleAutoNumber` are session switches like
//     `edit.toggleForceUppercase`, each on its own.
//   - A channel pane (its model is `inmemory://pane/…`, §6.7) numbers from its own lines; consecutive
//     numbering refuses there (`inPane`).

import CaseUpper from 'lucide-svelte/icons/case-upper';
import ListOrdered from 'lucide-svelte/icons/list-ordered';
import Space from 'lucide-svelte/icons/space';
import { asIcon } from '$lib/app/icons';
import { status } from '$lib/app/status';
import { isBlankLine, wouldJoinBlocks } from '$lib/core/nc/typing';
import type { JoinSelection, KeyInput, TypingSite } from '$lib/core/nc/typing';
import { decideTyping } from '$lib/core/nc/autoSpace';
import { blockBaseLine, decideAutoNumber, type AutoNumberRefusal } from '$lib/core/nc/autoNumber';
import { blockNumberLabel } from '$lib/core/nc/blockNumbering';
import type { CompiledProfile } from '$lib/core/profiles/types';
import { editor } from '$lib/monaco/editorService';
import { getMonaco } from '$lib/monaco/setup';
import { isNcDocumentPath } from '$lib/core/profiles/ncDocument';
import { machines } from '$lib/stores/machines';
import { docs } from '$lib/stores/documents';
import { t } from '$lib/i18n';
import type { Contribution, DocId } from '$lib/app/types';

/** The session switches: `null` follows each profile, a boolean overrides every profile. */
let override: boolean | null = null;
let spaceOverride: boolean | null = null;
let numberOverride: boolean | null = null;

/** Whether `docId` is an NC program (not a `.json` or `.py` file): the typing options act only in one. */
export function isNcDocument(docId: DocId): boolean {
  return isNcDocumentPath(docs.get(docId)?.path);
}

/** Whether typing in `docId` is upper-cased now: the session switch, else the profile's flag. NC programs only. */
export function uppercaseOn(docId: DocId): boolean {
  if (!isNcDocument(docId)) return false;
  return override ?? machines.effective(docId).profile.editing?.forceUppercase === true;
}

/** Whether auto-space acts in `docId` now: the session switch, else the profile's `editing.autoSpace`. NC programs only. */
export function autoSpaceOn(docId: DocId): boolean {
  if (!isNcDocument(docId)) return false;
  return spaceOverride ?? machines.effective(docId).profile.editing?.autoSpace === true;
}

/** Whether Enter numbers the new line in `docId` now: the session switch, else `editing.autoNumber`. NC programs only. */
export function autoNumberOn(docId: DocId): boolean {
  if (!isNcDocument(docId)) return false;
  return numberOverride ?? machines.effective(docId).profile.editing?.autoNumber === true;
}

/** Forgets the upper-case session switch (tests, and a fresh app state). */
export function resetUppercaseOverride(): void {
  override = null;
}

/** Forgets all three session switches. */
export function resetTypingOverrides(): void {
  override = null;
  spaceOverride = null;
  numberOverride = null;
}

function toggle(docId: DocId | null): void {
  if (docId === null) return;
  if (!isNcDocument(docId)) {
    status.show(t('typing.notHere'));
    return;
  }
  override = !uppercaseOn(docId);
  status.show(t(override ? 'typing.upperOn' : 'typing.upperOff'));
}

function toggleSpace(docId: DocId | null): void {
  if (docId === null) return;
  if (!isNcDocument(docId)) {
    status.show(t('typing.notHere'));
    return;
  }
  spaceOverride = !autoSpaceOn(docId);
  status.show(t(spaceOverride ? 'typing.spaceOn' : 'typing.spaceOff'));
}

function toggleNumber(docId: DocId | null): void {
  if (docId === null) return;
  if (!isNcDocument(docId)) {
    status.show(t('typing.notHere'));
    return;
  }
  numberOverride = !autoNumberOn(docId);
  status.show(t(numberOverride ? 'typing.numberOn' : 'typing.numberOff'));
}

/** The status bar's sentence for a new line that stays without a number (§6.5 rule 2). */
export function refusalMessage(refusal: AutoNumberRefusal, cp: CompiledProfile): string {
  switch (refusal.reason) {
    case 'noGap':
      return t('typing.numberNoGap', { from: blockNumberLabel(refusal.between[0], cp), to: blockNumberLabel(refusal.between[1], cp) });
    case 'overflow':
      return t('typing.numberOverflow', { max: blockNumberLabel(refusal.max, cp) });
    case 'tooManyBelow':
      return t('typing.numberTooMany', { limit: refusal.limit.toLocaleString('en-US') });
    case 'inPane':
      return t('typing.numberInPane');
  }
}

// -- the editor side ------------------------------------------------------------------------

/**
 * The part of a Monaco code editor the hook uses. Spelled out so the test can supply a small
 * fake, and so a change of Monaco shows here and not in the middle of the handler.
 */
export interface TypingEditor {
  onKeyDown(listener: (e: TypingKeyEvent) => void): { dispose(): void };
  onDidCompositionStart?(listener: () => void): { dispose(): void };
  onDidCompositionEnd?(listener: () => void): { dispose(): void };
  getModel(): TypingModel | null;
  getSelections(): TypingSelection[] | null;
  trigger(source: string, handlerId: string, payload: unknown): void;
  /** Closes the open undo element, so the automatic number's edit is one step of its own. */
  pushUndoStop?(): boolean;
  /** The editor's live option value (`monaco.editor.EditorOption` id); `acceptSuggestionOnEnter` is read here. */
  getOption?(id: number): unknown;
  /** The editor's contribution by id; the suggest controller (`editor.contrib.suggestController`) is asked to close its list. */
  getContribution?(id: string): { cancelSuggestWidget?(): void } | null;
  /** Monaco's public context key service of the editor; `suggestWidgetVisible` is read from it. */
  readonly contextKeyService?: { getContextKeyValue?(key: string): unknown };
  executeEdits(
    source: string,
    edits: { range: TypingSelection; text: string; forceMoveMarkers?: boolean }[],
    cursorState?: (inverse: { range: TypingSelection }[]) => unknown[] | null,
  ): boolean;
}

export interface TypingKeyEvent {
  browserEvent: KeyInput;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface TypingModel {
  getLineContent(line: number): string;
  /** The length of a line, which Monaco answers without copying the line. */
  getLineLength(line: number): number;
  getLineCount(): number;
  /** The model's URI; a channel pane's is `inmemory://pane/<docId>/<channelId>` (§6.7). */
  uri?: { scheme?: string; authority?: string };
}

/** A normalized selection (`start` is never after `end`) with its active end. */
export interface TypingSelection {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  positionLineNumber: number;
  positionColumn: number;
}

/** Lines longer than this are not tokenized per keystroke; the letter is left as typed. */
export const MAX_TYPING_LINE = 20000;

function isEmpty(s: TypingSelection): boolean {
  return s.startLineNumber === s.endLineNumber && s.startColumn === s.endColumn;
}

/** The text around a selection, or null when one of the lines it reads is too long to tokenize per key. */
function siteOf(model: TypingModel, s: TypingSelection): TypingSite | null {
  const above = s.startLineNumber - 1;
  if (
    model.getLineLength(s.startLineNumber) > MAX_TYPING_LINE ||
    model.getLineLength(s.endLineNumber) > MAX_TYPING_LINE ||
    (above >= 1 && model.getLineLength(above) > MAX_TYPING_LINE)
  ) {
    return null;
  }
  return {
    before: model.getLineContent(s.startLineNumber).slice(0, s.startColumn - 1),
    after: model.getLineContent(s.endLineNumber).slice(s.endColumn - 1),
    previousLine: above >= 1 ? model.getLineContent(above) : null,
  };
}

/** A line this long holds text; it is never read just to find out whether it is blank. */
function blankOf(model: TypingModel, line: number): boolean {
  return model.getLineLength(line) <= MAX_TYPING_LINE && isBlankLine(model.getLineContent(line));
}

/** A letter in either case: lower case for upper-case typing, either for auto-space (Shift and Caps Lock type letters too). */
function isLetterKey(key: string): boolean {
  return key.length === 1 && key.toUpperCase() !== key.toLowerCase();
}

/** True for a channel pane's model (`inmemory://pane/…`, `monaco/channelPanes.ts`). */
export function isPaneModel(model: TypingModel): boolean {
  return model.uri?.scheme === 'inmemory' && model.uri.authority === 'pane';
}

/**
 * True when Enter belongs to the suggestion list and is not ours. Whether it does is the editor's own option
 * `acceptSuggestionOnEnter` (read live, so the setting that changes it is honoured): with `'off'` Enter never
 * accepts a suggestion — it closes the list and breaks the line — so the line is numbered whatever the list
 * shows. With `'on'` or `'smart'` Enter belongs to the list while it is visible; the visibility is read from the
 * editor's public `contextKeyService`, and when it cannot be read (no service, an error thrown) the answer is yes: a
 * number is never typed over a suggestion the user may be accepting. An option that cannot be read counts as `'on'`.
 */
function suggestionTakesEnter(instance: TypingEditor, optionId: number | null): boolean {
  let mode: unknown;
  try {
    mode = optionId === null ? undefined : instance.getOption?.(optionId);
  } catch {
    mode = undefined;
  }
  if (mode === 'off') return false;
  const keys = instance.contextKeyService;
  if (typeof keys?.getContextKeyValue !== 'function') return true;
  try {
    // A key nobody has bound yet (no list was ever shown) reads as undefined: not visible.
    return keys.getContextKeyValue('suggestWidgetVisible') === true;
  } catch {
    return true;
  }
}

/** Closes the suggestion list and its session, if the editor has them; nothing happens where it has not (a fake, a Monaco without it). */
function closeSuggestions(instance: TypingEditor): void {
  try {
    instance.getContribution?.('editor.contrib.suggestController')?.cancelSuggestWidget?.();
  } catch {
    // The list stays as it is; the key still goes in.
  }
}

/** Everything `handleKey` needs from the app, injectable for the test. */
export interface TypingDeps {
  activeDocId(): DocId | null;
  readOnly(id: DocId): boolean;
  effective(id: DocId): { cp: CompiledProfile; editing: { forceUppercase?: boolean; preventLineJoin?: boolean } };
  uppercaseOn(id: DocId): boolean;
  autoSpaceOn(id: DocId): boolean;
  autoNumberOn(id: DocId): boolean;
  /** False for a document that is not an NC program (`.json`, `.py`): no typing option acts there. */
  applies(id: DocId): boolean;
  hint(text: string): void;
  /** The `Selection` class for the end state of `executeEdits`; `null` until Monaco has loaded. */
  makeSelection(line: number, column: number): unknown | null;
  /** `monaco.editor.EditorOption.acceptSuggestionOnEnter`; `null` until Monaco has loaded (the option then reads as unknown). */
  enterOption(): number | null;
}

/**
 * One key press. Returns true when it was taken over (the default is prevented). The cheap
 * tests come first: this runs for every key the user presses.
 */
export function handleKey(
  instance: TypingEditor,
  e: TypingKeyEvent,
  composing: boolean,
  deps: TypingDeps,
): boolean {
  const k = e.browserEvent;
  const isDeletion = k.key === 'Backspace' || k.key === 'Delete';
  const isEnter = k.key === 'Enter';
  if (!isDeletion && !isEnter && !isLetterKey(k.key)) return false;
  const id = deps.activeDocId();
  if (id === null || deps.readOnly(id) || !deps.applies(id)) return false;
  const model = instance.getModel();
  const selections = instance.getSelections();
  if (!model || !selections || selections.length === 0) return false;

  if (isDeletion) {
    const effective = deps.effective(id);
    if (effective.editing.preventLineJoin !== true) return false;
    const backspace = k.key === 'Backspace';
    const lineCount = model.getLineCount();
    const joins: JoinSelection[] = selections.map((s) => {
      const line = s.positionLineNumber;
      const lineLength = model.getLineLength(line);
      const empty = isEmpty(s);
      // Only a cursor at the edge where a join could happen needs the text of its line and of
      // the neighbour; every other selection is answered from the lengths alone.
      const atEdge = empty && (backspace ? s.positionColumn === 1 && line > 1 : s.positionColumn === lineLength + 1 && line < lineCount);
      if (!atEdge) {
        return { empty, line, column: s.positionColumn, lineLength, lineBlank: false, neighbourBlank: false };
      }
      const neighbour = backspace ? line - 1 : line + 1;
      return {
        empty,
        line,
        column: s.positionColumn,
        lineLength,
        lineBlank: blankOf(model, line),
        neighbourBlank: neighbour < 1 || neighbour > lineCount || blankOf(model, neighbour),
      };
    });
    if (!wouldJoinBlocks(k, joins, model.getLineCount(), composing)) return false;
    e.preventDefault();
    e.stopPropagation();
    deps.hint(t('typing.noJoin'));
    return true;
  }

  if (isEnter) return handleEnter(instance, e, composing, deps, id, model, selections);

  const uppercase = deps.uppercaseOn(id);
  const autoSpace = deps.autoSpaceOn(id);
  if (!uppercase && !autoSpace) return false;
  // An upper-case key needs nothing from upper-case typing alone: no line is read for it.
  if (!autoSpace && k.key.toUpperCase() === k.key) return false;
  const sites: TypingSite[] = [];
  for (const s of selections) {
    const site = siteOf(model, s);
    if (site === null) return false;
    sites.push(site);
  }
  const decision = decideTyping(k, sites, deps.effective(id).cp, { uppercase, autoSpace }, composing);
  if (decision.kind === 'pass') return false;
  if (decision.kind === 'type') {
    e.preventDefault();
    e.stopPropagation();
    // A space and a letter in one `type` start a new word in a single content change. With a suggestion session open
    // Monaco 0.55 filters it for that change and meets a completion model it has just dropped
    // (`this._completionModel.getItemsByProvider` of undefined, an uncaught error from its own listener), which a typed
    // space and a typed letter, one change each, never meet. The list ends at the space anyway: it is closed first, and
    // the letter opens a new one as it does after a typed space.
    if (decision.text.length > 1) closeSuggestions(instance);
    instance.trigger('keyboard', 'type', { text: decision.text });
    return true;
  }
  // The cursors disagree. Without the Selection class (Monaco still loading) the key goes
  // through as typed; in practice the class is there long before the first key.
  if (deps.makeSelection(1, 1) === null) return false;
  e.preventDefault();
  e.stopPropagation();
  instance.executeEdits(
    'keyboard',
    selections.map((s, i) => ({ range: s, text: decision.texts[i] ?? k.key, forceMoveMarkers: true })),
    (inverse) =>
      inverse.map((op) => deps.makeSelection(op.range.endLineNumber, op.range.endColumn)).filter((s) => s !== null),
  );
  return true;
}

/**
 * Plain Enter with the automatic block number on (§6.5 rules 2 and 3). Returns true when the line break and the
 * number were typed here; false leaves the key to the editor (after saying why, for a refusal).
 */
function handleEnter(
  instance: TypingEditor,
  e: TypingKeyEvent,
  composing: boolean,
  deps: TypingDeps,
  id: DocId,
  model: TypingModel,
  selections: TypingSelection[],
): boolean {
  const k = e.browserEvent;
  if (k.ctrlKey === true || k.altKey === true || k.metaKey === true || k.shiftKey === true) return false;
  if (composing || k.isComposing === true || k.keyCode === 229) return false;
  if (!deps.autoNumberOn(id)) return false;
  if (selections.length !== 1 || !isEmpty(selections[0])) return false;
  if (suggestionTakesEnter(instance, deps.enterOption())) return false;
  const s = selections[0];
  const line = s.positionLineNumber;
  if (model.getLineLength(line) > MAX_TYPING_LINE) return false;
  const cp = deps.effective(id).cp;
  // A line too long to read per key reads as empty: no number, no continuation. The length is the text's own:
  // asking the model for it first costs more than reading an ordinary line (two lookups in its tree), and the
  // walk below an Enter reads thousands of lines.
  const read = (n: number): string => {
    const text = model.getLineContent(n);
    return text.length > MAX_TYPING_LINE ? '' : text;
  };
  const lineCount = model.getLineCount();
  const answer = decideAutoNumber({ line, column: s.positionColumn, lineCount, read, inPane: isPaneModel(model) }, cp);
  if (answer.kind === 'plain') return false;
  if (answer.kind === 'none') {
    deps.hint(refusalMessage(answer, cp));
    return false;
  }
  if (deps.makeSelection(1, 1) === null) return false;
  e.preventDefault();
  e.stopPropagation();
  // The indentation of the block's first line, as the editor would carry it to the new line.
  const base = blockBaseLine(read, line, cp) ?? line;
  const indent = /^[ \t]*/.exec(read(base))?.[0] ?? '';
  const text = read(line);
  const range = (l: number, from: number, to: number): TypingSelection => ({
    startLineNumber: l,
    startColumn: from,
    endLineNumber: l,
    endColumn: to,
    positionLineNumber: l,
    positionColumn: to,
  });
  const edits = [
    // The blanks after the cursor go: the new line starts with its number.
    { range: range(line, s.positionColumn, text.length + 1), text: `\n${indent}${answer.text}`, forceMoveMarkers: true },
    ...answer.shifts.map((shift) => ({ range: range(shift.line, shift.startColumn, shift.endColumn), text: shift.text })),
  ];
  const column = indent.length + answer.text.length + 1;
  instance.pushUndoStop?.();
  instance.executeEdits('autoNumber', edits, () => [deps.makeSelection(line + 1, column)].filter((sel) => sel !== null));
  instance.pushUndoStop?.();
  return true;
}

// -- wiring ---------------------------------------------------------------------------------

let hookedInstance: unknown;
let hookDisposables: { dispose(): void }[] = [];
let selectionCtor: (new (a: number, b: number, c: number, d: number) => unknown) | null = null;
/** `monaco.editor.EditorOption.acceptSuggestionOnEnter`, known once Monaco has loaded (until then Enter is left alone). */
let enterOptionId: number | null = null;

/** The deps of the real app; `docId` names the document the keys are for (the active one unless a pane says otherwise). */
function realDeps(docId: () => DocId | null = () => docs.getActiveId()): TypingDeps {
  return {
    activeDocId: docId,
    readOnly: (id) => docs.get(id)?.readOnly === true,
    effective: (id) => {
      const eff = machines.effective(id);
      return { cp: eff.cp, editing: eff.profile.editing ?? {} };
    },
    uppercaseOn,
    autoSpaceOn,
    autoNumberOn,
    applies: isNcDocument,
    hint: (text) => status.show(text),
    makeSelection: (line, column) => (selectionCtor ? new selectionCtor(line, column, line, column) : null),
    enterOption: () => enterOptionId,
  };
}

function hook(instance: TypingEditor, deps: TypingDeps): { dispose(): void }[] {
  let composing = false;
  const out: { dispose(): void }[] = [];
  out.push(instance.onKeyDown((e) => void handleKey(instance, e, composing, deps)));
  const start = instance.onDidCompositionStart?.(() => (composing = true));
  const end = instance.onDidCompositionEnd?.(() => (composing = false));
  if (start) out.push(start);
  if (end) out.push(end);
  return out;
}

/**
 * Hooks the FOCUSED group's editor (P4e, §6.7 rules 2 and 3): the keys go to the editor that has the
 * focus, so the hook follows `onDidFocusGroup` as well as `onDidAttach` (a new or rebuilt editor).
 */
function ensureHook(): void {
  const instance = editor.editorInstance();
  if (!instance || instance === hookedInstance) return;
  hookedInstance = instance;
  for (const d of hookDisposables.splice(0)) d.dispose();
  hookDisposables = hook(instance as unknown as TypingEditor, realDeps());
  loadSelection();
}

function loadSelection(): void {
  void getMonaco().then((monaco) => {
    selectionCtor = monaco.Selection as unknown as typeof selectionCtor;
    enterOptionId = monaco.editor.EditorOption.acceptSuggestionOnEnter;
  });
}

/**
 * Hooks one pane of the aligned compare view (P4e FT). The pane shows a fixed document, so the
 * keys follow `docId` — that document's dialect, its upper-case setting (and the session switch)
 * and its line-join guard — not the active document, which is the compared one. `docId` returning
 * `null` (or a read-only or non-NC document) leaves the key to the editor. Dispose when the view
 * closes, the pane is locked or its model changes. The main editor's hook is not touched.
 */
export function hookTyping(instance: TypingEditor, docId: () => DocId | null): { dispose(): void } {
  loadSelection();
  const disposables = hook(instance, realDeps(docId));
  return {
    dispose() {
      for (const d of disposables.splice(0)) d.dispose();
    },
  };
}

export default {
  id: 'typing',
  commands: [
    {
      id: 'edit.toggleForceUppercase',
      title: 'typing.toggleForceUppercase',
      category: 'typing.category',
      icon: asIcon(CaseUpper),
      enabled: (c) => c.activeDocId !== null && isNcDocument(c.activeDocId),
      run: (c) => toggle(c.activeDocId),
    },
    {
      id: 'edit.toggleAutoSpace',
      title: 'typing.toggleAutoSpace',
      category: 'typing.category',
      icon: asIcon(Space),
      enabled: (c) => c.activeDocId !== null && isNcDocument(c.activeDocId),
      run: (c) => toggleSpace(c.activeDocId),
    },
    {
      id: 'edit.toggleAutoNumber',
      title: 'typing.toggleAutoNumber',
      category: 'typing.category',
      icon: asIcon(ListOrdered),
      enabled: (c) => c.activeDocId !== null && isNcDocument(c.activeDocId),
      run: (c) => toggleNumber(c.activeDocId),
    },
  ],
  ribbon: [
    { tab: 'edit', group: 'typing.group', command: 'edit.toggleForceUppercase', order: 150 },
    { tab: 'edit', group: 'typing.group', command: 'edit.toggleAutoSpace', order: 151 },
    { tab: 'edit', group: 'typing.group', command: 'edit.toggleAutoNumber', order: 152 },
  ],
  activate() {
    const attached = editor.onDidAttach(ensureHook);
    const focused = editor.onDidFocusGroup(ensureHook);
    // An editor that was attached before this activation.
    ensureHook();
    return () => {
      attached();
      focused();
      for (const d of hookDisposables.splice(0)) d.dispose();
      hookedInstance = undefined;
    };
  },
} satisfies Contribution;
