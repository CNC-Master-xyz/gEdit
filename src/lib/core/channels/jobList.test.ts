// The Siemens job list as a channel source (P4.30b; rules J1 to J7 in `jobList.ts`). The prelude
// pins the numbers; the rows are the shapes of the 840D sl operating manual's examples
// (`SELECT <program> CH=<channel number> [DISK]`, comments with `;` and round brackets) and of
// the HMI-Advanced manual (a channel name, `NCU,n`, `LOAD` and `COPY`).

import { describe, expect, it } from 'vitest';
import { cpOf } from '../../../../tests/unit/helpers/profiles';
import { hasKey } from '$lib/i18n';
import { CHANNEL_CAPS, type ChannelParams } from './types';
import { jobListChannel, jobListNames, MAX_JOB_ENTRIES, MAX_JOB_LINES, programKey, programKind, readJobList, startsLikeJobList } from './jobList';
import { documentChannel } from './siblings';
import { resolveDocument } from './marks';

const two: ChannelParams = {
  layout: 'multi-file',
  list: [
    { id: '1', name: 'Channel 1' },
    { id: '2', name: 'Channel 2' },
  ],
  fileName: '^(?<stem>.+)_CH(?<channel>\\d)\\.MPF$',
  marker: '^;CHANNEL (?<channel>\\d)',
  syncMarks: [],
};

const JOB = ['; shaft job', 'LOAD *', 'SELECT SHAFT1.MPF CH=1', 'SELECT //NC/WKS.DIR/SHAFT.WPD/SHAFT2.MPF CH=2 DISK'];

describe('job list', () => {
  it('the limits are the plan s', () => {
    expect(MAX_JOB_ENTRIES).toBe(64);
    expect(MAX_JOB_LINES).toBe(2000);
  });

  it('J2: SELECT, LOAD or COPY first makes a job list, whatever the extension; a program is none', () => {
    expect(readJobList(JOB).isJobList).toBe(true);
    expect(readJobList(['', '(comment)', 'select a.mpf ch=1']).isJobList).toBe(true);
    expect(readJobList(['COPY /SPF.DIR/* NC=NCU1', 'SELECT A CH=1']).isJobList).toBe(true);
    // A program that holds a SELECT further down is no job list: the first line decides.
    expect(readJobList(['%', 'N10 G0 X0', 'SELECT A CH=1'])).toEqual({ isJobList: false, entries: [], problems: [] });
    // LOAD alone selects nothing.
    expect(readJobList(['LOAD *']).isJobList).toBe(false);
    expect(readJobList([]).isJobList).toBe(false);
    expect(startsLikeJobList(['', ';x', 'LOAD *'])).toBe(true);
    expect(startsLikeJobList(['G0 X1'])).toBe(false);
    expect(startsLikeJobList(['', '; only a comment'])).toBeNull();
    // A word that only begins like an instruction is none.
    expect(startsLikeJobList(['SELECTED'])).toBe(false);
  });

  it('J3: "SELECT SHAFT1.MPF CH=1" and "SELECT //NC/WKS.DIR/SHAFT.WPD/SHAFT2.MPF CH=2 DISK" read; a ";" line and a bracket comment do not', () => {
    const job = readJobList([...JOB, ';SELECT OTHER.MPF CH=2', '(SELECT OTHER.MPF CH=1)', 'SELECT /shaft1.wpd/side1.mpf CH = 2 ; side one']);
    expect(job.entries).toEqual([
      { line: 3, program: 'SHAFT1.MPF', channel: '1', channelKind: 'number', disk: false },
      { line: 4, program: '//NC/WKS.DIR/SHAFT.WPD/SHAFT2.MPF', channel: '2', channelKind: 'number', disk: true },
      { line: 7, program: '/shaft1.wpd/side1.mpf', channel: '2', channelKind: 'number', disk: false },
    ]);
    expect(job.problems).toEqual([]);
    // A SELECT without CH= is reported, never read as a channel.
    const bad = readJobList(['SELECT SHAFT1.MPF']);
    expect(bad.isJobList).toBe(false);
    const mixed = readJobList(['SELECT SHAFT1.MPF', 'SELECT SHAFT2.MPF CH=2']);
    expect(mixed.entries.map((e) => e.line)).toEqual([2]);
    expect(mixed.problems).toEqual([{ path: 'line:1', message: { key: 'channelFiles.jobList.badSelect', params: { line: 1 } } }]);
  });

  it('J3: CH=Station5 and CH=ncu_b,1 are entries that answer no channel, each with a problem', () => {
    const job = readJobList(['SELECT PART12 CH=Station5', 'SELECT PART12 CH=ncu_b, 1', 'SELECT PART13 CH=1']);
    expect(job.entries.map((e) => [e.channel, e.channelKind])).toEqual([
      ['Station5', 'name'],
      ['ncu_b,1', 'ncu'],
      ['1', 'number'],
    ]);
    expect(job.problems.map((p) => [p.path, p.message.key])).toEqual([
      ['line:1', 'channelFiles.jobList.channelByName'],
      ['line:2', 'channelFiles.jobList.channelByName'],
    ]);
    // `Station5` is never resolved, even on a machine with a channel of that name or alias.
    const named: ChannelParams = { ...two, list: [{ id: '1', name: 'Station5', aliases: ['Station5'] }, { id: '2', name: 'Channel 2' }] };
    expect(jobListChannel(job, 'PART12.MPF', named)).toBeNull();
    expect(jobListChannel(job, 'PART13.MPF', named)).toEqual({ channel: expect.objectContaining({ id: '1' }), line: 3 });
  });

  it('J4: SHAFT1.MPF, shaft1.mpf, /shaft.wpd/SHAFT1.MPF and _N_SHAFT1_MPF are one program', () => {
    const keys = ['SHAFT1.MPF', 'shaft1.mpf', '/shaft.wpd/SHAFT1.MPF', '_N_SHAFT1_MPF', '//NC/WKS.DIR/SHAFT.WPD/SHAFT1.MPF', 'SHAFT1', 'C:\\jobs\\shaft1.mpf'].map(programKey);
    expect(new Set(keys)).toEqual(new Set(['SHAFT1']));
    // Other extensions are kept: SHAFT1.NC is not the program SHAFT1 (no guess).
    expect(programKey('SHAFT1.NC')).toBe('SHAFT1.NC');
    expect(programKey('_N_SHAFT1_SPF')).toBe('SHAFT1');
    const job = readJobList(JOB);
    expect(jobListChannel(job, 'shaft2.mpf', two)).toEqual({ channel: expect.objectContaining({ id: '2' }), line: 4 });
    expect(jobListChannel(job, '_N_SHAFT1_MPF', two)).toEqual({ channel: expect.objectContaining({ id: '1' }), line: 3 });
    expect(jobListChannel(job, 'SHAFT3.MPF', two)).toBeNull();
  });

  it('J4 (NC-10b): SELECT selects a main program, so an entry never gives a channel to a .SPF file', () => {
    const job = readJobList(['SELECT PART12 CH=1', 'SELECT PART13.MPF CH=2', 'SELECT _N_PART14_MPF CH=1']);
    expect(jobListChannel(job, 'PART12.MPF', two)).toEqual({ channel: expect.objectContaining({ id: '1' }), line: 1 });
    expect(jobListChannel(job, 'PART12', two)).toEqual({ channel: expect.objectContaining({ id: '1' }), line: 1 });
    expect(jobListChannel(job, 'PART12.SPF', two)).toBeNull();
    expect(jobListChannel(job, 'part13.spf', two)).toBeNull();
    expect(jobListChannel(job, '_N_PART14_SPF', two)).toBeNull();
    expect(jobListChannel(job, '_N_PART14_MPF', two)).toEqual({ channel: expect.objectContaining({ id: '1' }), line: 3 });
    // The other way round: an .SPF entry names a subprogram, not the main program of that name.
    const sub = readJobList(['SELECT PART12.SPF CH=1']);
    expect(jobListChannel(sub, 'PART12.MPF', two)).toBeNull();
    expect(jobListChannel(sub, 'PART12.SPF', two)).toEqual({ channel: expect.objectContaining({ id: '1' }), line: 1 });
    expect(programKind('/a/PART12.spf')).toBe('sub');
    expect(programKind('PART12')).toBe('main');
  });

  it('J4: a base name that two entries of different channels explain answers ambiguous', () => {
    const job = readJobList(['SELECT SHAFT1.MPF CH=1', 'SELECT /w.wpd/SHAFT1.MPF CH=2', 'SELECT SHAFT2.MPF CH=2', 'SELECT SHAFT2.MPF CH=2 DISK']);
    expect(jobListChannel(job, 'SHAFT1.MPF', two)).toEqual({ ambiguous: [1, 2] });
    // The same channel twice is one answer.
    expect(jobListChannel(job, 'SHAFT2.MPF', two)).toEqual({ channel: expect.objectContaining({ id: '2' }), line: 3 });
    // A named channel beside a numbered one: which one runs here is not known.
    const named = readJobList(['SELECT SHAFT1.MPF CH=1', 'SELECT SHAFT1.MPF CH=Station5']);
    expect(jobListChannel(named, 'SHAFT1.MPF', two)).toEqual({ ambiguous: [1, 2] });
    // A channel number the machine does not have answers none.
    expect(jobListChannel(readJobList(['SELECT SHAFT1.MPF CH=7']), 'SHAFT1.MPF', two)).toBeNull();
  });

  it('J5: the order of sources is the user s assignment, the marker, the file name, the job list; a job list that disagrees with a name or a marker is a problem', () => {
    const cp = cpOf('sinumerik');
    const job = readJobList(['SELECT SHAFT1.MPF CH=1', 'SELECT SHAFT2.MPF CH=2', 'SELECT PART_CH2.MPF CH=1', 'SELECT TWICE.MPF CH=1', 'SELECT TWICE.MPF CH=2']);
    // The job list alone.
    expect(documentChannel('SHAFT2.MPF', ['G0 X1'], cp, two, { job })).toMatchObject({ channel: { id: '2' }, by: 'jobList', problems: [] });
    // Without the job list, the same program is no channel file.
    expect(documentChannel('SHAFT2.MPF', ['G0 X1'], cp, two)).toMatchObject({ channel: null, by: null });
    // The file name wins over the job list, and the disagreement is said.
    const byName = documentChannel('PART_CH2.MPF', ['G0 X1'], cp, two, { job });
    expect(byName).toMatchObject({ channel: { id: '2' }, by: 'fileName' });
    expect(byName.problems).toEqual([
      { path: 'jobList', message: { key: 'channelFiles.problems.jobListDisagrees', params: { line: 3, jobList: 'Channel 1', channel: 'Channel 2' } } },
    ]);
    // The marker wins over the job list.
    const byMarker = documentChannel('SHAFT2.MPF', [';CHANNEL 1', 'G0 X1'], cp, two, { job });
    expect(byMarker).toMatchObject({ channel: { id: '1' }, by: 'marker' });
    expect(byMarker.problems.map((p) => p.message.key)).toEqual(['channelFiles.problems.jobListDisagrees']);
    // Two channels for one program: none, with the lines.
    const twice = documentChannel('TWICE.MPF', ['G0 X1'], cp, two, { job });
    expect(twice).toMatchObject({ channel: null, by: null });
    expect(twice.problems).toEqual([{ path: 'jobList', message: { key: 'channelFiles.problems.jobListAmbiguous', params: { lines: '4, 5' } } }]);
    // The user's assignment wins over all of them (resolveDocument, as the service reads it).
    const assigned = resolveDocument('SHAFT2.MPF', ['G0 X1'], cp, two, { job, assigned: '1' });
    expect(assigned).toMatchObject({ layout: 'multi-file', self: { id: '1' }, by: 'assigned' });
    expect(resolveDocument('SHAFT2.MPF', ['G0 X1'], cp, two, { job })).toMatchObject({ layout: 'multi-file', self: { id: '2' }, by: 'jobList' });
  });

  it('J5: the job list names the other channels files only when it writes them with an extension', () => {
    const job = readJobList(['SELECT SHAFT1.MPF CH=1', 'SELECT /w.wpd/SHAFT2.MPF CH=2']);
    expect([...jobListNames(job, two)]).toEqual([
      ['1', 'SHAFT1.MPF'],
      ['2', 'SHAFT2.MPF'],
    ]);
    expect([...jobListNames(readJobList(['SELECT PART12 CH=1', 'SELECT _N_PART13_MPF CH=2']), two)]).toEqual([
      ['1', null],
      ['2', null],
    ]);
    // Two names for one channel: none.
    expect(jobListNames(readJobList(['SELECT A.MPF CH=2', 'SELECT B.MPF CH=2']), two).get('2')).toBeNull();
  });

  it('J6: ignored unless the machine is multi-file', () => {
    const job = readJobList(JOB);
    const single: ChannelParams = { ...two, layout: 'single-file', sectionStart: 'G1[34]' };
    expect(jobListChannel(job, 'SHAFT1.MPF', single)).toBeNull();
    expect(jobListChannel(job, 'SHAFT1.MPF', { ...two, layout: 'none' })).toBeNull();
    expect(jobListNames(job, single).size).toBe(0);
  });

  it('J7: 65 SELECT lines read 64; a 2,001st line is not read; a very long line is counted', () => {
    const many = readJobList(Array.from({ length: 65 }, (_, i) => `SELECT P${i + 1}.MPF CH=1`));
    expect(many.entries).toHaveLength(64);
    expect(many.truncated).toBe(true);
    expect(many.problems.map((p) => p.message.key)).toEqual(['channelFiles.jobList.truncated']);

    const lines = ['SELECT A.MPF CH=1', ...Array.from({ length: 1998 }, () => ''), 'SELECT B.MPF CH=2', 'SELECT C.MPF CH=2'];
    const long = readJobList(lines);
    expect(lines).toHaveLength(2001);
    expect(long.entries.map((e) => e.program)).toEqual(['A.MPF', 'B.MPF']);
    expect(long.truncated).toBe(true);

    const wide = readJobList(['SELECT A.MPF CH=1', `SELECT ${'X'.repeat(CHANNEL_CAPS.lineLength)}.MPF CH=2`]);
    expect(wide.entries.map((e) => e.program)).toEqual(['A.MPF']);
    expect(wide.longLines).toBe(1);
    expect(wide.problems).toEqual([{ path: 'lines', message: { key: 'channelFiles.jobList.longLines', params: { count: 1, max: CHANNEL_CAPS.lineLength } } }]);
  });

  it('every message the job list gives has a text', () => {
    for (const key of [
      'channelFiles.jobList.badSelect',
      'channelFiles.jobList.channelByName',
      'channelFiles.jobList.longLines',
      'channelFiles.jobList.truncated',
      'channelFiles.problems.jobListDisagrees',
      'channelFiles.problems.jobListAmbiguous',
      'channelFiles.problems.siblingAmbiguous',
      'channelFiles.jobListInFolder',
      'channelFiles.status.foundJobList',
      'channelFiles.field.label',
      'channelFiles.field.help',
    ]) {
      expect(hasKey(key), key).toBe(true);
    }
  });
});
