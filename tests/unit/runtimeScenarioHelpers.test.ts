// Helpers of the runtime scenarios (tests/runtime/scenarios/*-common.js) that can be driven without the app.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectLines } from '../runtime/scenarios/m4-common.js';
import { scenarios } from '../runtime/lib/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const scenarioDir = join(root, 'tests', 'runtime', 'scenarios');
const source = (file: string): string => readFileSync(join(scenarioDir, file), 'utf8');

describe('selectLines reads the document it selects in, not the editor\'s previous one (T187)', () => {
  // Monaco throws "Illegal value for lineNumber" for a line the model does not have. After a tab switch the
  // editor instance can hold the previous document for a turn; its model had 3 lines when line 4 was asked for.
  const fakeModel = (lines: number) => ({ getLineCount: () => lines, getLineLength: (n: number) => (n >= 1 && n <= lines ? 9 + n : (() => { throw new Error('Illegal value for lineNumber'); })()) });

  const world2 = (shownFirst: ReturnType<typeof fakeModel>, mine: ReturnType<typeof fakeModel>, switchesAfter: number) => {
    let polls = 0;
    const selections: unknown[] = [];
    const instance = {
      getModel: () => (polls >= switchesAfter ? mine : shownFirst),
      setSelection: (range: unknown) => void selections.push(range),
    };
    const h = {
      app: { ctx: { docs: { getActiveId: () => 'd2' }, editor: { model: () => mine, editorInstance: () => instance } } },
      waitFor: async <T>(fn: () => T): Promise<T | undefined> => {
        for (let i = 0; i < 50; i++) {
          polls++;
          const v = fn();
          if (v) return v;
        }
        return undefined;
      },
      idle: async () => true,
    };
    return { h, selections };
  };

  it('waits for the editor to show the document, then selects whole lines with the length of its own line', async () => {
    const { h, selections } = world2(fakeModel(3), fakeModel(5), 4);
    await selectLines(h as never, 3, 4);
    expect(selections).toEqual([{ startLineNumber: 3, startColumn: 1, endLineNumber: 4, endColumn: 14 }]);
  });

  it('says which lines of how long a document it was asked for when they are not there', async () => {
    const { h, selections } = world2(fakeModel(5), fakeModel(5), 0);
    await expect(selectLines(h as never, 3, 6)).rejects.toThrow('lines 3 to 6 of a document with 5 lines');
    await expect(selectLines(h as never, 0, 2)).rejects.toThrow('lines 0 to 2');
    expect(selections).toEqual([]);
  });

  it('says so when the editor never shows the active document', async () => {
    const { h } = world2(fakeModel(3), fakeModel(5), 10_000);
    await expect(selectLines(h as never, 1, 2)).rejects.toThrow('does not show the active document');
  });
});

describe('the scenarios no longer sleep for the record queue (T196)', () => {
  it('no scenario waits 300 or 500 ms between h.expectExit and the call that ends the app', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(scenarioDir).filter((f) => f.endsWith('.js'))) {
      // `expectExit(...)` then, within a few lines, a fixed sleep of the size the old workaround used
      if (/expectExit\([\s\S]{0,500}?h\.sleep\((300|500)\)/.test(source(file))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('the scenarios that did await their exit record now await expectExit itself', () => {
    for (const file of ['m2-window-state.js', 'm2-recent-restart.js', 'm6-machines-manage.js', 'm7-common.js', 'm6-quit.js', 'm1-perf.js']) {
      expect(source(file), file).toMatch(/await h\.expectExit\(/);
    }
  });
});

describe('the scenarios of the v1.2.0 harness batch are in their suites (T034, T179, T181 to T183, T188)', () => {
  const m1 = readFileSync(join(root, 'tests', 'runtime', 'suites', 'm1.txt'), 'utf8')
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter((line) => line !== '');

  it('m1.txt lists the Save All and the save-over-a-changed-file scenarios, and both are registered', async () => {
    await import('../runtime/scenarios/m1-quit.js');
    await import('../runtime/scenarios/m1-save-changed.js');
    expect(m1).toContain('m1-quit-save-all');
    expect(m1).toContain('m1-save-changed');
    expect(scenarios.get('m1-quit-save-all')).toBeDefined();
    expect(scenarios.get('m1-save-changed')).toBeDefined();
  });

  it('m1-quit-multi drops a file while the quit question is up, m1-dnd drops a symbolic link and one with no target, p4-compare types into both panes', () => {
    expect(source('m1-quit.js')).toMatch(/dropped while the quit question is up/);
    expect(source('m1-open.js')).toContain('h.disk.symlink(');
    expect(source('p4-compare.js')).toContain("'D6. the line-join guard and the capitals in both panes'");
  });

  it('the window-state pair restores for real: both runs keep the restored geometry, and no check is "BLOCKED" any more', () => {
    const text = source('m2-window-state.js');
    expect(text.match(/HARNESS_KEEP_GEOMETRY/g)?.length).toBeGreaterThanOrEqual(1);
    expect(text).toContain('...KEEP');
    expect(text).not.toContain("'BLOCKED:");
    const rust = readFileSync(join(root, 'tests', 'runtime', 'harness', 'harness.rs'), 'utf8');
    expect(rust).toContain('HARNESS_KEEP_GEOMETRY');
  });
});

describe('the scenarios count where a count can replace a clock (T186)', () => {
  it('the UI-responsiveness check of m0-main counts pings and frames instead of holding a latency to 500 ms', () => {
    const text = source('m0-main.js');
    expect(text).not.toMatch(/maxPingMs < 500/);
    expect(text).toMatch(/script\.pings >= 8/);
  });

  it('the clocks that stay go through checkTime, so a hosted runner gets its factor', () => {
    expect(source('m0-python.js')).toContain("h.checkTime('the lookup does not delay the first run'");
    expect(source('m0-python.js')).not.toMatch(/first\.ms < 3000/);
    expect(source('m4-scripts.js')).toContain("h.checkTime('it is killed at the deadline");
    expect(source('m5-scripts.js')).toContain("h.checkTime('the run is stopped at its own deadline");
  });

  it('the fixed sleeps that stood for "nothing else happens" are gone from the quit, close and layout scenarios', () => {
    for (const file of ['m1-quit.js', 'm0-close.js', 'm1-layout.js', 'm1-keys.js']) {
      const left = source(file).split('\n').filter((line) => /h\.sleep\(\d{3,}\)/.test(line) && !line.trim().startsWith('//'));
      // m0-close keeps the one sleep that waits for an exit it expects (the app is gone while it runs)
      expect(left.length, `${file}: ${left.join(' | ')}`).toBe(file === 'm0-close.js' ? 1 : 0);
    }
  });
});

describe('Monaco\'s private services are read in one place (T193)', () => {
  it('only lib/api.js touches `_instantiationService`; the scenarios ask `h.monaco`', () => {
    const readers = readdirSync(scenarioDir)
      .filter((f) => f.endsWith('.js') && /_instantiationService/.test(source(f)))
      // a comment may say what the old code did; code may not
      .filter((f) => source(f).split('\n').some((line) => /_instantiationService/.test(line) && !line.trim().startsWith('//')));
    expect(readers).toEqual([]);
    expect(readFileSync(join(root, 'tests', 'runtime', 'lib', 'api.js'), 'utf8')).toContain('_instantiationService');
    expect(source('m2-compare.js')).toContain("h.monaco.service('modelService', 'getModels')");
    expect(source('m11-common.js')).toContain("h.monaco.service('codeEditorService', 'listDiffEditors')");
  });
});
