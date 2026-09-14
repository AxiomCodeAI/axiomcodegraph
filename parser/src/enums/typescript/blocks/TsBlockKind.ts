/**
 * What kind of statement block this is.
 *
 * Positions 0–17 of `ts_block` mirror `java_block`, so this enum starts from
 * Java's `BlockKind`. Blocks earn their relation twice here: caller attribution,
 * as in Java, AND as the lexical scope of a `let`/`const` — which is what lets
 * `ts_variable` exist with no `ts_scope` relation.
 *
 * That second job is measured, not assumed: 34,798 identifier references, and the
 * `ts_block -> ts_method -> ts_type -> ts_module` chain reaches every one with
 * zero unreachable. The chain is only unbroken if these rows exist.
 *
 * ## ELSE_IF is not a synthetic convenience
 *
 * `else if` is a nested `IfStatement` in the AST. Flattening it loses which
 * guard governs which body, and the guard is the narrowing position — so the
 * chain is preserved with `ELSE_IF` naming the middle links and `ELSE` the last.
 *
 * ```ts
 * if (a) { }        // IF
 * else if (b) { }   // ELSE_IF
 * else { }          // ELSE
 * ```
 *
 * Schema §4.16 c0, ruling OQ-6.
 */
export enum TsBlockKind {
  /** A function body. */
  FUNCTION_BODY = 'FUNCTION_BODY',
  /** An arrow body written as a block. */
  ARROW_BODY = 'ARROW_BODY',
  /** The `then` branch of an `if`. */
  IF = 'IF',
  /** The `then` branch of an `else if` — a nested `IfStatement`. */
  ELSE_IF = 'ELSE_IF',
  /** A final `else`. */
  ELSE = 'ELSE',
  /** `for (…;…;…)`. */
  FOR = 'FOR',
  /** `for…of`. */
  FOR_OF = 'FOR_OF',
  /** `for…in`. */
  FOR_IN = 'FOR_IN',
  /** `for await…of`. */
  FOR_AWAIT_OF = 'FOR_AWAIT_OF',
  /** `while`. */
  WHILE = 'WHILE',
  /** `do…while`. */
  DO_WHILE = 'DO_WHILE',
  /** A `try` block. */
  TRY = 'TRY',
  /** A `catch` clause. Its binding is scoped here, not to the enclosing block. */
  CATCH = 'CATCH',
  /** A `finally` block. */
  FINALLY = 'FINALLY',
  /** A `case` clause. */
  SWITCH_CASE = 'SWITCH_CASE',
  /** A `default` clause. */
  SWITCH_DEFAULT = 'SWITCH_DEFAULT',
  /** A labelled statement's body. */
  LABELED = 'LABELED',
  /** A bare `{ … }` — a scope with no control flow. */
  BARE_BLOCK = 'BARE_BLOCK',
  /** `static { }` on a class. */
  STATIC_BLOCK = 'STATIC_BLOCK',
  /** A module body. */
  MODULE_BODY = 'MODULE_BODY',
  /** A namespace body. */
  NAMESPACE_BODY = 'NAMESPACE_BODY',
}
