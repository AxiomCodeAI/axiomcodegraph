/**
 * What kind of type DECLARATION a `ts_type` row describes.
 *
 * Mirrors `TypeCategory` in the Java enums, position for position, and diverges
 * only where the language does: TypeScript has no records and no
 * `@interface`, and adds type aliases, namespaces and class expressions.
 *
 * ## Anonymous types are NOT here
 *
 * 21,956 function types and 5,015 type literals were measured in one ecosystem
 * corpus. None has a name, a declaration or a merge identity, so none gets a
 * `ts_type` row — they live in the `ts_type_reference` tree. Keeping this
 * relation to declarations is what keeps it key-able at all.
 *
 * ## Examples
 *
 * ```ts
 * class UserService { }                    // CLASS_TYPE
 * abstract class BaseService { }            // CLASS_TYPE  (+ ABSTRACT modifier)
 * interface Repository<T> { }               // INTERFACE_TYPE   isTypeOnly = true
 * type Handler = (e: Event) => void;        // TYPE_ALIAS_TYPE  isTypeOnly = true
 * enum Status { Active, Closed }            // ENUM_TYPE
 * const enum Direction { Up, Down }         // CONST_ENUM_TYPE
 * namespace Geometry { }                    // NAMESPACE_TYPE
 * const Widget = class Inner { };           // CLASS_EXPRESSION_TYPE
 * ```
 *
 * ## Why CONST_ENUM_TYPE is its own member
 *
 * A `const enum` member is INLINED at every use site, so a reference to it may
 * have no runtime target at all. Folding it into `ENUM_TYPE` would leave the
 * engine unable to tell a reachable member read from one the compiler erased.
 *
 * ## Why TYPE_ALIAS_TYPE gets a row at all
 *
 * It is a named declaration, it merges, it can be `extends`-ed, and there are
 * 2,491 of them. What it does not get is any path into `ts_call_site`: its
 * right-hand side hangs off `aliasTargetReferenceLinkHash` into the type graph,
 * and that is its only edge.
 *
 * Schema §4.2 c3.
 */
export enum TsTypeCategory {
  /** `class C { }` — occupies both the TYPE and VALUE declaration spaces. */
  CLASS_TYPE = 'CLASS_TYPE',

  /** `interface I { }` — TYPE space only, so `isTypeOnly` is true. */
  INTERFACE_TYPE = 'INTERFACE_TYPE',

  /** `enum E { }` — occupies TYPE, VALUE and NAMESPACE spaces at once. */
  ENUM_TYPE = 'ENUM_TYPE',

  /** `const enum E { }` — members are inlined, so uses may have no runtime target. */
  CONST_ENUM_TYPE = 'CONST_ENUM_TYPE',

  /** `type T = …` — TYPE space only, and no path into the call graph. */
  TYPE_ALIAS_TYPE = 'TYPE_ALIAS_TYPE',

  /**
   * `namespace N { }`, or `declare module "x" { }`.
   *
   * Occupies VALUE only when INSTANTIATED — a namespace holding nothing but
   * types is erased entirely.
   */
  NAMESPACE_TYPE = 'NAMESPACE_TYPE',

  /**
   * `class { }` in an expression position.
   *
   * Declares nothing in any symbol table, so it merges with nothing: two
   * `class {}` expressions are two types even when bound to the same name.
   */
  CLASS_EXPRESSION_TYPE = 'CLASS_EXPRESSION_TYPE',
}
