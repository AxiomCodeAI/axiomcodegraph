/**
 * The shape of a callable's body — `cs_method.bodyKind`.
 *
 * `NONE` is not "empty". `void M();` on an interface, an `abstract` method, an
 * `extern` method and a `partial` definition all have no body **and are all
 * still call targets** — an engine that skipped them would lose every call to an
 * interface member. `{ }` is a `BLOCK` with no statements, which is a different
 * fact.
 */
export enum CsBodyKind {
  /** `{ … }`. */
  BLOCK = 'BLOCK',

  /** `=> expr` — an expression-bodied member. */
  EXPRESSION = 'EXPRESSION',

  /** No body: abstract, extern, interface member, partial definition, auto-accessor. */
  NONE = 'NONE',
}
