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

  /**
   * An element of a list, set or tuple DISPLAY — `a` and `b` in `[a, b]`.
   *
   * Added because these previously wore {@link ARGUMENT}, which was the closest
   * available value and still wrong: 17% of argument-role rows on a real corpus
   * were collection elements, so any rule joining `edgeRole = ARGUMENT` to a call
   * site picked them up unless it also tested the parent's kind. An element of a
   * list passed to a call is not an argument of that call — `f([a, b])` has ONE
   * argument.
   *
   * `position` is the element's index within its display.
   */
  ELEMENT = 'ELEMENT',

  /**
   * The key half of a dict entry — `k` in `{k: v}`.
   *
   * Split from {@link VALUE} because without it a dict's entries are not merely
   * mislabelled, they are unpaired AND unordered: `{k: v, k2: v2}` emitted `k`
   * and `k2` both at position 0 and `v` and `v2` both at position 1, so
   * `position` — documented as the ordinal among siblings in the same edgeRole —
   * identified nothing. With the roles split, `position` is the ENTRY index, so
   * key and value of one entry share it and the pairing is recoverable.
   */
  KEY = 'KEY',

  /** The value half of a dict entry. See {@link KEY}. */
  VALUE = 'VALUE',

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
