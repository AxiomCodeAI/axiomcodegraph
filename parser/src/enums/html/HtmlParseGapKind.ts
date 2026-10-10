/**
 * What the HTML front end could not read, recorded as data.
 *
 * The grammar never fails a file: what it cannot read becomes an error region and
 * parsing resumes at the next tag. So a gap here is never "no tree" — it is a place
 * where the rows around it may not be what the author meant, which is exactly where a
 * consumer should distrust them.
 */
export enum HtmlParseGapKind {
  /**
   * A region the grammar could not read as HTML, a token it had to invent, an end tag
   * with no open element, or a second attribute with a name already used (the first
   * wins, as in a browser). `detail` names which, with the text.
   */
  PARSE_ERROR = 'PARSE_ERROR',

  /** An event-handler attribute or `javascript:` URL whose text is not a JavaScript script. */
  HANDLER_SYNTAX = 'HANDLER_SYNTAX',

  /** A `style` attribute whose text is not a declaration list; its readable declarations are still emitted. */
  STYLE_ATTRIBUTE_SYNTAX = 'STYLE_ATTRIBUTE_SYNTAX',

  /**
   * More parse errors than `WEB_PARSE_GAP_LIMIT` in one file: one row carrying the
   * count of the rest, so a minified or foreign-dialect file says how much is missing.
   */
  GAP_LIMIT_REACHED = 'GAP_LIMIT_REACHED',
}
