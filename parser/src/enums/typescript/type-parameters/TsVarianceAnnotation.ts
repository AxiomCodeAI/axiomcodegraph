/**
 * DECLARATION-SITE variance on a type parameter. TypeScript 4.7.
 *
 * **562 measured** in one ecosystem corpus, so this is not hypothetical syntax.
 *
 * Java's `WildcardVariance` is USE-site — `List<? extends Number>` annotates the
 * reference. This is declaration-site: the parameter itself declares how it may
 * vary, and every reference inherits it. The two are not interchangeable, which
 * is why they are separate columns on separate relations rather than one shared
 * value.
 *
 * ```ts
 * interface Producer<out T> { get(): T }        // OUT — covariant
 * interface Consumer<in T> { put(x: T): void }  // IN  — contravariant
 * interface Both<in out T> { swap(x: T): T }    // IN_OUT — invariant
 * interface Plain<T> { }                        // "" — inferred by the checker
 * ```
 *
 * An absent annotation is `""`, not a guess: the checker infers variance
 * structurally, and the parser records only what was written.
 *
 * Schema §4.4 c13.
 */
export enum TsVarianceAnnotation {
  /** `in T` — contravariant; the parameter appears only in input positions. */
  IN = 'IN',
  /** `out T` — covariant; the parameter appears only in output positions. */
  OUT = 'OUT',
  /** `in out T` — invariant; asserted explicitly. */
  IN_OUT = 'IN_OUT',
}
