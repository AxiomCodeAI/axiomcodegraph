/**
 * What kind of type DECLARATION a `cs_type` row describes — schema §3.2 c3.
 *
 * Mirrors Java's `TypeCategory` where the languages agree and diverges where
 * they do not: C# has no `@interface`, and adds three value-type forms and
 * delegates.
 *
 * ## Why the struct forms are not folded into one
 *
 * Value semantics are real and they are not a modifier. Assignment COPIES a
 * struct, so two variables holding "the same" struct are two objects and a
 * mutation through one is invisible through the other. An engine that models a
 * struct as a class invents aliasing that does not exist, in the direction that
 * manufactures dataflow — the same failure shape §3 of `BUILDING-A-PARSER.md`
 * warns about for flattened assignments.
 *
 * `ref struct` is separate again and carried as `cs_type.isRefLikeStruct`: it
 * cannot be boxed, cannot be a field of a class, cannot be captured by a lambda
 * and cannot cross an `await`. Those are constraints on where a value can flow.
 *
 * ## Why `RECORD` and `RECORD_STRUCT` are categories, not a flag
 *
 * 303 records measured, 32 of them `record struct`, 108 positional. A record's
 * members are **synthesized with no declaration syntax** — `Equals`,
 * `GetHashCode`, `ToString`, a copy constructor, `Deconstruct`, and one property
 * per positional parameter. A consumer must be able to tell from the category
 * alone that members exist which no `cs_method` row can point at a declaration
 * for. `isRecord` is also carried, for the same reason `isPartial` is: it is
 * cheap and it makes the common query not need a category set.
 *
 * ## Why `DELEGATE` is a type and not a method
 *
 * `delegate int Op(int a, int b);` declares a TYPE whose values are method
 * references. It has a name, an arity, type parameters, attributes, and it can
 * be a base of nothing but is referenced everywhere. It is the thing `X = M;`
 * assigns into — see `CsCallKind` and the method-group conversion.
 */
export enum CsTypeCategory {
  /** `class C { }` — reference type. */
  CLASS = 'CLASS',

  /** `struct S { }` — value type; assignment copies. */
  STRUCT = 'STRUCT',

  /** `interface I { }` — may carry default implementations since C# 8. */
  INTERFACE = 'INTERFACE',

  /** `enum E { }` — a value type over an integral backing type. */
  ENUM = 'ENUM',

  /** `record R(…)` / `record class R` — reference type with value equality. */
  RECORD = 'RECORD',

  /** `record struct R(…)` — value type with synthesized value equality. 32 measured. */
  RECORD_STRUCT = 'RECORD_STRUCT',

  /** `delegate R D(…);` — a named type whose values are method references. */
  DELEGATE = 'DELEGATE',
}
