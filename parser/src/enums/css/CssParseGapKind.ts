/**
 * What the CSS front end could not read, recorded as data.
 *
 * The CSS grammar is tolerant: an error inside a block ends that rule or declaration and
 * parsing resumes at the next. So a gap here is a bounded region of the file whose
 * rows are missing or whose text was kept RAW, and the stylesheet's other rows stand.
 */
export enum CssParseGapKind {
  /** An `ERROR` region or a token the grammar had to invent; `detail` says which, with the text. */
  PARSE_ERROR = 'PARSE_ERROR',

  /** Blocks still open at the end of a sheet: closed there, as a browser does (rules after them are nested). */
  UNCLOSED_BLOCK = 'UNCLOSED_BLOCK',

  /**
   * Text the grammar read as something CSS has no place for — a declaration outside any
   * rule, a rule inside a `style` attribute — so no row carries it. `detail` is the text, bounded.
   */
  UNPARSED_FRAGMENT = 'UNPARSED_FRAGMENT',

  /**
   * A `.css` file carrying preprocessor syntax (`$var`, `@mixin`, `@include`, `@extend`):
   * a Sass or Less file by content. Its rows are emitted as the grammar read them and this
   * row says they may be wrong.
   */
  PREPROCESSOR_SYNTAX = 'PREPROCESSOR_SYNTAX',

  /** More gaps than `WEB_PARSE_GAP_LIMIT` in one stylesheet: one row with the count of the rest. */
  GAP_LIMIT_REACHED = 'GAP_LIMIT_REACHED',
}
