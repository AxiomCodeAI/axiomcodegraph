/**
 * How reachable a member is.
 *
 * Carries the same `PRIVATE_ACCESS` / `PRIVATE_NAME_ACCESS` distinction as
 * `TsMethodAccess`, and for the same reason: `private` is erased at emit and
 * still present at runtime, while `#x` is enforced by the runtime and cannot be
 * reached even by reflection.
 *
 * ```ts
 * class C {
 *     private soft = 1;   // PRIVATE_ACCESS
 *     #hard = 1;          // PRIVATE_NAME_ACCESS
 * }
 * ```
 *
 * Schema §4.8 c11.
 */
export enum TsFieldAccess {
  /** `public`, or no access modifier. */
  PUBLIC_ACCESS = 'PUBLIC_ACCESS',
  /** `private` — erased at emit; reachable at runtime. */
  PRIVATE_ACCESS = 'PRIVATE_ACCESS',
  /** `protected` — erased at emit. */
  PROTECTED_ACCESS = 'PROTECTED_ACCESS',
  /** `#x` — a HARD runtime private. */
  PRIVATE_NAME_ACCESS = 'PRIVATE_NAME_ACCESS',
  /** An exported module-level declaration. */
  EXPORTED_ACCESS = 'EXPORTED_ACCESS',
  /** A module-level declaration with no `export`. */
  MODULE_LOCAL_ACCESS = 'MODULE_LOCAL_ACCESS',
}
