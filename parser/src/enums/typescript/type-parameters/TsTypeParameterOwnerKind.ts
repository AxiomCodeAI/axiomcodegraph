/**
 * What declares a type parameter.
 *
 * ## One relation where Java has two, and why
 *
 * Java splits `java_type_parameter` from `java_method_type_parameter` because
 * types and methods are the only two owners it has. TypeScript attaches type
 * parameters to **nine** kinds of declaration, so N relations would multiply
 * without adding information. `ownerKind` plus the polymorphic `ownerLinkHash`
 * carries it instead.
 *
 * This costs the `method_type_parameter` projection a rename plus a filter on
 * this column — `ownerKind IN (FUNCTION, METHOD, ARROW, CALL_SIGNATURE,
 * CONSTRUCT_SIGNATURE)` — and that is the whole cost. It is a deliberate
 * divergence from Java, recorded here so the projection author does not go
 * looking for a second relation.
 *
 * ## Bounds are still separated, because they answer different questions
 *
 * `ts_type_reference.context` distinguishes `TYPE_PARAM_BOUND` (a class,
 * interface or type-alias parameter) from `METHOD_TYPE_PARAM_BOUND` (a function
 * or method parameter), exactly as Java does — so the Java query "every bound on
 * a method type parameter" still has a direct translation even though the
 * declaration rows share one relation.
 *
 * ## Examples
 *
 * ```ts
 * class Box<T> { }                        // CLASS
 * interface Repo<T> { }                   // INTERFACE
 * type Pair<A, B> = [A, B];               // TYPE_ALIAS
 * function map<T, U>(x: T): U { }         // FUNCTION
 * class C { m<T>(x: T) { } }              // METHOD
 * const f = <T,>(x: T) => x;              // ARROW
 * interface I { <T>(x: T): T }            // CALL_SIGNATURE
 * interface J { new <T>(x: T): J }        // CONSTRUCT_SIGNATURE
 * type Keys<T> = { [K in keyof T]: T[K] } // MAPPED_TYPE — K is declared by the mapping
 * type El<T> = T extends (infer U)[] ? U : never  // INFER_TYPE — U is declared by `infer`
 * ```
 *
 * The last two are why this cannot be a two-member enum: `K` and `U` are real
 * type parameters with real scopes, declared by constructs Java does not have.
 *
 * Schema §4.4 c7.
 */
export enum TsTypeParameterOwnerKind {
  /** `class Box<T>`. */
  CLASS = 'CLASS',
  /** `interface Repo<T>`. */
  INTERFACE = 'INTERFACE',
  /** `type Pair<A, B>`. */
  TYPE_ALIAS = 'TYPE_ALIAS',
  /** `function map<T>()`. */
  FUNCTION = 'FUNCTION',
  /** A method, constructor or accessor on a class. */
  METHOD = 'METHOD',
  /** `<T,>(x: T) => x`. */
  ARROW = 'ARROW',
  /** `<T>(x: T): T` on an interface or type literal. */
  CALL_SIGNATURE = 'CALL_SIGNATURE',
  /** `new <T>(x: T): I`. */
  CONSTRUCT_SIGNATURE = 'CONSTRUCT_SIGNATURE',
  /** `[K in keyof T]` — the mapping declares `K`. */
  MAPPED_TYPE = 'MAPPED_TYPE',
  /** `infer U` — the conditional declares `U`. 1,337 measured. */
  INFER_TYPE = 'INFER_TYPE',
}
