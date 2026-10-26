// The numbers the printed page is built from (Phase 4 plan §6.5 rule 10; P4.15). A module of its own so the print
// view (`PrintView.svelte`) and the page model (`app/print.ts`) read one set of constants without importing each
// other. Nothing here knows a document.

/** The page margin of the print (`@page`) and of the exported page, in millimetres. */
export const PRINT_MARGIN_MM = 15;
/** 180 mm: A4's width (the narrower paper) less both margins. */
export const PRINT_PAGE_WIDTH_MM = 210 - 2 * PRINT_MARGIN_MM;
/** 248 mm: Letter's height (the shorter paper) less both margins is 249.4; 1.4 mm stay free so a page never overflows by rounding. */
export const PRINT_PAGE_HEIGHT_MM = 248;
/**
 * The width of one character as a share of the font size. The editor's stack (Menlo, Consolas, DejaVu Sans Mono)
 * sets 0.55 to 0.602 em; 0.62 is taken so that the widest of them still fits `cols` characters in a row.
 */
export const PRINT_CHAR_EM = 0.62;
/** The height of one row as a multiple of the font size. */
export const PRINT_LINE_EM = 1.3;
/** The header's rows: the line of text and the space under the rule. */
export const PRINT_HEADER_ROWS = 2;
/** The editor's monospace stack (the default of `appearance.editorFontFamily`), fixed so a page does not change with a setting. */
export const PRINT_FONT_STACK = "Menlo, Consolas, 'DejaVu Sans Mono', monospace";

/** The height of a page box in `em`: `rows` body rows and the header. */
export function pageHeightEm(rows: number): number {
  return Math.round((rows + PRINT_HEADER_ROWS) * PRINT_LINE_EM * 100) / 100;
}

/** The line-number gutter of a row: the number right-aligned and one blank, or blanks for a continuation row. */
export function gutterText(line: number | null, gutter: number): string {
  if (gutter === 0) return '';
  return (line === null ? '' : String(line)).padStart(gutter, ' ') + ' ';
}
