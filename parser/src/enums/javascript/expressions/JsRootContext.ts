/**
 * The statement form a depth-0 expression tree hangs under. Schema §3.10 c9.
 *
 * A consumer reading an expression row needs to know whether it is a value being
 * returned, a condition being tested, or a statement being executed for its
 * effect, and that is a property of the **statement**, not of the expression.
 * Without it, `f()` as a discarded call and `f()` as a returned value are
 * identical rows.
 */
export enum JsRootContext {
  /** A statement evaluated for its effect: `f();`, `x = 1;`. */
  EXPRESSION_STATEMENT = 'EXPRESSION_STATEMENT',

  /** A `var`/`let`/`const` initializer. */
  VARIABLE_INITIALIZER = 'VARIABLE_INITIALIZER',

  /** A class field's initializer. */
  FIELD_INITIALIZER = 'FIELD_INITIALIZER',

  /** A parameter's default value, evaluated at call time in the function's scope. */
  PARAMETER_DEFAULT = 'PARAMETER_DEFAULT',

  RETURN = 'RETURN',
  THROW = 'THROW',

  /** An `if`, `while`, `do` or `switch` test. */
  CONDITION = 'CONDITION',

  /** A `for` initializer, condition or incrementor. */
  FOR_HEADER = 'FOR_HEADER',

  /** The iterated expression of `for…in` / `for…of`. */
  ITERABLE = 'ITERABLE',

  /** A `case` clause's test expression. */
  SWITCH_CASE_TEST = 'SWITCH_CASE_TEST',

  /** A `class X extends <expr>` clause — which may be a call. */
  HERITAGE = 'HERITAGE',

  /** An `export default <expr>` or a `module.exports = <expr>` value. */
  EXPORT_VALUE = 'EXPORT_VALUE',

  /** A computed member or property name. */
  COMPUTED_NAME = 'COMPUTED_NAME',

  /** A `with (<expr>)` head. */
  WITH_TARGET = 'WITH_TARGET',

  /** A JSX expression container: `{…}` in markup. */
  JSX_EXPRESSION = 'JSX_EXPRESSION',

  /** A `@typedef`/`@param` default or value position. Type-only; never a call target. */
  JSDOC = 'JSDOC',
}
