/**
 * What kind of entity an export exposes.
 *
 * A discriminator for the polymorphic `exportedEntityLinkHash` FK, so a consumer
 * knows which relation to join. `UNKNOWN` is the honest value for a pure
 * re-export, where the entity lives in a module this row does not name and the
 * engine must follow `resolvedSourceModuleLinkHash` to find it.
 *
 * Schema §4.13 c9.
 */
export enum TsExportedEntityKind {
  /** A class, interface, enum or type alias. */
  TYPE = 'TYPE',
  /** A function. */
  METHOD = 'METHOD',
  /** A member — reachable when the export names one. */
  FIELD = 'FIELD',
  /** A `const`, `let` or `var`. */
  VARIABLE = 'VARIABLE',
  /** An enum, when the export names the enum rather than a member. */
  ENUM = 'ENUM',
  /** A namespace. */
  NAMESPACE = 'NAMESPACE',
  /** A whole module — `export = X` or `export * as ns`. */
  MODULE = 'MODULE',
  /** `export default compute()` — an expression with no declaration. */
  EXPRESSION = 'EXPRESSION',
  /** A pure re-export: the entity is in another module, and the chain must be followed. */
  UNKNOWN = 'UNKNOWN',
}
