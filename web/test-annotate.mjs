// Inspector annotation, exercised through the real page.
//
// WHAT THIS PROTECTS
//
// The inspector names decoded bytes against the schema in the compiler tab. The
// dangerous failure is a CONFIDENT WRONG NAME: an unlabelled node is a small
// disappointment, but a node labelled with the wrong field is a trap, because it is
// indistinguishable from a correct answer.
//
// So the assertions here are mostly about what the tool REFUSES to claim.

import assert from 'node:assert/strict';

const base = process.env.AUDIT_BASE || 'http://127.0.0.1:8791/index.html';

async function loadPlaywright() {
  const candidates = [
    'playwright',
    process.env.PLAYWRIGHT_PATH,
    '/home/agent/repos/archlint-stack/node_modules/playwright/index.js',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      const m = await import(c.startsWith('/') ? 'file://' + c : c);
      if (m.chromium) return m;
      if (m.default && m.default.chromium) return m.default;
    } catch { /* next */ }
  }
  return null;
}

const pw = await loadPlaywright();
if (!pw || !pw.chromium) {
  console.log('playwright not available — skipping inspector annotation tests');
  console.log('\n0 passed, 0 failed');
  process.exit(0);
}

const browser = await pw.chromium.launch();
let page = await browser.newPage();

let pass = 0, fail = 0;
const errors = [];
const check = async (name, fn) => {
  try {
    if (page && !page.isClosed()) await page.close();
    page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(String(e.message)));
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.click('#tab-decode');
    await fn();
    pass++;
    console.log('  ok   ' + name);
  } catch (e) {
    fail++;
    console.log('  FAIL ' + name + '\n         ' + e.message);
  }
};

const put = (hex) => page.evaluate((h) => {
  const e = document.getElementById('hexInput');
  e.value = h;
  e.dispatchEvent(new Event('input', { bubbles: true }));
}, hex);
// Load a built-in example through the picker. Replaces the old #btnExample
// button, which became a <select> over three labelled examples (F7).
const selectExample = (id) => page.selectOption('#examplePicker', id);
const decode = async () => { await page.click('#btnDecode'); return tree(); };
const tree = () => page.$eval('#treeOutput', (e) => e.textContent);
const status = () => page.$eval('#statusDecode', (e) => e.textContent);
const pick = async (t) => {
  await page.selectOption('#decodeTypeSelect', t);
};

console.log('inspector annotation\n');

// ---------------------------------------------------------------------------
// Naming from the outermost tag
// ---------------------------------------------------------------------------

await check('a bare Iccid off the wire is named, not just tagged', async () => {
  await put('5a 0a 89 01 26 77 36 65 43 21 09 87');
  const t = await decode();
  assert.ok(t.includes('Iccid'), 'the root was not identified; tree was:\n' + t);
  assert.ok(t.includes('APPLICATION 26'), 'the raw tag should stay visible for checking');
});

await check('the status says the bytes were matched against the schema', async () => {
  await put('5a 0a 89 01 26 77 36 65 43 21 09 87');
  await decode();
  const s = await status();
  assert.ok(/schema/i.test(s), 'no explanation of where the name came from: ' + s);
});

await check('byte values survive naming exactly', async () => {
  await put('5a 0a 89 01 26 77 36 65 43 21 09 87');
  const t = await decode();
  assert.ok(t.includes('89 01 26 77 36 65 43 21 09 87'), 'the value was altered by naming');
});

// ---------------------------------------------------------------------------
// Refusing to guess
// ---------------------------------------------------------------------------

await check('an ambiguous root is left unnamed rather than guessed', async () => {
  // [0] 3 bytes + [1] 1 byte is equally consistent with OperatorId and
  // AuthenticateServerRequest. The tool must not pick one at random.
  await put('30 08 80 03 92 f9 18 81 01 01');
  const t = await decode();
  assert.ok(!/mccMnc|serverSigned1/.test(t),
    'an ambiguous root was named anyway; tree was:\n' + t);
});

await check('unrelated bytes get no schema names at all', async () => {
  await put('02 01 05');
  const t = await decode();
  for (const n of ['Iccid', 'OperatorId', 'mccMnc']) {
    assert.ok(!t.includes(n), 'unrelated bytes were labelled ' + n + ': ' + t);
  }
});

await check('a name from a previous decode is not carried over', async () => {
  await put('5a 0a 89 01 26 77 36 65 43 21 09 87');
  await decode();
  await put('02 01 05');
  await decode();
  const t = await tree();
  const s = await status();
  assert.ok(!t.includes('Iccid'), 'stale name in the tree: ' + t);
  assert.ok(!s.includes('Iccid'), 'stale name in the status: ' + s);
});

// ---------------------------------------------------------------------------
// The picker: stating the type resolves ambiguity
// ---------------------------------------------------------------------------

await check('the picker lists the schema types', async () => {
  const opts = await page.$$eval('#decodeTypeSelect option', (els) => els.map((e) => e.value));
  assert.ok(opts.includes(''), 'no Auto option');
  assert.ok(opts.includes('OperatorId'), 'OperatorId missing from the picker');
  assert.ok(opts.length > 3, 'picker only has ' + opts.length + ' options');
});

await check('choosing a type names its fields', async () => {
  await put('30 08 80 03 92 f9 18 81 01 01');
  await decode();
  await pick('OperatorId');
  const t = await tree();
  assert.ok(t.includes('mccMnc'), 'mccMnc not named; tree was:\n' + t);
  assert.ok(t.includes('gid1'), 'gid1 not named; tree was:\n' + t);
});

await check('choosing a type re-decodes without pressing Decode', async () => {
  await put('30 08 80 03 92 f9 18 81 01 01');
  await decode();
  const before = await tree();
  await pick('OperatorId');
  const after = await tree();
  assert.notEqual(after, before, 'the picker did not trigger a re-render');
});

await check('the named fields keep their type and tag on show', async () => {
  await put('30 08 80 03 92 f9 18 81 01 01');
  await decode();
  await pick('OperatorId');
  const t = await tree();
  // Showing the tag is how the reader checks the claim instead of trusting it.
  assert.ok(/OCTET STRING/.test(t), 'the field type is not shown: ' + t);
  assert.ok(/CONTEXT 0/.test(t), 'the wire tag is not shown: ' + t);
});

await check('returning to Auto drops the name again', async () => {
  await put('30 08 80 03 92 f9 18 81 01 01');
  await decode();
  await pick('OperatorId');
  await pick('');
  const t = await tree();
  assert.ok(!t.includes('mccMnc'), 'the name survived going back to Auto: ' + t);
});

await check('a chosen type that does not fit names nothing', async () => {
  // Iccid applied to a SEQUENCE. It must not force field names onto it.
  await put('30 08 80 03 92 f9 18 81 01 01');
  await decode();
  await pick('Iccid');
  const t = await tree();
  assert.ok(!/mccMnc|gid1/.test(t), 'a non-fitting type still produced names: ' + t);
});

// ---------------------------------------------------------------------------
// Interaction with the encoder
// ---------------------------------------------------------------------------

await check('bytes sent from the encoder are named without guessing', async () => {
  await page.click('#tab-compile');
  await selectExample('sgp32-v12');
  await page.click('#tab-encode');
  await page.selectOption('#typeSelect', 'OperatorId');
  await page.click('#btnTemplate');
  await page.fill('#valueInput', '{"mccMnc": "92 f9 18"}');
  await page.click('#btnEncode');
  await page.click('#btnSendToInspector');
  const t = await tree();
  // The type is known here, so even a shape that would otherwise be ambiguous or
  // unmatched should carry its name.
  assert.ok(t.includes('OperatorId'), 'the encoded type was not carried over: ' + t);
});

await check('hand-editing the hex drops the known type', async () => {
  await page.click('#tab-compile');
  await selectExample('sgp32-v12');
  await page.click('#tab-encode');
  await page.selectOption('#typeSelect', 'OperatorId');
  await page.click('#btnTemplate');
  await page.fill('#valueInput', '{"mccMnc": "92 f9 18"}');
  await page.click('#btnEncode');
  await page.click('#btnSendToInspector');
  // Now type something unrelated by hand.
  await put('02 01 05');
  const t = await decode();
  assert.ok(!t.includes('mccMnc'), 'a hand-edited value kept the encoder\'s type: ' + t);
});

// ---------------------------------------------------------------------------

await check('no page errors during annotation', async () => {
  const real = errors.filter((e) => !/favicon/i.test(e));
  assert.equal(real.length, 0, 'console errors: ' + real.slice(0, 3).join(' | '));
});

await browser.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
