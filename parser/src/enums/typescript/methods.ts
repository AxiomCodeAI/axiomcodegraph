/** `ts_method` enums — schema §4.6. Every function-shaped declaration, including bodiless signatures. */

/** `ts_method` c10. */
export enum TsMethodAccess {
  PUBLIC_ACCESS = 'PUBLIC_ACCESS',
  PRIVATE_ACCESS = 'PRIVATE_ACCESS',
  PROTECTED_ACCESS = 'PROTECTED_ACCESS',
  /** `#m()` — a HARD runtime private, unlike `private` which is erased. */
  PRIVATE_NAME_ACCESS = 'PRIVATE_NAME_ACCESS',
  EXPORTED_ACCESS = 'EXPORTED_ACCESS',
  MODULE_LOCAL_ACCESS = 'MODULE_LOCAL_ACCESS',
}

/** `ts_method` c11 — comma-set. */
export enum TsMethodModifier {
  STATIC = 'STATIC',
  ABSTRACT = 'ABSTRACT',
  ASYNC = 'ASYNC',
  GENERATOR = 'GENERATOR',
  DECLARE = 'DECLARE',
  OVERRIDE = 'OVERRIDE',
  OPTIONAL = 'OPTIONAL',
  EXPORT = 'EXPORT',
  DEFAULT_EXPORT = 'DEFAULT_EXPORT',
}

/** `ts_method` c16. Node-kind-driven (tier 1); only the PRIORITY ORDER is authored. */
export enum TsMethodKind {
  FUNCTION_DECLARATION = 'FUNCTION_DECLARATION',
  METHOD_DECLARATION = 'METHOD_DECLARATION',
  CONSTRUCTOR = 'CONSTRUCTOR',
  GETTER = 'GETTER',
  SETTER = 'SETTER',
  ARROW_FUNCTION = 'ARROW_FUNCTION',
  FUNCTION_EXPRESSION = 'FUNCTION_EXPRESSION',
  METHOD_SIGNATURE = 'METHOD_SIGNATURE',
  CALL_SIGNATURE = 'CALL_SIGNATURE',
  CONSTRUCT_SIGNATURE = 'CONSTRUCT_SIGNATURE',
  FUNCTION_TYPE_SIGNATURE = 'FUNCTION_TYPE_SIGNATURE',
  CONSTRUCTOR_TYPE_SIGNATURE = 'CONSTRUCTOR_TYPE_SIGNATURE',
  OBJECT_LITERAL_METHOD = 'OBJECT_LITERAL_METHOD',
  CLASS_STATIC_BLOCK = 'CLASS_STATIC_BLOCK',
  /** The synthetic `<module>` owner of top-level executable statements. */
  MODULE_INITIALIZER = 'MODULE_INITIALIZER',
}

/**
 * `ts_method` c25 — overload identity as a FIRST-CLASS column, not a flag.
 *
 * 11,599 overload signatures measured, and 77.6% of overloaded calls resolve to
 * a NON-FIRST declaration. A call site that points at a name rather than at one
 * of these is wrong four times in five.
 */
export enum TsSignatureRole {
  /** The only declaration of its name. */
  SOLE = 'SOLE',
  /** One of N bodiless declarations preceding an implementation. */
  OVERLOAD_SIGNATURE = 'OVERLOAD_SIGNATURE',
  /** The declaration that carries the body for an overload set. */
  IMPLEMENTATION = 'IMPLEMENTATION',
  /** `declare function f(): void` — bodiless with no implementation anywhere in source. */
  AMBIENT = 'AMBIENT',
}

/**
 * `ts_method` c27 — the column that stops a `.d.ts` line being read as an implementation.
 *
 * 44.3% of resolved call targets are bodiless. Attributing a call to one of
 * these as if it were the code that runs is the single most expensive mistake
 * available in this fact base.
 */
export enum TsBodyPresence {
  HAS_BODY = 'HAS_BODY',
  NO_BODY_OVERLOAD = 'NO_BODY_OVERLOAD',
  NO_BODY_AMBIENT = 'NO_BODY_AMBIENT',
  NO_BODY_INTERFACE = 'NO_BODY_INTERFACE',
  NO_BODY_ABSTRACT = 'NO_BODY_ABSTRACT',
}
