/**
 * The role a Gradle file plays in a build.
 *
 * A build's files are not interchangeable: `settings.gradle` declares which
 * projects exist, a root `build.gradle` configures every one of them, a leaf
 * `build.gradle` configures exactly one, and a script plugin configures
 * whichever script applied it. A dependency found in the first three is a fact
 * about a known project; the same dependency in a script plugin is a fact about
 * an unknown set of projects until the `apply from:` edges are followed.
 *
 * Collapsing these into "a .gradle file" is what makes a dependency query
 * return the right coordinate against the wrong project.
 *
 * ## Examples
 *
 * ```
 * settings.gradle                → SETTINGS
 * settings.gradle.kts            → SETTINGS
 * build.gradle          (root)   → ROOT_BUILD
 * core/build.gradle              → PROJECT_BUILD
 * buildSrc/build.gradle          → BUILD_SRC_BUILD
 * buildSrc/settings.gradle       → BUILD_SRC_SETTINGS
 * gradle/dependencies.gradle     → SCRIPT_PLUGIN
 * init.gradle / *.init.gradle    → INIT
 * gradle/libs.versions.toml      → VERSION_CATALOG
 * ```
 */
export enum GradleScriptKind {
  /** settings.gradle[.kts] — declares the project graph. */
  SETTINGS = 'SETTINGS',

  /** build.gradle[.kts] sitting beside the settings file. */
  ROOT_BUILD = 'ROOT_BUILD',

  /** build.gradle[.kts] for a subproject. */
  PROJECT_BUILD = 'PROJECT_BUILD',

  /** buildSrc/build.gradle[.kts] — builds the build, not the product. */
  BUILD_SRC_BUILD = 'BUILD_SRC_BUILD',

  /** buildSrc/settings.gradle[.kts]. */
  BUILD_SRC_SETTINGS = 'BUILD_SRC_SETTINGS',

  /** An included build's settings/build (composite builds via includeBuild). */
  INCLUDED_BUILD = 'INCLUDED_BUILD',

  /** init.gradle[.kts] or *.init.gradle[.kts] — applied before any project. */
  INIT = 'INIT',

  /** Any other .gradle[.kts] file — reached only through `apply from:`. */
  SCRIPT_PLUGIN = 'SCRIPT_PLUGIN',

  /** gradle/libs.versions.toml or any TOML declared as a version catalog. */
  VERSION_CATALOG = 'VERSION_CATALOG',
}
