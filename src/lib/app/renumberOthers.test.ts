// References in the other open documents (plan §6.6 rules 11–13, P4.20b): the list after a
// renumber, the Results rows, the one confirmation, one undo step per document, and every
// reason the update refuses as a whole.
//
// The real document store, the real results store, the real profile registry and the real
// i18n catalog are used; the editor, the dialogs, the status bar, the apply step and
// `otherReferences` (P4.20a's rules, tested in `otherReferences.test.ts`) are fakes, so
// each case asserts what the user would see and what reached which document.

import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRenumberOthers, type RenumberOthersDeps, type RenumberOthersService } from './renumberOthers';
import { createDocumentStore } from '$lib/stores/documents';
import { noMachine } from '$lib/core/machines/effective';
import { profiles } from '$lib/stores/profiles';
import { results } from '$lib/stores/results';
import { t } from '$lib/i18n';
import type { CommandDef, DocId, DocumentStore, NewDocMeta, ReportData } from '$lib/app/types';
import type { CodeDb } from '$lib/core/codes/types';
import { renumberedSourceOf } from '$lib/core/transforms/otherReferences';
import type { OtherReference, RenumberedSource } from '$lib/core/transforms/otherReferences';
import type { TransformResult } from '$lib/core/transforms/types';

// The command test below replaces the service's singleton (what `enabled` and `run` read)
// and keeps the real `createRenumberOthers` for everything above it.
const fake = vi.hoisted(() => ({ pending: null as object | null, canUpdate: false, updated: 0 }));

vi.mock('$lib/app/renumberOthers', async (importOriginal) => {
  const real = await importOriginal<typeof import('./renumberOthers')>();
  return {
    ...real,
    renumberOthers: {
      pending: () => fake.pending,
      canUpdate: () => fake.canUpdate,
      revision: { subscribe: (run: (n: number) => void) => (run(0), () => undefined) },
      update: () => {
        fake.updated++;
        return Promise.resolve({ documents: 0, references: 0 });
      },
      afterRenumber: () => undefined,
    },
  };
});

const CODES: CodeDb = { dialect: 'fanuc', version: 1, addresses: {}, codes: [] };

function newDoc(over: Partial<NewDocMeta> = {}): NewDocMeta {
  return {
    path: null,
    untitledIndex: 1,
    profileId: 'fanuc-gcode',
    encoding: { encoding: 'utf-8', hasBom: false },
    eol: 'lf',
    eolMixedOnLoad: false,
    nul: { leader: 0, trailer: 0, stripped: 0 },
    textDirty: false,
    metaDirty: false,
    disk: null,
    external: 'none',
    readOnly: false,
    readOnlyReason: null,
    ...over,
  };
}

/** A reference to the value `text` on `line` of `lines`, found by searching the line. */
function ref(lines: string[], line: number, text: string, newText: string | null, kind: OtherReference['kind'] = 'update'): OtherReference {
  const start = lines[line - 1].indexOf(text, lines[line - 1].indexOf('P') + 1);
  return { line, start, end: start + text.length, text, newText, kind, program: '1000' };
}

interface Harness {
  service: RenumberOthersService;
  docs: DocumentStore;
  /** A is the renumbered document; B and C are other documents of its dialect, D is another dialect's. */
  a: DocId;
  b: DocId;
  c: DocId;
  d: DocId;
  lines: Map<DocId, string[]>;
  versions: Map<DocId, number>;
  status: { text: string; error: boolean }[];
  confirms: { title: string; message: string; ok: string }[];
  confirmAnswers: boolean[];
  /** Runs inside `confirm`, before it answers: the user does something while the dialog is open. */
  whileAsked: (() => void) | null;
  applied: { id: DocId; startLine: number; endLine: number; lines: string[]; map?: Int32Array }[];
  /** What the fake `findOtherReferences` answers, one list per document it is asked about. */
  answer: OtherReference[][];
  asked: { source: RenumberedSource; others: { lines: readonly string[]; profileId: string }[] }[];
  /** Documents without a model (a pending one), and what `applyLines` does besides recording: the fakes of CODE-5. */
  noModel: Set<DocId>;
  applyHook: ((id: DocId, call: number) => { changedLines: number } | undefined) | null;
  /** Every `getLines` and `sourceOf` the service made (CODE-7). */
  reads: { getLines: number; sourceOf: number };
}

const A_LINES = ['O1000', 'N10 G0 X0', 'N20 M98 P2000 Q30', 'N30 M30', 'O2000', 'N10 G1 X1.', 'N20 M99'];
const B_LINES = ['O3000', 'N10 M98 P1000 Q30', 'N20 G0 X0', 'N30 M98 P1000 Q40', 'N40 M30'];
const C_LINES = ['O4000', 'N10 M98 P1000 Q50', 'N20 M30'];

function harness(profileId = 'fanuc-gcode'): Harness {
  const docs = createDocumentStore({ caseInsensitivePaths: false });
  const a = docs.add(newDoc({ untitledIndex: 1, profileId }));
  const b = docs.add(newDoc({ untitledIndex: 2, profileId }));
  const c = docs.add(newDoc({ untitledIndex: 3, profileId }));
  const d = docs.add(newDoc({ untitledIndex: 4, profileId: 'okuma-osp' }));

  const h: Harness = {
    service: undefined as unknown as RenumberOthersService,
    docs,
    a,
    b,
    c,
    d,
    lines: new Map([
      [a, [...A_LINES]],
      [b, [...B_LINES]],
      [c, [...C_LINES]],
      [d, ['O5000', 'N1 M30']],
    ]),
    versions: new Map([
      [a, 1],
      [b, 1],
      [c, 1],
      [d, 1],
    ]),
    status: [],
    confirms: [],
    confirmAnswers: [],
    whileAsked: null,
    applied: [],
    answer: [],
    asked: [],
    noModel: new Set(),
    applyHook: null,
    reads: { getLines: 0, sourceOf: 0 },
  };
  let applyCalls = 0;

  const deps: RenumberOthersDeps = {
    docs,
    editor: {
      getLineCount: (id) => h.lines.get(id)?.length ?? 0,
      getLines: (id, startLine, endLine) => {
        h.reads.getLines++;
        return (h.lines.get(id) ?? []).slice(startLine - 1, endLine);
      },
      versionId: (id) => h.versions.get(id) ?? 0,
      hasModel: (id) => !h.noModel.has(id),
    },
    machines: {
      effective: (id) => {
        const profileId = docs.get(id)?.profileId ?? 'fanuc-gcode';
        const profile = profiles.profile(profileId);
        return { profile, cp: profiles.compiled(profileId), codes: CODES, machine: noMachine(profile) };
      },
    },
    dialogs: {
      confirm: (request) => {
        h.confirms.push({ title: request.title, message: request.message, ok: request.ok });
        h.whileAsked?.();
        return Promise.resolve(h.confirmAnswers.shift() ?? false);
      },
    },
    status: { show: (text, options) => h.status.push({ text, error: options?.error === true }) },
    results,
    applyLines: (id, startLine, endLine, lines, map) => {
      const hooked = h.applyHook?.(id, ++applyCalls);
      if (hooked !== undefined) return hooked;
      h.applied.push({ id, startLine, endLine, lines, map });
      h.lines.set(id, lines);
      return { changedLines: lines.length };
    },
    // The real reading of the renumbered document's programs and calls (P4.20a).
    sourceOf: (lines, cp, outcome) => {
      h.reads.sourceOf++;
      return renumberedSourceOf(lines, cp, outcome);
    },
    find: (source, others) => {
      h.asked.push({
        source,
        others: others.map((o) => ({ lines: o.lines, profileId: o.cp.profile.id })),
      });
      return h.answer.slice(0, others.length).concat(others.slice(h.answer.length).map(() => []));
    },
    // The real rule (P4.20a) writes the `update` spans; the same here, from the back.
    apply: (lines, refs) => {
      const out = lines.slice();
      let changed = 0;
      for (const r of [...refs].filter((x) => x.kind === 'update' && x.newText !== null).sort((x, y) => y.start - x.start)) {
        const line = out[r.line - 1];
        out[r.line - 1] = line.slice(0, r.start) + (r.newText as string) + line.slice(r.end);
        changed++;
      }
      return { lines: out, changed };
    },
    t,
  };
  h.service = createRenumberOthers(deps);
  return h;
}

/** A Renumber Blocks result that wrote: `renumbered` is set. */
function wrote(over: Partial<TransformResult> = {}): TransformResult {
  return {
    lines: [],
    summary: { key: 'ncNumbering.renumber.summary', params: { count: 5 } },
    skipped: [],
    warnings: [],
    // O2000 of A had its blocks renumbered (a run that touched no program has nothing to look for).
    renumbered: {
      byText: false,
      prefix: 'N',
      programs: [{ name: 'O2000', key: 2000, changed: new Map<number | string, string | null>([[30, '300']]), created: new Set<string>(), duplicated: new Set<string>() }],
    },
    ...over,
  };
}

/** The references the fake finds: B holds two values to update, C one value that is gone. */
function listed(h: Harness): void {
  h.answer = [
    [ref(B_LINES, 2, '30', '300'), ref(B_LINES, 4, '40', '400'), ref(B_LINES, 4, '1000', null, 'duplicate')],
    [ref(C_LINES, 2, '50', null, 'gone')],
  ];
}

const report = (): ReportData | null => get(results.current);

beforeEach(() => {
  results.clear();
});

// ---------------------------------------------------------------------------
// The list after a renumber (rule 11, 12)
// ---------------------------------------------------------------------------

describe('afterRenumber: what is read', () => {
  it('reads the other open documents of the same dialect, never the renumbered one, never another dialect', () => {
    const h = harness();
    h.service.afterRenumber(h.a, wrote());
    expect(h.asked).toHaveLength(1);
    expect(h.asked[0].others).toEqual([
      { lines: B_LINES, profileId: 'fanuc-gcode' },
      { lines: C_LINES, profileId: 'fanuc-gcode' },
    ]);
  });

  it('hands over the renumber outcome and the programs of the renumbered document that call another', () => {
    const h = harness();
    const result = wrote();
    h.service.afterRenumber(h.a, result);
    expect(h.asked[0].source.outcome).toBe(result.renumbered);
    expect(h.asked[0].source.cp.profile.id).toBe('fanuc-gcode');
    // O1000 calls O2000 (M98 P2000 Q30); O2000 calls nothing.
    expect([...h.asked[0].source.callers]).toEqual([[2000, [1000]]]);
    expect([...h.asked[0].source.held]).toEqual([[1000, 1], [2000, 1]]);
  });

  it('reads nothing when a closed document is the only other one: a file that is not open is never read', () => {
    const h = harness();
    h.docs.remove(h.b);
    h.docs.remove(h.c);
    h.service.afterRenumber(h.a, wrote());
    expect(h.asked).toHaveLength(0);
    expect(h.service.pending()).toBeNull();
  });

  it('does nothing for a run that did not happen, was declined or wrote nothing, and keeps the earlier list', () => {
    const h = harness();
    listed(h);
    h.service.afterRenumber(h.a, wrote());
    const before = h.service.pending();
    expect(before).not.toBeNull();
    h.service.afterRenumber(null, wrote());
    h.service.afterRenumber(h.a, null);
    h.service.afterRenumber(h.a, wrote({ renumbered: undefined }));
    expect(h.asked).toHaveLength(1);
    expect(h.service.pending()).toBe(before);
  });
});

describe('afterRenumber: the list, Results and the status bar', () => {
  it('keeps the rows per document with the versions they were listed at', () => {
    const h = harness();
    listed(h);
    h.versions.set(h.a, 7);
    h.versions.set(h.b, 3);
    h.service.afterRenumber(h.a, wrote());
    const pending = h.service.pending();
    expect(pending?.sourceDocId).toBe(h.a);
    expect(pending?.sourceVersion).toBe(7);
    expect(pending?.docs.map((d) => [d.docId, d.version, d.refs.length])).toEqual([
      [h.b, 3, 3],
      [h.c, 1, 1],
    ]);
  });

  it('puts one row per reference into Results, each with its own document and line, below the renumber\'s own rows', () => {
    const h = harness();
    listed(h);
    // The report the transform service has just published for this run.
    results.show({
      title: t('ncNumbering.renumber.title'),
      message: 'Renumbered 5 blocks. 1 line is listed below.',
      columns: [],
      rows: [],
      findings: [{ line: 6, message: 'Left alone: starts with a skip mark.' }],
      docId: h.a,
    });
    h.service.afterRenumber(h.a, wrote());

    const shown = report();
    expect(shown?.docId).toBe(h.a);
    expect(shown?.columns.map((c) => c.key)).toEqual(['document', 'line', 'text', 'what']);
    expect(shown?.rows.map((r) => [r.docId, r.line])).toEqual([
      [h.a, 6], // the renumber's own row first
      [h.b, 2],
      [h.b, 4],
      [h.b, 4],
      [h.c, 2],
    ]);
    expect(shown?.rows[0].what).toBe('Left alone: starts with a skip mark.');
    expect(shown?.rows[1]).toMatchObject({ document: h.docs.get(h.b)?.title, text: 'N10 M98 P1000 Q30' });
    expect(shown?.rows[1].what).toBe('30 becomes 300 (program 1000).');
    expect(String(shown?.rows[3].what)).toContain('several blocks');
    expect(String(shown?.rows[4].what)).toContain('took away');
    expect(shown?.message).toContain('Renumbered 5 blocks.');
    expect(shown?.message).toContain('4 references');
  });

  it('lists a reference the profile never rewrites as left as it is, and never counts it as one to update', async () => {
    const h = harness();
    h.answer = [[ref(B_LINES, 2, '30', null, 'kept'), ref(B_LINES, 4, '40', '400')], []];
    h.service.afterRenumber(h.a, wrote());
    expect(String(report()?.rows[0].what)).toBe('The block has a new number, but gEdit never rewrites 30 here (program 1000). Left as it is; check it.');
    expect(h.status.at(-1)?.text).toContain('the one marked to update');
    h.confirmAnswers = [true];
    expect(await h.service.update()).toEqual({ documents: 1, references: 1 });
    expect(h.lines.get(h.b)?.[1]).toBe('N10 M98 P1000 Q30');
    expect(h.lines.get(h.b)?.[3]).toBe('N30 M98 P1000 Q400');
  });

  it('shows only the references when the renumber had nothing to report', () => {
    const h = harness();
    listed(h);
    h.service.afterRenumber(h.a, wrote());
    expect(report()?.rows.map((r) => r.docId)).toEqual([h.b, h.b, h.b, h.c]);
  });

  it('says in the status bar how many there are and that Update References in Other Documents rewrites the marked ones', () => {
    const h = harness();
    listed(h);
    h.service.afterRenumber(h.a, wrote());
    const text = h.status.at(-1)?.text ?? '';
    expect(h.status.at(-1)?.error).toBe(false);
    expect(text).toContain('Renumbered 5 blocks.');
    expect(text).toContain('4 references in other open documents');
    expect(text).toContain('Update References in Other Documents');
    expect(text).toContain('the 2 marked to update');
  });

  it('says when none of them can be rewritten', () => {
    const h = harness();
    h.answer = [[], [ref(C_LINES, 2, '50', null, 'gone')]];
    h.service.afterRenumber(h.a, wrote());
    expect(h.status.at(-1)?.text).toContain('None of them can be rewritten for you');
  });

  it('says nothing and keeps no list when nothing points into the renumbered document', () => {
    const h = harness();
    h.service.afterRenumber(h.a, wrote());
    expect(h.service.pending()).toBeNull();
    expect(h.status).toEqual([]);
    expect(report()).toBeNull();
  });
});

describe('the list is replaced, and goes', () => {
  it('a new run that wrote replaces the list, and with no rows drops it with its report (the warning about the lost references is all that is left)', () => {
    const h = harness();
    listed(h);
    h.service.afterRenumber(h.a, wrote());
    expect(h.service.pending()).not.toBeNull();
    expect(report()).not.toBeNull();

    h.answer = [];
    h.service.afterRenumber(h.a, wrote());
    expect(h.service.pending()).toBeNull();
    expect(report()?.rows.map((r) => r.what)).toEqual([expect.stringContaining('no longer listed')]);
  });

  it('a run on another document replaces the list with that document\'s', () => {
    const h = harness();
    listed(h);
    h.service.afterRenumber(h.a, wrote());
    h.answer = [[ref(A_LINES, 3, '30', '300')]];
    h.service.afterRenumber(h.b, wrote());
    expect(h.service.pending()?.sourceDocId).toBe(h.b);
    expect(h.service.pending()?.docs.map((d) => d.docId)).toEqual([h.a]);
  });

  it('is not reported as pending while the renumbered document is closed; a closed listed document does not take the list away', () => {
    const h = harness();
    listed(h);
    h.service.afterRenumber(h.a, wrote());
    h.docs.remove(h.c);
    expect(h.service.pending()).not.toBeNull();
    expect(h.service.canUpdate()).toBe(true);

    const g = harness();
    listed(g);
    g.service.afterRenumber(g.a, wrote());
    g.docs.remove(g.a);
    expect(g.service.pending()).toBeNull();
    expect(g.service.canUpdate()).toBe(false);
  });

  it('bumps revision when the list appears and when it goes, so the ribbon can re-read the command', () => {
    const h = harness();
    const seen: number[] = [];
    h.service.revision.subscribe((n) => seen.push(n));
    listed(h);
    h.service.afterRenumber(h.a, wrote());
    h.answer = [];
    h.service.afterRenumber(h.a, wrote());
    expect(seen.length).toBe(3); // the subscription's own call, the list, the drop
  });
});

// ---------------------------------------------------------------------------
// The update (rule 13)
// ---------------------------------------------------------------------------

describe('update: nothing to do', () => {
  it('says there is nothing and asks nothing when no list is pending', async () => {
    const h = harness();
    expect(await h.service.update()).toEqual({ refused: 'nothing' });
    expect(h.confirms).toEqual([]);
    expect(h.status.at(-1)?.text).toContain('Run Renumber Blocks first');
  });

  it('asks nothing and writes nothing when no listed reference is one it may write', async () => {
    const h = harness();
    h.answer = [[], [ref(C_LINES, 2, '50', null, 'gone')]];
    h.service.afterRenumber(h.a, wrote());
    expect(await h.service.update()).toEqual({ refused: 'nothing' });
    expect(h.confirms).toEqual([]);
    expect(h.applied).toEqual([]);
    expect(h.service.pending()).not.toBeNull();
  });
});

describe('update: the confirmation and the writes', () => {
  async function updated(): Promise<{ h: Harness; answer: Awaited<ReturnType<RenumberOthersService['update']>> }> {
    const h = harness();
    listed(h);
    h.service.afterRenumber(h.a, wrote());
    h.confirmAnswers = [true];
    return { h, answer: await h.service.update() };
  }

  it('asks once and says how many references in how many documents it writes and how many it cannot', async () => {
    const { h } = await updated();
    expect(h.confirms).toHaveLength(1);
    expect(h.confirms[0].title).toBe('Update References in Other Documents');
    expect(h.confirms[0].message).toContain('Rewrite 2 references in 1 other document.');
    expect(h.confirms[0].message).toContain('Each document gets its own undo step.');
    expect(h.confirms[0].message).toContain('2 more references cannot be rewritten and stay as they are.');
  });

  it('writes each document with update rows as its own edit of the whole document, and nothing else', async () => {
    const { h, answer } = await updated();
    expect(answer).toEqual({ documents: 1, references: 2 });
    expect(h.applied).toHaveLength(1);
    const [write] = h.applied;
    expect(write.id).toBe(h.b);
    expect([write.startLine, write.endLine]).toEqual([1, B_LINES.length]);
    expect(write.lines).toEqual(['O3000', 'N10 M98 P1000 Q300', 'N20 G0 X0', 'N30 M98 P1000 Q400', 'N40 M30']);
    // The line count does not change, so every line maps to itself and the edits stay minimal.
    expect([...(write.map ?? [])]).toEqual([0, 1, 2, 3, 4]);
    // A and C were not written: C holds only a value that is gone, which is never written.
    expect(h.lines.get(h.a)).toEqual(A_LINES);
    expect(h.lines.get(h.c)).toEqual(C_LINES);
  });

  it('writes one undo step per document: one applyLines call for each document with update rows', async () => {
    const h = harness();
    h.answer = [[ref(B_LINES, 2, '30', '300')], [ref(C_LINES, 2, '50', '500')]];
    h.service.afterRenumber(h.a, wrote());
    h.confirmAnswers = [true];
    expect(await h.service.update()).toEqual({ documents: 2, references: 2 });
    expect(h.applied.map((w) => w.id)).toEqual([h.b, h.c]);
    expect(h.lines.get(h.c)).toEqual(['O4000', 'N10 M98 P1000 Q500', 'N20 M30']);
  });

  it('says what it did, drops the list and keeps the rows that were never written in Results', async () => {
    const { h } = await updated();
    expect(h.status.at(-1)).toEqual({ text: 'Updated 2 references in 1 other document.', error: false });
    expect(h.service.pending()).toBeNull();
    const shown = report();
    expect(shown?.rows.map((r) => [r.docId, r.line])).toEqual([
      [h.b, 4],
      [h.c, 2],
    ]);
    expect(shown?.message).toContain('Updated 2 references in 1 other document.');
    expect(shown?.message).toContain('2 more are listed below');
  });

  it('a second update has nothing to do', async () => {
    const { h } = await updated();
    expect(await h.service.update()).toEqual({ refused: 'nothing' });
    expect(h.applied).toHaveLength(1);
  });

  it('writes nothing when the question is declined, and keeps the list', async () => {
    const h = harness();
    listed(h);
    h.service.afterRenumber(h.a, wrote());
    h.confirmAnswers = [false];
    expect(await h.service.update()).toEqual({ refused: 'declined' });
    expect(h.applied).toEqual([]);
    expect(h.service.pending()).not.toBeNull();
  });
});

describe('update: refused as a whole, nothing written anywhere', () => {
  function listedTwo(): Harness {
    const h = harness();
    h.answer = [[ref(B_LINES, 2, '30', '300')], [ref(C_LINES, 2, '50', '500')]];
    h.service.afterRenumber(h.a, wrote());
    h.confirmAnswers = [true, true];
    return h;
  }

  function refusedWithNothingWritten(h: Harness, why: string): void {
    expect(h.applied, 'no document is written, not even the ones that are fine').toEqual([]);
    expect(h.status.at(-1)?.error).toBe(true);
    expect(h.status.at(-1)?.text).toContain(why);
  }

  it('when the renumbered document was closed', async () => {
    const h = listedTwo();
    h.docs.remove(h.a);
    expect(await h.service.update()).toEqual({ refused: 'closed' });
    refusedWithNothingWritten(h, 'was closed since the references were listed');
    expect(h.status.at(-1)?.text).not.toContain('Run Renumber Blocks again');
    expect(h.service.pending()).toBeNull();
  });

  it('when the renumbered document was closed while the question was open', async () => {
    const h = listedTwo();
    h.whileAsked = () => h.docs.remove(h.a);
    expect(await h.service.update()).toEqual({ refused: 'closed' });
    expect(h.confirms).toHaveLength(1);
    refusedWithNothingWritten(h, 'was closed since the references were listed');
  });

  it('when a document it would write is locked, and the list stays so that it can be tried again', async () => {
    const h = listedTwo();
    h.docs.update(h.c, { readOnly: true, readOnlyReason: 'user' });
    expect(await h.service.update()).toEqual({ refused: 'locked' });
    refusedWithNothingWritten(h, 'locked against editing');
    expect(h.status.at(-1)?.text).toContain('Nothing was written in any document.');
    expect(h.service.pending()).not.toBeNull();

    h.docs.update(h.c, { readOnly: false, readOnlyReason: null });
    expect(await h.service.update()).toEqual({ documents: 2, references: 2 });
  });

  it('a lock on a document with no rows to write does not matter, and neither does one on the renumbered document', async () => {
    const h = harness();
    h.answer = [[ref(B_LINES, 2, '30', '300')], [ref(C_LINES, 2, '50', null, 'gone')]];
    h.service.afterRenumber(h.a, wrote());
    h.docs.update(h.c, { readOnly: true, readOnlyReason: 'user' });
    h.docs.update(h.a, { readOnly: true, readOnlyReason: 'user' });
    h.confirmAnswers = [true];
    expect(await h.service.update()).toEqual({ documents: 1, references: 1 });
  });

  it('when a document it would write has no model (P4d review CODE-5), and the list stays', async () => {
    const h = listedTwo();
    h.noModel.add(h.c);
    expect(await h.service.update()).toEqual({ refused: 'unavailable' });
    refusedWithNothingWritten(h, 'cannot be edited yet');
    expect(h.status.at(-1)?.text).toContain(h.docs.get(h.c)?.title);
    expect(h.confirms).toEqual([]);
    expect(h.service.pending()).not.toBeNull();
    h.noModel.clear();
    expect(await h.service.update()).toEqual({ documents: 2, references: 2 });
  });

  it('when a document was locked while the question was open', async () => {
    const h = listedTwo();
    h.whileAsked = () => h.docs.update(h.b, { readOnly: true, readOnlyReason: 'user' });
    expect(await h.service.update()).toEqual({ refused: 'locked' });
    refusedWithNothingWritten(h, 'locked against editing');
  });

  it('when another renumber replaced the list while the question was open', async () => {
    const h = listedTwo();
    h.whileAsked = () => {
      h.answer = [[ref(B_LINES, 4, '40', '400')], []];
      h.service.afterRenumber(h.a, wrote());
    };
    expect(await h.service.update()).toEqual({ refused: 'changed' });
    refusedWithNothingWritten(h, 'the list was replaced');
    // The new list is the pending one, and untouched.
    expect(h.service.pending()?.docs.map((d) => d.refs[0].text)).toEqual(['40']);
  });
});

// ---------------------------------------------------------------------------
// Update finds the references again (P4d review CODE-2 / CODE-4 / NC-7, owner B, 2026-10-22)
// ---------------------------------------------------------------------------

describe('update: the references are found again in the documents as they are now', () => {
  function listedTwo(): Harness {
    const h = harness();
    h.answer = [[ref(B_LINES, 2, '30', '300')], [ref(C_LINES, 2, '50', '500')]];
    h.service.afterRenumber(h.a, wrote());
    h.confirmAnswers = [true, true];
    return h;
  }

  it('keeps the outcome, the callers and the ids and versions of every document it read, and finds nothing again while none changed', async () => {
    const h = listedTwo();
    expect(h.asked).toHaveLength(1);
    expect(await h.service.update()).toEqual({ documents: 2, references: 2 });
    // Nothing changed, so there was nothing to read again.
    expect(h.asked).toHaveLength(1);
  });

  it('a document that is not of the profile (another dialect) opened or edited does not make the list differ', async () => {
    const h = listedTwo();
    h.versions.set(h.d, 99);
    expect(await h.service.update()).toEqual({ documents: 2, references: 2 });
    expect(h.asked).toHaveLength(1);
  });

  it('a listed document changed: shows the fresh list in Results, writes nothing, and the next Update writes the fresh rows', async () => {
    const h = listedTwo();
    h.versions.set(h.b, 2);
    // B was edited: its value is now on line 4 and is another number.
    h.answer = [[ref(B_LINES, 4, '40', '400')], [ref(C_LINES, 2, '50', '500')]];
    expect(await h.service.update()).toEqual({ refused: 'changed' });

    expect(h.asked).toHaveLength(2);
    expect(h.applied, 'nothing is written on the call that found the documents changed').toEqual([]);
    expect(h.confirms, 'and nothing is asked').toEqual([]);
    expect(h.status.at(-1)?.error).toBe(true);
    expect(h.status.at(-1)?.text).toContain('changed since the references were listed');
    expect(h.status.at(-1)?.text).toContain('new list is in Results');
    expect(h.status.at(-1)?.text).toContain('run Update References in Other Documents again');
    expect(h.status.at(-1)?.text).not.toContain('Run Renumber Blocks again');
    expect(report()?.rows.map((r) => [r.docId, r.line])).toEqual([
      [h.b, 4],
      [h.c, 2],
    ]);
    expect(h.service.pending()?.docs.map((d) => [d.docId, d.refs[0].text])).toEqual([
      [h.b, '40'],
      [h.c, '50'],
    ]);
    expect(h.service.canUpdate()).toBe(true);

    // The second Update writes the fresh rows.
    expect(await h.service.update()).toEqual({ documents: 2, references: 2 });
    expect(h.lines.get(h.b)?.[3]).toBe('N30 M98 P1000 Q400');
    expect(h.lines.get(h.b)?.[1]).toBe('N10 M98 P1000 Q30');
  });

  it('a listed document changed but the rows are the same: writes', async () => {
    const h = listedTwo();
    h.versions.set(h.b, 2);
    expect(await h.service.update()).toEqual({ documents: 2, references: 2 });
    expect(h.asked).toHaveLength(2);
    expect(h.applied.map((w) => w.id)).toEqual([h.b, h.c]);
  });

  it('a document of the dialect opened between the list and Update: recomputed, the fresh list shown, nothing written', async () => {
    const h = listedTwo();
    const opened = h.docs.add(newDoc({ untitledIndex: 9 }));
    const lines = ['O6000', 'N10 M98 P1000 Q30', 'N20 M30'];
    h.lines.set(opened, lines);
    h.answer = [[ref(B_LINES, 2, '30', '300')], [ref(C_LINES, 2, '50', '500')], [ref(lines, 2, '30', '300')]];
    expect(await h.service.update()).toEqual({ refused: 'changed' });
    expect(h.asked[1].others).toHaveLength(3);
    expect(h.applied).toEqual([]);
    expect(h.service.pending()?.docs.map((d) => d.docId)).toEqual([h.b, h.c, opened]);
    expect(report()?.rows.map((r) => r.docId)).toEqual([h.b, h.c, opened]);
    expect(await h.service.update()).toEqual({ documents: 3, references: 3 });
  });

  it('a document opened that holds no reference still makes the list be read again, and the same rows are written', async () => {
    const h = listedTwo();
    h.docs.add(newDoc({ untitledIndex: 9 }));
    expect(await h.service.update()).toEqual({ documents: 2, references: 2 });
    expect(h.asked).toHaveLength(2);
  });

  it('a listed document closed: the list without it is shown and nothing is written', async () => {
    const h = listedTwo();
    h.docs.remove(h.c);
    h.answer = [[ref(B_LINES, 2, '30', '300')]];
    expect(await h.service.update()).toEqual({ refused: 'changed' });
    expect(h.applied).toEqual([]);
    expect(h.service.pending()?.docs.map((d) => d.docId)).toEqual([h.b]);
    expect(report()?.rows.map((r) => r.docId)).toEqual([h.b]);
    expect(await h.service.update()).toEqual({ documents: 1, references: 1 });
  });

  it('every listed document closed: says no reference is left, drops the list and its report', async () => {
    const h = listedTwo();
    h.docs.remove(h.b);
    h.docs.remove(h.c);
    expect(await h.service.update()).toEqual({ refused: 'changed' });
    expect(h.applied).toEqual([]);
    expect(h.status.at(-1)?.text).toContain('no reference is left to update');
    expect(h.service.pending()).toBeNull();
    expect(report()).toBeNull();
  });

  it('a document changed while the question was open: refused, the fresh list shown, nothing written', async () => {
    const h = listedTwo();
    h.whileAsked = () => {
      h.versions.set(h.b, 5);
      h.answer = [[ref(B_LINES, 4, '40', '400')], [ref(C_LINES, 2, '50', '500')]];
    };
    expect(await h.service.update()).toEqual({ refused: 'changed' });
    expect(h.confirms).toHaveLength(1);
    expect(h.applied).toEqual([]);
    expect(h.service.pending()?.docs[0].refs[0].text).toBe('40');
  });

  it('the renumbered document changed: refuses with the instruction to undo, writes nothing, and the list stays so that undoing makes it right again', async () => {
    const h = listedTwo();
    const title = h.docs.get(h.a)?.title ?? '';
    h.versions.set(h.a, 2);
    expect(await h.service.update()).toEqual({ refused: 'changed' });
    expect(h.applied).toEqual([]);
    expect(h.confirms).toEqual([]);
    expect(h.status.at(-1)?.error).toBe(true);
    expect(h.status.at(-1)?.text).toBe(`Nothing was written: ${title} changed after the renumber. Undo your changes in ${title}, or undo the renumber and run it again.`);
    expect(h.status.at(-1)?.text).not.toContain('Run Renumber Blocks again');
    expect(h.service.pending()).not.toBeNull();

    // The user undoes their changes: the document is the one that was listed again.
    h.versions.set(h.a, 1);
    expect(await h.service.update()).toEqual({ documents: 2, references: 2 });
  });

  it('after that refusal a new renumber replaces the list without the warning about lost references', async () => {
    const h = listedTwo();
    h.versions.set(h.a, 2);
    await h.service.update();
    h.versions.set(h.a, 3);
    h.answer = [[ref(B_LINES, 4, '40', '400')], []];
    h.service.afterRenumber(h.a, wrote());
    expect(h.status.at(-1)?.text).not.toContain('no longer listed');
    expect(report()?.rows.some((r) => String(r.what).includes('no longer listed'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A renumber that writes replaces the list (P4d review CODE-3, owner C, 2026-10-22)
// ---------------------------------------------------------------------------

describe('a renumber that wrote replaces a list that was never updated', () => {
  const lostText = (name: string, count: number): string =>
    `${count} references from the earlier renumber of ${name} were not updated and are no longer listed. Undo both renumbers, renumber once, then update.`;

  it('on the same document: warns in the status bar and in one Results row, and the new list stands alone', () => {
    const h = harness();
    listed(h); // two update rows, one duplicate, one gone
    h.service.afterRenumber(h.a, wrote());
    const name = h.docs.get(h.a)?.title ?? '';

    h.versions.set(h.a, 2);
    h.answer = [[ref(B_LINES, 4, '40', '400')], []];
    h.service.afterRenumber(h.a, wrote());

    expect(h.status.at(-1)?.error).toBe(true);
    expect(h.status.at(-1)?.text).toContain(lostText(name, 2));
    const warnings = (report()?.rows ?? []).filter((r) => String(r.what).includes('no longer listed'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].what).toBe(lostText(name, 2));
    // Never composed: only the second run's reference is in the list.
    expect(h.service.pending()?.docs.map((d) => d.refs.map((r) => r.text))).toEqual([['40']]);
    expect(h.service.pending()?.sourceVersion).toBe(2);
  });

  it('on another document: the list of the other document replaces it, with the same warning naming the first', () => {
    const h = harness();
    listed(h);
    h.service.afterRenumber(h.a, wrote());
    const name = h.docs.get(h.a)?.title ?? '';

    h.answer = [[ref(A_LINES, 3, '30', '300')]];
    h.service.afterRenumber(h.b, wrote());

    expect(h.status.at(-1)?.text).toContain(lostText(name, 2));
    expect((report()?.rows ?? []).filter((r) => String(r.what).includes('no longer listed'))).toHaveLength(1);
    expect(h.service.pending()?.sourceDocId).toBe(h.b);
    expect(h.service.pending()?.docs.map((d) => d.docId)).toEqual([h.a]);
  });

  it('says it once with a count of one, and also when the second run lists nothing', () => {
    const h = harness();
    h.answer = [[ref(B_LINES, 2, '30', '300')], []];
    h.service.afterRenumber(h.a, wrote());
    const name = h.docs.get(h.a)?.title ?? '';

    h.answer = [];
    h.service.afterRenumber(h.a, wrote());

    const one = `1 reference from the earlier renumber of ${name} was not updated and is no longer listed. Undo both renumbers, renumber once, then update.`;
    expect(h.status.at(-1)?.text).toContain(one);
    expect(report()?.rows.map((r) => r.what)).toEqual([one]);
    expect(h.service.pending()).toBeNull();
  });

  it('is silent when the earlier list had nothing to update, when it was updated, or when its document was closed', async () => {
    const onlyGone = harness();
    onlyGone.answer = [[], [ref(C_LINES, 2, '50', null, 'gone')]];
    onlyGone.service.afterRenumber(onlyGone.a, wrote());
    onlyGone.answer = [[ref(B_LINES, 4, '40', '400')], []];
    onlyGone.service.afterRenumber(onlyGone.a, wrote());
    expect(onlyGone.status.at(-1)?.text).not.toContain('no longer listed');
    expect(onlyGone.status.at(-1)?.error).toBe(false);

    const updated = harness();
    listed(updated);
    updated.service.afterRenumber(updated.a, wrote());
    updated.confirmAnswers = [true];
    await updated.service.update();
    updated.answer = [[ref(B_LINES, 4, '40', '400')], []];
    updated.service.afterRenumber(updated.a, wrote());
    expect(updated.status.at(-1)?.text).not.toContain('no longer listed');

    const closed = harness();
    listed(closed);
    closed.service.afterRenumber(closed.a, wrote());
    closed.docs.remove(closed.a);
    closed.answer = [[ref(C_LINES, 2, '50', '500')]];
    closed.service.afterRenumber(closed.b, wrote());
    expect(closed.status.at(-1)?.text).not.toContain('no longer listed');
  });

  it('a run that did not write leaves the list and says nothing', () => {
    const h = harness();
    listed(h);
    h.service.afterRenumber(h.a, wrote());
    const statusBefore = h.status.length;
    h.service.afterRenumber(h.a, wrote({ renumbered: undefined }));
    expect(h.status).toHaveLength(statusBefore);
    expect(h.service.pending()).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The write itself (P4d review CODE-5)
// ---------------------------------------------------------------------------

describe('update: what reached a document is what is counted', () => {
  function listedTwo(): Harness {
    const h = harness();
    h.answer = [[ref(B_LINES, 2, '30', '300')], [ref(C_LINES, 2, '50', '500')]];
    h.service.afterRenumber(h.a, wrote());
    h.confirmAnswers = [true];
    return h;
  }

  it('an exception on the second document says how many were updated, tells to undo in each, and keeps the list', async () => {
    const h = listedTwo();
    h.applyHook = (_id, call) => {
      if (call === 2) throw new Error('model disposed');
      return undefined;
    };
    expect(await h.service.update()).toEqual({ refused: 'failed' });
    expect(h.applied.map((w) => w.id)).toEqual([h.b]);
    expect(h.status.at(-1)).toEqual({ text: 'Updated 1 of 2 documents. Undo in each document to take it back.', error: true });
    expect(h.service.pending()).not.toBeNull();
  });

  it('an apply that changed no line is not counted as updated, and the list stays', async () => {
    const h = listedTwo();
    h.applyHook = () => ({ changedLines: 0 });
    expect(await h.service.update()).toEqual({ refused: 'failed' });
    expect(h.status.at(-1)?.error).toBe(true);
    expect(h.status.at(-1)?.text).not.toContain('Updated');
    expect(h.status.at(-1)?.text).toContain('Nothing was written');
    expect(h.service.pending()).not.toBeNull();
  });

  it('one document that took no edit among those that did: counted as updated of the total', async () => {
    const h = listedTwo();
    h.applyHook = (id) => (id === h.c ? { changedLines: 0 } : undefined);
    expect(await h.service.update()).toEqual({ refused: 'failed' });
    expect(h.status.at(-1)?.text).toBe('Updated 1 of 2 documents. Undo in each document to take it back.');
  });
});

// ---------------------------------------------------------------------------
// Nothing to look for, nothing to read (P4d review CODE-7) and the command's enablement (CODE-8)
// ---------------------------------------------------------------------------

describe('afterRenumber: reads nothing when there is nothing to look for', () => {
  it('a profile without a reference rule that names another program reads no document and builds no source', () => {
    const h = harness('okuma-osp');
    h.service.afterRenumber(h.a, wrote());
    expect(h.reads).toEqual({ getLines: 0, sourceOf: 0 });
    expect(h.asked).toHaveLength(0);
    expect(h.service.pending()).toBeNull();
  });

  it('a run that touched no program reads no document either', () => {
    const h = harness();
    h.service.afterRenumber(h.a, wrote({ renumbered: { byText: false, prefix: 'N', programs: [] } }));
    expect(h.reads).toEqual({ getLines: 0, sourceOf: 0 });
    expect(h.asked).toHaveLength(0);
  });

  it('a profile with such a rule and a program that was touched does read (the two cases above are not vacuous)', () => {
    const h = harness();
    h.service.afterRenumber(h.a, wrote());
    expect(h.reads.sourceOf).toBe(1);
    expect(h.reads.getLines).toBeGreaterThan(0);
  });
});

describe('canUpdate: the command is enabled only when some listed reference may be written', () => {
  it('is false for a list of rows that are never written, true as soon as one can be', () => {
    const gone = harness();
    gone.answer = [[], [ref(C_LINES, 2, '50', null, 'gone')]];
    gone.service.afterRenumber(gone.a, wrote());
    expect(gone.service.pending()).not.toBeNull();
    expect(gone.service.canUpdate()).toBe(false);

    const some = harness();
    listed(some);
    some.service.afterRenumber(some.a, wrote());
    expect(some.service.canUpdate()).toBe(true);
  });

  it('is false with no list and after an update', async () => {
    const h = harness();
    expect(h.service.canUpdate()).toBe(false);
    listed(h);
    h.service.afterRenumber(h.a, wrote());
    h.confirmAnswers = [true];
    await h.service.update();
    expect(h.service.canUpdate()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The command (contrib/renumberOthers.ts)
// ---------------------------------------------------------------------------

describe('the command nc.updateOtherReferences', () => {
  it('is enabled while the list has a reference it may write (canUpdate), and only then, whatever the document', async () => {
    const contribution = (await import('$lib/contrib/renumberOthers')).default;
    const command: CommandDef = contribution.commands[0];
    expect(command.id).toBe('nc.updateOtherReferences');
    fake.pending = {};
    fake.canUpdate = false; // a list of only rows it never writes (P4d review CODE-8)
    expect(command.enabled?.({ activeDocId: 'd1' } as never)).toBe(false);
    fake.pending = null;
    expect(command.enabled?.({ activeDocId: null } as never)).toBe(false);
    fake.pending = {};
    fake.canUpdate = true;
    expect(command.enabled?.({ activeDocId: 'd1' } as never)).toBe(true);
    expect(command.enabled?.({ activeDocId: null } as never)).toBe(true);
  });

  it('runs the update, has no key, a title and a category with messages, and an icon', async () => {
    const contribution = (await import('$lib/contrib/renumberOthers')).default;
    const command: CommandDef = contribution.commands[0];
    fake.updated = 0;
    await command.run({ activeDocId: 'd1' } as never);
    expect(fake.updated).toBe(1);
    expect(command.keys).toBeUndefined();
    expect(t(command.title)).toBe('Update References in Other Documents…');
    expect(command.icon).toBeDefined();
  });

  it('sits in the NC tab, Numbering group, between Renumber Blocks (5) and Remove Block Numbers (15)', async () => {
    const contribution = (await import('$lib/contrib/renumberOthers')).default;
    expect(contribution.ribbon).toEqual([{ tab: 'nc', group: 'ncNumbering.group', command: 'nc.updateOtherReferences', order: 10 }]);
  });
});
