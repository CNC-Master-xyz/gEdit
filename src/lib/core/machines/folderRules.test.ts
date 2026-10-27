// Folder rules (P4.30a; rules R1 to R6 in `folderRules.ts` and plan section 6.8). The rows below
// are the cases P4.30a turns into tests; the prelude only pins the numbers.

import { describe, expect, it } from 'vitest';
import { MAX_FOLDER_CHARS, MAX_FOLDERS } from './folderRules';

describe('folder rules', () => {
  it('the limits are the plan s', () => {
    expect(MAX_FOLDERS).toBe(16);
    expect(MAX_FOLDER_CHARS).toBe(1024);
  });

  it.todo('R1: separators fold, a trailing separator and the case follow the platform; a link is not resolved');
  it.todo('R2: the longest folder wins; subfolders: false holds only the files directly in the folder');
  it.todo('R3: two machines on the longest folder answer ambiguous, and the document falls through to the default');
  it.todo('R4: the document s own choice first, then the folder (choice "folder"), then the default; an untitled document is never ruled');
  it.todo('R4: a machine that does not fit the profile chain is not applied, with one message');
  it.todo('R5: a broken list costs the list with JSON paths; a relative path, a ".." segment, a NUL and a 17th folder are problems');
  it.todo('R6: nothing is read from the folder');
});
