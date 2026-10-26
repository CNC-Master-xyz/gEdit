// The programs of the P4c runtime scenarios (`tests/fixtures/p4c/harness/`) and the expected texts of `p4-comfort`
// (`tests/runtime/scenarios/p4-comfort.js`). The scenario cannot run in `npm test`; this holds every text and number it
// expects to what the core says for the same input, so a changed fixture or a changed rule fails here, in seconds, and not
// in the hosted runtime run an hour later. The scenario's constants are imported, not copied: what it expects is what is
// tested here.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPrintDocument, pageGeometry, printDocumentHtml, type PrintOptions } from '$lib/app/print';
import { blockBaseLine, decideAutoNumber, type AutoNumberAnswer } from '$lib/core/nc/autoNumber';
import { decideTyping } from '$lib/core/nc/autoSpace';
import { insertReplacement, planInsert, type InsertPlan } from '$lib/core/nc/insertFile';
import type { KeyInput } from '$lib/core/nc/typing';
import { resolveBlockRange } from '$lib/core/nav/blockRange';
import type { CompiledProfile } from '$lib/core/profiles/types';
import { KT_APPEND, KT_APPEND_RENUMBERED, KT_ENTER_4, KT_ENTER_TAIL, KT_INSERT, KT_INSERT_RENUMBERED, SPACE_CASES, TWO_PROGRAMS, TYPED_M3_LINE } from '../runtime/scenarios/p4-comfort.js';
import { FIXTURES_DIR } from './helpers/fixtures';
import { cpOf } from './helpers/profiles';

const DIR = join(FIXTURES_DIR, 'p4c', 'harness');
const read = (name: string): string => readFileSync(join(DIR, name), 'utf8');
/** The editor's lines of a text: the empty last line the final line break makes is one of them. */
const editorLines = (text: string): string[] => text.split('\n');
/** The lines of a file as Insert File reads them (no empty last line). */
const fileLines = (text: string): string[] => text.replace(/\n$/, '').split('\n');

const FANUC = cpOf('fanuc-gcode');
const KLARTEXT = cpOf('heidenhain-klartext');

const FANUC_TEXT = read('fanuc-edit.nc');
const KLARTEXT_TEXT = read('klartext-edit.h');
const FANUC_LINES = editorLines(FANUC_TEXT);
const KLARTEXT_LINES = editorLines(KLARTEXT_TEXT);

describe('the P4c harness fixture programs', () => {
  const names = [
    'fanuc-edit.nc',
    'klartext-edit.h',
    'insert-fanuc.nc',
    'insert-fanuc-frame.nc',
    'insert-klartext.h',
    'insert-klartext-second.h',
    'insert-klartext-end.h',
    'insert-klartext-tilde.h',
    'print-demo.nc',
  ];
  const readme = readFileSync(join(DIR, 'README.md'), 'utf8');

  it.each(names)('%s is written for gEdit, LF, ends with a line break and is listed', (name) => {
    const text = read(name);
    expect(text).not.toContain('\r');
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toMatch(/WRITTEN FOR GEDIT/);
    expect(readme).toContain(`\`${name}\``);
  });

  it('the editor lines the README and the scenario count: 11 and 11 (10 lines and the empty last one), 151 for the print demo', () => {
    expect(FANUC_LINES).toHaveLength(11);
    expect(KLARTEXT_LINES).toHaveLength(11);
    expect(editorLines(read('print-demo.nc'))).toHaveLength(151);
  });
});

/** The text a typed string gives, key by key, with auto-closing of `(` the way the editor does it. */
function typeThrough(typed: string, cp: CompiledProfile, options: { uppercase: boolean; autoSpace: boolean }): string {
  let before = '';
  let after = '';
  for (const ch of typed) {
    const key: KeyInput = { key: ch };
    const answer = decideTyping(key, [{ before, after, previousLine: null }], cp, options);
    if (answer.kind === 'perCursor') throw new Error('one cursor cannot disagree with itself');
    if (ch === ')' && after.startsWith(')')) {
      before += ')';
      after = after.slice(1);
      continue;
    }
    before += answer.kind === 'type' ? answer.text : ch;
    if (ch === '(') after = `)${after}`;
  }
  return before + after;
}

describe('p4-comfort section A: the typed texts of Auto Space', () => {
  it.each(SPACE_CASES.map((c) => [`${c.profile}: ${c.typed}`, c] as const))('%s', (_name, c) => {
    expect(typeThrough(c.typed, cpOf(c.profile), { uppercase: true, autoSpace: true })).toBe(c.want);
  });

  it('with Auto Space off the same keys type G1X5. as one word (upper-case typing alone)', () => {
    expect(typeThrough('g1x5.', FANUC, { uppercase: true, autoSpace: false })).toBe('G1X5.');
  });

  it('X typed behind G1 is G1 X (the keystroke of the undo check)', () => {
    expect(decideTyping({ key: 'x' }, [{ before: 'G1', after: '', previousLine: null }], FANUC, { uppercase: true, autoSpace: true })).toEqual({ kind: 'type', text: ' X' });
  });

  it('after the number of a Fanuc block, g1x6. with Auto Space off is G1X6. (the independence check of section B)', () => {
    expect(typeThrough('g1x6.', FANUC, { uppercase: true, autoSpace: false })).toBe('G1X6.');
  });
});

/** Enter at the end of `line`: the lines after the edit the way `contrib/typing.ts` makes it, or the answer that is no number. */
function pressEnter(lines: readonly string[], line: number, cp: CompiledProfile): string[] | AutoNumberAnswer {
  const read = (n: number): string => lines[n - 1] ?? '';
  const answer = decideAutoNumber({ line, column: read(line).length + 1, lineCount: lines.length, read }, cp);
  if (answer.kind !== 'number') return answer;
  const out = [...lines];
  for (const shift of answer.shifts) {
    const text = out[shift.line - 1];
    out[shift.line - 1] = text.slice(0, shift.startColumn - 1) + shift.text + text.slice(shift.endColumn - 1);
  }
  const indent = /^[ \t]*/.exec(read(blockBaseLine(read, line, cp) ?? line))?.[0] ?? '';
  out.splice(line, 0, indent + answer.text);
  return out;
}

describe('p4-comfort sections B and C: Enter with the automatic block number', () => {
  const after = (lines: readonly string[], n: number, extra: string[]) => [...lines.slice(0, n), ...extra, ...lines.slice(n)];

  it('Fanuc: N115 after N110 (a comment line below), N122 after N120, N140 after N130 M30', () => {
    expect(pressEnter(FANUC_LINES, 4, FANUC)).toEqual(after(FANUC_LINES, 4, ['N115 ']));
    expect(pressEnter(FANUC_LINES, 6, FANUC)).toEqual(after(FANUC_LINES, 6, ['N122 ']));
    expect(pressEnter(FANUC_LINES, 9, FANUC)).toEqual(after(FANUC_LINES, 9, ['N140 ']));
  });

  it('Fanuc: S1200 M3 typed at the end of N110, then Enter: N115 (the CODE-1 check; the core does not see the suggestion list)', () => {
    const typed = [...FANUC_LINES.slice(0, 3), TYPED_M3_LINE, ...FANUC_LINES.slice(4)];
    expect(typeThrough(' s1200 m3', FANUC, { uppercase: true, autoSpace: false })).toBe(' S1200 M3');
    expect(FANUC_LINES[3] + ' S1200 M3').toBe(TYPED_M3_LINE);
    expect(pressEnter(typed, 4, FANUC)).toEqual(after(typed, 4, ['N115 ']));
  });

  it('Fanuc: no gap between N125 and N126; a comment line, the program header and the middle of a line are plain', () => {
    expect(pressEnter(FANUC_LINES, 7, FANUC)).toEqual({ kind: 'none', reason: 'noGap', between: [125, 126] });
    expect(pressEnter(FANUC_LINES, 5, FANUC)).toEqual({ kind: 'plain' });
    expect(pressEnter(FANUC_LINES, 2, FANUC)).toEqual({ kind: 'plain' });
    expect(decideAutoNumber({ line: 6, column: 5, lineCount: FANUC_LINES.length, read: (n) => FANUC_LINES[n - 1] ?? '' }, FANUC)).toEqual({ kind: 'plain' });
  });

  it('Klartext: the new block 4 and the blocks below, as in the scenario', () => {
    expect(pressEnter(KLARTEXT_LINES, 4, KLARTEXT)).toEqual(KT_ENTER_4);
    expect(KT_ENTER_4.join('\n').endsWith('\n')).toBe(true);
  });

  it('Klartext: the line that ends with ~ is plain, Enter on the continuation line numbers after the whole block', () => {
    expect(pressEnter(KLARTEXT_LINES, 6, KLARTEXT)).toEqual({ kind: 'plain' });
    expect(pressEnter(KLARTEXT_LINES, 7, KLARTEXT)).toEqual(KT_ENTER_TAIL);
  });

  it('Klartext: the number is typed at column 3 (a number, a blank), and Fanuc at column 6', () => {
    const k = decideAutoNumber({ line: 4, column: 21, lineCount: KLARTEXT_LINES.length, read: (n) => KLARTEXT_LINES[n - 1] ?? '' }, KLARTEXT);
    expect(k.kind === 'number' ? k.text : null).toBe('4 ');
    const f = decideAutoNumber({ line: 4, column: 11, lineCount: FANUC_LINES.length, read: (n) => FANUC_LINES[n - 1] ?? '' }, FANUC);
    expect(f.kind === 'number' ? f.text : null).toBe('N115 ');
  });
});

describe('p4-comfort section F: Insert File and Append File', () => {
  const insertFanuc = fileLines(read('insert-fanuc.nc'));
  const insertKt = fileLines(read('insert-klartext.h'));

  const plan = (doc: readonly string[], lines: readonly string[], where: 'cursor' | 'end', line: number, column: number, cp: CompiledProfile): InsertPlan =>
    planInsert({ where, line, column, lineCount: doc.length, read: (n) => doc[n - 1] ?? '', lines }, cp);
  const apply = (doc: readonly string[], p: Extract<InsertPlan, { ok: true }>): string[] => {
    const { startLine, endLine, newLines } = insertReplacement(p, (n) => doc[n - 1] ?? '', doc.length);
    return [...doc.slice(0, startLine - 1), ...newLines, ...doc.slice(endLine)];
  };
  const ok = (p: InsertPlan): Extract<InsertPlan, { ok: true }> => {
    if (!p.ok) throw new Error(`refused: ${p.reason}`);
    return p;
  };

  it('Fanuc, cursor in column 1 of line 7: before it, lines 7 to 10, nothing renumbered, no warning', () => {
    const p = ok(plan(FANUC_LINES, insertFanuc, 'cursor', 7, 1, FANUC));
    expect(p.beforeLine).toBe(7);
    expect(p.lines).toEqual(insertFanuc);
    expect(p.warnings).toEqual([]);
    expect(p.numberEdits).toEqual([]);
    expect(apply(FANUC_LINES, p)).toEqual([...FANUC_LINES.slice(0, 6), ...insertFanuc, ...FANUC_LINES.slice(6)]);
    expect(insertFanuc).toHaveLength(4);
  });

  it('Fanuc, cursor inside line 7: after it', () => {
    const p = ok(plan(FANUC_LINES, insertFanuc, 'cursor', 7, 4, FANUC));
    expect(p.beforeLine).toBe(8);
    expect(apply(FANUC_LINES, p)).toEqual([...FANUC_LINES.slice(0, 7), ...insertFanuc, ...FANUC_LINES.slice(7)]);
  });

  it('Fanuc, cursor at line 1, column 1: below the leading % and O1001 (lines 3 to 6), no warning', () => {
    const p = ok(plan(FANUC_LINES, insertFanuc, 'cursor', 1, 1, FANUC));
    expect(p.beforeLine).toBe(3);
    expect(p.warnings).toEqual([]);
    expect(apply(FANUC_LINES, p)).toEqual([...FANUC_LINES.slice(0, 2), ...insertFanuc, ...FANUC_LINES.slice(2)]);
  });

  it('Fanuc, cursor inside the closing % (line 10): after it, lines 11 to 14, and the % ends the tape (no program-end warning too)', () => {
    const p = ok(plan(FANUC_LINES, insertFanuc, 'cursor', 10, 2, FANUC));
    expect(p.beforeLine).toBe(11);
    expect(p.warnings).toEqual([{ kind: 'afterTapeEnd', line: 10 }]);
    expect(apply(FANUC_LINES, p)).toEqual([...fileLines(FANUC_TEXT), ...insertFanuc, '']);
  });

  it('Fanuc Append: before the closing % (lines 10 to 13), and the program ends at line 9', () => {
    const p = ok(plan(FANUC_LINES, insertFanuc, 'end', 1, 1, FANUC));
    expect(p.beforeLine).toBe(10);
    expect(p.warnings).toEqual([{ kind: 'afterProgramEnd', line: 9 }]);
    expect(apply(FANUC_LINES, p)).toEqual([...fileLines(FANUC_TEXT).slice(0, 9), ...insertFanuc, '%', '']);
  });

  it('Fanuc: a file % / O2000 / comment / % at line 6: the two % lines left out, O2000 warned as a program start where blocks follow', () => {
    const frame = fileLines(read('insert-fanuc-frame.nc'));
    expect(frame).toEqual(['%', 'O2000', expect.stringMatching(/WRITTEN FOR GEDIT/), '%']);
    const p = ok(plan(FANUC_LINES, frame, 'cursor', 6, 1, FANUC));
    expect(p.beforeLine).toBe(6);
    expect(p.tapeMarksLeftOut).toBe(2);
    expect(p.warnings).toEqual([{ kind: 'programFrame', end: false, line: 6, text: 'O2000' }]);
    expect(apply(FANUC_LINES, p)).toEqual([...FANUC_LINES.slice(0, 5), ...frame.slice(1, -1), ...FANUC_LINES.slice(5)]);
  });

  it('a file of two programs: the insert at line 8 of the second does not warn, and the line that was 8 is 12 afterwards', () => {
    const doc = editorLines(TWO_PROGRAMS);
    const p = ok(plan(doc, insertFanuc, 'cursor', 8, 1, FANUC));
    expect(p.warnings).toEqual([]);
    const out = apply(doc, p);
    expect(out[7]).toBe(insertFanuc[0]);
    expect(out[11]).toBe('N20 G0 X2');
  });

  it('Klartext: the file’s blocks are 4 to 6 and the blocks below follow; eight blocks renumbered', () => {
    const p = ok(plan(KLARTEXT_LINES, insertKt, 'cursor', 5, 1, KLARTEXT));
    expect(apply(KLARTEXT_LINES, p)).toEqual(KT_INSERT);
    const changed = p.lines.reduce((count, text, i) => (text === insertKt[i] ? count : count + 1), 0);
    expect(p.numberEdits.length + changed).toBe(KT_INSERT_RENUMBERED);
    expect(p.beforeLine).toBe(5);
    expect(p.lines).toHaveLength(3);
  });

  it('Klartext Append: before END PGM, the file’s blocks are 8 to 10 and END PGM is 11; four blocks renumbered', () => {
    const p = ok(plan(KLARTEXT_LINES, insertKt, 'end', 1, 1, KLARTEXT));
    expect(p.beforeLine).toBe(10);
    expect(p.renumbered).toBe(KT_APPEND_RENUMBERED);
    expect(p.warnings).toEqual([]);
    expect(apply(KLARTEXT_LINES, p)).toEqual(KT_APPEND);
  });

  it('Klartext: a file with END PGM is refused at its line 3, a file whose last line ends with ~ at its line 2', () => {
    const ended = fileLines(read('insert-klartext-end.h'));
    expect(plan(KLARTEXT_LINES, ended, 'cursor', 5, 1, KLARTEXT)).toEqual({ ok: false, reason: 'programEndInFile', line: 3 });
    expect(ended[2]).toBe('22 END PGM OTHER MM');
    const open = fileLines(read('insert-klartext-tilde.h'));
    expect(plan(KLARTEXT_LINES, open, 'cursor', 5, 1, KLARTEXT)).toEqual({ ok: false, reason: 'continuesBlock', first: false, line: 2 });
    expect(open[open.length - 1].endsWith('~')).toBe(true);
  });

  it('Klartext: a second program start is refused at the file’s line 1, an empty file too', () => {
    expect(plan(KLARTEXT_LINES, fileLines(read('insert-klartext-second.h')), 'cursor', 5, 1, KLARTEXT)).toEqual({ ok: false, reason: 'secondProgramStart', line: 1 });
    expect(plan(KLARTEXT_LINES, [''], 'end', 1, 1, KLARTEXT)).toEqual({ ok: false, reason: 'empty' });
    expect(read('insert-klartext-second.h').split('\n')[0]).toBe('0 BEGIN PGM OTHER MM');
  });
});

describe('p4-comfort section E: block ranges', () => {
  const resolve = (doc: readonly string[], cp: CompiledProfile, kind: 'line' | 'block', from: string, to: string) =>
    resolveBlockRange((n) => doc[n - 1] ?? '', doc.length, cp, { kind, from, to });

  it('Fanuc: lines 3 to 6; 120 and N126 are lines 6 to 8; the refusals the scenario looks for', () => {
    expect(resolve(FANUC_LINES, FANUC, 'line', '3', '6')).toEqual({ ok: true, startLine: 3, endLine: 6, blocks: null });
    expect(resolve(FANUC_LINES, FANUC, 'block', '120', 'N126')).toEqual({ ok: true, startLine: 6, endLine: 8, blocks: { from: 120, to: 126 } });
    expect(resolve(FANUC_LINES, FANUC, 'line', 'abc', '5')).toMatchObject({ ok: false, reason: 'notNumber', field: 'from' });
    expect(resolve(FANUC_LINES, FANUC, 'line', '3', '999')).toMatchObject({ ok: false, reason: 'outsideProgram', field: 'to' });
    expect(resolve(FANUC_LINES, FANUC, 'line', '6', '3')).toMatchObject({ ok: false, reason: 'reversed' });
    expect(resolve(FANUC_LINES, FANUC, 'block', 'N999', 'N126')).toMatchObject({ ok: false, reason: 'missingBlock', field: 'from' });
    expect(resolve(FANUC_LINES, FANUC, 'block', 'N126', 'N120')).toMatchObject({ ok: false, reason: 'reversed' });
  });

  it('two programs: N10 is a duplicate, in the field that holds it', () => {
    expect(resolve(editorLines(TWO_PROGRAMS), FANUC, 'block', 'N10', 'N20')).toMatchObject({ ok: false, reason: 'duplicateBlock', field: 'from', lines: [3, 7], total: 2 });
  });

  it('Klartext: block 5 runs over lines 6 and 7', () => {
    expect(resolve(KLARTEXT_LINES, KLARTEXT, 'block', '5', '5')).toEqual({ ok: true, startLine: 6, endLine: 7, blocks: { from: 5, to: 5 } });
    expect(resolve(KLARTEXT_LINES, KLARTEXT, 'line', '3', '4')).toEqual({ ok: true, startLine: 3, endLine: 4, blocks: null });
  });
});

describe('p4-comfort sections G and H: the pages of the print demo', () => {
  const lines = editorLines(read('print-demo.nc'));
  const at = new Date(2026, 9, 20, 9, 0);
  const options = (over: Partial<PrintOptions> = {}): PrintOptions => ({ scope: 'document', colors: 'color', lineNumbers: true, fontPt: 9, ...over });
  const build = (over: Partial<PrintOptions> = {}) => buildPrintDocument({ name: 'print-demo.nc', firstLine: 1, lines, at }, options(over), FANUC);
  const rowsOf = (doc: ReturnType<typeof build>) => doc.pages.flatMap((p) => p.rows);

  it('at 9 points a page holds 58 rows, so 152 rows are three pages; one continuation row, the long comment on line 4', () => {
    const doc = build();
    expect(pageGeometry(9).rows).toBe(58);
    expect(doc.pages).toHaveLength(3);
    expect(rowsOf(doc)).toHaveLength(152);
    expect(rowsOf(doc).filter((r) => r.line === null)).toHaveLength(1);
    expect(rowsOf(doc)[4].line).toBeNull();
    expect(doc.pages[0].rows).toHaveLength(58);
    expect(rowsOf(doc).filter((r) => r.line !== null).map((r) => r.line)).toEqual(lines.map((_, i) => i + 1));
    expect(doc.gutter).toBe(3);
  });

  it('every row put together gives the line again (the scenario puts them together by the data-line attribute)', () => {
    const doc = build();
    const rebuilt: string[] = [];
    for (const row of rowsOf(doc)) {
      const text = row.spans.map((s) => s.text).join('');
      if (row.line !== null) rebuilt.push(text);
      else rebuilt[rebuilt.length - 1] += text;
    }
    expect(rebuilt).toEqual(lines);
  });

  it('colour: some span carries a colour; black: none does', () => {
    expect(rowsOf(build()).some((r) => r.spans.some((s) => s.color !== undefined))).toBe(true);
    expect(rowsOf(build({ colors: 'black', lineNumbers: false, fontPt: 12 })).every((r) => r.spans.every((s) => s.color === undefined))).toBe(true);
  });

  it('12 points without numbers: 43 rows a page and four pages, more than at 9', () => {
    const doc = build({ colors: 'black', lineNumbers: false, fontPt: 12 });
    expect(pageGeometry(12).rows).toBe(43);
    expect(doc.pages).toHaveLength(4);
    expect(doc.gutter).toBe(0);
  });

  it('a selection of lines 10 to 15 keeps the document’s numbers, in a gutter of 2 digits and a blank', () => {
    const doc = buildPrintDocument({ name: 'print-demo.nc', firstLine: 10, lines: lines.slice(9, 15), at }, options(), FANUC);
    expect(doc.pages).toHaveLength(1);
    expect(rowsOf(doc).map((r) => r.line)).toEqual([10, 11, 12, 13, 14, 15]);
    expect(doc.gutter).toBe(2);
  });

  it('the exported page writes the comment’s characters as text, once per page section, with the page label', () => {
    const doc = build();
    const html = printDocumentHtml(doc);
    expect(html).toContain('(CHECK &lt;B&gt; &amp; &quot;Q&quot; &#39;S&#39;)');
    expect(html).not.toContain('<B>');
    expect((html.match(/<section class="page"/g) ?? []).length).toBe(3);
    expect((html.match(/data-line="\d+"/g) ?? []).length).toBe(151);
    expect(html).toContain('Page 1 of 3');
    expect(html).not.toMatch(/<script/i);
  });

  it('the page header names the document', () => {
    expect(build().title).toBe('print-demo.nc');
  });
});
