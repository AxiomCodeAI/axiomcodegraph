/**
 * Which of a version catalog's four tables an entry came from.
 *
 * `gradle/libs.versions.toml` is where a modern build actually keeps its
 * coordinates. Without it, `implementation libs.spring.boot.starter.web` is a
 * dependency on nothing resolvable — the group, the artifact and the version
 * all live in the catalog, and the build file names only an alias.
 *
 * ## Examples
 *
 * ```toml
 * [versions]
 * spring = "6.1.3"                                        # VERSION
 *
 * [libraries]
 * spring-core = { module = "org.springframework:spring-core", version.ref = "spring" }
 *                                                          # LIBRARY
 * [bundles]
 * spring = ["spring-core", "spring-beans"]                # BUNDLE
 *
 * [plugins]
 * boot = { id = "org.springframework.boot", version = "3.2.2" }
 *                                                          # PLUGIN
 * ```
 */
export enum GradleCatalogEntryKind {
  /** [versions] — a named version string other entries reference. */
  VERSION = 'VERSION',

  /** [libraries] — a dependency coordinate. */
  LIBRARY = 'LIBRARY',

  /** [bundles] — a named list of library aliases. */
  BUNDLE = 'BUNDLE',

  /** [plugins] — a plugin id plus version. */
  PLUGIN = 'PLUGIN',
}
