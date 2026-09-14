/**
 * Whether and how this callable has a body. Schema §3.4 c21.
 *
 * `EXPRESSION_BODY` is the value that earns the enum. A concise arrow —
 * `x => x * 2` — has a body that is an **expression**, not a block, so its
 * implicit return has no `return` statement to find. An extractor looking for
 * `ReturnStatement` nodes finds none and reports a function that returns
 * nothing, which is wrong for every point-free callback in the corpus.
 */
export enum JsBodyPresence {
  /** A `{ … }` block. */
  HAS_BODY = 'HAS_BODY',

  /** A concise arrow: `x => expr`. The expression IS the return value. */
  EXPRESSION_BODY = 'EXPRESSION_BODY',

  /**
   * No body at all.
   *
   * An overload signature has no JavaScript equivalent, so in practice this is
   * an abstract-shaped member in a `@typedef`, or a parse gap. Kept because an
   * always-empty value that is *written down* reads as a decision, and a missing
   * one reads as a bug.
   */
  NO_BODY = 'NO_BODY',
}
