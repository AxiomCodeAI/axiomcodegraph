/**
 * A lexical block's form. Schema §3.12 c0.
 *
 * ## A block is syntax; a scope is binding
 *
 * They are separate relations because they are not in 1:1 correspondence. A bare
 * `{}` containing only `var` declarations is a block that opens **no scope**; a
 * function's parameter list and body are one scope spanning two syntactic
 * regions. `js_block.opensScope` and `scopeLinkHash` carry the join, and a `""`
 * there is a real answer rather than a missing one.
 *
 * ## Every block form gets a row, including the ones that emit nothing else
 *
 * TypeScript's enum audit found `NAMESPACE_BODY` and `MODULE_BODY` producing
 * **no block row at all**, on two separate early-return paths, and nothing else
 * caught it because no row was misplaced — there simply were none. `LABELED` is
 * the same lesson in the other direction: `outer: for (…)` emitted the `FOR` and
 * **dropped the label**, so a `continue outer` had no target to join to.
 */
export enum JsBlockKind {
  /** A function, arrow, method or accessor body. */
  FUNCTION_BODY = 'FUNCTION_BODY',

  /** A bare `{ … }`. */
  BLOCK = 'BLOCK',

  IF = 'IF',
  ELSE = 'ELSE',
  FOR = 'FOR',
  FOR_IN = 'FOR_IN',
  FOR_OF = 'FOR_OF',
  WHILE = 'WHILE',
  DO = 'DO',
  TRY = 'TRY',
  CATCH = 'CATCH',
  FINALLY = 'FINALLY',
  SWITCH = 'SWITCH',

  /**
   * One `case`/`default` clause.
   *
   * A clause is a block for structure and **not** a scope: every clause in one
   * `switch` shares one scope, so `case 1: let x = 1; case 2: x;` refers to one
   * binding. Emitting a scope per clause would make the second reference
   * unresolved.
   */
  SWITCH_CASE = 'SWITCH_CASE',

  /**
   * `outer: for (…)`.
   *
   * The value TypeScript's audit found unemitted while the loop emitted fine.
   * `js_block.label` is why that cannot happen here: without it a
   * `break outer` names a target nothing in the fact base identifies.
   */
  LABELED = 'LABELED',

  /** A class body. */
  CLASS_BODY = 'CLASS_BODY',

  /** `static { … }`. */
  CLASS_STATIC_BLOCK = 'CLASS_STATIC_BLOCK',

  /** The file's top level, so top-level statements have a block to belong to. */
  MODULE_BODY = 'MODULE_BODY',
}
