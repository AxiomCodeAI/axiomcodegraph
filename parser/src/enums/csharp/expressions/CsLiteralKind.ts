/**
 * What kind of literal — `cs_expression.literalKind`.
 *
 * `VERBATIM_STRING` and `RAW_STRING` are separate from `STRING` because their
 * CONTENT rules differ: `@"a\b"` has no escapes and `"""..."""` strips a common
 * indent. A consumer reading `literalValue` needs to know which rules produced
 * it, and a single `STRING` would make the text ambiguous.
 */
export enum CsLiteralKind {
  NONE = 'NONE',
  INTEGER = 'INTEGER',
  REAL = 'REAL',
  CHARACTER = 'CHARACTER',
  STRING = 'STRING',
  /** `@"..."` — backslash is not an escape. */
  VERBATIM_STRING = 'VERBATIM_STRING',
  /** `"""..."""` — C# 11. A common indent is stripped from every line. */
  RAW_STRING = 'RAW_STRING',
  BOOLEAN = 'BOOLEAN',
  NULL = 'NULL',
  /** `default` with no type — the value depends on the target type. */
  DEFAULT_LITERAL = 'DEFAULT_LITERAL',
}
