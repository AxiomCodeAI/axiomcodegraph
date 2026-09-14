/**
 * Which comprehension form a node is, occupying Java's `methodReferenceKind`
 * column position.
 *
 * The `ASYNC_*` variants are separate because an `async for` comprehension
 * produces an async generator, so its results arrive by `await` rather than by
 * iteration.
 *
 * Schema v6 §2.15 c11.
 */
export enum PythonComprehensionKind {
  LIST = 'LIST',
  SET = 'SET',
  DICT = 'DICT',
  GENERATOR = 'GENERATOR',
  ASYNC_LIST = 'ASYNC_LIST',
  ASYNC_SET = 'ASYNC_SET',
  ASYNC_DICT = 'ASYNC_DICT',
  ASYNC_GENERATOR = 'ASYNC_GENERATOR',
  /** Not a comprehension. */
  NONE = 'NONE',
}
