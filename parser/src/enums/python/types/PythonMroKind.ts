/**
 * How a class's method resolution order is determined.
 *
 * This exists so the engine can distinguish "implicit `object`, trivial MRO"
 * from a real C3 linearisation from a base it cannot linearise at all, without
 * re-deriving it from `py_type_base` on every query. The measured
 * distribution justifies all four: 19.5% of classes have no explicit base and
 * 12.1% have more than one.
 *
 * Schema v6 §2.4 c21.
 */
export enum PythonMroKind {
  /** Multiple bases, all statically known — a real C3 linearisation. */
  C3_LINEARIZABLE = 'C3_LINEARIZABLE',

  /** Exactly one statically known base. */
  SINGLE_INHERITANCE = 'SINGLE_INHERITANCE',

  /** No explicit base: the MRO is `[cls, object]`. */
  IMPLICIT_OBJECT = 'IMPLICIT_OBJECT',

  /** At least one base is computed, so the MRO cannot be linearised statically. */
  DYNAMIC_UNKNOWN = 'DYNAMIC_UNKNOWN',
}
