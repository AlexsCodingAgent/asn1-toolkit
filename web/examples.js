// Examples picker — provenance for the built-in schemas.
//
// WHY THIS EXISTS
//   The built-in example used to be one hardcoded button reading "SGP.22
//   example", with nothing saying which specification or version it came from.
//   A schema with no provenance is a schema you cannot cite, and for someone
//   learning eSIM the spec name and version are the whole point — the
//   differences between SGP.22 v2.7 and v3.1, or between SGP.22 and SGP.32,
//   are exactly what trips people up.
//
// WHAT THESE ARE, AND ARE NOT
//   Every schema here is HAND-AUTHORED: a small, deliberate subset written for
//   teaching, in the same spirit as the original sgp22.asn. They are NOT
//   extracts from the specifications.
//
//   That distinction is load-bearing. GSMA specifications are not
//   redistributable, and machine-extracted schemas inherit that. The corpus
//   under tests/specs/ (582 types pulled from five PDFs) is therefore test-only
//   and is never served: the deploy uploads web/ as the site, and tests/ is
//   outside it. Do not move those files into web/.
//
//   The catalogue is built inside the wasm (see lib.rs::example_catalogue) so
//   the schema text ships in the binary the page already loads. No fetch, no
//   new origin, no network call after page load.

let catalogueCache = null;
let catalogueKey = null;

/// Parse the wasm-provided catalogue. Returns [] rather than throwing: a broken
/// catalogue should cost the picker, not the whole page.
///
/// Keyed on the input, not merely "have we cached something" — the first draft
/// cached unconditionally and returned the FIRST catalogue for every later call,
/// which is the kind of bug that only shows up when something passes a different
/// catalogue in.
export function loadCatalogue(raw) {
  if (catalogueKey === raw && catalogueCache) return catalogueCache;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  catalogueCache = Array.isArray(parsed) ? parsed : [];
  catalogueKey = raw;
  return catalogueCache;
}

/// The catalogue entry for an id, or null.
export function findExample(id) {
  if (!catalogueCache) return null;
  return catalogueCache.find((e) => e.id === id) || null;
}

/// Human label, e.g. "SGP.32 v1.2".
export function exampleLabel(entry) {
  if (!entry) return '';
  return `${entry.spec} ${entry.version}`;
}

/// Build the <select> options for the picker.
export function renderOptions(select, catalogue, selectedId) {
  select.innerHTML = '';
  for (const e of catalogue) {
    const opt = document.createElement('option');
    opt.value = e.id;
    opt.textContent = exampleLabel(e);
    opt.title = e.note || '';
    if (e.id === selectedId) opt.selected = true;
    select.appendChild(opt);
  }
}

/// The provenance line shown under the picker: what this is, and what it is not.
export function provenanceText(entry) {
  if (!entry) return '';
  const parts = [
    `${exampleLabel(entry)} — ${entry.note}`,
    'Hand-written teaching subset, not an extract from the specification.',
  ];
  return parts.join(' ');
}

/// Index a catalogue by id, for lookups that should not rescan.
export function indexById(catalogue) {
  const map = new Map();
  for (const e of catalogue) map.set(e.id, e);
  return map;
}
