// The IPC contract of the folder commands and the open requests (P4f prelude; plan section 6.8).
// The wrappers are the only callers, so pinning the command names, the argument shape and the
// limits here keeps the TS side and `src-tauri/src/{folders,open_requests}.rs` in step.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
class FakeChannel<T> {
  onmessage: ((message: T) => void) | null = null;
}
vi.mock('@tauri-apps/api/core', () => ({ invoke, Channel: FakeChannel }));

const {
  FOLDER_LIMITS,
  OPEN_REQUESTS_EVENT,
  folderGrant,
  folderSearch,
  folderSearchCancel,
  folderSiblings,
  openRequestsReady,
} = await import('./commands');

const read = (url: string): string => readFileSync(fileURLToPath(new URL(url, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

beforeEach(() => invoke.mockReset());

describe('the folder commands', () => {
  it('folder_search passes the request as `req` and the stream as `onEvent`', async () => {
    invoke.mockResolvedValue({ entriesSeen: 0 });
    const req = {
      id: 's-1',
      root: '/nc',
      recursive: true,
      namePatterns: ['*.nc'],
      modifiedAfter: null,
      modifiedBefore: null,
      contains: { text: 'T', caseSensitive: false },
    };
    await folderSearch(req, () => {});
    expect(invoke).toHaveBeenCalledTimes(1);
    const [name, args] = invoke.mock.calls[0];
    expect(name).toBe('folder_search');
    expect(args.req).toBe(req);
    expect(args.onEvent).toBeInstanceOf(FakeChannel);
  });

  it('pairs a file message with the raw message after it, and ignores a raw message with no file', async () => {
    invoke.mockResolvedValue({});
    const files: { rel: string; text: string }[] = [];
    const progress: number[][] = [];
    await folderSearch(
      { id: 's-1', root: '/nc', recursive: false, namePatterns: [], modifiedAfter: null, modifiedBefore: null, contains: null },
      (f) => files.push({ rel: f.rel, text: new TextDecoder().decode(f.data) }),
      (a, b) => progress.push([a, b]),
    );
    const channel = invoke.mock.calls[0][1].onEvent as FakeChannel<unknown>;
    const raw = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;
    channel.onmessage?.(raw('stray'));
    channel.onmessage?.({ kind: 'file', index: 0, path: '/nc/a.nc', rel: 'a.nc', bytes: 3, mtimeMs: 1 });
    channel.onmessage?.(raw('G0\n'));
    channel.onmessage?.({ kind: 'progress', entriesSeen: 4, filesRead: 1 });
    expect(files).toEqual([{ rel: 'a.nc', text: 'G0\n' }]);
    expect(progress).toEqual([[4, 1]]);
  });

  it('cancel, siblings, grant and the open requests use the names and arguments of the Rust side', async () => {
    invoke.mockResolvedValue(true);
    await folderSearchCancel('s-1');
    expect(invoke).toHaveBeenLastCalledWith('folder_search_cancel', { id: 's-1' });
    await folderSiblings('/nc/PART_CH1.nc', 'PART*');
    expect(invoke).toHaveBeenLastCalledWith('folder_siblings', { path: '/nc/PART_CH1.nc', pattern: 'PART*' });
    await folderGrant('/nc', '/nc/sub/a.nc');
    expect(invoke).toHaveBeenLastCalledWith('folder_grant', { root: '/nc', path: '/nc/sub/a.nc' });
    await openRequestsReady();
    expect(invoke).toHaveBeenLastCalledWith('open_requests_ready');
    expect(OPEN_REQUESTS_EVENT).toBe('gedit-open-requests');
  });
});

/** The value of a Rust constant of the form `pub const NAME: type = 16 * 1024;` */
function rustConst(source: string, name: string): number {
  const match = new RegExp(`pub const ${name}: \\w+ = ([0-9_ *]+);`).exec(source);
  if (match === null) throw new Error(`no constant ${name}`);
  return match[1].replace(/_/g, '').split('*').reduce((product, part) => product * Number(part.trim()), 1);
}

describe('the limits', () => {
  const folders = read('../../../src-tauri/src/folders.rs');
  const open = read('../../../src-tauri/src/open_requests.rs');
  const pairs: [keyof typeof FOLDER_LIMITS, string][] = [
    ['maxPathChars', 'MAX_PATH_CHARS'],
    ['maxDepth', 'MAX_DEPTH'],
    ['maxEntries', 'MAX_ENTRIES'],
    ['maxDirEntries', 'MAX_DIR_ENTRIES'],
    ['maxFilesRead', 'MAX_FILES_READ'],
    ['maxFileBytes', 'MAX_FILE_BYTES'],
    ['maxTotalBytes', 'MAX_TOTAL_BYTES'],
    ['maxSentBytes', 'MAX_SENT_BYTES'],
    ['maxSeconds', 'MAX_SECONDS'],
    ['binaryProbeBytes', 'BINARY_PROBE_BYTES'],
    ['maxPatterns', 'MAX_PATTERNS'],
    ['maxPatternChars', 'MAX_PATTERN_CHARS'],
    ['maxContainsBytes', 'MAX_CONTAINS_BYTES'],
    ['maxListedNames', 'MAX_LISTED_NAMES'],
    ['maxSiblingNames', 'MAX_SIBLING_NAMES'],
    ['minSiblingLiterals', 'MIN_SIBLING_LITERALS'],
  ];

  it.each(pairs)('%s is the Rust constant %s', (key, rustName) => {
    expect(FOLDER_LIMITS[key]).toBe(rustConst(folders, rustName));
  });

  it('the event name is the Rust one', () => {
    expect(open).toContain(`pub const EVENT: &str = "${OPEN_REQUESTS_EVENT}";`);
  });
});
