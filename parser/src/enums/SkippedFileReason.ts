/**
 * Reason why a source file was skipped during analysis. Generic enum that applies to all things.
 *
 * ## Examples
 *
 * - `EMPTY_CONTENT` — file exists but has no meaningful content
 * - `READ_ERROR` — file could not be read (permissions, encoding, etc.)
 */
export enum SkippedFileReason {
  /** File was empty or contained only whitespace */
  EMPTY_CONTENT = 'EMPTY_CONTENT',

  /** File could not be read due to an I/O or encoding error */
  READ_ERROR = 'READ_ERROR',

  /** File exceeded LARGE_FILE_LINE_THRESHOLD and was skipped */
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
}
