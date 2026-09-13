/**
 * What a comment documents. Schema §3.15 c7.
 *
 * Attachment is by **start offset**, because that is what a trivia scan knows
 * about the node it precedes — and recorded first-wins, since several nodes
 * begin at one offset (a declaration and its own name) and the **outermost** is
 * the one a preceding comment documents.
 */
export enum JsCommentAttachmentKind {
  METHOD = 'METHOD',
  TYPE = 'TYPE',
  FIELD = 'FIELD',
  VARIABLE = 'VARIABLE',

  /** A file-level comment: a licence header, a `@flow` pragma, a shebang. */
  MODULE = 'MODULE',

  /** Attached to nothing. A comment between statements, or one inside a body. */
  NONE = 'NONE',
}
