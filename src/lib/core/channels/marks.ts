// Sync marks, pure (plan §7.17, AD-32). Built and hardened by WP12.1.
//
// A mark is found on the MASKED line with strings blanked too, so a wait written in a
// comment or inside a string is not a wait. Rules run in declaration order and the first
// rule that matches a line owns it; a line holds at most one mark. Four ways to match:
//
//   `codes`   the owner's plain list (`M100-M199, M300`, §10.1 2026-10-07): a code word as
//             the control reads it — the address, blanks allowed before the digits as the
//             tokenizer allows them, leading zeros not counted, no decimal point, not an
//             assignment (`M2=3` is a spindle's M3 on Sinumerik); id = the code read that
//             way, so `M0901`, `M 901` and `M901` are the one wait `M901`; the primary form
//   `prefix`  a literal prefix and digits (`M1` + two digits): id = the digits, shown
//             with the prefix in front (`shownMark`: `M130`, M13 review NC-10)
//   `regex`   a pattern with a `mark` capture (absent and not needed for `count`)
//   and, when `stopsAndEndsWait` is set, the profile's own `stop`/`end` outline lines
//
// The partners come from `all`, `fixed`, `word` (an address word read as R5 `digits` or
// `bitmask`) or `line` (a pattern with a `channels` capture, decoded `split`, `digits` or
// `bitmask`), with `whenAbsent` where the line says nothing. Every decoded piece goes
// through `resolveChannelToken`, so ids and aliases work everywhere; a piece that names no
// declared channel is kept as written, for the check to report (`unknown-channel`).
//
// A wait code written after a macro call on its line (`G65 P9010 M901`) is an argument of the
// call, handed to the macro as a local variable, and not a wait (T172, review NC-05). Which
// codes call a macro is the code database's `CodeEntry.call` flag (`macroCallCodes`), read by
// the caller and handed in as `calls`; a mark in front of the call is still a mark. The same
// holds for a stop or end that waits (`stopsAndEndsWait`): `G65 P9010 M30` hands `M30` to the
// macro (the owner, 2026-10-19).
//
// Manual check (2026-10-25): a `regex` rule with `markSeparator` reads every mark of a list
// (`SETM(5,6)` is two marks, D2-5); a `codes` mark that is written after another rule's wait code
// on the same line, with the letter that rule reads its partners from, is that wait's partner
// word and not a mark of its own (`M901 P12` on a machine whose `P1-P9999` rule comes first,
// D2-5); a wait of a rule that asks for the same partners says whether it shares its block
// (`SyncHit.shared`); a rule with `withCodes` says which of them stands at its mark
// (`SyncHit.withCode`, D2-4). A `withCodes` code in a block WITHOUT the mark is not reported: the
// manual's own example writes the other turret's spindle command in the block after its P code.
//
// What is never guessed (WP12.1): a `P` word the decode cannot read (`P12.`, `P#1`,
// `P[#5]`, a bare `P`) is one unknown piece written as on the line, never "no `P`" and so
// never `whenAbsent`; two `P` words that disagree on one wait line are one unknown piece
// too. Either way the check reports the wait instead of pairing it with channels the line
// may not name.

import type { CompiledProfile } from '$lib/core/profiles/types';
import { GUARD_BUDGET_MS, guardJob } from '$lib/core/regexGuard/guard';
import { isLiteralPattern, type GuardProbe } from '$lib/core/regexGuard/job';
import type { GuardRunner } from '$lib/core/regexGuard/runner';
import { isWaitCode, parseWaitCodes, waitCodeId, waitCodeWordRe } from './codes';
import {
  budgetClock,
  compileChannelPattern,
  findSections,
  maskForMarks,
  resolveChannelToken,
  splitChannelTokens,
  type MaskedLines,
} from './resolve';
import { execAfterNonWord, lookbehindPrefilter, unguardedWordRe } from './prefilter';
import { documentChannel } from './siblings';
import {
  CHANNEL_CAPS,
  STOPS_AND_ENDS_RULE,
  type ChannelBudget,
  type ChannelParams,
  type ChannelProblem,
  type ChannelRef,
  type ChannelSection,
  type FindMarksResult,
  type PartnerDecode,
  type SyncHit,
  type SyncRule,
  type WaitCodeRange,
  type WhenAbsent,
} from './types';

export { maskForMarks };

/**
 * Whether the marks of `rule` that meet must name the same channels and be written alike
 * (NC-01): `samePartners` as the rule says it, and by default (absent) for a rule whose
 * partners are a `P` word (`partners.kind: 'word'`; T044, the P4e NC-3 follow-up). A Siemens
 * list rule (`kind: 'line'`), whose lists may differ, stays off unless it says so. (Here, not in
 * `check.ts`, since `findMarks` reads it too; `check.ts` re-exports it.)
 */
export function asksSamePartners(rule: Pick<SyncRule, 'samePartners' | 'partners'> | undefined): boolean {
  if (rule === undefined) return false;
  if (typeof rule.samePartners === 'boolean') return rule.samePartners;
  return rule.partners?.kind === 'word';
}

/**
 * The prefix a mark of `rule` was written behind, or `''` (M13 review NC-10).
 *
 * A `prefix` rule keys its marks by the digits (`30` for `M130`), which is right for pairing
 * and stays so; only the text a user reads puts the prefix back ([`shownMark`]).
 */
export function markPrefixOf(rule: SyncRule | undefined): string {
  const match = rule?.match;
  return match?.kind === 'prefix' && typeof match.prefix === 'string' ? match.prefix : '';
}

/**
 * A mark id as a message or a program-map row shows it: `M130`, not `30`, which reads like a
 * block number (M13 review NC-10). `''` stays `''` (an id-less mark; the caller names the rule).
 */
export function shownMark(mark: string, rule: SyncRule | undefined): string {
  return mark === '' ? '' : markPrefixOf(rule) + mark;
}

/**
 * R5 `digits` / `bitmask`, and `split`: the channel tokens a capture names, before they
 * are resolved. A path number *n* is the token `"n"`.
 */
export function decodePartnerText(text: string, decode: PartnerDecode, separator = ','): string[] {
  const trimmed = text.trim();
  if (decode === 'split') return splitChannelTokens(trimmed, separator);
  if (!/^\d+$/.test(trimmed)) return trimmed === '' ? [] : [trimmed];
  if (decode === 'digits') {
    const out: string[] = [];
    // The control does not read a leading 0, so path 10 is never the first digit.
    for (const digit of trimmed.replace(/^0+/, '')) {
      const token = digit === '0' ? '10' : digit;
      if (!out.includes(token)) out.push(token);
    }
    return out;
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value >= 2 ** 32) return [trimmed];
  const out: string[] = [];
  for (let bit = 0; bit < 32; bit++) {
    if (Math.floor(value / 2 ** bit) % 2 === 1) out.push(String(bit + 1));
  }
  return out;
}

interface CompiledRule {
  rule: SyncRule;
  /** Returns the mark id, or null when the line is not one of this rule's marks. */
  find(masked: string): string | null;
  /**
   * T172: the mark id of a mark that starts before column `limit` (0-based, on the masked line),
   * or null. Asked only on a line that holds a macro call in front of the mark `find` found.
   */
  findBefore(masked: string, limit: number): string | null;
  /** The partner ids, and whether they came from `whenAbsent` (NC-01). */
  partners(masked: string): { ids: string[]; absent: boolean };
  blocking: boolean;
  /**
   * `codes` and `prefix`: where the mark the last successful `find`/`findBefore` returned stands on
   * the masked line, and its letter as written. One object per rule, rewritten by each find: read
   * it right after the find, before another line is read. null for the other kinds.
   */
  where: { start: number; end: number; letter: string } | null;
  /** `partners.kind: 'word'`: the address, upper case; null otherwise. */
  partnerAddress: string | null;
  /** D2-5: a `regex` rule's `markSeparator`, or null. */
  separator: string | null;
  /** D2-4 (c): the first `withCodes` code on the line, by value, or null; null when the rule has none. */
  withCodeOf: ((masked: string) => string | null) | null;
  /** D2-5: `asksSamePartners`. */
  sameP: boolean;
  /** `codes`: the letters its code ranges start with (upper case); null for the other kinds. */
  letters: ReadonlySet<string> | null;
  /** D2-5: the partner words of `partnerAddress`, read as `sharesBlock` removes them (built once, global); null without an address. */
  partnerWordRe: RegExp | null;
}

function resolveTokens(p: ChannelParams, tokens: readonly string[]): string[] {
  const out: string[] = [];
  for (const token of tokens) {
    const id = resolveChannelToken(p, token)?.id ?? token;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function allIds(p: ChannelParams): string[] {
  return (Array.isArray(p.list) ? p.list : []).map((c) => c.id);
}

function absent(p: ChannelParams, w: WhenAbsent | undefined): { ids: string[]; absent: boolean } {
  if (w?.kind === 'all') return { ids: allIds(p), absent: true };
  if (w?.kind === 'fixed') return { ids: resolveTokens(p, Array.isArray(w.channels) ? w.channels : []), absent: true };
  return { ids: [], absent: true };
}

/**
 * Every word of one address on a masked line, read as the tokenizer reads a word: the
 * letter not preceded by a letter or `_` and not followed by one (so the `P` of `PA=` or
 * of `SPOS` is not a `P` word), blanks allowed before the value, the value up to the next
 * blank, letter, `(` or `;`. `value` is the value text with blanks taken out (`12`, `12.`,
 * `#1`, `[#5]`, or `''` for a bare letter); `text` is the word as written, trimmed.
 * An assignment (`P1=5`) is not a word of the address.
 *
 * M12 review fix NC-08: a value followed by blanks and more digits (`P1 2`) is not read as
 * `P1`: whether the control joins the digits is not known, and gEdit's tokenizer does not,
 * so the whole text is the value, which no decode reads (one unknown piece, reported).
 */
function addressWords(address: string): (masked: string) => { text: string; value: string }[] {
  const re = new RegExp(`(?<![A-Za-z_])${address}(?![A-Za-z_])[ \\t]*([^\\sA-Za-z_(;=]*)((?:[ \\t]+\\d[^\\sA-Za-z_(;=]*)*)`, 'gi');
  const bare = unguardedWordRe(re) as RegExp; // M12 fix F3, see `execAfterNonWord`
  const assigned = /^[ \t]*=/;
  return (masked) => {
    const out: { text: string; value: string }[] = [];
    bare.lastIndex = 0;
    for (let m = execAfterNonWord(bare, masked); m !== null; m = execAfterNonWord(bare, masked)) {
      if (assigned.test(masked.slice(bare.lastIndex))) continue;
      const text = m[0].trim();
      out.push({ text, value: m[2] !== '' ? text : m[1] });
    }
    return out;
  };
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileRule(rule: SyncRule, index: number, p: ChannelParams, cp: CompiledProfile): CompiledRule | null {
  const at = `syncMarks[${index}]`;
  const counted = rule.semantics === 'count';
  let find: CompiledRule['find'];
  let findBefore: CompiledRule['findBefore'];
  let where: CompiledRule['where'] = null;
  let letters: ReadonlySet<string> | null = null;

  const match = rule.match;
  if (match?.kind === 'codes') {
    const parsed = parseWaitCodes(typeof match.codes === 'string' ? match.codes : '');
    const ranges: WaitCodeRange[] = parsed.ranges;
    const re = parsed.errors.length > 0 ? null : waitCodeWordRe(ranges);
    if (re === null) return null;
    // The same search without the lookbehind WebKit runs slowly (M12 fix F3).
    const bare = unguardedWordRe(re) as RegExp;
    letters = new Set(ranges.map((range) => range.letter.toUpperCase()));
    const place = { start: 0, end: 0, letter: '' };
    findBefore = (masked, limit) => {
      bare.lastIndex = 0;
      for (let m = execAfterNonWord(bare, masked); m !== null && m.index < limit; m = execAfterNonWord(bare, masked)) {
        if (isWaitCode(ranges, m[1], Number(m[2]))) {
          place.start = m.index;
          place.end = m.index + m[0].length;
          place.letter = m[1];
          return counted ? '' : waitCodeId(m[1], m[2]);
        }
      }
      return null;
    };
    find = (masked) => findBefore(masked, Infinity);
    where = place;
  } else if (match?.kind === 'prefix') {
    if (typeof match.prefix !== 'string' || match.prefix === '') return null;
    const digits = match.idDigits ? `\\d{${match.idDigits.min},${match.idDigits.max}}` : '\\d+';
    const re = new RegExp(`(?<![A-Za-z_])${escapeRe(match.prefix)}(${digits})(?![\\d.]|[ \\t]*=)`, 'i');
    const pre = lookbehindPrefilter(re);
    const place = { start: 0, end: 0, letter: match.prefix.charAt(0).toUpperCase() };
    const found = (m: RegExpExecArray): string => {
      place.start = m.index;
      place.end = m.index + m[0].length;
      return counted ? '' : m[1];
    };
    find = (masked) => {
      const m = pre !== null && !pre.test(masked) ? null : re.exec(masked);
      return m ? found(m) : null;
    };
    findBefore = (masked, limit) => {
      const m = re.exec(masked);
      return m && m.index < limit ? found(m) : null;
    };
    where = place;
  } else if (match?.kind === 'regex') {
    const compiled = compileChannelPattern(match.pattern, cp.flags, `${at}.match.pattern`);
    if ('problem' in compiled) return null;
    const re = compiled.re;
    const pre = lookbehindPrefilter(re);
    find = (masked) => {
      const m = pre !== null && !pre.test(masked) ? null : re.exec(masked);
      if (!m) return null;
      if (counted) return '';
      const mark = m.groups?.mark;
      return typeof mark === 'string' ? mark.trim() : null;
    };
    // Where the mark itself stands, not where the match starts (a pattern may read the line
    // from its start): the `mark` capture's own position, through the indices flag.
    let indexed: RegExp | null = null;
    findBefore = (masked, limit) => {
      indexed ??= new RegExp(re.source, re.flags.replace(/[gy]/g, '') + (re.flags.includes('d') ? '' : 'd'));
      const m = indexed.exec(masked);
      if (!m) return null;
      const at = m.indices?.groups?.mark?.[0] ?? m.index;
      if (at >= limit) return null;
      if (counted) return '';
      const mark = m.groups?.mark;
      return typeof mark === 'string' ? mark.trim() : null;
    };
  } else return null;

  let partners: CompiledRule['partners'];
  const rp = rule.partners;
  if (rp?.kind === 'fixed') {
    const ids = resolveTokens(p, Array.isArray(rp.channels) ? rp.channels : []);
    partners = () => ({ ids, absent: false });
  } else if (rp?.kind === 'word') {
    if (typeof rp.address !== 'string' || !/^[A-Za-z]$/.test(rp.address)) return null;
    const decode = rp.decode === 'bitmask' ? 'bitmask' : 'digits';
    const read = addressWords(rp.address);
    partners = (masked) => {
      const words = read(masked);
      if (words.length === 0) return absent(p, rp.whenAbsent);
      // `P012` and `P12` are one value (the control reads no leading zero).
      const values = [...new Set(words.map((w) => (/^\d+$/.test(w.value) ? w.value.replace(/^0+(?=\d)/, '') : w.value)))];
      // Two P words that disagree, or one the decode cannot read: one unknown piece, as written.
      if (values.length > 1 || !/^\d+$/.test(values[0])) return { ids: [words.map((w) => w.text).join(' ')], absent: false };
      return { ids: resolveTokens(p, decodePartnerText(values[0], decode)), absent: false };
    };
  } else if (rp?.kind === 'line') {
    const compiled = compileChannelPattern(rp.pattern, cp.flags, `${at}.partners.pattern`);
    if ('problem' in compiled) return null;
    const re = compiled.re;
    const decode: PartnerDecode = rp.decode ?? 'split';
    const separator = typeof rp.separator === 'string' && rp.separator !== '' ? rp.separator : ',';
    partners = (masked) => {
      const text = re.exec(masked)?.groups?.channels;
      if (typeof text !== 'string' || text.trim() === '') return absent(p, rp.whenAbsent);
      return { ids: resolveTokens(p, decodePartnerText(text, decode, separator)), absent: false };
    };
  } else {
    const ids = allIds(p);
    partners = () => ({ ids, absent: false });
  }
  const separator =
    match.kind === 'regex' && !counted && typeof rule.markSeparator === 'string' && rule.markSeparator !== '' ? rule.markSeparator : null;
  return {
    rule,
    find,
    findBefore,
    partners,
    blocking: rule.blocking !== false,
    where,
    partnerAddress: rp?.kind === 'word' ? rp.address.toUpperCase() : null,
    separator,
    withCodeOf: withCodesFinder(rule.withCodes),
    sameP: asksSamePartners(rule),
    letters,
    partnerWordRe: rp?.kind === 'word' ? partnerWordRe(rp.address.toUpperCase()) : null,
  };
}

/** D2-4 (c): a finder for the first code of a plain list on a masked line, by value; null for no (or a broken) list. */
function withCodesFinder(codes: unknown): ((masked: string) => string | null) | null {
  if (typeof codes !== 'string' || codes.trim() === '') return null;
  const parsed = parseWaitCodes(codes);
  const re = parsed.errors.length > 0 ? null : waitCodeWordRe(parsed.ranges);
  if (re === null) return null;
  const bare = unguardedWordRe(re) as RegExp;
  return (masked) => {
    bare.lastIndex = 0;
    for (let m = execAfterNonWord(bare, masked); m !== null; m = execAfterNonWord(bare, masked)) {
      if (isWaitCode(parsed.ranges, m[1], Number(m[2]))) return waitCodeId(m[1], m[2]);
    }
    return null;
  };
}

/**
 * D2-5: whether a wait's block holds anything but the wait code (at `start`..`end`), the words of
 * its partner address, a block-delete slash and a block number. The masked line has its comments
 * blanked, so a comment is not another word.
 */
function sharesBlock(masked: string, start: number, end: number, words: RegExp | null, address: string | null): boolean {
  if (address !== null && isBareWait(masked, start, end, address.charCodeAt(0))) return false;
  let rest = masked.slice(0, start) + ' '.repeat(end - start) + masked.slice(end);
  rest = rest.replace(BLOCK_START, '');
  if (words !== null) rest = rest.replace(words, ' ');
  return HAS_WORD.test(rest);
}

/**
 * The common shape, read without a pattern or a new string: only blanks before the wait code, and
 * after it nothing, or one word of the partner address with plain digits (`M901 P12`), and blanks.
 * Such a block shares nothing. Any other shape is left to the general reading in `sharesBlock`.
 */
function isBareWait(masked: string, start: number, end: number, address: number): boolean {
  for (let i = 0; i < start; i++) {
    const c = masked.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  const n = masked.length;
  let i = end;
  while (i < n && (masked.charCodeAt(i) === 32 || masked.charCodeAt(i) === 9)) i++;
  if (i === n) return true;
  if ((masked.charCodeAt(i) & 0xdf) !== address) return false;
  let j = i + 1;
  while (j < n && masked.charCodeAt(j) >= 48 && masked.charCodeAt(j) <= 57) j++;
  if (j === i + 1) return false;
  while (j < n && (masked.charCodeAt(j) === 32 || masked.charCodeAt(j) === 9)) j++;
  return j === n;
}

const BLOCK_START = /^\s*(?:\/\d?\s*)?(?:N[ \t]*\d+)?/i;
const HAS_WORD = /[A-Za-z0-9#]/;

/** The partner word as `addressWords` reads it, digits after a blank included (`P1 2`, NC-08); global, built once per rule. */
function partnerWordRe(address: string): RegExp {
  return new RegExp(`(?<![A-Za-z_])${address}(?![A-Za-z_])[ \\t]*[^\\sA-Za-z_(;=]*(?:[ \\t]+\\d[^\\sA-Za-z_(;=]*)*`, 'gi');
}

/** D2-5: whether `other` (a rule with a partner word) read a word of its address in front of the mark found at `at`. */
function isPartnerWordOf(others: readonly CompiledRule[], masked: string, at: { start: number; letter: string }): boolean {
  for (const other of others) if (other.partnerAddress === at.letter.toUpperCase() && other.findBefore(masked, at.start) !== null) return true;
  return false;
}

/** What `macroCallCodes` reads of a code database (`CodeDb`). */
type CallCodeSource = { codes: readonly { code: string; call?: boolean }[] };

/** One answer per database object: the store asks on every effective view. */
const callCodesOf = new WeakMap<CallCodeSource, readonly string[]>();

/**
 * T172 (review NC-05): the codes of a code database that call a macro and hand it the words
 * of their block as arguments (`CodeEntry.call`: Fanuc `G65`), for `findMarks`' `calls`.
 * Never a profile list: the database says it, and a control whose `G65` is something else
 * (Okuma: corner control) has no such flag.
 *
 * WX-NC-9b: `call` was written for the macro-argument call (`G65`); since P4b it marks every code
 * that runs another program with the words of its block, and this function takes all of them, not
 * only the ones that read their words as macro arguments (`wordsAreData`). That is intended: a wait
 * code written after any such call on a line is a word handed to the called program, as for `G65`.
 * Only a call written as a letter and a number (`G65`, `G66.1`) is found (`callFinder` reads a call
 * word as it reads a wait word); a call written as a name or a keyword (`CALL`, `<name>`, `CYCL CALL`)
 * has no column and so never hides a wait in front of or behind it.
 */
export function macroCallCodes(db: CallCodeSource | null | undefined): readonly string[] {
  if (db === null || db === undefined) return [];
  const known = callCodesOf.get(db);
  if (known !== undefined) return known;
  const out: string[] = [];
  for (const entry of Array.isArray(db.codes) ? db.codes : []) {
    if (entry.call === true && typeof entry.code === 'string' && !out.includes(entry.code)) out.push(entry.code);
  }
  callCodesOf.set(db, out);
  return out;
}

/** A call code as the control reads it: the letter upper case, the number without leading zeros (`G065` is `G65`). */
function callCodeKey(letter: string, number: string): string {
  return letter.toUpperCase() + number.replace(/^0+(?=\d)/, '');
}

const callFinders = new Map<string, ((masked: string) => number) | null>();

/**
 * The column (0-based) of the first macro call on a masked line, or `Infinity`; null when
 * `calls` names no code that looks like a word (`G65`, `G66.1`). A call word is read as a
 * wait code word is: the letter not after a letter or `_`, blanks allowed before the
 * number, leading zeros not counted, no further digit or point behind it, not an assignment.
 */
function callFinder(calls: readonly string[] | undefined): ((masked: string) => number) | null {
  if (calls === undefined || calls.length === 0) return null;
  const cacheKey = calls.join('\u0001');
  if (callFinders.has(cacheKey)) return callFinders.get(cacheKey) ?? null;
  const keys = new Set<string>();
  const letters = new Set<string>();
  for (const code of calls) {
    const m = /^([A-Za-z])[ \t]*(\d+(?:\.\d+)?)$/.exec(code.trim());
    if (m === null) continue;
    keys.add(callCodeKey(m[1], m[2]));
    letters.add(m[1].toUpperCase());
  }
  let finder: ((masked: string) => number) | null = null;
  if (keys.size > 0) {
    const bare = new RegExp(`([${[...letters].join('')}])[ \\t]*(\\d+(?:\\.\\d+)?)(?![\\d.]|[ \\t]*=)`, 'gi');
    finder = (masked) => {
      bare.lastIndex = 0;
      for (let m = execAfterNonWord(bare, masked); m !== null; m = execAfterNonWord(bare, masked)) {
        if (keys.has(callCodeKey(m[1], m[2]))) return m.index;
      }
      return Infinity;
    };
  }
  if (callFinders.size >= 64) callFinders.clear();
  callFinders.set(cacheKey, finder);
  return finder;
}

const compiledRules = new WeakMap<ChannelParams, Map<string, (CompiledRule | null)[]>>();

function rulesOf(p: ChannelParams, cp: CompiledProfile): (CompiledRule | null)[] {
  let byFlags = compiledRules.get(p);
  if (!byFlags) {
    byFlags = new Map();
    compiledRules.set(p, byFlags);
  }
  let rules = byFlags.get(cp.flags);
  if (!rules) {
    const list = Array.isArray(p.syncMarks) ? p.syncMarks.slice(0, CHANNEL_CAPS.rules) : [];
    rules = list.map((rule, i) => compileRule(rule, i, p, cp));
    byFlags.set(cp.flags, rules);
  }
  return rules;
}

/**
 * The sync marks of a document (§7.17, WP12.1 deliver), in line order. `o.channelOf(line)`
 * says which channel a line is in (`''` outside every section; the document's own channel
 * in `multi-file`). It may answer several channels for a line of a section that several
 * channels share (`+S1/S3/S4`): the line runs in each of them, so the mark is listed once
 * per channel, in the order given; an empty list is `''`. A rule that does not compile
 * finds nothing — WP12.3's validation is what reports it. Every hit has its own `partners`
 * array.
 *
 * M12 review fix CODE-1: the deadline is read on EVERY line (a slow user pattern stops the
 * read after the line it is on, not after 1,024 lines), and a line longer than
 * `CHANNEL_CAPS.lineLength` is never given to a pattern: it is counted in `longLines`.
 */
export function findMarks(
  lines: readonly string[],
  cp: CompiledProfile,
  p: ChannelParams,
  o: { channelOf(line: number): string | readonly string[] } & ChannelBudget & MaskedLines & MacroCalls,
): FindMarksResult {
  const rules = rulesOf(p, cp).filter((r): r is CompiledRule => r !== null);
  const callAt = callFinder(o.calls);
  const stopsAndEnds = p.stopsAndEndsWait === true ? cp.re.outline.filter((r) => r.kind === 'stop' || r.kind === 'end') : [];
  const stopsPre = stopsAndEnds.map((r) => lookbehindPrefilter(r.re));
  // T172: where a stop or end ends, on a line that holds a macro call (a profile pattern may
  // start at the line start, so the end of its match, not its start, says where the word is).
  const stopsAt = stopsAndEnds.map((r) => new RegExp(r.re.source, r.re.flags.replace(/[gy]/g, '')));
  const marks: SyncHit[] = [];
  let dropped = 0;
  let longLines = 0;
  const late = budgetClock(o);
  if (rules.length === 0 && stopsAndEnds.length === 0) return { marks, dropped, abandoned: false, longLines };
  const everyChannel = allIds(p);
  const done = (abandoned: boolean): FindMarksResult => ({ marks, dropped, abandoned, longLines });
  // D2-5: a `codes` mark written after another rule's wait whose partner word has its letter is that
  // word. Only a rule some other rule's partner address can start with has to look for it.
  const partnerRules = rules.map((r) => {
    if (r.rule.match.kind !== 'codes' || r.letters === null) return null;
    const others = rules.filter((other) => other !== r && other.partnerAddress !== null && r.letters!.has(other.partnerAddress));
    return others.length > 0 ? others : null;
  });

  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && late()) return done(true);
    if (lines[i].length > CHANNEL_CAPS.lineLength) {
      longLines++;
      continue;
    }
    const masked = o.masked ? o.masked(i) : maskForMarks(lines[i], cp);
    let hit: Omit<SyncHit, 'channel'> | null = null;
    /** D2-5: the marks of a list rule's line (`SETM(5,6)`), each a hit of its own. */
    let ids: string[] | null = null;
    // T172: read for a macro call only on a line that holds a mark (most lines hold none).
    let limit: number | null = null;
    for (let ri = 0; ri < rules.length; ri++) {
      const r = rules[ri];
      let mark = r.find(masked);
      if (mark === null) continue;
      if (callAt !== null) {
        limit ??= callAt(masked);
        if (limit !== Infinity) mark = r.findBefore(masked, limit);
        if (mark === null) continue;
      }
      if (r.separator !== null) {
        ids = splitChannelTokens(mark, r.separator);
        if (ids.length === 0) {
          ids = null;
          continue;
        }
      } else {
        // `r.where` is where `find` just saw the mark (once per hit; no second scan of the line).
        const others = partnerRules[ri];
        if (others !== null && isPartnerWordOf(others, masked, r.where!)) continue;
      }
      const partners = r.partners(masked);
      hit = { ruleId: r.rule.id, mark, line: i + 1, partners: partners.ids, blocking: r.blocking, ...(partners.absent ? { absent: true as const } : {}) };
      if (r.sameP && r.where !== null && sharesBlock(masked, r.where.start, r.where.end, r.partnerWordRe, r.partnerAddress)) hit.shared = true;
      if (r.withCodeOf !== null) {
        const code = r.withCodeOf(masked);
        if (code !== null) hit.withCode = code;
      }
      break;
    }
    for (let k = 0; hit === null && k < stopsAndEnds.length; k++) {
      const pre = stopsPre[k];
      if ((pre !== null && !pre.test(masked)) || !stopsAndEnds[k].re.test(masked)) continue;
      if (callAt !== null) {
        limit ??= callAt(masked);
        if (limit !== Infinity) {
          const m = stopsAt[k].exec(masked);
          if (m === null || m.index + m[0].length > limit) continue;
        }
      }
      hit = { ruleId: STOPS_AND_ENDS_RULE, mark: '', line: i + 1, partners: everyChannel, blocking: true };
    }
    if (hit === null) continue;
    const at = o.channelOf(i + 1);
    const channels = typeof at === 'string' ? [at] : at.length > 0 ? at : [''];
    for (const channel of channels) {
      const count = ids === null ? 1 : ids.length;
      for (let k = 0; k < count; k++) {
        if (marks.length >= CHANNEL_CAPS.marks) {
          dropped++;
          continue;
        }
        marks.push({ ...hit, mark: ids === null ? hit.mark : ids[k], channel, partners: [...hit.partners] });
      }
    }
  }
  return done(false);
}

/**
 * T172: the codes of the effective code database that call a macro (`macroCallCodes`). A wait
 * code written after one of them on its line is an argument of the call, not a mark. Absent or
 * empty: every wait code is a mark, as before.
 */
export interface MacroCalls {
  calls?: readonly string[];
}

/** The problem for lines too long to read (CODE-1), or none. */
export function longLinesProblem(count: number): ChannelProblem[] {
  return count > 0
    ? [{ path: 'lines', message: { key: 'channels.problems.longLines', params: { count, max: CHANNEL_CAPS.lineLength } } }]
    : [];
}

/** `resolveDocument`'s answer: what the channel service turns into a `ChannelSet`. */
export interface ResolvedDocument {
  /** `none` when nothing matched, the document is no channel file, or the budget ran out. */
  layout: ChannelParams['layout'];
  /** `multi-file`: the channel this document is; null otherwise. */
  self: ChannelRef | null;
  /** `multi-file`: how `self` was found. */
  by: 'fileName' | 'marker' | 'assigned' | null;
  /** `multi-file`: the stem its file name gives (`''` when the name is no channel file). */
  stem: string;
  sections: ChannelSection[];
  outside: { startLine: number; endLine: number }[];
  marks: SyncHit[];
  /** Marks past `CHANNEL_CAPS.marks`, counted. */
  dropped: number;
  problems: ChannelProblem[];
  /** The deadline passed (`layout` is then `none`): the status item says so. */
  abandoned: boolean;
  /** `single-file`: `FindSectionsResult.boundaries`. */
  boundaries?: number[];
  /**
   * T171 (`resolveDocumentGuarded` only): a user pattern ran out of its time budget in the guard
   * worker and was stopped. `layout` is then `none` and `problems` holds the one that names the
   * pattern (`channels.problems.patternStopped`). Not `abandoned`: reading the document again a
   * second later (the service's retry) would stop the same pattern again.
   */
  patternStopped?: true;
}

/**
 * One document resolved the way every caller must resolve it (§7.17; the service, the
 * goldens of `tests/fixtures/channels/resolve/` and the script context read the same answer):
 *
 *  - `single-file`: `findSections`; no section → `layout: 'none'` and no marks (an ordinary
 *    program opened with a multi-channel machine is untouched, X12 c); else the marks, each
 *    keyed to the channel of its line (every channel of a shared section, `''` outside).
 *  - `multi-file`: `documentChannel` (the header marker wins over the file name), or
 *    `o.assigned`, the user's own assignment, which wins over both; no channel → `none`.
 *    The marks are the document's own channel's.
 *  - The budget (`o.deadline`) covers the whole resolution; past it the answer is `none`
 *    with `abandoned` (§7.17: 500 ms per document).
 */
export function resolveDocument(
  baseName: string,
  lines: readonly string[],
  cp: CompiledProfile,
  p: ChannelParams,
  o: ChannelBudget & MacroCalls & MaskedLines & { assigned?: string | null } = {},
): ResolvedDocument {
  const none = (problems: ChannelProblem[], abandoned = false, stem = ''): ResolvedDocument => ({
    layout: 'none',
    self: null,
    by: null,
    stem,
    sections: [],
    outside: [],
    marks: [],
    dropped: 0,
    problems,
    abandoned,
  });
  const cache: (string | undefined)[] = new Array(lines.length);
  const masked = o.masked ?? ((i: number): string => (cache[i] ??= maskForMarks(lines[i], cp)));
  if (p.layout === 'single-file') {
    const found = findSections(lines, cp, p, { ...o, masked });
    if (found.abandoned) return none(found.problems, true);
    if (found.sections.length === 0) return none(found.problems);
    // `findSections` already reported the lines too long to read (`longLines`).
    const m = findMarks(lines, cp, p, { ...o, masked, channelOf: sectionOwners(found.sections) });
    if (m.abandoned) return none(found.problems, true);
    return { layout: 'single-file', self: null, by: null, stem: '', sections: found.sections, outside: found.outside, marks: m.marks, dropped: m.dropped, problems: found.problems, abandoned: false, boundaries: found.boundaries };
  }
  if (p.layout !== 'multi-file') return none([]);
  const doc = documentChannel(baseName, lines, cp, p, o);
  if (doc.abandoned === true) return none(doc.problems, true, doc.stem);
  let self = doc.channel;
  let by: ResolvedDocument['by'] = doc.by;
  if (typeof o.assigned === 'string') {
    const ref = resolveChannelToken(p, o.assigned);
    if (ref !== null) {
      self = ref;
      by = 'assigned';
    }
  }
  if (self === null) return none(doc.problems, false, doc.stem);
  const id = self.id;
  const m = findMarks(lines, cp, p, { ...o, masked, channelOf: () => id });
  if (m.abandoned) return none(doc.problems, true, doc.stem);
  const problems = [...doc.problems, ...longLinesProblem(m.longLines ?? 0)];
  return { layout: 'multi-file', self, by, stem: doc.stem, sections: [], outside: [], marks: m.marks, dropped: m.dropped, problems, abandoned: false };
}

// ---------------------------------------------------------------------------
// T171: the user's own patterns, run first in a Web Worker
// ---------------------------------------------------------------------------
//
// Every pattern of a machine's channel block is the user's (standing rule 15). The save-time
// shape check, the pattern and line length caps and the per-line deadline leave one slow line
// able to stall the editor: a deadline is read between lines, and a match that has begun cannot
// be interrupted. `guardChannelPatterns` runs each of the patterns over the lines in the guard
// worker (`core/regexGuard`) with a time budget; a pattern that runs out of it is stopped there
// and named, and the synchronous reading (`resolveDocument`, `findMarks`) does not start.
// A pattern that comes through has run to the end once over these lines, so the synchronous
// pass meets nothing new.
//
// What is guarded: `sectionStart` and `sectionEnd` (single-file), the `marker` (multi-file, the
// first `CHANNEL_CAPS.markerLines` lines as written), and the pattern of every `regex` match
// and every `line` partner of the sync rules. What is not: the generated matchers (`codes`,
// `prefix`, `word` partners: gEdit builds those and they cannot run away), a pattern with no
// regular-expression syntax in it (a plain literal, `isLiteralPattern`), the `fileName`
// pattern (it reads one file name, not the lines) and the profile's own outline patterns.
// A `line` partner pattern only runs on a line that holds a mark, but the guard runs it over
// every line: a pattern that cannot read ordinary lines in time is stopped, which is the
// stricter and simpler rule.

/** A pattern of the channel block that the guard checks. */
export interface UserPattern {
  /** The JSON path of the pattern in the machine's `params.channels` (`sectionStart`, `syncMarks[1].match.pattern`). */
  path: string;
  pattern: string;
  /** `marker` reads the head of the document as written; all others read the masked lines. */
  reads: 'masked' | 'head';
}

/** The patterns of `p` that `guardChannelPatterns` runs, in the order `resolveDocument` meets them. */
export function userPatterns(p: ChannelParams): UserPattern[] {
  const out: UserPattern[] = [];
  const add = (path: string, pattern: unknown, reads: UserPattern['reads'] = 'masked'): void => {
    // A pattern over the cap is refused at compile (`compileChannelPattern`), not run.
    if (typeof pattern !== 'string' || pattern.length > CHANNEL_CAPS.patternLength || isLiteralPattern(pattern)) return;
    out.push({ path, pattern, reads });
  };
  if (p.layout === 'single-file') {
    add('sectionStart', p.sectionStart);
    add('sectionEnd', p.sectionEnd);
  } else if (p.layout === 'multi-file') {
    add('marker', p.marker, 'head');
  }
  const rules = Array.isArray(p.syncMarks) ? p.syncMarks.slice(0, CHANNEL_CAPS.rules) : [];
  rules.forEach((rule, i) => {
    if (rule?.match?.kind === 'regex') add(`syncMarks[${i}].match.pattern`, rule.match.pattern);
    if (rule?.partners?.kind === 'line') add(`syncMarks[${i}].partners.pattern`, rule.partners.pattern);
  });
  return out;
}

/** A pattern was stopped: the problem that names it (the pattern is shown shortened, as the user wrote it). */
export function patternStoppedProblem(path: string, pattern: string, budgetMs: number): ChannelProblem {
  const shown = pattern.length > 60 ? `${pattern.slice(0, 57)}...` : pattern;
  return {
    path,
    message: { key: 'channels.problems.patternStopped', params: { pattern: shown, seconds: Math.max(1, Math.round(budgetMs / 1000)) } },
  };
}

export type PatternGuard =
  /** `guarded: false` when nothing was checked (no pattern to check, no worker, or the worker broke). */
  | { ok: true; guarded: boolean }
  /** The pattern that ran out of its budget, and the problem that says so. */
  | { ok: false; problem: ChannelProblem };

/**
 * Runs the user's patterns of `p` over `lines` in the guard worker. `lines` may be the whole
 * document or only the lines an edit touched; `o.masked(i)` answers the masked line `i` as
 * `maskForMarks` does (a caller that reads the document afterwards passes the memo it will use,
 * so no line is masked twice). A line longer than `CHANNEL_CAPS.lineLength` is not sent: the
 * readers never give it to a pattern.
 */
export async function guardChannelPatterns(
  runner: GuardRunner | null,
  lines: readonly string[],
  cp: CompiledProfile,
  p: ChannelParams,
  o: MaskedLines & { budgetMs?: number } = {},
): Promise<PatternGuard> {
  const patterns = userPatterns(p);
  if (runner === null || patterns.length === 0) return { ok: true, guarded: false };
  const budgetMs = o.budgetMs ?? GUARD_BUDGET_MS;
  const probe = (u: UserPattern): GuardProbe => ({ id: u.path, pattern: u.pattern, flags: cp.flags, scan: 'first' });
  const readable = (i: number): boolean => lines[i].length <= CHANNEL_CAPS.lineLength;
  let guarded = false;
  const jobs: { patterns: UserPattern[]; lines: () => string[] }[] = [
    {
      patterns: patterns.filter((u) => u.reads === 'masked'),
      lines: () => lines.map((line, i) => (readable(i) ? (o.masked ? o.masked(i) : maskForMarks(line, cp)) : '')),
    },
    {
      patterns: patterns.filter((u) => u.reads === 'head'),
      lines: () => lines.slice(0, CHANNEL_CAPS.markerLines).map((line, i) => (readable(i) ? line : '')),
    },
  ];
  for (const job of jobs) {
    if (job.patterns.length === 0) continue;
    const verdict = await guardJob(runner, { probes: job.patterns.map(probe), lines: job.lines() }, budgetMs);
    if (!verdict.ok) {
      const stopped = job.patterns.find((u) => u.path === verdict.probe) ?? job.patterns[0];
      return { ok: false, problem: patternStoppedProblem(stopped.path, stopped.pattern, verdict.budgetMs) };
    }
    guarded ||= verdict.guarded;
  }
  return { ok: true, guarded };
}

/**
 * `resolveDocument` after the guard (T171): the patterns of `p` run in the worker first. A
 * pattern that is stopped there leaves `layout: 'none'` with `patternStopped` and its problem,
 * and nothing is read on the editor's thread. Otherwise the answer is `resolveDocument`'s. Its
 * budget (`o.resolveMs`, default `CHANNEL_CAPS.resolveMs`) is counted from after the guard, so
 * the wait for the worker does not eat the time of the synchronous pass.
 */
export async function resolveDocumentGuarded(
  runner: GuardRunner | null,
  baseName: string,
  lines: readonly string[],
  cp: CompiledProfile,
  p: ChannelParams,
  o: Pick<ChannelBudget, 'now'> & MacroCalls & { assigned?: string | null; resolveMs?: number; budgetMs?: number } = {},
): Promise<ResolvedDocument> {
  const cache: (string | undefined)[] = new Array(lines.length);
  const masked = (i: number): string => (cache[i] ??= maskForMarks(lines[i], cp));
  const guard = await guardChannelPatterns(runner, lines, cp, p, { masked, budgetMs: o.budgetMs });
  if (!guard.ok) {
    return { layout: 'none', self: null, by: null, stem: '', sections: [], outside: [], marks: [], dropped: 0, problems: [guard.problem], abandoned: false, patternStopped: true };
  }
  const now = o.now ?? ((): number => performance.now());
  return resolveDocument(baseName, lines, cp, p, {
    calls: o.calls,
    assigned: o.assigned,
    now,
    masked,
    deadline: now() + (o.resolveMs ?? CHANNEL_CAPS.resolveMs),
  });
}

/**
 * Which channels hold a line, as a lookup for lines asked in increasing order (as
 * `findMarks` asks): the section ranges cut into segments with one owner list each, so a
 * 300k-line document costs one entry per range, not one per line.
 */
export function sectionOwners(sections: readonly ChannelSection[]): (line: number) => readonly string[] {
  // A sweep over the range ends: at most 32 channels are open at once, so a document with
  // thousands of alternating sections stays linear.
  const events: { at: number; index: number; delta: 1 | -1 }[] = [];
  for (const s of sections) {
    for (const r of s.ranges) {
      events.push({ at: r.startLine, index: s.channel.index, delta: 1 }, { at: r.endLine + 1, index: s.channel.index, delta: -1 });
    }
  }
  events.sort((a, b) => a.at - b.at);
  const idOf = new Map(sections.map((s) => [s.channel.index, s.channel.id]));
  const open = new Map<number, number>();
  const segments: { start: number; end: number; ids: string[] }[] = [];
  for (let k = 0; k < events.length; ) {
    const at = events[k].at;
    for (; k < events.length && events[k].at === at; k++) {
      const e = events[k];
      const n = (open.get(e.index) ?? 0) + e.delta;
      if (n > 0) open.set(e.index, n);
      else open.delete(e.index);
    }
    if (open.size > 0 && k < events.length) {
      const ids = [...open.keys()].sort((a, b) => a - b).map((index) => idOf.get(index) ?? '');
      segments.push({ start: at, end: events[k].at - 1, ids });
    }
  }
  let at = 0;
  const empty: readonly string[] = [];
  return (line) => {
    if (at > 0 && segments[at - 1] && line < segments[at - 1].start) at = 0;
    while (at < segments.length && segments[at].end < line) at++;
    const seg = segments[at];
    return seg && seg.start <= line ? seg.ids : empty;
  };
}
