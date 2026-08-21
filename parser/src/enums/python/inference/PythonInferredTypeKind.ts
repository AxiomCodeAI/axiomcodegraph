/**
 * What KIND of type an expression was inferred to have.
 *
 * Coarser than the type name on purpose. A rule that asks "is this a container?"
 * should not have to know the difference between `list`, `set` and `dict`, and a
 * rule that asks "is this a project class?" should not have to carry a list of
 * builtin names.
 *
 * Schema v7 §2.15 c34.
 */
export enum PythonInferredTypeKind {
  /** `int`, `str`, `float`, `bool`, `bytes`, `complex`. */
  BUILTIN_SCALAR = 'BUILTIN_SCALAR',
  /** `list`, `dict`, `set`, `tuple`, `frozenset`. */
  BUILTIN_COLLECTION = 'BUILTIN_COLLECTION',
  /** A class declared in the analysed code. */
  USER_CLASS = 'USER_CLASS',
  /** `None` — its own kind, because `Optional` handling turns on it. */
  NONE_TYPE = 'NONE_TYPE',
  /** A function, lambda or bound method. */
  CALLABLE = 'CALLABLE',
  /** Nothing derivable. */
  UNKNOWN = 'UNKNOWN',
}
