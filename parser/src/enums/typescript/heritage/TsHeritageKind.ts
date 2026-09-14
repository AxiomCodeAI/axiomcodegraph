/**
 * What a single `extends` / `implements` clause entry IS.
 *
 * ## This relation records SYNTAX, and that is the whole point
 *
 * The distinction does not exist in Java, where both clauses are authoritative
 * for subtyping, and collapsing it is the most consequential porting error
 * available here. Measured: **60.4% of classes declare no `implements` at all**,
 * **21.5%** of assignable (class, interface) pairs appear in no syntax anywhere,
 * and **15.4%** are mutually assignable — which is not identity.
 *
 * So an `IMPLEMENTS_CLAUSE` row says "someone wrote this down". It does not say
 * the subtyping holds, and it does not say members are inherited. For actual
 * subtyping the engine derives `ts_type_satisfies` and the oracle adjudicates it
 * with `isTypeAssignableTo`.
 *
 * ## Examples
 *
 * ```ts
 * class A extends Base { }                      // EXTENDS_CLASS
 * interface I extends Other { }                 // EXTENDS_INTERFACE
 * class B implements Serializable { }           // IMPLEMENTS_CLAUSE
 * class C extends mixin(Base) { }               // EXTENDS_EXPRESSION  isDynamic
 * interface D extends { a: number } { }         // EXTENDS_TYPE_LITERAL
 * ```
 *
 * `EXTENDS_EXPRESSION` is the mixin form. The base is COMPUTED, so the parser
 * cannot name it and says so via `isDynamic` rather than guessing at the callee —
 * which would attribute the members of whatever `mixin` happens to return.
 *
 * Schema §4.3 c0, §3.2.
 */
export enum TsHeritageKind {
  /** A class extending a class. Inherits members. */
  EXTENDS_CLASS = 'EXTENDS_CLASS',

  /** An interface extending an interface. Inherits members. */
  EXTENDS_INTERFACE = 'EXTENDS_INTERFACE',

  /**
   * `implements` — a compile-time ASSERTION that inherits nothing.
   *
   * Walking this as a member-lookup edge is correct in Java and wrong here.
   */
  IMPLEMENTS_CLAUSE = 'IMPLEMENTS_CLAUSE',

  /** `extends mixin(Base)` — a computed base the parser cannot name. */
  EXTENDS_EXPRESSION = 'EXTENDS_EXPRESSION',

  /** `extends { a: number }` — an anonymous shape as a supertype. */
  EXTENDS_TYPE_LITERAL = 'EXTENDS_TYPE_LITERAL',
}
