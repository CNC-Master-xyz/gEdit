// The cost of applying a 100,000-line rewrite (a wall-clock budget).
// What lands in the model is in `applyLines.test.ts` (same folder).

import { describe, expect, it } from 'vitest';
import { FakeModel, linesOf } from '../../../tests/unit/helpers/fakeEditableModel';
import { CHUNK_LINES, applyLinesTo } from './applyLines';

describe('planLineEdits: chunking', () => {
  it('chunks a real 100k-line rewrite into a bounded number of operations', () => {
    const size = 100_000;
    const oldLines = Array.from({ length: size }, (_, i) => `N${i * 10} G1 X${i}`);
    const newLines = oldLines.map((line) => line.replace('G1', 'G01'));
    const model = new FakeModel(oldLines.join('\n'));
    const started = performance.now();
    const result = applyLinesTo(model, 1, size, newLines);
    const elapsed = performance.now() - started;
    expect(result.changedLines).toBe(size);
    expect(model.batches[0].length).toBeLessThanOrEqual(Math.ceil(size / CHUNK_LINES));
    expect(linesOf(model.text)).toEqual(newLines);
    // G7 budget for the apply step is 2 s; the plan itself has to be far cheaper.
    expect(elapsed).toBeLessThan(2000);
  });
});
