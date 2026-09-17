/**
 * What a `cs_block` row is — schema §3.19.
 *
 * ## `LABELED` is here because its absence was a MEASURED defect
 *
 * TypeScript emitted `FOR` for `outer: for (…)` and dropped the label entirely.
 * The loop was there, the label was not, and nothing counted it — the enum
 * audit found it, because the value was declared and never emitted. `goto outer`
 * then had no target an engine could name.
 *
 * ## Why a block relation at all
 *
 * A block is where a LOCAL lives, and scope is what decides whether two `x`s are
 * one binding. Without blocks the parser can say a variable exists and not where
 * it is visible, and shadowing becomes unanswerable.
 */
export enum CsBlockKind {
  METHOD_BODY = 'METHOD_BODY',
  CONSTRUCTOR_BODY = 'CONSTRUCTOR_BODY',
  /** A property or event accessor's body. Ordinary code that calls things. */
  ACCESSOR_BODY = 'ACCESSOR_BODY',
  LOCAL_FUNCTION_BODY = 'LOCAL_FUNCTION_BODY',
  LAMBDA_BODY = 'LAMBDA_BODY',
  IF = 'IF',
  ELSE = 'ELSE',
  FOR = 'FOR',
  FOREACH = 'FOREACH',
  WHILE = 'WHILE',
  DO = 'DO',
  /** One `case`/`default` group. C# scopes the whole switch body, not each. */
  SWITCH_SECTION = 'SWITCH_SECTION',
  TRY = 'TRY',
  /** `catchTypeNames` carries what it catches — an exception EDGE, as written. */
  CATCH = 'CATCH',
  /** Runs on every path out, including an exception. */
  FINALLY = 'FINALLY',
  USING = 'USING',
  LOCK = 'LOCK',
  FIXED = 'FIXED',
  UNSAFE = 'UNSAFE',
  CHECKED = 'CHECKED',
  UNCHECKED = 'UNCHECKED',
  /** `outer: for (…)` — the label is a GOTO TARGET and was measured lost in TS. */
  LABELED = 'LABELED',
  /** A bare `{ }` used only to scope its locals. */
  ANONYMOUS = 'ANONYMOUS',
}
