/** `ts_type` enums — schema §4.2. Declarations only; anonymous shapes live in `ts_type_reference`. */

/** `ts_type` c3. Checkable against `SymbolFlags`, hence tier 2 per declaration. */
export enum TsTypeCategory {
  CLASS_TYPE = 'CLASS_TYPE',
  INTERFACE_TYPE = 'INTERFACE_TYPE',
  ENUM_TYPE = 'ENUM_TYPE',
  CONST_ENUM_TYPE = 'CONST_ENUM_TYPE',
  TYPE_ALIAS_TYPE = 'TYPE_ALIAS_TYPE',
  NAMESPACE_TYPE = 'NAMESPACE_TYPE',
  CLASS_EXPRESSION_TYPE = 'CLASS_EXPRESSION_TYPE',
}

/**
 * `ts_type` c4. TypeScript visibility is EXPORT-based, not modifier-based, so
 * Java's `PACKAGE_ACCESS` has no analogue and is deliberately absent.
 */
export enum TsTypeAccess {
  EXPORTED_ACCESS = 'EXPORTED_ACCESS',
  DEFAULT_EXPORT_ACCESS = 'DEFAULT_EXPORT_ACCESS',
  MODULE_LOCAL_ACCESS = 'MODULE_LOCAL_ACCESS',
  GLOBAL_ACCESS = 'GLOBAL_ACCESS',
  NAMESPACE_LOCAL_ACCESS = 'NAMESPACE_LOCAL_ACCESS',
}

/** `ts_type` c5 — comma-set. */
export enum TsTypeModifier {
  ABSTRACT = 'ABSTRACT',
  DECLARE = 'DECLARE',
  CONST = 'CONST',
  EXPORT = 'EXPORT',
  DEFAULT_EXPORT = 'DEFAULT_EXPORT',
  GENERIC = 'GENERIC',
}

/** `ts_type` c6. */
export enum TsTypePlacement {
  TOP_LEVEL_PLACEMENT = 'TOP_LEVEL_PLACEMENT',
  NAMESPACE_PLACEMENT = 'NAMESPACE_PLACEMENT',
  NESTED_PLACEMENT = 'NESTED_PLACEMENT',
  LOCAL_PLACEMENT = 'LOCAL_PLACEMENT',
  EXPRESSION_PLACEMENT = 'EXPRESSION_PLACEMENT',
  AMBIENT_MODULE_PLACEMENT = 'AMBIENT_MODULE_PLACEMENT',
}

/**
 * `ts_type` c18 — which MEANINGS a declaration occupies.
 *
 * Load-bearing for §3.1: merging is legal only when the spaces do not collide.
 * `class` + `interface` merges because the class owns VALUE and the interface
 * does not; `class` + `class` is an error because both claim VALUE.
 */
export enum TsDeclarationSpace {
  TYPE = 'TYPE',
  VALUE = 'VALUE',
  NAMESPACE = 'NAMESPACE',
}
