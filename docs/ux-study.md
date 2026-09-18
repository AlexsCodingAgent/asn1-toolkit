# UX study — ASN.1 Toolkit

Measured against the live build at https://asn1.euicc.tech, plus DOM inspection
rather than screenshot reading. Findings are ordered by how much they cost a real
user.

**Status: F1–F7 are built and deployed (build 0.8.0).** See "What changed" at the
end for what each fix does and how it is tested. Nothing in this study is still
open.

---

## What the tool gets right (do not regress these)

- **The honesty layer.** Every failure mode has a specific message, and the
  "what it does not do" sections name real traps: `mccMnc` not decoded, Profile
  Elements not ASN.1, PER partial. Most tools of this kind silently guess.
- **The lookalike warning.** Fires on the PE signature and stays silent on real
  DER — verified both ways. Auto-opens the explainer when it triggers.
- **Performance.** 40 types compile in 115 ms; a 7 KB TLV tree decodes in 10 ms.
  Nothing needs optimising.
- **Payload.** 1.46 MB total, 1.34 MB of it the wasm. Acceptable for a tool page
  and unavoidable given the compiler is inlined.
- **Layout at desktop widths.** Panes align, editor metrics match the highlight
  overlay exactly, no caret drift.

---

## F1 — A realistic paste fails with a message that blames the user
**Severity: high. This is the defining UX problem.**

Paste ASN.1 straight out of a SGP.22 PDF — the single most likely first action —
and the compiler says:

```
Compilation failed.
Error matching ASN syntax at while parsing line 10, column 2.
```

Line 10 is a page header the user did not knowingly write. The message names a
line number, implies their ASN.1 is malformed, and gives no hint that the fault
is PDF furniture. **The user's reasonable conclusion is that the tool is broken
or that they cannot write ASN.1.**

The tool already contains the fix. `scripts/extract_spec_asn1.py` cleans exactly
these artefacts, and `web/structure.js` parses the same messy input without
complaint — on that identical paste the Structure tab cheerfully reports
"2 types, 7 fields". So:

| Tab | Same messy input |
|---|---|
| Structure | works — finds `OperatorId`, `StoreMetadataRequest` |
| Compiler | fails at line 10 |

The inconsistency is the point. The tool can see the junk; it just does not
mention it where it matters.

**Direction:** port the artefact detection to JS, run it on paste, and when the
compiler fails, check whether cleaning would have succeeded. If it would, say so
and offer a one-click **"Clean up PDF artefacts (3 lines)"** action. That converts
a dead end into the tool's best teaching moment — and it teaches the real lesson,
which is that spec PDFs are not source code.

---

## F2 — Trailing bytes after a complete element are a warning, not an error
**Severity: medium. Correctness signal.**

```
30 03 02 01 05 ff ff ff
-> "Decoded with caveats — Stopped at offset 5: truncated multi-byte"
```

Three unaccounted bytes should be a hard error. Leftover data means the input is
not what the user believes it is, and that is precisely the class of mistake this
tool exists to catch.

**Counter-check, so this is not over-called:** `30 03 02 01 05 02 01 09` is
correctly read as two sibling top-level elements (8/8 bytes). Consuming all bytes
as siblings is right; leaving bytes over is not.

---

## F3 — The schema-sharing model is invisible
**Severity: medium.** Tabs 1–3 share one schema, and tab 3 only works if tab 1 is
populated. Nothing in the UI says this. The Encoder's hint explains *when* to use
it, not *where its schema comes from*; the Structure tab's hint says "uses the
same input as tab 1" in prose, which is the only place it appears.

A user who lands, clicks "3 Encoder", sees an empty type list and reads
"No type selected — put a schema in tab 1 first" — that message is the sole
discovery path, and it appears only after they have already tried.

**Direction:** a persistent "schema: RSPDefinitions · 11 types" strip in the
header, clickable to jump to tab 1. Cheap, and it makes the model obvious
without a tutorial.

---

## F4 — Errors are reported only in a status bar
**Severity: medium-low.**

"line 10, column 2" is shown as prose in a panel below the editor, disconnected
from the text it describes. In a 400-line paste the user has to count lines.

**Direction:** underline or gutter-mark the offending line in the editor. The
highlight overlay already exists and is the natural place — the line is known.

---

## F5 — Accessibility gaps
**Severity: medium-low, but real.**

| Issue | Detail |
|---|---|
| Status bars are not announced | Four `.status` elements, no `role="status"` or `aria-live`. A screen-reader user gets silence on compile success *and* on failure. |
| Tab keyboard pattern incomplete | Arrow keys work, but `tabindex` is unmanaged — the ARIA tabs pattern wants the inactive tabs at `tabindex="-1"`. |
| Radio groups unlabelled as groups | Three `.seg` groups (Output language / Filter / Encoding rules) carry `title` only. Not `role="radiogroup"` or `aria-label`. The individual radios *are* correctly named via wrapping labels. |
| `Wrap: on` is a state-less toggle | Reads as a label, not a button state; no `aria-pressed`. |

**Correction to my own first pass:** an early check suggested 8 unnamed inputs. It
was wrong — the radios are wrapped in `<label>` elements, so they have implicit
accessible names. Verified and withdrawn.

---

## F6 — "Wrap: on" is ambiguous and misplaced
**Severity: low.**

It toggles *output* wrapping, sits in the same row as compile actions, and its
label states the current state without making clear it is a control. Minor, but
it is the control most likely to be clicked by accident.

---

## F7 — No visible provenance for the example schemas
**Severity: low, but it is the feature that would drive repeat visits.**
**Status: BUILT (build 0.8.0).**

The built-in example was a real, carefully-documented SGP.22 subset, but nothing
linked it to a source, and the five-spec corpus under `tests/specs/` was
invisible in the UI.

**Built:** the single hardcoded "SGP.22 example" button in tabs 1 and 2 is now an
**Examples picker** offering three schemas, each labelled with its specification
and version:

| Example | What it covers |
|---|---|
| **SGP.32 v1.2** | IoT eUICC (IPA / eIM) — identifiers, operator metadata, eIM configuration |
| **SGP.22 v3.1** | Consumer RSP — the Annex H subset that was previously the only example |
| **SGP.02 v4.2** | M2M / OTA — SM-SR addressing, profile state, OTA command envelope |

A **provenance line** under the toolbar names the loaded example and states, every
time, that it is a hand-written teaching subset and **not an extract from the
specification**. It clears the moment the text is edited, because a provenance
line claiming SGP.02 over text the reader has rewritten is a wrong answer at full
confidence.

### The decision that shaped it: the corpus stays out

The obvious implementation was to serve all five `tests/specs/` files. That was
rejected, and the reason is recorded at the top of the README: GSMA
specifications are not redistributable, and schemas derived from them inherit
that. The corpus is machine-extracted type and field names pulled straight from
five GSMA PDFs; publishing it from a site we control would be a licensing
regression, not a feature.

So the examples are **hand-authored** — small, deliberate subsets in the same
spirit as the original `sgp22.asn`. The corpus remains test-only: `tests/` sits
outside the deployed artifact (`upload-pages-artifact` takes `path: web`), and
`test-examples.mjs` now **fails the build if a `tests/specs` path ever appears in
code that ships.**

The catalogue is built inside the wasm (`lib.rs::example_catalogue`) rather than
fetched, so the page keeps its single-origin, no-network-after-load property.

### A real error this surfaced

The first draft of `sgp32.asn` declared `Eid ::= [APPLICATION 26] OCTET STRING
(SIZE(16))` alongside `Iccid ::= [APPLICATION 26] OCTET STRING (SIZE(10))`. Both
carried the same tag, so the decoder could name **neither** — it correctly
refused, and `test-annotate.mjs` caught it.

Checking the extracted corpus showed the example was wrong, not the decoder:
SGP.22 encodes the EID inline as `eidValue [APPLICATION 26] Octet16` inside
`GetEuiccDataResponse`; it is not a top-level tagged type. The fix was to stop
inventing a tag the specs do not use. All three examples now have exactly one
APPLICATION 26 type, `Iccid`.

This is the failure mode the codebase already treats as the worst one, arriving
from the direction nobody expects: not a wrong label, but a schema that made the
right answer underivable.

---

## Deliberately not recommended

- **Dark/light theme toggle.** The palette is matched to euicc.tech. A toggle
  adds state to persist, a flash-of-wrong-theme risk, and a second stylesheet to
  keep coherent. Not worth it for a tool embedded in a dark-themed site.
- **URL-encoded sharing of schemas.** The tool's whole claim is that nothing
  leaves the browser; a shareable URL reintroduces exactly the leak it avoids.
  If sharing is wanted, make it a downloaded file.
- **Syntax highlighting in the output panes.** Rust and TypeScript highlighting
  would be genuinely nice, but the highlighter exists for ASN.1 and hex where the
  round-trip invariant is cheap to guarantee. Two more tokenisers is real
  surface area for decoration.
- **Rewriting the structure parser to be a general ASN.1 parser.** It is honest
  about its limits (no parameterised types, no information object classes) and
  those limits do not bind the common case.

---

## What changed (build 0.4.0)

### F1 — the artefact offer

`web/clean.js` ports the artefact rules from `scripts/extract_spec_asn1.py`. On a
failed compile the tool recompiles the cleaned text and offers the edit **only if
that succeeds** — so the suggestion is never a guess, it is demonstrably the
cause. The affected lines are listed before anything is deleted, and there is a
way to decline.

Verified on verbatim SGP.22 v3.1 source: fails at line 3, two lines removed,
compiles 27 lines of Rust, all four members intact.

The safety property that matters is not any single detection case but this: every
real spec file under `tests/specs/` must keep its type count and field count
through cleaning. A false positive deletes a definition and the user will not
notice, because what remains still looks like ASN.1.

### F2 — leftover bytes are an error

`30 03 02 01 05 ff ff ff` previously reported "decoded with caveats" and still
showed a tree, inviting trust in a tree that does not describe the data. Bytes
consumed entirely as sibling elements is still correct — `30 03 02 01 05 02 01 09`
is two siblings and is tested to stay that way.

### F3 — the shared-schema strip

A clickable `schema · RSPDefinitions · 11 types` indicator in the header. Tabs 1–3
share one schema and previously nothing said so; the fact was discoverable only by
hitting "No type selected — put a schema in tab 1" after already trying.

### F4 — the error line is marked

The line the parser names is banded in the editor, using the highlight overlay
already rendered under the textarea. Positioned from the reported line number and
verified to land there. Cleared on success, on Clear, and on typing, because a
stale mark on edited text points at the wrong line and is worse than none.

### F5 — accessibility

Status regions are `role="status" aria-live="polite"`, so a screen-reader user
hears compile results instead of silence. Tabs follow the ARIA pattern with
managed `tabindex`. The three segmented controls are labelled `radiogroup`s.

### F6 — Wrap toggle

Renamed `Wrap output: on` and given `aria-pressed`.

## Bugs found while building the fixes

**Clear did not remove the error band**, leaving a red mark over empty text.
Caught by an assertion, not by inspection.

**F2 appeared not to work at all.** The wasm on disk was correct and correctly
served, but the browser reused a cached binary and ran the old logic — the second
time caching has presented as a code bug. The `BUILD` stamp is load-bearing.

**The test helper was wrong.** It counted braces from the first `{` after a
function name, so a destructuring parameter (`{ focus = false } = {}`) ended the
scan early and the assertion inspected the wrong region — reporting a false
failure for correct code.

## Test coverage

Six suites, 114 assertions, all run in CI alongside the five-spec parse:

| Suite | Assertions |
|---|---|
| `test-format.mjs` | 18 |
| `test-highlight.mjs` | 20 |
| `test-clear.mjs` | 12 |
| `test-clean.mjs` | 21 |
| `test-ux.mjs` | 17 |
| `enctest.mjs` | 26 |

## Still open

Nothing. F7 (provenance for the example schemas) was the last item, and it is
built — see its entry above. The corpus under `tests/specs/` remains test-only by
design, which is a constraint rather than an open task.

---

## Build 0.7.0 — the inspector now reads the schema

The gap that mattered most was not in the study's original list, and it was the
largest one: **the inspector and the schema never spoke to each other.**

Pasting real eUICC hex produced a correct, useless tree:

```
APPLICATION 26 (prim) len=10
  [89 01 26 77 36 65 43 21 09 87]
```

The schema in tab 1 says exactly what that is. It now says so:

```
Iccid APPLICATION 26 (prim) len=10
  [89 01 26 77 36 65 43 21 09 87]

OperatorId UNIVERSAL 16 (cons) len=8 @0
  mccMnc: OCTET STRING CONTEXT 0 (prim) len=3 @2  [92 f9 18]
  gid1:   OCTET STRING CONTEXT 1 (prim) len=1 @7  [01]
```

Four tabs that each did their own job, but the one question the tool exists to
answer — *what are these bytes off my eUICC?* — needed all of them at once.

### The design decision that shaped it

A wrong field name is indistinguishable from a right one. So the matcher refuses
rather than guesses:

- `[0]` 3 bytes + `[1]` 1 byte is **equally consistent** with `OperatorId` and
  `AuthenticateServerRequest`; both cover all 8 octets. The tool says nothing and
  offers a type picker instead.
- Elements no field accounts for stay unnamed.
- Every line keeps its raw tag, so the claim can be checked rather than trusted.
- An unlabelled tree is the safe default; a confidently mislabelled one is the trap.

Getting the scoring right took three attempts — counting named fields tied, weighting
named against unnamed tied too. Byte coverage is what separates a tight fit from a
loose one.

### Corrections made along the way

**`tagging === 'AUTOMATIC'` was always false** — the parser reports the literal
`"AUTOMATIC TAGS"`. The whole automatic-tag path was silently dead, so every field
matched against a universal tag and nothing on the wire matched.

**A leaf had no name to give.** `annotate` counted only FIELDS, so `Iccid
::= [APPLICATION 26] OCTET STRING` — which has none — scored zero and was discarded
even though its tag identified it exactly.

**The status bar kept the previous match.** A decode that matched nothing left the
old type named while showing a different tree: a wrong answer at full confidence.
Now cleared before every decode.

**Not a bug:** the summary and its explanation appear run-together in `textContent`
but are separate blocks visually. Checked, not "fixed".
