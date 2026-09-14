/**
 * The syntactic shape of one entry in a class's base list.
 *
 * Bases are **ordered** (C3 depends on it) and can be arbitrary expressions,
 * while `metaclass=` and `total=` are syntactically in the same list but
 * semantically are not bases at all — which is why this is its own relation
 * rather than a type reference.
 *
 * ## Examples
 *
 * ```python
 * class A(Base): ...                       # NAME
 * class B(collections.abc.Mapping): ...    # DOTTED_NAME
 * class C(Generic[T]): ...                 # SUBSCRIPT — 14.6% of bases
 * class D(mixin_factory()): ...            # CALL — cannot be linearised
 * class E(Base, metaclass=Meta): ...       # KEYWORD_METACLASS
 * class F(TypedDict, total=False): ...     # KEYWORD_OTHER
 * class G(*bases): ...                     # STARRED
 * class H: ...                             # IMPLICIT_OBJECT
 * ```
 *
 * Schema v6 §2.5 c0.
 */
export enum PythonBaseKind {
  /** A bare name. */
  NAME = 'NAME',

  /** A dotted path. */
  DOTTED_NAME = 'DOTTED_NAME',

  /** A subscripted generic such as `Generic[T]`. */
  SUBSCRIPT = 'SUBSCRIPT',

  /** A call — a dynamically produced base class. */
  CALL = 'CALL',

  /** The `metaclass=` keyword argument. */
  KEYWORD_METACLASS = 'KEYWORD_METACLASS',

  /** Any other keyword argument, such as `total=`. */
  KEYWORD_OTHER = 'KEYWORD_OTHER',

  /** An unpacked base list, `*bases`. */
  STARRED = 'STARRED',

  /** Synthetic row for a class with no explicit bases. */
  IMPLICIT_OBJECT = 'IMPLICIT_OBJECT',
}
