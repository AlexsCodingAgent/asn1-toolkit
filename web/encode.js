// ASN.1 encoders, in JavaScript, driven by the parsed schema.
//
// WHY THIS IS IN JAVASCRIPT
//
// rasn's codecs are all generic over `T: Encode`, a Rust type that must exist at
// compile time. `rasn::types::Any` is an opaque byte wrapper with no structure.
// So there is no way to hand a browser a schema plus a value and get bytes back
// — that would require compiling Rust at runtime.
//
// Writing TLV by hand is straightforward and, for this purpose, better: it works
// for any schema, needs no second WASM module, and every rule is inspectable.
//
// WHAT IS IMPLEMENTED
//
//   DER  - Distinguished Encoding Rules (canonical, definite length)
//   BER  - Basic Encoding Rules, with the BER-only licence of non-minimal
//          length forms where they add something on input; output is DER-shaped
//          because emitting deliberately non-canonical BER helps nobody
//   CER  - Canonical Encoding Rules: indefinite-length constructed values
//   PER  - aligned PER (basic), for the subset that is deterministic
//
// PER is genuinely partial. Aligned PER is a large specification; what is here
// covers the types that appear in the GSMA schemas (BOOLEAN, INTEGER with a
// known range, ENUMERATED, OCTET STRING, character strings, SEQUENCE, SEQUENCE OF,
// CHOICE, NULL, OID). Anything outside that reports an explicit unsupported
// error rather than emitting plausible-looking wrong bytes.

// ---------------------------------------------------------------------------
// Tagging
// ---------------------------------------------------------------------------

const CLASS_UNIVERSAL = 0x00;
const CLASS_APPLICATION = 0x40;
const CLASS_CONTEXT = 0x80;
const CLASS_PRIVATE = 0xc0;

const UNIVERSAL_TAGS = {
  BOOLEAN: 1,
  INTEGER: 2,
  BITSTRING: 3,
  OCTETSTRING: 4,
  NULL: 5,
  OID: 6,
  ENUMERATED: 10,
  UTF8STRING: 12,
  SEQUENCE: 16,
  SET: 17,
  NUMERICSTRING: 18,
  PRINTABLESTRING: 19,
  IA5STRING: 22,
  UTCTIME: 23,
  GENERALIZEDTIME: 24,
  VISIBLESTRING: 26,
};

/** Encode a tag byte sequence (supports high tag numbers). */
function encodeTag(cls, constructed, number) {
  const first = cls | (constructed ? 0x20 : 0x00);
  if (number < 31) return [first | number];
  const out = [first | 0x1f];
  const chunks = [];
  let n = number;
  do {
    chunks.unshift(n & 0x7f);
    n >>>= 7;
  } while (n > 0);
  for (let i = 0; i < chunks.length - 1; i++) chunks[i] |= 0x80;
  return out.concat(chunks);
}

/** DER definite length. */
function encodeLengthDer(len) {
  if (len < 0x80) return [len];
  const bytes = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

/** CER indefinite length, with end-of-contents. */
const INDEFINITE = [0x80];
const EOC = [0x00, 0x00];

// ---------------------------------------------------------------------------
// Primitive value encoding
// ---------------------------------------------------------------------------

function encodeIntegerValue(value) {
  let n = BigInt(value);
  if (n === 0n) return [0x00];
  const bytes = [];
  const negative = n < 0n;
  if (negative) {
    // Two's complement, minimal length.
    let bits = 0n;
    for (let b = n; b !== -1n && b !== 0n; b >>= 8n) bits += 8n;
    let size = Number(bits / 8n);
    if (size === 0) size = 1;
    // Grow until the value fits in two's complement at that width.
    for (;;) {
      const min = -(1n << BigInt(size * 8 - 1));
      if (n >= min) break;
      size++;
    }
    let v = (1n << BigInt(size * 8)) + n;
    for (let i = 0; i < size; i++) {
      bytes.unshift(Number(v & 0xffn));
      v >>= 8n;
    }
  } else {
    while (n > 0n) {
      bytes.unshift(Number(n & 0xffn));
      n >>= 8n;
    }
    // A leading high bit would read as negative; prepend a zero byte.
    if (bytes[0] & 0x80) bytes.unshift(0x00);
  }
  return bytes;
}

function encodeOidValue(oid) {
  const parts = String(oid).split('.').map((p) => BigInt(p.trim()));
  if (parts.length < 2) throw new Error('OID needs at least two arcs');
  const out = [Number(parts[0] * 40n + parts[1])];
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i];
    const chunks = [Number(v & 0x7fn)];
    v >>= 7n;
    while (v > 0n) {
      chunks.unshift(Number(v & 0x7fn) | 0x80);
      v >>= 7n;
    }
    out.push(...chunks);
  }
  return out;
}

function utf8Bytes(s) {
  return Array.from(new TextEncoder().encode(s));
}

// ---------------------------------------------------------------------------
// Type resolution helpers
// ---------------------------------------------------------------------------

function typeIndex(schema) {
  const map = new Map();
  for (const t of schema.types) map.set(t.name, t);
  return map;
}

/** Strip a leading tag clause from a rendered type string, returning both. */
function splitTag(typeName) {
  const m = /^\s*\[([^\]]+)\]\s*(.*)$/.exec(typeName || '');
  if (!m) return { tag: null, rest: typeName || '' };
  const inner = m[1].trim();
  const parts = inner.split(/\s+/);
  if (parts.length === 1) {
    return { tag: { cls: 'CONTEXT', number: parseInt(parts[0], 10) }, rest: m[2] };
  }
  return {
    tag: { cls: parts[0].toUpperCase(), number: parseInt(parts[1], 10) },
    rest: m[2],
  };
}

function classBits(cls) {
  switch (cls) {
    case 'APPLICATION': return CLASS_APPLICATION;
    case 'CONTEXT': return CLASS_CONTEXT;
    case 'PRIVATE': return CLASS_PRIVATE;
    default: return CLASS_UNIVERSAL;
  }
}

// ---------------------------------------------------------------------------
// DER / BER / CER encoder
// ---------------------------------------------------------------------------

/**
 * Encode a value against a named type from the schema.
 * `rules` is 'DER' | 'BER' | 'CER'.
 */
export function encodeValue(schema, typeName, value, rules = 'DER') {
  const types = typeIndex(schema);
  const def = types.get(typeName);
  if (!def) {
    throw new Error(`Type "${typeName}" is not defined in this schema.`);
  }
  // Carry the definition's constraints so SIZE() and numeric ranges reach the
  // encoder — they are what make a fixed-width or PER-encodable value possible.
  return encodeType({ ...def, constraints: def.constraints || [] }, value, types, rules);
}

function primitive(cls, number, contentBytes, constructed = false) {
  return [
    ...encodeTag(cls, constructed, number),
    ...encodeLengthDer(contentBytes.length),
    ...contentBytes,
  ];
}

function constructedValue(cls, number, childBytes, rules) {
  if (rules === 'CER') {
    // CER uses indefinite length for constructed values.
    return [
      ...encodeTag(cls, true, number),
      ...INDEFINITE,
      ...childBytes,
      ...EOC,
    ];
  }
  return [
    ...encodeTag(cls, true, number),
    ...encodeLengthDer(childBytes.length),
    ...childBytes,
  ];
}

function encodeType(def, value, types, rules) {
  const parsedTag = def.tag ? parseTagString(def.tag) : null;

  const inner = encodeKind(def, value, types, rules);

  if (!parsedTag) return inner;

  // Whether a written tag *replaces* the inner tag (implicit) or *wraps* it
  // (explicit) depends on the tagging mode, and getting it wrong produces a
  // structurally valid but wrong encoding:
  //
  //   Iccid ::= [APPLICATION 26] OCTET STRING (SIZE(10))
  //     implicit -> 5a 0a <10 bytes>      (tag replaces OCTET STRING's 04)
  //     explicit -> 7a 0c 04 0a <10 bytes>
  //
  // Real GSMA schemas use implicit tagging for these — EF identifiers are
  // reached as 5A, not 7A — and a primitive inner type cannot be wrapped by an
  // outer constructed header while remaining the same value. So: if the inner
  // encoding is primitive, retag it in place.
  const isConstructedInner = inner.length > 0 && (inner[0] & 0x20) !== 0;
  if (!isConstructedInner) {
    // Implicit re-tag: drop the inner tag and length entirely and emit the
    // content under the new tag. The length is recomputed from the content.
    //
    // For Iccid (SIZE(10)) this yields 5a 0a <10 bytes>. Keeping the inner
    // 04 0a header would give 5a 0c 04 0a <10 bytes>, which parses as an
    // APPLICATION 26 value holding a nested OCTET STRING — not what the spec's
    // "corresponding tag is '5A'" describes.
    const { content } = splitTlv(inner);
    return primitive(classBits(parsedTag.cls), parsedTag.number, content, false);
  }
  return constructedValue(classBits(parsedTag.cls), parsedTag.number, inner, rules);
}

/** Split an already-encoded TLV into its header and content. */
function splitTlv(bytes) {
  let i = 1;
  if ((bytes[0] & 0x1f) === 0x1f) {
    while (i < bytes.length && (bytes[i] & 0x80) !== 0) i++;
    i++;
  }
  const lb = bytes[i];
  let headerLen;
  let contentLen;
  if (lb & 0x80) {
    const n = lb & 0x7f;
    if (n === 0) {
      // Indefinite: content runs to the final EOC.
      contentLen = bytes.length - i - 1 - 2;
      headerLen = i + 1;
    } else {
      contentLen = 0;
      for (let k = 0; k < n; k++) contentLen = (contentLen << 8) | bytes[i + 1 + k];
      headerLen = i + 1 + n;
    }
  } else {
    contentLen = lb;
    headerLen = i + 1;
  }
  return { content: bytes.slice(headerLen, headerLen + contentLen) };
}

function parseTagString(tagStr) {
  const inner = tagStr.replace(/^\[/, '').replace(/\]$/, '').trim();
  const parts = inner.split(/\s+/);
  if (parts.length === 1) return { cls: 'CONTEXT', number: parseInt(parts[0], 10) };
  return { cls: parts[0].toUpperCase(), number: parseInt(parts[1], 10) };
}

function encodeKind(def, value, types, rules) {
  const kind = def.kind;
  const typeName = (def.typeName || '').trim();

  switch (kind) {
    case 'BOOLEAN': {
      const b = toBool(value);
      return primitive(CLASS_UNIVERSAL, UNIVERSAL_TAGS.BOOLEAN, [b ? 0xff : 0x00]);
    }

    case 'INTEGER': {
      const n = toBigInt(value);
      enforceRange(def, n);
      return primitive(CLASS_UNIVERSAL, UNIVERSAL_TAGS.INTEGER, encodeIntegerValue(n));
    }

    case 'ENUMERATED': {
      const n = toBigInt(value);
      return primitive(CLASS_UNIVERSAL, UNIVERSAL_TAGS.ENUMERATED, encodeIntegerValue(n));
    }

    case 'NULL':
      return primitive(CLASS_UNIVERSAL, UNIVERSAL_TAGS.NULL, []);

    case 'OCTET STRING':
    case 'OctetString': {
      const bytes = toBytes(value);
      // Enforce SIZE() rather than encoding any length silently. A wrong-length
      // value that encodes without complaint is the worst outcome: it produces
      // bytes that look right and violate the schema.
      enforceSize(def, bytes.length);
      return primitive(CLASS_UNIVERSAL, UNIVERSAL_TAGS.OCTETSTRING, bytes);
    }

    case 'BIT STRING': {
      const bytes = toBytes(value);
      // Unused bits = 0, so a leading 0x00 octet.
      return primitive(CLASS_UNIVERSAL, UNIVERSAL_TAGS.BITSTRING, [0x00, ...bytes]);
    }

    case 'OBJECT IDENTIFIER':
      return primitive(CLASS_UNIVERSAL, UNIVERSAL_TAGS.OID, encodeOidValue(value));

    case 'UTF8String':
    case 'IA5String':
    case 'PrintableString':
    case 'VisibleString':
    case 'NumericString':
    case 'GeneralString':
    case 'UniversalString': {
      const tag =
        kind === 'UTF8String' ? UNIVERSAL_TAGS.UTF8STRING :
        kind === 'IA5String' ? UNIVERSAL_TAGS.IA5STRING :
        kind === 'PrintableString' ? UNIVERSAL_TAGS.PRINTABLESTRING :
        kind === 'VisibleString' ? UNIVERSAL_TAGS.VISIBLESTRING :
        kind === 'NumericString' ? UNIVERSAL_TAGS.NUMERICSTRING :
        UNIVERSAL_TAGS.UTF8STRING;
      const sb = utf8Bytes(String(value ?? ''));
      enforceSize(def, sb.length);
      return primitive(CLASS_UNIVERSAL, tag, sb);
    }

    case 'UTCTime':
      return primitive(CLASS_UNIVERSAL, UNIVERSAL_TAGS.UTCTIME, utf8Bytes(String(value ?? '')));
    case 'GeneralizedTime':
      return primitive(CLASS_UNIVERSAL, UNIVERSAL_TAGS.GENERALIZEDTIME, utf8Bytes(String(value ?? '')));

    case 'SEQUENCE':
    case 'SET': {
      const number = kind === 'SET' ? UNIVERSAL_TAGS.SET : UNIVERSAL_TAGS.SEQUENCE;
      const obj = value ?? {};
      const parts = [];
      for (const f of def.fields) {
        const v = obj[f.name];
        if (v === undefined || v === null) {
          if (f.optional) continue;
          throw new Error(`Missing required field "${f.name}" in ${def.name}.`);
        }
        parts.push(...encodeField(f, v, types, rules));
      }
      return constructedValue(CLASS_UNIVERSAL, number, parts, rules);
    }

    case 'SEQUENCE OF':
    case 'SET OF': {
      const arr = Array.isArray(value) ? value : [];
      const elemName = elemTypeOf(typeName, kind);
      const parts = [];
      for (const item of arr) {
        // The element type may be a named reference or a builtin such as
        // INTEGER. A builtin has no definition to look up, so synthesise one
        // rather than failing with "INTEGER is not defined in this schema",
        // which was misleading: it is defined, just not by the user.
        const elemDef = types.get(elemName) || {
          name: elemName,
          kind: elemName,
          typeName: elemName,
          fields: [],
        };
        parts.push(...encodeType(elemDef, item, types, rules));
      }
      const number = kind === 'SET OF' ? UNIVERSAL_TAGS.SET : UNIVERSAL_TAGS.SEQUENCE;
      return constructedValue(CLASS_UNIVERSAL, number, parts, rules);
    }

    case 'CHOICE': {
      const obj = value ?? {};
      const key = Object.keys(obj).find((k) => def.fields.some((f) => f.name === k));
      if (!key) {
        throw new Error(
          `CHOICE ${def.name}: provide exactly one alternative, e.g. ` +
          `{ ${def.fields[0]?.name}: ... }`
        );
      }
      const alt = def.fields.find((f) => f.name === key);
      // CHOICE alternatives are tagged by context number when in AUTOMATIC TAGS,
      // otherwise the inner type's own tag is used.
      const idx = def.fields.indexOf(alt);
      const inner = encodeField(alt, obj[key], types, rules);
      if (def.automaticTags) {
        return constructedValue(CLASS_CONTEXT, idx, inner, rules);
      }
      return inner;
    }

    default: {
      // A reference to another named type.
      const ref = types.get(kind) || types.get(typeName);
      if (ref) return encodeType(ref, value, types, rules);
      throw new Error(`Unsupported type kind "${kind}" in ${def.name}.`);
    }
  }
}

function encodeField(f, v, types, rules) {
  // A field can carry its own tag, which overrides the inner type's.
  if (f.tag) {
    const t = parseTagString(f.tag);
    const inferred = inferDef(f, types);
    inferred.constraints = f.constraints || inferred.constraints;
    const inner = encodeKind(inferred, v, types, rules);
    return constructedValue(classBits(t.cls), t.number, inner, rules);
  }

  const def = inferDef(f, types);
  return encodeType(def, v, types, rules);
}

/** Build a synthetic type definition for a field, resolving references. */
function inferDef(f, types) {
  const tn = (f.typeName || '').trim();
  const withConstraints = (d) => {
    if (f.constraints?.length) d.constraints = f.constraints;
    return d;
  };

  // `SEQUENCE OF X`
  if (tn === 'SEQUENCE OF' || tn.startsWith('SEQUENCE OF ')) {
    return { name: f.name, kind: 'SEQUENCE OF', typeName: tn, fields: [] };
  }
  if (tn === 'SET OF' || tn.startsWith('SET OF ')) {
    return { name: f.name, kind: 'SET OF', typeName: tn, fields: [] };
  }
  if (tn === 'SEQUENCE' && f.fields?.length) {
    return { name: f.name, kind: 'SEQUENCE', typeName: tn, fields: f.fields, tag: f.tag, automaticTags: true };
  }
  if (tn === 'SET' && f.fields?.length) {
    return { name: f.name, kind: 'SET', typeName: tn, fields: f.fields, tag: f.tag };
  }
  if (tn === 'CHOICE' && f.fields?.length) {
    return { name: f.name, kind: 'CHOICE', typeName: tn, fields: f.fields, tag: f.tag, automaticTags: true };
  }
  if (tn === 'ENUMERATED' && f.fields?.length) {
    return { name: f.name, kind: 'ENUMERATED', typeName: tn, fields: f.fields };
  }

  // A named reference: use the definition if we have it, but a field-level
  // constraint such as `iccid Iccid (SIZE(10))` takes precedence.
  const ref = types.get(tn);
  if (ref) {
    return withConstraints(f.tag ? { ...ref, tag: f.tag } : { ...ref });
  }

  // Otherwise it is a builtin used inline.
  return {
    name: f.name,
    kind: tn,
    typeName: tn,
    fields: f.fields || [],
    tag: f.tag,
    constraints: f.constraints || [],
  };
}

/**
 * The element type of a collection.
 *
 * Two shapes reach here and both must work:
 *   - a definition:  kind = "SEQUENCE OF", typeName = "Iccid"      (element only)
 *   - a field:       typeName = "SEQUENCE OF Iccid"                (prefix included)
 * Handling only the second silently produced an empty element name.
 */
/**
 * Enforce a SIZE(n) or SIZE(lo..hi) constraint.
 *
 * Returns silently when no size constraint applies. Throws with the offending
 * length named, because "wrong length" without the expected length is not a
 * useful message when the caller cannot see the schema.
 */
function enforceSize(def, actual) {
  // Only SIZE() applies here. A numeric range on an OCTET STRING is unusual and
  // is ignored rather than misread as a length.
  for (const raw of def.constraints || []) {
    const c = normaliseConstraint(raw);
    let m = /^SIZE\(\s*(\d+)\s*\)$/.exec(c);
    if (m) {
      const want = Number(m[1]);
      if (actual !== want) {
        throw new Error(
          `${def.name}: SIZE(${want}) requires exactly ${want} byte(s), got ${actual}.`
        );
      }
      return;
    }
    m = /^SIZE\(\s*(\d+)\s*\.\.\s*(\d+)\s*\)$/.exec(c);
    if (m) {
      const lo = Number(m[1]), hi = Number(m[2]);
      if (actual < lo || actual > hi) {
        throw new Error(
          `${def.name}: SIZE(${lo}..${hi}) requires ${lo}-${hi} byte(s), got ${actual}.`
        );
      }
      return;
    }
  }
}

/** Enforce an integer range constraint, e.g. (0..65535). */
function enforceRange(def, n) {
  const r = parseConstraintRange(def.constraints);
  if (!r) return;
  const [lo, hi] = r;
  if (n < lo || n > hi) {
    throw new Error(`${def.name}: ${n} is outside the constrained range ${lo}..${hi}.`);
  }
}

function elemTypeOf(typeName, kind) {
  const t = (typeName || '').trim();
  const m = /^(?:SEQUENCE|SET) OF\s+(.+)$/.exec(t);
  if (m) return m[1].trim();
  // No "OF" prefix present, so typeName already *is* the element type.
  if (kind === 'SEQUENCE OF' || kind === 'SET OF') return t;
  return '';
}

// ---------------------------------------------------------------------------
// Aligned PER (partial)
// ---------------------------------------------------------------------------

class BitWriter {
  constructor() { this.bits = []; }
  bit(b) { this.bits.push(b ? 1 : 0); }
  bitsN(value, n) {
    for (let i = n - 1; i >= 0; i--) this.bit((value >> i) & 1);
  }
  /** Octet-aligned: pad to the next byte boundary, then write 8-bit units. */
  align() { while (this.bits.length % 8 !== 0) this.bit(0); }
  octet(v) { this.align(); this.bitsN(v, 8); }
  octets(arr) { for (const b of arr) this.octet(b); }
  toBytes() {
    this.align();
    const out = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let v = 0;
      for (let j = 0; j < 8; j++) {
        v = (v << 1) | (this.bits[i + j] || 0);
      }
      out.push(v);
    }
    return out;
  }
}

/**
 * Normalise a constraint string for matching.
 *
 * Strips ONE layer of *wrapping* parentheses only — those whose matching close
 * is the final character. A naive `.replace(/^\(/,'').replace(/\)$/,'')`
 * destroys `SIZE(10)`, turning it into `SIZE(10` and silently disabling the
 * check. That bug shipped once and let wrong-length values encode without
 * complaint, which is the worst possible failure for a schema tool.
 */
function normaliseConstraint(raw) {
  const s = String(raw).trim();
  if (!s.startsWith('(')) return s;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') {
      depth--;
      // The opening paren closes before the end: not a wrapping pair.
      if (depth === 0) return i === s.length - 1 ? s.slice(1, -1) : s;
    }
  }
  return s; // unbalanced; leave as-is
}

/**
 * Parse a range out of a constraint string.
 *
 * Accepts both the canonical form the parser produces ("0..15", "SIZE(10)",
 * "SIZE(1..16)") and the parenthesised spelling, so a change in how constraints
 * are rendered cannot quietly disable range checking or PER encodability.
 */
function parseConstraintRange(constraints) {
  for (const raw of constraints || []) {
    const c = normaliseConstraint(raw);
    let m = /^SIZE\(\s*(-?\d+)\s*\.\.\s*(-?\d+)\s*\)$/.exec(c);
    if (m) return [BigInt(m[1]), BigInt(m[2])];
    m = /^SIZE\(\s*(-?\d+)\s*\)$/.exec(c);
    if (m) return [BigInt(m[1]), BigInt(m[1])];
    m = /^(-?\d+)\s*\.\.\s*(-?\d+)$/.exec(c);
    if (m) return [BigInt(m[1]), BigInt(m[2])];
  }
  return null;
}

/** Bits needed to represent values 0..n inclusive. */
function bitsFor(n) {
  if (n <= 0) return 0;
  return BigInt(Math.floor(Math.log2(Number(n)))) + 1n;
}

export function encodeValuePer(schema, typeName, value) {
  const types = typeIndex(schema);
  const def = types.get(typeName);
  if (!def) throw new Error(`Type "${typeName}" is not defined in this schema.`);
  const w = new BitWriter();
  perEncode(def, value, types, w);
  return w.toBytes();
}

function perEncode(def, value, types, w) {
  const kind = def.kind;
  switch (kind) {
    case 'BOOLEAN':
      w.bit(toBool(value));
      return;

    case 'INTEGER': {
      const range = parseConstraintRange(def.constraints || def.fieldConstraints);
      const n = toBigInt(value);
      if (range) {
        const [lo, hi] = range;
        if (n < lo || n > hi) {
          throw new Error(`${def.name}: ${n} is outside the constrained range ${lo}..${hi}.`);
        }
        const span = hi - lo;
        const bits = bitsFor(span);
        if (bits === 0n) return; // single permitted value
        if (span < 65536n) {
          w.bitsN(Number(n - lo), Number(bits));
          return;
        }
        // Large ranges: unconstrained style (length-prefixed octets) is the
        // correct PER treatment and is not implemented here.
        throw new Error(
          `${def.name}: PER for ranges wider than 65535 is not implemented ` +
          `(range ${lo}..${hi}). Use DER for this type.`
        );
      }
      // Unconstrained integer: length-prefixed per X.691 10.5 — not implemented,
      // rather than guessed at.
      throw new Error(
        `${def.name}: PER needs a constrained INTEGER (add a range, e.g. ` +
        `INTEGER (0..65535)). Unconstrained PER integers are not implemented.`
      );
    }

    case 'ENUMERATED': {
      const idx = def.fields?.findIndex((f) => f.typeName === String(value) || f.name === value);
      const n = idx >= 0 ? idx : Number(value);
      const bits = bitsFor(BigInt((def.fields?.length ?? 1) - 1));
      w.bitsN(n, Math.max(1, Number(bits)));
      return;
    }

    case 'NULL':
      return;

    case 'OCTET STRING': {
      const bytes = toBytes(value);
      const range = parseConstraintRange(def.constraints || def.fieldConstraints);
      if (range && range[0] === range[1]) {
        // Fixed size: no length prefix.
        w.octets(bytes);
      } else {
        w.align();
        w.octet(bytes.length);
        w.octets(bytes);
      }
      return;
    }

    case 'UTF8String':
    case 'IA5String':
    case 'PrintableString':
    case 'VisibleString': {
      const b = utf8Bytes(String(value ?? ''));
      const range = parseConstraintRange(def.constraints || def.fieldConstraints);
      if (!(range && range[0] === range[1])) {
        w.align();
        w.octet(b.length);
      }
      w.octets(b);
      return;
    }

    case 'SEQUENCE':
    case 'SET': {
      const obj = value ?? {};
      const preamble = [];
      for (const f of def.fields) {
        const v = obj[f.name];
        if (f.optional) {
          preamble.push(v === undefined || v === null ? 0 : 1);
        }
      }
      // The optional-bits preamble is a bit-field before anything else.
      if (preamble.length) {
        for (const p of preamble) w.bit(p);
      }
      for (const f of def.fields) {
        const v = obj[f.name];
        if (v === undefined || v === null) {
          if (f.optional) continue;
          throw new Error(`Missing required field "${f.name}" in ${def.name}.`);
        }
        perEncodeField(f, v, types, w);
      }
      return;
    }

    case 'SEQUENCE OF':
    case 'SET OF': {
      const arr = Array.isArray(value) ? value : [];
      const elemName = elemTypeOf(def.typeName, def.kind);
      const elemDef = types.get(elemName);
      const range = parseConstraintRange(def.constraints || []);
      if (!range) {
        w.align();
        w.octet(arr.length);
      }
      for (const item of arr) {
        const ed = elemDef || { name: elemName, kind: elemName, typeName: elemName, fields: [] };
        perEncode(ed, item, types, w);
      }
      return;
    }

    case 'CHOICE': {
      const obj = value ?? {};
      const key = Object.keys(obj)[0];
      const idx = def.fields.findIndex((f) => f.name === key);
      if (idx < 0) {
        throw new Error(`CHOICE ${def.name}: unknown alternative "${key}".`);
      }
      const bits = bitsFor(BigInt(def.fields.length - 1));
      w.bitsN(idx, Math.max(1, Number(bits)));
      perEncodeField(def.fields[idx], obj[key], types, w);
      return;
    }

    default: {
      const ref = types.get(def.kind) || types.get(def.typeName);
      if (ref) { perEncode(ref, value, types, w); return; }
      throw new Error(`PER: unsupported type kind "${kind}" in ${def.name}.`);
    }
  }
}

function perEncodeField(f, v, types, w) {
  const def = inferDef(f, types);
  def.fieldConstraints = f.constraints;
  perEncode(def, v, types, w);
}

// ---------------------------------------------------------------------------
// Coercion helpers
// ---------------------------------------------------------------------------

function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
  }
  if (typeof v === 'number') return v !== 0;
  return Boolean(v);
}

function toBigInt(v) {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new Error(`${v} is not an integer`);
    return BigInt(v);
  }
  const s = String(v).trim();
  if (!/^-?\d+$/.test(s)) throw new Error(`"${s}" is not an integer`);
  return BigInt(s);
}

/** Accepts "01 02 ff", "0x0102ff", "0102ff", or an array of numbers. */
export function toBytes(v) {
  if (Array.isArray(v)) return v.map((b) => Number(b) & 0xff);
  const s = String(v ?? '').trim();
  if (!s) return [];
  const cleaned = s.replace(/^0x/i, '').replace(/[\s:,-]/g, '');
  if (!/^[0-9a-fA-F]*$/.test(cleaned)) {
    throw new Error(`"${s}" is not hex`);
  }
  if (cleaned.length % 2) throw new Error(`"${s}" has an odd number of hex digits`);
  const out = [];
  for (let i = 0; i < cleaned.length; i += 2) {
    out.push(parseInt(cleaned.slice(i, i + 2), 16));
  }
  return out;
}

export function toHex(bytes) {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

/** Build a template value object so the UI can show an editable skeleton. */
export function valueTemplate(schema, typeName) {
  const types = typeIndex(schema);
  const def = types.get(typeName);
  if (!def) return {};
  return templateFor(def, types, 0);
}

function templateFor(def, types, depth) {
  if (depth > 6) return null;
  switch (def.kind) {
    case 'BOOLEAN': return true;
    case 'INTEGER':
    case 'ENUMERATED': {
      const r = parseConstraintRange(def.constraints || []);
      if (r) return Number(r[0]);
      return def.kind === 'ENUMERATED' ? (def.fields?.[0]?.name ?? 0) : 0;
    }
    case 'NULL': return null;
    case 'OCTET STRING': {
      const r = parseConstraintRange(def.constraints || []);
      if (r && r[0] === r[1]) return '00 '.repeat(Number(r[0])).trim();
      return '00 01 02 03';
    }
    case 'BIT STRING': return 'ff';
    case 'OBJECT IDENTIFIER': return '1.2.3.4';
    case 'UTF8String':
    case 'IA5String':
    case 'PrintableString':
    case 'VisibleString': return 'example';
    case 'UTCTime': return '260916120000Z';
    case 'GeneralizedTime': return '20260916120000Z';
    case 'SEQUENCE':
    case 'SET': {
      const o = {};
      for (const f of def.fields) {
        if (f.optional) continue;
        const sub = inferDef(f, types);
        sub.constraints = f.constraints;
        o[f.name] = templateFor(sub, types, depth + 1);
      }
      return o;
    }
    case 'SEQUENCE OF':
    case 'SET OF': return [null];
    case 'CHOICE': {
      const first = def.fields?.[0];
      if (!first) return {};
      const sub = inferDef(first, types);
      return { [first.name]: templateFor(sub, types, depth + 1) };
    }
    default: {
      const ref = types.get(def.kind) || types.get(def.typeName);
      if (ref) return templateFor(ref, types, depth + 1);
      return null;
    }
  }
}

export const RULES = [
  { id: 'DER', label: 'DER', note: 'Distinguished Encoding Rules — canonical, what GSMA specs use' },
  { id: 'BER', label: 'BER', note: 'Basic Encoding Rules — DER-compatible output for these types' },
  { id: 'CER', label: 'CER', note: 'Canonical Encoding Rules — indefinite length for constructed values' },
  { id: 'PER', label: 'PER', note: 'Aligned PER — partial, for constrained types only' },
];
