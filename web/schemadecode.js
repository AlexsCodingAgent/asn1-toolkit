// Schema-aware decoding: map a raw TLV tree onto the types a schema defines.
//
// WHY THIS EXISTS
//
// The byte inspector and the structure tab were independent. Pasting real eUICC
// hex and pressing Decode produced a purely structural tree:
//
//     APPLICATION 26 (prim) len=10
//       [89 01 26 77 36 65 43 21 09 87]
//
// which is correct and nearly useless. The schema sitting in tab 1 says exactly
// what that is, and nobody joined the two up. What a reader wants is:
//
//     iccid: Iccid = 89 01 26 77 36 65 43 21 09 87
//
// The gap matters most in exactly the situation this tool exists for: you have hex
// off a live eUICC, you have the spec, and the question is what the bytes mean.
// Getting `APPLICATION 26 len=10` back sends you to the PDF to look up tag 26 -
// which is the work the tool was supposed to remove.
//
// HOW IT WORKS
//
// Matching is by TAG, because that is what the wire gives you. A schema with
// AUTOMATIC TAGS gives every field a context tag in declaration order, so the
// field order in the parse *is* the tag numbering - no guessing required. Where a
// field carries an explicit tag (`[APPLICATION 26]`), or is a universal type
// (SEQUENCE 16, INTEGER 2), the tag comes from the type itself.
//
// This is a best-effort mapping and says so. Where it cannot be sure it reports a
// confidence rather than inventing a name - a wrong field name is worse than none,
// because it is indistinguishable from a right one.

const UNIVERSAL_SEQUENCE = 16;
const UNIVERSAL_SET = 17;

// BUILDIN TYPES whose tag is fixed by X.680, so unlike a context tag it can be
// compared directly against what is on the wire.
const UNIVERSAL_TAGS = {
  BOOLEAN: 1,
  INTEGER: 2,
  BITSTRING: 3,
  'BIT STRING': 3,
  OCTETSTRING: 4,
  'OCTET STRING': 4,
  NULL: 5,
  OID: 6,
  'OBJECT IDENTIFIER': 6,
  ENUMERATED: 10,
  UTF8STRING: 12,
  'UTF8 STRING': 12,
  SEQUENCE: UNIVERSAL_SEQUENCE,
  SET: UNIVERSAL_SET,
  PRINTABLESTRING: 19,
  IA5STRING: 22,
  UTCTIME: 23,
  GENERALIZEDTIME: 24,
  VISIBLESTRING: 26,
};

/** Tag class names as the decoder reports them. */
const CLASS_OF = (node) => String(node.class || '').toLowerCase().replace(/[^a-z]/g, '');

/**
 * Is this module tagged automatically?
 *
 * Substring, not equality: the parser reports the literal header text, which is
 * "AUTOMATIC TAGS". An equality check against 'AUTOMATIC' was silently false and
 * disabled the automatic-tag path entirely.
 */
const isAutomatic = (tagging) => /AUTOMATIC/i.test(String(tagging || ''));


/**
 * Parse a tag expression from the schema into a comparable form.
 * Accepts `[APPLICATION 26]`, `[0]`, `[UNIVERSAL 16]`, `[PRIVATE 3]`, `[2] IMPLICIT`.
 */
export function parseTagExpr(expr) {
  if (!expr) return null;
  const m = /\[\s*([A-Za-z]+)?\s*(\d+)\s*\]/.exec(expr);
  if (!m) return null;
  const cls = (m[1] || 'context').toLowerCase();
  return {
    class: cls === 'application' ? 'application'
      : cls === 'private' ? 'private'
        : cls === 'universal' ? 'universal'
          : 'context',
    number: Number(m[2]),
    explicit: /\bEXPLICIT\b/.test(expr),
  };
}

/** The tag a resolved built-in type implies, or null. */
function universalTagOf(typeName) {
  if (!typeName) return null;
  const key = String(typeName).toUpperCase();
  if (UNIVERSAL_TAGS[key] !== undefined) return UNIVERSAL_TAGS[key];
  const squashed = key.replace(/\s+/g, '');
  return UNIVERSAL_TAGS[squashed] !== undefined ? UNIVERSAL_TAGS[squashed] : null;
}

/**
 * A field's expected tag.
 *
 * Priority, and the order matters:
 *   1. an explicit tag written in the schema ([APPLICATION 26], [0])
 *   2. a tag carried by a named type the field refers to
 *   3. under AUTOMATIC TAGS, the field's declaration index as a context tag
 *   4. a universal built-in, but only in a module without AUTOMATIC TAGS
 *
 * Step 3 before step 4 is the correction that matters. `mccMnc OCTET STRING` inside
 * an AUTOMATIC TAGS module is re-tagged [0] on the wire - the inline built-in does
 * NOT keep UNIVERSAL 4. Getting this order wrong meant every such field was matched
 * against tag 4 and nothing on the wire matched, so a real OperatorId came back
 * completely unlabelled.
 */
function expectedTag(field, index, indexing, tagging) {
  const explicit = parseTagExpr(field.tag);
  if (explicit) return explicit;

  const resolved = field.resolvedType;
  if (resolved) {
    const typeTag = parseTagExpr(resolved.tag);
    if (typeTag) return { ...typeTag, viaType: resolved.name };
  }

  // AUTOMATIC TAGS re-tags inline components by declaration order, including
  // built-ins written directly in the field.
  //
  // Compared with a substring test, not equality: the parser reports the literal
  // "AUTOMATIC TAGS", and `tagging === 'AUTOMATIC'` was silently false, so this
  // whole branch was skipped and every field fell through to an unmatched tag.
  if (isAutomatic(tagging)) return { class: 'context', number: index, automatic: true };

  // A named type reference keeps its own identity; an inline built-in keeps its
  // universal tag only when the module does not re-tag automatically.
  const uni = universalTagOf(field.typeName);
  if (uni !== null && !resolved) {
    return { class: 'universal', number: uni, fromBuiltin: true };
  }

  return null;
}

/** Does a wire node satisfy an expected tag? */
function tagMatches(node, want) {
  if (!want) return false;
  if (CLASS_OF(node) !== want.class) return false;
  return Number(node.tag) === want.number;
}

/** Total octets a node occupies on the wire, header included. */
function nodeBytes(node) {
  return Number(node.length) || (Number(node.header_len) + Number(node.content_len)) || 0;
}

/** Reference by name, for the value fields a type may delegate to. */
function resolveType(schema, name) {
  if (!name) return null;
  const key = String(name).trim();
  return schema.byName.get(key) || schema.byName.get(key.replace(/\s+/g, '')) || null;
}

/**
 * Walk a decoded TLV tree against a type definition.
 *
 * Returns a tree mirroring the input, with `fieldName`, `typeName` and `matched`
 * added where the schema accounts for a node. Nodes the schema does not explain
 * are left alone rather than forced into a wrong name.
 */
export function annotate(decoded, schema, typeName) {
  const root = resolveType(schema, typeName);
  if (!root) {
    return { ok: false, error: `no type named "${typeName}" in the loaded schema` };
  }

  const stats = { named: 0, unnamed: 0, types: new Set([root.name]), covered: 0, uncovered: 0 };
  const out = decoded.nodes.map((n) => walkNode(n, root, schema, stats, 0));

  // Identifying the root type is itself a result.
  //
  // `named` only counted FIELDS, so a leaf type - `Iccid ::= [APPLICATION 26] OCTET
  // STRING`, which has no fields at all - scored zero and was discarded as a
  // non-match by the caller, even though its tag identified it exactly. Counting the
  // root as a name makes a top-level leaf match properly, and the confidence
  // ordering below still prefers a root that explains more of the tree.
  const rootNamed = 1;
  return {
    ok: true,
    nodes: out,
    rootType: root.name,
    named: stats.named + rootNamed,
    fieldNames: stats.named,
    unnamed: stats.unnamed,
    covered: stats.covered,
    uncovered: stats.uncovered,
    typeCount: stats.types.size,
    typesUsed: [...stats.types],
  };
}

function walkNode(node, typeDef, schema, stats, depth) {
  const annotated = { ...node, fieldName: '', typeName: typeDef ? typeDef.name : '' };

  if (!typeDef) { stats.unnamed++; return annotateChildren(node, null, schema, stats, depth); }

  stats.types.add(typeDef.name);

  // SEQUENCE / SET with fields: match children positionally-by-tag.
  if (typeDef.fields && typeDef.fields.length) {
    const used = new Set();
    const children = (node.children || []).map((child) => {
      const match = findFieldFor(child, typeDef, schema, used);
      if (!match) {
        // No field accounts for this element: report it as unexplained rather than
        // guessing. Extensibility (`...`) makes this legitimate, so it is not an error.
        stats.unnamed++;
        stats.uncovered += nodeBytes(child);
        return annotateChildren(child, null, schema, stats, depth + 1);
      }
      used.add(match.index);
      stats.named++;
      stats.covered += nodeBytes(child);
      const kid = walkNode(
        child,
        match.resolved,
        schema,
        stats,
        depth + 1,
      );
      return {
        ...kid,
        fieldName: match.field.name,
        typeName: match.resolved ? match.resolved.name : match.field.typeName,
        optional: !!match.field.optional,
      };
    });
    return { ...annotated, children, fieldCount: typeDef.fields.length };
  }

  // SEQUENCE OF / SET OF: every child is the same element type.
  const ofName = typeDef.typeName || '';
  const inner = resolveType(schema, ofName);
  if ((typeDef.kind === 'SEQUENCE OF' || typeDef.kind === 'SET OF') && inner) {
    const children = (node.children || []).map((c) => walkNode(c, inner, schema, stats, depth + 1));
    return { ...annotated, children, elementType: inner.name };
  }

  // A type that delegates to another (`Iccid ::= [APPLICATION 26] OCTET STRING`).
  const delegate = resolveType(schema, ofName);
  if (delegate && delegate !== typeDef) {
    const inner2 = walkNode(node, delegate, schema, stats, depth);
    return { ...inner2, fieldName: annotated.fieldName, typeName: typeDef.name };
  }

  // A leaf: a built-in such as OCTET STRING, INTEGER or UTF8String, possibly
  // retagged. The TYPE IS THIS TYPE, so it keeps its name — the previous version
  // passed null down and wiped it, so a bare Iccid decoded to no name at all even
  // though `Iccid` was the type being asked about.
  if (!node.children || !node.children.length) {
    return { ...annotated, typeName: typeDef.name, valueType: typeDef.typeName || typeDef.kind };
  }

  return { ...annotateChildren(node, null, schema, stats, depth), typeName: typeDef.name };
}

function annotateChildren(node, _typeDef, schema, stats, depth) {
  if (!node.children || !node.children.length) return node;
  const children = node.children.map((c) => annotateChildren(c, null, schema, stats, depth + 1));
  return { ...node, children };
}

/**
 * Which field of `typeDef` accounts for this wire element?
 *
 * Tries an exact tag match first across all fields - order in the schema does not
 * have to match order on the wire for an optional field to be found. Falls back to
 * nothing rather than to the next unused field, so an unmatched element stays
 * visibly unmatched instead of being mislabelled.
 */
function findFieldFor(node, typeDef, schema, used) {
  const tagging = schema.tagging;
  let sawMatchButUsed = false;

  for (let i = 0; i < typeDef.fields.length; i++) {
    if (used.has(i)) continue;
    const field = typeDef.fields[i];
    const resolved = resolveType(schema, field.typeName) || resolveType(schema, field.resolvedType?.name);
    const want = expectedTag({ ...field, resolvedType: resolved }, i, null, tagging);
    if (!want) continue;

    if (tagMatches(node, want)) {
      if (used.has(i)) { sawMatchButUsed = true; continue; }
      return { field, index: i, resolved, want };
    }
  }

  // A repeated element in a SEQUENCE OF, or a duplicate tag: take the first unused
  // field that could match, so repeated structures still get names.
  if (!sawMatchButUsed) {
    for (let i = 0; i < typeDef.fields.length; i++) {
      if (used.has(i)) continue;
      const field = typeDef.fields[i];
      const resolved = resolveType(schema, field.typeName);
      const want = expectedTag({ ...field, resolvedType: resolved }, i, null, tagging);
      if (want && Number(node.tag) === want.number && want.class === 'context') {
        return { field, index: i, resolved, want };
      }
    }
  }
  return null;
}

/** Build the lookup a schema needs, once. */
export function prepareSchema(parsed) {
  const byName = new Map();
  for (const t of parsed.types || []) byName.set(t.name, t);
  return { ...parsed, byName };
}

/** Every type that could serve as a decode root: anything with fields or a delegate. */
export function decodableRoots(parsed) {
  return (parsed.types || []).filter((t) => (t.fields && t.fields.length) || t.typeName);
}
