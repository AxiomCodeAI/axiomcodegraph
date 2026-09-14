/**
 * Discriminator for `py_binding.targetEntityHash`, which is polymorphic.
 *
 * `NONE` is the honest default: most bindings — a local integer, a loop
 * variable — point at no declared entity, and inventing one would be a
 * confident wrong answer of exactly the kind this schema is organised against.
 *
 * Schema v6 §2.3 c22.
 */
export enum PythonBindingTargetKind {
  /** The name binds a `class` — target is a `py_type` row. */
  TYPE = 'TYPE',

  /** The name binds a `def` / `async def` — target is a `py_method` row. */
  METHOD = 'METHOD',

  /** The name was bound by an import — target is a `py_import` row. */
  IMPORT = 'IMPORT',

  /** The name is a parameter — target is a `py_method_parameter` row. */
  PARAMETER = 'PARAMETER',

  /** An ordinary variable with no declaration-site entity. */
  VARIABLE = 'VARIABLE',

  /** The name refers to a module. */
  MODULE = 'MODULE',

  /** The name is a `TypeVar`. */
  TYPE_VAR = 'TYPE_VAR',

  /** The name is a type alias. */
  TYPE_ALIAS = 'TYPE_ALIAS',

  /** No target entity — the default. */
  NONE = 'NONE',
}
