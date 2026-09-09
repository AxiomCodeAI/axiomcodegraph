/**
 * The **syntactic form** that created a binding, as distinct from the resolved
 * scope outcome in `PythonBindingKind`.
 *
 * Two columns rather than one because they answer different questions: origin is
 * what the source says, kind is what CPython decided. A name bound by several
 * different forms in one scope gets `MULTIPLE`.
 *
 * ## Examples
 *
 * ```python
 * x = 1                       # ASSIGNMENT
 * x += 1                      # AUGMENTED_ASSIGNMENT
 * x: int = 1                  # ANNOTATED_ASSIGNMENT
 * x: int                      # ANNOTATION_ONLY  (still binds, on 3.10)
 * for x in xs: ...            # FOR_TARGET
 * with open(p) as x: ...      # WITH_TARGET
 * except E as x: ...          # EXCEPT_TARGET
 * [x for x in xs]             # COMPREHENSION_TARGET
 * if (x := f()): ...          # WALRUS
 * a, *b = xs                  # TUPLE_UNPACK_TARGET / STAR_TARGET
 * match p:
 *     case [x]: ...           # MATCH_CAPTURE
 * ```
 *
 * Schema v6 §2.3 c3.
 */
export enum PythonBindingOrigin {
  /** A plain `=` assignment. */
  ASSIGNMENT = 'ASSIGNMENT',

  /** An augmented assignment such as `x += 1`. Binds without referencing. */
  AUGMENTED_ASSIGNMENT = 'AUGMENTED_ASSIGNMENT',

  /** An annotated assignment with a value — `x: int = 1`. */
  ANNOTATED_ASSIGNMENT = 'ANNOTATED_ASSIGNMENT',

  /** A bare annotation — `x: int`. On 3.10 this still marks the name local. */
  ANNOTATION_ONLY = 'ANNOTATION_ONLY',

  /** A `def` / `async def` statement binding its own name. */
  FUNCTION_DEF = 'FUNCTION_DEF',

  /** A `class` statement binding its own name. */
  CLASS_DEF = 'CLASS_DEF',

  /** An `import` or `from ... import` statement. */
  IMPORT = 'IMPORT',

  /** A `for` loop target. */
  FOR_TARGET = 'FOR_TARGET',

  /** A `with ... as` target. */
  WITH_TARGET = 'WITH_TARGET',

  /** An `except ... as` target. Unbound and deleted at the end of the handler. */
  EXCEPT_TARGET = 'EXCEPT_TARGET',

  /** A comprehension's iteration target. */
  COMPREHENSION_TARGET = 'COMPREHENSION_TARGET',

  /** A `:=` assignment expression. Binds in the *enclosing* scope from a comprehension. */
  WALRUS = 'WALRUS',

  /** A `global` statement. */
  GLOBAL_STMT = 'GLOBAL_STMT',

  /** A `nonlocal` statement. */
  NONLOCAL_STMT = 'NONLOCAL_STMT',

  /** A function or lambda parameter, including the synthetic `.0`. */
  PARAMETER = 'PARAMETER',

  /** A `del` statement. Binds the name locally, then unbinds it. */
  DEL = 'DEL',

  /** A `match` / `case` capture pattern. */
  MATCH_CAPTURE = 'MATCH_CAPTURE',

  /** A starred target in an unpacking assignment — the `*b` in `a, *b = xs`. */
  STAR_TARGET = 'STAR_TARGET',

  /** A target inside a tuple or list unpacking. */
  TUPLE_UNPACK_TARGET = 'TUPLE_UNPACK_TARGET',

  /** A lambda parameter, where distinguishing it from a `def` parameter matters. */
  LAMBDA_PARAM = 'LAMBDA_PARAM',

  /** A PEP 695 `type` alias name (3.12). Deferred — declared for forward parity. */
  /**
   * A PEP 695 type parameter: the `T` in `class C[T]`, `def f[T]` or `type A[T] = …`.
   *
   * Distinct from `PARAMETER`, which is a function parameter and binds a runtime value. A
   * type parameter binds a `TypeVar` / `TypeVarTuple` / `ParamSpec` object in the annotation
   * scope that wraps the class or function, and is visible to annotations and bases that a
   * function parameter is not.
   */
  TYPE_PARAM = 'TYPE_PARAM',

  TYPE_ALIAS = 'TYPE_ALIAS',

  /** The name is bound by more than one distinct form in this scope. */
  MULTIPLE = 'MULTIPLE',
}
