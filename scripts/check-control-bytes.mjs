#!/usr/bin/env node
// Fails when a text file of the repository holds a NUL or another control character that
// is not meant to be there (T199).
//
//   node scripts/check-control-bytes.mjs                  every tracked text file of the repository
//   node scripts/check-control-bytes.mjs --root <folder>  every file under a folder (not a Git checkout)
//   node scripts/check-control-bytes.mjs <file…>          just these files
//
// Why a script: the check used to be a `grep` in a workflow step. `grep -P` is not on
// macOS and a pattern with `\x00` does not work the same in every grep, so the step could
// pass on a machine where it had looked at nothing. This reads the bytes itself, and runs
// the same on Linux, macOS and Windows with Node alone (no dependency, like the other
// scripts here).
//
// What counts: NUL, the other C0 control characters except tab, line feed and carriage
// return, DEL, and the Unicode bidirectional controls (U+202A..202E, U+2066..2069), which
// can make source read differently from what it does. A file in UTF-16 is not text for this
// purpose and would be reported; no tracked source is UTF-16.
//
// What is left out: binary files by extension, and every path that `.gitattributes` marks
// `-text` — the test fixtures, whose bytes are exact on purpose (a NUL tape leader, CR-only
// line ends, UTF-16). `ALLOWED` lists the few places a control character is meant to be in a
// source file; each has a reason.
//
// Exit code 0: clean, 1: something found, 2: a file could not be read.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Not text: never scanned. */
const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "icns", "bmp",
  "woff", "woff2", "ttf", "otf", "eot",
  "pdf", "zip", "gz", "tgz", "7z", "wasm", "dmg", "exe", "dll", "node",
]);

/**
 * Files that carry a control character on purpose, as `path -> { bytes, why }`. Only the
 * listed bytes are let through; any other control character in the same file is still reported.
 */
/** @type {Record<string, { bytes: number[], why: string }>} */
export const ALLOWED = {};

/**
 * A readable name for a byte or a character, for the message.
 * @param {number} code
 */
function nameOf(code) {
  if (code === 0) return "a NUL byte";
  if (code === 0x7f) return "a DEL character";
  if (code >= 0x202a) return `a bidirectional control (U+${code.toString(16).toUpperCase()})`;
  return `a control character (0x${code.toString(16).padStart(2, "0")})`;
}

/**
 * The control characters in a file's bytes, each with its line (counted in LF, CR and
 * CR LF the way an editor does) and how often it occurs. Pure: no file access.
 *
 * @param {Uint8Array} bytes
 * @returns {{ code: number, line: number, count: number }[]}
 */
export function scanBytes(bytes) {
  /** @type {Map<number, { code: number, line: number, count: number }>} */
  const found = new Map();
  let line = 1;
  const note = (/** @type {number} */ code) => {
    const entry = found.get(code);
    if (entry) entry.count++;
    else found.set(code, { code, line, count: 1 });
  };
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === 0x0a) line++;
    else if (byte === 0x0d) {
      if (bytes[i + 1] !== 0x0a) line++;
    } else if (byte === 0x09) {
      // a tab
    } else if (byte < 0x20 || byte === 0x7f) {
      note(byte);
    } else if (byte === 0xe2) {
      // The bidirectional controls U+202A..202E and U+2066..2069 are E2 80 AA..AE and E2 81 A6..A9.
      const code = 0x2000 | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      if ((bytes[i + 1] & 0xc0) === 0x80 && ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069))) {
        note(code);
      }
    }
  }
  return [...found.values()];
}

/**
 * Whether a path is excluded by a `-text` line of `.gitattributes` (`folder/**` or a file).
 * @param {string} relPath
 * @param {string} attributesText
 */
export function binaryByAttributes(relPath, attributesText) {
  for (const raw of attributesText.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const [pattern, ...attrs] = line.split(/\s+/);
    if (!attrs.includes("-text") && !attrs.includes("binary")) continue;
    if (pattern.endsWith("/**")) {
      if (relPath.startsWith(pattern.slice(0, -2))) return true;
    } else if (pattern === relPath) {
      return true;
    }
  }
  return false;
}

/**
 * The problems of one file as readable lines, or an empty list.
 * @param {string} relPath  forward slashes, relative to the root
 * @param {Uint8Array} bytes
 * @param {Record<string, { bytes: number[], why: string }>} [allowList] the exceptions (default: ALLOWED)
 */
export function problemsIn(relPath, bytes, allowList = ALLOWED) {
  const allowed = allowList[relPath]?.bytes ?? [];
  /** @type {string[]} */
  const out = [];
  for (const entry of scanBytes(bytes)) {
    if (allowed.includes(entry.code)) continue;
    const times = entry.count === 1 ? "" : ` (${entry.count} times; first one shown)`;
    out.push(`${relPath}:${entry.line}: ${nameOf(entry.code)}${times}`);
  }
  return out;
}

/** @param {string} root */
function trackedFiles(root) {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return out.split("\0").filter(Boolean);
}

const SKIP_FOLDERS = new Set([".git", "node_modules", "target", "build", ".svelte-kit", ".perf"]);

/**
 * @param {string} root
 * @param {string} [dir]
 * @returns {string[]}
 */
function walk(root, dir = root) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_FOLDERS.has(entry.name) ? [] : walk(root, path);
    return entry.isFile() ? [relative(root, path).split(sep).join("/")] : [];
  });
}

/**
 * Scans a set of files under `root`.
 * @param {string} root
 * @param {string[]} files  relative paths with forward slashes
 * @param {{ skipAttributes?: boolean }} [options]
 * @returns {{ problems: string[], scanned: number, unreadable: string[] }}
 */
export function scanFiles(root, files, { skipAttributes = true } = {}) {
  const attrsPath = join(root, ".gitattributes");
  const attributes = skipAttributes && existsSync(attrsPath) ? readFileSync(attrsPath, "utf8") : "";
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const unreadable = [];
  let scanned = 0;
  for (const rel of files) {
    const ext = rel.includes(".") ? rel.slice(rel.lastIndexOf(".") + 1).toLowerCase() : "";
    if (BINARY_EXTENSIONS.has(ext)) continue;
    if (attributes && binaryByAttributes(rel, attributes)) continue;
    let bytes;
    try {
      if (!statSync(join(root, rel)).isFile()) continue;
      bytes = readFileSync(join(root, rel));
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err)?.code === "ENOENT") continue; // tracked but deleted in the working tree
      unreadable.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    scanned++;
    problems.push(...problemsIn(rel, bytes));
  }
  return { problems, scanned, unreadable };
}

/** @param {string[]} argv */
function main(argv) {
  const args = argv.slice(2);
  let root = repoRoot;
  let files;
  const rootAt = args.indexOf("--root");
  if (rootAt >= 0) {
    root = resolve(args[rootAt + 1] ?? ".");
    files = walk(root);
  } else if (args.length > 0) {
    files = args.map((/** @type {string} */ arg) => relative(root, resolve(arg)).split(sep).join("/"));
  } else {
    files = trackedFiles(root);
  }
  const { problems, scanned, unreadable } = scanFiles(root, files);
  for (const line of unreadable) console.error(`could not read ${line}`);
  if (unreadable.length > 0) return 2;
  if (problems.length > 0) {
    for (const line of problems) console.error(line);
    console.error(`${problems.length} problem(s) in ${scanned} text file(s). A control character in a source file is almost always a paste accident;`);
    console.error("if one is meant to be there, list it in ALLOWED in scripts/check-control-bytes.mjs with the reason.");
    return 1;
  }
  console.log(`No NUL or control characters in ${scanned} text files.`);
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exit(main(process.argv));
