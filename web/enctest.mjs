import { parseStructure } from './structure.js';
import { encodeValue, encodeValuePer, toHex, valueTemplate } from './encode.js';
import fs from 'node:fs';

const schema = parseStructure(fs.readFileSync('../crate/examples/sgp22.asn', 'utf8'));

let pass = 0, fail = 0;
const check = (label, got, want) => {
  const ok = got.replace(/\s+/g, ' ').trim().toLowerCase() === want.replace(/\s+/g,' ').trim().toLowerCase();
  if (ok) { pass++; console.log('  ok   ' + label + '  ->  ' + got); }
  else { fail++; console.log('  FAIL ' + label + '\n         got:  ' + got + '\n         want: ' + want); }
};

console.log('DER encoding tests\n');

// SGP.22 5.7.2's own worked example: mccMnc 92 F9 18 inside a SEQUENCE.
check('OperatorId { mccMnc 92 f9 18 }',
  toHex(encodeValue(schema, 'OperatorId', { mccMnc: '92 f9 18' }, 'DER')),
  '30 05 04 03 92 f9 18');

// Optional field present changes the SEQUENCE length.
check('OperatorId with gid1',
  toHex(encodeValue(schema, 'OperatorId', { mccMnc: '92 f9 18', gid1: '01 02 03' }, 'DER')),
  '30 0a 04 03 92 f9 18 04 03 01 02 03');

// 3-digit MNC: only the OCTET STRING content differs.
check('OperatorId 3-digit MNC',
  toHex(encodeValue(schema, 'OperatorId', { mccMnc: '92 29 18' }, 'DER')),
  '30 05 04 03 92 29 18');

// Iccid ::= [APPLICATION 26] OCTET STRING (SIZE(10))
// SGP.22 v3.1 line 2290 states the corresponding tag is '5A' in a spec comment.
// 5A = APPLICATION | primitive | 26, so the tag REPLACES the OCTET STRING's 04
// (implicit). Not 7A, which would be the constructed/explicit form.
// SIZE(10) means exactly 10 bytes: 5A, length 0A, then the 10 content bytes.
check('Iccid [APPLICATION 26] is implicit (tag 5A per spec)',
  toHex(encodeValue(schema, 'Iccid', '98 10 11 22 33 44 55 66 77 88', 'DER')),
  '5a 0a 98 10 11 22 33 44 55 66 77 88');

console.log('\ninteger / string encodings (independent of schema)\n');
const mini = parseStructure(`M DEFINITIONS ::= BEGIN
N ::= INTEGER
S ::= UTF8String
B ::= BOOLEAN
O ::= OBJECT IDENTIFIER
F ::= SEQUENCE OF INTEGER
END`);

check('INTEGER 0',        toHex(encodeValue(mini, 'N', 0, 'DER')),        '02 01 00');
check('INTEGER 5',        toHex(encodeValue(mini, 'N', 5, 'DER')),        '02 01 05');
check('INTEGER 128',      toHex(encodeValue(mini, 'N', 128, 'DER')),      '02 02 00 80');
check('INTEGER 256',      toHex(encodeValue(mini, 'N', 256, 'DER')),      '02 02 01 00');
check('INTEGER -1',       toHex(encodeValue(mini, 'N', -1, 'DER')),       '02 01 ff');
check('INTEGER -128',     toHex(encodeValue(mini, 'N', -128, 'DER')),     '02 01 80');
check('INTEGER -129',     toHex(encodeValue(mini, 'N', -129, 'DER')),     '02 02 ff 7f');
check('BOOLEAN true',     toHex(encodeValue(mini, 'B', true, 'DER')),     '01 01 ff');
check('BOOLEAN false',    toHex(encodeValue(mini, 'B', false, 'DER')),    '01 01 00');
check('UTF8String abc',   toHex(encodeValue(mini, 'S', 'abc', 'DER')),    '0c 03 61 62 63');
check('OID 1.2.840.113549', toHex(encodeValue(mini, 'O', '1.2.840.113549', 'DER')), '06 06 2a 86 48 86 f7 0d');
check('SEQ OF INTEGER',   toHex(encodeValue(mini, 'F', [1, 2, 3], 'DER')), '30 09 02 01 01 02 01 02 02 01 03');

console.log('\nCER (indefinite length)\n');
check('CER SEQUENCE', toHex(encodeValue(schema, 'OperatorId', { mccMnc: '92 f9 18' }, 'CER')),
  '30 80 04 03 92 f9 18 00 00');

console.log('\nPER (partial)\n');
try {
  const per = toHex(encodeValuePer(mini, 'F', [1, 2, 3]));
  console.log('  SEQ OF unconstrained INTEGER in PER ->', per || '(empty)');
} catch (e) {
  console.log('  SEQ OF unconstrained INTEGER in PER -> correctly refused:', e.message.slice(0, 80));
}

const perMini = parseStructure(`P DEFINITIONS ::= BEGIN
Flag  ::= BOOLEAN
Small ::= INTEGER (0..15)
Big   ::= INTEGER (0..1000)
Str   ::= UTF8String (SIZE(3))
Enum  ::= ENUMERATED { a(0), b(1), c(2) }
END`);
check('PER BOOLEAN true',  toHex(encodeValuePer(perMini, 'Flag', true)),  '80');
check('PER BOOLEAN false', toHex(encodeValuePer(perMini, 'Flag', false)), '00');
check('PER INTEGER (0..15) = 5', toHex(encodeValuePer(perMini, 'Small', 5)), '50');
check('PER ENUMERATED b', toHex(encodeValuePer(perMini, 'Enum', 'b')), '40');

console.log('\nerror handling\n');
const t = (label, fn) => {
  try { fn(); console.log('  FAIL ' + label + ' (no error raised)'); fail++; }
  catch (e) { console.log('  ok   ' + label + ' -> ' + e.message.slice(0, 72)); pass++; }
};
t('missing required field', () => encodeValue(schema, 'OperatorId', {}, 'DER'));
t('unknown type', () => encodeValue(schema, 'NoSuchType', {}, 'DER'));
t('non-hex octet string', () => encodeValue(schema, 'OperatorId', { mccMnc: 'zz' }, 'DER'));
t('PER unconstrained INTEGER', () => encodeValuePer(parseStructure('X DEFINITIONS ::= BEGIN Y ::= INTEGER END'), 'Y', 5));
t('PER out-of-range', () => encodeValuePer(perMini, 'Small', 99));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
