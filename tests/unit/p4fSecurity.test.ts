// The static half of the P4f security part (plan section 6.8, "Security: the limits"): what the
// code reviewer reads, pinned so a later change has to say so. Reads files only; the Rust tests
// hold the behaviour.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const json = (path: string): any => JSON.parse(read(path));

describe('the capability diff of P4f is empty', () => {
  const capability = json('src-tauri/capabilities/default.json');

  it('grants exactly the permissions of v1.1.0 plus print (P4.15), nothing for folders or the plugin', () => {
    expect(capability.windows).toEqual(['main']);
    expect(capability.permissions).toEqual([
      'core:event:allow-listen',
      'core:event:allow-unlisten',
      'core:window:allow-set-title',
      'core:window:allow-set-theme',
      'core:window:allow-destroy',
      'core:webview:allow-internal-toggle-devtools',
      'core:webview:allow-print',
      'dialog:allow-open',
      'dialog:allow-save',
      'dialog:allow-message',
      'fs:allow-read-file',
      'fs:allow-write-file',
    ]);
  });

  it('has no directory read, scope, shell, opener or http permission', () => {
    for (const permission of capability.permissions as string[]) {
      expect(permission).not.toMatch(/^(fs:(allow-read-dir|scope|allow-exists|allow-stat|allow-remove|allow-rename|allow-copy-file|allow-mkdir|read-all|write-all)|shell:|opener:|http:|process:|updater:)/);
    }
  });
});

/** Every `extensions` list anywhere in a profile (the profiles keep it under their detection block). */
function collect(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collect(item, into);
  } else if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'extensions' && Array.isArray(value)) for (const e of value) into.add(String(e).toLowerCase());
      else collect(value, into);
    }
  }
}

describe('the bundle', () => {
  const conf = json('src-tauri/tauri.conf.json');

  it('registers the ten extensions the owner chose (Q4-21) and not the ones other programs use', () => {
    const associations = conf.bundle.fileAssociations as { ext: string[]; role?: string; mimeType?: string }[];
    const ext = associations.flatMap((a) => a.ext);
    expect([...ext].sort()).toEqual(['cnc', 'eia', 'mpf', 'min', 'nc', 'ncc', 'ptp', 'spf', 'ssb', 'tap'].sort());
    for (const other of ['txt', 'h', 'iso', 'sub']) expect(ext).not.toContain(other);
    // A MIME type here would also claim that type for other programs' files on Linux.
    for (const association of associations) expect(association.mimeType).toBeUndefined();
    expect(associations.every((a) => a.role === 'Editor')).toBe(true);
  });

  it('keeps the content security policy: no network beyond the IPC', () => {
    expect(conf.app.security.csp['connect-src']).toEqual(['ipc:', 'http://ipc.localhost']);
    expect(conf.app.security.csp['default-src']).toBe("'self'");
  });

  it('every built-in profile extension that is registered is one the profiles claim', () => {
    const claimed = new Set<string>();
    for (const file of ['fanuc-gcode', 'fanuc-lathe', 'heidenhain-klartext', 'okuma-osp', 'sinumerik', 'sinumerik-mill']) {
      let profile: any;
      try {
        profile = json(`src/lib/data/profiles/${file}.json`);
      } catch {
        continue;
      }
      collect(profile, claimed);
    }
    const registered = (conf.bundle.fileAssociations as { ext: string[] }[]).flatMap((a) => a.ext);
    for (const e of registered) expect(claimed.has(e), e).toBe(true);
  });
});

describe('the single running instance', () => {
  const lib = read('src-tauri/src/lib.rs');
  const open = read('src-tauri/src/open_requests.rs');
  const cargo = read('src-tauri/Cargo.toml');

  it('is registered on Windows and Linux only, first, and on Linux only with a session bus', () => {
    expect(lib).toContain('#[cfg(any(windows, target_os = "linux"))]\n    let builder = if open_requests::single_instance_possible() {\n        builder.plugin(open_requests::single_instance_plugin())');
    const register = lib.indexOf('open_requests::single_instance_plugin()');
    expect(register).toBeGreaterThan(0);
    expect(register).toBeLessThan(lib.indexOf('tauri_plugin_fs::init()'));
    // Nothing else names the plugin crate.
    expect(lib).not.toContain('tauri_plugin_single_instance');
    expect(open).toContain('dbus_session_available(');
  });

  it('is a dependency of those two platforms alone, on the 2.4 line', () => {
    expect(cargo).toContain('[target.\'cfg(any(windows, target_os = "linux"))\'.dependencies]\ntauri-plugin-single-instance = "~2.4.5"');
    expect(cargo.match(/tauri-plugin-single-instance/g)?.length).toBe(1);
  });

  it('the first process meets its own arguments once, when the app is ready, through the same checks', () => {
    const open = read('src-tauri/src/open_requests.rs');
    expect(lib).toContain('if matches!(event, RunEvent::Ready) {\n        open_requests::started_with(app);');
    expect(lib.split('open_requests::started_with(').length - 1).toBe(1);
    expect(open).toContain('second_instance(app, args, cwd);');
  });

  it('the macOS door is the Opened event, the others the plugin callback', () => {
    expect(lib).toContain('RunEvent::Opened { urls }');
    expect(open).toContain('#[cfg(any(windows, target_os = "linux"))]\npub fn second_instance');
    expect(open).toContain('#[cfg(target_os = "macos")]\npub fn opened');
  });

  it('keeps the two anchors of the runtime harness exactly once each', () => {
    expect(lib.split('tauri::Builder::default()').length - 1).toBe(1);
    expect(lib.split('generate_handler![').length - 1).toBe(1);
  });

  it('is in the licence list as Apache-2.0 OR MIT', () => {
    const licenses = json('src/lib/data/licenses.json');
    const entry = (licenses.packages as { name: string; license: string }[]).find((p) => p.name === 'tauri-plugin-single-instance');
    expect(entry?.license).toBe('Apache-2.0 OR MIT');
  });
});

describe('the folder commands', () => {
  const lib = read('src-tauri/src/lib.rs');
  const folders = read('src-tauri/src/folders.rs');

  it('are the four of the plan, each registered once', () => {
    for (const name of ['folder_search', 'folder_search_cancel', 'folder_siblings', 'folder_grant']) {
      expect(lib.split(`folders::${name},`).length - 1, name).toBe(1);
      expect(folders).toContain(`fn ${name}(`);
    }
    expect(lib.split('open_requests::open_requests_ready,').length - 1).toBe(1);
  });

  it('use no network, no process and no new crate', () => {
    for (const forbidden of ['std::process', 'std::net', 'reqwest', 'tokio::net']) expect(folders).not.toContain(forbidden);
  });
});

describe('the files the system opens (S7)', () => {
  // The code above the test module: what the reviewer reads.
  const source = read('src-tauri/src/open_requests.rs');
  const code = source.slice(0, source.indexOf('#[cfg(test)]\nmod tests'));

  it('hands over the arguments after the executable, to the blocking pool, never on the plugin thread', () => {
    expect(code).toContain('handle(&app, args.get(1..).unwrap_or_default(), Some(&cwd), 0)');
    expect(code).toContain('tauri::async_runtime::spawn_blocking(move || handle(&app, &texts, None, refused))');
  });

  it('grants a file only through state::grant_file, after the checks, and nowhere else', () => {
    expect(code.split('state::grant_file(').length - 1).toBe(1);
    expect(code.indexOf('check_arguments(args')).toBeLessThan(code.indexOf('state::grant_file('));
    expect(code).not.toMatch(/allow_directory|allow_file|fs_scope/);
  });

  it('sends the webview only the paths and the number refused, in one place', () => {
    expect(code.split('app.emit(').length - 1).toBe(1);
    expect(code).toContain('app.emit(EVENT, Payload { paths, refused })');
    expect(code).toMatch(/struct Payload \{\n {4}paths: Vec<String>,\n {4}refused: u32,\n\}/);
  });

  it('uses no process, no network, no environment and no working folder of its own', () => {
    for (const forbidden of ['std::process', 'std::net', 'reqwest', 'set_current_dir', 'env::var_os', 'env::vars']) expect(code).not.toContain(forbidden);
    // The environment is read for the session bus lookup (through the injected `var`) and the
    // process's own arguments and folder, which a file manager sets when it starts gEdit with a file.
    expect(code.match(/std::env::\w+/g)).toEqual(['std::env::var', 'std::env::args_os', 'std::env::current_dir']);
  });

  it('keeps the limits of the plan', () => {
    expect(code).toContain('pub const MAX_PATHS: usize = 32;');
    expect(code).toContain('pub const MAX_ARG_CHARS: usize = 4096;');
    expect(code).toContain('pub const MAX_PENDING: usize = 64;');
    // An option is refused, not interpreted.
    expect(code).toContain("arg.starts_with('-')");
  });

  it('is received by one contribution that listens before it asks, and the event name is the plan\'s', () => {
    const contrib = read('src/lib/contrib/openRequests.ts');
    expect(contrib.indexOf('await deps.listen(')).toBeGreaterThan(0);
    expect(contrib.indexOf('await deps.listen(')).toBeLessThan(contrib.indexOf('await deps.ready()'));
    expect(read('src/lib/platform/commands.ts')).toContain("OPEN_REQUESTS_EVENT = 'gedit-open-requests'");
    expect(code).toContain('pub const EVENT: &str = "gedit-open-requests";');
  });
});
