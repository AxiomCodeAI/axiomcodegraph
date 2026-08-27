/**
 * Which side of its operand a unary operator was written on.
 *
 * Load-bearing for exactly one pair, where the fixity changes the VALUE of the
 * expression rather than its formatting:
 *
 * ```ts
 * const a = i++;   // POSTFIX — `a` is the value BEFORE the increment
 * const b = ++i;   // PREFIX  — `b` is the value AFTER it
 * ```
 *
 * Schema §4.14 c12.
 */
export enum TsUnaryFixity {
  /** `++i`, `-x`, `!x` — the operator precedes the operand. */
  PREFIX = 'PREFIX',
  /** `i++`, `i--` — the operator follows it, and the value is the one before. */
  POSTFIX = 'POSTFIX',
}
