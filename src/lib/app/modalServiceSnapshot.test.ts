// `ModalService.snapshotAt` (compare3): the nearest snapshot of a document's index at or
// before a line, handed out as a frozen copy for a reader that walks the rest itself (the
// comparison's checks at a copy). The reader's walk from it must give the state of the walk
// from the top, whatever the build has reached, and it must be refused for text, profile or
// database the index was not built from.

import { describe, expect, it } from 'vitest';
import { ModalInterpreter } from '$lib/core/nc/modal';
import { maskComments } from '$lib/core/nc/mask';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import type { ModalSnapshot } from '$lib/core/nc/modal';
import type { ModalState } from '$lib/core/nc/types';
import { KLARTEXT, MILL, harness, program, viewOf, walk } from '../../../tests/unit/helpers/modalServiceHarness';

const EVERY = 10; // the harness's snapshot interval

/** What a reader does with a snapshot: walks on to `line` of `lines`; the state and how many lines it read. */
function walkOn(snap: ModalSnapshot, lines: readonly string[], line: number): { state: ModalState; read: number } {
  const interp = new ModalInterpreter(MILL.cp, MILL.db);
  interp.restore(snap.interp);
  let above = snap.lineState;
  let read = 0;
  for (let n = snap.line + 1; n <= line; n++) {
    const result = tokenizeLine(lines[n - 1], MILL.cp, above);
    interp.update(result.tokens, n, maskComments(lines[n - 1], MILL.cp));
    above = result.state;
    read++;
  }
  return { state: interp.state(), read };
}

const expectMill = { cp: MILL.cp, db: MILL.db };

describe('ModalService.snapshotAt', () => {
  it('hands out the nearest snapshot at or before the line; walking on from it gives the state of the walk from the top, in at most every - 1 lines', () => {
    const h = harness();
    const text = program(95);
    const id = h.add(text);
    h.idleAll();
    const oracle = walk(MILL, text);
    for (let n = 0; n <= text.length; n++) {
      const snap = h.service.snapshotAt(id, n, expectMill);
      expect(snap, `line ${n}`).not.toBeNull();
      expect(snap!.line).toBe(Math.floor(n / EVERY) * EVERY);
      const walked = walkOn(snap!, text, n);
      expect(walked.state, `line ${n}`).toEqual(oracle[n]);
      expect(walked.read).toBeLessThanOrEqual(EVERY - 1);
    }
  });

  it('is never wrong where the build has not got to the line yet, only further away', () => {
    const h = harness();
    const text = program(95);
    const id = h.add(text);
    const oracle = walk(MILL, text);
    // Nothing built: only the power-on snapshot stands, and the whole text is walked.
    let snap = h.service.snapshotAt(id, 80, expectMill)!;
    expect(snap.line).toBe(0);
    expect(walkOn(snap, text, 80).state).toEqual(oracle[80]);
    // Half built: the nearest one that stands, never one past the line.
    while (h.service.stateAfter(id, 50) === null) h.idleOnce();
    snap = h.service.snapshotAt(id, 80, expectMill)!;
    expect(snap.line).toBeLessThanOrEqual(80);
    expect(snap.line).toBeGreaterThanOrEqual(50 - EVERY);
    expect(walkOn(snap, text, 80).state).toEqual(oracle[80]);
    // A line past the end is the end.
    expect(h.service.snapshotAt(id, 10_000, expectMill)!.line).toBeLessThanOrEqual(text.length);
  });

  it('follows an edit at once: the snapshots after the edit are gone, the ones before it stand', () => {
    const h = harness();
    const id = h.add(program(100));
    h.idleAll();
    h.edit(id, 45, 'G95 G1 X3. F.25');
    const text = h.lines.get(id) as string[];
    const oracle = walk(MILL, text);
    const snap = h.service.snapshotAt(id, 80, { ...expectMill, version: h.version() })!;
    expect(snap.line).toBe(40);
    expect(walkOn(snap, text, 80).state).toEqual(oracle[80]);
    h.idleAll();
    expect(h.service.snapshotAt(id, 80, expectMill)!.line).toBe(80);
  });

  it('is null for a text read at another version, a document that is not open or has no model, and a program that is not NC', () => {
    const h = harness();
    const id = h.add(program(50));
    h.idleAll();
    const read = h.version();
    expect(h.service.snapshotAt(id, 20, { ...expectMill, version: read })).not.toBeNull();
    h.edit(id, 3, 'G91');
    expect(h.service.snapshotAt(id, 20, { ...expectMill, version: read })).toBeNull();
    expect(h.service.snapshotAt(id, 20, { ...expectMill, version: h.version() })).not.toBeNull();
    expect(h.service.snapshotAt('gone', 20, expectMill)).toBeNull();
    const queued = h.add(program(20), { model: false });
    expect(h.service.snapshotAt(queued, 5, expectMill)).toBeNull();
    const profile = h.add(program(20), { path: '/profiles/x.json' });
    expect(h.service.snapshotAt(profile, 5, expectMill)).toBeNull();
  });

  it('is null when the reader’s profile or database is not the one the index was built with, and not when it is only a new object with the same content', () => {
    const h = harness();
    const id = h.add(program(50));
    h.idleAll();
    expect(h.service.snapshotAt(id, 20, { cp: KLARTEXT.cp, db: KLARTEXT.db })).toBeNull();
    expect(h.service.snapshotAt(id, 20, { cp: MILL.cp, db: KLARTEXT.db })).toBeNull();
    const again = viewOf('fanuc-gcode');
    expect(again.cp).not.toBe(MILL.cp);
    expect(h.service.snapshotAt(id, 20, { cp: again.cp, db: again.db })).not.toBeNull();
    // The index follows a switch of dialect: the old reader is refused, the new one served.
    h.views.set(id, KLARTEXT);
    h.machineRevision.update((n) => n + 1);
    h.idleAll();
    expect(h.service.snapshotAt(id, 20, expectMill)).toBeNull();
    expect(h.service.snapshotAt(id, 20, { cp: KLARTEXT.cp, db: KLARTEXT.db })).not.toBeNull();
  });

  it('hands out a frozen copy: neither the reader nor a later edit changes what it holds', () => {
    const h = harness();
    const text = program(60);
    const id = h.add([...text]); // the editor edits its own array
    h.idleAll();
    const oracle = walk(MILL, text);
    const snap = h.service.snapshotAt(id, 35, expectMill)!;
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.interp)).toBe(true);
    expect(() => {
      (snap as { line: number }).line = 1;
    }).toThrow(TypeError);
    // Walking on twice from the same snapshot reads the same (the reader's interpreter works on its own copy).
    const first = walkOn(snap, text, 38);
    const second = walkOn(snap, text, 38);
    expect(first.state).toEqual(oracle[38]);
    expect(second.state).toEqual(first.state);
    // Two asks are two copies.
    const other = h.service.snapshotAt(id, 35, expectMill)!;
    expect(other).not.toBe(snap);
    expect(other.interp).not.toBe(snap.interp);
    // An edit above the snapshot changes the index, not the copy already handed out.
    h.edit(id, 5, 'G91 G20');
    h.idleAll();
    expect(walkOn(snap, text, 38).state).toEqual(oracle[38]);
    const now = h.lines.get(id) as string[];
    expect(walkOn(h.service.snapshotAt(id, 35, expectMill)!, now, 38).state).toEqual(walk(MILL, now)[38]);
  });
});
