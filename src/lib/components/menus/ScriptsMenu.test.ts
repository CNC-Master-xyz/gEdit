// The Tools tab's script list (plan §5 WP5.2, §7.9: `scripts-group`, `script-item` with
// `data-script-id`). Rendered with `svelte/server`, so no DOM and no Monaco.
//
// The four empty states are the point of these tests: "not asked yet", "no Python", "the
// folders could not be read" and "nothing for this dialect" are four different problems
// with four different fixes, and a single "no scripts" for all of them sends the user
// looking in the wrong place. The fifth case pins the seam a scenario clicks.
//
// The filter of `core/scripting/filter.ts` is faked with
// the rules its header states.

import { render } from 'svelte/server';
import { writable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocMeta } from '$lib/app/types';
import type { ScriptEntry, ScriptMeta } from '$lib/platform/commands';

const fake = vi.hoisted(() => ({ active: null as DocMeta | null }));

vi.mock('$lib/core/scripting/filter', () => ({
  scriptLabel: (entry: ScriptEntry) => entry.meta?.name || entry.fileName,
  scriptsForProfile: (entries: ScriptEntry[], profileId: string | null) =>
    entries.filter(
      (entry) =>
        !entry.shadowed &&
        (entry.meta?.profiles == null ||
          profileId === null ||
          entry.meta.profiles.includes(profileId)),
    ),
  groupScripts: (entries: ScriptEntry[]) => {
    const groups = new Map<string, { group: string | null; package?: string; scripts: ScriptEntry[] }>();
    for (const entry of entries) {
      const pkg = entry.root.startsWith('pkg-') ? entry.root.slice(4) : undefined;
      const key = `${pkg ?? ''}/${entry.group ?? ''}`;
      const section = groups.get(key) ?? { group: entry.group, ...(pkg === undefined ? {} : { package: pkg }), scripts: [] };
      section.scripts.push(entry);
      groups.set(key, section);
    }
    return [...groups.values()];
  },
}));

vi.mock('$lib/app/scripts', async () => {
  const { derived } = await import('svelte/store');
  const stores = await import('$lib/stores/scripts');
  return {
    formKey: (id: string) => `script:${id}`,
    scripts: {
      list: derived(stores.scriptList, (v) => v),
      python: derived(stores.pythonStatus, (v) => v),
      running: derived(stores.runningScript, (v) => v),
      rescan: async (): Promise<void> => undefined,
      run: async (): Promise<void> => undefined,
      runLast: async (): Promise<void> => undefined,
      cancel: async (): Promise<void> => undefined,
      checkPython: async () => null,
    },
  };
});

vi.mock('$lib/stores/documents', () => {
  const active = writable<DocMeta | null>(null);
  active.subscribe((value) => {
    fake.active = value;
  });
  return { docs: { active, setActive: (v: DocMeta | null) => active.set(v) } };
});

// The package list the menu takes its captions from (`userConfig.packages`, refreshed on every load).
vi.mock('$lib/app/userConfig', async () => {
  const { writable } = await import('svelte/store');
  return { userConfig: { packages: writable(null) } };
});

const ScriptsMenu = (await import('./ScriptsMenu.svelte')).default;
const { commands, resetCommandsForTest } = await import('$lib/app/registry/commands');
const { pythonStatus, resetScriptsForTest, scriptList, scriptListError } = await import(
  '$lib/stores/scripts'
);
const { userConfig } = (await import('$lib/app/userConfig')) as unknown as {
  userConfig: { packages: { set(v: unknown): void } };
};
const { docs } = (await import('$lib/stores/documents')) as unknown as {
  docs: { setActive(v: DocMeta | null): void };
};

function meta(patch: Partial<ScriptMeta> = {}): ScriptMeta {
  return {
    name: '',
    description: '',
    profiles: null,
    input: 'selection-or-document',
    output: 'panel',
    timeout: null,
    envelope: false,
    documents: 'active',
    params: [],
    warnings: [],
    ...patch,
  };
}

function entry(id: string, patch: Partial<ScriptEntry> = {}): ScriptEntry {
  return {
    id,
    root: id.split(':')[0],
    group: null,
    fileName: id.split(':')[1] ?? id,
    meta: null,
    headerError: null,
    shadowed: false,
    editable: true,
    ...patch,
  };
}

/** The registry is the single source of enablement, so the test drives it. */
function registerRun(id: string, enabled: boolean): void {
  commands.register({
    id: `script.run:${id}`,
    title: id,
    enabled: () => enabled,
    run: () => undefined,
  });
}

const menu = (): string => render(ScriptsMenu).body;

beforeEach(() => {
  userConfig.packages.set(null);
  resetScriptsForTest();
  resetCommandsForTest();
  docs.setActive({ id: 'd1', profileId: 'fanuc-gcode' } as DocMeta);
});

afterEach(() => {
  docs.setActive(null);
});

describe('empty states', () => {
  it('says nothing about Python until the probe has answered', () => {
    const html = menu();
    expect(html).not.toContain('Python 3.9 or newer was not found');
    expect(html).toContain('No scripts found.');
  });

  it('shows the notice, with the interpreter detail as the tooltip, when Python is missing', () => {
    pythonStatus.set({
      ok: false,
      interpreter: null,
      version: null,
      message: 'python3: command not found',
    });
    scriptList.set([entry('user:a.py')]);
    const html = menu();
    expect(html).toContain('Python 3.9 or newer was not found');
    expect(html).toContain('python3: command not found');
    expect(html).not.toContain('data-testid="script-item"');
  });

  it('names the folder problem instead of claiming there are no scripts', () => {
    scriptListError.set('/work/scripts: permission denied');
    const html = menu();
    expect(html).toContain('Could not read the script folders');
    expect(html).toContain('permission denied');
  });

  it('separates "nothing for this dialect" from "nothing at all"', () => {
    expect(menu()).toContain('No scripts found.');
    scriptList.set([entry('user:k.py', { meta: meta({ profiles: ['heidenhain-klartext'] }) })]);
    expect(menu()).toContain('No scripts for this dialect');
  });
});

describe('the script items', () => {
  it('renders one group per folder and one item per script, keyed by id', () => {
    scriptList.set([
      entry('user:a.py', { meta: meta({ name: 'Scale feed' }) }),
      entry('user:tools/b.py', { group: 'tools' }),
    ]);
    const html = menu();
    expect(html.match(/data-testid="scripts-group"/g)).toHaveLength(2);
    expect(html).toContain('data-script-id="user:a.py"');
    expect(html).toContain('data-script-id="user:tools/b.py"');
    expect(html).toContain('Scale feed');
    expect(html).toContain('tools');
  });

  it('uses the description as the tooltip and says when a header could not be read', () => {
    scriptList.set([
      entry('user:a.py', { meta: meta({ name: 'Scale feed', description: 'Scales F words' }) }),
      entry('user:b.py', { headerError: 'line 3: expected a table' }),
    ]);
    const html = menu();
    expect(html).toContain('Scale feed — Scales F words');
    expect(html).toContain('b.py: the header could not be read');
  });

  it('takes its disabled state from the registry and not from a second copy of the rules', () => {
    scriptList.set([entry('user:a.py'), entry('user:b.py')]);
    registerRun('user:a.py', true);
    registerRun('user:b.py', false);
    const html = menu();
    expect(html).toMatch(/data-script-id="user:b.py"[^>]*disabled/);
    expect(html).not.toMatch(/data-script-id="user:a.py"[^>]*disabled/);
  });

  it('still lists the scripts without a document, but none of them can be started', () => {
    docs.setActive(null);
    scriptList.set([entry('user:a.py', { meta: meta({ profiles: ['fanuc-gcode'] }) })]);
    // `profileId === null` hides nothing (the filter's rule); the item is there but the
    // registry has no command for it yet, so it cannot be started.
    const html = menu();
    expect(html).toContain('data-script-id="user:a.py"');
    expect(html).toMatch(/data-script-id="user:a.py"[^>]*disabled/);
  });
});

// B1 A9: the Tools tab lists the scripts that ship with gEdit, the Scripts tab the user's own.
describe('the two lists (B1 A9)', () => {
  const Bundled = async () => (await import('./BundledScriptsMenu.svelte')).default;
  const Own = async () => (await import('./OwnScriptsMenu.svelte')).default;

  beforeEach(() => {
    scriptList.set([
      entry('bundled:scale_feed.py', { meta: meta({ name: 'Scale feed rates' }) }),
      entry('bundled:tool_list.py', { meta: meta({ name: 'Tool list' }) }),
      entry('user:mine.py', { meta: meta({ name: 'My script' }) }),
      entry('extra0:other.py', { meta: meta({ name: 'Other folder script' }) }),
    ]);
  });

  it('shows only the built-in scripts on the Tools tab', async () => {
    const html = render(await Bundled()).body;
    expect(html).toContain('data-script-id="bundled:scale_feed.py"');
    expect(html).toContain('data-script-id="bundled:tool_list.py"');
    expect(html).not.toContain('user:mine.py');
    expect(html).not.toContain('extra0:other.py');
  });

  it('shows only the user\'s own scripts, from the user folder and added folders, on the Scripts tab', async () => {
    const html = render(await Own()).body;
    expect(html).toContain('data-script-id="user:mine.py"');
    expect(html).toContain('data-script-id="extra0:other.py"');
    expect(html).not.toContain('bundled:');
  });

  it('does not caption a single ungrouped list inside a group that already has a label', async () => {
    expect(render(await Bundled()).body).not.toContain('class="caption');
    expect(menu()).toContain('class="caption');
  });

  it('tells the Scripts tab, not the Tools tab, that there is nothing of the user\'s own yet', async () => {
    scriptList.set([entry('bundled:scale_feed.py')]);
    expect(render(await Own()).body).toContain('No scripts of your own yet');
    expect(render(await Bundled()).body).not.toContain('No scripts');
  });
});

// P4g (§6.9 rule 10): the scripts of a package are sections of their own, under the package's
// name, on the Scripts tab (they are not built in, and they are not the user's own folder).
describe('the scripts of a package', () => {
  const Bundled = async () => (await import('./BundledScriptsMenu.svelte')).default;
  const Own = async () => (await import('./OwnScriptsMenu.svelte')).default;

  beforeEach(() => {
    scriptList.set([
      entry('bundled:scale_feed.py', { meta: meta({ name: 'Scale feed rates' }), editable: false }),
      entry('pkg-shop-a:facing.py', { meta: meta({ name: 'Facing' }), editable: false }),
      entry('pkg-shop-a:finish/chamfer.py', { group: 'finish', meta: meta({ name: 'Chamfer' }), editable: false }),
      entry('user:mine.py', { meta: meta({ name: 'My script' }) }),
    ]);
  });

  it('lists them on the Scripts tab, one section for the package and one for its subfolder, and not on the Tools tab', async () => {
    const own = render(await Own()).body;
    expect(own).toContain('data-script-id="pkg-shop-a:facing.py"');
    expect(own).toContain('data-script-id="pkg-shop-a:finish/chamfer.py"');
    expect(own).toContain('data-script-id="user:mine.py"');
    expect(own).toContain('data-package="shop-a"');
    // The caption is the package (its folder name until package.json is read) and the subfolder.
    expect(own).toContain('shop-a / finish');
    const bundled = render(await Bundled()).body;
    expect(bundled).not.toContain('pkg-shop-a');
  });

  it('keeps a package section apart from a user section of the same subfolder name', async () => {
    scriptList.set([
      entry('pkg-shop-a:finish/chamfer.py', { group: 'finish', editable: false }),
      entry('user:finish/mine.py', { group: 'finish' }),
    ]);
    const html = render(await Own()).body;
    expect(html.match(/data-testid="scripts-group"/g)).toHaveLength(2);
  });
});

// CODE-7 (P4g review): the captions came from a one-off `packages_list` call, so a renamed package
// kept its old caption after Packages > Reload.
describe('the caption of a package section', () => {
  const Own = async () => (await import('./OwnScriptsMenu.svelte')).default;
  const info = (name: string, title: string) => ({ name, title });

  beforeEach(() => {
    scriptList.set([entry('pkg-shop-a:facing.py', { meta: meta({ name: 'Facing' }), editable: false })]);
  });

  it('is the display name of the package list the configuration holds, and follows a new list', async () => {
    userConfig.packages.set({ folder: '/c/packages', packages: [info('shop-a', 'Shop A tools')], problems: [] });
    const html = render(await Own()).body;
    expect(html).toContain('Shop A tools');
    expect(html).not.toContain('>shop-a<');
    userConfig.packages.set({ folder: '/c/packages', packages: [info('shop-a', 'Shop A, new name')], problems: [] });
    const again = render(await Own()).body;
    expect(again).toContain('Shop A, new name');
    expect(again).not.toContain('Shop A tools');
  });

  it('is the folder name while no list is known, or when the package has no title', async () => {
    expect(render(await Own()).body).toContain('>shop-a<');
    userConfig.packages.set({ folder: '/c/packages', packages: [info('shop-a', '  ')], problems: [] });
    expect(render(await Own()).body).toContain('>shop-a<');
  });
});
