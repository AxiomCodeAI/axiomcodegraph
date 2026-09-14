/**
 * Variance of a type parameter.
 *
 * PEP 695 removed the explicit `covariant=True` spelling: variance is now
 * INFERRED by the type checker from how the parameter is used. So a parser
 * reading 3.12 syntax honestly reports `INFERRED` and not a guess — the other
 * values exist for the legacy `TypeVar(..., covariant=True)` form, which is a
 * runtime assignment rather than syntax and lands in `py_binding` instead.
 *
 * Schema v7 §2.20 c9.
 */
export enum PythonTypeParameterVariance {
  /** PEP 695: the checker infers it, and the source does not say. */
  INFERRED = 'INFERRED',
  INVARIANT = 'INVARIANT',
  COVARIANT = 'COVARIANT',
  CONTRAVARIANT = 'CONTRAVARIANT',
}
