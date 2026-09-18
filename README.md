# ASN.1 Toolkit — WebAssembly build

Browser tools for the ASN.1 in the GSMA eSIM specifications. Built for
[euicc.tech](https://euicc.tech), served at **https://asn1.euicc.tech**.

**Nothing is uploaded.** There is no backend, no API, no network call after page
load. That is a deliberate constraint rather than an optimisation: GSMA
specifications are not redistributable, and schemas derived from them inherit that.

## The four tools

| Tab | What it does |
|---|---|
| **1 Compiler** | ASN.1 → Rust (`rasn`) or TypeScript bindings |
| **2 Structure** | What is *in* a schema — types, fields, tags, optionality, constraints |
| **3 Encoder** | Values → DER / BER / CER / PER bytes, driven by the schema |
| **4 Byte inspector** | Raw hex → BER/DER TLV tree, with lookalike detection |

Every tab loads its input from the same **Examples picker**: three schemas
labelled with their specification and version (SGP.32 v1.2, SGP.22 v3.1, SGP.02
v4.2), each shown with a provenance line. They are **hand-written teaching
subsets**, not extracts — see the note above about redistribution.

## Layout

```
crate/                  Rust crate — wasm-bindgen over rasn-compiler
  src/lib.rs              the wasm exports
  src/hexdump.rs          byte decoder + lookalike detection
  examples/               the built-in example schemas (hand-authored subsets)
    sgp32.asn               SGP.32 v1.2 — IoT eUICC (IPA / eIM)
    sgp22.asn               SGP.22 v3.1 — consumer RSP, Annex H subset
    sgp02.asn               SGP.02 v4.2 — M2M / OTA
web/                    static site — the only thing deployed
  index.html              the four tabs
  app.js                  wiring, copy/download, cross-tab flow
  examples.js             the Examples picker + provenance line
  style.css               navy theme matching euicc.tech
  highlight.js            ASN.1 + hex syntax highlighting
  structure.js            schema structure extraction
  encode.js               DER/BER/CER/PER writers
  format.js               Rust pretty-printer
  format-ts.js            TypeScript pretty-printer
  test-*.mjs, enctest.mjs the test suites
  pkg/                    wasm-pack output (committed, so deploys need no Rust)
scripts/
  extract_spec_asn1.py    pull readable ASN.1 out of a spec PDF's text
tests/specs/              ASN.1 extracted from five GSMA specs
```

## Build

```bash
cargo install wasm-pack            # once
cd crate && wasm-pack build --target web --release --out-dir ../web/pkg
```

## Run

```bash
cd web && python3 -m http.server 8791
# http://127.0.0.1:8791/
```

A static server is required — `file://` will not work, because WASM needs a real
origin to fetch and instantiate the module.

## Test

```bash
cd web
node test-format.mjs      # 18 — Rust formatter
node test-highlight.mjs   # 20 — highlighter (includes a round-trip invariant)
node enctest.mjs          # 26 — encoders, verified against known DER
node test-specs.mjs       # parses ASN.1 from five real GSMA specs
```

Current state: **64 assertions passing**, and **582 types / 1938 fields** parsed
across SGP.02 v4.2, SGP.22 v2.7, SGP.22 v3.1, SGP.32 v1.2 and SGP.32 v1.3.

## Design notes, and the traps to avoid

### The edits are hard, not the compilation

Extracting ASN.1 from a spec PDF is where the effort goes. `scripts/extract_spec_asn1.py`
handles four classes of artefact, each of which silently corrupts output:

1. **Wrapped comments.** A `--` comment continues on the next line with no second
   `--`. Left in, the prose is parsed as code.
2. **Comment spill inside bodies.** In SGP.22's `OperatorId` the spill line begins
   with a quoted file identifier (`'6F3E') in 3GPP TS 31.102 [54]`) and carries an
   unbalanced paren, which made the whole definition fail validation and vanish —
   including the type SGP.22's own worked example uses.
3. **Page furniture mid-construct.** PDF page headers land *between* `INTEGER{`
   and the first enumeration item, so SGP.02's `ResultCode` came out as
   `INTEGER{ , errorProfileRef (8),` with every enumeration lost.
4. **Version markers.** `#SupportedForDcV3.0.0#` appears 510 times in SGP.22 v3.1
   and gets read as a field name.

The extractor is deliberately conservative: it keeps only what it can read with
certainty. A dropping line means less coverage, never a silently wrong module.

### The TLV-lookalike trap

The byte inspector carries the most important warning in the toolkit. Not every
tag-length-value format is ASN.1, and a conforming reader can return a
*structurally valid result holding the wrong bytes*:

```
Profile Element, SGP.22 (NOT ASN.1):
    83 0b 80 09 08 29 99 18 11 32 54 76 98

naive reading:  CONTEXT 3 (prim) len=11        <- one opaque blob, no error
actual:         el(0x83,11) -> el(0x80,9) -> 08 29 99 18 ...
```

`0x83` has the BER constructed bit clear, so a conforming reader *must* call it
primitive. In Profile Elements that byte is an element index that does contain
children. The first version of the detector checked `byte & 0x1F == 0x1F` — the
multi-byte-tag tell — which never fires on `0x83` and so missed the case it
existed for. The working check is structural: a **primitive** context/application
element whose content parses cleanly as TLV. Verified to fire on the lookalike and
stay silent on two real DER samples.

### Why the structure view is in JavaScript

rasn-compiler 0.16 has no public path from ASN.1 text to parsed types:
`Compiler.state` is private with no accessor, the `lexer` module is private, and
`compile()` consumes `self` and returns only the generated string. The
intermediate types are public *as types*, but nothing hands you an instance. So
structure is extracted from source text by `web/structure.js`, a non-general
ASN.1 reader — it does not evaluate parameterised types or information object
classes, and says so rather than guessing.

### Why encoding is in JavaScript

`rasn`'s codecs are generic over `T: Encode`, a Rust type known at compile time,
and `rasn::types::Any` is an opaque byte wrapper with no structure. A browser
therefore cannot take an arbitrary schema plus value and encode them. Writing TLV
by hand works for any schema and keeps every rule inspectable.

**Constraints are enforced, not just displayed.** A value violating `SIZE(10)` or
`(0..255)` is rejected. An earlier bug stripped the closing paren from `SIZE(10)`
while normalising, which silently disabled the check and let wrong-length values
encode without complaint — the worst possible failure for a schema tool.

### Formatting

Upstream, the Rust backend pipes through `rustfmt` and the TypeScript backend has
no formatter at all. A browser can spawn neither. Both are formatted locally, and
the results are verified by compiling rather than by reading: the Rust output
passes `rustfmt` and `cargo check` against `rasn` 0.28, and the TypeScript output
passes `tsc --noEmit`. A formatter bug produces code that looks right, so the
tests alone are not sufficient evidence.

### Asset caching

`app.js` stamps the stylesheet, the wasm binary and the module URLs with a
`BUILD` constant. This is not cosmetic: during development a rebuilt `.wasm` was
correct on disk and correctly served, yet the browser reused a cached copy and
ran old compiled logic — which presents as a code bug and is not one.

## What this toolkit does not do

- **Decode `mccMnc`.** SGP.22 declares it `OCTET STRING (SIZE(3))` "coded as
  3GPP TS 24.008". The ASN.1 says nothing about the internal layout, so a schema
  compiler hands you a 3-byte blob. The digit packing is in TS 24.008 §10.5.1.3.
- **Handle Profile Elements** as ASN.1. They are not; see the trap above.
- **Ingest a spec PDF directly.** Clean ASN.1 only — the extractor is a separate,
  explicit step.
- **Full PER.** Aligned PER covers constrained types only. Unconstrained integers
  and ranges wider than 65535 are refused, not guessed.

## Which GSMA specs are ASN.1

| Spec | ASN.1? |
|---|---|
| SGP.02 | yes |
| SGP.22 | yes — `RSPDefinitions`, 98 blocks |
| SGP.32 | yes |
| ETSI TS 102.223 (SIM Toolkit) | **no** — COMPREHENSION-TLV |
| 3GPP TS 31.111 (USIM Toolkit) | **no** — COMPREHENSION-TLV |

A SIM Toolkit decoder is a different tool.
