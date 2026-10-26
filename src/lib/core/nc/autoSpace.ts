// Auto-space while typing (Phase 4 plan §6.5 rule 1; `editing.autoSpace`). Pure, no Monaco and no stores:
// `contrib/typing.ts` reads the keyboard and the editor, asks this, and types the answer.
//
// The rule. The tokenizer of the effective profile reads the line as it reads with the letter typed (the way
// `keepsCase` asks it; the line above is tokenized for the continuation state only). A space goes in front of
// the letter when all hold:
//
//   - the character before the letter is not white space (and there is one);
//   - the letter starts a new address word: a `word` token whose address is that letter starts exactly at it;
//   - the token that ends exactly where the letter starts is a `word` with an address, or a `blockNumber`,
//     and its value is complete: a literal, a variable reference, or a closed bracket expression (`X[#1+1]`);
//   - the letter is not the first letter of `syntax.exponentMarker` behind a word whose value is a number: it
//     may start the exponent (Sinumerik `X1.5` + `E` → `X1.5EX3`), so it stays unspaced.
//
// Everything else is "no space": a letter inside a comment, a string, kept text, a call, a label, a program
// marker, a variable, an expression, an operator, a continuation or a skip mark never starts a `word` token at
// itself; a letter that continues the word before it (`GOTO`, `FMAX`, `NLAP1`, `CYCLE81`, `LIMS[2]=`,
// `SB=1200`, `VAR1A`) is inside that token; a word without a value yet (`G` of `GO`, Klartext `L`) and a
// bracket that is not a word's value (`IF[…]GOTO`) are not a complete word. **When the tokenizer cannot tell,
// the answer is "no space"**: a missing space is cosmetic, a wrong one changes the program.
//
// Klartext (`wordSeparatorRequired`) reads `X+10Y` as one unknown run, because its words must be separated.
// There the line is also read with the space in front of the letter: when that reading has the letter as the
// start of an address word right after a complete word that begins where the unknown run began
// (`X+10` + `Y`), the space is what the control needs (`X+10 Y`). Nothing else is ever read twice.

import type { CompiledProfile } from '$lib/core/profiles/types';
import { decideUppercase, keepsCase, uppercaseOf } from './typing';
import type { KeyInput, TypingSite, UppercaseDecision } from './typing';
import { tokenizeLine } from './tokenizer';
import type { LineState, NcToken } from './types';

/**
 * True when the letter `ch`, typed at `site`, starts a new address word straight after a finished word
 * and a space goes in front of it (`G1` + `X` → `G1 X`). See the rule at the top of this file.
 */
export function wantsSpaceBefore(site: TypingSite, ch: string, cp: CompiledProfile): boolean {
  const before = site.before;
  if (before === '' || !isCasedLetter(ch)) return false;
  if (isBlank(before.charCodeAt(before.length - 1))) return false;
  const prev: LineState | undefined = site.previousLine === null ? undefined : tokenizeLine(site.previousLine, cp).state;
  const at = before.length;

  const typed = tokenizeLine(before + ch + site.after, cp, prev).tokens;
  const i = indexAt(typed, at);
  if (i < 0) return false;
  const token = typed[i];
  if (token.start === at) {
    if (!startsWordWith(token, ch, cp)) return false;
    const left = typed[i - 1];
    if (left === undefined || left.end !== at || !isCompleteWord(left, cp)) return false;
    // The first letter of an exponent (Sinumerik `1.5EX3`) after a number may continue it.
    return !startsExponent(left, ch, cp);
  }

  // Klartext: the letter joined the word before it into one unknown run.
  if (cp.profile.syntax.wordSeparatorRequired !== true || token.kind !== 'unknown') return false;
  const spaced = tokenizeLine(`${before} ${ch}${site.after}`, cp, prev).tokens;
  const j = indexAt(spaced, at + 1);
  if (j < 2) return false;
  const letter = spaced[j];
  const blank = spaced[j - 1];
  const left = spaced[j - 2];
  return (
    letter.start === at + 1 &&
    startsWordWith(letter, ch, cp) &&
    blank.kind === 'whitespace' &&
    blank.start === at &&
    left.end === at &&
    left.start === token.start &&
    isCompleteWord(left, cp)
  );
}

/** The options a letter key is decided with (each the profile's flag or the session switch). */
export interface TypingOptions {
  uppercase: boolean;
  autoSpace: boolean;
}

/**
 * The decision for a letter key with upper-case typing and auto-space together. Each cursor gets its text:
 * the capital (or the key as typed, in a comment, a string, kept text, or with upper case off), with a space
 * in front when `wantsSpaceBefore` says so. All cursors the same → one `type` command, so the space and the
 * capital are one undo step with the keystroke; different → `perCursor`. With auto-space off this is exactly
 * `decideUppercase`.
 */
export function decideTyping(
  k: KeyInput,
  sites: readonly TypingSite[],
  cp: CompiledProfile,
  options: TypingOptions,
  composing = false,
): UppercaseDecision {
  if (sites.length === 0 || (!options.uppercase && !options.autoSpace)) return { kind: 'pass' };
  if (!options.autoSpace) return decideUppercase(k, sites, cp, true, composing);
  const key = letterKeyOf(k, composing);
  if (key === null) return { kind: 'pass' };
  const upper = options.uppercase ? uppercaseOf(k, composing) : null;
  const texts = sites.map((site) => {
    const ch = upper !== null && !keepsCase(site, upper, cp) ? upper : key;
    return wantsSpaceBefore(site, ch, cp) ? ` ${ch}` : ch;
  });
  if (texts.every((text) => text === key)) return { kind: 'pass' };
  if (texts.every((text) => text === texts[0])) return { kind: 'type', text: texts[0] };
  return { kind: 'perCursor', texts };
}

/**
 * The letter a plain letter key types, in either case (Shift and Caps Lock are typing, not chords), or null:
 * Ctrl, Alt or Cmd (AltGr arrives as Ctrl+Alt), a key that goes to an IME, a dead key, a named key, a digit
 * or a symbol.
 */
export function letterKeyOf(k: KeyInput, composing = false): string | null {
  if (k.ctrlKey === true || k.altKey === true || k.metaKey === true) return null;
  if (composing || k.isComposing === true || k.keyCode === 229 || k.key === 'Process') return null;
  return isCasedLetter(k.key) ? k.key : null;
}

/** One UTF-16 unit that has an upper and a lower case of one unit each. */
function isCasedLetter(ch: string): boolean {
  if (ch.length !== 1) return false;
  const upper = ch.toUpperCase();
  const lower = ch.toLowerCase();
  return upper !== lower && upper.length === 1 && lower.length === 1;
}

function isBlank(code: number): boolean {
  return code === 32 || code === 9 || code === 0xa0;
}

/** The index of the token that covers offset `at`, or -1. */
function indexAt(tokens: readonly NcToken[], at: number): number {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.start > at) return -1;
    if (token.end > at) return i;
  }
  return -1;
}

/** A `word` token whose address is the letter `ch` (case as the profile reads it). */
function startsWordWith(token: NcToken, ch: string, cp: CompiledProfile): boolean {
  if (token.kind !== 'word' || typeof token.address !== 'string') return false;
  return cp.flags === 'i' ? token.address.toUpperCase() === ch.toUpperCase() : token.address === ch;
}

/**
 * A finished word: a block number with its digits, or an address word whose value is a literal, a variable
 * reference (`#101`, `Q12`, `R1`, with a sign) or a closed bracket expression (`[#1+1]`, `-[#2]`). A word
 * without an address (`TOOL CALL 1`, the `5` of `R1=5`) is part of something else and does not count.
 */
function isCompleteWord(token: NcToken, cp: CompiledProfile): boolean {
  const value = token.valueText;
  if (token.kind === 'blockNumber') return typeof value === 'string' && /^\d+$/.test(value);
  if (token.kind !== 'word' || typeof token.address !== 'string' || token.address === '') return false;
  if (typeof value !== 'string' || value === '') return false;
  if (token.value !== null && token.value !== undefined) return true;
  const unsigned = value.charCodeAt(0) === 43 || value.charCodeAt(0) === 45 ? value.slice(1) : value;
  return isClosedBracket(unsigned) || isVariable(unsigned, cp);
}

/**
 * True when `ch` is the first letter of `syntax.exponentMarker` (Sinumerik `EX`) and `left` is an address word
 * whose value is a number: the letter may start the exponent of that number (`X1.5` + `E` → `X1.5EX3`), so it
 * gets no space. A block number never carries an exponent.
 */
function startsExponent(left: NcToken, ch: string, cp: CompiledProfile): boolean {
  const marker = cp.profile.syntax.exponentMarker;
  if (typeof marker !== 'string' || marker === '') return false;
  if (left.kind !== 'word' || left.value === null || left.value === undefined) return false;
  return cp.flags === 'i' ? marker[0].toUpperCase() === ch.toUpperCase() : marker[0] === ch;
}

/** `[…]` with its brackets balanced, closed by the last character and not before. */
function isClosedBracket(text: string): boolean {
  if (text.length < 2 || text[0] !== '[' || text[text.length - 1] !== ']') return false;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0 && i !== text.length - 1) return false;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/** `syntax.variables`, anchored, compiled once per compiled profile. */
const VARIABLE = new WeakMap<CompiledProfile, RegExp | null>();

function isVariable(text: string, cp: CompiledProfile): boolean {
  let re = VARIABLE.get(cp);
  if (re === undefined) {
    const source = cp.profile.syntax.variables;
    try {
      re = typeof source === 'string' && source !== '' ? new RegExp(`^(?:${source})$`, cp.flags) : null;
    } catch {
      re = null;
    }
    VARIABLE.set(cp, re);
  }
  return re !== null && re.test(text);
}
