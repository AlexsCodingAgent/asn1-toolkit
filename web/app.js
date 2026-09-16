// ASN.1 Toolkit — application logic.
//
// Four panels over shared state: the schema text. The WASM module provides
// compilation and byte decoding; parsing, highlighting and encoding are local JS
// modules (see the notes inside each for why).

import init, {
  compile,
  validate,
  compiler_version,
  example_schema,
  example_minimal,
  hex_to_tree,
  example_hex,
  example_hex_3digit,
  example_hex_lookalike,
  example_hex_nested,
} from './pkg/asn1_toolkit.js';

import { formatRust } from './format.js';
import { formatTypescript } from './format-ts.js';
import { parseStructure } from './structure.js';
import { encodeValue, encodeValuePer, toHex, valueTemplate, RULES } from './encode.js';
import { highlightAsn1, highlightHex, hexByteCount } from './highlight.js';
import { analyseArtefacts, cleanArtefacts, cleanWouldHelp } from './clean.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// Single build stamp for every asset this page loads: the stylesheet, the wasm
// binary, and the module URLs in index.html. Bump it on release so a redeploy is
// never masked by a cached asset.
const BUILD = '0.4.0';


// ---------------------------------------------------------------------------
// Copy / download helpers — the reason this tool exists is so people can take
// the output away, so copying must be robust rather than an afterthought.
// ---------------------------------------------------------------------------

const copyTimers = new WeakMap();

async function copyText(text, button, label = 'Copy') {
  if (!text) {
    // Nothing to copy. Say so rather than flashing "Copied", which would be a
    // lie the user only discovers when they paste.
    if (button) flashLabel(button, 'Nothing to copy', label, false);
    return false;
  }

  let ok = false;
  let reason = '';
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      ok = true;
    } else {
      reason = 'clipboard API unavailable on this origin';
    }
  } catch (e) {
    // Distinguish the two causes, because they need different actions from the
    // user. NotAllowedError here means the browser withheld permission; that can
    // happen when the page is not focused, or in an automation context with no
    // user gesture. A plain "Copy failed" leaves the user with nothing to try.
    reason = e?.name === 'NotAllowedError'
      ? 'the browser blocked clipboard access — click the page first, then retry'
      : (e?.message || String(e));
    ok = false;
  }

  if (!ok) ok = legacyCopy(text);

  if (button) {
    if (ok) flashLabel(button, '✓ Copied', label, true);
    else flashLabel(button, 'Copy failed — select and copy manually', label, false, reason);
  }
  return ok;
}

/** Temporarily change a button's label, then restore it. */
function flashLabel(button, shown, restore, good, reason = '') {
  button.textContent = shown;
  button.classList.toggle('copied', good);
  button.title = good
    ? 'Copied to clipboard'
    : `Copying failed${reason ? ': ' + reason : ''}. The text is still selectable.`;
  clearTimeout(copyTimers.get(button));
  copyTimers.set(button, setTimeout(() => {
    button.textContent = restore;
    button.classList.remove('copied');
    button.title = '';
  }, good ? 1400 : 2600));
}

/** Fallback for non-secure contexts and older browsers. */
function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-1000px';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  document.body.removeChild(ta);
  return ok;
}

/** Wire every [data-copy] button to the text of its target element. */
function wireCopyButtons() {
  for (const btn of $$('[data-copy]')) {
    btn.addEventListener('click', () => {
      const target = $(btn.dataset.copy);
      if (!target) return;
      // For a highlighted <pre>, textContent holds the true text; for a
      // textarea, .value does.
      const text = 'value' in target && target.tagName === 'TEXTAREA'
        ? target.value
        : target.textContent;
      copyText(text, btn, btn.dataset.label);
    });
  }
}

function download(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Status line
// ---------------------------------------------------------------------------

function setStatus(el, kind, msg, detail) {
  el.className = 'status show ' + kind;
  el.textContent = msg;
  if (detail) {
    const pre = document.createElement('pre');
    pre.textContent = detail;
    el.appendChild(pre);
  }
}
function clearStatus(el) { el.className = 'status'; el.textContent = ''; }

// ---------------------------------------------------------------------------
// Editors: a textarea layered over a highlighted <pre>
//
// The two must scroll together and share metrics exactly, or the caret drifts.
// Metrics live in one CSS rule (.code-surface) for that reason; this only syncs
// scroll position and content.
// ---------------------------------------------------------------------------

function makeEditor(textareaId, highlightId, highlightFn) {
  const ta = $('#' + textareaId);
  const pre = $('#' + highlightId);

  const render = () => {
    pre.innerHTML = highlightFn(ta.value);
    // A trailing newline needs a sentinel or the highlight block is one line
    // short and the scroll heights disagree.
    if (ta.value.endsWith('\n')) pre.innerHTML += '\n';
  };
  const sync = () => {
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
  };

  ta.addEventListener('input', render);
  ta.addEventListener('scroll', sync);
  window.addEventListener('resize', sync);

  return {
    ta, pre,
    get value() { return ta.value; },
    set value(v) { ta.value = v; render(); sync(); },
    render, sync,
  };
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

const TAB_STORAGE = 'asn1toolkit.tab';

function selectTab(id, { focus = false } = {}) {
  for (const btn of $$('nav.tabs button')) {
    const on = btn.id === 'tab-' + id;
    btn.setAttribute('aria-selected', String(on));
    // ARIA tabs pattern: only the selected tab is in the tab order, so Tab moves
    // into the panel rather than through every tab. Arrow keys move between tabs.
    btn.setAttribute('tabindex', on ? '0' : '-1');
    const panel = $('#' + btn.getAttribute('aria-controls'));
    panel.hidden = !on;
    if (on && focus) btn.focus();
  }
  try { localStorage.setItem(TAB_STORAGE, id); } catch { /* private mode */ }
}

function wireTabs() {
  const ids = ['compile', 'structure', 'encode', 'decode'];
  for (const id of ids) {
    $('#' + 'tab-' + id).addEventListener('click', () => selectTab(id));
  }
  // Arrow-key navigation between tabs.
  $('nav.tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const cur = ids.indexOf(
      (document.activeElement?.id || '').replace('tab-', '')
    );
    if (cur < 0) return;
    e.preventDefault();
    const next = (cur + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length;
    selectTab(ids[next], { focus: true });
  });
  let saved = 'compile';
  try { saved = localStorage.getItem(TAB_STORAGE) || 'compile'; } catch { /* ignore */ }
  if (ids.includes(saved)) selectTab(saved);
}

// ---------------------------------------------------------------------------
// JSON editor for the encoder: highlight keys/strings/numbers lightly
// ---------------------------------------------------------------------------

function highlightJson(src) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc(src)
    .replace(/("(?:\\.|[^"\\])*")(\s*:)/g, '<span class="tok-field">$1</span>$2')
    .replace(/:(\s*)("(?:\\.|[^"\\])*")/g, ':$1<span class="tok-string">$2</span>')
    .replace(/:(\s*)(-?\d+(?:\.\d+)?)/g, ':$1<span class="tok-number">$2</span>')
    .replace(/\b(true|false|null)\b/g, '<span class="tok-builtin">$1</span>');
}

// ---------------------------------------------------------------------------
// Panel 1 — compiler
// ---------------------------------------------------------------------------

let editor, valueEditor, hexEditor;

function currentBackend() {
  return $('input[name=backend]:checked').value;
}
function currentRules() {
  return $('input[name=rules]:checked').value;
}

function updateInputCount() {
  const t = editor.value;
  $('#inCount').textContent = t ? t.split('\n').length + ' lines' : '';
}

function runCompile() {
  const statusEl = $('#status');
  clearStatus(statusEl);

  const src = editor.value;
  const be = currentBackend();

  if (!src.trim()) {
    $('#output').textContent = '';
    clearErrorLine();
    setStatus(statusEl, 'err', 'Nothing to compile — the input is empty.');
    return;
  }

  let res;
  try {
    res = compile(src, be);
  } catch (e) {
    $('#output').textContent = '';
    setStatus(statusEl, 'err', 'Compiler crashed: ' + (e?.message ?? String(e)));
    return;
  }

  if (!res.ok) {
    $('#output').textContent = '';
    setStatus(statusEl, 'err', 'Compilation failed.', res.error);
    markErrorLine(res.error);          // F4: put the mark where the user is looking
    offerCleanupIfUseful(src, be);
    return;
  }

  clearErrorLine();

  let text = res.output;
  let formatted = false;
  if (be === 'rust') {
    const pretty = formatRust(text);
    if (pretty && pretty !== text) { text = pretty; formatted = true; }
  } else {
    const pretty = formatTypescript(text);
    if (pretty && pretty !== text) { text = pretty; formatted = true; }
  }

  $('#output').textContent = text;
  $('#outLabel').textContent = be === 'rust' ? 'Rust (rasn)' : 'TypeScript';

  const lines = text.split('\n').length;
  $('#outCount').textContent = lines + ' lines';

  const parts = [`Compiled ${lines} line${lines === 1 ? '' : 's'} of ${be}.`];
  if (formatted) parts.push('Formatted locally, since no formatter can run in a browser.');
  if (res.warnings?.length) {
    setStatus(statusEl, 'warn', parts.join(' ') + ` ${res.warnings.length} warning(s).`, res.warnings.join('\n'));
  } else {
    setStatus(statusEl, 'ok', parts.join(' '));
  }
}

/**
 * When a compile fails, decide whether PDF artefacts are the reason and say so.
 *
 * This is the fix for the tool's worst first impression. Pasting ASN.1 out of a
 * GSMA PDF is the most likely first action, and the parser reports it as
 * `Error matching ASN syntax at line 10` — naming a page header the user did not
 * knowingly write, with nothing to suggest the paste, not their ASN.1, is the
 * problem. The reasonable conclusion is that the tool is broken.
 *
 * So: compile the cleaned text. Only if THAT succeeds do we mention artefacts,
 * which means the suggestion is never a guess — it is demonstrably the cause.
 * A cleanup offer that did not fix the error would be noise.
 */
function offerCleanupIfUseful(src, backend) {
  let analysis;
  try {
    analysis = analyseArtefacts(src);
  } catch {
    return;                       // detector failure must never mask the real error
  }
  if (!analysis.findings.length) return;

  const result = cleanWouldHelp(src, (t) => compile(t, backend));
  if (!result.helpful) {
    // Artefacts are present but are not what broke it. Mention them as context
    // without implying they are the cause.
    const kinds = summariseArtefacts(analysis);
    setStatus($('#status'), 'err', 'Compilation failed.', '');
    const el = $('#status');
    const extra = document.createElement('div');
    extra.className = 'artefact-note';
    extra.textContent =
      `Note: this input also contains ${analysis.total} line(s) of PDF-derived ` +
      `artefact (${kinds}) which the parser ignored. They are not the cause of the error above.`;
    el.appendChild(extra);
    return;
  }

  showCleanupOffer(src, analysis, result);
}

/** Keep the shared-schema indicator in step with the editor. */
function updateSchemaStrip() {
  const el = $('#schemaStripValue');
  if (!el) return;
  const src = editor.value.trim();
  if (!src) {
    el.textContent = 'empty';
    el.classList.add('empty');
    return;
  }
  let s;
  try {
    s = parseStructure(editor.value);
  } catch {
    s = null;
  }
  el.classList.remove('empty');
  if (s && s.types.length) {
    el.textContent = `${s.module || '(unnamed module)'} · ${s.types.length} type${s.types.length === 1 ? '' : 's'}`;
  } else {
    el.textContent = `${src.split('\n').length} lines (no types found)`;
  }
}

/**
 * Mark the line a compiler error refers to.
 *
 * The parser reports "line N, column M" as prose in a panel below the editor,
 * which is disconnected from the text it describes — in a 400-line paste the user
 * has to count lines. The highlight overlay is already rendered under the
 * textarea, so marking the line there costs nothing and puts the signal where the
 * user is looking.
 */
function markErrorLine(message) {
  clearErrorLine();
  if (!message) return;
  const m = /line\s+(\d+)/i.exec(message);
  if (!m) return;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n < 1) return;

  const lines = editor.value.split('\n');
  if (n > lines.length) return;

  // Overlay a marker band at the right offset. Line-height and padding come from
  // the same rules the text uses, so the band lands exactly on the line.
  const spacing = 20.48;   // 12.8px * 1.6, see .code-surface
  const pre = $('#inputHighlight');
  const band = document.createElement('div');
  band.className = 'error-line-band';
  band.style.top = `calc(12px + ${(n - 1) * spacing}px)`;
  band.style.height = spacing + 'px';
  pre.parentElement.appendChild(band);
  pre.parentElement.classList.add('has-error-line');

  // Scroll the line into view so the mark is actually seen.
  const target = (n - 1) * spacing;
  if (target < editor.ta.scrollTop || target > editor.ta.scrollTop + editor.ta.clientHeight - spacing) {
    editor.ta.scrollTop = Math.max(0, target - editor.ta.clientHeight / 3);
    editor.sync();
  }
}

function clearErrorLine() {
  const wrap = editor?.ta?.closest('.editor-wrap');
  if (!wrap) return;
  wrap.querySelectorAll('.error-line-band').forEach((b) => b.remove());
  wrap.classList.remove('has-error-line');
}


/** Human-readable summary of what kinds of artefact were found. */
function summariseArtefacts(analysis) {
  const counts = {};
  for (const f of analysis.findings) {
    for (const r of f.reasons) counts[r] = (counts[r] || 0) + 1;
  }
  return Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ');
}

/**
 * Render the offer: a clear explanation, the affected lines, and one button.
 *
 * Deliberately shows WHICH lines before acting. This module deletes user text,
 * and a silent deletion would be the worst possible behaviour — the user has to
 * be able to see the casualties and disagree.
 */
function showCleanupOffer(src, analysis, result) {
  const el = $('#status');
  el.className = 'status show err';

  const head = document.createElement('div');
  head.innerHTML =
    '<b>This looks like ASN.1 copied from a PDF, not a source file.</b> ' +
    `The compiler stopped at text that is not ASN.1. Removing ` +
    `${result.removed.length} line(s) makes it compile — nothing else changes.`;
  el.appendChild(head);

  const list = document.createElement('div');
  list.className = 'artefact-lines';
  for (const r of analysis.findings.slice(0, 8)) {
    const row = document.createElement('div');
    row.className = 'artefact-line';
    const num = document.createElement('span');
    num.className = 'artefact-num';
    num.textContent = String(r.line).padStart(4, ' ');
    const txt = document.createElement('span');
    txt.className = 'artefact-pre';
    txt.textContent = r.text.length > 88 ? r.text.slice(0, 85) + '...' : r.text;
    const why = document.createElement('span');
    why.className = 'artefact-why';
    why.textContent = r.reasons.join(', ');
    row.append(num, txt, why);
    list.appendChild(row);
  }
  if (analysis.findings.length > 8) {
    const more = document.createElement('div');
    more.className = 'artefact-line';
    more.textContent = `     ... and ${analysis.findings.length - 8} more`;
    list.appendChild(more);
  }
  el.appendChild(list);

  const actions = document.createElement('div');
  actions.className = 'artefact-actions';

  const clean = document.createElement('button');
  clean.className = 'primary';
  clean.id = 'btnCleanArtefacts';
  clean.textContent = `Remove ${result.removed.length} artefact line(s) and compile`;
  clean.addEventListener('click', () => {
    // The cleaned text is the analysed text: re-derive rather than trust the
    // button state, so the edit is always exactly what was shown.
    const { text } = cleanArtefacts(editor.value);
    editor.value = text;
    updateInputCount();
    refreshTypeList();
    updateSchemaStrip();
    runCompile();
  });

  const dismiss = document.createElement('button');
  dismiss.textContent = 'Leave it to me';
  dismiss.addEventListener('click', () => {
    clearStatus($('#status'));
  });

  actions.append(clean, dismiss);
  el.appendChild(actions);
}

function runValidate() {
  const statusEl = $('#status');
  clearStatus(statusEl);
  let r;
  try {
    r = validate(editor.value);
  } catch (e) {
    setStatus(statusEl, 'err', 'Validation crashed: ' + (e?.message ?? String(e)));
    return;
  }
  if (r.ok) {
    setStatus(statusEl, 'ok',
      `Parses and generates cleanly${r.warnings ? `, with ${r.warnings} warning(s)` : ''}. ` +
      'Note this checks generation, not just parsing — a module can parse and still fail to generate.');
  } else {
    setStatus(statusEl, 'err', 'Validation failed.', r.error);
  }
}

// ---------------------------------------------------------------------------
// Panel 2 — structure
// ---------------------------------------------------------------------------

function renderStructure() {
  const host = $('#structure');
  const statusEl = $('#statusStruct');
  clearStatus(statusEl);

  const src = editor.value;
  if (!src.trim()) {
    host.innerHTML = '';
    setStatus(statusEl, 'err', 'Nothing to analyse — the input is empty.');
    return;
  }

  let schema;
  try {
    schema = parseStructure(src);
  } catch (e) {
    host.innerHTML = '';
    setStatus(statusEl, 'err', 'Could not read the schema: ' + (e?.message ?? String(e)));
    return;
  }

  if (!schema.types.length) {
    host.innerHTML = '';
    setStatus(statusEl, 'warn',
      'No type definitions found. The extractor looks for `Name ::= <type>` at the start of a line — ' +
      'an extract from a spec PDF may not qualify.');
    return;
  }

  const view = $('input[name=sview]:checked').value;
  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const fieldRow = (f, indent) => {
    const bits = [];
    bits.push(`<span class="tname">${esc(f.name)}</span>`);
    if (f.typeName) bits.push(`<span class="ttype">${esc(f.typeName)}</span>`);
    if (f.constraints?.length) bits.push(`<span class="tcount">${esc(f.constraints.join(' '))}</span>`);
    if (f.optional) bits.push('<span class="topt">OPTIONAL</span>');
    if (f.tag) bits.push(`<span class="ttag">${esc(f.tag)}</span>`);
    const inner = f.fields?.length
      ? `\n<div class="tnode" style="margin-left:${indent + 10}px">` +
        f.fields.map((g) => fieldRow(g, indent + 10)).join('\n') + '</div>'
      : '';
    return `<div class="trow">${bits.join(' ')}</div>${inner}`;
  };

  const flat = (t) => `
    <div class="tnode depth-0">
      <div class="trow">
        <span class="tname">${esc(t.name)}</span>
        <span class="tkind">${esc(t.kind)}</span>
        ${t.tag ? `<span class="ttag">${esc(t.tag)}</span>` : ''}
        <span class="tcount">${t.fieldCount} field${t.fieldCount === 1 ? '' : 's'}</span>
      </div>
      ${t.fields.map((f) => fieldRow(f, 0)).join('\n')}
    </div>`;

  const grouped = (groupName, list) => {
    if (!list.length) return '';
    return `
      <div class="tnode depth-0">
        <div class="trow"><span class="tkind">${esc(groupName)}</span>
          <span class="tcount">${list.length}</span></div>
        ${list.map((t) => `
          <details class="tdetails" open>
            <summary><span class="tsummary-head">
              <span class="tname">${esc(t.name)}</span>
              <span class="ttype">${esc(t.kind)}</span>
              ${t.tag ? `<span class="ttag">${esc(t.tag)}</span>` : ''}
              <span class="tcount">${t.fieldCount} field${t.fieldCount === 1 ? '' : 's'}</span>
            </span></summary>
            <div class="tnode">${t.fields.map((f) => fieldRow(f, 0)).join('\n') || '<div class="trow tcount">no fields</div>'}</div>
          </details>`).join('\n')}
      </div>`;
  };

  let html = '';
  if (view === 'flat') {
    html = schema.types.map(flat).join('\n');
  } else {
    const compounds = schema.types.filter((t) => t.fields.length);
    const simple = schema.types.filter((t) => !t.fields.length);
    html = grouped('Structured types', compounds) + grouped('Simple types', simple);
  }

  if (schema.unresolved.length) {
    html += `
      <div class="tnode depth-0" style="margin-top:14px">
        <div class="trow"><span class="tkind" style="color:var(--warn)">Referenced but not defined here</span>
          <span class="tcount">${schema.unresolved.length}</span></div>
        <div class="trow tcount">${schema.unresolved.map(esc).join(', ')}</div>
        <div class="trow tcount">Usually a missing IMPORT clause rather than an error.</div>
      </div>`;
  }

  host.innerHTML = html;
  $('#structCount').textContent =
    `${schema.types.length} types, ${schema.totalFields} top-level fields`;
  setStatus(statusEl, 'ok',
    `${schema.module || '(unnamed module)'}${schema.tagging ? ' · ' + schema.tagging : ''} · ` +
    `${schema.types.length} types`);
}

/** Plain-text summary for the clipboard. */
function structureSummary() {
  const schema = parseStructure(editor.value);
  const lines = [];
  lines.push(`module: ${schema.module || '(unnamed)'}`);
  lines.push(`tagging: ${schema.tagging || '(unspecified)'}`);
  lines.push(`types: ${schema.types.length}`);
  lines.push('');
  for (const t of schema.types) {
    lines.push(`${t.name} ::= ${t.kind}${t.tag ? '  ' + t.tag : ''}`);
    for (const f of t.fields) {
      const bits = [`   ${f.name}: ${f.typeName}`];
      if (f.constraints?.length) bits.push(f.constraints.join(' '));
      if (f.optional) bits.push('OPTIONAL');
      if (f.tag) bits.push(f.tag);
      lines.push(bits.join(' '));
    }
  }
  if (schema.unresolved.length) {
    lines.push('');
    lines.push(`unresolved: ${schema.unresolved.join(', ')}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Panel 3 — encoder
// ---------------------------------------------------------------------------

function refreshTypeList() {
  const sel = $('#typeSelect');
  const prev = sel.value;
  let schema;
  try {
    schema = parseStructure(editor.value);
  } catch {
    schema = { types: [] };
  }

  // Offer structured types first: they are what anyone actually wants to encode.
  const sorted = [...schema.types].sort(
    (a, b) => (b.fields.length ? 1 : 0) - (a.fields.length ? 1 : 0) ||
              a.name.localeCompare(b.name)
  );
  sel.innerHTML = sorted
    .map((t) => `<option value="${t.name}">${t.name}${t.fields.length ? ` (${t.fields.length})` : ''}</option>`)
    .join('') || '<option value="">— no types in the schema —</option>';

  if (sorted.some((t) => t.name === prev)) sel.value = prev;
}

function currentSchema() {
  return parseStructure(editor.value);
}

function buildTemplate() {
  const statusEl = $('#statusEncode');
  const name = $('#typeSelect').value;
  if (!name) {
    setStatus(statusEl, 'err', 'No type selected — put a schema in tab 1 first.');
    return;
  }
  try {
    const tpl = valueTemplate(currentSchema(), name);
    valueEditor.value = JSON.stringify(tpl, null, 2);
    clearStatus(statusEl);
  } catch (e) {
    setStatus(statusEl, 'err', 'Could not build a template: ' + (e?.message ?? String(e)));
  }
}

function runEncode() {
  const statusEl = $('#statusEncode');
  clearStatus(statusEl);

  const name = $('#typeSelect').value;
  if (!name) {
    setStatus(statusEl, 'err', 'No type selected — put a schema in tab 1 first.');
    return;
  }

  let value;
  try {
    value = JSON.parse(valueEditor.value || 'null');
  } catch (e) {
    $('#encOutput').textContent = '';
    setStatus(statusEl, 'err', 'The value is not valid JSON.', e.message);
    return;
  }

  const rules = currentRules();
  let bytes;
  try {
    const schema = currentSchema();
    bytes = rules === 'PER'
      ? encodeValuePer(schema, name, value)
      : encodeValue(schema, name, value, rules);
  } catch (e) {
    $('#encOutput').textContent = '';
    setStatus(statusEl, 'err', `${rules} encoding failed.`, e?.message ?? String(e));
    return;
  }

  $('#encOutput').textContent = toHex(bytes) || '(empty — zero-length encoding)';
  $('#encLabel').textContent = `Encoded (${rules})`;

  const note = RULES.find((r) => r.id === rules)?.note || '';
  setStatus(statusEl, 'ok',
    `${bytes.length} byte${bytes.length === 1 ? '' : 's'} in ${rules}. ${note}`);
}

// ---------------------------------------------------------------------------
// Panel 4 — byte inspector
// ---------------------------------------------------------------------------

function renderHexEditor() {
  hexEditor.render();
  const n = hexByteCount(hexEditor.value);
  $('#hexCount').textContent = n ? n + ' bytes' : '';
}

function runDecode() {
  const statusEl = $('#statusDecode');
  clearStatus(statusEl);

  const hex = hexEditor.value;
  if (!hex.trim()) {
    $('#treeOutput').textContent = '';
    setStatus(statusEl, 'err', 'No bytes to decode.');
    return;
  }

  let res;
  try {
    res = hex_to_tree(hex);
  } catch (e) {
    $('#treeOutput').textContent = '';
    setStatus(statusEl, 'err', 'Decoder crashed: ' + (e?.message ?? String(e)));
    return;
  }

  if (res.error) {
    $('#treeOutput').textContent = '';
    $('#treeCount').textContent = '';
    setStatus(statusEl, 'err', 'Could not decode.', res.error);
    return;
  }

  const lines = [];
  const dump = (node, depth) => {
    const pad = '  '.repeat(depth);
    const kind = node.constructed ? 'cons' : 'prim';
    let line = `${pad}${node.class} ${node.tag} (${kind}) len=${node.content_len} @${node.offset}`;
    if (node.value_text) line += `  "${node.value_text}"`;
    else if (node.value_hex) line += `  [${node.value_hex}]`;
    lines.push(line);
    for (const note of node.notes || []) lines.push(`${pad}  ! ${note}`);
    for (const c of node.children) dump(c, depth + 1);
  };
  for (const n of res.nodes) dump(n, 0);

  if (res.notes?.length) {
    lines.push('');
    for (const n of res.notes) lines.push('NOTE: ' + n);
  }

  $('#treeOutput').textContent = lines.join('\n');
  const top = res.nodes.length;
  $('#treeCount').textContent = `${top} top-level element${top === 1 ? '' : 's'}, ${res.consumed}/${res.total} bytes`;

  if (res.notes?.length) {
    setStatus(statusEl, 'warn', 'Decoded with caveats — see the notes below the tree.', res.notes.join('\n\n'));
    // Auto-open the explainer when the decode is suspect. The whole point of the
    // warning is that a lookalike returns a confident, wrong answer; leaving the
    // explanation collapsed behind a click would let someone read the tree and
    // move on without ever seeing why they should not.
    const note = $('#lookalikeNote');
    if (note && res.notes.some((n) => /PRIMITIVE|only \*looks\*/i.test(n))) {
      note.open = true;
    }
  } else {
    setStatus(statusEl, 'ok', `Decoded ${res.consumed} byte${res.consumed === 1 ? '' : 's'}.`);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function wireButtons() {
  // Panel 1
  $('#btnCompile').addEventListener('click', runCompile);
  $('#btnValidate').addEventListener('click', runValidate);
  $('#btnExample').addEventListener('click', () => { editor.value = example_schema(); refreshTypeList(); runCompile(); });
  $('#btnMinimal').addEventListener('click', () => { editor.value = example_minimal(); refreshTypeList(); runCompile(); });
  $('#btnClearCompiler').addEventListener('click', () => {
    editor.value = '';
    $('#output').textContent = '';
    $('#outCount').textContent = '';
    clearStatus($('#status'));
    clearErrorLine();                 // the error mark belongs to the cleared text
    updateInputCount();
    refreshTypeList();
    updateSchemaStrip();
    editor.ta.focus();
  });
  $('#btnWrap').addEventListener('click', () => {
    const on = $('#output').classList.toggle('wrap');
    const btn = $('#btnWrap');
    btn.textContent = 'Wrap output: ' + (on ? 'on' : 'off');
    btn.setAttribute('aria-pressed', String(on));
  });
  $('#btnDownload').addEventListener('click', () => {
    const out = $('#output').textContent;
    if (!out) return;
    const be = currentBackend();
    const ext = be === 'rust' ? 'rs' : 'ts';
    download(`bindings.${ext}`, out);
  });
  for (const r of $$('input[name=backend]')) {
    r.addEventListener('change', () => { if ($('#output').textContent) runCompile(); });
  }

  // Ctrl/Cmd+Enter compiles from either editor.
  for (const ta of [editor.ta, valueEditor.ta]) {
    ta.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (ta === valueEditor.ta) runEncode(); else runCompile();
      }
    });
  }

  // Panel 2
  $('#btnStructure').addEventListener('click', renderStructure);
  $('#btnStructExample').addEventListener('click', () => {
    editor.value = example_schema();
    refreshTypeList();
    updateSchemaStrip();
    renderStructure();
  });
  $('#btnStructCopy').addEventListener('click', (e) => {
    let text = '';
    try { text = structureSummary(); } catch { text = ''; }
    copyText(text, e.currentTarget, 'Copy summary');
  });
  for (const r of $$('input[name=sview]')) {
    r.addEventListener('change', () => { if ($('#structure').innerHTML) renderStructure(); });
  }

  // Panel 3
  $('#btnEncode').addEventListener('click', runEncode);
  $('#btnTemplate').addEventListener('click', buildTemplate);
  $('#btnResetValue').addEventListener('click', buildTemplate);
  for (const r of $$('input[name=rules]')) {
    r.addEventListener('change', () => { if ($('#encOutput').textContent) runEncode(); });
  }
  $('#typeSelect').addEventListener('change', () => { buildTemplate(); });
  $('#btnSendToInspector').addEventListener('click', () => {
    const bytes = $('#encOutput').textContent;
    if (!bytes) return;
    hexEditor.value = bytes;
    renderHexEditor();
    selectTab('decode', { focus: true });
    runDecode();
  });

  // Panel 4
  $('#btnDecode').addEventListener('click', runDecode);
  $('#btnHexExample').addEventListener('click', () => { hexEditor.value = example_hex(); renderHexEditor(); runDecode(); });
  $('#btnHexNested').addEventListener('click', () => { hexEditor.value = example_hex_nested(); renderHexEditor(); runDecode(); });
  $('#btnHexLookalike').addEventListener('click', () => { hexEditor.value = example_hex_lookalike(); renderHexEditor(); runDecode(); });
  $('#btnHexClear').addEventListener('click', () => {
    hexEditor.value = '';
    $('#treeOutput').textContent = '';
    $('#hexCount').textContent = '';
    $('#treeCount').textContent = '';
    clearStatus($('#statusDecode'));
    hexEditor.ta.focus();
  });
  $('#btnHexCopy').addEventListener('click', (e) =>
    copyText($('#treeOutput').textContent, e.currentTarget, 'Copy tree'));

  // Keep the encoder's type list in step with the schema in tab 1.
  editor.ta.addEventListener('input', () => {
    updateInputCount();
    refreshTypeList();
    updateSchemaStrip();
    clearErrorLine();   // a stale mark on edited text points at the wrong line
  });

  // F3: the strip is the discovery path for the shared-schema model.
  $('#schemaStrip').addEventListener('click', () => {
    selectTab('compile', { focus: true });
    editor.ta.focus();
  });
}

/**
 * Stamp asset URLs with the toolkit version so a redeploy is never masked by a
 * cached stylesheet. During development a CSS fix was correct on disk and
 * correctly served, yet the browser used the old sheet and the editor overlay
 * stayed misaligned — the symptom looked like a CSS bug and was not one.
 */
function bustAssetCaches() {
  const link = document.querySelector('link[rel=stylesheet]');
  if (link && !link.href.includes('?v=')) link.href = `./style.css?v=${BUILD}`;
}

async function boot() {
  editor = makeEditor('input', 'inputHighlight', highlightAsn1);
  valueEditor = makeEditor('valueInput', 'valueHighlight', highlightJson);
  hexEditor = makeEditor('hexInput', 'hexHighlight', (s) => highlightHex(s));

  wireTabs();
  wireCopyButtons();
  wireButtons();

  // Load the wasm with an explicit, version-stamped URL.
  //
  // This matters more than it looks. During development the rebuilt .wasm was
  // correct on disk and correctly served, yet the browser reused a cached copy
  // and the page ran old compiled logic — which presents as a code bug and is
  // not one. Passing the URL explicitly is the only way to control its cache key:
  // the glue module computes the default URL itself.
  await init({ module_or_path: `./pkg/asn1_toolkit_bg.wasm?v=${BUILD}` });

  $('#versionBadge').textContent = 'compiler v' + compiler_version();
  // Must come after init(): the version string is the cache key.
  bustAssetCaches();

  editor.value = example_schema();
  updateInputCount();
  refreshTypeList();
  updateSchemaStrip();
  runCompile();

  // Seed the other panels so no tab is empty on first visit.
  hexEditor.value = example_hex();
  renderHexEditor();
  runDecode();
  buildTemplate();
}

boot().catch((e) => {
  document.body.insertAdjacentHTML('afterbegin',
    `<div style="background:#5a1f1f;color:#ffd9d6;padding:14px 18px;font-family:monospace">
       Failed to start: ${String(e?.message ?? e)}
     </div>`);
});
