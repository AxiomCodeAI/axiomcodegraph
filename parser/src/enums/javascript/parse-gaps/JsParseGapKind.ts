/**
 * What the parser could not do, recorded as **data rather than a log line**.
 * Schema §3.16 c0.
 *
 * ## Why this is a relation and not a warning
 *
 * §9 of `BUILDING-A-PARSER.md`: *if the analyzer drops something for a
 * structural reason, it must say so.* On one large framework checkout a nested config silently
 * excluded 1,270 of 1,821 files and **nothing counted them** — the run reported
 * success with a fact base missing two thirds of the project. A log line is not
 * a count, and a count that is not in the fact base cannot be joined against the
 * rows that are.
 */
export enum JsParseGapKind {
  /**
   * `ts.createSourceFile` reported a syntactic diagnostic.
   *
   * Should be rare. Emitted anyway, because an always-empty relation that
   * suddenly has rows is a signal and a missing relation is a silence.
   */
  PARSE_ERROR = 'PARSE_ERROR',

  /**
   * The depth cap was reached and a subtree was dropped.
   *
   * The cap is **32**, not TypeScript's effective 20: the corpus has a maximum
   * AST depth of 67 and a p99 of 26, so a cap of 20 truncates code that exists.
   * The parent is marked `isTruncated`, so a lost subtree is visible rather than
   * silent — and the cap stays, because a cap that can never fire is a cap
   * nobody maintains.
   */
  DEPTH_CAP_REACHED = 'DEPTH_CAP_REACHED',

  /** `require(variable)`. The edge is real and the target is unknowable. */
  NON_LITERAL_SPECIFIER = 'NON_LITERAL_SPECIFIER',

  /**
   * A JSDoc type expression the parser could not decompose.
   *
   * JSDoc type syntax is **not standardised** — Closure, TypeScript and
   * jsdoc.app all differ — so this is expected to be non-empty, and the row
   * preserves the text rather than dropping the tag or guessing at it.
   */
  UNKNOWN_JSDOC_SYNTAX = 'UNKNOWN_JSDOC_SYNTAX',

  /** A `with` body, where no name is statically resolvable. */
  WITH_STATEMENT_SCOPE = 'WITH_STATEMENT_SCOPE',

  /** `eval` or `new Function`. The call is emitted; the target cannot be. */
  DYNAMIC_CODE = 'DYNAMIC_CODE',

  /**
   * Flow syntax the TypeScript grammar does not share.
   *
   * `ts.createSourceFile` mis-parses these **silently**, so the gap row is the
   * only place the disagreement becomes visible.
   */
  FLOW_SYNTAX = 'FLOW_SYNTAX',
}
