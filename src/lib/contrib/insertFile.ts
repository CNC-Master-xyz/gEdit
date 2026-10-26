// Insert File and Append File (Phase 4 plan §6.5 rule 8; commands `file.insertFile` and `file.appendFile`,
// §6.11). Owner: P4.14b. One feature per file (plan AD-3); see ./README.md.
//
// The file comes from the file dialog (one file) and is read the way Open reads it: its size is asked first
// (`MAX_OPEN_BYTES`), then `fs.readFile` through `files.readDisk` and `decodeFile` without `allowBinary`
// (UTF-8, the BOMs, UTF-16, the Windows-1252 fallback; a binary file is refused; stray NUL bytes are dropped
// and counted). The decoded text is LF; Monaco writes it with the document's own line ending. Which lines go in,
// where they go, the warnings, the refusals and the Klartext numbering are `core/nc/insertFile.ts` (pure); this
// file reads the editor, applies the plan as **one** `applyLines` call (one undo step, the numbers of the blocks
// below included) and selects what came in.
//
// Not offered without a document, in a locked document, with the compare overlay open or in the channel view
// (the channel view re-projects, and an insert could move lines to another channel: §6.7 rule 10). The dialog
// and the read take time, so all of it is asked again after the read, and the program must still be the one
// in front: the cursor is read from the focused editor.

import FilePlus from 'lucide-svelte/icons/file-plus';
import FileInput from 'lucide-svelte/icons/file-input';
import { get } from 'svelte/store';
import { asIcon } from '$lib/app/icons';
import { dialogs } from '$lib/app/dialogs';
import { files, formatBytes, MAX_OPEN_BYTES } from '$lib/app/fileOps';
import { lockRefusal } from '$lib/app/readOnlyLock';
import { status } from '$lib/app/status';
import { insertReplacement, planInsert, type InsertPlan, type InsertRefusal, type InsertWarning } from '$lib/core/nc/insertFile';
import type { CompiledProfile } from '$lib/core/profiles/types';
import { t } from '$lib/i18n';
import { applyLines } from '$lib/monaco/applyLines';
import { editor } from '$lib/monaco/editorService';
import { filesStat } from '$lib/platform/commands';
import { docs } from '$lib/stores/documents';
import { layout } from '$lib/stores/layout';
import { machines } from '$lib/stores/machines';
import type { CommandContext, Contribution, DocId } from '$lib/app/types';

type Mode = 'insert' | 'append';

/** The channel view is open: it re-projects the document, so nothing is inserted from here. */
function channelViewOpen(): boolean {
  return editor.groupsState().layout === 'channels';
}

function canInsert(context: CommandContext): boolean {
  const id = context.activeDocId;
  if (id === null || context.compareOpen || channelViewOpen()) return false;
  return docs.get(id)?.readOnly !== true;
}

function fileName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

// --- the words ----------------------------------------------------------------------------

/** A line as a message quotes it: trimmed, and cut after 30 characters. */
function quoted(line: string): string {
  const text = line.trim();
  return text.length > 30 ? `${text.slice(0, 30)}…` : text;
}

/** The status-bar sentence of a refusal of the plan; `lines` are the file's lines (for the text of the line it names). */
export function refusalText(refusal: InsertRefusal, lines: readonly string[], name: string): string {
  const lineText = (line: number): string => quoted(lines[line - 1] ?? '');
  switch (refusal.reason) {
    case 'empty':
      return t('insertFile.empty', { name });
    case 'onlyTapeMarks':
      return t('insertFile.onlyTapeMarks', { name });
    case 'secondProgramStart':
      return refusal.endLine === undefined
        ? t('insertFile.secondProgramStart', { text: lineText(refusal.line), line: refusal.line })
        : t('insertFile.secondProgram', { text: lineText(refusal.line), line: refusal.line, endText: lineText(refusal.endLine), endLine: refusal.endLine });
    case 'programEndInFile':
      return t('insertFile.programEndInFile', { text: lineText(refusal.line), line: refusal.line });
    case 'continuesBlock': {
      const text = (lines[refusal.line - 1] ?? '').trim();
      return refusal.first
        ? t('insertFile.continuesAbove', { name, mark: text.charAt(0) })
        : t('insertFile.continuesBelow', { name, mark: text.charAt(text.length - 1) });
    }
    case 'tooManyBelow':
      return t('insertFile.tooManyBelow', { limit: refusal.limit });
    case 'overflow':
      return t('insertFile.overflow', { max: refusal.max });
  }
}

/** The status-bar sentence of a warning after an insert that went ahead. */
function warningText(warning: InsertWarning): string {
  switch (warning.kind) {
    case 'afterProgramEnd':
      return t('insertFile.afterProgramEnd', { line: warning.line });
    case 'afterTapeEnd':
      return t('insertFile.afterTapeEnd', { line: warning.line });
    case 'programFrame':
      return t(warning.end ? 'insertFile.programFrameEnd' : 'insertFile.programFrameStart', { line: warning.line, text: quoted(warning.text) });
  }
}

/**
 * The status-bar message after an insert: what came in and where, the renumbering, the dropped NULs, the `%`
 * lines left out and the warnings.
 */
export function doneText(plan: Extract<InsertPlan, { ok: true }>, name: string, o: { nulStripped: number }): string {
  const count = plan.lines.length;
  const last = plan.beforeLine + count - 1;
  const where = count === 1 ? t('insertFile.atLine', { line: plan.beforeLine }) : t('insertFile.atLines', { first: plan.beforeLine, last });
  const parts = [t('insertFile.done', { count, name, where })];
  if (plan.renumbered > 0) parts.push(t('insertFile.renumbered', { count: plan.renumbered }));
  if (o.nulStripped > 0) parts.push(t('insertFile.nulDropped', { count: o.nulStripped }));
  if (plan.tapeMarksLeftOut > 0) parts.push(t('insertFile.tapeMarksLeftOut', { count: plan.tapeMarksLeftOut }));
  for (const warning of plan.warnings) parts.push(warningText(warning));
  return parts.join(' ');
}

// --- reading the file ---------------------------------------------------------------------

type Source = { ok: true; lines: string[]; nulStripped: number } | { ok: false; message: string };

/** The file as lines, or the sentence that says why it cannot be inserted. */
export async function readSource(path: string): Promise<Source> {
  const name = fileName(path);
  // The size first, as Open does it: the read cannot be cancelled, and a 2 GB file would already be in memory
  // by the time its size were known. No answer is not "small enough".
  let size: number | null = null;
  try {
    const [stat] = await filesStat([path], { partial: true });
    if (stat === undefined || stat.unavailable === true) return { ok: false, message: t('insertFile.unknownSize', { name }) };
    if (stat.exists && stat.size === null && !stat.isDir) return { ok: false, message: t('insertFile.unknownSize', { name }) };
    size = stat.size;
  } catch (err) {
    console.warn('files_stat failed', err);
    return { ok: false, message: t('insertFile.unknownSize', { name }) };
  }
  if (size !== null && size > MAX_OPEN_BYTES) {
    return { ok: false, message: t('insertFile.tooLarge', { name, size: formatBytes(size), limit: formatBytes(MAX_OPEN_BYTES) }) };
  }
  const decoded = await files.readDisk(path);
  if (decoded === null) return { ok: false, message: t('insertFile.notReadable', { name }) };
  if (!decoded.ok) {
    const percent = decoded.message.params?.percent ?? '';
    return { ok: false, message: t('insertFile.binary', { name, percent }) };
  }
  const lines = decoded.text.split('\n');
  // A final line break ends the last line; it does not start another.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return { ok: true, lines, nulStripped: decoded.nul.stripped };
}

// --- the commands ------------------------------------------------------------------------

function refuse(message: string): void {
  status.show(message, { error: true });
}

/** The folder of the document, where the dialog starts. */
function folderOf(id: DocId): string | undefined {
  const path = docs.get(id)?.path ?? null;
  const slash = path === null ? -1 : Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return path !== null && slash > 0 ? path.slice(0, slash) : undefined;
}

/** Why the document cannot take an insert now, or null. Checked before the dialog and again after the read. */
function blocked(id: DocId, title: string): string | null {
  const doc = docs.get(id);
  if (doc === undefined) return t('insertFile.noDocument');
  const locked = lockRefusal(doc, title);
  if (locked !== null) return t(locked.key, locked.params);
  if (channelViewOpen() || get(layout.state).overlay !== null) return t('insertFile.notAvailable', { title });
  return null;
}

/**
 * True when the program is no longer the one in front: another document is active, or the editor with the
 * keyboard focus shows another one. The cursor and the selection are read from the focused editor, so after
 * the dialog and the read they must still be this document's.
 */
function leftFront(id: DocId): boolean {
  if (docs.getActiveId() !== id) return true;
  const state = editor.groupsState();
  const focused = state.groups.find((group) => group.id === state.focused);
  return focused?.content?.docId !== id;
}

async function run(mode: Mode, context: CommandContext): Promise<void> {
  const id = context.activeDocId;
  const title = t(mode === 'insert' ? 'insertFile.insert' : 'insertFile.append');
  if (id === null) return refuse(t('insertFile.noDocument'));
  const before = blocked(id, title);
  if (before !== null) return refuse(before);

  const picked = await dialogs.exclusive(() => dialogs.openFiles({ multiple: false, defaultPath: folderOf(id) }));
  if (picked === undefined || picked.length === 0) return;
  const path = picked[0];
  const name = fileName(path);

  const source = await readSource(path);
  if (!source.ok) return refuse(source.message);

  // The read took time: the document may be gone, locked, behind another one, or in the channel view or the
  // comparison by now.
  const after = blocked(id, title);
  if (after !== null) return refuse(after);
  if (leftFront(id)) return refuse(t('insertFile.changed'));

  // The document's effective profile (AD-31), as Go to Block reads it.
  const cp: CompiledProfile = machines.effective(id).cp;
  const lineCount = editor.getLineCount(id);
  const all = editor.getLines(id, 1, lineCount);
  const read = (line: number): string => all[line - 1] ?? '';

  let line = 1;
  let column = 1;
  let selected = false;
  if (mode === 'insert') {
    const cursor = editor.cursor();
    const selection = editor.selectionLines();
    if (selection !== null && !selection.empty) {
      selected = true;
      line = selection.endLine;
    } else if (cursor !== null) {
      line = cursor.line;
      column = cursor.column;
    }
  }

  const plan = planInsert({ where: mode === 'insert' ? 'cursor' : 'end', line, column, selected, lineCount, read, lines: source.lines }, cp);
  if (!plan.ok) return refuse(refusalText(plan, source.lines, name));

  // One replacement, one undo step: the lines, and the digits of the blocks below that take new numbers.
  const replacement = insertReplacement(plan, read, lineCount);
  const done = applyLines(id, replacement.startLine, replacement.endLine, replacement.newLines);
  if (done.locked === true) return refuse(t('insertFile.changed'));

  // What came in is what is selected, so it is plain to see.
  editor.selectLines(id, plan.beforeLine, plan.beforeLine + plan.lines.length - 1);
  status.show(doneText(plan, name, { nulStripped: source.nulStripped }), { error: plan.warnings.length > 0 });
}

export default {
  id: 'insertFile',
  ribbon: [
    { tab: 'file', group: 'insertFile.group', command: 'file.insertFile', order: 80 },
    { tab: 'file', group: 'insertFile.group', command: 'file.appendFile', order: 81 },
  ],
  commands: [
    {
      id: 'file.insertFile',
      title: 'insertFile.insert',
      category: 'insertFile.category',
      icon: asIcon(FileInput),
      global: true,
      enabled: canInsert,
      run: (context) => run('insert', context),
    },
    {
      id: 'file.appendFile',
      title: 'insertFile.append',
      category: 'insertFile.category',
      icon: asIcon(FilePlus),
      global: true,
      enabled: canInsert,
      run: (context) => run('append', context),
    },
  ],
} satisfies Contribution;
