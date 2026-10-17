// The merge on a program of 300,000 lines (P4.23): two documents with an edit each, merged
// in about half a second of planning (the machine's own reading of the merged text,
// `resolve`, is a toy here and costs what the service's reading costs in the app).

import { describe, expect, it } from 'vitest';
import { toySet } from './paneFixtures';
import { planMerge, splitRecord } from './merge';

describe('merge back on a large program', () => {
  it('plans 300,000 lines with two edited documents in under 1.5 seconds', () => {
    const source = ['%', 'O1000'];
    for (let s = 0; s < 30_000; s++) {
      source.push(`$${(s % 2) + 1}`);
      for (let k = 0; k < 9; k++) source.push(`N${s}.${k} G1 X${k}.`);
    }
    const set = toySet(source);
    const record = splitRecord({ sourceId: 'big', lines: source, set, made: [{ channelId: '1', docId: 'c1' }, { channelId: '2', docId: 'c2' }] });
    const docs = new Map(record.channels.map((c) => [c.docId, [...c.lines]]));
    docs.get('c1')![150_000] += ' F100.';
    docs.get('c2')!.splice(140_000, 1);
    const started = performance.now();
    const answer = planMerge({ record, source: { lines: source, set }, channelLines: (id) => docs.get(id) ?? null, resolve: (lines) => toySet(lines) });
    const took = performance.now() - started;
    expect(answer.ok).toBe(true);
    if (answer.ok) {
      expect(answer.merged).toEqual(['1', '2']);
      expect(answer.lines.length).toBe(source.length - 1);
    }
    expect(took).toBeLessThan(1500);
  });
});
