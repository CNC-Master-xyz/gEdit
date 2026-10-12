// The fast reading of a program's block numbers (`documentNumbers`, P3b fix H, plan §7 #287,
// known gap 23) gives what the tokenizer gives: `documentNumbersByTokens` is the definition.
// Random lines hard on the head of a block, every built-in profile and variants of them, and the
// committed fixture programs; then the cost in tokenizer calls (`documentNumbers.calls.test.ts`) and in
// time at 300,000 lines (`documentNumbers.slow.test.ts`).

import { describe, expect, it } from 'vitest';
import { listFixtures, openFixture } from '../../../../tests/unit/helpers/fixtures';
import { cpOf } from '../../../../tests/unit/helpers/profiles';
import { sameAsTokens as same } from '../../../../tests/unit/helpers/documentNumbers';
import { profilesToRead, random, randomLine, randomLines } from '../../../../tests/unit/helpers/randomNc';
import { documentNumbers, documentNumbersByTokens } from './blockNumbers';

describe('documentNumbers equals the tokenizer reading', () => {
  for (const [name, cp] of profilesToRead()) {
    it(`${name}: random programs and every random line alone`, () => {
      const next = random(2026);
      let blocks = 0;
      let referenced = 0;
      for (let p = 0; p < 150; p++) {
        const lines = Array.from({ length: 1 + Math.floor(next() * 60) }, () => randomLine(next));
        same(lines, cp, `${name} program ${p}: ${JSON.stringify(lines)}`);
        const found = documentNumbersByTokens(lines, cp);
        blocks += found.blocks.size;
        referenced += found.referenced.size;
      }
      for (const line of randomLines(5, 1500)) same([line], cp, `${name}: ${JSON.stringify(line)}`);
      // The generator reaches what the scan is about (a profile without block numbers finds none).
      if (cp.profile.numbering?.mode !== 'consecutive') expect(blocks).toBeGreaterThan(100);
      if (cp.re.references.length > 0 && cp.profile.numbering?.mode !== 'consecutive') expect(referenced).toBeGreaterThan(5);
    });
  }

  it('the fixture programs, each read with every built-in profile', () => {
    const profiles = profilesToRead().slice(0, 6);
    let read = 0;
    for (const rel of listFixtures('nc')) {
      if (rel.startsWith('nc/owner-public/') || rel.includes('/encoding/')) continue;
      const opened = openFixture(rel.replace(/^nc\//, 'nc/'));
      if (opened.refused !== null) continue;
      const lines = opened.text.split('\n');
      for (const [name, cp] of profiles) same(lines, cp, `${rel} as ${name}`);
      read++;
    }
    expect(read).toBeGreaterThan(20);
  });

  it('the committed owner-public programs, each read with its own profile', () => {
    let lines = 0;
    for (const rel of listFixtures('nc/owner-public')) {
      const folder = rel.split('/')[2];
      if (folder === 'heidenhain-klartext') continue; // consecutive numbering: nothing is scanned
      const opened = openFixture(rel);
      if (opened.refused !== null) continue;
      const all = opened.text.split('\n');
      same(all, cpOf(folder), rel);
      lines += all.length;
    }
    expect(lines).toBeGreaterThan(100_000);
  });
});

describe('what it answers (hand-written program)', () => {
  const fanuc = cpOf('fanuc-lathe');
  it('block numbers by value with the first line, the highest one, and what P and Q name', () => {
    const lines = ['%', 'O1000', 'N10 G50 S2000', 'N0020 G0 X50.', '/N30 G71 P100 Q200 U0.4', 'N100 G0 X16.', 'N200 G1 Z-10.', 'N020 M30', 'GOTO 70'];
    const doc = documentNumbers(lines, fanuc);
    expect([...doc.blocks].map(([k, v]) => `${k}@${v.line}`)).toEqual(['10@3', '20@4', '30@5', '100@6', '200@7']);
    expect(doc.max).toBe(200);
    expect(doc.referenced.get('100')).toEqual({ line: 5, word: 'P100' });
    expect(doc.referenced.get('200')).toEqual({ line: 5, word: 'Q200' });
  });

  it('an Okuma sequence name and the G85 that names it, as text', () => {
    const lines = ['$O1.MIN%', 'N0010 G50 S2500', 'NLAP1 G81', 'G0 X16', 'G80', 'N20 G85 NLAP1 D3 F0.3', '(NEXT NOTE)'];
    const doc = documentNumbers(lines, cpOf('okuma-osp'));
    expect([...doc.blocks].map(([k, v]) => `${k}@${v.line}`)).toEqual(['N0010@2', 'NLAP1@3', 'N20@6']);
    expect(doc.max).toBe(20);
  });

  it('a consecutive profile (Klartext) has no numbers to avoid', () => {
    const doc = documentNumbers(['0 BEGIN PGM T1 MM', '1 L X+0', '2 END PGM T1 MM'], cpOf('heidenhain-klartext'));
    expect(doc.blocks.size).toBe(0);
    expect(doc.max).toBeNull();
  });
});
