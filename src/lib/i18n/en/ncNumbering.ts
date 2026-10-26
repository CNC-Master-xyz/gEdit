// Block numbering: renumber and remove block numbers (contrib/ncNumbering.ts,
// core/transforms/{renumber,removeBlockNumbers}.ts). Owner: WP4.2.
// One namespace per feature (plan AD-14); the namespace name is this file's name.
//
// Three kinds of message live here, and they reach the user by three different routes:
//
//   - command and transform titles, resolved by the ribbon and the palette
//   - `Msg` keys returned by `available`, `preflight`, `summary` and `warnings`, resolved
//     by `TransformService` (WP4.1)
//   - the `label`, `help` and `Located.message` strings a transform resolves itself,
//     because those two contract fields are display text and not keys (plan §7.5, §7.1)

import type { Messages } from '../types';

export default {
  category: 'NC',
  /** Caption of the NC-tab ribbon group. */
  group: 'Numbering',

  renumber: {
    title: 'Renumber Blocks…',
    /** Shown while the transform cannot run on this dialect. Unused today; kept with `available()`. */
    unavailable: 'This dialect does not number blocks.',

    summary_one: 'Renumbered {count} block.',
    summary_other: 'Renumbered {count} blocks.',
    summarySkipped_one: 'Renumbered {count} block, skipped {skipped} lines.',
    summarySkipped_other: 'Renumbered {count} blocks, skipped {skipped} lines.',
    nothing: 'Nothing to renumber here.',
    /**
     * P4d (plan §6.6 rule 7): a run an option refuses writes nothing; this is its summary
     * in the status bar.
     */
    refused: {
      noMax: 'Not renumbered: "Fit the increment to the maximum" needs a maximum. Enter one, or switch the option off.',
      doesNotFit:
        'Not renumbered: {count} blocks from {start} do not fit at or below the maximum {max}, not even in steps of 1. Use a smaller start value or a larger maximum.',
      noTrigger: 'Not renumbered: no line here contains "{text}", so numbering has nowhere to start.',
    },

    /**
     * Confirmation before the run; the user may still say no.
     *
     * M6: the references this run *can* follow are rewritten and are not asked about. What
     * is left is the ones it cannot — a target that is not there, one that is there twice,
     * one outside the renumbered lines, a pointer from outside them into them, or a rule
     * that says the block may be in the calling program.
     */
    references_one:
      'This program has {count} line that points at a block number this run cannot follow ({first}). It is left as it is, so the jump would end up somewhere else. Renumber anyway?',
    references_other:
      'This program has {count} lines that point at block numbers this run cannot follow (the first is line {first}). They are left as they are, so the jumps would end up somewhere else. Renumber anyway?',
    consecutiveSelection:
      'This dialect numbers every block consecutively from {start}, so numbering only the selection does not fit the blocks around it. Renumber the selection anyway?',
    /** The run has only a fragment and the dialect joins blocks across lines. */
    fragmentUnknown:
      'This run cannot see the lines above the selection, and in this dialect a block may continue over several lines. The first selected lines could be the tail of a block above, which must not get a number of its own. Renumber anyway?',
    /** The scan could not look outside the selection at all. */
    referencesUnchecked:
      'This run cannot see the rest of the program, so a jump into these blocks could neither be looked for nor rewritten. Renumber anyway?',
    /** M6 (G8): the numbering may run past the maximum, and then no rewritten value is unique. */
    referencesMayWrap:
      'This run may need more block numbers than the maximum ({max}) allows. The numbering would start over at {start}, the same number would end up on several blocks, and a control takes the first one it finds — so the {count} jumps and cycle calls of this program are reported instead of rewritten. Give a larger maximum, a smaller increment or "Stop and warn". Renumber anyway?',

    /** Warnings, shown next to the results table. */
    overflowStopped:
      'Stopped at line {line}: the next number would be above {max}. The lines from there on keep the numbers they had.',
    wrapped_one:
      'The numbers passed {max} once and started over at {start} (first at line {line}), so the program now has duplicate block numbers. A control takes the first match, and block search, GOTO and M99 P become ambiguous. Use a larger maximum, a smaller increment, or "Stop and warn".',
    wrapped_other:
      'The numbers passed {max} {count} times and started over at {start} (the first at line {line}), so the program now has duplicate block numbers. A control takes the first match, and block search, GOTO and M99 P become ambiguous. Use a larger maximum, a smaller increment, or "Stop and warn".',
    /** A caller that skipped the form asked for more than the dialect allows: one each. */
    limitedMax: 'This control accepts block numbers up to {max}, so the run used {max} as the maximum.',
    limitedDigits:
      'This control reads block numbers of at most {digits} digits, so the numbers were padded to {digits}.',
    skippedTruncated: 'The table lists the first {shown} of {total} skipped lines.',
    /** P4d (§6.6 rules 1–3): what the advanced options did. */
    fitted: 'The increment was fitted to the maximum: {step}, so {count} blocks from {start} end at or below {max}.',
    everyNthRemoved_one: '{count} block between the numbered ones lost its number.',
    everyNthRemoved_other: '{count} blocks between the numbered ones lost their number.',
    everyNthKept_one: '{count} block between the numbered ones kept a number because a jump, a return or a cycle names it, or it is a main block.',
    everyNthKept_other: '{count} blocks between the numbered ones kept a number because a jump, a return or a cycle names them, or they are main blocks.',
    /** P4d review NC-4: numbers the run put on several blocks of one program; a warning, not a refusal. */
    duplicatesMade_one:
      '{count} block number is now on more than one block of a program, because a line the renumber left alone (outside the selection, skipped, or above the start line) has it too. A control takes the first one it finds, so block search, GOTO and M99 P may go to the wrong block. The table lists the lines.',
    duplicatesMade_other:
      '{count} block numbers are now on more than one block of a program, because lines the renumber left alone (outside the selection, skipped, or above the start line) have them too. A control takes the first one it finds, so block search, GOTO and M99 P may go to the wrong block. The table lists the lines.',
    alignTabs: 'Some lines have a tab in front of the code. A tab counts as one character, so these lines may not line up on the screen.',
    /** M6: the three outcomes of a reference. Rewritten is good news and says so plainly. */
    referencesRewritten_one: '{count} jump, return or cycle was rewritten with the new block number.',
    referencesRewritten_other: '{count} jumps, returns and cycles were rewritten with the new block numbers.',
    referencesKept_one: '{count} reference was left as it is because this dialect never rewrites it; check it.',
    referencesKept_other: '{count} references were left as they are because this dialect never rewrites them; check them.',
    referencesUnresolved_one: '{count} reference could not be followed and was left as it is; check it.',
    referencesUnresolved_other: '{count} references could not be followed and were left as they are; check them.',

    /** Row text in the results table (display text, not keys). */
    skippedByPrefix: 'Skipped: the line starts with one of the skipped prefixes.',
    skippedName: 'Skipped: the block carries a name, not a number.',
    skippedNotNumbered: 'Skipped: the block had no number and only numbered blocks are renumbered.',
    skippedStopped: 'Skipped: numbering stopped at the maximum.',
    skippedProgramMarker: 'Skipped: this is a program marker, not a block.',
    skippedContinued: 'Skipped: this line continues the block above it.',
    skippedContaining: 'Skipped: the line contains one of the texts to skip.',
    /** P4d (§6.6 rules 5 and 6): one row per region an option leaves alone. */
    skippedFirstRow_one: 'The first line keeps its text (skip the first lines).',
    skippedFirstRow_other: 'The first {count} lines keep their text (skip the first lines).',
    skippedLastRow_one: 'The last line keeps its text (skip the last lines).',
    skippedLastRow_other: 'From here, the last {count} lines keep their text (skip the last lines).',
    startTriggerRow: 'Numbering starts at this line, the first that contains "{text}". The lines above keep their text.',
    startAfterTriggerRow:
      'Numbering starts at the line after this one, the first that contains "{text}". The lines above keep their text.',
    /**
     * P4d review NC-9: `kept` for a value that names a block of another program (`M98 P… Q…`
     * starts the called program at block Q), and for one of the own program (a turning
     * cycle read with a milling profile), each with its own words.
     */
    referenceKeptRow:
      'This line points at a block of another program (M98 P… Q… starts the called program at block Q). This dialect never rewrites such a value, so it was left as it is; check it.',
    referenceKeptOwnRow:
      'This dialect never rewrites this value, so it was left as it is; check it. A milling profile reads G70–G73 with P and Q this way: on a mill, G73 P… Q… is a peck drilling cycle, not a turning cycle.',
    referenceMissingRow: 'This line points at a block number that this program does not have, so it was left as it is.',
    referenceDuplicateRow: 'This line points at a block number that this program uses more than once, so it was left as it is.',
    referenceOutsideRow: 'This line points at a block outside the renumbered lines, which keeps the number it has.',
    referenceIncomingRow: 'This line is outside the renumbered lines and points into them, so its target now has a different number.',
    referenceNotNumberRow: 'This reference is a variable or an expression, not a block number, so it was left as it is.',
    referenceAmbiguousRow:
      'This block carries the same address twice, so which of the two words names a block number cannot be told from the line; both were left as they are.',
    /**
     * P4d (plan §6.6 rule 10): a reference into another program (`M98 P1000 Q30`) or back
     * into the calling one (`M99 P30`) whose program cannot be told. One row per reason.
     */
    referenceNoCallRow:
      'This line points at a block of the program it calls, but which program it calls cannot be read from the line, so it was left as it is.',
    referenceNotInFileRow:
      'This line points at a block of a program that is not in this file, so it was left as it is. If that program is open in another tab, renumber it there.',
    referenceProgramTwiceRow:
      'Two programs in this file have the same name, so which program this line points into cannot be told; it was left as it is.',
    referenceNoCallerRow:
      'This return points at a block of the calling program, and no program in this file calls this one (or it is a main program, where the return jumps inside it). It was left as it is.',
    referenceCallersRow:
      'This return points at a block of the calling program, and more than one program in this file calls this one, so which block is meant cannot be told; it was left as it is.',
    /** P4d review NC-2: a return in a program that an interrupt (Fanuc M96) may start. */
    referenceInterruptRow:
      'This return is in a program that an interrupt (M96) starts. An interrupt returns into whichever program it interrupted, so which block is meant cannot be told; it was left as it is.',
    /** P4d review NC-4: a block number the run put on several blocks of one program. */
    duplicateMadeRow:
      'After this renumber, this block number is on more than one block of this program: a line the renumber left alone (outside the selection, skipped, or above the start line) has it too. A control takes the first one it finds.',
    /**
     * M13 review NC-8: a reference left as written whose block got another number. The
     * row names where the value lands now, because a valid block elsewhere is worse than
     * no block at all: the program still runs.
     */
    referenceLandsRow:
      '{reference} named {target} on line {line}; after this renumber {target} is line {landing} ({block}), so the jump lands there.',
    referenceGoneRow:
      '{reference} named {target} on line {line}; after this renumber no block {target} is left, so the control will stop with an alarm.',
    wrappedRow: 'The numbering started over here: this block number is used twice in the program.',

    fields: {
      start: { label: 'Start at', help: 'The number the first block gets.' },
      step: { label: 'Increment', help: 'Not used when "Fit the increment to the maximum" is on.' },
      digits: {
        label: 'Digits',
        help: 'Pad with leading zeros to this many digits. 0 writes the number as short as it is.',
        /** The dialect names a maximum; `digits` is how many digits it has. */
        helpLimit: 'Pad with leading zeros to this many digits, at most {digits}: this control reads no longer block numbers. 0 writes the number as short as it is.',
      },
      max: {
        label: 'Maximum',
        help: "Leave empty to use the dialect's maximum (99999 on Fanuc), or no maximum where the dialect sets none.",
        helpLimit: 'At most {max}, the highest block number this control accepts.',
      },
      fitToMax: {
        label: 'Fit the increment to the maximum',
        help: 'Uses the largest whole increment that keeps the last block at or below the maximum. Needs a maximum.',
      },
      onOverflow: {
        label: 'Above the maximum',
        wrap: 'Start over at the start value',
        stop: 'Stop and warn',
      },
      spacesAfter: { label: 'Spaces after the number' },
      alignColumn: {
        label: 'Start the code at column',
        help: '0 is off. The code behind each new block number starts at this column, counted in characters from the start of the line. A longer head gets one space. Not used where a skip mark follows the number.',
      },
      everyNth: {
        label: 'Number every Nth block',
        help: '1 numbers every block. With 5, the 1st, 6th, 11th … block gets a number and the blocks between lose theirs, except a block a jump, a return or a cycle names.',
      },
      skipStartingWith: {
        label: 'Skip lines starting with',
        help: 'Separated by spaces. A program marker such as % or O1001 is never numbered, whatever this list says.',
      },
      skipContaining: {
        label: 'Skip lines containing',
        help: 'Separated by spaces. A line that contains one of these texts anywhere, comments included, keeps its text.',
      },
      skipFirst: {
        label: 'Skip the first lines',
        help: 'This many lines at the start of the selection (or the program) keep their text, empty lines included.',
      },
      skipLast: {
        label: 'Skip the last lines',
        help: 'This many lines at the end of the selection (or the program) keep their text, empty lines included.',
      },
      startTrigger: {
        label: 'Start at the line containing',
        help: 'Empty starts at the first line. Otherwise numbering starts at the first line that contains this text, and the lines above keep their text.',
      },
      startAfterTrigger: { label: 'Start at the line after it' },
      skipEmpty: { label: 'Skip empty lines' },
      restartAtProgramStart: { label: 'Start over at each program start' },
      onlyNumbered: { label: 'Only renumber blocks that already have a number' },
      altPrefixes: {
        label: 'Also read these as a block number',
        help: 'Separated by spaces. The new numbers are always written with the profile prefix.',
      },
    },
  },

  removeBlockNumbers: {
    title: 'Remove Block Numbers…',
    /** `available()`: a control that needs numbers would refuse the whole program. */
    mandatory: 'This dialect needs a number on every block, so they cannot be removed.',

    summary_one: 'Removed {count} block number.',
    summary_other: 'Removed {count} block numbers.',
    /** M6: every number in the scope is pointed at, so `keepReferenced` left them all. */
    allKept_one: 'Kept {count} block number: a jump, a return or a cycle points at it.',
    allKept_other: 'Kept all {count} block numbers: a jump, a return or a cycle points at each of them.',
    nothing: 'No block numbers to remove here.',

    /**
     * Confirmations. Removing a block number deletes the jump target outright, which is
     * worse than renumbering it, so the wording is blunter than the renumber one. M6:
     * asked only when "Keep numbers that are pointed at" is off, because with it on there
     * is no jump target left to delete.
     */
    references_one:
      'This program has {count} line that points at a block number ({first}). Removing the numbers deletes the block it points at, and the control will alarm. Remove them anyway?',
    references_other:
      'This program has {count} lines that point at block numbers (the first is line {first}). Removing the numbers deletes the blocks they point at, and the control will alarm. Remove them anyway?',
    referencesUnchecked:
      'This run cannot see the rest of the program, so a jump into these blocks could not be looked for and their numbers cannot be kept for it. Remove them anyway?',
    /**
     * M6 (G8): asked with "Keep numbers that are pointed at" **on**, for the one kind of
     * reference it cannot keep — `GOTO #100`, whose target is worked out while the
     * program runs and is therefore not a number this run can hold on to.
     */
    computed_one:
      'This program has {count} line whose jump is worked out while the program runs ({first}), so the block it lands on cannot be named here and its number cannot be kept. Remove the block numbers anyway?',
    computed_other:
      'This program has {count} lines whose jumps are worked out while the program runs (the first is line {first}), so the blocks they land on cannot be named here and their numbers cannot be kept. Remove the block numbers anyway?',
    fragmentUnknown:
      'This run cannot see the lines above the selection, and in this dialect a block may continue over several lines. Remove the block numbers anyway?',

    emptied_one: '{count} line held nothing but its block number and is now empty.',
    emptied_other: '{count} lines held nothing but their block number and are now empty.',
    emptiedRow: 'This line held nothing but its block number and is now empty.',
    referencesKept_one: '{count} line still points at a block number that is now gone; fix it before sending the program.',
    referencesKept_other: '{count} lines still point at block numbers that are now gone; fix them before sending the program.',
    referenceRow: 'This line points at a block number, and that number has been removed.',
    keptReferenced_one: '{count} block number was kept because a jump, a return or a cycle points at it.',
    keptReferenced_other: '{count} block numbers were kept because a jump, a return or a cycle points at them.',
    keptReferencedRow: 'Kept: a jump, a return or a cycle points at this block number.',
    referencesComputed_one:
      '{count} jump is worked out while the program runs, so the block number it lands on could not be kept; fix it before sending the program.',
    referencesComputed_other:
      '{count} jumps are worked out while the program runs, so the block numbers they land on could not be kept; fix them before sending the program.',
    computedRow:
      'This jump is worked out while the program runs, so the block it lands on cannot be named here and its number was not kept.',
    skippedTruncated: 'The table lists the first {shown} of {total} lines.',

    fields: {
      keepReferenced: {
        label: 'Keep numbers that are pointed at',
        help: 'A block number that a jump, a return or a turning cycle names stays where it is. Switch it off to remove every number; the program will then need its jumps fixed by hand.',
      },
    },
  },
} as const satisfies Messages;
