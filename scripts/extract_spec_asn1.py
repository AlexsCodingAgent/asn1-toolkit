#!/usr/bin/env python3
"""
Extract ASN.1 type definitions from a GSMA spec text file into a compilable module.

WHY THIS EXISTS

The raw spec text does not compile. Three classes of defect, all of them
artefacts of PDF→text extraction rather than problems with the ASN.1:

  1. Comments wrap. A `--` comment continues on the next line with no `--` of its
     own, so the continuation reads as code.
  2. Page furniture is injected mid-body. PDF page headers land *between*
     `INTEGER{` and the first enumeration item, so the header text is parsed as
     an enumeration value.
  3. Prose sits inside constructs. `gid1 OCTET STRING OPTIONAL, -- referring to
     content of EF GID1 (file identifier` is a valid field followed by a comment
     that spans lines.

Mending the *whole* module was attempted and abandoned — a line-based mender
cannot reliably tell spec prose from ASN.1, and it kept finding new cases (see
the sibling skill `asn1-tooling-and-tlv-lookalikes`). This takes the opposite
approach: keep only what can be read with certainty, and drop the rest. Fewer
types means less coverage, never a silently wrong module.

Usage:
    extract_spec_asn1.py <spec.txt> <out.asn> [module-name]
"""

import re
import sys

# PDF page furniture. Appears inline, so must be removed before parsing rather
# than from the assembled text — by then it has already skewed brace counts.
FURNITURE_LINE = re.compile(
    r'^\s*('
    r'V\d+(\.\d+)*\s+Page\s+\d+\s+of\s+\d+'
    r'|GSM\s+Association'
    r'|Official\s+Document'
    r'|Non-confidential'
    r'|Specification\s*$'
    r'|\d+\s+GSM\s+Association'
    r'|\f'
    r')',
    re.I,
)

FURNITURE_INLINE = re.compile(
    r'V\d+(\.\d+)*\s+Page\s+\d+\s+of\s+\d+\s*'
    r'(GSM\s+Association\s+)?(Non-confidential\s+)?(Official\s+Document\s+)?'
    r'(SGP\.\d+\s*-\s*[^,}]*)?',
    re.I,
)

# GSMA version-availability markers: #SupportedForDcV3.0.0#, #MandatoryFromV3.X.Y#.
# These are specification annotations, not ASN.1 — they appear 510 times in
# SGP.22 v3.1 alone, often immediately before a component name, so leaving them
# in makes the parser read `#SupportedForEcoV1.0.0#` as a field name.
VERSION_MARKER = re.compile(r'#[A-Za-z][A-Za-z0-9.]*#')

# Prose that survives on its own line inside a body. Includes page-header words
# that got separated from their line, and spec phrases.
STRAY_PROSE_WORD = re.compile(
    r'^\s*('
    r'Profile|Specification|Document|Association|Page|Non-confidential'
    r'|Tag|tag'
    r')\s*$'
)


def drop_furniture_lines(text: str) -> str:
    """Remove PDF page-header lines wherever they appear in the file."""
    return '\n'.join(l for l in text.splitlines() if not FURNITURE_LINE.match(l))


def strip_comments(text: str) -> str:
    """
    Remove `--` comments, including continuations.

    A comment runs to end-of-line. A *continuation* is a following line that is
    not itself a comment and not plausible ASN.1 — those are prose and are
    dropped. This is the key rule that makes single definitions readable:
    `VersionType ::= OCTET STRING(SIZE(3)) -- major/minor/revision ...` is fine,
    and the next line's "coded as" prose is not part of it.
    """
    out = []
    in_str = False
    i = 0
    n = len(text)

    while i < n:
        c = text[i]
        if c == '"':
            in_str = not in_str
            out.append(c)
            i += 1
            continue
        if not in_str and c == '-' and i + 1 < n and text[i + 1] == '-':
            # Skip to end of line.
            while i < n and text[i] != '\n':
                i += 1
            # Drop the newline too, so the definition stays on one line.
            continue
        out.append(c)
        i += 1

    return ''.join(out)


def looks_like_prose(line: str) -> bool:
    """True when a line reads as English rather than as ASN.1."""
    s = line.strip()
    if not s:
        return False
    # ASN.1 lines are mostly identifiers, punctuation and uppercase type names.
    if re.match(r'^[A-Z][A-Za-z0-9-]*\s*::=', s):
        return False
    if re.match(r'^[\[(]', s):
        return False
    # A long run of lowercase words with no ASN.1 punctuation is prose.
    words = re.findall(r'[A-Za-z]+', s)
    if len(words) >= 4:
        lower = sum(1 for w in words if w[0].islower())
        if lower >= 4 and not re.search(r'[{};,()=]', s):
            return True
    if re.search(r'\b(shall|defined in|referring to|see clause|as described)\b', s, re.I):
        return True
    return False


def balance_ok(s: str) -> bool:
    return s.count('{') == s.count('}') and s.count('(') == s.count(')')


def looks_like_comment_spill(line: str) -> bool:
    """
    True when a line is the wrapped continuation of a `--` comment.

    Spec comments break across lines with no second `--`, and the spill lands
    *inside* a SEQUENCE body. In SGP.22's OperatorId:

        gid1 OCTET STRING OPTIONAL, -- referring to content of EF GID1 (file identifier
        '6F3E') in 3GPP TS 31.102 [54]

    The second line is prose. Left in, it introduces an unbalanced `(`, which
    made the whole definition fail the balance check and disappear — which is
    how OperatorId, the type SGP.22's own worked example uses, went missing.

    The tell is the leading apostrophe: real components start with a lowercase
    identifier, and a line beginning with `'` is always the tail of a comment
    quoting a file identifier.
    """
    s = line.strip()
    if not s:
        return False
    # A quoted file identifier such as '6F3E' is only ever in a comment.
    if s.startswith("'"):
        return True
    # `in 3GPP TS 31.102 [54]` and friends: prose starting lowercase, no
    # identifier-colon-type shape, and not a continuation of a construct.
    if re.match(r'^[a-z]', s) and not re.match(
        r'^[a-z][A-Za-z0-9-]*\s*(\[|[A-Z])', s
    ):
        if not re.search(r'::=', s) and not re.match(r'^[a-z][A-Za-z0-9-]*\s*$', s):
            return True
    return False


def tidy(s: str) -> str:
    # Version markers may sit *between* tokens, so remove before whitespace
    # normalisation or `#SupportedForEcoV1.0.0# ecoList` keeps the marker glued
    # to the following identifier.
    s = VERSION_MARKER.sub(' ', s)
    s = FURNITURE_INLINE.sub(' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    s = re.sub(r'\{\s*,', '{', s)          # `INTEGER{ , x`  -> `INTEGER{ x`
    s = re.sub(r',\s*\}', ' }', s)          # trailing comma before }
    s = re.sub(r'\{\s+\}', '{}', s)
    s = re.sub(r'\s*,\s*', ', ', s)
    s = re.sub(r'\s*;\s*', '; ', s)
    return s.strip()


def extract_definitions(block: str) -> list[str]:
    """Pull readable type assignments out of one ASN1START block."""
    text = strip_comments(block)
    lines = [l for l in text.splitlines() if not FURNITURE_LINE.match(l)]

    # Drop prose continuation lines up front, but never a line inside braces —
    # inside a SEQUENCE body every line is structure, whatever it looks like.
    #
    # Exception: a comment that wrapped. The spill lands inside a body and must
    # go. Note `strip_comments` has already removed the `--` itself by this
    # point, so the spill cannot be identified by looking at the previous line —
    # it has to be recognised on its own shape.
    cleaned = []
    depth = 0
    for line in lines:
        if looks_like_comment_spill(line):
            continue
        # A line that is nothing but a stray prose or page-header word is
        # furniture that lost its line, not a component.
        if STRAY_PROSE_WORD.match(line):
            continue

        depth += line.count('{') - line.count('}')
        if depth <= 0 and looks_like_prose(line):
            depth -= line.count('{') - line.count('}')
            continue
        cleaned.append(line)
        if depth < 0:
            depth = 0
    lines = cleaned

    kept = []
    i = 0
    while i < len(lines):
        m = re.match(r'^\s*([A-Z][A-Za-z0-9-]*)\s*::=\s*(.*)$', lines[i])
        if not m:
            i += 1
            continue

        name, rhs = m.group(1), m.group(2).strip()
        # Skip value assignments (`foo INTEGER ::= 3`) — not type definitions.
        if re.search(r'\b(INTEGER|BOOLEAN)\s*::=', lines[i]):
            i += 1
            continue

        body = [rhs]
        depth = rhs.count('{') - rhs.count('}')
        j = i + 1
        # Gather to brace balance. Deliberately does not stop at lines that
        # resemble a definition: enumeration items like `success (0),` are not
        # definitions, and stopping there truncated every ENUMERATED.
        while j < len(lines) and depth > 0:
            body.append(lines[j].strip())
            depth += lines[j].count('{') - lines[j].count('}')
            j += 1

        joined = tidy(' '.join(x for x in body if x))
        if balance_ok(joined):
            kept.append(f"{name} ::= {joined}")
        i = j

    return kept


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2

    spec, out_path = sys.argv[1], sys.argv[2]
    module = sys.argv[3] if len(sys.argv) > 3 else 'Extracted'

    raw = open(spec, encoding='utf-8', errors='replace').read()
    text = drop_furniture_lines(raw)

    blocks = re.findall(r'-- ASN1START(.*?)-- ASN1STOP', text, re.S)
    if not blocks:
        print(f"no ASN1START blocks in {spec}")
        return 1

    defs: list[str] = []
    seen: set[str] = set()
    for b in blocks:
        for d in extract_definitions(b):
            name = d.split(' ::= ')[0]
            if name in seen:
                continue
            seen.add(name)
            defs.append(d)

    header = (
        f"{module} DEFINITIONS AUTOMATIC TAGS ::=\n"
        f"BEGIN\n\n"
        f"-- Extracted from {spec.split('/')[-1]} by scripts/extract_spec_asn1.py.\n"
        f"-- Only type assignments that could be read with certainty are kept.\n"
        f"-- Prose, IMPORTS and value assignments are omitted; the count below is\n"
        f"-- therefore a floor on this spec's ASN.1 surface, not a total.\n\n"
    )
    with open(out_path, 'w') as f:
        f.write(header + '\n\n'.join(defs) + '\n\nEND\n')

    print(f"{len(defs)} type(s) -> {out_path}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
