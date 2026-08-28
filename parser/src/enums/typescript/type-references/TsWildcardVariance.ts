/**
 * Java's `wildcardVariance` slot, at the same column position, REPURPOSED.
 *
 * TypeScript has no use-site wildcards — there is no `? extends T` — so the slot
 * would otherwise be permanently empty at a position the shared projection reads.
 * It carries the type OPERATORS that modify a type in place instead, which is
 * the nearest thing the language has to a use-site modifier.
 *
 * ```ts
 * readonly string[]   // READONLY
 * unique symbol       // UNIQUE
 * ```
 *
 * This is the cross-language naming rule working as intended: same position,
 * same spirit, language-correct values. Forcing Java's `EXTENDS`/`SUPER` here
 * would be false parity.
 *
 * Declaration-site variance (`in` / `out`, TypeScript 4.7) is a different fact
 * and lives on `ts_type_parameter.varianceAnnotation`.
 *
 * Schema §4.5 c12.
 */
export enum TsWildcardVariance {
  /** `readonly T[]` — the array cannot be mutated through this reference. */
  READONLY = 'READONLY',
  /** `unique symbol` — a nominal symbol type. */
  UNIQUE = 'UNIQUE',
}
