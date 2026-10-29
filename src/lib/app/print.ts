// Printing (Phase 4 plan §6.5 rule 10; P4.15).
//
// The page model (`buildPrintDocument`) is pure: lines in, pages of rows out, so the pagination, the colours and
// the header are tested without a webview. The print view (`components/print/PrintView.svelte`) renders a
// `PrintDocument` as `.print-page` boxes of a fixed size and the webview's own print dialog does the rest
// (`window.print()`: on macOS Tauri 2.11 routes it to the native print operation through an init script, which
// needs the `core:webview:allow-print` permission). "Export as HTML" writes the same pages as one file.
//
// What the rules say, in short:
//  - **Paper.** One geometry for both A4 and Letter: the smaller printable area of the two in portrait, 15 mm
//    margins, so a program prints the same (same page breaks, same "Page n of m") on either paper.
//  - **Colours.** The role of a token is what the editor's grammar gives it (here: the tokenizer's token, mapped
//    to the same roles; `print.test.ts` holds the two together over the corpus of the six dialects). The colour is
//    always the light palette (paper is white, whatever theme is on); a role whose colour is under 3:1 against
//    white prints black. `Black` writes no colour at all.
//  - **Never HTML.** Document text reaches the page as text: the Svelte view escapes by construction and
//    `printDocumentHtml` escapes every string it writes (an NC comment can hold `<script>`).
//
// The service is written as `createPrintService(deps)` plus the singleton below (AD-2), so the view's lifecycle
// (removed on `afterprint`, at the next print, when the document closes, after five minutes) is tested with fake
// timers and no webview.

import { dialogs as appDialogs } from '$lib/app/dialogs';
import { status as appStatus } from '$lib/app/status';
import { mountPrintView } from '$lib/components/print/mountPrintView';
import {
  PRINT_CHAR_EM,
  PRINT_FONT_STACK,
  PRINT_HEADER_ROWS,
  PRINT_LINE_EM,
  PRINT_MARGIN_MM,
  PRINT_PAGE_HEIGHT_MM,
  PRINT_PAGE_WIDTH_MM,
  gutterText,
  pageHeightEm,
} from '$lib/components/print/printStyle';
import { ROLE_COLORS, ROLES, type Role } from '$lib/core/grammar/roles';
import { paletteOverrides, profileOverrides } from '$lib/core/grammar/themes';
import { addressNames, letterAddresses, numberPattern, wordCodes } from '$lib/core/grammar/shared';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { SELECTION_CROSSES, transformScope } from '$lib/core/transforms/scope';
import { t as translate } from '$lib/i18n';
import { editor as appEditor } from '$lib/monaco/editorService';
import { docs as appDocs } from '$lib/stores/documents';
import { settings as appSettings } from '$lib/stores/settings';
import { machines as appMachines } from '$lib/stores/machines';
import type {
  DialogFilter,
  DocId,
  DocumentStore,
  EditorService,
  MachineService,
  NativeDialogs,
  StatusService,
  Translate,
} from '$lib/app/types';
import type { CodeDb } from '$lib/core/codes/types';
import type { FieldSpec } from '$lib/core/forms/types';
import type { LineState, NcToken } from '$lib/core/nc/types';
import type { CompiledProfile, ProfileColors } from '$lib/core/profiles/types';

/** Print options as the print form gives them; remembered between runs in `uiState.lastParams['print']`. */
export interface PrintOptions {
  scope: 'document' | 'selection';
  colors: 'color' | 'black';
  lineNumbers: boolean;
  /** Font size in points, [`PRINT_FONT_MIN`, `PRINT_FONT_MAX`]. */
  fontPt: number;
}

export const PRINT_FONT_MIN = 7;
export const PRINT_FONT_MAX = 14;
export const PRINT_FONT_DEFAULT = 9;

/** More lines than this are not printed (a hidden page tree of that size is the limit of a webview); print a selection. */
export const PRINT_MAX_LINES = 20_000;
/** The same limit for "Export as HTML", which has no printer behind it. */
export const EXPORT_MAX_LINES = 100_000;

export {
  PRINT_CHAR_EM,
  PRINT_FONT_STACK,
  PRINT_HEADER_ROWS,
  PRINT_LINE_EM,
  PRINT_MARGIN_MM,
  PRINT_PAGE_HEIGHT_MM,
  PRINT_PAGE_WIDTH_MM,
  gutterText,
  pageHeightEm,
};

/** The key `uiState.lastParams` remembers the form under. */
export const PRINT_FORM_KEY = 'print';

/** The view is removed this long after the print call at the latest (macOS does not promise `afterprint`). */
export const PRINT_VIEW_TIMEOUT_MS = 5 * 60_000;

/** What is printed: the lines of the document or of the selection (whole lines, LF, without line breaks). */
export interface PrintSource {
  /** The document's name (a file name, or the untitled title), for the header. */
  name: string;
  /** The document line of `lines[0]`, so a selection keeps the document's line numbers. */
  firstLine: number;
  lines: readonly string[];
  /** When it is printed; the header shows the local date. */
  at: Date;
}

/** A run of text in one colour (`#rrggbb`), absent for the page's black. */
export interface PrintSpan {
  text: string;
  color?: string;
}

/** One printed row: a line, or the continuation row of a line wider than the page (`line: null`, no number). */
export interface PrintRow {
  line: number | null;
  spans: PrintSpan[];
}

export interface PrintPage {
  /** 1-based. */
  number: number;
  rows: PrintRow[];
}

export interface PrintDocument {
  title: string;
  /** The header's date, as the user's locale writes it. */
  date: string;
  options: PrintOptions;
  /** The geometry the pages were cut for (`pageGeometry`): body rows per page and columns across the page. */
  rows: number;
  cols: number;
  /** Width of the line-number gutter in characters (the digits of the largest number), 0 without line numbers. */
  gutter: number;
  pages: PrintPage[];
}

// ---------------------------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------------------------

const MM_PER_PT = 25.4 / 72;
/** A tab is blanks up to the next multiple of this many columns. */
const TAB_STOP = 4;

/** `fontPt` as the form allows it: a whole number of points from 7 to 14. */
export function clampFontPt(fontPt: unknown): number {
  const n = typeof fontPt === 'number' && Number.isFinite(fontPt) ? Math.round(fontPt) : PRINT_FONT_DEFAULT;
  return Math.min(Math.max(n, PRINT_FONT_MIN), PRINT_FONT_MAX);
}

/**
 * The rows and the columns of one page at `fontPt`, cut for the smaller printable area of A4 and Letter in portrait
 * with 15 mm margins, so one document prints the same on either paper. `rows` is what is left for the program after
 * the header's two rows; `cols` is the width of a row including the line-number gutter.
 */
export function pageGeometry(fontPt: number): { rows: number; cols: number } {
  const pt = clampFontPt(fontPt);
  const rowMm = pt * PRINT_LINE_EM * MM_PER_PT;
  const colMm = pt * PRINT_CHAR_EM * MM_PER_PT;
  return {
    rows: Math.floor(PRINT_PAGE_HEIGHT_MM / rowMm) - PRINT_HEADER_ROWS,
    cols: Math.floor(PRINT_PAGE_WIDTH_MM / colMm),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------------------------------------------

/** The least contrast against white a printed colour needs (WCAG's bar for large and bold text, and for graphics). */
export const PRINT_MIN_CONTRAST = 3;

const HEX = /^#[0-9a-f]{6}$/i;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG contrast of `#rrggbb` against white paper; 1 for anything that is not a colour. */
export function contrastOnWhite(hex: string): number {
  if (!HEX.test(hex)) return 1;
  const r = channel(parseInt(hex.slice(1, 3), 16));
  const g = channel(parseInt(hex.slice(3, 5), 16));
  const b = channel(parseInt(hex.slice(5, 7), 16));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (luminance + 0.05);
}

/**
 * The colour each role prints in, as on screen (P4h, §6.10 rule 6): the light palette, then the user's light role
 * colours (`appearance.roleColors`), then the profile's `colors.light` overrides, the later layer winning. A role
 * whose colour is under 3:1 against white is left out, and a role that is left out prints black.
 */
export function printPalette(cp: CompiledProfile, user?: ProfileColors): Partial<Record<Role, string>> {
  const overrides = profileOverrides(cp.profile, 'light');
  const mine = paletteOverrides(user, 'light');
  const palette: Partial<Record<Role, string>> = {};
  for (const role of ROLES) {
    const color = overrides[role] ?? mine[role] ?? ROLE_COLORS.light[role];
    if (HEX.test(color) && contrastOnWhite(color) >= PRINT_MIN_CONTRAST) palette[role] = color.toLowerCase();
  }
  return palette;
}

// ---------------------------------------------------------------------------------------------------------------
// Roles: the editor grammar's roles from the tokenizer's tokens
// ---------------------------------------------------------------------------------------------------------------

const PLAIN_NUMBER = /^[+-]?(?:\d+[.,]?\d*|[.,]\d+)(?:EX[+-]?\d+)?$/i;
const OPERATOR_CHARS = new Set([...'=+-*/^%:<>|&,()![];']);

/** A regex of the profile as a sticky one, for scanning from a position; null when the profile has none. */
function sticky(source: string | RegExp | undefined, flags = 'i'): RegExp | null {
  if (source === undefined) return null;
  if (typeof source === 'string') return new RegExp(source, `${flags}y`);
  return new RegExp(source.source, source.flags.replace(/[gy]/g, '') + 'y');
}

/** What the roles of one profile need, built once per document. */
interface RoleContext {
  cp: CompiledProfile;
  own: ReturnType<typeof letterAddresses>;
  prefixes: Set<string>;
  keywords: Set<string>;
  /** The words of the code database (Klartext `R0`, `RL`, `FMAX`): keywords to the grammar. */
  codeWords: Set<string>;
  /** The addresses of the code database; null without a database (every address then counts as known). */
  addresses: Set<string> | null;
  variables: RegExp | null;
  variablesWhole: RegExp | null;
  systemVariables: RegExp | null;
  /** Okuma's `syntax.extendedAddresses`, matched against a whole name: `SB`, `TL`, `DA`. */
  extended: RegExp | null;
  /** `syntax.colonWords`, upper-cased: `VCONST`, `VC`, `HSC-MODE`. */
  colonWords: Set<string>;
  number: RegExp;
  grammar: string;
  heading: RegExp | undefined;
}

function roleContext(cp: CompiledProfile, codes?: CodeDb): RoleContext {
  const block = cp.profile.syntax?.blockNumber;
  const prefixes = [block?.prefix, ...(block?.altPrefixes ?? [])].filter(
    (name): name is string => typeof name === 'string' && name !== '',
  );
  const variableSource = cp.re.variables?.source;
  return {
    cp,
    own: letterAddresses(cp.profile),
    prefixes: new Set(prefixes.map((name) => name.toUpperCase())),
    keywords: new Set(cp.keywords),
    codeWords: new Set(codes === undefined ? [] : wordCodes(codes, ['G', 'M'])),
    addresses: codes === undefined ? null : new Set(addressNames(codes)),
    variables: sticky(cp.re.variables),
    variablesWhole: variableSource === undefined ? null : new RegExp(`^(?:${variableSource})$`, cp.flags),
    systemVariables: sticky(cp.re.systemVariables),
    extended:
      typeof cp.profile.syntax?.extendedAddresses === 'string' && cp.profile.syntax.extendedAddresses !== ''
        ? new RegExp(`^(?:${cp.profile.syntax.extendedAddresses})$`, cp.flags)
        : null,
    number: new RegExp(`${numberPattern(cp.profile, { signed: false })}(?:EX[+-]?\\d+)?`, 'iy'),
    colonWords: new Set((Array.isArray(cp.profile.syntax?.colonWords) ? cp.profile.syntax.colonWords : []).map((name) => name.toUpperCase())),
    grammar: cp.profile.grammar ?? 'iso',
    heading: cp.re.sectionHeading,
  };
}

/** The role an address gives its word: the profile's own letters first, then the database's addresses. */
function addressRole(address: string, ctx: RoleContext): Role | null {
  const upper = address.toUpperCase();
  const { own } = ctx;
  if (upper === 'G') return 'gcode';
  if (upper === 'M') return 'mcode';
  if (own.tool === upper) return 'tool';
  if (own.feed === upper) return 'feed';
  if (own.spindle === upper) return 'spindle';
  if (own.axes.includes(upper)) return 'axis';
  if (own.arcCenter.includes(upper)) return 'arcCenter';
  if (ctx.prefixes.has(upper)) return 'blockNumber';
  // `,R` (a corner radius in direct drawing input), Klartext's `#`, and a value with no address: plain values.
  if (!/^[A-Z]/.test(upper)) return 'number';
  if (ctx.addresses === null) return upper.length === 1 ? 'number' : null;
  if (upper.length === 1) return ctx.addresses.has(upper) ? 'number' : null;
  // A longer address of the database: the feed's and the spindle's families keep their role (`FQ`), the rest is a value.
  if (!ctx.addresses.has(upper)) return null;
  if (own.feed !== null && upper.startsWith(own.feed)) return 'feed';
  if (own.spindle !== null && upper.startsWith(own.spindle)) return 'spindle';
  return 'number';
}

/** Okuma's local variable: two letters, then up to two more characters (syntax-okuma §3.6). */
const OKUMA_LOCAL = /^[A-Za-z]{2}[A-Za-z0-9]{0,2}$/;

/**
 * The role of the name in `NAME=value`. The profile's own letters keep the role they have as a word (`X=V1+V2` is the
 * axis); an `M3=3` keeps its code's; any other name is what the dialect says it is: Okuma's own multi-letter addresses
 * (`SB`, `TL`) are keywords and its other short names local variables, in Sinumerik a database address (`CR`) is a plain
 * value and every other name a keyword.
 */
function assignmentRole(name: string, ctx: RoleContext): Role | null {
  const upper = name.toUpperCase();
  const { own } = ctx;
  if (/^[A-Z]$/.test(upper)) {
    if (own.tool === upper) return 'tool';
    if (own.feed === upper) return 'feed';
    if (own.spindle === upper) return 'spindle';
    if (own.axes.includes(upper)) return 'axis';
    if (own.arcCenter.includes(upper)) return 'arcCenter';
  }
  if (/^G\d+$/.test(upper)) return 'gcode';
  if (/^M\d+$/.test(upper)) return 'mcode';
  if (ctx.variablesWhole?.test(name) === true) return 'variable';
  if (ctx.grammar === 'okuma') return ctx.extended?.test(name) === true ? 'keyword' : OKUMA_LOCAL.test(name) ? 'variable' : null;
  if (ctx.addresses?.has(upper) === true) return 'number';
  return 'keyword';
}

/** Paints the parts of an expression, an argument list or a value: strings, variables, numbers, names and operators. */
function paintFree(text: string, at: number, roles: (Role | null)[], ctx: RoleContext): void {
  const letters = /[A-Za-z_]+/y;
  const string = /"[^"]*"?/y;
  let local: RegExpExecArray | null;
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '"') {
      string.lastIndex = i;
      const hit = string.exec(text);
      const length = hit === null ? 1 : hit[0].length;
      fill(roles, at + i, at + i + length, 'string');
      i += length;
      continue;
    }
    if (ctx.variables !== null) {
      ctx.variables.lastIndex = i;
      const hit = ctx.variables.exec(text);
      if (hit !== null && hit[0].length > 0) {
        fill(roles, at + i, at + i + hit[0].length, 'variable');
        i += hit[0].length;
        continue;
      }
    }
    if (ctx.systemVariables !== null) {
      ctx.systemVariables.lastIndex = i;
      const hit = ctx.systemVariables.exec(text);
      if (hit !== null && hit[0].length > 0) {
        fill(roles, at + i, at + i + hit[0].length, 'variable');
        i += hit[0].length;
        continue;
      }
    }
    ctx.number.lastIndex = i;
    const number = ctx.number.exec(text);
    if (number !== null && number[0].length > 0) {
      fill(roles, at + i, at + i + number[0].length, 'number');
      i += number[0].length;
      continue;
    }
    letters.lastIndex = i;
    const word = letters.exec(text);
    if (word !== null) {
      // A name in front of a bracket is a function, as the grammar reads it; otherwise only the profile's keywords count.
      const before = word[0].toUpperCase();
      let length = word[0].length;
      let role: Role | null = null;
      if (ctx.keywords.has(before) || /^\s*[([]/.test(text.slice(i + length))) role = 'keyword';
      else if (ctx.grammar === 'okuma' && (local = /^[A-Za-z]{2}[A-Za-z0-9]{0,2}(?![0-9A-Za-z])/.exec(text.slice(i))) !== null) {
        role = 'variable';
        length = local[0].length;
      }
      fill(roles, at + i, at + i + length, role);
      i += length;
      continue;
    }
    if (OPERATOR_CHARS.has(char)) roles[at + i] = 'operator';
    i += 1;
  }
}

function fill(roles: (Role | null)[], start: number, end: number, role: Role | null): void {
  for (let i = start; i < end; i++) roles[i] = role;
}

/** The role of every UTF-16 unit of `line`, from the tokens the tokenizer read (null: no role, black). */
function rolesOfLine(line: string, tokens: readonly NcToken[], ctx: RoleContext): (Role | null)[] {
  const roles: (Role | null)[] = new Array<Role | null>(line.length).fill(null);
  // A structure block is read as a comment and painted as one heading.
  if (ctx.heading !== undefined && ctx.heading.test(line)) {
    fill(roles, 0, line.length, 'section');
    return roles;
  }
  for (const token of tokens) {
    const { start, end, text } = token;
    switch (token.kind) {
      case 'blockNumber':
      case 'skip':
      case 'comment':
      case 'string':
      case 'variable':
      case 'operator':
      case 'programMarker':
        fill(roles, start, end, token.kind);
        break;
      case 'label':
        fill(roles, start, end, 'section');
        break;
      case 'continuation':
        fill(roles, start, end, 'operator');
        break;
      case 'keyword': {
        const split = token.valueText === undefined ? end : end - token.valueText.length;
        fill(roles, start, split, 'keyword');
        fill(roles, split, end, 'number');
        break;
      }
      case 'expression':
        paintFree(text, start, roles, ctx);
        break;
      case 'call': {
        const open = text.indexOf('(');
        if (open < 0) {
          paintShortName(text, start, roles, ctx); // a name that stands alone: the grammar cannot tell it from any other name
          break;
        }
        fill(roles, start, start + open, 'keyword');
        paintFree(text.slice(open), start + open, roles, ctx);
        break;
      }
      case 'unknown':
        paintShortName(text, start, roles, ctx);
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(text)) {
          // A function name in front of its bracket, or a local variable of the dialect.
          if (/^\s*\[/.test(line.slice(end))) fill(roles, start, end, 'keyword');
          else if (ctx.variablesWhole?.test(text) === true || (ctx.grammar === 'okuma' && OKUMA_LOCAL.test(text))) fill(roles, start, end, 'variable');
        }
        break;
      case 'word':
        paintWord(token, roles, ctx);
        break;
      default:
        // whitespace, text: no role.
        break;
    }
  }
  return roles;
}

/** A one- or two-letter address and its number that the tokenizer does not know as a word (Sinumerik `CR15`). */
function paintShortName(text: string, start: number, roles: (Role | null)[], ctx: RoleContext): void {
  const hit = /^([A-Za-z]{1,2})\d+(?:[.,]\d*)?$/.exec(text);
  if (hit !== null && ctx.addresses?.has(hit[1].toUpperCase()) === true) fill(roles, start, start + text.length, 'number');
}

/** The parts of one word token: an assignment, a code word, or an address and its value. */
function paintWord(token: NcToken, roles: (Role | null)[], ctx: RoleContext): void {
  const { start, end, text } = token;
  // A colon word of the profile (`VCONST:ON`, `VC:120`) is one plain value, whatever its name is in the database.
  const colon = text.indexOf(':');
  if (colon > 0 && ctx.colonWords.has(text.slice(0, colon).toUpperCase())) {
    fill(roles, start, end, 'number');
    return;
  }
  const eq = text.indexOf('=');
  if (eq > 0) {
    // An assignment: the name, the `=`, then the value in its parts.
    fill(roles, start, start + eq, assignmentRole(text.slice(0, eq).trim(), ctx));
    roles[start + eq] = 'operator';
    paintFree(text.slice(eq + 1), start + eq + 1, roles, ctx);
    return;
  }
  const value = token.valueText;
  if (ctx.codeWords.has(text.toUpperCase())) {
    fill(roles, start, end, 'keyword');
    return;
  }
  // A word of the database is a keyword; so is a rotation direction, a lone sign behind letters (`DR-`).
  if (value !== undefined && /^[+-]$/.test(value) && (token.address ?? '').length > 1) {
    fill(roles, start, end, 'keyword');
    return;
  }
  // A word that stands alone (`TOOL CALL 5 Z`, `F AUTO`) is coloured only where the dialect allows an axis or the
  // tool a bare letter (Klartext); any other bare letter has no value for its address to colour.
  if (value === undefined) {
    const role = addressRole(token.address ?? '', ctx);
    if (ctx.grammar === 'klartext' && (role === 'axis' || role === 'tool')) fill(roles, start, end, role);
    return;
  }
  const role = addressRole(token.address ?? '', ctx);
  if (role === null) return;
  const bare = value.replace(/^[+-]\s*/, '');
  if (PLAIN_NUMBER.test(value) || text.includes(':') || (ctx.grammar === 'klartext' && ctx.variablesWhole?.test(bare) === true)) {
    fill(roles, start, end, role);
    return;
  }
  // A variable or an expression as the value keeps the role of its address for the sign in front of it.
  const split = end - value.length;
  fill(roles, start, split, role);
  const sign = /^[+-]\s*(?=[#$[])/.exec(value);
  const signLength = sign === null ? 0 : sign[0].length;
  fill(roles, split, split + signLength, role);
  paintFree(value.slice(signLength), split + signLength, roles, ctx);
}

const CONTEXTS = new WeakMap<CompiledProfile, { codes: CodeDb | undefined; ctx: RoleContext }>();

/** The role of every UTF-16 unit of `line` as the print paints it. The tests hold it to the Monarch simulation. */
export function lineRoles(line: string, cp: CompiledProfile, prev?: LineState, codes?: CodeDb): { roles: (Role | null)[]; state: LineState } {
  const result = tokenizeLine(line, cp, prev);
  let cached = CONTEXTS.get(cp);
  if (cached === undefined || cached.codes !== codes) CONTEXTS.set(cp, (cached = { codes, ctx: roleContext(cp, codes) }));
  return { roles: rolesOfLine(line, result.tokens, cached.ctx), state: result.state };
}

// ---------------------------------------------------------------------------------------------------------------
// Rows and pages
// ---------------------------------------------------------------------------------------------------------------

/** How many character cells a code point takes: 2 for wide (East Asian) characters, 0 for combining marks. */
function cellsOf(code: number): number {
  if (code >= 0x300 && code <= 0x36f) return 0;
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

/** The digits of the largest line number of `source`. */
function gutterOf(source: PrintSource): number {
  return String(source.firstLine + Math.max(source.lines.length, 1) - 1).length;
}

/**
 * One line cut into rows of `textCols` cells: tabs become blanks to the next multiple of 4, any other control
 * character a blank, a wide character takes two cells (and never straddles the end of a row), and the blanks at the
 * end of the line are dropped.
 */
function layoutLine(line: string, roles: readonly (Role | null)[], colorOf: (role: Role | null) => string | undefined, textCols: number): PrintSpan[][] {
  const rows: PrintSpan[][] = [[]];
  let cells = 0;
  let logical = 0;

  const put = (text: string, width: number, color: string | undefined): void => {
    if (width > 0 && cells + width > textCols) {
      rows.push([]);
      cells = 0;
    }
    const row = rows[rows.length - 1];
    const last = row[row.length - 1];
    if (last !== undefined && last.color === color) last.text += text;
    else row.push(color === undefined ? { text } : { text, color });
    cells += width;
    logical += width;
  };

  for (let i = 0; i < line.length; ) {
    const code = line.codePointAt(i) as number;
    const size = code > 0xffff ? 2 : 1;
    const color = colorOf(roles[i] ?? null);
    if (code === 9) {
      const blanks = TAB_STOP - (logical % TAB_STOP);
      for (let k = 0; k < blanks; k++) put(' ', 1, color);
    } else if (code < 0x20 || code === 0x7f) {
      put(' ', 1, color);
    } else {
      put(line.slice(i, i + size), cellsOf(code), color);
    }
    i += size;
  }

  // The blanks at the end of the line are invisible; a row that holds nothing else is not printed.
  for (let r = rows.length - 1; r >= 0; r--) {
    const row = rows[r];
    while (row.length > 0) {
      const last = row[row.length - 1];
      last.text = last.text.replace(/ +$/, '');
      if (last.text === '') row.pop();
      else break;
    }
    if (row.length === 0 && r > 0) rows.pop();
    else break;
  }
  return rows;
}

/**
 * Whether `lines` laid out in rows of `textCols` cells come to more than `limit` rows, counted without building a
 * row: each line takes `ceil(cells / textCols)` rows (at least one, trailing blanks not counted), with the cell
 * rule of `layoutLine` (a tab runs to the next multiple of 4, any other control character is one cell, a wide
 * character two, a combining mark none). Stops as soon as the budget is gone, so one line of 10 MB costs one
 * pass and no page tree; a wide character that would straddle a row end can make the real figure a row or two
 * higher, which only matters at the very limit.
 */
export function exceedsRowBudget(lines: readonly string[], textCols: number, limit: number): boolean {
  let total = 0;
  for (const line of lines) {
    let end = line.length;
    while (end > 0) {
      const c = line.charCodeAt(end - 1);
      if (c <= 0x20 || c === 0x7f) end--;
      else break;
    }
    let cells = 0;
    for (let i = 0; i < end; ) {
      const code = line.codePointAt(i) as number;
      i += code > 0xffff ? 2 : 1;
      if (code === 9) cells += TAB_STOP - (cells % TAB_STOP);
      else if (code < 0x20 || code === 0x7f) cells += 1;
      else cells += cellsOf(code);
      if (cells > (limit - total) * textCols) return true;
    }
    total += Math.max(Math.ceil(cells / textCols), 1);
    if (total > limit) return true;
  }
  return false;
}

/** The pages of `source` for `cp`: tokens coloured with the light theme's role colours, or black. */
export function buildPrintDocument(source: PrintSource, options: PrintOptions, cp: CompiledProfile, codes?: CodeDb, user?: ProfileColors): PrintDocument {
  const fontPt = clampFontPt(options.fontPt);
  const opts: PrintOptions = { ...options, fontPt };
  const { rows: pageRows, cols } = pageGeometry(fontPt);
  const gutter = opts.lineNumbers ? gutterOf(source) : 0;
  const textCols = Math.max(cols - (gutter > 0 ? gutter + 1 : 0), 1);

  const palette = opts.colors === 'color' ? printPalette(cp, user) : {};
  const colorOf = (role: Role | null): string | undefined => (role === null ? undefined : palette[role]);
  const ctx = roleContext(cp, codes);

  const pages: PrintPage[] = [];
  let current: PrintRow[] = [];
  const flush = (): void => {
    pages.push({ number: pages.length + 1, rows: current });
    current = [];
  };

  let state: LineState | undefined;
  for (let n = 0; n < source.lines.length; n++) {
    const line = source.lines[n];
    const result = tokenizeLine(line, cp, state);
    state = result.state;
    const roles = opts.colors === 'color' ? rolesOfLine(line, result.tokens, ctx) : [];
    const rows = layoutLine(line, roles, colorOf, textCols);
    // A line that fits on one page is not split across two.
    if (current.length > 0 && rows.length <= pageRows && current.length + rows.length > pageRows) flush();
    rows.forEach((spans, k) => {
      if (current.length >= pageRows) flush();
      current.push({ line: k === 0 ? source.firstLine + n : null, spans });
    });
  }
  if (current.length > 0 || pages.length === 0) flush();

  return {
    title: source.name,
    date: source.at.toLocaleDateString(),
    options: opts,
    rows: pageRows,
    cols,
    gutter,
    pages,
  };
}

/** The page's right header: "Page 2 of 5". */
export function pageLabel(doc: PrintDocument, page: PrintPage, t: Translate = translate): string {
  return t('print.pageOf', { page: page.number, pages: doc.pages.length });
}

// ---------------------------------------------------------------------------------------------------------------
// The HTML file
// ---------------------------------------------------------------------------------------------------------------

/** Text for an HTML element or a quoted attribute: nothing of a document reaches the page unescaped. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'));
}

/** A complete, self-contained HTML page of `doc` (inline styles, no script): "Export as HTML". */
export function printDocumentHtml(doc: PrintDocument, t: Translate = translate): string {
  const classes = new Map<string, string>();
  const classOf = (color: string): string => {
    let name = classes.get(color);
    if (name === undefined) {
      name = `c${classes.size}`;
      classes.set(color, name);
    }
    return name;
  };

  const body: string[] = [];
  for (const page of doc.pages) {
    body.push(`<section class="page" data-page="${page.number}">`);
    body.push(
      `<header class="head"><span class="name">${escapeHtml(doc.title)}</span><span class="date">${escapeHtml(doc.date)}</span>` +
        `<span class="of">${escapeHtml(pageLabel(doc, page, t))}</span></header>`,
    );
    for (const row of page.rows) {
      const gutter = doc.gutter > 0 ? `<span class="n">${escapeHtml(gutterText(row.line, doc.gutter))}</span>` : '';
      const spans = row.spans
        .map((span) =>
          span.color !== undefined && HEX.test(span.color)
            ? `<span class="${classOf(span.color)}">${escapeHtml(span.text)}</span>`
            : escapeHtml(span.text),
        )
        .join('');
      body.push(`<div class="r" data-line="${row.line ?? ''}">${gutter}${spans}</div>`);
    }
    body.push('</section>');
  }

  const colorRules = [...classes].map(([color, name]) => `.${name}{color:${color}}`).join('');
  const pt = doc.options.fontPt;
  const css =
    `@page{margin:${PRINT_MARGIN_MM}mm}` +
    `html{background:#e9e9ec}body{margin:0;padding:8mm 0}` +
    `.root{font-family:${PRINT_FONT_STACK};font-size:${pt}pt;line-height:${PRINT_LINE_EM};color:#000;` +
    `print-color-adjust:exact;-webkit-print-color-adjust:exact}` +
    `.page{box-sizing:content-box;width:${PRINT_PAGE_WIDTH_MM}mm;height:${pageHeightEm(doc.rows)}em;margin:0 auto 8mm;padding:${PRINT_MARGIN_MM}mm;` +
    `background:#fff;overflow:hidden;box-shadow:0 0 3mm rgba(0,0,0,.25)}` +
    `.head{display:flex;gap:2em;height:${PRINT_HEADER_ROWS * PRINT_LINE_EM}em;box-sizing:border-box;border-bottom:.5pt solid #000;white-space:pre}` +
    `.head .name{flex:1;overflow:hidden;text-overflow:ellipsis}.head .of{text-align:right}` +
    `.r{height:${PRINT_LINE_EM}em;white-space:pre;overflow:hidden}.n{color:#555;user-select:none}` +
    colorRules +
    `@media print{html,body{background:#fff;padding:0}.page{width:auto;margin:0;padding:0;box-shadow:none;break-after:page}` +
    `.page:last-child{break-after:auto}}`;

  return (
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${escapeHtml(doc.title)}</title>\n<style>${css}</style>\n</head>\n` +
    `<body>\n<main class="root ${doc.options.colors}">\n${body.join('\n')}\n</main>\n</body>\n</html>\n`
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------------------------------------------

/** The fields of the print form; the selection choice exists only with a selection (and is then the default). */
export function printFields(hasSelection: boolean, t: Translate = translate): FieldSpec[] {
  return [
    {
      id: 'scope',
      type: 'choice',
      label: t('print.form.scope'),
      default: hasSelection ? 'selection' : 'document',
      choices: [
        { label: t('print.form.scopeDocument'), value: 'document' },
        ...(hasSelection ? [{ label: t('print.form.scopeSelection'), value: 'selection' }] : []),
      ],
    },
    {
      id: 'colors',
      type: 'choice',
      label: t('print.form.colors'),
      help: t('print.form.colorsHelp'),
      default: 'color',
      choices: [
        { label: t('print.form.colorsColor'), value: 'color' },
        { label: t('print.form.colorsBlack'), value: 'black' },
      ],
    },
    { id: 'lineNumbers', type: 'bool', label: t('print.form.lineNumbers'), help: t('print.form.lineNumbersHelp'), default: true },
    {
      id: 'fontPt',
      type: 'integer',
      label: t('print.form.fontPt'),
      help: t('print.form.fontPtHelp'),
      default: PRINT_FONT_DEFAULT,
      min: PRINT_FONT_MIN,
      max: PRINT_FONT_MAX,
      required: true,
    },
  ];
}

/** The options of a form answer; the selection is the scope only when there is one. */
export function optionsFromValues(values: Record<string, unknown>, hasSelection: boolean): PrintOptions {
  return {
    scope: hasSelection && values.scope === 'selection' ? 'selection' : 'document',
    colors: values.colors === 'black' ? 'black' : 'color',
    lineNumbers: values.lineNumbers !== false,
    fontPt: clampFontPt(values.fontPt),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------------------------------------------

/** What a print or an export did; the status bar says it in plain words. */
export type PrintOutcome =
  | { ok: true; pages: number }
  | { ok: false; reason: 'noDocument' | 'noSelection' | 'tooLong' | 'crossesJunction' | 'cancelled' | 'failed'; lines?: number };

/**
 * `app/print.ts` → `export const print: PrintService`, the harness hook `h.app.ctx.print` (plan §6.5 rule 10).
 */
export interface PrintService {
  /** The page model of the active document (or its selection) for `options`; null without a document. The harness reads it. */
  build(options: PrintOptions): PrintDocument | null;
  /** `file.print` after the form: builds, mounts the print view, calls the print function, removes the view. */
  print(options: PrintOptions): Promise<PrintOutcome>;
  /** `file.exportHtml` after the form: the same pages as one HTML file through the save dialog. */
  exportHtml(options: PrintOptions): Promise<PrintOutcome>;
  /** Replaces `window.print` (the harness; no scenario may open a system dialog). */
  setPrintFunction(fn: () => void): void;
}

/** A mounted print view; `destroy` removes it from the page. */
export interface PrintViewHandle {
  destroy(): void;
}

export interface PrintDeps {
  docs: Pick<DocumentStore, 'getActiveId' | 'get' | 'list'>;
  editor: Pick<EditorService, 'getLineCount' | 'getLines' | 'selectionLines'>;
  machines: Pick<MachineService, 'effective'>;
  /** The user's role colours (`appearance.roleColors`); the print uses their light ones, as the screen does. */
  roleColors?(): ProfileColors;
  status: Pick<StatusService, 'show'>;
  dialogs: Pick<NativeDialogs, 'saveFile'>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  /** Mounts the hidden print view on the page. */
  mountView(doc: PrintDocument): PrintViewHandle;
  /** Listens for the window's `afterprint`; the answer removes the listener. */
  onAfterPrint(listener: () => void): () => void;
  /** Resolves after the view has been laid out (two animation frames, with a fallback for a window that has none). */
  settled(): Promise<void>;
  /** `window.print`. */
  printWindow(): unknown;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  now(): Date;
  t: Translate;
}

/** The file name of a path, either separator. */
function baseName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

/** `shaft.nc` → `shaft.html`; a name without an extension gets one. */
export function exportFileName(title: string): string {
  const stem = title.replace(/\.[^./\\]+$/, '');
  return `${stem === '' ? title : stem}.html`;
}

export function createPrintService(deps: PrintDeps): PrintService {
  const { t } = deps;
  const roleColorsOf = (): ProfileColors => {
    try {
      return deps.roleColors?.() ?? {};
    } catch (err) {
      console.error('print: the role colours could not be read', err);
      return {};
    }
  };
  // `window.print()` answers a promise where Tauri routes it to the native print operation (macOS), nothing elsewhere.
  let printFunction: () => unknown = () => deps.printWindow();

  /** The view that is mounted, and everything that removes it. */
  let view: { handle: PrintViewHandle; docId: DocId; stops: (() => void)[] } | null = null;

  function removeView(): void {
    if (view === null) return;
    const current = view;
    view = null;
    for (const stop of current.stops) stop();
    current.handle.destroy();
  }

  const refuse = (reason: Extract<PrintOutcome, { ok: false }>['reason'], message: string, lines?: number): PrintOutcome => {
    deps.status.show(message, { error: true });
    return lines === undefined ? { ok: false, reason } : { ok: false, reason, lines };
  };

  /** The document to print: its source and profile, or the outcome that says why not. */
  function prepare(options: PrintOptions, forExport: boolean): { source: PrintSource; cp: CompiledProfile; codes: CodeDb; user: ProfileColors } | PrintOutcome {
    const docId = deps.docs.getActiveId();
    const doc = docId === null ? undefined : deps.docs.get(docId);
    if (docId === null || !doc) return refuse('noDocument', t('print.noDocument'));

    const lineCount = deps.editor.getLineCount(docId);
    let first = 1;
    let last = lineCount;
    if (options.scope === 'selection') {
      const scope = transformScope(lineCount, deps.editor.selectionLines());
      if (scope.crossesJunction === true) return refuse('crossesJunction', t(SELECTION_CROSSES.key));
      if (!scope.fromSelection) return refuse('noSelection', t('print.noSelection'));
      first = scope.startLine;
      last = scope.endLine;
    }
    const count = last - first + 1;
    const limit = forExport ? EXPORT_MAX_LINES : PRINT_MAX_LINES;
    if (count > limit) {
      const params = { lines: count.toLocaleString('en-US'), max: limit.toLocaleString('en-US') };
      return refuse('tooLong', forExport ? t('print.tooLongExport', params) : t('print.tooLong', params), count);
    }
    let cp: CompiledProfile;
    let codes: CodeDb;
    try {
      const effective = deps.machines.effective(docId);
      cp = effective.cp;
      codes = effective.codes;
    } catch (err) {
      console.error('print: the machine of the document could not be read', err);
      return refuse('failed', t('print.failed'));
    }
    const lines = deps.editor.getLines(docId, first, last);
    // The rows of the pages, not only the lines, are bounded: one very long line cuts into thousands of rows.
    const source: PrintSource = { name: doc.title, firstLine: first, lines, at: deps.now() };
    const { rows: pageRows, cols } = pageGeometry(clampFontPt(options.fontPt));
    const gutter = options.lineNumbers ? gutterOf(source) : 0;
    const textCols = Math.max(cols - (gutter > 0 ? gutter + 1 : 0), 1);
    if (exceedsRowBudget(lines, textCols, limit)) {
      const params = { pages: Math.ceil(limit / pageRows).toLocaleString('en-US') };
      return refuse('tooLong', forExport ? t('print.tooManyPagesExport', params) : t('print.tooManyPages', params), count);
    }
    return { source, cp, codes, user: roleColorsOf() };
  }

  const isOutcome = (value: unknown): value is PrintOutcome => typeof (value as PrintOutcome).ok === 'boolean';

  return {
    build(options) {
      const prepared = prepare(options, false);
      return isOutcome(prepared) ? null : buildPrintDocument(prepared.source, options, prepared.cp, prepared.codes, prepared.user);
    },

    async print(options) {
      removeView(); // the view of an earlier print goes first
      const prepared = prepare(options, false);
      if (isOutcome(prepared)) return prepared;
      const docId = deps.docs.getActiveId() as DocId;
      const doc = buildPrintDocument(prepared.source, options, prepared.cp, prepared.codes, prepared.user);

      let handle: PrintViewHandle;
      try {
        handle = deps.mountView(doc);
      } catch (err) {
        console.error('print view failed', err);
        return refuse('failed', t('print.failed'));
      }
      const stops: (() => void)[] = [];
      view = { handle, docId, stops };
      // Removed after the print (`afterprint`), when the document closes, and after five minutes at the latest.
      stops.push(deps.onAfterPrint(removeView));
      let subscribed = false;
      const unsubscribe = deps.docs.list.subscribe((list) => {
        // The subscription calls back at once; only a later list without the document counts.
        if (subscribed && !list.some((meta) => meta.id === docId)) removeView();
      });
      subscribed = true;
      stops.push(unsubscribe);
      const timer = deps.setTimer(removeView, PRINT_VIEW_TIMEOUT_MS);
      stops.push(() => deps.clearTimer(timer));

      try {
        await deps.settled();
        // The view may have gone while the pages were laid out (the document was closed).
        if (view === null || view.handle !== handle) return { ok: false, reason: 'cancelled' };
        await printFunction();
      } catch (err) {
        console.error('print failed', err);
        removeView();
        return refuse('failed', t('print.failed'));
      }
      return { ok: true, pages: doc.pages.length };
    },

    async exportHtml(options) {
      const prepared = prepare(options, true);
      if (isOutcome(prepared)) return prepared;
      const doc = buildPrintDocument(prepared.source, options, prepared.cp, prepared.codes, prepared.user);
      const filters: DialogFilter[] = [{ name: t('print.htmlFilter'), extensions: ['html', 'htm'] }];
      const path = await deps.dialogs.saveFile({ defaultPath: exportFileName(doc.title), filters });
      if (path === null) return { ok: false, reason: 'cancelled' };
      try {
        await deps.writeFile(path, new TextEncoder().encode(printDocumentHtml(doc, t)));
      } catch (err) {
        deps.status.show(t('print.exportFailed'), { error: true, detail: err instanceof Error ? err.message : String(err) });
        return { ok: false, reason: 'failed' };
      }
      deps.status.show(t('print.exported', { count: doc.pages.length, name: baseName(path) }));
      return { ok: true, pages: doc.pages.length };
    },

    setPrintFunction(fn) {
      printFunction = fn;
    },
  };
}

/** Two animation frames, or 120 ms where a window runs none (a hidden one). */
function settledInWebview(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    setTimeout(finish, 120);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(finish));
  });
}

/** The application-wide print service. */
export const print: PrintService = createPrintService({
  docs: appDocs,
  editor: appEditor,
  machines: appMachines,
  roleColors: () => appSettings.get('appearance.roleColors'),
  status: appStatus,
  dialogs: appDialogs,
  async writeFile(path, bytes) {
    // Loaded on demand: the fs plugin is only reachable inside the webview. The save dialog granted this one path.
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    await writeFile(path, bytes);
  },
  mountView: mountPrintView,
  onAfterPrint(listener) {
    window.addEventListener('afterprint', listener);
    return () => window.removeEventListener('afterprint', listener);
  },
  settled: settledInWebview,
  printWindow: () => window.print(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => new Date(),
  t: translate,
});
