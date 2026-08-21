/**
 * The kind of a Python expression node.
 *
 * ## There is deliberately no `OBJECT_CREATION`
 *
 * This is the one omission worth explaining, because Java has it and its
 * absence is a modelling decision rather than an oversight. Python has no `new`:
 * `User(1)` and `helper(1)` are the *same syntax*, and which one constructs an
 * object depends on whether `User` happens to name a class — which is exactly
 * the question the engine exists to answer. Splitting them in the parser would
 * mean guessing, and guessing wrong produces a call graph that looks precise and
 * is not. So every call is a `CALL`, and `py_call_site.resolvedCalleeKind`
 * records what we could honestly determine.
 *
 * Schema v6 §2.15 c0, §4.5.
 */
export enum PythonExpressionKind {
  /** Any call, including construction — see the note above. */
  CALL = 'CALL',

  /** `obj.attr`. */
  ATTRIBUTE_ACCESS = 'ATTRIBUTE_ACCESS',

  /** `obj[key]`. */
  SUBSCRIPT = 'SUBSCRIPT',

  /** `obj[a:b:c]`. */
  SLICE = 'SLICE',

  /** A bare name in load, store, or del position. */
  NAME_REFERENCE = 'NAME_REFERENCE',

  /** A literal — see `literalType` for which. */
  LITERAL = 'LITERAL',

  /** An f-string as a whole. */
  FSTRING = 'FSTRING',

  /** One `{...}` interpolation inside an f-string. */
  FSTRING_INTERPOLATION = 'FSTRING_INTERPOLATION',

  TUPLE = 'TUPLE',
  LIST = 'LIST',
  SET = 'SET',
  DICT = 'DICT',

  LIST_COMPREHENSION = 'LIST_COMPREHENSION',
  SET_COMPREHENSION = 'SET_COMPREHENSION',
  DICT_COMPREHENSION = 'DICT_COMPREHENSION',
  GENERATOR_EXPRESSION = 'GENERATOR_EXPRESSION',

  LAMBDA = 'LAMBDA',

  /** `a if cond else b`. */
  CONDITIONAL_EXPRESSION = 'CONDITIONAL_EXPRESSION',

  /** An arithmetic or bitwise operation. */
  BINARY_OPERATION = 'BINARY_OPERATION',

  /** `-x`, `not x`, `~x`. */
  UNARY_OPERATION = 'UNARY_OPERATION',

  /** `and` / `or`, which short-circuit and so do not always evaluate both sides. */
  BOOLEAN_OPERATION = 'BOOLEAN_OPERATION',

  /** `==`, `is not`, `not in`, and chained comparisons. */
  COMPARISON = 'COMPARISON',

  /** The walrus, `x := f()`. */
  ASSIGNMENT_EXPRESSION = 'ASSIGNMENT_EXPRESSION',

  /** `*x` in a call or literal. */
  STARRED = 'STARRED',

  /** `**x` in a call or literal. */
  DOUBLE_STARRED = 'DOUBLE_STARRED',

  AWAIT = 'AWAIT',
  YIELD = 'YIELD',
  YIELD_FROM = 'YIELD_FROM',

  ASSIGNMENT = 'ASSIGNMENT',
  AUGMENTED_ASSIGNMENT = 'AUGMENTED_ASSIGNMENT',
  ANNOTATED_ASSIGNMENT = 'ANNOTATED_ASSIGNMENT',

  /** A reference to the receiver parameter — usually but not always `self`. */
  SELF_REFERENCE = 'SELF_REFERENCE',

  /** A reference to a `classmethod`'s receiver — usually `cls`. */
  CLS_REFERENCE = 'CLS_REFERENCE',

  /** A `match` / `case` pattern. */
  MATCH_PATTERN = 'MATCH_PATTERN',

  /** `...`. */
  ELLIPSIS = 'ELLIPSIS',
}
