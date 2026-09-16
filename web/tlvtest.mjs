import init, { hex_to_tree, example_hex, example_hex_nested, example_hex_lookalike,
                example_hex_3digit, validate, compile } from './pkg/asn1_toolkit.js';
// --target web uses fetch(); Node cannot fetch file:// URLs, so hand the bytes
// over directly instead. The browser path is exercised separately.
import fs from 'node:fs';
await init({ module_or_path: fs.readFileSync('./pkg/asn1_toolkit_bg.wasm') });

const cases = [
  ['OperatorId mccMnc 246/81', example_hex()],
  ['OperatorId mccMnc 246/812', example_hex_3digit()],
  ['nested SEQUENCE', example_hex_nested()],
  ['PE lookalike (NOT ASN.1)', example_hex_lookalike()],
  ['garbage', 'zz'],
  ['odd digits', 'abc'],
  ['empty', ''],
];

for (const [label, hex] of cases) {
  console.log('=== ' + label + ' ===');
  console.log('  input:', hex || '(empty)');
  const r = hex_to_tree(hex);
  console.log('  ok=' + r.ok + ' total=' + r.total + ' consumed=' + r.consumed + ' trailing=' + r.trailing);
  if (r.error) console.log('  error:', r.error);
  for (const n of r.nodes) {
    const dump = (node, ind) => {
      const val = node.value_text ? '  "' + node.value_text + '"' : (node.value_hex ? '  [' + node.value_hex + ']' : '');
      console.log('  ' + '  '.repeat(ind) + node.class + ' ' + node.tag +
                  ' (' + (node.constructed ? 'cons' : 'prim') + ') len=' + node.content_len +
                  ' @' + node.offset + val);
      for (const c of node.children) dump(c, ind + 1);
      for (const note of node.notes) console.log('  ' + '  '.repeat(ind) + '  ! ' + note);
    };
    dump(n, 0);
  }
  for (const n of r.notes) console.log('  NOTE:', n.slice(0, 120));
  console.log();
}
