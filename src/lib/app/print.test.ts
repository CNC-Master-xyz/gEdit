// Printing (Phase 4 plan §6.5 rule 10; P4.15): the page model, the colour rule, the escaping, the HTML file, the
// view's markup and lifecycle, the limits and the one permission.
//
// The page model is pure, so most cases build pages from plain lines with a built-in profile. The service is driven
// with fakes (editor, dialogs, status, the view mount, the timers), so nothing needs Monaco or a webview.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { render } from 'svelte/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EXPORT_MAX_LINES,
  exceedsRowBudget,
  PRINT_FONT_DEFAULT,
  PRINT_FONT_MAX,
  PRINT_FONT_MIN,
  PRINT_MAX_LINES,
  PRINT_VIEW_TIMEOUT_MS,
  buildPrintDocument,
  clampFontPt,
  contrastOnWhite,
  createPrintService,
  escapeHtml,
  exportFileName,
  lineRoles,
  optionsFromValues,
  pageGeometry,
  pageLabel,
  printDocumentHtml,
  printFields,
  printPalette,
  type PrintDeps,
  type PrintDocument,
  type PrintOptions,
  type PrintOutcome,
  type PrintSource,
  type PrintViewHandle,
} from './print';
import PrintView from '$lib/components/print/PrintView.svelte';
import { gutterText } from '$lib/components/print/printStyle';
import { ROLE_COLORS, ROLES } from '$lib/core/grammar/roles';
import { rolePerChar } from '$lib/core/grammar/monarchSim';
import { DIALECTS, corpus } from '$lib/core/grammar/testCorpus';
import { createDocumentStore } from '$lib/stores/documents';
import { t } from '$lib/i18n';
import type { DocId, NewDocMeta } from '$lib/app/types';
import type { CompiledProfile, ProfileColors } from '$lib/core/profiles/types';

const FANUC = DIALECTS.find((d) => d.id === 'fanuc-gcode')!;
const CP: CompiledProfile = FANUC.cp;

const AT = new Date(2026, 9, 19, 14, 5);
const OPTIONS: PrintOptions = { scope: 'document', colors: 'color', lineNumbers: true, fontPt: PRINT_FONT_DEFAULT };

function source(lines: readonly string[], over: Partial<PrintSource> = {}): PrintSource {
  return { name: 'shaft.nc', firstLine: 1, lines, at: AT, ...over };
}

function build(lines: readonly string[], options: Partial<PrintOptions> = {}, over: Partial<PrintSource> = {}): PrintDocument {
  return buildPrintDocument(source(lines, over), { ...OPTIONS, ...options }, CP);
}

/** The text of one row as the page shows it: the gutter and the spans. */
function rowText(doc: PrintDocument, page: number, row: number): string {
  const r = doc.pages[page].rows[row];
  return gutterText(r.line, doc.gutter) + r.spans.map((s) => s.text).join('');
}

const numbered = (count: number, text = 'G1 X10.'): string[] => Array.from({ length: count }, (_, i) => `N${i + 1} ${text}`);

// ---------------------------------------------------------------------------------------------------------------
// The contract's constants
// ---------------------------------------------------------------------------------------------------------------

describe('print: the limits of the contract', () => {
  it('pins the limits', () => {
    expect([PRINT_FONT_MIN, PRINT_FONT_DEFAULT, PRINT_FONT_MAX]).toEqual([7, 9, 14]);
    expect(PRINT_MAX_LINES).toBe(20_000);
    expect(EXPORT_MAX_LINES).toBe(100_000);
    expect(PRINT_VIEW_TIMEOUT_MS).toBe(300_000);
  });

  it('clamps the font size to whole points from 7 to 14 and falls back to 9', () => {
    expect([clampFontPt(3), clampFontPt(20), clampFontPt(9.6), clampFontPt('x'), clampFontPt(NaN), clampFontPt(undefined)]).toEqual([7, 14, 10, 9, 9, 9]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The page model
// ---------------------------------------------------------------------------------------------------------------

describe('pageGeometry', () => {
  // The smaller printable area of A4 (210 x 297) and Letter (215.9 x 279.4) with 15 mm margins: 180 x 249.4 mm.
  const WIDTH_MM = 180;
  const HEIGHT_MM = 249.4;
  const PT = 25.4 / 72;

  it('gives the rows and columns of the three font sizes the owner will meet', () => {
    expect(pageGeometry(7)).toEqual({ rows: 75, cols: 117 });
    expect(pageGeometry(9)).toEqual({ rows: 58, cols: 91 });
    expect(pageGeometry(14)).toEqual({ rows: 36, cols: 58 });
  });

  it.each([7, 8, 9, 10, 11, 12, 13, 14])('%i pt: the rows and the header fit the smaller paper, the columns fit the width', (pt) => {
    const { rows, cols } = pageGeometry(pt);
    // header (two rows) + body rows, at a row height of 1.3 em, never taller than Letter's printable height
    expect((rows + 2) * pt * 1.3 * PT).toBeLessThanOrEqual(HEIGHT_MM);
    // and no row is wider than A4's printable width, with the widest of the editor's fonts (0.62 em)
    expect(cols * pt * 0.62 * PT).toBeLessThanOrEqual(WIDTH_MM);
    // a whole row more would not fit: the page is cut to what it can hold
    expect((rows + 3) * pt * 1.3 * PT).toBeGreaterThan(248);
  });

  it('holds an 80-column program with a six-digit line-number gutter up to 9 pt, the default', () => {
    for (let pt = 7; pt <= 9; pt++) expect(pageGeometry(pt).cols).toBeGreaterThanOrEqual(80 + 7);
  });

  it('clamps an out-of-range size instead of producing an empty page', () => {
    expect(pageGeometry(1)).toEqual(pageGeometry(7));
    expect(pageGeometry(99)).toEqual(pageGeometry(14));
  });
});

describe('pagination and the header', () => {
  it('cuts the lines into pages of `rows` rows and counts "Page n of m" in the model', () => {
    const { rows } = pageGeometry(9);
    const doc = build(numbered(rows * 2 + 5));
    expect(doc.pages.map((p) => p.rows.length)).toEqual([rows, rows, 5]);
    expect(doc.pages.map((p) => p.number)).toEqual([1, 2, 3]);
    expect(doc.pages.map((p) => pageLabel(doc, p))).toEqual(['Page 1 of 3', 'Page 2 of 3', 'Page 3 of 3']);
    expect(doc.rows).toBe(rows);
  });

  it('puts a program that fits on one page on page 1 of 1, and an empty program too', () => {
    expect(build(['G0 X0']).pages).toHaveLength(1);
    expect(build([]).pages).toEqual([{ number: 1, rows: [] }]);
    expect(pageLabel(build([]), build([]).pages[0])).toBe('Page 1 of 1');
  });

  it('carries the name and the local date of the print', () => {
    const doc = build(['G0 X0'], {}, { name: 'untitled-3' });
    expect(doc.title).toBe('untitled-3');
    expect(doc.date).toBe(AT.toLocaleDateString());
  });

  it('a larger font gives more pages for the same program', () => {
    const lines = numbered(200);
    expect(build(lines, { fontPt: 14 }).pages.length).toBeGreaterThan(build(lines, { fontPt: 7 }).pages.length);
    expect(build(lines, { fontPt: 14 }).pages.length).toBe(Math.ceil(200 / pageGeometry(14).rows));
  });

  it('continues a line wider than the page on the next row, without a number', () => {
    const { cols } = pageGeometry(9);
    const long = `(${'A'.repeat(cols * 2)})`; // wider than two rows
    const doc = build(['G1 X1', long, 'G1 X2']);
    const rows = doc.pages[0].rows;
    expect(rows.map((r) => r.line)).toEqual([1, 2, null, null, 3]);
    // nothing is lost and no row is wider than the text columns
    expect(rows.slice(1, 4).map((r) => r.spans.map((s) => s.text).join('')).join('')).toBe(long);
    for (const row of rows) expect(row.spans.map((s) => s.text).join('').length).toBeLessThanOrEqual(cols - 2);
  });

  it('does not split a wrapped line across two pages when it fits on one', () => {
    const { rows: pageRows, cols } = pageGeometry(9);
    const wide = 'X'.repeat((cols - 3) * 2 + 5); // three rows of the text columns (a two-digit gutter and a blank)
    const lines = [...numbered(pageRows - 1), wide, 'G0'];
    const doc = build(lines);
    // the wide line would have started on the last row of page 1; it moves to page 2 as a whole
    expect(doc.pages[0].rows).toHaveLength(pageRows - 1);
    expect(doc.pages[1].rows.map((r) => r.line)).toEqual([pageRows, null, null, pageRows + 1]);
  });

  it('turns a tab into blanks to the next multiple of four and any other control character into a blank', () => {
    const doc = build(['G1\tX1', '\t\tY', 'A\u0001B'], { lineNumbers: false });
    expect(rowText(doc, 0, 0)).toBe('G1  X1');
    expect(rowText(doc, 0, 1)).toBe('        Y');
    expect(rowText(doc, 0, 2)).toBe('A B');
  });

  it('drops the blanks at the end of a line, and a row of nothing but blanks', () => {
    const { cols } = pageGeometry(9);
    const doc = build([`G1 X1${' '.repeat(cols * 3)}`, '   ', ''], { lineNumbers: false });
    expect(doc.pages[0].rows.map((r) => r.line)).toEqual([1, 2, 3]);
    expect(rowText(doc, 0, 0)).toBe('G1 X1');
    expect(rowText(doc, 0, 1)).toBe('');
  });

  it('counts a wide character as two columns and never splits it over two rows', () => {
    const { cols } = pageGeometry(9);
    const text = `(${'\u6F22'.repeat(cols)})`;
    const doc = build([text], { lineNumbers: false });
    const rows = doc.pages[0].rows;
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) expect([...row.spans.map((s) => s.text).join('')].reduce((n, ch) => n + (ch === '\u6F22' ? 2 : 1), 0)).toBeLessThanOrEqual(cols);
    expect(rows.map((r) => r.spans.map((s) => s.text).join('')).join('')).toBe(text);
  });
});

describe('line numbers', () => {
  it('are the document lines, right-aligned in a gutter as wide as the largest number', () => {
    const doc = build(numbered(120));
    expect(doc.gutter).toBe(3);
    expect(rowText(doc, 0, 0).startsWith('  1 ')).toBe(true);
    expect(rowText(doc, 0, 9).startsWith(' 10 ')).toBe(true);
    expect(doc.pages[1].rows[0].line).toBe(pageGeometry(9).rows + 1);
  });

  it('keep the document’s numbers for a selection, and the gutter fits the largest of them', () => {
    const doc = build(['G1 X1', 'G1 X2', 'G1 X3'], {}, { firstLine: 998 });
    expect(doc.pages[0].rows.map((r) => r.line)).toEqual([998, 999, 1000]);
    expect(doc.gutter).toBe(4);
    expect(rowText(doc, 0, 0).startsWith(' 998 ')).toBe(true);
  });

  it('are not block numbers: a program without N words has them, one with N words has the lines', () => {
    const doc = build(['N100 G0 X0', 'N200 G1 X5']);
    expect(doc.pages[0].rows.map((r) => r.line)).toEqual([1, 2]);
  });

  it('can be switched off: no gutter, and the text uses the full width', () => {
    const on = build(['G1 X1']);
    const off = build(['G1 X1'], { lineNumbers: false });
    expect(off.gutter).toBe(0);
    expect(rowText(off, 0, 0)).toBe('G1 X1');
    expect(rowText(on, 0, 0)).toBe('1 G1 X1');
    const { cols } = pageGeometry(9);
    const wide = 'X'.repeat(cols);
    expect(build([wide], { lineNumbers: false }).pages[0].rows).toHaveLength(1);
    expect(build([wide], { lineNumbers: true }).pages[0].rows).toHaveLength(2);
  });

  it('leaves the gutter of a continuation row blank', () => {
    expect(gutterText(null, 3)).toBe('    ');
    expect(gutterText(7, 3)).toBe('  7 ');
    expect(gutterText(7, 0)).toBe('');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------------------------------------------

describe('colours', () => {
  const spans = (doc: PrintDocument): { text: string; color?: string }[] => doc.pages.flatMap((p) => p.rows).flatMap((r) => r.spans);

  it('print with the light palette, whatever theme is on', () => {
    const doc = build(['N10 G1 X10. F100. M3 (note)']);
    const colors = new Map(spans(doc).map((s) => [s.text, s.color]));
    expect(colors.get('N10')).toBe(ROLE_COLORS.light.blockNumber);
    expect(colors.get('G1')).toBe(ROLE_COLORS.light.gcode);
    expect(colors.get('X10.')).toBe(ROLE_COLORS.light.axis);
    expect(colors.get('F100.')).toBe(ROLE_COLORS.light.feed);
    expect(colors.get('M3')).toBe(ROLE_COLORS.light.mcode);
    expect(colors.get('(note)')).toBe(ROLE_COLORS.light.comment);
    for (const dark of Object.values(ROLE_COLORS.dark)) expect(spans(doc).map((s) => s.color)).not.toContain(dark);
  });

  it('are written as nothing at all for Black', () => {
    const doc = build(['N10 G1 X10. F100. M3 (note)'], { colors: 'black' });
    expect(spans(doc)).toEqual([{ text: 'N10 G1 X10. F100. M3 (note)' }]);
    expect(printDocumentHtml(doc)).not.toMatch(/class="c\d/);
  });

  it('every role of the light palette clears 3:1 against white, so the palette prints in colour', () => {
    const palette = printPalette(CP);
    for (const role of ROLES) {
      expect(contrastOnWhite(ROLE_COLORS.light[role]), role).toBeGreaterThanOrEqual(3);
      expect(palette[role], role).toBe(ROLE_COLORS.light[role].toLowerCase());
    }
  });

  it('never prints a pale profile colour: the profile palette ignores it (P4h, §6.10 rule 6), so the role keeps its built-in colour', () => {
    const pale = { ...FANUC.profile, colors: { light: { gcode: '#ffee88', axis: '#0a5f8f' } } };
    const cp = { ...CP, profile: pale } as CompiledProfile;
    expect(contrastOnWhite('#ffee88')).toBeLessThan(3);
    expect(printPalette(cp).gcode).toBe(ROLE_COLORS.light.gcode.toLowerCase());
    expect(printPalette(cp).axis).toBe('#0a5f8f');
    const doc = buildPrintDocument(source(['G1 X10.']), OPTIONS, cp);
    const row = doc.pages[0].rows[0].spans;
    expect(row.find((s) => s.text === 'G1')?.color).toBe(ROLE_COLORS.light.gcode.toLowerCase());
    expect(row.find((s) => s.text === 'X10.')?.color).toBe('#0a5f8f');
  });

  it('takes the profile’s colors.light overrides, never colors.dark', () => {
    const own = { ...FANUC.profile, colors: { light: { gcode: '#112233' }, dark: { gcode: '#aabbcc' } } };
    const palette = printPalette({ ...CP, profile: own } as CompiledProfile);
    expect(palette.gcode).toBe('#112233');
  });

  // CODE-9: the print follows the theme's colours, which hold the user's (built-in < user < profile).
  it('prints the user’s light role colours, and a colour of the profile still wins over them', () => {
    const user: ProfileColors = { light: { gcode: '#1a237e', axis: '#0a5f8f' }, dark: { feed: '#ffcc00' } };
    expect(contrastOnWhite('#1a237e') >= 3).toBe(true);
    const palette = printPalette(CP, user);
    expect(palette.gcode).toBe('#1a237e');
    expect(palette.axis).toBe('#0a5f8f');
    expect(palette.feed).toBe(ROLE_COLORS.light.feed.toLowerCase());
    const own = { ...FANUC.profile, colors: { light: { gcode: '#112233' } } };
    const layered = printPalette({ ...CP, profile: own } as CompiledProfile, user);
    expect(layered.gcode).toBe('#112233');
    expect(layered.axis).toBe('#0a5f8f');
    // A user colour the theme would refuse (too pale) is ignored here as well.
    expect(printPalette(CP, { light: { gcode: '#ffee88' } }).gcode).toBe(ROLE_COLORS.light.gcode.toLowerCase());
  });

  it('the page model and the service hand the user’s colours to the page', () => {
    const user: ProfileColors = { light: { gcode: '#1a237e' } };
    const doc = buildPrintDocument(source(['G1 X10.']), OPTIONS, CP, undefined, user);
    expect(doc.pages[0].rows[0].spans.find((s) => s.text === 'G1')?.color).toBe('#1a237e');
    const r = rig();
    r.roleColors = user;
    const built = r.service.build(OPTIONS)!;
    expect(built.pages[0].rows.flatMap((row) => row.spans).some((s) => s.color === '#1a237e')).toBe(true);
  });

  it('measures contrast the WCAG way and reads anything that is not a colour as no contrast', () => {
    expect(contrastOnWhite('#000000')).toBeCloseTo(21, 0);
    expect(contrastOnWhite('#ffffff')).toBeCloseTo(1, 5);
    expect(contrastOnWhite('red')).toBe(1);
  });
});

describe('the colours of the page model are the editor grammar’s (Monarch simulation, six dialects)', () => {
  // The print reads the tokenizer's tokens and maps them to the roles the generated grammar gives; the corpus of the
  // grammar tests (token goldens, the NC fixtures of each dialect, the lines written for the M12.5 shapes) is held to
  // the Monarch simulation character by character. Where the grammar knowingly paints differently, WAIVERS says so
  // with the reason, as `differential.test.ts` does; a waiver that no line uses any more fails, so the list cannot go
  // stale.
  interface Waiver {
    dialects: readonly string[];
    reason: string;
    applies(line: string, grammar: string, mine: string): boolean;
  }
  const WAIVERS: Waiver[] = [
    {
      dialects: ['fanuc-gcode', 'fanuc-lathe'],
      reason: 'the format of a DPRNT/BPRNT is painted as address words by the grammar, one expression to the tokenizer',
      applies: (line) => /[BD]PRNT\[/.test(line),
    },
    {
      dialects: ['heidenhain-klartext'],
      reason: 'a decimal comma behind an address the database lacks reads as a number to the grammar, as the address alone does not',
      applies: (line, grammar) => grammar === 'number' && /\bSP[ABC]\+\d+,\d/.test(line),
    },
    {
      dialects: ['okuma-osp'],
      reason: 'a T word of the wrong length is left uncoloured by the grammar, for the linter to report',
      applies: (_line, grammar, mine) => grammar === '' && mine === 'tool',
    },
    {
      dialects: ['okuma-osp'],
      reason: 'an argument `A1=2` of a CALL block reads as a number to the grammar, as an assignment to the tokenizer',
      applies: (line) => /\bCALL\b.*\bA1=\d/.test(line),
    },
    {
      dialects: ['sinumerik', 'sinumerik-mill'],
      reason: 'L<n> is the call of a subprogram by number to the grammar (rule 10), an L word to the tokenizer',
      applies: (line, grammar) => grammar === 'keyword' && /\bL\d+/.test(line),
    },
    {
      dialects: ['sinumerik', 'sinumerik-mill'],
      reason: 'an indexed word in a comparison (X[1]==5) is names and brackets to the grammar',
      applies: (line) => /\[\d+\]==/.test(line),
    },
  ];

  const results = new Map(
    DIALECTS.map((dialect) => {
      let characters = 0;
      const unwaived: string[] = [];
      const waived = new Map<string, number>();
      for (const { line, prev } of corpus(dialect)) {
        if (prev?.continuation === true) continue;
        const roles = rolePerChar(dialect.grammar, line);
        const mine = lineRoles(line, dialect.cp, undefined, dialect.db).roles;
        for (let i = 0; i < line.length; i++) {
          if (/\s/.test(line[i])) continue;
          characters += 1;
          const grammar = roles[i] ?? '';
          if (grammar === (mine[i] ?? '')) continue;
          const waiver = WAIVERS.find((w) => w.dialects.includes(dialect.id) && w.applies(line, grammar, mine[i] ?? ''));
          if (waiver !== undefined) waived.set(waiver.reason, (waived.get(waiver.reason) ?? 0) + 1);
          else if (unwaived.length < 15) unwaived.push(`${JSON.stringify(line)} at ${i} (${line[i]}): grammar ${grammar || 'none'}, print ${mine[i] ?? 'none'}`);
        }
      }
      return [dialect.id, { characters, unwaived, waived }] as const;
    }),
  );

  it.each(DIALECTS.map((d) => d.id))('%s: the role of every visible character is the grammar’s', (id) => {
    const { characters, unwaived, waived } = results.get(id)!;
    expect(characters).toBeGreaterThan(500);
    expect(unwaived).toEqual([]);
    // what is waived stays a rounding error of the corpus, never a shape that is painted differently on purpose
    expect([...waived.values()].reduce((a, b) => a + b, 0) / characters).toBeLessThan(0.003);
  });

  it('keeps no waiver that no line needs any more', () => {
    const used = new Set([...results.values()].flatMap((r) => [...r.waived.keys()]));
    expect(WAIVERS.map((w) => w.reason).filter((reason) => !used.has(reason))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------------------------------------------

describe('document text is never HTML', () => {
  const EVIL = ['(<script>alert(1)</script> & "q" \'s\')', 'G1 X10. ( </style><img src=x onerror=alert(1)> )', '(</section></main>)'];

  it('escapes the five characters', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });

  it('writes an NC comment with <script> into the exported page as text', () => {
    const html = printDocumentHtml(build(EVIL, {}, { name: '<b>name</b>.nc' }));
    const black = printDocumentHtml(build(EVIL, { colors: 'black' }, { name: '<b>name</b>.nc' }));
    expect(black).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot; &#39;s&#39;');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror=alert(1)>');
    expect(html).toContain('&lt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('<title>&lt;b&gt;name&lt;/b&gt;.nc</title>');
    // the page structure is still the model's: three pages' worth of sections is one section here
    expect(html.match(/<section /g)).toHaveLength(1);
    expect(html.match(/<\/main>/g)).toHaveLength(1);
  });

  it('draws the same text in the print view as text', () => {
    for (const colors of ['color', 'black'] as const) {
      const { body } = render(PrintView, { props: { doc: build(EVIL, { colors }, { name: '<b>name</b>.nc' }) } });
      expect(body, colors).not.toContain('<script');
      expect(body, colors).not.toContain('<img');
      expect(body, colors).not.toContain('<b>');
      // Svelte escapes `<` and `&` in text, which is all HTML needs there
      expect(body, colors).toContain('&lt;b>name&lt;/b>.nc');
    }
    const { body } = render(PrintView, { props: { doc: build(EVIL, { colors: 'black' }) } });
    expect(body).toContain('&lt;script>alert(1)&lt;/script>');
  });

  it('keeps a colour out of the page unless it is #rrggbb', () => {
    const doc = build(['G1']);
    doc.pages[0].rows[0].spans[0].color = 'red;}</style><script>x</script>';
    const html = printDocumentHtml(doc);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('red;}');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The HTML file
// ---------------------------------------------------------------------------------------------------------------

describe('printDocumentHtml', () => {
  const lines = ['%', 'O1000 (SHAFT)', ...numbered(150), 'M30', '%'];
  const doc = build(lines);
  const html = printDocumentHtml(doc);

  it('is one self-contained page: a doctype, inline styles, no script, nothing fetched', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<style>');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\b(src|href)=/i);
    expect(html).not.toMatch(/url\(|@import|<link|<iframe|<img/i);
  });

  it('has the same pages as the model, each with its header and every row', () => {
    expect(html.match(/<section class="page"/g)).toHaveLength(doc.pages.length);
    expect(doc.pages.length).toBeGreaterThan(2);
    for (const page of doc.pages) expect(html).toContain(`Page ${page.number} of ${doc.pages.length}`);
    expect(html.match(/<div class="r"/g)).toHaveLength(doc.pages.reduce((n, p) => n + p.rows.length, 0));
    expect(html).toContain('shaft.nc');
    expect(html).toContain(AT.toLocaleDateString());
  });

  it('carries the text, the line numbers and the colours', () => {
    expect(html).toContain('<div class="r" data-line="2"><span class="n">  2 </span>');
    expect(html).toContain('(SHAFT)');
    expect(html).toMatch(/\.c\d\{color:#[0-9a-f]{6}\}/);
    expect(html).toContain('@page{margin:15mm}');
  });

  it('is smaller than inline styles on every token would make it: one class per colour', () => {
    expect(html).not.toMatch(/<span style=/);
  });

  it('names the export file after the document', () => {
    expect([exportFileName('shaft.nc'), exportFileName('Untitled-3'), exportFileName('a.b.nc'), exportFileName('.hidden')]).toEqual([
      'shaft.html',
      'Untitled-3.html',
      'a.b.html',
      '.hidden.html',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The view's markup
// ---------------------------------------------------------------------------------------------------------------

describe('PrintView', () => {
  const doc = build(['N10 G1 X10.', '(a note)', 'M30'], {}, { firstLine: 5 });
  const { body } = render(PrintView, { props: { doc } });

  it('carries the test ids and data attributes of plan §6.11', () => {
    expect(body).toContain('data-testid="print-view"');
    expect(body).toContain('data-pages="1"');
    expect(body).toContain('data-colors="color"');
    expect(body).toContain('data-scope="document"');
    expect(body).toContain('data-line-numbers="1"');
    expect(body).toContain('data-testid="print-page" data-page="1"');
    expect([...body.matchAll(/data-testid="print-line" data-line="(\d*)"/g)].map((m) => m[1])).toEqual(['5', '6', '7']);
  });

  it('says Black, no line numbers and a selection in its data attributes', () => {
    const other = build(['G1'], { colors: 'black', lineNumbers: false, scope: 'selection' });
    const out = render(PrintView, { props: { doc: other } }).body;
    expect(out).toContain('data-colors="black"');
    expect(out).toContain('data-scope="selection"');
    expect(out).toContain('data-line-numbers="0"');
    expect(out).not.toContain('print-num');
  });

  it('marks a continuation row with an empty data-line', () => {
    const { cols } = pageGeometry(9);
    const out = render(PrintView, { props: { doc: build(['X'.repeat(cols * 2)]) } }).body;
    expect(out).toMatch(/data-line="1"/);
    expect(out).toMatch(/data-line=""/);
  });

  it('draws a row as its gutter and its text with nothing in between (the row is `white-space: pre`)', () => {
    const row = body.match(/<div class="print-row[^"]*"[^>]*>(.*?)<\/div>/s)![1];
    const text = row.replace(/<[^>]+>/g, '').replace(/<!---->/g, '');
    expect(text).toBe('5 N10 G1 X10.');
  });

  it('prints the header on every page with the page count of the model', () => {
    const many = build(numbered(pageGeometry(9).rows + 3));
    const out = render(PrintView, { props: { doc: many } }).body;
    expect(out).toContain('data-pages="2"');
    expect(out).toContain('Page 1 of 2');
    expect(out).toContain('Page 2 of 2');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The service: limits, lifecycle, export
// ---------------------------------------------------------------------------------------------------------------

interface Rig {
  service: ReturnType<typeof createPrintService>;
  docs: ReturnType<typeof createDocumentStore>;
  docId: DocId;
  lines: string[];
  selection: { startLine: number; endLine: number; empty: boolean; crossesJunction?: true } | null;
  lineCount: number | null;
  shown: { text: string; error: boolean }[];
  mounted: { doc: PrintDocument; destroyed: boolean }[];
  printed: number;
  afterprint: (() => void)[];
  saved: { path: string; bytes: Uint8Array }[];
  saveAnswer: string | null;
  saveRequests: { defaultPath: string; filters?: { name: string; extensions: string[] }[] }[];
  writeFails: boolean;
  /** Makes the machine lookup throw this. */
  machineError: Error | null;
  /** Holds the layout wait of the print open until it resolves. */
  gate: Promise<void> | null;
  /** The user's role colours the print is handed. */
  roleColors: ProfileColors;
}

function newDoc(over: Partial<NewDocMeta> = {}): NewDocMeta {
  return {
    path: '/nc/shaft.nc',
    untitledIndex: null,
    profileId: 'fanuc-gcode',
    encoding: { encoding: 'utf-8', hasBom: false },
    eol: 'lf',
    eolMixedOnLoad: false,
    nul: { leader: 0, trailer: 0, stripped: 0 },
    textDirty: false,
    metaDirty: false,
    disk: null,
    external: 'none',
    readOnly: false,
    readOnlyReason: null,
    ...over,
  } as NewDocMeta;
}

function rig(over: { lines?: string[]; docs?: Partial<NewDocMeta> } = {}): Rig {
  const docs = createDocumentStore({ caseInsensitivePaths: false });
  const docId = docs.add(newDoc(over.docs));
  const r: Rig = {
    docs,
    docId,
    lines: over.lines ?? ['O1000', 'G0 X0', 'M30'],
    selection: null,
    lineCount: null,
    shown: [],
    mounted: [],
    printed: 0,
    afterprint: [],
    saved: [],
    saveAnswer: '/out/shaft.html',
    saveRequests: [],
    writeFails: false,
    machineError: null,
    gate: null,
    roleColors: {},
    service: undefined as never,
  };
  const deps: PrintDeps = {
    docs,
    editor: {
      getLineCount: () => r.lineCount ?? r.lines.length,
      getLines: (_id, first, last) => r.lines.slice(first - 1, last),
      selectionLines: () => r.selection,
    },
    machines: {
      effective: () => {
        if (r.machineError !== null) throw r.machineError;
        return { cp: CP } as never;
      },
    },
    roleColors: () => r.roleColors,
    status: { show: (text, o) => void r.shown.push({ text, error: o?.error === true }) },
    dialogs: {
      saveFile: async (o) => {
        r.saveRequests.push(o);
        return r.saveAnswer;
      },
    },
    writeFile: async (path, bytes) => {
      if (r.writeFails) throw new Error('disk full');
      r.saved.push({ path, bytes });
    },
    mountView: (doc): PrintViewHandle => {
      const entry = { doc, destroyed: false };
      r.mounted.push(entry);
      return {
        destroy() {
          entry.destroyed = true;
        },
      };
    },
    onAfterPrint: (listener) => {
      r.afterprint.push(listener);
      return () => {
        r.afterprint = r.afterprint.filter((l) => l !== listener);
      };
    },
    settled: async () => {
      await r.gate;
    },
    printWindow: () => void (r.printed += 1),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    now: () => AT,
    t,
  };
  r.service = createPrintService(deps);
  return r;
}

const live = (r: Rig): number => r.mounted.filter((m) => !m.destroyed).length;
const failure = (outcome: PrintOutcome): { reason: string; lines?: number } => {
  expect(outcome.ok).toBe(false);
  return outcome as { reason: string; lines?: number };
};

describe('the service: what is printed', () => {
  it('builds the page model of the active document for the harness', () => {
    const r = rig();
    const doc = r.service.build(OPTIONS)!;
    expect(doc.title).toBe('shaft.nc');
    expect(doc.pages[0].rows.map((row) => row.line)).toEqual([1, 2, 3]);
  });

  it('builds the selected lines with the document’s line numbers', () => {
    const r = rig({ lines: numbered(40) });
    r.selection = { startLine: 12, endLine: 14, empty: false };
    const doc = r.service.build({ ...OPTIONS, scope: 'selection' })!;
    expect(doc.pages[0].rows.map((row) => row.line)).toEqual([12, 13, 14]);
    expect(doc.options.scope).toBe('selection');
  });

  it('answers noSelection, in words, when the scope is the selection and nothing is selected', async () => {
    const r = rig();
    r.selection = { startLine: 1, endLine: 1, empty: true };
    expect(failure(await r.service.print({ ...OPTIONS, scope: 'selection' })).reason).toBe('noSelection');
    expect(r.shown.at(-1)).toEqual({ text: t('print.noSelection'), error: true });
    expect(r.mounted).toEqual([]);
    expect(r.service.build({ ...OPTIONS, scope: 'selection' })).toBeNull();
  });

  it('refuses a selection that runs over the lines of another channel', async () => {
    const r = rig();
    r.selection = { startLine: 1, endLine: 3, empty: false, crossesJunction: true };
    expect(failure(await r.service.print({ ...OPTIONS, scope: 'selection' })).reason).toBe('crossesJunction');
    expect(r.shown.at(-1)?.text).toBe(t('channelPanes.selectionCrosses'));
  });

  it('answers noDocument without a document', async () => {
    const r = rig();
    r.docs.remove(r.docId);
    expect(r.service.build(OPTIONS)).toBeNull();
    expect(failure(await r.service.print(OPTIONS)).reason).toBe('noDocument');
    expect(failure(await r.service.exportHtml(OPTIONS)).reason).toBe('noDocument');
    expect(r.shown.at(-1)).toEqual({ text: t('print.noDocument'), error: true });
  });
});

describe('the limits', () => {
  it('prints 20,000 lines and not one more: tooLong says how many and what to do', async () => {
    const r = rig({ lines: ['G0'] });
    r.lineCount = PRINT_MAX_LINES + 1;
    const outcome = failure(await r.service.print(OPTIONS));
    expect(outcome).toEqual({ ok: false, reason: 'tooLong', lines: 20_001 });
    expect(r.shown.at(-1)).toEqual({
      text: 'This program has 20,001 lines; printing is limited to 20,000. Print a selection.',
      error: true,
    });
    expect(r.mounted).toEqual([]);
    expect(r.service.build(OPTIONS)).toBeNull();
  });

  it('counts the selection, not the document, against the limit', async () => {
    const r = rig({ lines: numbered(30) });
    r.lineCount = 50_000;
    r.selection = { startLine: 1, endLine: 30, empty: false };
    expect((await r.service.print({ ...OPTIONS, scope: 'selection' })).ok).toBe(true);
  });

  it('prints exactly 20,000 lines', async () => {
    const r = rig({ lines: numbered(PRINT_MAX_LINES) });
    const outcome = await r.service.print(OPTIONS);
    expect(outcome.ok).toBe(true);
    expect(r.mounted[0].doc.pages.length).toBe(Math.ceil(PRINT_MAX_LINES / pageGeometry(9).rows));
  });

  it('lets the export take up to 100,000 lines and refuses more in its own words', async () => {
    const big = rig({ lines: numbered(PRINT_MAX_LINES + 1) });
    expect((await big.service.exportHtml(OPTIONS)).ok).toBe(true);
    const huge = rig({ lines: ['G0'] });
    huge.lineCount = EXPORT_MAX_LINES + 1;
    expect(failure(await huge.service.exportHtml(OPTIONS))).toEqual({ ok: false, reason: 'tooLong', lines: 100_001 });
    expect(huge.shown.at(-1)?.text).toBe('This program has 100,001 lines; the export is limited to 100,000. Export a selection.');
    expect(huge.saveRequests).toEqual([]);
  });
});

describe('the row budget (a long line is many rows)', () => {
  it('refuses one line of 3,000,000 characters without mounting a view or building a page', async () => {
    const r = rig({ lines: ['G1 X' + '1'.repeat(3_000_000)] });
    const outcome = failure(await r.service.print(OPTIONS));
    expect(outcome).toEqual({ ok: false, reason: 'tooLong', lines: 1 });
    expect(r.shown.at(-1)).toEqual({ text: t('print.tooManyPages', { pages: '345' }), error: true });
    expect(r.shown.at(-1)?.text).toMatch(/more than 345 pages.*Print a selection/);
    expect(r.mounted).toEqual([]);
    expect(r.service.build(OPTIONS)).toBeNull();
  });

  it('refuses the export in its own words, and writes nothing, at 100,000 rows', async () => {
    const r = rig({ lines: ['X'.repeat(12_000_000)] });
    expect(failure(await r.service.exportHtml(OPTIONS)).reason).toBe('tooLong');
    expect(r.shown.at(-1)?.text).toBe(t('print.tooManyPagesExport', { pages: Math.ceil(EXPORT_MAX_LINES / pageGeometry(9).rows).toLocaleString('en-US') }));
    expect(r.saveRequests).toEqual([]);
    // The same line is within the export's budget when it is short enough: 2,000,000 characters are ~22,000 rows.
    const ok = rig({ lines: ['X'.repeat(2_000_000)] });
    expect((await ok.service.exportHtml(OPTIONS)).ok).toBe(true);
  });

  it('lets many wide lines through while their rows fit', async () => {
    const r = rig({ lines: Array.from({ length: 200 }, () => 'G1 X' + '1'.repeat(400)) });
    expect((await r.service.print(OPTIONS)).ok).toBe(true);
  });

  it('counts rows like the page model: tabs, wide characters, trailing blanks, empty lines', () => {
    const cols = 10;
    expect(exceedsRowBudget(['', 'a', ''], cols, 3)).toBe(false);
    expect(exceedsRowBudget(['', 'a', '', ''], cols, 3)).toBe(true);
    expect(exceedsRowBudget(['x'.repeat(10)], cols, 1)).toBe(false);
    expect(exceedsRowBudget(['x'.repeat(11)], cols, 1)).toBe(true);
    expect(exceedsRowBudget(['x' + ' '.repeat(5000) + '\t'], cols, 1)).toBe(false); // trailing blanks are not printed
    expect(exceedsRowBudget(['\tx\tx\tx'], 4, 4)).toBe(false); // tab stops of 4: 13 cells, 4 rows of 4
    expect(exceedsRowBudget(['\tx\tx\tx'], 4, 3)).toBe(true);
    expect(exceedsRowBudget(['全'.repeat(6)], cols, 1)).toBe(true); // 12 cells
    expect(exceedsRowBudget(['全'.repeat(5)], cols, 1)).toBe(false);
    // The count agrees with the rows buildPrintDocument cuts, for lines that do not hit a straddle.
    const lines = ['G1 X' + '1'.repeat(300), '\tN10 G0', 'x'.repeat(95), ''];
    const doc = build(lines, { lineNumbers: false });
    const rows = doc.pages.reduce((n, p) => n + p.rows.length, 0);
    expect(exceedsRowBudget(lines, doc.cols, rows)).toBe(false);
    expect(exceedsRowBudget(lines, doc.cols, rows - 1)).toBe(true);
  });
});

describe('the print view’s life', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is mounted, then the print function is called, then the outcome says the pages', async () => {
    const r = rig();
    const outcome = await r.service.print(OPTIONS);
    expect(outcome).toEqual({ ok: true, pages: 1 });
    expect(r.mounted).toHaveLength(1);
    expect(r.printed).toBe(1);
    expect(live(r)).toBe(1); // macOS's print operation does not block: the view stays until afterprint
  });

  it('is removed on afterprint, and the listener with it', async () => {
    const r = rig();
    await r.service.print(OPTIONS);
    expect(r.afterprint).toHaveLength(1);
    r.afterprint[0]();
    expect(live(r)).toBe(0);
    expect(r.afterprint).toHaveLength(0);
    r.afterprint.forEach((l) => l());
    expect(r.mounted[0].destroyed).toBe(true);
  });

  it('is removed at the next print, which mounts its own', async () => {
    const r = rig();
    await r.service.print(OPTIONS);
    await r.service.print({ ...OPTIONS, colors: 'black' });
    expect(r.mounted.map((m) => m.destroyed)).toEqual([true, false]);
    expect(r.mounted[1].doc.options.colors).toBe('black');
    expect(r.afterprint).toHaveLength(1);
  });

  it('is removed when the document it was built for closes, and not when another one does', async () => {
    const r = rig();
    const other = r.docs.add(newDoc({ path: '/nc/other.nc' }), { activate: false });
    await r.service.print(OPTIONS);
    r.docs.remove(other);
    expect(live(r)).toBe(1);
    r.docs.remove(r.docId);
    expect(live(r)).toBe(0);
  });

  it('is removed after five minutes at the latest, not before', async () => {
    const r = rig();
    await r.service.print(OPTIONS);
    vi.advanceTimersByTime(PRINT_VIEW_TIMEOUT_MS - 1);
    expect(live(r)).toBe(1);
    vi.advanceTimersByTime(1);
    expect(live(r)).toBe(0);
    expect(r.afterprint).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no timer behind when afterprint comes first', async () => {
    const r = rig();
    await r.service.print(OPTIONS);
    r.afterprint[0]();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('calls the function that setPrintFunction installed, never the window’s', async () => {
    const r = rig();
    const calls: string[] = [];
    r.service.setPrintFunction(() => void calls.push('harness'));
    await r.service.print(OPTIONS);
    expect(calls).toEqual(['harness']);
    expect(r.printed).toBe(0);
  });

  it('is removed and says so when the print call throws', async () => {
    const r = rig();
    r.service.setPrintFunction(() => {
      throw new Error('no dialog');
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(failure(await r.service.print(OPTIONS)).reason).toBe('failed');
    spy.mockRestore();
    expect(live(r)).toBe(0);
    expect(r.shown.at(-1)).toEqual({ text: t('print.failed'), error: true });
  });

  it('is removed and says so when the native print operation answers with a failure (macOS: a promise)', async () => {
    const r = rig();
    r.service.setPrintFunction(() => Promise.reject(new Error('not allowed')));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(failure(await r.service.print(OPTIONS)).reason).toBe('failed');
    spy.mockRestore();
    expect(live(r)).toBe(0);
  });

  it('says only that the dialog failed when the machine cannot be read, and keeps the reason in the console', async () => {
    const r = rig();
    r.machineError = new Error('/Users/someone/machines.json: unexpected token');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(failure(await r.service.print(OPTIONS)).reason).toBe('failed');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect(r.shown.at(-1)).toEqual({ text: t('print.failed'), error: true });
    expect(r.mounted).toEqual([]);
  });

  it('does not print a view whose document closed while the pages were laid out', async () => {
    const r = rig();
    let release: () => void = () => undefined;
    r.gate = new Promise<void>((resolve) => (release = resolve));
    const pending = r.service.print(OPTIONS);
    expect(live(r)).toBe(1);
    r.docs.remove(r.docId);
    expect(live(r)).toBe(0);
    release();
    expect(failure(await pending).reason).toBe('cancelled');
    expect(r.printed).toBe(0);
  });
});

describe('Export as HTML', () => {
  it('writes the page through the save dialog with an .html filter and says how many pages', async () => {
    const r = rig({ lines: numbered(150) });
    const outcome = await r.service.exportHtml(OPTIONS);
    const pages = Math.ceil(150 / pageGeometry(9).rows);
    expect(outcome).toEqual({ ok: true, pages });
    expect(r.saveRequests).toEqual([{ defaultPath: 'shaft.html', filters: [{ name: t('print.htmlFilter'), extensions: ['html', 'htm'] }] }]);
    expect(r.saved).toHaveLength(1);
    expect(r.saved[0].path).toBe('/out/shaft.html');
    const html = new TextDecoder().decode(r.saved[0].bytes);
    expect(html).toBe(printDocumentHtml(r.service.build(OPTIONS)!));
    expect(html.match(/<section /g)).toHaveLength(pages);
    expect(r.shown.at(-1)).toEqual({ text: `Saved ${pages} pages to shaft.html.`, error: false });
  });

  it('says "1 page" for one page, and names the file by its last path segment on Windows too', async () => {
    const r = rig();
    r.saveAnswer = 'C:\\out\\shaft.html';
    await r.service.exportHtml(OPTIONS);
    expect(r.shown.at(-1)?.text).toBe('Saved 1 page to shaft.html.');
  });

  it('is silent and writes nothing when the dialog is cancelled', async () => {
    const r = rig();
    r.saveAnswer = null;
    expect(failure(await r.service.exportHtml(OPTIONS)).reason).toBe('cancelled');
    expect(r.saved).toEqual([]);
    expect(r.shown).toEqual([]);
  });

  it('reports a write that failed, with the reason as detail', async () => {
    const r = rig();
    r.writeFails = true;
    expect(failure(await r.service.exportHtml(OPTIONS)).reason).toBe('failed');
    expect(r.shown.at(-1)).toEqual({ text: t('print.exportFailed'), error: true });
  });

  it('exports an untitled program under its title', async () => {
    const r = rig({ docs: { path: null, untitledIndex: 3 } });
    await r.service.exportHtml(OPTIONS);
    expect(r.saveRequests[0].defaultPath).toBe('Untitled-3.html');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------------------------------------------

describe('the print form', () => {
  it('has the four fields of the contract', () => {
    expect(printFields(true).map((f) => f.id)).toEqual(['scope', 'colors', 'lineNumbers', 'fontPt']);
    const font = printFields(false).find((f) => f.id === 'fontPt')!;
    expect([font.type, font.min, font.max, font.default]).toEqual(['integer', 7, 14, 9]);
    expect(printFields(false).find((f) => f.id === 'lineNumbers')!.default).toBe(true);
  });

  it('offers the selection only when there is one, and then makes it the default', () => {
    const without = printFields(false).find((f) => f.id === 'scope')!;
    const withSel = printFields(true).find((f) => f.id === 'scope')!;
    expect(without.choices!.map((c) => c.value)).toEqual(['document']);
    expect(withSel.choices!.map((c) => c.value)).toEqual(['document', 'selection']);
    expect(withSel.default).toBe('selection');
  });

  it('reads the answer into options, never a selection that is not there', () => {
    expect(optionsFromValues({ scope: 'selection', colors: 'black', lineNumbers: false, fontPt: 12 }, true)).toEqual({
      scope: 'selection',
      colors: 'black',
      lineNumbers: false,
      fontPt: 12,
    });
    expect(optionsFromValues({ scope: 'selection', colors: 'x', fontPt: 99 }, false)).toEqual({
      scope: 'document',
      colors: 'color',
      lineNumbers: true,
      fontPt: 14,
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The one permission
// ---------------------------------------------------------------------------------------------------------------

describe('the capability', () => {
  const capability = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../../src-tauri/capabilities/default.json', import.meta.url)), 'utf8'),
  ) as { permissions: string[]; windows: string[] };

  it('grants the print dialog, the one permission window.print() needs on macOS', () => {
    expect(capability.permissions).toContain('core:webview:allow-print');
  });

  it('grants nothing else of the webview or the window beyond what the app already had', () => {
    expect(capability.permissions.filter((p) => p.startsWith('core:webview:')).sort()).toEqual([
      'core:webview:allow-internal-toggle-devtools',
      'core:webview:allow-print',
    ]);
    expect(capability.permissions.filter((p) => !p.startsWith('core:webview:')).sort()).toEqual([
      'core:event:allow-listen',
      'core:event:allow-unlisten',
      'core:window:allow-destroy',
      'core:window:allow-set-theme',
      'core:window:allow-set-title',
      'dialog:allow-message',
      'dialog:allow-open',
      'dialog:allow-save',
      'fs:allow-read-file',
      'fs:allow-write-file',
    ]);
    expect(capability.windows).toEqual(['main']);
  });
});
