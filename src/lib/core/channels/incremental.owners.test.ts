// The patch of an edit builds the sweep over every section (`sectionOwners`) only when an edited line holds a wait
// (v1.2.0 channel-enter): at 20,000 waits it was most of the cost of a line break typed in an ordinary line.
// `incremental.test.ts` holds the answer to a full resolution; this holds what is not built.

import { describe, expect, it, vi } from 'vitest';
import { cpOf } from '../../../../tests/unit/helpers/profiles';
import { resolution, single } from '../../../../tests/unit/helpers/channelIncremental';

const calls = { owners: 0 };
vi.mock('./marks', async (original) => {
  const actual = await original<typeof import('./marks')>();
  return {
    ...actual,
    sectionOwners: (...args: Parameters<typeof actual.sectionOwners>) => {
      calls.owners++;
      return actual.sectionOwners(...args);
    },
  };
});

const { patchResolution } = await import('./incremental');
const lathe = cpOf('fanuc-lathe');

const LINES = ['%', 'O0001', 'O2101', 'G01 X1.', 'M901 P12', 'G01 X2.', 'M99', 'O2102', 'G01 X3.', 'M901 P12', 'G01 X4.', 'M99', 'M30'];

describe('patchResolution and the owners of the lines', () => {
  it('builds them for an edited line that holds a wait, and not for one that does not', () => {
    const prev = resolution('part.nc', LINES, single);
    expect(prev).not.toBeNull();
    const patch = (lines: string[], start: number, endOld: number, endNew: number) =>
      patchResolution(prev!, { startLine: start, endLineOld: endOld, endLineNew: endNew }, lines.length, (a, b) => lines.slice(a - 1, b), lathe, single);

    // A line break typed at the end of an ordinary line: two lines where one was.
    const broken = [...LINES.slice(0, 3), 'G01 X1.', 'G01 Z1.', ...LINES.slice(4)];
    calls.owners = 0;
    const plain = patch(broken, 4, 4, 5);
    expect(plain).not.toBeNull();
    expect(calls.owners).toBe(0);
    // The marks below moved by one line, as the full resolution says.
    expect(plain!.marks.map((m) => m.line)).toEqual(resolution('part.nc', broken, single)!.marks.map((m) => m.line));

    // A wait typed into an ordinary line: its channel is asked for.
    const waiting = [...LINES.slice(0, 3), 'M902 P12', ...LINES.slice(4)];
    calls.owners = 0;
    const withWait = patch(waiting, 4, 4, 4);
    expect(withWait).not.toBeNull();
    expect(calls.owners).toBe(1);
    expect(withWait!.marks.map((m) => [m.line, m.mark, m.channel])).toEqual(resolution('part.nc', waiting, single)!.marks.map((m) => [m.line, m.mark, m.channel]));
  });
});
