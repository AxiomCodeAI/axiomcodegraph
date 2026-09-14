/**
 * What the **facts were emitted under** — a property of the analysis run, not
 * of the file.
 *
 * This is the single column the engine branches on for comprehension scoping,
 * and it is in `py_module`'s primary key so that two regimes can never collide
 * even if both fact sets are loaded at once.
 *
 * ## Why this cannot be inferred
 *
 * The two regimes disagree **structurally** on the most common construct in the
 * language, while agreeing **semantically**:
 *
 * ```
 * Construct   PY3_0_11                     PY3_12_PLUS
 * listcomp    own scope + synthetic `.0`    no scope (PEP 709 inlined)
 * setcomp     own scope + `.0`              no scope (inlined)
 * dictcomp    own scope + `.0`              no scope (inlined)
 * genexpr     own scope + `.0`              own scope + `.0`
 * ```
 *
 * In both regimes the comprehension target is isolated from the enclosing
 * scope, so runtime semantics cannot tell you which regime produced a fact set,
 * and a harness that infers the regime from its own output is confidently wrong
 * on one of them. Hence the regime is an **input**, recorded in the fact table.
 *
 * `PY3_0_11` is the freeze target because it is the *richer* regime: emission is
 * implemented there and gated off for 3.12, which is subtractive and keeps every
 * golden file exercising the path.
 *
 * Schema v6 §2.1 c11, §4.4.
 */
export enum PythonEmissionRegime {
  /** Python 3.0–3.11: list/set/dict comprehensions and genexprs all get scopes. */
  PY3_0_11 = 'PY3_0_11',

  /** Python 3.12+: PEP 709 inlines list/set/dict comprehensions; genexpr keeps its scope. */
  PY3_12_PLUS = 'PY3_12_PLUS',
}
