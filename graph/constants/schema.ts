/**
 * Column counts for every parser IR entity CSV (tab-separated). Single source of
 * truth for building `format=(string, …)` specs in the import templates. All
 * columns are imported as strings (string matching / CONCAT downstream), so only
 * the arity matters here.
 *
 * Counts mirror the parser's output, and are PER-LANGUAGE: each language's parser
 * emits its own entity set with its own arities (Java's `all-*.csv`, Python's
 * `all-python-*.csv`), matching the per-language rule sets under `graph/<lang>/`.
 */
export const JAVA_ENTITY_COLUMNS: Record<string, number> = {
  'all-types.csv': 14,
  'all-type-references.csv': 18,
  'all-type-parameters.csv': 8,
  'all-methods.csv': 22,
  'all-method-parameters.csv': 13,
  'all-method-type-parameters.csv': 10,
  'all-fields.csv': 14,
  'all-field-positions.csv': 3,
  'all-expressions.csv': 25,
  'all-local-variables.csv': 19,
  'all-blocks.csv': 18,
  'all-imports.csv': 11,
  'all-annotations.csv': 13,
  'all-annotation-arguments.csv': 11,
  'all-comments.csv': 10,
  'all-enum-constants.csv': 13,
  'all-property-keys.csv': 14,
  'all-property-value-segments.csv': 12,
  'all-xml-elements.csv': 15,
  'all-xml-attributes.csv': 10,
  'all-xml-value-references.csv': 13,
  'all-yaml-properties.csv': 16,
  'all-yaml-value-segments.csv': 12,
};

/**
 * Python IR entity arities. Measured from the built stdlib IR at
 * `AxiomCode/python/v3.10.4/` rather than transcribed — see `build-stdlib-ir.sh`.
 *
 * `all-python-type-parameters.csv` is deliberately absent: PEP 695 type parameters
 * are 3.12+, so the relation is empty in every 3.10 shard and its arity cannot be
 * measured here. Add it from a 3.12 build; do not guess.
 */
export const PYTHON_ENTITY_COLUMNS: Record<string, number> = {
  'all-python-modules.csv': 24,
  'all-python-types.csv': 25,
  'all-python-type-bases.csv': 16,
  'all-python-type-references.csv': 25,
  'all-python-scopes.csv': 25,
  'all-python-methods.csv': 36,
  'all-python-method-parameters.csv': 22,
  'all-python-fields.csv': 29,
  'all-python-field-positions.csv': 3,
  'all-python-bindings.csv': 29,
  'all-python-imports.csv': 24,
  'all-python-call-sites.csv': 26,
  'all-python-expressions.csv': 39,
  'all-python-blocks.csv': 27,
  'all-python-decorators.csv': 21,
  'all-python-decorator-arguments.csv': 15,
  'all-python-parse-gaps.csv': 10,
  'all-python-comments.csv': 15,
};

/** Entity arities keyed by the `--language` the engine was invoked with. */
export const ENTITY_COLUMNS_BY_LANGUAGE: Record<string, Record<string, number>> = {
  java: JAVA_ENTITY_COLUMNS,
  python: PYTHON_ENTITY_COLUMNS,
};

/** @deprecated Java's arities under the pre-split name. Use JAVA_ENTITY_COLUMNS. */
export const ENTITY_COLUMNS = JAVA_ENTITY_COLUMNS;

/** `format=(string, string, …)` for `n` string columns. */
export function stringFormat(n: number): string {
  return `format=(${Array(n).fill('string').join(', ')})`;
}

/**
 * Required IR blocks — the minimum entities the Java reasoning needs to do
 * anything. If a path is missing these it isn't valid Java IR, so the phase
 * fails fast with a clear message rather than producing empty/garbage output.
 */
// Required IR blocks differ by side:
//   - CLIENT: all-imports is NOT required — a file can have only a package
//     declaration and no imports, so the client may legitimately have none.
//     (Absent optional entities are handled via an empty placeholder at render
//     time, so client_import stays safe when missing.)
//   - JDK: all-imports IS required — the JDK's own imports are needed to resolve
//     its cross-module references during reasoning.
const COMMON_REQUIRED = [
  'all-types.csv',
  'all-methods.csv',
  'all-method-parameters.csv',
  'all-expressions.csv',
] as const;

export const JAVA_CLIENT_REQUIRED_ENTITIES = COMMON_REQUIRED;
export const JAVA_JDK_REQUIRED_ENTITIES = [...COMMON_REQUIRED, 'all-imports.csv'] as const;

/**
 * Python's minimum — the blocks whose absence proves the path is not Python IR.
 *
 * Only three qualify, because a required block must be non-empty for EVERY valid
 * program: every file that parses yields one module row, a `<module>` method, and
 * a module scope. MEASURED — a function that calls nothing yields a zero-byte
 * `all-python-call-sites.csv`, and an empty `__init__.py` empties bindings and
 * expressions too, so requiring those would reject ordinary files. `all-python-
 * types.csv` is out for the same reason: a module of plain functions has no class.
 *
 * The check is PRESENCE, not non-emptiness — the parser writes a zero-byte file
 * rather than omitting it.
 */
export const PYTHON_CLIENT_REQUIRED_ENTITIES = [
  'all-python-modules.csv',
  'all-python-methods.csv',
  'all-python-scopes.csv',
] as const;

/**
 * TypeScript's minimum, by the same presence rule: every file the parser accepts yields a
 * module row and that module's MODULE_INITIALIZER method, so these two blocks exist for any
 * valid project. Mirrors IR_MARKER in graph/typescript/templates/staging.conf.
 */
export const TYPESCRIPT_CLIENT_REQUIRED_ENTITIES = [
  'all-typescript-modules.csv',
  'all-typescript-methods.csv',
] as const;

/**
 * C#'s minimum, by the same presence rule. Every .cs file the parser accepts yields
 * exactly one cs_module row, so `all-csharp-modules.csv` exists for any valid
 * project and is the block whose absence proves the path is not C# IR.
 *
 * `all-csharp-types.csv` is deliberately NOT required, for the same reason Python's
 * types block is not: a file of C# 9 top-level statements declares no type at all,
 * and neither does one holding only global usings. Requiring it rejects both.
 *
 * `all-csharp-methods.csv` is required because the parser synthesises a
 * TOP_LEVEL_ENTRY_POINT method for a top-level-statements file, so even that file
 * yields a method row.
 */
export const CSHARP_CLIENT_REQUIRED_ENTITIES = [
  'all-csharp-modules.csv',
  'all-csharp-methods.csv',
] as const;

/** @deprecated pre-split names, kept so existing callers keep compiling. */
export const CLIENT_REQUIRED_ENTITIES = JAVA_CLIENT_REQUIRED_ENTITIES;
export const JDK_REQUIRED_ENTITIES = JAVA_JDK_REQUIRED_ENTITIES;
