/**
 * `scoped` on a parameter — `cs_method_parameter.scopedModifier`.
 *
 * C# 11. It constrains where a `ref` or a `ref struct` value may ESCAPE to: a
 * `scoped` parameter's value cannot outlive the call. That is a lifetime fact,
 * not a passing convention, which is why it is a separate column from
 * `parameterMode` rather than more values inside it — `scoped ref` and
 * `scoped in` are both real and would otherwise multiply the mode enum.
 */
export enum CsScopedModifier {
  /** `scoped` is present. */
  SCOPED = 'SCOPED',

  /** Absent, which is the default and imposes no lifetime constraint. */
  NONE = 'NONE',
}
