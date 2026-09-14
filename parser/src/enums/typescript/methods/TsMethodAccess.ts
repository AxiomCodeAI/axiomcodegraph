/**
 * How reachable a function-shaped declaration is.
 *
 * Mixes two systems because TypeScript does: class members carry Java-style
 * modifiers, while top-level functions are governed by `export`. Both appear in
 * one column because both answer the same question — can this be called from
 * outside — and a consumer should not need to know which mechanism applied.
 *
 * ## `PRIVATE_ACCESS` and `PRIVATE_NAME_ACCESS` are not the same fact
 *
 * ```ts
 * class C {
 *     private soft() { }   // PRIVATE_ACCESS      — erased at emit, reachable at runtime
 *     #hard() { }          // PRIVATE_NAME_ACCESS — enforced by the runtime
 * }
 * ```
 *
 * `private` is a compile-time assertion that disappears; `#name` is a real
 * runtime private that cannot be reached even by reflection. A security or
 * reachability rule that treats them alike is wrong about one of them, so they
 * never share a value.
 *
 * Schema §4.6 c10.
 */
export enum TsMethodAccess {
  /** `public`, or a class member with no access modifier. */
  PUBLIC_ACCESS = 'PUBLIC_ACCESS',

  /** `private` — erased at emit; still present at runtime. */
  PRIVATE_ACCESS = 'PRIVATE_ACCESS',

  /** `protected` — erased at emit. */
  PROTECTED_ACCESS = 'PROTECTED_ACCESS',

  /** `#m()` — a HARD runtime private, unreachable from outside the class. */
  PRIVATE_NAME_ACCESS = 'PRIVATE_NAME_ACCESS',

  /** `export function f` — callable from an importing module. */
  EXPORTED_ACCESS = 'EXPORTED_ACCESS',

  /** A module-level function with no `export`. */
  MODULE_LOCAL_ACCESS = 'MODULE_LOCAL_ACCESS',
}
