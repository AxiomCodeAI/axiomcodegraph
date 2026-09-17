/**
 * Which kind of user-defined conversion — `cs_method.conversionKind`.
 *
 * The distinction is reachability, and it is not cosmetic. An **implicit**
 * conversion runs with **no syntax at the call site at all** — passing a `Foo`
 * where a `Bar` is expected invokes user code, and nothing in the source says
 * so. An **explicit** one requires a cast, so there is at least a `(Bar)` to
 * point at.
 *
 * An engine that cannot tell them apart cannot tell which call edges are
 * findable by reading the source.
 */
export enum CsConversionKind {
  /** `public static implicit operator Bar(Foo f)` — invoked with no syntax. */
  IMPLICIT = 'IMPLICIT',

  /** `public static explicit operator Bar(Foo f)` — requires a cast. */
  EXPLICIT = 'EXPLICIT',

  /** Not a conversion operator. */
  NONE = 'NONE',
}
