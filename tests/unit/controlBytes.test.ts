// Tests for scripts/check-control-bytes.mjs, the CI scan for NUL and other control
// characters in source files (T199). The scan replaced a `grep` step that could pass on
// macOS without having looked at anything.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ALLOWED, binaryByAttributes, problemsIn, scanBytes, scanFiles } from '../../scripts/check-control-bytes.mjs';

const SCRIPT = fileURLToPath(new URL('../../scripts/check-control-bytes.mjs', import.meta.url));
const REPO = fileURLToPath(new URL('../../', import.meta.url));

const bytes = (...parts: (string | number[])[]) =>
  Uint8Array.from(parts.flatMap((part) => (typeof part === 'string' ? [...Buffer.from(part, 'utf8')] : part)));

describe('scanBytes', () => {
  it('finds a NUL, and says on which line', () => {
    expect(scanBytes(bytes('one\ntwo\n', [0], 'x\n'))).toEqual([{ code: 0, line: 3, count: 1 }]);
  });

  it('finds the other control characters and DEL, and counts a repeat', () => {
    const found = scanBytes(bytes('a', [0x1b], 'b', [0x1b], [0x7f], '\n', [0x01]));
    expect(found).toEqual([
      { code: 0x1b, line: 1, count: 2 },
      { code: 0x7f, line: 1, count: 1 },
      { code: 0x01, line: 2, count: 1 },
    ]);
  });

  it('lets tab, line feed and carriage return through, in any line-end style', () => {
    expect(scanBytes(bytes('a\tb\r\nc\rd\ne\n'))).toEqual([]);
  });

  it('counts CR, LF and CR LF each as one line end', () => {
    expect(scanBytes(bytes('a\r\nb\rc\n', [0]))[0].line).toBe(4);
  });

  it('finds the bidirectional controls that can make source read differently from what it does', () => {
    const at = (code: number) => String.fromCodePoint(code);
    expect(scanBytes(bytes('x = "', at(0x202e), '";'))).toEqual([{ code: 0x202e, line: 1, count: 1 }]);
    expect(scanBytes(bytes(at(0x2066)))).toEqual([{ code: 0x2066, line: 1, count: 1 }]);
    // Ordinary non-ASCII text, the arrows and dashes of the docs, and the neighbours of the range are fine.
    expect(scanBytes(bytes('M' + at(0xfc) + 'ller ' + at(0x2192) + ' ' + at(0x2013) + ' ' + at(0x201c) + ' ' + at(0x2029) + at(0x2065) + at(0x202f)))).toEqual([]);
  });

  it('survives a truncated multi-byte sequence at the end', () => {
    expect(scanBytes(Uint8Array.from([0x61, 0xe2]))).toEqual([]);
    expect(scanBytes(Uint8Array.from([0xe2, 0x80]))).toEqual([]);
  });
});

describe('problemsIn', () => {
  it('names the file, the line and the character', () => {
    expect(problemsIn('src/a.ts', bytes('ok\n', [0], '\n'))).toEqual(['src/a.ts:2: a NUL byte']);
    expect(problemsIn('src/a.ts', bytes([0x1b]))).toEqual(['src/a.ts:1: a control character (0x1b)']);
    expect(problemsIn('src/a.ts', bytes([0, 0]))).toEqual(['src/a.ts:1: a NUL byte (2 times; first one shown)']);
  });

  it('lets through only the bytes a listed file is allowed to carry', () => {
    const path = 'tests/demo/keys.js';
    const list = { [path]: { bytes: [0x1b], why: 'a demo entry for this test' } };
    expect(problemsIn(path, bytes([0x1b]), list)).toEqual([]);
    expect(problemsIn(path, bytes([0]), list)).toEqual([`${path}:1: a NUL byte`]);
    expect(problemsIn('other/' + path, bytes([0x1b]), list)).toHaveLength(1);
    // Nothing in the repository needs an exception any more (keys.js writes \x1b and \x7f as escapes).
    expect(ALLOWED).toEqual({});
  });
});

describe('binaryByAttributes', () => {
  const attributes = ['# a comment', '* text=auto', '*.rs text eol=lf', 'tests/fixtures/** -text', 'docs/raw.bin -text', 'x/** binary'].join('\r\n');

  it('skips folders and files that .gitattributes marks -text or binary', () => {
    expect(binaryByAttributes('tests/fixtures/nc/a.nc', attributes)).toBe(true);
    expect(binaryByAttributes('docs/raw.bin', attributes)).toBe(true);
    expect(binaryByAttributes('x/y/z', attributes)).toBe(true);
  });

  it('keeps everything else', () => {
    expect(binaryByAttributes('tests/unit/a.ts', attributes)).toBe(false);
    expect(binaryByAttributes('tests/fixtures-not/a.nc', attributes)).toBe(false);
    expect(binaryByAttributes('src/a.rs', attributes)).toBe(false);
  });
});

describe('the command', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function tree(files: Record<string, Uint8Array | string>): string {
    const root = mkdtempSync(join(tmpdir(), 'gedit-bytes-'));
    dirs.push(root);
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, name)), { recursive: true });
      writeFileSync(join(root, name), content);
    }
    return root;
  }
  const run = (root: string) => spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });

  it('fails on a NUL in a source file, whatever the platform, and says where', () => {
    const root = tree({ 'src/a.ts': 'fine\n', 'src/b.ts': bytes('const x = 1;\n', [0], '\n') });
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('src/b.ts:2: a NUL byte');
    expect(result.stderr).not.toContain('src/a.ts');
  });

  it('passes on clean text, and says how many files it read', () => {
    const result = run(tree({ 'a.md': '# hi\r\n', 'b.json': '{}\n' }));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('2 text files');
  });

  it('does not read images or fonts, and does not read what .gitattributes marks -text', () => {
    const root = tree({
      '.gitattributes': 'tests/fixtures/** -text\n',
      'icon.png': bytes([0x89, 0x50, 0, 0, 0x1a]),
      'tests/fixtures/leader.nc': bytes([0, 0, 0], 'N10 G0\n'),
      'a.ts': 'ok\n',
    });
    const result = run(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('2 text files'); // .gitattributes itself and a.ts
  });

  it('scanFiles skips a file that is tracked but gone', () => {
    const root = tree({ 'a.ts': 'ok\n' });
    expect(scanFiles(root, ['a.ts', 'gone.ts'])).toEqual({ problems: [], scanned: 1, unreadable: [] });
  });
});

describe('the repository', () => {
  it('has no stray NUL or control character in a tracked text file', () => {
    const result = spawnSync(process.execPath, [SCRIPT], { cwd: REPO, encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
