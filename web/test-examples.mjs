// The examples picker must offer real provenance for real schemas.
//
// WHY THIS EXISTS
//
// F7 was "no visible provenance for the example schemas": one hardcoded button
// reading "SGP.22 example", with nothing saying which specification or version
// the text came from. A schema you cannot cite is a schema you cannot check.
//
// Two things this test is careful about, both learned from bugs in this repo:
//
//  1. Comments are stripped before assertions. panel boot's test passed with the
//     fix removed because a comment contained the exact string being searched
//     for. Assertions here run against code only.
//
//  2. It asserts the schemas are NOT extracts. The extracted corpus under
//     tests/specs/ (582 types from five GSMA PDFs) must never reach the site:
//     GSMA specs are not redistributable and derived schemas inherit that. A
//     future change that wires the corpus into the picker would be a licensing
//     regression, so it fails here as well as in review.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadCatalogue, exampleLabel, provenanceText, renderOptions, indexById } from './examples.js';

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + e.message); }
};

const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const lib = readFileSync(new URL('../crate/src/lib.rs', import.meta.url), 'utf8');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const appCode = stripComments(app);
const htmlCode = stripComments(html);
// Rust needs its own stripper: `//!` and `///` are doc comments, and the
// doc comment on example_catalogue NAMES tests/specs/ while explaining that it
// must never be served. Matching the prose instead of the code is the exact
// false-positive this repo already hit once — see panel boot's notes.
const libCode = lib
  .replace(/^\s*\/\/[/!].*$/gm, '')     // doc comments
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

console.log('examples picker (F7)\n');

// ---------------------------------------------------------------------------
// Catalogue shape
// ---------------------------------------------------------------------------

const SAMPLE = JSON.stringify([
  { id: 'sgp32-v12', spec: 'SGP.32', version: 'v1.2', note: 'IoT eUICC.', schema: 'A ::= INTEGER' },
  { id: 'sgp22-v31', spec: 'SGP.22', version: 'v3.1', note: 'Consumer RSP.', schema: 'B ::= INTEGER' },
]);

check('catalogue parses into entries', () => {
  const c = loadCatalogue(SAMPLE);
  assert.equal(c.length, 2);
  assert.equal(c[0].id, 'sgp32-v12');
});

check('a broken catalogue yields [] rather than throwing', () => {
  // A malformed catalogue should cost the picker, not the page.
  assert.deepEqual(loadCatalogue('not json'), []);
  assert.deepEqual(loadCatalogue('{"not":"an array"}'), []);
});

check('labels carry spec AND version', () => {
  // The version is the point: SGP.22 v2.7 vs v3.1 is exactly what trips people.
  const c = loadCatalogue(SAMPLE);
  assert.equal(exampleLabel(c[0]), 'SGP.32 v1.2');
  assert.equal(exampleLabel(c[1]), 'SGP.22 v3.1');
});

check('provenance says it is a subset, not an extract', () => {
  const c = loadCatalogue(SAMPLE);
  const t = provenanceText(c[0]);
  assert.match(t, /SGP\.32 v1\.2/);
  assert.match(t, /not an extract/i);
});

check('indexById maps every id', () => {
  const m = indexById(loadCatalogue(SAMPLE));
  assert.equal(m.get('sgp22-v31').version, 'v3.1');
  assert.equal(m.get('nope'), undefined);
});

// ---------------------------------------------------------------------------
// The real catalogue, as shipped in the wasm
// ---------------------------------------------------------------------------

check('wasm exports example_catalogue', () => {
  assert.match(lib, /pub fn example_catalogue\(\)\s*->\s*String/);
});

check('every example is an include_str! of crate/examples', () => {
  // Proves the schemas are compiled in, so the page needs no fetch.
  const hits = [...lib.matchAll(/include_str!\("\.\.\/examples\/([a-z0-9_]+\.asn)"\)/g)]
    .map((m) => m[1]);
  for (const need of ['sgp32.asn', 'sgp22.asn', 'sgp02.asn']) {
    assert.ok(hits.includes(need), `lib.rs does not include ${need}`);
  }
});

check('NO tests/specs path is ever served', () => {
  // The licensing boundary. These files are extracted from GSMA PDFs and must
  // stay test-only. Comments are stripped first: the doc comment on
  // example_catalogue names this path deliberately, to state the rule.
  assert.doesNotMatch(libCode, /tests\/specs/);
  assert.doesNotMatch(appCode, /tests\/specs/);
  assert.doesNotMatch(htmlCode, /tests\/specs/);
});

check('catalogue does not read the filesystem at runtime', () => {
  assert.doesNotMatch(lib, /std::fs|read_to_string/);
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

check('both panels have a picker, and the old button is gone', () => {
  assert.match(htmlCode, /id="examplePicker"/);
  assert.match(htmlCode, /id="structExamplePicker"/);
  assert.doesNotMatch(htmlCode, /id="btnExample"/);
  assert.doesNotMatch(htmlCode, /id="btnStructExample"/);
});

check('pickers are populated, not left empty', () => {
  assert.match(appCode, /renderOptions\(/);
  assert.match(appCode, /initExamplePickers\(\)/);
});

check('boot seeds from the catalogue, not a hardcoded example', () => {
  // A failure here means the page opened on the old single example.
  assert.match(appCode, /initExamplePickers\(\)/);
  assert.doesNotMatch(appCode, /editor\.value\s*=\s*example_schema\(\)/);
});

check('switching example re-runs the panel it was switched in', () => {
  assert.match(appCode, /function loadExample\(/);
  assert.match(appCode, /if \(panel === 'structure'\)/);
});

check('provenance is cleared when the text is edited', () => {
  // Otherwise the line keeps claiming SGP.32 over text the user rewrote.
  assert.match(appCode, /clearProvenanceUnlessExample\(\)/);
});

check('provenance element exists and starts hidden', () => {
  assert.match(htmlCode, /id="compileProvenance"[^>]*hidden/);
});

check('both pickers stay in step', () => {
  // The schema is shared; two pickers disagreeing about it is a lie.
  assert.match(appCode, /structExamplePicker/);
  assert.match(appCode, /sel\.value !== id/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
