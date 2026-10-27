// The channel service with the folder and the job list (P4.30b; plan section 6.8.5): a channel
// file that cannot be named is looked for in the folder's listing, the path-1 file without the
// channel in its name, an open Siemens job list as the last source (`by: 'jobList'`), and the
// one status message about a job list that is not open (J1).

import { writable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import { cpOf } from '../../../tests/unit/helpers/profiles';
import type { ChannelParams } from '$lib/core/channels/types';
import type { MachineConfig } from '$lib/core/machines/types';
import type { ChannelBlock } from '$lib/core/machines/validate';
import type { FolderSiblings, SiblingInfo } from '$lib/platform/commands';
import type { DocId, DocMeta, Msg } from '$lib/app/types';

vi.mock('$lib/monaco/editorService', () => ({ editor: {} }));
vi.mock('$lib/stores/machines', () => ({ machines: {} }));
vi.mock('$lib/stores/fileMemory', () => ({ fileMemory: {} }));
vi.mock('$lib/stores/documents', () => ({ docs: {} }));

const { createChannelService } = await import('./channels');
const { channelStatusView } = await import('$lib/components/status/channelStatusView');

const WAIT = { id: 'wait', label: 'Waits', match: { kind: 'codes' as const, codes: 'M190-M199' }, partners: { kind: 'all' as const } };

/** The Fanuc three-path shape with the path-1 file written without an extension. */
const three: ChannelParams = {
  layout: 'multi-file',
  list: [
    { id: '1', name: 'Path 1' },
    { id: '2', name: 'Path 2' },
    { id: '3', name: 'Path 3' },
  ],
  fileName: '^(?<stem>.+)_(?<channel>\\d{1,2})\\.[A-Za-z]+$',
  firstFileName: '^(?<stem>[^.]+)$',
  syncMarks: [WAIT],
};

/** A Sinumerik two-channel shape: `SHAFT_CH2.MPF`; programs with other names have no channel by name. */
const siemens: ChannelParams = {
  layout: 'multi-file',
  list: [
    { id: '1', name: 'Channel 1' },
    { id: '2', name: 'Channel 2' },
  ],
  fileName: '^(?<stem>.+)_CH(?<channel>\\d)\\.MPF$',
  syncMarks: [WAIT],
};

interface World {
  svc: ReturnType<typeof createChannelService>;
  open(title: string, lines: string[], path: string | null): DocId;
  close(id: DocId): void;
  setLines(id: DocId, lines: string[]): void;
  runTimers(): void;
  siblingCalls: { path: string; names: string[] }[];
  siblingAnswer: (names: string[]) => SiblingInfo[];
  listCalls: { path: string; pattern: string }[];
  listAnswer: (pattern: string) => FolderSiblings | 'reject';
  said: Msg[];
  readCalls: [DocId, number, number][];
}

function world(params: ChannelParams, o: { folder?: boolean } = {}): World {
  const docs: DocMeta[] = [];
  const listStore = writable<DocMeta[]>(docs);
  const lines = new Map<DocId, string[]>();
  const handlers: ((id: DocId, c: never) => void)[] = [];
  const timers: (() => void)[] = [];
  const machine: MachineConfig = { id: 'm1', name: 'Machine', profile: 'fanuc-lathe', params: {} };
  const block: ChannelBlock = { state: 'valid', params };
  let next = 1;
  const w = {
    siblingCalls: [],
    siblingAnswer: (names: string[]) => names.map((name) => ({ name, exists: false, bytes: 0, modified: null, error: null })),
    listCalls: [],
    listAnswer: () => ({ names: [], truncated: false, unavailable: false }),
    said: [],
    readCalls: [],
  } as unknown as World;
  w.open = (title, text, path) => {
    const id = `d${next++}`;
    docs.push({ id, title, path } as DocMeta);
    lines.set(id, text);
    listStore.set([...docs]);
    return id;
  };
  w.close = (id) => {
    docs.splice(docs.findIndex((d) => d.id === id), 1);
    lines.delete(id);
    listStore.set([...docs]);
  };
  w.setLines = (id, text) => {
    lines.set(id, text);
    const change = { startLine: 1, endLineOld: text.length, endLineNew: text.length, flush: true, versionId: 0 };
    handlers.forEach((h) => h(id, change as never));
  };
  w.runTimers = () => {
    while (timers.length > 0) timers.shift()?.();
  };
  w.svc = createChannelService({
    docs: { get: (id) => docs.find((d) => d.id === id), all: () => docs, list: listStore },
    editor: {
      hasModel: (id) => lines.has(id),
      getLineCount: (id) => lines.get(id)?.length ?? 0,
      getLines: (id, a, b) => {
        w.readCalls.push([id, a, b]);
        return (lines.get(id) ?? []).slice(a - 1, b);
      },
      onDidChangeContent: (cb) => {
        handlers.push(cb);
        return () => {};
      },
    },
    effective: (id) => (docs.some((d) => d.id === id) ? { cp: cpOf('fanuc-lathe'), key: 'k', machineId: 'm1', machineName: 'Machine' } : null),
    machine: () => machine,
    block: () => block,
    memory: { get: () => undefined, remember: () => {} },
    siblingInfo: async (path, names) => {
      w.siblingCalls.push({ path, names });
      return w.siblingAnswer(names);
    },
    ...(o.folder === false
      ? {}
      : {
          folderSiblings: async (path: string, pattern: string) => {
            w.listCalls.push({ path, pattern });
            const answer = w.listAnswer(pattern);
            if (answer === 'reject') throw new Error('path is not allowed');
            return answer;
          },
          say: (msg: Msg) => void w.said.push(msg),
        }),
    schedule: (fn) => {
      timers.push(fn);
      return () => {
        const at = timers.indexOf(fn);
        if (at >= 0) timers.splice(at, 1);
      };
    },
    now: () => 0,
    caseInsensitive: true,
    delayMs: 150,
  });
  w.svc.start();
  return w;
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

/** Runs the scheduled sibling questions and lets their answers arrive. */
async function settle(w: World): Promise<void> {
  for (let i = 0; i < 3; i++) {
    w.runTimers();
    await flush();
  }
}

const members = (w: World, id: DocId) =>
  w.svc.forDoc(id).members.map((m) => (m.kind === 'file' ? [m.channel.id, m.name, m.path, m.docId === null ? 'closed' : 'open', m.by] : [m.channel.id]));

describe('siblings from the folder (L1 to L3) and the path-1 file', () => {
  it('from path 2, the path-1 file without an extension is found in the listing; path 3 by its derived name', async () => {
    const w = world(three);
    w.siblingAnswer = (names) => names.map((name) => ({ name, exists: name === 'PART_3.ISO', bytes: 1, modified: null, error: null }));
    w.listAnswer = (pattern) => ({ names: pattern === 'PART*' ? ['PART', 'PART_2.ISO', 'PART_3.ISO'] : [], truncated: false, unavailable: false });
    const id = w.open('PART_2.ISO', ['M190'], '/jobs/PART_2.ISO');
    expect(w.svc.forDoc(id).self?.id).toBe('2');
    await settle(w);
    // PART_1.ISO is still asked about (the name rule), but the listing decides channel 1.
    expect(w.siblingCalls).toEqual([{ path: '/jobs/PART_2.ISO', names: ['PART_1.ISO', 'PART_3.ISO'] }]);
    expect(w.listCalls).toContainEqual({ path: '/jobs/PART_2.ISO', pattern: 'PART*' });
    expect(members(w, id)).toEqual([
      ['1', 'PART', '/jobs/PART', 'closed', 'fileName'],
      ['2', 'PART_2.ISO', '/jobs/PART_2.ISO', 'open', 'fileName'],
      ['3', 'PART_3.ISO', '/jobs/PART_3.ISO', 'closed', 'fileName'],
    ]);
    expect(w.svc.forDoc(id).missing).toEqual([]);
  });

  it('the path-1 file itself is channel 1 and finds the other paths in the listing', async () => {
    const w = world(three);
    w.listAnswer = (pattern) => ({ names: pattern === 'PART*' ? ['PART', 'PART_2.ISO', 'PART_3.ISO'] : [], truncated: false, unavailable: false });
    const id = w.open('PART', ['M190'], '/jobs/PART');
    expect(w.svc.forDoc(id).self?.id).toBe('1');
    await settle(w);
    expect(members(w, id).map((m) => [m[0], m[1]])).toEqual([
      ['1', 'PART'],
      ['2', 'PART_2.ISO'],
      ['3', 'PART_3.ISO'],
    ]);
  });

  it('an open path-1 file is the member of channel 1', () => {
    const w = world(three);
    const two = w.open('PART_2.ISO', ['M190'], '/jobs/PART_2.ISO');
    const one = w.open('PART', ['M190'], '/jobs/PART');
    expect(members(w, two)[0]).toEqual(['1', 'PART', '/jobs/PART', 'open', 'fileName']);
    expect(w.svc.forDoc(one).self?.id).toBe('1');
  });

  it('two names for one channel in the folder: none is taken, and the problem names both', async () => {
    const w = world(three);
    w.listAnswer = () => ({ names: ['PART', 'PART_1.ISO', 'PART_2.ISO'], truncated: false, unavailable: false });
    const id = w.open('PART_2.ISO', ['M190'], '/jobs/PART_2.ISO');
    w.svc.forDoc(id);
    await settle(w);
    const set = w.svc.forDoc(id);
    expect(set.missing.map((m) => m.id)).toEqual(['1', '3']);
    expect(set.problems).toContainEqual({ path: 'list[0]', message: { key: 'channelFiles.problems.siblingAmbiguous', params: { channel: 'Path 1', names: 'PART, PART_1.ISO' } } });
  });

  it('a listing that was refused, cut off or unavailable is "could not be checked", never "not found"', async () => {
    const answers: (FolderSiblings | 'reject')[] = ['reject', { names: ['PART'], truncated: true, unavailable: false }, { names: [], truncated: false, unavailable: true }];
    for (const answer of answers) {
      const w = world(three);
      w.listAnswer = () => answer;
      const id = w.open('PART_2.ISO', ['M190'], '/jobs/PART_2.ISO');
      w.svc.forDoc(id);
      await settle(w);
      expect(w.svc.forDoc(id).problems, JSON.stringify(answer)).toContainEqual({ path: 'list[0]', message: { key: 'channels.problems.siblingUnknown', params: { channel: 'Path 1' } } });
    }
  });

  it('without the folder command nothing is listed, and the first channel stays missing (as before)', async () => {
    const w = world(three, { folder: false });
    const id = w.open('PART_2.ISO', ['M190'], '/jobs/PART_2.ISO');
    w.svc.forDoc(id);
    await settle(w);
    expect(w.listCalls).toEqual([]);
    expect(w.svc.forDoc(id).missing.map((m) => m.id)).toEqual(['1', '3']);
  });

  it('a set whose names all derive asks no listing', async () => {
    const { firstFileName: _gone, ...plain } = three;
    const w = world(plain);
    const id = w.open('PART_2.ISO', ['M190'], '/jobs/PART_2.ISO');
    w.svc.forDoc(id);
    await settle(w);
    expect(w.siblingCalls).toEqual([{ path: '/jobs/PART_2.ISO', names: ['PART_1.ISO', 'PART_3.ISO'] }]);
    expect(w.listCalls.filter((c) => c.pattern !== '*.JOB')).toEqual([]);
  });
});

describe('the job list (J1 to J7)', () => {
  const JOB = ['; job', 'SELECT SHAFT1.MPF CH=1', 'SELECT SHAFT2.MPF CH=2'];

  it('an open job list of the folder ties a program its name does not explain, as by: jobList', () => {
    const w = world(siemens);
    const one = w.open('SHAFT1.MPF', ['M190'], '/jobs/SHAFT1.MPF');
    expect(w.svc.forDoc(one).layout).toBe('none');
    w.open('SHAFT.JOB', JOB, '/jobs/SHAFT.JOB');
    const set = w.svc.forDoc(one);
    expect(set.layout).toBe('multi-file');
    expect(set.self?.id).toBe('1');
    expect(set.members[0]).toMatchObject({ kind: 'file', channel: { id: '1' }, by: 'jobList' });
  });

  it('the other channel is the open program the job list names, and a closed one is asked for by name', async () => {
    const w = world(siemens);
    const one = w.open('SHAFT1.MPF', ['M190'], '/jobs/SHAFT1.MPF');
    w.open('SHAFT.JOB', JOB, '/jobs/SHAFT.JOB');
    w.siblingAnswer = (names) => names.map((name) => ({ name, exists: name === 'SHAFT2.MPF', bytes: 1, modified: null, error: null }));
    w.svc.forDoc(one);
    await settle(w);
    expect(w.siblingCalls.at(-1)).toEqual({ path: '/jobs/SHAFT1.MPF', names: ['SHAFT2.MPF'] });
    expect(members(w, one)).toEqual([
      ['1', 'SHAFT1.MPF', '/jobs/SHAFT1.MPF', 'open', 'jobList'],
      ['2', 'SHAFT2.MPF', '/jobs/SHAFT2.MPF', 'closed', 'fileName'],
    ]);
    const two = w.open('SHAFT2.MPF', ['M190'], '/jobs/SHAFT2.MPF');
    expect(members(w, one)[1]).toEqual(['2', 'SHAFT2.MPF', '/jobs/SHAFT2.MPF', 'open', 'jobList']);
    expect(w.svc.forDoc(two).self?.id).toBe('2');
  });

  it('a job list of another folder, or one that is closed, does not count', () => {
    const w = world(siemens);
    const one = w.open('SHAFT1.MPF', ['M190'], '/jobs/SHAFT1.MPF');
    const other = w.open('SHAFT.JOB', JOB, '/elsewhere/SHAFT.JOB');
    expect(w.svc.forDoc(one).layout).toBe('none');
    w.close(other);
    const job = w.open('SHAFT.JOB', JOB, '/jobs/SHAFT.JOB');
    expect(w.svc.forDoc(one).self?.id).toBe('1');
    w.close(job);
    expect(w.svc.forDoc(one).layout).toBe('none');
  });

  it('editing the job list is followed after the pause', () => {
    const w = world(siemens);
    const one = w.open('SHAFT1.MPF', ['M190'], '/jobs/SHAFT1.MPF');
    const job = w.open('SHAFT.JOB', JOB, '/jobs/SHAFT.JOB');
    expect(w.svc.forDoc(one).self?.id).toBe('1');
    let bumps = 0;
    w.svc.revision.subscribe(() => bumps++);
    w.setLines(job, ['SELECT SHAFT1.MPF CH=2']);
    w.runTimers();
    expect(bumps).toBeGreaterThan(1);
    expect(w.svc.forDoc(one).self?.id).toBe('2');
  });

  it('the file name wins over the job list, and the disagreement is a problem', () => {
    const w = world(siemens);
    const id = w.open('SHAFT_CH2.MPF', ['M190'], '/jobs/SHAFT_CH2.MPF');
    w.open('SHAFT.JOB', ['SELECT SHAFT_CH2.MPF CH=1'], '/jobs/SHAFT.JOB');
    const set = w.svc.forDoc(id);
    expect(set.self?.id).toBe('2');
    expect(set.problems.map((p) => p.message.key)).toContain('channelFiles.problems.jobListDisagrees');
  });

  it('the status item says "found in the job list", not "set by you"', () => {
    const w = world(siemens);
    const one = w.open('SHAFT1.MPF', ['M190'], '/jobs/SHAFT1.MPF');
    w.open('SHAFT.JOB', JOB, '/jobs/SHAFT.JOB');
    const v = channelStatusView({ set: w.svc.forDoc(one), params: siemens, unassigned: false, cursorLine: 1, channelAt: () => null });
    expect(v?.tooltip).toContain('Channel 1: found in the job list, open');
    expect(v?.tooltip).not.toContain('set by you');
  });

  it('the user s assignment wins over the job list', () => {
    const w = world(siemens);
    const id = w.open('SHAFT1.MPF', ['M190'], '/jobs/SHAFT1.MPF');
    w.open('SHAFT.JOB', JOB, '/jobs/SHAFT.JOB');
    w.svc.assign(id, '2');
    expect(w.svc.forDoc(id).members.find((m) => m.channel.id === '2')).toMatchObject({ by: 'assigned' });
  });

  it('J1: a job list in the folder that is not open is said once per program, and nothing is read', async () => {
    const w = world(siemens);
    w.listAnswer = (pattern) => ({ names: pattern === '*.JOB' ? ['SHAFT.JOB'] : [], truncated: false, unavailable: false });
    const id = w.open('SHAFT1.MPF', ['M190'], '/jobs/SHAFT1.MPF');
    w.svc.forDoc(id);
    await settle(w);
    expect(w.listCalls).toEqual([{ path: '/jobs/SHAFT1.MPF', pattern: '*.JOB' }]);
    expect(w.said).toEqual([{ key: 'channelFiles.jobListInFolder' }]);
    // Again for the same program: not said again.
    w.setLines(id, ['M191']);
    await settle(w);
    w.svc.forDoc(id);
    await settle(w);
    expect(w.said).toHaveLength(1);
    // Only the open documents were read.
    expect(new Set(w.readCalls.map(([doc]) => doc))).toEqual(new Set([id]));
  });

  it('J1: nothing is said when the job list is open, or the folder has none', async () => {
    const w = world(siemens);
    w.listAnswer = () => ({ names: [], truncated: false, unavailable: false });
    const a = w.open('A.MPF', ['M190'], '/jobs/A.MPF');
    w.svc.forDoc(a);
    await settle(w);
    expect(w.said).toEqual([]);
    const v = world(siemens);
    v.listAnswer = () => ({ names: ['SHAFT.JOB'], truncated: false, unavailable: false });
    v.open('SHAFT.JOB', JOB, '/jobs/SHAFT.JOB');
    const b = v.open('SHAFT1.MPF', ['M190'], '/jobs/SHAFT1.MPF');
    v.svc.forDoc(b);
    await settle(v);
    expect(v.said).toEqual([]);
  });

  it('J6: a single-file machine ignores the job list and asks nothing', async () => {
    const single: ChannelParams = {
      layout: 'single-file',
      list: [
        { id: '1', name: 'Channel 1', aliases: ['G13'] },
        { id: '2', name: 'Channel 2', aliases: ['G14'] },
      ],
      sectionStart: '(?<channel>G1[34])',
      syncMarks: [WAIT],
    };
    const w = world(single);
    w.open('SHAFT.JOB', JOB, '/jobs/SHAFT.JOB');
    const id = w.open('SHAFT1.MPF', ['G13', 'M190'], '/jobs/SHAFT1.MPF');
    expect(w.svc.forDoc(id).layout).toBe('single-file');
    await settle(w);
    expect(w.listCalls).toEqual([]);
    expect(w.said).toEqual([]);
  });
});
