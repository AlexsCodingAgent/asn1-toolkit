// Tests for the PDF artefact cleaner.
//
// THIS MODULE DELETES USER CONTENT, so the tests are weighted accordingly.
//
// The dangerous failure is a false positive: deleting a line that was real ASN.1.
// The user will not notice, because what remains still looks like ASN.1, and the
// damage surfaces much later as a missing type. Every real-spec file here is
// therefore asserted to survive cleaning with its type count intact — that is
// the test that matters, more than any individual detection case.
//
// A missed artefact is the cheap failure: the user gets one more parser error and
// edits by hand. So the detector is deliberately conservative, and several tests
// below assert that it stays SILENT where a looser rule would fire.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  analyseArtefacts,
  cleanArtefacts,
  looksLikeCommentSpill,
  stripComment,
} from './clean.js';
import { parseStructure } from './structure.js';

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + e.message); }
};

console.log('pdf artefact cleaner\n');

// ---------------------------------------------------------------------------
// The artefacts, one class at a time
// ---------------------------------------------------------------------------

check('detects page furniture mid-line', () => {
  const r = analyseArtefacts('V3.1 Page 246 of 452 GSM Association Non-confidential Official Document SGP.22 - RSP Technical Specification');
  assert.equal(r.findings.length, 1);
  assert.ok(r.findings[0].reasons.includes('page furniture'));
});

check('furniture is removable when it is the whole line', () => {
  const r = analyseArtefacts('V3.1 Page 246 of 452 GSM Association Non-confidential Official Document SGP.22 - RSP');
  assert.equal(r.removableCount, 1, 'furniture-only line should be removable');
});

check('detects version markers', () => {
  const r = analyseArtefacts('#SupportedForDcV3.0.0#');
  assert.equal(r.findings.length, 1);
  assert.ok(r.findings[0].reasons.includes('version marker'));
});

check('detects a lone spec reference line', () => {
  const r = analyseArtefacts('SGP.22 v3.1');
  assert.equal(r.findings.length, 1, 'should flag: ' + JSON.stringify(r.findings));
});

check('detects a stray extracted word', () => {
  for (const w of ['Specification', 'Change', 'Profile', 'Page']) {
    const r = analyseArtefacts(w);
    assert.equal(r.findings.length, 1, `"${w}" should be flagged`);
  }
});

// ---------------------------------------------------------------------------
// Comment spill — the case that deleted OperatorId from SGP.22
// ---------------------------------------------------------------------------

check('comment spill is recognised', () => {
  assert.ok(looksLikeCommentSpill("'6F3E') in 3GPP TS 31.102 [54]", false),
    'quoted-file-id spill not recognised');
});

check('a SEQUENCE member is not mistaken for spill', () => {
  // `gid1 OCTET STRING OPTIONAL` begins lowercase, like prose does.
  assert.ok(!looksLikeCommentSpill('gid1 OCTET STRING (SIZE(1..16)) OPTIONAL', false),
    'real member flagged as spill');
  assert.ok(!looksLikeCommentSpill('mccMnc OCTET STRING (SIZE(3)),', false),
    'real member flagged as spill');
});

check('a definition is never spill', () => {
  assert.ok(!looksLikeCommentSpill('OperatorId ::= SEQUENCE {', false));
});

check('spill IS detected inside braces — the real case lives there', () => {
  // CORRECTION: an earlier version of this test asserted the opposite, on the
  // assumption that anything inside a body must be structure. That is wrong.
  // SGP.22 v3.1 puts the spill inside the OperatorId SEQUENCE body, which is
  // why the definition failed to parse and vanished from extraction.
  assert.ok(looksLikeCommentSpill("'6F3E') in 3GPP TS 31.102 [54]", true),
    'inside-braces spill not detected');
});

check('reproduces the real OperatorId comment-spill case', () => {
  // VERBATIM from SGP.22 v3.1 lines 2365-2371. Note the spill lines carry NO
  // `--` marker of their own — that is what makes them code to a parser. An
  // earlier version of this test added `--` markers, which made the lines
  // harmless comments and tested nothing.
  const src = `RSPDefinitions DEFINITIONS AUTOMATIC TAGS ::= BEGIN
OperatorId ::= SEQUENCE {
   mccMnc OCTET STRING (SIZE(3)), -- MCC&MNC coded as 3GPP TS 24.008
   gid1 OCTET STRING OPTIONAL, -- referring to content of EF GID1 (file identifier
'6F3E') in 3GPP TS 31.102 [54]
   gid2 OCTET STRING OPTIONAL -- referring to content of EF GID2 (file identifier
'6F3F') in 3GPP TS 31.102 [54]
}
END`;
  const r = analyseArtefacts(src);
  const spill = r.findings.filter((f) => f.reasons.includes('comment continuation'));
  assert.equal(spill.length, 2, 'expected both spill lines: ' + JSON.stringify(r.findings));

  // And cleaning must remove them while keeping every member.
  const { text } = cleanArtefacts(src);
  assert.ok(!text.includes('6F3E'), 'spill line survived cleaning');
  assert.ok(!text.includes('6F3F'), 'spill line survived cleaning');
  for (const member of ['mccMnc', 'gid1', 'gid2']) {
    assert.ok(text.includes(member), `member ${member} was deleted`);
  }
  const parsed = parseStructure(text);
  assert.equal(parsed.types.length, 1);
  assert.equal(parsed.types[0].fields.length, 3, 'field count wrong after cleaning');
});

check('real spill line is classified as removable', () => {
  const src = `I DEFINITIONS ::= BEGIN
OperatorId ::= SEQUENCE {
   gid1 OCTET STRING OPTIONAL, -- referring to content of EF GID1 (file identifier
'6F3E') in 3GPP TS 31.102 [54]
}
END`;
  const r = analyseArtefacts(src);
  assert.equal(r.removableCount, 1, 'spill line should be removable: ' + JSON.stringify(r.findings));
});

// ---------------------------------------------------------------------------
// Comment stripping
// ---------------------------------------------------------------------------

check('stripComment removes a trailing comment', () => {
  assert.equal(stripComment('mccMnc OCTET STRING, -- the MCC/MNC').trim(), 'mccMnc OCTET STRING,');
});

check('stripComment leaves a quoted double dash alone', () => {
  const line = 'note UTF8String -- "a -- b"';
  assert.equal(stripComment(line).trim(), 'note UTF8String');
});

check('stripComment is a no-op on plain code', () => {
  assert.equal(stripComment('Iccid ::= [APPLICATION 26] OCTET STRING (SIZE(10))'),
    'Iccid ::= [APPLICATION 26] OCTET STRING (SIZE(10))');
});

// ---------------------------------------------------------------------------
// Cleaning behaviour
// ---------------------------------------------------------------------------

check('cleaning removes an artefact-only line', () => {
  const src = 'BEGIN\n#V1.0.0#\nEND';
  const { text, removed } = cleanArtefacts(src);
  assert.equal(removed.length, 1);
  assert.ok(!text.includes('#V1.0.0#'));
});

check('cleaning splices mid-line furniture without dropping the line', () => {
  const src = 'StoreMetadataRequest ::= SEQUENCE { -- V3.1 Page 9 of 90 SGP.22 - RSP\n  iccid Iccid\n}';
  const { text } = cleanArtefacts(src);
  assert.ok(text.includes('StoreMetadataRequest ::= SEQUENCE {'), 'definition lost');
  assert.ok(text.includes('iccid Iccid'), 'member lost');
  assert.ok(!text.includes('Page 9 of 90'), 'furniture survived');
});

check('cleaning never deletes a definition', () => {
  const src = `M DEFINITIONS ::= BEGIN
OperatorId ::= SEQUENCE {
    mccMnc OCTET STRING (SIZE(3)), -- see
    gid1 OCTET STRING OPTIONAL
}
Iccid ::= [APPLICATION 26] OCTET STRING (SIZE(10))
END`;
  const { text } = cleanArtefacts(src);
  assert.ok(text.includes('OperatorId ::= SEQUENCE'), 'OperatorId lost');
  assert.ok(text.includes('Iccid ::= [APPLICATION 26]'), 'Iccid lost');
  const s = parseStructure(text);
  assert.equal(s.types.length, 2, 'type count changed: ' + s.types.map((t) => t.name).join(','));
});

check('cleaning is idempotent', () => {
  const src = 'BEGIN\n#V1.0.0#\nA ::= INTEGER\nEND';
  const once = cleanArtefacts(src).text;
  const twice = cleanArtefacts(once).text;
  assert.equal(twice, once, 'second pass changed the result');
});

check('cleaning empty input is safe', () => {
  assert.equal(cleanArtefacts('').text, '');
  assert.equal(cleanArtefacts(null).text, '');
});

// ---------------------------------------------------------------------------
// THE IMPORTANT ONE: real spec files must survive untouched in substance
// ---------------------------------------------------------------------------

const SPEC_DIR = new URL('../tests/specs/', import.meta.url);

check('every real spec file keeps its type count after cleaning', () => {
  let files = [];
  try { files = readdirSync(SPEC_DIR).filter((f) => f.endsWith('.asn')); } catch { /* none */ }
  assert.ok(files.length > 0, 'no spec files found to test against');

  for (const f of files) {
    const src = readFileSync(new URL(f, SPEC_DIR), 'utf8');
    const before = parseStructure(src);
    const after = parseStructure(cleanArtefacts(src).text);

    assert.ok(before.types.length > 0, `${f}: parsed 0 types before cleaning`);
    // The extraction is already clean, so cleaning must be a no-op on substance.
    // A change in type count means the cleaner deleted real ASN.1.
    const lost = before.types.map((t) => t.name).filter((n) => !after.types.some((t) => t.name === n));
    assert.equal(lost.length, 0, `${f}: cleaning deleted types: ${lost.join(', ')}`);
  }
});

check('cleaning does not corrupt field counts in real specs', () => {
  let files = [];
  try { files = readdirSync(SPEC_DIR).filter((f) => f.endsWith('.asn')); } catch { /* none */ }
  for (const f of files) {
    const src = readFileSync(new URL(f, SPEC_DIR), 'utf8');
    const before = parseStructure(src);
    const after = parseStructure(cleanArtefacts(src).text);
    assert.equal(after.totalFields, before.totalFields,
      `${f}: field count changed ${before.totalFields} -> ${after.totalFields}`);
  }
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
