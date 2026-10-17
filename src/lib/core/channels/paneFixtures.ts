// Test support for the channel panes and the merge (P4e prelude; `panes.test.ts`,
// `merge.test.ts`, `viewUndo.test.ts`). Not imported by the app.
//
// A toy channel layout that needs no machine: a line that is exactly `$<n>` starts a section
// of channel `<n>` (1–4), sections run to the next start, the lines before the first start are
// the header. The answer has the shape `channels.fresh()` gives for a `single-file` machine.

import type { ChannelRef, ChannelSet, SyncHit } from '$lib/core/channels/types';
import type { TextEdit } from './panes';

export const TOY_CHANNELS: ChannelRef[] = [1, 2, 3, 4].map((n, index) => ({ id: String(n), name: `Channel ${n}`, index }));

/** The toy program of the tests: header 1–2, channel 1 at 3–5 and 8–9, channel 2 at 6–7 and 10–11. */
export const TOY_PROGRAM = ['%', 'O1000', '$1', 'A1', 'A2', '$2', 'B1', '$1', 'A3', '$2', 'B2'];

export function toySet(lines: readonly string[]): ChannelSet {
  const ranges = new Map<string, { startLine: number; endLine: number }[]>();
  let current: string | null = null;
  let firstStart = 0;
  lines.forEach((text, i) => {
    const line = i + 1;
    const m = /^\$([1-4])$/.exec(text);
    if (m) {
      current = m[1];
      if (firstStart === 0) firstStart = line;
      const list = ranges.get(current) ?? [];
      list.push({ startLine: line, endLine: line });
      ranges.set(current, list);
      return;
    }
    if (current === null) return;
    const list = ranges.get(current)!;
    list[list.length - 1].endLine = line;
  });
  const members = TOY_CHANNELS.filter((c) => ranges.has(c.id)).map((c) => ({
    kind: 'section' as const,
    channel: c,
    docId: 'toy',
    ranges: ranges.get(c.id)!,
  }));
  const headerEnd = firstStart === 0 ? lines.length : firstStart - 1;
  return {
    layout: 'single-file',
    self: null,
    members,
    missing: TOY_CHANNELS.filter((c) => !ranges.has(c.id)),
    outside: headerEnd >= 1 ? [{ startLine: 1, endLine: headerEnd }] : [],
    marks: [],
    problems: [],
    truncated: false,
  };
}

/** Applies non-overlapping edits (coordinates of `lines` before the edits) to a copy of `lines`. */
export function applyEdits(lines: readonly string[], edits: readonly TextEdit[]): string[] {
  const text = lines.join('\n');
  const starts: number[] = [];
  let at = 0;
  for (const line of lines) {
    starts.push(at);
    at += line.length + 1;
  }
  const offset = (line: number, column: number): number => starts[line - 1] + column - 1;
  const sorted = [...edits].sort((a, b) => offset(b.range.startLineNumber, b.range.startColumn) - offset(a.range.startLineNumber, a.range.startColumn));
  let out = text;
  for (const e of sorted) {
    const from = offset(e.range.startLineNumber, e.range.startColumn);
    const to = offset(e.range.endLineNumber, e.range.endColumn);
    out = out.slice(0, from) + e.text + out.slice(to);
  }
  return out.split('\n');
}

/** A blocking wait mark of rule `w` in channel `channel` at pane line `line`, `P` = `partners`. */
export function wait(channel: string, line: number, mark: string, partners: string, o: { blocking?: boolean; ruleId?: string } = {}): SyncHit {
  return { ruleId: o.ruleId ?? 'w', mark, line, channel, partners: partners.split(''), blocking: o.blocking ?? true };
}

/** A small deterministic random source (the property tests). */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}
