/**
 * Type of a value in a YAML document.
 *
 * ## Examples
 *
 * ```yaml
 * # STRING
 * app.name: My Service
 * quoted: "hello world"
 *
 * # INTEGER
 * server.port: 8080
 *
 * # FLOAT
 * timeout: 30.5
 *
 * # BOOLEAN
 * debug: true
 *
 * # NULL
 * optional-field: null
 * also-null: ~
 *
 * # EMPTY — key with no value
 * placeholder:
 *
 * # MAP — value is a nested mapping
 * server:
 *   port: 8080
 *
 * # SEQUENCE — value is a list
 * hosts:
 *   - localhost
 *   - remote
 * ```
 */
export enum YamlValueType {
  /** Plain text / quoted string */
  STRING = 'STRING',

  /** Whole number (e.g., 8080, -1) */
  INTEGER = 'INTEGER',

  /** Floating-point number (e.g., 30.5) */
  FLOAT = 'FLOAT',

  /** true / false / yes / no / on / off */
  BOOLEAN = 'BOOLEAN',

  /** null / ~ / empty */
  NULL = 'NULL',

  /** Key present but no value assigned */
  EMPTY = 'EMPTY',

  /** Value is a nested mapping (map/object) */
  MAP = 'MAP',

  /** Value is a sequence (list/array) */
  SEQUENCE = 'SEQUENCE',
}
