// The cost of reading a queued 100,000-line model line by line (a wall-clock budget).
// The service itself is in `editorService.test.ts` (same folder).

import { describe, expect, it } from 'vitest';
import { createDocumentStore } from '$lib/stores/documents';
import type { Monaco } from '$lib/monaco/setup';
import { createEditorService } from './editorService';

describe('a queued model read line by line (P3a review CODE-1)', () => {
  const big = (n: number): string => Array.from({ length: n }, (_, i) => `G1 X${i} Y${i % 97} F100`).join('\r\n');

  it('splits its text once, not once per call', () => {
    // Monaco never arrives: the model stays queued and every reader (modal index, inspector,
    // outline) goes through the pending branch.
    const service = createEditorService({
      docs: createDocumentStore({ caseInsensitivePaths: false }),
      loadMonaco: () => new Promise<Monaco>(() => {}),
    });
    service.createModel('dq', big(100_000), 'fanuc-gcode', 'crlf');
    expect(service.model('dq')).toBeUndefined();
    expect(service.hasModel('dq')).toBe(true);

    const started = performance.now();
    for (let i = 0; i < 300; i++) service.getLines('dq', 1 + i * 7, 1 + i * 7);
    for (let i = 0; i < 50; i++) service.getLineCount('dq');
    const took = performance.now() - started;

    expect(service.getLines('dq', 3, 4)).toEqual(['G1 X2 Y2 F100', 'G1 X3 Y3 F100']);
    expect(service.getLineCount('dq')).toBe(100_000);
    // Today (a normalize and a split per call) this is many seconds.
    expect(took).toBeLessThan(250);
  });
});
