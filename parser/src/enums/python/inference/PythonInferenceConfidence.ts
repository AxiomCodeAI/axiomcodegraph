/**
 * How much weight an inferred type carries.
 *
 * `CERTAIN` means the syntax leaves no alternative: `[]` is a `list`, and no
 * amount of surrounding code makes it something else. `PROBABLE` means the
 * syntax names a type but the runtime can differ — an annotation is not
 * enforced, so `x: int` may hold a `str` and Python will not complain.
 *
 * The distinction matters for a security rule: acting on `CERTAIN` is sound,
 * while acting on `PROBABLE` is a heuristic and should be reported as one.
 *
 * Schema v7 §2.15 c36.
 */
export enum PythonInferenceConfidence {
  /** The syntax admits no other type. */
  CERTAIN = 'CERTAIN',
  /** The syntax names a type that the runtime is not obliged to honour. */
  PROBABLE = 'PROBABLE',
  /** No inference was made. */
  NONE = 'NONE',
}
