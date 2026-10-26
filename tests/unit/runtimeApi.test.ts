// The helper API of the runtime harness (`tests/runtime/lib/api.js`) against a page with no
// app behind it: what it sends to Rust and in which order. What the commands do on the Mac
// is for a hosted run; what a scenario may rely on in the API is held here (v1.2.0 BL-harness:
// T189, T190, T192, T193, T196, T198).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHarness } from '../runtime/lib/api.js';
import { inheritBlock, isTransientBlock } from '../runtime/lib/retry.js';
import { patchTauriConf } from '../runtime/harness/patch.mjs';

type Call = { cmd: string; args?: Record<string, unknown> };

const root = fileURLToPath(new URL('../../', import.meta.url));

// `core.mjs` is a Node script without types (the page side, `lib/`, is typed); imported by path it stays out of the type check.
type ClipboardExec = (program: string, args: string[], input?: string) => { status: number | null; stdout: string };
const core: {
  foreignBuild(rh: string, repo?: string): string | null;
  summarize(result: unknown): string;
  isolateClipboard(o?: { env?: Record<string, string | undefined>; platform?: string; exec?: ClipboardExec }): { active: boolean; restore(): void };
  restoreClipboardsNow(): void;
} = await import(
  /* @vite-ignore */ pathToFileURL(join(root, 'tests', 'runtime', 'harness', 'core.mjs')).href
);
const { foreignBuild, summarize, isolateClipboard, restoreClipboardsNow } = core;

/** A harness whose backend is a list: every command, record and drain lands in `log` in order. */
function world(answers: Record<string, (args?: Record<string, unknown>) => unknown> = {}) {
  const log: string[] = [];
  const calls: Call[] = [];
  const sent: Record<string, unknown>[] = [];
  const g = globalThis as unknown as { window?: unknown };
  const page: Record<string, unknown> = {
    __TAURI_INTERNALS__: {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        log.push(cmd);
        calls.push({ cmd, args });
        return answers[cmd]?.(args) ?? null;
      },
    },
  };
  g.window = page;
  const h = createHarness(
    // `robust: false` keeps `waitFor` off requestAnimationFrame, which node does not have.
    { scenario: 'unit', run: '/run', home: '/home', python: 'python3', appVersion: '0', robust: false },
    {} as never,
    (record) => {
      sent.push(record);
      log.push(`send ${String(record.kind)}`);
    },
    async () => {
      log.push('drain');
    },
  );
  return { h, log, calls, sent, page };
}

let previousWindow: unknown;
beforeEach(() => {
  previousWindow = (globalThis as unknown as { window?: unknown }).window;
});
afterEach(() => {
  (globalThis as unknown as { window?: unknown }).window = previousWindow;
});

describe('h.expectExit flushes the record queue (T189)', () => {
  it('hands the expect-exit record to Rust before it resolves', async () => {
    const { h, log } = world();
    const done = h.expectExit({ code: 0 });
    expect(done).toBeInstanceOf(Promise);
    await done;
    expect(log).toEqual(['send expect-exit', 'drain']);
  });

  it('still works when a scenario does not await it: the exit calls flush on their own', async () => {
    const { h, log } = world();
    void h.expectExit();
    await h.window.terminate();
    // the record, the drain of expectExit itself, the drain of the call, then the command
    expect(log).toEqual(['send expect-exit', 'drain', 'drain', 'h_quit']);
  });
});

describe('a call that can end the app flushes the queue first when an exit is expected (T196)', () => {
  const ways: [string, (h: ReturnType<typeof world>['h']) => Promise<unknown>, string][] = [
    ['h.window.close', (h) => h.window.close(), 'h_close_from_rust'],
    ['h.window.performClose', (h) => h.window.performClose(), 'h_quit'],
    ['h.window.quitKey', (h) => h.window.quitKey(), 'h_quit'],
    ['h.window.terminate', (h) => h.window.terminate(), 'h_quit'],
    ['h.nativeKeys (Cmd+Shift+W)', (h) => h.nativeKeys([{ key: 'w', mods: ['cmd', 'shift'] }]), 'h_native_input'],
    ['h.alert.click (Discard All on a quit)', (h) => h.alert.click('Discard All'), 'h_alert_click'],
  ];

  it.each(ways)('%s drains before the command, so the window cannot be gone before the record lands', async (_name, call, command) => {
    const { h, log } = world();
    await h.expectExit({ within: 8000 });
    log.length = 0;
    await call(h);
    expect(log).toEqual(['drain', command]);
  });

  it.each(ways)('%s costs no extra drain while no exit is expected', async (_name, call, command) => {
    const { h, log } = world();
    await call(h);
    expect(log).toEqual([command]);
  });

  it('keeps the arguments of the quit modes', async () => {
    const { h, calls } = world();
    await h.window.performClose();
    await h.window.quitKey();
    await h.window.terminate();
    await h.window.close(250);
    expect(calls.map((c) => [c.cmd, c.args])).toEqual([
      ['h_quit', { mode: 'performclose' }],
      ['h_quit', { mode: 'keyequiv' }],
      ['h_quit', { mode: 'terminate' }],
      ['h_close_from_rust', { delayMs: 250 }],
    ]);
  });
});

describe('h.disk can copy folders, remove, list and link (T190, T191)', () => {
  it('passes the paths to the commands under the names Rust declares', async () => {
    const { h, calls } = world({ h_list: () => [{ name: 'a.nc', isFile: true, isDir: false, isSymlink: false, len: 3 }] });
    await h.disk.copy('/run/a', '/run/b/c/d');
    await h.disk.remove('/run/b/c');
    await h.disk.remove('/run/b', { recursive: true });
    const entries = await h.disk.list('/run/b');
    await h.disk.symlink('/run/a/x.nc', '/run/links/x.nc');
    expect(calls.map((c) => [c.cmd, c.args])).toEqual([
      ['h_copy', { src: '/run/a', dst: '/run/b/c/d' }],
      ['h_remove', { path: '/run/b/c', recursive: false }],
      ['h_remove', { path: '/run/b', recursive: true }],
      ['h_list', { path: '/run/b' }],
      ['h_symlink', { target: '/run/a/x.nc', link: '/run/links/x.nc' }],
    ]);
    expect(entries).toEqual([{ name: 'a.nc', isFile: true, isDir: false, isSymlink: false, len: 3 }]);
  });
});

describe('the window size command (T192)', () => {
  const geometry = (width: number, height: number, scale = 2) => ({ width, height, x: 10, y: 20, scale, maximized: false, fullscreen: false });

  it('sets a logical size and answers the geometry once the window shows it', async () => {
    let polls = 0;
    const { h, calls } = world({
      h_window_set_size: () => geometry(2200, 1400),
      // the window server applies the size a turn later: the first poll still shows the old one
      h_window_geometry: () => (++polls < 2 ? geometry(2200, 1400) : geometry(1800, 1200)),
    });
    const got = await h.window.setSize(900, 600, { x: 40, y: 50 });
    expect(calls[0]).toEqual({ cmd: 'h_window_set_size', args: { width: 900, height: 600, x: 40, y: 50 } });
    expect(got).toEqual(geometry(1800, 1200));
    expect(polls).toBe(2);
  });

  it('answers what the window reports when it never takes the size', async () => {
    const { h } = world({ h_window_set_size: () => geometry(2200, 1400), h_window_geometry: () => geometry(2200, 1400) });
    const got = await h.window.setSize(900, 600, { timeout: 120 });
    expect(got.width).toBe(2200);
  });

  it('reads the geometry as the window-state file counts it: physical pixels with the scale', async () => {
    const { h, calls } = world({ h_window_geometry: () => geometry(1000, 650, 1) });
    expect(await h.window.geometry()).toEqual(geometry(1000, 650, 1));
    expect(calls[0].cmd).toBe('h_window_geometry');
  });
});

describe('h.turns counts turns of the app, not milliseconds (T186)', () => {
  it('makes n main-thread round trips, each followed by a frame', async () => {
    const g = globalThis as unknown as { requestAnimationFrame?: (cb: () => void) => void };
    const before = g.requestAnimationFrame;
    let frames = 0;
    g.requestAnimationFrame = (cb) => {
      frames++;
      setTimeout(cb, 0);
    };
    try {
      const { h, log } = world();
      await h.turns(3);
      expect(log).toEqual(['h_window_state', 'h_window_state', 'h_window_state']);
      // `nextFrame` asks twice per frame (before and after the paint)
      expect(frames).toBe(6);
    } finally {
      g.requestAnimationFrame = before;
    }
  });
});

describe('h.clipboard (T198)', () => {
  it('reads, writes and empties through the same two commands', async () => {
    const { h, calls } = world({ h_clipboard_read: () => 'G1 X1' });
    expect(await h.clipboard.read()).toBe('G1 X1');
    await h.clipboard.write('N10');
    await h.clipboard.clear();
    expect(calls.map((c) => [c.cmd, c.args])).toEqual([
      ['h_clipboard_read', undefined],
      ['h_clipboard_write', { text: 'N10' }],
      ['h_clipboard_write', { text: null }],
    ]);
  });
});

describe('the runner keeps the owner\'s clipboard (WX-CODE-6)', () => {
  /** A pasteboard of one text and the tool calls made against it. */
  function pasteboard(text: string) {
    const state = { text, calls: [] as string[] };
    const exec: ClipboardExec = (program, _args, input) => {
      state.calls.push(program.split('/').pop() + (input === undefined ? '' : `:${input}`));
      if (program.endsWith('pbpaste')) return { status: 0, stdout: state.text };
      state.text = input ?? '';
      return { status: 0, stdout: '' };
    };
    return { state, exec };
  }

  it('empties the clipboard for the run and puts the text back, once', () => {
    const { state, exec } = pasteboard('G1 X5');
    const clip = isolateClipboard({ env: {}, platform: 'darwin', exec });
    expect(clip.active).toBe(true);
    expect(state.text).toBe('');
    state.text = 'left behind by the scenario';
    clip.restore();
    clip.restore();
    expect(state.text).toBe('G1 X5');
    expect(state.calls.filter((c) => c.startsWith('pbcopy:'))).toEqual(['pbcopy:', 'pbcopy:G1 X5']);
  });

  it('gives it back on an interrupt or a killed run: restoreClipboardsNow reaches every run that still holds it', () => {
    const { state, exec } = pasteboard('N10');
    isolateClipboard({ env: {}, platform: 'darwin', exec });
    expect(state.text).toBe('');
    restoreClipboardsNow();
    expect(state.text).toBe('N10');
    state.text = 'later';
    restoreClipboardsNow();
    expect(state.text).toBe('later');
  });

  it('leaves it alone with HARNESS_CLIPBOARD=keep, off macOS, and when the pasteboard does not answer', () => {
    const keep = pasteboard('a');
    expect(isolateClipboard({ env: { HARNESS_CLIPBOARD: 'keep' }, platform: 'darwin', exec: keep.exec }).active).toBe(false);
    expect(isolateClipboard({ env: {}, platform: 'linux', exec: keep.exec }).active).toBe(false);
    expect(keep.state.calls).toEqual([]);
    const dead = isolateClipboard({ env: {}, platform: 'darwin', exec: () => ({ status: null, stdout: '' }) });
    expect(dead.active).toBe(false);
    expect(() => dead.restore()).not.toThrow();
  });

  const coreSource = readFileSync(join(root, 'tests', 'runtime', 'harness', 'core.mjs'), 'utf8');

  it('a run is wrapped by it, the app is told to keep out, and an interrupt restores before the lock goes', () => {
    expect(coreSource).toMatch(/const clipboard = isolateClipboard\(\)\s*\n\s*env\.HARNESS_CLIPBOARD = 'keep'\s*\n\s*const child = spawn\(/);
    expect(coreSource).toMatch(/killMatching\(run\)\s*\n\s*clipboard\.restore\(\)/);
    expect(coreSource).toMatch(/const onSignal = \(sig\) => \{[^}]*restoreClipboardsNow\(\)[^}]*release\(\)[^}]*process\.exit/);
    expect(coreSource).toContain("process.on('exit', restoreClipboardsNow)");
  });
});

describe('h.monaco is the one place that reads Monaco\'s internals (T193)', () => {
  const modelService = (count: number) => ({ getModels: () => new Array(count).fill(0) });
  const tree = (count: number, parentOnly = true) => {
    const parent = { _services: { _entries: new Map([['modelService', modelService(count)]]) } };
    return parentOnly ? { _services: { _entries: new Map([['other', {}]]) }, _parent: parent } : parent;
  };

  it('finds the model service up the instantiation tree and counts the models', () => {
    const { h, page } = world();
    page.__gedit = { ctx: { editor: { editorInstance: () => ({ _instantiationService: tree(3) }) } } };
    expect(h.monaco.service('modelService', 'getModels')).not.toBeNull();
    expect(h.monaco.modelCount()).toBe(3);
  });

  it('keeps a service it found, because a comparison removes the editor it is found through', () => {
    const { h, page } = world();
    let editor: unknown = { _instantiationService: tree(2) };
    page.__gedit = { ctx: { editor: { editorInstance: () => editor } } };
    expect(h.monaco.modelCount()).toBe(2);
    editor = undefined;
    expect(h.monaco.modelCount()).toBe(2);
  });

  it('answers -1 and null when the internals are not there, so a check can say so', () => {
    const { h, page } = world();
    page.__gedit = { ctx: { editor: { editorInstance: () => undefined } } };
    expect(h.monaco.service('modelService', 'getModels')).toBeNull();
    expect(h.monaco.modelCount()).toBe(-1);
  });

  it('prefers a model count the test hook offers', () => {
    const { h, page } = world();
    page.__gedit = { modelCount: () => 7, ctx: { editor: { editorInstance: () => undefined } } };
    expect(h.monaco.modelCount()).toBe(7);
  });
});

describe('the page API and harness.rs agree on the commands', () => {
  const rust = readFileSync(join(root, 'tests', 'runtime', 'harness', 'harness.rs'), 'utf8');
  const declared = [...rust.matchAll(/^pub fn (h_\w+)/gm)].map((m) => m[1]);

  it('every `pub fn h_…` of harness.rs is a command that sync.sh registers (the attribute sits right above it)', () => {
    const registered = [...rust.matchAll(/#\[tauri::command[^\]]*\]\s*pub\s+(?:async\s+)?fn\s+(h_\w+)/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(40);
    expect(registered.sort()).toEqual([...declared].sort());
  });

  it('every command the page calls is declared in harness.rs', () => {
    const used = new Set<string>();
    for (const file of ['api.js', 'runner.js']) {
      const source = readFileSync(join(root, 'tests', 'runtime', 'lib', file), 'utf8');
      for (const m of source.matchAll(/'(h_[a-z_]+)'/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(30);
    expect([...used].filter((name) => !declared.includes(name))).toEqual([]);
  });

  it('hands the owner\'s clipboard back at every end of a run it can end itself', () => {
    // The text is kept at startup and put back by the normal end, the exit event, the watchdog and the crash.
    expect(rust).toContain('isolate_clipboard();');
    const restores = rust.split('restore_clipboard();').length - 1;
    expect(restores).toBeGreaterThanOrEqual(4);
  });
});

describe('the scratch-path check of harness.rs follows links (WX-CODE-9)', () => {
  const rust = readFileSync(join(root, 'tests', 'runtime', 'harness', 'harness.rs'), 'utf8');

  it('check_scratch_path resolves the folders above the path before the root check, and has its Rust tests', () => {
    const body = rust.slice(rust.indexOf('fn check_scratch_path'), rust.indexOf("/// The file's bytes as"));
    expect(body).toContain('fn scratch_path_in(');
    expect(body).toContain('resolve_parent(path)');
    expect(body).toContain('.canonicalize()');
    expect(body).toContain('resolved.starts_with(&real)');
    // the Rust unit tests compile with `cargo clippy --all-targets` (tests/runtime/clippy.sh)
    expect(rust).toContain('#[cfg(test)]\nmod tests');
    expect(rust).toContain('fn a_link_in_the_folders_above_cannot_lead_out_of_the_root()');
  });
});

describe('what suite.sh does with a block (T194, T197)', () => {
  const blocked = (over: Record<string, unknown> = {}) => ({ status: 'blocked', screenLocked: false, blocked: [{ reason: 'the main thread did not answer within 3 s', where: 'h_native_input' }], ...over });

  it('retries a block with the screen unlocked: the main thread that did not answer is the runner\'s hiccup', () => {
    expect(isTransientBlock(blocked())).toBe(true);
  });

  it('does not retry a locked screen, a block inherited from a predecessor, a failure or a pass', () => {
    expect(isTransientBlock(blocked({ screenLocked: true }))).toBe(false);
    expect(isTransientBlock(blocked({ blocked: [{ reason: 'x-1 was blocked', where: 'suite' }] }))).toBe(false);
    expect(isTransientBlock({ status: 'fail', blocked: [] })).toBe(false);
    expect(isTransientBlock({ status: 'pass', blocked: [] })).toBe(false);
  });

  it('turns the failure of a `…-2` into a block before anything is printed when `…-1` was blocked', () => {
    const second = inheritBlock({ status: 'fail', blocked: [] as { reason: string; where?: string }[] }, 'm7-session-1');
    expect(second.status).toBe('blocked');
    expect(second.blocked).toEqual([{ reason: 'm7-session-1, which writes its HOME, was blocked', where: 'suite' }]);
    expect(isTransientBlock(second)).toBe(false);
    // no blocker, or a result that is not a failure: untouched
    expect(inheritBlock({ status: 'fail', blocked: [] }, undefined).status).toBe('fail');
    expect(inheritBlock({ status: 'pass', blocked: [] }, 'm7-session-1').status).toBe('pass');
  });

  const run = (over: Record<string, unknown>) => ({
    scenario: 'm0-trusted',
    status: 'fail',
    checks: [{ name: 'the scenario finished without an exception', pass: false }, { name: 'a click landed', pass: true }],
    blocked: [] as { reason: string; where: string }[],
    focus: [],
    notes: [],
    pass: false,
    durationMs: 1500,
    ...over,
  });

  it('prints the reason of a block before the checks that failed after it, and does not call them failures', () => {
    const text = summarize(run({ status: 'blocked', blocked: [{ reason: 'click cannot be delivered: Slack is frontmost', where: 'h_native_input' }] }));
    const lines = text.split('\n');
    expect(lines[0]).toMatch(/^BLOCKED m0-trusted/);
    expect(lines[1]).toContain('blocked: click cannot be delivered');
    expect(lines[2]).toContain('not judged, the run was blocked: the scenario finished without an exception');
    expect(text).not.toMatch(/\bfailed:/);
  });

  it('still prints FAIL and the failed checks for a run that is not blocked', () => {
    const text = summarize(run({}));
    expect(text.split('\n')[0]).toMatch(/^FAIL m0-trusted/);
    expect(text).toContain('failed: the scenario finished without an exception');
  });
});

describe('a build folder shared by two checkouts refuses (T195)', () => {
  const dirs: string[] = [];
  const folder = (sync?: Record<string, unknown>) => {
    const dir = mkdtempSync(join(tmpdir(), 'gedit-rh-test-'));
    dirs.push(dir);
    mkdirSync(dir, { recursive: true });
    if (sync) writeFileSync(join(dir, 'sync.json'), JSON.stringify(sync));
    return dir;
  };
  afterEach(() => {
    delete process.env.GEDIT_RH_ALLOW_FOREIGN_BUILD;
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('refuses a build another checkout synced, and says how to go on', () => {
    const message = foreignBuild(folder({ repo: '/work/other', harness: '/work/other' }), '/work/mine');
    expect(message).toContain('/work/other');
    expect(message).toContain('/work/mine');
    expect(message).toContain('sync.sh');
    expect(message).toContain('GEDIT_RH_DIR');
    expect(message).toContain('GEDIT_RH_ALLOW_FOREIGN_BUILD=1');
  });

  it('accepts its own build, a build of another app source made by its own harness, and a folder with no build yet', () => {
    expect(foreignBuild(folder({ repo: '/work/mine', harness: '/work/mine' }), '/work/mine')).toBeNull();
    expect(foreignBuild(folder({ repo: '/work/other-app', harness: '/work/mine' }), '/work/mine')).toBeNull();
    expect(foreignBuild(folder(), '/work/mine')).toBeNull();
    // a sync.json from before the field existed is read by the checkout it names
    expect(foreignBuild(folder({ repo: '/work/mine' }), '/work/mine')).toBeNull();
    expect(foreignBuild(folder({ repo: '/work/other' }), '/work/mine')).not.toBeNull();
  });

  it('runs anyway when told to', () => {
    process.env.GEDIT_RH_ALLOW_FOREIGN_BUILD = '1';
    expect(foreignBuild(folder({ repo: '/work/other', harness: '/work/other' }), '/work/mine')).toBeNull();
  });
});

describe('the test build keeps WebKit\'s storage to itself (T198)', () => {
  const conf = JSON.stringify({ app: { windows: [{ label: 'main', width: 1280 }] }, other: 1 });

  it('hides the window and gives it a non-persistent data store', () => {
    const win = JSON.parse(patchTauriConf(conf, { persistentWebkit: false })).app.windows[0];
    expect(win).toMatchObject({ label: 'main', width: 1280, visible: false, incognito: true });
  });

  it('keeps the old store when asked to (GEDIT_RH_PERSISTENT_WEBKIT=1 at sync time)', () => {
    const win = JSON.parse(patchTauriConf(conf, { persistentWebkit: true })).app.windows[0];
    expect(win.visible).toBe(false);
    expect(win.incognito).toBeUndefined();
  });

  it('changes nothing else in the repository\'s config', () => {
    const out = JSON.parse(patchTauriConf(conf, { persistentWebkit: false }));
    expect(out.other).toBe(1);
  });

  it('the real config has a window to patch, and `incognito` is a field of its schema', () => {
    const real = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
    expect(real.app.windows.length).toBeGreaterThan(0);
    expect(JSON.parse(patchTauriConf(JSON.stringify(real), { persistentWebkit: false })).app.windows.every((w: { incognito: boolean }) => w.incognito === true)).toBe(true);
  });
});
