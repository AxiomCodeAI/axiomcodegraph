/**
 * Type of a value segment within a YAML property value expression.
 *
 * Uses the same two-pass classification as the properties parser:
 * collect all YAML keys first, then classify `${...}` references as
 * PROPERTY_REFERENCE when the name matches a known key, or ENV_VARIABLE otherwise.
 *
 * ## Segment Types
 *
 * ```yaml
 * # LITERAL — plain text
 * app.name: Auth Service
 *
 * # ENV_VARIABLE — ${VAR} with no default, not a known YAML key
 * db.url: ${DATABASE_URL}
 *
 * # ENV_WITH_DEFAULT — ${VAR:default} with default, not a known YAML key
 * db.host: ${DB_HOST:localhost}
 *
 * # PROPERTY_REFERENCE — ${key} where key matches another YAML key in the file
 * app.url: ${app.base-url}/health
 *
 * # PROPERTY_REF_WITH_DEFAULT — ${key:default} where key matches another YAML key
 * app.region: ${app.default-region:us-east-1}
 *
 * # EMPTY — empty or absent value
 * placeholder:
 * ```
 */
export enum YamlValueSegmentType {
  /** Plain text with no references */
  LITERAL = 'LITERAL',

  /** ${VAR} — environment variable reference with no default, not a known YAML key */
  ENV_VARIABLE = 'ENV_VARIABLE',

  /** ${VAR:default} — environment variable with a default value, not a known YAML key */
  ENV_WITH_DEFAULT = 'ENV_WITH_DEFAULT',

  /** ${prop.key} — references another YAML key defined in the same file */
  PROPERTY_REFERENCE = 'PROPERTY_REFERENCE',

  /** ${prop.key:default} — references another YAML key with a fallback default */
  PROPERTY_REF_WITH_DEFAULT = 'PROPERTY_REF_WITH_DEFAULT',

  /** Empty or absent value */
  EMPTY = 'EMPTY',
}
