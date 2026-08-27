/**
 * Categorizes how a value references something external in Gradle DSL.
 *
 * Classification is purely structural — we detect the syntax pattern,
 * not the runtime semantics.
 *
 * ## Examples
 *
 * ```groovy
 * // GSTRING_INTERPOLATION
 * implementation "com.google.guava:guava:${guavaVersion}"
 *
 * // GSTRING_SIMPLE
 * implementation "com.google.guava:guava:$guavaVersion"
 *
 * // LAZY_GSTRING
 * version = "${-> rootProject.version}"
 *
 * // EXT_PROPERTY_ACCESS
 * implementation "com.amazonaws:aws-java-sdk:${versions.awsSdk}"
 *
 * // SYSTEM_PROPERTY
 * def javaVer = System.getProperty('java.version')
 *
 * // ENV_VARIABLE
 * def ci = System.getenv('CI')
 *
 * // ENV_VARIABLE_SHORT
 * def token = System.env.GITHUB_TOKEN
 *
 * // FIND_PROPERTY
 * def user = project.findProperty('nexusUser') ?: 'default'
 *
 * // GRADLE_PROPERTY_PROVIDER
 * def prop = providers.gradleProperty('myProp')
 *
 * // FILE_READ
 * version = file('VERSION').text.trim()
 * ```
 */
export enum GradleValueReferenceType {
  // ── GString interpolation ──
  /** "${varName}" — full interpolation syntax */
  GSTRING_INTERPOLATION = 'GSTRING_INTERPOLATION',

  /** "$varName" — simple dollar-prefix */
  GSTRING_SIMPLE = 'GSTRING_SIMPLE',

  /** "${-> expr}" — lazy/closure-based GString */
  LAZY_GSTRING = 'LAZY_GSTRING',

  // ── Ext / nested property access ──
  /** ext.varName or versions.awsSdk */
  EXT_PROPERTY_ACCESS = 'EXT_PROPERTY_ACCESS',

  // ── System / environment reads ──
  /** System.getProperty('x') */
  SYSTEM_PROPERTY = 'SYSTEM_PROPERTY',

  /** System.getenv('x') */
  ENV_VARIABLE = 'ENV_VARIABLE',

  /** System.env.X */
  ENV_VARIABLE_SHORT = 'ENV_VARIABLE_SHORT',

  // ── Project property reads ──
  /** findProperty('x') or project.findProperty('x') */
  FIND_PROPERTY = 'FIND_PROPERTY',

  /** project.property('x') — throws if missing */
  PROJECT_PROPERTY = 'PROJECT_PROPERTY',

  /** project.hasProperty('x') — boolean check */
  HAS_PROPERTY = 'HAS_PROPERTY',

  // ── Provider API ──
  /** providers.gradleProperty('x') */
  GRADLE_PROPERTY_PROVIDER = 'GRADLE_PROPERTY_PROVIDER',

  /** providers.systemProperty('x') */
  SYSTEM_PROPERTY_PROVIDER = 'SYSTEM_PROPERTY_PROVIDER',

  /** providers.environmentVariable('x') */
  ENV_VARIABLE_PROVIDER = 'ENV_VARIABLE_PROVIDER',

  // ── Kotlin delegation ──
  /** val x: String by project */
  PROJECT_DELEGATION = 'PROJECT_DELEGATION',

  /** val x by extra("y") */
  EXTRA_DELEGATION = 'EXTRA_DELEGATION',

  // ── Other ──
  /** file('VERSION').text.trim() or file('x').readText() */
  FILE_READ = 'FILE_READ',

  /** requested.version (inside eachPlugin / eachDependency blocks) */
  REQUESTED_VERSION = 'REQUESTED_VERSION',

  /** libs.spring.boot.starter / libs.versions.spring — version catalog accessor */
  VERSION_CATALOG_ACCESSOR = 'VERSION_CATALOG_ACCESSOR',

  /** libs.bundles.spring — version catalog bundle accessor */
  VERSION_CATALOG_BUNDLE = 'VERSION_CATALOG_BUNDLE',

  /** libs.plugins.spring.boot — version catalog plugin accessor */
  VERSION_CATALOG_PLUGIN = 'VERSION_CATALOG_PLUGIN',

  /** rootProject.someProperty / rootProject.ext.someProperty */
  ROOT_PROJECT_PROPERTY = 'ROOT_PROJECT_PROPERTY',

  /** Variable reference that couldn't be classified further */
  VARIABLE_REFERENCE = 'VARIABLE_REFERENCE',
}
