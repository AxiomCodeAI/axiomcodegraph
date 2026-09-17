/**
 * What a child expression IS TO ITS PARENT — `cs_expression.edgeRole`.
 *
 * This is the half of §3's rule that is easy to skip. A wrapper node with
 * children is not enough: without a role, `a.B(c)` gives an engine three
 * children and no way to say which is the receiver, which is the callee name
 * and which is the argument. The parts would be right and the structure absent,
 * which is the defect the wrapper was introduced to fix.
 */
export enum CsEdgeRole {
  /** The expression is a root — its parent is a declaration, not an expression. */
  ROOT = 'ROOT',

  /** `a` in `a.B()` — the thing the member is looked up ON. */
  RECEIVER = 'RECEIVER',
  /** `A.B` in `A.B.C` — a namespace or type qualifier rather than a value. */
  QUALIFIER = 'QUALIFIER',
  ARGUMENT = 'ARGUMENT',
  /** `B` in `a.B()`. Separate from ARGUMENT so a callee is never counted as one. */
  METHOD_NAME = 'METHOD_NAME',
  MEMBER_NAME = 'MEMBER_NAME',
  INDEX_ARGUMENT = 'INDEX_ARGUMENT',

  LEFT_OPERAND = 'LEFT_OPERAND',
  RIGHT_OPERAND = 'RIGHT_OPERAND',
  UNARY_OPERAND = 'UNARY_OPERAND',

  /** `x` in `x = y`. The role that makes `a += 1; b += 2` pairable. */
  ASSIGNMENT_TARGET = 'ASSIGNMENT_TARGET',
  ASSIGNMENT_VALUE = 'ASSIGNMENT_VALUE',

  CONDITION = 'CONDITION',
  WHEN_TRUE = 'WHEN_TRUE',
  WHEN_FALSE = 'WHEN_FALSE',

  CAST_OPERAND = 'CAST_OPERAND',
  PATTERN_OPERAND = 'PATTERN_OPERAND',
  SWITCH_GOVERNING = 'SWITCH_GOVERNING',
  SWITCH_ARM_PATTERN = 'SWITCH_ARM_PATTERN',
  SWITCH_ARM_GUARD = 'SWITCH_ARM_GUARD',
  SWITCH_ARM_RESULT = 'SWITCH_ARM_RESULT',

  /** The subject of a `with` — the record being COPIED, not mutated. */
  WITH_OPERAND = 'WITH_OPERAND',
  INITIALIZER_TARGET = 'INITIALIZER_TARGET',
  INITIALIZER_VALUE = 'INITIALIZER_VALUE',

  LAMBDA_BODY = 'LAMBDA_BODY',
  INTERPOLATION_CONTENT = 'INTERPOLATION_CONTENT',
  INTERPOLATION_ALIGNMENT = 'INTERPOLATION_ALIGNMENT',
  COLLECTION_ELEMENT = 'COLLECTION_ELEMENT',
  SPREAD_OPERAND = 'SPREAD_OPERAND',
  TUPLE_ELEMENT = 'TUPLE_ELEMENT',
  RANGE_START = 'RANGE_START',
  RANGE_END = 'RANGE_END',

  /**
   * The LENGTH in `new byte[Len(n)]` or `stackalloc byte[Len(n)]`.
   *
   * It is a position of its own and not a ROOT child, because the array's
   * element TYPE and its LENGTH are different facts about the same expression
   * and an engine reading `new byte[Count()]` needs to know which one `Count()`
   * is. One per dimension, in source order, so `new byte[W(), H()]` says which
   * is which.
   *
   * It exists because the length is not where an expression walk looks. It
   * hangs under the array_creation's TYPE — `array_type > array_rank_specifier`
   * — and a type is not an expression, so the subtree died before its children
   * were enqueued. 90 call sites in the BCL stratum alone.
   */
  ARRAY_SIZE = 'ARRAY_SIZE',

  /** The child of a parenthesis. The parenthesis emits a row; the child hangs here. */
  PARENTHESIZED_OPERAND = 'PARENTHESIZED_OPERAND',
  AWAIT_OPERAND = 'AWAIT_OPERAND',
  /** The operand of `nameof`, which is NEVER EVALUATED — a compile-time string. */
  NAMEOF_OPERAND = 'NAMEOF_OPERAND',
  THROW_OPERAND = 'THROW_OPERAND',
  QUERY_CLAUSE = 'QUERY_CLAUSE',
}
