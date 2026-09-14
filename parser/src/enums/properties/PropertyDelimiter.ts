/**
 * Delimiter type used to separate key from value in a .properties file line.
 *
 * ## Examples
 *
 * ```properties
 * # EQUALS delimiter
 * app.name=Auth Service
 *
 * # COLON delimiter
 * app.name: Auth Service
 *
 * # SPACE delimiter (first whitespace after key)
 * app.name Auth Service
 *
 * # NONE - key with no value at all (no delimiter present)
 * some.flag
 * ```
 */
export enum PropertyDelimiter {
  /** Key-value separated by `=` (most common) */
  EQUALS = 'EQUALS',

  /** Key-value separated by `:` */
  COLON = 'COLON',

  /** Key-value separated by whitespace only (no `=` or `:`) */
  SPACE = 'SPACE',

  /** Key has no delimiter and no value (standalone key, value defaults to empty string) */
  NONE = 'NONE',
}
