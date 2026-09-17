/**
 * Declaration-site variance on a type parameter — `cs_type_parameter.varianceModifier`.
 *
 * ## This is where Java's `wildcardVariance` went, and why it moved
 *
 * Java has **use-site** variance: `List<? extends Number>` annotates the
 * REFERENCE, so the column lives on `java_type_reference`. C# has
 * **declaration-site** variance: `interface IEnumerable<out T>` annotates the
 * PARAMETER once, and every reference to the type inherits it. There are no
 * wildcards in C# at all.
 *
 * Same information, different relation. This is the concrete case that
 * "check each column rather than assuming it means the same" was written for —
 * porting `wildcardVariance` onto `cs_type_reference` would have produced a
 * column that is empty on all 100% of rows while the actual variance sat
 * unrecorded on the declaration.
 *
 * ## Why it is not merely cosmetic
 *
 * `out T` makes `IEnumerable<Derived>` assignable to `IEnumerable<Base>`; `in T`
 * reverses it; neither is true without the annotation. An engine deciding
 * whether a value can flow through a parameter needs this, and it is legal only
 * on interfaces and delegates.
 */
export enum CsVarianceModifier {
  /** `in T` — contravariant. The parameter appears only in input positions. */
  IN = 'IN',

  /** `out T` — covariant. The parameter appears only in output positions. */
  OUT = 'OUT',

  /** Invariant. The default, and the only option on a class, struct or method. */
  NONE = 'NONE',
}
