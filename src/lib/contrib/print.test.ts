// What the "Print" contribution declares (plan §6.5 rule 10, §6.11) and the form flow of its two commands: Mod+P and
// no other key, the titles and the ribbon group, the selection as the default scope, what is remembered, and that a
// cancelled form does nothing.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import contribution, { askPrintOptions, runExportHtml, runPrint, swallowPrintChord, type ChordEvent, type PrintCommandDeps } from './print';
import { closeModalForTest, modals } from '$lib/app/modals';
import { isMacPlatform } from '$lib/utils/platform';
import { hasKey, t } from '$lib/i18n';
import type { PrintOptions } from '$lib/app/print';
import type { CommandDef } from '$lib/app/types';

const commands = new Map<string, CommandDef>((contribution.commands ?? []).map((def) => [def.id, def]));

interface Rig {
  deps: PrintCommandDeps;
  forms: { title: string; okLabel?: string; values?: Record<string, unknown> }[];
  answer: Record<string, unknown> | undefined;
  selection: { startLine: number; endLine: number; empty: boolean } | null;
  params: Record<string, Record<string, unknown>>;
  printed: PrintOptions[];
  exported: PrintOptions[];
  exclusiveCalls: number;
}

function rig(): Rig {
  const r: Rig = {
    forms: [],
    answer: { scope: 'document', colors: 'color', lineNumbers: true, fontPt: 9 },
    selection: null,
    params: {},
    printed: [],
    exported: [],
    exclusiveCalls: 0,
    deps: undefined as never,
  };
  r.deps = {
    editor: { selectionLines: () => r.selection },
    modals: {
      form: async (o) => {
        r.forms.push({ title: o.title, okLabel: o.okLabel, values: o.values });
        return r.answer;
      },
    },
    dialogs: {
      exclusive: async (op) => {
        r.exclusiveCalls += 1;
        return op();
      },
    },
    uiState: {
      getLastParams: (key) => r.params[key],
      setLastParams: (key, v) => void (r.params[key] = v),
    },
    print: {
      print: async (o) => {
        r.printed.push(o);
        return { ok: true, pages: 1 };
      },
      exportHtml: async (o) => {
        r.exported.push(o);
        return { ok: true, pages: 1 };
      },
    },
    t,
  };
  return r;
}

describe('the print commands', () => {
  it('are file.print on Mod+P and file.exportHtml with no key', () => {
    expect([...commands.keys()]).toEqual(['file.print', 'file.exportHtml']);
    expect(commands.get('file.print')!.keys).toBe('Mod+P');
    expect(commands.get('file.exportHtml')!.keys).toBeUndefined();
  });

  it('have a message for every title and category, with the titles of the contract', () => {
    for (const def of commands.values()) {
      expect(hasKey(def.title), def.title).toBe(true);
      expect(def.category !== undefined && hasKey(def.category), def.id).toBe(true);
    }
    expect(t(commands.get('file.print')!.title)).toBe('Print');
    expect(t(commands.get('file.exportHtml')!.title)).toBe('Export as HTML');
  });

  it('are global and always enabled, so the dispatcher takes Mod+P wherever it is free to print', () => {
    for (const def of commands.values()) {
      expect(def.global, def.id).toBe(true);
      expect(def.enabled, def.id).toBeUndefined();
    }
  });

  it('sit in the File tab’s Print group: Print large at 90, Export at 91', () => {
    expect(contribution.ribbon).toEqual([
      { tab: 'file', group: 'print.group', command: 'file.print', order: 90, size: 'large' },
      { tab: 'file', group: 'print.group', command: 'file.exportHtml', order: 91 },
    ]);
    expect(hasKey('print.group')).toBe(true);
  });

  it('are the only commands of the shipped contributions on Mod+P', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const users = readdirSync(dir)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .filter((name) => /['"]Mod\+P['"]/.test(readFileSync(join(dir, name), 'utf8')));
    expect(users).toEqual(['print.ts']);
  });
});

describe('the print form', () => {
  it('opens as "Print" with a Print button, the whole program as the scope without a selection', async () => {
    const r = rig();
    await runPrint(r.deps);
    expect(r.forms[0].title).toBe('Print');
    expect(r.forms[0].okLabel).toBe('Print');
    expect(r.forms[0].values).toMatchObject({ scope: 'document', colors: 'color', lineNumbers: true, fontPt: 9 });
    expect(r.printed).toEqual([{ scope: 'document', colors: 'color', lineNumbers: true, fontPt: 9 }]);
  });

  it('makes a selection the default scope, even when the last run was the whole program', async () => {
    const r = rig();
    r.params.print = { scope: 'document', colors: 'black', lineNumbers: false, fontPt: 12 };
    r.selection = { startLine: 3, endLine: 9, empty: false };
    r.answer = undefined;
    await runPrint(r.deps);
    expect(r.forms[0].values).toEqual({ scope: 'selection', colors: 'black', lineNumbers: false, fontPt: 12 });
  });

  it('does not offer the selection for a caret', async () => {
    const r = rig();
    r.selection = { startLine: 3, endLine: 3, empty: true };
    r.params.print = { scope: 'selection', colors: 'color', lineNumbers: true, fontPt: 9 };
    await runPrint(r.deps);
    expect(r.forms[0].values?.scope).toBe('document');
  });

  it('remembers the answer in lastParams under "print"', async () => {
    const r = rig();
    r.answer = { scope: 'document', colors: 'black', lineNumbers: false, fontPt: 11 };
    await runPrint(r.deps);
    expect(r.params.print).toEqual(r.answer);
    expect(r.printed[0]).toEqual({ scope: 'document', colors: 'black', lineNumbers: false, fontPt: 11 });
  });

  it('does nothing and remembers nothing when the form is cancelled', async () => {
    const r = rig();
    r.answer = undefined;
    await runPrint(r.deps);
    await runExportHtml(r.deps);
    expect(r.printed).toEqual([]);
    expect(r.exported).toEqual([]);
    expect(r.params).toEqual({});
  });

  it('opens Export as HTML with the same form, an Export button, and the one-chain lock around the save dialog', async () => {
    const r = rig();
    await runExportHtml(r.deps);
    expect(r.forms[0].title).toBe('Export as HTML');
    expect(r.forms[0].okLabel).toBe('Export');
    expect(r.exclusiveCalls).toBe(1);
    expect(r.exported).toHaveLength(1);
    expect(r.printed).toEqual([]);
  });

  it('falls back to the defaults for a remembered value the form no longer allows', async () => {
    const r = rig();
    r.params.print = { scope: 'document', colors: 'sepia', lineNumbers: 'yes', fontPt: 40 };
    expect(await askPrintOptions(r.deps, 't', 'ok')).toEqual({ scope: 'document', colors: 'color', lineNumbers: true, fontPt: 9 });
    expect(r.forms[0].values).toMatchObject({ colors: 'color', lineNumbers: true });
  });
});

describe('the Mod+P swallow (the webview must never print the application window)', () => {
  const chord = (over: Partial<ChordEvent> = {}): ChordEvent & { preventDefault: ReturnType<typeof vi.fn> } => ({
    key: 'p',
    code: 'KeyP',
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    target: { tagName: 'DIV' },
    ...over,
    preventDefault: vi.fn(),
  });
  const env = { isModalOpen: false, isMac: true };

  it('takes the chord while a modal is open, and prints nothing', () => {
    const e = chord();
    expect(swallowPrintChord(e, { ...env, isModalOpen: true })).toBe(true);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('takes the chord in a text field and in the editor', () => {
    for (const target of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'DIV', closest: () => ({}) }]) {
      const e = chord({ target });
      expect(swallowPrintChord(e, env), JSON.stringify(Object.keys(target))).toBe(true);
      expect(e.preventDefault).toHaveBeenCalledTimes(1);
    }
  });

  it('leaves the chord to the dispatcher elsewhere, to other keys and to an event somebody else took', () => {
    const plain = chord();
    expect(swallowPrintChord(plain, env)).toBe(false);
    expect(plain.preventDefault).not.toHaveBeenCalled();
    const other = chord({ key: 'o', code: 'KeyO' });
    expect(swallowPrintChord(other, { ...env, isModalOpen: true })).toBe(false);
    expect(other.preventDefault).not.toHaveBeenCalled();
    const taken = chord({ defaultPrevented: true });
    expect(swallowPrintChord(taken, { ...env, isModalOpen: true })).toBe(false);
    expect(taken.preventDefault).not.toHaveBeenCalled();
  });

  it('is installed by activate on the window in the bubble phase and removed again', async () => {
    const listeners: { type: string; fn: (e: ChordEvent) => void; capture: unknown }[] = [];
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: (e: ChordEvent) => void, capture?: unknown) => void listeners.push({ type, fn, capture }),
      removeEventListener: (type: string, fn: (e: ChordEvent) => void) => {
        const i = listeners.findIndex((l) => l.type === type && l.fn === fn);
        if (i >= 0) listeners.splice(i, 1);
      },
    });
    try {
      const dispose = (await contribution.activate!()) as () => void;
      expect(listeners.map((l) => [l.type, l.capture === undefined || l.capture === false])).toEqual([['keydown', true]]);
      const mod = isMacPlatform() ? { metaKey: true, ctrlKey: false } : { metaKey: false, ctrlKey: true };
      // No modal and a plain target: left for the dispatcher.
      const free = chord(mod);
      listeners[0].fn(free);
      expect(free.preventDefault).not.toHaveBeenCalled();
      // A text field: swallowed.
      const field = chord({ ...mod, target: { tagName: 'INPUT' } });
      listeners[0].fn(field);
      expect(field.preventDefault).toHaveBeenCalledTimes(1);
      // A modal that opens later is seen, and one that closed is forgotten.
      void modals.prompt({ title: 'x' });
      const withModal = chord(mod);
      listeners[0].fn(withModal);
      expect(withModal.preventDefault).toHaveBeenCalledTimes(1);
      closeModalForTest();
      const after = chord(mod);
      listeners[0].fn(after);
      expect(after.preventDefault).not.toHaveBeenCalled();
      dispose();
      expect(listeners).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
