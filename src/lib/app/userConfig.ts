// The user's own profiles and code files (plan AD-29, §7.3). Built by WP13.2.
//
// What this module is for: the one place that reads `<config>/profiles/` and
// `<config>/codes/` (through `user_files_list`, `platform/commands.ts`) and hands the files
// to the two registries. The contract is in `app/types.ts` (`UserConfigService`):
//
//   1. list both folders;
//   2. reload nothing when every file is byte-identical to the last load (§7.16 #192);
//   3. `codes.reload(codeFiles)`, then `profiles.reload(profileFiles)` — in this order,
//      because a profile is validated against the databases that exist after the code
//      reload, and the registry's `revision` bump is what every consumer listens to;
//   4. every open document whose profile no longer exists is detected again (one status
//      message for the load), and one that was moved off a profile that comes back — a typo
//      saved and fixed again — goes back to it, unless the user picked a dialect meanwhile
//      (the picker calls `forget`, so even picking the dialect it was moved to counts);
//   5. P4g (§6.9 rules 11 and 12): the files of the enabled script packages (`package_files_list`)
//      are laid under the user's own: `codes.reload` and `profiles.reload` get the packages' files
//      first (by package, then by name) and the user's after them, each marked with its
//      `package`. The load signature includes them, so a switch or an edit makes the next load
//      run. The service also keeps the packages' list (`packages`, from `packages_list`) for the
//      Packages page and the Scripts menu. A package that cannot be listed stops the load like an
//      unreadable user folder does: nothing changes and the user is told why.
//   6. the problems (an unreadable file, a broken profile or database with its JSON path)
//      go to the Results panel when there are any, and stay in `problems`. A problem with
//      `severity: 'info'` is a notice (a code entry that changes what a built-in code means):
//      it is listed with the problems and never opens the Results panel on its own.
//
// Bounds (M13 review fixes CODE-2, CODE-5): a file that nests its JSON more than
// [`MAX_NESTING`] levels deep is a problem and is not handed to either registry; at most
// [`MAX_PROBLEMS_PER_FILE`] problems of one file and [`MAX_PROBLEMS`] of a load are kept, with
// a row that says how many were left out; and a load that failed without naming a file is not
// remembered, so the same bytes are tried again by the next Reload.
//
// `bootstrap.ts` awaits `load()` after the settings and the UI state and before
// `machines.load`, so a machine whose base is a user profile is valid at the first open.
// Never throws: a broken user file must never cost the user the built-ins. Outside Tauri
// nothing is read. Two loads never overlap: the second waits for the first.
//
// A file that could not be read (too large, not UTF-8, a link, the 65th) comes back from
// Rust with `text: null`; it is a problem and never a profile or a code file.
//
// `createUserConfig(deps)` plus the singleton wired to the real modules (AD-2), so a unit
// test drives it with fake registries and a fake folder.

import { get, writable, type Readable } from 'svelte/store';
import { codes as appCodes } from '$lib/stores/codes';
import { docs as appDocs, pathKey } from '$lib/stores/documents';
import { profiles as appProfiles } from '$lib/stores/profiles';
import { settings as appSettings } from '$lib/stores/settings';
import { results as appResults } from '$lib/stores/results';
import { status as appStatus } from '$lib/app/status';
import { files as appFiles } from '$lib/app/fileOps';
import { editor as appEditor } from '$lib/monaco/editorService';
import {
  packageFilesList,
  packagesList,
  userFilesList,
  type ConfigPaths,
  type PackageFile,
  type PackageList,
  type UserFile,
  type UserFileKind,
} from '$lib/platform/commands';
import { layerSorted } from '$lib/core/packages/packages';
import { isMacPlatform, isTauriRuntime, isWindowsPlatform } from '$lib/utils/platform';
import { t } from '$lib/i18n';
import type { ProfileProblem } from '$lib/core/profiles/types';
import type {
  CodeDbService,
  DocMeta,
  ProfileRegistry,
  ReportData,
  UserConfigService,
  UserFileEntry,
} from '$lib/app/types';

/** How much of a document the detection reads (as the machines do). */
const DETECT_LINES = 4000;

/** The deepest a user file may nest `{` and `[` (a real profile is about ten levels deep). */
export const MAX_NESTING = 64;
/** The most problems of one file, and of one load, that are kept. */
export const MAX_PROBLEMS_PER_FILE = 50;
export const MAX_PROBLEMS = 500;

const KINDS: readonly UserFileKind[] = ['profiles', 'codes'];

export interface UserConfigDeps {
  /** False outside Tauri: nothing is read then. */
  available(): boolean;
  list(kind: UserFileKind): Promise<UserFile[]>;
  /** The enabled packages' files of a kind (P4g). Unset: there are no packages. */
  listPackageFiles?(kind: UserFileKind): Promise<PackageFile[]>;
  /** Every package folder with its manifest (P4g), for the page and the menu. Unset: none. */
  listPackages?(): Promise<PackageList>;
  codes: Pick<CodeDbService, 'reload'>;
  profiles: Pick<ProfileRegistry, 'reload' | 'get' | 'detect' | 'defaultId'>;
  /** The open documents. */
  docs(): DocMeta[];
  /** The head of a document, for detection; empty while it has no model. */
  text(id: string): string;
  setProfile(id: string, profileId: string): void;
  status(text: string): void;
  report(data: ReportData): void;
  /** The two user folders (`config_load`), or null before they are known. */
  paths: Readable<ConfigPaths | null>;
  caseInsensitivePaths: boolean;
  backslashSeparator: boolean;
}

/** What the service offers beyond the §7.3 contract (P4g): the list of the script packages. */
export interface UserConfigPackages {
  /** The package folders of the last load with their manifests; null until the first load has asked. */
  readonly packages: Readable<PackageList | null>;
}

/** One file of the user's own folder or of a package, as it was listed. */
interface Listed {
  name: string;
  text: string | null;
  error: string | null;
  /** The package folder; unset for the user's own file. */
  package?: string;
}

/** The text of the usable files, as `reload` takes it, in the order the registries read them. */
function usable(files: Listed[]): { name: string; text: string; package?: string }[] {
  const out: { name: string; text: string; package?: string }[] = [];
  for (const f of layerSorted(files)) {
    if (f.text !== null) out.push({ name: f.name, text: f.text, ...(f.package === undefined ? {} : { package: f.package }) });
  }
  return out;
}

/**
 * How deep the JSON text nests `{` and `[` outside its strings; counting stops one level past
 * `limit`. A text scan: the parser itself would use the stack for it (a file of a few hundred
 * thousand `[` overflows it), and the registries copy what they are given.
 */
export function nestingOf(text: string, limit = MAX_NESTING): number {
  let depth = 0;
  let deepest = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 0x5c) i++;
      else if (c === 0x22) inString = false;
    } else if (c === 0x22) inString = true;
    else if (c === 0x7b || c === 0x5b) {
      depth++;
      if (depth > deepest) deepest = depth;
      if (depth > limit) return depth;
    } else if (c === 0x7d || c === 0x5d) depth--;
  }
  return deepest;
}

/**
 * Keeps the first [`MAX_PROBLEMS_PER_FILE`] problems of each file (errors and notices counted
 * apart) and [`MAX_PROBLEMS`] in all, and adds a row per file that says how many were left out.
 * Errors come first. `dropped` is the number left out.
 */
export function capProblems(problems: ProfileProblem[]): { problems: ProfileProblem[]; dropped: number } {
  const out: ProfileProblem[] = [];
  let dropped = 0;
  for (const info of [false, true]) {
    const perFile = new Map<string, { kept: number; left: number; sample: ProfileProblem }>();
    for (const problem of problems) {
      if ((problem.severity === 'info') !== info) continue;
      const key = `${problem.kind ?? ''}/${problem.package ?? ''}/${problem.file ?? ''}/${problem.file === null ? (problem.profileId ?? '') : ''}`;
      let entry = perFile.get(key);
      if (entry === undefined) {
        entry = { kept: 0, left: 0, sample: problem };
        perFile.set(key, entry);
      }
      if (entry.kept < MAX_PROBLEMS_PER_FILE && out.length < MAX_PROBLEMS) {
        entry.kept++;
        out.push(problem);
      } else {
        entry.left++;
        dropped++;
      }
    }
    for (const { left, sample } of perFile.values()) {
      if (left === 0) continue;
      out.push({
        origin: sample.origin,
        file: sample.file,
        profileId: sample.file === null ? sample.profileId : null,
        path: '',
        message: t('userConfig.load.more', { count: left }),
        ...(info ? { severity: 'info' as const } : {}),
        ...(sample.kind === undefined ? {} : { kind: sample.kind }),
        ...(sample.package === undefined ? {} : { package: sample.package }),
      });
    }
  }
  return { problems: out, dropped };
}

const isError = (p: ProfileProblem): boolean => p.severity !== 'info';

function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function reportOf(problems: ProfileProblem[], dropped = 0): ReportData {
  const errors = problems.filter(isError).length;
  const notes = problems.length - errors;
  return {
    title: t('userConfig.load.report.title'),
    message:
      errors > 0
        ? `${t('userConfig.load.report.summary', { count: errors })}${notes > 0 ? ` ${t('userConfig.load.report.notes', { count: notes })}` : ''}`
        : t('userConfig.load.report.onlyNotes', { count: notes }),
    columns: [
      { key: 'file', label: t('userConfig.load.report.file') },
      { key: 'at', label: t('userConfig.load.report.at') },
      { key: 'problem', label: t('userConfig.load.report.problem') },
    ],
    rows: problems.map((p) => ({
      file: p.package === undefined ? (p.file ?? '') : t('packagesPage.problemFile', { package: p.package, file: p.file ?? '' }),
      at: [p.profileId, p.path].filter((part): part is string => typeof part === 'string' && part !== '').join(' · '),
      problem: isError(p) ? p.message : `${t('userConfig.load.report.note')} ${p.message}`,
    })),
    ...(dropped > 0 ? { dropped } : {}),
  };
}

/** What a load saw: the user's files and the packages' files of both kinds. */
function signatureOf(
  listing: { kind: UserFileKind; files: Listed[] }[],
  packaged: { kind: UserFileKind; files: Listed[] }[],
): string {
  const of = (list: { kind: UserFileKind; files: Listed[] }[]): unknown[] =>
    list.map(({ kind, files }) => [kind, files.map((f) => [f.package ?? null, f.name, f.text, f.error])]);
  return packaged.every(({ files }) => files.length === 0) ? JSON.stringify(of(listing)) : JSON.stringify([of(listing), of(packaged)]);
}

export function createUserConfig(deps: UserConfigDeps): UserConfigService & UserConfigPackages {
  const fileList = writable<UserFileEntry[]>([]);
  const problemList = writable<ProfileProblem[]>([]);
  const packageList = writable<PackageList | null>(null);
  /** What the last load saw, so a byte-identical one does nothing. No files is the starting state. */
  let lastSignature = signatureOf(
    KINDS.map((kind) => ({ kind, files: [] })),
    [],
  );
  /** The queue: a load starts when the one before it has finished. */
  let tail: Promise<unknown> = Promise.resolve();
  /**
   * Documents moved off a profile that was gone, by document id (CODE-6): the profile they
   * were on, and the one they were moved to. A save with a typo makes a profile vanish for one
   * load; when it is back, the document returns to it unless the user picked another dialect in
   * between (its profile is no longer the one it was moved to).
   */
  const lost = new Map<string, { from: string; to: string }>();

  function key(path: string): string {
    const normalized = pathKey(path, { backslashSeparator: deps.backslashSeparator });
    return deps.caseInsensitivePaths ? normalized.toLowerCase() : normalized;
  }

  function publish(problems: ProfileProblem[], show: boolean, dropped = 0): void {
    problemList.set(problems);
    // Notices alone never open the Results panel; they wait on the Profiles page.
    if (show && problems.some(isError)) {
      try {
        deps.report(reportOf(problems, dropped));
      } catch (error) {
        console.error('The problems of the user files could not be shown', error);
      }
    }
  }

  /**
   * Puts a document back on the profile it was moved off, when that profile is in the registry
   * again and the document is still on the one it was moved to. Forgets documents that are
   * closed or that the user moved.
   */
  function restore(): number {
    let back = 0;
    const open = new Map(deps.docs().map((doc) => [doc.id, doc]));
    for (const [id, entry] of [...lost]) {
      const doc = open.get(id);
      if (doc === undefined || doc.profileId !== entry.to) {
        lost.delete(id);
        continue;
      }
      if (deps.profiles.get(entry.from) === undefined) continue;
      try {
        deps.setProfile(id, entry.from);
        back++;
      } catch (error) {
        console.error(`The dialect of ${doc.title} could not be restored`, error);
      }
      lost.delete(id);
    }
    return back;
  }

  /** Detects every open document again whose profile is not in the registry any more. */
  function redetect(): number {
    let moved = 0;
    for (const doc of deps.docs()) {
      if (deps.profiles.get(doc.profileId) !== undefined) continue;
      try {
        const id = deps.profiles.detect(doc.path, deps.text(doc.id), deps.profiles.defaultId());
        // The profile it was first on stays the one to go back to, however often it moves.
        const from = lost.get(doc.id)?.from ?? doc.profileId;
        deps.setProfile(doc.id, id);
        lost.set(doc.id, { from, to: id });
        moved++;
      } catch (error) {
        console.error(`The dialect of ${doc.title} could not be detected again`, error);
      }
    }
    return moved;
  }

  /** Asks for the packages' list; a failure keeps the last one. */
  async function refreshPackages(): Promise<void> {
    if (deps.listPackages === undefined) return;
    try {
      packageList.set(await deps.listPackages());
    } catch (error) {
      console.error('The list of the script packages could not be read', error);
    }
  }

  async function run(): Promise<ProfileProblem[]> {
    if (!deps.available()) return get(problemList);

    let listing: { kind: UserFileKind; files: Listed[] }[];
    let packaged: { kind: UserFileKind; files: Listed[] }[] = [];
    // One wave of round trips (WY-CODE-4): the user lists, the packages' lists and the packages'
    // own list are asked together, not one after the other. The packages' list never rejects.
    const packages = refreshPackages();
    try {
      const [mine, theirs] = await Promise.all([
        Promise.all(KINDS.map(async (kind) => ({ kind, files: [...(await deps.list(kind))].sort(byName) }))),
        deps.listPackageFiles === undefined
          ? Promise.resolve([])
          : Promise.all(
              KINDS.map(async (kind) => ({ kind, files: layerSorted(await deps.listPackageFiles!(kind)) })),
            ),
      ]);
      listing = mine;
      packaged = theirs;
    } catch (error) {
      await packages;
      // The folder cannot be listed: nothing changes, and the user is told why.
      const message = `the folder could not be read: ${error instanceof Error ? error.message : String(error)}`;
      const problems = [{ origin: 'user' as const, file: null, profileId: null, path: '', message }];
      publish(problems, true);
      return problems;
    }

    // The packages' list (manifests, counts) follows every load, even one that changes nothing.
    await packages;

    const signature = signatureOf(listing, packaged);
    if (signature === lastSignature) return get(problemList);

    fileList.set(listing.flatMap(({ kind, files }) => files.map((f) => ({ kind, name: f.name, error: f.error }))));

    const problems: ProfileProblem[] = [];
    for (const { kind, files } of [...packaged, ...listing]) {
      for (const f of files) {
        const where = f.package === undefined ? {} : { package: f.package };
        if (f.text === null) {
          problems.push({
            origin: 'user',
            file: f.name,
            profileId: null,
            path: '',
            message: f.error ?? 'the file could not be read',
            kind,
            ...where,
          });
        } else if (nestingOf(f.text) > MAX_NESTING) {
          // Not handed on (CODE-2): a deeply nested file would overflow the stack of whatever
          // copies it, and the problem would name no file.
          problems.push({
            origin: 'user',
            file: f.name,
            profileId: null,
            path: '',
            message: t('userConfig.load.tooDeep', { max: MAX_NESTING }),
            kind,
            ...where,
          });
        }
      }
    }
    // The packages' files first, the user's own after them (§6.9 rule 11).
    const of = (kind: UserFileKind): { name: string; text: string; package?: string }[] =>
      usable([
        ...(packaged.find((entry) => entry.kind === kind)?.files ?? []),
        ...(listing.find((entry) => entry.kind === kind)?.files ?? []),
      ]).filter((f) => nestingOf(f.text) <= MAX_NESTING);

    // A failure that names no file (a registry that threw) is not remembered: the same bytes
    // are tried again by the next load, instead of "nothing changed" for ever.
    let failed = false;
    // The order is the contract: a profile is validated against the databases of this load.
    for (const [name, kind, reload] of [
      ['code files', 'codes', () => deps.codes.reload(of('codes'))],
      ['profiles', 'profiles', () => deps.profiles.reload(of('profiles'))],
    ] as const) {
      try {
        const found = reload();
        if (found.some((p) => isError(p) && p.file === null && p.profileId === null && p.path === '')) failed = true;
        problems.push(...found);
      } catch (error) {
        failed = true;
        problems.push({
          origin: 'user',
          file: null,
          profileId: null,
          path: '',
          message: `the ${name} could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
          kind,
        });
      }
    }

    if (!failed) lastSignature = signature;

    const back = restore();
    const moved = redetect();
    if (moved > 0) deps.status(t('userConfig.load.redetected', { count: moved }));
    else if (back > 0) deps.status(t('userConfig.load.restored', { count: back }));
    const capped = capProblems(problems);
    publish(capped.problems, true, capped.dropped);
    return capped.problems;
  }

  return {
    files: { subscribe: fileList.subscribe },
    problems: { subscribe: problemList.subscribe },
    packages: { subscribe: packageList.subscribe },

    load(): Promise<ProfileProblem[]> {
      const next = tail.then(run, run).catch((error: unknown) => {
        // `run` is written not to throw; this is the net under it.
        console.error('Loading the user files failed', error);
        return get(problemList);
      });
      tail = next;
      return next;
    },

    forget(docId: string): boolean {
      return lost.delete(docId);
    },

    kindOf(path: string): UserFileKind | null {
      const paths = get(deps.paths);
      if (paths === null || path === '') return null;
      const value = key(path);
      const slash = value.lastIndexOf('/');
      if (slash < 0) return null;
      const dir = value.slice(0, slash === 0 ? 1 : slash);
      if (dir === key(paths.profilesDir)) return 'profiles';
      if (dir === key(paths.codesDir)) return 'codes';
      return null;
    },
  };
}

/** The application-wide user configuration. */
export const userConfig: UserConfigService & UserConfigPackages = createUserConfig({
  available: isTauriRuntime,
  list: userFilesList,
  listPackageFiles: packageFilesList,
  listPackages: packagesList,
  codes: appCodes,
  profiles: appProfiles,
  docs: () => appDocs.all(),
  text: (id) => (appEditor.hasModel(id) ? appEditor.getLines(id, 1, DETECT_LINES).join('\n') : ''),
  setProfile: (id, profileId) => appFiles.setProfile(id, profileId),
  status: (text) => appStatus.show(text),
  report: (data) => appResults.show(data),
  paths: appSettings.paths,
  caseInsensitivePaths: isMacPlatform() || isWindowsPlatform(),
  backslashSeparator: isWindowsPlatform(),
});
