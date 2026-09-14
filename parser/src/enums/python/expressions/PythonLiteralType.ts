/**
 * Which kind of literal a `LITERAL` expression is.
 *
 * `FSTRING` is distinguished from `STRING` because an f-string is not a
 * constant: it contains expressions that are evaluated, so it can read names,
 * make calls, and carry taint.
 *
 * Schema v6 §2.15 c9.
 */
export enum PythonLiteralType {
  STRING = 'STRING',
  BYTES = 'BYTES',
  RAW_STRING = 'RAW_STRING',
  /** An f-string: evaluated, not constant. */
  FSTRING = 'FSTRING',
  INTEGER = 'INTEGER',
  FLOAT = 'FLOAT',
  COMPLEX = 'COMPLEX',
  BOOLEAN = 'BOOLEAN',
  NONE = 'NONE',
  ELLIPSIS = 'ELLIPSIS',
}
