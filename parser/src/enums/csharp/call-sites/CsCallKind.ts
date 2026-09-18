/**
 * How a call is made — `cs_call_site.callKind`, schema §3.17.
 *
 * §5: every language has more ways to invoke than "call a method", and each one
 * an engine cannot distinguish is a class of edge it will get wrong. This is the
 * enumeration for C#.
 *
 * ## Two that look like something else
 *
 * `CONVERSION_CALL` — **a cast that invokes user code**. `(Bar)foo` runs a
 * user-defined `explicit operator`, and an implicit one runs with *no syntax at
 * the call site at all*. 582 conversion operators in the corpus. An engine that
 * models conversions as type facts loses every one of those edges.
 *
 * `OPERATOR_CALL` — `a + b` where `+` is overloaded is a static method call.
 * 760 operator overloads measured.
 *
 * ## Three are RESERVED with a zero-row assertion
 *
 * `DYNAMIC_CALL` is the C# analogue of TypeScript's `INDEX_CALL`, and the reason
 * is the same: **a fact about a value's runtime identity, not its syntax.**
 * `d.Foo()` where `d` is `dynamic` is dispatched at runtime by the DLR, and no
 * amount of reading the source says what it hits. Guessing would be wrong more
 * often than right, so it is never emitted from syntax.
 */
export enum CsCallKind {
  /** `a.M()` — a call with a receiver. */
  METHOD_CALL = 'METHOD_CALL',
  /** `M()` — no receiver in the syntax. */
  FUNCTION_CALL = 'FUNCTION_CALL',
  CONSTRUCTOR_CALL = 'CONSTRUCTOR_CALL',
  /** `: base(a)` — and on a primary constructor, `: Base(a)` in the base list. */
  BASE_CONSTRUCTOR_CALL = 'BASE_CONSTRUCTOR_CALL',
  /** `: this(a)` — one constructor delegating to another. */
  THIS_CONSTRUCTOR_CALL = 'THIS_CONSTRUCTOR_CALL',
  /** `handler(args)` or `handler.Invoke(args)` through a delegate value. */
  DELEGATE_INVOKE = 'DELEGATE_INVOKE',
  /** A call to a function declared inside a method body. */
  LOCAL_FUNCTION_CALL = 'LOCAL_FUNCTION_CALL',
  /** `a + b` where `+` is user-defined — a static method call in disguise. */
  OPERATOR_CALL = 'OPERATOR_CALL',
  /** `(Bar)foo` invoking a user-defined conversion. A call wearing a cast. */
  CONVERSION_CALL = 'CONVERSION_CALL',
  /** `a[i]` through a user-defined indexer — a property accessor call. */
  ELEMENT_ACCESS_CALL = 'ELEMENT_ACCESS_CALL',
  /** `a?.M()` — differs from METHOD_CALL in REACHABILITY, not in target. */
  NULL_CONDITIONAL_CALL = 'NULL_CONDITIONAL_CALL',

  /**
   * **RESERVED, zero rows.** A call through a `dynamic` value.
   *
   * The C# analogue of TypeScript's `INDEX_CALL`, and reserved for the same
   * reason: it is a fact about a value's RUNTIME identity, which syntax cannot
   * decide. `d.Foo()` is dispatched by the DLR. A kind syntax cannot decide must
   * be reserved, not guessed.
   */
  DYNAMIC_CALL = 'DYNAMIC_CALL',

  /**
   * **RESERVED, zero rows.** An extension call reduced to its static form.
   *
   * `IMethodSymbol.ReducedFrom` is an ORACLE question. The parser emits
   * `receiverKind` — the `a.B()` SHAPE — and never claims that `B`
   * resolved to an extension method.
   */
  EXTENSION_REDUCED_CALL = 'EXTENSION_REDUCED_CALL',

  /**
   * **RESERVED, zero rows.** A call synthesized from LINQ desugaring.
   *
   * Withdrawn by ruling: the parser emits `cs_query_clause` and the ENGINE
   * desugars. `from`/`where`/`select` is structure the parser can see;
   * `Where()`/`Select()` is which overload, on which receiver type, through
   * which extension method, in which `using` scope.
   */
  QUERY_DESUGARED_CALL = 'QUERY_DESUGARED_CALL',
}
