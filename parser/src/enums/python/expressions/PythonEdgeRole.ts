/**
 * An expression's role in its parent — the edge label of the expression tree.
 *
 * ## Why `RECEIVER` and not `ATTRIBUTE_OBJECT` on calls
 *
 * `RECEIVER` is kept as the role for the object of a `CALL` specifically, so
 * that `call-site.dl`'s existing `java_expression(_, "RECEIVER", …)` pattern
 * ports unchanged. `ATTRIBUTE_OBJECT` is used for a plain attribute read that is
 * not being called. The distinction is worth the extra value: 50.7% of attribute
 * calls have a bare name as the receiver, and that is the single highest-value
 * resolution path in the schema.
 *
 * Schema v6 §2.15 c1.
 */
export enum PythonEdgeRole {
  /** The root of an expression tree — no parent expression. */
  ROOT = 'ROOT',

  /** The callee of a call: the `f` in `f(x)`. */
  CALLEE = 'CALLEE',

  /** The receiver of a call: the `obj` in `obj.m()`. */
  RECEIVER = 'RECEIVER',

  /** A positional argument. */
  ARGUMENT = 'ARGUMENT',

  /** The value of a `k=v` argument; the name is in `argumentKeywordName`. */
  KEYWORD_ARGUMENT = 'KEYWORD_ARGUMENT',

  /** The `x` in `f(*x)`. */
  STAR_ARGUMENT = 'STAR_ARGUMENT',

  /** The `x` in `f(**x)`. */
  DOUBLE_STAR_ARGUMENT = 'DOUBLE_STAR_ARGUMENT',

  /** The object of an attribute read that is not being called. */
  ATTRIBUTE_OBJECT = 'ATTRIBUTE_OBJECT',

  SUBSCRIPT_OBJECT = 'SUBSCRIPT_OBJECT',
  SUBSCRIPT_INDEX = 'SUBSCRIPT_INDEX',
  SLICE_LOWER = 'SLICE_LOWER',
  SLICE_UPPER = 'SLICE_UPPER',
  SLICE_STEP = 'SLICE_STEP',

  ASSIGNMENT_TARGET = 'ASSIGNMENT_TARGET',
  ASSIGNMENT_VALUE = 'ASSIGNMENT_VALUE',

  ANNOTATION = 'ANNOTATION',
  DEFAULT_VALUE = 'DEFAULT_VALUE',
  DECORATOR_EXPR = 'DECORATOR_EXPR',
  BASE_CLASS = 'BASE_CLASS',

  CONDITION = 'CONDITION',
  BODY = 'BODY',
  ORELSE = 'ORELSE',

  OPERAND_LEFT = 'OPERAND_LEFT',
  OPERAND_RIGHT = 'OPERAND_RIGHT',
  UNARY_OPERAND = 'UNARY_OPERAND',

  COMPREHENSION_ELEMENT = 'COMPREHENSION_ELEMENT',
  COMPREHENSION_ITERABLE = 'COMPREHENSION_ITERABLE',
  COMPREHENSION_TARGET = 'COMPREHENSION_TARGET',
  COMPREHENSION_CONDITION = 'COMPREHENSION_CONDITION',

  FSTRING_EXPRESSION = 'FSTRING_EXPRESSION',

  RETURN_VALUE = 'RETURN_VALUE',
  YIELD_VALUE = 'YIELD_VALUE',
  AWAIT_OPERAND = 'AWAIT_OPERAND',

  WITH_CONTEXT = 'WITH_CONTEXT',
  WITH_TARGET = 'WITH_TARGET',

  EXCEPT_TYPE = 'EXCEPT_TYPE',
  EXCEPT_TARGET = 'EXCEPT_TARGET',

  RAISE_EXC = 'RAISE_EXC',
  RAISE_CAUSE = 'RAISE_CAUSE',

  LAMBDA_BODY = 'LAMBDA_BODY',

  MATCH_SUBJECT = 'MATCH_SUBJECT',
  MATCH_PATTERN = 'MATCH_PATTERN',
}
