/**
 * How a name is bound in a scope — the resolved outcome of CPython's two-pass
 * symbol-table analysis, one value per `(scope, name)` pair.
 *
 * This is Python's `local_variable` table *and* its global/nonlocal/free/import/
 * parameter table, unified. It is why 50.7% of method calls — those with a bare
 * name as the receiver — become resolvable at all.
 *
 * ## The distinctions that carry weight
 *
 * ```python
 * def make_counter():
 *     count = 0            # CELL   — bound here AND captured by a nested scope
 *     def bump():
 *         nonlocal count   # NONLOCAL / FREE — resolves to make_counter's binding
 *         count += 1
 *     return bump
 *
 * def read():
 *     return counter       # GLOBAL_IMPLICIT — never bound here, so module-level
 *
 * def write():
 *     global counter       # GLOBAL_EXPLICIT — the `global` statement
 *     counter = 1
 * ```
 *
 * `CELL` vs `LOCAL` is the difference between a variable that lives in a closure
 * cell and one that lives in a frame slot; CPython computes it only after
 * analysing every child scope, which is why this cannot be decided in one pass.
 *
 * Schema v6 §2.3 c2.
 */
export enum PythonBindingKind {
  /** Bound in this scope and not captured by any nested scope. */
  LOCAL = 'LOCAL',

  /** Declared with a `global` statement in this scope. */
  GLOBAL_EXPLICIT = 'GLOBAL_EXPLICIT',

  /** Referenced but never bound here — resolves to the module namespace. */
  GLOBAL_IMPLICIT = 'GLOBAL_IMPLICIT',

  /** Declared with a `nonlocal` statement in this scope. */
  NONLOCAL = 'NONLOCAL',

  /** Free variable: referenced here, bound in an enclosing function scope. */
  FREE = 'FREE',

  /** Bound here **and** captured by a nested scope — lives in a closure cell. */
  CELL = 'CELL',

  /** A parameter of this function, lambda, or the synthetic `.0` iterator. */
  PARAMETER = 'PARAMETER',

  /** Bound by an `import` / `from ... import` statement. */
  IMPORTED = 'IMPORTED',

  /** Bound in a class body — becomes a class attribute, not a closure local. */
  CLASS_ATTRIBUTE = 'CLASS_ATTRIBUTE',

  /** Bound at module level: simultaneously local and global, as CPython models it. */
  MODULE_LEVEL = 'MODULE_LEVEL',

  /** Resolves to a builtin. */
  BUILTIN = 'BUILTIN',

  /** Carries an annotation but no value — `x: int` with no assignment. */
  ANNOTATED_ONLY = 'ANNOTATED_ONLY',

  /** Could not be classified. An honest negative, never a guess. */
  UNKNOWN = 'UNKNOWN',
}
