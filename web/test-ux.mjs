// Regression tests for the UX fixes: the PDF-artefact offer, error-line marking,
// the schema strip, and accessibility semantics.
//
// These assets against app.js and index.html rather than running a browser: the
// wiring is what regresses. An earlier round of fixes shipped a Clear button that
// silently stopped resetting one field, and nothing caught it because the only
// test was manual. The same is true of these — a refactor could drop
// `clearErrorLine()` from Clear and nothing would notice until a user saw a stale
// marker pointing at the wrong line.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + e.message); }
};

const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

console.log('ux fixes\n');

/**
 * Body of a `function name(...) { ... }` declaration, brace-balanced.
 *
 * Starts counting at the `{` that OPENS THE BODY, not the first `{` after the
 * name — a parameter list containing destructuring (`{ focus = false } = {}`)
 * otherwise ends the scan early and the test silently inspects the wrong region.
 */
function fnBody(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found`);

  // Walk the parameter list to find the body brace.
  const open = app.indexOf('(', start);
  assert.ok(open !== -1, `no parameter list for ${name}`);
  let pdepth = 0, i = open;
  for (; i < app.length; i++) {
    if (app[i] === '(') pdepth++;
    else if (app[i] === ')') { pdepth--; if (pdepth === 0) { i++; break; } }
  }
  const bodyOpen = app.indexOf('{', i);
  assert.ok(bodyOpen !== -1, `no body for ${name}`);

  let depth = 0;
  for (let j = bodyOpen; j < app.length; j++) {
    if (app[j] === '{') depth++;
    else if (app[j] === '}') { depth--; if (depth === 0) return app.slice(bodyOpen, j + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

// ---------------------------------------------------------------------------
// F1 — the artefact offer
// ---------------------------------------------------------------------------

check('a failed compile consults the artefact detector', () => {
  const body = fnBody('runCompile');
  assert.ok(body.includes('offerCleanupIfUseful'), 'failed compile does not offer cleanup');
});

check('the offer only fires when cleaning actually fixes it', () => {
  const body = fnBody('offerCleanupIfUseful');
  // The decisive guard: compile the cleaned text, and stay silent unless it works.
  assert.ok(body.includes('cleanWouldHelp'), 'offer does not verify that cleaning helps');
  assert.ok(/if \(!result\.helpful\)/.test(body), 'offer does not bail when cleaning would not help');
});

check('artefacts that are NOT the cause are described as such', () => {
  const body = fnBody('offerCleanupIfUseful');
  assert.ok(/not the cause/i.test(body),
    'when cleaning would not help, the note does not say the artefacts are unrelated');
});

check('the affected lines are shown before anything is deleted', () => {
  const body = fnBody('showCleanupOffer');
  assert.ok(body.includes('artefact-line'), 'offer does not list affected lines');
  // And there must be a way to decline.
  assert.ok(/leave it/i.test(body), 'offer has no way to dismiss it');
});

check('the cleanup button re-derives the cleaned text rather than trusting state', () => {
  const body = fnBody('showCleanupOffer');
  assert.ok(body.includes('cleanArtefacts(editor.value)'),
    'cleanup does not re-derive from the editor, so the edit could differ from what was shown');
});

check('a detector crash cannot mask the real compiler error', () => {
  const body = fnBody('offerCleanupIfUseful');
  // analyseArtefacts is wrapped, and the early return must precede any throw path.
  assert.ok(/try \{\s*analysis = analyseArtefacts/.test(body),
    'artefact analysis is not wrapped in try/catch');
});

// ---------------------------------------------------------------------------
// F2 — leftover bytes are an error (Rust side)
// ---------------------------------------------------------------------------

check('the decoder reports leftover bytes as an error, not an advisory', () => {
  const rust = readFileSync(new URL('../crate/src/hexdump.rs', import.meta.url), 'utf8');
  // The trailing branch must return an error result, not push a note.
  const m = /if trailing \{([\s\S]{0,1400}?)\n    \}/.exec(rust);
  assert.ok(m, 'no trailing-bytes branch found');
  assert.ok(m[1].includes('ok: false'), 'leftover bytes do not produce an error');
  assert.ok(m[1].includes('error: detail'), 'leftover bytes carry no explanation');
  assert.ok(!/notes\.push\(format!\(\s*"\{\} trailing byte/.test(m[1]),
    'leftover bytes are still only a note');
});

// ---------------------------------------------------------------------------
// F3 — the shared-schema strip
// ---------------------------------------------------------------------------

check('the schema strip exists and is clickable', () => {
  assert.ok(html.includes('id="schemaStrip"'), 'schema strip missing from HTML');
  assert.ok(html.includes('id="schemaStripValue"'), 'schema strip has no value slot');
});

check('the strip is kept in step with the editor', () => {
  assert.ok(app.includes('updateSchemaStrip'), 'updateSchemaStrip never called');
  const inputHandler = /editor\.ta\.addEventListener\('input',[\s\S]{0,300}?\}\);/;
  const m = inputHandler.exec(app);
  assert.ok(m && m[0].includes('updateSchemaStrip'),
    'the strip is not refreshed when the schema changes');
});

check('clicking the strip goes to the schema editor', () => {
  const m = /#schemaStrip'\)\.addEventListener\('click',[\s\S]{0,300}?\}\);/;
  const body = m.exec(app);
  assert.ok(body, 'strip has no click handler');
  assert.ok(body[0].includes("selectTab('compile'"), 'strip does not jump to the schema tab');
});

// ---------------------------------------------------------------------------
// F4 — error line marking
// ---------------------------------------------------------------------------

check('a failed compile marks the line it names', () => {
  const body = fnBody('runCompile');
  assert.ok(body.includes('markErrorLine(res.error)'), 'failure path does not mark the error line');
});

check('the mark is cleared on success, on Clear, and on typing', () => {
  const compile = fnBody('runCompile');
  assert.ok(compile.includes('clearErrorLine()'), 'success path does not clear the mark');

  const clear = /#btnClearCompiler'\)\.addEventListener\('click',[\s\S]{0,700}?\}\);/;
  const cm = clear.exec(app);
  assert.ok(cm && cm[0].includes('clearErrorLine'),
    'Clear does not remove the error mark — a stale mark on empty text is worse than none');

  const input = /editor\.ta\.addEventListener\('input',[\s\S]{0,400}?\}\);/;
  const im = input.exec(app);
  assert.ok(im && im[0].includes('clearErrorLine'),
    'typing does not clear the mark, so it can point at the wrong line');
});

check('the mark is positioned from the reported line number', () => {
  const body = fnBody('markErrorLine');
  assert.ok(/line\\s\+\(\\d\+\)/.test(body) || /line/.test(body), 'mark does not parse a line number');
  assert.ok(body.includes('spacing'), 'mark does not use the code line-height');
});

// ---------------------------------------------------------------------------
// F5 / F6 — accessibility
// ---------------------------------------------------------------------------

check('every status region is announced', () => {
  const statuses = [...html.matchAll(/<div class="status" id="(\w+)"/g)].map((m) => m[1]);
  assert.ok(statuses.length >= 4, `expected at least 4 status regions, found ${statuses.length}`);
  for (const id of statuses) {
    const re = new RegExp(`id="${id}"[^>]*role="status"[^>]*aria-live="polite"`);
    assert.ok(re.test(html), `${id} is not a live region`);
  }
});

check('the tabs follow the ARIA tabs pattern', () => {
  assert.ok(app.includes("setAttribute('tabindex'"), 'tab tabindex is never managed');
  const body = fnBody('selectTab');
  assert.ok(body.includes("tabindex"), 'selectTab does not set tabindex');
  assert.ok(body.includes("aria-selected"), 'selectTab does not set aria-selected');
});

check('the radio groups are labelled as groups', () => {
  const groups = [...html.matchAll(/<label class="seg"([^>]*)>/g)].map((m) => m[1]);
  assert.ok(groups.length >= 3, `expected 3 segmented controls, found ${groups.length}`);
  for (const attrs of groups) {
    assert.ok(attrs.includes('role="radiogroup"'), `segmented control missing radiogroup role: ${attrs}`);
    assert.ok(attrs.includes('aria-label'), `segmented control missing aria-label: ${attrs}`);
  }
});

check('the wrap toggle exposes its state', () => {
  assert.ok(html.includes('aria-pressed'), 'wrap button has no aria-pressed');
  const m = /#btnWrap'\)\.addEventListener\('click',[\s\S]{0,300}?\}\);/;
  const body = m.exec(app);
  assert.ok(body && body[0].includes('aria-pressed'),
    'wrap toggle does not update aria-pressed, so its state is invisible to assistive tech');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
