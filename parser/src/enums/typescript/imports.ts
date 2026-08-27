/** `ts_import` enums — schema §4.12. 45.6% of ecosystem imports are type-only. */

/** `ts_import` c0. */
export enum TsImportKind {
  NAMED = 'NAMED',
  NAMED_ALIAS = 'NAMED_ALIAS',
  DEFAULT = 'DEFAULT',
  /** `import * as ns` — Java's `TYPE_ON_DEMAND` slot; the projection stays `import_wildcard`. */
  NAMESPACE = 'NAMESPACE',
  /** `import "./polyfill"` — no binding, but a real module edge. */
  SIDE_EFFECT = 'SIDE_EFFECT',
  TYPE_ONLY_NAMED = 'TYPE_ONLY_NAMED',
  TYPE_ONLY_DEFAULT = 'TYPE_ONLY_DEFAULT',
  TYPE_ONLY_NAMESPACE = 'TYPE_ONLY_NAMESPACE',
  /** `import { type X }` — type-only on the SPECIFIER, not the declaration. */
  INLINE_TYPE_SPECIFIER = 'INLINE_TYPE_SPECIFIER',
  IMPORT_EQUALS_REQUIRE = 'IMPORT_EQUALS_REQUIRE',
  IMPORT_EQUALS_ENTITY = 'IMPORT_EQUALS_ENTITY',
  DYNAMIC_IMPORT = 'DYNAMIC_IMPORT',
  TYPE_IMPORT_NODE = 'TYPE_IMPORT_NODE',
  REQUIRE_CALL = 'REQUIRE_CALL',
  TRIPLE_SLASH_REFERENCE = 'TRIPLE_SLASH_REFERENCE',
}

/**
 * `ts_import` c16 — how the specifier resolved.
 *
 * Filled by `ts.resolveModuleName`, which needs no Program and is therefore
 * parser-legal (§0.1). `UNRESOLVED` is an honest negative about THIS analysis,
 * not a claim about the outside world.
 */
export enum TsImportResolutionKind {
  RELATIVE_FILE = 'RELATIVE_FILE',
  PATHS_ALIAS = 'PATHS_ALIAS',
  NODE_MODULES_TYPES = 'NODE_MODULES_TYPES',
  NODE_MODULES_SOURCE = 'NODE_MODULES_SOURCE',
  PACKAGE_EXPORTS = 'PACKAGE_EXPORTS',
  AMBIENT_MODULE = 'AMBIENT_MODULE',
  BUILTIN_NODE = 'BUILTIN_NODE',
  UNRESOLVED = 'UNRESOLVED',
}

/** `ts_import` c17. */
export enum TsResolvedExtension {
  TS = '.ts',
  TSX = '.tsx',
  DTS = '.d.ts',
  MTS = '.mts',
  CTS = '.cts',
  JSON = '.json',
  JS = '.js',
}
