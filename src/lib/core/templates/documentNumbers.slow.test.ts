// The cost of `documentNumbers` at 300,000 lines, in time (wall-clock budgets). The readings it
// must equal are in `documentNumbers.test.ts`; the tokenizer calls are counted in `documentNumbers.calls.test.ts`.

import { describe, it } from 'vitest';
import { expectWithin, fastest } from '../../../../tests/unit/helpers/budget';
import { sameAsTokens } from '../../../../tests/unit/helpers/documentNumbers';
import { cpOf } from '../../../../tests/unit/helpers/profiles';
import { documentNumbers, documentNumbersByTokens } from './blockNumbers';

describe('the cost at 300,000 lines', () => {
  const sizes = 300_000;
  // Each measurement holds the worker for seconds on a slow runner; a macrotask between them lets
  // the worker answer the runner's messages (a worker that never yields fails the whole run with
  // "Timeout calling onTaskUpdate", every test passed).
  const breathe = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  const program = (cp: string): string[] => {
    const lines: string[] = ['%', 'O1000 (SHOP)'];
    for (let i = 0; lines.length < sizes; i++) {
      lines.push(`N${(i + 1) * 10} G1 X${(i % 100) + 0.123} Y${i % 50}.5 F1200.`);
      // Some of the lines a real program has that the fast reading hands to the tokenizer.
      if (i % 40 === 0) lines.push(cp === 'okuma-osp' ? 'G85 NLAP1 D3 F0.3' : 'M98 P1000 (SUB)');
      if (i % 25 === 0) lines.push('(OPERATION 2: FINISH)');
    }
    return lines;
  };

  for (const id of ['fanuc-gcode', 'okuma-osp', 'sinumerik']) {
    // That the fast reading leaves most lines out of the tokenizer is pinned by count in
    // documentNumbers.calls.test.ts; here only the time, against the frame budget. A ratio to the
    // tokenizer (3x) is noise on a shared runner: 2.98x failed a CI run while the count held.
    it(`${id}: well inside a frame budget`, async () => {
      const cp = cpOf(id);
      const lines = program(id);
      documentNumbers(lines, cp);
      let fast = Infinity;
      for (let round = 0; round < 3; round++) {
        await breathe();
        const started = performance.now();
        documentNumbers(lines, cp);
        fast = Math.min(fast, performance.now() - started);
      }
      expectWithin(fast, 300, `documentNumbers on ${lines.length} ${id} lines`);
      await breathe();
      sameAsTokens(lines, cp, `${id} 300k`);
    });
  }

  // FZ-02: a letter the gate looks for (a P, a GOTO, an N) in a comment on every line must not send every line to the tokenizer.
  const commented: Record<string, string> = {
    'fanuc-gcode': 'N10 G1 X1.5 Z-2. F0.2 (SPINDLE STOP)',
    'okuma-osp': 'N10 G1 X1.5 Z-2. (CONTOUR)',
    sinumerik: 'N10 G1 X1.5 Z-2. ; contour',
  };
  for (const [id, line] of Object.entries(commented)) {
    it(`${id}: a gate letter in a comment on every line costs no tokenizer pass`, async () => {
      const cp = cpOf(id);
      const lines = Array.from({ length: sizes }, (_, i) => `${line.replace('N10', `N${(i + 1) * 10}`)}`);
      // The tokenizer reading is only for the failure message (the ratio to it is not asserted), so it runs once.
      documentNumbers(lines.slice(0, 2000), cp);
      let fast = Infinity;
      for (let round = 0; round < 3; round++) {
        await breathe();
        fast = Math.min(fast, fastest(1, () => void documentNumbers(lines, cp)));
      }
      await breathe();
      const startedSlow = performance.now();
      documentNumbersByTokens(lines, cp);
      const slow = performance.now() - startedSlow;
      // That no line goes to the tokenizer is pinned by count in documentNumbers.calls.test.ts; here the
      // time, against the frame budget. A ratio to the tokenizer (2x) is noise on a shared runner: 1.9x
      // there failed the release run of v1.0.0 while the call count stayed 0.
      expectWithin(fast, 300, `documentNumbers on ${lines.length} commented ${id} lines (tokenizer ${slow.toFixed(0)} ms)`);
      sameAsTokens(lines.slice(0, 5000), cp, `${id} commented`);
    });
  }
});
