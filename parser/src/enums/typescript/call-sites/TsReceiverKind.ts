/**
 * The SHAPE of a call's receiver — what resolution dispatches on.
 *
 * Reported precisely rather than collapsed to a boolean, because the outcome per
 * receiver shape is the number that tells a working parser from one that handles
 * only the easy half. An aggregate hides it: a parser can emit every hop for
 * unqualified calls and none for method calls and still show a respectable total.
 *
 * ## The shapes, and what each needs to be resolvable
 *
 * ```ts
 * f()             // NONE            — the callee itself resolves
 * a.f()           // IDENTIFIER      — `a`'s DECLARED type, from its declaration
 * this.f()        // THIS            — the enclosing type
 * super.f()       // SUPER           — an `inheritsMembers` heritage row
 * a.b.f()         // PROPERTY_CHAIN  — each hop's declared type, in turn
 * g().f()         // CALL_RESULT     — the inner call's RETURN type
 * a[i].f()        // ELEMENT_ACCESS  — an element type; not derivable from syntax
 * (a).f()         // PARENTHESIZED   — unwrapped, so this should not appear
 * a!.f()          // NON_NULL        — the wrapped expression's type
 * (a as T).f()    // AS_EXPRESSION   — the asserted type, which IS written down
 * (await p).f()   // AWAIT_RESULT    — the awaited type
 * ```
 *
 * `AS_EXPRESSION` is the one wrapper where the receiver's type is stated
 * outright: `assertedTypeReferenceLinkHash` on the expression row carries it, so
 * no inference is needed.
 *
 * `UNKNOWN` covers shapes the enum does not name — an array literal, a string
 * literal, a binary expression. Their types are still derivable from emitted
 * columns (`kind`, `literalType`), which is why `UNKNOWN` here does not mean
 * unresolvable.
 *
 * Schema §4.15 c2.
 */
export enum TsReceiverKind {
  /** No receiver: an unqualified call. */
  NONE = 'NONE',
  /** A bare name. The primary path: its DECLARED type is written at its declaration. */
  IDENTIFIER = 'IDENTIFIER',
  /** `this`. */
  THIS = 'THIS',
  /** `super`. */
  SUPER = 'SUPER',
  /** A dotted chain: each hop needs the previous hop's declared type. */
  PROPERTY_CHAIN = 'PROPERTY_CHAIN',
  /** A call's return value. */
  CALL_RESULT = 'CALL_RESULT',
  /** `a[i]` — an element type, and not derivable from syntax. */
  ELEMENT_ACCESS = 'ELEMENT_ACCESS',
  /** Parenthesised. Unwrapped at emit, so this should not appear in output. */
  PARENTHESIZED = 'PARENTHESIZED',
  /** `a!` — the wrapped expression's type. */
  NON_NULL = 'NON_NULL',
  /** `(a as T)` — the asserted type is written down and needs no inference. */
  AS_EXPRESSION = 'AS_EXPRESSION',
  /** `(await p)`. */
  AWAIT_RESULT = 'AWAIT_RESULT',
  /** A shape this enum does not name: a literal, an array literal, a binary node. */
  UNKNOWN = 'UNKNOWN',
}
