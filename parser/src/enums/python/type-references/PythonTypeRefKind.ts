/**
 * The syntactic form of a type reference.
 *
 * Distinguishes the shapes that a resolver has to treat differently, rather than
 * flattening everything to "a name". `UNION_PEP604` and `OPTIONAL` are separate
 * from `SUBSCRIPT` because both admit more than one type at the same position,
 * which is the case that breaks a naive "the annotation is the type" assumption.
 *
 * ## Examples
 *
 * ```python
 * x: User                    # NAME
 * x: app.models.User         # DOTTED_NAME
 * x: Dict[str, User]         # SUBSCRIPT, with two children
 * x: int | None              # UNION_PEP604
 * x: Optional[User]          # OPTIONAL — the #1 subscript, 3,517 in the corpus
 * x: "User"                  # STRING_FORWARD_REF
 * x: Literal["a", "b"]       # LITERAL_TYPE
 * x: Callable[[int], str]    # CALLABLE
 * x: Tuple[int, str]         # TUPLE_TYPE
 * x: T                       # TYPE_VAR
 * ```
 *
 * Schema v6 §2.6 c0.
 */
export enum PythonTypeRefKind {
  /** A bare name. */
  NAME = 'NAME',
  /** A dotted path. */
  DOTTED_NAME = 'DOTTED_NAME',
  /** A subscripted generic; its arguments are child references. */
  SUBSCRIPT = 'SUBSCRIPT',
  /** PEP 604 `A | B`. */
  UNION_PEP604 = 'UNION_PEP604',
  /** `Optional[X]` — admits `None`, so `isOptional` is set alongside. */
  OPTIONAL = 'OPTIONAL',
  /** A quoted forward reference. */
  STRING_FORWARD_REF = 'STRING_FORWARD_REF',
  /** `Literal[...]` — the arguments are values, not types. */
  LITERAL_TYPE = 'LITERAL_TYPE',
  /** `Callable[[...], R]`. */
  CALLABLE = 'CALLABLE',
  /** `Tuple[...]`. */
  TUPLE_TYPE = 'TUPLE_TYPE',
  /** A `TypeVar`. */
  TYPE_VAR = 'TYPE_VAR',
  /** `Any` — explicitly unconstrained, which is different from unknown. */
  ANY = 'ANY',
  /** `None` in a type position. */
  NONE_TYPE = 'NONE_TYPE',
  /** `...` in a type position, as in `Callable[..., R]`. */
  ELLIPSIS_TYPE = 'ELLIPSIS_TYPE',
  /** Any other expression appearing in a type position. */
  UNKNOWN = 'UNKNOWN',
}
