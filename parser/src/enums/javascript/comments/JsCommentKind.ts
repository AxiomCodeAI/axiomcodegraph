/**
 * What kind of comment. Schema §3.15 c0.
 *
 * ## In this language a comment can be a declaration
 *
 * That is the reason this relation is not decoration. 1,825 `@typedef` and 103
 * `@callback` tags declare **types with no declaration syntax anywhere**, so a
 * `js_type` row can have a `startLine` inside a comment and
 * `evidenceKind = COMMENT_ONLY`. `js_comment.declaresType` is the corroborating
 * column, and the gate asserts the two relations agree: every `COMMENT_ONLY`
 * type points at a comment whose `declaresType` is true.
 *
 * Comments are **trivia** — not in the AST — so no tree walk reaches them and
 * the scan is separate by necessity.
 */
export enum JsCommentKind {
  /** `// …` */
  LINE = 'LINE',

  /** `/* … *\/` with no JSDoc marker. */
  BLOCK = 'BLOCK',

  /**
   * `/** … *\/`.
   *
   * **A type annotation, not a comment.** The compiler parses `@param`,
   * `@returns`, `@type`, `@typedef`, `@template`, `@extends` and `@implements`
   * into `node.jsDoc` and *uses* them for inference under `checkJs`. 37.9% of
   * parameters get their declared type from one, against effectively none from syntax.
   */
  JSDOC = 'JSDOC',

  /** `'use strict'`, `@flow`, `// @ts-check`, a source-map URL. */
  DIRECTIVE = 'DIRECTIVE',

  /** `#!/usr/bin/env node`. Legal only on line 1, and not a comment to the grammar. */
  SHEBANG = 'SHEBANG',
}
