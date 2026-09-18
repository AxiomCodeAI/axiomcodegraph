/**
 * How a property may be written — `cs_property.setterKind`.
 *
 * `INIT` is not a flavour of `SET`. An `init` accessor is callable **only** in
 * an object initializer or a constructor of the declaring type, so a write
 * through it is reachable from a strictly smaller set of places. 635 measured.
 * Folding it into `SET` would tell an engine a property is mutable when it is
 * not, in the direction that invents writes.
 */
export enum CsSetterKind {
  /** `set` — writable wherever accessibility allows. */
  SET = 'SET',

  /** `init` — writable only during object initialisation. 635 measured. */
  INIT = 'INIT',

  /** No setter at all: read-only. */
  NONE = 'NONE',
}
