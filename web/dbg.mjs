import { parseStructure } from './structure.js';
import { encodeValue, toHex } from './encode.js';

const s = parseStructure(
  'I DEFINITIONS ::= BEGIN\nIccid ::= [APPLICATION 26] OCTET STRING (SIZE(10))\nEND'
);
const def = s.types[0];
const raw = def.constraints[0];
console.log('raw constraint:', JSON.stringify(raw));

// Reproduce enforceSize's normalisation exactly as written in encode.js.
const c = String(raw).trim().replace(/^\(/, '').replace(/\)$/, '');
console.log('normalised    :', JSON.stringify(c));

const m = /^SIZE\(\s*(\d+)\s*\)$/.exec(c);
console.log('SIZE(n) match :', m ? `matched ${m[1]}` : 'NO MATCH');

// And the whole encode path.
try {
  const out = toHex(encodeValue(s, 'Iccid', '98 10 11 22 33 44 55 66 77 88'));
  console.log('10 bytes      :', out);
} catch (e) {
  console.log('10 bytes      : REFUSED ' + e.message);
}
try {
  const out = toHex(encodeValue(s, 'Iccid', '98 10 11 22 33 44 55 66 77 88 99 00'));
  console.log('12 bytes      :', out, '  <-- should have been refused');
} catch (e) {
  console.log('12 bytes      : correctly refused - ' + e.message);
}
