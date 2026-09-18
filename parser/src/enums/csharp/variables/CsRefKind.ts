/**
 * Whether a local is an ALIAS — `cs_variable.refKind`.
 *
 * `ref var x = ref array[0]` makes `x` an alias: `x = 5` writes into the array.
 * An engine treating it as a copy loses the write entirely, which is a dataflow
 * edge and not a spelling.
 *
 * Separate from `isScoped` because `scoped` is a LIFETIME constraint and has
 * **two tree shapes** — conflating them loses one of the two facts.
 */
export enum CsRefKind {
  NONE = 'NONE',
  /** `ref var x = ref y` — writes through. */
  REF = 'REF',
  /** `ref readonly var x = ref y` — an alias that cannot be written. */
  REF_READONLY = 'REF_READONLY',
}
