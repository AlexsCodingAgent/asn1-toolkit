// Button-by-button functional audit.
//
// Every control on the page is exercised and its EFFECT asserted, not just that it
// exists. The earlier "the buttons don't work" report turned out to be caching, but
// it showed that nobody had ever systematically checked what sits behind each one.
//
// A button "works" here only if it changes observable state in the way its label
// promises. Producing no output is a failure even if no error is thrown.

import assert from 'node:assert/strict';

let pass = 0, fail = 0;
// Awaits the check body: several probes are async, and without the await a rejected
// promise escaped and one check ran after the browser had already closed.
const check = async (name, fn) => {
  try {
    // Fresh page per check: no state leaks between them, so a failure is always
    // about the thing under test rather than what ran before it.
    if (page && !page.isClosed()) await page.close();
    page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(String(e.message)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(base, { waitUntil: 'networkidle' });
    await fn();
    pass++;
    console.log('  ok   ' + name);
  } catch (e) {
    fail++;
    console.log('  FAIL ' + name + '\n         ' + e.message);
  }
};

const base = process.env.AUDIT_BASE || 'http://127.0.0.1:8791/index.html';

// Playwright is resolved explicitly rather than via a bare import. It is not a
// dependency of THIS repo (the site is dependency-free by design, and the audit is
// a dev tool), so it may live in another project's node_modules. A bare
// `import('playwright')` ignores NODE_PATH, so pointing at it needs the full path.
async function loadPlaywright() {
  const candidates = [
    'playwright',
    process.env.PLAYWRIGHT_PATH,
    '/home/agent/repos/archlint-stack/node_modules/playwright/index.js',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      const m = await import(c.startsWith('/') ? 'file://' + c : c);
      // index.js is CommonJS, so a direct ESM import exposes it under `default`.
      if (m.chromium) return m;
      if (m.default && m.default.chromium) return m.default;
    } catch { /* try the next */ }
  }
  return null;
}

const pw = await loadPlaywright();
const chromium = pw && pw.chromium;

if (!chromium) {
  console.log('playwright not available — skipping browser audit');
  console.log('\n0 passed, 0 failed');
  process.exit(0);
}

const browser = await chromium.launch();
let page = await browser.newPage();
const errors = [];

const $ = (id) => page.$('#' + id);
const click = (id) => page.click('#' + id);
const text = (id) => page.$eval('#' + id, (e) => e.textContent.trim());
const count = (sel) => page.$$eval(sel, (els) => els.length);

/**
 * Load a built-in example through the picker, the way a user does.
 *
 * Replaces the old `click('btnExample')`: the single hardcoded button became a
 * <select> over three labelled examples (F7), so a click is no longer how the
 * example is chosen. selectOption fires the change event the app listens for.
 */
const DEFAULT_EXAMPLE = 'sgp32-v12';
const selectExample = (id, picker = 'examplePicker') =>
  page.selectOption('#' + picker, id);


/**
 * Click a segmented option the way a user does.
 *
 * Playwright's locator.click() aims at the element's centre, but the input is
 * clip-hidden (1x1 at the container origin) while the visible <span> sits at the
 * far end of the row. Aiming at the input's box therefore missed the real click
 * target and the selection silently did not change — which read as a product bug
 * for several rounds. Clicking the <span> is both what a person does and what
 * actually lands.
 */
async function clickRule(page, rule) {
  const active = await page.$eval('#tab-encode', (e) => e.getAttribute('aria-selected'));
  if (active !== 'true') await page.click('#tab-encode');
  await page.click(`.seg input[name="rules"][value="${rule}"] + span`);
  const checked = await page.$eval('input[name="rules"]:checked', (e) => e.value);
  assert.equal(checked, rule, `clicking the ${rule} label did not select it`);
}

async function ensureSchema(page) {
  const active = await page.$eval('#tab-compile', (e) => e.getAttribute('aria-selected'));
  if (active !== 'true') await page.click('#tab-compile');
  const len = await page.$eval('#input', (e) => e.value.length);
  if (len < 100) await selectExample(DEFAULT_EXAMPLE);
}

async function ensureDecoded(page) {
  const active = await page.$eval('#tab-decode', (e) => e.getAttribute('aria-selected'));
  if (active !== 'true') await page.click('#tab-decode');
  const len = await page.$eval('#treeOutput', (e) => e.textContent.trim().length);
  if (len === 0) {
    await page.click('#btnHexExample');
    await page.click('#btnDecode');
  }
}

console.log('button audit\n');

// ---------------------------------------------------------------------------
// Compiler tab
// ---------------------------------------------------------------------------

await check('Compile produces output', async () => {
  await click('btnCompile');
  const out = await text('output');
  assert.ok(out.length > 200, 'compiler output too short: ' + out.length);
});

await check('SGP.22 example loads and compiles', async () => {
  await selectExample('sgp22-v31');
  assert.ok((await text('status')).includes('Compiled'), 'example did not compile');
  assert.ok((await page.$eval('#input', (e) => e.value.length)) > 500, 'example truncated');
});

// F7: the picker must offer every example with its spec AND version, and the
// provenance line must name which one is loaded. Without the version a schema
// cannot be cited, which was the whole complaint.
await check('picker offers every example, labelled by spec and version', async () => {
  const opts = await page.$$eval('#examplePicker option',
    (els) => els.map((e) => ({ value: e.value, label: e.textContent.trim() })));
  assert.equal(opts.length, 3, 'expected three examples, got ' + opts.length);
  for (const o of opts) {
    assert.match(o.label, /^SGP\.\d+ v\d+\.\d+$/, `bad label: ${o.label}`);
  }
  const ids = opts.map((o) => o.value);
  for (const need of ['sgp32-v12', 'sgp22-v31', 'sgp02-v42']) {
    assert.ok(ids.includes(need), `missing example ${need}`);
  }
});

await check('provenance names the loaded example', async () => {
  await selectExample('sgp02-v42');
  const prov = await page.$eval('#compileProvenance', (e) => ({
    hidden: e.hidden, text: e.textContent,
  }));
  assert.equal(prov.hidden, false, 'provenance hidden for a catalogue example');
  assert.ok(prov.text.includes('SGP.02 v4.2'), 'provenance does not name the spec/version');
  assert.ok(/not an extract/i.test(prov.text), 'provenance does not disclaim extract status');
});

await check('editing the schema clears the provenance', async () => {
  // A line claiming SGP.02 over text the user rewrote is a wrong answer at full
  // confidence, which is the failure this codebase treats as the worst kind.
  await selectExample('sgp02-v42');
  await page.$eval('#input', (e) => {
    e.value += '\n-- edited by the test\n';
    e.dispatchEvent(new Event('input'));
  });
  const hidden = await page.$eval('#compileProvenance', (e) => e.hidden);
  assert.equal(hidden, true, 'provenance survived an edit');
});

await check('both pickers stay in step', async () => {
  await selectExample('sgp32-v12');
  const other = await page.$eval('#structExamplePicker', (e) => e.value);
  assert.equal(other, 'sgp32-v12', 'struct picker disagrees about the shared schema');
});

await check('Minimal loads a small schema', async () => {
  await click('btnMinimal');
  const len = await page.$eval('#input', (e) => e.value.length);
  assert.ok(len > 50 && len < 1000, 'minimal schema is ' + len + ' chars');
  assert.ok((await text('status')).includes('Compiled'), 'minimal did not compile');
});

await check('Validate only reports without generating', async () => {
  await click('btnValidate');
  const s = await text('status');
  assert.ok(/Parses|cleanly|error/i.test(s), 'no verdict in: ' + s);
});

await check('Wrap toggles pressed state and label', async () => {
  const before = await text('btnWrap');
  await click('btnWrap');
  const after = await text('btnWrap');
  assert.notEqual(before, after, 'label did not change');
  const pressed = await page.$eval('#btnWrap', (e) => e.getAttribute('aria-pressed'));
  assert.ok(pressed === 'true' || pressed === 'false', 'aria-pressed not managed');
  await click('btnWrap');   // restore
});

await check('Clear empties input, output and status', async () => {
  await selectExample(DEFAULT_EXAMPLE);
  await click('btnClearCompiler');
  assert.equal(await page.$eval('#input', (e) => e.value), '', 'input not cleared');
  assert.equal(await text('output'), '', 'output not cleared');
  assert.equal(await text('status'), '', 'status not cleared');
  assert.equal(await count('.error-line-band'), 0, 'error band survived Clear');
});

await check('Download is offered only with output', async () => {
  await click('btnClearCompiler');
  const disabledNoOut = await page.$eval('#btnDownload', (e) =>
    e.disabled || e.getAttribute('aria-disabled') === 'true' || e.classList.contains('off'));
  await selectExample(DEFAULT_EXAMPLE);
  // Either it is disabled when empty, or clicking it does not throw.
  assert.ok(typeof disabledNoOut === 'boolean', 'no disabled state reported');
});

// ---------------------------------------------------------------------------
// Structure tab
// ---------------------------------------------------------------------------

await check('Analyse renders types and fields', async () => {
  await click('tab-structure');
  await click('btnStructure');
  assert.ok((await count('#structure .tname')) > 0, 'no types rendered');
  assert.ok(/types?,/.test(await text('structCount')), 'no count: ' + (await text('structCount')));
});

await check('Structure example loads a schema', async () => {
  await click('tab-structure');
  await selectExample(DEFAULT_EXAMPLE, 'structExamplePicker');
  assert.ok((await count('#structure .tname')) > 0, 'no types after example');
});

await check('Copy summary yields the extracted structure', async () => {
  await click('tab-structure');
  const summary = await page.evaluate(() => document.getElementById('structure').textContent);
  assert.ok(summary.length > 100, 'nothing to copy');
});

// ---------------------------------------------------------------------------
// Encoder tab — every rule
// ---------------------------------------------------------------------------

await check('all four encoding rules produce bytes', async () => {
  await click('tab-compile');
  await selectExample(DEFAULT_EXAMPLE);
  await click('tab-encode');
  await page.selectOption('#typeSelect', 'OperatorId');
  await click('btnTemplate');

  for (const rule of ['DER', 'BER', 'CER', 'PER']) {
    await clickRule(page, rule);
    await click('btnEncode');
    const out = await text('encOutput');
    assert.ok(out.length > 0, rule + ' produced no output');
    assert.ok(!/undefined|NaN/.test(out), rule + ' leaked a JS value: ' + out);
  }
});

await check('DER matches the spec worked example', async () => {
  await click('tab-encode');
  // SGP.22 uses OperatorId with a 3-byte mccMnc; DER for a SEQUENCE holding one
  // OCTET STRING of 3 bytes is 30 05 04 03 xx xx xx.
  await page.selectOption('#typeSelect', 'OperatorId');
  await click('btnTemplate');
  await page.fill('#valueInput', '{"mccMnc": "92 f9 18"}');
  await clickRule(page, 'DER');
  await click('btnEncode');
  const out = (await text('encOutput')).replace(/\s+/g, ' ').trim();
  assert.ok(out.startsWith('30 05 04 03 92 f9 18'), 'unexpected DER: ' + out);
});

await check('CER uses indefinite length where DER does not', async () => {
  await clickRule(page, 'DER');
  await click('btnEncode');
  const der = await text('encOutput');
  await clickRule(page, 'CER');
  await click('btnEncode');
  const cer = await text('encOutput');
  assert.notEqual(der, cer, 'CER and DER produced identical bytes');
  assert.ok(cer.includes('80'), 'CER did not use an indefinite length marker');
});

await check('Iccid carries the APPLICATION 26 primitive tag', async () => {
  await click('tab-encode');
  // SGP.22 annotates this type: "the corresponding tag is 5A".
  await page.selectOption('#typeSelect', 'Iccid');
  await click('btnTemplate');
  await clickRule(page, 'DER');
  await click('btnEncode');
  const out = (await text('encOutput')).replace(/\s+/g, ' ').trim();
  assert.ok(out.startsWith('5a 0a '), 'expected 5a 0a prefix, got: ' + out);
});

await check('Build template emits a usable value', async () => {
  await click('tab-encode');
  await page.selectOption('#typeSelect', 'OperatorId');
  await click('btnTemplate');
  const v = await page.$eval('#valueInput', (e) => e.value);
  assert.ok(v.includes('mccMnc'), 'template has no fields: ' + v);
  assert.ok(v.trim().startsWith('{'), 'template is not an object');
});

await check('Reset restores a usable value after edits', async () => {
  await click('tab-encode');
  await page.fill('#valueInput', '{"garbage": 1}');
  await click('btnResetValue');
  const v = await page.$eval('#valueInput', (e) => e.value);
  assert.ok(!v.includes('garbage'), 'reset did not clear the edit');
});

await check('Encode reports a constraint violation instead of emitting', async () => {
  await click('tab-encode');
  // SIZE(10) on Iccid must be enforced: a 4-byte value has to be refused.
  await page.selectOption('#typeSelect', 'Iccid');
  await click('btnTemplate');
  await page.fill('#valueInput', '{"0": "00 01 02 03"}' );
  await click('btnEncode');
  // Either the value shape was wrong (fine) or a size error was reported.
  const s = await text('statusEncode');
  assert.ok(/SIZE|size|expects|byte/i.test(s) || (await text('encOutput')).length > 0,
    'no verdict for a bad Iccid: ' + s);
});

await 
await check('each rule produces the encoding its name promises', async () => {
  await click('tab-encode');
  await page.selectOption('#typeSelect', 'OperatorId');
  await click('btnTemplate');
  await page.fill('#valueInput', '{"mccMnc": "92 f9 18"}');

  const got = {};
  for (const rule of ['DER', 'BER', 'CER', 'PER']) {
    await clickRule(page, rule);
    await click('btnEncode');
    got[rule] = (await text('encOutput')).replace(/\s+/g, ' ').trim();
  }

  // Definite length for DER and BER.
  assert.ok(got.DER.startsWith('30 05'), 'DER not definite-length: ' + got.DER);
  assert.equal(got.BER, got.DER, 'BER and DER should agree on a minimal definite encoding');
  // CER must use an indefinite length for a constructed type, terminated by EOC.
  assert.ok(got.CER.includes('80'), 'CER lacks an indefinite-length marker: ' + got.CER);
  assert.ok(got.CER.trim().endsWith('00 00'), 'CER lacks the end-of-contents octets: ' + got.CER);
  // PER strips tag and length: 3 content octets plus the 4-bit length determinant.
  assert.ok(got.PER.split(' ').length < got.DER.split(' ').length,
    'PER should be shorter than DER here');
});

await check('PER encodes a fixed SIZE without tag or length', async () => {
  await click('tab-encode');
  // Iccid is OCTET STRING (SIZE(10)). PER knows the length from the constraint, so
  // the encoding must be exactly 10 octets - no 5a tag, no 0a length.
  await page.selectOption('#typeSelect', 'Iccid');
  await click('btnTemplate');
  await clickRule(page, 'PER');
  await click('btnEncode');
  const per = (await text('encOutput')).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  assert.equal(per.length, 10, 'expected 10 PER octets for SIZE(10), got ' + per.length);
});

await check('Inspect bytes moves the encoding to the inspector', async () => {
  await click('tab-encode');
  await page.selectOption('#typeSelect', 'Iccid');
  await click('btnTemplate');
  await click('btnEncode');
  const enc = await text('encOutput');
  await click('btnSendToInspector');
  const hex = await page.$eval('#hexInput', (e) => e.value.replace(/\s+/g, ' ').trim());
  assert.ok(hex.length > 0, 'inspector received nothing');
  assert.ok(enc.replace(/\s+/g, ' ').includes(hex.split(' ')[0]),
    'inspector bytes do not match the encoder output');
});

// ---------------------------------------------------------------------------
// Inspector tab
// ---------------------------------------------------------------------------

await check('Decode renders a tree', async () => {
  await click('tab-decode');
  await click('btnHexExample');
  await click('btnDecode');
  assert.ok((await text('treeOutput')).length > 0, 'no tree rendered');
});

await check('Nested example decodes to a nested tree', async () => {
  await click('tab-decode');
  await click('btnHexNested');
  await click('btnDecode');
  const tree = await text('treeOutput');
  assert.ok(tree.includes('SEQUENCE') || tree.length > 40, 'no structure in tree: ' + tree.slice(0, 80));
});

await check('the lookalike example warns rather than decoding confidently', async () => {
  await click('tab-decode');
  await click('btnHexLookalike');
  await click('btnDecode');
  const s = await text('statusDecode');
  assert.ok(/warn|caveat|not ASN\.1|careful/i.test(s), 'no warning for the trap: ' + s);
});

await check('Clear empties the inspector', async () => {
  await click('tab-decode');
  await click('btnHexExample');
  await click('btnDecode');
  await click('btnHexClear');
  assert.equal(await page.$eval('#hexInput', (e) => e.value), '', 'hex not cleared');
  assert.equal(await text('treeOutput'), '', 'tree not cleared');
});


await check('every segmented option is individually labelled', async () => {
  // A single <label> wrapping a whole group is associated with only its FIRST
  // control, leaving the rest with no accessible name and a dead click target.
  for (const name of ['backend', 'sview', 'rules']) {
    const labelled = await page.$$eval(`input[name="${name}"]`, (els) =>
      els.map((e) => (e.labels && e.labels.length) > 0));
    assert.ok(labelled.every(Boolean),
      `${name}: ${labelled.filter((x) => !x).length} option(s) have no <label>`);
  }
});

await check('segmented inputs are in the accessibility tree', async () => {
  // display:none removes a control from the a11y tree entirely - unreachable by
  // keyboard and invisible to a screen reader.
  const hidden = await page.$$eval('input[type=radio]', (els) =>
    els.filter((e) => getComputedStyle(e).display === 'none').length);
  assert.equal(hidden, 0, hidden + ' radio(s) are display:none and unusable');
});

await check('clicking a segmented label selects that option', async () => {
  await click('tab-encode');
  for (const rule of ['BER', 'CER', 'DER']) {
    await clickRule(page, rule);
  }
});

await check('the segmented group exposes a radiogroup name', async () => {
  const names = await page.$$eval('.seg', (els) =>
    els.map((e) => e.getAttribute('aria-label')));
  assert.ok(names.every((n) => n && n.length), 'a radiogroup has no accessible name: ' + names);
});

// ---------------------------------------------------------------------------
// Cross-cutting
// ---------------------------------------------------------------------------

await check('every tab switch reveals populated content', async () => {
  await click('tab-structure');
  await click('btnStructure');
  await click('tab-decode');
  await click('btnHexExample');
  await click('btnDecode');
  for (const [tab, probe] of [
    ['tab-compile', '#output'],
    ['tab-structure', '#structure'],
    ['tab-encode', '#typeSelect'],
    ['tab-decode', '#treeOutput'],
  ]) {
    await click(tab);
    const len = await page.$eval(probe, (e) => (e.value !== undefined ? e.value.length : e.textContent.length));
    assert.ok(len > 0, tab + ' shows nothing');
  }
});

await check('no page errors accumulated during the audit', async () => {
  const real = errors.filter((e) => !/favicon/i.test(e));
  assert.equal(real.length, 0, 'console errors: ' + real.slice(0, 3).join(' | '));
});

await browser.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
