/**
 * Where a dependency's version came from — or that it has none.
 *
 * A coordinate row carries a `version` column. Two very different situations
 * produce an empty one: the build genuinely omits the version because a BOM
 * supplies it, and the parser could not read the version because it is behind
 * an accessor it did not resolve. A downstream "which builds pin log4j" query
 * must not treat those the same.
 *
 * ## Examples
 *
 * ```groovy
 * implementation 'com.example:lib:1.0'                    LITERAL
 * implementation "com.example:lib:${springVersion}"       INTERPOLATED
 * implementation libs.spring.core                         CATALOG
 * implementation "com.example:lib:$version"               PROPERTY
 * implementation platform('com:bom:1.0')                  — the BOM itself is LITERAL
 * implementation 'com.example:lib'                        ABSENT (BOM-managed)
 * implementation depCoordinate                            VARIABLE
 * ```
 */
export enum GradleVersionSource {
  /** Written out in the coordinate as a plain string. */
  LITERAL = 'LITERAL',

  /** Supplied by a GString/template interpolation the reference relation carries. */
  INTERPOLATED = 'INTERPOLATED',

  /** Supplied by a version catalog entry. */
  CATALOG = 'CATALOG',

  /** Supplied by a project/ext property resolved within the corpus. */
  PROPERTY = 'PROPERTY',

  /** The coordinate deliberately has no version — a platform or BOM supplies it. */
  ABSENT = 'ABSENT',

  /** The whole coordinate sits behind a variable; nothing can be split out. */
  VARIABLE = 'VARIABLE',

  /** A version is present in some form this parser could not classify. */
  UNKNOWN = 'UNKNOWN',
}
