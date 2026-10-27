// `readMachine` and the `folders` member of a machine (P4.30a; plan 6.8.4, rule R5): the member
// is kept as written, a wrong list is reported with its JSON paths and costs the list, never
// the record.

import { describe, expect, it } from 'vitest';
import { emptyMachinesFile, parseMachinesFile, serializeMachinesFile } from './file';
import { foldersOf, machineForPath } from './folderRules';
import { readMachine } from './validate';

const FRESH = { path: 'machines[3]', ids: new Set<string>(), names: new Set<string>() };

function record(folders?: unknown): Record<string, unknown> {
  return { id: 'lathe-1', name: 'Lathe 1', profile: 'fanuc-lathe', params: {}, ...(folders === undefined ? {} : { folders }) };
}

describe('readMachine keeps the folders', () => {
  it('a record with a good list is the record, as written, with no problem', () => {
    const folders = [{ path: 'D:\\DNC\\Lathe1' }, { path: '/dnc/lathe1', subfolders: false }, { path: '/x', future: 1 }];
    const r = readMachine(record(folders), FRESH);
    expect(r.problems).toEqual([]);
    expect((r.machine as { folders?: unknown }).folders).toEqual(folders);
    expect(foldersOf(r.machine!, FRESH.path).folders).toHaveLength(3);
  });

  it('a record without folders has none and no problem', () => {
    const r = readMachine(record(), FRESH);
    expect(r.problems).toEqual([]);
    expect(r.machine).not.toBeNull();
    expect(foldersOf(r.machine!, FRESH.path).folders).toEqual([]);
  });

  it('a wrong list is reported with JSON paths, the record is kept and the rule finds no folder in it', () => {
    const r = readMachine(record([{ path: '/dnc/lathe1' }, { path: 'relative\\dir' }]), FRESH);
    expect(r.machine).not.toBeNull();
    expect(r.machine?.id).toBe('lathe-1');
    expect(r.problems).toEqual([
      { machineId: 'lathe-1', path: 'machines[3].folders[1].path', message: expect.stringContaining('absolute') },
    ]);
    expect(machineForPath('/dnc/lathe1/p.nc', [r.machine!], { caseInsensitive: false })).toEqual({ kind: 'none' });
  });

  it('the broken list stays in the file when the file is read and written back', () => {
    const raw = { $version: 1, machines: [record('not a list')], defaults: {} };
    const file = parseMachinesFile(raw);
    expect(file.invalid).toEqual([]);
    expect(file.machines).toHaveLength(1);
    expect(serializeMachinesFile(file).machines).toEqual([record('not a list')]);
    expect(emptyMachinesFile().machines).toEqual([]);
  });

  it('an identity problem still wins: the record is refused as before', () => {
    const r = readMachine({ ...record([{ path: '/dnc' }]), id: 'Bad Id' }, FRESH);
    expect(r.machine).toBeNull();
    expect(r.problems.some((p) => p.path === 'machines[3].id')).toBe(true);
  });
});
