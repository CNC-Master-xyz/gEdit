// Folder rules (P4.30a; rules R1 to R6 in `folderRules.ts` and plan section 6.8.4).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MAX_FOLDER_CHARS,
  MAX_FOLDERS,
  folderConflicts,
  folderNote,
  foldersOf,
  machineForPath,
  normalizeFolderPath,
  type FolderMatch,
} from './folderRules';
import type { MachineConfig } from './types';

const WIN = { caseInsensitive: true };
const LINUX = { caseInsensitive: false };

function machine(id: string, folders?: unknown, name = id): MachineConfig {
  return { id, name, profile: 'fanuc-lathe', params: {}, ...(folders === undefined ? {} : { folders }) } as MachineConfig;
}

describe('folder rules', () => {
  it('the limits are the plan s', () => {
    expect(MAX_FOLDERS).toBe(16);
    expect(MAX_FOLDER_CHARS).toBe(1024);
  });

  describe('R1: text only, separators and case', () => {
    it('folds separators, drops the closing separator and lowers the drive letter', () => {
      expect(normalizeFolderPath('D:\\DNC\\Lathe1\\', true)).toBe('d:/dnc/lathe1');
      expect(normalizeFolderPath('d:/dnc//lathe1/./', true)).toBe('d:/dnc/lathe1');
      expect(normalizeFolderPath('D:\\', true)).toBe('d:/');
      expect(normalizeFolderPath('/', false)).toBe('/');
    });

    it('a drive letter and a network host never depend on case; the rest follows the platform', () => {
      expect(normalizeFolderPath('D:\\DNC', false)).toBe('d:/DNC');
      expect(normalizeFolderPath('\\\\SERVER\\Share\\Lathe1', false)).toBe('//server/Share/Lathe1');
      expect(normalizeFolderPath('//SERVER/Share/Lathe1', true)).toBe('//server/share/lathe1');
      expect(normalizeFolderPath('\\\\?\\D:\\DNC', true)).toBe('d:/dnc');
      expect(normalizeFolderPath('/DNC/Lathe1', true)).toBe('/dnc/lathe1');
      expect(normalizeFolderPath('/DNC/Lathe1', false)).toBe('/DNC/Lathe1');
    });

    it('a backslash is a separator in a Windows path and a file name character in a path from /', () => {
      expect(normalizeFolderPath('/dnc/a\\b', false)).toBe('/dnc/a\\b');
    });

    it('one folder in two spellings finds the same machine (Windows)', () => {
      const m = [machine('lathe1', [{ path: 'D:\\DNC\\Lathe1' }])];
      for (const doc of ['d:/dnc/lathe1/part.nc', 'D:\\Dnc\\LATHE1\\sub\\part.nc', '\\\\?\\D:\\DNC\\Lathe1\\part.nc']) {
        expect(machineForPath(doc, m, WIN)).toEqual({ kind: 'machine', machineId: 'lathe1', folder: 'D:\\DNC\\Lathe1' });
      }
    });

    it('Linux keeps the case of the path', () => {
      const m = [machine('lathe1', [{ path: '/dnc/Lathe1' }])];
      expect(machineForPath('/dnc/Lathe1/p.nc', m, LINUX).kind).toBe('machine');
      expect(machineForPath('/dnc/lathe1/p.nc', m, LINUX).kind).toBe('none');
      expect(machineForPath('/dnc/lathe1/p.nc', m, WIN).kind).toBe('machine');
    });

    it('a folder name that only starts like the folder does not match', () => {
      const m = [machine('lathe1', [{ path: '/dnc/lathe1' }])];
      expect(machineForPath('/dnc/lathe10/p.nc', m, LINUX).kind).toBe('none');
      expect(machineForPath('/dnc/lathe1', m, LINUX).kind).toBe('none'); // the folder itself is not a file in it
    });

    it('a link or another spelling of the folder is not resolved', () => {
      const m = [machine('lathe1', [{ path: '\\\\server\\share\\lathe1' }])];
      expect(machineForPath('Z:\\lathe1\\p.nc', m, WIN).kind).toBe('none'); // the mapped drive
      expect(machineForPath('\\\\server\\share\\lathe1\\p.nc', m, WIN).kind).toBe('machine');
    });

    it('a root folder holds every file below it', () => {
      expect(machineForPath('D:\\p.nc', [machine('a', [{ path: 'D:\\' }])], WIN).kind).toBe('machine');
      expect(machineForPath('/p.nc', [machine('a', [{ path: '/' }])], LINUX).kind).toBe('machine');
    });

    it('a document path that is relative or climbs with ".." is matched by nothing', () => {
      const m = [machine('a', [{ path: '/dnc' }])];
      expect(machineForPath('dnc/p.nc', m, LINUX).kind).toBe('none');
      expect(machineForPath('/dnc/../etc/p.nc', m, LINUX).kind).toBe('none');
    });
  });

  describe('R2: the longest folder wins', () => {
    const m = [
      machine('all', [{ path: '/dnc' }]),
      machine('lathe1', [{ path: '/dnc/lathe1' }]),
      machine('top', [{ path: '/dnc/lathe1/top', subfolders: false }]),
    ];

    it('picks the deepest folder that holds the file', () => {
      expect(machineForPath('/dnc/x.nc', m, LINUX)).toMatchObject({ kind: 'machine', machineId: 'all' });
      expect(machineForPath('/dnc/lathe1/x.nc', m, LINUX)).toMatchObject({ kind: 'machine', machineId: 'lathe1' });
      expect(machineForPath('/dnc/lathe1/deep/x.nc', m, LINUX)).toMatchObject({ kind: 'machine', machineId: 'lathe1' });
    });

    it('subfolders: false holds only the files directly in the folder', () => {
      expect(machineForPath('/dnc/lathe1/top/x.nc', m, LINUX)).toMatchObject({ machineId: 'top' });
      // the file below it falls to the next folder that does hold it
      expect(machineForPath('/dnc/lathe1/top/sub/x.nc', m, LINUX)).toMatchObject({ machineId: 'lathe1' });
    });

    it('a file in no folder has no rule', () => {
      expect(machineForPath('/other/x.nc', m, LINUX)).toEqual({ kind: 'none' });
      expect(machineForPath('/x.nc', [], LINUX)).toEqual({ kind: 'none' });
    });

    it('the same machine listing a folder twice is still one machine', () => {
      const twice = [machine('a', [{ path: '/dnc' }, { path: '/dnc/', subfolders: true }])];
      expect(machineForPath('/dnc/x.nc', twice, LINUX)).toMatchObject({ kind: 'machine', machineId: 'a' });
    });
  });

  describe('R3: two machines on the longest folder is an answer, not a guess', () => {
    const m = [machine('a', [{ path: '/dnc/shared' }], 'Lathe A'), machine('b', [{ path: '/dnc/shared/' }], 'Lathe B'), machine('c', [{ path: '/dnc' }])];

    it('answers ambiguous and names both', () => {
      expect(machineForPath('/dnc/shared/x.nc', m, LINUX)).toEqual({ kind: 'ambiguous', machineIds: ['a', 'b'], folder: '/dnc/shared' });
    });

    it('a shorter folder of a third machine does not break the tie', () => {
      expect(machineForPath('/dnc/other/x.nc', m, LINUX)).toMatchObject({ machineId: 'c' });
    });

    it('a deeper folder of one of them ends the tie for the files in it', () => {
      const deeper = [...m, machine('d', [{ path: '/dnc/shared/deep' }])];
      expect(machineForPath('/dnc/shared/deep/x.nc', deeper, LINUX)).toMatchObject({ kind: 'machine', machineId: 'd' });
    });

    it('folderConflicts lists one problem per shared folder, with both machines', () => {
      const problems = folderConflicts(m, LINUX);
      expect(problems).toHaveLength(1);
      expect(problems[0].machineIds).toEqual(['a', 'b']);
      expect(problems[0].message).toContain('"Lathe A" and "Lathe B"');
      expect(problems[0].message).toContain('/dnc/shared');
      expect(problems[0].path).toBe('machines[0].folders');
    });

    it('the case of a Windows path makes the same folder, so it is shared', () => {
      const win = [machine('a', [{ path: 'D:\\DNC' }]), machine('b', [{ path: 'd:/dnc' }])];
      expect(folderConflicts(win, WIN)).toHaveLength(1);
      expect(folderConflicts([machine('a', [{ path: '/DNC' }]), machine('b', [{ path: '/dnc' }])], LINUX)).toHaveLength(0);
    });

    it('no conflict when every folder has one machine', () => {
      expect(folderConflicts([machine('a', [{ path: '/a' }]), machine('b', [{ path: '/b' }])], LINUX)).toEqual([]);
    });
  });

  describe('R5: a broken list costs the list, with JSON paths', () => {
    const read = (folders: unknown) => foldersOf(machine('m', folders), 'machines[2]');

    it('reads a good list as written', () => {
      expect(read([{ path: 'D:\\DNC' }, { path: '/dnc', subfolders: false }])).toEqual({
        folders: [{ path: 'D:\\DNC' }, { path: '/dnc', subfolders: false }],
        problems: [],
      });
      expect(read(undefined)).toEqual({ folders: [], problems: [] });
      expect(read([])).toEqual({ folders: [], problems: [] });
    });

    it('a relative path is a problem and the list is dropped', () => {
      const r = read([{ path: '/ok' }, { path: 'dnc/lathe1' }]);
      expect(r.folders).toEqual([]);
      expect(r.problems).toHaveLength(1);
      expect(r.problems[0]).toMatchObject({ machineId: 'm', path: 'machines[2].folders[1].path' });
    });

    it('a ".." part, a NUL, a control character, an empty path, an overlong path', () => {
      for (const path of ['/dnc/../etc', 'D:\\dnc\\..\\x', '/dnc/a\u0000b', '/dnc/a\nb', '', `/${'a'.repeat(MAX_FOLDER_CHARS)}`]) {
        const r = read([{ path }]);
        expect(r.folders, JSON.stringify(path)).toEqual([]);
        expect(r.problems, JSON.stringify(path)).toHaveLength(1);
        expect(r.problems[0].path).toBe('machines[2].folders[0].path');
      }
    });

    it('a drive-relative path and a network path without a share are not absolute', () => {
      for (const path of ['D:dnc', '\\\\server', '\\dnc', 'C:']) {
        expect(read([{ path }]).problems, path).toHaveLength(1);
      }
    });

    it('the 17th folder is a problem', () => {
      const sixteen = Array.from({ length: 16 }, (_, k) => ({ path: `/dnc/${k}` }));
      expect(read(sixteen).problems).toEqual([]);
      const seventeen = [...sixteen, { path: '/dnc/16' }];
      const r = read(seventeen);
      expect(r.folders).toEqual([]);
      expect(r.problems[0]).toMatchObject({ path: 'machines[2].folders' });
    });

    it('a wrong shape: not a list, not an object, a path that is not text, subfolders that is not true or false', () => {
      expect(read('D:\\dnc').problems[0].path).toBe('machines[2].folders');
      expect(read({ path: '/dnc' }).problems[0].path).toBe('machines[2].folders');
      expect(read(['/dnc']).problems[0].path).toBe('machines[2].folders[0]');
      expect(read([{ path: 5 }]).problems[0].path).toBe('machines[2].folders[0].path');
      expect(read([{ path: '/dnc', subfolders: 'yes' }]).problems[0].path).toBe('machines[2].folders[0].subfolders');
      expect(read([null]).problems[0].path).toBe('machines[2].folders[0]');
    });

    it('a machine with a broken list claims no folder, the others still do', () => {
      const m = [machine('bad', [{ path: '/dnc' }, { path: 'relative' }]), machine('good', [{ path: '/dnc' }])];
      expect(machineForPath('/dnc/x.nc', m, LINUX)).toMatchObject({ kind: 'machine', machineId: 'good' });
      expect(folderConflicts(m, LINUX)).toEqual([]);
    });
  });

  describe('R6: nothing is read from the folder', () => {
    it('the module has no file system, no command and no network import', () => {
      const source = readFileSync(fileURLToPath(new URL('./folderRules.ts', import.meta.url)), 'utf8');
      const imports = [...source.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
      expect(imports.sort()).toEqual(['$lib/i18n', '$lib/utils/platform', './types'].sort());
      expect(source).not.toMatch(/\binvoke\b|\bfetch\(|from 'node:|readDir|stat\(/);
    });
  });

  describe('the status item line', () => {
    const list = [machine('a', undefined, 'Lathe A'), machine('b', undefined, 'Lathe B')];

    it('names the folder that chose the machine', () => {
      expect(folderNote({ kind: 'machine', machineId: 'a', folder: '\\\\dnc\\lathe1' }, list, 'folder')).toBe(
        'Machine chosen by its folder: \\\\dnc\\lathe1',
      );
    });

    it('says nothing when the document was chosen another way', () => {
      const match = { kind: 'machine', machineId: 'a', folder: '/dnc' } as const;
      expect(folderNote(match, list, 'document')).toBeNull();
      expect(folderNote(match, list, 'default')).toBeNull(); // a rule that was not applied
      expect(folderNote({ kind: 'none' }, list, 'none')).toBeNull();
    });

    it('names both machines of an ambiguous folder, unless the document has a machine of its own', () => {
      const match: FolderMatch = { kind: 'ambiguous', machineIds: ['a', 'b'], folder: '/dnc' };
      expect(folderNote(match, list, 'default')).toContain('Lathe A, Lathe B');
      expect(folderNote(match, list, 'none')).toContain('/dnc');
      expect(folderNote(match, list, 'document')).toBeNull();
    });
  });
});
