/**
 * WHERE a type reference appears — `cs_type_reference.context`.
 *
 * The context is what lets a rule ask a question about type USE without
 * re-walking the tree: "which types does this method accept", "what does this
 * class derive from", "what is cast to what". Java's `TypeRefContext` is the
 * model; the values that do not exist in C# are absent and the ones C# adds are
 * marked.
 *
 * ## The context of a NESTED reference is its ROOT's
 *
 * The `int` in `List<int>` in a return position carries `METHOD_RETURN`, not a
 * `TYPE_ARGUMENT` value. There was one and it was removed: `depth > 0` already
 * says a reference is nested, and a separate context would have made "every
 * type this method can return" an unanswerable question — the interesting part
 * of `Task<Order>` is `Order`, and it would have been filed under a context
 * that says nothing about where it appeared.
 */
export enum CsTypeRefContext {
  /** An entry in a `class C : A, IB` list. */
  BASE_LIST = 'BASE_LIST',

  /** `where T : IFoo` — a constraint naming a type. */
  TYPE_PARAMETER_CONSTRAINT = 'TYPE_PARAMETER_CONSTRAINT',

  /** A field's declared type. */
  FIELD_TYPE = 'FIELD_TYPE',

  /** A method's return type. */
  METHOD_RETURN = 'METHOD_RETURN',

  /** A parameter's declared type. */
  METHOD_PARAMETER = 'METHOD_PARAMETER',

  /** ★ A property's or indexer's type. C# only — Java has no properties. */
  PROPERTY_TYPE = 'PROPERTY_TYPE',

  /** ★ An event's delegate type. C# only. */
  EVENT_TYPE = 'EVENT_TYPE',

  /** ★ An enum's underlying storage type: `enum E : byte`. */
  ENUM_UNDERLYING = 'ENUM_UNDERLYING',

  /** A local variable's declared type, including `var` when written explicitly. */
  LOCAL_VARIABLE = 'LOCAL_VARIABLE',

  /** `(Foo)x` — and in C# this may INVOKE a user-defined conversion operator. */
  CAST = 'CAST',

  /** `new Foo()` — the constructed type. */
  OBJECT_CREATION = 'OBJECT_CREATION',

  /** `new int[4]`. */
  ARRAY_CREATION = 'ARRAY_CREATION',

  /** `x is Foo f`, `case Foo f:` — a type pattern. */
  TYPE_PATTERN = 'TYPE_PATTERN',

  /** `M<int>(…)` — an explicit method type argument. */
  METHOD_TYPE_ARGUMENT = 'METHOD_TYPE_ARGUMENT',

  /** An attribute's type: `[Serializable]`. */
  ATTRIBUTE_TYPE = 'ATTRIBUTE_TYPE',

  /** ★ `typeof(Foo)` and `nameof(Foo)` — a type in a value position. */
  TYPEOF = 'TYPEOF',

  /** ★ `using Alias = A.B.C;` — the alias TARGET. */
  USING_ALIAS_TARGET = 'USING_ALIAS_TARGET',

  /** ★ `void IFoo.Bar()` — the interface named by an explicit implementation. */
  EXPLICIT_INTERFACE = 'EXPLICIT_INTERFACE',

  /**
   * ★ A type as the operand of an operator that takes a type — ENUMERATED,
   * not "the other ones" (ruling v1.7): exactly `default(Foo)`,
   * `sizeof(Foo)` and `stackalloc Foo[n]`. A position not on this list gets
   * its own value rather than joining it, so the population stays statable.
   */
  TYPE_OPERAND = 'TYPE_OPERAND',

  /**
   * ★ `x as Foo` — and NOT `CAST`, by ruling. `(Foo)x` can invoke a
   * user-defined implicit or explicit conversion operator, a call edge
   * wearing a type reference's clothes (582 conversion operators measured on
   * one corpus); `x as Foo` never can — reference or boxing conversion only.
   * Labelling it CAST tells the engine to look for an operator that cannot
   * exist.
   */
  AS_TYPE = 'AS_TYPE',

  /**
   * A lambda parameter's explicit type — `(int x) => …`. Its ABSENCE on a
   * lambda parameter is the fact that matters: the parameter is inferred.
   */
  LAMBDA_PARAMETER = 'LAMBDA_PARAMETER',

  /**
   * ★ A parameter's type in a delegate's signature — `delegate int D<T>(T a,
   * int b)`. Owned by the delegate TYPE, and the root's `position` is the
   * parameter's index. A lambda converted to the delegate takes its implicit
   * parameter types from here, so without it `D<Foo> d = (a, b) => a.M()` has
   * no type for `a`.
   */
  DELEGATE_PARAMETER = 'DELEGATE_PARAMETER',
}
