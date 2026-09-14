/**
 * What `ts_type_reference.typeReferenceOwnerHash` points at.
 *
 * The owner FK is polymorphic — a type reference can be owned by a field, a
 * parameter, a heritage clause, an expression or another type reference — so a
 * consumer needs this column to know which relation to join against. Java's
 * `ReferenceOwnerKind` carries the same discriminator for the same reason.
 *
 * Schema §4.5 c16.
 */
export enum TsReferenceOwnerKind {
  /** A type declaration: a type alias RHS, a class's type parameter bound. */
  TYPE = 'TYPE',
  /** A function-shaped declaration: its return type. */
  METHOD = 'METHOD',
  /** A formal parameter's annotation, including an arrow's. */
  METHOD_PARAM = 'METHOD_PARAM',
  /** A member's annotation. */
  FIELD = 'FIELD',
  /** A variable's annotation. */
  VARIABLE = 'VARIABLE',
  /** A type parameter's bound or default. */
  TYPE_PARAMETER = 'TYPE_PARAMETER',
  /** An expression: `as T`, `instanceof C`, `new C<T>()`, `f<T>()`. */
  EXPRESSION = 'EXPRESSION',
  /** A decorator: the type it names, or a type in its arguments. */
  DECORATOR = 'DECORATOR',
  /** A heritage clause entry — the twin that feeds the shared name resolver. */
  HERITAGE = 'HERITAGE',
  /** Another type reference — a child in a composite type node. */
  TYPE_REFERENCE = 'TYPE_REFERENCE',
  /** An enum member. */
  ENUM_MEMBER = 'ENUM_MEMBER',
  /** An export clause. */
  EXPORT = 'EXPORT',
  /** The module itself. */
  MODULE = 'MODULE',
}
