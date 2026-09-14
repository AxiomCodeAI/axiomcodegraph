/**
 * What `ts_expression.expressionOwnerHash` points at.
 *
 * The owner FK is polymorphic, so this column tells a consumer which relation to
 * join. It is also how caller attribution survives: an expression inside a block
 * is owned by the block, and the chain `ts_block -> ts_method -> ts_type ->
 * ts_module` reaches the enclosing function from there.
 *
 * That chain is why there is no `ts_scope` relation. Measured: 34,798 identifier
 * references, and the chain reaches **every one** with zero unreachable — so a
 * scope table would carry no information the FKs do not already carry.
 *
 * `MODULE_INIT` is the owner of top-level executable code, via the synthetic
 * `<module>` method. Every expression has an owner; there is no orphan.
 *
 * Schema §4.14 c3, ruling OQ-6.
 */
export enum TsExpressionOwnerKind {
  /** A function-shaped declaration's body, outside any block. */
  METHOD = 'METHOD',
  /** A member initializer. */
  FIELD = 'FIELD',
  /** A variable initializer. */
  VARIABLE = 'VARIABLE',
  /** A statement block — the usual owner inside a function. */
  BLOCK = 'BLOCK',
  /** A type declaration, for a heritage expression. */
  TYPE = 'TYPE',
  /** The synthetic `<module>` initializer: top-level executable code. */
  MODULE_INIT = 'MODULE_INIT',
  /** A decorator expression. */
  DECORATOR = 'DECORATOR',
  /** `export default <expr>`. */
  EXPORT = 'EXPORT',
  /** An enum member's initializer. */
  ENUM_MEMBER = 'ENUM_MEMBER',
  /** A parameter default. */
  PARAMETER_DEFAULT = 'PARAMETER_DEFAULT',
}
