/**
 * What an expression node IS — `cs_expression.kind`, schema §3.16.
 *
 * ## The wrapper-node values, which §3 of `BUILDING-A-PARSER.md` exists to force
 *
 * The recurring defect in every language here is **the parts get emitted, the
 * structure does not**. Python's `x += 1` produced a target and a value as two
 * depth-0 roots with no wrapper, which are unpairable — and the engine-side
 * workaround, joining on `(scope, line)`, paired `a` with `2` on `a += 1; b += 2`.
 * It fails in the direction that INVENTS value flow.
 *
 * So every construct below emits **one wrapper with its children parented to it
 * and the variant in a column**. One `COMPOUND_ASSIGNMENT` covers
 * `+= -= *= /= ??= ||=` because the operator is `operatorString`, not a kind.
 *
 * ## `EVENT_SUBSCRIBE` is the C#-specific instance of that rule
 *
 * `button.Click += Handler` is **not** a compound assignment. It CALLS the
 * `add` accessor and registers an edge that fires later, from a stack the
 * subscriber never appears on. Modelling it as `COMPOUND_ASSIGNMENT` with `+=`
 * in a column gives an engine the parts and loses the edge.
 *
 * ## `PARENTHESIZED` is emitted, not skipped
 *
 * §6: a tree rooted at a non-emitting node dies before its children are
 * enqueued. `return (a && b.c())` cost admin-ui **1,808 expressions** and
 * `{t(msg)}` in JSX cost **4,488 of 14,335 call sites**. Unwrap at the root, but
 * emit the row.
 */
export enum CsExpressionKind {
  // -- assignment and its C#-specific cousin -------------------------------
  /** `x = y`. */
  ASSIGNMENT = 'ASSIGNMENT',
  /** `+= -= *= /= %= &= |= ^= <<= >>= ??=` — the operator is a COLUMN. */
  COMPOUND_ASSIGNMENT = 'COMPOUND_ASSIGNMENT',
  /** `button.Click += Handler` — a SUBSCRIPTION. Calls `add`; not an assignment. */
  EVENT_SUBSCRIBE = 'EVENT_SUBSCRIBE',
  /** `button.Click -= Handler` — calls `remove`. */
  EVENT_UNSUBSCRIBE = 'EVENT_UNSUBSCRIBE',

  // -- invocation and access ------------------------------------------------
  INVOCATION = 'INVOCATION',
  OBJECT_CREATION = 'OBJECT_CREATION',
  /**
   * `new T[n]`, `new T[] { … }`, `new[] { … }`.
   *
   * Distinct from OBJECT_CREATION because it CALLS NO CONSTRUCTOR: an array
   * allocation is a runtime operation with no user code behind it, and giving
   * it a `cs_call_site` would put a call edge to a constructor that does not
   * exist into the graph.
   *
   * It needs a kind of its own rather than being left out of the allowlist,
   * which is what it was: a node that emits no row takes its whole subtree with
   * it, and `new IPolicy[] { new A(), new B(), … }` lost every
   * element — 129 of the 1,104 object creations in multitarget-A.
   */
  ARRAY_CREATION = 'ARRAY_CREATION',
  MEMBER_ACCESS = 'MEMBER_ACCESS',
  ELEMENT_ACCESS = 'ELEMENT_ACCESS',
  NAME_REFERENCE = 'NAME_REFERENCE',
  /**
   * `_` where it BINDS NOTHING: the target of `_ = expr`, an element of a
   * deconstruction target `(_, b) = t`, an `out _` argument, and the `_`
   * pattern. Schema §3.12: a discard never produces a cs_variable row; this
   * kind carries it. Without it every discard was a NAME_REFERENCE to a name
   * declared nowhere — 231 of 234 `_` references on one stratum could never
   * resolve and read to the engine as unresolved when they are correct.
   * `_` that IS a declared local, parameter or binding stays a reference.
   */
  DISCARD = 'DISCARD',

  // -- conversions, which may run user code --------------------------------
  /** `(Foo)x` — and in C# this may INVOKE a user-defined conversion operator. */
  CAST = 'CAST',
  /** `x as Foo` — a conversion that yields null instead of throwing. */
  AS_EXPRESSION = 'AS_EXPRESSION',
  /** `x is Foo f` — a test that may also DECLARE a variable. */
  IS_PATTERN = 'IS_PATTERN',

  // -- the C# 8+ expression forms ------------------------------------------
  SWITCH_EXPRESSION = 'SWITCH_EXPRESSION',
  SWITCH_ARM = 'SWITCH_ARM',
  /** `record with { X = 1 }` — a COPY with mutations, not a mutation. */
  WITH_EXPRESSION = 'WITH_EXPRESSION',
  RANGE = 'RANGE',
  INDEX = 'INDEX',
  TUPLE = 'TUPLE',
  DECONSTRUCTION = 'DECONSTRUCTION',
  INTERPOLATED_STRING = 'INTERPOLATED_STRING',
  /** One `{…}` hole. Its contents are ordinary expressions and may be calls. */
  INTERPOLATION = 'INTERPOLATION',

  // -- function-shaped values -----------------------------------------------
  LAMBDA = 'LAMBDA',
  ANONYMOUS_METHOD = 'ANONYMOUS_METHOD',
  ANONYMOUS_OBJECT = 'ANONYMOUS_OBJECT',

  // -- collections -----------------------------------------------------------
  COLLECTION_EXPRESSION = 'COLLECTION_EXPRESSION',
  /** `..e` — and the grammar's `collection_element` is OVERLOADED with the non-spread case. */
  SPREAD_ELEMENT = 'SPREAD_ELEMENT',

  // -- LINQ ------------------------------------------------------------------
  /**
   * `from x in xs where p select f`.
   *
   * A WRAPPER with `cs_query_clause` children. **No synthesized `Where()` /
   * `Select()` calls** — that was proposed and withdrawn. `from`/`where`/`select`
   * is structure the parser can see; which overload on which receiver through
   * which extension method in which `using` scope is a resolution outcome it
   * cannot.
   */
  QUERY = 'QUERY',

  // -- operators and operands ------------------------------------------------
  BINARY = 'BINARY',
  UNARY = 'UNARY',
  CONDITIONAL = 'CONDITIONAL',
  LITERAL = 'LITERAL',
  /** Emitted, never skipped. See the class comment. */
  PARENTHESIZED = 'PARENTHESIZED',

  // -- the operand-taking keywords -------------------------------------------
  AWAIT = 'AWAIT',
  /** `nameof(X)` — a COMPILE-TIME string. The operand is never evaluated. */
  NAMEOF = 'NAMEOF',
  TYPEOF = 'TYPEOF',
  SIZEOF = 'SIZEOF',
  STACKALLOC = 'STACKALLOC',
  DEFAULT = 'DEFAULT',
  /** `throw new X()` in expression position — C# 7. */
  THROW_EXPRESSION = 'THROW_EXPRESSION',
  /** `ref x` — an ALIAS, so a write through the result writes through to `x`. */
  REF_EXPRESSION = 'REF_EXPRESSION',
  POINTER_INDIRECTION = 'POINTER_INDIRECTION',
  ADDRESS_OF = 'ADDRESS_OF',
  /** `checked(a + b)` — changes WHICH operator is invoked, per C# 11. */
  CHECKED_EXPRESSION = 'CHECKED_EXPRESSION',
  /** `base` and `this` as values. */
  BASE_REFERENCE = 'BASE_REFERENCE',
  THIS_REFERENCE = 'THIS_REFERENCE',
  /** An object or collection initializer body: `new Foo { A = 1 }`. */
  INITIALIZER = 'INITIALIZER',
}
