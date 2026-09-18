/**
 * What the receiver of a call IS, syntactically — `cs_call_site.receiverKind`.
 *
 * Syntactic only. Whether `Foo.Bar()` is a static call on a type or an instance
 * call on a property named `Foo` is resolution, so both are `NAME` and the
 * engine decides. What is decidable — `this`, `base`, a literal, a parenthesised
 * expression, no receiver at all — is filled.
 */
export enum CsReceiverKind {
  /** `M()` — no receiver written. */
  NONE = 'NONE',
  /** `this.M()`. */
  THIS = 'THIS',
  /** `base.M()` — dispatches NON-virtually, so the target is the base's. */
  BASE = 'BASE',
  /** `Foo.M()` — a name. Type or value is a resolution outcome. */
  NAME = 'NAME',
  /** `a.b.M()` — a dotted qualifier. */
  QUALIFIED_NAME = 'QUALIFIED_NAME',
  /** `f().M()` — the receiver is itself a call. */
  INVOCATION = 'INVOCATION',
  /** `(expr).M()`, `arr[0].M()`, a literal, or anything else with a shape. */
  EXPRESSION = 'EXPRESSION',
}
