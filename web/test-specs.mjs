// Run the toolkit's own parser over ASN.1 extracted from real GSMA specs.
//
// This is the honest test of the tool: not "does it handle my hand-written
// example", but "does it read what five specifications actually contain".
//
// The extracted files are deliberately conservative (see
// scripts/extract_spec_asn1.py) — they hold only type assignments that could be
// read with certainty. So a parse failure here means our parser is wrong, not
// that the spec is unusual.

import fs from 'node:fs';
import path from 'node:path';
import { parseStructure } from './structure.js';

const DIR = '../tests/specs';

const SPECS = [
  ['SGP.02 v4.2',  'sgp02.asn'],
  ['SGP.22 v2.7',  'sgp22_v27.asn'],
  ['SGP.22 v3.1',  'sgp22_v31.asn'],
  ['SGP.32 v1.2',  'sgp32_v12.asn'],
  ['SGP.32 v1.3',  'sgp32_v13.asn'],
];

let totalTypes = 0;
let totalFields = 0;
let failures = 0;

console.log('Parsing ASN.1 extracted from five GSMA specifications\n');

for (const [label, file] of SPECS) {
  const p = path.join(DIR, file);
  if (!fs.existsSync(p)) {
    console.log(`${label}: MISSING ${p}`);
    failures++;
    continue;
  }
  const src = fs.readFileSync(p, 'utf8');
  const r = parseStructure(src);

  const fields = r.types.reduce((n, t) => n + t.fields.length, 0);
  totalTypes += r.types.length;
  totalFields += fields;

  console.log(`${label}  (${file})`);
  console.log(`  module      : ${r.module || '(none)'}   tagging: ${r.tagging || '(none)'}`);
  console.log(`  types       : ${r.types.length}`);
  console.log(`  top fields  : ${fields}`);
  console.log(`  unresolved  : ${r.unresolved.length}${r.unresolved.length ? ' -> ' + r.unresolved.slice(0, 6).join(', ') + (r.unresolved.length > 6 ? ' …' : '') : ''}`);

  // Sanity: a module that yields no types means the parser failed silently,
  // which is the failure mode worth shouting about.
  if (r.types.length === 0) {
    console.log('  !! parsed to zero types');
    failures++;
  }

  // Report the kinds we found, so gaps in coverage are visible.
  const kinds = {};
  for (const t of r.types) kinds[t.kind] = (kinds[t.kind] || 0) + 1;
  const summary = Object.entries(kinds)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, n]) => `${k}×${n}`)
    .join(', ');
  console.log(`  kinds       : ${summary}`);
  console.log();
}

console.log('─'.repeat(64));
console.log(`total: ${totalTypes} types, ${totalFields} top-level fields across 5 specs`);
if (failures) {
  console.log(`${failures} spec(s) failed to parse`);
  process.exit(1);
}
console.log('all five specs parsed');
