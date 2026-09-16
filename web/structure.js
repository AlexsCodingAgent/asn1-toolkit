// Schema structure extraction.
//
// WHY THIS IS IN JAVASCRIPT, NOT RUST
//
// The obvious design is to read the parsed AST out of rasn-compiler and render
// it. That is not possible with the crate's public API, verified by reading its
// source:
//
//   - `Compiler.state` is a private field, with no accessor.
//   - `lexer` (containing the parser entry point `asn_spec`) is a private module.
//   - `compile()` and `compile_to_string()` both *consume* `self` and return only
//     the generated string (plus warnings), discarding the module.
//
// So there is no public path from "ASN.1 text" to "parsed types" in
// rasn-compiler 0.16. The intermediate representation is public as *types*, but
// nothing hands you an instance.
//
// Rather than vendor a patched fork or scrape the generated Rust back into
// structure, this extracts the structure from the source text directly. That is
// defensible here because the subset of ASN.1 that tools actually read —
// SEQUENCE/SET bodies, CHOICE alternatives, ENUMERATED items, type aliases and
// their tags and constraints — is regular enough to parse reliably. It is
// explicitly NOT a general ASN.1 parser: it does not evaluate parameterised
// types, information object classes, or value assignments, and those are
// reported as opaque rather than guessed at.

// Keywords that can directly precede the module header's own `::=`.
// `EXTENSIBILITY IMPLIED ::=` and `AUTOMATIC TAGS ::=` are headers, not types.
const MODULE_HEADER_TAIL = new Set([
  'IMPLIED', 'TAGS', 'AUTOMATIC', 'IMPLICIT', 'EXPLICIT', 'EXTENSIBILITY',
]);

// Structural keywords that end up in `typeName` when a construct is being read
// but are not type references. Reported as unresolved they would be pure noise.
const ASN1_KEYWORDS = new Set([
  'SEQUENCE', 'SET', 'CHOICE', 'OF', 'OPTIONAL', 'DEFAULT', 'IMPLICIT',
  'EXPLICIT', 'ANY', 'auto',
]);

const BUILTIN_TYPES = new Set([
  'BOOLEAN', 'INTEGER', 'BIT STRING', 'OCTET STRING', 'NULL', 'OBJECT IDENTIFIER',
  'REAL', 'ENUMERATED', 'UTF8String', 'NumericString', 'PrintableString',
  'TeletexString', 'T61String', 'VideotexString', 'IA5String', 'GraphicString',
  'VisibleString', 'ISO646String', 'GeneralString', 'UniversalString',
  'BMPString', 'UTCTime', 'GeneralizedTime', 'ObjectDescriptor', 'EXTERNAL',
  'EMBEDDED PDV', 'ANY', 'RELATIVE-OID',
]);

// ---------------------------------------------------------------------------
// Tokeniser
// ---------------------------------------------------------------------------

/**
 * Strip ASN.1 comments while preserving string literal contents and — crucially
 * — tracking line numbers so error positions stay meaningful.
 */
export function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    // `--` starts a comment to end of line, unless inside a quoted string.
    if (c === '-' && src[i + 1] === '-') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '"') {
      out += c; i++;
      while (i < n) {
        out += src[i];
        if (src[i] === '"') { i++; break; }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Split into tokens, keeping track of brace depth and line numbers. */
function tokenise(src) {
  const toks = [];
  let i = 0, line = 1;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== '"') { if (src[j] === '\n') line++; j++; }
      toks.push({ t: 'str', v: src.slice(i, j + 1), line });
      i = j + 1;
      continue;
    }
    if (c === ':' && src[i + 1] === ':' && src[i + 2] === '=') {
      // `::=` must be one token. Without this the scanner emits ':' ':' '='
      // and no type assignment is ever recognised.
      toks.push({ t: 'assign', v: '::=', line });
      i += 3;
      continue;
    }
    if (c === ':' && src[i + 1] === ':') {
      toks.push({ t: 'punct', v: '::', line });
      i += 2;
      continue;
    }
    if ('{}()[]|,;:'.includes(c)) {
      toks.push({ t: 'punct', v: c, line });
      i++;
      continue;
    }
    if (c === '-' && src[i + 1] === '>') { toks.push({ t: 'punct', v: '->', line }); i += 2; continue; }
    if (c === '.' && src[i + 1] === '.' && src[i + 2] === '.') {
      toks.push({ t: 'ellipsis', v: '...', line }); i += 3; continue;
    }
    if (c === '.' && src[i + 1] === '.') { toks.push({ t: 'punct', v: '..', line }); i += 2; continue; }
    // Identifier / keyword / number
    let j = i;
    while (j < n && !/[\s{}()\[\]|,;:"']/.test(src[j])) {
      if (src[j] === '-' && src[j + 1] === '-') break;
      if (src[j] === '.' && src[j + 1] === '.') break;
      j++;
    }
    if (j === i) j = i + 1;
    toks.push({ t: 'word', v: src.slice(i, j), line });
    i = j;
  }
  return toks;
}

// ---------------------------------------------------------------------------
// Structure extraction
// ---------------------------------------------------------------------------

/**
 * Parse a schema into a list of type definitions.
 * Returns { types, module, tagging, unresolved }.
 */
export function parseStructure(src) {
  const clean = stripComments(src);
  const toks = tokenise(clean);

  // --- module header ---
  let module = '';
  let tagging = '';
  for (let i = 0; i < toks.length; i++) {
    const v = toks[i].v;
    if (v === 'DEFINITIONS') {
      module = toks[i - 1] ? toks[i - 1].v : '';
      // Tagging mode sits between DEFINITIONS and ::=
      for (let j = i; j < Math.min(i + 8, toks.length); j++) {
        if (toks[j].v === 'AUTOMATIC' && toks[j + 1]?.v === 'TAGS') tagging = 'AUTOMATIC TAGS';
        if (toks[j].v === 'IMPLICIT' && toks[j + 1]?.v === 'TAGS') tagging = 'IMPLICIT TAGS';
        if (toks[j].v === 'EXPLICIT' && toks[j + 1]?.v === 'TAGS') tagging = 'EXPLICIT TAGS';
        if (toks[j].v === '::=') break;
      }
      break;
    }
  }

  // Everything before BEGIN is module header; no type assignments live there.
  let beginIdx = -1;
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].v === 'BEGIN') { beginIdx = i; break; }
  }

  const types = [];
  const definedNames = new Set();

  // A type assignment looks like:  Name ::= <type>
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].v !== '::=') continue;
    const nameTok = toks[i - 1];
    if (!nameTok || nameTok.t !== 'word') continue;
    const name = nameTok.v;
    if (name === 'DEFINITIONS') continue;
    if (BUILTIN_TYPES.has(name)) continue;
    if (definedNames.has(name)) continue;
    // The module header's own `::=` is preceded by a tag/mode keyword such as
    // `IMPLIED` (EXTENSIBILITY IMPLIED ::=) or `TAGS`. Those are not types.
    if (MODULE_HEADER_TAIL.has(name)) continue;
    // A module header line ends the header; everything before BEGIN is not a type.
    if (beginIdx !== -1 && i < beginIdx) continue;

    const { def, end } = readTypeExpr(toks, i + 1, name);
    if (def) {
      definedNames.add(name);
      types.push(def);
      i = end - 1;
    }
  }

  // Which referenced names are neither builtin nor defined here?
  const unresolved = [];
  const seen = new Set();
  const walk = (fields) => {
    for (const f of fields) {
      // `SEQUENCE OF Iccid` references `Iccid`, not the compound string — check
      // the base name, otherwise every collection reports a false unresolved.
      let base = (f.typeName || '').trim();
      const ofIdx = base.indexOf(' OF ');
      if (ofIdx !== -1) base = base.slice(ofIdx + 4).trim();

      // Only consider things that look like a type name. Anything else here is
      // an artefact of reading a spec's prose (punctuation, a stray word, a
      // version marker) and reporting it as an unresolved type is noise.
      const isTypeName = /^[A-Za-z][A-Za-z0-9-]*$/.test(base);
      if (
        isTypeName &&
        !ASN1_KEYWORDS.has(base) &&
        !BUILTIN_TYPES.has(base) &&
        !definedNames.has(base) &&
        !seen.has(base)
      ) {
        seen.add(base);
        unresolved.push(base);
      }
      // NB: must not `return` here — that would abandon the rest of the field
      // list and silently skip nested types, making the unresolved list
      // incomplete in a way that looks like good news.
      if (f.fields?.length) walk(f.fields);
    }
  };
  for (const t of types) walk(t.fields);

  // Total fields across all types. The UI shows this as a summary figure, so it
  // must exist — returning only `types` made every caller print "undefined".
  const totalFields = types.reduce((n, t) => n + (t.fields?.length || 0), 0);

  return {
    module,
    tagging,
    types,
    unresolved: unresolved.sort(),
    totalFields,
  };
}

/** Read a type expression starting at token index `i`. */
function readTypeExpr(toks, i, name) {
  let tag = '';
  let j = i;

  // Leading tag: [APPLICATION 26] / [0] / [UNIVERSAL 16]
  if (toks[j]?.v === '[') {
    const start = j;
    while (j < toks.length && toks[j].v !== ']') j++;
    tag = toks.slice(start, j + 1).map((t) => t.v).join(' ')
      .replace(/\[\s*/g, '[').replace(/\s*\]/g, ']')
      .replace(/\s+/g, ' ');
    j++;
    // `IMPLICIT`/`EXPLICIT` may follow a tag.
    if (toks[j]?.v === 'IMPLICIT' || toks[j]?.v === 'EXPLICIT') j++;
  }

  const head = toks[j]?.v;

  // SEQUENCE / SET with a body
  if (head === 'SEQUENCE' || head === 'SET') {
    // Distinguish `SEQUENCE OF X` from `SEQUENCE { ... }`.
    if (toks[j + 1]?.v === 'OF') {
      const r = readSimpleType(toks, j + 2);
      const d = finish(name, head + ' OF', r.typeName, [], tag, toks, i, r.end).def;
      d.constraints = r.constraints || [];
      return { def: d, end: r.end };
    }
    if (toks[j + 1]?.v === '{') {
      const { fields, end, extensible } = readMembers(toks, j + 1);
      return finish(name, head, '', fields, tag, toks, i, end, extensible);
    }
    // `SEQUENCE (SIZE(...)) OF X` — constraints before OF.
    if (toks[j + 1]?.v === '(') {
      let k = j + 1, depth = 0;
      while (k < toks.length) {
        if (toks[k].v === '(') depth++;
        if (toks[k].v === ')') { depth--; if (depth === 0) { k++; break; } }
        k++;
      }
      if (toks[k]?.v === 'OF') {
        const r = readSimpleType(toks, k + 1);
        const d = finish(name, head + ' OF', r.typeName, [], tag, toks, i, r.end).def;
        d.constraints = r.constraints || [];
        return { def: d, end: r.end };
      }
    }
  }

  if (head === 'CHOICE' && toks[j + 1]?.v === '{') {
    const { fields, end, extensible } = readMembers(toks, j + 1);
    return finish(name, 'CHOICE', '', fields, tag, toks, i, end, extensible);
  }

  if (head === 'ENUMERATED' && toks[j + 1]?.v === '{') {
    const { fields, end } = readEnumItems(toks, j + 1);
    return finish(name, 'ENUMERATED', '', fields, tag, toks, i, end);
  }

  // Anything else: a simple type, possibly with constraints.
  // The constraints matter: SIZE(10) decides a fixed-width encoding and a
  // numeric range is required for PER. Dropping them here silently loses both.
  const r = readSimpleType(toks, j);
  const def = {
    name,
    kind: r.typeName,
    typeName: r.typeName,
    fields: [],
    tag,
    constraints: r.constraints || [],
    extensible: false,
    fieldCount: 0,
  };
  return { def, end: r.end };
}

/** True when every bracket in `s` is closed exactly once. */
function balanced(s) {
  let d = 0;
  for (const ch of s) {
    if (ch === '(') d++;
    else if (ch === ')') { d--; if (d < 0) return false; }
  }
  return d === 0;
}

function finish(name, kind, typeName, fields, tag, toks, start, end, extensible = false) {
  const def = {
    name,
    kind,
    typeName,
    fields,
    tag,
    constraints: [],
    extensible,
    fieldCount: fields.length,
  };
  return { def, end };
}

/**
 * Read a possibly-multi-word type reference plus trailing constraints, e.g.
 * `OCTET STRING (SIZE(3))` or `OperatorId` or `SEQUENCE OF Iccid`.
 */
function readSimpleType(toks, i) {
  let j = i;
  const parts = [];

  // Multi-word builtins first.
  const twoWord = ['OCTET STRING', 'BIT STRING', 'OBJECT IDENTIFIER', 'EMBEDDED PDV', 'RELATIVE-OID', 'CHARACTER STRING'];
  const two = [toks[j]?.v, toks[j + 1]?.v].filter(Boolean).join(' ');
  if (twoWord.includes(two)) {
    parts.push(two);
    j += 2;
  } else if (toks[j]?.t === 'word') {
    parts.push(toks[j].v);
    j++;
  }

  // `SEQUENCE OF X` / `SET OF X` as a field type
  if ((parts[0] === 'SEQUENCE' || parts[0] === 'SET') && toks[j]?.v === 'OF') {
    const inner = readSimpleType(toks, j + 1);
    parts.push('OF', inner.typeName);
    j = inner.end;
  }

  // Trailing constraints: ( ... ) possibly repeated
  const constraints = [];
  while (toks[j]?.v === '(') {
    let depth = 0;
    const start = j;
    while (j < toks.length) {
      if (toks[j].v === '(') depth++;
      if (toks[j].v === ')') { depth--; if (depth === 0) { j++; break; } }
      j++;
    }
    let c = toks.slice(start, j).map((t) => t.v).join('')
      .replace(/\(\s*/g, '(').replace(/\s*\)/g, ')')
      .replace(/\s+/g, ' ');
    // The slice includes the clause's own outer parens, giving "(SIZE(10))".
    // Drop exactly one layer so consumers see "SIZE(10)" / "0..15".
    if (c.startsWith('(') && c.endsWith(')') && balanced(c.slice(1, -1))) {
      c = c.slice(1, -1);
    }
    constraints.push(c);
  }

  return {
    typeName: parts.join(' '),
    constraints,
    end: j,
  };
}

/** Read the members of a SEQUENCE/SET/CHOICE body. `i` points at '{'. */
function readMembers(toks, i) {
  const fields = [];
  let j = i + 1;
  let extensible = false;
  let pendingComments = [];

  while (j < toks.length && toks[j].v !== '}') {
    if (toks[j].t === 'ellipsis') {
      extensible = true;
      j++;
      // Skip any exception spec after the ellipsis.
      if (toks[j]?.v === ',') j++;
      continue;
    }

    const nameTok = toks[j];
    if (nameTok.t !== 'word') { j++; continue; }

    const fieldName = nameTok.v;
    const fieldLine = nameTok.line;
    j++;

    // Optional leading tag on the component.
    let tag = '';
    if (toks[j]?.v === '[') {
      const start = j;
      while (j < toks.length && toks[j].v !== ']') j++;
      tag = toks.slice(start, j + 1).map((t) => t.v).join(' ')
        .replace(/\[\s*/g, '[').replace(/\s*\]/g, ']').replace(/\s+/g, ' ');
      j++;
      if (toks[j]?.v === 'IMPLICIT' || toks[j]?.v === 'EXPLICIT') j++;
    }

    // The component's type.
    const { typeName, constraints, end } = readSimpleType(toks, j);
    j = end;

    // Nested body for SEQUENCE/SET/CHOICE components.
    let nested = [];
    let nestedExtensible = false;
    if (toks[j]?.v === '{') {
      const r = (typeName === 'CHOICE' || typeName === 'SEQUENCE' || typeName === 'SET')
        ? readMembers(toks, j)
        : readMembers(toks, j);
      nested = r.fields;
      nestedExtensible = r.extensible;
      j = r.end;
    }

    // OPTIONAL / DEFAULT / trailer
    let optional = false;
    if (toks[j]?.v === 'OPTIONAL') { optional = true; j++; }
    if (toks[j]?.v === 'DEFAULT') { optional = true; j++; }

    if (toks[j]?.v === ',') j++;

    fields.push({
      name: fieldName,
      typeName,
      constraints,
      optional,
      tag,
      line: fieldLine,
      fields: nested,
      extensible: nestedExtensible,
    });
  }

  return { fields, end: j + 1, extensible };
}

/** ENUMERATED items: `name(0), name(1)` or bare `name`. */
function readEnumItems(toks, i) {
  const items = [];
  let j = i + 1;
  while (j < toks.length && toks[j].v !== '}') {
    if (toks[j].t === 'ellipsis') { j++; if (toks[j]?.v === ',') j++; continue; }
    if (toks[j].t === 'word') {
      const name = toks[j].v;
      let value = 'auto';
      j++;
      if (toks[j]?.v === '(') {
        const start = ++j;
        while (j < toks.length && toks[j].v !== ')') j++;
        value = toks.slice(start, j).map((t) => t.v).join('');
        j++;
      }
      items.push({ name, typeName: value, constraints: [], optional: false, tag: '', fields: [] });
    } else {
      j++;
    }
    if (toks[j]?.v === ',') j++;
  }
  return { fields: items, end: j + 1 };
}
