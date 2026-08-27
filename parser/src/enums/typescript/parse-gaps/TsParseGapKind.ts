/**
 * Why a construct could not be represented.
 *
 * ## An always-empty relation that must exist anyway
 *
 * Measured **zero** rows over 25.9 MB of real TypeScript with
 * `ts.createSourceFile` — and that is precisely the argument for emitting it. An
 * always-empty relation that suddenly has rows is a SIGNAL. A missing relation
 * is a silence, and the difference matters on the day a file starts failing to
 * parse: one shows up as data, the other as slightly fewer facts than yesterday.
 *
 * The relation RECORDS the gap and never rewrites source. Positions stay
 * measured, so a consumer can go and look.
 *
 * `FILE_TOO_LARGE` exists for provenance rather than for use here: it is the
 * tree-sitter 32,767-character ceiling that the compiler's own parser does not
 * have, and 4.7% of real TypeScript files exceed it. Keeping the member means a
 * future move to tree-sitter reports the truncation rather than losing it.
 *
 * Schema §4.20 c0.
 */
export enum TsParseGapKind {
  /** The parser produced a diagnostic. `diagnosticCode` carries its number. */
  PARSE_DIAGNOSTIC = 'PARSE_DIAGNOSTIC',
  /** Syntax the extractor has no representation for. */
  UNSUPPORTED_SYNTAX = 'UNSUPPORTED_SYNTAX',
  /** Beyond the parse-buffer ceiling. Never fires under `ts.createSourceFile`. */
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  /** The file could not be decoded as UTF-8. */
  ENCODING_ERROR = 'ENCODING_ERROR',
  /** The file could not be read. */
  READ_ERROR = 'READ_ERROR',
  /** Claimed by no tsconfig, so no program governs it. */
  EXCLUDED_BY_CONFIG = 'EXCLUDED_BY_CONFIG',
}
