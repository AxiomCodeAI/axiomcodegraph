/**
 * What kind of literal, when the expression is one. Schema §3.10 c20.
 *
 * `NONE` for every expression that is not a literal, so the column is total
 * rather than optional — a `""` would be indistinguishable from "the extractor
 * did not look".
 */
export enum JsLiteralKind {
  STRING = 'STRING',
  NUMBER = 'NUMBER',

  /** A template with no substitutions, which is a string constant. */
  TEMPLATE = 'TEMPLATE',

  REGEX = 'REGEX',
  NULL = 'NULL',

  /**
   * `undefined`.
   *
   * Not a literal in the grammar — it is an identifier that resolves to a
   * global — and recorded as one here because every consumer wants it to be. The
   * `IDENTIFIER` row it also produces carries
   * `bindingResolution = GLOBAL_BUILTIN`, so nothing is lost.
   */
  UNDEFINED = 'UNDEFINED',

  BOOLEAN = 'BOOLEAN',
  BIGINT = 'BIGINT',

  /** Not a literal. */
  NONE = 'NONE',
}
