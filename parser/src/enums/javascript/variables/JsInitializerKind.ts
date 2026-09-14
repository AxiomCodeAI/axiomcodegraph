/**
 * What a binding was initialised with, when that changes what the name means.
 * Schema §3.7 c13.
 *
 * ## `REQUIRE_CALL` is the single most load-bearing value in this schema
 *
 * `const x = require('y'); x.foo()` accounts for **15,759 of 45,804 oracle
 * declines — 34.4%**, the largest single cause by a wide margin. The call
 * `x.foo()` is unresolvable to the checker because `x` has no declared type, but
 * it is perfectly *reconstructable* by an engine: `x` is an alias for a module,
 * and the module is named by a `js_import` row that carries `resolvedFilePath`.
 *
 * This value is the hop that makes that reconstruction possible. Without it the
 * engine sees a local constant holding an opaque value; with it, plus
 * `importLinkHash`, it sees a module alias. Those three columns are the whole of
 * §5's resolution story, and they are why the 52.6% ceiling does not cap the
 * engine.
 *
 * The values are deliberately coarse. This column answers "does the name mean
 * something other than a value?", not "what is the value" — the initializer
 * expression is already a row, linked by `initializerExpressionLinkHash`.
 */
export enum JsInitializerKind {
  /** No initializer. A `var` with no value, or a `let` declared and assigned later. */
  NONE = 'NONE',

  /**
   * `require('x')`, or a destructured `const { a } = require('x')`.
   *
   * The name is a module alias. 34.4% of all oracle declines are calls through
   * one of these.
   */
  REQUIRE_CALL = 'REQUIRE_CALL',

  /** A name bound by an `import` declaration. Also a module alias, by the other route. */
  IMPORT_BINDING = 'IMPORT_BINDING',

  /**
   * A function expression or arrow.
   *
   * The name is a call target declared without the `function f()` syntax, and
   * it does **not** hoist — which is the distinction
   * `FUNCTION_DECLARATION_HOISTED` exists against.
   */
  FUNCTION = 'FUNCTION',

  /** A class expression. The name is a constructor. */
  CLASS = 'CLASS',

  /**
   * An object literal.
   *
   * Recorded because the pre-ES6 module pattern is an object literal of
   * functions, and a call through one of its properties is a real call edge that
   * no `js_type` row describes. Object literals are deliberately NOT types —
   * treating every one as a type is how a JavaScript fact base acquires 50,000
   * meaningless types.
   */
  OBJECT_LITERAL = 'OBJECT_LITERAL',

  /** Anything else: a literal, a call, a member access, an operator. */
  OTHER = 'OTHER',
}
