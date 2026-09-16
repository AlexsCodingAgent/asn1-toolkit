#!/usr/bin/env node
// Regression test for format.js.
//
// The formatter exists because rasn-compiler pipes its Rust output through
// rustfmt, which cannot run in a browser. Bugs here produce code that *looks*
// fine but does not compile, so the guards below are specific:
//
//   - `size("1..=16")` must not become `1.. = 16`   (a real bug we shipped once)
//   - consecutive attributes must not concatenate onto one line
//   - commas inside generics/parens must not break lines
//   - the formatted result must still be parseable Rust (checked by rustfmt in CI)
//
// Run: node test-format.mjs

import assert from 'node:assert/strict';
import { formatRust } from './format.js';
import { formatTypescript } from './format-ts.js';

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + e.message); }
}

const RAW = '# [allow (non_camel_case_types , unused ,)] pub mod m { ' +
  '# [derive (AsnType , Debug)] # [rasn (automatic_tags)] # [non_exhaustive] ' +
  'pub struct S { # [rasn (size ("3") , identifier = "x")] pub x : OctetString , ' +
  'pub y : Option < OctetString > , } # [derive (AsnType)] ' +
  '# [rasn (delegate , size ("1..=16"))] pub struct T (pub OctetString) ; ' +
  'impl S { pub fn new (a : OctetString , b : Option < OctetString >) -> Self { ' +
  'Self { a , b } } } }';

const out = formatRust(RAW);

console.log('format.js regression tests\n');

check('range size("1..=16") is preserved exactly', () => {
  assert.ok(out.includes('size("1..=16")'),
    'range was mangled; got: ' + (out.match(/size\([^)]*\)/g) || []).join(' | '));
  assert.ok(!out.includes('1.. = 16'), 'range corrupted into "1.. = 16"');
});

check('size("3") is preserved', () => {
  assert.ok(out.includes('size("3")'), 'size("3") missing');
});

check('consecutive attributes each get their own line', () => {
  assert.ok(!/#\[[^\]]*\]#\[/.test(out), 'two attributes were concatenated');
  const lines = out.split('\n').filter(l => l.trim().startsWith('#['));
  assert.ok(lines.length >= 5, 'expected >=5 attribute lines, got ' + lines.length);
});

check('a space-separated "# [" in the source is handled', () => {
  // The generator emits "# [derive(...)]" with a space; the tokeniser must see it.
  assert.ok(out.includes('#[derive(AsnType, Debug)]'),
    'attribute not normalised; got: ' + out.split('\n').find(l => l.includes('derive')));
});

check('commas inside generics do not break lines', () => {
  assert.ok(!/FixedOctetString<\d+usize>\s*\n/i.test(out), 'generic was split');
  assert.ok(out.includes('size("1..=16")'), 'attribute containing commas was split');
});

check('commas inside fn params do not break lines', () => {
  const fnLine = out.split('\n').find(l => l.includes('fn new'));
  assert.ok(fnLine, 'fn new not found');
  assert.ok(fnLine.includes(')'), 'fn signature was broken across lines');
});

check('struct body members are one per line', () => {
  const lines = out.split('\n');
  const x = lines.findIndex(l => l.includes('pub x:'));
  const y = lines.findIndex(l => l.includes('pub y:'));
  assert.ok(x !== -1 && y !== -1, 'members not found');
  assert.ok(y > x, 'members not on separate lines');
});

check('type ascription spacing is normalised', () => {
  assert.ok(out.includes('pub x: OctetString'), 'pub x: OctetString missing');
  assert.ok(!out.includes(' : '), 'stray " : " remains');
});

check('path separator is tightened', () => {
  assert.ok(!/:: /.test(out), 'stray ":: " remains');
});

check('Option<...> has no space before the angle bracket', () => {
  assert.ok(out.includes('Option<OctetString>'), 'Option spacing wrong');
});

check('empty or whitespace input is returned unchanged', () => {
  assert.equal(formatRust(''), '');
  assert.equal(formatRust('   '), '   ');
});

check('output is multi-line for multi-item input', () => {
  assert.ok(out.split('\n').length > 10, 'output stayed on one line: ' + out.split('\n').length);
});

// ---- TypeScript formatter -------------------------------------------------

const TS_RAW = '\n                export namespace T {\n' +
  '                    \n' +
  'export type A = {\n' +
  'x: string,\ny: string,\n        };\n' +
  '        export type B = string | object;\n' +
  '                }';

const tsOut = formatTypescript(TS_RAW);

check('ts: namespace is not indented', () => {
  const l = tsOut.split('\n').find(x => x.includes('export namespace'));
  assert.ok(l.startsWith('export namespace'), 'namespace indented: ' + JSON.stringify(l));
});

check('ts: members are indented one level inside a type body', () => {
  // The type body sits inside the namespace, so members are at 8 (2 levels),
  // and the type's own closing brace at 4 - not 4 and 0.
  const lines = tsOut.split('\n');
  const x = lines.find(l => l.trim().startsWith('x:'));
  assert.ok(/^ {8}x:/.test(x), 'member not indented by 8: ' + JSON.stringify(x));
});

check('ts: closing brace of a type body aligns with its opening', () => {
  const lines = tsOut.split('\n');
  const open = lines.findIndex(l => l.includes('export type A'));
  const close = lines.findIndex((l, i) => i > open && l.trim() === '};');
  assert.ok(close > open, 'body was not closed');
  // The type body is one level inside the namespace, so its closing brace is
  // at 4, aligned with the `export type` line that opened it.
  assert.equal(lines[close], '    };', 'closing brace misindented: ' + JSON.stringify(lines[close]));
  assert.equal(lines[open], '    export type A = {', 'opening line misindented');
});

check('ts: no trailing whitespace on any line', () => {
  const bad = tsOut.split('\n').filter(l => /\s+$/.test(l));
  assert.equal(bad.length, 0, 'trailing whitespace: ' + JSON.stringify(bad.slice(0, 3)));
});

check('ts: no doubled spaces', () => {
  const bad = tsOut.split('\n').filter(l => /  /.test(l.replace(/^ +/, '')));
  assert.equal(bad.length, 0, 'doubled spaces: ' + JSON.stringify(bad.slice(0, 3)));
});

check('ts: empty input returned unchanged', () => {
  assert.equal(formatTypescript(''), '');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
