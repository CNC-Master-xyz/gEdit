// The sibling lookup from a folder listing (P4.30b; rules L1 to L3 in `siblings.ts`).

import { describe, it } from 'vitest';

describe('siblings from a listing', () => {
  it.todo('L1: the glob is the stem and *, null for a name that is no channel file or a stem under two characters');
  it.todo('L2: names with the same stem and another channel are found; a channel with two names is ambiguous and gets none');
  it.todo('L2: the path-1 file (firstFileName, no channel marker) is the first channel s file of its stem');
  it.todo('L2: a declared channel with no name is missing; the document s own name is never a sibling');
  it.todo('L3: the result opens nothing');
});
