/**
 * Where a type reference appears — the question `py_expression.edgeRole` cannot
 * answer.
 *
 * This is the column that makes a type reference queryable by role: "every type
 * used as a method return", "every type in an isinstance guard". `edgeRole` only
 * separates `ANNOTATION` from everything else, so without this the distinction
 * between a parameter type, a return type and a narrowing guard is lost.
 *
 * `ISINSTANCE_TYPE` earns its place on measurement: 2,123 `isinstance` sites in
 * the corpus, and they are the main type-narrowing lever the engine has.
 *
 * Schema v6 §2.6 c1.
 */
export enum PythonTypeRefContext {
  /** A positional base in a class statement. */
  BASE_CLASS = 'BASE_CLASS',
  /** The `metaclass=` keyword argument. */
  METACLASS = 'METACLASS',
  /** A parameter annotation. */
  METHOD_PARAM = 'METHOD_PARAM',
  /** A `->` return annotation. */
  METHOD_RETURN = 'METHOD_RETURN',
  /** An attribute's declared type. */
  FIELD_TYPE = 'FIELD_TYPE',
  /** A variable annotation, `x: int`. */
  VARIABLE_ANNOTATION = 'VARIABLE_ANNOTATION',
  /** The target of `typing.cast`. */
  CAST_TARGET = 'CAST_TARGET',
  /** The second argument of `isinstance` — the narrowing lever. */
  ISINSTANCE_TYPE = 'ISINSTANCE_TYPE',
  /** The second argument of `issubclass`. */
  ISSUBCLASS_TYPE = 'ISSUBCLASS_TYPE',
  /** A type in an `except` clause. */
  EXCEPT_TYPE = 'EXCEPT_TYPE',
  /** A type in a `raise` statement. */
  RAISE_TYPE = 'RAISE_TYPE',
  /** The right-hand side of a type alias. */
  TYPE_ALIAS = 'TYPE_ALIAS',
  /** A `TypeVar` bound. */
  TYPEVAR_BOUND = 'TYPEVAR_BOUND',
  /** An argument inside a subscripted generic — a CHILD reference. */
  GENERIC_ARGUMENT = 'GENERIC_ARGUMENT',
  /** Part of an `@overload` signature. */
  OVERLOAD_SIGNATURE = 'OVERLOAD_SIGNATURE',
  /** Recovered from a PEP 484 `# type:` comment. */
  TYPE_COMMENT = 'TYPE_COMMENT',
}
