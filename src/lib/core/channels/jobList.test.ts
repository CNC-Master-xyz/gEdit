// The Siemens job list as a channel source (P4.30b; rules J1 to J7 in `jobList.ts`). The prelude
// pins the numbers; the rows are P4.30b's cases, from the 840D sl operating manual's examples.

import { describe, expect, it } from 'vitest';
import { MAX_JOB_ENTRIES, MAX_JOB_LINES } from './jobList';

describe('job list', () => {
  it('the limits are the plan s', () => {
    expect(MAX_JOB_ENTRIES).toBe(64);
    expect(MAX_JOB_LINES).toBe(2000);
  });

  it.todo('J2: SELECT, LOAD or COPY first makes a job list, whatever the extension; a program is none');
  it.todo('J3: "SELECT SHAFT1.MPF CH=1" and "SELECT //NC/WKS.DIR/SHAFT.WPD/SHAFT2.MPF CH=2 DISK" read; a ";" line and a bracket comment do not');
  it.todo('J3: CH=Station5 and CH=ncu_b,1 are entries that answer no channel, each with a problem');
  it.todo('J4: SHAFT1.MPF, shaft1.mpf, /shaft.wpd/SHAFT1.MPF and _N_SHAFT1_MPF are one program');
  it.todo('J4: a base name that two entries of different channels explain answers ambiguous');
  it.todo('J5: the order of sources is the user s assignment, the marker, the file name, the job list; a job list that disagrees with a name or a marker is a problem');
  it.todo('J6: ignored unless the machine is multi-file');
  it.todo('J7: 65 SELECT lines read 64; a 2,001st line is not read; a very long line is counted');
});
