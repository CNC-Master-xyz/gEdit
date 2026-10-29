// Folder rules: which machine a program belongs to by the folder its file is in (Phase 4, D53,
// plan section 6.8). Signatures by the P4f prelude; implemented by **P4.30a**.
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

import { t } from '$lib/i18n';
import { isMacPlatform, isWindowsPlatform, plainPath } from '$lib/utils/platform';
import type { MachineConfig, MachineFolder } from './types';

/** Folders per machine, characters per folder path. */
export const MAX_FOLDERS = 16;
export const MAX_FOLDER_CHARS = 1024;

/** A problem of the folder list, with a JSON path inside `machines.json`. */
export interface FolderRuleProblem {
  machineId: string | null;
  path: string;
  message: string;
  /** For a folder claimed by several machines (`folderConflicts`): all of them, in file order. */
  machineIds?: string[];
}

/** What the rule says about one file. */
export type FolderMatch =
  | { kind: 'machine'; machineId: string; folder: string }
  | { kind: 'ambiguous'; machineIds: string[]; folder: string }
  | { kind: 'none' };

/** A control character (NUL included): no folder or file name holds one, and a hand edit that has one is wrong. */
const CONTROL = /[\u0000-\u001f\u007f]/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The text R1 compares, for a folder (`file: false`: at least a root, a UNC path names its host
 * and share) or for a document's file (`file: true`: at least one name below the root).
 * Null when the text is not an absolute path without `..` and control characters.
 *
 * A folder is written `d:/x/y` (drive letter lower case), `//host/share/x` (host lower case) or
 * `/x/y`; a root keeps its closing slash (`d:/`, `/`), any other folder has none. `\` is a
 * separator only in a path that starts with a drive letter or `\\`: in a path starting with `/`
 * it is a legal file name character on Linux and macOS and stays one.
 */
function comparable(path: unknown, caseInsensitive: boolean, file: boolean): string | null {
  if (typeof path !== 'string' || path === '' || CONTROL.test(path)) return null;
  if (!file && path.length > MAX_FOLDER_CHARS) return null;
  const plain = plainPath(path).normalize('NFC');
  const drive = /^[A-Za-z]:(?=[\\/])/.test(plain);
  const unc = /^[\\/]{2}(?![\\/])/.test(plain);
  const rooted = plain.startsWith('/') && !plain.startsWith('//');
  if (!drive && !unc && !rooted) return null;
  const text = drive || unc ? plain.replace(/\\/g, '/') : plain;
  const kept: string[] = [];
  for (const name of (drive || unc ? text.slice(2) : text).split('/')) {
    if (name === '..') return null;
    if (name !== '' && name !== '.') kept.push(name);
  }
  const cased = (names: string[]): string[] => (caseInsensitive ? names.map((n) => n.toLowerCase()) : names);
  if (drive) return `${text.slice(0, 2).toLowerCase()}/${cased(kept).join('/')}`;
  if (unc) {
    // `//host/share/...`: the host is never case sensitive, the share follows the platform.
    if (kept.length < (file ? 3 : 2)) return null;
    return `//${[kept[0].toLowerCase(), ...cased(kept.slice(1))].join('/')}`;
  }
  return file && kept.length === 0 ? null : `/${cased(kept).join('/')}`;
}

/** The folder path in the form R1 compares, or null when it is not a usable folder path (R5). */
export function normalizeFolderPath(path: string, caseInsensitive: boolean): string | null {
  return comparable(path, caseInsensitive, false);
}

/** `machine.folders` as a valid list, and the problems of what was wrong (R5). */
export function foldersOf(
  machine: MachineConfig,
  path: string,
): { folders: MachineFolder[]; problems: FolderRuleProblem[] } {
  const raw: unknown = (machine as { folders?: unknown } | null)?.folders;
  if (raw === undefined) return { folders: [], problems: [] };
  const id = typeof machine?.id === 'string' ? machine.id : null;
  const at = `${path}.folders`;
  const problems: FolderRuleProblem[] = [];
  const bad = (where: string, message: string): void => void problems.push({ machineId: id, path: where, message });

  if (!Array.isArray(raw)) {
    bad(at, 'folders must be a list of { "path": … } entries');
    return { folders: [], problems };
  }
  if (raw.length > MAX_FOLDERS) {
    bad(at, `a machine has at most ${MAX_FOLDERS} folders, this list has ${raw.length}`);
  }
  const folders: MachineFolder[] = [];
  raw.forEach((entry: unknown, index) => {
    const where = `${at}[${index}]`;
    if (!isRecord(entry)) {
      bad(where, 'a folder is a JSON object with a "path"');
      return;
    }
    const text = entry.path;
    if (typeof text !== 'string' || text === '') {
      bad(`${where}.path`, 'a folder needs a path, written as text');
    } else if (text.length > MAX_FOLDER_CHARS) {
      bad(`${where}.path`, `a folder path has at most ${MAX_FOLDER_CHARS} characters`);
    } else if (CONTROL.test(text)) {
      bad(`${where}.path`, 'a folder path holds no control character');
    } else if (/(^|[\\/])\.\.(?=[\\/]|$)/.test(text)) {
      bad(`${where}.path`, 'a folder path has no ".." part; write the whole path');
    } else if (comparable(text, false, false) === null) {
      bad(
        `${where}.path`,
        'a folder path is absolute: a drive letter (D:\\dnc), a network share (\\\\server\\share) or a path from the root (/dnc)',
      );
    } else if (entry.subfolders !== undefined && typeof entry.subfolders !== 'boolean') {
      bad(`${where}.subfolders`, 'subfolders is true or false');
    } else {
      folders.push(entry.subfolders === undefined ? { path: text } : { path: text, subfolders: entry.subfolders });
    }
  });
  // A broken list costs the list: a half-read list would send some programs to a machine and
  // others to the default, and the user would not know which (refuse rather than guess).
  return problems.length > 0 ? { folders: [], problems } : { folders, problems };
}

/** Every valid folder of every machine, in the form R1 compares. */
function claims(
  machines: readonly MachineConfig[],
  caseInsensitive: boolean,
): { machine: MachineConfig; written: string; key: string; subfolders: boolean }[] {
  const out: { machine: MachineConfig; written: string; key: string; subfolders: boolean }[] = [];
  for (const machine of machines) {
    for (const folder of foldersOf(machine, '').folders) {
      const key = comparable(folder.path, caseInsensitive, false);
      if (key !== null) out.push({ machine, written: folder.path, key, subfolders: folder.subfolders !== false });
    }
  }
  return out;
}

/** True when the file (comparable text) is held by the folder (comparable text). */
function holds(key: string, subfolders: boolean, file: string): boolean {
  const prefix = key.endsWith('/') ? key : `${key}/`;
  if (!file.startsWith(prefix)) return false;
  const rest = file.slice(prefix.length);
  return rest !== '' && (subfolders || !rest.includes('/'));
}

/** R1 to R3: which machine's folder holds `docPath`, if any. `caseInsensitive` follows the platform. */
export function machineForPath(
  docPath: string,
  machines: readonly MachineConfig[],
  o: { caseInsensitive: boolean },
): FolderMatch {
  const file = comparable(docPath, o.caseInsensitive, true);
  if (file === null) return { kind: 'none' };
  let longest = -1;
  let winners: { machine: MachineConfig; written: string }[] = [];
  for (const claim of claims(machines, o.caseInsensitive)) {
    if (!holds(claim.key, claim.subfolders, file)) continue;
    if (claim.key.length > longest) {
      longest = claim.key.length;
      winners = [];
    }
    if (claim.key.length === longest && !winners.some((w) => w.machine.id === claim.machine.id)) {
      winners.push({ machine: claim.machine, written: claim.written });
    }
  }
  if (winners.length === 0) return { kind: 'none' };
  if (winners.length === 1) return { kind: 'machine', machineId: winners[0].machine.id, folder: winners[0].written };
  return { kind: 'ambiguous', machineIds: winners.map((w) => w.machine.id), folder: winners[0].written };
}

/** The folders claimed by two machines (R3), for the Machines page: one problem per folder. */
export function folderConflicts(
  machines: readonly MachineConfig[],
  o: { caseInsensitive: boolean },
): FolderRuleProblem[] {
  const byKey = new Map<string, { written: string; machines: MachineConfig[] }>();
  for (const claim of claims(machines, o.caseInsensitive)) {
    const seen = byKey.get(claim.key) ?? { written: claim.written, machines: [] };
    if (!seen.machines.some((m) => m.id === claim.machine.id)) seen.machines.push(claim.machine);
    byKey.set(claim.key, seen);
  }
  const out: FolderRuleProblem[] = [];
  for (const { written, machines: owners } of byKey.values()) {
    if (owners.length < 2) continue;
    const names = owners.map((m) => `"${m.name}"`).join(' and ');
    out.push({
      machineId: owners[0].id,
      machineIds: owners.map((m) => m.id),
      path: `${positionPath(machines, owners[0])}.folders`,
      message: `the folder ${written} is claimed by ${names}; programs there use the profile's default machine until only one machine keeps it`,
    });
  }
  return out;
}

function positionPath(machines: readonly MachineConfig[], machine: MachineConfig): string {
  return `machines[${machines.indexOf(machine)}]`;
}

/** R1: macOS and Windows compare whole paths without case, Linux with it. */
export function platformIsCaseInsensitive(): boolean {
  return isMacPlatform() || isWindowsPlatform();
}

/**
 * The line the status item's tooltip adds for a document with a file path (6.8.4): the folder
 * that chose its machine (`choice` is 'folder'), or the machines that claim its folder and so
 * chose none (the document went on to the default). Null when the folder says nothing about
 * this document, or the document has a machine of its own.
 */
export function folderNote(
  match: FolderMatch,
  machines: readonly Pick<MachineConfig, 'id' | 'name'>[],
  choice: 'document' | 'folder' | 'default' | 'none',
): string | null {
  if (match.kind === 'machine') {
    return choice === 'folder' ? t('machineFolders.byFolder', { folder: match.folder }) : null;
  }
  if (match.kind === 'ambiguous' && choice !== 'document') {
    const nameOf = (id: string): string => machines.find((m) => m.id === id)?.name ?? id;
    return t('machineFolders.ambiguous', { folder: match.folder, names: match.machineIds.map(nameOf).join(', ') });
  }
  return null;
}
