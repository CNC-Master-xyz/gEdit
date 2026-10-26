// The keystroke budget of the typing help (Phase 4 plan §6.5 rules 1 and 3, "Cost"): on a 300,000-line
// program, 200 keystrokes, best of three rounds, the p95 of a key press stays below 10 ms with upper case,
// auto-space and the automatic block number all on. The pattern is `app/p3Typing.budget.slow.test.ts`.
//
// What a key press costs here is `handleKey` with everything it asks of the editor: the decision (the line,
// the line above, the lines down to the next numbered block or the program end) and the edit, applied to the
// editor's own text model (`monaco/realModel.ts`, a real piece tree and undo stack). A key the handler
// leaves to the editor is typed into the model by the test, untimed: that is the editor's own work and was
// there before P4c.
//
// Klartext's Enter is measured in two parts, and the two have two different promises. The typing help's own
// work (reading the lines below and computing every new number) is held to the 10 ms budget: that is what
// the code of the typing help costs and it must stay there. Monaco's own work of applying one edit per
// renumbered line (with its undo record) is not ours: it grows with the number of blocks below, about 30 to
// 100 ms for 4,000 lines on the development machine whatever the typing help does. The owner accepted 30 to
// 200 ms for a whole Klartext Enter near the 5,000-line limit (2026-10-19), so the whole Enter is held to
// 200 ms (`ENTER_WHOLE_MS`) and is reported with its two parts; the §6.5 rule 3 budget of 10 ms at that
// limit is not reachable by any per-line edit (P4.12 report).
//
// Three programs: a Fanuc mill program (letters, digits and Enter at line 153,000), a Klartext program with
// Enter about 4,000 blocks above END PGM (each Enter renumbers every block below it: the heaviest Enter that
// is allowed), and the same Klartext program with Enter 150,000 blocks above END PGM (refused after reading
// one more line than the limit).
//
// A wall-clock test on a shared machine: one stall is not the code's, so each measure is judged on its best
// round. A real slowdown is in every round.

import { describe, expect, it, vi } from 'vitest';
import { compileProfile } from '$lib/core/profiles/compile';
import type { CompiledProfile } from '$lib/core/profiles/types';
import { realModel, type RealModel } from '$lib/monaco/realModel';
import { expectWithin } from '../../../tests/unit/helpers/budget';
import { profileOf } from '../../../tests/unit/helpers/profiles';

vi.mock('$lib/app/status', () => ({ status: { show: () => {} } }));
vi.mock('$lib/monaco/setup', () => ({ getMonaco: async () => ({ Selection: class {} }) }));
vi.mock('$lib/monaco/editorService', () => ({
  editor: { editorInstance: () => undefined, onDidAttach: () => () => {}, onDidFocusGroup: () => () => {} },
}));
vi.mock('$lib/stores/documents', () => ({ docs: { getActiveId: () => 'd1', get: () => ({ id: 'd1', readOnly: false, path: null }) } }));
vi.mock('$lib/stores/machines', () => ({ machines: { effective: () => ({ cp: null, profile: {} }) } }));

const { handleKey } = await import('./typing');

const LINES = 300_000;
const KEYSTROKES = 200;
const ROUNDS = 3;
const BUDGET_MS = 10;
/** The owner's accepted ceiling for a whole Klartext Enter near the 5,000-line limit, Monaco's edits included (2026-10-19). */
const ENTER_WHOLE_MS = 200;

interface Cursor {
  line: number;
  column: number;
}

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

/** An editor over the real model, with one cursor, that applies what the handler asks of it. `applied.ms` sums the time of the model's own work: its `executeEdits` and its undo stops. */
function editorOver(model: RealModel, cursor: Cursor, applied: { ms: number }) {
  const insert = (text: string): void => {
    const range = { startLineNumber: cursor.line, startColumn: cursor.column, endLineNumber: cursor.line, endColumn: cursor.column };
    model.pushEditOperations(null, [{ range, text }], () => null);
    const parts = text.split('\n');
    if (parts.length === 1) cursor.column += text.length;
    else {
      cursor.line += parts.length - 1;
      cursor.column = parts[parts.length - 1].length + 1;
    }
  };
  const adapter = {
    getLineContent: (n: number) => model.getLineContent(n),
    getLineLength: (n: number) => model.getLineMaxColumn(n) - 1,
    getLineCount: () => model.getLineCount(),
    uri: { scheme: 'inmemory', authority: 'doc' },
  };
  const instance = {
    onKeyDown: () => ({ dispose() {} }),
    // The app's own setting (`contrib/assistant.ts`): Enter never accepts a suggestion, so it stays the handler's.
    getOption: () => 'off',
    getModel: () => adapter,
    getSelections: () => [
      {
        startLineNumber: cursor.line,
        startColumn: cursor.column,
        endLineNumber: cursor.line,
        endColumn: cursor.column,
        positionLineNumber: cursor.line,
        positionColumn: cursor.column,
      },
    ],
    trigger: (_source: string, _handler: string, payload: { text: string }) => insert(payload.text),
    // Closing the undo element is the model's work as well (about 15 ms after an edit of 4,000 lines), so it counts as the editor's.
    pushUndoStop: () => {
      const started = performance.now();
      model.pushStackElement();
      applied.ms += performance.now() - started;
      return true;
    },
    executeEdits: (
      _source: string,
      edits: { range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }; text: string }[],
      cursorState?: (inverse: never[]) => unknown[] | null,
    ) => {
      const started = performance.now();
      model.pushEditOperations(null, edits.map((edit) => ({ range: edit.range, text: edit.text })), () => null);
      applied.ms += performance.now() - started;
      const next = cursorState?.([])?.[0] as Cursor | undefined;
      if (next) Object.assign(cursor, next);
      return true;
    },
  };
  /** What the editor itself does with a key the handler leaves alone. */
  const fallback = (key: string): void => insert(key === 'Enter' ? '\n' : key);
  return { instance, fallback };
}

function depsFor(cp: CompiledProfile) {
  return {
    activeDocId: () => 'd1',
    readOnly: () => false,
    effective: () => ({ cp, editing: { forceUppercase: true, preventLineJoin: true, autoSpace: true, autoNumber: true } }),
    uppercaseOn: () => true,
    autoSpaceOn: () => true,
    autoNumberOn: () => true,
    applies: () => true,
    hint: () => {},
    makeSelection: (line: number, column: number) => ({ line, column }),
    enterOption: () => 1,
  };
}

/**
 * Types `keys` (one entry per key press) and returns the time of each press, of each Enter on its own, and of
 * each Enter without the model's application of its edits (`enterOwn`) and that application alone (`enterApply`).
 * `before` runs ahead of each press, untimed (to put the cursor back).
 */
function typeKeys(model: RealModel, cursor: Cursor, cp: CompiledProfile, keys: readonly string[], before?: () => void) {
  const applied = { ms: 0 };
  const { instance, fallback } = editorOver(model, cursor, applied);
  const deps = depsFor(cp);
  const all: number[] = [];
  const enters: number[] = [];
  const enterOwn: number[] = [];
  const enterApply: number[] = [];
  let taken = 0;
  for (const key of keys) {
    before?.();
    const e = { browserEvent: { key }, preventDefault() {}, stopPropagation() {} };
    applied.ms = 0;
    const started = performance.now();
    const done = handleKey(instance as never, e as never, false, deps as never);
    const ms = performance.now() - started;
    all.push(ms);
    if (key === 'Enter') {
      enters.push(ms);
      enterOwn.push(ms - applied.ms);
      enterApply.push(applied.ms);
    }
    if (done) taken++;
    else fallback(key);
  }
  return { all, enters, enterOwn, enterApply, taken };
}

/** `count` keys from `pattern`, over and over. */
function keysOf(pattern: readonly string[], count: number): string[] {
  return Array.from({ length: count }, (_, i) => pattern[i % pattern.length]);
}

/** A mill program numbered N10 … N90000 in steps of 10, starting again every 9,000 lines (numbering.max is 99999). */
function fanucProgram(n: number): string {
  const pool = ['G0 X0. Y0.', 'G1 X10. Y5. F100.', 'T2 M6', 'S1200 M3', 'G81 X5. Z-3. R1.', 'G80', 'G2 X20. Y5. I5. J0.', '(NEXT)'];
  return Array.from({ length: n }, (_, i) => `N${((i % 9000) + 1) * 10} ${pool[i % pool.length]}`).join('\n');
}

function klartextProgram(n: number): string {
  const lines = ['0 BEGIN PGM BIG MM'];
  for (let i = 1; i < n - 1; i++) lines.push(`${i} L X+${i % 97} Y+${i % 89} R0 F200`);
  lines.push(`${n - 1} END PGM BIG MM`);
  return lines.join('\n');
}

describe('the typing help on a 300,000-line program (§6.5 rules 1 and 3)', () => {
  it(`keeps the p95 of a key press below ${BUDGET_MS} ms: Fanuc, letters, digits and Enter at line 153,000`, () => {
    const cp = compileProfile(profileOf('fanuc-gcode'));
    const pattern = ['g', '1', 'x', '1', '0', '.', 'y', '5', '.', 'f', '2', '0', '0', '.', 'Enter'];
    const rounds: { p95: number; enter: number }[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      const model = realModel(fanucProgram(LINES));
      // At the end of line 153,000 (`N90000 …`, the last block before the numbers start again at N10): every
      // Enter at the end of a typed block numbers the new line, 10 above the block before it.
      const line = 153_000;
      const cursor = { line, column: model.getLineMaxColumn(line) };
      // The first Enter numbers the new line; the next ones follow the blocks typed.
      const { all, enters, taken } = typeKeys(model, cursor, cp, ['Enter', ...keysOf(pattern, KEYSTROKES - 1)]);
      expect(taken).toBeGreaterThan(KEYSTROKES / 4);
      expect(model.getLineContent(line + 1)).toBe('N90010 G1 X10. Y5. F200.');
      rounds.push({ p95: p95(all), enter: p95(enters) });
    }
    const best = Math.min(...rounds.map((r) => r.p95));
    console.log(`fanuc: p95 per round ${rounds.map((r) => r.p95.toFixed(3)).join(', ')} ms; Enter p95 ${rounds.map((r) => r.enter.toFixed(3)).join(', ')} ms`);
    expectWithin(best, BUDGET_MS, 'p95 of a key press, Fanuc, best round');
  });

  it(`keeps the p95 of a key press below ${BUDGET_MS} ms: Klartext, each Enter renumbering about 4,000 blocks below`, () => {
    const cp = compileProfile(profileOf('heidenhain-klartext'));
    // Enter, then `l` (a block that is more than its number), then Enter again: half of the presses are Enter.
    const keys = keysOf(['Enter', 'l'], KEYSTROKES);
    const rounds: { p95: number; enter: number; own: number; apply: number }[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      const model = realModel(klartextProgram(LINES));
      const line = LINES - 4_000;
      const cursor = { line, column: model.getLineMaxColumn(line) };
      const { all, enters, enterOwn, enterApply, taken } = typeKeys(model, cursor, cp, keys);
      expect(taken).toBe(KEYSTROKES);
      // The program stays numbered in order: the last block is END PGM with the count of blocks + 1.
      const last = model.getLineCount();
      expect(model.getLineContent(last)).toBe(`${LINES - 1 + KEYSTROKES / 2} END PGM BIG MM`);
      expect(model.getLineContent(line + 1)).toBe(`${line} L`);
      rounds.push({ p95: p95(all), enter: p95(enters), own: p95(enterOwn), apply: p95(enterApply) });
    }
    const fmt = (key: 'p95' | 'enter' | 'own' | 'apply'): string => rounds.map((r) => r[key].toFixed(3)).join(', ');
    console.log(
      `klartext near the end: p95 per round ${fmt('p95')} ms; Enter p95 ${fmt('enter')} ms = typing help ${fmt('own')} ms + Monaco's edits ${fmt('apply')} ms`,
    );
    expectWithin(Math.min(...rounds.map((r) => r.own)), BUDGET_MS, 'p95 of the typing help’s own work for an Enter that renumbers about 4,000 blocks, Klartext, best round');
    // The whole Enter (Monaco's edits included) stays within what the owner accepted for it.
    expectWithin(Math.min(...rounds.map((r) => r.enter)), ENTER_WHOLE_MS, 'p95 of a whole Enter that renumbers about 4,000 blocks, Klartext, best round');
  });

  it(`refuses an Enter far above END PGM within ${BUDGET_MS} ms: reading stops after the limit`, () => {
    const cp = compileProfile(profileOf('heidenhain-klartext'));
    const rounds: number[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      const model = realModel(klartextProgram(LINES));
      const line = 150_000;
      const cursor = { line, column: 1 };
      // Every press is an Enter at the end of the same block: each is refused and the editor's own line
      // break follows (an empty line below the block, which changes nothing of the count below).
      const back = (): void => {
        cursor.line = line;
        cursor.column = model.getLineMaxColumn(line);
      };
      const { enters, taken } = typeKeys(model, cursor, cp, keysOf(['Enter'], KEYSTROKES), back);
      expect(taken).toBe(0);
      expect(model.getLineContent(line + KEYSTROKES + 1)).toBe(`${line} L X+${line % 97} Y+${line % 89} R0 F200`);
      rounds.push(p95(enters));
    }
    console.log(`klartext far from the end (refused): Enter p95 per round ${rounds.map((r) => r.toFixed(3)).join(', ')} ms`);
    expectWithin(Math.min(...rounds), BUDGET_MS, 'p95 of a refused Enter, Klartext, best round');
  });
});
