/**
 * Type of a value segment within a property value expression.
 *
 * A property value can contain multiple segments of different types.
 * For example: `jdbc:mysql://${DB_HOST:localhost}:${DB_PORT:3306}`
 * contains LITERAL, ENV_WITH_DEFAULT, LITERAL, ENV_WITH_DEFAULT segments.
 *
 * ## Segment Types
 *
 * ```properties
 * # LITERAL - plain text
 * app.name=Auth Service
 *
 * # ENV_VARIABLE - ${VAR} with no default, not a known property key
 * db.url=${DATABASE_URL}
 *
 * # ENV_WITH_DEFAULT - ${VAR:default} with default, not a known property key
 * db.host=${DB_HOST:localhost}
 *
 * # PROPERTY_REFERENCE - ${key} where key matches another property in the file
 * app.url=${app.base-url}/health
 *
 * # PROPERTY_REF_WITH_DEFAULT - ${key:default} where key matches another property
 * app.region=${app.default-region:us-east-1}
 *
 * # SPEL_EXPRESSION - #{...} Spring Expression Language
 * app.home=#{systemProperties['user.home']}
 *
 * # RANDOM - ${random.*} Spring random value placeholders
 * app.id=${random.uuid}
 *
 * # EMPTY - empty or absent value
 * app.flag=
 * ```
 */
export enum PropertyValueSegmentType {
  /** Plain text with no references */
  LITERAL = 'LITERAL',

  /** ${VAR} - environment variable reference with no default, not a known property key */
  ENV_VARIABLE = 'ENV_VARIABLE',

  /** ${VAR:default} - environment variable with a default value, not a known property key */
  ENV_WITH_DEFAULT = 'ENV_WITH_DEFAULT',

  /** ${prop.key} - references another property key defined in the same file */
  PROPERTY_REFERENCE = 'PROPERTY_REFERENCE',

  /** ${prop.key:default} - references another property key with a fallback default */
  PROPERTY_REF_WITH_DEFAULT = 'PROPERTY_REF_WITH_DEFAULT',

  /** #{...} - Spring Expression Language expression */
  SPEL_EXPRESSION = 'SPEL_EXPRESSION',

  /** ${random.*} - Spring Boot random value placeholder */
  RANDOM = 'RANDOM',

  /** Empty or absent value (key with no value, or key= with nothing after) */
  EMPTY = 'EMPTY',
}
