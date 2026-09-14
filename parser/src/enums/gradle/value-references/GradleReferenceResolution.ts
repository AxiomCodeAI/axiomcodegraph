/**
 * What a value reference was resolved against — or why it was not.
 *
 * This column exists so that coverage can be measured honestly. A raw
 * "resolved / total" ratio over Gradle references measures how many
 * environment variables a build reads, not how good the parser is.
 *
 * Split the unresolved side and the number becomes meaningful:
 *
 * - `UNRESOLVED_IN_CORPUS` is the parser's gap. A property by that name IS
 *   declared somewhere in the analysed files and the link was still not made.
 * - `EXTERNAL` is not. `System.getenv('CI')` has no declaration to point at,
 *   and never will; counting it as a miss penalises the parser for the build
 *   reading its environment.
 *
 * Absence stays absence: a reference that cannot be decided is left
 * `UNRESOLVED_IN_CORPUS` or `EXTERNAL` with an empty target hash rather than
 * pointed at a plausible guess.
 */
export enum GradleReferenceResolution {
  /** Matched a PROPERTY declaration in the same script. */
  LOCAL_PROPERTY = 'LOCAL_PROPERTY',

  /** Matched a PROPERTY declared in an `ext { }` / `extra` block. */
  EXT_PROPERTY = 'EXT_PROPERTY',

  /** Matched a PROPERTY in another script in the same build (root, applied-from). */
  CROSS_SCRIPT_PROPERTY = 'CROSS_SCRIPT_PROPERTY',

  /** Matched a [versions] entry in a version catalog. */
  CATALOG_VERSION = 'CATALOG_VERSION',

  /** Matched a [libraries] entry in a version catalog. */
  CATALOG_LIBRARY = 'CATALOG_LIBRARY',

  /** Matched a [bundles] entry in a version catalog. */
  CATALOG_BUNDLE = 'CATALOG_BUNDLE',

  /** Matched a [plugins] entry in a version catalog. */
  CATALOG_PLUGIN = 'CATALOG_PLUGIN',

  /**
   * A declaration by that name exists in the analysed corpus and the link was
   * still not made. This is the parser's gap, and the only bucket that should
   * shrink as the parser improves.
   */
  UNRESOLVED_IN_CORPUS = 'UNRESOLVED_IN_CORPUS',

  /**
   * Nothing by that name exists in the corpus. Environment variables, system
   * properties, `-P` command-line properties, and coordinates supplied by a
   * plugin at execution time all land here. Excluded from coverage.
   */
  EXTERNAL = 'EXTERNAL',
}
