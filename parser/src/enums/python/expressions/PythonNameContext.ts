/**
 * How a name is used at a given occurrence — mirrors `ast.Load` / `ast.Store` /
 * `ast.Del` exactly.
 *
 * This is a real schema column (`py_expression.nameContext`), and it also drives
 * pass 1 of symbol-table construction: the same identifier node contributes
 * `USE` in a load position and `DEF_LOCAL` in a store position.
 *
 * ## Examples
 *
 * ```python
 * y = x        # `x` is LOAD, `y` is STORE
 * del y        # `y` is DEL
 * self.a = 1   # `self` is LOAD; `a` is an attribute label, not a name at all
 * ```
 *
 * Schema v6 §2.15 c27.
 */
export enum PythonNameContext {
  /** The name is read. */
  LOAD = 'LOAD',

  /** The name is written — an assignment, loop target, parameter, or capture. */
  STORE = 'STORE',

  /** The name is unbound by a `del` statement. */
  DEL = 'DEL',
}
