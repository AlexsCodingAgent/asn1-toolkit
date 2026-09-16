/**
 * Version stamp every local module import in app.js.
 *
 * WHY THIS IS NEEDED
 *
 * GitHub Pages serves .js with `cache-control: max-age=14400` — four hours. Only
 * app.js, style.css and the wasm were version-stamped, but app.js statically
 * imports seven more local modules by their own unversioned URLs. After a deploy
 * a browser could therefore run:
 *
 *     NEW app.js  +  CACHED OLD structure.js / encode.js / highlight.js
 *
 * The new app calls into modules that do not have the new functions, and a failed
 * module init is not surfaced anywhere the user can see it — so the Structure and
 * Encoder panels simply did nothing when their buttons were pressed.
 *
 * This runs over the DEPLOYED copy, not the source: static import specifiers are
 * resolved before any code executes, so they cannot be built from a runtime
 * constant, and stamping the source would break the test suites.
 *
 * WHY THIS IS WRITTEN WITHOUT REGULAR EXPRESSIONS
 *
 * Building the pattern from string fragments went wrong three separate times, each
 * producing a pattern that silently matched nothing — a doubled backslash, then a
 * missing leading dot. Every failure looked identical from the outside ("found no
 * imports") and cost a debugging cycle. Escaping is not the problem worth solving
 * here; finding import specifiers is trivial without it. The function below is
 * longer than a regex and cannot be quietly wrong about backslashes.
 *
 * Usage: node stamp-modules.mjs <stamp>
 */

import { readFileSync, writeFileSync } from 'node:fs';

const stamp = process.argv[2] || 'dev';
const Q = "'";
const DQ = '"';

/** Find each `from '<spec>'` / `from "<spec>"` and its index range. */
function findSpecifiers(src) {
  const out = [];
  let i = 0;
  const NEEDLE = 'from';
  while ((i = src.indexOf(NEEDLE, i)) !== -1) {
    let j = i + NEEDLE.length;
    if (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) { i = j; continue; }  // e.g. `fromage`
    while (j < src.length && (src[j] === ' ' || src[j] === '\t')) j++;
    const q = src[j];
    if (q !== Q && q !== DQ) { i = j; continue; }
    const close = src.indexOf(q, j + 1);
    if (close === -1) { i = j + 1; continue; }
    out.push({ start: j + 1, end: close, spec: src.slice(j + 1, close) });
    i = close + 1;
  }
  return out;
}

const appPath = new URL('./app.js', import.meta.url);
const src = readFileSync(appPath, 'utf8');

const specs = findSpecifiers(src);
const local = specs.filter((s) => s.spec.startsWith('./') && s.spec.split('?')[0].endsWith('.js'));

if (!local.length) {
  console.error('stamp-modules: found no local module specifiers. Nothing was written.');
  process.exit(1);
}

// Rewrite back-to-front so earlier offsets stay valid.
let out = src;
let stampedCount = 0;
for (const s of [...local].sort((a, b) => b.start - a.start)) {
  if (s.spec.includes('?v=')) continue;                 // already versioned
  const replacement = s.spec + '?v=' + stamp;
  out = out.slice(0, s.start) + replacement + out.slice(s.end);
  stampedCount++;
}

// --- Verify before writing -------------------------------------------------

const after = findSpecifiers(out)
  .filter((s) => s.spec.startsWith('./') && s.spec.split('?')[0].endsWith('.js'));

const unversioned = after.filter((s) => !s.spec.includes('?v=')).map((s) => s.spec);
if (unversioned.length) {
  console.error('stamp-modules: left unversioned: ' + unversioned.join(', '));
  process.exit(1);
}
if (after.some((s) => s.spec.includes('?v=') && s.spec.split('?v=')[1].includes('?v='))) {
  console.error('stamp-modules: produced a double-stamped URL');
  process.exit(1);
}
// A corrupted transform collapses a specifier to nothing.
if (after.some((s) => s.spec.trim() === '')) {
  console.error('stamp-modules: a specifier was emptied');
  process.exit(1);
}

writeFileSync(appPath, out);
console.log('stamp-modules: versioned ' + stampedCount + ' of ' + after.length + ' local imports with v=' + stamp);
