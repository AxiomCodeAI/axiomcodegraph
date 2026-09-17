/**
 * A METHOD GROUP conversion — `cs_expression.methodReferenceKind`.
 *
 * ## TypeScript's is a parity slot, always `""`. C# fills it.
 *
 * That is the point of the column. `Action a = M;` is a **reference to a method
 * with no call syntax at all** — no parentheses, no arguments, nothing that
 * looks like an invocation. `M` is converted to a delegate, and the call happens
 * later through `a()`, from a stack `M`'s declaration never appears on.
 *
 * An engine that only reads `cs_call_site` sees no edge here, and the delegate
 * appears to be invoked with no target. This column is the only thing that says
 * a method was named without being called.
 */
export enum CsMethodReferenceKind {
  /** Not a method group conversion. */
  NONE = 'NONE',
  /** `Action a = M;` — an instance or static method named without parentheses. */
  METHOD_GROUP = 'METHOD_GROUP',
  /** `Action a = x.M;` — through an instance, so the receiver is captured too. */
  INSTANCE_METHOD_GROUP = 'INSTANCE_METHOD_GROUP',
  /** `new Handler(M)` — the explicit delegate-creation form. */
  DELEGATE_CREATION = 'DELEGATE_CREATION',
  /** `Action a = static () => …` — an inline function, not a named group. */
  ANONYMOUS_FUNCTION = 'ANONYMOUS_FUNCTION',
}
