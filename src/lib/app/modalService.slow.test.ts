// The cost of one idle slice of the modal service on a 300,000-line document (a wall-clock budget).
// The service's behaviour is in `modalService.test.ts` (same folder).

import { describe, expect, it } from 'vitest';
import { expectWithin } from '../../../tests/unit/helpers/budget';
import { KLARTEXT, harness, klartextProgram, program } from '../../../tests/unit/helpers/modalServiceHarness';

describe('the modal service', () => {
  it('P3.4: one idle slice of a 300k-line document returns within 8 ms plus the line it is on (wall clock, median of seven)', () => {
    const h = harness();
    h.add(program(300_000));
    h.idleOnce(); // warm up (regexes compile on first use)
    const runs: number[] = [];
    for (let i = 0; i < 7; i++) {
      const started = performance.now();
      h.idleOnce();
      runs.push(performance.now() - started);
    }
    expect(h.idlePending(), 'the build is far from done after eight slices').toBe(1);
    runs.sort((a, b) => a - b);
    expectWithin(runs[3], 8 + 4, 'one idle slice, median of seven');
  });
  // T170 (BL-perf-editor): the runtime scenario `p3-perf` measured the Klartext index of 300,000 lines at 1.4 to 2.0 s
  // of work and 2.8 to 3.7 s until it was ready, the rest being the timer a frame away between two 8 ms slices (the
  // macOS web view has no idle callback). The build itself is the same here, with the real timers of node.
  it('T170: the modal index of 300,000 Klartext lines is ready sooner with chained slices than with a frame between them (wall clock)', async () => {
    const text = klartextProgram(300_000);
    async function readyAfterMs(real: 'idle' | 'chained'): Promise<number> {
      const h = harness({ real });
      const id = h.add(text);
      h.views.set(id, KLARTEXT);
      h.machineRevision.update((n) => n + 1); // the document is read as Klartext: the index starts over
      const started = performance.now();
      await h.service.whenReady(id);
      const ms = performance.now() - started;
      expect(h.service.stateAfter(id, text.length), 'the index reaches the last line').not.toBeNull();
      h.stop();
      return ms;
    }
    const chained = await readyAfterMs('chained');
    const gapped = await readyAfterMs('idle');
    console.log(`T170 modal index of 300,000 Klartext lines: ready after ${Math.round(chained)} ms chained, ${Math.round(gapped)} ms with a frame between slices`);
    expect(chained, 'chained slices').toBeLessThan(8000); // the budget of p3-perf
    expect(chained, 'chained slices against a frame between them').toBeLessThan(gapped);
  }, 90_000);
});
