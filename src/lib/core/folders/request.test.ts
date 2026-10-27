// The Find in Folder request (P4.28; rules Q1 to Q6 in `request.ts` and plan section 6.8).

import { describe, expect, it } from 'vitest';
import { FOLDER_MAX_HITS } from './types';

describe('folder request', () => {
  it('the hit cap is the one of Find All', () => {
    expect(FOLDER_MAX_HITS).toBe(10_000);
  });

  it.todo('Q1: patterns split on ; and spaces, at most 16 of 128 characters, a character no file name holds is an error');
  it.todo('Q2: the dates are local midnights, end exclusive; an end before the start is an error');
  it.todo('Q3: a literal query gives its text as the prefilter (ASCII, at most 256 bytes), a regex with syntax and a long or non-ASCII text give none');
  it.todo('Q3: a word query gives the address letters only, case-insensitive, never the value (T17 must find "T 17" and "T017")');
  it.todo('Q4: the query is parsed per profile; a file whose profile cannot parse it is reported and the search goes on');
  it.todo('Q5: past 10,000 hits the search is cancelled and the title says "at least"; every skip count reaches the message');
  it.todo('Q6: a slow pattern ends the search at that file, keeps the rows, names the file');
});
