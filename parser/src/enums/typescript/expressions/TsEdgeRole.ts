/**
 * The edge from a parent expression to a child. In the PRIMARY KEY.
 *
 * In the key alongside `position` because two children of one parent can share
 * an index in different roles: a binary node's left and right operands are both
 * position 0 of their own role, and a call's callee and first argument likewise.
 *
 * ## The shape of a method call, which every resolution rule reads
 *
 * ```ts
 * a.b(c, d)
 * ```
 *
 * ```
 * CALL_EXPRESSION
 *   METHOD_NAME  → PROPERTY_ACCESS  (a.b)
 *                    RECEIVER       → IDENTIFIER_REFERENCE (a)
 *                    PROPERTY_NAME  → IDENTIFIER_REFERENCE (b)
 *   ARGUMENT 0   → IDENTIFIER_REFERENCE (c)
 *   ARGUMENT 1   → IDENTIFIER_REFERENCE (d)
 * ```
 *
 * `ts_call_site.receiverExpressionLinkHash` points at the RECEIVER — the
 * callee's child, and therefore the call's grandchild. That is why call sites are
 * emitted in a second pass, once every expression row exists.
 *
 * ## ROOT is not a child edge
 *
 * It marks the top of a tree, where `parentExpressionHash` is `""`. Every other
 * member implies a parent.
 *
 * Schema §4.14 c1.
 */
export enum TsEdgeRole {
  /** The top of an expression tree. `parentExpressionHash` is empty. */
  ROOT = 'ROOT',
  /** The object a member is read from: `a` in `a.b`. */
  RECEIVER = 'RECEIVER',
  /** A namespace or type qualifier in a dotted path. */
  QUALIFIER = 'QUALIFIER',
  /** A call or `new` argument. `position` is the argument index. */
  ARGUMENT = 'ARGUMENT',
  /** The callee of a call — an identifier, a property access, or a function expression. */
  METHOD_NAME = 'METHOD_NAME',
  /** The member being read: `b` in `a.b`. */
  PROPERTY_NAME = 'PROPERTY_NAME',
  /** The index of an element access: `i` in `a[i]`. */
  INDEX_ARGUMENT = 'INDEX_ARGUMENT',
  /** The left operand of a binary or assignment node. */
  LEFT_OPERAND = 'LEFT_OPERAND',
  /** The right operand. */
  RIGHT_OPERAND = 'RIGHT_OPERAND',
  /** The condition of a ternary. */
  TERNARY_CONDITION = 'TERNARY_CONDITION',
  /** The `?` branch. */
  TERNARY_THEN = 'TERNARY_THEN',
  /** The `:` branch. */
  TERNARY_ELSE = 'TERNARY_ELSE',
  /** The operand of a unary, `await`, `yield`, `delete`, `typeof`, `void` or `!`. */
  UNARY_OPERAND = 'UNARY_OPERAND',
  /** The value being cast: `x` in `x as T`. */
  AS_OPERAND = 'AS_OPERAND',
  /** The value being checked: `x` in `x satisfies T`. */
  SATISFIES_OPERAND = 'SATISFIES_OPERAND',
  /** The operand of `...x`. */
  SPREAD_OPERAND = 'SPREAD_OPERAND',
  /** An interpolated expression inside a template. */
  TEMPLATE_SPAN = 'TEMPLATE_SPAN',
  /** A concise arrow body — an expression, not a block. */
  ARROW_BODY = 'ARROW_BODY',
  /** The value of an object-literal property. */
  OBJECT_PROPERTY_VALUE = 'OBJECT_PROPERTY_VALUE',
  /** An element of an array literal. */
  ARRAY_ELEMENT = 'ARRAY_ELEMENT',
  /** The tag of a tagged template — the thing being called. */
  TAG_EXPRESSION = 'TAG_EXPRESSION',
  /** RESERVED for TSX. Carries zero rows in freeze 1. */
  JSX_ATTRIBUTE_VALUE = 'JSX_ATTRIBUTE_VALUE',
  /** RESERVED for TSX. Carries zero rows in freeze 1. */
  JSX_CHILD = 'JSX_CHILD',
}
