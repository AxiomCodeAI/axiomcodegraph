/**
 * Method access level inferred from leading underscores.
 *
 * `DUNDER_ACCESS` is separate from `PRIVATE_ACCESS` because the two behave
 * oppositely: `__x` is name-mangled and effectively private, while `__x__` is
 * **not** mangled and is the public protocol surface the interpreter itself
 * calls.
 *
 * Schema v6 §2.7 c10.
 */
export enum PythonMethodAccess {
  /** No leading underscore. */
  PUBLIC_ACCESS = 'PUBLIC_ACCESS',

  /** One leading underscore. */
  PROTECTED_ACCESS = 'PROTECTED_ACCESS',

  /** Two leading underscores, not dunder — name-mangled. */
  PRIVATE_ACCESS = 'PRIVATE_ACCESS',

  /** A `__dunder__` name: not mangled, and called by the interpreter. */
  DUNDER_ACCESS = 'DUNDER_ACCESS',
}
