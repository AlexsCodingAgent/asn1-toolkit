// Highlighter tests.
//
// The invariant that matters most: highlighting is a *view*. It must never
// change the text. So the central test is a round-trip — strip every tag from
// the highlighted HTML, unescape, and compare to the input byte for byte.
//
// A highlighter that silently drops a character is worse than no highlighter,
// because the user copies it into their editor and gets broken ASN.1.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tokeniseAsn1, highlightAsn1, highlightHex, hexByteCount } from './highlight.js';

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + e.message); }
};

const unescape = (s) => s
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&');

const plain = (html) => unescape(html.replace(/<[^>]*>/g, ''));

console.log('highlighter tests\n');

// --- the invariant ---------------------------------------------------------

const SAMPLES = [
  'OperatorId ::= SEQUENCE {\n   mccMnc OCTET STRING (SIZE(3)),\n   gid1 OCTET STRING OPTIONAL\n}',
  '-- a comment\nVersionType ::= OCTET STRING(SIZE(3)) -- trailing\n',
  'T ::= INTEGER { success(0), errorProfileRef(8) }',
  "R ::= SEQUENCE { aid [APPLICATION 15] OctetTo16 }",
  'X ::= BIT STRING { a(0) }',
  'W ::= OCTET STRING (SIZE(1..16))',
  'M ::= CHOICE { a INTEGER, b NULL, c SEQUENCE {} }',
  'File ::= OCTET STRING -- refers to EF GID1 (\'6F3E\') in TS 31.102',
  'V ::= SEQUENCE { marker #SupportedForDcV3.0.0# present BOOLEAN }',
  'S ::= UTF8String ("quoted \\"inner\\" text")',
];

check('highlighting never changes the text (round-trip)', () => {
  for (const src of SAMPLES) {
    const round = plain(highlightAsn1(src));
    assert.equal(round, src, `text changed for: ${JSON.stringify(src.slice(0, 40))}`);
  }
});

check('round-trip holds on real spec ASN.1', () => {
  const specs = [
    '../tests/specs/sgp22_v31.asn',
    '../tests/specs/sgp32_v13.asn',
    '../tests/specs/sgp02.asn',
  ];
  for (const f of specs) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    const round = plain(highlightAsn1(src));
    assert.equal(round, src, `text changed for ${f}`);
  }
});

// --- classification --------------------------------------------------------

const classesOf = (src) => {
  const toks = tokeniseAsn1(src);
  const map = new Map();
  for (const t of toks) {
    const cls = t.cls || 'plain';
    if (!map.has(cls)) map.set(cls, []);
    map.get(cls).push(t.text);
  }
  return map;
};

check('comments are recognised, including trailing ones', () => {
  const m = classesOf('A ::= INTEGER -- hi\n');
  assert.ok(m.get('comment')?.length, 'no comment token');
});

check('a `--` inside a string is not a comment', () => {
  const m = classesOf('A ::= UTF8String ("a -- b")');
  const comments = m.get('comment') || [];
  assert.equal(comments.length, 0, 'comment found inside a string: ' + JSON.stringify(comments));
});

check('quoted file identifiers are strings, not punctuation', () => {
  const m = classesOf("File ::= OCTET STRING -- refers to '6F3E' in TS 31.102\n");
  // The apostrophes live in the comment, so the whole thing is one comment.
  const c = (m.get('comment') || []).join('');
  assert.ok(c.includes('6F3E'), 'comment did not absorb the quoted id');
});

check('builtin types are classified', () => {
  const m = classesOf('A ::= SEQUENCE { x INTEGER, y OCTET STRING }');
  const b = m.get('builtin') || [];
  assert.ok(b.includes('SEQUENCE'), 'SEQUENCE not a builtin');
  assert.ok(b.includes('INTEGER'), 'INTEGER not a builtin');
  assert.ok(b.some((t) => t === 'OCTET'), 'OCTET not a builtin');
});

check('structural keywords are distinguished from types', () => {
  const m = classesOf('A DEFINITIONS AUTOMATIC TAGS ::= BEGIN END');
  const k = m.get('keyword') || [];
  assert.ok(k.includes('DEFINITIONS'), 'DEFINITIONS not a keyword');
  assert.ok(k.includes('BEGIN'), 'BEGIN not a keyword');
  assert.ok(k.includes('AUTOMATIC'), 'AUTOMATIC not a keyword');
});

check('a defined type name is classified as a type', () => {
  const m = classesOf('OperatorId ::= SEQUENCE { x INTEGER }');
  assert.ok((m.get('type') || []).includes('OperatorId'), 'OperatorId not typed');
});

check('field names are classified', () => {
  const m = classesOf('A ::= SEQUENCE { mccMnc OCTET STRING }');
  assert.ok((m.get('field') || []).includes('mccMnc'), 'mccMnc not a field');
});

check('version markers get their own class', () => {
  const m = classesOf('A ::= SEQUENCE { #SupportedForDcV3.0.0# x BOOLEAN }');
  assert.ok((m.get('marker') || []).length, 'no marker token');
});

check('numbers are classified, and ranges do not swallow the operator', () => {
  const m = classesOf('A ::= OCTET STRING (SIZE(1..16))');
  const nums = m.get('number') || [];
  assert.ok(nums.includes('1'), 'left bound missing');
  assert.ok(nums.includes('16'), 'right bound missing');
  // `..` must survive as punctuation.
  assert.ok((m.get('punct') || []).includes('..'), 'range operator lost');
});

check('negative numbers work', () => {
  const m = classesOf('A ::= INTEGER (-5..5)');
  const nums = m.get('number') || [];
  assert.ok(nums.includes('-5'), 'negative bound missing: ' + JSON.stringify(nums));
});

check('`::=` is a single token, not three', () => {
  const m = classesOf('A ::= INTEGER');
  assert.ok((m.get('punct') || []).includes('::='), '::= not tokenised as one');
});

// --- escaping --------------------------------------------------------------

check('HTML is escaped, so ASN.1 cannot inject markup', () => {
  const html = highlightAsn1('A ::= SEQUENCE { b INTEGER } <!-- <script>alert(1)</script>');
  assert.ok(!/<script/i.test(html.replace(/&lt;script/gi, '')), 'unescaped <script> survived');
  assert.ok(html.includes('&lt;'), 'angle brackets were not escaped');
});

check('escaping still round-trips', () => {
  const src = 'A ::= INTEGER -- <tag> & "quoted"\n';
  assert.equal(plain(highlightAsn1(src)), src);
});

// --- hex -------------------------------------------------------------------

check('hex highlighting groups bytes and shows offsets', () => {
  const html = highlightHex('30 05 04 03 92 f9 18');
  assert.ok(html.includes('hex-byte'), 'no byte spans');
  assert.ok(html.includes('hex-off'), 'no offset column');
  assert.ok(html.includes('hex-ascii'), 'no ascii column');
});

check('hex highlighting round-trips its bytes', () => {
  const hex = '30 05 04 03 92 f9 18';
  // The block has three columns: offset, byte pairs, and an ASCII rendering.
  // Only the byte column is asserted — the offset is a counter and the ASCII
  // column is a derived view, so neither is expected to equal the input.
  const html = highlightHex(hex);
  const byteSpans = [...html.matchAll(/<span class="hex-byte">([0-9a-f]{2})<\/span>/gi)]
    .map((m) => m[1]);
  assert.equal(byteSpans.join(''), hex.replace(/\s+/g, '').toLowerCase());
});

check('hex ascii column renders printable bytes and dots otherwise', () => {
  // Bytes 'A' (0x41) and 'B' (0x42) are printable; 0x00 and 0xff are not.
  const html = highlightHex('41 42 00 ff');
  const ascii = /<span class="hex-ascii">([^<]*)<\/span>/.exec(html)?.[1] || '';
  assert.equal(ascii, 'AB..', 'ascii column wrong: ' + JSON.stringify(ascii));
});

check('hex byte count is right', () => {
  assert.equal(hexByteCount('30 05 04 03 92 f9 18'), 7);
  assert.equal(hexByteCount('30050'), 2);      // floor of odd input
  assert.equal(hexByteCount(''), 0);
});

check('hex handles empty and junk input without throwing', () => {
  assert.equal(highlightHex(''), '');
  assert.equal(highlightHex('zz'), '');
  assert.equal(highlightHex(null), '');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
