/**
 * DSL dialect used in a Gradle build file.
 */
export enum GradleDSLDialect {
  GROOVY = 'GROOVY',
  KOTLIN = 'KOTLIN',
  /**
   * A version catalog. Not a DSL at all — `gradle/libs.versions.toml` is TOML,
   * read by a hand written reader rather than by the Groovy grammar. It gets
   * its own value because defaulting it to GROOVY told every consumer that a
   * declarative data file had been parsed by a programming-language grammar,
   * which is both false and the kind of thing a reader would build on.
   */
  TOML = 'TOML',
}
