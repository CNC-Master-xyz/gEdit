// What the typing contribution declares and how it drives the editor (plan AD-30, §6 M13
// WP13.4, §7.13).
//
// The editor is a small fake with a text model and a recording of what was asked of it: the
// real Monaco is the runtime harness's business (scenario `m13-typing`). What is pinned here
// is the order of the cheap checks, what each key press asks of the editor (one `type`
// command for the capital, one `executeEdits` when the cursors disagree, nothing for a
// paste-like or modified key), the hint of a refused join, the session switch, and that a
// re-created editor instance is hooked again.
//
// P4c (plan §6.5 rules 1–3, P4.12): auto-space and the automatic block number on Enter, with the
// fake editor and with the editor's own text model (`monaco/realModel.ts`) for the undo step.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import type { CommandDef, RibbonItemDef } from '$lib/app/types';

type Editing = { forceUppercase?: boolean; preventLineJoin?: boolean; autoSpace?: boolean; autoNumber?: boolean };

const fake = vi.hoisted(() => ({
  messages: [] as string[],
  activeId: 'd1' as string | null,
  readOnly: false,
  /** The path of the active document; null is an untitled one. */
  path: null as string | null,
  editing: { forceUppercase: true, preventLineJoin: true } as Editing,
  profileId: 'fanuc-gcode',
  /** Other documents (an aligned compare pane shows one that is not the active one). */
  others: {} as Record<string, { readOnly: boolean; path: string | null; editing?: Editing }>,
  instance: null as unknown,
  listeners: { attach: [] as (() => void)[], focus: [] as ((id: string) => void)[] },
}));

vi.mock('$lib/app/status', () => ({ status: { show: (text: string) => fake.messages.push(text) } }));
vi.mock('$lib/monaco/setup', () => ({
  getMonaco: async () => ({
    editor: { EditorOption: { acceptSuggestionOnEnter: 1 } },
    Selection: class {
      constructor(
        public a: number,
        public b: number,
        public c: number,
        public d: number,
      ) {}
    },
  }),
}));
vi.mock('$lib/monaco/editorService', () => ({
  editor: {
    editorInstance: () => fake.instance,
    onDidAttach: (cb: () => void) => (fake.listeners.attach.push(cb), () => fake.listeners.attach.splice(0)),
    onDidFocusGroup: (cb: (id: string) => void) => (fake.listeners.focus.push(cb), () => fake.listeners.focus.splice(0)),
  },
}));
vi.mock('$lib/stores/documents', () => ({
  docs: {
    getActiveId: () => fake.activeId,
    get: (id: string) =>
      id === fake.activeId ? { id, readOnly: fake.readOnly, path: fake.path } : fake.others[id] ? { id, ...fake.others[id] } : undefined,
  },
}));
vi.mock('$lib/stores/machines', async () => {
  const { BUILTIN_PROFILE_JSON: all } = await import('$lib/data/profiles');
  const { compileProfile: compile } = await import('$lib/core/profiles/compile');
  const cache = new Map<string, CompiledProfile>();
  return {
    machines: {
      effective: (id?: string) => {
        let cp = cache.get(fake.profileId);
        if (!cp) {
          cp = compile(all.find((p) => (p as Profile).id === fake.profileId) as Profile);
          cache.set(fake.profileId, cp);
        }
        const own = id !== undefined ? fake.others[id]?.editing : undefined;
        return { cp, profile: { ...cp.profile, editing: own ?? fake.editing } };
      },
    },
  };
});

const typing = (await import('./typing')).default;
const { handleKey, hookTyping, uppercaseOn, autoSpaceOn, autoNumberOn, resetTypingOverrides, isNcDocument, MAX_TYPING_LINE } = await import(
  './typing'
);
const { hasKey, t } = await import('$lib/i18n');

// -- a fake code editor ---------------------------------------------------------------------

interface Sel {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  positionLineNumber: number;
  positionColumn: number;
}

/** A selection from `[line, column]` pairs; the active end is the end. */
const sel = (start: [number, number], end: [number, number] = start): Sel => ({
  startLineNumber: start[0],
  startColumn: start[1],
  endLineNumber: end[0],
  endColumn: end[1],
  positionLineNumber: end[0],
  positionColumn: end[1],
});

function makeEditor(lines: string[], selections: Sel[]) {
  const calls: { kind: string; args: unknown[] }[] = [];
  let keyDown: ((e: unknown) => void) | undefined;
  const instance = {
    onKeyDown: (cb: (e: unknown) => void) => {
      keyDown = cb;
      return { dispose: () => calls.push({ kind: 'disposeKeyDown', args: [] }) };
    },
    onDidCompositionStart: () => ({ dispose: () => {} }),
    onDidCompositionEnd: () => ({ dispose: () => {} }),
    getModel: () => ({
      getLineContent: (n: number) => lines[n - 1] ?? '',
      getLineLength: (n: number) => (lines[n - 1] ?? '').length,
      getLineCount: () => lines.length,
    }),
    getSelections: () => selections,
    trigger: (...args: unknown[]) => calls.push({ kind: 'trigger', args }),
    executeEdits: (...args: unknown[]) => {
      calls.push({ kind: 'executeEdits', args });
      return true;
    },
  };
  return { instance, calls, press: (e: unknown) => keyDown?.(e) };
}

/** A key event with a log of what was prevented. */
function keyEvent(key: string, rest: Record<string, unknown> = {}) {
  const log: string[] = [];
  return {
    log,
    e: {
      browserEvent: { key, ...rest },
      preventDefault: () => log.push('preventDefault'),
      stopPropagation: () => log.push('stopPropagation'),
    },
  };
}

const compiled = new Map<string, CompiledProfile>();
const cpOf = (id: string): CompiledProfile => {
  let cp = compiled.get(id);
  if (!cp) compiled.set(id, (cp = compileProfile(BUILTIN_PROFILE_JSON.find((p) => (p as Profile).id === id) as Profile)));
  return cp;
};

const deps = (selectionCtor = true) => ({
  activeDocId: () => fake.activeId,
  readOnly: () => fake.readOnly,
  effective: () => ({ cp: cpOf(fake.profileId), editing: fake.editing }),
  uppercaseOn: (id: string) => uppercaseOn(id),
  autoSpaceOn: (id: string) => autoSpaceOn(id),
  autoNumberOn: (id: string) => autoNumberOn(id),
  applies: (id: string) => isNcDocument(id),
  hint: (text: string) => fake.messages.push(text),
  makeSelection: (l: number, c: number) => (selectionCtor ? { l, c } : null),
  enterOption: () => 1,
});

beforeEach(() => {
  fake.messages = [];
  fake.activeId = 'd1';
  fake.readOnly = false;
  fake.path = null;
  fake.editing = { forceUppercase: true, preventLineJoin: true };
  fake.profileId = 'fanuc-gcode';
  fake.others = {};
  fake.instance = null;
  resetTypingOverrides();
});

describe('what the contribution declares', () => {
  const defs: CommandDef[] = typing.commands ?? [];

  it('registers the three switches with no key, in the typing category (§6.5 commands table)', () => {
    expect(defs.map((d) => d.id)).toEqual(['edit.toggleForceUppercase', 'edit.toggleAutoSpace', 'edit.toggleAutoNumber']);
    expect(defs.map((d) => d.title)).toEqual(['typing.toggleForceUppercase', 'typing.toggleAutoSpace', 'typing.toggleAutoNumber']);
    expect(t('typing.toggleAutoSpace')).toBe('Auto Space');
    expect(t('typing.toggleAutoNumber')).toBe('Automatic Block Number');
    for (const def of defs) {
      expect(def.keys, def.id).toBeUndefined();
      expect(def.category, def.id).toBe('typing.category');
      expect(hasKey(def.title)).toBe(true);
      expect(hasKey(def.category as string)).toBe(true);
      expect(def.icon, def.id).toBeDefined();
      expect(def.enabled?.({ activeDocId: null } as never)).toBe(false);
      expect(def.enabled?.({ activeDocId: 'd1' } as never)).toBe(true);
    }
  });

  it('puts the switches on the Edit tab, group typing.group, orders 150, 151 and 152', () => {
    const items = (typing.ribbon ?? []) as RibbonItemDef[];
    expect(items).toEqual([
      { tab: 'edit', group: 'typing.group', command: 'edit.toggleForceUppercase', order: 150 },
      { tab: 'edit', group: 'typing.group', command: 'edit.toggleAutoSpace', order: 151 },
      { tab: 'edit', group: 'typing.group', command: 'edit.toggleAutoNumber', order: 152 },
    ]);
    expect(hasKey('typing.group')).toBe(true);
  });

  it('has every message it says', () => {
    for (const key of ['spaceOn', 'spaceOff', 'numberOn', 'numberOff', 'numberNoGap', 'numberOverflow', 'numberTooMany', 'numberInPane', 'notHere']) {
      expect(hasKey(`typing.${key}`), key).toBe(true);
    }
  });
});

describe('the session switch', () => {
  const run = (): void => void defs()[0].run({ activeDocId: 'd1' } as never);
  const defs = (): CommandDef[] => typing.commands as CommandDef[];

  it('follows the profile until it is used', () => {
    expect(uppercaseOn('d1')).toBe(true);
    fake.editing = { forceUppercase: false };
    expect(uppercaseOn('d1')).toBe(false);
    fake.editing = {};
    expect(uppercaseOn('d1')).toBe(false);
  });

  it('turns it off for every document, says so, and turns it on again', () => {
    run();
    expect(uppercaseOn('d1')).toBe(false);
    expect(uppercaseOn('d2')).toBe(false);
    expect(fake.messages.at(-1)).toBe(t('typing.upperOff'));
    run();
    expect(uppercaseOn('d1')).toBe(true);
    expect(fake.messages.at(-1)).toBe(t('typing.upperOn'));
  });

  it('turns it on over a profile that does not ask for it', () => {
    fake.editing = { forceUppercase: false };
    run();
    expect(uppercaseOn('d1')).toBe(true);
  });

  it('does nothing without a document', () => {
    void defs()[0].run({ activeDocId: null } as never);
    expect(fake.messages).toEqual([]);
  });
});

describe('a letter key', () => {
  it('asks for one capital through the editor, once, and prevents the lower-case default', () => {
    const { instance, calls } = makeEditor(['G1 '], [sel([1, 4])]);
    const { e, log } = keyEvent('x');
    expect(handleKey(instance as never, e as never, false, deps())).toBe(true);
    expect(calls).toEqual([{ kind: 'trigger', args: ['keyboard', 'type', { text: 'X' }] }]);
    expect(log).toEqual(['preventDefault', 'stopPropagation']);
  });

  it.each([
    ['in a comment', ['G1 (note '], [sel([1, 10])]],
    ['in a Fanuc comment opened earlier on the line, cursor before the closing parenthesis', ['G1 (note )'], [sel([1, 10])]],
  ])('leaves the key alone %s', (_name, lines, selections) => {
    const { instance, calls } = makeEditor(lines, selections);
    const { e, log } = keyEvent('x');
    expect(handleKey(instance as never, e as never, false, deps())).toBe(false);
    expect(calls).toEqual([]);
    expect(log).toEqual([]);
  });

  it('leaves the key alone in a Sinumerik string, a Klartext name and an Okuma comment', () => {
    for (const [profileId, line, col] of [
      ['sinumerik', 'MSG("check ', 12],
      ['sinumerik', 'T="drill ', 10],
      ['heidenhain-klartext', '0 BEGIN PGM part MM', 17],
      ['okuma-osp', 'G1 X1 (check ', 14],
    ] as const) {
      fake.profileId = profileId;
      const { instance, calls } = makeEditor([line], [sel([1, col])]);
      expect(handleKey(instance as never, keyEvent('x').e as never, false, deps()), line).toBe(false);
      expect(calls, line).toEqual([]);
    }
  });

  it('leaves the key alone when the option is off for the profile and capitalises when the session turns it on', () => {
    fake.editing = { forceUppercase: false };
    const off = makeEditor(['G1 '], [sel([1, 4])]);
    expect(handleKey(off.instance as never, keyEvent('x').e as never, false, deps())).toBe(false);
    typing.commands?.[0].run({ activeDocId: 'd1' } as never);
    const on = makeEditor(['G1 '], [sel([1, 4])]);
    expect(handleKey(on.instance as never, keyEvent('x').e as never, false, deps())).toBe(true);
  });

  it.each([
    ['Cmd+X', 'x', { metaKey: true }],
    ['Ctrl+C', 'c', { ctrlKey: true }],
    ['Alt+letter', 'm', { altKey: true }],
    ['a key for the IME', 'a', { keyCode: 229 }],
    ['a composing key', 'a', { isComposing: true }],
    ['a digit', '5', {}],
    ['an upper-case letter', 'G', {}],
    ['Enter', 'Enter', {}],
  ])('leaves %s to the editor', (_name, key, rest) => {
    const { instance, calls } = makeEditor(['G1 '], [sel([1, 4])]);
    expect(handleKey(instance as never, keyEvent(key, rest).e as never, false, deps())).toBe(false);
    expect(calls).toEqual([]);
  });

  it('leaves every key to the editor while the editor reports a composition', () => {
    const { instance, calls } = makeEditor(['G1 '], [sel([1, 4])]);
    expect(handleKey(instance as never, keyEvent('x').e as never, true, deps())).toBe(false);
    expect(calls).toEqual([]);
  });

  it('does not touch a read-only document or a missing one', () => {
    const { instance, calls } = makeEditor(['G1 '], [sel([1, 4])]);
    fake.readOnly = true;
    expect(handleKey(instance as never, keyEvent('x').e as never, false, deps())).toBe(false);
    fake.readOnly = false;
    fake.activeId = null;
    expect(handleKey(instance as never, keyEvent('x').e as never, false, deps())).toBe(false);
    expect(calls).toEqual([]);
  });

  it('reads the selection as replaced: a selected comment tail is typed over', () => {
    // `G1 (note)`: columns 5-9 (`note`) selected, the letter replaces them inside the comment.
    const { instance, calls } = makeEditor(['G1 (note)'], [sel([1, 5], [1, 9])]);
    expect(handleKey(instance as never, keyEvent('x').e as never, false, deps())).toBe(false);
    expect(calls).toEqual([]);
  });

  it('reads a selection that spans a line break from the first line head and the last line tail', () => {
    // From inside a comment on line 1 to the code on line 2: the merged line is a comment.
    const { instance, calls } = makeEditor(['G1 (open', 'X5)'], [sel([1, 9], [2, 1])]);
    expect(handleKey(instance as never, keyEvent('x').e as never, false, deps())).toBe(false);
    expect(calls).toEqual([]);
    // From code on line 1 to a comment's tail on line 2.
    const two = makeEditor(['G1 X1', 'note) Z5'], [sel([1, 6], [2, 6])]);
    expect(handleKey(two.instance as never, keyEvent('x').e as never, false, deps())).toBe(true);
    expect(two.calls[0]).toEqual({ kind: 'trigger', args: ['keyboard', 'type', { text: 'X' }] });
  });

  it('types one capital for every cursor when all are in code', () => {
    const { instance, calls } = makeEditor(['G1 ', 'G2 '], [sel([1, 4]), sel([2, 4])]);
    expect(handleKey(instance as never, keyEvent('x').e as never, false, deps())).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('trigger');
  });

  it('edits each cursor with its own text when the cursors disagree, and puts the cursors after it', () => {
    const { instance, calls } = makeEditor(['G1 ', '(note '], [sel([1, 4]), sel([2, 7])]);
    const { e, log } = keyEvent('x');
    expect(handleKey(instance as never, e as never, false, deps())).toBe(true);
    expect(log).toEqual(['preventDefault', 'stopPropagation']);
    expect(calls).toHaveLength(1);
    const [source, edits, cursorState] = calls[0].args as [
      string,
      { range: Sel; text: string }[],
      (inverse: { range: { endLineNumber: number; endColumn: number } }[]) => unknown[],
    ];
    expect(source).toBe('keyboard');
    expect(edits.map((edit) => edit.text)).toEqual(['X', 'x']);
    expect(cursorState([{ range: { endLineNumber: 1, endColumn: 5 } }, { range: { endLineNumber: 2, endColumn: 8 } }])).toEqual([
      { l: 1, c: 5 },
      { l: 2, c: 8 },
    ]);
  });

  it('lets the key through when the cursors disagree and Monaco has not been loaded for its Selection', () => {
    const { instance, calls } = makeEditor(['G1 ', '(note '], [sel([1, 4]), sel([2, 7])]);
    expect(handleKey(instance as never, keyEvent('x').e as never, false, deps(false))).toBe(false);
    expect(calls).toEqual([]);
  });

  it('leaves a monstrous line as typed instead of tokenizing it on every key', () => {
    const line = `G1 ${'X'.repeat(MAX_TYPING_LINE)}`;
    const { instance, calls } = makeEditor([line], [sel([1, 4])]);
    expect(handleKey(instance as never, keyEvent('x').e as never, false, deps())).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('Backspace and Delete', () => {
  const lines = ['N10 G1 X1', 'N20 G2 X2', 'N30 G3 X3'];

  it('swallows Backspace in column 1 and says why', () => {
    const { instance, calls } = makeEditor(lines, [sel([2, 1])]);
    const { e, log } = keyEvent('Backspace');
    expect(handleKey(instance as never, e as never, false, deps())).toBe(true);
    expect(log).toEqual(['preventDefault', 'stopPropagation']);
    expect(calls).toEqual([]);
    expect(fake.messages).toEqual([t('typing.noJoin')]);
  });

  it('removes an empty or blank line with Backspace and Delete, but not the join of two text lines', () => {
    const blankLines = ['N10 G1 X1', '', '   ', 'N20 G2 X2'];
    for (const [key, selection] of [
      ['Backspace', sel([2, 1])], // empty line, text above
      ['Backspace', sel([3, 1])], // blank line
      ['Backspace', sel([4, 1])], // text under a blank line
      ['Delete', sel([1, 10])], // text above an empty line
      ['Delete', sel([2, 1])], // empty line
      ['Delete', sel([3, 4])], // blank line, text below
    ] as const) {
      const { instance } = makeEditor(blankLines, [selection]);
      const { e, log } = keyEvent(key);
      expect(handleKey(instance as never, e as never, false, deps()), `${key} ${selection.positionLineNumber}`).toBe(false);
      expect(log).toEqual([]);
    }
    expect(fake.messages).toEqual([]);
    // A document that ends with an empty line: Delete at the end of the last text line.
    const tail = makeEditor(['N10 G1', ''], [sel([1, 7])]);
    expect(handleKey(tail.instance as never, keyEvent('Delete').e as never, false, deps())).toBe(false);
    // The two text lines still join nowhere.
    const text = makeEditor(['N10 G1', 'N20 G2'], [sel([2, 1])]);
    expect(handleKey(text.instance as never, keyEvent('Backspace').e as never, false, deps())).toBe(true);
  });

  it('swallows Delete at the end of a line', () => {
    const { instance } = makeEditor(lines, [sel([2, 10])]);
    expect(handleKey(instance as never, keyEvent('Delete').e as never, false, deps())).toBe(true);
    expect(fake.messages).toEqual([t('typing.noJoin')]);
  });

  it.each([
    ['Backspace inside a line', 'Backspace', sel([2, 5])],
    ['Backspace at the very start of the document', 'Backspace', sel([1, 1])],
    ['Delete inside a line', 'Delete', sel([2, 5])],
    ['Delete at the very end of the document', 'Delete', sel([3, 10])],
    ['Backspace over a selection that starts in column 1', 'Backspace', sel([2, 1], [2, 4])],
    ['Delete over a selection that spans a line break', 'Delete', sel([1, 5], [2, 5])],
    ['Backspace over a selected line break', 'Backspace', sel([1, 10], [2, 1])],
  ])('lets %s through', (_name, key, selection) => {
    const { instance } = makeEditor(lines, [selection]);
    const { e, log } = keyEvent(key);
    expect(handleKey(instance as never, e as never, false, deps())).toBe(false);
    expect(log).toEqual([]);
    expect(fake.messages).toEqual([]);
  });

  // M13 review CODE-12 (owner, 2026-10-09): a word or line deletion in column 1 joins too.
  it('refuses the word and line deletions (Ctrl, Alt, Cmd) that would join two blocks', () => {
    const { instance } = makeEditor(lines, [sel([2, 1])]);
    for (const rest of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      expect(handleKey(instance as never, keyEvent('Backspace', rest).e as never, false, deps())).toBe(true);
    }
  });

  it('does nothing when the profile does not ask for it, and not in a read-only document', () => {
    const { instance } = makeEditor(lines, [sel([2, 1])]);
    fake.editing = { forceUppercase: true, preventLineJoin: false };
    expect(handleKey(instance as never, keyEvent('Backspace').e as never, false, deps())).toBe(false);
    fake.editing = { preventLineJoin: true };
    fake.readOnly = true;
    expect(handleKey(instance as never, keyEvent('Backspace').e as never, false, deps())).toBe(false);
  });

  it('is not turned off by the upper-case session switch', () => {
    typing.commands?.[0].run({ activeDocId: 'd1' } as never);
    expect(uppercaseOn('d1')).toBe(false);
    const { instance } = makeEditor(lines, [sel([2, 1])]);
    expect(handleKey(instance as never, keyEvent('Backspace').e as never, false, deps())).toBe(true);
  });

  it('refuses the key press when one of several cursors would join two text lines', () => {
    const { instance } = makeEditor(lines, [sel([1, 3]), sel([3, 1])]);
    expect(handleKey(instance as never, keyEvent('Backspace').e as never, false, deps())).toBe(true);
  });

  it('lets the key press through when the only cursor at a join is on an empty line', () => {
    const { instance } = makeEditor(['N10 G1', '', 'N30 G3'], [sel([1, 3]), sel([2, 1])]);
    expect(handleKey(instance as never, keyEvent('Backspace').e as never, false, deps())).toBe(false);
  });
});

describe('hooking the editor', () => {
  it('hooks an instance once, hooks a new one after the compare overlay re-creates it, and lets go on dispose', async () => {
    const first = makeEditor(['G1 '], [sel([1, 4])]);
    fake.instance = first.instance;
    const disposable = await typing.activate?.();
    // An attach that built the same instance again costs one comparison.
    for (const cb of fake.listeners.attach) cb();
    first.press(keyEvent('x').e);
    expect(first.calls.filter((c) => c.kind === 'trigger')).toHaveLength(1);

    const second = makeEditor(['G1 '], [sel([1, 4])]);
    fake.instance = second.instance;
    for (const cb of fake.listeners.attach) cb();
    second.press(keyEvent('x').e);
    expect(second.calls.filter((c) => c.kind === 'trigger')).toHaveLength(1);
    expect(first.calls.some((c) => c.kind === 'disposeKeyDown')).toBe(true);

    (disposable as () => void)();
    expect(second.calls.some((c) => c.kind === 'disposeKeyDown')).toBe(true);
    expect(fake.listeners.attach).toHaveLength(0);
    expect(fake.listeners.focus).toHaveLength(0);
  });

  it('follows the focused group in split view: the editor that gets the focus is the one that is hooked (§6.7 rule 3)', async () => {
    const left = makeEditor(['G1 '], [sel([1, 4])]);
    const right = makeEditor(['G1 '], [sel([1, 4])]);
    fake.instance = left.instance;
    const disposable = await typing.activate?.();
    left.press(keyEvent('x').e);
    expect(left.calls.filter((c) => c.kind === 'trigger')).toHaveLength(1);

    // The second group takes the focus: `editorInstance()` answers it from now on.
    fake.instance = right.instance;
    for (const cb of fake.listeners.focus) cb('g2');
    right.press(keyEvent('x').e);
    expect(right.calls.filter((c) => c.kind === 'trigger')).toHaveLength(1);
    expect(left.calls.some((c) => c.kind === 'disposeKeyDown')).toBe(true);

    // And back: a hook per focus change, never two on one editor.
    fake.instance = left.instance;
    for (const cb of fake.listeners.focus) cb('g1');
    left.press(keyEvent('x').e);
    expect(left.calls.filter((c) => c.kind === 'trigger')).toHaveLength(2);
    (disposable as () => void)();
  });
});

describe('a pane of the aligned compare view (P4e FT)', () => {
  // The active document is the compared one; the pane shows another (or the same) document and the
  // keys follow the document the pane names, with its own settings.
  const pane = (docId: string | null, lines = ['G1 '], selections = [sel([1, 4])]) => {
    const made = makeEditor(lines, selections);
    const hooked = hookTyping(made.instance as never, () => docId);
    return { ...made, hooked };
  };
  const triggers = (calls: { kind: string }[]) => calls.filter((c) => c.kind === 'trigger');

  it('types g1x10 as G1X10: each letter becomes a capital, the digits stay the editor\'s', () => {
    fake.others.p1 = { readOnly: false, path: null };
    const { calls, press } = pane('p1');
    for (const key of ['g', '1', 'x', '1', '0']) press(keyEvent(key).e);
    expect(calls.filter((c) => c.kind === 'trigger').map((c) => (c.args[2] as { text: string }).text)).toEqual(['G', 'X']);
  });

  it('follows the pane\'s own document, not the active one', () => {
    fake.editing = { forceUppercase: false, preventLineJoin: true }; // the active document: off
    fake.others.p1 = { readOnly: false, path: null, editing: { forceUppercase: true } };
    fake.others.p2 = { readOnly: false, path: null, editing: { forceUppercase: false } };
    const on = pane('p1');
    on.press(keyEvent('x').e);
    expect(triggers(on.calls)).toHaveLength(1);
    const off = pane('p2');
    fake.editing = { forceUppercase: true, preventLineJoin: true }; // now the active one is on
    off.press(keyEvent('x').e);
    expect(triggers(off.calls)).toEqual([]);
  });

  it('follows the session switch like the main editor', () => {
    fake.others.p2 = { readOnly: false, path: null, editing: { forceUppercase: false } };
    const { calls, press } = pane('p2');
    press(keyEvent('x').e);
    expect(triggers(calls)).toEqual([]);
    void typing.commands?.find((c) => c.id === 'edit.toggleForceUppercase')?.run({ activeDocId: 'p2' } as never);
    press(keyEvent('x').e);
    expect(triggers(calls)).toHaveLength(1);
  });

  it('leaves a locked document, a document that is not an NC program and a pane without a document alone', () => {
    fake.others.ro = { readOnly: true, path: null };
    fake.others.js = { readOnly: false, path: '/profiles/mine.json' };
    for (const id of ['ro', 'js', null]) {
      const { calls, press } = pane(id);
      press(keyEvent('x').e);
      press(keyEvent('Backspace').e);
      expect(calls.filter((c) => c.kind !== 'disposeKeyDown')).toEqual([]);
    }
  });

  it('keeps two blocks apart in the pane: Backspace in column 1 says why, with the pane\'s own setting', () => {
    fake.others.p1 = { readOnly: false, path: null };
    fake.others.p2 = { readOnly: false, path: null, editing: { preventLineJoin: false } };
    const lines = ['N10 G1 X1', 'N20 G2 X2'];
    const guarded = pane('p1', lines, [sel([2, 1])]);
    const { e, log } = keyEvent('Backspace');
    guarded.press(e);
    expect(log).toEqual(['preventDefault', 'stopPropagation']);
    expect(fake.messages).toEqual([t('typing.noJoin')]);
    const free = pane('p2', lines, [sel([2, 1])]);
    const second = keyEvent('Backspace');
    free.press(second.e);
    expect(second.log).toEqual([]);
  });

  it('is a hook of its own: the main editor\'s hook is not involved, and dispose leaves no listener', () => {
    fake.others.p1 = { readOnly: false, path: null };
    const { instance, calls, press, hooked } = (() => {
      const made = makeEditor(['G1 '], [sel([1, 4])]);
      const starts: unknown[] = [];
      const ends: unknown[] = [];
      let down = 0;
      const wrapped = {
        ...made.instance,
        onKeyDown: (cb: (e: unknown) => void) => {
          down++;
          const inner = made.instance.onKeyDown(cb);
          return { dispose: () => (down--, inner.dispose()) };
        },
        onDidCompositionStart: () => (starts.push(1), { dispose: () => void starts.pop() }),
        onDidCompositionEnd: () => (ends.push(1), { dispose: () => void ends.pop() }),
      };
      const h = hookTyping(wrapped as never, () => 'p1');
      return { instance: { down: () => down, open: () => starts.length + ends.length }, calls: made.calls, press: made.press, hooked: h };
    })();
    expect(instance.down()).toBe(1);
    expect(instance.open()).toBe(2);
    hooked.dispose();
    expect(instance.down()).toBe(0);
    expect(instance.open()).toBe(0);
    expect(calls.some((c) => c.kind === 'disposeKeyDown')).toBe(true);
    hooked.dispose();
    expect(instance.down()).toBe(0);
    void press;
  });
});

describe('only NC programs (CODE-3)', () => {
  const json = ['"extends": "fanuc-gcode"', '"id": "my-lathe"'];

  it.each([
    ['a profile file', '/cfg/profiles/a.json'],
    ['the machines file', 'C:\\Users\\me\\AppData\\machines.json'],
    ['a script', '/home/me/scripts/my_script.py'],
    ['an upper-case extension', '/cfg/codes/FANUC.JSON'],
  ])('leaves a letter typed in %s alone, with the profile flag and the session switch on', (_name, path) => {
    fake.path = path;
    typing.commands?.[0].run({ activeDocId: 'd1' } as never); // off for the session ...
    typing.commands?.[0].run({ activeDocId: 'd1' } as never); // ... and on again
    const { instance, calls } = makeEditor(['"id": "my-lath'], [sel([1, 15])]);
    const { e, log } = keyEvent('e');
    expect(handleKey(instance as never, e as never, false, deps())).toBe(false);
    expect(calls).toEqual([]);
    expect(log).toEqual([]);
    expect(uppercaseOn('d1')).toBe(false);
  });

  it('leaves Backspace at column 1 and Delete at the end of a line alone in a JSON document', () => {
    fake.path = '/cfg/profiles/a.json';
    const { instance } = makeEditor(json, [sel([2, 1])]);
    const back = keyEvent('Backspace');
    expect(handleKey(instance as never, back.e as never, false, deps())).toBe(false);
    expect(back.log).toEqual([]);
    const forward = makeEditor(json, [sel([1, json[0].length + 1])]);
    const del = keyEvent('Delete');
    expect(handleKey(forward.instance as never, del.e as never, false, deps())).toBe(false);
    expect(del.log).toEqual([]);
    expect(fake.messages).toEqual([]);
  });

  it.each([
    ['an untitled document', null],
    ['a program number as the name', '/work/O0017'],
    ['a text file', '/work/a.txt'],
    ['a tape', '/work/part.tap'],
    ['a name with no extension', 'C:\\work\\PART1'],
    ['a name that only contains json', '/work/json.nc'],
  ])('still upper-cases and still refuses a join in %s', (_name, path) => {
    fake.path = path;
    const type = makeEditor(['G1 '], [sel([1, 4])]);
    expect(handleKey(type.instance as never, keyEvent('x').e as never, false, deps())).toBe(true);
    const join = makeEditor(['N10 G1', 'N20 G2'], [sel([2, 1])]);
    expect(handleKey(join.instance as never, keyEvent('Backspace').e as never, false, deps())).toBe(true);
  });

  it('says the switch is not for this document instead of changing the session', () => {
    fake.path = '/cfg/profiles/a.json';
    typing.commands?.[0].run({ activeDocId: 'd1' } as never);
    expect(fake.messages.at(-1)).toBe(t('typing.notHere'));
    fake.path = null;
    expect(uppercaseOn('d1')).toBe(true);
    expect(typing.commands?.[0].enabled?.({ activeDocId: 'd1' } as never)).toBe(true);
    fake.path = '/cfg/profiles/a.json';
    expect(typing.commands?.[0].enabled?.({ activeDocId: 'd1' } as never)).toBe(false);
  });
});

describe('what a key press reads (CODE-7)', () => {
  /** A model whose text of the long line cannot be read: only its length can be asked for. */
  function longLineEditor(selections: Sel[], lines: string[], longAt: number) {
    const reads: number[] = [];
    const instance = {
      onKeyDown: () => ({ dispose: () => {} }),
      getModel: () => ({
        getLineContent: (n: number) => {
          reads.push(n);
          if (n === longAt) throw new Error(`line ${n} was read`);
          return lines[n - 1] ?? '';
        },
        getLineLength: (n: number) => (n === longAt ? 5_000_000 : (lines[n - 1] ?? '').length),
        getLineCount: () => lines.length,
      }),
      getSelections: () => selections,
      trigger: () => {},
      executeEdits: () => true,
    };
    return { instance, reads };
  }

  it('does not read the text of a line that is too long for a letter key, nor the one above it', () => {
    const lines = ['G1 X1', 'N10 G1 X'];
    const above = longLineEditor([sel([2, 9])], lines, 1);
    expect(handleKey(above.instance as never, keyEvent('x').e as never, false, deps())).toBe(false);
    expect(above.reads).toEqual([]);
    const own = longLineEditor([sel([1, 3])], lines, 1);
    expect(handleKey(own.instance as never, keyEvent('x').e as never, false, deps())).toBe(false);
    expect(own.reads).toEqual([]);
  });

  it('answers Backspace in the middle of a line, and Delete away from its end, from the lengths alone', () => {
    const lines = ['N10 G1 X1', 'N20 G2 X2', 'N30 G3 X3'];
    for (const [key, selection] of [
      ['Backspace', sel([2, 5])],
      ['Backspace', sel([2, 1], [2, 4])],
      ['Delete', sel([2, 5])],
      ['Delete', sel([2, 1], [2, 4])],
    ] as const) {
      const { instance, reads } = longLineEditor([selection], lines, 3);
      expect(handleKey(instance as never, keyEvent(key).e as never, false, deps()), key).toBe(false);
      expect(reads, key).toEqual([]);
    }
  });

  it('reads the neighbour only at the edge, and treats a very long line as text without reading it', () => {
    const lines = ['N10 G1 X1', 'N20 G2 X2', 'N30 G3 X3'];
    // Delete at the end of line 2 reads lines 2 and 3 (line 3 is the long one: it counts as text).
    const { instance, reads } = longLineEditor([sel([2, 10])], lines, 3);
    const { e } = keyEvent('Delete');
    expect(handleKey(instance as never, e as never, false, deps())).toBe(true);
    expect(reads).toEqual([2]);
  });
});

// -- P4c: auto-space and the automatic block number (plan §6.5 rules 1–3, P4.12) ------------

const { realModel } = await import('$lib/monaco/realModel');
const { readFileSync } = await import('node:fs');
const klartextPlate = (): string[] =>
  readFileSync(new URL('../../../tests/fixtures/p4c/typing/klartext-plate.h', import.meta.url), 'utf8').replace(/\n$/, '').split('\n');

/** The run of one toggle command by id. */
const runCommand = (id: string, docId: string | null = 'd1'): void =>
  void (typing.commands as CommandDef[]).find((c) => c.id === id)?.run({ activeDocId: docId } as never);

/** The fake editor with the calls it records, plus the undo stops and a context key service. */
function enterEditor(
  lines: string[],
  selections: Sel[],
  extra: { suggest?: boolean; pane?: boolean; accept?: 'on' | 'smart' | 'off'; noService?: boolean; throwing?: boolean } = {},
) {
  const made = makeEditor(lines, selections);
  const model = made.instance.getModel();
  const service = {
    getContextKeyValue: (key: string) => {
      if (extra.throwing) throw new Error('disposed');
      return key === 'suggestWidgetVisible' ? extra.suggest === true : undefined;
    },
  };
  const instance = {
    ...made.instance,
    getModel: () => ({ ...model, uri: extra.pane ? { scheme: 'inmemory', authority: 'pane' } : { scheme: 'inmemory', authority: 'doc' } }),
    pushUndoStop: () => (made.calls.push({ kind: 'pushUndoStop', args: [] }), true),
    // The public option and the public context key service, as a real editor has them (the app's own default is 'off').
    getOption: (id: number) => (id === 1 ? (extra.accept ?? 'off') : undefined),
    contextKeyService: extra.noService ? undefined : service,
    // The private name an earlier version of the hook read, so a hook that ignores the option still sees the open list.
    _contextKeyService: extra.noService ? undefined : service,
  };
  return { instance, calls: made.calls };
}

describe('the auto-space and auto-number switches', () => {
  it('follow the profile until used, each on its own, absent is off', () => {
    fake.editing = {};
    expect([autoSpaceOn('d1'), autoNumberOn('d1')]).toEqual([false, false]);
    fake.editing = { autoSpace: true };
    expect([autoSpaceOn('d1'), autoNumberOn('d1')]).toEqual([true, false]);
    fake.editing = { autoNumber: true };
    expect([autoSpaceOn('d1'), autoNumberOn('d1')]).toEqual([false, true]);
  });

  it('turn on over the profile for every document, say so, and turn off again', () => {
    fake.editing = {};
    runCommand('edit.toggleAutoSpace');
    expect(autoSpaceOn('d1')).toBe(true);
    expect(fake.messages.at(-1)).toBe(t('typing.spaceOn'));
    fake.others.d2 = { readOnly: false, path: null, editing: {} };
    expect(autoSpaceOn('d2')).toBe(true);
    runCommand('edit.toggleAutoSpace');
    expect(autoSpaceOn('d1')).toBe(false);
    expect(fake.messages.at(-1)).toBe(t('typing.spaceOff'));

    runCommand('edit.toggleAutoNumber');
    expect(autoNumberOn('d1')).toBe(true);
    expect(fake.messages.at(-1)).toBe(t('typing.numberOn'));
    runCommand('edit.toggleAutoNumber');
    expect(autoNumberOn('d1')).toBe(false);
    expect(fake.messages.at(-1)).toBe(t('typing.numberOff'));
  });

  it('do not touch one another, nor upper case', () => {
    fake.editing = { forceUppercase: true };
    runCommand('edit.toggleAutoSpace');
    expect([uppercaseOn('d1'), autoSpaceOn('d1'), autoNumberOn('d1')]).toEqual([true, true, false]);
    runCommand('edit.toggleForceUppercase');
    expect([uppercaseOn('d1'), autoSpaceOn('d1'), autoNumberOn('d1')]).toEqual([false, true, false]);
  });

  it('say they are not for a .json or .py document and change nothing', () => {
    fake.path = '/cfg/profiles/a.json';
    fake.editing = { autoSpace: true, autoNumber: true };
    runCommand('edit.toggleAutoSpace');
    expect(fake.messages.at(-1)).toBe(t('typing.notHere'));
    runCommand('edit.toggleAutoNumber');
    expect(fake.messages.at(-1)).toBe(t('typing.notHere'));
    expect([autoSpaceOn('d1'), autoNumberOn('d1')]).toEqual([false, false]);
    fake.path = null;
    expect([autoSpaceOn('d1'), autoNumberOn('d1')]).toEqual([true, true]);
  });

  it('do nothing without a document', () => {
    runCommand('edit.toggleAutoSpace', null);
    runCommand('edit.toggleAutoNumber', null);
    expect(fake.messages).toEqual([]);
  });
});

describe('auto-space on a letter key (rule 1)', () => {
  it('types the space and the capital as one type command: G1 + x gives G1 X', () => {
    fake.editing = { forceUppercase: true, autoSpace: true };
    const { instance, calls } = makeEditor(['G1'], [sel([1, 3])]);
    const { e, log } = keyEvent('x');
    expect(handleKey(instance as never, e as never, false, deps())).toBe(true);
    expect(calls).toEqual([{ kind: 'trigger', args: ['keyboard', 'type', { text: ' X' }] }]);
    expect(log).toEqual(['preventDefault', 'stopPropagation']);
  });

  it('closes the suggestion session before a space and a letter go in as one change, and not before a single character', () => {
    // Monaco 0.55 refilters an open session for a change that starts a new word and meets a dropped completion model.
    fake.editing = { forceUppercase: true, autoSpace: true };
    const order: string[] = [];
    const { instance, calls } = makeEditor(['G1'], [sel([1, 3])]);
    const wired = {
      ...instance,
      getContribution: (id: string) => (id === 'editor.contrib.suggestController' ? { cancelSuggestWidget: () => order.push('cancel') } : null),
      trigger: (...args: unknown[]) => {
        order.push(`type:${(args[2] as { text: string }).text}`);
        instance.trigger(...args);
      },
    };
    expect(handleKey(wired as never, keyEvent('x').e as never, false, deps())).toBe(true);
    expect(order).toEqual(['cancel', 'type: X']);
    expect(calls).toHaveLength(1);

    // A letter that needs no space is one character: the session is the editor's own business.
    order.length = 0;
    const single = makeEditor(['G1 '], [sel([1, 4])]);
    const wiredSingle = { ...single.instance, getContribution: wired.getContribution, trigger: wired.trigger };
    expect(handleKey(wiredSingle as never, keyEvent('x').e as never, false, deps())).toBe(true);
    expect(order).toEqual(['type:X']);
  });

  it('a suggest controller that throws does not stop the key', () => {
    fake.editing = { forceUppercase: true, autoSpace: true };
    const { instance, calls } = makeEditor(['G1'], [sel([1, 3])]);
    const wired = { ...instance, getContribution: () => { throw new Error('gone'); } };
    expect(handleKey(wired as never, keyEvent('x').e as never, false, deps())).toBe(true);
    expect(calls).toEqual([{ kind: 'trigger', args: ['keyboard', 'type', { text: ' X' }] }]);
  });

  it('with upper case off types the space and the letter as typed, also an upper-case key', () => {
    fake.editing = { autoSpace: true };
    const lower = makeEditor(['g1'], [sel([1, 3])]);
    expect(handleKey(lower.instance as never, keyEvent('x').e as never, false, deps())).toBe(true);
    expect(lower.calls).toEqual([{ kind: 'trigger', args: ['keyboard', 'type', { text: ' x' }] }]);
    const upper = makeEditor(['G1'], [sel([1, 3])]);
    expect(handleKey(upper.instance as never, keyEvent('X', { shiftKey: true }).e as never, false, deps())).toBe(true);
    expect(upper.calls).toEqual([{ kind: 'trigger', args: ['keyboard', 'type', { text: ' X' }] }]);
  });

  it('leaves an upper-case key alone when only upper-case typing is on, without reading a line', () => {
    fake.editing = { forceUppercase: true };
    const { instance, calls } = makeEditor(['G1'], [sel([1, 3])]);
    let reads = 0;
    const model = instance.getModel();
    const counted = { ...instance, getModel: () => ({ ...model, getLineContent: (n: number) => (reads++, model.getLineContent(n)) }) };
    expect(handleKey(counted as never, keyEvent('X', { shiftKey: true }).e as never, false, deps())).toBe(false);
    expect(calls).toEqual([]);
    expect(reads).toBe(0);
  });

  it('adds no space in a comment, after a blank, or inside a keyword, and leaves the key to the editor with upper case off', () => {
    fake.editing = { autoSpace: true };
    for (const [line, col, key] of [
      ['G1 (cut', 8, 'x'],
      ['G1 ', 4, 'x'],
      ['GO', 3, 't'],
    ] as const) {
      const { instance, calls } = makeEditor([line], [sel([1, col])]);
      expect(handleKey(instance as never, keyEvent(key).e as never, false, deps()), line).toBe(false);
      expect(calls, line).toEqual([]);
    }
  });

  it('Klartext: X+10 then y gives X+10 Y', () => {
    fake.profileId = 'heidenhain-klartext';
    fake.editing = { forceUppercase: true, autoSpace: true };
    const { instance, calls } = makeEditor(['5 L X+10'], [sel([1, 9])]);
    expect(handleKey(instance as never, keyEvent('y').e as never, false, deps())).toBe(true);
    expect(calls).toEqual([{ kind: 'trigger', args: ['keyboard', 'type', { text: ' Y' }] }]);
  });

  it('decides each cursor on its own: one executeEdits with each cursor’s text', () => {
    fake.editing = { forceUppercase: true, autoSpace: true };
    const { instance, calls } = makeEditor(['G1', 'G1 ', '(note '], [sel([1, 3]), sel([2, 4]), sel([3, 7])]);
    expect(handleKey(instance as never, keyEvent('x').e as never, false, deps())).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('executeEdits');
    const [, edits] = calls[0].args as [string, { text: string }[]];
    expect(edits.map((edit) => edit.text)).toEqual([' X', 'X', 'x']);
  });

  it('does nothing with both options off, in a read-only document, or for a chord', () => {
    fake.editing = {};
    const off = makeEditor(['G1'], [sel([1, 3])]);
    expect(handleKey(off.instance as never, keyEvent('x').e as never, false, deps())).toBe(false);
    fake.editing = { autoSpace: true };
    fake.readOnly = true;
    expect(handleKey(off.instance as never, keyEvent('x').e as never, false, deps())).toBe(false);
    fake.readOnly = false;
    expect(handleKey(off.instance as never, keyEvent('x', { ctrlKey: true }).e as never, false, deps())).toBe(false);
    expect(handleKey(off.instance as never, keyEvent('x').e as never, true, deps())).toBe(false);
    expect(off.calls).toEqual([]);
  });

  it('is one undo step with the keystroke on the editor’s own model: the space and the capital go and come back together', () => {
    const model = realModel('N10 G1');
    model.pushStackElement();
    // What Monaco's `type` handler does with ' X' at the end of the line: one edit operation.
    model.pushEditOperations(null, [{ range: { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 7 }, text: ' X' }], () => null);
    expect(model.getValue()).toBe('N10 G1 X');
    model.undo();
    expect(model.getValue()).toBe('N10 G1');
  });
});

describe('the automatic block number on Enter (rules 2 and 3)', () => {
  beforeEach(() => {
    fake.editing = { autoNumber: true };
  });

  it('Enter after N120 G1 X5. types the line break and N130 in one edit between two undo stops, the cursor behind the number', () => {
    const { instance, calls } = enterEditor(['N120 G1 X5.'], [sel([1, 12])]);
    const { e, log } = keyEvent('Enter');
    expect(handleKey(instance as never, e as never, false, deps())).toBe(true);
    expect(log).toEqual(['preventDefault', 'stopPropagation']);
    expect(calls.map((c) => c.kind)).toEqual(['pushUndoStop', 'executeEdits', 'pushUndoStop']);
    const [source, edits, cursorState] = calls[1].args as [string, { range: Sel; text: string }[], () => unknown[]];
    expect(source).toBe('autoNumber');
    expect(edits).toEqual([
      { range: { ...sel([1, 12]), positionLineNumber: 1, positionColumn: 12 }, text: '\nN130 ', forceMoveMarkers: true },
    ]);
    expect(cursorState()).toEqual([{ l: 2, c: 6 }]);
    expect(fake.messages).toEqual([]);
  });

  it('drops the blanks after the cursor and keeps the indentation of the block', () => {
    const { instance, calls } = enterEditor(['  N120 G1 X5.  '], [sel([1, 14])]);
    expect(handleKey(instance as never, keyEvent('Enter').e as never, false, deps())).toBe(true);
    const [, edits, cursorState] = calls[1].args as [string, { range: Sel; text: string }[], () => unknown[]];
    expect(edits[0].range).toMatchObject({ startColumn: 14, endColumn: 16 });
    expect(edits[0].text).toBe('\n  N130 ');
    expect(cursorState()).toEqual([{ l: 2, c: 8 }]);
  });

  it('a refusal says why in the status bar and leaves the Enter to the editor', () => {
    const { instance, calls } = enterEditor(['N120 G1 X1.', 'N121 G1 X2.'], [sel([1, 12])]);
    const { e, log } = keyEvent('Enter');
    expect(handleKey(instance as never, e as never, false, deps())).toBe(false);
    expect(log).toEqual([]);
    expect(calls).toEqual([]);
    expect(fake.messages).toEqual(['No number fits between N120 and N121, so the new line has none. Use Renumber Blocks on the NC tab.']);
  });

  it('says overflow with the largest number the control takes', () => {
    fake.profileId = 'okuma-osp';
    const { instance } = enterEditor(['N9995 G1 X1'], [sel([1, 12])]);
    expect(handleKey(instance as never, keyEvent('Enter').e as never, false, deps())).toBe(false);
    expect(fake.messages).toEqual([t('typing.numberOverflow', { max: 'N9999' })]);
    expect(fake.messages[0]).toContain('N9999');
  });

  it.each([
    ['Enter in the middle of the line', ['N120 G1 X5.'], [sel([1, 5])], {}],
    ['Enter after a line without a number', ['G1 X5.'], [sel([1, 7])], {}],
    ['Shift+Enter', ['N120 G1 X5.'], [sel([1, 12])], { shiftKey: true }],
    ['Ctrl+Enter', ['N120 G1 X5.'], [sel([1, 12])], { ctrlKey: true }],
    ['Alt+Enter', ['N120 G1 X5.'], [sel([1, 12])], { altKey: true }],
    ['Cmd+Enter', ['N120 G1 X5.'], [sel([1, 12])], { metaKey: true }],
    ['Enter for the IME', ['N120 G1 X5.'], [sel([1, 12])], { keyCode: 229 }],
    ['Enter with two cursors', ['N120 G1 X5.', 'N130 G1 X6.'], [sel([1, 12]), sel([2, 12])], {}],
    ['Enter over a selection', ['N120 G1 X5.'], [sel([1, 6], [1, 12])], {}],
  ])('leaves %s to the editor, silently', (_name, lines, selections, rest) => {
    const { instance, calls } = enterEditor(lines, selections);
    const { e, log } = keyEvent('Enter', rest);
    expect(handleKey(instance as never, e as never, false, deps())).toBe(false);
    expect(log).toEqual([]);
    expect(calls).toEqual([]);
    expect(fake.messages).toEqual([]);
  });

  it('numbers the line with the suggestion list open while Enter does not accept a suggestion (option off, CODE-1)', () => {
    const { instance, calls } = enterEditor(['N120 G1 X5.'], [sel([1, 12])], { suggest: true, accept: 'off' });
    expect(handleKey(instance as never, keyEvent('Enter').e as never, false, deps())).toBe(true);
    expect(calls.some((c) => c.kind === 'executeEdits')).toBe(true);
  });

  it.each(['on', 'smart'] as const)('leaves Enter to the suggestion list while it is open and the option is %s', (accept) => {
    const { instance, calls } = enterEditor(['N120 G1 X5.'], [sel([1, 12])], { suggest: true, accept });
    expect(handleKey(instance as never, keyEvent('Enter').e as never, false, deps())).toBe(false);
    expect(calls).toEqual([]);
  });

  it('numbers the line when the list is closed, whatever the option', () => {
    for (const accept of ['on', 'smart', 'off'] as const) {
      const { instance } = enterEditor(['N120 G1 X5.'], [sel([1, 12])], { suggest: false, accept });
      expect(handleKey(instance as never, keyEvent('Enter').e as never, false, deps())).toBe(true);
    }
  });

  it('leaves Enter to the list when its visibility cannot be read and Enter may accept (fails closed, CODE-7)', () => {
    for (const extra of [{ noService: true }, { throwing: true }] as const) {
      const { instance, calls } = enterEditor(['N120 G1 X5.'], [sel([1, 12])], { accept: 'on', ...extra });
      expect(handleKey(instance as never, keyEvent('Enter').e as never, false, deps())).toBe(false);
      expect(calls).toEqual([]);
    }
    // With the option off the list never takes Enter, readable or not.
    const { instance } = enterEditor(['N120 G1 X5.'], [sel([1, 12])], { accept: 'off', noService: true });
    expect(handleKey(instance as never, keyEvent('Enter').e as never, false, deps())).toBe(true);
  });

  it('leaves Enter alone while composing, with the option off, in a read-only document and in a .json document', () => {
    const run = (): boolean => {
      const { instance } = enterEditor(['N120 G1 X5.'], [sel([1, 12])]);
      return handleKey(instance as never, keyEvent('Enter').e as never, false, deps());
    };
    const { instance } = enterEditor(['N120 G1 X5.'], [sel([1, 12])]);
    expect(handleKey(instance as never, keyEvent('Enter').e as never, true, deps())).toBe(false);
    fake.editing = {};
    expect(run()).toBe(false);
    fake.editing = { autoNumber: true };
    fake.readOnly = true;
    expect(run()).toBe(false);
    fake.readOnly = false;
    fake.path = '/cfg/profiles/a.json';
    expect(run()).toBe(false);
    fake.path = null;
    expect(run()).toBe(true);
  });

  it('turns on and off with the session switch over the profile', () => {
    fake.editing = {};
    runCommand('edit.toggleAutoNumber');
    const { instance } = enterEditor(['N120 G1 X5.'], [sel([1, 12])]);
    expect(handleKey(instance as never, keyEvent('Enter').e as never, false, deps())).toBe(true);
  });

  it('leaves a monstrous line as it is', () => {
    const line = `N120 G1 ${'X'.repeat(MAX_TYPING_LINE)}`;
    const { instance, calls } = enterEditor([line], [sel([1, line.length + 1])]);
    expect(handleKey(instance as never, keyEvent('Enter').e as never, false, deps())).toBe(false);
    expect(calls).toEqual([]);
  });

  it('a channel pane numbers from its own lines; Klartext refuses there with inPane', () => {
    const free = enterEditor(['N10 G0 X0', 'N20 G1 X1'], [sel([1, 10])], { pane: true });
    expect(handleKey(free.instance as never, keyEvent('Enter').e as never, false, deps())).toBe(true);
    expect((free.calls[1].args[1] as { text: string }[])[0].text).toBe('\nN15 ');
    fake.profileId = 'heidenhain-klartext';
    const plate = klartextPlate();
    const pane = enterEditor(plate, [sel([9, plate[8].length + 1])], { pane: true });
    expect(handleKey(pane.instance as never, keyEvent('Enter').e as never, false, deps())).toBe(false);
    expect(fake.messages).toEqual([t('typing.numberInPane')]);
  });

  it('a pane of the aligned view follows its own document’s setting', async () => {
    fake.editing = {}; // the active document: off
    fake.others.p1 = { readOnly: false, path: null, editing: { autoNumber: true } };
    const { instance, calls } = enterEditor(['N10 G0 X0'], [sel([1, 10])]);
    let down: ((e: unknown) => void) | undefined;
    const hooked = hookTyping({ ...instance, onKeyDown: (cb: (e: unknown) => void) => ((down = cb), { dispose() {} }) } as never, () => 'p1');
    await new Promise((resolve) => setTimeout(resolve, 0)); // Monaco's Selection class, loaded by the hook
    const { e, log } = keyEvent('Enter');
    down?.(e);
    expect(log).toEqual(['preventDefault', 'stopPropagation']);
    expect((calls[1].args[1] as { text: string }[])[0].text).toBe('\nN20 ');
    hooked.dispose();
  });
});

describe('Klartext numbering on the editor’s own model (rule 3: one undo step)', () => {
  /** A typing editor over a real Monaco text model, as the app's editor applies `executeEdits`. */
  function realEditor(text: string, selection: Sel) {
    const model = realModel(text);
    const instance = {
      onKeyDown: () => ({ dispose() {} }),
      getModel: () => ({
        getLineContent: (n: number) => model.getLineContent(n),
        getLineLength: (n: number) => model.getLineMaxColumn(n) - 1,
        getLineCount: () => model.getLineCount(),
        uri: { scheme: 'inmemory', authority: 'doc' },
      }),
      getSelections: () => [selection],
      trigger: () => {},
      // As the app's editor has them: Enter does not accept a suggestion, and no list is open.
      getOption: (id: number) => (id === 1 ? 'off' : undefined),
      contextKeyService: { getContextKeyValue: () => false },
      pushUndoStop: () => (model.pushStackElement(), true),
      executeEdits: (_source: string, edits: { range: Sel; text: string }[]) => {
        model.pushEditOperations(null, edits.map((edit) => ({ range: edit.range, text: edit.text })), () => null);
        return true;
      },
    };
    return { model, instance };
  }

  it('a block longer than MAX_TYPING_LINE below the Enter reads as empty: it keeps its number and takes no part in the count', () => {
    // The walk reads the text of a line first and judges the length from it (one lookup per line); the answer is the
    // one the length-first read gave: the long block is not renumbered and the blocks behind it follow the count.
    fake.profileId = 'heidenhain-klartext';
    fake.editing = { autoNumber: true };
    const long = `3 L ${'X'.repeat(MAX_TYPING_LINE)}`;
    const lines = ['0 BEGIN PGM T MM', '1 L X+1', '2 L X+2', long, '9 L X+4', '9 END PGM T MM'];
    const { model, instance } = realEditor(lines.join('\n'), sel([3, lines[2].length + 1]));
    expect(handleKey(instance as never, keyEvent('Enter').e as never, false, deps())).toBe(true);
    expect(model.getValue().split('\n')).toEqual(['0 BEGIN PGM T MM', '1 L X+1', '2 L X+2', '3 ', long, '4 L X+4', '5 END PGM T MM']);
  });

  it('the new line, its number and every shift below are one step: one undo brings the program back', () => {
    fake.profileId = 'heidenhain-klartext';
    fake.editing = { autoNumber: true };
    const plate = klartextPlate();
    const before = plate.join('\n');
    // Enter at the end of `7 L Z-2 F200` (line 9).
    const { model, instance } = realEditor(before, sel([9, plate[8].length + 1]));
    expect(handleKey(instance as never, keyEvent('Enter').e as never, false, deps())).toBe(true);
    expect(model.getValue().split('\n')).toEqual([
      ...plate.slice(0, 9),
      '8 ',
      '9 L X+90 Y+10 RL ~',
      '  F400',
      '10 L X+90 Y+70',
      '11 L Z+50 R0 FMAX M30',
      '12 END PGM PLATE MM',
    ]);
    model.undo();
    expect(model.getValue()).toBe(before);
    model.redo();
    expect(model.getLineContent(10)).toBe('8 ');
  });

  it('a refused Enter (more than 5,000 blocks below) leaves the program untouched and names Renumber', () => {
    fake.profileId = 'heidenhain-klartext';
    fake.editing = { autoNumber: true };
    const lines = ['0 BEGIN PGM BIG MM', ...Array.from({ length: 5002 }, (_, i) => `${i + 1} L X+${i % 90}`), '5003 END PGM BIG MM'];
    const { model, instance } = realEditor(lines.join('\n'), sel([1, lines[0].length + 1]));
    expect(handleKey(instance as never, keyEvent('Enter').e as never, false, deps())).toBe(false);
    expect(model.getValue()).toBe(lines.join('\n'));
    expect(fake.messages).toEqual([t('typing.numberTooMany', { limit: '5,000' })]);
    expect(fake.messages[0]).toContain('Renumber Blocks');
  });
});
