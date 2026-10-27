// The rows and the notes of Find in Folder (P4.28; plan section 6.8.3).

import { describe, expect, it } from 'vitest';
import type { FolderSummary } from '$lib/platform/commands';
import { fileRow, folderName, grouped, hitRows, hitText, isPartial, modifiedLabel, notesOf } from './rows';
import type { FolderOutcome } from './rows';

const META = { path: '/nc/lathe1/a/part.nc', rel: 'a/part.nc', bytes: 120, mtimeMs: new Date(2026, 9, 5, 7, 3).getTime() };

function summary(over: Partial<FolderSummary> = {}, skipped: Partial<FolderSummary['skipped']> = {}): FolderSummary {
  return {
    entriesSeen: 10,
    filesRead: 4,
    filesSent: 4,
    bytesRead: 100,
    skipped: { binary: 0, tooLarge: 0, unreadable: 0, links: 0, hidden: 0, tooDeep: 0, bigFolders: 0, ...skipped },
    stoppedBy: null,
    tooLargeNames: [],
    ...over,
  };
}

function outcome(over: Partial<FolderOutcome> = {}): FolderOutcome {
  return { summary: summary(), stoppedByUser: false, capped: false, slowFile: null, undecoded: 0, queryRefused: [], ...over };
}

describe('folder rows', () => {
  it('shows the modified time as local YYYY-MM-DD HH:mm, empty without one', () => {
    expect(modifiedLabel(META.mtimeMs)).toBe('2026-10-05 07:03');
    expect(modifiedLabel(null)).toBe('');
    expect(modifiedLabel(Number.NaN)).toBe('');
    expect(modifiedLabel(8.64e15 + 1)).toBe('');
  });

  it('gives a file row without a line, with the keys that open it', () => {
    const row = fileRow(META, '/nc/lathe1');
    expect(row).toEqual({ file: 'a/part.nc', path: '/nc/lathe1/a/part.nc', root: '/nc/lathe1', modified: '2026-10-05 07:03', bytes: 120 });
    expect('line' in row).toBe(false);
  });

  it('gives a row per hit with the line and its text', () => {
    const rows = hitRows(META, '/nc/lathe1', [
      { line: 3, start: 0, end: 3, text: '  T17 M6  ' },
      { line: 40, start: 0, end: 2, text: 'G1 X1' },
    ]);
    expect(rows.map((row) => [row.line, row.text])).toEqual([
      [3, 'T17 M6'],
      [40, 'G1 X1'],
    ]);
    expect(rows.every((row) => row.path === META.path && row.root === '/nc/lathe1' && row.file === 'a/part.nc')).toBe(true);
  });

  it('cuts a long line to about 200 characters around the hit, like Find All', () => {
    const line = `${'A'.repeat(300)}HIT${'B'.repeat(300)}`;
    const text = hitText({ line: 1, start: 300, end: 303, text: line });
    expect(text.startsWith('…')).toBe(true);
    expect(text.endsWith('…')).toBe(true);
    expect(text).toContain('HIT');
    expect(text.length).toBeLessThanOrEqual(202);
  });

  it('names a folder by its last part, with either separator and a share root', () => {
    expect(folderName('/nc/lathe1')).toBe('lathe1');
    expect(folderName('C:\\nc\\mill 2\\')).toBe('mill 2');
    expect(folderName('\\\\dnc\\lathe1')).toBe('lathe1');
    expect(folderName('/')).toBe('/');
    expect(grouped(20000)).toBe('20,000');
  });
});

describe('Q5: the notes of the message', () => {
  it('say nothing for a clean search', () => {
    expect(notesOf(outcome())).toEqual([]);
    expect(isPartial(outcome())).toBe(false);
  });

  it('count every kind of file and folder that was not read, never silently', () => {
    const notes = notesOf(
      outcome({
        summary: summary({ tooLargeNames: ['big.nc', 'huge.nc'] }, { binary: 2, tooLarge: 2, unreadable: 1, links: 3, hidden: 4, tooDeep: 5, bigFolders: 6 }),
        undecoded: 1,
      }),
    );
    expect(notes.map((note) => note.key)).toEqual([
      'findInFolder.skipBinary',
      'findInFolder.skipTooLarge',
      'findInFolder.skipUnreadable',
      'findInFolder.skipLinks',
      'findInFolder.skipHidden',
      'findInFolder.skipTooDeep',
      'findInFolder.skipBigFolders',
    ]);
    // The binary files of the walk and the ones the codec refused are one count.
    expect(notes[0].params).toEqual({ count: 3 });
    expect(notes[1].params).toEqual({ count: 2, mb: 16, names: 'big.nc, huge.nc', more: 0 });
  });

  it('say how many large files are not listed by name', () => {
    const names = Array.from({ length: 20 }, (_, i) => `f${i}.nc`);
    const [note] = notesOf(outcome({ summary: summary({ tooLargeNames: names }, { tooLarge: 25 }) }));
    expect(note.key).toBe('findInFolder.skipTooLargeMore');
    expect(note.params).toMatchObject({ count: 25, more: 5 });
  });

  it('name why a search stopped, first, and mark the list as partial', () => {
    expect(notesOf(outcome({ capped: true }))[0]).toEqual({ key: 'findInFolder.stoppedHits', params: { count: '10,000' } });
    expect(notesOf(outcome({ stoppedByUser: true }))[0]).toEqual({ key: 'findInFolder.stoppedUser' });
    expect(notesOf(outcome({ slowFile: 'a/slow.nc' }))[0]).toEqual({ key: 'findInFolder.stoppedSlow', params: { file: 'a/slow.nc' } });
    expect(notesOf(outcome({ summary: summary({ stoppedBy: 'files' }) }))[0]).toEqual({ key: 'findInFolder.stoppedFiles', params: { count: '20,000' } });
    expect(notesOf(outcome({ summary: summary({ stoppedBy: 'entries' }) }))[0]).toEqual({ key: 'findInFolder.stoppedEntries', params: { count: '200,000' } });
    expect(notesOf(outcome({ summary: summary({ stoppedBy: 'time' }) }))[0]).toEqual({ key: 'findInFolder.stoppedTime', params: { minutes: 10 } });
    expect(notesOf(outcome({ summary: summary({ stoppedBy: 'bytes' }) }))[0]).toEqual({ key: 'findInFolder.stoppedBytes' });
    for (const over of [{ capped: true }, { stoppedByUser: true }, { slowFile: 'x' }, { summary: summary({ stoppedBy: 'time' as const }) }]) {
      expect(isPartial(outcome(over))).toBe(true);
    }
  });

  it('names the first file whose dialect could not read the query', () => {
    const [note] = notesOf(
      outcome({ queryRefused: [{ file: 'a.nc', message: 'm1' }, { file: 'b.nc', message: 'm2' }] }),
    );
    expect(note).toEqual({ key: 'findInFolder.skipQuery', params: { count: 2, file: 'a.nc', message: 'm1' } });
  });

  it('keeps the notes of a search whose walk failed to summarise (no summary yet)', () => {
    expect(notesOf(outcome({ summary: null, undecoded: 2 }))).toEqual([{ key: 'findInFolder.skipBinary', params: { count: 2 } }]);
  });
});
