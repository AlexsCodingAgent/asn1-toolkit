// Cache-busting integrity: no local asset may ship unversioned.
//
// WHY THIS EXISTS
//
// This is the bug that reached the user. GitHub Pages serves .js with
// `cache-control: max-age=14400` - four hours. Only app.js, style.css and the wasm
// were version-stamped, but app.js statically imports seven more local modules by
// their own unversioned URLs. So after a deploy a browser could run:
//
//     NEW app.js  +  CACHED OLD structure.js / encode.js / highlight.js
//
// The new app calls into modules that do not have the new functions, and a failed
// module init is not surfaced anywhere the user can see. The Structure and Encoder
// panels then did nothing when their buttons were pressed.
//
// Which is why "the buttons don't work" was accurate AND my earlier "the buttons
// all work" was also accurate: I tested after a hard reload with fresh modules,
// the user was running a mixed set.
//
// NO REGULAR EXPRESSIONS IN THIS FILE
//
// Every regex written into this file through an editing layer arrived with doubled
// backslashes, so a pattern meant as `from\s+` was stored as `from\\s+` - which
// matches a literal backslash, finds nothing, and makes correct code look broken.
// That cost more debugging cycles than the original bug. Import specifiers are
// trivial to find with indexOf, and that cannot be quietly wrong.

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + e.message); }
};

const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const ci = readFileSync(new URL('.github/workflows/pages.yml', import.meta.url), 'utf8');

console.log('cache busting\n');

/**
 * Every `from '<spec>'` in a source string, as raw specifier text.
 * Index-based: no regex, nothing to escape.
 */
function specifiers(src) {
  const out = [];
  const NEEDLE = 'from';
  const SPACE = ' ', TAB = '\t';
  const QUOTES = ["'", '"'];
  let i = 0;
  while ((i = src.indexOf(NEEDLE, i)) !== -1) {
    let j = i + NEEDLE.length;
    const nextCh = src[j] || '';
    if (nextCh && /[A-Za-z0-9_$]/.test(nextCh)) { i = j; continue; }   // `fromage`
    while (src[j] === SPACE || src[j] === TAB) j++;
    const q = src[j];
    if (!QUOTES.includes(q)) { i = j; continue; }
    const close = src.indexOf(q, j + 1);
    if (close === -1) { i = j + 1; continue; }
    out.push({ start: j + 1, end: close, spec: src.slice(j + 1, close) });
    i = close + 1;
  }
  return out;
}

/** Local ES module specifiers only. */
const isLocalModule = (s) => s.startsWith('./') && s.split('?')[0].endsWith('.js');
const localImports = specifiers(app).filter((s) => isLocalModule(s.spec));

// ---------------------------------------------------------------------------
// 1. Source state
// ---------------------------------------------------------------------------

check('the app imports local modules at all', () => {
  assert.ok(localImports.length >= 6,
    'expected several local module imports, found ' + localImports.length);
});

check('no import specifier contains an uninterpolated placeholder', () => {
  // Regression guard for a mistake actually made: stamping the source with a
  // template placeholder pasted that literal text into every URL. Static import
  // specifiers are resolved before any code runs, so a runtime constant can never
  // be used in one.
  const bad = localImports.filter((s) => s.spec.includes('$'));
  assert.equal(bad.length, 0,
    'static imports cannot be built from a runtime constant: ' + bad.map((b) => b.spec).join(', '));
});

check('every imported module exists on disk', () => {
  for (const s of localImports) {
    const file = new URL(s.spec.split('?')[0], import.meta.url);
    assert.ok(existsSync(file), 'import points at a missing file: ' + s.spec);
  }
});

check('source imports are unstamped or uniformly stamped, never mixed', () => {
  // Source keeps clean paths and CI stamps the deployed copy. A MIX is the desync
  // case this file exists for, and it would survive a careless manual edit.
  const versioned = localImports.filter((s) => s.spec.includes('?v=')).length;
  assert.ok(versioned === 0 || versioned === localImports.length,
    'half-stamped imports (' + versioned + ' of ' + localImports.length +
    ') - some modules would load from cache and others would not');
});

// ---------------------------------------------------------------------------
// 2. The stamping script, run for real
// ---------------------------------------------------------------------------

check('stamp-modules versions every import', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stamp-'));
  copyFileSync(new URL('./app.js', import.meta.url), join(dir, 'app.js'));
  copyFileSync(new URL('./stamp-modules.mjs', import.meta.url), join(dir, 'stamp-modules.mjs'));

  const r = spawnSync('node', ['stamp-modules.mjs', 'TS1'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, 'stamp-modules failed: ' + (r.stderr || r.stdout));

  const stamped = readFileSync(join(dir, 'app.js'), 'utf8');
  const after = specifiers(stamped).filter((s) => isLocalModule(s.spec));
  assert.ok(after.length >= 6, 'expected several local imports, found ' + after.length);

  // The invariant is that NOTHING is left unversioned — not that this run was the
  // one to stamp it. CI stamps app.js before running the suites, so by the time
  // this executes the imports may already carry a version, and asserting `?v=TS1`
  // specifically failed a perfectly good pipeline.
  const unversioned = after.filter((s) => !s.spec.includes('?v=')).map((s) => s.spec);
  assert.equal(unversioned.length, 0, 'left unversioned: ' + unversioned.join(', '));

  // No doubling, and no specifier collapsed to nothing. Checked with indexOf —
  // every regex literal in this file arrived doubled and matched the wrong thing.
  for (const s of after) {
    const first = s.spec.indexOf('?v=');
    assert.ok(first === -1 || s.spec.indexOf('?v=', first + 1) === -1,
      'a specifier was stamped twice: ' + s.spec);
  }
  assert.ok(!stamped.includes("from ''") && !stamped.includes('from ""'),
    'specifiers were corrupted to empty strings');

  rmSync(dir, { recursive: true, force: true });
});

check('stamp-modules is idempotent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stamp-'));
  copyFileSync(new URL('./app.js', import.meta.url), join(dir, 'app.js'));
  copyFileSync(new URL('./stamp-modules.mjs', import.meta.url), join(dir, 'stamp-modules.mjs'));

  assert.equal(spawnSync('node', ['stamp-modules.mjs', 'TS1'], { cwd: dir }).status, 0);
  const once = readFileSync(join(dir, 'app.js'), 'utf8');
  assert.equal(spawnSync('node', ['stamp-modules.mjs', 'TS2'], { cwd: dir }).status, 0);
  const twice = readFileSync(join(dir, 'app.js'), 'utf8');

  assert.equal(twice, once, 'second run changed the file');
  assert.ok(!twice.includes('TS2'), 'second run restamped over the first');

  rmSync(dir, { recursive: true, force: true });
});

check('stamp-modules fails loudly rather than shipping nothing stamped', () => {
  // Three broken patterns were produced while building this, each silently
  // matching nothing and looking identical from the outside. The script must
  // refuse rather than write a file it did not understand.
  const dir = mkdtempSync(join(tmpdir(), 'stamp-'));
  copyFileSync(new URL('./stamp-modules.mjs', import.meta.url), join(dir, 'stamp-modules.mjs'));
  writeFileSync(join(dir, 'app.js'), 'const x = 1;\n');
  const r = spawnSync('node', ['stamp-modules.mjs', 'T'], { cwd: dir, encoding: 'utf8' });
  assert.notEqual(r.status, 0, 'the script should fail when it finds nothing to stamp');
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 3. Page references and the wasm
// ---------------------------------------------------------------------------

check('the page loads a versioned stylesheet and app.js', () => {
  assert.ok(html.includes('style.css?v='), 'style.css is unversioned');
  assert.ok(html.includes('app.js?v='), 'app.js is unversioned');
});

check('the wasm is loaded with an explicit versioned URL', () => {
  // The wasm is not an ES import: the glue's init() computes its own default URL,
  // so passing it explicitly is the only way to control the cache key.
  assert.ok(app.includes('asn1_toolkit_bg.wasm?v='),
    'the wasm is loaded without an explicit versioned URL - it will be cached for 4h');
});

// ---------------------------------------------------------------------------
// 4. The mechanism cannot silently disappear
// ---------------------------------------------------------------------------

check('CI runs the stamping script before deploying', () => {
  assert.ok(ci.includes('stamp-modules.mjs'), 'the stamping step is gone from CI');
});

check('CI fails the build on an unversioned asset', () => {
  assert.ok(ci.includes('exit 1'), 'nothing fails the build on an unversioned asset');
  assert.ok(/unversioned/i.test(ci), 'the guard does not describe what it checks');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
