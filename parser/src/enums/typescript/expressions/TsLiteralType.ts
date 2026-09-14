/**
 * The kind of a literal expression.
 *
 * Non-empty exactly when `ts_expression.kind` is `LITERAL`,
 * `TEMPLATE_EXPRESSION`, or an identifier spelling `undefined` — which the
 * grammar calls an identifier and every reader calls a literal. Recording it as
 * one is what lets an optionality rule see it.
 *
 * `NO_SUBSTITUTION_TEMPLATE` is separated from `TEMPLATE` because the first is a
 * constant string and the second interpolates: only one of them can be a literal
 * type, and only one of them evaluates its operands.
 *
 * Schema §4.14 c9.
 */
export enum TsLiteralType {
  /** `"a"` or `'a'`. */
  STRING = 'STRING',
  /** `42`, `0x1f`, `1_000`. */
  NUMBER = 'NUMBER',
  /** `42n`. */
  BIGINT = 'BIGINT',
  /** `true` or `false`. */
  BOOLEAN = 'BOOLEAN',
  /** `null`. */
  NULL = 'NULL',
  /** `undefined` — an identifier in the grammar, a literal in practice. */
  UNDEFINED = 'UNDEFINED',
  /** `/re/g`. */
  REGEX = 'REGEX',
  /** `` `a${b}` `` — interpolates, so it evaluates its spans. */
  TEMPLATE = 'TEMPLATE',
  /** `` `a` `` — a constant string, and usable as a literal type. */
  NO_SUBSTITUTION_TEMPLATE = 'NO_SUBSTITUTION_TEMPLATE',
}
