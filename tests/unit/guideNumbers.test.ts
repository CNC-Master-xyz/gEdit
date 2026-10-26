// The numbers the user guide states (30 seconds, 14 days, 200 MB …) are the numbers in the
// code (T205).
//
// A guide that says "deleted after 14 days" is a promise about what the app does with
// someone's unsaved work. Each number here is read out of the guide's text and out of the
// source file that holds the constant, as text, so neither side can move alone: change a
// limit and this fails until the guide says so, and reword the guide to a different number
// and it fails the same way. A constant that is renamed or moved fails with its name, which
// is also the reminder to look at the sentence that quotes it.
//
// The constants are read from source (Rust and TypeScript) rather than imported, so the
// Rust ones are covered too and a TypeScript module with browser dependencies is not loaded.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string) => readFileSync(ROOT + rel, 'utf8').replace(/\r\n/g, '\n');

/** The guide as running text: line breaks and emphasis marks folded away. */
const GUIDE = read('docs/user/README.md')
  .replace(/\*\*|`/g, '')
  .replace(/\s+/g, ' ');

const MIB = 1024 * 1024;

/**
 * The value of `const NAME … = <expression>;` in a source file, for the integer and
 * arithmetic forms the constants here use (`64 * 1024 * 1024`, `Duration::from_secs(600)`,
 * `20000`, `0.1`), with other constants of the same file allowed in the expression.
 */
export function constantOf(rel: string, name: string): number {
  const source = read(rel);
  const found = new RegExp(`(?:^|\\s)const ${name}\\b[^=]*=\\s*([^;]+);`).exec(source);
  if (!found) throw new Error(`${rel}: no constant ${name}; if it moved, move the claim in guideNumbers.test.ts with it`);
  const tokens = found[1]
    .replace(/Duration::from_secs\(([^)]*)\)/g, '($1)')
    .replace(/\bas\s+\w+/g, '')
    .replace(/(\d)_(?=\d)/g, '$1')
    .match(/\d+(?:\.\d+)?|[A-Za-z_]\w*|[-+*/()]/g);
  if (!tokens) throw new Error(`${rel}: ${name} has no value`);
  let at = 0;
  const factor = (): number => {
    const token = tokens[at++];
    if (token === '(') {
      const inner = sum();
      at++; // the closing parenthesis
      return inner;
    }
    if (/^\d/.test(token)) return Number(token);
    if (/^[A-Za-z_]/.test(token)) return constantOf(rel, token);
    throw new Error(`${rel}: cannot read the value of ${name} (${found[1]})`);
  };
  const product = (): number => {
    let value = factor();
    while (tokens[at] === '*' || tokens[at] === '/') value = tokens[at++] === '*' ? value * factor() : value / factor();
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (tokens[at] === '+' || tokens[at] === '-') value = tokens[at++] === '+' ? value + product() : value - product();
    return value;
  };
  return sum();
}

const WORDS: Record<string, number> = { two: 2 };
const asNumber = (text: string) => WORDS[text] ?? Number(text.replace(/,/g, ''));

/** Every number the guide gives where `pattern` matches (its first group), at least `min` times. */
function stated(pattern: RegExp, min = 1): number[] {
  const numbers = [...GUIDE.matchAll(new RegExp(pattern.source, 'g'))].map((match) => asNumber(match[1]));
  if (numbers.length < min) throw new Error(`the guide no longer says ${pattern}; update the claim in guideNumbers.test.ts with the sentence`);
  return numbers;
}

const RECOVERY_TS = 'src/lib/app/recovery.ts';
const RECOVERY_RS = 'src-tauri/src/recovery.rs';
const BACKUP_RS = 'src-tauri/src/backup.rs';

/** [what the guide says, a pattern whose first group is the number, how often, where the constant is, its name, the unit divisor] */
const CLAIMS: [string, RegExp, number, string, string, number][] = [
  ['snapshot interval', /writes its text aside every (\d+) seconds/, 1, RECOVERY_TS, 'SNAPSHOT_INTERVAL_MS', 1000],
  ['what a crash costs', /(?:At worst|up to) the last (\d+) seconds of typing/, 2, RECOVERY_TS, 'SNAPSHOT_INTERVAL_MS', 1000],
  ['heartbeat', /touches a file every (\d+) seconds/, 1, RECOVERY_RS, 'HEARTBEAT_SECS', 1],
  ['silence that counts as a crash', /silent for (\w+) minutes? counts as crashed/, 1, RECOVERY_RS, 'STALE_AFTER_SECS', 60],
  ['snapshot expiry', /deleted after (\d+) days/, 1, RECOVERY_RS, 'PRUNE_AFTER_DAYS', 1],
  ['recovery folder cap', /capped at (\d+) MB/, 1, RECOVERY_RS, 'MAX_TOTAL_BYTES', MIB],
  ['largest snapshot', /grown past (\d+) MB/, 1, RECOVERY_RS, 'MAX_BODY_BYTES', MIB],
  ['backup cleanup interval', /look(?:s)? for copies to delete at most every (\d+) minutes/, 1, BACKUP_RS, 'SWEEP_INTERVAL', 60],
  ['file name limit', /counts that limit as (\d+) bytes/, 1, BACKUP_RS, 'MAX_COMPONENT', 1],
  ['largest file that opens', /(?:A file above|Files above) (\d+) MB (?:is|are) refused/, 2, 'src/lib/app/fileOps.ts', 'MAX_OPEN_BYTES', MIB],
  ['files remembered', /kept for the last (\d+) files/, 1, 'src/lib/stores/fileMemory.ts', 'MAX_REMEMBERED_FILES', 1],
  ['bookmarks remembered per file', /at most (\d+) bookmarks each/, 1, 'src/lib/stores/fileMemory.ts', 'MAX_REMEMBERED_BOOKMARKS', 1],
  ['memo budget', /all the memos together are kept under (\d+) KB/, 1, 'src/lib/stores/fileMemory.ts', 'MAX_REMEMBERED_BYTES', 1024],
  ['longest line looked at while typing', /A line of more than ([\d,]+) characters is not looked at/, 1, 'src/lib/contrib/typing.ts', 'MAX_TYPING_LINE', 1],
  ['NUL share of a data file', /NUL bytes \*inside\* the program .{0,60}? are more than (\d+) % of those bytes/, 1, 'src/lib/core/text/codec.ts', 'MAX_INNER_NUL_SHARE', 0.01],
];

describe('the guide states the numbers the code uses', () => {
  it.each(CLAIMS)('%s', (_what, pattern, min, file, name, unit) => {
    const expected = constantOf(file, name) / unit;
    const numbers = stated(pattern, min);
    expect(numbers.length).toBeGreaterThanOrEqual(min);
    for (const number of numbers) expect(number, `${name} is ${expected} in ${file}`).toBeCloseTo(expected, 6);
  });
});

describe('constantOf', () => {
  it('reads a Rust product, a duration, a TypeScript product and a fraction', () => {
    expect(constantOf(RECOVERY_RS, 'MAX_TOTAL_BYTES')).toBe(200 * MIB);
    expect(constantOf(BACKUP_RS, 'SWEEP_INTERVAL')).toBe(600);
    expect(constantOf('src/lib/app/fileOps.ts', 'MAX_OPEN_BYTES')).toBe(50 * MIB);
    expect(constantOf('src/lib/core/text/codec.ts', 'MAX_INNER_NUL_SHARE')).toBe(0.1);
    expect(constantOf(RECOVERY_TS, 'SNAPSHOT_INTERVAL_MS')).toBe(30000);
  });

  it('names a constant it cannot find', () => {
    expect(() => constantOf(RECOVERY_RS, 'NO_SUCH_LIMIT')).toThrow(/no constant NO_SUCH_LIMIT/);
  });
});
