/* @ts-self-types="./asn1_toolkit.d.ts" */

/**
 * A configuration for the [Rasn] backend
 */
export class Config {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ConfigFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_config_free(ptr, 0);
    }
    /**
     * @param {boolean} opaque_open_types
     * @param {boolean} default_wildcard_imports
     * @param {boolean} no_std_compliant_bindings
     * @param {boolean | null} [generate_from_impls]
     * @param {string[] | null} [custom_imports]
     * @param {string[] | null} [type_annotations]
     */
    constructor(opaque_open_types, default_wildcard_imports, no_std_compliant_bindings, generate_from_impls, custom_imports, type_annotations) {
        var ptr0 = isLikeNone(custom_imports) ? 0 : passArrayJsValueToWasm0(custom_imports, wasm.__wbindgen_malloc);
        var len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(type_annotations) ? 0 : passArrayJsValueToWasm0(type_annotations, wasm.__wbindgen_malloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.config_new(opaque_open_types, default_wildcard_imports, no_std_compliant_bindings, isLikeNone(generate_from_impls) ? 0xFFFFFF : generate_from_impls ? 1 : 0, ptr0, len0, ptr1, len1);
        this.__wbg_ptr = ret;
        ConfigFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Stringified paths to items that will be imported into all generated modules with a
     * [use declaration](https://doc.rust-lang.org/reference/items/use-declarations.html).
     * For example `vec![String::from("my::module::*"), String::from("path::to::my::Struct")]`.
     * @returns {string[]}
     */
    get custom_imports() {
        const ret = wasm.__wbg_get_config_custom_imports(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * The compiler will try to match module import dependencies of the ASN.1
     * module as close as possible, importing only those types from other modules
     * that are imported in the ASN.1 module. If the `default_wildcard_imports`
     * is set to `true` , the compiler will import the entire module using
     * the wildcard `*` for each module that the input ASN.1 module imports from.
     * @returns {boolean}
     */
    get default_wildcard_imports() {
        const ret = wasm.__wbg_get_config_default_wildcard_imports(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * To make working with the generated types a bit more ergonomic, the compiler
     * can generate `From` impls for the wrapper inner types in a `CHOICE`, as long
     * as the generated impls are not ambiguous.
     * This is disabled by default to generate less code, but can be enabled with
     * `generate_from_impls` set to `true`.
     * @returns {boolean}
     */
    get generate_from_impls() {
        const ret = wasm.__wbg_get_config_generate_from_impls(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Create bindings for a `no_std` environment
     * @returns {boolean}
     */
    get no_std_compliant_bindings() {
        const ret = wasm.__wbg_get_config_no_std_compliant_bindings(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * ASN.1 Open Types are represented as the `rasn::types::Any` type,
     * which holds a binary `content`. If `opaque_open_types` is `false`,
     * the compiler will generate additional de-/encode methods for
     * all rust types that hold an open type.
     * For example, bindings for a `SEQUENCE` with a field of Open Type
     * value will include a method for explicitly decoding the Open Type field.
     * _Non-opaque open types are still experimental. If you have trouble_
     * _generating correct bindings, switch back to opaque open types._
     * @returns {boolean}
     */
    get opaque_open_types() {
        const ret = wasm.__wbg_get_config_opaque_open_types(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Annotations to be added to all generated rust types of the bindings. Each vector element
     * will generate a new line of annotations. Note that the compiler will automatically add all pound-derives
     * needed by `rasn` __except__ `Eq` and `Hash`, which are needed only when working with `SET`s.
     *
     * Default: `vec![String::from("#[derive(AsnType, Debug, Clone, Decode, Encode, PartialEq, Eq, Hash)]")]`
     * @returns {string[]}
     */
    get type_annotations() {
        const ret = wasm.__wbg_get_config_type_annotations(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Stringified paths to items that will be imported into all generated modules with a
     * [use declaration](https://doc.rust-lang.org/reference/items/use-declarations.html).
     * For example `vec![String::from("my::module::*"), String::from("path::to::my::Struct")]`.
     * @param {string[]} arg0
     */
    set custom_imports(arg0) {
        const ptr0 = passArrayJsValueToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_config_custom_imports(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * The compiler will try to match module import dependencies of the ASN.1
     * module as close as possible, importing only those types from other modules
     * that are imported in the ASN.1 module. If the `default_wildcard_imports`
     * is set to `true` , the compiler will import the entire module using
     * the wildcard `*` for each module that the input ASN.1 module imports from.
     * @param {boolean} arg0
     */
    set default_wildcard_imports(arg0) {
        wasm.__wbg_set_config_default_wildcard_imports(this.__wbg_ptr, arg0);
    }
    /**
     * To make working with the generated types a bit more ergonomic, the compiler
     * can generate `From` impls for the wrapper inner types in a `CHOICE`, as long
     * as the generated impls are not ambiguous.
     * This is disabled by default to generate less code, but can be enabled with
     * `generate_from_impls` set to `true`.
     * @param {boolean} arg0
     */
    set generate_from_impls(arg0) {
        wasm.__wbg_set_config_generate_from_impls(this.__wbg_ptr, arg0);
    }
    /**
     * Create bindings for a `no_std` environment
     * @param {boolean} arg0
     */
    set no_std_compliant_bindings(arg0) {
        wasm.__wbg_set_config_no_std_compliant_bindings(this.__wbg_ptr, arg0);
    }
    /**
     * ASN.1 Open Types are represented as the `rasn::types::Any` type,
     * which holds a binary `content`. If `opaque_open_types` is `false`,
     * the compiler will generate additional de-/encode methods for
     * all rust types that hold an open type.
     * For example, bindings for a `SEQUENCE` with a field of Open Type
     * value will include a method for explicitly decoding the Open Type field.
     * _Non-opaque open types are still experimental. If you have trouble_
     * _generating correct bindings, switch back to opaque open types._
     * @param {boolean} arg0
     */
    set opaque_open_types(arg0) {
        wasm.__wbg_set_config_opaque_open_types(this.__wbg_ptr, arg0);
    }
    /**
     * Annotations to be added to all generated rust types of the bindings. Each vector element
     * will generate a new line of annotations. Note that the compiler will automatically add all pound-derives
     * needed by `rasn` __except__ `Eq` and `Hash`, which are needed only when working with `SET`s.
     *
     * Default: `vec![String::from("#[derive(AsnType, Debug, Clone, Decode, Encode, PartialEq, Eq, Hash)]")]`
     * @param {string[]} arg0
     */
    set type_annotations(arg0) {
        const ptr0 = passArrayJsValueToWasm0(arg0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_config_type_annotations(this.__wbg_ptr, ptr0, len0);
    }
}
if (Symbol.dispose) Config.prototype[Symbol.dispose] = Config.prototype.free;

export class Generated {
    static __wrap(ptr) {
        const obj = Object.create(Generated.prototype);
        obj.__wbg_ptr = ptr;
        GeneratedFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    toJSON() {
        return {
            rust: this.rust,
            warnings: this.warnings,
        };
    }
    toString() {
        return JSON.stringify(this);
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        GeneratedFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_generated_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    get rust() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.__wbg_get_generated_rust(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get warnings() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.__wbg_get_generated_warnings(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {string} arg0
     */
    set rust(arg0) {
        const ptr0 = passStringToWasm0(arg0, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_generated_rust(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {string} arg0
     */
    set warnings(arg0) {
        const ptr0 = passStringToWasm0(arg0, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.__wbg_set_generated_warnings(this.__wbg_ptr, ptr0, len0);
    }
}
if (Symbol.dispose) Generated.prototype[Symbol.dispose] = Generated.prototype.free;

/**
 * Compile ASN.1 source to bindings. `backend` is "rust" or "typescript".
 * @param {string} asn1
 * @param {string} backend
 * @returns {any}
 */
export function compile(asn1, backend) {
    const ptr0 = passStringToWasm0(asn1, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(backend, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.compile(ptr0, len0, ptr1, len1);
    return ret;
}

/**
 * @param {string} asn1
 * @param {Config} config
 * @returns {Generated}
 */
export function compile_to_rust(asn1, config) {
    const ptr0 = passStringToWasm0(asn1, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    _assertClass(config, Config);
    var ptr1 = config.__destroy_into_raw();
    const ret = wasm.compile_to_rust(ptr0, len0, ptr1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Generated.__wrap(ret[0]);
}

/**
 * @param {string} asn1
 * @returns {Generated}
 */
export function compile_to_typescript(asn1) {
    const ptr0 = passStringToWasm0(asn1, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.compile_to_typescript(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Generated.__wrap(ret[0]);
}

/**
 * The version of the underlying compiler, for display in the UI.
 * @returns {string}
 */
export function compiler_version() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.compiler_version();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * WASM export: decode hex to a tree, returning a JS object.
 * @param {string} hex
 * @returns {any}
 */
export function decode_to_tree(hex) {
    const ptr0 = passStringToWasm0(hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.decode_to_tree(ptr0, len0);
    return ret;
}

/**
 * A valid DER sample for the hex inspector: SGP.22 `OperatorId` with mccMnc
 * 246/81, the worked example from SGP.22 §5.7.2.
 * @returns {string}
 */
export function example_hex() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.example_hex();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * A second sample: the same structure with a 3-digit MNC, to show that the
 * ASN.1 layer cannot tell the two apart — the third digit lives inside the
 * OCTET STRING and only TS 24.008 explains the packing.
 * @returns {string}
 */
export function example_hex_3digit() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.example_hex_3digit();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * A sample that is NOT ASN.1, to demonstrate the lookalike trap: real SGP.22
 * Profile Element bytes. A BER reader returns one opaque primitive and no
 * error, which is the whole hazard.
 * @returns {string}
 */
export function example_hex_lookalike() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.example_hex_lookalike();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * A nested DER sample: SEQUENCE containing INTEGER, BOOLEAN and UTF8String, so
 * the tree view has something to expand.
 *
 * Length byte is 0x0E (14 content bytes): INTEGER 4 + BOOLEAN 3 + UTF8String 7.
 * @returns {string}
 */
export function example_hex_nested() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.example_hex_nested();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * A minimal schema, for a quick first look.
 * @returns {string}
 */
export function example_minimal() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.example_minimal();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * Compiled-in example: a valid subset of SGP.22's RSPDefinitions.
 *
 * Hand-authored rather than extracted from the PDF — the extracted text does
 * not compile (wrapped prose inside comments, OIDs broken across lines).
 * @returns {string}
 */
export function example_schema() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.example_schema();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

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
 * @param {string} hex
 * @returns {any}
 */
export function hex_to_tree(hex) {
    const ptr0 = passStringToWasm0(hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.hex_to_tree(ptr0, len0);
    return ret;
}

/**
 * Validate only: reports whether the module parses and can be generated.
 *
 * Uses the compiler front end rather than a dedicated parse, because the parsed
 * module is not reachable through the public API. A success here means "parsed
 * and generated", which is slightly stronger than "parsed" — noted in the UI so
 * the distinction is not overstated.
 * @param {string} asn1
 * @returns {any}
 */
export function validate(asn1) {
    const ptr0 = passStringToWasm0(asn1, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.validate(ptr0, len0);
    return ret;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_67e7344beaa85059: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_string_get_92ab86bb19cbc12f: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_5d9e815e6fdf150f: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_error_757e9472f8410341: function(arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                console.error(getStringFromWasm0(arg0, arg1));
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
        },
        __wbg_new_227d7c05414eb861: function() {
            const ret = new Error();
            return ret;
        },
        __wbg_new_bebc3f4757acf305: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_ffa92086ea89f79c: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_set_13d25b81ab403f5e: function(arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = arg2;
        },
        __wbg_set_6be42768c690e380: function(arg0, arg1, arg2) {
            arg0[arg1] = arg2;
        },
        __wbg_stack_3b0d974bbf31e44f: function(arg0, arg1) {
            const ret = arg1.stack;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbindgen_generic_0000000000000001: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_generic_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_generic_0000000000000003: function(arg0) {
            // Cast intrinsic for `U64 -> Externref`.
            const ret = BigInt.asUintN(64, arg0);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./asn1_toolkit_bg.js": import0,
    };
}

const ConfigFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_config_free(ptr, 1));
const GeneratedFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_generated_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    for (let i = 0; i < array.length; i++) {
        const add = addToExternrefTable0(array[i]);
        getDataViewMemory0().setUint32(ptr + 4 * i, add, true);
    }
    WASM_VECTOR_LEN = array.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('asn1_toolkit_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
