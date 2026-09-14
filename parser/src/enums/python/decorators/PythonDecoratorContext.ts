/**
 * What the decorator is attached to.
 *
 * Doubles as the discriminator for `ownerHash` (§2.12 c3), which points at a
 * `py_type` for a class and a `py_method` for a function — the same polymorphic
 * pattern `py_scope.ownerKind` uses.
 *
 * Schema v7 §2.12 c2.
 */
export enum PythonDecoratorContext {
  /** On a `class`. */
  TYPE_DECLARATION = 'TYPE_DECLARATION',
  /** On a `def` at class or module level. */
  METHOD_DECLARATION = 'METHOD_DECLARATION',
  /** On a `def` inside another function — a closure, often a wrapper. */
  NESTED_FUNCTION_DECLARATION = 'NESTED_FUNCTION_DECLARATION',
}
