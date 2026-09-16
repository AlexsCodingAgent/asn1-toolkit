//! Hex input → TLV tree.
//!
//! This is the answer to the question the compiler cannot answer: "I have these
//! bytes, what are they?" A schema compiler tells you what shape data *should*
//! have; this tells you what a given blob *actually* is.
//!
//! It is a BER/DER structural walk, deliberately not schema-driven. That means
//! it works on data from any specification without needing the schema, and it
//! is also why it reports tags and lengths rather than field names — naming
//! requires the schema and is a separate step.
//!
//! **The lookalike caveat matters here.** This walks real ASN.1 TLV rules. If a
//! format merely *looks* like TLV (SGP.22 Profile Elements, ETSI COMPREHENSION-
//! TLV) the tree produced will be structurally valid and semantically wrong.
//! `possibly_not_asn1` flags the cases where that is worth suspecting, rather
//! than silently returning a confident wrong answer.

use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct TlvNode {
    /// Byte offset of the first tag byte.
    pub offset: usize,
    /// Total bytes this node occupies, including header and children.
    pub length: usize,
    /// Tag class as a word, for display.
    pub class: String,
    /// "primitive" or "constructed".
    pub constructed: bool,
    /// Tag number.
    pub tag: u64,
    /// Number of header bytes (tag + length).
    pub header_len: usize,
    /// Content length from the length field.
    pub content_len: usize,
    /// Hex of the content when primitive; empty when constructed.
    pub value_hex: String,
    /// A best-effort human reading of the value.
    pub value_text: String,
    /// Children, when constructed.
    pub children: Vec<TlvNode>,
    /// Warnings specific to this node.
    pub notes: Vec<String>,
}

#[derive(Serialize)]
pub struct DecodeResult {
    ok: bool,
    error: String,
    /// Top-level nodes. A well-formed blob usually has exactly one.
    pub nodes: Vec<TlvNode>,
    /// Bytes consumed.
    pub consumed: usize,
    /// Total input length.
    pub total: usize,
    /// True when trailing bytes were left over.
    pub trailing: bool,
    /// Overall advisories.
    pub notes: Vec<String>,
}

/// Decode a hex string into a TLV tree.
pub fn decode_tlv(hex: &str) -> DecodeResult {
    let bytes = match parse_hex(hex) {
        Ok(b) => b,
        Err(e) => {
            return DecodeResult {
                ok: false,
                error: e,
                nodes: vec![],
                consumed: 0,
                total: 0,
                trailing: false,
                notes: vec![],
            };
        }
    };

    if bytes.is_empty() {
        return DecodeResult {
            ok: false,
            error: "No bytes provided.".into(),
            nodes: vec![],
            consumed: 0,
            total: 0,
            trailing: false,
            notes: vec![],
        };
    }

    let total = bytes.len();
    let mut notes = Vec::new();
    let mut pos = 0usize;

    // Sanity advisory: the Profile-Element / TLV-lookalike signature.
    //
    // The first version of this checked `bytes[0] & 0x1F == 0x1F` (multi-byte
    // tag). That is the wrong tell: SGP.22 PE bytes begin 0x83, whose low five
    // bits are 3, so the check never fired on the very case it existed for.
    //
    // The real signature is structural, and best detected after parsing: a
    // *primitive* context- or application-class element whose own content parses
    // cleanly as TLV. ASN.1 forbids that reading; bespoke formats like the PE
    // produce exactly it.

    let mut nodes = Vec::new();
    while pos < total {
        match read_node(&bytes, pos, 0) {
            Ok((node, next)) => {
                // Guard against a zero-advance loop.
                if next <= pos {
                    notes.push(format!(
                        "Decoder stopped at offset {pos}: no progress (malformed length)."
                    ));
                    break;
                }
                pos = next;
                nodes.push(node);
            }
            Err(e) => {
                notes.push(format!("Stopped at offset {pos}: {e}"));
                break;
            }
        }
    }

    let consumed = pos;
    let trailing = consumed < total;

    if trailing {
        notes.push(format!(
            "{} trailing byte(s) after the last complete element. Either the input \
             contains more than one top-level value, or it is truncated.",
            total - consumed
        ));
    }

    // Depth advisory: deep nesting on a short blob usually means a misread.
    if let Some(n) = nodes.first() {
        if depth_of(n) > 8 && total < 64 {
            notes.push(
                "Nesting is deep for the blob size — a sign the length fields may \
                 have been read from the wrong scheme."
                    .into(),
            );
        }
    }

    // The lookalike check. A primitive element of context or application class
    // whose content parses as well-formed TLV is the Profile-Element signature:
    // ASN.1 says "primitive, do not descend", but the bytes plainly contain
    // structure. Flagging it is the difference between a useful tool and one
    // that returns a confident wrong answer.
    for (node, content) in nodes.iter().zip(content_ranges(&bytes, &pos, nodes.len())) {
        if !node.constructed
            && (node.class == "CONTEXT" || node.class == "APPLICATION")
            && node.content_len >= 3
        {
            if let Some(inner) = parses_as_tlv(&content) {
                notes.push(format!(
                    "Element {} at offset {} is PRIMITIVE, but its {} content byte(s) \
                     parse as {} nested TLV element(s) starting with {} {}. ASN.1 \
                     requires a primitive value to be opaque, so this tool is showing \
                     you one blob. If the data came from a format that only *looks* \
                     like TLV — an SGP.22 Profile Element, or an ETSI \
                     COMPREHENSION-TLV object — the real reading is the nested one and \
                     this tree is structurally valid but semantically wrong.",
                    node.tag, node.offset, node.content_len, inner.0, inner.1, inner.2,
                ));
            }
        }
    }

    DecodeResult {
        ok: !nodes.is_empty(),
        error: String::new(),
        nodes,
        consumed,
        total,
        trailing,
        notes,
    }
}

fn depth_of(n: &TlvNode) -> usize {
    1 + n.children.iter().map(depth_of).max().unwrap_or(0)
}

/// Content bytes for each top-level node, in order.
fn content_ranges(bytes: &[u8], _end: &usize, count: usize) -> Vec<Vec<u8>> {
    let mut out = Vec::with_capacity(count);
    let mut pos = 0usize;
    while pos < bytes.len() && out.len() < count {
        match read_node(bytes, pos, 0) {
            Ok((node, next)) => {
                if next <= pos {
                    break;
                }
                let content_start = pos + node.header_len;
                out.push(bytes[content_start..content_start + node.content_len].to_vec());
                pos = next;
            }
            Err(_) => break,
        }
    }
    out
}

/// Try to read `content` as a sequence of TLV elements.
///
/// Returns (count, class, tag) of the first element when the whole buffer parses
/// as at least one element with no trailing bytes. Used to detect a primitive
/// that is secretly structured — the TLV-lookalike signature.
fn parses_as_tlv(content: &[u8]) -> Option<(usize, &'static str, u64)> {
    if content.len() < 2 {
        return None;
    }
    let mut pos = 0usize;
    let mut count = 0usize;
    let mut first: Option<(&'static str, u64)> = None;

    while pos < content.len() {
        match read_node(content, pos, 0) {
            Ok((node, next)) if next > pos => {
                if first.is_none() {
                    let cls = match node.class.as_str() {
                        "CONTEXT" => "context",
                        "APPLICATION" => "application",
                        "PRIVATE" => "private",
                        _ => "universal",
                    };
                    first = Some((cls, node.tag));
                }
                count += 1;
                pos = next;
            }
            // A partial parse is not evidence of structure.
            _ => return None,
        }
        // Guard against pathological expansion.
        if count > 64 {
            return None;
        }
    }

    // Require every byte accounted for: a lookalike parses exactly.
    if pos == content.len() && count > 0 {
        first.map(|(c, t)| (count, c, t))
    } else {
        None
    }
}

/// Read one TLV element starting at `pos`. Returns the node and the offset just
/// past it.
fn read_node(bytes: &[u8], pos: usize, depth: usize) -> Result<(TlvNode, usize), String> {
    if depth > 32 {
        return Err("nesting too deep — refusing to recurse further".into());
    }
    if pos >= bytes.len() {
        return Err("unexpected end of input".into());
    }

    let start = pos;
    let first = bytes[pos];

    // --- tag ---
    let class = match first >> 6 {
        0b00 => "UNIVERSAL",
        0b01 => "APPLICATION",
        0b10 => "CONTEXT",
        _ => "PRIVATE",
    }
    .to_string();
    let constructed = first & 0x20 != 0;
    let mut tag = (first & 0x1F) as u64;
    let mut cursor = pos + 1;
    let mut multi_byte_tag = false;

    if tag == 0x1F {
        // High tag number: base-128, continuation bit in bit 8.
        tag = 0;
        multi_byte_tag = true;
        loop {
            if cursor >= bytes.len() {
                return Err("truncated multi-byte tag".into());
            }
            let b = bytes[cursor];
            tag = (tag << 7) | (b & 0x7F) as u64;
            cursor += 1;
            if b & 0x80 == 0 {
                break;
            }
            // Absurdly long tags are a sign of reading the wrong scheme.
            if cursor - pos > 6 {
                return Err("tag number spans more than 5 bytes — likely not ASN.1".into());
            }
        }
    }

    // --- length ---
    if cursor >= bytes.len() {
        return Err("truncated: no length byte".into());
    }
    let lb = bytes[cursor];
    cursor += 1;

    let content_len: usize;
    if lb & 0x80 == 0 {
        content_len = lb as usize;
    } else {
        let n = (lb & 0x7F) as usize;
        if n == 0 {
            // 0x80 = indefinite length (BER only).
            return Err(
                "indefinite length (0x80) — valid BER but not DER; unsupported here".into(),
            );
        }
        if n > 8 {
            return Err(format!("length field of {n} bytes is implausible"));
        }
        if cursor + n > bytes.len() {
            return Err("truncated long-form length".into());
        }
        let mut l: u64 = 0;
        for i in 0..n {
            l = (l << 8) | bytes[cursor + i] as u64;
        }
        cursor += n;
        content_len = l as usize;
    }

    let header_len = cursor - start;

    if cursor + content_len > bytes.len() {
        return Err(format!(
            "length {content_len} overruns the input (only {} byte(s) left)",
            bytes.len() - cursor
        ));
    }

    let content = &bytes[cursor..cursor + content_len];

    let mut notes = Vec::new();
    if multi_byte_tag {
        notes.push(
            "Multi-byte tag (low 5 bits of the first byte were 31). Confirm the \
             data really is ASN.1."
                .into(),
        );
    }

    // --- children or value ---
    let mut children = Vec::new();
    if constructed {
        let mut p = 0usize;
        while p < content.len() {
            match read_node(content, p, depth + 1) {
                Ok((child, next)) if next > p => {
                    // Child offsets are absolute within the whole input.
                    let mut c = child;
                    c.offset += cursor;
                    children.push(c);
                    p = next;
                }
                Ok(_) => {
                    notes.push(format!(
                        "{} unparsed byte(s) inside this constructed element",
                        content.len() - p
                    ));
                    break;
                }
                Err(e) => {
                    notes.push(format!(
                        "{} byte(s) inside could not be parsed as TLV ({e})",
                        content.len() - p
                    ));
                    break;
                }
            }
        }
    }

    let value_hex = if constructed {
        String::new()
    } else {
        content
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<Vec<_>>()
            .join(" ")
    };

    let value_text = if constructed {
        String::new()
    } else {
        interpret(class.as_str(), tag, content)
    };

    Ok((
        TlvNode {
            offset: start,
            length: header_len + content_len,
            class,
            constructed,
            tag,
            header_len,
            content_len,
            value_hex,
            value_text,
            children,
            notes,
        },
        cursor + content_len,
    ))
}

/// Best-effort reading of a primitive value. Universal tags get real
/// interpretation; context/application/private tags are left as hex because
/// their meaning depends on the schema.
fn interpret(class: &str, tag: u64, content: &[u8]) -> String {
    if class != "UNIVERSAL" {
        return String::new();
    }
    match tag {
        1 => {
            // BOOLEAN
            if content.len() == 1 {
                (content[0] != 0).to_string()
            } else {
                String::new()
            }
        }
        2 | 10 => {
            // INTEGER / ENUMERATED — signed, big-endian, two's complement.
            if content.is_empty() || content.len() > 8 {
                return String::new();
            }
            let mut v: i64 = if content[0] & 0x80 != 0 { -1 } else { 0 };
            for &b in content {
                v = (v << 8) | b as i64;
            }
            format!("{v} (0x{:x})", v & 0xffff_ffff)
        }
        3 => {
            // BIT STRING: first byte is the unused-bit count.
            if content.is_empty() {
                return String::new();
            }
            let unused = content[0];
            if unused > 7 {
                return String::new();
            }
            let bits = content.len().saturating_sub(1) * 8 - unused as usize;
            format!("{bits} bit(s), {unused} unused")
        }
        4 => {
            // OCTET STRING — show as hex, and as ASCII when it looks printable.
            format!("{} byte(s)", content.len())
        }
        5 => "NULL".to_string(),
        6 => {
            // OBJECT IDENTIFIER
            if content.is_empty() {
                return String::new();
            }
            let mut parts = vec![(content[0] / 40) as u64, (content[0] % 40) as u64];
            let mut val: u64 = 0;
            for &b in &content[1..] {
                val = (val << 7) | (b & 0x7F) as u64;
                if b & 0x80 == 0 {
                    parts.push(val);
                    val = 0;
                }
            }
            format!(
                "{}",
                parts
                    .iter()
                    .map(|p| p.to_string())
                    .collect::<Vec<_>>()
                    .join(".")
            )
        }
        12 | 19 | 20 | 22 | 26 | 27 | 28 | 30 => {
            // UTF8String, PrintableString, TeletexString, IA5String, VisibleString,
            // GeneralString, UniversalString, BMPString
            String::from_utf8_lossy(content).to_string()
        }
        23 | 24 => {
            // UTCTime / GeneralizedTime
            String::from_utf8_lossy(content).to_string()
        }
        16 => String::new(), // handled by constructed branch
        _ => String::new(),
    }
}

fn parse_hex(s: &str) -> Result<Vec<u8>, String> {
    let cleaned: String = s
        .chars()
        .filter(|c| !c.is_whitespace() && *c != ':' && *c != ',' && *c != '-')
        .collect();
    let cleaned = cleaned.strip_prefix("0x").unwrap_or(&cleaned).to_string();
    if cleaned.is_empty() {
        return Ok(vec![]);
    }
    if !cleaned.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Input contains non-hex characters.".into());
    }
    if cleaned.len() % 2 != 0 {
        return Err(format!(
            "Odd number of hex digits ({}). Each byte needs two.",
            cleaned.len()
        ));
    }
    (0..cleaned.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&cleaned[i..i + 2], 16)
                .map_err(|_| format!("bad hex at position {i}"))
        })
        .collect()
}

/// WASM export: decode hex to a tree, returning a JS object.
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn decode_to_tree(hex: &str) -> wasm_bindgen::JsValue {
    let r = decode_tlv(hex);
    serde_wasm_bindgen::to_value(&r).unwrap_or(wasm_bindgen::JsValue::NULL)
}
