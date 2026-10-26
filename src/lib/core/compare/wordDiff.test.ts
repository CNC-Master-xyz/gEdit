// Word marks in the comparison (Phase 4 plan AD-52, §6.7 rule 17; X30).
//
// `wordDiff` is checked on lines as each built-in dialect reads them; `wordMarkPairs` on the
// blocks of a diff, and on the normalized text that review mode shows (the marks are computed
// on it, AD-52). The drawing is `monaco/diff.test.ts`.

import { describe, expect, it } from 'vitest';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { normalizeLines } from './index';
import { cpOf as compareCp, type ProfileKey } from '../../../../tests/unit/helpers/compareProfiles';
import { cpOf } from '../../../../tests/unit/helpers/profiles';
import {
  WORD_DIFF_MAX_WORDS,
  wordDiff,
  wordMarkPairs,
  wordRuns,
  type LineBlock,
  type PairSide,
  type WordSpan,
} from './wordDiff';
import type { CompareOptions } from './types';

const cp = cpOf('fanuc-gcode');
const tokens = (line: string, key?: ProfileKey) => tokenizeLine(line, key ? compareCp(key) : cp).tokens;

/** The marked words of each side as text. */
function marked(
  a: string,
  b: string,
  o: { ignoreCase?: boolean; key?: ProfileKey } = {},
): { original: string[]; modified: string[] } {
  const marks = wordDiff(tokens(a, o.key), tokens(b, o.key), o);
  const text = (line: string, spans: WordSpan[]) => spans.map((s) => line.slice(s.start, s.end));
  return { original: text(a, marks.original), modified: text(b, marks.modified) };
}

describe('word marks (§6.7 rule 17)', () => {
  it('marks the whole word that differs, on both sides (F1200 → F1000)', () => {
    expect(marked('N10 G1 X10. F1200', 'N10 G1 X10. F1000')).toEqual({ original: ['F1200'], modified: ['F1000'] });
  });

  it('gives the offsets of the word in its own line (UTF-16, end exclusive)', () => {
    const marks = wordDiff(tokens('G1 X10. F1200'), tokens('G1   X10.  F1000'));
    expect(marks.original).toEqual([{ start: 8, end: 13 }]);
    expect(marks.modified).toEqual([{ start: 11, end: 16 }]);
  });

  it('marks nothing on equal lines, and nothing for a change of spaces', () => {
    expect(marked('G1 X10. Y5.', 'G1 X10. Y5.')).toEqual({ original: [], modified: [] });
    expect(marked('G1  X10.', 'G1 X10.')).toEqual({ original: [], modified: [] });
    expect(marked('', '')).toEqual({ original: [], modified: [] });
  });

  it('marks an added word on its side only, and a removed one on its side only', () => {
    expect(marked('G1 X10.', 'G1 X10. F500')).toEqual({ original: [], modified: ['F500'] });
    expect(marked('G1 X10. F500', 'G1 X10.')).toEqual({ original: ['F500'], modified: [] });
    expect(marked('', 'G1 X10.')).toEqual({ original: [], modified: ['G1', 'X10.'] });
  });

  it('marks each of several changed words, and keeps the unchanged ones between them unmarked', () => {
    expect(marked('G1 X10. Y20. Z-5. F300', 'G1 X11. Y20. Z-6. F300')).toEqual({
      original: ['X10.', 'Z-5.'],
      modified: ['X11.', 'Z-6.'],
    });
  });

  it('does not mark a word that only moved', () => {
    expect(marked('G1 X10. Y20.', 'G1 Y20. X10.')).toEqual({ original: [], modified: [] });
    expect(marked('G1 X10. Y20. Z5.', 'Z5. G1 X10. Y20.')).toEqual({ original: [], modified: [] });
  });

  it('marks a word that moved and a word that changed next to it', () => {
    expect(marked('G1 X10. Y20. F300', 'G1 Y20. X10. F400')).toEqual({ original: ['F300'], modified: ['F400'] });
  });

  it('marks swapped operands: only an address word outside an expression counts as moved (review NC-9)', () => {
    expect(marked('Q1 = Q2 - Q3', 'Q1 = Q3 - Q2', { key: 'klartext' })).toEqual({ original: ['Q2', '-'], modified: ['-', 'Q2'] });
    expect(marked('#1=#2-#3', '#1=#3-#2', { key: 'fanuc' })).toEqual({ original: ['#2', '-'], modified: ['-', '#2'] });
    expect(marked('R1=R2-R3', 'R1=R3-R2', { key: 'sinumerik' })).toEqual({ original: ['R2', '-'], modified: ['-', 'R2'] });
    expect(marked('IF R1>R2 GOTOF L1', 'IF R2>R1 GOTOF L1', { key: 'sinumerik' })).toEqual({ original: ['R1', '>'], modified: ['>', 'R1'] });
    // Address words that only moved are still not marked.
    expect(marked('X10 Y20', 'Y20 X10')).toEqual({ original: [], modified: [] });
  });

  it('cancels a moved word once per occurrence: a second copy that is not matched stays marked', () => {
    // Z3 moved; the original has X1 twice and the modified once, so one X1 is removed.
    expect(marked('X1 Y2 X1 Z3', 'Z3 Y2 X1')).toEqual({ original: ['X1'], modified: [] });
    // Both X1 moved behind Y2 (and Y2 stays): two moved words, nothing marked.
    expect(marked('X1 X1 Y2', 'Y2 X1 X1')).toEqual({ original: [], modified: [] });
  });

  it('aligns by a longest common subsequence, so one inserted word does not shift the rest', () => {
    expect(marked('G1 X1. Y2. Z3. F4', 'G1 X1. A9 Y2. Z3. F4')).toEqual({ original: [], modified: ['A9'] });
    expect(marked('A B C D E F', 'A C D X E F')).toEqual({ original: ['B'], modified: ['X'] });
  });

  it('marks a changed comment as one word', () => {
    expect(marked('G0 X0. (ROUGH)', 'G0 X0. (FINISH)')).toEqual({ original: ['(ROUGH)'], modified: ['(FINISH)'] });
  });

  it('marks a changed expression and a changed variable as one word each', () => {
    expect(marked('#101=[#102+1.5]', '#101=[#102+2.5]')).toEqual({ original: ['[#102+1.5]'], modified: ['[#102+2.5]'] });
    expect(marked('#101=5', '#102=5')).toEqual({ original: ['#101'], modified: ['#102'] });
  });

  it('reads letters without case when asked, except in a string', () => {
    expect(marked('g1 x10.', 'G1 X10.', { ignoreCase: true })).toEqual({ original: [], modified: [] });
    expect(marked('g1 x10.', 'G1 X10.')).toEqual({ original: ['g1', 'x10.'], modified: ['G1', 'X10.'] });
    // A string keeps its case: the tool name differs, the letter before it does not count.
    expect(marked('g1 T="Drill"', 'G1 t="Drill"', { ignoreCase: true, key: 'sinumerik' })).toEqual({
      original: [],
      modified: [],
    });
    expect(marked('G1 T="Drill"', 'G1 T="drill"', { ignoreCase: true, key: 'sinumerik' })).toEqual({
      original: ['T="Drill"'],
      modified: ['T="drill"'],
    });
  });

  describe('the cap', () => {
    const long = (n: number) => Array.from({ length: n }, (_, i) => `X${i}.`).join(' ');

    it('gives no word marks for a pair over the word cap', () => {
      const over = long(WORD_DIFF_MAX_WORDS + 1);
      expect(marked(over, `${over} F1`)).toEqual({ original: [], modified: [] });
      expect(marked(`${long(10)} F1`, `${over} F1`)).toEqual({ original: [], modified: [] });
    });

    it('marks a pair of exactly the cap, from the cap of either side', () => {
      const exact = long(WORD_DIFF_MAX_WORDS);
      expect(marked(exact, exact.replace('X250.', 'Y250.'))).toEqual({ original: ['X250.'], modified: ['Y250.'] });
      expect(marked(exact.slice(0, exact.lastIndexOf(' ')), exact).modified).toEqual([`X${WORD_DIFF_MAX_WORDS - 1}.`]);
    });

    it('stays correct at the cap when every word differs', () => {
      const a = long(WORD_DIFF_MAX_WORDS);
      const b = a.replace(/X/g, 'Y');
      const marks = wordDiff(tokens(a), tokens(b));
      expect(marks.original).toHaveLength(WORD_DIFF_MAX_WORDS);
      expect(marks.modified).toHaveLength(WORD_DIFF_MAX_WORDS);
    });
  });
});

describe('the words each dialect reads', () => {
  it('Klartext: an assignment is a variable, an equals sign and a value word; the value is marked', () => {
    expect(marked('Q203=+0 ;SURFACE', 'Q203=-5 ;SURFACE', { key: 'klartext' })).toEqual({
      original: ['+0'],
      modified: ['-5'],
    });
    expect(marked('Q203=+0', 'Q204=+0', { key: 'klartext' })).toEqual({ original: ['Q203'], modified: ['Q204'] });
  });

  it('Klartext: a cycle line marks its changed value, a keyword stays one word, the comment is one word', () => {
    expect(marked('CYCL DEF 200 BOHREN', 'CYCL DEF 201 BOHREN', { key: 'klartext' })).toEqual({
      original: ['200'],
      modified: ['201'],
    });
    expect(marked('TOOL CALL 5 Z S3000', 'TOOL CALL 6 Z S3000', { key: 'klartext' })).toEqual({
      original: ['5'],
      modified: ['6'],
    });
    expect(marked('L X+10 Y+20 FMAX ;A B', 'L X+10 Y+20 FMAX ;A C', { key: 'klartext' })).toEqual({
      original: [';A B'],
      modified: [';A C'],
    });
  });

  it('Sinumerik: X=AC(5) is one word, and so is a call with all its arguments', () => {
    expect(marked('G1 X=AC(5) Y=IC(-3) F300', 'G1 X=AC(7) Y=IC(-3) F300', { key: 'sinumerik' })).toEqual({
      original: ['X=AC(5)'],
      modified: ['X=AC(7)'],
    });
    expect(marked('CYCLE81(10,0,2,-12)', 'CYCLE81(10,0,2,-15)', { key: 'sinumerik' })).toEqual({
      original: ['CYCLE81(10,0,2,-12)'],
      modified: ['CYCLE81(10,0,2,-15)'],
    });
    expect(marked('N10 G1 X10 ;one', 'N10 G1 X10 ;two', { key: 'sinumerik' })).toEqual({
      original: [';one'],
      modified: [';two'],
    });
  });

  it('marks the changed parts inside a long word too: a call, an expression, a comment (review NC-8)', () => {
    /** The whole marked words and the parts marked inside them, as text. */
    const withParts = (a: string, b: string, o: { ignoreCase?: boolean; key?: ProfileKey } = {}) => {
      const marks = wordDiff(tokens(a, o.key), tokens(b, o.key), o);
      const text = (line: string, spans: WordSpan[] | undefined) => (spans ?? []).map((sp) => line.slice(sp.start, sp.end));
      return {
        original: text(a, marks.original),
        modified: text(b, marks.modified),
        parts: { original: text(a, marks.parts?.original), modified: text(b, marks.parts?.modified) },
      };
    };
    // A changed argument of a cycle call: the call stays marked whole, the argument is marked inside it.
    expect(
      withParts('CYCLE800(1,"TABLE",0,57,0,0,0,-30,0,0,0,0,0,-1,100,1)', 'CYCLE800(1,"TABLE",0,57,0,0,0,-45,0,0,0,0,0,-1,100,1)', { key: 'sinumerik' }),
    ).toEqual({
      original: ['CYCLE800(1,"TABLE",0,57,0,0,0,-30,0,0,0,0,0,-1,100,1)'],
      modified: ['CYCLE800(1,"TABLE",0,57,0,0,0,-45,0,0,0,0,0,-1,100,1)'],
      parts: { original: ['30'], modified: ['45'] },
    });
    expect(withParts('CYCLE81(10,0,2,-12)', 'CYCLE81(10,0,2,-15)', { key: 'sinumerik' }).parts).toEqual({ original: ['12'], modified: ['15'] });
    // A sign that comes or goes is part of the change, joined to the number next to it.
    expect(withParts('CYCLE81(10,0,2,12)', 'CYCLE81(10,0,2,-15)', { key: 'sinumerik' }).parts).toEqual({ original: ['12'], modified: ['-15'] });
    // A string argument is one part, its case kept.
    expect(withParts('CYCLE800(1,"TABLE",0)', 'CYCLE800(1,"HEAD",0)', { key: 'sinumerik' }).parts).toEqual({ original: ['"TABLE"'], modified: ['"HEAD"'] });
    expect(withParts('G1 X=AC(5) Y=IC(-3) F300', 'G1 X=AC(7) Y=IC(-3) F300', { key: 'sinumerik' }).parts).toEqual({ original: ['5'], modified: ['7'] });
    // An expression in brackets; a part that grows is marked whole on both sides.
    const expression = withParts('G1 X[#1+#2] F100', 'G1 X[#1+#3] F100', { key: 'fanuc' });
    expect(expression.original).toEqual(['X[#1+#2]']);
    expect(expression.parts).toEqual({ original: ['#2'], modified: ['#3'] });
    expect(withParts('G1 X[#1+#2] F100', 'G1 X[#1+#22] F100', { key: 'fanuc' }).parts).toEqual({ original: ['#2'], modified: ['#22'] });
    expect(withParts('G1 X[#12+#2] F100', 'G1 X[#2+#2] F100', { key: 'fanuc' }).parts).toEqual({ original: ['#12'], modified: ['#2'] });
    // An argument added at the end: the comma and the number are new, nothing on the other side is marked.
    expect(withParts('CYCLE81(10,0,2)', 'CYCLE81(10,0,2,-15)', { key: 'sinumerik' }).parts).toEqual({ original: [], modified: [',-15'] });
    // A comment.
    expect(withParts('N10 G1 X10.5 F200 (FACE MILL D50)', 'N10 G1 X10.5 F200 (FACE MILL D63)', { key: 'okuma' }).parts).toEqual({
      original: ['D50'],
      modified: ['D63'],
    });
    expect(withParts('L X+10 Y+20 FMAX ;A B', 'L X+10 Y+20 FMAX ;A C', { key: 'klartext' }).parts).toEqual({ original: ['B'], modified: ['C'] });
  });

  it('marks no parts in a plain word, in two different calls, or where several words changed together (review NC-8)', () => {
    const parts = (a: string, b: string, key?: ProfileKey) => wordDiff(tokens(a, key), tokens(b, key)).parts;
    // A plain address word is marked whole, as before.
    expect(parts('N10 G1 X10. F1200', 'N10 G1 X10. F1000')).toBeUndefined();
    expect(parts('G1 X10.5', 'G1 X10.25')).toBeUndefined();
    // Another cycle: the head differs, so the whole call is the change.
    expect(parts('CYCLE81(10,0,2,-12)', 'CYCLE82(10,0,2,-12)', 'sinumerik')).toBeUndefined();
    // Two calls that changed next to each other face no single word.
    expect(parts('CYCLE81(1,2,3) CYCLE82(1,2,3)', 'CYCLE81(1,2,4) CYCLE82(1,2,5) X1', 'sinumerik')).toBeUndefined();
    // Equal lines and a moved word have no marks at all, so no parts either.
    expect(parts('CYCLE81(10,0,2,-12)', 'CYCLE81(10,0,2,-12)', 'sinumerik')).toBeUndefined();
  });

  it('gives the parts as offsets of the line, inside their word (review NC-8)', () => {
    const marks = wordDiff(tokens('N5 CYCLE81(10,0,2,-12)', 'sinumerik'), tokens('N5   CYCLE81(10,0,2,-15)', 'sinumerik'));
    expect(marks.original).toEqual([{ start: 3, end: 22 }]);
    expect(marks.parts).toEqual({ original: [{ start: 19, end: 21 }], modified: [{ start: 21, end: 23 }] });
  });

  it('folds the case of the parts outside strings with ignoreCase (review NC-8)', () => {
    const marks = wordDiff(tokens('CYCLE800(1,"Table",0,a)', 'sinumerik'), tokens('cycle800(1,"TABLE",0,A)', 'sinumerik'), { ignoreCase: true });
    const line = 'CYCLE800(1,"Table",0,a)';
    expect((marks.parts?.original ?? []).map((sp) => line.slice(sp.start, sp.end))).toEqual(['"Table"']);
  });

  it('Okuma: a $ line, a $ at the end of a block, a sequence name and a comment', () => {
    expect(marked('$PART.MIN%', '$PART.MAX%', { key: 'okuma' })).toEqual({ original: ['$PART.MIN%'], modified: ['$PART.MAX%'] });
    expect(marked('$ G90 G0 X10', '$ G91 G0 X10', { key: 'okuma' })).toEqual({ original: ['G90'], modified: ['G91'] });
    expect(marked('G0 X10 $', 'G0 X12 $', { key: 'okuma' })).toEqual({ original: ['X10'], modified: ['X12'] });
    expect(marked('NLAP1 G0 X0', 'NLAP2 G0 X0', { key: 'okuma' })).toEqual({ original: ['NLAP1'], modified: ['NLAP2'] });
    expect(marked('N10 G1 X10.5 F200 (COMMENT)', 'N10 G1 X10.5 F200 (OTHER)', { key: 'okuma' })).toEqual({
      original: ['(COMMENT)'],
      modified: ['(OTHER)'],
    });
  });

  it('Fanuc lathe and a program number: the O word is one word', () => {
    expect(marked('O1234 (PROGRAM)', 'O1235 (PROGRAM)', { key: 'lathe' })).toEqual({ original: ['O1234'], modified: ['O1235'] });
  });
});

// ---------------------------------------------------------------------------
// The lines of a diff
// ---------------------------------------------------------------------------

const side = (lines: string[], key: ProfileKey = 'fanuc'): PairSide => ({
  cp: compareCp(key),
  line: (n) => lines[n - 1],
});
const block = (o: [number, number], m: [number, number]): LineBlock => ({
  originalStartLineNumber: o[0],
  originalEndLineNumber: o[1],
  modifiedStartLineNumber: m[0],
  modifiedEndLineNumber: m[1],
});

describe('wordMarkPairs (the pairing of a change)', () => {
  it('pairs the lines of a change in order and yields the pairs that have marks', () => {
    const a = ['G0 X0.', 'G1 X1. F100', 'G1 X2. F100', 'M30'];
    const b = ['G0 X0.', 'G1 X1. F200', 'G1 X2. F100', 'M30'];
    const pairs = [...wordMarkPairs([block([2, 3], [2, 3])], side(a), side(b))];
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ originalLine: 2, modifiedLine: 2 });
    expect(pairs[0].marks).toEqual({ original: [{ start: 7, end: 11 }], modified: [{ start: 7, end: 11 }] });
  });

  it('pairs two changes that sit at different lines on the two sides', () => {
    const a = ['A', 'B', 'G1 X1.', 'C'];
    const b = ['A', 'G1 X9.', 'C'];
    const pairs = [...wordMarkPairs([block([2, 3], [2, 2])], side(a), side(b))];
    // Line 2 of the original (B) against line 2 of the modified: the third original line is
    // an extra line and gets no marks.
    expect(pairs.map((p) => [p.originalLine, p.modifiedLine])).toEqual([[2, 2]]);
  });

  it('gives a whole added or removed block no marks, however many lines it has', () => {
    const a = ['A', 'B'];
    const b = ['A', 'X1.', 'X2.', 'B'];
    // Added: the original side is empty (end line 0, start the line before).
    const added = block([1, 0], [2, 3]);
    expect([...wordMarkPairs([added], side(a), side(b))]).toEqual([]);
    // Removed: the modified side is empty.
    const removed = block([2, 3], [1, 0]);
    expect([...wordMarkPairs([removed], side(b), side(a))]).toEqual([]);
  });

  it('gives a pair of lines over the cap no marks, and goes on with the next', () => {
    const long = Array.from({ length: WORD_DIFF_MAX_WORDS + 1 }, (_, i) => `X${i}.`).join(' ');
    const a = [long, 'G1 F1'];
    const b = [`${long} F9`, 'G1 F2'];
    const pairs = [...wordMarkPairs([block([1, 2], [1, 2])], side(a), side(b))];
    expect(pairs.map((p) => p.originalLine)).toEqual([2]);
  });

  it('is lazy: a caller that stops reads no further', () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `G1 X${i}.`);
    const other = lines.map((l) => `${l} F1`);
    let reads = 0;
    const counting: PairSide = { cp: compareCp('fanuc'), line: (n) => (reads++, other[n - 1]) };
    const run = wordMarkPairs([block([1, 1000], [1, 1000])], side(lines), counting);
    run.next();
    expect(reads).toBe(1);
  });

  it('reads a Klartext line that continues the one above as a continuation, not as a new block', () => {
    const a = ['CYCL DEF 200 BOHREN ~', 'Q200=2 ;ABST ~', 'Q201=-20'];
    const b = ['CYCL DEF 200 BOHREN ~', 'Q200=2 ;ABST ~', 'Q201=-25'];
    // The change starts at the third line, the tail of a continued block.
    const [pair] = [...wordMarkPairs([block([3, 3], [3, 3])], side(a, 'klartext'), side(b, 'klartext'))];
    expect(pair.marks.original.map((s) => a[2].slice(s.start, s.end))).toEqual(['-20']);
    expect(pair.marks.modified.map((s) => b[2].slice(s.start, s.end))).toEqual(['-25']);
  });

  it('tokenizes each side with its own profile', () => {
    // `;note` is a comment to Sinumerik and a (Klartext) comment as well, but `(note)` is a
    // comment only to Fanuc: the same text is a different number of words on the two sides.
    const original = ['G1 X1. (A B)'];
    const modified = ['G1 X1. (A B)'];
    expect([...wordMarkPairs([block([1, 1], [1, 1])], side(original, 'fanuc'), side(modified, 'fanuc'))]).toEqual([]);
    const pairs = [...wordMarkPairs([block([1, 1], [1, 1])], side(original, 'fanuc'), side(modified, 'sinumerik'))];
    expect(pairs).toHaveLength(1);
  });
});

describe('word marks on the normalized text of review mode (AD-52)', () => {
  /** The marked words of every line pair of two programs after review-mode normalization. */
  function reviewMarks(a: string[], b: string[], key: ProfileKey, on: Partial<CompareOptions>) {
    const o: CompareOptions = {
      ignoreBlockNumbers: false,
      ignoreWhitespace: false,
      ignoreComments: false,
      ignoreCase: false,
      ignoreNumberFormat: false,
      ignoreCycleNames: false,
      ...on,
    };
    const left = normalizeLines(a, compareCp(key), o).text.split('\n');
    const right = normalizeLines(b, compareCp(key), o).text.split('\n');
    expect(left.length).toBe(right.length);
    const pairs = [...wordMarkPairs([block([1, left.length], [1, right.length])], side(left, key), side(right, key))];
    return pairs.map((p) => ({
      line: p.originalLine,
      original: p.marks.original.map((s) => left[p.originalLine - 1].slice(s.start, s.end)),
      modified: p.marks.modified.map((s) => right[p.modifiedLine - 1].slice(s.start, s.end)),
    }));
  }

  const a = ['N10 G1 X10. F1200 (ROUGH)', 'N20 G0 Z5.'];
  const b = ['N100 G1 X10.000 F1000 (rough)', 'N110 G0 Z5.'];

  it('marks every difference when no option is on', () => {
    expect(reviewMarks(a, b, 'fanuc', {})).toEqual([
      { line: 1, original: ['N10', 'X10.', 'F1200', '(ROUGH)'], modified: ['N100', 'X10.000', 'F1000', '(rough)'] },
      { line: 2, original: ['N20'], modified: ['N110'] },
    ]);
  });

  it('marks only what is left after the ignore options have normalized the text', () => {
    const on = { ignoreBlockNumbers: true, ignoreNumberFormat: true, ignoreCase: true };
    expect(reviewMarks(a, b, 'fanuc', on)).toEqual([{ line: 1, original: ['F1200'], modified: ['F1000'] }]);
  });

  it('marks nothing on a line the options made equal', () => {
    expect(
      reviewMarks(['N10 G1 X10.  Y5. (A)'], ['N20 G1 X10. Y5. (B)'], 'fanuc', {
        ignoreBlockNumbers: true,
        ignoreWhitespace: true,
        ignoreComments: true,
      }),
    ).toEqual([]);
  });

  it('shows the marks on the normalized text, not on the file: spans are offsets into the shown line', () => {
    const marks = reviewMarks(['G1   X10.    F1200'], ['G1 X10. F1000'], 'fanuc', { ignoreWhitespace: true });
    expect(marks).toEqual([{ line: 1, original: ['F1200'], modified: ['F1000'] }]);
  });

  it('works on Klartext with the cycle names ignored', () => {
    const a = ['10 CYCL DEF 200 BOHREN ~', 'Q200=2 ~', 'Q201=-20'];
    const b = ['10 CYCL DEF 200 DRILLING ~', 'Q200=2 ~', 'Q201=-25'];
    expect(reviewMarks(a, b, 'klartext', {}).map((m) => m.modified)).toEqual([['DRILLING'], ['-25']]);
    expect(reviewMarks(a, b, 'klartext', { ignoreCycleNames: true }).map((m) => m.modified)).toEqual([['-25']]);
  });

});


describe('word runs (P4.25: what the word merge copies)', () => {
  const runs = (a: string, b: string, o: { ignoreCase?: boolean } = {}) => wordRuns(tokens(a), tokens(b), o);
  const text = (line: string, span: WordSpan | null) => (span === null ? null : line.slice(span.start, span.end));

  it('is one run per place where the lines differ, with the words of each side', () => {
    const a = 'G1 X1. Y2. Z3. F100';
    const b = 'G1 X9. Y2. Z3. F200';
    const found = runs(a, b);
    expect(found.map((r) => [text(a, r.original), text(b, r.modified)])).toEqual([
      ['X1.', 'X9.'],
      ['F100', 'F200'],
    ]);
  });

  it('keeps words that stand together in one run, from the start of the first to the end of the last', () => {
    const a = 'G1 X1.  Y2. F100';
    const b = 'G1 X9. Y8. F100';
    const found = runs(a, b);
    expect(found).toHaveLength(1);
    expect(text(a, found[0].original)).toBe('X1.  Y2.');
    expect(text(b, found[0].modified)).toBe('X9. Y8.');
  });

  it('has no words on the side that lacks them, and says where they would go', () => {
    const a = 'G1 X1. F100';
    const b = 'G1 X1. Y2. F100';
    const [run] = runs(a, b);
    expect(run.original).toBeNull();
    expect(text(b, run.modified)).toBe('Y2.');
    // Behind `X1.` of the first line and in front of `F100`.
    expect([run.originalAfter, run.originalBefore]).toEqual([6, 7]);
    expect([run.modifiedAfter, run.modifiedBefore]).toEqual([6, 11]);
  });

  it('knows an insertion at the start and at the end of a line', () => {
    const [start] = runs('X1.', 'G1 X1.');
    expect([start.originalAfter, start.originalBefore]).toEqual([null, 0]);
    const [end] = runs('G1', 'G1 X1.');
    expect([end.originalAfter, end.originalBefore]).toEqual([2, null]);
  });

  it('leaves out a word that only moved, so that copying a run never copies a word twice', () => {
    // Nothing but moved words: no run at all.
    expect(runs('G1 X1. Y2.', 'G1 Y2. X1.')).toEqual([]);
    const a = 'G1 X1. Y2. F100';
    const b = 'G1 Y2. X1. F200';
    const found = runs(a, b);
    expect(found.map((r) => [text(a, r.original), text(b, r.modified)])).toEqual([['F100', 'F200']]);
  });

  it('pairs a changed address word with the word of its letter on the other line, wherever it stands (review NC-1)', () => {
    const a = 'G1 X10 Y20 Z5 F100';
    const b = 'G1 Y20 Z6 X10 F200';
    expect(runs(a, b).map((r) => [text(a, r.original), text(b, r.modified)])).toEqual([
      ['Z5', 'Z6'],
      ['F100', 'F200'],
    ]);
    const c = 'G1 X10 Y20 Z5';
    const d = 'G1 Y20 X11 Z5';
    expect(runs(c, d).map((r) => [text(c, r.original), text(d, r.modified)])).toEqual([['X10', 'X11']]);
  });

  it('never spans a word that is not in the run: a moved word or a dropped token splits it', () => {
    // X stands twice on each side, so nothing pairs; the moved Y20 splits the original's run.
    const a = 'G1 X1 Y20 X2 Z5';
    const b = 'G1 Z5 X3 X4 Y20';
    const split = runs(a, b);
    expect(split.map((r) => text(a, r.original)).filter((t) => t !== null)).toEqual(['X1', 'X2']);
    for (const run of split) expect(text(b, run.modified) ?? '').not.toContain('Y20');
    // With the lines as written, a comment the options dropped splits a run too.
    const words = (line: string) => tokens(line).filter((t) => t.kind !== 'comment');
    const lineA = 'G1 G90 (KEEP) G54';
    const lineB = 'G1 G91 G55';
    const found = wordRuns(words(lineA), words(lineB), {}, { original: lineA, modified: lineB });
    expect(found.map((r) => text(lineA, r.original)).filter((t) => t !== null)).toEqual(['G90', 'G54']);
  });

  it('is empty for equal lines and for a line past the word cap, like wordDiff', () => {
    expect(runs('G1 X1.', 'G1 X1.')).toEqual([]);
    const long = Array.from({ length: WORD_DIFF_MAX_WORDS + 1 }, (_, i) => `X${i}.`).join(' ');
    expect(runs(long, `${long} Y1.`)).toEqual([]);
  });

  it('has a run for every marked word of wordDiff, and none for an unmarked one', () => {
    const a = 'N10 G1 X10. Y20. Z-5. F300 M8';
    const b = 'N10 G1 X11. Y20. Z-6. F400';
    const marked = wordDiff(tokens(a), tokens(b));
    const inRuns = (line: string, spans: WordSpan[], pick: 'original' | 'modified') =>
      spans.every((span) => runs(a, b).some((r) => {
        const run = r[pick];
        return run !== null && run.start <= span.start && span.end <= run.end;
      })) && line.length > 0;
    expect(inRuns(a, marked.original, 'original')).toBe(true);
    expect(inRuns(b, marked.modified, 'modified')).toBe(true);
    // And a run starts and ends on a marked word.
    for (const r of runs(a, b)) {
      if (r.original) expect(marked.original.some((s) => s.start === r.original!.start)).toBe(true);
      if (r.modified) expect(marked.modified.some((s) => s.end === r.modified!.end)).toBe(true);
    }
  });
});
