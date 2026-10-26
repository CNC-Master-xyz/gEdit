#!/usr/bin/env node
// Fails when the production frontend bundle holds code the Content Security Policy blocks,
// or the test hook (T202).
//
//   node scripts/check-bundle.mjs [folder]     the folder defaults to build/
//
// The CSP (`src-tauri/tauri.conf.json`) has no `unsafe-eval`: a string turned into code
// fails at run time, in the release build only, where nobody is looking. This reads every
// script of the build and looks for the ways to do it:
//
//   eval(…) and Function(…) / new Function(…)         the direct forms
//   (0, eval)(…)                                      indirect eval, what bundlers and minifiers write
//   window.eval(…), globalThis["eval"](…), self.eval  the same through the global object
//   eval.call(…), eval.apply(…), eval.bind(…)         eval used as a value
//   x = eval;                                         eval handed on to be called later
//   setTimeout("code"), setInterval("code")           a timer given a string
//   .constructor.constructor("code")                  the Function constructor reached by hand
//
// The word `eval` on its own is not an error: Monaco's language data lists it as a keyword.
// Only the forms that run it are. The check is text, not a parse, so it can be wrong in both
// directions; `tests/unit/checkBundle.test.ts` pins what it must catch and what it must leave
// alone, and the CI step runs it on the real build.
//
// It also looks for `__gedit`, the test hook the runtime harness patches into its own copy
// of the app; the production bundle must not carry it.
//
// Exit code 0: clean, 1: something found, 2: nothing to scan or a file could not be read.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

/** Script files of a build. HTML is read too: an inline script is a script. */
const SCRIPT_FILE = /\.(?:[cm]?js|html?)$/i;

/** The part of an expression that can stand in front of `eval` or `Function` without making it a call of the global. */
const NOT_A_MEMBER = "(?<![a-zA-Z0-9_.$])";
const GLOBALS = "(?:window|self|globalThis|global|top|parent|frames)";

/**
 * Each rule is a regular expression over a whole file and the reason shown. Order does not
 * matter; every rule is tried and each match is reported once.
 */
export const RULES = [
  { id: "eval", why: "eval(…) is blocked by the CSP", re: new RegExp(`${NOT_A_MEMBER}eval\\s*\\(`, "g") },
  { id: "Function", why: "Function(…) and new Function(…) are blocked by the CSP", re: new RegExp(`${NOT_A_MEMBER}Function\\s*\\(`, "g") },
  { id: "indirect eval", why: "indirect eval, (0, eval)(…), is blocked by the CSP", re: /,\s*eval\s*\)\s*\(/g },
  {
    id: "global eval",
    why: "eval through the global object is blocked by the CSP",
    re: new RegExp(`${NOT_A_MEMBER}${GLOBALS}\\s*(?:\\?\\.|\\.)\\s*eval\\b|${NOT_A_MEMBER}${GLOBALS}\\s*\\??\\.?\\s*\\[\\s*["'\`]eval["'\`]\\s*\\]`, "g"),
  },
  { id: "global Function", why: "the Function constructor through the global object is blocked by the CSP", re: new RegExp(`${NOT_A_MEMBER}${GLOBALS}\\s*(?:\\?\\.|\\.)\\s*Function\\s*\\(`, "g") },
  { id: "eval as a value", why: "eval.call, eval.apply and eval.bind still run code the CSP blocks", re: new RegExp(`${NOT_A_MEMBER}eval\\s*\\.\\s*(?:call|apply|bind)\\b`, "g") },
  { id: "eval handed on", why: "eval stored or passed on is called later, by another name", re: new RegExp(`(?:[=(,:?]|=>|return|\\|\\||&&)\\s*${NOT_A_MEMBER}eval\\s*(?=[;,)}\\]])`, "g") },
  { id: "string timer", why: "a timer given a string runs it like eval, which the CSP blocks", re: /\bset(?:Timeout|Interval)\s*\(\s*["'`]/g },
  { id: "constructor chain", why: "the Function constructor reached through .constructor is blocked by the CSP", re: /\bconstructor\s*\.\s*constructor\s*\(|\.\s*constructor\s*\(\s*["'`]return\b/g },
  { id: "test hook", why: "the production bundle contains the test hook (__gedit)", re: /__gedit/g },
];

/**
 * Every match of every rule in a text, in order of position.
 * @param {string} text
 * @returns {{ id: string, why: string, index: number, snippet: string }[]}
 */
export function scanText(text) {
  const found = [];
  for (const rule of RULES) {
    for (const match of text.matchAll(rule.re)) {
      const start = Math.max(0, match.index - 25);
      const snippet = text.slice(start, match.index + match[0].length + 25).replace(/\s+/g, " ");
      found.push({ id: rule.id, why: rule.why, index: match.index, end: match.index + match[0].length, snippet });
    }
  }
  found.sort((a, b) => a.index - b.index);
  // One spelling can satisfy two rules (`(0,eval)(…)` is both indirect and handed on): report it once.
  let reachedTo = -1;
  return found
    .filter((hit) => {
      const overlaps = hit.index < reachedTo;
      reachedTo = Math.max(reachedTo, hit.end);
      return !overlaps;
    })
    .map(({ end, ...hit }) => hit);
}

/**
 * @param {string} text
 * @param {number} index
 */
function lineAndColumn(text, index) {
  let line = 1;
  let last = -1;
  for (let i = text.indexOf("\n"); i !== -1 && i < index; i = text.indexOf("\n", i + 1)) {
    line++;
    last = i;
  }
  return { line, column: index - last };
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return entry.isFile() && SCRIPT_FILE.test(entry.name) ? [path] : [];
  });
}

/**
 * Scans a build folder.
 * @param {string} dir
 * @returns {{ problems: string[], scanned: number }}
 */
export function scanBuild(dir) {
  /** @type {string[]} */
  const problems = [];
  const list = files(dir);
  for (const file of list) {
    const text = readFileSync(file, "utf8");
    for (const hit of scanText(text)) {
      const { line, column } = lineAndColumn(text, hit.index);
      const name = relative(dir, file).split(sep).join("/");
      problems.push(`${name}:${line}:${column}: ${hit.why} [${hit.id}]\n    …${hit.snippet}…`);
    }
  }
  return { problems, scanned: list.length };
}

/** @param {string[]} argv */
function main(argv) {
  const dir = resolve(argv[2] ?? "build");
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`${dir} is not a folder. Run \`npm run build\` first.`);
    return 2;
  }
  const { problems, scanned } = scanBuild(dir);
  if (scanned === 0) {
    console.error(`${dir} holds no script files; nothing was checked.`);
    return 2;
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    console.error(`${problems.length} problem(s) in ${scanned} script file(s).`);
    return 1;
  }
  console.log(`The bundle has no eval, no Function() and no test hook (${scanned} script files).`);
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exit(main(process.argv));
