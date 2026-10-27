// The file names of a channel set written to disk (P4.31; rules N1 to N4 in `fileNames.ts`).

import { describe, it } from 'vitest';

describe('channel file names', () => {
  it.todo('N1: the channel s own template, then the shared one, each filled with the stem and the channel id');
  it.todo('N1: no template: null, and the caller uses the split s default name');
  it.todo('N2: the stem is the title without its last extension');
  it.todo('N3: a name with a path separator or a character no file name holds is null');
  it.todo('N4: two channels with the same name both get null');
});
