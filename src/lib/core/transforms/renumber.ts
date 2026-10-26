// Renumber blocks (plan §5 WP4.2 and WP6.3, `docs/planning/nc-transformations.md`).
// Owner: **WP6.3** (was WP4.2).
//
// Rewrites the block number at the start of each block **and the references that point at
// it** (M6). What it must never do:
//
//  - touch a number that is not a block number: `N` inside a comment (`(N50)`), inside a
//    string, or as an address in the middle of a block
//  - lose the block-skip mark: `/N100 G0` keeps its `/`, and `N120/` keeps the `/` where
//    it stood
//  - renumber an alphanumeric block name (`NLAP1`) — it is a label, not a counter. A jump
//    label whose own name starts with the prefix letter (Sinumerik `NEXT_PECK:`) is no
//    block name, and its block is numbered like any other (`N10 NEXT_PECK:`)
//  - number a program marker: `%`, `O1000` and `:1000` are not blocks, and `N10 :1000`
//    moves the program number out of the first position of the block
//  - turn a **main block** into an ordinary one. Where the dialect has main blocks
//    (`syntax.blockNumber.mainPrefix`, Sinumerik `:20`), `:20` is renumbered as `:30` and
//    never as `N30`: a main block is where a block search may start the program (it has
//    to carry everything the machining from there on needs), and a jump names it by its
//    own prefix (`GOTOF :20`) and not by `N20` (M9, WP9.5b; see "Main blocks" below)
//  - **guess** at a reference. `GOTO 100`, `M98 Q100` and `G71 P100 Q200` are rewritten
//    only where the run can prove which block they name: one block with that number, in
//    the program the value names a block of (§6.6 rule 10, `programs.ts`), inside the
//    lines this run rewrites, under a rule that allows it
//    (`numbering.references[].rewrite`, §7.1). Everything else is reported and left
//    exactly as it is — a jump target written wrongly is worse than one left behind,
//    because the program still runs and lands in the wrong place. The scan is over the
//    whole document (`references.ts`), not over the selection: a jump *above* the
//    selection points into it just as well. On a control whose sequence numbers are
//    names (Okuma) a reference names the block written exactly like it, and it is
//    rewritten with exactly the text that block receives (`references.ts`, "Numbers or
//    names").
//  - wrap past the maximum in silence: wrapping writes a second `N10` into the program,
//    and duplicate block numbers are a defect, not a formatting choice. `stop` warned
//    from the start; `wrap` warns now too (G8 M4). And it rewrites **no** reference whose
//    new value the run itself made ambiguous: a control takes the first block that
//    matches, so a value that names several blocks is not an answer (G8 M6). The
//    preflight bounds that question before the run and asks about it (`mayWrap`).
//
// Nor does it read a selection as if it were the start of the document: the state going
// into `lines[0]` comes from `fragment.ts`, so a Klartext selection that begins inside a
// `~` block knows that its first lines are a continuation tail.
//
// Options (defaults from `profile.numbering`): `start`, `step`, `digits`, `max` with
// `onOverflow` wrap or stop, `spacesAfter`, `skipStartingWith`, `skipEmpty`,
// `restartAtProgramStart`, `onlyNumbered`, `altPrefixes`, and since P4d (plan §6.6 rules
// 1–7) `fitToMax`, `alignColumn`, `everyNth`, `skipContaining`, `skipFirst`, `skipLast`,
// `startTrigger` and `startAfterTrigger` (see "The advanced options" below).
//
// Klartext (`numbering.mode === 'consecutive'`) has no options form at all: the control
// requires consecutive numbers from 0, and a continuation line (the tail of a `~` block)
// is not a block and gets none.
//
// ## How the line is taken apart
//
// Every line goes through `tokenizeLine`, never through a regex (types.ts, rule 1). The
// head of a block is at most four things, and the tokenizer is what decides which is
// which:
//
//     ␣␣  /1   N100   ␣ /   G0 X10 (SEE N50)
//     │    │     │      │    └── rest: copied through, untouched
//     │    │     │      └────── skip mark after the number (`blockSkip.position`)
//     │    │     └───────────── the block number, prefix included
//     │    └─────────────────── skip mark before the number
//     └──────────────────────── leading whitespace, kept exactly
//
// Only the block number is rewritten. The gaps inside the head are copied verbatim, so
// `N100 /G0` keeps its space and `N120/G0` keeps its lack of one. `spacesAfter` sets the
// one gap between the head and the code — and only when no skip mark follows the number,
// because `/` binds to the block it skips (`5 /L X+0` stays `5 /L X+0`).
//
// ## What is not rewritten
//
// A line is left exactly as it was when it is a Klartext continuation line, when it is
// empty and `skipEmpty` is set, when it starts with one of `skipStartingWith`, when it
// continues the block above by its leading mark (`syntax.continuationStart`, Okuma `$`), when it
// carries a block *name* instead of a number, when `onlyNumbered` is set and it has no
// number, and once numbering has stopped at `max`. P4d adds the lines of `skipFirst` and
// `skipLast`, the lines above the start trigger and the lines that contain one of
// `skipContaining`; the order in which these questions are asked is fixed (§6.6 rule 7,
// [`walkLines`]). "Left as it was" is about the block number: a reference on such a line
// still follows its block, as it always has on a line of `skipStartingWith`.
//
// `skipStartingWith` reads the line as it is written, behind its indentation and nothing
// else: `(HEADER)` starts with `(` and is skipped, while `/(HEADER)` starts with `/` and
// is a block that gets a number. The list is a text match the user can predict, and a
// user who wants the skipped blocks left alone writes `/` in it.
//
// The trailing empty element of the line array — the one a final newline produces — is
// never numbered either: writing into it would turn the document's final newline into
// content, and the trailing state is not this transform's (types.ts, rule 5).
//
// Skipped lines are reported to the results panel, capped at `SKIP_LIMIT` entries: a
// 300k-line program must not allocate one object per line just to say "not numbered".

import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { compileProfile } from '$lib/core/profiles/compile';
import { t } from '$lib/i18n';
import { continuationRisk, stateBefore } from './fragment';
import { mainKeyOf, mainPrefixOf, mainReferencesOn, maskedOf, referencePreflight, scanProgram } from './references';
import { indexPrograms, possibleProgramsOf, targetProgramOf } from './programs';

export { mainKeyOf, mainPrefixOf } from './references';
import type { Located, Msg } from '$lib/app/types';
import type { FieldSpec } from '$lib/core/forms/types';
import type { LineState, NcToken } from '$lib/core/nc/types';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import type { BlockKey, FoundReference, NumberSite, ProgramScan, ReferenceWord } from './references';
import type { ProgramIndex, RenumberedProgram, RenumberOutcome, TargetRefusal } from './programs';
import type { TransformContext, TransformDef, TransformResult } from './types';

/** Rows the results panel gets at most; the summary still counts every skipped line. */
const SKIP_LIMIT = 200;

const TAB = 0x09;
const SPACE = 0x20;

/** P4d (§6.6 rules 2–6): the bounds of the advanced options, the same as the profile validator's. */
const MAX_ALIGN_COLUMN = 120;
const MAX_EVERY_NTH = 1000;
const MAX_SKIP_LINES = 1_000_000;
const MAX_SKIP_TEXT = 200;

function isSpaceCode(code: number): boolean {
  return code === SPACE || code === TAB;
}

function isLetterCode(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function upperCode(code: number): number {
  return code >= 0x61 && code <= 0x7a ? code - 32 : code;
}

/** `line.startsWith(literal, at)`, honouring the profile's case rule. */
function matchesAt(line: string, at: number, literal: string, caseSensitive: boolean): boolean {
  if (literal === '' || at + literal.length > line.length) return false;
  for (let i = 0; i < literal.length; i++) {
    const a = line.charCodeAt(at + i);
    const b = literal.charCodeAt(i);
    if (a === b) continue;
    if (caseSensitive || upperCode(a) !== upperCode(b)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** The run's settings: the form values where they are usable, the profile where they are not. */
interface Settings {
  /** Klartext: every block, step 1, no form (`numbering.mode`). */
  consecutive: boolean;
  /** The caller asked for more digits than the dialect allows, and was held to them. */
  digitsLimited: boolean;
  /** The caller asked for a higher maximum (or none) than the dialect allows. */
  maxLimited: boolean;
  start: number;
  step: number;
  digits: number;
  max: number | null;
  /** `onOverflow`: true wraps to `start`, false stops and warns. */
  wrap: boolean;
  spacesAfter: number;
  skipStartingWith: string[];
  skipEmpty: boolean;
  restartAtProgramStart: boolean;
  onlyNumbered: boolean;
  /** Prefixes that also count as an existing block number; new numbers keep the profile's. */
  altPrefixes: string[];
  /** P4d (§6.6 rule 1): the largest whole step that keeps the last number at or below `max`. */
  fitToMax: boolean;
  /** P4d (§6.6 rule 2): the column the code behind a written number starts at; 0 = off. */
  alignColumn: number;
  /** P4d (§6.6 rule 3): number every Nth block, the ones between lose their number; 1 = every block. */
  everyNth: number;
  /** P4d (§6.6 rule 4): a line containing one of these texts keeps its text. */
  skipContaining: string[];
  /** P4d (§6.6 rule 5): lines at the start and the end of the scope that keep their text. */
  skipFirst: number;
  skipLast: number;
  /** P4d (§6.6 rule 6): numbering starts at the first line containing this text; '' = off. */
  startTrigger: string;
  startAfterTrigger: boolean;
}

/**
 * A whole number from a form value.
 *
 * `validateFields` never corrects, so a field the user left empty arrives as `undefined`
 * or `''` and has to fall back here. A caller that skips the form (`skipForm`) passes
 * nothing at all, and lands on the profile's value the same way.
 */
function intOf(value: unknown, fallback: number, min: number): number {
  if (value === undefined || value === null || value === '') return Math.max(min, fallback);
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(n) ? Math.max(min, Math.trunc(n)) : Math.max(min, fallback);
}

/** [`intOf`], held to `max` as well: a caller that skips the form is held to the form's bounds. */
function boundedOf(value: unknown, fallback: number, min: number, max: number): number {
  return Math.min(max, intOf(value, fallback, min));
}

/** A one-line text field; surrounding blanks are not part of it (the form stores it trimmed). */
function textOf(value: unknown, fallback: string | undefined): string {
  if (typeof value === 'string') return value.trim();
  return (fallback ?? '').trim();
}

function boolOf(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** An empty `max` field is "no maximum", which is not the same as "not filled in". */
function maxOf(value: unknown, fallback: number | null): number | null {
  if (value === undefined) return fallback;
  if (value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : null;
}

/** A space-separated list field. An empty string is an empty list, not a missing value. */
function wordsOf(value: unknown, fallback: string[]): string[] {
  if (typeof value === 'string') return value.split(/\s+/).filter((word) => word !== '');
  if (Array.isArray(value)) return value.filter((word): word is string => typeof word === 'string' && word !== '');
  return [...fallback];
}

/**
 * The highest block number the control accepts and how many digits it has, or null when
 * the dialect has no hard limit. Padding past that width writes a block number the
 * control reads as too long (`N00010` on a 9999 control).
 *
 * The schema has no field for "hard limit" (§7.1), so the profile says it the way it
 * already can: a `max` with `onOverflow: 'stop'` (Okuma, 9999) is the control's limit. A
 * `max` with `wrap` (Fanuc, Sinumerik) is only where the counter starts over, and a user
 * may raise it or clear it for a control with a longer number.
 */
function profileLimit(cp: CompiledProfile): { max: number; digits: number } | null {
  const { max, onOverflow } = cp.profile.numbering;
  if (onOverflow !== 'stop' || max === undefined || !Number.isFinite(max) || max < 1) return null;
  const whole = Math.trunc(max);
  return { max: whole, digits: String(whole).length };
}

function settingsFor(cp: CompiledProfile, options: Record<string, unknown>): Settings {
  const numbering = cp.profile.numbering;
  const separated = cp.profile.syntax.wordSeparatorRequired === true;
  // A dialect that separates its words needs at least one space behind the number, or
  // `5 L X+0` would come back as `5L X+0` and stop being a move.
  const minSpaces = separated ? 1 : 0;

  if (numbering.mode === 'consecutive') {
    return {
      consecutive: true,
      digitsLimited: false,
      maxLimited: false,
      start: Math.max(0, Math.trunc(numbering.start ?? 0)),
      step: 1,
      digits: 0,
      max: null,
      wrap: false,
      spacesAfter: intOf(numbering.spacesAfter, 1, Math.max(1, minSpaces)),
      skipStartingWith: [],
      skipEmpty: true,
      restartAtProgramStart: false,
      onlyNumbered: false,
      altPrefixes: [],
      // The consecutive dialect has no options (§6.6 rule 7), whatever the profile or a
      // headless caller says.
      fitToMax: false,
      alignColumn: 0,
      everyNth: 1,
      skipContaining: [],
      skipFirst: 0,
      skipLast: 0,
      startTrigger: '',
      startAfterTrigger: false,
    };
  }

  // A caller that skips the form (a script, a headless run) is held to the same limit
  // the form enforces, and told which of its answers was cut down (`digitsLimited`,
  // `maxLimited`).
  const limit = profileLimit(cp);
  const digits = intOf(options.digits, numbering.digits ?? 0, 0);
  const max = maxOf(options.max, numbering.max ?? null);
  const digitsOver = limit !== null && digits > limit.digits;
  const maxOver = limit !== null && (max === null || max > limit.max);

  return {
    consecutive: false,
    digitsLimited: digitsOver,
    maxLimited: maxOver,
    start: intOf(options.start, numbering.start ?? 10, 0),
    step: intOf(options.step, numbering.step ?? 10, 1),
    digits: digitsOver ? limit.digits : digits,
    max: maxOver ? limit.max : max,
    wrap: options.onOverflow === undefined ? (numbering.onOverflow ?? 'wrap') === 'wrap' : options.onOverflow === 'wrap',
    spacesAfter: intOf(options.spacesAfter, numbering.spacesAfter ?? 1, minSpaces),
    skipStartingWith: wordsOf(options.skipStartingWith, numbering.skipStartingWith ?? []),
    skipEmpty: boolOf(options.skipEmpty, numbering.skipEmpty === true),
    restartAtProgramStart: boolOf(options.restartAtProgramStart, numbering.restartAtProgramStart === true),
    onlyNumbered: boolOf(options.onlyNumbered, numbering.onlyNumbered === true),
    altPrefixes: wordsOf(options.altPrefixes, cp.profile.syntax.blockNumber.altPrefixes ?? []),
    fitToMax: boolOf(options.fitToMax, numbering.fitToMax === true),
    alignColumn: boundedOf(options.alignColumn, numbering.alignColumn ?? 0, 0, MAX_ALIGN_COLUMN),
    everyNth: boundedOf(options.everyNth, numbering.everyNth ?? 1, 1, MAX_EVERY_NTH),
    skipContaining: wordsOf(options.skipContaining, numbering.skipContaining ?? []),
    skipFirst: boundedOf(options.skipFirst, numbering.skipFirst ?? 0, 0, MAX_SKIP_LINES),
    skipLast: boundedOf(options.skipLast, numbering.skipLast ?? 0, 0, MAX_SKIP_LINES),
    startTrigger: textOf(options.startTrigger, numbering.startTrigger),
    startAfterTrigger: boolOf(options.startAfterTrigger, numbering.startAfterTrigger === true),
  };
}

/**
 * The profile the tokenizer should use for this run.
 *
 * `altPrefixes` decides what counts as an *existing* block number, and that lives in the
 * profile the tokenizer reads — so a run that changes the list recompiles the profile
 * once instead of second-guessing the tokenizer per line. Only the alternative prefixes
 * change; every pattern is the one that already compiled, so this cannot throw.
 */
function withAltPrefixes(cp: CompiledProfile, altPrefixes: string[]): CompiledProfile {
  const current = cp.profile.syntax.blockNumber.altPrefixes ?? [];
  if (current.length === altPrefixes.length && current.every((prefix, i) => prefix === altPrefixes[i])) return cp;
  const profile: Profile = {
    ...cp.profile,
    syntax: {
      ...cp.profile.syntax,
      blockNumber: { ...cp.profile.syntax.blockNumber, altPrefixes: [...altPrefixes] },
    },
  };
  return compileProfile(profile);
}

// ---------------------------------------------------------------------------
// The head of a block
// ---------------------------------------------------------------------------

interface Head {
  /** Offset behind the leading whitespace. */
  leadEnd: number;
  /** The skip marks before the number, as one span when there are several (`/1/2`). */
  skipBefore: NcToken | null;
  number: NcToken | null;
  /** Only ever set together with `number`: the tokenizer looks for it behind one. Spans several marks as `skipBefore` does. */
  skipAfter: NcToken | null;
  /** Offset behind the last head token, or `leadEnd` when the head is empty. */
  end: number;
  /** First non-whitespace offset behind `end`, or `line.length` when there is no code. */
  restStart: number;
}

/** One skip mark from the start of `first` to the end of `last`, the gaps between them included. */
function spanOf(line: string, first: NcToken, last: NcToken): NcToken {
  return { ...first, end: last.end, text: line.slice(first.start, last.end) };
}

/** Splits the head off the token list. Nothing here re-reads the line's syntax. */
function readHead(line: string, tokens: NcToken[]): Head {
  let index = 0;
  let leadEnd = 0;
  if (tokens[0]?.kind === 'whitespace') {
    leadEnd = tokens[0].end;
    index = 1;
  }

  let skipBefore: NcToken | null = null;
  let number: NcToken | null = null;
  let skipAfter: NcToken | null = null;
  let end = leadEnd;

  for (; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.kind === 'whitespace') continue;
    // Several skip levels on one block (`/1/2 N20`, `/1 /2 N20`) are one mark here: the
    // number stands behind all of them. Taking only the first one read `/2` as the start
    // of the code and wrote `/1N110 /2 N20 G1` (M9 NC review F7).
    if (token.kind === 'skip' && number === null) {
      skipBefore = skipBefore === null ? token : spanOf(line, skipBefore, token);
      end = token.end;
      continue;
    }
    if (token.kind === 'skip' && number !== null) {
      skipAfter = skipAfter === null ? token : spanOf(line, skipAfter, token);
      end = token.end;
      continue;
    }
    if (token.kind === 'blockNumber' && number === null && skipAfter === null) {
      number = token;
      end = token.end;
      continue;
    }
    break;
  }

  let restStart = end;
  while (restStart < line.length && isSpaceCode(line.charCodeAt(restStart))) restStart++;
  return { leadEnd, skipBefore, number, skipAfter, end, restStart };
}

/**
 * The line with `numberText` as its block number, everything else as it was.
 *
 * The gaps *inside* the head are copied from the original, so the two block-skip forms
 * keep their shape. `spacesAfter` only sets the gap between the head and the code, and
 * only when the head does not end in a skip mark.
 *
 * P4d (§6.6 rule 2): with `alignColumn` the gap is whatever puts the code at that column
 * (1-based, in characters, the leading whitespace and the skip marks in front of the number
 * included), and one space where the head already reaches it. Like `spacesAfter` it leaves
 * the gap behind a skip mark that follows the number alone: the mark binds to its block.
 */
function rebuild(line: string, head: Head, numberText: string, spacesAfter: number, alignColumn = 0): string {
  let out = line.slice(0, head.leadEnd);
  if (head.skipBefore !== null) {
    out += head.skipBefore.text;
    if (head.number !== null) out += line.slice(head.skipBefore.end, head.number.start);
  }
  out += numberText;
  if (head.skipAfter !== null && head.number !== null) {
    out += line.slice(head.number.end, head.skipAfter.start) + head.skipAfter.text;
  }

  // Nothing but whitespace behind the head: keep that whitespace instead of writing a
  // separator the block has nothing to separate.
  if (head.restStart >= line.length) return out + line.slice(head.end);

  const gap =
    head.skipAfter !== null
      ? line.slice(head.skipAfter.end, head.restStart)
      : alignColumn > 0
        ? ' '.repeat(Math.max(1, alignColumn - 1 - out.length))
        : ' '.repeat(spacesAfter);
  return out + gap + line.slice(head.restStart);
}

/**
 * The line without its block number (§6.6 rule 3, `everyNth`): the number and the blanks
 * behind it go, exactly as Remove Block Numbers cuts them, so `/N100 G0` becomes `/G0` and
 * `N120/ G0` keeps its mark (`/ G0`).
 */
function withoutNumber(line: string, number: NcToken): string {
  let end = number.end;
  while (end < line.length && isSpaceCode(line.charCodeAt(end))) end++;
  return line.slice(0, number.start) + line.slice(end);
}

/** True when `alignColumn` sets this line's gap and a tab stands in front of the code. */
function tabInHead(line: string, head: Head): boolean {
  // The gap behind the head is written anew; a tab in front of it — in the indentation or
  // between the skip marks and the number — is copied and counts as one character.
  if (head.skipAfter !== null || head.restStart >= line.length || head.end === 0) return false;
  return line.lastIndexOf('\t', head.end - 1) >= 0;
}

/**
 * True when the block carries a name rather than a number (`NLAP1`).
 *
 * The tokenizer already refuses `NLAP1` as a block number, which would leave the line
 * looking unnumbered and earn it a fresh `N10` in front of its own label. Read at the
 * head only, and only where a prefix would have stood.
 */
function looksLikeBlockName(line: string, at: number, prefixes: string[], caseSensitive: boolean): boolean {
  for (const prefix of prefixes) {
    if (!matchesAt(line, at, prefix, caseSensitive)) continue;
    let i = at + prefix.length;
    while (i < line.length && isSpaceCode(line.charCodeAt(i))) i++;
    if (i < line.length && isLetterCode(line.charCodeAt(i))) return true;
  }
  return false;
}

/**
 * The tokenizer's answer to "does this block carry a name?", where it has one.
 *
 * A `label` token at the start of the block's text is either a **block name** — the block
 * prefix written in front of the name (Okuma `NLAP1`: text `NLAP1`, name `LAP1`) — or a
 * **jump label** whose own name happens to start with the prefix letter (Sinumerik
 * `NEXT_PECK:`: text `NEXT_PECK:`, name `NEXT_PECK`). Only the first is a block name; the
 * second is a label like `LAST_CUT:` and its block gets a number in front of it. Without a
 * label token there (Fanuc reads `NLAP1` as letters), the text decides as before.
 *
 * Returns null when the head of the block's text is not a label token.
 */
function labelIsBlockName(
  tokens: NcToken[],
  at: number,
  prefixes: string[],
  caseSensitive: boolean,
): boolean | null {
  const label = tokens.find((token) => token.start === at && token.kind !== 'whitespace');
  if (label === undefined || label.kind !== 'label') return null;
  const name = label.address;
  if (name === undefined || name === '') return false;
  for (const prefix of prefixes) {
    if (!matchesAt(label.text, 0, prefix, caseSensitive)) continue;
    let i = prefix.length;
    while (i < label.text.length && isSpaceCode(label.text.charCodeAt(i))) i++;
    if (matchesAt(label.text, i, name, caseSensitive)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main blocks (M9, WP9.5b)
// ---------------------------------------------------------------------------
//
// A Sinumerik program has two kinds of block number: `N20` numbers a block, `:20` numbers
// a **main block** (`syntax.blockNumber.mainPrefix`, §7.1, §7.16 #50). The manuals keep
// them apart in three places, and so does this run:
//
//  - the prefix belongs to the block: renumbering writes `:30`, never `N30`;
//  - a jump names a main block by its own prefix (`GOTOF :20`) and an ordinary block by
//    `N` (`GOTOF N20`), so `GOTOF N20` does not name `:20`, and a program that has only a
//    `:20` has no `N20` for it to find;
//  - `GOTOF :20` is a reference all the same, and it is rewritten under exactly the rules
//    every other reference is (the reference rules whose addresses name the ordinary block
//    prefix, `numbering.references`, read with the main prefix in front).
//
// `references.ts` indexes every block by its value, whatever its prefix, and reads `:20`
// behind a `GOTOF` as two tokens of no address. [`withMainBlocks`] corrects that scan
// before anything reads it: main blocks get keys of their own (the prefix in front, so a
// main key is a string that never equals an ordinary one), and the main-block jumps are
// added as references. A dialect without the field, or a program without the prefix in any
// line, keeps the scan exactly as it was and pays nothing for this. The three helpers are
// exported for Remove Block Numbers, which has to keep a main block a jump names (hand-off
// note of WP9.5b); they live in `references.ts` since the M11 review (NC-3), which reads
// main-block jumps for review mode too, and are re-exported here.

/** True for a key [`mainKeyOf`] made. */
function isMainKey(key: BlockKey | null | undefined, main: string | null): boolean {
  return main !== null && typeof key === 'string' && key.startsWith(main);
}

/** The scan with main blocks keyed by their own prefix and their jumps added (see above). */
export function withMainBlocks(scan: ProgramScan, cp: CompiledProfile): ProgramScan {
  const main = mainPrefixOf(cp);
  if (main === null || cp.re.references.length === 0 || scan.scanned.length === 0) return scan;
  if (!scan.scanned.some((line) => line.includes(main))) return scan;

  const keys = scan.keys.slice();
  const added: FoundReference[] = [];
  let state: LineState | undefined;
  for (let row = 0; row < scan.scanned.length; row++) {
    const line = scan.scanned[row];
    const { tokens, state: next } = tokenizeLine(line, cp, state);
    state = next;
    if (!line.includes(main)) continue;

    for (const token of tokens) {
      if (token.kind !== 'blockNumber') continue;
      if (token.address === main && keys[row] !== null && token.valueText !== undefined) {
        keys[row] = mainKeyOf(main, token.valueText, scan.byText);
      }
      break;
    }

    for (const word of mainReferencesOn(tokens, line, cp)) added.push({ row, word });
  }

  const segments: Map<BlockKey, NumberSite>[] = scan.segments.map(() => new Map());
  for (let row = 0; row < keys.length; row++) {
    const key = keys[row];
    if (key === null) continue;
    const counts = segments[scan.segmentOf[row]];
    const site = counts.get(key);
    if (site === undefined) counts.set(key, { count: 1, row, lastRow: row });
    else {
      site.count++;
      site.lastRow = row;
    }
  }

  const found = added.length === 0 ? scan.found : [...scan.found, ...added].sort((a, b) => a.row - b.row || a.word.start - b.word.start);
  let count = scan.count;
  let first = scan.first;
  if (added.length > 0) {
    // `found` is in row order, so its first row is the first line that carries one.
    const rows = new Set(found.map((reference) => reference.row));
    count = rows.size;
    first = scan.firstLine + found[0].row;
  }
  return { ...scan, found, count, first, keys, segments };
}

// ---------------------------------------------------------------------------
// Program starts and program markers
// ---------------------------------------------------------------------------

function isProgramStart(masked: string, cp: CompiledProfile): boolean {
  for (const re of cp.re.programStart) if (re.test(masked)) return true;
  return false;
}

/**
 * True when the block *is* a program marker: `%`, `O1000`, `:1000`.
 *
 * Such a line is not a block and never gets a number. Writing `N10` in front of `:1000`
 * moves the program number out of the first position and the control loses it — which is
 * what the shipped defaults did, because `skipStartingWith` is `%`, `O`, `(` and the
 * colon form is not in the list (G8 M4). The tokenizer already knows all three forms, so
 * the text list stays what it is meant to be: an extra user filter, not the only guard.
 *
 * Read from the tokens of *this* run, so a dialect (or an `altPrefixes` run) that reads
 * `:1000` as a block number still renumbers it: it is a `blockNumber` token then, not a
 * `programMarker`.
 */
function isProgramMarkerLine(tokens: NcToken[]): boolean {
  for (const token of tokens) {
    if (token.kind === 'whitespace') continue;
    return token.kind === 'programMarker';
  }
  return false;
}

// ---------------------------------------------------------------------------
// Block-number references
// ---------------------------------------------------------------------------

/**
 * What this run does with one reference.
 *
 * Only `rewritten` writes anything; `unchanged` is a reference whose target keeps the
 * number it had, which is the right answer and not worth a word. The other six are the
 * ones the user is told about, and each names the reason, because "check your jumps" is
 * not something anybody can act on.
 */
type Outcome =
  /** The value was replaced with the number its block carries now. */
  | 'rewritten'
  /** Resolved, and the number did not change. */
  | 'unchanged'
  /**
   * The rule says report only: the block is one of another program the dialect never
   * follows (`M98 P1000 Q30`, owner 2026-10-19), or a cycle read with a milling profile
   * (its own row since the P4d review NC-9).
   */
  | 'kept'
  /** No block of this program carries that number. */
  | 'missing'
  /** More than one does, so there is no single answer. */
  | 'duplicate'
  /** The block it names is not among the lines this run rewrites. */
  | 'outside'
  /** The reference itself is outside them and points into them. */
  | 'incoming'
  /** The value is a variable, an expression or otherwise not a block number. */
  | 'notNumber'
  /** The block carries two words with this address, so which one points at a block
   *  number cannot be told from the line (`references.ts`, `ReferenceWord.ambiguous`). */
  | 'ambiguous'
  /** P4d (plan §6.6 rule 10): the program the value names a block of cannot be told
   *  (`programs.ts`, `TargetRefusal`): no call on the line, the program is not in this file
   *  or is there twice, no or several programs of this file call this one. */
  | TargetRefusal;

interface Decision {
  /** Index into the run's `lines`, or -1 when the reference stands outside them. */
  index: number;
  /** The document line, for the results panel. */
  line: number;
  word: ReferenceWord;
  outcome: Outcome;
  /** The value to write in place of `word.text`; empty unless `outcome` is `rewritten`. */
  text: string;
}

/** True for every outcome the user is told about. */
function isTrouble(outcome: Outcome): boolean {
  return outcome !== 'rewritten' && outcome !== 'unchanged';
}

/**
 * The new value, written the way the old one was.
 *
 * Zero padding is a property of the reference, not of the block number: `P0100` is written
 * with four digits because the post writes four, so it becomes `P0020` and not `P20`. A
 * value that was not padded stays unpadded, and one that outgrows its padding is written
 * in full rather than truncated.
 *
 * This is the rule of a control that reads block numbers as **numbers**. Where they are
 * names (`ProgramScan.byText`, Okuma) the padding belongs to the name, and a reference is
 * written with exactly the text its block receives instead (see `decideReferences`).
 */
function writtenAs(oldText: string, oldValue: number, newValue: number): string {
  const digits = String(newValue);
  const padded = oldText.length > String(oldValue).length;
  return padded && digits.length < oldText.length ? digits.padStart(oldText.length, '0') : digits;
}

/**
 * The key a block number written as `text` has in this scan (`references.ts`, `BlockKey`).
 * `main` is the main prefix when the block is a main block, which keeps its prefix.
 */
function keyOfWritten(scan: ProgramScan, text: string, main: string | null = null): BlockKey {
  if (main !== null) return mainKeyOf(main, text, scan.byText);
  return scan.byText ? text : Number(text);
}

/**
 * What `newTextOf` answers for a line whose number the run removed (§6.6 rule 3,
 * `everyNth`): no digits at all, which no written number ever is.
 */
const REMOVED = '';

/**
 * The key of the block number `row` carries **after** the run: the digits the run wrote
 * for a line of its scope, the number the scan read for every other row (or null). A line
 * whose number the run removed ([`REMOVED`]) carries none.
 */
function keyAfter(
  scan: ProgramScan,
  row: number,
  base: number,
  lineCount: number,
  newTextOf: (index: number) => string | null,
  main: string | null,
): BlockKey | null {
  const written = row >= base && row < base + lineCount ? newTextOf(row - base) : null;
  if (written === REMOVED) return null;
  // A main block keeps its prefix, so it keeps its kind of key.
  return written === null ? scan.keys[row] : keyOfWritten(scan, written, isMainKey(scan.keys[row], main) ? main : null);
}

/**
 * How often each block occurs in a program **after** the run.
 *
 * `newTextOf` is the run's answer for a line of its scope — the digits it wrote; every
 * other row keeps the block number the scan read. The result is per program segment,
 * because that is the scope a block-number reference is resolved in, and it counts
 * [`BlockKey`]s, so on a dialect whose sequence numbers are names `N20` and `N0020` are
 * two blocks and not one twice.
 *
 * Without this, a run that wraps rewrote every reference with a number the program now
 * carries ten times over (G8 M6): the duplicate test only ever looked at the numbering
 * the run **replaced**, found each target unique there, and wrote a value a control
 * resolves to the first of many matching blocks.
 */
function keysAfter(
  scan: ProgramScan,
  base: number,
  lineCount: number,
  newTextOf: (index: number) => string | null,
  main: string | null,
): Map<BlockKey, number>[] {
  const after: Map<BlockKey, number>[] = scan.segments.map(() => new Map());
  for (let row = 0; row < scan.keys.length; row++) {
    const key = keyAfter(scan, row, base, lineCount, newTextOf, main);
    if (key === null) continue;
    const counts = after[scan.segmentOf[row]];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return after;
}

/**
 * What the run can do with every reference in the program.
 *
 * `newTextOf` answers, for a line of the run's scope, the digits of the block number it
 * carries afterwards (`'20'`, or `'0020'` with four digits), or null when that line keeps
 * the number it had. The preflight passes null for the whole function: it only has to know
 * *whether* a reference can be rewritten, and that question is answered by the program's
 * own numbers, so the preflight and the run always agree on what will be reported — with
 * one exception, a run that wraps: only the run knows the numbering it wrote, and the
 * preflight bounds that question for itself (`mayWrap`).
 *
 * A reference is resolved by its [`BlockKey`]. Where sequence numbers are names
 * (`scan.byText`, Okuma) it names the block written exactly like it, so `N0020` is missing
 * in a program that only has an `N20`, and a rewritten reference takes exactly the text its
 * block receives — including when only the padding changed and the number stayed the same
 * (`N0020` renumbered to `N20` moves its jumps along, G10 M8).
 */
function decideReferences(
  scan: ProgramScan,
  programs: ProgramIndex,
  firstLine: number,
  lineCount: number,
  newTextOf: ((index: number) => string | null) | null,
  main: string | null,
): Decision[] {
  const base = Math.max(0, Math.trunc(firstLine) - scan.firstLine);
  const end = base + lineCount;
  const decisions: Decision[] = [];
  // Only the run knows the numbering it wrote; the preflight asks about wrapping in its
  // own way (`mayWrap`), because it cannot know how many blocks will really be numbered.
  const after = newTextOf === null ? null : keysAfter(scan, base, lineCount, newTextOf, main);

  for (const { row, word } of scan.found) {
    const line = scan.firstLine + row;
    // P4d (§6.6 rule 10): the program whose blocks the value names — its own for `own`,
    // which is all M6 knew; the one its line calls, or the one that calls it, otherwise.
    const program = targetProgramOf(scan, programs, row, word);
    const segment = 'segment' in program ? program.segment : -1;
    const site = word.key === null || segment < 0 ? undefined : scan.segments[segment]?.get(word.key);

    if (row < base || row >= end) {
      // A reference this run does not rewrite only matters when it points **into** the
      // lines it does: everything else keeps naming a number nothing here touches.
      if (site !== undefined) {
        if (siteInside(site, base, end)) decisions.push({ index: -1, line, word, outcome: 'incoming', text: '' });
      } else if ('refused' in program && word.key !== null && mayPointInto(scan, possibleProgramsOf(scan, programs, row, word), word.key, base, end)) {
        // P4d review NC-3: the program it names a block of cannot be told, and one it may
        // name has that block among these lines. Reported with its reason, and asked about
        // before the run, as it is inside them.
        decisions.push({ index: -1, line, word, outcome: program.refused, text: '' });
      }
      continue;
    }

    const index = row - base;
    const decide = (outcome: Outcome, text = ''): void => {
      decisions.push({ index, line, word, outcome, text });
    };
    // The rule first: `rewrite: false` is not "could not", it is "must not", and that is
    // what the row has to say even when the number happens to exist here as well.
    if (!word.rewrite) decide('kept');
    // Two words of one address in one block: the rule fired on the line and cannot say
    // which of them it meant, so neither is touched.
    else if (word.ambiguous) decide('ambiguous');
    else if (word.target === null) decide('notNumber');
    // The program it names a block of cannot be told: reported with the reason (§6.6 rule 10).
    else if ('refused' in program) decide(program.refused);
    // Without a document a missing number may simply be out of sight, and saying "this
    // program has no N100" about lines nobody read would be a lie.
    else if (site === undefined) decide(scan.unchecked ? 'outside' : 'missing');
    else if (site.count > 1) decide('duplicate');
    else if (site.row < base || site.row >= end) decide('outside');
    else {
      const written = newTextOf === null ? null : newTextOf(site.row - base);
      // A block a reference names never loses its number to `everyNth` (§6.6 rule 3, see
      // `protectionOf`); should one ever do, the value names nothing and is left standing.
      if (written === REMOVED) {
        decide('missing');
        continue;
      }
      // The block this reference would name afterwards, whether the run rewrites the
      // value or leaves it standing. A run that wrapped hands the same number out several
      // times, and a control takes the first match, so an answer that is no longer unique
      // is not an answer (G8 M6).
      const named = written === null ? word.key : keyOfWritten(scan, written, isMainKey(word.key, main) ? main : null);
      if (after !== null && named !== null && (after[segment]?.get(named) ?? 0) > 1) decide('duplicate');
      else if (written === null || named === word.key) {
        // Where blocks are names, the same key is the same text: nothing to write.
        decide('unchanged');
      } else if (scan.byText) decide('rewritten', written);
      else decide('rewritten', writtenAs(word.text, word.target, Number(written)));
    }
  }
  return decisions;
}

/** True when the block (or one of the blocks) of `site` is among the scope's rows `[base, end)`. */
function siteInside(site: NumberSite, base: number, end: number): boolean {
  return (site.row >= base && site.row < end) || (site.lastRow >= base && site.lastRow < end) || (site.row < base && site.lastRow >= end);
}

/**
 * P4d review NC-3: true when one of the `segments` (null: any program of the file) has a
 * block `key` among the scope's rows `[base, end)`.
 */
function mayPointInto(scan: ProgramScan, segments: readonly number[] | null, key: BlockKey, base: number, end: number): boolean {
  const list = segments ?? scan.segments.map((_, segment) => segment);
  for (const segment of list) {
    const site = scan.segments[segment]?.get(key);
    if (site !== undefined && siteInside(site, base, end)) return true;
  }
  return false;
}

/**
 * P4d review NC-4: the rows that carry a block number the run put on more blocks of their
 * program than carried it before, now more than one (a line above the start text, or one it
 * skips, kept that number), in row order, and how many such numbers there are.
 */
function duplicatesMade(
  scan: ProgramScan,
  after: readonly Map<BlockKey, number>[],
  keyAfterRow: (row: number) => BlockKey | null,
): { rows: number[]; count: number } {
  let count = 0;
  const grown = after.map((counts, segment) => {
    const keys = new Set<BlockKey>();
    for (const [key, n] of counts) if (n > 1 && n > (scan.segments[segment]?.get(key)?.count ?? 0)) keys.add(key);
    count += keys.size;
    return keys;
  });
  if (count === 0) return { rows: [], count };
  const rows: number[] = [];
  for (let row = 0; row < scan.keys.length; row++) {
    const key = keyAfterRow(row);
    if (key !== null && grown[scan.segmentOf[row]]?.has(key) === true) rows.push(row);
  }
  return { rows, count };
}

/**
 * Writes the rewritten values into the lines the run produced.
 *
 * The spans were read on the original line, and the only thing the run changed in front
 * of them is the head of the block — the number, its skip marks and the gap behind it —
 * so everything behind the head moved by exactly the change in the line's length. Several
 * values on one line are written from the back, so an earlier span keeps its offsets.
 */
function applyReferences(out: string[], lines: readonly string[], decisions: readonly Decision[]): void {
  const byLine = new Map<number, Decision[]>();
  for (const decision of decisions) {
    if (decision.outcome !== 'rewritten' || decision.index < 0) continue;
    const list = byLine.get(decision.index);
    if (list === undefined) byLine.set(decision.index, [decision]);
    else list.push(decision);
  }

  for (const [index, list] of byLine) {
    const delta = out[index].length - lines[index].length;
    list.sort((a, b) => b.word.start - a.word.start);
    let text = out[index];
    for (const { word, text: value } of list) {
      text = text.slice(0, word.start + delta) + value + text.slice(word.end + delta);
    }
    out[index] = text;
  }
}

/**
 * Where a reference the run left as written lands **after** the run (M13 review NC-8).
 *
 * A value left standing is reported, but "check it" undersells the one case that is worse
 * than a jump to nowhere: the block it named got a new number, and the run wrote the old
 * number onto **another** block. `M99 P300` named `N300 G00 X100. Z100. T0100`; after the
 * renumber that block is `N260` and `N300` is the `M08` four blocks further down, past the
 * tool change, so the return skips it and the program still runs. This finds that block,
 * or finds that no block carries the number any more (the control stops with an alarm).
 *
 * Only a target that existed once in the input counts: a value that named nothing, or two
 * blocks, has its own row already, and so does a line whose two words of one address
 * cannot be told apart. The target is looked for in the program the value names a block
 * of (§6.6 rule 10, `targetProgramOf`) — its own, the one its line calls, or the one that
 * calls its program — also where the dialect never rewrites the value (`M98 P2000 Q50` with
 * `O2000` in the file). Where that program cannot be told, it is the one block of the file
 * that carries the number, in another program than the reference (see `targetOf`).
 */
/** `LandingFinder`'s answer where the program a value names cannot be told. */
const NO_PROGRAM = -1;
/** `LandingFinder`'s answer where the program a value names is not in this file. */
const NOT_IN_FILE = -2;

interface Landing {
  /** The row of the block the reference named before the run. */
  targetRow: number;
  /** The row of the block that carries the number after the run, or -1 when none does. */
  landingRow: number;
}

class LandingFinder {
  /** Per program: block key → first row carrying it after the run. Built on first use. */
  private after: Map<BlockKey, number>[] | null = null;

  constructor(
    private readonly scan: ProgramScan,
    private readonly keyAfterRow: (row: number) => BlockKey | null,
    /**
     * P4d (§6.6 rule 10): the program a reference names a block of, `NOT_IN_FILE` when that
     * program is not in this file, or `NO_PROGRAM` when it cannot be told.
     */
    private readonly segmentOf: (row: number, word: ReferenceWord) => number,
  ) {}

  /** The block a reference on `row` named in the input, as program and site, or null. */
  private targetOf(row: number, word: ReferenceWord): { segment: number; site: NumberSite } | null {
    if (word.key === null) return null;
    const own = this.scan.segmentOf[row];
    // P4d (§6.6 rule 10): the program the value names a block of, wherever the file tells
    // which one — for a value the dialect never rewrites as well, as long as it names a
    // block of another program (`M98 P2000 Q50` one of `O2000`). A rule of the own program
    // that never rewrites (a cycle read with a milling profile) keeps M6's answer below.
    const target = word.rewrite || word.program !== 'own' ? this.segmentOf(row, word) : NO_PROGRAM;
    if (target >= 0) {
      const here = this.scan.segments[target]?.get(word.key);
      return here !== undefined && here.count === 1 ? { segment: target, site: here } : null;
    }
    // The program it calls is not in this file: no block of the file is its target.
    if (target === NOT_IN_FILE) return null;
    // Otherwise the value names a block of a program that cannot be told: `M99 P` one of a
    // caller that is not the only one, `M98 P#1 Q50` one of whichever program it calls. Only
    // a number exactly one block of the file carries is an answer, and only when that block
    // is not in the reference's own program: `Q50` behind `M98 P2000` does not name the `N50`
    // beside it (golden `m98-p-before-call`), and a subprogram's own `N30` is not where its
    // `M99 P30` returns to (`m99-p-caller`).
    let found: { segment: number; site: NumberSite } | null = null;
    for (let segment = 0; segment < this.scan.segments.length; segment++) {
      const site = this.scan.segments[segment].get(word.key);
      if (site === undefined) continue;
      if (segment === own || found !== null || site.count !== 1) return null;
      found = { segment, site };
    }
    return found;
  }

  private firstAfter(segment: number, key: BlockKey): number {
    if (this.after === null) {
      const after: Map<BlockKey, number>[] = this.scan.segments.map(() => new Map());
      for (let row = 0; row < this.scan.keys.length; row++) {
        const k = this.keyAfterRow(row);
        if (k === null) continue;
        const counts = after[this.scan.segmentOf[row]];
        if (!counts.has(k)) counts.set(k, row);
      }
      this.after = after;
    }
    return this.after[segment]?.get(key) ?? -1;
  }

  /** Null when the reference names nothing it named before, or its block kept the number. */
  landingOf(row: number, word: ReferenceWord): Landing | null {
    if (word.ambiguous) return null;
    const target = this.targetOf(row, word);
    if (target === null || word.key === null) return null;
    if (this.keyAfterRow(target.site.row) === word.key) return null;
    return { targetRow: target.site.row, landingRow: this.firstAfter(target.segment, word.key) };
  }
}

/** A line as a row quotes it: trimmed, and cut short where it would swamp the message. */
function quoted(line: string): string {
  const text = line.trim();
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

/**
 * The two row lists in one, in line order and capped.
 *
 * The results panel is read top to bottom, so a reference row belongs next to the skipped
 * line above it and not behind 200 of them. Both lists are already in line order, which
 * makes this a merge; where a line appears in both, the skip comes first, because it is
 * the reason the line looks the way it does.
 */
function mergeRows(skipped: Located[], references: Located[], limit: number): Located[] {
  if (references.length === 0) return skipped;
  const rows: Located[] = [];
  let a = 0;
  let b = 0;
  while (rows.length < limit && (a < skipped.length || b < references.length)) {
    if (b >= references.length || (a < skipped.length && skipped[a].line <= references[b].line)) rows.push(skipped[a++]);
    else rows.push(references[b++]);
  }
  return rows;
}

/**
 * The scan both the preflight and the run work from.
 *
 * `altPrefixes` decides what counts as an existing block number, so the scan has to read
 * the program through the same compiled profile the run writes it with.
 */
function scanFor(lines: string[], ctx: TransformContext, cp: CompiledProfile): ProgramScan {
  return withMainBlocks(scanProgram(lines, cp === ctx.cp ? ctx : { ...ctx, cp }), cp);
}

/**
 * The most blocks one run of the counter can have to number, as an upper bound.
 *
 * Every line is at most one block, so the scope's line count is the bound — except where
 * the counter starts over at each program start, and then it is the longest program
 * inside the scope. It is deliberately an over-estimate: skipped and unnumbered lines
 * bring the real count down, and the only thing this answers is whether the run *could*
 * run past the maximum.
 */
function mostBlocks(scan: ProgramScan, restart: boolean, firstLine: number, lineCount: number): number {
  if (!restart) return lineCount;
  const base = Math.max(0, Math.trunc(firstLine) - scan.firstLine);
  const end = Math.min(scan.segmentOf.length, base + lineCount);
  let best = 0;
  let run = 0;
  let segment = -1;
  for (let row = base; row < end; row++) {
    if (scan.segmentOf[row] !== segment) {
      segment = scan.segmentOf[row];
      run = 0;
    }
    run++;
    if (run > best) best = run;
  }
  return best;
}

/**
 * Whether this run could pass the maximum and start over, which makes **every** rewritten
 * value suspect (G8 M6).
 *
 * The run itself knows exactly what it wrote and reports each affected reference as a
 * duplicate (`numbersAfter`). This is the question the preflight can answer before any of
 * it happens, and it can only bound it: the answer is "may", and the message says so.
 */
function mayWrap(settings: Settings, scan: ProgramScan, firstLine: number, lineCount: number): boolean {
  // `fitToMax` picks a step that never passes the maximum (§6.6 rule 1).
  if (!settings.wrap || settings.max === null || settings.fitToMax) return false;
  const blocks = mostBlocks(scan, settings.restartAtProgramStart, firstLine, lineCount);
  if (blocks <= 0) return false;
  return settings.start + settings.step * (blocks - 1) > settings.max;
}

// ---------------------------------------------------------------------------
// The advanced options (P4d, plan §6.6 rules 1–7)
// ---------------------------------------------------------------------------
//
// The run is three walks over the scope since P4d, and only the first one tokenizes:
//
//  1. [`walkLines`] decides for every line what it is, in the fixed order of rule 7:
//     continuation tail → blank line → program marker → `skipFirst`/`skipLast` → before the
//     start trigger → `skipStartingWith` → `skipContaining` → `continuationStart` → block
//     name → `onlyNumbered` → a block the run numbers. Nothing in it depends on the numbers.
//  2. [`selectBlocks`] picks, among those blocks, the ones `everyNth` numbers, and counts
//     them per run of the counter — the count `fitToMax` needs before the first number is
//     written (rule 1).
//  3. The numbering itself (`runRenumber`): stopped at `max`, wrapped, written.
//
// A run an option refuses (`noMax`, `doesNotFit`, `noTrigger`) writes nothing at all
// (rule 7): the lines come back as they were, the reason is the summary, and the status
// bar says it. The preflight asks nothing about such a run.

/** What [`walkLines`] decided for a line. 1 to 7 are the skip rows of the results table. */
const LEFT = 0;
const MARKER = 1;
const PREFIX = 2;
const CONTAINING = 3;
const CONTINUED = 4;
const NAME = 5;
const NOT_NUMBERED = 6;
const STOPPED = 7;
/** Numbered, and the numbering started over here: a warning row. */
const WRAPPED = 8;
/** A block the run numbers (or, under `everyNth`, takes the number off). */
const BLOCK = 9;
/** Kept by `skipFirst`/`skipLast` or above the start trigger: one row per region, not one per line. */
const QUIET = 10;

/** What [`selectBlocks`] picked for a block. */
const NUMBER = 1;
/** Numbered although `everyNth` passes over it: a reference names it, or it is a main block. */
const NUMBER_KEPT = 2;
/** `everyNth` passes over it: the block loses its number. */
const DROP = 3;

type Refusal = 'noMax' | 'doesNotFit' | 'noTrigger';

interface Walk {
  /** Per line, one of the codes above (`LEFT` … `QUIET`). */
  codes: Uint8Array;
  /** The head of each `BLOCK` line, read once. */
  heads: (Head | undefined)[];
  /** 1 where the counter starts over (a program start, with `restartAtProgramStart`). */
  restarts: Uint8Array;
}

/**
 * The scope's length in lines (§6.6 rule 5): every line counts, an empty one too, but the
 * trailing empty element a final newline leaves in the array is no line.
 */
function scopeLength(lines: readonly string[]): number {
  return lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}

/**
 * A test for "the line contains one of these texts" (§6.6 rules 4 and 6): anywhere in the
 * line as it is written, comments included, under the profile's case rule. Null when there
 * is no text to look for.
 */
function containsAny(texts: readonly string[], caseSensitive: boolean): ((line: string) => boolean) | null {
  const wanted = texts.filter((text) => text !== '').map((text) => (caseSensitive ? text : text.toUpperCase()));
  if (wanted.length === 0) return null;
  return (line) => {
    const hay = caseSensitive ? line : line.toUpperCase();
    for (const text of wanted) if (hay.includes(text)) return true;
    return false;
  };
}

/** The first line of the scope that contains the start trigger, or -1 (§6.6 rule 6). */
function triggerRowOf(lines: readonly string[], trigger: string, caseSensitive: boolean): number {
  const contains = containsAny([trigger], caseSensitive);
  if (contains === null) return -1;
  for (let i = 0; i < lines.length; i++) if (contains(lines[i])) return i;
  return -1;
}

/**
 * The refusals that the settings and the text alone decide (§6.6 rules 1 and 6), in that
 * order, or null. `doesNotFit` needs the walk and comes later ([`fittedStep`]).
 */
function earlyRefusal(lines: readonly string[], settings: Settings, caseSensitive: boolean): Msg | null {
  if (settings.fitToMax && settings.max === null) return refusal('noMax');
  if (settings.startTrigger !== '' && triggerRowOf(lines, settings.startTrigger, caseSensitive) < 0) {
    return refusal('noTrigger', { text: settings.startTrigger });
  }
  return null;
}

function refusal(reason: Refusal, params?: Record<string, string | number>): Msg {
  return params === undefined ? { key: `ncNumbering.renumber.refused.${reason}` } : { key: `ncNumbering.renumber.refused.${reason}`, params };
}

/** True when `skipFirst` and `skipLast` together cover the whole scope: nothing to renumber (§6.6 rule 5). */
function skipsEverything(lines: readonly string[], settings: Settings): boolean {
  const skipped = settings.skipFirst + settings.skipLast;
  return skipped > 0 && skipped >= scopeLength(lines);
}

/**
 * The step `fitToMax` uses (§6.6 rule 1), or null when even a step of 1 does not fit.
 *
 * `blocks` is the number of blocks the run numbers — of the longest program where the
 * counter starts over at each one, only the ones `everyNth` numbers. One block or none
 * needs no step, and the form's increment stands (it is never used).
 */
function fittedStep(start: number, max: number, blocks: number, step: number): number | null {
  if (blocks === 0) return step;
  if (start > max) return null;
  if (blocks === 1) return step;
  const fitted = Math.floor((max - start) / (blocks - 1));
  return fitted >= 1 ? fitted : null;
}

/**
 * The first walk: what every line of the scope is (§6.6 rule 7, see above). `from` is the
 * first line numbering may start at (the start trigger, rule 6).
 */
function walkLines(lines: readonly string[], ctx: TransformContext, cp: CompiledProfile, settings: Settings, from: number): Walk {
  const caseSensitive = cp.profile.syntax.caseSensitive === true;
  const blockNumber = cp.profile.syntax.blockNumber;
  const prefixOut = blockNumber.mode === 'leading-integer' ? '' : (blockNumber.prefix ?? 'N');
  const namePrefixes = blockNumber.mode === 'leading-integer' ? [] : [prefixOut, ...settings.altPrefixes];
  const marks = settings.skipStartingWith;
  const containing = containsAny(settings.skipContaining, caseSensitive);
  const continuedLine = cp.re.continuationStart;
  // Lines at or behind this index belong to `skipLast`.
  const lastKept = scopeLength(lines) - settings.skipLast;

  const codes = new Uint8Array(lines.length);
  const heads = new Array<Head | undefined>(lines.length);
  const restarts = new Uint8Array(lines.length);
  // The state `lines[0]` begins in. `undefined` — a caller that handed over a fragment
  // without its document — is what `tokenizeLine` reads as the start of the document,
  // and the preflight has already warned about that on a dialect with continuations.
  let state: LineState | undefined = stateBefore(ctx);
  const lastIndex = lines.length - 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const continuation = state?.continuation === true;
    const { tokens, state: next } = tokenizeLine(line, cp, state);
    state = next;

    // The tail of a `~` block is part of the block above; it is not a block and gets no
    // number, and it is not something the user "skipped" either.
    if (continuation) continue;

    if (settings.restartAtProgramStart && isProgramStart(maskedOf(line, tokens), cp)) restarts[i] = 1;

    const head = readHead(line, tokens);
    const blank = head.restStart >= line.length && head.end === head.leadEnd;
    // The trailing empty element belongs to the final newline, not to a block: numbering
    // it would turn that newline into text (types.ts, rule 5).
    if (blank && (settings.skipEmpty || (i === lastIndex && line === ''))) continue;

    // A program marker is not a block, whatever the skip list says (see the function).
    if (isProgramMarkerLine(tokens)) {
      codes[i] = MARKER;
      continue;
    }
    // P4d (§6.6 rules 5 and 6): the first and last lines of the scope, and the lines above
    // the start trigger, keep their text and their numbers. One row says so per region.
    if (i < settings.skipFirst || i >= lastKept || i < from) {
      codes[i] = QUIET;
      continue;
    }
    if (marks.length > 0 && marks.some((mark) => matchesAt(line, head.leadEnd, mark, caseSensitive))) {
      codes[i] = PREFIX;
      continue;
    }
    // P4d (§6.6 rule 4): anywhere in the line, read as written.
    if (containing !== null && containing(line)) {
      codes[i] = CONTAINING;
      continue;
    }
    // B1: a line that continues the block above by its leading mark (`syntax.continuationStart`,
    // Okuma `$`) is no block of its own, whatever the editable skip list says: `N30 $ H1.8`
    // would take the mark off the head of the line and cut the line off its block.
    if (continuedLine?.test(line) === true) {
      codes[i] = CONTINUED;
      continue;
    }
    // `restStart` is where the block's text starts, which is where a block *name* would
    // stand: behind the leading whitespace, or behind a skip mark and its whitespace.
    // The tokenizer decides where it read a label there (`NEXT_PECK:` is no block name,
    // Okuma `NLAP1` is); the text decides where it did not (Fanuc `NLAP1`).
    const named =
      head.number === null &&
      (labelIsBlockName(tokens, head.restStart, namePrefixes, caseSensitive) ??
        looksLikeBlockName(line, head.restStart, namePrefixes, caseSensitive));
    if (named) {
      codes[i] = NAME;
      continue;
    }
    if (settings.onlyNumbered && head.number === null) {
      codes[i] = NOT_NUMBERED;
      continue;
    }
    codes[i] = BLOCK;
    heads[i] = head;
  }
  return { codes, heads, restarts };
}

/**
 * The blocks `everyNth` numbers (§6.6 rule 3), and the most one run of the counter numbers.
 *
 * Of the blocks the run would number, the 1st, the (N+1)th, the (2N+1)th … get a number;
 * the ones between lose theirs, unless `keeps` says otherwise — then the block gets the
 * next number of the sequence and the count goes on, so the next Nth block is the one it
 * would have been. Where the counter starts over at each program start, so does the count:
 * the first block of every program gets the start number.
 */
function selectBlocks(walk: Walk, everyNth: number, keeps: (index: number) => boolean): { picks: Uint8Array; most: number } {
  const picks = new Uint8Array(walk.codes.length);
  let most = 0;
  let count = 0;
  let position = 0;
  for (let i = 0; i < walk.codes.length; i++) {
    if (walk.restarts[i] === 1) {
      count = 0;
      position = 0;
    }
    if (walk.codes[i] !== BLOCK) continue;
    let pick = NUMBER;
    if (everyNth > 1 && position % everyNth !== 0) pick = keeps(i) ? NUMBER_KEPT : DROP;
    position++;
    picks[i] = pick;
    if (pick === DROP) continue;
    count++;
    if (count > most) most = count;
  }
  return { picks, most };
}

/**
 * Which blocks a reference names, so `everyNth` never takes their number (§6.6 rule 3).
 *
 * A reference resolved into one program (rule 10, `targetProgramOf`) keeps the block of
 * that program. One that is not — a rule that never rewrites (`M98 P… Q…`, a cycle read
 * with a milling profile), a program that cannot be told — keeps a block with that number in
 * **every** program of the file, as Remove Block Numbers does: keeping a number too many
 * costs nothing, a missing jump target makes the control stop. A computed value (`GOTO
 * #100`) names no number and keeps nothing; it is reported as a reference all the same.
 * Returns a test on the scan's rows.
 */
function referencedRows(scan: ProgramScan, programs: ProgramIndex): (row: number) => boolean {
  const everywhere = new Set<BlockKey>();
  const inProgram = new Map<number, Set<BlockKey>>();
  for (const { row, word } of scan.found) {
    if (word.key === null) continue;
    const program = word.rewrite ? targetProgramOf(scan, programs, row, word) : null;
    if (program !== null && 'segment' in program) {
      let keys = inProgram.get(program.segment);
      if (keys === undefined) inProgram.set(program.segment, (keys = new Set()));
      keys.add(word.key);
    } else everywhere.add(word.key);
  }
  if (everywhere.size === 0 && inProgram.size === 0) return () => false;
  return (row) => {
    const key = scan.keys[row];
    if (key === null || key === undefined) return false;
    return everywhere.has(key) || inProgram.get(scan.segmentOf[row])?.has(key) === true;
  };
}

/**
 * `TransformResult.renumbered` (§6.6 rule 11): every named program of the scan in which the
 * run changed, removed or created a block number, with what it did. A key several blocks
 * of a program carried before the run names no one block, so what became of it has no
 * answer and it is not in `changed`; where the run changed one of those blocks it is in
 * `duplicated` (P4d review CODE-10), so a reference to it elsewhere is listed as one.
 */
function outcomeOf(
  scan: ProgramScan,
  programs: ProgramIndex,
  base: number,
  lineCount: number,
  writtenOf: (index: number) => string | null,
  main: string | null,
  prefix: string,
): RenumberOutcome {
  const end = Math.min(scan.keys.length, base + lineCount);
  const changed = new Map<number, Map<BlockKey, string | null>>();
  // P4d review CODE-10: keys several blocks carried before the run, one of which it changed.
  const twiceBefore = new Map<number, Set<BlockKey>>();
  const touched = new Set<number>();
  for (let row = Math.max(0, base); row < end; row++) {
    const written = writtenOf(row - base);
    if (written === null) continue;
    const segment = scan.segmentOf[row];
    touched.add(segment);
    const before = scan.keys[row];
    if (before === null) continue;
    if (keyAfter(scan, row, base, lineCount, writtenOf, main) === before) continue;
    if ((scan.segments[segment]?.get(before)?.count ?? 0) !== 1) {
      let keys = twiceBefore.get(segment);
      if (keys === undefined) twiceBefore.set(segment, (keys = new Set()));
      keys.add(before);
      continue;
    }
    let map = changed.get(segment);
    if (map === undefined) changed.set(segment, (map = new Map()));
    map.set(before, written === REMOVED ? null : written);
  }

  const result: RenumberedProgram[] = [];
  if (touched.size === 0) return { byText: scan.byText, prefix, programs: result };
  const after = keysAfter(scan, base, lineCount, writtenOf, main);
  for (const segment of [...touched].sort((a, b) => a - b)) {
    const info = programs.programs[segment];
    if (info === undefined || info.name === null || info.key === null) continue;
    const before = scan.segments[segment] ?? new Map<BlockKey, NumberSite>();
    const created = new Set<BlockKey>();
    // A value that named several blocks before the run names no one block, and the run
    // changed one of them: listed as a duplicate (CODE-10), never followed.
    const duplicated = new Set<BlockKey>(twiceBefore.get(segment) ?? []);
    for (const [key, count] of after[segment] ?? new Map<BlockKey, number>()) {
      if (!before.has(key)) created.add(key);
      if (count > 1) duplicated.add(key);
    }
    const map = changed.get(segment) ?? new Map<BlockKey, string | null>();
    if (map.size === 0 && created.size === 0 && !twiceBefore.has(segment)) continue;
    result.push({ name: info.name, key: info.key, changed: map, created, duplicated });
  }
  return { byText: scan.byText, prefix, programs: result };
}

/** A run that writes nothing: the input as it was, an identity map, and `summary` as the reason. */
function untouched(lines: readonly string[], summary: Msg): TransformResult {
  return { lines: lines.slice(), lineMap: Int32Array.from(lines, (_line, i) => i), summary, skipped: [], warnings: [] };
}

// ---------------------------------------------------------------------------
// The transform
// ---------------------------------------------------------------------------

function optionFields(cp: CompiledProfile): FieldSpec[] {
  const numbering = cp.profile.numbering;
  // Klartext: consecutive from 0 in steps of 1 is what the control accepts, so there is
  // nothing to ask. `TransformService` opens no dialog for an empty field list.
  if (numbering.mode === 'consecutive') return [];
  // The dialect's own limit bounds the form: Okuma reads block numbers up to 9999, so a
  // fifth digit (`N00010`) or a maximum above it writes blocks the control rejects.
  const limit = profileLimit(cp);

  return [
    {
      id: 'start',
      type: 'integer',
      label: t('ncNumbering.renumber.fields.start.label'),
      help: t('ncNumbering.renumber.fields.start.help'),
      default: numbering.start ?? 10,
      required: true,
      min: 0,
      max: limit?.max ?? 99999999,
    },
    {
      id: 'step',
      type: 'integer',
      label: t('ncNumbering.renumber.fields.step.label'),
      help: t('ncNumbering.renumber.fields.step.help'),
      default: numbering.step ?? 10,
      required: true,
      min: 1,
      max: 100000,
    },
    {
      id: 'digits',
      type: 'integer',
      label: t('ncNumbering.renumber.fields.digits.label'),
      help:
        limit === null
          ? t('ncNumbering.renumber.fields.digits.help')
          : t('ncNumbering.renumber.fields.digits.helpLimit', { digits: limit.digits }),
      default: Math.min(numbering.digits ?? 0, limit?.digits ?? 9),
      required: true,
      min: 0,
      max: limit?.digits ?? 9,
    },
    {
      id: 'max',
      type: 'integer',
      label: t('ncNumbering.renumber.fields.max.label'),
      help:
        limit === null
          ? t('ncNumbering.renumber.fields.max.help')
          : t('ncNumbering.renumber.fields.max.helpLimit', { max: limit.max }),
      default: numbering.max ?? undefined,
      // Empty means "no maximum", which a dialect with a limit does not have.
      required: limit !== null,
      min: 1,
      max: limit?.max ?? 999999999,
    },
    // P4d (§6.6 rule 1): the increment worked out from the maximum; `step` is then not used.
    {
      id: 'fitToMax',
      type: 'bool',
      label: t('ncNumbering.renumber.fields.fitToMax.label'),
      help: t('ncNumbering.renumber.fields.fitToMax.help'),
      default: numbering.fitToMax === true,
    },
    {
      id: 'onOverflow',
      type: 'choice',
      label: t('ncNumbering.renumber.fields.onOverflow.label'),
      default: numbering.onOverflow ?? 'wrap',
      choices: [
        { label: t('ncNumbering.renumber.fields.onOverflow.wrap'), value: 'wrap' },
        { label: t('ncNumbering.renumber.fields.onOverflow.stop'), value: 'stop' },
      ],
    },
    {
      id: 'spacesAfter',
      type: 'integer',
      label: t('ncNumbering.renumber.fields.spacesAfter.label'),
      default: numbering.spacesAfter ?? 1,
      required: true,
      min: cp.profile.syntax.wordSeparatorRequired === true ? 1 : 0,
      max: 16,
    },
    // P4d (§6.6 rules 2 and 3).
    {
      id: 'alignColumn',
      type: 'integer',
      label: t('ncNumbering.renumber.fields.alignColumn.label'),
      help: t('ncNumbering.renumber.fields.alignColumn.help'),
      default: numbering.alignColumn ?? 0,
      required: true,
      min: 0,
      max: MAX_ALIGN_COLUMN,
    },
    {
      id: 'everyNth',
      type: 'integer',
      label: t('ncNumbering.renumber.fields.everyNth.label'),
      help: t('ncNumbering.renumber.fields.everyNth.help'),
      default: numbering.everyNth ?? 1,
      required: true,
      min: 1,
      max: MAX_EVERY_NTH,
    },
    {
      id: 'skipStartingWith',
      type: 'text',
      label: t('ncNumbering.renumber.fields.skipStartingWith.label'),
      help: t('ncNumbering.renumber.fields.skipStartingWith.help'),
      default: (numbering.skipStartingWith ?? []).join(' '),
    },
    // P4d (§6.6 rules 4–6).
    {
      id: 'skipContaining',
      type: 'text',
      label: t('ncNumbering.renumber.fields.skipContaining.label'),
      help: t('ncNumbering.renumber.fields.skipContaining.help'),
      default: (numbering.skipContaining ?? []).join(' '),
    },
    {
      id: 'skipFirst',
      type: 'integer',
      label: t('ncNumbering.renumber.fields.skipFirst.label'),
      help: t('ncNumbering.renumber.fields.skipFirst.help'),
      default: numbering.skipFirst ?? 0,
      required: true,
      min: 0,
      max: MAX_SKIP_LINES,
    },
    {
      id: 'skipLast',
      type: 'integer',
      label: t('ncNumbering.renumber.fields.skipLast.label'),
      help: t('ncNumbering.renumber.fields.skipLast.help'),
      default: numbering.skipLast ?? 0,
      required: true,
      min: 0,
      max: MAX_SKIP_LINES,
    },
    {
      id: 'startTrigger',
      type: 'text',
      label: t('ncNumbering.renumber.fields.startTrigger.label'),
      help: t('ncNumbering.renumber.fields.startTrigger.help'),
      default: numbering.startTrigger ?? '',
      maxLength: MAX_SKIP_TEXT,
    },
    {
      id: 'startAfterTrigger',
      type: 'bool',
      label: t('ncNumbering.renumber.fields.startAfterTrigger.label'),
      default: numbering.startAfterTrigger === true,
    },
    { id: 'skipEmpty', type: 'bool', label: t('ncNumbering.renumber.fields.skipEmpty.label'), default: numbering.skipEmpty === true },
    {
      id: 'restartAtProgramStart',
      type: 'bool',
      label: t('ncNumbering.renumber.fields.restartAtProgramStart.label'),
      default: numbering.restartAtProgramStart === true,
    },
    { id: 'onlyNumbered', type: 'bool', label: t('ncNumbering.renumber.fields.onlyNumbered.label'), default: numbering.onlyNumbered === true },
    {
      id: 'altPrefixes',
      type: 'text',
      label: t('ncNumbering.renumber.fields.altPrefixes.label'),
      help: t('ncNumbering.renumber.fields.altPrefixes.help'),
      default: (cp.profile.syntax.blockNumber.altPrefixes ?? []).join(' '),
    },
  ];
}

/**
 * The confirmation this transform asks for before it runs.
 *
 * Three cases, most concrete first:
 *
 *  - a consecutive dialect, numbered from a line that is not line 1: the numbers this run
 *    writes cannot line up with the blocks above and below the selection.
 *  - the program points at block numbers this run **cannot** follow: a target that is not
 *    there, one that is there twice, one outside the renumbered lines, a pointer from
 *    outside them into them, or a rule that says the target may be in the caller. The
 *    ones it can follow are rewritten and are not worth a dialog (M6, WP6.3).
 *  - a run that could not look outside its own lines at all.
 *
 * The reference scan is over the **document**, not over `lines`. A selection that holds
 * `N100` but not the `IF [#1 EQ 1] GOTO 100` above it used to pass the preflight without
 * a word and rewrite the jump target in silence (G8 M4).
 *
 * P4d (§6.6 rule 7): a run an option refuses, or one `skipFirst` and `skipLast` leave
 * nothing to do, writes nothing, so there is nothing to confirm; the run's summary says
 * why. The preflight asks the run's own questions to find out, the walk included where
 * `fitToMax` needs its count.
 */
function preflightOf(lines: string[], ctx: TransformContext): Msg | null {
  const numbering = ctx.cp.profile.numbering;
  if (numbering.mode === 'consecutive') {
    if (ctx.firstLine <= 1) return null;
    return { key: 'ncNumbering.renumber.consecutiveSelection', params: { start: numbering.start ?? 0 } };
  }

  const settings = settingsFor(ctx.cp, ctx.options);
  const cp = withAltPrefixes(ctx.cp, settings.altPrefixes);
  if (earlyRefusal(lines, settings, cp.profile.syntax.caseSensitive === true) !== null) return null;
  if (skipsEverything(lines, settings)) return null;

  // A dialect that joins blocks across lines, run on a fragment whose incoming state is
  // unknown: the first lines could be the tail of a block above and must not be numbered.
  if (continuationRisk(ctx, stateBefore(ctx))) return { key: 'ncNumbering.renumber.fragmentUnknown' };

  const scan = scanFor(lines, ctx, cp);
  const programs = indexPrograms(scan, cp);
  if (settings.fitToMax && settings.max !== null) {
    const { most } = selectRun(lines, ctx, cp, settings, scan, programs);
    if (fittedStep(settings.start, settings.max, most, settings.step) === null) return null;
  }

  // One line, one question: a `G71 P100 Q200` whose two targets are both gone is one
  // thing to look at, not two.
  const lineNumbers = new Set<number>();
  for (const decision of decideReferences(scan, programs, ctx.firstLine, lines.length, null, mainPrefixOf(cp))) {
    if (isTrouble(decision.outcome)) lineNumbers.add(decision.line);
  }
  let first = 0;
  for (const line of lineNumbers) if (first === 0 || line < first) first = line;

  // Before the more usual question: a run that starts the numbering over hands the same
  // number out several times, and then no reference can be rewritten with an answer a
  // control would resolve to one block. The run reports each of them; this says it first.
  if (scan.count > 0 && mayWrap(settings, scan, ctx.firstLine, lines.length)) {
    return {
      key: 'ncNumbering.renumber.referencesMayWrap',
      params: { count: scan.count, start: settings.start, max: settings.max ?? 0 },
    };
  }

  return referencePreflight(
    { count: lineNumbers.size, first, unchecked: scan.unchecked },
    { references: 'ncNumbering.renumber.references', unchecked: 'ncNumbering.renumber.referencesUnchecked' },
  );
}

/**
 * The first two walks (see "The advanced options"): what every line is, and which blocks
 * get a number. Shared by the run and the preflight, so both count the same blocks.
 */
function selectRun(
  lines: readonly string[],
  ctx: TransformContext,
  cp: CompiledProfile,
  settings: Settings,
  scan: ProgramScan,
  programs: ProgramIndex,
): { walk: Walk; picks: Uint8Array; most: number; triggerRow: number } {
  const caseSensitive = cp.profile.syntax.caseSensitive === true;
  const triggerRow = settings.startTrigger === '' ? -1 : triggerRowOf(lines, settings.startTrigger, caseSensitive);
  const from = triggerRow < 0 ? 0 : triggerRow + (settings.startAfterTrigger ? 1 : 0);
  const walk = walkLines(lines, ctx, cp, settings, from);
  if (settings.everyNth <= 1) return { walk, ...selectBlocks(walk, 1, () => false), triggerRow };

  // A main block keeps its number whatever `everyNth` says: without it the block is no
  // main block any more, and a block search can no longer start the program there (M9).
  const main = mainPrefixOf(cp);
  const referenced = referencedRows(scan, programs);
  const base = Math.max(0, Math.trunc(ctx.firstLine) - scan.firstLine);
  const keeps = (index: number): boolean =>
    (main !== null && walk.heads[index]?.number?.address === main) || referenced(base + index);
  return { walk, ...selectBlocks(walk, settings.everyNth, keeps), triggerRow };
}

function runRenumber(lines: string[], ctx: TransformContext): TransformResult {
  const settings = settingsFor(ctx.cp, ctx.options);
  const cp = withAltPrefixes(ctx.cp, settings.altPrefixes);
  const blockNumber = cp.profile.syntax.blockNumber;
  const prefixOut = blockNumber.mode === 'leading-integer' ? '' : (blockNumber.prefix ?? 'N');
  const main = mainPrefixOf(cp);

  // P4d (§6.6 rule 7): a refusal writes nothing, and says why as the summary.
  const refused = earlyRefusal(lines, settings, cp.profile.syntax.caseSensitive === true);
  if (refused !== null) return untouched(lines, refused);
  // §6.6 rule 5: the first and last lines together cover the scope.
  if (skipsEverything(lines, settings)) return untouched(lines, { key: 'ncNumbering.renumber.nothing' });

  // The references, over the whole document: a jump *above* the selection points into it
  // just as well, and the run's own walk only ever sees the selection (G8 M4). Read before
  // the numbering since P4d: `everyNth` keeps the blocks they name.
  const scan = scanFor(lines, ctx, cp);
  const programs = indexPrograms(scan, cp);
  const { walk, picks, most, triggerRow } = selectRun(lines, ctx, cp, settings, scan, programs);

  let step = settings.step;
  if (settings.fitToMax && settings.max !== null) {
    const fitted = fittedStep(settings.start, settings.max, most, settings.step);
    if (fitted === null) {
      return untouched(lines, refusal('doesNotFit', { count: most, start: settings.start, max: settings.max }));
    }
    step = fitted;
  }

  const out = lines.slice();
  const lineMap = new Int32Array(lines.length);
  const codes = walk.codes;
  const warnings: Msg[] = [];
  /**
   * Scope index → the digits of the block number that line carries after the run, as they
   * are written (`'20'`, `'0020'`): a dialect whose sequence numbers are names tells blocks
   * apart by exactly that text. [`REMOVED`] where `everyNth` took the number off.
   */
  const newTextOf = new Map<number, string>();
  let numbered = 0;
  let removed = 0;
  let keptNamed = 0;
  let value = settings.start;
  let stopped = false;
  let wraps = 0;
  let firstWrapLine = 0;
  let tabbed = false;
  let changedAny = false;

  for (let i = 0; i < lines.length; i++) {
    lineMap[i] = i;
    if (walk.restarts[i] === 1) value = settings.start;
    if (codes[i] !== BLOCK) continue;
    const line = lines[i];
    const head = walk.heads[i] as Head;

    if (stopped) {
      codes[i] = STOPPED;
      continue;
    }
    // §6.6 rule 3: a block `everyNth` passes over loses its number, skip marks kept.
    if (picks[i] === DROP) {
      if (head.number !== null) {
        out[i] = withoutNumber(line, head.number);
        newTextOf.set(i, REMOVED);
        removed++;
        changedAny = true;
      }
      continue;
    }

    if (settings.max !== null && value > settings.max) {
      if (settings.wrap) value = settings.start;
      // `stop`, or a start value that is itself above the maximum: there is no number
      // left to write, so the rest of the program keeps the numbers it has.
      if (!settings.wrap || value > settings.max) {
        stopped = true;
        warnings.push({ key: 'ncNumbering.renumber.overflowStopped', params: { line: ctx.firstLine + i, max: settings.max } });
        codes[i] = STOPPED;
        continue;
      }
      // Wrapping is not free, and it used to be silent: 12,000 blocks numbered from 10 in
      // steps of 10 with the shipped `max` of 99999 wrap twice and the program comes back
      // with 2,001 duplicate block numbers (G8 M4). Duplicates break block search and
      // restart on the control, and make `GOTO`, `M99 P` and `G71 P-Q` ambiguous — the
      // control takes the first match. `stop` says what it did; so does this now.
      wraps++;
      if (firstWrapLine === 0) firstWrapLine = ctx.firstLine + i;
      codes[i] = WRAPPED;
    }

    if (picks[i] === NUMBER_KEPT) keptNamed++;
    const digits = settings.digits > 0 ? String(value).padStart(settings.digits, '0') : String(value);
    // A main block keeps its own prefix (`:20` becomes `:30`, never `N30`).
    const prefix = main !== null && head.number !== null && head.number.address === main ? main : prefixOut;
    out[i] = rebuild(line, head, prefix + digits, settings.spacesAfter, settings.alignColumn);
    if (settings.alignColumn > 0 && !tabbed) tabbed = tabInHead(line, head);
    if (head.number === null || head.number.text !== prefix + digits) changedAny = true;
    newTextOf.set(i, digits);
    numbered++;
    value += step;
  }

  // One warning per answer that was cut down: a run that only asked for too high a maximum
  // used to be told it had been held to "at most 0 digits" as well.
  if (settings.maxLimited && settings.max !== null) {
    warnings.push({ key: 'ncNumbering.renumber.limitedMax', params: { max: settings.max } });
  }
  if (settings.digitsLimited) {
    warnings.push({ key: 'ncNumbering.renumber.limitedDigits', params: { digits: settings.digits } });
  }
  if (wraps > 0) {
    warnings.push({
      key: 'ncNumbering.renumber.wrapped',
      params: { count: wraps, line: firstWrapLine, start: settings.start, max: settings.max ?? 0 },
    });
  }
  // P4d (§6.6 rules 1–3): what the options did that the numbers alone do not say.
  if (settings.fitToMax && settings.max !== null && most >= 2) {
    warnings.push({ key: 'ncNumbering.renumber.fitted', params: { step, count: most, start: settings.start, max: settings.max } });
  }
  if (removed > 0) warnings.push({ key: 'ncNumbering.renumber.everyNthRemoved', params: { count: removed } });
  if (keptNamed > 0) warnings.push({ key: 'ncNumbering.renumber.everyNthKept', params: { count: keptNamed } });
  if (tabbed) warnings.push({ key: 'ncNumbering.renumber.alignTabs' });

  const writtenOf = (index: number): string | null => newTextOf.get(index) ?? null;
  const decisions = decideReferences(scan, programs, ctx.firstLine, lines.length, writtenOf, main);
  applyReferences(out, lines, decisions);

  // Where a value left as written lands now (NC-8): rows of the scope are read as the run
  // wrote them, every other row as it stands in the document.
  const base = Math.max(0, Math.trunc(ctx.firstLine) - scan.firstLine);
  const textAfter = (row: number): string =>
    row >= base && row < base + out.length ? out[row - base] : (scan.scanned[row] ?? '');
  const landings = new LandingFinder(
    scan,
    (row) => keyAfter(scan, row, base, lines.length, writtenOf, main),
    (row, word) => {
      const program = targetProgramOf(scan, programs, row, word);
      if ('segment' in program) return program.segment;
      return program.refused === 'notInFile' ? NOT_IN_FILE : NO_PROGRAM;
    },
  );

  const rowText: Record<Outcome, string> = {
    rewritten: '',
    unchanged: '',
    kept: t('ncNumbering.renumber.referenceKeptRow'),
    missing: t('ncNumbering.renumber.referenceMissingRow'),
    duplicate: t('ncNumbering.renumber.referenceDuplicateRow'),
    outside: t('ncNumbering.renumber.referenceOutsideRow'),
    incoming: t('ncNumbering.renumber.referenceIncomingRow'),
    notNumber: t('ncNumbering.renumber.referenceNotNumberRow'),
    ambiguous: t('ncNumbering.renumber.referenceAmbiguousRow'),
    noCall: t('ncNumbering.renumber.referenceNoCallRow'),
    notInFile: t('ncNumbering.renumber.referenceNotInFileRow'),
    programTwice: t('ncNumbering.renumber.referenceProgramTwiceRow'),
    noCaller: t('ncNumbering.renumber.referenceNoCallerRow'),
    callers: t('ncNumbering.renumber.referenceCallersRow'),
    interrupt: t('ncNumbering.renumber.referenceInterruptRow'),
  };
  // P4d review NC-9: a rule of the own program that never rewrites (a turning cycle read
  // with a milling profile) has its own words; `kept` says it of a block of another program.
  const keptOwnText = t('ncNumbering.renumber.referenceKeptOwnRow');
  const referenceRows: Located[] = [];
  const seen = new Set<string>();
  let rewritten = 0;
  let kept = 0;
  let unresolved = 0;
  for (const decision of decisions) {
    if (decision.outcome === 'rewritten') rewritten++;
    if (!isTrouble(decision.outcome)) continue;
    if (decision.outcome === 'kept') kept++;
    else unresolved++;
    // Two values of one cycle call that fail the same way are one row, not two.
    const key = `${decision.line}:${decision.outcome}`;
    if (!seen.has(key)) {
      seen.add(key);
      if (referenceRows.length < SKIP_LIMIT) {
        const message = decision.outcome === 'kept' && decision.word.program === 'own' ? keptOwnText : rowText[decision.outcome];
        referenceRows.push({ line: decision.line, message, severity: 'warning' });
      }
    }

    // The value stands as written; say where it lands now when its block moved away.
    const row = decision.line - scan.firstLine;
    const landing = landings.landingOf(row, decision.word);
    if (landing === null) continue;
    // `G71 P100 Q100` is one target, not two.
    const landingKey = `${decision.line}:lands:${String(decision.word.key)}`;
    if (seen.has(landingKey)) continue;
    seen.add(landingKey);
    if (referenceRows.length >= SKIP_LIMIT) continue;
    const params = {
      reference: quoted(textAfter(row)),
      target: (main !== null && isMainKey(decision.word.key, main) ? main : prefixOut) + decision.word.text,
      line: scan.firstLine + landing.targetRow,
    };
    referenceRows.push({
      line: decision.line,
      message:
        landing.landingRow < 0
          ? t('ncNumbering.renumber.referenceGoneRow', params)
          : t('ncNumbering.renumber.referenceLandsRow', {
              ...params,
              landing: scan.firstLine + landing.landingRow,
              block: quoted(textAfter(landing.landingRow)),
            }),
      severity: 'warning',
    });
  }

  // P4d review NC-4: a number the run put on several blocks of a program (one it skipped,
  // or one above the start text, kept the same number). Not refused: the user asked for
  // these options, and the warning and the rows say what came of it. A run that wrapped has
  // said so already, with a row on every block that got a number twice.
  const madeTwice =
    wraps > 0
      ? { rows: [], count: 0 }
      : duplicatesMade(scan, keysAfter(scan, base, lines.length, writtenOf, main), (row) => keyAfter(scan, row, base, lines.length, writtenOf, main));
  const duplicateRows: Located[] = [];
  if (madeTwice.count > 0) {
    warnings.push({ key: 'ncNumbering.renumber.duplicatesMade', params: { count: madeTwice.count } });
    const message = t('ncNumbering.renumber.duplicateMadeRow');
    for (const row of madeTwice.rows) {
      if (duplicateRows.length >= SKIP_LIMIT) break;
      duplicateRows.push({ line: scan.firstLine + row, message, severity: 'warning' });
    }
  }

  if (rewritten > 0) warnings.push({ key: 'ncNumbering.renumber.referencesRewritten', params: { count: rewritten } });
  if (kept > 0) warnings.push({ key: 'ncNumbering.renumber.referencesKept', params: { count: kept } });
  if (unresolved > 0) warnings.push({ key: 'ncNumbering.renumber.referencesUnresolved', params: { count: unresolved } });

  // The skipped lines, in line order and capped (`Located.message` is display text, one
  // lookup per reason rather than one per line).
  const reason: Record<number, string> = {
    [MARKER]: t('ncNumbering.renumber.skippedProgramMarker'),
    [PREFIX]: t('ncNumbering.renumber.skippedByPrefix'),
    [CONTAINING]: t('ncNumbering.renumber.skippedContaining'),
    [CONTINUED]: t('ncNumbering.renumber.skippedContinued'),
    [NAME]: t('ncNumbering.renumber.skippedName'),
    [NOT_NUMBERED]: t('ncNumbering.renumber.skippedNotNumbered'),
    [STOPPED]: t('ncNumbering.renumber.skippedStopped'),
    [WRAPPED]: t('ncNumbering.renumber.wrappedRow'),
  };
  const skipped: Located[] = [];
  let skippedCount = 0;
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (code === LEFT || code === BLOCK || code === QUIET) continue;
    if (code !== WRAPPED) skippedCount++;
    if (skipped.length < SKIP_LIMIT) {
      skipped.push({ line: ctx.firstLine + i, message: reason[code], severity: code === WRAPPED ? 'warning' : 'info' });
    }
  }

  // P4d (§6.6 rules 5 and 6): the regions an option leaves alone, one row each.
  const regions: Located[] = [];
  const length = scopeLength(lines);
  if (settings.skipFirst > 0) {
    regions.push({ line: ctx.firstLine, message: t('ncNumbering.renumber.skippedFirstRow', { count: settings.skipFirst }), severity: 'info' });
  }
  if (triggerRow >= 0) {
    const key = settings.startAfterTrigger ? 'ncNumbering.renumber.startAfterTriggerRow' : 'ncNumbering.renumber.startTriggerRow';
    regions.push({ line: ctx.firstLine + triggerRow, message: t(key, { text: settings.startTrigger }), severity: 'info' });
  }
  if (settings.skipLast > 0) {
    regions.push({
      line: ctx.firstLine + length - settings.skipLast,
      message: t('ncNumbering.renumber.skippedLastRow', { count: settings.skipLast }),
      severity: 'info',
    });
  }
  regions.sort((a, b) => a.line - b.line);

  const rows = mergeRows(mergeRows(mergeRows(regions, skipped, SKIP_LIMIT), referenceRows, SKIP_LIMIT), duplicateRows, SKIP_LIMIT);
  const listed = skippedCount + wraps + seen.size + regions.length + madeTwice.rows.length;
  if (listed > rows.length) warnings.push({ key: 'ncNumbering.renumber.skippedTruncated', params: { shown: rows.length, total: listed } });

  const summary: Msg =
    numbered === 0 && skippedCount === 0
      ? { key: 'ncNumbering.renumber.nothing' }
      : skippedCount === 0
        ? { key: 'ncNumbering.renumber.summary', params: { count: numbered } }
        : { key: 'ncNumbering.renumber.summarySkipped', params: { count: numbered, skipped: skippedCount } };

  const result: TransformResult = { lines: out, lineMap, summary, skipped: rows, warnings };
  // §6.6 rule 11: what the run did to the numbers of the named programs, for the other
  // open documents. Only a run that changed a number has an outcome, and the consecutive
  // dialect has none: its blocks are named by labels, never by their numbers.
  if (changedAny && !settings.consecutive) result.renumbered = outcomeOf(scan, programs, base, lines.length, writtenOf, main, prefixOut);
  return result;
}

export const renumber: TransformDef = {
  id: 'renumber',
  title: 'ncNumbering.renumber.title',
  available(): true | Msg {
    return true;
  },
  options(cp: CompiledProfile): FieldSpec[] {
    return optionFields(cp);
  },
  preflight(lines: string[], ctx: TransformContext): Msg | null {
    return preflightOf(lines, ctx);
  },
  run(lines: string[], ctx: TransformContext): TransformResult {
    return runRenumber(lines, ctx);
  },
};
