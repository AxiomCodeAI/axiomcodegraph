/**
 * Which keyword introduced a heritage entry.
 *
 * In the primary key of `ts_type_heritage`, and therefore never derived from
 * `heritageKind`: `class C extends B implements B` is legal, and the two rows
 * must not collide.
 *
 * Schema §4.3 c1.
 */
export enum TsClauseToken {
  /** `extends` — really does inherit members. */
  EXTENDS = 'EXTENDS',

  /** `implements` — asserts, and inherits nothing. */
  IMPLEMENTS = 'IMPLEMENTS',
}
