// The dialect-profile contract (plan §7.4, AD-11). Written by the M3 prelude (P3) and
// binding for every M3 work package: an implementation may change, a signature here may
// not (a deviation needs a hand-off note and integration approval).
//
// A profile is everything the app knows about one kind of NC file: extensions and
// detection, comment and block-number syntax, how a tool call looks, how blocks are
// numbered, which outline rules build the program map. The built-ins are JSON files in
// `$lib/data/profiles/`; `validateProfile` turns unknown JSON into a `Profile` and
// `compileProfile` turns a `Profile` into the `CompiledProfile` that every NC feature
// reads at runtime.
//
// This file holds types only (plus the two function signatures whose implementations live
// next to it), so it can be imported from anywhere, `core/` included (AD-1).
//
// **Pattern rule (AD-11).** Every `Pattern` stays inside the common subset of ECMAScript
// and Python `re`, because `gedit_nc.py` compiles the same profiles (§7.10): no
// variable-width lookbehind, no `\p{…}`, no `\k<…>`. Code patterns use `(?<![A-Z])`
// before the address and `(?!\d)` after the number instead of `\b`, because CAM output is
// packed (`N10T1M6`) and `\b` finds no boundary between a digit and the next letter.
// Flags are never written into a pattern; `compileProfile` adds `i` unless
// `syntax.caseSensitive` is set.

import type { Eol } from '$lib/app/types';
import type { NumberInput, ParamSource } from '$lib/core/machines/types';
import type { ProfileCompare } from '$lib/core/compare/types';
import type { ChannelParams } from '$lib/core/channels/types';
import type { Role } from '$lib/core/grammar/roles';

/** A regular expression as ECMAScript source, without delimiters and without flags. */
export type Pattern = string;

/**
 * What an outline rule marks a line as. The program map has one icon per kind.
 *
 * M12 (P12, §7.14): `channel` and `sync` are produced by the **channel service** only — a
 * channel group row and a blocking wait mark (AD-32). `validateProfile` rejects them in a
 * profile's own `outline` rules, so no profile can invent a channel row. A `switch` without
 * a default must handle them.
 */
export type OutlineKind =
  | 'tool'
  | 'program'
  | 'section'
  | 'comment'
  | 'label'
  | 'stop'
  | 'end'
  | 'subprogram-call'
  | 'channel'
  | 'sync';

/**
 * What kind of machine the profile describes (P6, §7.1). It is **not** a machine
 * configuration (AD-31): it says "turning" or "milling", not which control setting a
 * particular machine in the workshop runs with. Scripts, hover and the inspector read it
 * for their auto options and their wording ("diameter", "per revolution").
 */
export type MachineType = 'mill' | 'lathe';

/** The unit a feed word is in, once the modal state is known (AD-19). */
export type FeedUnit = 'per-minute' | 'per-rev' | 'per-tooth' | 'inverse-time' | 'travel-time' | 'unknown';

/** `profile.numbering`, read by renumbering, auto-numbering and go-to-block (WP4.2). */
export interface NumberingOptions {
  /** `free`: any start and step. `consecutive` (Klartext): every block, step 1, no gaps. */
  mode?: 'free' | 'consecutive';
  start: number;
  step: number;
  /** Zero padding; 0 or missing means none. */
  digits?: number;
  max?: number;
  onOverflow?: 'wrap' | 'stop';
  spacesAfter?: number;
  /** Lines starting with one of these (after trimming) keep their text unnumbered. */
  skipStartingWith?: string[];
  skipEmpty?: boolean;
  restartAtProgramStart?: boolean;
  /** Only renumber lines that already carry a block number. */
  onlyNumbered?: boolean;
  /**
   * P4d (plan §6.6 rule 1): pick the largest whole increment that keeps the last numbered
   * block at or below `max`; `step` is then not used. Needs a `max`.
   */
  fitToMax?: boolean;
  /**
   * P4d (§6.6 rule 2): the column (1-based, counted in characters) where the code behind
   * a new block number starts. 0 or missing: off, `spacesAfter` decides the gap.
   */
  alignColumn?: number;
  /**
   * P4d (§6.6 rule 3): number every Nth block; the blocks between lose their number,
   * except a block a reference names. 1 or missing: every block.
   */
  everyNth?: number;
  /** P4d (§6.6 rule 4): lines containing one of these texts keep their text unnumbered. */
  skipContaining?: string[];
  /** P4d (§6.6 rule 5): the first this many lines of the run's scope are left as they are. */
  skipFirst?: number;
  /** P4d (§6.6 rule 5): the last this many lines of the run's scope are left as they are. */
  skipLast?: number;
  /**
   * P4d (§6.6 rule 6): numbering starts at the first line of the scope that contains this
   * text (or at the line after it, `startAfterTrigger`); the lines above keep their text.
   * Empty or missing: from the first line.
   */
  startTrigger?: string;
  startAfterTrigger?: boolean;
  /**
   * Block-number references that have to follow a renumber (`M99 P…`, `GOTO…`).
   *
   * P6: `rewrite` defaults to true — the value is rewritten with the number it points at.
   * `false` means "report only": a Fanuc `M99 P` may name a block in the **caller**, which
   * a renumber of this file cannot see, so rewriting it would point the return somewhere
   * else (F42). P4d adds `program` (§6.6 rule 8): which program's block the value names.
   */
  references?: ReferenceRule[];
  /**
   * P4d (§6.6 rule 9): the lines that call another program, and the word that names it
   * (`M98 P1000`, `G65 P9010`). Read only to find the program a `program: 'called'` or
   * `'caller'` reference points into; nothing else reads them.
   */
  calls?: CallRule[];
}

/**
 * Which program's block a reference names (P4d, plan §6.6 rule 8). `own` (the default):
 * the program the reference stands in (`GOTO`, `M98 Q` without `P`, `G71 P… Q…`).
 * `called`: the program the same line calls through a `numbering.calls` rule (`M98 P1000
 * Q30`). `caller`: the program that calls the one the reference stands in (`M99 P30`).
 */
export type ReferenceProgram = 'own' | 'called' | 'caller';

/** One `numbering.references` rule (§7.1, P4d §6.6). */
export interface ReferenceRule {
  trigger: Pattern;
  addresses: string[];
  rewrite?: boolean;
  program?: ReferenceProgram;
}

/**
 * One `numbering.calls` rule (P4d, plan §6.6 rule 9). A line calls a program when the
 * trigger matches the comment-masked line; the program is the plain number of the word
 * `address` on that line, or a program-name token (`syntax.programNames`, `<NAME>`).
 *
 * `maxDigits` and `repeatAddress` say how the number is read when a repeat count may share
 * the word (Fanuc `M98 P21010` = 2 × O1010; with 5 to 8 digits the count is an `L` word):
 * a value of at most `maxDigits` digits, or any value on a line that carries a
 * `repeatAddress` word, is the program number; a longer value without it is a repeat count
 * followed by a program number of `maxDigits` digits. Without `maxDigits` the whole value is
 * the program number.
 */
export interface CallRule {
  trigger: Pattern;
  address: string;
  maxDigits?: number;
  repeatAddress?: string;
  /**
   * P4d review NC-1 (§7 row): the word that makes a line on which the rule fires without
   * `address` and without a program name a **local call** (Fanuc `M98 Q30`: the program
   * runs its own blocks from N30 up to the next return as a subprogram). A rule without it
   * that fires without its word calls nothing (a bare `M96`, `G65` without `P`).
   */
  localAddress?: string;
  /**
   * P4d review NC-2 (§7 row): the rule starts its program as an interrupt (Fanuc `M96 P…`).
   * Such a program runs when a signal arrives and returns into whichever program it
   * interrupted, so this call never proves which program an `M99 P` in it returns to.
   */
  interrupt?: boolean;
}

/** `profile.numberFormat`, read by `formatNumber` (WP3.2) and the M4 transforms. */
export interface NumberFormatOptions {
  /** `keep`: leave the written precision alone. A number rounds half away from zero. */
  decimals: 'keep' | number;
  trailingZeros: 'keep' | 'drop';
  /** Keep a trailing decimal point when the fraction is dropped (`10.` stays `10.`). */
  keepPoint: boolean;
  /**
   * `signed` (P4a integration, plan §7 #308): `+` before a value whose written form had a
   * sign of either kind, so a Klartext `Y-2.5` turned positive is written `Y+12.5` while
   * `F500` stays `F500`. The Klartext profile uses it.
   */
  plusSign: 'keep' | 'always' | 'never' | 'signed';
}

/**
 * P13 (AD-30), P4c. The typing options of a profile; every one defaults to false when absent.
 *
 * - `forceUppercase`: a plain letter typed outside a comment, a string and kept text
 *   (`TokenKind` `'comment'`, `'string'`, `'text'`) is typed in upper case. Paste, a
 *   modifier, an IME composition and every edit that is not a keystroke are left alone.
 * - `preventLineJoin`: Backspace at column 1 and Delete at the end of a line, with one
 *   empty selection, do nothing and say why in the status bar. A selected line break can
 *   still be deleted.
 * - `autoSpace` (P4c, plan §6.5): a letter that starts a new address word, typed straight
 *   after a finished word, gets a space in front of it (`G1X` becomes `G1 X`).
 * - `autoNumber` (P4c, plan §6.5): Enter at the end of a numbered block starts the next
 *   line with the next block number.
 *
 * `autoSpace` and `autoNumber` are **read as `=== true`**: absent means off, which is the
 * loader default of the owner's answer A13 (2026-10-17). No built-in profile carries them
 * (P4d is the sole writer of `src/lib/data/profiles/*.json`), and no default is written into
 * a resolved profile, so an effective profile and its goldens stay as they were. A profile
 * that wants them on sets them itself; the session switches of `contrib/typing.ts` override
 * the profile for the running session.
 */
export interface ProfileEditing {
  forceUppercase?: boolean;
  preventLineJoin?: boolean;
  autoSpace?: boolean;
  autoNumber?: boolean;
  /**
   * P4h (plan §6.10 rule 9; Q4-19). The tab width of this profile's documents, 1 to 16. Present,
   * it wins over the setting `editor.tabWidth` for a document of this profile; absent, the
   * setting applies. No built-in profile sets it (P4.42 removes the unread `4` of `fanuc-gcode`).
   */
  tabWidth?: number;
  /**
   * P4h (§6.10 rule 9; Q4-19). Column rulers of this profile's documents: at most 8 whole
   * numbers from 1 to 1000, no number twice. Present (an empty list too), it replaces the setting
   * `editor.rulers` for a document of this profile; absent, the setting applies.
   */
  rulers?: number[];
}

/**
 * P4h (plan §6.10 rule 6). Role colours of one theme: a role to a `#rrggbb` value. Every value
 * reaches the contrast limit against the editor background of its theme
 * (`core/grammar/contrast.ts`, `MIN_ROLE_CONTRAST`); the validators refuse one that does not.
 */
export type RoleColorMap = Partial<Record<Role, string>>;

/**
 * P4h (§6.10 rule 6). `profile.colors`, and the same shape as the setting
 * `appearance.roleColors`: a palette per theme. A colour here wins over the user's role colour
 * and over the built-in one, for this profile's documents only (the theme rule
 * `<role>.<profile id>`).
 */
export interface ProfileColors {
  dark?: RoleColorMap;
  light?: RoleColorMap;
}

/**
 * One dialect profile, as it is stored in JSON.
 *
 * P1 uses the subset below. Fields of later phases (`editing`, `onSave`,
 * `highlight`, `colors`, `extends`, …) are kept as written by the index signature, so a
 * profile file survives a round trip through the app untouched.
 */
export interface Profile {
  /** Stable id; it is also the Monaco language id of the documents that use it. */
  id: string;
  /** Full name, e.g. for the profile list. */
  name: string;
  /** Short name for the status bar. */
  shortName: string;
  version: number;
  /**
   * P6, AD-16. Parent profile id. The child is merged over its **resolved** parent before
   * validation, and the field is kept on the result so the UI can show the chain. A child
   * must set its own `id`, `name` and `shortName`.
   */
  extends?: string;
  /** P6. Default `'mill'`. See [`MachineType`]: the kind of machine, not a machine. */
  machineType?: MachineType;
  /**
   * P6, AD-19 rule 8 and AD-31. The power-on state.
   *
   * `initial` is modal group → canonical code in force at the top of a program, as the
   * control comes up. A built-in JSON writes only `initial`; `units`, `diameter` and
   * `sources` are written by `applyMachine` from the document's machine or from the
   * defaults in `machineParams`. All of them are applied as **assumed** (line 0), and
   * `sources` says where each one came from, so the interpreter and the UI can tell a
   * value the machine states from one gEdit fell back on.
   */
  modal?: {
    initial?: Record<string, string>;
    units?: 'mm' | 'inch';
    diameter?: 'on' | 'off';
    /** A key per modal group, plus `units` and `diameter`. */
    sources?: Record<string, ParamSource>;
  };
  /**
   * P6, AD-31. What a machine configuration of this profile may set, with the documented
   * defaults (§7.15, §8.8). Absent: the profile has no machine parameters (Klartext) and
   * no machine item in the status bar.
   */
  machineParams?: MachineParamsDecl;
  /**
   * Which grammar generator builds the Monarch rules (WP3.4).
   *
   * P8 widens the P1 union. `okuma` and `sinumerik` are word-address dialects too, but
   * each breaks the ISO shape in a way a flag cannot express: Okuma reads `( … )` as a
   * comment and `[ … ]` as expression brackets, names its blocks (`NLAP1`) and writes
   * two-letter addresses with `=`; Sinumerik comments with `;`, keeps `( … )` for call
   * arguments and strings, and labels a block with `NAME:`.
   */
  grammar: 'iso' | 'klartext' | 'okuma' | 'sinumerik';
  /** Id of the code database this profile reads (`data/codes/<codes>.json`). */
  codes: string;
  files: {
    /** Without the dot, preferred one first. */
    extensions: string[];
    defaultExtension: string;
    /** Name of the file-dialog filter (`[]` on macOS, F7/AD-7). */
    filterName: string;
    encoding: 'keep';
    lineEnding: 'keep';
    newFileLineEnding: Eol;
  };
  detect: {
    /** Extension (lower case, no dot) → weight. */
    extensions: Record<string, number>;
    /** Per line, only the strongest matching pattern counts (AD-11). */
    content: { pattern: Pattern; weight: number }[];
    /** A file inside one of these folders picks this profile outright. */
    folders?: string[];
    /** Tie-break; higher wins. */
    priority?: number;
    /**
     * Evidence that a file is **not** this profile's (M9 NC review F3): when one of these
     * patterns matches any scanned line, the profile scores nothing for that file,
     * whatever its content rules add up to. Presence, not weight: the Siemens milling
     * profile lists the turning words, because one `DIAMON` or `LIMS=` makes a program a
     * turning (or mill-turn) program however many milling operations it has (R2).
     */
    vetoes?: Pattern[];
  };
  syntax: {
    /** Default false: patterns and codes are matched case-insensitively. */
    caseSensitive?: boolean;
    /**
     * True when `"` opens a string in this dialect (Klartext tool and label names).
     * Default false: Fanuc has no strings, and a stray quote there is just a character.
     */
    strings?: boolean;
    /** `end: null` means the comment runs to the end of the line. */
    comments: { start: string; end: string | null }[];
    sectionHeading?: Pattern;
    /** Matches the trailing marker that joins this line to the next (Klartext `~`). */
    continuation?: Pattern;
    /**
     * The marker itself, for the places that have to *write* one (the multi-line cycle
     * snippet of the assistant). `continuation` can only recognise it.
     */
    continuationMark?: string;
    /**
     * M8 (§7.16 #27). A line whose start matches this belongs to the block **above** it: the
     * leading marker of Okuma's `$` lines (`N001 G71 X27.55 Z-30 B60 D0.7 U0.1`, then
     * `$ H2.45 L2 F2 M23 M32 M73`). Anchored with `^`. The line tokenizes as it did — the
     * marker is not a token kind of its own — but every reader that works in blocks
     * (the modal interpreters, the scripts, the program checks) reads it as part of the
     * block above, so the lead on it is still the lead of that block's thread cycle.
     */
    continuationStart?: Pattern;
    /**
     * `plainLevel` (M10 review, NC-9): the level a bare mark (`/`) is, `'0'` to `'9'`.
     * Sinumerik reads `/` as `/0` (absent: `'0'`); a Fanuc control reads `/` and `/1` as one
     * switch (BDT1), so its profiles say `'1'`. Insert and remove block skip treat the bare
     * mark and that digit as one level.
     */
    blockSkip?: {
      chars: string;
      position: 'before-number' | 'after-number' | 'either';
      levels?: boolean;
      plainLevel?: '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
    };
    blockNumber: {
      mode: 'prefix' | 'leading-integer';
      prefix?: string;
      altPrefixes?: string[];
      mandatory: boolean;
      /**
       * P9 (§7.1, §7.16, R4). The prefix of a **main** block number, the second kind of
       * block number a control may have (Sinumerik `:123`, syntax-sinumerik §3.1): a
       * block number and a jump target like `N123`, which marks the block that starts a
       * machining section. One character that is not a letter, a digit or a blank.
       *
       * At the head of a block it reads as one `blockNumber` token whose `address` is
       * this character, never as the `:1234` tape marker beside `O1234`; renumbering
       * numbers it in sequence with the others and keeps its prefix, so a main block stays
       * one. Unlike `altPrefixes`, which a renumber rewrites to `prefix`. Absent: no main
       * blocks, and `:` keeps its P1 reading. WP9.3 reads it (tokenizers, grammar), WP9.5
       * (renumber).
       */
      mainPrefix?: string;
    };
    decimalSeparator: '.' | ',';
    /** True when `X10` and `X10.` mean different values (Fanuc increment system). */
    decimalPointSignificant: boolean;
    /** True when words must be separated by whitespace (Klartext); false for packed words. */
    wordSeparatorRequired: boolean;
    /** Letter in front of an axis word that makes it incremental (Klartext `I`). */
    incrementalPrefix?: string;
    /** Matches a variable reference (`#101`, `Q12`, `QL3`). */
    variables?: Pattern;
    /** Words the tokenizer reads before single-letter addresses (`GOTO`, `TOOL CALL`). */
    keywords?: string[];
    /** Longest block the control accepts; used by the lint rules and the rulers. */
    maxLineLength?: number;
    /**
     * M10 (WP10.2, the program checks). The most digits a word may have once the control
     * has converted it to increments (Fanuc: 8). The program checks report a longer one.
     */
    maxWordDigits?: number;
    /** M10 (WP10.2). The most M codes the control takes in one block (Okuma: 8). */
    maxMCodes?: number;
    /**
     * P8. The block-number prefix also carries **names**: `N` followed by a letter-led
     * name (Okuma `NLAP1`) is a `label` token, never a block number, so renumbering never
     * touches it and go-to-block never offers it. M8 integration: the separator behind the
     * field belongs to it, behind a number as much as behind a name, so `removeSpaces`
     * never joins a block number to its block on such a profile (syntax-okuma §3.1).
     */
    sequenceNames?: boolean;
    /**
     * P8. An address that matches this at the start of a word takes `=` and an expression
     * (Okuma `SB=1200`, Sinumerik `CR=15`, `S3=2500`, `R1=R2*2`).
     *
     * The token stays a `word`: `address` is the letters (`'SB'`), `valueText` the
     * right-hand side, and `value` is null unless the right-hand side is a plain number.
     * The address is the whole identifier (letters, digits, `_`) in front of the `=`: the
     * pattern is tried only at the start of an identifier with an `=` (not `==`) behind it,
     * and its match has to be that identifier (§7.16 #18).
     */
    assignment?: Pattern;
    /**
     * P8. A label definition at the start of a block (Sinumerik `LOOP_A:`), with the named
     * group `name`. The rule has to run **before** the block-number rule, because a label
     * may start with the block-number prefix (`NEXT_PART:`).
     */
    labels?: Pattern;
    /**
     * P8. An identifier written directly in front of `(` is one `call` token up to the
     * matching `)` (`CYCLE81(10,0,2,-12)`, `MSG("TEXT")`, `L10(1)`). Nothing inside the
     * brackets is tokenized: the arguments are the call's `valueText`.
     * A name of [`names`] is the same call with blanks between it and its bracket
     * (`MSG ("TEXT")`, `CYCLE840 (…)`); a letter with a number is a call only with its
     * bracket touching it (`L10(1)`, while `L10 (1)` is an `L` word) (§7.16 #17).
     */
    calls?: boolean;
    /**
     * P8. System variables, which are read but never written by a program: Sinumerik
     * `\$[A-Z_][A-Z0-9_]*`, Okuma `V[A-Z][A-Z0-9]{3}`. Tried before [`variables`], so
     * Okuma's `VZOFZ` does not read as the common variable `V` with a value.
     */
    systemVariables?: Pattern;
    /**
     * P4a fix B1 (NC-6; plan §7 #314). The number from which on a numbered variable of
     * [`variables`] is one of the control's own system variables (Fanuc `1000`: `#5221` is the X
     * of `G54`). For a dialect that writes its system variables like its common ones, where
     * [`systemVariables`] cannot tell them apart. Read by the geometry scripts only: an
     * assignment to a system variable may move the coordinate system, so they refuse it. It
     * changes no token.
     */
    systemVariableNumbers?: number;
    /**
     * v1.2.0 manual-check fix round (D6-7). An incremental move after a change of the zero point
     * (a shift code, a work offset code) also travels that change, until the axis is written
     * absolutely (Sinumerik setting data SD42440 at 1). Read by the geometry scripts only:
     * rotate and mirror refuse such a move (`shift-increment`). It changes no token.
     */
    incrementTravelsShift?: boolean;
    /**
     * v1.2.0 review round (D6-4). The control's tool centre point control can read its
     * coordinates in the table's or in the workpiece's coordinate system (a machine parameter:
     * Fanuc 19696 bit 5), and gEdit's Translate reads them in the table's. Read by Translate
     * only: the first block it moves under tool centre point control carries an information
     * row and the message a sentence that says so (`tcp-table`). It changes no token.
     */
    tcpTableCoordinates?: boolean;
    /**
     * v1.2.0 review round (NC-9). The point-less-feeds choices
     * (`machineParams.numberInput.pointlessFeeds`) that stand for a tape format in which a
     * drilling cycle's `R` can be an absolute position (Fanuc lathe: the Series 15 format, with
     * parameter 5102 bit 6). Read by Translate only: on a machine with one of these choices, a
     * cycle block whose `R` the shift leaves as written (`position: 'none'`) carries an
     * information row (`cycle-r-left`). It changes no token.
     */
    cycleRAbsoluteWith?: string[];
    /**
     * P8. A header on the **first line** of the file, read as one `programMarker`: Okuma
     * `^\$[^%]*%`, Sinumerik `^%_N_\w+_(MPF|SPF)`. It is not an NC block, and the `$` of
     * the Okuma form is not the hexadecimal constant of an expression.
     */
    header?: Pattern;
    /**
     * M8 integration (§7.16). A name the program gives itself — a variable, a jump target,
     * a subprogram called by its name — where a word could stand: Sinumerik
     * `[A-Z_]{2}[A-Z0-9_]*` (a name starts with two letters or underscores), Okuma
     * `[A-Z]{2}[A-Z0-9]*` (a local variable, or a function in front of `[`).
     *
     * The whole match is one `unknown` token, never a run of one-letter words, so `XBOT`
     * is not an X word, `PASS2` carries no S word of 2 and `LOOP_N2` no block number. A
     * keyword is only a keyword where the name at its position is no longer than it
     * (`LOOP_A` is a name, `LOOP` a keyword). Tried after every other rule except the
     * packed one-letter words, so an assignment (`XNOW=62`), a call and a label keep
     * their own tokens.
     */
    names?: Pattern;
    /**
     * Decimal comma (§7.16 / R4). A second character that also starts a fraction when a
     * number is *read*, alongside `decimalSeparator` (Klartext CAM output writes both:
     * the manual's `.` and the owner's post's `,`). It never changes what a *new* number
     * is written with — `decimalSeparator` alone still decides that — but a number that
     * is rewritten keeps the separator it was written with, point or comma.
     */
    decimalSeparatorAlt?: '.' | ',';
    /**
     * Phase 2 (§7.16). A program **name** written in place of a program number: Fanuc
     * `<[A-Za-z0-9+\-_.]+>` (`<SHAFT_T12>`), at the head of a program and behind the call
     * words (`M98 <SUB_1> L2`, `G65 <MACRO_A> A1.`).
     *
     * The whole match is one `programMarker` token wherever it stands outside a comment,
     * never a run of address words, so no transform or script reads a word inside it. It
     * carries no `address` and no value: what the program is called is `program.start`'s
     * answer. The comment mask writes `_` for each of its letters and digits and keeps the
     * rest (`<SHAFT-T12>` masks as `<_____-___>`), so the tool, end and map rules cannot
     * find a `T12` or an `M30` in it while a rule that looks for the name's shape still
     * finds it — and the map shows the name as written, read off the real line.
     */
    programNames?: Pattern;
    /**
     * P9 (§7.1, §7.16, R4). An assignment word may carry **one bracket index** between its
     * identifier and the `=`: Sinumerik `LIMS[2]=1800`, `S[2]=500`, `M[SPI]=3`,
     * `T[1]=5` (syntax-sinumerik §3.2, "indexed address"). The whole is one `word` whose
     * `address` is the identifier (`LIMS`, `S`), `index` the text inside the brackets
     * (`'2'`, `'SPI'`) and `valueText` the right-hand side — never a word, an `expression`
     * and an `operator` with the address lost. Default false: `[` keeps its P1 reading.
     */
    assignmentIndex?: boolean;
    /**
     * P9 (§7.1, §7.16, R4). Which identifiers of `assignment` are the **control's own**
     * multi-letter addresses (Okuma `SB=`, `QA=`, `TL=`, `CP=`; syntax-okuma §3.2), as one
     * pattern the whole identifier has to match. Every other identifier an assignment
     * reads is a name the program gives a local variable (`DIA1=50` in a `CALL` block).
     *
     * The tokenizers read both the same way, one `word` with its `address`, so no token
     * changes; the grammar paints an address as one and a variable as one, and hover
     * explains the address and calls the rest a local variable. Absent: the grammar's
     * reading of P8 (every assignment identifier is looked up as an address).
     */
    extendedAddresses?: Pattern;
    /**
     * P9 (§7.1, §7.16, R4). The letters that introduce an exponent inside a number:
     * Sinumerik `EX` (`X=-.1EX-3`, `1.5EX3`; syntax-sinumerik §3.3). With it, `1.5EX3` is
     * one value of the word in front of it, never a value and an `unknown` token. The
     * token's `valueText` is the whole text and its `value` is `null`: no reading in
     * `numbers.ts` computes with an exponent yet, so nothing scales or compares it, and a
     * script reports it as a value it cannot read. Absent: no exponents (P1 reading).
     */
    exponentMarker?: string;
    /**
     * M9-2 (the owner's answers of 2026-10-08; syntax-heidenhain §6.4). One-character marks,
     * none of them a letter, that are the address of the value packed directly behind them:
     * Klartext `#` in `CYCL DEF 7.1 #5` / `#Q5`, the row of the datum table. Read only where
     * words are separated (`wordSeparatorRequired`); `#5` and `#Q5` are one `word` with
     * `address` `#`, while `# 5` and a lone `#` stay as before. Absent: no such mark.
     */
    symbolAddresses?: string[];
    /**
     * Owner decision of 2026-10-08. What *Remove Spaces* may do on this profile besides the
     * general rules: `'refuse'` (Sinumerik: names, keywords and multi-letter addresses need
     * their blanks, so the command is not offered) or `'keepAroundLongAddresses'` (Okuma: the
     * blank on either side of a word whose address has more than one letter stays, `SB=1200`).
     * Absent: the general rules only. Read by `transforms/removeSpaces.ts`; no tokenizer reads it.
     */
    removeSpaces?: 'refuse' | 'keepAroundLongAddresses';
    /**
     * M12.5 (§7.16 #179; WP-RP2, both tokenizers on shared goldens). Text the control keeps
     * and shows but does not execute. Each pattern is tried at the start of a block (behind
     * the block number) and must have the named group `text`; that group becomes **one**
     * `text` token (§7.5) and tokenizing goes on behind it. Klartext: the cycle name behind
     * `CYCL DEF <n>` up to `~`, `;` or the end (`CYCL DEF 207 TAP.-RIGID NEW`), the program
     * name between `BEGIN PGM`/`END PGM` and `MM`/`INCH` (`BEGIN PGM 7-AXLE PART MM`), the
     * `FN 16: F-PRINT` and `CALL PGM` paths. No transform rewrites a `text` token, no check
     * reads a word inside it, and hover says nothing about it.
     */
    freeText?: Pattern[];
    /**
     * M12.5 (§7.16 #179). Multi-letter addresses whose value stands behind a colon: Klartext
     * `VCONST:ON`, `VC:120` (`FUNCTION TURNDATA SPIN`), `HSC-MODE:1` (cycle 32). One `word`
     * with `address` = the name as listed and `valueText` = what follows the colon (a number
     * or a plain upper-case word such as `ON`).
     */
    colonWords?: string[];
    /**
     * M12.5 (§7.16 #179). A program name written behind a call keyword: Okuma `CALL OABCD`,
     * `MODIN O1234` (the outline rule already accepts `O[A-Z0-9]{1,4}`). `after` are the
     * keywords, `pattern` the name; the match is one `programMarker` token, as a Fanuc
     * `<NAME>` behind `M98` is.
     */
    callTargets?: { after: string[]; pattern: Pattern };
    /**
     * M12.5 (§7.16 #179). Keywords behind which a name is a jump **target**: Sinumerik
     * `GOTO`, `GOTOF`, `GOTOB`, `GOTOC`. That name is a `label` token (as a label behind a
     * jump already is for the program checks' `defines_label`), not `unknown`. A string or
     * an expression behind the keyword (`GOTOF "STEP_"<<N`) keeps its own tokens.
     */
    labelAfter?: string[];
    /**
     * M12.5 (§7.16 #179). Declaration keywords: Sinumerik `DEF`. On a line that starts with
     * one (behind the block number), the names it declares (behind the type keyword, split
     * on `,`, an `=` initializer and a `[…]` size excepted) are `variable` tokens. The use of
     * such a name on a later line stays one `unknown` token — the tokenizer reads one line at
     * a time; G11 counts a name declared in the same file as known (WP-RP8).
     */
    declareAfter?: string[];
    /**
     * M12.5 (§7.16 #179). A run of this many or more letters with no
     * digit between them, outside comments and strings, that is no keyword, function or name
     * of the profile, is **one** `unknown` token instead of a row of one-letter words: free
     * text written outside a comment (`M797 SPINDLE ONE DONE`) no longer reads as `S`, `P`,
     * `I`, … words. Fanuc mill and lathe: 3. Absent: off.
     */
    plainTextRun?: number;
    /**
     * M12.5 (§7.16 #179). `false`: a lone `%` is **not** a tape marker in
     * this dialect (Klartext has no tape; a `%` in a Q-parameter comment is text), so neither
     * tokenizer reads it as a `programMarker` and the program checks' tape rules stay off.
     * Absent or `true`: today's reading (a `%` that is no comment start or skip code is the
     * tape marker).
     */
    tapeMarker?: boolean;
    /**
     * P4h (plan §6.10 rule 13; T123). Axis names of more than one letter that this machine reads
     * with the value written straight behind them (`AA90`, a lone `QQ0`), letters only, 2 to 8
     * of them. Written by `applyMachine` from the machine's `extraAxes` (or by a user profile).
     * Both tokenizers read such a name, followed by a value, as one `word` with the name as its
     * address; without the setting `AA90` stays one `unknown` token and `QQ0` a call. An
     * assignment (`AA=10`), a call with its bracket (`AA(`) and a longer name (`AAX1`) keep
     * their own readings. The grammar (the colours) does not read it.
     */
    extraAxisNames?: string[];
  };
  addresses: {
    tool?: string;
    feed?: string;
    /** Rapid marker: an address letter, or a keyword such as `FMAX`. */
    rapid?: string;
    spindle?: string;
    axes: string[];
    arcCenter?: string[];
    arcCenterMode?: 'incremental' | 'absolute';
    /** P6. Incremental address → the axis it moves: `{ U: 'X', W: 'Z' }`. */
    incremental?: Record<string, string>;
    /** P6. Addresses written as a diameter while the diameter mode is on: `['X', 'U']`. */
    diameter?: string[];
    /** P6. Rotary axes, whose number class is `angle` (AD-31): `['A', 'B', 'C']`. */
    angular?: string[];
    /**
     * P6. Words that set the feed unit by themselves (Klartext `{ FU: 'per-rev',
     * FZ: 'per-tooth' }`); a plain feed word returns to the unit the modal group gives.
     */
    feedUnitWords?: Record<string, Exclude<FeedUnit, 'unknown'>>;
    /**
     * P8. Assignment words whose value clamps the spindle speed instead of setting it
     * (Sinumerik `LIMS=3000` under `G96`).
     *
     * A script that scales speeds has to know the difference: raising the clamp with the
     * speed is at best pointless and at worst removes the guard the programmer put there,
     * so the word is reported and left alone (WP8.7).
     */
    speedLimitWords?: string[];
    /**
     * P4a fix B1 (NC-17; plan §7 #319). Words that select an offset by its number and are never
     * a position, an angle or a length (Sinumerik `D`, the cutting edge of the active tool). The
     * geometry transforms leave them as written. A dialect whose offset number belongs to a code
     * (Fanuc `D` of `G41`) says so in the code database instead.
     */
    offsetWords?: string[];
    /**
     * 2026-09 (owner decision of 2026-09-27). The number of the machine's main spindle
     * (Sinumerik `'1'`). A plain `S` while this spindle is the master (the default, or
     * after `SETMS(1)`) and the spindle word with this number (`S1=`) are the main
     * spindle's speed; any other numbered spindle is another spindle. Absent: the profile
     * names no main spindle, and every numbered spindle is another one.
     */
    mainSpindle?: string;
    /**
     * Phase 4 (P4a prelude; Phase 4 plan §6.2, AD-42). The words that give an arc its
     * direction in a dialect that writes no `G2`/`G3` (Klartext `{ "DR+": "ccw", "DR-": "cw" }`):
     * the word as written, an address followed by its sign alone, mapped to the direction as
     * the control defines it (`CodeSets.arcDirection`). `DR-1` (a tool call's radius delta) is
     * no direction word: only the sign may follow the address. At most one word per direction,
     * so a mirror can swap one for the other. Read by `_nc_path`/`_nc_geom`
     * (`gedit_nc.arc_direction_words_of`); absent on a dialect whose arcs are codes.
     */
    arcDirectionWords?: Record<string, 'cw' | 'ccw'>;
  };
  toolCall: {
    /** A line that changes the tool (`M6`, `TOOL CALL …`). */
    trigger: Pattern;
    /** Carries the named group `tool`. */
    tool: Pattern;
    /**
     * `same-line-or-last`: the tool is the `T` on the line, or the last `T` before it.
     * `last-before` (v1.2.0 manual-check fix round, D3-4c: a Fanuc mill whose `T` on the `M6`
     * line preselects the next tool): the tool is the last `T` written **before** the line; a
     * `T` on the tool line itself is the next tool, preselected for the following change.
     * There `ignore` no longer stops a tool line (`M6 T0` loads the tool selected before it);
     * it only says that its `T` word unloads, so the next change loads no tool.
     */
    toolFrom: 'same-line' | 'same-line-or-last' | 'last-before';
    /**
     * P6. A trigger line whose **masked** text also matches this is not a tool change.
     * A Fanuc lathe writes `T0100` to cancel the offset of station 1 and `G00 X100. T0100`
     * to retract with it — neither is a tool change, and counting them would put a tool
     * step and a program-map row on every retract.
     */
    ignore?: Pattern;
  };
  /**
   * `endRecord` (M10 review, NC-8): a line that matches `end` is the closing record of the
   * program in the file (Klartext `END PGM`), the counterpart of the `start` line, and not a
   * block the program could skip. Absent: an `end` line is an ordinary block (`M30`).
   */
  program: { start: Pattern[]; end: Pattern[]; endRecord?: boolean };
  /** Ordered; the first matching rule wins. Named groups `text` and `name` give the label. */
  outline: { kind: OutlineKind; pattern: Pattern }[];
  numbering: NumberingOptions;
  numberFormat?: NumberFormatOptions;
  onLoad?: { stripNul?: boolean };
  toolList?: {
    /** Where the descriptive comment of a tool sits; `auto` tries trailing, above, below. */
    description: 'auto' | 'above' | 'below' | 'trailing';
    /** A comment that matches is decoration (`-----`), not a description. */
    commentFilter?: Pattern;
    dropLeadingZeros?: boolean;
    collapseOffsetDigits?: boolean;
  };
  /**
   * P11 (§7.1, §7.7, AD-26). The review-mode defaults of a comparison and the comments the
   * control reads (`keepComments`). Read through `compareDefaults` (`core/compare`); the
   * built-in values are the G10 table of §8.11. A carried `tolerance` is ignored (§2.1).
   * §7.16 #148: `cycleNames` declares where the dialog-language cycle names stand, and
   * only a profile that declares them offers `ignoreCycleNames` (Klartext, off by default).
   */
  compare?: ProfileCompare;
  /**
   * P13 (§7.1, AD-30). How typing behaves in a document of this profile. Every built-in sets
   * both to true (the owner's decision of 2026-10-08: upper case on every control); a user
   * profile may turn either off. `convertCase` reads `forceUppercase` as "the control
   * expects upper case" and asks before writing lower case (P1). Other members (`tabWidth`
   * on `fanuc-gcode`) are carried, not read (§2.1: per-profile tab width is deferred).
   */
  editing?: ProfileEditing;
  /**
   * P4h (plan §6.10 rule 6). This profile's own role colours, per theme. Absent: the user's role
   * colours (`appearance.roleColors`) and the built-in palette. Merged by `extends` like every
   * other object (a child's role replaces the parent's role, the other roles stay).
   */
  colors?: ProfileColors;
  /** Fields of later phases are preserved, not interpreted (see the note above). */
  [p2Field: string]: unknown;
}

// ---------------------------------------------------------------------------
// What a machine configuration of this profile may set (P6, AD-31, §7.1, §8.8)
//
// The declaration is **data**, inherited through `extends` like every other field, and
// reviewed by G10. No code names a dialect: the Fanuc lathe's A/B difference, Okuma's unit
// table and the Sinumerik diameter default are all written down here, in the profile.
//
// Every value in a declaration is a **documented default, not a fact** about anybody's
// machine (§8 header). That is why a preset carries `source` where the syntax notes give
// one and `verify: true` where they do not: the label the user reads has to say which of
// the two it is.
// ---------------------------------------------------------------------------

/** One way of reading numbers, offered by name ("Increments of 0.001 mm (IS-B)"). */
export interface NumberInputPreset {
  /** `'is-b'`, `'calculator'`, `'okuma-10um'`. */
  id: string;
  /** Display text; data, not a translation key. */
  label: string;
  value: NumberInput;
  /** Where the notes say so (`'syntax-okuma.md §3.3'`); absent with `verify: true` = a documented default. */
  source?: string;
  verify?: boolean;
  /**
   * T083 (the owner's decision of 2026-10-19). `false`: the Digits check of Check Program
   * (`wordDigits`, `program_checks.py`) leaves this preset out when no machine is chosen. That
   * check reports a word only when it has too many digits on **every** preset; a coarse
   * increment system few machines run (Fanuc IS-A, 0.01 mm) has the fewest digits of all and
   * would hide every such word on the common ones. Absent or `true`: the preset takes part.
   * Nothing else reads it: the readings of a word with no machine list every preset.
   */
  digitCheck?: boolean;
}

/**
 * T084. A machine option on top of the number-input preset: how the control counts a feed
 * written **without** a decimal point (Fanuc: two parameters switch the feed per minute and
 * the feed per revolution to steps of 0.001 mm, 0.00001 in). It is never a preset and never
 * read without a machine: the Machines page writes the chosen steps into the machine's own
 * number rules (`NumberInput.classes`), where every reader already looks, and the default
 * choice changes nothing (the validator holds it to that).
 */
export interface PointlessFeedsDecl {
  /** The choice a machine has until it says otherwise; it has no `classes`. */
  default: string;
  choices: PointlessFeedChoice[];
  /** Where the notes say so. */
  source?: string;
  /** A documented default nobody has confirmed for a machine: the choices say "unconfirmed". */
  verify?: boolean;
}

/** One choice of `PointlessFeedsDecl`. */
export interface PointlessFeedChoice {
  /** `'standard'`, `'per-minute'`. */
  value: string;
  /** Display text; data, not a translation key. */
  label: string;
  /**
   * The steps this choice puts over the preset's own, per feed class. Applied only where the
   * preset counts that class in increments: with calculator-type input a feed is read as
   * written whatever the feed parameters say. Absent: the preset as it is.
   */
  classes?: Partial<Record<'feedPerMin' | 'feedPerRev', { increment: string; incrementInch?: string }>>;
}

/**
 * A profile overlay: merged like `extends` (AD-16) and limited to these members, so a
 * variant can change the power-on state, the tool rule, the numbering and the addresses —
 * and nothing else. The validator enforces the limit.
 */
export type ProfileOverlay = Partial<Pick<Profile, 'modal' | 'toolCall' | 'numbering' | 'addresses'>>;

/** One choice of a variant (`A` or `B` of the Fanuc lathe's G-code system). */
export interface VariantChoice {
  /** `'A'`. */
  value: string;
  /** `'G-code system A'`. */
  label: string;
  /** The code database for this choice (an AD-17 child of the profile's `codes`); absent = `codes`. */
  codes?: string;
  overlay?: ProfileOverlay;
  /**
   * Scored on the first 400 masked lines, and only when no machine is chosen (AD-31).
   *
   * Unlike `detect.content`, each pattern scores its weight **once** (presence). A marker
   * a post repeats in every block — a system-B `G99 G83 …` cycle-return line, which also
   * matches the system-A `G98`/`G99` rule — would otherwise outvote a single decisive
   * marker such as one `G92 S` clamp (WP6.1).
   */
  detect?: { pattern: Pattern; weight: number }[];
}

/** One machine parameter with a fixed set of choices (`gcodeSystem`: A or B). */
export interface VariantDecl {
  /** `'gcodeSystem'`. */
  id: string;
  label: string;
  /** One of the `choices` values; what applies when nothing is chosen and nothing detected. */
  default: string;
  /**
   * v1.2.0 manual-check fix round (D5-3). The default follows another variant: while the
   * variant named here has one of the `values` keys, the default is that key's value (Fanuc
   * lathe: in G-code system B `incrementalAddresses` defaults to `none`, G91 only). It
   * applies only where the default would (nothing chosen for this variant on the machine,
   * nothing detected); on the machine page it is the form's default, and it follows a switch
   * of the other variant until this one is changed by hand.
   */
  defaultBy?: { variant: string; values: Record<string, string> };
  choices: VariantChoice[];
}

/** `profile.machineParams` (§7.15, §8.8). */
export interface MachineParamsDecl {
  /** Absent: numbers are read as the profile's JSON says, with no choice (Klartext). */
  numberInput?: {
    default: string;
    presets: NumberInputPreset[];
    /** T084: the machine option for point-less feeds; absent = the presets as they are. */
    pointlessFeeds?: PointlessFeedsDecl;
  };
  /** Power-on default; absent = `'mm'`. */
  units?: 'mm' | 'inch';
  /** Lathes only; absent = not a parameter of this profile. */
  diameter?: 'on' | 'off';
  /** Modal groups whose power-on code a machine may set; the dialog offers their codes. */
  modalGroups?: string[];
  variants?: VariantDecl[];
  /**
   * M12 (P12, §8.9; the owner's decisions of 2026-10-07): starting points for a machine's
   * channel block, offered on the machine page's Channels step and **never applied without a
   * machine** — a document whose machine has no `channels` has no channels (AD-32). Each
   * preset is a documented default from the control's manual, labelled with its source and
   * `verify: true` until the owner confirms it for their machine (D64). A user's machine keeps
   * its own copy; editing a preset later changes no machine.
   */
  channels?: ChannelPresetsDecl;
  /**
   * P4h (plan §6.10 rule 13; T123). A machine of this profile may name extra axes (the machine
   * builder's axis names of more than one letter). Absent: the machine page offers no such field
   * and a stored `extraAxes` is a problem of the record.
   */
  extraAxes?: ExtraAxesDecl;
  /**
   * P4h (§6.10 rule 14; T123). A machine of this profile may list the machine builder's own codes
   * (Sinumerik reserves `G810`–`G829` for them). Absent: no such field.
   */
  builderCodes?: BuilderCodesDecl;
}

/** `machineParams.extraAxes` (§6.10 rule 13): that the setting is offered, and where the manual says so. */
export interface ExtraAxesDecl {
  source?: string;
  verify?: boolean;
}

/** `machineParams.builderCodes` (§6.10 rule 14). */
export interface BuilderCodesDecl {
  /** The address letters a builder code may have, upper case (`["G"]`). */
  letters: string[];
  /** Data, shown as the field's example (`"G810-G829"`). */
  example?: string;
  source?: string;
  verify?: boolean;
}

/** `machineParams.channels` (§8.9). */
export interface ChannelPresetsDecl {
  /**
   * The address letters this control's wait codes may use, upper case (`["M"]` on Fanuc,
   * `["M", "P"]` on Okuma). `parseWaitCodes` refuses an item with another letter in plain
   * words ("`G4`: wait codes are M codes on this control"). Absent: any letter.
   */
  waitLetters?: string[];
  presets: ChannelPreset[];
}

/** One channel preset: a whole `ChannelParams`, offered by name. */
export interface ChannelPreset {
  /** `^[a-z0-9][a-z0-9-]*$`, unique in the profile. */
  id: string;
  /** Display text; data, not a translation key. */
  label: string;
  value: ChannelParams;
  /** Where the notes or the manual say so (`'syntax-okuma.md §11.7a'`). */
  source?: string;
  verify?: boolean;
}

/**
 * A profile with every pattern compiled once. Services take this, never a raw `Profile`,
 * so no regex is built per line.
 */
export interface CompiledProfile {
  profile: Profile;
  /** The flags every regex was built with: `i`, or `''` when `caseSensitive` is set. */
  flags: 'i' | '';
  re: {
    detectContent: { re: RegExp; weight: number }[];
    /** `detect.vetoes`, compiled; empty when the profile has none. */
    detectVetoes: RegExp[];
    sectionHeading?: RegExp;
    continuation?: RegExp;
    /** M8: `syntax.continuationStart`, the leading marker of a line that continues a block. */
    continuationStart?: RegExp;
    variables?: RegExp;
    /** P8: `syntax.assignment`, `syntax.labels`, `syntax.systemVariables`, `syntax.header`. */
    assignment?: RegExp;
    labels?: RegExp;
    systemVariables?: RegExp;
    header?: RegExp;
    /** M8 integration: `syntax.names`. */
    names?: RegExp;
    toolTrigger: RegExp;
    /** P6: `toolCall.ignore`. A trigger line that also matches this is not a tool change. */
    toolIgnore?: RegExp;
    tool: RegExp;
    programStart: RegExp[];
    programEnd: RegExp[];
    outline: { kind: OutlineKind; re: RegExp }[];
    references: { trigger: RegExp; addresses: string[] }[];
    /**
     * P4d (§6.6 rule 9): `numbering.calls`, compiled. Optional so that a hand-built
     * compiled profile (a fallback, a test) needs no entry; `compileProfile` always sets it.
     */
    calls?: {
      trigger: RegExp;
      address: string;
      maxDigits: number | null;
      repeatAddress: string | null;
      /** P4d review NC-1: `CallRule.localAddress`, or null; optional for a hand-built profile. */
      localAddress?: string | null;
      /** P4d review NC-2: `CallRule.interrupt`; optional for a hand-built profile. */
      interrupt?: boolean;
    }[];
    commentFilter?: RegExp;
  };
  /** `syntax.keywords`, upper-cased and longest first, so the tokenizer can match greedily. */
  keywords: string[];
}

/**
 * Where a profile is broken. `path` is the JSON path of the offending field, such as
 * `outline[2].pattern`, so the message points at the file and not at the app.
 */
export interface ProfileErrorInfo {
  path: string;
  message: string;
}

/** The result of `validateProfile`: either a profile, or the list of problems found. */
export type ProfileValidation = { ok: true; profile: Profile } | { ok: false; errors: string[] };

// ---------------------------------------------------------------------------
// Inheritance (P6, AD-16). The functions live in `core/profiles/resolve.ts`;
// their types live here, with every other profile type.
// ---------------------------------------------------------------------------

/** One profile file on its way in: the JSON, where it came from, and which file it was. */
export interface ProfileSource {
  raw: unknown;
  origin: 'builtin' | 'user';
  /** The user file's name; absent for a built-in. */
  file?: string;
}

/** One profile after its parents were merged into it. `profile` is still raw JSON. */
export interface ResolvedProfile {
  profile: Record<string, unknown>;
  origin: 'builtin' | 'user';
  file?: string;
  /** Own id first, then the parents (`['fanuc-lathe', 'fanuc-gcode']`). */
  chain: string[];
}

/**
 * Why a profile could not be used, with enough detail to fix the file: which file, which
 * profile, and the JSON path of the field at fault.
 */
export interface ProfileProblem {
  origin: 'builtin' | 'user';
  file: string | null;
  profileId: string | null;
  path: string;
  message: string;
  /**
   * How serious the row is. `error` (the default when unset): the file or entry is not used.
   * `info`: a notice that changes nothing, e.g. a user code entry that changes what a built-in
   * code means (owner, 2026-10-09).
   */
  severity?: 'error' | 'info';
  /**
   * Which folder the file is in (`<config>/profiles` or `<config>/codes`): a profile file and a
   * code file may have the same name, and only this tells their problems apart. Unset on a
   * problem that belongs to no file (a folder that could not be read).
   */
  kind?: 'profiles' | 'codes';
  /** Which source it was, for a file that has no id and no name to be called by. */
  index?: number;
}
