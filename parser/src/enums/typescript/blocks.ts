/**
 * `ts_block` enums — schema §4.16.
 *
 * Blocks earn their relation twice over here: caller attribution, as in Java,
 * AND as the lexical scope of a `let`/`const`. The second job is what lets
 * `ts_variable` exist without a `ts_scope` relation (OQ-6).
 */

/** `ts_block` c0. */
export enum TsBlockKind {
  FUNCTION_BODY = 'FUNCTION_BODY',
  ARROW_BODY = 'ARROW_BODY',
  IF = 'IF',
  ELSE_IF = 'ELSE_IF',
  ELSE = 'ELSE',
  FOR = 'FOR',
  FOR_OF = 'FOR_OF',
  FOR_IN = 'FOR_IN',
  FOR_AWAIT_OF = 'FOR_AWAIT_OF',
  WHILE = 'WHILE',
  DO_WHILE = 'DO_WHILE',
  TRY = 'TRY',
  CATCH = 'CATCH',
  FINALLY = 'FINALLY',
  SWITCH_CASE = 'SWITCH_CASE',
  SWITCH_DEFAULT = 'SWITCH_DEFAULT',
  LABELED = 'LABELED',
  BARE_BLOCK = 'BARE_BLOCK',
  STATIC_BLOCK = 'STATIC_BLOCK',
  MODULE_BODY = 'MODULE_BODY',
  NAMESPACE_BODY = 'NAMESPACE_BODY',
}
