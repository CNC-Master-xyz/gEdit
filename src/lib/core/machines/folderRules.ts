// Folder rules: which machine a program belongs to by the folder its file is in (Phase 4, D53,
// plan section 6.8). Written by the P4f prelude as **stubs**; implemented by **P4.30a**.
//
// A machine lists the folders whose programs it runs (`MachineConfig.folders`, a DNC folder per
// machine). The rules, all binding:
//
//  R1. **Pure and lexical.** A document's path is compared with the folder paths as text, with
//      no file-system access: separators are folded to `/`, trailing separators dropped, a
//      Windows drive letter and a UNC host compare case-insensitively, and on Windows and macOS
//      the whole path does (as `docs.byPath` does); on Linux it is case-sensitive. A link is
//      not resolved: a file opened through another spelling of its folder (a mapped drive
//      against the share, a link) does not match, and the Machines page says so in its help.
//  R2. **The most specific folder wins.** Of all folders (of all machines) that hold the file,
//      the longest path decides. A folder with `subfolders: false` holds only the files directly
//      in it.
//  R3. **Two machines on the same folder is an answer, not a guess.** When the longest match is
//      claimed by two machines the result is `ambiguous`: no machine is chosen by the rule, the
//      status bar's tooltip and the Machines page name both, and the document falls through to the
//      profile's default as if there were no rule (refuse rather than guess).
//  R4. **Where it sits in the order of choice** (`stores/machines.ts` `resolveChoice`): the
//      document's own choice (an id or an explicit "none", also the one remembered per file) first,
//      then the folder rule, then the profile's default machine, then none. Only a document with
//      a file path is asked; an untitled one is never ruled by a folder. The result is
//      `choice: 'folder'`. A rule whose machine does not fit the document's profile chain, or
//      cannot be used (a broken record), is not applied: one message per document (the
//      existing `machines.incompatible` / `machines.unusable` wording) and the fall-through.
//  R5. **A broken list costs the list.** `foldersOf` reads the member the way `motionBlock`
//      reads its block: a wrong shape gives problems with JSON paths (`machines[2].folders[1].path`)
//      and no folders of that machine, never a refused record. At most `MAX_FOLDERS` folders per
//      machine, each path 1 to `MAX_FOLDER_CHARS` characters, absolute (a drive letter, a UNC
//      `\\host\share` or a leading `/`), without a `..` segment and without a NUL or control
//      character.
//  R6. **Nothing is read from the folder.** The rule never lists, stats or reads the folder; it
//      answers from the text alone, so a hung share costs nothing here.

import type { MachineConfig, MachineFolder } from './types';

/** Folders per machine, characters per folder path. */
export const MAX_FOLDERS = 16;
export const MAX_FOLDER_CHARS = 1024;

/** A problem of the folder list, with a JSON path inside `machines.json`. */
export interface FolderRuleProblem {
  machineId: string | null;
  path: string;
  message: string;
}

/** What the rule says about one file. */
export type FolderMatch =
  | { kind: 'machine'; machineId: string; folder: string }
  | { kind: 'ambiguous'; machineIds: string[]; folder: string }
  | { kind: 'none' };

const NOT_BUILT = 'not built yet (P4.30a)';

/** `machine.folders` as a valid list, and the problems of what was wrong (R5). */
export function foldersOf(
  _machine: MachineConfig,
  _path: string,
): { folders: MachineFolder[]; problems: FolderRuleProblem[] } {
  throw new Error(NOT_BUILT);
}

/** The folder path in the form R1 compares, or null when it is not a usable folder path (R5). */
export function normalizeFolderPath(_path: string, _caseInsensitive: boolean): string | null {
  throw new Error(NOT_BUILT);
}

/** R1 to R3: which machine's folder holds `docPath`, if any. `caseInsensitive` follows the platform. */
export function machineForPath(
  _docPath: string,
  _machines: readonly MachineConfig[],
  _o: { caseInsensitive: boolean },
): FolderMatch {
  throw new Error(NOT_BUILT);
}

/** The folders claimed by two machines (R3), for the Machines page: one problem per folder. */
export function folderConflicts(_machines: readonly MachineConfig[], _o: { caseInsensitive: boolean }): FolderRuleProblem[] {
  throw new Error(NOT_BUILT);
}
