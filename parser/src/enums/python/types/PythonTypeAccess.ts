/**
 * Access level inferred from a name's leading underscores.
 *
 * Python has no access keywords; visibility is a naming convention, and exactly
 * one part of it is enforced by the language (name mangling of `__x`).
 *
 * ## Examples
 *
 * ```python
 * class Service: ...     # PUBLIC_ACCESS
 * class _Internal: ...   # PROTECTED_ACCESS — convention only
 * class __Private: ...   # PRIVATE_ACCESS   — name-mangled by the compiler
 * ```
 *
 * Schema v6 §2.4 c4.
 */
export enum PythonTypeAccess {
  /** No leading underscore. */
  PUBLIC_ACCESS = 'PUBLIC_ACCESS',

  /** One leading underscore — "internal use" by convention. */
  PROTECTED_ACCESS = 'PROTECTED_ACCESS',

  /** Two leading underscores — name-mangled, the only enforced case. */
  PRIVATE_ACCESS = 'PRIVATE_ACCESS',
}
