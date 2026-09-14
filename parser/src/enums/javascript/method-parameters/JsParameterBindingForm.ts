/**
 * The syntax that binds a parameter. Schema §3.5 c10.
 *
 * ## One parameter row, N variable rows
 *
 * A destructured parameter is **one** `js_method_parameter` row with
 * `patternBindingCount > 0`, plus N `js_variable` rows for the names it binds,
 * each with `bindingRegime = PARAMETER`.
 *
 * Both alternatives are worse and both are tempting:
 *
 * - **N parameter rows** breaks `position`. `function f({ a, b }, c)` has `c` at
 *   position 1; emitting `a` and `b` as parameters 0 and 1 puts `c` at 2, and
 *   every arity-based join is then off by one.
 * - **One row with no binding information** loses every name, so a call through
 *   a destructured parameter resolves to nothing.
 *
 * 6,909 destructuring patterns were measured, so this is not an edge case — it
 * is how modern JavaScript writes an options object.
 */
export enum JsParameterBindingForm {
  /** `function f(x)`. */
  IDENTIFIER = 'IDENTIFIER',

  /** `function f({ a, b: c })`. Binds by property name, with renaming. */
  OBJECT_PATTERN = 'OBJECT_PATTERN',

  /** `function f([a, , b])`. Binds by position, with holes. */
  ARRAY_PATTERN = 'ARRAY_PATTERN',

  /**
   * `function f(x = 1)`.
   *
   * The default expression is evaluated in the function's **own** scope at call
   * time, which is what makes `function f(a, b = a)` work — and is the one place
   * the scope builder deliberately diverges from Python's binder, where defaults
   * are evaluated in the enclosing scope.
   */
  ASSIGNMENT_PATTERN = 'ASSIGNMENT_PATTERN',
}
