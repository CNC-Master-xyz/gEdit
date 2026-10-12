// A text buffer with the five methods `applyLinesTo` uses, and the way Monaco applies operations (by offset,
// last to first; see the header of `applyLines.test.ts`): shared by that file and `applyLines.slow.test.ts`
// in src/lib/monaco.

import { expect } from 'vitest';
import type { EditableModel, LineOperation, UndoGroup } from '../../../src/lib/monaco/applyLines';

export class FakeModel implements EditableModel {
  lines: string[];
  /** How often `pushStackElement` was called; one undo step means exactly two. */
  stackElements = 0;
  /** Every `pushEditOperations` batch, so "one call" can be asserted. */
  batches: LineOperation[][] = [];
  /** The undo group each batch was pushed with (`undefined` for none). */
  groups: (UndoGroup | undefined)[] = [];
  /** Where in the sequence of calls each `pushStackElement` happened (index into `batches`). */
  stackAt: number[] = [];

  constructor(text: string) {
    this.lines = text.split('\n');
  }

  get text(): string {
    return this.lines.join('\n');
  }

  getLineCount(): number {
    return this.lines.length;
  }

  getLineContent(line: number): string {
    return this.lines[line - 1];
  }

  getLineMaxColumn(line: number): number {
    return this.lines[line - 1].length + 1;
  }

  pushStackElement(): void {
    this.stackElements++;
    this.stackAt.push(this.batches.length);
  }

  pushEditOperations(_before: null, operations: LineOperation[], _cursor?: () => null, group?: UndoGroup): unknown {
    this.batches.push(operations);
    this.groups.push(group);
    const spans = operations
      .map((op) => {
        const range = this.validateRange(op.range);
        return {
          start: this.offsetOf(range.startLineNumber, range.startColumn),
          end: this.offsetOf(range.endLineNumber, range.endColumn),
          text: op.text,
        };
      })
      .sort((a, b) => a.start - b.start);

    for (let i = 0; i < spans.length; i++) {
      expect(spans[i].end).toBeGreaterThanOrEqual(spans[i].start);
      if (i > 0) expect(spans[i].start).toBeGreaterThanOrEqual(spans[i - 1].end);
    }

    let text = this.text;
    for (const span of [...spans].reverse()) {
      text = text.slice(0, span.start) + span.text + text.slice(span.end);
    }
    this.lines = text.split('\n');
    return null;
  }

  private offsetOf(line: number, column: number): number {
    let offset = 0;
    for (let i = 1; i < line; i++) offset += this.lines[i - 1].length + 1;
    return offset + column - 1;
  }

  /**
   * Monaco's `TextModel.validateRange`, the surrogate half of it.
   *
   * A boundary counts as *inside a surrogate pair* when the character in front of it is
   * a high surrogate, and the range is then pushed outwards at that end — the start to
   * the left, the end to the right. The end is only examined while it is not past the
   * last character of the line, which is Monaco's `endColumn <= lineLength` condition.
   */
  private validateRange(range: LineOperation['range']): LineOperation['range'] {
    const isHigh = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
    const startLine = this.lines[range.startLineNumber - 1] ?? '';
    const endLine = this.lines[range.endLineNumber - 1] ?? '';
    const startInsidePair = range.startColumn > 1 && isHigh(startLine.charCodeAt(range.startColumn - 2));
    const endInsidePair =
      range.endColumn > 1 && range.endColumn <= endLine.length && isHigh(endLine.charCodeAt(range.endColumn - 2));
    if (!startInsidePair && !endInsidePair) return range;
    return {
      ...range,
      startColumn: startInsidePair ? range.startColumn - 1 : range.startColumn,
      endColumn: endInsidePair ? range.endColumn + 1 : range.endColumn,
    };
  }
}

/** The whole document as lines, which is what a transform hands back. */
export function linesOf(text: string): string[] {
  return text.split('\n');
}
