/**
 * The analysis regime, stamped into `ts_module`'s PRIMARY KEY.
 *
 * ## Why this is in a key and `targetTsVersion` is not
 *
 * Both answer "which compiler", and they are deliberately separate. The module
 * hash chains into every child key in the fact base, so putting a patch version
 * there would invalidate every row on a `6.0.3` → `6.0.4` bump — for a change
 * that alters nothing about the facts. `targetTsVersion` carries the exact
 * version as non-key provenance instead.
 *
 * What must be distinguishable from INSIDE the fact base is the regime: a 6.x
 * in-process parse and a future 7.x out-of-process one produce structurally
 * different fact sets, and a database holding both must not let them collide.
 * TypeScript 7 ships no in-process JS parser at all — no `ts.createSourceFile`,
 * no `TypeChecker` — so that day is a change of regime, not of version.
 *
 * Schema §4.1 c16, ruling OQ-4.
 */
export enum TsEmissionRegime {
  /** `ts.createSourceFile` from an in-process `typescript@6.x`. */
  TS6_INPROC = 'ts6-inproc',
}
