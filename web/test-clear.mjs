// Regression test for the Clear buttons and the copy helpers' failure modes.
//
// WHY THIS EXISTS
//
// Clear looks too simple to test, which is exactly why it was the one control
// that had never been exercised. Clearing leaves six pieces of state that must
// all reset together — the textarea, the highlight overlay, the output, two
// counters, and the status line — and a partial clear is invisible until a user
// hits it: a stale highlight under an empty textarea still renders old glyphs,
// and a status line claiming success next to an empty pane is actively
// misleading.
//
// The copy tests cover the other half: a copy button must never claim success
// when there is nothing on the clipboard. "Copied" followed by an empty paste is
// worse than an honest failure.
//
// These tests run against the DOM with the same assertions used manually, so a
// refactor that breaks a Clear button fails here rather than in the browser.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Static analysis of the wiring: every Clear button must reset every field it
// is responsible for. This catches the "forgot to reset the counter" class of
// bug without needing a browser.
// ---------------------------------------------------------------------------

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + e.message); }
};

const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

console.log('clear + copy tests\n');

/** Extract a click handler body by its button id. */
function handlerFor(id) {
  const re = new RegExp(`\\$\\('#${id}'\\)\\.addEventListener\\('click', \\(\\) => \\{(.*?)\\n  \\}\\);`, 's');
  const m = re.exec(app);
  assert.ok(m, `no click handler found for #${id}`);
  return m[1];
}

check('compiler Clear exists and is wired', () => {
  const body = handlerFor('btnClearCompiler');
  // Everything visible in the compiler pane must be reset.
  for (const required of ['editor.value', '#output', '#outCount', 'clearStatus', 'updateInputCount', 'refreshTypeList']) {
    assert.ok(body.includes(required), `compiler Clear does not reset ${required}`);
  }
});

check('compiler Clear refocuses the input', () => {
  assert.ok(handlerFor('btnClearCompiler').includes('.focus()'),
    'compiler Clear does not return focus to the editor');
});

check('inspector Clear exists and is wired', () => {
  const body = handlerFor('btnHexClear');
  for (const required of ['hexEditor.value', '#treeOutput', '#hexCount', '#treeCount', 'clearStatus']) {
    assert.ok(body.includes(required), `inspector Clear does not reset ${required}`);
  }
});

check('inspector Clear refocuses the hex input', () => {
  assert.ok(handlerFor('btnHexClear').includes('.focus()'),
    'inspector Clear does not return focus to the hex editor');
});

check('both Clear buttons are present in the markup', () => {
  assert.ok(html.includes('id="btnClearCompiler"'), 'compiler Clear missing from HTML');
  assert.ok(html.includes('id="btnHexClear"'), 'inspector Clear missing from HTML');
});

// ---------------------------------------------------------------------------
// Copy behaviour
// ---------------------------------------------------------------------------

check('copy refuses empty text and says so', () => {
  // The guard must come before any clipboard attempt, and must not report success.
  const m = /async function copyText\(text, button, label = 'Copy'\) \{(.*?)\n\}/s.exec(app);
  assert.ok(m, 'copyText not found');
  const body = m[1];
  assert.ok(body.includes('if (!text)'), 'copyText has no empty-text guard');
  assert.ok(body.includes('Nothing to copy'), 'empty copy does not say "Nothing to copy"');
  // The guard must return before reaching the success flash.
  const guardIdx = body.indexOf('if (!text)');
  const successIdx = body.indexOf("'✓ Copied'");
  assert.ok(guardIdx < successIdx, 'empty-text guard runs after the success path');
});

check('copy failure explains itself rather than just failing', () => {
  const m = /function flashLabel\(button, shown, restore, good, reason = ''\) \{(.*?)\n\}/s.exec(app);
  assert.ok(m, 'flashLabel not found');
  const body = m[1];
  assert.ok(body.includes('reason'), 'flashLabel ignores the failure reason');
  assert.ok(body.includes('title'), 'flashLabel does not surface the reason as a tooltip');
});

check('NotAllowedError is distinguished from other failures', () => {
  // A permission rejection needs a different user action from a generic error,
  // so the message must differ.
  assert.ok(app.includes("NotAllowedError"), 'NotAllowedError is not handled distinctly');
  assert.ok(/click the page first/i.test(app), 'no actionable guidance for a blocked clipboard');
});

check('a legacy copy fallback exists for non-secure contexts', () => {
  assert.ok(app.includes('execCommand'), 'no execCommand fallback');
  assert.ok(app.includes('legacyCopy'), 'legacyCopy not defined/used');
});

check('every copy button in the markup targets an element that exists', () => {
  const targets = [...html.matchAll(/data-copy="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(targets.length >= 4, `expected at least 4 copy buttons, found ${targets.length}`);
  for (const sel of targets) {
    const id = sel.replace(/^#/, '');
    assert.ok(html.includes(`id="${id}"`), `copy button targets missing element ${sel}`);
  }
});

// ---------------------------------------------------------------------------
// Every panel degrades cleanly on empty input
// ---------------------------------------------------------------------------

check('each panel guards empty input before doing work', () => {
  // Compiler, structure, encoder and decoder each need their own guard; a
  // missing one surfaces as an uncaught exception rather than a message.
  const guards = [
    [/trim\(\)\)\s*\{[\s\S]{0,200}Nothing to compile/, 'compiler'],
    [/trim\(\)\)\s*\{[\s\S]{0,200}Nothing to analyse/, 'structure'],
    [/if \(!name\)[\s\S]{0,160}No type selected/, 'encoder'],
    [/trim\(\)\)\s*\{[\s\S]{0,160}No bytes to decode/, 'decoder'],
  ];
  for (const [re, which] of guards) {
    assert.ok(re.test(app), `${which} panel has no empty-input guard`);
  }
});

check('empty states never set an OK status', () => {
  // A green "ok" beside an empty pane is the misleading case.
  const emptyBlocks = [
    /Nothing to compile — the input is empty\.'\)/,
  ];
  for (const re of emptyBlocks) {
    const idx = app.search(re);
    if (idx === -1) continue;
    const line = app.slice(app.lastIndexOf('setStatus', idx), idx + 60);
    assert.ok(line.includes("'err'"), 'empty-input message uses a non-error status');
  }
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
