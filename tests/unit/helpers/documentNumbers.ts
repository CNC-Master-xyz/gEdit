// `documentNumbers` (the fast reading) against `documentNumbersByTokens` (the definition), shared by
// `documentNumbers.test.ts` and `documentNumbers.slow.test.ts` in src/lib/core/templates.

import { expect } from 'vitest';
import { documentNumbers, documentNumbersByTokens } from '../../../src/lib/core/templates/blockNumbers';

export function sameAsTokens(lines: string[], cp: Parameters<typeof documentNumbers>[1], what: string): void {
  const fast = documentNumbers(lines, cp);
  const slow = documentNumbersByTokens(lines, cp);
  // Maps in insertion order: the first line of each number and the word a reference was written as.
  expect([...fast.blocks], what).toEqual([...slow.blocks]);
  expect([...fast.referenced], what).toEqual([...slow.referenced]);
  expect(fast.max, what).toBe(slow.max);
  // Without the block numbers: the referenced numbers are the same, and the block numbers are not read.
  const refs = documentNumbers(lines, cp, false);
  expect([...refs.referenced], what).toEqual([...slow.referenced]);
  if (refs.withBlocks) expect([...refs.blocks], what).toEqual([...slow.blocks]);
  else {
    expect(refs.blocks.size, what).toBe(0);
    expect(refs.max, what).toBeNull();
  }
}
