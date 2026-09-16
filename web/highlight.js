// ASN.1 syntax highlighter.
//
// WHY A HAND-WRITTEN TOKENISER RATHER THAN A LIBRARY
//
// The site is static and dependency-free by design (see README): no bundler, no
// npm runtime deps. Highlight.js/prism do not ship ASN.1 out of the box, and
// adding a build step for one language is not worth it. ASN.1's lexical rules
// are simple enough that a correct tokeniser is ~150 lines.
//
// CORRECTNESS RULES THAT ARE EASY TO GET WRONG
//
//   1. `--` starts a comment to end of line. It is also legal *inside* a string
//      ('6F3E' appears in real spec text), so strings must be scanned first.
//   2. Real specs contain a `--` comment that spans lines after PDF extraction.
//      Highlighting follows the text; it does not attempt to repair it.
//   3. A `.` between digits is part of a number or range (1..16), not an operator.
//   4. `#...#` version markers appear in GSMA specs (#SupportedForDcV3.0.0#).
//      They are annotations, so they get their own class rather than being
//      highlighted as either code or comments.
//   5. Case matters for builtins: `INTEGER` is a type, `integer` is not. But
//      identifiers are case-insensitive in ASN.1, so a `SEQUENCE OF foo` is
//      legal and `foo` is a reference.

// Type keywords that are reserved in ASN.1 and always render as builtins.
const BUILTIN_KEYWORDS = [
  'BOOLEAN', 'INTEGER', 'BIT STRING', 'OCTET STRING', 'NULL', 'OBJECT IDENTIFIER',
  'REAL', 'ENUMERATED', 'CHOICE', 'SEQUENCE', 'SET', 'OF',
  'UTF8String', 'NumericString', 'PrintableString', 'TeletexString',
  'T61String', 'VideotexString', 'IA5String', 'GraphicString', 'VisibleString',
  'ISO646String', 'GeneralString', 'UniversalString', 'BMPString',
  'UTCTime', 'GeneralizedTime', 'ObjectDescriptor', 'EXTERNAL',
  'EMBEDDED PDV', 'CHARACTER STRING', 'ANY', 'RELATIVE-OID', 'TIME',
  'INSTANCE OF', 'REAL',
];

// Module/structural keywords.
const STRUCTURAL_KEYWORDS = [
  'DEFINITIONS', 'BEGIN', 'END', 'IMPORTS', 'EXPORTS', 'FROM',
  'AUTOMATIC', 'IMPLICIT', 'EXPLICIT', 'TAGS', 'EXTENSIBILITY', 'IMPLIED',
  'OPTIONAL', 'DEFAULT', 'COMPONENTS', 'PRESENT', 'ABSENT',
  'MIN', 'MAX', 'SIZE', 'TRUE', 'FALSE',
  'UNIVERSAL', 'APPLICATION', 'PRIVATE',
  'CLASS', 'WITH', 'SYNTAX', 'UNIQUE', 'CONTAINING',
];

// Longest-first so `ANY DEFINED BY` style multi-word forms match before `ANY`.
const SORTED_BUILTINS = [...BUILTIN_KEYWORDS].sort((a, b) => b.length - a.length);
const SORTED_STRUCTURAL = [...STRUCTURAL_KEYWORDS].sort((a, b) => b.length - a.length);

/**
 * Tokenise ASN.1 source into typed runs for rendering.
 * Returns an array of { text, cls } where cls is one of:
 *   'comment' | 'string' | 'marker' | 'builtin' | 'keyword'
 *   'type' | 'field' | 'number' | 'punct' | 'plain'
 */
export function tokeniseAsn1(src) {
  const out = [];
  let i = 0;
  const n = src.length;

  const push = (text, cls) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.cls === cls) last.text += text;
    else out.push({ text, cls });
  };

  while (i < n) {
    const c = src[i];

    // --- comment: `--` to end of line -----------------------------------
    if (c === '-' && src[i + 1] === '-') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      push(src.slice(i, j), 'comment');
      i = j;
      continue;
    }

    // --- version marker: #...# ------------------------------------------
    if (c === '#') {
      const j = src.indexOf('#', i + 1);
      if (j !== -1 && j - i < 60) {
        push(src.slice(i, j + 1), 'marker');
        i = j + 1;
        continue;
      }
    }

    // --- string literal --------------------------------------------------
    if (c === '"') {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') { j += 2; continue; }  // escaped quote
          j++;
          break;
        }
        if (src[j] === '\n') break;
        j++;
      }
      push(src.slice(i, j), 'string');
      i = j;
      continue;
    }

    // --- quoted file identifier / character literal: '6F3E' -------------
    if (c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== "'" && src[j] !== '\n') j++;
      if (j < n && src[j] === "'") {
        push(src.slice(i, j + 1), 'string');
        i = j + 1;
        continue;
      }
      push(c, 'punct');
      i++;
      continue;
    }

    // --- whitespace ------------------------------------------------------
    if (/\s/.test(c)) {
      let j = i;
      while (j < n && /\s/.test(src[j])) j++;
      push(src.slice(i, j), 'plain');
      i = j;
      continue;
    }

    // --- punctuation -----------------------------------------------------
    if ('{}()[]<>,;|^'.includes(c)) {
      push(c, 'punct');
      i++;
      continue;
    }

    // --- `::=` and `..` and `...` ---------------------------------------
    if (c === ':' && src[i + 1] === ':' && src[i + 2] === '=') {
      push('::=', 'punct');
      i += 3;
      continue;
    }
    if (c === '.' && src[i + 1] === '.' && src[i + 2] === '.') {
      push('...', 'punct');
      i += 3;
      continue;
    }
    if (c === '.' && src[i + 1] === '.') {
      push('..', 'punct');
      i += 2;
      continue;
    }

    // --- number ----------------------------------------------------------
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i + 1;
      while (j < n && /[0-9a-fA-F.]/.test(src[j])) {
        // Do not swallow a `..` range operator.
        if (src[j] === '.' && src[j + 1] === '.') break;
        j++;
      }
      // Only accept as a number if it has a digit after any leading sign.
      const text = src.slice(i, j);
      if (/^-?[0-9]/.test(text)) {
        push(text, 'number');
        i = j;
        continue;
      }
    }

    // --- identifier / keyword -------------------------------------------
    let j = i;
    while (j < n && /[A-Za-z0-9_-]/.test(src[j])) j++;
    if (j === i) {
      // Unknown character: emit as punctuation so nothing is swallowed.
      push(c, 'punct');
      i++;
      continue;
    }

    const word = src.slice(i, j);
    push(word, classifyWord(word, src, i, out));
    i = j;
  }

  return out;
}

// Multi-word builtins that must be recognised as a unit.
const MULTI_WORD = [
  'BIT STRING', 'OCTET STRING', 'OBJECT IDENTIFIER', 'CHARACTER STRING',
  'EMBEDDED PDV', 'INSTANCE OF', 'ANY DEFINED BY',
];
const MULTI_WORD_RE = new RegExp(
  '^(' + MULTI_WORD.map((w) => w.replace(/ /g, '\\s+')).join('|') + ')\\b'
);

function classifyWord(word, src, start, out) {
  // Try a multi-word builtin first (peek ahead over whitespace).
  const rest = src.slice(start);
  const m = MULTI_WORD_RE.exec(rest);
  if (m) {
    // The caller has only consumed `word`; matching here means the next token
    // will pick up the remainder. Mark just the first word so the classes merge
    // cleanly when the rest arrives as a builtin too.
    if (BUILTIN_KEYWORDS.some((k) => k.startsWith(word + ' '))) return 'builtin';
  }

  if (SORTED_BUILTINS.includes(word)) return 'builtin';
  if (SORTED_STRUCTURAL.includes(word)) return 'keyword';

  // An identifier directly followed by `::=` is a type being defined.
  if (/^\s*::=/.test(src.slice(start + word.length))) return 'type';

  // An identifier that starts a component: `name Type` — i.e. inside braces,
  // lowercase-initial and followed by whitespace then another word.
  if (/^[a-z]/.test(word) && /^\s+[A-Za-z[{(]/.test(src.slice(start + word.length))) {
    return 'field';
  }

  // A capitalised identifier is almost always a type reference.
  if (/^[A-Z]/.test(word)) return 'type';

  return 'plain';
}

/**
 * Render highlighted ASN.1 as HTML.
 *
 * `escape` must be applied per-token: escaping the whole string first and then
 * tokenising would make `&lt;` look like an identifier.
 */
export function highlightAsn1(src) {
  const toks = tokeniseAsn1(src);
  let html = '';
  for (const t of toks) {
    const safe = escapeHtml(t.text);
    if (!t.cls || t.cls === 'plain') html += safe;
    else html += `<span class="tok-${t.cls}">${safe}</span>`;
  }
  return html;
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Highlight hex bytes: pair grouping plus a dimmed offset column.
 * Returns HTML for a <code> block.
 */
export function highlightHex(hex, bytesPerLine = 16) {
  const cleaned = String(hex || '').replace(/[^0-9a-fA-F]/g, '');
  if (!cleaned) return '';
  const bytes = cleaned.match(/../g) || [];
  const lines = [];
  for (let i = 0; i < bytes.length; i += bytesPerLine) {
    const chunk = bytes.slice(i, i + bytesPerLine);
    const off = i.toString(16).padStart(4, '0');
    const hexPart = chunk.map((b) => `<span class="hex-byte">${b}</span>`).join(' ');
    const ascii = chunk
      .map((b) => {
        const v = parseInt(b, 16);
        return v >= 32 && v < 127 ? escapeHtml(String.fromCharCode(v)) : '.';
      })
      .join('');
    lines.push(
      `<span class="hex-off">${off}</span>  ${hexPart}` +
      `<span class="hex-ascii">${ascii}</span>`
    );
  }
  return lines.join('\n');
}

/**
 * Number of bytes in a hex string, for the status line.
 */
export function hexByteCount(hex) {
  const cleaned = String(hex || '').replace(/[^0-9a-fA-F]/g, '');
  return Math.floor(cleaned.length / 2);
}
