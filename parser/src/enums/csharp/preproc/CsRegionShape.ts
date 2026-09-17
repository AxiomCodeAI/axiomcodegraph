/**
 * What a conditional region CONTAINS — `cs_preproc_region.regionShape`.
 *
 * ## `FRAGMENT` is the honest terminal, and it is 16.9% of regions
 *
 * A region splitting a base list, an `else` chain or a parameter list contains
 * no independently parseable construct. It gets a row with `FRAGMENT` and **no
 * child rows**, because the alternative is silence about a sixth of all
 * regions — and silence is indistinguishable from "there was nothing here".
 */
export enum CsRegionShape {
  /** Member declarations inside a type. */
  TYPE_LEVEL = 'TYPE_LEVEL',
  /** Top-level declarations: types, namespaces, usings. */
  DECLARATION = 'DECLARATION',
  /** Statements inside a body. */
  STATEMENT = 'STATEMENT',
  ENUM_MEMBERS = 'ENUM_MEMBERS',
  /** Not independently parseable. Recorded, with no children. */
  FRAGMENT = 'FRAGMENT',
  EMPTY = 'EMPTY',
}
