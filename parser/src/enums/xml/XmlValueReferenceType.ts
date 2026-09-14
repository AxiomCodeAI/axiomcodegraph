/**
 * Type of a value reference found within XML text content or attribute values.
 *
 * Classification is purely structural — we detect the syntax pattern, not
 * the runtime semantics. Whether `${env.DB_HOST}` is an env var or
 * `${spring.version}` is a Maven property cannot be determined at parse time.
 *
 * ## Examples
 *
 * ```xml
 * <!-- PROPERTY_PLACEHOLDER — any ${name} without a default -->
 * <version>${spring.version}</version>
 * <url>${env.DB_HOST}</url>
 * <name>${project.artifactId}</name>
 *
 * <!-- PLACEHOLDER_WITH_DEFAULT — any ${name:default} -->
 * <host>${db.host:localhost}</host>
 * <port>${env.DB_PORT:5432}</port>
 *
 * <!-- SPEL_EXPRESSION — #{...} syntax -->
 * <value>#{systemProperties['user.home']}</value>
 * ```
 */
export enum XmlValueReferenceType {
  /** ${name} — placeholder without a default value */
  PROPERTY_PLACEHOLDER = 'PROPERTY_PLACEHOLDER',

  /** ${name:default} — placeholder with a default value */
  PLACEHOLDER_WITH_DEFAULT = 'PLACEHOLDER_WITH_DEFAULT',

  /** #{...} — Spring Expression Language expression */
  SPEL_EXPRESSION = 'SPEL_EXPRESSION',
}
