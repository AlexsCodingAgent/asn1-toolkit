# ASN.1 Compiler — WebAssembly build

A browser tool that compiles ASN.1 schemas from the GSMA eSIM specifications to
Rust (`rasn`) or TypeScript bindings. Built for [euicc.tech](https://euicc.tech).

**Nothing is uploaded.** There is no backend, no API, no network call after page
load. The compiler runs in WebAssembly on the user's own machine. That is a
deliberate constraint, not an optimisation: GSMA specifications are not
redistributable, and schemas derived from them inherit that.

## Layout

```
crate/          Rust crate — wasm-bindgen wrapper around rasn-compiler
  src/lib.rs      the compile() export, plus the built-in SGP.22 example
web/            static site — the only thing that gets deployed
  index.html      the tool
  format.js       Rust pretty-printer (see "Formatting" below)
  test-format.mjs regression tests for the formatter
  pkg/            wasm-pack output (generated, committed for simple deploys)
```

## Build

```bash
cargo install wasm-pack            # once
cd crate && wasm-pack build --target web --release --out-dir ../web/pkg
```

## Run locally

```bash
cd web && python3 -m http.server 8791
# open http://127.0.0.1:8791/
```

A plain static server is enough. `file://` will not work — WASM needs a real
origin to fetch the module and instantiate it.

## Test

```bash
cd web && node test-format.mjs     # 12 assertions on the formatter
```

```bash
# verify the generated Rust actually compiles
cd crate && cargo run --bin dump /path/to/schema.asn   # prints Rust + TypeScript
```

## Formatting, and why it is hand-rolled

Upstream, `rasn-compiler`'s Rust backend pipes its output through `rustfmt`. A
browser cannot spawn processes, so a WASM build gets raw generated code as a
single very long line. `web/format.js` formats it locally instead.

It is not `rustfmt`, and it is not trying to be. It targets the shapes this
generator emits. Two bugs found while building it, both now regression-tested:

- **`size("1..=16")` became `1.. = 16`.** The `=` spacing rule matched inside
  the range operator. Fixed by requiring the character before `=` not be one of
  `.<>!=`.
- **Consecutive attributes concatenated onto one line.** The tokeniser only
  matched `#[`, but the generator emits `# [`. Fixed, and attributes now always
  take their own line.

The output is verified by `rustfmt` and `cargo check` against `rasn` 0.28 — see
the commit that added the formatter for the check. If you change `format.js`,
re-run the compile check, not just the unit tests: a formatter bug produces code
that *looks* right.

## What this tool deliberately does not do

- **Does not decode `mccMnc`.** SGP.22 declares it `OCTET STRING (SIZE(3))`
  "coded as 3GPP TS 24.008". The ASN.1 says nothing about the internal layout, so
  a schema compiler hands you a 3-byte blob. The digit packing lives in TS 24.008
  §10.5.1.3 — see the sibling work on the `#IMSI_OP_PROF*` / `#MCC_MNC*`
  disagreement.
- **Does not handle Profile Elements.** Those are not ASN.1.
  `PE ::= E2 <index> <length> <payload>` is a bespoke format that borrows the
  look of tag-length-value. `0x83` has bit 6 (constructed) clear, so a conforming
  BER reader must treat it as primitive and refuse to descend — but in PE it is
  an element index that contains children. `openssl asn1parse` returns one opaque
  blob, with no error. If you expected a tree and got one primitive, you are
  looking at a lookalike.
- **Does not ingest a spec PDF.** Paste clean ASN.1. Text extracted from a PDF
  has comments broken across lines mid-sentence and OIDs split mid-identifier;
  no compiler will take it. Tried with 98 reassembled `ASN1START` blocks from
  SGP.22 v3.1 and it fails at four distinct kinds of extraction artifact.

## Which GSMA specs are actually ASN.1

| Spec | ASN.1? |
|---|---|
| SGP.22 (RSP) | yes — `RSPDefinitions`, 98 blocks |
| SGP.32 (IoT) | yes |
| ETSI TS 102.223 (SIM Toolkit) | **no** — COMPREHENSION-TLV |
| 3GPP TS 31.111 (USIM Toolkit) | **no** — COMPREHENSION-TLV |

The two Toolkit specs contain no ASN.1 at all. A SIM Toolkit decoder is a
different tool; this is the wrong one for that job.

## Deploy

The `web/` directory is fully static. Put it behind any static host.

Not yet decided: whether this ships as a page on the existing euicc.tech Jekyll
site (`esim-knowledge`) or as a standalone subdomain. The tool is self-contained
either way — no build step is shared with Jekyll, and `pkg/` is plain ES modules.
