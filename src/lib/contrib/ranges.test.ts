// Select or delete a block range (Phase 4 plan §6.5 rule 7): the form, the refusals it shows, the selection, the delete as
// one undo step on a real Monaco model, the remembered kind, and the commands' rows. The resolver is `core/nav/blockRange.test.ts`.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { realModel, type RealModel } from '$lib/monaco/realModel';
import type { CommandDef, FormLiveResult } from '$lib/app/types';
import type { CompiledProfile } from '$lib/core/profiles/types';

function compiled(id: string): CompiledProfile {
  const raw = BUILTIN_PROFILE_JSON.find((entry) => (entry as { id?: string }).id === id);
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  return compileProfile(checked.profile);
}

const FANUC = compiled('fanuc-gcode');
const KLARTEXT = compiled('heidenhain-klartext');

interface FormSpec {
  title: string;
  okLabel?: string;
  fields: { id: string; default?: unknown; required?: boolean }[];
  values?: Record<string, unknown>;
  live?: (values: Record<string, unknown>) => FormLiveResult;
}

const fake = vi.hoisted(() => ({
  model: null as unknown as RealModel,
  cp: null as unknown as CompiledProfile,
  readOnly: false,
  /** The document was closed (the store no longer has it). */
  gone: false,
  selection: null as { startLine: number; endLine: number; empty: boolean } | null,
  answer: undefined as Record<string, unknown> | undefined,
  specs: [] as unknown[],
  messages: [] as { text: string; error: boolean }[],
  selected: [] as { first: number; last: number }[],
  revealed: [] as number[],
  remembered: {} as Record<string, Record<string, unknown>>,
  /** Called while the form is open, like the user typing. */
  whileOpen: undefined as undefined | ((spec: unknown) => void),
}));

vi.mock('$lib/app/modals', () => ({
  modals: {
    form: (spec: unknown): Promise<Record<string, unknown> | undefined> => {
      fake.specs.push(spec);
      fake.whileOpen?.(spec);
      return Promise.resolve(fake.answer);
    },
  },
}));
vi.mock('$lib/app/status', () => ({
  status: { show: (text: string, o?: { error?: boolean }): number => fake.messages.push({ text, error: o?.error === true }), clear: (): void => {} },
}));
vi.mock('$lib/stores/documents', () => ({
  docs: { get: (id: string) => (id === 'd1' && !fake.gone ? { id, title: 'part.nc', readOnly: fake.readOnly, readOnlyReason: fake.readOnly ? 'user' : null } : undefined) },
}));
vi.mock('$lib/stores/machines', () => ({ machines: { effective: () => ({ cp: fake.cp }) } }));
vi.mock('$lib/stores/uiState', () => ({
  uiState: {
    getLastParams: (key: string) => fake.remembered[key],
    setLastParams: (key: string, value: Record<string, unknown>): void => {
      fake.remembered[key] = value;
    },
  },
}));
vi.mock('$lib/monaco/applyLines', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/monaco/applyLines')>();
  return {
    ...actual,
    applyLines: (_id: string, start: number, end: number, lines: string[]) => {
      if (fake.readOnly) return { changedLines: 0, locked: true as const };
      return actual.applyLinesTo(fake.model, start, end, lines);
    },
  };
});
vi.mock('$lib/monaco/editorService', () => ({
  editor: {
    getLineCount: (): number => fake.model.getLineCount(),
    getLines: (_id: string, first: number, last: number): string[] => {
      const out: string[] = [];
      for (let line = first; line <= last; line++) out.push(fake.model.getLineContent(line));
      return out;
    },
    selectionLines: () => fake.selection,
    selectLines: (_id: string, first: number, last: number): number => fake.selected.push({ first, last }),
    reveal: (_id: string, line: number): number => fake.revealed.push(line),
  },
}));

const ranges = (await import('./ranges')).default;
const { joinLines } = await import('./ranges');
const { hasKey, t } = await import('$lib/i18n');

const select = (ranges.commands ?? []).find((c) => c.id === 'edit.selectBlockRange') as CommandDef;
const remove = (ranges.commands ?? []).find((c) => c.id === 'edit.deleteBlockRange') as CommandDef;
const context = { activeDocId: 'd1', profileId: 'fanuc-gcode', hasSelection: false, editorFocused: true, compareOpen: false, modalOpen: false, scriptRunning: false };

const PROGRAM = [
  'O1000', //                  1
  'N10 G90 G54', //            2
  'N20 G1 X1', //              3
  'N30 G1 X2', //              4
  'N40 G1 X3', //              5
  'N50 M30', //                6
  '%', //                      7
];

function open(lines: string[], cp: CompiledProfile = FANUC): void {
  fake.model = realModel(lines.join('\n'));
  fake.cp = cp;
}
const text = (): string => fake.model.getValue();
const lastMessage = () => fake.messages[fake.messages.length - 1];

beforeEach(() => {
  fake.readOnly = false;
  fake.gone = false;
  fake.selection = null;
  fake.answer = undefined;
  fake.specs = [];
  fake.messages = [];
  fake.selected = [];
  fake.revealed = [];
  fake.remembered = {};
  fake.whileOpen = undefined;
  open(PROGRAM);
});

describe('the commands', () => {
  it('are in the Edit tab at orders 148 and 149, without keys, and need a document and no compare overlay', () => {
    expect(select.title).toBe('ranges.select');
    expect(remove.title).toBe('ranges.delete');
    expect(select.keys).toBeUndefined();
    expect(remove.keys).toBeUndefined();
    expect(ranges.ribbon).toEqual([
      { tab: 'edit', group: 'ranges.group', command: 'edit.selectBlockRange', order: 148 },
      { tab: 'edit', group: 'ranges.group', command: 'edit.deleteBlockRange', order: 149 },
    ]);
    expect(select.enabled?.({ ...context, activeDocId: null })).toBe(false);
    expect(select.enabled?.({ ...context, compareOpen: true })).toBe(false);
    expect(remove.enabled?.({ ...context, compareOpen: true })).toBe(false);
    expect(select.enabled?.(context)).toBe(true);
    expect(remove.enabled?.(context)).toBe(true);
  });

  it('the delete is not offered in a locked document; the select still is', () => {
    fake.readOnly = true;
    expect(remove.enabled?.(context)).toBe(false);
    expect(select.enabled?.(context)).toBe(true);
  });

  it('every message the feature uses exists', () => {
    for (const key of [
      'ranges.category', 'ranges.group', 'ranges.select', 'ranges.delete', 'ranges.kindLabel', 'ranges.kindLine', 'ranges.kindBlock',
      'ranges.notNumberLine', 'ranges.notNumberBlock', 'ranges.outsideProgram', 'ranges.missingBlock', 'ranges.duplicateBlock',
      'ranges.duplicateBlockMore', 'ranges.reversedLine', 'ranges.reversedBlock', 'ranges.selected', 'ranges.deleted',
    ]) {
      expect(hasKey(key), key).toBe(true);
    }
  });
});

describe('the form', () => {
  it('opens with the remembered kind and empty numbers', async () => {
    fake.remembered['edit.blockRange'] = { kind: 'block' };
    await select.run(context);
    const spec = fake.specs[0] as FormSpec;
    expect(spec.title).toBe('Select Block Range');
    expect(spec.fields.map((f) => f.id)).toEqual(['kind', 'from', 'to']);
    expect(spec.values).toEqual({ kind: 'block' });
  });

  it('starts at line numbers the first time, and with the selection\'s lines when there is one', async () => {
    fake.selection = { startLine: 3, endLine: 5, empty: false };
    await select.run(context);
    expect((fake.specs[0] as FormSpec).values).toEqual({ kind: 'line', from: '3', to: '5' });
  });

  it('does not put the selection\'s line numbers into a block-number form', async () => {
    fake.remembered['edit.blockRange'] = { kind: 'block' };
    fake.selection = { startLine: 3, endLine: 5, empty: false };
    await select.run(context);
    expect((fake.specs[0] as FormSpec).values).toEqual({ kind: 'block' });
  });

  it('an empty selection prefills nothing', async () => {
    fake.selection = { startLine: 3, endLine: 3, empty: true };
    await select.run(context);
    expect((fake.specs[0] as FormSpec).values).toEqual({ kind: 'line' });
  });

  it('shows each refusal in the form and says nothing about a form still being filled in', async () => {
    let live!: (values: Record<string, unknown>) => FormLiveResult;
    fake.whileOpen = (spec) => {
      live = (spec as FormSpec).live!;
    };
    await select.run(context);
    const msg = (v: Record<string, unknown>) => {
      const answer = live(v);
      const fieldErrors = Object.entries(answer.fieldErrors ?? {}).map(([field, m]) => [field, t(m.key, m.params)]);
      return { fieldErrors, error: answer.error === undefined ? undefined : t(answer.error.key, answer.error.params) };
    };
    expect(live({ kind: 'line', from: '', to: '4' })).toEqual({});
    expect(live({ kind: 'line', from: '2', to: '4' })).toEqual({});
    expect(msg({ kind: 'line', from: 'x', to: '4' }).fieldErrors).toEqual([['from', 'Enter a whole number, for example 120.']]);
    expect(msg({ kind: 'line', from: '2', to: '20' }).fieldErrors).toEqual([['to', 'The program has 7 lines. Enter a line from 1 to 7.']]);
    expect(msg({ kind: 'line', from: '5', to: '4' }).error).toBe('The first line is below the last line. Swap the two.');
    expect(msg({ kind: 'block', from: 'N15', to: 'N50' }).fieldErrors).toEqual([['from', 'Block N15 is not in the program.']]);
    expect(msg({ kind: 'block', from: 'N10', to: 'N60' }).fieldErrors).toEqual([['to', 'Block N60 is not in the program.']]);
    expect(msg({ kind: 'block', from: '?', to: 'N60' }).fieldErrors).toEqual([['from', 'Enter a block number, for example N120 or 120.']]);
    expect(msg({ kind: 'block', from: 'N50', to: 'N10' }).error).toBe('The first block comes after the last block in the program. Swap the two.');
    expect(live({ kind: 'block', from: '10', to: 'N50' })).toEqual({});
  });

  it('says where a duplicate block is: "12 and 340", up to five lines, then how many more', async () => {
    const lines = ['N10 G1', 'N20 G1', ...Array.from({ length: 6 }, (_, i) => `N30 G1 X${i}`), 'N40 M30'];
    open(lines);
    let live!: (values: Record<string, unknown>) => FormLiveResult;
    fake.whileOpen = (spec) => {
      live = (spec as FormSpec).live!;
    };
    await select.run(context);
    const said = (from: string, to: string): string => {
      const e = live({ kind: 'block', from, to }).fieldErrors!;
      const m = Object.values(e)[0];
      return t(m.key, m.params);
    };
    expect(said('N30', 'N40')).toBe('Block N30 is at lines 3, 4, 5, 6, 7 and 1 more. Use line numbers.');
    open(['N10 G1', 'N10 G1', 'N20 G1']);
    let again!: (values: Record<string, unknown>) => FormLiveResult;
    fake.whileOpen = (spec) => {
      again = (spec as FormSpec).live!;
    };
    await select.run(context);
    const two = Object.values(again({ kind: 'block', from: 'N10', to: 'N20' }).fieldErrors!)[0];
    expect(t(two.key, two.params)).toBe('Block N10 is at lines 1 and 2. Use line numbers.');
  });

  it('reads the program once for the whole form, not once per keystroke', async () => {
    let live!: (values: Record<string, unknown>) => FormLiveResult;
    fake.whileOpen = (spec) => {
      live = (spec as FormSpec).live!;
    };
    await select.run(context);
    const original = fake.model.getLineContent.bind(fake.model);
    let reads = 0;
    fake.model.getLineContent = (line: number): string => {
      reads++;
      return original(line);
    };
    live({ kind: 'block', from: 'N1', to: 'N5' });
    const first = reads;
    live({ kind: 'block', from: 'N10', to: 'N5' });
    live({ kind: 'block', from: 'N10', to: 'N50' });
    expect(first).toBeLessThanOrEqual(PROGRAM.length);
    expect(reads).toBe(first);
  });

  it('joins line numbers in words', () => {
    expect(joinLines([12])).toBe('12');
    expect(joinLines([12, 340])).toBe('12 and 340');
    expect(joinLines([12, 40, 90])).toBe('12, 40 and 90');
  });
});

describe('Select Block Range', () => {
  it('selects the whole lines and says which, with the blocks', async () => {
    fake.answer = { kind: 'block', from: 'N20', to: 'N40' };
    await select.run(context);
    expect(fake.selected).toEqual([{ first: 3, last: 5 }]);
    expect(lastMessage()).toEqual({ text: 'Selected lines 3–5 (blocks N20–N40).', error: false });
    expect(text()).toBe(PROGRAM.join('\n'));
  });

  it('says a single line and a single block in the singular', async () => {
    fake.answer = { kind: 'block', from: '30', to: 'N30' };
    await select.run(context);
    expect(lastMessage().text).toBe('Selected line 4 (block N30).');
    fake.answer = { kind: 'line', from: '2', to: '2' };
    await select.run(context);
    expect(lastMessage().text).toBe('Selected line 2.');
  });

  it('a block that continues is selected whole (Klartext ~)', async () => {
    open(['0 BEGIN PGM T MM', '1 L X+1 ~', '  Y+2', '2 L X+3', '3 END PGM T MM'], KLARTEXT);
    fake.answer = { kind: 'block', from: '1', to: '1' };
    await select.run(context);
    expect(fake.selected).toEqual([{ first: 2, last: 3 }]);
    expect(lastMessage().text).toBe('Selected lines 2–3 (block 1).');
  });

  it('selects nothing and says why when the answer is refused after all (the program changed under the form)', async () => {
    fake.answer = { kind: 'block', from: 'N20', to: 'N99' };
    await select.run(context);
    expect(fake.selected).toEqual([]);
    expect(lastMessage()).toEqual({ text: 'Block N99 is not in the program.', error: true });
  });

  it('does nothing when the form is cancelled, and forgets nothing', async () => {
    fake.remembered['edit.blockRange'] = { kind: 'block' };
    await select.run(context);
    expect(fake.selected).toEqual([]);
    expect(fake.messages).toEqual([]);
    expect(fake.remembered['edit.blockRange']).toEqual({ kind: 'block' });
  });

  it('remembers the kind of the last form in lastParams[\'edit.blockRange\']', async () => {
    fake.answer = { kind: 'block', from: 'N20', to: 'N40' };
    await select.run(context);
    expect(fake.remembered['edit.blockRange']).toEqual({ kind: 'block' });
    fake.answer = { kind: 'line', from: '2', to: '3' };
    await remove.run(context);
    expect(fake.remembered['edit.blockRange']).toEqual({ kind: 'line' });
  });
});

describe('Delete Block Range', () => {
  it('removes the whole lines with their line breaks and puts the cursor where they were', async () => {
    fake.answer = { kind: 'block', from: 'N20', to: 'N40' };
    await remove.run(context);
    expect(text()).toBe(['O1000', 'N10 G90 G54', 'N50 M30', '%'].join('\n'));
    expect(fake.revealed).toEqual([3]);
    expect(lastMessage()).toEqual({ text: 'Deleted 3 lines: lines 3–5 (blocks N20–N40). Undo brings them back.', error: false });
  });

  it('is one undo step, and one undo brings every line back (real Monaco model)', async () => {
    fake.answer = { kind: 'line', from: '2', to: '6' };
    await remove.run(context);
    expect(text()).toBe(['O1000', '%'].join('\n'));
    fake.model.undo();
    expect(text()).toBe(PROGRAM.join('\n'));
    fake.model.redo();
    expect(text()).toBe(['O1000', '%'].join('\n'));
  });

  it('a range of a long program that Monaco splits in several operations is still one undo step', async () => {
    const lines = Array.from({ length: 3000 }, (_, i) => `N${(i + 1) * 10} G1 X${i}`);
    open(lines);
    fake.answer = { kind: 'block', from: 'N100', to: 'N29000' };
    await remove.run(context);
    expect(fake.model.getLineCount()).toBe(3000 - (2900 - 10 + 1));
    fake.model.undo();
    expect(text()).toBe(lines.join('\n'));
  });

  it('can delete the first line, the last line and the whole document', async () => {
    fake.answer = { kind: 'line', from: '1', to: '1' };
    await remove.run(context);
    expect(text()).toBe(PROGRAM.slice(1).join('\n'));
    open(PROGRAM);
    fake.answer = { kind: 'line', from: '6', to: '7' };
    await remove.run(context);
    expect(text()).toBe(PROGRAM.slice(0, 5).join('\n'));
    expect(fake.revealed[fake.revealed.length - 1]).toBe(5);
    open(PROGRAM);
    fake.answer = { kind: 'line', from: '1', to: '7' };
    await remove.run(context);
    expect(text()).toBe('');
    fake.model.undo();
    expect(text()).toBe(PROGRAM.join('\n'));
  });

  it('says one line in the singular', async () => {
    fake.answer = { kind: 'block', from: 'N50', to: 'N50' };
    await remove.run(context);
    expect(lastMessage().text).toBe('Deleted line 6 (block N50). Undo brings it back.');
  });

  it('deletes the lines of a block that continues, never half of it', async () => {
    open(['0 BEGIN PGM T MM', '1 L X+1 ~', '  Y+2 ~', '  Z+3', '2 L X+3', '3 END PGM T MM'], KLARTEXT);
    fake.answer = { kind: 'block', from: '1', to: '1' };
    await remove.run(context);
    expect(text()).toBe(['0 BEGIN PGM T MM', '2 L X+3', '3 END PGM T MM'].join('\n'));
  });

  it('changes nothing when the numbers are refused or the form is cancelled', async () => {
    fake.answer = { kind: 'block', from: 'N20', to: 'N15' };
    await remove.run(context);
    expect(text()).toBe(PROGRAM.join('\n'));
    expect(lastMessage().error).toBe(true);
    fake.answer = { kind: 'line', from: '4', to: '3' };
    await remove.run(context);
    expect(text()).toBe(PROGRAM.join('\n'));
    fake.answer = undefined;
    await remove.run(context);
    expect(text()).toBe(PROGRAM.join('\n'));
  });

  it('is refused in a locked document with the lock named, before the form opens', async () => {
    fake.readOnly = true;
    fake.answer = { kind: 'line', from: '2', to: '3' };
    await remove.run(context);
    expect(fake.specs).toEqual([]);
    expect(text()).toBe(PROGRAM.join('\n'));
    expect(lastMessage().error).toBe(true);
    expect(lastMessage().text).toContain('part.nc');
  });

  it('is refused when the document was locked while the form was open, with the lock named (CODE-11)', async () => {
    fake.answer = { kind: 'line', from: '2', to: '3' };
    fake.whileOpen = () => {
      fake.readOnly = true;
    };
    await remove.run(context);
    expect(fake.specs).toHaveLength(1);
    expect(text()).toBe(PROGRAM.join('\n'));
    expect(lastMessage().error).toBe(true);
    expect(lastMessage().text).toContain('part.nc');
  });

  it('says so and changes nothing when the document was closed while the form was open (CODE-11)', async () => {
    fake.answer = { kind: 'line', from: '2', to: '3' };
    fake.whileOpen = () => {
      fake.gone = true;
    };
    await remove.run(context);
    expect(text()).toBe(PROGRAM.join('\n'));
    expect(lastMessage()).toEqual({ text: t('ranges.noDocument'), error: true });
    // Select Block Range after a closed document selects nothing either.
    fake.gone = false;
    fake.messages = [];
    await select.run(context);
    expect(fake.selected).toEqual([]);
    expect(lastMessage()).toEqual({ text: t('ranges.noDocument'), error: true });
  });
});
