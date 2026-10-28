// Find in Folder (Phase 4, P4f, P4.28; plan section 6.8.3, AD-53). One feature per file (AD-3).
//
// One command, `search.findInFolder` (Edit tab, Search group, no key): it asks for the folder
// (the folder dialog grants the folder itself), then for the form, then searches. Rust walks the
// folder (`folderSearch`) and sends the bytes of every file that passed its checks; this file
// does the reading: each file is decoded like an opened one, read with its own profile
// (`profiles.detect`, or the one the form fixes) and matched with `findInLinesGuarded`, so a
// regular expression that runs away meets the guard before it reads any file (T171, T227).
//
// Files arrive faster than a guarded match can read them, so they are queued and read one at a
// time, in the order the walk sends them. The search stops by itself at the hit cap and at a
// slow pattern (the rows found so far stay), and from the Stop button of the status bar. The
// rows open their file on a click: `openRow` grants the one file, opens it and reveals the line.

import Search from 'lucide-svelte/icons/folder-search';
import { asIcon } from '$lib/app/icons';
import { dialogs } from '$lib/app/dialogs';
import { files } from '$lib/app/fileOps';
import { modals } from '$lib/app/modals';
import { status } from '$lib/app/status';
import type { FieldSpec } from '$lib/core/forms/types';
import { initialValues } from '$lib/core/forms/values';
import { decodeFile } from '$lib/core/text/codec';
import { effectiveMachine } from '$lib/core/machines/effective';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { parseQuery, type SearchQuery } from '$lib/core/search';
import { findInLinesGuarded } from '$lib/core/search/guard';
import { flagsOf, searchFields, searchLive } from '$lib/core/search/replace';
import { appGuardRunner } from '$lib/core/regexGuard/app';
import type { GuardRunner } from '$lib/core/regexGuard/runner';
import { containsFor, dateWindow, folderRequest, parseNamePatterns } from '$lib/core/folders/request';
import { fileRow, folderName, hitRows, isPartial, notesOf } from '$lib/core/folders/rows';
import type { FolderOutcome } from '$lib/core/folders/rows';
import { FOLDER_MAX_HITS } from '$lib/core/folders/types';
import type { FolderForm, FolderRow } from '$lib/core/folders/types';
import { t } from '$lib/i18n';
import { editor } from '$lib/monaco/editorService';
import { folderGrant, folderSearch, folderSearchCancel, FOLDER_LIMITS } from '$lib/platform/commands';
import type { FolderFile, FolderSummary } from '$lib/platform/commands';
import { docs } from '$lib/stores/documents';
import { profiles } from '$lib/stores/profiles';
import { results } from '$lib/stores/results';
import { uiState } from '$lib/stores/uiState';
import type { Contribution, Msg, ReportData } from '$lib/app/types';

/** `uiState.lastParams` key of the form (the folder is asked every time and is not remembered). */
const FORM_KEY = 'search:findInFolder';

function say(msg: Msg, error = false): void {
  status.show(t(msg.key, msg.params), error ? { error: true } : undefined);
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

/** The registered extensions as name patterns, `*.nc; *.tap`, at most as many as a request may hold. */
function defaultNames(): string {
  const extensions = [...new Set(profiles.list().flatMap((info) => info.extensions))];
  return extensions
    .slice(0, FOLDER_LIMITS.maxPatterns)
    .map((extension) => `*.${extension.replace(/^\./, '')}`)
    .join('; ');
}

function formFields(): FieldSpec[] {
  const [query, ...toggles] = searchFields();
  return [
    { id: 'names', type: 'text', label: t('findInFolder.names'), help: t('findInFolder.namesHelp'), default: defaultNames(), maxLength: FOLDER_LIMITS.maxPatterns * (FOLDER_LIMITS.maxPatternChars + 2) },
    { id: 'recursive', type: 'bool', label: t('findInFolder.recursive'), default: true },
    { id: 'modifiedFrom', type: 'text', label: t('findInFolder.modifiedFrom'), help: t('findInFolder.dateHelp'), default: '', maxLength: 10 },
    { id: 'modifiedTo', type: 'text', label: t('findInFolder.modifiedTo'), default: '', maxLength: 10 },
    // The query may stay empty: a search by name and date lists the files.
    { ...query, label: t('findInFolder.query'), help: t('findInFolder.queryHelp'), required: false },
    ...toggles,
    {
      id: 'readAs',
      type: 'choice',
      label: t('findInFolder.readAs'),
      default: 'each',
      choices: [
        { label: t('findInFolder.readAsEach'), value: 'each' },
        ...profiles.list().map((info) => ({ label: info.name, value: info.id })),
      ],
    },
  ];
}

/** The form's answers as the contract's `FolderForm`. */
export function formOf(root: string, answers: Record<string, unknown>): FolderForm {
  const flags = flagsOf(answers);
  return {
    root,
    recursive: answers.recursive !== false,
    names: String(answers.names ?? ''),
    modifiedFrom: String(answers.modifiedFrom ?? ''),
    modifiedTo: String(answers.modifiedTo ?? ''),
    query: String(answers.query ?? '').trim(),
    wholeAddress: flags.wholeAddress,
    regex: flags.regex,
    caseSensitive: flags.caseSensitive,
    inComments: flags.inComments,
    readAs: typeof answers.readAs === 'string' && answers.readAs !== '' ? answers.readAs : 'each',
  };
}

/** The profile a file is read with: the one the form fixes (when it still exists), else by name and content. */
function profileOf(form: FolderForm, path: string, text: string): string {
  if (form.readAs !== 'each' && profiles.get(form.readAs) !== undefined) return form.readAs;
  return profiles.detect(path, text, profiles.defaultId());
}

export interface Prepared {
  names: string[];
  window: { after: number | null; before: number | null };
  /** The query as the first profile reads it; `null`: a search by name and date only. */
  query: SearchQuery | null;
}

/** Whether `address` is the program-number address (`O`, `:`) of some dialect (the call `M98 P1234` is a hit of `O1234`). */
function isProgramAddress(address: string): boolean {
  return profiles.list().some((info) => tokenizeLine(`${address}1`, profiles.compiled(info.id)).tokens[0]?.kind === 'programMarker');
}

/** Q1 to Q4 on the form: the request pieces, or the refusal in plain words. */
export function prepare(form: FolderForm): Prepared | { error: Msg } {
  const names = parseNamePatterns(form.names);
  if ('error' in names) return names;
  const window = dateWindow(form.modifiedFrom, form.modifiedTo);
  if ('error' in window) return window;
  if (form.query === '') return { names, window, query: null };
  // As Find All does: the first profile decides whether the text is a query at all.
  const first = form.readAs !== 'each' && profiles.get(form.readAs) !== undefined ? form.readAs : profiles.defaultId();
  const query = parseQuery(form.query, profiles.compiled(first), form);
  if ('error' in query) return query;
  return { names, window, query };
}

// ---------------------------------------------------------------------------
// The search
// ---------------------------------------------------------------------------

interface Running {
  /** The search of this id is stopped by the user. */
  stop(): void;
  done: Promise<void>;
}

let running: Running | null = null;
let counter = 0;
/**
 * The id of the search that started last. `folder_grant` opens only the files the last search sent
 * (plan section 6.8, S4 and S6), so a row of an earlier search is told so here, in plain words,
 * before Rust is asked.
 */
let latestSearch = '';

/** Resolves when no search is running (for the tests and for a second search that waits for the first). */
export async function folderSearchIdle(): Promise<void> {
  while (running !== null) await running.done;
}

function newId(): string {
  counter += 1;
  return `fs-${Date.now().toString(36)}-${counter}`;
}

/** Runs one search to its end and shows the report. Never rejects. */
export function startSearch(form: FolderForm, prepared: Prepared): Running {
  const id = newId();
  latestSearch = id;
  let halted = false;
  let stoppedByUser = false;

  const halt = (): void => {
    if (halted) return;
    halted = true;
    folderSearchCancel(id).catch(() => undefined);
  };
  const stop = (): void => {
    stoppedByUser = true;
    halt();
  };

  const run = async (): Promise<void> => {
    const rows: FolderRow[] = [];
    let hitCount = 0;
    const outcome: FolderOutcome = { summary: null, stoppedByUser: false, capped: false, slowFile: null, undecoded: 0, queryRefused: [] };
    const parsed = new Map<string, ReturnType<typeof parseQuery>>();
    let runner: GuardRunner | null = null;
    try {
      runner = await appGuardRunner();
    } catch {
      runner = null;
    }

    /** The query as profile `profileId` reads it (Q4), once per profile. */
    const queryFor = (profileId: string, text: string): ReturnType<typeof parseQuery> => {
      let found = parsed.get(profileId);
      if (found === undefined) {
        found = parseQuery(text, profiles.compiled(profileId), form);
        parsed.set(profileId, found);
      }
      return found;
    };

    const read = async (file: FolderFile): Promise<void> => {
      if (halted) return;
      const decoded = decodeFile(file.data, { stripNul: true });
      if (!decoded.ok) {
        outcome.undecoded += 1;
        return;
      }
      if (prepared.query === null) {
        rows.push(fileRow(file, form.root));
        hitCount += 1;
        if (hitCount >= FOLDER_MAX_HITS) {
          outcome.capped = true;
          halt();
        }
        return;
      }
      const lines = decoded.text.split('\n');
      const profileId = profileOf(form, file.path, decoded.text);
      const query = queryFor(profileId, form.query);
      if ('error' in query) {
        outcome.queryRefused.push({ file: file.rel, message: t(query.error.key, query.error.params) });
        return;
      }
      const eff = effectiveMachine(profiles.profile(profileId), null, 'none', profiles.detectVariants(profileId, decoded.text));
      const view = profiles.effective(profileId, eff);
      const room = FOLDER_MAX_HITS - hitCount;
      const found = await findInLinesGuarded(runner, lines, view.cp, query, { max: room, codes: view.codes });
      if (halted) return; // stopped while the guard ran: the rows of this file are not added
      if ('refused' in found) {
        // Q6: the pattern ran away on this file; the rows before it stay.
        outcome.slowFile = file.rel;
        halt();
        return;
      }
      if (found.hits.length > 0) {
        rows.push(...hitRows(file, form.root, found.hits));
        hitCount += found.hits.length;
      }
      if (found.truncated) {
        outcome.capped = true;
        halt();
      }
    };

    // The files arrive in the walk's order; they are read one at a time in that order.
    let chain: Promise<void> = Promise.resolve();
    const onFile = (file: FolderFile): void => {
      if (halted) return;
      chain = chain.then(() => read(file)).catch(() => {
        outcome.undecoded += 1; // a file the reader failed on is counted with the files that are not text
      });
    };

    let summary: FolderSummary | null = null;
    let failure: unknown = null;
    const stopAction = { label: t('findInFolder.stop'), run: stop };
    status.show(t('findInFolder.progress', { files: 0, entries: 0 }), { sticky: true, action: stopAction });
    try {
      summary = await folderSearch(
        folderRequest(id, form, prepared.names, prepared.window, containsFor(prepared.query, { programAddress: isProgramAddress })),
        onFile,
        (entries, filesRead) => {
          if (!halted) status.show(t('findInFolder.progress', { files: filesRead, entries }), { sticky: true, action: stopAction });
        },
      );
    } catch (err) {
      failure = err;
    }
    // Everything the walk sent is read before the report (unless the search was stopped: then the queue drops its files).
    await chain;
    halted = true;

    if (failure !== null) {
      status.show(t('findInFolder.failed'), { error: true, detail: failure instanceof Error ? failure.message : String(failure) });
      return;
    }
    outcome.summary = summary;
    outcome.stoppedByUser = stoppedByUser;
    for (const row of rows) row.search = id;
    results.show(reportOf(form, prepared, rows, outcome));
    status.show(t(rows.length === 0 ? 'findInFolder.foundNone' : 'findInFolder.found', { count: rows.length }));
  };

  const handle: Running = { stop, done: run().catch((err: unknown) => {
    status.show(t('findInFolder.failed'), { error: true, detail: err instanceof Error ? err.message : String(err) });
  }).finally(() => {
    if (running === handle) running = null;
  }) };
  running = handle;
  return handle;
}

/** The Results report of a finished (or stopped) search. */
export function reportOf(form: FolderForm, prepared: Prepared, rows: FolderRow[], outcome: FolderOutcome): ReportData {
  const folder = folderName(form.root);
  const partial = isPartial(outcome);
  const count = rows.length;
  let title: string;
  if (prepared.query === null) {
    title = t(
      count === 0 ? (partial ? 'findInFolder.titleFilesAtLeastNone' : 'findInFolder.titleFilesNone') : partial ? 'findInFolder.titleFilesAtLeast' : 'findInFolder.titleFiles',
      { count, folder },
    );
  } else {
    title = t(
      count === 0 ? (partial ? 'findInFolder.titleAtLeastNone' : 'findInFolder.titleNone') : partial ? 'findInFolder.titleAtLeast' : 'findInFolder.title',
      { count, query: form.query, folder },
    );
  }
  const message = notesOf(outcome).map((note) => t(note.key, note.params)).join(' ');
  const columns =
    prepared.query === null
      ? [
          { key: 'file', label: t('findInFolder.columnFile') },
          { key: 'modified', label: t('findInFolder.columnModified') },
        ]
      : [
          { key: 'file', label: t('findInFolder.columnFile') },
          { key: 'line', label: t('findInFolder.columnLine') },
          { key: 'text', label: t('findInFolder.columnText') },
          { key: 'modified', label: t('findInFolder.columnModified') },
        ];
  return { title, ...(message === '' ? {} : { message }), columns, rows: rows as unknown as Record<string, unknown>[], openRow };
}

/** What a click on a row does: grant the one file (only if the last search sent it), open it (or find the open tab) and show the line. */
export async function openRow(row: Record<string, unknown>): Promise<void> {
  const path = typeof row.path === 'string' ? row.path : '';
  const root = typeof row.root === 'string' ? row.root : '';
  if (path === '') return;
  const line = typeof row.line === 'number' && Number.isFinite(row.line) && row.line >= 1 ? Math.floor(row.line) : null;
  // An open document needs no grant: it was opened with its own.
  let id = docs.byPath(path)?.id;
  if (id === undefined) {
    // Only the last search's files open: a row of an earlier search says so and asks nothing of Rust.
    if (typeof row.search === 'string' && row.search !== latestSearch) {
      status.show(t('findInFolder.olderSearch', { file: typeof row.file === 'string' ? row.file : path }), { error: true });
      return;
    }
    try {
      await folderGrant(root, path);
    } catch (err) {
      status.show(t('findInFolder.cannotOpen', { file: typeof row.file === 'string' ? row.file : path }), {
        error: true,
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    id = (await files.open([path]))[0];
  }
  if (id !== undefined && line !== null) editor.reveal(id, line);
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

/** Shows the form until its answers pass Q1 to Q4, or the user cancels. */
async function askForm(root: string): Promise<{ form: FolderForm; prepared: Prepared } | undefined> {
  const fields = formFields();
  let values = initialValues(fields, uiState.getLastParams(FORM_KEY));
  for (;;) {
    const answered = await modals.form({
      title: t('findInFolder.formTitle', { folder: folderName(root) }),
      fields,
      values,
      live: searchLive,
    });
    if (answered === undefined) return undefined;
    uiState.setLastParams(FORM_KEY, answered);
    const form = formOf(root, answered);
    const prepared = prepare(form);
    if (!('error' in prepared)) return { form, prepared };
    say(prepared.error, true);
    values = answered;
  }
}

async function findInFolder(): Promise<void> {
  if (running !== null) {
    const stopFirst = await dialogs.confirm({
      title: t('findInFolder.runningTitle'),
      message: t('findInFolder.runningMessage'),
      ok: t('findInFolder.runningStop'),
      kind: 'warning',
    });
    if (!stopFirst) return;
    running?.stop();
    await folderSearchIdle();
  }
  const root = await dialogs.pickFolder({ title: t('findInFolder.pickTitle') });
  if (root === null) return;
  const asked = await askForm(root);
  if (asked === undefined) return;
  if (running !== null) {
    // Another search started while the form was open (the command can be run twice).
    running.stop();
    await folderSearchIdle();
  }
  startSearch(asked.form, asked.prepared);
}

export default {
  id: 'findInFolder',
  commands: [
    {
      id: 'search.findInFolder',
      title: 'findInFolder.command',
      category: 'search.category',
      icon: asIcon(Search),
      run: findInFolder,
    },
  ],
  ribbon: [{ tab: 'edit', group: 'search.group', command: 'search.findInFolder', order: 133 }],
} satisfies Contribution;
