/**
 * How an enum member's value is determined.
 *
 * ## Why COMPUTED must be its own member
 *
 * An enum member's value is not always statically known, and the difference is
 * behavioural rather than cosmetic: a computed member cannot be inlined, cannot
 * appear in a `const enum`, and cannot be used as a literal type. A fact base
 * that records every member as if it had a known value claims a constant where
 * the program has a computation.
 *
 * ```ts
 * enum Status {
 *     Active,                     // IMPLICIT_NUMERIC — 0, assigned by position
 *     Closed = 3,                 // EXPLICIT_NUMERIC
 *     Archived,                   // IMPLICIT_NUMERIC — 4, continues from 3
 * }
 * enum Direction {
 *     Up = "UP",                  // EXPLICIT_STRING
 * }
 * enum Flags {
 *     Read = 1 << 0,              // CONSTANT_EXPRESSION — foldable at compile time
 *     Both = Read | Write,        // CONSTANT_EXPRESSION
 *     Runtime = compute(),        // COMPUTED — not knowable without running it
 * }
 * ```
 *
 * `CONSTANT_EXPRESSION` is separated from `COMPUTED` because the compiler folds
 * the former and refuses the latter in a `const enum` — so the distinction
 * decides whether a reference to the member can have a runtime target at all.
 *
 * Schema §4.10 c12.
 */
export enum TsEnumMemberValueKind {
  /** No initializer: the value is the previous member's plus one. */
  IMPLICIT_NUMERIC = 'IMPLICIT_NUMERIC',
  /** `= 3`. */
  EXPLICIT_NUMERIC = 'EXPLICIT_NUMERIC',
  /** `= "UP"`. A string enum member cannot be reverse-mapped. */
  EXPLICIT_STRING = 'EXPLICIT_STRING',
  /** `= 1 << 0`, `= Read | Write` — folded by the compiler. */
  CONSTANT_EXPRESSION = 'CONSTANT_EXPRESSION',
  /** `= compute()` — not statically known, and illegal in a `const enum`. */
  COMPUTED = 'COMPUTED',
}
