// The digit scan of `consecutiveRenumbering` (P4c typing performance) answers exactly what the general reading of
// the head did before it: `referenceRenumbering` below is the function as it was, built from the same helpers, and
// every test here holds the two to the same answer (the same edits, the same refusal) over random programs and
// the fixtures, on Klartext and on variants that switch the rarely used rules on (skip marks, continuation,
// labels, header, digits, ceiling).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MAX_RENUMBER_LINES,
  consecutiveRenumbering,
  endsWithContinuation,
  isProgramEndLine,
  isProgramStartLine,
  maxBlockNumber,
  startsAsContinuation,
  type ConsecutiveAnswer,
  type LineReader,
  type NumberEdit,
} from './blockNumbering';
import { blockHeadReader, blockNumberOf } from './tokenizer';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import type { CompiledProfile } from '$lib/core/profiles/types';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { cpOf } from '../../../../tests/unit/helpers/profiles';
import { profilesToRead, random, randomLines } from '../../../../tests/unit/helpers/randomNc';

const FIXTURES = new URL('../../../../tests/fixtures/p4c/typing/', import.meta.url);

/** `consecutiveRenumbering` as it was before the digit scan: the head of every line read in full. */
function referenceRenumbering(
  read: LineReader,
  lineCount: number,
  fromLine: number,
  firstNumber: number,
  cp: CompiledProfile,
  maxLines: number,
): ConsecutiveAnswer {
  const fits = (value: number): boolean => Number.isSafeInteger(value) && value >= 0 && value <= maxBlockNumber(cp);
  const digitsOf = (value: number): string => {
    const digits = cp.profile.numbering?.digits;
    const text = String(value);
    return typeof digits === 'number' && digits > text.length ? text.padStart(digits, '0') : text;
  };
  const head = blockHeadReader(cp);
  const edits: NumberEdit[] = [];
  let next = firstNumber;
  const start = Math.max(1, fromLine);
  let prevContinues = start > 1 && start - 1 <= lineCount ? endsWithContinuation(read(start - 1), cp) : false;
  for (let line = start; line <= lineCount; line++) {
    const text = read(line);
    const tail = prevContinues || startsAsContinuation(text, cp);
    const info = head(text, prevContinues);
    prevContinues = info.continues;
    if (tail) continue;
    if (isProgramStartLine(text, cp)) break;
    if (info.number !== null) {
      const at = blockNumberOf(text, cp);
      if (at !== null && at.text === info.number) {
        if (!fits(next)) return { ok: false, reason: 'overflow' };
        const digits = digitsOf(next);
        if (digits !== at.text) {
          if (edits.length >= maxLines) return { ok: false, reason: 'tooMany' };
          const digitsStart = at.end - at.text.length;
          edits.push({ line, startColumn: digitsStart + 1, endColumn: at.end + 1, text: digits });
        }
        next++;
      }
    }
    if (isProgramEndLine(text, cp)) break;
  }
  return { ok: true, edits, last: next - 1 };
}

function variant(id: string, change: (profile: Record<string, any>) => void): CompiledProfile {
  const raw = structuredClone(BUILTIN_PROFILE_JSON.find((p) => (p as { id?: string }).id === id)) as Record<string, any>;
  change(raw);
  const result = validateProfile(raw);
  if (!result.ok) throw new Error(`${id} variant: ${result.errors.join('; ')}`);
  return compileProfile(result.profile);
}

/** Klartext as built, and with the rules the scan has to leave alone or take care of. */
const KLARTEXT: [string, CompiledProfile][] = [
  ['klartext', cpOf('heidenhain-klartext')],
  ['klartext, digits 4', variant('heidenhain-klartext', (p) => { p.numbering.digits = 4; })],
  ['klartext, ceiling 60', variant('heidenhain-klartext', (p) => { p.numbering.max = 60; })],
  ['klartext, skip after the number', variant('heidenhain-klartext', (p) => { p.syntax.blockSkip = { chars: '/', position: 'after-number' }; })],
  ['klartext, skip before the number', variant('heidenhain-klartext', (p) => { p.syntax.blockSkip = { chars: '/', position: 'before-number' }; })],
  ['klartext, skip mark is a digit', variant('heidenhain-klartext', (p) => { p.syntax.blockSkip = { chars: '5', position: 'either' }; })],
  ['klartext, no continuation', variant('heidenhain-klartext', (p) => { delete p.syntax.continuation; delete p.syntax.continuationMark; })],
  ['klartext, continuation by a backslash', variant('heidenhain-klartext', (p) => { p.syntax.continuation = '\\\\\\s*$'; p.syntax.continuationMark = '\\'; })],
  ['klartext, continuation by a digit', variant('heidenhain-klartext', (p) => { p.syntax.continuation = '\\d+\\s*$'; p.syntax.continuationMark = '1'; })],
  ['klartext, continuation start $', variant('heidenhain-klartext', (p) => { p.syntax.continuationStart = '^\\s*\\$'; })],
  ['klartext, labels written as digits', variant('heidenhain-klartext', (p) => { p.syntax.labels = '^(?<name>\\d+)(?=[ :])'; })],
  ['klartext, header written as digits', variant('heidenhain-klartext', (p) => { p.syntax.header = '^\\d+[ .]'; })],
];

const POOL = [
  'L X+10 Y+5 R0 F200', 'L X+1.5 Z-2 FMAX', 'CYCL DEF 200 DRILLING', 'TOOL CALL 5 Z S3000', 'M3', 'LBL 1', 'CALL LBL 1', 'L Z+100 R0 FMAX M5', 'CC X+0 Y+0',
  'C X+5 Y+5 DR+', 'FN 0: Q1 = +5', '', ' ', '; a comment', '; END PGM', '(note)', '"string"', 'Q1 = 5', 'L X+10 ; trailing', 'L X+10 ~', 'L X+10 ~  ', ' ~',
  'BLK FORM 0.1 Z X+0 Y+0 Z-40', 'END PGM A MM', 'END PGM B', 'BEGIN PGM B MM', 'LBL 0', 'L X+10 ; END PGM', 'FN 16: F-PRINT',
];
const NUMBERS = ['0', '1', '2', '3', '5', '7', '10', '11', '12', '20', '21', '99', '100', '007', '0012', '0005', '123456789', '12345678901234567890', '60', '59', '61'];
const GLUE = [' ', ' ', ' ', ' ', '  ', '\t', ' ', '', '/', '/ ', '~', '\f', '\v', 'X', ';', '.', ',', ':'];

/** A Klartext-like line: mostly numbered, sometimes broken in the ways the head cares about. */
function klartextLine(next: () => number, counter: number): string {
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(next() * list.length)];
  const r = next();
  const number = r < 0.7 ? String(counter) : r < 0.85 ? String(Math.max(0, counter + Math.floor(next() * 5) - 2)) : pick(NUMBERS);
  const lead = next() < 0.88 ? '' : pick([' ', '  ', '\t', '/', '/ ', '/1 ', '%', 'LOOP: ', 'N', '-', ' ']);
  const glue = next() < 0.8 ? ' ' : pick(GLUE);
  const body = pick(POOL);
  const form = next();
  if (form < 0.06) return lead + number; // a number alone
  if (form < 0.1) return lead + number + glue; // a number and blanks
  if (form < 0.14) return body; // a line without a number
  return lead + number + glue + body;
}

function klartextProgram(next: () => number, size: number): string[] {
  const lines: string[] = [];
  let counter = Math.floor(next() * 3);
  for (let i = 0; i < size; i++) {
    const line = klartextLine(next, counter);
    lines.push(line);
    if (next() < 0.97) counter++;
  }
  // A program end now and then, and the start of the next program behind it.
  if (next() < 0.5) lines.splice(Math.floor(next() * lines.length), 0, `${counter} END PGM A MM`);
  if (next() < 0.3) lines.splice(Math.floor(next() * lines.length), 0, `0 BEGIN PGM B MM`);
  return lines;
}

function compare(lines: readonly string[], cp: CompiledProfile, from: number, first: number, maxLines: number, label: string): void {
  const read: LineReader = (n) => lines[n - 1] ?? '';
  const expected = referenceRenumbering(read, lines.length, from, first, cp, maxLines);
  const actual = consecutiveRenumbering(read, lines.length, from, first, cp, maxLines);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    // The first line where the two walks part, for the failure message.
    expect({ label, from, first, maxLines, lines: lines.slice(Math.max(0, from - 2), from + 12), actual }).toEqual({
      label,
      from,
      first,
      maxLines,
      lines: lines.slice(Math.max(0, from - 2), from + 12),
      actual: expected,
    });
  }
  expect(actual).toEqual(expected);
}

describe('consecutiveRenumbering (digit scan) answers what the general reading answered', () => {
  it('on random Klartext programs, from random lines, with random first numbers and limits, on Klartext and its variants', () => {
    let compared = 0;
    let withEdits = 0;
    for (const [name, cp] of KLARTEXT) {
      for (let seed = 1; seed <= 60; seed++) {
        const next = random(seed * 7919 + name.length);
        const lines = klartextProgram(next, 40 + Math.floor(next() * 80));
        for (let k = 0; k < 6; k++) {
          const from = Math.floor(next() * (lines.length + 3)) - 1;
          const first = Math.floor(next() * 4) === 0 ? Math.floor(next() * 130) : Math.max(0, from + Math.floor(next() * 3) - 1);
          const maxLines = [1, 3, 10, 5000][Math.floor(next() * 4)];
          compare(lines, cp, from, first, maxLines, name);
          compared++;
          const answer = consecutiveRenumbering((n) => lines[n - 1] ?? '', lines.length, from, first, cp, maxLines);
          if (answer.ok && answer.edits.length > 0) withEdits++;
        }
      }
    }
    // The comparison is not empty: most of the runs renumber something.
    expect(compared).toBeGreaterThan(4000);
    expect(withEdits).toBeGreaterThan(compared / 3);
  });

  it('on random lines that are hard on the head, in every built-in profile and the variants of the head tests', () => {
    for (const [name, cp] of profilesToRead()) {
      for (let seed = 1; seed <= 12; seed++) {
        const lines = randomLines(seed * 31, 90);
        const next = random(seed);
        for (let k = 0; k < 4; k++) {
          const from = 1 + Math.floor(next() * lines.length);
          compare(lines, cp, from, Math.floor(next() * 200), [2, 20, 5000][k % 3], name);
        }
        compare(lines, cp, 1, 0, 5000, name);
      }
    }
  });

  it('on the Klartext fixture, from every line, with the first number the line would have', () => {
    const lines = readFileSync(new URL('klartext-plate.h', FIXTURES), 'utf8').replace(/\n$/, '').split('\n');
    const cp = cpOf('heidenhain-klartext');
    for (let from = 1; from <= lines.length + 1; from++) {
      for (const first of [0, from - 1, from, from + 3, 99]) compare(lines, cp, from, first, MAX_RENUMBER_LINES, 'plate');
    }
  });

  it('on the digit shapes the scan decides itself: no-break space, tab, form feed, a digit run to the end, a marker cutting the digits', () => {
    const cp = cpOf('heidenhain-klartext');
    const shapes = [
      '12 L X+1', '12\tL', '12 L', '12\fL', '12\vL', '12', '12 ', '12~', '12 ~', '12L', '12/ L', '12 / L', '/ 12 L', '12;L', '  12 L', '0012 L', '012 L',
      '99999999999999999999 L', '1 ~', '1\t~', '12 L ~', '1x ~', '9', '5 BEGIN PGM X MM', '5 END PGM X MM', '5 ; END PGM', '5 (END PGM)', '', ' ', '~', ' ~',
    ];
    for (const a of shapes) {
      for (const b of shapes) {
        for (const c of ['7 L', '8 END PGM Z MM', '']) {
          const lines = [a, b, '3 L', c, '4 L'];
          for (let from = 1; from <= 5; from++) for (const first of [0, 3, 12, 13]) compare(lines, cp, from, first, 100, `${JSON.stringify(a)} ${JSON.stringify(b)}`);
        }
      }
    }
  });
});
