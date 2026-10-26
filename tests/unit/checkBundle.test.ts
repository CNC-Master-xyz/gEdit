// Tests for scripts/check-bundle.mjs, the CI scan of the production bundle for code the
// Content Security Policy blocks (T202). The scan used to be one grep that saw `eval(` and
// `Function(` and nothing else: `(0, eval)(code)`, which is what bundlers write for an
// indirect eval, and `window.eval(code)` passed it.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { scanBuild, scanText } from '../../scripts/check-bundle.mjs';

const SCRIPT = fileURLToPath(new URL('../../scripts/check-bundle.mjs', import.meta.url));

/** The pattern the workflow step used before the script (grep -E, as a regular expression). */
const OLD_GREP = /(^|[^a-zA-Z0-9_.$])(Function|eval)[ \t]*\(/;

const ids = (text: string) => scanText(text).map((hit) => hit.id);

describe('the direct forms the old grep knew', () => {
  it.each([
    ['eval', 'var r=eval(code);', 'eval'],
    ['eval after a space', 'return eval ("1")', 'eval'],
    ['Function', 'var f=Function("a","return a");', 'Function'],
    ['new Function', 'var f=new Function("return 1");', 'Function'],
  ])('finds %s', (_name, text, id) => {
    expect(ids(text)).toEqual([id]);
    expect(OLD_GREP.test(text)).toBe(true);
  });
});

describe('the indirect forms the old grep missed', () => {
  it.each([
    ['(0,eval)', 'var r=(0,eval)(code);', 'indirect eval'],
    ['(0, eval)', 'var r = (0, eval)(code);', 'indirect eval'],
    ['(1,eval)', '(1,eval)(code)', 'indirect eval'],
    ['window.eval', 'window.eval(code)', 'global eval'],
    ['globalThis.eval', 'globalThis.eval(code)', 'global eval'],
    ['globalThis optional', 'globalThis?.eval(code)', 'global eval'],
    ['self["eval"]', 'self["eval"](code)', 'global eval'],
    ["globalThis['eval']", "globalThis['eval'](code)", 'global eval'],
    ['window.Function', 'window.Function("return 1")', 'global Function'],
    ['eval.call', 'eval.call(null,code)', 'eval as a value'],
    ['eval.apply', 'eval.apply(null,[code])', 'eval as a value'],
    ['var e=eval', 'var e=eval;e(code)', 'eval handed on'],
    ['const e = eval', 'const e = eval;', 'eval handed on'],
    ['an argument', 'run(eval)', 'eval handed on'],
    ['an object value', 'x={run:eval}', 'eval handed on'],
    ['a return', 'function f(){return eval}', 'eval handed on'],
    ['a string timer', 'setTimeout("tick()",5)', 'string timer'],
    ['a template timer', 'setInterval(`tick()`,5)', 'string timer'],
    ['a constructor chain', '[].constructor.constructor("return this")()', 'constructor chain'],
    ['a constructor call', '(function(){}).constructor("return this")()', 'constructor chain'],
    ['the test hook', 'globalThis.__gedit={}', 'test hook'],
  ])('finds %s', (_name, text, id) => {
    expect(ids(text)).toContain(id);
    // The old grep passed every one of them except the test hook, which it checked apart.
    if (id !== 'test hook') expect(OLD_GREP.test(text)).toBe(false);
  });

  it('reports a spelling that satisfies two rules once', () => {
    expect(ids('(0,eval)(code)')).toHaveLength(1);
  });
});

describe('what is not an error', () => {
  it.each([
    ['the word as a language keyword', 'const keywords=["break","eval","with"];'],
    ['a longer name', 'medieval(x);retrieval(a);evaluate(b);x.evaluate(c);'],
    ['a member that is not the global', 'obj.eval(1); parser.Function(2); isFunction(3); myFunction(4);'],
    ['a comment', '/* eval is blocked here */ // Function is too'],
    ['a typeof', 'if(typeof eval==="function"){}'],
    ['a timer with a function', 'setTimeout(()=>tick(),5);setInterval(tick,5);setTimeout(tick, 5)'],
    ['a key named eval', 'x={eval:1,"eval":2}'],
    ['a constructor read', 'a.constructor.name; b.constructor===Object; new c.constructor(d)'],
    ['a hook-free word', '__gedi t _gedit'],
  ])('leaves %s alone', (_name, text) => {
    expect(ids(text)).toEqual([]);
  });
});

describe('scanBuild and the command', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function build(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'gedit-bundle-'));
    dirs.push(root);
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, name)), { recursive: true });
      writeFileSync(join(root, name), content);
    }
    return root;
  }
  const run = (root: string) => spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' });

  it('names the file, line and column, and shows the code around it', () => {
    const root = build({ '_app/immutable/a.js': 'let a=1;\nlet b=2;\nvar r = (0, eval)("x");' });
    const { problems, scanned } = scanBuild(root);
    expect(scanned).toBe(1);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^_app\/immutable\/a\.js:3:\d+: .*\[indirect eval\]/);
    expect(problems[0]).toContain('(0, eval)("x")');
  });

  it('reads module files and the inline scripts of a page, and skips the rest', () => {
    const root = build({
      'index.html': '<script>window.eval("1")</script>',
      'x.mjs': 'eval(a)',
      'font.woff2': 'eval(a)',
      'style.css': 'eval(a)',
    });
    expect(scanBuild(root).problems).toHaveLength(2);
  });

  it('exits 1 on a finding, 0 on a clean build and 2 when there is nothing to check', () => {
    expect(run(build({ 'a.js': 'var x=(0,eval)(1);' })).status).toBe(1);
    const clean = run(build({ 'a.js': 'var x=1;', 'b.js': 'const w=["eval"];' }));
    expect(clean.status).toBe(0);
    expect(clean.stdout).toContain('2 script files');
    expect(run(build({ 'a.png': 'x' })).status).toBe(2);
    expect(run(join(tmpdir(), 'gedit-no-such-build-folder')).status).toBe(2);
  });
});
