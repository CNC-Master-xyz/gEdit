// Printing (Phase 4 plan §6.5, §6.11). Owner: P4.15; the category, the ribbon group and the command titles were
// pinned by the P4c prelude, P4.15 adds the messages.
// One namespace per feature (plan AD-14); the namespace name is this file's name.

import type { Messages } from '../types';

export default {
  category: 'File',
  /** Caption of the File-tab group (`{ tab: 'file', group: 'print.group' }`), after Insert. */
  group: 'Print',
  /** `file.print`: the document or the selection, through the system's print dialog. */
  print: 'Print',
  /** `file.exportHtml`: the same pages as one HTML file, for a system that cannot print or to print from a browser. */
  exportHtml: 'Export as HTML',

  /** The form of both commands. */
  form: {
    okPrint: 'Print',
    okExport: 'Export',
    scope: 'What to print',
    scopeDocument: 'The whole program',
    scopeSelection: 'The selected lines',
    colors: 'Colours',
    colorsColor: 'In colour',
    colorsBlack: 'Black only',
    colorsHelp: 'Colours are always the light ones, since paper is white. A colour too pale to read on paper prints black.',
    lineNumbers: 'Line numbers',
    lineNumbersHelp: 'The line numbers of the program, not the block numbers.',
    fontPt: 'Font size (points)',
    fontPtHelp: 'From 7 to 14. Portrait pages, cut for A4 and Letter alike.',
  },

  /** On every page: "Page 2 of 5". */
  pageOf: 'Page {page} of {pages}',
  /** The title of the exported HTML page's file filter. */
  htmlFilter: 'Web page (HTML)',

  noDocument: 'There is no program open to print.',
  noSelection: 'No lines are selected. Select the lines to print, or print the whole program.',
  tooLong: 'This program has {lines} lines; printing is limited to {max}. Print a selection.',
  tooLongExport: 'This program has {lines} lines; the export is limited to {max}. Export a selection.',
  /** Too many rows for the budget (one very long line counts for the rows it cuts into); `{pages}` is the most. */
  tooManyPages: 'This program would take more than {pages} pages; printing is limited to {pages}. Print a selection.',
  tooManyPagesExport: 'This program would take more than {pages} pages; the export is limited to {pages}. Export a selection.',
  failed: 'The print dialog could not be opened.',
  exportFailed: 'The page could not be saved.',
  exported_one: 'Saved {count} page to {name}.',
  exported_other: 'Saved {count} pages to {name}.',
} as const satisfies Messages;
