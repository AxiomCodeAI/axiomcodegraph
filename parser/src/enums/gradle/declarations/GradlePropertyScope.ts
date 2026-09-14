/**
 * Scope/origin of a property or variable assignment in a Gradle build file.
 *
 * ## Examples
 *
 * ```groovy
 * // PROJECT — direct project property
 * group = 'com.example'
 * version = '1.0.0'
 * sourceCompatibility = '17'
 *
 * // EXT_BLOCK — inside ext { }
 * ext { guavaVersion = '32.1.3-jre' }
 *
 * // EXT_SINGLE — ext.x = 'y' shorthand
 * ext.springVersion = '6.0.0'
 *
 * // EXT_SET — programmatic set
 * project.ext.set('nexusUrl', 'https://...')
 *
 * // EXTRA_DELEGATION (Kotlin DSL)
 * val springVersion by extra("6.0.0")
 *
 * // PROJECT_DELEGATION (Kotlin DSL)
 * val nexusUrl: String by project
 *
 * // BUILDSCRIPT_EXT
 * buildscript { ext { kotlinVersion = '1.9.10' } }
 *
 * // LOCAL_VARIABLE
 * def jacksonVersion = '2.15.3'   // Groovy
 * val jacksonVersion = "2.15.3"   // Kotlin
 *
 * // EXT_MAP_ENTRY — nested map inside ext
 * ext { versions = [ awsSdk: '2.21.29', jackson: '2.15.3' ] }
 * ```
 */
export enum GradlePropertyScope {
  /** group = 'x', version = 'y', sourceCompatibility = '17' */
  PROJECT = 'PROJECT',

  /** ext { x = 'y' } */
  EXT_BLOCK = 'EXT_BLOCK',

  /** ext.x = 'y' */
  EXT_SINGLE = 'EXT_SINGLE',

  /** project.ext.set('x', 'y') */
  EXT_SET = 'EXT_SET',

  /** val x by extra("y") — Kotlin DSL */
  EXTRA_DELEGATION = 'EXTRA_DELEGATION',

  /** val x: String by project — Kotlin DSL */
  PROJECT_DELEGATION = 'PROJECT_DELEGATION',

  /** buildscript { ext { x = 'y' } } */
  BUILDSCRIPT_EXT = 'BUILDSCRIPT_EXT',

  /** def x = 'y' (Groovy) or val x = "y" (Kotlin) */
  LOCAL_VARIABLE = 'LOCAL_VARIABLE',

  /** Nested map in ext: versions = [ awsSdk: '2.21.29' ] */
  EXT_MAP_ENTRY = 'EXT_MAP_ENTRY',
}
