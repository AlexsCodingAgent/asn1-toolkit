/* tslint:disable */
/* eslint-disable */

/**
 * A configuration for the [Rasn] backend
 */
export class Config {
    free(): void;
    [Symbol.dispose](): void;
    constructor(opaque_open_types: boolean, default_wildcard_imports: boolean, no_std_compliant_bindings: boolean, generate_from_impls?: boolean | null, custom_imports?: string[] | null, type_annotations?: string[] | null);
    /**
     * Stringified paths to items that will be imported into all generated modules with a
     * [use declaration](https://doc.rust-lang.org/reference/items/use-declarations.html).
     * For example `vec![String::from("my::module::*"), String::from("path::to::my::Struct")]`.
     */
    custom_imports: string[];
    /**
     * The compiler will try to match module import dependencies of the ASN.1
     * module as close as possible, importing only those types from other modules
     * that are imported in the ASN.1 module. If the `default_wildcard_imports`
     * is set to `true` , the compiler will import the entire module using
     * the wildcard `*` for each module that the input ASN.1 module imports from.
     */
    default_wildcard_imports: boolean;
    /**
     * To make working with the generated types a bit more ergonomic, the compiler
     * can generate `From` impls for the wrapper inner types in a `CHOICE`, as long
     * as the generated impls are not ambiguous.
     * This is disabled by default to generate less code, but can be enabled with
     * `generate_from_impls` set to `true`.
     */
    generate_from_impls: boolean;
    /**
     * Create bindings for a `no_std` environment
     */
    no_std_compliant_bindings: boolean;
    /**
     * ASN.1 Open Types are represented as the `rasn::types::Any` type,
     * which holds a binary `content`. If `opaque_open_types` is `false`,
     * the compiler will generate additional de-/encode methods for
     * all rust types that hold an open type.
     * For example, bindings for a `SEQUENCE` with a field of Open Type
     * value will include a method for explicitly decoding the Open Type field.
     * _Non-opaque open types are still experimental. If you have trouble_
     * _generating correct bindings, switch back to opaque open types._
     */
    opaque_open_types: boolean;
    /**
     * Annotations to be added to all generated rust types of the bindings. Each vector element
     * will generate a new line of annotations. Note that the compiler will automatically add all pound-derives
     * needed by `rasn` __except__ `Eq` and `Hash`, which are needed only when working with `SET`s.
     *
     * Default: `vec![String::from("#[derive(AsnType, Debug, Clone, Decode, Encode, PartialEq, Eq, Hash)]")]`
     */
    type_annotations: string[];
}

export class Generated {
    private constructor();
    /**
     ** Return copy of self without private attributes.
     */
    toJSON(): Object;
    /**
     * Return stringified version of self.
     */
    toString(): string;
    free(): void;
    [Symbol.dispose](): void;
    rust: string;
    warnings: string;
}

/**
 * Compile ASN.1 source to bindings. `backend` is "rust" or "typescript".
 */
export function compile(asn1: string, backend: string): any;

export function compile_to_rust(asn1: string, config: Config): Generated;

export function compile_to_typescript(asn1: string): Generated;

/**
 * The version of the underlying compiler, for display in the UI.
 */
export function compiler_version(): string;

/**
 * WASM export: decode hex to a tree, returning a JS object.
 */
export function decode_to_tree(hex: string): any;

/**
 * Example schemas, labelled with their provenance.
 *
 * Returns a JSON array of `{ id, label, spec, version, note, schema }`. The
 * schemas are hand-authored subsets, NOT extracts — GSMA specifications are
 * not redistributable, so the extracted corpus under `tests/specs/` stays
 * test-only and never reaches the deployed page.
 *
 * Built here rather than in JS so the schema text ships inside the wasm: the
 * page must remain a single origin with no network fetch after load.
 */
export function example_catalogue(): string;

/**
 * A valid DER sample for the hex inspector: SGP.22 `OperatorId` with mccMnc
 * 246/81, the worked example from SGP.22 §5.7.2.
 */
export function example_hex(): string;

/**
 * A second sample: the same structure with a 3-digit MNC, to show that the
 * ASN.1 layer cannot tell the two apart — the third digit lives inside the
 * OCTET STRING and only TS 24.008 explains the packing.
 */
export function example_hex_3digit(): string;

/**
 * A sample that is NOT ASN.1, to demonstrate the lookalike trap: real SGP.22
 * Profile Element bytes. A BER reader returns one opaque primitive and no
 * error, which is the whole hazard.
 */
export function example_hex_lookalike(): string;

/**
 * A nested DER sample: SEQUENCE containing INTEGER, BOOLEAN and UTF8String, so
 * the tree view has something to expand.
 *
 * Length byte is 0x0E (14 content bytes): INTEGER 4 + BOOLEAN 3 + UTF8String 7.
 */
export function example_hex_nested(): string;

/**
 * A minimal schema, for a quick first look.
 */
export function example_minimal(): string;

/**
 * Compiled-in example: a valid subset of SGP.22's RSPDefinitions.
 *
 * Hand-authored rather than extracted from the PDF — the extracted text does
 * not compile (wrapped prose inside comments, OIDs broken across lines).
 */
export function example_schema(): string;

/**
 * Schema structure is extracted in JavaScript, not here — see web/structure.js
 * for the full reasoning. In short: rasn-compiler 0.16 has no public path from
 * ASN.1 text to parsed types. `Compiler.state` is private with no accessor, the
 * `lexer` module (holding the parser entry point) is private, and `compile()`
 * consumes `self` and returns only generated text. The intermediate types are
 * public as types, but nothing hands you an instance.
 *
 * `validate` therefore uses `compile()` as the front end: if code generation
 * succeeds, the module parsed. That is a weaker check than parsing alone (a
 * module can parse and still fail generation) and is labelled as such in the UI.
 * WASM export: decode hex bytes into a TLV tree.
 */
export function hex_to_tree(hex: string): any;

/**
 * Validate only: reports whether the module parses and can be generated.
 *
 * Uses the compiler front end rather than a dedicated parse, because the parsed
 * module is not reachable through the public API. A success here means "parsed
 * and generated", which is slightly stronger than "parsed" — noted in the UI so
 * the distinction is not overstated.
 */
export function validate(asn1: string): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_config_free: (a: number, b: number) => void;
    readonly __wbg_generated_free: (a: number, b: number) => void;
    readonly __wbg_get_config_custom_imports: (a: number) => [number, number];
    readonly __wbg_get_config_default_wildcard_imports: (a: number) => number;
    readonly __wbg_get_config_generate_from_impls: (a: number) => number;
    readonly __wbg_get_config_no_std_compliant_bindings: (a: number) => number;
    readonly __wbg_get_config_opaque_open_types: (a: number) => number;
    readonly __wbg_get_config_type_annotations: (a: number) => [number, number];
    readonly __wbg_get_generated_rust: (a: number) => [number, number];
    readonly __wbg_get_generated_warnings: (a: number) => [number, number];
    readonly __wbg_set_config_custom_imports: (a: number, b: number, c: number) => void;
    readonly __wbg_set_config_default_wildcard_imports: (a: number, b: number) => void;
    readonly __wbg_set_config_generate_from_impls: (a: number, b: number) => void;
    readonly __wbg_set_config_no_std_compliant_bindings: (a: number, b: number) => void;
    readonly __wbg_set_config_opaque_open_types: (a: number, b: number) => void;
    readonly __wbg_set_config_type_annotations: (a: number, b: number, c: number) => void;
    readonly __wbg_set_generated_rust: (a: number, b: number, c: number) => void;
    readonly __wbg_set_generated_warnings: (a: number, b: number, c: number) => void;
    readonly compile: (a: number, b: number, c: number, d: number) => any;
    readonly compile_to_rust: (a: number, b: number, c: number) => [number, number, number];
    readonly compile_to_typescript: (a: number, b: number) => [number, number, number];
    readonly compiler_version: () => [number, number];
    readonly config_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
    readonly decode_to_tree: (a: number, b: number) => any;
    readonly example_catalogue: () => [number, number];
    readonly example_hex: () => [number, number];
    readonly example_hex_3digit: () => [number, number];
    readonly example_hex_lookalike: () => [number, number];
    readonly example_hex_nested: () => [number, number];
    readonly example_minimal: () => [number, number];
    readonly example_schema: () => [number, number];
    readonly hex_to_tree: (a: number, b: number) => any;
    readonly validate: (a: number, b: number) => any;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
