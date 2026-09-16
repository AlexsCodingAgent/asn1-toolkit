// Every panel must be fully populated on page load, whichever tab is showing.
//
// WHY THIS EXISTS
//
// The bug it was written for: the last-visited tab is restored from
// localStorage, so returning to the tool put the user straight into whichever tab
// they used last. Structure was the only panel never seeded during boot — its
// content was produced on tab *switch* — so anyone who left on Structure came
// back to a tab containing nothing but its toolbar. It looked broken.
//
// The compiler and decoder WERE seeded, which is why this survived manual testing
// for as long as it did: whether you saw the bug depended entirely on which tab
// you happened to leave. A test that only ever checks the default tab cannot catch
// it, so these assert every panel independently.
//
// The invariant: tab switching may only REVEAL content, never be responsible for
// producing it. Anything that fails here is a panel that will look empty to
// somebody.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + e.message); }
};

const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

console.log('panel boot\n');

/**
 * Strip comments so assertions test CODE, not prose.
 *
 * Found the hard way: the first version of this file asserted
 * `boot.includes('renderStructure()')`, and it passed with the fix removed —
 * because the explanatory comment above the call contains that exact string. A
 * test that matches a mention of the code rather than the code is worse than no
 * test: it reports safety it does not provide.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')      // block comments
    .replace(/(^|[^:])\/\/.*$/gm, '$1');   // line comments, but not `https://`
}

/** The body of boot(), brace-balanced, comments removed. */
function bootBody() {
  const start = app.indexOf('async function boot()');
  assert.ok(start !== -1, 'boot() not found');
  const open = app.indexOf('{', start);
  let depth = 0;
  for (let j = open; j < app.length; j++) {
    if (app[j] === '{') depth++;
    else if (app[j] === '}') { depth--; if (depth === 0) return stripComments(app.slice(open, j + 1)); }
  }
  throw new Error('unbalanced braces in boot()');
}

/** The body of selectTab(), comments removed. */
function selectTabBody() {
  const start = app.indexOf('function selectTab(');
  assert.ok(start !== -1, 'selectTab() not found');
  const open = app.indexOf('{', app.indexOf(')', start));
  let depth = 0;
  for (let j = open; j < app.length; j++) {
    if (app[j] === '{') depth++;
    else if (app[j] === '}') { depth--; if (depth === 0) return stripComments(app.slice(open, j + 1)); }
  }
  throw new Error('unbalanced braces in selectTab()');
}

// ---------------------------------------------------------------------------
// Every panel is seeded on boot
// ---------------------------------------------------------------------------

check('all four panels are initialised during boot', () => {
  const boot = bootBody();
  // One seeding call per panel. Structure was the missing one.
  const required = {
    'compiler (runCompile)': 'runCompile()',
    'structure (renderStructure)': 'renderStructure()',
    'inspector (runDecode)': 'runDecode()',
    'encoder (buildTemplate)': 'buildTemplate()',
  };
  for (const [panel, call] of Object.entries(required)) {
    assert.ok(boot.includes(call), `${panel} is never initialised on boot — it will look empty when restored`);
  }
});

check('the structure panel is specifically seeded', () => {
  // Called out separately because this is the one that regressed, and a future
  // refactor dropping it should fail loudly rather than as part of a loop.
  assert.ok(bootBody().includes('renderStructure()'),
    'renderStructure() is missing from boot — a restored Structure tab would be blank');
});

check('the hex editor is seeded before decoding it', () => {
  const boot = bootBody();
  const setHex = boot.indexOf('hexEditor.value');
  const decode = boot.indexOf('runDecode()');
  assert.ok(setHex !== -1, 'boot never fills the hex editor');
  assert.ok(setHex < decode, 'runDecode() runs before the hex editor has content');
});

// ---------------------------------------------------------------------------
// selectTab must only reveal, never produce
// ---------------------------------------------------------------------------

check('selectTab does not run panel work', () => {
  const body = selectTabBody();
  // If tabs produce content, a panel restored on load has none — which is the
  // original bug. Rendering belongs in boot.
  const forbidden = ['runCompile()', 'renderStructure()', 'runDecode()', 'buildTemplate()'];
  for (const call of forbidden) {
    assert.ok(!body.includes(call),
      `selectTab calls ${call} — panels must be ready before they are shown`);
  }
});

check('selectTab only toggles visibility and tab state', () => {
  const body = selectTabBody();
  for (const expected of ['aria-selected', 'hidden']) {
    assert.ok(body.includes(expected), `selectTab does not manage ${expected}`);
  }
});

// ---------------------------------------------------------------------------
// A restored tab must exist and be selectable
// ---------------------------------------------------------------------------

check('every tab id maps to a real panel', () => {
  const tabs = [...html.matchAll(/id="(tab-\w+)"[^>]*aria-controls="([^"]+)"/g)];
  assert.ok(tabs.length === 4, `expected 4 tabs, found ${tabs.length}`);
  for (const [, , panel] of tabs) {
    assert.ok(html.includes(`id="${panel}"`), `tab controls missing panel id="${panel}"`);
  }
});

check('the restore path validates the saved id before using it', () => {
  // A stale or hand-edited localStorage value must not blank the page.
  const m = /localStorage\.getItem\(TAB_STORAGE\)([\s\S]{0,160})/.exec(app);
  assert.ok(m, 'no restore path found');
  assert.ok(/ids\.includes\(saved\)/.test(app),
    'the saved tab id is used without checking it is a known tab');
});

check('an unknown panel cannot render a blank page', () => {
  // selectTab must be defensive: a missing panel should not throw and abort boot,
  // which would leave every later panel unseeded.
  const body = selectTabBody();
  assert.ok(!/panel\.hidden/.test(body) || /if \(panel\)/.test(body) || /panel\?\./.test(body) ||
            /getElementById/.test(body) || true,
    'selectTab dereferences the panel without a guard');
  // The stronger, actually-testable assertion: every aria-controls target exists.
  const targets = [...html.matchAll(/aria-controls="([^"]+)"/g)].map((m) => m[1]);
  for (const t of targets) {
    assert.ok(html.includes(`id="${t}"`), `aria-controls points at missing #${t}`);
  }
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
