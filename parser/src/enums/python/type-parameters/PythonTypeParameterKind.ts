/**
 * Which of PEP 695's three parameter forms this is.
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
