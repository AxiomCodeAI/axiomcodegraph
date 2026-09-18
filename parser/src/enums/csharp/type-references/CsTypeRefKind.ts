/**
 * The SHAPE of a type reference — `cs_type_reference.kind`.
 *
 * Ported from Java's `TypeRefKind`, with the differences C# actually has.
 *
 * ## `WILDCARD` does not port
 *
 * Java has `? extends T` at the REFERENCE. C# has no wildcards at all: variance
 * is declared once on the type parameter (`interface IEnumerable<out T>`) and
 * every reference inherits it. The information lives on
 * `cs_type_parameter.varianceModifier`, so there is no value for it here and
 * that absence is deliberate rather than an omission.
 *
 * ## What C# adds
 *
 * `POINTER`, `FUNCTION_POINTER`, `TUPLE` and `REF`. All four are shapes Java's
 * model has no room for, and each changes what may be done with a value rather
 * than merely how it is spelled.
 *
 * ## There is deliberately no `NULLABLE` kind
 *
 * It would duplicate the `isNullableAnnotated` COLUMN and hide the real shape
 * behind it: `List<int>?` would become `NULLABLE` and the engine would have to
 * look at a child to learn it is a constructed generic. The boolean says
 * nullable and the kind says what the thing IS, which is §3's "the variant in a
 * field" applied to a type tree.
 *
 * Note also that `int?` and `string?` are NOT the same construct despite the
 * same spelling. `int?` is `Nullable<int>`, a real struct with different layout
 * and different boxing; `string?` is an annotation that erases at runtime and
 * means nothing outside a `#nullable enable` region. `isNullableAnnotated`
 * records the text; the owner's `nullableContext` says whether it means
 * anything.
 */
export enum CsTypeRefKind {
  /** `Foo`, `A.B.Foo` — a named type with no type arguments. */
  NAMED = 'NAMED',

  /**
   * `List<int>` — a CONSTRUCTED generic type.
   *
   * C# generics are **reified**: `List<int>` and `List<string>` are distinct
   * runtime types with distinct method tables, where Java erases both to `List`.
   * So the type-argument subtree is not decoration — it is part of the type's
   * identity, and `completeTypeName` carries it alongside the bare `typeName`.
   */
  CONSTRUCTED = 'CONSTRUCTED',

  /** `T` — a reference to a type parameter in scope. */
  TYPE_PARAMETER = 'TYPE_PARAMETER',

  /** `int[]`, `int[,]` — `arrayRank` carries the dimension count. */
  ARRAY = 'ARRAY',

  /** `int`, `string`, `object` — a predefined type keyword. */
  PREDEFINED = 'PREDEFINED',

  /** `(int X, string Y)` — a value tuple. `tupleElementCount` carries the arity. */
  TUPLE = 'TUPLE',

  /** `int*` — unsafe. Cannot be tracked by the GC, cannot be a generic argument. */
  POINTER = 'POINTER',

  /** `delegate*<int, void>` — a function pointer. A call target with no object. */
  FUNCTION_POINTER = 'FUNCTION_POINTER',

  /** `ref int` in a return type or a `scoped_type`. An ALIAS, not a value. */
  REF = 'REF',

  /** `dynamic` — see `CsCallKind.DYNAMIC_CALL`. Syntax cannot say what it is. */
  DYNAMIC = 'DYNAMIC',
}
