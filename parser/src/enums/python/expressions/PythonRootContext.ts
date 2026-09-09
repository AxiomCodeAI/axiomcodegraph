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

  /**
   * `async for x in obj` — a DIFFERENT protocol from `for`, not a variant of it.
   *
   * `for` calls `obj.__iter__` / `__next__`; `async for` calls `obj.__aiter__` /
   * `__anext__`. ast has two node types for exactly this reason, and the two forms shared
   * `FOR_ITERABLE` here, so a consumer emitting the iteration-protocol edge had to choose
   * between fabricating `__iter__` on every `async for` and emitting nothing at all.
   *
   * The enclosing function does NOT decide it — an `async def` contains plain `for` loops
   * too — and neither does the block row: the iterable expression is owned by the METHOD,
   * not by the `ASYNC_FOR` block, so there is no join that recovers it.
   *
   * Async is a distinct enum member here for the same reason it is one in
   * `PythonBlockKind` (`ASYNC_FOR`), `PythonMethodKind` (`ASYNC_FUNCTION`) and
   * `PythonComprehensionKind` (`ASYNC_LIST`): the kind says what the construct IS.
   */
  ASYNC_FOR_TARGET = 'ASYNC_FOR_TARGET',
  ASYNC_FOR_ITERABLE = 'ASYNC_FOR_ITERABLE',

  WITH_CONTEXT = 'WITH_CONTEXT',
  WITH_TARGET = 'WITH_TARGET',

  /**
   * `async with cm` — `__aenter__` / `__aexit__`, where `with` is `__enter__` / `__exit__`.
   *
   * The same distinction as `ASYNC_FOR_ITERABLE`, and it was missing for the same reason.
   */
  ASYNC_WITH_CONTEXT = 'ASYNC_WITH_CONTEXT',
  ASYNC_WITH_TARGET = 'ASYNC_WITH_TARGET',

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
