// Insert File and Append File (Phase 4 plan §6.5 rule 8): the file read the way Open reads it (size, binary, empty,
// unreadable), the placement in a real Monaco model, the line endings, the program-end warning, Klartext numbering
// and its refusals, one undo step, and the commands' rows. The placement and numbering rules alone are
// `core/nc/insertFile.test.ts`.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeFile } from '$lib/core/text';
import { realModel, type RealModel } from '$lib/monaco/realModel';
import type { CommandDef } from '$lib/app/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import { cpOf } from '../../../tests/unit/helpers/profiles';

const FANUC = cpOf('fanuc-gcode');
const KLARTEXT = cpOf('heidenhain-klartext');
const LIMIT = 50 * 1024 * 1024;

const fake = vi.hoisted(() => ({
  model: null as unknown as RealModel,
  cp: null as unknown as CompiledProfile,
  readOnly: false,
  layout: 'single' as 'single' | 'channels',
  /** The active document, and the one the focused editor shows. */
  activeId: 'd1' as string | null,
  focusedDoc: 'd1' as string | null,
  /** The compare overlay's panel, or null. */
  overlay: null as string | null,
  cursor: { line: 1, column: 1 } as { line: number; column: number } | null,
  selection: null as { startLine: number; endLine: number; empty: boolean } | null,
  /** What the dialog answers: undefined is a cancel. */
  picked: undefined as string[] | undefined,
  dialogOptions: [] as unknown[],
  /** The bytes of the files by path; a path that is not here cannot be read. */
  bytes: {} as Record<string, Uint8Array>,
  /** `null`: the stat says nothing about the size; a number: the size; 'reject': the call fails. */
  size: undefined as undefined | number | null | 'reject' | 'unavailable',
  messages: [] as { text: string; error: boolean }[],
  selected: [] as { first: number; last: number }[],
  /** Runs while the file is being read (the user types, the tab closes). */
  whileReading: undefined as undefined | (() => void),
}));

vi.mock('$lib/app/dialogs', () => ({
  dialogs: {
    exclusive: <T>(op: () => Promise<T>): Promise<T | undefined> => op(),
    openFiles: (options: unknown): Promise<string[] | undefined> => {
      fake.dialogOptions.push(options);
      return Promise.resolve(fake.picked);
    },
  },
}));
vi.mock('$lib/app/fileOps', async () => {
  const { decodeFile: decode } = await import('$lib/core/text');
  return {
    MAX_OPEN_BYTES: 50 * 1024 * 1024,
    formatBytes: (n: number): string => `${Math.round(n / (1024 * 1024))} MB`,
    files: {
      readDisk: async (path: string) => {
        fake.whileReading?.();
        const bytes = fake.bytes[path];
        return bytes === undefined ? null : decode(bytes);
      },
    },
  };
});
vi.mock('$lib/platform/commands', () => ({
  filesStat: (paths: string[]): Promise<unknown[]> => {
    if (fake.size === 'reject') return Promise.reject(new Error('no answer'));
    const bytes = fake.bytes[paths[0]];
    const size = fake.size === undefined ? (bytes === undefined ? null : bytes.length) : fake.size;
    if (fake.size === 'unavailable') return Promise.resolve([{ path: paths[0], allowed: false, exists: false, isDir: false, size: null, unavailable: true }]);
    return Promise.resolve([{ path: paths[0], allowed: true, exists: bytes !== undefined, isDir: false, size }]);
  },
}));
vi.mock('$lib/app/status', () => ({
  status: { show: (text: string, o?: { error?: boolean }): number => fake.messages.push({ text, error: o?.error === true }), clear: (): void => {} },
}));
vi.mock('$lib/stores/layout', () => ({
  layout: {
    state: {
      subscribe: (run: (value: { overlay: string | null }) => void): (() => void) => {
        run({ overlay: fake.overlay });
        return () => {};
      },
    },
  },
}));
vi.mock('$lib/stores/documents', () => ({
  docs: {
    getActiveId: (): string | null => fake.activeId,
    get: (id: string) =>
      id === 'd1' ? { id, title: 'part.nc', path: '/jobs/part.nc', readOnly: fake.readOnly, readOnlyReason: fake.readOnly ? 'user' : null } : undefined,
  },
}));
vi.mock('$lib/stores/machines', () => ({ machines: { effective: () => ({ cp: fake.cp }) } }));
vi.mock('$lib/monaco/applyLines', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/monaco/applyLines')>();
  return {
    ...actual,
    applyLines: (_id: string, start: number, end: number, lines: string[]) => {
      if (fake.readOnly) return { changedLines: 0, locked: true as const };
      return actual.applyLinesTo(fake.model, start, end, lines);
    },
  };
});
vi.mock('$lib/monaco/editorService', () => ({
  editor: {
    groupsState: () => ({
      layout: fake.layout,
      groups: [{ id: 'g1', content: fake.focusedDoc === null ? null : { kind: 'document', docId: fake.focusedDoc } }],
      focused: 'g1',
    }),
    getLineCount: (): number => fake.model.getLineCount(),
    getLines: (_id: string, first: number, last: number): string[] => {
      const out: string[] = [];
      for (let line = first; line <= last; line++) out.push(fake.model.getLineContent(line));
      return out;
    },
    cursor: () => fake.cursor,
    selectionLines: () => fake.selection,
    selectLines: (_id: string, first: number, last: number): number => fake.selected.push({ first, last }),
  },
}));

const insertFile = (await import('./insertFile')).default;
const { hasKey } = await import('$lib/i18n');

const insert = (insertFile.commands ?? []).find((c) => c.id === 'file.insertFile') as CommandDef;
const append = (insertFile.commands ?? []).find((c) => c.id === 'file.appendFile') as CommandDef;
const context = { activeDocId: 'd1', profileId: 'fanuc-gcode', hasSelection: false, editorFocused: true, compareOpen: false, modalOpen: false, scriptRunning: false };

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
const PROGRAM = ['O1000', 'N10 G90 G54', 'N20 G1 X1', 'N30 G1 X2', 'N40 M30', '%'];
/** PROGRAM without its closing `%`. */
const OPEN = PROGRAM.slice(0, -1);
const FILE = '/jobs/cut.nc';

function open(text: string, cp: CompiledProfile = FANUC): void {
  fake.model = realModel(text);
  fake.cp = cp;
}
const lines = (): string[] => fake.model.getValue().split(/\r\n|\n/);
const last = () => fake.messages[fake.messages.length - 1];

function file(text: string | Uint8Array): void {
  fake.picked = [FILE];
  fake.bytes[FILE] = typeof text === 'string' ? enc(text) : text;
}

beforeEach(() => {
  // A stat that fails is logged (and refused); the test says so itself.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  fake.readOnly = false;
  fake.layout = 'single';
  fake.activeId = 'd1';
  fake.focusedDoc = 'd1';
  fake.overlay = null;
  fake.cursor = { line: 1, column: 1 };
  fake.selection = null;
  fake.picked = undefined;
  fake.dialogOptions = [];
  fake.bytes = {};
  fake.size = undefined;
  fake.messages = [];
  fake.selected = [];
  fake.whileReading = undefined;
  open(PROGRAM.join('\n'));
});

describe('the commands', () => {
  it('are in the File tab at orders 80 and 81, without keys', () => {
    expect(insert.title).toBe('insertFile.insert');
    expect(append.title).toBe('insertFile.append');
    expect(insert.keys).toBeUndefined();
    expect(append.keys).toBeUndefined();
    expect(insertFile.ribbon).toEqual([
      { tab: 'file', group: 'insertFile.group', command: 'file.insertFile', order: 80 },
      { tab: 'file', group: 'insertFile.group', command: 'file.appendFile', order: 81 },
    ]);
  });

  it('need a document, no compare overlay, no channel view and no lock', () => {
    for (const command of [insert, append]) {
      expect(command.enabled?.(context), command.id).toBe(true);
      expect(command.enabled?.({ ...context, activeDocId: null }), command.id).toBe(false);
      expect(command.enabled?.({ ...context, compareOpen: true }), command.id).toBe(false);
    }
    fake.layout = 'channels';
    expect(insert.enabled?.(context)).toBe(false);
    expect(append.enabled?.(context)).toBe(false);
    fake.layout = 'single';
    fake.readOnly = true;
    expect(insert.enabled?.(context)).toBe(false);
    expect(append.enabled?.(context)).toBe(false);
  });

  it('every message the feature uses exists', () => {
    for (const key of [
      'category', 'group', 'insert', 'append', 'done_one', 'done_other', 'atLine', 'atLines', 'renumbered_one', 'renumbered_other',
      'nulDropped_one', 'nulDropped_other', 'afterProgramEnd', 'noDocument', 'notAvailable', 'notReadable', 'unknownSize', 'tooLarge',
      'binary', 'empty', 'secondProgramStart', 'tooManyBelow', 'overflow', 'changed',
      'tapeMarksLeftOut_one', 'tapeMarksLeftOut_other', 'afterTapeEnd', 'programFrameStart', 'programFrameEnd', 'onlyTapeMarks',
      'secondProgram', 'programEndInFile', 'continuesAbove', 'continuesBelow',
    ]) {
      expect(hasKey(`insertFile.${key}`), key).toBe(true);
    }
  });
});

describe('the dialog', () => {
  it('asks for one file, starting in the document’s folder', async () => {
    await insert.run(context);
    expect(fake.dialogOptions).toEqual([{ multiple: false, defaultPath: '/jobs' }]);
  });

  it('does nothing, and says nothing, when it is cancelled or nothing is picked', async () => {
    await insert.run(context);
    fake.picked = [];
    await append.run(context);
    expect(lines()).toEqual(PROGRAM);
    expect(fake.messages).toEqual([]);
    expect(fake.selected).toEqual([]);
  });

  it('is not opened for a locked document, which is refused with the lock’s reason', async () => {
    fake.readOnly = true;
    file('G0 X0\n');
    await insert.run(context);
    expect(fake.dialogOptions).toEqual([]);
    expect(last().error).toBe(true);
    expect(last().text).toContain('part.nc');
    expect(lines()).toEqual(PROGRAM);
  });

  it('is not opened in the channel view', async () => {
    fake.layout = 'channels';
    file('G0 X0\n');
    await append.run(context);
    expect(fake.dialogOptions).toEqual([]);
    expect(last().error).toBe(true);
  });
});

describe('insert in a real model', () => {
  it('goes before the cursor line in column 1 and selects the inserted lines', async () => {
    file('N100 G1 Z-1\nN110 G1 Z-2\n');
    fake.cursor = { line: 3, column: 1 };
    await insert.run(context);
    expect(lines()).toEqual(['O1000', 'N10 G90 G54', 'N100 G1 Z-1', 'N110 G1 Z-2', 'N20 G1 X1', 'N30 G1 X2', 'N40 M30', '%']);
    expect(fake.selected).toEqual([{ first: 3, last: 4 }]);
    expect(last().text).toBe('Inserted 2 lines from cut.nc at lines 3–4. Undo takes them back.');
    expect(last().error).toBe(false);
  });

  it('goes after the cursor line when the cursor is not in column 1', async () => {
    file('N100 G1 Z-1');
    fake.cursor = { line: 3, column: 4 };
    await insert.run(context);
    expect(lines()).toEqual(['O1000', 'N10 G90 G54', 'N20 G1 X1', 'N100 G1 Z-1', 'N30 G1 X2', 'N40 M30', '%']);
    expect(fake.selected).toEqual([{ first: 4, last: 4 }]);
    expect(last().text).toBe('Inserted 1 line from cut.nc at line 4. Undo takes it back.');
  });

  it('goes after the last line of a selection', async () => {
    file('N100 G1 Z-1\n');
    fake.cursor = { line: 2, column: 1 };
    fake.selection = { startLine: 2, endLine: 4, empty: false };
    await insert.run(context);
    expect(lines().slice(0, 7)).toEqual(['O1000', 'N10 G90 G54', 'N20 G1 X1', 'N30 G1 X2', 'N100 G1 Z-1', 'N40 M30', '%']);
    expect(fake.selected).toEqual([{ first: 5, last: 5 }]);
  });

  it('is one undo step, and redo puts it back', async () => {
    file('A1\nA2\nA3\n');
    fake.cursor = { line: 3, column: 1 };
    await insert.run(context);
    expect(lines()).toHaveLength(PROGRAM.length + 3);
    fake.model.undo();
    expect(lines()).toEqual(PROGRAM);
    fake.model.redo();
    expect(lines()).toHaveLength(PROGRAM.length + 3);
  });
});

describe('append in a real model', () => {
  it('goes after the last line of a document without a final line break', async () => {
    open(OPEN.join('\n'));
    file('N100 G1 Z-1\nN110 G1 Z-2\n');
    await append.run(context);
    expect(lines()).toEqual([...OPEN, 'N100 G1 Z-1', 'N110 G1 Z-2']);
    expect(fake.selected).toEqual([{ first: 6, last: 7 }]);
  });

  it('goes before the empty last line of a document with a final line break', async () => {
    open(`${OPEN.join('\n')}\n`);
    file('N100 G1 Z-1\nN110 G1 Z-2\n');
    await append.run(context);
    expect(lines()).toEqual([...OPEN, 'N100 G1 Z-1', 'N110 G1 Z-2', '']);
    expect(fake.selected).toEqual([{ first: 6, last: 7 }]);
  });

  it('goes before a closing %, also with a final line break (owner 2026-10-20)', async () => {
    for (const text of [PROGRAM.join('\n'), `${PROGRAM.join('\n')}\n`]) {
      open(text);
      fake.selected = [];
      file('N100 G1 Z-1\nN110 G1 Z-2\n');
      await append.run(context);
      expect(lines().slice(0, 8), JSON.stringify(text)).toEqual([...OPEN, 'N100 G1 Z-1', 'N110 G1 Z-2', '%']);
      expect(fake.selected).toEqual([{ first: 6, last: 7 }]);
    }
  });

  it('is one undo step', async () => {
    file('A1\nA2');
    await append.run(context);
    fake.model.undo();
    expect(fake.model.getValue()).toBe(PROGRAM.join('\n'));
  });
});

describe('line endings', () => {
  const CRLF = (rows: string[]): string => `${rows.join('\r\n')}\r\n`;

  it('writes a file with LF, CRLF, CR or mixed endings with the document’s own ending (CRLF document)', async () => {
    for (const body of ['A1\nA2\nA3\n', 'A1\r\nA2\r\nA3\r\n', 'A1\rA2\rA3\r', 'A1\nA2\r\nA3\n']) {
      open(CRLF(PROGRAM));
      file(body);
      fake.cursor = { line: 2, column: 1 };
      await insert.run(context);
      const text = fake.model.getValue();
      expect(text, JSON.stringify(body)).toBe(CRLF(['O1000', 'A1', 'A2', 'A3', ...PROGRAM.slice(1)]));
      expect(text.replace(/\r\n/g, '').includes('\n'), JSON.stringify(body)).toBe(false);
      expect(text.replace(/\r\n/g, '').includes('\r'), JSON.stringify(body)).toBe(false);
    }
  });

  it('writes a CRLF file into an LF document with LF endings', async () => {
    file('A1\r\nA2\r\n');
    await append.run(context);
    expect(fake.model.getValue()).toBe(`${OPEN.join('\n')}\nA1\nA2\n%`);
  });

  it('drops one final line break of the file and no more', async () => {
    file('A1\n\n');
    await append.run(context);
    expect(lines()).toEqual([...OPEN, 'A1', '', '%']);
  });
});

describe('the file as Open reads it', () => {
  it('reads UTF-8 with a BOM, UTF-16 and the Windows-1252 fallback', async () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc('(Müller)\n')]);
    const utf16 = new Uint8Array([0xff, 0xfe, ...[...'(Müller)\n'].flatMap((c) => [c.charCodeAt(0), 0])]);
    const cp1252 = new Uint8Array([0x28, 0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x29, 0x0a]);
    for (const bytes of [bom, utf16, cp1252]) {
      open(PROGRAM.join('\n'));
      file(bytes);
      await append.run(context);
      expect(lines().slice(-2), String(bytes[0])).toEqual(['(Müller)', '%']);
    }
  });

  it('refuses a binary file and inserts nothing', async () => {
    // A program with 600 NUL bytes in the middle of it: data, not text.
    const bytes = new Uint8Array([...enc('G0 X0\nG1 X1\n'), ...new Uint8Array(600), ...enc('G1 X2\nG1 X3\n')]);
    expect(decodeFile(bytes).ok).toBe(false);
    file(bytes);
    await append.run(context);
    expect(lines()).toEqual(PROGRAM);
    expect(last().error).toBe(true);
    expect(last().text).toMatch(/^cut\.nc is \d+% NUL bytes/);
    expect(last().text).toContain('Nothing was inserted');
  });

  it('drops stray NUL bytes and says how many', async () => {
    const bytes = enc('G0 X0\nG1 X1\nG1 X2 Y2 Z2 F200\nG1 X3 Y3 Z3 F200\n');
    const withNul = new Uint8Array([...bytes.slice(0, 3), 0, 0, ...bytes.slice(3)]);
    file(withNul);
    await append.run(context);
    expect(lines().slice(-5, -3)).toEqual(['G0 X0', 'G1 X1']);
    expect(last().text).toContain('Left out 2 NUL bytes of the file.');
  });

  it('refuses an empty file, and one that is a single line break', async () => {
    for (const text of ['', '\n', '\r\n']) {
      file(text);
      await append.run(context);
      expect(lines(), JSON.stringify(text)).toEqual(PROGRAM);
      expect(last().text).toBe('cut.nc is empty. Nothing was inserted.');
      expect(last().error).toBe(true);
    }
  });

  it('refuses a file above the size Open accepts, before reading it', async () => {
    file('G0 X0\n');
    fake.size = LIMIT + 1;
    let read = false;
    fake.whileReading = () => {
      read = true;
    };
    await append.run(context);
    expect(read).toBe(false);
    expect(lines()).toEqual(PROGRAM);
    expect(last().text).toBe('cut.nc is 50 MB, which is more than the 50 MB gEdit can open. Nothing was inserted.');
  });

  it('takes a file of exactly the limit', async () => {
    file('G0 X0\n');
    fake.size = LIMIT;
    await append.run(context);
    expect(lines().slice(-2)).toEqual(['G0 X0', '%']);
  });

  it('refuses when nobody can say how large the file is', async () => {
    for (const size of [null, 'reject', 'unavailable'] as const) {
      file('G0 X0\n');
      fake.size = size;
      await append.run(context);
      expect(lines(), String(size)).toEqual(PROGRAM);
      expect(last().text, String(size)).toContain('Could not tell how large cut.nc is');
    }
  });

  it('refuses a file that cannot be read', async () => {
    fake.picked = [FILE];
    fake.size = 10;
    await append.run(context);
    expect(lines()).toEqual(PROGRAM);
    expect(last().text).toBe('Could not read cut.nc. Nothing was inserted.');
  });

  it('refuses when the document was locked while the file was read', async () => {
    file('G0 X0\n');
    fake.whileReading = () => {
      fake.readOnly = true;
    };
    await append.run(context);
    expect(lines()).toEqual(PROGRAM);
    expect(last().error).toBe(true);
    expect(last().text).toContain('part.nc');
  });
});

describe('the program end', () => {
  it('warns in the status bar when the insert comes after it, and goes ahead', async () => {
    file('N100 G1 Z-1\n');
    await append.run(context);
    expect(lines().slice(-3)).toEqual(['N40 M30', 'N100 G1 Z-1', '%']);
    expect(last().text).toBe(
      'Inserted 1 line from cut.nc at line 6. Undo takes it back. The program ends at line 5. The inserted blocks come after it and do not run unless they are called.',
    );
    expect(last().error).toBe(true);
  });

  it('is silent inside the program', async () => {
    file('N100 G1 Z-1\n');
    fake.cursor = { line: 3, column: 2 };
    await insert.run(context);
    expect(last().text).not.toContain('program ends');
    expect(last().error).toBe(false);
  });
});

describe('Klartext', () => {
  const KT = ['0 BEGIN PGM A MM', '1 L X+0 Y+0 FMAX', '2 L X+10', '3 L X+20', '4 END PGM A MM'];

  it('refuses a second program start and leaves the program as it is', async () => {
    open(KT.join('\n'), KLARTEXT);
    file('1 L X+1\n2 BEGIN PGM B MM\n');
    fake.cursor = { line: 2, column: 3 };
    await insert.run({ ...context, profileId: 'heidenhain-klartext' });
    expect(lines()).toEqual(KT);
    expect(fake.selected).toEqual([]);
    expect(last().error).toBe(true);
    expect(last().text).toBe(
      'The file starts a second program (“2 BEGIN PGM B MM” at its line 2). A program of this control holds only one: remove that line from the file first. Nothing was inserted.',
    );
  });

  it('numbers the inserted blocks and those below consecutively, in one undo step', async () => {
    open(KT.join('\n'), KLARTEXT);
    file('9 L X+5\n9 L X+6\n');
    fake.cursor = { line: 3, column: 3 };
    await insert.run(context);
    expect(lines()).toEqual(['0 BEGIN PGM A MM', '1 L X+0 Y+0 FMAX', '2 L X+10', '3 L X+5', '4 L X+6', '5 L X+20', '6 END PGM A MM']);
    expect(fake.selected).toEqual([{ first: 4, last: 5 }]);
    expect(last().text).toContain('Renumbered 4 blocks.');
    fake.model.undo();
    expect(lines()).toEqual(KT);
  });

  it('undoes a renumbering of more than 1,000 blocks as one step', async () => {
    const big = ['0 BEGIN PGM A MM', ...Array.from({ length: 1500 }, (_, i) => `${i + 1} L X+${i}`), '1501 END PGM A MM'];
    open(big.join('\n'), KLARTEXT);
    file('9 L X+1\n');
    fake.cursor = { line: 2, column: 2 };
    await insert.run(context);
    expect(lines()).toHaveLength(big.length + 1);
    expect(lines()[3]).toBe('3 L X+1');
    expect(lines()[big.length]).toBe('1502 END PGM A MM');
    fake.model.undo();
    expect(lines()).toEqual(big);
  });

  it('refuses more blocks below than a renumbering may change', async () => {
    const big = ['0 BEGIN PGM A MM', ...Array.from({ length: 5002 }, (_, i) => `${i + 1} L X+${i}`)];
    open(big.join('\n'), KLARTEXT);
    file('1 L X+1\n');
    fake.cursor = { line: 1, column: 2 };
    await insert.run(context);
    expect(lines()).toEqual(big);
    expect(last().text).toContain('More than 5000 blocks below would need new numbers');
  });
});

describe('every other profile keeps the numbers', () => {
  it('writes the file’s block numbers as they are and edits nothing below', async () => {
    file('N10 G1 X1\nN10 G1 X2\n');
    fake.cursor = { line: 2, column: 1 };
    await insert.run(context);
    expect(lines()).toEqual(['O1000', 'N10 G1 X1', 'N10 G1 X2', ...PROGRAM.slice(1)]);
    expect(last().text).not.toContain('Renumbered');
  });
});

// -- P4c review fixes (F1) ------------------------------------------------------------------

describe('the program must still be the one in front after the read (CODE-5)', () => {
  it('another document became active while the file was read: refused, nothing inserted', async () => {
    file('N100 G1 Z-1\n');
    fake.cursor = { line: 3, column: 1 };
    fake.whileReading = () => {
      fake.activeId = 'd2';
    };
    await insert.run(context);
    expect(lines()).toEqual(PROGRAM);
    expect(fake.selected).toEqual([]);
    expect(last()).toEqual({ text: 'While the file was read, the program was closed or locked, or another program came to the front. Nothing was inserted.', error: true });
  });

  it('the focused editor shows another document (split view): refused, the cursor of that editor is not used', async () => {
    file('N100 G1 Z-1\n');
    fake.whileReading = () => {
      fake.focusedDoc = 'd2';
    };
    await append.run(context);
    expect(lines()).toEqual(PROGRAM);
    expect(last().text).toContain('another program came to the front');
  });

  it('the comparison opened while the file was read: refused with the command’s name', async () => {
    file('N100 G1 Z-1\n');
    fake.whileReading = () => {
      fake.overlay = 'compare';
    };
    await append.run(context);
    expect(lines()).toEqual(PROGRAM);
    expect(last()).toEqual({ text: 'Append File is not available while the channel view or the comparison is open.', error: true });
  });
});

describe('the not-available message names the command (CODE-13)', () => {
  it('Insert File and Append File each say their own name', async () => {
    fake.layout = 'channels';
    file('G0 X0\n');
    await insert.run(context);
    expect(last().text).toBe('Insert File is not available while the channel view or the comparison is open.');
    await append.run(context);
    expect(last().text).toBe('Append File is not available while the channel view or the comparison is open.');
  });
});

describe('frames, edges and numbers in a real model (P4c review)', () => {
  it('leaves out the file’s % lines and says so (NC-1)', async () => {
    file('%\nN100 G1 Z-1\n%\n');
    fake.cursor = { line: 3, column: 1 };
    await insert.run(context);
    expect(lines()).toEqual(['O1000', 'N10 G90 G54', 'N100 G1 Z-1', 'N20 G1 X1', 'N30 G1 X2', 'N40 M30', '%']);
    expect(last().text).toBe('Inserted 1 line from cut.nc at line 3. Undo takes it back. Left out the 2 % lines of the file.');
    expect(last().error).toBe(false);
  });

  it('a file with a program of its own in the middle of a program goes in with a red warning (NC-1)', async () => {
    file('%\nO2000 (SUB)\nN10 G1 X1\nN20 M99\n%\n');
    fake.cursor = { line: 3, column: 5 };
    await insert.run(context);
    expect(lines().slice(3, 6)).toEqual(['O2000 (SUB)', 'N10 G1 X1', 'N20 M99']);
    expect(last().text).toBe(
      'Inserted 3 lines from cut.nc at lines 4–6. Undo takes them back. Left out the 2 % lines of the file. Line 4 (“O2000 (SUB)”) starts a program in the middle of this one: the blocks below it now belong to that program. Check the program.',
    );
    expect(last().error).toBe(true);
  });

  it('a program end of the file in the middle warns that the blocks below do not run (NC-1)', async () => {
    file('N100 G1 X1\nN110 M30\n');
    fake.cursor = { line: 3, column: 5 };
    await insert.run(context);
    expect(last().text).toContain('Line 5 (“N110 M30”) ends the program in the middle: the blocks below it do not run. Check the program.');
    expect(last().error).toBe(true);
  });

  it('with the cursor where Open leaves it (1:1) the lines go below the program-start line (NC-3)', async () => {
    file('N100 G1 Z-1\n');
    await insert.run(context);
    expect(lines().slice(0, 3)).toEqual(['O1000', 'N100 G1 Z-1', 'N10 G90 G54']);
  });

  it('below the closing % it warns that the control reads nothing there (NC-5)', async () => {
    file('N100 G1 Z-1\n');
    fake.cursor = { line: 6, column: 2 };
    await insert.run(context);
    expect(lines().slice(-2)).toEqual(['%', 'N100 G1 Z-1']);
    expect(last().text).toBe(
      'Inserted 1 line from cut.nc at line 7. Undo takes it back. The % at line 6 ends the tape. The control reads nothing after it, so it does not read the inserted lines.',
    );
    expect(last().error).toBe(true);
  });

  it('a file of nothing but % lines is refused', async () => {
    file('%\n%\n');
    await append.run(context);
    expect(lines()).toEqual(PROGRAM);
    expect(last()).toEqual({ text: 'cut.nc holds only % lines, and an insert leaves them out. Nothing was inserted.', error: true });
  });

  it('Okuma: a first line with $ is refused, naming the mark (NC-6)', async () => {
    open(['O1', 'N10 G1 X1', 'N20 G1 X2', 'M02'].join('\n'), cpOf('okuma-osp'));
    file('$Y5\nN15 X3\n');
    fake.cursor = { line: 2, column: 5 };
    await insert.run(context);
    expect(lines()).toEqual(['O1', 'N10 G1 X1', 'N20 G1 X2', 'M02']);
    expect(last()).toEqual({ text: 'The first line of cut.nc starts with “$”, so it would become part of the block above it. Nothing was inserted.', error: true });
  });
});

describe('Klartext: frames, edges and numbers (P4c review)', () => {
  const KT = ['0 BEGIN PGM A MM', '1 L X+0 Y+0 FMAX', '2 L X+10', '3 L X+20', '4 END PGM A MM'];

  it('refuses END PGM in the file, naming its line (NC-2)', async () => {
    open(KT.join('\n'), KLARTEXT);
    file('5 L X+1\n6 END PGM SUB MM\n');
    fake.cursor = { line: 3, column: 1 };
    await insert.run(context);
    expect(lines()).toEqual(KT);
    expect(last()).toEqual({
      text: 'The file ends a program (“6 END PGM SUB MM” at its line 2). The program would end there, before the blocks below it: remove that line from the file first. Nothing was inserted.',
      error: true,
    });
  });

  it('refuses a whole program in the file, naming both lines (NC-2)', async () => {
    open(KT.join('\n'), KLARTEXT);
    file('0 BEGIN PGM B MM\n1 L X+1\n2 END PGM B MM\n');
    fake.cursor = { line: 3, column: 1 };
    await insert.run(context);
    expect(lines()).toEqual(KT);
    expect(last().text).toBe(
      'The file is a program of its own (“0 BEGIN PGM B MM” at its line 1, “2 END PGM B MM” at its line 3). A program of this control holds only one: remove those lines from the file first. Nothing was inserted.',
    );
  });

  it('refuses a last line with ~, naming the mark (NC-6)', async () => {
    open(KT.join('\n'), KLARTEXT);
    file('5 L X+1\n6 L X+2 ; x ~\n');
    fake.cursor = { line: 2, column: 3 };
    await insert.run(context);
    expect(lines()).toEqual(KT);
    expect(last().text).toBe(
      'The last line of cut.nc ends with “~”, so the block below it would become part of it. Complete that block in the file first. Nothing was inserted.',
    );
  });

  it('at 1:1 the blocks go below BEGIN PGM and are numbered, also without numbers of their own (NC-3, NC-4)', async () => {
    open(KT.join('\n'), KLARTEXT);
    file('L X+1\nL X+2\n');
    await insert.run(context);
    expect(lines()).toEqual(['0 BEGIN PGM A MM', '1 L X+1', '2 L X+2', '3 L X+0 Y+0 FMAX', '4 L X+10', '5 L X+20', '6 END PGM A MM']);
    expect(last().text).toBe('Inserted 2 lines from cut.nc at lines 2–3. Undo takes them back. Renumbered 6 blocks.');
  });

  it('Append goes before END PGM and numbers on (SK-1)', async () => {
    open(`${KT.join('\n')}\n`, KLARTEXT);
    file('L X+5\n');
    await append.run(context);
    expect(lines()).toEqual(['0 BEGIN PGM A MM', '1 L X+0 Y+0 FMAX', '2 L X+10', '3 L X+20', '4 L X+5', '5 END PGM A MM', '']);
    expect(last().error).toBe(false);
  });
});
