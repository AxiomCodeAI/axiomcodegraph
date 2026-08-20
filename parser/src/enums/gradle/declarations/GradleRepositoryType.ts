/**
 * Type of repository declared in a Gradle build file.
 *
 * ## Examples
 *
 * ```groovy
 * repositories {
 *     mavenCentral()           // MAVEN_CENTRAL
 *     mavenLocal()             // MAVEN_LOCAL
 *     google()                 // GOOGLE
 *     gradlePluginPortal()     // GRADLE_PLUGIN_PORTAL
 *     jcenter()                // JCENTER (deprecated)
 *     maven { url '...' }     // MAVEN_CUSTOM
 *     ivy { url '...' }       // IVY
 *     flatDir { dirs 'libs' } // FLAT_DIR
 * }
 * ```
 */
export enum GradleRepositoryType {
  MAVEN_CENTRAL = 'MAVEN_CENTRAL',
  MAVEN_LOCAL = 'MAVEN_LOCAL',
  GOOGLE = 'GOOGLE',
  GRADLE_PLUGIN_PORTAL = 'GRADLE_PLUGIN_PORTAL',
  JCENTER = 'JCENTER',
  MAVEN_CUSTOM = 'MAVEN_CUSTOM',
  IVY = 'IVY',
  FLAT_DIR = 'FLAT_DIR',
}
