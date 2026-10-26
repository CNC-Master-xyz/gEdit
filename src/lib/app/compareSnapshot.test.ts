// The comparison's checks at a copy walk from the modal service's snapshot (compare3): the
// front check (`modalStateAfterLine`) and the end check (`modalStatesAroundEdit`) start from
// the nearest snapshot of the target's index instead of the top of the program. The state must
// be exactly the one of the walk from the top, for any edit, whatever the index has built; and
// the walk reads at most one snapshot interval of the lines above the place.

import { describe, expect, it } from 'vitest';
import { ModalIndex, SNAPSHOT_EVERY } from '$lib/core/nc/modal';
import { SideSnapshots, modalStateAfterLine, modalStatesAroundEdit } from './compare';
import { MILL, harness } from '../../../tests/unit/helpers/modalServiceHarness';

const EVERY = 10; // the harness's snapshot interval

/** A small deterministic generator (mulberry32), so a failure names its seed. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POOL = [
  'G0 X0. Y0.',
  'G1 X10. F100.',
  'G90',
  'G91',
  'G20',
  'G21',
  'G17',
  'G18',
  'G19',
  'G54',
  'G55',
  'G56 G43 H1',
  'G40',
  'G41 D1',
  'T2 M6',
  'S1200 M3',
  'M5',
  'G81 X5. Z-3. R1.',
  'G80',
  'G91 X1.',
  'G90 Y2.',
  '(a comment G91)',
  'G94 F200.',
  'G95 F.2',
  'X5.',
  '',
  'N10 G2 X1. I.5',
];

/** `lines` read through a counter of the line texts the code takes from it. */
function counted(lines: string[]): { lines: string[]; reads: () => number } {
  let reads = 0;
  const proxy = new Proxy(lines, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, receiver);
    },
  });
  return { lines: proxy, reads: () => reads };
}

describe('the checks at a copy, from a snapshot of the index', () => {
  it('give the state of the walk from the top for random edits, whatever the index has built (end check and front check)', () => {
    let compared = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const rnd = random(seed);
      const pick = (): string => POOL[Math.floor(rnd() * POOL.length)];
      const h = harness();
      const count = 20 + Math.floor(rnd() * 180);
      const id = h.add(Array.from({ length: count }, pick));
      // How much of the index is built: none, some, all.
      const built = rnd();
      if (built > 0.66) h.idleAll();
      else if (built > 0.33) for (let k = Math.floor(rnd() * 4); k > 0; k--) h.idleOnce();
      // Typing in the document first, so the index has dropped snapshots.
      for (let k = Math.floor(rnd() * 3); k > 0; k--) h.edit(id, 1 + Math.floor(rnd() * count), pick());
      if (rnd() > 0.5) h.idleOnce();
      const lines = h.lines.get(id) as string[];
      const expect_ = { cp: MILL.cp, db: MILL.db, version: h.version() };
      for (let k = 0; k < 12; k++) {
        const at = 1 + Math.floor(rnd() * (lines.length + 2)); // one past the end and further are clamped
        const remove = Math.floor(rnd() * 6);
        const inserted = Array.from({ length: Math.floor(rnd() * 5) }, pick);
        const first = Math.min(Math.max(at, 1), lines.length + 1);
        const snap = h.service.snapshotAt(id, first - 1, expect_);
        expect(snap, `seed ${seed}`).not.toBeNull();
        const full = modalStatesAroundEdit(lines, MILL.cp, MILL.db, at, remove, inserted);
        const fromSnapshot = modalStatesAroundEdit(lines, MILL.cp, MILL.db, at, remove, inserted, snap!);
        expect(fromSnapshot, `seed ${seed} at ${at} remove ${remove}`).toEqual(full);
        // The front check's state in front of line `first`.
        const front = modalStateAfterLine(lines, MILL.cp, MILL.db, first - 1);
        const frontFrom = modalStateAfterLine(lines, MILL.cp, MILL.db, first - 1, snap!);
        expect(frontFrom, `seed ${seed} front ${first}`).toEqual(front);
        compared++;
      }
    }
    expect(compared).toBe(40 * 12);
  });

  it('ignores a snapshot after the line it was asked for (never reads backwards)', () => {
    const h = harness();
    const id = h.add(Array.from({ length: 60 }, (_, i) => POOL[i % POOL.length]));
    h.idleAll();
    const lines = h.lines.get(id) as string[];
    const late = h.service.snapshotAt(id, 55, { cp: MILL.cp, db: MILL.db })!;
    expect(late.line).toBe(50);
    expect(modalStateAfterLine(lines, MILL.cp, MILL.db, 12, late)).toEqual(modalStateAfterLine(lines, MILL.cp, MILL.db, 12));
    expect(modalStatesAroundEdit(lines, MILL.cp, MILL.db, 13, 1, ['G91'], late)).toEqual(modalStatesAroundEdit(lines, MILL.cp, MILL.db, 13, 1, ['G91']));
  });

  it('reads at most one snapshot interval of the lines above the place, where the walk from the top reads them all', () => {
    // Twenty thousand lines with the app's snapshot interval, built as the idle build would.
    const lines = Array.from({ length: 20_000 }, (_, i) => POOL[(i * 7) % POOL.length]);
    const index = new ModalIndex(MILL.cp, MILL.db);
    index.reset(lines.length, (n) => lines[n - 1] ?? '');
    index.buildSome(1e9);
    expect(index.ready()).toBe(true);
    const numbers: string[] = [];
    for (const at of [1, 2, 999, 1000, 1001, 1999, 2000, 12_345, 19_990, 20_000, 20_001]) {
      const remove = 3;
      const inserted = ['G91', 'X1.'];
      const snap = index.snapshotAtOrBefore(at - 1);
      expect(snap.line).toBe(Math.floor((at - 1) / SNAPSHOT_EVERY) * SNAPSHOT_EVERY);
      const full = counted(lines);
      const viaSnapshot = counted(lines);
      const expected = modalStatesAroundEdit(full.lines, MILL.cp, MILL.db, at, remove, inserted);
      const got = modalStatesAroundEdit(viaSnapshot.lines, MILL.cp, MILL.db, at, remove, inserted, snap);
      expect(got).toEqual(expected);
      // The lines read above the place: fewer than one interval; the removed ones come on top.
      const removed = Math.min(remove, Math.max(lines.length - at + 1, 0));
      expect(viaSnapshot.reads()).toBeLessThanOrEqual(SNAPSHOT_EVERY - 1 + removed);
      expect(viaSnapshot.reads()).toBe(at - 1 - snap.line + removed);
      expect(full.reads()).toBe(Math.min(at - 1, lines.length) + removed);
      numbers.push(`${at}:${full.reads()}/${viaSnapshot.reads()}`);
      // The front check.
      const front = counted(lines);
      expect(modalStateAfterLine(front.lines, MILL.cp, MILL.db, at - 1, snap)).toEqual(modalStateAfterLine(lines, MILL.cp, MILL.db, at - 1));
      expect(front.reads()).toBeLessThanOrEqual(SNAPSHOT_EVERY - 1);
    }
    // From the top / from the snapshot, per place (at 20,000 lines): 1001 -> 1003/3, 12345 -> 12347/347, 19990 -> 19992/992.
    expect(numbers).toContain('12345:12347/347');
  });
});

describe('the snapshots of a side without an index (WX-CODE-1)', () => {
  it('give the state of the walk from the top at any line, asked in any order', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const rnd = random(seed);
      const pick = (): string => POOL[Math.floor(rnd() * POOL.length)];
      const lines = Array.from({ length: 30 + Math.floor(rnd() * 200) }, pick);
      const every = 1 + Math.floor(rnd() * 25);
      const side = new SideSnapshots(lines, MILL.cp, MILL.db, every);
      for (let k = 0; k < 30; k++) {
        const line = Math.floor(rnd() * (lines.length + 6)) - 2; // below 0 and past the end are clamped
        const snap = side.at(line);
        expect(snap.line, `seed ${seed}`).toBeLessThanOrEqual(Math.min(Math.max(line, 0), lines.length));
        const full = modalStateAfterLine(lines, MILL.cp, MILL.db, line);
        expect(modalStateAfterLine(lines, MILL.cp, MILL.db, line, snap), `seed ${seed} line ${line}`).toEqual(full);
        const at = 1 + Math.floor(rnd() * (lines.length + 2));
        const place = side.at(at - 1);
        const inserted = [pick(), pick()];
        expect(modalStatesAroundEdit(lines, MILL.cp, MILL.db, at, 2, inserted, place), `seed ${seed} edit ${at}`).toEqual(
          modalStatesAroundEdit(lines, MILL.cp, MILL.db, at, 2, inserted),
        );
      }
    }
  });

  it('read each line once on the way down, and less than one interval for a place further up', () => {
    const lines = Array.from({ length: 5_000 }, (_, i) => POOL[(i * 7) % POOL.length]);
    const seen = counted(lines);
    const side = new SideSnapshots(seen.lines, MILL.cp, MILL.db, 1000);
    side.at(2_500);
    expect(seen.reads()).toBe(2_500);
    expect(side.walked).toBe(2_500);
    // Further down: on from where it stopped.
    side.at(4_200);
    expect(seen.reads()).toBe(4_200);
    // The same place and the ones above it: from a mark, nothing is read by the snapshot itself.
    side.at(4_200);
    side.at(2_500);
    side.at(1_999);
    side.at(0);
    expect(seen.reads()).toBe(4_200);
    expect(side.at(1_999).line).toBe(1_000);
    expect(side.at(4_199).line).toBe(4_000);
    expect(side.at(99_999).line).toBe(5_000);
    expect(seen.reads()).toBe(5_000);
  });
});
