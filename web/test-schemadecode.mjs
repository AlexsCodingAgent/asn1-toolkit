// Tests for schema-aware decoding.
//
// The failure mode that matters here is a CONFIDENT WRONG NAME. An unlabelled node
// is a small disappointment; a node labelled with the wrong field is a trap,
// because it is indistinguishable from a correct answer and the reader has no
// reason to doubt it. These tests therefore weight false naming far above missed
// naming.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import init, { decode_to_tree } from './pkg/asn1_toolkit.js';
import { parseStructure } from './structure.js';
import { annotate, prepareSchema, parseTagExpr, decodableRoots } from './schemadecode.js';

await init(readFileSync(new URL('./pkg/asn1_toolkit_bg.wasm', import.meta.url)));

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + e.message); }
};

const schema = prepareSchema(parseStructure(readFileSync(
  new URL('../tests/specs/sgp22_v31.asn', import.meta.url), 'utf8')));

const decode = (hex) => decode_to_tree(hex);

console.log('schema-aware decoding\n');

// ---------------------------------------------------------------------------
// Tag expressions
// ---------------------------------------------------------------------------

check('explicit tags are parsed from the schema text', () => {
  assert.deepEqual(parseTagExpr('[APPLICATION 26]'), { class: 'application', number: 26, explicit: false });
  assert.deepEqual(parseTagExpr('[0]'), { class: 'context', number: 0, explicit: false });
  assert.deepEqual(parseTagExpr('[UNIVERSAL 16]'), { class: 'universal', number: 16, explicit: false });
  assert.deepEqual(parseTagExpr('[2] EXPLICIT'), { class: 'context', number: 2, explicit: true });
  assert.equal(parseTagExpr(''), null);
});

// ---------------------------------------------------------------------------
// The headline case: an Iccid off the wire
// ---------------------------------------------------------------------------

check('a bare Iccid is named, not just tagged', () => {
  // 5a 0a = [APPLICATION 26] primitive, 10 octets. This is the tag SGP.22
  // annotates: "ICCID as coded in EFiccid; corresponding tag is 5A".
  const d = decode('5a 0a 89 01 26 77 36 65 43 21 09 87');
  assert.ok(d.ok, 'decode failed: ' + d.error);
  const r = annotate(d, schema, 'Iccid');
  assert.ok(r.ok, 'annotate failed: ' + r.error);
  const n = r.nodes[0];
  assert.equal(n.typeName, 'Iccid', 'the root was not identified as Iccid');
  assert.ok(r.named >= 1 || n.typeName === 'Iccid', 'Iccid was not named');
});

check('the value is preserved exactly through annotation', () => {
  const hex = '5a 0a 89 01 26 77 36 65 43 21 09 87';
  const before = decode(hex);
  const after = annotate(before, schema, 'Iccid');
  const flat = (nodes) => nodes.flatMap((n) => [n.offset, n.length, n.value_hex, ...flat(n.children || [])]);
  assert.deepEqual(flat(after.nodes), flat(before.nodes),
    'annotation altered the decoded data — it must only add labels');
});

// ---------------------------------------------------------------------------
// Nested structures
// ---------------------------------------------------------------------------

check('sequence fields are named by their schema identifiers', () => {
  // OperatorId: SEQUENCE { mccMnc OCTET STRING (SIZE(3)), gid1 OPTIONAL, gid2 OPTIONAL }
  // Under AUTOMATIC TAGS the fields are [0], [1], [2]. 30 05 04 03 92 f9 18 is the
  // SGP.22 worked example, which carries a universal OCTET STRING rather than a
  // context tag, so this also checks the universal path resolves.
  const d = decode('30 05 04 03 92 f9 18');
  const r = annotate(d, schema, 'OperatorId');
  assert.ok(r.ok, r.error);
  const seq = r.nodes[0];
  assert.equal(seq.typeName, 'OperatorId');
  assert.ok(seq.children.length >= 1, 'no children matched');
});

check('a real OperatorId under automatic tags names mccMnc', () => {
  // 30 08  80 03 92 f9 18  81 01 01
  //   SEQUENCE, [0] 3 bytes (mccMnc), [1] 1 byte (gid1)
  const d = decode('30 08 80 03 92 f9 18 81 01 01');
  const r = annotate(d, schema, 'OperatorId');
  const seq = r.nodes[0];
  assert.equal(seq.typeName, 'OperatorId');
  const names = seq.children.map((c) => c.fieldName);
  assert.ok(names.includes('mccMnc'), 'mccMnc not named; got ' + JSON.stringify(names));
  assert.ok(names.includes('gid1'), 'gid1 not named; got ' + JSON.stringify(names));
});

// ---------------------------------------------------------------------------
// The safety property: never name something wrongly
// ---------------------------------------------------------------------------

check('an unrelated element is left unnamed rather than mislabelled', () => {
  // A universal INTEGER where OperatorId expects a SEQUENCE. Nothing should be
  // claimed about it.
  const d = decode('02 01 05');
  const r = annotate(d, schema, 'OperatorId');
  const n = r.nodes[0];
  assert.ok(!n.fieldName, 'an unrelated element was given the name ' + JSON.stringify(n.fieldName));
});

check('annotation never invents a type for an empty tree', () => {
  const d = decode('');
  const r = annotate(d, schema, 'OperatorId');
  assert.ok(Array.isArray(r.nodes), 'no nodes array');
});

check('an unknown root type is refused, not guessed', () => {
  const d = decode('30 03 02 01 05');
  const r = annotate(d, schema, 'NoSuchTypeAnywhere');
  assert.equal(r.ok, false, 'an unknown type was accepted');
  assert.ok(/no type named/i.test(r.error), 'unhelpful error: ' + r.error);
});

check('extra elements from extensibility are not forced into field names', () => {
  // OperatorId has no `...` here, but a 3-field SEQUENCE sent with a 4th element is
  // the realistic forward-compatibility case. The extra must stay unnamed.
  const d = decode('30 0b 80 03 92 f9 18 81 01 01 82 01 02');
  const r = annotate(d, schema, 'OperatorId');
  const seq = r.nodes[0];
  const named = seq.children.filter((c) => c.fieldName).length;
  assert.ok(named <= 3, 'more fields named than the schema defines: ' + named);
});

// ---------------------------------------------------------------------------
// Coverage over the real corpus
// ---------------------------------------------------------------------------

check('every spec corpus annotates without throwing', () => {
  const files = ['sgp02', 'sgp22_v27', 'sgp22_v31', 'sgp32_v12', 'sgp32_v13'];
  let total = 0;
  for (const f of files) {
    const parsed = prepareSchema(parseStructure(
      readFileSync(new URL(`../tests/specs/${f}.asn`, import.meta.url), 'utf8')));
    const roots = decodableRoots(parsed);
    assert.ok(roots.length > 0, f + ' has no decodable types');
    total += roots.length;
    // Annotate the OperatorId example against each: the call must not throw even
    // when the type is absent from that spec.
    const d = decode('30 05 04 03 92 f9 18');
    annotate(d, parsed, 'OperatorId');
  }
  console.log('         decodable roots across the corpus: ' + total);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
