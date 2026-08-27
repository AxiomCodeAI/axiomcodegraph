/**
 * How a catalog entry spells its coordinate.
 *
 * The same library can be written five ways in one file. Recording which one
 * was used keeps the emitted group/artifact/version columns honest: a
 * SHORTHAND_STRING carries its version inline, a VERSION_REF does not, and a
 * VERSION_RICH may constrain rather than pin. Treating all three as "version"
 * turns a range into a pin.
 *
 * ## Examples
 *
 * ```toml
 * a = "com.example:lib:1.0"                                  # SHORTHAND_STRING
 * b = { module = "com.example:lib", version = "1.0" }        # MODULE_LITERAL
 * c = { module = "com.example:lib", version.ref = "x" }      # MODULE_VERSION_REF
 * d = { group = "com.example", name = "lib", version = "1.0" }  # GROUP_NAME_LITERAL
 * e = { group = "com.example", name = "lib", version.ref = "x" } # GROUP_NAME_VERSION_REF
 * f = { module = "com.example:lib" }                         # MODULE_NO_VERSION
 * g = { module = "com.example:lib", version = { strictly = "[1.0, 2.0[" } }  # VERSION_RICH
 * ```
 */
export enum GradleCatalogNotation {
  /** alias = "group:artifact:version" */
  SHORTHAND_STRING = 'SHORTHAND_STRING',

  /** { module = "group:artifact", version = "1.0" } */
  MODULE_LITERAL = 'MODULE_LITERAL',

  /** { module = "group:artifact", version.ref = "alias" } */
  MODULE_VERSION_REF = 'MODULE_VERSION_REF',

  /** { module = "group:artifact" } — version supplied by a BOM or platform. */
  MODULE_NO_VERSION = 'MODULE_NO_VERSION',

  /** { group = "g", name = "a", version = "1.0" } */
  GROUP_NAME_LITERAL = 'GROUP_NAME_LITERAL',

  /** { group = "g", name = "a", version.ref = "alias" } */
  GROUP_NAME_VERSION_REF = 'GROUP_NAME_VERSION_REF',

  /** { group = "g", name = "a" } — version supplied elsewhere. */
  GROUP_NAME_NO_VERSION = 'GROUP_NAME_NO_VERSION',

  /** version = { strictly | require | prefer | reject | rejectAll } */
  VERSION_RICH = 'VERSION_RICH',

  /** A plain [versions] entry: alias = "1.0". */
  VERSION_LITERAL = 'VERSION_LITERAL',

  /** A [bundles] entry: alias = ["a", "b"]. */
  BUNDLE_LIST = 'BUNDLE_LIST',

  /** { id = "plugin.id", version = "1.0" } */
  PLUGIN_ID_LITERAL = 'PLUGIN_ID_LITERAL',

  /** { id = "plugin.id", version.ref = "alias" } */
  PLUGIN_ID_VERSION_REF = 'PLUGIN_ID_VERSION_REF',

  /** alias = "plugin.id:1.0" */
  PLUGIN_SHORTHAND = 'PLUGIN_SHORTHAND',
}
