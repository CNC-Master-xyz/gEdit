#!/usr/bin/env node
// Fails when the licences of the shipped third-party code are not exactly the ones this
// project has agreed to (T203).
//
//   node scripts/check-license-list.mjs [--file src/lib/data/licenses.json]
//
// `npm run licenses:check` proves that the notices shown in About match the lockfiles; it
// does not look at *which* licences they are. A new dependency under a licence nobody read
// (a GPL, a "see license file", an expression with a new twist) would be added to the file
// and pass. This check pins the set: every package's licence expression has to be one of
// ALLOWED, written exactly as `gen-licenses.mjs` normalizes it, and every entry of ALLOWED
// has to be in use, so the list never allows more than the app ships.
//
// When it fails for a new expression: read the licence of the package it names, decide
// whether gEdit (MIT) may ship it, and only then add the expression here, in the same commit
// as the dependency. When it fails for an unused entry: delete the entry.
//
// Reads the generated file only (no `cargo`, no `npm`), so it runs in a second.
//
// Exit code 0: exact, 1: a difference, 2: the file could not be read.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_FILE = join(root, "src/lib/data/licenses.json");

/**
 * The licence expressions the app may ship, exactly as they stand in `licenses.json`
 * (SPDX, `OR` for a choice, `AND` when every part applies). Sorted. A choice is acceptable
 * when at least one of its options is a permissive licence we can comply with.
 */
export const ALLOWED = [
  "(MIT OR Apache-2.0) AND Unicode-3.0",
  "(MPL-2.0 OR Apache-2.0)",
  "0BSD OR MIT OR Apache-2.0",
  "Apache-2.0",
  "Apache-2.0 AND MIT",
  "Apache-2.0 OR MIT",
  "Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT",
  "BSD-3-Clause",
  "BSD-3-Clause AND MIT",
  "BSD-3-Clause OR MIT",
  "BSD-3-Clause OR MIT OR Apache-2.0",
  "CC0-1.0 OR MIT-0 OR Apache-2.0",
  "ISC",
  "MIT",
  "MIT OR Apache-2.0",
  "MIT OR Apache-2.0 OR LGPL-2.1-or-later",
  "MIT OR Apache-2.0 OR Zlib",
  "MIT OR Zlib OR Apache-2.0",
  "MPL-2.0",
  "OFL-1.1",
  "Unicode-3.0",
  "Unlicense OR MIT",
  "Zlib",
  "Zlib OR Apache-2.0 OR MIT",
];

/**
 * Compares the licences of a `licenses.json` with the allowed list.
 * @param {{ packages: { name: string, version: string, license: string, source: string, textId: string }[], texts: Record<string, string> }} data
 * @param {readonly string[]} [allowed]
 * @returns {{ unlisted: { license: string, packages: string[] }[], unused: string[], noText: string[] }}
 */
export function checkLicenses(data, allowed = ALLOWED) {
  /** @type {Map<string, string[]>} */
  const used = new Map();
  const noText = [];
  for (const pkg of data.packages) {
    const names = used.get(pkg.license) ?? [];
    names.push(`${pkg.name}@${pkg.version} (${pkg.source})`);
    used.set(pkg.license, names);
    if (!pkg.textId || !(pkg.textId in data.texts)) noText.push(`${pkg.name}@${pkg.version}`);
  }
  const allowedSet = new Set(allowed);
  const unlisted = [...used]
    .filter(([license]) => !allowedSet.has(license))
    .map(([license, packages]) => ({ license, packages }))
    .sort((a, b) => (a.license < b.license ? -1 : 1));
  const unused = [...allowedSet].filter((license) => !used.has(license)).sort();
  return { unlisted, unused, noText };
}

/** @param {string[]} argv */
function main(argv) {
  const at = argv.indexOf("--file");
  const file = at >= 0 ? resolve(argv[at + 1] ?? "") : DEFAULT_FILE;
  if (!existsSync(file)) {
    console.error(`${file} does not exist. Run \`npm run licenses\` first.`);
    return 2;
  }
  let data;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`${file} could not be read: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  if (!Array.isArray(data.packages) || typeof data.texts !== "object" || data.texts === null) {
    console.error(`${file} does not look like a licenses file (packages and texts expected).`);
    return 2;
  }
  const { unlisted, unused, noText } = checkLicenses(data);
  for (const { license, packages } of unlisted) {
    const shown = packages.slice(0, 3).join(", ") + (packages.length > 3 ? `, and ${packages.length - 3} more` : "");
    console.error(`licence not on the list: "${license}" — ${shown}`);
  }
  for (const license of unused) console.error(`on the list but no package uses it: "${license}"`);
  for (const name of noText) console.error(`no licence text for ${name}`);
  const problems = unlisted.length + unused.length + noText.length;
  if (problems > 0) {
    console.error("The list is ALLOWED in scripts/check-license-list.mjs: read the licence, then add or remove the entry.");
    return 1;
  }
  console.log(`The licences are exactly the agreed ${ALLOWED.length} expressions (${data.packages.length} packages).`);
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exit(main(process.argv));
