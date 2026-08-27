/**
 * `ts_type_heritage` enums — schema §4.3.
 *
 * The one column Java does not need is `inheritsMembers`, and these enums exist
 * to keep it honest: 60.4% of classes satisfy their interfaces with no
 * `implements` clause at all, so an `IMPLEMENTS_CLAUSE` row is a record of
 * SYNTAX, never a subtyping edge.
 */

/** `ts_type_heritage` c0. */
export enum TsHeritageKind {
  EXTENDS_CLASS = 'EXTENDS_CLASS',
  EXTENDS_INTERFACE = 'EXTENDS_INTERFACE',
  IMPLEMENTS_CLAUSE = 'IMPLEMENTS_CLAUSE',
  /** A mixin: `class C extends mixin(Base) {}` — a computed base the parser cannot name. */
  EXTENDS_EXPRESSION = 'EXTENDS_EXPRESSION',
  EXTENDS_TYPE_LITERAL = 'EXTENDS_TYPE_LITERAL',
}

/** `ts_type_heritage` c1 — in the primary key, so it may never be derived from c0. */
export enum TsClauseToken {
  EXTENDS = 'EXTENDS',
  IMPLEMENTS = 'IMPLEMENTS',
}
