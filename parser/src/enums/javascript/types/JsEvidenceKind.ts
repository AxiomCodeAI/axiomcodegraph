/**
 * What this row's existence rests on. Schema §3.2 c12.
 *
 * A two-value enum that exists because of one number: **1,825 `js_type` rows have
 * no declaration syntax anywhere.** A `@typedef` is a type declared in a
 * comment, and a consumer that assumes every type row corresponds to a
 * `class` or `function` keyword somewhere will look for one and not find it.
 *
 * Gate: every row with `COMMENT_ONLY` has a `jsdocCommentLinkHash` pointing at a
 * `js_comment` row whose `declaresType` is true. That is what makes the claim
 * checkable rather than asserted — the comment relation and the type relation
 * have to agree about which comments are declarations.
 */
export enum JsEvidenceKind {
  /** A `class` or `function` keyword in the source. */
  SYNTAX = 'SYNTAX',

  /** A JSDoc `@typedef`/`@callback` and nothing else. 1,825 rows. */
  COMMENT_ONLY = 'COMMENT_ONLY',
}
