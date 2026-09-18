//! ASN.1 toolkit for the browser: compile, introspect, decode.
//!
//! Scope note, because it shapes the whole design:
//!
//! `rasn`'s codecs are generic over `T: Encode`, where `T` is a Rust type known
//! at compile time. There is no dynamic value type — `rasn::types::Any` is an
//! opaque byte wrapper with no structure. A browser therefore *cannot* take an
//! arbitrary schema and encode an arbitrary value from it, because that would
//! require compiling Rust at runtime.
//!
//! So the division of labour is:
//!
//!   - **Here (Rust/WASM):** parsing, validation, code generation, schema
//!     introspection, and DER *decoding* — decoding is possible without a
//!     generated type because we read the TLV structure directly and report it
//!     as data rather than as a typed Rust value.
//!   - **In JavaScript (`web/encode.js`):** encoding, driven by the parsed
//!     schema. A TLV writer is straightforward and needs no type system.
//!
//! This is stated here rather than discovered later because the instinct is to
//! look for a "encode from schema" function, and its absence is deliberate.

use rasn_compiler::prelude::*;
use serde::Serialize;
use wasm_bindgen::prelude::*;

mod hexdump;

pub use hexdump::{TlvNode, decode_tlv};

// ---------------------------------------------------------------------------
// Code generation (existing behaviour)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct Outcome {
    ok: bool,
    output: String,
    warnings: Vec<String>,
    error: String,
    backend: String,
    lines: usize,
}

impl Outcome {
    fn to_js(self) -> JsValue {
        serde_wasm_bindgen::to_value(&self).unwrap_or(JsValue::NULL)
    }
}

/// Compile ASN.1 source to bindings. `backend` is "rust" or "typescript".
#[wasm_bindgen]
pub fn compile(asn1: &str, backend: &str) -> JsValue {
    console_error_panic_hook::set_once();

    if asn1.trim().is_empty() {
        return Outcome {
            ok: false,
            output: String::new(),
            warnings: vec![],
            error: "No ASN.1 source provided.".into(),
            backend: backend.into(),
            lines: 0,
        }
        .to_js();
    }

    match backend {
        "typescript" => finish(
            Compiler::<TypescriptBackend, _>::new_with_config(TsConfig::default())
                .add_asn_literal(asn1)
                .compile_to_string(),
            "typescript",
        ),
        _ => finish(
            Compiler::<RasnBackend, _>::new_with_config(RasnConfig::default())
                .add_asn_literal(asn1)
                .compile_to_string(),
            "rust",
        ),
    }
}

fn finish(result: Result<CompileResult, CompilerError>, backend: &str) -> JsValue {
    match result {
        Ok(res) => {
            let lines = res.generated.lines().count();
            Outcome {
                ok: true,
                output: res.generated,
                warnings: res.warnings.iter().map(|w| w.to_string()).collect(),
                error: String::new(),
                backend: backend.into(),
                lines,
            }
            .to_js()
        }
        Err(e) => Outcome {
            ok: false,
            output: String::new(),
            warnings: vec![],
            error: e.to_string(),
            backend: backend.into(),
            lines: 0,
        }
        .to_js(),
    }
}

/// Schema structure is extracted in JavaScript, not here — see web/structure.js
/// for the full reasoning. In short: rasn-compiler 0.16 has no public path from
/// ASN.1 text to parsed types. `Compiler.state` is private with no accessor, the
/// `lexer` module (holding the parser entry point) is private, and `compile()`
/// consumes `self` and returns only generated text. The intermediate types are
/// public as types, but nothing hands you an instance.
///
/// `validate` therefore uses `compile()` as the front end: if code generation
/// succeeds, the module parsed. That is a weaker check than parsing alone (a
/// module can parse and still fail generation) and is labelled as such in the UI.

/// WASM export: decode hex bytes into a TLV tree.
#[wasm_bindgen]
pub fn hex_to_tree(hex: &str) -> JsValue {
    console_error_panic_hook::set_once();
    hexdump::decode_to_tree(hex)
}

/// A valid DER sample for the hex inspector: SGP.22 `OperatorId` with mccMnc
/// 246/81, the worked example from SGP.22 §5.7.2.
#[wasm_bindgen]
pub fn example_hex() -> String {
    // SEQUENCE { OCTET STRING (3) 92 F9 18 }  -- mccMnc, 2-digit MNC
    "30 05 04 03 92 f9 18".to_string()
}

/// A second sample: the same structure with a 3-digit MNC, to show that the
/// ASN.1 layer cannot tell the two apart — the third digit lives inside the
/// OCTET STRING and only TS 24.008 explains the packing.
#[wasm_bindgen]
pub fn example_hex_3digit() -> String {
    // SEQUENCE { OCTET STRING (3) 92 29 18 }  -- mccMnc, 3-digit MNC
    "30 05 04 03 92 29 18".to_string()
}

/// A sample that is NOT ASN.1, to demonstrate the lookalike trap: real SGP.22
/// Profile Element bytes. A BER reader returns one opaque primitive and no
/// error, which is the whole hazard.
#[wasm_bindgen]
pub fn example_hex_lookalike() -> String {
    "83 0b 80 09 08 29 99 18 11 32 54 76 98".to_string()
}

/// A nested DER sample: SEQUENCE containing INTEGER, BOOLEAN and UTF8String, so
/// the tree view has something to expand.
///
/// Length byte is 0x0E (14 content bytes): INTEGER 4 + BOOLEAN 3 + UTF8String 7.
#[wasm_bindgen]
pub fn example_hex_nested() -> String {
    // SEQUENCE {
    //   id     INTEGER 0x1234,
    //   active BOOLEAN true,
    //   label  UTF8String "euicc"
    // }
    "30 0e 02 02 12 34 01 01 ff 0c 05 65 75 69 63 63".to_string()
}

/// The version of the underlying compiler, for display in the UI.
#[wasm_bindgen]
pub fn compiler_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Validate only: reports whether the module parses and can be generated.
///
/// Uses the compiler front end rather than a dedicated parse, because the parsed
/// module is not reachable through the public API. A success here means "parsed
/// and generated", which is slightly stronger than "parsed" — noted in the UI so
/// the distinction is not overstated.
#[wasm_bindgen]
pub fn validate(asn1: &str) -> JsValue {
    #[derive(Serialize)]
    struct Check {
        ok: bool,
        error: String,
        warnings: usize,
    }

    if asn1.trim().is_empty() {
        return serde_wasm_bindgen::to_value(&Check {
            ok: false,
            error: "No ASN.1 source provided.".into(),
            warnings: 0,
        })
        .unwrap_or(JsValue::NULL);
    }

    match Compiler::<RasnBackend, _>::new_with_config(RasnConfig::default())
        .add_asn_literal(asn1)
        .compile_to_string()
    {
        Ok(r) => serde_wasm_bindgen::to_value(&Check {
            ok: true,
            error: String::new(),
            warnings: r.warnings.len(),
        }),
        Err(e) => serde_wasm_bindgen::to_value(&Check {
            ok: false,
            error: e.to_string(),
            warnings: 0,
        }),
    }
    .unwrap_or(JsValue::NULL)
}

/// Compiled-in example: a valid subset of SGP.22's RSPDefinitions.
///
/// Hand-authored rather than extracted from the PDF — the extracted text does
/// not compile (wrapped prose inside comments, OIDs broken across lines).
#[wasm_bindgen]
pub fn example_schema() -> String {
    include_str!("../examples/sgp22.asn").to_string()
}

/// Example schemas, labelled with their provenance.
///
/// Returns a JSON array of `{ id, label, spec, version, note, schema }`. The
/// schemas are hand-authored subsets, NOT extracts — GSMA specifications are
/// not redistributable, so the extracted corpus under `tests/specs/` stays
/// test-only and never reaches the deployed page.
///
/// Built here rather than in JS so the schema text ships inside the wasm: the
/// page must remain a single origin with no network fetch after load.
#[wasm_bindgen]
pub fn example_catalogue() -> String {
    fn entry(
        id: &str,
        spec: &str,
        version: &str,
        note: &str,
        schema: &str,
    ) -> String {
        format!(
            r#"{{"id":{},"spec":{},"version":{},"note":{},"schema":{}}}"#,
            json_str(id),
            json_str(spec),
            json_str(version),
            json_str(note),
            json_str(schema),
        )
    }
    let items = [
        entry(
            "sgp32-v12",
            "SGP.32",
            "v1.2",
            "IoT eUICC (IPA / eIM). Identifiers, operator metadata and eIM configuration.",
            include_str!("../examples/sgp32.asn"),
        ),
        entry(
            "sgp22-v31",
            "SGP.22",
            "v3.1",
            "Consumer RSP. Annex H subset: profile metadata and the RSPDefinitions core.",
            include_str!("../examples/sgp22.asn"),
        ),
        entry(
            "sgp02-v42",
            "SGP.02",
            "v4.2",
            "M2M / OTA. SM-SR addressing, profile state and the OTA command envelope.",
            include_str!("../examples/sgp02.asn"),
        ),
    ];
    format!("[{}]", items.join(","))
}

/// Minimal JSON string escaping. The inputs are compile-time constants, so this
/// only has to handle the characters those files actually contain (newlines,
/// quotes, backslashes, tabs).
fn json_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// A minimal schema, for a quick first look.
#[wasm_bindgen]
pub fn example_minimal() -> String {
    r#"Simple DEFINITIONS AUTOMATIC TAGS ::=
BEGIN

Record ::= SEQUENCE {
   id      INTEGER (0..65535),
   active  BOOLEAN,
   label   UTF8String (SIZE(1..32)) OPTIONAL,
   tags    SEQUENCE OF UTF8String
}

END
"#
    .to_string()
}
