// The cost of the program map of a big program with channels after an edit (a wall-clock budget).
// What the map holds is in `outlineService.test.ts` (same folder).

import { writable } from 'svelte/store';
import { describe, it } from 'vitest';
import { expectWithin, fastest } from '../../../tests/unit/helpers/budget';
import { big, harness } from '../../../tests/unit/helpers/outlineHarness';

describe('the program map of a big program with channels (M12 performance fix F1)', () => {
  it('publishes the grouped map of 300k lines with 20,000 waits after an edit within the outline budget (G7)', () => {
    const { lines, set } = big(150_000);
    const h = harness({ channels: { forDoc: () => set, revision: writable(0), ruleLabel: () => '' }, chunkLines: 20_000 });
    const id = h.add(lines.join('\n'));
    h.flush();
    let n = 0;
    const ms = fastest(3, () => {
      h.edit(id, 20_000 + (n++ % 2), n % 2 === 0 ? 'T09 M6' : 'G01 X1.');
      h.flush();
    });
    // The index's own aggregation is P1's; the grouping and the row reuse add little to it.
    expectWithin(ms, 200, 'grouped map after an edit, 300k lines, 20,000 waits');
  });
});
