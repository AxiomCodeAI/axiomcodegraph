/**
 * The statement form an expression tree's root sits in.
 *
 * The Python-specific value that earns its place is
 * `MODULE_LEVEL_STATEMENT`: module-level code runs at **import** time, so it is
 * reachable from every importer, which makes it different in kind from a
 * statement inside a function.
 *
 * Schema v6 §2.15 c2.
 */
export enum PythonRootContext {
  /** A bare expression statement. */
  EXPRESSION_STATEMENT = 'EXPRESSION_STATEMENT',

  /** The right-hand side of an assignment. */
  ASSIGNMENT_VALUE = 'ASSIGNMENT_VALUE',

  /** An assignment target. */
  ASSIGNMENT_TARGET = 'ASSIGNMENT_TARGET',

  /** An augmented assignment, `x += 1`. */
  AUGMENTED_ASSIGNMENT = 'AUGMENTED_ASSIGNMENT',

  /** A variable annotation, `x: int`. */
  ANNOTATED_ASSIGNMENT = 'ANNOTATED_ASSIGNMENT',

  RETURN_VALUE = 'RETURN_VALUE',
  YIELD_VALUE = 'YIELD_VALUE',

  IF_CONDITION = 'IF_CONDITION',
  WHILE_CONDITION = 'WHILE_CONDITION',
  ASSERT_CONDITION = 'ASSERT_CONDITION',
  ASSERT_MESSAGE = 'ASSERT_MESSAGE',

  FOR_TARGET = 'FOR_TARGET',
  FOR_ITERABLE = 'FOR_ITERABLE',

  WITH_CONTEXT = 'WITH_CONTEXT',
  WITH_TARGET = 'WITH_TARGET',

  RAISE_VALUE = 'RAISE_VALUE',
  EXCEPT_TYPE = 'EXCEPT_TYPE',

  DELETE_TARGET = 'DELETE_TARGET',

  DECORATOR = 'DECORATOR',
  BASE_CLASS_LIST = 'BASE_CLASS_LIST',
  DEFAULT_VALUE = 'DEFAULT_VALUE',
  ANNOTATION = 'ANNOTATION',

  MATCH_SUBJECT = 'MATCH_SUBJECT',
  CASE_PATTERN = 'CASE_PATTERN',
  CASE_GUARD = 'CASE_GUARD',

  /** A statement at module level — executed at import time. */
  MODULE_LEVEL_STATEMENT = 'MODULE_LEVEL_STATEMENT',

  /** A statement in a class body — executed when the class is created. */
  CLASS_BODY_STATEMENT = 'CLASS_BODY_STATEMENT',

  /** The body expression of a lambda. */
  LAMBDA_BODY = 'LAMBDA_BODY',

  /** Inside a comprehension. */
  COMPREHENSION = 'COMPREHENSION',

  /** A print/format-style statement with no more specific context. */
  OTHER_STATEMENT = 'OTHER_STATEMENT',
}
