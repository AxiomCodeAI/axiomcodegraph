/**
 * `ts_type_reference` enums — schema §4.5.
 *
 * This relation is the STRUCTURAL guarantee of §3.3: every type-level construct
 * lives here and nowhere else, so no call-graph rule can reach a conditional,
 * a mapped type or an `infer`. The containment is not a filter someone must
 * remember to apply — there is simply no other relation for them to be in.
 */

/** `ts_type_reference` c0. */
export enum TsTypeRefKind {
  TYPE_REFERENCE = 'TYPE_REFERENCE',
  PRIMITIVE = 'PRIMITIVE',
  LITERAL = 'LITERAL',
  ARRAY = 'ARRAY',
  TUPLE = 'TUPLE',
  UNION = 'UNION',
  INTERSECTION = 'INTERSECTION',
  FUNCTION_TYPE = 'FUNCTION_TYPE',
  CONSTRUCTOR_TYPE = 'CONSTRUCTOR_TYPE',
  TYPE_LITERAL = 'TYPE_LITERAL',
  CONDITIONAL = 'CONDITIONAL',
  MAPPED = 'MAPPED',
  TEMPLATE_LITERAL = 'TEMPLATE_LITERAL',
  INDEXED_ACCESS = 'INDEXED_ACCESS',
  /** `typeof x` in TYPE position — not the `typeof` operator, which is an expression. */
  TYPE_QUERY = 'TYPE_QUERY',
  /** `keyof` / `readonly` / `unique`. */
  TYPE_OPERATOR = 'TYPE_OPERATOR',
  INFER = 'INFER',
  TYPE_PREDICATE = 'TYPE_PREDICATE',
  IMPORT_TYPE = 'IMPORT_TYPE',
  THIS_TYPE = 'THIS_TYPE',
  PARENTHESIZED = 'PARENTHESIZED',
  REST = 'REST',
  OPTIONAL = 'OPTIONAL',
  NAMED_TUPLE_MEMBER = 'NAMED_TUPLE_MEMBER',
  TYPE_VARIABLE = 'TYPE_VARIABLE',
  INTRINSIC = 'INTRINSIC',
}

/** `ts_type_reference` c1 — WHERE the name was written. */
export enum TsTypeRefContext {
  SUPER_TYPE = 'SUPER_TYPE',
  /**
   * Records that a name appeared in an `implements` clause. This survives ONLY
   * as a description of position — never as a subtyping edge (§3.2).
   */
  IMPLEMENTS_CLAUSE = 'IMPLEMENTS_CLAUSE',
  TYPE_PARAM_CONSTRAINT = 'TYPE_PARAM_CONSTRAINT',
  TYPE_PARAM_DEFAULT = 'TYPE_PARAM_DEFAULT',
  FIELD_TYPE = 'FIELD_TYPE',
  METHOD_RETURN = 'METHOD_RETURN',
  METHOD_PARAM = 'METHOD_PARAM',
  VARIABLE_TYPE = 'VARIABLE_TYPE',
  TYPE_ALIAS_RHS = 'TYPE_ALIAS_RHS',
  TYPE_ARGUMENT = 'TYPE_ARGUMENT',
  AS_TARGET = 'AS_TARGET',
  SATISFIES_TARGET = 'SATISFIES_TARGET',
  TYPE_ASSERTION = 'TYPE_ASSERTION',
  TYPE_PREDICATE_TARGET = 'TYPE_PREDICATE_TARGET',
  INDEX_SIGNATURE_KEY = 'INDEX_SIGNATURE_KEY',
  INDEX_SIGNATURE_VALUE = 'INDEX_SIGNATURE_VALUE',
  MAPPED_CONSTRAINT = 'MAPPED_CONSTRAINT',
  MAPPED_TEMPLATE = 'MAPPED_TEMPLATE',
  CONDITIONAL_CHECK = 'CONDITIONAL_CHECK',
  CONDITIONAL_EXTENDS = 'CONDITIONAL_EXTENDS',
  CONDITIONAL_TRUE = 'CONDITIONAL_TRUE',
  CONDITIONAL_FALSE = 'CONDITIONAL_FALSE',
  TEMPLATE_SPAN = 'TEMPLATE_SPAN',
  IMPORT_TYPE_QUALIFIER = 'IMPORT_TYPE_QUALIFIER',
  ENUM_MEMBER_TYPE = 'ENUM_MEMBER_TYPE',
  /** The twin row minted for every `ts_type_heritage` entry so heritage names resolve normally. */
  HERITAGE_TWIN = 'HERITAGE_TWIN',
  /** Element/member of a composite type node: a union member, a tuple element, an array element. */
  TYPE_ELEMENT = 'TYPE_ELEMENT',
}

/** `ts_type_reference` c16 — what c15 points at. */
export enum TsReferenceOwnerKind {
  TYPE = 'TYPE',
  METHOD = 'METHOD',
  METHOD_PARAM = 'METHOD_PARAM',
  FIELD = 'FIELD',
  VARIABLE = 'VARIABLE',
  TYPE_PARAMETER = 'TYPE_PARAMETER',
  EXPRESSION = 'EXPRESSION',
  DECORATOR = 'DECORATOR',
  HERITAGE = 'HERITAGE',
  TYPE_REFERENCE = 'TYPE_REFERENCE',
  ENUM_MEMBER = 'ENUM_MEMBER',
  EXPORT = 'EXPORT',
  MODULE = 'MODULE',
}

/**
 * `ts_type_reference` c12 — Java's `wildcardVariance` slot, REPURPOSED.
 *
 * TypeScript has no use-site wildcards, so the slot carries the type operators
 * that modify a type in place instead. Same position, different language.
 */
export enum TsTypeRefVariance {
  READONLY = 'READONLY',
  UNIQUE = 'UNIQUE',
}
