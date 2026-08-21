/**
 * Python-specific parser constants.
 */

/**
 * tree-sitter's hard ceiling on a single parse buffer: **32,767 characters**
 * (2^15 - 1), not "about 30KB".
 *
 * Two properties of this limit are easy to get wrong and both matter:
 *
 * 1. **It counts characters, not bytes.** 29k characters of CJK is 62KB of
 *    UTF-8 and parses fine; 33k characters of ASCII is 33KB and does not. A
 *    byte-based guard is wrong in both directions.
 * 2. **The callback's returned chunk carries the same ceiling.** Streaming does
 *    not lift the limit, it only lets you stay under it — so returning a 65536-
 *    byte chunk from the callback throws exactly as a direct parse would.
 *
 * Three of five stdlib packages fail to parse without the callback path, so it
 * is the common path for real code, not an edge case.
 */
export const TREE_SITTER_MAX_PARSE_CHARS = 32_767;

/**
 * Character count above which `PythonParser` switches to callback parsing.
 *
 * Deliberately below {@link TREE_SITTER_MAX_PARSE_CHARS} rather than equal to
 * it, mirroring `java-parser.ts`: the margin costs nothing and avoids sitting
 * exactly on a boundary whose accounting is not ours to verify.
 */
export const PYTHON_CALLBACK_PARSE_THRESHOLD = 30_000;

/**
 * Chunk size returned by the streaming parse callback. Well under the ceiling
 * described above, and identical to the Java parser's chunking.
 */
export const PYTHON_PARSE_CHUNK_SIZE = 8_192;

/**
 * The exact interpreter patch this analysis targets. Recorded in every
 * `py_module` row for reproducibility, and paired with invariant #10.
 */
export const PYTHON_TARGET_VERSION = '3.10.4';

/**
 * CPython's synthetic iterator parameter, present in exactly one binding of
 * every comprehension and generator-expression scope on the `PY3_0_11` target.
 *
 * It is a genuine `symtable.Symbol`, so it is emitted as a real `py_binding`
 * row and asserted positively — never whitelisted, because a whitelist also
 * passes when the binding is missing.
 */
export const PYTHON_SYNTHETIC_ITERATOR = '.0';

/** symtable's own name for the module scope. */
export const PYTHON_MODULE_SCOPE_NAME = 'top';

/** The `<locals>` marker CPython inserts into `__qualname__` inside functions. */
export const PYTHON_LOCALS_MARKER = '<locals>';

/** Synthetic method minted per module so module-level code always has an owner. */
export const PYTHON_MODULE_INITIALIZER_NAME = '<module>';

/** Synthetic method minted per class body, the `<clinit>` analogue. */
export const PYTHON_CLASS_INITIALIZER_NAME = '<classbody>';

/** symtable's name for every lambda scope. Two on one line are distinguished only by column. */
export const PYTHON_LAMBDA_SCOPE_NAME = 'lambda';

/**
 * CPython's `__qualname__` for a lambda, and therefore `py_method.name`.
 *
 * Deliberately different from {@link PYTHON_LAMBDA_SCOPE_NAME}: symtable calls
 * the scope `lambda`, while the function object's qualname is `<lambda>`. Each
 * column follows its own source of truth rather than being forced to agree.
 */
export const PYTHON_LAMBDA_METHOD_NAME = '<lambda>';

/** CSV file names for the Python fact tables. */
export const PYTHON_CSV_FILES = {
  MODULES: 'all-python-modules.csv',
  SCOPES: 'all-python-scopes.csv',
  BINDINGS: 'all-python-bindings.csv',
  TYPES: 'all-python-types.csv',
  TYPE_BASES: 'all-python-type-bases.csv',
  METHODS: 'all-python-methods.csv',
  METHOD_PARAMETERS: 'all-python-method-parameters.csv',
  IMPORTS: 'all-python-imports.csv',
  EXPRESSIONS: 'all-python-expressions.csv',
  CALL_SITES: 'all-python-call-sites.csv',
  TYPE_REFERENCES: 'all-python-type-references.csv',
  SKIPPED_FILES: 'skipped-python-files.csv',
} as const;
