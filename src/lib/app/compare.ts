// Comparing a document with another document, a file or its saved version
// (plan §7.3, §5 WP2.5). Owner: WP2.5.
//
// The comparison lives in the `overlay` region, so it replaces the editor rather than
// splitting the window. The modified side is the compared document's live model and stays
// editable; the original side is the other document's model, or a temporary read-only
// model built from `files.readDisk`, which is disposed on close. A side above 50 MB is
// refused with a status error, because Monaco does not sync such a model to the worker
// and the diff would never arrive (F8). A file side is measured by its stat *before* it is
// read, the way `files.open` does it, so an oversized pick never enters the webview.
//
// `createCompareService(deps)` plus a default singleton wired to the real modules (AD-2).
// Beyond the §7.3 contract the controller carries what only `CompareView` and
// `contrib/compare.ts` need: the prepared original (`content`), the panes' content
// (`sides`), the raw view's two options (`view`) and the review bar's facts (`review`).
//
// M11 (§7.7, AD-26): the review mode, its toggles (`options`), the merge, the export and
// "compare two files". The P1 view options were called `options` too; they are `view`
// now (`DiffViewOptions`, §7.16 #138), so `options` is §7.7's alone.
//
//  - Review mode normalizes each side with its own document's effective profile and
//    machine (`normalizeLines`, §7.7) and shows the two results in read-only scratch
//    models (`monaco/diff.ts`); `lineMap` takes "go to line" back to the original lines. A
//    side that is a file not open as a document has no machine, and the bar says so.
//  - The toggles start from `compareDefaults(profile)` with the user's saved changes over
//    them. What is saved is `state.json` `ui.lastParams.compare` (`CompareMemo`, §7.11,
//    §7.16 #137): the mode, the raw view's two options, and per profile only the toggles
//    that differ from its defaults. It is read once, on first use (the UI state is loaded
//    after this module is), member by member, so a bad file only brings the defaults back.
//  - The merge is raw mode only. `mergePlan`/`mergeOperation` are pure: from a Monaco line
//    change they work out which lines to read and which to replace, and the one edit goes
//    into the target model between two undo stack elements, so one Cmd+Z takes it back.
//
// P4.25 (X30): the third view, **aligned** (`aligned`, `setAligned`). Both panes show the
// programs as written, level on the blocks of a line diff that runs on the review-mode
// normalization (the ignore options in force), with the word marks of P4.24 inside a changed
// block (`core/compare/aligned.ts`, `monaco/alignedView.ts`). It is a view and not a third
// `mode`: the mode (raw or review) is what the Raw and Review buttons set and what the
// compare memo remembers; `aligned` sits over it and is cleared by choosing either. The
// review toggles apply to it as they do to review mode; the merge works on the written text
// (a block, one row, or one run of words) as one undo step of the target.
//
// Review NC-6 (the owner, 2026-10-17: a warning, never a refusal): a copy whose text lands in
// the other program where that program is in another mode (absolute or incremental, inch or mm,
// the plane, the work offset) is made, and then the status bar warns. The modes are read in
// front of the copied lines on each side with the modal interpreter (`core/nc/modal.ts`): the
// modal service's index for an open document when it has the line (`modalStateAfter`), else a
// walk from the nearest snapshot of that index (`modalSnapshotAt`, at most 1,000 lines for an
// index that has got there; the same state as the full walk), else a walk from the top of the
// side's text (a file or the saved version), each side with its own effective profile and
// code database. A mode written on the copied line itself is a marked
// difference on screen and is not compared in front. The owner, 2026-10-20: the copy also warns
// at its end, when it changes the modes the target's lines below it run in (a copied block
// that ends in `G91` where the target was in `G90`; a removal of the line that held the `G91`;
// a copied word `G91`): the state after the copied text against the state the line below ran
// in before (`modalStatesAroundEdit`, from the same snapshot of the target's index). Front and end make one status message.
//
// Closing is funnelled through one place. The overlay's own ✕ (PanelHost) and anything
// else that changes `layout.overlay` go through the layout subscription below, so the
// session ends no matter who closed the view. The editor's own view state (cursor, scroll,
// folds) is saved by its group when the compare overlay unmounts the editors and put back
// when they are mounted again (`detachGroup` / `attachGroup`, P4.21), so nothing is captured
// here. The temporary models are not disposed (see `monaco/diff.ts`).

import { derived, get, writable, type Readable } from 'svelte/store';
import { dialogs as appDialogs } from '$lib/app/dialogs';
import { files as appFiles, formatBytes, MAX_OPEN_BYTES } from '$lib/app/fileOps';
import { status as appStatus } from '$lib/app/status';
import { filesStat } from '$lib/platform/commands';
import { isTauriRuntime } from '$lib/utils/platform';
import { docs as appDocs } from '$lib/stores/documents';
import { layout as appLayout } from '$lib/stores/layout';
import { machines as appMachines } from '$lib/stores/machines';
import { codes as appCodes } from '$lib/stores/codes';
import { modal as appModal } from '$lib/app/modalService';
import { profiles as appProfiles } from '$lib/stores/profiles';
import { uiState as appUiState } from '$lib/stores/uiState';
import {
  currentDiff,
  modelCharCount,
  MODEL_SYNC_LIMIT_CHARS,
  watchCurrentDiff,
  type DiffCursor,
  type DiffHandle,
  type DiffLineChange,
  type DiffOriginal,
  type DiffSides,
} from '$lib/monaco/diff';
import type { LineOperation } from '$lib/monaco/applyLines';
import { isAlignedHandle, type AlignedResult } from '$lib/monaco/alignedView';
import { editor as appEditor } from '$lib/monaco/editorService';
import { t } from '$lib/i18n';
import {
  compareDefaults,
  COMPARE_FALLBACK,
  COMPARE_MEMO_KEY,
  COMPARE_NOTE_KEYS,
  COMPARE_OPTION_KEYS,
  normalizeLines,
  offeredOptions,
  pointSignificant,
  prepareNormalize,
  unifiedDiff,
  type CompareMemo,
  type CompareOptions,
  type Normalized,
  type NormalizeOverrides,
} from '$lib/core/compare';
import { alignSides, copyModes, type CopyModeKind, makePairReader, modeChanges, modeDifferences, rowOf, wordMergePlan } from '$lib/core/compare/aligned';
import { ModalInterpreter, SNAPSHOT_EVERY, type ModalSnapshot } from '$lib/core/nc/modal';
import { maskComments } from '$lib/core/nc/mask';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import type { LineState, ModalState } from '$lib/core/nc/types';
import type { CodeDb } from '$lib/core/codes/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { EffectiveMachine, EffectiveProfile } from '$lib/core/machines/types';
import type {
  CompareService,
  CompareSource,
  DecodeResult,
  Disposable,
  DocId,
  DocMeta,
  DocumentStore,
  FileOps,
  LayoutStore,
  ProfileRegistry,
  StatusService,
} from '$lib/app/types';

/** The id `contrib/compare.ts` registers the overlay panel under. */
export const COMPARE_PANEL_ID = 'compare';

/** The catalog name of each mode a copy warning can name (`modeNotKnown`). */
const MODE_KIND_KEYS = {
  distance: 'compare.modeKindDistance',
  units: 'compare.modeKindUnits',
  plane: 'compare.modeKindPlane',
  offset: 'compare.modeKindOffset',
} as const satisfies Record<CopyModeKind, string>;

/** The open comparison, exactly as §7.3 describes it. */
export interface CompareSession {
  docId: DocId;
  source: CompareSource;
  title: string;
}

/** A session plus the prepared original side; `CompareView` reads this one. */
export interface CompareContent extends CompareSession {
  original: DiffOriginal;
}

/** The raw view's two live options (the P1 toolbar). Not the review toggles of §7.7. */
export interface DiffViewOptions {
  inline: boolean;
  ignoreTrimWhitespace: boolean;
}

export type CompareMode = 'raw' | 'review';
export type CopyDirection = 'toModified' | 'toOriginal';

/**
 * Why a copy is not offered: refused before the diff is even asked (`review`, `notDocument`,
 * `locked`, `copyBlocker`), or, in the toolbar's `copyBlock` only, no change at the cursor
 * (`noChange`, M11 CODE-18; a click still says why).
 */
export type CopyBlock = 'review' | 'notDocument' | 'locked' | 'noChange';

/** One line of the review bar: what the user has to know to read the result. */
export interface ReviewNote {
  reason: 'machines' | 'blockNumbers' | 'noMachine' | 'profiles';
  text: string;
}

/** One normalized side: the text of its scratch model and the way back to the file's lines. */
export interface ReviewSide {
  text: string;
  /** `lineMap[i]` = the 1-based line of the file that review line `i + 1` came from. */
  lineMap: Int32Array;
  languageId: string;
}

/** The two normalized sides with what the bar says about them. */
export interface ReviewView {
  original: ReviewSide;
  modified: ReviewSide;
  notes: ReviewNote[];
}

/** Which profile the toggles belong to and what that profile starts them at. */
export interface ReviewInfo {
  profileId: string;
  defaults: CompareOptions;
  /** The toggles the bar shows for this profile, in toolbar order (`offeredOptions`, §7.16 #148). */
  offered: readonly (keyof CompareOptions)[];
}

/** The §7.3 service plus what the view and the contribution need. Not part of §7.3. */
export interface CompareController extends CompareService {
  readonly content: Readable<CompareContent | null>;
  /** P1's `options`, renamed in M11 (§7.16 #138). */
  readonly view: Readable<DiffViewOptions>;
  /** What the two panes show: the documents as they are, or the normalized copies. */
  readonly sides: Readable<DiffSides | null>;
  /** The review bar's facts; null in raw mode and with no comparison. */
  readonly review: Readable<ReviewView | null>;
  /** The profile of the compared document and its defaults (the "Profile defaults" button). */
  readonly reviewInfo: Readable<ReviewInfo | null>;
  /**
   * Per direction: why a copy is not offered right now, or null. `noChange` while the cursor is
   * in no change (M11 CODE-18); while the changes are being worked out again after an edit, the
   * last answer stands.
   */
  readonly copyBlock: Readable<Record<CopyDirection, CopyBlock | null>>;
  /** P4.25: the aligned view is showing (over `mode`; the Raw and Review buttons clear it). */
  readonly aligned: Readable<boolean>;
  setAligned(on: boolean): void;
  toggleAligned(): void;
  /**
   * P4.25: aligns the two texts as they are under the review toggles in force, for the aligned
   * view. `reuse`: only the toggles changed, so the normalization the review bar was built
   * from is still right. Null when no comparison is open.
   */
  align(o?: { reuse?: boolean }): AlignedResult | null;
  /**
   * P4.25: copies the marked run of words at the cursor of the aligned view into the other
   * pane (replacing the words there, inserting them, or removing them), as one undo step of
   * the target. False when nothing was copied.
   */
  copyWord(direction: CopyDirection): Promise<boolean>;
  setInline(inline: boolean): void;
  setIgnoreTrimWhitespace(ignore: boolean): void;
  toggleInline(): void;
  /** Raw ↔ review. */
  toggleMode(): void;
  /** Forgets this profile's saved toggles. */
  resetOptions(): void;
  /**
   * Puts the cursor on `line` of one side's file, mapped through that side's `lineMap` in
   * review mode. False when there is no comparison or no such line.
   */
  goToLine(line: number, side?: 'original' | 'modified'): boolean;
}

export interface CompareDeps {
  docs: DocumentStore;
  layout: LayoutStore;
  status: StatusService;
  profiles: Pick<ProfileRegistry, 'detect' | 'compiled'>;
  files: Pick<FileOps, 'open' | 'newUntitled'>;
  readDisk(path: string): Promise<DecodeResult | null>;
  /**
   * The file's size in bytes, or null when it cannot be told. Asked BEFORE `readDisk`,
   * so the 50 MB guard can refuse a pick without pulling it through IPC first (G8 M2).
   */
  statSize(path: string): Promise<number | null>;
  /** The document's length in UTF-16 code units, for the 50 MB guard (F8). */
  charCountOf(docId: DocId): number;
  /** The document's text, LF-joined. */
  textOf(docId: DocId): string;
  /** The document's effective profile and machine (AD-31). */
  effectiveOf(docId: DocId): EffectiveProfile;
  /** One native file pick; null when cancelled. Grants the path (F3). */
  pickFile(title: string): Promise<string | null>;
  /** The diff editor on screen, or null. */
  diff(): DiffHandle | null;
  /**
   * Calls `listener` when another diff is put on screen and when the one on screen moves its
   * cursor or works out its changes again (`watchCurrentDiff`, M11 CODE-18). Optional.
   */
  watchDiff?(listener: () => void): Disposable;
  /**
   * The modal state after `line` of an open document from the modal service's index, or null
   * while the index has not got there (review NC-6). Optional: without it every side is walked.
   */
  modalStateAfter?(docId: DocId, line: number): ModalState | null;
  /**
   * The modal service's nearest snapshot at or before `line` of an open document, for the text
   * read at `expect.version` and this profile and database, or null (`ModalService.snapshotAt`):
   * the walks to the place of a copy start from it instead of from the top. Optional.
   */
  modalSnapshotAt?(docId: DocId, line: number, expect: { version?: number; cp: CompiledProfile; db: CodeDb }): ModalSnapshot | null;
  /** `editor.versionId` of a document, read with its text. Optional. */
  versionOf?(docId: DocId): number;
  /** The code database of a profile, for a file that is not open as a document (review NC-6). Optional. */
  codesFor?(profileId: string): CodeDb;
  /** `ui.lastParams.compare`, untrusted (§7.11). */
  memory: {
    read(): unknown;
    write(memo: CompareMemo): void;
  };
  /**
   * The compare overlay replaced the editors (the groups saved their view state and were
   * unmounted); once they are built again, the keyboard goes back to the focused one. Called
   * when a session ends.
   */
  focusEditorWhenBack(): void;
}

// ---------------------------------------------------------------------------
// Pure helpers (target selection; exported for the unit tests)
// ---------------------------------------------------------------------------

export type CompareSourceKind = CompareSource['kind'];

/**
 * What `compare.with` can offer for `doc` right now, in the order the QuickPick shows:
 * the saved version needs a path, another document needs a second tab, a file always
 * works. An empty list means there is nothing to compare at all.
 */
export function availableSources(doc: DocMeta | undefined, openCount: number): CompareSourceKind[] {
  if (!doc) return [];
  const kinds: CompareSourceKind[] = [];
  if (doc.path !== null) kinds.push('saved');
  if (openCount > 1) kinds.push('document');
  kinds.push('file');
  return kinds;
}

/** Every open document but `docId`: what `compare.withDocument` may be held against. */
export function documentTargets(all: DocMeta[], docId: DocId): DocMeta[] {
  return all.filter((doc) => doc.id !== docId);
}

/**
 * The document to compare with without asking. With exactly two tabs open there is only
 * one answer, so the QuickPick would be a pointless keystroke; with more, the user picks.
 */
export function autoTarget(all: DocMeta[], docId: DocId): DocId | null {
  const others = documentTargets(all, docId);
  return others.length === 1 ? others[0].id : null;
}

/** False when a side is too large for Monaco's diff worker (F8). */
export function withinCompareLimit(chars: number): boolean {
  return chars <= MODEL_SYNC_LIMIT_CHARS;
}

/** The translated title of a comparison; `other` is the document or file it is held against. */
export function compareTitle(docTitle: string, source: CompareSource, other: string): string {
  if (source.kind === 'saved') return t('compare.titleSaved', { name: docTitle });
  if (source.kind === 'document') return t('compare.titleDocument', { name: docTitle, other });
  return t('compare.titleFile', { name: docTitle, file: other });
}

/** `basename` of a path, for the title of a file comparison. */
function fileName(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut < 0 ? path : path.slice(cut + 1);
}

// ---------------------------------------------------------------------------
// The saved options (pure)
// ---------------------------------------------------------------------------

/** `CompareMemo` plus the view P4.25 remembers: whether the aligned view was showing. */
export interface StoredMemo extends CompareMemo {
  aligned?: boolean;
}

/**
 * `ui.lastParams.compare` as it may be read from a hand-edited file: member by member, and
 * anything that is not the declared type is dropped, so a bad file can only bring the
 * defaults back (§7.11). Profile entries keep only the review toggles, as booleans.
 */
export function compareMemoOf(raw: unknown): StoredMemo {
  const out: StoredMemo = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const memo = raw as Record<string, unknown>;
  if (memo.mode === 'raw' || memo.mode === 'review') out.mode = memo.mode;
  if (typeof memo.aligned === 'boolean') out.aligned = memo.aligned;
  if (typeof memo.inline === 'boolean') out.inline = memo.inline;
  if (typeof memo.ignoreTrimWhitespace === 'boolean') out.ignoreTrimWhitespace = memo.ignoreTrimWhitespace;
  const review = memo.review;
  if (review !== null && typeof review === 'object' && !Array.isArray(review)) {
    // No prototype: a profile id of `__proto__` (a hand-edited file) is an entry like any other.
    const kept: Record<string, Partial<CompareOptions>> = Object.create(null);
    for (const [profileId, entry] of Object.entries(review as Record<string, unknown>)) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const toggles: Partial<CompareOptions> = {};
      for (const key of COMPARE_OPTION_KEYS) {
        const value = (entry as Record<string, unknown>)[key];
        if (typeof value === 'boolean') toggles[key] = value;
      }
      if (Object.keys(toggles).length > 0) kept[profileId] = toggles;
    }
    if (Object.keys(kept).length > 0) out.review = kept;
  }
  return out;
}

/** The toggles of `options` that differ from `defaults`: all a profile's entry keeps. */
export function changedToggles(options: CompareOptions, defaults: CompareOptions): Partial<CompareOptions> {
  const changed: Partial<CompareOptions> = {};
  for (const key of COMPARE_OPTION_KEYS) if (options[key] !== defaults[key]) changed[key] = options[key];
  return changed;
}

// ---------------------------------------------------------------------------
// Review mode (pure)
// ---------------------------------------------------------------------------

/** One side of a review comparison, ready to normalize. */
export interface ReviewInput {
  lines: string[];
  cp: CompiledProfile;
  /** Null: a file that is not open as a document has no machine. */
  machine: EffectiveMachine | null;
  profileId: string;
  /** What `side` is called in a note (already translated). */
  label: string;
  /** The side's code database, for the modes at the place of a copy (review NC-6); absent: not read. */
  codes?: CodeDb;
  /** The open document the side is, for the modal service's index; absent for a file or the saved version. */
  docId?: DocId;
  /** `editor.versionId` of the document when its text was read, so the index is only used for this very text. */
  version?: number;
  /**
   * The text of a side that cannot change during the session (a file or the saved version), the
   * key of the snapshots the checks at a copy keep for it (`SideSnapshots`, WX-CODE-1).
   */
  staticText?: string;
}

function machineName(machine: EffectiveMachine): string {
  return machine.name ?? t('compare.machineNone');
}

function sideOf(
  input: ReviewInput,
  o: CompareOptions,
  over: NormalizeOverrides,
): { normalized: Normalized; side: ReviewSide } {
  const normalized = normalizeLines(input.lines, input.cp, o, input.machine, over);
  return {
    normalized,
    // An empty side has no lines at all, which is the empty text and not one empty line.
    side: { text: normalized.text, lineMap: normalized.lineMap, languageId: input.profileId },
  };
}

/**
 * One rule for both sides: an increment-reading side would see `X10` and `X10.` apart, so the
 * calculator-reading side must not make them equal on its own (§7.16 #144).
 */
function sharedOverrides(modified: ReviewInput, original: ReviewInput): NormalizeOverrides {
  return {
    pointSignificant:
      pointSignificant(modified.cp.profile, modified.machine) || pointSignificant(original.cp.profile, original.machine),
  };
}

/**
 * Normalizes both sides, each with its own profile and machine (AD-26) but with one
 * decimal-point rule, the stricter of the two (§7.16 #144, review NC-6), and collects what
 * the review bar says: that the two effective machines differ, that the sides are read
 * under different profiles or a side with no machine, and the notes of `normalizeLines`
 * itself (block numbers kept for a computed jump, a decimal point that counts because no
 * machine says how numbers are read).
 */
export function buildReview(modified: ReviewInput, original: ReviewInput, o: CompareOptions): ReviewView {
  const over = sharedOverrides(modified, original);
  const m = sideOf(modified, o, over);
  const a = sideOf(original, o, over);
  const notes: ReviewNote[] = [];

  if (modified.profileId !== original.profileId) {
    notes.push({
      reason: 'profiles',
      text: t('compare.noteProfiles', { original: original.profileId, modified: modified.profileId }),
    });
  } else if (original.machine !== null && modified.machine !== null && original.machine.key !== modified.machine.key) {
    notes.push({
      reason: 'machines',
      text: t('compare.noteMachines', {
        original: machineName(original.machine),
        modified: machineName(modified.machine),
      }),
    });
  }
  if (original.machine === null) notes.push({ reason: 'noMachine', text: t('compare.noteNoMachine', { side: original.label }) });

  for (const [input, normalized] of [
    [modified, m.normalized],
    [original, a.normalized],
  ] as const) {
    for (const note of normalized.notes) {
      const params = { ...note.params, side: input.label };
      notes.push({
        reason: note.key === COMPARE_NOTE_KEYS.blockNumbers ? 'blockNumbers' : 'noMachine',
        text: t(note.key, params),
      });
    }
  }
  return { original: a.side, modified: m.side, notes };
}

/**
 * The modal snapshots of one side's text, for the checks at a copy (WX-CODE-1). A file or the
 * saved version has no modal index, so every check walked it from line 1 (1.4 to 4 s on 300,000
 * lines, up to three walks for one copy). This walks the text once, forward: it keeps a
 * snapshot every `every` lines and the state where the furthest walk ended (the tip), and a
 * later request continues from the tip (a place further down) or from the snapshot below the
 * line (a place further up, at most `every - 1` lines to read). The states are those of a walk
 * from the top: `modalStateAfterLine` and `modalStatesAroundEdit` take the snapshot as `from`.
 * Two copies from a 50,000-line side read the lines up to the furthest place once, not twice.
 */
export class SideSnapshots {
  private readonly lines: readonly string[];
  private readonly cp: CompiledProfile;
  private readonly codes: CodeDb;
  private readonly every: number;
  /** `marks[k]`: the snapshot after line `k * every`. */
  private readonly marks: ModalSnapshot[] = [];
  private tip: ModalSnapshot;

  constructor(lines: readonly string[], cp: CompiledProfile, codes: CodeDb, every: number = SNAPSHOT_EVERY) {
    this.lines = lines;
    this.cp = cp;
    this.codes = codes;
    this.every = Math.max(1, Math.floor(every));
    this.tip = Object.freeze({ line: 0, interp: new ModalInterpreter(cp, codes).snapshot(), lineState: undefined });
    this.marks.push(this.tip);
  }

  /** How many lines the walks have reached so far (the furthest line). */
  get walked(): number {
    return this.tip.line;
  }

  /**
   * A snapshot at or before `line` (0: the power-on state; past the end: the end): exactly at
   * `line` where it is at or beyond the furthest place walked so far (the walk goes on to it),
   * else the nearest mark below it.
   */
  at(line: number): ModalSnapshot {
    const wanted = Number.isFinite(line) ? Math.min(Math.max(Math.floor(line), 0), this.lines.length) : 0;
    if (wanted < this.tip.line) return this.marks[Math.floor(wanted / this.every)];
    if (wanted > this.tip.line) this.extend(wanted);
    return this.tip;
  }

  private extend(to: number): void {
    const interp = new ModalInterpreter(this.cp, this.codes);
    interp.restore(this.tip.interp);
    let above = this.tip.lineState;
    for (let n = this.tip.line + 1; n <= to; n++) {
      const text = this.lines[n - 1] ?? '';
      const read = tokenizeLine(text, this.cp, above);
      interp.update(read.tokens, n, maskComments(text, this.cp));
      above = read.state;
      if (n % this.every === 0 || n === to) {
        const snap: ModalSnapshot = Object.freeze({
          line: n,
          interp: interp.snapshot(),
          lineState: above === undefined ? undefined : Object.freeze({ ...above }),
        });
        if (n % this.every === 0) this.marks[n / this.every] = snap;
        if (n === to) this.tip = snap;
      }
    }
  }
}

/**
 * The modal state after line `line` of `lines` (0: the power-on state), walked with the side's
 * effective profile and database, as `ModalIndex` walks a document (review NC-6): from the top,
 * or from `from`, a snapshot of the modal service's index of the same text, profile and
 * database at or before the line (the walk then reads at most the lines between them; the
 * state is the same).
 */
export function modalStateAfterLine(
  lines: readonly string[],
  cp: CompiledProfile,
  codes: CodeDb,
  line: number,
  from?: ModalSnapshot,
): ModalState {
  const interp = new ModalInterpreter(cp, codes);
  const last = Math.min(Math.max(Math.floor(line), 0), lines.length);
  let above: LineState | undefined;
  let n = 1;
  if (from !== undefined && from.line <= last) {
    interp.restore(from.interp);
    above = from.lineState;
    n = from.line + 1;
  }
  for (; n <= last; n++) {
    const text = lines[n - 1] ?? '';
    const read = tokenizeLine(text, cp, above);
    interp.update(read.tokens, n, maskComments(text, cp));
    above = read.state;
  }
  return interp.state();
}

/**
 * The modal state the line below an edit of `lines` runs in, before the edit and after it
 * (the end of a copy, the owner 2026-10-20): the edit replaces the `remove` lines from line
 * `at` on with `inserted`. One walk from the top to the place (or from `from`, a snapshot of
 * the index at or before the line above the place, as for `modalStateAfterLine`), then each
 * tail from a snapshot of the interpreter there; the same readers as `modalStateAfterLine`.
 */
export function modalStatesAroundEdit(
  lines: readonly string[],
  cp: CompiledProfile,
  codes: CodeDb,
  at: number,
  remove: number,
  inserted: readonly string[],
  from?: ModalSnapshot,
): { before: ModalState; after: ModalState } {
  const interp = new ModalInterpreter(cp, codes);
  let above: LineState | undefined;
  const first = Math.min(Math.max(Math.floor(at), 1), lines.length + 1);
  const read = (text: string, n: number): void => {
    const result = tokenizeLine(text, cp, above);
    interp.update(result.tokens, n, maskComments(text, cp));
    above = result.state;
  };
  let n = 1;
  if (from !== undefined && from.line <= first - 1) {
    interp.restore(from.interp);
    above = from.lineState;
    n = from.line + 1;
  }
  for (; n < first; n++) read(lines[n - 1] ?? '', n);
  const place = { interp: interp.snapshot(), above };
  const last = Math.min(first + Math.max(Math.floor(remove), 0) - 1, lines.length);
  for (let m = first; m <= last; m++) read(lines[m - 1] ?? '', m);
  const before = interp.state();
  interp.restore(place.interp);
  above = place.above;
  inserted.forEach((text, k) => read(text, first + k));
  return { before, after: interp.state() };
}

/** Whether a line with text follows the first `skip` lines (a blank line is nothing); reads no more than it needs. */
function hasTextBelow(lines: readonly string[], skip: number): boolean {
  for (let i = skip; i < lines.length; i++) if (lines[i].trim() !== '') return true;
  return false;
}

/** `text` as the lines `normalizeLines` takes. */
function linesOf(text: string): string[] {
  return text.split('\n');
}

/** The lines of a normalized side; an empty side has none. */
function reviewLines(side: ReviewSide): string[] {
  return side.lineMap.length === 0 ? [] : side.text.split('\n');
}

/**
 * The review line that file line `line` shows on, through `lineMap` (nondecreasing): the
 * first one at or after it, so a line the options dropped lands on the next that is shown.
 * Null for an empty side or a line past the last one shown.
 */
export function reviewLineOf(lineMap: Int32Array, line: number): number | null {
  let low = 0;
  let high = lineMap.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (lineMap[mid] < line) low = mid + 1;
    else high = mid;
  }
  return low < lineMap.length ? low + 1 : null;
}

// ---------------------------------------------------------------------------
// The merge (pure)
// ---------------------------------------------------------------------------

/** Lines `start..start + count - 1`; an empty span (`count` 0) names the line *before* it. */
interface Span {
  start: number;
  count: number;
}

function spanOf(change: DiffLineChange, side: 'original' | 'modified'): Span {
  const start = side === 'original' ? change.originalStartLineNumber : change.modifiedStartLineNumber;
  const end = side === 'original' ? change.originalEndLineNumber : change.modifiedEndLineNumber;
  return end === 0 || end < start ? { start, count: 0 } : { start, count: end - start + 1 };
}

/** Whether `line` is "at" a span: inside it, or, for an empty one, next to where it would be. */
function spanHolds(span: Span, line: number): 'inside' | 'next' | null {
  if (span.count > 0) return line >= span.start && line < span.start + span.count ? 'inside' : null;
  return line === span.start || line === span.start + 1 ? 'next' : null;
}

/**
 * The change the cursor is in: the one that holds its line in the pane it is in. A line
 * inside a block wins over a line next to an empty one (a deletion or an insertion).
 */
export function changeAtCursor(changes: readonly DiffLineChange[], cursor: DiffCursor): DiffLineChange | null {
  // The changes are in order and do not overlap on either side (Monaco's, and the aligned
  // view's), so the last line a change holds on this side never goes down along the list:
  // a binary search finds the first change that can hold the line (WX-CODE-2; it ran per
  // cursor event as a scan of the whole list). From there on the ones that start at or before
  // the line are the few it can be in or next to.
  const reach = (change: DiffLineChange): number => {
    const span = spanOf(change, cursor.side);
    return span.count > 0 ? span.start + span.count - 1 : span.start + 1;
  };
  let low = 0;
  let high = changes.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (reach(changes[mid]) < cursor.line) low = mid + 1;
    else high = mid;
  }
  let adjacent: DiffLineChange | null = null;
  for (let i = low; i < changes.length; i++) {
    const change = changes[i];
    if (spanOf(change, cursor.side).start > cursor.line) break;
    const held = spanHolds(spanOf(change, cursor.side), cursor.line);
    if (held === 'inside') return change;
    if (held === 'next' && adjacent === null) adjacent = change;
  }
  return adjacent;
}

/**
 * Why a copy cannot happen, from what is known before the diff is asked: review mode (the
 * panes are normalized copies), a right-to-left copy whose original side is a file or the
 * saved version (not an open document, so there is nothing to write), and a locked target
 * (AD-23).
 */
export function copyBlocker(
  direction: CopyDirection,
  state: { mode: CompareMode; originalIsDocument: boolean; targetLocked: boolean },
): CopyBlock | null {
  if (state.mode === 'review') return 'review';
  if (direction === 'toOriginal' && !state.originalIsDocument) return 'notDocument';
  if (state.targetLocked) return 'locked';
  return null;
}

/** Which lines to read from the source pane and which to replace in the target pane. */
export interface MergePlan {
  sourceFrom: number;
  sourceCount: number;
  /** The first target line replaced, or, with `targetRemove` 0, the line the text goes in front of. */
  targetAt: number;
  targetRemove: number;
}

/**
 * The plan for copying `change` in `direction`. A block copy replaces the target's lines of
 * the change by the source's (an insertion where the target has none, a deletion where the
 * source has none). With `lineOnly` one line is copied: the cursor's line of its pane and
 * the line at the same place in the other pane's block, paired by position in the block.
 * Null when `lineOnly` finds nothing on either side.
 */
export function mergePlan(
  change: DiffLineChange,
  direction: CopyDirection,
  o: { lineOnly?: boolean; cursor: DiffCursor },
): MergePlan | null {
  const sourceSide = direction === 'toModified' ? 'original' : 'modified';
  const source = spanOf(change, sourceSide);
  const target = spanOf(change, direction === 'toModified' ? 'modified' : 'original');
  const blockAt = target.count > 0 ? target.start : target.start + 1;

  if (o.lineOnly !== true) {
    return { sourceFrom: source.start, sourceCount: source.count, targetAt: blockAt, targetRemove: target.count };
  }
  const own = spanOf(change, o.cursor.side);
  const k = own.count > 0 ? Math.min(Math.max(o.cursor.line - own.start, 0), own.count - 1) : 0;
  const hasSource = k < source.count;
  const hasTarget = k < target.count;
  if (hasSource && hasTarget) {
    return { sourceFrom: source.start + k, sourceCount: 1, targetAt: target.start + k, targetRemove: 1 };
  }
  if (hasSource) {
    // Past the end of the target's block: the line goes in behind it.
    const behind = target.count > 0 ? target.start + target.count : target.start + 1;
    return { sourceFrom: source.start + k, sourceCount: 1, targetAt: behind, targetRemove: 0 };
  }
  if (hasTarget) return { sourceFrom: source.start, sourceCount: 0, targetAt: target.start + k, targetRemove: 1 };
  return null;
}

/**
 * The edit that carries out `plan`, with `lines` read from the source: one operation for
 * Monaco. Inserting at the end of the document puts the break in front of the text, and
 * deleting through the last line takes the break before it, as `applyLines` does.
 */
export function mergeOperation(
  plan: MergePlan,
  lines: readonly string[],
  target: { getLineCount(): number; getLineMaxColumn(line: number): number },
): LineOperation | null {
  const count = target.getLineCount();
  const at = Math.min(Math.max(plan.targetAt, 1), count + 1);

  if (plan.targetRemove === 0) {
    if (lines.length === 0) return null;
    const text = lines.join('\n');
    if (at <= count) {
      return { range: { startLineNumber: at, startColumn: 1, endLineNumber: at, endColumn: 1 }, text: `${text}\n` };
    }
    const column = target.getLineMaxColumn(count);
    return { range: { startLineNumber: count, startColumn: column, endLineNumber: count, endColumn: column }, text: `\n${text}` };
  }

  const first = at;
  const last = Math.min(at + plan.targetRemove - 1, count);
  if (first > count) return null;
  if (lines.length > 0) {
    return {
      range: { startLineNumber: first, startColumn: 1, endLineNumber: last, endColumn: target.getLineMaxColumn(last) },
      text: lines.join('\n'),
    };
  }
  if (last < count) {
    return { range: { startLineNumber: first, startColumn: 1, endLineNumber: last + 1, endColumn: 1 }, text: '' };
  }
  if (first > 1) {
    return {
      range: {
        startLineNumber: first - 1,
        startColumn: target.getLineMaxColumn(first - 1),
        endLineNumber: last,
        endColumn: target.getLineMaxColumn(last),
      },
      text: '',
    };
  }
  return { range: { startLineNumber: 1, startColumn: 1, endLineNumber: last, endColumn: target.getLineMaxColumn(last) }, text: '' };
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export function createCompareService(deps: CompareDeps): CompareController {
  const content = writable<CompareContent | null>(null);
  const view = writable<DiffViewOptions>({ inline: false, ignoreTrimWhitespace: false });
  const mode = writable<CompareMode>('raw');
  const aligned = writable(false);
  const reviewOptions = writable<CompareOptions>({ ...COMPARE_FALLBACK });
  const info = writable<ReviewInfo | null>(null);
  const reviewView = writable<ReviewView | null>(null);
  /** M11 CODE-18: the cursor of the diff on screen is in a change (see `followCursor`). */
  const atChange = writable(true);

  // The saved options (§7.11): read on first use, because the UI state is loaded after
  // this module is created.
  let loaded = false;
  let savedReview: Record<string, Partial<CompareOptions>> = {};

  function ensureLoaded(): void {
    if (loaded) return;
    loaded = true;
    const memo = compareMemoOf(deps.memory.read());
    mode.set(memo.mode ?? 'raw');
    aligned.set(memo.aligned === true);
    // A store that is told what it holds already tells its subscribers again; a view that
    // is the same stays the same object.
    const saved = { inline: memo.inline ?? false, ignoreTrimWhitespace: memo.ignoreTrimWhitespace ?? false };
    const now = get(view);
    if (saved.inline !== now.inline || saved.ignoreTrimWhitespace !== now.ignoreTrimWhitespace) view.set(saved);
    savedReview = memo.review ?? {};
  }

  function persist(): void {
    const memo: StoredMemo = {
      mode: get(mode),
      inline: get(view).inline,
      ignoreTrimWhitespace: get(view).ignoreTrimWhitespace,
    };
    if (get(aligned)) memo.aligned = true;
    if (Object.keys(savedReview).length > 0) memo.review = savedReview;
    deps.memory.write(memo);
  }

  function fail(key: string, params?: Record<string, string | number>): false {
    deps.status.show(t(key, params), { error: true });
    return false;
  }

  /**
   * The snapshots of the sides the modal service has no index for (WX-CODE-1): a file or the
   * saved version, and an open document whose index does not answer. One entry per side, kept
   * while the text, the profile and the database stay the same; the session's end drops them.
   */
  const snapshots = new Map<string, { key: string | number; cp: CompiledProfile; codes: CodeDb; walker: SideSnapshots }>();

  function tooLarge(): false {
    return fail('compare.tooLarge', { limit: formatBytes(MODEL_SYNC_LIMIT_CHARS) });
  }

  /** Clears the session and closes the overlay if it is still ours. */
  function finish(): void {
    if (get(content) === null) return;
    content.set(null);
    snapshots.clear();
    info.set(null);
    reviewView.set(null);
    if (get(deps.layout.state).overlay === COMPARE_PANEL_ID) deps.layout.closeOverlay();
    deps.focusEditorWhenBack();
  }

  // Whoever closes the overlay closes the comparison: the ✕ in the panel header, another
  // overlay panel taking the region, or a restored layout. `finish()` clears the session
  // first, so the `closeOverlay()` it may call cannot come back around.
  deps.layout.state.subscribe((state) => {
    if (state.overlay !== COMPARE_PANEL_ID) finish();
  });

  // A comparison belongs to one document: switching tabs or closing it ends the session
  // rather than leaving a diff that no longer matches the tab bar.
  deps.docs.activeId.subscribe((id) => {
    const open = get(content);
    if (open && id !== open.docId) finish();
  });
  deps.docs.list.subscribe((list) => {
    const open = get(content);
    if (open && !list.some((doc) => doc.id === open.docId)) finish();
  });

  // -- review ---------------------------------------------------------------

  /** `{ version }` for a side that is a document, when the version is known. */
  function versionOf(docId: DocId): { version?: number } {
    const version = deps.versionOf?.(docId);
    return version === undefined ? {} : { version };
  }

  /** The modified document's side. */
  function modifiedInput(docId: DocId): ReviewInput {
    const eff = deps.effectiveOf(docId);
    return {
      lines: linesOf(deps.textOf(docId)),
      cp: eff.cp,
      machine: eff.machine,
      profileId: eff.profile.id,
      label: t('compare.labelModified'),
      codes: eff.codes,
      docId,
      ...versionOf(docId),
    };
  }

  /** The original side: a document with its own profile and machine, or a file's text. */
  function originalInput(session: CompareContent, modifiedDocId: DocId): ReviewInput {
    const label = t('compare.labelOriginal');
    const original = session.original;
    if (original.kind === 'document') {
      const eff = deps.effectiveOf(original.docId);
      return {
        lines: linesOf(deps.textOf(original.docId)),
        cp: eff.cp,
        machine: eff.machine,
        profileId: eff.profile.id,
        label,
        codes: eff.codes,
        docId: original.docId,
        ...versionOf(original.docId),
      };
    }
    if (session.source.kind === 'saved') {
      // The same file, so the same dialect and the same machine.
      const eff = deps.effectiveOf(modifiedDocId);
      return {
        lines: linesOf(original.text),
        cp: eff.cp,
        machine: eff.machine,
        profileId: eff.profile.id,
        label,
        codes: eff.codes,
        staticText: original.text,
      };
    }
    // A file that is not open as a document: its detected profile, and no machine (AD-26).
    return {
      lines: linesOf(original.text),
      cp: deps.profiles.compiled(original.languageId),
      machine: null,
      profileId: original.languageId,
      label,
      codes: deps.codesFor?.(original.languageId),
      staticText: original.text,
    };
  }

  /** The two sides as they are now, ready to normalize; null with no comparison. */
  function currentInputs(): { modified: ReviewInput; original: ReviewInput } | null {
    const session = get(content);
    if (!session) return null;
    return { modified: modifiedInput(session.docId), original: originalInput(session, session.docId) };
  }

  function buildCurrentReview(): ReviewView | null {
    const inputs = currentInputs();
    return inputs ? buildReview(inputs.modified, inputs.original, get(reviewOptions)) : null;
  }

  /**
   * Rebuilds the normalized sides when the comparison is in review mode or the aligned view
   * is showing (it needs the same normalization, and the review bar's notes).
   */
  function rebuild(): void {
    reviewView.set(get(content) !== null && (get(mode) === 'review' || get(aligned)) ? buildCurrentReview() : null);
  }

  /** The toggles of the compared document's profile: its defaults, with what the user saved. */
  function applyProfile(docId: DocId): void {
    const profile = deps.effectiveOf(docId).profile;
    const defaults = compareDefaults(profile);
    info.set({ profileId: profile.id, defaults, offered: offeredOptions(profile) });
    reviewOptions.set({ ...defaults, ...savedReview[profile.id] });
  }

  // -- open -----------------------------------------------------------------

  /** The read-only side of a file or saved-version comparison. */
  async function originalFromDisk(
    path: string,
    fallbackProfileId: string,
    detect: boolean,
  ): Promise<DiffOriginal | null> {
    // The stat runs BEFORE the read, the way `files.open` does it (fileOps.ts, G8 F4):
    // `dialogs.pickFile` has no filters, so the user can pick a disk image or a database,
    // and reading first would mean a multi-gigabyte file is already in the webview by the
    // time it is refused. `MAX_OPEN_BYTES` and `MODEL_SYNC_LIMIT_CHARS` are the same 50 MB
    // and a byte is never fewer than a UTF-16 code unit's worth of file, so this refuses
    // only what the exact check below would refuse anyway.
    const size = await deps.statSize(path);
    if (size !== null && size > MAX_OPEN_BYTES) {
      tooLarge();
      return null;
    }
    const decoded = await deps.readDisk(path);
    if (!decoded) {
      fail('compare.readFailed', { file: fileName(path) });
      return null;
    }
    if (!decoded.ok) {
      deps.status.show(t(decoded.message.key, decoded.message.params), { error: true });
      return null;
    }
    if (!withinCompareLimit(decoded.text.length)) {
      tooLarge();
      return null;
    }
    return {
      kind: 'text',
      text: decoded.text,
      languageId: detect ? deps.profiles.detect(path, decoded.text, fallbackProfileId) : fallbackProfileId,
    };
  }

  /** The newest `open()`: an older one that is still reading gives way (CODE-10). */
  let openSeq = 0;

  async function open(docId: DocId, source: CompareSource): Promise<boolean> {
    const mine = ++openSeq;
    const doc = deps.docs.get(docId);
    if (!doc) return fail('compare.noDocument');
    if (!withinCompareLimit(deps.charCountOf(docId))) return tooLarge();

    let original: DiffOriginal | null;
    let other: string;

    if (source.kind === 'document') {
      if (source.docId === docId) return fail('compare.sameDocument');
      const target = deps.docs.get(source.docId);
      if (!target) return fail('compare.noDocument');
      if (!withinCompareLimit(deps.charCountOf(source.docId))) return tooLarge();
      original = { kind: 'document', docId: source.docId };
      other = target.title;
    } else if (source.kind === 'saved') {
      if (doc.path === null) return fail('compare.untitled');
      original = await originalFromDisk(doc.path, doc.profileId, false);
      other = fileName(doc.path);
    } else {
      original = await originalFromDisk(source.path, doc.profileId, true);
      other = fileName(source.path);
    }
    if (!original) return false;
    // The read took time: the tab may be gone, or a newer open may have started.
    if (mine !== openSeq) return false;
    if (!deps.docs.get(docId)) return fail('compare.noDocument');

    // The modified side is the document on screen, so it has to be the active tab.
    if (deps.docs.getActiveId() !== docId) deps.docs.activate(docId);

    ensureLoaded();
    // A new comparison: nothing is known about its cursor yet (M11 CODE-18).
    atChange.set(true);
    snapshots.clear();
    content.set({ docId, source, title: compareTitle(doc.title, source, other), original });
    applyProfile(docId);
    rebuild();
    deps.layout.openOverlay(COMPARE_PANEL_ID);
    return true;
  }

  // -- the toolbar ----------------------------------------------------------

  function setMode(m: CompareMode): void {
    ensureLoaded();
    // Choosing Raw or Review leaves the aligned view, even for the mode that is already set.
    const wasAligned = get(aligned);
    if (get(mode) === m && !wasAligned) return;
    aligned.set(false);
    mode.set(m);
    persist();
    rebuild();
  }

  function setAligned(on: boolean): void {
    ensureLoaded();
    if (get(aligned) === on) return;
    aligned.set(on);
    persist();
    rebuild();
  }

  function setOptions(patch: Partial<CompareOptions>): void {
    ensureLoaded();
    reviewOptions.update((o) => ({ ...o, ...patch }));
    const known = get(info);
    if (known) {
      const changed = changedToggles(get(reviewOptions), known.defaults);
      if (Object.keys(changed).length > 0) savedReview = { ...savedReview, [known.profileId]: changed };
      else delete savedReview[known.profileId];
      persist();
    }
    rebuild();
  }

  function resetOptions(): void {
    ensureLoaded();
    const known = get(info);
    if (!known) return;
    delete savedReview[known.profileId];
    reviewOptions.set({ ...known.defaults });
    persist();
    rebuild();
  }

  function setView(patch: Partial<DiffViewOptions>): void {
    ensureLoaded();
    const before = get(view);
    const next = { ...before, ...patch };
    if (next.inline === before.inline && next.ignoreTrimWhitespace === before.ignoreTrimWhitespace) return;
    view.set(next);
    persist();
  }

  // -- copy -----------------------------------------------------------------

  /** The document a copy in `direction` writes, or null when the original is not one. */
  function targetDoc(direction: CopyDirection): DocId | null {
    const session = get(content);
    if (!session) return null;
    if (direction === 'toModified') return session.docId;
    return session.original.kind === 'document' ? session.original.docId : null;
  }

  function blockOf(direction: CopyDirection): CopyBlock | null {
    const session = get(content);
    const target = targetDoc(direction);
    return copyBlocker(direction, {
      // The aligned view shows the programs as written, so it copies like the raw view.
      mode: get(aligned) ? 'raw' : get(mode),
      originalIsDocument: session?.original.kind === 'document',
      targetLocked: target !== null && deps.docs.get(target)?.readOnly === true,
    });
  }

  // M11 CODE-18: whether the cursor of the diff on screen is in a change. Unknown (no diff, or
  // one that is being worked out again after an edit) keeps the last answer, so the buttons do
  // not flicker while typing; a click on a button that is offered by mistake still says why.
  function followCursor(): void {
    const handle = deps.diff();
    if (!handle || get(content) === null || !handle.isCurrent()) return;
    const changes = handle.lineChanges();
    const cursor = handle.cursor();
    if (!changes || !cursor) return;
    const yes = changeAtCursor(changes, cursor) !== null;
    if (yes !== get(atChange)) atChange.set(yes);
  }
  deps.watchDiff?.(followCursor);

  const copyBlock = derived([content, mode, aligned, deps.docs.list, atChange], ([, , , , here]) => ({
    toModified: blockOf('toModified') ?? (here ? null : 'noChange'),
    toOriginal: blockOf('toOriginal') ?? (here ? null : 'noChange'),
  }));

  // -- modes at the place of a copy (review NC-6) ------------------------------

  /** The snapshots of a side, or null when its text is not known to stay put (no version, no fixed text). */
  function snapshotsOf(input: ReviewInput): SideSnapshots | null {
    if (input.codes === undefined) return null;
    const slot = input.docId !== undefined ? `doc:${input.docId}` : 'static';
    const key = input.docId !== undefined ? input.version : input.staticText;
    if (key === undefined) return null;
    const held = snapshots.get(slot);
    if (held && held.key === key && held.cp === input.cp && held.codes === input.codes) return held.walker;
    const walker = new SideSnapshots(input.lines, input.cp, input.codes);
    snapshots.set(slot, { key, cp: input.cp, codes: input.codes, walker });
    return walker;
  }

  /** The modal state in front of `line` of a side (after the line above it); null when it cannot be read. */
  function stateBefore(input: ReviewInput, line: number): ModalState | null {
    if (!input.codes) return null;
    const above = Math.max(0, Math.floor(line) - 1);
    if (input.docId !== undefined) {
      const indexed = deps.modalStateAfter?.(input.docId, above) ?? null;
      if (indexed) return indexed;
    }
    return modalStateAfterLine(input.lines, input.cp, input.codes, above, snapshotFor(input, above));
  }

  /**
   * A snapshot at or before `line` of a side, for the walk to the place of a copy to start from:
   * the modal service's for an open document, else the side's own (`SideSnapshots`); undefined:
   * walk from the top.
   */
  function snapshotFor(input: ReviewInput, line: number): ModalSnapshot | undefined {
    if (input.codes === undefined) return undefined;
    if (input.docId !== undefined) {
      const indexed = deps.modalSnapshotAt?.(input.docId, line, { version: input.version, cp: input.cp, db: input.codes }) ?? undefined;
      if (indexed !== undefined) return indexed;
    }
    return snapshotsOf(input)?.at(line);
  }

  /**
   * The text of line `n` of a side with its comments blanked, for the work offset's P
   * (`copyModes`); with `edit`, the lines from `edit.first` on are the inserted ones.
   */
  function lineTextOf(input: ReviewInput, edit?: { first: number; inserted: readonly string[] }): (n: number) => string | undefined {
    return (n) => {
      const text = edit !== undefined && n >= edit.first ? edit.inserted[n - edit.first] : input.lines[n - 1];
      return text === undefined ? undefined : maskComments(text, input.cp);
    };
  }

  /** `read()`, or `fallback` when it throws: a warning that cannot be worked out never stands in the way of the copy. */
  function orElse<T>(read: () => T, fallback: T): T {
    try {
      return read();
    } catch (err) {
      console.warn('compare: the modes at the copy could not be read', err);
      return fallback;
    }
  }

  /**
   * The warning for a copy in `direction` that replaces the `edit.remove` target lines from
   * `edit.at` on with `edit.inserted`, read from line `sourceLine` of its side (0: nothing is
   * read there, as for a removal), or null when it changes nothing about the modes (or a side's
   * modes cannot be read). Two checks make one message:
   *
   *  - **front** (review NC-6): the modes in front of the copied text on the source side and in
   *    front of the place on the target side, when text is copied;
   *  - **end** (the owner, 2026-10-20): the modes the target's line below the copy ran in
   *    before it and runs in after it, when a line with text follows the copy.
   *
   * Read before the copy changes the text.
   */
  function modeWarning(
    direction: CopyDirection,
    sourceLine: number,
    edit: { at: number; remove: number; inserted: readonly string[] },
  ): string | null {
    const inputs = currentInputs();
    if (!inputs) return null;
    const toModified = direction === 'toModified';
    const targetInput = toModified ? inputs.modified : inputs.original;
    const front =
      sourceLine > 0 && edit.inserted.length > 0
        ? orElse(() => {
            const sourceInput = toModified ? inputs.original : inputs.modified;
            const source = copyModes(stateBefore(sourceInput, sourceLine), lineTextOf(sourceInput));
            const target = copyModes(stateBefore(targetInput, edit.at), lineTextOf(targetInput));
            return modeDifferences(source, target);
          }, [])
        : [];
    const codes = targetInput.codes;
    const end =
      codes !== undefined && hasTextBelow(targetInput.lines, Math.max(edit.at - 1, 0) + Math.max(edit.remove, 0))
        ? orElse(() => {
            const first = Math.min(Math.max(Math.floor(edit.at), 1), targetInput.lines.length + 1);
            const states = modalStatesAroundEdit(
              targetInput.lines,
              targetInput.cp,
              codes,
              edit.at,
              edit.remove,
              edit.inserted,
              snapshotFor(targetInput, first - 1),
            );
            return modeChanges(
              copyModes(states.before, lineTextOf(targetInput)),
              copyModes(states.after, lineTextOf(targetInput, { first, inserted: edit.inserted })),
            );
          }, [])
        : [];
    // A label of null is a mode that side does not know (the owner, 2026-10-22).
    const named = (kind: CopyModeKind, label: string | null, form: 'front' | 'end'): string => {
      if (label !== null) return label;
      const mode = t(MODE_KIND_KEYS[kind]);
      return t(form === 'front' ? 'compare.modeNotKnown' : 'compare.modeWasUnknown', { mode });
    };
    const sides = {
      original: front.map((d) => named(d.kind, toModified ? d.source : d.target, 'front')).join(', '),
      modified: front.map((d) => named(d.kind, toModified ? d.target : d.source, 'front')).join(', '),
    };
    const change = {
      before: end.map((d) => named(d.kind, d.before, 'end')).join(', '),
      after: end.map((d) => named(d.kind, d.after, 'end')).join(', '),
    };
    if (front.length > 0 && end.length > 0) return t('compare.modesDifferAndChange', { ...sides, ...change });
    if (front.length > 0) return t('compare.modesDiffer', sides);
    if (end.length > 0) return t('compare.modesChangeBelow', change);
    return null;
  }

  async function copyChange(
    direction: CopyDirection,
    o?: { lineOnly?: boolean; thenNext?: boolean },
  ): Promise<boolean> {
    if (get(content) === null) return fail('compare.noDocument');
    const blocked = blockOf(direction);
    if (blocked === 'review') return fail('compare.copyReview');
    if (blocked === 'notDocument') return fail('compare.copyNotDocument');
    if (blocked === 'locked') return fail('compare.copyLocked');

    const handle = deps.diff();
    // CODE-1: Monaco serves the old blocks until it has recomputed after an edit, and a
    // copy planned from them (a held key, a double click) would insert twice or delete
    // lines that are not part of the change.
    if (handle && !handle.isCurrent()) return fail('compare.copyBusy');
    const changes = handle?.lineChanges() ?? null;
    const cursor = handle?.cursor() ?? null;
    if (!handle || !changes || !cursor) return fail('compare.copyNoChange');
    const change = changeAtCursor(changes, cursor);
    if (!change) return fail('compare.copyNoChange');
    // The aligned view pairs lines by rows (a comment the options drop does not count), so
    // a one-line copy asks it for the plan; a block copy is the same in every view.
    const plan =
      o?.lineOnly === true && isAlignedHandle(handle)
        ? handle.planCopy(change, direction, cursor)
        : mergePlan(change, direction, { lineOnly: o?.lineOnly, cursor });
    if (!plan) return fail('compare.copyNoChange');

    const from = handle.model(direction === 'toModified' ? 'original' : 'modified');
    const to = handle.model(direction === 'toModified' ? 'modified' : 'original');
    if (!from || !to) return fail('compare.copyNoChange');
    const lines: string[] = [];
    for (let line = plan.sourceFrom; line < plan.sourceFrom + plan.sourceCount; line++) {
      lines.push(from.getLineContent(line));
    }
    const operation = mergeOperation(plan, lines, to);
    if (!operation) return fail('compare.copyNoChange');
    // Review NC-6: read before the text changes. A removal carries no text to read in front,
    // but it can change the modes of the lines below it (the owner, 2026-10-20).
    const count = to.getLineCount();
    const at = Math.min(Math.max(plan.targetAt, 1), count + 1);
    const warning = modeWarning(direction, lines.length > 0 ? plan.sourceFrom : 0, {
      at,
      remove: Math.min(plan.targetRemove, count - at + 1),
      inserted: lines,
    });

    // One undo step: the edit sits between two stack elements, so it neither merges into
    // what the user typed before nor into what they type next.
    to.pushStackElement();
    to.pushEditOperations(null, [operation], () => null);
    to.pushStackElement();
    if (warning !== null) deps.status.show(warning, { error: true });
    // The aligned view has two real editors: the target takes the focus, so Cmd+Z undoes this.
    if (isAlignedHandle(handle)) handle.focusSide(direction === 'toModified' ? 'modified' : 'original');

    if (o?.thenNext === true) {
      // The modified pane's cursor is where "next" starts from: behind the block just
      // dealt with, so the next change is the next one and not this one again.
      const modified = spanOf(change, 'modified');
      const line =
        direction === 'toModified'
          ? Math.max(plan.targetAt + lines.length - 1, 1)
          : modified.count > 0
            ? modified.start + modified.count - 1
            : modified.start;
      handle.reveal('modified', line);
      handle.nextWhenUpdated();
    }
    return true;
  }

  // -- the aligned view -------------------------------------------------------

  /**
   * The alignment of the two texts under the toggles in force (`CompareController.align`).
   * The normalization is the review bar's (`reuse` takes the one already built; otherwise it
   * is built from the texts as they are now and the bar's notes follow it); the diff, the
   * rows and the word reader are `core/compare/aligned.ts`.
   */
  function align(o: { reuse?: boolean } = {}): AlignedResult | null {
    const inputs = currentInputs();
    if (!inputs) return null;
    let review = o.reuse === true ? get(reviewView) : null;
    if (review === null) {
      review = buildReview(inputs.modified, inputs.original, get(reviewOptions));
      reviewView.set(review);
    }
    const asInput = (side: ReviewSide, lines: readonly string[]) => ({
      lineCount: lines.length,
      normalized: reviewLines(side),
      lineMap: side.lineMap,
    });
    const diff = alignSides(asInput(review.original, inputs.original.lines), asInput(review.modified, inputs.modified.lines));
    const over = sharedOverrides(inputs.modified, inputs.original);
    const wordSide = (input: ReviewInput) => ({
      cp: input.cp,
      ctx: prepareNormalize(input.lines, input.cp, input.machine, over),
      lines: input.lines,
    });
    return { diff, reader: makePairReader(wordSide(inputs.original), wordSide(inputs.modified), get(reviewOptions)) };
  }

  async function copyWord(direction: CopyDirection): Promise<boolean> {
    if (get(content) === null) return fail('compare.noDocument');
    const blocked = blockOf(direction);
    if (blocked === 'notDocument') return fail('compare.copyNotDocument');
    if (blocked === 'locked') return fail('compare.copyLocked');
    const handle = deps.diff();
    if (!isAlignedHandle(handle)) return fail('compare.wordNeedsAligned');
    if (!handle.isCurrent()) return fail('compare.copyBusy');
    const result = handle.result();
    const cursor = handle.cursorAt();
    const original = handle.model('original');
    const modified = handle.model('modified');
    if (!result || !cursor || !original || !modified) return fail('compare.copyNoChange');

    const plan = wordMergePlan(result.diff, result.reader, cursor, direction, {
      original: (line) => original.getLineContent(line),
      modified: (line) => modified.getLineContent(line),
    });
    if (typeof plan === 'string') {
      const refusals = { noWord: 'compare.wordNoWord', noPair: 'compare.wordNoPair', moved: 'compare.wordMoved', joins: 'compare.wordJoins' } as const;
      return fail(refusals[plan]);
    }
    const to = handle.model(plan.target);
    if (!to) return fail('compare.copyNoChange');
    const { edit } = plan;
    // Review NC-6: the modes in front of the two lines, and those of the lines below the edited
    // one (a copied or removed G91), read before the text changes.
    const row = rowOf(result.diff, cursor.side, cursor.line)?.row;
    const sourceLine = row ? row[direction === 'toModified' ? 0 : 1] : 0;
    const before = to.getLineContent(edit.line);
    const written = before.slice(0, edit.startColumn - 1) + edit.text + before.slice(edit.endColumn - 1);
    const warning = modeWarning(direction, edit.text !== '' ? sourceLine : 0, { at: edit.line, remove: 1, inserted: [written] });
    to.pushStackElement();
    to.pushEditOperations(
      null,
      [{ range: { startLineNumber: edit.line, startColumn: edit.startColumn, endLineNumber: edit.line, endColumn: edit.endColumn }, text: edit.text }],
      () => null,
    );
    to.pushStackElement();
    if (warning !== null) deps.status.show(warning, { error: true });
    handle.focusSide(plan.target);
    return true;
  }

  // -- export ---------------------------------------------------------------

  async function exportDiff(o: { normalized: boolean }): Promise<DocId | null> {
    const session = get(content);
    const doc = session ? deps.docs.get(session.docId) : undefined;
    if (!session || !doc) {
      fail('compare.noDocument');
      return null;
    }

    const originalName =
      session.original.kind === 'document'
        ? (deps.docs.get(session.original.docId)?.title ?? session.title)
        : session.source.kind === 'saved'
          ? t('compare.sideSaved', { name: doc.title })
          : fileName(session.source.kind === 'file' ? session.source.path : doc.title);

    let originalLines: string[];
    let modifiedLines: string[];
    if (o.normalized) {
      const built = get(reviewView) ?? buildCurrentReview();
      if (!built) return null;
      originalLines = reviewLines(built.original);
      modifiedLines = reviewLines(built.modified);
    } else {
      modifiedLines = linesOf(deps.textOf(session.docId));
      originalLines =
        session.original.kind === 'document' ? linesOf(deps.textOf(session.original.docId)) : linesOf(session.original.text);
    }

    const text = unifiedDiff({ name: originalName, lines: originalLines }, { name: doc.title, lines: modifiedLines });
    if (text === '') {
      deps.status.show(t('compare.noDifferences'));
      return null;
    }
    // The new tab takes the editor's place, so the comparison ends first. The compared
    // document gets its own view state back from the editor service when it is activated
    // again (the group saved it when the editor was unmounted).
    const id = deps.files.newUntitled({ profileId: doc.profileId, text, activate: false });
    finish();
    deps.docs.activate(id);
    return id;
  }

  // -- two files ------------------------------------------------------------

  async function openFiles(a?: string, b?: string): Promise<boolean> {
    const original = a ?? (await deps.pickFile(t('compare.pickOriginalTitle')));
    if (!original) return false;
    const modified = b ?? (await deps.pickFile(t('compare.pickModifiedTitle')));
    if (!modified) return false;
    if (original === modified) return fail('compare.sameFile');

    // `files.open` shows its own refusal (binary, too large) and answers the ones it opened.
    const opened = await deps.files.open([original, modified]);
    if (opened.length < 2) return false;
    return open(opened[1], { kind: 'document', docId: opened[0] });
  }

  // -- go to line -----------------------------------------------------------

  function goToLine(line: number, side: 'original' | 'modified' = 'modified'): boolean {
    const handle = deps.diff();
    if (!handle || get(content) === null) return false;
    if (!Number.isInteger(line) || line < 1) return fail('compare.noSuchLine');
    // The aligned view shows the files as written: a line is the file's line.
    const review = get(aligned) ? null : get(reviewView);
    if (review === null) {
      handle.reveal(side, line);
      return true;
    }
    const target = reviewLineOf(review[side].lineMap, line);
    if (target === null) return fail('compare.noSuchLine');
    handle.reveal(side, target);
    return true;
  }

  const sides = derived([content, reviewView, aligned], ([session, review, isAligned]): DiffSides | null => {
    if (!session) return null;
    if (review && !isAligned) {
      return {
        original: { kind: 'text', text: review.original.text, languageId: review.original.languageId },
        modified: { kind: 'text', text: review.modified.text, languageId: review.modified.languageId },
      };
    }
    return { original: session.original, modified: { kind: 'document', docId: session.docId } };
  });

  return {
    session: derived(content, (c) =>
      c === null ? null : { docId: c.docId, source: c.source, title: c.title },
    ),
    open,
    close: () => finish(),

    mode: derived(mode, (m) => m),
    setMode,
    options: derived(reviewOptions, (o) => o),
    setOptions,
    copyChange,
    exportDiff,
    openFiles,

    content: derived(content, (c) => c),
    view: derived(view, (o) => o),
    sides,
    aligned: derived(aligned, (a) => a),
    setAligned,
    toggleAligned(): void {
      setAligned(!get(aligned));
    },
    align,
    copyWord,
    review: derived(reviewView, (r) => r),
    reviewInfo: derived(info, (i) => i),
    copyBlock,
    setInline(inline: boolean): void {
      setView({ inline });
    },
    setIgnoreTrimWhitespace(ignore: boolean): void {
      setView({ ignoreTrimWhitespace: ignore });
    },
    toggleInline(): void {
      setView({ inline: !get(view).inline });
    },
    toggleMode(): void {
      setMode(get(mode) === 'review' ? 'raw' : 'review');
    },
    resetOptions,
    goToLine,
  };
}

/** The application-wide compare service. */
export const compareController: CompareController = createCompareService({
  docs: appDocs,
  layout: appLayout,
  status: appStatus,
  profiles: appProfiles,
  files: appFiles,
  readDisk: (path) => appFiles.readDisk(path),
  async statSize(path) {
    if (!isTauriRuntime()) return null;
    try {
      const [stat] = await filesStat([path]);
      return stat?.allowed === true && stat.exists ? stat.size : null;
    } catch (err) {
      // A stat decides nothing on its own: the read that follows reports the real problem.
      console.warn('files_stat failed', err);
      return null;
    }
  },
  charCountOf: modelCharCount,
  textOf: (docId) => appEditor.getText(docId),
  effectiveOf: (docId) => appMachines.effective(docId),
  pickFile: async (title) => (await appDialogs.exclusive(() => appDialogs.pickFile({ title }))) ?? null,
  diff: currentDiff,
  watchDiff: watchCurrentDiff,
  modalStateAfter: (docId, line) => appModal.stateAfter(docId, line),
  modalSnapshotAt: (docId, line, expect) => appModal.snapshotAt(docId, line, expect),
  versionOf: (docId) => appEditor.versionId(docId),
  codesFor: (profileId) => appCodes.forProfile(profileId),
  memory: {
    read: () => appUiState.getLastParams(COMPARE_MEMO_KEY),
    write: (memo) => appUiState.setLastParams(COMPARE_MEMO_KEY, memo as Record<string, unknown>),
  },
  focusEditorWhenBack() {
    // The editors are built again a moment after the overlay closes (`attachGroup`); the first
    // one that ends up with the text focus ends the wait, and nothing waits for ever.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const listener = appEditor.onDidAttach(() => {
      appEditor.focus();
      if (appEditor.hasFocus()) stop();
    });
    function stop(): void {
      listener();
      clearTimeout(timer);
    }
    timer = setTimeout(stop, 2000);
  },
});

/** The §7.3 view of the same object. */
export const compare: CompareService = compareController;
