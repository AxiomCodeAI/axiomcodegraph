/**
 * What an identifier reference RESOLVED to.
 *
 * A discriminator for the polymorphic `referencedEntityHash` FK, and the column
 * the oracle checks against `getSymbolAtLocation`.
 *
 * ## UNKNOWN and AMBIENT_GLOBAL are different answers
 *
 * `AMBIENT_GLOBAL` means "resolved, to something outside this analysis" —
 * `console`, `Promise`, `btoa`. The engine closes it from `lib_ts_*`, and the
 * closed-world gate counts it as CLOSED.
 *
 * `UNKNOWN` means the parser could not resolve it. Collapsing the two would
 * report a resolution GAP as a success, which is why the ambient set is curated
 * rather than being "anything not found".
 *
 * For a global there is no import row to point at, so a curated set is the only
 * mechanism available — unlike a TYPE name, where an unresolved name is simply
 * emitted as written and the engine looks it up.
 *
 * Schema §4.14 c14.
 */
export enum TsReferencedEntityKind {
  /** A class, interface, enum or type alias. */
  TYPE = 'TYPE',
  /** A function-shaped declaration, including a named function expression. */
  METHOD = 'METHOD',
  /** A member. */
  FIELD = 'FIELD',
  /** A `const`, `let`, `var`, or a destructured binding's declaration. */
  VARIABLE = 'VARIABLE',
  /** A formal parameter, including an arrow's. */
  PARAMETER = 'PARAMETER',
  /** An enum member. */
  ENUM_MEMBER = 'ENUM_MEMBER',
  /** A name bound by an import — the engine follows `resolvedFilePath` from here. */
  IMPORT_BINDING = 'IMPORT_BINDING',
  /** A namespace. */
  NAMESPACE = 'NAMESPACE',
  /** `this`. */
  THIS = 'THIS',
  /** `super`. */
  SUPER = 'SUPER',
  /** Declared outside this analysis: `console`, `Promise`, `btoa`. A closed terminal. */
  AMBIENT_GLOBAL = 'AMBIENT_GLOBAL',
  /** Not resolved. A measured GAP, deliberately distinguishable from a terminal. */
  UNKNOWN = 'UNKNOWN',
}
