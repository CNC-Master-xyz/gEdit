// Select or delete a block range (Phase 4 plan §6.5 rule 7; commands `edit.selectBlockRange` and
// `edit.deleteBlockRange`, §6.11). Owner: P4.14a. One feature per file (plan AD-3); see ./README.md.
//
// One form (`modals.form`), two commands: the kind (line numbers or block numbers), the first and the last number.
// `resolveBlockRange` (pure, `core/nav/blockRange.ts`) says what the numbers mean; **a refusal is shown in the form
// as the user types and nothing is selected or deleted**, so the OK button only works for a range that exists.
// The form remembers the kind in `uiState.lastParams['edit.blockRange']`; the two numbers start with the
// selection's lines (line mode) or empty, never with the last range, because a stale range is what a delete must
// not run on.
//
// Select: `editor.selectLines` (document lines, the focused group). Delete: `applyLines(id, first, last, [])`, one
// undo step, and the cursor goes to where the range was. The numbers are document lines in a channel pane as well
// (§6.7 rule 3), so both read and write the document, not the pane.

import ListX from 'lucide-svelte/icons/list-x';
import TextSelect from 'lucide-svelte/icons/text-select';
import { asIcon } from '$lib/app/icons';
import { lockRefusal } from '$lib/app/readOnlyLock';
import { modals } from '$lib/app/modals';
import { status } from '$lib/app/status';
import { blockLabel, indexBlocks, resolveBlockRange, type BlockIndex, type BlockRangeAnswer, type BlockRangeRequest } from '$lib/core/nav/blockRange';
import type { FieldSpec } from '$lib/core/forms/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import { t } from '$lib/i18n';
import { applyLines } from '$lib/monaco/applyLines';
import { editor } from '$lib/monaco/editorService';
import { docs } from '$lib/stores/documents';
import { machines } from '$lib/stores/machines';
import { uiState } from '$lib/stores/uiState';
import type { CommandContext, Contribution, DocId, FormLiveResult, Msg } from '$lib/app/types';

/** The `uiState.lastParams` key the form's kind is remembered under. */
export const FORM_KEY = 'edit.blockRange';

type Mode = 'select' | 'delete';

function hasDocument(context: CommandContext): boolean {
  return context.activeDocId !== null && !context.compareOpen;
}

function canDelete(context: CommandContext): boolean {
  if (!hasDocument(context) || context.activeDocId === null) return false;
  return docs.get(context.activeDocId)?.readOnly !== true;
}

// --- the words ----------------------------------------------------------------------------

/** "12", "12 and 340", "12, 40 and 90": up to five line numbers in plain words. */
export function joinLines(lines: number[]): string {
  if (lines.length < 2) return lines.join('');
  return t('ranges.listAnd', { head: lines.slice(0, -1).join(', '), last: lines[lines.length - 1] });
}

/** The refusal of `answer` for the form: the field it belongs to (or null for the form as a whole) and the message. */
export function refusalMessage(
  answer: Exclude<BlockRangeAnswer, { ok: true }>,
  kind: BlockRangeRequest['kind'],
  cp: CompiledProfile,
): { field: 'from' | 'to' | null; msg: Msg } {
  switch (answer.reason) {
    case 'notNumber':
      return { field: answer.field, msg: { key: kind === 'line' ? 'ranges.notNumberLine' : 'ranges.notNumberBlock' } };
    case 'outsideProgram':
      return { field: answer.field, msg: { key: 'ranges.outsideProgram', params: { lineCount: answer.lineCount } } };
    case 'missingBlock':
      return { field: answer.field, msg: { key: 'ranges.missingBlock', params: { block: blockLabel(answer.number, cp) } } };
    case 'duplicateBlock': {
      const more = answer.total - answer.lines.length;
      // "12 and 340", or, when more follow, "12, 40, 90, 120, 340" and the count of the rest.
      const params = { block: blockLabel(answer.number, cp), lines: more > 0 ? answer.lines.join(', ') : joinLines(answer.lines) };
      return {
        field: answer.field,
        msg: more > 0 ? { key: 'ranges.duplicateBlockMore', params: { ...params, more } } : { key: 'ranges.duplicateBlock', params },
      };
    }
    case 'reversed':
      return { field: null, msg: { key: kind === 'line' ? 'ranges.reversedLine' : 'ranges.reversedBlock' } };
  }
}

/** "lines 12–40 (blocks N100–N200)", "line 12", "lines 12–40". */
export function rangeText(answer: Extract<BlockRangeAnswer, { ok: true }>, cp: CompiledProfile): string {
  const { startLine, endLine, blocks } = answer;
  const lines =
    startLine === endLine ? t('ranges.line', { line: startLine }) : t('ranges.lines', { first: startLine, last: endLine });
  if (blocks === null) return lines;
  const named =
    blocks.from === blocks.to
      ? t('ranges.block', { block: blockLabel(blocks.from, cp) })
      : t('ranges.blocks', { from: blockLabel(blocks.from, cp), to: blockLabel(blocks.to, cp) });
  return t('ranges.withBlocks', { lines, blocks: named });
}

// --- reading ------------------------------------------------------------------------------

/** The document's lines as they are now, read once; a 300,000-line program is one array, not one call per line. */
function snapshot(id: DocId): { read: (line: number) => string; lineCount: number } {
  const lineCount = editor.getLineCount(id);
  const lines = editor.getLines(id, 1, lineCount);
  return { read: (line) => lines[line - 1] ?? '', lineCount };
}

function rememberedKind(): 'line' | 'block' {
  return uiState.getLastParams(FORM_KEY)?.kind === 'block' ? 'block' : 'line';
}

function kindOf(value: unknown): 'line' | 'block' {
  return value === 'block' ? 'block' : 'line';
}

// --- the form ----------------------------------------------------------------------------

async function askRange(mode: Mode, id: DocId, cp: CompiledProfile): Promise<BlockRangeRequest | undefined> {
  const fields: FieldSpec[] = [
    {
      id: 'kind',
      type: 'choice',
      label: t('ranges.kindLabel'),
      default: 'line',
      choices: [
        { label: t('ranges.kindLine'), value: 'line' },
        { label: t('ranges.kindBlock'), value: 'block' },
      ],
    },
    { id: 'from', type: 'text', label: t('ranges.fromLabel'), help: t('ranges.fromHelp'), default: '', required: true, maxLength: 20 },
    { id: 'to', type: 'text', label: t('ranges.toLabel'), help: t('ranges.toHelp'), default: '', required: true, maxLength: 20 },
  ];
  const kind = rememberedKind();
  const selection = kind === 'line' ? editor.selectionLines() : null;
  const values: Record<string, unknown> = { kind };
  if (selection !== null && !selection.empty) {
    values.from = String(selection.startLine);
    values.to = String(selection.endLine);
  }

  // The lines are read when the form first has something to check, and once more when OK is pressed.
  let lines: ReturnType<typeof snapshot> | null = null;
  let index: BlockIndex | null = null;
  const live = (current: Record<string, unknown>): FormLiveResult => {
    const request = { kind: kindOf(current.kind), from: String(current.from ?? ''), to: String(current.to ?? '') };
    // Nothing is said about a form that is still being filled in.
    if (request.from.trim() === '' || request.to.trim() === '') return {};
    lines ??= snapshot(id);
    // One pass over the program for the whole form, not one per keystroke (300,000 lines would lag).
    if (request.kind === 'block') index ??= indexBlocks(lines.read, lines.lineCount, cp);
    const answer = resolveBlockRange(lines.read, lines.lineCount, cp, request, index ?? undefined);
    if (answer.ok) return {};
    const refusal = refusalMessage(answer, request.kind, cp);
    return refusal.field === null ? { error: refusal.msg } : { fieldErrors: { [refusal.field]: refusal.msg } };
  };

  const answer = await modals.form({
    title: t(mode === 'select' ? 'ranges.select' : 'ranges.delete'),
    fields,
    values,
    okLabel: t(mode === 'select' ? 'ranges.okSelect' : 'ranges.okDelete'),
    live,
  });
  if (answer === undefined) return undefined;
  const request = { kind: kindOf(answer.kind), from: String(answer.from ?? ''), to: String(answer.to ?? '') };
  uiState.setLastParams(FORM_KEY, { kind: request.kind });
  return request;
}

// --- the commands ------------------------------------------------------------------------

async function run(mode: Mode, context: CommandContext): Promise<void> {
  const id = context.activeDocId;
  const doc = id === null ? undefined : docs.get(id);
  if (id === null || doc === undefined) {
    status.show(t('ranges.noDocument'), { error: true });
    return;
  }
  if (mode === 'delete') {
    const locked = lockRefusal(doc, t('ranges.delete'));
    if (locked !== null) {
      status.show(t(locked.key, locked.params), { error: true });
      return;
    }
  }
  // The document's effective profile (AD-31), as Go to Block reads it.
  const cp = machines.effective(id).cp;

  const request = await askRange(mode, id, cp);
  if (request === undefined) return;

  // The document may have been closed or locked while the form was open: ask the store again, not the object read before.
  const current = docs.get(id);
  if (current === undefined) {
    status.show(t('ranges.noDocument'), { error: true });
    return;
  }
  if (mode === 'delete') {
    const locked = lockRefusal(current, t('ranges.delete'));
    if (locked !== null) {
      status.show(t(locked.key, locked.params), { error: true });
      return;
    }
  }

  // The program may have changed while the form was open (a script, an external reload): resolve once more.
  const source = snapshot(id);
  const answer = resolveBlockRange(source.read, source.lineCount, cp, request);
  if (!answer.ok) {
    const { msg } = refusalMessage(answer, request.kind, cp);
    status.show(t(msg.key, msg.params), { error: true });
    return;
  }

  const what = rangeText(answer, cp);
  if (mode === 'select') {
    editor.selectLines(id, answer.startLine, answer.endLine);
    status.show(t('ranges.selected', { what }));
    return;
  }

  const count = answer.endLine - answer.startLine + 1;
  const done = applyLines(id, answer.startLine, answer.endLine, []);
  if (done.locked === true) {
    const locked = lockRefusal(docs.get(id) ?? current, t('ranges.delete'));
    if (locked !== null) status.show(t(locked.key, locked.params), { error: true });
    return;
  }
  // The cursor goes to where the range was (the line that moved up into its place, or the last line).
  editor.reveal(id, Math.min(answer.startLine, Math.max(1, editor.getLineCount(id))));
  status.show(t('ranges.deleted', { count, what }));
}

export default {
  id: 'ranges',
  ribbon: [
    { tab: 'edit', group: 'ranges.group', command: 'edit.selectBlockRange', order: 148 },
    { tab: 'edit', group: 'ranges.group', command: 'edit.deleteBlockRange', order: 149 },
  ],
  commands: [
    {
      id: 'edit.selectBlockRange',
      title: 'ranges.select',
      category: 'ranges.category',
      icon: asIcon(TextSelect),
      global: true,
      enabled: hasDocument,
      run: (context) => run('select', context),
    },
    {
      id: 'edit.deleteBlockRange',
      title: 'ranges.delete',
      category: 'ranges.category',
      icon: asIcon(ListX),
      global: true,
      enabled: canDelete,
      run: (context) => run('delete', context),
    },
  ],
} satisfies Contribution;
