// Auto-space (Phase 4 plan §6.5 rule 1, X26). The goldens of the six built-in profiles live in
// `tests/fixtures/p4c/typing/autospace.json`, one row per case; the decision with upper case is below them.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decideTyping, letterKeyOf, wantsSpaceBefore } from './autoSpace';
import { decideUppercase, type TypingSite } from './typing';
import { tokenizeLine } from './tokenizer';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import type { CompiledProfile } from '$lib/core/profiles/types';
import { cpOf } from '../../../../tests/unit/helpers/profiles';

interface Row {
  profile: string;
  before: string;
  ch: string;
  after: string;
  previousLine: string | null;
  space: boolean;
  why: string;
}

const ROWS: Row[] = JSON.parse(
  readFileSync(new URL('../../../../tests/fixtures/p4c/typing/autospace.json', import.meta.url), 'utf8'),
).rows;

const compiled = new Map<string, CompiledProfile>();
const cp = (id: string): CompiledProfile => {
  let found = compiled.get(id);
  if (!found) compiled.set(id, (found = cpOf(id)));
  return found;
};

const site = (before: string, after = '', previousLine: string | null = null): TypingSite => ({ before, after, previousLine });

describe('the goldens (X26)', () => {
  it('cover every built-in profile, each with a space and a no-space row', () => {
    const ids = BUILTIN_PROFILE_JSON.map((p) => (p as { id: string }).id).sort();
    expect(ids).toEqual(['fanuc-gcode', 'fanuc-lathe', 'heidenhain-klartext', 'okuma-osp', 'sinumerik', 'sinumerik-mill']);
    for (const id of ids) {
      expect(ROWS.some((r) => r.profile === id && r.space), id).toBe(true);
      expect(ROWS.some((r) => r.profile === id && !r.space), id).toBe(true);
    }
  });

  it.each(ROWS.map((r) => [`${r.profile}: ${JSON.stringify(r.before)} + ${r.ch} — ${r.why}`, r] as const))('%s', (_name, row) => {
    expect(wantsSpaceBefore(site(row.before, row.after, row.previousLine), row.ch, cp(row.profile))).toBe(row.space);
  });
});

describe('the rule', () => {
  const FANUC = cp('fanuc-gcode');
  const KLARTEXT = cp('heidenhain-klartext');

  it('types G1X as G1 X, N10G as N10 G and G1X5.Y as G1 X5. Y', () => {
    expect(wantsSpaceBefore(site('G1'), 'X', FANUC)).toBe(true);
    expect(wantsSpaceBefore(site('N10'), 'G', FANUC)).toBe(true);
    expect(wantsSpaceBefore(site('G1 X5.'), 'Y', FANUC)).toBe(true);
  });

  it('Klartext: X+10 then Y gives a space, because its words must be separated', () => {
    expect(KLARTEXT.profile.syntax.wordSeparatorRequired).toBe(true);
    expect(wantsSpaceBefore(site('5 L X+10'), 'Y', KLARTEXT)).toBe(true);
  });

  it('reads a comment that the letter is typed into, even when the comment closes after the cursor', () => {
    expect(wantsSpaceBefore(site('G1 X1.(A', ')'), 'B', FANUC)).toBe(false);
  });

  it('reads the line above for the continuation state only: a Klartext tail is read as a tail', () => {
    // Without the line above, `  Y+5` is still read the same way; the state must not break the decision.
    expect(wantsSpaceBefore(site('  Y+5', '', '5 L X+10 ~'), 'R', KLARTEXT)).toBe(true);
    expect(wantsSpaceBefore(site('  Y+5', '', '5 L X+10'), 'R', KLARTEXT)).toBe(true);
  });

  it('when the tokenizer cannot tell, no space: a character that is not a letter, or two characters', () => {
    expect(wantsSpaceBefore(site('G1'), '1', FANUC)).toBe(false);
    expect(wantsSpaceBefore(site('G1'), '#', FANUC)).toBe(false);
    expect(wantsSpaceBefore(site('G1'), 'XY', FANUC)).toBe(false);
    expect(wantsSpaceBefore(site('G1'), '', FANUC)).toBe(false);
    // A letter after a tab or a no-break space is after white space.
    expect(wantsSpaceBefore(site('G1\t'), 'X', FANUC)).toBe(false);
    expect(wantsSpaceBefore(site('G1 '), 'X', FANUC)).toBe(false);
  });
});

describe('Klartext: the name behind SEL PGM, SEL CYCLE, SEL TABLE, SEL PATTERN, SEL CORR-TABLE (NC-7)', () => {
  const KLARTEXT = cp('heidenhain-klartext');
  const SELECTS = ['SEL PGM', 'SEL CYCLE', 'SEL TABLE', 'SEL PATTERN', 'SEL CORR-TABLE'];

  // The goldens: a letter typed into the name continues it, the way it does behind CALL PGM.
  const ROWS_NC7: Row[] = [
    ...SELECTS.map((sel) => ({ profile: 'heidenhain-klartext', before: `5 ${sel} SUB1`, ch: 'A', after: '', previousLine: null, space: false, why: `${sel}: the name goes on` })),
    { profile: 'heidenhain-klartext', before: '5 SEL PGM X1', ch: 'B', after: '', previousLine: null, space: false, why: 'a name that looks like an axis word' },
    { profile: 'heidenhain-klartext', before: '5 SEL TABLE TNC:\\TABLE\\T1', ch: 'A', after: '', previousLine: null, space: false, why: 'a path' },
    { profile: 'heidenhain-klartext', before: '5 CALL PGM SUB1', ch: 'A', after: '', previousLine: null, space: false, why: 'CALL PGM, as before' },
  ];
  it.each(ROWS_NC7.map((r) => [`${JSON.stringify(r.before)} + ${r.ch} — ${r.why}`, r] as const))('%s', (_name, row) => {
    expect(wantsSpaceBefore(site(row.before, row.after, row.previousLine), row.ch, cp(row.profile))).toBe(row.space);
  });

  it('the tokenizer reads the name as one text token, and SEL PGM stays the keyword', () => {
    for (const sel of SELECTS) {
      const line = `5 ${sel} X1B`;
      const tokens = tokenizeLine(line, KLARTEXT).tokens;
      const text = tokens.filter((t) => t.kind === 'text');
      expect(text.map((t) => [t.text, t.start]), sel).toEqual([['X1B', line.length - 3]]);
      // No axis word in the name (before the row, `X1` and `B` were read as two).
      expect(tokens.some((t) => t.kind === 'word' && t.start >= line.length - 3), sel).toBe(false);
    }
    expect(tokenizeLine('5 SEL PGM SUB1', KLARTEXT).tokens.find((t) => t.kind === 'keyword')?.text).toBe('SEL PGM');
  });

  it('a word behind the name is read as usual: the rule still spaces real words', () => {
    expect(wantsSpaceBefore(site('5 L X+10'), 'Y', KLARTEXT)).toBe(true);
    expect(wantsSpaceBefore(site('5 L IX+10'), 'Y', KLARTEXT)).toBe(true);
  });
});

describe('Sinumerik: the exponent of a number (NC-8)', () => {
  const SINUMERIK = cp('sinumerik');
  const MILL = cp('sinumerik-mill');
  const FANUC = cp('fanuc-gcode');

  it('no space before the E of EX after a number: 1.5EX3 is one value', () => {
    expect(SINUMERIK.profile.syntax.exponentMarker).toBe('EX');
    expect(wantsSpaceBefore(site('G1 X1.5'), 'E', SINUMERIK)).toBe(false);
    expect(wantsSpaceBefore(site('G1 X2'), 'E', SINUMERIK)).toBe(false);
    expect(wantsSpaceBefore(site('G1 X1.5'), 'e', SINUMERIK)).toBe(false);
    expect(wantsSpaceBefore(site('G1 X1.5'), 'E', MILL)).toBe(false);
    // Then the X of EX, and the digits, need nothing either.
    expect(wantsSpaceBefore(site('G1 X1.5E'), 'X', SINUMERIK)).toBe(false);
  });

  it('other letters after a number still get their space; after a block number E is a word as before', () => {
    expect(wantsSpaceBefore(site('G1 X1.5'), 'Y', SINUMERIK)).toBe(true);
    expect(wantsSpaceBefore(site('G1 X1.5'), 'F', SINUMERIK)).toBe(true);
    expect(wantsSpaceBefore(site('N10'), 'E', SINUMERIK)).toBe(wantsSpaceBefore(site('N10'), 'F', SINUMERIK));
  });

  it('a profile without an exponent marker is unchanged', () => {
    expect(FANUC.profile.syntax.exponentMarker).toBeUndefined();
    expect(wantsSpaceBefore(site('G1 X1.5'), 'E', FANUC)).toBe(wantsSpaceBefore(site('G1 X1.5'), 'F', FANUC));
  });
});

describe('the letter key', () => {
  it('takes a plain letter in either case (Shift and Caps Lock are typing) and nothing else', () => {
    expect(letterKeyOf({ key: 'x' })).toBe('x');
    expect(letterKeyOf({ key: 'X', shiftKey: true })).toBe('X');
    expect(letterKeyOf({ key: 'x', ctrlKey: true })).toBeNull();
    expect(letterKeyOf({ key: 'x', altKey: true })).toBeNull();
    expect(letterKeyOf({ key: 'x', metaKey: true })).toBeNull();
    expect(letterKeyOf({ key: 'a', keyCode: 229 })).toBeNull();
    expect(letterKeyOf({ key: 'a', isComposing: true })).toBeNull();
    expect(letterKeyOf({ key: 'a' }, true)).toBeNull();
    expect(letterKeyOf({ key: 'Dead' })).toBeNull();
    expect(letterKeyOf({ key: 'Enter' })).toBeNull();
    expect(letterKeyOf({ key: '5' })).toBeNull();
    expect(letterKeyOf({ key: 'ß' })).toBeNull();
  });
});

describe('the decision with upper case (one undo step, perCursor)', () => {
  const FANUC = cp('fanuc-gcode');
  const both = { uppercase: true, autoSpace: true };

  it('forceUppercase on: one type command carries the space and the capital', () => {
    expect(decideTyping({ key: 'x' }, [site('G1')], FANUC, both)).toEqual({ kind: 'type', text: ' X' });
  });

  it('forceUppercase off: the space and the letter as typed', () => {
    expect(decideTyping({ key: 'x' }, [site('g1')], FANUC, { uppercase: false, autoSpace: true })).toEqual({ kind: 'type', text: ' x' });
    expect(decideTyping({ key: 'X', shiftKey: true }, [site('G1')], FANUC, { uppercase: false, autoSpace: true })).toEqual({
      kind: 'type',
      text: ' X',
    });
  });

  it('an upper-case key with upper case on still gets its space', () => {
    expect(decideTyping({ key: 'X', shiftKey: true }, [site('G1')], FANUC, both)).toEqual({ kind: 'type', text: ' X' });
  });

  it('leaves a key that needs nothing to the editor', () => {
    expect(decideTyping({ key: 'X' }, [site('G1 ')], FANUC, both)).toEqual({ kind: 'pass' });
    expect(decideTyping({ key: 'x' }, [site('(note ')], FANUC, both)).toEqual({ kind: 'pass' });
    expect(decideTyping({ key: 'x', ctrlKey: true }, [site('G1')], FANUC, both)).toEqual({ kind: 'pass' });
    expect(decideTyping({ key: 'x' }, [site('G1')], FANUC, both, true)).toEqual({ kind: 'pass' });
    expect(decideTyping({ key: 'x' }, [], FANUC, both)).toEqual({ kind: 'pass' });
    expect(decideTyping({ key: 'x' }, [site('G1')], FANUC, { uppercase: false, autoSpace: false })).toEqual({ kind: 'pass' });
  });

  it('is exactly decideUppercase with auto-space off', () => {
    for (const [key, before] of [
      ['x', 'G1'],
      ['x', 'G1 '],
      ['x', '(note '],
      ['X', 'G1'],
      ['5', 'G1'],
    ] as const) {
      const sites = [site(before)];
      expect(decideTyping({ key }, sites, FANUC, { uppercase: true, autoSpace: false })).toEqual(decideUppercase({ key }, sites, FANUC, true));
    }
  });

  it('decides each cursor on its own', () => {
    // One cursor after G1 (space and capital), one after a blank (capital), one in a comment (as typed).
    expect(decideTyping({ key: 'x' }, [site('G1'), site('G1 '), site('(note ')], FANUC, both)).toEqual({
      kind: 'perCursor',
      texts: [' X', 'X', 'x'],
    });
    // With upper case off, only the space differs.
    expect(decideTyping({ key: 'x' }, [site('G1'), site('G1 ')], FANUC, { uppercase: false, autoSpace: true })).toEqual({
      kind: 'perCursor',
      texts: [' x', 'x'],
    });
    // Every cursor the same: one type command.
    expect(decideTyping({ key: 'x' }, [site('G1'), site('N20 G2')], FANUC, both)).toEqual({ kind: 'type', text: ' X' });
  });
});
