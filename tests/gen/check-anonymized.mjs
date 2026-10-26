#!/usr/bin/env node
// Lists what looks personal in a program the owner is thinking of publishing (plan §9.2).
// Written by the M6 prelude (P6); **FX owns it afterwards**.
//
// It is a **reading aid, not a filter**. It never rewrites a file, never moves one and
// never says "this is safe": it prints the lines worth a second look, and the owner
// decides, file by file. A tool that promised to anonymize would be trusted, and the one
// comment it missed would be public for ever.
//
// Codes, numbers, spacing, encoding, line endings and a NUL leader are left exactly as
// they are — a published fixture has to be byte-identical to what the control ran.
//
//   node tests/gen/check-anonymized.mjs <files…>
//
// Exit code 0 when nothing was flagged, 1 when something was, 2 when it could not read a
// file. The output names the file the user passed in and its line numbers, which is the
// point here: this runs on the owner's own machine, on files they chose.

import { readFileSync } from 'node:fs';

/**
 * What is worth a second look, and why. The wording is what the owner reads.
 *
 * `in` says where the rule looks. A part number or a customer reference is written by a
 * person, so it matters in a comment or a string; the same letters followed by digits in
 * a block are a cycle number, a label or a swivel angle (`CYCL DEF 200`, `LBL 100`,
 * `CYCLE832`), which every program has and none of which is personal (T176). The rest
 * look at the whole line.
 *   'comment' = the text of comments and strings, 'line' = the whole line, 'name' = the program
 *   name a header line carries (see `programNameOf`).
 */
const RULES = [
  { id: 'name', in: 'line', what: 'a word that reads like a person or a company', re: /\b(?:GmbH|AG|Ltd|Inc|Co\.?KG|S\.?A\.?|B\.?V\.?)\b/i },
  { id: 'customer', in: 'line', what: 'a customer, order or drawing reference', re: /\b(?:KUNDE|CUSTOMER|AUFTRAG|ORDER|ZEICHNUNG|DRAWING|ARTIKEL|PART\s*NO|TEILE?NR)\b/i },
  { id: 'partNumber', in: 'comment', what: 'something shaped like a part number in a comment or a string', re: /\b([A-Z]{2,})[-_ ]?\d{3,}(?:[-_ ]\d+)*\b/g },
  // WX-CODE-5: the name of the program is data, not a comment, and a part number is as likely to be there as in a comment.
  { id: 'programName', in: 'name', what: 'a program name shaped like a part number', re: /(?<![A-Za-z])([A-Za-z]{2,})[-_ ]?\d{3,}(?:[-_ ]\d+)*(?!\d)/ },
  { id: 'date', in: 'line', what: 'a date', re: /\b\d{1,4}[.\-/]\d{1,2}[.\-/]\d{2,4}\b/ },
  { id: 'path', in: 'line', what: 'a file path or a share', re: /(?:[A-Za-z]:\\|\\\\[A-Za-z0-9_.-]+\\|\/(?:Users|home|Volumes)\/)/ },
  { id: 'email', in: 'line', what: 'an e-mail address', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { id: 'phone', in: 'line', what: 'a telephone number', re: /(?:\+\d{1,3}[\s/-]?)?(?:\(?\d{2,5}\)?[\s/-]){1,2}\d{3,}/ },
  { id: 'nonAscii', in: 'line', what: 'a non-ASCII word, often a name', re: /[^\p{ASCII}]/u },
  { id: 'header', in: 'line', what: 'a program header that carries the machine or the post', re: /^\s*(?:\$[^%]*%|%_N_\w+)/ },
  // Last, so a line that already says something more specific is not reported twice.
  { id: 'string', in: 'strings', what: 'text in a string: a name, a message or a file name', re: /[A-Za-z]{3,}/ },
];

/**
 * Words an NC program is made of: a keyword followed by a number is a cycle, a label or
 * a call, not a part number. Only used by the part-number rule.
 */
const NC_WORDS = new Set([
  'LBL', 'CYCL', 'CYCLE', 'DEF', 'CALL', 'PGM', 'TOOL', 'PLANE', 'SPA', 'SPB', 'SPC', 'CP', 'IPA', 'FN', 'QL', 'QR', 'QS',
  'MCALL', 'MSG', 'TRAORI', 'TRANS', 'ROT', 'SCALE', 'MIRROR', 'SETM', 'WAITM', 'WAITE', 'STOPRE', 'SUPA', 'DIAMON',
  'DIAMOF', 'LIMS', 'POCKET', 'SLOT', 'HOLES', 'CIRCLE', 'FRAME', 'MILL', 'DRILL', 'THREAD', 'SPOS', 'SPOSA', 'COUPDEL',
]);

/**
 * Everything a comment holds, in the dialects P1 ships: `(...)` as a comment, `;` to the
 * end of the line, and a Klartext `*` line. A `(` that follows a letter or a digit is the
 * argument list of a function or a cycle (`CYCLE832(…)`), not a comment.
 */
const COMMENT = /(?<![A-Za-z0-9_$])\([^)]*\)|;[^\r\n]*|^\s*(?:\d+\s+)?\*[^\r\n]*/g;

/** A double-quoted string, as Klartext, Sinumerik and the lathe dialects write it. */
const STRING = /"([^"\r\n]*)"/g;

/**
 * The program name a line carries, or null: a Klartext `BEGIN PGM name MM` or `END PGM name MM`
 * (with or without a block number) and a Fanuc `<name>`. The Okuma header (`%_N_name_MPF`-like
 * and `$name.MIN%`) and the Sinumerik header have their own rule (`header`) and are not read here.
 * @param {string} line
 */
function programNameOf(line) {
  const klartext = /^\s*(?:\d+\s+)?(?:BEGIN|END)\s+PGM\s+(\S+)/i.exec(line);
  if (klartext !== null) return klartext[1];
  const fanuc = /^\s*(?:N\d+\s+)?<([^<>\r\n]+)>/.exec(line);
  return fanuc === null ? null : fanuc[1];
}

/**
 * The parts of one line a rule can look at.
 * @param {string} line
 */
function partsOf(line) {
  const comments = line.match(COMMENT) ?? [];
  const code = line.replace(COMMENT, ' ');
  const strings = [...code.matchAll(STRING)].map((match) => match[1]);
  return { comment: [...comments, ...strings].join(' '), strings: strings.join(' '), name: programNameOf(line) ?? '' };
}

/**
 * True when `rule` fires on this line.
 * @param {(typeof RULES)[number]} rule
 * @param {string} line
 * @param {{ comment: string, strings: string, name: string }} parts
 */
function fires(rule, line, parts) {
  const text = rule.in === 'line' ? line : rule.in === 'strings' ? parts.strings : rule.in === 'name' ? parts.name : parts.comment;
  if (text === '') return false;
  if (rule.id === 'programName') {
    const found = rule.re.exec(text);
    return found !== null && !NC_WORDS.has(found[1].toUpperCase());
  }
  if (rule.id !== 'partNumber') return rule.re.test(text);
  // A keyword and its number is a cycle or a label, not a part number.
  for (const match of text.matchAll(rule.re)) {
    if (!NC_WORDS.has(match[1])) return true;
  }
  return false;
}

/** @param {string} text */
function findings(text) {
  /** @type {{ line: number, rule: string, what: string, text: string }[]}  */
  const out = [];
  const lines = text.split(/\r\n|\r|\n/);
  lines.forEach((line, index) => {
    const parts = partsOf(line);
    for (const rule of RULES) {
      if (fires(rule, line, parts)) {
        out.push({ line: index + 1, rule: rule.id, what: rule.what, text: line.trim() });
        break;
      }
    }
  });
  return out;
}

/**
 * The text of the comments on a line, or null when it has none.
 * @param {string} line
 */
export function commentTextOf(line) {
  const found = line.match(COMMENT);
  return found === null ? null : found.join(' ');
}

/** @param {string} text */
export function checkText(text) {
  return findings(text);
}

/** @param {string[]} argv */
function main(argv) {
  const files = argv.slice(2);
  if (files.length === 0) {
    console.error('usage: node tests/gen/check-anonymized.mjs <files…>');
    return 2;
  }
  let flagged = 0;
  for (const file of files) {
    let text;
    try {
      // latin1: the point is to read every byte as a character, whatever the encoding is,
      // so a cp1252 umlaut in a name is still found.
      text = readFileSync(file, 'latin1');
    } catch (err) {
      console.error(`${file}: could not be read (${err instanceof Error ? err.message : String(err)})`);
      return 2;
    }
    const found = findings(text);
    if (found.length === 0) {
      console.log(`${file}: nothing flagged — your call, not the tool's`);
      continue;
    }
    flagged += found.length;
    console.log(`${file}: ${found.length} line(s) worth a second look`);
    for (const entry of found) {
      console.log(`  line ${entry.line}: ${entry.what}`);
      console.log(`    ${entry.text}`);
    }
  }
  if (flagged > 0) {
    console.log('');
    console.log('Nothing was changed. Decide per file whether it may be public; only then');
    console.log('copy it byte for byte to tests/fixtures/nc/owner-public/<profileId>/ and');
    console.log('add its line to tests/fixtures/README.md.');
  }
  return flagged > 0 ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv));
