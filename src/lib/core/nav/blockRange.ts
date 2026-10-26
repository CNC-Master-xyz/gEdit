// Select or delete a block range (Phase 4 plan §6.5 rule 7). Pure, no Monaco and no stores: `contrib/ranges.ts`
// asks for the form, calls this, and selects or deletes the lines. Owner: P4.14a.
//
// Two kinds of range, one answer (the inclusive whole lines):
//
//   - *Line numbers:* whole numbers inside 1…lineCount; the first not above the second.
//   - *Block numbers:* each number is searched in **all** block heads of the document. A head is what the
//     tokenizer's head reading finds (`blockHeadOf`): a line that continues the block above has none, and a number
//     inside a comment or a string is not one. **No guess, unlike Go to Block:** a number that is nowhere is
//     `missingBlock`, a number that two blocks carry (a program with subprograms restarts at `N10`) is
//     `duplicateBlock` and names the lines. The range runs from the first block's line to the last line that
//     continues the second block, so a block is never cut in two.
//
// What a block number is follows the profile, by the same readers Go to Block and the renumber use: `N120` or the
// bare `120` on a prefix dialect, the leading integer of Klartext, the main-block mark `:120` of Sinumerik. The
// typed text is a bare number, or one behind the profile's block prefix or one of its other spellings (in either
// case), behind `N` on Klartext (as Go to Block takes it), or behind the main-block mark; any other letter (`G10`,
// `X10`, `O1000`) is no block number, so a range never selects or deletes by a word that is not one. A dialect
// that compares sequence numbers as text (Okuma: `N0100` and `N100` are two names) is searched that way, so `100`
// does not find `N0100`.

import { blockHeadReader } from '$lib/core/nc/tokenizer';
import type { CompiledProfile } from '$lib/core/profiles/types';
import { blockKeyOf, comparesByText, type BlockKey } from '$lib/core/transforms/references';

/** What the form gives: two numbers as typed, and what they are. */
export interface BlockRangeRequest {
  kind: 'line' | 'block';
  from: string;
  to: string;
}

/** Why a range is refused; every one is said in the form, in plain words, and nothing is selected or deleted. */
export type BlockRangeRefusal =
  | { reason: 'notNumber'; field: 'from' | 'to' }
  | { reason: 'outsideProgram'; field: 'from' | 'to'; lineCount: number }
  | { reason: 'missingBlock'; field: 'from' | 'to'; number: number }
  /** `lines`: the first `MAX_LISTED_LINES` lines that carry the number; `total` how many there are. */
  | { reason: 'duplicateBlock'; field: 'from' | 'to'; number: number; lines: number[]; total: number }
  | { reason: 'reversed' };

export type BlockRangeAnswer =
  /** The inclusive range in whole lines; with block numbers it runs to the last line that continues the `to` block. */
  | { ok: true; startLine: number; endLine: number; blocks: { from: number; to: number } | null }
  | ({ ok: false } & BlockRangeRefusal);

/** The most lines a `duplicateBlock` refusal names. */
export const MAX_LISTED_LINES = 5;

const WHOLE_NUMBER = /^\d+$/;

/** The block number as the profile spells it, for a message: `N120` on a prefix dialect, `120` on Klartext. */
export function blockLabel(number: number, cp: CompiledProfile): string {
  const bn = cp.profile.syntax?.blockNumber;
  if (!bn || bn.mode === 'leading-integer') return String(number);
  return `${typeof bn.prefix === 'string' && bn.prefix !== '' ? bn.prefix : 'N'}${number}`;
}

/**
 * The digits of a typed block number, or null: a bare number (`120`), or one behind the profile's block prefix or
 * one of `altPrefixes` in either case (`N120`, `n 120`), behind `N` on a leading-integer dialect (Klartext, as Go to
 * Block reads it), or behind the main-block mark where the dialect has main blocks (`:120`). Nothing else.
 */
function typedDigits(raw: string, cp: CompiledProfile): string | null {
  const text = raw.trim();
  if (WHOLE_NUMBER.test(text)) return text;
  const bn = cp.profile.syntax?.blockNumber;
  const prefixes: string[] = [];
  if (bn?.mode === 'leading-integer') prefixes.push('N');
  else {
    prefixes.push(typeof bn?.prefix === 'string' && bn.prefix !== '' ? bn.prefix : 'N');
    for (const alt of Array.isArray(bn?.altPrefixes) ? bn.altPrefixes : []) if (typeof alt === 'string' && alt !== '') prefixes.push(alt);
  }
  const main = bn?.mainPrefix;
  if (typeof main === 'string' && main !== '') prefixes.push(main);
  for (const prefix of prefixes) {
    if (text.slice(0, prefix.length).toUpperCase() !== prefix.toUpperCase()) continue;
    const rest = text.slice(prefix.length).trim();
    if (WHOLE_NUMBER.test(rest)) return rest;
  }
  return null;
}

function resolveLines(lineCount: number, request: BlockRangeRequest): BlockRangeAnswer {
  const numbers: number[] = [];
  for (const field of ['from', 'to'] as const) {
    const text = request[field].trim();
    if (!WHOLE_NUMBER.test(text)) return { ok: false, reason: 'notNumber', field };
    numbers.push(Number(text));
  }
  for (const field of ['from', 'to'] as const) {
    const value = numbers[field === 'from' ? 0 : 1];
    if (value < 1 || value > lineCount) return { ok: false, reason: 'outsideProgram', field, lineCount };
  }
  if (numbers[0] > numbers[1]) return { ok: false, reason: 'reversed' };
  return { ok: true, startLine: numbers[0], endLine: numbers[1], blocks: null };
}

/** Every block head of a document, by block number: the lines that carry it (ascending). */
export interface BlockIndex {
  byKey: Map<BlockKey, number[]>;
}

/**
 * One pass over the document, `read` 1-based. The form asks the same document again on every keystroke, so it builds
 * this once and hands it to `resolveBlockRange`; without one the resolver builds its own.
 */
export function indexBlocks(read: (line: number) => string, lineCount: number, cp: CompiledProfile): BlockIndex {
  const byText = comparesByText(cp);
  const head = blockHeadReader(cp);
  const byKey = new Map<BlockKey, number[]>();
  let continues = false;
  for (let line = 1; line <= lineCount; line++) {
    const h = head(read(line), continues);
    continues = h.continues;
    if (h.number === null) continue;
    const key = blockKeyOf(h.number, byText);
    if (key === null) continue;
    const known = byKey.get(key);
    if (known === undefined) byKey.set(key, [line]);
    else known.push(line);
  }
  return { byKey };
}

/**
 * The inclusive range of `request`, or the reason it is refused. `read` is 1-based (the lines of the document, in a
 * channel pane too); the whole document is read once, line by line, so a 300,000-line program costs one pass.
 * `index` (from `indexBlocks`, for the same lines) spares that pass when the same document is asked again.
 */
export function resolveBlockRange(
  read: (line: number) => string,
  lineCount: number,
  cp: CompiledProfile,
  request: BlockRangeRequest,
  index?: BlockIndex,
): BlockRangeAnswer {
  if (request.kind === 'line') return resolveLines(lineCount, request);

  const byText = comparesByText(cp);
  const keys: BlockKey[] = [];
  const numbers: number[] = [];
  for (const field of ['from', 'to'] as const) {
    const digits = typedDigits(request[field], cp);
    const key = digits === null ? null : blockKeyOf(digits, byText);
    if (digits === null || key === null) return { ok: false, reason: 'notNumber', field };
    keys.push(key);
    numbers.push(Number.parseInt(digits, 10));
  }

  const blocks = (index ?? indexBlocks(read, lineCount, cp)).byKey;
  const found = [blocks.get(keys[0]) ?? [], blocks.get(keys[1]) ?? []];
  const fields = ['from', 'to'] as const;
  for (let i = 0; i < 2; i++) {
    const lines = found[i];
    if (lines.length === 0) return { ok: false, reason: 'missingBlock', field: fields[i], number: numbers[i] };
    if (lines.length > 1) {
      return {
        ok: false,
        reason: 'duplicateBlock',
        field: fields[i],
        number: numbers[i],
        lines: lines.slice(0, MAX_LISTED_LINES),
        total: lines.length,
      };
    }
  }
  const startLine = found[0][0];
  const toLine = found[1][0];
  if (startLine > toLine) return { ok: false, reason: 'reversed' };
  return { ok: true, startLine, endLine: lastLineOfBlock(read, lineCount, cp, toLine), blocks: { from: numbers[0], to: numbers[1] } };
}

/**
 * The last line of the block that starts at `line`: the lines that continue it (the marker at the end of the line
 * above, `~` in Klartext; or the marker at the start of the line itself, Okuma `$`) belong to it.
 */
function lastLineOfBlock(read: (line: number) => string, lineCount: number, cp: CompiledProfile, line: number): number {
  const head = blockHeadReader(cp);
  const start = cp.re.continuationStart;
  let end = line;
  let continues = head(read(end), false).continues;
  while (end < lineCount) {
    const next = read(end + 1);
    if (start !== undefined) start.lastIndex = 0;
    const starts = start !== undefined && start.test(next);
    if (!continues && !starts) break;
    end++;
    continues = head(next, true).continues;
  }
  return end;
}
