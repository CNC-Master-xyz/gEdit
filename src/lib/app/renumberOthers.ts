// References in the other open documents after a renumber: the service (plan §6.6 rules
// 11–13, AD-49, Q4-17). Owner: **P4.20**. The command that uses it is
// `contrib/renumberOthers.ts`; the rules of what is listed are `core/transforms/otherReferences.ts`.
//
// `contrib/ncNumbering.ts` calls `afterRenumber` after every Renumber Blocks run. This file:
//
//  - lists: after a run that wrote on document A (a result with `renumbered`), it reads every
//    other open document of A's profile (`editor.getLines`, `machines.effective`) and asks
//    `findOtherReferences` what in them still points into A's old numbers. When there are
//    rows, the Results panel shows the renumber's own rows (the report the transform service
//    just published) and below them one row per reference, each with its own `docId` and
//    line so a click opens it (`ReportData.rows`, §7.16 #139); the status bar says how many
//    there are and that "Update References in Other Documents" rewrites the `update` rows;
//  - updates (`update()`, the command `nc.updateOtherReferences`, §6.11): first it finds the
//    references again in the open documents as they are now, from the renumber's outcome and
//    the callers it kept (P4d review CODE-2/4, owner B). The same rows: one confirmation that
//    says how many references in how many documents it writes and how many it cannot; then
//    every document with `update` rows gets its new values as **its own undo step**
//    (`applyLines`). Other rows (a document changed, was opened or closed): the fresh list is
//    shown in Results and nothing is written; the user checks it and runs Update again. The
//    renumbered document itself changed: refused, "undo your changes or undo the renumber and
//    run it again". A document that would be written is locked or has no model: refused (AD-23);
//  - counts only what reached a document (`changedLines` > 0); a write that threw or did not
//    go through says "Updated X of Y documents. Undo in each document to take it back." and
//    keeps the list;
//  - drops the list after an update and when the renumbered document is closed; a later run
//    that writes on any document replaces it (owner C): references of the earlier list that
//    were never updated are said so in the status bar and in one Results row, never composed.
//
// A file that is not open is never read or written (Q4-17): only `docs.all()` is looked at.
//
// Written as `createRenumberOthers(deps)` plus the singleton below (AD-2), so a unit test can
// drive it with fake editor, dialogs, status and results and a fake `otherReferences`.

import { get, writable } from 'svelte/store';
import { dialogs as appDialogs } from '$lib/app/dialogs';
import { lockRefusal } from '$lib/app/readOnlyLock';
import { status as appStatus } from '$lib/app/status';
import { applyOtherReferences, findOtherReferences, renumberedSourceOf } from '$lib/core/transforms/otherReferences';
import { applyLines as applyLinesToModel } from '$lib/monaco/applyLines';
import { editor as appEditor } from '$lib/monaco/editorService';
import { docs as appDocs } from '$lib/stores/documents';
import { machines as appMachines } from '$lib/stores/machines';
import { results as appResults } from '$lib/stores/results';
import { t as translate } from '$lib/i18n';
import type { Readable } from 'svelte/store';
import type {
  DocId,
  DocumentStore,
  EditorService,
  MachineService,
  NativeDialogs,
  ReportData,
  ResultsService,
  StatusService,
  Translate,
} from '$lib/app/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { OtherReference, OtherReferenceKind, RenumberedSource } from '$lib/core/transforms/otherReferences';
import type { TransformContext, TransformResult } from '$lib/core/transforms/types';

/** The references a renumber listed, waiting for "Update References in Other Documents". */
export interface PendingOtherReferences {
  /** The renumbered document and its `editor.versionId` right after the run. */
  sourceDocId: DocId;
  sourceVersion: number;
  /** Its name, for the refusals. */
  sourceTitle: string;
  /** Every other document with listed rows, its version when they were listed, and the rows. */
  docs: readonly { docId: DocId; title: string; version: number; refs: readonly OtherReference[] }[];
}

/** Why `update()` wrote nothing, or not everything (§6.6 rule 13); each is one status message. */
export type UpdateRefusal = 'nothing' | 'changed' | 'closed' | 'locked' | 'unavailable' | 'failed' | 'declined';

export interface RenumberOthersService {
  /** Called after every Renumber Blocks run on `docId`, with its result (null: not run or declined). */
  afterRenumber(docId: DocId | null, result: TransformResult | null): void;
  /** The list waiting for an update, or null (also null while the renumbered document is closed). */
  pending(): PendingOtherReferences | null;
  /** True when the list has at least one reference "Update" may write: the command's enablement. */
  canUpdate(): boolean;
  /** Bumps when the list appears or goes, so the command's enablement can be re-read. */
  readonly revision: Readable<number>;
  /** Writes the `update` rows, each document as its own undo step, after one confirmation. */
  update(): Promise<{ documents: number; references: number } | { refused: UpdateRefusal }>;
}

export interface RenumberOthersDeps {
  docs: Pick<DocumentStore, 'all' | 'get'>;
  editor: Pick<EditorService, 'getLineCount' | 'getLines' | 'versionId' | 'hasModel'>;
  machines: Pick<MachineService, 'effective'>;
  dialogs: Pick<NativeDialogs, 'confirm'>;
  status: Pick<StatusService, 'show'>;
  results: ResultsService;
  /** `monaco/applyLines.ts`; a fake in the tests. */
  applyLines(id: DocId, startLine: number, endLine: number, newLines: string[], lineMap?: Int32Array): { changedLines: number };
  /** `core/transforms/otherReferences.ts` (P4.20a); a fake in the tests. */
  find: typeof findOtherReferences;
  /** Builds the source from the renumbered document's text; a fake in the tests. */
  sourceOf: typeof renumberedSourceOf;
  apply: typeof applyOtherReferences;
  t: Translate;
}

/** Characters of a line a Results row shows. */
const ROW_TEXT_MAX = 200;

/** The kinds `update` never writes; each has its own row text. */
const ROW_KEYS: Record<OtherReferenceKind, string> = {
  update: 'renumberOthers.row.update',
  gone: 'renumberOthers.row.gone',
  duplicate: 'renumberOthers.row.duplicate',
  lands: 'renumberOthers.row.lands',
  callers: 'renumberOthers.row.callers',
  kept: 'renumberOthers.row.kept',
};

/** One same-profile document as it was read for the list: the ids and versions the list depends on. */
interface ReadDoc {
  docId: DocId;
  version: number;
  profileId: string;
}

/** The one list: what `pending()` hands out plus what the Results report is rebuilt from. */
interface ListState {
  pending: PendingOtherReferences;
  /**
   * What the references are found from, kept so that "Update" can find them again in the
   * documents as they are then (P4d review CODE-2/4, owner B): the renumber's outcome, the
   * programs of the renumbered document that call another (`callers`, `held`,
   * `callsUnknown`) and its profile (`cp`). The renumbered document's text is not read again:
   * while its version is the one listed, it is what this was built from.
   */
  source: RenumberedSource;
  /** EVERY other open document of the profile that was read for the list, with the version it had. */
  read: readonly ReadDoc[];
  /** The renumber's own rows (docId A), shown first. */
  ownRows: Record<string, unknown>[];
  /** One row per listed reference, in the order of `pending.docs`. */
  refRows: { kind: OtherReferenceKind; row: Record<string, unknown> }[];
  /** The report's message line: the renumber's own, when it published one. */
  message: string;
  /** True once an update was refused because the renumbered document changed: the user was told to undo and run it again. */
  told: boolean;
}

/** What the references are listed from, in the documents as they are now. */
interface Listing {
  docs: PendingOtherReferences['docs'][number][];
  refRows: ListState['refRows'];
  read: ReadDoc[];
}

function isListed(state: ListState): boolean {
  return state.refRows.length > 0;
}

/** True when the profile has a reference rule that can name a block of another program (as `otherReferences.ts` reads it). */
function namesOtherPrograms(cp: CompiledProfile): boolean {
  return (cp.profile.numbering?.references ?? []).some((rule) => rule?.program === 'called' || rule?.program === 'caller');
}

const updateRows = (state: ListState): number => state.refRows.filter((r) => r.kind === 'update').length;

/** The rows of two listings, compared by what is written and what is said, not by the version of the document. */
function sameRows(a: PendingOtherReferences['docs'], b: PendingOtherReferences['docs']): boolean {
  const key = (docs: PendingOtherReferences['docs']): string =>
    JSON.stringify(docs.map((d) => [d.docId, d.refs.map((r) => [r.line, r.start, r.end, r.text, r.newText, r.kind, r.program])]));
  return key(a) === key(b);
}

export function createRenumberOthers(deps: RenumberOthersDeps): RenumberOthersService {
  const { t } = deps;
  let state: ListState | null = null;
  /** The report this service last published, so it retracts that one and no other. */
  let ownReport: ReportData | null = null;
  const revision = writable(0);

  const bump = (): void => revision.update((n) => n + 1);

  const say = (text: string, error = false): void => {
    deps.status.show(text, error ? { error: true } : undefined);
  };

  function setState(next: ListState | null): void {
    state = next;
    bump();
  }

  function retractOwnReport(): void {
    if (ownReport !== null && get(deps.results.current) === ownReport) deps.results.clear();
    ownReport = null;
  }

  function rowText(line: string): string {
    const text = line.trim();
    return text.length <= ROW_TEXT_MAX ? text : `${text.slice(0, ROW_TEXT_MAX)}…`;
  }

  const columns = (): { key: string; label: string }[] => [
    { key: 'document', label: t('renumberOthers.column.document') },
    { key: 'line', label: t('renumberOthers.column.line') },
    { key: 'text', label: t('renumberOthers.column.text') },
    { key: 'what', label: t('renumberOthers.column.what') },
  ];

  function reportOf(list: ListState, rows: Record<string, unknown>[], message: string): ReportData {
    return {
      title: t('ncNumbering.renumber.title'),
      message,
      columns: columns(),
      rows: [...list.ownRows, ...rows],
      docId: list.pending.sourceDocId,
    };
  }

  function show(report: ReportData): void {
    ownReport = report;
    deps.results.show(report);
  }

  /** The open documents of the profile other than `docId`: the ones the references are looked for in (Q4-17: only open ones). */
  function sameProfileDocs(docId: DocId, profileId: string): { id: DocId; title: string }[] {
    return deps.docs
      .all()
      .filter((meta) => meta.id !== docId && meta.profileId === profileId)
      .map((meta) => ({ id: meta.id, title: meta.title }));
  }

  /** The ids and versions of the documents `listing` would read, without reading their text. */
  function snapshotOf(docId: DocId, profileId: string): ReadDoc[] {
    return sameProfileDocs(docId, profileId).map((d) => ({ docId: d.id, version: deps.editor.versionId(d.id), profileId }));
  }

  const sameSnapshot = (a: readonly ReadDoc[], b: readonly ReadDoc[]): boolean =>
    a.length === b.length && a.every((d, i) => d.docId === b[i].docId && d.version === b[i].version && d.profileId === b[i].profileId);

  /** Reads every other open document of the profile and asks which of their references point into the renumbered one. */
  function listing(docId: DocId, source: RenumberedSource): Listing {
    const profileId = source.cp.profile.id;
    const others: { meta: { id: DocId; title: string }; lines: string[]; cp: TransformContext['cp'] }[] = [];
    const read: ReadDoc[] = [];
    for (const meta of sameProfileDocs(docId, profileId)) {
      read.push({ docId: meta.id, version: deps.editor.versionId(meta.id), profileId });
      try {
        const view = deps.machines.effective(meta.id);
        others.push({ meta, lines: deps.editor.getLines(meta.id, 1, deps.editor.getLineCount(meta.id)), cp: view.cp });
      } catch {
        // a document whose profile is not available names nothing
      }
    }
    const docs: Listing['docs'] = [];
    const refRows: Listing['refRows'] = [];
    if (others.length === 0) return { docs, refRows, read };

    const found = deps.find(
      source,
      others.map(({ lines, cp }) => ({ lines, cp })),
    );
    others.forEach((other, i) => {
      const refs = found[i] ?? [];
      if (refs.length === 0) return;
      docs.push({ docId: other.meta.id, title: other.meta.title, version: deps.editor.versionId(other.meta.id), refs });
      for (const ref of refs) {
        refRows.push({
          kind: ref.kind,
          row: {
            document: other.meta.title,
            docId: other.meta.id,
            line: ref.line,
            text: rowText(other.lines[ref.line - 1] ?? ''),
            what: t(ROW_KEYS[ref.kind], { text: ref.text, newText: ref.newText ?? '', program: ref.program }),
          },
        });
      }
    });
    return { docs, refRows, read };
  }

  /** The list of what `afterRenumber` found; null when nothing is left to say. */
  function collect(docId: DocId, result: TransformResult): ListState | null {
    const source = deps.docs.get(docId);
    const outcome = result.renumbered;
    if (source === undefined || outcome === undefined) return null;

    let effective;
    try {
      effective = deps.machines.effective(docId);
    } catch {
      return null;
    }
    // Nothing to look for (P4d review CODE-7): no program was touched, or the dialect has no
    // reference that names a block of another program. No document is read for that.
    if (outcome.programs.length === 0 || !namesOtherPrograms(effective.cp)) return null;
    const sourceLines = deps.editor.getLines(docId, 1, deps.editor.getLineCount(docId));
    // The programs and calls of the renumbered document are read from its whole text after the
    // run (a run on a selection hands over only the selection's lines).
    const from = deps.sourceOf(sourceLines, effective.cp, outcome);
    const found = listing(docId, from);
    if (found.refRows.length === 0) return null;

    // The renumber's own report, when it published one: its findings become rows, first.
    const shown = get(deps.results.current);
    const own = shown !== null && shown.docId === docId && shown.columns.length === 0 && shown.title === t('ncNumbering.renumber.title');
    const ownRows = own
      ? (shown.findings ?? []).map((finding) => ({
          document: source.title,
          docId,
          line: finding.line,
          text: '',
          what: finding.message,
        }))
      : [];

    return {
      pending: {
        sourceDocId: docId,
        sourceVersion: deps.editor.versionId(docId),
        sourceTitle: source.title,
        docs: found.docs,
      },
      source: from,
      read: found.read,
      ownRows,
      refRows: found.refRows,
      message: own ? (shown.message ?? '') : '',
      told: false,
    };
  }

  /**
   * Why the renumbered document no longer matches the list, or null (§6.6 rule 13). It is not
   * read again: while its version is the listed one, the source was built from it.
   */
  function sourceProblem(list: ListState): { refused: 'closed' | 'changed'; text: string; keep: boolean } | null {
    const p = list.pending;
    if (deps.docs.get(p.sourceDocId) === undefined) {
      return { refused: 'closed', text: t('renumberOthers.refused.closed', { name: p.sourceTitle }), keep: false };
    }
    if (deps.editor.versionId(p.sourceDocId) !== p.sourceVersion) {
      // The list stays: undoing the user's own changes makes it right again.
      return { refused: 'changed', text: t('renumberOthers.refused.sourceChanged', { name: p.sourceTitle }), keep: true };
    }
    return null;
  }

  /** Why the documents to write cannot be written, or null. Nothing is written when this answers. */
  function writeProblem(list: ListState): { refused: 'locked' | 'unavailable'; text: string } | null {
    const targets = list.pending.docs.filter((d) => d.refs.some((r) => r.kind === 'update'));
    for (const d of targets) {
      const meta = deps.docs.get(d.docId);
      if (meta === undefined) continue;
      const locked = lockRefusal(meta, t('renumberOthers.action'));
      if (locked !== null) return { refused: 'locked', text: `${t(locked.key, locked.params)} ${t('renumberOthers.refused.nothingWritten')}` };
    }
    for (const d of targets) {
      if (!deps.editor.hasModel(d.docId)) {
        return { refused: 'unavailable', text: `${t('renumberOthers.refused.noModel', { name: d.title })} ${t('renumberOthers.refused.nothingWritten')}` };
      }
    }
    return null;
  }

  /**
   * Finds the references again in the documents as they are now (P4d review CODE-2/4, owner
   * B). The same rows: the list is current (its versions are refreshed). Other rows (a
   * document changed, was opened or closed): the fresh list, which the caller shows and does
   * not write.
   */
  function recheck(list: ListState): { list: ListState } | { fresh: ListState | null } {
    const profileId = list.source.cp.profile.id;
    if (sameSnapshot(snapshotOf(list.pending.sourceDocId, profileId), list.read)) return { list };
    const found = listing(list.pending.sourceDocId, list.source);
    if (sameRows(found.docs, list.pending.docs)) {
      const refreshed: ListState = { ...list, pending: { ...list.pending, docs: found.docs }, read: found.read, refRows: found.refRows };
      state = refreshed;
      return { list: refreshed };
    }
    if (found.refRows.length === 0) return { fresh: null };
    return { fresh: { ...list, pending: { ...list.pending, docs: found.docs }, read: found.read, refRows: found.refRows, told: false } };
  }

  const countsOf = (list: PendingOtherReferences): { update: number; other: number; documents: number } => {
    let update = 0;
    let other = 0;
    let documents = 0;
    for (const d of list.docs) {
      const mine = d.refs.filter((r) => r.kind === 'update').length;
      update += mine;
      other += d.refs.length - mine;
      if (mine > 0) documents++;
    }
    return { update, other, documents };
  };

  /** Shows the list `list` in Results with its message and the status line. */
  function publish(list: ListState, extraRows: Record<string, unknown>[] = []): { summary: string } {
    const { update, other } = countsOf(list.pending);
    const listed = t('renumberOthers.found', { count: update + other });
    const tail = update > 0 ? t('renumberOthers.next.canUpdate', { count: update }) : t('renumberOthers.next.cannotUpdate');
    show(reportOf(list, [...list.refRows.map((r) => r.row), ...extraRows], [list.message, listed].filter((s) => s !== '').join(' ')));
    return { summary: `${listed} ${tail}` };
  }

  const pendingList = (): PendingOtherReferences | null => {
    if (state === null) return null;
    // A listed document that was closed does not take the list away: "Update" finds the references again.
    return deps.docs.get(state.pending.sourceDocId) !== undefined ? state.pending : null;
  };

  /** P4d review CODE-8: the command is enabled only while some listed reference is one "Update" may write. */
  const canUpdate = (): boolean => pendingList() !== null && state !== null && updateRows(state) > 0;

  return {
    revision: { subscribe: revision.subscribe },

    afterRenumber(docId, result) {
      // A run that did not happen, was declined or wrote nothing leaves the list as it is.
      if (docId === null || result === null || result.renumbered === undefined) return;

      // P4d review CODE-3 (owner C): a run that writes replaces the list. References of the
      // earlier list that were never updated are said so, once; the two runs are never composed
      // (the second run's numbers are not the first run's, so no row could be trusted).
      const earlier = state;
      const lost =
        earlier !== null && !earlier.told && deps.docs.get(earlier.pending.sourceDocId) !== undefined ? updateRows(earlier) : 0;
      const lostText = lost > 0 ? t('renumberOthers.replaced', { count: lost, name: earlier?.pending.sourceTitle ?? '' }) : '';
      const lostRow = { document: earlier?.pending.sourceTitle ?? '', text: '', what: lostText };

      retractOwnReport();
      const list = collect(docId, result);
      setState(list);
      const summary = t(result.summary.key, result.summary.params);
      if (list === null) {
        if (lost > 0) {
          show({ title: t('ncNumbering.renumber.title'), message: lostText, columns: columns(), rows: [lostRow], docId });
          say(`${summary} ${lostText}`, true);
        }
        return;
      }

      const { summary: listed } = publish(list, lost > 0 ? [lostRow] : []);
      say(lost > 0 ? `${summary} ${listed} ${lostText}` : `${summary} ${listed}`, lost > 0);
    },

    pending: pendingList,

    canUpdate: canUpdate,

    async update() {
      let current = state;
      if (current === null || !isListed(current)) {
        say(t('renumberOthers.refused.nothing'));
        return { refused: 'nothing' };
      }
      if (updateRows(current) === 0) {
        say(t('renumberOthers.refused.noneWritable'));
        return { refused: 'nothing' };
      }

      /**
       * Everything that must hold before anything is written: the renumbered document is as
       * the list saw it, the other documents give the same rows, and what would be written can be.
       */
      const ready = (list: ListState): { list: ListState } | { refusal: { refused: UpdateRefusal } } => {
        const sourceBad = sourceProblem(list);
        if (sourceBad !== null) {
          if (sourceBad.keep) setState({ ...list, told: true });
          else setState(null);
          say(sourceBad.text, true);
          return { refusal: { refused: sourceBad.refused } };
        }
        const again = recheck(list);
        if ('fresh' in again) {
          // The documents changed: the fresh list replaces this one, shown and not written.
          setState(again.fresh);
          retractOwnReport();
          if (again.fresh === null) {
            say(t('renumberOthers.refused.listGone'), true);
          } else {
            publish(again.fresh);
            say(t('renumberOthers.refused.listChanged'), true);
          }
          return { refusal: { refused: 'changed' } };
        }
        const writeBad = writeProblem(again.list);
        if (writeBad !== null) {
          // A lock can be lifted and a model can arrive: the list stays.
          say(writeBad.text, true);
          return { refusal: { refused: writeBad.refused } };
        }
        return { list: again.list };
      };

      const first = ready(current);
      if ('refusal' in first) return first.refusal;
      current = first.list;

      const { update, other, documents } = countsOf(current.pending);
      const message = [
        t('renumberOthers.confirm.references', { count: update }),
        t('renumberOthers.confirm.inDocuments', { count: documents }),
        t('renumberOthers.confirm.undo'),
        other > 0 ? t('renumberOthers.confirm.cannot', { count: other }) : '',
      ]
        .filter((s) => s !== '')
        .join(' ');
      const go = await deps.dialogs.confirm({
        title: t('renumberOthers.action'),
        message,
        ok: t('renumberOthers.confirm.ok'),
        cancel: t('common.cancel'),
        kind: 'warning',
      });
      if (!go) return { refused: 'declined' };

      // The dialog was open for a while: a document may have changed, closed or been locked,
      // or another renumber may have replaced the list. Nothing is written until all is well.
      if (state !== current) {
        say(t('renumberOthers.refused.replaced'), true);
        return { refused: 'changed' };
      }
      const second = ready(current);
      if ('refusal' in second) return second.refusal;
      const list = second.list;

      // P4d review CODE-5: count only what reached a document, and say so when some did not.
      const targets = list.pending.docs.filter((d) => d.refs.some((r) => r.kind === 'update'));
      let writtenDocs = 0;
      let writtenRefs = 0;
      let failed = false;
      try {
        for (const d of targets) {
          const lines = deps.editor.getLines(d.docId, 1, deps.editor.getLineCount(d.docId));
          const out = deps.apply(lines, d.refs);
          if (out.changed === 0) {
            failed = true;
            continue;
          }
          const map = out.lines.length === lines.length ? Int32Array.from(lines, (_, i) => i) : undefined;
          const wrote = deps.applyLines(d.docId, 1, lines.length, out.lines, map);
          if (wrote.changedLines === 0) {
            failed = true;
            continue;
          }
          writtenDocs++;
          writtenRefs += out.changed;
        }
      } catch {
        failed = true;
      }
      if (failed) {
        // The list stays: what was written can be taken back with undo in each document.
        say(
          writtenDocs > 0
            ? t('renumberOthers.failed.some', { done: writtenDocs, total: targets.length })
            : t('renumberOthers.failed.none'),
          true,
        );
        return { refused: 'failed' };
      }

      // What is left of the list: the rows that are never written, still worth a look.
      const rest = list.refRows.filter((r) => r.kind !== 'update').map((r) => r.row);
      const done = [
        t('renumberOthers.done.references', { count: writtenRefs }),
        t('renumberOthers.confirm.inDocuments', { count: writtenDocs }),
      ].join(' ');
      if (ownReport !== null && get(deps.results.current) === ownReport) {
        show(reportOf(list, rest, [done, other > 0 ? t('renumberOthers.done.rest', { count: other }) : ''].filter((s) => s !== '').join(' ')));
      }
      setState(null);
      say(done);
      return { documents: writtenDocs, references: writtenRefs };
    },
  };
}

/** The application-wide service. */
export const renumberOthers: RenumberOthersService = createRenumberOthers({
  docs: appDocs,
  editor: appEditor,
  machines: appMachines,
  dialogs: appDialogs,
  status: appStatus,
  results: appResults,
  applyLines: applyLinesToModel,
  find: findOtherReferences,
  sourceOf: renumberedSourceOf,
  apply: applyOtherReferences,
  t: translate,
});
