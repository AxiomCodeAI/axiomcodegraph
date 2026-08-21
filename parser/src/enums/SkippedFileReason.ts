/**
 * Reason why a source file was skipped during analysis. Generic enum that applies to all things.
 *
 * ## Examples
 *
 * - `EMPTY_CONTENT` — file exists but has no meaningful content
 * - `READ_ERROR` — file could not be read (permissions, encoding, etc.)
 * - `PY2_CONSTRUCT_DETECTED` — Python 2 source, which is out of scope and must be
 *   rejected explicitly rather than misinterpreted
 */
export enum SkippedFileReason {
  /** File was empty or contained only whitespace */
  EMPTY_CONTENT = 'EMPTY_CONTENT',

  /** File could not be read due to an I/O or encoding error */
  READ_ERROR = 'READ_ERROR',

  /** File exceeded LARGE_FILE_LINE_THRESHOLD and was skipped */
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',

  /**
   * A Python-2-only construct was detected, so the file was rejected wholesale.
   *
   * This reason exists because `tree-sitter-python@0.21.0` parses Python 2
   * **without erroring** — it carries first-class `print_statement`,
   * `exec_statement` and `chevron` nodes, so `print "x"` yields a clean tree
   * with `hasError === false`. Emitting facts from it would silently apply
   * Python 3 scoping semantics to Python 2 source. Rejection is therefore
   * explicit, and the offending construct and span are recorded rather than
   * merely absent.
   */
  PY2_CONSTRUCT_DETECTED = 'PY2_CONSTRUCT_DETECTED',

  /**
   * The extractor threw while processing a file that read and parsed fine.
   *
   * Distinct from `READ_ERROR` on purpose, and the distinction is not cosmetic:
   * `READ_ERROR` says the environment failed, which is nobody's bug, while this
   * says the PARSER failed, which is always a bug. Filing the second as the first
   * is how a crash in every file of a corpus can produce an empty relation and a
   * run that still reports success.
   */
  EXTRACTION_ERROR = 'EXTRACTION_ERROR',
}
