/**
 * Where the ROOT of an expression tree sits in the surrounding syntax.
 *
 * Inherited by every node in the tree, so a leaf can be filtered by the
 * statement that contains it without walking to the root. "Every call in a
 * condition", "every `new` in a field initializer" are one predicate each.
 *
 * ## Two contexts that carry behavioural weight
 *
 * `PARAMETER_DEFAULT` — the tree runs on every call that omits the argument, not
 * once. `FIELD_INITIALIZER` — the tree runs on every construction. A rule
 * counting allocations or side effects needs both, and neither is visible from
 * the expression's own kind.
 *
 * `DECORATOR_EXPRESSION` is where TypeScript departs from Java hardest: a Java
 * annotation is inert metadata, while a decorator is an expression that RUNS at
 * class-definition time and may REPLACE its target.
 *
 * Schema §4.14 c2.
 */
export enum TsRootContext {
  /** A statement that is just an expression. */
  EXPRESSION_STATEMENT = 'EXPRESSION_STATEMENT',
  /** The initializer of a `const`/`let`/`var`. */
  VARIABLE_INITIALIZER = 'VARIABLE_INITIALIZER',
  /** A member initializer — runs on every construction. */
  FIELD_INITIALIZER = 'FIELD_INITIALIZER',
  /** The operand of `return`. */
  RETURN_VALUE = 'RETURN_VALUE',
  /** An `if`, `while`, `do` or `for` condition — the narrowing position. */
  CONDITION = 'CONDITION',
  /** An argument list evaluated outside a call node. */
  ARGUMENT_LIST = 'ARGUMENT_LIST',
  /** The operand of `throw`. */
  THROW_VALUE = 'THROW_VALUE',
  /** The subject of a `switch`. */
  SWITCH_SUBJECT = 'SWITCH_SUBJECT',
  /** A `case` label. */
  CASE_LABEL = 'CASE_LABEL',
  /** A `for` initializer or incrementor, or a `for…of` iterable. */
  LOOP_HEADER = 'LOOP_HEADER',
  /** A parameter default — runs on every call that omits the argument. */
  PARAMETER_DEFAULT = 'PARAMETER_DEFAULT',
  /** A decorator expression — runs at class-definition time and may replace its target. */
  DECORATOR_EXPRESSION = 'DECORATOR_EXPRESSION',
  /** `export default <expr>` or `export = <expr>`. */
  EXPORT_VALUE = 'EXPORT_VALUE',
  /** An enum member's initializer. */
  ENUM_MEMBER_VALUE = 'ENUM_MEMBER_VALUE',
  /** A class `extends` clause — evaluated at runtime, including the mixin form. */
  HERITAGE_EXPRESSION = 'HERITAGE_EXPRESSION',
  /** A concise arrow body. */
  ARROW_BODY_EXPRESSION = 'ARROW_BODY_EXPRESSION',
  /** A computed member name: `[key]` in `{ [key]: 1 }`. */
  COMPUTED_PROPERTY_NAME = 'COMPUTED_PROPERTY_NAME',
  /** The operand of a top-level `await` or `yield`. */
  YIELD_OR_AWAIT_OPERAND = 'YIELD_OR_AWAIT_OPERAND',
  /** A position not otherwise named. Recorded rather than guessed at. */
  /**
   * The expression inside a JSX brace: `{t(msg)}` as a child, or
   * `label={t(msg)}` as an attribute value.
   *
   * NOT one of the reserved TSX values. Those describe the component CALL --
   * `<Badge/>` as `Badge({...})`, with attributes as JSX_ATTRIBUTE_VALUE edges
   * under argument 0 -- and that whole structure stays empty in freeze 1.
   * This is narrower and independent: a call written inside a brace is an
   * ordinary call that happens to sit in JSX, and dropping it cost 4,488 of
   * one React application's 14,335 call sites. It is a ROOT because the JSX element above
   * it emits no row to be a child of.
   */
  JSX_EMBEDDED_EXPRESSION = 'JSX_EMBEDDED_EXPRESSION',

  UNKNOWN_CONTEXT = 'UNKNOWN_CONTEXT',
}
