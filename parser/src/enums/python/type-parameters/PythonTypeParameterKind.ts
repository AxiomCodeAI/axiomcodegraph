/**
 * Which of PEP 695's three parameter forms this is.
 *
 * **NOT EMITTED — there is no column for it.** §2.20 declares fourteen columns
 * and none carries a parameter kind, so `*Ts` and `**P` are currently
 * INDISTINGUISHABLE in `py_type_parameter`: both appear as a plain name with an
 * empty bound. That is a real loss — a TypeVarTuple stands for a sequence of
 * types and a ParamSpec for a whole parameter list, so `Callable[P, R]` and
 * `tuple[*Ts]` are different shapes that read identically in the facts.
 *
 * Kept rather than deleted because the distinction is real and the extractor
 * already recovers it from source text; it needs a column to live in. Raised
 * with A0 as a schema question. Until then this enum is deliberately unused, and
 * saying so here is better than leaving a reader to wonder why nothing
 * references it.
 *
 * tree-sitter does NOT distinguish them: `*Ts` and `**P` both parse to
 * `splat_type` with an identifier under it, so the kind has to come from the
 * source text. They are genuinely different things — a TypeVarTuple stands for a
 * SEQUENCE of types and a ParamSpec for a whole parameter LIST — and collapsing
 * them would make `Callable[P, R]` and `tuple[*Ts]` look like the same shape.
 *
 * Schema v7 §2.20.
 */
export enum PythonTypeParameterKind {
  /** `T` — one type. */
  TYPE_VAR = 'TYPE_VAR',
  /** `*Ts` — a variadic sequence of types (PEP 646). */
  TYPE_VAR_TUPLE = 'TYPE_VAR_TUPLE',
  /** `**P` — a callable's whole parameter list (PEP 612). */
  PARAM_SPEC = 'PARAM_SPEC',
}
