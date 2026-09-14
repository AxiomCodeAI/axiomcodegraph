/**
 * Discriminator for `py_scope.ownerHash`, which is polymorphic.
 *
 * Invariant #1 (referential integrity) resolves a polymorphic FK in the
 * relation selected by its discriminator, so this column decides which table
 * `ownerHash` is looked up in.
 *
 * Schema v6 §2.2 c6.
 */
export enum PythonScopeOwnerKind {
  /** Owner is a `py_module` row (module scope). */
  MODULE = 'MODULE',

  /** Owner is a `py_type` row (class body scope). */
  TYPE = 'TYPE',

  /** Owner is a `py_method` row (`def` / `async def`). */
  METHOD = 'METHOD',

  /** Owner is the synthetic `py_method` minted for a `lambda`. */
  LAMBDA = 'LAMBDA',

  /** Owner is a comprehension or generator expression. */
  COMPREHENSION = 'COMPREHENSION',
}
