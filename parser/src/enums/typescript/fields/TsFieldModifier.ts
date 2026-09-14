/**
 * Modifiers on a member. A comma-set column, sorted.
 *
 * ```ts
 * class C {
 *     static readonly MAX = 10;   // READONLY,STATIC
 *     declare brand: string;      // DECLARE
 *     abstract kind: string;      // ABSTRACT
 *     override id = 1;            // OVERRIDE
 *     optional?: number;          // OPTIONAL
 *     definite!: number;          // DEFINITE_ASSIGNMENT
 *     accessor value = 0;         // ACCESSOR
 * }
 * ```
 *
 * `OPTIONAL` is duplicated as the boolean `ts_field.isOptional` because it is
 * load-bearing for structural satisfaction: an ABSENT optional member does not
 * break assignability, so a rule that ignores it rejects classes that
 * legitimately satisfy an interface. The boolean is there so that rule never has
 * to split a comma-set.
 *
 * Schema §4.8 c12.
 */
export enum TsFieldModifier {
  /** `static`. */
  STATIC = 'STATIC',
  /** `readonly` — 8,901 measured. */
  READONLY = 'READONLY',
  /** `declare` — asserts an inherited member without emitting one. */
  DECLARE = 'DECLARE',
  /** `abstract`. */
  ABSTRACT = 'ABSTRACT',
  /** `override`. */
  OVERRIDE = 'OVERRIDE',
  /** `x?: T` — 5,196 measured; load-bearing for structural satisfaction. */
  OPTIONAL = 'OPTIONAL',
  /** `x!: T` — asserts assignment the checker cannot see. */
  DEFINITE_ASSIGNMENT = 'DEFINITE_ASSIGNMENT',
  /** `accessor x` — a getter/setter pair with backing storage. */
  ACCESSOR = 'ACCESSOR',
}
