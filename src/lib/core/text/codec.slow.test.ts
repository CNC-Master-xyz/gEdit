// The cost of decoding a 120,000-line, 5 MB file (a wall-clock budget).
// What decoding and encoding do is in `codec.test.ts` (same folder).

import { describe, expect, it } from 'vitest';
import { generateLarge } from '../../../../tests/gen/gen-large.mjs';
import { expectWithin } from '../../../../tests/unit/helpers/budget';
import { decodeFile } from './codec';

describe('a big file', () => {
  const text = generateLarge({ lines: 120_000, dialect: 'fanuc', mb: 5 });
  const bytes = new TextEncoder().encode(text);

  it('decodes in 200 ms or less', () => {
    let best = Infinity;
    for (let run = 0; run < 3; run++) {
      const started = performance.now();
      const decoded = decodeFile(bytes);
      const took = performance.now() - started;
      expect(decoded.ok && decoded.eol).toBe('crlf');
      best = Math.min(best, took);
    }
    expectWithin(best, 200, 'decode of 5 MB');
  });
});
