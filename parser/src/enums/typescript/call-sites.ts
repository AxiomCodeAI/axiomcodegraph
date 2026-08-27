/**
 * `ts_call_site` enums — schema §4.15. The flagship gate lives on this relation.
 *
 * 100% of 9,627 measured call sites have a `getResolvedSignature` answer, so
 * every value here is adjudicable against the reference implementation rather
 * than merely plausible.
 */

/** `ts_call_site` c0. */
export enum TsCallKind {
  FUNCTION_CALL = 'FUNCTION_CALL',
  METHOD_CALL = 'METHOD_CALL',
  CONSTRUCTOR_CALL = 'CONSTRUCTOR_CALL',
  SUPER_CALL = 'SUPER_CALL',
  TAGGED_TEMPLATE_CALL = 'TAGGED_TEMPLATE_CALL',
  /** A call through an index signature. */
  INDEX_CALL = 'INDEX_CALL',
  DYNAMIC_IMPORT_CALL = 'DYNAMIC_IMPORT_CALL',
  DECORATOR_CALL = 'DECORATOR_CALL',
  OPTIONAL_CALL = 'OPTIONAL_CALL',
  /**
   * RESERVED — §4.15.1. TSX is out of freeze 1: the representation is decided
   * (a JSX element IS a call to its component, props as argument 0) but **zero
   * rows may carry this value**. The gate asserts the emptiness, so switching
   * TSX on shows up as a gate failure rather than as new rows appearing
   * unremarked.
   */
  JSX_COMPONENT_CALL = 'JSX_COMPONENT_CALL',
}

/** `ts_call_site` c2 — the SHAPE of the receiver, which is what resolution dispatches on. */
export enum TsReceiverKind {
  NONE = 'NONE',
  IDENTIFIER = 'IDENTIFIER',
  THIS = 'THIS',
  SUPER = 'SUPER',
  PROPERTY_CHAIN = 'PROPERTY_CHAIN',
  CALL_RESULT = 'CALL_RESULT',
  ELEMENT_ACCESS = 'ELEMENT_ACCESS',
  PARENTHESIZED = 'PARENTHESIZED',
  NON_NULL = 'NON_NULL',
  AS_EXPRESSION = 'AS_EXPRESSION',
  AWAIT_RESULT = 'AWAIT_RESULT',
  UNKNOWN = 'UNKNOWN',
}

/** `ts_call_site` c14. */
export enum TsResolvedTargetKind {
  /** A project declaration that carries a body — the code that actually runs. */
  PROJECT_IMPLEMENTATION = 'PROJECT_IMPLEMENTATION',
  /** A project declaration with no body: an overload signature or an abstract member. */
  PROJECT_SIGNATURE = 'PROJECT_SIGNATURE',
  /** `declare`d in project source — bodiless by construction. */
  AMBIENT_SIGNATURE = 'AMBIENT_SIGNATURE',
  /** Declared in `lib.*.d.ts` or `node_modules` — the engine closes it from `lib_ts_*`. */
  LIB_SIGNATURE = 'LIB_SIGNATURE',
  /** 2.3% measured: implicit constructors and synthesized members. An honest terminal. */
  SYNTHESIZED_NO_DECLARATION = 'SYNTHESIZED_NO_DECLARATION',
  INDEX_SIGNATURE = 'INDEX_SIGNATURE',
  UNRESOLVED = 'UNRESOLVED',
}

/**
 * `ts_call_site` c18 — WHY the parser believes the target.
 *
 * The parser fills c12–c18 only where resolution is syntactically decidable
 * (§4.15). This column names the syntax it used, so a wrong link is traceable
 * to the rule that produced it rather than to "the parser".
 */
export enum TsResolutionEvidence {
  DECLARED_RECEIVER_TYPE = 'DECLARED_RECEIVER_TYPE',
  IMPORT_BINDING = 'IMPORT_BINDING',
  LOCAL_BINDING = 'LOCAL_BINDING',
  THIS_MEMBER = 'THIS_MEMBER',
  SUPER_MEMBER = 'SUPER_MEMBER',
  NAMESPACE_QUALIFIED = 'NAMESPACE_QUALIFIED',
  INDEX_SIGNATURE = 'INDEX_SIGNATURE',
  AMBIENT_GLOBAL = 'AMBIENT_GLOBAL',
  NONE = 'NONE',
}
