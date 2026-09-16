//! ASN.1 → Rust / TypeScript compiler, compiled to WebAssembly.
//!
//! Runs entirely in the browser: no server, no upload, no network. The schema
//! never leaves the user's machine, which is the point — schemas from GSMA
//! specs are often not redistributable.
//!
//! Built for eUICC.tech.

use rasn_compiler::prelude::*;
use wasm_bindgen::prelude::*;

/// Result of a compile attempt, serialised to JS as a plain object.
#[derive(serde::Serialize)]
struct Outcome {
    ok: bool,
    /// Generated bindings, when `ok`.
    output: String,
    /// Warning diagnostics (compile succeeded, but something is worth saying).
    warnings: Vec<String>,
    /// Error diagnostic, when `!ok`.
    error: String,
    /// Which backend produced `output`: "rust" or "typescript".
    backend: String,
    /// Line count of the generated output, for a quick "did it do anything?" read.
    lines: usize,
}

impl Outcome {
    fn to_js(self) -> JsValue {
        serde_wasm_bindgen::to_value(&self).unwrap_or(JsValue::NULL)
    }
}

fn warnings_from(w: &[CompilerError]) -> Vec<String> {
    w.iter().map(|e| e.to_string()).collect()
}

/// Compile ASN.1 source to Rust bindings for the `rasn` framework.
///
/// `backend` is either "rust" or "typescript".
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
        "typescript" => {
            let result = Compiler::<TypescriptBackend, _>::new_with_config(TsConfig::default())
                .add_asn_literal(asn1)
                .compile_to_string();
            finish(result, "typescript")
        }
        _ => {
            let result = Compiler::<RasnBackend, _>::new_with_config(RasnConfig::default())
                .add_asn_literal(asn1)
                .compile_to_string();
            finish(result, "rust")
        }
    }
}

fn finish(result: Result<CompileResult, CompilerError>, backend: &str) -> JsValue {
    match result {
        Ok(res) => {
            let lines = res.generated.lines().count();
            Outcome {
                ok: true,
                output: res.generated,
                warnings: warnings_from(&res.warnings),
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
            // The Display impl carries the "line N, column M" diagnostics.
            error: e.to_string(),
            backend: backend.into(),
            lines: 0,
        }
        .to_js(),
    }
}

/// The version of the underlying compiler, for display in the UI.
#[wasm_bindgen]
pub fn compiler_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Compiled-in example: a valid subset of SGP.22's RSPDefinitions.
///
/// Hand-authored rather than extracted from the PDF — the extracted text does
/// not compile (wrapped prose inside comments, OIDs broken across lines).
#[wasm_bindgen]
pub fn example_schema() -> String {
    const SGP22: &str = r#"RSPDefinitions DEFINITIONS AUTOMATIC TAGS EXTENSIBILITY IMPLIED ::=
BEGIN

-- A valid subset of SGP.22 v3.1 Annex H (Remote SIM Provisioning).
-- SGP.22 splits this module across 98 blocks in the PDF; this is the
-- part that matters for profile metadata.

Octet8  ::= OCTET STRING (SIZE(8))
Octet16 ::= OCTET STRING (SIZE(16))
OctetTo16 ::= OCTET STRING (SIZE(1..16))
Octet32 ::= OCTET STRING (SIZE(32))

VersionType ::= OCTET STRING (SIZE(3))

-- ICCID as coded in EFiccid; corresponding tag is '5A'
Iccid ::= [APPLICATION 26] OCTET STRING (SIZE(10))

TransactionId ::= OCTET STRING (SIZE(1..16))

-- SGP.22 5.7.2. mccMnc is an OCTET STRING of 3, coded as 3GPP TS 24.008.
-- The ASN.1 says nothing about the internal layout: that is the
-- 3GPP spec's business, which is why a schema compiler alone will
-- not decode it for you.
OperatorId ::= SEQUENCE {
   mccMnc OCTET STRING (SIZE(3)),
   gid1   OCTET STRING OPTIONAL,
   gid2   OCTET STRING OPTIONAL
}

-- Profile metadata: the ProfileOwner carries mccMnc, which must match
-- the MCC/MNC in EF-IMSI (SGP.22 5.7.2).
StoreMetadataRequest ::= SEQUENCE {
   iccid           Iccid,
   serviceProviderName UTF8String (SIZE(1..32)),
   iccids          SEQUENCE OF Iccid,
   profileOwner    OperatorId OPTIONAL,
   profileName     UTF8String (SIZE(1..64)) OPTIONAL
}

-- ES9+ authenticateServer, abbreviated
AuthenticateServerRequest ::= SEQUENCE {
   serverSigned1   OCTET STRING,
   serverSignature1 OCTET STRING,
   euiccCiPKIdToBeUsed SubjectKeyIdentifier,
   serverCertificate OCTET STRING,
   ctxParams1      OCTET STRING
}

SubjectKeyIdentifier ::= OCTET STRING
END
"#;
    SGP22.to_string()
}
