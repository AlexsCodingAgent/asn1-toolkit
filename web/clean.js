// PDF artefact detection and cleaning for pasted ASN.1.
//
// WHY THIS EXISTS
//
// The most likely first action is pasting ASN.1 copied out of a GSMA PDF. That
// text is not source code, and the compiler rejects it with a parser error naming
// a line the user did not knowingly write:
//
//     Error matching ASN syntax at while parsing line 10, column 2.
//
// Nothing in that message suggests the fault is PDF furniture, so the reasonable
// conclusion is that the tool is broken. It is not: the tool simply never
// mentioned that the paste contained four classes of artefact it already knows
// how to remove.
//
// The rules are ported from scripts/extract_spec_asn1.py, which was written
// against real spec text and is the reference for what these artefacts look like.
// They are duplicated rather than shared because that script runs in Python over
// files and this runs in a browser over a paste; the detector is small and the
// behaviour is pinned by tests on both sides.
//
// The design rule throughout: FLAG ONLY WHAT IS CERTAIN. A missed artefact costs
// one more manual edit; a wrong deletion silently corrupts the user's schema, and
// they will not notice because the result still looks like ASN.1.

/** `#SupportedForDcV3.0.0#` — version markers. 510 occur in SGP.22 v3.1 alone. */
const VERSION_MARKER = /#[A-Za-z][A-Za-z0-9._-]*#/g;

/**
 * Page furniture. Appears mid-construct as well as between definitions, so it is
 * matched anywhere on a line rather than only at the start.
 */
const PAGE_FURNITURE = new RegExp(
  'V\\d+(?:\\.\\d+)*\\s+Page\\s+\\d+\\s+of\\s+\\d+\\s*' +
  '(?:GSM\\s+Association\\s+)?(?:Non-confidential\\s+)?(?:Official\\s+Document\\s+)?' +
  '(?:SGP\\.\\d+\\s*-\\s*[^,}]*)',
  'gi',
);

/** A lone document reference, e.g. `SGP.22 v3.1` on its own line. */
const LONE_SPEC_REF = /^\s*SGP\.\d+(?:-\d+)?\s+v?\d+(?:\.\d+)*\s*$/i;

/** Standalone words that appear as a line of their own in extraction. */
const STRAY_WORD = /^\s*(?:Page|Specification|Change|Profile|Association|Document|Non-confidential|Official)\s*$/i;

/** ASN.1 keywords used to recognise a genuine single-line definition. */
const ASN1_START = /^[A-Za-z][A-Za-z0-9-]*\s*(?:::=|[A-Za-z0-9-]*\s*::=)/;

/**
 * Is this a real SEQUENCE/SET component rather than prose?
 *
 * A component is a lowercase identifier followed by a type, where the type may
 * be two words (`OCTET STRING`), and may carry a constraint, `OPTIONAL`,
 * `DEFAULT`, or a trailing comma. Shared by the spill detector and the
 * artefact analyser so the two cannot disagree about what a member is.
 */
export function looksLikeMemberLine(t) {
  const s = String(t ?? '').trim();
  if (!s) return false;
  if (/^[a-z][A-Za-z0-9-]*\s+[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Z][A-Za-z0-9-]*)?\s*(?:\(|\[|\{|,|$)/.test(s)) return true;
  if (/^[a-z][A-Za-z0-9-]*\s*\[/.test(s)) return true;      // `field [0] SEQUENCE {`
  if (/^[a-z][A-Za-z0-9-]*\s+[A-Z]/.test(s)) return true;   // `field SOME-Type`
  return false;
}

/**
 * Does this line look like the wrapped continuation of a `--` comment?
 *
 * Spec comments break across lines with no second `--` and no marker on the
 * continuation. Real shape, from SGP.22 v3.1 lines 2365-2371:
 *
 *     OperatorId ::= SEQUENCE {
 *        mccMnc OCTET STRING (SIZE(3)), -- MCC&MNC coded as 3GPP TS 24.008
 *        gid1 OCTET STRING OPTIONAL, -- referring to content of EF GID1 (file identifier
 *     '6F3E') in 3GPP TS 31.102 [54]
 *        gid2 OCTET STRING OPTIONAL -- referring to content of EF GID2 (file identifier
 *     '6F3F') in 3GPP TS 31.102 [54]
 *     }
 *
 * The spill line sits INSIDE a SEQUENCE body, so this cannot be restricted to
 * top level. What distinguishes spill from a real member is shape, not depth: a
 * member is `<name> <Type>`, prose is neither.
 */
export function looksLikeCommentSpill(line, _insideBraces) {
  const t = line.trim();
  if (!t) return false;
  if (ASN1_START.test(t)) return false;
  if (/\{|\}/.test(t)) return false;
  if (t.startsWith('--')) return false;      // already a comment; harmless
  if (/::=/.test(t)) return false;

  // A real component, per the shared helper.
  if (looksLikeMemberLine(t)) return false;

  // A real type reference or definition tail.
  if (/^[A-Za-z][A-Za-z0-9-]*\s*$/.test(t)) return false;

  // Prose tells: opens with a quoted token, a bracket, a digit, or lowercase.
  const opensLikeProse = /^['"‘’“”(\[]/.test(t) || /^[a-z]/.test(t) || /^\d/.test(t);
  return opensLikeProse;
}

/**
 * Strip comments from a line, ASN.1 style (`--` to end of line).
 *
 * Quote-aware: a `--` inside a quoted string is content, not a comment.
 */
export function stripComment(line) {
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      // A doubled quote inside a string is an escaped quote.
      if (inStr && line[i + 1] === '"') { i++; continue; }
      inStr = !inStr;
      continue;
    }
    if (!inStr && c === '-' && line[i + 1] === '-') return line.slice(0, i);
  }
  return line;
}

/**
 * Analyse a paste and report every artefact found.
 *
 * Returns a per-line list so the UI can mark affected lines before the user
 * commits to cleaning, and a total count for the button label.
 */
export function analyseArtefacts(text) {
  const lines = String(text ?? '').split('\n');
  const findings = [];
  let depth = 0;
  let prevHadComment = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const beforeDepth = depth;
    depth += countBraces(raw);           // depth at line start

    const reasons = [];

    // Runs on the raw line: these artefacts sit outside comments as often as
    // inside them, and a furniture string inside a comment is still junk.
    const furn = raw.match(PAGE_FURNITURE);
    if (furn) reasons.push('page furniture');
    PAGE_FURNITURE.lastIndex = 0;

    const vm = raw.match(VERSION_MARKER);
    if (vm) reasons.push('version marker');
    VERSION_MARKER.lastIndex = 0;

    const body = stripComment(raw).trim();

    if (!body) {
      // A line that is only a comment. Not an artefact, but note the comment so
      // the next line can be tested for spill.
      if (raw.includes('--')) prevHadComment = !isClosedComment(raw);
      continue;
    }

    if (LONE_SPEC_REF.test(body)) reasons.push('spec reference');
    if (STRAY_WORD.test(body)) reasons.push('stray word');

    // Spill: a bare prose line continuing the previous line's comment. Tested
    // against `body` rather than the raw line, and NOT restricted to top level —
    // the real case sits inside a SEQUENCE body (SGP.22 v3.1 line 2368).
    //
    // The `raw` check matters: a line that carries its own comment AND real ASN.1
    // before it (`gid1 OCTET STRING OPTIONAL, -- ...`) is a member, not a
    // continuation, however much its tail reads like prose.
    const rawHadOwnContent = looksLikeMemberLine(body);
    if (
      !reasons.length &&
      prevHadComment &&
      !rawHadOwnContent &&
      looksLikeCommentSpill(body, beforeDepth > 0)
    ) {
      reasons.push('comment continuation');
    }

    prevHadComment = raw.includes('--') && !isClosedComment(raw);

    if (reasons.length) {
      findings.push({
        line: i + 1,
        reasons,
        text: raw,
        // A spill line is prose tail with no ASN.1 on it, so the whole line goes.
        removable: reasons.includes('comment continuation') || isRemovableLine(raw, body),
      });
    }
  }

  return {
    findings,
    removableCount: findings.filter((f) => f.removable).length,
    total: findings.length,
    lines: lines.length,
  };
}

/**
 * Can the whole line go, or does it merely contain an artefact inside real
 * content? Furniture mid-line has to be spliced out; a line that is only
 * furniture disappears entirely. Getting this wrong either leaves junk behind or
 * deletes a definition.
 */
function isRemovableLine(raw, bodyWithoutComment) {
  const furnitureRemoved = raw.replace(PAGE_FURNITURE, '').replace(VERSION_MARKER, '');
  PAGE_FURNITURE.lastIndex = 0;
  VERSION_MARKER.lastIndex = 0;
  const remainder = stripComment(furnitureRemoved).trim();
  if (remainder === '') return true;
  // The line had real content: only splice, never drop.
  return false;
}

function isClosedComment(line) {
  // `-- comment` with no further `--` on the same line leaves the comment open
  // in the spec's own layout, which is what produces spill on the next line.
  const idx = line.indexOf('--');
  if (idx === -1) return true;
  return line.indexOf('--', idx + 2) !== -1;
}

function countBraces(line) {
  let n = 0;
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '-' && line[i + 1] === '-') break;   // rest of line is a comment
    if (c === '{') n++;
    else if (c === '}') n--;
  }
  return n;
}

/**
 * Produce cleaned ASN.1.
 *
 * Removes lines that are entirely artefact, and splices artefacts out of lines
 * that also carry content. Does not touch comments: the compiler accepts them,
 * and deleting a user's comments would be a surprising edit to make silently.
 */
export function cleanArtefacts(text) {
  const lines = String(text ?? '').split('\n');
  const kept = [];
  const removed = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const hadFurniture = PAGE_FURNITURE.test(raw);
    PAGE_FURNITURE.lastIndex = 0;
    const hadMarker = VERSION_MARKER.test(raw);
    VERSION_MARKER.lastIndex = 0;

    let out = raw.replace(PAGE_FURNITURE, '').replace(VERSION_MARKER, '');
    PAGE_FURNITURE.lastIndex = 0;
    VERSION_MARKER.lastIndex = 0;

    // Tidy spacing the removal may have introduced, without reformatting.
    out = out.replace(/\s+$/, '');

    const bodyWithoutComment = stripComment(out).trim();

    if (bodyWithoutComment === '' && (hadFurniture || hadMarker)) {
      removed.push({ line: i + 1, text: raw, kind: 'line' });
      continue;
    }
    if (out !== raw) removed.push({ line: i + 1, text: raw, kind: 'partial', result: out });

    kept.push(out);
  }

  // A line that is the wrapped tail of a comment becomes a bare comment so the
  // compiler sees it as comment text rather than as code.
  const collapsed = [];
  let prevOpen = false;
  let prevWasCode = false;

  for (const line of kept) {
    const t = stripComment(line).trim();

    if (t === '' && prevOpen) { collapsed.push('--'); prevOpen = false; prevWasCode = false; continue; }

    // Spill: a bare prose line continuing the previous line's comment. Dropping
    // it is correct — it is the tail of a comment the spec wrapped, and the
    // compiler cannot tell it apart from a malformed member.
    if (
      prevOpen &&
      t !== '' &&
      !t.startsWith('--') &&
      looksLikeCommentSpill(t, false)
    ) {
      removed.push({ line: kept.indexOf(line) + 1, text: line, kind: 'spill' });
      // Keep the comment open: the continuation may itself wrap again.
      prevOpen = true;
      prevWasCode = false;
      continue;
    }

    collapsed.push(line);
    prevOpen = line.includes('--') && !isClosedComment(line);
    prevWasCode = t !== '';
  }

  return { text: collapsed.join('\n'), removed };
}

/**
 * Would cleaning turn a failing paste into a compiling one?
 *
 * This is the question the UI actually needs answered: do not offer to clean
 * unless cleaning is the reason the compile failed.
 */
export function cleanWouldHelp(text, compileFn) {
  const before = compileFn(text);
  if (before.ok) return { helpful: false, reason: 'already compiles' };

  const { text: cleaned, removed } = cleanArtefacts(text);
  if (!removed.length) return { helpful: false, reason: 'no artefacts found' };
  if (cleaned === text) return { helpful: false, reason: 'nothing changed' };

  const after = compileFn(cleaned);
  return { helpful: after.ok, cleaned, removed, after };
}
