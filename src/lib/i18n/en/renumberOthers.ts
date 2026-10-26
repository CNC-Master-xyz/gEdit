// References in the other open documents after a renumber (app/renumberOthers.ts,
// contrib/renumberOthers.ts). Owner: P4.20b. One namespace per feature (plan AD-14); the
// namespace name is this file's name. Plan §6.6 rules 11–13.
//
// `update` is the command's title (the ribbon and the palette resolve it); the rest are
// the texts the service shows itself: the Results columns and rows, the status bar and the
// confirmation. Counts of references and of documents are separate sentences, so each can
// take its own plural form.

import type { Messages } from '../types';

export default {
  /** The command, NC tab, Numbering group. */
  update: 'Update References in Other Documents…',
  /** The same without the dots, as the confirmation's title and in a refusal ("so {action} did not run"). */
  action: 'Update References in Other Documents',

  /** The columns of the Results table that lists them, below the renumber's own rows. */
  column: {
    document: 'Document',
    line: 'Line',
    text: 'Line as written',
    what: 'What happens',
  },

  /** One row per listed reference, by kind. {text} is the value as written, {newText} what it becomes, {program} the program it points into. */
  row: {
    update: '{text} becomes {newText} (program {program}).',
    gone: 'The renumber took away the number {text} pointed at (program {program}). Not changed; check it.',
    duplicate: 'The number now on {text} is on several blocks of program {program}. Not changed; check it.',
    lands: '{text} named no block before and names one now (program {program}). Not changed; check it.',
    kept: 'The block has a new number, but gEdit never rewrites {text} here (program {program}). Left as it is; check it.',
    callers: 'Several programs call this one, so {text} cannot be told apart. Not changed; check it.',
  },

  /** After the run, in the status bar and the Results message. */
  found_one: '{count} reference in another open document points into a program you just renumbered.',
  found_other: '{count} references in other open documents point into programs you just renumbered.',
  next: {
    canUpdate_one: 'Update References in Other Documents (NC tab) rewrites the one marked to update.',
    canUpdate_other: 'Update References in Other Documents (NC tab) rewrites the {count} marked to update.',
    cannotUpdate: 'None of them can be rewritten for you; check them by hand.',
  },

  /**
   * A renumber that wrote replaced a list whose references were never updated (owner C,
   * 2026-10-22): the status bar and one Results row say it. Never composed with the new run.
   */
  replaced_one:
    '{count} reference from the earlier renumber of {name} was not updated and is no longer listed. Undo both renumbers, renumber once, then update.',
  replaced_other:
    '{count} references from the earlier renumber of {name} were not updated and are no longer listed. Undo both renumbers, renumber once, then update.',

  confirm: {
    references_one: 'Rewrite {count} reference',
    references_other: 'Rewrite {count} references',
    inDocuments_one: 'in {count} other document.',
    inDocuments_other: 'in {count} other documents.',
    undo: 'Each document gets its own undo step.',
    cannot_one: '{count} more reference cannot be rewritten and stays as it is.',
    cannot_other: '{count} more references cannot be rewritten and stay as they are.',
    ok: 'Update',
  },

  done: {
    references_one: 'Updated {count} reference',
    references_other: 'Updated {count} references',
    rest_one: '{count} more is listed below and stays as it is.',
    rest_other: '{count} more are listed below and stay as they are.',
  },

  /** A write that did not go through (a document refused or threw): the list stays. */
  failed: {
    some: 'Updated {done} of {total} documents. Undo in each document to take it back.',
    none: 'Nothing was written. Check the documents and run Update References in Other Documents again.',
  },

  /** Nothing was written anywhere. */
  refused: {
    nothing: 'There are no references to update. Run Renumber Blocks first.',
    noneWritable: 'None of the listed references can be rewritten for you. Check them by hand.',
    closed: 'Nothing was written: {name} was closed since the references were listed.',
    /** The renumbered document was edited after the run (owner B): its numbers are no longer the ones the list was made from. */
    sourceChanged: 'Nothing was written: {name} changed after the renumber. Undo your changes in {name}, or undo the renumber and run it again.',
    /** Another document was edited, opened or closed: the references are found again, the new list is shown and not written. */
    listChanged:
      'Nothing was written: the open documents changed since the references were listed. The new list is in Results. Check it and run Update References in Other Documents again.',
    listGone: 'Nothing was written: the open documents changed since the references were listed, and no reference is left to update.',
    noModel: '{name} cannot be edited yet.',
    replaced: 'Nothing was written: the list was replaced while you were asked. Run Update References in Other Documents again.',
    nothingWritten: 'Nothing was written in any document.',
  },
} as const satisfies Messages;
