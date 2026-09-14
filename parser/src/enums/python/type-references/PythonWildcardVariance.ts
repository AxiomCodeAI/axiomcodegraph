/**
 * TypeVar variance, occupying Java's wildcard-variance column.
 *
 * Python spells it on the `TypeVar` itself — `TypeVar("T", covariant=True)` —
 * rather than at the use site as Java's `? extends` does, but the column serves
 * the same purpose and keeps position parity.
 *
 * Schema v6 §2.6 c12.
 */
export enum PythonWildcardVariance {
  COVARIANT = 'COVARIANT',
  CONTRAVARIANT = 'CONTRAVARIANT',
  INVARIANT = 'INVARIANT',
}
